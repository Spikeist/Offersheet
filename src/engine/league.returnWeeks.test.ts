/**
 * The user's own return weeks in the League model (Checkpoint 7e; planner reply to Checkpoint 7d, item 3.5; league.ts step
 * 3): PlayerModel.expectedReturn on my players the model has out now (the platform's date, our guess, the user's week), a
 * week of the user's followed by availability, the IR returners' week, the conflict note and every trade context, entries
 * that don't count ignored, and without any every number as before. Made-up players, placeholder teams.
 */
import { describe, expect, it } from "vitest";
import { config } from "./config";
import { analyzeTrade, buildTradeContext, tradeInternals } from "./evaluate";
import { buildLeagueModel, buildLeagueModelWithContext, buildProjectionTable, preKickoffTable, type BuildLeagueModelOptions, type LeagueModelConfig } from "./league";
import type { LeagueModel } from "./leagueModel";
import type { Pos } from "./model";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW, buildTestLeague, type TestLeagueSpec, type TestPlayer } from "./testLeague";
import { roundRobin } from "./trade.testing";

const ZERO_MISS: Record<Pos, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, P: 0, DEF: 0, DL: 0, LB: 0, DB: 0 };
/** No future injury risk: availability is then the return weeks alone (the hand-built cases stay obvious). */
const NO_RISK: LeagueModelConfig = { ...config, projections: { ...config.projections, injuryRisk: { ...config.projections.injuryRisk, missShare: ZERO_MISS } } };
/** My team streams nothing (the default streams K and D/ST). */
const NO_STREAMING: TradeSettings = { ...defaultTradeSettings(), streamPositions: [] };

const p = (id: string, pos: Pos, points: TestPlayer["points"], extra: Partial<TestPlayer> = {}): TestPlayer => ({ id, pos, points, ...extra });

/** A full starting lineup at strength s and a bench RB. */
function roster(team: string, s = 1): TestPlayer[] {
  return [
    p(`${team}-qb`, "QB", 20 * s),
    p(`${team}-rb1`, "RB", 15 * s),
    p(`${team}-rb2`, "RB", 9 * s),
    p(`${team}-wr1`, "WR", 15 * s),
    p(`${team}-wr2`, "WR", 13 * s),
    p(`${team}-te`, "TE", 10 * s),
    p(`${team}-flex`, "WR", 11 * s),
    p(`${team}-k`, "K", 8),
    p(`${team}-def`, "DEF", 7),
    p(`${team}-bRB`, "RB", 4),
  ];
}

/** Sleeper doesn't project him this week (week 4): an ESPN date two weeks out or more is followed (§6 step 3). */
const notThisWeek = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [i + 1, i + 1 === 4 ? 0 : 12]));

/**
 * Week 4 of a season whose NFL regular season ends in week 18. Team 1 (mine): out now, an RB (no date: our guess, next
 * week), a Questionable RB whose ESPN week 7 his numbers follow, and on IR an RB back in ESPN's week 8, a WR whose ESPN date
 * has passed (our guess: the week after this one) and a TE out for the season (ESPN's week 19). Team 2 has an OUT RB.
 */
function league(edit: (spec: TestLeagueSpec) => void = () => undefined) {
  const spec: TestLeagueSpec = {
    teams: [
      {
        id: "1",
        roster: [...roster("1"), p("my-out", "RB", 12, { injury: "OUT" }), p("my-q", "RB", notThisWeek, { injury: "QUESTIONABLE", injuryReturnWeek: 7 })],
        ir: [p("my-ir", "RB", 18, { injury: "IR", injuryReturnWeek: 8 }), p("my-ir-past", "WR", 9, { injury: "IR", injuryReturnWeek: 3 }), p("my-ir-season", "TE", 8, { injury: "IR", injuryReturnWeek: 19 })],
      },
      { id: "2", roster: [...roster("2", 0.9), p("their-out", "RB", 14, { injury: "OUT", injuryReturnWeek: 6 })] },
    ],
    freeAgents: [p("fa-rb", "RB", 3), p("fa-wr", "WR", 3)],
    nflLastWeek: 18,
  };
  edit(spec);
  return buildTestLeague(spec);
}

const OPTS: BuildLeagueModelOptions = { now: TEST_NOW, scenarios: 0, sims: 0, settings: NO_STREAMING };
/** The test league's season (testLeague.ts): the user's weeks are set for it (TradeSettings.returnWeeksSeason; review of wave C, UI-C-3). */
const SEASON = 2026;
const withWeeks = (returnWeeks: Record<string, number>, opts: BuildLeagueModelOptions = OPTS, season: number | null = SEASON): BuildLeagueModelOptions => ({ ...opts, settings: { ...NO_STREAMING, returnWeeks, returnWeeksSeason: season } });
/** A model's numbers as JSON, its stage timings left out (they're clock readings). */
const numbers = (m: LeagueModel): string => JSON.stringify({ ...m, timings: {} });

