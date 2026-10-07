/**
 * Roster legality's rule 4 at kicker and D/ST positions (evaluate.ts file header, rule 4; Phase 4b review of track C): the
 * spot a trade opens takes a free agent at a config.streaming.optimizerExcluded position (K, D/ST: V* never picks one up)
 * only to refill a starting slot the trade emptied, never as an upgrade of the kicker or D/ST the team keeps, which would
 * credit the trade with a pickup the team could make anyway. Exact evaluation and screening alike. A hand-built league
 * (CLAUDE.md §16); teams are placeholders.
 */
import { describe, expect, it } from "vitest";
import { config } from "./config";
import { analyzeTrade, buildTradeContext, legalSide, tradeInternals, type TeamState, type TradeContextOptions } from "./evaluate";
import { defaultTradeSettings } from "./settings";
import type { TestLeagueSpec, TestPlayer } from "./testLeague";
import { TEST_NOW } from "./testLeague";
import { flat, handLeague } from "./trade.testing";
import type { TradeAsset, TradeProposal } from "./tradeModel";

const p = (...ids: string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));
const trade = (partnerId: string, give: string[], get: string[]): TradeProposal => ({ partnerId, give: p(...give), get: p(...get) });

function swapPlayer(spec: TestLeagueSpec, teamId: string, id: string, by: TestPlayer): void {
  const team = spec.teams.find((t) => t.id === teamId);
  const i = team ? team.roster.findIndex((x) => x.id === id) : -1;
  if (!team || i < 0) throw new Error(`no player ${id} on team ${teamId}`);
  team.roster[i] = by;
}

/**
 * The hand league (every team's kicker scores 7, its D/ST 6) with a 9-point free-agent kicker and a 7-point free-agent D/ST:
 * an upgrade at both for every team. Team 2 has no adds this season, so it streams nothing; I stream what `opts` says
 * (default K and D/ST).
 */
function context(edit: (spec: TestLeagueSpec) => void = () => undefined, opts: Partial<TradeContextOptions> = {}) {
  const { snapshot, inputs } = handLeague((spec) => {
    spec.freeAgents = (spec.freeAgents ?? []).map((x) => (x.id === "fk" ? flat("fk", "K", 9) : x.id === "fd" ? flat("fd", "DEF", 7) : x));
    edit(spec);
  });
  return buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0, ...opts });
}

const required = (ctx: ReturnType<typeof context>, proposal: TradeProposal) => {
  const a = analyzeTrade(ctx, proposal);
  if (!a.evaluation) throw new Error(a.illegal ?? "no evaluation");
  return a.evaluation.required;
};

describe("rule 4 at K and D/ST: only a refill of a starting slot the trade emptied", () => {
  it("the setup: K and D/ST are the optimizer's excluded positions; team 2 streams nothing, I stream both", () => {
    expect([...config.streaming.optimizerExcluded].sort()).toEqual(["DEF", "K"]);
    const I = tradeInternals(context());
    expect(I.byId.get("2")?.stream.positions).toEqual([]);
    expect([...(I.me as TeamState).stream.positions].sort()).toEqual(["DEF", "K"]);
  });

  it("a 2-for-1 that keeps the partner's kicker and D/ST never adds the better free-agent one: the spot takes the position it gave up", () => {
    // Team 2 gives its 13-point WR and its 3-point bench WR for my 11-point WR: one spot opens, a WR's (planner reply to
    // Checkpoint 7b, section 5). The 9-point kicker would be +2 a week over its 7 (the 7-point D/ST +1); the spot takes the
    // best free-agent WR, the 2-point one (Checkpoint 7b's rule took the 6-point QB, the most ROS points at any position).
    const ctx = context();
    expect(required(ctx, trade("2", ["wb1"], ["wa2", "wc2"])).partner).toEqual({ drops: [], adds: ["fw"], openSpots: [{ playerId: "fw", pos: "WR" }] });
    // Screening (EV mode, from V*(P)) reads the same rule.
    const I = tradeInternals(ctx);
    const two = I.byId.get("2") as TeamState;
    const screened = legalSide(I, two, two.vstar.roster, ["wa2", "wc2"], ["wb1"], "ev", "Team 2", "look", two.pool);
    if ("illegal" in screened) throw new Error(screened.illegal);
    expect(screened.change.adds).toEqual(["fw"]);
    // Checkpoint 7b's rule (openSpotFill bestAny, for the trade report) never added the kicker or the D/ST either.
    expect(required(context(() => undefined, { openSpotFill: "bestAny" }), trade("2", ["wb1"], ["wa2", "wc2"])).partner.adds).toEqual(["fq"]);
  });

  it("trading the only kicker still refills the slot (review of track E, item 5), and a second open spot takes no second kicker", () => {
    const ctx = context();
    expect(required(ctx, trade("2", ["wc1"], ["k2", "wc2"])).partner).toEqual({ drops: [], adds: ["fk"], openSpots: [{ playerId: "fk", pos: "K" }] });
    // Kicker, bench WR and bench RB for one player: the kicker slot is refilled first (the largest gain among the
    // positions it gave up), the other spot takes the free-agent RB (the position still short), not the free-agent D/ST,
    // an upgrade of the one it keeps.
    expect(required(ctx, trade("2", ["wc1"], ["k2", "wc2", "rc2"])).partner.adds).toEqual(["fk", "fr"]);
    // The only D/ST too.
    expect(required(ctx, trade("2", ["wc1"], ["d2", "wc2"])).partner.adds).toEqual(["fd"]);
  });

  it("a team with two kickers that trades the backup: its kicker slot is still filled, so no free-agent kicker comes in", () => {
    // Team 2's bench WR is a second kicker (6 points). Giving it and its bench RB for my bench WR leaves its 7-point kicker
    // starting: the open spot doesn't take the 9-point free agent (⚠️ a refill only of a slot the trade emptied, not of a
    // kicker it gave away), but the free-agent RB, the other position it gave up.
    const ctx = context((spec) => swapPlayer(spec, "2", "wc2", flat("k2b", "K", 6)));
    expect(required(ctx, trade("2", ["wc1"], ["k2b", "rc2"])).partner).toEqual({ drops: [], adds: ["fr"], openSpots: [{ playerId: "fr", pos: "RB" }] });
  });

  it("my side the same when I don't stream them: no kicker upgrade in the spot my 2-for-1 opens; streamed positions never come in", () => {
    const own = context(() => undefined, { settings: { ...defaultTradeSettings(), streamPositions: [] } });
    expect(tradeInternals(own).me?.stream.positions).toEqual([]);
    expect(required(own, trade("2", ["wb1", "rc1"], ["wa2"])).me).toEqual({ drops: [], adds: ["fr"], openSpots: [{ playerId: "fr", pos: "RB" }] });
    // Trading my only kicker refills it, as for any team that doesn't stream him.
    expect(required(own, trade("2", ["k1", "wc1"], ["wc2"])).me.adds).toEqual(["fk"]);
    // Streaming kickers and D/STs (the default): they're never added, refill or not (my streaming row values the slot), so
    // the spot my kicker opens takes the best at any position (the 6-point QB, the most ROS points: nobody helps).
    const streaming = context();
    expect(required(streaming, trade("2", ["k1", "wc1"], ["wc2"])).me).toEqual({ drops: [], adds: ["fq"], openSpots: [{ playerId: "fq", pos: null }] });
  });
});
