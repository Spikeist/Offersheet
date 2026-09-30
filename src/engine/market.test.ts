import { describe, expect, it } from "vitest";
import { config } from "./config";
import type { MarketInputs } from "./inputs";
import {
  curveValue,
  defaultFantasyCalcMode,
  FANTASYCALC_PPR,
  FANTASYCALC_TEAM_SIZES,
  fantasyCalcFormat,
  fantasyCalcFormatLabel,
  isotonicFit,
  marketGain,
  marketSummary,
  marketValues,
  nearestOption,
  packageValues,
  receptionRate,
  valuesForTerm,
  waiverCredit,
  type MarketPlayer,
} from "./market";
import type { LeagueSettings, MarketValues, Pos, Scoring, SlotDef } from "./model";

const slot = (name: string, count: number, eligible: Pos[]): SlotDef => ({ slot: name, count, eligible });
/** Parker's ESPN lineup (Import Report): QB, 2 RB, 2 WR, TE, FLEX, D/ST, K. */
const ESPN_LINEUP: SlotDef[] = [slot("QB", 1, ["QB"]), slot("RB", 2, ["RB"]), slot("WR", 2, ["WR"]), slot("TE", 1, ["TE"]), slot("FLEX", 1, ["RB", "WR", "TE"]), slot("D/ST", 1, ["DEF"]), slot("K", 1, ["K"])];
/** A Sleeper superflex lineup. */
const SUPERFLEX_LINEUP: SlotDef[] = [slot("QB", 1, ["QB"]), slot("RB", 2, ["RB"]), slot("WR", 3, ["WR"]), slot("TE", 1, ["TE"]), slot("FLEX", 2, ["RB", "WR", "TE"]), slot("SUPER_FLEX", 1, ["QB", "RB", "WR", "TE"])];

const scoring = (perStat: Record<string, number>, extra: Partial<Scoring> = {}): Scoring => ({ perStat, rules: [], unmapped: [], ...extra });
const HALF_PPR = scoring({ pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rec: 0.5, rec_yd: 0.1 });

function league(over: Partial<LeagueSettings> = {}): LeagueSettings {
  return {
    numTeams: 10,
    leagueType: "redraft",
    lineup: ESPN_LINEUP,
    benchSlots: 7,
    irSlots: 1,
    taxiSlots: 0,
    maxRosterSize: 16,
    scoring: HALF_PPR,
    regularSeasonWeeks: Array.from({ length: 14 }, (_, i) => i + 1),
    playoffWeeks: [15, 16, 17],
    playoffTeams: 6,
    medianGame: false,
    pointsOnly: false,
    tradeDeadline: { week: 13 },
    tradeReview: "league_vote",
    ...over,
  };
}

/** Market inputs with a 10,000 top value, so valueFloor and waiverCreditMin are both 100. */
const market = (values: Record<string, number>, extra: Partial<MarketInputs> = {}): MarketInputs => ({
  format: fantasyCalcFormat(league()),
  fetchedAt: "2026-09-29T20:36:00.000Z",
  values,
  knownIds: Object.keys(values),
  topValue: 10_000,
  ...extra,
});

