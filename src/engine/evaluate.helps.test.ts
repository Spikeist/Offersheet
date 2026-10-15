/**
 * Phase 7a, track SC (planner reply to Checkpoint 4c, A2): the self-calibrating "Helps you" scale. The League model's
 * calibration run (league.ts step 8c, LeagueModel.helpsCalibration) against a direct simulation of my score + 3 points a
 * week; the trade context's own run on its final block, the same bit for bit; B₃ (evaluate.helpsScaleOf) under each goal
 * and λ; every trade, step, Plan B and Analyzer evaluation scored on it; "+3 points a week reads 63"; the floor and its
 * note. Planner reply to Checkpoint 7a, §2 questions 5 and 6: B's redraft market term is priced on the same B₃ (so every B
 * of a search, its steps' and its Plan Bs' too, reads the search's one B₃), and in a dynasty league with long-term values the
 * scale is B_ref(λ) = (1 − λ) × B_win₃ + λ × F₁₀, which replaces review SC-1's λ cap and its note. Seeded random leagues and
 * hand leagues (trade.testing.ts); teams are placeholders, players made up.
 */
import { describe, expect, it } from "vitest";
import { HELPS_FLOOR_NOTE, benefit, benefitWin, helpsScale, lineupEquivalent, overallScore, protectValueWeight, tradeScore } from "./benefit";
import { config } from "./config";
import { analyzeTrade, buildTradeContext, evaluateExact, helpsScaleOf, scaleBlockOf, simCounts, simulateTrade, tradeInternals, type ExactTrade, type SimState, type TeamState, type TradeContext } from "./evaluate";
import type { ModelInputs } from "./inputs";
import { buildLeagueModel, helpsCalibrationOf, type BuildLeagueModelOptions } from "./league";
import type { HelpsCalibration, LeagueModel, SeasonOdds } from "./leagueModel";
import type { LeagueSnapshot } from "./model";
import { prizeDeltas, prizeOddsOf, rewardOf, titleDeltas, type Reward } from "./reward";
import { runTradeSearch, searchStateOf, type SearchState } from "./search";
import { pickupSeasonModel, seasonOdds, type SeasonModel } from "./season";
import { GOALS, defaultTradeSettings, type Goal } from "./settings";
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

/** A goal's reward on a context's league with the default settings' prizes (the prefilled split under "Several prizes"). */
const rewardIn = (I: { snapshot: LeagueSnapshot }, goal: Goal): Reward => rewardOf({ ...defaultTradeSettings(), goal }, I.snapshot);

/** clamp(g_mkt(me)) as B's market term reads it (config.benefit.marketSanityClamp). */
const clampG = (g: number) => Math.min(config.benefit.marketSanityClamp[1], Math.max(config.benefit.marketSanityClamp[0], g));

