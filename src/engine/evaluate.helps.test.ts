/**
 * Phase 7a, track SC (planner reply to Checkpoint 4c, A2): the self-calibrating "Helps you" scale. The League model's
 * calibration run (league.ts step 8c, LeagueModel.helpsCalibration) against a direct simulation of my score + 3 points a
 * week; the trade context's own run on its final block, the same bit for bit; B₃ (evaluate.helpsScaleOf) under each goal
 * and λ; every trade, step, Plan B and Analyzer evaluation scored on it; "+3 points a week reads 63"; the floor and its
 * note; review of track SC, SC-1: in a dynasty league the Win now ↔ Future slider past the largest default λ is capped in B₃
 * and gets its own note, never the floor note while the odds move. Seeded random leagues and hand leagues
 * (trade.testing.ts); teams are placeholders, players made up.
 */
import { describe, expect, it } from "vitest";
import { HELPS_FLOOR_NOTE, benefit, benefitWin, helpsLambdaNote, helpsScale, overallScore, tradeScore } from "./benefit";
import { config } from "./config";
import { analyzeTrade, buildTradeContext, evaluateExact, helpsScaleOf, simulateTrade, tradeInternals, type ExactTrade, type SimState, type TeamState, type TradeContext } from "./evaluate";
import type { ModelInputs } from "./inputs";
import { buildLeagueModel, helpsCalibrationOf, type BuildLeagueModelOptions } from "./league";
import type { HelpsCalibration, LeagueModel, SeasonOdds } from "./leagueModel";
import type { LeagueSnapshot } from "./model";
import { runTradeSearch } from "./search";
import { pickupSeasonModel, seasonOdds, type SeasonModel } from "./season";
import { GOALS, defaultTradeSettings } from "./settings";
import { simNormals } from "./sim";
import { TEST_NOW, randomLeague } from "./testLeague";
import { handLeague, smallLeague, withSeason } from "./trade.testing";
import type { TradeAsset, TradeProposal } from "./tradeModel";

const p = (...ids: string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));
const trade = (partnerId: string, give: string[], get: string[]): TradeProposal => ({ partnerId, give: p(...give), get: p(...get) });
const range = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

const EARLY = "2026-09-29T17:00:00.000Z"; // before TEST_NOW (20:00Z)
const LATE = "2026-09-30T00:15:00.000Z";

/** evaluate.baseline.test.ts's seeded random season: weeks 1–8, playoffs 9–10 for 4 of 6 teams; `live` puts week 6 under way. */
function randomSeason(seed: number, opts: { live?: boolean } = {}): { snapshot: LeagueSnapshot; inputs: ModelInputs } {
  const base = randomLeague({ teams: 6, seed, rosterSize: 13, freeAgentsPerPosition: 5, currentWeek: 6, injuries: true });
  if (opts.live) {
    const nfl = base.inputs.nfl as NonNullable<ModelInputs["nfl"]>;
    nfl.kickoffs = { 6: Object.fromEntries(range(1, 32).map((i) => [`T${String(i).padStart(2, "0")}`, i % 2 === 1 ? EARLY : LATE])) };
  }
  return withSeason(base, { pastWinnersOrder: ["3", "1", "5", "2", "6", "4"] });
}

/** `season` with my team's weekly score mean + `gain` from model week `from` on (σ unchanged). */
function plusMine(season: SeasonModel, me: string, gain: number, from: number): SeasonModel {
  return { ...season, teams: season.teams.map((t) => (t.id === me ? { id: t.id, score: { mean: t.score.mean.map((m, w) => (w >= from ? m + gain : m)), sd: [...t.score.sd] } } : t)) };
}

const mineOf = (odds: SeasonOdds | null | undefined, me: string) => odds?.teams.find((t) => t.teamId === me);

/** The first model week a trade can change: 1 when the first week is under way, else 0. */
const firstCounted = (model: Pick<LeagueModel, "weeks" | "inProgressWeek">): number => (model.inProgressWeek !== null && model.weeks[0] === model.inProgressWeek ? 1 : 0);

