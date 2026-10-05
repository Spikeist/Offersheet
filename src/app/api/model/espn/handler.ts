/**
 * POST /api/model/espn { leagueId, season, refresh? } → ModelResponse { import, model }, or
 * { error: { code, message } } (CLAUDE.md §3, §6, §9; Phase 2 League page).
 *
 * The league is imported again exactly as POST /api/import/espn does (served from the 10-minute
 * league cache, §2.10; the same ImportResponse, dataSources and cookie flags included), so the model
 * inputs always belong to the snapshot they come with. ESPN's league-scored projections are read from
 * the same responses (importEspnLeagueForModel), then buildModelInputs loads Sleeper, FantasyCalc and
 * the NFL schedule. Errors of the import map exactly as in the import route; a model source that
 * fails is a warning inside `model.warnings`, never an error response (only a bug in the builder is:
 * a generic INTERNAL, logged by error name).
 *
 * Part B (planner reply to Checkpoint 4c, B1: browser fetching; track BF): the League page sends the import it saved
 * instead, with the server's signature (a gzip SignedModelBody, src/lib/api.ts; src/app/api/_lib/upload.ts reads it).
 * When the signature checks out (src/server/importToken.ts: this server signed exactly that snapshot and model part, at
 * most browserFetchLimits.tokenMaxAgeMs ago: 15 minutes, since the League page sends one back only while its league data
 * is under 10 minutes old) and names this league, the numbers are built from it without reading the league again, and the answer
 * is { model, signedImport: true } (the browser has the import). Otherwise (an import saved before signing, another
 * server secret, an import changed in the browser) the league is read again as above, and the answer carries the new,
 * signed import. A gzip body that can't be read at all answers BAD_UPLOAD (the browser then sends the JSON body).
 *
 * ESPN cookies never travel in this request: they come from the sealed session cookie (or, in
 * development only, with USE_ENV_COOKIES=1, from .env.local for Parker's own league) and go only to
 * ESPN, via the adapter. The whole response goes through scrubSwids (§0.5: SWIDs are secrets).
 * A factory with injected dependencies, so it's tested without the network or the real adapter.
 */
import type { EspnModelImport } from "@/adapters/espn";
import type { EspnProjections } from "@/adapters/espn/projections";
import type { EspnImportRequest, ImportDeps } from "@/adapters/types";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueSnapshot, Platform } from "@/engine/model";
import type { ModelResponse, SignedModelResponse } from "@/lib/api";
import { isPlausibleSeason, seasonRangeMessage } from "@/lib/season";
import { importSignatureProblem, signImport, type ImportSignature, type SignedContent } from "@/server/importToken";
import type { BuildModelInputsArgs } from "@/server/modelInputs";
import type { CredentialSource, EspnCredentials } from "@/server/session";
import { errorResponse, importErrorResponse, isSameOrigin, jsonResponse, logUnexpected, readJsonBody, scrubSwids } from "../../_lib/respond";
import { espnModelBodySchema } from "../../_lib/schemas";
import { isGzipRequest, readSignedModelUpload } from "../../_lib/upload";
import { espnImportResponse } from "../../import/espn/handler";

export interface EspnModelHandlerDeps {
  /** importEspnLeagueForModel: the import plus ESPN's league-scored projections. */
  importLeague: (req: EspnImportRequest, deps: ImportDeps) => Promise<EspnModelImport>;
  /** buildModelInputs (src/server/modelInputs.ts). */
  buildInputs: (args: BuildModelInputsArgs) => Promise<ModelInputs>;
  getDeps: () => Promise<ImportDeps>;
  credentialsFor: (request: Request, leagueId: string) => Promise<{ credentials?: EspnCredentials; source: CredentialSource }>;
  /** src/server/importToken.ts signImport and importSignatureProblem (test hooks). */
  sign?: (platform: Platform, content: SignedContent) => ImportSignature | undefined;
  verify?: (platform: Platform, content: SignedContent, signature: ImportSignature) => string | null;
  now?: () => Date;
}

