/**
 * /api/feedback: one anonymous copy of a trade idea's outcome or report (planner reply to Checkpoint 4c, Part B, B2;
 * Checkpoint 7a, track FB). The browser sends it after a press it has saved, while "Share anonymous feedback" is on
 * (src/lib/feedbackShare.ts); route.ts wraps this handler in withRoute (another site's request refused, the per-IP
 * "feedback" rate limit, the 10 s deadline, the log).
 *
 *   POST { the copy: src/lib/feedbackEvent.ts FeedbackEvent } → 202 { stored: true }    kept (Redis on Vercel)
 *                                                            → 202 { stored: false }   no store here (locally, or Redis
 *                                                                                      unusable), or the write failed
 *                                                            → 400 INVALID_REQUEST      not a copy the schema accepts,
 *                                                                                      or bigger than the store keeps
 *                                                            → 429 RATE_LIMITED         over the day's copies (below)
 *
 * The body is read with respond.ts readJsonBody (JSON only, at most 16 KB, never echoed) and checked against
 * src/server/feedbackSink.ts FeedbackEventSchema (strict: an unknown field anywhere refuses it). Nothing else of the
 * request is read or kept: not a header, a cookie or the address (the rate limit's and the daily quota's HMACs of it stay
 * in withRoute and src/server/budget.ts). The store adds the UTC day the copy arrived and nothing more (feedbackSink.ts
 * storeFeedback).
 *
 * A refused copy is logged (review FB-R8: the browser ignores the answer, so a builder and a schema that drift apart would
 * otherwise drop every copy without a trace): event "feedback_invalid", status 400 and a code naming the top-level field
 * that failed (feedbackSink.ts refusedCopyCode: a closed set, never a value; "INVALID_TOO_LARGE" for a copy over
 * feedbackLimits.maxStoredBytes as stored, final review F4), through src/server/log.ts's allowlist. At most one line per
 * feedbackLimits.invalidLogEveryMs per instance, so a flood of bad copies can't push the day's other log lines out of the
 * error log (its day list keeps logLimits.keepPerDay).
 *
 * The daily copy quota (final review SEC-3; src/server/budget.ts feedbackQuota, on Vercel only): a client (an IPv4 address
 * or IPv6 /64) may send feedbackLimits.perClientPerDay copies a UTC day and its group (an IPv4 /24 or IPv6 /48)
 * perGroupPerDay; past either the copy isn't stored and the answer is 429 RATE_LIMITED until the day ends, so one visitor
 * can't fill a day's list (feedbackLimits.maxPerDay) with forged copies. Checked only where a store is, after the copy is
 * checked (a refused copy costs nothing).
 */
import { z } from "zod";
import { errorMessage } from "@/lib/errors";
import { feedbackQuota, secondsUntilUtcMidnight, type DailyQuota, type QuotaVerdict } from "@/server/budget";
import { requestScope } from "@/server/deadline";
import { FeedbackEventSchema, feedbackStoreFor, fitsFeedbackStore, refusedCopyCode, storeFeedback } from "@/server/feedbackSink";
import { feedbackLimits } from "@/server/limits";
import { logEvent } from "@/server/log";
import type { RedisLike } from "@/server/redis";
import { errorResponse, jsonResponse, readJsonBody } from "../_lib/respond";

export interface FeedbackHandlerDeps {
  /** The store (default: feedbackSink.ts feedbackStoreFor, Redis on Vercel only). */
  store?: () => RedisLike | null;
  /** The daily copy quota (default: src/server/budget.ts feedbackQuota, on Vercel only; null: none). */
  quota?: () => DailyQuota | null;
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
    if (!fitsFeedbackStore(parsed.data, now)) {
      noteRefused("INVALID_TOO_LARGE", now);
      return errorResponse("INVALID_REQUEST", REFUSED_COPY_MESSAGE);
    }
    const env = deps.env?.() ?? process.env;
    const store = deps.store ? deps.store() : feedbackStoreFor(env);
    if (store) {
      // The client's and its group's copies today (the header): over either, not stored, until the day ends.
      const quota = deps.quota ? deps.quota() : feedbackQuota();
      const scope = requestScope();
      let verdict: QuotaVerdict = "ok";
      if (quota && scope) {
        const v = quota.charge(1, { ...(scope.client !== undefined ? { client: scope.client } : {}), ...(scope.group !== undefined ? { group: scope.group } : {}) }, now);
        verdict = typeof v === "string" ? v : await v;
      }
      if (verdict !== "ok") {
        const retryAfterS = secondsUntilUtcMidnight(now);
        return errorResponse("RATE_LIMITED", errorMessage("RATE_LIMITED", { retryAfterS }), new Headers({ "retry-after": String(retryAfterS) }));
      }
    }
    const stored = store ? await storeFeedback(store, parsed.data, { now, env }) : false;
    const answer: FeedbackResponse = { stored };
    return jsonResponse(answer, { status: 202 });
  };
}
