/**
 * Checkpoint 7c (planner reply to Checkpoint 7b, §7, "Helps them"): the partner's side of a trade's runs (TradeEvaluation.them;
 * evaluate.ts simulateTrade, partnerCalibrationOf, partnerScaleOf). Each partner's calibration run against a direct
 * simulation of its score + 3 points a week, memoized per context; every team's odds from the very runs my B comes from (the
 * baseline on each block, and a trade's run against a direct simulation with both rows replaced); B_P and B_ref,P under each
 * goal, λ_P by the partner's odds whatever the user's Win now ↔ Future setting, B_future,P from the trade's own long-term
 * package; the floor; the Analyzer and the steps' versions; a mutual-need trade that helps both teams and a lopsided one that
 * doesn't. Seeded random leagues and hand leagues (trade.testing.ts); teams are placeholders, players made up.
 */
import { describe, expect, it } from "vitest";
import { defaultLambda, helpsBoth, helpsThemScore, partnerBenefit, partnerScale, rosterValue, tradePackage } from "./benefit";
import { config } from "./config";
import {
  analyzeTrade,
  buildTradeContext,
  evaluateExact,
  partnerCalibrationOf,
  partnerScaleOf,
  simCounts,
  simulateTrade,
  tradeInternals,
  tradeVersion,
  type ExactTrade,
  type SimState,
  type TeamState,
  type TradeContext,
} from "./evaluate";
import type { ModelInputs } from "./inputs";
import { buildLeagueModel } from "./league";
import type { SeasonOdds, TeamOdds } from "./leagueModel";
import type { LeagueSnapshot } from "./model";
import { prizeOddsOf, rewardOf, runPrizeDeltas, shareChange, titleDeltas } from "./reward";
import { pickupSeasonModel, seasonOdds, type SeasonModel } from "./season";
import { GOALS, defaultTradeSettings } from "./settings";
import { TEST_NOW, randomLeague, type TestLeagueSpec, type TestTeam } from "./testLeague";
import { flat, handLeague, withSeason } from "./trade.testing";
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

/** `season` with team `id`'s weekly score mean + `gain` from model week `from` on (σ unchanged). */
function plus(season: SeasonModel, id: string, gain: number, from: number): SeasonModel {
  return { ...season, teams: season.teams.map((t) => (t.id === id ? { id: t.id, score: { mean: t.score.mean.map((m, w) => (w >= from ? m + gain : m)), sd: [...t.score.sd] } } : t)) };
}

const teamOf = (odds: SeasonOdds | null | undefined, id: string): TeamOdds | undefined => odds?.teams.find((t) => t.teamId === id);

function exact(ctx: TradeContext, proposal: TradeProposal, maxPerSide = 4): ExactTrade {
  const x = evaluateExact(tradeInternals(ctx), proposal, maxPerSide);
  if ("illegal" in x) throw new Error(x.illegal);
  return x;
}

/**
 * A hand league (trade.testing.ts handLeague) with no FLEX, where my team has a third RB on the bench and a weak WR2 and Team
 * 2 a spare WR on the bench and a weak RB2: my RB for their WR fills both holes (a mutual-need trade), while my bench WR for
 * their RB1 only costs them.
 */
function mutualLeague(edit: (spec: TestLeagueSpec) => void = () => undefined, season: Parameters<typeof handLeague>[1] = {}): { snapshot: LeagueSnapshot; inputs: ModelInputs } {
  return handLeague((spec) => {
    spec.lineup = [
      { slot: "QB", count: 1, eligible: ["QB"] },
      { slot: "RB", count: 2, eligible: ["RB"] },
      { slot: "WR", count: 2, eligible: ["WR"] },
      { slot: "TE", count: 1, eligible: ["TE"] },
      { slot: "K", count: 1, eligible: ["K"] },
      { slot: "DEF", count: 1, eligible: ["DEF"] },
    ];
    const swap = (team: TestTeam, id: string, by: ReturnType<typeof flat>) => {
      team.roster = team.roster.map((pl) => (pl.id === id ? by : pl));
    };
    const one = spec.teams[0] as TestTeam;
    const two = spec.teams[1] as TestTeam;
    swap(one, "rc1", flat("rc1", "RB", 12));
    swap(one, "wb1", flat("wb1", "WR", 4));
    swap(two, "wc2", flat("wc2", "WR", 9));
    swap(two, "rb2", flat("rb2", "RB", 4));
    edit(spec);
  }, season);
}

