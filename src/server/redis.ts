/**
 * The shared store for the public beta (planner reply to Checkpoint 4c, Part B: "Shared server cache: Upstash Redis's free
 * tier through the Vercel Marketplace … hashed keys"). One Redis database serves the server cache (src/server/cache.ts
 * RedisCache), the per-IP rate limits, the daily outbound budgets, the error log and the feedback store.
 *
 * - Configured only on Vercel: the Marketplace integration injects KV_REST_API_URL and KV_REST_API_TOKEN (Upstash's own
 *   names, UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, work too). Locally nothing is set, so the stable copy,
 *   `npm run dev`, the tests and every script keep their local stores and never contact Upstash. A script run without
 *   --live (OFFERSHEET_NETWORK "off", Part A's A5) never gets a client either.
 * - Every key starts with keyPrefix(): `os:<VERCEL_ENV>:` (preview and production share the free plan's one database).
 * - Nothing identifying reaches a key: a cache key (which can hold a league id, a username or a credential scope) and a
 *   client's IP address go in only as hmacId(label, text), an HMAC under a key derived from SESSION_SECRET. Without
 *   SESSION_SECRET (at least 32 characters) there is no client: hashing with a missing secret would be a plain sha256 a
 *   reader of the store could brute-force (a 10-digit league id).
 * - Values are strings (automatic deserialization off), so what each caller stores is exactly what it wrote.
 * - Answers come as plain JSON (responseEncoding off; review CA-2): the SDK's default asks Upstash to base64 every string
 *   it returns and decodes it byte by byte, a third more bytes on every read of values that are already base64 or JSON
 *   text (every value Offer Sheet stores is ASCII or UTF-8 text, which JSON carries exactly).
 * - A network error is retried redisClientLimits.retries times after redisClientLimits.retryBackoffMs (review CA-1: the
 *   SDK's default of 5 retries over about 4 seconds outlasted every caller's own time limit); HTTP errors are never
 *   retried by the SDK. Each caller bounds its own wait (src/server/cache.ts SharedCacheBreaker, the limiter's and the
 *   budget's timeouts).
 * - Upstash's SDK sends telemetry headers by default (runtime, platform, SDK version); they are turned off.
 * ⚠️ Rotating SESSION_SECRET resets sealed sessions, import tokens, cache keys and rate-limit buckets at once (accepted:
 * the cache refills, the limits restart).
 * Server-only in spirit (node:crypto), but it doesn't import "server-only", so tsx scripts (`--live` ones) can use it.
 */
import { createHmac, hkdfSync } from "node:crypto";
import { Redis } from "@upstash/redis";
import { redisClientLimits } from "./limits";

/**
 * The commands Offer Sheet uses, as strings in and out (a subset of @upstash/redis; FakeRedis implements the same), and one
 * transaction made of them (lpushTrimExpire).
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  mget(...keys: string[]): Promise<Array<string | null>>;
  /** SET with an expiry in ms (px) and/or only-if-absent (nx); "OK", or null when nx found the key. */
  set(key: string, value: string, opts?: { px?: number; nx?: boolean }): Promise<"OK" | null>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  lpush(key: string, ...values: string[]): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<"OK">;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  /**
   * LPUSH `values`, LTRIM to the newest `keep` and PEXPIRE `ttlMs`, in one MULTI/EXEC transaction (Upstash's /multi-exec:
   * one request, applied whole or not at all), so a list never outlives its expiry because the PEXPIRE after its LPUSH
   * failed (review FB-R5: the feedback store). Upstash bills the three commands one by one. The list's length after the
   * LPUSH (before the trim).
   */
  lpushTrimExpire(key: string, values: readonly string[], keep: number, ttlMs: number): Promise<number>;
}

type Env = Readonly<Record<string, string | undefined>>;

/** The shortest SESSION_SECRET iron-session accepts (src/server/session.ts), and so the shortest root for derived keys. */
export const MIN_SECRET_CHARS = 32;

/** The environment variable pairs a Redis REST endpoint can come from, in order (Upstash's names, then the Marketplace's). */
const URL_VARS = ["UPSTASH_REDIS_REST_URL", "KV_REST_API_URL"] as const;
const TOKEN_VARS = ["UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN"] as const;

function firstSet(env: Env, names: readonly string[]): string | undefined {
  for (const n of names) {
    const v = env[n]?.trim();
    if (v) return v;
  }
  return undefined;
}

/**
 * The variable a `--live` script that reads the shared store on purpose sets ("1": beta:log, feedback:pull). Without it Redis
 * is used on Vercel only, so KV_* values someone puts in .env.local never switch `npm run dev`, the stable copy,
 * check:browser or a test to Upstash (lead, after review RL-5: the callers check VERCEL too; this is the one rule).
 */
export const REDIS_OPT_IN_ENV = "OFFERSHEET_REDIS";

/**
 * True when this process may use Redis: on Vercel (or opted in, REDIS_OPT_IN_ENV), an endpoint and token are set,
 * SESSION_SECRET is long enough, and the network is on.
 */
