/**
 * ESPN trades → Transaction[] (CLAUDE.md §2.2 "Transactions", §4), with the trade refill (Phase 4,
 * approved at Checkpoint 1): completed trades ESPN lists without their players get the players from the
 * rosters. PURE: no I/O, no clock (`now` is passed in).
 *
 * What ESPN sends (mTransactions2 and mRoster, seen live; minimized in fixtures/sanitized/min/espn/
 * trade-refill and public-league):
 * - A trade between two other teams has no TRADE items. The accepting team's TRADE_ACCEPT row carries
 *   only its roster-space DROP, and has no status both during the review period (Parker's league,
 *   2026-09-30) and after the trade went through (2026-10-01, 8 minutes after). ⚠️ An anonymous
 *   (public-link) import presumably sees the user's own trades the same way: ESPN can't tell who is
 *   looking. So nothing here assumes a trade without players is another team's.
 * - A member's vote is a row of its own: a TRADE_UPHOLD, EXECUTED, by a team that isn't in the trade
 *   (isLeagueManager false), cast mid-review; the trade still went through only when the 24-hour review
 *   ended. So an UPHOLD's team isn't a party, and an EXECUTED UPHOLD says the vote was counted, not that
 *   the trade went through: votes are cast before the outcome is known, so they never complete a trade
 *   (⚠️ one live trade; a league manager's UPHOLD hasn't been seen, and the rosters decide either way).
 * - The rosters show what moved: each player a trade moved has a roster entry with acquisitionType
 *   "TRADE" and acquisitionDate = the instant it went through, the same for all its players (Parker's
 *   league: 3 players at 2026-10-01 00:08:01.139 UTC, 24 hours less 13 seconds after the acceptance;
 *   the public test league: 2 players at one instant). ESPN's own per-team counters
 *   (teams[].transactionCounter.trades) count every trade.
 *
 * Rules:
 * 1. Rows: TRADE_ACCEPT and TRADE_UPHOLD rows that are EXECUTED, and accepts still without a status (or
 *    PENDING), grouped into trades by shared keys (tradeKeys: the proposal they answer, their own id, their
 *    legs). A trade's moves are the distinct ADD / DROP / TRADE items of its rows; its legs are the TRADE
 *    items with both teams. It is named by an accept row (an EXECUTED one first), else its first row.
 * 2. Parties: the accepting teams, teamActions' teams and the teams of its moves; never an UPHOLD's team.
 *    Its review runs from its last acceptance for the league's review period (tradeSettings.revisionHours);
 *    without an accept row, it ended by its first vote + that period (votes are cast during the review).
 * 3. A trade with legs (the user's own trades, with cookies) is completed when its TRADE_ACCEPT is
 *    EXECUTED or when every leg's player is on the receiving roster, acquired by trade no earlier than
 *    REFILL_EARLY_MS before the trade's first row. Those acquisitions are "explained" and take no further
 *    part. A vote never completes it. When only some of its players are there (one traded on or dropped
 *    since), it goes through rule 4's matching with the players its own legs name (player and receiving
 *    team): a match completes it with all its legs from the rows, at the instant they moved. Being
 *    matched closest first, a vetoed trade redone with some of the same players loses to the redo, whose
 *    review ended nearer that instant. Unmatched, it waits or is unresolved as in rule 4.
 * 4. A trade without legs (or rule 3's, as said there) is matched to a cluster of the other acquisitions
 *    by trade (members within TRADE_CLUSTER_MS of the first):
 *    - in its window, from REFILL_EARLY_MS before its first row to its last row + the review period +
 *      REFILL_LATE_MS;
 *    - with fitting parties: 2 receiving teams including every known party, or 1 receiving team and at
 *      most one known party besides it (the other side, whose players have left its roster since); with
 *      more than 2 receiving teams, the known parties' players when they are exactly 2 of them;
 *    - closest to when it should have gone through (its processDate, else the end of its review, else its
 *      last row), each trade and each acquisition used once.
 *    A match completes the trade and rebuilds it (`refilled`): every player received goes from the other
 *    party to the team whose roster he's on, the trade's time is the acquisition instant, its teams the 2
 *    parties. A one-sided match whose other party the rows don't name takes the only other team whose ESPN
 *    trade counter exceeds the trades listed for it; without exactly one, the trade is completed (the
 *    rosters show it went through) but listed for the receiving team alone, without players
 *    (`partnerUnknown`).
 *    Unmatched: an EXECUTED accept → completed without players. Anything else (nothing EXECUTED, or only
 *    votes) → still in review while its review (+ REFILL_LATE_MS) isn't over or its end is unknown (no
 *    review length, or no row time), else unresolved (vetoed, or its players dropped since): not counted.
 * 5. Acquisitions left over form trades the transaction list doesn't show at all (a period that didn't
 *    load): rebuilt from the rosters when a cluster has exactly 2 receiving teams, came after the league
 *    was activated for this season (status.activatedDate: a keeper's trade from an earlier season stays
 *    out), has a known NFL week, and both teams' ESPN trade counters exceed the trades listed for them.
 * A completed trade is "confirmed" when the rosters show it went through (rebuilt, partner unknown, or
 * its legs found: all, or some through rule 4); normalize.ts warns about the others
 * (ESPN_TRADES_UNVERIFIED). Every trade listed names at least one team.
 */
