/**
 * The market blend's pure parts (CLAUDE.md §6 step 8; planner reply to Checkpoint 4, change 1; src/engine/blend.ts, and the
 * review of track A): which table it reads per league type, the per-position isotonic curve of base rates on value (each
 * curve point inside the value range read off the curve fitted without him, the ends with him) and the factors on
 * hand-made players, and how a factor scales a player's model. The League model's use of it is in league.blend.test.ts.
 */
import { describe, expect, it } from "vitest";
import { applyBlend, blendFactor, blendValues, marketBlend, noBlend, type BlendInput, type MarketBlend, type MarketBlendConfig } from "./blend";
import { config } from "./config";
import type { FantasyCalcFormat, MarketInputs } from "./inputs";
import type { PlayerModel } from "./leagueModel";
import { weeklySd } from "./projections";

const FORMAT: FantasyCalcFormat = { isDynasty: false, numQbs: 1, numTeams: 10, ppr: 1, substitutions: [] };
const market = (extra: Partial<MarketInputs> = {}): MarketInputs => ({ format: FORMAT, fetchedAt: "2026-10-01T00:00:00.000Z", values: { a: 1 }, knownIds: [], topValue: 1, ...extra });

const CFG: MarketBlendConfig = config.marketBlend;
const W = CFG.weight;
/** The blend at w of a rate toward a market number: (1 − w)·ours + w·market, over ours. */
const fOf = (ours: number, mkt: number) => ((1 - W) * ours + W * mkt) / ours;

const wr = (id: string, rate: number, fit = true): BlendInput => ({ id, pos: "WR", rate, fit });

/**
 * Ten healthy WRs worth 1,000 … 10,000 whose base rates lie on the line rate = value ÷ 500 (2, 4, … 20), except w6 at
 * 13.9 where the line says 12: above the trend but in its order (w5 10 < 13.9 < w7 14), so a curve with his own point in
 * it passes through him.
 */
const RATES = [2, 4, 6, 8, 10, 13.9, 14, 16, 18, 20];
const WRS: BlendInput[] = RATES.map((rate, i) => wr(`w${i + 1}`, rate));
const VALUES: Record<string, number> = Object.fromEntries(RATES.map((_, i) => [`w${i + 1}`, 1000 * (i + 1)]));

describe("the blend's table (§6 step 8, rule 2): this season's market in the league's format", () => {
  it("redraft leagues read their values; keeper leagues the redraft list; dynasty leagues the season list, never their dynasty values", () => {
    const values = { a: 1 };
    const redraftValues = { a: 2 };
    const seasonValues = { a: 3 };
    expect(blendValues(market({ values }), "redraft")).toBe(values);
    expect(blendValues(market({ values, redraftValues }), "keeper")).toBe(redraftValues);
    // A keeper league whose dynasty list failed: the redraft list stands in as `values` (its format says so).
    expect(blendValues(market({ values, format: { ...FORMAT, isDynasty: false } }), "keeper")).toBe(values);
    // A keeper league whose redraft list failed: only dynasty values, so no blend.
    expect(blendValues(market({ values, format: { ...FORMAT, isDynasty: true } }), "keeper")).toBeNull();
    expect(blendValues(market({ values, seasonValues, format: { ...FORMAT, isDynasty: true } }), "dynasty")).toBe(seasonValues);
    expect(blendValues(market({ values, format: { ...FORMAT, isDynasty: true } }), "dynasty")).toBeNull();
    expect(blendValues(null, "redraft")).toBeNull();
    expect(blendValues(undefined, "dynasty")).toBeNull();
  });

  it("a separate list without a real value in it (empty, or only zeros, negatives and NaN) is a missing one, as valuesForTerm reads it (review of track A)", () => {
    const empty = {};
    const junk = { a: 0, b: -5, c: Number.NaN };
    // Keeper: an empty redraft list falls back as a missing one does: `values` when it is the redraft list, else nothing.
    expect(blendValues(market({ values: { a: 7 }, redraftValues: empty, format: { ...FORMAT, isDynasty: false } }), "keeper")).toEqual({ a: 7 });
    expect(blendValues(market({ values: { a: 7 }, redraftValues: junk, format: { ...FORMAT, isDynasty: true } }), "keeper")).toBeNull();
    expect(blendValues(market({ values: { a: 7 }, seasonValues: empty, format: { ...FORMAT, isDynasty: true } }), "dynasty")).toBeNull();
    expect(blendValues(market({ values: { a: 7 }, seasonValues: junk, format: { ...FORMAT, isDynasty: true } }), "dynasty")).toBeNull();
    // The league's own list is used as it is: loaded but holding nobody, it blends nobody (nothing failed to load).
    expect(blendValues(market({ values: empty }), "redraft")).toBe(empty);
    expect(marketBlend(WRS, empty, CFG).factors.size).toBe(0);
  });
});

