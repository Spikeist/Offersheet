/** POST /api/import/sleeper: see ./handler.ts. */
import { importSleeperLeague, leagueChoicesOf } from "@/adapters/sleeper";
import { getImportDeps } from "../../_lib/deps";
import { createSleeperImportHandler } from "./handler";

export const runtime = "nodejs";

export const POST = createSleeperImportHandler({
  importLeague: importSleeperLeague,
  getDeps: () => getImportDeps(),
  choicesOf: leagueChoicesOf,
});
