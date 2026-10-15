/**
 * My untouchables in the League model (Checkpoint 7e; planner reply to Checkpoint 7d, item 3.3: "Untouchables are never
 * suggested as drops anywhere: in Waivers, in trade cards' roster moves, when a player returns from IR"; league.ts
 * TeamWork.keep): my free-agent pickups (V*(T), the League page's "Free-agent pickups that would help") and every re-run of
 * them (lineup costs, MV_add, leagueMarginals.optimize) never drop one, and no return of one of my IR players releases one
 * (the team as it stands, after its pickups). Other teams have none: the setting is mine. A list naming none of my players
 * changes nothing, bit for bit. Hand-built leagues (trade.testing.ts handLeague: 4 full rosters of 10, NFL week 5 of a 1–8
 * regular season; team 1 is mine).
 */
import { describe, expect, it } from "vitest";
import { buildLeagueModel, buildLeagueModelWithContext, leagueMarginals, type BuildLeagueModelOptions } from "./league";
import type { LeagueModel } from "./leagueModel";
import type { LeagueSnapshot } from "./model";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import type { TestLeagueSpec, TestPlayer } from "./testLeague";
import { TEST_NOW } from "./testLeague";
import { flat, handLeague } from "./trade.testing";
import type { ModelInputs } from "./inputs";

/** handLeague with a 9-point free-agent WR every team would start in its FLEX (team 1 claims him first: its gain is the largest). */
const withPickup = (spec: TestLeagueSpec) => {
  spec.freeAgents = [...(spec.freeAgents ?? []), flat("fx", "WR", 9)];
};

/** An IR RB of team t, back in week 7 (25% / 50% / 25% over weeks 6–8). */
const irRb = (t: number): TestPlayer => flat(`ir${t}`, "RB", 9, { injury: "IR", injuryReturnWeek: 7 });

const withMyIr = (spec: TestLeagueSpec) => {
  (spec.teams[0] as { ir?: TestPlayer[] }).ir = [irRb(1)];
};

function league(edit: (spec: TestLeagueSpec) => void): { snapshot: LeagueSnapshot; inputs: ModelInputs } {
  return handLeague(edit);
}

const settingsWith = (untouchables: string[]): TradeSettings => ({ ...defaultTradeSettings(), untouchables });

function model(l: { snapshot: LeagueSnapshot; inputs: ModelInputs }, untouchables: string[], opts: Partial<BuildLeagueModelOptions> = {}): LeagueModel {
  return buildLeagueModel(l.snapshot, l.inputs, { now: TEST_NOW, settings: settingsWith(untouchables), ...opts });
}

/** The model as JSON without its timings (a byte-for-byte comparison of two builds' numbers). */
function numbers(m: LeagueModel): string {
  return JSON.stringify(m, (k, v: unknown) => (k === "timings" ? undefined : ArrayBuffer.isView(v) && !(v instanceof DataView) ? Array.from(v as unknown as ArrayLike<number>) : v));
}

const mine = (m: LeagueModel) => m.teams.find((t) => t.id === "1");

