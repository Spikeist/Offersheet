/**
 * Reading a league from the page (planner reply to Checkpoint 4c, Part B, B1: browser fetching; track BF). Two ways:
 *
 * - The browser path: the user's browser reads the league's own data from the platform itself (src/lib/browserHttp.ts,
 *   no cookies), through the adapter's league-data half (src/adapters/espn/leagueData.ts, src/adapters/sleeper/
 *   leagueData.ts) and a recording client (src/adapters/upload.ts: each response kept as the adapter's schemas keep it,
 *   ESPN's SWIDs replaced by their one-way pseudonyms), gzips the record and posts it to the import route, which replays it
 *   with the server's own public data (Sleeper's NFL state and projections, ESPN's NFL schedule) and the player ID
 *   crosswalk, and answers the import, signed. Sleeper leagues always go this way first, the user lookup and the choice
 *   among a username's leagues included (no server request at all until a league is picked); ESPN leagues too while no
 *   ESPN cookies are connected.
 * - The server path (today's request): JSON to the same route, and the server reads the league itself: an ESPN league
 *   while cookies are connected (a private league needs them), whenever the browser can't (a CORS refusal or a network
 *   error, a timeout, ESPN or Sleeper failing, an answer in a shape the adapter doesn't know, a browser without
 *   CompressionStream; and any request of the league that got no answer at all, even one the adapter could do without,
 *   review BF-R3: the league is read whole or not by the browser), and when the route can't use what the browser sent
 *   (BAD_UPLOAD, among them an upload holding more than any real league; a body too large; our server failing). A
 *   platform's own answer is final on either path: the league doesn't exist for that season, a Sleeper
 *   username or league that isn't there, a league not activated, a guillotine league; an ESPN league that's private is
 *   final when the page knows no cookies are connected (the Connect page; elsewhere the server is asked too, in case they
 *   are). The message is the server's own wording (src/lib/errors.ts errorMessage, as src/app/api/_lib/respond.ts maps it).
 *
 * The League page's numbers (loadModelInputs): the import the browser saved goes back to the model route with its
 * signature (src/server/importToken.ts), which builds the numbers without reading the league again; the league is read
 * again first (the browser path, else the server's) once its data is older than the server's league TTL (10 minutes,
 * browserFetchLimits.reimportAfterMs), as the server's own re-import effectively did, and on Refresh (at most once a
 * minute, refreshEveryMs); an import without a signature (saved before signing, or a server without SESSION_SECRET), an
 * ESPN league read with cookies, and every league in a browser that can't gzip (no CompressionStream, review E2E-1: it can
 * send neither an upload nor a signed import) take today's request (the server reads the league itself). So the privacy
 * policy's "reading it again first when its copy is more than 10 minutes old". When the league was read again but the
 * numbers then failed (the model route BUSY under load, say), the outcome carries the fresh import (ModelOutcome.import),
 * which the pages keep (src/components/league/useLeagueInputs.ts, leagueStore.ts keepImport): the next try sends it back
 * signed instead of reading the league again (review of Phase 7b).
 *
 * POLICY_FEATURES.browserReads (src/lib/site.ts) switches the browser path off as a whole (every read goes the server's way).
 * Client-safe: no React, no server modules (src/server/limits.ts is plain numbers). The read itself (src/lib/leagueRead.ts:
 * the adapters' halves, their zod schemas and tables, about 120 KB gzipped) is loaded only when a league is read, so no
 * page carries it in its first load.
 */
import type { HttpClient } from "@/adapters/types";
import { uploadLimits } from "@/server/limits";
import {
  UNREACHABLE_MESSAGE,
  callApi,
  isApiError,
  isModelResponse,
  isSignedModelResponse,
  readApiResponse,
  type ApiErrorResponse,
  type EspnImportBody,
  type ImportResponse,
  type ModelResponse,
  type SignedModelBody,
  type SleeperChooseLeagueResponse,
  type SleeperImportBody,
} from "./api";
import { createBrowserHttpClient } from "./browserHttp";
import type { AppErrorCode } from "./errors";
import type { StoredImport } from "./importStore";
import type { BrowserRead, EspnCookieState } from "./leagueRead";
import { modelKey, modelPlan, modelRequest } from "./modelStore";
import { POLICY_FEATURES } from "./site";
import { normalizeSleeperUsername } from "./sleeperInput";

