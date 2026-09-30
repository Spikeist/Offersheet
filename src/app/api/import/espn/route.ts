/** POST /api/import/espn: see ./handler.ts. */
import { importEspnLeague } from "@/adapters/espn";
import { espnCredentialsFor } from "@/server/session";
import { getImportDeps } from "../../_lib/deps";
import { createEspnImportHandler } from "./handler";

export const runtime = "nodejs";

export const POST = createEspnImportHandler({
  importLeague: importEspnLeague,
  getDeps: () => getImportDeps(),
  credentialsFor: (request, leagueId) => espnCredentialsFor(request, leagueId),
});
