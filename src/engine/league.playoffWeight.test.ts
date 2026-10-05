/**
 * The automatic playoff-week weight (league.ts step 5c; planner reply to Checkpoint 7a, §6.1): ω = (B per point in playoff
 * weeks) ÷ (B per point in regular-season weeks), for my team under my goal, from two runs with common random numbers on the
 * headline's seasons, clamped to [0.5, 4]; the fallback config.lineups.playoffWeight when it can't be measured; ω in every
 * ROS(T) and nowhere a player's own ROS points; the trade context's ω the League page's; and (review of the engine track,
 * Phase 7b) the thresholds in ROS lineup points × Σω ÷ Σω₀, so they keep the meaning they had at ω₀. Synthetic leagues
 * (made-up players, placeholder teams).
 */
import { describe, expect, it } from "vitest";
import { goalWeights } from "./benefit";
import { config } from "./config";
import { buildTradeContext, throwIns, tradeInternals } from "./evaluate";
import type { ModelInputs } from "./inputs";
import {
  buildLeagueModel,
  lineupThresholdScale,
  lineupThresholds,
  measurePlayoffWeight,
  playoffWeightFallback,
  playoffWeightFrom,
  teamWeeks,
  type BuildLeagueModelOptions,
} from "./league";
import type { LeagueModel, LineupThresholds, PlayoffWeightAuto, PlayoffWeightRun, SeasonOdds } from "./leagueModel";
import type { LeagueSnapshot } from "./model";
import { seasonOdds, type SeasonModel } from "./season";
import { GOALS, defaultTradeSettings, type Goal } from "./settings";
import { rosValue } from "./teamValue";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";

const range = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
const { gain, clamp } = config.lineups.playoffWeightAuto;
const FALLBACK = config.lineups.playoffWeight;

/** A run of the measurement: `n` weeks changed (NFL weeks from `first` on) and my odds' changes. */
const run = (n: number, dPO: number, dCH: number | null, first = 1): PlayoffWeightRun => ({ weeks: range(first, first + n - 1), dPO, dCH });
/** B per point by hand: B_win under the goal ÷ (gain × weeks). */
const perPoint = (r: PlayoffWeightRun, goal: Goal): number => {
  const w = goalWeights(goal);
  return (100 * (w.playoffs * r.dPO + w.title * (r.dCH as number))) / (gain * r.weeks.length);
};

