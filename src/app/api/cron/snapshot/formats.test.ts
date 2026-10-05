/**
 * The formats League page builds record for the snapshot cron (planner reply to Checkpoint 7a, §6.3; ./formats.ts): which
 * formats (the lists a build read, by league type), when (on Vercel with the store, after the answer, once per format and
 * day per instance) and what reaches the store (format keys only). No network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueSettings, Scoring } from "@/engine/model";
import { FakeRedis } from "@/server/redis";
import { formatsInUseKey, resetFormatsInUseForTests } from "@/server/snapshots";
import { formatKeysInUse, recordFormatsInUse } from "./formats";

const NOW = Date.parse("2026-10-07T18:00:00Z");
const DAY_KEY = formatsInUseKey("os:production:", "2026-10-07");
const VERCEL = { VERCEL: "1", VERCEL_ENV: "production" };

/** A 10-team half-PPR league's settings (fictional), of a given type. */
function settings(leagueType: LeagueSettings["leagueType"], extra: Partial<LeagueSettings> = {}): LeagueSettings {
  const scoring: Scoring = { perStat: { rec: 0.5, pass_td: 4 }, rules: [], unmapped: [] };
  return {
    numTeams: 10,
    leagueType,
    lineup: [
      { slot: "QB", count: 1, eligible: ["QB"] },
      { slot: "RB", count: 2, eligible: ["RB"] },
      { slot: "WR", count: 2, eligible: ["WR"] },
      { slot: "TE", count: 1, eligible: ["TE"] },
    ],
    benchSlots: 6,
    irSlots: 1,
    taxiSlots: 0,
    maxRosterSize: 15,
    scoring,
    regularSeasonWeeks: [1, 2, 3],
    playoffWeeks: [15, 16, 17],
    playoffTeams: 4,
    medianGame: false,
    pointsOnly: false,
    tradeDeadline: null,
    tradeReview: "none",
    ...extra,
  } as LeagueSettings;
}

const model = (market: Partial<NonNullable<ModelInputs["market"]>> | null): Pick<ModelInputs, "market"> => ({ market: market as ModelInputs["market"] });

beforeEach(() => {
  resetFormatsInUseForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("formatKeysInUse: the lists a build read", () => {
  it("redraft: its own list; keeper: dynasty and redraft; dynasty: its own, plus the redraft list in its format only when the build read one (the blend's)", () => {
    expect(formatKeysInUse(settings("redraft"), model({}))).toEqual(["redraft-1qb-10team-ppr0.5"]);
    expect(formatKeysInUse(settings("keeper"), model({}))).toEqual(["dynasty-1qb-10team-ppr0.5", "redraft-1qb-10team-ppr0.5"]);
    expect(formatKeysInUse(settings("dynasty"), model({}))).toEqual(["dynasty-1qb-10team-ppr0.5"]);
    expect(formatKeysInUse(settings("dynasty"), model({ seasonValues: { "1": 10 } }))).toEqual(["dynasty-1qb-10team-ppr0.5", "redraft-1qb-10team-ppr0.5"]);
    // FantasyCalc didn't answer: the formats it was asked for are still the ones in use.
    expect(formatKeysInUse(settings("redraft"), model(null))).toEqual(["redraft-1qb-10team-ppr0.5"]);
    // A 16-team superflex league asks for FantasyCalc's 14-team, 2-QB list.
    const big = settings("redraft", { numTeams: 16, lineup: [{ slot: "SUPER_FLEX", count: 1, eligible: ["QB", "RB", "WR", "TE"] }] });
    expect(formatKeysInUse(big, model({}))).toEqual(["redraft-2qb-14team-ppr0.5"]);
  });
});

describe("recordFormatsInUse", () => {
  it("on Vercel with the store: after the answer, one transaction into the day's set, format keys only; the model is handed back untouched", async () => {
    const redis = new FakeRedis(() => NOW);
    const tasks: Array<() => Promise<void>> = [];
    const m = model({ seasonValues: { "1": 10 } });
    const out = recordFormatsInUse(settings("dynasty"), m, { env: VERCEL, store: redis, now: NOW, schedule: (t) => void tasks.push(t) });
    expect(out).toBe(m);
    expect(redis.stats.commands).toBe(0); // nothing before the answer
    expect(tasks).toHaveLength(1);
    await tasks[0]?.();
    expect(redis.stats.commands).toBe(2);
    expect(redis.keys()).toEqual([DAY_KEY]);
    expect((await redis.smembers(DAY_KEY)).sort()).toEqual(["dynasty-1qb-10team-ppr0.5", "redraft-1qb-10team-ppr0.5"]);
    // The same formats again that day: nothing scheduled, no command.
    recordFormatsInUse(settings("dynasty"), m, { env: VERCEL, store: redis, now: NOW, schedule: (t) => void tasks.push(t) });
    expect(tasks).toHaveLength(1);
  });

  it("off Vercel (or without the store) nothing is scheduled or written", () => {
    const schedule = vi.fn();
    recordFormatsInUse(settings("redraft"), model({}), { env: {}, now: NOW, schedule });
    recordFormatsInUse(settings("redraft"), model({}), { env: VERCEL, store: null, now: NOW, schedule });
    expect(schedule).not.toHaveBeenCalled();
  });

  it("outside a Next request (after() throws) it writes at once; it never throws into a build", async () => {
    const redis = new FakeRedis(() => NOW);
    const m = model({});
    expect(recordFormatsInUse(settings("redraft"), m, { env: VERCEL, store: redis, now: NOW, schedule: () => { throw new Error("outside a request"); } })).toBe(m);
    await vi.waitFor(async () => expect(await redis.smembers(DAY_KEY)).toEqual(["redraft-1qb-10team-ppr0.5"]));
    const broken = { lineup: null } as unknown as LeagueSettings;
    expect(recordFormatsInUse(broken, m, { env: VERCEL, store: redis, now: NOW, schedule: () => {} })).toBe(m);
  });
});
