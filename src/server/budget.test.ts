import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUDGET_PLATFORMS,
  BudgetExhaustedError,
  admissionUnits,
  budgetPlatformOf,
  chargeWork,
  createBudget,
  createDailyQuota,
  feedbackQuota,
  isBudgetExhaustedError,
  modelBuildExtraUnits,
  msUntilAllowanceGrows,
  msUntilUtcMidnight,
  outboundBudget,
  secondsUntilUtcMidnight,
  slicedAllowance,
  unpackedExtraUnits,
  utcDay,
  workBudget,
  type BudgetReceipt,
} from "./budget";
import { TTL } from "./cache";
import { newRequestScope, runInRequestScope } from "./deadline";
import { createHttpClient } from "./http";
import { budgets, feedbackLimits, signedUploadLimits, uploadLimits, workLimits } from "./limits";
import { FakeRedis, type RedisLike } from "./redis";

const T0 = Date.UTC(2026, 9, 4, 18, 0, 0);
const SMALL = { espn: 3, sleeper: 5, fantasycalc: 1, github: 1 } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("daily outbound budgets (track RL)", () => {
  it("counts ESPN's two hosts as ESPN, and budgets Sleeper, FantasyCalc and GitHub raw; other hosts aren't budgeted", () => {
    // FantasyCalc's day is sized to its own 3-hour rule's bound (review of Checkpoint 7b's server work; the test below).
    expect(budgets.perDay).toEqual({ espn: 4_000, sleeper: 15_000, fantasycalc: 1_500, github: 100 });
    expect(BUDGET_PLATFORMS).toEqual(["espn", "sleeper", "fantasycalc", "github"]);
    expect(budgetPlatformOf("lm-api-reads.fantasy.espn.com")).toBe("espn");
    expect(budgetPlatformOf("fan.api.espn.com")).toBe("espn");
    expect(budgetPlatformOf("api.sleeper.app")).toBe("sleeper");
    expect(budgetPlatformOf("API.FANTASYCALC.COM")).toBe("fantasycalc");
    expect(budgetPlatformOf("raw.githubusercontent.com")).toBe("github");
    expect(budgetPlatformOf("www66.myfantasyleague.com")).toBeUndefined();
    expect(budgetPlatformOf("example.invalid")).toBeUndefined();
  });

  it("FantasyCalc's day can't be spent by refreshes its 3-hour rule allows: all 144 formats refreshed as soon as each copy is 3 hours old, from any start, are never refused by the day's slices (review of Checkpoint 7b's server work)", () => {
    const FORMATS = 144; // every format a league can ask for (src/server/snapshots.ts parseFormatKey)
    const STEP = 5 * 60_000;
    const DAY0 = Date.UTC(2026, 9, 6, 0, 0, 0);
    /** Refused attempts when every format is refreshed whenever its copy is TTL.fantasyCalc old, from `startMin` minutes into the day. */
    const refusedWith = (perDay: number, startMin: number): number => {
      const budget = createBudget({ redis: null, prefix: "os:test:", perDay: { ...budgets.perDay, fantasycalc: perDay }, slices: budgets.slices, burstShare: budgets.burstShare });
      const last = new Array<number>(FORMATS).fill(Number.NEGATIVE_INFINITY);
      let refused = 0;
      for (let t = DAY0 + startMin * 60_000; t < DAY0 + 24 * 3_600_000; t += STEP) {
        for (let f = 0; f < FORMATS; f++) {
          if (t - (last[f] as number) < TTL.fantasyCalc) continue;
          if (budget.take("fantasycalc", t) === "ok") last[f] = t;
          else refused++;
        }
      }
      return refused;
    };
    vi.spyOn(console, "error").mockImplementation(() => {}); // the refusals at 400 are logged
    expect(TTL.fantasyCalc).toBe(3 * 3_600_000);
    for (const start of [0, 5, 60, 120, 175]) expect(refusedWith(budgets.perDay.fantasycalc, start), `from ${start} min`).toBe(0);
    // At 400 a day (before the review) the same refreshes ran into the slices: a visitor could spend the day for everyone.
    expect(refusedWith(400, 0)).toBeGreaterThan(0);
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
    // Commands: an INCR and its PEXPIRE per attempt, in one transaction (review POL-2), and the refused 4th's count given
    // back in another (Checkpoint 7b load test: a refused attempt counts nowhere); b, now past the limit, asks nothing more.
    expect(redis.stats.commands).toBe(8 + 2);
    expect(b.take("espn", T0)).toBe("day");
    expect(redis.stats.commands).toBe(8 + 2);
    const key = `os:preview:budget:espn:${utcDay(T0)}`;
    expect(redis.keys()).toEqual([key]);
    expect(await redis.get(key)).toBe("3");
    expect(redis.ttlMs(key)).toBe(budgets.keyTtlMs);
  });

  it("Redis down or slow: the attempt goes through, counted in the process's own budget, and Redis is left alone a while (logged once)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const down = {
      incrExpire: async () => {
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
    const hanging = { incrExpire: () => new Promise<number[]>(() => {}) } as unknown as RedisLike;
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
    // Commands (each count with its expiry in one transaction, review POL-2): the first attempt 4 (the share's INCR and
    // PEXPIRE, the day's), the second 4, the refused third 2 (the share's only) and 2 more giving that count back
    // (Checkpoint 7b load test); a's next refusal asks nothing (it knows).
    expect(redis.stats.commands).toBe(4 + 4 + 2 + 2);
    expect(a.take("espn", T0, "hmac-1")).toBe("share");
    expect(redis.stats.commands).toBe(4 + 4 + 2 + 2);
    const shareKey = `os:preview:budget:client:espn:hmac-1:${utcDay(T0)}`;
    const dayKey = `os:preview:budget:espn:${utcDay(T0)}`;
    expect(redis.keys().sort()).toEqual([dayKey, shareKey].sort());
    expect(await redis.get(shareKey)).toBe("2"); // the refused attempt counts nowhere, not even in the share that refused it
    expect(await redis.get(dayKey)).toBe("2"); // nor in the day
    expect(redis.ttlMs(shareKey)).toBe(msUntilUtcMidnight(T0) + budgets.clientKeyMarginMs);
  });

  it("Redis down: the share is counted in the process too (fail open, not unlimited)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const down = { incrExpire: async () => Promise.reject(new Error("down")) } as unknown as RedisLike;
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

describe("no counter without its expiry (final review POL-2)", () => {
  it("each count is written with its expiry in one transaction: an answer lost after Upstash applied it still leaves the expiry, and the single commands are never used", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // A store whose single INCR and PEXPIRE fail, and whose transaction applies, then loses its answer (a timeout).
    class AnswerLost extends FakeRedis {
      override incr(): Promise<number> {
        return Promise.reject(new TypeError("fetch failed"));
      }
      override pexpire(): Promise<number> {
        return Promise.reject(new TypeError("fetch failed"));
      }
      override async incrExpire(entries: ReadonlyArray<{ key: string; by: number; ttlMs: number }>): Promise<number[]> {
        await super.incrExpire(entries);
        throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
      }
    }
    const redis = new AnswerLost(() => T0);
    const b = createBudget({ redis, prefix: "os:preview:", perDay: SMALL, perClient: { espn: 2 } });
    expect(await b.take("espn", T0, "hmac-1")).toBe("ok"); // fail open: the process's own count
    const keys = redis.keys().sort();
    expect(keys).toEqual([`os:preview:budget:client:espn:hmac-1:${utcDay(T0)}`]);
    for (const k of keys) expect(redis.ttlMs(k)).toBe(msUntilUtcMidnight(T0) + budgets.clientKeyMarginMs);
    // The work budget's counts too. The client's own count goes first, alone (review of the Checkpoint 7b load-test fixes,
    // finding 3): its answer lost, the charge goes on counted by this process, and the group's and the day's counters are
    // never written.
    const quota = createDailyQuota({ name: "work", redis, prefix: "os:preview:", perClient: 5, perGroup: 10, perDay: 100, slices: 1, burstShare: 1 });
    expect(await quota.charge(1, { client: "c", group: "g" }, T0)).toBe("ok");
    for (const k of redis.keys()) expect(redis.ttlMs(k), k).toBeGreaterThan(0);
    expect(redis.keys().filter((k) => k.includes(":work:"))).toEqual([`os:preview:work:client:c:${utcDay(T0)}`]);
  });

  it("the expiry is set again with every count (idempotent), so a counter written without one by older code gets one at its next count", async () => {
    const redis = new FakeRedis(() => T0);
    const key = `os:preview:budget:client:espn:hmac-1:${utcDay(T0)}`;
    await redis.set(key, "1"); // no expiry
    expect(redis.ttlMs(key)).toBeUndefined();
    const b = createBudget({ redis, prefix: "os:preview:", perDay: SMALL, perClient: { espn: 5 } });
    expect(await b.take("espn", T0, "hmac-1")).toBe("ok");
    expect(await redis.get(key)).toBe("2");
    expect(redis.ttlMs(key)).toBe(msUntilUtcMidnight(T0) + budgets.clientKeyMarginMs);
  });
});

describe("the day in slices, and the cookies' reserve (final review SEC-2)", () => {
  const AT = (h: number, m = 0) => Date.UTC(2026, 9, 4, h, m, 0);

  it("by the end of each 2-hour slice at most that share of the day, but never less than a quarter; Retry-After is when it next grows", () => {
    expect([budgets.slices, budgets.burstShare]).toEqual([12, 0.25]);
    expect(slicedAllowance(120, AT(0, 30))).toBe(30); // slices 0–2: a quarter
    expect(slicedAllowance(120, AT(5, 59))).toBe(30);
    expect(slicedAllowance(120, AT(6))).toBe(40); // slice 3: 4/12
    expect(slicedAllowance(120, AT(13))).toBe(70); // slice 6: 7/12
    expect(slicedAllowance(120, AT(23, 59))).toBe(120); // the last slice: all of it
    expect(msUntilAllowanceGrows(AT(0, 30))).toBe(5.5 * 3_600_000); // the quarter holds until 06:00
    expect(msUntilAllowanceGrows(AT(13))).toBe(3_600_000); // slice 7 opens at 14:00
    expect(msUntilAllowanceGrows(AT(23))).toBe(3_600_000); // the next day
    // No slices (1 and 1): the whole day at once, as the local budget keeps it.
    expect(slicedAllowance(120, AT(0, 30), 1, 1)).toBe(120);
    expect(msUntilAllowanceGrows(AT(18), 1, 1)).toBe(6 * 3_600_000);
  });

  it("a burst early in the day takes a quarter; the process asks nothing more until the next slice opens more", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis(() => AT(1));
    const b = createBudget({ redis, prefix: "os:preview:", perDay: { ...SMALL, espn: 120 }, slices: 12, burstShare: 0.25 });
    let ok = 0;
    for (let i = 0; i < 40; i++) if ((await b.take("espn", AT(1))) === "ok") ok++;
    expect(ok).toBe(30);
    const commands = redis.stats.commands;
    expect(b.take("espn", AT(5, 59))).toBe("day"); // remembered until 06:00
    expect(redis.stats.commands).toBe(commands);
    expect(await b.take("espn", AT(6))).toBe("ok"); // 4/12 now open: 40
  });

  it("requests without a visitor's ESPN cookies stop the reserve short of the day; requests with them may use it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(budgets.reservedForCookies).toEqual({ espn: 1_000 });
    const b = createBudget({ perDay: { ...SMALL, espn: 10 }, reserved: { espn: 4 } });
    const open = [];
    for (let i = 0; i < 8; i++) open.push(b.take("espn", T0));
    expect(open.filter((v) => v === "ok")).toHaveLength(6); // 10 − 4; the refused ones aren't counted
    for (let i = 0; i < 4; i++) expect(b.take("espn", T0, undefined, { privileged: true })).toBe("ok"); // the reserve, whole
    expect(b.take("espn", T0, undefined, { privileged: true })).toBe("day");
    expect(b.take("espn", T0)).toBe("day");
    // A platform without a reserve is the same either way.
    expect(b.take("sleeper", T0)).toBe("ok");
  });

  it("each client may take only its share of the reserve a day, once the open part is spent: made-up cookies can't empty it (B4 security review)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(budgets.reservedPerClientPerDay).toEqual({ espn: 50 });
    const b = createBudget({ perDay: { ...SMALL, espn: 10 }, reserved: { espn: 4 }, reservedPerClient: { espn: 2 } });
    const cookies = { privileged: true };
    // The open part (10 − 4) goes first, with cookies or without, and counts against no one's share of the reserve.
    for (let i = 0; i < 6; i++) expect(b.take("espn", T0, "made-up-cookies", cookies)).toBe("ok");
    expect(b.take("espn", T0, "no-cookies")).toBe("day");
    // In the reserve: that client's 2, then refused like the day; another client still gets its own 2.
    expect([b.take("espn", T0, "made-up-cookies", cookies), b.take("espn", T0, "made-up-cookies", cookies)]).toEqual(["ok", "ok"]);
    expect(b.take("espn", T0, "made-up-cookies", cookies)).toBe("day");
    expect([b.take("espn", T0, "private-league", cookies), b.take("espn", T0, "private-league", cookies)]).toEqual(["ok", "ok"]);
    expect(b.take("espn", T0, "third", cookies)).toBe("day"); // the whole day (10) is spent
    // Logged once, naming only the platform.
    const lines = spy.mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => l.includes("budget_reserve_share_exhausted"))).toEqual(['{"route":"server","event":"budget_reserve_share_exhausted","platform":"espn"}']);
    expect(lines.join("\n")).not.toContain("made-up-cookies");
    // A new UTC day: every share of the reserve starts again (the open part first, as before).
    const next = Date.UTC(2026, 9, 5, 12, 0, 0);
    for (let i = 0; i < 8; i++) expect(b.take("espn", next, "made-up-cookies", cookies)).toBe("ok");
    expect(b.take("espn", next, "made-up-cookies", cookies)).toBe("day");
    // Requests without a client (league-independent data, scripts) have no share: the reserve as before.
    const noClient = createBudget({ perDay: { ...SMALL, espn: 10 }, reserved: { espn: 4 }, reservedPerClient: { espn: 2 } });
    let ok = 0;
    for (let i = 0; i < 12; i++) if (noClient.take("espn", T0, undefined, cookies) === "ok") ok++;
    expect(ok).toBe(10);
  });

  it("with Redis: a counter per client and day for its share of the reserve, gone when its day ends; a client past it costs no command while the open part is known spent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis(() => T0);
    const b = createBudget({ redis, prefix: "os:preview:", perDay: { ...SMALL, espn: 4 }, reserved: { espn: 2 }, reservedPerClient: { espn: 1 } });
    const cookies = { privileged: true };
    expect(await b.take("espn", T0, "g1", cookies)).toBe("ok"); // the open part's 2
    expect(await b.take("espn", T0, "g1", cookies)).toBe("ok");
    expect(await b.take("espn", T0, "g1", cookies)).toBe("ok"); // the reserve: g1's share of 1
    const reserveKey = `os:preview:budget:reserve:espn:g1:${utcDay(T0)}`;
    const dayKey = `os:preview:budget:espn:${utcDay(T0)}`;
    expect(await redis.get(reserveKey)).toBe("1");
    expect(redis.ttlMs(reserveKey)).toBe(msUntilUtcMidnight(T0) + budgets.clientKeyMarginMs);
    // Past its share: refused before the day's counter is touched, then remembered (no command).
    expect(await b.take("espn", T0, "g1", cookies)).toBe("day");
    expect(await redis.get(dayKey)).toBe("3");
    const commands = redis.stats.commands;
    expect(b.take("espn", T0, "g1", cookies)).toBe("day");
    // The open part is known spent: a request without cookies is refused without a command too.
    expect(b.take("espn", T0, "g2")).toBe("day");
    expect(redis.stats.commands).toBe(commands);
    // Another client with cookies still has its share; then the whole day is spent.
    expect(await b.take("espn", T0, "g2", cookies)).toBe("ok");
    expect(await b.take("espn", T0, "g3", cookies)).toBe("day");
    expect(redis.keys().join(" ")).not.toMatch(/203\.0\.113/);
  });

  it("the HTTP client: requests carrying any ESPN cookies use the reserve, each API request's group within its share of it (B4 security review)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const budget = createBudget({ perDay: { ...SMALL, espn: 4 }, reserved: { espn: 2 }, reservedPerClient: { espn: 1 } });
    const fetchImpl = (async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const http = createHttpClient({ budget, fetchImpl, maxRetries: 0 });
    const url = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/1";
    const madeUp = `espn_s2=${"Z".repeat(40)}; SWID={00000000-0000-4000-8000-0000000000ff}`;
    const asGroup = (group: string, cookie?: string) =>
      runInRequestScope(newRequestScope("import", Date.now(), undefined, `client-of-${group}`, group), () => http.get(url, cookie ? { cookie } : {})).then(
        () => "ok",
        (e: Error) => (e instanceof BudgetExhaustedError ? `${e.name}:${e.by}` : e.name),
      );
    const results = [await asGroup("a"), await asGroup("a"), await asGroup("a", madeUp), await asGroup("a", madeUp), await asGroup("b", madeUp), await asGroup("c")];
    // The open part (2), then group a's one request of the reserve; its next is refused like the day; group b's own one goes.
    expect(results).toEqual(["ok", "ok", "ok", "BudgetExhaustedError:day", "ok", "BudgetExhaustedError:day"]);
  });

  it("the process's budget has slices and the reserve on Vercel only: local runs stay as they were", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const local = outboundBudget({});
    // 00:30 UTC: on Vercel a quarter of ESPN's day less the reserve (750); locally all 4,000.
    for (let i = 0; i < 1_000; i++) expect(local.take("espn", AT(0, 30))).toBe("ok");
    const vercel = outboundBudget({ VERCEL: "1" });
    let ok = 0;
    for (let i = 0; i < 1_000; i++) if (vercel.take("espn", AT(0, 30)) === "ok") ok++;
    expect(ok).toBe(Math.floor((budgets.perDay.espn - budgets.reservedForCookies.espn) * budgets.burstShare));
  });
});

