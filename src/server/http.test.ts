import { afterEach, describe, expect, it, vi } from "vitest";
import { HOUR, MemoryCache, MINUTE, TTL, credentialScope, leagueTtl, type Cache } from "./cache";
import { createHttpClient, quoteBigInts, retryAfterMs } from "./http";

type FakeAnswer = { status: number; body: string; type?: string; headers?: Record<string, string> } | "network error";

function fakeFetch(responses: FakeAnswer[]) {
  const calls: { url: string; cookie?: string; at: number }[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), cookie: headers.Cookie, at: Date.now() });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    if (r === "network error") throw new TypeError("fetch failed");
    return new Response(r.body, { status: r.status, headers: { "content-type": r.type ?? "application/json", ...r.headers } });
  }) as typeof fetch;
  return { impl, calls };
}

const T0 = Date.UTC(2026, 8, 29, 21, 0, 0);

/** Runs the fake clock until the promise settles (backoff and pacing sleeps). */
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  void p.then(
    () => (done = true),
    () => (done = true),
  );
  for (let i = 0; i < 1_000 && !done; i++) await vi.advanceTimersByTimeAsync(100);
  return p;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("server HttpClient", () => {
  it("retries 5xx, then returns the success", async () => {
    vi.useFakeTimers({ now: T0 });
    const f = fakeFetch([{ status: 503, body: "" }, { status: 200, body: '{"a":1}' }]);
    const http = createHttpClient({ fetchImpl: f.impl, maxRetries: 2 });
    const res = await settle(http.get("https://example.invalid/x"));
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ a: 1 });
    expect(f.calls).toHaveLength(2);
  });

  it("never retries 403 or HTML login pages", async () => {
    const f = fakeFetch([{ status: 403, body: "<html>login</html>", type: "text/html" }]);
    const http = createHttpClient({ fetchImpl: f.impl });
    const res = await http.get("https://example.invalid/private", { cookie: "espn_s2=x; SWID={y}" });
    expect(res.status).toBe(403);
    expect(res.isHtml).toBe(true);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.cookie).toBe("espn_s2=x; SWID={y}");
  });

  it("caches 200 JSON bodies and serves them without the network", async () => {
    const f = fakeFetch([{ status: 200, body: '{"n":7}' }]);
    const http = createHttpClient({ fetchImpl: f.impl, cache: new MemoryCache() });
    const key = `espn:${credentialScope("s2", "{swid}")}:league`;
    await http.get("https://example.invalid/c", { cache: { key, ttlMs: 60_000 } });
    const again = await http.get("https://example.invalid/c", { cache: { key, ttlMs: 60_000 } });
    expect(again.fromCache).toBe(true);
    expect(again.json).toEqual({ n: 7 });
    expect(f.calls).toHaveLength(1);
  });

  it("reports when a body was really fetched, also for a cached copy", async () => {
    const f = fakeFetch([{ status: 200, body: '{"n":8}' }]);
    const http = createHttpClient({ fetchImpl: f.impl, cache: new MemoryCache() });
    const first = await http.get("https://example.invalid/t", { cache: { key: "t", ttlMs: 60_000 } });
    expect(typeof first.fetchedAt).toBe("number");
    const again = await http.get("https://example.invalid/t", { cache: { key: "t", ttlMs: 60_000 } });
    expect(again.fromCache).toBe(true);
    expect(again.fetchedAt).toBe(first.fetchedAt);
  });

  it("uses the 10-minute league TTL, or 1 minute after Refresh", () => {
    expect(leagueTtl()).toBe(TTL.league);
    expect(leagueTtl(false)).toBe(10 * 60_000);
    expect(leagueTtl(true)).toBe(TTL.leagueRefresh);
    expect(TTL.leagueRefresh).toBe(60_000);
  });

  it("does not retry MFL hosts at all", async () => {
    const f = fakeFetch([{ status: 500, body: "" }, { status: 200, body: "{}" }]);
    const http = createHttpClient({ fetchImpl: f.impl, maxRetries: 3 });
    const res = await http.get("https://www66.myfantasyleague.com/2026/export?TYPE=league&JSON=1");
    expect(res.status).toBe(500);
    expect(f.calls).toHaveLength(1);
  });

  it("keeps 19-digit IDs exact when asked", async () => {
    const f = fakeFetch([{ status: 200, body: '[{"draft_id":1234567890123456789,"rate":0.030303030303030304}]' }]);
    const http = createHttpClient({ fetchImpl: f.impl });
    const res = await http.get("https://example.invalid/d", { bigIntsAsStrings: true });
    expect(res.json).toEqual([{ draft_id: "1234567890123456789", rate: 0.030303030303030304 }]);
    expect(quoteBigInts("[1.5e+25]")).toBe("[1.5e+25]");
  });
});

