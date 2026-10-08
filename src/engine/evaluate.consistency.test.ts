/**
 * The Checkpoint 4 consistency test in SCENARIO lineups (review of track E, item 1): a depth pickup that EV lineups
 * would skip (it gains under faMinGain there) but scenario lineups make, reproduced by a trade, gives the trade no B:
 * ΔPO = ΔCH = ΔEW = 0 exactly. Scenario draws depend on a player's id, so two players can only be the same row when
 * neither can get hurt: this file turns off TEs' future injury risk (config mocked), so a healthy TE plays every
 * scenario, and the depth TE a team picks up and the one a trade brings in are the very same row but for the id.
 * One free agent, one team (Phase 4b, league.ts step 5; evaluate.ts tradeSides): the league reports a waiver order, so
 * the depth TE goes to me (teams 3 and 4 would start him at FLEX, a bigger gain), and the trade is evaluated with me
 * first and with the partner first in that order: both reproduce the baseline exactly.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  const c = actual.config;
  return {
    ...actual,
    config: { ...c, projections: { ...c.projections, injuryRisk: { ...c.projections.injuryRisk, missShare: { ...c.projections.injuryRisk.missShare, TE: 0 } } } },
  };
});

import { config } from "./config";
import { buildTradeContext, evaluateExact, simulateTrade, tradeInternals, tradeSides, type TeamState } from "./evaluate";
import type { TestLeagueSpec, TestPlayer } from "./testLeague";
import { TEST_NOW } from "./testLeague";
import { flat, handLeague } from "./trade.testing";

function swapPlayer(spec: TestLeagueSpec, teamId: string, id: string, by: TestPlayer): void {
  const team = spec.teams.find((t) => t.id === teamId);
  const i = team ? team.roster.findIndex((x) => x.id === id) : -1;
  if (!team || i < 0) throw new Error(`no player ${id} on team ${teamId}`);
  team.roster[i] = by;
}

describe("Checkpoint 4 consistency in scenario lineups", () => {
  it.each([
    ["me first", ["1", "2", "3", "4"]],
    ["the partner first", ["2", "1", "3", "4"]],
  ])("a depth pickup a trade reproduces gets no B: ΔPO = ΔCH = ΔEW = 0 exactly (%s in the waiver order)", (_label, order) => {
    expect(config.projections.injuryRisk.missShare.TE).toBe(0);
    // A free-agent TE of 7 never starts in my average-case lineup (my FLEX RB scores 10, my bench TE 1) but plays
    // whenever one of my RBs is hurt (the FLEX RB moves up): depth. Team 2's bench TE is the same player but for his id,
    // and he can never play there: Team 2's FLEX is an 8-point TE and it has no bench RB or WR, so a hurt RB or WR leaves
    // his slot empty either way (and TEs don't get hurt here). The 1-point TE it receives can't play there either.
    const league = handLeague((spec) => {
      swapPlayer(spec, "1", "rc1", flat("rc1", "RB", 10));
      swapPlayer(spec, "1", "wc1", flat("tb1", "TE", 1));
      swapPlayer(spec, "2", "rc2", flat("tt2", "TE", 8));
      swapPlayer(spec, "2", "wc2", flat("y2", "TE", 7));
      spec.freeAgents = [...(spec.freeAgents ?? []), flat("zte", "TE", 7)];
    });
    const inputs = league.inputs;
    const snapshot = { ...league.snapshot, teams: league.snapshot.teams.map((t) => ({ ...t, waiverRank: order.indexOf(t.id) + 1 })) };
    const ctx = buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 32 });
    const I = tradeInternals(ctx);
    const me = I.me as TeamState;
    expect(I.model.faAllocation).toEqual({ basis: "waiver", order });
    const y = I.league.table.rows.get("y2");
    const z = I.league.table.rows.get("zte");
    expect(Array.from(y?.flags ?? [])).toEqual(Array.from(z?.flags ?? []));
    expect(Array.from(y?.cond ?? [])).toEqual(Array.from(z?.cond ?? []));
    // V*(me) picks the TE up for depth: under faMinGain in EV lineups, over it in scenario lineups.
    const move = I.model.teams[me.index]?.faMoves.find((m) => m.add === "zte");
    expect(move).toBeDefined();
    expect(move?.gainEv as number).toBeLessThan(config.freeAgentOptimizer.faMinGain);
    expect(move?.gainScen as number).toBeGreaterThanOrEqual(config.freeAgentOptimizer.faMinGain - 1e-9);
    // Trading the player the pickup drops for Team 2's TE does exactly what the pickup does.
    const proposal = { partnerId: "2", give: [{ kind: "player" as const, id: move?.drop as string }], get: [{ kind: "player" as const, id: "y2" }] };
    const sides = tradeSides(I, me, I.byId.get("2") as TeamState, [move?.drop as string], ["y2"], "Team 2");
    if ("illegal" in sides) throw new Error(sides.illegal);
    expect(sides.first).toBe(order[0] === "1" ? "me" : "partner");
    const x = evaluateExact(I, proposal, 4);
    if ("illegal" in x) throw new Error(x.illegal);
    expect([...x.mine.roster]).toEqual([...me.vstar.roster].map((id) => (id === "zte" ? "y2" : id)));
    expect(Array.from(x.mine.score.mean)).toEqual(Array.from(me.base.score.mean));
    expect(Array.from(x.mine.score.sd)).toEqual(Array.from(me.base.score.sd));
    expect(move?.drop).toBe("tb1");
    // Team 2's lineups don't change in any scenario: neither TE ever plays there.
    expect(Array.from(x.theirs.score.mean)).toEqual(Array.from(x.partner.base.score.mean));
    expect(Array.from(x.theirs.score.sd)).toEqual(Array.from(x.partner.base.score.sd));
    const final = simulateTrade(I, x, "final", null);
    expect(final.dPO).toBe(0);
    expect(final.dCH).toBe(0);
    expect(final.dEW).toBe(0);
    expect(final.bWin).toBe(0);
    // Checkpoint 7c ("Helps them": planner reply to Checkpoint 7b, §7): the partner's side of the same runs moves nothing
    // either, so the trade doesn't help them.
    expect(final.them?.dPO).toBe(0);
    expect(final.them?.dCH).toBe(0);
    expect(final.them?.bWin).toBe(0);
    expect(final.them?.helps).toBe(0);
  });
});
