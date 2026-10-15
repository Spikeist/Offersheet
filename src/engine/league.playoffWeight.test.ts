/**
 * The automatic playoff-week weight (league.ts step 5c; planner reply to Checkpoint 7a, §6.1): ω = (B per point in playoff
 * weeks) ÷ (B per point in regular-season weeks), for my team under my goal, from two runs with common random numbers on the
 * headline's seasons, clamped to [0.5, 4]; the fallback config.lineups.playoffWeight when it can't be measured; ω in every
 * ROS(T) and nowhere a player's own ROS points; the trade context's ω the League page's; and (review of the engine track,
 * Phase 7b) the thresholds in ROS lineup points × Σω ÷ Σω₀, so they keep the meaning they had at ω₀. Checkpoint 7c (planner
 * reply to Checkpoint 7b, §6): B per point under the league's reward (ΔE[S] from every prize component the runs keep), so a
 * split where 2nd place pays much gives a lower ω than the title on the same seasons, and a split paying only weekly high
 * scores and the points title is measured while the bracket is unknown; and (the review of the reward engine) the trade
 * context's own simulation lists the weekly high scores its reward pays, a reward that pays them is refused on a context
 * built without them, and runs made without them can't be priced under a split that pays them. Synthetic leagues (made-up
 * players, placeholder teams).
 */
import { describe, expect, it } from "vitest";
import { benefit, benefitWin, goalWeights, helpsScale, protectValueWeight, titleOnlyReward } from "./benefit";
import { config } from "./config";
import { analyzeTrade, buildTradeContext, evaluateExact, helpsScaleOf, simulateTrade, throwIns, tradeInternals, type SimState, type TeamState } from "./evaluate";
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
import type { LeagueModel, LineupThresholds, PlayoffWeightAuto, PlayoffWeightRun, SeasonOdds, TeamOdds } from "./leagueModel";
import type { LeagueSnapshot } from "./model";
import { paysWeekly, prizeOddsOf, rewardOf, rewardWith, runPrizeDeltas, shareChange, titleDeltas, type PrizeDeltas, type Reward } from "./reward";
import { runTradeSearch } from "./search";
import { seasonOdds, type SeasonModel } from "./season";
import { GOALS, defaultTradeSettings, type Goal, type PrizeAmounts, type TradeSettings } from "./settings";
import { rosValue } from "./teamValue";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { TradeEvaluation } from "./tradeModel";

const range = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
const { gain, clamp } = config.lineups.playoffWeightAuto;
const FALLBACK = config.lineups.playoffWeight;

/** A run of the measurement: `n` weeks changed (NFL weeks from `first` on) and my odds' changes (`more`: the other prizes'). */
const run = (n: number, dPO: number, dCH: number | null, first = 1, more: Partial<PrizeDeltas> = {}): PlayoffWeightRun => ({ weeks: range(first, first + n - 1), dPO, dCH, dPrizes: { ...titleDeltas(dCH), ...more } });
/** A goal's reward, 1st place paying everything (what "title" and "playoffs" give: reward.ts rewardOf). */
const T = (goal: Goal): Reward => titleOnlyReward(goal);
/** B per point by hand: B_win under the reward ÷ (gain × weeks), ΔE[S] = Σ paid shares × the run's changes. */
const perPoint = (r: PlayoffWeightRun, reward: Reward): number => {
  const w = goalWeights(reward.goal);
  return (100 * (w.playoffs * r.dPO + w.prizes * (shareChange(r.dPrizes, reward) as number))) / (gain * r.weeks.length);
};
/** "Several prizes" with these amounts on a league of 8 prize periods (smallLeague's regular season). */
const prizes = (a: Partial<PrizeAmounts>): Reward => rewardWith({ goal: "prizes", prizes: { first: null, second: null, third: null, weeklyHigh: null, pointsLeader: null, ...a } }, 8);