describe("PlayerModel.expectedReturn: when my injured players are expected back", () => {
  const l = league();
  const m = buildLeagueModel(l.snapshot, l.inputs, OPTS, NO_RISK);

  it("marks the platform's date where his numbers follow it, our guess elsewhere, and out for the season as null", () => {
    expect(m.players["my-ir"]?.expectedReturn).toEqual({ week: 8, source: "platform", fallback: { week: 8, source: "platform" } });
    expect(m.players["my-q"]?.expectedReturn).toEqual({ week: 7, source: "platform", fallback: { week: 7, source: "platform" } });
    expect(m.players["my-q"]?.availabilityNote?.used).toBe("returnDate");
    // OUT without a date: the OUT table, back next week (50%).
    expect(m.players["my-out"]?.expectedReturn).toEqual({ week: 5, source: "model", fallback: { week: 5, source: "model" } });
    // An ESPN date that has passed: our guess, the first week he can be back.
    expect(m.players["my-ir-past"]?.expectedReturn).toEqual({ week: 5, source: "model", fallback: { week: 5, source: "model" } });
    expect(m.players["my-ir-season"]?.expectedReturn).toEqual({ week: null, source: "platform", fallback: { week: null, source: "platform" } });
  });

  it("is mine only: never another team's player, a healthy player of mine, or one without an NFL team", () => {
    expect(m.players["their-out"]?.expectedReturn).toBeUndefined();
    expect(m.players["1-qb"]?.expectedReturn).toBeUndefined();
    const teamless = league((spec) => {
      const ir = spec.teams[0]?.ir?.find((x) => x.id === "my-ir");
      if (ir) ir.nflTeam = null;
    });
    expect(buildLeagueModel(teamless.snapshot, teamless.inputs, OPTS, NO_RISK).players["my-ir"]?.expectedReturn).toBeUndefined();
  });

  it("is set for nobody without a team of mine", () => {
    const noTeam = buildLeagueModel({ ...l.snapshot, myTeamId: null }, l.inputs, OPTS, NO_RISK);
    expect(Object.values(noTeam.players).some((pm) => pm.expectedReturn)).toBe(false);
  });
});

