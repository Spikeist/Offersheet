/**
 * Cross-instance single-flight (planner reply to Checkpoint 4c, Part B, B1: the shared cache; track CA): two server
 * instances (two HTTP clients, each its own memory) over one Redis (FakeRedis). League-independent entries (cache.public)
 * are fetched by one instance while the other waits for its copy; league data isn't locked; without the lock (this
 * computer) nothing changes. No network.
 */
import { describe, expect, it, vi } from "vitest";
import { MemoryCache, MemoryLruCache, RedisCache, RedisCacheLock, SharedCacheBreaker, TieredCache, type Cache } from "./cache";
import { newRequestScope, runInRequestScope } from "./deadline";
import { createHttpClient } from "./http";
import { FakeRedis, type RedisLike } from "./redis";

const ENV = { SESSION_SECRET: "s".repeat(40), VERCEL_ENV: "preview" } as const;
const HOUR = 60 * 60_000;

/** A fetch whose answers wait until release(), counting every attempt. */
function heldFetch(status = 200, body = '{"v":1}') {
  let calls = 0;
  let open!: () => void;
  const held = new Promise<void>((r) => (open = r));
  const impl = (async () => {
    calls++;
    await held;
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls: () => calls, release: () => open() };
}

/** One server instance on the shared cache: its own memory tier, the shared Redis, the lock (as src/app/api/_lib/deps.ts builds it). */
function instance(redis: FakeRedis, fetchImpl: typeof fetch, withLock = true) {
  const cache: Cache = new TieredCache(new MemoryLruCache(), new RedisCache(redis, { env: ENV }));
  const lock = new RedisCacheLock(redis, { env: ENV, pollMs: 5, waitMs: 2_000 });
  return createHttpClient({ cache, fetchImpl, budget: null, maxRetries: 0, ...(withLock ? { lock } : {}) });
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PUBLIC = { cache: { key: "sleeper:https://example.invalid/projections/4#r1", ttlMs: HOUR, public: true } };

describe("cross-instance single-flight (HttpClientOptions.lock)", () => {
  it("two instances asking for the same league-independent entry at once make one request; the other serves its copy as a cache hit", async () => {
    const redis = new FakeRedis();
    const f = heldFetch();
    const a = instance(redis, f.impl);
    const b = instance(redis, f.impl);
    const first = a.get("https://example.invalid/projections/4", PUBLIC);
    await tick(5);
    const second = b.get("https://example.invalid/projections/4", PUBLIC);
    await tick(20);
    f.release();
    const [ra, rb] = await Promise.all([first, second]);
    expect(f.calls()).toBe(1);
    expect(ra).toMatchObject({ status: 200, json: { v: 1 }, fromCache: false });
    expect(rb).toMatchObject({ status: 200, json: { v: 1 }, fromCache: true, fetchedAt: ra.fetchedAt });
    // The lock is gone once the holder wrote the cache; the entry is in Redis under its hidden key only.
    expect(redis.keys()).toHaveLength(1);
    expect(redis.keys()[0]).toMatch(/^os:preview:c:/);
  });

  it("a refresh: an older copy Redis still keeps (past its TTL) is never taken for the holder's, by either instance's memory", async () => {
    const redis = new FakeRedis();
    // Yesterday's copy, retained 7 days but served only 1 hour.
    const seed = new TieredCache(new MemoryLruCache(), new RedisCache(redis, { env: ENV }));
    const oldAt = Date.now() - 2 * HOUR;
    await seed.set("sleeper:https://example.invalid/projections/4#r1", { status: 200, contentType: "application/json", text: '{"v":0}', fetchedAt: oldAt }, 7 * 24 * HOUR, oldAt);
    const f = heldFetch(200, '{"v":"fresh"}');
    const a = instance(redis, f.impl);
    const b = instance(redis, f.impl);
    const first = a.get("https://example.invalid/projections/4", PUBLIC);
    await tick(5);
    const second = b.get("https://example.invalid/projections/4", PUBLIC);
    await tick(30); // b has polled while a's fetch is held
    f.release();
    const [ra, rb] = await Promise.all([first, second]);
    expect(f.calls()).toBe(1);
    expect(ra).toMatchObject({ json: { v: "fresh" }, fromCache: false });
    expect(rb).toMatchObject({ json: { v: "fresh" }, fromCache: true });
    // b's memory holds the new copy, not yesterday's.
    expect(await b.get("https://example.invalid/projections/4", PUBLIC)).toMatchObject({ json: { v: "fresh" }, fromCache: true });
  });

  it("a holder whose answer can't be cached (a 404) frees the waiter at once: it asks for itself, without waiting out the lock", async () => {
    const redis = new FakeRedis();
    const f = heldFetch(404, "null");
    const a = instance(redis, f.impl);
    const b = instance(redis, f.impl);
    const started = Date.now();
    const first = a.get("https://example.invalid/missing", PUBLIC);
    await tick(5);
    const second = b.get("https://example.invalid/missing", PUBLIC);
    await tick(10);
    f.release();
    const [ra, rb] = await Promise.all([first, second]);
    expect([ra.status, rb.status]).toEqual([404, 404]);
    expect(f.calls()).toBe(2);
    expect(Date.now() - started).toBeLessThan(1_500); // the waiter's window is 2 s
  });

  it("league data (no public flag) isn't locked: each instance fetches its own (in-process single-flight only)", async () => {
    const redis = new FakeRedis();
    const f = heldFetch();
    const a = instance(redis, f.impl);
    const b = instance(redis, f.impl);
    const league = { cache: { key: "espn:public:2026:123:league", ttlMs: 10 * 60_000 } };
    const both = Promise.all([a.get("https://example.invalid/league", league), b.get("https://example.invalid/league", league)]);
    await tick(5);
    f.release();
    await both;
    expect(f.calls()).toBe(2);
  });

  it("a holder whose fetch fails writes nothing: the waiter fetches for itself after its wait, and a failure is never served as a copy", async () => {
    const redis = new FakeRedis();
    let calls = 0;
    let open!: () => void;
    const held = new Promise<void>((r) => (open = r));
    const impl = (async () => {
      const n = ++calls;
      if (n === 1) {
        await held;
        return new Response("", { status: 503 });
      }
      return new Response('{"v":2}', { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const a = instance(redis, impl);
    const lock = new RedisCacheLock(redis, { env: ENV, pollMs: 5, waitMs: 60 });
    const b = createHttpClient({ cache: new TieredCache(new MemoryLruCache(), new RedisCache(redis, { env: ENV })), fetchImpl: impl, budget: null, maxRetries: 0, lock });
    const first = a.get("https://example.invalid/p", PUBLIC);
    await tick(5);
    const second = b.get("https://example.invalid/p", PUBLIC);
    await tick(80); // b waited out its 60 ms and fetched for itself
    open();
    const [ra, rb] = await Promise.all([first, second]);
    expect(ra.status).toBe(503);
    expect(rb).toMatchObject({ status: 200, json: { v: 2 }, fromCache: false });
    expect(calls).toBe(2);
  });

  describe("Upstash slow or down (review CA-1: one shared breaker, every command time-boxed)", () => {
    /** A Redis whose every command never answers, or fails at once, counting them (Upstash unreachable). */
    function deadRedis(mode: "hangs" | "fails"): { redis: RedisLike; calls: () => number } {
      let n = 0;
      const redis = new Proxy({} as RedisLike, {
        get: () => () => {
          n++;
          return mode === "hangs" ? new Promise(() => {}) : Promise.reject(Object.assign(new Error("fetch failed"), { name: "TypeError" }));
        },
      });
      return { redis, calls: () => n };
    }

    for (const mode of ["hangs", "fails"] as const) {
      it(`a Redis that ${mode === "hangs" ? "never answers" : "fails at once"}: an import's 12 requests (8 public, 4 league) are all answered at the sources' speed, after at most one timeout`, async () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
          const dead = deadRedis(mode);
          // As src/app/api/_lib/deps.ts builds it, with a short timeout to keep the test quick (production: 1 s).
          const breaker = new SharedCacheBreaker({ timeoutMs: 100 });
          const cache = new TieredCache(new MemoryLruCache(), new RedisCache(dead.redis, { env: ENV, breaker }));
          const lock = new RedisCacheLock(dead.redis, { env: ENV, breaker, pollMs: 5, waitMs: 2_000 });
          let sourceCalls = 0;
          const fetchImpl = (async () => (sourceCalls++, new Response('[{"v":1}]', { status: 200, headers: { "content-type": "application/json" } }))) as unknown as typeof fetch;
          const http = createHttpClient({ cache, lock, fetchImpl, budget: null, maxRetries: 0 });
          const scope = newRequestScope("import", Date.now(), 15_000);
          const started = Date.now();
          const statuses = await runInRequestScope(scope, async () => {
            const out: number[] = [];
            // Each on its own host, so the per-host pacing adds no wait.
            for (let i = 0; i < 12; i++) {
              const res = await http.get(`https://h${i}.example.invalid/x`, { cache: { key: `probe:${i}`, ttlMs: HOUR, ...(i < 8 ? { public: true } : {}) } });
              out.push(res.status);
            }
            return out;
          });
          expect(statuses).toEqual(Array(12).fill(200));
          expect(sourceCalls).toBe(12);
          expect(Date.now() - started).toBeLessThan(1_500);
          expect(dead.calls()).toBe(1); // the first command found the outage; nothing more was sent
          expect([...scope.cut.busy, ...scope.cut.slow, ...scope.cut.skipped]).toEqual([]);
          // Said once, by name only.
          const events = log.mock.calls.map((c) => JSON.parse(String(c[0])) as { event: string; errorName?: string });
          expect(events).toEqual([{ route: "import", event: "cache_read_failed", platform: "upstash", errorName: mode === "hangs" ? "TimeoutError" : "TypeError" }]);
        } finally {
          log.mockRestore();
        }
      });
    }

    it("while Redis is paused the lock lets every fetch through without a command, and the cache still serves this instance's memory", async () => {
      const dead = deadRedis("fails");
      const breaker = new SharedCacheBreaker();
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const cache = new TieredCache(new MemoryLruCache(), new RedisCache(dead.redis, { env: ENV, breaker }));
        const lock = new RedisCacheLock(dead.redis, { env: ENV, breaker });
        expect(await cache.get("k", HOUR)).toBeUndefined(); // the outage is found here
        expect(await lock.run("k", async () => "copy", async () => "fetched")).toBe("fetched");
        expect(dead.calls()).toBe(1);
      } finally {
        log.mockRestore();
      }
    });
  });

  it("without the lock (this computer: the file cache, tests, scripts) nothing changes: two clients fetch on their own", async () => {
    const f = heldFetch();
    const a = createHttpClient({ cache: new MemoryCache(), fetchImpl: f.impl, budget: null });
    const b = createHttpClient({ cache: new MemoryCache(), fetchImpl: f.impl, budget: null });
    const both = Promise.all([a.get("https://example.invalid/x", PUBLIC), b.get("https://example.invalid/x", PUBLIC)]);
    await tick(5);
    f.release();
    await both;
    expect(f.calls()).toBe(2);
    // A lock given to a client without a cache is ignored too.
    const g = heldFetch();
    const bare = createHttpClient({ fetchImpl: g.impl, budget: null, lock: new RedisCacheLock(new FakeRedis(), { env: ENV }) });
    const one = bare.get("https://example.invalid/y", PUBLIC);
    g.release();
    expect((await one).status).toBe(200);
    expect(g.calls()).toBe(1);
  });
});
