import "server-only";
/**
 * Dependencies for the import routes (CLAUDE.md §3): one polite, cached HTTP client per server
 * process (its per-host pacing only works if requests share it; the player ID resolver is also
 * memoized per client by src/data), plus the time.
 *
 * The cache, picked here and nowhere else (planner reply to Checkpoint 4c, Part B, B1: the shared cache; track CA;
 * selectServerCache):
 * - On Vercel (VERCEL set) with Redis configured (src/server/redis.ts redisConfigured: the Vercel Marketplace's
 *   KV_REST_API_URL and KV_REST_API_TOKEN, or Upstash's own names, and SESSION_SECRET of 32+ characters) → this
 *   instance's memory in front of Redis (TieredCache(MemoryLruCache, RedisCache)), plus the cross-instance lock for
 *   league-independent entries (RedisCacheLock; it waits no longer than the request's deadline allows, src/server/
 *   deadline.ts). Both share one SharedCacheBreaker (src/server/cache.ts; review CA-1): a Redis that's slow or down
 *   costs one command's timeout, then the instance runs on its memory alone for a minute.
 * - On Vercel without it (a read-only file system) → this instance's memory alone (MemoryLruCache), with one log line
 *   ("cache_memory_only"): a preview deployed before Upstash is connected still works, cached per instance. So does one
 *   whose Redis address can't be used (a connection string in KV_REST_API_URL, say: the client can't be built), logged
 *   first as "redis_config_invalid" by its error's name only (its message can hold the password; review CA-5).
 * - The memory tier sweeps expired entries on a timer every minute while the process runs (review CA-8).
 * - Anywhere else (this computer: the stable copy, `npm run dev`, even with KV_* variables in .env.local) → the file
 *   cache, exactly as before.
 *
 * The file cache's folder (fileCacheDir): FileCache's default, .cache/app in the working directory, unless CACHE_DIR_ENV
 * names another. The stable copy (planner reply to Checkpoint 4c, A1; scripts/stable.ts) runs from a sibling folder and
 * sets it to the main folder's .cache/app, so both copies share one cache: FantasyCalc stays at one fetch a day per format
 * (§2.9) and the platforms see one set of requests. Safe to share: the HTTP client stores raw responses only (status, type,
 * body, fetch time; ESPN's SWIDs replaced by the same one-way pseudonyms in every version), each written atomically
 * (a temp file, then a rename) with its own expiry that either process's sweep honours; the two copies run different
 * versions of the code, so an entry is read only in the shape and format this version stores (src/server/http.ts
 * isCachedResponse, CACHE_FORMAT: anything else is a miss, never an error). Bodies a fetch-time reducer shortens
 * (src/data/reduce.ts) are filed under keys of their own ("#<reducer>-r<version>-<fingerprint>"), so the stable copy
 * never reads one. FantasyCalc's lists keep their keys (no reducer), so the one fetch a day per format stays shared.
 * ⚠️ The reduced bodies aren't shared (review CA-9): until the stable copy runs code with the same reducers
 * (`npm run stable` on a checkpoint after 7a), the two copies each fetch Sleeper's players lists, the DynastyProcess ID
 * map, and Sleeper's projections and stats for themselves (the players lists and the ID map up to twice a day instead
 * of §2.3's and §2.10's once), and neither can use the other's saved copy as a stand-in while a source is down.
 * ⚠️ Single-flight is per process, so the two copies can fetch the same resource at the same moment (at most one extra
 * request); and a wrong body that work in progress stores under the right key reaches the stable copy until it expires
 * (http.ts header).
 */
import path from "node:path";
import type { HttpClient, ImportDeps } from "@/adapters/types";
import { loadPlayerIdResolver } from "@/data";
import { FileCache, MemoryLruCache, MINUTE, RedisCache, RedisCacheLock, SharedCacheBreaker, TieredCache, type Cache, type CacheLock } from "@/server/cache";
import { timeLeftMs } from "@/server/deadline";
import { createHttpClient } from "@/server/http";
import { cacheLimits, deadlines } from "@/server/limits";
import { errorNameOf, logEvent } from "@/server/log";
import { getRedis, type RedisLike } from "@/server/redis";

type Env = Readonly<Record<string, string | undefined>>;

/** The environment variable naming the file cache's folder (see the header). */
export const CACHE_DIR_ENV = "OFFERSHEET_CACHE_DIR";

/** CACHE_DIR_ENV as an absolute folder, or undefined (FileCache's default) when it isn't set. */
export function fileCacheDir(env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  const dir = env[CACHE_DIR_ENV]?.trim();
  return dir ? path.resolve(dir) : undefined;
}

/** Which cache the server runs on (see the header). */
export type ServerCacheKind = "shared" | "memory" | "file";

export interface ServerCache {
  kind: ServerCacheKind;
  cache: Cache;
  /** The cross-instance lock (the shared cache only). */
  lock?: CacheLock;
}

/**
 * The server's cache for this environment (see the header). `redis` is the process's client: by default, on Vercel,
 * getRedis (null when Redis isn't configured; a client that can't be built is logged as "redis_config_invalid" by its
 * error's name only and taken as none); tests pass their own, or null for none. ⚠️ Off Vercel the file cache is used
 * whatever `redis` is: .env.local may hold the KV_* variables (`npm run feedback:pull -- --live` reads them, and
 * `vercel env pull` writes them), and the stable copy and `npm run dev` must still never contact Upstash (Part B's ground
 * rules).
 */
export function selectServerCache(env: Env = process.env, redis?: RedisLike | null): ServerCache {
  if (!env.VERCEL) return { kind: "file", cache: new FileCache(fileCacheDir(env)) };
  let client = redis;
  if (client === undefined) {
    try {
      client = getRedis(env);
    } catch (err) {
      // An address the SDK refuses (its message can carry the password): the name only, and this instance's memory alone.
      logEvent({ event: "redis_config_invalid", platform: "upstash", errorName: errorNameOf(err) });
      client = null;
    }
  }
  const memory = new MemoryLruCache(cacheLimits.memoryBytes, { sweepEveryMs: MINUTE });
  if (client) {
    const breaker = new SharedCacheBreaker();
    return {
      kind: "shared",
      cache: new TieredCache(memory, new RedisCache(client, { env, breaker })),
      lock: new RedisCacheLock(client, { env, breaker, timeLeftMs: () => timeLeftMs(), minAttemptMs: deadlines.minAttemptMs }),
    };
  }
  logEvent({ event: "cache_memory_only" });
  return { kind: "memory", cache: memory };
}

let http: HttpClient | undefined;

export function getHttp(): HttpClient {
  if (!http) {
    const { cache, lock } = selectServerCache();
    http = createHttpClient({ cache, ...(lock ? { lock } : {}) });
  }
  return http;
}

export async function getImportDeps(now: Date = new Date()): Promise<ImportDeps> {
  const client = getHttp();
  return { http: client, resolver: await loadPlayerIdResolver({ http: client, now }), now };
}
