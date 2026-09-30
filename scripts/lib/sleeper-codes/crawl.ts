/**
 * Snowball crawl of public Sleeper leagues for the settings-code probe (CLAUDE.md §2.3, §0.6).
 *
 *   seeds (docs example IDs, or SLEEPER_* from .env.local)
 *     → /league/{id}/users → /user/{id}/leagues/nfl/{season} (+ that user's drafts) → …
 *
 * Records keep only codes, counts and keyword flags. League names, display names and team names
 * are read once for keyword flags and then dropped (the watch list in watchlist.ts is built from
 * the git-ignored raw captures). IDs stay in memory and in git-ignored files (data-local/), never
 * in reports.
 *
 * Every candidate ordering is keyed with a random salt that is stored only in data-local/
 * (git-ignored), so the committed code alone can't reproduce which public leagues were sampled.
 */
import { sha256 } from "../cache";
import type { Category } from "../sanitize";
import {
  codeLike,
  nameKeywords,
  rosterGroupsOf,
  standingsFromRosters,
  type BracketMatch,
  type MatchupLite,
  type NameKeyword,
  type RosterGroups,
  type RosterLite,
  type Standing,
} from "./analyze";

export type { RosterGroups } from "./analyze";
import { CRAWL_TTL, type SleeperCrawlClient } from "./client";
import { isGenericName, looksLikePlaceholder } from "./watchlist";

// ---------------------------------------------------------------------------------------------
// Raw shapes (only the fields we read; everything is optional because Sleeper omits freely)

export interface LeagueRaw {
  league_id?: string;
  previous_league_id?: string | null;
  draft_id?: string | null;
  name?: string;
  status?: string;
  season?: string;
  season_type?: string;
  sport?: string;
  total_rosters?: number;
  settings?: Record<string, unknown> | null;
  roster_positions?: string[] | null;
  scoring_settings?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  bracket_id?: unknown;
  loser_bracket_id?: unknown;
  bracket_overrides_id?: unknown;
  loser_bracket_overrides_id?: unknown;
}

export interface UserRaw {
  user_id?: string;
  display_name?: string;
  is_bot?: boolean;
  metadata?: { team_name?: string } | null;
}