describe("the daily quotas: the work budget and the feedback copies (final review SEC-1, F1, SEC-3)", () => {
  const WHO = { client: "c1", group: "g1" };

  it("without Redis: per client, per group and the server's day (at processShare of it), refused in that order, remembered without counting, a new day starting over", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const q = createDailyQuota({ name: "work", perClient: 10, perGroup: 15, perDay: 40, processShare: 0.5, slices: 1, burstShare: 1 });
    expect(q.charge(6, WHO, T0)).toBe("ok");
    expect(q.charge(4, WHO, T0)).toBe("ok");
    expect(q.charge(1, WHO, T0)).toBe("client"); // 11 > 10: refused, and counted nowhere (Checkpoint 7b load test, defect 2)
    expect(q.refusedAlready(WHO, T0)).toBe("client");
    expect(q.charge(1, { client: "c2", group: "g1" }, T0)).toBe("ok"); // the group: 10 + 1 = 11
    expect(q.charge(5, { client: "c3", group: "g1" }, T0)).toBe("group"); // 16 > 15
    expect(q.refusedAlready({ client: "c4", group: "g1" }, T0)).toBe("group"); // the whole group, without counting
    // The server's day: 40 × 0.5 in this process, 11 so far (the refused 1 and 5 counted nowhere).
    expect(q.charge(4, { client: "c5", group: "g2" }, T0)).toBe("ok"); // 15
    expect(q.charge(5, { client: "c6", group: "g3" }, T0)).toBe("ok"); // 20: exactly the process's share
    expect(q.charge(1, { client: "c7", group: "g4" }, T0)).toBe("day"); // 21 > 20
    expect(q.refusedAlready({ client: "c8", group: "g5" }, T0)).toBe("day");
    // A new UTC day: every count starts over.
    const tomorrow = Date.UTC(2026, 9, 5, 0, 0, 1);
    expect(q.refusedAlready(WHO, tomorrow)).toBeNull();
    expect(q.charge(1, WHO, tomorrow)).toBe("ok");
    // Logged once per limit and day, never naming a client or a group.
    const lines = spy.mock.calls.map((c) => String(c[0]));
    expect(lines).toEqual([
      '{"route":"server","event":"work_client_exhausted"}',
      '{"route":"server","event":"work_group_exhausted"}',
      '{"route":"server","event":"work_day_exhausted"}',
    ]);
  });

  it("keeps no client's or group's hash in memory past its day while requests come (the privacy page's words)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const q = createDailyQuota({ name: "work", perClient: 1, perGroup: 100, perDay: 1_000, processShare: 1, slices: 1, burstShare: 1 });
    expect(q.charge(2, WHO, T0)).toBe("client");
    expect(q.remembered()).toBeGreaterThan(0);
    // The next day, a minute in: another visitor's request sweeps the day before away.
    const next = Date.UTC(2026, 9, 5, 0, 1, 0);
    expect(q.refusedAlready({ client: "c9", group: "g9" }, next)).toBeNull();
    expect(q.remembered()).toBe(0);
  });

  it("with Redis: one counter per scope and day, all of a charge in one transaction with its expiry (the day's end and a minute), a refusal remembered without a command", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis(() => T0);
    const a = createDailyQuota({ name: "work", redis, prefix: "os:preview:", perClient: 10, perGroup: 100, perDay: 1_000, slices: 1, burstShare: 1 });
    const b = createDailyQuota({ name: "work", redis, prefix: "os:preview:", perClient: 10, perGroup: 100, perDay: 1_000, slices: 1, burstShare: 1 });
    expect(await a.charge(6, WHO, T0)).toBe("ok");
    expect(await b.charge(4, WHO, T0)).toBe("ok"); // another instance, the same counters
    expect(redis.stats.commands).toBe(6 + 6); // INCRBY and PEXPIRE for each of 3 counters
    const day = utcDay(T0);
    expect(redis.keys().sort()).toEqual([`os:preview:work:${day}`, `os:preview:work:client:c1:${day}`, `os:preview:work:group:g1:${day}`].sort());
    for (const k of redis.keys()) expect(redis.ttlMs(k)).toBe(msUntilUtcMidnight(T0) + workLimits.keyMarginMs);
    expect(await redis.get(`os:preview:work:client:c1:${day}`)).toBe("10");
    expect(await a.charge(1, WHO, T0)).toBe("client");
    const commands = redis.stats.commands;
    expect(a.charge(1, WHO, T0)).toBe("client"); // known: no promise, no command
    expect(a.refusedAlready(WHO, T0 + 1)).toBe("client");
    expect(redis.stats.commands).toBe(commands);
    // A quota without a whole-server day (the feedback copies): the client's and the group's only.
    const fb = createDailyQuota({ name: "fbq", redis, prefix: "os:preview:", perClient: 2, perGroup: 3 });
    expect(await fb.charge(1, WHO, T0)).toBe("ok");
    expect(redis.keys().filter((k) => k.includes(":fbq:")).sort()).toEqual([`os:preview:fbq:client:c1:${day}`, `os:preview:fbq:group:g1:${day}`]);
  });

  it("Redis down or slow: the process's own counts (the server's day at processShare), Redis left alone a while, logged by name once", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const down = {
      incrExpire: () => {
        calls++;
        return Promise.reject(Object.assign(new Error("ERR max requests limit exceeded"), { name: "UpstashError" }));
      },
    } as unknown as RedisLike;
    const q = createDailyQuota({ name: "work", redis: down, prefix: "os:preview:", perClient: 100, perGroup: 100, perDay: 40, processShare: 0.25, slices: 1, burstShare: 1 });
    expect(await q.charge(5, WHO, T0)).toBe("ok");
    expect(q.charge(5, WHO, T0 + 1)).toBe("ok"); // within the minute: no Redis, at once
    expect(q.charge(1, WHO, T0 + 2)).toBe("day"); // 11 > 40 × 0.25
    expect(calls).toBe(1);
    expect(spy.mock.calls.map((c) => String(c[0]))[0]).toBe('{"route":"server","event":"work_redis_error","platform":"upstash","errorName":"UpstashError"}');
    const hanging = createDailyQuota({ name: "work", redis: { incrExpire: () => new Promise<number[]>(() => {}) } as unknown as RedisLike, perClient: 5, perGroup: 5, timeoutMs: 20 });
    await expect(hanging.charge(1, WHO, T0)).resolves.toBe("ok");
  });

  it("what a request costs when it arrives: an import or a League page build by what it sends, plus its body's units (Content-Length, else its cap)", () => {
    const req = (type: string, length?: number) => new Request("https://x/api", { method: "POST", headers: { "content-type": type, ...(length !== undefined ? { "content-length": String(length) } : {}) } });
    const u = workLimits.units;
    expect(workLimits.unitBytes).toBe(75_000);
    expect(admissionUnits("import", req("application/gzip", 546_000))).toBe(u.importUpload + 8); // Parker's ESPN upload
    expect(admissionUnits("import", req("application/gzip", 12_751))).toBe(u.importUpload + 1); // a Sleeper upload
    expect(admissionUnits("import", req("application/gzip"))).toBe(u.importUpload + Math.ceil(uploadLimits.compressedBytes / workLimits.unitBytes));
    expect(admissionUnits("import", req("application/gzip", 50_000_000))).toBe(u.importUpload + Math.ceil(uploadLimits.compressedBytes / workLimits.unitBytes));
    expect(admissionUnits("import", req("application/json", 40))).toBe(u.importServer);
    expect(admissionUnits("model", req("application/gzip", 25_663))).toBe(u.modelSigned + 1);
    expect(admissionUnits("model", req("application/x-gzip"))).toBe(u.modelSigned + Math.ceil(signedUploadLimits.compressedBytes / workLimits.unitBytes));
    expect(admissionUnits("model", req("application/json", 60))).toBe(u.modelServer);
    expect(admissionUnits("session", req("application/json", 60))).toBe(0);
    expect(admissionUnits("feedback", req("application/json", 1_000))).toBe(0);
    // A model build's extra units past what its request paid for.
    expect(modelBuildExtraUnits(3_800)).toBe(0); // Parker's league
    expect(modelBuildExtraUnits(workLimits.modelWorkIncluded)).toBe(0);
    expect(modelBuildExtraUnits(workLimits.modelWorkIncluded + 1)).toBe(1);
    expect(modelBuildExtraUnits(60_000)).toBe(9);
  });

  it("once unpacked, a gzip body pays for whichever is more, its compressed or its unpacked bytes (B4 security review)", () => {
    const req = (length?: number) => new Request("https://x/api", { method: "POST", headers: { "content-type": "application/gzip", ...(length !== undefined ? { "content-length": String(length) } : {}) } });
    expect(workLimits.unpackedUnitBytes).toBe(500_000);
    // Real uploads compress 4–5 times: their compressed bytes already paid more (Parker's ESPN league; a signed import).
    expect(unpackedExtraUnits(req(546_000), uploadLimits.compressedBytes, 2_260_000)).toBe(0);
    expect(unpackedExtraUnits(req(25_663), signedUploadLimits.compressedBytes, 113_000)).toBe(0);
    // The review's body: 17,300 bytes of gzip (1 unit on arrival) unpacking to 5.85 MB (12 units).
    expect(unpackedExtraUnits(req(17_300), uploadLimits.compressedBytes, 5_850_000)).toBe(11);
    // Without Content-Length the arrival paid for the cap (27 units), more than any body under the unpacked cap owes.
    expect(unpackedExtraUnits(req(), uploadLimits.compressedBytes, uploadLimits.unpackedBytes)).toBe(0);
    expect(unpackedExtraUnits(req(100), uploadLimits.compressedBytes, 0)).toBe(0);
  });

  it("chargeWork charges the current request's client and group; outside a request, or without a budget, it's free", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const q = createDailyQuota({ name: "work", perClient: 3, perGroup: 100, perDay: 1_000, processShare: 1, slices: 1, burstShare: 1 });
    expect(await chargeWork(5, T0, q)).toBe("ok"); // outside a request
    const scope = newRequestScope("model", T0, 90_000, "c1", "g1");
    expect(await runInRequestScope(scope, () => chargeWork(3, T0, q))).toBe("ok");
    expect(await runInRequestScope(scope, () => chargeWork(1, T0, q))).toBe("client");
    expect(await runInRequestScope(scope, () => chargeWork(1, T0, null))).toBe("ok");
    expect(await runInRequestScope(scope, () => chargeWork(0, T0, q))).toBe("ok"); // nothing to charge
  });

  it("the process's quotas exist on Vercel only (this computer has no free tier to protect), with limits.ts's numbers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(workBudget({})).toBeNull();
    expect(feedbackQuota({})).toBeNull();
    const work = workBudget({ VERCEL: "1" });
    expect(work).not.toBeNull();
    let ok = 0;
    for (let i = 0; i < 600; i++) if (work?.charge(1, { client: "c", group: "g" }, Date.UTC(2026, 9, 4, 23)) === "ok") ok++;
    expect(ok).toBe(workLimits.perClientPerDay);
    expect([workLimits.perClientPerDay, workLimits.perGroupPerDay, workLimits.perDay]).toEqual([500, 2_000, 4_000]);
    const fb = feedbackQuota({ VERCEL: "1" });
    let copies = 0;
    for (let i = 0; i < 40; i++) if (fb?.charge(1, { client: "c", group: "g" }, T0) === "ok") copies++;
    expect(copies).toBe(feedbackLimits.perClientPerDay);
    expect([feedbackLimits.perClientPerDay, feedbackLimits.perGroupPerDay]).toEqual([30, 60]);
  });
});

