/**
 * The get pool's "Harder to get" split (planner addendum to Checkpoint 3, §2; lead decision N2): per partner, the top
 * getPool untagged players by MV_add(me, j) > 0 plus the top getPoolTagged tagged ones, in MV_add order, must-include
 * players always. At most two players a team can be tagged (only its #1 and #2 reach e ≥ 0.15), so the default caps (10
 * and 3) can't bind in a small test league: this file shrinks them to 3 and 1 (config mocked) so both caps bind.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  const c = actual.config;
  return { ...actual, config: { ...c, search: { ...c.search, getPool: 3, getPoolTagged: 1 } } };
});

import { config } from "./config";
import { buildTradeContext, harderToGetFor, tradeInternals, type TeamState, type TradeContextOptions } from "./evaluate";
import { addValueOf, baseFor } from "./league";
import { buildPools } from "./search";
import { defaultTradeSettings } from "./settings";
import type { TestLeagueSpec } from "./testLeague";
import { TEST_NOW } from "./testLeague";
import { flat, handLeague } from "./trade.testing";

/** My QB scores 10, so Team 2's QB (19 points; its #1 and a top-12 player) helps me too, as does its RB1 (its #2, top-12). */
const weakQb = (spec: TestLeagueSpec) => {
  const me = spec.teams.find((t) => t.id === "1");
  const i = me ? me.roster.findIndex((x) => x.id === "q1") : -1;
  if (!me || i < 0) throw new Error("no q1");
  me.roster[i] = flat("q1", "QB", 10);
};

function internals(opts: Partial<TradeContextOptions> = {}) {
  const { snapshot, inputs } = handLeague(weakQb);
  return tradeInternals(buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0, ...opts }));
}

/** Team `teamId`'s players by MV_add(me, j) in EV lineups, the ones above 0, best first (ties: the smaller id): the pool's order. */
function byAddValue(I: ReturnType<typeof internals>, teamId: string): string[] {
  const me = I.me as TeamState;
  const add = addValueOf(I.league);
  const scored: { id: string; mv: number }[] = [];
  for (const id of (I.byId.get(teamId) as TeamState).roster) {
    const row = I.league.table.rows.get(id);
    if (!row || config.market.tradeSearchExcluded.includes(row.pos)) continue;
    const base = baseFor(I.league, I.bases, me.index, row.pos);
    const mv = base ? add(me.index, base, row, I.league.maskOf(row), false) : 0;
    if (mv > 1e-9) scored.push({ id, mv });
  }
  return scored.sort((a, b) => (Math.abs(b.mv - a.mv) > 1e-9 ? b.mv - a.mv : a.id < b.id ? -1 : 1)).map((x) => x.id);
}

describe("the get pool H with \"Harder to get\" players apart (N2)", () => {
  it("the caps are mocked down to 3 untagged and 1 tagged", () => {
    expect(config.search.getPool).toBe(3);
    expect(config.search.getPoolTagged).toBe(1);
  });

  it("the top getPool untagged plus the top getPoolTagged tagged, in MV_add order; the tagged ones take no untagged spot", () => {
    const I = internals();
    const order = byAddValue(I, "2");
    const tagged = order.filter((id) => harderToGetFor(I, "2", id));
    const untagged = order.filter((id) => !harderToGetFor(I, "2", id));
    // Team 2's QB and RB1 are both tagged and both help me; four untagged players help me too.
    expect([...tagged].sort()).toEqual(["q2", "ra2"]);
    expect(untagged.length).toBeGreaterThan(3);
    const expected = order.filter((id) => untagged.slice(0, 3).includes(id) || tagged.slice(0, 1).includes(id));
    const pool = buildPools(I, defaultTradeSettings(), null).get.get("2")?.pool;
    expect(pool).toEqual(expected);
    expect(pool).toHaveLength(4);
    // The other tagged player, though he'd add more than the third untagged one, waits for the tagged cap.
    expect(pool).not.toContain(tagged[1]);
    expect(order.indexOf(tagged[1] as string)).toBeLessThan(order.indexOf(untagged[2] as string));
  });

  it("a must-include player is always in, tagged or not, on top of both caps", () => {
    const I = internals();
    const order = byAddValue(I, "2");
    const tagged = order.filter((id) => harderToGetFor(I, "2", id));
    const left = tagged[1] as string;
    const pools = buildPools(I, { ...defaultTradeSettings(), mustInclude: [left] }, null);
    expect(pools.partners.map((t) => t.id)).toEqual(["2"]);
    const h = pools.get.get("2");
    expect(h?.forced).toEqual([left]);
    // The forced one is left out of the ranked part (the other tagged player keeps the tagged spot) and added at the end.
    expect(h?.pool).toEqual([...order.filter((id) => id !== left && (order.filter((x) => !harderToGetFor(I, "2", x)).slice(0, 3).includes(id) || id === tagged[0])), left]);
  });
});
