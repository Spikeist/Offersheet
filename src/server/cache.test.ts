import type { PathLike } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_ENC_LABEL,
  CacheEntryTooLargeError,
  credentialScope,
  DAY,
  decodeSharedEntry,
  encodeSharedEntry,
  estimateBytes,
  FileCache,
  HOUR,
  MemoryCache,
  MemoryLruCache,
  MINUTE,
  RedisCache,
  RedisCacheLock,
  sha256,
  SharedCacheBreaker,
  TieredCache,
  type Cache,
} from "./cache";
import { cacheLimits } from "./limits";
import { FakeRedis, derivedKey, type RedisLike } from "./redis";

/** Lets a test make the next rename() calls fail with a given error code (Windows locks: EPERM / EBUSY). */
const fsControl = vi.hoisted(() => ({ renameErrors: [] as string[] }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (from: PathLike, to: PathLike) => {
      const code = fsControl.renameErrors.shift();
      if (code) throw Object.assign(new Error(`${code}: simulated`), { code });
      return actual.rename(from, to);
    },
  };
});

/** Whole seconds, so file times round-trip exactly. */
const T0 = Math.floor(Date.now() / 1000) * 1000;
const KEY = "sleeper:https://api.sleeper.app/v1/players/nfl?position=QB&active=true";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "offer-sheet-cache-test-"));
  fsControl.renameErrors.length = 0;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const fileCache = () => new FileCache(dir, { sweepEveryMs: null });
const fileOf = (key: string) => path.join(dir, `${sha256(key)}.json`);
const exists = (file: string) => stat(file).then(
  () => true,
  () => false,
);

/**
 * The contract every implementation keeps. `deletesOnRead`: the read itself deletes an expired entry (the file and memory
 * caches, which have no other expiry); Redis deletes one by its own clock (PX), never on a reader's word (RedisCache:
 * a reader whose clock runs ahead could delete a newer copy another instance just stored).
 */
function contract(name: string, make: () => Cache, opts: { deletesOnRead?: boolean } = {}) {
  describe(`${name}: the Cache contract`, () => {
    it("round-trips a value with its storage time and expiry", async () => {
      const cache = make();
      await cache.set(KEY, { n: 7 }, 10 * MINUTE, T0);
      expect(await cache.get(KEY, 10 * MINUTE, T0 + MINUTE)).toEqual({ value: { n: 7 }, storedAt: T0, expiresAt: T0 + 10 * MINUTE });
      expect(await cache.get("other", 10 * MINUTE, T0)).toBeUndefined();
    });

    it("separates how old a caller accepts (maxAge) from how long the entry is kept (retention)", async () => {
      const cache = make();
      await cache.set(KEY, "v", HOUR, T0);
      // Too old for this caller (Refresh: 1 minute), but still kept for others.
      expect(await cache.get(KEY, MINUTE, T0 + 20 * MINUTE)).toBeUndefined();
      expect(await cache.get(KEY, HOUR, T0 + 20 * MINUTE)).toMatchObject({ value: "v", storedAt: T0 });
      // A caller accepting any age still gets nothing once the retention has passed.
      expect(await cache.get(KEY, 7 * DAY, T0 + HOUR)).toBeUndefined();
      if (opts.deletesOnRead ?? true) expect(await cache.get(KEY, 7 * DAY, T0 + HOUR - 1)).toBeUndefined(); // deleted by the read above
    });

    it("replaces an entry on set, and treats a zero retention as already expired", async () => {
      const cache = make();
      await cache.set(KEY, "old", HOUR, T0);
      await cache.set(KEY, "new", HOUR, T0 + MINUTE);
      expect(await cache.get(KEY, HOUR, T0 + 2 * MINUTE)).toMatchObject({ value: "new", storedAt: T0 + MINUTE });
      await cache.set("zero", "x", 0, T0);
      expect(await cache.get("zero", HOUR, T0)).toBeUndefined();
    });
  });
}

/** A SESSION_SECRET for the shared cache's keys (tests only), and a preview deployment's prefix. */
const SHARED_ENV = { SESSION_SECRET: "s".repeat(40), VERCEL_ENV: "preview" } as const;

contract("MemoryCache", () => new MemoryCache());
contract("FileCache", fileCache);
contract("MemoryLruCache", () => new MemoryLruCache());
contract("RedisCache", () => new RedisCache(new FakeRedis(), { env: SHARED_ENV }), { deletesOnRead: false });
contract("TieredCache (memory, then Redis)", () => new TieredCache(new MemoryLruCache(), new RedisCache(new FakeRedis(), { env: SHARED_ENV })), { deletesOnRead: false });

describe("MemoryCache", () => {
  it("deletes an expired entry when it is read", async () => {
    const cache = new MemoryCache();
    await cache.set(KEY, 1, MINUTE, T0);
    await cache.set("kept", 2, HOUR, T0);
    expect(cache.keys().sort()).toEqual(["kept", KEY].sort());
    expect(await cache.get(KEY, HOUR, T0 + MINUTE)).toBeUndefined();
    expect(cache.keys()).toEqual(["kept"]);
    expect(cache.values()).toEqual([2]);
  });
});

