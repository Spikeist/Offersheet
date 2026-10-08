import { describe, expect, it } from "vitest";
import { acceptance } from "./acceptance";
import {
  HELPS_AT_GAIN,
  HELPS_FLOOR_NOTE,
  HELPS_FLOOR_NOTE_PLAYOFFS,
  HELPS_FLOOR_NOTE_PRIZES,
  PRIZES_MISSING_NOTE,
  TITLE_MISSING_NOTE,
  benefit,
  benefitFuture,
  goalWeights,
  benefitNotes,
  benefitWin,
  defaultLambda,
  expectedGain,
  futureValuesLoaded,
  helpsScale,
  helpsScaleNotes,
  injuredReceived,
  lineupEquivalent,
  marketSanity,
  marketWeekly,
  overallScore,
  protectValueWeight,
  resolveLambda,
  rosterValue,
  tradeFlags,
  tradeNumbers,
  tradePackage,
  tradeScore,
  titleOnlyReward,
  type BenefitConfig,
} from "./benefit";
import { config } from "./config";
import type { MarketInputs } from "./inputs";
import { marketGain, packageValues, type MarketConfig } from "./market";
import { TITLE_ONLY, rewardWith, titleDeltas, type PrizeDeltas, type Reward } from "./reward";
import { mulberry32 } from "./rng";
import { GOALS, type Goal, type ProtectValue } from "./settings";

/** B_win from ΔPO and ΔCH alone under a goal, 1st place paying everything (the reading every goal had before Checkpoint 7c). */
const win = (dPO: number | null, dCH: number | null, cfg: BenefitConfig = config.benefit, goal?: Goal) => benefitWin(dPO, titleDeltas(dCH), cfg, titleOnlyReward(goal, cfg));

const market = (over: Partial<MarketInputs> & Pick<MarketInputs, "values">): MarketInputs => ({
  format: { isDynasty: true, numQbs: 1, numTeams: 10, ppr: 0.5, substitutions: [] },
  fetchedAt: "2026-09-29T20:36:00.000Z",
  knownIds: Object.keys(over.values),
  topValue: 10_000,
  ...over,
});

describe("Trade Score and Overall on the self-calibrating scale B₃ (§10; planner reply to Checkpoint 4c, A2)", () => {
  it("is configured with a +3 points a week gain and a floor of 0.5; the fixed B_ref is gone", () => {
    expect(config.benefit.helpsGain).toBe(3);
    expect(config.benefit.helpsFloor).toBe(0.5);
    expect("bRef" in config.benefit).toBe(false);
    expect(HELPS_AT_GAIN).toBe(63);
  });

  it("the dynasty scale's F₁₀ is the B_future of +10% long-term value, 40 × 0.10 = 4; review SC-1's λ cap is gone (planner reply to Checkpoint 7a, §2 question 6)", () => {
    expect(config.benefit.helpsFutureShare).toBe(0.1);
    expect(config.benefit.bFutureScale * config.benefit.helpsFutureShare).toBeCloseTo(4, 12);
    expect(benefitFuture(4000, 40_000)).toBeCloseTo(config.benefit.bFutureScale * config.benefit.helpsFutureShare, 12);
    expect("helpsLambdaMax" in config.benefit).toBe(false);
    // F₁₀ is above the floor, so B_ref(λ) is floored only when λ × F₁₀ and B_win₃ both are under it (the file header).
    expect(config.benefit.bFutureScale * config.benefit.helpsFutureShare).toBeGreaterThan(config.benefit.helpsFloor);
  });

  it("§10's samples: +1, +3 and +6 points a week (B = B₃/3, B₃, 2 B₃) read 28, 63 and 86 at any B₃", () => {
    for (const b3 of [0.5, 2.1, 5.04, 6.3, 11.7]) {
      expect(tradeScore(b3 / 3, b3), `B₃ ${b3}`).toBe(28);
      expect(tradeScore(b3, b3), `B₃ ${b3}`).toBe(63);
      expect(tradeScore(2 * b3, b3), `B₃ ${b3}`).toBe(86);
      // B as a share of B₃: ½ → 39, 1½ → 78, 3 → 95.
      expect([0.5, 1.5, 3].map((x) => tradeScore(x * b3, b3))).toStrictEqual([39, 78, 95]);
    }
  });

  it("at B₃ 6 the old B_ref 6 samples hold (the scale only moved, the curve didn't)", () => {
    const samples: Record<number, number> = { 1: 15, 2: 28, 3: 39, 5: 57, 8: 74, 10: 81 };
    for (const [b, score] of Object.entries(samples)) expect(tradeScore(Number(b), 6)).toBe(score);
  });

  it("is null when B ≤ 0, B is unknown, or there's no scale (hidden by default)", () => {
    expect(tradeScore(0, 5)).toBeNull();
    expect(tradeScore(-2, 5)).toBeNull();
    expect(tradeScore(null, 5)).toBeNull();
    expect(tradeScore(Number.NaN, 5)).toBeNull();
    expect(tradeScore(3, null)).toBeNull();
    expect(tradeScore(3, 0)).toBeNull();
    expect(tradeScore(3, Number.NaN)).toBeNull();
    expect(overallScore(0, 0.5, 5)).toBeNull();
    expect(overallScore(-1, 0.9, 5)).toBeNull();
    expect(overallScore(null, 0.9, 5)).toBeNull();
    expect(overallScore(3, 0.9, null)).toBeNull();
  });

  it("Overall = round(100 × (1 − e^(−B × P_complete / B₃))): §10's Overall samples at B₃ 6, and the same B·P/B₃ reads the same anywhere", () => {
    expect(overallScore(5, 0.5, 6)).toBe(34);
    expect(overallScore(10, 0.3, 6)).toBe(39);
    expect(overallScore(3, 0.8, 6)).toBe(33);
    expect(overallScore(8, 0.6, 6)).toBe(55);
    // A trade worth B₃ (+3 points a week) at 50%: 39, whatever the league's B₃.
    for (const b3 of [0.5, 4, 9]) expect(overallScore(b3, 0.5, b3)).toBe(39);
  });

  it("Overall is never above the Trade Score (random B, P_complete in the model's range and B₃)", () => {
    const rand = mulberry32(20_260_930);
    const [lo, hi] = config.acceptance.pAcceptClamp;
    for (let i = 0; i < 2000; i++) {
      const b = rand() * 30;
      const b3 = config.benefit.helpsFloor + rand() * 12;
      // P_complete: P_accept in the clamp, halved by the veto rule half the time.
      const p = (lo + rand() * (hi - lo)) * (i % 2 ? config.acceptance.veto.factor : 1);
      const ts = tradeScore(b, b3);
      const ov = overallScore(b, p, b3);
      if (ts === null) continue;
      expect(ov).not.toBeNull();
      expect(ov as number).toBeLessThanOrEqual(ts);
    }
  });

  it("EG = B × P_complete (§13's default ranking)", () => {
    expect(expectedGain(5, 0.5)).toBe(2.5);
    expect(expectedGain(null, 0.5)).toBeNull();
    expect(expectedGain(-1, 0.5)).toBe(-0.5);
  });
});

/** B_win for ΔPO 4 points and ΔCH 2 points under the default goal ("Win the title": 0.15 / 0.85): 0.6 + 1.7. */
const BWIN = 2.3;

