/**
 * Pure analysis of projection and stat feeds (CLAUDE.md §2.2, §2.3, §6):
 * - Sleeper's undocumented /projections and /stats arrays.
 * - ESPN's league-default player pool (view=kona_player_info), whose players[].player.stats[]
 *   entries are keyed by statSourceId (0 actual, 1 projected), statSplitTypeId (0 season total,
 *   1 single week, 2 unexplained), seasonId and scoringPeriodId.
 */
import { countBy, isBlankId, median, round, utcDay } from "./util";

// ---------------------------------------------------------------- Sleeper

export interface SleeperStatRow {
  player_id: string;
  week?: number | null;
  season?: string | number;
  season_type?: string;
  category?: string;
  company?: string;
  stats?: Record<string, number>;
  last_modified?: number | null;
  updated_at?: number | null;
  team?: string | null;
  opponent?: string | null;
  game_id?: string | null;
  date?: string | null;
  player?: { position?: string | null; fantasy_positions?: string[] | null; team?: string | null; [k: string]: unknown } | null;
  [k: string]: unknown;
}

export function asRows(json: unknown): SleeperStatRow[] | null {
  return Array.isArray(json) ? (json as SleeperStatRow[]) : null;
}

export function rowPosition(r: SleeperStatRow): string {
  return r.player?.position ?? r.player?.fantasy_positions?.[0] ?? "?";
}

export type PositionGroup = "QB/RB/WR/TE" | "K" | "DEF" | "IDP" | "other";
const IDP_POSITIONS = new Set(["DL", "DE", "DT", "NT", "LB", "ILB", "OLB", "MLB", "DB", "CB", "S", "SS", "FS"]);

export function positionGroup(pos: string): PositionGroup {
  if (["QB", "RB", "WR", "TE"].includes(pos)) return "QB/RB/WR/TE";
  if (pos === "K" || pos === "DEF") return pos;
  return IDP_POSITIONS.has(pos) ? "IDP" : "other";
}

/**
 * Stats keys that are rankings, ADP, participation or Sleeper's own default-format points rather
 * than scorable stats. pts_allow* is NOT here: points allowed is a scorable team-defense stat.
 */
export const NON_SCORING_KEY = /^(adp_|pos_adp_|pos_rank_|tm_)|^pts_(ppr|half_ppr|std)$|^(gp|gs|gms_active|cmp_pct|off_snp|def_snp|st_snp)$/;

/** Scorable stat entries of a row (numeric values of keys a league could have a rule for). */
export function scorableStats(r: SleeperStatRow): Array<[string, number]> {
  return Object.entries(r.stats ?? {}).filter(([k, v]) => typeof v === "number" && !NON_SCORING_KEY.test(k));
}

/**
 * A row carries a real projection when it has any scorable stat (Sleeper also stamps exactly those
 * rows with last_modified). pts_* is NOT a projection flag: Sleeper omits pts_* when the default
 * formats score 0, which is true of most IDP stat lines.
 */
export function hasProjection(r: SleeperStatRow | undefined): boolean {
  return !!r && (typeof r.last_modified === "number" || scorableStats(r).length > 0);
}

export interface SleeperSummary {
  rows: number;
  distinctPlayers: number;
  byPosition: Record<string, number>;
  topLevelKeys: Record<string, number>;
  statKeys: Record<string, number>;
  withProjection: number;
  withPtsPpr: number;
  withPtsHalfPpr: number;
  withPtsStd: number;
  /** Rows with a projection (scorable stats) but no pts_ppr. */
  projectedWithoutPts: number;
  emptyStats: number;
  lastModifiedPresent: number;
  /** Rows with scorable stats but no last_modified, and the reverse (both 0 when they coincide). */
  statsWithoutLastModified: number;
  lastModifiedWithoutStats: number;
  lastModifiedByDay: Record<string, number>;
  updatedAtPresent: number;
  categories: Record<string, number>;
  companies: Record<string, number>;
  withPlayerObject: number;
  playerKeys: Record<string, number>;
  nullOpponent: number;
  weeks: Record<string, number>;
}

