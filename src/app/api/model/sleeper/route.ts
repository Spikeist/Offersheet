/** POST /api/model/sleeper: see ./handler.ts. */
import { importSleeperLeague } from "@/adapters/sleeper";
import { buildModelInputs } from "@/server/modelInputs";
import { getImportDeps } from "../../_lib/deps";
import { createSleeperModelHandler } from "./handler";

export const runtime = "nodejs";

export const POST = createSleeperModelHandler({
  importLeague: importSleeperLeague,
  buildInputs: buildModelInputs,
  getDeps: () => getImportDeps(),
});
