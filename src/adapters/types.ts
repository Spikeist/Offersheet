/**
 * Adapter contracts shared by every platform (CLAUDE.md §3, §4). An adapter has two halves:
 *
 * - fetch: talks to the platform through an injected HttpClient (server-side; polite, cached).
 * - normalize: a PURE function from the fetched responses to a LeagueSnapshot. Adapter tests call
 *   it on sanitized fixtures with no network.
 *
 * Errors a user can act on are LeagueImportError with a stable code; the UI turns codes into plain
 * messages (e.g. LEAGUE_NOT_FOUND → "League not found for that season.").
 */
import type { PlayerIdResolver } from "@/data/types";
import type { LeagueSnapshot, Platform } from "@/engine/model";

export type ImportErrorCode =
  /** Wrong league id or season (ESPN 404 GENERAL_NOT_FOUND; Sleeper 404 / null body). */
  | "LEAGUE_NOT_FOUND"
  /** ESPN league is private and no cookies were sent (401 / 403 / HTML login page). */
  | "PRIVATE_LEAGUE"
  /** Cookies were sent but rejected, or expired. */
  | "BAD_CREDENTIALS"
  /** League exists but isn't activated for this season. */
  | "NOT_ACTIVATED"
  /** A league the MVP doesn't support, e.g. a Sleeper guillotine league (type 3). */
  | "UNSUPPORTED_LEAGUE"
  /** Sleeper username not found. */
  | "USER_NOT_FOUND"
  /** The user has no league on this platform for the season, or must pick one. */
  | "NO_LEAGUE"
  /** 5xx / network failure after polite retries. */
  | "SOURCE_DOWN"
  /** The response didn't match the expected shape (details carry the JSON path). */
  | "BAD_RESPONSE";

export class LeagueImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
    readonly detail: { platform?: Platform; status?: number; path?: string } = {},
  ) {
    super(message);
    this.name = "LeagueImportError";
  }
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  /** True when the body is an HTML page (e.g. an ESPN login page) rather than data. */
  isHtml: boolean;
  /** Parsed JSON body, or undefined. */
  json: unknown;
  /** Raw text body (for HTML pages and error bodies). */
  text: string;
  fromCache: boolean;
  /** When the body was fetched from its source (epoch ms); for a cached body, the original fetch time. */
  fetchedAt?: number;
  /** A live fetch failed and an older cached copy was served instead (cache.staleIfError). */
  stale?: boolean;
  /**
   * With `stale` after a live fetch: the live answer that couldn't be used, its status (0: no response, a network error or
   * a timeout) and whether it was an HTML page; a 200 body the caller's cacheIf turned down reads status 200, isHtml false.
   * So a caller can tell a source that didn't answer from one that answered with something unusable (src/data/
   * fantasyCalcValues.ts's outage memory). Absent on a copy served without a live attempt (cacheOnly).
   */
  liveFailure?: { status: number; isHtml: boolean };
}

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  /** Cookie header value (never logged, never part of a cache key). */
  cookie?: string;
  /**
   * Cache key and TTL (§2.10). Keys of private data must include credentialScope. A copy younger than
   * ttlMs is served; the stored copy is deleted after retainMs (default ttlMs; Refresh lowers ttlMs,
   * not retainMs). With staleIfError, a failed live fetch serves a retained older copy (marked stale).
   */
  cache?: { key: string; ttlMs: number; retainMs?: number; staleIfError?: boolean };
  /** Only bodies this accepts are cached (and count as a success for staleIfError); default: every 200 non-HTML body. */
  cacheIf?: (res: HttpResponse) => boolean;
  /** Rewrites a body before it is parsed or cached (e.g. ESPN SWIDs to one-way pseudonyms). */
  transformText?: (text: string) => string;
  /** Parse 16+ digit integers as strings (Sleeper sends some 19-digit IDs as bare numbers). */
  bigIntsAsStrings?: boolean;
  timeoutMs?: number;
  /** Retries on 429 / 5xx / network errors (default 3; MFL hosts never retry). */
  maxRetries?: number;
  /**
   * Never ask the source (a caller holding off a source it found down: src/data/fantasyCalcValues.ts's outage memory):
   * serve the copy the cache holds younger than cache.ttlMs, else, with cache.staleIfError, a retained older copy (marked
   * stale); else a status-0 response, and no request at all. Without a cache: always that status-0 response.
   */
  cacheOnly?: boolean;
}

/** Injected HTTP client: polite (per-host pacing, backoff on 429/5xx, no retry on 401/403/HTML). */
export interface HttpClient {
  get(url: string, opts?: HttpRequestOptions): Promise<HttpResponse>;
}

/** What the user entered on the Connect page. */
export interface EspnImportRequest {
  leagueId: string;
  season: number;
  /** Only for private leagues. Travel in a POST body and a session-only cookie (§3). */
  credentials?: { espnS2: string; swid: string };
  /** For public leagues without cookies the user picks their team (§2.2 My team). */
  myTeamId?: string;
  /** The Import Report's Refresh button (§2.10): league data older than TTL.leagueRefresh is fetched again. */
  refresh?: boolean;
}

export interface SleeperImportRequest {
  season: number;
  leagueId?: string;
  username?: string;
  /** Needed when a username has several leagues for the season. */
  chooseLeagueId?: string;
  /** The Import Report's Refresh button (§2.10): league data older than TTL.leagueRefresh is fetched again. */
  refresh?: boolean;
}

export interface ImportResult {
  snapshot: LeagueSnapshot;
  /** Short human notes for the Import Report beyond snapshot.warnings (e.g. "lineups are set automatically"). */
  notes: string[];
}

/**
 * What every adapter receives. Signatures the app relies on:
 *   importEspnLeague(req: EspnImportRequest, deps: ImportDeps): Promise<ImportResult>      src/adapters/espn/index.ts
 *   importSleeperLeague(req: SleeperImportRequest, deps: ImportDeps): Promise<ImportResult> src/adapters/sleeper/index.ts
 *   loadPlayerIdResolver(deps: { http: HttpClient; now?: Date }): Promise<PlayerIdResolver> src/data/index.ts
 */
export interface ImportDeps {
  http: HttpClient;
  resolver: PlayerIdResolver;
  /** Pass the time in (engine rule: no Date.now() in pure code). */
  now: Date;
}
