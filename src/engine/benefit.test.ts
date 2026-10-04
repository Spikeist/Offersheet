import { describe, expect, it } from "vitest";
import { acceptance } from "./acceptance";
import {
  benefit,
  benefitFuture,
  goalWeights,
  benefitNotes,
  benefitWin,
  defaultLambda,
  expectedGain,
  futureValuesLoaded,
  injuredReceived,
  marketSanity,
  overallScore,
  protectValueWeight,
  resolveLambda,
  rosterValue,
  tradeFlags,
  tradeNumbers,
  tradePackage,
  tradeScore,
  type BenefitConfig,
} from "./benefit";
import { config } from "./config";
import type { MarketInputs } from "./inputs";
import { marketGain, packageValues, type MarketConfig } from "./market";
import { mulberry32 } from "./rng";
import { GOALS, type Goal, type ProtectValue } from "./settings";

const market = (over: Partial<MarketInputs> & Pick<MarketInputs, "values">): MarketInputs => ({
  format: { isDynasty: true, numQbs: 1, numTeams: 10, ppr: 0.5, substitutions: [] },
  fetchedAt: "2026-09-29T20:36:00.000Z",
  knownIds: Object.keys(over.values),
  topValue: 10_000,
  ...over,
});

describe("Trade Score and Overall (§10, B_ref 6)", () => {
  it("is configured with B_ref 6 (Checkpoint 3, answer 1)", () => {
    expect(config.benefit.bRef).toBe(6);
  });

  it("matches §10's Trade Score samples", () => {
    const samples: Record<number, number> = { 1: 15, 2: 28, 3: 39, 5: 57, 8: 74, 10: 81 };
    for (const [b, score] of Object.entries(samples)) expect(tradeScore(Number(b))).toBe(score);
  });

  it("scores the Checkpoint 3 scale check (+1, +3, +6 pts/wk in Parker's league: B ≈ 2.05, 6.3, 12.4) 29, 65 and 87", () => {
    expect(tradeScore(2.05)).toBe(29);
    expect(tradeScore(6.3)).toBe(65);
    expect(tradeScore(12.4)).toBe(87);
  });

  it("is null when B ≤ 0 or unknown (hidden by default)", () => {
    expect(tradeScore(0)).toBeNull();
    expect(tradeScore(-2)).toBeNull();
    expect(tradeScore(null)).toBeNull();
    expect(tradeScore(Number.NaN)).toBeNull();
    expect(overallScore(0, 0.5)).toBeNull();
    expect(overallScore(-1, 0.9)).toBeNull();
    expect(overallScore(null, 0.9)).toBeNull();
  });

  it("matches §10's Overall samples", () => {
    expect(overallScore(5, 0.5)).toBe(34);
    expect(overallScore(10, 0.3)).toBe(39);
    expect(overallScore(3, 0.8)).toBe(33);
    expect(overallScore(8, 0.6)).toBe(55);
  });

  it("Overall is never above the Trade Score (random B and P_complete in the model's range)", () => {
    const rand = mulberry32(20_260_930);
    const [lo, hi] = config.acceptance.pAcceptClamp;
    for (let i = 0; i < 2000; i++) {
      const b = rand() * 30;
      // P_complete: P_accept in the clamp, halved by the veto rule half the time.
      const p = (lo + rand() * (hi - lo)) * (i % 2 ? config.acceptance.veto.factor : 1);
      const ts = tradeScore(b);
      const ov = overallScore(b, p);
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
  it("B_win = 100 × (w_PO ΔPO + w_CH ΔCH) in percentage points, the weights by “What matters most” (planner reply to Checkpoint 4b, change 8)", () => {
    expect(config.benefit.goals).toStrictEqual({ title: { playoffs: 0.15, title: 0.85 }, balanced: { playoffs: 0.35, title: 0.65 }, playoffs: { playoffs: 0.7, title: 0.3 } });
    expect(config.benefit.goalDefault).toBe("title");
    // The default goal, "Win the title".
    expect(benefitWin(0.04, 0.02).bWin).toBeCloseTo(100 * (0.15 * 0.04 + 0.85 * 0.02), 12);
    expect(benefitWin(0.04, 0.02).bWin).toBeCloseTo(BWIN, 12);
    expect(benefitWin(0.04, 0.02, config.benefit, "title")).toStrictEqual(benefitWin(0.04, 0.02));
    // "Balanced" (the weights before Phase 4c) and "Make the playoffs".
    expect(benefitWin(0.04, 0.02, config.benefit, "balanced").bWin).toBeCloseTo(100 * (0.35 * 0.04 + 0.65 * 0.02), 12);
    expect(benefitWin(0.04, 0.02, config.benefit, "playoffs").bWin).toBeCloseTo(100 * (0.7 * 0.04 + 0.3 * 0.02), 12);
    expect(benefitWin(0, 0)).toStrictEqual({ bWin: 0, titleMissing: false });
    // Not simulated yet: no B, and nothing about title odds to say.
    expect(benefitWin(null, null)).toStrictEqual({ bWin: null, titleMissing: false });
    expect(benefitWin(null, 0.02)).toStrictEqual({ bWin: null, titleMissing: false });
  });

  it("goalWeights: each goal's weights, and the default goal's for an unknown one", () => {
    expect(goalWeights("title")).toStrictEqual({ playoffs: 0.15, title: 0.85 });
    expect(goalWeights("balanced")).toStrictEqual({ playoffs: 0.35, title: 0.65 });
    expect(goalWeights("playoffs")).toStrictEqual({ playoffs: 0.7, title: 0.3 });
    for (const odd of [undefined, null, "glory" as Goal, "toString" as Goal]) expect(goalWeights(odd)).toStrictEqual({ playoffs: 0.15, title: 0.85 });
    // Each goal's weights sum to 1, so the title-missing rule is 100 × ΔPO under every goal.
    for (const g of GOALS) expect(goalWeights(g).playoffs + goalWeights(g).title).toBeCloseTo(1, 12);
  });

  it("B under each goal: the same odds, different weights; benefit() reads BenefitInputs.goal (absent: the default)", () => {
    const at = (goal?: Goal) => benefit({ leagueType: "redraft", dPO: 0.04, dCH: 0.02, gMine: 0, dynasty: null, myPPlayoffs: 0.6, ...(goal ? { goal } : {}) });
    expect(at().b).toBeCloseTo(BWIN, 12);
    expect(at("title").b).toBeCloseTo(BWIN, 12);
    expect(at("balanced").b).toBeCloseTo(2.7, 12);
    expect(at("playoffs").b).toBeCloseTo(3.4, 12);
    // A trade that only buys title odds (ΔPO 0, ΔCH +2 points) is worth most to "Win the title"; one that only buys playoff odds, to "Make the playoffs".
    const titleOnly = (goal: Goal) => benefit({ leagueType: "redraft", dPO: 0, dCH: 0.02, gMine: 0, dynasty: null, myPPlayoffs: 0.6, goal }).b as number;
    const playoffsOnly = (goal: Goal) => benefit({ leagueType: "redraft", dPO: 0.02, dCH: 0, gMine: 0, dynasty: null, myPPlayoffs: 0.6, goal }).b as number;
    expect(titleOnly("title")).toBeGreaterThan(titleOnly("balanced"));
    expect(titleOnly("balanced")).toBeGreaterThan(titleOnly("playoffs"));
    expect(playoffsOnly("playoffs")).toBeGreaterThan(playoffsOnly("balanced"));
    expect(playoffsOnly("balanced")).toBeGreaterThan(playoffsOnly("title"));
    // Dynasty and keeper leagues weigh B_win by the goal too.
    expect(benefit({ leagueType: "dynasty", dPO: 0.04, dCH: 0.02, gMine: 0, dynasty: { delta: 1000, total: 40_000 }, myPPlayoffs: 0.6, goal: "playoffs" }).bWin).toBeCloseTo(3.4, 12);
  });

  it("title odds unknown: the playoff term scaled up to the whole weight, flagged, under every goal", () => {
    const r = benefitWin(0.04, null);
    expect(r.bWin).toBeCloseTo(4, 12);
    expect(r.titleMissing).toBe(true);
    // B_win = 100 × (w_PO + w_CH) × ΔPO: 4 under every goal (each goal's weights sum to 1).
    for (const g of GOALS) expect(benefitWin(0.04, null, config.benefit, g)).toStrictEqual({ bWin: expect.closeTo(4, 12), titleMissing: true });
    // A widened config whose weights don't sum to 1 shows the formula: 100 × (0.2 + 0.3) × ΔPO.
    const odd: BenefitConfig = { ...config.benefit, goals: { ...config.benefit.goals, title: { playoffs: 0.2, title: 0.3 } } };
    expect(benefitWin(0.04, null, odd, "title").bWin).toBeCloseTo(2, 12);
    // A goal with no playoff weight can't stand in for missing title odds.
    const titleOnly: BenefitConfig = { ...config.benefit, goals: { ...config.benefit.goals, title: { playoffs: 0, title: 1 } } };
    expect(benefitWin(0.04, null, titleOnly, "title")).toStrictEqual({ bWin: null, titleMissing: true });
  });

  it("the market term: κ × clamp(g_mkt(me), ±0.5), κ by default the medium level's (4)", () => {
    expect(marketSanity(0.2)).toBeCloseTo(0.8, 12);
    expect(marketSanity(0.9)).toBe(2);
    expect(marketSanity(-0.9)).toBe(-2);
    expect(marketSanity(Number.POSITIVE_INFINITY)).toBe(2);
    expect(marketSanity(Number.NaN)).toBe(0);
    // A κ passed in replaces the default.
    expect(marketSanity(0.2, 1)).toBeCloseTo(0.2, 12);
    expect(marketSanity(-0.9, 1)).toBe(-0.5);
  });

  it("redraft: B = B_win + the market term; no λ, no future term", () => {
    const r = benefit({ leagueType: "redraft", dPO: 0.04, dCH: 0.02, gMine: -0.1, dynasty: null, myPPlayoffs: 0.6, lambda: 0.9 });
    expect(r.b).toBeCloseTo(BWIN - 0.4, 12);
    expect(r).toMatchObject({ bFuture: null, lambda: null, dDyn: null, dynMissing: false, titleMissing: false });
    expect(r.market).toBeCloseTo(-0.4, 12);
    // Dynasty numbers passed to a redraft league are ignored.
    expect(benefit({ leagueType: "redraft", dPO: 0.04, dCH: 0.02, gMine: -0.1, dynasty: { delta: 1000, total: 1000 }, myPPlayoffs: 0.6 }).b).toBeCloseTo(BWIN - 0.4, 12);
  });

  it("κ by the 'Protect my trade value' level (planner addendum §3): low 2, medium 4 (the default), high 8", () => {
    expect(config.benefit.protectValue).toStrictEqual({ low: 2, medium: 4, high: 8 });
    expect(config.benefit.protectValueDefault).toBe("medium");
    expect(protectValueWeight("low")).toBe(2);
    expect(protectValueWeight("medium")).toBe(4);
    expect(protectValueWeight("high")).toBe(8);
    // Absent or unknown: the default level's.
    expect(protectValueWeight(undefined)).toBe(4);
    expect(protectValueWeight(null)).toBe(4);
    expect(protectValueWeight("max" as ProtectValue)).toBe(4);
    // B = B_win + κ × clamp(g_mkt(me)): giving 25% more value than I get (g_mkt(me) = −0.20) costs 0.4, 0.8 and 1.6 B.
    const at = (level: ProtectValue) => benefit({ leagueType: "redraft", dPO: 0.04, dCH: 0.02, gMine: -0.2, dynasty: null, myPPlayoffs: 0.6, kappa: protectValueWeight(level) });
    expect(at("low").b).toBeCloseTo(BWIN - 0.4, 12);
    expect(at("medium").b).toBeCloseTo(BWIN - 0.8, 12);
    expect(at("high").b).toBeCloseTo(BWIN - 1.6, 12);
    expect(at("high").market).toBeCloseTo(-1.6, 12);
    // The clamp still caps the term at ±0.5 × κ.
    expect(benefit({ leagueType: "redraft", dPO: 0, dCH: 0, gMine: -0.9, dynasty: null, myPPlayoffs: 0.6, kappa: 8 }).b).toBe(-4);
  });

  it("the market term reads g_mkt(me), every player at max(v, W) after the neutral throw-ins (planner replies to Checkpoint 4, change 4, and to Checkpoint 4b, change 2)", () => {
    const base = { leagueType: "redraft" as const, dPO: 0.04, dCH: 0.02, dynasty: null, myPPlayoffs: 0.6 };
    const W = 628;
    const values = { junk: 300, scrap: 120, star: 5000, them: 5500 };
    const gMine = (get: string[], give: string[]) => tradePackage({ players: get }, { players: give }, values, W).g;
    // A player worth less than W given for nothing: he and his spot are left out: no market term at any κ.
    expect(gMine([], ["junk"])).toBe(0);
    for (const kappa of [2, 4, 8]) expect(benefit({ ...base, gMine: gMine([], ["junk"]), kappa })).toMatchObject({ market: 0, b: expect.closeTo(BWIN, 12) });
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
    // A negative g counts as such, at the level's κ, clamped.
    expect(benefit({ ...base, gMine: -0.2, kappa: 8 }).market).toBeCloseTo(-1.6, 12);
    expect(benefit({ ...base, gMine: -0.9, kappa: 2 }).market).toBe(-1);
    // Dynasty and keeper leagues have no market term.
    for (const leagueType of ["dynasty", "keeper"] as const) expect(benefit({ ...base, leagueType, gMine: 0.3, dynasty: { delta: 1000, total: 40_000 } }).market).toBe(0);
  });

  it("dynasty and keeper leagues have no market term, whatever κ (B_future carries the value change)", () => {
    for (const leagueType of ["dynasty", "keeper"] as const) {
      const with4 = benefit({ leagueType, dPO: 0.04, dCH: 0.02, gMine: -0.3, dynasty: { delta: 1000, total: 40_000 }, myPPlayoffs: 0.6 });
      for (const kappa of [1, 2, 8]) {
        const r = benefit({ leagueType, dPO: 0.04, dCH: 0.02, gMine: -0.3, dynasty: { delta: 1000, total: 40_000 }, myPPlayoffs: 0.6, kappa });
        expect(r.b, `${leagueType} κ ${kappa}`).toBe(with4.b);
        expect(r.market).toBe(0);
      }
      // Without long-term values too.
      expect(benefit({ leagueType, dPO: 0.04, dCH: 0.02, gMine: -0.3, dynasty: null, myPPlayoffs: 0.6, kappa: 8 })).toMatchObject({ market: 0, dynMissing: true });
    }
  });

  it("not simulated yet: B is null (and so are the Trade Score and Overall)", () => {
    const r = benefit({ leagueType: "redraft", dPO: null, dCH: null, gMine: 0.2, dynasty: null, myPPlayoffs: null });
    expect(r.b).toBeNull();
    expect(r.titleMissing).toBe(false);
    expect(tradeScore(r.b)).toBeNull();
    expect(overallScore(r.b, 0.5)).toBeNull();
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
    const cfg: BenefitConfig = { ...config.benefit, goals: { ...config.benefit.goals, title: { playoffs: 1, title: 0 } } };
    expect(benefit({ leagueType: "redraft", dPO: 0.03, dCH: 0.5, gMine: 0, dynasty: null, myPPlayoffs: 0.5 }, cfg).b).toBeCloseTo(3, 12);
    const balancedDefault: BenefitConfig = { ...config.benefit, goalDefault: "balanced" };
    expect(benefit({ leagueType: "redraft", dPO: 0.04, dCH: 0.02, gMine: 0, dynasty: null, myPPlayoffs: 0.5 }, balancedDefault).b).toBeCloseTo(2.7, 12);
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

  it("assembles the three numbers and B's parts", () => {
    const b = benefit({ leagueType: "redraft", dPO: 0.06, dCH: 0.04, gMine: 0.05, dynasty: null, myPPlayoffs: 0.5 });
    const n = tradeNumbers(b, acc);
    expect(n.b).toBeCloseTo(100 * (0.15 * 0.06 + 0.85 * 0.04) + 4 * 0.05, 12); // the default goal, "Win the title"
    expect(n.tradeScore).toBe(tradeScore(n.b));
    expect(n.overall).toBe(overallScore(n.b, acc.pComplete));
    expect(n.overall as number).toBeLessThanOrEqual(n.tradeScore as number);
    expect(n).toMatchObject({ pAccept: acc.pAccept, pComplete: acc.pComplete, acceptLabel: "Likely", bWin: b.bWin, bFuture: null, lambda: null, dDyn: null, dynMissing: false, titleMissing: false });
    expect(benefitNotes(n)).toStrictEqual([]);
  });

  it("title odds unknown: the flag reaches the card's numbers and a note says so (review finding)", () => {
    // season.ts nulls every team's P(title) when the league lists fewer playoff rounds than its bracket needs.
    const b = benefit({ leagueType: "redraft", dPO: 0.03, dCH: null, gMine: 0, dynasty: null, myPPlayoffs: 0.5 });
    expect(b.b).toBeCloseTo(3, 12); // 100 × (0.35 + 0.65) × 0.03
    const n = tradeNumbers(b, acc);
    expect(n.titleMissing).toBe(true);
    expect(benefitNotes(n)).toStrictEqual(["Title odds aren't available for this league, so “Helps you” uses playoff odds in their place."]);
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