export interface DraftRaw {
  draft_id?: string;
  league_id?: string;
  type?: string;
  status?: string;
  season?: string;
  settings?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export interface PickRaw {
  roster_id?: number;
  is_keeper?: boolean | null;
  metadata?: { years_exp?: string | number | null } | null;
}

export interface TxRaw {
  type?: string;
  status?: string;
  leg?: number;
  created?: number;
  status_updated?: number;
  roster_ids?: number[] | null;
  consenter_ids?: number[] | null;
  draft_picks?: unknown[] | null;
  waiver_budget?: unknown[] | null;
  settings?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  adds?: Record<string, number> | null;
  drops?: Record<string, number> | null;
}

// ---------------------------------------------------------------------------------------------
// Trimmed records

export interface DraftSummary {
  type?: string;
  status?: string;
  rounds?: number;
  playerType?: number;
  teams?: number;
  scoringType?: string;
  /** draft.metadata.league_type (a digit string on some drafts). */
  leagueTypeMeta?: string;
  hasBudget: boolean;
}

export interface PicksSummary {
  picks: number;
  keepers: number;
  rookies: number;
  withYearsExp: number;
  maxKeepersPerRoster: number;
}

/**
 * How a league points at its previous season: a real ID, the string "0" (Sleeper's way of saying
 * "none" in some leagues), null, a missing key, or anything else.
 */
export type LinkKind = "id" | "zero" | "null" | "absent" | "other";

export interface League2026 {
  leagueId: string;
  /** A real previous-season league ID; null when there is none ("0", null or missing). */
  previousLeagueId: string | null;
  /** What previous_league_id held (so the report can count the "0" form). */
  previousLink: LinkKind;
  draftId: string | null;
  /** Snowball distance from the seeds. */
  hop: number;
  status?: string;
  season?: string;
  seasonType?: string;
  totalRosters?: number;
  /** Numeric settings only. */
  settings: Record<string, number>;
  rosterPositions: string[];
  /** scoring_settings keys with a non-zero value. */
  scoringNonzero: string[];
  metadataKeys: string[];
  nameKeywords: NameKeyword[];
  hasBracketIds: boolean;
  draft?: DraftSummary;
  picks?: PicksSummary;
}

export interface TxLite {
  type?: string;
  status?: string;
  leg?: number;
  created?: number;
  statusUpdated?: number;
  rosters: number;
  consenters: number;
  draftPicks: number;
  waiverBid?: number;
  settingsKeys: string[];
  metadataKeys: string[];
}

export interface Prev2025 {
  /** The 2026 league this came from (local only); the lineage key for "independent leagues". */
  fromLeagueId: string;
  leagueId: string;
  /** 1 = linked from a 2026 league, 2 = the season before that (only for rare codes). */
  depth: number;
  /** This season's own previous_league_id when it is a real ID (local only). */
  previousLeagueId: string | null;
  previousLink: LinkKind;
  /** The commissioner edited the playoff bracket (bracket_overrides_id set). */
  hasBracketOverrides: boolean;
  httpStatus: number;
  found: boolean;
  season?: string;
  status?: string;
  totalRosters?: number;
  settings: Record<string, number>;
  rosterPositions: string[];
  standings: Standing[];
  winners?: BracketMatch[];
  losers?: BracketMatch[];
  /** week → trimmed matchups (roster_id, matchup_id, points). */
  matchups: Record<string, MatchupLite[]>;
  /** leg → trimmed transactions. */
  transactions: Record<string, TxLite[]>;
  nameKeywords: NameKeyword[];
  /** Per-roster players/reserve/taxi, kept only when the league has position limits. */
  rosterGroups?: RosterGroups[];
}

export type Register = (id: string | null | undefined, category: Category) => void;

// ---------------------------------------------------------------------------------------------
// Helpers

const KEY_RE = /^[a-z0-9_]{1,48}$/;

export function linkKind(v: unknown): LinkKind {
  if (v === undefined) return "absent";
  if (v === null) return "null";
  if (typeof v === "string" && /^\d+$/.test(v)) return /^0+$/.test(v) ? "zero" : "id";
  return "other";
}

/** A real Sleeper ID (digits, not all zeros), else null: "0" means "no previous season". */
export function realId(v: unknown): string | null {
  return linkKind(v) === "id" ? (v as string) : null;
}

/** Pseudo-random order keyed by a salt (same salt → same order, so reruns reuse the cache). */
export function hashOrder<T>(items: readonly T[], idOf: (t: T) => string, salt = ""): T[] {
  return [...items]
    .map((x) => [sha256(`sleeper-codes/v2:${salt}:${idOf(x)}`), x] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([, x]) => x);
}

export function numericSettings(settings: Record<string, unknown> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(settings ?? {})) if (KEY_RE.test(k) && typeof v === "number" && Number.isFinite(v)) out[k] = v;
  return out;
}

export const hasPositionLimits = (s: Record<string, number>): boolean => Object.keys(s).some((k) => k.startsWith("position_limit_"));

/** Example IDs in the public API docs (https://docs.sleeper.com): the crawl's fallback seeds. */
export function extractDocSeeds(html: string): { leagueIds: string[]; userIds: string[] } {
  const text = html.replace(/<[^>]*>/g, "");
  const leagueIds = new Set<string>();
  const userIds = new Set<string>();
  for (const m of text.matchAll(/"(?:league_id|previous_league_id)":\s*"(\d{15,20})"/g)) if (m[1] && realId(m[1])) leagueIds.add(m[1]);
  for (const m of text.matchAll(/"(?:owner_id|user_id|picked_by)":\s*"(\d{12,20})"/g)) if (m[1] && realId(m[1])) userIds.add(m[1]);
  return { leagueIds: [...leagueIds], userIds: [...userIds] };
}