describe("the curve and the factors (rules 1, 4 and 5): base rates on value, each curve point read off the curve without him", () => {
  const blend = marketBlend(WRS, VALUES, CFG);
  const f = (id: string) => blend.factors.get(id);

  it("pulls a player off the trend toward it even when he is in its order, and leaves players on the trend alone", () => {
    expect(blend.weight).toBe(0.5);
    expect(blend.positions).toEqual([
      { pos: "QB", players: 0, fit: 0, blended: false },
      { pos: "RB", players: 0, fit: 0, blended: false },
      { pos: "WR", players: 10, fit: 10, blended: true },
      { pos: "TE", players: 0, fit: 0, blended: false },
    ]);
    // w6: the curve without him runs along the line through w5 (10) and w7 (14), so the market says 12, not his 13.9.
    // A curve with his own point in it passes through him (f 1): the review's finding.
    expect(f("w6")).toEqual({ ours: 13.9, market: expect.closeTo(12, 12), used: expect.closeTo(12.95, 12), f: expect.closeTo(12.95 / 13.9, 12), value: 6000, fit: true });
    // His neighbors read curves that run through him: nudged up a little.
    expect(f("w5")?.market).toBeCloseTo((8 + 13.9) / 2, 12); // between w4 (8) and w6 (13.9)
    expect(f("w7")?.market).toBeCloseTo((13.9 + 16) / 2, 12); // between w6 (13.9) and w8 (16)
    expect(blendFactor(blend, "w5")).toBeCloseTo(fOf(10, 10.95), 12);
    // Everyone else is on the line, and so is the curve without him: f exactly his own.
    for (const id of ["w2", "w3", "w4", "w8", "w9"]) expect(blendFactor(blend, id), id).toBeCloseTo(1, 12);
    expect(blendFactor(blend, "nobody")).toBe(1);
  });

  it("the two ends read the curve with their own point in it: nothing past them to compare, and no extrapolation", () => {
    // w1 and w10 are the value range's ends: their own points (the curve doesn't pool them).
    expect(f("w1")).toMatchObject({ market: 2, f: 1 });
    expect(f("w10")).toMatchObject({ market: 20, f: 1 });
    // A top player valued far above everyone keeps his rate; a curve without him would have flattened him to w10's 20.
    const star = marketBlend([...WRS, wr("star", 40)], { ...VALUES, star: 20_000 }, CFG);
    expect(star.factors.get("star")).toMatchObject({ market: 40, f: 1 });
    // ...unless he is out of order with the players below him: the curve with him pools them.
    const low = marketBlend([...WRS, wr("star", 19)], { ...VALUES, star: 20_000 }, CFG);
    expect(low.factors.get("star")?.market).toBeCloseTo(19.5, 12); // (w10's 20 + his 19) / 2
    expect(low.factors.get("star")?.f).toBeCloseTo(fOf(19, 19.5), 12);
    // w10 isn't an end any more: the curve without him runs from w9 (18 at 9,000) to the star (19 at 20,000).
    expect(low.factors.get("w10")?.market).toBeCloseTo(18 + (19 - 18) * (1000 / 11_000), 12);
  });

  it("pools a rank inversion in the curve without him (pool adjacent violators)", () => {
    // w4 projects 9 and w5 8: each is read off a curve without him, the other one standing in.
    const inv = marketBlend(
      RATES.map((r, i) => wr(`w${i + 1}`, i === 3 ? 9 : i === 4 ? 8 : i === 5 ? 12 : r)),
      VALUES,
      CFG,
    );
    expect(inv.factors.get("w4")?.market).toBeCloseTo(7, 12); // between w3 (6) and w5 (8)
    expect(inv.factors.get("w5")?.market).toBeCloseTo(10.5, 12); // between w4 (9) and w6 (12)
    // w3's curve pools w4 and w5 to 8.5: between w2 (4) and that 8.5 at w4's value.
    expect(inv.factors.get("w3")?.market).toBeCloseTo(6.25, 12);
  });

  it("is the same whatever the players' order, and each id counts once", () => {
    const reversed = marketBlend([...WRS].reverse(), VALUES, CFG);
    const twice = marketBlend([...WRS, wr("w1", 999)], VALUES, CFG);
    expect([...reversed.factors.entries()].sort()).toEqual([...blend.factors.entries()].sort());
    expect(twice.factors).toEqual(blend.factors);
  });

  it("weight 0, or no table: no blend at all, every factor 1", () => {
    for (const none of [marketBlend(WRS, VALUES, { ...CFG, weight: 0 }), marketBlend(WRS, null, CFG)]) {
      expect(none).toEqual(noBlend());
      expect(blendFactor(none, "w6")).toBe(1);
    }
    // A weight above 1 is read as 1: the market's rate alone.
    expect(marketBlend(WRS, VALUES, { ...CFG, weight: 3 }).factors.get("w6")?.used).toBeCloseTo(12, 9);
  });

  it("players off the curve (an injury tag, no game left) are read off it but don't shape it", () => {
    // An injured WR projected 30 a game when healthy, worth 5,500: the curve (healthy players only) says 11.95 there.
    const hurt = wr("hurt", 30, false);
    const withHurt = marketBlend([...WRS, hurt], { ...VALUES, hurt: 5500 }, CFG);
    expect(withHurt.factors.get("hurt")).toEqual({ ours: 30, market: expect.closeTo((10 + 13.9) / 2, 12), used: expect.any(Number), f: expect.closeTo(fOf(30, 11.95), 12), value: 5500, fit: false });
    for (const id of Object.keys(VALUES)) expect(withHurt.factors.get(id), id).toEqual(blend.factors.get(id));
    expect(withHurt.positions.find((p) => p.pos === "WR")).toEqual({ pos: "WR", players: 11, fit: 10, blended: true });
    // As a curve point he would have pulled w5 and w6 toward him.
    const asPoint = marketBlend([...WRS, wr("hurt", 30)], { ...VALUES, hurt: 5500 }, CFG);
    expect(asPoint.factors.get("w6")?.market).not.toBeCloseTo(12, 3);
  });

  it("a player with no rate of his own stays at 0 (f 1) and is never a curve point", () => {
    const zero = marketBlend([...WRS, wr("idle", 0)], { ...VALUES, idle: 5500 }, CFG);
    expect(zero.factors.get("idle")).toMatchObject({ ours: 0, used: 0, f: 1, fit: false });
    expect(blendFactor(zero, "idle")).toBe(1);
    for (const id of Object.keys(VALUES)) expect(zero.factors.get(id), id).toEqual(blend.factors.get(id));
  });

  it("only real FantasyCalc values count (positive and finite), and only at the blended positions: kickers, defenses and unvalued players keep their points", () => {
    const others: BlendInput[] = [
      { id: "k1", pos: "K", rate: 10, fit: true },
      { id: "def1", pos: "DEF", rate: 9, fit: true },
      wr("unvalued", 50),
      wr("zero", 50),
      wr("negative", 50),
      wr("nan", 50),
      wr("inf", 50),
    ];
    const mixed = marketBlend([...WRS, ...others], { ...VALUES, k1: 5000, def1: 5000, zero: 0, negative: -10, nan: Number.NaN, inf: Number.POSITIVE_INFINITY }, CFG);
    for (const p of others) expect(mixed.factors.has(p.id), p.id).toBe(false);
    expect(mixed.positions.find((x) => x.pos === "WR")?.players).toBe(10);
    // The curve is the WRs' own: nothing else moved it.
    expect(mixed.factors).toEqual(blend.factors);
  });

  it("a position with fewer than minPlayers curve points isn't blended (⚠️ too few points for a curve); players off the curve don't count", () => {
    const tes: BlendInput[] = Array.from({ length: 9 }, (_, i) => ({ id: `te${i + 1}`, pos: "TE", rate: 2 + i, fit: true }));
    const tagged: BlendInput = { id: "teQ", pos: "TE", rate: 8, fit: false };
    const values = { ...VALUES, teQ: 4500, ...Object.fromEntries(tes.map((t, i) => [t.id, 1000 * (i + 1)])) };
    const nine = marketBlend([...WRS, ...tes, tagged], values, CFG);
    expect(CFG.minPlayers).toBe(10);
    expect(nine.positions.find((x) => x.pos === "TE")).toEqual({ pos: "TE", players: 10, fit: 9, blended: false });
    for (const t of [...tes, tagged]) expect(nine.factors.has(t.id)).toBe(false);
    // One more healthy TE makes ten curve points: blended, the tagged one read off the curve.
    const ten = marketBlend([...WRS, ...tes, tagged, { id: "te10", pos: "TE", rate: 11, fit: true }], { ...values, te10: 10_000 }, CFG);
    expect(ten.positions.find((x) => x.pos === "TE")).toEqual({ pos: "TE", players: 11, fit: 10, blended: true });
    expect(ten.factors.get("teQ")).toMatchObject({ fit: false, market: expect.closeTo(5.5, 12) }); // at 4,500: between te4 (5) and te5 (6)
  });
});

