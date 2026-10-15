/**
 * My untouchables in the trade evaluation (Checkpoint 7e; planner reply to Checkpoint 7d, item 3.3: "Untouchables are never
 * suggested as drops anywhere: … in trade cards' roster moves, when a player returns from IR"; evaluate.ts TeamState.keep):
 * roster legality's rule 1 (a position over its limit) and rule 2 (the roster size) never drop one, in screening and exact
 * evaluation alike, and when only untouchables could go the trade is illegal with a plain reason (untouchableDropNote); my
 * free-agent optimizer after the trade (V*(after)) never drops one, and no return of one of my IR players releases one. The
 * partner has none. Hand-built leagues (trade.testing.ts handLeague: 4 full rosters of 10, NFL week 5 of a 1–8 regular
 * season; team 1 is mine) and a whole search on a made-up league.
 */
import { describe, expect, it } from "vitest";
import { analyzeTrade, buildTradeContext, evaluateExact, legalSide, tradeInternals, untouchableDropNote, type TeamState, type TradeContextOptions } from "./evaluate";
import { runTradeSearch, searchStateOf } from "./search";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import type { TestLeagueSpec, TestPlayer } from "./testLeague";
import { TEST_NOW } from "./testLeague";
import { flat, handLeague, smallLeague } from "./trade.testing";
import type { TradeAsset, TradeProposal } from "./tradeModel";

const p = (...ids: string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));
const trade = (partnerId: string, give: string[], get: string[]): TradeProposal => ({ partnerId, give: p(...give), get: p(...get) });
const settingsWith = (untouchables: string[]): TradeSettings => ({ ...defaultTradeSettings(), untouchables });

/** A hand league's context with my untouchables (EV lineups unless `opts.scenarios` says otherwise). */
function context(edit: (spec: TestLeagueSpec) => void, untouchables: string[], opts: Partial<TradeContextOptions> = {}) {
  const { snapshot, inputs } = handLeague(edit);
  const ctx = buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0, settings: settingsWith(untouchables), ...opts });
  const I = tradeInternals(ctx);
  return { ctx, I, me: I.me as TeamState, two: I.byId.get("2") as TeamState };
}

/** Every team at most 3 WRs (each rosters 3: two starters and a bench WR). */
const wrLimit = (spec: TestLeagueSpec) => {
  spec.positionLimits = { WR: 3 };
};

