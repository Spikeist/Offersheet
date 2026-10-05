/**
 * Per-IP rate limits on every API route (planner reply to Checkpoint 4c, Part B, B1: "Rate limits: per IP on every server
 * route"; Checkpoint 7a, track RL). withRoute (src/app/api/_lib/route.ts) checks one before any handler runs.
 *
 * - The client: the IP address from `x-real-ip`, else the first `x-forwarded-for` (Vercel overwrites both with the real
 *   client address; locally Next sets x-forwarded-for to the socket's, and a value there is untrusted, which is fine for a
 *   local server). IPv4 as is; IPv6 by its /64 (one household or phone gets a whole /64, so one address each would be no
 *   limit); none or unreadable: one shared "unknown" client. The address never reaches a key, a log or a value: with
 *   Redis it goes in only as hmacId("client-id/v1", bucket) (src/server/redis.ts, an HMAC under SESSION_SECRET);
 *   without, as an HMAC under a random key this process draws at start.
 * - Limits (limits.rateLimits): import 30 and model 30 per 10 minutes, session 20 per 10 minutes, feedback 60 per hour,
 *   per client and route kind, in fixed windows aligned to the clock (the window an attempt falls in is
 *   floor(now / window)). Over: 429 with Retry-After (the seconds left in the window) and RATE_LIMITED.
 * - With Redis (on Vercel only: off Vercel nothing here contacts Upstash, even with its variables in .env.local):
 *   @upstash/ratelimit's fixed window (one EVALSHA running INCRBY, plus PEXPIRE on a window's first request: 2–3 Upstash
 *   commands a check), one limiter per route kind created once per process (module scope), its ephemeral cache on (a
 *   client already refused in this window is refused again without Redis), analytics and telemetry off. Keys:
 *   `prefix + "rl:" + kind + ":" + client + ":" + window`, gone when the window ends (so a client's hash is kept at most an
 *   hour, the longest window). A check slower than limits.rateLimits.timeoutMs, or failing, lets the request through,
 *   counted in this process's own windows instead (fail open, as without Redis), and Redis is left alone for
 *   limits.rateLimits.redisRetryAfterMs (logged once). A Redis client that can't be built (a malformed address) is logged
 *   by its error's name only, and the process's own windows are used.
 * - Without Redis (local, the stable copy, tests, a preview before Upstash is connected): this process's own windows,
 *   at most limits.rateLimits.memoryMaxKeys clients.
 * - Memory: a client whose window has ended is dropped from this process (its own windows, and the record of clients the
 *   shared limiter refused) within limits.rateLimits.sweepEveryMs, whenever a request comes, so no client's hash is kept
 *   past its window, at most an hour.
 * A refusal is logged once per client and window in each process (the first; later ones are counted nowhere).
 */
import { createHmac, randomBytes } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import type { RouteKind } from "./deadline";
import { rateLimits } from "./limits";
import { errorNameOf, logEvent } from "./log";
import { derivedKey, getRedisClients, hmacId, keyPrefix } from "./redis";

type Env = Readonly<Record<string, string | undefined>>;

/** The label of the client-id HMAC key (src/server/redis.ts derivedKey). */
export const CLIENT_ID_LABEL = "client-id/v1";

export interface RateVerdict {
  allowed: boolean;
  /** Seconds left in the client's window (a refusal's Retry-After). */
  retryAfterS: number;
  /** This is the first refusal this process made for the client in this window (it's logged; later ones aren't). */
  firstRefusal: boolean;
}

export interface RateLimiter {
  /** Counts one request of `client` (clientKey) to a route of `kind` and says whether it may go on. Never rejects. */
  check(kind: RouteKind, client: string, now?: number): Promise<RateVerdict>;
}

export type KindLimits = Readonly<Record<RouteKind, { readonly limit: number; readonly windowS: number }>>;

// ---------------------------------------------------------------------------------------------
// The client

