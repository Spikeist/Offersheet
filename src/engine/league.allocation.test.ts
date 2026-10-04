/**
 * One free agent, one team (league.ts step 5; CLAUDE.md §7; planner reply to Checkpoint 4, change 3): the allocation
 * order by basis (FAAB budget, waiver order, best gain), the sequential allocation (each team against the free agents no
 * earlier team claimed, so no free agent shows in two teams' moves; a pickup a run later swapped away stays its claim),
 * every later run of a team against excl(T) (lineup costs, MV_add's re-run for chips, leagueMarginals), greedy
 * determinism on random leagues, and faAllocation "independent" (Checkpoint 4's rule, for the report). Made-up leagues
 * (CLAUDE.md §16); teams are placeholders.
 */
import { describe, expect, it } from "vitest";
import { config } from "./config";
import { allocationOrder, buildLeagueModel, claimedBy, leagueMarginals, type AllocationTeam, type BuildLeagueModelOptions, type LeagueModelConfig } from "./league";
import type { LeagueModel, TeamModel } from "./leagueModel";
import type { LeagueSnapshot, Pos, SlotDef } from "./model";
import { mulberry32 } from "./rng";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW, buildTestLeague, randomLeague, type TestPlayer, type TestTeam } from "./testLeague";

const ZERO_MISS: Record<Pos, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, P: 0, DEF: 0, DL: 0, LB: 0, DB: 0 };
/** No future injury risk: every healthy player certainly plays (the hand-built cases stay obvious). */
const NO_RISK: LeagueModelConfig = { ...config, projections: { ...config.projections, injuryRisk: { ...config.projections.injuryRisk, missShare: ZERO_MISS } } };
/** Σ ω over weeks 4–17: 11 regular-season weeks and 3 playoff weeks at playoffWeight. */
const OMEGA = 11 + 3 * config.lineups.playoffWeight;
/** The user's team streams nothing (the free-agent kickers stay free agents). */
const NO_STREAMING: TradeSettings = { ...defaultTradeSettings(), streamPositions: [] };
const OPTS: BuildLeagueModelOptions = { now: TEST_NOW, scenarios: 8, settings: NO_STREAMING };

const p = (id: string, pos: Pos, points: number, extra: Partial<TestPlayer> = {}): TestPlayer => ({ id, pos, points, ...extra });
/** A full starting lineup (QB, 2 RB, 2 WR, TE, FLEX, K, D/ST), ids prefixed by the team id; `qb` its QB's points. */
const starters = (t: string, qb = 20): TestPlayer[] => [
  p(`${t}-qb`, "QB", qb),
  p(`${t}-rb1`, "RB", 15),
  p(`${t}-rb2`, "RB", 13),
  p(`${t}-wr1`, "WR", 15),
  p(`${t}-wr2`, "WR", 13),
  p(`${t}-te`, "TE", 10),
  p(`${t}-flex`, "WR", 11),
  p(`${t}-k`, "K", 8),
  p(`${t}-def`, "DEF", 7),
];
const team = (id: string, roster: TestPlayer[]): TestTeam => ({ id, roster });
const teamOf = (m: LeagueModel, id: string): TeamModel => m.teams.find((t) => t.id === id) as TeamModel;

/** `league` with these teams' waiver ranks and remaining FAAB budgets (Team.waiverRank, Team.faabRemaining). */
function withTeams<L extends { snapshot: LeagueSnapshot }>(league: L, teams: Record<string, AllocationTeam>, faabBudget?: number): L {
  const snapshot = { ...league.snapshot, settings: { ...league.snapshot.settings, ...(faabBudget !== undefined ? { faabBudget } : {}) }, teams: league.snapshot.teams.map((t) => ({ ...t, ...(teams[t.id] ?? {}) })) };
  return { ...league, snapshot };
}

/** Every free agent a model's teams added, with the teams that added him: more than one = a duplicate pickup. */
function pickups(m: LeagueModel): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of m.teams) for (const id of new Set(t.faMoves.map((x) => x.add))) out.set(id, [...(out.get(id) ?? []), t.id]);
  return out;
}

