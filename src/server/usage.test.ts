/**
 * The beta's usage counters (planner reply to Checkpoint 7a, §2 question 7 and §5.4; src/server/usage.ts): one key per
 * counter and UTC day, no identifiers, written after the answer, refusals held for a later write, nothing off Vercel.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUDGET_PLATFORMS } from "./budget";
import { newRequestScope, runInRequestScope } from "./deadline";
import { usageLimits } from "./limits";
import { FakeRedis, type RedisLike } from "./redis";
import {
  flushRequestUsage,
  hasUsageToWrite,
  heldUsageForTests,
  noteImport,
  noteRefusal,
  noteUsage,
  resetUsageForTests,
  setUsageStoreForTests,
  USAGE_COUNTERS,
  usageKey,
  usageStore,
  writeUsage,
} from "./usage";

const T0 = Date.UTC(2026, 9, 5, 18, 30, 0);
const DAY_MS = 24 * 60 * 60_000;

afterEach(() => {
  setUsageStoreForTests(undefined);
  resetUsageForTests();
  vi.restoreAllMocks();
});

describe("usage counters (src/server/usage.ts)", () => {
  it("names a closed set of counters (an outbound one per budgeted platform), and keys hold only the day and the name", () => {
    for (const p of BUDGET_PLATFORMS) expect(USAGE_COUNTERS).toContain(`outbound_${p}`);
    expect(usageKey("os:production:", "2026-10-05", "model_builds")).toBe("os:production:usage:2026-10-05:model_builds");
  });

  it("is off Vercel entirely: no store, nothing counted or held, even with the store's variables set", () => {
    expect(usageStore({ KV_REST_API_URL: "https://example.upstash.io", KV_REST_API_TOKEN: "x", SESSION_SECRET: "s".repeat(40) })).toBeNull();
    setUsageStoreForTests(null);
    const scope = newRequestScope("model", T0);
    void runInRequestScope(scope, async () => {
      noteUsage("model_builds");
      noteRefusal("refused_rate", T0);
    });
    expect(hasUsageToWrite(scope, T0)).toBe(false);
    expect(heldUsageForTests().size).toBe(0);
  });

  it("a request's counts wait for its after-response write: one transaction, a key per counter and day, kept 400 days", async () => {
    const store = new FakeRedis(() => T0);
    setUsageStoreForTests(store);
    const scope = newRequestScope("model", T0);
    await runInRequestScope(scope, async () => {
      noteUsage("model_builds");
      noteUsage("work_units", 4);
      noteUsage("work_units", 2);
      noteUsage("outbound_fantasycalc");
      noteImport("espn", "browser");
    });
    expect(store.stats.commands).toBe(0); // nothing before the answer
    expect(hasUsageToWrite(scope, T0)).toBe(true);
    await flushRequestUsage(scope, { env: { VERCEL_ENV: "preview" }, now: T0 });
    const key = (name: string) => `os:preview:usage:2026-10-05:${name}`;
    expect(await store.get(key("model_builds"))).toBe("1");
    expect(await store.get(key("work_units"))).toBe("6");
    expect(await store.get(key("outbound_fantasycalc"))).toBe("1");
    expect(await store.get(key("import_espn_browser"))).toBe("1");
    expect(store.ttlMs(key("model_builds"))).toBe(usageLimits.retainDays * DAY_MS);
    expect(store.stats.commands).toBe(4 * 2 + 4); // one INCRBY and PEXPIRE per counter, then the four GETs above
    // Nothing identifying in any key: the day and the counter's name only.
    for (const k of store.keys()) expect(k).toMatch(/^os:preview:usage:\d{4}-\d{2}-\d{2}:[a-z_]+$/);
    // Counted after the write (work the request left running): held by the process, not lost.
    await runInRequestScope(scope, async () => noteUsage("outbound_sleeper", 1, T0)); // T0's day, whatever today's is
    expect(Object.fromEntries(heldUsageForTests())).toEqual({ "2026-10-05\u0000outbound_sleeper": 1 });
  });

  it("refusals never cost a write of their own: held, then written with the next request that writes anyway, or once heldWriteEveryMs has passed", async () => {
    const store = new FakeRedis(() => T0);
    setUsageStoreForTests(store);
    const quiet = newRequestScope("import", T0);
    // The first refusal ever: due at once (nothing written yet), so the request's write carries it.
    noteRefusal("refused_rate", T0);
    expect(hasUsageToWrite(quiet, T0)).toBe(true);
    await flushRequestUsage(quiet, { now: T0 });
    expect(await store.get("os:local:usage:2026-10-05:refused_rate")).toBe("1");
    const before = store.stats.commands;
    // A flood of refusals within the interval: held, no write.
    for (let i = 0; i < 50; i++) noteRefusal("refused_capacity", T0 + 1_000);
    const flood = newRequestScope("import", T0 + 1_000);
    expect(hasUsageToWrite(flood, T0 + 1_000)).toBe(false);
    await flushRequestUsage(flood, { now: T0 + 1_000 });
    expect(store.stats.commands).toBe(before);
    // A request with counts of its own writes the held ones too.
    const busy = newRequestScope("model", T0 + 2_000);
    await runInRequestScope(busy, async () => noteUsage("model_builds"));
    await flushRequestUsage(busy, { now: T0 + 2_000 });
    expect(await store.get("os:local:usage:2026-10-05:refused_capacity")).toBe("50");
    expect(heldUsageForTests().size).toBe(0);
    // Past the interval, a refused request alone writes what's held.
    noteRefusal("refused_visitor", T0 + 3_000);
    expect(hasUsageToWrite(newRequestScope("import", T0 + 3_000), T0 + 3_000)).toBe(false);
    const later = T0 + 2_000 + usageLimits.heldWriteEveryMs;
    expect(hasUsageToWrite(newRequestScope("import", later), later)).toBe(true);
  });

  it("a failed or slow write is dropped and said on the console by its error's name only; it never rejects", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: RedisLike = { ...new FakeRedis(), incrExpire: () => Promise.reject(Object.assign(new Error("https://secret-db.upstash.io token=abc"), { name: "UpstashError" })) } as unknown as RedisLike;
    await expect(writeUsage(failing, new Map([["2026-10-05\u0000model_builds", 1]]))).resolves.toBeUndefined();
    const hanging = { incrExpire: () => new Promise<number[]>(() => {}) } as unknown as RedisLike;
    await expect(writeUsage(hanging, new Map([["2026-10-05\u0000model_builds", 1]]), { timeoutMs: 5 })).resolves.toBeUndefined();
    const lines = spy.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);
    expect(lines).toEqual([
      { route: "server", event: "usage_write_failed", platform: "upstash", errorName: "UpstashError" },
      { route: "server", event: "usage_write_failed", platform: "upstash", errorName: "TimeoutError" },
    ]);
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/secret-db|token=/);
  });

  it("writes nothing it doesn't recognize: a malformed day or an unknown counter is left out", async () => {
    const store = new FakeRedis(() => T0);
    await writeUsage(store, new Map([["2026-10-05\u0000model_builds", 2], ["not-a-day\u0000model_builds", 1], ["2026-10-05\u0000league_12345", 1]]), { env: { VERCEL_ENV: "production" } });
    expect(store.keys()).toEqual(["os:production:usage:2026-10-05:model_builds"]);
  });
});
