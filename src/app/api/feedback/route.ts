/** /api/feedback: see ./handler.ts; its rate limit, deadline and log: ../_lib/route.ts (withRoute). */
import { withRoute } from "../_lib/route";
import { createFeedbackHandler } from "./handler";

export const runtime = "nodejs";
/** Seconds: a little above the feedback deadline (src/server/limits.ts deadlines.feedbackMs); a literal, as Next requires. */
export const maxDuration = 15;

export const POST = withRoute("feedback", createFeedbackHandler());
