import { describe, expect, it } from "vitest";
import { normalizeEspnLeague } from "@/adapters/espn/normalize";
import { PARKER as ESPN_PARKER, fakeResolver as espnResolver, parkerBundle } from "@/adapters/espn/test-helpers";
import { ESPN_WAIVER_CODES } from "@/adapters/espn/waivers";
import { normalizeSleeperLeague } from "@/adapters/sleeper/normalize";
import { fakeResolver, loadTestLeague, rawOf, type TestLeague } from "@/adapters/sleeper/test-helpers";
import { WAIVER_RESET_BEFORE_GAMES as SLEEPER_WAIVER_RESET_BEFORE_GAMES, WAIVER_TYPE_UNKNOWN as SLEEPER_WAIVER_TYPE_UNKNOWN } from "@/adapters/sleeper/waivers";
import { inactiveTeams } from "@/engine/acceptance";
import { config } from "@/engine/config";
import type { ModelInputs, PlayerInputs } from "@/engine/inputs";
import { allocationOrder } from "@/engine/league";
import { fantasyCalcFormat } from "@/engine/market";
import type { LeagueSettings, LeagueSnapshot, PlayerInfo, Scoring, Team } from "@/engine/model";
import type { ImportResponse } from "./api";
import { UNKNOWN_SETTING_TEXT, WAIVER_WARNING_CODES, allocationBasis, buildImportReport, refreshOutcomeText, ruleText } from "./importReport";

// A small synthetic league. Every name is made up.
const TZ = "America/New_York";

function team(id: string, name: string, owner: string, rec: [number, number, number], pf: number, roster: string[], extra: Partial<Team> = {}): Team {
  return { id, name, ownerName: owner, roster, ir: [], taxi: [], record: { w: rec[0], l: rec[1], t: rec[2] }, pointsFor: pf, pointsAgainst: 300, ...extra };
}

function player(id: string, name: string, pos: PlayerInfo["pos"], nflTeam: string | null = "ZZZ"): PlayerInfo {
  return { id, name, pos, eligible: [pos], nflTeam, injury: "ACTIVE", ids: {} };
}

/** ESPN-style scoring: half PPR, a TE premium through a byPosition replacement, D/ST through overrides and range rules. */
const espnScoring: Scoring = {
  perStat: { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: 0.5, rec_yd: 0.1, rec_td: 6, fum_lost: -2, int: 0, sack: 0, fgm_50p: 5, pass_td_40p: 2 },
  byPosition: { TE: { rec: 1 }, DEF: { int: 2, sack: 1, fum_rec: 2, def_td: 6, safe: 2, blk_kick: 2 } },
  rules: [
    { kind: "range", stat: "pts_allow", min: 14, max: 17, points: 1, positions: ["DEF"] },
    { kind: "range", stat: "pts_allow", min: 0, max: 0, points: 5, positions: ["DEF"] },
    { kind: "range", stat: "pts_allow", min: 46, points: -7, positions: ["DEF"] },
    { kind: "threshold", stat: "rush_yd", min: 100, points: 2 },
    { kind: "stepped", stat: "tkl", every: 10, points: 1, min: 0, max: 30 },
    { kind: "perUnit", stat: { sum: ["pass_yd", "rush_yd"] }, points: 0.01, min: 400 },
    { kind: "perGame", points: 1, positions: ["K"] },
  ],
  unmapped: [{ platformKey: "espn:209", label: "1-point safety", points: 1 }],
};

const settings: LeagueSettings = {
  numTeams: 4,
  leagueType: "redraft",
  lineup: [
    { slot: "QB", count: 1, eligible: ["QB"] },
    { slot: "RB", count: 2, eligible: ["RB"] },
    { slot: "WR", count: 2, eligible: ["WR"] },
    { slot: "TE", count: 1, eligible: ["TE"] },
    { slot: "FLEX", count: 1, eligible: ["RB", "WR", "TE"] },
    { slot: "D/ST", count: 1, eligible: ["DEF"] },
    { slot: "K", count: 1, eligible: ["K"] },
  ],
  benchSlots: 7,
  irSlots: 1,
  taxiSlots: 0,
  maxRosterSize: 16,
  positionLimits: { QB: 4, K: 3 },
  scoring: espnScoring,
  regularSeasonWeeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  playoffWeeks: [15, 16, 17],
  playoffTeams: 4,
  playoffByes: 0,
  medianGame: false,
  pointsOnly: false,
  tradeDeadline: { week: 13, date: "2026-12-02T17:00:00.000Z" },
  tradeReview: "league_vote",
};

function snapshot(overrides: Partial<LeagueSnapshot> = {}, settingsOverrides: Partial<LeagueSettings> = {}): LeagueSnapshot {
  return {
    platform: "espn",
    leagueId: "4242",
    season: 2026,
    name: "The Gloopdorf Invitational",
    fetchedAt: "2026-09-29T23:00:00.000Z",
    currentWeek: 4,
    settings: { ...settings, ...settingsOverrides },
    teams: [
      team("1", "Moonbeam Mudcats", "Zorblax Quintavious", [2, 1, 0], 350.25, ["9001", "9002"], { ir: ["9003"] }),
      team("2", "Gravel Gophers", "Brumhilda Snarfwhistle", [3, 0, 0], 330, ["9004", "espn:31337"]),
      team("3", "Quasar Quokkas", "Quenby Flapdoodle", [2, 1, 0], 360.5, ["9005", "ghost-id"]),
      team("4", "Tundra Tortoises", "Thaddeus Wobblegong", [0, 3, 0], 280, ["9006"]),
    ],
    myTeamId: "1",
    players: {
      "9001": player("9001", "Fizzwick Pemberton", "QB"),
      "9002": player("9002", "Glimmer Oddfellow", "TE"),
      "9003": player("9003", "Bartleby Crumpet", "RB"),
      "9004": player("9004", "Noodle McSprocket", "WR"),
      "espn:31337": player("espn:31337", "Pip Wobbleton", "K", null),
      "9005": player("9005", "Dorian Quibble", "RB"),
      "9006": player("9006", "Humbert Fiddlesticks", "WR"),
      "9100": player("9100", "Free Agent Floop", "WR"),
    },
    schedule: [
      { week: 4, teamA: "1", teamB: "3", isPlayoff: false },
      { week: 4, teamA: "2", teamB: "4", isPlayoff: false },
      ...[1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13].flatMap((w) => [
        { week: w, teamA: "1", teamB: "2", isPlayoff: false },
        { week: w, teamA: "3", teamB: "4", isPlayoff: false },
      ]),
    ],
    transactions: [
      { id: "t1", type: "trade", week: 2, timestamp: "2026-09-15T00:00:00Z", teams: ["1", "2"], moves: [] },
      { id: "t2", type: "add", week: 3, timestamp: "2026-09-20T00:00:00Z", teams: ["3"], moves: [{ playerId: "9201", from: null, to: "3" }, { playerId: "9202", from: "3", to: null }] },
      { id: "t3", type: "drop", week: 3, timestamp: "2026-09-20T00:00:00Z", teams: ["3"], moves: [{ playerId: "9203", from: "3", to: null }] },
      { id: "t4", type: "waiver", week: 3, timestamp: "2026-09-21T00:00:00Z", teams: ["4"], moves: [{ playerId: "9204", from: null, to: "4" }] },
    ],
    freeAgents: ["9100"],
    warnings: [{ code: "ESPN_TQB", message: "Team QB mapped to QB.", platformPath: "players[].defaultPositionId" }],
    ...overrides,
  };
}

function response(snap: LeagueSnapshot, extra: Partial<ImportResponse> = {}): ImportResponse {
  return { snapshot: snap, notes: ["Rosters include 1 player on IR."], ...extra };
}

