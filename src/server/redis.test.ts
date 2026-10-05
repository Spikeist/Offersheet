import { afterEach, describe, expect, it, vi } from "vitest";
import { redisClientLimits } from "./limits";
import { FakeRedis, derivedKey, getRedis, hmacId, keyPrefix, redisConfigured } from "./redis";

const SECRET = "x".repeat(40);

describe("redisConfigured / getRedis", () => {
  const base = { VERCEL: "1", SESSION_SECRET: SECRET, KV_REST_API_URL: "https://example.upstash.io", KV_REST_API_TOKEN: "t" };

  it("needs an endpoint, a token and a long enough SESSION_SECRET", () => {
    expect(redisConfigured(base)).toBe(true);
    expect(redisConfigured({ ...base, KV_REST_API_TOKEN: "" })).toBe(false);
    expect(redisConfigured({ ...base, KV_REST_API_URL: undefined })).toBe(false);
    expect(redisConfigured({ ...base, SESSION_SECRET: "short" })).toBe(false);
    expect(redisConfigured({ VERCEL: "1", SESSION_SECRET: SECRET, UPSTASH_REDIS_REST_URL: "https://e.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" })).toBe(true);
  });

  it("is used on Vercel only, unless a --live script opts in (KV_* values in .env.local never switch the local app to Upstash)", () => {
    const { VERCEL: _vercel, ...local } = base;
    void _vercel;
    expect(redisConfigured(local)).toBe(false);
    expect(getRedis(local)).toBeNull();
    expect(redisConfigured({ ...local, OFFERSHEET_REDIS: "1" })).toBe(true);
    expect(redisConfigured({ ...local, OFFERSHEET_REDIS: "true" })).toBe(false);
  });

  it("throws the SDK's UrlError for an address it refuses (its callers catch it and log only that name: its message holds the address)", () => {
    const secretish = "rediss://default:pa55word@example.upstash.io:6379";
    expect(() => getRedis({ ...base, KV_REST_API_URL: secretish })).toThrow(expect.objectContaining({ name: "UrlError" }));
  });

  it("is off for scripts run without --live", () => {
    expect(redisConfigured({ ...base, OFFERSHEET_NETWORK: "off" })).toBe(false);
    expect(getRedis({ ...base, OFFERSHEET_NETWORK: "off" })).toBeNull();
  });

  it("gives no client locally (nothing configured)", () => {
    expect(getRedis({ SESSION_SECRET: SECRET })).toBeNull();
  });
});

describe("the Upstash client getRedis builds (no network: the SDK's fetch is stubbed)", () => {
  const env = { VERCEL: "1", SESSION_SECRET: SECRET, KV_REST_API_URL: "https://example-db.upstash.invalid", KV_REST_API_TOKEN: "made-up" };
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for plain JSON answers (review CA-2): no base64 on top of the stored text, which comes back exactly as stored", async () => {
    const stored = Buffer.from(`{"storedAt":1,"value":"é ✓"}`, "utf8").toString("base64"); // an entry is base64 text
    const sent: { headers: Record<string, string>; commands: unknown[][] }[] = [];
    const answer = (command: unknown[]) => ({ result: command[0] === "get" ? stored : command[0] === "lrange" ? ['{"a":"é"}'] : "OK" });
    // Upstash's REST API: one command (POST /) or, as the SDK batches the commands of one tick, a pipeline (POST /pipeline).
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as unknown[];
      const pipeline = String(url).endsWith("/pipeline");
      const commands = (pipeline ? body : [body]) as unknown[][];
      sent.push({ headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])), commands });
      return new Response(JSON.stringify(pipeline ? commands.map(answer) : answer(commands[0] as unknown[])), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = getRedis(env);
    expect(client).not.toBeNull();
    expect(await client?.get("os:preview:c:x")).toBe(stored);
    expect(await client?.lrange("os:preview:log:x", 0, -1)).toEqual(['{"a":"é"}']);
    expect(await client?.set("k", stored, { px: 1_000 })).toBe("OK");
    expect(sent.flatMap((s) => s.commands).map((c) => c[0])).toEqual(["get", "lrange", "set"]);
    for (const s of sent) {
      expect(s.headers["upstash-encoding"]).toBeUndefined();
      expect(Object.keys(s.headers).filter((h) => h.startsWith("upstash-telemetry"))).toEqual([]);
    }
    expect(sent.flatMap((s) => s.commands)[2]).toEqual(["set", "k", stored, "px", 1_000]);
  });

  it("sends lpushTrimExpire as one MULTI/EXEC transaction (review FB-R5): LPUSH, LTRIM and PEXPIRE in one request to /multi-exec", async () => {
    const sent: { url: string; commands: unknown[][] }[] = [];
    let answer: unknown = [{ result: 3 }, { result: "OK" }, { result: 1 }];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent.push({ url: String(url), commands: JSON.parse(String(init.body)) as unknown[][] });
      return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = getRedis(env);
    expect(await client?.lpushTrimExpire("os:preview:fb:2026-10", ['{"v":1}'], 5_000, 86_400_000)).toBe(3);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url.endsWith("/multi-exec")).toBe(true);
    expect(sent[0]?.commands).toEqual([
      ["lpush", "os:preview:fb:2026-10", '{"v":1}'],
      ["ltrim", "os:preview:fb:2026-10", 0, 4_999],
      ["pexpire", "os:preview:fb:2026-10", 86_400_000],
    ]);
    // A command that failed inside the transaction rejects (the copy counts as not stored).
    answer = [{ result: 1 }, { result: "OK" }, { error: "ERR something" }];
    await expect(client?.lpushTrimExpire("k", ["v"], 10, 1_000)).rejects.toThrow();
  });

  it("retries a network error only redisClientLimits.retries times, briefly (review CA-1: the SDK's default was 5 retries over about 4 s), then rejects", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", async () => {
      attempts++;
      throw new TypeError("fetch failed");
    });
    const client = getRedis(env);
    const started = Date.now();
    await expect(client?.get("k")).rejects.toThrow();
    expect(attempts).toBe(redisClientLimits.retries + 1);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("keyPrefix", () => {
  it("scopes keys by Vercel environment, local otherwise", () => {
    expect(keyPrefix({ VERCEL_ENV: "preview" })).toBe("os:preview:");
    expect(keyPrefix({ VERCEL_ENV: "production" })).toBe("os:production:");
    expect(keyPrefix({})).toBe("os:local:");
    expect(keyPrefix({ VERCEL_ENV: "we:ird" })).toBe("os:local:");
  });
});