/** The redraft market term an evaluation's B holds at the default level (medium): (B₃ / 3) × κ × clamp(g_mkt(me)). */
const termOf = (e: { b3: number | null; gMine: number }, kappa = protectValueWeight(config.benefit.protectValueDefault)) => ((e.b3 as number) / config.benefit.helpsGain) * kappa * clampG(e.gMine);

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
      const after = mineOf(seasonOdds(snapshot, plusMine(pick, me, 3, from), { sims: simCounts().shown, seed: config.simulation.seed }), me);
      expect(Object.is(cal.dPO, (after?.pPlayoffs as number) - (before?.pPlayoffs as number))).toBe(true);
      expect(Object.is(cal.dCH, (after?.pTitle as number) - (before?.pTitle as number))).toBe(true);
      // More points every week: my odds can only rise on the shared matrix here.
      expect(cal.dPO).toBeGreaterThanOrEqual(0);
      expect(cal.dCH as number).toBeGreaterThan(0);
      // The trade context runs the same function on its shown block (Checkpoint 7e: the League model's seasons): the same
      // numbers, bit for bit.
      const sim = tradeInternals(buildTradeContext(snapshot, inputs, opts)).sim as SimState;
      expect(sim.calibration).toEqual(cal);
      expect(Object.is(sim.calibration?.dPO, cal.dPO) && Object.is(sim.calibration?.dCH, cal.dCH)).toBe(true);
      if (c.live) {
        // The week under way never gets the gain: with it there, the run reads another number.
        const all = mineOf(seasonOdds(snapshot, plusMine(pick, me, 3, 0), { sims: simCounts().shown, seed: config.simulation.seed }), me);
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
    // No high scores simulated (the default goal doesn't pay them): their change is unknown, not 0 (reward.ts runPrizeDeltas).
    expect(zero).toEqual({ gain: 0, from: 0, dPO: 0, dCH: 0, dPrizes: { first: 0, second: 0, third: 0, weeklyHigh: null, pointsLeader: 0 } });
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
    expect(helpsScaleOf(none, null)).toBeNull();
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
      const s = helpsScaleOf(I, null, rewardIn(I, goal));
      expect(s?.raw, goal).toBe(benefitWin(cal.dPO, cal.dPrizes, config.benefit, rewardIn(I, goal)).bWin);
      expect(s?.floored, goal).toBe(false);
      seen.add(s?.b3 as number);
    }
    expect(seen.size).toBe(GOALS.length);
  });

  it("a uniform +3 points a week reads 63 under every goal: the trade's own simulation path (each block's baseline, scored on that block's B₃)", () => {
    const me = I.me as TeamState;
    const season: SeasonModel = {
      weeks: I.league.lp.weeks.weeks,
      regularWeeks: I.league.lp.weeks.regularWeeks,
      playoffWeeks: I.league.lp.weeks.playoffWeeks,
      inProgressWeek: I.league.tw.inProgressWeek,
      teams: I.teams.map((t) => ({ id: t.id, score: { mean: Array.from(t.base.score.mean), sd: Array.from(t.base.score.sd) } })),
    };
    // Checkpoint 7e: the shown block (the cards and the Analyzer) and the ranking block (the search's choice), each on its own.
    for (const block of ["shown", "final"] as const) {
      const after = mineOf(seasonOdds(I.snapshot, plusMine(season, me.id, 3, I.from), { sims: sim.blocks[block].sims, seed: sim.seed, normals: sim.blocks[block] }), me.id);
      const base = sim.base[block];
      const dPO = (after?.pPlayoffs as number) - base.pPlayoffs;
      const dCH = (after?.pTitle as number) - (base.pTitle as number);
      // Every prize component's change on the same run (Checkpoint 7c: "Several prizes" weighs 2nd and 3rd place too).
      const dPrizes = prizeDeltas(base.prizes, prizeOddsOf(after as NonNullable<typeof after>));
      expect(dPrizes.first).toBe(dCH);
      for (const goal of GOALS) {
        const reward = rewardIn(I, goal);
        const b = benefit({ leagueType: "redraft", dPO, dCH, dPrizes, gMine: 0, dynasty: null, myPPlayoffs: sim.base.shown.pPlayoffs, reward }).b;
        expect(tradeScore(b, helpsScaleOf(I, null, reward, block)?.b3 ?? null), `${goal} ${block}`).toBe(63);
      }
    }
  });

  it("every evaluation carries its B₃ and is scored on it: a shown trade, a ranked one, a screened one and the Analyzer's, per goal; its B's market term is priced on the same B₃", () => {
    const x = exact(ctx, trade("2", [(I.me as TeamState).roster[0] as string], [(I.byId.get("2") as TeamState).roster[0] as string]));
    const kappa = protectValueWeight(config.benefit.protectValueDefault);
    for (const goal of GOALS) {
      const scale = helpsScaleOf(I, null, rewardIn(I, goal));
      // Checkpoint 7e: the shown block's scale for the shown stage, the ranking block's for the ranking and screening stages.
      expect(scale?.b3, goal).not.toBe(helpsScaleOf(I, null, rewardIn(I, goal), "final")?.b3);
      for (const stage of ["shown", "final", "screen"] as const) {
        const b3 = helpsScaleOf(I, null, rewardIn(I, goal), scaleBlockOf(stage))?.b3 as number;
        const e = simulateTrade(I, x, stage, null, undefined, rewardIn(I, goal));
        expect(e.b3, `${goal} ${stage}`).toBe(b3);
        expect(e.tradeScore, `${goal} ${stage}`).toBe(tradeScore(e.b, b3));
        expect(e.overall, `${goal} ${stage}`).toBe(overallScore(e.b, e.pComplete, b3));
        // Planner reply to Checkpoint 7a, §2 question 5: B = B_win + (B₃ / 3) × κ × clamp(g_mkt(me)), worth κ × clamp(g) a week.
        expect(e.b as number, `${goal} ${stage}`).toBeCloseTo((e.bWin as number) + termOf(e), 12);
        expect(e.marketWeekly as number, `${goal} ${stage}`).toBeCloseTo(kappa * clampG(e.gMine), 12);
        expect(lineupEquivalent((e.b as number) - (e.bWin as number), b3) as number, `${goal} ${stage}`).toBeCloseTo(e.marketWeekly as number, 9);
      }
      const analysis = analyzeTrade(ctx, x.evaluation.proposal, { settings: { ...defaultTradeSettings(), goal } });
      const a = analysis.evaluation;
      expect(a?.b3, goal).toBe(scale?.b3);
      expect(a?.tradeScore, goal).toBe(tradeScore(a?.b ?? null, scale?.b3 ?? null));
      expect(a?.marketWeekly as number, goal).toBeCloseTo(kappa * clampG(a?.gMine as number), 12);
      // The Analyzer's scale (the tooltip's parts) is the evaluation's.
      expect(analysis.helpsScale, goal).toEqual(scale);
    }
    // Before the simulation (the exact stage alone): no scale yet, and no market term.
    expect(x.evaluation.b3).toBeNull();
    expect(x.evaluation.marketWeekly).toBeNull();
  });

  it("B reads its own evaluation's B₃: on another scale the market term moves with it and its lineup equivalent doesn't (planner reply to Checkpoint 7a, §2 question 5)", () => {
    // A trade with value moving both ways: my WR for Team 2's (a g_mkt(me) away from 0 in this league).
    const me = I.me as TeamState;
    const x = me.roster
      .flatMap((give) => (I.byId.get("2") as TeamState).roster.map((get) => ({ give, get })))
      .map(({ give, get }) => evaluateExact(I, trade("2", [give], [get]), 2))
      .find((r): r is ExactTrade => !("illegal" in r) && Math.abs(r.evaluation.gMine) > 0.02) as ExactTrade;
    expect(x).toBeTruthy();
    const before = simulateTrade(I, x, "shown", null);
    const saved = sim.calibration;
    try {
      sim.calibration = { ...cal, dPO: cal.dPO * 2, dCH: (cal.dCH as number) * 2, dPrizes: titleDeltas((cal.dCH as number) * 2) };
      const after = simulateTrade(I, x, "shown", null);
      expect(after.b3 as number).toBeCloseTo(2 * (before.b3 as number), 9);
      expect(after.bWin).toBe(before.bWin); // the trade's own simulation doesn't depend on the scale
      expect(after.marketWeekly).toBe(before.marketWeekly);
      expect((after.b as number) - (after.bWin as number)).toBeCloseTo(2 * ((before.b as number) - (before.bWin as number)), 9);
      expect(after.b as number).toBeCloseTo((after.bWin as number) + termOf(after), 12);
    } finally {
      sim.calibration = saved;
    }
  });

  it("dynasty with long-term values: B_ref(λ) = (1 − λ) × B_win₃ + λ × F₁₀ (λ by the setting, else by my P(playoffs)); a trade worth +3 a week this season and +10% long-term value reads 63", () => {
    const { snapshot, inputs } = handLeague(() => undefined, { leagueType: "dynasty" });
    if (inputs.market) inputs.market.format = { ...inputs.market.format, isDynasty: true };
    const Id = tradeInternals(buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0 }));
    expect(Id.future).not.toBeNull();
    const run = (Id.sim as SimState).calibration as HelpsCalibration;
    const bWin = benefitWin(run.dPO, run.dPrizes).bWin as number;
    const F10 = config.benefit.bFutureScale * config.benefit.helpsFutureShare;
    // Review SC-1's λ cap is gone: λ 0.8 and 1 mix as any other.
    for (const lambda of [0, 0.35, 0.75, 0.8, 1]) {
      const s = helpsScaleOf(Id, lambda);
      expect(s?.raw, `λ ${lambda}`).toBeCloseTo((1 - lambda) * bWin + lambda * F10, 12);
      expect(s, `λ ${lambda}`).toMatchObject({ lambda, f10: F10, odds: bWin });
    }
    const byDefault = helpsScale(run, { leagueType: "dynasty", myPPlayoffs: (Id.sim as SimState).base.shown.pPlayoffs, dynastyTotal: Id.future?.myTotal ?? null });
    expect(helpsScaleOf(Id, null)).toEqual(byDefault);
    const total = Id.future?.myTotal as number;
    const b = benefit({ leagueType: "dynasty", dPO: run.dPO, dCH: run.dCH, gMine: 0, dynasty: { delta: 0.1 * total, total }, myPPlayoffs: (Id.sim as SimState).base.shown.pPlayoffs }).b;
    expect(tradeScore(b, helpsScaleOf(Id, null)?.b3 ?? null)).toBe(63);
    // No market term in a dynasty league: no lineup equivalent for it.
    const p = analyzeTrade(buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0 }), trade("3", ["wa1"], ["wa3"]));
    expect(p.evaluation?.marketWeekly).toBeNull();
    expect(p.evaluation?.b3).toBe(p.helpsScale?.b3);
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
    sim.calibration = { ...(sim.calibration as HelpsCalibration), dPO: 0.0004, dCH: 0.0002, dPrizes: titleDeltas(0.0002) };
    const s = helpsScaleOf(I, null);
    expect(s).toMatchObject({ b3: config.benefit.helpsFloor, floored: true });
    const x = exact(ctx, trade("2", [(I.me as TeamState).roster[0] as string], [(I.byId.get("2") as TeamState).roster[0] as string]));
    const e = simulateTrade(I, x, "shown", null);
    expect(e.b3).toBe(config.benefit.helpsFloor);
    expect(e.tradeScore).toBe(tradeScore(e.b, config.benefit.helpsFloor));
    expect(e.detail.notes.filter((n) => n === HELPS_FLOOR_NOTE)).toHaveLength(1);
    const floored = runTradeSearch(ctx);
    expect(floored.notes.filter((n) => n === HELPS_FLOOR_NOTE)).toHaveLength(1);
    expect(floored.helpsScale).toMatchObject({ b3: config.benefit.helpsFloor, floored: true, reason: "odds" });
    expect(normal.helpsScale).toMatchObject({ floored: false, reason: null });
    // B's market term is priced on the floor too (planner reply to Checkpoint 7a, §2 question 5): the same points a week on
    // the floored scale, so B differs from the normal search's by the term alone (B_win doesn't depend on the scale).
    for (const t of floored.trades) {
      expect(t.b3).toBe(config.benefit.helpsFloor);
      expect(t.b as number, t.key).toBeCloseTo((t.bWin as number) + termOf(t), 12);
      const same = normal.trades.find((n) => n.key === t.key);
      if (same) {
        expect(t.bWin, t.key).toBe(same.bWin);
        expect(t.marketWeekly, t.key).toBe(same.marketWeekly);
      }
    }
  });
});

