/** POST /api/import/espn: see ./handler.ts; its rate limit, deadline and log: ../../_lib/route.ts (withRoute). */
import { importEspnLeagueForModel, importEspnUpload } from "@/adapters/espn";
import { espnCredentialsFor } from "@/server/session";
import { getImportDeps } from "../../_lib/deps";
import { withRoute } from "../../_lib/route";
import { createEspnImportHandler } from "./handler";

export const runtime = "nodejs";
/** Seconds: a little above the import deadline (src/server/limits.ts deadlines.importMs); a literal, as Next requires. */
export const maxDuration = 60;

export const POST = withRoute(
  "import",
  createEspnImportHandler({
    importLeague: importEspnLeagueForModel,
    importUpload: importEspnUpload,
    getDeps: () => getImportDeps(),
    credentialsFor: (request, leagueId) => espnCredentialsFor(request, leagueId),
  }),
  { platform: "espn" },
);
