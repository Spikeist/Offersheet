/** GET /api/cron/snapshot: see ./handler.ts; its rate limit, deadline and log: ../../_lib/route.ts (withRoute); its schedule: vercel.json. */
import { withRoute } from "../../_lib/route";
import { createSnapshotCronHandler } from "./handler";

export const runtime = "nodejs";
/** Seconds: a little above the cron's deadline (src/server/limits.ts deadlines.cronMs); a literal, as Next requires. Over 60 s: Fluid compute. */
export const maxDuration = 120;

export const GET = withRoute("cron", createSnapshotCronHandler());