describe("a refused attempt or charge counts nowhere (Checkpoint 7b load test, defects 1 and 2)", () => {
  const AT = (h: number) => Date.UTC(2026, 9, 4, h, 0, 0);
  const WHO = { client: "c1", group: "g1" };

  it("the outbound budget without Redis: an attempt the day refuses spends nothing of its client's share", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Two slices: half of the day's 4 open until noon, all of it after.
    const b = createBudget({ perDay: { ...SMALL, espn: 4 }, perClient: { espn: 2 }, slices: 2, burstShare: 0.5 });
    expect(b.take("espn", AT(1), "a")).toBe("ok");
    expect(b.take("espn", AT(1), "b")).toBe("ok");
    expect(b.take("espn", AT(1), "a")).toBe("day"); // the morning's half is spent
    // The afternoon opens the rest: a still has its second attempt (the refused one took nothing of its share), then not.
    expect(b.take("espn", AT(13), "a")).toBe("ok");
    expect(b.take("espn", AT(13), "a")).toBe("share");
    expect(b.take("espn", AT(13), "b")).toBe("ok"); // the day's 4th: a's refused attempts took nothing of the day either
    expect(b.take("espn", AT(13), "c")).toBe("day");
  });

  it("the outbound budget with Redis: a refusal gives back every count the attempt took, in one transaction with their expiries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis(() => T0);
    const b = createBudget({ redis, prefix: "os:preview:", perDay: { ...SMALL, espn: 2 }, perClient: { espn: 5 } });
    expect(await b.take("espn", T0, "a")).toBe("ok");
    expect(await b.take("espn", T0, "b")).toBe("ok");
    expect(await b.take("espn", T0, "a")).toBe("day"); // its share counted (2), the day (3) refused: both given back
    const day = utcDay(T0);
    expect(await redis.get(`os:preview:budget:client:espn:a:${day}`)).toBe("1");
    expect(await redis.get(`os:preview:budget:espn:${day}`)).toBe("2");
    // Commands: 4 an attempt that went out; the refused one 4 to count and 4 to give back (two counters, one transaction).
    expect(redis.stats.commands).toBe(4 + 4 + 4 + 4 + 2); // and the two GETs above
    for (const k of redis.keys()) expect(redis.ttlMs(k), k).toBeGreaterThan(0); // no counter without its expiry
  });

  it("with Redis: an attempt its client's share of the reserve refuses gives back the day's count it took (the B4 security review's reserve)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis(() => T0);
    const b = createBudget({ redis, prefix: "os:preview:", perDay: { ...SMALL, espn: 4 }, reserved: { espn: 2 }, reservedPerClient: { espn: 0 } });
    const cookies = { privileged: true };
    expect(await b.take("espn", T0, "g1", cookies)).toBe("ok"); // the open part's 2
    expect(await b.take("espn", T0, "g1", cookies)).toBe("ok");
    // The 3rd: the day counts it (3, past the open part), then g1's share of the reserve (0) refuses it: both counts go back.
    expect(await b.take("espn", T0, "g1", cookies)).toBe("day");
    const day = utcDay(T0);
    expect(await redis.get(`os:preview:budget:espn:${day}`)).toBe("2");
    expect(await redis.get(`os:preview:budget:reserve:espn:g1:${day}`)).toBe("0");
    // Another instance, whose clients have a share of the reserve: the day still has all of its reserve's 2.
    const other = createBudget({ redis, prefix: "os:preview:", perDay: { ...SMALL, espn: 4 }, reserved: { espn: 2 }, reservedPerClient: { espn: 2 } });
    expect([await other.take("espn", T0, "g2", cookies), await other.take("espn", T0, "g2", cookies)]).toEqual(["ok", "ok"]);
    expect(await redis.get(`os:preview:budget:espn:${day}`)).toBe("4");
  });

  it("refusedAlready: what this process already knows refuses (a day seen spent, a share seen over), nothing counted, nothing asked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis(() => T0);
    const b = createBudget({ redis, prefix: "os:preview:", perDay: { ...SMALL, espn: 2 }, perClient: { espn: 1 } });
    expect(b.refusedAlready?.("espn", T0, "a")).toBeNull();
    expect(await b.take("espn", T0, "a")).toBe("ok");
    expect(b.refusedAlready?.("espn", T0, "a")).toBeNull(); // not known yet: only a refusal teaches it
    expect(await b.take("espn", T0, "a")).toBe("share");
    expect(b.refusedAlready?.("espn", T0, "a")).toBe("share");
    expect(b.refusedAlready?.("espn", T0, "b")).toBeNull();
    expect(await b.take("espn", T0, "b")).toBe("ok");
    expect(await b.take("espn", T0, "c")).toBe("day");
    const commands = redis.stats.commands;
    expect(b.refusedAlready?.("espn", T0, "d")).toBe("day");
    expect(b.refusedAlready?.("sleeper", T0, "d")).toBeNull();
    for (let i = 0; i < 5; i++) b.refusedAlready?.("espn", T0, "a");
    expect(redis.stats.commands).toBe(commands); // asking costs no command
  });

  it("the work budget with Redis: a charge its client's limit refuses never touches its group or the server's day (4 commands, once)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis(() => T0);
    const q = createDailyQuota({ name: "work", redis, prefix: "os:preview:", perClient: 10, perGroup: 100, perDay: 1_000, slices: 1, burstShare: 1 });
    expect(await q.charge(10, WHO, T0)).toBe("ok");
    expect(await q.charge(6, WHO, T0)).toBe("client");
    // The ok charge 6 (INCRBY and PEXPIRE for each of 3 counters: the client's, then the group's and the day's); the refused
    // one 2 for the client's count and 2 to give it back (review of the Checkpoint 7b load-test fixes, finding 3).
    expect(redis.stats.commands).toBe(6 + 2 + 2);
    const day = utcDay(T0);
    for (const k of [`os:preview:work:client:c1:${day}`, `os:preview:work:group:g1:${day}`, `os:preview:work:${day}`]) {
      expect(await redis.get(k), k).toBe("10");
      expect(redis.ttlMs(k), k).toBe(msUntilUtcMidnight(T0) + workLimits.keyMarginMs);
    }
    // Remembered: the client's next requests cost no command; its group's other clients still have all of their room.
    const commands = redis.stats.commands;
    expect(q.charge(6, WHO, T0)).toBe("client");
    expect(redis.stats.commands).toBe(commands);
    expect(await q.charge(10, { client: "c2", group: "g1" }, T0)).toBe("ok");
    expect(await redis.get(`os:preview:work:group:g1:${day}`)).toBe("20"); // 10 + 10: nothing of the refused 6
  });

  it("a burst near a visitor's day (the load test's 5b on two instances): exactly the charges that fit stay counted, in every scope", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis(() => T0);
    const make = () => createDailyQuota({ name: "work", redis, prefix: "os:preview:", perClient: workLimits.perClientPerDay, perGroup: workLimits.perGroupPerDay, perDay: workLimits.perDay, slices: 1, burstShare: 1 });
    const [a, b] = [make(), make()];
    expect(await a.charge(480, WHO, T0)).toBe("ok");
    // 30 imports of 6 units at once, half on each instance: all in flight before either instance knows of a refusal.
    const verdicts = await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? a : b).charge(6, WHO, T0)));
    expect(verdicts.filter((v) => v === "ok")).toHaveLength(3);
    expect(verdicts.filter((v) => v === "client")).toHaveLength(27);
    const day = utcDay(T0);
    for (const k of [`os:preview:work:client:c1:${day}`, `os:preview:work:group:g1:${day}`, `os:preview:work:${day}`]) expect(await redis.get(k), k).toBe("498");
  });

  it("a give-back that fails leaves its count (fail open), logged by name, and the store is left alone a while: the refusal stands", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    class GiveBackFails extends FakeRedis {
      override async incrExpire(entries: ReadonlyArray<{ key: string; by: number; ttlMs: number }>): Promise<number[]> {
        if (entries.some((e) => e.by < 0)) throw Object.assign(new Error("fetch failed"), { name: "UpstashError" });
        return super.incrExpire(entries);
      }
    }
    const redis = new GiveBackFails(() => T0);
    const q = createDailyQuota({ name: "work", redis, prefix: "os:preview:", perClient: 10, perGroup: 100, perDay: 1_000, slices: 1, burstShare: 1 });
    expect(await q.charge(10, WHO, T0)).toBe("ok");
    expect(await q.charge(6, WHO, T0)).toBe("client");
    expect(await redis.get(`os:preview:work:client:c1:${utcDay(T0)}`)).toBe("16"); // the client's own count stays
    expect(await redis.get(`os:preview:work:${utcDay(T0)}`)).toBe("10"); // the day never had the refused units
    expect(spy.mock.calls.map((c) => String(c[0]))).toContain('{"route":"server","event":"work_redis_error","platform":"upstash","errorName":"UpstashError"}');
    const commands = redis.stats.commands;
    expect(q.charge(1, { client: "c2", group: "g2" }, T0 + 1)).toBe("ok"); // the process's own count, at once: no command
    expect(redis.stats.commands).toBe(commands);
    // The outbound budget alike.
    const b = createBudget({ redis, prefix: "os:preview:", perDay: { ...SMALL, espn: 1 } });
    expect(await b.take("espn", T0)).toBe("ok");
    expect(await b.take("espn", T0)).toBe("day");
    expect(await redis.get(`os:preview:budget:espn:${utcDay(T0)}`)).toBe("2");
    expect(spy.mock.calls.map((c) => String(c[0]))).toContain('{"route":"server","event":"budget_redis_error","platform":"upstash","errorName":"UpstashError"}');
  });
});

