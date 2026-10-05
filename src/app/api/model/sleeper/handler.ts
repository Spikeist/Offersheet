/**
 * POST /api/model/sleeper { season, leagueId, username?, refresh? } → ModelResponse { import, model },
 * or { error: { code, message } } (CLAUDE.md §3, §6, §9; Phase 2 League page).
 *
 * The league is imported again exactly as POST /api/import/sleeper does for a league ID (served from
 * the 10-minute league cache, §2.10; the same ImportResponse with its dataSources), so the model
 * inputs always belong to the snapshot they come with; then buildModelInputs loads Sleeper's
 * projections and stats, FantasyCalc and the NFL schedule. The League page always sends the imported
 * league's ID, so there's no league picker here, plus the username the league was imported with,
 * when there was one, so the re-import finds the user's team as the import did (with a league ID, a
 * username Sleeper doesn't know is only a warning, never an error). Errors of the import map
 * exactly as in the import route; a model source that fails is a warning inside `model.warnings`,
 * never an error response (only a bug in the builder is: a generic INTERNAL, logged by error name).
 *
 * Part B (planner reply to Checkpoint 4c, B1: browser fetching; track BF): the League page sends the import it saved
 * instead, with the server's signature (a gzip SignedModelBody, src/lib/api.ts; src/app/api/_lib/upload.ts reads it).
 * When the signature checks out (src/server/importToken.ts) and names this league, the numbers are built from it without
 * reading the league again ({ model, signedImport: true }); otherwise the league is read again as above, and the answer
 * carries the new, signed import. A gzip body that can't be read at all answers BAD_UPLOAD.
 *
 * The final review's limits on this work (SEC-1, F1, F3), as the ESPN model route (src/app/api/model/espn/handler.ts): an
 * answer built from a signed import is remembered on this instance until its token stops being good (../memo.ts); a big
 * build and a league read again after a signature that didn't check out are charged to the day's work budget first; the
 * signed path's build gets the NFL team codes, not the whole player-ID crosswalk (getModelDeps).
 * A factory with injected dependencies, tested without the network.
 */
import type { ImportDeps, ImportResult, SleeperImportRequest } from "@/adapters/types";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueSnapshot, Platform } from "@/engine/model";
import type { ImportResponse, ModelResponse, SignedModelResponse } from "@/lib/api";
import { isPlausibleSeason, seasonRangeMessage } from "@/lib/season";
import { chargeWork, modelBuildExtraUnits, type QuotaVerdict } from "@/server/budget";
import { importDigest, signatureProblem, signImport, type ImportSignature, type SignedContent } from "@/server/importToken";
import { browserFetchLimits, workLimits } from "@/server/limits";
import type { BuildModelInputsArgs } from "@/server/modelInputs";
import type { ModelDeps } from "../../_lib/deps";
import { errorResponse, importErrorResponse, isSameOrigin, jsonResponse, jsonTextResponse, logUnexpected, readJsonBody, workRefusedResponse } from "../../_lib/respond";
import { sleeperModelBodySchema } from "../../_lib/schemas";
import { isGzipRequest, modelWorkOf, readSignedModelUpload } from "../../_lib/upload";
import { sleeperImportResponse } from "../../import/sleeper/handler";
import { modelMemo, modelMemoKey, type ModelMemo } from "../memo";

