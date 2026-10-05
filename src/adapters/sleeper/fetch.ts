/**
 * Sleeper fetch, the server's side (CLAUDE.md §2.3, §2.10): talks to api.sleeper.app through the injected polite,
 * cached HttpClient and hands the raw responses to normalizeSleeperLeague().
 *
 * The league's own responses (user lookups, the NFL state, the league, its users, rosters, matchups, transactions, traded
 * picks and drafts) are read by ./leagueData.ts, the half that also runs in the browser (planner reply to Checkpoint 4c,
 * Part B, B1: browser fetching; track BF); this module gives it the server's cache (SleeperLeaguePolicies) and adds what
 * only the server reads: the projections that rank free agents (fetchSleeperProjections, also used for a league the
 * browser read: src/adapters/sleeper/index.ts importSleeperUpload).
 *
 * - League data is public (anyone with the ID can read it), so it is cached by URL: served for 10
 *   minutes (1 minute after Refresh) and kept 10 minutes either way; projections per NFL week
 *   (projectionsPolicy: served 6 hours for the current week and the next 2, 24 for later weeks, and
 *   kept 24 hours either way, §2.10), never an empty list. The 15 MB players DB is never fetched
 *   here: player facts come from deps.resolver, and injury status and NFL team from the projection
 *   rows (fresher).
 * - Projections: this NFL week and the next two (FREE_AGENT_RANK_WEEKS, capped at week 18), so a
 *   free agent on bye or out this week still ranks by the weeks he's projected to play. Each body is reduced at fetch
 *   time to what the import reads (importProjectionsPolicy; src/data/reduce.ts IMPORT_PROJECTIONS_REDUCER) and marked
 *   league-independent (cache.public) for the shared cache (planner reply to Checkpoint 4c, Part B, B1). League data,
 *   Sleeper's NFL state, user lookups and their keys are as before.
 */
import type { HttpClient, ImportDeps, SleeperImportRequest } from "@/adapters/types";
import { POSITIONS, type ImportWarning, type Pos } from "@/engine/model";
import { config } from "@/engine/config";
import { IMPORT_PROJECTIONS_REDUCER } from "@/data/reduce";
import { PROJECTIONS_NEAR_WEEKS, TTL, leagueTtl } from "@/server/cache";
import { LAST_NFL_WEEK, fetchSleeperLeagueData, sleeperGetter, sleeperUrls, type CachePolicy, type SleeperLeagueData, type SleeperLeaguePolicies } from "./leagueData";
import { SLOT_ELIGIBLE, type SleeperRawLeague } from "./normalize";
import type { SleeperLeague, SleeperState } from "./schemas";

export {
  SLEEPER_API,
  SLEEPER_PROJECTIONS,
  SleeperLeagueChoiceError,
  leagueChoicesOf,
  parseSleeperLeagueId,
  requireJson,
  sleeperUrls,
  type CachePolicy,
  type SleeperLeagueChoice,
} from "./leagueData";

/**
 * Weeks of projections that rank free agents: this week and the next ones (a bye or a one-week
 * absence then doesn't hide a player). An adapter constant for now; see the checkpoint notes.
 */
export const FREE_AGENT_RANK_WEEKS = config.import.freeAgentRankWeeks;

/** League data: served 10 minutes (1 minute after Refresh), and kept 10 minutes either way. */
function leaguePolicy(refresh?: boolean): CachePolicy {
  return { ttlMs: leagueTtl(refresh), retainMs: TTL.league, league: true };
}

/**
 * Transactions and matchups of league weeks that ended over a week ago: final (stat corrections are
 * done), so they're kept 6 hours and Refresh doesn't shorten that. They don't count toward the
 * Import Report's "fetched at", which describes the live part of the league.
 */
export const CLOSED_WEEK_POLICY: CachePolicy = { ttlMs: TTL.closedTransactions, retainMs: TTL.closedTransactions, league: false };

/** User lookups: cached like league data, but not league data themselves. */
const userPolicy = (refresh?: boolean): CachePolicy => ({ ...leaguePolicy(refresh), league: false });

/** The server's cache for the league-data half (./leagueData.ts SleeperLeaguePolicies). */
export function serverLeaguePolicies(refresh?: boolean): SleeperLeaguePolicies {
  return { league: leaguePolicy(refresh), closedWeek: CLOSED_WEEK_POLICY, user: userPolicy(refresh) };
}

