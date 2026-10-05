/**
 * Server-side cache (CLAUDE.md §3 Cache, §2.10). A small interface with a file implementation for
 * development (.cache/app/, git-ignored) and, for the public beta (planner reply to Checkpoint 4c, Part B, B1: "Shared
 * server cache … single-flight fetches, hashed keys, private-league data keyed by a credential hash"; track CA), a
 * shared store: Upstash Redis (RedisCache) behind a per-instance memory tier (MemoryLruCache, TieredCache), plus a
 * cross-instance lock for league-independent entries (RedisCacheLock). src/app/api/_lib/deps.ts picks one in one place:
 * Redis configured → TieredCache(MemoryLruCache, RedisCache); on Vercel without it → MemoryLruCache alone; else (this
 * computer: the stable copy, `npm run dev`, scripts, tests) FileCache as before.
 *
 * - Filenames are sha256(key): keys contain ':' '?' etc. that Windows forbids, and may contain IDs.
 * - Private-league entries (ESPN with cookies, MFL with a login, Yahoo) must include
 *   credentialScope(...) in their key, never the league ID alone.
 * - Every entry is stored with a retention and DELETED once it passes (on read, and by a sweep that
 *   runs at most once a minute), so the privacy page's "kept for about 10 minutes" is true. In Redis the key's own expiry
 *   (PX, the entry's retention) deletes it. In the memory tier an expired copy is never served: a read deletes it, and so
 *   does a sweep, at most once a minute on any read or write and on a timer every minute while the process runs; ⚠️ an
 *   instance paused between requests (Vercel) runs no timer, so it holds an expired copy until it runs again or stops
 *   (review CA-8).
 * - Redis keys hide what they're for: prefix + "c:" + an HMAC of the cache key under a key derived from SESSION_SECRET
 *   (src/server/redis.ts hmacId), so no league id, username or credential scope reaches Upstash in a key. Values are
 *   the same envelope FileCache writes ({storedAt, expiresAt, value}), JSON → gzip → base64.
 * - A Redis that's slow or down never holds a request up (review CA-1; SharedCacheBreaker): every command waits at most
 *   cacheLimits.redisTimeoutMs, and the first failure leaves Redis alone for cacheLimits.redisRetryAfterMs, during which
 *   the memory tier serves alone and the lock lets every fetch through.
 * - ⚠️ Per instance, not shared (documented, accepted): the memory tier itself, the in-process single-flight
 *   (src/server/http.ts), the Sleeper and FantasyCalc outage memories (src/data/sleeperProjections.ts sleeperGate,
 *   src/data/fantasyCalcValues.ts fantasyCalcGate, which also remembers the FantasyCalc answers its checks turned down for
 *   TTL.fantasyCalc) and the player-ID crosswalk's memo (src/data/load.ts): each new
 *   instance builds its own from the shared copies, and each probes a source that's down once for itself.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { config } from "@/engine/config";
import { cacheLimits } from "./limits";
import { errorNameOf, logEvent, withTimeout } from "./log";
import { derivedKey, hmacId, keyPrefix, type RedisLike } from "./redis";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Refresh intervals from §2.10. */
export const TTL = {
  sleeperPlayers: DAY,
  /**
   * Each format's FantasyCalc value list: FantasyCalc's conditions for free use (their reply of 2026-10-05,
   * reports/fantasycalc-permission.md: their values update every 3 hours, so refresh "at most once every 3 hours, and only
   * when someone needs it"); a day before. Only a model build that reads a list asks for it (nothing refreshes in the
   * background), and copies are still kept FANTASYCALC_RETAIN_MS as the outage fallback.
   */
  fantasyCalc: 3 * HOUR,
  idMap: DAY,
  nflSchedule: 7 * DAY,
  /**
   * Weekly projections of past weeks, the current NFL week and the next PROJECTIONS_NEAR_WEEKS; also
   * Sleeper's season projections and actual stats (§2.10).
   */
  projections: 6 * HOUR,
  /** Weekly projections of later NFL weeks (§2.10, Checkpoint 2: each week is its own cache entry). */
  projectionsLater: DAY,
  league: 10 * MINUTE,
  /** League data when the user presses Refresh: still at most one fetch a minute, so the button can't flood a platform. */
  leagueRefresh: MINUTE,
  /** Transactions of scoring periods that ended over a week ago (they rarely change; Refresh doesn't shorten this). */
  closedTransactions: 6 * HOUR,
  /** Fleaflicker's public HTML rules page (planner reply 13). */
  rulesPage: DAY,
} as const;

