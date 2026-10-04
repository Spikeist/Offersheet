/**
 * My free-agent moves after a trade that my baseline doesn't make (final review of Phase 4c, finding R1; evaluate.ts
 * freeAgentMovesOf, RosterChange.faMoves): the card names them, and my market package counts them like traded players, so
 * a trade whose pickup cuts a valuable player reads the same g_mkt(me) as the trade that gives him away and leaves me the
 * same roster. Parker's case: Bo Nix → Jadarian Price left Josh Allen's week-7 bye without a QB, so V*(after) picked up
 * Malik Willis and cut Kyle Monangai (worth [value] > W [value]). And whom such a pickup cuts follows the near-tie rule
 * (verification of the final review, finding VF-1; optimizer.ts's header): a cut worth more than W gives way to a cheaper
 * one within config.lineups.dropNearTieWeekly a week. The market blend is off (config mocked), so each player's projection
 * is his points exactly; the tolerance is switchable. A hand-built league, made-up players.
 */
import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ tie: 0.2 }));
vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  const c = actual.config;
  const lineups = { ...c.lineups };
  Object.defineProperty(lineups, "dropNearTieWeekly", { get: () => env.tie, enumerable: true });
  return { ...actual, config: { ...c, marketBlend: { ...c.marketBlend, weight: 0 }, lineups } };
});

import { tradePackage } from "./benefit";
import { config } from "./config";
import { buildTradeContext, evaluateExact, freeAgentMovesOf, tradeInternals, type ExactTrade, type TeamState } from "./evaluate";
import type { TradeAsset } from "./tradeModel";
import { TEST_NOW, type TestLeagueSpec, type TestPlayer } from "./testLeague";
import { flat, handLeague } from "./trade.testing";

const players = (ids: readonly string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));

function swapPlayer(spec: TestLeagueSpec, teamId: string, id: string, by: TestPlayer): void {
  const team = spec.teams.find((t) => t.id === teamId);
  const i = team ? team.roster.findIndex((x) => x.id === id) : -1;
  if (!team || i < 0) throw new Error(`no player ${id} on team ${teamId}`);
  team.roster[i] = by;
}

describe("freeAgentMovesOf", () => {
  it("the set differences of the two optimizer runs: pickups and drops the baseline doesn't make, and the baseline's drops still on the roster", () => {
    // The baseline drops x for F1; after the trade (b given, c received) the run drops c for F2 and x for F1 again.
    expect(freeAgentMovesOf({ start: ["a", "b", "x"], roster: ["a", "b", "F1"] }, { start: ["a", "c", "x"], roster: ["a", "F2", "F1"] })).toEqual({ adds: ["F2"], drops: ["c"], kept: [], room: [] });
    // The same pickup with another drop: no new pickup, y dropped, x kept.
    expect(freeAgentMovesOf({ start: ["a", "x", "y"], roster: ["a", "F", "y"] }, { start: ["a", "x", "y"], roster: ["a", "x", "F"] })).toEqual({ adds: [], drops: ["y"], kept: ["x"], room: [] });
    // The baseline's pickup not made after the trade, its drop traded away: nothing (a traded or dropped player isn't kept).
    expect(freeAgentMovesOf({ start: ["a", "x"], roster: ["a", "F"] }, { start: ["a", "c"], roster: ["a", "c"] })).toEqual({ adds: [], drops: [], kept: [], room: [] });
    // The same moves: nothing.
    expect(freeAgentMovesOf({ start: ["a", "x"], roster: ["a", "F"] }, { start: ["a", "x"], roster: ["a", "F"] })).toEqual({ adds: [], drops: [], kept: [], room: [] });
  });

  it("names the baseline's pickups whose spot a drop opens after the trade, through the run's moves (verification finding VF-1)", () => {
    // The baseline drops x for F; x is traded away, so the run drops y for F: y makes room for F, the League page's pickup.
    const base = { start: ["a", "x", "y"], roster: ["a", "F", "y"] };
    expect(freeAgentMovesOf(base, { start: ["a", "y", "c"], roster: ["a", "F", "c"], moves: [{ add: "F", drop: "y", gainEv: 4 }] })).toEqual({ adds: [], drops: ["y"], kept: [], room: ["F"] });
    // A pickup swapped for another passes the spot on: G took y's spot, then F took G's.
    expect(freeAgentMovesOf(base, { start: ["a", "y", "c"], roster: ["a", "F", "c"], moves: [{ add: "G", drop: "y", gainEv: 4 }, { add: "F", drop: "G", gainEv: 1 }] })).toEqual({ adds: [], drops: ["y"], kept: [], room: ["F"] });
    // A new pickup in that spot is the reason itself (adds), never room; an open spot opens nothing.
    expect(freeAgentMovesOf(base, { start: ["a", "y", "c"], roster: ["a", "G", "c"], moves: [{ add: "G", drop: "y", gainEv: 4 }] })).toEqual({ adds: ["G"], drops: ["y"], kept: [], room: [] });
    expect(freeAgentMovesOf(base, { start: ["a", "c"], roster: ["a", "c", "F"], moves: [{ add: "F", drop: null, gainEv: 4 }] })).toEqual({ adds: [], drops: [], kept: [], room: [] });
  });
});