describe("roster legality never drops my untouchables (rules 1 and 2)", { timeout: 60_000 }, () => {
  it("TeamState.keep: mine are my untouchables on my roster or IR; the partner's are none", () => {
    const { me, two } = context(() => undefined, ["wc1", "wc2", "nobody"]);
    expect(me.keep).toEqual(["wc1"]);
    expect(two.keep).toEqual([]);
  });

  it("rule 1, a position over its limit: the next lowest keep value player there goes; with only untouchables there, the trade is illegal and says why (screening and exact evaluation alike)", () => {
    // An RB for a starting WR: four WRs, one over the limit. The bench WR goes; kept, the WR the newcomer benches.
    for (const mode of ["ev", "exact"] as const) {
      const run = (untouchables: string[]) => {
        const { I, me } = context(wrLimit, untouchables);
        return legalSide(I, me, mode === "ev" ? me.vstar.roster : me.roster, ["rc1"], ["wa2"], mode, "You", mode === "ev" ? "ros" : "none", me.pool);
      };
      const free = run([]);
      if ("illegal" in free) throw new Error(free.illegal);
      expect(free.change.drops, mode).toEqual(["wc1"]);
      const one = run(["wc1"]);
      if ("illegal" in one) throw new Error(one.illegal);
      expect(one.change.drops, mode).toEqual(["wb1"]);
      expect(one.roster, mode).toContain("wc1");
      expect(run(["wa1", "wb1", "wc1"]), mode).toEqual({ illegal: "Every WR you could drop is untouchable." });
    }
    // The Analyzer gives the reason; the exact evaluation is illegal with it.
    const { ctx, I } = context(wrLimit, ["wa1", "wb1", "wc1"]);
    expect(analyzeTrade(ctx, trade("2", ["rc1"], ["wa2"]), { settings: settingsWith(["wa1", "wb1", "wc1"]) })).toMatchObject({ evaluation: null, illegal: "Every WR you could drop is untouchable." });
    expect(evaluateExact(I, trade("2", ["rc1"], ["wa2"]), 4)).toEqual({ illegal: untouchableDropNote("WR") });
    // Without an untouchable among them, the limit's own words, as before (a received WR is never the drop).
    const { I: I2, me: me2 } = context(wrLimit, []);
    expect(legalSide(I2, me2, me2.roster, ["wa1", "wb1", "wc1"], ["wa2", "wb2", "wc2", "wa3"], "exact", "You")).toEqual({ illegal: "You can have at most 3 WRs." });
  });

  it("rule 2, the roster size: the next lowest keep value player goes; with only untouchables to drop, the trade is illegal and says why", () => {
    // One RB for two WRs: one player too many. The bench WR goes; kept, the WR the newcomers bench; then the next.
    for (const mode of ["ev", "exact"] as const) {
      const run = (untouchables: string[]) => {
        const { I, me } = context(() => undefined, untouchables);
        return legalSide(I, me, mode === "ev" ? me.vstar.roster : me.roster, ["rc1"], ["wa2", "wb2"], mode, "You", mode === "ev" ? "ros" : "none", me.pool);
      };
      const free = run([]);
      if ("illegal" in free) throw new Error(free.illegal);
      expect(free.change.drops, mode).toEqual(["wc1"]);
      const one = run(["wc1"]);
      if ("illegal" in one) throw new Error(one.illegal);
      expect(one.change.drops, mode).toEqual(["wb1"]);
      const two = run(["wc1", "wb1"]);
      if ("illegal" in two) throw new Error(two.illegal);
      expect(two.change.drops, mode).toEqual(["wa1"]);
      // Every player the lineup doesn't need is untouchable (the QB, TE and both RBs are needed, the K and D/ST are the last
      // ones at positions I stream): illegal, in the lead's words.
      expect(run(["wa1", "wb1", "wc1"]), mode).toEqual({ illegal: "Every player you could drop to make room is untouchable." });
      // Untouchables the rules wouldn't drop anyway (the QB) leave the roster's own reason as it was.
      expect(run(["q1"]), mode).toEqual(free);
    }
    expect(untouchableDropNote(null)).toBe("Every player you could drop to make room is untouchable.");
    expect(untouchableDropNote("K")).toBe("Every kicker you could drop is untouchable.");
    expect(untouchableDropNote("DEF")).toBe("Every D/ST you could drop is untouchable.");
  });
});

