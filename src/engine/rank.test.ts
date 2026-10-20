import { describe, expect, it } from "vitest";
import { displayAcceptance } from "./acceptance";
import { helpsBoth } from "./benefit";
import { config } from "./config";
import { mulberry32 } from "./rng";
import { assetId, compareOverall, helpsBothTrades, meetsMinChance, rankTrades, sortTrades, type RankConfig } from "./rank";
import { titleDeltas } from "./reward";
import { tradeEvaluation } from "./tradeTestFixtures";
import type { TradeAsset, TradeEvaluation } from "./tradeModel";

const keys = (ts: readonly TradeEvaluation[]) => ts.map((t) => t.key);

/** A value lookup from a table (unknown assets 0). */
const valueOf =
  (table: Record<string, number>) =>
  (a: TradeAsset): number =>
    table[assetId(a)] ?? 0;

/** Every asset worth its id's number ("p12" → 12), so cores differ unless a test shares players. */
const byNumber = (a: TradeAsset): number => Number(assetId(a).replace(/\D/g, "")) || 0;

function shuffle<T>(xs: readonly T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

describe("sortTrades (§13 sort options)", () => {
  const a = tradeEvaluation({ key: "a", b: 4, pComplete: 0.5 }); // EG 2
  const b = tradeEvaluation({ key: "b", b: 8, pComplete: 0.2 }); // EG 1.6
  const c = tradeEvaluation({ key: "c", b: 2, pComplete: 0.9 }); // EG 1.8
  const d = tradeEvaluation({ key: "d", b: -1, pComplete: 0.95 }); // EG −0.95
  const e = tradeEvaluation({ key: "e", b: null, pComplete: 0.99 }); // unknown

  it("Overall: expected gain B × P_complete, highest first; an unknown B last", () => {
    expect(keys(sortTrades([e, d, c, b, a], "overall"))).toEqual(["a", "c", "b", "d", "e"]);
  });

  it("Helps you: B, highest first; an unknown B last", () => {
    expect(keys(sortTrades([e, d, c, b, a], "helps"))).toEqual(["b", "a", "c", "d", "e"]);
  });

  it("Chance they accept: P_complete among B > 0, then B ≤ 0 or unknown, each by P_complete", () => {
    expect(keys(sortTrades([a, b, c, d, e], "accept"))).toEqual(["c", "a", "b", "e", "d"]);
  });

  it("ties go to the higher expected gain, then the smaller key", () => {
    const x = tradeEvaluation({ key: "x", b: 5, pComplete: 0.3 });
    const y = tradeEvaluation({ key: "y", b: 5, pComplete: 0.6 });
    const z = tradeEvaluation({ key: "z", b: 2, pComplete: 0.6 });
    expect(keys(sortTrades([x, y], "helps"))).toEqual(["y", "x"]); // equal B: EG decides
    expect(keys(sortTrades([z, y], "accept"))).toEqual(["y", "z"]); // equal P_complete: EG decides
    const p = tradeEvaluation({ key: "p", b: 3, pComplete: 0.5 });
    const q = tradeEvaluation({ key: "q", b: 3, pComplete: 0.5 });
    for (const sort of ["overall", "helps", "accept"] as const) expect(keys(sortTrades([q, p], sort))).toEqual(["p", "q"]);
  });

  it("treats NaN like an unknown number", () => {
    const n = tradeEvaluation({ key: "n", b: Number.NaN, pComplete: 0.5 });
    expect(keys(sortTrades([n, a], "overall"))).toEqual(["a", "n"]);
    expect(keys(sortTrades([n, a], "helps"))).toEqual(["a", "n"]);
  });

  it("returns a new array, leaves the input alone, and doesn't depend on the input order", () => {
    const input = [e, d, c, b, a];
    const copy = [...input];
    const out = sortTrades(input, "overall");
    expect(out).not.toBe(input);
    expect(input).toEqual(copy);
    for (let s = 1; s <= 5; s++) expect(keys(sortTrades(shuffle(input, s), "overall"))).toEqual(keys(out));
  });
});

describe("rankTrades: hidden by default (§10 guards)", () => {
  it("counts B ≤ 0 and an unknown B as byBenefit, g_mkt(me) below marketHideBelow as byMarket, and shows the rest in Overall order", () => {
    const hide = config.benefit.marketHideBelow;
    const trades = [
      tradeEvaluation({ key: "neg", b: -0.5, give: ["p1"], get: ["p2"] }),
      tradeEvaluation({ key: "zero", b: 0, give: ["p3"], get: ["p4"] }),
      tradeEvaluation({ key: "null", b: null, give: ["p5"], get: ["p6"] }),
      tradeEvaluation({ key: "lopsided", b: 6, gMine: hide - 0.01, give: ["p7"], get: ["p8"] }),
      tradeEvaluation({ key: "both", b: -1, gMine: hide - 0.2, give: ["p9"], get: ["p10"] }), // B checked first
      tradeEvaluation({ key: "edge", b: 2, gMine: hide, give: ["p11"], get: ["p12"] }), // at the threshold: shown
      tradeEvaluation({ key: "good", b: 5, pComplete: 0.5, give: ["p13"], get: ["p14"] }),
    ];
    const r = rankTrades(trades, byNumber);
    expect(r.hidden).toEqual({ byBenefit: 4, byMarket: 1, byChance: 0 });
    expect(r.qualifying).toBe(2);
    expect(keys(r.trades)).toEqual(["good", "edge"]);
    expect(r.dropped).toEqual({ partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 });
  });

  it("keeps one evaluation per key, the furthest evaluated, whatever the input order", () => {
    const screened = tradeEvaluation({ key: "dup", b: 4, pComplete: 0.5, stage: "screened", sims: 0 });
    const exact = tradeEvaluation({ key: "dup", b: 4, pComplete: 0.5, stage: "exact", sims: 1000 });
    const final = tradeEvaluation({ key: "dup", b: 4, pComplete: 0.5, stage: "final", sims: 5000 });
    const finalLower = tradeEvaluation({ key: "dup", b: 2, pComplete: 0.5, stage: "final", sims: 5000 });
    for (const input of [[screened, exact, final], [final, exact, screened], [exact, final, screened]]) {
      const r = rankTrades(input, byNumber);
      expect(r.trades).toHaveLength(1);
      expect(r.trades[0]).toBe(final);
    }
    // Equal stage and seasons: the higher EG, then the higher B.
    expect(rankTrades([finalLower, final], byNumber).trades[0]).toBe(final);
    expect(rankTrades([final, finalLower], byNumber).trades[0]).toBe(final);
    // The furthest evaluation wins even when an earlier stage had the higher EG (its numbers are the better estimate).
    const screenedHigh = tradeEvaluation({ key: "dup", b: 9, pComplete: 0.9, stage: "screened", sims: 0 });
    expect(rankTrades([screenedHigh, finalLower], byNumber).trades[0]).toBe(finalLower);
    // sortTrades orders evaluations of one key the same way, whatever the input order.
    expect(sortTrades([screened, final, exact], "overall")).toEqual([final, exact, screened]);
    expect(sortTrades([exact, screened, final], "helps")).toEqual([final, exact, screened]);
  });

  it("skips illegal evaluations and repeated keys without counting them", () => {
    const r = rankTrades(
      [
        tradeEvaluation({ key: "bad", illegal: "Team 7 can have at most 4 QBs.", b: 9 }),
        tradeEvaluation({ key: "ok", b: 3 }),
        tradeEvaluation({ key: "ok", b: 3 }),
      ],
      byNumber,
    );
    expect(keys(r.trades)).toEqual(["ok"]);
    expect(r.hidden).toEqual({ byBenefit: 0, byMarket: 0, byChance: 0 });
    expect(r.dropped).toEqual({ partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 });
  });

  it("handles no trades", () => {
    expect(rankTrades([], byNumber)).toEqual({ trades: [], hidden: { byBenefit: 0, byMarket: 0, byChance: 0 }, qualifying: 0, dropped: { partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 } });
  });
});

describe("rankTrades: diversity rules (§13)", () => {
  it("drops a filler variant: the same partner, a kept trade's assets plus more, B within fillerCutoffFraction × B_kept", () => {
    const f = config.ranking.fillerCutoffFraction;
    const base = tradeEvaluation({ key: "base", b: 5, pComplete: 0.6, give: ["p1"], get: ["p20"] });
    const filler = tradeEvaluation({ key: "filler", b: 5 * (1 + f) - 0.01, pComplete: 0.5, give: ["p1", "p2"], get: ["p20"] }); // EG below base
    const real = tradeEvaluation({ key: "real", b: 5 * (1 + f) + 0.5, pComplete: 0.4, give: ["p1"], get: ["p20", "p3"] }); // +B ≥ cutoff
    // |ΔB| = 0.2 × B: not under it (likelier than base, so not the dominated variant of the next test; EG still below real's).
    const atCutoff = tradeEvaluation({ key: "atCutoff", b: 5 * (1 - f), pComplete: 0.62, give: ["p1"], get: ["p20", "p4"] });
    const r = rankTrades([filler, real, base, atCutoff], valueOf({ p1: 10, p20: 10 }), { ...rankCfg(), perCore: 10 });
    expect(keys(r.trades)).toEqual(["base", "real", "atCutoff"]);
    expect(r.dropped.filler).toBe(1);
  });

  it("⚠️ a bigger variant no more helpful and less likely than its kept smaller trade is filler too, however far its B falls (final review of Phase 4c, finding R5)", () => {
    // Parker's Team 2: Rico Dowdle → Jordan Mason (Helps you 3, 45%) above the same trade plus Kalif Raymond (1, 40%).
    const lean = tradeEvaluation({ key: "lean", b: 0.18, pComplete: 0.45, give: ["p1"], get: ["p20"] });
    const worse = tradeEvaluation({ key: "worse", b: 0.06, pComplete: 0.4, give: ["p1"], get: ["p20", "p3"] });
    const r = rankTrades([lean, worse], byNumber, { ...rankCfg(), perCore: 10 });
    expect(keys(r.trades)).toEqual(["lean"]);
    expect(r.dropped.filler).toBe(1);
    // The same B, less likely: filler. The same chance (and a B 20% or more lower): not this rule (the fixtures of the other
    // rules lean on it). A likelier one (a sweetener, ranked below) stays; so does a more helpful one.
    expect(keys(rankTrades([lean, { ...worse, b: 0.18, key: "same" }], byNumber, { ...rankCfg(), perCore: 10 }).trades)).toEqual(["lean"]);
    expect(keys(rankTrades([lean, { ...worse, pComplete: 0.45, key: "even" }], byNumber, { ...rankCfg(), perCore: 10 }).trades)).toEqual(["lean", "even"]);
    expect(keys(rankTrades([lean, { ...worse, pComplete: 0.5, key: "likelier" }], byNumber, { ...rankCfg(), perCore: 10 }).trades)).toEqual(["lean", "likelier"]);
    expect(keys(rankTrades([lean, { ...worse, b: 0.5, pComplete: 0.1, key: "helps" }], byNumber, { ...rankCfg(), perCore: 10 }).trades)).toEqual(["lean", "helps"]);
  });

  it("a filler needs the same partner, a proper subset, and a variant ranked below its smaller trade", () => {
    const base = tradeEvaluation({ key: "base", partnerId: "7", b: 5, pComplete: 0.6, give: ["p1"], get: ["p20"] });
    const otherPartner = tradeEvaluation({ key: "other", partnerId: "8", b: 5.1, pComplete: 0.5, give: ["p1", "p2"], get: ["p20"] });
    const notSubset = tradeEvaluation({ key: "swap", partnerId: "7", b: 5.1, pComplete: 0.5, give: ["p2", "p5"], get: ["p20"] });
    const sameAssetsOtherSide = tradeEvaluation({ key: "side", partnerId: "7", b: 5.1, pComplete: 0.5, give: ["p20"], get: ["p1", "p6"] });
    const r = rankTrades([base, otherPartner, notSubset, sameAssetsOtherSide], byNumber, { ...rankCfg(), perCore: 10 });
    expect(r.dropped.filler).toBe(0);
    expect(r.trades).toHaveLength(4);
    // The bigger variant ranked first: the smaller trade isn't a filler of it, and both stay.
    const big = tradeEvaluation({ key: "big", b: 5.2, pComplete: 0.7, give: ["p1", "p2"], get: ["p20"] });
    const small = tradeEvaluation({ key: "small", b: 5, pComplete: 0.6, give: ["p1"], get: ["p20"] });
    expect(keys(rankTrades([small, big], byNumber).trades)).toEqual(["big", "small"]);
  });

  it("keeps at most perCore trades sharing a core: the highest-value asset on each side", () => {
    const value = valueOf({ star: 9000, mine: 7000, f1: 100, f2: 200, f3: 300 });
    const t1 = tradeEvaluation({ key: "t1", b: 9, pComplete: 0.5, give: ["mine"], get: ["star"] });
    const t2 = tradeEvaluation({ key: "t2", b: 6, pComplete: 0.5, give: ["mine", "f1"], get: ["star", "f2"] });
    const t3 = tradeEvaluation({ key: "t3", b: 4, pComplete: 0.5, give: ["mine"], get: ["star", "f3"] }); // same core: third
    const t4 = tradeEvaluation({ key: "t4", b: 3, pComplete: 0.5, give: ["f1"], get: ["star"] }); // another core
    const r = rankTrades([t1, t2, t3, t4], value);
    expect(config.ranking.perCore).toBe(2);
    expect(keys(r.trades)).toEqual(["t1", "t2", "t4"]);
    expect(r.dropped).toEqual({ partnerCap: 0, core: 1, filler: 0, givenPlayer: 0 });
  });

  it("breaks core value ties (and unknown values) by the smaller asset id", () => {
    const value = (a: TradeAsset) => (assetId(a) === "zz" ? Number.NaN : 500);
    // Cores: give side "a1" (a1 < b1, equal value), get side "c1" (c1 < zz; zz unknown).
    const t1 = tradeEvaluation({ key: "t1", b: 9, give: ["b1", "a1"], get: ["c1"] });
    const t2 = tradeEvaluation({ key: "t2", b: 8, give: ["a1"], get: ["zz", "c1"] });
    const t3 = tradeEvaluation({ key: "t3", b: 7, give: ["a1", "x9"], get: ["c1", "zz"] });
    const r = rankTrades([t1, t2, t3], value, { ...rankCfg(), fillerCutoffFraction: 0 });
    expect(keys(r.trades)).toEqual(["t1", "t2"]);
    expect(r.dropped.core).toBe(1);
  });

  it("keeps at most perPartnerInTop20 trades per partner within the first 20 kept, and more after that", () => {
    const cap = config.ranking.perPartnerInTop20;
    expect(cap).toBe(3);
    expect(config.ranking.partnerCapTop).toBe(20);
    const trades: TradeEvaluation[] = [];
    // Partner 7: five trades at the top; then 25 trades with seven other partners (10–16), in turn.
    for (let i = 0; i < 5; i++) trades.push(tradeEvaluation({ key: `hot${i}`, partnerId: "7", b: 50 - i, pComplete: 0.5, give: [`p${100 + i}`], get: [`p${200 + i}`] }));
    for (let i = 0; i < 25; i++) trades.push(tradeEvaluation({ key: `o${String(i).padStart(2, "0")}`, partnerId: String(10 + (i % 7)), b: 40 - i, pComplete: 0.5, give: [`p${300 + i}`], get: [`p${400 + i}`] }));
    const r = rankTrades(trades, byNumber, { ...rankCfg(), resultsShown: 40 });
    const count = (ts: TradeEvaluation[], id: string) => ts.filter((t) => t.proposal.partnerId === id).length;
    const top20 = r.trades.slice(0, config.ranking.partnerCapTop);
    // Partner 7's 4th and 5th trades are dropped (they came while fewer than 20 were kept).
    expect(keys(top20).slice(0, 3)).toEqual(["hot0", "hot1", "hot2"]);
    expect(count(r.trades, "7")).toBe(cap);
    expect(r.dropped.partnerCap).toBe(2);
    // Partners 10–12 reach their cap of 3 inside the top 20 (3 + 7 + 7 + 3 = 20) …
    for (const id of ["10", "11", "12", "13", "14", "15", "16"]) expect(count(top20, id)).toBeLessThanOrEqual(cap);
    // … and past the 20th kept trade they get more: every other trade is kept.
    expect(r.trades).toHaveLength(28);
    expect(count(r.trades, "10")).toBe(4);
  });

  it("past the first 20 kept, a partner can have more", () => {
    const trades: TradeEvaluation[] = [];
    // 20 trades with 20 different partners first, then four with partner 7.
    for (let i = 0; i < 20; i++) trades.push(tradeEvaluation({ key: `a${String(i).padStart(2, "0")}`, partnerId: `t${i}`, b: 100 - i, pComplete: 0.5, give: [`p${100 + i}`], get: [`p${200 + i}`] }));
    for (let i = 0; i < 4; i++) trades.push(tradeEvaluation({ key: `z${i}`, partnerId: "7", b: 10 - i, pComplete: 0.5, give: [`p${300 + i}`], get: [`p${400 + i}`] }));
    const r = rankTrades(trades, byNumber);
    expect(r.trades).toHaveLength(24);
    expect(r.trades.filter((t) => t.proposal.partnerId === "7")).toHaveLength(4);
    expect(r.dropped.partnerCap).toBe(0);
  });

  it("the cap counts trades kept, not trades seen: a partner's 4th trade can be kept once one of its earlier ones was dropped", () => {
    const value = valueOf({ star: 9000, mine: 7000 });
    const t = (key: string, b: number, give: string[], get: string[]) => tradeEvaluation({ key, partnerId: "7", b, pComplete: 0.5, give, get });
    const r = rankTrades([t("t1", 9, ["mine"], ["star"]), t("t2", 8, ["mine", "x1"], ["star"]), t("t3", 7, ["mine", "x2"], ["star"]), t("t4", 6, ["y1"], ["y2"]), t("t5", 5, ["y3"], ["y4"])], value, { ...rankCfg(), fillerCutoffFraction: 0 });
    expect(keys(r.trades)).toEqual(["t1", "t2", "t4"]);
    expect(r.dropped).toEqual({ partnerCap: 1, core: 1, filler: 0, givenPlayer: 0 });
  });

  it("counts a trade several rules would drop once, under the first rule (filler, then core, then partner cap)", () => {
    const value = valueOf({ star: 9000, mine: 7000 });
    const base = tradeEvaluation({ key: "base", b: 5, pComplete: 0.6, give: ["mine"], get: ["star"] });
    const second = tradeEvaluation({ key: "second", b: 4.5, pComplete: 0.6, give: ["mine"], get: ["star", "f9"] }); // a filler of base (the core's 2nd)
    const third = tradeEvaluation({ key: "third", b: 5.1, pComplete: 0.5, give: ["mine", "f1"], get: ["star"] }); // a filler of base, and the core's 3rd without fillers
    const r = rankTrades([base, second, third], value, { ...rankCfg(), fillerCutoffFraction: 0.2 });
    expect(keys(r.trades)).toEqual(["base"]);
    expect(r.dropped).toEqual({ partnerCap: 0, core: 0, filler: 2, givenPlayer: 0 });
    const noFiller = rankTrades([base, second, third], value, { ...rankCfg(), fillerCutoffFraction: 0 });
    expect(keys(noFiller.trades)).toEqual(["base", "second"]);
    expect(noFiller.dropped).toEqual({ partnerCap: 0, core: 1, filler: 0, givenPlayer: 0 });
  });

  it("a filler that is also its core's 3rd is counted as a filler, not under the core rule", () => {
    const value = valueOf({ star: 9000, mine: 7000 });
    const base = tradeEvaluation({ key: "base", b: 9, pComplete: 0.5, give: ["mine"], get: ["star"] });
    const other = tradeEvaluation({ key: "other", b: 6, pComplete: 0.5, give: ["mine", "x1"], get: ["star"] }); // same core; |6 − 9| ≥ 0.2 × 9: no filler
    const both = tradeEvaluation({ key: "both", b: 5.5, pComplete: 0.5, give: ["mine", "x1", "x2"], get: ["star"] }); // a filler of "other" AND the core's 3rd
    const r = rankTrades([both, other, base], value);
    expect(keys(r.trades)).toEqual(["base", "other"]);
    expect(r.dropped).toEqual({ partnerCap: 0, core: 0, filler: 1, givenPlayer: 0 });
  });

  it("a core's 3rd that would also break the partner cap is counted under the core rule", () => {
    const value = valueOf({ star: 9000, mine: 7000 });
    const t = (key: string, b: number, give: string[], get: string[]) => tradeEvaluation({ key, partnerId: "7", b, pComplete: 0.5, give, get });
    // Partner 7 keeps three (two on one core, one elsewhere); the 4th is the core's 3rd and the partner's 4th in the top 20.
    const r = rankTrades([t("a", 9, ["mine"], ["star"]), t("b", 8, ["mine", "x1"], ["star", "y1"]), t("c", 7, ["z1"], ["z2"]), t("d", 6, ["mine", "x2"], ["star", "y2"])], value, { ...rankCfg(), fillerCutoffFraction: 0 });
    expect(keys(r.trades)).toEqual(["a", "b", "c"]);
    expect(r.dropped).toEqual({ partnerCap: 0, core: 1, filler: 0, givenPlayer: 0 });
  });

  it("a filler that would also break the partner cap is counted as a filler", () => {
    const t = (key: string, b: number, give: string[], get: string[], pComplete = 0.5) => tradeEvaluation({ key, partnerId: "7", b, pComplete, give, get });
    // "d" ranks last (EG 2.67): partner 7 already has three kept, and "d" is "a" plus a filler (|8.9 − 9| < 0.2 × 9).
    const r = rankTrades([t("a", 9, ["p1"], ["p2"]), t("b", 8, ["p3"], ["p4"]), t("c", 7, ["p5"], ["p6"]), t("d", 8.9, ["p1", "p7"], ["p2"], 0.3)], byNumber);
    expect(keys(r.trades)).toEqual(["a", "b", "c"]);
    expect(r.dropped).toEqual({ partnerCap: 0, core: 0, filler: 1, givenPlayer: 0 });
  });

  it("stops at resultsShown kept; the rest are neither kept nor counted", () => {
    const trades = Array.from({ length: 40 }, (_, i) => tradeEvaluation({ key: `k${String(i).padStart(2, "0")}`, partnerId: `t${i}`, b: 50 - i, pComplete: 0.5, give: [`p${100 + i}`], get: [`p${200 + i}`] }));
    const r = rankTrades(trades, byNumber);
    expect(r.trades).toHaveLength(config.search.resultsShown);
    expect(keys(r.trades)).toEqual(keys(trades).slice(0, config.search.resultsShown));
    expect(r.dropped).toEqual({ partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 });
  });

  it("is deterministic: the same output for any input order", () => {
    const trades: TradeEvaluation[] = [];
    for (let i = 0; i < 60; i++) {
      const partner = String(1 + (i % 6));
      const give = [`p${i % 7}`, ...(i % 3 === 0 ? [`p${10 + (i % 5)}`] : [])];
      const get = [`p${20 + (i % 9)}`, ...(i % 4 === 0 ? [`p${40 + (i % 3)}`] : [])];
      trades.push(tradeEvaluation({ key: `r${i}`, partnerId: partner, b: ((i * 37) % 23) - 3, pComplete: 0.1 + ((i * 13) % 17) / 20, gMine: ((i * 7) % 11) / 10 - 0.6, give, get }));
    }
    const first = rankTrades(trades, byNumber);
    expect(first.trades.length).toBeGreaterThan(0);
    for (let s = 1; s <= 8; s++) {
      const again = rankTrades(shuffle(trades, s), byNumber);
      expect(keys(again.trades)).toEqual(keys(first.trades));
      expect(again.hidden).toEqual(first.hidden);
      expect(again.dropped).toEqual(first.dropped);
    }
    // The kept trades are in Overall order.
    expect(keys(sortTrades(first.trades, "overall"))).toEqual(keys(first.trades));
  });

  it("names picks by season, round and original team (cores and fillers)", () => {
    expect(assetId({ kind: "pick", season: 2027, round: 1, originalTeamId: "7" })).toBe("pick:2027:1:7");
    expect(assetId({ kind: "player", id: "4046" })).toBe("4046");
  });
});

describe("rankTrades: the given-player cap (planner reply to Checkpoint 4, answer 7)", () => {
  /** A trade with its own partner (no partner cap) and its own players of theirs (no core or filler rule), giving `give`. */
  const t = (key: string, b: number, give: string[], partnerId = `t-${key}`) => tradeEvaluation({ key, partnerId, b, pComplete: 0.5, give, get: [`g-${key}`] });

  it("keeps at most perGivenPlayerInTop20 trades in the top 20 that give the same player of mine", () => {
    const cap = config.ranking.perGivenPlayerInTop20;
    expect(cap).toBe(3);
    // Five trades give "wilson" (the live Checkpoint 4 list sold one player in 15 of 22), then two that don't.
    const trades = [...[0, 1, 2, 3, 4].map((i) => t(`w${i}`, 50 - i, ["wilson"])), t("x1", 40, ["nix"]), t("x2", 39, ["kyren"])];
    const r = rankTrades(trades, byNumber);
    expect(keys(r.trades)).toEqual(["w0", "w1", "w2", "x1", "x2"]);
    expect(r.dropped).toEqual({ partnerCap: 0, core: 0, filler: 0, givenPlayer: 2 });
  });

  it("counts every player of mine a trade gives: a 2-for-1 with a capped player is dropped, and counts for both when kept", () => {
    const trades = [t("a", 50, ["wilson", "nix"]), t("b", 49, ["wilson"]), t("c", 48, ["nix", "kyren"]), t("d", 47, ["wilson"]), t("e", 46, ["nix"]), t("f", 45, ["kyren"])];
    const r = rankTrades(trades, byNumber, { ...rankCfg(), perGivenPlayerInTop20: 2 });
    // a: wilson 1, nix 1; b: wilson 2; c: nix 2, kyren 1; d: wilson over the cap; e: nix over the cap; f: kyren 2.
    expect(keys(r.trades)).toEqual(["a", "b", "c", "f"]);
    expect(r.dropped.givenPlayer).toBe(2);
    // A pick of mine isn't a player: it never counts.
    const pick = { kind: "pick" as const, season: 2027, round: 1, originalTeamId: "3" };
    const withPicks = [0, 1, 2, 3].map((i) => tradeEvaluation({ key: `p${i}`, partnerId: `t${i}`, b: 30 - i, pComplete: 0.5, proposal: { partnerId: `t${i}`, give: [pick], get: [{ kind: "player", id: `g${i}` }] } }));
    expect(rankTrades(withPicks, byNumber).dropped.givenPlayer).toBe(0);
  });

  it("past the first 20 kept, a player may be given in more; the partner cap is counted first", () => {
    // 20 trades with 20 different players of mine first, then four that give "wilson".
    const trades = [...Array.from({ length: 20 }, (_, i) => t(`a${String(i).padStart(2, "0")}`, 100 - i, [`m${i}`])), ...[0, 1, 2, 3].map((i) => t(`w${i}`, 10 - i, ["wilson"]))];
    const r = rankTrades(trades, byNumber);
    expect(r.trades.filter((x) => x.proposal.give.some((a) => a.kind === "player" && a.id === "wilson"))).toHaveLength(4);
    expect(r.dropped.givenPlayer).toBe(0);
    // A partner's 4th trade in the top 20 that is also a player's 4th: counted under the partner cap (rule c before d).
    const same = [0, 1, 2, 3].map((i) => t(`s${i}`, 20 - i, ["wilson"], "7"));
    expect(rankTrades(same, byNumber).dropped).toEqual({ partnerCap: 1, core: 0, filler: 0, givenPlayer: 0 });
  });

  it("a config without the key gets config's cap (a RankConfig built before Phase 4b); Infinity turns it off", () => {
    const trades = [0, 1, 2, 3].map((i) => t(`w${i}`, 50 - i, ["wilson"]));
    const { perGivenPlayerInTop20: _cap, ...old } = rankCfg();
    void _cap;
    expect(rankTrades(trades, byNumber, old).trades).toHaveLength(config.ranking.perGivenPlayerInTop20);
    expect(rankTrades(trades, byNumber, { ...rankCfg(), perGivenPlayerInTop20: Number.POSITIVE_INFINITY }).trades).toHaveLength(4);
  });

  it("⚠️ never counts or checks the exempt players (my must-include players, in every trade); my others still count", () => {
    // Five trades give "wilson" alone, then four give him with "nix" (review of track SR, finding 1: a must-include
    // Wilson cut the list to 3 cards).
    const trades = [...[0, 1, 2, 3, 4].map((i) => t(`w${i}`, 50 - i, ["wilson"])), ...[0, 1, 2, 3].map((i) => t(`n${i}`, 40 - i, ["wilson", "nix"]))];
    const capped = rankTrades(trades, byNumber);
    expect(keys(capped.trades)).toEqual(["w0", "w1", "w2"]);
    expect(capped.dropped.givenPlayer).toBe(6);
    const exempt = rankTrades(trades, byNumber, rankCfg(), { givenCapExempt: ["wilson"] });
    // Every "wilson" trade alone is kept; "nix" (not exempt) is held to the cap.
    expect(keys(exempt.trades)).toEqual(["w0", "w1", "w2", "w3", "w4", "n0", "n1", "n2"]);
    expect(exempt.dropped).toEqual({ partnerCap: 0, core: 0, filler: 0, givenPlayer: 1 });
    // The other rules still apply to them: four trades with one partner keep three in the top 20.
    const onePartner = [0, 1, 2, 3].map((i) => t(`p${i}`, 30 - i, ["wilson"], "7"));
    expect(rankTrades(onePartner, byNumber, rankCfg(), { givenCapExempt: ["wilson"] }).dropped).toEqual({ partnerCap: 1, core: 0, filler: 0, givenPlayer: 0 });
    // An empty list exempts nobody.
    expect(rankTrades(trades, byNumber, rankCfg(), { givenCapExempt: [] })).toEqual(capped);
  });
});

describe("rankTrades: the minimum chance (planner reply to Checkpoint 4b, change 10)", () => {
  const t = (key: string, b: number, pComplete: number, o: Parameters<typeof tradeEvaluation>[0] = {}) => tradeEvaluation({ key, partnerId: `t-${key}`, b, pComplete, give: [`m-${key}`], get: [`g-${key}`], ...o });
  const trades = [
    t("a", 5, 0.5),
    t("b", 9, 0.07), // a long shot (printed 5%) that would rank second (EG 0.63)
    t("c", 3, 0.1), // exactly at the bar
    t("d", 2, 0.3),
    t("hurts", -1, 0.05), // hidden by benefit first
    t("lopsided", 6, 0.05, { gMine: config.benefit.marketHideBelow - 0.05 }), // hidden by the market guard first
  ];

  it("counts trades under it as byChance (only those the guards keep) and never shows them; qualifying = what's left", () => {
    const r = rankTrades(trades, byNumber, rankCfg(), { minChance: 0.1 });
    expect(keys(r.trades)).toEqual(["a", "d", "c"]); // Overall order: EG 2.5, 0.6, 0.3
    expect(r.hidden).toEqual({ byBenefit: 1, byMarket: 1, byChance: 1 });
    expect(r.qualifying).toBe(3);
    const r30 = rankTrades(trades, byNumber, rankCfg(), { minChance: 0.3 });
    expect(keys(r30.trades)).toEqual(["a", "d"]);
    expect(r30.hidden.byChance).toBe(2);
    expect(r30.qualifying).toBe(2);
  });

  it("0 (Any) or no minimum removes nothing", () => {
    for (const r of [rankTrades(trades, byNumber, rankCfg(), { minChance: 0 }), rankTrades(trades, byNumber, rankCfg(), {}), rankTrades(trades, byNumber)]) {
      expect(keys(r.trades)).toEqual(["a", "b", "d", "c"]);
      expect(r.hidden).toEqual({ byBenefit: 1, byMarket: 1, byChance: 0 });
      expect(r.qualifying).toBe(4);
    }
  });

  it("is applied before the diversity rules, so the list fills with trades that qualify", () => {
    // Partner 7: three long shots at the top, then three that qualify; the partner cap keeps 3 in the top 20.
    const p7 = (key: string, b: number, pComplete: number) => tradeEvaluation({ key, partnerId: "7", b, pComplete, give: [`m-${key}`], get: [`g-${key}`] });
    const list = [p7("l1", 40, 0.05), p7("l2", 30, 0.06), p7("l3", 30, 0.06), p7("q1", 5, 0.3), p7("q2", 4, 0.3), p7("q3", 3, 0.35)];
    const none = rankTrades(list, byNumber);
    expect(keys(none.trades)).toEqual(["l1", "l2", "l3"]);
    expect(none.dropped.partnerCap).toBe(3);
    const filtered = rankTrades(list, byNumber, rankCfg(), { minChance: 0.1 });
    expect(keys(filtered.trades)).toEqual(["q1", "q2", "q3"]);
    expect(filtered.dropped.partnerCap).toBe(0);
    expect(filtered.hidden.byChance).toBe(3);
  });

  it("⚠️ judged on P_complete as the card prints it (the nearest 5%; review of track SR, finding 3)", () => {
    // 7.5% prints "10%" and meets "at least 10%"; 7.49% prints "5%" and doesn't.
    expect(meetsMinChance(0.1, 0.1)).toBe(true);
    expect(meetsMinChance(0.075, 0.1)).toBe(true);
    expect(meetsMinChance(0.0749, 0.1)).toBe(false);
    expect(meetsMinChance(0.175, 0.2)).toBe(true);
    expect(meetsMinChance(0.1749, 0.2)).toBe(false);
    expect(meetsMinChance(0.475, 0.5)).toBe(true);
    // A positive chance prints at least 5%, never enough for 10%.
    expect(meetsMinChance(0.02, 0.1)).toBe(false);
    expect(meetsMinChance(Number.NaN, 0.1)).toBe(false);
    expect(meetsMinChance(Number.NaN, 0)).toBe(true);
    expect(meetsMinChance(0.01, undefined)).toBe(true);
    // The same rule as the card's printed number, for every option and every chance on a fine grid.
    for (const m of config.ranking.minChanceOptions) {
      for (let i = 0; i <= 1000; i++) {
        const p = i / 1000;
        expect(meetsMinChance(p, m), `${p} at ${m}`).toBe(!(m > 0) || displayAcceptance(p) >= m - 1e-9);
      }
    }
    // In the ranking: a trade at 8% (printed 10%) is shown under "at least 10%", one at 7% (printed 5%) isn't.
    const r = rankTrades([t("p8", 4, 0.08), t("p7", 4, 0.07)], byNumber, rankCfg(), { minChance: 0.1 });
    expect(keys(r.trades)).toEqual(["p8"]);
    expect(r.hidden.byChance).toBe(1);
  });

  it("float noise at the bar counts as at it; the input order never matters", () => {
    expect(meetsMinChance(0.075 - 1e-12, 0.1)).toBe(true);
    expect(meetsMinChance(0.1 - 1e-12, 0.1)).toBe(true);
    const first = rankTrades(trades, byNumber, rankCfg(), { minChance: 0.1 });
    for (let s = 1; s <= 4; s++) {
      const again = rankTrades(shuffle(trades, s), byNumber, rankCfg(), { minChance: 0.1 });
      expect(keys(again.trades)).toEqual(keys(first.trades));
      expect(again.hidden).toEqual(first.hidden);
      expect(again.qualifying).toBe(first.qualifying);
    }
  });
});

describe("trades shown elsewhere (Checkpoint 7f, merged cards: RankOptions.shownElsewhere; compareOverall)", () => {
  // A trade folded into another card's "How to offer it": a filler reference only.
  const folded = tradeEvaluation({ key: "folded", partnerId: "7", b: 5, pComplete: 0.6, give: ["p1"], get: ["p20"] });

  it("a variant of one that only adds a filler player leaves as filler, as it would beside the card it was", () => {
    const f = config.ranking.fillerCutoffFraction;
    const filler = tradeEvaluation({ key: "filler", partnerId: "7", b: 5 * (1 + f) - 0.01, pComplete: 0.5, give: ["p1", "p2"], get: ["p20"] });
    const other = tradeEvaluation({ key: "other", partnerId: "8", b: 2, pComplete: 0.5, give: ["p3"], get: ["p30"] });
    const r = rankTrades([filler, other], byNumber, { ...rankCfg(), perCore: 10 }, { shownElsewhere: [folded] });
    expect(keys(r.trades)).toEqual(["other"]);
    expect(r.dropped.filler).toBe(1);
    expect(r.qualifying).toBe(2);
    // Without it the variant shows; a bigger variant ranked above the folded trade is no filler of it (rule a).
    expect(keys(rankTrades([filler, other], byNumber, { ...rankCfg(), perCore: 10 }).trades)).toEqual(["filler", "other"]);
    const ahead = { ...filler, key: "ahead", b: 5.5, pComplete: 0.7 };
    expect(keys(rankTrades([ahead, other], byNumber, { ...rankCfg(), perCore: 10 }, { shownElsewhere: [folded] }).trades)).toEqual(["ahead", "other"]);
  });

  it("they take no place and count for no cap: the partner's, the core's, the given player's and the list's length", () => {
    // Partner 7, my player p1 and (x) the core p1|p20: the folded trade has all three, and three trades share them (x is the
    // folded trade plus p9 but no filler of it: likelier, and B 20% lower).
    const same = (key: string, b: number, pComplete: number, get: string[]) => tradeEvaluation({ key, partnerId: "7", b, pComplete, give: ["p1"], get });
    const list = [same("x", 4, 0.7, ["p20", "p9"]), same("y", 3.5, 0.5, ["p21"]), same("z", 3, 0.5, ["p22"])];
    const cfg = { ...rankCfg(), perCore: 1, perPartnerInTop20: 3, perGivenPlayerInTop20: 3 };
    const r = rankTrades(list, byNumber, cfg, { shownElsewhere: [folded] });
    expect(keys(r.trades)).toEqual(["x", "y", "z"]);
    expect(r.dropped).toEqual({ partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 });
    // Room for two: the folded trade takes none of it.
    expect(keys(rankTrades(list, byNumber, { ...cfg, resultsShown: 2 }, { shownElsewhere: [folded] }).trades)).toEqual(["x", "y"]);
  });

  it("one that isn't legal or has no known B is ignored; the input order never matters; in Helps-you order the same pairs are filler", () => {
    const filler = tradeEvaluation({ key: "filler", partnerId: "7", b: 5.5, pComplete: 0.5, give: ["p1", "p2"], get: ["p20"] });
    for (const x of [{ ...folded, illegal: "no" }, { ...folded, b: null }, { ...folded, b: Number.NaN }]) {
      expect(keys(rankTrades([filler], byNumber, rankCfg(), { shownElsewhere: [x] }).trades)).toEqual(["filler"]);
    }
    const r = rankTrades([filler], byNumber, rankCfg(), { shownElsewhere: [folded], order: "helps" });
    expect(keys(r.trades)).toEqual([]);
    expect(r.dropped.filler).toBe(1);
    const other = tradeEvaluation({ key: "other", partnerId: "8", b: 2, pComplete: 0.5, give: ["p3"], get: ["p30"] });
    const first = rankTrades([filler, other], byNumber, rankCfg(), { shownElsewhere: [folded, other] });
    for (let s = 1; s <= 3; s++) expect(rankTrades(shuffle([filler, other], s), byNumber, rankCfg(), { shownElsewhere: shuffle([folded, other], s) })).toEqual(first);
  });

  it("compareOverall is the Overall order: EG highest first, then the key", () => {
    const a = tradeEvaluation({ key: "a", b: 4, pComplete: 0.5 }); // EG 2
    const b = tradeEvaluation({ key: "b", b: 8, pComplete: 0.2 }); // EG 1.6
    const c = tradeEvaluation({ key: "c", b: 2, pComplete: 1 }); // EG 2
    expect([b, c, a].sort(compareOverall).map((t) => t.key)).toEqual(keys(sortTrades([b, c, a], "overall")));
    expect(compareOverall(a, b)).toBeLessThan(0);
    expect(compareOverall(a, c)).toBeLessThan(0);
    expect(compareOverall(c, a)).toBeGreaterThan(0);
  });
});

describe("the “Helps both” list (Checkpoint 7c; planner reply to Checkpoint 7b, §7): RankOptions.order “helps” and keep, the sort, helpsBothTrades", () => {
  /** A trade with a Helps them as printed (TradeEvaluation.them; the other numbers made up, what helpsBoth doesn't read). */
  const withThem = (e: TradeEvaluation, helps: number | null): TradeEvaluation => ({
    ...e,
    them: { b: helps === null ? null : helps / 10, bWin: helps === null ? null : helps / 10, bFuture: null, lambda: null, b3: 4, helps, dPO: 0.01, dCH: 0.005, dPrizes: titleDeltas(0.005), before: { pPlayoffs: 0.4, pTitle: 0.05, prizes: { first: 0.05, second: null, third: null, weeklyHigh: 0, pointsLeader: 0 } } },
  });
  const t = (key: string, b: number, pComplete: number, helps: number | null, o: Parameters<typeof tradeEvaluation>[0] = {}) =>
    withThem(tradeEvaluation({ key, partnerId: `t-${key}`, b, pComplete, give: [`m-${key}`], get: [`g-${key}`], ...o }), helps);
  const keep = (e: TradeEvaluation) => helpsBoth(e);
  const trades = [
    t("a", 5, 0.5, 30), // EG 2.5: helps both
    t("b", 9, 0.2, 12), // EG 1.8, the most B: helps both
    t("c", 6, 0.4, 9), // EG 2.4: Helps them under 10
    t("d", 3, 0.3, 0), // a loss for them
    t("e", 4, 0.05, 40), // helps both, a long shot (printed 5%)
    t("f", 2, 0.6, null), // not simulated for them
    t("hurts", -1, 0.5, 50), // hidden by benefit first
    t("lopsided", 7, 0.5, 50, { gMine: config.benefit.marketHideBelow - 0.05 }), // hidden by the market guard first
  ];

  it("keep: the guards first, then the trades it turns away (notKept), then the minimum chance on what it keeps; Helps-you order", () => {
    const r = rankTrades(trades, byNumber, rankCfg(), { order: "helps", keep, minChance: 0.1 });
    expect(keys(r.trades)).toEqual(["b", "a"]); // B 9, 5
    expect(r.hidden).toEqual({ byBenefit: 1, byMarket: 1, byChance: 1 });
    expect(r.notKept).toBe(3); // c (9 for them), d (0), f (no Helps them)
    expect(r.qualifying).toBe(2);
    // At Any the long shot shows, in its B place.
    expect(keys(rankTrades(trades, byNumber, rankCfg(), { order: "helps", keep }).trades)).toEqual(["b", "a", "e"]);
    // Without keep: no notKept field, and the list as before (Overall order by default).
    const plain = rankTrades(trades, byNumber, rankCfg(), { minChance: 0.1 });
    expect("notKept" in plain).toBe(false);
    expect(keys(plain.trades)).toEqual(["a", "c", "b", "f", "d"]); // EG 2.5, 2.4, 1.8, 1.2, 0.9
    expect(keys(rankTrades(trades, byNumber, rankCfg(), { minChance: 0.1, order: "helps" }).trades)).toEqual(["b", "c", "a", "d", "f"]);
  });

  it("the diversity rules go through the trades in Helps-you order: the partner cap keeps the three that help me most", () => {
    // One partner, five trades that help both: by EG a, b, c lead; by B e, d, c.
    const p7 = (key: string, b: number, pComplete: number) => withThem(tradeEvaluation({ key, partnerId: "7", b, pComplete, give: [`m-${key}`], get: [`g-${key}`] }), 20);
    const list = [p7("a", 3, 0.8), p7("b", 3.5, 0.6), p7("c", 4, 0.5), p7("d", 5, 0.3), p7("e", 6, 0.2)];
    const byHelps = rankTrades(list, byNumber, rankCfg(), { order: "helps", keep });
    expect(keys(byHelps.trades)).toEqual(["e", "d", "c"]);
    expect(byHelps.dropped.partnerCap).toBe(2);
    expect(keys(rankTrades(list, byNumber, rankCfg(), { keep }).trades)).toEqual(["a", "b", "c"]);
  });

  it("the input order never matters", () => {
    const first = rankTrades(trades, byNumber, rankCfg(), { order: "helps", keep, minChance: 0.1 });
    for (let s = 1; s <= 4; s++) expect(rankTrades(shuffle(trades, s), byNumber, rankCfg(), { order: "helps", keep, minChance: 0.1 })).toEqual(first);
  });

  describe("⚠️ the filler rule judges each pair as the Overall order does (review of the “Helps both” engine track, finding HB-3)", () => {
    /** A trade with partner `partnerId` that helps both teams (Helps them 20). */
    const hb = (key: string, partnerId: string, b: number, pComplete: number, give: string[], get: string[]) => withThem(tradeEvaluation({ key, partnerId, b, pComplete, give, get }), 20);
    // Parker's Team 8 under his prizes: Puka Nacua + Marvin Harrison Jr. → Drake London + Christian Watson (B 1.454 at 24.7%)
    // ahead by B of Puka Nacua → Drake London + Christian Watson (B 1.440 at 27.2%), which is ahead on EG.
    const big = hb("big", "8", 1.454, 0.247, ["p1", "p2"], ["p20", "p21"]);
    const small = hb("small", "8", 1.44, 0.272, ["p1"], ["p20", "p21"]);
    const next = hb("next", "6", 0.9, 0.4, ["p3"], ["p30"]);

    it("a bigger variant first by B but below its smaller trade on EG, B within 20%: filler, as in Overall order; its place goes to the next trade", () => {
      const r = rankTrades([big, small, next], byNumber, rankCfg(), { order: "helps", keep });
      expect(keys(r.trades)).toEqual(["small", "next"]);
      expect(r.dropped).toEqual({ partnerCap: 0, core: 0, filler: 1, givenPlayer: 0 });
      expect(r.qualifying).toBe(3);
      // The same verdict in Overall order (the smaller trade first there).
      const overall = rankTrades([big, small, next], byNumber, rankCfg(), { keep });
      expect(keys(overall.trades)).toEqual(["small", "next"]);
      expect(overall.dropped.filler).toBe(1);
      // Room for two cards: the bigger variant took a place in the first pass and gives it back to the next trade.
      expect(keys(rankTrades([big, small, next], byNumber, { ...rankCfg(), resultsShown: 2 }, { order: "helps", keep }).trades)).toEqual(["small", "next"]);
      for (let s = 1; s <= 4; s++) expect(rankTrades(shuffle([big, small, next], s), byNumber, rankCfg(), { order: "helps", keep })).toEqual(r);
    });

    it("a bigger variant ahead on EG is no filler, in either order: both cards stay (also the likelier one with a slightly lower B)", () => {
      const ahead = hb("ahead", "8", 1.5, 0.3, ["p1", "p2"], ["p20", "p21"]); // EG 0.45 against 0.392
      expect(keys(rankTrades([small, ahead], byNumber, rankCfg(), { order: "helps", keep }).trades)).toEqual(["ahead", "small"]);
      expect(keys(rankTrades([small, ahead], byNumber, rankCfg(), { keep }).trades)).toEqual(["ahead", "small"]);
      // B 1.9 at 30% beside B 2.0 at 20%: within 20% of B but ahead on EG (0.57 against 0.4). In Helps-you order the smaller
      // trade comes first, and before this rule the greedy pass dropped the likelier variant as filler.
      const lean = hb("lean", "5", 2.0, 0.2, ["p4"], ["p40"]);
      const sweetened = hb("sweetened", "5", 1.9, 0.3, ["p4", "p5"], ["p40"]);
      expect(keys(rankTrades([lean, sweetened], byNumber, rankCfg(), { order: "helps", keep }).trades)).toEqual(["lean", "sweetened"]);
      expect(keys(rankTrades([lean, sweetened], byNumber, rankCfg(), { keep }).trades)).toEqual(["sweetened", "lean"]);
    });

    it("R5 in Helps-you order: a bigger variant no more helpful and less likely is filler however far its B falls", () => {
      // B 0.8 still prints Helps you 10 or more (it helps both under Checkpoint 7d's bar), far outside 20% of small's 1.44.
      const worse = hb("worse", "8", 0.8, 0.25, ["p1", "p2"], ["p20", "p21"]);
      const r = rankTrades([worse, small], byNumber, rankCfg(), { order: "helps", keep });
      expect(keys(r.trades)).toEqual(["small"]);
      expect(r.dropped.filler).toBe(1);
    });

    it("a bigger variant whose smaller trade the other rules leave out stays (the card the list can show of the two)", () => {
      // One partner, cap 3 in the top 20: by B, b, x, y fill the partner's places and s (b without p2, ahead on EG) is capped.
      const b = hb("b", "7", 5.0, 0.1, ["p1", "p2"], ["p20"]);
      const x = hb("x", "7", 4.9, 0.2, ["p3"], ["p21"]);
      const y = hb("y", "7", 4.8, 0.2, ["p4"], ["p22"]);
      const s = hb("s", "7", 4.6, 0.3, ["p1"], ["p20"]);
      const r = rankTrades([s, y, x, b], byNumber, rankCfg(), { order: "helps", keep });
      expect(keys(r.trades)).toEqual(["b", "x", "y"]);
      expect(r.dropped).toEqual({ partnerCap: 1, core: 0, filler: 0, givenPlayer: 0 });
    });

    it("a bigger variant that left comes back when its smaller trade then misses the list, and the smaller trade leaves instead (final review of Checkpoint 7c, engine-rank-hb3-late-filler)", () => {
      // Partner P, 3 places in the top 20, 2 trades a core, 3 a player of mine. By B, y and c keep places that d1 (c's core,
      // w|m) and d2 (v's third trade) then miss, and k takes P's third place. c is k plus w and v, B within 20%, below k on
      // EG: filler of k, so c left; ranked again without it, d1 and d2 took its places and k missed P's cap, so neither c nor
      // k showed. Now c comes back and k leaves for good (beside c it would make c filler again).
      const value = valueOf({ w: 900, v: 800, g: 500, y1: 100, x: 100, z: 100, m: 1000, p2: 700, s1: 600, t1: 600, u1: 600 });
      const list = [
        hb("a1", "S", 9, 0.9, ["w"], ["s1"]),
        hb("a2", "T", 8.8, 0.9, ["v"], ["t1"]),
        hb("a3", "U", 8.6, 0.9, ["v"], ["u1"]),
        hb("y", "P", 8, 0.9, ["w", "y1"], ["m"]),
        hb("c", "P", 5.5, 0.3, ["g", "w", "v"], ["m"]),
        hb("d1", "P", 5.4, 0.2, ["w", "x"], ["m"]),
        hb("d2", "P", 5.3, 0.2, ["v", "z"], ["p2"]),
        hb("k", "P", 5.0, 0.5, ["g"], ["m"]),
      ];
      const r = rankTrades(list, value, rankCfg(), { order: "helps", keep });
      expect(keys(r.trades)).toEqual(["a1", "a2", "a3", "y", "c"]);
      expect(r.dropped).toEqual({ partnerCap: 0, core: 1, filler: 1, givenPlayer: 1 }); // d1, k, d2
      for (let s = 1; s <= 4; s++) expect(rankTrades(shuffle(list, s), value, rankCfg(), { order: "helps", keep })).toEqual(r);
      // Overall order as before: k first, c its filler, d1 in c's place and d2 over P's cap.
      const overall = rankTrades(list, value, rankCfg(), { keep });
      expect(keys(overall.trades)).toEqual(["a1", "a2", "a3", "y", "k", "d1"]);
      expect(overall.dropped).toEqual({ partnerCap: 1, core: 0, filler: 1, givenPlayer: 0 });
      // The same with 2 players a side (the default): c is k plus w for one more player of P's.
      const two = valueOf({ g: 900, w: 800, n: 1000, m: 600, y1: 100, x: 100, z: 100, p2: 700, t1: 600, u1: 600 });
      const pairs = [
        hb("a2", "T", 8.8, 0.9, ["w"], ["t1"]),
        hb("a3", "U", 8.6, 0.9, ["w"], ["u1"]),
        hb("y", "P", 8, 0.9, ["g", "y1"], ["n"]),
        hb("c", "P", 5.5, 0.3, ["g", "w"], ["m", "n"]),
        hb("d1", "P", 5.4, 0.2, ["g", "x"], ["n"]),
        hb("d2", "P", 5.3, 0.2, ["w", "z"], ["p2"]),
        hb("k", "P", 5.0, 0.5, ["g"], ["m"]),
      ];
      expect(keys(rankTrades(pairs, two, rankCfg(), { order: "helps", keep }).trades)).toEqual(["a2", "a3", "y", "c"]);
      expect(keys(rankTrades(pairs, two, rankCfg(), { keep }).trades)).toEqual(["a2", "a3", "y", "k", "d1"]);
    });
  });

  it("sortTrades “helpsBoth”: the trades that help both first, each group by B; helpsBothTrades keeps those alone", () => {
    const visible = trades.filter((x) => x.key !== "hurts" && x.key !== "lopsided");
    expect(keys(sortTrades(visible, "helpsBoth"))).toEqual(["b", "a", "e", "c", "d", "f"]);
    expect(keys(helpsBothTrades(visible))).toEqual(["b", "a", "e"]);
    // A trade without Helps them (an evaluation made before it) never helps both.
    expect(helpsBothTrades([tradeEvaluation({ key: "old", b: 5 })])).toEqual([]);
    for (let s = 1; s <= 3; s++) expect(keys(sortTrades(shuffle(visible, s), "helpsBoth"))).toEqual(["b", "a", "e", "c", "d", "f"]);
    const input = [...visible];
    expect(helpsBothTrades(input)).not.toBe(input);
    expect(input).toEqual(visible);
  });
});

describe("promoted Last offers (Checkpoint 7h: RankOptions.fillerExempt)", () => {
  // An idea merged into the Last offer promoted from it (its "Open with"): a filler reference, as any merged trade.
  const f = config.ranking.fillerCutoffFraction;
  const original = tradeEvaluation({ key: "original", partnerId: "7", b: 5, pComplete: 0.6, give: ["p1"], get: ["p20"] });
  // The promoted card: the original plus a player of mine whose B stays within the filler cutoff of it, ranked below it here.
  const promoted = tradeEvaluation({ key: "promoted", partnerId: "7", b: 5 * (1 + f) - 0.01, pComplete: 0.5, give: ["p1", "p2"], get: ["p20"] });
  const other = tradeEvaluation({ key: "other", partnerId: "8", b: 2, pComplete: 0.5, give: ["p3"], get: ["p30"] });

  it("a promoted card is never filler of the idea it came from, though any other variant of that idea still is", () => {
    const cfg = { ...rankCfg(), perCore: 10 };
    expect(keys(rankTrades([promoted, other], byNumber, cfg, { shownElsewhere: [original] }).trades)).toEqual(["other"]);
    const exempt = new Map([["promoted", "original"]]);
    const r = rankTrades([promoted, other], byNumber, cfg, { shownElsewhere: [original], fillerExempt: exempt });
    expect(keys(r.trades)).toEqual(["promoted", "other"]);
    expect(r.dropped.filler).toBe(0);
    const another = { ...promoted, key: "another", give: [...promoted.proposal.give] };
    expect(keys(rankTrades([another, other], byNumber, cfg, { shownElsewhere: [original], fillerExempt: exempt }).trades)).toEqual(["other"]);
  });

  it("nor of the idea that one was promoted from in turn (the chain); an empty map is no exemption", () => {
    const cfg = { ...rankCfg(), perCore: 10 };
    const middle = tradeEvaluation({ key: "middle", partnerId: "7", b: 5.2, pComplete: 0.55, give: ["p1", "p4"], get: ["p20"] });
    const newest = tradeEvaluation({ key: "newest", partnerId: "7", b: 5 * (1 + f) - 0.01, pComplete: 0.5, give: ["p1", "p2", "p4"], get: ["p20"] });
    const chain = new Map([
      ["newest", "middle"],
      ["middle", "original"],
    ]);
    expect(keys(rankTrades([newest, other], byNumber, cfg, { shownElsewhere: [original, middle], fillerExempt: chain }).trades)).toEqual(["newest", "other"]);
    // Without the chain's second link the newest is filler of the original again.
    expect(keys(rankTrades([newest, other], byNumber, cfg, { shownElsewhere: [original], fillerExempt: new Map([["newest", "middle"]]) }).trades)).toEqual(["other"]);
    expect(keys(rankTrades([promoted, other], byNumber, cfg, { shownElsewhere: [original], fillerExempt: new Map() }).trades)).toEqual(["other"]);
  });
});

function rankCfg(): RankConfig {
  return {
    perPartnerInTop20: config.ranking.perPartnerInTop20,
    partnerCapTop: config.ranking.partnerCapTop,
    perGivenPlayerInTop20: config.ranking.perGivenPlayerInTop20,
    perCore: config.ranking.perCore,
    fillerCutoffFraction: config.ranking.fillerCutoffFraction,
    resultsShown: config.search.resultsShown,
    marketHideBelow: config.benefit.marketHideBelow,
  };
}