describe("B (§10)", () => {
  it("B_win = 100 × (w_PO ΔPO + w_S ΔE[S]) in percentage points, the weights by “What does your league reward?” (planner reply to Checkpoint 4b, change 8; Checkpoint 7c, planner reply to Checkpoint 7b, §6)", () => {
    expect(config.benefit.goals).toStrictEqual({ title: { playoffs: 0.15, prizes: 0.85 }, prizes: { playoffs: 0.15, prizes: 0.85 }, playoffs: { playoffs: 0.7, prizes: 0.3 } });
    expect(config.benefit.goalDefault).toBe("title");
    expect(config.benefit.prizesDefault).toStrictEqual({ first: 60, second: 30, third: 10, weeklyHigh: null, pointsLeader: null });
    // The default goal, "Only the champion": 1st place pays everything, so ΔE[S] is ΔCH.
    expect(win(0.04, 0.02).bWin).toBeCloseTo(100 * (0.15 * 0.04 + 0.85 * 0.02), 12);
    expect(win(0.04, 0.02).bWin).toBeCloseTo(BWIN, 12);
    expect(win(0.04, 0.02, config.benefit, "title")).toStrictEqual(win(0.04, 0.02));
    // No reward given: the default goal's, 1st place paying everything.
    expect(benefitWin(0.04, { first: 0.02 })).toStrictEqual(win(0.04, 0.02));
    // "Making the playoffs".
    expect(win(0.04, 0.02, config.benefit, "playoffs").bWin).toBeCloseTo(100 * (0.7 * 0.04 + 0.3 * 0.02), 12);
    expect(win(0, 0)).toStrictEqual({ bWin: 0, titleMissing: false });
    // Not simulated yet: no B, and nothing about title odds to say.
    expect(win(null, null)).toStrictEqual({ bWin: null, titleMissing: false });
    expect(win(null, 0.02)).toStrictEqual({ bWin: null, titleMissing: false });
  });

  it("“Only the champion” and “Making the playoffs”: B_win is the formula before Checkpoint 7c bit for bit (1 × ΔCH, never a 2nd or 3rd place nobody pays)", () => {
    // HEAD 7a1ac38's B_win: 100 × (w_PO × ΔPO + w_title × ΔCH), with the weights it had.
    const before: Record<"title" | "playoffs", { playoffs: number; title: number }> = { title: { playoffs: 0.15, title: 0.85 }, playoffs: { playoffs: 0.7, title: 0.3 } };
    const rand = mulberry32(20261007);
    for (let i = 0; i < 2000; i++) {
      const dPO = (rand() - 0.5) * 0.4;
      const dCH = (rand() - 0.5) * 0.2;
      // The other components unknown, or wild: a prize that pays nothing is never read.
      const junk: PrizeDeltas = { first: dCH, second: i % 2 ? null : Number.NaN, third: (rand() - 0.5) * 9, weeklyHigh: null, pointsLeader: Number.POSITIVE_INFINITY };
      for (const goal of ["title", "playoffs"] as const) {
        const w = before[goal];
        const old = 100 * (w.playoffs * dPO + w.title * dCH);
        expect(benefitWin(dPO, junk, config.benefit, rewardWith({ goal, prizes: config.benefit.prizesDefault }, 14)).bWin).toBe(old);
        expect(benefitWin(dPO, titleDeltas(dCH), config.benefit, titleOnlyReward(goal)).bWin).toBe(old);
      }
    }
  });

  it("“Several prizes”: ΔE[S] is the dot product of the prize shares with each prize's change, the weekly high score per prize period", () => {
    // Parker's prizes, 2000 / 1600 / 900: 4/9, 16/45, 1/5.
    const parker = rewardWith({ goal: "prizes", prizes: { first: 2000, second: 1600, third: 900, weeklyHigh: null, pointsLeader: null } }, 14);
    const d: PrizeDeltas = { first: 0.01, second: 0.02, third: -0.005, weeklyHigh: null, pointsLeader: null };
    const dES = (4 / 9) * 0.01 + (16 / 45) * 0.02 + (1 / 5) * -0.005;
    expect(benefitWin(0.03, d, config.benefit, parker).bWin).toBeCloseTo(100 * (0.15 * 0.03 + 0.85 * dES), 12);
    // A weekly prize of 50 over 10 periods and 500 for the points leader, 1000 / 0 / 0 for the places: the total is 2,000;
    // one high score more is worth 50 / 2,000 of the prizes.
    const weekly = rewardWith({ goal: "prizes", prizes: { first: 1000, second: null, third: null, weeklyHigh: 50, pointsLeader: 500 } }, 10);
    const w2: PrizeDeltas = { first: 0.01, second: null, third: null, weeklyHigh: 0.4, pointsLeader: 0.05 };
    expect(benefitWin(0, w2, config.benefit, weekly).bWin).toBeCloseTo(100 * 0.85 * (0.5 * 0.01 + (0.25 / 10) * 0.4 + 0.25 * 0.05), 12);
    // A split paying only weekly high scores and the points title reads while the bracket is unknown.
    const noBracket = rewardWith({ goal: "prizes", prizes: { first: null, second: null, third: null, weeklyHigh: 10, pointsLeader: 60 } }, 14);
    expect(benefitWin(0.02, { first: null, second: null, third: null, weeklyHigh: 0.3, pointsLeader: 0.01 }, config.benefit, noBracket)).toStrictEqual({ bWin: expect.closeTo(100 * (0.15 * 0.02 + 0.85 * ((10 / 200) * 0.3 + (60 / 200) * 0.01)), 12), titleMissing: false });
    // A paid prize's change unknown: the playoff term scaled up, as with title odds unknown.
    expect(benefitWin(0.04, { ...d, third: null }, config.benefit, parker)).toStrictEqual({ bWin: expect.closeTo(4, 12), titleMissing: true });
    // Nothing entered: 1st place pays everything ("empty"), so it reads as "Only the champion".
    const empty = rewardWith({ goal: "prizes", prizes: { first: null, second: null, third: null, weeklyHigh: null, pointsLeader: null } }, 14);
    expect(empty).toMatchObject({ goal: "prizes", shares: TITLE_ONLY, empty: true });
    expect(benefitWin(0.04, d, config.benefit, empty)).toStrictEqual(win(0.04, 0.01));
  });

  it("goalWeights: each goal's weights, and the default goal's for an unknown one (an older version's “balanced” among them)", () => {
    expect(goalWeights("title")).toStrictEqual({ playoffs: 0.15, prizes: 0.85 });
    expect(goalWeights("prizes")).toStrictEqual({ playoffs: 0.15, prizes: 0.85 });
    expect(goalWeights("playoffs")).toStrictEqual({ playoffs: 0.7, prizes: 0.3 });
    for (const odd of [undefined, null, "glory" as Goal, "toString" as Goal, "balanced" as Goal]) expect(goalWeights(odd)).toStrictEqual({ playoffs: 0.15, prizes: 0.85 });
    // Each goal's weights sum to 1, so the title-missing rule is 100 × ΔPO under every goal.
    for (const g of GOALS) expect(goalWeights(g).playoffs + goalWeights(g).prizes).toBeCloseTo(1, 12);
  });

  it("B under each goal: the same odds, different weights; benefit() reads BenefitInputs.reward, else its goal 1st place paying everything (absent: the default)", () => {
    const at = (goal?: Goal) => benefit({ leagueType: "redraft", dPO: 0.04, dCH: 0.02, gMine: 0, dynasty: null, myPPlayoffs: 0.6, ...(goal ? { goal } : {}) });
    expect(at().b).toBeCloseTo(BWIN, 12);
    expect(at("title").b).toBeCloseTo(BWIN, 12);
    // "Several prizes" read by its goal alone: 1st place pays everything, the weights are the title's.
    expect(at("prizes").b).toBe(at("title").b);
    expect(at("playoffs").b).toBeCloseTo(3.4, 12);
    // A trade that only buys title odds (ΔPO 0, ΔCH +2 points) is worth most to "Only the champion"; one that only buys playoff odds, to "Making the playoffs".
    const titleOnly = (goal: Goal) => benefit({ leagueType: "redraft", dPO: 0, dCH: 0.02, gMine: 0, dynasty: null, myPPlayoffs: 0.6, goal }).b as number;
    const playoffsOnly = (goal: Goal) => benefit({ leagueType: "redraft", dPO: 0.02, dCH: 0, gMine: 0, dynasty: null, myPPlayoffs: 0.6, goal }).b as number;
    expect(titleOnly("title")).toBeGreaterThan(titleOnly("playoffs"));
    expect(playoffsOnly("playoffs")).toBeGreaterThan(playoffsOnly("title"));
    // The reward wins over the goal, and reads the prize components (dPrizes wins over dCH).
    const parker: Reward = rewardWith({ goal: "prizes", prizes: { first: 2000, second: 1600, third: 900, weeklyHigh: null, pointsLeader: null } }, 14);
    const dPrizes: PrizeDeltas = { first: 0.02, second: 0.01, third: 0, weeklyHigh: 0, pointsLeader: 0 };
    const withReward = benefit({ leagueType: "redraft", dPO: 0.04, dCH: 0.02, dPrizes, gMine: 0, dynasty: null, myPPlayoffs: 0.6, goal: "playoffs", reward: parker });
    expect(withReward.bWin).toBe(benefitWin(0.04, dPrizes, config.benefit, parker).bWin);
    expect(withReward.b).toBeCloseTo(100 * (0.15 * 0.04 + 0.85 * ((4 / 9) * 0.02 + (16 / 45) * 0.01)), 12);
    // Dynasty and keeper leagues weigh B_win by the goal too.
    expect(benefit({ leagueType: "dynasty", dPO: 0.04, dCH: 0.02, gMine: 0, dynasty: { delta: 1000, total: 40_000 }, myPPlayoffs: 0.6, goal: "playoffs" }).bWin).toBeCloseTo(3.4, 12);
  });

  it("title odds unknown: the playoff term scaled up to the whole weight, flagged, under every goal", () => {
    const r = win(0.04, null);
    expect(r.bWin).toBeCloseTo(4, 12);
    expect(r.titleMissing).toBe(true);
    // B_win = 100 × (w_PO + w_S) × ΔPO: 4 under every goal (each goal's weights sum to 1).
    for (const g of GOALS) expect(win(0.04, null, config.benefit, g)).toStrictEqual({ bWin: expect.closeTo(4, 12), titleMissing: true });
    // A widened config whose weights don't sum to 1 shows the formula: 100 × (0.2 + 0.3) × ΔPO.
    const odd: BenefitConfig = { ...config.benefit, goals: { ...config.benefit.goals, title: { playoffs: 0.2, prizes: 0.3 } } };
    expect(win(0.04, null, odd, "title").bWin).toBeCloseTo(2, 12);
    // A goal with no playoff weight can't stand in for missing title odds.
    const titleOnly: BenefitConfig = { ...config.benefit, goals: { ...config.benefit.goals, title: { playoffs: 0, prizes: 1 } } };
    expect(win(0.04, null, titleOnly, "title")).toStrictEqual({ bWin: null, titleMissing: true });
  });

  it("the market term's lineup price: κ × clamp(g_mkt(me), ±0.5) points a week, κ by default the medium level's (2) (planner reply to Checkpoint 7a, §2 question 5)", () => {
    expect(marketWeekly(0.2)).toBeCloseTo(0.4, 12);
    expect(marketWeekly(0.9)).toBe(1);
    expect(marketWeekly(-0.9)).toBe(-1);
    expect(marketWeekly(Number.POSITIVE_INFINITY)).toBe(1);
    expect(marketWeekly(Number.NaN)).toBe(0);
    // A κ passed in replaces the default.
    expect(marketWeekly(0.2, 1)).toBeCloseTo(0.2, 12);
    expect(marketWeekly(-0.9, 4)).toBe(-2);
  });

  it("the market term in B units: (B₃ / 3) × κ × clamp(g_mkt(me)), so on the scale B₃ it reads κ × clamp(g_mkt(me)) points a week at any B₃", () => {
    for (const b3 of [0.5, 2.1, 4.959, 6, 7.626, 11.7]) {
      expect(marketSanity(0.2, b3), `B₃ ${b3}`).toBeCloseTo((b3 / 3) * 2 * 0.2, 12);
      expect(lineupEquivalent(marketSanity(0.2, b3), b3), `B₃ ${b3}`).toBeCloseTo(0.4, 12);
      expect(lineupEquivalent(marketSanity(-0.9, b3, 4), b3), `B₃ ${b3}`).toBeCloseTo(-2, 12);
    }
    // At B₃ 6 the medium level reads as Checkpoint 3's addendum's κ 4 did in B units.
    expect(marketSanity(-0.1, 6)).toBeCloseTo(-0.4, 12);
    // No scale (no calibration run: no odds or no team), or one that isn't above 0: no term.
    for (const b3 of [null, undefined, 0, -1, Number.NaN]) expect(marketSanity(0.3, b3), String(b3)).toBe(0);
  });

  it("redraft: B = B_win + the market term on the evaluation's B₃; no λ, no future term", () => {
    const r = benefit({ leagueType: "redraft", dPO: 0.04, dCH: 0.02, gMine: -0.1, dynasty: null, myPPlayoffs: 0.6, lambda: 0.9, b3: 6 });
    expect(r.b).toBeCloseTo(BWIN - 0.4, 12);
    expect(r).toMatchObject({ bFuture: null, lambda: null, dDyn: null, dynMissing: false, titleMissing: false });
    expect(r.market).toBeCloseTo(-0.4, 12);
    expect(r.marketWeekly).toBeCloseTo(-0.2, 12);
    // The same g on another scale: the same −0.2 points a week, another B.
    const small = benefit({ leagueType: "redraft", dPO: 0.04, dCH: 0.02, gMine: -0.1, dynasty: null, myPPlayoffs: 0.6, b3: 1.5 });
    expect(small.market).toBeCloseTo(-0.1, 12);
    expect(small.marketWeekly).toBeCloseTo(-0.2, 12);
    // Dynasty numbers passed to a redraft league are ignored.
    expect(benefit({ leagueType: "redraft", dPO: 0.04, dCH: 0.02, gMine: -0.1, dynasty: { delta: 1000, total: 1000 }, myPPlayoffs: 0.6, b3: 6 }).b).toBeCloseTo(BWIN - 0.4, 12);
    // Without a scale there's nothing to price the term on: B = B_win, and no lineup equivalent.
    for (const b3 of [undefined, null, 0]) expect(benefit({ leagueType: "redraft", dPO: 0.04, dCH: 0.02, gMine: -0.1, dynasty: null, myPPlayoffs: 0.6, b3 }), String(b3)).toMatchObject({ b: expect.closeTo(BWIN, 12), market: 0, marketWeekly: null });
    // κ 0 (evaluate.ts: FantasyCalc's curve fallback, or no values): no term, and no lineup equivalent either.
    expect(benefit({ leagueType: "redraft", dPO: 0.04, dCH: 0.02, gMine: -0.1, dynasty: null, myPPlayoffs: 0.6, kappa: 0, b3: 6 })).toMatchObject({ b: expect.closeTo(BWIN, 12), market: 0, marketWeekly: null });
    // Not simulated: no B, but the term is priced all the same.
    expect(benefit({ leagueType: "redraft", dPO: null, dCH: null, gMine: -0.1, dynasty: null, myPPlayoffs: 0.6, b3: 6 })).toMatchObject({ b: null, marketWeekly: expect.closeTo(-0.2, 12) });
  });

  it("κ by the 'Protect my trade value' level in points a week per 100% of trade value: low 1, medium 2 (the default), high 4 (planner reply to Checkpoint 7a, §2 question 5)", () => {
    expect(config.benefit.protectValue).toStrictEqual({ low: 1, medium: 2, high: 4 });
    expect(config.benefit.protectValueDefault).toBe("medium");
    expect(protectValueWeight("low")).toBe(1);
    expect(protectValueWeight("medium")).toBe(2);
    expect(protectValueWeight("high")).toBe(4);
    // Absent or unknown: the default level's.
    expect(protectValueWeight(undefined)).toBe(2);
    expect(protectValueWeight(null)).toBe(2);
    expect(protectValueWeight("max" as ProtectValue)).toBe(2);
    // The planner's check: at medium, giving 25% more value than I get (g_mkt(me) = −0.20) costs exactly 0.4 points a week, on
    // any scale (Parker's B₃ under each goal, a floored one, others): its B is −(B₃ / 3) × 0.4. Low and high: 0.2 and 0.8.
    const at = (level: ProtectValue, b3: number) => benefit({ leagueType: "redraft", dPO: 0.04, dCH: 0.02, gMine: -0.2, dynasty: null, myPPlayoffs: 0.6, kappa: protectValueWeight(level), b3 });
    for (const b3 of [0.5, 4.959, 5.929, 7.626, 12]) {
      expect(at("medium", b3).marketWeekly, `B₃ ${b3}`).toBeCloseTo(-0.4, 12);
      expect(lineupEquivalent(at("medium", b3).market, b3), `B₃ ${b3}`).toBeCloseTo(-0.4, 12);
      expect(at("medium", b3).b, `B₃ ${b3}`).toBeCloseTo(BWIN - (b3 / 3) * 0.4, 12);
      expect(at("low", b3).marketWeekly, `B₃ ${b3}`).toBeCloseTo(-0.2, 12);
      expect(at("high", b3).marketWeekly, `B₃ ${b3}`).toBeCloseTo(-0.8, 12);
      expect(at("high", b3).market, `B₃ ${b3}`).toBeCloseTo((b3 / 3) * -0.8, 12);
    }
    // The clamp still caps the term at ±0.5 × κ points a week.
    const capped = benefit({ leagueType: "redraft", dPO: 0, dCH: 0, gMine: -0.9, dynasty: null, myPPlayoffs: 0.6, kappa: protectValueWeight("high"), b3: 6 });
    expect(capped.marketWeekly).toBe(-2);
    expect(capped.b).toBe(-4);
  });

  it("the market term reads g_mkt(me), every player at max(v, W) after the neutral throw-ins (planner replies to Checkpoint 4, change 4, and to Checkpoint 4b, change 2)", () => {
    // B₃ 6: the medium level's term is 4 × clamp(g) in B units there.
    const base = { leagueType: "redraft" as const, dPO: 0.04, dCH: 0.02, dynasty: null, myPPlayoffs: 0.6, b3: 6 };
    const W = 628;
    const values = { junk: 300, scrap: 120, star: 5000, them: 5500 };
    const gMine = (get: string[], give: string[]) => tradePackage({ players: get }, { players: give }, values, W).g;
    // A player worth less than W given for nothing: he and his spot are left out: no market term at any κ.
    expect(gMine([], ["junk"])).toBe(0);
    for (const kappa of [1, 2, 4]) expect(benefit({ ...base, gMine: gMine([], ["junk"]), kappa })).toMatchObject({ market: 0, marketWeekly: 0, b: expect.closeTo(BWIN, 12) });
    // Two players worth less than W swapped: even, both ways.
    expect(gMine(["scrap"], ["junk"])).toBe(0);
    expect(gMine(["junk"], ["scrap"])).toBe(0);
    // A cheap throw-in on my side (I already give as many players as I get) is left out: the term doesn't move at all
    // (before Phase 4c it moved toward 0: (5,500 + W) / (5,000 + W) − 1).
    const lean = gMine(["them"], ["star"]);
    const full = gMine(["them"], ["star", "junk"]);
    expect(lean).toBeCloseTo(0.1, 12);
    expect(full).toBe(lean);
    expect(benefit({ ...base, gMine: full }).market).toBeCloseTo(4 * lean, 12);
    expect(benefit({ ...base, gMine: full }).marketWeekly).toBeCloseTo(2 * lean, 12);
    // A negative g counts as such, at the level's κ, clamped.
    expect(benefit({ ...base, gMine: -0.2, kappa: 4 }).market).toBeCloseTo(-1.6, 12);
    expect(benefit({ ...base, gMine: -0.9, kappa: 1 }).market).toBe(-1);
    // Dynasty and keeper leagues have no market term.
    for (const leagueType of ["dynasty", "keeper"] as const) expect(benefit({ ...base, leagueType, gMine: 0.3, dynasty: { delta: 1000, total: 40_000 } })).toMatchObject({ market: 0, marketWeekly: null });
  });

  it("dynasty and keeper leagues have no market term, whatever κ and B₃ (B_future carries the value change; ⚠️ the planner's “stays inside the win-now part”: there is no term to place)", () => {
    for (const leagueType of ["dynasty", "keeper"] as const) {
      const with2 = benefit({ leagueType, dPO: 0.04, dCH: 0.02, gMine: -0.3, dynasty: { delta: 1000, total: 40_000 }, myPPlayoffs: 0.6, b3: 4 });
      for (const kappa of [1, 2, 4, 8]) {
        for (const b3 of [undefined, 0.5, 4, 9]) {
          const r = benefit({ leagueType, dPO: 0.04, dCH: 0.02, gMine: -0.3, dynasty: { delta: 1000, total: 40_000 }, myPPlayoffs: 0.6, kappa, b3 });
          expect(r.b, `${leagueType} κ ${kappa} B₃ ${b3}`).toBe(with2.b);
          expect(r).toMatchObject({ market: 0, marketWeekly: null });
        }
      }
      // Without long-term values too.
      expect(benefit({ leagueType, dPO: 0.04, dCH: 0.02, gMine: -0.3, dynasty: null, myPPlayoffs: 0.6, kappa: 4, b3: 6 })).toMatchObject({ market: 0, marketWeekly: null, dynMissing: true });
    }
  });

  it("not simulated yet: B is null (and so are the Trade Score and Overall)", () => {
    const r = benefit({ leagueType: "redraft", dPO: null, dCH: null, gMine: 0.2, dynasty: null, myPPlayoffs: null });
    expect(r.b).toBeNull();
    expect(r.titleMissing).toBe(false);
    expect(tradeScore(r.b, 6)).toBeNull();
    expect(overallScore(r.b, 0.5, 6)).toBeNull();
  });

  it("dynasty: B = (1 − λ) B_win + λ × 40 × ΔDyn / MyDynTotal, no market term", () => {
    const r = benefit({ leagueType: "dynasty", dPO: 0.04, dCH: 0.02, gMine: 0.3, dynasty: { delta: 1000, total: 40_000 }, myPPlayoffs: 0.6 });
    expect(r.lambda).toBe(0.35);
    expect(r.bFuture).toBeCloseTo(1, 12);
    expect(r.b).toBeCloseTo(0.65 * BWIN + 0.35 * 1, 12);
    expect(r).toMatchObject({ market: 0, dDyn: 1000, dynMissing: false });
    // "Gaining 10% of my roster's value ≈ +4".
    expect(benefitFuture(4000, 40_000)).toBeCloseTo(4, 12);
  });

  it("an eliminated dynasty team still values the future (ΔPO = ΔCH = 0, λ 0.75)", () => {
    const r = benefit({ leagueType: "dynasty", dPO: 0, dCH: 0, gMine: 0, dynasty: { delta: 2000, total: 40_000 }, myPPlayoffs: 0 });
    expect(r.lambda).toBe(0.75);
    expect(r.b).toBeCloseTo(0.75 * 2, 12);
  });

  it("λ defaults by my P(playoffs): 0.5+ → 0.35, 0.2–0.5 → 0.5, below 0.2 → 0.75; keeper 0.2; redraft none", () => {
    expect(defaultLambda("dynasty", 0.5)).toBe(0.35);
    expect(defaultLambda("dynasty", 0.9)).toBe(0.35);
    expect(defaultLambda("dynasty", 0.4999)).toBe(0.5);
    expect(defaultLambda("dynasty", 0.2)).toBe(0.5);
    expect(defaultLambda("dynasty", 0.1999)).toBe(0.75);
    expect(defaultLambda("dynasty", 0)).toBe(0.75);
    expect(defaultLambda("dynasty", null)).toBe(0.5);
    expect(defaultLambda("keeper", 0.9)).toBe(0.2);
    expect(defaultLambda("keeper", 0.01)).toBe(0.2);
    expect(defaultLambda("redraft", 0.5)).toBeNull();
  });

  it("the user's Win now ↔ Future setting overrides the default in dynasty and keeper leagues", () => {
    expect(resolveLambda("dynasty", 0.9, 0.6)).toBe(0.9);
    expect(resolveLambda("keeper", 0, 0.6)).toBe(0);
    expect(resolveLambda("keeper", 1, 0.6)).toBe(1);
    expect(resolveLambda("dynasty", null, 0.6)).toBe(0.35);
    expect(resolveLambda("dynasty", 1.5, 0.1)).toBe(0.75);
    expect(resolveLambda("dynasty", -0.1, 0.1)).toBe(0.75);
    expect(resolveLambda("redraft", 0.9, 0.6)).toBeNull();
    const r = benefit({ leagueType: "keeper", dPO: 0.04, dCH: 0.02, gMine: 0, dynasty: { delta: 1000, total: 40_000 }, myPPlayoffs: 0.6, lambda: 1 });
    expect(r.b).toBeCloseTo(1, 12);
  });

  it("a keeper league without dynasty values: B = B_win, B_future and ΔDyn missing, the card says so", () => {
    const r = benefit({ leagueType: "keeper", dPO: 0.04, dCH: 0.02, gMine: 0.4, dynasty: null, myPPlayoffs: 0.3 });
    expect(r.b).toBeCloseTo(BWIN, 12);
    expect(r).toMatchObject({ bFuture: null, dDyn: null, dynMissing: true, lambda: 0.2, market: 0 });
    // A roster with no long-term value can't scale ΔDyn either.
    expect(benefit({ leagueType: "dynasty", dPO: 0.04, dCH: 0.02, gMine: 0, dynasty: { delta: 500, total: 0 }, myPPlayoffs: 0.3 })).toMatchObject({ dynMissing: true, bFuture: null });
  });

  it("long-term values are loaded only for a dynasty-format market with values", () => {
    expect(futureValuesLoaded("dynasty", market({ values: { a: 100 } }))).toBe(true);
    expect(futureValuesLoaded("keeper", market({ values: { a: 100 }, redraftValues: { a: 90 } }))).toBe(true);
    // A keeper league whose dynasty list failed: the redraft list stands in (format.isDynasty false).
    expect(futureValuesLoaded("keeper", market({ values: { a: 100 }, format: { isDynasty: false, numQbs: 1, numTeams: 10, ppr: 0.5, substitutions: [] } }))).toBe(false);
    expect(futureValuesLoaded("dynasty", market({ values: {} }))).toBe(false);
    expect(futureValuesLoaded("dynasty", null)).toBe(false);
    expect(futureValuesLoaded("redraft", market({ values: { a: 100 } }))).toBe(false);
    // Phase 4c: a saved list FantasyCalc served days ago is its own; the curve fallback (an older list) isn't long-term worth.
    expect(futureValuesLoaded("dynasty", market({ values: { a: 100 }, fallback: { kind: "saved", listDate: "2026-09-28T06:00:00.000Z" } }))).toBe(true);
    expect(futureValuesLoaded("dynasty", market({ values: { a: 100 }, fallback: { kind: "curve", listDate: "2026-09-10T06:00:00.000Z" } }))).toBe(false);
    expect(futureValuesLoaded("keeper", market({ values: { a: 100 }, redraftValues: { a: 90 }, fallback: { kind: "curve", listDate: "2026-09-10T06:00:00.000Z" } }))).toBe(false);
  });

  it("accepts a widened config", () => {
    const cfg: BenefitConfig = { ...config.benefit, goals: { ...config.benefit.goals, title: { playoffs: 1, prizes: 0 } } };
    expect(benefit({ leagueType: "redraft", dPO: 0.03, dCH: 0.5, gMine: 0, dynasty: null, myPPlayoffs: 0.5 }, cfg).b).toBeCloseTo(3, 12);
    const playoffsDefault: BenefitConfig = { ...config.benefit, goalDefault: "playoffs" };
    expect(benefit({ leagueType: "redraft", dPO: 0.04, dCH: 0.02, gMine: 0, dynasty: null, myPPlayoffs: 0.5 }, playoffsDefault).b).toBeCloseTo(3.4, 12);
  });
});