import type { Pos, Transaction } from "@/engine/model";
import type { EspnTransaction } from "./schema";

const HOUR_MS = 3_600_000;
/** The players of one trade share one acquisition instant (seen live); this much apart still counts as one trade. */
export const TRADE_CLUSTER_MS = 60_000;
/** Clock slack before a trade's first row (an acquisition can't come before the acceptance). */
export const REFILL_EARLY_MS = 5 * 60_000;
/** Slack after the review period ends (live: the trade went through at the end of it, 13 seconds early). */
export const REFILL_LATE_MS = 24 * HOUR_MS;

/** One ADD / DROP / TRADE item of a row; `trade` marks a TRADE item. */
export interface TradeMove {
  playerId: string;
  from: string | null;
  to: string | null;
  pos?: Pos;
  trade: boolean;
}

export interface TradeRow {
  row: Pick<EspnTransaction, "id" | "type" | "status" | "relatedTransactionId" | "scoringPeriodId" | "teamId" | "proposedDate" | "processDate" | "teamActions">;
  moves: TradeMove[];
}

/** A rostered player whose last acquisition was a trade: on team `teamId` since `at` (epoch ms). */
export interface TradeAcquisition {
  playerId: string;
  teamId: string;
  at: number;
  pos?: Pos;
}

export interface TradeContext {
  /** Epoch ms of the import. */
  now: number;
  /** settings.tradeSettings.revisionHours; undefined = not reported. */
  revisionHours?: number;
  /** status.activatedDate: the league's activation for this season (epoch ms). */
  activatedAt?: number;
  /** The NFL week of an instant, when the schedule is known. */
  weekOf?: (ms: number) => number | null;
  /** ESPN's own count of each team's trades this season (teams[].transactionCounter.trades). */
  tradeCounters: ReadonlyMap<string, number>;
}

/** A trade whose players came from the rosters. */
export interface RebuiltTrade {
  tx: Transaction;
  /** "rows": a listed trade without players; "rosters": a trade the transaction list doesn't show. */
  source: "rows" | "rosters";
  /** Only one side's received players are still on a roster: `receivedBy` got them from `otherSide`. */
  oneSided?: { receivedBy: string; otherSide: string };
}

/** A completed trade the rosters show one team receiving players in, whose other side nothing names (rule 4). */
export interface PartnerUnknownTrade {
  /** Listed for `receivedBy` (and any team its rows name) without players. */
  tx: Transaction;
  receivedBy: string;
}

export interface TradeHistory {
  /** Completed trades (not sorted). */
  trades: Transaction[];
  /** Accepted trades still in the review period (or waiting to go through). */
  pending: number;
  /** Accepted trades whose review period ended but whose players never showed up on the rosters. */
  unresolved: number;
  /** Completed trades without any players that the rosters don't show either (partnerUnknown excluded). */
  withoutPlayers: number;
  /** Completed trades the rosters show one team receiving players in, but not which team it traded with. */
  partnerUnknown: PartnerUnknownTrade[];
  /** Completed trades the rosters don't confirm. */
  unconfirmed: number;
  rebuilt: RebuiltTrade[];
}

const ACCEPT = "TRADE_ACCEPT";
const UPHOLD = "TRADE_UPHOLD";

