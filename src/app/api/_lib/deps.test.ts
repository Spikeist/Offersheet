/**
 * The server's cache, picked in one place (planner reply to Checkpoint 4c, Part B, B1: the shared cache; track CA), and
 * the file cache's folder (A1: the stable copy shares the main folder's cache).
 */
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FileCache, MemoryLruCache, RedisCache, RedisCacheLock, TieredCache } from "@/server/cache";
import { FakeRedis, type RedisLike } from "@/server/redis";

vi.mock("server-only", () => ({}));

describe("app/api/_lib/deps.ts fileCacheDir", () => {
  it("is FileCache's default (.cache/app in the working directory) unless OFFERSHEET_CACHE_DIR names a folder", async () => {
    const { CACHE_DIR_ENV, fileCacheDir } = await import("./deps");
    expect(CACHE_DIR_ENV).toBe("OFFERSHEET_CACHE_DIR");
    expect(fileCacheDir({})).toBeUndefined();
    expect(fileCacheDir({ OFFERSHEET_CACHE_DIR: "  " })).toBeUndefined();
    const main = path.join("D:", "Source Code", "VS Code", "fantasy-trade-finder", ".cache", "app");
    expect(fileCacheDir({ OFFERSHEET_CACHE_DIR: main })).toBe(path.resolve(main));
    expect(fileCacheDir({ OFFERSHEET_CACHE_DIR: "relative/cache" })).toBe(path.resolve("relative/cache"));
  });
});