export function summarizeSleeper(rows: SleeperStatRow[]): SleeperSummary {
  const statKeys: Record<string, number> = {};
  const topLevelKeys: Record<string, number> = {};
  const playerKeys: Record<string, number> = {};
  const lastModifiedByDay: Record<string, number> = {};
  let withProjection = 0;
  let withPtsPpr = 0;
  let withPtsHalfPpr = 0;
  let withPtsStd = 0;
  let projectedWithoutPts = 0;
  let emptyStats = 0;
  let lastModifiedPresent = 0;
  let statsWithoutLastModified = 0;
  let lastModifiedWithoutStats = 0;
  let updatedAtPresent = 0;
  let withPlayerObject = 0;
  let nullOpponent = 0;
  for (const r of rows) {
    for (const k of Object.keys(r)) topLevelKeys[k] = (topLevelKeys[k] ?? 0) + 1;
    const stats = r.stats ?? {};
    const keys = Object.keys(stats);
    if (!keys.length) emptyStats++;
    for (const k of keys) statKeys[k] = (statKeys[k] ?? 0) + 1;
    const scorable = scorableStats(r).length > 0;
    const lm = typeof r.last_modified === "number";
    if (scorable || lm) withProjection++;
    if (scorable && !lm) statsWithoutLastModified++;
    if (lm && !scorable) lastModifiedWithoutStats++;
    if (typeof stats.pts_ppr === "number") withPtsPpr++;
    else if (scorable) projectedWithoutPts++;
    if (typeof stats.pts_half_ppr === "number") withPtsHalfPpr++;
    if (typeof stats.pts_std === "number") withPtsStd++;
    if (lm) {
      lastModifiedPresent++;
      const d = utcDay(r.last_modified as number);
      lastModifiedByDay[d] = (lastModifiedByDay[d] ?? 0) + 1;
    }
    if (typeof r.updated_at === "number") updatedAtPresent++;
    if (r.player && typeof r.player === "object") {
      withPlayerObject++;
      for (const k of Object.keys(r.player)) playerKeys[k] = (playerKeys[k] ?? 0) + 1;
    }
    if (isBlankId(r.opponent)) nullOpponent++;
  }
  return {
    rows: rows.length,
    distinctPlayers: new Set(rows.map((r) => r.player_id)).size,
    byPosition: countBy(rows, rowPosition),
    topLevelKeys,
    statKeys,
    withProjection,
    withPtsPpr,
    withPtsHalfPpr,
    withPtsStd,
    projectedWithoutPts,
    emptyStats,
    lastModifiedPresent,
    statsWithoutLastModified,
    lastModifiedWithoutStats,
    lastModifiedByDay: Object.fromEntries(Object.entries(lastModifiedByDay).sort(([a], [b]) => a.localeCompare(b))),
    updatedAtPresent,
    categories: countBy(rows, (r) => r.category),
    companies: countBy(rows, (r) => r.company),
    withPlayerObject,
    playerKeys,
    nullOpponent,
    weeks: countBy(rows, (r) => r.week),
  };
}

export interface RowSetComparison {
  onlyA: number;
  onlyB: number;
  both: number;
  sameStats: number;
  /** Rows whose stats differ AND whose last_modified differs: re-projected between the two calls. */
  updatedBetweenCalls: number;
  /** Rows whose stats differ with the same (or no) last_modified: a real difference between the queries. */
  unexplained: number;
}

/** Compare two projection sets (e.g. one multi-position call vs the union of single calls). */
export function compareRowSets(a: SleeperStatRow[], b: SleeperStatRow[]): RowSetComparison {
  const key = (r: SleeperStatRow) => r.player_id;
  const am = new Map(a.map((r) => [key(r), r]));
  const bm = new Map(b.map((r) => [key(r), r]));
  let both = 0;
  let sameStats = 0;
  let updatedBetweenCalls = 0;
  for (const [k, r] of am) {
    const o = bm.get(k);
    if (!o) continue;
    both++;
    if (JSON.stringify(sortObj(r.stats ?? {})) === JSON.stringify(sortObj(o.stats ?? {}))) sameStats++;
    else if (typeof r.last_modified === "number" && typeof o.last_modified === "number" && r.last_modified !== o.last_modified) updatedBetweenCalls++;
  }
  return {
    onlyA: [...am.keys()].filter((k) => !bm.has(k)).length,
    onlyB: [...bm.keys()].filter((k) => !am.has(k)).length,
    both,
    sameStats,
    updatedBetweenCalls,
    unexplained: both - sameStats - updatedBetweenCalls,
  };
}

function statLineKey(r: SleeperStatRow): string {
  return JSON.stringify(scorableStats(r).sort(([x], [y]) => x.localeCompare(y)));
}