describe("guards (§10)", () => {
  it("market check below −0.15, hidden below −0.35 (both strict)", () => {
    const flags = (g: number) => tradeFlags({ gMine: g, b: 3, injured: [] });
    expect(flags(-0.15)).toMatchObject({ marketCheck: false, hiddenByMarket: false });
    expect(flags(-0.1501)).toMatchObject({ marketCheck: true, hiddenByMarket: false });
    expect(flags(-0.35)).toMatchObject({ marketCheck: true, hiddenByMarket: false });
    expect(flags(-0.3501)).toMatchObject({ marketCheck: true, hiddenByMarket: true });
    expect(flags(0.4)).toMatchObject({ marketCheck: false, hiddenByMarket: false });
    expect(flags(Number.NaN)).toMatchObject({ marketCheck: false, hiddenByMarket: false });
  });

  it("hidden by benefit when B ≤ 0; an unknown B hides nothing", () => {
    expect(tradeFlags({ gMine: 0, b: 0, injured: [] }).hiddenByBenefit).toBe(true);
    expect(tradeFlags({ gMine: 0, b: -1.2, injured: [] }).hiddenByBenefit).toBe(true);
    expect(tradeFlags({ gMine: 0, b: 0.01, injured: [] }).hiddenByBenefit).toBe(false);
    expect(tradeFlags({ gMine: 0, b: null, injured: [] }).hiddenByBenefit).toBe(false);
  });

  it("flags the players I'd get who are OUT, on IR or on PUP", () => {
    const players = { a: { injury: "OUT" as const }, b: { injury: "IR" as const }, c: { injury: "PUP" as const }, d: { injury: "QUESTIONABLE" as const }, e: { injury: "SUSPENDED" as const }, f: { injury: "ACTIVE" as const } };
    expect(injuredReceived(["f", "a", "d", "b", "c", "e", "zz", "a"], players)).toStrictEqual(["a", "b", "c"]);
    expect(tradeFlags({ gMine: 0, b: 1, injured: ["a"] }).injured).toStrictEqual(["a"]);
  });
});