describe("dynasty, the scale follows the Win now ↔ Future slider (planner reply to Checkpoint 7a, §2 question 6): B_ref(λ) on every card, no note while the odds move", { timeout: 60_000 }, () => {
  // trade.testing.ts smallLeague(12) as a dynasty league with long-term values: +3 a week moves my title odds about 5 points.
  const { snapshot, inputs } = smallLeague(12, { leagueType: "dynasty" });
  if (inputs.market) inputs.market.format = { ...inputs.market.format, isDynasty: true };
  const ctx = buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0 });
  const I = tradeInternals(ctx);
  const run = (I.sim as SimState).calibration as HelpsCalibration;
  const odds = benefitWin(run.dPO, run.dPrizes).bWin as number;
  const F10 = config.benefit.bFutureScale * config.benefit.helpsFutureShare;

  it("the search and the Analyzer at λ 0.95 and 1 (past review SC-1's cap) and by default: every card on B_ref(λ), its B the trade's own mix, no note", () => {
    expect(I.future).not.toBeNull();
    expect(odds).toBeGreaterThan(4 * config.benefit.helpsFloor);
    for (const lambda of [0.95, 1, null]) {
      const scale = helpsScaleOf(I, lambda);
      const lam = scale?.lambda as number;
      expect(scale, `λ ${lambda}`).toMatchObject({ floored: false, reason: null, f10: F10 });
      expect(scale?.b3, `λ ${lambda}`).toBeCloseTo((1 - lam) * odds + lam * F10, 12);
      const settings = { ...defaultTradeSettings(), lambda, minChance: 0 };
      const result = runTradeSearch(ctx, { settings });
      expect(result.trades.length, `λ ${lambda}`).toBeGreaterThan(0);
      expect(result.helpsScale, `λ ${lambda}`).toEqual(scale);
      expect(result.notes, `λ ${lambda}`).not.toContain(HELPS_FLOOR_NOTE);
      expect(result.notes.some((n) => n.startsWith("Your Win now ↔ Future setting")), `λ ${lambda}`).toBe(false);
      for (const t of result.trades) {
        expect(t.b3, `λ ${lambda}`).toBe(scale?.b3);
        expect(t.tradeScore, `λ ${lambda}`).toBe(tradeScore(t.b, scale?.b3 ?? null));
        expect(t.lambda, `λ ${lambda}`).toBe(lam);
        expect(t.b as number, `λ ${lambda}`).toBeCloseTo((1 - lam) * (t.bWin as number) + lam * (t.bFuture as number), 12);
        expect(t.marketWeekly, `λ ${lambda}`).toBeNull();
      }
      const a = analyzeTrade(ctx, (result.trades[0] as (typeof result.trades)[number]).proposal, { settings });
      expect(a.evaluation?.b3, `λ ${lambda}`).toBe(scale?.b3);
      expect(a.helpsScale, `λ ${lambda}`).toEqual(scale);
      expect(a.evaluation?.detail.notes, `λ ${lambda}`).not.toContain(HELPS_FLOOR_NOTE);
    }
    // λ 1: the scale is F₁₀ alone, so +10% long-term value reads 63 and lineup gains this season read 0.
    expect(helpsScaleOf(I, 1)).toMatchObject({ b3: F10, gainReads: 0, futureReads: 63 });
  });
});

