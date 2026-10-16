/**
 * The plain-language data notices (src/lib/notices.ts; planner reply to Checkpoint 7a, §5.1): every warning code the app's
 * producers write is classified, every notice is plain words, and the conditional ones follow the rules (your roster or a
 * likely starter; a common rule or one that scored this season; a setting that couldn't be read). Every name is made up.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ESPN_READINGS } from "@/adapters/espn/scoringMap";
import type { MarketInputs, ModelInputs, PlayerInputs } from "@/engine/inputs";
import { BLEND_OFF_CURVE_WARNING as ENGINE_BLEND_OFF_CURVE_WARNING, BLEND_OFF_WARNING as ENGINE_BLEND_OFF_WARNING, ODDS_REFUSED_WARNING } from "@/engine/league";
import type { ImportWarning, LeagueSettings, LeagueSnapshot, PlayerInfo } from "@/engine/model";
import {
  BLEND_OFF_CURVE_WARNING,
  BLEND_OFF_WARNING,
  ESPN_COMMON_UNCOUNTED,
  NOTICE_TEXT,
  UNKNOWN_SETTING_NOTICE,
  WARNING_RULES,
  buildDataNotices,
  espnUncountedName,
  modelWarningRule,
  myTeamWarningText,
  quietScoringLine,
  uncountedNoticeText,
  uncountedRules,
  unjudgedText,
  warningRule,
  type NoticeInput,
  type NoticeModel,
} from "./notices";

const ROOT = process.cwd();

/** Every .ts file under `dir` but the tests. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

/**
 * Upper-case literals in the warning producers that aren't warning codes: import errors (LeagueImportError codes), ESPN's
 * own enum values (transaction types, scoring types, bracket tiers, range kinds) and a FantasyCalc pick id.
 */
const NOT_WARNING_CODES = new Set([
  "BAD_CREDENTIALS",
  "BAD_RESPONSE",
  "FP_2027_1",
  "FUTURE_ROSTER",
  "GENERAL_NOT_FOUND",
  "H2H_POINTS",
  "LEAGUE_NOT_FOUND",
  "NOT_ACTIVATED",
  "NO_LEAGUE",
  "PRIVATE_LEAGUE",
  "RANGE_DOUBLE_BOUND",
  "RANGE_LOWER_BOUND",
  "RANGE_UPPER_BOUND",
  "RETRO_ROSTER",
  "SOURCE_DOWN",
  "TOTAL_POINTS",
  "TOTAL_POINTS_SCORED",
  "TRADE_ACCEPT",
  "TRADE_DECLINE",
  "TRADE_ERROR",
  "TRADE_PROPOSAL",
  "TRADE_UPHOLD",
  "TRADE_VETO",
  "UNSUPPORTED_LEAGUE",
  "WAIVER_ERROR",
  "WINNERS_BRACKET",
  "WINNERS_CONSOLATION_LADDER",
  "WIN_BONUS_TOP_HALF",
]);

/** Words a user must never see outside the technical details (§5.1): codes, paths, stat IDs, ID-matching talk, HTTP statuses. */
const NOT_PLAIN = /[A-Z]{2,}_[A-Z0-9_]+|\bstatId\b|\bstat \d+|\bHTTP\b|\[\d*\]|\bsettings\.[a-z]|scoring_settings|player ID|Sleeper id|ESPN id|crosswalk|ID source|\btie-break\b/;

const settings: LeagueSettings = {
  numTeams: 3,
  leagueType: "redraft",
  lineup: [
    { slot: "QB", count: 1, eligible: ["QB"] },
    { slot: "WR", count: 1, eligible: ["WR"] },
    { slot: "TE", count: 1, eligible: ["TE"] },
    { slot: "K", count: 1, eligible: ["K"] },
  ],
  benchSlots: 3,
  irSlots: 1,
  taxiSlots: 0,
  maxRosterSize: 7,
  scoring: { perStat: { rec: 0.5 }, rules: [], unmapped: [] },
  regularSeasonWeeks: [1, 2, 3, 4, 5, 6],
  playoffWeeks: [7],
  playoffTeams: 2,
  playoffByes: 0,
  medianGame: false,
  pointsOnly: false,
  tradeDeadline: { week: 5 },
  tradeReview: "none",
};

const player = (id: string, name: string, pos: PlayerInfo["pos"]): PlayerInfo => ({ id, name, pos, eligible: [pos], nflTeam: "GB", injury: "ACTIVE", ids: {} });

function snap(overrides: Partial<LeagueSnapshot> = {}, settingsOverrides: Partial<LeagueSettings> = {}): NoticeInput["snapshot"] {
  const team = (id: string, name: string, roster: string[]) => ({ id, name, ownerName: `Owner ${id}`, roster, ir: [], taxi: [], record: { w: 1, l: 2, t: 0 }, pointsFor: 300, pointsAgainst: 310 });
  return {
    platform: "espn",
    currentWeek: 4,
    settings: { ...settings, ...settingsOverrides },
    teams: [team("1", "Moonbeam Mudcats", ["espn:1", "100"]), team("2", "Gravel Gophers", ["espn:2", "200", "300"]), team("3", "Tundra Tortoises", [])],
    players: {
      "espn:1": player("espn:1", "Alfie Zorblax", "K"),
      "100": player("100", "Gus Quibble", "WR"),
      "espn:2": player("espn:2", "Barnaby Flapdoodle", "TE"),
      "200": player("200", "Dorian Pemberton", "QB"),
      "300": player("300", "Cyril Wobbleton", "QB"),
      "espn:3": player("espn:3", "Ezra Crumpet", "K"),
      "400": player("400", "Fennimore Sprocket", "K"),
    },
    schedule: [1, 2, 3, 4, 5, 6].flatMap((week) => [{ week, teamA: "1", teamB: "2", isPlayoff: false }, { week, teamA: "3", teamB: null, isPlayoff: false }]),
    warnings: [],
    ...overrides,
  };
}