describe("derivedKey / hmacId", () => {
  it("derives a different 32-byte key per label, none without a secret", () => {
    const a = derivedKey("cache-key/v1", { SESSION_SECRET: SECRET });
    const b = derivedKey("client-id/v1", { SESSION_SECRET: SECRET });
    expect(a?.length).toBe(32);
    expect(a?.equals(b!)).toBe(false);
    expect(derivedKey("cache-key/v1", { SESSION_SECRET: "short" })).toBeNull();
  });

  it("hashes identifying text into a stable 32-character id that depends on the secret", () => {
    const env = { SESSION_SECRET: SECRET };
    const id = hmacId("cache-key/v1", "espn:public:2026:123456:league", env);
    expect(id).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(hmacId("cache-key/v1", "espn:public:2026:123456:league", env)).toBe(id);
    expect(hmacId("cache-key/v1", "espn:public:2026:123457:league", env)).not.toBe(id);
    expect(hmacId("cache-key/v1", "espn:public:2026:123456:league", { SESSION_SECRET: "y".repeat(40) })).not.toBe(id);
    expect(id).not.toContain("123456");
    expect(() => hmacId("cache-key/v1", "x", {})).toThrow();
  });
});

describe("FakeRedis", () => {
  it("expires PX keys on its clock and honours NX", async () => {
    let now = 1_000;
    const r = new FakeRedis(() => now);
    expect(await r.set("k", "v", { px: 100 })).toBe("OK");
    expect(await r.set("k", "w", { nx: true })).toBeNull();
    expect(await r.get("k")).toBe("v");
    now += 100;
    expect(await r.get("k")).toBeNull();
    expect(await r.set("k", "w", { nx: true, px: 50 })).toBe("OK");
    expect(r.ttlMs("k")).toBe(50);
  });

  it("counts, expires and lists like Redis", async () => {
    let now = 0;
    const r = new FakeRedis(() => now);
    expect(await r.incr("c")).toBe(1);
    expect(await r.incr("c")).toBe(2);
    expect(await r.pexpire("c", 10)).toBe(1);
    expect(await r.pexpire("missing", 10)).toBe(0);
    now = 10;
    expect(await r.incr("c")).toBe(1);
    await r.lpush("l", "a");
    await r.lpush("l", "b", "c");
    expect(await r.lrange("l", 0, -1)).toEqual(["c", "b", "a"]);
    await r.ltrim("l", 0, 1);
    expect(await r.lrange("l", 0, -1)).toEqual(["c", "b"]);
    expect(await r.mget("c", "nope")).toEqual(["1", null]);
    expect(await r.del("c", "nope")).toBe(1);
    expect(r.stats.commands).toBeGreaterThan(10);
    expect(r.stats.bytesOut).toBeGreaterThan(0);
  });

  it("lpushTrimExpire: the push, the trim to the newest `keep` and the expiry in one step, counted as 3 commands", async () => {
    let now = 0;
    const r = new FakeRedis(() => now);
    await r.lpush("l", "a", "b");
    const before = r.stats.commands;
    expect(await r.lpushTrimExpire("l", ["c", "d"], 3, 100)).toBe(4);
    expect(r.stats.commands - before).toBe(3);
    expect(await r.lrange("l", 0, -1)).toEqual(["d", "c", "b"]);
    expect(r.ttlMs("l")).toBe(100);
    now = 100;
    expect(r.keys()).toEqual([]);
  });
});
