/** /api/health (planner reply to Checkpoint 7a, §1): the store this instance runs on and a timed round trip, never a secret. */
import { describe, expect, it, vi } from "vitest";
import { MemoryLruCache } from "@/server/cache";
import { healthLimits } from "@/server/limits";
import { FakeRedis, type RedisLike } from "@/server/redis";
import type { ServerCache } from "../_lib/deps";
import { createHealthHandler, type HealthBody } from "./handler";

vi.mock("server-only", () => ({}));

const SECRET = "s".repeat(40);
const URL_VALUE = "https://made-up-db.upstash.invalid";
const TOKEN_VALUE = "MADE-UP-TOKEN-VALUE";
const SHARED_ENV = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_REGION: "iad1", SESSION_SECRET: SECRET, KV_REST_API_URL: URL_VALUE, KV_REST_API_TOKEN: TOKEN_VALUE };
const memory = new MemoryLruCache(1_000_000);
const shared: ServerCache = { kind: "shared", cache: memory };
const request = () => new Request("https://offersheet.test/api/health");

/** A clock that moves 2 ms each time it's read. */
function steppingClock(): () => number {
  let t = 0;
  return () => (t += 2);
}

async function answer(res: Response): Promise<{ body: HealthBody; text: string }> {
  const text = await res.text();
  return { body: JSON.parse(text) as HealthBody, text };
}

