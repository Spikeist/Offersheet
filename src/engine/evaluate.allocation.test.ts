/**
 * One free agent, one team in trade evaluation (evaluate.ts, "One free agent, one team"; tradeSides; planner reply to
 * Checkpoint 4, change 3): the earlier of me and the partner in the allocation order goes first, its legality adds and
 * V*(after) from the pool minus X (every other team's claims), then the other one, also minus what the first one added
 * and, ⚠️ when a team sits between the two in the order, the first one's baseline pickups (review of track C: with none
 * between, the other one is next in line for a pickup the first one gives up); screening's legality adds skip each
 * side's baseline exclusion; faAllocation "independent" is Checkpoint 4's rule. A hand-built league (CLAUDE.md §16);
 * teams are placeholders.
 */
import { describe, expect, it } from "vitest";
import { buildTradeContext, evaluateExact, legalSide, othersPool, tradeInternals, tradeSides, type TeamState, type TradeContextOptions } from "./evaluate";
import type { SlotDef } from "./model";
import { buildTestLeague, TEST_NOW, type TestPlayer } from "./testLeague";
import { flat, withSeason } from "./trade.testing";

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** QB, RB, WR, TE and a FLEX: no K or D/ST, so nobody streams. */
const LINEUP: SlotDef[] = [
  { slot: "QB", count: 1, eligible: ["QB"] },
  { slot: "RB", count: 1, eligible: ["RB"] },
  { slot: "WR", count: 1, eligible: ["WR"] },
  { slot: "TE", count: 1, eligible: ["TE"] },
  { slot: "FLEX", count: 1, eligible: ["RB", "WR", "TE"] },
];

/**
 * Four full 6-player rosters. Me (team 1): TE 8, a 10-point FLEX RB and a 1-point bench RB. Team 2: a 2-point TE and a 12-point
 * FLEX RB, so it picks up the 7-point free-agent TE (+5 a week). Team 3: a 3-point WR, so it picks up the 9-point free-agent WR
 * (+6). Team 4 and I pick up nobody. The waiver order is `order` (team ids, first claim first).
 */
function league(order: readonly string[]) {
  const roster = (t: string, te: number, flexRb: number, wr: number, bench: number): TestPlayer[] => [flat(`q${t}`, "QB", 20), flat(`r${t}`, "RB", 15), flat(`w${t}`, "WR", wr), flat(`t${t}`, "TE", te), flat(`f${t}`, "RB", flexRb), flat(`b${t}`, "RB", bench)];
  const built = withSeason(
    buildTestLeague({
      lineup: LINEUP,
      currentWeek: 5,
      regularSeasonWeeks: range(1, 8),
      playoffWeeks: [9],
      teams: [
        { id: "1", roster: roster("1", 8, 10, 15, 1) },
        { id: "2", roster: roster("2", 2, 12, 15, 3) },
        { id: "3", roster: roster("3", 8, 10, 3, 1) },
        { id: "4", roster: roster("4", 8, 10, 15, 1) },
      ],
      freeAgents: [flat("zt", "TE", 7), flat("zw", "WR", 9)],
    }),
    { regular: range(1, 8), playoff: [9], playoffTeams: 2 },
  );
  return { ...built, snapshot: { ...built.snapshot, teams: built.snapshot.teams.map((t) => ({ ...t, waiverRank: order.indexOf(t.id) + 1 })) } };
}

function context(order: readonly string[], opts: Partial<TradeContextOptions> = {}) {
  const { snapshot, inputs } = league(order);
  const I = tradeInternals(buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0, ...opts }));
  return { I, me: I.me as TeamState, two: I.byId.get("2") as TeamState };
}

const adds = (run: { moves: readonly { add: string }[] }) => run.moves.map((m) => m.add);

describe("the allocation in this league", () => {
  it("team 2 claims the TE, team 3 the WR, whatever the order; X for a trade with team 2 is team 3's WR", () => {
    for (const order of [
      ["1", "2", "3", "4"],
      ["2", "1", "3", "4"],
    ]) {
      const { I, me, two } = context(order);
      expect(I.model.faAllocation).toEqual({ basis: "waiver", order });
      expect(I.teams.map((t) => [t.id, [...t.claimed]])).toEqual([
        ["1", []],
        ["2", ["zt"]],
        ["3", ["zw"]],
        ["4", []],
      ]);
      expect([...me.pool.excluded].sort()).toEqual(["zt", "zw"]);
      expect([...two.pool.excluded]).toEqual(["zw"]);
      expect([...othersPool(I, two).excluded]).toEqual(["zw"]);
      expect(me.claimRank).toBe(order.indexOf("1"));
    }
  });
});