describe("playoffWeightFrom: ω from the two runs (pure)", () => {
  it("is the playoff run's B per point ÷ the regular-season run's, under the goal's weights, rounded to 0.01", () => {
    const runs = { regular: run(10, 0.1, 0.02), playoffs: run(3, 0, 0.03, 11) };
    const title = playoffWeightFrom(runs, "title", 5000);
    // 100 × (0.15 × 0.1 + 0.85 × 0.02) / 30 = 0.10667; 100 × 0.85 × 0.03 / 9 = 0.28333: 2.656… → 2.66.
    expect(title.regularPerPoint).toBeCloseTo(perPoint(runs.regular, "title"), 12);
    expect(title.playoffPerPoint).toBeCloseTo(perPoint(runs.playoffs, "title"), 12);
    expect(title.ratio).toBeCloseTo(2.65625, 9);
    expect(title).toMatchObject({ omega: 2.66, basis: "auto", reason: null, goal: "title", gain, sims: 5000, clamped: null, runs });
    expect(config.lineups.playoffWeightAuto.decimals).toBe(2);
    // The same runs under "Balanced": 100 × (0.35 × 0.1 + 0.65 × 0.02) / 30 = 0.16; 100 × 0.65 × 0.03 / 9 = 0.21667: 1.354… → 1.35.
    expect(playoffWeightFrom(runs, "balanced", 5000)).toMatchObject({ omega: 1.35, clamped: null });
  });

  it("clamps to [0.5, 4]: a ratio outside it takes the end it passed", () => {
    expect(clamp).toEqual([0.5, 4]);
    // "Make the playoffs": 100 × (0.7 × 0.1 + 0.3 × 0.02) / 30 = 0.25333; 100 × 0.3 × 0.03 / 9 = 0.1: 0.39 → 0.5.
    const low = playoffWeightFrom({ regular: run(10, 0.1, 0.02), playoffs: run(3, 0, 0.03, 11) }, "playoffs", 5000);
    expect(low).toMatchObject({ omega: 0.5, basis: "auto", clamped: "low" });
    expect(low.ratio).toBeCloseTo(0.1 / (7.6 / 30), 9);
    const high = playoffWeightFrom({ regular: run(10, 0.001, 0.001), playoffs: run(3, 0, 0.05, 11) }, "title", 5000);
    expect(high).toMatchObject({ omega: 4, clamped: "high" });
    expect(high.ratio as number).toBeGreaterThan(4);
  });

  it("one per-point B not above 0 while the other is: that end of the clamp (only the playoffs move my odds: the top)", () => {
    expect(playoffWeightFrom({ regular: run(10, 0, 0), playoffs: run(3, 0, 0.02, 11) }, "title", 5000)).toMatchObject({ omega: 4, basis: "auto", clamped: "high", ratio: null, regularPerPoint: 0 });
    expect(playoffWeightFrom({ regular: run(10, 0.05, 0.01), playoffs: run(3, 0, 0, 11) }, "title", 5000)).toMatchObject({ omega: 0.5, basis: "auto", clamped: "low", ratio: null, playoffPerPoint: 0 });
    expect(playoffWeightFrom({ regular: run(10, 0.05, 0.01), playoffs: run(3, 0, -0.001, 11) }, "title", 5000)).toMatchObject({ omega: 0.5, clamped: "low" });
  });

  it("falls back to config.lineups.playoffWeight when neither run moves my odds, a ΔCH is unknown, or a B isn't a number", () => {
    const runs = { regular: run(10, 0, 0), playoffs: run(3, 0, 0, 11) };
    expect(playoffWeightFrom(runs, "title", 5000)).toEqual({ omega: FALLBACK, basis: "fallback", reason: "noEffect", goal: "title", gain, sims: 5000, regularPerPoint: 0, playoffPerPoint: 0, ratio: null, clamped: null, runs });
    expect(playoffWeightFrom({ regular: run(10, 0.1, null), playoffs: run(3, 0, null, 11) }, "title", 5000)).toMatchObject({ omega: FALLBACK, basis: "fallback", reason: "titleUnknown", regularPerPoint: null });
    expect(playoffWeightFrom({ regular: run(10, Number.NaN, 0.01), playoffs: run(3, 0, 0.01, 11) }, "title", 5000)).toMatchObject({ omega: FALLBACK, reason: "notFinite" });
    expect(playoffWeightFrom({ regular: run(0, 0.1, 0.01), playoffs: run(3, 0, 0.01, 11) }, "title", 5000)).toMatchObject({ omega: FALLBACK, reason: "notFinite" });
    expect(FALLBACK).toBe(1.25);
    // The fallback's own shape: nothing measured.
    expect(playoffWeightFallback("noTeam", "balanced")).toEqual({ omega: FALLBACK, basis: "fallback", reason: "noTeam", goal: "balanced", gain, sims: 0, regularPerPoint: null, playoffPerPoint: null, ratio: null, clamped: null, runs: null });
  });
});

/** smallLeague with records (my team "1" in the middle of the pack) and its NFL week 6 half kicked off when `live`. */
function season(seed: number, opts: { live?: boolean; playoff?: number[]; regular?: number[]; myTeamId?: string | null } = {}): { snapshot: LeagueSnapshot; inputs: ModelInputs } {
  const lg = smallLeague(seed, { pastWinnersOrder: ["3", "5", "1", "2", "6", "4"], ...(opts.playoff ? { playoff: opts.playoff } : {}), ...(opts.regular ? { regular: opts.regular } : {}) });
  if (opts.live) {
    const nfl = lg.inputs.nfl as NonNullable<ModelInputs["nfl"]>;
    nfl.kickoffs = { 6: Object.fromEntries(range(1, 32).map((i) => [`T${String(i).padStart(2, "0")}`, i % 2 === 1 ? "2026-09-29T17:00:00.000Z" : "2026-09-30T00:15:00.000Z"])) };
  }
  return opts.myTeamId === undefined ? lg : { ...lg, snapshot: { ...lg.snapshot, myTeamId: opts.myTeamId } };
}

/**
 * The measurement's runs made again by hand on a model's teams as they stand (no IR players here: ω doesn't change them),
 * on the same seasons (seasonOdds draws simNormals of the seed when given none: the same draws).
 */