const isExecuted = (r: TradeRow) => r.row.status === "EXECUTED";
const rowTime = (r: TradeRow): number | undefined => {
  const t = r.row.processDate ?? r.row.proposedDate;
  return typeof t === "number" && Number.isFinite(t) ? t : undefined;
};
const iso = (ms: number) => new Date(ms).toISOString();
const byTeamId = (a: string, b: string) => Number(a) - Number(b) || a.localeCompare(b);
const max = (xs: readonly number[]) => (xs.length ? Math.max(...xs) : undefined);
const min = (xs: readonly number[]) => (xs.length ? Math.min(...xs) : undefined);

/** "playerId:from>to|…" of the TRADE items, sorted: the same trade answered twice (accept + uphold) shares it. */
export function legsKey(moves: readonly TradeMove[]): string {
  return moves
    .filter((m) => m.trade)
    .map((m) => `${m.playerId}:${m.from}>${m.to}`)
    .sort()
    .join("|");
}

/** Keys that identify one trade across its rows: the proposal it answers, its own id, its trade legs, else team + period. */
export function tradeKeys(t: Pick<EspnTransaction, "id" | "relatedTransactionId" | "teamId" | "scoringPeriodId">, legs: string): string[] {
  const keys = [`tx:${t.id}`];
  if (t.relatedTransactionId) keys.push(`tx:${t.relatedTransactionId}`);
  if (legs) keys.push(`legs:${legs}`);
  if (!t.relatedTransactionId && !legs) keys.push(`team:${t.teamId}@${t.scoringPeriodId}`);
  return keys;
}

/** Rows sharing a key (transitively), groups in the order of their first row. */
function groupRows(rows: readonly TradeRow[]): TradeRow[][] {
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    while (parent[i] !== r) {
      const next = parent[i] as number;
      parent[i] = r;
      i = next;
    }
    return r;
  };
  const owner = new Map<string, number>();
  rows.forEach((r, i) => {
    for (const k of tradeKeys(r.row, legsKey(r.moves))) {
      const o = owner.get(k);
      if (o === undefined) owner.set(k, i);
      else {
        const [a, b] = [find(o), find(i)];
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  });
  const groups = new Map<number, TradeRow[]>();
  rows.forEach((r, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), r]);
  });
  return [...groups.keys()].sort((a, b) => a - b).map((k) => groups.get(k) as TradeRow[]);
}

interface Group {
  index: number;
  rows: TradeRow[];
  primary: TradeRow;
  /** An accept row is EXECUTED: ESPN says the trade went through (an EXECUTED UPHOLD is only a vote). */
  executedAccept: boolean;
  moves: TradeMove[];
  legs: TradeMove[];
  /** Parties the rows name, in row order (rule 2). */
  known: string[];
  firstAt?: number;
  lastAt?: number;
  /** When it should have gone through. */
  expectedAt?: number;
  /** When its review ended at the latest (rule 2); undefined when the period's length or its start is unknown. */
  reviewEndsAt?: number;
}

const timesOf = (rows: readonly TradeRow[]) => rows.map(rowTime).filter((t): t is number => t !== undefined);

