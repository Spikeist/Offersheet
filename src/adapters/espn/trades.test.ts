import { describe, expect, it } from "vitest";
import { REFILL_EARLY_MS, REFILL_LATE_MS, TRADE_CLUSTER_MS, legsKey, tradeHistory, tradeKeys, type TradeAcquisition, type TradeContext, type TradeMove, type TradeRow } from "./trades";

const H = 3_600_000;
/** The live trade's times (Parker's league): accepted 2026-09-30 00:08:13.951, upheld (a vote) 12:51, went through 2026-10-01 00:08:01.139. */
const ACCEPTED = Date.parse("2026-09-30T00:08:13.951Z");
const VOTED = Date.parse("2026-09-30T12:51:50.257Z");
const WENT_THROUGH = Date.parse("2026-10-01T00:08:01.139Z");

type RowSpec = Partial<TradeRow["row"]> & { moves?: TradeMove[] };
const row = (id: string, type: string, spec: RowSpec = {}): TradeRow => {
  const { moves = [], ...r } = spec;
  return { row: { id, type, scoringPeriodId: 4, teamId: 1, ...r }, moves };
};
const drop = (playerId: string, from: string): TradeMove => ({ playerId, from, to: null, trade: false });
const leg = (playerId: string, from: string, to: string): TradeMove => ({ playerId, from, to, trade: true });
/** The snapshot's form of row moves (no `trade` flag). */
const toTransactionMoves = (moves: readonly TradeMove[]) => moves.map(({ playerId, from, to }) => ({ playerId, from, to }));
const acq = (playerId: string, teamId: string, at: number, pos?: TradeAcquisition["pos"]): TradeAcquisition => ({ playerId, teamId, at, ...(pos ? { pos } : {}) });
const ctx = (over: Partial<TradeContext> = {}): TradeContext => ({ now: WENT_THROUGH + 8 * 60_000, revisionHours: 24, tradeCounters: new Map(), ...over });

/** The live shape: Team 10's accept (no status, only its roster-space DROP) and Team 2's EXECUTED UPHOLD vote, both answering one proposal. */
const liveRows = (): TradeRow[] => [
  row("uphold", "TRADE_UPHOLD", { status: "EXECUTED", relatedTransactionId: "proposal", teamId: 2, proposedDate: VOTED }),
  row("accept", "TRADE_ACCEPT", { relatedTransactionId: "proposal", teamId: 10, proposedDate: ACCEPTED, moves: [drop("dropped", "10")] }),
];
/** What moved: a WR to Team 6, a WR and an RB to Team 10, all at one instant. */
const liveAcquisitions = (): TradeAcquisition[] => [acq("wr6", "6", WENT_THROUGH, "WR"), acq("wr10", "10", WENT_THROUGH, "WR"), acq("rb10", "10", WENT_THROUGH, "RB")];

