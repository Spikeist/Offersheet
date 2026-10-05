import { describe, expect, it } from "vitest";
import { budgets, usageLimits, workLimits } from "@/server/limits";
import { FakeRedis } from "@/server/redis";
import { USAGE_COUNTERS, usageKey } from "@/server/usage";
import { formatUsageReport, readUsage, summarizeUsage, usageArgs, usageDays } from "./usage-report";

const T0 = Date.UTC(2026, 9, 5, 18, 30, 0); // the 5th of October, in the 2-hour slice 18:00–20:00

describe("npm run usage:report (planner reply to Checkpoint 7a, §2 question 7 and §5.4)", () => {
  it("reads --env and --days, and says what's wrong", () => {
    expect(usageArgs([])).toEqual({ env: "preview", days: 30 });
    expect(usageArgs(["--live", "--env", "production", "--days", "7"])).toEqual({ env: "production", days: 7 });
    expect(usageArgs(["--env", "local"])).toEqual({ error: "--env takes preview or production." });
    expect(usageArgs(["--days", "0"])).toEqual({ error: "--days takes a whole number from 1 to 60." });
  });

  it("reads the days shown and the whole month to date, newest first", () => {
    expect(usageDays(T0, 3)).toEqual(["2026-10-05", "2026-10-04", "2026-10-03", "2026-10-02", "2026-10-01"]);
    expect(usageDays(T0, 30)).toHaveLength(30);
    expect(usageDays(T0, 30).at(-1)).toBe("2026-09-06");
  });

  it("one MGET of every day's counters and today's budget counters; missing keys read 0, and budgets with nothing yet read none", async () => {
    const redis = new FakeRedis(() => T0);
    const p = "os:production:";
    await redis.set(usageKey(p, "2026-10-05", "model_builds"), "120");
    await redis.set(usageKey(p, "2026-10-04", "model_builds"), "300");
    await redis.set(usageKey(p, "2026-09-30", "model_builds"), "999"); // last month: not in the month to date
    await redis.set(usageKey(p, "2026-10-05", "import_espn_browser"), "40");
    await redis.set(usageKey(p, "2026-10-05", "refused_capacity"), "7");
    await redis.set(`${p}work:2026-10-05`, "1234");
    await redis.set(`${p}budget:espn:2026-10-05`, "321");
    await redis.set(usageKey("os:preview:", "2026-10-05", "model_builds"), "5"); // another environment
    const before = redis.stats.commands;
    const days = usageDays(T0, 30);
    const read = await readUsage(redis, p, days, "2026-10-05");
    expect(redis.stats.commands - before).toBe(1);
    expect(read.days[0]).toMatchObject({ day: "2026-10-05", counts: { model_builds: 120, import_espn_browser: 40, refused_capacity: 7, work_units: 0 } });
    expect(Object.keys(read.days[0]?.counts ?? {})).toEqual([...USAGE_COUNTERS]);
    expect(read.workToday).toBe(1234);
    expect(read.budgetToday).toEqual({ espn: 321, sleeper: null, fantasycalc: null, github: null });
    const s = summarizeUsage(read, { env: "production", days: 30 }, T0);
    expect(s.monthTotals.model_builds).toBe(420);
    expect(s).toMatchObject({ today: "2026-10-05", month: "2026-10", dayOfMonth: 5, daysInMonth: 31, sessionsPace: Math.round((420 / 5) * 31), sessionsWarn: false, sessionsOver: false });
    expect(s.workOpenNow).toBe(Math.floor((workLimits.perDay * 10) / 12)); // slice 9 of 12 (18:00–20:00) opens 10/12 of the day
    const text = formatUsageReport(s, { env: "production", days: 30 });
    expect(text).toContain(`Sessions this month: 420 of ${usageLimits.fantasyCalcSessionsPerMonth.toLocaleString("en-US")} (FantasyCalc's free limit).`);
    expect(text).toContain(`Work units: 1,234 of ${workLimits.perDay.toLocaleString("en-US")} for the day`);
    expect(text).toContain(`321 of  ${budgets.perDay.espn.toLocaleString("en-US")}`);
    expect(text).toContain('Refused for capacity ("The beta is at capacity today."): 7.');
    expect(text).not.toContain("WARNING");
    expect(text).toContain("vercel@62.2.0 usage --group-by project --non-interactive");
  });

  it("warns from 8,000 sessions a month, and says when the month is past FantasyCalc's 10,000", async () => {
    const at = async (sessions: number) => {
      const redis = new FakeRedis(() => T0);
      await redis.set(usageKey("os:preview:", "2026-10-05", "model_builds"), String(sessions));
      const read = await readUsage(redis, "os:preview:", usageDays(T0, 30), "2026-10-05");
      return formatUsageReport(summarizeUsage(read, { env: "preview", days: 30 }, T0), { env: "preview", days: 30 });
    };
    expect(usageLimits).toMatchObject({ fantasyCalcSessionsPerMonth: 10_000, fantasyCalcSessionsWarnAt: 8_000 });
    expect(await at(7_999)).not.toContain("WARNING");
    expect(await at(8_000)).toContain("WARNING: past 8,000. Write to FantasyCalc before the month reaches 10,000");
    expect(await at(10_000)).toContain("WARNING: past FantasyCalc's free 10,000 a month.");
  });
});
