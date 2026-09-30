import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the file cache, so the test never touches .cache/.
const store = vi.hoisted(() => new Map<string, { storedAt: number; value: unknown }>());
vi.mock("../cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cache")>();
  return {
    ...actual,
    readCache: async (ns: string, key: string, ttlMs: number, now = Date.now()) => {
      const e = store.get(`${ns}|${key}`);
      return e && now - e.storedAt <= ttlMs ? e : null;
    },
    writeCache: async (ns: string, key: string, value: unknown, now = Date.now()) => {
      store.set(`${ns}|${key}`, { storedAt: now, value });
    },
  };
});

import { adoptSiblingCache, espnLeagueDefaultsUrl, espnProTeamsUrl, sleeperProjectionsUrl, sleeperStatsUrl } from "./fetch";

const HOUR = 3600_000;
const target = { namespace: "stats", key: "stats:https://api.sleeper.app/stats/nfl/2026/3?season_type=regular" };
const sibling = { namespace: "sleeper-stats", key: "sleeper:https://api.sleeper.app/stats/nfl/2026/3?season_type=regular" };

describe("shared fetch helpers", () => {
  beforeEach(() => store.clear());

  it("builds URLs from an explicit season", () => {
    expect(sleeperProjectionsUrl(2027, 5, ["QB"])).toBe("https://api.sleeper.app/projections/nfl/2027/5?season_type=regular&position=QB");
    expect(sleeperProjectionsUrl(2026, null, ["QB", "RB"], { multi: true })).toBe("https://api.sleeper.app/projections/nfl/2026?season_type=regular&position[]=QB&position[]=RB");
    expect(sleeperStatsUrl(2026, 3)).toBe("https://api.sleeper.app/stats/nfl/2026/3?season_type=regular");
    expect(espnProTeamsUrl(2026)).toContain("/seasons/2026?view=proTeamSchedules_wl");
    expect(espnLeagueDefaultsUrl(2026, 7)).toContain("/seasons/2026/segments/0/leaguedefaults/3?scoringPeriodId=7&view=kona_player_info");
  });

  it("adopts another probe's fresh copy of the same URL and keeps its fetch time", async () => {
    const storedAt = Date.now() - HOUR;
    store.set(`${sibling.namespace}|${sibling.key}`, { storedAt, value: { status: 200, text: "[]" } });
    expect(await adoptSiblingCache(target, [sibling], 6 * HOUR)).toBe(true);
    expect(store.get(`${target.namespace}|${target.key}`)).toEqual({ storedAt, value: { status: 200, text: "[]" } });
  });

  it("never overwrites a fresh entry and ignores expired siblings", async () => {
    const now = Date.now();
    store.set(`${sibling.namespace}|${sibling.key}`, { storedAt: now - 7 * HOUR, value: "old" });
    expect(await adoptSiblingCache(target, [sibling], 6 * HOUR)).toBe(false);
    expect(store.has(`${target.namespace}|${target.key}`)).toBe(false);
    store.set(`${target.namespace}|${target.key}`, { storedAt: now, value: "mine" });
    store.set(`${sibling.namespace}|${sibling.key}`, { storedAt: now, value: "theirs" });
    expect(await adoptSiblingCache(target, [sibling], 6 * HOUR)).toBe(false);
    expect(store.get(`${target.namespace}|${target.key}`)?.value).toBe("mine");
  });
});