/**
 * Weeks after the current NFL week whose projections still refresh every TTL.projections (§2.10: "the
 * current NFL week and the next 2"); later weeks refresh every TTL.projectionsLater.
 */
export const PROJECTIONS_NEAR_WEEKS = 2;

/**
 * Public, league-independent sources (player lists, ID maps, the NFL schedule) are kept this long so
 * a stale copy can stand in while the source is down (HttpRequestOptions.cache.staleIfError).
 */
export const STALE_PUBLIC_RETAIN_MS = 7 * DAY;

/**
 * FantasyCalc's value lists are kept longer (Phase 4c; planner reply to Checkpoint 4b, change 12): config.market.
 * fantasyCalcCurveDays (90) days, through this Cache like every other entry (a KV store in production keeps them the same
 * way; the dev-only archive in data-local/ is never read for it). A copy is still served fresh only within
 * TTL.fantasyCalc (3 hours since FantasyCalc's conditions of 2026-10-05: at most one request every 3 hours per format, and
 * only when a build needs it) and otherwise only when FantasyCalc fails
 * (staleIfError); src/server/modelInputs.ts decides what an old copy may do: stand in for up to fantasyCalcStaleDays (7),
 * then only calibrate the model's own value curve (src/data/fantasyCalcValues.ts fantasyCalcListUse). Public data, about
 * 150–330 KB per format.
 */
export const FANTASYCALC_RETAIN_MS = config.market.fantasyCalcCurveDays * DAY;

/** Cache TTL for league data (settings, rosters, transactions): 10 minutes, or 1 minute after Refresh. */
export function leagueTtl(refresh?: boolean): number {
  return refresh ? TTL.leagueRefresh : TTL.league;
}

export interface CacheEntry<T> {
  value: T;
  /** Epoch ms when it was stored. */
  storedAt: number;
  /** Epoch ms after which it is deleted. */
  expiresAt: number;
}

export interface Cache {
  /**
   * The entry under key if it was stored less than maxAgeMs ago and hasn't expired. An expired entry is never served, and
   * is deleted: by the read (the file and memory caches), or by the store's own clock at the end of its retention (Redis).
   */
  get<T>(key: string, maxAgeMs: number, now?: number): Promise<CacheEntry<T> | undefined>;
  /** Store a value; it is deleted once retainMs has passed. */
  set<T>(key: string, value: T, retainMs: number, now?: number): Promise<void>;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** A short, non-reversible scope for private-data keys (never store or log the credentials). */
export function credentialScope(...parts: Array<string | undefined>): string {
  return "cred-" + sha256(parts.map((p) => p ?? "").join("\u0000")).slice(0, 16);
}

interface Envelope<T> {
  storedAt: number;
  /** Missing in entries written before retention existed (treated as stored for a day). */
  expiresAt?: number;
  value: T;
}

/** Entries written before retention existed are kept at most this long. */
const LEGACY_RETAIN_MS = DAY;
const SWEEP_EVERY_MS = MINUTE;
/** A temp file older than this is left over from a crashed write. */
const STALE_TEMP_MS = HOUR;

function expiryOf(env: Envelope<unknown>): number {
  return env.expiresAt ?? env.storedAt + LEGACY_RETAIN_MS;
}

export class FileCache implements Cache {
  private lastSweep = Number.NEGATIVE_INFINITY;
  private sweeping: Promise<void> | undefined;

  /**
   * `sweepEveryMs`: also sweep on a timer (unref'd, so it never keeps the process alive), so expired
   * entries go even when no request comes in; null turns the timer off (tests).
   */
  constructor(
    readonly dir: string = path.join(process.cwd(), ".cache", "app"),
    opts: { sweepEveryMs?: number | null } = {},
  ) {
    const every = opts.sweepEveryMs === undefined ? SWEEP_EVERY_MS : opts.sweepEveryMs;
    if (every !== null) {
      const timer = setInterval(() => void this.sweepIfDue(Date.now()), every);
      timer.unref?.();
    }
  }

  private file(key: string): string {
    return path.join(this.dir, `${sha256(key)}.json`);
  }

  async get<T>(key: string, maxAgeMs: number, now: number = Date.now()): Promise<CacheEntry<T> | undefined> {
    await this.sweepIfDue(now);
    const file = this.file(key);
    let env: Envelope<T>;
    try {
      env = JSON.parse(await readFile(file, "utf8")) as Envelope<T>;
    } catch {
      return undefined;
    }
    if (typeof env.storedAt !== "number") return undefined;
    const expiresAt = expiryOf(env);
    if (now >= expiresAt) {
      await rm(file, { force: true }).catch(() => {});
      return undefined;
    }
    return now - env.storedAt <= maxAgeMs ? { value: env.value, storedAt: env.storedAt, expiresAt } : undefined;
  }

