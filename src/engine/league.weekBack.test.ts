/**
 * His first full week back through the League model (Checkpoint 7g; planner reply to Checkpoint 7f, answer 2: "build the fix
 * ("his first full week back"), without 1a"; projections.ts's header; league.ts step 3): which players get a return week R
 * (league.returnWeekBack: availability.followsReturnWeek on what his availability reads, the platform's date unless Sleeper
 * found it stale, or a week the user set), what their base rates read, that nobody else's projection or blend factor moves
 * (with the market blend running too: review of Checkpoint 7g, jacobs-rule-test-no-blend), that a League model without such
 * a player stays bit for bit, that the stale-date tiebreaker's healthy rate leaves out the same weeks, and that every trade
 * context reads it. BuildLeagueModelOptions.firstFullWeekBack false (a switch for tests and reports: the app never sets it)
 * is Checkpoint 7f's rule. Made-up players, placeholder teams.
 */
import { describe, expect, it } from "vitest";
import { config } from "./config";
import { buildTradeContext, tradeInternals } from "./evaluate";
import { buildLeagueModel, buildLeagueModelWithContext, projectLeaguePlayers, returnWeekBack, type BuildLeagueModelOptions, type LeagueModelConfig } from "./league";
import type { LeagueModel } from "./leagueModel";
import type { Pos } from "./model";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW, buildTestLeague, type TestLeagueSpec, type TestPlayer } from "./testLeague";
import { roundRobin } from "./trade.testing";

const ZERO_MISS: Record<Pos, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, P: 0, DEF: 0, DL: 0, LB: 0, DB: 0 };
/** No future injury risk: availability is then the return weeks alone. */
const NO_RISK: LeagueModelConfig = { ...config, projections: { ...config.projections, injuryRisk: { ...config.projections.injuryRisk, missShare: ZERO_MISS } } };
/** My team streams nothing (the default streams K and D/ST). */
const NO_STREAMING: TradeSettings = { ...defaultTradeSettings(), streamPositions: [] };
const SEASON = 2026;

const p = (id: string, pos: Pos, points: TestPlayer["points"], extra: Partial<TestPlayer> = {}): TestPlayer => ({ id, pos, points, ...extra });
const weeksFrom = (from: number, to: number, v: number): Record<number, number> => Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [from + i, v]));

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

/**
 * Week 4 of a season whose NFL regular season ends in week 18. Injured players whose availability follows no known return
 * week, with a low next week each: a Questionable RB with no date, an OUT WR with no date and a Doubtful RB whose ESPN date
 * is next week (not far: the tag's table), whom the rule leaves alone; and (`stale`) a Questionable WR whose far date
 * Sleeper finds stale (it projects him at 8 this week, his healthy 10), whose projection it leaves alone too but whose
 * tiebreaker's healthy rate leaves out the weeks the date under test would (so his note moves).
 */
function others(team: string, stale = true): TestPlayer[] {
  return [
    p(`${team}-q-nodate`, "RB", { ...weeksFrom(1, 17, 11), 5: 3 }, { injury: "QUESTIONABLE" }),
    p(`${team}-out-nodate`, "WR", { ...weeksFrom(1, 17, 10), 4: 0, 5: 2 }, { injury: "OUT" }),
    p(`${team}-d-near`, "RB", { ...weeksFrom(1, 17, 9), 5: 2 }, { injury: "DOUBTFUL", injuryReturnWeek: 5 }),
    ...(stale ? [p(`${team}-q-stale`, "WR", { ...weeksFrom(1, 17, 10), 4: 8, 5: 3 }, { injury: "QUESTIONABLE", injuryReturnWeek: 7 })] : []),
  ];
}

/**
 * Josh Jacobs's shape (Questionable, ESPN back week 7, so R = 7): hurt all season, Sleeper doesn't project him this week
 * (so his date isn't stale) and hedges week 6 (3 points against 12 a game from week 7 on).
 */