function byHand(snapshot: LeagueSnapshot, model: LeagueModel, sims: number): { base: SeasonOdds; regular: PlayoffWeightRun; playoffs: PlayoffWeightRun } {
  const stand: SeasonModel = { weeks: model.weeks, regularWeeks: model.regularWeeks, playoffWeeks: model.playoffWeeks, inProgressWeek: model.inProgressWeek, teams: model.teams.map((t) => ({ id: t.id, score: t.score })) };
  const on = { sims, seed: config.simulation.seed };
  const base = seasonOdds(snapshot, stand, on) as SeasonOdds;
  const from = model.inProgressWeek === null ? 0 : 1;
  const me = model.myTeamId as string;
  const change = (kind: readonly number[]): PlayoffWeightRun => {
    const at = new Set(model.weeks.flatMap((w, i) => (i >= from && kind.includes(w) ? [i] : [])));
    const teams = stand.teams.map((t) => (t.id === me ? { id: t.id, score: { mean: t.score.mean.map((m, i) => (at.has(i) ? m + gain : m)), sd: [...t.score.sd] } } : t));
    const after = (seasonOdds(snapshot, { ...stand, teams }, on) as SeasonOdds).teams.find((t) => t.teamId === me);
    const before = base.teams.find((t) => t.teamId === me);
    return { weeks: [...at].map((i) => model.weeks[i] as number), dPO: (after?.pPlayoffs as number) - (before?.pPlayoffs as number), dCH: (after?.pTitle as number) - (before?.pTitle as number) };
  };
  return { base, regular: change(model.regularWeeks), playoffs: change(model.playoffWeeks) };
}