describe("tradeHistory: other teams' trades ESPN lists without players (the refill)", () => {
  it("rebuilds the live trade from the rosters: players from the other party, the parties as teams, the vote's team left out, the acquisition instant as its time", () => {
    const h = tradeHistory(liveRows(), liveAcquisitions(), ctx());
    expect(h.trades).toEqual([
      {
        id: "accept",
        type: "trade",
        week: 4,
        timestamp: "2026-10-01T00:08:01.139Z",
        teams: ["6", "10"],
        moves: [
          { playerId: "wr6", from: "10", to: "6", pos: "WR" },
          { playerId: "rb10", from: "6", to: "10", pos: "RB" },
          { playerId: "wr10", from: "6", to: "10", pos: "WR" },
          { playerId: "dropped", from: "10", to: null },
        ],
        refilled: true,
      },
    ]);
    expect(h).toMatchObject({ pending: 0, unresolved: 0, withoutPlayers: 0, unconfirmed: 0 });
    expect(h.rebuilt).toEqual([{ tx: h.trades[0], source: "rows" }]);
  });

  it("before the trade goes through, a vote (EXECUTED UPHOLD) doesn't complete it: still in review", () => {
    const h = tradeHistory(liveRows(), [], ctx({ now: VOTED + H }));
    expect(h).toMatchObject({ trades: [], pending: 1, unresolved: 0 });
    // Within the slack after the review period it is still waiting to go through.
    expect(tradeHistory(liveRows(), [], ctx({ now: ACCEPTED + 24 * H + REFILL_LATE_MS })).pending).toBe(1);
  });

  it("past the review period with no players on the rosters, a voted trade is unresolved like one without votes: votes are cast before the outcome is known (review Track C 2)", () => {
    const late = ctx({ now: ACCEPTED + 24 * H + REFILL_LATE_MS + 1 });
    const voted = tradeHistory(liveRows(), [], late);
    expect(voted).toMatchObject({ trades: [], pending: 0, unresolved: 1, withoutPlayers: 0, unconfirmed: 0, rebuilt: [], partnerUnknown: [] });
    // The same evidence without the vote: the same outcome.
    expect(tradeHistory([liveRows()[1] as TradeRow], [], late)).toEqual(voted);
    // An unknown review period: waiting, as for an accept alone (not completed by the vote).
    expect(tradeHistory(liveRows(), [], { now: VOTED + 30 * 24 * H, tradeCounters: new Map() })).toMatchObject({ trades: [], pending: 1, unresolved: 0 });
  });

  it("votes alone (no accept row): waiting until the first vote + the review period + the slack, then unresolved; never a trade without teams; rebuilt when the rosters show it (review Track C 2)", () => {
    const votes = () => [
      row("v1", "TRADE_UPHOLD", { status: "EXECUTED", relatedTransactionId: "proposal", teamId: 2, proposedDate: VOTED }),
      row("v2", "TRADE_UPHOLD", { status: "EXECUTED", relatedTransactionId: "proposal", teamId: 4, proposedDate: VOTED + 2 * H }),
    ];
    // The review ended by the first vote + 24 hours at the latest (the vote came during it).
    const bound = VOTED + 24 * H + REFILL_LATE_MS;
    expect(tradeHistory(votes(), [], ctx({ now: bound }))).toMatchObject({ trades: [], pending: 1, unresolved: 0 });
    const after = tradeHistory(votes(), [], ctx({ now: bound + 1 }));
    expect(after).toMatchObject({ trades: [], pending: 0, unresolved: 1, withoutPlayers: 0, unconfirmed: 0 });
    // The rosters show it: rebuilt between the teams that received players, neither voter a party.
    const shown = tradeHistory(votes(), liveAcquisitions(), ctx({ now: bound + 1 }));
    expect(shown.trades).toMatchObject([{ id: "v1", teams: ["6", "10"], refilled: true }]);
    expect(shown).toMatchObject({ pending: 0, unresolved: 0, unconfirmed: 0 });
    for (const t of [...after.trades, ...shown.trades]) expect(t.teams.length).toBeGreaterThan(0);
  });

  it("an accepted trade with nothing EXECUTED: waiting during its review period (or when its length is unknown), unresolved after it, completed once its players show up", () => {
    const accept = () => [row("a", "TRADE_ACCEPT", { teamId: 10, relatedTransactionId: "p", proposedDate: ACCEPTED })];
    expect(tradeHistory(accept(), [], ctx({ now: ACCEPTED + 23 * H }))).toMatchObject({ trades: [], pending: 1 });
    expect(tradeHistory(accept(), [], ctx({ now: ACCEPTED + 49 * H }))).toMatchObject({ trades: [], pending: 0, unresolved: 1 });
    expect(tradeHistory(accept(), [], { now: ACCEPTED + 30 * 24 * H, tradeCounters: new Map() })).toMatchObject({ pending: 1, unresolved: 0 });
    const done = tradeHistory(accept(), [acq("x", "10", WENT_THROUGH), acq("y", "6", WENT_THROUGH)], ctx({ now: ACCEPTED + 49 * H }));
    expect(done.trades.map((t) => [t.id, t.teams, t.refilled, t.moves.map((m) => `${m.playerId}:${m.from}>${m.to}`)])).toEqual([["a", ["6", "10"], true, ["y:10>6", "x:6>10"]]]);
    expect(done).toMatchObject({ pending: 0, unresolved: 0 });
  });

  it("an EXECUTED accept without players stays completed when the rosters don't show the trade (keeps its row time and teams)", () => {
    const rows = [row("a", "TRADE_ACCEPT", { status: "EXECUTED", teamId: 10, processDate: WENT_THROUGH, moves: [drop("d", "10")] })];
    const h = tradeHistory(rows, [], ctx());
    expect(h.trades).toEqual([{ id: "a", type: "trade", week: 4, timestamp: "2026-10-01T00:08:01.139Z", teams: ["10"], moves: [{ playerId: "d", from: "10", to: null }] }]);
    expect(h).toMatchObject({ withoutPlayers: 1, unconfirmed: 1 });
    // With the players on the rosters at its processDate, it is rebuilt.
    expect(tradeHistory(rows, [acq("x", "10", WENT_THROUGH), acq("y", "3", WENT_THROUGH)], ctx()).trades[0]).toMatchObject({ teams: ["3", "10"], refilled: true });
  });

  it("matches only acquisitions inside the trade's window: from a few minutes before its first row to its last row + the review period + a day", () => {
    const rows = () => [row("a", "TRADE_ACCEPT", { status: "EXECUTED", teamId: 10, proposedDate: ACCEPTED })];
    const at = (t: number) => tradeHistory(rows(), [acq("x", "10", t), acq("y", "6", t)], ctx()).trades[0]?.refilled === true;
    expect(at(ACCEPTED - REFILL_EARLY_MS)).toBe(true);
    expect(at(ACCEPTED - REFILL_EARLY_MS - 1)).toBe(false);
    expect(at(ACCEPTED + 24 * H + REFILL_LATE_MS)).toBe(true);
    expect(at(ACCEPTED + 24 * H + REFILL_LATE_MS + 1)).toBe(false);
  });

  it("needs the parties to fit: two receiving teams must include every team the rows name", () => {
    const others = () => [acq("x", "3", WENT_THROUGH), acq("y", "4", WENT_THROUGH)];
    const rows = [row("a", "TRADE_ACCEPT", { status: "EXECUTED", teamId: 10, proposedDate: ACCEPTED })];
    const h = tradeHistory(rows, others(), ctx());
    expect(h.trades).toEqual([{ id: "a", type: "trade", week: 4, timestamp: new Date(ACCEPTED).toISOString(), teams: ["10"], moves: [] }]);
    expect(h).toMatchObject({ rebuilt: [], partnerUnknown: [], withoutPlayers: 1, unconfirmed: 1 });
    // The live rows (Team 10 accepted; the vote names no party): not matched either, so unresolved after the review.
    expect(tradeHistory(liveRows(), others(), ctx({ now: ACCEPTED + 49 * H }))).toMatchObject({ trades: [], unresolved: 1, rebuilt: [] });
  });

  it("rebuilds one side when the other side's players have left their new roster: the other party from the rows", () => {
    // Team 10 accepted; only the player Team 6 received is still on a roster.
    const h = tradeHistory(liveRows(), [acq("wr6", "6", WENT_THROUGH, "WR")], ctx());
    expect(h.trades[0]).toMatchObject({ teams: ["6", "10"], refilled: true, moves: [{ playerId: "wr6", from: "10", to: "6", pos: "WR" }, { playerId: "dropped", from: "10", to: null }] });
    expect(h.rebuilt[0]?.oneSided).toEqual({ receivedBy: "6", otherSide: "10" });
  });

  it("takes the other side of a one-sided match from ESPN's trade counters only when exactly one other team is short; else lists it for the receiving team, its partner unknown (review Track C 3)", () => {
    const rows = () => [row("a", "TRADE_ACCEPT", { status: "EXECUTED", teamId: 6, proposedDate: ACCEPTED })];
    const one = tradeHistory(rows(), [acq("x", "6", WENT_THROUGH)], ctx({ tradeCounters: new Map([["6", 1], ["9", 1], ["3", 0]]) }));
    expect(one.trades[0]).toMatchObject({ teams: ["6", "9"], refilled: true, moves: [{ playerId: "x", from: "9", to: "6" }] });
    expect(one.rebuilt[0]?.oneSided).toEqual({ receivedBy: "6", otherSide: "9" });
    expect(one).toMatchObject({ partnerUnknown: [], withoutPlayers: 0, unconfirmed: 0 });
    const two = tradeHistory(rows(), [acq("x", "6", WENT_THROUGH)], ctx({ tradeCounters: new Map([["6", 1], ["9", 1], ["3", 1]]) }));
    expect(two.trades).toEqual([{ id: "a", type: "trade", week: 4, timestamp: "2026-10-01T00:08:01.139Z", teams: ["6"], moves: [] }]);
    // The rosters show it went through (confirmed), just not who sent the players: not "without players" in the rosters' sense.
    expect(two.partnerUnknown).toEqual([{ tx: two.trades[0], receivedBy: "6" }]);
    expect(two).toMatchObject({ withoutPlayers: 0, unconfirmed: 0, rebuilt: [] });
  });

  it("with more than two receiving teams at one instant, takes the two named parties' players and leaves the rest", () => {
    const acquisitions = [...liveAcquisitions(), acq("other", "2", WENT_THROUGH + 1000)];
    const h = tradeHistory(liveRows(), acquisitions, ctx({ now: ACCEPTED + 49 * H }));
    // Known parties are only Team 10 (the acceptor): three receiving teams can't be split.
    expect(h.rebuilt).toEqual([]);
    const named = [row("a", "TRADE_ACCEPT", { status: "EXECUTED", teamId: 10, proposedDate: ACCEPTED, moves: [drop("d", "10")] }), row("b", "TRADE_ACCEPT", { status: "EXECUTED", teamId: 6, relatedTransactionId: "a" })];
    const split = tradeHistory(named, acquisitions, ctx());
    expect(split.trades[0]).toMatchObject({ teams: ["6", "10"], refilled: true });
    expect(split.trades[0]?.moves.map((m) => m.playerId)).toEqual(["wr6", "rb10", "wr10", "d"]);
  });

  it("gives each trade the closest cluster (to its processDate, else its acceptance + the review period), each cluster once", () => {
    const early = row("early", "TRADE_ACCEPT", { relatedTransactionId: "p1", teamId: 10, proposedDate: ACCEPTED });
    const late = row("late", "TRADE_ACCEPT", { relatedTransactionId: "p2", teamId: 10, proposedDate: ACCEPTED + 3 * H });
    const first = [acq("a1", "10", ACCEPTED + 24 * H), acq("b1", "6", ACCEPTED + 24 * H)];
    const second = [acq("a2", "10", ACCEPTED + 27 * H), acq("b2", "6", ACCEPTED + 27 * H)];
    const h = tradeHistory([late, early], [...second, ...first], ctx({ now: ACCEPTED + 49 * H }));
    const byId = new Map(h.trades.map((t) => [t.id, t.moves.map((m) => m.playerId).sort()]));
    expect(byId.get("early")).toEqual(["a1", "b1"]);
    expect(byId.get("late")).toEqual(["a2", "b2"]);
  });

  it("keeps the players of one trade together within a minute, and apart beyond it", () => {
    const rows = () => [row("a", "TRADE_ACCEPT", { status: "EXECUTED", teamId: 10, proposedDate: ACCEPTED })];
    const near = tradeHistory(rows(), [acq("x", "10", WENT_THROUGH), acq("y", "6", WENT_THROUGH + TRADE_CLUSTER_MS)], ctx());
    expect(near.trades[0]?.teams).toEqual(["6", "10"]);
    // Apart: the closer cluster holds only Team 10's player, whose giver nothing names (no counters): no rebuild,
    // listed for Team 10 with its partner unknown.
    const apart = tradeHistory(rows(), [acq("x", "10", WENT_THROUGH), acq("y", "6", WENT_THROUGH + TRADE_CLUSTER_MS + 1)], ctx());
    expect(apart.trades).toEqual([{ id: "a", type: "trade", week: 4, timestamp: "2026-10-01T00:08:01.139Z", teams: ["10"], moves: [] }]);
    expect(apart).toMatchObject({ withoutPlayers: 0, unconfirmed: 0, rebuilt: [], partnerUnknown: [{ receivedBy: "10" }] });
  });
});