export type { BrowserRead, EspnCookieState } from "./leagueRead";

/**
 * The browser path's read itself (src/lib/leagueRead.ts), loaded on demand: it brings zod and the adapters' schemas,
 * which no page needs before it reads a league (the Connect page warms it up once idle: warmUpBrowserRead).
 */
const loadBrowserRead = () => import("./leagueRead");

/** Loads the browser path's code ahead of time, so the first Import doesn't wait for it (failures are ignored: Import loads it again). */
export function warmUpBrowserRead(): void {
  if (POLICY_FEATURES.browserReads) void loadBrowserRead().catch(() => undefined);
}

/** Test hooks (and the parts a page can't choose): our routes' fetch, the platforms' client, the clock, the switch, gzip. */
export interface LeagueFetchDeps {
  fetchImpl?: typeof fetch;
  /** The client the browser path reads the platform with (default: src/lib/browserHttp.ts's). */
  platformHttp?: HttpClient;
  clock?: () => number;
  /** POLICY_FEATURES.browserReads by default. */
  browserReads?: boolean;
  gzip?: (text: string) => Promise<Uint8Array<ArrayBuffer>>;
}

export interface ImportLeagueArgs {
  platform: "espn" | "sleeper";
  /** The same fields as the JSON import body (src/lib/api.ts EspnImportBody, SleeperImportBody). */
  body: EspnImportBody | SleeperImportBody;
  /** ESPN: whether cookies are connected (see the header); "unknown" by default. */
  espnCookies?: EspnCookieState;
  /** The page that asked is gone: every request stops (and the promise rejects with the signal's reason). */
  signal?: AbortSignal;
  deps?: LeagueFetchDeps;
}

/** What an import gives the page: the import, a Sleeper username's leagues to choose from, or an error in words. */
export type ImportOutcome = ImportResponse | SleeperChooseLeagueResponse | ApiErrorResponse;

/** Our routes' answers that mean "this upload can't be used here": the server path is asked instead (see the header). */
export const SERVER_RETRY_CODES: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>(["BAD_UPLOAD", "INVALID_REQUEST", "INTERNAL"]);

/** Whether this browser can gzip an upload (CompressionStream: every current browser since 2023). */
export function canGzip(): boolean {
  return typeof CompressionStream === "function" && typeof Blob === "function" && typeof Response === "function";
}

/** Text, gzipped in the browser (CompressionStream). */
export async function gzipText(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * POSTs a value as gzipped JSON (Content-Type application/gzip) to one of our routes and reads the answer as callApi
 * does; "not-sent" (nothing sent) when it would pass uploadLimits.compressedBytes, or when this browser couldn't gzip it
 * (review E2E-1: a browser without CompressionStream threw here, and the League page never got its numbers). Either way
 * the caller asks the same route with today's JSON request instead.
 */
export async function postGzipJson<T>(url: string, value: unknown, opts: { fetchImpl?: typeof fetch; signal?: AbortSignal; gzip?: (text: string) => Promise<Uint8Array<ArrayBuffer>> } = {}): Promise<T | ApiErrorResponse | "not-sent"> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await (opts.gzip ?? gzipText)(JSON.stringify(value));
  } catch {
    return "not-sent";
  }
  if (bytes.byteLength > uploadLimits.compressedBytes) return "not-sent";
  const doFetch = opts.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/gzip", Accept: "application/json" },
      body: bytes,
      credentials: "same-origin",
      cache: "no-store",
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch {
    if (opts.signal?.aborted) throw opts.signal.reason;
    return { error: { code: "INTERNAL", message: UNREACHABLE_MESSAGE } };
  }
  return readApiResponse<T>(res);
}