  async set<T>(key: string, value: T, retainMs: number, now: number = Date.now()): Promise<void> {
    await this.sweepIfDue(now);
    const file = this.file(key);
    const expiresAt = now + Math.max(0, retainMs);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    await writeFile(tmp, JSON.stringify({ storedAt: now, expiresAt, value } satisfies Envelope<T>), "utf8");
    // Windows: a concurrent reader can briefly lock the target.
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, file);
        break;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (attempt >= 5 || !(code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
          await rm(tmp, { force: true });
          throw err;
        }
        await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      }
    }
    // The file's mtime holds its expiry, so the sweep can skip live entries without reading them.
    await utimes(file, new Date(now), new Date(expiresAt)).catch(() => {});
  }

  /** Delete expired entries and leftover temp files, at most once a minute. Never throws. */
  sweepIfDue(now: number): Promise<void> {
    if (this.sweeping) return this.sweeping;
    if (now - this.lastSweep < SWEEP_EVERY_MS) return Promise.resolve();
    this.lastSweep = now;
    this.sweeping = this.sweep(now).finally(() => (this.sweeping = undefined));
    return this.sweeping;
  }

  private async sweep(now: number): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return; // no cache folder yet
    }
    for (const name of names) {
      const file = path.join(this.dir, name);
      try {
        const st = await stat(file);
        if (!st.isFile()) continue;
        if (name.includes(".tmp-")) {
          if (now - st.mtimeMs > STALE_TEMP_MS) await rm(file, { force: true });
          continue;
        }
        if (!name.endsWith(".json") || st.mtimeMs > now) continue; // mtime = expiry, still ahead
        const env = JSON.parse(await readFile(file, "utf8")) as Envelope<unknown>;
        const expiresAt = expiryOf(env);
        if (now >= expiresAt) await rm(file, { force: true });
        else await utimes(file, new Date(now), new Date(expiresAt)); // an older entry: stamp its expiry
      } catch {
        // removed or being written concurrently; the next sweep sees it again
      }
    }
  }
}

/** In-memory cache for tests. */
export class MemoryCache implements Cache {
  private store = new Map<string, Required<Envelope<unknown>>>();
  async get<T>(key: string, maxAgeMs: number, now: number = Date.now()): Promise<CacheEntry<T> | undefined> {
    const env = this.store.get(key);
    if (!env) return undefined;
    if (now >= env.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return now - env.storedAt <= maxAgeMs ? { value: env.value as T, storedAt: env.storedAt, expiresAt: env.expiresAt } : undefined;
  }
  async set<T>(key: string, value: T, retainMs: number, now: number = Date.now()): Promise<void> {
    this.store.set(key, { storedAt: now, expiresAt: now + Math.max(0, retainMs), value });
  }
  /** Keys currently stored (tests). */
  keys(): string[] {
    return [...this.store.keys()];
  }
  /** Stored values (tests: e.g. assert nothing secret was cached). */
  values(): unknown[] {
    return [...this.store.values()].map((e) => e.value);
  }
}

// ---------------------------------------------------------------------------------------------
// The shared cache (planner reply to Checkpoint 4c, Part B, B1; track CA; see the header)

type Env = Readonly<Record<string, string | undefined>>;

/** The HKDF label of the key that hides cache keys (and their locks) in Redis (src/server/redis.ts derivedKey). */
export const CACHE_KEY_LABEL = "cache-key/v1";

/**
 * A rough size in bytes of a value the memory tier holds (its budget, cacheLimits.memoryBytes): the HTTP client's entries
 * by their text's length (the body, almost all of it), anything else by its JSON length.
 */
export function estimateBytes(value: unknown): number {
  if (typeof value === "string") return value.length + 64;
  if (value && typeof value === "object") {
    const text = (value as { text?: unknown }).text;
    if (typeof text === "string") return text.length + 256;
  }
  try {
    return (JSON.stringify(value)?.length ?? 0) + 64;
  } catch {
    return 1024;
  }
}

interface MemoryEntry extends Required<Envelope<unknown>> {
  bytes: number;
}

/** A memory tier (TieredCache's first): a Cache that can also take another tier's copy of an entry as it is. */
export interface MemoryTier extends Cache {
  /**
   * Keeps `entry`, another tier's copy of the key (its own storedAt and expiresAt), unless this tier already holds one at
   * least as new, which it keeps: returns the copy this tier holds after, or undefined when it holds none (`entry` has
   * expired by `now`, or is larger than the whole tier).
   */
  fill<T>(key: string, entry: CacheEntry<T>, now?: number): CacheEntry<T> | undefined;
}

/**
 * The per-instance memory tier: entries in this process's memory, at most `maxBytes` of them by estimateBytes (the least
 * recently used go first). An expired entry is never served: a read deletes it, and so does a sweep, at most once a minute
 * on any read or write and, with `sweepEveryMs` (src/app/api/_lib/deps.ts sets it), on a timer while the process runs
 * (unref'd: it never keeps a process alive; review CA-8). ⚠️ An instance paused between requests (Vercel) runs no timer:
 * it holds an expired entry, never served, until it runs again or stops. It keeps the Cache contract exactly. An entry
 * larger than the whole tier isn't kept. On Vercel without Redis it is the only cache; with Redis it sits in front of it
 * (TieredCache).
 */
export class MemoryLruCache implements MemoryTier {
  private readonly store = new Map<string, MemoryEntry>();
  private total = 0;
  private lastSweep = Number.NEGATIVE_INFINITY;