describe("each partner's calibration run (evaluate.partnerCalibrationOf): its score + 3 a week on the final block, a direct simulation's numbers", { timeout: 60_000 }, () => {
  const cases: { label: string; seed: number; live?: boolean; scenarios: number }[] = [
    { label: "EV lineups", seed: 31, scenarios: 0 },
    { label: "scenario lineups", seed: 32, scenarios: 8 },
    { label: "a week in progress (left out: every trade holds it as rosters stand)", seed: 34, live: true, scenarios: 8 },
  ];
  for (const c of cases) {
    it(`${c.label} (seed ${c.seed}): ΔPO, ΔCH and the prize components exactly a direct simulation's; memoized; mine is SimState.calibration`, () => {
      const { snapshot, inputs } = randomSeason(c.seed, c);
      const opts = { now: TEST_NOW, scenarios: c.scenarios };
      const ctx = buildTradeContext(snapshot, inputs, opts);
      const I = tradeInternals(ctx);
      const sim = I.sim as SimState;
      const me = I.me as TeamState;
      if (c.live) expect(I.from).toBe(1);
      // The League page's own season (every team after its pickups): the partner's run starts from the very same baseline.
      const model = buildLeagueModel(snapshot, inputs, opts);
      const season = pickupSeasonModel(model);
      expect(sim.odds).toEqual(model.odds);
      for (const t of I.teams) {
        const run = partnerCalibrationOf(I, t.id);
        expect(run, t.id).not.toBeNull();
        expect(run).toMatchObject({ gain: config.benefit.helpsGain, from: I.from });
        const before = teamOf(model.odds, t.id) as TeamOdds;
        const after = teamOf(seasonOdds(snapshot, plus(season, t.id, config.benefit.helpsGain, I.from), { sims: config.simulation.finalSims, seed: config.simulation.seed }), t.id) as TeamOdds;
        expect(Object.is(run?.dPO, after.pPlayoffs - before.pPlayoffs), t.id).toBe(true);
        expect(Object.is(run?.dCH, (after.pTitle as number) - (before.pTitle as number)), t.id).toBe(true);
        expect(run?.dPrizes, t.id).toEqual(runPrizeDeltas(prizeOddsOf(before), prizeOddsOf(after), false));
        // More points every week: the team's odds can only rise on the shared matrix.
        expect(run?.dPO as number, t.id).toBeGreaterThanOrEqual(0);
        // Kept with the context: the same object the next time.
        expect(partnerCalibrationOf(I, t.id), t.id).toBe(run);
      }
      // My own id gives the context's own "Helps you" run, bit for bit.
      expect(partnerCalibrationOf(I, me.id)).toEqual(sim.calibration);
      // A team the odds don't list, or no odds: none.
      expect(partnerCalibrationOf(I, "no such team")).toBeNull();
      expect(partnerCalibrationOf({ ...I, sim: null }, "2")).toBeNull();
    });
  }
});