describe("a return week of the user's", () => {
  const l = league();
  const base = buildLeagueModel(l.snapshot, l.inputs, OPTS, NO_RISK);
  const weeks = base.weeks;

  it("is followed by his availability: 0 before it, 75% in it, all of it after (no future injuries here)", () => {
    const set = buildLeagueModel(l.snapshot, l.inputs, withWeeks({ "my-ir": 6 }), NO_RISK);
    expect(set.players["my-ir"]?.weekly.map((w) => w.a)).toEqual(weeks.map((w) => (w < 6 ? 0 : w === 6 ? 0.75 : 1)));
    expect(set.players["my-ir"]?.expectedReturn).toEqual({ week: 6, source: "user", fallback: { week: 8, source: "platform" } });
    // Every other player's projection is the same.
    for (const id of Object.keys(base.players)) if (id !== "my-ir") expect(set.players[id], id).toEqual(base.players[id]);
    // Later than the platform's too, and out for the season.
    const later = buildLeagueModel(l.snapshot, l.inputs, withWeeks({ "my-ir": 12, "my-out": 19 }), NO_RISK);
    expect(later.players["my-ir"]?.weekly.map((w) => w.a)).toEqual(weeks.map((w) => (w < 12 ? 0 : w === 12 ? 0.75 : 1)));
    expect(later.players["my-out"]?.weekly.every((w) => w.a === 0)).toBe(true);
    expect(later.players["my-out"]?.expectedReturn).toEqual({ week: null, source: "user", fallback: { week: 5, source: "model" } });
  });

  it("moves the IR returner's week (step 5b), which every lineup of his team reads", () => {
    const at = (returnWeeks: Record<string, number>) => buildLeagueModelWithContext(l.snapshot, l.inputs, withWeeks(returnWeeks), NO_RISK).context.returnWeek("my-ir");
    expect(at({})).toBe(8);
    expect(at({ "my-ir": 6 })).toBe(6);
    expect(at({ "my-ir": 19 })).toBeNull();
  });

  it("replaces both ESPN signals for a Questionable player: no conflict note, the user's week followed", () => {
    const set = buildLeagueModel(l.snapshot, l.inputs, withWeeks({ "my-q": 5 }), NO_RISK);
    const q = set.players["my-q"];
    expect(q?.availabilityNote).toBeUndefined();
    expect(q?.expectedReturn).toEqual({ week: 5, source: "user", fallback: { week: 7, source: "platform" } });
    expect(q?.weekly.map((w) => w.a)).toEqual(weeks.map((w) => (w < 5 ? 0 : w === 5 ? 0.75 : 1)));
    // His base rate stays the Q/D/P one (this week's injury-cut projection left out), read since Checkpoint 7g from his
    // first full week back: the user's week 5 rather than ESPN's week 7 (12 a game either way).
    expect(base.players["my-q"]?.base.projWeek).toBe(7);
    expect(q?.base).toEqual({ ...base.players["my-q"]?.base, projWeek: 5 });
  });

  it("is ignored when it doesn't count: another team's player, a healthy one, a week that has passed", () => {
    const ignored = buildLeagueModel(l.snapshot, l.inputs, withWeeks({ "their-out": 9, "1-qb": 9, "my-out": 3, "fa-rb": 9 }), NO_RISK);
    expect(numbers(ignored)).toBe(numbers(base));
  });

  it("is ignored when set for another season, or for none (review of wave C, UI-C-3: last season's “out for the season” held a player still listed injured out of the next one)", () => {
    for (const season of [SEASON - 1, null]) {
      const other = buildLeagueModel(l.snapshot, l.inputs, withWeeks({ "my-ir": 19, "my-q": 12 }, OPTS, season), NO_RISK);
      expect(numbers(other), String(season)).toBe(numbers(base));
      expect(other.players["my-ir"]?.expectedReturn?.source).toBe("platform");
    }
  });

  it("changes nothing without one, odds included (an empty map, or none in the settings at all)", () => {
    // Four teams playing a round robin from this week on, the top 2 in the playoffs.
    const four = league((spec) => spec.teams.push({ id: "3", roster: roster("3", 0.95) }, { id: "4", roster: roster("4", 1.05) }));
    const ids = four.snapshot.teams.map((t) => t.id);
    const snapshot = { ...four.snapshot, settings: { ...four.snapshot.settings, playoffTeams: 2 }, schedule: roundRobin(ids, four.snapshot.settings.regularSeasonWeeks.filter((w) => w >= 4)) };
    const sims = { ...OPTS, sims: 400 };
    const a = buildLeagueModel(snapshot, four.inputs, withWeeks({}, sims), NO_RISK);
    const { returnWeeks: _r, returnWeeksSeason: _s, ...older } = NO_STREAMING;
    void _r;
    void _s;
    const b = buildLeagueModel(snapshot, four.inputs, { ...sims, settings: older as TradeSettings }, NO_RISK);
    expect(a.odds).not.toBeNull();
    expect(numbers(b)).toBe(numbers(a));
    const c = buildLeagueModel(snapshot, four.inputs, withWeeks({ "my-ir": 6 }, sims), NO_RISK);
    const mine = (x: LeagueModel) => x.odds?.teams.find((t) => t.teamId === "1");
    expect(mine(c)?.expWins).toBeGreaterThan(mine(a)?.expWins ?? Number.POSITIVE_INFINITY);
  });

  it("goes with the settings into the projection tables and every trade context", () => {
    const table = buildProjectionTable(l.snapshot, l.inputs, withWeeks({ "my-ir": 6 }), NO_RISK);
    expect(table.players.players["my-ir"]?.weekly[weeks.indexOf(6)]?.a).toBe(0.75);
    // The week in progress before its first kickoff reads them too.
    const kickoffs = { 4: { AAA: "2026-09-27T17:00:00.000Z" } };
    const live = league((spec) => (spec.kickoffs = kickoffs));
    const pre = preKickoffTable(live.snapshot, live.inputs, 4, withWeeks({ "my-q": 4 }), NO_RISK);
    expect(pre?.table.rows.get("my-q")?.ev[0]).toBeCloseTo(12 * 0.75, 9);
    const I = tradeInternals(buildTradeContext(l.snapshot, l.inputs, { now: TEST_NOW, scenarios: 0, playoffWeightSims: 0, settings: { ...NO_STREAMING, returnWeeks: { "my-ir": 6 }, returnWeeksSeason: SEASON } }));
    expect(I.model.players["my-ir"]?.expectedReturn?.source).toBe("user");
    expect(I.league.returnWeek("my-ir")).toBe(6);
  });

  it("is the week a trade card's injury tag says, as his numbers follow it (review of wave C, RC-ENG-1: the tag kept ESPN's week, or lost it)", () => {
    const give = [
      { kind: "player" as const, id: "my-ir" },
      { kind: "player" as const, id: "my-q" },
    ];
    const proposal = { partnerId: "2", give, get: [{ kind: "player" as const, id: "2-rb1" }] };
    const tags = (settings: TradeSettings) => {
      const ctx = buildTradeContext(l.snapshot, l.inputs, { now: TEST_NOW, scenarios: 0, playoffWeightSims: 0, settings });
      const a = analyzeTrade(ctx, proposal, { settings });
      if (!a.evaluation) throw new Error(a.illegal ?? "no evaluation");
      return a.evaluation.flags.tagged;
    };
    // ESPN's dates as his numbers follow them: IR week 8, and the Questionable RB's far week 7.
    expect(tags(NO_STREAMING)).toEqual([
      { playerId: "my-ir", side: "give", status: "IR", returnWeek: 8 },
      { playerId: "my-q", side: "give", status: "QUESTIONABLE", returnWeek: 7 },
    ]);
    // The user's weeks: said as his, the Questionable one's next week too (§6's "far" rule doesn't apply to it).
    expect(tags({ ...NO_STREAMING, returnWeeks: { "my-ir": 6, "my-q": 5 }, returnWeeksSeason: SEASON })).toEqual([
      { playerId: "my-ir", side: "give", status: "IR", returnWeek: 6, returnSource: "user" },
      { playerId: "my-q", side: "give", status: "QUESTIONABLE", returnWeek: 5, returnSource: "user" },
    ]);
  });
});
