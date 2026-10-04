/**
 * The exhaustive candidates (src/engine/search.ts partnerCandidates; planner reply to Checkpoint 4b, change 1: the beams
 * missed two-player packages when neither half helps on its own): with maxPerSide ≥ 2, on top of the beams, every 1-for-2
 * and 2-for-1 from the whole pools and every 2-for-2 from the first twoForTwoTop of each, holding the must-include
 * players, each trade screened once; maxPerSide 1 changes nothing; maxPerSide 3 extends the best two-player trades of the
 * beams and the exhaustive candidates alike. Synthetic league (smallLeague: made-up players, placeholder teams).
 */
import { describe, expect, it } from "vitest";
import { config } from "./config";
import { buildTradeContext, proposalKey, screenTrade, tradeInternals, type TeamState } from "./evaluate";
import { partnerCandidates, runTradeSearch, sidesOf, type PartnerPool } from "./search";
import { defaultTradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { TradeAsset } from "./tradeModel";

const league = smallLeague(11);
const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 0 });
const I = tradeInternals(ctx);
const me = I.me as TeamState;
const partner = I.byId.get("2") as TeamState;
const pos = (id: string) => league.snapshot.players[id]?.pos;
const skill = (t: TeamState) => t.roster.filter((id) => pos(id) !== "K" && pos(id) !== "DEF" && I.league.table.rows.has(id));
const players = (xs: readonly string[]): TradeAsset[] => xs.map((id) => ({ kind: "player", id }));
const keyOf = (give: readonly string[], get: readonly string[]) => proposalKey({ partnerId: partner.id, give: players(give), get: players(get) });

/** Ten a side, so more 1-for-1 seeds (100) than the beams extend (beamSecond 60). */
const pool: PartnerPool = { give: skill(me).slice(0, 10), forcedGive: [], get: skill(partner).slice(0, 10), forcedGet: [] };

function candidates(maxPerSide: number, p: PartnerPool = pool, opts: { exhaustive?: boolean } = {}) {
  const tally = { screened: 0 };
  const it = partnerCandidates(I, partner, p, maxPerSide, tally, opts);
  let r = it.next();
  let yields = 0;
  while (!r.done) {
    yields++;
    r = it.next();
  }
  return { list: r.value, keys: new Set(r.value.map((x) => x.key)), tally, yields };
}

/** Every exhaustive candidate's sides by the rule (the pools' others; the forced players in every one). */
function exhaustiveSides(p: PartnerPool, maxPerSide: number): [string[], string[]][] {
  if (maxPerSide < 2) return [];
  const top = config.search.exhaustive.twoForTwoTop;
  const gOthers = p.give.filter((id) => !p.forcedGive.includes(id));
  const hOthers = p.get.filter((id) => !p.forcedGet.includes(id));
  const out: [string[], string[]][] = [];
  for (const g of sidesOf(p.forcedGive, gOthers, 1)) for (const h of sidesOf(p.forcedGet, hOthers, 2)) out.push([g, h]);
  for (const g of sidesOf(p.forcedGive, gOthers, 2)) for (const h of sidesOf(p.forcedGet, hOthers, 1)) out.push([g, h]);
  for (const g of sidesOf(p.forcedGive, gOthers.slice(0, top), 2)) for (const h of sidesOf(p.forcedGet, hOthers.slice(0, top), 2)) out.push([g, h]);
  return out;
}

describe("sidesOf: every side of a size holding the forced players", () => {
  it("lists the combinations in pool order, the forced players first", () => {
    expect(sidesOf([], ["a", "b", "c"], 1)).toEqual([["a"], ["b"], ["c"]]);
    expect(sidesOf([], ["a", "b", "c"], 2)).toEqual([["a", "b"], ["a", "c"], ["b", "c"]]);
    expect(sidesOf(["f"], ["a", "b"], 2)).toEqual([["f", "a"], ["f", "b"]]);
    expect(sidesOf(["f"], ["a", "b"], 1)).toEqual([["f"]]);
    expect(sidesOf(["f", "g"], ["a"], 1)).toEqual([]);
    expect(sidesOf([], [], 1)).toEqual([]);
  });
});

