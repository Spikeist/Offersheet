/**
 * /api/feedback: one anonymous copy of a trade idea's outcome or report (planner reply to Checkpoint 4c, Part B, B2;
 * Checkpoint 7a, track FB). The browser sends it after a press it has saved, while "Share anonymous feedback" is on
 * (src/lib/feedbackShare.ts); route.ts wraps this handler in withRoute (another site's request refused, the per-IP
 * "feedback" rate limit, the 10 s deadline, the log).
 *
 *   POST { the copy: src/lib/feedbackEvent.ts FeedbackEvent } → 202 { stored: true }    kept (Redis on Vercel)
 *                                                            → 202 { stored: false }   no store here (locally, or Redis
 *                                                                                      unusable), or the write failed
 *                                                            → 400 INVALID_REQUEST      not a copy the schema accepts
 *
 * The body is read with respond.ts readJsonBody (JSON only, at most 16 KB, never echoed) and checked against
 * src/server/feedbackSink.ts FeedbackEventSchema (strict: an unknown field anywhere refuses it). Nothing else of the
 * request is read or kept: not a header, a cookie or the address (the rate limit's HMAC of it stays in withRoute). The
 * store adds the UTC day the copy arrived and nothing more (feedbackSink.ts storeFeedback).
 *
 * A refused copy is logged (review FB-R8: the browser ignores the answer, so a builder and a schema that drift apart would
 * otherwise drop every copy without a trace): event "feedback_invalid", status 400 and a code naming the top-level field
 * that failed (feedbackSink.ts refusedCopyCode: a closed set, never a value), through src/server/log.ts's allowlist. At most
 * one line per feedbackLimits.invalidLogEveryMs per instance, so a flood of bad copies can't push the day's other log lines
 * out of the error log (its day list keeps logLimits.keepPerDay).
 */
import { z } from "zod";
import { FeedbackEventSchema, feedbackStoreFor, refusedCopyCode, storeFeedback } from "@/server/feedbackSink";
import { feedbackLimits } from "@/server/limits";
import { logEvent } from "@/server/log";
import type { RedisLike } from "@/server/redis";
import { errorResponse, jsonResponse, readJsonBody } from "../_lib/respond";

export interface FeedbackHandlerDeps {
  /** The store (default: feedbackSink.ts feedbackStoreFor, Redis on Vercel only). */
  store?: () => RedisLike | null;
  now?: () => number;
  env?: () => Readonly<Record<string, string | undefined>>;
}

/** What the route answers a copy it accepted (202): whether it was kept. */
export interface FeedbackResponse {
  stored: boolean;
}

/** What a refused copy is told (never what was wrong with it, nor anything it held). */
export const REFUSED_COPY_MESSAGE = "That isn't a feedback copy Offer Sheet accepts.";

/** The POST handler (route.ts wraps it in withRoute: one per server instance). */
export function createFeedbackHandler(deps: FeedbackHandlerDeps = {}): (request: Request) => Promise<Response> {
  let refusalLoggedAt = Number.NEGATIVE_INFINITY;
  /** Logs a refused copy by its code (the header), at most once per feedbackLimits.invalidLogEveryMs. */
  const noteRefused = (code: string, now: number): void => {
    if (now - refusalLoggedAt < feedbackLimits.invalidLogEveryMs) return;
    refusalLoggedAt = now;
    logEvent({ event: "feedback_invalid", code, status: 400 });
  };
  return async function POST(request: Request): Promise<Response> {
    const now = deps.now?.() ?? Date.now();
    const body = await readJsonBody(request, z.unknown());
    if (!body.ok) {
      noteRefused("INVALID_REQUEST", now);
      return errorResponse("INVALID_REQUEST", body.message);
    }
    const parsed = FeedbackEventSchema.safeParse(body.data);
    if (!parsed.success) {
      noteRefused(refusedCopyCode(parsed.error), now);
      return errorResponse("INVALID_REQUEST", REFUSED_COPY_MESSAGE);
    }
    const env = deps.env?.() ?? process.env;
    const store = deps.store ? deps.store() : feedbackStoreFor(env);
    const stored = store ? await storeFeedback(store, parsed.data, { now, env }) : false;
    const answer: FeedbackResponse = { stored };
    return jsonResponse(answer, { status: 202 });
  };
}
