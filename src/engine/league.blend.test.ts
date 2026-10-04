/**
 * The market blend in the League model (CLAUDE.md §6 step 8; planner reply to Checkpoint 4, change 1; league.ts step 3b;
 * the review of track A): on small hand-made leagues whose numbers are obvious, which players it reaches (rostered,
 * IR, taxi and free agents alike) and which of them shape the curve (healthy ones), that their weekly points, σ and ROS
 * scale and the projection table and lineups follow, that byes, an injury's length and a week under way never move a
 * factor (it is per game played), which table it reads per league type (and the warning without one), and that a week
 * in progress keeps the build's factors for its pre-kickoff rebuild. The pure parts are in blend.test.ts. Player names
 * are made up; teams are placeholders.
 */
import { describe, expect, it } from "vitest";
import { config } from "./config";
import type { AvailabilityContext } from "./availability";
import { BLEND_OFF_CURVE_WARNING, BLEND_OFF_WARNING, buildLeagueModel, buildProjectionTable, marketCurveFit, preKickoffTable, projectLeaguePlayers, type LeagueModelConfig } from "./league";
import type { LeagueModel, PlayerModel } from "./leagueModel";
import type { InjuryStatus, PlayerInfo, Pos } from "./model";
import { weeklySd } from "./projections";
import { TEST_NOW, buildTestLeague, type TestLeagueSpec, type TestPlayer } from "./testLeague";

const ZERO_MISS: Record<Pos, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, P: 0, DEF: 0, DL: 0, LB: 0, DB: 0 };
/** No future injury risk: every healthy player plays every week, so his ROS is his points × the weeks left (14: weeks 4–17). */
const NO_RISK: LeagueModelConfig = { ...config, projections: { ...config.projections, injuryRisk: { ...config.projections.injuryRisk, missShare: ZERO_MISS } } };
const OFF: LeagueModelConfig = { ...NO_RISK, marketBlend: { ...NO_RISK.marketBlend, weight: 0 } };
const OPTS = { now: TEST_NOW, scenarios: 0, sims: 0 };
const WEEKS = 14;
const W = config.marketBlend.weight;
/** The blend at w of a base rate toward a market rate, over the base rate. */
const fOf = (ours: number, mkt: number) => ((1 - W) * ours + W * mkt) / ours;

const p = (id: string, pos: Pos, points: number, extra: Partial<TestPlayer> = {}): TestPlayer => ({ id, pos, points, ...extra });

/** Ten WRs worth 1,000 … 10,000 (k1 … k10) whose points rise with value except the last two (14 and 13). */
const POINTS = [5, 6, 7, 8, 9, 10, 11, 12, 14, 13];
const wr = (k: number, extra: Partial<TestPlayer> = {}): TestPlayer => p(`k${k}`, "WR", POINTS[k - 1] as number, { value: 1000 * k, ...extra });
const core = (t: string): TestPlayer[] => [p(`${t}-qb`, "QB", 20), p(`${t}-rb1`, "RB", 15), p(`${t}-rb2`, "RB", 13), p(`${t}-k`, "K", 8), p(`${t}-def`, "DEF", 7)];

/** Team 1 has the odd WRs and a valued TE, team 2 the even ones; an unvalued WR and a valued TE are free agents (3 valued TEs: too few for a curve). */
function blendLeague(edit: (spec: TestLeagueSpec) => void = () => undefined) {
  const spec: TestLeagueSpec = {
    teams: [
      { id: "1", roster: [...core("1"), p("1-te", "TE", 10, { value: 3000 }), ...[1, 3, 5, 7, 9].map((k) => wr(k))] },
      { id: "2", roster: [...core("2"), p("2-te", "TE", 9, { value: 2500 }), ...[2, 4, 6, 8, 10].map((k) => wr(k))] },
    ],
    freeAgents: [p("u1", "WR", 9), p("fte", "TE", 4, { value: 500 })],
  };
  edit(spec);
  return buildTestLeague(spec);
}