  constructor(
    readonly maxBytes: number = cacheLimits.memoryBytes,
    opts: { sweepEveryMs?: number | null } = {},
  ) {
    const every = opts.sweepEveryMs ?? null;
    if (every !== null) {
      const timer = setInterval(() => this.sweepIfDue(Date.now()), every);
      timer.unref?.();
    }
  }

  /** The estimated bytes held now (tests, measurements). */
  get bytes(): number {
    return this.total;
  }

  /** Keys held now, least recently used first (tests). */
  keys(): string[] {
    return [...this.store.keys()];
  }

  private drop(key: string, entry: MemoryEntry): void {
    if (this.store.get(key) !== entry) return;
    this.store.delete(key);
    this.total -= entry.bytes;
  }

  /** Deletes expired entries, at most once a minute (by the caller's clock, as FileCache does). */
  private sweepIfDue(now: number): void {
    if (now - this.lastSweep < SWEEP_EVERY_MS) return;
    this.lastSweep = now;
    for (const [key, entry] of this.store) if (now >= entry.expiresAt) this.drop(key, entry);
  }

  async get<T>(key: string, maxAgeMs: number, now: number = Date.now()): Promise<CacheEntry<T> | undefined> {
    this.sweepIfDue(now);
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (now >= entry.expiresAt) {
      this.drop(key, entry);
      return undefined;
    }
    if (now - entry.storedAt > maxAgeMs) return undefined;
    // Most recently used last.
    this.store.delete(key);
    this.store.set(key, entry);
    return { value: entry.value as T, storedAt: entry.storedAt, expiresAt: entry.expiresAt };
  }

  async set<T>(key: string, value: T, retainMs: number, now: number = Date.now()): Promise<void> {
    this.sweepIfDue(now);
    this.put(key, value, now, now + Math.max(0, retainMs));
  }

  fill<T>(key: string, entry: CacheEntry<T>, now: number = Date.now()): CacheEntry<T> | undefined {
    this.sweepIfDue(now);
    const held = this.store.get(key);
    if (held && now < held.expiresAt && held.storedAt >= entry.storedAt) {
      // A copy at least as new (this instance's own write while another tier was read): kept, and used most recently.
      this.store.delete(key);
      this.store.set(key, held);
      return { value: held.value as T, storedAt: held.storedAt, expiresAt: held.expiresAt };
    }
    if (now >= entry.expiresAt) return undefined;
    this.put(key, entry.value, entry.storedAt, entry.expiresAt);
    return this.store.has(key) ? { value: entry.value, storedAt: entry.storedAt, expiresAt: entry.expiresAt } : undefined;
  }

  /** Stores an entry with its own times in place of the key's copy, then drops the least recently used past maxBytes. */
  private put(key: string, value: unknown, storedAt: number, expiresAt: number): void {
    const old = this.store.get(key);
    if (old) this.drop(key, old);
    const bytes = estimateBytes(value);
    if (bytes > this.maxBytes) return;
    this.store.set(key, { storedAt, expiresAt, value, bytes });
    this.total += bytes;
    for (const [k, e] of this.store) {
      if (this.total <= this.maxBytes) break;
      this.drop(k, e);
    }
  }
}

/**
 * Two tiers as one Cache: reads try `l1` (this instance's memory) and then `l2` (Redis), keeping what `l2` had in `l1`
 * for that entry's remaining retention (same storedAt and expiresAt, so every caller's maxAge reads it as before), unless
 * `l1` got a copy at least as new while `l2` was read (this instance's own write: a Refresh's fetch), which it keeps and
 * serves instead (MemoryTier.fill; review CA-4: an older copy never replaces a newer one in memory). Writes go to both,
 * `l1` first, so a failed `l2` write still leaves the copy in this instance and reaches the caller like a FileCache write
 * failure (the HTTP client logs it by name and serves the response). ⚠️ An instance can serve its own copy while another
 * instance has stored a newer one, within the reader's own maxAge only (a Refresh's 1 minute reads Redis again).
 */
export class TieredCache implements Cache {
  constructor(
    readonly l1: MemoryTier,
    readonly l2: Cache,
  ) {}

