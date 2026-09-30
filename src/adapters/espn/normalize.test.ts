import { describe, expect, it } from "vitest";
import { LeagueImportError } from "@/adapters/types";
import { resolverFromData } from "@/data/crosswalk";
import type { SleeperPlayerRecord } from "@/data/sleeperPlayers";
import type { CrosswalkConflict, PlayerIdResolver } from "@/data/types";
import type { LeagueSnapshot } from "@/engine/model";
import { readMinFixture } from "@/test-utils/fixtures";
import { FREE_AGENTS_PER_POSITION, idOverrideNote, normalizeEspnLeague, normalizeSwid, type EspnRawBundle } from "./normalize";
import { FA_POSITIONS, LABELS, NOW, PARKER, PUBLIC, expectedTransactionTypes, fakeResolver, parkerBundle, readCross, readEspn } from "./test-helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const codes = (s: LeagueSnapshot) => s.warnings.map((w) => w.code);
const idNotes = (notes: readonly string[]) => notes.filter((n) => n.startsWith("Player IDs:"));

/** A conflict shaped like src/data's crosswalk builds it: "same player" overrides a DynastyProcess id that isn't an active player. */
function conflictFor(platformId: string, chosen: string, resolvedBy: CrosswalkConflict["resolvedBy"], other = "999001"): CrosswalkConflict {
  const same = resolvedBy === "same player";
  return {
    source: "espn",
    platformId,
    options: same
      ? [
          { sleeperId: other, from: ["dynastyProcess"], active: false },
          { sleeperId: chosen, from: ["fantasyCalc"], active: true },
        ]
      : [
          { sleeperId: chosen, from: ["dynastyProcess"], active: true },
          { sleeperId: other, from: ["fantasyCalc"], active: true },
        ],
    chosen,
    resolvedBy,
    ...(same ? { sameBy: ["team"] as const } : {}),
    withinSource: false,
  };
}

/** A free-agent kicker in ESPN's pool (made-up player; ESPN ids far above real ones), ranked by `100 − i` projected points. */
const poolKicker = (idBase: number, i: number, proTeamId = 9) => ({
  id: idBase + i,
  onTeamId: 0,
  status: "FREEAGENT",
  player: { id: idBase + i, fullName: `Zorblax Kickwell ${i}`, defaultPositionId: 5, eligibleSlots: [17, 20, 21], proTeamId, stats: [{ seasonId: 2026, scoringPeriodId: 4, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 100 - i }] },
});

/** A Sleeper players-DB record for a real crosswalk built with resolverFromData. */
const sleeperRecord = (id: string, name: string, position: string, team: string | null): SleeperPlayerRecord => ({
  id,
  name,
  position,
  fantasyPositions: [position],
  team,
  injuryStatus: null,
  status: "Active",
  age: 27,
  active: true,
  yearsExp: 2,
  firstName: null,
  lastName: null,
  espnId: null,
  yahooId: null,
  sportradarId: null,
  gsisId: null,
});

function parker(extra: Partial<Parameters<typeof normalizeEspnLeague>[1]> = {}, bundle: EspnRawBundle = parkerBundle()) {
  return normalizeEspnLeague(bundle, { leagueId: PARKER.leagueId, resolver: fakeResolver(), now: NOW, swid: PARKER.swid, ...extra });
}