describe("the partner's numbers come from the trade's own runs (TradeEvaluation.them)", { timeout: 60_000 }, () => {
  const ctx = buildTradeContext(mutualLeague().snapshot, mutualLeague().inputs, { now: TEST_NOW, scenarios: 8 });
  const I = tradeInternals(ctx);
  const me = I.me as TeamState;
  const sim = I.sim as SimState;
  const x = exact(ctx, trade("2", ["rc1"], ["wc2"]));
  const two = I.byId.get("2") as TeamState;

  /** Every team's odds when my row and the partner's are the trade's, on a block, as season.seasonOdds plays them. */
  const afterOdds = (stage: "final" | "screen"): SeasonOdds => {
    const model: SeasonModel = {
      weeks: I.league.lp.weeks.weeks,
      regularWeeks: I.league.lp.weeks.regularWeeks,
      playoffWeeks: I.league.lp.weeks.playoffWeeks,
      inProgressWeek: I.league.tw.inProgressWeek,
      teams: I.teams.map((t) => {
        const score = t === me ? x.mine.score : t === x.partner ? x.theirs.score : t.base.score;
        return { id: t.id, score: { mean: Array.from(score.mean), sd: Array.from(score.sd) } };
      }),
    };
    return seasonOdds(I.snapshot, model, { sims: simCounts()[stage], seed: sim.seed, normals: sim.blocks[stage] }) as SeasonOdds;
  };

  it("final: before is LeagueModel.odds for the partner; ΔPO, ΔCH and the prize components a direct simulation's with both rows replaced", () => {
    const e = simulateTrade(I, x, "final", null);
    const them = e.them;
    expect(them).toBeDefined();
    const before = teamOf(sim.odds, "2") as TeamOdds;
    const after = teamOf(afterOdds("final"), "2") as TeamOdds;
    expect(them?.before).toEqual({ pPlayoffs: before.pPlayoffs, pTitle: before.pTitle, prizes: prizeOddsOf(before) });
    expect(Object.is(them?.dPO, after.pPlayoffs - before.pPlayoffs)).toBe(true);
    expect(Object.is(them?.dCH, (after.pTitle as number) - (before.pTitle as number))).toBe(true);
    expect(them?.dPrizes).toEqual(runPrizeDeltas(prizeOddsOf(before), prizeOddsOf(after), false));
    // Mine from the same run.
    expect(Object.is(e.dPO, (teamOf(afterOdds("final"), me.id) as TeamOdds).pPlayoffs - (teamOf(sim.odds, me.id) as TeamOdds).pPlayoffs)).toBe(true);
  });

  it("screen: the screening block's baseline and run", () => {
    const e = simulateTrade(I, x, "screen", null);
    const before = sim.base.screen.teams[two.index];
    const after = teamOf(afterOdds("screen"), "2") as TeamOdds;
    expect(e.them?.before).toEqual({ pPlayoffs: before?.pPlayoffs, pTitle: before?.pTitle, prizes: before?.prizes });
    expect(Object.is(e.them?.dPO, after.pPlayoffs - (before?.pPlayoffs as number))).toBe(true);
    // Another block of seasons: other numbers than the final run's, scored on the same scale (the partner's final-block run).
    const final = simulateTrade(I, x, "final", null);
    expect(e.them?.dPO).not.toBe(final.them?.dPO);
    expect(e.them?.b3).toBe(final.them?.b3);
    expect(e.them?.helps).toBe(helpsThemScore(e.them?.b ?? null, final.them?.b3 ?? null));
  });

  it("B_P under each goal: partnerBenefit on those changes, the partner's final-block P(playoffs); B_ref,P its own run; Helps them their ratio as printed", () => {
    const seen = new Set<number>();
    for (const goal of GOALS) {
      const reward = rewardOf({ ...defaultTradeSettings(), goal }, I.snapshot);
      const e = simulateTrade(I, x, "final", null, undefined, reward);
      const them = e.them as NonNullable<typeof e.them>;
      const b = partnerBenefit({ leagueType: "redraft", dPO: them.dPO, dCH: them.dCH, dPrizes: them.dPrizes, dynasty: null, pPlayoffs: teamOf(sim.odds, "2")?.pPlayoffs ?? null, reward });
      expect(them.b, goal).toBe(b.b);
      expect(them.bWin, goal).toBe(b.bWin);
      // "No trade-value term": B_P is B_win,P in a redraft league.
      expect(them.b, goal).toBe(them.bWin);
      expect([them.bFuture, them.lambda], goal).toEqual([null, null]);
      const w = config.benefit.goals[goal];
      expect(them.bWin as number, goal).toBeCloseTo(100 * (w.playoffs * them.dPO + w.prizes * (shareChange(them.dPrizes, reward) as number)), 9);
      const scale = partnerScale(partnerCalibrationOf(I, "2"), { leagueType: "redraft", pPlayoffs: teamOf(sim.odds, "2")?.pPlayoffs ?? null, reward, dynastyTotal: null });
      expect(them.b3, goal).toBe(scale?.b3);
      expect(partnerScaleOf(I, two, reward), goal).toEqual(scale);
      expect(them.helps, goal).toBe(helpsThemScore(them.b, them.b3));
      seen.add(them.b3 as number);
    }
    // Each goal weighs the partner's run its own way, as mine.
    expect(seen.size).toBe(GOALS.length);
  });

  it("a mutual-need trade helps both teams; a lopsided one (my bench WR for their RB1) reads Helps them 0", () => {
    const mutual = simulateTrade(I, x, "final", null);
    expect(mutual.tradeScore as number).toBeGreaterThan(0);
    expect(mutual.them?.dPO as number).toBeGreaterThan(0);
    expect(mutual.them?.helps as number).toBeGreaterThanOrEqual(config.benefit.helpsThemMin);
    expect(helpsBoth(mutual)).toBe(true);
    const lopsided = simulateTrade(I, exact(ctx, trade("2", ["wc1"], ["ra2"])), "final", null);
    expect(lopsided.them?.b as number).toBeLessThan(0);
    expect(lopsided.them?.helps).toBe(0);
    expect(helpsBoth(lopsided)).toBe(false);
  });

  it("the Analyzer's evaluation carries the final block's, a step's version the screening block's; a TradeStep none", () => {
    const a = analyzeTrade(ctx, trade("2", ["rc1"], ["wc2"])).evaluation;
    expect(a?.them).toEqual(simulateTrade(I, x, "final", null).them);
    const v = tradeVersion(I, trade("2", ["rc1"], ["wc2"]), { settings: defaultTradeSettings(), maxPerSide: 2 });
    expect(v?.screen.them).toEqual(simulateTrade(I, x, "screen", null).them);
    for (const step of a?.steps ? [a.steps.offerFirst, a.steps.ifNo.full] : []) expect("them" in step).toBe(false);
    // Before the simulation (the exact stage alone): none.
    expect(x.evaluation.them).toBeUndefined();
  });

  it("the floor: a partner whose odds barely move with +3 a week is scored on helpsFloor", () => {
    const saved = sim.partners.get("2");
    try {
      sim.partners.set("2", { gain: 3, from: I.from, dPO: 0.0002, dCH: 0.0001, dPrizes: titleDeltas(0.0001) });
      const e = simulateTrade(I, x, "final", null);
      expect(e.them?.b3).toBe(config.benefit.helpsFloor);
      expect(e.them?.helps).toBe(helpsThemScore(e.them?.b ?? null, config.benefit.helpsFloor));
    } finally {
      if (saved === undefined) sim.partners.delete("2");
      else sim.partners.set("2", saved);
    }
  });

  it("without odds (the schedule didn't load): no partner's numbers either", () => {
    const { snapshot, inputs } = mutualLeague();
    const none = buildTradeContext({ ...snapshot, schedule: [] }, inputs, { now: TEST_NOW, scenarios: 0 });
    const In = tradeInternals(none);
    expect(In.sim).toBeNull();
    const e = simulateTrade(In, exact(none, trade("2", ["rc1"], ["wc2"])), "final", null);
    expect(e.b).toBeNull();
    expect(e.them).toBeUndefined();
    expect(partnerScaleOf(In, In.byId.get("2") as TeamState)).toBeNull();
  });
});

