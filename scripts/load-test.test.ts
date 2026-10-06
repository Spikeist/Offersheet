/**
 * The offline load test's own pieces (scripts/load-test.ts): its options, its checks, and one small run of the real
 * import route over the mocked platforms and FakeRedis (browser-path Sleeper uploads: the quickest path, about two seconds
 * of the server client's own pacing). No network: every request the run makes goes to the mock.
 */
import { afterEach, describe, expect, it } from "vitest";
import { modelBuildLimits } from "@/server/limits";
import { setLogStoreForTests } from "@/server/log";
import { setUsageStoreForTests } from "@/server/usage";
import {
  ALL_SCENARIOS,
  DEFAULT_OPTIONS,
  PlatformData,
  describe as describeReport,
  gzipRequest,
  hostChecks,
  maxPerMinute,
  newWorld,
  parseArgs,
  parseLatency,
  percentile,
  prng,
  repeats,
  runJobs,
  sleeperLeagueId,
  visitorIp,
  type Outbound,
} from "./load-test";
import { readInBrowser } from "@/lib/leagueRead";
import { responseOf } from "@/adapters/httpShared";
import type { HttpClient } from "@/adapters/types";
import { gzipSync } from "node:zlib";

afterEach(() => {
  setLogStoreForTests(undefined);
  setUsageStoreForTests(undefined);
});

describe("options", () => {
  it("defaults to every scenario at 50 requests, and reads each flag", () => {
    expect(parseArgs([])).toEqual(DEFAULT_OPTIONS);
    const o = parseArgs(["--scenarios", "1,5b", "--imports", "12", "--spread", "4", "--seed", "3", "--redis-ms", "0", "--fixture-size", "--latency", "espn=10-20", "--build-slots", "0"]);
    expect(o).toMatchObject({ scenarios: ["1", "5b"], imports: 12, spread: 4, seed: 3, redisMs: 0, liveSize: false, buildSlots: 0 });
    // Each instance's League page builds at once: the server's own cap by default (src/server/buildSlots.ts), 0 for none.
    expect(DEFAULT_OPTIONS.buildSlots).toBe(modelBuildLimits.concurrent);
    expect(parseArgs(["--build-slots", "3"]).buildSlots).toBe(3);
    expect(o.latency.espn).toEqual({ min: 10, max: 20 });
    expect(o.latency.sleeper).toEqual(DEFAULT_OPTIONS.latency.sleeper);
    expect(DEFAULT_OPTIONS.scenarios).toEqual([...ALL_SCENARIOS]);
  });

  it("refuses what it can't read, in words", () => {
    expect(() => parseArgs(["--scenarios", "7"])).toThrow(/unknown 7/);
    expect(() => parseArgs(["--imports", "0"])).toThrow(/at least 1/);
    expect(() => parseLatency("espn=900-300")).toThrow(/min is above its max/);
    expect(() => parseLatency("yahoo=1-2")).toThrow(/host=min-max/);
  });
});

describe("helpers", () => {
  it("percentile by nearest rank; the PRNG repeats with its seed", () => {
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3);
    expect(percentile([5, 1, 4, 2, 3], 95)).toBe(5);
    expect(percentile([], 50)).toBeNaN();
    const [a, b] = [prng(7), prng(7)];
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(visitorIp(0)).not.toBe(visitorIp(1));
    expect(sleeperLeagueId(3)).toMatch(/^\d{19}$/);
  });

  it("checks pacing per instance: one request at a time and the gap since the last one ended", () => {
    const r = (instance: number, start: number, end: number, key = `k${start}`): Outbound => ({ instance, host: "espn", what: "espn league data", key, start, end, aborted: false, status: 200 });
    const records = [r(0, 0, 500), r(0, 1100, 1500), r(1, 0, 400), r(1, 1000, 1300, "k0")];
    const espn = hostChecks(records).get("espn");
    expect(espn).toMatchObject({ requests: 4, maxConcurrent: 1, minGapMs: 600, busiestInstance: 2 });
    expect(hostChecks([r(0, 0, 500), r(0, 100, 600)]).get("espn")?.maxConcurrent).toBe(2);
    expect(repeats([r(0, 0, 1, "a"), r(0, 5, 6, "a"), r(1, 0, 1, "a")])).toBe(1);
    const sleeper = (start: number): Outbound => ({ ...r(0, start, start + 1), host: "sleeper" });
    expect(maxPerMinute([sleeper(0), sleeper(30_000), sleeper(59_999), sleeper(60_000), sleeper(119_999)], "sleeper")).toBe(3);
  });
});

/** The browser's client over the mocked platforms (as the script's own: no latency). */
function browser(data: PlatformData): HttpClient {
  return {
    async get(url, opts = {}) {
      const a = data.answer(url, Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])));
      if (!a) return { status: 404, ok: false, isHtml: false, json: undefined, text: "", fromCache: false };
      return responseOf({ status: a.status, contentType: a.contentType, text: opts.transformText ? opts.transformText(a.text) : a.text }, { fromCache: false, bigInts: opts.bigIntsAsStrings ?? false, fetchedAt: Date.now() });
    },
  };
}

describe("a small run of the real import route", () => {
  it("answers three browser-path Sleeper uploads at once, single-flighting the public data and pacing Sleeper", async () => {
    const data = new PlatformData(false);
    const read = await readInBrowser({ platform: "sleeper", body: { season: 2026, leagueId: "4999999999999999999" }, http: browser(data) });
    expect(read.kind).toBe("upload");
    const text = JSON.stringify(read.kind === "upload" ? read.upload : null);
    const world = newWorld(data, { latency: { espn: { min: 0, max: 0 }, sleeper: { min: 0, max: 2 }, fantasycalc: { min: 0, max: 0 }, github: { min: 0, max: 2 } }, seed: 1, redisMs: 0 }, 1);
    const jobs = [0, 1, 2].map((i) => ({ instance: 0, route: "importSleeper" as const, request: gzipRequest("/api/import/sleeper", visitorIp(i), gzipSync(text.split("4999999999999999999").join(sleeperLeagueId(i)))) }));
    const report = await runJobs("t", "three Sleeper uploads", world, jobs);
    expect(report.outcomes.map((o) => o.status)).toEqual([200, 200, 200]);
    // The crosswalk's 10 players lists, the NFL state and three projection weeks: fetched once for the three imports.
    const sleeper = report.outbound.filter((o) => o.host === "sleeper");
    expect(sleeper.length).toBe(14);
    expect(repeats(report.outbound)).toBe(0);
    expect(report.unanswered.size).toBe(0);
    // Every data source loaded (a source the mock fails is left out quietly: the crosswalk carries on without it), the
    // DynastyProcess map too, fetched once: the CSV is padded past its row floor whatever the checkout's line endings.
    expect([...report.warnings.keys()].filter((w) => w.startsWith("unavailable"))).toEqual([]);
    expect(report.outbound.filter((o) => o.host === "github").length).toBe(1);
    const { verdicts } = describeReport(report);
    expect(verdicts).toEqual({ internal: 0, overDeadline: 0, politeness: [] });
    // The shared store was used as on Vercel: the rate limit, the work budget and the cache all ran through it.
    expect(report.redis.uses.get("rate limit")?.commands).toBeGreaterThan(0);
    expect(report.redis.uses.get("work budget")?.commands).toBeGreaterThan(0);
    expect(report.redis.uses.get("cache")?.commands).toBeGreaterThan(0);
  }, 30_000);
});
