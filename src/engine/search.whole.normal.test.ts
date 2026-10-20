/**
 * The whole-roster searches hold the normal search's trades (Checkpoint 7h's second review, search#1; src/engine/search.ts,
 * "Whole rosters", "The normal search's trades too"): a Thorough or brute-force search evaluates exactly every trade the normal
 * search evaluates (the normal search's own choice, made as mode "normal" makes it, reading the whole-roster pass's screens),
 * and plays out every trade the normal search plays out, with the same numbers, ranked on the lists the normal search ranks it
 * on, so a card of a normal list that the whole-roster list doesn't show is left out by that list's own rules, never for want
 * of an exact evaluation or a final run; and the "Helps both" extras' room widens for the normal search's helps-both lane as
 * for its own. The normal search records none of it. Synthetic leagues (smallLeague: made-up players, placeholder teams).
 */
import { describe, expect, it } from "vitest";
import { buildTradeContext, type TradeContext } from "./evaluate";
import { helpsBothPoolOf, runTradeSearch, searchStateOf, type SearchState } from "./search";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { TradeEvaluation } from "./tradeModel";

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
