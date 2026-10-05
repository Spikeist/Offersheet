import { describe, expect, it } from "vitest";
import { FakeRedis } from "@/server/redis";
import { betaLogArgs, eventLine, formatBetaLog, logDays, readLogEntries, summarizeLog } from "./beta-log";

const T0 = Date.UTC(2026, 9, 4, 18, 30, 0);
const entry = (o: Record<string, unknown>) => JSON.stringify(o);

describe("npm run beta:log (track RL)", () => {
  it("reads --env, --days and --last, and says what's wrong", () => {
    expect(betaLogArgs([])).toEqual({ env: "preview", days: 14, last: 50 });
    expect(betaLogArgs(["--live", "--env", "production", "--days", "3", "--last", "20"])).toEqual({ env: "production", days: 3, last: 20 });
    expect(betaLogArgs(["--env", "local"])).toEqual({ error: "--env takes preview or production." });
    expect(betaLogArgs(["--days", "15"])).toEqual({ error: "--days takes a whole number from 1 to 14." });
    expect(betaLogArgs(["--last", "0"])).toEqual({ error: "--last takes a whole number from 1 to 2000." });
  });

  it("reads one list per UTC day, newest day first", async () => {
    expect(logDays(T0, 3)).toEqual(["2026-10-04", "2026-10-03", "2026-10-02"]);
    const redis = new FakeRedis(() => T0);
    await redis.lpush("os:preview:log:2026-10-03", entry({ route: "import", event: "a", at: T0 - 86_400_000 }));
    await redis.lpush("os:preview:log:2026-10-04", entry({ route: "model", event: "b", at: T0 }));
    await redis.lpush("os:production:log:2026-10-04", entry({ route: "model", event: "c", at: T0 }));
    const before = redis.stats.commands;
    const got = await readLogEntries(redis, "os:preview:", logDays(T0, 3));
    expect(got.map((s) => JSON.parse(s).event)).toEqual(["b", "a"]);
    expect(redis.stats.commands - before).toBe(3);
  });

  it("counts by route and code and by event, and prints the newest events' allowlisted fields only", () => {
    const entries = [
      entry({ route: "import", event: "error_response", code: "SOURCE_DOWN", platform: "espn", status: 502, ms: 812, at: T0 - 3_000 }),
      entry({ route: "import", event: "error_response", code: "SOURCE_DOWN", platform: "espn", status: 502, ms: 640, at: T0 - 2_000 }),
      entry({ route: "model", event: "deadline_cut", platform: "sleeper", ms: 90_000, at: T0 - 1_000 }),
      entry({ route: "server", event: "cache_write_failed", errorName: "UpstashError", at: T0 }),
      // Not the allowlist: counted, never printed.
      entry({ route: "import", event: "x", at: T0, url: "https://lm-api-reads.fantasy.espn.com/leagues/12345678" }),
      "not json {00000000-0000-4000-8000-000000000000}",
    ];
    const s = summarizeLog(entries, 3);
    expect(s).toMatchObject({ total: 4, invalid: 2 });
    expect(s.byRouteCode).toEqual([
      ["import SOURCE_DOWN", 2],
      ["model -", 1],
      ["server -", 1],
    ]);
    expect(s.byEvent).toEqual([
      ["error_response", 2],
      ["cache_write_failed", 1],
      ["deadline_cut", 1],
    ]);
    expect(s.newest.map((e) => e.event)).toEqual(["cache_write_failed", "deadline_cut", "error_response"]);
    expect(eventLine(s.newest[2] as never)).toBe("2026-10-04 18:29:58  import    error_response  code SOURCE_DOWN  platform espn  status 502  640 ms");
    const text = formatBetaLog(s, { env: "preview", days: 14, last: 3 }, logDays(T0, 14));
    expect(text).toContain("Offer Sheet beta log: preview, 2026-09-21 to 2026-10-04 (UTC), 4 event(s), 2 unreadable entries skipped.");
    expect(text).not.toMatch(/12345678|lm-api-reads|00000000-0000/);
    expect(formatBetaLog(summarizeLog([], 50), { env: "production", days: 1, last: 50 }, ["2026-10-04"])).toBe("Offer Sheet beta log: production, 2026-10-04 to 2026-10-04 (UTC), 0 event(s).\nNothing logged.");
  });
});
