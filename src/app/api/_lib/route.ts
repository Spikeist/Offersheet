/**
 * withRoute(kind, handler): what every API route runs through (planner reply to Checkpoint 4c, Part B, B1; Checkpoint 7a,
 * track RL). Every src/app/api/** route.ts exports its handlers wrapped in it, and sets `maxDuration` a little above the
 * kind's deadline.
 *
 * 1. A request another site sent is refused first (BAD_ORIGIN, as every state-changing handler would), uncounted, for any
 *    method: a page elsewhere can't spend a visitor's limit with forged requests, an <img> or a no-cors GET included
 *    (our own pages' requests say same-origin; a typed address says none, and curl says nothing: those pass).
 * 2. The per-IP rate limit for the route's kind (src/server/rateLimit.ts), before the handler: over it, 429 with
 *    Retry-After and { error: { code: "RATE_LIMITED", message: "You're going a bit fast. Try again in about 8 minutes." } }
 *    (the wait in words is the Retry-After's); an IPv6 request is also counted against its /48 (final review SEC-2). Then
 *    the daily work budget (on Vercel only; src/server/budget.ts admissionUnits, the work budget; final review SEC-1, F1):
 *    an import or a League page request costs its units, counted against the client, its group and the server's day; over
 *    any of them, BUSY (respond.ts workRefusedResponse). A visitor this process already knows is over its day is refused
 *    first, before the rate limiter asks Redis anything, and so is one over its day of feedback copies on the feedback
 *    route (RATE_LIMITED, as its handler answers; final review SEC-3). A route can opt out of both (`rateLimited: false`:
 *    "Forget my credentials", which asks nothing of any source and must work even for a client over its limits). A
 *    limiter or a budget that can't be built or fails lets the request through (fail open, logged by the error's name).
 * 3. The handler runs inside the request's scope (src/server/deadline.ts): its deadline (import 45 s, model 90 s, session
 *    and feedback 10 s) bounds every outbound request it makes, the scope carries the client's and its group's ids (the
 *    work the handler charges, and the group's share of each platform's daily budget, src/server/budget.ts), and it
 *    collects what the deadline or a budget cut, which the import routes turn into words (src/app/api/_lib/respond.ts).
 * 4. A handler that throws (each catches its own errors, so this is a bug) answers INTERNAL, logged by error name.
 * 5. The log (src/server/log.ts; allowlisted fields only): a refusal (once per client and window), an answer with status
 *    500 or more (its code, status and time), and each source the deadline cut, by why ("deadline_slow": a source took the
 *    time; "deadline_busy": Offer Sheet's own queue or cache did; "deadline_skipped": a request never went out). With Redis
 *    on Vercel the lines also go to the shared store after the response (next/server's after()), never delaying it.
 * 6. Usage (planner reply to Checkpoint 7a, §2 question 7 and §5.4; src/server/usage.ts, on Vercel only): a League page
 *    build answered (a model route's 200: FantasyCalc's "sessions"), the work units charged on arrival, and every refusal
 *    (the rate limit's, a visitor's day, the beta's capacity: respond.ts) are counted per UTC day without identifiers, in the
 *    same after-response write as the log's lines (refusals ride along with a later write: they never cost one of their own).
 * Nothing here reads or logs a request body, a cookie, a header value or the client's address (only its HMAC, inside the
 * limiter and the budget).
 */
import { after } from "next/server";
import { isApiError } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { admissionUnits, feedbackQuota, secondsUntilUtcMidnight, workBudget, type DailyQuota, type QuotaVerdict } from "@/server/budget";
import { DEADLINE_CUTS, newRequestScope, runInRequestScope, type RequestScope, type RouteKind } from "@/server/deadline";
import { errorNameOf, flushRequestLogs, LOG_PLATFORMS, logEvent, type LogPlatform } from "@/server/log";
import { clientIds, processLimiter, type ClientIds, type RateLimiter, type RateVerdict } from "@/server/rateLimit";
import { flushRequestUsage, hasUsageToWrite, noteRefusal, noteUsage } from "@/server/usage";
import { errorResponse, isSameOrigin, logUnexpected, workRefusedResponse } from "./respond";