describe("an allowed attempt that doesn't go out gets its count back (review of the Checkpoint 7b load-test fixes, finding 1)", () => {
  const PER_DAY = { espn: 2, sleeper: 100, fantasycalc: 100, github: 100 };

  it("without Redis: refund gives back the day's count and the client's share, at most once; a refused attempt has nothing to give back", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const b = createBudget({ perDay: PER_DAY, perClient: { espn: 1 } });
    const r1: BudgetReceipt = {};
    expect(b.take("espn", T0, "a", { receipt: r1 })).toBe("ok");
    expect(r1.counted).toMatchObject({ where: "local" });
    expect(b.take("espn", T0, "b")).toBe("ok"); // the day's 2 are spent
    void b.refund?.(r1); // a's attempt didn't go out: its count goes back, the day's and a's share's
    void b.refund?.(r1); // once only
    expect(b.take("espn", T0, "a")).toBe("ok"); // a has its share again, and the day one count
    expect(b.take("espn", T0, "c")).toBe("day"); // given back twice, the day would have had room for c
    // A refused attempt counted nowhere: its receipt is empty, and refunding it does nothing.
    const refused: BudgetReceipt = {};
    expect(b.take("espn", T0, "d", { receipt: refused })).toBe("day");
    expect(refused.counted).toBeUndefined();
    void b.refund?.(refused);
    expect(b.take("sleeper", T0, "a")).toBe("ok");
  });

  it("without Redis: an attempt with cookies past the open part gets its client's share of the reserve back too", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const b = createBudget({ perDay: { ...PER_DAY, espn: 4 }, reserved: { espn: 2 }, reservedPerClient: { espn: 1 } });
    const cookies = { privileged: true };
    expect([b.take("espn", T0, "a", cookies), b.take("espn", T0, "a", cookies)]).toEqual(["ok", "ok"]); // the open part
    const inReserve: BudgetReceipt = {};
    expect(b.take("espn", T0, "a", { ...cookies, receipt: inReserve })).toBe("ok"); // a's one of the reserve
    expect(inReserve.counted).toMatchObject({ where: "local", reserve: expect.any(String) });
    void b.refund?.(inReserve);
    expect(b.take("espn", T0, "a", cookies)).toBe("ok"); // its share of the reserve is back
    expect(b.take("espn", T0, "a", cookies)).toBe("day");
  });

  it("with Redis: the counters an allowed attempt took go back in one transaction with their expiries, at most once; skipped while Redis is left alone after a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let down = false;
    class Flaky extends FakeRedis {
      override async incrExpire(entries: ReadonlyArray<{ key: string; by: number; ttlMs: number }>): Promise<number[]> {
        if (down) throw Object.assign(new Error("fetch failed"), { name: "UpstashError" });
        return super.incrExpire(entries);
      }
    }
    const redis = new Flaky(() => T0);
    const b = createBudget({ redis, prefix: "os:preview:", perDay: { ...PER_DAY, espn: 10 }, perClient: { espn: 5 } });
    const day = utcDay(T0);
    const shareKey = `os:preview:budget:client:espn:g1:${day}`;
    const dayKey = `os:preview:budget:espn:${day}`;
    const r: BudgetReceipt = {};
    expect(await b.take("espn", T0, "g1", { receipt: r })).toBe("ok");
    expect(r.counted).toEqual({ where: "shared", taken: [expect.objectContaining({ key: shareKey }), expect.objectContaining({ key: dayKey })] });
    const commands = redis.stats.commands;
    await b.refund?.(r, T0);
    expect(redis.stats.commands).toBe(commands + 4); // INCRBY −1 and PEXPIRE for each of the two counters, in one transaction
    expect([await redis.get(shareKey), await redis.get(dayKey)]).toEqual(["0", "0"]);
    expect(redis.ttlMs(shareKey)).toBe(msUntilUtcMidnight(T0) + budgets.clientKeyMarginMs);
    expect(redis.ttlMs(dayKey)).toBe(budgets.keyTtlMs);
    await b.refund?.(r, T0); // once only
    expect(redis.stats.commands).toBe(commands + 4 + 2); // and the two GETs above
    // Redis fails: the next take counts in the process and leaves Redis alone a while, and a refund then sends nothing.
    const kept: BudgetReceipt = {};
    expect(await b.take("espn", T0, "g1", { receipt: kept })).toBe("ok");
    down = true;
    expect(await b.take("espn", T0, "g2")).toBe("ok"); // fail open
    down = false;
    const before = redis.stats.commands;
    await b.refund?.(kept, T0);
    expect(redis.stats.commands).toBe(before);
    expect(await redis.get(dayKey)).toBe("1"); // the count stays, as a failed give-back's does
  });
});