const HEDGED = p("my-hedged", "RB", { ...weeksFrom(7, 17, 12), 6: 3 }, { injury: "QUESTIONABLE", injuryReturnWeek: 7 });
/** On IR, ESPN back week 8 (R = 8): played weeks 1–3 (10 a game), Sleeper hedges weeks 7 and 8 (2 and 4), 10 a game after. */
const IR_HEDGED = p("my-ir-hedged", "RB", { ...weeksFrom(1, 3, 10), 7: 2, 8: 4, ...weeksFrom(9, 17, 10) }, { injury: "IR", injuryReturnWeek: 8 });

/** `hedged` false: without the two players the rule reads; `stale` false: without the stale-date WRs (others). */
function league(opts: { hedged?: boolean; stale?: boolean; edit?: (spec: TestLeagueSpec) => void } = {}) {
  const stale = opts.stale !== false;
  const spec: TestLeagueSpec = {
    teams: [
      { id: "1", roster: [...roster("1"), ...others("1", stale), ...(opts.hedged === false ? [] : [HEDGED])], ir: opts.hedged === false ? [] : [IR_HEDGED] },
      { id: "2", roster: [...roster("2", 0.9), ...others("2", stale)] },
      { id: "3", roster: roster("3", 0.95) },
      { id: "4", roster: roster("4", 1.05) },
    ],
    freeAgents: [p("fa-rb", "RB", 3, { value: 50 }), p("fa-wr", "WR", 3, { value: 50 })],
    nflLastWeek: 18,
  };
  opts.edit?.(spec);
  const built = buildTestLeague(spec);
  // Four teams in a round robin from this week on, the top 2 in the playoffs: the odds are simulated.
  const ids = built.snapshot.teams.map((t) => t.id);
  const snapshot = { ...built.snapshot, settings: { ...built.snapshot.settings, playoffTeams: 2 }, schedule: roundRobin(ids, built.snapshot.settings.regularSeasonWeeks.filter((w) => w >= 4)) };
  return { snapshot, inputs: built.inputs };
}

/** What a QB, RB, WR or TE with a line of weeks is worth in blendedLeague (by his id without its team); the others, 100 a point. */
const SERIES_VALUES: Readonly<Record<string, number>> = { "q-nodate": 1_100, "out-nodate": 1_000, "d-near": 900, "q-stale": 1_000, "my-hedged": 1_300, "my-ir-hedged": 1_100 };
const BLENDED: ReadonlySet<Pos> = new Set<Pos>(config.marketBlend.positions);

/**
 * league() with the market blend running at every blended position (review of Checkpoint 7g, jacobs-rule-test-no-blend: the
 * league above values two free agents only, so it runs no market curve): FantasyCalc values for every QB, RB, WR and TE
 * (SERIES_VALUES, else 100 a point of his flat line), and seven more healthy free agents at QB and at TE, so each blended
 * position has config.marketBlend.minPlayers healthy valued players or more. Every RB and WR is valued, so §9's estimate
 * curve, which fits every valued player's ROS points, injured ones too (market.ts marketValues), has nobody to estimate at
 * the hedged players' positions.
 */
function blendedLeague() {
  const valued = (pl: TestPlayer): TestPlayer => {
    if (!BLENDED.has(pl.pos)) return pl;
    const value = SERIES_VALUES[pl.id.replace(/^\d+-/, "")] ?? (typeof pl.points === "number" ? 100 * pl.points : undefined);
    if (value === undefined) throw new Error(`blendedLeague: no value for ${pl.id}`);
    return { ...pl, value };
  };
  const more = (pos: "QB" | "TE", from: number): TestPlayer[] => Array.from({ length: 7 }, (_, i) => p(`fa-${pos.toLowerCase()}${i + 1}`, pos, from + i));
  return league({
    edit: (spec) => {
      spec.teams = spec.teams.map((t) => ({ ...t, roster: t.roster.map(valued), ...(t.ir ? { ir: t.ir.map(valued) } : {}) }));
      spec.freeAgents = [...(spec.freeAgents ?? []), ...more("QB", 8), ...more("TE", 2)].map(valued);
    },
  });
}

const OPTS: BuildLeagueModelOptions = { now: TEST_NOW, scenarios: 0, sims: 0, settings: NO_STREAMING };
const OFF: BuildLeagueModelOptions = { ...OPTS, firstFullWeekBack: false };
/** A model's numbers as JSON, its stage timings left out (they're clock readings). */
const numbers = (m: LeagueModel): string => JSON.stringify({ ...m, timings: {} });

