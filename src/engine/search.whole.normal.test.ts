/**
 * The whole-roster searches hold the normal search's trades (Checkpoint 7h's second review, search#1; src/engine/search.ts,
 * "Whole rosters", "The normal search's trades too"): a Thorough or brute-force search evaluates exactly every trade the normal
 * search evaluates (the normal search's own choice, made as mode "normal" makes it, reading the whole-roster pass's screens),
 * and plays out every trade the normal search plays out, with the same numbers, ranked on the lists the normal search ranks it
 * on, so a card of a normal list that the whole-roster list doesn't show is left out by that list's own rules, never for want
 * of an exact evaluation or a final run; and the "Helps both" extras' room widens for the normal search's helps-both lane as
 * for its own. The normal search's candidates read the whole-roster pass's screens (the very Screened objects where it screened
 * a trade in full), so no trade is screened or counted twice. The normal search records none of it. Synthetic leagues
 * (smallLeague: made-up players, placeholder teams); on e90c076's code (Checkpoint 7h's first build) each of these leagues'
 * whole-roster searches left some of the normal search's exact trades or final runs out (smallLeague 11 Thorough: 33 of 179
 * exact trades, 47 of 79 final runs; with 1 a side, 95 of 107 and 60 of 62).
 */
import { describe, expect, it } from "vitest";
import { config } from "./config";
import { buildTradeContext, tradeInternals, type Screened, type TradeContext } from "./evaluate";
import {
  atMostWaiverCredit,
  buildPools,
  funnelOf,
  helpsBothPoolOf,
  partnerCandidates,
  runTradeSearch,
  searchStateOf,
  wholePoolsOf,
  wholeRosterCandidates,
  wholeRulesOf,
  type ScreenReuse,
  type SearchState,
  type WholePool,
} from "./search";
import { defaultTradeSettings, normalizeTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { thoroughSettings } from "./thorough";
import { smallLeague } from "./trade.testing";
import type { TradeEvaluation } from "./tradeModel";

function drain<T>(g: Generator<void, T, void>): T {
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

const close = (a: number | null, b: number | null): boolean => (a === null || b === null ? a === b : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)));
const keysOf = (list: readonly { key: string }[] | undefined): string[] => (list ?? []).map((t) => t.key);

/** Where a card of a normal list ends up on the same list of the whole-roster search (null: nowhere the list's rules decide). */
function placeOf(st: SearchState, key: string, both: boolean): "ranked" | null {
  if (!st.exactByKey.has(key)) return null;
  if (!st.finals.some((c) => c.key === key)) return null;
  // The Overall list ranks every final run but the "Helps both" list's own; the "Helps both" list ranks them all.
  return both || !st.helpsBothExtras.includes(key) ? "ranked" : null;
}