describe("the search: one B₃ for every card, its steps and its Plan B", { timeout: 60_000 }, () => {
  it("cards and Plan B boxes are scored on the search's B₃ (the shown block's), offer-first steps on the ranking block's, under each goal, and their B priced on it", () => {
    const ctx = smallContext();
    const I = tradeInternals(ctx);
    let steps = 0;
    let planBs = 0;
    for (const goal of GOALS) {
      const b3 = helpsScaleOf(I, null, rewardIn(I, goal))?.b3 as number;
      // Checkpoint 7e: the steps' versions are on the screening block, scored on the ranking block's B₃ (as the search ranks).
      const rankB3 = helpsScaleOf(I, null, rewardIn(I, goal), "final")?.b3 as number;
      const result = runTradeSearch(ctx, { settings: { ...defaultTradeSettings(), goal, minChance: 0 } });
      expect(result.trades.length, goal).toBeGreaterThan(0);
      expect(result.helpsScale?.b3, goal).toBe(b3);
      // Every version behind a step and every Plan B candidate: its own numbers on the same B₃, its B's market term too.
      const state = searchStateOf(result) as SearchState;
      for (const t of result.trades) {
        expect(t.b3, goal).toBe(b3);
        expect(t.tradeScore, goal).toBe(tradeScore(t.b, b3));
        expect(t.overall, goal).toBe(overallScore(t.b, t.pComplete, b3));
        expect(t.b as number, `${goal} ${t.key}`).toBeCloseTo((t.bWin as number) + termOf(t), 12);
        for (const step of t.steps ? [t.steps.offerFirst, t.steps.ifNo.full] : []) {
          steps++;
          expect(step.tradeScore, goal).toBe(tradeScore(step.b, rankB3));
          const v = state.versions.get(step.key);
          expect(v?.screen.b3, `${goal} ${step.key}`).toBe(rankB3);
          expect(step.b, `${goal} ${step.key}`).toBe(v?.screen.b);
          expect(step.b as number, `${goal} ${step.key}`).toBeCloseTo((v?.screen.bWin as number) + termOf({ b3: rankB3, gMine: step.gMine }), 12);
        }
        if (t.planB) {
          planBs++;
          expect(t.planB.tradeScore, goal).toBe(tradeScore(t.planB.b, b3));
          expect(t.planB.overall, goal).toBe(overallScore(t.planB.b, t.planB.pComplete, b3));
          // The box's numbers are its shown pass's (Checkpoint 7e: search.ts "The shown pass"), chosen on the ranking block.
          expect(state.finalByKey.has(t.planB.key), `${goal} ${t.planB.key}`).toBe(true);
          const c = state.shownByKey.get(t.planB.key);
          expect(c?.b3, `${goal} ${t.planB.key}`).toBe(b3);
          expect(t.planB.b).toBe(c?.b);
          expect(t.planB.b, `${goal} ${t.planB.key}`).toBeCloseTo((c?.bWin as number) + termOf(c as { b3: number; gMine: number }), 12);
        }
      }
    }
    // Some card shows a step or a Plan B (else this test would check neither).
    expect(steps + planBs).toBeGreaterThan(0);
  });
});