export function summarizeDraft(d: DraftRaw): DraftSummary {
  const s = d.settings ?? {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const lt = d.metadata?.league_type;
  return {
    type: codeLike(d.type),
    status: codeLike(d.status),
    rounds: num(s.rounds),
    playerType: num(s.player_type),
    teams: num(s.teams),
    scoringType: codeLike(d.metadata?.scoring_type),
    leagueTypeMeta: typeof lt === "string" && /^\d{1,2}$/.test(lt) ? lt : typeof lt === "number" ? String(lt) : undefined,
    hasBudget: typeof s.budget === "number",
  };
}

export function summarizePicks(picks: readonly PickRaw[]): PicksSummary {
  const keepersByRoster = new Map<number, number>();
  let keepers = 0;
  let rookies = 0;
  let withYearsExp = 0;
  for (const p of picks) {
    if (p.is_keeper === true) {
      keepers++;
      const r = p.roster_id ?? -1;
      keepersByRoster.set(r, (keepersByRoster.get(r) ?? 0) + 1);
    }
    const ye = p.metadata?.years_exp;
    if (ye !== undefined && ye !== null && String(ye).trim() !== "") {
      withYearsExp++;
      if (Number(ye) === 0) rookies++;
    }
  }
  return { picks: picks.length, keepers, rookies, withYearsExp, maxKeepersPerRoster: Math.max(0, ...keepersByRoster.values()) };
}

export function trimTx(t: TxRaw): TxLite {
  const bid = t.settings?.waiver_bid;
  return {
    type: codeLike(t.type),
    status: codeLike(t.status),
    leg: typeof t.leg === "number" ? t.leg : undefined,
    created: typeof t.created === "number" ? t.created : undefined,
    statusUpdated: typeof t.status_updated === "number" ? t.status_updated : undefined,
    rosters: t.roster_ids?.length ?? 0,
    consenters: t.consenter_ids?.length ?? 0,
    draftPicks: t.draft_picks?.length ?? 0,
    waiverBid: typeof bid === "number" ? bid : undefined,
    settingsKeys: Object.keys(t.settings ?? {}).filter((k) => KEY_RE.test(k)),
    metadataKeys: Object.keys(t.metadata ?? {}).filter((k) => KEY_RE.test(k)),
  };
}

function trimMatchups(list: readonly MatchupLite[]): MatchupLite[] {
  return list.map((m) => ({ roster_id: m.roster_id, matchup_id: m.matchup_id ?? null, points: m.points ?? null, custom_points: m.custom_points ?? null }));
}

function trimBracket(list: readonly BracketMatch[]): BracketMatch[] {
  return list.map((m) => ({ r: m.r, m: m.m, t1: m.t1 ?? null, t2: m.t2 ?? null, w: m.w ?? null, l: m.l ?? null, t1_from: m.t1_from ?? null, t2_from: m.t2_from ?? null, p: m.p ?? null }));
}

/**
 * Crawled names (≥ 10 chars) kept in memory only, for the report's leak check. Generic phrases and
 * placeholder shapes are skipped (the report's own vocabulary must not look like a leak), and a
 * name only counts as a whole word.
 */
export class NameWatch {
  readonly names = new Set<string>();
  add(v: unknown): void {
    if (typeof v !== "string") return;
    const name = v.trim();
    if (name.length >= 10 && !isGenericName(name) && !looksLikePlaceholder(name)) this.names.add(name);
  }
  /** Names found in `text` (for the caller to count and scrub; never print them). */
  findIn(text: string): string[] {
    return [...this.names].filter((n) => text.includes(n) && new RegExp(`(?<![\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u").test(text));
  }
}

export function toLeague2026(l: LeagueRaw, hop: number): League2026 | undefined {
  if (typeof l.league_id !== "string") return undefined;
  return {
    leagueId: l.league_id,
    previousLeagueId: realId(l.previous_league_id),
    previousLink: linkKind(l.previous_league_id),
    draftId: realId(l.draft_id),
    hop,
    status: codeLike(l.status),
    season: typeof l.season === "string" && /^\d{4}$/.test(l.season) ? l.season : undefined,
    seasonType: codeLike(l.season_type),
    totalRosters: typeof l.total_rosters === "number" ? l.total_rosters : undefined,
    settings: numericSettings(l.settings),
    rosterPositions: (l.roster_positions ?? []).filter((x): x is string => typeof x === "string" && /^[A-Z0-9_]{1,16}$/.test(x)),
    scoringNonzero: Object.entries(l.scoring_settings ?? {})
      .filter(([k, v]) => KEY_RE.test(k) && typeof v === "number" && v !== 0)
      .map(([k]) => k)
      .sort(),
    metadataKeys: Object.keys(l.metadata ?? {}).filter((k) => KEY_RE.test(k)).sort(),
    nameKeywords: nameKeywords(l.name),
    hasBracketIds: l.bracket_id !== null && l.bracket_id !== undefined,
  };
}

// ---------------------------------------------------------------------------------------------
// 2026 snowball

export interface CrawlOptions {
  season: string;
  maxLeagues: number;
  /** Take at most this many new leagues from any one user (limits power-user bias). */
  perUserCap: number;
  /** Expand another league's member list when fewer users than this are queued. */
  minUserQueue: number;
  /** Stop crawling once the client has made this many calls (leaves budget for later steps). */
  callBudget: number;
  /** Salt for every ordering (kept only in data-local/). */
  salt?: string;
}

export interface CrawlResult {
  leagues: League2026[];
  usersFetched: number;
  usersWithNewLeagues: number;
  usersQueued: number;
  leagueUserLists: number;
  draftsSeen: number;
  stoppedBy: "target" | "call budget" | "no more users";
}

export async function crawl2026(
  client: SleeperCrawlClient,
  seeds: { leagueIds: string[]; userIds: string[] },
  opts: CrawlOptions,
  register: Register,
  names: NameWatch,
): Promise<CrawlResult> {
  const salt = opts.salt ?? "";
  // A pool kept in salted hash order, so users from different leagues are interleaved (members of
  // one league mostly share that league; taking them back to back wastes calls on duplicates).
  const userQueue: Array<{ id: string; hop: number; key: string }> = [];
  const queued = new Set<string>();
  const leagueQueue: Array<{ id: string; hop: number }> = seeds.leagueIds.map((id) => ({ id, hop: 0 }));
  const expanded = new Set<string>();
  const leagues = new Map<string, League2026>();
  const drafts = new Map<string, DraftSummary>();
  const res: Omit<CrawlResult, "leagues" | "stoppedBy" | "draftsSeen"> = { usersFetched: 0, usersWithNewLeagues: 0, usersQueued: 0, leagueUserLists: 0 };

  const enqueueUser = (id: string, hop: number) => {
    if (queued.has(id)) return;
    queued.add(id);
    register(id, "user-id");
    const key = sha256(`sleeper-codes/v2:${salt}:user:${id}`);
    const at = userQueue.findIndex((u) => u.key > key);
    userQueue.splice(at < 0 ? userQueue.length : at, 0, { id, hop, key });
    res.usersQueued++;
  };
  for (const id of seeds.userIds) enqueueUser(id, 0);
  for (const id of seeds.leagueIds) register(id, "league-id");

  let stoppedBy: CrawlResult["stoppedBy"] = "target";
  while (leagues.size < opts.maxLeagues) {
    if (client.calls >= opts.callBudget) {
      stoppedBy = "call budget";
      break;
    }
    const expand = userQueue.length < opts.minUserQueue ? leagueQueue.shift() : undefined;
    if (expand) {
      if (expanded.has(expand.id)) continue;
      expanded.add(expand.id);
      const r = await client.get<UserRaw[]>(`/league/${expand.id}/users`, "league/{leagueId}/users", CRAWL_TTL.crawl);
      res.leagueUserLists++;
      const users = Array.isArray(r.data) ? r.data : [];
      for (const u of users) {
        names.add(u.display_name);
        names.add(u.metadata?.team_name);
      }
      const ids = users.filter((u) => realId(u.user_id) && u.is_bot !== true).map((u) => u.user_id as string);
      for (const id of ids) enqueueUser(id, expand.hop + 1);
      continue;
    }
    const user = userQueue.shift();
    if (!user) {
      stoppedBy = "no more users";
      break;
    }
    const r = await client.get<LeagueRaw[]>(`/user/${user.id}/leagues/nfl/${opts.season}`, "user/{userId}/leagues/nfl/{season}", CRAWL_TTL.crawl);
    res.usersFetched++;
    const list = (Array.isArray(r.data) ? r.data : []).filter((l) => realId(l.league_id) && l.sport === "nfl" && l.season === opts.season && !leagues.has(l.league_id as string));
    const fresh = hashOrder(list, (l) => l.league_id as string, salt).slice(0, Math.min(opts.perUserCap, opts.maxLeagues - leagues.size));
    if (!fresh.length) continue;
    res.usersWithNewLeagues++;
    for (const l of fresh) {
      const rec = toLeague2026(l, user.hop);
      if (!rec) continue;
      register(rec.leagueId, "league-id");
      register(rec.previousLeagueId, "league-id");
      register(rec.draftId, "draft-id");
      names.add(l.name);
      leagues.set(rec.leagueId, rec);
      leagueQueue.push({ id: rec.leagueId, hop: user.hop });
    }
    if (client.calls >= opts.callBudget) continue;
    // The same user's drafts cover the leagues just taken: one call instead of one per league.
    const d = await client.get<DraftRaw[]>(`/user/${user.id}/drafts/nfl/${opts.season}`, "user/{userId}/drafts/nfl/{season}", CRAWL_TTL.crawl);
    for (const dr of Array.isArray(d.data) ? d.data : []) {
      if (typeof dr.draft_id !== "string") continue;
      register(dr.draft_id, "draft-id");
      names.add(dr.metadata?.name);
      drafts.set(dr.draft_id, summarizeDraft(dr));
    }
    for (const rec of leagues.values()) if (!rec.draft && rec.draftId && drafts.has(rec.draftId)) rec.draft = drafts.get(rec.draftId);
  }
  return { ...res, leagues: [...leagues.values()], draftsSeen: drafts.size, stoppedBy };
}

// ---------------------------------------------------------------------------------------------
// Samples for deeper checks (pure selection; deterministic for a given salt)

/** Up to `perStratum` completed 2026 drafts per (league type × renewed or new). */
export function selectPicksSample(leagues: readonly League2026[], perStratum: number, salt = ""): League2026[] {
  const strata = new Map<string, League2026[]>();
  for (const l of hashOrder(leagues, (x) => x.leagueId, salt)) {
    if (!l.draftId || l.draft?.status !== "complete") continue;
    const key = `${l.settings.type ?? "absent"}|${l.previousLeagueId ? "renewed" : "new"}`;
    const list = strata.get(key) ?? [];
    if (list.length < perStratum) list.push(l);
    strata.set(key, list);
  }
  return [...strata.values()].flat();
}

const guillotine = (s: Record<string, number>) => (s.type === 3 ? "guillotine" : "other");

/** Codes the previous-season sample must cover (each value at least `minPerValue` times when available). */
export const PREV_STRATA: Record<string, (s: Record<string, number>) => string | number | undefined> = {
  playoff_round_type: (s) => s.playoff_round_type,
  playoff_teams: (s) => s.playoff_teams,
  league_average_match: (s) => s.league_average_match,
  best_ball: (s) => s.best_ball,
  playoff_type: (s) => s.playoff_type,
  playoff_seed_type: (s) => s.playoff_seed_type,
  type: (s) => s.type,
  waiver_type: (s) => s.waiver_type,
  trade_deadline: (s) => (s.trade_deadline === undefined ? undefined : s.trade_deadline <= 17 ? "a week (1-17)" : s.trade_deadline),
  // Trading off vs on within the same league type (guillotine leagues are the usual "off" case).
  disable_trades: (s) => `${s.disable_trades ?? "absent"}|${guillotine(s)}`,
  pick_trading: (s) => `${s.pick_trading ?? "absent"}|${s.type === 2 ? "dynasty" : "other"}`,
  veto_review: (s) => `${s.veto_auto_poll ?? "absent"}|${s.trade_review_days ?? "absent"}`,
  divisions: (s) => ((s.divisions ?? 0) > 0 ? "yes" : "no"),
  start_week: (s) => ((s.start_week ?? 1) > 1 ? "after week 1" : "week 1"),
  position_limits: (s) => (hasPositionLimits(s) ? "yes" : "no"),
};

/** Greedy coverage of every (code, value) seen among renewed 2026 leagues, then fill in salted order. */
export function selectPrevSample(leagues: readonly League2026[], max: number, minPerValue: number, salt = ""): League2026[] {
  const candidates = hashOrder(
    leagues.filter((l) => l.previousLeagueId),
    (x) => x.leagueId,
    salt,
  );
  const cell = (l: League2026) => Object.entries(PREV_STRATA).map(([k, f]) => `${k}=${String(f(l.settings) ?? "absent")}`);
  const available = new Map<string, number>();
  for (const l of candidates) for (const c of cell(l)) available.set(c, (available.get(c) ?? 0) + 1);
  const need = new Map([...available].map(([c, n]) => [c, Math.min(n, minPerValue)]));
  const chosen: League2026[] = [];
  const left = [...candidates];
  while (chosen.length < max && left.length) {
    let best = -1;
    let bestGain = 0;
    left.forEach((l, i) => {
      const gain = cell(l).filter((c) => (need.get(c) ?? 0) > 0).length;
      if (gain > bestGain) {
        best = i;
        bestGain = gain;
      }
    });
    if (best < 0) break;
    const [pick] = left.splice(best, 1);
    if (!pick) break;
    chosen.push(pick);
    for (const c of cell(pick)) need.set(c, Math.max(0, (need.get(c) ?? 0) - 1));
  }
  for (const l of left) {
    if (chosen.length >= max) break;
    chosen.push(l);
  }
  return chosen;
}

// ---------------------------------------------------------------------------------------------
// Previous season (2025) details

/** Weeks to fetch matchups for: enough for 2-week rounds, capped at NFL week 18. */
export function playoffWeeksToFetch(pws: number, rounds: number): number[] {
  if (pws < 1 || rounds < 1) return [];
  const out: number[] = [];
  for (let w = pws; w <= Math.min(18, pws + 2 * rounds - 1); w++) out.push(w);
  return out;
}

/** Transaction legs: around a real deadline (D-1, D, D+1), else late-season weeks 15-17. */
export function tradeLegsToFetch(deadline: number | undefined): number[] {
  if (deadline !== undefined && deadline >= 1 && deadline <= 17) return [deadline - 1, deadline, deadline + 1].filter((w) => w >= 1 && w <= 18);
  return [15, 16, 17];
}

export const PREV_CALLS_MAX = 1 + 1 + 2 + 6 + 3;

/** A finished season to fetch: `leagueId` is a previous_league_id reached from `fromLeagueId` (2026). */
export interface SeasonLink {
  fromLeagueId: string;
  leagueId: string;
  depth: number;
}

export async function fetchPrev2025(client: SleeperCrawlClient, link: SeasonLink, register: Register, names: NameWatch): Promise<Prev2025> {
  const id = link.leagueId;
  register(id, "league-id");
  const out: Prev2025 = {
    fromLeagueId: link.fromLeagueId,
    leagueId: id,
    depth: link.depth,
    previousLeagueId: null,
    previousLink: "absent",
    hasBracketOverrides: false,
    httpStatus: 0,
    found: false,
    settings: {},
    rosterPositions: [],
    standings: [],
    matchups: {},
    transactions: {},
    nameKeywords: [],
  };
  // A finished season never changes; remember a 404 too, so a rerun doesn't ask again.
  const lr = await client.get<LeagueRaw>(`/league/${id}`, "league/{previousLeagueId}", CRAWL_TTL.finished, { cacheNotFound: true });
  out.httpStatus = lr.status;
  const league = lr.data;
  if (lr.missing || !league || typeof league !== "object") return out;
  out.found = true;
  names.add(league.name);
  out.previousLeagueId = realId(league.previous_league_id);
  out.previousLink = linkKind(league.previous_league_id);
  register(out.previousLeagueId, "league-id");
  out.hasBracketOverrides = (league.bracket_overrides_id ?? null) !== null || (league.loser_bracket_overrides_id ?? null) !== null;
  out.season = typeof league.season === "string" ? league.season : undefined;
  out.status = codeLike(league.status);
  out.totalRosters = typeof league.total_rosters === "number" ? league.total_rosters : undefined;
  out.settings = numericSettings(league.settings);
  out.rosterPositions = (league.roster_positions ?? []).filter((x): x is string => typeof x === "string");
  out.nameKeywords = nameKeywords(league.name);

  const rr = await client.get<RosterLite[]>(`/league/${id}/rosters`, "league/{previousLeagueId}/rosters", CRAWL_TTL.finished);
  const rosters = Array.isArray(rr.data) ? rr.data : [];
  out.standings = standingsFromRosters(rosters);
  if (hasPositionLimits(out.settings)) out.rosterGroups = rosterGroupsOf(rosters);

  const pws = out.settings.playoff_week_start ?? 0;
  if (pws >= 1) {
    const wb = await client.get<BracketMatch[]>(`/league/${id}/winners_bracket`, "league/{previousLeagueId}/winners_bracket", CRAWL_TTL.finished);
    out.winners = Array.isArray(wb.data) ? trimBracket(wb.data) : undefined;
    const lb = await client.get<BracketMatch[]>(`/league/${id}/losers_bracket`, "league/{previousLeagueId}/losers_bracket", CRAWL_TTL.finished);
    out.losers = Array.isArray(lb.data) ? trimBracket(lb.data) : undefined;
    const rounds = out.winners?.length ? Math.max(...out.winners.map((m) => m.r)) : 0;
    for (const w of playoffWeeksToFetch(pws, rounds)) {
      const mr = await client.get<MatchupLite[]>(`/league/${id}/matchups/${w}`, "league/{previousLeagueId}/matchups/{week}", CRAWL_TTL.finished);
      out.matchups[String(w)] = Array.isArray(mr.data) ? trimMatchups(mr.data) : [];
    }
  }
  await fetchMoreTransactions(client, out, tradeLegsToFetch(out.settings.trade_deadline));
  return out;
}

/** Add transaction weeks (legs) that aren't fetched yet. */
export async function fetchMoreTransactions(client: SleeperCrawlClient, p: Prev2025, legs: readonly number[]): Promise<void> {
  for (const leg of legs) {
    if (p.transactions[String(leg)]) continue;
    const tr = await client.get<TxRaw[]>(`/league/${p.leagueId}/transactions/${leg}`, "league/{previousLeagueId}/transactions/{week}", CRAWL_TTL.finished);
    p.transactions[String(leg)] = Array.isArray(tr.data) ? tr.data.map(trimTx) : [];
  }
}

/** Rare codes whose meaning needs more finished seasons; checked after the first pass. */
export const RARE_CODES: Array<[string, number]> = [
  ["playoff_round_type", 1],
  ["playoff_round_type", 2],
];

/**
 * For rare code values seen in fewer than `min` finished seasons, the season before each such
 * season (depth 2) — the same league's earlier bracket is another observation of the code (but not
 * an independent league: the evaluation counts leagues and seasons separately).
 */
export function selectDeeperSeasons(prev: readonly Prev2025[], min: number, maxPerCode: number, salt = ""): SeasonLink[] {
  const out: SeasonLink[] = [];
  const have = new Set(prev.map((p) => p.leagueId));
  for (const [key, value] of RARE_CODES) {
    const seen = prev.filter((p) => p.found && p.settings[key] === value);
    if (seen.length >= min) continue;
    for (const p of hashOrder(seen, (x) => x.leagueId, salt).slice(0, maxPerCode)) {
      if (!p.previousLeagueId || have.has(p.previousLeagueId)) continue;
      have.add(p.previousLeagueId);
      out.push({ fromLeagueId: p.fromLeagueId, leagueId: p.previousLeagueId, depth: p.depth + 1 });
    }
  }
  return out;
}

/** Weeks 4–8 as a trade-free control window: leagues with trading disabled vs as many with it on. */
export const EXTRA_TRADE_LEGS = [4, 5, 6, 7, 8];

/**
 * Seasons with trading disabled, each paired with a season that has trading on — of the same
 * league type when there is one (guillotine leagues trade differently), else any type.
 */
export function selectTradeControlSample(prev: readonly Prev2025[], max: number, salt = ""): { disabled: Prev2025[]; enabled: Prev2025[] } {
  const found = hashOrder(
    prev.filter((p) => p.found && p.depth === 1),
    (x) => x.leagueId,
    salt,
  );
  const disabled = found.filter((p) => p.settings.disable_trades === 1).slice(0, max);
  const pool = found.filter((p) => p.settings.disable_trades === 0);
  const enabled: Prev2025[] = [];
  for (const d of disabled) {
    const same = pool.find((p) => p.settings.type === d.settings.type && !enabled.includes(p));
    const any = same ?? pool.find((p) => !enabled.includes(p));
    if (any) enabled.push(any);
  }
  return { disabled, enabled };
}

// ---------------------------------------------------------------------------------------------
// Current season (2026) rosters for codes that are rare among renewed leagues

export interface Current2026 {
  leagueId: string;
  /** Sampling reasons, e.g. "best_ball=1". */
  reasons: string[];
  status?: string;
  settings: Record<string, number>;
  standings: Standing[];
  /** Per-roster players/reserve/taxi, kept only when the league has position limits. */
  rosterGroups?: RosterGroups[];
}

export const CURRENT_GROUPS: Array<[string, (l: League2026) => boolean]> = [
  ["best_ball=1", (l) => l.settings.best_ball === 1],
  ["start_week>1", (l) => (l.settings.start_week ?? 1) > 1],
  ["start_week absent", (l) => l.settings.start_week === undefined],
  ["position_limit_*", (l) => hasPositionLimits(l.settings)],
  ["control", (l) => (l.settings.best_ball ?? 0) === 0 && l.settings.start_week === 1],
];

/** In-season, non-guillotine 2026 leagues: up to `perGroup` per group, in salted order. */
export function selectCurrentSample(leagues: readonly League2026[], perGroup: number, salt = ""): Array<{ league: League2026; reasons: string[] }> {
  const inSeason = hashOrder(
    leagues.filter((l) => l.status === "in_season" && l.settings.type !== 3),
    (l) => l.leagueId,
    salt,
  );
  const chosen = new Map<string, { league: League2026; reasons: string[] }>();
  for (const [reason, test] of CURRENT_GROUPS) {
    for (const l of inSeason.filter(test).slice(0, perGroup)) {
      const c = chosen.get(l.leagueId) ?? { league: l, reasons: [] };
      c.reasons.push(reason);
      chosen.set(l.leagueId, c);
    }
  }
  return [...chosen.values()];
}

export async function fetchCurrent2026(client: SleeperCrawlClient, l: League2026, reasons: string[]): Promise<Current2026> {
  const r = await client.get<RosterLite[]>(`/league/${l.leagueId}/rosters`, "league/{leagueId}/rosters", CRAWL_TTL.crawl);
  const rosters = Array.isArray(r.data) ? r.data : [];
  return {
    leagueId: l.leagueId,
    reasons,
    status: l.status,
    settings: l.settings,
    standings: standingsFromRosters(rosters),
    rosterGroups: hasPositionLimits(l.settings) ? rosterGroupsOf(rosters) : undefined,
  };
}

export async function fetchPicks(client: SleeperCrawlClient, l: League2026): Promise<PicksSummary | undefined> {
  if (!l.draftId) return undefined;
  const r = await client.get<PickRaw[]>(`/draft/${l.draftId}/picks`, "draft/{draftId}/picks", CRAWL_TTL.crawl);
  return Array.isArray(r.data) ? summarizePicks(r.data) : undefined;
}