/**
 * Per position group: players projected in both weeks, and how many have an identical projected
 * stat line (a flat per-player rate rather than a matchup-specific projection).
 */
export function flatnessByGroup(a: SleeperStatRow[], b: SleeperStatRow[]): Partial<Record<PositionGroup, { both: number; identical: number }>> {
  const bm = new Map(b.filter((r) => hasProjection(r)).map((r) => [r.player_id, r]));
  const out: Partial<Record<PositionGroup, { both: number; identical: number }>> = {};
  for (const r of a) {
    const o = bm.get(r.player_id);
    if (!o || !hasProjection(r)) continue;
    const g = (out[positionGroup(rowPosition(r))] ??= { both: 0, identical: 0 });
    g.both++;
    if (statLineKey(r) === statLineKey(o)) g.identical++;
  }
  return out;
}

export interface WeekShapeSpread {
  /** Players with pts_ppr > 0 in every week given. */
  players: number;
  /** Of those, players with the same pts_ppr in every week (flat). */
  identicalAll: number;
  medianMaxOverMin: number | null;
  p90MaxOverMin: number | null;
  /**
   * Players whose §6 week-shape factor m = clamp(S_w / mean S, lo, hi) differs from 1 by more than
   * 0.02 in at least one of the weeks (S = pts_ppr, standing in for league scoring).
   */
  mNotOne: number;
}

export function weekShapeSpread(weeks: SleeperStatRow[][], include: (r: SleeperStatRow) => boolean, clamp: [number, number] = [0.8, 1.2]): WeekShapeSpread {
  const maps = weeks.map((rows) => new Map(rows.map((r) => [r.player_id, r])));
  const ratios: number[] = [];
  let players = 0;
  let identicalAll = 0;
  let mNotOne = 0;
  for (const r of weeks[0] ?? []) {
    if (!include(r)) continue;
    const vals = maps.map((m) => m.get(r.player_id)?.stats?.pts_ppr);
    if (!vals.every((v): v is number => typeof v === "number" && v > 0)) continue;
    players++;
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    ratios.push(max / min);
    if (max === min) identicalAll++;
    const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
    if (vals.some((v) => Math.abs(Math.min(clamp[1], Math.max(clamp[0], v / mean)) - 1) > 0.02)) mNotOne++;
  }
  ratios.sort((x, y) => x - y);
  const q = (p: number) => (ratios.length ? round(ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * p))] as number, 3) : null);
  return { players, identicalAll, medianMaxOverMin: q(0.5), p90MaxOverMin: q(0.9), mNotOne };
}

export interface InjuryBucket {
  players: number;
  /** Projected in the current week. */
  now: number;
  /** Projected in the next week. */
  next: number;
  /** Projected in at least one of the later weeks (the relevance control). */
  projectedLater: number;
  /** Of those projected later, projected now as well. */
  projectedLaterAndNow: number;
  /** Median of next-week pts_ppr ÷ mean later-week pts_ppr, over players with both. */
  medianNextOverLater: number | null;
  ratioPlayers: number;
}

/**
 * How Sleeper's projections treat players by injury status: projected now / next week / later, with
 * a relevance control (only players Sleeper projects in a later week) and whether next week's value
 * is already reduced relative to later weeks.
 */
export function injuryTable(players: Array<{ id: string; status: string }>, now: Map<string, SleeperStatRow>, next: Map<string, SleeperStatRow>, later: Array<Map<string, SleeperStatRow>>): Record<string, InjuryBucket> {
  const out: Record<string, InjuryBucket & { ratios: number[] }> = {};
  for (const { id, status } of players) {
    const b = (out[status] ??= { players: 0, now: 0, next: 0, projectedLater: 0, projectedLaterAndNow: 0, medianNextOverLater: null, ratioPlayers: 0, ratios: [] });
    b.players++;
    const isNow = hasProjection(now.get(id));
    if (isNow) b.now++;
    if (hasProjection(next.get(id))) b.next++;
    if (later.some((m) => hasProjection(m.get(id)))) {
      b.projectedLater++;
      if (isNow) b.projectedLaterAndNow++;
    }
    const n = next.get(id)?.stats?.pts_ppr;
    const l = later.map((m) => m.get(id)?.stats?.pts_ppr).filter((v): v is number => typeof v === "number" && v > 0);
    if (typeof n === "number" && n > 0 && l.length) b.ratios.push(n / (l.reduce((x, y) => x + y, 0) / l.length));
  }
  return Object.fromEntries(
    Object.entries(out).map(([k, { ratios, ...b }]) => {
      const m = median(ratios);
      return [k, { ...b, medianNextOverLater: m === null ? null : round(m, 3), ratioPlayers: ratios.length }];
    }),
  );
}