describe("buildImportReport: at a glance", () => {
  const view = buildImportReport(response(snapshot()), { timeZone: TZ });
  const tile = (id: string) => view.glance.find((t) => t.id === id);

  it("summarizes the league in eight tiles", () => {
    expect(view.glance.map((t) => t.id)).toEqual(["league", "scoring", "starters", "roster", "playoffs", "deadline", "myTeam", "warnings"]);
    expect(tile("league")).toMatchObject({ value: "4 teams · Redraft", detail: "ESPN" });
    expect(tile("scoring")).toMatchObject({ value: "Half-PPR", detail: "4-pt passing TD · TE premium +0.5" });
    expect(tile("starters")?.value).toBe("QB, 2 RB, 2 WR, TE, FLEX, D/ST, K");
    expect(tile("roster")).toMatchObject({ value: "7 bench · 1 IR", detail: "16 active roster spots" });
    expect(tile("playoffs")).toMatchObject({ value: "4 teams", detail: "Weeks 15–17" });
    expect(tile("deadline")).toMatchObject({ value: "Wed, Dec 2, 2026 (week 13)", detail: "League vote: managers can veto trades" });
    expect(tile("myTeam")).toMatchObject({ value: "Moonbeam Mudcats", detail: "Found by ESPN", tone: "normal" });
    expect(tile("warnings")).toMatchObject({ value: "2 items", detail: "1 scoring rule we couldn't map", tone: "warn" });
  });

  it("doesn't count an unmapped rule twice when the adapter also warned about it", () => {
    const warned = snapshot({ warnings: [{ code: "ESPN_TQB", message: "Team QB mapped to QB." }, { code: "ESPN_SCORING_UNMAPPED", message: "1-point safety isn't counted." }] });
    expect(buildImportReport(response(warned), { timeZone: TZ }).glance.find((t) => t.id === "warnings")).toMatchObject({ value: "2 items", detail: "1 scoring rule we couldn't map" });
  });

  it("describes the league header", () => {
    expect(view.league).toMatchObject({ name: "The Gloopdorf Invitational", platformLabel: "ESPN", season: 2026, currentWeek: 4, numTeams: 4, leagueTypeLabel: "Redraft", bestBall: false });
  });
});

describe("buildImportReport: scoring", () => {
  const view = buildImportReport(response(snapshot()), { timeZone: TZ });

  it("shows reception points by position, with the TE premium", () => {
    expect(view.scoring.receptions).toEqual([
      { pos: "RB", points: 0.5, text: "0.5 pts" },
      { pos: "WR", points: 0.5, text: "0.5 pts" },
      { pos: "TE", points: 1, text: "1 pt" },
    ]);
    expect(view.scoring.tePremium).toBe(0.5);
    expect(view.scoring.formatLabel).toBe("Half-PPR");
  });

  it("shows passing, yardage and turnover rates", () => {
    const h = Object.fromEntries(view.scoring.highlights.map((x) => [x.label, x.value]));
    expect(h["Passing TD"]).toBe("4 pts");
    expect(h["Passing yards"]).toBe("1 pt per 25 yds");
    expect(h["Rushing yards"]).toBe("1 pt per 10 yds");
    expect(h["Receiving yards"]).toBe("1 pt per 10 yds");
    expect(h["Rushing or receiving TD"]).toBe("6 pts");
    expect(h["Interception thrown"]).toBe("−2 pts");
    expect(h["Fumble lost"]).toBe("−2 pts");
  });

  it("lists D/ST points-allowed buckets in order, apart from the other rules, with uncovered ranges at 0", () => {
    expect(view.scoring.defenseBuckets).toEqual([
      {
        title: "Points allowed",
        lines: [
          { range: "0", points: 5, text: "0 points allowed: +5" },
          { range: "1–13", points: 0, text: "1–13 points allowed: 0" },
          { range: "14–17", points: 1, text: "14–17 points allowed: +1" },
          { range: "18–45", points: 0, text: "18–45 points allowed: 0" },
          { range: "46+", points: -7, text: "46+ points allowed: −7" },
        ],
      },
    ]);
    expect(view.scoring.defenseSummary).toBe("Sack 1 · INT 2 · Fumble recovery 2 · Defensive TD 6 · Safety 2 · Blocked kick 2");
  });

  it("writes every other rule in plain English", () => {
    expect(view.scoring.bonuses).toEqual([
      "100+ rushing yards in a game: +2",
      "+1 for every 10 tackles (counting 0–30)",
      "+0.01 per unit of (passing yards + rushing yards) when the total is 400+",
      "+1 per game played (K only)",
      "40+ yard TD passes: +2",
    ]);
  });

  it("lists every per-unit rate, with position replacements", () => {
    const rows = Object.fromEntries(view.scoring.allRules.map((r) => [r.key, r.value]));
    expect(rows.rec).toBe("0.5 (TE: 1)");
    expect(rows.int).toBe("D/ST: 2");
    expect(rows.pass_yd).toBe("0.04");
    expect(rows.fum_rec).toBe("D/ST: 2");
    expect(view.scoring.allRules[0]?.key).toMatch(/^pass_/); // passing first
  });

  it("hides a D/ST 0 on a player-only stat (D/ST scores returns under its own key)", () => {
    const scoring = { perStat: { kr_td: 6, rec: 1 }, byPosition: { DEF: { kr_td: 0, def_kr_td: 6 }, TE: { rec: 0 } }, rules: [], unmapped: [] };
    const v = buildImportReport(response(snapshot({}, { scoring })), { timeZone: TZ });
    const rows = Object.fromEntries(v.scoring.allRules.map((r) => [r.key, r.value]));
    expect(rows.kr_td).toBe("6");
    expect(rows.def_kr_td).toBe("D/ST: 6");
    expect(rows.rec).toBe("1 (TE: 0)"); // a 0 for a player position is still shown
  });

  it("shows rules we couldn't map, with their points", () => {
    expect(view.scoring.unmapped).toEqual([{ platformKey: "espn:209", label: "1-point safety", points: 1, text: "1-point safety: +1" }]);
  });

  it("reads Sleeper-style scoring: PPR, bonus keys and bucket keys", () => {
    const sleeperScoring: Scoring = {
      perStat: { rec: 1, bonus_rec_te: 0.5, pass_td: 6, pass_yd: 0.04, rush_yd: 0.1, rec_yd: 0.1, bonus_rush_yd_100: 3, pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_35p: -4, sack: 1 },
      rules: [],
      unmapped: [],
    };
    const snap = snapshot({ platform: "sleeper" }, { scoring: sleeperScoring, lineup: [...settings.lineup.slice(0, 5), { slot: "DEF", count: 1, eligible: ["DEF"] }] });
    const v = buildImportReport(response(snap), { timeZone: TZ });
    expect(v.scoring.formatLabel).toBe("PPR");
    expect(v.scoring.tePremium).toBe(0.5);
    expect(v.scoring.receptions.find((r) => r.pos === "TE")?.points).toBe(1.5);
    expect(v.scoring.bonuses).toContain("100+ yard rushing game: +3");
    expect(v.scoring.defenseBuckets[0]?.lines.map((l) => l.range)).toEqual(["0", "1–6", "7–34", "35+"]);
    expect(v.glance.find((t) => t.id === "starters")?.value).toBe("QB, 2 RB, 2 WR, TE, FLEX, DEF");
    expect(v.glance.find((t) => t.id === "scoring")?.detail).toBe("6-pt passing TD · TE premium +0.5");
  });

  it("reads ESPN's real shapes: FG 0-39 as a per-unit rate on a sum of buckets, and 46+ points allowed as a threshold", () => {
    const scoring: Scoring = {
      perStat: { pass_td: 4, fgm_40_49: 4 },
      rules: [
        { kind: "perUnit", stat: { sum: ["fgm_0_19", "fgm_20_29", "fgm_30_39"] }, points: 3 },
        { kind: "range", stat: "pts_allow", min: 35, max: 45, points: -5, positions: ["DEF"] },
        { kind: "threshold", stat: "pts_allow", min: 46, points: -7, positions: ["DEF"] },
        { kind: "perUnit", stat: { sum: ["pass_yd", "rush_yd"] }, points: 0.02 },
        { kind: "perUnit", stat: { sum: ["rec_fd", "rec_td"] }, points: 1, positions: ["WR", "TE"] },
      ],
      unmapped: [],
    };
    const v = buildImportReport(response(snapshot({}, { scoring })), { timeZone: TZ });
    // Plain per-unit rates on a sum of stats are rates, listed with the other rates, not bonuses.
    expect(v.scoring.bonuses).toEqual([]);
    const rows = v.scoring.allRules.map((r) => [r.label, r.value]);
    expect(rows).toContainEqual(["Field goals made (0–39 yds)", "3"]);
    expect(rows).toContainEqual(["Passing yards + rushing yards", "0.02"]);
    expect(rows).toContainEqual(["Receiving first downs + receiving TDs (WR, TE only)", "1"]);
    // Kicking rows sit together: the 0–39 sum next to the 40–49 rate.
    const labels = v.scoring.allRules.map((r) => r.label);
    expect(Math.abs(labels.indexOf("Field goals made (0–39 yds)") - labels.indexOf("Field goals made (40–49 yds)"))).toBe(1);
    expect(new Set(v.scoring.allRules.map((r) => r.key)).size).toBe(v.scoring.allRules.length);
    expect(v.scoring.defenseBuckets[0]?.lines.map((l) => l.text)).toEqual(["35–45 points allowed: −5", "46+ points allowed: −7"]);
  });

  it("labels standard scoring", () => {
    const snap = snapshot({}, { scoring: { perStat: { pass_td: 4 }, rules: [], unmapped: [] } });
    expect(buildImportReport(response(snap), { timeZone: TZ }).scoring.formatLabel).toBe("Standard (no points per catch)");
  });
});

