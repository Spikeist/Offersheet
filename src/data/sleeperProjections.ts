/**
 * Sleeper projections and stats for the projection model (CLAUDE.md §2.3, §5, §6, §2.10). Server-side.
 *
 * Undocumented endpoints, verified live in Phase 0 (reports/probe-output/shared.md PROJ-S, STATS-S):
 *   weekly projections  /projections/nfl/{season}/{week}?season_type=regular&position[]=QB&position[]=RB…
 *   season projections  /projections/nfl/{season}?season_type=regular&position[]=…
 *   actual stats        /stats/nfl/{season}/{week}?season_type=regular&position[]=…
 * Repeated position[] combines positions, and the filter matches fantasy_positions (FB and CB rows come
 * back too). P is never requested: Sleeper doesn't project punters, and punting stats have no canonical
 * keys (src/adapters/espn/scoringMap.ts). Every list asks for one of two fixed groups of positions, the offense (QB,
 * RB, WR, TE, K, DEF), plus DL, LB and DB for a league that starts one of them (sleeperRequestPositions; review BF-R2:
 * a list per lineup let a browser-sent lineup pick lists the server fetched for nobody else).
 *
 * - The weekly URLs and cache policy are the Sleeper adapter's (sleeperUrls.projections, projectionsPolicy: each NFL
 *   week its own entry, served 6 hours for the current week, the next 2 and past weeks and 24 hours for later weeks,
 *   and kept 24 hours either way, §2.10; an empty list never cached), and the positions go in the adapter's order.
 *   Season projections and stats are served and kept 6 hours (PROJECTIONS_POLICY).
 * - Fetch-time reducers (planner reply to Checkpoint 4c, Part B, B1; src/data/reduce.ts): every list here keeps only
 *   what its consumers read, filed under the URL's key plus its reducer's suffix (sleeperListCacheKey): the model's
 *   weekly projections (MODEL_PROJECTIONS_REDUCER: real rows only), season projections and stats. ⚠️ So the Sleeper
 *   import's three projection weeks (IMPORT_PROJECTIONS_REDUCER: every row's player object, for injury status and team)
 *   are a cache entry of their own: a model build no longer reuses an import's copy of those weeks (3 more requests to
 *   Sleeper per 6 hours; the archive below files the model build's own copy of each pre-kickoff week, as before). ⚠️ The
 *   two forms are fetched and refreshed apart, each served up to 6 hours, so a Sleeper league's injury tags and teams
 *   (the import's form) and the model's projections of the same weeks (this form) can come from fetches up to about 6
 *   hours apart (review CA-10; before, they were one copy, apart only when its 6 hours ran out between the import and
 *   the model build). Each is no staler than before; for a player hurt in between, the model then reads a healthy tag
 *   with a zeroed projection, or an injury tag with a healthy one, until the older form refreshes. All of them are
 *   league-independent (cache.public: with the shared cache one server instance fetches each for all).
 * - Every week read with a real projection in it is handed to an optional onWeek hook: the pre-game
 *   projection archive (§2.3 "Pre-game snapshots", src/server/projectionArchive.ts), which
 *   buildModelInputs and `npm run snapshot:projections` wire in.
 * - One request at a time (await in a loop), through a SleeperGate that one model build's three loads
 *   share, so a Sleeper outage costs a build 2 requests and seconds, not 84 requests and minutes
 *   (review DATA-1, PERF-1):
 *   - a live request gets SLEEPER_MODEL_TIMEOUT_MS and one retry (the client's defaults: 30 s and 3);
 *   - after the first request Sleeper doesn't answer (no response or a timeout, 429, 5xx, or an HTML page,
 *     after its retry), nothing more is asked of Sleeper in that build;
 *   - the outage is remembered per HttpClient for SLEEPER_OUTAGE_HOLD_MS, doubling while it lasts (at
 *     most SLEEPER_OUTAGE_MAX_HOLD_MS), so the builds in between ask nothing either (measured from each
 *     build's own time, passed in); a later build then asks again, and one answer ends the outage;
 *   - while Sleeper isn't asked, a list the server cache is known to serve is read from the cache anyway
 *     (a cache hit makes no request): one this process read, remembered per cache key with its fetch time and
 *     how long the cache keeps it, and still younger than this request's TTL (6 or 24 hours). An outage
 *     only costs what the cache doesn't hold. How long the cache keeps a copy is its policy's retention,
 *     the same for every request of the URL whichever build stored or read the copy (weekly projections:
 *     24 hours, near week or later), never the reading request's TTL: builds at different current weeks
 *     ask for the same week under different TTLs.
 *   Each week or list left out that way is a SLEEPER_DOWN warning (src/server/modelInputs.ts merges them
 *   into one line). A 404 or an empty list is an answer: that week gets its own warning and the rest is
 *   still asked for.
 * - Nothing here throws for a source failure: a week (or the season line) that can't be read is left
 *   out of the result with a warning. So is a week without a single usable row (not posted yet).
 * - Projection rows: REAL projections only (hasProjection; an ADP-only stub is a bye, an injury, a
 *   depth player or a player without a team, Phase 0 J.endpoint), deduped by player_id (the first real
 *   row), in the stat keys league scoring uses (normalizeProjectionStats).
 * - Season projections are season totals: every stat is divided by config.projections.seasonGames
 *   BEFORE any scoring, so nonlinear rules see one game's mean instead of firing every game (⚠️ the
 *   totals' span is unverified: season / 17 ÷ the weekly mean was 0.905 for 28 QBs; a last-resort rate).
 * - Stats rows: players with gp > 0 only (gp is 1 or absent on /stats, never 0; Phase 0 cache check), in
 *   raw /stats keys, which are the canonical keys.
 */
