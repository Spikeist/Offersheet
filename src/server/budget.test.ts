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
  utcDay,
  workBudget,
} from "./budget";
import { TTL } from "./cache";
import { newRequestScope, runInRequestScope } from "./deadline";
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
    // Commands: an INCR and its PEXPIRE per attempt, in one transaction (review POL-2); b, now past the limit, asks
    // nothing more.
    expect(redis.stats.commands).toBe(8);
    expect(b.take("espn", T0)).toBe("day");
    expect(redis.stats.commands).toBe(8);
    const key = `os:preview:budget:espn:${utcDay(T0)}`;
    expect(redis.keys()).toEqual([key]);
    expect(await redis.get(key)).toBe("4");
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
    // PEXPIRE, the day's), the second 4, the refused third 2 (the share's only); a's next refusal asks nothing (it knows).
    expect(redis.stats.commands).toBe(4 + 4 + 2);
    expect(a.take("espn", T0, "hmac-1")).toBe("share");
    expect(redis.stats.commands).toBe(4 + 4 + 2);
    const shareKey = `os:preview:budget:client:espn:hmac-1:${utcDay(T0)}`;
    const dayKey = `os:preview:budget:espn:${utcDay(T0)}`;
    expect(redis.keys().sort()).toEqual([dayKey, shareKey].sort());
    expect(await redis.get(shareKey)).toBe("3");
    expect(await redis.get(dayKey)).toBe("2"); // the refused attempt spent nothing of the day
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
    // The work budget's counts too.
    const quota = createDailyQuota({ name: "work", redis, prefix: "os:preview:", perClient: 5, perGroup: 10, perDay: 100, slices: 1, burstShare: 1 });
    expect(await quota.charge(1, { client: "c", group: "g" }, T0)).toBe("ok");
    for (const k of redis.keys()) expect(redis.ttlMs(k), k).toBeGreaterThan(0);
    expect(redis.keys().filter((k) => k.includes(":work:"))).toHaveLength(3);
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
    expect(q.charge(1, WHO, T0)).toBe("client"); // 11 > 10
    expect(q.refusedAlready(WHO, T0)).toBe("client");
    expect(q.charge(1, { client: "c2", group: "g1" }, T0)).toBe("ok"); // the group: 11 + 1 = 12… (the refused unit counted once)
    expect(q.charge(4, { client: "c3", group: "g1" }, T0)).toBe("group"); // 16 > 15
    expect(q.refusedAlready({ client: "c4", group: "g1" }, T0)).toBe("group"); // the whole group, without counting
    // The server's day: 40 × 0.5 in this process.
    expect(q.charge(4, { client: "c5", group: "g2" }, T0)).toBe("ok");
    expect(q.charge(5, { client: "c6", group: "g3" }, T0)).toBe("day"); // 16 + 4 + 5 > 20
    expect(q.refusedAlready({ client: "c7", group: "g4" }, T0)).toBe("day");
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