describe("package values with picks (§9; ΔDyn, MyDynTotal, the card's values)", () => {
  it("equals market.packageValues and market.marketGain for players only (random packages)", () => {
    const rand = mulberry32(7);
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const values: Record<string, number> = {};
    for (const id of ids) values[id] = Math.round(rand() * 9000) + 100;
    for (let k = 0; k < 500; k++) {
      const shuffled = [...ids].sort(() => rand() - 0.5);
      const nr = 1 + Math.floor(rand() * 3);
      const ng = 1 + Math.floor(rand() * 3);
      const recv = shuffled.slice(0, nr);
      const give = shuffled.slice(nr, nr + ng);
      const W = Math.round(rand() * 500);
      const pv = packageValues(recv, give, values, W);
      const tp = tradePackage({ players: recv }, { players: give }, values, W);
      expect(tp.recv).toBe(pv.recv);
      expect(tp.give).toBe(pv.give);
      expect(tp.g).toBe(marketGain(recv, give, values, W));
    }
  });

  it("matches §9's examples (W = 400)", () => {
    const values = { star: 10_000, a: 5000, b: 5000 };
    expect(tradePackage({ players: ["star"] }, { players: ["a", "b"] }, values, 400).g).toBeCloseTo(0.04, 3);
    expect(tradePackage({ players: ["a", "b"] }, { players: ["star"] }, values, 400).g).toBeCloseTo(-0.038, 3);
  });

  it("a pick takes no roster spot: the waiver credit counts players only", () => {
    const values = { p: 6000, q: 3000 };
    // I give a 6,000 player for a 5,500 pick: I also get an open spot (W 400).
    const forPick = tradePackage({ players: [], pickValues: [5500] }, { players: ["p"] }, values, 400);
    expect(forPick).toStrictEqual({ recv: 5900, give: 6000, g: (5900 - 6000) / 6000 });
    // A player and a pick for a player: one for one in roster spots, no credit.
    expect(tradePackage({ players: ["q"], pickValues: [2500] }, { players: ["p"] }, values, 400)).toStrictEqual({ recv: 5500, give: 6000, g: -500 / 6000 });
    // Non-finite pick values count 0; a side that gives nothing of value gains +∞.
    expect(tradePackage({ players: ["q"], pickValues: [Number.NaN] }, { players: [] }, values, 0).g).toBe(Number.POSITIVE_INFINITY);
    expect(tradePackage({ players: [] }, { players: [] }, values, 0).g).toBe(0);
  });

  it("roster value: every player once plus the picks; studExponent applies to picks too", () => {
    const values = { a: 100, b: 200 };
    expect(rosterValue(["a", "b", "a", "zz"], values, [50])).toBe(350);
    const convex: MarketConfig = { ...config.market, studExponent: 2 };
    expect(rosterValue(["a", "b"], values, [10], convex)).toBe(100 ** 2 + 200 ** 2 + 10 ** 2);
    expect(tradePackage({ players: ["a"], pickValues: [10] }, { players: ["b"] }, values, 0, convex)).toMatchObject({ recv: 100 ** 2 + 10 ** 2, give: 200 ** 2 });
  });

  describe("each player at max(v, W) on both sides, after the neutral throw-ins (planner replies to Checkpoint 4, change 4, and to Checkpoint 4b, change 2)", () => {
    /**
     * The package by hand, by market.ts's header: without IR moves the neutral throw-in rule (the planner's step, then the
     * matched pairs) leaves the package that counts only the players worth more than W, each at his own value, plus the
     * picks' values (a pick isn't a player for the rule and takes no roster spot), plus W per roster spot their counts leave
     * open on the side receiving fewer such players. (W 0 floors nothing, credits nothing and leaves nobody out: every
     * player at his own value.)
     */
    const byHand = (recv: string[], give: string[], values: Record<string, number>, W: number, picks: { recv?: number[]; give?: number[] } = {}) => {
      const dear = (ids: string[]) => ids.filter((id) => (values[id] ?? 0) > W);
      const r0 = dear(recv);
      const g0 = dear(give);
      const sum = (ids: string[]) => ids.reduce((s, id) => s + (values[id] ?? 0), 0);
      const r = sum(r0) + (picks.recv ?? []).reduce((s, x) => s + x, 0) + Math.max(0, g0.length - r0.length) * W;
      const g = sum(g0) + (picks.give ?? []).reduce((s, x) => s + x, 0) + Math.max(0, r0.length - g0.length) * W;
      return { recv: r, give: g, g: g > 0 ? (r - g) / g : r > 0 ? Number.POSITIVE_INFINITY : 0 };
    };

    it("random packages, W anywhere among the values: tradePackage is the hand-floored sum on both sides", () => {
      const rand = mulberry32(11);
      const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
      for (let k = 0; k < 500; k++) {
        const values: Record<string, number> = {};
        for (const id of ids) values[id] = Math.round(rand() * 9000) + 1;
        const shuffled = [...ids].sort(() => rand() - 0.5);
        const nr = Math.floor(rand() * 4);
        const ng = 1 + Math.floor(rand() * 3);
        const recv = shuffled.slice(0, nr);
        const give = shuffled.slice(nr, nr + ng);
        // Sometimes exactly a player's value (the floor binds at equality without changing it).
        const W = k % 5 === 0 ? (values[give[0] as string] as number) : Math.round(rand() * 3000);
        const pick = k % 3 === 0 ? Math.round(rand() * 800) : null;
        const tp = tradePackage({ players: recv, ...(pick !== null ? { pickValues: [pick] } : {}) }, { players: give }, values, W);
        const hand = byHand(recv, give, values, W, pick !== null ? { recv: [pick] } : {});
        expect(tp.recv).toBeCloseTo(hand.recv, 9);
        expect(tp.give).toBeCloseTo(hand.give, 9);
        expect(tp.g).toBeCloseTo(hand.g, 12);
      }
    });

    it("the planner's three results: an even swap of two cheap players, a cheap player for nothing, a cheap throw-in (now left out)", () => {
      const values = { star: 5000, junk: 300, scrap: 120, them: 5500 };
      const W = 628;
      // An even swap of two players worth less than W: g = 0 for both sides (a matched pair, Phase 4c: both left out with
      // their spots, nothing against nothing; Checkpoint 4b counted W against W).
      expect(tradePackage({ players: ["scrap"] }, { players: ["junk"] }, values, W)).toStrictEqual({ recv: 0, give: 0, g: 0 });
      expect(tradePackage({ players: ["junk"] }, { players: ["scrap"] }, values, W)).toStrictEqual({ recv: 0, give: 0, g: 0 });
      // Dumping one for nothing: he and the spot he opens are left out (Checkpoint 4b counted W against W).
      expect(tradePackage({ players: [] }, { players: ["junk"] }, values, W)).toStrictEqual({ recv: 0, give: 0, g: 0 });
      expect(tradePackage({ players: ["junk"] }, { players: [] }, values, W).g).toBe(0); // the side taking him
      // A cheap throw-in on the side giving more players is left out with his spot: the package is the lean one's exactly
      // (Checkpoint 4b added W to both sums, which pulled g from +10% to +8.8%).
      const lean = tradePackage({ players: ["them"] }, { players: ["star"] }, values, W);
      const full = tradePackage({ players: ["them"] }, { players: ["star", "junk"] }, values, W);
      expect(full).toStrictEqual(lean);
      expect(full).toStrictEqual({ recv: 5500, give: 5000, g: 0.1 });
      // A value missing counts 0 before the floor: a missing player given for nothing is left out the same way; { value }
      // entries read as numbers.
      expect(tradePackage({ players: [] }, { players: ["nobody"] }, values, W)).toStrictEqual({ recv: 0, give: 0, g: 0 });
      const entries = { them: { value: 5500 }, star: { value: 5000 }, junk: { value: 300 } };
      expect(tradePackage({ players: ["them"] }, { players: ["star", "junk"] }, entries, W)).toStrictEqual(full);
    });

    it("the header's scope: a player of mine worth at most W moves no g, whatever the counts (no IR moves; review of track EF, finding 1: Phase 4c's first rule alone moved both when the partner gave d more players, at least d of them worth at most W)", () => {
      const rand = mulberry32(20_261_004);
      const ids = Array.from({ length: 8 }, (_, i) => `p${i}`);
      const tally = { mineAtLeast: 0, partnerExtrasDear: 0, formerGap: 0 };
      for (let k = 0; k < 2000; k++) {
        const values: Record<string, number> = {};
        for (const id of ids) values[id] = rand() < 0.4 ? Math.round(rand() * 900) : Math.round(rand() * 9000) + 1;
        const W = 1 + Math.round(rand() * 900);
        values.x = Math.round(rand() * W); // mine, worth at most W
        const shuffled = [...ids].sort(() => rand() - 0.5);
        const m = 1 + Math.floor(rand() * 2); // my players without him: 1–2
        const p = 1 + Math.floor(rand() * 3); // the partner's: 1–3
        const give = shuffled.slice(0, m);
        const get = shuffled.slice(m, m + p);
        const lean = tradePackage({ players: get }, { players: give }, values, W); // my side
        const full = tradePackage({ players: get }, { players: [...give, "x"] }, values, W);
        expect(full, `${k}`).toEqual(lean);
        // The partner's side is the mirror (no IR player moves): no move there either.
        expect(tradePackage({ players: [...give, "x"] }, { players: get }, values, W).g, `${k}`).toBe(tradePackage({ players: give }, { players: get }, values, W).g);
        const d = get.length - give.length;
        const cheapTheirs = get.filter((id) => (values[id] as number) <= W).length;
        if (d <= 0) tally.mineAtLeast++;
        else if (cheapTheirs >= d) tally.formerGap++; // the gap's shape: one of their cheap extras now pairs with him
        else tally.partnerExtrasDear++;
      }
      // Every branch was exercised.
      expect(Math.min(...Object.values(tally))).toBeGreaterThan(100);
    });

    it("picks keep their values on either side (a pick opens no roster spot, so no floor), and never count as players for the neutral rule", () => {
      const values = { junk: 300 };
      const W = 628;
      // A cheap pick given for nothing: its value, not W; the spot credit counts players only.
      expect(tradePackage({ players: [] }, { players: [], pickValues: [100] }, values, W)).toStrictEqual({ recv: 0, give: 100, g: -1 });
      // A cheap player with a pick for a pick: one player against none, so he is the neutral throw-in (left out with the
      // spot he opens); the picks keep their values (Checkpoint 4b: W + 50 against W + 100).
      expect(tradePackage({ players: [], pickValues: [50] }, { players: ["junk"], pickValues: [100] }, values, W)).toStrictEqual({ recv: 50, give: 100, g: -0.5 });
      // A pick doesn't even the counts: a cheap player for a pick is still one player against none.
      expect(tradePackage({ players: ["junk"] }, { players: [], pickValues: [400] }, values, W)).toStrictEqual({ recv: 0, give: 400, g: -1 });
    });

    it("studExponent applies after the floor (the floored value is a value like any other)", () => {
      const convex: MarketConfig = { ...config.market, studExponent: 2 };
      const values = { junk: 300, them: 900 };
      expect(tradePackage({ players: ["them"] }, { players: ["junk"] }, values, 600, convex)).toMatchObject({ recv: 900 ** 2, give: 600 ** 2 });
    });

    it("a roster's total (MyDynTotal) is raw: no floor", () => {
      expect(rosterValue(["junk", "them"], { junk: 300, them: 900 })).toBe(1200);
    });
  });

  it("ΔDyn and MyDynTotal feed B_future; ΔDyn floors each player at the long-term W, MyDynTotal doesn't", () => {
    const future = { mine: 3000, theirs: 4500, bench: 500, other: 2000 };
    const pkg = tradePackage({ players: ["theirs"] }, { players: ["mine", "bench"] }, future, 250);
    expect(pkg.recv - pkg.give).toBe(4500 + 250 - 3500);
    const total = rosterValue(["mine", "bench", "other"], future);
    expect(benefitFuture(pkg.recv - pkg.give, total)).toBeCloseTo((40 * 1250) / 5500, 12);
    // With W 600 the bench player (500) is worth at most W on the side giving more players: a neutral throw-in, left out
    // with the spot I open (Phase 4c; Checkpoint 4b counted 600 for him and 600 for the spot, the same difference).
    const floored = tradePackage({ players: ["theirs"] }, { players: ["mine", "bench"] }, future, 600);
    expect(floored).toStrictEqual({ recv: 4500, give: 3000, g: 0.5 });
    expect(floored.recv - floored.give).toBe(4500 - 3000);
    // Given for nothing, he moves ΔDyn by nothing.
    const dump = tradePackage({ players: [] }, { players: ["bench"] }, future, 600);
    expect(dump.recv - dump.give).toBe(0);
    expect(rosterValue(["mine", "bench", "other"], future)).toBe(5500);
  });
});