/**
 * Standard offensive rules over Sleeper stat keys: pass yd 0.04, pass TD 4, INT `intPts` (Sleeper's
 * default −1), rush/rec yd 0.1, TD 6, 2-pt 2, fumble lost −2, plus `perReception`.
 */
export function sleeperStdScore(stats: Record<string, number>, perReception: number, intPts = -1): number {
  const g = (k: string) => stats[k] ?? 0;
  return (
    g("pass_yd") * 0.04 +
    g("pass_td") * 4 +
    g("pass_int") * intPts +
    g("pass_2pt") * 2 +
    g("rush_yd") * 0.1 +
    g("rush_td") * 6 +
    g("rush_2pt") * 2 +
    g("rec") * perReception +
    g("rec_yd") * 0.1 +
    g("rec_td") * 6 +
    g("rec_2pt") * 2 +
    g("fum_lost") * -2
  );
}

export interface PtsFit {
  field: "pts_ppr" | "pts_half_ppr" | "pts_std";
  compared: number;
  within005: number;
  within01: number;
  /** Stat keys most common on the rows that don't fit (to explain the leftovers). */
  misfitKeys: string[];
}

export function fitSleeperPts(rows: SleeperStatRow[]): PtsFit[] {
  const fields = [
    ["pts_ppr", 1],
    ["pts_half_ppr", 0.5],
    ["pts_std", 0],
  ] as const;
  return fields.map(([field, perReception]) => {
    let compared = 0;
    let within005 = 0;
    let within01 = 0;
    const keys: Record<string, number> = {};
    for (const r of rows) {
      const stats = r.stats ?? {};
      const target = stats[field];
      if (typeof target !== "number") continue;
      compared++;
      const d = Math.abs(sleeperStdScore(stats, perReception) - target);
      if (d <= 0.051) within005++;
      if (d <= 0.101) within01++;
      else for (const k of Object.keys(stats)) if (!/^(pts_|pos_rank_|adp_|pos_adp_|gp$|gs$|gms_active$|tm_|off_snp|def_snp|st_snp)/.test(k)) keys[k] = (keys[k] ?? 0) + 1;
    }
    const misfitKeys = Object.entries(keys)
      .sort(([, x], [, y]) => y - x)
      .slice(0, 8)
      .map(([k, n]) => `${k}×${n}`);
    return { field, compared, within005, within01, misfitKeys };
  });
}

function sortObj(o: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(o).sort(([x], [y]) => x.localeCompare(y)));
}

/** How rows for teams on bye look: present or absent, with or without stats/opponent. */
export function byeRows(
  rows: SleeperStatRow[],
  byeTeams: string[],
): { rows: number; onlyNonScoringStats: number; withProjection: number; withPts: number; nullOpponent: number; nullGameId: number; defRows: number; sample?: SleeperStatRow } {
  const set = new Set(byeTeams);
  const hits = rows.filter((r) => set.has(String(r.team ?? r.player?.team ?? "")));
  return {
    rows: hits.length,
    onlyNonScoringStats: hits.filter((r) => scorableStats(r).length === 0).length,
    withProjection: hits.filter((r) => hasProjection(r)).length,
    withPts: hits.filter((r) => typeof r.stats?.pts_ppr === "number").length,
    nullOpponent: hits.filter((r) => isBlankId(r.opponent)).length,
    nullGameId: hits.filter((r) => isBlankId(r.game_id)).length,
    defRows: hits.filter((r) => rowPosition(r) === "DEF").length,
    sample: hits[0],
  };
}

/** Top rows by pts_ppr (for trimmed fixtures). */
export function topByPts(rows: SleeperStatRow[], n: number, filter: (r: SleeperStatRow) => boolean = () => true): SleeperStatRow[] {
  return rows
    .filter(filter)
    .sort((a, b) => (b.stats?.pts_ppr ?? -Infinity) - (a.stats?.pts_ppr ?? -Infinity))
    .slice(0, n);
}

// ---------------------------------------------------------------- ESPN