/** trade.testing.ts smallLeague(11) (6 teams, NFL week 6 of 1–8, playoffs 9–10), EV lineups. */
function smallContext(): TradeContext {
  const { snapshot, inputs } = smallLeague(11);
  return buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0 });
}

function exact(ctx: TradeContext, proposal: TradeProposal, maxPerSide = 4): ExactTrade {
  const x = evaluateExact(tradeInternals(ctx), proposal, maxPerSide);
  if ("illegal" in x) throw new Error(x.illegal);
  return x;
}

describe("the League model's calibration run (step 8c): my score + 3 a week from the first week a trade can change, on LeagueModel.odds' seasons", { timeout: 60_000 }, () => {
  const cases: { label: string; seed: number; live?: boolean; scenarios: number }[] = [
    { label: "EV lineups", seed: 31, scenarios: 0 },
    { label: "scenario lineups", seed: 32, scenarios: 8 },
    { label: "a week in progress (left out: every trade holds it as rosters stand)", seed: 34, live: true, scenarios: 8 },
  ];
  for (const c of cases) {
    it(`${c.label} (seed ${c.seed}): ΔPO and ΔCH exactly a direct simulation's, and the trade context's own run`, () => {
      const { snapshot, inputs } = randomSeason(c.seed, c);
      const opts: BuildLeagueModelOptions = { now: TEST_NOW, scenarios: c.scenarios };
      const model = buildLeagueModel(snapshot, inputs, opts);
      const me = model.myTeamId as string;
      const cal = model.helpsCalibration as HelpsCalibration;
      expect(cal).toBeTruthy();
      const from = firstCounted(model);
      expect(cal).toMatchObject({ gain: config.benefit.helpsGain, from });
      if (c.live) expect(from).toBe(1);
      // A direct simulation: the headline's season with my score + 3, the seed's own matrix (seasonOdds draws it).
      const pick = pickupSeasonModel(model);
      const before = mineOf(model.odds, me);
      const after = mineOf(seasonOdds(snapshot, plusMine(pick, me, 3, from), { sims: config.simulation.finalSims, seed: config.simulation.seed }), me);
      expect(Object.is(cal.dPO, (after?.pPlayoffs as number) - (before?.pPlayoffs as number))).toBe(true);
      expect(Object.is(cal.dCH, (after?.pTitle as number) - (before?.pTitle as number))).toBe(true);
      // More points every week: my odds can only rise on the shared matrix here.
      expect(cal.dPO).toBeGreaterThanOrEqual(0);
      expect(cal.dCH as number).toBeGreaterThan(0);
      // The trade context runs the same function on its final block: the same numbers, bit for bit.
      const sim = tradeInternals(buildTradeContext(snapshot, inputs, opts)).sim as SimState;
      expect(sim.calibration).toEqual(cal);
      expect(Object.is(sim.calibration?.dPO, cal.dPO) && Object.is(sim.calibration?.dCH, cal.dCH)).toBe(true);
      if (c.live) {
        // The week under way never gets the gain: with it there, the run reads another number.
        const all = mineOf(seasonOdds(snapshot, plusMine(pick, me, 3, 0), { sims: config.simulation.finalSims, seed: config.simulation.seed }), me);
        expect((all?.pPlayoffs as number) - (before?.pPlayoffs as number)).not.toBe(cal.dPO);
      }
    });
  }

  it("helpsCalibrationOf: a gain of 0 moves nothing; my team not in the odds, or no gain, gives none", () => {
    const { snapshot, inputs } = randomSeason(31);
    const model = buildLeagueModel(snapshot, inputs, { now: TEST_NOW, scenarios: 0 });
    const odds = model.odds as SeasonOdds;
    const pick = pickupSeasonModel(model);
    const run = { sims: 400, seed: 7, normals: simNormals(7, 400, model.weeks.length, model.teams.length) };
    const base = seasonOdds(snapshot, pick, run) as SeasonOdds;
    const zero = helpsCalibrationOf(snapshot, pick, "1", base, run, 0, { ...config, benefit: { helpsGain: 0 } });
    expect(zero).toEqual({ gain: 0, from: 0, dPO: 0, dCH: 0 });
    expect(helpsCalibrationOf(snapshot, pick, "no such team", odds, run, 0)).toBeNull();
    expect(helpsCalibrationOf(snapshot, pick, "1", base, run, 0, { ...config, benefit: { helpsGain: Number.NaN } })).toBeNull();
    // A gain from past the last week moves nothing either.
    expect(helpsCalibrationOf(snapshot, pick, "1", base, run, model.weeks.length)).toMatchObject({ dPO: 0, dCH: 0 });
  });

  it("no team picked, or no simulation: no calibration", () => {
    const { snapshot, inputs } = randomSeason(31);
    expect(buildLeagueModel({ ...snapshot, myTeamId: null }, inputs, { now: TEST_NOW, scenarios: 0 }).helpsCalibration).toBeNull();
    expect(buildLeagueModel(snapshot, inputs, { now: TEST_NOW, scenarios: 0, sims: 0 }).helpsCalibration).toBeNull();
    const none = tradeInternals(buildTradeContext({ ...snapshot, myTeamId: null }, inputs, { now: TEST_NOW, scenarios: 0 }));
    expect(none.sim?.calibration ?? null).toBeNull();
    expect(helpsScaleOf(none, null, "title")).toBeNull();
  });
});