describe("dynasty: λ_P by the partner's odds (never the slider), B_future,P from the trade's own long-term package, B_ref,P floor then mix", { timeout: 60_000 }, () => {
  const { snapshot, inputs } = mutualLeague(() => undefined, { leagueType: "dynasty" });
  if (inputs.market) inputs.market.format = { ...inputs.market.format, isDynasty: true };
  const ctx = buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0 });
  const I = tradeInternals(ctx);
  const sim = I.sim as SimState;
  const x = exact(ctx, trade("2", ["rc1"], ["wc2"]));

  it("every team's long-term total (MyDynTotal's rule), and the partner's package of the trade itself", () => {
    const f = I.future as NonNullable<typeof I.future>;
    expect(f).not.toBeNull();
    for (const t of I.teams) expect(f.totals[t.id], t.id).toBe(rosterValue([...t.team.roster, ...t.team.ir, ...t.team.taxi], f.values));
    expect(f.totals[(I.me as TeamState).id]).toBe(f.myTotal);
    // No IR player moves: every player takes a roster spot, so the plain package is the partner's.
    const pkg = tradePackage({ players: ["rc1"] }, { players: ["wc2"] }, f.values, f.credit, config.market);
    expect(x.partnerDynasty).toEqual({ delta: pkg.recv - pkg.give, total: f.totals["2"] });
  });

  it("the user's Win now ↔ Future setting moves my λ, never λ_P: the partner's numbers are the same at every setting", () => {
    const at = (lambda: number | null) => simulateTrade(I, x, "final", lambda);
    const base = at(null);
    const pP = teamOf(sim.odds, "2")?.pPlayoffs ?? null;
    const lambdaP = defaultLambda("dynasty", pP) as number;
    expect(base.them?.lambda).toBe(lambdaP);
    for (const lambda of [0, 0.9, 1]) {
      const e = at(lambda);
      expect(e.lambda).toBe(lambda);
      expect(e.them, `λ ${lambda}`).toEqual(base.them);
    }
    const them = base.them as NonNullable<typeof base.them>;
    const dyn = x.partnerDynasty as { delta: number; total: number };
    expect(them.bFuture as number).toBeCloseTo((config.benefit.bFutureScale * dyn.delta) / dyn.total, 12);
    expect(them.b as number).toBeCloseTo((1 - lambdaP) * (them.bWin as number) + lambdaP * (them.bFuture as number), 12);
    // B_ref,P: B₃,P floored first, then mixed with F₁₀ by λ_P.
    const run = partnerCalibrationOf(I, "2");
    const scale = partnerScale(run, { leagueType: "dynasty", pPlayoffs: pP, dynastyTotal: dyn.total });
    expect(scale?.lambda).toBe(lambdaP);
    expect(them.b3 as number).toBeCloseTo((1 - lambdaP) * (scale?.b3P as number) + lambdaP * config.benefit.bFutureScale * config.benefit.helpsFutureShare, 12);
    expect(them.helps).toBe(helpsThemScore(them.b, them.b3));
  });
});
