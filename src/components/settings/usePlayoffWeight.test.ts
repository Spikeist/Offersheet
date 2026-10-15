/**
 * The Settings page's automatic playoff-week weight (planner reply to Checkpoint 7a, §6.1; usePlayoffWeight.ts): what a
 * weight is worked out for. It changes with whatever the League model reads (the league data, the inputs' build, my team,
 * and the settings in LEAGUE_MODEL_SETTINGS, the goal among them), never with the trade search's own settings, and there's
 * none to work out without saved inputs or settings. The fictional league of src/components/league/testFixtures.ts.
 */
import { describe, expect, it } from "vitest";
import { defaultTradeSettings, type TradeSettings } from "@/engine/settings";
import { LEAGUE_MODEL_SETTINGS } from "@/lib/settingsStore";
import { leagueFixture } from "../league/testFixtures";
import { playoffWeightTag } from "./usePlayoffWeight";

describe("playoffWeightTag", () => {
  const f = leagueFixture();
  const base = { snapshot: f.snapshot, inputs: f.inputs, myTeamId: "1", settings: defaultTradeSettings() };
  const tag = playoffWeightTag(base);

  it("changes with what the League model reads: the goal, the streamed positions, my team, the inputs' build and the league data", () => {
    expect(tag).not.toBeNull();
    expect(LEAGUE_MODEL_SETTINGS).toEqual(["streamPositions", "goal", "prizes", "untouchables", "waiverSamePosition", "returnWeeks", "returnWeeksSeason"]);
    expect(playoffWeightTag({ ...base, settings: { ...base.settings, goal: "playoffs" } })).not.toBe(tag);
    // Checkpoint 7e (planner reply to Checkpoint 7d, items 3.2, 3.3 and 3.5): the League model reads these too.
    expect(playoffWeightTag({ ...base, settings: { ...base.settings, untouchables: ["101"] } })).not.toBe(tag);
    expect(playoffWeightTag({ ...base, settings: { ...base.settings, waiverSamePosition: false } })).not.toBe(tag);
    expect(playoffWeightTag({ ...base, settings: { ...base.settings, returnWeeks: { "101": 9 } } })).not.toBe(tag);
    expect(playoffWeightTag({ ...base, settings: { ...base.settings, streamPositions: ["K"] } })).not.toBe(tag);
    expect(playoffWeightTag({ ...base, myTeamId: "2" })).not.toBe(tag);
    expect(playoffWeightTag({ ...base, myTeamId: null })).not.toBe(tag);
    expect(playoffWeightTag({ ...base, inputs: { ...f.inputs, builtAt: "2026-11-26T23:00:00.000Z" } })).not.toBe(tag);
    expect(playoffWeightTag({ ...base, snapshot: { ...f.snapshot, fetchedAt: "2026-11-26T23:00:00.000Z" } })).not.toBe(tag);
  });

  it("stays the same when only the trade search's settings change: the weight would come out the same", () => {
    const tradeOnly: Partial<TradeSettings>[] = [
      { mustInclude: ["202"] },
      { maxPerSide: 3 },
      { lambda: 0.8 },
      { protectValue: "high" },
      { minChance: 0.3 },
      { targetPositions: ["RB"] },
      { includeKDefIdp: true },
    ];
    for (const change of tradeOnly) expect(playoffWeightTag({ ...base, settings: { ...base.settings, ...change } }), JSON.stringify(change)).toBe(tag);
  });

  it("has nothing to work out without saved inputs or settings", () => {
    expect(playoffWeightTag({ ...base, inputs: null })).toBeNull();
    expect(playoffWeightTag({ ...base, inputs: undefined })).toBeNull();
    expect(playoffWeightTag({ ...base, settings: undefined })).toBeNull();
  });
});
