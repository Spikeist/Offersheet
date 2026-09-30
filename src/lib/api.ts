/**
 * Shapes of the app's own API (client-safe; the route handlers in src/app/api produce them) and a
 * small fetch helper for the pages. Credentials travel only in a POST body to /api/session/espn and
 * never come back in any response.
 */
import type { ImportResult } from "@/adapters/types";
import type { AppErrorCode } from "./errors";
import { errorMessage } from "./errors";

/** Where the shared data (player ID maps and databases) came from and when. */
export interface DataSourceStamp {
  name: string;
  /** ISO time it was fetched; null when it came from the server cache or couldn't be loaded. */
  fetchedAt: string | null;
  fromCache?: boolean;
  available?: boolean;
  /** Why a source is missing or only partly loaded. */
  note?: string;
}

/**
 * Where the ESPN cookies of an import came from: this browser session's sealed cookie, or (in
 * development only, for Parker's own league) .env.local.
 */
export type EspnCookieSource = "session" | "dev-env";

/** POST /api/import/{espn,sleeper} success: the adapter's ImportResult plus Import Report extras. */
export interface ImportResponse extends ImportResult {
  dataSources?: DataSourceStamp[];
  /** ESPN only: whether the import sent ESPN cookies. */
  usedEspnCookies?: boolean;
  /** ESPN only, when cookies were sent: where they came from. */
  espnCookieSource?: EspnCookieSource;
}

export interface SleeperLeagueChoice {
  id: string;
  name: string;
  teams: number | null;
  /** Sleeper's league status, e.g. "in_season", "pre_draft". */
  status: string | null;
  leagueType: "redraft" | "keeper" | "dynasty" | "guillotine" | null;
  bestBall: boolean;
  /** False for league types the MVP rejects at import (guillotine). */
  supported: boolean;
}

/** POST /api/import/sleeper when a username has several leagues: the user picks one. */
export interface SleeperChooseLeagueResponse {
  chooseLeague: { username: string; season: number; leagues: SleeperLeagueChoice[] };
}

export interface ApiErrorResponse {
  error: { code: AppErrorCode; message: string };
}

/** GET /api/session/espn. */
export interface EspnSessionStatus {
  /** ESPN cookies are saved in this browser session. */
  connected: boolean;
  /** The server can keep credentials at all (SESSION_SECRET is set). */
  available: boolean;
}

export interface EspnImportBody {
  leagueId: string;
  season: number;
  /** Not sent by the Connect page: a team from a pasted link is kept in the browser as a pick to confirm. */
  myTeamId?: string;
  /** The Import Report's Refresh button (league data cached over a minute ago is fetched again). */
  refresh?: boolean;
}

export interface SleeperImportBody {
  season: number;
  username?: string;
  leagueId?: string;
  chooseLeagueId?: string;
  refresh?: boolean;
}

export interface EspnSessionBody {
  espnS2: string;
  swid: string;
}

export function isApiError(x: unknown): x is ApiErrorResponse {
  if (!x || typeof x !== "object" || !("error" in x)) return false;
  const e = (x as { error: unknown }).error;
  return !!e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string" && typeof (e as { message?: unknown }).message === "string";
}

export function isChooseLeague(x: unknown): x is SleeperChooseLeagueResponse {
  if (!x || typeof x !== "object" || !("chooseLeague" in x)) return false;
  const c = (x as { chooseLeague: unknown }).chooseLeague;
  return !!c && typeof c === "object" && Array.isArray((c as { leagues?: unknown }).leagues);
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Calls one of our own API routes with a JSON body. Network failures and non-JSON replies become an
 * ApiErrorResponse, so callers only ever handle data or { error }.
 */
export async function callApi<T>(url: string, init: { method: "GET" | "POST" | "DELETE"; body?: unknown }, fetchImpl: FetchLike = fetch): Promise<T | ApiErrorResponse> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: init.method,
      headers: init.body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { error: { code: "INTERNAL", message: "We couldn't reach Offer Sheet. Check your connection and try again." } };
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { error: { code: "INTERNAL", message: errorMessage("INTERNAL") } };
  }
  if (!res.ok && !isApiError(data)) return { error: { code: "INTERNAL", message: errorMessage("INTERNAL") } };
  return data as T | ApiErrorResponse;
}
