/**
 * POST /api/import/sleeper { season, username?, leagueId?, chooseLeagueId? }
 *   → ImportResponse, or { chooseLeague: {...} } when a username has several leagues that season,
 *     or { error: { code, message } }.
 *
 * The adapter does the username → leagues lookup (CLAUDE.md §2.3). When it can't tell which league
 * to import, it throws a NO_LEAGUE error carrying the choices; this handler turns that into
 * { chooseLeague } and the Connect page posts again with chooseLeagueId. A username (with or without
 * a league ID) also lets the adapter find "my team".
 *
 * Part B (planner reply to Checkpoint 4c, B1: browser fetching; track BF):
 * - The same route takes a league the browser read itself: a gzip body (src/adapters/upload.ts LeagueUpload, its league
 *   ID and the username typed; src/app/api/_lib/upload.ts reads and checks it), imported by replaying it through the
 *   adapter's league-data half with the server's own NFL state and projections (importUpload). One it can't use answers
 *   BAD_UPLOAD (the browser then asks again with JSON, and the server reads the league itself), and so does one holding
 *   more than any real league (review BF-R1: src/app/api/_lib/upload.ts, before the replay and after it). The browser picks among a
 *   username's leagues itself, so an upload never answers { chooseLeague }.
 * - Every answer says who read the league (readBy), carries the import's model part (nothing for Sleeper) and, with
 *   SESSION_SECRET, the server's signature over it and the snapshot (src/server/importToken.ts), so the model route can
 *   build the numbers without reading the league again.
 * - Every import answered (not a username's league list) is counted for usage:report by who read the league (planner
 *   reply to Checkpoint 7a, §2 question 7; src/server/usage.ts import_sleeper_browser, import_sleeper_server; Vercel only).
 */
import type { ImportDeps, ImportResult, SleeperImportRequest } from "@/adapters/types";
import type { LeagueUpload } from "@/adapters/upload";
import type { Platform } from "@/engine/model";
import { chooseLeagueResponse, type AdapterLeagueChoice, type ImportReader, type ImportResponse } from "@/lib/api";
import { isPlausibleSeason, seasonRangeMessage } from "@/lib/season";
import { signImport, type ImportSignature, type SignedContent } from "@/server/importToken";
import { noteImport } from "@/server/usage";
import { dataSourceStamps, errorResponse, importErrorResponse, isSameOrigin, jsonResponse, readJsonBody } from "../../_lib/respond";
import { sleeperImportBodySchema } from "../../_lib/schemas";
import { isGzipRequest, readLeagueUpload, uploadedImportProblem } from "../../_lib/upload";

/** The adapter's league choices (src/lib/api.ts AdapterLeagueChoice). */
export type { AdapterLeagueChoice };

export interface SleeperImportHandlerDeps {
  importLeague: (req: SleeperImportRequest, deps: ImportDeps) => Promise<ImportResult>;
  /** importSleeperUpload: a league the browser read (see the header). */
  importUpload: (upload: LeagueUpload, deps: ImportDeps) => Promise<ImportResult>;
  getDeps: () => Promise<ImportDeps>;
  /** The choices on an import error, when it offers any (the adapter's leagueChoicesOf). */
  choicesOf: (err: unknown) => AdapterLeagueChoice[] | undefined;
  /** src/server/importToken.ts signImport (a test hook). */
  sign?: (platform: Platform, content: SignedContent) => ImportSignature | undefined;
  now?: () => Date;
}

/**
 * The import route's answer for a Sleeper import (also the model route's `import`, src/app/api/model/sleeper/handler.ts):
 * the Import Report extras, who read it, the (empty) model part, signed (see the header).
 */
export function sleeperImportResponse(
  result: ImportResult,
  deps: ImportDeps,
  readBy: ImportReader,
  sign: (platform: Platform, content: SignedContent) => ImportSignature | undefined = (platform, content) => signImport(platform, content),
): ImportResponse {
  const response: ImportResponse = { ...result, dataSources: dataSourceStamps(deps.resolver), readBy, modelPart: {} };
  const signed = sign("sleeper", { snapshot: response.snapshot, modelPart: response.modelPart });
  return signed ? { ...response, signed } : response;
}

export function createSleeperImportHandler(d: SleeperImportHandlerDeps): (request: Request) => Promise<Response> {
  const sign = d.sign ?? ((platform: Platform, content: SignedContent) => signImport(platform, content));

  /** A league the browser read (see the header). */
  async function fromUpload(request: Request): Promise<Response> {
    const read = await readLeagueUpload(request, "sleeper");
    if (!read.ok) return errorResponse("BAD_UPLOAD");
    const upload = read.value;
    const now = d.now?.() ?? new Date();
    if (!isPlausibleSeason(upload.request.season, now)) return errorResponse("INVALID_REQUEST", seasonRangeMessage(now));
    try {
      const deps = await d.getDeps();
      const result = await d.importUpload(upload, deps);
      // Bigger than any real league's model (review BF-R1): not signed; the browser asks the server to read the league.
      if (uploadedImportProblem(result.snapshot)) return errorResponse("BAD_UPLOAD");
      const answer = jsonResponse(sleeperImportResponse(result, deps, "browser", sign));
      noteImport("sleeper", "browser");
      return answer;
    } catch (err) {
      return importErrorResponse(err, { platform: "sleeper", season: upload.request.season });
    }
  }

  return async function POST(request: Request): Promise<Response> {
    if (!isSameOrigin(request)) return errorResponse("BAD_ORIGIN");
    if (isGzipRequest(request)) return fromUpload(request);
    const body = await readJsonBody(request, sleeperImportBodySchema);
    if (!body.ok) return errorResponse("INVALID_REQUEST", body.message);
    const { season, username, leagueId, chooseLeagueId, refresh } = body.data;
    const now = d.now?.() ?? new Date();
    if (!isPlausibleSeason(season, now)) return errorResponse("INVALID_REQUEST", seasonRangeMessage(now));

    const req: SleeperImportRequest = {
      season,
      ...(username ? { username } : {}),
      ...(leagueId ? { leagueId } : {}),
      ...(chooseLeagueId && !leagueId ? { chooseLeagueId } : {}),
      ...(refresh ? { refresh: true } : {}),
    };
    try {
      const deps = await d.getDeps();
      const answer = jsonResponse(sleeperImportResponse(await d.importLeague(req, deps), deps, "server", sign));
      noteImport("sleeper", "server");
      return answer;
    } catch (err) {
      const choices = d.choicesOf(err);
      if (choices?.length && username) return jsonResponse(chooseLeagueResponse(username, season, choices));
      return importErrorResponse(err, { platform: "sleeper", season });
    }
  };
}
