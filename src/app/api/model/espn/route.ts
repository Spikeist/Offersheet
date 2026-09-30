/** POST /api/model/espn: see ./handler.ts. */
import { importEspnLeagueForModel } from "@/adapters/espn";
import { buildModelInputs } from "@/server/modelInputs";
import { espnCredentialsFor } from "@/server/session";
import { getImportDeps } from "../../_lib/deps";
import { createEspnModelHandler } from "./handler";

export const runtime = "nodejs";

export const POST = createEspnModelHandler({
  importLeague: importEspnLeagueForModel,
  buildInputs: buildModelInputs,
  getDeps: () => getImportDeps(),
  credentialsFor: (request, leagueId) => espnCredentialsFor(request, leagueId),
});