describe("HttpClient retries (review HTTP-4, HTTP-6)", () => {
  it("retries a 429 after its Retry-After", async () => {
    vi.useFakeTimers({ now: T0 });
    const f = fakeFetch([{ status: 429, body: "", headers: { "retry-after": "2" } }, { status: 200, body: '{"ok":true}' }]);
    const http = createHttpClient({ fetchImpl: f.impl, maxRetries: 1 });
    const res = await settle(http.get("https://example.invalid/limited"));
    expect(res.status).toBe(200);
    expect(f.calls.map((c) => c.at - T0)).toEqual([0, 2000]);
  });

  it("returns a 429 at once when Retry-After asks for more than a minute (seconds or an HTTP date), instead of retrying early", async () => {
    vi.useFakeTimers({ now: T0 });
    for (const retryAfter of ["120", new Date(T0 + 90_000).toUTCString()]) {
      const f = fakeFetch([{ status: 429, body: "", headers: { "retry-after": retryAfter } }, { status: 200, body: "{}" }]);
      const http = createHttpClient({ fetchImpl: f.impl, maxRetries: 3 });
      const res = await settle(http.get("https://example.invalid/limited"));
      expect(res.status, retryAfter).toBe(429);
      expect(f.calls).toHaveLength(1);
    }
  });

  it("honours an HTTP-date Retry-After under a minute", async () => {
    vi.useFakeTimers({ now: T0 });
    const f = fakeFetch([{ status: 503, body: "", headers: { "retry-after": new Date(T0 + 5_000).toUTCString() } }, { status: 200, body: "{}" }]);
    const http = createHttpClient({ fetchImpl: f.impl, maxRetries: 1 });
    expect((await settle(http.get("https://example.invalid/busy"))).status).toBe(200);
    expect(f.calls.map((c) => c.at - T0)).toEqual([0, 5_000]);
  });

  it("parses Retry-After values", () => {
    expect(retryAfterMs("5", T0)).toBe(5_000);
    expect(retryAfterMs("0", T0)).toBe(0);
    expect(retryAfterMs(new Date(T0 + 30_000).toUTCString(), T0)).toBe(30_000);
    expect(retryAfterMs(new Date(T0 - 30_000).toUTCString(), T0)).toBe(0);
    expect(retryAfterMs("soon", T0)).toBeUndefined();
    expect(retryAfterMs(null, T0)).toBeUndefined();
  });

  it("turns a network error into status 0 after its retries", async () => {
    vi.useFakeTimers({ now: T0 });
    const f = fakeFetch(["network error"]);
    const http = createHttpClient({ fetchImpl: f.impl, maxRetries: 1 });
    const res = await settle(http.get("https://example.invalid/down"));
    expect(res).toMatchObject({ status: 0, ok: false, fromCache: false, text: "" });
    expect(f.calls).toHaveLength(2);
    // The retry waited out the exponential backoff (1 s plus up to 300 ms of jitter).
    const gap = (f.calls[1]?.at ?? 0) - (f.calls[0]?.at ?? 0);
    expect(gap).toBeGreaterThanOrEqual(1000);
    expect(gap).toBeLessThan(1300);
  });

  it("treats a timeout as a network error", async () => {
    const impl = ((_url: string | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
    const http = createHttpClient({ fetchImpl: impl });
    await expect(http.get("https://example.invalid/hang", { timeoutMs: 20, maxRetries: 0 })).resolves.toMatchObject({ status: 0, ok: false });
  });

  it("lets a request set its own retry count over the client's", async () => {
    vi.useFakeTimers({ now: T0 });
    const none = fakeFetch([{ status: 503, body: "" }, { status: 200, body: "{}" }]);
    expect((await settle(createHttpClient({ fetchImpl: none.impl, maxRetries: 3 }).get("https://example.invalid/a", { maxRetries: 0 }))).status).toBe(503);
    expect(none.calls).toHaveLength(1);
    const one = fakeFetch([{ status: 503, body: "" }, { status: 503, body: "" }, { status: 200, body: "{}" }]);
    expect((await settle(createHttpClient({ fetchImpl: one.impl, maxRetries: 3 }).get("https://example.invalid/b", { maxRetries: 1 }))).status).toBe(503);
    expect(one.calls).toHaveLength(2);
  });

  it("paces requests per host, with all MFL hosts in one bucket", async () => {
    vi.useFakeTimers({ now: T0 });
    const f = fakeFetch([{ status: 200, body: "{}" }]);
    const http = createHttpClient({ fetchImpl: f.impl });
    await settle(Promise.all([http.get("https://api.sleeper.app/v1/a"), http.get("https://api.sleeper.app/v1/b"), http.get("https://lm-api-reads.fantasy.espn.com/x")]));
    const at = (host: string) => f.calls.filter((c) => new URL(c.url).host === host).map((c) => c.at - T0);
    expect(at("api.sleeper.app")).toEqual([0, 120]);
    expect(at("lm-api-reads.fantasy.espn.com")).toEqual([0]); // another host doesn't wait
    await settle(Promise.all([http.get("https://www66.myfantasyleague.com/2026/export?TYPE=league"), http.get("https://api.myfantasyleague.com/2026/export?TYPE=players")]));
    const mfl = f.calls.filter((c) => c.url.includes("myfantasyleague.com")).map((c) => c.at);
    expect((mfl[1] ?? 0) - (mfl[0] ?? 0)).toBe(1200);
  });
});

describe("HttpClient cache options (review HTTP-1, HTTP-3, HTTP-5)", () => {
  it("caches only bodies cacheIf accepts; a rejected body is still returned", async () => {
    vi.useFakeTimers({ now: T0 });
    const f = fakeFetch([{ status: 200, body: "[]" }, { status: 200, body: "[1,2,3]" }]);
    const cache = new MemoryCache();
    const http = createHttpClient({ fetchImpl: f.impl, cache });
    const opts = { cache: { key: "list", ttlMs: HOUR }, cacheIf: (r: { json: unknown }) => Array.isArray(r.json) && r.json.length > 0 };
    const empty = await settle(http.get("https://example.invalid/list", opts));
    expect(empty).toMatchObject({ status: 200, json: [], fromCache: false });
    expect(cache.keys()).toEqual([]);
    const full = await settle(http.get("https://example.invalid/list", opts));
    expect(full.json).toEqual([1, 2, 3]);
    expect(cache.keys()).toEqual(["list"]);
    expect((await settle(http.get("https://example.invalid/list", opts))).fromCache).toBe(true);
    expect(f.calls).toHaveLength(2);
  });

  it("never caches an HTML page or an error status", async () => {
    vi.useFakeTimers({ now: T0 });
    const f = fakeFetch([
      { status: 200, body: "<!DOCTYPE html><html>login</html>", type: "text/html" },
      { status: 404, body: '{"error":"nope"}' },
    ]);
    const cache = new MemoryCache();
    const http = createHttpClient({ fetchImpl: f.impl, cache });
    expect((await settle(http.get("https://example.invalid/p", { cache: { key: "p", ttlMs: HOUR } }))).isHtml).toBe(true);
    expect((await settle(http.get("https://example.invalid/p", { cache: { key: "p", ttlMs: HOUR } }))).status).toBe(404);
    expect(cache.keys()).toEqual([]);
  });

  it("with staleIfError, serves a retained copy (marked stale, with its original fetch time) when the live fetch fails or its body is rejected", async () => {
    vi.useFakeTimers({ now: T0 });
    let answer: FakeAnswer = { status: 200, body: '{"v":1}' };
    const calls: number[] = [];
    const impl = (async () => {
      calls.push(Date.now());
      if (answer === "network error") throw new TypeError("fetch failed");
      return new Response(answer.body, { status: answer.status, headers: { "content-type": answer.type ?? "application/json" } });
    }) as typeof fetch;
    const http = createHttpClient({ fetchImpl: impl, cache: new MemoryCache() });
    const opts = { cache: { key: "src", ttlMs: MINUTE, retainMs: HOUR, staleIfError: true }, cacheIf: (r: { json: unknown }) => (r.json as { v?: unknown } | undefined)?.v !== "bad", maxRetries: 0 };
    const url = "https://example.invalid/src";
    const fresh = await settle(http.get(url, opts));
    expect(fresh).toMatchObject({ json: { v: 1 }, fromCache: false, fetchedAt: T0 });
    expect(fresh.stale).toBeUndefined();

    vi.setSystemTime(T0 + 2 * MINUTE); // past the TTL, within the retention
    for (const failure of [{ status: 503, body: "" }, { status: 429, body: "" }, "network error", { status: 200, body: "<html>maintenance</html>", type: "text/html" }, { status: 200, body: '{"v":"bad"}' }] as FakeAnswer[]) {
      answer = failure;
      const res = await settle(http.get(url, opts));
      expect(res, JSON.stringify(failure)).toMatchObject({ status: 200, json: { v: 1 }, fromCache: true, stale: true, fetchedAt: T0 });
    }
    // A 404 is an answer, not an outage: returned as is.
    answer = { status: 404, body: "{}" };
    expect(await settle(http.get(url, opts))).toMatchObject({ status: 404, fromCache: false });
    // Without staleIfError the failure comes back.
    answer = { status: 503, body: "" };
    expect(await settle(http.get(url, { ...opts, cache: { key: "src", ttlMs: MINUTE, retainMs: HOUR } }))).toMatchObject({ status: 503 });
    // Past the retention the copy is gone.
    vi.setSystemTime(T0 + HOUR);
    expect(await settle(http.get(url, opts))).toMatchObject({ status: 503, fromCache: false });
    expect(calls.length).toBe(9);
  });

  it("a stale copy says what the failed live answer was (liveFailure: its status, 0 for no response, and whether it was a web page), so a caller can tell an outage from an unusable answer", async () => {
    vi.useFakeTimers({ now: T0 });
    let answer: FakeAnswer = { status: 200, body: '{"v":1}' };
    const impl = (async () => {
      if (answer === "network error") throw new TypeError("fetch failed");
      return new Response(answer.body, { status: answer.status, headers: { "content-type": answer.type ?? "application/json" } });
    }) as typeof fetch;
    const http = createHttpClient({ fetchImpl: impl, cache: new MemoryCache() });
    const opts = { cache: { key: "lf", ttlMs: MINUTE, retainMs: HOUR, staleIfError: true }, cacheIf: (r: { json: unknown }) => (r.json as { v?: unknown } | undefined)?.v !== "bad", maxRetries: 0 };
    const url = "https://example.invalid/lf";
    const fresh = await settle(http.get(url, opts));
    expect(fresh.liveFailure).toBeUndefined();
    expect((await settle(http.get(url, opts))).liveFailure).toBeUndefined(); // a cache hit
    vi.setSystemTime(T0 + 2 * MINUTE);
    const cases: [FakeAnswer, { status: number; isHtml: boolean }][] = [
      [{ status: 503, body: "" }, { status: 503, isHtml: false }],
      [{ status: 429, body: "" }, { status: 429, isHtml: false }],
      ["network error", { status: 0, isHtml: false }],
      [{ status: 200, body: "<html>maintenance</html>", type: "text/html" }, { status: 200, isHtml: true }],
      [{ status: 200, body: '{"v":"bad"}' }, { status: 200, isHtml: false }],
    ];
    for (const [a, failure] of cases) {
      answer = a;
      expect(await settle(http.get(url, opts)), JSON.stringify(a)).toMatchObject({ json: { v: 1 }, stale: true, liveFailure: failure });
    }
  });

  it("cacheOnly never asks the source: the copy within the TTL, else (staleIfError) a retained one marked stale, else a status-0 response", async () => {
    vi.useFakeTimers({ now: T0 });
    const f = fakeFetch([{ status: 200, body: '{"v":1}' }]);
    const http = createHttpClient({ fetchImpl: f.impl, cache: new MemoryCache() });
    const url = "https://example.invalid/only";
    const cache = { key: "only", ttlMs: MINUTE, retainMs: HOUR, staleIfError: true };
    // Nothing cached: status 0, and no request.
    expect(await settle(http.get(url, { cache, cacheOnly: true }))).toEqual({ status: 0, ok: false, isHtml: false, json: undefined, text: "", fromCache: false });
    expect(f.calls).toHaveLength(0);
    const stored = await settle(http.get(url, { cache })); // one live fetch stores a copy
    expect(f.calls).toHaveLength(1);
    const fetchedAt = stored.fetchedAt;
    // Within the TTL: the copy, as a cache hit.
    const hit = await settle(http.get(url, { cache, cacheOnly: true }));
    expect(hit).toMatchObject({ json: { v: 1 }, fromCache: true, fetchedAt });
    expect(hit.stale).toBeUndefined();
    // Past the TTL, within the retention: with staleIfError the retained copy, marked stale (no liveFailure: nothing was
    // asked); without staleIfError, status 0.
    vi.setSystemTime(T0 + 2 * MINUTE);
    const stale = await settle(http.get(url, { cache, cacheOnly: true }));
    expect(stale).toMatchObject({ json: { v: 1 }, fromCache: true, stale: true, fetchedAt });
    expect(stale.liveFailure).toBeUndefined();
    expect(await settle(http.get(url, { cache: { key: "only", ttlMs: MINUTE, retainMs: HOUR }, cacheOnly: true }))).toMatchObject({ status: 0, fromCache: false });
    // Past the retention: gone, status 0. A client without a cache: always status 0.
    vi.setSystemTime(T0 + 2 * HOUR);
    expect(await settle(http.get(url, { cache, cacheOnly: true }))).toMatchObject({ status: 0, fromCache: false });
    expect(await settle(createHttpClient({ fetchImpl: f.impl }).get(url, { cache, cacheOnly: true }))).toMatchObject({ status: 0, fromCache: false });
    expect(f.calls).toHaveLength(1);
  });

  it("keeps a fresh copy for retainMs even when a Refresh asks for a shorter TTL", async () => {
    vi.useFakeTimers({ now: T0 });
    const f = fakeFetch([{ status: 200, body: '{"v":1}' }]);
    const cache = new MemoryCache();
    const http = createHttpClient({ fetchImpl: f.impl, cache });
    await settle(http.get("https://example.invalid/l", { cache: { key: "l", ttlMs: MINUTE, retainMs: 10 * MINUTE } }));
    expect(await cache.get("l", Number.POSITIVE_INFINITY, T0 + 9 * MINUTE)).toBeDefined();
    expect(await cache.get("l", Number.POSITIVE_INFINITY, T0 + 10 * MINUTE)).toBeUndefined();
  });

  it("applies transformText before the body is parsed or cached", async () => {
    const f = fakeFetch([{ status: 200, body: '{"owner":"secret-ABC123","n":1}' }]);
    const cache = new MemoryCache();
    const http = createHttpClient({ fetchImpl: f.impl, cache });
    const opts = { cache: { key: "tx", ttlMs: HOUR }, transformText: (t: string) => t.replace(/secret-\w+/g, "pseudonym-1") };
    const res = await http.get("https://example.invalid/tx", opts);
    expect(res.json).toEqual({ owner: "pseudonym-1", n: 1 });
    expect(res.text).not.toContain("secret-");
    expect(JSON.stringify(cache.values())).not.toContain("secret-");
    expect((await http.get("https://example.invalid/tx", opts)).json).toEqual({ owner: "pseudonym-1", n: 1 });
  });

  it("serves the fresh response when the cache write fails, logging only the error's name", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: Cache = {
      get: async () => undefined,
      set: async () => {
        throw Object.assign(new Error("ENOSPC: no space left, writing .cache/app/secret-key.json"), { name: "DiskFullError" });
      },
    };
    const f = fakeFetch([{ status: 200, body: '{"ok":1}' }]);
    const http = createHttpClient({ fetchImpl: f.impl, cache: failing });
    const res = await http.get("https://example.invalid/leagues/123456", { cache: { key: "espn:cred-abc:league-123456", ttlMs: HOUR } });
    expect(res).toMatchObject({ status: 200, json: { ok: 1 }, fromCache: false });
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = String(spy.mock.calls[0]?.[0]);
    expect(logged).toContain("DiskFullError");
    for (const secret of ["123456", "secret-key", "cred-abc", "example.invalid", "ENOSPC"]) expect(logged).not.toContain(secret);
  });

  it("treats a cache that can't be read as a miss", async () => {
    const broken: Cache = {
      get: async () => {
        throw new Error("EACCES");
      },
      set: async () => {},
    };
    const f = fakeFetch([{ status: 200, body: '{"ok":2}' }]);
    const res = await createHttpClient({ fetchImpl: f.impl, cache: broken }).get("https://example.invalid/r", { cache: { key: "r", ttlMs: HOUR } });
    expect(res).toMatchObject({ status: 200, json: { ok: 2 } });
  });

  it("reports a cached body's original fetch time, or when it was stored for entries that lack one", async () => {
    const cache = new MemoryCache();
    const storedAt = Date.now() - 5 * MINUTE;
    await cache.set("with", { status: 200, contentType: "application/json", text: '{"a":1}', fetchedAt: storedAt - 1_000 }, HOUR, storedAt);
    await cache.set("without", { status: 200, contentType: "application/json", text: '{"a":2}' }, HOUR, storedAt);
    const http = createHttpClient({ fetchImpl: fakeFetch([{ status: 500, body: "" }]).impl, cache });
    expect(await http.get("https://example.invalid/with", { cache: { key: "with", ttlMs: HOUR } })).toMatchObject({ fromCache: true, json: { a: 1 }, fetchedAt: storedAt - 1_000 });
    expect(await http.get("https://example.invalid/without", { cache: { key: "without", ttlMs: HOUR } })).toMatchObject({ fromCache: true, json: { a: 2 }, fetchedAt: storedAt });
  });
});

describe("HttpClient single-flight (CLAUDE.md §2.10, Checkpoint 2)", () => {
  /** A fetch whose answers wait until release(): every attempt is recorded, and answers come from `answer(url, attempt)`. */
  function heldFetch(answer: (url: string, attempt: number) => FakeAnswer = () => ({ status: 200, body: '{"v":1}' })) {
    const calls: { url: string; cookie?: string }[] = [];
    let open!: () => void;
    const held = new Promise<void>((r) => (open = r));
    const impl = (async (url: string | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(url), cookie: headers.Cookie });
      const n = calls.length;
      await held;
      const a = answer(String(url), n);
      if (a === "network error") throw new TypeError("fetch failed");
      return new Response(a.body, { status: a.status, headers: { "content-type": a.type ?? "application/json" } });
    }) as typeof fetch;
    return { impl, calls, release: () => open() };
  }

  it("overlapping requests for the same cache key share one live fetch and one cache write; each gets its own response object", async () => {
    vi.useFakeTimers({ now: T0 });
    const f = heldFetch();
    const cache = new MemoryCache();
    const writes = vi.spyOn(cache, "set");
    const http = createHttpClient({ fetchImpl: f.impl, cache });
    const opts = { cache: { key: "sleeper:week-5", ttlMs: HOUR } };
    const a = http.get("https://example.invalid/w5", opts);
    const b = http.get("https://example.invalid/w5", opts);
    const c = http.get("https://example.invalid/w5", { ...opts, cache: { ...opts.cache, ttlMs: MINUTE } }); // a Refresh: joins too (nothing is cached yet)
    await vi.advanceTimersByTimeAsync(0);
    f.release();
    const [ra, rb, rc] = await settle(Promise.all([a, b, c]));
    expect(f.calls).toHaveLength(1);
    expect(writes).toHaveBeenCalledTimes(1);
    for (const r of [ra, rb, rc]) expect(r).toMatchObject({ status: 200, json: { v: 1 }, fromCache: false });
    expect(new Set([ra, rb, rc].map((r) => r.fetchedAt)).size).toBe(1);
    expect(new Set([ra, rb, rc]).size).toBe(3);
    // Settled: the entry is gone, and a later request reads the cache as usual.
    expect(await settle(http.get("https://example.invalid/w5", opts))).toMatchObject({ fromCache: true, json: { v: 1 } });
    expect(f.calls).toHaveLength(1);
  });

  it("different cache keys, requests without a cache key (they may carry cookies), and a client without a cache never share", async () => {
    vi.useFakeTimers({ now: T0 });
    const keyed = heldFetch();
    const http = createHttpClient({ fetchImpl: keyed.impl, cache: new MemoryCache() });
    const both = Promise.all([http.get("https://example.invalid/x", { cache: { key: "x", ttlMs: HOUR } }), http.get("https://example.invalid/x", { cache: { key: "y", ttlMs: HOUR } })]);
    keyed.release();
    await settle(both);
    expect(keyed.calls).toHaveLength(2);

    const unkeyed = heldFetch();
    const plain = createHttpClient({ fetchImpl: unkeyed.impl, cache: new MemoryCache() });
    const private2 = Promise.all([plain.get("https://example.invalid/p", { cookie: "espn_s2=a; SWID={1}" }), plain.get("https://example.invalid/p", { cookie: "espn_s2=b; SWID={2}" })]);
    unkeyed.release();
    await settle(private2);
    expect(unkeyed.calls.map((c) => c.cookie)).toEqual(["espn_s2=a; SWID={1}", "espn_s2=b; SWID={2}"]);

    const noCache = heldFetch();
    const bare = createHttpClient({ fetchImpl: noCache.impl });
    const two = Promise.all([bare.get("https://example.invalid/n", { cache: { key: "n", ttlMs: HOUR } }), bare.get("https://example.invalid/n", { cache: { key: "n", ttlMs: HOUR } })]);
    noCache.release();
    await settle(two);
    expect(noCache.calls).toHaveLength(2);
  });

  it("the body's parsing (bigIntsAsStrings) and transformText presence keep separate flights", async () => {
    vi.useFakeTimers({ now: T0 });
    const f = heldFetch(() => ({ status: 200, body: '[{"id":1234567890123456789}]' }));
    const http = createHttpClient({ fetchImpl: f.impl, cache: new MemoryCache() });
    const key = { cache: { key: "ids", ttlMs: HOUR } };
    const all = Promise.all([
      http.get("https://example.invalid/ids", { ...key, bigIntsAsStrings: true }),
      http.get("https://example.invalid/ids", { ...key, bigIntsAsStrings: true }),
      http.get("https://example.invalid/ids", key),
      http.get("https://example.invalid/ids", { ...key, transformText: (t) => t }),
    ]);
    f.release();
    const [exact, exact2, plainJson, transformed] = await settle(all);
    expect(f.calls).toHaveLength(3);
    expect(exact.json).toEqual([{ id: "1234567890123456789" }]);
    expect(exact2.json).toEqual([{ id: "1234567890123456789" }]);
    expect(plainJson.json).toEqual([{ id: 1234567890123456789 }]);
    expect(transformed.status).toBe(200);
  });

  it("a failure is shared, the entry is cleared, and a later request fetches again", async () => {
    vi.useFakeTimers({ now: T0 });
    const f = heldFetch((_, attempt) => (attempt === 1 ? { status: 503, body: "" } : { status: 200, body: '{"v":2}' }));
    const cache = new MemoryCache();
    const http = createHttpClient({ fetchImpl: f.impl, cache });
    const opts = { cache: { key: "flaky", ttlMs: HOUR }, maxRetries: 0 };
    const pair = Promise.all([http.get("https://example.invalid/f", opts), http.get("https://example.invalid/f", opts)]);
    f.release();
    const [a, b] = await settle(pair);
    expect(f.calls).toHaveLength(1);
    expect([a.status, b.status]).toEqual([503, 503]);
    expect(cache.keys()).toEqual([]);
    const later = await settle(http.get("https://example.invalid/f", opts));
    expect(later).toMatchObject({ status: 200, json: { v: 2 }, fromCache: false });
    expect(f.calls).toHaveLength(2);
    expect(cache.keys()).toEqual(["flaky"]);
  });

  it("a live fetch that throws (a transformText bug) rejects every caller and clears the entry", async () => {
    vi.useFakeTimers({ now: T0 });
    const f = heldFetch();
    const http = createHttpClient({ fetchImpl: f.impl, cache: new MemoryCache() });
    let broken = true;
    const opts = {
      cache: { key: "tx", ttlMs: HOUR },
      transformText: (t: string) => {
        if (broken) throw new Error("bug");
        return t;
      },
    };
    const pair = Promise.allSettled([http.get("https://example.invalid/t", opts), http.get("https://example.invalid/t", opts)]);
    f.release();
    expect((await settle(pair)).map((r) => r.status)).toEqual(["rejected", "rejected"]);
    broken = false;
    expect(await settle(http.get("https://example.invalid/t", opts))).toMatchObject({ status: 200, json: { v: 1 } });
    expect(f.calls).toHaveLength(2);
  });

  it("each request reads the cache first with its own TTL: a Refresh (1 minute) goes live while a normal request is served the copy", async () => {
    vi.useFakeTimers({ now: T0 });
    const f = heldFetch(() => ({ status: 200, body: '{"v":"new"}' }));
    const cache = new MemoryCache();
    await cache.set("league", { status: 200, contentType: "application/json", text: '{"v":"old"}', fetchedAt: T0 - 5 * MINUTE }, 10 * MINUTE, T0 - 5 * MINUTE);
    const http = createHttpClient({ fetchImpl: f.impl, cache });
    const normal = http.get("https://example.invalid/l", { cache: { key: "league", ttlMs: 10 * MINUTE } });
    const refresh = http.get("https://example.invalid/l", { cache: { key: "league", ttlMs: MINUTE, retainMs: 10 * MINUTE } });
    const refresh2 = http.get("https://example.invalid/l", { cache: { key: "league", ttlMs: MINUTE, retainMs: 10 * MINUTE } });
    f.release();
    const [n, r, r2] = await settle(Promise.all([normal, refresh, refresh2]));
    expect(n).toMatchObject({ fromCache: true, json: { v: "old" } });
    expect(r).toMatchObject({ fromCache: false, json: { v: "new" } });
    expect(r2).toMatchObject({ fromCache: false, json: { v: "new" } });
    expect(f.calls).toHaveLength(1);
  });

  it("staleIfError and cacheIf are each caller's own: a joiner is judged by its cacheIf on its own copy", async () => {
    vi.useFakeTimers({ now: T0 });
    const f = heldFetch(() => ({ status: 200, body: '{"v":"bad"}' }));
    const cache = new MemoryCache();
    await cache.set("src", { status: 200, contentType: "application/json", text: '{"v":"good"}', fetchedAt: T0 - HOUR }, 7 * 24 * HOUR, T0 - HOUR);
    const http = createHttpClient({ fetchImpl: f.impl, cache });
    const seen: { who: string; res: object }[] = [];
    const picky = (who: string) => (res: { json: unknown }) => (seen.push({ who, res }), (res.json as { v?: string }).v !== "bad");
    const lenient = (who: string) => (res: { json: unknown }) => (seen.push({ who, res }), true);
    const base = { key: "src", ttlMs: MINUTE, retainMs: 7 * 24 * HOUR };
    const starter = http.get("https://example.invalid/s", { cache: { ...base, staleIfError: true }, cacheIf: picky("starter") });
    const withFallback = http.get("https://example.invalid/s", { cache: { ...base, staleIfError: true }, cacheIf: picky("joiner-1") });
    const withoutFallback = http.get("https://example.invalid/s", { cache: base, cacheIf: picky("joiner-2") });
    const accepting = http.get("https://example.invalid/s", { cache: { ...base, staleIfError: true }, cacheIf: lenient("joiner-3") });
    f.release();
    const [s, j1, j2, j3] = await settle(Promise.all([starter, withFallback, withoutFallback, accepting]));
    expect(f.calls).toHaveLength(1);
    expect(s).toMatchObject({ stale: true, json: { v: "good" } }); // rejected by its cacheIf: the retained copy stands in
    expect(j1).toMatchObject({ stale: true, json: { v: "good" } });
    expect(j2).toMatchObject({ json: { v: "bad" }, fromCache: false }); // no fallback asked for
    expect(j3).toMatchObject({ json: { v: "bad" }, fromCache: false }); // its own cacheIf accepts the body
    // The rejected body was never cached (the starter's cacheIf decides the write).
    expect((await cache.get<{ text: string }>("src", Number.POSITIVE_INFINITY))?.value.text).toBe('{"v":"good"}');
    // Each cacheIf saw one object, the one its caller got back (so a caller that memoizes its check by object doesn't run it twice).
    expect(seen.map((x) => x.who)).toEqual(["starter", "joiner-1", "joiner-2", "joiner-3"]);
    expect(new Set(seen.map((x) => x.res)).size).toBe(4);
    expect(seen[2]?.res).toBe(j2);
    expect(seen[3]?.res).toBe(j3);
  });
});