/**
 * ESPN lineup slot id → label, ported from cwendt94/espn-api (espn_api/football/constant.py,
 * POSITION_MAP, MIT licence). Used to derive a player's position from eligibleSlots the way
 * espn-api's Player does (first slot whose label has no "/" and isn't 25 "Rookie").
 */
export const ESPN_SLOT_LABELS: Record<number, string> = {
  0: "QB",
  1: "TQB",
  2: "RB",
  3: "RB/WR",
  4: "WR",
  5: "WR/TE",
  6: "TE",
  7: "OP",
  8: "DT",
  9: "DE",
  10: "LB",
  11: "DL",
  12: "CB",
  13: "S",
  14: "DB",
  15: "DP",
  16: "D/ST",
  17: "K",
  18: "P",
  19: "HC",
  20: "BE",
  21: "IR",
  22: "",
  23: "RB/WR/TE",
  24: "ER",
  25: "Rookie",
};

export interface EspnStatEntry {
  id?: string;
  statSourceId?: number;
  statSplitTypeId?: number;
  seasonId?: number;
  scoringPeriodId?: number;
  appliedTotal?: number;
  appliedAverage?: number;
  stats?: Record<string, number>;
  externalId?: string;
  proTeamId?: number;
}

export interface EspnPoolPlayer {
  id?: number;
  status?: string;
  onTeamId?: number;
  player?: {
    id?: number;
    fullName?: string;
    defaultPositionId?: number;
    eligibleSlots?: number[];
    proTeamId?: number;
    injuryStatus?: string;
    injured?: boolean;
    active?: boolean;
    ownership?: { percentOwned?: number; [k: string]: unknown };
    stats?: EspnStatEntry[];
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export function espnPlayers(json: unknown): EspnPoolPlayer[] | null {
  const players = (json as { players?: unknown })?.players;
  return Array.isArray(players) ? (players as EspnPoolPlayer[]) : null;
}

/**
 * A player's main position the way espn-api's Player does it: the first eligible slot that isn't
 * 25 ("Rookie") and has no "/" in its label — unless the player's own name has a "/" (D/ST units,
 * e.g. "Seahawks D/ST", whose first slot is 16 "D/ST").
 */
export function espnPosition(p: EspnPoolPlayer): string {
  const nameHasSlash = String(p.player?.fullName ?? "").includes("/");
  for (const slot of p.player?.eligibleSlots ?? []) {
    const label = ESPN_SLOT_LABELS[slot];
    if (label === undefined || label === "") continue;
    if ((slot !== 25 && !label.includes("/")) || nameHasSlash) return label;
  }
  return "?";
}

export function findEntry(p: EspnPoolPlayer, src: number, split: number, season: number, period: number): EspnStatEntry | undefined {
  return p.player?.stats?.find((s) => s.statSourceId === src && s.statSplitTypeId === split && s.seasonId === season && s.scoringPeriodId === period);
}

/** An entry that exists but carries nothing: no stats and appliedTotal 0. */
export function isEmptyEntry(s: EspnStatEntry | undefined): boolean {
  return !!s && !Object.keys(s.stats ?? {}).length && (s.appliedTotal ?? 0) === 0;
}

export interface EspnPoolSummary {
  players: number;
  byPosition: Record<string, number>;
  statuses: Record<string, number>;
  /** "src/split/season" → number of entries. */
  entryKinds: Record<string, number>;
  /** Scoring periods with a projected single-week entry (src 1, split 1) for `season`, and how many players have each. */
  projectedWeeks: Record<string, number>;
  /** The same for `season − 1`. */
  projectedWeeksPrev: Record<string, number>;
  /** Scoring periods with an actual single-week entry (src 0, split 1) for `season`. */
  actualWeeks: Record<string, number>;
  entries: number;
  withAppliedTotal: number;
  avgEntriesPerPlayer: number;
}

export function summarizeEspnPool(players: EspnPoolPlayer[], season: number): EspnPoolSummary {
  const entryKinds: Record<string, number> = {};
  const projectedWeeks: Record<string, number> = {};
  const projectedWeeksPrev: Record<string, number> = {};
  const actualWeeks: Record<string, number> = {};
  let entries = 0;
  let withAppliedTotal = 0;
  for (const p of players)
    for (const s of p.player?.stats ?? []) {
      entries++;
      const kind = `${s.statSourceId}/${s.statSplitTypeId}/${s.seasonId}`;
      entryKinds[kind] = (entryKinds[kind] ?? 0) + 1;
      if (typeof s.appliedTotal === "number") withAppliedTotal++;
      if (s.statSplitTypeId !== 1) continue;
      const bucket = s.seasonId === season ? (s.statSourceId === 1 ? projectedWeeks : s.statSourceId === 0 ? actualWeeks : null) : s.seasonId === season - 1 && s.statSourceId === 1 ? projectedWeeksPrev : null;
      if (bucket) bucket[String(s.scoringPeriodId)] = (bucket[String(s.scoringPeriodId)] ?? 0) + 1;
    }
  const sortKeys = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => Number(a) - Number(b) || a.localeCompare(b)));
  return {
    players: players.length,
    byPosition: countBy(players, espnPosition),
    statuses: countBy(players, (p) => p.status),
    entryKinds: Object.fromEntries(Object.entries(entryKinds).sort(([a], [b]) => a.localeCompare(b))),
    projectedWeeks: sortKeys(projectedWeeks),
    projectedWeeksPrev: sortKeys(projectedWeeksPrev),
    actualWeeks: sortKeys(actualWeeks),
    entries,
    withAppliedTotal,
    avgEntriesPerPlayer: players.length ? round(entries / players.length, 1) : 0,
  };
}