describe("trade evaluation: the earlier of the two teams goes first (tradeSides)", () => {
  // I give my 8-point TE for team 2's 12-point FLEX RB. After it, my TE slot is empty (the 7-point TE is +7 a week to me), and
  // team 2's FLEX is its 3-point bench RB (the 7-point TE is +4 there, the 9-point WR +6, but the WR is team 3's).
  const TRADE = { give: ["t1"], get: ["f2"] };

  it("me first: my V*(after) may take the partner's baseline pickup; the partner then can't, and nobody adds the third team's", () => {
    const { I, me, two } = context(["1", "2", "3", "4"]);
    const sides = tradeSides(I, me, two, TRADE.give, TRADE.get, "Team 2");
    if ("illegal" in sides) throw new Error(sides.illegal);
    expect(sides.first).toBe("me");
    expect(adds(sides.mine)).toEqual(["zt"]);
    expect(adds(sides.theirs)).toEqual([]);
    expect([...sides.pools.mine.excluded]).toEqual(["zw"]);
    expect([...sides.pools.theirs.excluded].sort()).toEqual(["zt", "zw"]);
    // The exact evaluation is built from the same sides.
    const x = evaluateExact(I, { partnerId: "2", give: [{ kind: "player", id: "t1" }], get: [{ kind: "player", id: "f2" }] }, 2);
    if ("illegal" in x) throw new Error(x.illegal);
    expect(x.mine.roster).toContain("zt");
    expect(x.theirs.roster).not.toContain("zt");
    expect(x.theirs.roster).not.toContain("zw");
  });

  it("the partner first: it keeps its pickup (re-claimed after the trade), and my V*(after) can't take it", () => {
    const { I, me, two } = context(["2", "1", "3", "4"]);
    const sides = tradeSides(I, me, two, TRADE.give, TRADE.get, "Team 2");
    if ("illegal" in sides) throw new Error(sides.illegal);
    expect(sides.first).toBe("partner");
    // Team 2's best move would be the 9-point WR at FLEX (+6), but he's team 3's: the TE (+4).
    expect(adds(sides.theirs)).toEqual(["zt"]);
    expect(adds(sides.mine)).toEqual([]);
    expect([...sides.pools.theirs.excluded]).toEqual(["zw"]);
    expect([...sides.pools.mine.excluded].sort()).toEqual(["zt", "zw"]);
  });

  it("⚠️ the partner first and no longer wanting its pickup after the trade: I may take him only when no team sits between us in the order", () => {
    // My 8-point TE for team 2's 3-point bench RB: team 2's TE becomes 8 and its FLEX stays the 12-point RB, so the 7-point
    // free-agent TE is no use to it any more; I have no TE (he'd be +7 a week to me).
    const release = { give: ["t1"], get: ["b2"] };
    // Team 2 right ahead of me: every team ahead of it passed on him in the baseline (nobody here), so I'm next in line.
    const next = context(["2", "1", "3", "4"]);
    const n = tradeSides(next.I, next.me, next.two, release.give, release.get, "Team 2");
    if ("illegal" in n) throw new Error(n.illegal);
    expect(n.first).toBe("partner");
    expect(adds(n.theirs)).toEqual([]);
    expect(adds(n.mine)).toEqual(["zt"]);
    expect([...n.pools.mine.excluded]).toEqual(["zw"]);
    // Team 3 between us: it never had a chance at him and would claim him first, but it keeps its baseline (the planner's
    // rule), so nobody adds him.
    const apart = context(["2", "3", "1", "4"]);
    expect(apart.I.teams.map((t) => [t.id, [...t.claimed]])).toEqual([
      ["1", []],
      ["2", ["zt"]],
      ["3", ["zw"]],
      ["4", []],
    ]);
    const a = tradeSides(apart.I, apart.me, apart.two, release.give, release.get, "Team 2");
    if ("illegal" in a) throw new Error(a.illegal);
    expect(a.first).toBe("partner");
    expect(adds(a.theirs)).toEqual([]);
    expect(adds(a.mine)).toEqual([]);
    expect([...a.pools.mine.excluded].sort()).toEqual(["zt", "zw"]);
    // With me first, he's mine.
    const first = context(["1", "2", "3", "4"]);
    const f = tradeSides(first.I, first.me, first.two, release.give, release.get, "Team 2");
    if ("illegal" in f) throw new Error(f.illegal);
    expect(adds(f.mine)).toEqual(["zt"]);
  });

  it("a trade of bench players makes each side's baseline pickups again, whatever the order and whether a team sits between the two", () => {
    // My 1-point bench RB for team 2's 3-point one: neither ever starts, legality makes no move, and each side's V*(after)
    // picks up what its baseline V* did (team 2 the TE; ties may drop another bench player), for the same lineups.
    for (const order of [
      ["1", "2", "3", "4"],
      ["2", "1", "3", "4"],
      ["2", "3", "1", "4"],
      ["1", "3", "2", "4"],
    ]) {
      const { I, me, two } = context(order);
      const s = tradeSides(I, me, two, ["b1"], ["b2"], "Team 2");
      if ("illegal" in s) throw new Error(s.illegal);
      expect(adds(two.vstar)).toEqual(["zt"]);
      expect(adds(s.theirs), order.join(">")).toEqual(adds(two.vstar));
      expect(adds(s.mine), order.join(">")).toEqual(adds(me.vstar));
      expect(s.theirs.evRos, order.join(">")).toBeCloseTo(two.vstar.evRos, 9);
      expect(s.mine.evRos, order.join(">")).toBeCloseTo(me.vstar.evRos, 9);
    }
  });

  it("legality's adds follow the same order: a 2-for-1 that opens my roster spot fills it with the partner's pickup only when I'm first", () => {
    const twoForOne = { give: ["t1", "b1"], get: ["f2"] };
    const first = context(["1", "2", "3", "4"]);
    const a = tradeSides(first.I, first.me, first.two, twoForOne.give, twoForOne.get, "Team 2");
    if ("illegal" in a) throw new Error(a.illegal);
    expect(a.mineLegal.change.adds).toEqual(["zt"]);
    // The partner, second, can't add him back (it makes room for my two players by its own drop).
    expect(adds(a.theirs)).not.toContain("zt");
    const second = context(["2", "1", "3", "4"]);
    const b = tradeSides(second.I, second.me, second.two, twoForOne.give, twoForOne.get, "Team 2");
    if ("illegal" in b) throw new Error(b.illegal);
    expect(adds(b.theirs)).toEqual(["zt"]);
    expect(b.mineLegal.change.adds).toEqual([]);
    // Screening (a filter, ⚠️): each side's legality adds skip its baseline exclusion excl(T), whoever is first: mine skips
    // team 2's TE and team 3's WR, so the spot stays open.
    for (const { I, me } of [first, second]) {
      const screened = legalSide(I, me, me.vstar.roster, twoForOne.give, twoForOne.get, "ev", "You", "ros", me.pool);
      if ("illegal" in screened) throw new Error(screened.illegal);
      expect(screened.change.adds).toEqual([]);
    }
  });

  it("faAllocation 'independent' (Checkpoint 4's rule): mine first, both sides from the whole pool", () => {
    const { I, me, two } = context(["2", "1", "3", "4"], { faAllocation: "independent" });
    expect(I.model.faAllocation).toBeUndefined();
    expect(me.claimRank).toBeNull();
    expect(me.pool.excluded.size).toBe(0);
    const sides = tradeSides(I, me, two, TRADE.give, TRADE.get, "Team 2");
    if ("illegal" in sides) throw new Error(sides.illegal);
    expect(sides.first).toBe("me");
    expect(sides.pools.mine.excluded.size).toBe(0);
    expect(sides.pools.theirs.excluded.size).toBe(0);
    expect(adds(sides.mine)).toEqual(["zt"]);
    // Team 2 takes the WR: team 3's pickup too, each team on its own.
    expect(adds(sides.theirs)).toEqual(["zw"]);
  });
});