describe("HTML detection (review HTTP-6)", () => {
  const get = async (body: string, type: string) => {
    const f = fakeFetch([{ status: 200, body, type }]);
    return createHttpClient({ fetchImpl: f.impl }).get("https://example.invalid/h");
  };

  it("detects XHTML and pages that start with an XML prolog or a comment", async () => {
    expect((await get('<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html><body>Sign in</body></html>', "application/xhtml+xml")).isHtml).toBe(true);
    expect((await get('<?xml version="1.0"?>\n<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN"><html>', "text/plain")).isHtml).toBe(true);
    expect((await get("<!-- served by edge-7 -->\n<html><body>login</body></html>", "text/plain")).isHtml).toBe(true);
    expect((await get("  <HTML lang=en>", "application/octet-stream")).isHtml).toBe(true);
    expect((await get("<html>", "text/html; charset=utf-8")).isHtml).toBe(true);
  });

  it("doesn't mistake JSON data for HTML", async () => {
    expect((await get('[{"note":"<html> in a string"}]', "text/plain")).isHtml).toBe(false);
    expect((await get('{"page":"<!DOCTYPE html>"}', "application/json")).isHtml).toBe(false);
    expect((await get("sleeper_id,name\n1,Zorblax Quintavious", "text/csv")).isHtml).toBe(false);
  });
});
