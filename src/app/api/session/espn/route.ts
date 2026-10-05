/** /api/session/espn: see ./handler.ts; its rate limit, deadline and log: ../../_lib/route.ts (withRoute). */
import { withRoute } from "../../_lib/route";
import { createEspnSessionHandlers } from "./handler";

export const runtime = "nodejs";
/** Seconds: a little above the session deadline (src/server/limits.ts deadlines.sessionMs); a literal, as Next requires. */
export const maxDuration = 15;

const handlers = createEspnSessionHandlers();

export const GET = withRoute("session", handlers.GET, { platform: "espn" });
export const POST = withRoute("session", handlers.POST, { platform: "espn" });
/** "Forget my credentials" works even for a client over its limits: it asks nothing of any source, only clears its cookie. */
export const DELETE = withRoute("session", handlers.DELETE, { platform: "espn", rateLimited: false });