/**
 * The WR curve's numbers (base rates on value, healthy WRs only). k9 (9,000) is read off the curve without him: k8's 12
 * at 8,000 to k10's 13 at 10,000, so 12.5. k10 is the value range's top end: the curve with him, which pools k9 and k10
 * to 13.5. k8 is read off the curve without him, where k9 and k10 pool to 13.5: 11 at 7,000 to 13.5 at 9,000, so 12.25.
 */
const F9 = fOf(14, 12.5);
const F10 = fOf(13, 13.5);
const F8 = fOf(12, 12.25);

const player = (m: LeagueModel, id: string) => m.players[id] as PlayerModel;

describe("the market blend in the League model (§6 step 8; league.ts step 3b)", () => {
  const league = blendLeague();
  const model = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);

  it("scales a player the curve disagrees with: his base rate, weekly points, σ and ROS move halfway toward what his value projects per game", () => {
    const k9 = player(model, "k9");
    expect(k9.base.b).toBeCloseTo(14 * F9, 12); // 13.25
    expect(k9.ros.total).toBeCloseTo(14 * WEEKS * F9, 9);
    expect(k9.ros.regular + k9.ros.playoffs).toBeCloseTo(14 * WEEKS * F9, 9);
    for (const w of k9.weekly) {
      expect(w.p).toBeCloseTo(14 * F9, 12);
      expect(w.sd).toBeCloseTo(weeklySd(14 * F9, "WR"), 12);
      expect(w.a).toBe(1);
    }
    // The page's line is in ROS points: his 196, the market's 12.5 a game over the same 14 games, and halfway.
    expect(k9.blend).toEqual({ ours: expect.closeTo(196, 9), market: expect.closeTo(12.5 * WEEKS, 9), used: expect.closeTo(185.5, 9), weight: 0.5 });
    // The market thinks k10 (worth more, projected less) is the better player: his points go up.
    expect(player(model, "k10").ros.total).toBeCloseTo(13 * WEEKS * F10, 9);
    expect(player(model, "k10").blend).toEqual({ ours: expect.closeTo(182, 9), market: expect.closeTo(13.5 * WEEKS, 9), used: expect.closeTo(185.5, 9), weight: 0.5 });
    expect(player(model, "k8").ros.total).toBeCloseTo(12 * WEEKS * F8, 9);
  });

  it("a player on the trend is blended to himself (f 1, his own points), and still says so", () => {
    for (const k of [1, 2, 3, 4, 5, 6, 7]) {
      const pm = player(model, `k${k}`);
      const ros = (POINTS[k - 1] as number) * WEEKS;
      expect(pm.ros.total, `k${k}`).toBeCloseTo(ros, 9);
      expect(pm.blend).toEqual({ ours: expect.closeTo(ros, 9), market: expect.closeTo(ros, 9), used: expect.closeTo(ros, 9), weight: 0.5 });
    }
  });

  it("leaves kickers, defenses, unvalued players and a position with too few curve points (3 TEs) as they were", () => {
    const untouched: [string, number][] = [
      ["1-qb", 20],
      ["1-rb1", 15],
      ["1-k", 8],
      ["2-def", 7],
      ["1-te", 10],
      ["fte", 4],
      ["u1", 9],
    ];
    for (const [id, points] of untouched) {
      const pm = player(model, id);
      expect(pm.blend, id).toBeUndefined();
      expect(pm.ros.total, id).toBeCloseTo(points * WEEKS, 9);
      expect(pm.weekly[0]?.p, id).toBe(points);
    }
    // The unvalued WR gets an estimated value (§9), and an estimate never puts a player in the blend.
    expect(player(model, "u1").value?.source).toBe("estimate");
    const lp = projectLeaguePlayers(league.snapshot, league.inputs, TEST_NOW, NO_RISK);
    expect(lp.blend.positions).toEqual([
      { pos: "QB", players: 0, fit: 0, blended: false },
      { pos: "RB", players: 0, fit: 0, blended: false },
      { pos: "WR", players: 10, fit: 10, blended: true },
      { pos: "TE", players: 3, fit: 3, blended: false },
    ]);
    expect([...lp.blend.factors.keys()].sort()).toEqual(["k1", "k10", "k2", "k3", "k4", "k5", "k6", "k7", "k8", "k9"]);
    expect(lp.blend.factors.get("k9")).toEqual({ ours: 14, market: expect.closeTo(12.5, 12), used: expect.closeTo(13.25, 12), f: expect.closeTo(F9, 12), value: 9000, fit: true });
  });

  it("the projection table and every lineup read the blended points (the same factors as the model's in buildProjectionTable)", () => {
    const { table, players } = buildProjectionTable(league.snapshot, league.inputs, OPTS, NO_RISK);
    const row = table.rows.get("k9");
    expect(row?.ev[0]).toBeCloseTo(14 * F9, 12);
    expect(row?.cond[0]).toBeCloseTo(14 * F9, 12); // b × m, b scaled
    expect(row?.evSd[0]).toBeCloseTo(weeklySd(14 * F9, "WR"), 12);
    expect(row?.condSd[0]).toBeCloseTo(weeklySd(14 * F9, "WR"), 12);
    expect(players.players.k9?.ros.total).toBeCloseTo(player(model, "k9").ros.total, 12);
    // Team 1 starts QB 20, RB 15 and 13, WRs k9 and k7 (11), TE 10, k5 (9) at FLEX, K 8 and D/ST 7: k9 at his blended points.
    expect(model.teams.find((t) => t.id === "1")?.ev.lv[0]).toBeCloseTo(20 + 15 + 13 + 14 * F9 + 11 + 10 + 9 + 8 + 7, 9);
  });

  it("market values come after the blend (rule 7): the estimate for an unvalued player reads the blended points", () => {
    // k1 and k2 swap points (6 and 5 a week). k1 is the value range's bottom end: the curve with him pools the two to 5.5,
    // so his 84 becomes 80.5; k2 is read off the curve without him, 6 at 1,000 to 7 at 3,000: 6.5, so his 70 becomes
    // 80.5 too. A 2.5-point unvalued WR gets the §9 estimate, proportional below the lowest valued player's points:
    // 1,500 (the two values pooled at the same 80.5) × his 35 ÷ 80.5.
    const swapped = blendLeague((spec) => {
      for (const t of spec.teams) t.roster = t.roster.map((x) => (x.id === "k1" ? { ...x, points: 6 } : x.id === "k2" ? { ...x, points: 5 } : x));
      spec.freeAgents = [...(spec.freeAgents ?? []), p("u2", "WR", 2.5)];
    });
    const estimate = (cfg: LeagueModelConfig) => player(buildLeagueModel(swapped.snapshot, swapped.inputs, OPTS, cfg), "u2").value;
    expect(estimate(NO_RISK)).toEqual({ value: expect.closeTo((1500 * 35) / 80.5, 9), source: "estimate" });
    // Without the blend the estimate reads k2's own 70 (k1's 84 and k2's 70 pool their values to 1,500 there).
    expect(estimate(OFF)).toEqual({ value: expect.closeTo((1500 * 35) / 70, 9), source: "estimate" });
  });

  it("weight 0: no blend anywhere, every projection its own", () => {
    const plain = buildLeagueModel(league.snapshot, league.inputs, OPTS, OFF);
    expect(Object.values(plain.players).some((pm) => pm.blend)).toBe(false);
    expect(player(plain, "k9").ros.total).toBeCloseTo(14 * WEEKS, 9);
    expect(plain.warnings).not.toContain(BLEND_OFF_WARNING);
  });
});

