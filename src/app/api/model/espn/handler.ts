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
 * The final review's limits on this work (SEC-1, F1, F3): an answer built from a signed import is kept in this instance's
 * memory until the token stops being good (../memo.ts), so the same signed import posted again is answered without a new
 * build; a build bigger than the request paid for (src/server/budget.ts modelBuildExtraUnits, by the snapshot's
 * modelWorkOf) and a league read again after a signature that didn't check out are charged to the day's work budget
 * first (refused: BUSY, nothing built); and the signed path's build gets only what it reads of the player-ID crosswalk,
 * the NFL team codes (getModelDeps: src/app/api/_lib/deps.ts getModelOnlyDeps), not the whole crosswalk a cold instance
 * would otherwise build from 1.4 MB of the shared cache.
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
import { chargeWork, modelBuildExtraUnits, type QuotaVerdict } from "@/server/budget";
import { importDigest, signatureProblem, signImport, type ImportSignature, type SignedContent } from "@/server/importToken";
import { browserFetchLimits, workLimits } from "@/server/limits";
import type { BuildModelInputsArgs } from "@/server/modelInputs";
import type { CredentialSource, EspnCredentials } from "@/server/session";
import type { ModelDeps } from "../../_lib/deps";
import { errorResponse, importErrorResponse, isSameOrigin, jsonResponse, jsonTextResponse, logUnexpected, readJsonBody, scrubSwids, workRefusedResponse } from "../../_lib/respond";
import { espnModelBodySchema } from "../../_lib/schemas";
import { isGzipRequest, modelWorkOf, readSignedModelUpload } from "../../_lib/upload";
import { recordFormatsInUse } from "../../cron/snapshot/formats";
import { espnImportResponse } from "../../import/espn/handler";
import { modelMemo, modelMemoKey, type ModelMemo } from "../memo";

export interface EspnModelHandlerDeps {
  /** importEspnLeagueForModel: the import plus ESPN's league-scored projections. */
  importLeague: (req: EspnImportRequest, deps: ImportDeps) => Promise<EspnModelImport>;
  /** buildModelInputs (src/server/modelInputs.ts). */
  buildInputs: (args: BuildModelInputsArgs) => Promise<ModelInputs>;
  getDeps: () => Promise<ImportDeps>;
  /** What a build from a signed import needs (no crosswalk: src/app/api/_lib/deps.ts getModelOnlyDeps); default getDeps. */
  getModelDeps?: () => Promise<ModelDeps>;
  credentialsFor: (request: Request, leagueId: string) => Promise<{ credentials?: EspnCredentials; source: CredentialSource }>;
  /** src/server/importToken.ts signImport and signatureProblem, by the content's importDigest (test hooks). */
  sign?: (platform: Platform, content: SignedContent) => ImportSignature | undefined;
  verify?: (platform: Platform, contentDigest: string, signature: ImportSignature) => string | null;
  /** The answers already built (../memo.ts; default the process's) and the work budget's extra charge (test hooks). */
  memo?: ModelMemo;
  chargeWork?: (units: number) => Promise<QuotaVerdict>;
  now?: () => Date;
}

/** The signed content's digest (src/server/importToken.ts importDigest), or null when it can't be made (nested too deep). */
function digestOf(content: SignedContent): string | null {
  try {
    return importDigest(content);
  } catch {
    return null;
  }
}

export function createEspnModelHandler(d: EspnModelHandlerDeps): (request: Request) => Promise<Response> {
  const sign = d.sign ?? ((platform: Platform, content: SignedContent) => signImport(platform, content));
  const verify = d.verify ?? ((platform: Platform, contentDigest: string, signature: ImportSignature) => signatureProblem(platform, contentDigest, signature));
  const charge = d.chargeWork ?? ((units: number) => chargeWork(units));
  const memo = (): ModelMemo => d.memo ?? modelMemo();

  /** The model inputs for a snapshot; a builder that throws is a bug on our side (INTERNAL, logged by name). */
  async function build(snapshot: LeagueSnapshot, espn: EspnProjections | undefined, deps: ModelDeps): Promise<ModelInputs | Response> {
    try {
      // The FantasyCalc formats it read, for the daily snapshot cron (../../cron/snapshot/formats.ts; after the answer).
      return recordFormatsInUse(snapshot.settings, await d.buildInputs({ snapshot, http: deps.http, resolver: deps.resolver, now: deps.now, ...(espn ? { espn } : {}) }));
    } catch (err) {
      logUnexpected("model_inputs", err, "espn");
      return errorResponse("INTERNAL");
    }
  }

  /** Charges `units` more of this request's work (the header); a refusal's answer, or null to go on. */
  async function paid(units: number): Promise<Response | null> {
    if (!(units > 0)) return null;
    const verdict = await charge(units);
    return verdict === "ok" ? null : workRefusedResponse(verdict);
  }

  /**
   * The league read again (the header's first paragraph), its import signed. `extraUnits`: what reading it costs past what
   * the request paid (a signed import's request paid for a build only), charged before the league is read.
   */
  async function reimport(request: Request, leagueId: string, season: number, refresh: boolean, extraUnits = 0): Promise<Response> {
    const refused = await paid(extraUnits);
    if (refused) return refused;
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
    // A league bigger than a request pays for costs its extra units before it's built (the header).
    const refusedBuild = await paid(modelBuildExtraUnits(modelWorkOf(imported.snapshot)));
    if (refusedBuild) return refusedBuild;
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
    const digest = digestOf(body.import);
    const ours = digest !== null && snapshot.platform === "espn" && snapshot.leagueId === body.leagueId && snapshot.season === body.season && verify("espn", digest, body.signed) === null;
    // Not ours: the league is read again, which this request (it paid for a build only) pays the rest of first.
    if (!ours || digest === null) return reimport(request, body.leagueId, body.season, false, workLimits.units.modelServer - workLimits.units.modelSigned);
    // The same signed import, built on this instance before: the same answer, without a build (the header).
    const key = modelMemoKey("espn", digest);
    const remembered = memo().get(key, now.getTime());
    if (remembered !== undefined) return jsonTextResponse(remembered);
    const refused = await paid(modelBuildExtraUnits(modelWorkOf(snapshot as unknown as LeagueSnapshot)));
    if (refused) return refused;
    let deps: ModelDeps;
    try {
      deps = await (d.getModelDeps ?? d.getDeps)();
    } catch (err) {
      return importErrorResponse(err, { platform: "espn", season: body.season });
    }
    const model = await build(snapshot as unknown as LeagueSnapshot, body.import.modelPart.espn as EspnProjections | undefined, deps);
    if (model instanceof Response) return model;
    const response: SignedModelResponse = { model, signedImport: true };
    const text = JSON.stringify(scrubSwids(response, "ESPN model inputs"));
    memo().set(key, text, body.signed.issuedAt + browserFetchLimits.tokenMaxAgeMs, now.getTime());
    return jsonTextResponse(text);
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