describe("tradeNumbers: the card's numbers from B and the acceptance result", () => {
  const acc = acceptance({ leagueType: "redraft", tradeReview: "none" }, { teamId: "2", activity: { a: 1, rule: "active", trades: 2, recentTrades: 1, transactions: 5, lastWeek: 4 }, history: { hist: null, average: null, trades: 0, used: 0, skipped: 0, perTrade: [] }, pPlayoffs: 0.4 }, { gPartner: 0, deltaLineup: 2.5, h: 1, assets: 2, partnerReceives: [] });

  it("assembles the three numbers and B's parts, the scores on the B₃ given (and B₃ itself), B's market term priced on the same B₃", () => {
    const b = benefit({ leagueType: "redraft", dPO: 0.06, dCH: 0.04, gMine: 0.05, dynasty: null, myPPlayoffs: 0.5, b3: 4.2 });
    const n = tradeNumbers(b, acc, 4.2);
    expect(n.b).toBeCloseTo(100 * (0.15 * 0.06 + 0.85 * 0.04) + (4.2 / 3) * 2 * 0.05, 12); // the default goal, "Win the title"; medium
    expect(n.marketWeekly).toBeCloseTo(0.1, 12);
    expect(n.tradeScore).toBe(tradeScore(n.b, 4.2));
    expect(n.overall).toBe(overallScore(n.b, acc.pComplete, 4.2));
    expect(n.tradeScore).toBe(Math.round(100 * (1 - Math.exp(-(n.b as number) / 4.2))));
    expect(n.overall as number).toBeLessThanOrEqual(n.tradeScore as number);
    expect(n).toMatchObject({ pAccept: acc.pAccept, pComplete: acc.pComplete, acceptLabel: "Likely", bWin: b.bWin, bFuture: null, lambda: null, dDyn: null, dynMissing: false, titleMissing: false, b3: 4.2 });
    expect(benefitNotes(n)).toStrictEqual([]);
    // No scale (no odds): no scores, and no B₃.
    expect(tradeNumbers(b, acc, null)).toMatchObject({ tradeScore: null, overall: null, b3: null, b: n.b });
  });

  it("title odds unknown: the flag reaches the card's numbers and a note says so (review finding)", () => {
    // season.ts nulls every team's P(title) when the league lists fewer playoff rounds than its bracket needs.
    const b = benefit({ leagueType: "redraft", dPO: 0.03, dCH: null, gMine: 0, dynasty: null, myPPlayoffs: 0.5 });
    expect(b.b).toBeCloseTo(3, 12); // 100 × (0.15 + 0.85) × 0.03
    const n = tradeNumbers(b, acc, 6);
    expect(n.titleMissing).toBe(true);
    expect(benefitNotes(n)).toStrictEqual(["Title odds aren't available for this league, so “Helps you” uses playoff odds in their place."]);
    expect(TITLE_MISSING_NOTE).toBe("Title odds aren't available for this league, so “Helps you” uses playoff odds in their place.");
  });

  it("“Several prizes” paying 2nd or 3rd place: the note names the prize odds (Checkpoint 7c)", () => {
    // ⚠️ Worded like the title's, naming no cause (the review of the reward engine, compat-R2; awaiting the lead's sign-off).
    expect(PRIZES_MISSING_NOTE).toBe("Prize odds aren't available for this league, so “Helps you” uses playoff odds in their place.");
    const places = rewardWith({ goal: "prizes", prizes: config.benefit.prizesDefault }, 14);
    const b = benefit({ leagueType: "redraft", dPO: 0.03, dCH: null, dPrizes: { first: null, second: null, third: null, weeklyHigh: 0, pointsLeader: 0 }, gMine: 0, dynasty: null, myPPlayoffs: 0.5, reward: places });
    expect(b).toMatchObject({ titleMissing: true, b: expect.closeTo(3, 12) });
    expect(benefitNotes(b, places)).toStrictEqual([PRIZES_MISSING_NOTE]);
    // A split paying 1st and the weekly high score, 1st unknown: the title's words; the title-only goals keep theirs.
    const weekly = rewardWith({ goal: "prizes", prizes: { first: 100, second: null, third: null, weeklyHigh: 5, pointsLeader: null } }, 14);
    expect(benefitNotes({ titleMissing: true, dynMissing: false }, weekly)).toStrictEqual([TITLE_MISSING_NOTE]);
    for (const goal of ["title", "playoffs"] as const) expect(benefitNotes({ titleMissing: true, dynMissing: false }, titleOnlyReward(goal))).toStrictEqual([TITLE_MISSING_NOTE]);
  });

  it("notes for missing long-term values, and both together", () => {
    const keeper = benefit({ leagueType: "keeper", dPO: 0.03, dCH: null, gMine: 0, dynasty: null, myPPlayoffs: 0.5 });
    expect(benefitNotes(keeper)).toStrictEqual([
      "Title odds aren't available for this league, so “Helps you” uses playoff odds in their place.",
      "Long-term trade values aren't available, so “Helps you” counts this season only.",
    ]);
    expect(benefitNotes({ titleMissing: false, dynMissing: true })).toHaveLength(1);
    expect(benefitNotes({ titleMissing: false, dynMissing: false })).toStrictEqual([]);
  });
});