describe("measured on a League model build (step 5c)", () => {
  const SIMS = 2000;
  const OPTS: BuildLeagueModelOptions = { now: TEST_NOW, scenarios: 0, sims: SIMS };
  const lg = season(11);
  const model = buildLeagueModel(lg.snapshot, lg.inputs, OPTS);
  const auto = model.playoffWeightAuto as PlayoffWeightAuto;

  it("runs my score + 3 in the counted regular-season weeks, then in the playoff weeks, on the headline's seasons: the runs made by hand agree bit for bit", () => {
    expect(model.myTeamId).toBe("1");
    expect(auto.basis).toBe("auto");
    expect(auto.sims).toBe(SIMS);
    expect(auto.goal).toBe("title");
    const hand = byHand(lg.snapshot, model, SIMS);
    expect(auto.runs?.regular).toEqual(hand.regular);
    expect(auto.runs?.playoffs).toEqual(hand.playoffs);
    expect(hand.regular.weeks).toEqual([6, 7, 8]);
    expect(hand.playoffs.weeks).toEqual([9, 10]);
    // A playoff week's points can't change the standings: the playoff run moves only my title odds.
    expect(hand.playoffs.dPO).toBe(0);
    expect(hand.playoffs.dCH as number).toBeGreaterThan(0);
    expect(auto.regularPerPoint).toBe(perPoint(hand.regular, "title"));
    expect(auto.playoffPerPoint).toBe(perPoint(hand.playoffs, "title"));
    const ratio = (auto.playoffPerPoint as number) / (auto.regularPerPoint as number);
    expect(auto.ratio).toBe(ratio);
    expect(model.playoffWeight).toBe(Math.min(clamp[1], Math.max(clamp[0], Math.round(ratio * 100) / 100)));
    expect(model.playoffWeight).not.toBe(FALLBACK);
    // The base run is the odds as rosters stand: every team as it stands, the same seasons (simulate reuses it).
    expect(model.oddsAsRostersStand).toEqual(hand.base);
  });

  it("puts ω in every ROS(T) (teamWeeks' weights), and nowhere in a player's own ROS points or the odds as rosters stand", () => {
    const { weights } = teamWeeks(model, model.inProgressWeek, { ...config.lineups, playoffWeight: model.playoffWeight });
    expect(weights.at(-1)).toBe(model.playoffWeight);
    for (const t of model.teams) expect(t.ev.ros, t.id).toBe(rosValue(t.ev.lv, weights));
    // The same league with ω unmeasured (the fallback weight): players' ROS points, values and the odds as rosters stand
    // are the same; ROS(T) isn't.
    const fixed = buildLeagueModel(lg.snapshot, lg.inputs, { ...OPTS, playoffWeightSims: 0 });
    expect(fixed.playoffWeightAuto).toMatchObject({ basis: "fallback", reason: "noOdds", omega: FALLBACK });
    expect(fixed.players).toEqual(model.players);
    expect(fixed.oddsAsRostersStand).toEqual(model.oddsAsRostersStand);
    expect(fixed.teams.map((t) => t.ev.lv)).toEqual(model.teams.map((t) => t.ev.lv));
    expect(fixed.teams.map((t) => t.ev.ros)).not.toEqual(model.teams.map((t) => t.ev.ros));
  });

  it("weighs my odds by the goal: the same runs under every goal, each goal's B per point (TradeSettings.goal)", () => {
    const byGoal = Object.fromEntries(GOALS.map((g) => [g, buildLeagueModel(lg.snapshot, lg.inputs, { ...OPTS, settings: { ...defaultTradeSettings(), goal: g } }).playoffWeightAuto as PlayoffWeightAuto]));
    for (const g of GOALS) {
      const a = byGoal[g] as PlayoffWeightAuto;
      expect(a.goal).toBe(g);
      expect(a.runs).toEqual(auto.runs);
      expect(a.regularPerPoint).toBe(perPoint(auto.runs?.regular as PlayoffWeightRun, g));
      expect(a.playoffPerPoint).toBe(perPoint(auto.runs?.playoffs as PlayoffWeightRun, g));
    }
    // Title odds weigh more under "Win the title", and only they move in the playoff run: its ω is the largest.
    expect((byGoal.title as PlayoffWeightAuto).omega).toBeGreaterThanOrEqual((byGoal.balanced as PlayoffWeightAuto).omega);
    expect((byGoal.balanced as PlayoffWeightAuto).omega).toBeGreaterThanOrEqual((byGoal.playoffs as PlayoffWeightAuto).omega);
    expect((byGoal.title as PlayoffWeightAuto).omega).toBeGreaterThan((byGoal.playoffs as PlayoffWeightAuto).omega);
  });

  it("leaves a week under way out of the regular-season run (a trade can't change it), measured on the week as it was before kickoff", () => {
    const live = season(11, { live: true });
    const m = buildLeagueModel(live.snapshot, live.inputs, OPTS);
    expect(m.inProgressWeek).toBe(6);
    const a = m.playoffWeightAuto as PlayoffWeightAuto;
    expect(a.basis).toBe("auto");
    expect(a.runs?.regular.weeks).toEqual([7, 8]);
    expect(a.runs?.playoffs.weeks).toEqual([9, 10]);
    const hand = byHand(live.snapshot, m, SIMS);
    expect(a.runs?.regular).toEqual(hand.regular);
    expect(a.runs?.playoffs).toEqual(hand.playoffs);
  });
});