describe("tradeHistory: trades with their players (the user's own)", () => {
  const legs = [leg("p1", "3", "9"), leg("p2", "9", "3")];

  it("counts an accept and an uphold of the same legs once, confirmed when the rosters show every leg (no extra trade from those acquisitions)", () => {
    const rows = [row("a", "TRADE_ACCEPT", { status: "EXECUTED", teamId: 3, processDate: WENT_THROUGH, moves: legs }), row("u", "TRADE_UPHOLD", { status: "EXECUTED", teamId: 2, moves: legs })];
    const h = tradeHistory(rows, [acq("p1", "9", WENT_THROUGH), acq("p2", "3", WENT_THROUGH)], ctx({ activatedAt: 0, weekOf: () => 4, tradeCounters: new Map([["3", 2], ["9", 2]]) }));
    expect(h.trades).toEqual([{ id: "a", type: "trade", week: 4, timestamp: "2026-10-01T00:08:01.139Z", teams: ["3", "9"], moves: [{ playerId: "p1", from: "3", to: "9" }, { playerId: "p2", from: "9", to: "3" }] }]);
    expect(h).toMatchObject({ unconfirmed: 0, withoutPlayers: 0, rebuilt: [] });
    // Without the players on those rosters it is still completed (EXECUTED), just unconfirmed.
    expect(tradeHistory(rows, [], ctx())).toMatchObject({ unconfirmed: 1, withoutPlayers: 0 });
  });

  it("a member's vote (EXECUTED UPHOLD) doesn't complete a trade with legs: in review mid-period, unresolved after it without the players on the rosters, completed once they are (review Track C 1)", () => {
    const rows = () => [
      row("acc", "TRADE_ACCEPT", { teamId: 9, relatedTransactionId: "prop", proposedDate: ACCEPTED, moves: legs }),
      row("vote", "TRADE_UPHOLD", { status: "EXECUTED", teamId: 2, relatedTransactionId: "prop", proposedDate: VOTED }),
    ];
    expect(tradeHistory(rows(), [], ctx({ now: VOTED + H }))).toMatchObject({ trades: [], pending: 1, unresolved: 0, unconfirmed: 0 });
    // Vetoed (or its players gone since): not counted once the review and the slack are over.
    expect(tradeHistory(rows(), [], ctx({ now: ACCEPTED + 24 * H + REFILL_LATE_MS + 1 }))).toMatchObject({ trades: [], pending: 0, unresolved: 1 });
    // Every leg on its new roster: completed at that instant, its parties from the legs (never the voter).
    const done = tradeHistory(rows(), [acq("p1", "9", WENT_THROUGH), acq("p2", "3", WENT_THROUGH)], ctx());
    expect(done.trades).toEqual([{ id: "acc", type: "trade", week: 4, timestamp: "2026-10-01T00:08:01.139Z", teams: ["9", "3"], moves: [{ playerId: "p1", from: "3", to: "9" }, { playerId: "p2", from: "9", to: "3" }] }]);
    expect(done).toMatchObject({ pending: 0, unconfirmed: 0 });
    // An EXECUTED accept still completes it (Phase 1), with or without the players on the rosters.
    const executed = [row("acc", "TRADE_ACCEPT", { status: "EXECUTED", teamId: 9, relatedTransactionId: "prop", processDate: WENT_THROUGH, moves: legs }), rows()[1] as TradeRow];
    expect(tradeHistory(executed, [], ctx())).toMatchObject({ trades: [{ id: "acc", teams: ["9", "3"] }], pending: 0, unconfirmed: 1 });
  });

  it("a trade only partly on the rosters (a player dropped since) is completed with all its legs from the rows, never also rebuilt as a trade only the rosters show", () => {
    const three = [leg("p1", "3", "9"), leg("p2", "9", "3"), leg("p3", "9", "3")];
    const rows = [row("acc", "TRADE_ACCEPT", { teamId: 9, relatedTransactionId: "prop", proposedDate: ACCEPTED, moves: three }), row("vote", "TRADE_UPHOLD", { status: "EXECUTED", teamId: 2, relatedTransactionId: "prop", proposedDate: VOTED })];
    // p3 has left Team 3 since; ESPN's counters, the activation date and the week would let rule 5 rebuild the other two.
    const full = ctx({ now: ACCEPTED + 72 * H, activatedAt: 0, weekOf: () => 4, tradeCounters: new Map([["3", 1], ["9", 1]]) });
    const h = tradeHistory(rows, [acq("p1", "9", WENT_THROUGH), acq("p2", "3", WENT_THROUGH)], full);
    expect(h.trades).toEqual([{ id: "acc", type: "trade", week: 4, timestamp: "2026-10-01T00:08:01.139Z", teams: ["9", "3"], moves: toTransactionMoves(three) }]);
    expect(h).toMatchObject({ pending: 0, unresolved: 0, unconfirmed: 0, rebuilt: [] });
    // One side's players alone (Team 3's both gone) still match it.
    expect(tradeHistory(rows, [acq("p1", "9", WENT_THROUGH)], full).trades.map((t) => t.id)).toEqual(["acc"]);
  });

  it("a vetoed trade redone with some of the same players: the players' move goes to the redo, closest to when it should have gone through", () => {
    // A (vetoed): p1 + p2 for p3, accepted first. B (the redo, went through 24 hours after its acceptance): p1 for p3 + p4; p4 dropped since.
    const a = row("a", "TRADE_ACCEPT", { teamId: 9, relatedTransactionId: "pa", proposedDate: ACCEPTED, moves: [leg("p1", "3", "9"), leg("p2", "3", "9"), leg("p3", "9", "3")] });
    const bAccepted = ACCEPTED + 2 * H;
    const b = row("b", "TRADE_ACCEPT", { teamId: 9, relatedTransactionId: "pb", proposedDate: bAccepted, moves: [leg("p1", "3", "9"), leg("p3", "9", "3"), leg("p4", "9", "3")] });
    const moved = bAccepted + 24 * H - 13_000;
    const h = tradeHistory([a, b], [acq("p1", "9", moved), acq("p3", "3", moved)], ctx({ now: bAccepted + 72 * H }));
    expect(h.trades.map((t) => [t.id, t.timestamp])).toEqual([["b", new Date(moved).toISOString()]]);
    expect(h).toMatchObject({ pending: 0, unresolved: 1, unconfirmed: 0 });
  });

  it("completes a trade still marked in review once every leg's player is on his new roster, at that instant", () => {
    const rows = [row("a", "TRADE_ACCEPT", { teamId: 3, proposedDate: ACCEPTED, moves: legs })];
    expect(tradeHistory(rows, [], ctx({ now: ACCEPTED + H }))).toMatchObject({ trades: [], pending: 1 });
    const h = tradeHistory(rows, [acq("p1", "9", WENT_THROUGH), acq("p2", "3", WENT_THROUGH)], ctx());
    expect(h.trades[0]).toMatchObject({ id: "a", timestamp: "2026-10-01T00:08:01.139Z", teams: ["3", "9"] });
    expect(h.trades[0]).not.toHaveProperty("refilled");
    expect(h).toMatchObject({ pending: 0, unconfirmed: 0 });
  });
});

