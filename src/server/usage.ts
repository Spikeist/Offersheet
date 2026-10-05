/**
 * The beta's usage counters (planner reply to Checkpoint 7a, §2 question 7: "Usage check: add npm run usage:report"; §5.4:
 * FantasyCalc's free use holds while Offer Sheet stays "under about 10,000 sessions a month", and "usage:report shows
 * monthly sessions against 10,000 and warns at 8,000"; reports/fantasycalc-permission.md). Counted per UTC day, with no
 * identifiers at all: one key per counter and day, `prefix + "usage:" + YYYY-MM-DD + ":" + name`, the name from a closed
 * set (USAGE_COUNTERS), the value a number. `npm run usage:report -- --live` reads them (scripts/usage-report.ts).
 *
 *   model_builds              League page model builds answered (the model routes' 200s, the replay of a signed import
 *                             included): FantasyCalc's "sessions", since every build loads their values (and the browser
 *                             reuses a build for up to 6 hours, src/lib/modelStore.ts)
 *   import_<platform>_<path>  imports answered, by platform (espn, sleeper) and by who read the league: "browser" (the
 *                             visitor's browser read it and uploaded it) or "server" (Offer Sheet's server read it)
 *   refused_capacity          requests refused because the beta's shared capacity ran out (the server's day of work or its
 *                             current slice, a platform's server-wide day of requests): "The beta is at capacity today."
 *   refused_visitor           requests refused by a visitor's or its network's own day (the work budget's, a platform's
 *                             share, the feedback copies')
 *   refused_rate              requests refused by the per-IP rate limits (src/app/api/_lib/route.ts withRoute)
 *   work_units                work units charged to the daily work budget (src/server/budget.ts: on arrival, and the
 *                             handlers' extra charges)
 *   outbound_<platform>       the server's own requests that went out, by budgeted platform (espn, sleeper, fantasycalc,
 *                             github), retries included (src/server/http.ts)
 *
 * Where they're kept: on Vercel with the shared store only (usageStore; anywhere else nothing is counted or held, even with
 * KV_* variables in .env.local: Part B's ground rule). Each counter lives usageLimits.retainDays (400) after its day's last
 * count, so the report's 30 days and the month to date are always there.
 *
 * When they're written: never before an answer. A request's counts wait in its scope (src/server/deadline.ts) for the
 * after-response write withRoute hands to next/server's after(), next to the log's lines (src/server/log.ts): one
 * transaction of INCRBY and PEXPIRE per counter (RedisLike.incrExpire), at most usageLimits.writeTimeoutMs, a failure only
 * said on the console by its error's name (the counts are dropped). A refusal never costs a write of its own (a flood of
 * refused requests must not become a flood of Upstash commands): refusals, and whatever is counted outside a request or
 * after its write (work a request left running), wait in this process's memory for the next request that writes anyway, or
 * for the first request at least usageLimits.heldWriteEveryMs after the last write of them. ⚠️ So the refusal counts are a
 * floor: an instance that stops before its next write loses what it held (at most that long's worth).
 */
import { requestScope, type RequestScope } from "./deadline";
import { usageLimits } from "./limits";
import { errorNameOf, withTimeout, type LogEvent } from "./log";
import { getRedis, keyPrefix, type RedisLike } from "./redis";

type Env = Readonly<Record<string, string | undefined>>;

/** The counters (see the header), in the report's order. */
export const USAGE_COUNTERS = [
  "model_builds",
  "import_espn_browser",
  "import_espn_server",
  "import_sleeper_browser",
  "import_sleeper_server",
  "refused_capacity",
  "refused_visitor",
  "refused_rate",
  "work_units",
  "outbound_espn",
  "outbound_sleeper",
  "outbound_fantasycalc",
  "outbound_github",
] as const;
export type UsageCounter = (typeof USAGE_COUNTERS)[number];

const DAY_MS = 24 * 60 * 60_000;

/** "2026-10-05": the UTC day a count falls in. */
export function usageDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** The key a counter's day is kept under (see the header): never anything but the day and the counter's name. */
export function usageKey(prefix: string, day: string, name: UsageCounter): string {
  return `${prefix}usage:${day}:${name}`;
}

let storeForTests: RedisLike | null | undefined;

/**
 * The store usage is counted in (see the header): the shared store on Vercel only, else none (nothing counted). A Redis
 * client that can't be built means none (the log says why once: src/server/log.ts logStore).
 */
export function usageStore(env: Env = process.env): RedisLike | null {
  if (storeForTests !== undefined) return storeForTests;
  if (!env.VERCEL) return null;
  try {
    return getRedis(env);
  } catch {
    return null;
  }
}

/** Test hook: the store usage goes to (a FakeRedis), null for none, or undefined to read the environment again. */
export function setUsageStoreForTests(store: RedisLike | null | undefined): void {
  storeForTests = store;
}