/** Whether a read goes the browser's way at all (see the header). */
function browserFirst(args: ImportLeagueArgs, deps: LeagueFetchDeps): boolean {
  if (!(deps.browserReads ?? POLICY_FEATURES.browserReads)) return false;
  if (args.platform === "espn" && args.espnCookies === "connected") return false;
  return deps.gzip !== undefined || canGzip();
}

/** Imports a league from the page (see the header): the browser path first where it applies, else the server's. */
export async function importLeague(args: ImportLeagueArgs): Promise<ImportOutcome> {
  const deps = args.deps ?? {};
  const signal = args.signal;
  const fetchImpl = deps.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const url = `/api/import/${args.platform}`;
  const serverImport = () => callApi<ImportOutcome>(url, { method: "POST", body: args.body }, (input, init) => fetchImpl(input, { ...init, ...(signal ? { signal } : {}) }));
  if (!browserFirst(args, deps)) return serverImport();
  const http = deps.platformHttp ?? createBrowserHttpClient(signal ? { signal } : {});
  let read: BrowserRead;
  try {
    // Loaded on demand (loadBrowserRead); a chunk that can't load (a deploy replaced it, the network dropped) reads as
    // "ask the server" like any other failure here.
    const { readInBrowser } = await loadBrowserRead();
    read = await readInBrowser({ platform: args.platform, body: args.body, http, ...(deps.clock ? { clock: deps.clock } : {}), ...(args.espnCookies ? { espnCookies: args.espnCookies } : {}) });
  } catch {
    read = { kind: "fallback" };
  }
  if (signal?.aborted) throw signal.reason;
  if (read.kind === "choose") return read.choose;
  if (read.kind === "error") return { error: read.error };
  if (read.kind === "fallback") return serverImport();
  const res = await postGzipJson<ImportOutcome>(url, read.upload, { fetchImpl, ...(signal ? { signal } : {}), ...(deps.gzip ? { gzip: deps.gzip } : {}) });
  if (res === "not-sent" || (isApiError(res) && SERVER_RETRY_CODES.has(res.error.code))) return serverImport();
  return res;
}

// ---------------------------------------------------------------------------------------------
// The League page's numbers

/**
 * What the League page gets: the import (the one it sent, or one read again) and its model inputs, or why not, in words.
 * A failure after the league was read again carries that fresh import (`import`; review of Phase 7b): when the model route
 * then answers BUSY (its build slots or the day's work budget) the page keeps it, so its next try within
 * browserFetchLimits.reimportAfterMs sends it back signed (one build) instead of reading the league again.
 */
export type ModelOutcome = { ok: true; response: ModelResponse } | { ok: false; message: string; import?: ImportResponse };

export const MODEL_UNREADABLE = "We couldn't read the projections for this league. Try again in a moment.";
export const MODEL_PLATFORMS_ONLY = "Offer Sheet works with ESPN and Sleeper leagues for now.";

/** The import route's JSON body that reads a saved league again (its league ID and season; a Sleeper username). */
export function importBodyOf(stored: Pick<StoredImport, "request" | "response">, refresh: boolean): EspnImportBody | SleeperImportBody | null {
  const league = stored.response.snapshot;
  const again = refresh ? { refresh: true } : {};
  if (league.platform === "espn") return { leagueId: league.leagueId, season: league.season, ...again };
  if (league.platform === "sleeper") {
    const username = stored.request.username === undefined ? undefined : normalizeSleeperUsername(stored.request.username);
    return { season: league.season, leagueId: league.leagueId, ...(username ? { username } : {}), ...again };
  }
  return null;
}

