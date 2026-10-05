import { afterEach, describe, expect, it, vi } from "vitest";
import { BUDGET_PLATFORMS, BudgetExhaustedError, budgetPlatformOf, createBudget, isBudgetExhaustedError, msUntilUtcMidnight, outboundBudget, secondsUntilUtcMidnight, utcDay } from "./budget";
import { budgets } from "./limits";
import { FakeRedis, type RedisLike } from "./redis";

const T0 = Date.UTC(2026, 9, 4, 18, 0, 0);
const SMALL = { espn: 3, sleeper: 5, fantasycalc: 1, github: 1 } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("daily outbound budgets (track RL)", () => {
  it("counts ESPN's two hosts as ESPN, and budgets Sleeper, FantasyCalc and GitHub raw; other hosts aren't budgeted", () => {
    expect(budgets.perDay).toEqual({ espn: 4_000, sleeper: 15_000, fantasycalc: 200, github: 100 });
    expect(BUDGET_PLATFORMS).toEqual(["espn", "sleeper", "fantasycalc", "github"]);
    expect(budgetPlatformOf("lm-api-reads.fantasy.espn.com")).toBe("espn");
    expect(budgetPlatformOf("fan.api.espn.com")).toBe("espn");
    expect(budgetPlatformOf("api.sleeper.app")).toBe("sleeper");
    expect(budgetPlatformOf("API.FANTASYCALC.COM")).toBe("fantasycalc");
    expect(budgetPlatformOf("raw.githubusercontent.com")).toBe("github");
    expect(budgetPlatformOf("www66.myfantasyleague.com")).toBeUndefined();
    expect(budgetPlatformOf("example.invalid")).toBeUndefined();
  });

  it("without Redis: this process's own count, answered at once (no promise, so local timing doesn't change), per UTC day", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const b = createBudget({ perDay: SMALL });
    expect([b.take("espn", T0), b.take("espn", T0), b.take("espn", T0)]).toEqual(["ok", "ok", "ok"]);
    expect(b.take("espn", T0)).toBe("day");
    expect(b.take("espn", T0 + 1)).toBe("day");
    expect(b.take("sleeper", T0)).toBe("ok"); // each platform its own
    // A new UTC day starts over.
    const tomorrow = Date.UTC(2026, 9, 5, 0, 0, 1);
    expect(b.take("espn", tomorrow)).toBe("ok");
  });

  it("logs a used-up budget once per process, platform and day, naming only the platform", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const b = createBudget({ perDay: SMALL });
    for (let i = 0; i < 5; i++) b.take("fantasycalc", T0);
    expect(spy.mock.calls.map((c) => String(c[0]))).toEqual(['{"route":"server","event":"budget_exhausted","platform":"fantasycalc"}']);
  });

  it("with Redis: one counter per platform and day shared by every instance, with an expiry; past the limit an instance stops asking", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis(() => T0);
    const a = createBudget({ redis, prefix: "os:preview:", perDay: SMALL });
    const b = createBudget({ redis, prefix: "os:preview:", perDay: SMALL });
    expect(await a.take("espn", T0)).toBe("ok");
    expect(await b.take("espn", T0)).toBe("ok");
    expect(await a.take("espn", T0)).toBe("ok");
    expect(await b.take("espn", T0)).toBe("day"); // the 4th attempt of the day, across both instances
    // Commands: an INCR per attempt, plus the PEXPIRE of the day's first; b, now past the limit, asks nothing more.
    expect(redis.stats.commands).toBe(5);
    expect(b.take("espn", T0)).toBe("day");
    expect(redis.stats.commands).toBe(5);
    const key = `os:preview:budget:espn:${utcDay(T0)}`;
    expect(redis.keys()).toEqual([key]);
    expect(await redis.get(key)).toBe("4");
    expect(redis.ttlMs(key)).toBe(budgets.keyTtlMs);
  });

  it("Redis down or slow: the attempt goes through, counted in the process's own budget, and Redis is left alone a while (logged once)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const down = {
      incr: async () => {
        calls++;
        throw Object.assign(new Error("fetch failed"), { name: "UpstashError" });
      },
    } as unknown as RedisLike;
    const b = createBudget({ redis: down, prefix: "os:preview:", perDay: SMALL, redisRetryAfterMs: 60_000 });
    expect(await b.take("espn", T0)).toBe("ok");
    expect(b.take("espn", T0 + 1)).toBe("ok"); // within the minute: no Redis, the process's own count, at once
    expect(b.take("espn", T0 + 2)).toBe("ok");
    expect(b.take("espn", T0 + 3)).toBe("day"); // the process's own budget still holds
    expect(calls).toBe(1);
    expect(spy.mock.calls.map((c) => String(c[0]))).toEqual([
      '{"route":"server","event":"budget_redis_error","platform":"upstash","errorName":"UpstashError"}',
      '{"route":"server","event":"budget_exhausted","platform":"espn"}',
    ]);
    // A hanging Redis answers within the timeout.
    const hanging = { incr: () => new Promise<number>(() => {}) } as unknown as RedisLike;
    const slow = createBudget({ redis: hanging, prefix: "os:preview:", perDay: SMALL, timeoutMs: 20 });
    await expect(slow.take("sleeper", T0)).resolves.toBe("ok");
  });

  it("BudgetExhaustedError names the platform and the limit only, and is recognized across module copies", () => {
    const err = new BudgetExhaustedError("espn");
    expect(err).toMatchObject({ name: "BudgetExhaustedError", platform: "espn", by: "day" });
    expect(err.message).not.toMatch(/https?:|\d{5,}/);
    expect(new BudgetExhaustedError("sleeper", "share")).toMatchObject({ platform: "sleeper", by: "share" });
    expect(isBudgetExhaustedError(err)).toBe(true);
    expect(isBudgetExhaustedError(Object.assign(new Error("x"), { name: "BudgetExhaustedError", platform: "sleeper" }))).toBe(true);
    expect(isBudgetExhaustedError(Object.assign(new Error("x"), { name: "BudgetExhaustedError", platform: "sleeper", by: "share" }))).toBe(true);
    expect(isBudgetExhaustedError(Object.assign(new Error("x"), { name: "BudgetExhaustedError", platform: "sleeper", by: "week" }))).toBe(false);
    expect(isBudgetExhaustedError(Object.assign(new Error("x"), { name: "BudgetExhaustedError", platform: "nope" }))).toBe(false);
    expect(isBudgetExhaustedError(new Error("x"))).toBe(false);
  });

  it("budgets start again at UTC midnight (a BUSY answer's Retry-After)", () => {
    expect(secondsUntilUtcMidnight(T0)).toBe(6 * 3600);
    expect(msUntilUtcMidnight(T0)).toBe(6 * 3_600_000);
    expect(secondsUntilUtcMidnight(Date.UTC(2026, 9, 4, 23, 59, 59, 500))).toBe(1);
    expect(utcDay(Date.UTC(2026, 9, 4, 23, 59, 59))).toBe("2026-10-04");
  });
});