describe("who the blend reaches and who shapes the curve (review of track A): free agents, IR and taxi players", () => {
  /** A valued free-agent WR (20 a game, worth 8,500) and an IR WR on team 1 (16 a game when healthy, worth 9,500, back around `irBack`). */
  const withExtras = (irBack: number, faValue: number | null = 8500) =>
    blendLeague((spec) => {
      (spec.teams[0] as (typeof spec.teams)[number]).ir = [p("ir1", "WR", 16, { value: 9500, injury: "IR", injuryReturnWeek: irBack })];
      spec.freeAgents = [...(spec.freeAgents ?? []), p("fa9", "WR", 20, faValue === null ? {} : { value: faValue })];
    });

  it("a valued free agent is a curve point and is scaled; an IR player is scaled but read off the curve, never shaping it", () => {
    const league = withExtras(16);
    const lp = projectLeaguePlayers(league.snapshot, league.inputs, TEST_NOW, NO_RISK);
    expect(lp.blend.factors.get("fa9")?.fit).toBe(true);
    expect(lp.blend.factors.get("ir1")?.fit).toBe(false);
    expect(lp.blend.positions.find((x) => x.pos === "WR")).toEqual({ pos: "WR", players: 12, fit: 11, blended: true });
    // The free agent shapes the curve: without him k9 reads 12.5 (k8 to k10); with him at 8,500 the curve without k9 pools
    // his 20 with k10's 13 to 16.5 from 8,500 on.
    expect(lp.blend.factors.get("k9")?.market).toBeCloseTo(16.5, 12);
    const noFa = withExtras(16, null);
    const lpNoFa = projectLeaguePlayers(noFa.snapshot, noFa.inputs, TEST_NOW, NO_RISK);
    expect(lpNoFa.blend.factors.get("k9")?.market).toBeCloseTo(12.5, 12);
    // The IR player shapes nothing: every healthy factor is the plain league's.
    const plain = projectLeaguePlayers(blendLeague().snapshot, blendLeague().inputs, TEST_NOW, NO_RISK);
    for (const [id, f] of plain.blend.factors) expect(lpNoFa.blend.factors.get(id), id).toEqual(f);
    // Both are scaled in the projection table: every week's points × their factor.
    const off = buildProjectionTable(league.snapshot, league.inputs, OPTS, OFF).table;
    const on = buildProjectionTable(league.snapshot, league.inputs, OPTS, NO_RISK).table;
    for (const id of ["fa9", "ir1"]) {
      const f = lp.blend.factors.get(id)?.f as number;
      expect(f, id).not.toBeCloseTo(1, 3);
      on.rows.get(id)?.ev.forEach((x, i) => expect(x, `${id} week ${i}`).toBeCloseTo((off.rows.get(id)?.ev[i] as number) * f, 12));
    }
  });

  it("an IR player's factor is per game played, so it doesn't depend on when he returns, and a late return isn't inflated", () => {
    // He projects 16 a game when he plays. He reads the whole healthy curve, which pools the free agent's 20 at 8,500 with
    // k9's 14 and k10's 13 to 47/3 from 8,500 on. Under the old total basis a return in week 16 squeezed the market's whole
    // season into his two expected games (f above 3).
    const market = 47 / 3;
    const used = (16 + market) / 2;
    const late = projectLeaguePlayers(withExtras(16).snapshot, withExtras(16).inputs, TEST_NOW, NO_RISK);
    const early = projectLeaguePlayers(withExtras(6).snapshot, withExtras(6).inputs, TEST_NOW, NO_RISK);
    expect(late.blend.factors.get("ir1")).toEqual({ ours: 16, market: expect.closeTo(market, 12), used: expect.closeTo(used, 12), f: expect.closeTo(fOf(16, market), 12), value: 9500, fit: false });
    expect(early.blend.factors.get("ir1")).toEqual(late.blend.factors.get("ir1"));
    // His weeks: `used` a game when he plays, whatever his return week. Back in week 15, 16 or 17 (25/50/25): 0.25 + 0.75 + 1 games.
    const ir1 = late.players.ir1 as PlayerModel;
    expect(ir1.base.b).toBeCloseTo(used, 12);
    expect(ir1.weekly.at(-1)).toMatchObject({ a: 1, p: expect.closeTo(used, 12) });
    expect(ir1.ros.total).toBeCloseTo(2 * used, 9);
  });

  it("a healthy taxi player in a dynasty league is a curve point too, read with this season's list", () => {
    const league = blendLeague((spec) => {
      spec.leagueType = "dynasty";
      (spec.teams[1] as (typeof spec.teams)[number]).taxi = [p("tx1", "WR", 30, { value: 4500 })];
    });
    const market = league.inputs.market as NonNullable<typeof league.inputs.market>;
    market.format = { ...market.format, isDynasty: true };
    market.seasonValues = { ...market.values };
    const lp = projectLeaguePlayers(league.snapshot, league.inputs, TEST_NOW, NO_RISK);
    expect(lp.blend.factors.get("tx1")).toMatchObject({ ours: 30, fit: true, value: 4500 });
    // He shapes the curve: k5 (5,000) is read off a curve without k5 where tx1's 30 at 4,500 pools with everyone above him
    // (to 15), where without tx1 it reads 9 (k4's 8 to k6's 10).
    const without = projectLeaguePlayers(blendLeague((spec) => (spec.leagueType = "dynasty")).snapshot, league.inputs, TEST_NOW, NO_RISK);
    expect(lp.blend.factors.get("k5")?.market).not.toBeCloseTo(without.blend.factors.get("k5")?.market as number, 3);
    const model = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);
    expect(player(model, "tx1").ros.total).toBeCloseTo(30 * WEEKS * (lp.blend.factors.get("tx1")?.f as number), 9);
  });
});