export interface SleeperModelHandlerDeps {
  /** importSleeperLeague. */
  importLeague: (req: SleeperImportRequest, deps: ImportDeps) => Promise<ImportResult>;
  /** buildModelInputs (src/server/modelInputs.ts). */
  buildInputs: (args: BuildModelInputsArgs) => Promise<ModelInputs>;
  getDeps: () => Promise<ImportDeps>;
  /** What a build from a signed import needs (no crosswalk: src/app/api/_lib/deps.ts getModelOnlyDeps); default getDeps. */
  getModelDeps?: () => Promise<ModelDeps>;
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

export function createSleeperModelHandler(d: SleeperModelHandlerDeps): (request: Request) => Promise<Response> {
  const sign = d.sign ?? ((platform: Platform, content: SignedContent) => signImport(platform, content));
  const verify = d.verify ?? ((platform: Platform, contentDigest: string, signature: ImportSignature) => signatureProblem(platform, contentDigest, signature));
  const charge = d.chargeWork ?? ((units: number) => chargeWork(units));
  const memo = (): ModelMemo => d.memo ?? modelMemo();

  /** The model inputs for a snapshot; a builder that throws is a bug on our side (INTERNAL, logged by name). */
  async function build(snapshot: LeagueSnapshot, deps: ModelDeps): Promise<ModelInputs | Response> {
    try {
      return await d.buildInputs({ snapshot, http: deps.http, resolver: deps.resolver, now: deps.now });
    } catch (err) {
      logUnexpected("model_inputs", err, "sleeper");
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
  async function reimport(req: SleeperImportRequest, extraUnits = 0): Promise<Response> {
    const refused = await paid(extraUnits);
    if (refused) return refused;
    let imported: ImportResponse;
    let deps: ImportDeps;
    try {
      deps = await d.getDeps();
      // Exactly what POST /api/import/sleeper answers (src/app/api/import/sleeper/handler.ts).
      imported = sleeperImportResponse(await d.importLeague(req, deps), deps, "server", sign);
    } catch (err) {
      return importErrorResponse(err, { platform: "sleeper", season: req.season });
    }
    // A league bigger than a request pays for costs its extra units before it's built (the header).
    const refusedBuild = await paid(modelBuildExtraUnits(modelWorkOf(imported.snapshot)));
    if (refusedBuild) return refusedBuild;
    // The builder turns every source failure into a warning; if it throws anyway, that's a bug on our side.
    const model = await build(imported.snapshot, deps);
    if (model instanceof Response) return model;
    const response: ModelResponse = { import: imported, model };
    return jsonResponse(response);
  }

  /** A saved import with its signature (the header's Part B paragraph). */
  async function fromSignedImport(request: Request): Promise<Response> {
    const read = await readSignedModelUpload(request, "sleeper");
    if (!read.ok) return errorResponse("BAD_UPLOAD");
    const body = read.value;
    const now = d.now?.() ?? new Date();
    if (!isPlausibleSeason(body.season, now)) return errorResponse("INVALID_REQUEST", seasonRangeMessage(now));
    const snapshot = body.import.snapshot;
    const digest = digestOf(body.import);
    const ours = digest !== null && snapshot.platform === "sleeper" && snapshot.leagueId === body.leagueId && snapshot.season === body.season && verify("sleeper", digest, body.signed) === null;
    // Not ours: the league is read again, which this request (it paid for a build only) pays the rest of first.
    if (!ours || digest === null) {
      const req: SleeperImportRequest = { season: body.season, leagueId: body.leagueId, ...(body.username ? { username: body.username } : {}) };
      return reimport(req, workLimits.units.modelServer - workLimits.units.modelSigned);
    }
    // The same signed import, built on this instance before: the same answer, without a build (the header).
    const key = modelMemoKey("sleeper", digest);
    const remembered = memo().get(key, now.getTime());
    if (remembered !== undefined) return jsonTextResponse(remembered);
    const refused = await paid(modelBuildExtraUnits(modelWorkOf(snapshot as unknown as LeagueSnapshot)));
    if (refused) return refused;
    let deps: ModelDeps;
    try {
      deps = await (d.getModelDeps ?? d.getDeps)();
    } catch (err) {
      return importErrorResponse(err, { platform: "sleeper", season: body.season });
    }
    const model = await build(snapshot as unknown as LeagueSnapshot, deps);
    if (model instanceof Response) return model;
    const response: SignedModelResponse = { model, signedImport: true };
    const text = JSON.stringify(response);
    memo().set(key, text, body.signed.issuedAt + browserFetchLimits.tokenMaxAgeMs, now.getTime());
    return jsonTextResponse(text);
  }

  return async function POST(request: Request): Promise<Response> {
    if (!isSameOrigin(request)) return errorResponse("BAD_ORIGIN");
    if (isGzipRequest(request)) return fromSignedImport(request);
    const body = await readJsonBody(request, sleeperModelBodySchema);
    if (!body.ok) return errorResponse("INVALID_REQUEST", body.message);
    const { season, leagueId, username, refresh } = body.data;
    const now = d.now?.() ?? new Date();
    if (!isPlausibleSeason(season, now)) return errorResponse("INVALID_REQUEST", seasonRangeMessage(now));
    return reimport({ season, leagueId, ...(username ? { username } : {}), ...(refresh ? { refresh: true } : {}) });
  };
}