describe("helpsScale: B₃, the B of +3 points a week under the same goal (planner reply to Checkpoint 4c, A2); B_ref(λ) with long-term values (planner reply to Checkpoint 7a, §2 question 6)", () => {
  // A calibration run as the League model gives it: +3 points a week moved my playoff odds 6.2 points and my title odds 2.9.
  const run = { dPO: 0.062, dCH: 0.029 };
  // F₁₀: the B_future of +10% long-term value.
  const F10 = config.benefit.bFutureScale * config.benefit.helpsFutureShare;

  it("redraft: B₃ = B_win of the run under the goal's weights (no market term), so it follows the goal", () => {
    for (const goal of GOALS) {
      const w = goalWeights(goal);
      const s = helpsScale(run, { leagueType: "redraft", myPPlayoffs: 0.6, goal, dynastyTotal: null });
      expect(s?.raw, goal).toBeCloseTo(100 * (w.playoffs * run.dPO + w.prizes * run.dCH), 12);
      // No λ in redraft: the odds' own response is B₃, +3 a week reads 63, nothing to note.
      expect(s).toMatchObject({ b3: s?.raw, odds: s?.raw, floored: false, lambda: null, f10: null, gainReads: 63, futureReads: null, reason: null });
      expect(helpsScaleNotes(s)).toStrictEqual([]);
      // A trade worth exactly the run's B reads 63 under its own goal.
      expect(tradeScore(win(run.dPO, run.dCH, config.benefit, goal).bWin, s?.b3 ?? null), goal).toBe(63);
    }
    // The default goal ("Win the title") when none is given.
    expect(helpsScale(run, { leagueType: "redraft", myPPlayoffs: 0.6, dynastyTotal: null })).toStrictEqual(helpsScale(run, { leagueType: "redraft", myPPlayoffs: 0.6, goal: "title", dynastyTotal: null }));
    // Ignores the long-term total and λ in redraft leagues, and κ never enters (g_mkt(me) 0).
    expect(helpsScale(run, { leagueType: "redraft", myPPlayoffs: 0.6, dynastyTotal: 50_000, lambda: 0.9 })).toStrictEqual(helpsScale(run, { leagueType: "redraft", myPPlayoffs: 0.6, dynastyTotal: null }));
  });

  it("the title odds unknown: the playoff term scaled up to the whole weight, as every trade's B", () => {
    const s = helpsScale({ dPO: 0.05, dCH: null }, { leagueType: "redraft", myPPlayoffs: 0.6, goal: "title", dynastyTotal: null });
    expect(s?.raw).toBeCloseTo(5, 12);
    expect(s).toMatchObject({ oddsNamed: "playoff", reason: null, gainReads: 63 });
  });

  describe("dynasty and keeper leagues with long-term values: B_ref(λ) = (1 − λ) × B_win₃ + λ × F₁₀, F₁₀ = 4", () => {
    const bWin = win(run.dPO, run.dCH).bWin as number; // 3.395: +3 a week moves the odds normally
    const at = (lambda: number, leagueType: "dynasty" | "keeper" = "dynasty") => helpsScale(run, { leagueType, myPPlayoffs: 0.9, lambda, dynastyTotal: 40_000 });

    it("at λ 0, 0.35, 0.75 and 1: B_win₃ at λ 0, F₁₀ alone at λ 1, never floored while the odds move", () => {
      expect(F10).toBe(4);
      for (const lambda of [0, 0.35, 0.75, 1]) {
        for (const leagueType of ["dynasty", "keeper"] as const) {
          const s = at(lambda, leagueType);
          expect(s, `${leagueType} λ ${lambda}`).toMatchObject({ lambda, f10: F10, odds: bWin, floored: false, reason: null });
          expect(s?.raw, `${leagueType} λ ${lambda}`).toBeCloseTo((1 - lambda) * bWin + lambda * F10, 12);
          expect(s?.b3, `${leagueType} λ ${lambda}`).toBe(s?.raw);
          expect(helpsScaleNotes(s), `${leagueType} λ ${lambda}`).toStrictEqual([]);
        }
      }
      expect(at(0)?.raw).toBeCloseTo(bWin, 12);
      expect(at(0.35)?.raw).toBeCloseTo(0.65 * 3.395 + 0.35 * 4, 12);
      expect(at(0.75)?.raw).toBeCloseTo(0.25 * 3.395 + 0.75 * 4, 12);
      expect(at(1)?.raw).toBe(4);
    });

    it("λ by the Win now ↔ Future setting, else the default by P(playoffs) (contender 0.35, bubble 0.5, rebuilder 0.75; keeper 0.2)", () => {
      const mix = (lambda: number) => (1 - lambda) * bWin + lambda * F10;
      expect(helpsScale(run, { leagueType: "dynasty", myPPlayoffs: 0.6, dynastyTotal: 40_000 })).toMatchObject({ lambda: 0.35, raw: expect.closeTo(mix(0.35), 12) });
      expect(helpsScale(run, { leagueType: "dynasty", myPPlayoffs: 0.3, dynastyTotal: 40_000 })).toMatchObject({ lambda: 0.5, raw: expect.closeTo(mix(0.5), 12) });
      expect(helpsScale(run, { leagueType: "dynasty", myPPlayoffs: 0.1, dynastyTotal: 40_000 })).toMatchObject({ lambda: 0.75, raw: expect.closeTo(mix(0.75), 12) });
      expect(helpsScale(run, { leagueType: "dynasty", myPPlayoffs: 0.1, lambda: 0.2, dynastyTotal: 40_000 })).toMatchObject({ lambda: 0.2, raw: expect.closeTo(mix(0.2), 12) });
      expect(helpsScale(run, { leagueType: "keeper", myPPlayoffs: 0.6, dynastyTotal: 40_000 })).toMatchObject({ lambda: 0.2, raw: expect.closeTo(mix(0.2), 12) });
      // Long-term values missing (or MyDynTotal ≤ 0): B = B_win for every trade, so B₃ = B_win of the run too, and no λ.
      expect(helpsScale(run, { leagueType: "dynasty", myPPlayoffs: 0.1, dynastyTotal: null })?.raw).toBeCloseTo(bWin, 12);
      expect(helpsScale(run, { leagueType: "keeper", myPPlayoffs: 0.6, dynastyTotal: 0 })?.raw).toBeCloseTo(bWin, 12);
      expect(helpsScale(run, { leagueType: "keeper", myPPlayoffs: 0.6, lambda: 0.9, dynastyTotal: 0 })).toMatchObject({ lambda: null, f10: null, futureReads: null, gainReads: 63, reason: null });
    });

    it("the mix: +3 a week this season together with +10% long-term value reads 63 at every λ; each part alone reads gainReads and futureReads", () => {
      const trade = (lambda: number, weeklyRun: boolean, tenPct: boolean) =>
        benefit({ leagueType: "dynasty", dPO: weeklyRun ? run.dPO : 0, dCH: weeklyRun ? run.dCH : 0, gMine: 0.3, dynasty: { delta: tenPct ? 4_000 : 0, total: 40_000 }, myPPlayoffs: 0.9, lambda }).b;
      for (const lambda of [0, 0.2, 0.35, 0.5, 0.75, 0.9, 1]) {
        const s = at(lambda);
        const b3 = s?.b3 ?? null;
        expect(tradeScore(trade(lambda, true, true), b3), `λ ${lambda}`).toBe(63);
        expect(lineupEquivalent(trade(lambda, true, true), b3), `λ ${lambda}`).toBeCloseTo(3, 9);
        expect(tradeScore(trade(lambda, true, false), b3) ?? 0, `λ ${lambda}`).toBe(s?.gainReads);
        expect(tradeScore(trade(lambda, false, true), b3) ?? 0, `λ ${lambda}`).toBe(s?.futureReads);
      }
      // λ 0: the lineup gain alone is the scale; λ 1: the long-term gain alone (review SC-1's cap read it about 100 there).
      expect(at(0)).toMatchObject({ gainReads: 63, futureReads: 0 });
      expect(at(1)).toMatchObject({ gainReads: 0, futureReads: 63 });
      expect(at(0.35)).toMatchObject({ gainReads: tradeScore(0.65 * bWin, at(0.35)?.b3 ?? null), futureReads: tradeScore(0.35 * 4, at(0.35)?.b3 ?? null) });
    });

    it("the floor: B_ref(λ) is floored only when the odds barely move and λ × F₁₀ is small too, and then says so", () => {
      // +3 a week moves B_win 0.2 (under the floor).
      const flat = { dPO: 0.002, dCH: 0.002 };
      const of = (lambda: number) => helpsScale(flat, { leagueType: "dynasty", myPPlayoffs: 0.9, lambda, dynastyTotal: 40_000 });
      for (const lambda of [0, 0.05]) {
        expect(of(lambda), `λ ${lambda}`).toMatchObject({ b3: 0.5, floored: true, reason: "odds" });
        expect(helpsScaleNotes(of(lambda)), `λ ${lambda}`).toStrictEqual([HELPS_FLOOR_NOTE]);
      }
      expect(of(0.05)?.raw).toBeCloseTo(0.95 * 0.2 + 0.05 * 4, 12);
      // From λ 0.1 (0.9 × 0.2 + 0.4 = 0.58) the long-term part carries the scale: no floor, no note; lineup gains read little.
      for (const lambda of [0.1, 0.5, 0.95, 1]) {
        expect(of(lambda), `λ ${lambda}`).toMatchObject({ floored: false, reason: null });
        expect(of(lambda)?.raw, `λ ${lambda}`).toBeCloseTo((1 - lambda) * 0.2 + lambda * 4, 12);
        expect(helpsScaleNotes(of(lambda)), `λ ${lambda}`).toStrictEqual([]);
      }
      expect(of(0.5)?.gainReads).toBe(tradeScore(0.1, 2.1));
    });
  });

  it("floored at 0.5 when +3 points a week barely moves my odds, with the planner's note; never 0 or below", () => {
    const tiny = helpsScale({ dPO: 0.001, dCH: 0.0005 }, { leagueType: "redraft", myPPlayoffs: 0.99, goal: "title", dynastyTotal: null });
    expect(tiny).toMatchObject({ b3: 0.5, floored: true, reason: "odds", oddsNamed: "title" });
    expect(tiny?.raw).toBeCloseTo(100 * (0.15 * 0.001 + 0.85 * 0.0005), 12);
    expect(helpsScaleNotes(tiny)).toStrictEqual([HELPS_FLOOR_NOTE]);
    expect(HELPS_FLOOR_NOTE).toBe("Your title odds barely move with lineup changes right now.");
    // Certainly out: nothing moves; a negative run (noise) is floored too.
    expect(helpsScale({ dPO: 0, dCH: 0 }, { leagueType: "redraft", myPPlayoffs: 0, dynastyTotal: null })).toStrictEqual({
      b3: 0.5,
      raw: 0,
      floored: true,
      odds: 0,
      oddsNamed: "title",
      lambda: null,
      f10: null,
      gainReads: 0,
      futureReads: null,
      reason: "odds",
    });
    expect(helpsScale({ dPO: -0.01, dCH: -0.01 }, { leagueType: "redraft", myPPlayoffs: 0.3, dynastyTotal: null })?.b3).toBe(0.5);
    // Just above the floor: its own B₃, no note.
    const above = helpsScale({ dPO: 0.006, dCH: 0.006 }, { leagueType: "redraft", myPPlayoffs: 0.5, dynastyTotal: null });
    expect(above?.raw).toBeCloseTo(0.6, 12);
    expect(above).toMatchObject({ b3: above?.raw, floored: false });
    expect(helpsScaleNotes(above)).toStrictEqual([]);
    expect(helpsScaleNotes(helpsScale(run, { leagueType: "redraft", myPPlayoffs: 0.5, dynastyTotal: null }))).toStrictEqual([]);
    expect(helpsScaleNotes(null)).toStrictEqual([]);
    // A floor that isn't above 0 (a test config) gives no scale rather than dividing by 0.
    const noFloor: BenefitConfig = { ...config.benefit, helpsFloor: 0 };
    expect(helpsScale({ dPO: 0, dCH: 0 }, { leagueType: "redraft", myPPlayoffs: 0, dynastyTotal: null }, noFloor)).toBeNull();
  });

  it("the floor note names the odds B₃ weighs most: playoff odds when title odds are unknown or under “Make the playoffs” (review of track SC, SC-2)", () => {
    expect(HELPS_FLOOR_NOTE_PLAYOFFS).toBe("Your playoff odds barely move with lineup changes right now.");
    // The regular season is over (every playoff spot decided: ΔPO 0) and title odds are unknown: B counts the playoff odds,
    // which can't move, next to benefitNotes' "Title odds aren't available …", never "Your title odds barely move".
    const over = helpsScale({ dPO: 0, dCH: null }, { leagueType: "redraft", myPPlayoffs: 1, goal: "title", dynastyTotal: null });
    expect(over).toMatchObject({ b3: 0.5, floored: true, reason: "odds", oddsNamed: "playoff" });
    expect(helpsScaleNotes(over)).toStrictEqual([HELPS_FLOOR_NOTE_PLAYOFFS]);
    // Locked into the playoffs under "Make the playoffs": the floor binds (0.7 × 0 + 0.3 × 1.5 points = 0.45) while the
    // title odds still move 1.5 points.
    const locked = { dPO: 0, dCH: 0.015 };
    expect(helpsScale(locked, { leagueType: "redraft", myPPlayoffs: 1, goal: "playoffs", dynastyTotal: null })).toMatchObject({ floored: true, reason: "odds", oddsNamed: "playoff" });
    expect(helpsScaleNotes(helpsScale(locked, { leagueType: "redraft", myPPlayoffs: 1, goal: "playoffs", dynastyTotal: null }))).toStrictEqual([HELPS_FLOOR_NOTE_PLAYOFFS]);
    // Under "Only the champion", and "Several prizes" read by its goal alone (1st place paying everything), the title odds
    // weigh most: the planner's words (and the same odds don't floor there).
    const flat = { dPO: 0.002, dCH: 0.002 };
    for (const goal of ["title", "prizes"] as const) {
      expect(helpsScale(flat, { leagueType: "redraft", myPPlayoffs: 0.5, goal, dynastyTotal: null }), goal).toMatchObject({ reason: "odds", oddsNamed: "title" });
      expect(helpsScaleNotes(helpsScale(flat, { leagueType: "redraft", myPPlayoffs: 0.5, goal, dynastyTotal: null })), goal).toStrictEqual([HELPS_FLOOR_NOTE]);
    }
    expect(helpsScale(locked, { leagueType: "redraft", myPPlayoffs: 1, goal: "title", dynastyTotal: null })).toMatchObject({ floored: false, reason: null });
  });

  it("“Several prizes” paying more than 1st place: B₃ from every prize component of the run, +3 a week reads 63, and the floor note names the prizes (Checkpoint 7c)", () => {
    const parker = rewardWith({ goal: "prizes", prizes: { first: 2000, second: 1600, third: 900, weeklyHigh: null, pointsLeader: null } }, 14);
    const cal = { dPO: 0.06, dCH: 0.03, dPrizes: { first: 0.03, second: 0.025, third: 0.01, weeklyHigh: 0, pointsLeader: 0.002 } as PrizeDeltas };
    const s = helpsScale(cal, { leagueType: "redraft", myPPlayoffs: 0.6, reward: parker, dynastyTotal: null });
    expect(s?.raw).toBeCloseTo(100 * (0.15 * 0.06 + 0.85 * ((4 / 9) * 0.03 + (16 / 45) * 0.025 + 0.2 * 0.01)), 12);
    expect(s).toMatchObject({ oddsNamed: "prizes", gainReads: 63, floored: false, reason: null });
    // A trade worth exactly the run's B under the same reward reads 63.
    expect(tradeScore(benefitWin(cal.dPO, cal.dPrizes, config.benefit, parker).bWin, s?.b3 ?? null)).toBe(63);
    // Floored: the prizes' note, which src/lib/tradeView.ts reads back as an odds note.
    const flat = { dPO: 0.001, dCH: 0.001, dPrizes: { first: 0.001, second: 0.001, third: 0, weeklyHigh: 0, pointsLeader: 0 } as PrizeDeltas };
    const low = helpsScale(flat, { leagueType: "redraft", myPPlayoffs: 0.6, reward: parker, dynastyTotal: null });
    expect(low).toMatchObject({ floored: true, reason: "odds", oddsNamed: "prizes" });
    expect(helpsScaleNotes(low)).toStrictEqual([HELPS_FLOOR_NOTE_PRIZES]);
    expect(HELPS_FLOOR_NOTE_PRIZES).toBe("Your chances at your league's prizes barely move with lineup changes right now.");
    // A paid prize unknown: the playoff odds stand in, and the note names them.
    const unknown = helpsScale({ dPO: 0, dCH: null, dPrizes: { first: null, second: null, third: null, weeklyHigh: 0, pointsLeader: 0 } }, { leagueType: "redraft", myPPlayoffs: 1, reward: parker, dynastyTotal: null });
    expect(unknown).toMatchObject({ oddsNamed: "playoff", floored: true });
    // Nothing entered (1st place pays everything): the title's words.
    const empty = rewardWith({ goal: "prizes", prizes: { first: null, second: null, third: null, weeklyHigh: null, pointsLeader: null } }, 14);
    expect(helpsScale(flat, { leagueType: "redraft", myPPlayoffs: 0.6, reward: empty, dynastyTotal: null })).toMatchObject({ oddsNamed: "title" });
    // A run made before Checkpoint 7c (no dPrizes): ΔCH as 1st place's.
    expect(helpsScale({ dPO: 0.06, dCH: 0.03 }, { leagueType: "redraft", myPPlayoffs: 0.6, reward: titleOnlyReward("title"), dynastyTotal: null })?.raw).toBeCloseTo(100 * (0.15 * 0.06 + 0.85 * 0.03), 12);
  });

  it("no run, or a run without ΔPO: no scale (and so no scores)", () => {
    expect(helpsScale(null, { leagueType: "redraft", myPPlayoffs: 0.5, dynastyTotal: null })).toBeNull();
    expect(helpsScale(undefined, { leagueType: "redraft", myPPlayoffs: 0.5, dynastyTotal: null })).toBeNull();
    expect(helpsScale({ dPO: Number.NaN, dCH: 0.01 }, { leagueType: "redraft", myPPlayoffs: 0.5, dynastyTotal: null })).toBeNull();
  });

  it("lineupEquivalent: 3 × B / B₃ (the Analyzer's “≈ +X pts/week”), signed; null without B or B₃", () => {
    expect(lineupEquivalent(5, 5)).toBe(3);
    expect(lineupEquivalent(2.5, 5)).toBeCloseTo(1.5, 12);
    expect(lineupEquivalent(-1, 6)).toBeCloseTo(-0.5, 12);
    expect(lineupEquivalent(null, 6)).toBeNull();
    expect(lineupEquivalent(3, null)).toBeNull();
    expect(lineupEquivalent(3, 0)).toBeNull();
  });
});