/** The client's IP address as the request carries it (see the header), or undefined. */
export function clientIp(request: Request): string | undefined {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || undefined;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4(text: string): string | undefined {
  const m = IPV4.exec(text);
  if (!m) return undefined;
  const parts = m.slice(1, 5).map(Number);
  return parts.every((p) => p <= 255) ? parts.join(".") : undefined;
}

/** An IPv6 address's 8 groups (lower case, no leading zeros), or undefined when it isn't one. */
export function ipv6Groups(text: string): string[] | undefined {
  let s = text;
  // An embedded IPv4 tail (::ffff:1.2.3.4, 64:ff9b::1.2.3.4) becomes two groups.
  const tail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (tail) {
    const v4 = ipv4(tail[2] ?? "");
    if (!v4) return undefined;
    const [a, b, c, d] = v4.split(".").map(Number) as [number, number, number, number];
    s = `${tail[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return undefined;
  const parse = (part: string): string[] | undefined => {
    if (part === "") return [];
    const groups = part.split(":");
    return groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g)) ? groups.map((g) => Number.parseInt(g, 16).toString(16)) : undefined;
  };
  const head = parse(halves[0] ?? "");
  const rest = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if (!head || !rest) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;
  const missing = 8 - head.length - rest.length;
  return missing >= 1 ? [...head, ...Array.from({ length: missing }, () => "0"), ...rest] : undefined;
}

/**
 * The bucket an address counts in (see the header): an IPv4 address as is (also when sent as ::ffff:a.b.c.d, or with a
 * port), an IPv6 address as its /64 ("2001:db8:1:2::/64"), "unknown" for none or anything unreadable.
 */
export function ipBucket(ip: string | undefined): string {
  if (!ip) return "unknown";
  let s = ip.trim().toLowerCase();
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    s = end > 0 ? s.slice(1, end) : s.slice(1);
  }
  s = s.replace(/%.*$/, ""); // an IPv6 zone
  const v4 = ipv4(s) ?? ipv4(s.replace(/:\d+$/, "")) ?? ipv4(s.replace(/^::ffff:/, ""));
  if (v4) return v4;
  const groups = s.includes(":") ? ipv6Groups(s) : undefined;
  if (!groups) return "unknown";
  // An IPv4-mapped address written in hex (::ffff:7f00:1) is the IPv4 address it maps.
  if (groups.slice(0, 5).every((g) => g === "0") && groups[5] === "ffff") {
    const hi = Number.parseInt(groups[6] ?? "0", 16);
    const lo = Number.parseInt(groups[7] ?? "0", 16);
    return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
  }
  return `${groups.slice(0, 4).join(":")}::/64`;
}

/** This process's own HMAC key, for client ids without SESSION_SECRET (never stored, never the same twice). */
const PROCESS_KEY = randomBytes(32);

/**
 * The client's id for the limiter (see the header): hmacId(CLIENT_ID_LABEL, bucket) with SESSION_SECRET (the same on every
 * instance, as Redis needs), else an HMAC under this process's random key. Never the address itself.
 */
export function clientKey(request: Request, env: Env = process.env): string {
  const bucket = ipBucket(clientIp(request));
  if (derivedKey(CLIENT_ID_LABEL, env)) return hmacId(CLIENT_ID_LABEL, bucket, env);
  return createHmac("sha256", PROCESS_KEY).update(bucket).digest("base64url").slice(0, 32);
}

// ---------------------------------------------------------------------------------------------
// The process's own windows

/**
 * Calls `sweep(now)` at most once every `everyMs` (on the first call, then when the time has come), so ended windows leave
 * memory soon after they end whenever requests come in (see the header), at a cost bounded by the map's size a minute.
 */
function sweeper(everyMs: number, sweep: (now: number) => void): (now: number) => void {
  let next = Number.NEGATIVE_INFINITY;
  return (now) => {
    if (now < next) return;
    next = now + everyMs;
    sweep(now);
  };
}

/** Fixed windows in this process's memory (see the header). */
export function createMemoryLimiter(opts: { limits?: KindLimits; maxKeys?: number; sweepEveryMs?: number } = {}): RateLimiter & { size(): number } {
  const limits = opts.limits ?? rateLimits;
  const maxKeys = opts.maxKeys ?? rateLimits.memoryMaxKeys;
  const counts = new Map<string, { windowEnd: number; count: number }>();
  const sweep = sweeper(opts.sweepEveryMs ?? rateLimits.sweepEveryMs, (now) => {
    for (const [k, e] of counts) if (e.windowEnd <= now) counts.delete(k);
  });
  return {
    /** Clients this process remembers (tests). */
    size: () => counts.size,
    async check(kind, client, now = Date.now()) {
      sweep(now);
      const { limit, windowS } = limits[kind];
      const windowMs = windowS * 1000;
      const windowEnd = (Math.floor(now / windowMs) + 1) * windowMs;
      const key = `${kind}:${client}`;
      let entry = counts.get(key);
      if (!entry || entry.windowEnd !== windowEnd) {
        if (!entry && counts.size >= maxKeys) {
          for (const [k, e] of counts) if (e.windowEnd <= now) counts.delete(k);
          // Still full: the clients whose window began longest ago go (their counts start again; memory stays bounded).
          for (const k of counts.keys()) {
            if (counts.size < maxKeys) break;
            counts.delete(k);
          }
        }
        entry = { windowEnd, count: 0 };
        counts.delete(key);
        counts.set(key, entry);
      }
      entry.count += 1;
      return { allowed: entry.count <= limit, retryAfterS: Math.max(1, Math.ceil((windowEnd - now) / 1000)), firstRefusal: entry.count === limit + 1 };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Shared windows (Redis)

/** The Redis client @upstash/ratelimit takes (the SDK's own: src/server/redis.ts getRedisClients().raw). */
export type RatelimitRedis = ConstructorParameters<typeof Ratelimit>[0]["redis"];

export interface SharedLimiterOptions {
  /** Key prefix (keyPrefix()); "rl:<kind>" follows. */
  prefix: string;
  limits?: KindLimits;
  /** Where checks go while Redis is down or slow (default: this process's own windows). */
  fallback?: RateLimiter;
  timeoutMs?: number;
  redisRetryAfterMs?: number;
  sweepEveryMs?: number;
}

/** Fixed windows shared through Redis with @upstash/ratelimit (see the header). */
export function createSharedLimiter(redis: RatelimitRedis, opts: SharedLimiterOptions): RateLimiter & { refusedInMemory(): number } {
  const limits = opts.limits ?? rateLimits;
  const fallback = opts.fallback ?? createMemoryLimiter({ limits });
  const timeoutMs = opts.timeoutMs ?? rateLimits.timeoutMs;
  const retryAfterMs = opts.redisRetryAfterMs ?? rateLimits.redisRetryAfterMs;
  const limiters = new Map<RouteKind, Ratelimit>();
  /**
   * Each kind's ephemeral cache (@upstash/ratelimit's: a refused client's key → its window's end), ours so ended windows
   * can be swept (the library drops one only when that client is checked again).
   */
  const refused = new Map<RouteKind, Map<string, number>>();
  let redisDownUntil = Number.NEGATIVE_INFINITY;
  const sweep = sweeper(opts.sweepEveryMs ?? rateLimits.sweepEveryMs, (now) => {
    for (const blocked of refused.values()) for (const [k, reset] of blocked) if (reset <= now) blocked.delete(k);
  });

  const limiterFor = (kind: RouteKind): Ratelimit => {
    let limiter = limiters.get(kind);
    if (!limiter) {
      const { limit, windowS } = limits[kind];
      const blocked = new Map<string, number>();
      refused.set(kind, blocked);
      limiter = new Ratelimit({
        redis,
        limiter: Ratelimit.fixedWindow(limit, `${windowS} s`),
        prefix: `${opts.prefix}rl:${kind}`,
        ephemeralCache: blocked,
        analytics: false,
        timeout: timeoutMs,
        enableTelemetry: false,
      });
      limiters.set(kind, limiter);
    }
    return limiter;
  };

  const failOpen = (kind: RouteKind, client: string, now: number, event: string, err?: unknown): Promise<RateVerdict> => {
    redisDownUntil = now + retryAfterMs;
    logEvent({ event, platform: "upstash", ...(err !== undefined ? { errorName: errorNameOf(err) } : {}) });
    return fallback.check(kind, client, now);
  };

  return {
    /** Refused clients this process remembers (tests). */
    refusedInMemory: () => [...refused.values()].reduce((n, m) => n + m.size, 0),
    async check(kind, client, now = Date.now()) {
      sweep(now);
      if (now < redisDownUntil) return fallback.check(kind, client, now);
      try {
        const r = await limiterFor(kind).limit(client);
        if (r.reason === "timeout") return failOpen(kind, client, now, "limiter_timeout");
        return { allowed: r.success, retryAfterS: Math.max(1, Math.ceil((r.reset - now) / 1000)), firstRefusal: !r.success && r.reason !== "cacheBlock" };
      } catch (err) {
        return failOpen(kind, client, now, "limiter_error", err);
      }
    },
  };
}

let processLimiterInstance: RateLimiter | undefined;

/**
 * The process's limiter (see the header): on Vercel, shared through Redis when it's configured (src/server/redis.ts);
 * anywhere else, or when the Redis client can't be built (logged by its error's name only), this process's own windows.
 */
export function processLimiter(env: Env = process.env): RateLimiter {
  if (env !== process.env) return buildProcessLimiter(env); // tests: never memoized
  processLimiterInstance ??= buildProcessLimiter(env);
  return processLimiterInstance;
}

function buildProcessLimiter(env: Env): RateLimiter {
  if (env.VERCEL) {
    try {
      const { raw } = getRedisClients(env);
      if (raw) return createSharedLimiter(raw, { prefix: keyPrefix(env) });
    } catch (err) {
      logEvent({ event: "redis_config_invalid", platform: "upstash", errorName: errorNameOf(err) });
    }
  }
  return createMemoryLimiter();
}

/** Test hook: forget the process's limiter. */
export function resetProcessLimiterForTests(): void {
  processLimiterInstance = undefined;
}