describe("B₃ (evaluate.helpsScaleOf): the B of the calibration run under the call's goal and λ, the scale of every number scored", { timeout: 60_000 }, () => {
  const ctx = smallContext();
  const I = tradeInternals(ctx);
  const sim = I.sim as SimState;
  const cal = sim.calibration as HelpsCalibration;

  it("redraft: B_win of the run under each goal's weights; so the same run is scaled per goal", () => {
    const seen = new Set<number>();
    for (const goal of GOALS) {
      const s = helpsScaleOf(I, null, goal);
      expect(s?.raw, goal).toBe(benefitWin(cal.dPO, cal.dCH, config.benefit, goal).bWin);
      expect(s?.floored, goal).toBe(false);
      seen.add(s?.b3 as number);
    }
    expect(seen.size).toBe(GOALS.length);
  });

  it("a uniform +3 points a week reads 63 under every goal: the trade's own simulation path (the final block, the baseline it compares with)", () => {
    const me = I.me as TeamState;
    const season: SeasonModel = {
      weeks: I.league.lp.weeks.weeks,
      regularWeeks: I.league.lp.weeks.regularWeeks,
      playoffWeeks: I.league.lp.weeks.playoffWeeks,
      inProgressWeek: I.league.tw.inProgressWeek,
      teams: I.teams.map((t) => ({ id: t.id, score: { mean: Array.from(t.base.score.mean), sd: Array.from(t.base.score.sd) } })),
    };
    const after = mineOf(seasonOdds(I.snapshot, plusMine(season, me.id, 3, I.from), { sims: sim.blocks.final.sims, seed: sim.seed, normals: sim.blocks.final }), me.id);
    const dPO = (after?.pPlayoffs as number) - sim.base.final.pPlayoffs;
    const dCH = (after?.pTitle as number) - (sim.base.final.pTitle as number);
    for (const goal of GOALS) {
      const b = benefit({ leagueType: "redraft", dPO, dCH, gMine: 0, dynasty: null, myPPlayoffs: sim.base.final.pPlayoffs, goal }).b;
      expect(tradeScore(b, helpsScaleOf(I, null, goal)?.b3 ?? null), goal).toBe(63);
    }
  });

  it("every evaluation carries its B₃ and is scored on it: a final trade, a screened one and the Analyzer's, per goal", () => {
    const x = exact(ctx, trade("2", [(I.me as TeamState).roster[0] as string], [(I.byId.get("2") as TeamState).roster[0] as string]));
    for (const goal of GOALS) {
      const b3 = helpsScaleOf(I, null, goal)?.b3 as number;
      for (const stage of ["final", "screen"] as const) {
        const e = simulateTrade(I, x, stage, null, undefined, goal);
        expect(e.b3, `${goal} ${stage}`).toBe(b3);
        expect(e.tradeScore, `${goal} ${stage}`).toBe(tradeScore(e.b, b3));
        expect(e.overall, `${goal} ${stage}`).toBe(overallScore(e.b, e.pComplete, b3));
      }
      const a = analyzeTrade(ctx, x.evaluation.proposal, { settings: { ...defaultTradeSettings(), goal } }).evaluation;
      expect(a?.b3, goal).toBe(b3);
      expect(a?.tradeScore, goal).toBe(tradeScore(a?.b ?? null, b3));
    }
    // Before the simulation (the exact stage alone): no scale yet.
    expect(x.evaluation.b3).toBeNull();
  });

  it("dynasty: (1 − λ) × B_win of the run with long-term values (λ by the setting, else by my P(playoffs)); a trade worth +3 a week this season alone reads 63", () => {
    const { snapshot, inputs } = handLeague(() => undefined, { leagueType: "dynasty" });
    if (inputs.market) inputs.market.format = { ...inputs.market.format, isDynasty: true };
    const Id = tradeInternals(buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0 }));
    expect(Id.future).not.toBeNull();
    const run = (Id.sim as SimState).calibration as HelpsCalibration;
    const bWin = benefitWin(run.dPO, run.dCH).bWin as number;
    // λ capped at config.benefit.helpsLambdaMax (review of track SC, SC-1): past it, B₃ stays (1 − 0.75) × B_win₃.
    for (const lambda of [0, 0.35, 0.75, 0.8, 1]) expect(helpsScaleOf(Id, lambda, "title")?.raw, `λ ${lambda}`).toBeCloseTo((1 - Math.min(lambda, config.benefit.helpsLambdaMax)) * bWin, 12);
    const byDefault = helpsScale(run, { leagueType: "dynasty", myPPlayoffs: (Id.sim as SimState).base.final.pPlayoffs, dynastyTotal: Id.future?.myTotal ?? null });
    expect(helpsScaleOf(Id, null, "title")).toEqual(byDefault);
    const b = benefit({ leagueType: "dynasty", dPO: run.dPO, dCH: run.dCH, gMine: 0, dynasty: { delta: 0, total: Id.future?.myTotal as number }, myPPlayoffs: (Id.sim as SimState).base.final.pPlayoffs }).b;
    expect(tradeScore(b, helpsScaleOf(Id, null, "title")?.b3 ?? null)).toBe(63);
  });
});