describe("each client's share of a platform's day (track RL review RL-4: a few clients can't spend it for everyone)", () => {
  const SHARE = { espn: 2 } as const;

  it("without Redis: a client over its share is refused before the day's budget is touched; other clients and platforms go on", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const b = createBudget({ perDay: SMALL, perClient: SHARE });
    expect([b.take("espn", T0, "client-a"), b.take("espn", T0, "client-a")]).toEqual(["ok", "ok"]);
    expect(b.take("espn", T0, "client-a")).toBe("share");
    expect(b.take("espn", T0, "client-a")).toBe("share");
    // The refusals spent nothing of the day: one more attempt fits (3 a day in SMALL), then the day is over for everyone.
    expect(b.take("espn", T0, "client-b")).toBe("ok");
    expect(b.take("espn", T0, "client-b")).toBe("day");
    // No share for Sleeper (none configured), nor for requests without a client (league-independent data, scripts).
    expect(b.take("sleeper", T0, "client-a")).toBe("ok");
    expect(createBudget({ perDay: SMALL, perClient: SHARE }).take("espn", T0)).toBe("ok");
    // A new UTC day: every share starts again.
    expect(b.take("espn", Date.UTC(2026, 9, 5, 0, 0, 1), "client-a")).toBe("ok");
    // Logged once per process, platform and day, never naming the client.
    const lines = spy.mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => l.includes("budget_share_exhausted"))).toEqual(['{"route":"server","event":"budget_share_exhausted","platform":"espn"}']);
    expect(lines.join("\n")).not.toContain("client-a");
  });

  it("stays bounded: past its size, the client counted longest ago starts again", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const b = createBudget({ perDay: { ...SMALL, espn: 100 }, perClient: { espn: 1 }, maxClients: 2 });
    expect(b.take("espn", T0, "a")).toBe("ok");
    expect(b.take("espn", T0, "a")).toBe("share");
    b.take("espn", T0, "b");
    b.take("espn", T0, "c"); // full: "a" goes
    expect(b.take("espn", T0, "a")).toBe("ok");
  });

  it("with Redis: one counter per client, platform and day, under the client's hash only, gone when its UTC day ends", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis(() => T0);
    const a = createBudget({ redis, prefix: "os:preview:", perDay: SMALL, perClient: SHARE });
    const b = createBudget({ redis, prefix: "os:preview:", perDay: SMALL, perClient: SHARE }); // another instance
    expect(await a.take("espn", T0, "hmac-1")).toBe("ok");
    expect(await b.take("espn", T0, "hmac-1")).toBe("ok");
    expect(await a.take("espn", T0, "hmac-1")).toBe("share");
    // Commands: the first attempt 4 (the share's INCR and PEXPIRE, the day's INCR and PEXPIRE), the second 2 (two INCRs),
    // the refused third 1 (the share's INCR only).
    expect(redis.stats.commands).toBe(4 + 2 + 1);
    const shareKey = `os:preview:budget:client:espn:hmac-1:${utcDay(T0)}`;
    const dayKey = `os:preview:budget:espn:${utcDay(T0)}`;
    expect(redis.keys().sort()).toEqual([dayKey, shareKey].sort());
    expect(await redis.get(shareKey)).toBe("3");
    expect(await redis.get(dayKey)).toBe("2"); // the refused attempt spent nothing of the day
    expect(redis.ttlMs(shareKey)).toBe(msUntilUtcMidnight(T0) + budgets.clientKeyMarginMs);
  });

  it("Redis down: the share is counted in the process too (fail open, not unlimited)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const down = { incr: async () => Promise.reject(new Error("down")) } as unknown as RedisLike;
    const b = createBudget({ redis: down, prefix: "os:preview:", perDay: SMALL, perClient: SHARE });
    expect(await b.take("espn", T0, "c")).toBe("ok");
    expect(b.take("espn", T0 + 1, "c")).toBe("ok");
    expect(b.take("espn", T0 + 2, "c")).toBe("share");
  });
});

