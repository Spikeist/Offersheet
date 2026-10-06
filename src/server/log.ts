/**
 * The error log (planner reply to Checkpoint 4c, Part B, B1: "error logging that never records credentials or league
 * data"; Checkpoint 7a, track RL). Every server-side problem worth knowing about goes through logEvent, which accepts only
 * an allowlist of fields, each with a narrow shape (a zod strict object: an unknown field or a value of another shape is
 * refused), so no URL, league id, username, team or owner name, cookie, SWID, IP address or message text can reach a log:
 *
 *   route      the API route kind the request was for (import, model, session, feedback), or "server" outside one
 *   event      what happened, a snake_case word ("unexpected", "rate_limited", "cache_write_failed" …)
 *   code       an error or warning code ("SOURCE_DOWN", "RATE_LIMITED" …)
 *   platform   a platform or source name ("espn", "sleeper", "fantasycalc", "github", "upstash", "other" …)
 *   status     an HTTP status
 *   errorName  an Error's name ("TypeError"), never its message
 *   ms         a duration
 *
 * Where it goes:
 * - One JSON line on the console (stderr), always. Vercel keeps runtime logs 1 hour on the Hobby plan.
 * - With Redis on Vercel only (getRedis() and VERCEL set): also the shared store, so `npm run beta:log -- --live` can read
 *   two weeks of them. One list per UTC day, `prefix + "log:" + YYYY-MM-DD`, its newest logLimits.keepPerDay entries kept,
 *   each day's list deleted logLimits.retainDays after the day began (so no entry outlives the privacy page's 14 days).
 *   An entry is the event plus `at` (epoch ms). Inside a request (src/server/deadline.ts) entries wait for the write after
 *   the response (withRoute hands it to next/server's after()): one LPUSH, LTRIM and PEXPIRE per request that logged
 *   anything, never a delay to the response; outside one (or after that write) an entry is written on its own. A write
 *   that fails is said on the console only.
 * - Lines a visitor can set off at will are throttled per instance (B4 security review: a few addresses' forged uploads and
 *   rate-limit refusals could push a day's real lines out of the store's logLimits.keepPerDay; logThrottled): one
 *   "rate_limited" line every logLimits.refusalEveryMs, whatever its route (the usage counters count every refusal:
 *   src/server/usage.ts), and one line every logLimits.repeatEveryMs of each repeating failure ("error_response",
 *   "unexpected_*", "deadline_*" with the same route, code, platform, status and error name). The others are dropped,
 *   console and store alike.
 * Locally (no Redis) nothing changes but the console line's shape. Never throws.
 */
import { z } from "zod";
import { redactSecrets } from "@/lib/errors";
import { ROUTE_KINDS, requestScope, type RequestScope } from "./deadline";
import { logLimits } from "./limits";
import { getRedis, keyPrefix, type RedisLike } from "./redis";

export const LOG_ROUTES = [...ROUTE_KINDS, "server"] as const;
export type LogRoute = (typeof LOG_ROUTES)[number];

/** Platforms and sources a log line may name ("cache": the server cache, src/server/http.ts; "upstash": the shared store). */
export const LOG_PLATFORMS = ["espn", "sleeper", "yahoo", "fleaflicker", "mfl", "fantrax", "manual", "fantasycalc", "github", "upstash", "cache", "other"] as const;
export type LogPlatform = (typeof LOG_PLATFORMS)[number];

/** An Error's name as the log may hold it (letters, digits, _ and $; at most 48). */
const ERROR_NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,47}$/;

/** The allowlist (see the header). */
export const LogEventSchema = z.strictObject({
  route: z.enum(LOG_ROUTES),
  event: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
  code: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,47}$/)
    .optional(),
  platform: z.enum(LOG_PLATFORMS).optional(),
  status: z.number().int().min(0).max(599).optional(),
  errorName: z.string().regex(ERROR_NAME).optional(),
  ms: z.number().int().min(0).max(86_400_000).optional(),
});
export type LogEvent = z.infer<typeof LogEventSchema>;

/** What the store keeps: the event and when it was logged. */
export const StoredLogEventSchema = LogEventSchema.extend({ at: z.number().int().min(0) });
export type StoredLogEvent = z.infer<typeof StoredLogEventSchema>;