describe("the floor: when +3 a week barely moves my odds, B₃ is config.benefit.helpsFloor and a note says so", { timeout: 60_000 }, () => {
  it("each evaluation carries the note, and the search says it once; the scores read B against the floor", () => {
    const ctx = smallContext();
    const I = tradeInternals(ctx);
    const sim = I.sim as SimState;
    const normal = runTradeSearch(ctx);
    expect(normal.notes).not.toContain(HELPS_FLOOR_NOTE);
    // My odds barely move with +3 a week (a team certainly out or locked in reads like this).
    sim.calibration = { ...(sim.calibration as HelpsCalibration), dPO: 0.0004, dCH: 0.0002 };
    const s = helpsScaleOf(I, null, "title");
    expect(s).toMatchObject({ b3: config.benefit.helpsFloor, floored: true });
    const x = exact(ctx, trade("2", [(I.me as TeamState).roster[0] as string], [(I.byId.get("2") as TeamState).roster[0] as string]));
    const e = simulateTrade(I, x, "final", null);
    expect(e.b3).toBe(config.benefit.helpsFloor);
    expect(e.tradeScore).toBe(tradeScore(e.b, config.benefit.helpsFloor));
    expect(e.detail.notes.filter((n) => n === HELPS_FLOOR_NOTE)).toHaveLength(1);
    const floored = runTradeSearch(ctx);
    expect(floored.notes.filter((n) => n === HELPS_FLOOR_NOTE)).toHaveLength(1);
    for (const t of floored.trades) expect(t.b3).toBe(config.benefit.helpsFloor);
    // The ranking reads EG (B × P_complete), not the scale: the same trades in the same order.
    expect(floored.trades.map((t) => t.key)).toEqual(normal.trades.map((t) => t.key));
  });
});