describe("the fallback (config.lineups.playoffWeight) when ω can't be measured", () => {
  const OPTS: BuildLeagueModelOptions = { now: TEST_NOW, scenarios: 0, sims: 500 };
  const reasonOf = (lg: { snapshot: LeagueSnapshot; inputs: ModelInputs }, opts: Partial<BuildLeagueModelOptions> = {}) => {
    const m = buildLeagueModel(lg.snapshot, lg.inputs, { ...OPTS, ...opts });
    expect(m.playoffWeight).toBe(FALLBACK);
    expect(m.playoffWeightAuto?.basis).toBe("fallback");
    expect(m.playoffWeightAuto?.omega).toBe(FALLBACK);
    return m.playoffWeightAuto?.reason;
  };

  it("no team picked; no regular-season or no playoff week left to count; no odds (sims 0, or no schedule); title odds unknown", () => {
    expect(reasonOf(season(11, { myTeamId: null }))).toBe("noTeam");
    // NFL week 6 with a regular season of weeks 1–5 (playoffs 6–7): the regular season is over.
    expect(reasonOf(season(11, { regular: range(1, 5), playoff: [6, 7] }))).toBe("noRegularWeeks");
    // No playoffs at all.
    expect(reasonOf(season(11, { playoff: [] }))).toBe("noPlayoffWeeks");
    expect(reasonOf(season(11), { sims: 0 })).toBe("noOdds");
    expect(reasonOf(season(11), { playoffWeightSims: 0 })).toBe("noOdds");
    const unscheduled = season(11);
    expect(reasonOf({ ...unscheduled, snapshot: { ...unscheduled.snapshot, schedule: [] } })).toBe("noOdds");
    // 4 playoff teams in one listed playoff week: fewer rounds than the bracket needs, so title odds are unknown.
    expect(reasonOf(season(11, { playoff: [9] }))).toBe("titleUnknown");
  });

  it("measurePlayoffWeight asks for the teams' scores only when it simulates", () => {
    let asked = 0;
    const scores = () => {
      asked++;
      return [];
    };
    const weeks = { weeks: range(6, 10), regularWeeks: [6, 7, 8], playoffWeeks: [9, 10], inProgressWeek: null };
    const lg = season(11);
    expect(measurePlayoffWeight(lg.snapshot, weeks, null, 0, "title", { sims: 500, seed: 1 }, scores).auto.reason).toBe("noTeam");
    expect(measurePlayoffWeight(lg.snapshot, weeks, "1", 0, "title", { sims: 0, seed: 1 }, scores).auto.reason).toBe("noOdds");
    expect(measurePlayoffWeight(lg.snapshot, { ...weeks, regularWeeks: [] }, "1", 0, "title", { sims: 500, seed: 1 }, scores).auto.reason).toBe("noRegularWeeks");
    expect(measurePlayoffWeight(lg.snapshot, { ...weeks, playoffWeeks: [] }, "1", 0, "title", { sims: 500, seed: 1 }, scores).auto.reason).toBe("noPlayoffWeeks");
    expect(asked).toBe(0);
    // Scores missing for the league's teams: the simulator refuses the setup (a RangeError), so no odds.
    const refused = measurePlayoffWeight(lg.snapshot, weeks, "1", 0, "title", { sims: 500, seed: 1 }, scores);
    expect(asked).toBe(1);
    expect(refused).toEqual({ auto: playoffWeightFallback("noOdds", "title"), sim: null });
  });
});

describe("one ω everywhere: the trade context's is the League page's model's (one baseline everywhere)", () => {
  for (const goal of ["title", "playoffs"] as const) {
    it(`under "${goal}": the same measurement, so the same weights in every ROS(T) of the search`, () => {
      const lg = season(11);
      const settings = { ...defaultTradeSettings(), goal };
      const model = buildLeagueModel(lg.snapshot, lg.inputs, { now: TEST_NOW, scenarios: 0, settings });
      const I = tradeInternals(buildTradeContext(lg.snapshot, lg.inputs, { now: TEST_NOW, scenarios: 0, settings }));
      expect(model.playoffWeightAuto?.basis).toBe("auto");
      expect(model.playoffWeightAuto?.sims).toBe(config.simulation.finalSims);
      expect(I.model.playoffWeightAuto).toEqual(model.playoffWeightAuto);
      expect(I.model.playoffWeight).toBe(model.playoffWeight);
      expect([...I.weights]).toEqual([...teamWeeks(model, model.inProgressWeek, { ...config.lineups, playoffWeight: model.playoffWeight }).weights]);
      // …and the same thresholds in ROS lineup points (× Σω ÷ Σω₀).
      expect(I.league.thresholds).toEqual(model.lineupThresholds);
      // So the baseline is the League page's headline (evaluate.baseline.test.ts checks it in more leagues).
      expect(I.sim?.odds).toEqual(model.odds);
    });
  }
});

