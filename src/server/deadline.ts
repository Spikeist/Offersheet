/**
 * Each API request's deadline and what it cost us (planner reply to Checkpoint 4c, Part B, B1; Checkpoint 7a, track RL).
 *
 * withRoute (src/app/api/_lib/route.ts) runs every route handler inside a request scope held in AsyncLocalStorage, so
 * code deep inside an import or a model build (src/server/http.ts) can read the request's deadline without it being
 * passed down through the adapters and loaders:
 * - The deadline: limits.deadlines per route kind (import 45 s, model 90 s, session and feedback 10 s), counted from the
 *   request's start. The HTTP client never starts an attempt, a queue wait or a backoff wait that would end past it, caps
 *   each fetch's timeout at the time left, waits for a fetch another request started (single-flight) no longer than this
 *   request's own deadline, and gives a cache read or write at most limits.deadlines.cacheGraceMs past it, its own fetch
 *   (a cross-instance lock included) twice that (src/server/http.ts; withinDeadline below), so a slow source or a hanging
 *   store can't hold a route past Vercel's maxDuration (set a little above the deadline in each route.ts). Outside a scope
 *   (scripts, tests, the stable copy's background work started outside a route) there is no deadline: timeLeftMs() is
 *   Infinity and nothing changes.
 * - The client (withRoute: its rate-limit id, an HMAC of its IP address's bucket, src/server/rateLimit.ts clientKey), for
 *   its share of each platform's daily budget (src/server/budget.ts).
 * - What the request didn't do, by budget platform ("espn", "sleeper", "fantasycalc", "github"; "other" for any other host;
 *   "cache" for the server cache), each with its cause (CutReason): a source that took the time ("slow": an attempt still
 *   in flight when the deadline came, or a wait for an answer another request's fetch was getting), Offer Sheet's own waits
 *   that took it ("busy": a host's queue of other requests, the server cache), a request never made because no time was
 *   left ("skipped"), and refusals by a platform's daily budget ("budget") or by the client's share of it ("share"). The
 *   import routes read them to answer in words that name the cause (src/app/api/_lib/respond.ts: BUSY for a budget or a
 *   share, SOURCE_SLOW naming the slow source, or saying Offer Sheet is busy) instead of a plain "isn't responding".
 * - Log events waiting for the write after the response (src/server/log.ts; only with Redis on Vercel).
 * ⚠️ A background task a request starts without awaiting it (the player-ID crosswalk's rebuild, src/data/load.ts) runs in
 * the same scope, so the request's deadline bounds it too: past it the task still reads the cache (withinDeadline's floor)
 * but fetches nothing, so a rebuild that needed a fetch is a degraded build (the old crosswalk keeps being served and the
 * next rebuild comes 10 minutes later). An in-process single-flight fetch (src/server/http.ts) runs
 * under the deadline of the request that started it; a request that joins it waits no longer than its own deadline, and
 * when the starter's deadline cut the fetch short, a joiner that still has the time asks once more itself.
 * Server-side, but no "server-only" import: tsx scripts load src/server/http.ts, which reads it.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { deadlines } from "./limits";

/** The kinds of API route, each with its own rate limit and deadline (src/server/limits.ts). */
export const ROUTE_KINDS = ["import", "model", "session", "feedback"] as const;
export type RouteKind = (typeof ROUTE_KINDS)[number];

/** Each route kind's deadline in ms (limits.deadlines). */
export function deadlineMsOf(kind: RouteKind): number {
  switch (kind) {
    case "import":
      return deadlines.importMs;
    case "model":
      return deadlines.modelMs;
    case "session":
      return deadlines.sessionMs;
    case "feedback":
      return deadlines.feedbackMs;
  }
}

/** Why an outbound request didn't go out, or didn't finish (see the header). */
export const CUT_REASONS = ["slow", "busy", "skipped", "budget", "share"] as const;
export type CutReason = (typeof CUT_REASONS)[number];

/** The cut reasons that are the deadline's (the others are a budget's). */
export const DEADLINE_CUTS = ["slow", "busy", "skipped"] as const satisfies readonly CutReason[];