import { PROJECTIONS_POLICY, projectionPositions, projectionsPolicy, SLEEPER_PROJECTIONS, sleeperUrls, type CachePolicy } from "@/adapters/sleeper/fetch";
import { hasProjection, LAST_NFL_WEEK } from "@/adapters/sleeper/normalize";
import { normalizeProjectionStats } from "@/adapters/sleeper/scoringMap";
import { parseArrayLenient, StatRowSchema, type SleeperStatRow } from "@/adapters/sleeper/schemas";
import type { HttpClient, HttpRequestOptions, HttpResponse } from "@/adapters/types";
import { config } from "@/engine/config";
import type { ImportWarning, Pos, StatLine } from "@/engine/model";
import { MINUTE } from "@/server/cache";
import { MODEL_PROJECTIONS_REDUCER, reducedKey, SEASON_PROJECTIONS_REDUCER, STATS_REDUCER, type BodyReducer } from "./reduce";

export const SLEEPER_STATS = "https://api.sleeper.app/stats/nfl";

function positionQuery(positions: readonly string[]): string {
  return positions.map((p) => `position[]=${encodeURIComponent(p)}`).join("&");
}

/** Season projections (totals for the regular season) for several positions. */
export function sleeperSeasonProjectionsUrl(season: number, positions: readonly string[]): string {
  return `${SLEEPER_PROJECTIONS}/${season}?season_type=regular&${positionQuery(positions)}`;
}

/** One week's actual stats for several positions. */
export function sleeperStatsUrl(season: number, week: number, positions: readonly string[]): string {
  return `${SLEEPER_STATS}/${season}/${week}?season_type=regular&${positionQuery(positions)}`;
}

/** The Sleeper adapter's cache key scheme (src/adapters/sleeper/fetch.ts getter): the public URL itself. */
export function sleeperCacheKey(url: string): string {
  return `sleeper:${url}`;
}

/**
 * Positions to request for a league that starts `positions`: one of two fixed groups, the offense, plus the IDP
 * positions for a league that starts one (src/adapters/sleeper/fetch.ts projectionPositions, the import's own rule; P
 * never), in canonical order. So every league asks for the same URLs, whatever its lineup (review BF-R2: a lineup a
 * browser sent could otherwise pick lists nobody else asks for).
 */
export function sleeperRequestPositions(positions: Iterable<Pos>): Pos[] {
  return projectionPositions(positions);
}

