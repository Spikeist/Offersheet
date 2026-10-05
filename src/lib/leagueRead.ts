/**
 * The browser path's own read of a league (planner reply to Checkpoint 4c, Part B, B1: browser fetching; track BF): the
 * adapter's league-data half (src/adapters/espn/leagueData.ts, src/adapters/sleeper/leagueData.ts) through a recording
 * client (src/adapters/upload.ts), each body kept as the adapter's schemas keep it, ESPN's SWIDs replaced by their one-way
 * pseudonyms, into the upload the import route replays. src/lib/leagueFetch.ts decides when it runs and what happens with
 * its result (see its header for the paths and the fallbacks).
 *
 * Loaded on demand (leagueFetch.ts imports it dynamically, and the Connect page warms it up once it's idle): it brings
 * zod and the adapters' schemas and tables, about 100 KB gzipped (421 KB raw), which no page needs before it reads a league.
 */
import { fetchEspnLeagueData, filterHeaderOf, type EspnGet } from "@/adapters/espn/leagueData";
import { pseudonymizeSwids } from "@/adapters/espn/swid";
import { UNCACHED_POLICIES, fetchSleeperLeagueData, leagueChoicesOf } from "@/adapters/sleeper/leagueData";
import { LeagueImportError, type HttpClient, type ImportErrorCode, type SleeperImportRequest } from "@/adapters/types";
import { UPLOAD_VERSION, recordingClient, trimEspnBody, trimSleeperBody, type LeagueUpload } from "@/adapters/upload";
import { chooseLeagueResponse, type ApiErrorResponse, type EspnImportBody, type SleeperChooseLeagueResponse, type SleeperImportBody } from "./api";
import { errorMessage } from "./errors";
import { normalizeSleeperUsername, parseSleeperLeagueInput } from "./sleeperInput";

/** Whether this browser session holds ESPN cookies (src/app/api/session/espn): "unknown" when the page didn't ask. */
export type EspnCookieState = "connected" | "none" | "unknown";

/** A platform's answers on the browser path that are final (leagueFetch.ts's header); ESPN's PRIVATE_LEAGUE only with no cookies. */
const FINAL_CODES: Readonly<Record<"espn" | "sleeper", ReadonlySet<ImportErrorCode>>> = {
  espn: new Set<ImportErrorCode>(["LEAGUE_NOT_FOUND", "NOT_ACTIVATED", "PRIVATE_LEAGUE"]),
  sleeper: new Set<ImportErrorCode>(["LEAGUE_NOT_FOUND", "USER_NOT_FOUND", "NO_LEAGUE", "UNSUPPORTED_LEAGUE"]),
};

/** A Sleeper username's list of leagues: never sent up (the user's other leagues are none of the server's business). */
const USER_LEAGUES_PATH = /\/v1\/user\/[^/]+\/leagues\/nfl\/\d+$/;

/** The browser path's result (readInBrowser). */
export type BrowserRead =
  | { kind: "upload"; upload: LeagueUpload }
  | { kind: "choose"; choose: SleeperChooseLeagueResponse }
  | { kind: "error"; error: ApiErrorResponse["error"] }
  | { kind: "fallback" };

/**
 * Whether the browser got an answer to every request of a read it finished (review BF-R3). A request that got none (status
 * 0: a CORS refusal, a network error, a timeout, an extension blocking it) is the browser's own trouble, not the
 * platform's: the adapters would carry on without that part (a warning, a week left out), so the league goes the
 * server's way instead, which reads all of it. A platform's own answer (a 404, a 503) is an answer either way.
 */
function everyRequestAnswered(parts: readonly { status: number }[]): boolean {
  return parts.every((p) => p.status !== 0);
}

/** A platform's error in the words the import route would answer with (src/app/api/_lib/respond.ts importErrorResponse). */
export function importErrorOf(err: LeagueImportError, platform: "espn" | "sleeper", season: number): ApiErrorResponse["error"] {
  return { code: err.code, message: errorMessage(err.code, { platform, adapterMessage: err.message, season }) };
}