/** Each request's counts until its after-response write ("day\0name" → count). */
const pendingByScope = new WeakMap<RequestScope, Map<string, number>>();
/** Counts held by this process for a later write (see the header): refusals, and counts outside or after a request's write. */
const held = new Map<string, number>();
/** When held counts were last written (epoch ms). */
let lastHeldWrite = Number.NEGATIVE_INFINITY;

function add(map: Map<string, number>, day: string, name: UsageCounter, by: number): void {
  const k = `${day}\u0000${name}`;
  map.set(k, (map.get(k) ?? 0) + by);
}

/**
 * Counts `by` (default 1) on `name` (see the header): in the current request's after-response write when there is one still
 * to come (the request's own day), else held by this process (`now`'s day). Nothing off Vercel. Never throws.
 */
export function noteUsage(name: UsageCounter, by = 1, now: number = Date.now()): void {
  if (!(by > 0) || !Number.isFinite(by) || !usageStore()) return;
  const scope = requestScope();
  if (scope && !scope.flushed) {
    let pending = pendingByScope.get(scope);
    if (!pending) {
      pending = new Map();
      pendingByScope.set(scope, pending);
    }
    add(pending, usageDay(scope.startedAt), name, by);
  } else add(held, usageDay(now), name, by);
}

/** Counts one refusal on `name`: always held by this process, never a write of its own (see the header). */
export function noteRefusal(name: "refused_capacity" | "refused_visitor" | "refused_rate", now: number = Date.now()): void {
  if (!usageStore()) return;
  add(held, usageDay(now), name, 1);
}

/** Counts an import answered, by platform and by who read the league (see the header). */
export function noteImport(platform: "espn" | "sleeper", readBy: "browser" | "server"): void {
  noteUsage(`import_${platform}_${readBy}`);
}

/** Whether held counts are due a write at `now` (usageLimits.heldWriteEveryMs since the last). */
function heldDue(now: number): boolean {
  return held.size > 0 && now - lastHeldWrite >= usageLimits.heldWriteEveryMs;
}

/** Whether the request's after-response write has usage to write: its own counts, or held counts that are due. */
export function hasUsageToWrite(scope: RequestScope, now: number = Date.now()): boolean {
  return (pendingByScope.get(scope)?.size ?? 0) > 0 || heldDue(now);
}

/**
 * Writes counts ("day\0name" → count) to their keys (see the header): one incrExpire, each key's expiry reset to
 * usageLimits.retainDays, at most usageLimits.writeTimeoutMs. Never rejects; a failure is said on the console by its
 * error's name only (never in the store).
 */
export async function writeUsage(store: RedisLike, counts: ReadonlyMap<string, number>, opts: { env?: Env; timeoutMs?: number } = {}): Promise<void> {
  const prefix = keyPrefix(opts.env ?? process.env);
  const entries: Array<{ key: string; by: number; ttlMs: number }> = [];
  for (const [k, by] of counts) {
    const [day, name] = k.split("\u0000") as [string, UsageCounter];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !(USAGE_COUNTERS as readonly string[]).includes(name) || !(by > 0)) continue;
    entries.push({ key: usageKey(prefix, day, name), by, ttlMs: usageLimits.retainDays * DAY_MS });
  }
  if (!entries.length) return;
  try {
    await withTimeout(store.incrExpire(entries), opts.timeoutMs ?? usageLimits.writeTimeoutMs);
  } catch (err) {
    console.error(JSON.stringify({ route: "server", event: "usage_write_failed", platform: "upstash", errorName: errorNameOf(err) } satisfies LogEvent));
  }
}

/**
 * The after-response write of a request's counts (withRoute hands it to next/server's after() with the log's): the request's
 * own, plus what this process holds when the request writes anyway or the held counts are due (see the header). Marks the
 * scope written first, so whatever is counted later is held. Never rejects.
 */
export async function flushRequestUsage(scope: RequestScope, opts: { env?: Env; store?: RedisLike | null; now?: number } = {}): Promise<void> {
  scope.flushed = true;
  const pending = pendingByScope.get(scope);
  pendingByScope.delete(scope);
  const now = opts.now ?? Date.now();
  const counts = new Map(pending ?? []);
  if (held.size && (counts.size > 0 || heldDue(now))) {
    for (const [k, n] of held) counts.set(k, (counts.get(k) ?? 0) + n);
    held.clear();
    lastHeldWrite = now;
  }
  if (!counts.size) return;
  const store = opts.store === undefined ? usageStore(opts.env) : opts.store;
  if (!store) return;
  await writeUsage(store, counts, opts.env ? { env: opts.env } : {});
}

/** Test hook: forget the counts this process holds and when they were last written. */
export function resetUsageForTests(): void {
  held.clear();
  lastHeldWrite = Number.NEGATIVE_INFINITY;
}

/** Test hook: the counts this process holds ("day\0name" → count). */
export function heldUsageForTests(): ReadonlyMap<string, number> {
  return held;
}