describe("FileCache", () => {
  it("names files by sha256 of the key, never the key itself (Windows-safe, no IDs on disk names)", async () => {
    const cache = fileCache();
    const key = `espn:${credentialScope("s2", "{swid}")}:https://example.invalid/leagues/123?view=mTeam`;
    await cache.set(key, { ok: true }, HOUR, T0);
    expect(await readdir(dir)).toEqual([`${sha256(key)}.json`]);
    expect(sha256(key)).toMatch(/^[0-9a-f]{64}$/);
    const onDisk = await readFile(fileOf(key), "utf8");
    expect(JSON.parse(onDisk)).toEqual({ storedAt: T0, expiresAt: T0 + HOUR, value: { ok: true } });
    expect(onDisk).not.toContain(key);
  });

  it("stamps each file's mtime with its expiry", async () => {
    const cache = fileCache();
    await cache.set(KEY, 1, 10 * MINUTE, T0);
    expect((await stat(fileOf(KEY))).mtimeMs).toBe(T0 + 10 * MINUTE);
  });

  it("deletes an expired entry's file when it is read", async () => {
    const cache = fileCache();
    await cache.set(KEY, 1, MINUTE, T0);
    expect(await cache.get(KEY, HOUR, T0 + MINUTE - 1)).toBeDefined();
    expect(await exists(fileOf(KEY))).toBe(true);
    expect(await cache.get(KEY, HOUR, T0 + MINUTE)).toBeUndefined();
    expect(await exists(fileOf(KEY))).toBe(false);
  });

  it("treats an unreadable or foreign file as a miss", async () => {
    const cache = fileCache();
    await writeFile(fileOf("corrupt"), "{not json", "utf8");
    await writeFile(fileOf("foreign"), JSON.stringify({ hello: "world" }), "utf8");
    expect(await cache.get("corrupt", HOUR, T0)).toBeUndefined();
    expect(await cache.get("foreign", HOUR, T0)).toBeUndefined();
  });

  it("sweeps expired entries and leftover temp files, stamps legacy entries, and runs at most once a minute", async () => {
    const cache = fileCache();
    await cache.set("expired", 1, MINUTE, T0);
    await cache.set("live", 2, HOUR, T0);
    // Entries written before retention existed carry no expiresAt: kept a day from storedAt.
    await writeFile(fileOf("legacy-old"), JSON.stringify({ storedAt: T0 - 2 * DAY, value: 3 }), "utf8");
    await writeFile(fileOf("legacy-new"), JSON.stringify({ storedAt: T0 - HOUR, value: 4 }), "utf8");
    await utimes(fileOf("legacy-old"), new Date(T0 - 2 * DAY), new Date(T0 - 2 * DAY));
    await utimes(fileOf("legacy-new"), new Date(T0 - HOUR), new Date(T0 - HOUR));
    // A crashed write's temp file (older than an hour) and one still being written.
    const staleTemp = `${fileOf("x")}.tmp-1234-abcd0123`;
    const freshTemp = `${fileOf("y")}.tmp-1234-abcd4567`;
    await writeFile(staleTemp, "partial", "utf8");
    await writeFile(freshTemp, "partial", "utf8");
    await utimes(staleTemp, new Date(T0 - 2 * HOUR), new Date(T0 - 2 * HOUR));
    await utimes(freshTemp, new Date(T0), new Date(T0));

    const now = T0 + 10 * MINUTE;
    await cache.sweepIfDue(now);
    expect(await exists(fileOf("expired"))).toBe(false);
    expect(await exists(fileOf("live"))).toBe(true);
    expect(await exists(fileOf("legacy-old"))).toBe(false);
    expect(await exists(fileOf("legacy-new"))).toBe(true);
    expect((await stat(fileOf("legacy-new"))).mtimeMs).toBe(T0 - HOUR + DAY);
    expect(await cache.get("legacy-new", DAY, now)).toEqual({ value: 4, storedAt: T0 - HOUR, expiresAt: T0 - HOUR + DAY });
    expect(await exists(staleTemp)).toBe(false);
    expect(await exists(freshTemp)).toBe(true);

    // At most once a minute: an entry that expires now waits for the next sweep (or a read).
    await cache.set("soon", 5, MINUTE, T0);
    await cache.sweepIfDue(now + 30_000);
    expect(await exists(fileOf("soon"))).toBe(true);
    await cache.sweepIfDue(now + MINUTE);
    expect(await exists(fileOf("soon"))).toBe(false);
  });

  it("retries a rename the OS briefly refuses (Windows EPERM / EBUSY) and leaves no temp file", async () => {
    const cache = fileCache();
    fsControl.renameErrors.push("EPERM", "EBUSY");
    await cache.set(KEY, "v", HOUR, T0);
    expect(fsControl.renameErrors).toEqual([]);
    expect(await cache.get(KEY, HOUR, T0)).toMatchObject({ value: "v" });
    expect((await readdir(dir)).filter((n) => n.includes(".tmp-"))).toEqual([]);
  });

  it("lets a write failure reach the caller (the HttpClient logs it and serves the response uncached), cleaning up its temp file", async () => {
    const cache = fileCache();
    fsControl.renameErrors.push("EXDEV");
    await expect(cache.set(KEY, "v", HOUR, T0)).rejects.toMatchObject({ code: "EXDEV" });
    expect(await readdir(dir)).toEqual([]);
    // A cache folder that can't be created: set fails, get and the sweep just miss.
    const blocker = path.join(dir, "not-a-folder");
    await writeFile(blocker, "", "utf8");
    const broken = new FileCache(blocker, { sweepEveryMs: null });
    await expect(broken.set(KEY, "v", HOUR, T0)).rejects.toBeInstanceOf(Error);
    await expect(broken.get(KEY, HOUR, T0 + 2 * MINUTE)).resolves.toBeUndefined();
  });
});

