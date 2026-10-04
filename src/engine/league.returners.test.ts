/**
 * IR returners in the League model (league.ts step 5b; planner reply to Checkpoint 4, change 5): returner rows in the
 * lineups (strength, ROS, PPW, score), the roster spot one needs from his week on a full roster (final evaluations: the
 * team as it stands), their scenario draws, their lineup costs in TeamModel.players, the week in progress, and
 * irReturners false (Checkpoint 4's rule). Made-up players, placeholder teams.
 */
import { describe, expect, it } from "vitest";
import { config } from "./config";
import { buildLeagueModel, buildLeagueModelWithContext, buildProjectionTable, teamRosterScorer, type BuildLeagueModelOptions, type LeagueModelConfig } from "./league";
import type { LeagueModel, TeamModel } from "./leagueModel";
import { prepareLeagueSlots } from "./lineup";
import type { LeagueSnapshot, Pos } from "./model";
import { surplusScores } from "./needs";
import { finalLineups } from "./returners";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { evRemovalCosts, maskedRow, solveEvWeeks, teamEval, type TableRow } from "./teamValue";
import { TEST_NOW, buildTestLeague, type TestLeagueSpec, type TestPlayer, type TestTeam } from "./testLeague";

const ZERO_MISS: Record<Pos, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, P: 0, DEF: 0, DL: 0, LB: 0, DB: 0 };
/** No future injury risk: every healthy player certainly plays (the hand-built cases stay obvious). */
const NO_RISK: LeagueModelConfig = { ...config, projections: { ...config.projections, injuryRisk: { ...config.projections.injuryRisk, missShare: ZERO_MISS } } };
/** My team streams nothing (the default streams K and D/ST): the cases' kickers and D/STs are their own. */
const NO_STREAMING: TradeSettings = { ...defaultTradeSettings(), streamPositions: [] };

const p = (id: string, pos: Pos, points: number, extra: Partial<TestPlayer> = {}): TestPlayer => ({ id, pos, points, ...extra });
const teamOf = (m: LeagueModel, id: string): TeamModel => m.teams.find((t) => t.id === id) as TeamModel;

/** A full starting lineup at strength s, a bench RB and a bench WR: 11 players. */
function roster(team: string, s = 1): TestPlayer[] {
  return [
    p(`${team}-qb`, "QB", 20 * s),
    p(`${team}-rb1`, "RB", 15 * s),
    p(`${team}-rb2`, "RB", 9 * s),
    p(`${team}-wr1`, "WR", 15 * s),
    p(`${team}-wr2`, "WR", 13 * s),
    p(`${team}-te`, "TE", 10 * s),
    p(`${team}-flex`, "WR", 11 * s),
    p(`${team}-k`, "K", 8),
    p(`${team}-def`, "DEF", 7),
    p(`${team}-bRB`, "RB", 4, { value: 300 }),
    p(`${team}-bWR`, "WR", 3, { value: 200 }),
  ];
}

/**
 * Two teams of 11; team 1 has an IR RB scoring 18 back in week 8 (ESPN's date: 25% / 50% / 25% over weeks 7–9). The
 * roster size is `max` (11: full; 12: an open spot).
 */
function league(max: number, edit: (spec: TestLeagueSpec) => void = () => undefined) {
  const teams: TestTeam[] = [
    { id: "1", roster: roster("1"), ir: [p("ir-rb", "RB", 18, { injury: "IR", injuryReturnWeek: 8 })] },
    { id: "2", roster: roster("2", 0.9) },
  ];
  const spec: TestLeagueSpec = { teams, freeAgents: [p("fa-rb", "RB", 2), p("fa-wr", "WR", 2)] };
  edit(spec);
  const built = buildTestLeague(spec);
  const snapshot: LeagueSnapshot = { ...built.snapshot, settings: { ...built.snapshot.settings, maxRosterSize: max } };
  return { snapshot, inputs: built.inputs };
}

const OPTS: BuildLeagueModelOptions = { now: TEST_NOW, scenarios: 0, sims: 0, settings: NO_STREAMING };

