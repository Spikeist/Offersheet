/**
 * POST /api/import/espn { leagueId, season, myTeamId? } → ImportResponse, or { error: { code, message } }.
 *
 * A factory with injected dependencies, so it's tested without the network or the real adapter.
 * ESPN cookies are never part of this request: they come from the sealed session cookie (or, in
 * development only, from .env.local for Parker's own league) and go only to ESPN, via the adapter.
 * The response says which of the two it was (espnCookieSource), never the values.
 */
import type { EspnImportRequest, ImportDeps, ImportResult } from "@/adapters/types";
import type { ImportResponse } from "@/lib/api";
import { isPlausibleSeason, seasonRangeMessage } from "@/lib/season";
import type { CredentialSource, EspnCredentials } from "@/server/session";
import { dataSourceStamps, errorResponse, importErrorResponse, isSameOrigin, jsonResponse, readJsonBody, scrubSwids } from "../../_lib/respond";
import { espnImportBodySchema } from "../../_lib/schemas";

export interface EspnImportHandlerDeps {
  importLeague: (req: EspnImportRequest, deps: ImportDeps) => Promise<ImportResult>;
  getDeps: () => Promise<ImportDeps>;
  credentialsFor: (request: Request, leagueId: string) => Promise<{ credentials?: EspnCredentials; source: CredentialSource }>;
  now?: () => Date;
}

export function createEspnImportHandler(d: EspnImportHandlerDeps): (request: Request) => Promise<Response> {
  return async function POST(request: Request): Promise<Response> {
    if (!isSameOrigin(request)) return errorResponse("BAD_ORIGIN");
    const body = await readJsonBody(request, espnImportBodySchema);
    if (!body.ok) return errorResponse("INVALID_REQUEST", body.message);
    const { leagueId, season, myTeamId, refresh } = body.data;
    const now = d.now?.() ?? new Date();
    if (!isPlausibleSeason(season, now)) return errorResponse("INVALID_REQUEST", seasonRangeMessage(now));
    try {
      const { credentials, source } = await d.credentialsFor(request, leagueId);
      const deps = await d.getDeps();
      const req: EspnImportRequest = { leagueId, season, ...(credentials ? { credentials } : {}), ...(myTeamId ? { myTeamId } : {}), ...(refresh ? { refresh: true } : {}) };
      const result = await d.importLeague(req, deps);
      const response: ImportResponse = {
        ...result,
        dataSources: dataSourceStamps(deps.resolver),
        usedEspnCookies: Boolean(credentials),
        ...(credentials && (source === "session" || source === "dev-env") ? { espnCookieSource: source } : {}),
      };
      return jsonResponse(scrubSwids(response, "ESPN import", credentials ? [credentials.swid] : []));
    } catch (err) {
      return importErrorResponse(err, { platform: "espn", season });
    }
  };
}
