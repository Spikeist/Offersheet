/** /api/health: see ./handler.ts; its rate limit, deadline and log: ../_lib/route.ts (withRoute). */
import { withRoute } from "../_lib/route";
import { createHealthHandler } from "./handler";

export const runtime = "nodejs";
/** Seconds: a little above the health deadline (src/server/limits.ts deadlines.healthMs); a literal, as Next requires. */
export const maxDuration = 15;

export const GET = withRoute("health", createHealthHandler());
