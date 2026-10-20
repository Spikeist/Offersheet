/**
 * The get pool's IR players (Checkpoint 7h; planner reply to Checkpoint 7g, section 2: "propose the smallest change that finds
 * it"; config.search.getPoolIr, search.ts getPoolPicker): each partner's H also holds its IR players with a model, after the
 * top by MV_add(me, j), whatever they'd add to my lineup (an IR player adds nothing now, but taking him can make room: an IR
 * swap), after the position filters, never twice, never a must-include player twice; getPoolOf (the ladders' and the
 * Analyzer's H) gives the same pool. Hand-made league (handLeague: made-up players, placeholder teams).
 */
import { describe, expect, it } from "vitest";
import { config } from "./config";
import { buildTradeContext, tradeInternals, type TeamState } from "./evaluate";
import { buildPools, getPoolOf, runTradeSearch } from "./search";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW, type TestPlayer } from "./testLeague";
import { flat, handLeague } from "./trade.testing";

const hurt = (id: string, pos: TestPlayer["pos"], points: number): TestPlayer => ({ ...flat(id, pos, points), injury: "IR", injuryReturnWeek: 8 });

/** Team 2 holds a WR and a TE on IR; my team one RB. */
const league = handLeague((spec) => {
  const two = spec.teams.find((t) => t.id === "2");
  const one = spec.teams.find((t) => t.id === "1");
  if (!two || !one) throw new Error("no team");
  two.ir = [hurt("irw2", "WR", 9), hurt("irt2", "TE", 6)];
  one.ir = [hurt("irr1", "RB", 8)];
});
const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 0 });
const I = tradeInternals(ctx);
const settings = defaultTradeSettings();
const S = config.search as unknown as { getPoolIr: boolean };

function withIr<T>(on: boolean, f: () => T): T {
  const was = S.getPoolIr;
  S.getPoolIr = on;
  try {
    return f();
  } finally {
    S.getPoolIr = was;
  }
}

describe("the get pool holds the partner's IR players (config.search.getPoolIr)", () => {
  it("is on by default", () => {
    expect(config.search.getPoolIr).toBe(true);
  });

  it("after the top by what they'd add, each IR player of the partner with a model, by id; off: Checkpoint 7g's pool", () => {
    expect(I.irOn).toBe(true);
    const two = I.byId.get("2") as TeamState;
    expect(two.ir).toEqual(expect.arrayContaining(["irw2", "irt2"]));
    const off = withIr(false, () => buildPools(I, settings, null).get.get("2")?.pool ?? []);
    const on = buildPools(I, settings, null).get.get("2")?.pool ?? [];
    const added = ["irt2", "irw2"].filter((id) => !off.includes(id));
    expect(added.length).toBeGreaterThan(0);
    expect(on).toEqual([...off, ...added]);
    // The ladders' and the Analyzer's H is the same pool.
    expect(getPoolOf(I, settings, two)).toEqual(on);
    expect(withIr(false, () => getPoolOf(I, settings, two))).toEqual(off);
    // No IR player of another team, and never twice.
    expect(new Set(on).size).toBe(on.length);
  });

  it("follows the position filters, and a must-include player stays last, once", () => {
    const two = I.byId.get("2") as TeamState;
    const noTe: TradeSettings = { ...settings, avoidPositions: ["TE"] };
    expect(getPoolOf(I, noTe, two)).not.toContain("irt2");
    const pool = getPoolOf(I, settings, two, ["irw2"]);
    expect(pool.at(-1)).toBe("irw2");
    expect(pool.filter((id) => id === "irw2")).toHaveLength(1);
  });

  it("a search reaches trades that take a partner's IR player", () => {
    const r = runTradeSearch(ctx, { settings: { ...settings, minChance: 0 } });
    expect(r.counts.screened).toBeGreaterThan(withIr(false, () => runTradeSearch(ctx, { settings: { ...settings, minChance: 0 } })).counts.screened);
  });
});