/**
 * Public projections and stats: served and kept 6 hours (§2.10); an empty list (not posted yet) isn't
 * cached. Season projections and stats always use this; weekly projections use projectionsPolicy.
 */
export const PROJECTIONS_POLICY: CachePolicy = {
  ttlMs: TTL.projections,
  retainMs: TTL.projections,
  league: false,
  cacheIf: (res) => Array.isArray(res.json) && res.json.length > 0,
};

/**
 * How long every copy of a week's projections is kept, whichever policy stored it: the longest TTL a
 * request for it uses. Whether a week is near or later depends on the current week of the build that
 * asks, and builds can disagree (an ESPN league's scoring period and Sleeper's NFL week around the
 * weekly rollover), so one URL is asked for under both policies, and a cache hit or a single-flight
 * join serves a copy another request stored. One retention per URL keeps "how long the cache holds
 * this copy" a fact about the copy, which the Sleeper gate relies on during an outage
 * (src/data/sleeperProjections.ts). Like Refresh for league data, a week's nearness shortens how old a
 * copy may be served, not how long it's kept (public data: within the privacy page's "up to a week").
 */
const WEEKLY_PROJECTIONS_RETAIN_MS = TTL.projectionsLater;

/** Weekly projections of past weeks, the current NFL week and the next PROJECTIONS_NEAR_WEEKS: served 6 hours, kept 24 (§2.10). */
export const NEAR_PROJECTIONS_POLICY: CachePolicy = { ...PROJECTIONS_POLICY, retainMs: WEEKLY_PROJECTIONS_RETAIN_MS };

/** Weekly projections of later NFL weeks: served and kept 24 hours, same rule for empty lists (§2.10, Checkpoint 2). */
export const LATER_PROJECTIONS_POLICY: CachePolicy = { ...PROJECTIONS_POLICY, ttlMs: TTL.projectionsLater, retainMs: WEEKLY_PROJECTIONS_RETAIN_MS };

/**
 * How one NFL week's weekly projections are cached (§2.10; each week is its own cache entry, one URL per
 * week): the current NFL week, the next PROJECTIONS_NEAR_WEEKS and past weeks refresh every 6 hours
 * (NEAR_PROJECTIONS_POLICY), later weeks every 24 hours (LATER_PROJECTIONS_POLICY). Every copy is kept
 * 24 hours either way (WEEKLY_PROJECTIONS_RETAIN_MS).
 */
export function projectionsPolicy(week: number, currentWeek: number): CachePolicy {
  return week <= currentWeek + PROJECTIONS_NEAR_WEEKS ? NEAR_PROJECTIONS_POLICY : LATER_PROJECTIONS_POLICY;
}

/**
 * How the import's projection weeks are fetched (planner reply to Checkpoint 4c, Part B, B1; src/data/reduce.ts): the
 * week's projectionsPolicy, league-independent (public), each body reduced to what the import reads
 * (IMPORT_PROJECTIONS_REDUCER: every row's player object and real rows' stats) under a cache entry of its own. ⚠️ The
 * model build's loader reads the same URLs reduced its own way (MODEL_PROJECTIONS_REDUCER), so the two no longer share a
 * copy: an import and a model build in the same 6 hours ask Sleeper for these weeks once each, and the injury tags and
 * teams the import reads here can come from a fetch up to about 6 hours apart from the model's projections of the same
 * weeks (review CA-10; src/data/sleeperProjections.ts header).
 */
export function importProjectionsPolicy(week: number, currentWeek: number): CachePolicy {
  return { ...projectionsPolicy(week, currentWeek), public: true, reducer: IMPORT_PROJECTIONS_REDUCER };
}

export interface SleeperFetchResult {
  raw: SleeperRawLeague;
  /** The user's Sleeper user_id when they came in with a username. */
  userId?: string;
  warnings: ImportWarning[];
  /** When the oldest league-data response was fetched from Sleeper (epoch ms). */
  fetchedAt?: number;
}

/** Every position the league can start, in canonical order. */
export function startablePositions(rosterPositions: readonly string[]): Pos[] {
  const set = new Set<Pos>(rosterPositions.flatMap((s) => [...(SLOT_ELIGIBLE[s] ?? [])]));
  return POSITIONS.filter((p) => set.has(p));
}

/** The offense: the positions every league's projection and stat requests ask for (projectionPositions). */
export const OFFENSE_POSITIONS: readonly Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
/** The IDP positions, asked for too by a league that starts any of them (projectionPositions). */
export const IDP_POSITIONS: readonly Pos[] = ["DL", "LB", "DB"];