/** EV LV per week of team 1 from the table, its returner in, and `masked` (an id and a week index) zeroed from then on. */
function evLv(l: ReturnType<typeof league>, ids: readonly string[], masked: { id: string; from: number } | null): number[] {
  const { table } = buildProjectionTable(l.snapshot, l.inputs, OPTS, NO_RISK);
  const rows = ids.flatMap((id) => {
    const r = table.rows.get(id) as TableRow | undefined;
    return r ? [masked && masked.id === id ? maskedRow(r, masked.from) : r] : [];
  });
  return Array.from(solveEvWeeks(teamEval(rows, prepareLeagueSlots(l.snapshot.settings)), table.weeks.length).lv);
}

describe("IR returners in the League model (step 5b)", () => {
  it("a returner joins his team's lineups from his return (his own availability), and lifts its strength there", () => {
    const l = league(12);
    const on = buildLeagueModel(l.snapshot, l.inputs, OPTS, NO_RISK);
    const off = buildLeagueModel(l.snapshot, l.inputs, { ...OPTS, irReturners: false }, NO_RISK);
    const ids = l.snapshot.teams[0]?.roster ?? [];
    expect(teamOf(on, "1").ev.lv).toEqual(evLv(l, [...ids, "ir-rb"], null));
    expect(teamOf(off, "1").ev.lv).toEqual(evLv(l, ids, null));
    // Weeks 4–6 (before any chance he's back) are the same; from week 7 the RB slots gain him.
    expect(teamOf(on, "1").ev.lv.slice(0, 3)).toEqual(teamOf(off, "1").ev.lv.slice(0, 3));
    expect(teamOf(on, "1").ev.lv[5] as number).toBeGreaterThan(teamOf(off, "1").ev.lv[5] as number);
    expect(teamOf(on, "1").strength.RB1?.ros).toBeGreaterThan(teamOf(off, "1").strength.RB1?.ros as number);
    expect(teamOf(on, "1").ev.ppw).toBeGreaterThan(teamOf(off, "1").ev.ppw);
    // Team 2 has no IR player: nothing changes there.
    expect(teamOf(on, "2").ev).toEqual(teamOf(off, "2").ev);
  });

  it("a full roster drops its lowest keep value player from the return week on (not before); an open spot drops nobody", () => {
    const full = league(11);
    const model = buildLeagueModel(full.snapshot, full.inputs, OPTS, NO_RISK);
    const ids = full.snapshot.teams[0]?.roster ?? [];
    // R = week 8 (index 4 of weeks 4–17). The bench WR (3 points) and the bench RB (4) cost nothing once the returner
    // starts; the bench RB is benched by him and the bench WR was always benched: both 0, so the less valuable goes.
    expect(teamOf(model, "1").ev.lv).toEqual(evLv(full, [...ids, "ir-rb"], { id: "1-bWR", from: 4 }));
    const open = buildLeagueModel(league(12).snapshot, league(12).inputs, OPTS, NO_RISK);
    expect(teamOf(open, "1").ev.lv).toEqual(evLv(full, [...ids, "ir-rb"], null));
    // The drop counts: here the bench WR never starts, so the lineups are the open spot's.
    expect(teamOf(model, "1").ev.lv).toEqual(teamOf(open, "1").ev.lv);
  });

  // Team 1's bench WR scores 10, its bench RB 4. Its WR2's bye (week 9) moves the FLEX WR to WR2 and puts the bench WR (10)
  // in the FLEX, ahead of rb2 (9), whom the returner RB benches from his return. From week 8 on the bench RB and rb2 cost
  // nothing to lose, the bench WR 1 point (week 9).
  const startsOnce = () =>
    league(11, (spec) => {
      const t = spec.teams[0] as TestTeam;
      t.roster = t.roster.map((x) => (x.id === "1-bWR" ? p("1-bWR", "WR", 10, { value: 200 }) : x.id === "1-wr2" ? p("1-wr2", "WR", 13, { nflTeam: "BYE" }) : x.id === "1-rb2" ? p("1-rb2", "RB", 9, { value: 5000 }) : x));
      spec.byeWeek = { BYE: 9 };
    });

  it("the displaced player's weeks from the return are gone, and the keep value picks him: a backup who starts once beats one who never does", () => {
    // Exact ties only (config.lineups.dropNearTieWeekly 0): the less valuable bench RB goes, and the bench WR's start stays.
    const exactTies: LeagueModelConfig = { ...NO_RISK, lineups: { ...NO_RISK.lineups, dropNearTieWeekly: 0 } };
    const l = startsOnce();
    const model = buildLeagueModel(l.snapshot, l.inputs, OPTS, exactTies);
    const ids = l.snapshot.teams[0]?.roster ?? [];
    const lv = teamOf(model, "1").ev.lv;
    expect(lv).toEqual(evLv(l, [...ids, "ir-rb"], { id: "1-bRB", from: 4 }));
    expect(lv).not.toEqual(evLv(l, [...ids, "ir-rb"], { id: "1-bWR", from: 4 }));
  });

  it("⚠️ near-ties count as ties (final review of Phase 4c, finding R6): the bench WR's one start, 1 point, is under 0.2 points a week, so the less valuable bench WR goes", () => {
    const l = startsOnce();
    const model = buildLeagueModel(l.snapshot, l.inputs, OPTS, NO_RISK);
    const ids = l.snapshot.teams[0]?.roster ?? [];
    const lv = teamOf(model, "1").ev.lv;
    // The tolerance from his return on (week 8 = index 4): 0.2 × Σ ω over those weeks, above the 1 point the WR's start costs.
    const built = buildLeagueModelWithContext(l.snapshot, l.inputs, OPTS, NO_RISK).context;
    const weights = built.tw.weights;
    // Both bench players are worth more than the waiver credit W (the near-tie floors values at it).
    expect(built.market.waiverCredit).toBeLessThan(200);
    const tie = config.lineups.dropNearTieWeekly * Array.from(weights).slice(4).reduce((s, w) => s + w, 0);
    expect(tie).toBeGreaterThan(1);
    expect(lv).toEqual(evLv(l, [...ids, "ir-rb"], { id: "1-bWR", from: 4 }));
    // His week-9 start is gone: 1 point that week, nothing else.
    const exact = evLv(l, [...ids, "ir-rb"], { id: "1-bRB", from: 4 });
    expect(lv.map((x, w) => Math.round((exact[w] as number) - x))).toEqual(lv.map((_, w) => (w === 5 ? 1 : 0)));
  });

  it("⚠️ a returner worth the least from his week is released then (review of track E): the team is never weaker than without him", () => {
    // A 1-point IR RB back in week 8 on a full roster: the bench RB (4) and WR (3) each cover something or tie at nothing,
    // and he's the least valuable (no market value): he goes, from his return.
    const l = league(11, (spec) => {
      (spec.teams[0] as TestTeam).ir = [p("ir-rb", "RB", 1, { injury: "IR", injuryReturnWeek: 8 })];
    });
    for (const scenarios of [0, 8]) {
      const opts = { ...OPTS, scenarios };
      const { model, context } = buildLeagueModelWithContext(l.snapshot, l.inputs, opts, NO_RISK);
      const t = context.work[0];
      if (!t) throw new Error("no team 1");
      expect(finalLineups(context.returnerSetup, t.ids, t.stream, { ev: t.solved, scen: t.scen }).displaced, `${scenarios} scenarios`).toEqual([{ id: "ir-rb", from: 4, returner: "ir-rb" }]);
      const off = buildLeagueModel(l.snapshot, l.inputs, { ...opts, irReturners: false }, NO_RISK);
      const on = teamOf(model, "1");
      const was = teamOf(off, "1");
      on.ev.lv.forEach((x, w) => expect(x, `week ${w}`).toBeGreaterThanOrEqual((was.ev.lv[w] as number) - 1e-9));
      expect((on.scen ?? on.ev).ros).toBeGreaterThanOrEqual((was.scen ?? was.ev).ros - 1e-9);
    }
  });

  it("draws IR players' scenario flags (nobody else's change), and none under irReturners false", () => {
    const l = league(11);
    const opts = { ...OPTS, scenarios: 8 };
    const on = buildProjectionTable(l.snapshot, l.inputs, opts, NO_RISK).table;
    const off = buildProjectionTable(l.snapshot, l.inputs, { ...opts, irReturners: false }, NO_RISK).table;
    expect(on.rows.get("ir-rb")?.flags).not.toBeNull();
    expect(off.rows.get("ir-rb")?.flags).toBeNull();
    for (const [id, r] of on.rows) if (id !== "ir-rb") expect(Array.from(r.flags ?? []), id).toEqual(Array.from(off.rows.get(id)?.flags ?? []));
    // He plays no scenario before week 7 (his return distribution starts there).
    const flags = on.rows.get("ir-rb")?.flags as Uint8Array;
    const W = on.weeks.length;
    for (let s = 0; s < 8; s++) for (let w = 0; w < 3; w++) expect(flags[s * W + w]).toBe(0);
  });

  it("TeamModel.players gains the returners: lineup cost = what losing him costs V*(T)'s lineups (nobody refills him), surplus scores with them", () => {
    const l = league(12);
    const { model, context } = buildLeagueModelWithContext(l.snapshot, l.inputs, OPTS, NO_RISK);
    const tm = teamOf(model, "1");
    const t = context.work[0];
    if (!t) throw new Error("no team 1");
    const k = t.vstar.team.rows.findIndex((r) => r.id === "ir-rb");
    expect(k).toBeGreaterThanOrEqual(0);
    expect(tm.players["ir-rb"]).toEqual({ mvLoseEv: Math.max(0, evRemovalCosts(t.vstar.solved, context.weights)[k] as number), mvLoseScen: null, autoAdd: null, surplusScore: expect.any(Number) });
    expect(tm.players["ir-rb"]?.mvLoseEv).toBeGreaterThan(0);
    // The surplus scores are standardized over the active players and the returner together.
    const ids = [...t.rows.map((r) => r.id), "ir-rb"];
    const want = surplusScores(
      ids.map((id) => context.valueOf(id)),
      ids.map((id) => tm.players[id]?.mvLoseEv as number),
    );
    ids.forEach((id, i) => expect(tm.players[id]?.surplusScore, id).toBeCloseTo(want[i] as number, 12));
    // Trade chips stay active-roster only.
    for (const c of tm.chips) expect(c.playerId).not.toBe("ir-rb");
    // Checkpoint 4's rule: no returner in TeamModel.players.
    expect(teamOf(buildLeagueModel(l.snapshot, l.inputs, { ...OPTS, irReturners: false }, NO_RISK), "1").players["ir-rb"]).toBeUndefined();
  });

  it("an IR player out for the season, or with no NFL team, is no returner: no lineup row, no displacement, not in TeamModel.players", () => {
    for (const extra of [{ injuryReturnWeek: 19 }, { nflTeam: null }] as Partial<TestPlayer>[]) {
      const l = league(11, (spec) => {
        (spec.teams[0] as TestTeam).ir = [p("ir-rb", "RB", 18, { injury: "IR", injuryReturnWeek: 8, ...extra })];
        spec.nflLastWeek = 18;
      });
      const model = buildLeagueModel(l.snapshot, l.inputs, OPTS, NO_RISK);
      const off = buildLeagueModel(l.snapshot, l.inputs, { ...OPTS, irReturners: false }, NO_RISK);
      expect(teamOf(model, "1").ev, JSON.stringify(extra)).toEqual(teamOf(off, "1").ev);
      expect(teamOf(model, "1").players["ir-rb"]).toBeUndefined();
    }
  });

  it("the week in progress counts a returner back now, and leaves out the player displaced from it (TeamModel.score's pre-kickoff week)", () => {
    // A healthy QB in team 1's IR slot (ACTIVE: he can be activated now, R = week 4) scores 25 against the active QB's 20.
    // Week 4 is under way (another NFL team kicked off); team 1's roster is full, so its cheapest player goes from week 4.
    const l = league(11, (spec) => {
      (spec.teams[0] as TestTeam).ir = [p("ir-qb", "QB", 25)];
      spec.kickoffs = { 4: { ZZZ: "2026-09-29T17:00:00.000Z" } };
    });
    const on = buildLeagueModel(l.snapshot, l.inputs, OPTS, NO_RISK);
    const off = buildLeagueModel(l.snapshot, l.inputs, { ...OPTS, irReturners: false }, NO_RISK);
    expect(on.inProgressWeek).toBe(4);
    expect((teamOf(on, "1").score.mean[0] as number) - (teamOf(off, "1").score.mean[0] as number)).toBeCloseTo(5, 9);
    // Every later week too (he starts at QB all season).
    expect((teamOf(on, "1").score.mean[3] as number) - (teamOf(off, "1").score.mean[3] as number)).toBeCloseTo(5, 9);
  });

  it("a returner released at the week under way (back now, the least valuable from now on) doesn't play its pre-kickoff week either", () => {
    // A healthy WR in team 1's IR slot (R = week 4, under way) scores 6, and team 1's WR1 is on bye in week 4, so before
    // kickoff he'd start at WR. The roster is full, and the week under way weighs 0 in keep values: he's the one released,
    // from week 4 on, so TeamModel.score's week 4 is the team without him (review of Phase 4b: he still played it).
    const l = league(11, (spec) => {
      const t = spec.teams[0] as TestTeam;
      t.roster = t.roster.map((x) => (x.id === "1-wr1" ? p("1-wr1", "WR", 15, { nflTeam: "BYE4" }) : x));
      t.ir = [p("ir-wr", "WR", 6, { value: 1 })];
      spec.byeWeek = { BYE4: 4 };
      spec.kickoffs = { 4: { ZZZ: "2026-09-29T17:00:00.000Z" } };
    });
    for (const scenarios of [0, 8]) {
      const opts = { ...OPTS, scenarios };
      const { model, context } = buildLeagueModelWithContext(l.snapshot, l.inputs, opts, NO_RISK);
      expect(model.inProgressWeek).toBe(4);
      const t = context.work[0];
      if (!t) throw new Error("no team 1");
      expect(finalLineups(context.returnerSetup, t.ids, t.stream, { ev: t.solved, scen: t.scen }).displaced, `${scenarios} scenarios`).toEqual([{ id: "ir-wr", from: 0, returner: "ir-wr" }]);
      const off = buildLeagueModel(l.snapshot, l.inputs, { ...opts, irReturners: false }, NO_RISK);
      const on = teamOf(model, "1");
      const was = teamOf(off, "1");
      expect(on.score.mean[0] as number, `${scenarios} scenarios`).toBeCloseTo(was.score.mean[0] as number, 9);
      expect(on.score.sd[0] as number, `${scenarios} scenarios`).toBeCloseTo(was.score.sd[0] as number, 9);
      // The rest of the season agrees too (he's gone from week 4 on).
      on.score.mean.forEach((x, w) => expect(x, `week index ${w}`).toBeCloseTo(was.score.mean[w] as number, 9));
    }
  });

  it("teamRosterScorer prices a team's roster exactly as TeamModel.score does (returners and displacement included), a week in progress too", () => {
    for (const kickoffs of [undefined, { 4: { ZZZ: "2026-09-29T17:00:00.000Z" } }]) {
      const l = league(11, (spec) => {
        if (kickoffs) spec.kickoffs = kickoffs;
      });
      for (const scenarios of [0, 8]) {
        const opts = { ...OPTS, scenarios };
        const model = buildLeagueModel(l.snapshot, l.inputs, opts);
        const score = teamRosterScorer(l.snapshot, l.inputs, opts);
        for (const t of l.snapshot.teams) expect(score(t.roster, t.id), `team ${t.id}, ${scenarios} scenarios`).toEqual(teamOf(model, t.id).score);
        expect(score([], "9")).toBeNull();
      }
    }
  });
});