export function redisConfigured(env: Env = process.env): boolean {
  if (env.OFFERSHEET_NETWORK === "off") return false;
  if (!env.VERCEL && env[REDIS_OPT_IN_ENV] !== "1") return false;
  if ((env.SESSION_SECRET ?? "").length < MIN_SECRET_CHARS) return false;
  return Boolean(firstSet(env, URL_VARS) && firstSet(env, TOKEN_VARS));
}

/** An adapter from @upstash/redis to RedisLike (its option objects differ from Redis's argument order). */
function wrap(client: Redis): RedisLike {
  return {
    get: (key) => client.get<string>(key),
    mget: (...keys) => (keys.length ? client.mget<Array<string | null>>(...keys) : Promise.resolve([])),
    async set(key, value, opts = {}) {
      const res = opts.nx
        ? opts.px !== undefined
          ? await client.set(key, value, { nx: true, px: opts.px })
          : await client.set(key, value, { nx: true })
        : opts.px !== undefined
          ? await client.set(key, value, { px: opts.px })
          : await client.set(key, value);
      return res === "OK" ? "OK" : null;
    },
    del: (...keys) => (keys.length ? client.del(...keys) : Promise.resolve(0)),
    incr: (key) => client.incr(key),
    pexpire: (key, ms) => client.pexpire(key, ms),
    lpush: (key, ...values) => client.lpush(key, ...values),
    ltrim: (key, start, stop) => client.ltrim(key, start, stop) as Promise<"OK">,
    lrange: (key, start, stop) => client.lrange<string>(key, start, stop),
    async lpushTrimExpire(key, values, keep, ttlMs) {
      // multi(): Upstash's transaction endpoint (a pipeline() would not be atomic); exec() throws if any command failed.
      const [length] = await client
        .multi()
        .lpush(key, ...values)
        .ltrim(key, 0, keep - 1)
        .pexpire(key, ttlMs)
        .exec();
      return length;
    },
  };
}

let cached: { client: RedisLike | null; raw: Redis | null } | undefined;

/**
 * The process's Redis client, or null when not configured (redisConfigured). One per process. `raw` is for
 * @upstash/ratelimit, which takes the SDK's own client.
 */
export function getRedisClients(env: Env = process.env): { client: RedisLike | null; raw: Redis | null } {
  if (env !== process.env) return build(env); // tests: never memoized
  cached ??= build(env);
  return cached;
}

function build(env: Env): { client: RedisLike | null; raw: Redis | null } {
  if (!redisConfigured(env)) return { client: null, raw: null };
  // A malformed address (for example the rediss:// connection string, with its password, pasted into KV_REST_API_URL)
  // makes the SDK throw UrlError here, whose message holds the address: every caller (deps.ts selectServerCache, the
  // limiter, the budget, the log store) catches it, logs only its name (redis_config_invalid) and runs without the store.
  const raw = new Redis({
    url: firstSet(env, URL_VARS),
    token: firstSet(env, TOKEN_VARS),
    automaticDeserialization: false,
    enableTelemetry: false,
    responseEncoding: false,
    retry: { retries: redisClientLimits.retries, backoff: () => redisClientLimits.retryBackoffMs },
  });
  return { client: wrap(raw), raw };
}

export function getRedis(env: Env = process.env): RedisLike | null {
  return getRedisClients(env).client;
}

/** Test hook: forget the memoized client (the next getRedis() reads the environment again). */
export function resetRedisForTests(): void {
  cached = undefined;
}

/** `os:<VERCEL_ENV>:` (production, preview, development) or `os:local:` off Vercel. */
export function keyPrefix(env: Env = process.env): string {
  const scope = (env.VERCEL_ENV ?? "").trim().toLowerCase();
  return `os:${/^[a-z]+$/.test(scope) ? scope : "local"}:`;
}

const derived = new Map<string, Buffer>();

/**
 * A 32-byte key for one use (`label`, e.g. "cache-key/v1"), derived from SESSION_SECRET with HKDF-SHA256, or null
 * when SESSION_SECRET is missing or too short. Memoized per secret and label.
 */
export function derivedKey(label: string, env: Env = process.env): Buffer | null {
  const secret = env.SESSION_SECRET ?? "";
  if (secret.length < MIN_SECRET_CHARS) return null;
  const memo = `${label}\u0000${secret}`;
  let key = derived.get(memo);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", secret, "offersheet", label, 32));
    derived.set(memo, key);
  }
  return key;
}

/**
 * base64url(HMAC-SHA256(derivedKey(label), text)), first 32 characters (192 bits): how a cache key, a client's IP
 * address or any other identifying text goes into a Redis key. Throws without SESSION_SECRET (callers only reach it
 * when redisConfigured() or the secret was checked).
 */
export function hmacId(label: string, text: string, env: Env = process.env): string {
  const key = derivedKey(label, env);
  if (!key) throw new Error("SESSION_SECRET is missing or too short");
  return createHmac("sha256", key).update(text).digest("base64url").slice(0, 32);
}