describe("allocationOrder (league.ts step 5): the order teams claim free agents in", () => {
  const none = () => {
    throw new Error("gain read for a basis that doesn't need it");
  };

  it("a FAAB league whose teams all report a budget: the most remaining budget first; ties: the better waiver rank, then snapshot order", () => {
    const teams: AllocationTeam[] = [
      { faabRemaining: 50, waiverRank: 4 },
      { faabRemaining: 80, waiverRank: 3 },
      { faabRemaining: 80, waiverRank: 1 },
      { faabRemaining: 20, waiverRank: 2 },
    ];
    expect(allocationOrder(teams, true, none)).toEqual({ basis: "faab", order: [2, 1, 0, 3] });
    // Without waiver ranks a tie keeps snapshot order; a team with a rank goes before one without.
    expect(allocationOrder([{ faabRemaining: 10 }, { faabRemaining: 10 }, { faabRemaining: 10, waiverRank: 5 }], true, none)).toEqual({ basis: "faab", order: [2, 0, 1] });
    // A budget of 0 is a budget (spent out): last.
    expect(allocationOrder([{ faabRemaining: 0 }, { faabRemaining: 3 }], true, none).order).toEqual([1, 0]);
  });

  it("the waiver order when the league isn't FAAB, or a team's budget is missing or unreadable: rank ascending, ties in snapshot order", () => {
    const ranked: AllocationTeam[] = [{ waiverRank: 2, faabRemaining: 90 }, { waiverRank: 1, faabRemaining: 10 }, { waiverRank: 2 }, { waiverRank: 3, faabRemaining: Number.NaN }];
    expect(allocationOrder(ranked, true, none)).toEqual({ basis: "waiver", order: [1, 0, 2, 3] });
    expect(allocationOrder(ranked.slice(0, 2), false, none)).toEqual({ basis: "waiver", order: [1, 0] });
    expect(allocationOrder([{ waiverRank: 1, faabRemaining: -5 }, { waiverRank: 2, faabRemaining: 9 }], true, none).basis).toBe("waiver");
  });

  it("the best single-move gain first when no order is reported (or a rank is unreadable), ties in snapshot order; gain read once per team", () => {
    const calls: number[] = [];
    const gains = [3, 5, 5 + 1e-12, 0, Number.NaN];
    const gain = (i: number) => {
      calls.push(i);
      return gains[i] as number;
    };
    expect(allocationOrder([{}, {}, {}, {}, {}], false, gain)).toEqual({ basis: "gain", order: [1, 2, 0, 3, 4] });
    expect(calls).toEqual([0, 1, 2, 3, 4]);
    for (const bad of [0, 1.5, Number.NaN, -1]) expect(allocationOrder([{ waiverRank: 1 }, { waiverRank: bad }], false, () => 0), String(bad)).toEqual({ basis: "gain", order: [0, 1] });
    expect(allocationOrder([], true, none)).toEqual({ basis: "gain", order: [] });
  });

  it("claimedBy: every free agent a run's moves added, once, in move order (one a later move swapped away included)", () => {
    expect(claimedBy({ moves: [{ add: "a", drop: null, gainEv: 1 }, { add: "b", drop: "a", gainEv: 1 }, { add: "c", drop: "x", gainEv: 1 }] })).toEqual(["a", "b", "c"]);
    expect(claimedBy({ moves: [] })).toEqual([]);
  });
});