describe("app/api/_lib/deps.ts selectServerCache", () => {
  const SECRET = "s".repeat(40);

  it("with Redis: this instance's memory in front of Redis, and the cross-instance lock", async () => {
    const { selectServerCache } = await import("./deps");
    const picked = selectServerCache({ SESSION_SECRET: SECRET, VERCEL: "1", VERCEL_ENV: "preview" }, new FakeRedis());
    expect(picked.kind).toBe("shared");
    expect(picked.cache).toBeInstanceOf(TieredCache);
    const tiers = picked.cache as TieredCache;
    expect(tiers.l1).toBeInstanceOf(MemoryLruCache);
    expect(tiers.l2).toBeInstanceOf(RedisCache);
    expect(picked.lock).toBeInstanceOf(RedisCacheLock);
  });

  it("on Vercel without Redis: memory only, said once in the log (a preview before Upstash is connected still works)", async () => {
    const { selectServerCache } = await import("./deps");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const picked = selectServerCache({ VERCEL: "1", VERCEL_ENV: "preview", SESSION_SECRET: SECRET }, null);
      expect(picked.kind).toBe("memory");
      expect(picked.cache).toBeInstanceOf(MemoryLruCache);
      expect(picked.lock).toBeUndefined();
      expect(log.mock.calls.map((c) => JSON.parse(String(c[0])) as { event: string }).map((e) => e.event)).toEqual(["cache_memory_only"]);
    } finally {
      log.mockRestore();
    }
  });

  it("on Vercel without SESSION_SECRET (or one too short): says so by name first (final review SEC-9: such a deployment ran quietly on memory alone)", async () => {
    const { selectServerCache } = await import("./deps");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const env of [{ VERCEL: "1", VERCEL_ENV: "preview" }, { VERCEL: "1", VERCEL_ENV: "preview", SESSION_SECRET: "too short", KV_REST_API_URL: "https://example.upstash.io", KV_REST_API_TOKEN: "t" }]) {
        log.mockClear();
        expect(selectServerCache(env).kind).toBe("memory");
        expect(log.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)).toEqual([
          { route: "server", event: "session_secret_missing" },
          { route: "server", event: "cache_memory_only" },
        ]);
      }
      // Off Vercel nothing is said: this computer has no shared store to miss.
      log.mockClear();
      expect(selectServerCache({}, null).kind).toBe("file");
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("on this computer (no Redis, not Vercel): the file cache, exactly as before, in OFFERSHEET_CACHE_DIR when it's set", async () => {
    const { selectServerCache } = await import("./deps");
    const picked = selectServerCache({}, null);
    expect(picked.kind).toBe("file");
    expect(picked.cache).toBeInstanceOf(FileCache);
    expect((picked.cache as FileCache).dir).toBe(path.join(process.cwd(), ".cache", "app"));
    expect(picked.lock).toBeUndefined();
    const elsewhere = selectServerCache({ OFFERSHEET_CACHE_DIR: path.join("D:", "x", ".cache", "app") }, null);
    expect((elsewhere.cache as FileCache).dir).toBe(path.resolve(path.join("D:", "x", ".cache", "app")));
  });

  it("off Vercel it's the file cache whatever is configured: .env.local may hold KV_* (feedback:pull, vercel env pull), and this computer never contacts Upstash", async () => {
    const { selectServerCache } = await import("./deps");
    const kv = { SESSION_SECRET: SECRET, KV_REST_API_URL: "https://example.upstash.io", KV_REST_API_TOKEN: "t" };
    expect(selectServerCache(kv).kind).toBe("file");
    expect(selectServerCache(kv, new FakeRedis()).kind).toBe("file");
    expect(selectServerCache({ SESSION_SECRET: SECRET }).kind).toBe("file");
  });

  it("says why it isn't the shared cache, by name only (/api/health; planner reply to Checkpoint 7a, §1)", async () => {
    const { selectServerCache } = await import("./deps");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const kv = { VERCEL: "1", VERCEL_ENV: "preview", SESSION_SECRET: SECRET, KV_REST_API_URL: "https://example.upstash.io", KV_REST_API_TOKEN: "t" };
      expect(selectServerCache(kv).reason).toBeUndefined();
      expect(selectServerCache({}, null).reason).toBe("not_on_vercel");
      expect(selectServerCache({ ...kv, SESSION_SECRET: "short" }).reason).toBe("session_secret_missing");
      expect(selectServerCache({ ...kv, OFFERSHEET_NETWORK: "off" }).reason).toBe("network_off");
      expect(selectServerCache({ VERCEL: "1", VERCEL_ENV: "preview", SESSION_SECRET: SECRET }).reason).toBe("store_variables_missing");
      expect(selectServerCache({ ...kv, KV_REST_API_URL: "rediss://default:MADE-UP-PASSWORD@example-db.upstash.invalid:6379" }).reason).toBe("store_address_invalid");
    } finally {
      log.mockRestore();
    }
  });

  it("on Vercel it asks redis.ts by default: configured means shared; a short SESSION_SECRET or the offline guard means memory only", async () => {
    const { selectServerCache } = await import("./deps");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const kv = { VERCEL: "1", VERCEL_ENV: "preview", SESSION_SECRET: SECRET, KV_REST_API_URL: "https://example.upstash.io", KV_REST_API_TOKEN: "t" };
      expect(selectServerCache(kv).kind).toBe("shared"); // the client is built, nothing is sent
      expect(selectServerCache({ ...kv, SESSION_SECRET: "short" }).kind).toBe("memory");
      expect(selectServerCache({ ...kv, OFFERSHEET_NETWORK: "off" }).kind).toBe("memory");
    } finally {
      log.mockRestore();
    }
  });

  it("on Vercel, a Redis address the client refuses (the TCP connection string, which carries the password) runs on memory, logged by name only (review CA-5)", async () => {
    const { selectServerCache } = await import("./deps");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const bad = { VERCEL: "1", VERCEL_ENV: "preview", SESSION_SECRET: SECRET, KV_REST_API_URL: "rediss://default:MADE-UP-PASSWORD@example-db.upstash.invalid:6379", KV_REST_API_TOKEN: "t" };
      const picked = selectServerCache(bad);
      expect(picked.kind).toBe("memory");
      expect(picked.cache).toBeInstanceOf(MemoryLruCache);
      expect(picked.lock).toBeUndefined();
      const lines = log.mock.calls.map((c) => String(c[0]));
      expect(lines.map((l) => JSON.parse(l) as unknown)).toEqual([
        { route: "server", event: "redis_config_invalid", platform: "upstash", errorName: "UrlError" },
        { route: "server", event: "cache_memory_only" },
      ]);
      for (const line of lines) expect(line).not.toContain("MADE-UP-PASSWORD");
    } finally {
      log.mockRestore();
    }
  });

  it("the cache and the lock share one breaker: an outage the cache finds lets the lock's fetches through without asking Redis (review CA-1)", async () => {
    const { selectServerCache } = await import("./deps");
    let calls = 0;
    const down = new Proxy({} as RedisLike, { get: () => () => (calls++, Promise.reject(Object.assign(new Error("fetch failed"), { name: "TypeError" }))) });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const picked = selectServerCache({ VERCEL: "1", VERCEL_ENV: "preview", SESSION_SECRET: SECRET }, down);
      expect(picked.kind).toBe("shared");
      expect(await picked.cache.get("k", 60_000)).toBeUndefined();
      expect(await picked.lock?.run("k", async () => "copy", async () => "fetched")).toBe("fetched");
      expect(calls).toBe(1);
    } finally {
      log.mockRestore();
    }
  });
});