/** logEvent's input: the route defaults to the current request's (src/server/deadline.ts), else "server". */
export type LogInput = Omit<LogEvent, "route"> & { route?: LogRoute };

/** An error's name for the log: its own when it has a plain one, else its type ("Error" for an oddly named Error). */
export function errorNameOf(err: unknown): string {
  if (err instanceof Error) return ERROR_NAME.test(err.name) ? err.name : "Error";
  if (err && typeof err === "object") {
    const name = (err as { name?: unknown }).name;
    return typeof name === "string" && ERROR_NAME.test(name) ? name : "Object";
  }
  return typeof err;
}

type Env = Readonly<Record<string, string | undefined>>;

let storeForTests: RedisLike | null | undefined;
let storeFailureSaid = false;

/**
 * The store is written only on Vercel with Redis (see the header); locally the console line is the whole log. A Redis client
 * that can't be built (a malformed address) means no store, said once on the console by its error's name only (never
 * through logEvent, which calls this).
 */
export function logStore(env: Env = process.env): RedisLike | null {
  if (storeForTests !== undefined) return storeForTests;
  if (!env.VERCEL) return null;
  try {
    return getRedis(env);
  } catch (err) {
    if (!storeFailureSaid) {
      storeFailureSaid = true;
      console.error(JSON.stringify({ route: "server", event: "redis_config_invalid", platform: "upstash", errorName: errorNameOf(err) } satisfies LogEvent));
    }
    return null;
  }
}

/** Test hook: the store every log line goes to (a FakeRedis), or undefined to read the environment again. */
export function setLogStoreForTests(store: RedisLike | null | undefined): void {
  storeForTests = store;
}

/** The day list an entry logged at `at` goes to. */
export function logDayKey(at: number, env: Env = process.env): string {
  return `${keyPrefix(env)}log:${new Date(at).toISOString().slice(0, 10)}`;
}

const DAY_MS = 24 * 60 * 60_000;

/** How long a day list may live once `now` writes to it: until retainDays after the day began (≤ 0: already past). */
export function logDayTtlMs(at: number, now: number): number {
  const dayStart = Math.floor(at / DAY_MS) * DAY_MS;
  return dayStart + logLimits.retainDays * DAY_MS - now;
}

/** The throttle's memory (logThrottled): a line's key → when this instance last logged it, oldest first. */
const lastLogged = new Map<string, number>();

/**
 * Whether `event` is a line a visitor can set off at will and one like it was logged too recently on this instance (see
 * the header; B4 security review): "rate_limited" at most once every logLimits.refusalEveryMs, whatever its route, and
 * "error_response", "unexpected_*" and "deadline_*" at most once every logLimits.repeatEveryMs for the same route, event,
 * code, platform, status and error name. A line let through is remembered (at most logLimits.throttleMaxKeys keys).
 */
export function logThrottled(event: LogEvent, now: number): boolean {
  let key: string;
  let everyMs: number;
  if (event.event === "rate_limited") {
    key = "rate_limited";
    everyMs = logLimits.refusalEveryMs;
  } else if (event.event === "error_response" || event.event.startsWith("unexpected_") || event.event.startsWith("deadline_")) {
    key = [event.route, event.event, event.code ?? "", event.platform ?? "", event.status ?? "", event.errorName ?? ""].join("|");
    everyMs = logLimits.repeatEveryMs;
  } else {
    return false;
  }
  const last = lastLogged.get(key);
  if (last !== undefined && now >= last && now - last < everyMs) return true;
  lastLogged.delete(key);
  if (lastLogged.size >= logLimits.throttleMaxKeys) {
    // Full: the line logged longest ago is forgotten (it may be logged once more, a little early).
    const oldest = lastLogged.keys().next().value;
    if (oldest !== undefined) lastLogged.delete(oldest);
  }
  lastLogged.set(key, now);
  return false;
}

/** Test hook: forget what the throttle let through. */
export function resetLogThrottleForTests(): void {
  lastLogged.clear();
}

/**
 * Logs one event (see the header): checked against the allowlist (anything else is logged as "invalid_log_event", without
 * its content), throttled when it's a line a visitor can set off at will (logThrottled), one JSON line on the console,
 * and with Redis on Vercel the store. Never throws.
 */