export type EmptyEntryClass = "bye week" | "injured (not ACTIVE)" | "not projected (ACTIVE)" | "past week" | "outside weeks 1–last";

export interface EmptyEntryReport {
  total: number;
  byClass: Partial<Record<EmptyEntryClass, number>>;
  /** Injured empties by ESPN injuryStatus. */
  injuredByStatus: Record<string, number>;
  /** Per ESPN position: players with a known bye, bye-week entry present, and a non-zero projection in it. */
  byeWeekByPosition: Record<string, { players: number; withEntry: number; nonZero: number }>;
  /** Players (non-D/ST) with an empty entry in a future non-bye week while ACTIVE (sample names). */
  activeNotProjectedSample: string[];
}

/**
 * Classify projected single-week entries of `season` that are empty (no stats, appliedTotal 0), and
 * check how each position's own bye week looks. `byeOf` maps an ESPN proTeamId to its bye week.
 */
export function classifyEmptyEspn(players: EspnPoolPlayer[], season: number, currentWeek: number, lastRegularWeek: number, byeOf: (proTeamId: number | undefined) => number | undefined): EmptyEntryReport {
  const byClass: Partial<Record<EmptyEntryClass, number>> = {};
  const injuredByStatus: Record<string, number> = {};
  const byeWeekByPosition: EmptyEntryReport["byeWeekByPosition"] = {};
  const sample = new Map<string, number>();
  let total = 0;
  for (const p of players) {
    const bye = byeOf(p.player?.proTeamId);
    const status = p.player?.injuryStatus;
    const injured = typeof status === "string" && status !== "ACTIVE";
    for (const s of p.player?.stats ?? []) {
      if (s.statSourceId !== 1 || s.statSplitTypeId !== 1 || s.seasonId !== season || !isEmptyEntry(s)) continue;
      total++;
      const w = s.scoringPeriodId ?? -1;
      let cls: EmptyEntryClass;
      if (w < 1 || w > lastRegularWeek) cls = "outside weeks 1–last";
      else if (w < currentWeek) cls = "past week";
      else if (w === bye) cls = "bye week";
      else if (injured) {
        cls = "injured (not ACTIVE)";
        injuredByStatus[status as string] = (injuredByStatus[status as string] ?? 0) + 1;
      } else {
        cls = "not projected (ACTIVE)";
        const name = String(p.player?.fullName ?? p.id);
        sample.set(name, (sample.get(name) ?? 0) + 1);
      }
      byClass[cls] = (byClass[cls] ?? 0) + 1;
    }
    if (bye !== undefined) {
      const pos = espnPosition(p);
      const b = (byeWeekByPosition[pos] ??= { players: 0, withEntry: 0, nonZero: 0 });
      b.players++;
      const e = findEntry(p, 1, 1, season, bye);
      if (e) {
        b.withEntry++;
        if ((e.appliedTotal ?? 0) !== 0 || Object.keys(e.stats ?? {}).length) b.nonZero++;
      }
    }
  }
  const activeNotProjectedSample = [...sample.entries()]
    .sort(([, x], [, y]) => y - x)
    .slice(0, 5)
    .map(([n, c]) => `${n} (${c} weeks)`);
  return { total, byClass, injuredByStatus, byeWeekByPosition, activeNotProjectedSample };
}