describe("normalizeEspnLeague on Parker's league (sanitized fixtures)", () => {
  const { snapshot: s, notes } = parker();

  it("reads the league basics", () => {
    expect(s).toMatchObject({ platform: "espn", leagueId: PARKER.leagueId, season: 2026, name: "League 1", currentWeek: 4, fetchedAt: NOW.toISOString(), myTeamId: PARKER.myTeamId });
    expect(s.settings).toMatchObject({ numTeams: 10, leagueType: "redraft", benchSlots: 7, irSlots: 1, taxiSlots: 0, maxRosterSize: 16, medianGame: false, pointsOnly: false, tradeReview: "league_vote" });
    expect(s.settings.faabBudget).toBeUndefined();
    expect(s.settings.divisions).toBeUndefined();
  });

  it("maps the lineup with FLEX eligibility and ESPN's position limits", () => {
    expect(s.settings.lineup).toEqual([
      { slot: "QB", count: 1, eligible: ["QB"] },
      { slot: "RB", count: 2, eligible: ["RB"] },
      { slot: "WR", count: 2, eligible: ["WR"] },
      { slot: "TE", count: 1, eligible: ["TE"] },
      { slot: "FLEX", count: 1, eligible: ["RB", "WR", "TE"] },
      { slot: "D/ST", count: 1, eligible: ["DEF"] },
      { slot: "K", count: 1, eligible: ["K"] },
    ]);
    expect(s.settings.positionLimits).toEqual({ QB: 4, RB: 8, WR: 8, TE: 3, K: 3, DEF: 3 });
  });

  it("derives weeks, playoffs and the trade deadline (date and NFL week)", () => {
    expect(s.settings.regularSeasonWeeks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(s.settings.playoffWeeks).toEqual([15, 16, 17]);
    expect(s.settings).toMatchObject({ playoffTeams: 6, playoffByes: 2, playoffSeeding: { reseed: false, divisionWinnersFirst: false } });
    expect(s.settings.playoffRoundWeeks).toBeUndefined();
    expect(s.settings.tradeDeadline).toEqual({ date: "2026-12-02T17:00:00.000Z", week: 13 });
  });

  it("builds teams with placeholder names and owners, records and points", () => {
    expect(s.teams).toHaveLength(10);
    // Records and rosters are live data (the fixtures are refreshed by the probe): compare with the fixture.
    for (const raw of readEspn<Json>(LABELS.league).teams as Json[]) {
      const t = s.teams.find((x) => x.id === String(raw.id));
      const rec = raw.record.overall;
      expect(t).toMatchObject({ name: `Team ${raw.id}`, ownerName: `Owner ${raw.id}`, record: { w: rec.wins, l: rec.losses, t: rec.ties }, taxi: [] });
      // ESPN sends float noise (307.09999999999997); points are kept to two decimals.
      expect(t?.pointsFor).toBe(Math.round(rec.pointsFor * 100) / 100);
      expect(t?.pointsAgainst).toBe(Math.round(rec.pointsAgainst * 100) / 100);
      expect((t?.roster.length ?? 0) + (t?.ir.length ?? 0)).toBe(raw.roster.entries.length);
      expect(t?.ir.length).toBe(raw.roster.entries.filter((e: Json) => e.lineupSlotId === 21).length);
    }
    expect(s.teams.reduce((n, t) => n + t.roster.length + t.ir.length, 0)).toBeGreaterThan(150);
    for (const t of s.teams) for (const id of [...t.roster, ...t.ir]) expect(s.players[id]).toBeDefined();
  });

  it("gives every player a canonical id: Sleeper's via the resolver, the Sleeper team code for D/ST, else espn:<id>", () => {
    const players = Object.values(s.players);
    const mapped = new Map(readCross().rows.map((r) => [String(r.espnId), r.sleeperId]));
    for (const p of players) {
      expect(p.ids.espn).toMatch(/^-?\d+$/);
      if (p.pos === "DEF") expect(p.id).toMatch(/^[A-Z]{2,3}$/);
      else if (mapped.has(p.ids.espn as string)) expect(p).toMatchObject({ id: mapped.get(p.ids.espn as string), ids: { sleeper: mapped.get(p.ids.espn as string) } });
      else expect(p.id).toBe(`espn:${p.ids.espn}`);
    }
    expect(players.filter((p) => p.ids.sleeper).length).toBeGreaterThan(150);
    const dst = players.find((p) => p.ids.espn === "-16025");
    expect(dst).toMatchObject({ id: "SF", name: "49ers D/ST", pos: "DEF", nflTeam: "SF", injury: "ACTIVE", eligible: ["DEF"] });
    const counts: Record<string, number> = {};
    for (const p of players) counts[p.injury] = (counts[p.injury] ?? 0) + 1;
    expect(counts.IR).toBeGreaterThan(0);
    expect(counts.NA).toBeUndefined();
  });

  it("never lets a SWID into the snapshot", () => {
    expect(JSON.stringify(s)).not.toMatch(/\{[0-9A-F]{8}-[0-9A-F]{4}-/i);
  });

  it("keeps the top 50 free agents per position, ranked by ESPN's rest-of-season league-scored projection", () => {
    const rostered = new Set(s.teams.flatMap((t) => [...t.roster, ...t.ir]));
    expect(s.freeAgents.length).toBeGreaterThan(100);
    // ESPN's in-season projected season line (source 1, split 0) is rest of season; else this week × weeks left (4…17).
    const proj = new Map<string, number>();
    for (const pos of FA_POSITIONS)
      for (const x of readEspn<{ players: Array<{ id: number; player: { stats: Array<Json> } }> }>(LABELS.fa(pos)).players) {
        const rest = x.player.stats.find((l) => l.seasonId === 2026 && l.statSourceId === 1 && l.statSplitTypeId === 0);
        const week = x.player.stats.find((l) => l.statSourceId === 1 && l.statSplitTypeId === 1 && l.scoringPeriodId === 4);
        if (rest) proj.set(String(x.id), rest.appliedTotal as number);
        else if (week) proj.set(String(x.id), (week.appliedTotal as number) * 14);
      }
    const byPos = new Map<string, string[]>();
    for (const id of s.freeAgents) {
      expect(rostered.has(id)).toBe(false);
      const p = s.players[id];
      expect(p).toBeDefined();
      byPos.set(p!.pos, [...(byPos.get(p!.pos) ?? []), id]);
    }
    for (const [, ids] of byPos) {
      expect(ids.length).toBeLessThanOrEqual(FREE_AGENTS_PER_POSITION);
      const values = ids.map((id) => proj.get(s.players[id]!.ids.espn as string) ?? Number.NEGATIVE_INFINITY);
      for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThanOrEqual(values[i - 1] as number);
    }
    expect(byPos.get("QB")?.length).toBeGreaterThan(0);
  });

  it("lists every regular-season matchup in its NFL week", () => {
    expect(s.schedule).toHaveLength(70);
    expect(s.schedule.every((m) => !m.isPlayoff && m.teamB !== null)).toBe(true);
    for (let w = 1; w <= 14; w++) expect(s.schedule.filter((m) => m.week === w)).toHaveLength(5);
    expect(s.schedule[0]).toEqual({ week: 1, teamA: "6", teamB: "8", isPlayoff: false });
  });

  it("keeps only executed adds, drops and waiver claims, deduped across per-period requests", () => {
    const types: Record<string, number> = {};
    for (const t of s.transactions) types[t.type] = (types[t.type] ?? 0) + 1;
    expect(types).toEqual(expectedTransactionTypes());
    expect(s.transactions.length).toBeGreaterThan(20);
    const twice = parker({}, { ...parkerBundle(), transactions: [1, 2, 3, 4, 4, 3].map((w) => readEspn(LABELS.tx(w))) }).snapshot;
    expect(twice.transactions).toEqual(s.transactions);
    for (const t of s.transactions) {
      expect(t.week).toBeGreaterThanOrEqual(1);
      expect(t.timestamp).toMatch(/^2026-09-/);
      expect(t.moves.length).toBeGreaterThan(0);
      for (const m of t.moves) expect(m.from === null || m.to === null).toBe(true);
    }
  });

  it("reports what it couldn't map and what it inferred", () => {
    expect(codes(s)).toEqual(["ESPN_SCORING_UNMAPPED", "ESPN_SCORING_UNMAPPED"]);
    expect(notes.join("\n")).toMatch(/2 byes/);
    expect(notes.join("\n")).toMatch(/24-hour review in which 4 votes veto/);
    expect(notes.join("\n")).toMatch(/positionLimits/);
    expect(s.settings.unknownSettings).toBeUndefined();
  });

  it("says that an accepted trade still in review isn't counted, and where ESPN's own trade counters show more trades (review ESPN-4)", () => {
    // Period 4 has one TRADE_ACCEPT without a status (in its 24-hour review); ESPN counts it for Team 6 and Team 10.
    expect(s.transactions.filter((t) => t.type === "trade")).toHaveLength(0);
    expect(notes).toContain("1 accepted trade is still in the league's review period, so it isn't counted yet.");
    expect(notes).toContain("ESPN's own trade counters show more trades than the transaction list for Team 6 (1 vs 0), Team 10 (1 vs 0): a trade still in review counts there.");
  });

  it("sets injured players' expected return weeks from ESPN's player cards (review ESPN-5)", () => {
    const byEspn = (id: number) => Object.values(s.players).find((p) => p.ids.espn === String(id));
    // Card dates (Phase 0 E.injuryReturn): Oct 4 (questionable) → week 4, Oct 11 (out) → 5, Oct 25 (IR) → 7, Oct 30 (day-to-day) → 8.
    expect(byEspn(16737)).toMatchObject({ injury: "QUESTIONABLE", injuryReturnWeek: 4 });
    expect(byEspn(4239996)).toMatchObject({ injury: "OUT", injuryReturnWeek: 5 });
    expect(byEspn(4360078)).toMatchObject({ injury: "IR", injuryReturnWeek: 7 });
    expect(byEspn(4047365)).toMatchObject({ injury: "QUESTIONABLE", injuryReturnWeek: 8 });
    // Out for the season (expected back in February): the week after the NFL season.
    expect(byEspn(4429160)).toMatchObject({ injury: "IR", injuryReturnWeek: 19 });
    const onRosters = new Set(s.teams.flatMap((t) => [...t.roster, ...t.ir]));
    const injured = Object.values(s.players).filter((p) => p.injury !== "ACTIVE" && onRosters.has(p.id));
    expect(injured.length).toBe(22);
    expect(injured.every((p) => p.injuryReturnWeek !== undefined)).toBe(true);
    expect(Object.values(s.players).filter((p) => p.injury === "ACTIVE").every((p) => p.injuryReturnWeek === undefined)).toBe(true);
    expect(notes).toContain("Expected return weeks come from ESPN's player cards for 22 of 22 injured rostered players.");
    expect(notes.find((n) => n.startsWith("ESPN expects 1 player listed as questionable"))).toMatch(/back week 8/);
    // Without cards (or when they failed) nothing is set.
    const bare = parker({}, { ...parkerBundle(), playerCards: [] }).snapshot;
    expect(Object.values(bare.players).some((p) => p.injuryReturnWeek !== undefined)).toBe(false);
  });
});

describe("my team", () => {
  it("is found from the cookie holder's SWID in any case, with or without braces", () => {
    expect(normalizeSwid("00000000-0000-4000-8000-00000000000a")).toBe("{00000000-0000-4000-8000-00000000000A}");
    expect(parker({ swid: "00000000-0000-4000-8000-000000000001" }).snapshot.myTeamId).toBe("3");
  });

  it("without cookies comes from the user's pick; an unknown pick or SWID warns", () => {
    expect(parker({ swid: undefined, myTeamId: "7" }).snapshot.myTeamId).toBe("7");
    expect(parker({ swid: undefined }).snapshot.myTeamId).toBeNull();
    const bad = parker({ swid: undefined, myTeamId: "42" }).snapshot;
    expect(bad.myTeamId).toBeNull();
    expect(bad.warnings.find((w) => w.code === "ESPN_MY_TEAM_UNKNOWN")?.message).toBe("The team you picked (or the one in your link) isn't in this league; pick your team.");
    const stranger = parker({ swid: "{00000000-0000-4000-8000-000000000099}", myTeamId: "5" }).snapshot;
    expect(stranger.myTeamId).toBe("5");
    expect(codes(stranger)).toContain("ESPN_MY_TEAM_NOT_FOUND");
  });
});

describe("normalizeEspnLeague on the public test league (minimized fixture: TQB league, head-coach rules)", () => {
  const league = readMinFixture<Json>("espn", PUBLIC.group, PUBLIC.league);
  const { snapshot: s, notes } = normalizeEspnLeague({ league }, { leagueId: "100002", resolver: fakeResolver(), now: NOW });

  it("maps the TQB slot and TQB units to QB, with an Import Report warning", () => {
    expect(s.settings.lineup).toEqual([
      { slot: "TQB", count: 1, eligible: ["QB"] },
      { slot: "FLEX", count: 5, eligible: ["RB", "WR", "TE"] },
      { slot: "D/ST", count: 1, eligible: ["DEF"] },
      { slot: "K", count: 1, eligible: ["K"] },
    ]);
    const tqb = Object.values(s.players).filter((p) => Number(p.ids.espn) <= -15000 && Number(p.ids.espn) > -16000);
    expect(tqb.length).toBeGreaterThan(0);
    for (const p of tqb) expect(p).toMatchObject({ pos: "QB", eligible: ["QB"], id: `espn:${p.ids.espn}` });
    expect(codes(s)).toContain("ESPN_TQB_AS_QB");
  });

  it("skips its head-coach win-margin rules (worth 0 to a head coach; it starts none) instead of listing them as unmapped", () => {
    expect(codes(s)).not.toContain("ESPN_HC_UNMAPPED");
    expect(s.settings.scoring.unmapped.map((u) => u.platformKey).sort()).toEqual(["209", "93"]);
    expect(s.warnings.filter((w) => w.code === "ESPN_SCORING_UNMAPPED")).toHaveLength(2);
  });

  it("reads its settings: FAAB, a review period without veto votes (inferred commissioner), limits by position", () => {
    expect(s.settings).toMatchObject({ numTeams: 10, benchSlots: 7, irSlots: 2, maxRosterSize: 15, playoffTeams: 4, playoffByes: 0, faabBudget: 200, tradeReview: "commissioner", leagueType: "redraft" });
    expect(s.settings.regularSeasonWeeks).toHaveLength(15);
    expect(s.settings.playoffWeeks).toEqual([16, 17]);
    expect(s.settings.positionLimits).toEqual({ QB: 2, RB: 10, WR: 10, TE: 10, K: 2, P: 0, DEF: 3, DL: 0, LB: 0, DB: 0 });
    expect(notes.join("\n")).toMatch(/commissioner reviews trades \(inferred\)/);
    expect(s.myTeamId).toBeNull();
    expect(s.freeAgents).toEqual([]);
  });
});

describe("normalizeEspnLeague edge cases", () => {
  const base = () => clone(readEspn<Json>(LABELS.league));
  const run = (league: Json, extra: Partial<EspnRawBundle> = {}, ctx: Partial<Parameters<typeof normalizeEspnLeague>[1]> = {}) => normalizeEspnLeague({ league, ...extra }, { leagueId: "1", resolver: fakeResolver(), now: NOW, ...ctx });

  it("rejects a response missing a required field with BAD_RESPONSE naming the JSON path", () => {
    const league = base();
    delete league.settings.size;
    let err: unknown;
    try {
      run(league);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LeagueImportError);
    expect(err).toMatchObject({ code: "BAD_RESPONSE", detail: { platform: "espn", path: "settings.size" } });
  });

  it("leaves head coaches out of rosters, maps DAY_TO_DAY, and flags injury statuses it doesn't know", () => {
    const league = base();
    const entries = league.teams[0].roster.entries;
    const hc = clone(entries[0]);
    hc.playerId = hc.playerPoolEntry.id = hc.playerPoolEntry.player.id = 999001;
    hc.playerPoolEntry.player.defaultPositionId = 14;
    entries.push(hc);
    entries[1].playerPoolEntry.player.injuryStatus = "DAY_TO_DAY";
    entries[2].playerPoolEntry.player.injuryStatus = "PATERNITY";
    const s = run(league).snapshot;
    expect(Object.values(s.players).some((p) => p.ids.espn === "999001")).toBe(false);
    const hcWarning = s.warnings.find((w) => w.code === "ESPN_HC_UNMAPPED");
    expect(hcWarning?.message).toMatch(/1 head coach .*Team 1/);
    const byEspn = (id: number) => Object.values(s.players).find((p) => p.ids.espn === String(id));
    expect(byEspn(entries[1].playerId)?.injury).toBe("QUESTIONABLE");
    // "NA" means "not an active NFL player"; an unknown ESPN status is treated as healthy, with a warning.
    expect(byEspn(entries[2].playerId)?.injury).toBe("ACTIVE");
    expect(s.warnings.find((w) => w.code === "ESPN_INJURY_UNKNOWN")?.message).toMatch(/PATERNITY.*treated as healthy/);
  });

  it("reads divisions, keeper/dynasty (inferred from keeperCount), points-only, no deadline and no review", () => {
    const league = base();
    league.settings.scheduleSettings.divisions = [{ id: 0, size: 5 }, { id: 1, size: 5 }];
    league.teams.forEach((t: Json, i: number) => (t.divisionId = i % 2));
    league.settings.draftSettings.keeperCount = 3;
    league.settings.scoringSettings.scoringType = "TOTAL_POINTS";
    delete league.settings.tradeSettings.deadlineDate;
    league.settings.tradeSettings.vetoVotesRequired = 0;
    league.settings.tradeSettings.revisionHours = 0;
    const { snapshot: s, notes } = run(league);
    expect(s.settings.divisions).toEqual([
      { id: "0", teamIds: ["1", "3", "5", "7", "9"] },
      { id: "1", teamIds: ["2", "4", "6", "8", "10"] },
    ]);
    expect(s.teams[0]?.divisionId).toBe("0");
    expect(codes(s)).toContain("ESPN_SEEDING_DIVISIONS_UNKNOWN");
    expect(s.settings).toMatchObject({ leagueType: "keeper", pointsOnly: true, tradeDeadline: null, tradeReview: "none" });
    expect(notes.join("\n")).toMatch(/keeper count \(keeperCount 3\)/);
    league.settings.draftSettings.keeperCount = 16;
    league.settings.draftSettings.keeperCountFuture = 16;
    expect(run(league).snapshot.settings.leagueType).toBe("dynasty");
  });

  it("reads next season's keeper count too: a league keeping players only from next season is a keeper league (review ESPN-6)", () => {
    const league = base();
    league.settings.draftSettings.keeperCount = 0;
    league.settings.draftSettings.keeperCountFuture = 3;
    const { snapshot: s, notes } = run(league);
    expect(s.settings.leagueType).toBe("keeper");
    expect(notes.join("\n")).toMatch(/next season's keeper count \(keeperCountFuture 3\)/);
    expect(s.warnings.find((w) => w.code === "ESPN_KEEPER_COUNTS_DIFFER")?.message).toMatch(/0 keepers this season and 3 under keeperCountFuture/);
    // Both 0 (Parker's league): redraft, no warning.
    expect(codes(run(base()).snapshot)).not.toContain("ESPN_KEEPER_COUNTS_DIFFER");
  });

  it("reads a 0-hour review as no review even with veto votes, and marks missing review settings unknown (review ESPN-10)", () => {
    const league = base();
    league.settings.tradeSettings.revisionHours = 0;
    league.settings.tradeSettings.vetoVotesRequired = 4;
    const { snapshot: s, notes } = run(league);
    expect(s.settings.tradeReview).toBe("none");
    expect(notes.join("\n")).toMatch(/4 veto votes but a 0-hour review period/);
    const missing = base();
    delete missing.settings.tradeSettings.revisionHours;
    delete missing.settings.tradeSettings.vetoVotesRequired;
    const m = run(missing).snapshot;
    expect(m.settings.tradeReview).toBe("none");
    expect(m.settings.unknownSettings).toEqual(["tradeReview"]);
  });

  it("warns about home-team bonus points and playoff round lengths that disagree with the schedule (review ESPN-10)", () => {
    const league = base();
    league.settings.scoringSettings.homeTeamBonus = 2;
    league.settings.scheduleSettings.playoffMatchupPeriodLength = 2;
    const s = run(league).snapshot;
    expect(s.warnings.find((w) => w.code === "ESPN_HOME_TEAM_BONUS")?.message).toMatch(/2 in the regular season/);
    expect(s.warnings.find((w) => w.code === "ESPN_PLAYOFF_ROUND_LENGTH")?.message).toMatch(/rounds of 2 week\(s\), but its schedule has playoff rounds of 1, 1, 1 week\(s\)/);
    expect(s.settings.playoffRoundWeeks).toBeUndefined(); // the schedule (one-week rounds) wins
    const byRound = base();
    byRound.settings.scheduleSettings.variablePlayoffMatchupPeriodLength = true;
    byRound.settings.scheduleSettings.playoffMatchupPeriodLengthByRound = { 1: 1, 2: 1, 3: 2 };
    expect(codes(run(byRound).snapshot)).toContain("ESPN_PLAYOFF_ROUND_LENGTH");
    byRound.settings.scheduleSettings.playoffMatchupPeriodLengthByRound = { 1: 1, 2: 1, 3: 1 };
    expect(codes(run(byRound).snapshot)).not.toContain("ESPN_PLAYOFF_ROUND_LENGTH");
  });

  it("leaves playoff seeding unknown when ESPN doesn't report re-seeding (review COMP-7)", () => {
    const league = base();
    delete league.settings.scheduleSettings.playoffReseed;
    const s = run(league).snapshot;
    expect(s.settings.playoffSeeding).toBeUndefined();
    expect(s.settings.unknownSettings).toEqual(["playoffSeeding"]);
    expect(codes(s)).toContain("ESPN_SEEDING_UNKNOWN");
  });

  it("lists multi-week playoff rounds, skips consolation games, and warns about multi-week regular-season periods", () => {
    const league = base();
    league.settings.scheduleSettings.matchupPeriods = { ...league.settings.scheduleSettings.matchupPeriods, "14": [14, 15], "15": [16], "16": [17, 18] };
    delete league.settings.scheduleSettings.matchupPeriods["17"];
    league.settings.scheduleSettings.playoffTeamCount = 4;
    league.schedule.push({ matchupPeriodId: 15, home: { teamId: 1 }, away: { teamId: 2 }, playoffTierType: "WINNERS_BRACKET" }, { matchupPeriodId: 15, home: { teamId: 3 }, away: { teamId: 4 }, playoffTierType: "LOSERS_CONSOLATION_LADDER" }, { matchupPeriodId: 16, home: { teamId: 1 } });
    const { snapshot: s, notes } = run(league);
    expect(s.settings.playoffWeeks).toEqual([16, 17, 18]);
    expect(s.settings.playoffRoundWeeks).toEqual([1, 2]);
    expect(s.schedule.filter((m) => m.isPlayoff)).toEqual([
      { week: 16, teamA: "1", teamB: "2", isPlayoff: true },
      { week: 17, teamA: "1", teamB: null, isPlayoff: true },
    ]);
    expect(notes.join("\n")).toMatch(/1 consolation-bracket game/);
    expect(codes(s)).toContain("ESPN_MULTIWEEK_MATCHUPS");
  });

  it("counts a completed trade once (accept + uphold) and warns that ESPN trade rows are unverified", () => {
    const leg = (playerId: number, from: number, to: number) => ({ playerId, type: "TRADE", fromTeamId: from, toTeamId: to });
    const tx = (id: string, type: string, items?: Json[]) => ({ id, type, status: "EXECUTED", scoringPeriodId: 4, teamId: 1, processDate: Date.parse("2026-09-29T12:00:00Z"), ...(items ? { items } : {}) });
    const legs = [leg(3929630, 1, 2), leg(3043078, 2, 1)];
    const transactions = [{ transactions: [tx("a", "TRADE_ACCEPT", legs), tx("b", "TRADE_UPHOLD", legs), tx("c", "TRADE_ACCEPT"), tx("d", "TRADE_DECLINE", legs), tx("e", "TRADE_VETO", legs)] }];
    const s = run(base(), { transactions }).snapshot;
    const trades = s.transactions.filter((t) => t.type === "trade");
    expect(trades).toHaveLength(2);
    expect(trades.find((t) => t.id === "a")).toMatchObject({ teams: ["1", "2"], week: 4, timestamp: "2026-09-29T12:00:00.000Z" });
    expect(trades.find((t) => t.id === "a")?.moves.map((m) => [m.from, m.to])).toEqual([["1", "2"], ["2", "1"]]);
    expect(codes(s)).toEqual(expect.arrayContaining(["ESPN_TRADES_UNVERIFIED", "ESPN_TRADE_WITHOUT_PLAYERS"]));
  });

  it("counts an itemless trade once when ESPN lists both its TRADE_ACCEPT and TRADE_UPHOLD, and flags an executed trade without traded players", () => {
    const row = (id: string, type: string, extra: Json = {}) => ({ id, type, status: "EXECUTED", scoringPeriodId: 4, teamId: 6, relatedTransactionId: "prop-1", processDate: Date.parse("2026-09-29T12:00:00Z"), ...extra });
    const s = run(base(), { transactions: [{ transactions: [row("a", "TRADE_ACCEPT"), row("u", "TRADE_UPHOLD")] }] }).snapshot;
    expect(s.transactions.filter((t) => t.type === "trade").map((t) => t.id)).toEqual(["a"]);
    expect(s.warnings.find((w) => w.code === "ESPN_TRADES_UNVERIFIED")?.message).toMatch(/^1 completed trade/);
    // The live in-review row, executed as it came (only the accepting team's roster-space DROP): a trade without players.
    const drop = row("d", "TRADE_ACCEPT", { teamId: 10, relatedTransactionId: "prop-2", items: [{ playerId: 4429160, type: "DROP", fromTeamId: 10, toTeamId: 0 }] });
    const d = run(base(), { transactions: [{ transactions: [drop] }] }).snapshot;
    expect(d.transactions).toMatchObject([{ id: "d", type: "trade", teams: ["10"] }]);
    expect(codes(d)).toContain("ESPN_TRADE_WITHOUT_PLAYERS");
    // Two different itemless trades (different proposals) both count.
    const two = run(base(), { transactions: [{ transactions: [row("a", "TRADE_ACCEPT"), row("b", "TRADE_ACCEPT", { relatedTransactionId: "prop-3" })] }] }).snapshot;
    expect(two.transactions.filter((t) => t.type === "trade")).toHaveLength(2);
  });

  it("skips a trade still in review (TRADE_ACCEPT without a status, as seen live) and drops only rows it can't read", () => {
    const row = (id: string, extra: Json) => ({ id, scoringPeriodId: 4, teamId: 10, proposedDate: Date.parse("2026-09-29T10:00:00Z"), ...extra });
    const inReview = row("r", { type: "TRADE_ACCEPT", items: [{ playerId: 4429160, type: "DROP", fromTeamId: 10, toTeamId: 0 }] });
    const added = row("x", { type: "FREEAGENT", status: "EXECUTED", items: [{ playerId: 3929630, type: "ADD", fromTeamId: 0, toTeamId: 10 }] });
    const broken = row("y", { type: "WAIVER", status: "EXECUTED", scoringPeriodId: "four" });
    const { snapshot: s, notes } = run(base(), { transactions: [{ transactions: [inReview, added, broken] }] });
    expect(s.transactions.map((t) => [t.id, t.type])).toEqual([["x", "add"]]);
    expect(notes).toContain("1 accepted trade is still in the league's review period, so it isn't counted yet.");
    expect(s.warnings.filter((w) => w.code === "ESPN_TRANSACTIONS_UNREADABLE").map((w) => w.message)).toEqual(["1 transaction row(s) came in a shape we don't recognize and were skipped."]);
    expect(codes(s)).not.toContain("ESPN_TRADES_UNVERIFIED");
  });

  it("keeps at most 50 free agents per position, best projection first", () => {
    const qb = (i: number) => ({ id: 900000 + i, onTeamId: 0, status: "FREEAGENT", player: { id: 900000 + i, fullName: `Zorblax Quintavious ${i}`, defaultPositionId: 1, eligibleSlots: [0, 7, 20, 21], proTeamId: 1, stats: [{ seasonId: 2026, scoringPeriodId: 4, statSourceId: 1, statSplitTypeId: 1, appliedTotal: i }] } });
    const s = run(base(), { freeAgents: [{ players: Array.from({ length: 60 }, (_, i) => qb(i)) }] }).snapshot;
    const ids = s.freeAgents.map((id) => Number(s.players[id]?.ids.espn));
    expect(ids).toHaveLength(FREE_AGENTS_PER_POSITION);
    expect(ids[0]).toBe(900059);
    expect(ids.at(-1)).toBe(900010);
  });

  it("keeps a free agent who is on bye or hurt this week (weekly projection 0) when his rest of season ranks (review ESPN-1)", () => {
    const line = (split: number, appliedTotal: number) => ({ seasonId: 2026, scoringPeriodId: split === 1 ? 4 : 0, statSourceId: 1, statSplitTypeId: split, appliedTotal });
    // 60 RBs projected i points this week and 14·i over the rest of the season.
    const rb = (i: number, stats = [line(1, i), line(0, 14 * i)], injuryStatus?: string) => ({ id: 910000 + i, onTeamId: 0, status: "FREEAGENT", player: { id: 910000 + i, fullName: `Quennard Vasquel ${i}`, defaultPositionId: 2, eligibleSlots: [2, 3, 23, 20, 21], proTeamId: 1, ...(injuryStatus ? { injuryStatus } : {}), stats } });
    const pool = Array.from({ length: 60 }, (_, i) => rb(i + 1));
    const onBye = rb(100, [line(1, 0), line(0, 13 * 40)]); // bye this week: 0 now, 13 games left at 40
    const doubtful = rb(101, [line(1, 0), line(0, 12 * 30)], "DOUBTFUL"); // out this week, 12 games at 30
    const noSeasonLine = rb(102, [line(1, 35)]); // only a weekly line: 35 × 14 weeks left (4…17)
    const s = run(base(), { freeAgents: [{ players: [...pool, onBye, doubtful, noSeasonLine] }] }).snapshot;
    const kept = s.freeAgents.map((id) => Number(s.players[id]?.ids.espn));
    expect(kept).toHaveLength(FREE_AGENTS_PER_POSITION);
    expect(kept).toEqual(expect.arrayContaining([910100, 910101, 910102]));
    expect(kept[0]).toBe(910060);
    expect(kept.indexOf(910100)).toBeLessThan(kept.indexOf(910102));
    expect(s.players[s.freeAgents[kept.indexOf(910101)] as string]?.injury).toBe("DOUBTFUL");
  });

  it("degrades to warnings when a secondary response is unreadable", () => {
    const s = run(base(), { transactions: [{ transactions: [{ id: 1 }] }], freeAgents: [{ nope: true }], proTeamSchedules: { settings: {} } }).snapshot;
    expect(codes(s)).toEqual(expect.arrayContaining(["ESPN_TRANSACTIONS_UNREADABLE", "ESPN_FREE_AGENTS_UNREADABLE", "ESPN_SCHEDULE_UNREADABLE"]));
    expect(s.settings.tradeDeadline).toEqual({ date: "2026-12-02T17:00:00.000Z" });
  });

  it("keeps an ESPN id when the resolver maps two players to one Sleeper id, names him, and neither notes nor warns about a conflict on him; takes ages from the resolver", () => {
    const resolver = fakeResolver({ ages: { "4866": 27 } });
    const clash: PlayerIdResolver = {
      ...resolver,
      canonical: (source, id) => (id === "3929630" || id === "3043078" ? "4866" : resolver.canonical(source, id)),
      // The player who loses the id also comes with an override: he doesn't keep 4866, so there's nothing to note.
      conflict: (_source, id) => (id === "3043078" ? conflictFor(id, "4866", "same player") : undefined),
    };
    const { snapshot: s, notes } = run(base(), {}, { resolver: clash });
    const ids = ["3929630", "3043078"].map((e) => Object.values(s.players).find((p) => p.ids.espn === e));
    expect(ids.map((p) => p?.id).sort()).toEqual(["4866", "espn:3043078"].sort());
    expect(ids.find((p) => p?.id === "4866")?.age).toBe(27);
    const loser = ids.find((p) => p?.id === "espn:3043078");
    const collision = s.warnings.find((w) => w.code === "ESPN_ID_COLLISION")?.message;
    expect(collision).toMatch(/^1 player matched a Sleeper id already used by another player, so he keeps his ESPN id: /);
    expect(collision).toContain(`${loser?.name} (${loser?.pos}`);
    expect(idNotes(notes)).toEqual([]);
    expect(codes(s)).not.toContain("ESPN_ID_CONFLICT");
  });

  it("matches a player no ID source maps by exact name, position and NFL team, and says so", () => {
    const league = base();
    const kicker = (league.teams as Json[]).flatMap((t) => (t.roster.entries as Json[]).map((e) => e.playerPoolEntry.player as Json)).find((p) => p.defaultPositionId === 5) as Json;
    const resolver = fakeResolver();
    const queries: Array<{ name: string; position: string; team: string | null }> = [];
    const withNames = {
      ...resolver,
      canonical: (source: "espn", id: string) => (id === String(kicker.id) ? undefined : resolver.canonical(source, id)),
      matchByName: (q: { name: string; position: string; team: string | null }) => {
        queries.push(q);
        return q.name === kicker.fullName && q.position === "K" ? "99001" : undefined;
      },
    };
    const s = run(league, {}, { resolver: withNames }).snapshot;
    expect(s.players["99001"]).toMatchObject({ name: kicker.fullName, pos: "K", ids: { espn: String(kicker.id), sleeper: "99001" } });
    expect(queries).toContainEqual({ name: kicker.fullName, position: "K", team: expect.any(String) });
    expect(s.warnings).toContainEqual(expect.objectContaining({ code: "ESPN_PLAYER_MATCHED_BY_NAME", message: expect.stringContaining(kicker.fullName) }));
    // Without the fallback the player keeps his ESPN id, and nothing is claimed.
    const plain = run(base(), {}, { resolver: { ...resolver, canonical: withNames.canonical } }).snapshot;
    expect(plain.players[`espn:${kicker.id}`]).toBeDefined();
    expect(codes(plain)).not.toContain("ESPN_PLAYER_MATCHED_BY_NAME");
  });

  it("warns about league players whose ESPN id the ID sources map to different players, resolved by source order (resolver.conflict)", () => {
    const league = base();
    const rostered = league.teams[0].roster.entries[0].playerPoolEntry.player as Json;
    const resolver = fakeResolver();
    const conflicted: PlayerIdResolver = {
      ...resolver,
      conflict: (source, id) => (source === "espn" && (id === String(rostered.id) || id === "99999999") ? conflictFor(id, resolver.canonical(source, id) ?? "1", "source order") : undefined),
    };
    const { snapshot: s, notes } = run(league, {}, { resolver: conflicted });
    const w = s.warnings.find((x) => x.code === "ESPN_ID_CONFLICT");
    expect(w?.message).toContain(rostered.fullName);
    expect(w?.message).toMatch(/^The player ID sources disagree about who 1 ESPN player id in this league belongs to/);
    expect(idNotes(notes)).toEqual([]);
    expect(codes(run(base()).snapshot)).not.toContain("ESPN_ID_CONFLICT");
  });

  it("names every player matched by name in the snapshot: more than 10, none from the rest of ESPN's pool, none that collided (Checkpoint 1 answer 1)", () => {
    const taken = run(base()).snapshot.teams.flatMap((t) => t.roster).find((id) => /^\d+$/.test(id)) as string; // a rostered player's Sleeper id
    const pool = Array.from({ length: 55 }, (_, i) => poolKicker(96_000_000, i));
    const resolver = fakeResolver();
    const withNames: PlayerIdResolver = {
      ...resolver,
      matchByName: (q) => {
        const m = /^Zorblax Kickwell (\d+)$/.exec(q.name);
        if (!m || q.position !== "K" || q.team !== "GB") return undefined;
        return m[1] === "3" ? taken : String(960_000 + Number(m[1]));
      },
    };
    const s = run(base(), { freeAgents: [{ players: pool }] }, { resolver: withNames }).snapshot;
    const w = s.warnings.find((x) => x.code === "ESPN_PLAYER_MATCHED_BY_NAME")?.message ?? "";
    expect(w).toMatch(/^49 players aren't in any player ID source, so we matched each to the only active player with the same name, position and NFL team\. Free agents: Zorblax Kickwell 0 \(K, GB\); /);
    for (let i = 0; i < FREE_AGENTS_PER_POSITION; i++) if (i !== 3) expect(w).toContain(`Zorblax Kickwell ${i} (K, GB)`);
    expect(w).not.toContain("…");
    // #50–#54 aren't among the 50 kept, so they're in neither the snapshot nor the warning.
    for (let i = FREE_AGENTS_PER_POSITION; i < 55; i++) {
      expect(w).not.toContain(`Zorblax Kickwell ${i} (`);
      expect(s.players[String(960_000 + i)]).toBeUndefined();
    }
    // #3's match is a Sleeper id a rostered player holds: he keeps his ESPN id and is named as a collision, not as a match.
    expect(w).not.toContain("Zorblax Kickwell 3 (");
    expect(s.players["espn:96000003"]).toMatchObject({ name: "Zorblax Kickwell 3", ids: { espn: "96000003" } });
    expect(s.warnings.find((x) => x.code === "ESPN_ID_COLLISION")?.message).toBe("1 player matched a Sleeper id already used by another player, so he keeps his ESPN id: Zorblax Kickwell 3 (K, GB).");
  });

  it("notes every same-player override on a player in the snapshot, uncapped, and warns only about the other conflicts (Checkpoint 1 answer 2)", () => {
    // 55 free-agent kickers mapped with a conflict: overrides for #0–#11 and for #50–#54 (not kept), source order for #12–#14.
    const BASE = 97_000_000;
    const pool = Array.from({ length: 55 }, (_, i) => poolKicker(BASE, i));
    const resolvedBy = (i: number): CrosswalkConflict["resolvedBy"] | undefined => (i < 0 || i >= 55 ? undefined : i < 12 || i >= 50 ? "same player" : i < 15 ? "source order" : undefined);
    const resolver = fakeResolver();
    const index = (id: string) => (Number(id) >= BASE && Number(id) < BASE + 1000 ? Number(id) - BASE : -1);
    const withConflicts: PlayerIdResolver = {
      ...resolver,
      canonical: (source, id) => (index(id) >= 0 ? String(970_000 + index(id)) : resolver.canonical(source, id)),
      conflict: (_source, id) => {
        const by = resolvedBy(index(id));
        return by ? conflictFor(id, String(970_000 + index(id)), by) : undefined;
      },
    };
    const { snapshot: s, notes } = run(base(), { freeAgents: [{ players: pool }] }, { resolver: withConflicts });
    const noted = idNotes(notes);
    expect(noted).toHaveLength(12);
    for (let i = 0; i < 12; i++) expect(noted[i]).toContain(`the ID sources disagree on Zorblax Kickwell ${i} (K, GB), ESPN id ${BASE + i}: DynastyProcess links Sleeper id 999001; FantasyCalc links ${970_000 + i}. We use ${970_000 + i}:`);
    expect(noted.join("\n")).not.toMatch(/Kickwell 5[0-4] /);
    const w = s.warnings.find((x) => x.code === "ESPN_ID_CONFLICT")?.message ?? "";
    expect(w).toMatch(/^The player ID sources disagree about who 3 ESPN player ids in this league belong to; /);
    for (const i of [12, 13, 14]) expect(w).toContain(`Zorblax Kickwell ${i} (K, GB)`);
    expect(w).not.toMatch(/Kickwell (\d|1[01]) \(/); // the overrides are notes, not warnings
    // Only overrides: notes, and no ESPN_ID_CONFLICT warning at all.
    const onlyOverrides: PlayerIdResolver = { ...withConflicts, conflict: (source, id) => (index(id) >= 0 && index(id) < 12 ? withConflicts.conflict?.(source, id) : undefined) };
    const o = run(base(), { freeAgents: [{ players: pool }] }, { resolver: onlyOverrides });
    expect(idNotes(o.notes)).toHaveLength(12);
    expect(codes(o.snapshot)).not.toContain("ESPN_ID_CONFLICT");
  });
});

describe("player ids through the real crosswalk (src/data resolverFromData; CLAUDE.md §2.9 crosswalk rules)", () => {
  const run = (freeAgents: unknown[], resolver: PlayerIdResolver) => normalizeEspnLeague({ league: clone(readEspn<Json>(LABELS.league)), freeAgents: [{ players: freeAgents }] }, { leagueId: "1", resolver, now: NOW });

  it("turns the real Sam Hartman override (ESPN 4361994) on a kept free agent into one note and no warning", () => {
    // The public rows behind it (crosswalk.test.ts has the full case): DynastyProcess links Sleeper
    // 11376 (not an active fantasy player), FantasyCalc links his active record 11558.
    const resolver = resolverFromData({
      sleeperPlayers: [sleeperRecord("11558", "Sam Hartman", "QB", "WAS")],
      dynastyRows: [{ sleeperId: "11376", espnId: "4361994", yahooId: null, mflId: "16587", fleaflickerId: null, sportradarId: "007971f0-f012-11ed-833c-ebfbb713adc7", gsisId: "00-0039677", name: "Sam Hartman", position: "QB", team: "WAS" }],
      fantasyCalcPlayers: [{ fantasyCalcId: "11709", name: "Sam Hartman", position: "QB", sleeperId: "11558", espnId: "4361994", mflId: "16587", fleaflickerId: null, team: "WAS" }],
    });
    const hartman = { id: 4361994, onTeamId: 0, status: "FREEAGENT", player: { id: 4361994, fullName: "Sam Hartman", defaultPositionId: 1, eligibleSlots: [0, 7, 20, 21], proTeamId: 28, stats: [{ seasonId: 2026, scoringPeriodId: 4, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 5 }] } };
    const { snapshot: s, notes } = run([hartman], resolver);
    expect(s.freeAgents).toContain("11558");
    expect(s.players["11558"]).toMatchObject({ name: "Sam Hartman", pos: "QB", nflTeam: "WAS", age: 27, ids: { espn: "4361994", sleeper: "11558" } });
    expect(idNotes(notes)).toEqual([
      "Player IDs: the ID sources disagree on Sam Hartman (QB, WSH), ESPN id 4361994: DynastyProcess links Sleeper id 11376; FantasyCalc links 11558. We use 11558: 11376 isn't one of Sleeper's active fantasy players, and 11558 is an active player whose name, position and NFL team match DynastyProcess's record.",
    ]);
    expect(codes(s)).not.toContain("ESPN_ID_CONFLICT");
  });

  it("matches a kept free agent no source maps by name, position and NFL team, but never one without an NFL team (Checkpoint 1 answer 1)", () => {
    const resolver = resolverFromData({ sleeperPlayers: [sleeperRecord("99101", "Zorblax Kickwell 0", "K", "GB"), sleeperRecord("99102", "Quennard Vasquel", "K", null)], dynastyRows: [], fantasyCalcPlayers: [] });
    // The first plays for GB (proTeamId 9). The second has no NFL team (proTeamId 0) and is the only
    // active kicker with his name, also without a team: still no match.
    const teamless = poolKicker(98_000_000, 1, 0);
    const { snapshot: s } = run([poolKicker(98_000_000, 0), { ...teamless, player: { ...teamless.player, fullName: "Quennard Vasquel" } }], resolver);
    expect(s.players["99101"]).toMatchObject({ name: "Zorblax Kickwell 0", ids: { espn: "98000000", sleeper: "99101" } });
    expect(s.players["espn:98000001"]).toMatchObject({ name: "Quennard Vasquel", nflTeam: null });
    expect(s.players["99102"]).toBeUndefined();
    expect(s.warnings.find((w) => w.code === "ESPN_PLAYER_MATCHED_BY_NAME")?.message).toBe(
      "1 player isn't in any player ID source, so we matched him to the only active player with the same name, position and NFL team. Free agents: Zorblax Kickwell 0 (K, GB).",
    );
  });
});

describe("idOverrideNote (CLAUDE.md §2.9: log every override in the Import Report notes)", () => {
  it("says which sources disagreed, which Sleeper id we use and why, for the two real overrides", () => {
    expect(
      idOverrideNote(
        { espnId: 3116104, label: "Chris Jones (DB)" },
        {
          source: "espn",
          platformId: "3116104",
          options: [
            { sleeperId: "2682", from: ["dynastyProcess", "fantasyCalc"], active: false },
            { sleeperId: "5815", from: ["sleeper"], active: true },
          ],
          chosen: "5815",
          resolvedBy: "same player",
          sameBy: ["gsis"],
          withinSource: false,
        },
      ),
    ).toBe(
      "Player IDs: the ID sources disagree on Chris Jones (DB), ESPN id 3116104: DynastyProcess and FantasyCalc link Sleeper id 2682; Sleeper's player database links 5815. We use 5815: 2682 isn't one of Sleeper's active fantasy players, and 5815 is an active player whose name, position and NFL player ID (GSIS) match DynastyProcess's record.",
    );
    // Both matched, and a resolver that doesn't say what matched.
    const both = conflictFor("1", "970000", "same player");
    expect(idOverrideNote({ espnId: 1, label: "Zorblax Kickwell 0 (K, GB)" }, { ...both, sameBy: ["team", "gsis"] })).toContain("whose name, position, NFL team and NFL player ID (GSIS) match DynastyProcess's record.");
    const unsaid: CrosswalkConflict = { source: "espn", platformId: "1", options: both.options, chosen: "970000", resolvedBy: "same player", withinSource: false };
    expect(idOverrideNote({ espnId: 1, label: "Zorblax Kickwell 0 (K, GB)" }, unsaid)).toContain("whose name and position, plus NFL team or NFL player ID (GSIS), match DynastyProcess's record.");
  });
});
