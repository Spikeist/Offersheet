/**
 * /api/feedback (planner reply to Checkpoint 4c, Part B, B2; Checkpoint 7a, track FB): a copy the schema accepts is
 * stored with its day (FakeRedis) or, without a store (locally), answered { stored: false }; anything else is refused
 * unread or as INVALID_REQUEST, never echoed; through route.ts's withRoute, another site's request is refused and the
 * per-IP feedback limit applies. Fictional league; no network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { tradeSnapshot } from "@/components/trades/testFixtures";
import type { FeedbackEvent } from "@/lib/feedbackEvent";
import { feedbackEventOf, feedbackShareContext } from "@/lib/feedbackShare";
import { applyFeedback, type FeedbackRecord } from "@/lib/feedbackStore";
import { POSITIONS } from "@/engine/model";
import { createDailyQuota } from "@/server/budget";
import { feedbackLimits, rateLimits } from "@/server/limits";
import { setLogStoreForTests } from "@/server/log";
import { createMemoryLimiter } from "@/server/rateLimit";
import { FakeRedis } from "@/server/redis";
import { withRoute } from "../_lib/route";
import { createFeedbackHandler } from "./handler";

const T0 = Date.UTC(2026, 9, 4, 18, 30, 0);
const URL_ = "https://offersheet.example/api/feedback";
const SAME_SITE = { "content-type": "application/json", origin: "https://offersheet.example", host: "offersheet.example", "sec-fetch-site": "same-origin", "x-real-ip": "203.0.113.9" };

function copy(): FeedbackEvent {
  const [record] = applyFeedback([], {
    leagueKey: "espn:1a2b3c4d",
    evaluation: {
      key: "2|give:106|get:204",
      proposal: { partnerId: "2", give: [{ kind: "player", id: "106" }], get: [{ kind: "player", id: "204" }] },
      features: { g: 0.02, n: 0.3, h: 0, c: 0, a: 1, hist: null, ctx: 0, hot: 0, urg: 0, z: 0.1 },
      b: 3.2,
      b3: 6,
      tradeScore: 41,
      pAccept: 0.47,
      pComplete: 0.47,
      overall: 22,
      dPO: 0.03,
      dCH: 0.01,
      dPPW: 1.4,
      gMine: 0.01,
      gPartner: 0.02,
    },
    change: { outcome: "accepted", rid: "AbCdEfGhIjKlMnOpQrStUw" },
    at: "2026-10-04T12:00:00.000Z",
  });
  return feedbackEventOf({ record: record as FeedbackRecord, kind: "outcome", context: feedbackShareContext(tradeSnapshot(), "title") }) as FeedbackEvent;
}

const post = (body: unknown, headers: Record<string, string> = SAME_SITE) => new Request(URL_, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

afterEach(() => {
  setLogStoreForTests(undefined);
  vi.restoreAllMocks();
});

describe("the handler", () => {
  it("stores a copy with the day it arrived: 202 { stored: true }", async () => {
    const redis = new FakeRedis(() => T0);
    const handler = createFeedbackHandler({ store: () => redis, now: () => T0, env: () => ({ VERCEL: "1", VERCEL_ENV: "preview" }) });
    const res = await handler(post(copy()));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ stored: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await redis.lrange("os:preview:fb:2026-10-04", 0, -1)).toEqual([JSON.stringify({ ...copy(), day: "2026-10-04" })]);
  });

  it("without a store (npm run dev, the stable copy, check:browser): 202 { stored: false }, nothing kept", async () => {
    const res = await createFeedbackHandler({ env: () => ({}) })(post(copy()));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ stored: false });
    // A store that fails: the same answer (the browser never retries), the failure logged by name.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = createFeedbackHandler({ store: () => ({ lpushTrimExpire: () => Promise.reject(new TypeError("x")) }) as never, now: () => T0, env: () => ({}) });
    expect(await (await failing(post(copy()))).json()).toEqual({ stored: false });
  });

  it("refuses what isn't a copy, without echoing it: other fields, other shapes, not JSON, not sent as JSON, too large", async () => {
    const redis = new FakeRedis(() => T0);
    const handler = createFeedbackHandler({ store: () => redis, now: () => T0, env: () => ({ VERCEL: "1", VERCEL_ENV: "preview" }) });
    const refused = [
      post({ ...copy(), leagueId: "12345678" }),
      post({ ...copy(), trade: { ...copy().trade, partnerId: "2" } }),
      post({ ...copy(), reason: "Zorblax won't trade" }),
      post({ ...copy(), rid: "short" }),
      post("{not json"),
      post(copy(), { ...SAME_SITE, "content-type": "text/plain" }),
      post({ ...copy(), pad: "x".repeat(20_000) }),
    ];
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const req of refused) {
      const res = await handler(req);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("INVALID_REQUEST");
      expect(body.error.message).not.toMatch(/12345678|Zorblax|short|leagueId|partnerId/);
    }
    expect(redis.keys()).toEqual([]);
  });

  it("logs a refused copy by the field that failed, never its content, at most once per feedbackLimits.invalidLogEveryMs (review FB-R8)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let now = T0;
    const handler = createFeedbackHandler({ store: () => null, now: () => now, env: () => ({}) });
    expect((await handler(post({ ...copy(), trade: { ...copy().trade, give: [{ id: "zorblax_q", pos: null }] } }))).status).toBe(400);
    // Within the window: refused, not logged again (a flood can't push the day's other lines out of the error log).
    now += feedbackLimits.invalidLogEveryMs - 1;
    expect((await handler(post({ ...copy(), leagueId: "12345678" }))).status).toBe(400);
    now += 1;
    expect((await handler(post("{not json"))).status).toBe(400);
    // An accepted copy logs nothing.
    expect((await handler(post(copy()))).status).toBe(202);
    const logged = spy.mock.calls.map((c) => String(c[0]));
    expect(logged).toEqual([
      '{"route":"server","event":"feedback_invalid","code":"INVALID_TRADE","status":400}',
      '{"route":"server","event":"feedback_invalid","code":"INVALID_REQUEST","status":400}',
    ]);
    expect(logged.join("\n")).not.toMatch(/zorblax|12345678|not json/);
    expect(feedbackLimits.invalidLogEveryMs).toBe(10 * 60_000);
  });
});

describe("the store's bounds (final review SEC-3, F4)", () => {
  it("refuses a copy bigger than feedbackLimits.maxStoredBytes as stored (400, logged as INVALID_TOO_LARGE), stores nothing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis(() => T0);
    const handler = createFeedbackHandler({ store: () => redis, now: () => T0, env: () => ({ VERCEL: "1", VERCEL_ENV: "preview" }) });
    // 32 lineup slots with long keys: a copy the schema takes, bigger than any real one.
    const subsets = Array.from({ length: 1 << POSITIONS.length }, (_, m) => POSITIONS.filter((_p, i) => m & (1 << i))).sort((x, y) => y.length - x.length);
    const slots = Object.fromEntries(subsets.slice(0, 32).map((set) => [set.join("/"), 30]));
    const long = -0.12345678901234568;
    const four = (n: number) => Array.from({ length: 4 }, (_, i) => ({ id: `espn:${4_000_000 + n * 10 + i}`, pos: "WR" as const }));
    const numbers = { helps: 100, chance: 85, overall: 100, b: long, b3: -long, pAccept: -long, pComplete: -long, dPO: long, dCH: long, dPPW: long, gMine: long, gPartner: long };
    const features = { g: long, n: long, h: 1, c: 6, a: -2, hist: long, ctx: -0.8, hot: -0.15, urg: 0.2, z: long };
    const version = { version: "full", versionTrade: { give: four(3), get: four(4) }, versionAccept: { pAccept: -long, pComplete: -long }, versionInputs: { features, gPartner: long, b: long, b3: -long, helpsReason: "odds", goal: "playoffs", week: 17 } };
    const huge = { ...copy(), format: { ...copy().format, slots }, trade: { give: four(1), get: four(2) }, numbers, features, ...version };
    expect(JSON.stringify(huge).length).toBeGreaterThan(feedbackLimits.maxStoredBytes);
    const res = await handler(post(huge));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INVALID_REQUEST");
    expect(redis.keys()).toEqual([]);
    expect(spy.mock.calls.map((c) => String(c[0]))).toEqual(['{"route":"server","event":"feedback_invalid","code":"INVALID_TOO_LARGE","status":400}']);
  });

  it("each client and group may send so many copies a UTC day: past either, 429 RATE_LIMITED until the day ends, nothing stored", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis(() => T0);
    const quota = createDailyQuota({ name: "fbq", redis, prefix: "os:preview:", perClient: 2, perGroup: 4 });
    const route = withRoute("feedback", createFeedbackHandler({ store: () => redis, quota: () => quota, now: () => T0, env: () => ({ VERCEL: "1", VERCEL_ENV: "preview" }) }), {
      limiter: createMemoryLimiter(),
      now: () => T0,
      after: () => {},
    });
    const from = (ip: string) => post(copy(), { ...SAME_SITE, "x-real-ip": ip });
    expect((await route(from("203.0.113.9"))).status).toBe(202);
    expect((await route(from("203.0.113.9"))).status).toBe(202);
    const over = await route(from("203.0.113.9"));
    expect(over.status).toBe(429);
    expect(over.headers.get("retry-after")).toBe(String(5.5 * 3600));
    expect(((await over.json()) as { error: { code: string; message: string } }).error).toEqual({ code: "RATE_LIMITED", message: "You're going a bit fast. Try again in about 6 hours." });
    // Another address in the same /24: its own client count, but the group's (4: the refused copy counted too) is shared.
    expect((await route(from("203.0.113.77"))).status).toBe(202);
    expect((await route(from("203.0.113.78"))).status).toBe(429);
    // Another network: its own counts.
    expect((await route(from("198.51.100.7"))).status).toBe(202);
    expect(await redis.lrange("os:preview:fb:2026-10-04", 0, -1)).toHaveLength(4);
    expect([feedbackLimits.perClientPerDay, feedbackLimits.perGroupPerDay, feedbackLimits.maxPerDay]).toEqual([30, 60, 100]);
  });

  it("a client over its day of copies is refused before the rate limiter asks Redis anything (withRoute's pre-check)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis(() => T0);
    const quota = createDailyQuota({ name: "fbq", redis, prefix: "os:preview:", perClient: 1, perGroup: 10 });
    const check = vi.fn(createMemoryLimiter().check);
    const route = withRoute("feedback", createFeedbackHandler({ store: () => redis, quota: () => quota, now: () => T0, env: () => ({ VERCEL: "1", VERCEL_ENV: "preview" }) }), {
      limiter: { check },
      feedbackQuota: quota,
      now: () => T0,
      after: () => {},
    });
    expect((await route(post(copy()))).status).toBe(202);
    expect((await route(post(copy()))).status).toBe(429); // the handler's charge finds the client over
    expect(check).toHaveBeenCalledTimes(2);
    const commands = redis.stats.commands;
    const known = await route(post(copy()));
    expect(known.status).toBe(429);
    expect(known.headers.get("retry-after")).toBe(String(5.5 * 3600));
    expect(check).toHaveBeenCalledTimes(2); // refused before the limiter
    expect(redis.stats.commands).toBe(commands);
  });
});

describe("through withRoute (route.ts)", () => {
  it("refuses another site's request uncounted, and limits each address to rateLimits.feedback a window", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const limiter = createMemoryLimiter({ limits: { ...rateLimits, feedback: { limit: 3, windowS: 3600 } } });
    const route = withRoute("feedback", createFeedbackHandler({ env: () => ({}) }), { limiter, now: () => T0, after: () => {} });
    const forged = await route(post(copy(), { ...SAME_SITE, origin: "https://evil.example", "sec-fetch-site": "cross-site" }));
    expect(forged.status).toBe(403);
    for (let i = 0; i < 3; i++) expect((await route(post(copy()))).status).toBe(202);
    const over = await route(post(copy()));
    expect(over.status).toBe(429);
    expect(over.headers.get("retry-after")).toBeTruthy();
    expect(((await over.json()) as { error: { code: string } }).error.code).toBe("RATE_LIMITED");
    // Another address has its own count.
    expect((await route(post(copy(), { ...SAME_SITE, "x-real-ip": "198.51.100.7" }))).status).toBe(202);
    expect(rateLimits.feedback).toEqual({ limit: 60, windowS: 3600 });
  });
});
