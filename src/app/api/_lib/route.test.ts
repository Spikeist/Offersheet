/**
 * withRoute (track RL): the per-IP rate limit, the request's scope and deadline, unexpected throws, the log and its
 * after-response write; and that every API route goes through it with a maxDuration above its deadline.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { createEspnSessionHandlers } from "@/app/api/session/espn/handler";
import { ROUTE_KINDS, deadlineMsOf, noteCut, requestScope, timeLeftMs, type RouteKind } from "@/server/deadline";
import { deadlines, rateLimits } from "@/server/limits";
import { setLogStoreForTests } from "@/server/log";
import { clientKey, createMemoryLimiter, resetProcessLimiterForTests } from "@/server/rateLimit";
import { FakeRedis, resetRedisForTests } from "@/server/redis";
import { errorResponse, jsonResponse } from "./respond";
import { withRoute } from "./route";

const T0 = Date.UTC(2026, 9, 4, 18, 0, 0);
const post = (ip = "203.0.113.9") => new Request("http://localhost:3001/api/import/espn", { method: "POST", headers: { "x-real-ip": ip } });
const ok = async () => jsonResponse({ ok: true });

function logLines(spy: { mock: { calls: unknown[][] } }): Array<Record<string, unknown>> {
  return spy.mock.calls.map((c) => String(c[0])).filter((s) => s.startsWith("{")).map((s) => JSON.parse(s) as Record<string, unknown>);
}

afterEach(() => {
  setLogStoreForTests(undefined);
  vi.restoreAllMocks();
});

describe("withRoute: the per-IP rate limit", () => {
  it("over the limit: 429, Retry-After, RATE_LIMITED in words, and the handler never runs; logged once per client and window", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = vi.fn(ok);
    const limiter = createMemoryLimiter({ limits: { ...rateLimits, import: { limit: 2, windowS: 600 } } });
    const route = withRoute("import", handler, { limiter, now: () => T0, platform: "espn" });
    expect((await route(post())).status).toBe(200);
    expect((await route(post())).status).toBe(200);
    const refused = await route(post());
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("600");
    // The wait in words is the Retry-After's (review RL-9).
    expect(await refused.json()).toEqual({ error: { code: "RATE_LIMITED", message: "You're going a bit fast. Try again in about 10 minutes." } });
    await route(post());
    expect(handler).toHaveBeenCalledTimes(2);
    expect(logLines(spy)).toEqual([{ route: "import", event: "rate_limited", code: "RATE_LIMITED", platform: "espn", status: 429 }]);
    // Another client, and another kind of route, have their own windows.
    expect((await route(post("198.51.100.7"))).status).toBe(200);
    expect((await withRoute("session", ok, { limiter, now: () => T0 })(post())).status).toBe(200);
  });

  it("a forged cross-site request is refused before it's counted, so another site can't spend a visitor's limit", async () => {
    const check = vi.fn(createMemoryLimiter().check);
    const handler = vi.fn(ok);
    const route = withRoute("import", handler, { limiter: { check } });
    const forged = new Request("http://localhost:3001/api/import/espn", { method: "POST", headers: { origin: "https://evil.example", host: "localhost:3001", "x-real-ip": "203.0.113.9" } });
    const res = await route(forged);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("BAD_ORIGIN");
    expect(check).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    // GETs too (review RL-6): a cross-origin fetch, and an <img> or no-cors GET (no Origin, Sec-Fetch-Site cross-site).
    const status = withRoute("session", ok, { limiter: { check } });
    expect((await status(new Request("http://localhost:3001/api/session/espn", { headers: { origin: "https://evil.example" } }))).status).toBe(403);
    expect((await status(new Request("http://localhost:3001/api/session/espn", { headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" } }))).status).toBe(403);
    expect(check).not.toHaveBeenCalled();
    // Our own pages (same-origin), a typed address (none) and curl (nothing) are counted and answered.
    for (const headers of [{ "sec-fetch-site": "same-origin" }, { "sec-fetch-site": "none" }, {}] as Array<Record<string, string>>) expect((await status(new Request("http://localhost:3001/api/session/espn", { headers }))).status).toBe(200);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("another site's <img> GETs can't lock a visitor out, and Forget my credentials is never refused (review RL-6)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const limiter = createMemoryLimiter();
    const handlers = createEspnSessionHandlers({ env: () => ({ SESSION_SECRET: "x".repeat(40) }) });
    const GET = withRoute("session", handlers.GET, { limiter, platform: "espn" });
    const DELETE = withRoute("session", handlers.DELETE, { limiter, platform: "espn", rateLimited: false });
    const ip = "203.0.113.50";
    for (let i = 0; i < 25; i++) {
      const r = await GET(new Request("https://offersheet.example/api/session/espn", { headers: { "x-real-ip": ip, "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" } }));
      expect(r.status).toBe(403);
    }
    const sameSite = { "x-real-ip": ip, origin: "https://offersheet.example", host: "offersheet.example", "sec-fetch-site": "same-origin" };
    const forget = () => DELETE(new Request("https://offersheet.example/api/session/espn", { method: "DELETE", headers: sameSite }));
    expect((await forget()).status).toBe(200);
    // Even a client over its session limit can forget its cookies.
    for (let i = 0; i < rateLimits.session.limit; i++) await GET(new Request("https://offersheet.example/api/session/espn", { headers: sameSite }));
    expect((await GET(new Request("https://offersheet.example/api/session/espn", { headers: sameSite }))).status).toBe(429);
    expect((await forget()).status).toBe(200);
    // A DELETE from another site is still refused.
    expect((await DELETE(new Request("https://offersheet.example/api/session/espn", { method: "DELETE", headers: { ...sameSite, origin: "https://evil.example", "sec-fetch-site": "cross-site" } }))).status).toBe(403);
  });

  it("a limiter that rejects anyway lets the request through (fail open)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const route = withRoute("model", ok, { limiter: { check: () => Promise.reject(new Error("x")) } });
    expect((await route(post())).status).toBe(200);
  });

  it("a Redis address that can't be used (the rediss:// URL with its password) fails open, logged by the error's name only (review RL-7)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const names = ["KV_REST_API_URL", "KV_REST_API_TOKEN", "SESSION_SECRET", "VERCEL", "OFFERSHEET_NETWORK"] as const;
    const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
    process.env.KV_REST_API_URL = "rediss://default:FAKE-PASSWORD-NOT-REAL@example-12345.upstash.io:6379";
    process.env.KV_REST_API_TOKEN = "FAKE-PASSWORD-NOT-REAL";
    process.env.SESSION_SECRET = "s".repeat(40);
    process.env.VERCEL = "1";
    delete process.env.OFFERSHEET_NETWORK;
    resetRedisForTests();
    resetProcessLimiterForTests();
    try {
      const route = withRoute("session", ok, { after: () => {} });
      const res = await route(new Request("http://localhost:3001/api/session/espn", { headers: { "x-real-ip": "203.0.113.9" } }));
      expect(res.status).toBe(200);
      expect(logLines(spy)).toContainEqual({ route: "session", event: "redis_config_invalid", platform: "upstash", errorName: "UrlError" });
      expect(JSON.stringify(spy.mock.calls)).not.toContain("FAKE-PASSWORD");
    } finally {
      for (const n of names) {
        if (saved[n] === undefined) delete process.env[n];
        else process.env[n] = saved[n];
      }
      resetRedisForTests();
      resetProcessLimiterForTests();
    }
  });
});

describe("withRoute: the request's scope", () => {
  it("runs the handler inside the scope of its kind, with that kind's deadline", async () => {
    const seen: Array<{ route?: RouteKind; left: number }> = [];
    for (const kind of ROUTE_KINDS) {
      await withRoute(kind, async () => {
        seen.push({ route: requestScope()?.route, left: timeLeftMs() });
        return jsonResponse({});
      }, { limiter: createMemoryLimiter() })(post());
    }
    expect(seen.map((s) => s.route)).toEqual([...ROUTE_KINDS]);
    seen.forEach((s, i) => {
      expect(s.left).toBeLessThanOrEqual(deadlineMsOf(ROUTE_KINDS[i] as RouteKind));
      expect(s.left).toBeGreaterThan(deadlineMsOf(ROUTE_KINDS[i] as RouteKind) - 5_000);
    });
    expect(requestScope()).toBeUndefined();
  });

  it("carries the client's rate-limit id (an HMAC, never the address) for its share of the daily budgets (review RL-4)", async () => {
    let client: string | undefined;
    await withRoute(
      "import",
      async () => {
        client = requestScope()?.client;
        return jsonResponse({});
      },
      { limiter: createMemoryLimiter() },
    )(post("203.0.113.77"));
    expect(client).toBe(clientKey(post("203.0.113.77")));
    expect(client).not.toContain("203.0.113");
  });

  it("a handler that throws (a bug) answers INTERNAL, logged by the error's name only", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const route = withRoute(
      "import",
      async () => {
        throw new RangeError("league 12345678 broke for owner {00000000-0000-4000-8000-000000000000}");
      },
      { limiter: createMemoryLimiter(), platform: "sleeper" },
    );
    const res = await route(post());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "INTERNAL", message: "Something went wrong on our side. Please try again." } });
    const logged = logLines(spy);
    expect(logged[0]).toEqual({ route: "import", event: "unexpected_route", platform: "sleeper", errorName: "RangeError" });
    expect(logged[1]).toMatchObject({ route: "import", event: "error_response", code: "INTERNAL", platform: "sleeper", status: 500 });
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/12345678|00000000-0000|203\.0\.113/);
  });

  it("logs answers of 500 or more (code, status, time) and each source the deadline cut, by why; a user's own mistake (4xx) isn't logged", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let t = T0;
    const now = () => t;
    const limiter = createMemoryLimiter();
    await withRoute("import", async () => errorResponse("LEAGUE_NOT_FOUND"), { limiter, now })(post());
    expect(logLines(spy)).toEqual([]);
    await withRoute(
      "model",
      async () => {
        noteCut("slow", "sleeper");
        noteCut("busy", "cache");
        noteCut("skipped", "espn");
        noteCut("budget", "fantasycalc"); // a budget's refusal is logged by the budget itself, once a day
        t += 1234;
        return errorResponse("SOURCE_SLOW");
      },
      { limiter, now, platform: "sleeper" },
    )(post());
    expect(logLines(spy)).toEqual([
      { route: "model", event: "deadline_slow", platform: "sleeper", ms: 1234 },
      { route: "model", event: "deadline_busy", platform: "cache", ms: 1234 },
      { route: "model", event: "deadline_skipped", platform: "espn", ms: 1234 },
      { route: "model", event: "error_response", code: "SOURCE_SLOW", platform: "sleeper", status: 504, ms: 1234 },
    ]);
  });

  it("with the shared store, the request's lines are written after the response, through after()", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = new FakeRedis();
    setLogStoreForTests(store);
    const tasks: Array<() => Promise<void>> = [];
    const route = withRoute("import", async () => errorResponse("SOURCE_DOWN"), { limiter: createMemoryLimiter(), after: (task) => void tasks.push(task) });
    const res = await route(post());
    expect(res.status).toBe(502);
    expect(store.stats.commands).toBe(0); // nothing written before the answer
    expect(tasks).toHaveLength(1);
    await tasks[0]?.();
    const key = store.keys()[0] ?? "";
    expect(key).toMatch(/^os:local:log:\d{4}-\d{2}-\d{2}$/);
    expect((await store.lrange(key, 0, -1)).map((s) => JSON.parse(s).event)).toEqual(["error_response"]);
    // Nothing to write: no after() at all.
    await withRoute("import", ok, { limiter: createMemoryLimiter(), after: (task) => void tasks.push(task) })(post());
    expect(tasks).toHaveLength(1);
    // Outside a Next request after() throws: the write happens anyway, without holding the answer.
    const outside = withRoute("import", async () => errorResponse("INTERNAL"), {
      limiter: createMemoryLimiter(),
      after: () => {
        throw new Error("`after` was called outside a request scope");
      },
    });
    expect((await outside(post())).status).toBe(500);
    await vi.waitFor(async () => expect(await store.lrange(key, 0, -1)).toHaveLength(2));
  });
});

describe("every API route goes through withRoute, with a maxDuration a little above its deadline", () => {
  const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const routeFiles: string[] = [];
  // Folders starting with "_" are private in the App Router (this one, _lib, holds withRoute itself), never routes.
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && !e.name.startsWith("_")) walk(p);
      else if (e.isFile() && e.name === "route.ts") routeFiles.push(p);
    }
  };
  walk(apiDir);

  it("finds the routes", () => {
    expect(routeFiles.length).toBeGreaterThanOrEqual(5);
  });

  it.each(routeFiles.map((f) => [path.relative(apiDir, f).split(path.sep).join("/"), f]))("%s", (_name, file) => {
    const text = readFileSync(file, "utf8");
    // Next reads route segment config statically: maxDuration must be a number literal.
    const maxDuration = Number(/^export const maxDuration = (\d+);$/m.exec(text)?.[1]);
    const kinds = [...text.matchAll(/withRoute\(\s*"([a-z]+)"/g)].map((m) => m[1] as RouteKind);
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) {
      expect(ROUTE_KINDS).toContain(kind);
      // Above the deadline (the handler still has to answer; a request's own fetch may wait twice the cache's grace past
      // it, src/server/http.ts), at most 300 s (Vercel Hobby with Fluid compute).
      expect(maxDuration * 1000).toBeGreaterThanOrEqual(deadlineMsOf(kind) + Math.max(5_000, 2 * deadlines.cacheGraceMs + 1_000));
      expect(maxDuration).toBeLessThanOrEqual(300);
    }
    // Every exported HTTP method is wrapped.
    for (const m of text.matchAll(/^export const (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) = (.*)$/gm)) expect(m[2], `${m[1]} in ${file}`).toMatch(/^withRoute\(/);
    expect(text).not.toMatch(/^export (async )?function (GET|POST|PUT|PATCH|DELETE)/m);
    // Nor a method re-exported unwrapped (`export { handler as POST }`, `export { POST } from "./handler"`).
    expect(text).not.toMatch(/export\s*\{[^}]*\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b[^}]*\}/);
  });
});