describe("ruleText", () => {
  it("covers every rule kind", () => {
    expect(ruleText({ kind: "range", stat: "pts_allow", max: 6, points: 4 }, "sleeper")).toBe("Up to 6 points allowed: +4");
    expect(ruleText({ kind: "range", stat: "yds_allow", points: 1 }, "sleeper")).toBe("Any yards allowed: +1");
    expect(ruleText({ kind: "stepped", stat: "pass_yd", every: 25, points: 1 }, "sleeper")).toBe("+1 for every 25 passing yards");
    expect(ruleText({ kind: "perUnit", stat: "rec", points: 0.5, positions: ["TE"] }, "sleeper")).toBe("+0.5 per reception (TE only)");
    expect(ruleText({ kind: "threshold", stat: { sum: ["rush_yd", "rec_yd"] }, min: 150, points: 3 }, "espn")).toBe("150+ rushing yards + receiving yards in a game: +3");
    expect(ruleText({ kind: "perGame", points: -1, positions: ["DEF"] }, "espn")).toBe("−1 per game played (D/ST only)");
  });
});

describe("buildImportReport: lineup, season and trades", () => {
  it("shows roster rules and limits", () => {
    const v = buildImportReport(response(snapshot({}, { starterLimits: { QB: { min: 1, max: 2 } }, rosterMinimums: { K: 1 } })), { timeZone: TZ });
    expect(v.lineup.starters[5]).toEqual({ slot: "D/ST", count: 1, eligible: "D/ST" });
    expect(v.lineup.starters[4]).toEqual({ slot: "FLEX", count: 1, eligible: "RB/WR/TE" });
    expect(v.lineup.limits).toEqual([
      { label: "Most players allowed per position", value: "QB 4 · K 3" },
      { label: "Starters per position", value: "QB 1–2" },
      { label: "Roster minimums", value: "K 1" },
    ]);
  });

  it("describes the season, playoffs and seeding", () => {
    const v = buildImportReport(response(snapshot()), { timeZone: TZ });
    expect(v.season).toMatchObject({
      regularSeason: "Weeks 1–14 (14 weeks)",
      playoffs: "Weeks 15–17",
      playoffTeams: 4,
      byes: "No byes",
      medianGame: false,
      pointsOnly: false,
      divisions: [],
    });
    expect(v.season.seeding).toMatch(/^Not reported/);
    expect(v.season.rounds).toBeUndefined();
    // No tiebreaker in the snapshot (e.g. one stored before Phase 3): the simulator's points for.
    expect(v.season.tiebreaker).toBe("Unknown (points for assumed)");

    const v2 = buildImportReport(
      response(
        snapshot({}, {
          playoffByes: 2,
          playoffRoundWeeks: [1, 2],
          playoffSeeding: { reseed: true, divisionWinnersFirst: true },
          seedingTiebreaker: "headToHead",
          divisions: [
            { id: "a", teamIds: ["1", "2"] },
            { id: "b", teamIds: ["3", "4"] },
          ],
        }),
      ),
      { timeZone: TZ },
    );
    expect(v2.season.byes).toBe("2 byes for the top seeds");
    expect(v2.season.rounds).toBe("Rounds last 1, 2 weeks");
    expect(v2.season.seeding).toBe("Re-seeded after each round; division winners are seeded first");
    expect(v2.season.tiebreaker).toBe("Head-to-head record");
    expect(v2.season.divisions).toEqual([
      { name: "Division 1", teams: ["Moonbeam Mudcats", "Gravel Gophers"] },
      { name: "Division 2", teams: ["Quasar Quokkas", "Tundra Tortoises"] },
    ]);
    expect(v2.teams.rows.find((r) => r.id === "3")?.division).toBe("Division 2");
  });

  it("names how ties in the standings are broken (§8): the league's own tiebreaker, else unknown with points for assumed", () => {
    const tiebreaker = (extra: Partial<LeagueSettings>) => buildImportReport(response(snapshot({}, extra)), { timeZone: TZ }).season.tiebreaker;
    expect(tiebreaker({ seedingTiebreaker: "pointsFor" })).toBe("Points for");
    expect(tiebreaker({ seedingTiebreaker: "headToHead" })).toBe("Head-to-head record");
    expect(tiebreaker({ seedingTiebreaker: "divisionRecord" })).toBe("Division record");
    // A rule the platform doesn't report (ESPN: missing or UNKNOWN) or one we don't model: unknown.
    expect(tiebreaker({ unknownSettings: ["seedingTiebreaker"] })).toBe("Unknown (points for assumed)");
    const v = buildImportReport(response(snapshot({}, { unknownSettings: ["seedingTiebreaker"] })), { timeZone: TZ });
    expect(v.unknown).toEqual(["seedingTiebreaker"]);
    // Not a trade or playoff setting: those tiles stay as they are.
    expect(v.glance.find((t) => t.id === "deadline")?.tone).toBe("normal");
    expect(v.glance.find((t) => t.id === "playoffs")?.tone).toBe("normal");
  });

  it("describes the trade deadline, review and FAAB", () => {
    const v = buildImportReport(response(snapshot()), { timeZone: TZ });
    // The made-up league reports no waiver ranks or budgets (the waiver order's own tests are below).
    const notReported = "Not reported (the team that gains the most picks first)";
    // Every team has a transaction this season (the inactive teams' own tests are below).
    const inactive = { lines: [], note: "None: every team has made a transaction this season." };
    expect(v.trades).toEqual({ deadline: "Wed, Dec 2, 2026, 12:00 PM EST (week 13)", review: "League vote: managers can veto trades", faab: "No FAAB budget reported", waiverOrder: notReported, inactive });
    const none = buildImportReport(response(snapshot({}, { tradeDeadline: null, tradeReview: "none", faabBudget: 100 })), { timeZone: TZ });
    expect(none.trades).toEqual({ deadline: "No trade deadline", review: "No review: accepted trades go through", faab: "$100 FAAB budget", waiverOrder: notReported, inactive });
    const weekOnly = buildImportReport(response(snapshot({}, { tradeDeadline: { week: 11 } })), { timeZone: TZ });
    expect(weekOnly.trades.deadline).toBe("Week 11");
    expect(weekOnly.glance.find((t) => t.id === "deadline")?.value).toBe("Week 11");
  });

  it("the inactive teams (Phase 7a; planner reply to Checkpoint 4c, A4): the engine's own list, one line each in the planner's words, and the rule", () => {
    const inactive = (snap: LeagueSnapshot, myTeamId?: string) => buildImportReport(response(snap), { timeZone: TZ, ...(myTeamId ? { myTeamId } : {}) }).trades.inactive;
    const base = snapshot();
    // Team 4's only transaction gone: it made none this season (week 4, fewer weeks than the rule's 5), so it's inactive.
    const no4 = { ...base, transactions: base.transactions.filter((t) => !t.teams.includes("4")) };
    expect(inactive(no4)).toEqual({ lines: ["Tundra Tortoises: inactive, no pickups assumed."], note: "No transactions this season, so we assume it makes no free-agent pickups." });
    // The engine's rule word for word (acceptance.inactiveTeams, as league.ts reads it).
    expect(inactiveTeams(no4, "1", config.allocation.inactiveWeeks)).toEqual(["4"]);
    // My team is never inactive (the user is acting): mine without a transaction, Team 2 listed alone.
    const only34 = { ...base, transactions: base.transactions.filter((t) => !t.teams.includes("1")) };
    expect(inactive(only34).lines).toEqual(["Gravel Gophers: inactive, no pickups assumed."]);
    expect(inactive(only34, "2").lines).toEqual(["Moonbeam Mudcats: inactive, no pickups assumed."]);
    // Later in the season the window is the last 5 weeks: at week 9, transactions from weeks 2–3 are too old for anyone. Mine
    // made none either: it still counts as active, and the note says so (review of track AL, finding AL-4).
    expect(inactive({ ...base, currentWeek: 9 })).toEqual({
      lines: ["Gravel Gophers: inactive, no pickups assumed.", "Quasar Quokkas: inactive, no pickups assumed.", "Tundra Tortoises: inactive, no pickups assumed."],
      note: "No transactions in the last 5 weeks, so we assume they make no free-agent pickups. Your team hasn't made one either, but yours always counts as active.",
    });
    // Sleeper's league week, when it has one, numbers the transactions: league week 7 keeps weeks 3 and later in the window
    // (Team 2's week-2 trade falls out), league week 6 weeks 2 and later (everyone in).
    expect(inactive({ ...base, currentWeek: 9, leagueWeek: 7 }).lines).toEqual(["Gravel Gophers: inactive, no pickups assumed."]);
    expect(inactive({ ...base, currentWeek: 9, leagueWeek: 6 })).toEqual({ lines: [], note: "None: every team has made a transaction in the last 5 weeks." });
    // No transaction at all: the league can't tell its teams apart, so nobody is assumed inactive (⚠️ ours).
    expect(inactive({ ...base, transactions: [] })).toEqual({ lines: [], note: "None assumed: this league shows no transactions this season, so every team is assumed to make its free-agent pickups." });
  });

  it("⚠️ says why nobody is inactive when the transactions can't tell (review of track AL, finding AL-1), and never that every team moved when mine didn't (AL-4)", () => {
    const inactive = (snap: LeagueSnapshot, myTeamId?: string) => buildImportReport(response(snap), { timeZone: TZ, ...(myTeamId ? { myTeamId } : {}) }).trades.inactive;
    const base = snapshot();
    const no4 = { ...base, transactions: base.transactions.filter((t) => !t.teams.includes("4")) };
    expect(inactive(no4).lines).toEqual(["Tundra Tortoises: inactive, no pickups assumed."]);
    // A week's transactions didn't load (the ESPN fetch's warning): Team 4's moves may be in it, so nobody is assumed inactive.
    const missing = { ...no4, warnings: [...no4.warnings, { code: "ESPN_TRANSACTIONS_UNAVAILABLE", message: "ESPN didn't return every week's transactions, so trade and activity history may be incomplete (HTTP 503).", platformPath: "view=mTransactions2&scoringPeriodId=3" }] };
    expect(inactive(missing)).toEqual({
      lines: [],
      note: "None assumed: some of this league's transactions didn't load or couldn't be read, so we can't tell which teams have been inactive, and every team is assumed to make its free-agent pickups.",
    });
    expect(inactiveTeams(missing, "1", config.allocation.inactiveWeeks)).toEqual([]);
    // A trade this season listed without one of its teams (ESPN: its other side unknown): it may be Team 4's.
    const partnerless = { ...no4, transactions: [...no4.transactions, { id: "t9", type: "trade" as const, week: 4, timestamp: "2026-09-28T00:00:00Z", teams: ["3"], moves: [] }] };
    expect(inactive(partnerless)).toEqual({
      lines: [],
      note: "None assumed: a trade this season came back without one of its teams, so we can't tell which teams have been inactive, and every team is assumed to make its free-agent pickups.",
    });
    // Every other team moved but mine didn't: mine always counts as active, so the note doesn't claim every team moved.
    const mineQuiet = { ...base, transactions: [...base.transactions.filter((t) => !t.teams.includes("1")), { id: "t5", type: "drop" as const, week: 4, timestamp: "2026-09-28T00:00:00Z", teams: ["2"], moves: [{ playerId: "9004", from: "2", to: null }] }] };
    expect(inactive(mineQuiet)).toEqual({ lines: [], note: "None: every other team has made a transaction this season (yours always counts as active)." });
    // Picked as another team, Team 1 is judged like the rest (inactive), and the picked team made a move.
    expect(inactive(mineQuiet, "2")).toEqual({ lines: ["Moonbeam Mudcats: inactive, no pickups assumed."], note: "No transactions this season, so we assume it makes no free-agent pickups." });
    // Without a team of mine, there's nobody to except.
    expect(inactive({ ...mineQuiet, myTeamId: null }).lines).toEqual(["Moonbeam Mudcats: inactive, no pickups assumed."]);
  });

  it("the waiver order used, worded by the order free agents are handed out in (Phase 4c; planner reply to Checkpoint 4b, change 5)", () => {
    const ranked = (extra: (id: string) => Partial<Team> = () => ({})) => snapshot().teams.map((t, i) => ({ ...t, waiverRank: i + 1, ...extra(t.id) }));
    const text = (teams: Team[], settings: Partial<LeagueSettings> = {}, warnings: LeagueSnapshot["warnings"] = []) => buildImportReport(response(snapshot({ teams, warnings }, settings)), { timeZone: TZ }).trades.waiverOrder;
    expect(text(ranked(), { waiverOrderUsed: "weeklyReset" })).toBe("Weekly reset (reverse standings)");
    expect(text(ranked(), { waiverOrderUsed: "live" })).toBe("Live order (rolling waivers)");
    // ⚠️ A commissioner's edit lasts until the next weekly reset (ESPN keeps the reset order then): the row says so.
    expect(text(ranked(), { waiverOrderUsed: "weeklyReset" }, [{ code: "ESPN_WAIVER_ORDER_EDITED", message: "…" }])).toBe("Weekly reset (reverse standings; the commissioner's edited order lasts until the reset)");
    for (const code of ["ESPN_WAIVER_RESET_UNKNOWN", "WAIVER_TYPE_UNKNOWN"]) expect(text(ranked(), { waiverOrderUsed: "live" }, [{ code, message: "…" }])).toBe("Live order (the league doesn't say whether it resets weekly)");
    // A league that resets weekly but hasn't played a game has no standings to reset to: its adapter's warning says so. A
    // rolling league's order is live before its first game too, for the usual reason.
    const fresh = ranked(() => ({ record: { w: 0, l: 0, t: 0 }, pointsFor: 0 }));
    for (const code of ["ESPN_WAIVER_RESET_BEFORE_GAMES", "WAIVER_RESET_BEFORE_GAMES"]) expect(text(fresh, { waiverOrderUsed: "live" }, [{ code, message: "…" }])).toBe("Live order (no games played yet)");
    expect(text(fresh, { waiverOrderUsed: "live" })).toBe("Live order (rolling waivers)");
    // A platform that ranks every team without saying which order it is.
    expect(text(ranked())).toBe("The league's waiver order");
    // FAAB: the budgets, when every team reports one; else the ranks, saying which budget is missing; else neither.
    const budgets = ranked((id) => ({ faabRemaining: Number(id) * 10 }));
    expect(text(budgets, { faabBudget: 100, waiverOrderUsed: "faab" })).toBe("FAAB budget left (the most left picks first)");
    expect(text(ranked((id) => (id === "2" ? {} : { faabRemaining: 50 })), { faabBudget: 100, waiverOrderUsed: "faab" })).toBe("Waiver order (not every team's FAAB budget was reported)");
    expect(text(budgets, { waiverOrderUsed: "faab" })).toBe("Waiver order (the league's FAAB budget wasn't reported)");
    // A FAAB league whose ties go by the weekly reset order (ESPN, order reset weekly: the live rank kept apart) says so.
    const resetTies = (teams: Team[]) => teams.map((t) => ({ ...t, liveWaiverRank: 5 - (t.waiverRank as number) }));
    expect(text(resetTies(budgets), { faabBudget: 100, waiverOrderUsed: "faab" })).toBe("FAAB budget left (the most left picks first; ties by the weekly reset order)");
    expect(text(resetTies(ranked((id) => (id === "2" ? {} : { faabRemaining: 50 }))), { faabBudget: 100, waiverOrderUsed: "faab" })).toBe("Weekly reset order (not every team's FAAB budget was reported)");
    expect(text(resetTies(budgets), { waiverOrderUsed: "faab" })).toBe("Weekly reset order (the league's FAAB budget wasn't reported)");
    // No order at all: the biggest gain first.
    const unranked = snapshot().teams.map((t, i) => (i === 1 ? t : { ...t, waiverRank: i + 1 }));
    expect(text(unranked, { waiverOrderUsed: "live" })).toBe("Not reported (the team that gains the most picks first)");
    expect(text(snapshot().teams, {}, [{ code: "ESPN_NO_WAIVERS", message: "…" }])).toBe("None, free agency: the team that gains the most picks first");
  });

  it("the row's basis is the engine's (src/engine/league.ts allocationOrder) on any mix of ranks and budgets", () => {
    const values = [undefined, 0, 1, 2, 2.5, -1, Number.NaN, 7] as const;
    let seed = 7;
    const pick = () => {
      seed = (seed * 48271) % 2147483647;
      return values[seed % values.length];
    };
    for (let k = 0; k < 400; k++) {
      const teams = snapshot().teams.map((t) => {
        const waiverRank = pick();
        const faabRemaining = pick();
        return { ...t, ...(waiverRank !== undefined ? { waiverRank } : {}), ...(faabRemaining !== undefined ? { faabRemaining } : {}) };
      });
      for (const faabBudget of [undefined, 100]) {
        const snap = snapshot({ teams }, faabBudget !== undefined ? { faabBudget } : {});
        expect(allocationBasis(snap), `case ${k}`).toBe(allocationOrder(snap.teams, snap.settings.faabBudget !== undefined, () => 0).basis);
      }
    }
    expect(allocationBasis(snapshot({ teams: [] }, { faabBudget: 100 }))).toBe(allocationOrder([], true, () => 0).basis);
  });

  it("the adapters' waiver warning codes are the ones the row reads", () => {
    expect(WAIVER_WARNING_CODES.noWaivers).toBe(ESPN_WAIVER_CODES.noWaivers);
    expect(WAIVER_WARNING_CODES.edited).toBe(ESPN_WAIVER_CODES.edited);
    expect([...WAIVER_WARNING_CODES.resetUnknown]).toEqual([ESPN_WAIVER_CODES.resetUnknown, SLEEPER_WAIVER_TYPE_UNKNOWN]);
    expect([...WAIVER_WARNING_CODES.beforeGames]).toEqual([ESPN_WAIVER_CODES.beforeGames, SLEEPER_WAIVER_RESET_BEFORE_GAMES]);
  });

  it("the row for leagues as their adapters read them: Parker's ESPN league (weekly reset), the Sleeper test league (rolling; reverse standings)", () => {
    type EspnJson = { teams: { record: { overall: Record<string, number> } }[]; settings: { acquisitionSettings: Record<string, unknown> }; status: Record<string, unknown> };
    const espn = (edit: (league: EspnJson) => void = () => {}) => {
      const bundle = parkerBundle();
      edit(bundle.league as EspnJson);
      return buildImportReport(normalizeEspnLeague(bundle, { leagueId: ESPN_PARKER.leagueId, resolver: espnResolver(), now: new Date("2026-09-29T20:00:00Z"), swid: ESPN_PARKER.swid }), { timeZone: TZ }).trades.waiverOrder;
    };
    // Before week 1: every record 0-0, no points.
    const espnFresh = (league: EspnJson) => league.teams.forEach((t) => Object.assign(t.record.overall, { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }));
    expect(espn()).toBe("Weekly reset (reverse standings)");
    expect(espn(espnFresh)).toBe("Live order (no games played yet)");
    expect(
      espn((league) => {
        espnFresh(league);
        league.settings.acquisitionSettings.waiverOrderReset = false;
      }),
    ).toBe("Live order (rolling waivers)");
    // ⚠️ A commissioner's edit: the reset order still, said so.
    expect(espn((league) => (league.status.isWaiverOrderEdited = true))).toBe("Weekly reset (reverse standings; the commissioner's edited order lasts until the reset)");
    // As a FAAB league: every team's budget left (Parker's league has spent none), ties by the weekly reset order (its order
    // resets weekly); without the league's budget, that order alone.
    expect(espn((league) => Object.assign(league.settings.acquisitionSettings, { isUsingAcquisitionBudget: true }))).toBe("FAAB budget left (the most left picks first; ties by the weekly reset order)");
    expect(
      espn((league) => {
        Object.assign(league.settings.acquisitionSettings, { isUsingAcquisitionBudget: true });
        delete league.settings.acquisitionSettings.acquisitionBudget;
      }),
    ).toBe("Weekly reset order (the league's FAAB budget wasn't reported)");
    // A FAAB league whose order doesn't reset weekly: its ties go by ESPN's live rank, so the row doesn't name one.
    expect(espn((league) => Object.assign(league.settings.acquisitionSettings, { isUsingAcquisitionBudget: true, waiverOrderReset: false }))).toBe("FAAB budget left (the most left picks first)");
    const sleeper = (waiverType: number, edit: (t: TestLeague) => void = () => {}) => {
      const t = loadTestLeague();
      t.league.settings.waiver_type = waiverType;
      // Made-up positions (the minimized fixture keeps none).
      t.rosters.forEach((r) => Object.assign(r.settings, { waiver_position: 13 - r.roster_id }));
      edit(t);
      return buildImportReport(normalizeSleeperLeague(rawOf(t), { now: new Date("2026-09-29T18:00:00Z"), resolver: fakeResolver(t.players) }), { timeZone: TZ }).trades.waiverOrder;
    };
    const sleeperFresh = (t: TestLeague) => t.rosters.forEach((r) => Object.assign(r.settings, { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 }));
    expect(sleeper(0)).toBe("Live order (rolling waivers)");
    expect(sleeper(0, sleeperFresh)).toBe("Live order (rolling waivers)");
    expect(sleeper(1)).toBe("Weekly reset (reverse standings)");
    expect(sleeper(1, sleeperFresh)).toBe("Live order (no games played yet)");
    expect(sleeper(9)).toBe("Live order (the league doesn't say whether it resets weekly)");
    // FAAB with the league's budget but no team's amount used (the minimized fixture keeps none): the positions, said so.
    expect(sleeper(2, (t) => Object.assign(t.league.settings, { waiver_budget: 100 }))).toBe("Waiver order (not every team's FAAB budget was reported)");
    // FAAB without the league's budget (never seen): the positions, saying it's the league's budget that's missing.
    expect(
      sleeper(2, (t) => {
        delete (t.league.settings as Record<string, unknown>).waiver_budget;
      }),
    ).toBe("Waiver order (the league's FAAB budget wasn't reported)");
  });

  it("notes best ball", () => {
    const v = buildImportReport(response(snapshot({}, { bestBall: true, leagueType: "dynasty", taxiSlots: 3 })), { timeZone: TZ });
    expect(v.league.bestBall).toBe(true);
    expect(v.lineup.bestBall).toBe(true);
    expect(v.glance.find((t) => t.id === "league")).toMatchObject({ value: "4 teams · Dynasty", detail: "Best ball" });
    expect(v.glance.find((t) => t.id === "roster")?.value).toBe("7 bench · 1 IR · 3 taxi");
  });
});

