/**
 * Shapes of the app's own API (client-safe; the route handlers in src/app/api produce them) and a
 * small fetch helper for the pages. Credentials travel only in a POST body to /api/session/espn and
 * never come back in any response.
 */
import type { EspnProjections } from "@/adapters/espn/projections";
import type { ImportResult } from "@/adapters/types";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueSnapshot } from "@/engine/model";
import type { AppErrorCode } from "./errors";
import { errorForStatus, errorMessage } from "./errors";

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
 * development only, for Parker's own league, with USE_ENV_COOKIES=1) .env.local.
 */
export type EspnCookieSource = "session" | "dev-env";

/**
 * Who read the league's own data (planner reply to Checkpoint 4c, Part B, B1: browser fetching; track BF): "browser", the
 * user's browser read a public ESPN league or a Sleeper league itself and sent it up; "server", Offer Sheet's server read
 * it (a private ESPN league, any while ESPN cookies are connected, or when the browser couldn't).
 */
export type ImportReader = "browser" | "server";

/** What the model build reads of an import beyond its snapshot (track BF): ESPN's league-scored projections; nothing for Sleeper. */
export interface ImportModelPart {
  espn?: EspnProjections;
}

/** The server's signature of an import (src/server/importToken.ts): when it was made, and the token. */
export interface ImportSignature {
  issuedAt: number;
  token: string;
}

/** POST /api/import/{espn,sleeper} success: the adapter's ImportResult plus Import Report extras. */
export interface ImportResponse extends ImportResult {
  dataSources?: DataSourceStamp[];
  /** ESPN only: whether the import sent ESPN cookies. */
  usedEspnCookies?: boolean;
  /** ESPN only, when cookies were sent: where they came from. */
  espnCookieSource?: EspnCookieSource;
  /** Who read the league (ImportReader; the Import Report says so). Absent on an import saved before browser reading. */
  readBy?: ImportReader;
  /** The model build's part of the import (ImportModelPart), signed with the snapshot. */
  modelPart?: ImportModelPart;
  /**
   * The server's signature over { snapshot, modelPart } (src/server/importToken.ts): the League page sends the import back
   * with it, and the model route builds the numbers without reading the league again. Absent when the server can't sign
   * (no SESSION_SECRET) and on imports saved before it: then the model route reads the league itself.
   */
  signed?: ImportSignature;
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

/** The Sleeper adapter's league choices (src/adapters/sleeper/leagueData.ts SleeperLeagueChoice). */
export interface AdapterLeagueChoice {
  leagueId: string;
  name: string;
  teams: number | null;
  status: string | null;
  leagueType?: "redraft" | "keeper" | "dynasty" | "guillotine" | null;
  bestBall?: boolean;
  supported: boolean;
}

/**
 * The league picker's answer for a username's leagues (pure): the supported ones first, then by name. The import route
 * builds it from the server's lookup, the browser from its own (src/lib/leagueFetch.ts), so the two read the same.
 */
export function chooseLeagueResponse(username: string, season: number, choices: readonly AdapterLeagueChoice[]): SleeperChooseLeagueResponse {
  const leagues = choices
    .map((c): SleeperLeagueChoice => ({ id: c.leagueId, name: c.name, teams: c.teams, status: c.status, leagueType: c.leagueType ?? null, bestBall: c.bestBall ?? false, supported: c.supported }))
    .sort((a, b) => Number(b.supported) - Number(a.supported) || a.name.localeCompare(b.name));
  return { chooseLeague: { username, season, leagues } };
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

/** POST /api/model/espn: the league again (served from the 10-minute cache) and its model inputs. */
export interface EspnModelBody {
  leagueId: string;
  season: number;
  /** The League page's Refresh button (league data cached over a minute ago is fetched again). */
  refresh?: boolean;
}

/** POST /api/model/sleeper. */
export interface SleeperModelBody {
  season: number;
  leagueId: string;
  /** The Sleeper username the league was imported with, if any: the re-import then finds the user's team, as the import did. */
  username?: string;
  refresh?: boolean;
}

/**
 * POST /api/model/{espn,sleeper} with a saved import and its signature (track BF; sent as gzip, src/lib/leagueFetch.ts
 * postGzipJson): the league's ID and season (and a Sleeper username), so a signature that doesn't check out (an import
 * saved before signing, another server secret) still gets the numbers: the server then reads the league itself.
 */
export interface SignedModelBody {
  v: 1;
  leagueId: string;
  season: number;
  username?: string;
  import: { snapshot: LeagueSnapshot; modelPart: ImportModelPart };
  signed: ImportSignature;
}

/**
 * What the League page gets: the import (exactly what the import route returns, so the stored import
 * can be refreshed with it) and the model inputs built for that snapshot (CLAUDE.md §6, §9).
 */
export interface ModelResponse {
  import: ImportResponse;
  model: ModelInputs;
}

/**
 * The model routes' answer to a signed import that checked out (SignedModelBody): the inputs for exactly that import,
 * which the browser already has (it isn't sent back).
 */
export interface SignedModelResponse {
  model: ModelInputs;
  signedImport: true;
}

export function isApiError(x: unknown): x is ApiErrorResponse {
  if (!x || typeof x !== "object" || !("error" in x)) return false;
  const e = (x as { error: unknown }).error;
  return !!e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string" && typeof (e as { message?: unknown }).message === "string";
}

export function isModelResponse(x: unknown): x is ModelResponse {
  if (!x || typeof x !== "object" || !("import" in x) || !("model" in x)) return false;
  const { import: imp, model } = x as { import: unknown; model: unknown };
  return !!imp && typeof imp === "object" && "snapshot" in imp && !!model && typeof model === "object" && (model as { version?: unknown }).version === 1;
}

export function isSignedModelResponse(x: unknown): x is SignedModelResponse {
  if (!x || typeof x !== "object" || (x as { signedImport?: unknown }).signedImport !== true) return false;
  const model = (x as { model?: unknown }).model;
  return !!model && typeof model === "object" && (model as { version?: unknown }).version === 1;
}

export function isChooseLeague(x: unknown): x is SleeperChooseLeagueResponse {
  if (!x || typeof x !== "object" || !("chooseLeague" in x)) return false;
  const c = (x as { chooseLeague: unknown }).chooseLeague;
  return !!c && typeof c === "object" && Array.isArray((c as { leagues?: unknown }).leagues);
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** What a failed fetch to our own API says (the browser couldn't reach Offer Sheet at all). */
export const UNREACHABLE_MESSAGE = "We couldn't reach Offer Sheet. Check your connection and try again.";

/**
 * One of our routes' answer, read (callApi, src/lib/leagueFetch.ts): its JSON, or an ApiErrorResponse for a reply that
 * isn't ours (a host's or a firewall's page: errorForStatus words it by its status, a Retry-After included; planner reply
 * to Checkpoint 4c, Part B, track RL's request).
 */
export async function readApiResponse<T>(res: Response): Promise<T | ApiErrorResponse> {
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { error: res.ok ? { code: "INTERNAL", message: errorMessage("INTERNAL") } : errorForStatus(res.status, res.headers.get("retry-after")) };
  }
  if (!res.ok && !isApiError(data)) return { error: errorForStatus(res.status, res.headers.get("retry-after")) };
  return data as T | ApiErrorResponse;
}

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
    return { error: { code: "INTERNAL", message: UNREACHABLE_MESSAGE } };
  }
  return readApiResponse<T>(res);
}