describe("my untouchables in the League model (TeamWork.keep)", { timeout: 60_000 }, () => {
  it("a list naming none of my players (another team's, one who left, nobody) changes nothing, bit for bit; TeamWork.keep holds only my players on my roster or IR", () => {
    const l = league((spec) => {
      withPickup(spec);
      withMyIr(spec);
    });
    for (const S of [0, 8]) {
      const base = numbers(model(l, [], { scenarios: S, sims: 400 }));
      for (const other of [["wc2", "q3"], ["gone-123"], []]) expect(numbers(model(l, other, { scenarios: S, sims: 400 })), `${S} scenarios, ${JSON.stringify(other)}`).toBe(base);
    }
    const built = buildLeagueModelWithContext(l.snapshot, l.inputs, { now: TEST_NOW, scenarios: 0, sims: 0, settings: settingsWith(["wc2", "wc1", "ir1", "nobody"]) });
    expect(built.context.work.map((t) => [t.team.id, t.keep])).toEqual([
      ["1", ["ir1", "wc1"]],
      ["2", []],
      ["3", []],
      ["4", []],
    ]);
    // No team picked: nobody keeps anyone.
    const noTeam = buildLeagueModelWithContext({ ...l.snapshot, myTeamId: null }, l.inputs, { now: TEST_NOW, scenarios: 0, sims: 0, settings: settingsWith(["wc1"]) });
    expect(noTeam.context.work.every((t) => t.keep.length === 0)).toBe(true);
  });

  it("my free-agent pickups (the League page's) never drop an untouchable: the next player goes, or no pickup is made; other teams have none", () => {
    const l = league(withPickup);
    const moves = (m: LeagueModel) => m.teams.map((t) => [t.id, t.faMoves.map((f) => [f.add, f.drop])]);
    // EV lineups: the 9-point WR takes my FLEX; the bench WR and the FLEX RB cost the same to lose there, and the less
    // valuable one goes (the bench WR). Kept, the FLEX RB goes instead; both kept, nothing else is worth the pickup, and Team
    // 2 claims him (its bench WR, which it has no reason to keep).
    expect(moves(model(l, [], { scenarios: 0, sims: 0 }))).toEqual([["1", [["fx", "wc1"]]], ["2", []], ["3", []], ["4", []]]);
    expect(moves(model(l, ["wc1"], { scenarios: 0, sims: 0 }))).toEqual([["1", [["fx", "rc1"]]], ["2", []], ["3", []], ["4", []]]);
    expect(moves(model(l, ["wc1", "rc1"], { scenarios: 0, sims: 0 }))).toEqual([["1", []], ["2", [["fx", "wc2"]]], ["3", []], ["4", []]]);
    // Another team's bench WR on my list keeps nothing of theirs.
    expect(moves(model(l, ["wc2", "wc1", "rc1"], { scenarios: 0, sims: 0 }))).toEqual([["1", []], ["2", [["fx", "wc2"]]], ["3", []], ["4", []]]);
    // Scenario lineups: the bench WR goes again; kept, my best pickup is the FLEX RB's spot, which costs RB depth there, so
    // my first move gains less than Team 2's and Team 2 claims him first (this league's allocation order goes by that gain:
    // no waiver ranks). Never a kept player, whatever the list.
    expect(moves(model(l, [], { scenarios: 8, sims: 0 }))).toEqual([["1", [["fx", "wc1"]]], ["2", []], ["3", []], ["4", []]]);
    expect(moves(model(l, ["wc1"], { scenarios: 8, sims: 0 }))).toEqual([["1", []], ["2", [["fx", "wc2"]]], ["3", []], ["4", []]]);
    for (const S of [0, 8]) {
      for (const keep of [["rc1"], ["wc1", "wb1"], ["rc1", "wc1", "wb1", "rb1"]]) {
        for (const m of mine(model(l, keep, { scenarios: S, sims: 0 }))?.faMoves ?? []) expect(keep, `${S} scenarios, ${JSON.stringify(keep)}`).not.toContain(m.drop);
      }
    }
  });

  it("a return from my IR never releases an untouchable (as my roster stands and after my pickups); with every candidate kept the returner goes himself, and with him kept too nobody does", () => {
    const l = league(withMyIr);
    for (const S of [0, 8]) {
      const free = mine(model(l, [], { scenarios: S, sims: 0 }));
      const released = free?.displaced?.[0]?.id as string;
      expect(free?.displaced, `${S} scenarios`).toEqual([{ id: released, week: 7, returner: "ir1" }]);
      expect(released, `${S} scenarios`).not.toBe("ir1");
      const kept = mine(model(l, [released], { scenarios: S, sims: 0 }));
      expect((kept?.displaced ?? []).map((d) => d.id), `${S} scenarios`).toHaveLength(1);
      expect(kept?.displaced?.[0]?.id, `${S} scenarios`).not.toBe(released);
      expect((kept?.displacedWithPickups ?? []).some((d) => d.id === released), `${S} scenarios`).toBe(false);
      const roster = l.snapshot.teams[0]?.roster ?? [];
      const everyone = mine(model(l, [...roster], { scenarios: S, sims: 0 }));
      expect(everyone?.displaced, `${S} scenarios`).toEqual([{ id: "ir1", week: 7, returner: "ir1" }]);
      const all = mine(model(l, [...roster, "ir1"], { scenarios: S, sims: 0 }));
      expect(all?.displaced, `${S} scenarios`).toEqual([]);
      expect(all?.displacedWithPickups, `${S} scenarios`).toEqual([]);
    }
  });

  it("the re-runs keep them too: leagueMarginals.optimize, MV_add's drop to make room on my roster, and my lineup costs' re-runs", () => {
    const l = league(withPickup);
    const free = leagueMarginals(l.snapshot, l.inputs, { now: TEST_NOW, scenarios: 0, settings: settingsWith([]) });
    const v = free.vStar("1");
    const dropped = v?.moves[0]?.drop as string;
    expect(dropped).toBeTruthy();
    const kept = leagueMarginals(l.snapshot, l.inputs, { now: TEST_NOW, scenarios: 0, settings: settingsWith([dropped]) });
    // V*(T) and any roster's run from the same optimizer.
    expect(kept.vStar("1")?.roster).toContain(dropped);
    const roster = l.snapshot.teams[0]?.roster ?? [];
    expect(kept.optimize("1", roster)?.roster).toContain(dropped);
    expect(free.optimize("1", roster)?.roster).not.toContain(dropped);
    // MV_add(me, j): the drop that makes room on my full roster is never an untouchable.
    const j = "wa2";
    const freeDrop = free.mvAdd("1", j)?.drop;
    expect(freeDrop).toBeTruthy();
    const keptAdd = kept.mvAdd("1", j);
    expect(leagueMarginals(l.snapshot, l.inputs, { now: TEST_NOW, scenarios: 0, settings: settingsWith([freeDrop as string]) }).mvAdd("1", j)?.drop).not.toBe(freeDrop);
    expect(keptAdd?.drop).not.toBe(dropped);
    // Another team's MV_add of the same player keeps its own drop (it has no untouchables).
    expect(kept.mvAdd("2", "wa3")?.drop).toBe(free.mvAdd("2", "wa3")?.drop);
    // Lineup costs: losing my FLEX RB, the re-run refills from V*(T)'s roster without dropping an untouchable.
    const without = (kept.vStar("1")?.roster ?? []).filter((id) => id !== "ra1");
    const run = kept.optimize("1", without);
    expect(run?.roster).toContain(dropped);
  });
});
