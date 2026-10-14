/**
 * The season-to-date weight by position through the League model (planner reply to Checkpoint 7d, item 1.2: "Set the
 * season-to-date weight (α) to 0 for K and DEF, as a per-position setting in config. Their projections then come from ESPN
 * and Sleeper alone."; config.projections.actualWeightByPos). On Parker's league (the committed sanitized ESPN fixture) with
 * synthetic inputs, where most players have games this season, a build under config is compared with one under the rule
 * before (every position at actualWeight: an empty actualWeightByPos, which the code reads exactly as before): only the
 * kickers' and team defenses' projections move, and every other player's PlayerModel stays bit for bit.
 */
import { describe, expect, it } from "vitest";
import { normalizeEspnLeague } from "@/adapters/espn/normalize";
import { NOW, PARKER, fakeResolver, parkerBundle } from "@/adapters/espn/test-helpers";
import { config } from "./config";
import { availabilityNoteFor, buildLeagueModel, type LeagueModelConfig } from "./league";
import { priorHealthyBaseRate } from "./projections";
import { syntheticInputs } from "./testLeague";

describe("K and DEF without the season-to-date weight, through the League model (planner reply to Checkpoint 7d, item 1.2)", () => {
  const { snapshot } = normalizeEspnLeague(parkerBundle(), { leagueId: PARKER.leagueId, resolver: fakeResolver(), now: NOW, swid: PARKER.swid });
  const inputs = syntheticInputs(snapshot);
  /** The rule before item 1.2: every position at actualWeight. */
  const before: LeagueModelConfig = { ...config, projections: { ...config.projections, actualWeightByPos: {} } };
  const opts = { now: NOW, scenarios: 0, sims: 0 };
  const after = buildLeagueModel(snapshot, inputs, opts);
  const old = buildLeagueModel(snapshot, inputs, opts, before);
  const kdef = (id: string): boolean => {
    const pos = snapshot.players[id]?.pos;
    return pos === "K" || pos === "DEF";
  };

  it("every player but the kickers and team defenses keeps his PlayerModel bit for bit", () => {
    expect(Object.keys(after.players).sort()).toEqual(Object.keys(old.players).sort());
    const others = Object.keys(after.players).filter((id) => !kdef(id));
    expect(others.length).toBeGreaterThan(200);
    // Most of them have games, so the weight is at work for them (α > 0) and stays so.
    expect(others.filter((id) => (after.players[id]?.base.alpha ?? 0) > 0).length).toBeGreaterThan(150);
    for (const id of others) expect(after.players[id]).toEqual(old.players[id]);
  });

  it("a kicker or team defense with games weighs them 0: b is his projection with the matchup taken out, where the rule before blended them in", () => {
    const withGames = Object.keys(after.players).filter((id) => kdef(id) && (after.players[id]?.base.games ?? 0) > 0 && after.players[id]?.base.projNow !== null);
    expect(withGames.length).toBeGreaterThan(20);
    for (const id of withGames) {
      const a = after.players[id]!.base;
      const o = old.players[id]!.base;
      expect(a.alpha).toBe(0);
      expect(o.alpha).toBeGreaterThan(0);
      expect(a.b).toBe(Math.max(0, a.projNow! / a.mNow));
      // The same projection, week shape, games and points per game: only the weight differs.
      expect({ ...a, b: null, alpha: null }).toEqual({ ...o, b: null, alpha: null });
    }
    expect(withGames.filter((id) => after.players[id]!.base.b !== old.players[id]!.base.b).length).toBeGreaterThan(20);
    // Without games, nothing moves.
    for (const id of Object.keys(after.players).filter((x) => kdef(x) && after.players[x]?.base.games === 0)) expect(after.players[id]).toEqual(old.players[id]);
  });

  it("the stale-date tiebreaker's healthy base rate reads his position too (availabilityNoteFor)", () => {
    // A questionable kicker whose ESPN date is 3 weeks out: Sleeper cut him to 3 this week, 8 a week otherwise; 16 a game.
    const k = { sleeper: { 1: 8, 2: 8, 3: 8, 4: 3, 5: 8, 6: 8 }, actual: { 1: 16, 2: 16, 3: 16 } };
    const ctx = { currentWeek: 4, weeks: [4, 5, 6], espnAveraged: false };
    const note = availabilityNoteFor({ injury: "QUESTIONABLE", injuryReturnWeek: 7, pos: "K" }, k, ctx);
    expect(note).toMatchObject({ status: "QUESTIONABLE", returnWeek: 7, sleeperNow: 3, healthyRate: 8 });
    expect(note?.healthyRate).toBe(priorHealthyBaseRate(k, { ...ctx, pos: "K" }).b);
    // A receiver with the same lines keeps the weight: 0.875 × 8 + 0.125 × 16 = 9.
    expect(availabilityNoteFor({ injury: "QUESTIONABLE", injuryReturnWeek: 7, pos: "WR" }, k, ctx)?.healthyRate).toBe(9);
  });
});