describe("the allocation in the League model: one free agent, one team", () => {
  // Team 1 is full (16 of 16: nine starters and seven bench players who never start); teams 2–4 have open spots. A
  // 14-point free-agent WR is +3 a week to every team (he starts over the 13-point WR2, who takes the FLEX from the 11).
  const bench = (t: string) => [p(`${t}-qb2`, "QB", 12), p(`${t}-rb3`, "RB", 6), p(`${t}-rb4`, "RB", 5), p(`${t}-rb5`, "RB", 3), p(`${t}-wr4`, "WR", 7), p(`${t}-wr5`, "WR", 6), p(`${t}-te2`, "TE", 4)];
  const base = (freeAgents: TestPlayer[]) => buildTestLeague({ teams: [team("1", [...starters("1"), ...bench("1")]), team("2", starters("2")), team("3", starters("3")), team("4", starters("4"))], freeAgents });

  it("the waiver order: the first team that wants him gets him, nobody else; the next free agent goes to the next team", () => {
    const league = withTeams(base([p("fa-wr", "WR", 14)]), { "1": { waiverRank: 2 }, "2": { waiverRank: 4 }, "3": { waiverRank: 1 }, "4": { waiverRank: 3 } });
    const m = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);
    expect(m.faAllocation).toEqual({ basis: "waiver", order: ["3", "1", "4", "2"] });
    expect(teamOf(m, "3").faMoves).toEqual([{ add: "fa-wr", drop: null, gainEv: expect.closeTo(3 * OMEGA, 9), gainScen: expect.closeTo(3 * OMEGA, 9) }]);
    for (const id of ["1", "2", "4"]) expect(teamOf(m, id).faMoves, `team ${id}`).toEqual([]);
    // A second free agent, a 13.1-point WR: after the first, team 3 gains only 0.1 a week from him (under faMinGain), while
    // he's +2.1 a week to the next team in the order, team 1 (he starts over its 13-point WR2): team 1 gets him, by a drop.
    const two = withTeams(base([p("fa-wr", "WR", 14), p("fa-wr2", "WR", 13.1)]), { "1": { waiverRank: 2 }, "2": { waiverRank: 4 }, "3": { waiverRank: 1 }, "4": { waiverRank: 3 } });
    const m2 = buildLeagueModel(two.snapshot, two.inputs, OPTS, NO_RISK);
    expect(teamOf(m2, "3").faMoves.map((x) => x.add)).toEqual(["fa-wr"]);
    expect(teamOf(m2, "1").faMoves.map((x) => x.add)).toEqual(["fa-wr2"]);
    expect(teamOf(m2, "1").faMoves[0]?.drop).not.toBeNull();
    expect(teamOf(m2, "4").faMoves).toEqual([]);
    expect(teamOf(m2, "2").faMoves).toEqual([]);
    expect([...pickups(m2).values()].every((teams) => teams.length === 1)).toBe(true);
  });

  it("a FAAB league: the most remaining budget first, whatever the waiver order", () => {
    const league = withTeams(base([p("fa-wr", "WR", 14)]), { "1": { waiverRank: 1, faabRemaining: 12 }, "2": { waiverRank: 2, faabRemaining: 40 }, "3": { waiverRank: 3, faabRemaining: 77 }, "4": { waiverRank: 4, faabRemaining: 40 } }, 100);
    const m = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);
    expect(m.faAllocation).toEqual({ basis: "faab", order: ["3", "2", "4", "1"] });
    expect([...pickups(m)]).toEqual([["fa-wr", ["3"]]]);
  });

  it("no order reported: each team's best single-move gain against the whole pool first (the 'independent' model's first moves)", () => {
    // Team 4's QB scores 10: a 16-point free-agent QB is +6 a week there (team 3's 14-point QB: +2; teams 1 and 2 have 20).
    const league = buildTestLeague({ teams: [team("1", [...starters("1"), ...bench("1")]), team("2", starters("2")), team("3", starters("3", 14)), team("4", starters("4", 10))], freeAgents: [p("fa-wr", "WR", 14), p("fa-qb", "QB", 16)] });
    const m = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);
    const each = buildLeagueModel(league.snapshot, league.inputs, { ...OPTS, faAllocation: "independent" }, NO_RISK);
    const first = (id: string) => teamOf(each, id).faMoves[0]?.gainScen ?? 0;
    const byGain = each.teams.map((t, i) => ({ id: t.id, g: first(t.id), i })).sort((a, b) => (Math.abs(b.g - a.g) > 1e-6 ? b.g - a.g : a.i - b.i));
    expect(m.faAllocation).toEqual({ basis: "gain", order: byGain.map((x) => x.id) });
    expect(m.faAllocation?.order[0]).toBe("4");
    // Team 4 takes the QB first (+6), then the WR too (+3 into another open spot): nothing is left for the others.
    expect(teamOf(m, "4").faMoves.map((x) => x.add)).toEqual(["fa-qb", "fa-wr"]);
    for (const id of ["1", "2", "3"]) expect(teamOf(m, id).faMoves, `team ${id}`).toEqual([]);
    // Each team on its own (Checkpoint 4's rule): the WR is everybody's pickup, the QB two teams'.
    expect(each.faAllocation).toBeUndefined();
    expect(pickups(each).get("fa-wr")).toEqual(["1", "2", "3", "4"]);
    expect(pickups(each).get("fa-qb")).toEqual(["3", "4"]);
  });

  it("every later run of a team excludes the other teams' claims: a lineup cost refilled by a free agent another team claimed isn't (MV_lose under excl(T))", () => {
    // Team 2's 20-point QB has no backup. A 16-point free-agent QB would replace him (cost 4 a week), but team 4 (QB 10, the
    // first waiver claim) picks him up: team 2's QB then costs his whole 20 a week. Each team on its own, 4.
    const league = withTeams(buildTestLeague({ teams: [team("1", starters("1")), team("2", starters("2")), team("3", starters("3")), team("4", starters("4", 10))], freeAgents: [p("fa-qb", "QB", 16)] }), {
      "1": { waiverRank: 2 },
      "2": { waiverRank: 3 },
      "3": { waiverRank: 4 },
      "4": { waiverRank: 1 },
    });
    const m = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);
    expect([...pickups(m)]).toEqual([["fa-qb", ["4"]]]);
    expect(teamOf(m, "2").players["2-qb"]).toMatchObject({ mvLoseEv: expect.closeTo(20 * OMEGA, 9), autoAdd: null });
    const each = buildLeagueModel(league.snapshot, league.inputs, { ...OPTS, faAllocation: "independent" }, NO_RISK);
    expect(teamOf(each, "2").players["2-qb"]).toMatchObject({ mvLoseEv: expect.closeTo(4 * OMEGA, 9), autoAdd: "fa-qb" });
    // leagueMarginals reads the same exclusion: team 2's own run never adds him.
    const marginals = leagueMarginals(league.snapshot, league.inputs, OPTS, NO_RISK);
    expect(marginals.optimize("2", ["2-rb1", "2-rb2", "2-wr1", "2-wr2", "2-te", "2-flex", "2-k", "2-def"])?.moves.map((x) => x.add)).not.toContain("fa-qb");
    expect(marginals.mvLose("2", "2-qb")).toMatchObject({ ev: expect.closeTo(20 * OMEGA, 9), autoAdd: null });
  });
});