describe("credentialScope", () => {
  it("is a short one-way scope that never contains the credentials", () => {
    const scope = credentialScope("espn-s2-value", "{SWID-VALUE}");
    expect(scope).toMatch(/^cred-[0-9a-f]{16}$/);
    expect(scope).not.toContain("espn-s2-value");
    expect(credentialScope("espn-s2-value", "{SWID-VALUE}")).toBe(scope);
    expect(credentialScope("espn-s2-value", "{OTHER}")).not.toBe(scope);
    // Parts are separated, so shifting characters between them changes the scope.
    expect(credentialScope("ab", "c")).not.toBe(credentialScope("a", "bc"));
  });
});

// ---------------------------------------------------------------------------------------------
// The shared cache (planner reply to Checkpoint 4c, Part B, B1; track CA)

/** An HTTP client's entry (src/server/http.ts Cached) with a body of `n` characters. */
const httpEntry = (n: number, fill = "x") => ({ status: 200, contentType: "application/json", text: fill.repeat(n), fetchedAt: T0 });

/** A RedisLike whose commands named in `failing` throw (Upstash down), the rest served by a FakeRedis. */
function brokenRedis(failing: ReadonlyArray<keyof RedisLike>): RedisLike {
  const inner = new FakeRedis();
  const out: Record<string, unknown> = {};
  for (const name of ["get", "mget", "set", "del", "incr", "pexpire", "lpush", "ltrim", "lrange"] as const) {
    out[name] = failing.includes(name)
      ? async () => {
          throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443 (https://secret.upstash.io)"), { name: "UpstashError" });
        }
      : (...args: unknown[]) => (inner[name] as (...a: unknown[]) => unknown).apply(inner, args);
  }
  return out as unknown as RedisLike;
}

describe("MemoryLruCache (the per-instance memory tier)", () => {
  it("holds at most maxBytes by text length, dropping the least recently used first", async () => {
    const cache = new MemoryLruCache(2_000);
    expect(estimateBytes(httpEntry(300))).toBe(556);
    await cache.set("a", httpEntry(300), HOUR, T0);
    await cache.set("b", httpEntry(300), HOUR, T0);
    expect(await cache.get("a", HOUR, T0)).toBeDefined(); // a is now used more recently than b
    await cache.set("c", httpEntry(300), HOUR, T0);
    expect(cache.bytes).toBe(3 * 556);
    await cache.set("d", httpEntry(300), HOUR, T0); // over 2,000: b goes
    expect(cache.keys()).toEqual(["a", "c", "d"]);
    expect(cache.bytes).toBe(3 * 556);
    // Replacing an entry counts it once.
    await cache.set("a", httpEntry(100), HOUR, T0);
    expect(cache.bytes).toBe(2 * 556 + 356);
  });

  it("doesn't keep an entry larger than the whole tier (and drops the older copy under its key)", async () => {
    const cache = new MemoryLruCache(1_000);
    await cache.set("big", httpEntry(100), HOUR, T0);
    await cache.set("big", httpEntry(5_000), HOUR, T0);
    expect(await cache.get("big", HOUR, T0)).toBeUndefined();
    expect(cache.bytes).toBe(0);
  });

  it("deletes expired entries when read and by a sweep at most once a minute, so league data goes when its retention ends", async () => {
    const cache = new MemoryLruCache();
    await cache.set("league", httpEntry(10), 10 * MINUTE, T0);
    await cache.set("public", httpEntry(10), 7 * DAY, T0);
    expect(await cache.get("public", DAY, T0 + 10 * MINUTE)).toBeDefined(); // the sweep at this read drops the league entry
    expect(cache.keys()).toEqual(["public"]);
    expect(cache.bytes).toBe(estimateBytes(httpEntry(10)));
  });
});

describe("RedisCache (the shared cache in Upstash)", () => {
  it("never sends a raw key: the prefix, c: and a 32-character HMAC that depends on SESSION_SECRET", async () => {
    const redis = new FakeRedis();
    const cache = new RedisCache(redis, { env: SHARED_ENV });
    const key = `espn:${credentialScope("s2", "{swid}")}:2026:123456789:league`;
    await cache.set(key, httpEntry(10), HOUR);
    const stored = redis.keys();
    expect(stored).toEqual([cache.storeKey(key)]);
    expect(stored[0]).toMatch(/^os:preview:c:[A-Za-z0-9_-]{32}$/);
    for (const part of ["123456789", "cred-", "espn", "2026"]) expect(stored[0]).not.toContain(part);
    expect(new RedisCache(redis, { env: { ...SHARED_ENV, SESSION_SECRET: "t".repeat(40) } }).storeKey(key)).not.toBe(stored[0]);
    expect(new RedisCache(redis, { env: { SESSION_SECRET: SHARED_ENV.SESSION_SECRET } }).storeKey(key)).toMatch(/^os:local:c:/);
    expect(await cache.get(key, HOUR)).toMatchObject({ value: httpEntry(10) });
  });

  it("stores FileCache's envelope, gzipped and encrypted under a key from SESSION_SECRET, with Redis's expiry at the end of the retention", async () => {
    let now = T0;
    const redis = new FakeRedis(() => now);
    const cache = new RedisCache(redis, { env: SHARED_ENV });
    await cache.set(KEY, { n: 1 }, 10 * MINUTE, T0);
    const k = cache.storeKey(KEY);
    expect(redis.ttlMs(k)).toBe(10 * MINUTE);
    const raw = (await redis.get(k)) as string;
    expect(raw).toMatch(/^e2\.[A-Za-z0-9+/]+=*$/);
    expect(CACHE_ENC_LABEL).toBe("cache-enc/v2");
    const encKey = derivedKey(CACHE_ENC_LABEL, SHARED_ENV);
    expect(await decodeSharedEntry(raw, encKey, k)).toEqual({ storedAt: T0, expiresAt: T0 + 10 * MINUTE, value: { n: 1 } });
    // Upstash holds only ciphertext: no plain gzip, and another secret's key (or none) can't read it, nor can the right key
    // read it as another entry's (final review SEC-5: the value is bound to its Redis key).
    await expect(decodeSharedEntry(raw)).rejects.toThrow();
    await expect(decodeSharedEntry(raw, derivedKey(CACHE_ENC_LABEL, { SESSION_SECRET: "t".repeat(40) }), k)).rejects.toThrow();
    await expect(decodeSharedEntry(raw, encKey)).rejects.toThrow();
    await expect(decodeSharedEntry(raw, encKey, cache.storeKey("another entry"))).rejects.toThrow();
    // The same value written twice reads the same but is stored differently (a random IV per value).
    await cache.set(KEY, { n: 1 }, 10 * MINUTE, T0);
    expect(await redis.get(k)).not.toBe(raw);
    // A body of repeated text shrinks a lot.
    await cache.set("long", httpEntry(100_000, "ab"), HOUR, T0);
    expect(((await redis.get(cache.storeKey("long"))) as string).length).toBeLessThan(5_000);
    now = T0 + 10 * MINUTE; // Redis deletes it when its retention ends
    expect(await redis.get(k)).toBeNull();
  });

  it("a value moved onto another entry's key (what anyone holding the database's token could do) reads as a miss there (final review SEC-5)", async () => {
    // Real time (T0): the unreadable-entry report is once a minute per process, and later tests read it at T0 + 7 and 8 days.
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const redis = new FakeRedis();
      const cache = new RedisCache(redis, { env: SHARED_ENV });
      const privateKey = `espn:${credentialScope("s2", "{swid}")}:2026:111111:league`;
      const publicKey = "espn:public:2026:222222:league";
      await cache.set(privateKey, httpEntry(5, "p"), HOUR);
      await cache.set(publicKey, httpEntry(5, "q"), HOUR);
      const sealed = (await redis.get(cache.storeKey(privateKey))) as string;
      await redis.set(cache.storeKey(publicKey), sealed, { px: HOUR });
      expect(await cache.get(publicKey, HOUR)).toBeUndefined();
      // The value still reads under its own key, and a moved value is reported like any unreadable one (by name only).
      expect(await cache.get(privateKey, HOUR)).toMatchObject({ value: httpEntry(5, "p") });
      expect(log.mock.calls.map((c) => JSON.parse(String(c[0])) as { event: string }).map((e) => e.event)).toEqual(["cache_entry_unreadable"]);
    } finally {
      log.mockRestore();
    }
  });

  it("doesn't write an entry over maxEntryBytes as stored: CacheEntryTooLarge, which the HTTP client logs by name", async () => {
    const redis = new FakeRedis();
    const cache = new RedisCache(redis, { env: SHARED_ENV, maxEntryBytes: 1_000 });
    const random = randomBytes(6_000).toString("hex"); // gzip can't shrink it much
    await expect(cache.set(KEY, { status: 200, contentType: "", text: random }, HOUR)).rejects.toBeInstanceOf(CacheEntryTooLargeError);
    await expect(cache.set(KEY, { status: 200, contentType: "", text: random }, HOUR)).rejects.toMatchObject({ name: "CacheEntryTooLarge" });
    expect(redis.keys()).toEqual([]);
    expect(cacheLimits.maxEntryBytes).toBeLessThan(10_000_000); // Upstash takes at most 10 MB a request
  });

  it("a read that fails is a miss, logged by name only once, and Redis is left alone for a minute (no command until then)", async () => {
    vi.useFakeTimers({ now: T0 + 7 * DAY });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const down = countingRedis(brokenRedis(["get"]));
      const cache = new RedisCache(down.redis, { env: SHARED_ENV });
      expect(await cache.get(KEY, HOUR)).toBeUndefined();
      expect(await cache.get(KEY, HOUR)).toBeUndefined();
      expect(down.calls()).toBe(1); // the second read never asked Redis
      const lines = log.mock.calls.map((c) => String(c[0]));
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] as string)).toEqual({ route: "server", event: "cache_read_failed", platform: "upstash", errorName: "UpstashError" });
      for (const secret of ["ECONNREFUSED", "upstash.io", "10.0.0.1"]) expect(lines[0]).not.toContain(secret);
      vi.setSystemTime(T0 + 7 * DAY + cacheLimits.redisRetryAfterMs);
      expect(await cache.get(KEY, HOUR)).toBeUndefined(); // asked again, failed again: a new pause, said again
      expect(down.calls()).toBe(2);
      expect(log).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
      vi.useRealTimers();
    }
  });

  it("a value that isn't an entry (not ours, or damaged) is a miss, logged by name at most once a minute, and doesn't pause Redis", async () => {
    vi.useFakeTimers({ now: T0 + 8 * DAY });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const redis = new FakeRedis();
      const cache = new RedisCache(redis, { env: SHARED_ENV });
      await redis.set(cache.storeKey(KEY), "not base64 gzip");
      expect(await cache.get(KEY, HOUR)).toBeUndefined();
      await redis.set(cache.storeKey("other"), Buffer.from("{}").toString("base64"));
      expect(await cache.get("other", HOUR)).toBeUndefined();
      await redis.set(cache.storeKey("json"), await encodeSharedEntry({ storedAt: Number.NaN, expiresAt: 0, value: 1 } as never, derivedKey(CACHE_ENC_LABEL, SHARED_ENV), cache.storeKey("json")));
      await redis.set(cache.storeKey("plain"), await encodeSharedEntry({ storedAt: T0 + 8 * DAY, expiresAt: T0 + 9 * DAY, value: 1 }));
      expect(await cache.get("plain", HOUR)).toBeUndefined(); // a plain (unencrypted) value is never read
      expect(await cache.get("json", HOUR)).toBeUndefined();
      const events = log.mock.calls.map((c) => JSON.parse(String(c[0])) as { event: string; errorName?: string });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ event: "cache_entry_unreadable", platform: "upstash" });
      // Redis isn't paused: a good entry still reads.
      await cache.set("good", httpEntry(3), HOUR);
      expect(await cache.get("good", HOUR)).toMatchObject({ value: httpEntry(3) });
    } finally {
      log.mockRestore();
      vi.useRealTimers();
    }
  });

  it("a write that fails rejects (like FileCache: the HTTP client logs it and serves the response uncached), and later writes are skipped while Redis is paused", async () => {
    const down = countingRedis(brokenRedis(["set"]));
    const cache = new RedisCache(down.redis, { env: SHARED_ENV });
    await expect(cache.set(KEY, httpEntry(10), HOUR)).rejects.toMatchObject({ name: "UpstashError" });
    await expect(cache.set(KEY, httpEntry(10), HOUR)).resolves.toBeUndefined();
    expect(down.calls()).toBe(1);
  });

  it("an entry past its retention by the reader's clock is a miss; Redis's own expiry deletes it (a reader never DELs: its clock may run ahead)", async () => {
    let now = T0;
    const redis = new FakeRedis(() => now);
    const cache = new RedisCache(redis, { env: SHARED_ENV });
    await cache.set(KEY, 1, MINUTE, T0);
    const commands = redis.stats.commands;
    expect(await cache.get(KEY, HOUR, T0 + MINUTE)).toBeUndefined();
    expect(redis.stats.commands).toBe(commands + 1); // the GET only
    expect(redis.keys()).toEqual([cache.storeKey(KEY)]);
    now = T0 + MINUTE;
    expect(redis.keys()).toEqual([]);
  });
});

