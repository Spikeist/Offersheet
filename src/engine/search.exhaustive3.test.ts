/**
 * maxPerSide 3 with the exhaustive candidates (src/engine/search.ts partnerCandidates; ⚠️ ours): the third player extends
 * the best beamThird two-player trades among the beams' extensions and the exhaustive candidates alike. With config's
 * beams (60 seeds extended) the synthetic league's best two-player trades are all the beams' own, so this file turns the
 * beams' first extension off (config mocked: beamSecond 0, beamThird 10): every two-player trade is then an exhaustive one,
 * and the third player extends the best of them.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  const c = actual.config;
  return { ...actual, config: { ...c, search: { ...c.search, beamSecond: 0, beamThird: 10 } } };
});

import { config } from "./config";
import { buildTradeContext, proposalKey, screenTrade, tradeInternals, type Screened, type TeamState } from "./evaluate";
import { partnerCandidates, type PartnerPool } from "./search";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { TradeAsset } from "./tradeModel";

const league = smallLeague(11);
const I = tradeInternals(buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 0 }));
const me = I.me as TeamState;
const partner = I.byId.get("2") as TeamState;
const pos = (id: string) => league.snapshot.players[id]?.pos;
const skill = (t: TeamState) => t.roster.filter((id) => pos(id) !== "K" && pos(id) !== "DEF" && I.league.table.rows.has(id));
const players = (xs: readonly string[]): TradeAsset[] => xs.map((id) => ({ kind: "player", id }));
const keyOf = (give: readonly string[], get: readonly string[]) => proposalKey({ partnerId: partner.id, give: players(give), get: players(get) });
const pool: PartnerPool = { give: skill(me).slice(0, 8), forcedGive: [], get: skill(partner).slice(0, 8), forcedGet: [] };
const byObjective = (a: Screened, b: Screened) => (Math.abs(b.objective - a.objective) > 1e-9 ? b.objective - a.objective : a.key < b.key ? -1 : 1);

function candidates(maxPerSide: number, exhaustive = true) {
  const it = partnerCandidates(I, partner, pool, maxPerSide, { screened: 0 }, { exhaustive });
  let r = it.next();
  while (!r.done) r = it.next();
  return { list: r.value, keys: new Set(r.value.map((x) => x.key)) };
}

/** The legal single additions to `s` (a side under 3), each one screened. */
function extensions(s: Screened): string[] {
  const out: string[] = [];
  const add = (give: string[], get: string[]) => {
    const key = keyOf(give, get);
    if (screenTrade(I, partner, give, get, key)) out.push(key);
  };
  if (s.give.length < 3) for (const g of pool.give) if (!s.give.includes(g)) add([...s.give, g], s.get);
  if (s.get.length < 3) for (const h of pool.get) if (!s.get.includes(h)) add(s.give, [...s.get, h]);
  return out;
}

describe("the third extension's base: the best beamThird two-player trades, the beams' and the exhaustive ones alike (⚠️ ours)", { timeout: 60_000 }, () => {
  it("the mock: no seed extended by the beams, 10 two-player trades extended again", () => {
    expect(config.search.beamSecond).toBe(0);
    expect(config.search.beamThird).toBe(10);
  });

  it("extends the best exhaustive two-player trades; with the beams alone nothing reaches 3 a side", () => {
    const two = candidates(2);
    const beamsTwo = candidates(2, false);
    // The beams made no two-player trade (beamSecond 0): every one here is an exhaustive candidate.
    expect(beamsTwo.list.every((x) => x.give.length === 1 && x.get.length === 1)).toBe(true);
    const base = two.list.filter((x) => x.give.length + x.get.length > 2).sort(byObjective).slice(0, config.search.beamThird);
    expect(base).toHaveLength(config.search.beamThird);
    const three = candidates(3);
    for (const s of base) for (const key of extensions(s)) expect(three.keys.has(key), key).toBe(true);
    expect(three.list.some((x) => x.give.length === 3 || x.get.length === 3)).toBe(true);
    expect(three.list.every((x) => x.give.length <= 3 && x.get.length <= 3)).toBe(true);
    // The beams alone (the report switch): no two-player trade to extend, so no 3-a-side trade.
    expect(candidates(3, false).list.every((x) => x.give.length < 3 && x.get.length < 3)).toBe(true);
  });
});
