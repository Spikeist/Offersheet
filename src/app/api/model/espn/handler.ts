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
 * ESPN cookies never travel in this request: they come from the sealed session cookie (or, in
 * development only, with USE_ENV_COOKIES=1, from .env.local for Parker's own league) and go only to
 * ESPN, via the adapter. The whole response goes through scrubSwids (§0.5: SWIDs are secrets).
 * A factory with injected dependencies, so it's tested without the network or the real adapter.
 */
import type { EspnModelImport } from "@/adapters/espn";
import type { EspnImportRequest, ImportDeps } from "@/adapters/types";
import type { ModelInputs } from "@/engine/inputs";
import type { ImportResponse, ModelResponse } from "@/lib/api";
import { isPlausibleSeason, seasonRangeMessage } from "@/lib/season";
import type { BuildModelInputsArgs } from "@/server/modelInputs";
import type { CredentialSource, EspnCredentials } from "@/server/session";
import { dataSourceStamps, errorResponse, importErrorResponse, isSameOrigin, jsonResponse, logUnexpected, readJsonBody, scrubSwids } from "../../_lib/respond";
import { espnModelBodySchema } from "../../_lib/schemas";

export interface EspnModelHandlerDeps {
  /** importEspnLeagueForModel: the import plus ESPN's league-scored projections. */
  importLeague: (req: EspnImportRequest, deps: ImportDeps) => Promise<EspnModelImport>;
  /** buildModelInputs (src/server/modelInputs.ts). */
  buildInputs: (args: BuildModelInputsArgs) => Promise<ModelInputs>;
  getDeps: () => Promise<ImportDeps>;
  credentialsFor: (request: Request, leagueId: string) => Promise<{ credentials?: EspnCredentials; source: CredentialSource }>;
  now?: () => Date;
}

export function createEspnModelHandler(d: EspnModelHandlerDeps): (request: Request) => Promise<Response> {
  return async function POST(request: Request): Promise<Response> {
    if (!isSameOrigin(request)) return errorResponse("BAD_ORIGIN");
    const body = await readJsonBody(request, espnModelBodySchema);
    if (!body.ok) return errorResponse("INVALID_REQUEST", body.message);
    const { leagueId, season, refresh } = body.data;
    const now = d.now?.() ?? new Date();
    if (!isPlausibleSeason(season, now)) return errorResponse("INVALID_REQUEST", seasonRangeMessage(now));
    let imported: ImportResponse;
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
      imported = {
        ...got.result,
        dataSources: dataSourceStamps(deps.resolver),
        usedEspnCookies: Boolean(credentials),
        ...(credentials && (source === "session" || source === "dev-env") ? { espnCookieSource: source } : {}),
      };
    } catch (err) {
      return importErrorResponse(err, { platform: "espn", season });
    }
    // The builder turns every source failure into a warning; if it throws anyway, that's a bug on our side.
    let model: ModelInputs;
    try {
      model = await d.buildInputs({ snapshot: imported.snapshot, http: deps.http, resolver: deps.resolver, now: deps.now, espn });
    } catch (err) {
      logUnexpected("ESPN model inputs", err);
      return errorResponse("INTERNAL");
    }
    const response: ModelResponse = { import: imported, model };
    return jsonResponse(scrubSwids(response, "ESPN model inputs", knownSwids));
  };
}