export interface RequestScope {
  readonly route: RouteKind;
  /** Epoch ms the request started (withRoute's clock). */
  readonly startedAt: number;
  /** The order the request arrived in (nextArrival): with startedAt, its place in each host's queue (src/server/http.ts). */
  readonly order: number;
  /** Epoch ms after which no outbound attempt starts. */
  readonly deadlineAt: number;
  /** The client's id (withRoute; see the header), for its share of each platform's daily budget; none outside withRoute. */
  readonly client?: string;
  /** Outbound requests this request didn't make or cut short, by cause and budget platform ("other", "cache"). */
  readonly cut: Readonly<Record<CutReason, Set<string>>>;
  /** Log entries (serialized, src/server/log.ts) waiting for the write after the response. */
  readonly pendingLogs: string[];
  /** The after-response write has run (or been handed to after()): later entries are written on their own. */
  flushed: boolean;
  /** Something this request waited for came back LATE (withinDeadline): past their bounds, later waits get no floor. */
  lateSeen: boolean;
}

const storage = new AsyncLocalStorage<RequestScope>();

let arrivals = 0;

/** The next number in this process's arrival order (a request's scope, or an outbound request made outside one). */
export function nextArrival(): number {
  arrivals += 1;
  return arrivals;
}

/**
 * A new scope for a request of `route` that started at `startedAt` (its deadline from limits.deadlines unless given), for
 * `client` (withRoute's clientKey) when known.
 */
export function newRequestScope(route: RouteKind, startedAt: number, deadlineMs: number = deadlineMsOf(route), client?: string): RequestScope {
  const cut = Object.fromEntries(CUT_REASONS.map((r) => [r, new Set<string>()])) as Record<CutReason, Set<string>>;
  return { route, startedAt, order: nextArrival(), deadlineAt: startedAt + deadlineMs, ...(client !== undefined ? { client } : {}), cut, pendingLogs: [], flushed: false, lateSeen: false };
}

/** Runs `fn` inside `scope`: everything it awaits, and every task it starts, sees the scope (requestScope()). */
export function runInRequestScope<T>(scope: RequestScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

/** The scope of the request this code runs for, or undefined outside one (scripts, tests, module setup). */
export function requestScope(): RequestScope | undefined {
  return storage.getStore();
}

/** Time left before the current request's deadline (ms; may be negative), or Infinity outside a request. */
export function timeLeftMs(now: number = Date.now()): number {
  const scope = storage.getStore();
  return scope ? scope.deadlineAt - now : Number.POSITIVE_INFINITY;
}

/** Notes that an outbound request of `platform` (a budget platform, "other" or "cache") was cut by `reason` (see the header). */
export function noteCut(reason: CutReason, platform: string): void {
  storage.getStore()?.cut[reason].add(platform);
}

/** What withinDeadline gives back when the deadline came first. */
export const LATE: unique symbol = Symbol("past the request's deadline");

/**
 * Waits for `p` no longer than the current request's deadline plus `graceMs`: its value, or LATE when the deadline (plus the
 * grace) came first; `p` keeps running, and a rejection it meets later is ignored. A rejection before that rejects. Outside
 * a request, `p` itself (no deadline). A wait that starts past its bound still gets limits.deadlines.lateFloorMs (a healthy
 * cache or a fetch about to settle answers in it), unless something this request waited for already came back LATE
 * (RequestScope.lateSeen: the store hangs, or the request is done): then only an already settled `p` gives its value. So a
 * request's waits run past its deadline by the grace and at most one floor in all.
 */
export function withinDeadline<T>(p: Promise<T>, graceMs = 0): Promise<T | typeof LATE> {
  const scope = storage.getStore();
  if (!scope) return p;
  p.catch(() => {}); // a rejection after we stopped listening isn't unhandled
  const untilBound = scope.deadlineAt + graceMs - Date.now();
  const waitMs = untilBound > 0 ? untilBound : scope.lateSeen ? 0 : deadlines.lateFloorMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof LATE>((resolve) => {
    if (waitMs <= 0) resolve(LATE);
    else timer = setTimeout(() => resolve(LATE), waitMs);
  });
  return Promise.race([p, late])
    .then((v) => {
      if (v === LATE) scope.lateSeen = true;
      return v;
    })
    .finally(() => {
      if (timer) clearTimeout(timer);
    });
}