export function createEspnModelHandler(d: EspnModelHandlerDeps): (request: Request) => Promise<Response> {
  const sign = d.sign ?? ((platform: Platform, content: SignedContent) => signImport(platform, content));
  const verify = d.verify ?? ((platform: Platform, content: SignedContent, signature: ImportSignature) => importSignatureProblem(platform, content, signature));

  /** The model inputs for a snapshot; a builder that throws is a bug on our side (INTERNAL, logged by name). */
  async function build(snapshot: LeagueSnapshot, espn: EspnProjections | undefined, deps: ImportDeps): Promise<ModelInputs | Response> {
    try {
      return await d.buildInputs({ snapshot, http: deps.http, resolver: deps.resolver, now: deps.now, ...(espn ? { espn } : {}) });
    } catch (err) {
      logUnexpected("model_inputs", err, "espn");
      return errorResponse("INTERNAL");
    }
  }

  /** The league read again (the header's first paragraph), its import signed. */
  async function reimport(request: Request, leagueId: string, season: number, refresh: boolean): Promise<Response> {
    let imported: ModelResponse["import"];
    let espn: EspnModelImport["espn"];
    let deps: ImportDeps;
    let knownSwids: string[];
    try {
      const { credentials, source } = await d.credentialsFor(request, leagueId);
      deps = await d.getDeps();
      const req: EspnImportRequest = { leagueId, season, ...(credentials ? { credentials } : {}), ...(refresh ? { refresh: true } : {}) };
      const got = await d.importLeague(req, deps);
      espn = got.espn;
      knownSwids = credentials ? [credentials.swid] : [];
      // Exactly what POST /api/import/espn answers (src/app/api/import/espn/handler.ts).
      imported = espnImportResponse(got, deps, { ...(credentials ? { credentials } : {}), source, readBy: "server" }, sign);
    } catch (err) {
      return importErrorResponse(err, { platform: "espn", season });
    }
    // The builder turns every source failure into a warning; if it throws anyway, that's a bug on our side.
    const model = await build(imported.snapshot, espn, deps);
    if (model instanceof Response) return model;
    const response: ModelResponse = { import: imported, model };
    return jsonResponse(scrubSwids(response, "ESPN model inputs", knownSwids));
  }

  /** A saved import with its signature (the header's Part B paragraph). */
  async function fromSignedImport(request: Request): Promise<Response> {
    const read = await readSignedModelUpload(request, "espn");
    if (!read.ok) return errorResponse("BAD_UPLOAD");
    const body = read.value;
    const now = d.now?.() ?? new Date();
    if (!isPlausibleSeason(body.season, now)) return errorResponse("INVALID_REQUEST", seasonRangeMessage(now));
    const snapshot = body.import.snapshot;
    const ours = snapshot.platform === "espn" && snapshot.leagueId === body.leagueId && snapshot.season === body.season && verify("espn", body.import, body.signed) === null;
    if (!ours) return reimport(request, body.leagueId, body.season, false);
    let deps: ImportDeps;
    try {
      deps = await d.getDeps();
    } catch (err) {
      return importErrorResponse(err, { platform: "espn", season: body.season });
    }
    const model = await build(snapshot as unknown as LeagueSnapshot, body.import.modelPart.espn as EspnProjections | undefined, deps);
    if (model instanceof Response) return model;
    const response: SignedModelResponse = { model, signedImport: true };
    return jsonResponse(scrubSwids(response, "ESPN model inputs"));
  }

  return async function POST(request: Request): Promise<Response> {
    if (!isSameOrigin(request)) return errorResponse("BAD_ORIGIN");
    if (isGzipRequest(request)) return fromSignedImport(request);
    const body = await readJsonBody(request, espnModelBodySchema);
    if (!body.ok) return errorResponse("INVALID_REQUEST", body.message);
    const { leagueId, season, refresh } = body.data;
    const now = d.now?.() ?? new Date();
    if (!isPlausibleSeason(season, now)) return errorResponse("INVALID_REQUEST", seasonRangeMessage(now));
    return reimport(request, leagueId, season, refresh === true);
  };
}