/** The browser path's read of an ESPN league. */
async function readEspn(body: EspnImportBody, http: HttpClient, clock: () => number, cookies: EspnCookieState): Promise<BrowserRead> {
  const recorder = recordingClient(http, trimEspnBody, clock);
  const get: EspnGet = (url, request) => {
    const headers = filterHeaderOf(request);
    return recorder.get(url, { ...(headers ? { headers } : {}), transformText: (text) => pseudonymizeSwids(text) });
  };
  try {
    const data = await fetchEspnLeagueData({ leagueId: body.leagueId, season: body.season }, get, { now: new Date(clock()), withCookies: false });
    const parts = recorder.parts();
    // Part of the league didn't reach the browser (everyRequestAnswered): the server reads all of it.
    if (!everyRequestAnswered(parts)) return { kind: "fallback" };
    return { kind: "upload", upload: { v: UPLOAD_VERSION, platform: "espn", request: { leagueId: data.leagueId, season: data.season }, sentAt: clock(), parts } };
  } catch (err) {
    if (err instanceof LeagueImportError && FINAL_CODES.espn.has(err.code) && !(err.code === "PRIVATE_LEAGUE" && cookies !== "none")) return { kind: "error", error: importErrorOf(err, "espn", body.season) };
    return { kind: "fallback" };
  }
}

/** The browser path's read of a Sleeper league, or of a username's leagues. */
async function readSleeper(body: SleeperImportBody, http: HttpClient, clock: () => number): Promise<BrowserRead> {
  const username = body.username === undefined ? undefined : normalizeSleeperUsername(body.username);
  const typed = body.leagueId?.trim() ? parseSleeperLeagueInput(body.leagueId) : undefined;
  if (typed && !typed.ok) return { kind: "fallback" };
  // A league picked from the username's list is read by its ID (the list isn't asked again).
  const picked = !typed && username && body.chooseLeagueId && /^\d{5,25}$/.test(body.chooseLeagueId.trim()) ? body.chooseLeagueId.trim() : undefined;
  const leagueId = typed?.leagueId ?? picked;
  if (!username && !leagueId) return { kind: "fallback" };
  const req: SleeperImportRequest = { season: body.season, ...(username ? { username } : {}), ...(leagueId ? { leagueId } : {}) };
  const recorder = recordingClient(http, trimSleeperBody, clock);
  try {
    const data = await fetchSleeperLeagueData(req, recorder, UNCACHED_POLICIES);
    // Part of the league didn't reach the browser (everyRequestAnswered): the server reads all of it.
    if (!everyRequestAnswered(recorder.parts())) return { kind: "fallback" };
    const parts = recorder.parts().filter((p) => !USER_LEAGUES_PATH.test(new URL(p.url).pathname));
    return { kind: "upload", upload: { v: UPLOAD_VERSION, platform: "sleeper", request: { leagueId: data.leagueId, season: body.season, ...(username ? { username } : {}) }, sentAt: clock(), parts } };
  } catch (err) {
    const choices = leagueChoicesOf(err);
    if (choices?.length && username) return { kind: "choose", choose: chooseLeagueResponse(username, body.season, choices) };
    if (err instanceof LeagueImportError && FINAL_CODES.sleeper.has(err.code)) return { kind: "error", error: importErrorOf(err, "sleeper", body.season) };
    return { kind: "fallback" };
  }
}

/** The browser path's read: an upload, a username's leagues, a final error, or "ask the server" (leagueFetch.ts's header). */
export async function readInBrowser(args: { platform: "espn" | "sleeper"; body: EspnImportBody | SleeperImportBody; http: HttpClient; clock?: () => number; espnCookies?: EspnCookieState }): Promise<BrowserRead> {
  const clock = args.clock ?? Date.now;
  return args.platform === "espn" ? readEspn(args.body as EspnImportBody, args.http, clock, args.espnCookies ?? "unknown") : readSleeper(args.body as SleeperImportBody, args.http, clock);
}