describe("the process's budget (track RL review RL-5, RL-7)", () => {
  const KV = { KV_REST_API_URL: "https://example-12345.upstash.io", KV_REST_API_TOKEN: "test-token-not-real", SESSION_SECRET: "s".repeat(40) };

  it("off Vercel it never uses Redis, whatever .env.local holds, and has no client shares: local runs stay as they were", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const local = outboundBudget({ ...KV });
    // Synchronous (no Redis round trip) and no share: a client may go past 400 ESPN attempts.
    for (let i = 0; i < budgets.perClientPerDay.espn + 5; i++) expect(local.take("espn", T0, "parker")).toBe("ok");
  });

  it("on Vercel without Redis (a preview before Upstash is connected): the process's own counts, with the clients' shares", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const noRedis = outboundBudget({ VERCEL: "1" });
    for (let i = 0; i < budgets.perClientPerDay.espn; i++) expect(noRedis.take("espn", T0, "c")).toBe("ok");
    expect(noRedis.take("espn", T0, "c")).toBe("share");
  });

  it("a Redis address that can't be used (a rediss:// URL with its password) fails open to the process's own counts, logged by name only", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const b = outboundBudget({ ...KV, KV_REST_API_URL: "rediss://default:FAKE-PASSWORD-NOT-REAL@example-12345.upstash.io:6379", VERCEL: "1" });
    expect(b.take("espn", T0, "c")).toBe("ok");
    const lines = spy.mock.calls.map((c) => String(c[0]));
    expect(lines).toEqual(['{"route":"server","event":"redis_config_invalid","platform":"upstash","errorName":"UrlError"}']);
    expect(lines.join("\n")).not.toContain("FAKE-PASSWORD");
  });
});
