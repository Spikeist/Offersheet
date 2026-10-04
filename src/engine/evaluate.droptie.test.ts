/**
 * Forced drops break near-ties by trade value floored at the waiver credit W (final review of Phase 4c, finding R6;
 * config.lineups.dropNearTieWeekly; evaluate.ts dropOrder, teamValue.lowestKeepValue): on Parker's league a 2-for-1 cut
 * Kyle Monangai (worth [value]) where Romeo Doubs ([value]) cost the lineup 0.05 points a week more. Here, in expected-value
 * lineups, a bench WR who starts once (my WR1's bye) costs 0.1 point more to lose than the one behind him, who's worth far
 * more: legality cuts the cheaper one; when both are worth at most W, the lineup decides. The market blend is off (config
 * mocked), so each player's projection is his points exactly; the tolerance is switchable. A hand-built league, made-up
 * players.
 */
import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ tie: 0.2 }));
vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  const c = actual.config;
  const lineups = { ...c.lineups };
  Object.defineProperty(lineups, "dropNearTieWeekly", { get: () => env.tie, enumerable: true });
  return { ...actual, config: { ...c, marketBlend: { ...c.marketBlend, weight: 0 }, lineups } };
});

import { config } from "./config";
import { buildTradeContext, evaluateExact, tradeInternals } from "./evaluate";
import { lowestKeepValue } from "./teamValue";
import type { TradeAsset } from "./tradeModel";
import { TEST_NOW, type TestLeagueSpec, type TestPlayer } from "./testLeague";
import { flat, handLeague } from "./trade.testing";

const players = (ids: readonly string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));

function swapPlayer(spec: TestLeagueSpec, teamId: string, id: string, by: TestPlayer): void {
  const team = spec.teams.find((t) => t.id === teamId);
  const i = team ? team.roster.findIndex((x) => x.id === id) : -1;
  if (!team || i < 0) throw new Error(`no player ${id} on team ${teamId}`);
  team.roster[i] = by;
}

describe("lowestKeepValue's near-ties", () => {
  const c = (id: string, keep: number, value: number) => ({ id, keep, value });
  it("exact ties only without a tolerance; within one, the lowest value (then the lower keep value, then the smaller id)", () => {
    const list = [c("a", 0, 5000), c("b", 0.1, 240), c("c", 3, 100)];
    expect(lowestKeepValue(list)).toBe("a");
    expect(lowestKeepValue(list, 0)).toBe("a");
    expect(lowestKeepValue(list, 0.1)).toBe("b");
    expect(lowestKeepValue(list, 0.09)).toBe("a");
    expect(lowestKeepValue(list, 5)).toBe("c");
    expect(lowestKeepValue([c("b", 0.1, 240), c("a", 0, 240)], 1)).toBe("a");
    expect(lowestKeepValue([c("y", 0, 240), c("x", 0, 240)], 1)).toBe("x");
    expect(lowestKeepValue([], 1)).toBeNull();
    // Values floored at W (the waiver credit): between players worth at most W the lower keep value goes, as without a
    // tolerance; only a player worth more than W is kept over a near-free one.
    expect(lowestKeepValue([c("a", 0, 300), c("b", 0.1, 200)], 1, 400)).toBe("a");
    expect(lowestKeepValue([c("a", 0, 300), c("b", 0.1, 200)], 1)).toBe("b");
    expect(lowestKeepValue([c("a", 0, 5000), c("b", 0.1, 200)], 1, 400)).toBe("b");
    // Floored ties: the lower keep value, then the lower value, then the smaller id.
    expect(lowestKeepValue([c("b", 0, 300), c("a", 0, 200)], 1, 400)).toBe("a");
  });
});

describe("roster legality's forced drop (final review of Phase 4c, finding R6)", () => {
  // My WR1 is on bye in week 6. My bench: a WR of 3.1 (worth 240) who starts that week, and a WR of 3.0 (worth 5,000) who
  // never starts. A 2-for-1 (my TE for their TE and a bench RB) leaves me one over the roster size.
  const league = handLeague((spec) => {
    swapPlayer(spec, "1", "wa1", flat("wa1", "WR", 14, { nflTeam: "B6" }));
    swapPlayer(spec, "1", "rc1", flat("wx1", "WR", 3, { value: 5000 }));
    spec.byeWeek = { B6: 6 };
  });
  const drops = (tie: number, l = league): string[] => {
    env.tie = tie;
    const I = tradeInternals(buildTradeContext({ ...l.snapshot, myTeamId: "1" }, l.inputs, { now: TEST_NOW, scenarios: 0 }));
    expect(I.credit).toBe(900);
    const x = evaluateExact(I, { partnerId: "2", give: players(["te1"]), get: players(["te2", "rc2"]) }, 3);
    if ("illegal" in x) throw new Error(x.illegal);
    return x.evaluation.required.me.drops;
  };

  it("exact ties only: the stash who never starts goes, though he's worth 5,000", () => {
    expect(drops(0)).toEqual(["wx1"]);
  });

  it("a near-tie (0.1 point, under 0.2 a week × the weeks' weights): the bench WR worth 240 goes instead", () => {
    expect(drops(0.2)).toEqual(["wc1"]);
    env.tie = 0.2;
    expect(config.lineups.dropNearTieWeekly).toBe(0.2);
  });

  it("both worth at most W (900): the lineup decides, as without a tolerance (their trade value is the best free agent's either way)", () => {
    const cheap = handLeague((spec) => {
      swapPlayer(spec, "1", "wa1", flat("wa1", "WR", 14, { nflTeam: "B6" }));
      swapPlayer(spec, "1", "rc1", flat("wx1", "WR", 3, { value: 800 }));
      spec.byeWeek = { B6: 6 };
    });
    expect(drops(0.2, cheap)).toEqual(["wx1"]);
    expect(drops(0, cheap)).toEqual(["wx1"]);
  });
});