describe("which players get R (league.returnWeekBack)", () => {
  const l = league();
  const { context } = buildLeagueModelWithContext(l.snapshot, l.inputs, OPTS, NO_RISK);
  const R = (id: string) => {
    const c = context.lp.contexts.get(id);
    if (!c) throw new Error(`no context for ${id}`);
    return returnWeekBack(c.avail, c.ctx, NO_RISK);
  };

  it("a player whose availability follows a known return week: his expected return week", () => {
    expect(R("my-hedged")).toBe(7);
    expect(R("my-ir-hedged")).toBe(8);
  });

  it("nobody else: healthy players, no date, a near date (the tag's table), a date Sleeper finds stale", () => {
    for (const id of ["1-rb1", "fa-rb", "1-q-nodate", "1-out-nodate", "1-d-near", "1-q-stale", "2-q-stale"]) expect(R(id), id).toBeUndefined();
    // The stale one: his note says Sleeper broke the tie, so what his availability reads has no date.
    const m = buildLeagueModel(l.snapshot, l.inputs, OPTS, NO_RISK);
    expect(m.players["1-q-stale"]?.availabilityNote?.used).toBe("sleeper");
  });

  it("a week the user set: that week (75% back then), whatever the platform's date", () => {
    const set = buildLeagueModelWithContext(l.snapshot, l.inputs, { ...OPTS, settings: { ...NO_STREAMING, returnWeeks: { "my-hedged": 9, "1-q-nodate": 6 }, returnWeeksSeason: SEASON } }, NO_RISK).context;
    const of = (id: string) => {
      const c = set.lp.contexts.get(id);
      return c ? returnWeekBack(c.avail, c.ctx, NO_RISK) : null;
    };
    expect(of("my-hedged")).toBe(9);
    expect(of("1-q-nodate")).toBe(6);
  });

  it("none when he isn't back within the remaining weeks (out for the season)", () => {
    const season = league({ edit: (spec) => spec.teams[0]?.ir?.push(p("my-ir-season", "TE", 8, { injury: "IR", injuryReturnWeek: 19 })) });
    const c = buildLeagueModelWithContext(season.snapshot, season.inputs, OPTS, NO_RISK).context.lp.contexts.get("my-ir-season");
    expect(c && returnWeekBack(c.avail, c.ctx, NO_RISK)).toBeUndefined();
  });
});

