/**
 * The whole-roster searches (Checkpoint 7h; planner reply to Checkpoint 7g, sections 2 and 3; src/engine/search.ts, "Whole
 * rosters"): the brute force (TradeSearchOptions.mode "bruteForce", section 2's test) and the Thorough search (mode
 * "thorough", the Trade Finder's switch). The pools are whole rosters after the user's own filters; every trade of up to 2
 * players a side is a candidate, screened once; my half of a screen first, the partner's left for later when it can't help me
 * (wholeRosterCandidates), priced where screening's rules could read it (wholeRulesOf), so the ruled trades a keep reads are
 * the ones screening every candidate in full gives; the Thorough search's trades with 3 players a side from bigger pools, kept
 * apart in the funnel. Synthetic league (smallLeague: made-up players, placeholder teams).
 */
import { describe, expect, it } from "vitest";
import { config } from "./config";
import { buildTradeContext, proposalKey, screenTrade, tradeInternals, type Screened, type TeamState } from "./evaluate";
import type { Pos } from "./model";
import {
  atMostWaiverCredit,
  buildPools,
  funnelOf,
  runRefilter,
  runTradeSearch,
  screeningRules,
  searchStateOf,
  sidesOf,
  wholePoolsOf,
  wholeRosterCandidates,
  wholeRulesOf,
  type ThreeConfig,
  type WholeCandidates,
  type WholePool,
} from "./search";
import { defaultTradeSettings, normalizeTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { thoroughSettings } from "./thorough";
import { smallLeague } from "./trade.testing";
import type { TradeAsset, TradeSearchResult } from "./tradeModel";

const league = smallLeague(11);
const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 0 });
const I = tradeInternals(ctx);
const me = I.me as TeamState;
const settings = normalizeTradeSettings(defaultTradeSettings());
const pools = buildPools(I, settings, null);
const asPlayers = (xs: readonly string[]): TradeAsset[] => xs.map((id) => ({ kind: "player", id }));
const byObjective = (a: Screened, b: Screened) => (Math.abs(b.objective - a.objective) > 1e-9 ? b.objective - a.objective : a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const excluded = new Set<Pos>(config.market.tradeSearchExcluded);
const tradable = (t: TeamState) => [...new Set([...t.roster, ...(I.irOn ? t.ir : [])])].filter((id) => I.league.table.rows.has(id) && !excluded.has(I.league.posOf(id) as Pos));

function drain<T>(g: Generator<void, T, void>): T {
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

function wholeOf(partner: TeamState, maxPerSide = 2, three: ThreeConfig | null = null): { found: WholeCandidates; screened: number; pool: WholePool } {
  const whole = wholePoolsOf(I, settings, pools, three ? config.search.thorough.threePool : null);
  const pool = whole.get(partner.id) as WholePool;
  const tally = { screened: 0 };
  const found = drain(wholeRosterCandidates(I, partner, pool, maxPerSide, tally, three));
  return { found, screened: tally.screened, pool };
}

describe("wholePoolsOf: whole rosters after the user's own filters", () => {
  it("holds every tradable player of mine with a model and every one of the partner's, G and H first", () => {
    const whole = wholePoolsOf(I, settings, pools, null);
    expect([...whole.keys()].sort()).toEqual(pools.partners.map((p) => p.id).sort());
    for (const p of pools.partners) {
      const w = whole.get(p.id) as WholePool;
      expect(new Set(w.give)).toEqual(new Set(tradable(me)));
      expect(w.give.slice(0, pools.give.length)).toEqual(pools.give);
      expect(new Set(w.get)).toEqual(new Set(tradable(p)));
      const H = pools.get.get(p.id)?.pool ?? [];
      expect(w.get.slice(0, H.length)).toEqual(H);
      expect(w.three).toBeNull();
    }
  });

  it("leaves out my untouchables and the positions the settings leave out; must-include players stay", () => {
    const mine = tradable(me);
    const untouchable = mine[0] as string;
    const s: TradeSettings = { ...settings, untouchables: [untouchable], avoidPositions: ["TE"] };
    const p0 = buildPools(I, s, null);
    const whole = wholePoolsOf(I, s, p0, null);
    for (const p of p0.partners) {
      const w = whole.get(p.id) as WholePool;
      expect(w.give).not.toContain(untouchable);
      expect(w.get.every((id) => I.league.table.rows.get(id)?.pos !== "TE")).toBe(true);
    }
  });

  it("the Thorough search's bigger pools: my top threePool by surplus score with my chips, each partner's top threePool by what they'd add", () => {
    const n = config.search.thorough.threePool;
    const whole = wholePoolsOf(I, settings, pools, n);
    for (const p of pools.partners) {
      const three = (whole.get(p.id) as WholePool).three;
      expect(three).not.toBeNull();
      expect(three?.give.length).toBeLessThanOrEqual(tradable(me).length);
      expect(three?.get.length).toBeLessThanOrEqual(n);
      expect(three?.get.every((id) => tradable(p).includes(id))).toBe(true);
    }
  });
});

describe("wholeRosterCandidates: every trade of up to 2 a side, each screened once", { timeout: 120_000 }, () => {
  const partner = pools.partners[0] as TeamState;
  const { found, screened, pool } = wholeOf(partner);

  it("reaches every 1-for-1, 1-for-2, 2-for-1 and 2-for-2 of the whole pools, screened in full or deferred, once each", () => {
    let n = 0;
    for (const g of [1, 2]) for (const h of [1, 2]) n += sidesOf([], pool.give, g).length * sidesOf([], pool.get, h).length;
    expect(screened).toBe(n);
    const keys = [...found.full.map((s) => s.key), ...found.deferred.map((d) => d.key)];
    expect(new Set(keys).size).toBe(keys.length);
    // Every legal candidate is one of them: screenTrade on all of them gives the same legal set.
    let legal = 0;
    for (const g of [1, 2]) {
      for (const h of [1, 2]) {
        for (const give of sidesOf([], pool.give, g)) {
          for (const get of sidesOf([], pool.get, h)) if (screenTrade(I, partner, give, get)) legal++;
        }
      }
    }
    expect(found.full.length + found.deferred.length).toBe(legal);
  });

  it("defers exactly the trades my half prices at or below 0 (their objective can't be above 0)", () => {
    for (const d of found.deferred.slice(0, 200)) {
      const s = screenTrade(I, partner, d.give, d.get, d.key);
      if (s) expect(s.myDelta).toBeLessThanOrEqual(0);
      if (s) expect(s.objective).toBeLessThanOrEqual(0);
    }
    for (const s of found.full) expect(s.myDelta).toBeGreaterThan(0);
  });

  it("maxPerSide 1: 1-for-1s only", () => {
    const one = wholeOf(partner, 1);
    expect(one.screened).toBe(pool.give.length * pool.get.length);
    expect([...one.found.full, ...one.found.deferred].every((s) => s.give.length === 1 && s.get.length === 1)).toBe(true);
  });
});

describe("wholeRulesOf: the keep reads what screening every candidate in full gives", { timeout: 120_000 }, () => {
  const cheap = atMostWaiverCredit(I);
  for (const keep of [3, 40, 100_000]) {
    it(`each partner's best ${keep} past screening's rules match pricing every candidate`, () => {
      for (const partner of pools.partners) {
        const { found } = wholeOf(partner);
        const lazy = drain(wholeRulesOf(I, partner, found, cheap, { keptPerPartner: keep }));
        const all = [...found.full];
        for (const d of found.deferred) {
          const s = screenTrade(I, partner, d.give, d.get, d.key);
          if (s) all.push(s);
        }
        const full = screeningRules(all, cheap).sort(byObjective);
        const kept = [...lazy.ruled].sort(byObjective).slice(0, keep);
        expect(kept.map((s) => s.key)).toEqual(full.slice(0, keep).map((s) => s.key));
        // Only trades that can't reach the keep stay unpriced: past the keep, every trade above 0 is there too.
        expect(lazy.ruled.filter((s) => s.objective > 1e-9).length).toBe(full.filter((s) => s.objective > 1e-9).length);
      }
    });
  }
});

describe("the brute force (mode bruteForce)", { timeout: 300_000 }, () => {
  const normal = runTradeSearch(ctx, { settings });
  const brute = runTradeSearch(ctx, { settings, mode: "bruteForce" });
  const bs = searchStateOf(brute);

  it("screens more than the normal search, evaluates up to its funnel's caps, and records its mode", () => {
    expect(brute.counts.screened).toBeGreaterThan(normal.counts.screened);
    const f = funnelOf("bruteForce");
    expect(f).toEqual({ ...config.search.bruteForce });
    expect(bs?.mode).toBe("bruteForce");
    expect(searchStateOf(normal)?.mode).toBeUndefined();
    expect(brute.counts.simFinal).toBeLessThanOrEqual(f.finalists + config.search.helpsBothFinalists + config.search.helpsBothLane);
  });

  it("evaluates trades of up to 2 players a side, and more of them than the normal search", () => {
    const ns = searchStateOf(normal);
    expect(bs && ns).toBeTruthy();
    const exact = [...(bs?.exactByKey.values() ?? [])].map((x) => x.evaluation.proposal);
    expect(exact.every((p) => p.give.length <= 2 && p.get.length <= 2)).toBe(true);
    expect(exact.length).toBeGreaterThan(ns?.exactByKey.size ?? 0);
  });

  it("is deterministic, and a re-filter equals a fresh search at that minimum", () => {
    const again = runTradeSearch(ctx, { settings, mode: "bruteForce" });
    expect(again.trades.map((t) => t.key)).toEqual(brute.trades.map((t) => t.key));
    expect(again.counts).toEqual(brute.counts);
    const minChance = 0.2;
    const fresh = runTradeSearch(ctx, { settings: { ...settings, minChance }, mode: "bruteForce" });
    const re = runRefilter(ctx, bs as NonNullable<typeof bs>, { minChance });
    expect(re.trades.map((t) => [t.key, t.tradeScore, t.overall])).toEqual(fresh.trades.map((t) => [t.key, t.tradeScore, t.overall]));
  });

  it("mode normal is the default search", () => {
    const n2 = runTradeSearch(ctx, { settings, mode: "normal" });
    expect(n2.trades.map((t) => [t.key, t.b])).toEqual(normal.trades.map((t) => [t.key, t.b]));
    expect(n2.counts).toEqual(normal.counts);
  });
});

describe("the Thorough search (mode thorough)", { timeout: 300_000 }, () => {
  it("thoroughSettings: up to 3 players a side whatever the setting, the same object when nothing changes", () => {
    const s2 = { ...settings, maxPerSide: 2 };
    expect(thoroughSettings(s2).maxPerSide).toBe(config.search.thorough.maxPerSide);
    expect(thoroughSettings(s2)).not.toBe(s2);
    const s3 = { ...settings, maxPerSide: 3 };
    expect(thoroughSettings(s3)).toBe(s3);
  });

  it("adds trades with 3 players on a side, from the bigger pools, each screened once", () => {
    const partner = pools.partners[0] as TeamState;
    const three: ThreeConfig = { shapes: config.search.thorough.shapes, beam: config.search.thorough.beam };
    const { found, pool } = wholeOf(partner, 3, three);
    const all = [...found.full, ...found.deferred];
    const keys = all.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(all.some((s) => s.give.length === 3 || s.get.length === 3)).toBe(true);
    const threeGive = new Set(pool.three?.give);
    const threeGet = new Set(pool.three?.get);
    for (const s of all) {
      if (s.give.length < 3 && s.get.length < 3) continue;
      expect(s.give.length).toBeLessThanOrEqual(3);
      expect(s.get.length).toBeLessThanOrEqual(3);
      // A 3-a-side trade's players come from the bigger pools, but for a beam seed's two-player half (from the whole pools).
      const extraGive = s.give.filter((id) => !threeGive.has(id));
      const extraGet = s.get.filter((id) => !threeGet.has(id));
      expect(extraGive.length + extraGet.length).toBeLessThanOrEqual(4);
    }
    // Every shape's trades from its first `top` of each pool are there.
    const shape = config.search.thorough.shapes[0] as { give: number; get: number; top: number };
    const want = sidesOf([], (pool.three?.give ?? []).slice(0, shape.top), shape.give).length * sidesOf([], (pool.three?.get ?? []).slice(0, shape.top), shape.get).length;
    const seen = new Set(keys);
    let legal = 0;
    for (const g of sidesOf([], (pool.three?.give ?? []).slice(0, shape.top), shape.give)) {
      for (const h of sidesOf([], (pool.three?.get ?? []).slice(0, shape.top), shape.get)) {
        const key = proposalKey({ partnerId: partner.id, give: asPlayers(g), get: asPlayers(h) });
        if (screenTrade(I, partner, g, h, key)) {
          legal++;
          expect(seen.has(key)).toBe(true);
        }
      }
    }
    expect(want).toBeGreaterThan(0);
    expect(legal).toBeGreaterThan(0);
  });

  it("searches with 3 players a side and its own funnel, deterministic", () => {
    const t: TradeSearchResult = runTradeSearch(ctx, { settings, mode: "thorough" });
    const st = searchStateOf(t);
    expect(st?.mode).toBe("thorough");
    expect(st?.settings.maxPerSide).toBe(3);
    expect(funnelOf("thorough").finalists).toBe(config.search.thorough.finalists);
    const again = runTradeSearch(ctx, { settings, mode: "thorough" });
    expect(again.trades.map((x) => x.key)).toEqual(t.trades.map((x) => x.key));
    expect(again.counts).toEqual(t.counts);
    // The funnel keeps the trades with 3 on a side apart: never more of them evaluated exactly than its cap (plus companions and the lane).
    const threes = [...(st?.exactByKey.keys() ?? [])].filter((k) => {
      const p = st?.exactByKey.get(k)?.evaluation.proposal;
      return !!p && (p.give.length >= 3 || p.get.length >= 3);
    });
    expect(threes.length).toBeLessThanOrEqual(config.search.thorough.three.exactEvaluationMax + config.search.exactEvaluationMax + config.search.helpsBothLane);
  });
});