describe("a trade's free-agent moves on the card and in my market package (final review of Phase 4c, finding R1)", () => {
  // My QB (20) is on bye in week 6; my backup QB (12, worth 3,000) covers it. My bench WR (2.5, my WR depth) is worth 5,000
  // (a stash). The free-agent QB scores 6 (worth 900: the waiver credit W). Their bench WR (3.2) would start in my FLEX.
  const league = handLeague((spec) => {
    swapPlayer(spec, "1", "q1", flat("q1", "QB", 20, { nflTeam: "B6" }));
    swapPlayer(spec, "1", "wc1", flat("bq1", "QB", 12, { value: 3000 }));
    swapPlayer(spec, "1", "rc1", flat("st1", "WR", 2.5, { value: 5000 }));
    spec.byeWeek = { B6: 6 };
  });
  const contextOf = (l = league) => {
    const I = tradeInternals(buildTradeContext({ ...l.snapshot, myTeamId: "1" }, l.inputs, { now: TEST_NOW, scenarios: 8 }));
    const exact = (give: string[], get: string[]): ExactTrade => {
      const x = evaluateExact(I, { partnerId: "2", give: players(give), get: players(get) }, 3);
      if ("illegal" in x) throw new Error(x.illegal);
      return x;
    };
    return { I, me: I.me as TeamState, exact };
  };

  it("the backup QB for a bench WR: V*(after) picks up the free-agent QB for week 6 and cuts the stash; the card names the move", () => {
    env.tie = 0.2;
    const { I, me, exact } = contextOf();
    expect(I.credit).toBe(900);
    // The baseline makes no move: my backup covers the bye.
    expect(me.vstar.moves).toEqual([]);
    // After it, my bench WR received (3.2) starts in my FLEX: losing him costs 0.7 a week, far more than the tolerance, so
    // the stash (2.5) goes for the QB though he's worth 5,000.
    const x = exact(["bq1"], ["wc2"]);
    expect(x.evaluation.required.me.faMoves).toEqual({ adds: ["fq"], drops: ["st1"], kept: [], starts: { fq: [6] } });
    // Not the partner's side: its estimate reads the trade itself.
    expect(x.evaluation.required.partner.faMoves).toBeUndefined();
  });

  it("my package counts the cut like a traded player: the same g_mkt(me) as the trade that gives him and leaves me the same roster", () => {
    env.tie = 0.2;
    const { I, exact } = contextOf();
    const a = exact(["bq1"], ["wc2"]).evaluation;
    const b = exact(["bq1", "st1"], ["wc2"]).evaluation;
    // b gives the stash, and legality picks up the free-agent QB in the spot it opens: the same roster as a's.
    expect(b.required.me.adds).toEqual(["fq"]);
    expect(b.required.me.faMoves).toBeUndefined();
    expect(a.gMine).toBeCloseTo(b.gMine, 12);
    expect(a.value).toEqual(b.value);
    // The trade alone would read the stash as kept: much better for me than the end roster is.
    const alone = tradePackage({ players: ["wc2"] }, { players: ["bq1"] }, I.values, I.credit, config.market).g;
    expect(alone).toBeGreaterThan(a.gMine + 0.05);
    // The partner's g is the trade's own: what it's offered.
    expect(a.gPartner).toBeCloseTo(tradePackage({ players: ["bq1"] }, { players: ["wc2"] }, I.values, I.credit, config.market).g, 12);
  });
});

describe("whom that pickup cuts: near-ties by trade value (verification of the final review, finding VF-1)", () => {
  // Their bench WR scores 2.6 (worth 169, under W): received, he starts in my FLEX ahead of the stash by 0.1 a week, inside
  // the tolerance (0.2 a week). Expected-value lineups (no scenarios), so the two WRs differ by those 0.1 points alone.
  const near = handLeague((spec) => {
    swapPlayer(spec, "1", "q1", flat("q1", "QB", 20, { nflTeam: "B6" }));
    swapPlayer(spec, "1", "wc1", flat("bq1", "QB", 12, { value: 3000 }));
    swapPlayer(spec, "1", "rc1", flat("st1", "WR", 2.5, { value: 5000 }));
    swapPlayer(spec, "2", "wc2", flat("wz2", "WR", 2.6));
    spec.byeWeek = { B6: 6 };
  });
  const exactIn = (give: string[], get: string[]) => {
    const I = tradeInternals(buildTradeContext({ ...near.snapshot, myTeamId: "1" }, near.inputs, { now: TEST_NOW, scenarios: 0 }));
    const x = evaluateExact(I, { partnerId: "2", give: players(give), get: players(get) }, 3);
    if ("illegal" in x) throw new Error(x.illegal);
    return { I, x: x.evaluation };
  };

  it("exact ties only (tolerance 0): the stash goes for 0.1 point a week, and my package charges his 5,000", () => {
    env.tie = 0;
    const { x } = exactIn(["bq1"], ["wz2"]);
    expect(x.required.me.faMoves).toEqual({ adds: ["fq"], drops: ["st1"], kept: [], starts: { fq: [6] } });
  });

  it("within the tolerance the cheaper player goes (here the one just received), the stash stays, and g_mkt(me) reads the end roster", () => {
    env.tie = 0.2;
    const { I, x } = exactIn(["bq1"], ["wz2"]);
    expect(I.credit).toBe(900);
    expect(x.required.me.faMoves).toEqual({ adds: ["fq"], drops: ["wz2"], kept: [], starts: { fq: [6] } });
    // The same end roster as giving the backup QB for nothing (legality picks up the QB in the spot it opens): the same
    // g_mkt(me), the stash never charged.
    const alone = exactIn(["bq1"], []).x;
    expect(alone.required.me.adds).toEqual(["fq"]);
    expect(x.gMine).toBeCloseTo(alone.gMine, 12);
    expect(x.value).toEqual(alone.value);
    env.tie = 0.2;
  });
});
