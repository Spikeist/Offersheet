import { describe, expect, it } from "vitest";
import { isFallbackCandidate, rankUserLeagues, validLeagues } from "./discover";
import { newSalt, saltedOrder } from "./salt";
import type { SleeperLeague } from "./types";

const lg = (league_id: string, status: string, total_rosters: number, settings: Record<string, unknown> = {}) =>
  ({ league_id, status, total_rosters, season: "2026", sport: "nfl", season_type: "regular", settings: { last_scored_leg: 3, start_week: 1, ...settings }, scoring_settings: {}, roster_positions: [] }) as unknown as SleeperLeague;

describe("league lists", () => {
  it("skips malformed entries instead of crashing", () => {
    const list = [null, "x", { league_id: 5 }, { league_id: "1", settings: null, total_rosters: 12 }, lg("2", "in_season", 12)];
    expect(validLeagues(list).map((l) => l.league_id)).toEqual(["2"]);
    expect(validLeagues(null)).toEqual([]);
    expect(rankUserLeagues(list).map((l) => l.league_id)).toEqual(["2"]);
  });

  it("ranks in-season first, best ball last, then closest to 12 teams", () => {
    const ranked = rankUserLeagues([lg("a", "complete", 12), lg("b", "in_season", 10), lg("c", "in_season", 12, { best_ball: 1 }), lg("d", "in_season", 12)]);
    expect(ranked.map((l) => l.league_id)).toEqual(["d", "b", "c", "a"]);
  });

  it("accepts only full-season, non-guillotine, non-best-ball 10–12 team leagues as fallback candidates", () => {
    expect(isFallbackCandidate(lg("x", "in_season", 12), 2026)).toBe(true);
    expect(isFallbackCandidate(lg("x", "in_season", 12, { type: 3 }), 2026)).toBe(false);
    expect(isFallbackCandidate(lg("x", "in_season", 12, { best_ball: 1 }), 2026)).toBe(false);
    expect(isFallbackCandidate(lg("x", "in_season", 14), 2026)).toBe(false);
    expect(isFallbackCandidate(lg("x", "in_season", 12, { start_week: 3 }), 2026)).toBe(false);
    expect(isFallbackCandidate(lg("x", "pre_draft", 12), 2026)).toBe(false);
  });
});

describe("salted ordering", () => {
  it("is stable for a salt and changes with it", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `id${i}`);
    const a = saltedOrder(ids, (x) => x, "salt-1", "tag");
    expect(saltedOrder(ids, (x) => x, "salt-1", "tag")).toEqual(a);
    expect(saltedOrder(ids, (x) => x, "salt-2", "tag")).not.toEqual(a);
    expect(saltedOrder(ids, (x) => x, "salt-1", "other-tag")).not.toEqual(a);
    expect([...a].sort()).toEqual([...ids].sort());
  });

  it("makes random 128-bit salts", () => {
    const s = newSalt();
    expect(s).toMatch(/^[0-9a-f]{32}$/);
    expect(newSalt()).not.toBe(s);
  });
});