describe("what they read, and that nobody else moves", () => {
  const l = league();
  const on = buildLeagueModel(l.snapshot, l.inputs, OPTS, NO_RISK);
  const off = buildLeagueModel(l.snapshot, l.inputs, OFF, NO_RISK);

  it("Jacobs's shape: b from week 7, his first full week back, not week 6's hedge; the hedge's shape is 1", () => {
    const a = on.players["my-hedged"];
    const b = off.players["my-hedged"];
    expect(a?.base).toMatchObject({ projNow: 12, projWeek: 7, mNow: 1, b: 12, source: "sleeper" });
    expect(b?.base).toMatchObject({ projNow: 3, projWeek: 6, mNow: 0.8, b: 3 / 0.8, source: "sleeper" });
    expect(a?.weekly[2]?.m).toBe(1); // week 6
    expect(b?.weekly[2]?.m).toBe(0.8);
    // Week 6 (25% back) and every week after it read 12 × his availability, where the hedge read 3 ÷ 0.8 × the shape.
    expect(a?.weekly[2]?.p).toBeCloseTo(12 * 0.25, 12);
    expect(a?.ros.total).toBeCloseTo(12 * (0.25 + 0.75 + 10), 9); // weeks 6, 7 and 8–17
    expect((a?.ros.total ?? 0) / (b?.ros.total ?? 1)).toBeGreaterThan(3);
  });

  it("an IR player who played, and whom no source projects this week, keeps his lookback week as proj_now; his later weeks' shapes leave the hedges out of the mean", () => {
    const a = on.players["my-ir-hedged"];
    const b = off.players["my-ir-hedged"];
    // Week 3's 10 either way; the mean from week 9 on is 10 (shape 1), where the hedges had pulled it to 96 ÷ 11 = 8.73 (1.15).
    const hedgedMean = 96 / 11;
    expect(a?.base).toMatchObject({ projNow: 10, projWeek: 3, mNow: 1 });
    expect(b?.base).toMatchObject({ projNow: 10, projWeek: 3 });
    expect(b?.base.mNow).toBeCloseTo(10 / hedgedMean, 12);
    expect(a?.base.b).toBe(10);
    expect(b?.base.b).toBeCloseTo(hedgedMean, 12);
    expect(a?.weekly[5]?.m).toBe(1); // week 9
    expect(b?.weekly[5]?.m).toBeCloseTo(10 / hedgedMean, 12);
  });

  it("every other player's PlayerModel is bit for bit Checkpoint 7f's (no market curve runs in this league: the blend's case is below); a far date under test moves only its note's healthy rate", () => {
    const moved = new Set(["my-hedged", "my-ir-hedged"]);
    const tested = new Set(["1-q-stale", "2-q-stale"]);
    expect(Object.keys(on.players).sort()).toEqual(Object.keys(off.players).sort());
    for (const id of Object.keys(on.players)) if (!moved.has(id) && !tested.has(id)) expect(on.players[id], id).toEqual(off.players[id]);
    // The stale dates: Sleeper's 8 this week against his healthy 10 now (weeks 5 and 6, before the date's week 7, out of the
    // mean), 9.46 before (week 5's 3 in it); stale either way, so his availability and projection are as before.
    for (const id of tested) {
      const a = on.players[id];
      const b = off.players[id];
      expect(a?.availabilityNote).toMatchObject({ used: "sleeper", sleeperNow: 8, healthyRate: 10 });
      expect(b?.availabilityNote).toMatchObject({ used: "sleeper", sleeperNow: 8 });
      expect(b?.availabilityNote?.healthyRate).toBeCloseTo(123 / 13, 12);
      expect({ ...a, availabilityNote: null }).toEqual({ ...b, availabilityNote: null });
    }
    // And their teams move: Team 1's lineup reads them.
    expect(numbers(on)).not.toBe(numbers(off));
  });

  it("a stale date's player reads his low next week as before (no R: the tag's table is what his availability follows)", () => {
    expect(on.players["1-q-stale"]?.base).toMatchObject({ projNow: 3, projWeek: 5, mNow: 0.8 });
  });
});