describe("app/api/health", () => {
  it("with the shared store: one SET (60 s expiry), GET and DEL of a random key under the deployment's prefix, each timed; the key is gone after; no secret in the answer", async () => {
    const redis = new FakeRedis();
    const set = vi.spyOn(redis, "set");
    const res = await createHealthHandler({ env: SHARED_ENV, server: () => shared, redis: () => redis, clock: steppingClock() })(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { body, text } = await answer(res);
    expect(body).toEqual({ status: "ok", environment: "preview", region: "iad1", store: "shared", storeReason: null, storeCheck: { ok: true, setMs: 2, getMs: 2, delMs: 2 }, storeCheckAgeS: 0 });
    expect(redis.stats.commands).toBe(3);
    const [key, value, opts] = set.mock.calls[0] ?? [];
    expect(key).toMatch(/^os:preview:health:[0-9a-f-]{36}$/);
    expect(opts).toEqual({ px: 60_000 });
    expect(await redis.get(String(key))).toBeNull();
    for (const secret of [SECRET, URL_VALUE, TOKEN_VALUE, String(value)]) expect(text).not.toContain(secret);
  });

  it("checks the store at most once every healthLimits.checkEveryMs per instance, answering with that check and its age in between (B4 security review)", async () => {
    expect(healthLimits.checkEveryMs).toBe(5 * 60_000);
    const redis = new FakeRedis();
    let now = Date.UTC(2026, 9, 5, 12, 0, 0);
    const health = createHealthHandler({ env: SHARED_ENV, server: () => shared, redis: () => redis, clock: steppingClock(), now: () => now });
    const first = (await answer(await health(request()))).body;
    expect(first.storeCheck).toEqual({ ok: true, setMs: 2, getMs: 2, delMs: 2 });
    expect(redis.stats.commands).toBe(3);
    // Asked again and again within the window: the same check, its age, no command.
    now += 90_000;
    for (let i = 0; i < 20; i++) expect((await answer(await health(request()))).body).toMatchObject({ status: "ok", storeCheck: first.storeCheck, storeCheckAgeS: 90 });
    // Requests at the same moment share one check.
    now += healthLimits.checkEveryMs;
    await Promise.all([health(request()), health(request()), health(request())]);
    expect(redis.stats.commands).toBe(6);
    expect((await answer(await health(request()))).body.storeCheckAgeS).toBe(0);
    // A failed check stands for its window too (the next one is fresh).
    class Failing extends FakeRedis {
      override async set(): Promise<"OK" | null> {
        throw Object.assign(new Error("down"), { name: "UpstashError" });
      }
    }
    const failing = createHealthHandler({ env: SHARED_ENV, server: () => shared, redis: () => new Failing(), now: () => now });
    expect((await answer(await failing(request()))).body).toMatchObject({ status: "degraded", storeCheck: { ok: false, step: "set", errorName: "UpstashError" }, storeCheckAgeS: 0 });
  });

  it("a store that fails: the step and the error's name, never its message (an Upstash error's message can carry the address)", async () => {
    class Failing extends FakeRedis {
      override async get(): Promise<string | null> {
        const err = new Error(`could not reach ${URL_VALUE} with ${TOKEN_VALUE}`);
        err.name = "UpstashError";
        throw err;
      }
    }
    const { body, text } = await answer(await createHealthHandler({ env: SHARED_ENV, server: () => shared, redis: () => new Failing() })(request()));
    expect(body.status).toBe("degraded");
    expect(body.storeCheck).toEqual({ ok: false, step: "get", errorName: "UpstashError" });
    expect(text).not.toContain(URL_VALUE);
    expect(text).not.toContain(TOKEN_VALUE);
  });

  it("a store that hangs: the step gives up after its wait (TimeoutError)", async () => {
    class Hanging extends FakeRedis {
      override set(): Promise<"OK" | null> {
        return new Promise<"OK" | null>(() => {});
      }
    }
    const { body } = await answer(await createHealthHandler({ env: SHARED_ENV, server: () => shared, redis: () => new Hanging(), stepTimeoutMs: 20 })(request()));
    expect(body.storeCheck).toEqual({ ok: false, step: "set", errorName: "TimeoutError" });
    expect(body.status).toBe("degraded");
  });

  it("a store that reads back something else: ValueMismatch (and the key is still deleted)", async () => {
    class Wrong extends FakeRedis {
      override async get(): Promise<string | null> {
        return "something else";
      }
    }
    const redis = new Wrong();
    const del = vi.spyOn(redis, "del");
    const { body } = await answer(await createHealthHandler({ env: SHARED_ENV, server: () => shared, redis: () => redis })(request()));
    expect(body.storeCheck).toEqual({ ok: false, step: "value", errorName: "ValueMismatch" });
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("a Redis client that can't be built: its error's name only", async () => {
    const redis = (): RedisLike => {
      const err = new Error("rediss://default:MADE-UP-PASSWORD@example-db.upstash.invalid:6379");
      err.name = "UrlError";
      throw err;
    };
    const { body, text } = await answer(await createHealthHandler({ env: SHARED_ENV, server: () => shared, redis })(request()));
    expect(body.storeCheck).toEqual({ ok: false, step: "set", errorName: "UrlError" });
    expect(text).not.toContain("MADE-UP-PASSWORD");
  });

  it("on Vercel without the shared store: degraded, with the reason by name, and no store check", async () => {
    const redis = vi.fn((): RedisLike | null => new FakeRedis());
    const server = (): ServerCache => ({ kind: "memory", cache: memory, reason: "store_variables_missing" });
    const { body } = await answer(await createHealthHandler({ env: { VERCEL: "1", VERCEL_ENV: "production", VERCEL_REGION: "iad1" }, server, redis })(request()));
    expect(body).toEqual({ status: "degraded", environment: "production", region: "iad1", store: "memory", storeReason: "store_variables_missing", storeCheck: null, storeCheckAgeS: null });
    expect(redis).not.toHaveBeenCalled();
  });

  it("on this computer: the file cache, ok", async () => {
    const server = (): ServerCache => ({ kind: "file", cache: memory, reason: "not_on_vercel" });
    const { body } = await answer(await createHealthHandler({ env: {}, server })(request()));
    expect(body).toEqual({ status: "ok", environment: "local", region: null, store: "file", storeReason: "not_on_vercel", storeCheck: null, storeCheckAgeS: null });
  });

  it("never echoes an odd VERCEL_ENV or VERCEL_REGION", async () => {
    const server = (): ServerCache => ({ kind: "file", cache: memory, reason: "not_on_vercel" });
    const { body } = await answer(await createHealthHandler({ env: { VERCEL_ENV: "<b>preview</b>", VERCEL_REGION: "iad1; drop" }, server })(request()));
    expect(body.environment).toBe("local");
    expect(body.region).toBeNull();
  });
});