/**
 * The positions a projection or stat request asks Sleeper for, given the positions a league starts (review BF-R2): one of
 * two fixed groups, in canonical order, so a request's address (its cache key) never depends on a league's lineup. A
 * league the browser sends can name any lineup, and with one list per set of positions each new set was a list the
 * server fetched for that league alone, counted against no visitor's share of the day's requests; with two groups every
 * league shares the same lists. The offense for a league that starts any position (the lists of most leagues, Parker's
 * among them, are unchanged), plus the IDP positions when it starts one of them; none for a league that starts none.
 * P is never asked for (Sleeper doesn't project punters). A row of a position the league doesn't start is read like any
 * other: only the league's own players' rows are used, and a free agent must play a position it starts.
 */
export function projectionPositions(positions: Iterable<Pos>): Pos[] {
  const wanted = new Set(positions);
  wanted.delete("P");
  if (!wanted.size) return [];
  const idp = IDP_POSITIONS.some((p) => wanted.has(p));
  return POSITIONS.filter((p) => OFFENSE_POSITIONS.includes(p) || (idp && IDP_POSITIONS.includes(p)));
}

/** The NFL weeks whose projections rank free agents: `week` and the next ones, capped at week 18. */
export function freeAgentRankWeeks(week: number): number[] {
  const out: number[] = [];
  for (let w = week; w < week + FREE_AGENT_RANK_WEEKS && w <= LAST_NFL_WEEK; w++) out.push(w);
  return out;
}

/**
 * The projections that rank free agents (see the header): this NFL week and the next ones, for every position the league
 * starts (asked as one of two fixed groups: projectionPositions), during the regular season of the league's own season;
 * nothing otherwise. Always the server's own copies, also for a league the browser read (the server never takes public
 * facts from a browser).
 */
export async function fetchSleeperProjections(state: SleeperState, league: SleeperLeague, http: HttpClient): Promise<{ projections?: Record<number, unknown>; projectionWeek?: number; warnings: ImportWarning[] }> {
  const warnings: ImportWarning[] = [];
  const g = sleeperGetter(http, warnings, NEAR_PROJECTIONS_POLICY);
  const season = Number(league.season);
  const inSeason = season === Number(state.season) && state.season_type === "regular";
  // One of two fixed groups (projectionPositions): every league asks for the same lists (review BF-R2).
  const positions = projectionPositions(startablePositions(league.roster_positions));
  const projectionWeek = inSeason ? Math.max(1, Math.min(LAST_NFL_WEEK, state.week)) : undefined;
  const projectionWeeks = projectionWeek !== undefined && positions.length ? freeAgentRankWeeks(projectionWeek) : [];
  const projectionList = await Promise.all(
    projectionWeeks.map((w) => g.optional(sleeperUrls.projections(season, w, positions), `projections/${w}`, "PROJECTIONS_UNREADABLE", importProjectionsPolicy(w, projectionWeek ?? w))),
  );
  const projections: Record<number, unknown> = {};
  projectionWeeks.forEach((w, i) => {
    if (projectionList[i] !== undefined) projections[w] = projectionList[i];
  });
  return {
    ...(Object.keys(projections).length ? { projections } : {}),
    ...(projectionWeek !== undefined ? { projectionWeek } : {}),
    warnings,
  };
}

/** The league's own responses plus the server's projections, as one fetch result (both halves' warnings, in order). */
export function withProjections(data: SleeperLeagueData, extra: Awaited<ReturnType<typeof fetchSleeperProjections>>): SleeperFetchResult {
  return {
    raw: {
      ...data.raw,
      ...(extra.projections ? { projections: extra.projections } : {}),
      ...(extra.projectionWeek !== undefined ? { projectionWeek: extra.projectionWeek } : {}),
    },
    ...(data.userId ? { userId: data.userId } : {}),
    warnings: [...data.warnings, ...extra.warnings],
    ...(data.fetchedAt !== undefined ? { fetchedAt: data.fetchedAt } : {}),
  };
}

/** Fetch every response the normalizer needs. Throws LeagueImportError for anything the user must fix. */
export async function fetchSleeperLeague(req: SleeperImportRequest, deps: Pick<ImportDeps, "http">): Promise<SleeperFetchResult> {
  const data = await fetchSleeperLeagueData(req, deps.http, serverLeaguePolicies(req.refresh));
  return withProjections(data, await fetchSleeperProjections(data.state, data.league, deps.http));
}