function describe(rows: TradeRow[], index: number, reviewMs: number | undefined): Group {
  const accepts = rows.filter((r) => r.row.type === ACCEPT);
  const executed = rows.filter(isExecuted);
  const primary = accepts.find(isExecuted) ?? accepts[0] ?? executed[0] ?? (rows[0] as TradeRow);
  const moves: TradeMove[] = [];
  const seen = new Set<string>();
  for (const r of rows)
    for (const m of r.moves) {
      const key = `${m.trade ? "T" : "I"}:${m.playerId}:${m.from}>${m.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      moves.push(m);
    }
  const known: string[] = [];
  const add = (t: string | null | undefined) => {
    if (t && !known.includes(t)) known.push(t);
  };
  for (const a of accepts) add(String(a.row.teamId));
  for (const m of moves) {
    add(m.from);
    add(m.to);
  }
  for (const r of rows) for (const k of Object.keys(r.row.teamActions ?? {})) add(k);
  const times = timesOf(rows);
  const processed = rows.map((r) => r.row.processDate).filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  // The review starts at the last acceptance; without an accept row, the first vote bounds it (votes come during it).
  const reviewFrom = max(timesOf(accepts)) ?? min(timesOf(rows.filter((r) => r.row.type === UPHOLD)));
  const reviewEndsAt = reviewFrom !== undefined && reviewMs !== undefined ? reviewFrom + reviewMs : undefined;
  const firstAt = min(times);
  const lastAt = max(times);
  const expectedAt = max(processed) ?? reviewEndsAt ?? lastAt;
  return {
    index,
    rows,
    primary,
    executedAccept: accepts.some(isExecuted),
    moves,
    legs: moves.filter((m) => m.trade && m.from !== null && m.to !== null),
    known,
    ...(firstAt !== undefined ? { firstAt } : {}),
    ...(lastAt !== undefined ? { lastAt } : {}),
    ...(expectedAt !== undefined ? { expectedAt } : {}),
    ...(reviewEndsAt !== undefined ? { reviewEndsAt } : {}),
  };
}

/** Acquisitions within TRADE_CLUSTER_MS of their cluster's first, in time order (ties: team, then player). */
function clustersOf(acquisitions: readonly TradeAcquisition[]): TradeAcquisition[][] {
  const sorted = [...acquisitions].sort((a, b) => a.at - b.at || byTeamId(a.teamId, b.teamId) || a.playerId.localeCompare(b.playerId));
  const out: TradeAcquisition[][] = [];
  for (const a of sorted) {
    const last = out[out.length - 1];
    if (last && a.at - (last[0] as TradeAcquisition).at <= TRADE_CLUSTER_MS) last.push(a);
    else out.push([a]);
  }
  return out;
}

const teamsOf = (members: readonly TradeAcquisition[]) => [...new Set(members.map((m) => m.teamId))].sort(byTeamId);

type Outcome =
  | { kind: "completed"; confirmed: boolean; at?: number }
  | { kind: "rebuilt"; members: TradeAcquisition[]; parties: [string, string]; oneSided?: { receivedBy: string; otherSide: string } }
  | { kind: "matched"; members: TradeAcquisition[]; receivedBy: string }
  | { kind: "pending" }
  | { kind: "unresolved" };

/** The legs a cluster rebuilds: each member goes from the other party to his team; ordered by team, then player. */
function legsFrom(members: readonly TradeAcquisition[], parties: readonly [string, string]): TradeMove[] {
  return [...members]
    .sort((a, b) => byTeamId(a.teamId, b.teamId) || a.playerId.localeCompare(b.playerId))
    .map((m) => ({ playerId: m.playerId, from: m.teamId === parties[0] ? parties[1] : parties[0], to: m.teamId, ...(m.pos ? { pos: m.pos } : {}), trade: true }));
}

const toMoves = (moves: readonly TradeMove[]): Transaction["moves"] => moves.map(({ playerId, from, to, pos }) => ({ playerId, from, to, ...(pos ? { pos } : {}) }));

export function tradeHistory(rows: readonly TradeRow[], acquisitions: readonly TradeAcquisition[], ctx: TradeContext): TradeHistory {
  const reviewMs = typeof ctx.revisionHours === "number" && Number.isFinite(ctx.revisionHours) && ctx.revisionHours >= 0 ? ctx.revisionHours * HOUR_MS : undefined;
  const groups = groupRows(rows).map((g, i) => describe(g, i, reviewMs));
  const outcomes = new Map<number, Outcome>();
  const used = new Set<TradeAcquisition>();
  const byPlayer = new Map<string, TradeAcquisition[]>();
  for (const a of acquisitions) byPlayer.set(a.playerId, [...(byPlayer.get(a.playerId) ?? []), a]);

  /** Still waiting (within its review + slack, or when its end can't be told), else unresolved. */
  const waitingOrUnresolved = (g: Group): Outcome => (g.reviewEndsAt === undefined || ctx.now <= g.reviewEndsAt + REFILL_LATE_MS ? { kind: "pending" } : { kind: "unresolved" });

  // 3. Trades with legs: an EXECUTED accept, or every leg on its new roster. A vote completes nothing;
  // a trade only partly on the rosters goes on to rule 4 with its own players.
  for (const g of groups) {
    if (!g.legs.length) continue;
    const since = (g.firstAt ?? Number.NEGATIVE_INFINITY) - REFILL_EARLY_MS;
    const found = g.legs.map((l) => (byPlayer.get(l.playerId) ?? []).find((a) => a.teamId === l.to && a.at >= since && !used.has(a)));
    const confirmed = found.every((a) => a !== undefined);
    if (g.executedAccept || confirmed) {
      for (const a of found) if (a) used.add(a);
      const at = g.executedAccept ? undefined : min(found.map((a) => (a as TradeAcquisition).at));
      outcomes.set(g.index, { kind: "completed", confirmed, ...(at !== undefined ? { at } : {}) });
    }
  }

  // 4. Candidate clusters, then each trade and acquisition used once, closest first.
  const clusters = clustersOf(acquisitions.filter((a) => !used.has(a)));
  const candidates: Array<{ g: Group; members: TradeAcquisition[]; receivers: string[]; other?: string; d: number; c: number }> = [];
  for (const g of groups) {
    if (outcomes.has(g.index) || g.firstAt === undefined || g.lastAt === undefined) continue;
    const lo = g.firstAt - REFILL_EARLY_MS;
    const hi = g.lastAt + (reviewMs ?? 0) + REFILL_LATE_MS;
    clusters.forEach((cluster, c) => {
      const at = (cluster[0] as TradeAcquisition).at;
      if (at < lo || at > hi) return;
      const d = Math.abs(at - (g.expectedAt ?? at));
      if (g.legs.length) {
        // Rule 3's trade only partly on the rosters: the cluster's players its own legs name (player and receiving team).
        const own = cluster.filter((m) => g.legs.some((l) => l.playerId === m.playerId && l.to === m.teamId));
        if (own.length) candidates.push({ g, members: own, receivers: teamsOf(own), d, c });
        return;
      }
      let members = cluster;
      let receivers = teamsOf(members);
      if (receivers.length > 2) {
        if (g.known.length !== 2 || !g.known.every((t) => receivers.includes(t))) return;
        members = members.filter((m) => g.known.includes(m.teamId));
        receivers = teamsOf(members);
      }
      const outside = g.known.filter((t) => !receivers.includes(t));
      if (receivers.length === 2 ? outside.length > 0 : outside.length > 1) return;
      candidates.push({ g, members, receivers, ...(outside[0] !== undefined ? { other: outside[0] } : {}), d, c });
    });
  }
  candidates.sort((a, b) => a.d - b.d || a.g.index - b.g.index || a.c - b.c);
  for (const cand of candidates) {
    if (outcomes.has(cand.g.index) || cand.members.some((m) => used.has(m))) continue;
    for (const m of cand.members) used.add(m);
    const [a, b] = cand.receivers as [string, string?];
    // A trade with legs keeps all of them (from its rows), at the instant its players moved.
    if (cand.g.legs.length) outcomes.set(cand.g.index, { kind: "completed", confirmed: true, at: (cand.members[0] as TradeAcquisition).at });
    else if (b !== undefined) outcomes.set(cand.g.index, { kind: "rebuilt", members: cand.members, parties: [a, b] });
    else if (cand.other !== undefined)
      outcomes.set(cand.g.index, { kind: "rebuilt", members: cand.members, parties: [a, cand.other].sort(byTeamId) as [string, string], oneSided: { receivedBy: a, otherSide: cand.other } });
    else outcomes.set(cand.g.index, { kind: "matched", members: cand.members, receivedBy: a });
  }
  // Unmatched: an EXECUTED accept is completed without players; anything else (nothing EXECUTED, or only
  // votes, which are cast before the outcome is known) waits for its review to end, then is unresolved.
  for (const g of groups) if (!outcomes.has(g.index)) outcomes.set(g.index, g.executedAccept ? { kind: "completed", confirmed: false } : waitingOrUnresolved(g));

  // Build the listed trades; a one-sided match without a named other side takes the counters' only candidate.
  const trades: Transaction[] = [];
  const rebuilt: RebuiltTrade[] = [];
  const partnerUnknown: PartnerUnknownTrade[] = [];
  const confirmed = new Set<Transaction>();
  const listed = new Map<string, number>();
  const list = (tx: Transaction) => {
    trades.push(tx);
    for (const t of tx.teams) listed.set(t, (listed.get(t) ?? 0) + 1);
  };
  const extra = (t: string) => (ctx.tradeCounters.get(t) ?? 0) - (listed.get(t) ?? 0);
  const base = (g: Group): Omit<Transaction, "teams" | "moves" | "timestamp"> => ({ id: g.primary.row.id, type: "trade", week: g.primary.row.scoringPeriodId });
  const rowStamp = (g: Group) => iso(rowTime(g.primary) ?? g.lastAt ?? ctx.now);
  const deferred: Array<{ g: Group; members: TradeAcquisition[]; receivedBy: string }> = [];
  let pending = 0;
  let unresolved = 0;

  for (const g of groups) {
    const o = outcomes.get(g.index) as Outcome;
    if (o.kind === "pending") pending++;
    else if (o.kind === "unresolved") unresolved++;
    else if (o.kind === "completed") {
      const tx: Transaction = { ...base(g), timestamp: o.at !== undefined ? iso(o.at) : rowStamp(g), teams: [...g.known], moves: toMoves(g.moves) };
      list(tx);
      if (o.confirmed) confirmed.add(tx);
    } else if (o.kind === "rebuilt") {
      const at = (o.members[0] as TradeAcquisition).at;
      const tx: Transaction = { ...base(g), timestamp: iso(at), teams: [...o.parties], moves: toMoves([...legsFrom(o.members, o.parties), ...g.moves]), refilled: true };
      list(tx);
      confirmed.add(tx);
      rebuilt.push({ tx, source: "rows", ...(o.oneSided ? { oneSided: o.oneSided } : {}) });
    } else deferred.push({ g, members: o.members, receivedBy: o.receivedBy });
  }
  // Counted before any guess: each deferred trade's own known teams.
  for (const d of deferred) for (const t of new Set([...d.g.known, d.receivedBy])) listed.set(t, (listed.get(t) ?? 0) + 1);
  for (const d of deferred) {
    const teams = [...new Set([...d.g.known, d.receivedBy])];
    const others = [...ctx.tradeCounters.keys()].filter((t) => !teams.includes(t) && extra(t) > 0).sort(byTeamId);
    const other = others.length === 1 ? (others[0] as string) : undefined;
    const at = (d.members[0] as TradeAcquisition).at;
    if (other !== undefined) {
      const parties = [d.receivedBy, other].sort(byTeamId) as [string, string];
      const tx: Transaction = { ...base(d.g), timestamp: iso(at), teams: [...parties], moves: toMoves([...legsFrom(d.members, parties), ...d.g.moves]), refilled: true };
      trades.push(tx);
      listed.set(other, (listed.get(other) ?? 0) + 1);
      confirmed.add(tx);
      rebuilt.push({ tx, source: "rows", oneSided: { receivedBy: d.receivedBy, otherSide: other } });
    } else {
      // The rosters show it went through (confirmed), but not who sent the players: listed without them.
      const tx: Transaction = { ...base(d.g), timestamp: iso(at), teams, moves: toMoves(d.g.moves) };
      trades.push(tx);
      confirmed.add(tx);
      partnerUnknown.push({ tx, receivedBy: d.receivedBy });
    }
  }

  // 5. Trades only the rosters show.
  for (const cluster of clustersOf(acquisitions.filter((a) => !used.has(a)))) {
    const at = (cluster[0] as TradeAcquisition).at;
    const teams = teamsOf(cluster);
    const week = ctx.weekOf?.(at) ?? null;
    if (teams.length !== 2 || ctx.activatedAt === undefined || at < ctx.activatedAt || week === null) continue;
    if (!teams.every((t) => extra(t) > 0)) continue;
    const parties = teams as [string, string];
    const tx: Transaction = { id: `espn-roster-trade:${at}:${parties.join("-")}`, type: "trade", week, timestamp: iso(at), teams: [...parties], moves: toMoves(legsFrom(cluster, parties)), refilled: true };
    list(tx);
    confirmed.add(tx);
    rebuilt.push({ tx, source: "rosters" });
  }

  const partnerless = new Set(partnerUnknown.map((p) => p.tx));
  return {
    trades,
    pending,
    unresolved,
    withoutPlayers: trades.filter((t) => !partnerless.has(t) && !t.moves.some((m) => m.from !== null && m.to !== null)).length,
    partnerUnknown,
    unconfirmed: trades.filter((t) => !confirmed.has(t)).length,
    rebuilt,
  };
}

/** Exported for tests: a trade row's kind. */
export const TRADE_ROW_TYPES: ReadonlySet<string> = new Set([ACCEPT, UPHOLD]);
