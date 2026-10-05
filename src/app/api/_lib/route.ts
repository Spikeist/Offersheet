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
 *    (the wait in words is the Retry-After's). A route can opt out (`rateLimited: false`: "Forget my credentials", which
 *    asks nothing of any source and must work even for a client over its limits). A limiter that can't be built or
 *    fails lets the request through (fail open, logged by the error's name).
 * 3. The handler runs inside the request's scope (src/server/deadline.ts): its deadline (import 45 s, model 90 s, session
 *    and feedback 10 s) bounds every outbound request it makes, the scope carries the client's id (its share of each
 *    platform's daily budget, src/server/budget.ts), and it collects what the deadline or a budget cut, which the import
 *    routes turn into words (src/app/api/_lib/respond.ts).
 * 4. A handler that throws (each catches its own errors, so this is a bug) answers INTERNAL, logged by error name.
 * 5. The log (src/server/log.ts; allowlisted fields only): a refusal (once per client and window), an answer with status
 *    500 or more (its code, status and time), and each source the deadline cut, by why ("deadline_slow": a source took the
 *    time; "deadline_busy": Offer Sheet's own queue or cache did; "deadline_skipped": a request never went out). With Redis
 *    on Vercel the lines also go to the shared store after the response (next/server's after()), never delaying it.
 * Nothing here reads or logs a request body, a cookie, a header value or the client's address (only its HMAC, inside the
 * limiter and the budget).
 */
import { after } from "next/server";
import { isApiError } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { DEADLINE_CUTS, newRequestScope, runInRequestScope, type RequestScope, type RouteKind } from "@/server/deadline";
import { errorNameOf, flushRequestLogs, LOG_PLATFORMS, logEvent, type LogPlatform } from "@/server/log";
import { clientKey, processLimiter, type RateLimiter, type RateVerdict } from "@/server/rateLimit";
import { errorResponse, isSameOrigin, logUnexpected } from "./respond";

export type RouteHandler = (request: Request) => Promise<Response>;

export interface RouteOptions {
  /** The platform the route serves (its log lines name it). */
  platform?: "espn" | "sleeper";
  /** false: no rate limit for this handler (step 2 of the header); the origin check still applies. */
  rateLimited?: boolean;
  /** Test hooks: the limiter (default the process's), the clock, the environment and next/server's after(). */
  limiter?: RateLimiter;
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

/** Hands the request's log lines to the after-response write (only lines bound for the store wait there; see log.ts). */
function scheduleFlush(scope: RequestScope, schedule: ((task: () => Promise<void>) => void) | undefined, env: RouteOptions["env"]): void {
  if (!scope.pendingLogs.length) {
    scope.flushed = true;
    return;
  }
  const task = () => flushRequestLogs(scope, env ? { env } : {});
  try {
    (schedule ?? after)(task);
  } catch {
    // Outside a Next request (a test calling the handler directly): write now, without holding the answer.
    void task();
  }
}

/** The client's rate-limit id (src/server/rateLimit.ts clientKey), or undefined if it can't be made (never expected). */
function clientOf(request: Request, env: RouteOptions["env"]): string | undefined {
  try {
    return clientKey(request, env);
  } catch {
    return undefined;
  }
}

/** Wraps a route handler of `kind` (see the header). */
export function withRoute(kind: RouteKind, handler: RouteHandler, opts: RouteOptions = {}): RouteHandler {
  const now = opts.now ?? Date.now;
  return async function route(request: Request): Promise<Response> {
    const startedAt = now();
    const client = clientOf(request, opts.env);
    const scope = newRequestScope(kind, startedAt, undefined, client);
    try {
      return await runInRequestScope(scope, async () => {
        // Another site's request (step 1 of the header): refused before it's counted, for any method.
        if (!isSameOrigin(request)) return errorResponse("BAD_ORIGIN");
        if (opts.rateLimited !== false) {
          let verdict: RateVerdict;
          try {
            // The process's limiter is built here, inside the try: one that can't be built fails open like one that fails.
            const limiter = opts.limiter ?? processLimiter();
            verdict = client === undefined ? { allowed: true, retryAfterS: 0, firstRefusal: false } : await limiter.check(kind, client, startedAt);
          } catch (err) {
            // The limiters never reject; if one does anyway, the request goes on (fail open).
            logEvent({ event: "limiter_error", errorName: errorNameOf(err) });
            verdict = { allowed: true, retryAfterS: 0, firstRefusal: false };
          }
          if (!verdict.allowed) {
            if (verdict.firstRefusal) logEvent({ event: "rate_limited", code: "RATE_LIMITED", ...(opts.platform ? { platform: opts.platform } : {}), status: 429 });
            return errorResponse("RATE_LIMITED", errorMessage("RATE_LIMITED", { retryAfterS: verdict.retryAfterS }), new Headers({ "retry-after": String(verdict.retryAfterS) }));
          }
        }
        let res: Response;
        try {
          res = await handler(request);
        } catch (err) {
          logUnexpected("route", err, opts.platform);
          res = errorResponse("INTERNAL");
        }
        await logOutcome(scope, res, Math.max(0, Math.round(now() - startedAt)), opts.platform);
        return res;
      });
    } finally {
      scheduleFlush(scope, opts.after, opts.env);
    }
  };
}