describe("a charge refused by its own client's limit touches no one else's counter (review of the Checkpoint 7b load-test fixes, finding 3)", () => {
  const LIMITS = { name: "work", prefix: "os:preview:", perClient: 10, perGroup: 1_000, perDay: 100, slices: 1, burstShare: 1 } as const;
  const dayKey = `os:preview:work:${utcDay(T0)}`;

  /** One FakeRedis whose give-backs (negative increments) through `gated` wait for open(): a refusing instance that's busy. */
  function gatedGiveBacks(redis: FakeRedis) {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const gated: RedisLike = Object.assign(Object.create(redis) as RedisLike, {
      async incrExpire(entries: ReadonlyArray<{ key: string; by: number; ttlMs: number }>) {
        if (entries.some((e) => e.by < 0)) await gate;
        return redis.incrExpire(entries);
      },
    });
    return { gated, open: () => open() };
  }

  it("another visitor's charge that lands while a burst over its own day is in flight fits, and its instance remembers nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis(() => T0);
    const [a, b] = [createDailyQuota({ ...LIMITS, redis }), createDailyQuota({ ...LIMITS, redis })];
    expect(await a.charge(10, { client: "x", group: "gx" }, T0)).toBe("ok"); // x has used its 10
    for (let i = 0; i < 5; i++) expect(await b.charge(10, { client: `o${i}`, group: `go${i}` }, T0)).toBe("ok"); // the day at 60
    // x sends 5 charges of 10 at once on a, and y one of 5 on b, while x's are in flight.
    const burst = Array.from({ length: 5 }, () => a.charge(10, { client: "x", group: "gx" }, T0));
    const y = b.charge(5, { client: "y", group: "gy" }, T0);
    expect(await Promise.all(burst)).toEqual(Array(5).fill("client"));
    expect(await y).toBe("ok"); // before the fix: "day" (60 + 50 of x's units in flight + 5 > 100)
    expect(await redis.get(dayKey)).toBe("65");
    expect(b.refusedAlready({ client: "z", group: "gz" }, T0)).toBeNull(); // b refuses nobody
    expect(a.refusedAlready({ client: "x", group: "gx" }, T0)).toBe("client");
  });

  it("the same while the refusing instance's give-backs are held (its event loop busy): the day and the group never had those units", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis(() => T0);
    const { gated, open } = gatedGiveBacks(redis);
    const a = createDailyQuota({ ...LIMITS, redis: gated, perGroup: 30 });
    const b = createDailyQuota({ ...LIMITS, redis, perGroup: 30 });
    for (let i = 0; i < 7; i++) expect(await b.charge(10, { client: `o${i}`, group: `go${i}` }, T0)).toBe("ok");
    expect(await b.charge(4, { client: "o7", group: "g" }, T0)).toBe("ok"); // the day at 74; group g at 4
    expect(await a.charge(10, { client: "v", group: "g" }, T0)).toBe("ok"); // the day at 84; v at its 10; group g at 14
    expect(await b.charge(10, { client: "w", group: "g" }, T0)).toBe("ok"); // the day at 94; group g at 24
    const vRefused = a.charge(6, { client: "v", group: "g" }, T0); // over v's own 10: its give-back held
    await new Promise((r) => setTimeout(r, 0));
    // c, in v's group, at that moment: the day 94 + 6 = 100 and the group 24 + 6 = 30, both exactly full, not over.
    expect(await b.charge(6, { client: "c", group: "g" }, T0)).toBe("ok"); // before the fix: refused, and remembered
    expect(b.refusedAlready({ client: "z", group: "g" }, T0 + 60 * 60_000)).toBeNull();
    open();
    expect(await vRefused).toBe("client");
    expect(await redis.get(dayKey)).toBe("100");
    expect(await redis.get(`os:preview:work:group:g:${utcDay(T0)}`)).toBe("30");
  });

  it("a charge the server's day refused only for units another refused charge held in flight is judged again on the give-back's answer, charged again, and nothing is remembered for it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis(() => T0);
    const [a, b] = [createDailyQuota({ ...LIMITS, redis, perClient: 100 }), createDailyQuota({ ...LIMITS, redis, perClient: 100 })];
    for (let i = 0; i < 9; i++) expect(await b.charge(10, { client: `o${i}`, group: `go${i}` }, T0)).toBe("ok"); // the day at 90
    // Two charges at once: a's 15 can't fit (10 left); b's 5 can, but its count (90 + 15 + 5) saw a's units in flight.
    const [va, vb] = await Promise.all([a.charge(15, { client: "ca", group: "ga" }, T0), b.charge(5, { client: "cb", group: "gb" }, T0)]);
    expect(va).toBe("day");
    expect(vb).toBe("ok"); // a's units went back first: on the counters as they then stood (90) it fit, so it was charged again
    expect(await redis.get(dayKey)).toBe("95");
    expect(b.refusedAlready({ client: "z", group: "gz" }, T0)).toBeNull();
    // a's charge didn't fit even on the counters without it (95 + 15 > 100): that limit is remembered (refuse's rule).
    expect(a.refusedAlready({ client: "z", group: "gz" }, T0)).toBe("day");
  });
});