describe("what a team claims, and every later run against excl(T) (review of track C, finding 6)", () => {
  /** `league` with each team's waiver rank (team ids, first claim first) and a smaller maxRosterSize. */
  const shaped = (league: { snapshot: LeagueSnapshot; inputs: ReturnType<typeof buildTestLeague>["inputs"] }, order: string[], maxRosterSize: number) => {
    const ranked = withTeams(league, Object.fromEntries(order.map((id, k) => [id, { waiverRank: k + 1 }])));
    return { ...ranked, snapshot: { ...ranked.snapshot, settings: { ...ranked.snapshot.settings, maxRosterSize } } };
  };

  it("⚠️ a free agent a run picked up and later swapped away stays that team's claim: no later team adds him, and V*(T) against excl(T) is V*(T)", () => {
    // An RB and a WR slot, 4-man rosters (two 1-point TEs who never start). Team 1's RB is on bye in week 5, its WR in
    // week 6. The 10-point free agent who plays RB or WR covers both byes (+20), more than the 15-point RB (+15, week 5) or
    // WR (+15, week 6) alone, so team 1 takes him first; then the RB (+5 over him in week 5; the WR ties, the smaller id
    // wins); then the WR replaces him (+5 in week 6, nothing lost in week 5): the run swapped its first pickup away.
    const lineup: SlotDef[] = [
      { slot: "RB", count: 1, eligible: ["RB"] },
      { slot: "WR", count: 1, eligible: ["WR"] },
    ];
    const league = shaped(
      buildTestLeague({
        lineup,
        byeWeek: { B5: 5, B6: 6 },
        teams: [
          // Team 2: a 2-point RB and a WR on bye in week 6. The swing player would be +8 a week to it (more than the
          // 8-point RB's +6), had team 1 not claimed him.
          team("1", [p("1-rb", "RB", 20, { nflTeam: "B5" }), p("1-wr", "WR", 20, { nflTeam: "B6" }), p("1-x1", "TE", 1), p("1-x2", "TE", 1)]),
          team("2", [p("2-rb", "RB", 2), p("2-wr", "WR", 20, { nflTeam: "B6" }), p("2-x1", "TE", 1), p("2-x2", "TE", 1)]),
        ],
        freeAgents: [p("fa-j", "WR", 10, { eligible: ["RB", "WR"] }), p("fa-l", "RB", 15), p("fa-m", "WR", 15), p("fa-z", "RB", 8)],
      }),
      ["1", "2"],
      4,
    );
    const m = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);
    expect(teamOf(m, "1").faMoves.map((x) => [x.add, x.drop])).toEqual([
      ["fa-j", "1-x1"],
      ["fa-l", "1-x2"],
      ["fa-m", "fa-j"],
    ]);
    expect(teamOf(m, "1").faMoves.map((x) => x.gainEv)).toEqual([expect.closeTo(20, 9), expect.closeTo(5, 9), expect.closeTo(5, 9)]);
    // Team 2 can't add the swing player (team 1's claim, though no longer on its roster): it takes the 8-point RB.
    expect(teamOf(m, "2").faMoves.map((x) => x.add)).toEqual(["fa-z"]);
    for (const [id, teams] of pickups(m)) expect(teams, id).toHaveLength(1);
    // Every later run of a team excludes only the other teams' claims, and makes V*(T)'s very moves: team 1's against team
    // 2's 8-point RB (had team 2 taken the swing player instead, team 1's first move would change).
    const marginals = leagueMarginals(league.snapshot, league.inputs, OPTS, NO_RISK);
    for (const id of ["1", "2"]) {
      const roster = league.snapshot.teams.find((t) => t.id === id)?.roster ?? [];
      expect(marginals.optimize(id, roster)?.moves, `team ${id}`).toEqual(teamOf(m, id).faMoves);
    }
  });

  it("MV_add's re-run (trade chips and the search's get pool) adds no free agent another team claimed", () => {
    // QB, RB, WR and an RB/WR FLEX, 4-man rosters (starters only). Team 3, first in the waiver order, claims the 9-point
    // free-agent RB (+7 a week over its 2-point RB). Team 2's FLEX is a 6-point WR; the other free agent, a 5.5-point WR, is
    // no use to it.
    const lineup: SlotDef[] = [
      { slot: "QB", count: 1, eligible: ["QB"] },
      { slot: "RB", count: 1, eligible: ["RB"] },
      { slot: "WR", count: 1, eligible: ["WR"] },
      { slot: "FLEX", count: 1, eligible: ["RB", "WR"] },
    ];
    const league = shaped(
      buildTestLeague({
        lineup,
        teams: [
          team("1", [p("1-qb", "QB", 25), p("1-rb", "RB", 10), p("1-wr", "WR", 10), p("1-fx", "WR", 6)]),
          team("2", [p("2-qb", "QB", 20), p("2-rb", "RB", 10), p("2-wr", "WR", 10), p("2-fx", "WR", 6)]),
          team("3", [p("3-qb", "QB", 20), p("3-rb", "RB", 2), p("3-wr", "WR", 10), p("3-fx", "WR", 10)]),
        ],
        freeAgents: [p("fa-f", "RB", 9), p("fa-g", "WR", 5.5)],
      }),
      ["3", "2", "1"],
      4,
    );
    const m = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);
    expect([...pickups(m)]).toEqual([["fa-f", ["3"]]]);
    expect(teamOf(m, "2").faMoves).toEqual([]);
    // Team 1's 25-point QB to team 2: V*(team 2) is full, so its 6-point FLEX makes room (−6 a week); the QB starts (+5 over
    // its 20) and its old QB, now a backup, goes in the re-run for the 5.5-point WR at the FLEX. Net +4.5 a week. Had the
    // re-run seen team 3's RB, it would have taken him instead (+9 at the FLEX: +8 a week net).
    const marginals = leagueMarginals(league.snapshot, league.inputs, OPTS, NO_RISK);
    const mv = marginals.mvAdd("2", "1-qb");
    expect(mv?.drop).toBe("2-fx");
    expect(mv?.ev).toBeCloseTo(4.5 * OMEGA, 9);
    expect(mv?.scen).toBeCloseTo(4.5 * OMEGA, 9);
  });
});