  async get<T>(key: string, maxAgeMs: number, now: number = Date.now()): Promise<CacheEntry<T> | undefined> {
    try {
      const hit = await this.l1.get<T>(key, maxAgeMs, now);
      if (hit) return hit;
    } catch {
      // the memory tier never throws; belt and braces
    }
    let entry: CacheEntry<T> | undefined;
    try {
      entry = await this.l2.get<T>(key, maxAgeMs, now);
    } catch {
      return undefined; // an unreadable shared cache is a miss
    }
    if (!entry) return undefined;
    try {
      return this.l1.fill(key, entry, now) ?? entry;
    } catch {
      return entry;
    }
  }

  async set<T>(key: string, value: T, retainMs: number, now: number = Date.now()): Promise<void> {
    await this.l1.set(key, value, retainMs, now);
    await this.l2.set(key, value, retainMs, now);
  }
}

/** An entry too large for the shared cache (cacheLimits.maxEntryBytes as stored): not written; the HTTP client logs this name. */
export class CacheEntryTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`a cache entry of ${bytes} bytes is over the shared cache's limit`);
    this.name = "CacheEntryTooLarge";
  }
}

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * The derivedKey label (src/server/redis.ts) of the key that encrypts the shared cache's values. v2 since the final review
 * (SEC-5): each value is bound to the Redis key it's stored under (below), and v1's values, which weren't, read as misses.
 */
export const CACHE_ENC_LABEL = "cache-enc/v2";
/** An encrypted value: this prefix, then base64(12-byte IV | 16-byte GCM tag | ciphertext of the gzipped envelope). */
const ENCRYPTED_PREFIX = "e2.";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * How an entry is stored in Redis: the envelope as JSON, gzipped (level 6), then with `key` encrypted with AES-256-GCM
 * (a random IV per value; lead, Checkpoint 7a: the free plan has no encryption at rest, and a private ESPN league's body
 * names its members, so Upstash holds only ciphertext it can't read), as text (Upstash's REST API carries text). The
 * Redis key it's stored under (`storeKey`) is the cipher's additional authenticated data (final review SEC-5: without it,
 * whoever holds the database's token could move a private league's value onto a public league's key, and the app would
 * decrypt it and serve it to that league's visitors), so a value read under any other key fails the tag check. Without a
 * key (measurements and tests), plain base64 of the gzip.
 */
export async function encodeSharedEntry(envelope: { storedAt: number; expiresAt: number; value: unknown }, key?: Buffer | null, storeKey = ""): Promise<string> {
  const packed = await gzipAsync(Buffer.from(JSON.stringify(envelope), "utf8"), { level: 6 });
  if (!key) return packed.toString("base64");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(storeKey, "utf8"));
  const sealed = Buffer.concat([cipher.update(packed), cipher.final()]);
  return ENCRYPTED_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString("base64");
}

/**
 * The envelope of a stored entry; throws when it isn't one (the caller reads that as a miss): with `key`, only a value
 * encodeSharedEntry encrypted under that key for that `storeKey` (a changed SESSION_SECRET, a tampered or a plain value,
 * or one moved from another key fails the tag check).
 */
export async function decodeSharedEntry<T>(stored: string, key?: Buffer | null, storeKey = ""): Promise<Envelope<T>> {
  let packed: Buffer;
  if (key) {
    if (!stored.startsWith(ENCRYPTED_PREFIX)) throw new TypeError("not an encrypted cache entry");
    const raw = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), "base64");
    if (raw.length < IV_BYTES + TAG_BYTES) throw new TypeError("not an encrypted cache entry");
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(storeKey, "utf8"));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    packed = Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
  } else {
    packed = Buffer.from(stored, "base64");
  }
  return JSON.parse((await gunzipAsync(packed)).toString("utf8")) as Envelope<T>;
}