describe("applying a factor (rule 6): b, every week's p and σ, and the ROS summary", () => {
  /** A WR projected 12, 0 (his bye) and 10 points over three weeks. */
  const model = (): PlayerModel => ({
    id: "w6",
    base: { b: 12, projNow: 12, projWeek: 4, mNow: 1, actualPpg: null, games: 0, alpha: 0, source: "sleeper" },
    weekly: [
      { p: 12, a: 1, m: 1, bye: false, sd: weeklySd(12, "WR") },
      { p: 0, a: 0, m: 1, bye: true, sd: 0 },
      { p: 10, a: 0.9, m: 1, bye: false, sd: weeklySd(10, "WR") },
    ],
    ros: { total: 22, regular: 12, playoffs: 10, gamesLeft: 2, gamesLeftRegular: 1, gamesLeftPlayoffs: 1, bye: { status: "upcoming", week: 5 } },
    value: null,
  });
  /** A blend reaching w6 with base rate 12, market 9: f = (6 + 4.5) / 12 = 0.875. */
  const single = (factor: Partial<{ ours: number; market: number; used: number; f: number }> = {}): MarketBlend => ({
    weight: 0.5,
    factors: new Map([["w6", { ours: 12, market: 9, used: 10.5, f: 0.875, value: 2000, fit: true, ...factor }]]),
    positions: [],
  });

  it("scales b, p and the ROS summary by f, recomputes σ from the scaled points, and keeps byes, availability and the week shape", () => {
    const out = applyBlend(model(), "WR", single());
    expect(out.base.b).toBeCloseTo(12 * 0.875, 12);
    expect(out.base.projNow).toBe(12); // where the base rate came from is unchanged
    expect(out.weekly.map((w) => w.p)).toEqual([expect.closeTo(10.5, 12), 0, expect.closeTo(8.75, 12)]);
    expect(out.weekly.map((w) => w.sd)).toEqual([expect.closeTo(weeklySd(10.5, "WR"), 12), 0, expect.closeTo(weeklySd(8.75, "WR"), 12)]);
    expect(out.weekly.map((w) => [w.a, w.m, w.bye])).toEqual(model().weekly.map((w) => [w.a, w.m, w.bye]));
    expect(out.ros).toMatchObject({ total: expect.closeTo(22 * 0.875, 12), regular: expect.closeTo(10.5, 12), playoffs: expect.closeTo(8.75, 12), gamesLeft: 2, bye: { status: "upcoming", week: 5 } });
    // The original is untouched.
    expect(model().weekly[0]?.p).toBe(12);
  });

  it("PlayerModel.blend is on the ros.total basis: the market number is his ROS at the market's rate, and used = (1 − w) × ours + w × market exactly", () => {
    const out = applyBlend(model(), "WR", single());
    // 22 rest-of-season points at 12 a game; the market's 9 a game gives 16.5 over the same games.
    expect(out.blend).toEqual({ ours: 22, market: expect.closeTo(16.5, 9), used: expect.closeTo(19.25, 9), weight: 0.5 });
    const b = out.blend as NonNullable<PlayerModel["blend"]>;
    expect(b.used).toBeCloseTo((1 - b.weight) * b.ours + b.weight * b.market, 12);
    expect(out.ros.total).toBeCloseTo(b.used, 12);
  });

  it("with no points left (his games are over), his base rate still scales but there is nothing to show", () => {
    const done = { ...model(), weekly: model().weekly.map((w) => ({ ...w, p: 0, a: 0, sd: 0 })), ros: { ...model().ros, total: 0, regular: 0, playoffs: 0 } };
    const out = applyBlend(done, "WR", single());
    expect(out.base.b).toBeCloseTo(10.5, 12);
    expect(out.blend).toBeUndefined();
    expect(out.ros.total).toBe(0);
  });

  it("leaves the model untouched (the same object, no blend) when the blend doesn't reach him, his base rate is 0, or there is no weight", () => {
    const pm = model();
    expect(applyBlend(pm, "WR", noBlend())).toBe(pm);
    expect(applyBlend(pm, "WR", marketBlend(WRS, VALUES, { ...CFG, weight: 0 }))).toBe(pm);
    expect(applyBlend(pm, "WR", single({ ours: 0, used: 0, f: 1 }))).toBe(pm);
    expect(applyBlend({ ...pm, id: "someone" }, "WR", marketBlend(WRS, VALUES, CFG)).blend).toBeUndefined();
  });
});