export interface SeasonTotalCheck {
  compared: number;
  /** Matches within the tolerance, per candidate sum. */
  matches: Record<string, number>;
  excluded?: number;
  /** Excluded rows that would still match one of the candidate sums. */
  excludedMatches?: number;
}

function weeklySum(p: EspnPoolPlayer, src: number, season: number, from: number, to: number): number {
  return (p.player?.stats ?? []).filter((s) => s.statSourceId === src && s.statSplitTypeId === 1 && s.seasonId === season && (s.scoringPeriodId ?? -1) >= from && (s.scoringPeriodId ?? -1) <= to).reduce((a, s) => a + (s.appliedTotal ?? 0), 0);
}

/**
 * What ESPN's statSplitTypeId 0 and 2 totals are: compared with sums of the weekly entries.
 * D/ST units are left out of the projected checks: points-allowed tiers are scored per game, so their
 * weekly totals don't add up to a season total.
 */
export function espnSeasonTotals(players: EspnPoolPlayer[], season: number, currentWeek: number, lastRegularWeek: number, tolerance = 0.05): { projected0: SeasonTotalCheck; actual0: SeasonTotalCheck; projected2: SeasonTotalCheck & { periods: Record<string, number> } } {
  const projected0: SeasonTotalCheck = { compared: 0, matches: { restOfSeason: 0, fullSeason: 0 }, excluded: 0, excludedMatches: 0 };
  const actual0: SeasonTotalCheck = { compared: 0, matches: { completedWeeks: 0 } };
  const projected2: SeasonTotalCheck & { periods: Record<string, number> } = { compared: 0, matches: { restOfSeason: 0, afterCurrentWeek: 0, actualPlusRestOfSeason: 0, projectedSplit0: 0 }, periods: {} };
  const close = (a: number, b: number) => Math.abs(a - b) <= tolerance;
  const bump = (c: SeasonTotalCheck, k: string) => (c.matches[k] = (c.matches[k] ?? 0) + 1);
  for (const p of players) {
    const st = p.player?.stats ?? [];
    const dst = espnPosition(p) === "D/ST";
    const ros = weeklySum(p, 1, season, currentWeek, lastRegularWeek);
    const act = weeklySum(p, 0, season, 1, currentWeek - 1);
    const p0 = st.find((s) => s.statSourceId === 1 && s.statSplitTypeId === 0 && s.seasonId === season);
    const a0 = st.find((s) => s.statSourceId === 0 && s.statSplitTypeId === 0 && s.seasonId === season);
    const p2 = st.find((s) => s.statSourceId === 1 && s.statSplitTypeId === 2 && s.seasonId === season);
    if (p0 && typeof p0.appliedTotal === "number") {
      const isRos = close(p0.appliedTotal, ros);
      const isFull = close(p0.appliedTotal, weeklySum(p, 1, season, 1, lastRegularWeek));
      if (dst) {
        projected0.excluded = (projected0.excluded ?? 0) + 1;
        if (isRos || isFull) projected0.excludedMatches = (projected0.excludedMatches ?? 0) + 1;
      } else {
        projected0.compared++;
        if (isRos) bump(projected0, "restOfSeason");
        if (isFull) bump(projected0, "fullSeason");
      }
    }
    if (a0 && typeof a0.appliedTotal === "number") {
      actual0.compared++;
      if (close(a0.appliedTotal, act)) bump(actual0, "completedWeeks");
    }
    if (p2 && typeof p2.appliedTotal === "number") {
      projected2.compared++;
      projected2.periods[String(p2.scoringPeriodId)] = (projected2.periods[String(p2.scoringPeriodId)] ?? 0) + 1;
      if (close(p2.appliedTotal, ros)) bump(projected2, "restOfSeason");
      if (close(p2.appliedTotal, weeklySum(p, 1, season, currentWeek + 1, lastRegularWeek))) bump(projected2, "afterCurrentWeek");
      if (close(p2.appliedTotal, act + ros)) bump(projected2, "actualPlusRestOfSeason");
      if (p0 && typeof p0.appliedTotal === "number" && close(p2.appliedTotal, p0.appliedTotal)) bump(projected2, "projectedSplit0");
    }
  }
  return { projected0, actual0, projected2 };
}