function covers(ctx: TradeContext, settings: TradeSettings, mode: "thorough" | "bruteForce"): { normalCards: number; wholeOnly: number; state: SearchState } {
  const normal = runTradeSearch(ctx, { settings });
  const whole = runTradeSearch(ctx, { settings, mode });
  const ns = searchStateOf(normal) as SearchState;
  const ws = searchStateOf(whole) as SearchState;
  expect(ns.normalChoice).toBeUndefined();
  expect(ws.normalChoice).toBeDefined();

  // Every trade the normal search evaluates exactly is evaluated here: its choice here is the normal search's own.
  for (const k of ns.exactByKey.keys()) expect(ws.exactByKey.has(k), k).toBe(true);
  const chosen = (ws.normalChoice?.chosen ?? []).filter((k) => ws.exactByKey.has(k));
  expect([...chosen].sort()).toEqual([...ns.exactByKey.keys()].sort());
  expect([...(ws.normalChoice?.lane ?? [])].sort()).toEqual([...ns.lane.trades, ...ns.lane.companions].sort());

  // Every trade the normal search plays out is played out here, with the same numbers on the ranking block, ...
  const wFinal = new Map(ws.finals.map((c) => [c.key, c]));
  expect([...(ws.normalChoice?.finals ?? [])].sort()).toEqual(ns.finals.map((c) => c.key).sort());
  for (const c of ns.finals) {
    const d = wFinal.get(c.key);
    expect(d, c.key).toBeDefined();
    expect(close(c.b, d?.b ?? null), c.key).toBe(true);
    expect(close(c.pComplete, d?.pComplete ?? Number.NaN), c.key).toBe(true);
  }
  // ... on the lists the normal search ranks it on: a trade both its lists rank isn't ranked on "Helps both" alone here.
  const nBoth = new Set(ns.helpsBothExtras);
  const wBoth = new Set(ws.helpsBothExtras);
  for (const c of ns.finals) if (!nBoth.has(c.key)) expect(wBoth.has(c.key), c.key).toBe(false);

  // So every card of a normal list is ranked on that list here: shown, folded into an idea's offers, or left out by the list's
  // own rules (a cap, a better trade), never for want of an exact evaluation or a final run. A normal card promoted from a
  // Last offer (a ladder's version, never evaluated by the search itself) reads the idea it was promoted from, which is.
  const promotedFrom = new Map((normal.merged?.promoted ?? []).map((p) => [`${p.list}|${p.key}`, p.from]));
  const cards: [TradeEvaluation, boolean][] = [...normal.trades.map((t): [TradeEvaluation, boolean] => [t, false]), ...(normal.helpsBoth?.trades ?? []).map((t): [TradeEvaluation, boolean] => [t, true])];
  for (const [t, both] of cards) {
    const key = promotedFrom.get(`${both ? "helpsBoth" : "overall"}|${t.key}`) ?? t.key;
    expect(placeOf(ws, key, both), `${both ? "Helps both" : "Overall"} ${t.key}`).toBe("ranked");
  }

  // The "Helps both" extras' room widens for the normal search's lane as for its own: the pool on the screening numbers with
  // both lanes is played out.
  const screens = [...ws.versions.values()].map((v) => v.screen).filter((c) => ws.exactByKey.has(c.key));
  const lanes = new Set([...ws.lane.trades, ...ws.lane.companions, ...(ws.normalChoice?.lane ?? [])]);
  for (const c of helpsBothPoolOf(screens, lanes).pool) expect(wFinal.has(c.key), c.key).toBe(true);

  const shown = new Set([...keysOf(whole.trades), ...keysOf(whole.helpsBoth?.trades)]);
  return { normalCards: cards.length, wholeOnly: [...shown].filter((k) => !ns.exactByKey.has(k)).length, state: ws };
}

describe("the whole-roster searches hold the normal search's trades (search#1)", { timeout: 600_000 }, () => {
  it("smallLeague 11 (6 teams, at least 10%): the Thorough search and the brute force", () => {
    const lg = smallLeague(11);
    const ctx = buildTradeContext(lg.snapshot, lg.inputs, { now: TEST_NOW, scenarios: 8 });
    const settings = { ...defaultTradeSettings(), minChance: 0.1 };
    const t = covers(ctx, settings, "thorough");
    expect(t.normalCards).toBeGreaterThan(0);
    covers(ctx, settings, "bruteForce");
  });

  it("smallLeague 5 (6 teams, at least 10%, a promoted Last offer on the normal list): the Thorough search", () => {
    const lg = smallLeague(5, {}, 6);
    const ctx = buildTradeContext(lg.snapshot, lg.inputs, { now: TEST_NOW, scenarios: 8 });
    covers(ctx, { ...defaultTradeSettings(), minChance: 0.1 }, "thorough");
  });

  it("smallLeague 3 (12 teams, Any): the Thorough search", () => {
    const lg = smallLeague(3, {}, 12);
    const ctx = buildTradeContext(lg.snapshot, lg.inputs, { now: TEST_NOW, scenarios: 8 });
    const t = covers(ctx, { ...defaultTradeSettings(), minChance: 0 }, "thorough");
    expect(t.normalCards).toBeGreaterThan(0);
  });

  it("the user's own max per side: with 1 a side the normal search's 1-for-1s, the Thorough search's 3 a side its own", () => {
    const lg = smallLeague(11);
    const ctx = buildTradeContext(lg.snapshot, lg.inputs, { now: TEST_NOW, scenarios: 8 });
    const settings = { ...defaultTradeSettings(), maxPerSide: 1, minChance: 0.1 };
    const st = covers(ctx, settings, "thorough").state;
    expect(st.settings.maxPerSide).toBe(3);
    for (const k of st.normalChoice?.chosen ?? []) {
      const p = st.exactByKey.get(k)?.evaluation.proposal;
      if (p) expect(p.give.length === 1 && p.get.length === 1, k).toBe(true);
    }
  });
});