describe("the exhaustive candidates (planner reply to Checkpoint 4b, change 1)", { timeout: 60_000 }, () => {
  it("config: 2-for-2s from the first 6 of each pool", () => {
    expect(config.search.exhaustive.twoForTwoTop).toBe(6);
    expect(config.search.beamSecond).toBeLessThan(pool.give.length * pool.get.length); // so the beams leave seeds unextended
  });

  it("maxPerSide 2: the beams' candidates plus every legal exhaustive one, nothing else, each screened once", () => {
    const full = candidates(2);
    const beams = candidates(2, pool, { exhaustive: false });
    const wanted = exhaustiveSides(pool, 2);
    expect(wanted.length).toBe(10 * 45 + 45 * 10 + 15 * 15);
    const legal = new Set<string>();
    for (const [g, h] of wanted) {
      const key = keyOf(g, h);
      if (full.keys.has(key)) legal.add(key);
      // A candidate missing from the list is one the roster rules make illegal.
      else expect(screenTrade(I, partner, g, h, key), key).toBeNull();
    }
    expect(legal.size).toBeGreaterThan(0);
    expect(full.keys).toEqual(new Set([...beams.keys, ...legal]));
    expect(full.keys.size).toBe(full.list.length);
    // Each screened once: the tally is the union of what the two ways screened, legal or not (the beams' illegal screens
    // aren't listed, so it lies between the union with their legal ones and that plus their illegal ones).
    const both = new Set([...beams.keys, ...wanted.map(([g, h]) => keyOf(g, h))]);
    expect(full.tally.screened).toBeGreaterThanOrEqual(both.size);
    expect(full.tally.screened).toBeLessThanOrEqual(both.size + (beams.tally.screened - beams.list.length));
    // Every shape at most 2 a side.
    expect(full.list.every((x) => x.give.length <= 2 && x.get.length <= 2)).toBe(true);
  });

  it("finds packages the beams miss: 1-for-2s and 2-for-1s whose 1-for-1 halves aren't among the best beamSecond seeds", () => {
    const full = candidates(2);
    const beams = candidates(2, pool, { exhaustive: false });
    const only = full.list.filter((x) => !beams.keys.has(x.key));
    expect(only.some((x) => x.give.length + x.get.length === 3)).toBe(true); // a fact of the synthetic data
    // Their halves: no seed (1-for-1) inside the trade made the beams' cut.
    const seeds = full.list.filter((x) => x.give.length === 1 && x.get.length === 1).sort((a, b) => b.objective - a.objective || (a.key < b.key ? -1 : 1));
    const extended = new Set(seeds.slice(0, config.search.beamSecond).map((x) => x.key));
    for (const x of only.filter((y) => y.give.length + y.get.length === 3)) {
      for (const g of x.give) for (const h of x.get) expect(extended.has(keyOf([g], [h])), x.key).toBe(false);
    }
  });

  it("maxPerSide 1: nothing changes (only the 1-for-1 seeds)", () => {
    const a = candidates(1);
    const b = candidates(1, pool, { exhaustive: false });
    expect(a.keys).toEqual(b.keys);
    expect(a.tally.screened).toBe(b.tally.screened);
    expect(a.list.every((x) => x.give.length === 1 && x.get.length === 1)).toBe(true);
  });

  it("must-include players: in every candidate, and a 2-for-2's others from the first twoForTwoTop of the others", () => {
    const forced = pool.give[3] as string;
    const p: PartnerPool = { ...pool, forcedGive: [forced] };
    const full = candidates(2, p);
    expect(full.list.length).toBeGreaterThan(0);
    expect(full.list.every((x) => x.give.includes(forced))).toBe(true);
    const wanted = exhaustiveSides(p, 2);
    // 1-for-2: the forced player for every pair of theirs; 2-for-1: him plus each other of mine; 2-for-2: him plus each of
    // the first 6 others, for each pair of their first 6.
    expect(wanted.length).toBe(45 + 9 * 10 + 6 * 15);
    for (const [g, h] of wanted) {
      expect(g).toContain(forced);
      const key = keyOf(g, h);
      if (!full.keys.has(key)) expect(screenTrade(I, partner, g, h, key)).toBeNull();
    }
    // Both sides forced: the core and its completions only.
    const both: PartnerPool = { ...p, forcedGet: [pool.get[0] as string] };
    const fb = candidates(2, both);
    expect(fb.list.every((x) => x.give.includes(forced) && x.get.includes(pool.get[0] as string))).toBe(true);
  });

  it("maxPerSide 3: 3-a-side trades extend two-player ones, never past 3 a side (the base's rule: search.exhaustive3.test.ts)", () => {
    const three = candidates(3);
    const keys = three.keys;
    expect(three.list.some((x) => x.give.length === 3 || x.get.length === 3)).toBe(true);
    expect(three.list.every((x) => x.give.length <= 3 && x.get.length <= 3)).toBe(true);
    // Every exhaustive candidate is there too (legal ones).
    for (const [g, h] of exhaustiveSides(pool, 3)) {
      const key = keyOf(g, h);
      if (!keys.has(key)) expect(screenTrade(I, partner, g, h, key)).toBeNull();
    }
  });

  it("yields every yieldEveryScreens screens or so (the search's progress)", () => {
    const full = candidates(2);
    // A yield comes once a batch is done (a seed's extensions finish first), so at least one per two batches' worth.
    expect(full.yields).toBeGreaterThanOrEqual(Math.floor(full.tally.screened / (2 * config.search.yieldEveryScreens)));
    expect(full.yields).toBeLessThanOrEqual(Math.ceil(full.tally.screened / config.search.yieldEveryScreens));
  });

  it("in the search: more screened than the beams alone, and the report switch keeps Phase 4b's beams", () => {
    const settings = { ...defaultTradeSettings() };
    const a = runTradeSearch(ctx, { settings, partnerId: "2" });
    const b = runTradeSearch(ctx, { settings, partnerId: "2", exhaustive: false });
    expect(a.counts.screened).toBeGreaterThan(b.counts.screened);
    expect(a.counts.exact).toBeGreaterThan(0);
    // Deterministic with the exhaustive candidates.
    expect(runTradeSearch(ctx, { settings, partnerId: "2" })).toEqual(a);
  });
});
