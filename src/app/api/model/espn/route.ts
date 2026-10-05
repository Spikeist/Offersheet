/** POST /api/model/espn: see ./handler.ts; its rate limit, deadline and log: ../../_lib/route.ts (withRoute). */
import { importEspnLeagueForModel } from "@/adapters/espn";
import { buildModelInputs } from "@/server/modelInputs";
import { espnCredentialsFor } from "@/server/session";
import { getImportDeps } from "../../_lib/deps";
import { withRoute } from "../../_lib/route";
import { createEspnModelHandler } from "./handler";

export const runtime = "nodejs";
/**
 * Seconds: a little above the model deadline (src/server/limits.ts deadlines.modelMs); a literal, as Next requires. Over
 * 60 s, so it needs Fluid compute on the Hobby plan.
 */
export const maxDuration = 120;

export const POST = withRoute(
  "model",
  createEspnModelHandler({
    importLeague: importEspnLeagueForModel,
    buildInputs: buildModelInputs,
    getDeps: () => getImportDeps(),
    credentialsFor: (request, leagueId) => espnCredentialsFor(request, leagueId),
  }),
  { platform: "espn" },
);