/** A League model as the notices read it: every rostered player projected, these likely starters. */
function model(starters: Record<string, string>, extra: Partial<NoticeModel> = {}): NoticeModel {
  const players: NoticeModel["players"] = Object.fromEntries(["espn:1", "100", "espn:2", "200", "300", "espn:3", "400"].map((id) => [id, { base: { source: "espn+sleeper" } }]));
  return { warnings: [], players, likelyStarters: () => new Map(Object.entries(starters)), ...extra };
}

function inputs(players: Record<string, PlayerInputs>, warnings: ImportWarning[] = []): Pick<ModelInputs, "warnings" | "players"> {
  return { players, warnings };
}

const texts = (input: NoticeInput) => buildDataNotices(input).notices.map((n) => n.text);

describe("WARNING_RULES: every warning code the app can produce is classified", () => {
  it("covers every code literal the adapters, the data loaders and the model inputs write", () => {
    const files = [...sources(path.join(ROOT, "src", "adapters")), ...sources(path.join(ROOT, "src", "data")), path.join(ROOT, "src", "server", "modelInputs.ts")];
    const literals = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)"/g)) literals.add(m[1] as string);
    const unclassified = [...literals].filter((code) => !Object.hasOwn(WARNING_RULES, code) && !NOT_WARNING_CODES.has(code)).sort();
    expect(unclassified, "classify each new warning code in src/lib/notices.ts WARNING_RULES (or list a non-warning literal here)").toEqual([]);
    // About 130 in all with the League model's warnings (modelWarningRule).
    expect(Object.keys(WARNING_RULES).length).toBeGreaterThan(110);
  });

  it("words every notice code, and nothing else; an unknown code is technical", () => {
    for (const [code, rule] of Object.entries(WARNING_RULES)) if (rule === "notice" || rule === "conditional") expect(NOTICE_TEXT[code], code).toBeTypeOf("function");
    for (const code of Object.keys(NOTICE_TEXT)) expect(["notice", "conditional"], code).toContain(WARNING_RULES[code]);
    expect(warningRule("SOMETHING_NEW")).toBe("technical");
    expect(warningRule("constructor")).toBe("technical");
    expect(texts({ snapshot: snap({ warnings: [{ code: "SOMETHING_NEW", message: "(a newer import's words)" }] }), myTeamId: "1" })).not.toContain("(a newer import's words)");
  });

  it("never shows a code, a path, a stat ID, an HTTP status or ID-matching talk in a notice", () => {
    // The adapters' own words where a notice reuses them (a season asked for; a setting we don't know; the season's weeks).
    const own: Record<string, string> = {
      SEASON_MISMATCH: "You asked for 2025, but this Sleeper league is the 2026 season (Sleeper gives every season its own league ID).",
      SEASON_WEEKS_UNKNOWN: "The league's settings don't list its season weeks, so projections run through NFL week 18.",
      SETTING_DEFAULTED: "The league doesn't say whether teams also play against the league median each week; assumed they don't.",
    };
    // Without the import, and with one that makes every conditional code a notice (no free agents, an injured player without a
    // return week, the user's team among the warning's teams).
    const injured = snap();
    injured.players = { ...injured.players, "100": { ...(injured.players["100"] as PlayerInfo), injury: "OUT" } };
    const contexts = [undefined, { snapshot: { ...injured, freeAgents: [] }, myTeamId: "1" }];
    for (const [code, words] of Object.entries(NOTICE_TEXT)) {
      for (const platformPath of [undefined, 'settings.rosterSettings.lineupSlotCounts["20"]', "settings.playoff_seed_type", "projections/5", "kona_player_info[0]"]) {
        for (const ctx of contexts) {
          const w = { code, message: own[code] ?? "Sleeper's projections for weeks 5–7 couldn't be read (timeout; HTTP 503), so those weeks are left out.", teams: ["1"], ...(platformPath ? { platformPath } : {}) };
          const text = words(w, ctx);
          if (text !== null) expect(text, code).not.toMatch(NOT_PLAIN);
        }
      }
    }
    for (const text of Object.values(UNKNOWN_SETTING_NOTICE)) expect(text).not.toMatch(NOT_PLAIN);
    for (const code of Object.keys(WARNING_RULES).filter((c) => WARNING_RULES[c] === "team")) expect(myTeamWarningText([{ code, message: 'There\'s no Sleeper user named "abc" (HTTP 404).' }]), code).not.toMatch(NOT_PLAIN);
  });

  it("restates the League model's texts it rewords (src/engine/league.ts)", () => {
    expect(BLEND_OFF_WARNING).toBe(ENGINE_BLEND_OFF_WARNING);
    expect(BLEND_OFF_CURVE_WARNING).toBe(ENGINE_BLEND_OFF_CURVE_WARNING);
  });
});