describe("dynasty, Win now ↔ Future at 0.95 and 1 (review of track SC, SC-1): the odds move, so no floor note; λ capped in B₃", { timeout: 60_000 }, () => {
  // trade.testing.ts smallLeague(12) as a dynasty league with long-term values: +3 a week moves my title odds about 5 points.
  const { snapshot, inputs } = smallLeague(12, { leagueType: "dynasty" });
  if (inputs.market) inputs.market.format = { ...inputs.market.format, isDynasty: true };
  const ctx = buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0 });
  const I = tradeInternals(ctx);
  const run = (I.sim as SimState).calibration as HelpsCalibration;
  const odds = benefitWin(run.dPO, run.dCH).bWin as number;

  it("the search and the Analyzer: every card on (1 − 0.75) × B_win₃, the λ note once, never the planner's floor note", () => {
    expect(I.future).not.toBeNull();
    expect(odds).toBeGreaterThan(4 * config.benefit.helpsFloor);
    for (const lambda of [0.95, 1]) {
      const scale = helpsScaleOf(I, lambda, "title");
      expect(scale, `λ ${lambda}`).toMatchObject({ floored: false, lambda, lambdaUsed: config.benefit.helpsLambdaMax, reason: "lambda" });
      expect(scale?.b3, `λ ${lambda}`).toBeCloseTo((1 - config.benefit.helpsLambdaMax) * odds, 12);
      const lambdaNote = helpsLambdaNote(lambda, scale?.gainReads as number);
      const settings = { ...defaultTradeSettings(), lambda, minChance: 0 };
      const result = runTradeSearch(ctx, { settings });
      expect(result.trades.length, `λ ${lambda}`).toBeGreaterThan(0);
      expect(result.notes, `λ ${lambda}`).not.toContain(HELPS_FLOOR_NOTE);
      expect(result.notes.filter((n) => n === lambdaNote), `λ ${lambda}`).toHaveLength(1);
      for (const t of result.trades) {
        expect(t.b3, `λ ${lambda}`).toBe(scale?.b3);
        expect(t.tradeScore, `λ ${lambda}`).toBe(tradeScore(t.b, scale?.b3 ?? null));
      }
      const a = analyzeTrade(ctx, (result.trades[0] as (typeof result.trades)[number]).proposal, { settings });
      expect(a.evaluation?.b3, `λ ${lambda}`).toBe(scale?.b3);
      expect(a.evaluation?.detail.notes, `λ ${lambda}`).toContain(lambdaNote);
      expect(a.evaluation?.detail.notes, `λ ${lambda}`).not.toContain(HELPS_FLOOR_NOTE);
    }
    // The default λ (a contender here) reads +3 a week as 63: no note at all.
    const auto = runTradeSearch(ctx, { settings: { ...defaultTradeSettings(), minChance: 0 } });
    expect(helpsScaleOf(I, null, "title")).toMatchObject({ reason: null, gainReads: 63 });
    expect(auto.notes.some((n) => n === HELPS_FLOOR_NOTE || n.startsWith("Your Win now ↔ Future setting"))).toBe(false);
  });
});

describe("the search: one B₃ for every card, its steps and its Plan B", { timeout: 60_000 }, () => {
  it("cards, offer-first steps and Plan B boxes are all scored on the search's B₃, under each goal", () => {
    const ctx = smallContext();
    const I = tradeInternals(ctx);
    for (const goal of GOALS) {
      const b3 = helpsScaleOf(I, null, goal)?.b3 as number;
      const result = runTradeSearch(ctx, { settings: { ...defaultTradeSettings(), goal, minChance: 0 } });
      expect(result.trades.length, goal).toBeGreaterThan(0);
      for (const t of result.trades) {
        expect(t.b3, goal).toBe(b3);
        expect(t.tradeScore, goal).toBe(tradeScore(t.b, b3));
        expect(t.overall, goal).toBe(overallScore(t.b, t.pComplete, b3));
        for (const step of t.steps ? [t.steps.offerFirst, t.steps.ifNo.full] : []) expect(step.tradeScore, goal).toBe(tradeScore(step.b, b3));
        if (t.planB) {
          expect(t.planB.tradeScore, goal).toBe(tradeScore(t.planB.b, b3));
          expect(t.planB.overall, goal).toBe(overallScore(t.planB.b, t.planB.pComplete, b3));
        }
      }
    }
  });
});