describe("random leagues: no duplicate pickups, and greedy determinism (V*(T) against excl(T) is V*(T))", () => {
  /** A random permutation of the team ids as waiver ranks (seeded), and FAAB budgets when `faab`. */
  const ordered = (league: ReturnType<typeof randomLeague>, seed: number, faab: boolean) => {
    const rand = mulberry32(seed);
    const ids = league.snapshot.teams.map((t) => t.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [ids[i], ids[j]] = [ids[j] as string, ids[i] as string];
    }
    const teams: Record<string, AllocationTeam> = {};
    ids.forEach((id, k) => {
      teams[id] = { waiverRank: k + 1, ...(faab ? { faabRemaining: Math.floor(rand() * 4) * 25 } : {}) };
    });
    return withTeams(league, teams, faab ? 100 : undefined);
  };

  it("each free agent goes to at most one team, the claims follow the order, and leagueMarginals' run of V*(T) against excl(T) reproduces every team's moves", { timeout: 60_000 }, () => {
    let duplicatesIndependent = 0;
    let moves = 0;
    for (const [seed, faab] of [
      [11, false],
      [12, true],
      [13, false],
      [14, true],
    ] as const) {
      const raw = randomLeague({ teams: 6, seed, freeAgentsPerPosition: 4 });
      raw.snapshot.settings.positionLimits = { QB: 3, RB: 6, WR: 6, TE: 2 };
      const league = ordered(raw, seed, faab);
      const opts = { now: TEST_NOW, scenarios: 8, seed: 5, sims: 0 };
      const m = buildLeagueModel(league.snapshot, league.inputs, opts);
      expect(m.faAllocation?.basis, `seed ${seed}`).toBe(faab ? "faab" : "waiver");
      for (const [id, teams] of pickups(m)) expect(teams, `seed ${seed}: ${id}`).toHaveLength(1);
      const marginals = leagueMarginals(league.snapshot, league.inputs, opts);
      for (const t of m.teams) {
        moves += t.faMoves.length;
        const roster = [...new Set(league.snapshot.teams.find((x) => x.id === t.id)?.roster ?? [])];
        // leagueMarginals.optimize runs against excl(T) (every other team's claims): the model built V*(T) against the
        // earlier teams' claims only. Greedy determinism makes them the same run.
        expect(marginals.optimize(t.id, roster)?.moves, `seed ${seed} team ${t.id}`).toEqual(t.faMoves);
      }
      const each = buildLeagueModel(league.snapshot, league.inputs, { ...opts, faAllocation: "independent" });
      duplicatesIndependent += [...pickups(each).values()].filter((teams) => teams.length > 1).length;
    }
    expect(moves).toBeGreaterThan(5);
    // Each team on its own, these leagues do pick up the same free agents (what the allocation removes).
    expect(duplicatesIndependent).toBeGreaterThan(0);
  });
});