/** A RedisLike that counts its commands (a wrapper; `calls` is every command sent). */
function countingRedis(inner: RedisLike): { redis: RedisLike; calls: () => number } {
  let n = 0;
  const out: Record<string, unknown> = {};
  for (const name of ["get", "mget", "set", "del", "incr", "pexpire", "lpush", "ltrim", "lrange"] as const) {
    out[name] = (...args: unknown[]) => {
      n++;
      return (inner[name] as (...a: unknown[]) => unknown).apply(inner, args);
    };
  }
  return { redis: out as unknown as RedisLike, calls: () => n };
}

/** A RedisLike whose every command never answers (Upstash unreachable without a quick error), counting them. */
function hangingRedis(): { redis: RedisLike; calls: () => number } {
  return countingRedis(
    new Proxy({} as RedisLike, {
      get: () => () => new Promise(() => {}),
    }),
  );
}

describe("SharedCacheBreaker (Redis slow or down; review CA-1)", () => {
  it("a command slower than the timeout fails as a TimeoutError and pauses Redis; the first failure of a pause is reported once, by name", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let now = 1_000;
      const breaker = new SharedCacheBreaker({ timeoutMs: 20, retryAfterMs: 5_000, clock: () => now });
      expect(breaker.available).toBe(true);
      const started = Date.now();
      await expect(breaker.run(() => new Promise(() => {}), "cache_read_failed")).rejects.toMatchObject({ name: "TimeoutError" });
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(breaker.available).toBe(false);
      // Commands already in flight that fail during the pause aren't said again.
      await expect(breaker.run(() => Promise.reject(new Error("late")), "cache_lock_failed")).rejects.toThrow("late");
      expect(log.mock.calls.map((c) => JSON.parse(String(c[0])) as unknown)).toEqual([{ route: "server", event: "cache_read_failed", platform: "upstash", errorName: "TimeoutError" }]);
      now += 5_000;
      expect(breaker.available).toBe(true);
      expect(await breaker.run(async () => "OK", "cache_read_failed")).toBe("OK");
      // A write's failure (event null) pauses Redis without a line here: the HTTP client logs the rejection.
      await expect(breaker.run(() => Promise.reject(new Error("w")), null)).rejects.toThrow("w");
      expect(breaker.available).toBe(false);
      expect(log).toHaveBeenCalledTimes(1);
      expect(cacheLimits.redisTimeoutMs).toBeLessThanOrEqual(1_000);
      expect(cacheLimits.redisRetryAfterMs).toBeGreaterThanOrEqual(30_000);
    } finally {
      log.mockRestore();
    }
  });

  it("a Redis that never answers costs one timeout: the cache misses at once afterwards, writes are skipped (the memory tier keeps the copy), and nothing more is sent", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const hung = hangingRedis();
      const breaker = new SharedCacheBreaker({ timeoutMs: 30 });
      const cache = new TieredCache(new MemoryLruCache(), new RedisCache(hung.redis, { env: SHARED_ENV, breaker }));
      const started = Date.now();
      expect(await cache.get(KEY, HOUR)).toBeUndefined();
      expect(hung.calls()).toBe(1);
      for (let i = 0; i < 20; i++) expect(await cache.get(`${KEY}#${i}`, HOUR)).toBeUndefined();
      await cache.set(KEY, httpEntry(10), HOUR);
      expect(await cache.get(KEY, HOUR)).toMatchObject({ value: httpEntry(10) });
      expect(hung.calls()).toBe(1);
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      log.mockRestore();
    }
  });
});

