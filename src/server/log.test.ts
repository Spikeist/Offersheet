import { afterEach, describe, expect, it, vi } from "vitest";
import { newRequestScope, runInRequestScope } from "./deadline";
import { logLimits } from "./limits";
import { LogEventSchema, StoredLogEventSchema, errorNameOf, flushRequestLogs, logDayKey, logDayTtlMs, logDevDetail, logEvent, logStore, logThrottled, resetLogThrottleForTests, withTimeout, writeLogEntries } from "./log";
import { FakeRedis, type RedisLike } from "./redis";

const DAY = 24 * 60 * 60_000;
const T0 = Date.UTC(2026, 9, 4, 18, 30, 0);
const VERCEL = { VERCEL: "1", VERCEL_ENV: "preview" };

function lines(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((c) => String(c[0]));
}

afterEach(() => {
  vi.useRealTimers();
  resetLogThrottleForTests();
});

describe("logEvent: the allowlist (track RL: logs never record credentials or league data)", () => {
  it("writes one JSON line of the allowed fields, the route from the request it runs for", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logEvent({ event: "cache_write_failed", errorName: "DiskFullError" });
    await runInRequestScope(newRequestScope("import", T0), async () => {
      logEvent({ event: "error_response", code: "SOURCE_DOWN", platform: "espn", status: 502, ms: 1234 });
    });
    logEvent({ route: "feedback", event: "rate_limited", code: "RATE_LIMITED", status: 429 });
    expect(lines(spy)).toEqual([
      '{"route":"server","event":"cache_write_failed","errorName":"DiskFullError"}',
      '{"route":"import","event":"error_response","code":"SOURCE_DOWN","platform":"espn","status":502,"ms":1234}',
      '{"route":"feedback","event":"rate_limited","code":"RATE_LIMITED","status":429}',
    ]);
  });

  it("refuses anything else whole: an unknown field or a value of another shape logs only invalid_log_event", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const leaky = [
      { event: "unexpected", message: "league 12345678 for {00000000-0000-4000-8000-000000000000}" },
      { event: "unexpected", errorName: "Error: https://lm-api-reads.fantasy.espn.com/…/leagues/12345678" },
      { event: "fetch failed for 12345678" },
      { event: "x", code: "espn_s2=AEBabc" },
      { event: "x", platform: "api.sleeper.app" },
      { event: "x", status: 1e6 },
      { event: "x", ms: -1 },
      { event: "x", ip: "203.0.113.9" },
    ];
    for (const input of leaky) logEvent(input as never);
    expect(new Set(lines(spy))).toEqual(new Set(['{"route":"server","event":"invalid_log_event"}']));
    expect(lines(spy).join("\n")).not.toMatch(/12345678|203\.0\.113|espn_s2|AEB|api\.sleeper|00000000-0000/);
  });

  it("never throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("console broke");
    });
    expect(() => logEvent({ event: "x" })).not.toThrow();
    expect(() => logEvent(null as never)).not.toThrow();
  });

  it("errorNameOf: an Error's plain name, never its message", () => {
    expect(errorNameOf(new TypeError("boom with a secret"))).toBe("TypeError");
    expect(errorNameOf(Object.assign(new Error("x"), { name: "Weird name: 12345678" }))).toBe("Error");
    expect(errorNameOf({ name: "LeagueImportError", message: "secret" })).toBe("LeagueImportError");
    expect(errorNameOf({ name: "with spaces" })).toBe("Object");
    expect(errorNameOf("a string with a secret")).toBe("string");
    expect(errorNameOf(undefined)).toBe("undefined");
  });

  it("the schema is strict, and the stored form adds only the time", () => {
    expect(LogEventSchema.safeParse({ route: "server", event: "x", extra: 1 }).success).toBe(false);
    expect(StoredLogEventSchema.safeParse({ route: "server", event: "x", at: 1 }).success).toBe(true);
    expect(StoredLogEventSchema.safeParse({ route: "server", event: "x", at: 1, extra: 1 }).success).toBe(false);
  });

  it("the development detail is for `npm run dev` only, redacted, never on Vercel or in tests", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error(`bad cookie espn_s2=${"A".repeat(80)} for {00000000-0000-4000-8000-000000000000}`);
    logDevDetail(err, { NODE_ENV: "test" });
    logDevDetail(err, { NODE_ENV: "production" });
    logDevDetail(err, { NODE_ENV: "development", VERCEL: "1" });
    expect(spy).not.toHaveBeenCalled();
    logDevDetail(err, { NODE_ENV: "development" });
    expect(lines(spy)).toHaveLength(1);
    expect(lines(spy)[0]).toMatch(/^\[offer-sheet\] development only: bad cookie espn_s2=\[redacted\] for \{SWID\}$/);
  });
});