describe("byes and a week under way never move a factor (review of track A: the blend is per game played)", () => {
  it("two players alike but for their bye (done, ahead, none) keep the same factors in week 9, while their ROS differ", () => {
    const at9 = (bye: number | null) =>
      blendLeague((spec) => {
        spec.currentWeek = 9;
        if (bye !== null) spec.byeWeek = { B5: bye };
        for (const t of spec.teams) t.roster = t.roster.map((x) => (x.id === "k5" ? { ...x, nflTeam: "B5" } : x));
      });
    const run = (bye: number | null) => projectLeaguePlayers(at9(bye).snapshot, at9(bye).inputs, TEST_NOW, NO_RISK);
    const none = run(null);
    const done = run(6);
    const ahead = run(12);
    expect(done.blend.factors).toEqual(none.blend.factors);
    expect(ahead.blend.factors).toEqual(none.blend.factors);
    // Weeks 9–17: 9 games without a bye or with it done, 8 with it ahead; the factor is his anyway.
    expect((done.players.k5 as PlayerModel).ros.total).toBeCloseTo(9 * 9, 9);
    expect((ahead.players.k5 as PlayerModel).ros.total).toBeCloseTo(9 * 8, 9);
  });

  describe("a week in progress (rule 7): the same factors before and after kickoff, and the pre-kickoff rebuild applies them", () => {
    const EARLY = "2026-09-29T17:00:00.000Z"; // before TEST_NOW (20:00Z): started
    const LATE = "2026-09-30T00:15:00.000Z"; // after it
    // Everyone plays on "AAA", which kicked off, except k9 (tonight, on "LAT") and k10 (on bye in week 4, on "BYE").
    const league = blendLeague((spec) => {
      spec.kickoffs = { 4: { AAA: EARLY, LAT: LATE } };
      spec.byeWeek = { BYE: 4 };
      for (const t of spec.teams) t.roster = t.roster.map((x) => (x.id === "k9" ? { ...x, nflTeam: "LAT" } : x.id === "k10" ? { ...x, nflTeam: "BYE" } : x));
    });
    const opts = { now: TEST_NOW, scenarios: 0, sims: 0 };
    const beforeKickoff = new Date(Date.parse(EARLY) - 1);

    it("a build once the week is under way and one before its first kickoff blend alike; a game still to play this week counts in his own ROS", () => {
      const lp = projectLeaguePlayers(league.snapshot, league.inputs, TEST_NOW, NO_RISK);
      const before = projectLeaguePlayers(league.snapshot, league.inputs, beforeKickoff, NO_RISK);
      expect(lp.blend).toEqual(before.blend);
      expect(lp.blend.factors.get("k9")).toMatchObject({ ours: 14, market: expect.closeTo(12.5, 12), f: expect.closeTo(F9, 12) });
      // k10's bye this week changes his ROS, not his factor.
      expect(lp.blend.factors.get("k10")?.f).toBeCloseTo(F10, 12);
      const k9 = lp.players.k9 as PlayerModel;
      // His game tonight still counts in his own ROS (14 weeks), scaled by the same factor.
      expect(k9.weekly[0]?.p).toBeCloseTo(14 * F9, 12);
      expect(k9.ros.total).toBeCloseTo(196 * F9, 9);
      expect(k9.blend).toEqual({ ours: expect.closeTo(196, 9), market: expect.closeTo(12.5 * WEEKS, 9), used: expect.closeTo(196 * F9, 9), weight: 0.5 });
      // k7's game started: his week is 0, his factor 1 either way.
      expect((lp.players.k7 as PlayerModel).weekly[0]?.p).toBe(0);
    });

    it("the pre-kickoff table, with the build's factors or its own, is the table a build at that moment makes", () => {
      const built = buildProjectionTable(league.snapshot, league.inputs, opts, NO_RISK);
      const given = preKickoffTable(league.snapshot, league.inputs, 4, opts, NO_RISK, new Set(), built.players.blend);
      const alone = preKickoffTable(league.snapshot, league.inputs, 4, opts, NO_RISK);
      const at = buildProjectionTable(league.snapshot, league.inputs, { ...opts, now: beforeKickoff }, NO_RISK).table;
      expect(given?.now.toISOString()).toBe("2026-09-29T16:59:59.999Z");
      for (const pre of [given, alone]) {
        for (const id of ["k7", "k9", "k10", "1-qb"]) expect([...(pre?.table.rows.get(id)?.ev ?? [])], id).toEqual([...(at.rows.get(id)?.ev ?? [])]);
        expect(pre?.table.rows.get("k9")?.ev[0]).toBeCloseTo(14 * F9, 12);
        // A player whose game had started is back in the week, his own points (f 1).
        expect(pre?.table.rows.get("k7")?.ev[0]).toBeCloseTo(11, 12);
        // Every later week is the build's own.
        expect(pre?.table.rows.get("k9")?.ev[5]).toBeCloseTo(built.table.rows.get("k9")?.ev[5] as number, 12);
      }
    });

    it("the simulator's first week is the whole week with the build's factors, and every team's weekly score is the one a build before kickoff makes", () => {
      const model = buildLeagueModel(league.snapshot, league.inputs, opts, NO_RISK);
      const before = buildLeagueModel(league.snapshot, league.inputs, { ...opts, now: beforeKickoff }, NO_RISK);
      expect(model.inProgressWeek).toBe(4);
      // Team 1 before kickoff: QB 20, RB 15 and 13, k9 at his blended 13.25, k7 11, TE 10, k5 9 at FLEX, K 8 and D/ST 7.
      expect(model.teams.find((t) => t.id === "1")?.score.mean[0]).toBeCloseTo(20 + 15 + 13 + 14 * F9 + 11 + 10 + 9 + 8 + 7, 9);
      for (const t of model.teams) expect(t.score, `team ${t.id}`).toEqual(before.teams.find((x) => x.id === t.id)?.score);
    });
  });
});

