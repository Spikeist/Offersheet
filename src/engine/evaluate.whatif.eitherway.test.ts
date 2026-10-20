/**
 * The Trade Analyzer's "What if" (Checkpoint 7h; evaluate.ts analyzeWhatIf) and item 2.1's either-way moves (Checkpoint 7e: no
 * credit for moves I could make anyway): a pickup my roster after the change makes that clears the pickup bar on my baseline
 * too is made in both versions, so the what-if's numbers start from that "before", as a trade's do. The league of
 * evaluate.eitherway.test.ts: free-agent pickups held to one move a run (config mocked), so my baseline leaves a second pickup
 * that clears the bar unmade; the market blend off and expected-value lineups. Made-up players.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  const c = actual.config;
  return { ...actual, config: { ...c, marketBlend: { ...c.marketBlend, weight: 0 }, freeAgentOptimizer: { ...c.freeAgentOptimizer, faMaxMoves: 1 } } };
});

import { analyzeTrade, analyzeWhatIf, buildTradeContext, tradeInternals } from "./evaluate";
import { TEST_NOW, type TestLeagueSpec, type TestPlayer } from "./testLeague";
import { flat, handLeague } from "./trade.testing";

function swapPlayer(spec: TestLeagueSpec, teamId: string, id: string, by: TestPlayer): void {
  const team = spec.teams.find((t) => t.id === teamId);
  const i = team ? team.roster.findIndex((x) => x.id === id) : -1;
  if (!team || i < 0) throw new Error(`no player ${id} on team ${teamId}`);
  team.roster[i] = by;
}

// evaluate.eitherway.test.ts's league: my baseline takes fx (RB 13) for wc1, held to one move; fy (TE 12) clears the bar there
// too but isn't made.
const league = handLeague((spec) => {
  for (const t of ["2", "3", "4"]) {
    swapPlayer(spec, t, `ra${t}`, flat(`ra${t}`, "RB", 13));
    swapPlayer(spec, t, `rb${t}`, flat(`rb${t}`, "RB", 13));
    swapPlayer(spec, t, `rc${t}`, flat(`rc${t}`, "RB", 14));
    swapPlayer(spec, t, `te${t}`, flat(`te${t}`, "TE", 12));
  }
  spec.freeAgents = [...(spec.freeAgents ?? []), flat("fx", "RB", 13), flat("fy", "TE", 12)];
});

describe("a what-if's either-way moves (item 2.1)", () => {
  it("my pickup after the change that clears the bar on my baseline too is in both versions: the numbers start from that before", () => {
    const ctx = buildTradeContext({ ...league.snapshot, myTeamId: "1" }, league.inputs, { now: TEST_NOW, scenarios: 0 });
    const I = tradeInternals(ctx);
    expect(I.me?.vstar.moves.map((m) => [m.add, m.drop])).toEqual([["fx", "wc1"]]);
    // Taking off wc1 and putting on Team 2's bench RB (14): my one pickup after it is fy, for rc1, which clears the bar on my
    // baseline too.
    const a = analyzeWhatIf(ctx, { remove: ["wc1"], add: ["rc2"] });
    const e = a.evaluation;
    expect(e?.myMoves.assumed).toEqual([{ add: "fy", drop: "rc1", eitherWay: true }]);
    // The League page's pickup fx isn't worth it with rc2 on (+1 a week): the change takes its roster spot.
    expect(e?.myMoves.moves).toEqual([{ kind: "skip", week: 5, add: "fx", keep: null, why: "spot", by: ["rc2"] }]);
    // Its own "before" (my baseline with fy made), as the same trade's: my row is the trade's, so the same "before" and lineup change.
    expect(e?.before).toBeDefined();
    const trade = analyzeTrade(ctx, { partnerId: "2", give: [{ kind: "player", id: "wc1" }], get: [{ kind: "player", id: "rc2" }] }, { later: false }).evaluation;
    expect(e?.before).toEqual(trade?.before);
    expect(e?.dPPW).toBe(trade?.dPPW);
    expect(e?.roster).toEqual(["q1", "ra1", "rb1", "wa1", "wb1", "te1", "k1", "d1", "fy", "rc2"]);
  });
});