describe("lines a visitor can set off at will (B4 security review: a flood of them pushed a day's real lines out)", () => {
  it("one rate_limited line every logLimits.refusalEveryMs per instance, whatever its route", () => {
    expect([logLimits.refusalEveryMs, logLimits.repeatEveryMs, logLimits.keepPerDay]).toEqual([600_000, 60_000, 1_000]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 50; i++) logEvent({ route: i % 2 ? "session" : "health", event: "rate_limited", code: "RATE_LIMITED", status: 429 }, { now: T0 + i * 1_000, store: null });
    expect(lines(spy)).toEqual(['{"route":"health","event":"rate_limited","code":"RATE_LIMITED","status":429}']);
    logEvent({ route: "cron", event: "rate_limited", code: "RATE_LIMITED", status: 429 }, { now: T0 + logLimits.refusalEveryMs, store: null });
    expect(lines(spy)).toHaveLength(2);
    // A whole day at most 144, against the store's 1,000 a day.
    expect((24 * 60 * 60_000) / logLimits.refusalEveryMs).toBe(144);
  });

  it("one line a minute of each repeating failure (route, event, code, platform, status, error name); other lines are never throttled", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const down = { event: "error_response", code: "SOURCE_DOWN", platform: "espn", status: 502 } as const;
    for (let i = 0; i < 100; i++) logEvent({ route: "import", ...down, ms: i }, { now: T0 + i * 100, store: null });
    logEvent({ route: "import", ...down, platform: "sleeper" }, { now: T0 + 1, store: null }); // another platform: its own line
    logEvent({ route: "model", ...down }, { now: T0 + 2, store: null }); // another route
    logEvent({ route: "import", event: "unexpected_import", platform: "espn", errorName: "TypeError" }, { now: T0 + 3, store: null });
    logEvent({ route: "import", event: "unexpected_import", platform: "espn", errorName: "TypeError" }, { now: T0 + 4, store: null });
    logEvent({ route: "import", event: "deadline_slow", platform: "espn", ms: 45_000 }, { now: T0 + 5, store: null });
    logEvent({ route: "import", event: "deadline_slow", platform: "espn", ms: 45_001 }, { now: T0 + 6, store: null });
    for (let i = 0; i < 5; i++) logEvent({ event: "cache_write_failed", errorName: "Error" }, { now: T0 + 7, store: null });
    expect(lines(spy).map((l) => JSON.parse(l) as { event: string })).toHaveLength(3 + 1 + 1 + 5);
    // A minute on, the outage shows again.
    logEvent({ route: "import", ...down }, { now: T0 + logLimits.repeatEveryMs, store: null });
    expect(lines(spy)).toHaveLength(11);
    expect(logThrottled({ route: "import", ...down }, T0 + logLimits.repeatEveryMs + 1)).toBe(true);
    expect(logThrottled({ route: "server", event: "budget_exhausted", platform: "espn" }, T0)).toBe(false);
  });

  it("a flood never reaches the store: the review's 25 refused saves a window wrote 50 lines, now 2", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis(() => T0);
    const scope = newRequestScope("session", T0);
    await runInRequestScope(scope, async () => {
      for (let i = 0; i < 25; i++) {
        logEvent({ event: "unexpected_session_save", platform: "espn", errorName: "Error" }, { now: T0 + i, store: redis, env: VERCEL });
        logEvent({ event: "error_response", code: "INTERNAL", platform: "espn", status: 500 }, { now: T0 + i, store: redis, env: VERCEL });
      }
    });
    await flushRequestLogs(scope, { store: redis, env: VERCEL, now: T0 });
    expect(await redis.lrange("os:preview:log:2026-10-04", 0, -1)).toHaveLength(2);
  });

  it("stays bounded: past logLimits.throttleMaxKeys lines remembered, the oldest is forgotten", () => {
    for (let i = 0; i <= logLimits.throttleMaxKeys; i++) expect(logThrottled({ route: "import", event: "error_response", status: 500 + (i % 99), code: `C${i}` }, T0)).toBe(false);
    // The first one was forgotten (logged again), the last one is still remembered.
    expect(logThrottled({ route: "import", event: "error_response", status: 500, code: "C0" }, T0 + 1)).toBe(false);
    expect(logThrottled({ route: "import", event: "error_response", status: 500 + (logLimits.throttleMaxKeys % 99), code: `C${logLimits.throttleMaxKeys}` }, T0 + 1)).toBe(true);
  });
});

