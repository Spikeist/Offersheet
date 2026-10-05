/**
 * buildLeagueModel's fallback when the season simulator refuses its setup (league.ts step 8, `simulate`):
 * sim.ts throws a RangeError for a setup it can't decide, and the rest of the League model is still good,
 * so the odds are left out with a warning instead of the whole League page failing. Any other error is
 * not swallowed. season.ts builds setups the simulator accepts (season.test.ts checks random states), so
 * no real snapshot reaches this path: the refusal is simulated by wrapping seasonOdds.
 */
import { describe, expect, it, vi } from "vitest";
import { normalizeEspnLeague } from "@/adapters/espn/normalize";
import { NOW, PARKER, fakeResolver, parkerBundle } from "@/adapters/espn/test-helpers";
import { ODDS_REFUSED_WARNING, buildLeagueModel } from "./league";
import { syntheticInputs } from "./testLeague";

/** The error the wrapped seasonOdds throws; null = the real seasonOdds. */
const refusal = vi.hoisted(() => ({ error: null as Error | null }));

vi.mock("./season", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./season")>();
  return {
    ...actual,
    seasonOdds: (...args: Parameters<typeof actual.seasonOdds>) => {
      if (refusal.error) throw refusal.error;
      return actual.seasonOdds(...args);
    },
  };
});

describe("buildLeagueModel when the season simulator refuses the setup", () => {
  const { snapshot } = normalizeEspnLeague(parkerBundle(), { leagueId: PARKER.leagueId, resolver: fakeResolver(), now: NOW, swid: PARKER.swid });
  const inputs = syntheticInputs(snapshot);
  const build = (error: Error | null, playoffWeightSims?: number) => {
    refusal.error = error;
    try {
      return buildLeagueModel(snapshot, inputs, { now: NOW, scenarios: 0, ...(playoffWeightSims !== undefined ? { playoffWeightSims } : {}) });
    } finally {
      refusal.error = null;
    }
  };

  it("leaves the odds out with a plain, generic warning (a RangeError) and keeps the rest of the model", () => {
    // The simulator's own messages name week numbers and team indexes (and buildSimSetup's, a team id): for developers only.
    const internal = "simulateSeason: the game 3–7 (weeks 5, 6) needs week 6, which isn't in weeks (5, 7)";
    const refused = build(new RangeError(internal));
    const normal = build(null);
    expect(normal.odds).not.toBeNull();
    expect(normal.warnings).toEqual([]);
    expect(refused.odds).toBeNull();
    expect(refused.oddsAsRostersStand).toBeNull();
    expect(normal.oddsAsRostersStand).not.toBeNull();
    // One warning, though two seasons are simulated (with pickups and as rosters stand: league.ts step 8).
    expect(refused.warnings).toEqual([ODDS_REFUSED_WARNING]);
    expect(ODDS_REFUSED_WARNING).toBe("The playoff odds couldn't be worked out from this league's schedule, so they're left out.");
    // Nothing of the internal message reaches any text the page shows.
    const text = JSON.stringify(refused);
    for (const part of [internal, "simulateSeason", "3–7", "weeks (5, 7)"]) expect(text, part).not.toContain(part);
    // The automatic playoff weight (league.ts step 5c) has no odds to measure on either: it falls back to the config's
    // weight, so the rest of the model is the one a build that doesn't measure it makes (playoffWeightSims 0).
    expect(normal.playoffWeightAuto?.basis).toBe("auto");
    expect(refused.playoffWeightAuto).toMatchObject({ basis: "fallback", reason: "noOdds" });
    const unmeasured = build(null, 0);
    expect(unmeasured.playoffWeightAuto).toMatchObject({ basis: "fallback", reason: "noOdds" });
    expect(refused.playoffWeight).toBe(unmeasured.playoffWeight);
    expect(refused.teams).toEqual(unmeasured.teams);
    expect(refused.partners).toEqual(unmeasured.partners);
    expect(refused.players).toEqual(normal.players);
  });

  it("the same for a refusal while the setup is built (buildSimSetup's RangeError names a team id)", () => {
    const refused = build(new RangeError("buildSimSetup: team 7 has no weekly score in the League model"));
    expect(refused.odds).toBeNull();
    expect(refused.oddsAsRostersStand).toBeNull();
    expect(refused.warnings).toEqual([ODDS_REFUSED_WARNING]);
    expect(JSON.stringify(refused.warnings)).not.toContain("team 7");
  });

  it("doesn't swallow any other error", () => {
    expect(() => build(new TypeError("not a refusal"))).toThrow(TypeError);
  });
});