describe("MemoryLruCache.fill and TieredCache's fill (review CA-4)", () => {
  it("keeps another tier's copy with its own times, unless it holds one at least as new; never an expired or oversized one", () => {
    const memory = new MemoryLruCache(1_000);
    const older = { value: httpEntry(1, "o"), storedAt: T0 - 5 * MINUTE, expiresAt: T0 + 5 * MINUTE };
    const newer = { value: httpEntry(1, "n"), storedAt: T0, expiresAt: T0 + 10 * MINUTE };
    expect(memory.fill(KEY, older, T0)).toEqual(older);
    expect(memory.fill(KEY, newer, T0)).toEqual(newer); // newer replaces older
    expect(memory.fill(KEY, older, T0 + MINUTE)).toEqual(newer); // older never replaces newer
    expect(memory.fill(KEY, { ...newer, value: httpEntry(1, "s") }, T0 + MINUTE)).toEqual(newer); // as new: the held copy stays
    expect(memory.fill("expired", { ...older, expiresAt: T0 }, T0)).toBeUndefined();
    expect(memory.fill("big", { ...newer, value: httpEntry(5_000) }, T0)).toBeUndefined();
    expect(memory.keys()).toEqual([KEY]);
    // A held copy that has expired is replaced, even by an older one still within its own retention.
    const short = new MemoryLruCache();
    void short.set(KEY, "new but short", MINUTE, T0);
    expect(short.fill(KEY, { value: "older, kept longer", storedAt: T0 - MINUTE, expiresAt: T0 + HOUR }, T0 + MINUTE)).toMatchObject({ value: "older, kept longer" });
  });

  it("a copy this instance stores while its Redis read is in flight (a Refresh) isn't replaced by the older copy that read returns", async () => {
    let release: (() => void) | undefined;
    let hold = false;
    const redis = new FakeRedis();
    const slow: RedisLike = Object.assign(Object.create(redis) as RedisLike, {
      async get(key: string) {
        const value = await redis.get(key); // reads the old copy now ...
        if (!hold) return value;
        hold = false;
        await new Promise<void>((r) => (release = r)); // ... and answers later
        return value;
      },
    });
    const memory = new MemoryLruCache();
    const cache = new TieredCache(memory, new RedisCache(slow, { env: SHARED_ENV }));
    // Another instance stored the league 5 minutes ago (Redis holds it; this instance's memory doesn't).
    await new RedisCache(redis, { env: SHARED_ENV }).set(KEY, httpEntry(1, "o"), 10 * MINUTE, T0 - 5 * MINUTE);
    hold = true;
    const slowRead = cache.get(KEY, 10 * MINUTE, T0);
    await new Promise((r) => setTimeout(r, 5));
    await cache.set(KEY, httpEntry(1, "n"), 10 * MINUTE, T0); // this instance's Refresh: memory first, then Redis
    release?.();
    expect(await slowRead).toMatchObject({ value: { text: "n" }, storedAt: T0 }); // the newer copy, served and kept
    expect(await memory.get(KEY, 10 * MINUTE, T0 + 1_000)).toMatchObject({ value: { text: "n" } });
    expect(await cache.get(KEY, 10 * MINUTE, T0 + 1_000)).toMatchObject({ value: { text: "n" } });
  });

  it("the timer sweep (deps.ts turns it on) deletes an expired entry while nothing reads or writes, and keeps live ones", async () => {
    vi.useFakeTimers({ now: T0 });
    try {
      const memory = new MemoryLruCache(cacheLimits.memoryBytes, { sweepEveryMs: MINUTE });
      await memory.set("league", httpEntry(10), 10 * MINUTE, T0);
      await memory.set("public", httpEntry(10), DAY, T0);
      vi.advanceTimersByTime(9 * MINUTE);
      expect(memory.keys()).toEqual(["league", "public"]);
      vi.advanceTimersByTime(2 * MINUTE);
      expect(memory.keys()).toEqual(["public"]);
      expect(memory.bytes).toBe(estimateBytes(httpEntry(10)));
      // Off by default: no timer (tests and measurements make many).
      const quiet = new MemoryLruCache();
      await quiet.set("league", httpEntry(10), MINUTE, T0 + 11 * MINUTE);
      vi.advanceTimersByTime(10 * MINUTE);
      expect(quiet.keys()).toEqual(["league"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("TieredCache (this instance's memory in front of Redis)", () => {
  /** Two server instances: each its own memory, one Redis. */
  function twoInstances() {
    const redis = new FakeRedis();
    const make = () => {
      const memory = new MemoryLruCache();
      return { memory, cache: new TieredCache(memory, new RedisCache(redis, { env: SHARED_ENV })) };
    };
    return { redis, a: make(), b: make() };
  }

  it("reads Redis on a memory miss and keeps the copy in memory for its remaining retention (same storedAt and expiresAt)", async () => {
    const { redis, a, b } = twoInstances();
    await a.cache.set(KEY, httpEntry(10), HOUR, T0);
    const commands = redis.stats.commands;
    expect(await b.cache.get(KEY, HOUR, T0 + MINUTE)).toEqual({ value: httpEntry(10), storedAt: T0, expiresAt: T0 + HOUR });
    expect(redis.stats.commands).toBe(commands + 1);
    expect(await b.memory.get(KEY, HOUR, T0 + MINUTE)).toEqual({ value: httpEntry(10), storedAt: T0, expiresAt: T0 + HOUR });
    expect(await b.cache.get(KEY, HOUR, T0 + 2 * MINUTE)).toBeDefined();
    expect(redis.stats.commands).toBe(commands + 1); // served from memory
    expect(await b.cache.get(KEY, 7 * DAY, T0 + HOUR)).toBeUndefined(); // retention passed in both tiers
  });

  it("a copy too old for this caller in memory reads Redis, which may hold another instance's newer one (a Refresh)", async () => {
    const { a, b } = twoInstances();
    await a.cache.set(KEY, httpEntry(1, "1"), 10 * MINUTE, T0);
    expect(await b.cache.get(KEY, 10 * MINUTE, T0 + 5 * MINUTE)).toMatchObject({ value: { text: "1" } });
    await a.cache.set(KEY, httpEntry(1, "2"), 10 * MINUTE, T0 + 6 * MINUTE);
    expect(await b.cache.get(KEY, 10 * MINUTE, T0 + 6 * MINUTE + 30_000)).toMatchObject({ value: { text: "1" } }); // within its own maxAge
    expect(await b.cache.get(KEY, MINUTE, T0 + 6 * MINUTE + 30_000)).toMatchObject({ value: { text: "2" }, storedAt: T0 + 6 * MINUTE });
  });

  it("a Redis write that fails leaves the copy in memory and rejects (logged and served by the HTTP client); a failed read is a miss", async () => {
    const down = brokenRedis(["get", "set"]);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const cache = new TieredCache(new MemoryLruCache(), new RedisCache(down, { env: SHARED_ENV }));
      await expect(cache.set(KEY, httpEntry(10), HOUR, T0)).rejects.toMatchObject({ name: "UpstashError" });
      expect(await cache.get(KEY, HOUR, T0)).toMatchObject({ value: httpEntry(10) });
      expect(await new TieredCache(new MemoryLruCache(), new RedisCache(down, { env: SHARED_ENV })).get(KEY, HOUR, T0)).toBeUndefined();
    } finally {
      log.mockRestore();
    }
  });
});

describe("RedisCacheLock (cross-instance single-flight for league-independent entries)", () => {
  const lockOf = (redis: RedisLike, opts: Partial<{ waitMs: number; timeLeftMs: () => number; minAttemptMs: number; lockMs: number }> = {}) =>
    new RedisCacheLock(redis, { env: SHARED_ENV, pollMs: 5, waitMs: 200, ...opts });
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }
  const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("the holder fetches with the lock taken, under a hidden key, and releases it after", async () => {
    const redis = new FakeRedis();
    const lock = lockOf(redis);
    const key = "sleeper:https://api.sleeper.app/projections/nfl/2026/4?x#r1";
    let during: string[] = [];
    const out = await lock.run(
      key,
      async () => "copy",
      async () => {
        during = redis.keys();
        return "fetched";
      },
    );
    expect(out).toBe("fetched");
    expect(during).toEqual([lock.lockKey(key)]);
    expect(during[0]).toMatch(/^os:preview:lock:[A-Za-z0-9_-]{32}$/);
    expect(during[0]).not.toContain("sleeper");
    expect(redis.keys()).toEqual([]);
  });

  it("another instance waits for the holder's copy (stored since it began waiting) and returns it without fetching", async () => {
    const redis = new FakeRedis();
    const holder = deferred<string>();
    let stored: { at: number; value: string } | undefined = undefined;
    const a = lockOf(redis, { waitMs: 2_000 }).run("k", async () => undefined, () => holder.promise);
    await tick(1);
    const sinceSeen: number[] = [];
    let fetchedByB = 0;
    const startedB = Date.now();
    const b = lockOf(redis, { waitMs: 2_000 }).run(
      "k",
      async (since) => {
        sinceSeen.push(since);
        return stored && stored.at >= since ? stored.value : undefined;
      },
      async () => {
        fetchedByB++;
        return "b fetched";
      },
    );
    await tick(20);
    stored = { at: Date.now(), value: "the holder's copy" };
    holder.resolve("a fetched");
    expect(await a).toBe("a fetched");
    expect(await b).toBe("the holder's copy");
    expect(fetchedByB).toBe(0);
    expect(new Set(sinceSeen).size).toBe(1);
    expect(sinceSeen[0]).toBeLessThanOrEqual(startedB - cacheLimits.lockClockSkewMs + 5);
  });

  it("when the lock isn't released in time it looks for a copy once and fetches anyway (never blocked on a dead lock), never past the request's deadline", async () => {
    const redis = new FakeRedis();
    await redis.set(lockOf(redis).lockKey("k"), "a dead holder's token", { px: 20_000 });
    let looks = 0;
    const look = async () => (looks++, undefined);
    const lockPolls = (n: number) => redis.stats.commands - n - 1; // the commands since `n`, less the SET NX (this copy reads no Redis)
    let before = redis.stats.commands;
    const started = Date.now();
    expect(await lockOf(redis, { waitMs: 60 }).run("k", look, async () => "fetched")).toBe("fetched");
    expect(looks).toBe(1);
    expect(lockPolls(before)).toBeGreaterThan(0);
    expect(lockPolls(before)).toBeLessThanOrEqual(12);
    expect(Date.now() - started).toBeLessThan(1_000);
    // 30 ms left, 20 of them kept for its own attempt: at most 2 polls of 5 ms.
    before = redis.stats.commands;
    expect(await lockOf(redis, { timeLeftMs: () => 30, minAttemptMs: 20 }).run("k", look, async () => "fetched")).toBe("fetched");
    expect(lockPolls(before)).toBeLessThanOrEqual(2);
    // Less time left than an attempt needs: no wait at all, one look, then its own fetch.
    before = redis.stats.commands;
    looks = 0;
    expect(await lockOf(redis, { timeLeftMs: () => 5, minAttemptMs: 20 }).run("k", look, async () => "fetched")).toBe("fetched");
    expect(lockPolls(before)).toBe(0);
    expect(looks).toBe(1);
  });

  it("a holder that finishes without a copy (its answer couldn't be cached) frees the waiter at once: it fetches itself, long before its wait is over", async () => {
    const redis = new FakeRedis();
    const holder = deferred<string>();
    const a = lockOf(redis, { waitMs: 5_000 }).run("k", async () => undefined, () => holder.promise);
    await tick(1);
    let fetchedByB = 0;
    const started = Date.now();
    const b = lockOf(redis, { waitMs: 5_000 }).run("k", async () => undefined, async () => (fetchedByB++, "b fetched"));
    await tick(15);
    holder.resolve("a: 404, nothing cached");
    expect(await a).toBe("a: 404, nothing cached");
    expect(await b).toBe("b fetched");
    expect(fetchedByB).toBe(1);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("Redis trouble lets the fetch through without the lock (fail open)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await lockOf(brokenRedis(["set"])).run("k", async () => "copy", async () => "fetched")).toBe("fetched");
    } finally {
      log.mockRestore();
    }
  });

  it("releasing never deletes a lock another instance took after this one's expired", async () => {
    let now = T0;
    const redis = new FakeRedis(() => now);
    const slow = deferred<string>();
    const a = lockOf(redis, { lockMs: 1_000 }).run("k", async () => undefined, () => slow.promise);
    await tick(1);
    now = T0 + 1_000; // the first holder's lock expired
    const c = lockOf(redis);
    expect(await redis.set(c.lockKey("k"), "the new holder's token", { nx: true, px: 20_000 })).toBe("OK");
    slow.resolve("a fetched");
    expect(await a).toBe("a fetched");
    expect(await redis.get(c.lockKey("k"))).toBe("the new holder's token");
  });
});