/** The shared-cache events the breaker reports when a failure starts a pause (src/server/log.ts). */
type SharedCacheEvent = "cache_read_failed" | "cache_lock_failed";

/**
 * How the shared cache treats a Redis that's slow or down (review CA-1: with the SDK's defaults a command to an
 * unreachable Upstash failed only after about 4 s of retries, so imports and model builds ran into their deadline though
 * ESPN and Sleeper answered). Every command RedisCache and RedisCacheLock send waits at most cacheLimits.redisTimeoutMs
 * (a slower one counts as failed; src/server/redis.ts also caps the SDK's own retries), and a failure or a timeout pauses
 * Redis for this process for cacheLimits.redisRetryAfterMs: meanwhile nothing is sent, so reads miss (the memory tier
 * serves what it holds), writes are skipped (the memory tier keeps the copy) and the lock lets every fetch through, as
 * without the shared cache; then the next command asks again. Each pause is reported once, by the error's name only: a
 * read's or a lock command's failure here (cache_read_failed, cache_lock_failed), a write's by the HTTP client that gets
 * its rejection (cache_write_failed), never both. One per process, shared by RedisCache and RedisCacheLock
 * (src/app/api/_lib/deps.ts), so an outage costs one command's wait, not one per command; a test or a measurement may give
 * each its own.
 */
export class SharedCacheBreaker {
  readonly timeoutMs: number;
  readonly retryAfterMs: number;
  private readonly clock: () => number;
  private pausedUntil = Number.NEGATIVE_INFINITY;

  constructor(opts: { timeoutMs?: number; retryAfterMs?: number; clock?: () => number } = {}) {
    this.timeoutMs = opts.timeoutMs ?? cacheLimits.redisTimeoutMs;
    this.retryAfterMs = opts.retryAfterMs ?? cacheLimits.redisRetryAfterMs;
    this.clock = opts.clock ?? (() => Date.now());
  }

  /** Whether Redis may be asked now (false while a failure's pause lasts). */
  get available(): boolean {
    return this.clock() >= this.pausedUntil;
  }

  /**
   * Sends one command and waits at most timeoutMs: its answer, or its failure (a TimeoutError when it was too slow; the
   * command itself may still finish later, unread), which pauses Redis and, when it starts the pause, is reported as
   * `event` (null: the caller's caller reports it).
   */
  async run<T>(command: () => Promise<T>, event: SharedCacheEvent | null): Promise<T> {
    try {
      return await withTimeout(command(), this.timeoutMs);
    } catch (err) {
      const now = this.clock();
      const starts = now >= this.pausedUntil;
      this.pausedUntil = Math.max(this.pausedUntil, now + this.retryAfterMs);
      if (starts && event) logEvent({ event, platform: "upstash", errorName: errorNameOf(err) });
      throw err;
    }
  }
}

/** When this process last reported an entry Redis held that didn't decode (undecodable). */
let lastUndecodable = Number.NEGATIVE_INFINITY;

/**
 * A value in Redis that isn't an entry this code can read (not ours, or damaged): a miss, reported by its error's name at
 * most once per cacheLimits.errorLogEveryMs per process. Not a Redis failure: it doesn't pause Redis.
 */
function undecodable(err: unknown): void {
  const now = Date.now();
  if (now - lastUndecodable < cacheLimits.errorLogEveryMs) return;
  lastUndecodable = now;
  logEvent({ event: "cache_entry_unreadable", platform: "upstash", errorName: errorNameOf(err) });
}

/**
 * The shared cache: Upstash Redis through RedisLike (src/server/redis.ts), keeping FileCache's semantics (the Cache
 * contract: maxAge per caller, retention per entry, an expired entry never served).
 * - Key: keyPrefix() + "c:" + hmacId("cache-key/v1", key): the raw key (league ids, usernames, credential scopes) never
 *   reaches Upstash, and a reader of the store can't test guesses without SESSION_SECRET.
 * - Value: encodeSharedEntry (JSON → gzip → AES-256-GCM under derivedKey(CACHE_ENC_LABEL), a key from SESSION_SECRET,
 *   bound to its Redis key: final review SEC-5 → text), written with SET … PX retention, so Redis deletes it when its
 *   retention ends; a zero retention deletes the key (nothing may be served). An entry over maxEntryBytes as stored isn't
 *   written (CacheEntryTooLargeError; Upstash takes 10 MB a request).
 * - An entry past its retention by the reader's clock is a miss, not deleted here: Redis's own expiry (PX) deletes it, and
 *   a DEL from a reader whose clock runs ahead could delete a newer copy another instance just stored.
 * - Redis slow or down (SharedCacheBreaker): a read is a miss, a write fails once (rejected, like a FileCache write: the
 *   HTTP client logs it by name and serves the response uncached) and is then skipped while the pause lasts (the memory
 *   tier, written first, keeps the copy). A value that doesn't decode is a miss, reported at most once a minute.
 */
