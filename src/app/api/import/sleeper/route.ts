/** POST /api/import/sleeper: see ./handler.ts; its rate limit, deadline and log: ../../_lib/route.ts (withRoute). */
import { importSleeperLeague, importSleeperUpload, leagueChoicesOf } from "@/adapters/sleeper";
import { getImportDeps } from "../../_lib/deps";
import { withRoute } from "../../_lib/route";
import { createSleeperImportHandler } from "./handler";

export const runtime = "nodejs";
/** Seconds: a little above the import deadline (src/server/limits.ts deadlines.importMs); a literal, as Next requires. */
export const maxDuration = 60;

export const POST = withRoute(
  "import",
  createSleeperImportHandler({
    importLeague: importSleeperLeague,
    importUpload: importSleeperUpload,
    getDeps: () => getImportDeps(),
    choicesOf: leagueChoicesOf,
  }),
  { platform: "sleeper" },
);