describe("my V*(after) and my returns after a trade never drop my untouchables", { timeout: 60_000 }, () => {
  it("V*(after): the free-agent move that would cut an untouchable cuts the next player (or isn't made)", () => {
    // A 9-point free-agent WR: my baseline picks him up for my bench WR. Kept, for my FLEX RB.
    const withPickup = (spec: TestLeagueSpec) => {
      spec.freeAgents = [...(spec.freeAgents ?? []), flat("fx", "WR", 9)];
    };
    const free = context(withPickup, []);
    expect(free.me.vstar.moves.map((m) => [m.add, m.drop])).toEqual([["fx", "wc1"]]);
    const kept = context(withPickup, ["wc1"]);
    expect(kept.me.vstar.moves.map((m) => [m.add, m.drop])).toEqual([["fx", "rc1"]]);
    // A 1-for-1 of RBs: V*(after) runs from scratch on my roster after the trade, and never cuts the bench WR.
    const x = evaluateExact(kept.I, trade("2", ["rb1"], ["rb2"]), 4);
    if ("illegal" in x) throw new Error(x.illegal);
    expect(x.mine.roster).toContain("wc1");
    expect(x.mine.roster).toContain("fx");
    const y = evaluateExact(free.I, trade("2", ["rb1"], ["rb2"]), 4);
    if ("illegal" in y) throw new Error(y.illegal);
    expect(y.mine.roster).not.toContain("wc1");
  });

  it("a return from my IR after a trade never releases an untouchable; the trade's baseline doesn't either", () => {
    const irRb: TestPlayer = flat("ir1", "RB", 9, { injury: "IR", injuryReturnWeek: 7 });
    const withIr = (spec: TestLeagueSpec) => {
      (spec.teams[0] as { ir?: TestPlayer[] }).ir = [irRb];
    };
    for (const S of [0, 8]) {
      const free = context(withIr, [], { scenarios: S });
      const released = free.me.base.displaced[0]?.id as string;
      expect(free.me.base.displaced, `${S} scenarios`).toEqual([{ id: released, from: 2, returner: "ir1" }]);
      const x = evaluateExact(free.I, trade("2", ["rb1"], ["rb2"]), 4);
      if ("illegal" in x) throw new Error(x.illegal);
      const releasedAfter = x.mine.displaced.map((d) => d.id);
      const keep = [...new Set([released, ...releasedAfter])].filter((id) => id !== "ir1");
      const kept = context(withIr, keep, { scenarios: S });
      expect(kept.me.base.displaced.some((d) => keep.includes(d.id)), `${S} scenarios`).toBe(false);
      const k = evaluateExact(kept.I, trade("2", ["rb1"], ["rb2"]), 4);
      if ("illegal" in k) throw new Error(k.illegal);
      expect(k.mine.displaced.some((d) => keep.includes(d.id)), `${S} scenarios`).toBe(false);
      expect(k.evaluation.required.me.displaced?.some((d) => keep.includes(d.playerId)) ?? false, `${S} scenarios`).toBe(false);
    }
  });
});

describe("a whole search with untouchables (smallLeague)", { timeout: 120_000 }, () => {
  it("no exact trade drops, cuts or releases one of my untouchables it doesn't give away, and none is offered", () => {
    let checked = 0;
    for (const seed of [11, 12]) {
      const l = smallLeague(seed);
      const ctx0 = buildTradeContext(l.snapshot, l.inputs, { now: TEST_NOW });
      const me0 = tradeInternals(ctx0).me as TeamState;
      // The two bench players my baseline values least to lose (the drops trades would make first), and my best player.
      const costs = me0.vstar.roster.map((id) => ({ id, cost: tradeInternals(ctx0).model.teams.find((t) => t.id === me0.id)?.players[id]?.mvLoseScen ?? Number.POSITIVE_INFINITY }));
      const cheap = costs.filter((c) => Number.isFinite(c.cost)).sort((a, b) => a.cost - b.cost || (a.id < b.id ? -1 : 1));
      const untouchables = [cheap[0]?.id, cheap[1]?.id, cheap[cheap.length - 1]?.id].filter((id): id is string => id !== undefined);
      const settings = settingsWith(untouchables);
      const ctx = buildTradeContext(l.snapshot, l.inputs, { now: TEST_NOW, settings });
      const I = tradeInternals(ctx);
      expect(I.me?.keep).toEqual([...untouchables].sort());
      const r = runTradeSearch(ctx, { settings });
      const state = searchStateOf(r);
      if (!state) throw new Error("no search state");
      for (const t of [...r.trades, ...(r.helpsBoth?.trades ?? [])]) {
        for (const a of t.proposal.give) expect(a.kind === "player" && untouchables.includes(a.id), `seed ${seed}, ${t.key}`).toBe(false);
      }
      for (const [key, x] of state.exactByKey) {
        const given = new Set(x.evaluation.proposal.give.flatMap((a) => (a.kind === "player" ? [a.id] : [])));
        for (const id of untouchables) {
          if (given.has(id)) continue;
          if ((I.me?.roster ?? []).includes(id)) expect(x.mine.roster, `seed ${seed}, ${key}`).toContain(id);
          expect(x.mine.displaced.some((d) => d.id === id), `seed ${seed}, ${key}`).toBe(false);
          expect(x.evaluation.required.me.drops, `seed ${seed}, ${key}`).not.toContain(id);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