describe("the shared store (Redis on Vercel only)", () => {
  it("is used only on Vercel with Redis configured", () => {
    expect(logStore({})).toBeNull();
    expect(logStore({ VERCEL: "1" })).toBeNull(); // no Redis variables
    expect(logStore({ KV_REST_API_URL: "https://example.upstash.io", KV_REST_API_TOKEN: "t", SESSION_SECRET: "x".repeat(40) })).toBeNull(); // not on Vercel
  });

  it("a Redis address that can't be used means no store, said once by the error's name only, and a flush still never rejects (review RL-7)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = { VERCEL: "1", KV_REST_API_URL: "rediss://default:FAKE-PASSWORD-NOT-REAL@example-12345.upstash.io:6379", KV_REST_API_TOKEN: "t", SESSION_SECRET: "x".repeat(40) };
    expect(logStore(bad)).toBeNull();
    expect(logStore(bad)).toBeNull();
    logEvent({ event: "x" }, { env: bad });
    const scope = newRequestScope("import", T0);
    scope.pendingLogs.push(JSON.stringify({ route: "import", event: "x", at: T0 }));
    await expect(flushRequestLogs(scope, { env: bad })).resolves.toBeUndefined();
    expect(lines(spy)).toEqual(['{"route":"server","event":"redis_config_invalid","platform":"upstash","errorName":"UrlError"}', '{"route":"server","event":"x"}']);
    expect(lines(spy).join("\n")).not.toContain("FAKE-PASSWORD");
  });

  it("may name the server cache as a platform (a deadline cut in it: src/server/http.ts)", () => {
    expect(LogEventSchema.safeParse({ route: "import", event: "deadline_busy", platform: "cache", ms: 46_000 }).success).toBe(true);
  });

  it("a request's lines wait for the after-response write: one LPUSH, LTRIM and PEXPIRE, newest first, in the day's list", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis(() => T0);
    const scope = newRequestScope("model", T0);
    await runInRequestScope(scope, async () => {
      logEvent({ event: "deadline_cut", platform: "sleeper", ms: 90_000 }, { now: T0, store: redis, env: VERCEL });
      logEvent({ event: "error_response", code: "SOURCE_SLOW", status: 504 }, { now: T0 + 1, store: redis, env: VERCEL });
    });
    expect(redis.stats.commands).toBe(0); // nothing before the response
    expect(scope.pendingLogs).toHaveLength(2);
    await flushRequestLogs(scope, { store: redis, env: VERCEL, now: T0 });
    expect(redis.stats.commands).toBe(3);
    const key = "os:preview:log:2026-10-04";
    expect(redis.keys()).toEqual([key]);
    const stored = (await redis.lrange(key, 0, -1)).map((s) => StoredLogEventSchema.parse(JSON.parse(s)));
    expect(stored).toEqual([
      { route: "model", event: "error_response", code: "SOURCE_SLOW", status: 504, at: T0 + 1 },
      { route: "model", event: "deadline_cut", platform: "sleeper", ms: 90_000, at: T0 },
    ]);
    // Deleted 14 days after the day began, so no entry outlives the privacy page's two weeks.
    const dayStart = Date.UTC(2026, 9, 4);
    expect(redis.ttlMs(key)).toBe(dayStart + logLimits.retainDays * DAY - T0);
    // A line logged after the write (a background task the request started) is written on its own.
    expect(scope.flushed).toBe(true);
    await runInRequestScope(scope, async () => logEvent({ event: "cache_write_failed", errorName: "Error" }, { now: T0 + 2, store: redis, env: VERCEL }));
    await vi.waitFor(async () => expect(await redis.lrange(key, 0, -1)).toHaveLength(3));
  });

  it("keeps each day's newest entries only, files entries by their own day, and skips what's past retention", async () => {
    const redis = new FakeRedis(() => T0);
    const at = (t: number, n: number) => JSON.stringify({ route: "server", event: `e${n}`, at: t });
    const many = Array.from({ length: logLimits.keepPerDay + 5 }, (_, i) => at(T0, i));
    await writeLogEntries(redis, [...many, at(T0 - DAY, 99), at(T0 - 15 * DAY, 98), "not json", JSON.stringify({ route: "server", event: "x", at: T0, url: "https://x" })], { now: T0, env: VERCEL });
    const today = await redis.lrange("os:preview:log:2026-10-04", 0, -1);
    expect(today).toHaveLength(logLimits.keepPerDay);
    expect(JSON.parse(today[0] ?? "{}").event).toBe(`e${logLimits.keepPerDay + 4}`); // the newest at the head
    expect(await redis.lrange("os:preview:log:2026-10-03", 0, -1)).toEqual([at(T0 - DAY, 99)]);
    expect(redis.keys().sort()).toEqual(["os:preview:log:2026-10-03", "os:preview:log:2026-10-04"]); // 15 days back: not written
    expect(redis.keys().join(" ")).not.toContain("https");
    expect(logDayKey(T0, VERCEL)).toBe("os:preview:log:2026-10-04");
    expect(logDayTtlMs(T0 - 14 * DAY, T0)).toBeLessThanOrEqual(0);
  });

  it("a failing or slow store never rejects and is said on the console only", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const entry = JSON.stringify({ route: "server", event: "x", at: T0 });
    const failing = { lpushTrimExpire: async () => Promise.reject(Object.assign(new Error("ERR max requests limit exceeded"), { name: "UpstashError" })) } as unknown as RedisLike;
    await expect(writeLogEntries(failing, [entry], { now: T0, env: VERCEL })).resolves.toBeUndefined();
    const hanging = { lpushTrimExpire: () => new Promise<number>(() => {}) } as unknown as RedisLike;
    await expect(writeLogEntries(hanging, [entry], { now: T0, env: VERCEL, timeoutMs: 20 })).resolves.toBeUndefined();
    expect(lines(spy)).toEqual([
      '{"route":"server","event":"log_write_failed","platform":"upstash","errorName":"UpstashError"}',
      '{"route":"server","event":"log_write_failed","platform":"upstash","errorName":"TimeoutError"}',
    ]);
  });

  it("withTimeout passes an answer through and turns a hang into a TimeoutError", async () => {
    await expect(withTimeout(Promise.resolve(7), 50)).resolves.toBe(7);
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