export function logEvent(input: LogInput, opts: { now?: number; env?: Env; store?: RedisLike | null } = {}): void {
  try {
    const scope = requestScope();
    const parsed = LogEventSchema.safeParse({ ...input, route: input.route ?? scope?.route ?? "server" });
    const event: LogEvent = parsed.success ? parsed.data : { route: scope?.route ?? "server", event: "invalid_log_event" };
    const at = opts.now ?? Date.now();
    if (logThrottled(event, at)) return;
    console.error(JSON.stringify(event));
    const env = opts.env ?? process.env;
    const store = opts.store === undefined ? logStore(env) : opts.store;
    if (!store) return;
    const entry = JSON.stringify({ ...event, at });
    if (scope && !scope.flushed) scope.pendingLogs.push(entry);
    else void writeLogEntries(store, [entry], { env });
  } catch {
    // A log line must never break the request that logs it.
  }
}

/**
 * Writes entries (serialized StoredLogEvents) to their day lists: per day, one LPUSH (oldest first, so the newest ends
 * up at the head), an LTRIM to the newest logLimits.keepPerDay and a PEXPIRE to the day's end of retention; at most
 * logLimits.writeTimeoutMs in all. Never rejects; a failure is said on the console (never in the store).
 */
export async function writeLogEntries(store: RedisLike, entries: readonly string[], opts: { env?: Env; now?: number; timeoutMs?: number } = {}): Promise<void> {
  if (!entries.length) return;
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now();
  const byDay = new Map<string, { at: number; entries: string[] }>();
  for (const entry of entries) {
    let at = now;
    try {
      const parsed = StoredLogEventSchema.safeParse(JSON.parse(entry));
      if (parsed.success) at = parsed.data.at;
      else continue; // never store what the allowlist wouldn't have produced
    } catch {
      continue;
    }
    const key = logDayKey(at, env);
    const day = byDay.get(key) ?? { at, entries: [] };
    day.entries.push(entry);
    byDay.set(key, day);
  }
  const work = (async () => {
    for (const [key, day] of byDay) {
      const ttl = logDayTtlMs(day.at, now);
      if (ttl <= 0) continue;
      // One transaction (MULTI/EXEC: all or nothing), so a day's list never exists without its expiry (Checkpoint 7a,
      // after review FB-R5: separate commands could leave a list past the privacy page's 14 days if the PEXPIRE failed).
      await store.lpushTrimExpire(key, day.entries, logLimits.keepPerDay, ttl);
    }
  })();
  try {
    await withTimeout(work, opts.timeoutMs ?? logLimits.writeTimeoutMs);
  } catch (err) {
    console.error(JSON.stringify({ route: "server", event: "log_write_failed", platform: "upstash", errorName: errorNameOf(err) } satisfies LogEvent));
  }
}

/**
 * The after-response write of a request's entries (withRoute hands it to next/server's after()). Marks the scope flushed
 * first, so entries logged later (a background task the request started) are written on their own. Never rejects.
 */
export async function flushRequestLogs(scope: RequestScope, opts: { env?: Env; store?: RedisLike | null; now?: number } = {}): Promise<void> {
  scope.flushed = true;
  const entries = scope.pendingLogs.splice(0);
  const store = opts.store === undefined ? logStore(opts.env) : opts.store;
  if (!store || !entries.length) return;
  await writeLogEntries(store, entries, { ...(opts.env ? { env: opts.env } : {}), ...(opts.now !== undefined ? { now: opts.now } : {}) });
}

/**
 * For local development only (`npm run dev`, NODE_ENV "development", never on Vercel): an unexpected error's message,
 * redacted (src/lib/errors.ts redactSecrets) and cut to 500 characters, as a second console line next to its log event,
 * so Parker can see what broke. Never in the store, never in production or tests.
 */
export function logDevDetail(err: unknown, env: Env = process.env): void {
  if (env.NODE_ENV !== "development" || env.VERCEL || !(err instanceof Error)) return;
  console.error(`[offer-sheet] development only: ${redactSecrets(err.message).slice(0, 500)}`);
}

/** Rejects with a TimeoutError after `ms` unless `p` settles first (the timer is cleared either way). */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`timed out after ${ms} ms`);
      err.name = "TimeoutError";
      reject(err);
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
