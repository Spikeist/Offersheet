/**
 * My moves made with or without any trade (Checkpoint 7h; planner reply to Checkpoint 7g, §1: "“Assumed with or without this
 * trade”: show it once, above the list, not on every idea and Plan B box"; evaluate.ts baselineRosterMoves): myRosterMoves on a
 * trade that changes nothing, so it names no move of its own, and every League-page pickup V*(T) holds and every release at my
 * IR players' returns is made "with or without" it. Made-up leagues (trade.testing.ts smallLeague).
 */
import { describe, expect, it } from "vitest";
import { baselineRosterMoves, buildTradeContext, tradeInternals, type TradeContext } from "./evaluate";
import { runTradeSearch } from "./search";
import { TEST_NOW } from "./testLeague";
import type { TestLeagueSpec, TestPlayer } from "./testLeague";
import { flat, handLeague, smallLeague } from "./trade.testing";

describe("baselineRosterMoves (Checkpoint 7h)", () => {
  it("names no move of its own, and assumes exactly the pickups V*(T) holds and its releases at my IR players' returns", () => {
    let pickups = 0;
    let releases = 0;
    for (const seed of [1, 2, 3, 5, 8, 13]) {
      const l = smallLeague(seed);
      const ctx = buildTradeContext(l.snapshot, l.inputs, { now: TEST_NOW });
      const moves = baselineRosterMoves(ctx);
      expect(moves, `seed ${seed}`).not.toBeNull();
      expect(moves?.moves, `seed ${seed}`).toEqual([]);
      const me = tradeInternals(ctx).me;
      if (!me) throw new Error("no team of mine");
      // The League page's pickups my roster after the baseline's own run holds: every one of them, each once.
      const held = new Set(me.vstar.moves.map((m) => m.add).filter((id) => me.vstar.roster.includes(id)));
      const adds = (moves?.assumed ?? []).map((a) => a.add).filter((id): id is string => typeof id === "string");
      expect(new Set(adds), `seed ${seed}`).toEqual(held);
      expect(adds.length, `seed ${seed}`).toBe(held.size);
      expect((moves?.assumed ?? []).some((a) => a.eitherWay), `seed ${seed}`).toBe(false);
      pickups += held.size;
      // Its releases are the baseline's own (the League page's "Returns from IR").
      const displaced = me.base.displaced ?? [];
      expect((moves?.assumedLater ?? []).map((r) => r.player).sort(), `seed ${seed}`).toEqual(displaced.map((d) => d.id).sort());
      releases += moves?.assumedLater?.length ?? 0;
    }
    // The leagues hold pickups, so the checks above check something (their rosters have no IR player: the next test has one).
    expect(pickups).toBeGreaterThan(0);
    expect(releases).toBe(0);
  });

  it("names my IR player's return as the League page's headline makes it (its release, the week)", () => {
    const { snapshot, inputs } = handLeague((spec: TestLeagueSpec) => {
      (spec.teams[0] as { ir?: TestPlayer[] }).ir = [flat("ir1", "RB", 9, { injury: "IR", injuryReturnWeek: 7 })];
    });
    const ctx = buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0 });
    const me = tradeInternals(ctx).me;
    if (!me) throw new Error("no team of mine");
    const displaced = me.base.displaced ?? [];
    expect(displaced.length).toBeGreaterThan(0);
    const later = baselineRosterMoves(ctx)?.assumedLater ?? [];
    // The release itself (the displacement's `from` is an index into the counted weeks: his return week, 7, here).
    expect(later.map((r) => [r.player, r.returner])).toEqual(displaced.map((d) => [d.id, d.returner]));
    expect(later.map((r) => r.week)).toEqual([7]);
  });

  it("is a no-op trade's own line: a search's exact trade that keeps my baseline's pickups names the same ones", () => {
    const l = smallLeague(3);
    const ctx = buildTradeContext(l.snapshot, l.inputs, { now: TEST_NOW });
    const base = baselineRosterMoves(ctx);
    const res = runTradeSearch(ctx, {});
    const plain = (xs: readonly { add: string | null; drop: string | null; eitherWay?: true }[]) => xs.filter((a) => !a.eitherWay).map((a) => `${a.add ?? "-"}/${a.drop ?? "-"}`);
    // At least one card of the list assumes exactly the baseline's line (its trade leaves those pickups alone).
    expect(res.trades.some((t) => t.myMoves && JSON.stringify(plain(t.myMoves.assumed)) === JSON.stringify(plain(base?.assumed ?? [])))).toBe(true);
  });

  it("is null without a team of mine, and for a context the engine didn't build", () => {
    const l = smallLeague(1);
    const ctx = buildTradeContext({ ...l.snapshot, myTeamId: null }, l.inputs, { now: TEST_NOW });
    expect(baselineRosterMoves(ctx)).toBeNull();
    expect(baselineRosterMoves({} as TradeContext)).toBeNull();
  });
});