describe("the thresholds in ROS lineup points keep the meaning they had at ω₀: × Σω ÷ Σω₀ (review of the engine track, Phase 7b)", () => {
  const WEEKS = { weeks: range(6, 10), regularWeeks: [6, 7, 8], playoffWeeks: [9, 10] };
  /** The weeks' weights with ω `omega` in the playoff weeks; week 6 under way (weight 0) when `live`. */
  const weightsAt = (omega: number, live = false) => teamWeeks(WEEKS, live ? 6 : null, { ...config.lineups, playoffWeight: omega }).weights;

  it("lineupThresholdScale is Σω ÷ Σω₀ over the weeks team numbers count (a week under way left out of both); 1 when none counts", () => {
    expect(lineupThresholdScale(weightsAt(2), weightsAt(FALLBACK))).toBeCloseTo((3 + 2 * 2) / (3 + 2 * FALLBACK), 12);
    expect(lineupThresholdScale(weightsAt(0.5, true), weightsAt(FALLBACK, true))).toBeCloseTo((2 + 2 * 0.5) / (2 + 2 * FALLBACK), 12);
    expect(lineupThresholdScale(weightsAt(FALLBACK), weightsAt(FALLBACK))).toBe(1);
    expect(lineupThresholdScale([], [])).toBe(1);
    expect(lineupThresholdScale([0, 0], [0, 0])).toBe(1);
    expect(lineupThresholds(1.2)).toEqual({ scale: 1.2, faMinGain: config.freeAgentOptimizer.faMinGain * 1.2, chipMinGap: config.needs.chipMinGap * 1.2 });
  });

  it("a League model's thresholds are config's × its scale, and its pickups and chips are judged by them: under ω below ω₀ some clear only the scaled ones", () => {
    // Under "Make the playoffs" this league measures ω below ω₀, so every threshold is below config's.
    const lg = season(13);
    const m = buildLeagueModel(lg.snapshot, lg.inputs, { now: TEST_NOW, scenarios: 0, settings: { ...defaultTradeSettings(), goal: "playoffs" } });
    expect(m.playoffWeightAuto?.basis).toBe("auto");
    expect(m.playoffWeight).toBeLessThan(FALLBACK);
    const th = m.lineupThresholds as LineupThresholds;
    const scale = lineupThresholdScale(teamWeeks(m, m.inProgressWeek, { ...config.lineups, playoffWeight: m.playoffWeight }).weights, teamWeeks(m, m.inProgressWeek, config.lineups).weights);
    expect(th).toEqual(lineupThresholds(scale));
    expect(th.scale).toBeLessThan(1);
    // Moves are judged in EV lineups here (no scenarios). Every move clears the scaled bar (none here is a near-tie cut) and
    // every chip the scaled gap.
    const gains = m.teams.flatMap((t) => t.faMoves.map((mv) => mv.gainEv));
    const gaps = m.teams.flatMap((t) => t.chips.map((c) => c.gap));
    for (const g of gains) expect(g).toBeGreaterThanOrEqual(th.faMinGain - 1e-9);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(th.chipMinGap - 1e-9);
    // A pickup and a chip that only the scaled thresholds let through (config's would drop both: under this ω a playoff week
    // weighs less than at ω₀, so the same lineup gain is fewer weighted points).
    expect(gains.some((g) => g < config.freeAgentOptimizer.faMinGain)).toBe(true);
    expect(gaps.some((g) => g < config.needs.chipMinGap)).toBe(true);
    // ω₀ itself (the fallback, not measured): config's thresholds exactly.
    const fixed = buildLeagueModel(lg.snapshot, lg.inputs, { now: TEST_NOW, scenarios: 0, playoffWeightSims: 0 });
    expect(fixed.lineupThresholds).toEqual({ scale: 1, faMinGain: config.freeAgentOptimizer.faMinGain, chipMinGap: config.needs.chipMinGap });
  });

  it("the throw-in bar is config.search.throwInMaxCost × the build's scale (my lineup cost is in ROS lineup points under ω)", () => {
    const lg = season(11);
    const I = tradeInternals(buildTradeContext(lg.snapshot, lg.inputs, { now: TEST_NOW, scenarios: 0 }));
    const { scale } = I.league.thresholds;
    expect(scale).not.toBe(1);
    const me = I.me;
    if (!me) throw new Error("no team");
    const costs = I.model.teams[me.index]?.players ?? {};
    const excluded = new Set<string>(config.market.tradeSearchExcluded);
    const costOf = (id: string) => (costs[id]?.mvLoseScen ?? costs[id]?.mvLoseEv) as number;
    // My cheapest player to lose who still costs something (at a position the search includes).
    const id = me.roster.filter((x) => costs[x] && !excluded.has(I.league.posOf(x) as string) && costOf(x) > 1e-3).sort((a, b) => costOf(a) - costOf(b))[0] as string;
    const c = costOf(id);
    const settings = { includeKDefIdp: false, untouchables: [], mustInclude: [] };
    expect(throwIns(I, settings, { throwInMaxCost: c / scale })).toContain(id);
    expect(throwIns(I, settings, { throwInMaxCost: c / scale - 1e-6 })).not.toContain(id);
  });
});