describe("with the market blend running, nobody else's blend factor or PlayerModel moves (review of Checkpoint 7g, jacobs-rule-test-no-blend)", () => {
  const l = blendedLeague();
  // The blend's factors as each build makes them (steps 1–3b), and the whole League model.
  const lpOn = projectLeaguePlayers(l.snapshot, l.inputs, TEST_NOW, NO_RISK);
  const lpOff = projectLeaguePlayers(l.snapshot, l.inputs, TEST_NOW, NO_RISK, undefined, undefined, false);
  const on = buildLeagueModel(l.snapshot, l.inputs, OPTS, NO_RISK);
  const off = buildLeagueModel(l.snapshot, l.inputs, OFF, NO_RISK);
  const moved = new Set(["my-hedged", "my-ir-hedged"]);
  const tested = new Set(["1-q-stale", "2-q-stale"]);

  it("the blend runs at every blended position, each with config.marketBlend.minPlayers healthy valued players or more", () => {
    for (const lp of [lpOn, lpOff]) {
      expect(lp.blend.weight).toBe(config.marketBlend.weight);
      expect(lp.blend.positions.map((x) => x.pos)).toEqual([...config.marketBlend.positions]);
      for (const x of lp.blend.positions) {
        expect(x.blended, x.pos).toBe(true);
        expect(x.fit, x.pos).toBeGreaterThanOrEqual(config.marketBlend.minPlayers);
      }
      expect(lp.blend.factors.size).toBeGreaterThan(0);
    }
    expect(on.players["1-rb1"]?.blend).toBeDefined();
    // Every RB and WR is FantasyCalc's: §9's estimate curve has nobody to estimate at the hedged players' positions.
    for (const [id, pm] of Object.entries(on.players)) {
      const pos = l.snapshot.players[id]?.pos;
      if (pos === "RB" || pos === "WR") expect(pm.value?.source, id).toBe("fantasycalc");
    }
  });

  it("the hedged players' factors move: they're read off a curve they never shape (they're injured), at their new base rates", () => {
    for (const id of moved) {
      const a = lpOn.blend.factors.get(id);
      const b = lpOff.blend.factors.get(id);
      expect(a?.fit, id).toBe(false);
      expect(a?.market, id).toBe(b?.market); // the same curve, read at the same value
      expect(a?.f, id).not.toBe(b?.f);
    }
    // Jacobs's shape: 3.75 a game before (week 6's hedge ÷ 0.8), so the market's 13 a game (valued 1,300, between the RBs
    // worth 945 and 1,350) pulled him to the clamp's top; 12 a game now, a little under the market's rate.
    expect(lpOff.blend.factors.get("my-hedged")).toMatchObject({ ours: 3 / 0.8, f: config.marketBlend.factorClamp[1], clamped: "high" });
    const hedged = lpOn.blend.factors.get("my-hedged");
    expect(hedged).toMatchObject({ ours: 12 });
    expect(hedged?.clamped).toBeUndefined();
    const w = config.marketBlend.weight;
    expect(hedged?.f).toBeCloseTo(((1 - w) * 12 + w * 13) / 12, 9);
    // The IR player: 8.73 a game before (the hedges in his shape's mean), 10 now; the market's 11 a game either way.
    expect(lpOff.blend.factors.get("my-ir-hedged")?.ours).toBeCloseTo(96 / 11, 12);
    expect(lpOn.blend.factors.get("my-ir-hedged")).toMatchObject({ ours: 10 });
    expect(lpOn.blend.factors.get("my-ir-hedged")?.market).toBeCloseTo(11, 9);
    // So their models move, blend and all.
    for (const id of moved) expect(on.players[id]?.blend, id).not.toEqual(off.players[id]?.blend);
  });

  it("every other player's blend factor and PlayerModel are bit for bit Checkpoint 7f's; a far date under test moves only its note's healthy rate", () => {
    expect([...lpOn.blend.factors.keys()].sort()).toEqual([...lpOff.blend.factors.keys()].sort());
    for (const [id, factor] of lpOn.blend.factors) if (!moved.has(id)) expect(factor, id).toEqual(lpOff.blend.factors.get(id));
    expect(Object.keys(on.players).sort()).toEqual(Object.keys(off.players).sort());
    for (const id of Object.keys(on.players)) {
      if (moved.has(id)) continue;
      if (tested.has(id)) expect({ ...on.players[id], availabilityNote: null }, id).toEqual({ ...off.players[id], availabilityNote: null });
      else expect(on.players[id], id).toEqual(off.players[id]);
    }
    // The stale-date WRs are valued and read off the WR curve: blended, the same either way.
    for (const id of tested) expect(on.players[id]?.blend, id).toBeDefined();
    // And their teams move: Team 1's lineup reads the hedged players.
    expect(numbers(on)).not.toBe(numbers(off));
  });
});

describe("a League model with no such player stays bit for bit", () => {
  // No player whose availability follows a known return week, and no far date under test; injured players the rule leaves
  // alone (no date, a near date) with low next weeks.
  it("odds, waiver lists and their rating included, with injured players the rule leaves alone", () => {
    const l = league({ hedged: false, stale: false });
    const sims = { ...OPTS, sims: 400, scenarios: 8, waiverRating: true };
    const on = buildLeagueModel(l.snapshot, l.inputs, sims, NO_RISK);
    const off = buildLeagueModel(l.snapshot, l.inputs, { ...sims, firstFullWeekBack: false }, NO_RISK);
    expect(on.odds).not.toBeNull();
    expect(on.waiverUpgrades?.ros?.rating).toBeTruthy();
    expect(numbers(on)).toBe(numbers(off));
  });

  it("and so does the trade context's", () => {
    const l = league({ hedged: false, stale: false });
    const ctx = (firstFullWeekBack: boolean) => tradeInternals(buildTradeContext(l.snapshot, l.inputs, { now: TEST_NOW, scenarios: 0, playoffWeightSims: 0, settings: NO_STREAMING, firstFullWeekBack }));
    expect(numbers(ctx(true).model)).toBe(numbers(ctx(false).model));
  });
});

