import { describe, expect, it } from "vitest";
import { config } from "./config";
import { mulberry32 } from "./rng";
import { assetId, rankTrades, sortTrades, type RankConfig } from "./rank";
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
    expect(r.hidden).toEqual({ byBenefit: 4, byMarket: 1 });
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
    expect(r.hidden).toEqual({ byBenefit: 0, byMarket: 0 });
    expect(r.dropped).toEqual({ partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 });
  });

  it("handles no trades", () => {
    expect(rankTrades([], byNumber)).toEqual({ trades: [], hidden: { byBenefit: 0, byMarket: 0 }, dropped: { partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 } });
  });
});

describe("rankTrades: diversity rules (§13)", () => {
  it("drops a filler variant: the same partner, a kept trade's assets plus more, B within fillerCutoffFraction × B_kept", () => {
    const f = config.ranking.fillerCutoffFraction;
    const base = tradeEvaluation({ key: "base", b: 5, pComplete: 0.6, give: ["p1"], get: ["p20"] });
    const filler = tradeEvaluation({ key: "filler", b: 5 * (1 + f) - 0.01, pComplete: 0.5, give: ["p1", "p2"], get: ["p20"] }); // EG below base
    const real = tradeEvaluation({ key: "real", b: 5 * (1 + f) + 0.5, pComplete: 0.4, give: ["p1"], get: ["p20", "p3"] }); // +B ≥ cutoff
    const atCutoff = tradeEvaluation({ key: "atCutoff", b: 5 * (1 - f), pComplete: 0.5, give: ["p1"], get: ["p20", "p4"] }); // |ΔB| = 0.2 × B: not under it
    const r = rankTrades([filler, real, base, atCutoff], valueOf({ p1: 10, p20: 10 }), { ...rankCfg(), perCore: 10 });
    expect(keys(r.trades)).toEqual(["base", "real", "atCutoff"]);
    expect(r.dropped.filler).toBe(1);
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
