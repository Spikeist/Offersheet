/**
 * POST /api/import/espn { leagueId, season, myTeamId? } → ImportResponse, or { error: { code, message } }.
 *
 * A factory with injected dependencies, so it's tested without the network or the real adapter.
 * ESPN cookies are never part of this request: they come from the sealed session cookie (or, in
 * development only, with USE_ENV_COOKIES=1, from .env.local for Parker's own league) and go only to
 * ESPN, via the adapter.
 * The response says which of the two it was (espnCookieSource), never the values.
 *
 * Part B (planner reply to Checkpoint 4c, B1: browser fetching; track BF):
 * - The same route takes a public league the browser read itself: a gzip body (src/adapters/upload.ts LeagueUpload;
 *   src/app/api/_lib/upload.ts reads and checks it), imported by replaying it through the adapter's league-data half with
 *   the server's own NFL schedule (importUpload). One it can't use answers BAD_UPLOAD (the browser then asks again with
 *   JSON, and the server reads the league itself), and so does one holding more than any real league (review BF-R1:
 *   src/app/api/_lib/upload.ts, before the replay and after it). While ESPN cookies are connected (the session's, or .env.local's in
 *   development) the server reads the league itself whatever the browser sent, as the privacy policy says.
 * - Every answer says who read the league (readBy), carries the import's model part (ESPN's league-scored projections,
 *   read from the same responses) and, with SESSION_SECRET, the server's signature over both and the snapshot
 *   (src/server/importToken.ts), so the model route can build the numbers without reading the league again.
 */
import type { EspnModelImport } from "@/adapters/espn";
import type { EspnImportRequest, ImportDeps } from "@/adapters/types";
import type { LeagueUpload } from "@/adapters/upload";
import type { Platform } from "@/engine/model";
import type { ImportReader, ImportResponse } from "@/lib/api";
import { isPlausibleSeason, seasonRangeMessage } from "@/lib/season";
import { signImport, type ImportSignature, type SignedContent } from "@/server/importToken";
import type { CredentialSource, EspnCredentials } from "@/server/session";
import { dataSourceStamps, errorResponse, importErrorResponse, isSameOrigin, jsonResponse, readJsonBody, scrubSwids } from "../../_lib/respond";
import { espnImportBodySchema } from "../../_lib/schemas";
import { isGzipRequest, readLeagueUpload, uploadedImportProblem } from "../../_lib/upload";

export interface EspnImportHandlerDeps {
  /** importEspnLeagueForModel: the import plus ESPN's league-scored projections (the import's model part). */
  importLeague: (req: EspnImportRequest, deps: ImportDeps) => Promise<EspnModelImport>;
  /** importEspnUpload: a public league the browser read (see the header). */
  importUpload: (upload: LeagueUpload, deps: ImportDeps) => Promise<EspnModelImport>;
  getDeps: () => Promise<ImportDeps>;
  credentialsFor: (request: Request, leagueId: string) => Promise<{ credentials?: EspnCredentials; source: CredentialSource }>;
  /** src/server/importToken.ts signImport (a test hook). */
  sign?: (platform: Platform, content: SignedContent) => ImportSignature | undefined;
  now?: () => Date;
}

/**
 * The import route's answer for an ESPN import (also the model route's `import`, src/app/api/model/espn/handler.ts): the
 * Import Report extras, who read it, the model part, everything scrubbed of SWIDs, then signed (see the header).
 */
export function espnImportResponse(
  got: EspnModelImport,
  deps: ImportDeps,
  ctx: { credentials?: EspnCredentials; source: CredentialSource; readBy: ImportReader },
  sign: (platform: Platform, content: SignedContent) => ImportSignature | undefined = (platform, content) => signImport(platform, content),
): ImportResponse {
  const { credentials, source } = ctx;
  const response: ImportResponse = {
    ...got.result,
    dataSources: dataSourceStamps(deps.resolver),
    usedEspnCookies: Boolean(credentials),
    ...(credentials && (source === "session" || source === "dev-env") ? { espnCookieSource: source } : {}),
    readBy: ctx.readBy,
    modelPart: { espn: got.espn },
  };
  const scrubbed = scrubSwids(response, "ESPN import", credentials ? [credentials.swid] : []);
  const signed = sign("espn", { snapshot: scrubbed.snapshot, modelPart: scrubbed.modelPart });
  return signed ? { ...scrubbed, signed } : scrubbed;
}

export function createEspnImportHandler(d: EspnImportHandlerDeps): (request: Request) => Promise<Response> {
  const sign = d.sign ?? ((platform: Platform, content: SignedContent) => signImport(platform, content));

  /** A league the browser read (see the header). */
  async function fromUpload(request: Request): Promise<Response> {
    const read = await readLeagueUpload(request, "espn");
    if (!read.ok) return errorResponse("BAD_UPLOAD");
    const upload = read.value;
    const { leagueId, season } = upload.request;
    const now = d.now?.() ?? new Date();
    if (!isPlausibleSeason(season, now)) return errorResponse("INVALID_REQUEST", seasonRangeMessage(now));
    try {
      const { credentials, source } = await d.credentialsFor(request, leagueId);
      const deps = await d.getDeps();
      // Connected with ESPN cookies: the server reads the league itself (with them), whatever the browser sent.
      if (credentials) return jsonResponse(espnImportResponse(await d.importLeague({ leagueId, season, credentials }, deps), deps, { credentials, source, readBy: "server" }, sign));
      const got = await d.importUpload(upload, deps);
      // Bigger than any real league's model (review BF-R1): not signed; the browser asks the server to read the league.
      if (uploadedImportProblem(got.result.snapshot)) return errorResponse("BAD_UPLOAD");
      return jsonResponse(espnImportResponse(got, deps, { source, readBy: "browser" }, sign));
    } catch (err) {
      return importErrorResponse(err, { platform: "espn", season });
    }
  }

  return async function POST(request: Request): Promise<Response> {
    if (!isSameOrigin(request)) return errorResponse("BAD_ORIGIN");
    if (isGzipRequest(request)) return fromUpload(request);
    const body = await readJsonBody(request, espnImportBodySchema);
    if (!body.ok) return errorResponse("INVALID_REQUEST", body.message);
    const { leagueId, season, myTeamId, refresh } = body.data;
    const now = d.now?.() ?? new Date();
    if (!isPlausibleSeason(season, now)) return errorResponse("INVALID_REQUEST", seasonRangeMessage(now));
    try {
      const { credentials, source } = await d.credentialsFor(request, leagueId);
      const deps = await d.getDeps();
      const req: EspnImportRequest = { leagueId, season, ...(credentials ? { credentials } : {}), ...(myTeamId ? { myTeamId } : {}), ...(refresh ? { refresh: true } : {}) };
      return jsonResponse(espnImportResponse(await d.importLeague(req, deps), deps, { ...(credentials ? { credentials } : {}), source, readBy: "server" }, sign));
    } catch (err) {
      return importErrorResponse(err, { platform: "espn", season });
    }
  };
}
