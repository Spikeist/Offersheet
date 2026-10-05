/** POST /api/model/sleeper: see ./handler.ts; its rate limit, deadline and log: ../../_lib/route.ts (withRoute). */
import { importSleeperLeague } from "@/adapters/sleeper";
import { buildModelInputs } from "@/server/modelInputs";
import { getImportDeps, getModelOnlyDeps } from "../../_lib/deps";
import { withRoute } from "../../_lib/route";
import { createSleeperModelHandler } from "./handler";

export const runtime = "nodejs";
/**
 * Seconds: a little above the model deadline (src/server/limits.ts deadlines.modelMs); a literal, as Next requires. Over
 * 60 s, so it needs Fluid compute on the Hobby plan.
 */
export const maxDuration = 120;

export const POST = withRoute(
  "model",
  createSleeperModelHandler({
    importLeague: importSleeperLeague,
    buildInputs: buildModelInputs,
    getDeps: () => getImportDeps(),
    getModelDeps: () => getModelOnlyDeps(),
  }),
  { platform: "sleeper" },
);
