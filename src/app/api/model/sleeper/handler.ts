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
 * A factory with injected dependencies, tested without the network.
 */
import type { ImportDeps, ImportResult, SleeperImportRequest } from "@/adapters/types";
import type { ModelInputs } from "@/engine/inputs";
import type { ImportResponse, ModelResponse } from "@/lib/api";
import { isPlausibleSeason, seasonRangeMessage } from "@/lib/season";
import type { BuildModelInputsArgs } from "@/server/modelInputs";
import { dataSourceStamps, errorResponse, importErrorResponse, isSameOrigin, jsonResponse, logUnexpected, readJsonBody } from "../../_lib/respond";
import { sleeperModelBodySchema } from "../../_lib/schemas";

export interface SleeperModelHandlerDeps {
  /** importSleeperLeague. */
  importLeague: (req: SleeperImportRequest, deps: ImportDeps) => Promise<ImportResult>;
  /** buildModelInputs (src/server/modelInputs.ts). */
  buildInputs: (args: BuildModelInputsArgs) => Promise<ModelInputs>;
  getDeps: () => Promise<ImportDeps>;
  now?: () => Date;
}

export function createSleeperModelHandler(d: SleeperModelHandlerDeps): (request: Request) => Promise<Response> {
  return async function POST(request: Request): Promise<Response> {
    if (!isSameOrigin(request)) return errorResponse("BAD_ORIGIN");
    const body = await readJsonBody(request, sleeperModelBodySchema);
    if (!body.ok) return errorResponse("INVALID_REQUEST", body.message);
    const { season, leagueId, username, refresh } = body.data;
    const now = d.now?.() ?? new Date();
    if (!isPlausibleSeason(season, now)) return errorResponse("INVALID_REQUEST", seasonRangeMessage(now));

    const req: SleeperImportRequest = { season, leagueId, ...(username ? { username } : {}), ...(refresh ? { refresh: true } : {}) };
    let imported: ImportResponse;
    let deps: ImportDeps;
    try {
      deps = await d.getDeps();
      const result = await d.importLeague(req, deps);
      // Exactly what POST /api/import/sleeper answers (src/app/api/import/sleeper/handler.ts).
      imported = { ...result, dataSources: dataSourceStamps(deps.resolver) };
    } catch (err) {
      return importErrorResponse(err, { platform: "sleeper", season });
    }
    // The builder turns every source failure into a warning; if it throws anyway, that's a bug on our side.
    let model: ModelInputs;
    try {
      model = await d.buildInputs({ snapshot: imported.snapshot, http: deps.http, resolver: deps.resolver, now: deps.now });
    } catch (err) {
      logUnexpected("model_inputs", err, "sleeper");
      return errorResponse("INTERNAL");
    }
    const response: ModelResponse = { import: imported, model };
    return jsonResponse(response);
  };
}
