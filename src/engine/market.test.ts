import { describe, expect, it } from "vitest";
import { acceptance, type PartnerProfile } from "./acceptance";
import { tradePackage } from "./benefit";
import { perceivedPackage } from "./premium";
import { config } from "./config";
import type { MarketInputs } from "./inputs";
import { activeSpots } from "./irSlots";
import {
  curveMarketValues,
  curveValue,
  defaultFantasyCalcMode,
  FANTASYCALC_PPR,
  FANTASYCALC_TEAM_SIZES,
  fantasyCalcFallbackText,
  fantasyCalcFormat,
  fantasyCalcFormatLabel,
  isotonicFit,
  marketGain,
  marketSummary,
  marketValues,
  nearestOption,
  neutralThrowIns,
  noteDay,
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

describe("the curve fallback (Phase 4c; planner reply to Checkpoint 4b, change 12): an old list only calibrates the model's own value curve", () => {
  // The ten RBs of the block above, from a list FantasyCalc served 20 days ago. Their isotonic curve of value on ROS
  // points: 200 at 40 and 50 (rb0 and rb1 pooled), then 400 at 60 rising by 100 every 10 points to 1,100 at 130.
  const valuedRbs = [{ x: 40, v: 300 }, { x: 50, v: 100 }, ...Array.from({ length: 8 }, (_, i) => ({ x: 60 + 10 * i, v: 400 + 100 * i }))].map((p, i) => ({ id: `rb${i}`, ...p }));
  const rbValues = Object.fromEntries(valuedRbs.map((p) => [p.id, p.v]));
  const rbRos = Object.fromEntries(valuedRbs.map((p) => [p.id, p.x]));
  const rb = (id: string): MarketPlayer => ({ id, pos: "RB" });
  const old = (extra: Partial<MarketInputs> = {}) => market(rbValues, { fallback: { kind: "curve", listDate: "2026-09-14T06:00:00.000Z" }, ...extra });

  it("values every player at the position by the curve at his own ROS points, valued or not (source estimate, no cap)", () => {
    const players = [...valuedRbs.map((p) => rb(p.id)), rb("new1"), rb("star"), rb("noRos")];
    const ros = { ...rbRos, new1: 65, star: 500 };
    const v = marketValues(players, ros, old());
    // A player the old list valued gets the curve's number at today's points, not his old value (100 then; 200 now).
    expect(v.rb1).toEqual({ value: 200, source: "estimate" });
    // On the curve: the same number, as an estimate.
    expect(v.rb5).toEqual({ value: 700, source: "estimate" });
    // An unvalued player isn't capped at the lowest old value: 65 points is halfway from rb2 (400) to rb3 (500).
    expect(v.new1).toEqual({ value: 450, source: "estimate" });
    // Beyond the curve's last point: flat at its top.
    expect(v.star).toEqual({ value: 1100, source: "estimate" });
    expect(v.noRos).toBeUndefined();
    expect(Object.values(v).every((x) => x.source === "estimate")).toBe(true);
    // marketValues runs curveMarketValues then; the players' order doesn't matter.
    expect(curveMarketValues([...players].reverse(), ros, old())).toEqual(v);
  });

  it("fits the curve on the healthy players with points left (review of track MK): an injured player's old value never lifts it; he is read off it at his own ROS points", () => {
    // The review's toy: 14 healthy WRs (ROS 10–140, old values 100–4,650 rising 350 a step: the fit is the points themselves)
    // and a WR out for the season (ROS 0) whom the old list, a dynasty list, still values at 8,000.
    const healthy = Array.from({ length: 14 }, (_, i) => ({ id: `w${i}`, ros: 10 + 10 * i, v: 100 + 350 * i }));
    const wrValues = Object.fromEntries(healthy.map((p) => [p.id, p.v]));
    const wrRos = Object.fromEntries(healthy.map((p) => [p.id, p.ros]));
    const wr = (id: string, fit?: boolean): MarketPlayer => ({ id, pos: "WR", ...(fit === undefined ? {} : { fit }) });
    const wrs = healthy.map((p) => wr(p.id));
    const oldWr = (values: Record<string, number>) => market(values, { fallback: { kind: "curve", listDate: "2026-09-14T06:00:00.000Z" } });
    // Out for the season: no points left, so no curve point whatever his tag says. In the fit, every WR with ROS ≤ 60
    // read 1,979; now each healthy WR reads his own value.
    const season = marketValues([...wrs, wr("star")], { ...wrRos, star: 0 }, oldWr({ ...wrValues, star: 8000 }));
    for (const p of healthy) expect(season[p.id]).toEqual({ value: p.v, source: "estimate" });
    expect(season.star).toEqual({ value: 0, source: "estimate" }); // read off the curve: no games left
    // Out for weeks (an IR tag, fit false): points left, still no curve point; read off the curve at his own ROS points.
    const ir = marketValues([...wrs, wr("ir", false)], { ...wrRos, ir: 35 }, oldWr({ ...wrValues, ir: 8000 }));
    for (const p of healthy) expect(ir[p.id]).toEqual({ value: p.v, source: "estimate" });
    expect(ir.ir).toEqual({ value: 975, source: "estimate" }); // halfway from w2 (800 at 30) to w3 (1,150 at 40)
    // fit true is the default: an unflagged player is a curve point, and the same 8,000 then lifts his neighbours.
    expect(marketValues([...wrs, wr("ir", true)], { ...wrRos, ir: 35 }, oldWr({ ...wrValues, ir: 8000 }))).toEqual(marketValues([...wrs, wr("ir")], { ...wrRos, ir: 35 }, oldWr({ ...wrValues, ir: 8000 })));
    expect(marketValues([...wrs, wr("ir")], { ...wrRos, ir: 35 }, oldWr({ ...wrValues, ir: 8000 })).w3?.value).toBeGreaterThan(1150);
  });

  it("counts curve points, not valued players, against unvaluedCurveMinPlayers: ten valued RBs with one injured, or one without points, is one short", () => {
    const injured = marketValues(
      valuedRbs.map((p, i) => (i === 9 ? { ...rb(p.id), fit: false } : rb(p.id))),
      rbRos,
      old(),
    );
    for (const p of valuedRbs) expect(injured[p.id]).toEqual({ value: 100, source: "floor" }); // min(valueFloor 100, the lowest old value 100)
    const noPoints = marketValues(
      valuedRbs.map((p) => rb(p.id)),
      { ...rbRos, rb9: 0 },
      old(),
    );
    for (const p of valuedRbs) expect(noPoints[p.id]).toEqual({ value: 100, source: "floor" });
  });

  it("a position with too few valued players gets the floor (min(valueFloor, the lowest old value there)); kickers and defenses valueFloor", () => {
    const players: MarketPlayer[] = [{ id: "te1", pos: "TE" }, { id: "teX", pos: "TE" }, { id: "k", pos: "K" }];
    const v = marketValues(players, { te1: 50, teX: 70, k: 80 }, old({ values: { ...rbValues, te1: 3000 } }));
    expect(v).toEqual({ te1: { value: 100, source: "floor" }, teX: { value: 100, source: "floor" }, k: { value: 100, source: "floor" } });
  });

  it("keeper leagues: perception reads the old redraft list and the future term the old dynasty list, as valuesForTerm does", () => {
    const keeperOld = old({ redraftValues: Object.fromEntries(valuedRbs.map((p) => [p.id, p.v * 2])) });
    expect(marketValues(valuedRbs.map((p) => rb(p.id)), rbRos, keeperOld).rb4).toEqual({ value: 1200, source: "estimate" });
    expect(marketValues(valuedRbs.map((p) => rb(p.id)), rbRos, keeperOld, config.market, "future").rb4).toEqual({ value: 600, source: "estimate" });
  });

  it("only the curve path: a saved list (kind saved) is read as FantasyCalc's own values", () => {
    const saved = market(rbValues, { fallback: { kind: "saved", listDate: "2026-09-28T06:00:00.000Z" } });
    expect(marketValues([rb("rb1")], { rb1: 50 }, saved).rb1).toEqual({ value: 100, source: "fantasycalc" });
  });

  it("fantasyCalcFallbackText: the note for a saved list and the banner for the curve, naming the list's day (UTC)", () => {
    expect(noteDay("2026-09-28T23:30:00.000Z")).toBe("Sep 28");
    expect(noteDay("nonsense")).toBeNull();
    expect(fantasyCalcFallbackText({ kind: "saved", listDate: "2026-09-28T06:00:00.000Z" })).toBe("Trade values from Sep 28: FantasyCalc didn't answer.");
    expect(fantasyCalcFallbackText({ kind: "curve", listDate: "2026-09-14T06:00:00.000Z" })).toBe(
      "Trade values are our own estimates, not FantasyCalc's: FantasyCalc didn't answer, and the newest list we have, from Sep 14, is more than 7 days old. Each player's value comes from his projected points for the rest of the season, on a curve fitted to that list, so an injured player's value counts only the games he's expected to play. Read trade values as rough.",
    );
    expect(fantasyCalcFallbackText({ kind: "saved", listDate: "?" })).toBe("Trade values from an earlier day: FantasyCalc didn't answer.");
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

  it("an even 1-for-1 is 0; an unvalued id counts 0 before the floor; a side giving nothing of value", () => {
    expect(marketGain(["a"], ["b"], values, 400)).toBe(0);
    // The ghost (no value: 0, at most W) is a neutral throw-in on the side moving more players: left out with his spot.
    expect(marketGain(["a", "ghost"], ["b"], values, 400)).toBe(0);
    expect(packageValues(["a", "ghost"], ["b"], values, 400)).toEqual({ recv: 5_000, give: 5_000 });
    expect(marketGain([], [], values, 400)).toBe(0);
    // A player worth more than W is never left out: the side giving nothing gets his value for the spot it fills.
    expect(marketGain(["a"], [], values, 400)).toBeCloseTo((5_000 - 400) / 400, 12);
    expect(marketGain(["a"], [], values, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(marketGain(["ghost"], [], values, 0)).toBe(0);
    expect(marketGain([], ["a"], values, 0)).toBe(-1);
  });

  describe("each player at max(v, W), after the neutral throw-ins (planner replies to Checkpoint 4, change 4, and to Checkpoint 4b, change 2)", () => {
    const W = 628;
    const cheap = { ...values, junk: 300, scrap: 120, bench: 610, edge: W };

    it("an even swap of two players worth less than W reads g = 0 for both sides", () => {
      expect(marketGain(["junk"], ["scrap"], cheap, W)).toBe(0);
      expect(marketGain(["scrap"], ["junk"], cheap, W)).toBe(0);
      // A matched pair (the second step, Phase 4c): both are left out with their spots, nothing against nothing (Checkpoint
      // 4b counted W against W: the same g).
      expect(packageValues(["junk"], ["scrap"], cheap, W)).toEqual({ recv: 0, give: 0 });
    });

    it("dumping a player worth less than W for nothing reads g = 0: he and the roster spot he opens are left out", () => {
      expect(packageValues([], ["junk"], cheap, W)).toEqual({ recv: 0, give: 0 });
      expect(marketGain([], ["junk"], cheap, W)).toBe(0);
      // The side taking him sees the same.
      expect(packageValues(["junk"], [], cheap, W)).toEqual({ recv: 0, give: 0 });
      expect(marketGain(["junk"], [], cheap, W)).toBe(0);
    });

    it("a throw-in worth at most W moves nothing, on either side, whichever side he's added to (Checkpoint 4b's ratio effect is gone)", () => {
      // A 1-for-1 (5,000 for 10,000) and the same with "bench" (610 < W) thrown in on the 5,000 side.
      const lean = packageValues(["stud"], ["a"], cheap, W);
      expect(packageValues(["stud"], ["a", "bench"], cheap, W)).toEqual(lean);
      expect(marketGain(["stud"], ["a", "bench"], cheap, W)).toBe(marketGain(["stud"], ["a"], cheap, W));
      // The partner's side: it gets him and gives the same, so its g doesn't move either (it was −50% and stays there).
      expect(marketGain(["a", "bench"], ["stud"], cheap, W)).toBe(marketGain(["a"], ["stud"], cheap, W));
      expect(marketGain(["a"], ["stud"], cheap, W)).toBe(-0.5);
      // A player worth exactly W is one too ("at most W").
      expect(packageValues(["stud"], ["a", "edge"], cheap, W)).toEqual(lean);
      // One cheap player on each side: a matched pair (the second step), both left out with their spots, so it reads as
      // stud for a (Checkpoint 4b, and Phase 4c's first rule alone, counted both at W: each g edged toward 0, +88.7%).
      expect(packageValues(["stud", "scrap"], ["a", "junk"], cheap, W)).toEqual(packageValues(["stud"], ["a"], cheap, W));
      expect(marketGain(["stud", "scrap"], ["a", "junk"], cheap, W)).toBe(1);
      // The side throwing him in got 2 for 1 already: he evens the counts and nobody is cheap on the other side, so he stays
      // in at W, in the place of the spot that side was owed: nothing moves either (as before Phase 4c).
      expect(packageValues(["a", "b"], ["stud", "bench"], cheap, W)).toEqual(packageValues(["a", "b"], ["stud"], cheap, W));
    });

    it("the gap the review of track EF found (finding 1), closed by the matched pairs: A + x → B + c reads as A → B, the same as A → B + c", () => {
      // W 615; my A (1,000) for their B (1,500) and c (100), then with my x (200) thrown in.
      const w = 615;
      const vals = { A: 1000, B: 1500, c: 100, x: 200 };
      const lean = packageValues(["B", "c"], ["A"], vals, w); // my side, without x: the planner's step leaves c out
      expect(lean).toEqual({ recv: 1500, give: 1000 });
      expect(neutralThrowIns(["B", "c"], ["A", "x"], vals, w)).toEqual({ recv: ["B"], give: ["A"], removed: ["c", "x"], spots: { recv: 1, give: 1 } });
      expect(packageValues(["B", "c"], ["A", "x"], vals, w)).toEqual(lean);
      expect(packageValues(["B"], ["A"], vals, w)).toEqual(lean);
      // The partner's side, the mirror: −33.3% with x or without (Phase 4c's first rule alone read −23.6% with x).
      expect(marketGain(["A", "x"], ["B", "c"], vals, w)).toBeCloseTo(-1 / 3, 12);
      expect(marketGain(["A"], ["B", "c"], vals, w)).toBeCloseTo(-1 / 3, 12);
      // Pairs come after the planner's step, cheapest first on each side: in a 3-for-2 with 2 cheap players of mine and 1 of
      // theirs (d = 1), the planner's step takes my cheapest (x), then the pair my next (y) with their c.
      const more = { ...vals, y: 300, z: 500, D: 2500 };
      expect(neutralThrowIns(["B", "c"], ["A", "x", "y"], more, w).removed).toEqual(["c", "x", "y"]);
      // In a 4-for-3 my dearest cheap one (z) stays: the counts are even again and nobody cheap is left on their side.
      expect(neutralThrowIns(["B", "c", "D"], ["A", "x", "y", "z"], more, w)).toEqual({ recv: ["B", "D"], give: ["A", "z"], removed: ["c", "x", "y"], spots: { recv: 2, give: 2 } });
      // He counts W in place of the roster-spot credit on what I give (two players worth more than W in, one out): the same
      // package as with every cheap player left out.
      expect(packageValues(["B", "c", "D"], ["A", "x", "y", "z"], more, w)).toEqual(packageValues(["B", "D"], ["A"], more, w));
    });

    it("the cheapest go first, up to the difference in players; the cheap ones left count W like anyone floored", () => {
      // 3 for 2: one of the two cheap players goes (scrap, the cheaper); junk stays, at W.
      expect(packageValues(["stud", "b"], ["a", "junk", "scrap"], cheap, W)).toEqual({ recv: 15_000, give: 5_000 + W });
      expect(neutralThrowIns(["stud", "b"], ["a", "junk", "scrap"], cheap, W)).toEqual({ recv: ["stud", "b"], give: ["a", "junk"], removed: ["scrap"], spots: { recv: 2, give: 2 } });
      // 4 for 2: two of the three cheap players go, cheapest first (scrap, then junk); bench stays, at W.
      expect(neutralThrowIns(["stud", "b"], ["a", "junk", "bench", "scrap"], cheap, W)).toEqual({ recv: ["stud", "b"], give: ["a", "bench"], removed: ["scrap", "junk"], spots: { recv: 2, give: 2 } });
      expect(packageValues(["stud", "b"], ["a", "junk", "bench", "scrap"], cheap, W)).toEqual({ recv: 15_000, give: 5_000 + W });
      // Never a player worth more than W: 3 for 1 with one cheap player, who goes alone; the side still opens a spot.
      expect(neutralThrowIns(["stud"], ["a", "b", "junk"], cheap, W)).toEqual({ recv: ["stud"], give: ["a", "b"], removed: ["junk"], spots: { recv: 1, give: 2 } });
      expect(packageValues(["stud"], ["a", "b", "junk"], cheap, W)).toEqual({ recv: 10_000 + W, give: 10_000 });
      // Ties by the smaller id, whatever the lists' order.
      const twins = { ...cheap, p2: 200, p1: 200 };
      expect(neutralThrowIns(["stud", "b"], ["p2", "a", "p1"], twins, W).removed).toEqual(["p1"]);
      expect(neutralThrowIns(["stud", "b"], ["p1", "p2", "a"], twins, W).removed).toEqual(["p1"]);
      // The side receiving more: its cheap receipts go (the ghost, then junk), the givers' counts untouched.
      expect(neutralThrowIns(["a", "junk", "ghost"], ["stud"], cheap, W)).toEqual({ recv: ["a"], give: ["stud"], removed: ["ghost", "junk"], spots: { recv: 1, give: 1 } });
    });

    it("no W (0, negative or not a number), or nobody cheap enough on the bigger side and no cheap pair: nobody is left out", () => {
      for (const w of [0, -5, Number.NaN]) expect(neutralThrowIns(["stud"], ["junk", "scrap"], cheap, w).removed).toEqual([]);
      expect(neutralThrowIns(["stud"], ["a", "b"], cheap, W)).toEqual({ recv: ["stud"], give: ["a", "b"], removed: [], spots: { recv: 1, give: 2 } });
      // Equal counts with cheap players on one side only: no pair.
      expect(neutralThrowIns(["stud", "junk"], ["a", "b"], cheap, W).removed).toEqual([]);
      // Equal counts with one on each side: a pair (Checkpoint 4b, and Phase 4c's first rule alone, left both in).
      expect(neutralThrowIns(["junk"], ["scrap"], cheap, W)).toEqual({ recv: [], give: [], removed: ["scrap", "junk"], spots: { recv: 0, give: 0 } });
      // As many pairs as the side with fewer cheap players has, cheapest first on each side; ties by the smaller id.
      const twins = { ...cheap, q1: 200, q2: 200 };
      expect(neutralThrowIns(["stud", "junk", "b"], ["a", "q2", "q1"], twins, W)).toEqual({ recv: ["stud", "b"], give: ["a", "q2"], removed: ["q1", "junk"], spots: { recv: 2, give: 2 } });
      expect(neutralThrowIns(["stud", "junk", "bench"], ["a", "q2", "b"], twins, W)).toEqual({ recv: ["stud", "bench"], give: ["a", "b"], removed: ["q2", "junk"], spots: { recv: 2, give: 2 } });
      expect(neutralThrowIns(["stud", "junk", "bench"], ["a", "q2", "q1"], twins, W).removed).toEqual(["q1", "q2", "junk", "bench"]);
    });

    it("both sides of a trade leave out the same players, so without IR moves my package and the partner's mirror each other (random trades)", () => {
      const rand = mulberry32(20_261_004);
      const ids = Array.from({ length: 8 }, (_, i) => `p${i}`);
      let removedSome = 0;
      for (let k = 0; k < 600; k++) {
        const vals: Record<string, number> = {};
        for (const id of ids) vals[id] = rand() < 0.4 ? Math.round(rand() * 900) : Math.round(rand() * 9000) + 1;
        const w = Math.round(rand() * 1000);
        const shuffled = [...ids].sort(() => rand() - 0.5);
        const ng = Math.floor(rand() * 4);
        const nr = Math.floor(rand() * 4);
        const get = shuffled.slice(0, ng);
        const give = shuffled.slice(ng, ng + nr);
        const mine = packageValues(get, give, vals, w);
        const theirs = packageValues(give, get, vals, w);
        expect(mine, `${k}`).toEqual({ recv: theirs.give, give: theirs.recv });
        const a = neutralThrowIns(get, give, vals, w);
        const b = neutralThrowIns(give, get, vals, w);
        expect([...a.removed].sort(), `${k}`).toEqual([...b.removed].sort());
        if (a.removed.length) removedSome++;
      }
      expect(removedSome).toBeGreaterThan(100);
    });

    it("without IR moves a package equals the one with every player worth at most W left out with his roster spot (random trades)", () => {
      const rand = mulberry32(20_261_007);
      const ids = Array.from({ length: 8 }, (_, i) => `p${i}`);
      let cheapLeftIn = 0;
      for (let k = 0; k < 2000; k++) {
        const vals: Record<string, number> = {};
        for (const id of ids) vals[id] = rand() < 0.45 ? Math.round(rand() * 900) : Math.round(rand() * 9000) + 1;
        const w = k % 7 === 0 ? (vals.p0 as number) : 1 + Math.round(rand() * 900); // sometimes exactly a player's value
        const shuffled = [...ids].sort(() => rand() - 0.5);
        const nr = Math.floor(rand() * 4);
        const ng = Math.floor(rand() * 4);
        const recv = shuffled.slice(0, nr);
        const give = shuffled.slice(nr, nr + ng);
        const dear = (side: string[]) => side.filter((id) => (vals[id] as number) > w);
        const ideal = packageValues(dear(recv), dear(give), vals, w); // nobody cheap left: nobody left out
        expect(packageValues(recv, give, vals, w), `${k}`).toEqual(ideal);
        // The cheap players the steps leave in are all on one side, the one with fewer dear players, at most that many.
        const p = neutralThrowIns(recv, give, vals, w);
        const left = { recv: p.recv.length - dear(recv).length, give: p.give.length - dear(give).length };
        expect(Math.min(left.recv, left.give), `${k}`).toBe(0);
        expect(left.recv, `${k}`).toBeLessThanOrEqual(Math.max(0, dear(give).length - dear(recv).length));
        expect(left.give, `${k}`).toBeLessThanOrEqual(Math.max(0, dear(recv).length - dear(give).length));
        if (left.recv + left.give > 0) cheapLeftIn++;
      }
      expect(cheapLeftIn).toBeGreaterThan(100);
    });

    it("property: without IR moves a player worth at most W added to either side of any trade never changes either side's g (Phase 4c's first rule alone held this only for the side already giving at least as many players)", () => {
      const rand = mulberry32(20_261_005);
      const ids = Array.from({ length: 8 }, (_, i) => `p${i}`);
      const tally = { biggerOrEqual: 0, smaller: 0, theirCheapExtras: 0 };
      for (let k = 0; k < 3000; k++) {
        const vals: Record<string, number> = {};
        for (const id of ids) vals[id] = rand() < 0.4 ? Math.round(rand() * 800) : Math.round(rand() * 9000) + 1;
        const w = 1 + Math.round(rand() * 900);
        vals.t = Math.round(rand() * w); // the throw-in: at most W
        const shuffled = [...ids].sort(() => rand() - 0.5);
        const nGive = 1 + Math.floor(rand() * 3);
        const nRecv = Math.floor(rand() * 4);
        const give = shuffled.slice(0, nGive);
        const recv = shuffled.slice(nGive, nGive + nRecv);
        const withT = [...give, "t"];
        // The thrower's own g, and the taker's (the partner's), before and after.
        expect(marketGain(recv, withT, vals, w), `${k} thrower`).toBeCloseTo(marketGain(recv, give, vals, w), 12);
        expect(marketGain(withT, recv, vals, w), `${k} taker`).toBeCloseTo(marketGain(give, recv, vals, w), 12);
        if (nGive >= nRecv) tally.biggerOrEqual++;
        else {
          tally.smaller++;
          // The gap's shape (review of track EF, finding 1): the other side gives d more, at least d of them cheap.
          if (recv.filter((id) => (vals[id] as number) <= w).length >= nRecv - nGive) tally.theirCheapExtras++;
        }
      }
      expect(Math.min(...Object.values(tally))).toBeGreaterThan(150);
    });

    it("in general, without IR moves, a player added to what one side receives: no move when he's worth at most W, else a rise exactly as the floor and credit say", () => {
      const rand = mulberry32(20_261_003);
      const ids = Array.from({ length: 6 }, (_, i) => `p${i}`);
      const tally = { neutral: 0, owed: 0, newSpot: 0 };
      for (let k = 0; k < 3000; k++) {
        const vals: Record<string, number> = { t: Math.round(rand() * 4000) + 1 };
        for (const id of ids) vals[id] = rand() < 0.3 ? Math.round(rand() * 1500) + 1 : Math.round(rand() * 8000) + 1;
        const w = Math.round(rand() * 2500) + 1;
        const nr = Math.floor(rand() * 3); // what the taker receives before: 0–2 players
        const ng = 1 + Math.floor(rand() * 3); // what it gives: 1–3 players
        const recv = ids.slice(0, nr);
        const give = ids.slice(nr, nr + ng);
        const before = marketGain(recv, give, vals, w);
        const after = marketGain([...recv, "t"], give, vals, w);
        const v = vals.t as number;
        if (v <= w) {
          expect(after, `${k}`).toBeCloseTo(before, 12); // worth at most W: left out, or left in where a credit stood
          tally.neutral++;
          continue;
        }
        // Only the players worth more than W count (the property above): whether the taker was owed a roster-spot credit.
        const dear = (side: string[]) => side.filter((id) => (vals[id] as number) > w).length;
        let margin: number;
        if (dear(give) > dear(recv)) {
          margin = v - w; // he takes the place of a credit the taker was owed: v in place of W
          tally.owed++;
        } else {
          margin = v - w * (1 + before); // a new spot filled: v on what it gets, W on what it gives
          tally.newSpot++;
        }
        if (Math.abs(margin) < 1e-6 * w) continue; // too close to call in floating point
        expect(after > before, `${k}`).toBe(margin > 0);
      }
      // Every branch was exercised.
      expect(Math.min(...Object.values(tally))).toBeGreaterThan(20);
    });

    it("players worth more than W count their own value; the floor comes before the stud exponent; W 0 (or not a positive number) floors nothing", () => {
      expect(packageValues(["stud", "a"], ["b"], cheap, W)).toEqual({ recv: 15_000, give: 5_000 + W });
      const convex = { ...config.market, studExponent: 2 };
      expect(packageValues(["junk"], ["a"], cheap, W, convex)).toEqual({ recv: W ** 2, give: 5_000 ** 2 });
      expect(packageValues(["junk"], ["scrap"], cheap, 0)).toEqual({ recv: 300, give: 120 });
      expect(packageValues(["junk"], ["scrap"], cheap, Number.NaN)).toEqual({ recv: 300, give: 120 });
      expect(packageValues(["junk"], ["scrap"], cheap, -5)).toEqual({ recv: 300, give: 120 });
      // …credits nothing for an open spot, and leaves nobody out.
      expect(packageValues(["junk"], [], cheap, Number.NaN)).toEqual({ recv: 300, give: 0 });
    });

    it("the throw-ins can be chosen on another table than the one summed (premium.perceivedPackage's raw values under a premium)", () => {
      // "junk" carries a premium in the summed table (W × 1.1 > W), but the raw table makes him a throw-in all the same.
      const premium = { ...cheap, junk: W * 1.1 };
      expect(packageValues(["stud"], ["a", "junk"], premium, W)).toEqual({ recv: 10_000 + W, give: 5_000 + W * 1.1 });
      expect(packageValues(["stud"], ["a", "junk"], premium, W, config.market, undefined, cheap)).toEqual({ recv: 10_000, give: 5_000 });
    });
  });

  describe("the planner's result: through value, a throw-in worth at most W can only lower the chance they accept (Checkpoint 4b, answer 6; with n, h and hot held fixed: through the partner's lineup he can still raise it, review of NT, finding 2)", () => {
    const profile: PartnerProfile = {
      teamId: "2",
      activity: { a: 0, rule: "normal", trades: 0, recentTrades: 0, transactions: 3, lastWeek: 4 },
      history: { hist: null, average: null, trades: 0, used: 0, skipped: 0, perTrade: [] },
      pPlayoffs: 0.4,
    };

    it("with n, h and hot held fixed, P_accept and P_complete never rise when he's added: either side throwing him in, whatever the counts (random trades without IR moves, the star premium on the partner's players worth more than W, a league that votes)", () => {
      const rand = mulberry32(20_261_006);
      const ids = Array.from({ length: 8 }, (_, i) => `p${i}`);
      const tally = { lower: 0, mineToSmaller: 0, theirsToSmaller: 0 };
      for (let k = 0; k < 3000; k++) {
        const vals: Record<string, number> = {};
        for (const id of ids) vals[id] = rand() < 0.4 ? Math.round(rand() * 800) : Math.round(rand() * 9000) + 1;
        const w = 1 + Math.round(rand() * 900);
        vals.t = Math.round(rand() * w);
        const shuffled = [...ids].sort(() => rand() - 0.5);
        const nGive = 1 + Math.floor(rand() * 3);
        const nGet = 1 + Math.floor(rand() * 3);
        const give = shuffled.slice(0, nGive); // mine
        const get = shuffled.slice(nGive, nGive + nGet); // theirs
        // The partner's premiums (its #1, #2, top-12 players): only on players worth more than W, as on a real roster.
        const e: Record<string, number> = {};
        for (const id of get) e[id] = (vals[id] as number) > w ? [0, 0, 0.05, 0.1, 0.15, 0.2][Math.floor(rand() * 6)] as number : 0;
        const mineThrows = rand() < 0.5;
        const deltaLineup = (rand() - 0.5) * 10;
        const h = rand() < 0.5 ? 1 : 0;
        const estimate = (g: string[], r: string[]) => {
          // The partner receives my `g` and gives my `r`: its raw g (the veto) and its perceived g (the g feature).
          const gPartner = tradePackage({ players: g }, { players: r }, vals, w).g;
          const gPerceived = perceivedPackage({ players: g }, { players: r }, vals, w, (id) => e[id] ?? 0).g;
          return acceptance({ leagueType: "redraft", tradeReview: "league_vote" }, profile, { gPartner, gPerceived, deltaLineup, h, assets: g.length + r.length, partnerReceives: [] });
        };
        const before = estimate(give, get);
        const after = mineThrows ? estimate([...give, "t"], get) : estimate(give, [...get, "t"]);
        expect(after.pAccept, `${k}`).toBeLessThanOrEqual(before.pAccept + 1e-12);
        expect(after.pComplete, `${k}`).toBeLessThanOrEqual(before.pComplete + 1e-12);
        // The value feature is the same: only the complexity term moved.
        expect(after.terms.value, `${k}`).toBeCloseTo(before.terms.value, 12);
        if (after.pAccept < before.pAccept) tally.lower++;
        // Thrown in on the side giving fewer players: Phase 4c's first rule alone moved g there (the gap).
        if (mineThrows && nGive < nGet) tally.mineToSmaller++;
        if (!mineThrows && nGet < nGive) tally.theirsToSmaller++;
      }
      expect(Math.min(...Object.values(tally))).toBeGreaterThan(300);
    });

    it("the gap's example (review of track EF, finding 1): my cheap throw-in no longer lifts a −33.3% trade past the veto line", () => {
      // W 615: my A (1,000) for their B (1,500) and c (100): −33.3% for them, vetoed. With my x (200): the same −33.3%
      // (Phase 4c's first rule alone: −23.6%, not vetoed).
      const w = 615;
      const vals = { A: 1000, B: 1500, c: 100, x: 200 };
      const lean = tradePackage({ players: ["A"] }, { players: ["B", "c"] }, vals, w);
      const full = tradePackage({ players: ["A", "x"] }, { players: ["B", "c"] }, vals, w);
      expect(full).toEqual(lean);
      expect(full.g).toBeCloseTo(-1 / 3, 12);
      const estimate = (g: number, assets: number) => acceptance({ leagueType: "redraft", tradeReview: "league_vote" }, profile, { gPartner: g, deltaLineup: 1.5 * config.acceptance.nScale, h: 1, assets, partnerReceives: [] });
      const offer = estimate(lean.g, 3);
      const withX = estimate(full.g, 4);
      expect([offer.vetoRisk, withX.vetoRisk]).toEqual([true, true]);
      expect(withX.pComplete).toBeLessThan(offer.pComplete);
    });

    it("the Checkpoint 4b example: a cheap throw-in no longer lifts a −32% trade past the veto line", () => {
      // A league that votes, W = 628: the partner gives a 5,000 player for my 3,400 one (−32%: vetoed), n 1.5, a hole.
      const W = 628;
      const vals = { mine: 3400, theirs: 5000, junk: 300 };
      const lean = tradePackage({ players: ["mine"] }, { players: ["theirs"] }, vals, W);
      const full = tradePackage({ players: ["mine", "junk"] }, { players: ["theirs"] }, vals, W);
      expect(lean.g).toBeCloseTo(-0.32, 12);
      expect(full).toEqual(lean); // before Phase 4c: −28.4%, above the −30% line
      const estimate = (g: number, assets: number) => acceptance({ leagueType: "redraft", tradeReview: "league_vote" }, profile, { gPartner: g, deltaLineup: 1.5 * config.acceptance.nScale, h: 1, assets, partnerReceives: [] });
      const offer = estimate(lean.g, 2);
      const withJunk = estimate(full.g, 3);
      expect([offer.vetoRisk, withJunk.vetoRisk]).toEqual([true, true]);
      expect(withJunk.pAccept).toBeLessThan(offer.pAccept);
      expect(withJunk.pComplete).toBeLessThan(offer.pComplete);
    });
  });

  describe("open roster spots are active roster spots (review of Phase 4b track E: an IR slot isn't one)", () => {
    const cheap = { stud: 10_000, a: 5_000, b: 5_000, junk: 300, scrap: 120, ir: 400 };
    const W = 600;

    it("without spots every player takes one (the counts, as before IR players were tradable); spots equal to the counts change nothing", () => {
      for (const [recv, give] of [[["stud"], ["a", "b"]], [["a", "b"], ["stud"]], [["junk"], []], [[], ["junk"]], [["a"], ["b"]], [["stud"], ["a", "junk"]]] as [string[], string[]][]) {
        expect(packageValues(recv, give, cheap, W, config.market, { recv: recv.length, give: give.length })).toEqual(packageValues(recv, give, cheap, W));
      }
    });

    it("a side that gives an active player and an IR player for one player opens no spot: no credit (Rico Dowdle for Kalif Raymond + Jordan Mason)", () => {
      // The partner gives junk (active) and ir (from its IR) and gets "a" onto its active roster: one off, one on. junk, the
      // cheaper of the two it gives (both worth less than W), is the neutral throw-in, with his spot; ir stays in at W, and
      // the spot "a" fills counts W on what it gives.
      const spots = { recv: 1, give: 1, inactive: new Set(["ir"]) };
      expect(packageValues(["a"], ["junk", "ir"], cheap, W, config.market, spots)).toEqual({ recv: 5_000, give: 2 * W });
      expect(marketGain(["a"], ["junk", "ir"], cheap, W, config.market, spots)).toBeCloseTo(5_000 / (2 * W) - 1, 12);
      // Counting players, it was credited a spot it never had: even on spots.
      expect(packageValues(["a"], ["junk", "ir"], cheap, W)).toEqual({ recv: 5_000, give: W });
      // With a cheap player received too (scrap), he and ir are a matched pair (Phase 4c): nothing against nothing.
      expect(packageValues(["scrap"], ["junk", "ir"], cheap, W, config.market, spots)).toEqual({ recv: 0, give: 0 });
    });

    it("a neutral throw-in who moves without an active spot (ActiveSpots.inactive) takes no spot credit with him", () => {
      // A side gives "a" (active) and "ir" (from its IR, worth less than W) for "stud": one active player each way.
      const spots = { recv: 1, give: 1, inactive: new Set(["ir"]) };
      expect(neutralThrowIns(["stud"], ["a", "ir"], cheap, W, spots)).toEqual({ recv: ["stud"], give: ["a"], removed: ["ir"], spots: { recv: 1, give: 1 } });
      expect(packageValues(["stud"], ["a", "ir"], cheap, W, config.market, spots)).toEqual({ recv: 10_000, give: 5_000 });
      // Read as an active player, he would take a spot the side never opened with him (W on what it gives).
      expect(packageValues(["stud"], ["a", "ir"], cheap, W, config.market, { recv: 1, give: 1 })).toEqual({ recv: 10_000, give: 5_000 + W });
      // On the side receiving him into an IR slot: no spot there either.
      expect(neutralThrowIns(["a", "ir"], ["stud"], cheap, W, { recv: 1, give: 1, inactive: new Set(["ir"]) }).spots).toEqual({ recv: 1, give: 1 });
    });

    it("an IR player given for an active player: the side's active roster fills a spot (W on what it gives)", () => {
      expect(packageValues(["a"], ["ir"], cheap, W, config.market, { recv: 1, give: 0 })).toEqual({ recv: 5_000, give: W + W });
    });

    it("an IR player received into an open IR slot fills no active spot: the side that let an active player go is credited the spot", () => {
      // It gives a (active) and receives ir into its IR slot: one active spot opens.
      expect(packageValues(["ir"], ["a"], cheap, W, config.market, { recv: 0, give: 1 })).toEqual({ recv: W + W, give: 5_000 });
      // Received into an IR slot for an IR player given: no active spot moves either way.
      expect(packageValues(["a"], ["b"], cheap, W, config.market, { recv: 0, give: 0, inactive: new Set(["a", "b"]) })).toEqual({ recv: 5_000, give: 5_000 });
      // Two such players worth less than W are a matched pair, left out with no spot to take: nothing against nothing
      // (before Phase 4c's pairs: W against W, the same g).
      expect(packageValues(["ir"], ["junk"], cheap, W, config.market, { recv: 0, give: 0, inactive: new Set(["ir", "junk"]) })).toEqual({ recv: 0, give: 0 });
    });

    it("⚠️ the exception (the file header): with an IR move, a cheap player left in can count W where no roster-spot credit stands, so a cheap throw-in can still move g, even past the veto line", () => {
      // The partner gives B (2,500) from its IR into my open IR slot and C (2,000) from its active roster for my A (3,000),
      // W 600: −33.3% for the partner (vetoed). My x (300, active) evens the counts of players, so nothing is left out, but
      // only one active spot opens on the partner's roster (C's) against two filled (A's and x's): x counts W on what it
      // gets and the spot he takes W on what it gives, as under Phase 4b: −29.4%, past the veto line.
      const vals = { A: 3000, B: 2500, C: 2000, x: 300 };
      const w = 600;
      const theirs = (withX: boolean) => ({ recv: withX ? 2 : 1, give: 1, inactive: new Set(["B"]) });
      expect(marketGain(["A"], ["B", "C"], vals, w, config.market, theirs(false))).toBeCloseTo(-1 / 3, 12);
      expect(marketGain(["A", "x"], ["B", "C"], vals, w, config.market, theirs(true))).toBeCloseTo(3600 / 5100 - 1, 12);
      // My side (B goes into my IR slot: inactive for me too) moves toward 0 the same way: +50% → +41.7%.
      const mine = (withX: boolean) => ({ recv: 1, give: withX ? 2 : 1, inactive: new Set(["B"]) });
      expect(marketGain(["B", "C"], ["A"], vals, w, config.market, mine(false))).toBeCloseTo(0.5, 12);
      expect(marketGain(["B", "C"], ["A", "x"], vals, w, config.market, mine(true))).toBeCloseTo(5100 / 3600 - 1, 12);
      // Without the IR move (B from its active roster onto mine) x is neutral: left in at W where the credit stood.
      expect(marketGain(["A", "x"], ["B", "C"], vals, w)).toBe(marketGain(["A"], ["B", "C"], vals, w));
    });

    it("⚠️ TradeEvaluation.value's own example (review POL-3): with an IR move, my cheap throw-in adds W to both of my numbers; without one, nothing", () => {
      // As evaluate.ts prices my side: tradePackage on what I get and give, with my active-roster spots (irSlots.activeSpots,
      // evaluate.spotsOf). I give A (5,000) and get B (3,000) into my open IR slot and C (4,000); W 600. Then I add x (200).
      const vals = { A: 5000, B: 3000, C: 4000, x: 200 };
      const w = 600;
      const mine = (give: string[], toIR: string[]) => tradePackage({ players: ["B", "C"] }, { players: give }, vals, w, config.market, activeSpots(give, ["B", "C"], { givenIR: [], toIR }));
      expect(mine(["A"], ["B"])).toMatchObject({ give: 5000, recv: 7000 });
      expect(mine(["A", "x"], ["B"])).toMatchObject({ give: 5600, recv: 7600 });
      expect(mine(["A", "x"], ["B"]).g).toBeLessThan(mine(["A"], ["B"]).g);
      // B onto my active roster instead: x takes the place of the roster spot I fill, so both numbers stay.
      expect(mine(["A", "x"], [])).toEqual(mine(["A"], []));
      expect(mine(["A"], [])).toMatchObject({ give: 5600, recv: 7000 });
    });

    it("⚠️ the exception, precisely (random trades with IR moves of the kinds evaluate.ts makes): a package differs from the one with every cheap player left out with his spot exactly when a cheap player left in moves without an active spot or they outnumber their list's credits; only then can a cheap player move a side's g", () => {
      // Kinds: "AA" active to active; "II" from an IR slot into the receiver's open IR slot; "IA" from an IR slot onto the
      // receiver's active roster (evaluate.ts rule 5: a player from an active roster never goes to an IR slot).
      type Kind = "AA" | "II" | "IA";
      const rand = mulberry32(20_261_008);
      const spotsFor = (recv: string[], give: string[], kind: Record<string, Kind>) => {
        const inactive = new Set<string>([...give.filter((id) => kind[id] !== "AA"), ...recv.filter((id) => kind[id] === "II")]);
        return { recv: recv.filter((id) => !inactive.has(id)).length, give: give.filter((id) => !inactive.has(id)).length, inactive };
      };
      const tally = { equal: 0, differs: 0, moved: 0 };
      for (let k = 0; k < 4000; k++) {
        const w = 100 + Math.round(rand() * 900);
        const ids = Array.from({ length: 7 }, (_, i) => `p${i}`);
        const vals: Record<string, number> = {};
        const kind: Record<string, Kind> = {};
        const irRate = rand() < 0.3 ? 0 : 0.3;
        for (const id of ids) {
          vals[id] = rand() < 0.45 ? Math.round(rand() * w) : w + 1 + Math.round(rand() * 8000);
          kind[id] = rand() < irRate ? (rand() < 0.5 ? "II" : "IA") : "AA";
        }
        vals.x = Math.round(rand() * w);
        kind.x = rand() < irRate ? (rand() < 0.5 ? "II" : "IA") : "AA";
        const nGive = Math.floor(rand() * 4);
        const nGet = Math.floor(rand() * 4);
        const give = ids.slice(0, nGive);
        const get = ids.slice(nGive, nGive + nGet);
        const mineThrows = rand() < 0.5;
        const give2 = mineThrows ? [...give, "x"] : give;
        const get2 = mineThrows ? get : [...get, "x"];
        const dear = (side: readonly string[]) => side.filter((id) => (vals[id] as number) > w);
        const sum = (side: readonly string[]) => side.reduce((s, id) => s + (vals[id] as number), 0);
        /** Whether the side's package isn't the one with every cheap player left out with his spot (the file header). */
        const differs = (recv: string[], gv: string[]): boolean => {
          const sp = spotsFor(recv, gv, kind);
          const p = neutralThrowIns(recv, gv, vals, w, sp);
          const leftR = p.recv.filter((id) => (vals[id] as number) <= w);
          const leftG = p.give.filter((id) => (vals[id] as number) <= w);
          expect(Math.min(leftR.length, leftG.length), `${k}: one side`).toBe(0);
          const left = leftR.length ? leftR : leftG;
          const active = (side: readonly string[]) => side.filter((id) => !sp.inactive.has(id)).length;
          const credits = leftR.length ? Math.max(0, active(dear(gv)) - active(dear(recv))) : Math.max(0, active(dear(recv)) - active(dear(gv)));
          const broken = left.some((id) => sp.inactive.has(id)) || left.length > credits;
          // The statement: the package equals that one exactly when it isn't broken (integer sums: exact).
          const pv = packageValues(recv, gv, vals, w, config.market, sp);
          const ideal = { recv: sum(dear(recv)) + Math.max(0, active(dear(gv)) - active(dear(recv))) * w, give: sum(dear(gv)) + Math.max(0, active(dear(recv)) - active(dear(gv))) * w };
          expect(pv.recv === ideal.recv && pv.give === ideal.give, `${k}`).toBe(!broken);
          if (broken) expect([...recv, ...gv].some((id) => kind[id] !== "AA"), `${k}: only with an IR move`).toBe(true);
          tally[broken ? "differs" : "equal"]++;
          return broken;
        };
        const g = (recv: string[], gv: string[]) => marketGain(recv, gv, vals, w, config.market, spotsFor(recv, gv, kind));
        for (const [r1, g1, r2, g2] of [
          [get, give, get2, give2],
          [give, get, give2, get2],
        ] as [string[], string[], string[], string[]][]) {
          const brokenBefore = differs(r1, g1);
          const brokenAfter = differs(r2, g2);
          const a = g(r1, g1);
          const b = g(r2, g2);
          if (a === b || Math.abs(a - b) <= 1e-12) continue;
          expect(brokenBefore || brokenAfter, `${k}: moved only when broken`).toBe(true);
          tally.moved++;
        }
      }
      expect(Math.min(...Object.values(tally))).toBeGreaterThan(50);
    });

    it("unreadable spot counts fall back to the player counts; negative ones count 0", () => {
      expect(packageValues(["stud"], ["a", "b"], cheap, W, config.market, { recv: Number.NaN, give: Number.POSITIVE_INFINITY })).toEqual(packageValues(["stud"], ["a", "b"], cheap, W));
      expect(packageValues(["stud"], ["a"], cheap, W, config.market, { recv: -3, give: 1 })).toEqual({ recv: 10_000 + W, give: 5_000 });
    });
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