/**
 * Offensive scoring from ESPN stat ids (ids and meanings from espn-api's PLAYER_STATS_MAP), with the
 * reception and interception values as parameters: used only to infer which rules leaguedefaults/3's
 * appliedTotal uses.
 */
export function espnOffenseScore(stats: Record<string, number>, perReception: number, intPts = -2): number {
  const g = (id: number) => stats[String(id)] ?? 0;
  return (
    g(3) * 0.04 + // passingYards
    g(4) * 4 + // passingTouchdowns
    g(20) * intPts + // passingInterceptions
    g(19) * 2 + // passing2PtConversions
    g(24) * 0.1 + // rushingYards
    g(25) * 6 + // rushingTouchdowns
    g(26) * 2 + // rushing2PtConversions
    g(42) * 0.1 + // receivingYards
    g(43) * 6 + // receivingTouchdowns
    g(44) * 2 + // receiving2PtConversions
    g(53) * perReception + // receivingReceptions (REC)
    g(72) * -2 + // lostFumbles
    g(63) * 6 + // fumbleRecoveredForTD
    g(101) * 6 + // kickoffReturnTouchdowns
    g(102) * 6 // puntReturnTouchdowns
  );
}

export interface ScoringFit {
  perReception: number;
  intPts: number;
  compared: number;
  within005: number;
  within05: number;
  /** The same counts over entries with at least one interception (stat 20 > 0). */
  withIntCompared: number;
  withIntWithin005: number;
}

/** For each rule variant, how many entries' appliedTotal the formula reproduces. */
export function fitEspnScoring(
  entries: EspnStatEntry[],
  variants: Array<{ perReception: number; intPts: number }> = [
    { perReception: 1, intPts: -2 },
    { perReception: 1, intPts: -1 },
    { perReception: 0.5, intPts: -2 },
    { perReception: 0, intPts: -2 },
  ],
): ScoringFit[] {
  const usable = entries.filter((e) => typeof e.appliedTotal === "number" && e.stats && Object.keys(e.stats).length);
  return variants.map(({ perReception, intPts }) => {
    let within005 = 0;
    let within05 = 0;
    let withIntCompared = 0;
    let withIntWithin005 = 0;
    for (const e of usable) {
      const d = Math.abs(espnOffenseScore(e.stats ?? {}, perReception, intPts) - (e.appliedTotal ?? 0));
      if (d <= 0.05) within005++;
      if (d <= 0.5) within05++;
      if ((e.stats?.["20"] ?? 0) > 0) {
        withIntCompared++;
        if (d <= 0.05) withIntWithin005++;
      }
    }
    return { perReception, intPts, compared: usable.length, within005, within05, withIntCompared, withIntWithin005 };
  });
}

export interface SourceDisagreement {
  compared: number;
  /** Pairs where exactly one source projects zero (usually injury or depth-chart calls). */
  oneZero: number;
  /** Median of a / b. */
  medianRatio: number | null;
  /** |a − b| > threshold × the larger value (one source under 60% of the other at 0.4). */
  overOfLarger: number;
  /** |a − b| > threshold × the smaller value (one source over 140% of the other at 0.4). */
  overOfSmaller: number;
  samples: Array<{ name: string; a: number; b: number }>;
}

/**
 * Relative disagreement between two point projections. CLAUDE.md §6 logs players whose sources
 * "disagree by more than 40%"; the reference value isn't specified, so both readings are counted.
 */
export function disagreement(pairs: Array<{ name: string; a: number; b: number }>, threshold = 0.4, maxSamples = 8): SourceDisagreement {
  const usable = pairs.filter((p) => p.a > 0 && p.b > 0);
  const ratios = usable.map((p) => p.a / p.b);
  const gap = (p: { a: number; b: number }) => Math.abs(p.a - p.b);
  const overLarger = usable.filter((p) => gap(p) > threshold * Math.max(p.a, p.b));
  const overSmaller = usable.filter((p) => gap(p) > threshold * Math.min(p.a, p.b));
  const m = median(ratios);
  return {
    compared: usable.length,
    oneZero: pairs.filter((p) => (p.a > 0) !== (p.b > 0)).length,
    medianRatio: m === null ? null : round(m, 3),
    overOfLarger: overLarger.length,
    overOfSmaller: overSmaller.length,
    samples: overLarger
      .sort((x, y) => gap(y) - gap(x))
      .slice(0, maxSamples)
      .map((p) => ({ name: p.name, a: round(p.a, 2), b: round(p.b, 2) })),
  };
}