/** Distinct NFL regular-season weeks, in order. */
function requestWeeks(weeks: Iterable<number>): number[] {
  return [...new Set(weeks)].filter((w) => Number.isInteger(w) && w >= 1 && w <= LAST_NFL_WEEK).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------
// Requests: one model build's gate to Sleeper (review DATA-1, PERF-1; see the header)

/**
 * Per-attempt timeout of a live request. One week of a league's startable positions is 2–3 MB (about
 * 7 MB with IDP), a few seconds on a working connection; the client's default is 30 s.
 */
export const SLEEPER_MODEL_TIMEOUT_MS = 20_000;

/** Retries of a live request on no response, 429 or 5xx (the client's default is 3): a failing URL costs 2 attempts. */
export const SLEEPER_MODEL_MAX_RETRIES = 1;

/**
 * How long an outage is remembered (Sleeper isn't asked meanwhile), doubling while it lasts, up to
 * SLEEPER_OUTAGE_MAX_HOLD_MS: a long outage costs a probe (2 requests) every 15 minutes, and a recovered
 * Sleeper is noticed within 15 minutes.
 */
export const SLEEPER_OUTAGE_HOLD_MS = 5 * MINUTE;
export const SLEEPER_OUTAGE_MAX_HOLD_MS = 15 * MINUTE;

/** The hold after `outages` outages in a row (no outage: 0). */
export function sleeperOutageHoldMs(outages: number): number {
  if (outages <= 0) return 0;
  return Math.min(SLEEPER_OUTAGE_MAX_HOLD_MS, SLEEPER_OUTAGE_HOLD_MS * 2 ** (outages - 1));
}

/** Warning code of a week or list left out because Sleeper stopped answering (one per item; src/server/modelInputs.ts merges them). */
export const SLEEPER_DOWN = "SLEEPER_DOWN";

/**
 * The cache key a list is read under: the URL's (sleeperCacheKey), plus its reducer's suffix when the body is reduced
 * (src/data/reduce.ts reducedKey: the model's weekly projections, season projections and stats each have one).
 */
export function sleeperListCacheKey(url: string, reducer?: BodyReducer): string {
  return reducer ? reducedKey(sleeperCacheKey(url), reducer) : sleeperCacheKey(url);
}

/**
 * Options of every request here: the list's cache entry (its cache policy: projectionsPolicy for a week's projections,
 * PROJECTIONS_POLICY for the season list and stats; its reducer and key, sleeperListCacheKey), with this module's
 * timeout. League-independent data (cache.public: one server instance fetches it for all, src/server/http.ts).
 */
function requestOptions(url: string, maxRetries: number, p: CachePolicy, reducer?: BodyReducer): HttpRequestOptions {
  return {
    cache: { key: sleeperListCacheKey(url, reducer), ttlMs: p.ttlMs, retainMs: p.retainMs, public: true },
    bigIntsAsStrings: true,
    ...(p.cacheIf ? { cacheIf: p.cacheIf } : {}),
    ...(reducer ? { transformText: reducer.reduce } : {}),
    timeoutMs: SLEEPER_MODEL_TIMEOUT_MS,
    maxRetries,
  };
}

/** Why a response can't be used, or undefined when it's a JSON list. */
function unusable(res: HttpResponse): string | undefined {
  if (res.status === 0) return "no response";
  if (!res.ok) return `HTTP ${res.status}`;
  if (res.isHtml) return "a web page instead of data";
  if (!Array.isArray(res.json)) return "not a list";
  return undefined;
}

/**
 * Sleeper isn't serving data: no response (a network error or a timeout), 429, 5xx or an HTML page, after
 * the client's retries (the same test as the players DB's breaker, src/data/sleeperPlayers.ts). A 404 or
 * an empty list is an answer; a cached copy never counts.
 */
function notAnswering(res: HttpResponse): boolean {
  return !res.fromCache && (res.status === 0 || res.status === 429 || res.status >= 500 || res.isHtml);
}

/** One list's rows, or why it wasn't used (`down`: Sleeper stopped answering, at this request or an earlier one). */
export type SleeperRows = { rows: SleeperStatRow[]; bad: number; firstBadPath?: string; res: HttpResponse } | { why: string; down?: true };

function rowsOf(res: HttpResponse): SleeperRows {
  const why = unusable(res);
  if (why) return { why };
  const { rows, bad, firstBadPath } = parseArrayLenient(StatRowSchema, res.json);
  return { rows: rows as SleeperStatRow[], bad, ...(firstBadPath ? { firstBadPath } : {}), res };
}

/** A list the server cache keeps: when its copy was fetched (epoch ms) and how long the cache keeps it. */
interface CachedList {
  fetchedAt: number;
  /**
   * The copy's retention (retentionOf its policy), which is the same for every request of the URL
   * whichever build stored the copy or read it: weekly projections 24 hours, near week or later
   * (projectionsPolicy); season projections and stats 6 hours. Not the reading request's TTL: a build at
   * another current week can store a week under a 6-hour TTL and read it under a 24-hour one, or the
   * other way round.
   */
  retainMs: number;
}

/** How long the server cache keeps a copy stored under `policy` (src/server/http.ts: at least as long as it is served). */
function retentionOf(policy: CachePolicy): number {
  return Math.max(policy.ttlMs, policy.retainMs);
}

/** What the process remembers about Sleeper, per HttpClient (reuse one client per server process, src/app/api/_lib/deps.ts). */
interface SleeperHealth {
  /** Sleeper isn't asked before this (epoch ms). */
  downUntil: number;
  /** Why: the failure that started the hold ("HTTP 503", "no response" …). */
  reason: string;
  /** Outages in a row: each doubles the next hold; back to 0 once Sleeper answers. */
  outages: number;
  /** Cache key (sleeperListCacheKey) → the copy the server cache keeps for it: lists this process read, dropped once past their retention. */
  cached: Map<string, CachedList>;
}

const healthByClient = new WeakMap<HttpClient, SleeperHealth>();

/** One model build's way to Sleeper's projections and stats (see the header). */
export interface SleeperGate {
  /** Why Sleeper isn't asked (it stopped answering in this build, or an outage is remembered); undefined while it is. */
  down(): string | undefined;
  /**
   * One projections or stats list: from the server cache or Sleeper, or why not. Never throws. `policy`
   * is the URL's cache policy (default PROJECTIONS_POLICY, 6 hours; a week's projections:
   * projectionsPolicy). Every request of one URL must use the same retention (see CachedList). `reducer`: the body's
   * fetch-time reducer (src/data/reduce.ts), which also names its cache entry (sleeperListCacheKey); none reads the raw
   * body under the URL's own key.
   */
  rows(url: string, policy?: CachePolicy, reducer?: BodyReducer): Promise<SleeperRows>;
}

/**
 * A gate for one model build at `now` (the build's time: holds and cache ages are measured from it).
 * Builds on the same HttpClient share what it remembers, so a build running alongside one that finds
 * Sleeper down stops at its next request too.
 */
export function sleeperGate(http: HttpClient, now: Date): SleeperGate {
  const at = now.getTime();
  let health = healthByClient.get(http);
  if (!health) {
    health = { downUntil: Number.NEGATIVE_INFINITY, reason: "", outages: 0, cached: new Map() };
    healthByClient.set(http, health);
  }
  const h = health;
  /** The server cache still holds the copy: it isn't past its retention (the cache deletes it then). */
  const held = (copy: CachedList): boolean => copy.fetchedAt + copy.retainMs > at;
  /**
   * The server cache serves the copy to a request with TTL `ttlMs` (FileCache.get): it still holds it,
   * and the copy is younger than that TTL (a week that moved from "later" to "near" is served 6 hours,
   * not 24). Ages count from the fetch, which is at or before the time the copy was stored.
   */
  const servable = (copy: CachedList | undefined, ttlMs: number): boolean => copy !== undefined && copy.fetchedAt + Math.min(copy.retainMs, ttlMs) > at;
  for (const [key, copy] of h.cached) if (!held(copy)) h.cached.delete(key);
  /** Why Sleeper stopped answering in this build. */
  let tripped: string | undefined;

  const down = (): string | undefined => tripped ?? (h.downUntil > at ? h.reason : undefined);

  const request = async (url: string, maxRetries: number, policy: CachePolicy, reducer: BodyReducer | undefined): Promise<HttpResponse | undefined> => {
    try {
      return await http.get(url, requestOptions(url, maxRetries, policy, reducer));
    } catch {
      return undefined; // the real client never throws; any other client's failure is no response
    }
  };

  /**
   * Notes a list the server cache keeps (a 200 list the policy's cacheIf accepts), so a later outage can
   * still read it. A cache hit or a single-flight join may be a copy another request stored: the
   * policy's retention is the copy's all the same (one retention per URL, see CachedList). Remembered by the list's
   * cache key (sleeperListCacheKey), which names the reducer too.
   */
  const remember = (key: string, res: HttpResponse, policy: CachePolicy): void => {
    const fetchedAt = res.fetchedAt;
    const kept = res.status === 200 && !res.isHtml && !res.stale && (policy.cacheIf?.(res) ?? true);
    const copy = fetchedAt !== undefined ? { fetchedAt, retainMs: retentionOf(policy) } : undefined;
    if (kept && copy && held(copy)) h.cached.set(key, copy);
  };

  return {
    down,
    async rows(url, policy = PROJECTIONS_POLICY, reducer) {
      const key = sleeperListCacheKey(url, reducer);
      const why = down();
      if (why !== undefined) {
        // Sleeper isn't asked: only a list the server cache holds is read (a cache hit makes no request).
        if (!servable(h.cached.get(key), policy.ttlMs)) return { why, down: true };
        const res = await request(url, 0, policy, reducer);
        // The cache didn't hold it after all, and a live attempt went out: stop counting on the others.
        if (!res?.fromCache) h.cached.clear();
        if (!res || notAnswering(res)) return { why, down: true };
        remember(key, res, policy);
        return rowsOf(res);
      }
      const res = await request(url, SLEEPER_MODEL_MAX_RETRIES, policy, reducer);
      if (!res || notAnswering(res)) {
        // Cut by this request's own deadline (Checkpoint 7a, review RL-2) or by Offer Sheet's own daily Sleeper budget or
        // its share for the visitor's network (Checkpoint 7b, as fantasyCalcValues.ts fantasyCalcOutcome): Sleeper wasn't
        // slow or wasn't asked, so only this build stops asking. The instance-wide hold is left alone: a share one visitor's
        // requests can use up must not hold every build on the instance off Sleeper.
        if (res?.cut === "deadline" || res?.cut === "budget") {
          tripped = res.cut === "deadline" ? SLEEPER_DEADLINE_WHY : SLEEPER_BUDGET_WHY;
          return { why: tripped, down: true };
        }
        const reason = (res && unusable(res)) || "no response";
        tripped = reason;
        // A build running alongside may have started the hold already: one outage, one doubling.
        if (!(h.downUntil > at)) {
          h.outages += 1;
          h.downUntil = at + sleeperOutageHoldMs(h.outages);
          h.reason = reason;
        }
        return { why: reason, down: true };
      }
      if (!res.fromCache) {
        // Sleeper answered: any outage is over.
        h.outages = 0;
        h.downUntil = Number.NEGATIVE_INFINITY;
      }
      remember(key, res, policy);
      return rowsOf(res);
    },
  };
}

/** Why a build stopped asking Sleeper after its request ran out of time (not an outage: no instance-wide hold). */
export const SLEEPER_DEADLINE_WHY = "this request ran out of time";

/** Why a build stopped asking Sleeper after Offer Sheet's own daily budget (or the network's share of it) refused a request. */
export const SLEEPER_BUDGET_WHY = "not asked: Offer Sheet has used today's share of requests to Sleeper";

/** A week or list left out because Sleeper stopped answering (SLEEPER_DOWN; `what` is plural: "projections for week 5"). */
function downWarning(what: string, why: string, path: string): ImportWarning {
  return { code: SLEEPER_DOWN, message: `Sleeper's ${what} are left out: Sleeper stopped answering (${why}).`, platformPath: path };
}

// ---------------------------------------------------------------------------------------------
// What every load reports

/** What every load reports besides its data. */
export interface SleeperLoadMeta {
  /** Weeks (or the season line) left out, and rows skipped. */
  warnings: ImportWarning[];
  /** Every response used came from the server cache (true when none was used). */
  fromCache: boolean;
  /** A response used was a saved copy standing in for a failed request. */
  stale: boolean;
  /** When the oldest response used was fetched from Sleeper (epoch ms), when the client reports it. */
  fetchedAt?: number;
}

function tracker(): { meta: SleeperLoadMeta; used(res: HttpResponse): void } {
  const meta: SleeperLoadMeta = { warnings: [], fromCache: true, stale: false };
  return {
    meta,
    used(res) {
      meta.fromCache &&= res.fromCache;
      if (res.stale) meta.stale = true;
      if (res.fetchedAt !== undefined) meta.fetchedAt = Math.min(meta.fetchedAt ?? res.fetchedAt, res.fetchedAt);
    },
  };
}

function rowsSkipped(code: string, what: string, path: string, got: { bad: number; firstBadPath?: string }): ImportWarning {
  return { code, message: `${what}: ${got.bad} row(s) didn't have the expected shape and were skipped.`, platformPath: `${path}${got.firstBadPath ?? ""}` };
}

/** A team defense's Sleeper id: its team code. */
export const TEAM_DEFENSE_ID = /^[A-Z]{2,3}$/;

/** Sleeper's position for a row's player ("DEF" for a team defense); "" when the row doesn't say. */
export function sleeperPositionOf(row: SleeperStatRow): string {
  return row.player?.position?.trim() || (TEAM_DEFENSE_ID.test(row.player_id) ? "DEF" : "");
}

// ---------------------------------------------------------------------------------------------
// Weekly projections

export interface SleeperProjectionLine {
  /** Projected stat means for one game, in the keys league scoring uses (normalizeProjectionStats). */
  stats: StatLine;
  /** Sleeper's position for the player ("QB", "FB", "CB", "DEF", …); "" when the row doesn't say. */
  sleeperPosition: string;
}

/** The real projections in one week's rows (pure): stubs dropped, the first real row per player kept, stats normalized. */
export function projectionLines(rows: readonly SleeperStatRow[]): Map<string, SleeperProjectionLine> {
  const out = new Map<string, SleeperProjectionLine>();
  for (const row of rows) {
    if (out.has(row.player_id) || !hasProjection(row.stats)) continue;
    const sleeperPosition = sleeperPositionOf(row);
    out.set(row.player_id, { stats: normalizeProjectionStats(row.stats, sleeperPosition), sleeperPosition });
  }
  return out;
}

export interface SleeperWeeklyProjectionsLoad extends SleeperLoadMeta {
  /** NFL week → Sleeper id → his real projection. A week that couldn't be read is missing (not empty). */
  weeks: Map<number, Map<string, SleeperProjectionLine>>;
}

/**
 * One week of projections as the model's loader read it (what the onWeek hook gets; the pre-game archive's input): the
 * body in MODEL_PROJECTIONS_REDUCER's form (src/data/reduce.ts), which gives the loader and the archive exactly what
 * Sleeper's raw body gives them (reduce.test.ts, `npm run measure:cache`).
 */
export interface SleeperProjectionWeek {
  season: number;
  week: number;
  /** The positions the request asked for (Sleeper's position[] filter), in request order. */
  positions: readonly Pos[];
  /**
   * The rows that fit the schema, in Sleeper's order. Reduced (the usual case): the real projections only (stub rows are
   * dropped at fetch time; every consumer skips them), each with its player id, numeric stats, position and fantasy
   * positions, and the latest last_modified any of that player's rows carried. A body the reducer didn't recognize (a row
   * that doesn't fit the schema, say) comes as Sleeper sent it, stubs and every field included.
   */
  rows: readonly SleeperStatRow[];
  /** The response: fetchedAt (a cached copy keeps its original fetch time), fromCache, and the body's rows in json. */
  res: HttpResponse;
}

export interface WeeklyProjectionOptions {
  /**
   * The current NFL week, which picks each week's cache policy (projectionsPolicy: served 6 hours through
   * two weeks after it, 24 hours later; kept 24 hours either way). Absent: every week is served 6 hours.
   */
  currentWeek?: number;
  /**
   * Called with every week read that holds a real projection, right after it is read (not awaited). A
   * hook that throws is ignored: it can't fail the load.
   */
  onWeek?: (week: SleeperProjectionWeek) => void;
}

/**
 * Sleeper's weekly projections for `weeks` (1–18; others are ignored) at the league's startable
 * `positions`, through the build's gate, each week under its own cache policy (opts.currentWeek). A week
 * that fails, or has no real projection, gets a PROJECTIONS_WEEK_UNAVAILABLE warning (SLEEPER_DOWN when
 * Sleeper stopped answering) and is missing from `weeks`; every other week also goes to opts.onWeek.
 */
export async function loadSleeperWeeklyProjections(
  gate: SleeperGate,
  season: number,
  weeks: Iterable<number>,
  positions: Iterable<Pos>,
  opts: WeeklyProjectionOptions = {},
): Promise<SleeperWeeklyProjectionsLoad> {
  const t = tracker();
  const out = new Map<number, Map<string, SleeperProjectionLine>>();
  const pos = sleeperRequestPositions(positions);
  if (!pos.length) return { weeks: out, ...t.meta };
  for (const week of requestWeeks(weeks)) {
    const path = `projections/${week}`;
    const got = await gate.rows(sleeperUrls.projections(season, week, pos), projectionsPolicy(week, opts.currentWeek ?? week), MODEL_PROJECTIONS_REDUCER);
    const unavailable = (why: string) =>
      t.meta.warnings.push({ code: "PROJECTIONS_WEEK_UNAVAILABLE", message: `Sleeper's projections for week ${week} couldn't be read (${why}), so that week is left out.`, platformPath: path });
    if ("why" in got) {
      if (got.down) t.meta.warnings.push(downWarning(`projections for week ${week}`, got.why, path));
      else unavailable(got.why);
      continue;
    }
    if (got.bad) t.meta.warnings.push(rowsSkipped("PROJECTION_ROWS_UNREADABLE", `Week ${week} projections`, path, got));
    const lines = projectionLines(got.rows);
    if (!lines.size) {
      unavailable("no projections in it");
      continue;
    }
    out.set(week, lines);
    t.used(got.res);
    if (opts.onWeek) {
      try {
        opts.onWeek({ season, week, positions: pos, rows: got.rows, res: got.res });
      } catch {
        // The hook's own failure (the archive never throws); the projections are loaded either way.
      }
    }
  }
  return { weeks: out, ...t.meta };
}

// ---------------------------------------------------------------------------------------------
// Season projections

/** ADP ranks ride along on season rows; they aren't stats. */
const ADP_KEY = /^(pos_)?adp_/;

/**
 * One game's share of a season projection row (pure): the normalized stats (normalizeProjectionStats)
 * each divided by `games`, ADP keys dropped, and gp = 1 (Sleeper writes gp 18 on every season row,
 * projected or not, so it isn't a games count; the line now stands for one game).
 */
export function seasonPerGameLine(stats: Record<string, unknown> | null | undefined, sleeperPosition: string, games: number = config.projections.seasonGames): StatLine {
  const out: StatLine = {};
  for (const [key, value] of Object.entries(normalizeProjectionStats(stats, sleeperPosition))) {
    if (key === "gp" || ADP_KEY.test(key)) continue;
    out[key] = value / games;
  }
  out.gp = 1;
  return out;
}

/** Per-game season lines for the real projections in the rows (pure; the first real row per player). */
export function seasonPerGameLines(rows: readonly SleeperStatRow[], games: number = config.projections.seasonGames): Map<string, StatLine> {
  const out = new Map<string, StatLine>();
  for (const row of rows) {
    if (out.has(row.player_id) || !hasProjection(row.stats)) continue;
    out.set(row.player_id, seasonPerGameLine(row.stats, sleeperPositionOf(row), games));
  }
  return out;
}

export interface SleeperSeasonProjectionsLoad extends SleeperLoadMeta {
  /** Sleeper id → his season projection per game (every stat ÷ config.projections.seasonGames). Empty when it couldn't be read. */
  perGame: Map<string, StatLine>;
}

/**
 * Sleeper's season projections, per game (§6's last-resort base rate), through the build's gate. A
 * failure is a SEASON_PROJECTIONS_UNAVAILABLE warning (SLEEPER_DOWN when Sleeper stopped answering).
 */
export async function loadSleeperSeasonProjections(gate: SleeperGate, season: number, positions: Iterable<Pos>): Promise<SleeperSeasonProjectionsLoad> {
  const t = tracker();
  const pos = sleeperRequestPositions(positions);
  if (!pos.length) return { perGame: new Map(), ...t.meta };
  const path = "projections/season";
  const got = await gate.rows(sleeperSeasonProjectionsUrl(season, pos), PROJECTIONS_POLICY, SEASON_PROJECTIONS_REDUCER);
  const unavailable = (why: string) =>
    t.meta.warnings.push({ code: "SEASON_PROJECTIONS_UNAVAILABLE", message: `Sleeper's season projections couldn't be read (${why}), so players without a weekly projection have no fallback rate.`, platformPath: path });
  if ("why" in got) {
    if (got.down) t.meta.warnings.push(downWarning("season projections", got.why, path));
    else unavailable(got.why);
    return { perGame: new Map(), ...t.meta };
  }
  if (got.bad) t.meta.warnings.push(rowsSkipped("PROJECTION_ROWS_UNREADABLE", "Season projections", path, got));
  const perGame = seasonPerGameLines(got.rows);
  if (!perGame.size) {
    unavailable("no projections in it");
    return { perGame, ...t.meta };
  }
  t.used(got.res);
  return { perGame, ...t.meta };
}

// ---------------------------------------------------------------------------------------------
// Actual stats

/** One game's numbers (non-numbers dropped). */
function numericStats(stats: Record<string, unknown> | null | undefined): StatLine {
  const out: StatLine = {};
  for (const [key, value] of Object.entries(stats ?? {})) if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  return out;
}

/** The stat lines of players who played (gp > 0), the first such row per player (pure). */
export function playedStatLines(rows: readonly SleeperStatRow[]): Map<string, StatLine> {
  const out = new Map<string, StatLine>();
  for (const row of rows) {
    if (out.has(row.player_id)) continue;
    const line = numericStats(row.stats);
    if ((line.gp ?? 0) > 0) out.set(row.player_id, line);
  }
  return out;
}

export interface SleeperStatsLoad extends SleeperLoadMeta {
  /** NFL week → Sleeper id → his stat line, for players who played (gp > 0). A week that couldn't be read is missing. */
  weeks: Map<number, Map<string, StatLine>>;
}

/**
 * Sleeper's actual stats for completed `weeks` at the league's startable `positions`, through the
 * build's gate. A week that fails, or in which no player has a game, gets a STATS_WEEK_UNAVAILABLE
 * warning (SLEEPER_DOWN when Sleeper stopped answering) and is missing.
 */
export async function loadSleeperStats(gate: SleeperGate, season: number, weeks: Iterable<number>, positions: Iterable<Pos>): Promise<SleeperStatsLoad> {
  const t = tracker();
  const out = new Map<number, Map<string, StatLine>>();
  const pos = sleeperRequestPositions(positions);
  if (!pos.length) return { weeks: out, ...t.meta };
  for (const week of requestWeeks(weeks)) {
    const path = `stats/${week}`;
    const got = await gate.rows(sleeperStatsUrl(season, week, pos), PROJECTIONS_POLICY, STATS_REDUCER);
    const unavailable = (why: string) =>
      t.meta.warnings.push({ code: "STATS_WEEK_UNAVAILABLE", message: `Sleeper's stats for week ${week} couldn't be read (${why}), so that week's points are left out.`, platformPath: path });
    if ("why" in got) {
      if (got.down) t.meta.warnings.push(downWarning(`stats for week ${week}`, got.why, path));
      else unavailable(got.why);
      continue;
    }
    if (got.bad) t.meta.warnings.push(rowsSkipped("STATS_ROWS_UNREADABLE", `Week ${week} stats`, path, got));
    const lines = playedStatLines(got.rows);
    if (!lines.size) {
      unavailable("no player with a game in it");
      continue;
    }
    out.set(week, lines);
    t.used(got.res);
  }
  return { weeks: out, ...t.meta };
}