export class RedisCache implements Cache {
  private readonly prefix: string;
  private readonly env: Env;
  private readonly maxEntryBytes: number;
  private readonly breaker: SharedCacheBreaker;
  /** The values' encryption key (null without SESSION_SECRET: then nothing is read or written, as storeKey can't be made). */
  private readonly encKey: Buffer | null;

  constructor(
    private readonly redis: RedisLike,
    opts: { env?: Env; maxEntryBytes?: number; breaker?: SharedCacheBreaker } = {},
  ) {
    this.env = opts.env ?? process.env;
    this.encKey = derivedKey(CACHE_ENC_LABEL, this.env);
    this.prefix = keyPrefix(this.env);
    this.maxEntryBytes = opts.maxEntryBytes ?? cacheLimits.maxEntryBytes;
    this.breaker = opts.breaker ?? new SharedCacheBreaker();
  }

  /** The Redis key an entry is stored under (see the class doc). */
  storeKey(key: string): string {
    return `${this.prefix}c:${hmacId(CACHE_KEY_LABEL, key, this.env)}`;
  }

  async get<T>(key: string, maxAgeMs: number, now: number = Date.now()): Promise<CacheEntry<T> | undefined> {
    if (!this.breaker.available || !this.encKey) return undefined;
    const k = this.storeKey(key);
    let stored: string | null;
    try {
      stored = await this.breaker.run(() => this.redis.get(k), "cache_read_failed");
    } catch {
      return undefined;
    }
    if (typeof stored !== "string" || !stored) return undefined;
    let env: Envelope<T>;
    try {
      env = await decodeSharedEntry<T>(stored, this.encKey, k);
      if (!env || typeof env !== "object" || typeof env.storedAt !== "number" || !Number.isFinite(env.storedAt)) throw new TypeError("not a cache entry");
    } catch (err) {
      undecodable(err);
      return undefined;
    }
    const expiresAt = expiryOf(env);
    if (now >= expiresAt) return undefined;
    return now - env.storedAt <= maxAgeMs ? { value: env.value, storedAt: env.storedAt, expiresAt } : undefined;
  }

  async set<T>(key: string, value: T, retainMs: number, now: number = Date.now()): Promise<void> {
    // Redis paused (SharedCacheBreaker): skipped; the memory tier keeps the copy (TieredCache writes it first).
    if (!this.breaker.available) return;
    const k = this.storeKey(key);
    const retain = Math.max(0, retainMs);
    if (!(retain > 0)) {
      await this.breaker.run(() => this.redis.del(k), null);
      return;
    }
    if (!this.encKey) throw new Error("SESSION_SECRET is missing or too short");
    const stored = await encodeSharedEntry({ storedAt: now, expiresAt: now + retain, value }, this.encKey, k);
    if (stored.length > this.maxEntryBytes) throw new CacheEntryTooLargeError(stored.length);
    await this.breaker.run(() => this.redis.set(k, stored, { px: Math.ceil(retain) }), null);
  }
}

/**
 * Cross-instance single-flight for league-independent entries (HttpRequestOptions.cache.public; src/server/http.ts
 * starts every such live fetch through it when the shared cache is on). In-process single-flight stays as it was.
 */
export interface CacheLock {
  /**
   * Runs `fetch` as the one instance fetching the entry stored under `storeKey`; when another instance holds the lock,
   * waits for it to finish and returns that instance's copy (`copy`: one stored at or after `since`, epoch ms: when the
   * wait began, less cacheLimits.lockClockSkewMs), or runs `fetch` itself when there is none (the holder's answer wasn't
   * cacheable) or none came in time (never blocking a user on a dead lock).
   */
  run<T>(storeKey: string, copy: (since: number) => Promise<T | undefined>, fetch: () => Promise<T>): Promise<T>;
}