/** The model route's gzip body for an import and its signature (src/lib/api.ts SignedModelBody). */
export function signedModelBody(request: StoredImport["request"], imported: ImportResponse): SignedModelBody | null {
  if (!imported.signed) return null;
  const snap = imported.snapshot;
  const username = snap.platform === "sleeper" && request.username !== undefined ? normalizeSleeperUsername(request.username) : undefined;
  return { v: 1, leagueId: snap.leagueId, season: snap.season, ...(username ? { username } : {}), import: { snapshot: snap, modelPart: imported.modelPart ?? {} }, signed: imported.signed };
}

/**
 * The league's model inputs for a saved import (see the header): sent back signed when its data is fresh, read again
 * first when it's older or on Refresh, else (no signature, ESPN cookies) today's request, where the server reads it. A
 * browser that can't gzip (no CompressionStream: Safari before 16.4, Firefox before 113) can send neither an upload nor a
 * signed import, so it takes today's request every time, as its imports take the server path (review E2E-1).
 * Rejects with the signal's reason once `signal` aborts.
 */
export async function loadModelInputs(stored: StoredImport, opts: { refresh?: boolean; signal?: AbortSignal; deps?: LeagueFetchDeps } = {}): Promise<ModelOutcome> {
  const deps = opts.deps ?? {};
  const signal = opts.signal;
  const clock = deps.clock ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const withSignal = (input: string, init?: RequestInit) => fetchImpl(input, { ...init, ...(signal ? { signal } : {}) });
  const snapshot = stored.response.snapshot;
  const gzipOk = deps.gzip !== undefined || canGzip();
  const plan = modelPlan(stored, { now: clock(), refresh: opts.refresh ?? false, browserReads: (deps.browserReads ?? POLICY_FEATURES.browserReads) && gzipOk });
  if (!plan) return { ok: false, message: MODEL_PLATFORMS_ONLY };
  const platform = snapshot.platform as "espn" | "sleeper";
  const url = `/api/model/${platform}`;

  let imported: ImportResponse = stored.response;
  let readAgain = false;
  if (plan.kind === "reimport") {
    const body = importBodyOf(stored, plan.refresh);
    if (!body) return { ok: false, message: MODEL_PLATFORMS_ONLY };
    const got = await importLeague({ platform, body, espnCookies: "unknown", ...(signal ? { signal } : {}), deps });
    if (isApiError(got)) return { ok: false, message: got.error.message };
    if (!("snapshot" in got) || modelKey(got.snapshot) !== modelKey(snapshot)) return { ok: false, message: MODEL_UNREADABLE };
    imported = got;
    readAgain = true;
  }
  // A failure from here on: with the import just read again, when there is one (ModelOutcome).
  const failed = (message: string): ModelOutcome => (readAgain ? { ok: false, message, import: imported } : { ok: false, message });

  const signedBody = plan.kind === "server" ? null : signedModelBody(stored.request, imported);
  if (signedBody) {
    const res = await postGzipJson<unknown>(url, signedBody, { fetchImpl, ...(signal ? { signal } : {}), ...(deps.gzip ? { gzip: deps.gzip } : {}) });
    if (res !== "not-sent" && !isApiError(res)) {
      if (isSignedModelResponse(res)) return { ok: true, response: { import: imported, model: res.model } };
      if (isModelResponse(res) && modelKey(res.import.snapshot) === modelKey(snapshot)) return { ok: true, response: res };
      return failed(MODEL_UNREADABLE);
    }
    if (isApiError(res) && !SERVER_RETRY_CODES.has(res.error.code)) return failed(res.error.message);
    // Not sent (too large, or this browser couldn't gzip it), or a body the route couldn't use: today's request below
    // (the server reads the league itself).
  }

  const req = modelRequest({ request: stored.request, response: imported }, plan.kind === "server" && plan.refresh);
  if (!req) return failed(MODEL_PLATFORMS_ONLY);
  const res = await callApi<ModelResponse>(req.url, { method: "POST", body: req.body }, withSignal);
  if (isApiError(res)) return failed(res.error.message);
  if (!isModelResponse(res) || modelKey(res.import.snapshot) !== modelKey(snapshot)) return failed(MODEL_UNREADABLE);
  return { ok: true, response: res };
}
