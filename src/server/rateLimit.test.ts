import { afterEach, describe, expect, it, vi } from "vitest";
import { rateLimits } from "./limits";
import { CLIENT_ID_LABEL, clientIds, clientIp, clientKey, createMemoryLimiter, createSharedLimiter, ipBucket, ipGroup, ipv6Groups, processLimiter, type RatelimitRedis } from "./rateLimit";
import { FakeRedis, hmacId } from "./redis";

const SECRET = "s".repeat(40);
const T0 = Date.UTC(2026, 9, 4, 18, 0, 0); // a multiple of every window
const req = (headers: Record<string, string> = {}) => new Request("http://localhost:3001/api/import/espn", { method: "POST", headers });

/**
 * @upstash/ratelimit's Redis as far as its fixed window uses it: EVALSHA of the limit script (INCRBY the window's key, and
 * PEXPIRE it on the window's first request), on a FakeRedis that counts commands the way Upstash bills them.
 */
function ratelimitRedis(redis: FakeRedis, opts: { fail?: () => Promise<never> } = {}) {
  const calls: string[][] = [];
  const run = async (keys: string[], args: unknown[]) => {
    calls.push(keys);
    if (opts.fail) return opts.fail();
    const key = keys[0] as string;
    const [tokens, windowMs, incrementBy] = args.map(Number) as [number, number, number];
    let r = 0;
    for (let i = 0; i < incrementBy; i++) r = await redis.incr(key);
    if (r === incrementBy) await redis.pexpire(key, windowMs);
    return [r, tokens];
  };
  const client = {
    evalsha: (_hash: string, keys: string[], args: unknown[]) => run(keys, args),
    eval: (_script: string, keys: string[], args: unknown[]) => run(keys, args),
    get: async () => null,
    set: async () => "OK",
  };
  return { client: client as unknown as RatelimitRedis, calls };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the client (track RL: per IP, by an HMAC, IPv6 by /64)", () => {
  it("reads x-real-ip, else the first x-forwarded-for", () => {
    expect(clientIp(req({ "x-real-ip": " 203.0.113.9 ", "x-forwarded-for": "198.51.100.1" }))).toBe("203.0.113.9");
    expect(clientIp(req({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("198.51.100.1");
    expect(clientIp(req())).toBeUndefined();
  });

  it("buckets IPv4 as is and IPv6 by /64; ports, brackets, zones and mapped forms read the same; anything else is unknown", () => {
    expect(ipBucket("203.0.113.9")).toBe("203.0.113.9");
    expect(ipBucket("203.0.113.9:443")).toBe("203.0.113.9");
    expect(ipBucket("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(ipBucket("::ffff:cb00:7109")).toBe("203.0.113.9");
    expect(ipBucket("2001:DB8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(ipBucket("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(ipBucket("[2001:db8:0001:0002::ff]:8080")).toBe("2001:db8:1:2::/64");
    expect(ipBucket("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(ipBucket("::1")).toBe("0:0:0:0::/64");
    expect(ipBucket("64:ff9b::192.0.2.33")).toBe("64:ff9b:0:0::/64");
    for (const bad of [undefined, "", "unknown", "999.1.1.1", "1.2.3", "2001:db8::1::2", "gggg::1", "1:2:3:4:5:6:7:8:9"]) expect(ipBucket(bad)).toBe("unknown");
    expect(ipv6Groups("1:2:3:4:5:6:7:8")).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
  });

  it("the key is an HMAC of the bucket under SESSION_SECRET (the same on every instance), never the address", () => {
    const env = { SESSION_SECRET: SECRET };
    const a = clientKey(req({ "x-real-ip": "2001:db8:1:2::1" }), env);
    expect(a).toBe(hmacId(CLIENT_ID_LABEL, "2001:db8:1:2::/64", env));
    expect(clientKey(req({ "x-real-ip": "2001:db8:1:2:ffff::9" }), env)).toBe(a); // the same /64
    expect(clientKey(req({ "x-real-ip": "2001:db8:1:3::1" }), env)).not.toBe(a);
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a).not.toContain("2001");
    // Without SESSION_SECRET: an HMAC under this process's own random key (stable in the process, never the address).
    const local = clientKey(req({ "x-real-ip": "203.0.113.9" }), {});
    expect(local).toBe(clientKey(req({ "x-real-ip": "203.0.113.9" }), {}));
    expect(local).not.toBe(hmacId(CLIENT_ID_LABEL, "203.0.113.9", env));
    expect(local).not.toContain("203");
  });
});

describe("the client's group (final review SEC-2: an IPv4 /24, an IPv6 /48)", () => {
  it("groups IPv4 by its /24 and IPv6 by its /48, the mapped forms as IPv4; anything else is unknown", () => {
    expect(ipGroup("203.0.113.9")).toBe("203.0.113.0/24");
    expect(ipGroup("203.0.113.250:8080")).toBe("203.0.113.0/24");
    expect(ipGroup("::ffff:203.0.113.9")).toBe("203.0.113.0/24");
    expect(ipGroup("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48");
    expect(ipGroup("2001:DB8:ABCD:FFFF:1:2:3:4")).toBe("2001:db8:abcd::/48");
    expect(ipGroup("[2001:db8:0:1::1]:443")).toBe("2001:db8:0::/48");
    for (const bad of [undefined, "", "not an address", "999.1.1.1"]) expect(ipGroup(bad)).toBe("unknown");
  });

  it("ids: the client's (clientKey) and its group's, both HMACs under SESSION_SECRET, never an address; IPv6 marked", () => {
    const env = { SESSION_SECRET: SECRET };
    const v4 = clientIds(req({ "x-real-ip": "203.0.113.9" }), env);
    expect(v4).toEqual({ client: clientKey(req({ "x-real-ip": "203.0.113.9" }), env), group: hmacId(CLIENT_ID_LABEL, "203.0.113.0/24", env), ipv6: false });
    expect(clientIds(req({ "x-real-ip": "203.0.113.77" }), env).group).toBe(v4.group);
    expect(clientIds(req({ "x-real-ip": "203.0.114.9" }), env).group).not.toBe(v4.group);
    // Eight /64s of one /48: eight clients, one group (review SEC-2's probe B).
    const v6 = Array.from({ length: 8 }, (_, n) => clientIds(req({ "x-real-ip": `2001:db8:abcd:${(n + 1).toString(16)}::1` }), env));
    expect(new Set(v6.map((i) => i.client)).size).toBe(8);
    expect(new Set(v6.map((i) => i.group))).toEqual(new Set([hmacId(CLIENT_ID_LABEL, "2001:db8:abcd::/48", env)]));
    expect(v6.every((i) => i.ipv6)).toBe(true);
    expect(JSON.stringify([v4, ...v6])).not.toMatch(/203\.0\.113|2001:db8/);
  });

  it("a group's window allows rateLimits.groupFactor times the limit, in memory and in Redis (its own keys)", async () => {
    expect(rateLimits.groupFactor).toBe(10);
    const limits = { ...rateLimits, import: { limit: 2, windowS: 600 } };
    const mem = createMemoryLimiter({ limits });
    let allowed = 0;
    for (let i = 0; i < 25; i++) if ((await mem.check("import", "g", T0, "group")).allowed) allowed++;
    expect(allowed).toBe(20);
    expect((await mem.check("import", "g", T0)).allowed).toBe(true); // the same id as a client: its own window
    vi.useFakeTimers({ now: T0 });
    const redis = new FakeRedis(() => Date.now());
    const { client } = ratelimitRedis(redis);
    const shared = createSharedLimiter(client, { prefix: "os:preview:", limits });
    allowed = 0;
    for (let i = 0; i < 25; i++) if ((await shared.check("import", "g", T0, "group")).allowed) allowed++;
    expect(allowed).toBe(20);
    const window = Math.floor(T0 / 600_000);
    expect(redis.keys()).toEqual([`os:preview:rl:import:g:g:${window}`]);
  });
});

describe("the process's own windows (no Redis: local, the stable copy, tests)", () => {
  it("allows the kind's limit per fixed window, then refuses with the seconds left; the first refusal is marked once", async () => {
    expect(rateLimits).toMatchObject({ import: { limit: 30, windowS: 600 }, model: { limit: 30, windowS: 600 }, session: { limit: 20, windowS: 600 }, feedback: { limit: 60, windowS: 3600 } });
    const l = createMemoryLimiter();
    for (let i = 0; i < 30; i++) expect((await l.check("import", "c1", T0 + i)).allowed).toBe(true);
    expect(await l.check("import", "c1", T0 + 100_000)).toEqual({ allowed: false, retryAfterS: 500, firstRefusal: true });
    expect(await l.check("import", "c1", T0 + 100_001)).toMatchObject({ allowed: false, firstRefusal: false });
    expect((await l.check("model", "c1", T0)).allowed).toBe(true); // each kind its own window
    expect((await l.check("import", "c2", T0)).allowed).toBe(true); // each client its own
    expect((await l.check("import", "c1", T0 + 600_000)).allowed).toBe(true); // the next window starts over
  });

  it("stays bounded: past its size, ended windows go, then the oldest", async () => {
    const l = createMemoryLimiter({ maxKeys: 3, limits: { ...rateLimits, session: { limit: 1, windowS: 600 } } });
    await l.check("session", "a", T0);
    expect((await l.check("session", "a", T0)).allowed).toBe(false);
    for (const c of ["b", "c", "d"]) await l.check("session", c, T0);
    // "a" was the oldest of a full table: dropped, so it starts again (memory stays bounded).
    expect((await l.check("session", "a", T0)).allowed).toBe(true);
  });

  it("drops a client soon after its window ends, however few clients there are (review RL-10: no hash kept past its window)", async () => {
    const l = createMemoryLimiter({ sweepEveryMs: 60_000 });
    await l.check("import", "a", T0); // a 10-minute window
    await l.check("feedback", "b", T0); // an hour's window
    expect(l.size()).toBe(2);
    // "a"'s window ended: the next request, any client's, drops it (the sweep runs at most once a minute).
    await l.check("import", "c", T0 + 630_000);
    expect(l.size()).toBe(2); // "b" (its hour isn't over) and "c"
    await l.check("import", "c", T0 + 640_000);
    expect(l.size()).toBe(2);
    // An hour on: "b"'s window ended too, and "c"'s first one ("c" counts again in a new window).
    await l.check("import", "c", T0 + 3_660_000);
    expect(l.size()).toBe(1);
  });
});

describe("shared windows (Redis, @upstash/ratelimit's fixed window)", () => {
  it("counts in Redis under the hashed client, 2–3 commands a check; a refused client is refused again from memory", async () => {
    vi.useFakeTimers({ now: T0 });
    const redis = new FakeRedis(() => Date.now());
    const { client, calls } = ratelimitRedis(redis);
    const limits = { ...rateLimits, model: { limit: 2, windowS: 600 } };
    const id = hmacId(CLIENT_ID_LABEL, "203.0.113.9", { SESSION_SECRET: SECRET });
    const a = createSharedLimiter(client, { prefix: "os:preview:", limits });
    const b = createSharedLimiter(client, { prefix: "os:preview:", limits }); // another instance
    expect((await a.check("model", id)).allowed).toBe(true);
    expect((await b.check("model", id)).allowed).toBe(true);
    expect(await a.check("model", id)).toEqual({ allowed: false, retryAfterS: 600, firstRefusal: true });
    // Upstash bills the script's own commands: INCRBY each check, PEXPIRE on the window's first.
    expect(redis.stats.commands).toBe(4);
    const window = Math.floor(T0 / 600_000);
    expect(redis.keys()).toEqual([`os:preview:rl:model:${id}:${window}`]);
    expect(redis.ttlMs(redis.keys()[0] as string)).toBe(600_000);
    expect(redis.keys().join(" ")).not.toContain("203.0.113");
    // Refused again by a's ephemeral cache, without Redis, and not a "first" refusal.
    expect(await a.check("model", id)).toMatchObject({ allowed: false, firstRefusal: false });
    expect(calls).toHaveLength(3);
  });

  it("only the imports and League page builds count in Redis; every other kind counts in each instance's own windows, without a command (B4 security review)", async () => {
    vi.useFakeTimers({ now: T0 });
    expect(rateLimits.sharedKinds).toEqual(["import", "model"]);
    const redis = new FakeRedis(() => Date.now());
    const { client, calls } = ratelimitRedis(redis);
    const a = createSharedLimiter(client, { prefix: "os:preview:" });
    const b = createSharedLimiter(client, { prefix: "os:preview:" }); // another instance
    for (const kind of ["health", "session", "cron", "feedback"] as const) {
      const { limit } = rateLimits[kind];
      for (let i = 0; i < limit; i++) expect((await a.check(kind, "c")).allowed).toBe(true);
      expect(await a.check(kind, "c")).toMatchObject({ allowed: false, firstRefusal: true });
      // Each instance counts its own: the other one's window is fresh.
      expect((await b.check(kind, "c")).allowed).toBe(true);
      // An IPv6 group's window too.
      expect((await a.check(kind, "g", T0, "group")).allowed).toBe(true);
    }
    expect(calls).toHaveLength(0);
    expect(redis.stats.commands).toBe(0);
    expect(redis.keys()).toEqual([]);
    // The shared kinds still go to Redis.
    expect((await a.check("import", "c")).allowed).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("fails open to the process's own windows when Redis errs or is slow, logged once, and leaves Redis alone a while", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis();
    const failing = ratelimitRedis(redis, { fail: () => Promise.reject(Object.assign(new Error("ERR max requests limit exceeded"), { name: "UpstashError" })) });
    const l = createSharedLimiter(failing.client, { prefix: "os:preview:", redisRetryAfterMs: 60_000 });
    const now = Date.now();
    expect((await l.check("import", "c", now)).allowed).toBe(true);
    expect((await l.check("import", "c", now + 1)).allowed).toBe(true);
    expect(failing.calls).toHaveLength(1); // the second check didn't ask Redis
    const hanging = ratelimitRedis(redis, { fail: () => new Promise<never>(() => {}) });
    const slow = createSharedLimiter(hanging.client, { prefix: "os:preview:", timeoutMs: 20 });
    expect((await slow.check("model", "c")).allowed).toBe(true);
    expect(spy.mock.calls.map((c) => String(c[0]))).toEqual([
      '{"route":"server","event":"limiter_error","platform":"upstash","errorName":"UpstashError"}',
      '{"route":"server","event":"limiter_timeout","platform":"upstash"}',
    ]);
    // The process's own windows still hold while Redis is away.
    const strict = createSharedLimiter(failing.client, { prefix: "os:preview:", limits: { ...rateLimits, feedback: { limit: 1, windowS: 3600 } } });
    expect((await strict.check("feedback", "c", T0)).allowed).toBe(true);
    expect((await strict.check("feedback", "c", T0 + 1)).allowed).toBe(false);
  });

  it("forgets a refused client soon after its window ends (review RL-10), not when it's checked again", async () => {
    vi.useFakeTimers({ now: T0 });
    const redis = new FakeRedis(() => Date.now());
    const { client } = ratelimitRedis(redis);
    const l = createSharedLimiter(client, { prefix: "os:preview:", limits: { ...rateLimits, import: { limit: 1, windowS: 600 } }, sweepEveryMs: 60_000 });
    await l.check("import", "refused");
    expect((await l.check("import", "refused")).allowed).toBe(false);
    expect(l.refusedInMemory()).toBe(1);
    vi.setSystemTime(T0 + 600_000 + 60_000);
    await l.check("import", "someone-else");
    expect(l.refusedInMemory()).toBe(0);
  });
});

describe("the process's limiter (review RL-5, RL-7)", () => {
  const KV = { KV_REST_API_URL: "https://example-12345.upstash.io", KV_REST_API_TOKEN: "test-token-not-real", SESSION_SECRET: "s".repeat(40) };

  it("off Vercel it's this process's own windows, whatever .env.local holds (local runs never contact Upstash)", () => {
    const local = processLimiter({ ...KV }) as ReturnType<typeof createMemoryLimiter>;
    expect(typeof local.size).toBe("function"); // the memory limiter
    expect(processLimiter({ VERCEL: "1" })).toHaveProperty("size"); // on Vercel without Redis: the same
    // On Vercel with Redis: the shared limiter (built without a request).
    expect(processLimiter({ ...KV, VERCEL: "1" })).toHaveProperty("refusedInMemory");
  });

  it("a Redis address that can't be used fails open to this process's windows, logged by the error's name only", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const l = processLimiter({ ...KV, KV_REST_API_URL: "rediss://default:FAKE-PASSWORD-NOT-REAL@example-12345.upstash.io:6379", VERCEL: "1" });
    expect(l).toHaveProperty("size");
    const lines = spy.mock.calls.map((c) => String(c[0]));
    expect(lines).toEqual(['{"route":"server","event":"redis_config_invalid","platform":"upstash","errorName":"UrlError"}']);
    expect(lines.join("\n")).not.toContain("FAKE-PASSWORD");
  });
});