describe("playoffWeightFrom: ω from the two runs (pure)", () => {
  it("is the playoff run's B per point ÷ the regular-season run's, under the goal's weights, rounded to 0.01", () => {
    const runs = { regular: run(10, 0.1, 0.02), playoffs: run(3, 0, 0.03, 11) };
    const title = playoffWeightFrom(runs, T("title"), 5000);
    // 100 × (0.15 × 0.1 + 0.85 × 0.02) / 30 = 0.10667; 100 × 0.85 × 0.03 / 9 = 0.28333: 2.656… → 2.66.
    expect(title.regularPerPoint).toBeCloseTo(perPoint(runs.regular, T("title")), 12);
    expect(title.playoffPerPoint).toBeCloseTo(perPoint(runs.playoffs, T("title")), 12);
    expect(title.ratio).toBeCloseTo(2.65625, 9);
    expect(title).toMatchObject({ omega: 2.66, basis: "auto", reason: null, goal: "title", reward: T("title"), gain, sims: 5000, clamped: null, runs });
    expect(config.lineups.playoffWeightAuto.decimals).toBe(2);
    // "Only the champion" reads the title's change bit for bit, whatever else the runs hold (a prize nobody pays isn't read).
    const noisy = { regular: run(10, 0.1, 0.02, 1, { second: 0.5, third: null }), playoffs: run(3, 0, 0.03, 11, { second: Number.NaN }) };
    expect(playoffWeightFrom(noisy, T("title"), 5000)).toMatchObject({ regularPerPoint: title.regularPerPoint, playoffPerPoint: title.playoffPerPoint, omega: 2.66 });
  });

  it("“Several prizes”: B per point from ΔE[S], the runs' prize components weighed by the league's split (Checkpoint 7c)", () => {
    // +3 a week in the regular season moves 1st and 2nd alike; in the playoffs it moves 1st up and 2nd down (a final won
    // instead of lost): where 2nd pays much, winning the final matters less than reaching it.
    const runs = {
      regular: run(10, 0.1, 0.02, 1, { second: 0.02, third: 0.01, weeklyHigh: 0, pointsLeader: 0.01 }),
      playoffs: run(3, 0, 0.03, 11, { second: -0.02, third: 0, weeklyHigh: 0, pointsLeader: 0 }),
    };
    const split = prizes({ first: 50, second: 45, third: 5 });
    const w = playoffWeightFrom(runs, split, 5000);
    // ΔE[S]: regular 0.5 × 0.02 + 0.45 × 0.02 + 0.05 × 0.01 = 0.0195; playoffs 0.5 × 0.03 − 0.45 × 0.02 = 0.006.
    expect(w.regularPerPoint).toBeCloseTo((100 * (0.15 * 0.1 + 0.85 * 0.0195)) / 30, 12);
    expect(w.playoffPerPoint).toBeCloseTo((100 * (0.85 * 0.006)) / 9, 12);
    expect(w.regularPerPoint).toBe(perPoint(runs.regular, split));
    expect(w).toMatchObject({ basis: "auto", goal: "prizes", reward: split });
    // On the same runs, the title weighs the playoff weeks far more.
    expect(w.omega).toBeLessThan(playoffWeightFrom(runs, T("title"), 5000).omega);
    // A paid prize whose change is unknown: the fallback, as title odds unknown; a split that doesn't pay it is measured.
    const thirdUnknown = { regular: run(10, 0.1, 0.02, 1, { second: 0.02, third: null }), playoffs: run(3, 0, 0.03, 11, { second: -0.02, third: null }) };
    expect(playoffWeightFrom(thirdUnknown, split, 5000)).toMatchObject({ basis: "fallback", reason: "titleUnknown" });
    expect(playoffWeightFrom(thirdUnknown, prizes({ first: 50, second: 45 }), 5000)).toMatchObject({ basis: "auto" });
    // A run made before Checkpoint 7c (no dPrizes): its ΔCH as 1st place's.
    const old = { regular: { weeks: range(1, 10), dPO: 0.1, dCH: 0.02 } as PlayoffWeightRun, playoffs: { weeks: range(11, 13), dPO: 0, dCH: 0.03 } as PlayoffWeightRun };
    expect(playoffWeightFrom(old, T("title"), 5000).omega).toBe(2.66);
  });

  it("clamps to [0.5, 4]: a ratio outside it takes the end it passed", () => {
    expect(clamp).toEqual([0.5, 4]);
    // "Make the playoffs": 100 × (0.7 × 0.1 + 0.3 × 0.02) / 30 = 0.25333; 100 × 0.3 × 0.03 / 9 = 0.1: 0.39 → 0.5.
    const low = playoffWeightFrom({ regular: run(10, 0.1, 0.02), playoffs: run(3, 0, 0.03, 11) }, T("playoffs"), 5000);
    expect(low).toMatchObject({ omega: 0.5, basis: "auto", clamped: "low" });
    expect(low.ratio).toBeCloseTo(0.1 / (7.6 / 30), 9);
    const high = playoffWeightFrom({ regular: run(10, 0.001, 0.001), playoffs: run(3, 0, 0.05, 11) }, T("title"), 5000);
    expect(high).toMatchObject({ omega: 4, clamped: "high" });
    expect(high.ratio as number).toBeGreaterThan(4);
  });

  it("one per-point B not above 0 while the other is: that end of the clamp (only the playoffs move my odds: the top)", () => {
    expect(playoffWeightFrom({ regular: run(10, 0, 0), playoffs: run(3, 0, 0.02, 11) }, T("title"), 5000)).toMatchObject({ omega: 4, basis: "auto", clamped: "high", ratio: null, regularPerPoint: 0 });
    expect(playoffWeightFrom({ regular: run(10, 0.05, 0.01), playoffs: run(3, 0, 0, 11) }, T("title"), 5000)).toMatchObject({ omega: 0.5, basis: "auto", clamped: "low", ratio: null, playoffPerPoint: 0 });
    expect(playoffWeightFrom({ regular: run(10, 0.05, 0.01), playoffs: run(3, 0, -0.001, 11) }, T("title"), 5000)).toMatchObject({ omega: 0.5, clamped: "low" });
  });

  it("falls back to config.lineups.playoffWeight when neither run moves my odds, a ΔCH is unknown, or a B isn't a number", () => {
    const runs = { regular: run(10, 0, 0), playoffs: run(3, 0, 0, 11) };
    expect(playoffWeightFrom(runs, T("title"), 5000)).toEqual({ omega: FALLBACK, basis: "fallback", reason: "noEffect", goal: "title", reward: T("title"), gain, sims: 5000, regularPerPoint: 0, playoffPerPoint: 0, ratio: null, clamped: null, runs });
    expect(playoffWeightFrom({ regular: run(10, 0.1, null), playoffs: run(3, 0, null, 11) }, T("title"), 5000)).toMatchObject({ omega: FALLBACK, basis: "fallback", reason: "titleUnknown", regularPerPoint: null });
    expect(playoffWeightFrom({ regular: run(10, Number.NaN, 0.01), playoffs: run(3, 0, 0.01, 11) }, T("title"), 5000)).toMatchObject({ omega: FALLBACK, reason: "notFinite" });
    expect(playoffWeightFrom({ regular: run(0, 0.1, 0.01), playoffs: run(3, 0, 0.01, 11) }, T("title"), 5000)).toMatchObject({ omega: FALLBACK, reason: "notFinite" });
    expect(FALLBACK).toBe(1.25);
    // The fallback's own shape: nothing measured.
    const split = prizes({ first: 60, second: 30, third: 10 });
    expect(playoffWeightFallback("noTeam", split)).toEqual({ omega: FALLBACK, basis: "fallback", reason: "noTeam", goal: "prizes", reward: split, gain, sims: 0, regularPerPoint: null, playoffPerPoint: null, ratio: null, clamped: null, runs: null });
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
 * on the same seasons (seasonOdds draws simNormals of the seed when given none: the same draws), with the weekly high scores
 * when the model's reward pays them (the weekly change unknown otherwise: reward.ts runPrizeDeltas).
 */
function byHand(snapshot: LeagueSnapshot, model: LeagueModel, sims: number): { base: SeasonOdds; regular: PlayoffWeightRun; playoffs: PlayoffWeightRun } {
  const stand: SeasonModel = { weeks: model.weeks, regularWeeks: model.regularWeeks, playoffWeeks: model.playoffWeeks, inProgressWeek: model.inProgressWeek, teams: model.teams.map((t) => ({ id: t.id, score: t.score })) };
  const highScores = paysWeekly(model.reward);
  const on = { sims, seed: config.simulation.seed, highScores };
  const base = seasonOdds(snapshot, stand, on) as SeasonOdds;
  const from = model.inProgressWeek === null ? 0 : 1;
  const me = model.myTeamId as string;
  const change = (kind: readonly number[]): PlayoffWeightRun => {
    const at = new Set(model.weeks.flatMap((w, i) => (i >= from && kind.includes(w) ? [i] : [])));
    const teams = stand.teams.map((t) => (t.id === me ? { id: t.id, score: { mean: t.score.mean.map((m, i) => (at.has(i) ? m + gain : m)), sd: [...t.score.sd] } } : t));
    const after = (seasonOdds(snapshot, { ...stand, teams }, on) as SeasonOdds).teams.find((t) => t.teamId === me);
    const before = base.teams.find((t) => t.teamId === me);
    return {
      weeks: [...at].map((i) => model.weeks[i] as number),
      dPO: (after?.pPlayoffs as number) - (before?.pPlayoffs as number),
      dCH: (after?.pTitle as number) - (before?.pTitle as number),
      dPrizes: runPrizeDeltas(prizeOddsOf(before as NonNullable<typeof before>), prizeOddsOf(after as NonNullable<typeof after>), highScores),
    };
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
    expect(auto.regularPerPoint).toBe(perPoint(hand.regular, T("title")));
    expect(auto.playoffPerPoint).toBe(perPoint(hand.playoffs, T("title")));
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

  it("weighs my odds by the goal: the same runs under every goal, each goal's B per point (TradeSettings.goal and prizes)", () => {
    const byGoal = Object.fromEntries(GOALS.map((g) => [g, buildLeagueModel(lg.snapshot, lg.inputs, { ...OPTS, settings: { ...defaultTradeSettings(), goal: g } })]));
    for (const g of GOALS) {
      const m = byGoal[g] as LeagueModel;
      const a = m.playoffWeightAuto as PlayoffWeightAuto;
      expect(a.goal).toBe(g);
      // The model's reward: the settings' (the prefilled split under "Several prizes"), no weekly high score.
      expect(m.reward).toEqual(rewardOf({ goal: g, prizes: defaultTradeSettings().prizes }, lg.snapshot));
      expect(a.reward).toEqual(m.reward);
      expect(a.runs).toEqual(auto.runs);
      expect(a.regularPerPoint).toBe(perPoint(auto.runs?.regular as PlayoffWeightRun, a.reward));
      expect(a.playoffPerPoint).toBe(perPoint(auto.runs?.playoffs as PlayoffWeightRun, a.reward));
    }
    // Title odds weigh more under "Only the champion", and only they move in the playoff run: its ratio is the largest (this
    // league's ω is at the clamp's top under both prize goals).
    const ratio = (g: Goal) => (byGoal[g] as LeagueModel).playoffWeightAuto?.ratio as number;
    expect(ratio("title")).toBeGreaterThan(ratio("playoffs"));
    // The prefilled split pays 2nd and 3rd place too: reaching the final counts, so the playoff weeks weigh less than under the title.
    expect(ratio("prizes")).toBeLessThan(ratio("title"));
    // Settings an older version stored with "Top finishers too" build the "Several prizes" model on the prefilled split
    // (settings.ts's migration: the engine reads every stored copy through normalizeTradeSettings).
    const legacy = buildLeagueModel(lg.snapshot, lg.inputs, { ...OPTS, settings: { ...defaultTradeSettings(), goal: "balanced" } as unknown as TradeSettings });
    expect(legacy).toEqual(byGoal.prizes);
  });

  it("a split where 2nd place pays much: a lower ω than the title on the same seasons; the runs keep every prize component", () => {
    // smallLeague(11) without records: ω under the title isn't at the clamp.
    const free = smallLeague(11);
    const title = buildLeagueModel(free.snapshot, free.inputs, OPTS);
    const model2 = buildLeagueModel(free.snapshot, free.inputs, { ...OPTS, settings: { ...defaultTradeSettings(), goal: "prizes", prizes: { first: 50, second: 45, third: 5, weeklyHigh: null, pointsLeader: null } } });
    const t = title.playoffWeightAuto as PlayoffWeightAuto;
    const a = model2.playoffWeightAuto as PlayoffWeightAuto;
    expect(t).toMatchObject({ basis: "auto", clamped: null });
    expect(a.basis).toBe("auto");
    // The same seasons and setup (no weekly prize: no high scores simulated), so the same runs, priced under another split.
    expect(a.runs).toEqual(t.runs);
    expect(model2.playoffWeight).toBeLessThan(title.playoffWeight);
    expect(a.ratio as number).toBeLessThan(t.ratio as number);
    expect(a.regularPerPoint).toBe(perPoint(a.runs?.regular as PlayoffWeightRun, a.reward));
    expect(a.playoffPerPoint).toBe(perPoint(a.runs?.playoffs as PlayoffWeightRun, a.reward));
    // In the playoff run, +3 a week moves P(title) more than P(2nd) (a final reached more often, and won more often than
    // lost): where 2nd place pays nearly as much as 1st, those weeks are worth less.
    expect(a.runs?.playoffs.dPrizes.first as number).toBeGreaterThan(a.runs?.playoffs.dPrizes.second as number);
    expect(a.runs?.playoffs.dPrizes.first as number).toBeGreaterThan(0);
  });

  it("a split paying only weekly high scores and the points title: measured while the bracket is unknown (4 playoff teams in one listed week)", () => {
    const noBracket = season(11, { playoff: [9] });
    const titleModel = buildLeagueModel(noBracket.snapshot, noBracket.inputs, OPTS);
    expect(titleModel.playoffWeightAuto?.reason).toBe("titleUnknown");
    const weekly = buildLeagueModel(noBracket.snapshot, noBracket.inputs, { ...OPTS, settings: { ...defaultTradeSettings(), goal: "prizes", prizes: { first: null, second: null, third: null, weeklyHigh: 20, pointsLeader: 100 } } });
    const a = weekly.playoffWeightAuto as PlayoffWeightAuto;
    expect(a.reason).not.toBe("titleUnknown");
    expect(a.reward.shares).toMatchObject({ first: 0, weeklyHigh: 160 / 260, pointsLeader: 100 / 260 });
    // The weekly high scores were simulated: the regular-season run moves my expected high scores.
    expect(weekly.odds?.highScorePeriods).toBeGreaterThan(0);
    expect(a.runs?.regular.dPrizes.weeklyHigh as number).toBeGreaterThan(0);
    // A playoff week's points win no regular-season prize: that run moves none of them, so only the regular season counts.
    expect(a.runs?.playoffs.dPrizes.weeklyHigh).toBe(0);
    expect(a).toMatchObject({ basis: "auto", omega: clamp[0], clamped: "low" });
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
    expect(measurePlayoffWeight(lg.snapshot, weeks, null, 0, T("title"), { sims: 500, seed: 1 }, scores).auto.reason).toBe("noTeam");
    expect(measurePlayoffWeight(lg.snapshot, weeks, "1", 0, T("title"), { sims: 0, seed: 1 }, scores).auto.reason).toBe("noOdds");
    expect(measurePlayoffWeight(lg.snapshot, { ...weeks, regularWeeks: [] }, "1", 0, T("title"), { sims: 500, seed: 1 }, scores).auto.reason).toBe("noRegularWeeks");
    expect(measurePlayoffWeight(lg.snapshot, { ...weeks, playoffWeeks: [] }, "1", 0, T("title"), { sims: 500, seed: 1 }, scores).auto.reason).toBe("noPlayoffWeeks");
    expect(asked).toBe(0);
    // Scores missing for the league's teams: the simulator refuses the setup (a RangeError), so no odds.
    const refused = measurePlayoffWeight(lg.snapshot, weeks, "1", 0, T("title"), { sims: 500, seed: 1 }, scores);
    expect(asked).toBe(1);
    expect(refused).toEqual({ auto: playoffWeightFallback("noOdds", T("title")), sim: null });
  });
});

describe("one ω everywhere: the trade context's is the League page's model's (one baseline everywhere)", { timeout: 60_000 }, () => {
  const cases: { label: string; goal: Goal; prizes?: PrizeAmounts }[] = [
    { label: "title", goal: "title" },
    { label: "playoffs", goal: "playoffs" },
    { label: "prizes, the prefilled split", goal: "prizes" },
    // The weekly high scores simulated in both (Checkpoint 7c: only when the weekly prize pays).
    { label: "prizes, a weekly high score and the points title too", goal: "prizes", prizes: { first: 50, second: 20, third: 10, weeklyHigh: 2, pointsLeader: 4 } },
  ];
  for (const { label, goal, prizes: amounts } of cases) {
    it(`under "${label}": the same measurement, so the same weights in every ROS(T) of the search`, () => {
      const lg = season(11);
      const settings = { ...defaultTradeSettings(), goal, ...(amounts ? { prizes: amounts } : {}) };
      const model = buildLeagueModel(lg.snapshot, lg.inputs, { now: TEST_NOW, scenarios: 0, settings });
      const I = tradeInternals(buildTradeContext(lg.snapshot, lg.inputs, { now: TEST_NOW, scenarios: 0, settings }));
      expect(model.playoffWeightAuto?.basis).toBe("auto");
      // Measured on the shown block's seasons (Checkpoint 7e: the League model's own, config.simulation.shownSims).
      expect(model.playoffWeightAuto?.sims).toBe(config.simulation.shownSims);
      expect(I.model.playoffWeightAuto).toEqual(model.playoffWeightAuto);
      expect(I.model.playoffWeight).toBe(model.playoffWeight);
      expect([...I.weights]).toEqual([...teamWeeks(model, model.inProgressWeek, { ...config.lineups, playoffWeight: model.playoffWeight }).weights]);
      // …and the same thresholds in ROS lineup points (× Σω ÷ Σω₀).
      expect(I.league.thresholds).toEqual(model.lineupThresholds);
      // So the baseline is the League page's headline (evaluate.baseline.test.ts checks it in more leagues).
      expect(I.sim?.odds).toEqual(model.odds);
      // …and the same reward, and the same "Helps you" calibration run (every prize component), so the same B₃.
      expect(I.league.reward).toEqual(model.reward);
      expect(I.sim?.highScores).toBe((model.reward?.shares.weeklyHigh ?? 0) > 0);
      expect(I.sim?.calibration).toEqual(model.helpsCalibration);
    });
  }

  it("a split paying the weekly high score: the trade context's own simulation lists the high scores, so its baseline is the League page's prize odds and every trade's B counts its weekly change (the review of the reward engine, RW-1)", () => {
    const lg = season(11);
    const settings: TradeSettings = { ...defaultTradeSettings(), goal: "prizes", prizes: { first: 50, second: 20, third: 10, weeklyHigh: 2, pointsLeader: 4 }, minChance: 0 };
    const model = buildLeagueModel(lg.snapshot, lg.inputs, { now: TEST_NOW, scenarios: 0, settings });
    const ctx = buildTradeContext(lg.snapshot, lg.inputs, { now: TEST_NOW, scenarios: 0, settings });
    const I = tradeInternals(ctx);
    const sim = I.sim as SimState;
    // The setup every trade runs on lists the League page's high-score periods.
    expect(model.odds?.highScorePeriods).toBeGreaterThan(0);
    expect(sim.built.setup.highScorePeriods?.length).toBe(model.odds?.highScorePeriods);
    // My baseline prize components (runSim's, read off every trade's run) are the League page's headline's, high scores won included.
    const mine = model.odds?.teams.find((t) => t.teamId === model.myTeamId) as TeamOdds;
    // (Checkpoint 7e: the shown block's baseline, the cards' "before".)
    expect(sim.base.shown.prizes).toEqual(prizeOddsOf(mine));
    expect(sim.base.shown.prizes.weeklyHigh).toBeGreaterThan(0);
    // A trade's B: benefit() under the weekly reward, from a weekly change the trade's own run measured.
    const result = runTradeSearch(ctx, { settings });
    const card = result.trades.find((t) => t.stage === "final" && t.dPrizes?.weeklyHigh !== 0) as TradeEvaluation;
    expect(card).toBeDefined();
    expect(Number.isFinite(card.dPrizes?.weeklyHigh)).toBe(true);
    const reward = I.league.reward;
    expect(reward.shares.weeklyHigh).toBeGreaterThan(0);
    const b = benefit({ leagueType: "redraft", dPO: card.dPO, dCH: card.dCH, dPrizes: card.dPrizes, gMine: card.gMine, dynasty: null, myPPlayoffs: sim.base.shown.pPlayoffs, lambda: null, kappa: protectValueWeight(settings.protectValue), b3: card.b3, reward });
    expect(card.b).toBe(b.b);
    expect(card.bWin).toBe(benefitWin(card.dPO, card.dPrizes ?? null, config.benefit, reward).bWin);
    // The weekly term is in it: the same B with the weekly change left out differs.
    const noWeekly = benefitWin(card.dPO, { ...(card.dPrizes as PrizeDeltas), weeklyHigh: 0 }, config.benefit, reward).bWin;
    expect(noWeekly).not.toBe(card.bWin);
  });

  it("a reward that pays the weekly high score, on a context built without them, is refused, never priced with 0 high scores for everyone (the review of the reward engine, RW-4)", () => {
    const lg = season(11);
    const weekly: TradeSettings = { ...defaultTradeSettings(), goal: "prizes", prizes: { first: 50, second: 20, third: 10, weeklyHigh: 2, pointsLeader: null } };
    const titleCtx = buildTradeContext(lg.snapshot, lg.inputs, { now: TEST_NOW, scenarios: 0 });
    const I = tradeInternals(titleCtx);
    expect(I.sim?.highScores).toBe(false);
    const me = I.me as TeamState;
    const partner = I.byId.get("2") as TeamState;
    const proposal = { partnerId: "2", give: [{ kind: "player" as const, id: me.roster[0] as string }], get: [{ kind: "player" as const, id: partner.roster[0] as string }] };
    const x = evaluateExact(I, proposal, 2);
    if ("illegal" in x) throw new Error(`illegal: ${x.illegal}`);
    const reward = rewardOf(weekly, lg.snapshot);
    const refused = /didn't simulate the weekly high scores its reward pays/;
    expect(() => simulateTrade(I, x, "final", null, undefined, reward)).toThrow(refused);
    expect(() => helpsScaleOf(I, null, reward)).toThrow(refused);
    expect(() => analyzeTrade(titleCtx, proposal, { settings: weekly })).toThrow(refused);
    // The same calls on a context built with that reward's settings: priced, the weekly change measured.
    const weeklyCtx = buildTradeContext(lg.snapshot, lg.inputs, { now: TEST_NOW, scenarios: 0, settings: weekly });
    const J = tradeInternals(weeklyCtx);
    const y = evaluateExact(J, proposal, 2);
    if ("illegal" in y) throw new Error(`illegal: ${y.illegal}`);
    expect(Number.isFinite(simulateTrade(J, y, "final", null, undefined, rewardOf(weekly, lg.snapshot)).dPrizes?.weeklyHigh)).toBe(true);
    expect(helpsScaleOf(J, null, rewardOf(weekly, lg.snapshot))?.b3).toBeGreaterThan(0);
    expect(analyzeTrade(weeklyCtx, proposal, { settings: weekly }).evaluation?.b).not.toBeNull();
    // And a reward that doesn't pay them is priced on the title context as before (its weekly change unknown, never read).
    const places = simulateTrade(I, x, "final", null, undefined, rewardOf({ ...weekly, prizes: { ...weekly.prizes, weeklyHigh: null } }, lg.snapshot));
    expect(places.b).not.toBeNull();
    expect(places.dPrizes?.weeklyHigh).toBeNull();
  });
});

describe("runs made without the weekly high scores can't be priced under a split that pays them (the review of the reward engine, compat-R1)", () => {
  // smallLeague(11) without records: ω under the title isn't at the clamp.
  const lg = smallLeague(11);
  const OPTS: BuildLeagueModelOptions = { now: TEST_NOW, scenarios: 0 };
  const weekly: TradeSettings = { ...defaultTradeSettings(), goal: "prizes", prizes: { first: 50, second: null, third: null, weeklyHigh: 10, pointsLeader: null } };
  const reward = rewardOf(weekly, lg.snapshot);
  const title = buildLeagueModel(lg.snapshot, lg.inputs, OPTS);
  const own = buildLeagueModel(lg.snapshot, lg.inputs, { ...OPTS, settings: weekly });

  it("a build whose reward doesn't pay them keeps their change unknown, not 0: its ω runs and its calibration", () => {
    const runs = title.playoffWeightAuto?.runs as NonNullable<PlayoffWeightAuto["runs"]>;
    expect([runs.regular.dPrizes.weeklyHigh, runs.playoffs.dPrizes.weeklyHigh, title.helpsCalibration?.dPrizes.weeklyHigh]).toEqual([null, null, null]);
    // The split's own build simulated them: a measured change (more points in the regular season win more of them).
    const mine = own.playoffWeightAuto?.runs as NonNullable<PlayoffWeightAuto["runs"]>;
    expect(mine.regular.dPrizes.weeklyHigh as number).toBeGreaterThan(0);
    expect(mine.playoffs.dPrizes.weeklyHigh).toBe(0);
    expect(own.helpsCalibration?.dPrizes.weeklyHigh as number).toBeGreaterThan(0);
  });

  it("pricing them under the split anyway throws (no silent ω or B₃ without the weekly prize); the split's own runs give back its own ω and B₃", () => {
    const runs = title.playoffWeightAuto?.runs as NonNullable<PlayoffWeightAuto["runs"]>;
    const myPPlayoffs = title.odds?.teams.find((t) => t.teamId === title.myTeamId)?.pPlayoffs ?? null;
    expect(() => playoffWeightFrom(runs, reward, title.playoffWeightAuto?.sims as number)).toThrow(/The playoff-week weight's runs didn't simulate the weekly high scores/);
    expect(() => helpsScale(title.helpsCalibration, { leagueType: "redraft", myPPlayoffs, reward, dynastyTotal: null })).toThrow(/calibration run didn't simulate the weekly high scores/);
    const a = own.playoffWeightAuto as PlayoffWeightAuto;
    expect(playoffWeightFrom(a.runs as NonNullable<PlayoffWeightAuto["runs"]>, reward, a.sims)).toEqual(a);
    expect(helpsScale(own.helpsCalibration, { leagueType: "redraft", myPPlayoffs, reward, dynastyTotal: null })?.b3).toBeGreaterThan(0);
    // A split that doesn't pay the weekly high score still prices the title build's runs, as before.
    const places = rewardOf({ ...weekly, prizes: { first: 60, second: 30, third: 10, weeklyHigh: null, pointsLeader: null } }, lg.snapshot);
    expect(playoffWeightFrom(runs, places, title.playoffWeightAuto?.sims as number).basis).toBe("auto");
    expect(helpsScale(title.helpsCalibration, { leagueType: "redraft", myPPlayoffs, reward: places, dynastyTotal: null })?.b3).toBeGreaterThan(0);
  });
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