/**
 * In-memory RedisLike for tests and offline measurements: string values with PX expiry on an injected clock, lists,
 * and counters of the commands and bytes each command moved (what Upstash bills: commands and bandwidth).
 */
export class FakeRedis implements RedisLike {
  private store = new Map<string, { value: string | string[]; expiresAt?: number }>();
  readonly stats = { commands: 0, bytesIn: 0, bytesOut: 0 };

  constructor(private readonly clock: () => number = () => Date.now()) {}

  private live(key: string): { value: string | string[]; expiresAt?: number } | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== undefined && this.clock() >= e.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return e;
  }

  private count(...sent: string[]): void {
    this.stats.commands++;
    for (const s of sent) this.stats.bytesIn += Buffer.byteLength(s);
  }

  async get(key: string): Promise<string | null> {
    this.count(key);
    const e = this.live(key);
    const v = e && typeof e.value === "string" ? e.value : null;
    if (v) this.stats.bytesOut += Buffer.byteLength(v);
    return v;
  }

  async mget(...keys: string[]): Promise<Array<string | null>> {
    this.count(...keys);
    return keys.map((k) => {
      const e = this.live(k);
      const v = e && typeof e.value === "string" ? e.value : null;
      if (v) this.stats.bytesOut += Buffer.byteLength(v);
      return v;
    });
  }

  async set(key: string, value: string, opts: { px?: number; nx?: boolean } = {}): Promise<"OK" | null> {
    this.count(key, value);
    if (opts.nx && this.live(key)) return null;
    this.store.set(key, { value, ...(opts.px !== undefined ? { expiresAt: this.clock() + opts.px } : {}) });
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    this.count(...keys);
    let n = 0;
    for (const k of keys) if (this.live(k) && this.store.delete(k)) n++;
    return n;
  }

  async incr(key: string): Promise<number> {
    this.count(key);
    const e = this.live(key);
    const next = (e && typeof e.value === "string" ? Number(e.value) : 0) + 1;
    this.store.set(key, { value: String(next), ...(e?.expiresAt !== undefined ? { expiresAt: e.expiresAt } : {}) });
    return next;
  }

  async pexpire(key: string, ms: number): Promise<number> {
    this.count(key);
    const e = this.live(key);
    if (!e) return 0;
    e.expiresAt = this.clock() + ms;
    return 1;
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    this.count(key, ...values);
    const e = this.live(key);
    const list = e && Array.isArray(e.value) ? e.value : [];
    list.unshift(...[...values].reverse());
    this.store.set(key, { value: list, ...(e?.expiresAt !== undefined ? { expiresAt: e.expiresAt } : {}) });
    return list.length;
  }

  async ltrim(key: string, start: number, stop: number): Promise<"OK"> {
    this.count(key);
    const e = this.live(key);
    if (e && Array.isArray(e.value)) e.value = FakeRedis.trimmed(e.value, start, stop);
    return "OK";
  }

  /** LTRIM's rule: the elements from `start` to `stop`, both included, negative counting from the end. */
  private static trimmed(list: string[], start: number, stop: number): string[] {
    const n = list.length;
    const from = start < 0 ? Math.max(0, n + start) : start;
    const to = stop < 0 ? n + stop : Math.min(stop, n - 1);
    return from > to ? [] : list.slice(from, to + 1);
  }

  /**
   * RedisLike.lpushTrimExpire: the transaction applied whole in one step (it never calls the single commands, so a test
   * that makes one of them fail can't split it), its 3 commands counted as Upstash bills them.
   */
  async lpushTrimExpire(key: string, values: readonly string[], keep: number, ttlMs: number): Promise<number> {
    this.count(key, ...values);
    this.count(key);
    this.count(key);
    const e = this.live(key);
    const list = e && Array.isArray(e.value) ? [...e.value] : [];
    list.unshift(...[...values].reverse());
    this.store.set(key, { value: FakeRedis.trimmed(list, 0, keep - 1), expiresAt: this.clock() + ttlMs });
    return list.length;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    this.count(key);
    const e = this.live(key);
    if (!e || !Array.isArray(e.value)) return [];
    const n = e.value.length;
    const from = start < 0 ? Math.max(0, n + start) : start;
    const to = stop < 0 ? n + stop : Math.min(stop, n - 1);
    const out = from > to ? [] : e.value.slice(from, to + 1);
    for (const v of out) this.stats.bytesOut += Buffer.byteLength(v);
    return out;
  }

  /** Keys currently stored and not expired (tests: e.g. assert no raw id reached a key). */
  keys(): string[] {
    return [...this.store.keys()].filter((k) => this.live(k));
  }

  /** The time-to-live left on a key in ms, or undefined without one (tests). */
  ttlMs(key: string): number | undefined {
    const e = this.live(key);
    return e?.expiresAt === undefined ? undefined : e.expiresAt - this.clock();
  }
}