export type RouteHandler = (request: Request) => Promise<Response>;

export interface RouteOptions {
  /** The platform the route serves (its log lines name it). */
  platform?: "espn" | "sleeper";
  /** false: no rate limit or work budget for this handler (step 2 of the header); the origin check still applies. */
  rateLimited?: boolean;
  /**
   * Test hooks: the limiter (default the process's), the daily work budget and the feedback route's daily copies (default
   * the process's: on Vercel only; null: none), the clock, the environment and next/server's after().
   */
  limiter?: RateLimiter;
  work?: DailyQuota | null;
  feedbackQuota?: DailyQuota | null;
  now?: () => number;
  env?: Readonly<Record<string, string | undefined>>;
  after?: (task: () => Promise<void>) => void;
}

/** Answers logged as failures: ours or a source's (5xx), never the user's own errors (4xx; RATE_LIMITED is logged apart). */
const LOGGED_FROM_STATUS = 500;

/** The error code of one of our JSON error answers, or undefined. */
async function errorCodeOf(res: Response): Promise<string | undefined> {
  try {
    const body: unknown = await res.clone().json();
    return isApiError(body) ? body.error.code : undefined;
  } catch {
    return undefined;
  }
}

/** A cut's platform as the log may name it (src/server/log.ts LOG_PLATFORMS), "other" for anything else. */
function logPlatformOf(platform: string): LogPlatform {
  return (LOG_PLATFORMS as readonly string[]).includes(platform) ? (platform as LogPlatform) : "other";
}

/** The log lines for a request once its answer is known (step 5 of the header). */
async function logOutcome(scope: RequestScope, res: Response, ms: number, platform: LogPlatform | undefined): Promise<void> {
  for (const reason of DEADLINE_CUTS) for (const cut of scope.cut[reason]) logEvent({ event: `deadline_${reason}`, platform: logPlatformOf(cut), ms });
  if (res.status < LOGGED_FROM_STATUS) return;
  const code = await errorCodeOf(res);
  logEvent({ event: "error_response", ...(code ? { code } : {}), ...(platform ? { platform } : {}), status: res.status, ms });
}

/**
 * Hands the request's log lines and usage counts to the after-response write (only what's bound for the store waits there;
 * see log.ts and usage.ts): nothing to write, no after() at all.
 */
function scheduleFlush(scope: RequestScope, schedule: ((task: () => Promise<void>) => void) | undefined, env: RouteOptions["env"], now: number): void {
  if (!scope.pendingLogs.length && !hasUsageToWrite(scope, now)) {
    scope.flushed = true;
    return;
  }
  const task = async () => {
    await Promise.all([flushRequestLogs(scope, env ? { env } : {}), flushRequestUsage(scope, env ? { env } : {})]);
  };
  try {
    (schedule ?? after)(task);
  } catch {
    // Outside a Next request (a test calling the handler directly): write now, without holding the answer.
    void task();
  }
}

/** The client's ids (src/server/rateLimit.ts clientIds), or undefined if they can't be made (never expected). */
function idsOf(request: Request, env: RouteOptions["env"]): ClientIds | undefined {
  try {
    return clientIds(request, env);
  } catch {
    return undefined;
  }
}

/** The daily work budget (the option, else the process's), or null when it can't be built (fail open, logged by name). */
function workOf(opts: RouteOptions): DailyQuota | null {
  if (opts.work !== undefined) return opts.work;
  try {
    return workBudget();
  } catch (err) {
    logEvent({ event: "work_budget_error", errorName: errorNameOf(err) });
    return null;
  }
}

/** The feedback route's daily copies (the option, else the process's: the same one its handler charges), or null. */
function feedbackQuotaOf(opts: RouteOptions): DailyQuota | null {
  if (opts.feedbackQuota !== undefined) return opts.feedbackQuota;
  try {
    return feedbackQuota();
  } catch {
    return null;
  }
}

const ALLOWED: RateVerdict = { allowed: true, retryAfterS: 0, firstRefusal: false };

