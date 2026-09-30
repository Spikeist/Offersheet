/**
 * Pure helpers for the Sleeper probe's checks: lineup slots, schedule pairs, records, brackets,
 * transactions and pick ownership. No I/O; unit-tested in analyze.test.ts.
 */
import type { SleeperBracketMatch, SleeperMatchup, SleeperRoster, SleeperTradedPick, SleeperTransaction } from "./types";

/** Slot → eligible positions. Platform knowledge (not in the API); checked against real lineups. */
export const SLOT_ELIGIBLE: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  DL: ["DL"],
  LB: ["LB"],
  DB: ["DB"],
  FLEX: ["RB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  REC_FLEX: ["WR", "TE"],
  WRRB_FLEX: ["WR", "RB"],
  IDP_FLEX: ["DL", "LB", "DB"],
};
/** Non-starting entries of roster_positions. */
export const NON_STARTING = new Set(["BN"]);

export function slotCounts(rosterPositions: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of rosterPositions) out[s] = (out[s] ?? 0) + 1;
  return out;
}

export function unknownSlots(rosterPositions: string[]): string[] {
  return [...new Set(rosterPositions.filter((s) => !NON_STARTING.has(s) && !SLOT_ELIGIBLE[s]))];
}

export interface WeekPairs {
  week: number;
  entries: number;
  /** Matchup IDs with exactly two rosters. */
  pairs: Array<[number, number]>;
  nullIds: number;
  /** Placeholder-only descriptions of anything odd (IDs with 1 or 3+ rosters). */
  problems: string[];
  pointsTotal: number;
}

export function matchupPairs(week: number, rows: SleeperMatchup[]): WeekPairs {
  const byId = new Map<number, number[]>();
  let nullIds = 0;
  let pointsTotal = 0;
  for (const r of rows) {
    pointsTotal += r.points ?? 0;
    if (r.matchup_id === null || r.matchup_id === undefined) {
      nullIds++;
      continue;
    }
    byId.set(r.matchup_id, [...(byId.get(r.matchup_id) ?? []), r.roster_id]);
  }
  const pairs: Array<[number, number]> = [];
  const problems: string[] = [];
  for (const [id, ros] of [...byId].sort((a, b) => a[0] - b[0])) {
    if (ros.length === 2) pairs.push([ros[0] as number, ros[1] as number]);
    else problems.push(`matchup_id ${id} has ${ros.length} roster(s)`);
  }
  return { week, entries: rows.length, pairs, nullIds, problems, pointsTotal };
}

export interface Record3 {
  w: number;
  l: number;
  t: number;
  pf: number;
  pa: number;
}