describe("the warnings' notices", () => {
  it("words the notice codes in plain language, each text once, in the order the warnings came", () => {
    const warnings: ImportWarning[] = [
      { code: "TRADES_DISABLED", message: "Trading is turned off in this league, so no trade can go through.", platformPath: "settings.disable_trades" },
      { code: "ESPN_SCHEDULE_UNAVAILABLE", message: "ESPN's NFL schedule didn't load (HTTP 503).", platformPath: "seasons/{season}?view=proTeamSchedules_wl" },
      { code: "ESPN_SCHEDULE_UNREADABLE", message: "The NFL schedule couldn't be read (bad JSON)", platformPath: "proTeamSchedules_wl" },
      { code: "ESPN_TRADES_UNVERIFIED", message: "1 completed trade(s) found that the rosters can't confirm …" },
    ];
    expect(texts({ snapshot: snap({ warnings }), myTeamId: "3" })).toEqual([
      "Trading is turned off in your league, so no trade can go through.",
      "ESPN's NFL schedule didn't load, so injured players' return weeks use our usual recovery times. Refresh later to try again.",
    ]);
  });

  it("says a head coach's lineup spot only when the league starts one", () => {
    const slot = { code: "ESPN_HC_UNMAPPED", message: "The league starts 1 head coach (HC); …", platformPath: 'settings.rosterSettings.lineupSlotCounts["19"]' };
    const rostered = { code: "ESPN_HC_UNMAPPED", message: "2 head coaches (HC) left out (on Team 1, Team 2): head coaches aren't supported.", platformPath: "player.defaultPositionId = 14" };
    expect(texts({ snapshot: snap({ warnings: [slot] }), myTeamId: "3" })).toEqual(["Your league starts a head coach, which Offer Sheet doesn't support yet, so lineups leave that spot empty."]);
    expect(texts({ snapshot: snap({ warnings: [rostered] }), myTeamId: "3" })).toEqual([]);
  });

  it("names the weeks Sleeper's projections or stats didn't load for, without the reasons, and says what they miss (a review of Phase 7b: never 'left out')", () => {
    const w = (code: string, message: string): ImportWarning => ({ code, message });
    // Week 4 is the league's (snap()): a week from it on is still projected, from each player's other weeks, only without its matchup.
    const ctx = { snapshot: snap() };
    const projections = (message: string) => NOTICE_TEXT.PROJECTIONS_WEEK_UNAVAILABLE?.(w("PROJECTIONS_WEEK_UNAVAILABLE", message), ctx);
    expect(projections("Sleeper's projections for weeks 1–3, 5 couldn't be read (timeout; HTTP 503), so those weeks are left out.")).toBe(
      "Sleeper's projections for weeks 1–3, 5 didn't load, so those weeks skip the matchup adjustment. Refresh later to try again.",
    );
    expect(projections("Sleeper's projections for week 5 couldn't be read (timeout), so that week is left out.")).toBe("Sleeper's projections for week 5 didn't load, so that week skips the matchup adjustment. Refresh later to try again.");
    expect(projections("Sleeper's projections for weeks 5 and 7 couldn't be read, so those weeks are left out.")).toBe("Sleeper's projections for weeks 5 and 7 didn't load, so those weeks skip the matchup adjustment. Refresh later to try again.");
    expect(projections("Sleeper's projections for 3 weeks couldn't be read, so those weeks are left out.")).toBe("Sleeper's projections for some weeks didn't load, so those weeks skip the matchup adjustment. Refresh later to try again.");
    // Past weeks only (the lookback): they feed only an injured player's latest healthy projection.
    expect(projections("Sleeper's projections for weeks 1–3 couldn't be read (timeout), so those weeks are left out.")).toBe(
      "Sleeper's projections for weeks 1–3 didn't load, so some injured players' projections may be a little off. Refresh later to try again.",
    );
    // A missing stats week drops out of players' season averages, never the standings (those come from the league's data).
    expect(NOTICE_TEXT.STATS_WEEK_UNAVAILABLE?.(w("STATS_WEEK_UNAVAILABLE", "Sleeper's stats for week 3 couldn't be read (HTTP 500), so that week's points are left out."))).toBe(
      "Sleeper's stats for week 3 didn't load, so that week's games don't count toward players' season averages. Refresh later to try again.",
    );
    expect(NOTICE_TEXT.STATS_WEEK_UNAVAILABLE?.(w("STATS_WEEK_UNAVAILABLE", "Sleeper's stats for weeks 2–3 couldn't be read, so those weeks' points are left out."))).toBe(
      "Sleeper's stats for weeks 2–3 didn't load, so those weeks' games don't count toward players' season averages. Refresh later to try again.",
    );
  });

  it("says ESPN's free agents or injury details didn't load when a whole response couldn't be read too, and never promises 'a few' when none came in (a review of Phase 7b)", () => {
    const some = snap({ freeAgents: ["espn:3", "400"] });
    const none = snap({ freeAgents: [] });
    const fa = (code: string, platformPath: string): ImportWarning => ({ code, message: "(the adapter's words)", platformPath });
    const partial = "Some of ESPN's free-agent lists didn't load, so free-agent pickups may miss players at some positions. Refresh later to try again.";
    const missing = "ESPN's free agents didn't load, so free-agent pickups and streaming picks are missing. Refresh later to try again.";
    expect(texts({ snapshot: { ...some, warnings: [fa("ESPN_FREE_AGENTS_UNAVAILABLE", "view=kona_player_info (free agents, slot 2)")] }, myTeamId: "1" })).toContain(partial);
    expect(texts({ snapshot: { ...none, warnings: [fa("ESPN_FREE_AGENTS_UNAVAILABLE", "view=kona_player_info (free agents, slot 2)")] }, myTeamId: "1" })).toContain(missing);
    // Unreadable: a whole response is a notice in its twin's words (once, with its twin); a few rows are technical, unless none came in.
    expect(texts({ snapshot: { ...some, warnings: [fa("ESPN_FREE_AGENTS_UNREADABLE", "kona_player_info[2]")] }, myTeamId: "1" })).toContain(partial);
    expect(texts({ snapshot: { ...some, warnings: [fa("ESPN_FREE_AGENTS_UNREADABLE", "kona_player_info[2]"), fa("ESPN_FREE_AGENTS_UNAVAILABLE", "view=kona_player_info")] }, myTeamId: "1" }).filter((t) => t === partial)).toHaveLength(1);
    expect(texts({ snapshot: { ...some, warnings: [fa("ESPN_FREE_AGENTS_UNREADABLE", "kona_player_info[]")] }, myTeamId: "1" })).not.toContain(partial);
    expect(texts({ snapshot: { ...none, warnings: [fa("ESPN_FREE_AGENTS_UNREADABLE", "kona_player_info[]")] }, myTeamId: "1" })).toContain(missing);

    const injuryDetails = "ESPN's injury details didn't load, so injured players' return weeks use our usual recovery times. Refresh later to try again.";
    const hurt = snap();
    hurt.players = { ...hurt.players, "100": { ...(hurt.players["100"] as PlayerInfo), injury: "OUT" }, "200": { ...(hurt.players["200"] as PlayerInfo), injury: "IR" } };
    const cards = (platformPath: string): ImportWarning => fa("ESPN_PLAYER_CARDS_UNREADABLE", platformPath);
    expect(texts({ snapshot: { ...hurt, warnings: [cards("kona_playercard[0]")] }, myTeamId: "1" })).toContain(injuryDetails);
    // Some rows skipped: a notice only when no injured player got a return week.
    expect(texts({ snapshot: { ...hurt, warnings: [cards("kona_playercard[]")] }, myTeamId: "1" })).toContain(injuryDetails);
    const dated = { ...hurt, players: { ...hurt.players, "200": { ...(hurt.players["200"] as PlayerInfo), injuryReturnWeek: 9 } } };
    expect(texts({ snapshot: { ...dated, warnings: [cards("kona_playercard[]")] }, myTeamId: "1" })).not.toContain(injuryDetails);
  });

  it("says when a player on your roster was left out for a position Offer Sheet doesn't recognize, never another team's (a review of Phase 7b)", () => {
    const left = (teams?: string[]): ImportWarning => ({ code: "ESPN_POSITION_UNKNOWN", message: "1 player(s) have an ESPN position we don't know (defaultPositionId 8) and were left out.", platformPath: "player.defaultPositionId", ...(teams ? { teams } : {}) });
    const text = "A player on your roster has a position Offer Sheet doesn't recognize, so he's left out.";
    expect(texts({ snapshot: snap({ warnings: [left(["2", "1"])] }), myTeamId: "1" })).toContain(text);
    expect(texts({ snapshot: snap({ warnings: [left(["2"])] }), myTeamId: "1" })).not.toContain(text);
    // No team picked, or an import saved before the warning named its teams: technical.
    expect(texts({ snapshot: snap({ warnings: [left(["1"])] }), myTeamId: null })).not.toContain(text);
    expect(texts({ snapshot: snap({ warnings: [left()] }), myTeamId: "1" })).not.toContain(text);
  });

  it("words why the import couldn't tell which team is yours, for the Import Report's Your team card; never a notice (a review of Phase 7b)", () => {
    const w = (code: string, message: string): ImportWarning => ({ code, message, platformPath: "user" });
    expect(myTeamWarningText([w("USER_NOT_FOUND", 'There\'s no Sleeper user named "parkr", so we couldn\'t tell which team is yours. Pick your team.')])).toBe(
      'We couldn\'t find a Sleeper user named "parkr", so we couldn\'t tell which team is yours. Check the username, or pick your team here so trade ideas are for your team.',
    );
    expect(myTeamWarningText([w("USER_LOOKUP_FAILED", 'Sleeper didn\'t answer the lookup of user "parkr" (timeout), so we couldn\'t tell which team is yours. Pick your team.')])).toBe(
      'Sleeper didn\'t answer when we looked up "parkr", so we couldn\'t tell which team is yours. Refresh league data to try again, or pick your team here.',
    );
    expect(myTeamWarningText([w("USER_NOT_IN_LEAGUE", "That Sleeper user doesn't manage a team in this league; pick your team.")])).toMatch(/^That Sleeper username doesn't manage a team in this league/);
    expect(myTeamWarningText([w("ESPN_MY_TEAM_NOT_FOUND", "The ESPN account in your cookies doesn't own a team in this league; pick your team.")])).toMatch(/^The ESPN account your cookies belong to doesn't own a team in this league/);
    expect(myTeamWarningText([w("ESPN_MY_TEAM_UNKNOWN", "The team you picked (or the one in your link) isn't in this league; pick your team.")])).toMatch(/^The team you picked \(or the one in your link\) isn't in this league/);
    expect(myTeamWarningText([w("TRADES_DISABLED", "Trading is off.")])).toBeNull();
    expect(myTeamWarningText(undefined)).toBeNull();
    // Every "team" code has words, and none is a notice.
    for (const code of Object.keys(WARNING_RULES).filter((c) => WARNING_RULES[c] === "team")) {
      expect(myTeamWarningText([w(code, "(the adapter's words)")]), code).toBeTruthy();
      expect(texts({ snapshot: snap({ warnings: [w(code, "(the adapter's words)")] }), myTeamId: null })).toEqual([]);
    }
  });

  it("says what Offer Sheet assumes for a Sleeper setting the league leaves out", () => {
    const defaulted = (platformPath: string) => NOTICE_TEXT.SETTING_DEFAULTED?.({ code: "SETTING_DEFAULTED", message: "(the adapter's words)", platformPath });
    expect(defaulted("settings.playoff_round_type")).toBe("Your league doesn't say how long its playoff rounds last, so Offer Sheet assumes one week each.");
    expect(defaulted("settings.playoff_seed_type")).toBe("Your league doesn't say how its playoff bracket is seeded, so Offer Sheet assumes standard seeding with no re-seeding.");
    expect(defaulted("settings.league_average_match")).toBe("Your league doesn't say whether teams also play the league median each week, so Offer Sheet assumes they don't.");
    expect(defaulted("settings.something_new")).toBe("(the adapter's words)");
    // Read from an undocumented code: a notice when it changes the deadline or the playoffs; the waiver reset's is technical.
    const inferred = (platformPath: string) => NOTICE_TEXT.SETTING_INFERRED?.({ code: "SETTING_INFERRED", message: "(the adapter's words)", platformPath });
    expect(inferred("settings.trade_deadline")).toBe("We read your league as having no trade deadline, since Sleeper doesn't say clearly. Check your league's settings.");
    expect(inferred("settings.divisions")).toMatch(/^We assume your division winners get the top playoff seeds/);
    expect(inferred("settings.playoff_round_type")).toMatch(/^We read your playoff rounds as two weeks each/);
    expect(inferred("settings.waiver_type")).toBeNull();
  });

  it("says each setting that couldn't be read once, however many warnings mark it, and never the warnings' own words", () => {
    const warnings: ImportWarning[] = [
      { code: "ESPN_SEEDING_TIEBREAKER_UNKNOWN", message: "ESPN breaks ties in the standings by TOTAL_POINTS_AGAINST, which Offer Sheet doesn't model yet; …", platformPath: "settings.scheduleSettings.playoffSeedingRule" },
      { code: "TRADE_DEADLINE_UNKNOWN", message: "Trade deadline code 42 isn't one we know, …", platformPath: "settings.trade_deadline" },
    ];
    expect(texts({ snapshot: snap({ warnings }, { unknownSettings: ["tradeDeadline", "seedingTiebreaker"], tradeDeadline: null }), myTeamId: "3" })).toEqual([
      UNKNOWN_SETTING_NOTICE.tradeDeadline,
      UNKNOWN_SETTING_NOTICE.seedingTiebreaker,
    ]);
  });
});

describe("uncounted scoring rules: a notice when common or scored this season, else the quiet line", () => {
  const espn = (unmapped: LeagueSettings["scoring"]["unmapped"], warnings: ImportWarning[] = []) => snap({ warnings }, { scoring: { perStat: {}, rules: [], unmapped } });
  const safety = { platformKey: "209", label: "1pt Safety", points: 1 };
  const blocked = { platformKey: "93", label: "Blocked Punt or FG return for TD", points: 6 };

  it("says Parker's two rare rules quietly, in the planner's words, and makes no notice of them", () => {
    for (const scored of [false, undefined]) {
      const s = espn([
        { ...safety, ...(scored === undefined ? {} : { scoredThisSeason: scored }) },
        { ...blocked, ...(scored === undefined ? {} : { scoredThisSeason: scored }) },
      ]);
      const data = buildDataNotices({ snapshot: s, myTeamId: "3" });
      expect(data.scoring).toEqual({ notice: null, quiet: "Two rare rules aren't counted: 1-point safeties and blocked-kick return touchdowns. They almost never happen." });
      expect(data.notices).toEqual([]);
    }
  });

  it("makes a notice of a rule that scored this season, and of a common one, with its points", () => {
    const data = buildDataNotices({ snapshot: espn([safety, { ...blocked, scoredThisSeason: true }, { platformKey: "70", label: "Rushing Fumbles Lost", points: -2, scoredThisSeason: false }]), myTeamId: "3" });
    expect(data.scoring).toEqual({
      notice: "Offer Sheet doesn't count two of your league's scoring rules yet, so projections leave their points out: blocked-kick return touchdowns (+6) and rushing fumbles lost (−2).",
      quiet: "One rare rule isn't counted: 1-point safeties. It almost never happens.",
    });
    expect(data.notices.map((n) => n.key)).toEqual(["scoring"]);
  });

  it("can't call a rule it doesn't recognize rare unless it hasn't scored, and never names its stat ID", () => {
    expect(uncountedNoticeText(uncountedRules(espn([{ platformKey: "250", label: "ESPN stat 250", points: 3 }])))).toBe(
      "Offer Sheet doesn't count one of your league's scoring rules yet, so projections leave its points out: an unrecognized rule (+3).",
    );
    expect(quietScoringLine(uncountedRules(espn([{ platformKey: "250", label: "ESPN stat 250", points: 3, scoredThisSeason: false }])))).toBe("One rare rule isn't counted: an unrecognized rule. It almost never happens.");
  });

  it("names a range of ESPN rules once (punting-average bands), counting names, not ids", () => {
    const bands = [148, 149, 150].map((id) => ({ platformKey: String(id), label: `Punt Average band ${id}`, points: 1, scoredThisSeason: false }));
    expect(quietScoringLine(uncountedRules(espn([...bands, safety])))).toBe("Two rare rules aren't counted: punting-average bonuses and 1-point safeties. They almost never happen.");
  });

  it("judges a name, not each rule: one that scored puts its whole name in the notice, never in the quiet line too (a review of Phase 7b)", () => {
    // A 0–9 yard TD bonus that scored, and a 30–39 yard one that hasn't: one name, said once, as a notice.
    const rules = uncountedRules(espn([{ platformKey: "179", label: "0-9 yd TD rush bonus", points: 1, scoredThisSeason: true }, { platformKey: "182", label: "30-39 yd TD rush bonus", points: 1, scoredThisSeason: false }, safety]));
    expect(uncountedNoticeText(rules)).toBe("Offer Sheet doesn't count one of your league's scoring rules yet, so projections leave its points out: touchdown-length bonuses (+1).");
    expect(quietScoringLine(rules)).toBe("One rare rule isn't counted: 1-point safeties. It almost never happens.");
    // A head coach's results: a win that scored, a tie that hasn't (mixed points: none shown).
    const coach = uncountedRules(espn([{ platformKey: "155", label: "Team Win", points: 3, scoredThisSeason: true }, { platformKey: "157", label: "Team Tie", points: 1, scoredThisSeason: false }]));
    expect(uncountedNoticeText(coach)).toBe("Offer Sheet doesn't count one of your league's scoring rules yet, so projections leave its points out: head-coach team results.");
    expect(quietScoringLine(coach)).toBeNull();
    // Rules we can't tell apart count one each.
    const unknown = uncountedRules(espn([{ platformKey: "250", label: "ESPN stat 250", points: 3 }, { platformKey: "251", label: "ESPN stat 251", points: 2 }]));
    expect(uncountedNoticeText(unknown)).toBe("Offer Sheet doesn't count two of your league's scoring rules yet, so projections leave their points out: two unrecognized rules.");
  });

  it("reads Sleeper's rules whose value isn't a number: common ones are a notice", () => {
    const warnings = [
      { code: "SCORING_VALUE_NOT_NUMBER", message: 'Scoring rule "pass_td" has a non-numeric value and was ignored.', platformPath: "scoring_settings.pass_td" },
      { code: "SCORING_VALUE_NOT_NUMBER", message: 'Scoring rule "bonus_pass_cmp_25" has a non-numeric value and was ignored.', platformPath: "scoring_settings.bonus_pass_cmp_25" },
    ];
    const data = buildDataNotices({ snapshot: snap({ platform: "sleeper", warnings }), myTeamId: "3" });
    expect(data.scoring.notice).toBe("Offer Sheet doesn't count one of your league's scoring rules yet, so projections leave its points out: passing TDs.");
    expect(data.scoring.quiet).toMatch(/^One rare rule isn't counted: /);
  });

  it("names every ESPN rule the adapter can't count, and calls only standard categories common", () => {
    const none = Object.entries(ESPN_READINGS)
      .filter(([, r]) => r.kind === "none")
      .map(([id]) => Number(id));
    for (const id of none) expect(espnUncountedName(id), `ESPN stat ${id}`).toBeTruthy();
    for (const id of ESPN_COMMON_UNCOUNTED) expect(none).toContain(id);
    expect(espnUncountedName(209)).toBe("1-point safeties");
    expect(espnUncountedName(93)).toBe("blocked-kick return touchdowns");
  });
});

describe("players: a notice for your roster or a likely starter, else technical", () => {
  it("before the League model (the Import Report): your roster alone; other teams' players are counted for the technical details", () => {
    const data = buildDataNotices({ snapshot: snap(), myTeamId: "1" });
    expect(data.notices.map((n) => n.text)).toEqual(["We couldn't find Alfie Zorblax (K, your team) in Sleeper's data, so his projections come from ESPN alone."]);
    // Barnaby Flapdoodle (Team 2) can't be judged without the League model; Ezra Crumpet is a free agent.
    expect(data.unjudged).toBe(1);
    expect(unjudgedText(1)).toBe("1 player on other teams has incomplete data (listed below). The League page points out any of them who are likely starters.");
    expect(unjudgedText(0)).toBeNull();
    // No team picked: nobody's on "your roster".
    expect(buildDataNotices({ snapshot: snap(), myTeamId: null })).toMatchObject({ notices: [], unjudged: 2 });
  });

  it("with the League model (the League page): likely starters on any roster too, a free agent a team would pick up and start included", () => {
    const warnings: ImportWarning[] = [
      { code: "ESPN_PLAYER_MATCHED_BY_NAME", message: "1 player isn't in any player ID source, … Free agents: Fennimore Sprocket (K, GB).", platformPath: "player.id", players: ["400"] },
      { code: "ESPN_ID_CONFLICT", message: "The player ID sources disagree … check: Cyril Wobbleton (QB, GB).", platformPath: "player.id", players: ["300"] },
    ];
    // Team 2 starts Barnaby Flapdoodle; my team would pick up Fennimore Sprocket and start him; Cyril Wobbleton is a backup.
    const data = buildDataNotices({ snapshot: snap({ warnings }), myTeamId: "1", model: model({ "espn:2": "2", "400": "1", "200": "2" }) });
    expect(data.notices.map((n) => n.text)).toEqual([
      "We couldn't find Alfie Zorblax (K, your team) or Barnaby Flapdoodle (TE, Gravel Gophers) in Sleeper's data, so their projections come from ESPN alone.",
      "We could only identify Fennimore Sprocket (K, a pickup for your team) by name, position and team, so check his projections.",
    ]);
    expect(data.unjudged).toBe(0);
    // The backup starts after all: the ID conflict is a notice.
    expect(texts({ snapshot: snap({ warnings }), myTeamId: "1", model: model({ "300": "2" }) })).toContain("Our data sources disagree about who Cyril Wobbleton (QB, Gravel Gophers) is, so check his projections.");
  });

  it("reads the names a warning lists when it carries no ids (an import saved before Phase 7b)", () => {
    const warnings: ImportWarning[] = [{ code: "ESPN_ID_CONFLICT", message: "The player ID sources disagree about who 1 ESPN player id in this league belongs to; …, so check: Gus Quibble (WR, GB).", platformPath: "player.id" }];
    expect(texts({ snapshot: snap({ warnings }), myTeamId: "1" })).toContain("Our data sources disagree about who Gus Quibble (WR, your team) is, so check his projections.");
  });

  it("says a player on your roster has no projections, from the League model or the model inputs, and one without details is left out", () => {
    const noBase = model({}, { players: { ...model({}).players, "100": { base: { source: "none" } } } });
    expect(texts({ snapshot: snap(), myTeamId: "1", model: noBase })).toContain("We have no projections for Gus Quibble (WR, your team), so he counts as 0 points.");
    // The model inputs (the Import Report), fresh for this league data (the caller's job): an entry with nothing to project
    // from, or none at all (every rostered player has one then).
    const empty = inputs({ "100": { sleeper: { 4: null }, actual: {} }, "espn:1": { sleeper: {}, espn: { 4: 7.5 }, actual: {} } });
    const data = buildDataNotices({ snapshot: snap(), myTeamId: "1", inputs: empty });
    expect(data.notices.map((n) => n.text)).toEqual([
      "We have no projections for Gus Quibble (WR, your team), so he counts as 0 points.",
      "We couldn't find Alfie Zorblax (K, your team) in Sleeper's data, so his projections come from ESPN alone.",
    ]);
    // Team 2's three have no entry: no projections, left to the League page to judge (it can tell a starter without them).
    expect(data.noProjections).toEqual(["100", "espn:2", "200", "300"]);
    expect(data.unjudged).toBe(3);
    // Nobody projected at all (the season hasn't started, the projections didn't load): that source's own notice says it, not every player.
    const nobody = buildDataNotices({ snapshot: snap(), myTeamId: "1", inputs: inputs({}) });
    expect(nobody.notices.map((n) => n.text)).toEqual(["We couldn't find Alfie Zorblax (K, your team) in Sleeper's data, so his projections come from ESPN alone."]);
    expect(nobody.noProjections).toEqual([]);
    // A rostered id without player details (Sleeper's PLAYER_UNKNOWN).
    const ghost = snap();
    ghost.teams = ghost.teams.map((t) => (t.id === "1" ? { ...t, roster: [...t.roster, "ghost-1", "ghost-2"] } : t));
    expect(texts({ snapshot: ghost, myTeamId: "1" })).toContain("2 players on your roster came without any player details, so they're left out.");
  });

  it("judges another team's player without projections without them (a review of Phase 7b: our points never make him a likely starter)", () => {
    // Team 2 (Gravel Gophers) starts QB, WR, TE and K: Dorian Pemberton (QB) has no projections, Cyril Wobbleton (QB) starts.
    const projected = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { base: { source: "sleeper" }, ros: { total: 80 } }]));
    const noDorian = model({ "300": "2", "espn:2": "2" }, { players: { ...projected(["espn:1", "100", "espn:2", "300", "espn:3", "400"]), "200": undefined } });
    const market = (v: Record<string, number>): MarketInputs => ({ format: { isDynasty: false, numQbs: 1, numTeams: 8, ppr: 0.5, substitutions: [] }, fetchedAt: "2026-09-29T00:00:00.000Z", values: v, knownIds: [], topValue: 9000 });
    const values = (v: Record<string, number>) => ({ ...inputs({}), market: market(v) });
    const dorian = "We have no projections for Dorian Pemberton (QB, Gravel Gophers), so he counts as 0 points.";
    // FantasyCalc rates him above the QB his team starts: a likely starter.
    expect(texts({ snapshot: snap(), myTeamId: "1", model: noDorian, inputs: values({ "200": 5000, "300": 900 }) })).toContain(dorian);
    // Rated below him, or not valued at all, and his team has another projected QB: not one.
    expect(texts({ snapshot: snap(), myTeamId: "1", model: noDorian, inputs: values({ "200": 400, "300": 900 }) })).not.toContain(dorian);
    expect(texts({ snapshot: snap(), myTeamId: "1", model: noDorian, inputs: values({}) })).not.toContain(dorian);
    // The League model's own warning about him stays a player-level one: judged here, not repeated.
    expect(modelWarningRule("No projections for 1 rostered player (Dorian Pemberton), so they count as 0 points.")).toEqual({ rule: "player" });

    // His team's need: its only TE (Barnaby Flapdoodle) has no projections, so its TE spot has nobody else; a streamed TE needs nobody.
    const noBarnaby = model({ "300": "2" }, { players: { ...projected(["espn:1", "100", "200", "300", "espn:3", "400"]), "espn:2": undefined } });
    const barnaby = "We have no projections for Barnaby Flapdoodle (TE, Gravel Gophers), so he counts as 0 points.";
    expect(texts({ snapshot: snap(), myTeamId: "1", model: noBarnaby })).toContain(barnaby);
    expect(texts({ snapshot: snap(), myTeamId: "1", model: { ...noBarnaby, streams: (t) => (t === "2" ? ["TE"] : []) } })).not.toContain(barnaby);
    // A taxi player never starts.
    const taxi = snap();
    taxi.teams = taxi.teams.map((t) => (t.id === "2" ? { ...t, roster: ["200", "300"], taxi: ["espn:2"] } : t));
    expect(texts({ snapshot: taxi, myTeamId: "1", model: noBarnaby })).not.toContain(barnaby);
  });

  it("says nothing about other teams' players nobody starts, or free agents nobody picks up", () => {
    expect(texts({ snapshot: snap(), myTeamId: "3", model: model({ "200": "2" }) })).toEqual([]);
  });

  it("never flags ESPN's team QB units, which Sleeper doesn't list by design (a TQB league's every team)", () => {
    const tqb = snap();
    tqb.players = { ...tqb.players, "espn:-15009": player("espn:-15009", "Packers TQB", "QB") };
    tqb.teams = tqb.teams.map((t) => (t.id === "3" ? { ...t, roster: ["espn:-15009"] } : t));
    const projected = model({ "espn:-15009": "3" });
    expect(texts({ snapshot: tqb, myTeamId: "3", model: { ...projected, players: { ...projected.players, "espn:-15009": { base: { source: "espn" } } } } })).toEqual([]);
  });
});

describe("the League model's warnings", () => {
  it("keeps free agents and the projection source to the technical details, judges rostered players one by one, and words the rest", () => {
    expect(modelWarningRule("No projections for 2 rostered players (Gus Quibble, Cyril Wobbleton), so they count as 0 points.")).toEqual({ rule: "player" });
    expect(modelWarningRule("No projections for 1 rostered player (Gus Quibble), so they count as 0 points.")).toEqual({ rule: "player" });
    expect(modelWarningRule("No projections for 12 free agents, so they are left out.")).toEqual({ rule: "technical" });
    expect(modelWarningRule("ESPN's projections differ from Sleeper's by 14% on average this week (more than 10%), so projections use Sleeper's alone.")).toEqual({ rule: "technical" });
    expect(modelWarningRule("ESPN's and Sleeper's projections couldn't be compared this week (no rostered player has both), so projections use Sleeper's alone.")).toEqual({ rule: "technical" });
    // Since Checkpoint 7f the test leaves kickers and D/STs aside, and a gap beside the bar has one decimal: still technical.
    expect(modelWarningRule("ESPN's projections differ from Sleeper's by 11% on average this week, kickers and D/STs aside (more than 10%), so projections use Sleeper's alone.")).toEqual({ rule: "technical" });
    expect(modelWarningRule("ESPN's projections differ from Sleeper's by 10.3% on average this week, kickers aside (more than 10%), so projections use Sleeper's alone.")).toEqual({ rule: "technical" });
    expect(modelWarningRule("ESPN's and Sleeper's projections couldn't be compared this week (no rostered player has both, kickers and D/STs aside), so projections use Sleeper's alone.")).toEqual({ rule: "technical" });
    // Since Checkpoint 7g the players tagged questionable, doubtful or probable are aside too: still technical.
    expect(modelWarningRule("ESPN's projections differ from Sleeper's by 11% on average this week, kickers, D/STs and questionable players aside (more than 10%), so projections use Sleeper's alone.")).toEqual({ rule: "technical" });
    expect(modelWarningRule("ESPN's and Sleeper's projections couldn't be compared this week (no rostered player has both, questionable or doubtful players aside), so projections use Sleeper's alone.")).toEqual({ rule: "technical" });
    expect(modelWarningRule(BLEND_OFF_WARNING)).toEqual({ rule: "notice", text: "FantasyCalc's values for this season didn't load, so projections aren't adjusted toward the trade market. Refresh later to try again." });
    expect(modelWarningRule(ODDS_REFUSED_WARNING)).toEqual({ rule: "notice", text: ODDS_REFUSED_WARNING });
    const m = model({}, { warnings: ["No projections for 12 free agents, so they are left out.", ODDS_REFUSED_WARNING, "Sleeper's projections are missing, so projections use ESPN's alone."] });
    expect(texts({ snapshot: snap(), myTeamId: "3", model: m })).toEqual([ODDS_REFUSED_WARNING, "Sleeper's projections are missing, so projections use ESPN's alone."]);
  });
});

describe("the schedule (the Import Report only: the League page's standings notes say it)", () => {
  it("says which remaining weeks have no matchups, and when finished playoff games have no result", () => {
    const s = snap();
    s.schedule = s.schedule.filter((m) => m.week !== 2 && m.week !== 5 && m.week !== 6);
    s.schedule.push({ week: 7, teamA: "1", teamB: "2", isPlayoff: true, decided: true });
    expect(texts({ snapshot: s, myTeamId: "3" })).toEqual([
      "Your league's schedule has no matchups in weeks 5–6, so those weeks are left out of the playoff odds.",
      "Some finished playoff games came back without a result, so bye and title odds show as unknown.",
    ]);
    expect(texts({ snapshot: s, myTeamId: "3", model: model({}) })).toEqual([]);
    // A points-only league has no matchups to miss.
    expect(texts({ snapshot: snap({ schedule: [] }, { pointsOnly: true }), myTeamId: "3" })).toEqual([]);
  });

  it("says there are no odds at all when no game is left to play, as the season simulation reads it (season.ts oddsSkippedWarning; a review of Phase 7b)", () => {
    const none = "Your league's schedule is missing the rest of the regular season, so there are no playoff odds for now. Refresh later to try again.";
    expect(texts({ snapshot: snap({ schedule: [] }), myTeamId: "3" })).toEqual([none]);
    // This week's games already decided and the rest missing: nothing left to play either.
    const decided = snap();
    decided.schedule = decided.schedule.filter((m) => m.week <= 4).map((m) => ({ ...m, decided: true }));
    expect(texts({ snapshot: decided, myTeamId: "3" })).toEqual([none]);
    // One game left to play: only the missing weeks are left out.
    const one = snap();
    one.schedule = one.schedule.filter((m) => m.week <= 4).map((m) => (m.week === 4 && m.teamB !== null ? m : { ...m, decided: true }));
    expect(texts({ snapshot: one, myTeamId: "3" })).toEqual(["Your league's schedule has no matchups in weeks 5–6, so those weeks are left out of the playoff odds."]);
  });
});