describe("buildImportReport: teams and my team", () => {
  it("ranks teams by record, then points for", () => {
    const v = buildImportReport(response(snapshot()), { timeZone: TZ });
    expect(v.teams.rows.map((r) => [r.rank, r.name, r.record, r.pointsFor])).toEqual([
      [1, "Gravel Gophers", "3–0", "330"],
      [2, "Quasar Quokkas", "2–1", "360.5"],
      [3, "Moonbeam Mudcats", "2–1", "350.3"],
      [4, "Tundra Tortoises", "0–3", "280"],
    ]);
    expect(v.teams.rows.find((r) => r.isMine)?.name).toBe("Moonbeam Mudcats");
    expect(v.teams.rows.find((r) => r.id === "1")).toMatchObject({ owner: "Zorblax Quintavious", rosterCount: 2, irCount: 1 });
    expect(v.teams.options.map((o) => o.name)).toEqual(["Gravel Gophers", "Moonbeam Mudcats", "Quasar Quokkas", "Tundra Tortoises"]);
  });

  it("lets the user's own pick win, and ignores a pick that isn't a team here", () => {
    const picked = buildImportReport(response(snapshot()), { timeZone: TZ, myTeamId: "4" });
    expect(picked.teams).toMatchObject({ myTeamId: "4", myTeamSource: "you" });
    expect(picked.glance.find((t) => t.id === "myTeam")).toMatchObject({ value: "Tundra Tortoises", detail: "Picked by you" });

    const same = buildImportReport(response(snapshot()), { timeZone: TZ, myTeamId: "1" });
    expect(same.teams.myTeamSource).toBe("platform");

    const bogus = buildImportReport(response(snapshot()), { timeZone: TZ, myTeamId: "99" });
    expect(bogus.teams.myTeamId).toBe("1");
  });

  it("asks the user to pick when the platform couldn't tell", () => {
    const v = buildImportReport(response(snapshot({ myTeamId: null })), { timeZone: TZ });
    expect(v.teams).toMatchObject({ myTeamId: null, myTeamSource: "none" });
    expect(v.teams.explain).toMatch(/^We couldn't tell which team is yours/);
    expect(v.glance.find((t) => t.id === "myTeam")).toMatchObject({ value: "Not picked yet", tone: "warn" });
    expect(v.schedule.thisWeek).toBeUndefined();
  });

  it("marks the platform's team in the picker", () => {
    const v = buildImportReport(response(snapshot()), { timeZone: TZ });
    expect(v.teams.options.find((o) => o.id === "1")).toEqual({ id: "1", name: "Moonbeam Mudcats", note: "found by ESPN" });
    expect(v.teams.options.find((o) => o.id === "2")).toEqual({ id: "2", name: "Gravel Gophers" });
    expect(v.teams.explain).toBe("ESPN told us which team is yours. You can change it here if that's wrong.");
  });

  it("shows a team from a pasted link as a guess to check, never as found by ESPN", () => {
    const v = buildImportReport(response(snapshot({ myTeamId: null })), { timeZone: TZ, myTeamId: "3", myTeamSource: "link" });
    expect(v.teams).toMatchObject({ myTeamId: "3", myTeamSource: "link" });
    expect(v.teams.explain).toMatch(/from the ESPN link you pasted.*check that it's yours/);
    const tile = v.glance.find((t) => t.id === "myTeam");
    expect(tile).toMatchObject({ value: "Quasar Quokkas", detail: "From your link — check it", tone: "warn" });
    expect(JSON.stringify(v)).not.toMatch(/Found by ESPN|found by ESPN/);
    expect(v.teams.options.find((o) => o.id === "3")?.note).toBe("from your link");
    expect(v.schedule.thisWeek).toBe("Week 4: vs Moonbeam Mudcats");
  });

  it("lets the platform's team (ESPN cookies) beat a link guess, but not the user's own pick", () => {
    const linkGuess = buildImportReport(response(snapshot()), { timeZone: TZ, myTeamId: "3", myTeamSource: "link" });
    expect(linkGuess.teams).toMatchObject({ myTeamId: "1", myTeamSource: "platform" });
    const ownPick = buildImportReport(response(snapshot()), { timeZone: TZ, myTeamId: "3", myTeamSource: "you" });
    expect(ownPick.teams).toMatchObject({ myTeamId: "3", myTeamSource: "you" });
  });
});

describe("buildImportReport: settings the platform doesn't expose", () => {
  const unknownAll = snapshot({}, { unknownSettings: ["seedingTiebreaker", "tradeDeadline", "tradeReview", "playoffs", "playoffSeeding"], tradeDeadline: null, seedingTiebreaker: "pointsFor" });

  it("shows them as unknown, in the warn tone, instead of a guess such as 'No trade deadline'", () => {
    const v = buildImportReport(response(unknownAll), { timeZone: TZ });
    expect(v.unknown).toEqual(["tradeDeadline", "tradeReview", "playoffs", "playoffSeeding", "seedingTiebreaker"]);
    // unknownSettings wins over a tiebreaker value next to it (never shown as a fact).
    expect(v.season.tiebreaker).toBe("Unknown (points for assumed)");
    expect(v.trades.deadline).toBe(UNKNOWN_SETTING_TEXT);
    expect(v.trades.review).toBe(UNKNOWN_SETTING_TEXT);
    expect(JSON.stringify(v)).not.toContain("No trade deadline");
    expect(v.glance.find((t) => t.id === "deadline")).toMatchObject({ value: "Unknown", detail: "Review unknown — check your league's settings", tone: "warn" });
    expect(v.glance.find((t) => t.id === "playoffs")).toMatchObject({ value: "Unknown", detail: "Check your league's settings", tone: "warn" });
    expect(v.season).toMatchObject({ playoffs: UNKNOWN_SETTING_TEXT, playoffTeamsText: UNKNOWN_SETTING_TEXT, byes: UNKNOWN_SETTING_TEXT });
    expect(v.season.seeding).toBe("Unknown — check your league's settings. We'll assume standard seeding: a fixed bracket (no re-seeding), seeded by record.");
  });

  it("keeps the assumed seeding free of a tiebreaker, so it can't contradict the league's own (ESPN: re-seeding unknown, H2H_RECORD)", () => {
    const season = (extra: Partial<LeagueSettings>) => buildImportReport(response(snapshot({}, extra)), { timeZone: TZ }).season;
    // What ESPN's normalizer gives for playoffReseed missing and playoffSeedingRule H2H_RECORD.
    const h2h = season({ unknownSettings: ["playoffSeeding"], seedingTiebreaker: "headToHead" });
    expect(h2h.seeding).toBe("Unknown — check your league's settings. We'll assume standard seeding: a fixed bracket (no re-seeding), seeded by record.");
    expect(h2h.tiebreaker).toBe("Head-to-head record");
    expect(h2h.seeding).not.toMatch(/points for/i);
    // Not reported at all (Sleeper without playoff_seed_type), and a points-only league (seeded by points).
    expect(season({ seedingTiebreaker: "divisionRecord" }).seeding).toBe("Not reported by the platform. We'll assume standard seeding: a fixed bracket (no re-seeding), seeded by record.");
    expect(season({ pointsOnly: true, unknownSettings: ["playoffSeeding"] }).seeding).toBe("Unknown — check your league's settings. We'll assume standard seeding: a fixed bracket (no re-seeding), seeded by points for.");
  });

  it("marks only the unknown ones", () => {
    const v = buildImportReport(response(snapshot({}, { unknownSettings: ["tradeDeadline"], tradeDeadline: null })), { timeZone: TZ });
    expect(v.unknown).toEqual(["tradeDeadline"]);
    expect(v.trades.review).toBe("League vote: managers can veto trades");
    expect(v.glance.find((t) => t.id === "deadline")).toMatchObject({ value: "Unknown", detail: "Check your league's settings · League vote: managers can veto trades", tone: "warn" });
    expect(v.glance.find((t) => t.id === "playoffs")).toMatchObject({ value: "4 teams", tone: "normal" });
    expect(v.season.playoffTeamsText).toBe("4");

    const known = buildImportReport(response(snapshot()), { timeZone: TZ });
    expect(known.unknown).toEqual([]);
    expect(known.glance.find((t) => t.id === "deadline")?.tone).toBe("normal");
  });
});

describe("buildImportReport: ESPN cookies", () => {
  it("says where the cookies came from, and offers Forget only for this browser session's", () => {
    const session = buildImportReport(response(snapshot(), { usedEspnCookies: true, espnCookieSource: "session" }), { timeZone: TZ });
    expect(session.league).toMatchObject({ cookieNote: "Imported with your ESPN cookies from this browser session.", canForgetEspnCookies: true, espnCookieSource: "session" });

    const dev = buildImportReport(response(snapshot(), { usedEspnCookies: true, espnCookieSource: "dev-env" }), { timeZone: TZ });
    expect(dev.league).toMatchObject({ cookieNote: "Imported with ESPN cookies from .env.local (USE_ENV_COOKIES=1, development only).", canForgetEspnCookies: false });

    const none = buildImportReport(response(snapshot(), { usedEspnCookies: false }), { timeZone: TZ });
    expect(none.league.cookieNote).toBeUndefined();
    expect(none.league.canForgetEspnCookies).toBe(false);

    // Imports stored before the source was reported came from the browser session.
    const older = buildImportReport(response(snapshot(), { usedEspnCookies: true }), { timeZone: TZ });
    expect(older.league).toMatchObject({ cookieNote: "Imported with your ESPN cookies from this browser session.", canForgetEspnCookies: true });
  });
});

describe("refreshOutcomeText", () => {
  const base = { platform: "espn" as const, timeZone: "America/Chicago" };

  it("names the new data's time when Refresh fetched it again", () => {
    expect(refreshOutcomeText({ ...base, before: "2026-09-30T01:55:00.000Z", after: "2026-09-30T02:08:00.000Z", now: new Date("2026-09-30T02:08:01.000Z") })).toBe(
      "Refreshed: ESPN data from 9:08 PM",
    );
  });

  it("says the data is already up to date when the server's copy is under a minute old", () => {
    expect(refreshOutcomeText({ ...base, before: "2026-09-30T02:08:00.000Z", after: "2026-09-30T02:08:00.000Z", now: new Date("2026-09-30T02:08:42.000Z") })).toBe(
      "Already up to date (fetched 42 s ago; Refresh works once a minute)",
    );
    expect(refreshOutcomeText({ ...base, platform: "sleeper", before: "2026-09-30T02:08:00.000Z", after: "2026-09-30T02:08:00.000Z", now: new Date("2026-09-30T02:05:00.000Z") })).toBe(
      "Already up to date (fetched 0 s ago; Refresh works once a minute)",
    );
    expect(refreshOutcomeText({ ...base, before: "2026-09-30T02:00:00.000Z", after: "2026-09-30T02:00:00.000Z", now: new Date("2026-09-30T02:05:00.000Z") })).toBe(
      "Already up to date (fetched 5 min ago; Refresh works once a minute)",
    );
  });
});

describe("buildImportReport: players, schedule, activity, notes and timestamps", () => {
  const v = buildImportReport(
    response(snapshot({ draftPicks: [{ season: 2027, round: 1, originalTeamId: "1", ownerTeamId: "2" }, { season: 2027, round: 2, originalTeamId: "3", ownerTeamId: "3" }] }), {
      dataSources: [
        { name: "Sleeper players", fetchedAt: "2026-09-29T22:00:00.000Z", fromCache: false, available: true },
        { name: "DynastyProcess player IDs", fetchedAt: null, fromCache: true, available: true },
        { name: "FantasyCalc players", fetchedAt: null, available: false, note: "timed out" },
        // A server copy carries its original fetch time (the HTTP cache's storedAt for older entries).
        { name: "Sleeper projections", fetchedAt: "2026-09-29T08:30:00.000Z", fromCache: true, available: true },
      ],
    }),
    { timeZone: TZ },
  );

  it("counts players and flags anyone we couldn't match or describe", () => {
    expect(v.players).toEqual({
      total: 8,
      rostered: 8,
      onIr: 1,
      onTaxi: 0,
      freeAgents: 1,
      unmatched: [{ name: "Pip Wobbleton", pos: "K", team: "FA" }],
      missingDetails: 1,
    });
  });

  it("summarizes the schedule and this week's matchup", () => {
    expect(v.schedule).toEqual({ matchups: 26, weeks: "Weeks 1–13", missingRegularWeeks: [14], thisWeek: "Week 4: vs Quasar Quokkas", results: "None yet" });
  });

  it("names the weeks with final scores, and counts every week of a multi-week matchup (ESPN periods)", () => {
    const decided = (week: number, a: string, b: string) => ({ week, teamA: a, teamB: b, isPlayoff: false, result: { pointsA: 101.5, pointsB: 99, winnerId: a } });
    const schedule: LeagueSnapshot["schedule"] = [
      decided(1, "1", "2"),
      decided(1, "3", "4"),
      decided(2, "1", "3"),
      decided(2, "2", "4"),
      // Week 3 isn't final yet; weeks 3–4 are one matchup period, listed once in week 3.
      { week: 3, teamA: "1", teamB: "4", isPlayoff: false, weeks: [3, 4] },
      { week: 3, teamA: "2", teamB: "3", isPlayoff: false, weeks: [3, 4] },
      ...[5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((w) => ({ week: w, teamA: "1", teamB: "2", isPlayoff: false })),
    ];
    const v = buildImportReport(response(snapshot({ schedule })), { timeZone: TZ });
    expect(v.schedule).toEqual({ matchups: 16, weeks: "Weeks 1–14", missingRegularWeeks: [], thisWeek: "Week 4: vs Tundra Tortoises (weeks 3 + 4)", results: "Weeks 1–2" });
  });

  it("counts trades, players added and dropped (an add/drop pair counts both; a waiver claim is an add), and traded picks", () => {
    expect(v.activity).toEqual({ trades: 1, adds: 2, drops: 2, waivers: 1, tradedPicks: 1 });
  });

  it("passes every warning and note through", () => {
    expect(v.warnings).toEqual([{ code: "ESPN_TQB", message: "Team QB mapped to QB.", platformPath: "players[].defaultPositionId" }]);
    expect(v.notes).toEqual(["Rosters include 1 player on IR."]);
  });

  it("shows when each data source was fetched", () => {
    expect(v.timestamps).toEqual([
      { label: "League data from ESPN", value: "Tue, Sep 29, 2026, 7:00 PM EDT" },
      { label: "Sleeper players", value: "Tue, Sep 29, 2026, 6:00 PM EDT" },
      { label: "DynastyProcess player IDs", value: "Our saved copy (fetch time not recorded)" },
      { label: "FantasyCalc players", value: "Unavailable: timed out" },
      { label: "Sleeper projections", value: "Tue, Sep 29, 2026, 4:30 AM EDT" },
    ]);
  });
});

describe("buildImportReport: trade values (§2.9, §14: a substituted FantasyCalc format)", () => {
  it("names the league's FantasyCalc format, with no notes when FantasyCalc has it exactly", () => {
    const plain = snapshot({}, { numTeams: 10, scoring: { ...espnScoring, byPosition: { DEF: espnScoring.byPosition?.DEF ?? {} } } });
    const v = buildImportReport(response(plain), { timeZone: TZ });
    expect(v.values).toEqual({ text: "FantasyCalc · 10 teams · half-PPR · 1 QB · redraft", formats: ["10 teams · half-PPR · 1 QB · redraft"] });
    expect(v.valueNotes).toEqual([]);
  });

  it("notes every substitution (here: 4 teams, and the TE premium), apart from the platform's notes", () => {
    const v = buildImportReport(response(snapshot()), { timeZone: TZ });
    expect(v.values.text).toBe("FantasyCalc · 8 teams · half-PPR · 1 QB · redraft · TE+");
    expect(v.valueNotes).toEqual(fantasyCalcFormat(snapshot().settings).substitutions.map((s) => `Trade values: ${s}.`));
    expect(v.valueNotes[0]).toBe("Trade values: 4 teams → FantasyCalc's 8-team values.");
    expect(v.notes).toEqual(["Rosters include 1 player on IR."]);
  });

  it("uses dynasty values for the long term and redraft values for this season in keeper leagues, listing shared notes once", () => {
    const v = buildImportReport(response(snapshot({}, { leagueType: "keeper" })), { timeZone: TZ });
    expect(v.values.formats).toEqual(["8 teams · half-PPR · 1 QB · dynasty · TE+", "8 teams · half-PPR · 1 QB · redraft · TE+"]);
    expect(v.values.text).toBe("FantasyCalc · 8 teams · half-PPR · 1 QB · dynasty · TE+ (long-term), plus redraft values for this season");
    expect(v.valueNotes.filter((n) => n.includes("4 teams"))).toHaveLength(1);
    expect(v.valueNotes.some((n) => n.includes("dynasty values for long-term worth"))).toBe(true);
    expect(v.valueNotes.some((n) => n.includes("redraft values for how managers see a trade"))).toBe(true);
  });
});

describe("buildImportReport: the League page's projection source (§6)", () => {
  function inputs(players: Record<string, PlayerInputs>, extra: Partial<ModelInputs> = {}): ModelInputs {
    return {
      version: 1,
      season: 2026,
      currentWeek: 4,
      lastWeek: 17,
      builtAt: "2026-09-30T02:00:00.000Z",
      nfl: { byeWeek: {}, kickoffs: {} },
      players,
      espnProjections: true,
      market: null,
      sources: [],
      warnings: [],
      notes: [],
      ...extra,
    };
  }
  const notesFor = (model: ModelInputs | null, snap = snapshot()) => buildImportReport(response(snap), { timeZone: TZ, model }).modelNotes;

  it("says nothing until the League page has loaded this league's inputs", () => {
    expect(notesFor(null)).toEqual([]);
    expect(buildImportReport(response(snapshot()), { timeZone: TZ }).modelNotes).toEqual([]);
  });

  it("averages ESPN's projections with Sleeper's only when they agree within 10% on rostered players", () => {
    const agree = inputs({ "9001": { sleeper: { 4: 20 }, espn: { 4: 21 }, actual: {} }, "9004": { sleeper: { 4: 10 }, espn: { 4: 10.5 }, actual: {} }, "9100": { sleeper: { 4: 5 }, espn: { 4: 50 }, actual: {} } });
    expect(notesFor(agree)).toEqual(["Projection source: ESPN's and Sleeper's projections, averaged. They differ by 5% on average in week 4 (2 rostered players), within the 10% we allow."]);
    const disagree = inputs({ "9001": { sleeper: { 4: 20 }, espn: { 4: 30 }, actual: {} }, "9004": { sleeper: { 4: 10 }, espn: { 4: 10 }, actual: {} } });
    expect(notesFor(disagree)).toEqual([
      "Projection source: Sleeper's projections, scored with your league's rules. ESPN's own projections differ from them by 33% on average in week 4 (2 rostered players), more than the 10% we allow, so we don't average them in.",
    ]);
  });

  it("says why ESPN's projections weren't averaged when they're missing", () => {
    expect(notesFor(inputs({ "9001": { sleeper: { 4: 20 }, actual: {} } }, { espnProjections: false }))[0]).toBe("Projection source: Sleeper's projections, scored with your league's rules. ESPN's own projections didn't load, so they aren't averaged in.");
    expect(notesFor(inputs({ "9001": { sleeper: { 4: 20 }, actual: {} } }))[0]).toMatch(/No rostered player had both ESPN's and Sleeper's projection in week 4/);
  });

  it("uses Sleeper's alone in Sleeper leagues, and passes the inputs' own notes through without repeating the format", () => {
    const own = inputs({ "9001": { sleeper: { 4: 20 }, actual: {} } }, { notes: ["FantasyCalc values: 8 teams · half-PPR · 1 QB · redraft · TE+", "FantasyCalc: 4 teams → FantasyCalc's 8-team values", "Sleeper's week 17 projections didn't load."] });
    expect(notesFor(own, snapshot({ platform: "sleeper" }))).toEqual(["Projection source: Sleeper's projections, scored with your league's rules.", "Sleeper's week 17 projections didn't load."]);
  });

  it("names the source that actually loaded, and says nothing about sources once the season is over (review PERF-3)", () => {
    const espnOnly = inputs({ "9001": { sleeper: { 4: null }, espn: { 4: 21 }, actual: {} } });
    expect(notesFor(espnOnly)[0]).toBe("Projection source: ESPN's own league-scored projections. Sleeper's didn't load, so they aren't averaged in.");
    expect(notesFor(inputs({ "9001": { sleeper: {}, actual: { 3: 12 } } }, { espnProjections: false }))[0]).toBe("Projections didn't load from Sleeper, so players are rated on their season so far.");
    expect(notesFor(inputs({ "9001": { sleeper: {}, sleeperSeasonPerGame: 11, actual: {} } }, { espnProjections: false }))[0]).toBe("Projection source: Sleeper's season projections per game, scored with your league's rules (its weekly projections didn't load).");
    expect(notesFor(inputs({ "9001": { sleeper: { 4: 20 }, espn: { 4: 21 }, actual: {} } }, { currentWeek: 18, lastWeek: 17 }))).toEqual([]);
  });
});

describe("buildImportReport: a Sleeper league as its adapter reads it (§8; Sleeper's help center, lead decision D4)", () => {
  const NOW = new Date("2026-09-29T18:00:00Z");
  /** The Import Report of the minimized public test league (no network), after `edit` changes its raw data. */
  const sleeperReport = (edit: (t: TestLeague) => void = () => {}) => {
    const t = loadTestLeague();
    edit(t);
    return buildImportReport(normalizeSleeperLeague(rawOf(t), { now: NOW, resolver: fakeResolver(t.players) }), { timeZone: TZ });
  };
  /** `count` divisions (and, when given, a `playoffTeams`-team playoff; the test league's is 6). */
  const withDivisions = (count: number, playoffTeams?: number) => (t: TestLeague) => {
    t.league.settings.divisions = count;
    if (playoffTeams !== undefined) t.league.settings.playoff_teams = playoffTeams;
    t.rosters.forEach((r) => (r.settings.division = ((r.roster_id - 1) % count) + 1));
  };

  it("shows Sleeper's documented tiebreaker as a fact, with the note that a commissioner can seed by hand", () => {
    const v = sleeperReport();
    expect(v.season.tiebreaker).toBe("Points for");
    expect(v.unknown).toEqual([]);
    expect(v.notes).toContain(
      "Ties in the standings: more points for, then more points against (Sleeper's default tiebreakers, from its help center). A commissioner can also set the playoff seeds by hand, which Sleeper's API doesn't show; Offer Sheet seeds by the standings.",
    );
    expect(v.warnings).toEqual([]);
  });

  it("seeds division winners first: a note where Sleeper documents it (4 divisions; 2 in a 6-team playoff), a warning where it's inferred (3 divisions; 2 in a 4-team playoff)", () => {
    const documented = [
      { v: sleeperReport(withDivisions(2)), note: "Playoff seeding: the 2 division winners take the top seeds, then the other teams by the standings (Sleeper's help center says so for 6-team playoffs with 2 divisions)." },
      { v: sleeperReport(withDivisions(4)), note: "Playoff seeding: the 4 division winners take the top seeds, then the other teams by the standings (Sleeper's help center says so for leagues with 4 divisions)." },
    ];
    for (const { v, note } of documented) {
      expect(v.season.seeding).toBe("Re-seeded after each round; division winners are seeded first");
      expect(v.notes).toContain(note);
      expect(v.warnings).toEqual([]);
      expect(v.glance.find((g) => g.id === "warnings")?.tone).toBe("normal");
    }
    for (const v of [sleeperReport(withDivisions(3)), sleeperReport(withDivisions(2, 4))]) {
      // Still seeded that way (Sleeper documents that every division winner makes the playoffs), but ⚠️.
      expect(v.season.seeding).toBe("Re-seeded after each round; division winners are seeded first");
      expect(v.notes.some((n) => n.startsWith("Playoff seeding:"))).toBe(false);
      expect(v.warnings).toEqual([expect.objectContaining({ code: "SETTING_INFERRED", platformPath: "settings.divisions" })]);
      expect(v.glance.find((g) => g.id === "warnings")?.tone).toBe("warn");
      expect(v.season.tiebreaker).toBe("Points for");
    }
  });

  it("calls the fixed bracket assumed when the league doesn't give its seed type, after the division winners when they're seeded first (as the season simulation reads it: final gate, reviews ADAPT-1, ADAPT-3)", () => {
    const seedType = (code: number | undefined) => (t: TestLeague) => {
      if (code === undefined) delete t.league.settings.playoff_seed_type;
      else t.league.settings.playoff_seed_type = code;
    };
    const both = (...edits: ((t: TestLeague) => void)[]) => (t: TestLeague) => edits.forEach((e) => e(t));
    const divided = sleeperReport(both(withDivisions(2), seedType(undefined)));
    expect(divided.season.seeding).toBe("Not reported by the platform. We'll assume standard seeding: a fixed bracket (no re-seeding), the division winners seeded first, then the other teams by record.");
    expect(sleeperReport(seedType(undefined)).season.seeding).toBe("Not reported by the platform. We'll assume standard seeding: a fixed bracket (no re-seeding), seeded by record.");
    expect(sleeperReport(seedType(4)).season.seeding).toBe("Reported with a code we don't know. We'll assume standard seeding: a fixed bracket (no re-seeding), seeded by record.");
    expect(sleeperReport(both(withDivisions(2), seedType(0))).season.seeding).toBe("Fixed bracket (no re-seeding); division winners are seeded first");
    // ESPN with 2 divisions and no playoffReseed: re-seeding unknown, division winners first (ESPN's documented rule).
    const espnLike = buildImportReport(
      response(
        snapshot({}, {
          unknownSettings: ["playoffSeeding"],
          playoffSeeding: { reseed: false, divisionWinnersFirst: true },
          divisions: [
            { id: "a", teamIds: ["1", "2"] },
            { id: "b", teamIds: ["3", "4"] },
          ],
        }),
      ),
      { timeZone: TZ },
    );
    expect(espnLike.season.seeding).toBe("Unknown — check your league's settings. We'll assume standard seeding: a fixed bracket (no re-seeding), the division winners seeded first, then the other teams by record.");
  });
});
