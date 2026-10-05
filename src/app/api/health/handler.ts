/**
 * /api/health (planner reply to Checkpoint 7a, §1: the Upstash check): which store this server instance runs on, and
 * whether the shared store answers, for Parker's check of a preview and Checkpoint 7b's go/no-go. route.ts wraps it in
 * withRoute (another site's request refused, the per-IP "health" rate limit, the 10 s deadline, the log); it is never
 * charged to the daily work budget (src/server/budget.ts admissionUnits).
 *
 *   GET → 200 { status, environment, region, store, storeReason, storeCheck } (no-store)
 *
 * - environment: Vercel's VERCEL_ENV ("preview", "production"), else "local"; region: VERCEL_REGION (e.g. "iad1"), else null.
 * - store: the process's cache (../_lib/deps.ts getServerCache): "shared" (this instance's memory in front of Upstash),
 *   "memory" (this instance's memory alone) or "file" (this computer). storeReason says why it isn't shared, by name only:
 *   "session_secret_missing", "store_variables_missing", "store_address_invalid", "not_on_vercel" or "network_off".
 * - storeCheck, with the shared store only: one SET (expiring after limits.healthLimits.keyTtlMs), GET and DEL of a random
 *   key under the deployment's prefix (os:<environment>:health:<uuid>), each timed and waiting at most
 *   healthLimits.stepTimeoutMs: { ok: true, setMs, getMs, delMs }, or { ok: false, step, errorName } (the error's name
 *   only: an Upstash error's message can carry its address). It goes to Upstash directly, past the cache's breaker, so it
 *   says whether Upstash answers now. A GET or DEL of a millisecond or two from iad1 means the database sits in the same
 *   region (US East); another region takes tens of milliseconds. 3 Upstash commands a check.
 * - status: "degraded" on Vercel when the store isn't shared or its check failed (the app still works, on per-instance
 *   memory), else "ok".
 * Never a secret: no address, token, key, stored value or variable's content, only names of states and timings.
 */
import { randomUUID } from "node:crypto";
import { healthLimits } from "@/server/limits";
import { errorNameOf, withTimeout } from "@/server/log";
import { getRedis, keyPrefix, type RedisLike } from "@/server/redis";
import { getServerCache, type ServerCache, type ServerCacheKind, type ServerCacheReason } from "../_lib/deps";
import { jsonResponse } from "../_lib/respond";

type Env = Readonly<Record<string, string | undefined>>;

export type StoreCheck = { ok: true; setMs: number; getMs: number; delMs: number } | { ok: false; step: "set" | "get" | "del" | "value"; errorName: string };

export interface HealthBody {
  status: "ok" | "degraded";
  environment: string;
  region: string | null;
  store: ServerCacheKind;
  storeReason: ServerCacheReason | null;
  storeCheck: StoreCheck | null;
}

export interface HealthOptions {
  /** Test hooks: the environment, the process's cache, its Redis client, the clock (ms, fractional) and each step's wait. */
  env?: Env;
  server?: () => ServerCache;
  redis?: () => RedisLike | null;
  clock?: () => number;
  stepTimeoutMs?: number;
}

/** VERCEL_ENV as a plain lowercase word (keyPrefix's rule), else "local". */
function environmentOf(env: Env): string {
  const scope = (env.VERCEL_ENV ?? "").trim().toLowerCase();
  return /^[a-z]+$/.test(scope) ? scope : "local";
}

/** VERCEL_REGION when it looks like a Vercel region id ("iad1"), else null. */
function regionOf(env: Env): string | null {
  const region = (env.VERCEL_REGION ?? "").trim().toLowerCase();
  return /^[a-z]{3}\d$/.test(region) ? region : null;
}

const round = (ms: number): number => Math.round(ms * 10) / 10;

/** One SET, GET and DEL of a random key (see the header). */
async function checkStore(client: RedisLike, env: Env, clock: () => number, stepMs: number): Promise<StoreCheck> {
  const key = `${keyPrefix(env)}health:${randomUUID()}`;
  const value = randomUUID();
  let step: "set" | "get" | "del" = "set";
  try {
    let t = clock();
    await withTimeout(client.set(key, value, { px: healthLimits.keyTtlMs }), stepMs);
    const setMs = round(clock() - t);
    step = "get";
    t = clock();
    const read = await withTimeout(client.get(key), stepMs);
    const getMs = round(clock() - t);
    step = "del";
    t = clock();
    await withTimeout(client.del(key), stepMs);
    const delMs = round(clock() - t);
    if (read !== value) return { ok: false, step: "value", errorName: "ValueMismatch" };
    return { ok: true, setMs, getMs, delMs };
  } catch (err) {
    return { ok: false, step, errorName: errorNameOf(err) };
  }
}

export function createHealthHandler(opts: HealthOptions = {}): (request: Request) => Promise<Response> {
  return async function health(): Promise<Response> {
    const env = opts.env ?? process.env;
    const server = (opts.server ?? getServerCache)();
    let storeCheck: StoreCheck | null = null;
    if (server.kind === "shared") {
      let client: RedisLike | null = null;
      try {
        client = (opts.redis ?? (() => getRedis()))();
      } catch (err) {
        storeCheck = { ok: false, step: "set", errorName: errorNameOf(err) };
      }
      if (client) storeCheck = await checkStore(client, env, opts.clock ?? (() => performance.now()), opts.stepTimeoutMs ?? healthLimits.stepTimeoutMs);
    }
    const degraded = Boolean(env.VERCEL) && (server.kind !== "shared" || storeCheck?.ok !== true);
    const body: HealthBody = {
      status: degraded ? "degraded" : "ok",
      environment: environmentOf(env),
      region: regionOf(env),
      store: server.kind,
      storeReason: server.reason ?? null,
      storeCheck,
    };
    return jsonResponse(body);
  };
}