// The lead's ruling for search#1: "keep it small (reuse the screens the whole-roster pass already made where the same trade was
// screened in full: the same Screened object)". The normal search's candidates of each partner, worked out after its
// whole-roster pass (partnerCandidates with ScreenReuse, as tradeSearch runs it), against the same candidates screened afresh.
describe("the normal search's candidates read the whole-roster pass's screens (search#1)", { timeout: 300_000 }, () => {
  it("smallLeague 11, every partner, the Thorough search's pass: the same candidates and numbers, its own Screened objects, nothing screened or counted twice", () => {
    const lg = smallLeague(11);
    const I = tradeInternals(buildTradeContext(lg.snapshot, lg.inputs, { now: TEST_NOW, scenarios: 0 }));
    const user = normalizeTradeSettings({ ...defaultTradeSettings(), minChance: 0.1 });
    const s3 = thoroughSettings(user);
    const pools = buildPools(I, user, null);
    const whole = wholePoolsOf(I, s3, buildPools(I, s3, null), config.search.thorough.threePool);
    const three = { shapes: config.search.thorough.shapes, beam: config.search.thorough.beam };
    let reused = 0;
    for (const partner of pools.partners) {
      const found = drain(wholeRosterCandidates(I, partner, whole.get(partner.id) as WholePool, s3.maxPerSide, { screened: 0 }, three));
      const ruled = drain(wholeRulesOf(I, partner, found, atMostWaiverCredit(I), funnelOf("thorough")));
      const known = new Map<string, Screened | null>(ruled.list.map((s) => [s.key, s]));
      for (const key of found.illegal) known.set(key, null);
      const reuse: ScreenReuse = { known, reached: new Set(found.deferred.map((d) => d.key)) };
      const H = pools.get.get(partner.id) as { pool: string[]; forced: string[] };
      const pool = { give: pools.give, forcedGive: pools.forcedGive, get: H.pool, forcedGet: H.forced };
      const counted = { screened: 0 };
      const read = drain(partnerCandidates(I, partner, pool, user.maxPerSide, counted, { reuse }));
      const fresh = drain(partnerCandidates(I, partner, pool, user.maxPerSide, { screened: 0 }));
      expect(read.map((s) => s.key).sort()).toEqual(fresh.map((s) => s.key).sort());
      const freshOf = new Map(fresh.map((s) => [s.key, s]));
      for (const s of read) {
        const f = freshOf.get(s.key) as Screened;
        expect([s.objective, s.myDelta, s.partnerDelta, s.pQuick, s.gPartner], s.key).toEqual([f.objective, f.myDelta, f.partnerDelta, f.pQuick, f.gPartner]);
        expect([[...s.give].sort(), [...s.get].sort()]).toEqual([[...f.give].sort(), [...f.get].sort()]);
        if (known.has(s.key)) {
          expect(s, s.key).toBe(known.get(s.key));
          reused++;
        }
      }
      // Every candidate of up to 2 a side from G and H is one the pass reached (counted there), so none is counted here.
      expect(counted.screened).toBe(0);
    }
    expect(reused).toBeGreaterThan(0);
  });
});