describe("the blend's table per league type (rule 2), and the warning without one", () => {
  /** k9 and k10 swap values in this season's list: by it the curve agrees with both, while the league's own list disagrees with both. */
  const seasonList = (values: Record<string, number>): Record<string, number> => ({ ...values, k9: 10_000, k10: 9000 });

  it("dynasty leagues read this season's list (seasonValues), never their dynasty values", () => {
    const league = blendLeague((spec) => (spec.leagueType = "dynasty"));
    const market = league.inputs.market as NonNullable<typeof league.inputs.market>;
    market.format = { ...market.format, isDynasty: true };
    market.seasonValues = seasonList(market.values);
    const model = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);
    expect(player(model, "k9").blend).toEqual({ ours: expect.closeTo(14 * WEEKS, 9), market: expect.closeTo(14 * WEEKS, 9), used: expect.closeTo(14 * WEEKS, 9), weight: 0.5 });
    expect(model.warnings).not.toContain(BLEND_OFF_WARNING);
  });

  it("a dynasty league without this season's list blends nothing, and says so", () => {
    const league = blendLeague((spec) => (spec.leagueType = "dynasty"));
    const market = league.inputs.market as NonNullable<typeof league.inputs.market>;
    market.format = { ...market.format, isDynasty: true };
    const model = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);
    expect(Object.values(model.players).some((pm) => pm.blend)).toBe(false);
    expect(player(model, "k9").ros.total).toBeCloseTo(14 * WEEKS, 9);
    expect(model.warnings).toContain(BLEND_OFF_WARNING);
    expect(BLEND_OFF_WARNING).toBe("The trade-market blend is off: FantasyCalc's redraft values didn't load.");
    // An empty season list is a missing one (review of track A): the same warning.
    market.seasonValues = {};
    expect(buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK).warnings).toContain(BLEND_OFF_WARNING);
    // FantasyCalc down altogether is the inputs' own warning: the model adds none.
    const down = blendLeague((spec) => {
      spec.leagueType = "dynasty";
      spec.market = false;
    });
    expect(buildLeagueModel(down.snapshot, down.inputs, OPTS, NO_RISK).warnings).not.toContain(BLEND_OFF_WARNING);
    // Nobody projected (a league renewed for a season that hasn't started: the server asks for no season list): nothing to blend, no warning.
    const unprojected = blendLeague((spec) => {
      spec.leagueType = "dynasty";
      for (const t of spec.teams) t.roster = t.roster.map((x) => ({ ...x, points: 0 }));
      spec.freeAgents = (spec.freeAgents ?? []).map((x) => ({ ...x, points: 0 }));
    });
    expect(buildLeagueModel(unprojected.snapshot, unprojected.inputs, OPTS, NO_RISK).warnings).not.toContain(BLEND_OFF_WARNING);
  });

  it("FantasyCalc's curve fallback blends nothing and says so in its own words, never as a list that didn't load (reviews of tracks MK and EF)", () => {
    expect(BLEND_OFF_CURVE_WARNING).toBe("The trade-market blend is off: FantasyCalc didn't answer and its newest values are too old, so projections aren't pulled toward the trade market.");
    for (const leagueType of ["redraft", "dynasty", "keeper"] as const) {
      const league = blendLeague((spec) => (spec.leagueType = leagueType));
      const market = league.inputs.market as NonNullable<typeof league.inputs.market>;
      if (leagueType !== "redraft") market.format = { ...market.format, isDynasty: true };
      // The dynasty league without its season list would warn that the list didn't load (the test above); in the fallback
      // the lists loaded, too old to blend toward. The model inputs' banner speaks of trade values only (review of track
      // EF, finding 2), so the model's own warning is what tells the user the projections aren't blended.
      market.fallback = { kind: "curve", listDate: "2026-09-10T06:00:00.000Z" };
      const model = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);
      expect(Object.values(model.players).some((pm) => pm.blend), leagueType).toBe(false);
      expect(model.warnings, leagueType).not.toContain(BLEND_OFF_WARNING);
      expect(model.warnings.filter((w) => w === BLEND_OFF_CURVE_WARNING), leagueType).toHaveLength(1);
      // Every valued player is an estimate there (market.curveMarketValues).
      expect(player(model, "k9").value?.source, leagueType).toBe("estimate");
    }
    // The same conditions as the other warning: no blend weight, or nobody projected, and there is nothing to say.
    const curve = (edit: (spec: TestLeagueSpec) => void = () => undefined) => {
      const league = blendLeague(edit);
      (league.inputs.market as NonNullable<typeof league.inputs.market>).fallback = { kind: "curve", listDate: "2026-09-10T06:00:00.000Z" };
      return league;
    };
    const weightless = curve();
    expect(buildLeagueModel(weightless.snapshot, weightless.inputs, OPTS, OFF).warnings).not.toContain(BLEND_OFF_CURVE_WARNING);
    const unprojected = curve((spec) => {
      for (const t of spec.teams) t.roster = t.roster.map((x) => ({ ...x, points: 0 }));
      spec.freeAgents = (spec.freeAgents ?? []).map((x) => ({ ...x, points: 0 }));
    });
    expect(buildLeagueModel(unprojected.snapshot, unprojected.inputs, OPTS, NO_RISK).warnings).not.toContain(BLEND_OFF_CURVE_WARNING);
    // With today's list, neither warning.
    const fresh = blendLeague();
    expect(buildLeagueModel(fresh.snapshot, fresh.inputs, OPTS, NO_RISK).warnings.filter((w) => w === BLEND_OFF_WARNING || w === BLEND_OFF_CURVE_WARNING)).toEqual([]);
  });

  it("FantasyCalc's curve fallback fits its value curve on the players the blend's curve takes: healthy, with a game left (review of track MK, finding 1)", () => {
    // An IR WR worth 9,500 (16 a game when healthy, back around week 15: 48 ROS points over weeks 14–17's 25/75/100/100%).
    // Fitted with him, his point (48, 9,500) would pool with k1–k3 (70–98 ROS points) and lift them to 3,875; fitted on the
    // healthy WRs alone the curve runs through each of them (their old values rise with their points but for k9/k10).
    const league = blendLeague((spec) => {
      (spec.teams[0] as (typeof spec.teams)[number]).ir = [p("ir1", "WR", 16, { value: 9500, injury: "IR", injuryReturnWeek: 15 })];
    });
    (league.inputs.market as NonNullable<typeof league.inputs.market>).fallback = { kind: "curve", listDate: "2026-09-10T06:00:00.000Z" };
    const model = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);
    expect(player(model, "ir1").ros.total).toBeCloseTo(48, 9);
    expect(player(model, "k1").value).toEqual({ value: expect.closeTo(1000, 9), source: "estimate" });
    expect(player(model, "k3").value).toEqual({ value: expect.closeTo(3000, 9), source: "estimate" });
    // The IR WR is still valued, off the healthy curve at his own ROS points (proportional below its lowest point).
    expect(player(model, "ir1").value).toEqual({ value: expect.closeTo((1000 * 48) / 70, 9), source: "estimate" });
    // The rule is step 3b's (league.marketCurveFit): no tag, an NFL team, a remaining week that isn't his bye.
    const weeks = { weeks: [4, 5, 6] };
    const ctx = (injury: InjuryStatus, hasTeam = true, byeWeek?: number) => ({ info: { injury } as PlayerInfo, ctx: { hasTeam, byeWeek } as AvailabilityContext });
    expect(marketCurveFit(ctx("ACTIVE"), weeks)).toBe(true);
    expect(marketCurveFit(ctx("QUESTIONABLE"), weeks)).toBe(false);
    expect(marketCurveFit(ctx("ACTIVE", false), weeks)).toBe(false);
    expect(marketCurveFit(ctx("ACTIVE", true, 4), { weeks: [4] })).toBe(false);
    expect(marketCurveFit(ctx("ACTIVE", true, 4), weeks)).toBe(true);
  });

  it("keeper leagues read their redraft list (perception's), and redraft leagues their values", () => {
    const keeper = blendLeague((spec) => (spec.leagueType = "keeper"));
    const market = keeper.inputs.market as NonNullable<typeof keeper.inputs.market>;
    market.format = { ...market.format, isDynasty: true };
    market.redraftValues = seasonList(market.values);
    const model = buildLeagueModel(keeper.snapshot, keeper.inputs, OPTS, NO_RISK);
    expect(player(model, "k9").blend?.market).toBeCloseTo(14 * WEEKS, 9);
    // Without the redraft list (the dynasty one loaded alone), nothing is blended.
    delete market.redraftValues;
    const without = buildLeagueModel(keeper.snapshot, keeper.inputs, OPTS, NO_RISK);
    expect(Object.values(without.players).some((pm) => pm.blend)).toBe(false);
    expect(without.warnings).toContain(BLEND_OFF_WARNING);
  });
});