describe("a week the user set, the stale-date tiebreaker and the trade context", () => {
  it("a week of the user's: R is his week (75% back then), so the rule reads from it", () => {
    const l = league();
    const at = (week: number) => buildLeagueModel(l.snapshot, l.inputs, { ...OPTS, settings: { ...NO_STREAMING, returnWeeks: { "my-hedged": week }, returnWeeksSeason: SEASON } }, NO_RISK).players["my-hedged"];
    // At the hedge itself (week 6): the leading test catches it (3 under 0.8 × 12), so he reads week 7 as under ESPN's date.
    expect(at(6)?.base).toMatchObject({ projNow: 12, projWeek: 7 });
    expect(at(6)?.weekly[2]?.m).toBe(1);
    // Later (week 9): every week before it goes, his first full week back is week 9.
    expect(at(9)?.base).toMatchObject({ projNow: 12, projWeek: 9 });
    // Checkpoint 7f's rule read week 6's hedge whatever the user set.
    const offAt6 = buildLeagueModel(l.snapshot, l.inputs, { ...OFF, settings: { ...NO_STREAMING, returnWeeks: { "my-hedged": 6 }, returnWeeksSeason: SEASON } }, NO_RISK).players["my-hedged"];
    expect(offAt6?.base).toMatchObject({ projNow: 3, projWeek: 6 });
  });

  it("the tiebreaker's healthy rate leaves out the weeks the date under test would: a hedge no longer makes a far date look stale", () => {
    // Jacobs's shape, but Sleeper projects him a little this week (2): against the hedge (3 ÷ 0.8 = 3.75) the date read as
    // stale (2 at least half of it); against his first full week back (12) it doesn't (2 under 6), so he follows it.
    const l = league({ edit: (spec) => spec.teams[0]?.roster.push(p("my-little", "RB", { ...weeksFrom(7, 17, 12), 4: 2, 6: 3 }, { injury: "QUESTIONABLE", injuryReturnWeek: 7 })) });
    const on = buildLeagueModel(l.snapshot, l.inputs, OPTS, NO_RISK).players["my-little"];
    const off = buildLeagueModel(l.snapshot, l.inputs, OFF, NO_RISK).players["my-little"];
    expect(off?.availabilityNote).toMatchObject({ used: "sleeper", sleeperNow: 2, healthyRate: 3.75 });
    expect(on?.availabilityNote).toMatchObject({ used: "returnDate", sleeperNow: 2, healthyRate: 12 });
    // So his availability follows the date (out until week 7) and his base rate reads week 7.
    expect(on?.weekly[0]?.a).toBe(0);
    expect(on?.base).toMatchObject({ projNow: 12, projWeek: 7 });
    // Under Checkpoint 7f's rule: the tag's table (85% this week), and his rate from week 6's hedge.
    expect(off?.weekly[0]?.a).toBe(config.projections.injury.QUESTIONABLE[0]);
    expect(off?.base).toMatchObject({ projNow: 3, projWeek: 6 });
  });

  it("every trade context reads it (its League model's players), and the switch with it", () => {
    const l = league();
    const model = (firstFullWeekBack?: boolean) =>
      tradeInternals(buildTradeContext(l.snapshot, l.inputs, { now: TEST_NOW, scenarios: 0, playoffWeightSims: 0, settings: NO_STREAMING, ...(firstFullWeekBack !== undefined ? { firstFullWeekBack } : {}) })).model;
    expect(model().players["my-hedged"]?.base).toMatchObject({ projWeek: 7 });
    expect(model(false).players["my-hedged"]?.base).toMatchObject({ projWeek: 6 });
    expect(model().players["my-hedged"]).toEqual(buildLeagueModel(l.snapshot, l.inputs, { ...OPTS, scenarios: 0 }).players["my-hedged"]);
  });
});