/** Seeded PRNG for property tests (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("fantasyCalcFormat (§2.9 FantasyCalc parameters)", () => {
  it("Parker-like ESPN league: 10 teams, half-PPR, 1 QB, redraft is a supported format with nothing substituted", () => {
    const f = fantasyCalcFormat(league());
    expect(f).toStrictEqual({ isDynasty: false, numQbs: 1, numTeams: 10, ppr: 0.5, substitutions: [] });
    expect(fantasyCalcFormatLabel(f)).toBe("10 teams · half-PPR · 1 QB · redraft");
  });

  it("Sleeper-like 12-team superflex dynasty, half-PPR: the SUPER_FLEX slot makes numQbs 2", () => {
    const f = fantasyCalcFormat(league({ numTeams: 12, leagueType: "dynasty", lineup: SUPERFLEX_LINEUP, scoring: scoring({ rec: 0.5, bonus_rec_te: 0 }) }));
    expect(f).toStrictEqual({ isDynasty: true, numQbs: 2, numTeams: 12, ppr: 0.5, substitutions: [] });
    expect(fantasyCalcFormatLabel(f)).toBe("12 teams · half-PPR · 2 QB · dynasty");
  });

  it("§2.9 numQbs 2 for an OP slot or two QB-only spots; more than two QB starters is noted", () => {
    const withSlots = (...extra: SlotDef[]) => fantasyCalcFormat(league({ lineup: [...ESPN_LINEUP, ...extra] }));
    expect(withSlots(slot("OP", 1, ["QB", "RB", "WR", "TE"])).numQbs).toBe(2);
    expect(withSlots(slot("QB", 1, ["QB"])).numQbs).toBe(2); // a second QB slot
    expect(fantasyCalcFormat(league({ lineup: [slot("QB", 2, ["QB"]), slot("RB", 2, ["RB"])] })).numQbs).toBe(2); // one QB slot with count 2
    expect(withSlots(slot("FLEX", 1, ["RB", "WR", "TE"])).numQbs).toBe(1);
    expect(withSlots(slot("OP", 0, ["QB", "RB", "WR", "TE"])).numQbs).toBe(1); // an empty slot starts nobody
    const three = fantasyCalcFormat(league({ lineup: [slot("QB", 2, ["QB"]), slot("SUPER_FLEX", 1, ["QB", "RB", "WR", "TE"])] }));
    expect(three.numQbs).toBe(2);
    expect(three.substitutions).toEqual(["3 QB starting spots → FantasyCalc's 2-QB values"]);
  });

  it("§2.9 numTeams: the nearest supported size, ties to the larger, noted for the Import Report (16 → 14)", () => {
    const f = fantasyCalcFormat(league({ numTeams: 16 }));
    expect(f.numTeams).toBe(14);
    expect(f.substitutions).toEqual(["16 teams → FantasyCalc's 14-team values"]);
    expect(fantasyCalcFormatLabel(f)).toBe("14 teams · half-PPR · 1 QB · redraft");
    const sizes = [4, 6, 8, 9, 10, 11, 12, 13, 14, 20, 32].map((n) => fantasyCalcFormat(league({ numTeams: n })).numTeams);
    expect(sizes).toEqual([8, 8, 8, 10, 10, 12, 12, 14, 14, 14, 14]);
    for (const n of FANTASYCALC_TEAM_SIZES) expect(fantasyCalcFormat(league({ numTeams: n })).substitutions).toEqual([]);
  });

  it("§2.9 ppr: the nearest of 0 / 0.5 / 1 to a WR's points per reception, ties to the larger, noted when not exact (0.75 PPR)", () => {
    const at = (rec: number) => fantasyCalcFormat(league({ scoring: scoring({ rec }) }));
    const f = at(0.75);
    expect(f.ppr).toBe(1);
    expect(f.substitutions).toEqual(["0.75 points per reception → FantasyCalc's PPR values"]);
    expect(at(0.25).ppr).toBe(0.5);
    expect(at(0.25).substitutions).toEqual(["0.25 points per reception → FantasyCalc's half-PPR values"]);
    expect([0, 0.2, 0.5, 0.6, 1, 1.5, -0.5].map((r) => at(r).ppr)).toEqual([0, 0, 0.5, 0.5, 1, 1, 0]);
    for (const r of FANTASYCALC_PPR) expect(at(r).substitutions).toEqual([]);
    expect(fantasyCalcFormatLabel(at(0))).toBe("10 teams · non-PPR · 1 QB · redraft");
    expect(fantasyCalcFormatLabel(at(1))).toBe("10 teams · PPR · 1 QB · redraft");
  });

  it("§2.9 TE premium from ESPN pointsOverrides (byPosition replaces the base rate) → te+ / te++, noted as our mapping", () => {
    const te = (teRec: number) => fantasyCalcFormat(league({ scoring: scoring({ rec: 0.5 }, { byPosition: { TE: { rec: teRec } } }) }));
    const plus = te(1); // +0.5 per catch
    expect(plus.tep).toBe("te+");
    expect(plus.ppr).toBe(0.5); // WRs keep the base rate
    expect(plus.substitutions).toEqual(["TE premium +0.5 per reception → FantasyCalc's TE+ values (our mapping: FantasyCalc doesn't define TE+ or TE++ in points)"]);
    expect(fantasyCalcFormatLabel(plus)).toBe("10 teams · half-PPR · 1 QB · redraft · TE+");
    const plusPlus = te(1.5); // +1 per catch
    expect(plusPlus.tep).toBe("te++");
    expect(fantasyCalcFormatLabel(plusPlus)).toBe("10 teams · half-PPR · 1 QB · redraft · TE++");
    expect("tep" in te(0.5)).toBe(false); // no premium: the parameter is left out
  });

  it("§2.9 TE premium from Sleeper's bonus_rec_te (added to the base rate): above 0 → te+, 0.75 or more → te++", () => {
    const tep = (bonus: number) => fantasyCalcFormat(league({ scoring: scoring({ rec: 1, bonus_rec_te: bonus }) })).tep;
    expect([0, 0.25, 0.5, 0.74, 0.75, 1, 2].map(tep)).toEqual([undefined, "te+", "te+", "te+", "te++", "te++", "te++"]);
    // 1.15 − 0.4 is 0.7499999999999999 in floating point: still the 0.75 cut, so te++.
    expect(fantasyCalcFormat(league({ scoring: scoring({ rec: 0.4 }, { byPosition: { TE: { rec: 1.15 } } }) })).tep).toBe("te++");
  });

  it("counts WR bonuses and plain per-unit reception rules; notes RB rates and TE discounts FantasyCalc can't express", () => {
    // Sleeper bonus_rec_wr on a half-PPR base: WRs score 1 per catch, RBs and TEs 0.5.
    const f = fantasyCalcFormat(league({ scoring: scoring({ rec: 0.5, bonus_rec_wr: 0.5 }) }));
    expect(f.ppr).toBe(1);
    expect(f.tep).toBeUndefined();
    expect(f.substitutions).toEqual([
      "RBs get 0.5 points per reception and WRs 1; FantasyCalc's values use one rate for both",
      "TEs get 0.5 fewer points per reception than WRs; FantasyCalc has no setting for that, so TE values assume the WR rate",
    ]);
    // A plain per-unit rule on receptions for TEs is a premium too (the Import Report counts it the same way).
    const flat = scoring({ rec: 1 }, { rules: [{ kind: "perUnit", stat: "rec", points: 0.5, positions: ["TE"] }] });
    expect(receptionRate(flat, "TE")).toBe(1.5);
    expect(receptionRate(flat, "WR")).toBe(1);
    expect(fantasyCalcFormat(league({ scoring: flat })).tep).toBe("te+");
    // A bounded one isn't a flat rate.
    const bounded = scoring({ rec: 1 }, { rules: [{ kind: "perUnit", stat: "rec", points: 0.5, min: 5, positions: ["TE"] }] });
    expect(receptionRate(bounded, "TE")).toBe(1);
  });

  it("§9 keeper leagues: dynasty values for the future term by default, redraft values for perception on request", () => {
    expect(defaultFantasyCalcMode("redraft")).toBe("redraft");
    expect(defaultFantasyCalcMode("dynasty")).toBe("dynasty");
    expect(defaultFantasyCalcMode("keeper")).toBe("dynasty");
    const keeper = league({ leagueType: "keeper", numTeams: 16 });
    const future = fantasyCalcFormat(keeper);
    const perception = fantasyCalcFormat(keeper, "redraft");
    expect(future.isDynasty).toBe(true);
    expect(perception.isDynasty).toBe(false);
    expect(future.substitutions).toEqual(["keeper league → FantasyCalc's dynasty values for long-term worth", "16 teams → FantasyCalc's 14-team values"]);
    expect(perception.substitutions).toEqual(["keeper league → FantasyCalc's redraft values for how managers see a trade this season", "16 teams → FantasyCalc's 14-team values"]);
    expect(fantasyCalcFormatLabel(future)).toBe("14 teams · half-PPR · 1 QB · dynasty");
    expect(fantasyCalcFormatLabel(perception)).toBe("14 teams · half-PPR · 1 QB · redraft");
  });

  it("a mode other than a redraft or dynasty league's own type is noted", () => {
    expect(fantasyCalcFormat(league({ leagueType: "dynasty" }), "redraft").substitutions).toEqual(["dynasty league → FantasyCalc's redraft values"]);
    expect(fantasyCalcFormat(league(), "dynasty").substitutions).toEqual(["redraft league → FantasyCalc's dynasty values"]);
  });

  it("nearestOption: closest option, a tie to the larger", () => {
    expect(nearestOption([8, 10, 12, 14], 9)).toBe(10);
    expect(nearestOption([8, 10, 12, 14], 9.9)).toBe(10);
    expect(nearestOption([8, 10, 12, 14], 8.9)).toBe(8);
    expect(nearestOption([0, 0.5, 1], 0.75)).toBe(1);
    expect(nearestOption([0, 0.5, 1], 0.35 - 0.1)).toBe(0.5); // 0.24999999999999997 is still a tie
  });
});

describe("isotonicFit and curveValue (§9 monotone curve of value against ROS points)", () => {
  it("pools adjacent violators into their mean; points sharing an x are pooled first", () => {
    expect(isotonicFit([{ x: 1, y: 10 }, { x: 2, y: 30 }, { x: 3, y: 20 }, { x: 4, y: 40 }])).toEqual({ xs: [1, 2, 3, 4], ys: [10, 25, 25, 40] });
    expect(isotonicFit([40, 30, 20, 10].map((y, i) => ({ x: i + 1, y }))).ys).toEqual([25, 25, 25, 25]);
    expect(isotonicFit([{ x: 1, y: 30 }, { x: 2, y: 15 }, { x: 1, y: 10 }])).toEqual({ xs: [1, 2], ys: [55 / 3, 55 / 3] });
    expect(isotonicFit([{ x: Number.NaN, y: 1 }, { x: 1, y: Number.POSITIVE_INFINITY }])).toEqual({ xs: [], ys: [] });
  });

  it("matches the min–max formula of isotonic regression on seeded random data, in any input order", () => {
    const rand = mulberry32(20_260_930);
    for (let trial = 0; trial < 300; trial++) {
      const n = 1 + Math.floor(rand() * 12);
      const pts = Array.from({ length: n }, (_, i) => ({ x: i * 3 + 1, y: Math.round(rand() * 1000) }));
      // Shuffle (Fisher–Yates) so the fit has to sort.
      const shuffled = [...pts];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j] as (typeof pts)[number], shuffled[i] as (typeof pts)[number]];
      }
      const fit = isotonicFit(shuffled);
      expect(fit.xs).toEqual(pts.map((p) => p.x));
      const y = pts.map((p) => p.y);
      const mean = (j: number, k: number) => y.slice(j, k + 1).reduce((s, v) => s + v, 0) / (k - j + 1);
      for (let i = 0; i < n; i++) {
        let best = Number.NEGATIVE_INFINITY;
        for (let j = 0; j <= i; j++) {
          let low = Number.POSITIVE_INFINITY;
          for (let k = i; k < n; k++) low = Math.min(low, mean(j, k));
          best = Math.max(best, low);
        }
        expect(fit.ys[i]).toBeCloseTo(best, 9);
        if (i > 0) expect(fit.ys[i] as number).toBeGreaterThanOrEqual((fit.ys[i - 1] as number) - 1e-9);
      }
    }
  });

  it("curveValue is linear inside the range, flat above it and proportional toward 0 below it", () => {
    const curve = { xs: [40, 60, 100], ys: [200, 400, 800] };
    expect(curveValue(curve, 50)).toBeCloseTo(300, 12);
    expect(curveValue(curve, 80)).toBeCloseTo(600, 12);
    expect(curveValue(curve, 40)).toBe(200);
    expect(curveValue(curve, 60)).toBe(400);
    expect(curveValue(curve, 100)).toBe(800);
    expect(curveValue(curve, 250)).toBe(800);
    expect(curveValue(curve, 10)).toBeCloseTo(50, 12); // 200 × 10 / 40
    expect(curveValue(curve, 0)).toBe(0);
    expect(curveValue(curve, -5)).toBe(0);
    expect(curveValue({ xs: [0, 10], ys: [100, 200] }, -1)).toBe(0); // nothing to scale from below x = 0
    expect(curveValue({ xs: [], ys: [] }, 5)).toBe(0);
  });
});

describe("marketValues (§9 player values)", () => {
  // Ten valued RBs (config.market.unvaluedCurveMinPlayers = 10). The two lowest-ROS ones violate
  // monotonicity (300 at 40 pts, 100 at 50 pts), so PAVA pools them to 200: the lowest real value is
  // 100 but the fitted curve starts at 200.
  const valuedRbs = [
    { x: 40, v: 300 },
    { x: 50, v: 100 },
    ...Array.from({ length: 8 }, (_, i) => ({ x: 60 + 10 * i, v: 400 + 100 * i })),
  ].map((p, i) => ({ id: `rb${i}`, ...p }));
  const rbValues = Object.fromEntries(valuedRbs.map((p) => [p.id, p.v]));
  const rbRos = Object.fromEntries(valuedRbs.map((p) => [p.id, p.x]));
  const rb = (id: string): MarketPlayer => ({ id, pos: "RB" });

  it("no market values (FantasyCalc down) → no values at all", () => {
    expect(marketValues([rb("rb0")], { rb0: 40 }, null)).toEqual({});
  });

  it("a FantasyCalc value wins; zero, negative or non-finite entries are not values", () => {
    const v = marketValues([rb("a"), rb("b"), rb("c"), rb("d")], { a: 100, b: 50, c: 10, d: 5 }, market({ a: 5000, b: 0, c: Number.NaN, d: -3 }));
    expect(v.a).toEqual({ value: 5000, source: "fantasycalc" });
    // One valued RB (< 10): the floor min(valueFloor 100, lowest real 5000) = 100 for the rest.
    for (const id of ["b", "c", "d"]) expect(v[id]).toEqual({ value: 100, source: "floor" });
  });

  it("with enough valued players: estimates below the valued range scale toward 0 from the fitted curve; the rest are capped at the lowest real value", () => {
    const unvalued = { below16: 16, below10: 10, zero: 0, inRange: 45, above: 500 };
    const players = [...valuedRbs.map((p) => rb(p.id)), ...Object.keys(unvalued).map(rb), rb("noRos")];
    const v = marketValues(players, { ...rbRos, ...unvalued }, market(rbValues));
    expect(v.rb1).toEqual({ value: 100, source: "fantasycalc" });
    expect(v.below16).toEqual({ value: 80, source: "estimate" }); // fitted 200 × 16/40, not raw 300 × 16/40 = 120
    expect(v.below10).toEqual({ value: 50, source: "estimate" });
    expect(v.zero).toEqual({ value: 0, source: "estimate" });
    expect(v.inRange).toEqual({ value: 100, source: "estimate" }); // the curve says 200; capped at the lowest real value
    expect(v.above).toEqual({ value: 100, source: "estimate" });
    expect(v.noRos).toBeUndefined(); // no ROS points, no estimate
  });

  it("fewer than unvaluedCurveMinPlayers valued at a position → min(valueFloor, lowest real value); none valued (K, DEF, IDP) → valueFloor", () => {
    const players: MarketPlayer[] = [
      ...valuedRbs.slice(0, 9).map((p) => rb(p.id)), // 9 valued RBs: one short of a curve
      rb("rbX"),
      { id: "te1", pos: "TE" },
      { id: "te2", pos: "TE" },
      { id: "te3", pos: "TE" },
      { id: "teX", pos: "TE" },
      { id: "qb1", pos: "QB" },
      { id: "qbX", pos: "QB" },
      { id: "k", pos: "K" },
      { id: "dst", pos: "DEF" },
      { id: "lb", pos: "LB" },
    ];
    const values = { ...rbValues, te1: 50, te2: 400, te3: 900, qb1: 500 };
    const v = marketValues(players, { rbX: 10, teX: 5, qbX: 5, k: 100, dst: 100, lb: 50 }, market(values));
    expect(v.rbX).toEqual({ value: 100, source: "floor" }); // min(100, lowest RB 100)
    expect(v.teX).toEqual({ value: 50, source: "floor" }); // min(100, lowest TE 50)
    expect(v.qbX).toEqual({ value: 100, source: "floor" }); // min(100, lowest QB 500)
    for (const id of ["k", "dst", "lb"]) expect(v[id]).toEqual({ value: 100, source: "floor" });
    // The fractions come from config.market.
    const doubled = marketValues([{ id: "k", pos: "K" }], {}, market({}), { ...config.market, valueFloorFraction: 0.02 });
    expect(doubled.k).toEqual({ value: 200, source: "floor" });
    // A lower curve minimum turns the 3 valued TEs into a curve.
    const curved = marketValues(players, { te1: 20, te2: 30, te3: 40, teX: 5 }, market(values), { ...config.market, unvaluedCurveMinPlayers: 3 });
    expect(curved.teX).toEqual({ value: 12.5, source: "estimate" }); // 50 × 5 / 20
  });

  it("§9 keeper leagues: perception reads redraftValues, the future term reads values, each with its own top for the floor", () => {
    const keeper = market({ qb: 8000, top: 11_000 }, { redraftValues: { qb: 6000, top: 6000 }, topValue: 11_000 });
    const players: MarketPlayer[] = [{ id: "qb", pos: "QB" }, { id: "k", pos: "K" }];
    const perception = marketValues(players, {}, keeper);
    expect(perception.qb).toEqual({ value: 6000, source: "fantasycalc" });
    expect(perception.k).toEqual({ value: 60, source: "floor" }); // 1% of the redraft top (6000)
    const future = marketValues(players, {}, keeper, config.market, "future");
    expect(future.qb).toEqual({ value: 8000, source: "fantasycalc" });
    expect(future.k).toEqual({ value: 110, source: "floor" }); // 1% of the dynasty top (11,000)
    expect(valuesForTerm(keeper).topValue).toBe(6000);
    expect(valuesForTerm(keeper, "future").topValue).toBe(11_000);
    // Redraft and dynasty leagues have one table: both terms read it.
    const single = market({ qb: 8000 });
    expect(valuesForTerm(single).values).toBe(single.values);
    expect(valuesForTerm(single, "future").values).toBe(single.values);
    // A redraft table without a single value counts as absent rather than flooring everyone.
    const empty = market({ qb: 8000 }, { redraftValues: {} });
    expect(valuesForTerm(empty)).toEqual({ values: empty.values, topValue: 10_000 });
  });

  it("counts a player listed twice once", () => {
    const v = marketValues([rb("a"), rb("a"), { id: "a", pos: "WR" }], { a: 10 }, market({ a: 700 }));
    expect(v).toEqual({ a: { value: 700, source: "fantasycalc" } });
  });
});

describe("waiverCredit (§9 W)", () => {
  it("is the best available free agent's value, at least waiverCreditMinFraction × the top value", () => {
    expect(waiverCredit({ fa1: 300, fa2: 800, rostered: 5000 }, ["fa1", "fa2", "unknown"], 10_000)).toBe(800);
    expect(waiverCredit({ fa1: 30 }, ["fa1"], 10_000)).toBe(100);
    expect(waiverCredit({ fa1: 30 }, ["fa1"], 10_000, { ...config.market, waiverCreditMinFraction: 0.05 })).toBe(500);
    expect(waiverCredit({}, [], 10_000)).toBe(100);
    expect(waiverCredit({}, [], 0)).toBe(0); // no market values
  });

  it("reads marketValues entries (estimates included)", () => {
    const values: MarketValues = { fa1: { value: 250, source: "estimate" }, fa2: { value: 120, source: "fantasycalc" } };
    expect(waiverCredit(values, ["fa1", "fa2"], 10_000)).toBe(250);
  });
});

describe("marketGain (§9 package value with the waiver credit)", () => {
  const values = { stud: 10_000, a: 5_000, b: 5_000 };

  it("§9 examples with W = 400: receiving a 10,000 player for 5,000 + 5,000 is +4.0%, the reverse −3.8%", () => {
    const up = marketGain(["stud"], ["a", "b"], values, 400);
    expect(up).toBeCloseTo(0.04, 12);
    expect((up * 100).toFixed(1)).toBe("4.0");
    const down = marketGain(["a", "b"], ["stud"], values, 400);
    expect(down).toBeCloseTo(-400 / 10_400, 12);
    expect((down * 100).toFixed(1)).toBe("-3.8");
    expect(packageValues(["stud"], ["a", "b"], values, 400)).toEqual({ recv: 10_400, give: 10_000 });
    expect(packageValues(["a", "b"], ["stud"], values, 400)).toEqual({ recv: 10_000, give: 10_400 });
    // The same numbers from marketValues entries.
    const entries: MarketValues = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value, source: "fantasycalc" as const }]));
    expect(marketGain(["stud"], ["a", "b"], entries, 400)).toBeCloseTo(0.04, 12);
  });

  it("an even 1-for-1 is 0; an unvalued id is worth 0; a side giving nothing of value", () => {
    expect(marketGain(["a"], ["b"], values, 400)).toBe(0);
    expect(marketGain(["a", "ghost"], ["b"], values, 400)).toBeCloseTo(-400 / 5_400, 12); // the 1-player side gets W
    expect(marketGain([], [], values, 400)).toBe(0);
    expect(marketGain(["a"], [], values, 400)).toBeCloseTo((5_000 - 400) / 400, 12);
    expect(marketGain(["a"], [], values, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(marketGain(["ghost"], [], values, 0)).toBe(0);
    expect(marketGain([], ["a"], values, 0)).toBe(-1);
  });

  it("§9 studExponent γ replaces every value, W included, with v^γ (default 1 = off)", () => {
    expect(config.market.studExponent).toBe(1);
    const convex = { ...config.market, studExponent: 2 };
    expect(marketGain(["stud"], ["a", "b"], values, 400, convex)).toBeCloseTo((10_000 ** 2 + 400 ** 2) / (2 * 5_000 ** 2) - 1, 12);
    expect(marketGain(["a"], ["b"], values, 400, convex)).toBe(0);
  });
});

describe("marketSummary (League page)", () => {
  it("counts players by value source and reports W and the top value; nothing without a market", () => {
    const values: MarketValues = { a: { value: 5000, source: "fantasycalc" }, b: { value: 40, source: "estimate" }, k: { value: 100, source: "floor" } };
    const m = market({ a: 5000 });
    expect(marketSummary(["a", "b", "k", "x", "a"], values, m, 400)).toEqual({ format: m.format, waiverCredit: 400, topValue: 10_000, counts: { fantasycalc: 1, estimate: 1, floor: 1, none: 1 } });
    expect(marketSummary(["a"], {}, null, 400)).toEqual({ format: null, waiverCredit: 0, topValue: 0, counts: { fantasycalc: 0, estimate: 0, floor: 0, none: 1 } });
  });
});