describe("tradeHistory: trades only the rosters show", () => {
  const counters = new Map([["2", 1], ["10", 1], ["5", 0]]);
  const swap = () => [acq("rb2", "2", WENT_THROUGH, "RB"), acq("rb10", "10", WENT_THROUGH, "RB")];
  const full = (over: Partial<TradeContext> = {}) => ctx({ activatedAt: WENT_THROUGH - 60 * 24 * H, weekOf: () => 4, tradeCounters: counters, ...over });

  it("rebuilds a two-team cluster this season when both teams' ESPN counters exceed the trades listed", () => {
    const h = tradeHistory([], swap(), full());
    expect(h.trades).toEqual([
      {
        id: `espn-roster-trade:${WENT_THROUGH}:2-10`,
        type: "trade",
        week: 4,
        timestamp: "2026-10-01T00:08:01.139Z",
        teams: ["2", "10"],
        moves: [
          { playerId: "rb2", from: "10", to: "2", pos: "RB" },
          { playerId: "rb10", from: "2", to: "10", pos: "RB" },
        ],
        refilled: true,
      },
    ]);
    expect(h.rebuilt).toEqual([{ tx: h.trades[0], source: "rosters" }]);
    expect(h).toMatchObject({ unconfirmed: 0, withoutPlayers: 0 });
  });

  it("doesn't without the league's activation date, before it (an earlier season's trade), without a week, past the counters, or with other than two teams", () => {
    expect(tradeHistory([], swap(), full({ activatedAt: undefined })).trades).toEqual([]);
    expect(tradeHistory([], swap(), { ...full(), activatedAt: WENT_THROUGH + 1 }).trades).toEqual([]);
    expect(tradeHistory([], swap(), full({ weekOf: () => null })).trades).toEqual([]);
    expect(tradeHistory([], swap(), full({ weekOf: undefined })).trades).toEqual([]);
    expect(tradeHistory([], swap(), full({ tradeCounters: new Map([["2", 1], ["10", 0]]) })).trades).toEqual([]);
    expect(tradeHistory([], [...swap(), acq("x", "5", WENT_THROUGH)], full()).trades).toEqual([]);
    // A listed trade already accounts for the counters: no second one from the same players.
    const listed = [row("a", "TRADE_ACCEPT", { status: "EXECUTED", teamId: 10, proposedDate: ACCEPTED - 40 * 24 * H })];
    const h = tradeHistory(listed, swap(), full());
    expect(h.trades.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("tradeKeys and legsKey", () => {
  it("key a trade by its own id, the proposal it answers and its legs; else by team and period", () => {
    const moves = [leg("2", "1", "3"), leg("1", "3", "1"), drop("9", "1")];
    expect(legsKey(moves)).toBe("1:3>1|2:1>3");
    expect(tradeKeys({ id: "a", relatedTransactionId: "p", teamId: 1, scoringPeriodId: 4 }, "x")).toEqual(["tx:a", "tx:p", "legs:x"]);
    expect(tradeKeys({ id: "a", relatedTransactionId: null, teamId: 1, scoringPeriodId: 4 }, "")).toEqual(["tx:a", "team:1@4"]);
  });
});