/** W-L-T and points for/against from completed weeks' matchups (head-to-head, optional median game). */
export function recordsFromMatchups(weeks: Array<{ week: number; rows: SleeperMatchup[] }>, medianGame: boolean): Map<number, Record3> {
  const out = new Map<number, Record3>();
  const rec = (id: number) => {
    let r = out.get(id);
    if (!r) {
      r = { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
      out.set(id, r);
    }
    return r;
  };
  for (const { rows } of weeks) {
    const byId = new Map<number, SleeperMatchup[]>();
    for (const r of rows) {
      rec(r.roster_id).pf += r.points ?? 0;
      if (r.matchup_id !== null && r.matchup_id !== undefined) byId.set(r.matchup_id, [...(byId.get(r.matchup_id) ?? []), r]);
    }
    for (const pair of byId.values()) {
      if (pair.length !== 2) continue;
      const [a, b] = pair as [SleeperMatchup, SleeperMatchup];
      const pa = a.points ?? 0;
      const pb = b.points ?? 0;
      rec(a.roster_id).pa += pb;
      rec(b.roster_id).pa += pa;
      if (pa > pb) {
        rec(a.roster_id).w++;
        rec(b.roster_id).l++;
      } else if (pb > pa) {
        rec(b.roster_id).w++;
        rec(a.roster_id).l++;
      } else {
        rec(a.roster_id).t++;
        rec(b.roster_id).t++;
      }
    }
    if (medianGame && rows.length) {
      const sorted = rows.map((r) => r.points ?? 0).sort((x, y) => x - y);
      const mid = sorted.length / 2;
      const median = sorted.length % 2 ? (sorted[Math.floor(mid)] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
      for (const r of rows) {
        const p = r.points ?? 0;
        if (p > median) rec(r.roster_id).w++;
        else if (p < median) rec(r.roster_id).l++;
        else rec(r.roster_id).t++;
      }
    }
  }
  return out;
}

/** Sleeper splits points into an integer and hundredths: fpts + fpts_decimal / 100. */
export function rosterPoints(settings: SleeperRoster["settings"]): { pf: number; pa: number } {
  return {
    pf: (settings.fpts ?? 0) + (settings.fpts_decimal ?? 0) / 100,
    pa: (settings.fpts_against ?? 0) + (settings.fpts_against_decimal ?? 0) / 100,
  };
}

export interface BracketShape {
  matches: number;
  rounds: number;
  /** Distinct roster IDs placed directly into the bracket (seeded teams). */
  seededTeams: number;
  firstRoundTeams: number;
  /** Teams that enter after round 1 without coming from a match (first-round byes). */
  byes: number;
  placementGames: number;
  decided: number;
}

/** Structure of a winners/losers bracket: rounds, byes, placement games (p = 1, 3, 5…). */
export function bracketShape(rows: SleeperBracketMatch[]): BracketShape {
  const r1 = rows.filter((m) => m.r === 1);
  const firstRoundTeams = new Set<number>();
  for (const m of r1) for (const t of [m.t1, m.t2]) if (typeof t === "number") firstRoundTeams.add(t);
  const byeTeams = new Set<number>();
  const seeded = new Set<number>(firstRoundTeams);
  for (const m of rows.filter((x) => x.r > 1)) {
    const rec = m as SleeperBracketMatch & { t1_from?: unknown; t2_from?: unknown };
    if (typeof m.t1 === "number" && !rec.t1_from) {
      byeTeams.add(m.t1);
      seeded.add(m.t1);
    }
    if (typeof m.t2 === "number" && !rec.t2_from) {
      byeTeams.add(m.t2);
      seeded.add(m.t2);
    }
  }
  return {
    matches: rows.length,
    rounds: rows.reduce((mx, m) => Math.max(mx, m.r), 0),
    seededTeams: seeded.size,
    firstRoundTeams: firstRoundTeams.size,
    byes: byeTeams.size,
    placementGames: rows.filter((m) => typeof m.p === "number").length,
    decided: rows.filter((m) => typeof m.w === "number").length,
  };
}

export interface TxSummary {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  byTypeStatus: Record<string, number>;
  trades: SleeperTransaction[];
  /** Completed moves per roster: players added / dropped (from adds/drops maps). */
  perRoster: Map<number, { adds: number; drops: number; trades: number; waivers: number; freeAgents: number }>;
  firstCreated: number | null;
  lastCreated: number | null;
}

export function summarizeTransactions(txs: SleeperTransaction[]): TxSummary {
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byTypeStatus: Record<string, number> = {};
  const perRoster: TxSummary["perRoster"] = new Map();
  const row = (id: number) => {
    let r = perRoster.get(id);
    if (!r) {
      r = { adds: 0, drops: 0, trades: 0, waivers: 0, freeAgents: 0 };
      perRoster.set(id, r);
    }
    return r;
  };
  let firstCreated: number | null = null;
  let lastCreated: number | null = null;
  for (const t of txs) {
    byType[t.type] = (byType[t.type] ?? 0) + 1;
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    byTypeStatus[`${t.type}/${t.status}`] = (byTypeStatus[`${t.type}/${t.status}`] ?? 0) + 1;
    firstCreated = firstCreated === null ? t.created : Math.min(firstCreated, t.created);
    lastCreated = lastCreated === null ? t.created : Math.max(lastCreated, t.created);
    if (t.status !== "complete") continue;
    for (const rid of Object.values(t.adds ?? {})) row(rid).adds++;
    for (const rid of Object.values(t.drops ?? {})) row(rid).drops++;
    for (const rid of t.roster_ids ?? []) {
      if (t.type === "trade") row(rid).trades++;
      else if (t.type === "waiver") row(rid).waivers++;
      else if (t.type === "free_agent") row(rid).freeAgents++;
    }
  }
  return { total: txs.length, byType, byStatus, byTypeStatus, trades: txs.filter((t) => t.type === "trade"), perRoster, firstCreated, lastCreated };
}

export interface PickOwnership {
  seasons: string[];
  rounds: number;
  /** Total picks in the assumed pool (teams × rounds × seasons). */
  total: number;
  /** Picks whose current owner differs from the original team. */
  moved: number;
  /** traded_picks rows outside the assumed pool (other seasons or rounds). */
  outside: number;
  /** Picks owned per roster after applying trades. */
  perRoster: Map<number, number>;
}

/**
 * Future pick ownership: every roster starts with its own pick in each (season, round); each
 * traded_picks row moves one pick (roster_id = original team, owner_id = current owner).
 */
export function pickOwnership(rosterIds: number[], seasons: string[], rounds: number, traded: SleeperTradedPick[]): PickOwnership {
  const owner = new Map<string, number>();
  for (const s of seasons) for (let r = 1; r <= rounds; r++) for (const id of rosterIds) owner.set(`${s}|${r}|${id}`, id);
  let outside = 0;
  for (const t of traded) {
    const key = `${t.season}|${t.round}|${t.roster_id}`;
    if (!owner.has(key)) {
      outside++;
      continue;
    }
    owner.set(key, t.owner_id);
  }
  const perRoster = new Map<number, number>(rosterIds.map((id) => [id, 0]));
  let moved = 0;
  for (const [key, cur] of owner) {
    perRoster.set(cur, (perRoster.get(cur) ?? 0) + 1);
    const orig = Number(key.split("|")[2]);
    if (orig !== cur) moved++;
  }
  return { seasons, rounds, total: owner.size, moved, outside, perRoster };
}

// ---------------------------------------------------------------------------------------------
// Projections: real rows vs ADP-only stubs, and coverage of rostered players

/** Stats keys that are bookkeeping, not a projection (ADP ranks, games played). */
const PROJECTION_META_KEY = /^(adp_|pos_adp_|gp$|gs$|gms_active$)/;

/**
 * True when a /projections row carries a real projection: any stat other than ADP/games-played
 * bookkeeping. Sleeper also returns stub rows ({"adp_dd_ppr": 1000}, opponent null) for players
 * on bye, injured or without a team, so "has a row" is not "has a projection".
 */
export function hasProjection(stats: Record<string, number> | null | undefined): boolean {
  return !!stats && Object.keys(stats).some((k) => !PROJECTION_META_KEY.test(k));
}

/** Sleeper injury_status values for which Sleeper projects nothing (the player isn't expected to play). */
export const NOT_PLAYING_STATUSES: ReadonlySet<string> = new Set(["IR", "Out", "PUP", "NA", "Sus", "DNR", "COV"]);

export interface CoveragePlayer {
  id: string;
  /** NFL team code, or null for a player without a team. */
  team: string | null | undefined;
  /** Sleeper injury_status (null/"" = healthy). */
  injury: string | null | undefined;
  /** The week's projection row has a real projection (see hasProjection). */
  projected: boolean;
  /** The week has a row for the player at all (possibly an ADP-only stub). */
  hasRow: boolean;
  /** Players DB depth_chart_order (1 = starter; null/undefined = no entry). */
  depth?: number | null;
}

export interface Coverage {
  relevant: number;
  noTeam: string[];
  bye: string[];
  /** Players with a game this week, split by health and projection. */
  healthyProjected: string[];
  /** Healthy, no projection, and a starter or without a depth-chart entry: the real gaps. */
  healthyMissing: string[];
  /** Healthy backups (depth_chart_order 2+) without a projection: Sleeper doesn't project them. */
  backupMissing: string[];
  injuredProjected: string[];
  injuredMissing: string[];
  /** Rostered players whose only row is an ADP stub. */
  stubRows: number;
  /** Healthy players with a game, backups without a projection excluded: the denominator of `rate`. */
  expected: number;
  rate: number;
}

/**
 * Classify rostered players for one week, in this order: no NFL team → on bye (team not playing)
 * → projected → not projected, split into injured (expected zero), healthy backups (depth chart
 * 2+, which Sleeper doesn't project) and other healthy players (a real gap).
 */
export function classifyCoverage(players: CoveragePlayer[], teamsPlaying: ReadonlySet<string>): Coverage {
  const c: Coverage = { relevant: players.length, noTeam: [], bye: [], healthyProjected: [], healthyMissing: [], backupMissing: [], injuredProjected: [], injuredMissing: [], stubRows: 0, expected: 0, rate: 0 };
  for (const p of players) {
    if (p.hasRow && !p.projected) c.stubRows++;
    if (!p.team) c.noTeam.push(p.id);
    else if (!teamsPlaying.has(p.team)) c.bye.push(p.id);
    else {
      const injured = NOT_PLAYING_STATUSES.has(String(p.injury ?? ""));
      const backup = typeof p.depth === "number" && p.depth >= 2;
      (injured ? (p.projected ? c.injuredProjected : c.injuredMissing) : p.projected ? c.healthyProjected : backup ? c.backupMissing : c.healthyMissing).push(p.id);
    }
  }
  c.expected = c.healthyProjected.length + c.healthyMissing.length;
  c.rate = c.expected ? c.healthyProjected.length / c.expected : 0;
  return c;
}

// ---------------------------------------------------------------------------------------------
// Playoffs and schedule

/**
 * Last fantasy playoff week from settings.playoff_round_type (verified by probe:sleeper-codes):
 * 0 = one week per round, 1 = two-week championship, 2 = two weeks per round. Capped at NFL week 18.
 */
export function lastPlayoffWeek(playoffStart: number, rounds: number, roundType: number | undefined): number {
  const r = Math.max(rounds, 1);
  const weeks = roundType === 2 ? 2 * r : roundType === 1 ? r + 1 : r;
  return Math.min(18, playoffStart + weeks - 1);
}

/** Order-free key for a week's matchup pairs, e.g. "1-2|3-4". */
export function pairsKey(pairs: Array<[number, number]>): string {
  return pairs
    .map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`))
    .sort()
    .join("|");
}

/**
 * For each target week, the latest earlier week with exactly the same pairs (or null). Shows that
 * the pairs Sleeper returns for future playoff weeks are the regular-season round robin continued.
 */
export function repeatedPairWeeks(byWeek: Map<number, Array<[number, number]>>, targets: number[]): Map<number, number | null> {
  const out = new Map<number, number | null>();
  for (const t of targets) {
    const key = pairsKey(byWeek.get(t) ?? []);
    let found: number | null = null;
    if (key) for (const [w, pairs] of byWeek) if (w < t && pairsKey(pairs) === key && (found === null || w > found)) found = w;
    out.set(t, found);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Trades

export type TradeReview = "none" | "commissioner" | "league_vote";

/**
 * Normalized tradeReview (CLAUDE.md §4) from Sleeper settings, as verified by probe:sleeper-codes
 * (CODES.tradeReview): a veto poll opens only when veto_auto_poll = 1; otherwise trades process
 * without review whatever trade_review_days says. Sleeper has no commissioner-approval step.
 */
export function tradeReviewFromSettings(settings: Record<string, unknown>): TradeReview {
  return settings.veto_auto_poll === 1 ? "league_vote" : "none";
}

// ---------------------------------------------------------------------------------------------
// My team

export interface MyRoster {
  rosterId: number;
  via: "owner_id" | "co_owners";
}

/** CLAUDE.md §2.3: the roster whose owner_id matches the user, else one whose co_owners contains them. */
export function findMyRoster(rosters: SleeperRoster[], userId: string): MyRoster | null {
  const own = rosters.find((r) => r.owner_id === userId);
  if (own) return { rosterId: own.roster_id, via: "owner_id" };
  const co = rosters.find((r) => (r.co_owners ?? []).includes(userId));
  return co ? { rosterId: co.roster_id, via: "co_owners" } : null;
}

export interface MyTeamAudit {
  owners: { total: number; resolved: number };
  coOwners: { total: number; resolved: number };
  /** Users that appear on more than one roster (as owner or co-owner). */
  onSeveralRosters: number;
}

/** Run the my-team lookup for every owner and co-owner: each must resolve to their own roster. */
export function auditMyTeamLookup(rosters: SleeperRoster[]): MyTeamAudit {
  const audit: MyTeamAudit = { owners: { total: 0, resolved: 0 }, coOwners: { total: 0, resolved: 0 }, onSeveralRosters: 0 };
  const rostersPerUser = new Map<string, Set<number>>();
  const note = (uid: string, rid: number) => rostersPerUser.set(uid, new Set([...(rostersPerUser.get(uid) ?? []), rid]));
  for (const r of rosters) {
    if (r.owner_id) {
      audit.owners.total++;
      note(r.owner_id, r.roster_id);
      const m = findMyRoster(rosters, r.owner_id);
      if (m?.rosterId === r.roster_id && m.via === "owner_id") audit.owners.resolved++;
    }
    for (const co of r.co_owners ?? []) {
      audit.coOwners.total++;
      note(co, r.roster_id);
      const m = findMyRoster(rosters, co);
      if (m?.rosterId === r.roster_id && m.via === "co_owners") audit.coOwners.resolved++;
    }
  }
  audit.onSeveralRosters = [...rostersPerUser.values()].filter((s) => s.size > 1).length;
  return audit;
}

/** Count of values, sorted by count (for compact evidence samples). */
export function countBy<T>(items: Iterable<T>, key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of items) {
    const k = key(x);
    out[k] = (out[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/** Byes implied by a single-elimination bracket of n teams: next power of two minus n. */
export function impliedByes(n: number): number {
  if (n <= 1) return 0;
  let p = 1;
  while (p < n) p *= 2;
  return p === n ? 0 : p - n;
}