/** One rate-limit check (step 2 of the header); a limiter that rejects anyway lets the request through (fail open). */
async function rateCheck(opts: RouteOptions, kind: RouteKind, id: string, now: number, tier: "client" | "group"): Promise<RateVerdict> {
  try {
    // The process's limiter is built here, inside the try: one that can't be built fails open like one that fails.
    const limiter = opts.limiter ?? processLimiter();
    return await limiter.check(kind, id, now, tier);
  } catch (err) {
    logEvent({ event: "limiter_error", errorName: errorNameOf(err) });
    return ALLOWED;
  }
}

/** Wraps a route handler of `kind` (see the header). */
export function withRoute(kind: RouteKind, handler: RouteHandler, opts: RouteOptions = {}): RouteHandler {
  const now = opts.now ?? Date.now;
  return async function route(request: Request): Promise<Response> {
    const startedAt = now();
    const ids = idsOf(request, opts.env);
    const scope = newRequestScope(kind, startedAt, undefined, ids?.client, ids?.group);
    try {
      return await runInRequestScope(scope, async () => {
        // Another site's request (step 1 of the header): refused before it's counted, for any method.
        if (!isSameOrigin(request)) return errorResponse("BAD_ORIGIN");
        if (opts.rateLimited !== false) {
          // What the request costs the day's work budget (step 2 of the header): an import or a League page request.
          const units = admissionUnits(kind, request);
          const work = units > 0 ? workOf(opts) : null;
          // A visitor (or the server's day) this process already knows is over its day of work: refused before anything
          // is counted or asked of Redis (step 2 of the header; final review SEC-1, F1).
          const known = ids ? work?.refusedAlready(ids, startedAt) : null;
          if (known) return workRefusedResponse(known, startedAt);
          // Likewise a visitor already over its day of feedback copies (the handler charges them; final review SEC-3):
          // refused as the handler would, without the rate limiter's Redis commands.
          if (kind === "feedback" && ids && feedbackQuotaOf(opts)?.refusedAlready(ids, startedAt)) {
            noteRefusal("refused_visitor", startedAt);
            const retryAfterS = secondsUntilUtcMidnight(startedAt);
            return errorResponse("RATE_LIMITED", errorMessage("RATE_LIMITED", { retryAfterS }), new Headers({ "retry-after": String(retryAfterS) }));
          }
          // The client's window, and an IPv6 client's /48 too (final review SEC-2).
          let verdict = ids ? await rateCheck(opts, kind, ids.client, startedAt, "client") : ALLOWED;
          if (verdict.allowed && ids?.ipv6) verdict = await rateCheck(opts, kind, ids.group, startedAt, "group");
          if (!verdict.allowed) {
            if (verdict.firstRefusal) logEvent({ event: "rate_limited", code: "RATE_LIMITED", ...(opts.platform ? { platform: opts.platform } : {}), status: 429 });
            noteRefusal("refused_rate", startedAt);
            return errorResponse("RATE_LIMITED", errorMessage("RATE_LIMITED", { retryAfterS: verdict.retryAfterS }), new Headers({ "retry-after": String(verdict.retryAfterS) }));
          }
          // Charged: over the client's, its group's or the server's day, refused before the handler reads its body.
          if (work && ids) {
            let charged: QuotaVerdict = "ok";
            let counted = false;
            try {
              const v = work.charge(units, ids, startedAt);
              charged = typeof v === "string" ? v : await v;
              counted = true;
            } catch (err) {
              // The budgets never reject; if one does anyway, the request goes on (fail open).
              logEvent({ event: "work_budget_error", errorName: errorNameOf(err) });
            }
            if (charged !== "ok") return workRefusedResponse(charged, startedAt);
            if (counted) noteUsage("work_units", units, startedAt);
          }
        }
        let res: Response;
        try {
          res = await handler(request);
        } catch (err) {
          logUnexpected("route", err, opts.platform);
          res = errorResponse("INTERNAL");
        }
        // A League page build answered: FantasyCalc's "session" (step 6 of the header).
        if (kind === "model" && res.status === 200) noteUsage("model_builds");
        await logOutcome(scope, res, Math.max(0, Math.round(now() - startedAt)), opts.platform);
        return res;
      });
    } finally {
      scheduleFlush(scope, opts.after, opts.env, now());
    }
  };
}