/**
 * The lock in Redis: SET prefix + "lock:" + hmacId(key) NX PX lockMs with a random token. The holder fetches and writes
 * the cache, then releases it (DEL only while the token is still its own; ⚠️ GET then DEL, not atomic: a lock that expires
 * between the two lets one more instance fetch, harmless). An instance that finds the lock taken checks every lockPollMs
 * whether it's still held (one GET), for up to lockWaitMs and never past the request's deadline (timeLeftMs, less
 * minAttemptMs so its own attempt still fits); once it's gone (the holder's copy, if it made one, is in the cache by then)
 * or the wait is over, it reads `copy` once and returns it, or fetches anyway. ⚠️ A refinement of the design's "polls the
 * cache every 250 ms": polling the lock costs one small command a poll instead of a cache read, and a holder whose answer
 * can't be cached (a 404, an empty list, a source down) frees the waiters at once instead of after the whole wait. Redis
 * slow or down (SharedCacheBreaker, shared with RedisCache): a lock command that fails or times out lets the fetch through
 * without the lock (fail open), a poll that does reads the lock as free, a release that does is skipped (the lock expires
 * after lockMs), and while the pause lasts every fetch goes through without asking Redis.
 */
export class RedisCacheLock implements CacheLock {
  private readonly prefix: string;
  private readonly env: Env;
  private readonly lockMs: number;
  private readonly pollMs: number;
  private readonly waitMs: number;
  private readonly minAttemptMs: number;
  private readonly timeLeftMs: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly breaker: SharedCacheBreaker;

  constructor(
    private readonly redis: RedisLike,
    opts: {
      env?: Env;
      lockMs?: number;
      pollMs?: number;
      waitMs?: number;
      minAttemptMs?: number;
      timeLeftMs?: () => number;
      sleep?: (ms: number) => Promise<void>;
      breaker?: SharedCacheBreaker;
    } = {},
  ) {
    this.env = opts.env ?? process.env;
    this.prefix = keyPrefix(this.env);
    this.lockMs = opts.lockMs ?? cacheLimits.lockMs;
    this.pollMs = opts.pollMs ?? cacheLimits.lockPollMs;
    this.waitMs = opts.waitMs ?? cacheLimits.lockWaitMs;
    this.minAttemptMs = opts.minAttemptMs ?? 0;
    this.timeLeftMs = opts.timeLeftMs ?? (() => Number.POSITIVE_INFINITY);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.breaker = opts.breaker ?? new SharedCacheBreaker();
  }

  /** The Redis key of the lock on an entry (hidden like the entry's own key). */
  lockKey(storeKey: string): string {
    return `${this.prefix}lock:${hmacId(CACHE_KEY_LABEL, storeKey, this.env)}`;
  }

  async run<T>(storeKey: string, copy: (since: number) => Promise<T | undefined>, fetch: () => Promise<T>): Promise<T> {
    // Redis paused (SharedCacheBreaker): every fetch goes through, as without the shared cache.
    if (!this.breaker.available) return fetch();
    const key = this.lockKey(storeKey);
    const token = randomUUID();
    let held: boolean;
    try {
      held = (await this.breaker.run(() => this.redis.set(key, token, { nx: true, px: this.lockMs }), "cache_lock_failed")) === "OK";
    } catch {
      return fetch(); // fail open
    }
    if (held) {
      try {
        return await fetch();
      } finally {
        await this.release(key, token);
      }
    }
    const start = Date.now();
    const since = start - cacheLimits.lockClockSkewMs;
    const waitMs = Math.min(this.waitMs, this.timeLeftMs() - this.minAttemptMs);
    const until = start + waitMs;
    // Bounded by count as well as by the clock, so a sleep that returns early can't spin.
    for (let polls = Math.floor(waitMs / this.pollMs); polls > 0 && Date.now() + this.pollMs <= until; polls--) {
      await this.sleep(this.pollMs);
      if (await this.held(key)) continue;
      break; // the holder is done (or its lock expired): its copy is in the cache by now, if it made one
    }
    let found: T | undefined;
    try {
      found = await copy(since);
    } catch {
      found = undefined;
    }
    return found !== undefined ? found : fetch();
  }

  /** Whether the lock is still taken (Redis paused, failing or too slow reads as free: the waiter then looks for a copy and fetches). */
  private async held(key: string): Promise<boolean> {
    if (!this.breaker.available) return false;
    try {
      return (await this.breaker.run(() => this.redis.get(key), "cache_lock_failed")) !== null;
    } catch {
      return false;
    }
  }

  private async release(key: string, token: string): Promise<void> {
    // Redis paused, failing or too slow: skipped; the lock expires on its own (lockMs).
    if (!this.breaker.available) return;
    try {
      if ((await this.breaker.run(() => this.redis.get(key), "cache_lock_failed")) === token) await this.breaker.run(() => this.redis.del(key), "cache_lock_failed");
    } catch {
      // the lock expires on its own (lockMs)
    }
  }
}
