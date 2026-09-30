import { describe, expect, it } from "vitest";
import { normalizeEspnLeague } from "@/adapters/espn/normalize";
import { NOW, PARKER, fakeResolver, parkerBundle } from "@/adapters/espn/test-helpers";
import { config } from "./config";
import type { ModelInputs } from "./inputs";
import {
  NO_TRADE_VALUES_WARNING,
  buildLeagueModel,
  buildProjectionTable,
  gameStarted,
  leagueWeeks,
  nflLastWeek,
  teamWeeks,
  weekKickedOff,
  type BuildLeagueModelOptions,
  type LeagueModelConfig,
} from "./league";
import type { LeagueModel, TeamModel } from "./leagueModel";
import { prepareLeagueSlots } from "./lineup";
import type { LeagueSnapshot, Pos, SlotDef } from "./model";
import { qualifyingSurplus, standardize, surplusScores } from "./needs";
import { mvAddGroupPpw, mvLose, ppw, rosValue, scenarioLineups, weekWeights } from "./teamValue";
import { TEST_NOW, buildTestLeague, randomLeague, syntheticInputs, type TestLeagueSpec, type TestPlayer, type TestTeam } from "./testLeague";

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const ZERO_MISS: Record<Pos, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, P: 0, DEF: 0, DL: 0, LB: 0, DB: 0 };
/** No future injury risk: every healthy player certainly plays (the hand-built cases stay obvious). */
const NO_RISK: LeagueModelConfig = { ...config, projections: { ...config.projections, injuryRisk: { ...config.projections.injuryRisk, missShare: ZERO_MISS } } };

const p = (id: string, pos: Pos, points: number, extra: Partial<TestPlayer> = {}): TestPlayer => ({ id, pos, points, ...extra });

/** A full starting lineup (QB, 2 RB, 2 WR, TE, FLEX, K, D/ST) at a team's strength `s` (points scale), ids prefixed by the team id. */
function starters(team: string, s = 1): TestPlayer[] {
  return [
    p(`${team}-qb`, "QB", 20 * s),
    p(`${team}-rb1`, "RB", 15 * s),
    p(`${team}-rb2`, "RB", 13 * s),
    p(`${team}-wr1`, "WR", 15 * s),
    p(`${team}-wr2`, "WR", 13 * s),
    p(`${team}-te`, "TE", 10 * s),
    p(`${team}-flex`, "WR", 11 * s),
    p(`${team}-k`, "K", 8),
    p(`${team}-def`, "DEF", 7),
  ];
}

const team = (id: string, roster: TestPlayer[]): TestTeam => ({ id, roster });
const teamOf = (m: LeagueModel, id: string): TeamModel => m.teams.find((t) => t.id === id) as TeamModel;

type RawCost = { ev: number; scen: number | null; autoAdd: string | null };

/**
 * §7's MV_lose as written, ROS(T) − ROS(T − i + fa_i) (teamValue.mvLose, the friendly API: its own solves),
 * for every modeled player of a team, on the same projection table and scenario draws as the model, over
 * the weeks the model's team numbers count (teamWeeks: a week in progress weighs 0).
 */
function rawCosts(league: { snapshot: LeagueSnapshot; inputs: ModelInputs }, model: LeagueModel, teamId: string, opts: BuildLeagueModelOptions, cfg: LeagueModelConfig = config): Record<string, RawCost> {
  const { snapshot } = league;
  const { table } = buildProjectionTable(snapshot, league.inputs, opts, cfg);
  const slots = prepareLeagueSlots(snapshot.settings);
  const { weights } = teamWeeks(model, model.inProgressWeek, cfg.lineups);
  const roster = snapshot.teams.find((t) => t.id === teamId)?.roster ?? [];
  const rosterPositions = roster.flatMap((id) => {
    const info = snapshot.players[id];
    return info ? [info.pos] : [];
  });
  const out: Record<string, RawCost> = {};
  for (const id of Object.keys(teamOf(model, teamId).players)) {
    out[id] = mvLose(roster, id, snapshot.freeAgents, table, slots, { weights, rosterPositions, ...(snapshot.settings.positionLimits ? { positionLimits: snapshot.settings.positionLimits } : {}) });
  }
  return out;
}

/** Every number in the model is finite (no NaN or Infinity leaks into the page). */
function allFinite(x: unknown, path = "model"): string[] {
  if (typeof x === "number") return Number.isFinite(x) ? [] : [path];
  if (Array.isArray(x)) return x.flatMap((v, i) => allFinite(v, `${path}[${i}]`));
  if (x && typeof x === "object") return Object.entries(x).flatMap(([k, v]) => allFinite(v, `${path}.${k}`));
  return [];
}

// ---------------------------------------------------------------------------------------------

describe("weeks (Phase 2 spec: remaining NFL weeks currentWeek..lastWeek)", () => {
  it("runs through the last playoff week, split into regular-season and playoff weeks", () => {
    expect(leagueWeeks({ regularSeasonWeeks: range(1, 14), playoffWeeks: [15, 16, 17] }, 12)).toEqual({ weeks: [12, 13, 14, 15, 16, 17], regularWeeks: [12, 13, 14], playoffWeeks: [15, 16, 17], lastWeek: 17 });
    expect(leagueWeeks({ regularSeasonWeeks: range(1, 13), playoffWeeks: [] }, 12).weeks).toEqual([12, 13]);
    expect(leagueWeeks({ regularSeasonWeeks: [], playoffWeeks: [] }, 4, 6).weeks).toEqual([4, 5, 6]);
  });

  it("is empty once the season is over", () => {
    expect(leagueWeeks({ regularSeasonWeeks: range(1, 14), playoffWeeks: [15, 16, 17] }, 18)).toMatchObject({ weeks: [], regularWeeks: [], playoffWeeks: [] });
  });

  it("a game has started when its kickoff is at or before now; an unknown kickoff hasn't", () => {
    const nfl = { byeWeek: {}, kickoffs: { 4: { KC: "2026-09-29T17:00:00.000Z", BUF: "2026-09-30T00:15:00.000Z" } } };
    const now = TEST_NOW.getTime();
    expect(gameStarted("KC", nfl, 4, now)).toBe(true);
    expect(gameStarted("BUF", nfl, 4, now)).toBe(false);
    expect(gameStarted("DAL", nfl, 4, now)).toBe(false);
    expect(gameStarted(null, nfl, 4, now)).toBe(false);
    expect(gameStarted("KC", nfl, 5, now)).toBe(false);
  });

  it("a week is in progress once any of its games has kicked off (at kickoff counts; an unknown or unreadable kickoff hasn't)", () => {
    const nfl = { byeWeek: {}, kickoffs: { 4: { KC: "2026-09-29T17:00:00.000Z", BUF: "2026-09-30T00:15:00.000Z" }, 5: { KC: "2026-10-04T17:00:00.000Z" }, 6: { KC: "not a date" } } };
    const now = TEST_NOW.getTime();
    expect(weekKickedOff(nfl, 4, now)).toBe(true);
    expect(weekKickedOff(nfl, 4, Date.parse("2026-09-29T17:00:00.000Z"))).toBe(true);
    expect(weekKickedOff(nfl, 4, Date.parse("2026-09-29T16:59:59.999Z"))).toBe(false);
    expect(weekKickedOff(nfl, 5, now)).toBe(false);
    expect(weekKickedOff(nfl, 6, now)).toBe(false);
    expect(weekKickedOff(nfl, 7, now)).toBe(false);
    expect(weekKickedOff(undefined, 4, now)).toBe(false);
  });

  it("teamWeeks: a week in progress weighs 0 in ROS, leaves PPW's weeks, and the strength windows start the week after it", () => {
    const pw = config.lineups.playoffWeight;
    const weeks = leagueWeeks({ regularSeasonWeeks: range(1, 14), playoffWeeks: [15, 16, 17] }, 12);
    const none = teamWeeks(weeks, null);
    expect(none).toMatchObject({ inProgressWeek: null, from: 0, regularWeeks: [12, 13, 14], nNext: 4 });
    expect([...none.weights]).toEqual([...weekWeights(weeks.weeks, weeks.regularWeeks, weeks.playoffWeeks)]);
    expect([...none.nextWeights]).toEqual([0.25, 0.25, 0.25, 0.25, 0, 0]);
    expect([...none.allWeights]).toEqual(new Array(6).fill(1 / 6));
    const live = teamWeeks(weeks, 12);
    expect(live).toMatchObject({ inProgressWeek: 12, from: 1, regularWeeks: [13, 14], nNext: 4 });
    expect([...live.weights]).toEqual([0, 1, 1, pw, pw, pw]);
    expect([...live.nextWeights]).toEqual([0, 0.25, 0.25, 0.25, 0.25, 0]);
    expect([...live.allWeights]).toEqual([0, 0.2, 0.2, 0.2, 0.2, 0.2]);
    // The last week in progress: nothing is left to average (PPW 0, empty windows).
    const last = teamWeeks(leagueWeeks({ regularSeasonWeeks: range(1, 14), playoffWeeks: [] }, 14), 14);
    expect(last).toMatchObject({ inProgressWeek: 14, from: 1, regularWeeks: [], nNext: 0 });
    expect([...last.weights, ...last.nextWeights, ...last.allWeights]).toEqual([0, 0, 0]);
    // Only the first remaining week can be in progress; no weeks left, nothing is.
    expect(teamWeeks(weeks, 13)).toMatchObject({ inProgressWeek: null, from: 0 });
    expect(teamWeeks(leagueWeeks({ regularSeasonWeeks: range(1, 14), playoffWeeks: [] }, 18), 18)).toMatchObject({ inProgressWeek: null, from: 0, nNext: 0 });
    expect(teamWeeks(weeks, null, { playoffWeight: 2, strengthWeeks: Number.NaN }).nNext).toBe(0);
  });
});

describe("depth counts (§7; planner reply to Checkpoint 1, addition C): Checkpoint 2's before/after example", () => {
  // Team 1: two star RBs and a bench RB who never starts in the average-case lineup (the FLEX goes to a 13-point WR).
  const league = buildTestLeague({
    teams: [
      team("1", [...starters("1").filter((x) => x.id !== "1-rb1" && x.id !== "1-rb2" && x.id !== "1-flex"), p("1-starA", "RB", 20), p("1-starB", "RB", 18), p("1-wr3", "WR", 13), p("1-bench", "RB", 10)]),
      team("2", starters("2")),
      team("3", starters("3")),
      team("4", starters("4")),
    ],
  });
  const model = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW });

  it("a bench RB behind two stars costs ~0 with expected-value lineups but clearly more with scenario lineups", () => {
    const bench = teamOf(model, "1").players["1-bench"];
    expect(bench?.mvLoseEv).toBeCloseTo(0, 9); // he never starts in the average-case lineup
    expect(bench?.mvLoseScen).toBeGreaterThan(5); // he starts whenever a star is hurt
    expect(bench?.autoAdd).toBeNull(); // no free agents in this league
  });

  it("stays exactly §7's ROS(T) − ROS(T − i + fa) when no free agent helps: no waiver move, no shift (also with a free agent who starts nowhere)", () => {
    for (const t of model.teams) expect(t.waiver, `team ${t.id}`).toBeNull();
    const raw = rawCosts(league, model, "1", { now: TEST_NOW });
    for (const [id, v] of Object.entries(teamOf(model, "1").players)) {
      expect(v.mvLoseEv, id).toBe(raw[id]?.ev);
      expect(v.mvLoseScen, id).toBe(raw[id]?.scen);
    }
    // A 2-point free-agent RB improves no team's lineup (every team has an open roster spot): nothing changes.
    const weak = buildTestLeague({
      teams: [
        team("1", [...starters("1").filter((x) => x.id !== "1-rb1" && x.id !== "1-rb2" && x.id !== "1-flex"), p("1-starA", "RB", 20), p("1-starB", "RB", 18), p("1-wr3", "WR", 13), p("1-bench", "RB", 10)]),
        team("2", starters("2")),
        team("3", starters("3")),
        team("4", starters("4")),
      ],
      freeAgents: [p("fa-rb", "RB", 2)],
    });
    const m2 = buildLeagueModel(weak.snapshot, weak.inputs, { now: TEST_NOW });
    for (const t of m2.teams) expect(t.waiver, `team ${t.id}`).toBeNull();
    expect(teamOf(m2, "1").players).toEqual(teamOf(model, "1").players);
  });

  it("depth makes scenario lineups worth more than expected-value ones (Jensen: each scenario's best lineup)", () => {
    // Team 1's bench RB fills in when a star is hurt. Teams 2–4 have no bench: their lineups are forced, so the two
    // agree in expectation and differ only by sampling noise.
    const t1 = teamOf(model, "1");
    expect((t1.scen as NonNullable<TeamModel["scen"]>).ros).toBeGreaterThan(t1.ev.ros + 5);
    expect(t1.scen?.sd.every((x) => x >= 0)).toBe(true);
    expect(t1.scen?.sd.some((x) => x > 0)).toBe(true);
  });
});

describe("lineup costs from the team after its best free-agent move (§7 MV_lose; Checkpoint 2's negative-cost fix)", () => {
  /** Σ ω over weeks 4–17: 11 regular-season weeks and 3 playoff weeks at playoffWeight. */
  const OMEGA = 11 + 3 * config.lineups.playoffWeight;
  const OPTS = { now: TEST_NOW, scenarios: 8 };
  /** Values for the non-kicking starters, so the kicker (no FantasyCalc value: the floor) is the team's least valuable player. */
  const valued = (t: string): TestPlayer[] => starters(t).map((x, i) => (x.pos === "K" || x.pos === "DEF" ? x : { ...x, value: 3000 - 100 * i }));
  // Team 1's active roster is full (16 of 16): the nine starters and seven bench players who never start ("1-b-wr" sorts
  // before "1-k", so it's market value, not the id, that picks who is dropped).
  const bench = [
    p("1-qb2", "QB", 12, { value: 800 }),
    p("1-rb3", "RB", 6, { value: 600 }),
    p("1-rb4", "RB", 5, { value: 500 }),
    p("1-rb5", "RB", 3, { value: 400 }),
    p("1-wr4", "WR", 7, { value: 700 }),
    p("1-b-wr", "WR", 6, { value: 650 }),
    p("1-te2", "TE", 4, { value: 300 }),
  ];
  // Every team's kicker scores 8; the free agent 12.
  const kLeague = buildTestLeague({ teams: [team("1", [...valued("1"), ...bench]), team("2", valued("2")), team("3", valued("3")), team("4", valued("4"))], freeAgents: [p("fa-k", "K", 12)] });

  it("a free-agent K beats the team's K: §7's raw costs go negative, measured from the best move they don't, shifted by one constant per team", () => {
    expect(kLeague.snapshot.teams[0]?.roster).toHaveLength(kLeague.snapshot.settings.maxRosterSize);
    const model = buildLeagueModel(kLeague.snapshot, kLeague.inputs, OPTS, NO_RISK);
    const t1 = teamOf(model, "1");
    const raw = rawCosts(kLeague, model, "1", OPTS, NO_RISK);
    const gain = 4 * OMEGA; // the free-agent K's 4 extra points a week
    // Before: every bench player and the old K "cost" −gain (T − i + the free-agent K beats T itself).
    for (const id of ["1-k", ...bench.map((b) => b.id)]) {
      expect(raw[id]?.ev, id).toBeCloseTo(-gain, 9);
      expect(raw[id]?.scen, id).toBeCloseTo(-gain, 9);
      expect(raw[id]?.autoAdd, id).toBe("fa-k");
    }
    // After: add the free-agent K and drop the least valuable of the players whose loss costs nothing (the old K, at the value floor).
    expect(t1.waiver).toEqual({ add: "fa-k", drop: "1-k", gainEv: expect.closeTo(gain, 9), gainScen: expect.closeTo(gain, 9) });
    for (const [id, v] of Object.entries(t1.players)) {
      expect(v.mvLoseEv, id).toBeGreaterThanOrEqual(0);
      expect(v.mvLoseScen as number, id).toBeGreaterThanOrEqual(0);
      expect(v.mvLoseEv - (raw[id]?.ev as number), id).toBeCloseTo(gain, 9); // one constant for the whole team
      expect((v.mvLoseScen as number) - (raw[id]?.scen as number), id).toBeCloseTo(gain, 9);
      expect(v.autoAdd, id).toBe(raw[id]?.autoAdd);
    }
    for (const id of ["1-k", ...bench.map((b) => b.id)]) expect(t1.players[id]?.mvLoseEv, id).toBeCloseTo(0, 9);
    expect(t1.players["1-qb"]?.mvLoseEv).toBeCloseTo((20 - 12) * OMEGA, 9); // his 12-point backup starts
    expect(t1.players["1-def"]?.mvLoseEv).toBeCloseTo(7 * OMEGA, 9); // no backup D/ST
    // The shift leaves the surplus score (z-scores within the roster) unchanged.
    const ids = Object.keys(t1.players);
    const expected = surplusScores(
      ids.map((id) => model.players[id]?.value?.value ?? 0),
      ids.map((id) => raw[id]?.scen ?? (raw[id]?.ev as number)),
    );
    ids.forEach((id, i) => expect(t1.players[id]?.surplusScore, id).toBeCloseTo(expected[i] as number, 9));
  });

  it("an open active-roster spot: the team adds the free agent without dropping anyone", () => {
    // Teams 2–4 (9 of 16 players) have room too: the same K goes into their open spot.
    const model = buildLeagueModel(kLeague.snapshot, kLeague.inputs, OPTS, NO_RISK);
    for (const id of ["2", "3", "4"]) {
      const t = teamOf(model, id);
      expect(t.waiver, id).toEqual({ add: "fa-k", drop: null, gainEv: expect.closeTo(4 * OMEGA, 9), gainScen: expect.closeTo(4 * OMEGA, 9) });
      expect(t.players[`${id}-k`]?.mvLoseEv).toBeCloseTo(0, 9); // he'd be replaced anyway
      expect(t.players[`${id}-qb`]?.mvLoseEv).toBeCloseTo(20 * OMEGA, 9); // no backup: his whole 20 a week
    }
    // A team without a TE: a 6-point free-agent TE fills the empty spot (and starts nowhere else: TEs of 10, a FLEX of 11).
    const noTe = buildTestLeague({ teams: [team("1", starters("1").filter((x) => x.pos !== "TE")), team("2", starters("2")), team("3", starters("3"))], freeAgents: [p("fa-te", "TE", 6)] });
    const m2 = buildLeagueModel(noTe.snapshot, noTe.inputs, OPTS, NO_RISK);
    const t1 = teamOf(m2, "1");
    expect(t1.waiver).toEqual({ add: "fa-te", drop: null, gainEv: expect.closeTo(6 * OMEGA, 9), gainScen: expect.closeTo(6 * OMEGA, 9) });
    expect(teamOf(m2, "2").waiver).toBeNull();
    expect(teamOf(m2, "3").waiver).toBeNull();
    const raw = rawCosts(noTe, m2, "1", OPTS, NO_RISK);
    // Losing the K: §7 as written nets the TE he'd add (8 − 6 a week); from the team that adds the TE anyway, it's the K's whole 8.
    expect(raw["1-k"]?.ev).toBeCloseTo(2 * OMEGA, 9);
    expect(t1.players["1-k"]?.mvLoseEv).toBeCloseTo(8 * OMEGA, 9);
    for (const [id, v] of Object.entries(t1.players)) expect(v.mvLoseEv - (raw[id]?.ev as number), id).toBeCloseTo(6 * OMEGA, 9);
  });

  it("scenario mode (injury risk on): no cost below 0, one constant per team in each mode, and the waiver's scenario gain is its own roster's", () => {
    const opts = { now: TEST_NOW, scenarios: 32 };
    const model = buildLeagueModel(kLeague.snapshot, kLeague.inputs, opts);
    const { table } = buildProjectionTable(kLeague.snapshot, kLeague.inputs, opts);
    const slots = prepareLeagueSlots(kLeague.snapshot.settings);
    const weights = weekWeights(model.weeks, model.regularWeeks, model.playoffWeeks);
    const scenRos = (roster: readonly string[]) => rosValue(scenarioLineups(roster, table, slots).lv, weights);
    for (const t of model.teams) {
      const raw = rawCosts(kLeague, model, t.id, opts);
      const players = Object.entries(t.players);
      const evShift = players.map(([id, v]) => v.mvLoseEv - (raw[id]?.ev as number));
      const scenShift = players.map(([id, v]) => (v.mvLoseScen as number) - (raw[id]?.scen as number));
      for (const [id, v] of players) {
        expect(v.mvLoseEv, `${t.id} ${id}`).toBeGreaterThanOrEqual(0);
        expect(v.mvLoseScen as number, `${t.id} ${id}`).toBeGreaterThanOrEqual(0);
      }
      for (const s of evShift) expect(s, `team ${t.id}`).toBeCloseTo(evShift[0] as number, 9);
      for (const s of scenShift) expect(s, `team ${t.id}`).toBeCloseTo(scenShift[0] as number, 9);
      // Every team's best move adds the free-agent K (EV); the scenario shift is the best scenario ROS one move away, at least that move's.
      const w = t.waiver;
      expect(w?.add, `team ${t.id}`).toBe("fa-k");
      expect(evShift[0]).toBeCloseTo(w?.gainEv as number, 9);
      const roster = kLeague.snapshot.teams.find((x) => x.id === t.id)?.roster ?? [];
      const after = [...roster.filter((id) => id !== w?.drop), "fa-k"];
      expect(w?.gainScen).toBeCloseTo(scenRos(after) - scenRos(roster), 9);
      expect(scenShift[0]).toBeGreaterThanOrEqual((w?.gainScen as number) - 1e-9);
      expect(t.scen?.ros).toBeCloseTo(scenRos(roster), 9);
    }
  });
});

describe("position limits in lineup costs and the waiver move (§7 roster legality: positionLimits on the active roster)", () => {
  /** Σ ω over weeks 4–17: 11 regular-season weeks and 3 playoff weeks at playoffWeight. */
  const OMEGA = 11 + 3 * config.lineups.playoffWeight;
  const OPTS = { now: TEST_NOW, scenarios: 8 };
  /** Seven bench players who never start: with the nine starters, a full 16-player active roster. */
  const bench = [p("1-qb2", "QB", 12), p("1-rb3", "RB", 6), p("1-rb4", "RB", 5), p("1-rb5", "RB", 3), p("1-wr4", "WR", 7), p("1-wr5", "WR", 6), p("1-te2", "TE", 4)];
  const others = [team("2", starters("2")), team("3", starters("3")), team("4", starters("4"))];
  const build = (spec: Pick<TestLeagueSpec, "positionLimits" | "freeAgents"> & { roster: TestPlayer[] }) => {
    const league = buildTestLeague({ ...(spec.positionLimits ? { positionLimits: spec.positionLimits } : {}), freeAgents: spec.freeAgents ?? [], teams: [team("1", spec.roster), ...others] });
    return { league, model: buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK) };
  };

  it("losing a player frees his spot under the limit: losing the QB adds the free-agent QB (QB limit 2, full roster)", () => {
    const { league, model } = build({ positionLimits: { QB: 2 }, roster: [...starters("1"), ...bench], freeAgents: [p("fa-qb", "QB", 15)] });
    expect(league.snapshot.teams[0]?.roster).toHaveLength(16);
    const t1 = teamOf(model, "1");
    expect(t1.players["1-qb"]?.autoAdd).toBe("fa-qb");
    expect(t1.players["1-qb"]?.mvLoseEv).toBeCloseTo((20 - 15) * OMEGA, 9); // the free agent, not the 12-point backup, replaces him
    expect(t1.players["1-rb5"]?.autoAdd).toBeNull(); // two QBs stay: the limit blocks a third
    expect(t1.waiver).toBeNull(); // no open spot, and the free-agent QB beats no starter
    // The model's costs are §7's (teamValue.mvLose with the same limits and roster positions), shifted by one constant.
    const raw = rawCosts(league, model, "1", OPTS, NO_RISK);
    for (const [id, v] of Object.entries(t1.players)) {
      expect(v.autoAdd, id).toBe(raw[id]?.autoAdd);
      expect(v.mvLoseEv - (raw[id]?.ev as number), id).toBeCloseTo(0, 9);
    }
  });

  it("a limit already reached blocks the free agent at that position, except for the player whose loss frees the spot (TE limit 2, full roster)", () => {
    const { model } = build({ positionLimits: { TE: 2 }, roster: [...starters("1"), ...bench], freeAgents: [p("fa-te", "TE", 12)] });
    const t1 = teamOf(model, "1");
    expect(t1.players["1-rb5"]?.autoAdd).toBeNull();
    expect(t1.players["1-te2"]?.autoAdd).toBe("fa-te");
    // The best move swaps a TE for the 12-point free agent (+2 a week); losing the bench RB instead leaves the TE where he is.
    expect(t1.waiver).toMatchObject({ add: "fa-te", gainEv: expect.closeTo(2 * OMEGA, 9) });
    expect(["1-te", "1-te2"]).toContain(t1.waiver?.drop);
    expect(t1.players["1-rb5"]?.mvLoseEv).toBeCloseTo(2 * OMEGA, 9);
  });

  it("an open spot doesn't get around a limit already reached: the move drops a TE (TE limit 2, 15 players)", () => {
    const { league, model } = build({ positionLimits: { TE: 2 }, roster: [...starters("1"), ...bench.filter((x) => x.id !== "1-rb5")], freeAgents: [p("fa-te", "TE", 12)] });
    expect(league.snapshot.teams[0]?.roster).toHaveLength(15);
    const t1 = teamOf(model, "1");
    expect(t1.waiver?.add).toBe("fa-te");
    expect(["1-te", "1-te2"]).toContain(t1.waiver?.drop);
  });

  it("a player without projections still counts toward a limit (and takes a roster spot), but is never the one dropped", () => {
    // 15 players; the two TEs are the 10-point starter and one without inputs: the open spot can't take the free-agent TE.
    const ghostTe = build({ positionLimits: { TE: 2 }, roster: [...starters("1"), ...bench.filter((x) => x.id !== "1-rb5" && x.id !== "1-te2"), p("1-ghost-te", "TE", 9, { noInputs: true })], freeAgents: [p("fa-te", "TE", 12)] });
    expect(ghostTe.league.snapshot.teams[0]?.roster).toHaveLength(15);
    expect(teamOf(ghostTe.model, "1").waiver).toMatchObject({ add: "fa-te", drop: "1-te", gainEv: expect.closeTo(2 * OMEGA, 9) });
    // 16 players, one without inputs: the roster is full, so the better free-agent K comes in for someone.
    const full = build({ roster: [...starters("1"), ...bench.filter((x) => x.id !== "1-rb5"), p("1-ghost", "RB", 9, { noInputs: true })], freeAgents: [p("fa-k", "K", 12)] });
    expect(full.league.snapshot.teams[0]?.roster).toHaveLength(16);
    const w = teamOf(full.model, "1").waiver;
    expect(w).toMatchObject({ add: "fa-k", gainEv: expect.closeTo(4 * OMEGA, 9) });
    expect(w?.drop).not.toBeNull();
    expect(w?.drop).not.toBe("1-ghost");
  });
});

describe("needs (§7: slots with z ≤ needZThreshold across teams)", () => {
  it("a team without a TE shows a TE need for the rest of the season", () => {
    const league = buildTestLeague({ teams: [team("1", starters("1")), team("2", starters("2").filter((x) => x.pos !== "TE")), team("3", starters("3")), team("4", starters("4"))] });
    const model = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 }, NO_RISK);
    const t2 = teamOf(model, "2");
    expect(t2.needs[0]).toMatchObject({ slot: "TE1", window: "ros" });
    expect(t2.strength.TE1?.ros).toBe(0);
    expect(t2.strength.TE1?.zRos).toBeLessThanOrEqual(config.lineups.needZThreshold);
    expect(teamOf(model, "1").needs).toEqual([]);
    expect(model.slots.map((s) => s.key)).toEqual(["QB1", "RB1", "RB2", "WR1", "WR2", "TE1", "FLEX1", "K1", "DEF1"]);
  });

  it("a good starter out for the next weeks is a 'next' need only", () => {
    // QBs of 18, 24 (out, back around week 7), 14 and 22: team 2 is average for the rest of the season, weakest over the next 4 weeks.
    const qb = (t: string, points: number, extra: Partial<TestPlayer> = {}) => starters(t).map((x) => (x.pos === "QB" ? { ...x, points, ...extra } : x));
    const league = buildTestLeague({ teams: [team("1", qb("1", 18)), team("2", qb("2", 24, { injury: "OUT", injuryReturnWeek: 7 })), team("3", qb("3", 14)), team("4", qb("4", 22))] });
    const model = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 }, NO_RISK);
    const t2 = teamOf(model, "2");
    expect(t2.needs.find((n) => n.slot === "QB1")).toMatchObject({ window: "next" });
    expect(t2.strength.QB1?.zRos).toBeGreaterThan(config.lineups.needZThreshold);
    expect(teamOf(model, "3").needs.find((n) => n.slot === "QB1")).toMatchObject({ window: "ros" });
  });
});

describe("game days (Phase 2 review decisions): once a current-week game has kicked off, every team-level number skips that week", () => {
  const EARLY = "2026-09-29T17:00:00.000Z"; // before TEST_NOW (20:00Z)
  const LATE = "2026-09-30T00:15:00.000Z"; // after it
  const BEFORE = new Date("2026-09-29T12:00:00.000Z"); // before both
  const pw = config.lineups.playoffWeight;
  /** Σ ω over weeks 5–17 (the week in progress skipped) and over weeks 4–17. */
  const OMEGA_AFTER = 10 + 3 * pw;
  const OMEGA_ALL = 11 + 3 * pw;
  const SUFFIXES = ["qb", "rb1", "rb2", "wr1", "wr2", "te", "flex", "k", "def", "qb2", "te2"];
  // Four identical teams: the nine starters (112 points a week), a 12-point backup QB and a 6-point bench TE. Team 1's
  // players play for an NFL team whose week-4 game kicked off before now; everyone else, and a 12-point free-agent K, tonight.
  const roster = (t: string, nflTeam: string): TestPlayer[] =>
    [...starters(t), p(`${t}-qb2`, "QB", 12, { value: 800 }), p(`${t}-te2`, "TE", 6, { value: 300 })].map((x, i) => ({
      ...x,
      nflTeam,
      ...(x.value === undefined && x.pos !== "K" && x.pos !== "DEF" ? { value: 3000 - 100 * i } : {}),
    }));
  const league = buildTestLeague({
    teams: [team("1", roster("1", "EAR")), team("2", roster("2", "LAT")), team("3", roster("3", "LAT")), team("4", roster("4", "LAT"))],
    freeAgents: [p("fa-k", "K", 12, { nflTeam: "LAT" })],
    kickoffs: { 4: { EAR: EARLY, LAT: LATE } },
  });
  const OPTS = { now: TEST_NOW, scenarios: 8 };

  it("identical teams get identical strength, needs, PPW, ROS, lineup costs, 'would start for' and waiver moves, whoever has played", () => {
    const model = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);
    expect(model.inProgressWeek).toBe(4);
    const one = teamOf(model, "1");
    for (const id of ["2", "3", "4"]) {
      const t = teamOf(model, id);
      expect(t.strength, `team ${id}`).toEqual(one.strength);
      expect(t.needs, `team ${id}`).toEqual([]);
      expect(t.ev.ppw, `team ${id}`).toBeCloseTo(one.ev.ppw, 9);
      expect(t.scen?.ppw, `team ${id}`).toBeCloseTo(one.scen?.ppw as number, 9);
      expect(t.ev.ros, `team ${id}`).toBeCloseTo(one.ev.ros, 9);
      expect(t.scen?.ros, `team ${id}`).toBeCloseTo(one.scen?.ros as number, 9);
      expect(t.waiver, `team ${id}`).toEqual(one.waiver);
      expect(t.surplus.map((s) => s.playerId.slice(2)), `team ${id}`).toEqual(one.surplus.map((s) => s.playerId.slice(2)));
      for (const s of SUFFIXES) {
        const a = one.players[`1-${s}`] as NonNullable<TeamModel["players"][string]>;
        const b = t.players[`${id}-${s}`] as NonNullable<TeamModel["players"][string]>;
        expect(b.mvLoseEv, `${id}-${s}`).toBeCloseTo(a.mvLoseEv, 9);
        expect(b.mvLoseScen as number, `${id}-${s}`).toBeCloseTo(a.mvLoseScen as number, 9);
        expect(b.autoAdd, `${id}-${s}`).toBe(a.autoAdd);
        expect(b.startsFor, `${id}-${s}`).toBe(a.startsFor);
        expect(b.surplusScore, `${id}-${s}`).toBeCloseTo(a.surplusScore, 9);
      }
    }
    // The numbers themselves: weeks 5–17 only.
    expect(one.ev.ros).toBeCloseTo(112 * OMEGA_AFTER, 9);
    expect(one.ev.ppw).toBeCloseTo(112, 9);
    expect(one.players["1-qb"]?.mvLoseEv).toBeCloseTo((20 - 12) * OMEGA_AFTER, 9); // his backup starts
    expect(one.players["1-rb1"]?.startsFor).toBe(3); // he'd displace every other team's 11-point FLEX
    // Team 2's bench TE would start for team 1 only in week 4 (team 1's TE has played): the skipped week.
    expect(teamOf(model, "2").players["2-te2"]?.startsFor).toBe(0);
    expect(one.waiver).toEqual({ add: "fa-k", drop: null, gainEv: expect.closeTo(4 * OMEGA_AFTER, 9), gainScen: expect.closeTo(4 * OMEGA_AFTER, 9) });
    // Week 4 is still reported, a partial week: team 1's players have all played, team 2's haven't.
    expect(one.ev.lv[0]).toBe(0);
    expect(teamOf(model, "2").ev.lv[0]).toBe(112);
    // Players' own numbers count only the games that haven't started.
    expect(model.players["1-qb"]?.ros.total).toBeCloseTo(20 * 13, 9);
    expect(model.players["2-qb"]?.ros.total).toBeCloseTo(20 * 14, 9);
  });

  it("before any kickoff there is no week in progress and week 4 counts like any other", () => {
    const model = buildLeagueModel(league.snapshot, league.inputs, { ...OPTS, now: BEFORE }, NO_RISK);
    expect(model.inProgressWeek).toBeNull();
    for (const t of model.teams) {
      expect(t.ev.lv[0], `team ${t.id}`).toBe(112);
      expect(t.ev.ros, `team ${t.id}`).toBeCloseTo(112 * OMEGA_ALL, 9);
      expect(t.ev.ppw, `team ${t.id}`).toBeCloseTo(112, 9);
      expect(t.needs, `team ${t.id}`).toEqual([]);
      expect(t.players[`${t.id}-qb`]?.mvLoseEv, `team ${t.id}`).toBeCloseTo((20 - 12) * OMEGA_ALL, 9);
      expect(t.waiver?.gainEv, `team ${t.id}`).toBeCloseTo(4 * OMEGA_ALL, 9);
    }
  });

  it("counting the week in progress would rank teams by kickoff times (what the skip removes)", () => {
    // Week 4 counted at its partial value: team 1 (played) would trail its identical rivals by a whole week of points.
    const model = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);
    const all = teamWeeks(model, null);
    const one = teamOf(model, "1");
    const two = teamOf(model, "2");
    expect(rosValue(one.ev.lv, all.weights)).toBeCloseTo(112 * OMEGA_AFTER, 9);
    expect(rosValue(two.ev.lv, all.weights)).toBeCloseTo(112 * OMEGA_ALL, 9);
    expect(ppw(one.ev.lv, model.weeks, model.regularWeeks)).toBeCloseTo((112 * 10) / 11, 9);
    expect(ppw(two.ev.lv, model.weeks, model.regularWeeks)).toBeCloseTo(112, 9);
  });

  it("partner fit skips the week in progress: a spare RB adds to my lineup only what he'd add in the weeks left", () => {
    // Me (team 1): every player has played this week. Team 2 plays tonight and has a spare 13-point RB (its FLEX scores 13.2).
    const fit = buildTestLeague({
      teams: [team("1", starters("1").map((x) => ({ ...x, nflTeam: "EAR" }))), team("2", [...starters("2", 1.2), p("2-rb3", "RB", 13, { value: 9000 })].map((x) => ({ ...x, nflTeam: "LAT" })))],
      kickoffs: { 4: { EAR: EARLY, LAT: LATE } },
    });
    const model = buildLeagueModel(fit.snapshot, fit.inputs, OPTS, NO_RISK);
    expect(teamOf(model, "2").surplus.map((s) => s.playerId)).toEqual(["2-rb3"]);
    // He'd replace my 11-point FLEX: +2 a week in weeks 5–17. Counting week 4, when my lineup has played, would add his whole 13.
    expect(model.partners).toEqual([{ teamId: "2", mutual: false, score: expect.closeTo(2, 9), theyCanGive: [{ playerId: "2-rb3", ppw: expect.closeTo(2, 9) }], youCanGive: [] }]);
  });

  it("the last regular-season week in progress leaves PPW nothing to average (0), and the strength windows start at the playoffs", () => {
    const late = buildTestLeague({
      currentWeek: 14,
      teams: [team("1", roster("1", "EAR")), team("2", roster("2", "LAT"))],
      kickoffs: { 14: { EAR: "2026-12-10T01:15:00.000Z", LAT: "2026-12-13T18:00:00.000Z" } },
    });
    const model = buildLeagueModel(late.snapshot, late.inputs, { now: new Date("2026-12-11T12:00:00.000Z"), scenarios: 0 }, NO_RISK);
    expect(model.inProgressWeek).toBe(14);
    expect(model.regularWeeks).toEqual([14]);
    for (const t of model.teams) {
      expect(t.ev.ppw, `team ${t.id}`).toBe(0);
      expect(t.ev.ros, `team ${t.id}`).toBeCloseTo(112 * 3 * pw, 9);
      expect(t.strength.QB1?.next, `team ${t.id}`).toBeCloseTo(20, 9); // weeks 15–17
      expect(t.needs, `team ${t.id}`).toEqual([]);
    }
  });
});

describe("surplus (§7: high value, low MV_lose, and he would start for another team)", () => {
  /** Team 1 has a valuable backup QB (22 points, value 9000) behind a 25-point starter. */
  const withBackupQb = (otherQb: number) =>
    buildTestLeague({
      teams: [
        team("1", [...starters("1").map((x) => (x.pos === "QB" ? { ...x, points: 25, value: 9500 } : { ...x, value: x.pos === "K" || x.pos === "DEF" ? undefined : 3000 })), p("1-qb2", "QB", 22, { value: 9000 })]),
        team("2", starters("2").map((x) => (x.pos === "QB" ? { ...x, points: otherQb } : x))),
        team("3", starters("3").map((x) => (x.pos === "QB" ? { ...x, points: 26 } : x))),
        team("4", starters("4").map((x) => (x.pos === "QB" ? { ...x, points: 27 } : x))),
      ],
    });

  it("a valuable backup who would start for another team is surplus", () => {
    const { snapshot, inputs } = withBackupQb(10);
    const model = buildLeagueModel(snapshot, inputs, { now: TEST_NOW, scenarios: 8 }, NO_RISK);
    const t1 = teamOf(model, "1");
    expect(t1.players["1-qb2"]?.mvLoseEv).toBeCloseTo(0, 9);
    expect(t1.players["1-qb2"]?.startsFor).toBe(1); // team 2's 10-point QB
    expect(t1.players["1-qb2"]?.surplusScore).toBeGreaterThanOrEqual(config.needs.surplusMinScore);
    expect(t1.surplus.map((s) => s.playerId)).toContain("1-qb2");
  });

  it("the same backup is not surplus when he would start for nobody", () => {
    const { snapshot, inputs } = withBackupQb(24);
    const model = buildLeagueModel(snapshot, inputs, { now: TEST_NOW, scenarios: 8 }, NO_RISK);
    const t1 = teamOf(model, "1");
    expect(t1.players["1-qb2"]?.startsFor).toBe(0);
    expect(t1.players["1-qb2"]?.surplusScore).toBeGreaterThanOrEqual(config.needs.surplusMinScore);
    expect(t1.surplus.map((s) => s.playerId)).not.toContain("1-qb2");
  });

  it("a star is not surplus even when his convex market value gives him the score: his lineup cost is above the roster's average", () => {
    // Team 1: a 25-point WR worth 30,000 (FantasyCalc values are convex), 3,000-value starters, a 9-point bench WR who covers
    // the FLEX, and a valuable backup QB behind a 25-point starter. Team 2's QB scores 10: both of team 1's QBs would start there.
    const t1Roster = [
      ...starters("1").map((x) =>
        x.pos === "QB" ? { ...x, points: 25, value: 9500 } : x.id === "1-wr1" ? { ...x, points: 25, value: 30_000 } : x.pos === "K" || x.pos === "DEF" ? x : { ...x, value: 3000 },
      ),
      p("1-qb2", "QB", 22, { value: 9000 }),
      p("1-wr9", "WR", 9, { value: 1000 }),
    ];
    const league = buildTestLeague({
      teams: [team("1", t1Roster), team("2", starters("2").map((x) => (x.pos === "QB" ? { ...x, points: 10 } : x))), team("3", starters("3")), team("4", starters("4"))],
    });
    const model = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 }, NO_RISK);
    const t1 = teamOf(model, "1");
    const star = t1.players["1-wr1"];
    expect(star?.startsFor).toBeGreaterThanOrEqual(1);
    expect(star?.surplusScore).toBeGreaterThanOrEqual(config.needs.surplusMinScore); // the old rule made him a chip
    const ids = Object.keys(t1.players);
    const costZ = standardize(ids.map((id) => t1.players[id]?.mvLoseScen as number));
    expect(costZ[ids.indexOf("1-wr1")]).toBeGreaterThan(config.needs.surplusMaxCostZ);
    expect(t1.surplus.map((s) => s.playerId)).not.toContain("1-wr1");
    expect(t1.surplus.map((s) => s.playerId)).toContain("1-qb2"); // depth that would start elsewhere still is
  });

  it("with scenarios (injury risk on), surplus scores and the cost cut use scenario lineup costs: a depth RB who fills in for hurt stars isn't surplus", () => {
    // Team 1: two star RBs and a 10-point depth RB (value 2,200) who never starts in the expected-value lineup, and a
    // 16-point backup QB (value 4,000). Team 2's QB and RBs are weak, so both backups would start there.
    const valued = (t: string) => starters(t).map((x, i) => (x.pos === "K" || x.pos === "DEF" ? x : { ...x, value: 3000 - 100 * i }));
    const t1Roster = [
      ...valued("1").filter((x) => x.id !== "1-rb1" && x.id !== "1-rb2" && x.id !== "1-flex"),
      p("1-starA", "RB", 20, { value: 6000 }),
      p("1-starB", "RB", 18, { value: 5500 }),
      p("1-wr3", "WR", 13, { value: 2500 }),
      p("1-depth", "RB", 10, { value: 2200 }),
      p("1-qb2", "QB", 16, { value: 4000 }),
    ];
    const league = buildTestLeague({
      teams: [team("1", t1Roster), team("2", starters("2").map((x) => (x.pos === "QB" ? { ...x, points: 12 } : x.pos === "RB" ? { ...x, points: 8 } : x))), team("3", starters("3")), team("4", starters("4"))],
    });
    // The default config: future injury risk on (a fixed seed, so the test doesn't move with config.lineups.scenarioSeed).
    const model = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 32, seed: 3 });
    const t1 = teamOf(model, "1");
    const ids = Object.keys(t1.players);
    const values = ids.map((id) => model.players[id]?.value?.value ?? 0);
    const scen = ids.map((id) => t1.players[id]?.mvLoseScen as number);
    const ev = ids.map((id) => t1.players[id]?.mvLoseEv as number);
    const byScen = surplusScores(values, scen);
    ids.forEach((id, i) => expect(t1.players[id]?.surplusScore, id).toBeCloseTo(byScen[i] as number, 9));
    // The two rules really differ here: the depth RB costs nothing in expected-value lineups but starts whenever a star is hurt.
    const depth = ids.indexOf("1-depth");
    expect(ev[depth]).toBeCloseTo(0, 9);
    expect(scen[depth]).toBeGreaterThan(20);
    const byEv = surplusScores(values, ev);
    expect(Math.abs((byEv[depth] as number) - (byScen[depth] as number))).toBeGreaterThan(0.1);
    // Membership follows the scenario costs, the cost cut (z of the lineup cost within the roster) included.
    const rule = (scores: number[], costs: number[]) =>
      qualifyingSurplus(
        ids.map((id, i) => ({ playerId: id, score: scores[i] as number, costZ: standardize(costs)[i] as number, startsFor: t1.players[id]?.startsFor as number })),
        config.needs,
      ).map((s) => s.playerId);
    expect(rule(byEv, ev)).toContain("1-depth"); // expected-value costs would call him surplus
    expect(rule(byScen, scen)).not.toContain("1-depth");
    expect(t1.surplus.map((s) => s.playerId)).toEqual(rule(byScen, scen).slice(0, config.needs.surplusShown));
    expect(t1.surplus.map((s) => s.playerId)).toContain("1-qb2");
  });
});

describe("best trade partners (§7: their surplus fits my needs AND mine fits theirs)", () => {
  // No FLEX and no spare starters, so every bench player is obvious. Me (team 1): a valuable backup QB, weak WRs.
  // Team 2: a valuable bench WR and a weak QB → mutual. Team 3: a bench WR too but a strong QB → one-sided.
  // Team 4: a weak QB and nothing to spare → one-sided the other way.
  const lineup: SlotDef[] = [
    { slot: "QB", count: 1, eligible: ["QB"] },
    { slot: "RB", count: 2, eligible: ["RB"] },
    { slot: "WR", count: 2, eligible: ["WR"] },
    { slot: "TE", count: 1, eligible: ["TE"] },
    { slot: "K", count: 1, eligible: ["K"] },
    { slot: "DEF", count: 1, eligible: ["DEF"] },
  ];
  const core = (t: string, qb: number, wr: [number, number]) =>
    starters(t)
      .filter((x) => x.id !== `${t}-flex`)
      .map((x) => (x.pos === "QB" ? { ...x, points: qb } : x.pos === "WR" ? { ...x, points: x.id.endsWith("wr1") ? wr[0] : wr[1] } : x));
  const spec: TestLeagueSpec = {
    lineup,
    teams: [
      team("1", [...core("1", 25, [8, 7]).map((x) => (x.pos === "QB" ? { ...x, value: 9500 } : x)), p("1-qb2", "QB", 22, { value: 9000 })]),
      team("2", [...core("2", 10, [22, 21]), p("2-wr3", "WR", 19, { value: 8000 })]),
      team("3", [...core("3", 26, [22, 21]), p("3-wr3", "WR", 19, { value: 8000 })]),
      team("4", core("4", 9, [15, 13])),
    ],
  };
  const league = buildTestLeague(spec);
  const model = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 }, NO_RISK);

  it("lists mutual fits first, then one-sided ones, with what each side's surplus adds to the other lineup", () => {
    expect(model.myTeamId).toBe("1");
    expect(teamOf(model, "3").surplus.map((s) => s.playerId)).toEqual(["3-wr3"]); // surplus, but my backup QB can't help them
    // Team 3 could help me but I can't help them: listed after the mutual fit. Team 4 needs my QB but has nothing for me: dropped.
    expect(model.partners.map((x) => [x.teamId, x.mutual])).toEqual([
      ["2", true],
      ["3", false],
    ]);
    expect(model.partners[1]?.theyCanGive).toEqual([{ playerId: "3-wr3", ppw: 19 - 7 }]);
    expect(model.partners[1]?.youCanGive).toEqual([]);
    const two = model.partners[0];
    expect(two?.theyCanGive).toEqual([{ playerId: "2-wr3", ppw: 19 - 7 }]); // he replaces my 7-point WR
    // Either of my QBs is surplus (each covers the other): each alone would replace their 10-point QB.
    expect(two?.youCanGive.map((x) => x.playerId)).toEqual(["1-qb", "1-qb2"]);
    expect(two?.youCanGive[0]?.ppw).toBeCloseTo(25 - 10, 9);
    expect(two?.youCanGive[1]?.ppw).toBeCloseTo(22 - 10, 9);
    // They can start only one QB: together my two add 15 a week (the better one), not 15 + 12 (Phase 2 review: joint gain).
    expect(two?.score).toBeCloseTo(Math.sqrt(12 * 15), 9);
  });

  it("scores each side by its joint gain: two spare RBs who compete for my one weak RB spot don't outrank one better RB", () => {
    // Me (team 1): my RB2 scores 5. Team 2 has one spare 13-point RB; team 3 has two spare 11-point RBs. Nobody needs my players.
    const base = (t: string, rb: [number, number]) => core(t, 20, [15, 13]).map((x) => (x.id === `${t}-rb1` ? { ...x, points: rb[0] } : x.id === `${t}-rb2` ? { ...x, points: rb[1] } : x));
    const rbs = buildTestLeague({
      lineup,
      teams: [
        team("1", base("1", [15, 5])),
        team("2", [...base("2", [15, 14]), p("2-rb3", "RB", 13, { value: 8000 })]),
        team("3", [...base("3", [15, 14]), p("3-rb3", "RB", 11, { value: 8000 }), p("3-rb4", "RB", 11, { value: 8000 })]),
        team("4", base("4", [8, 6])),
      ],
    });
    const opts = { now: TEST_NOW, scenarios: 8 };
    const m = buildLeagueModel(rbs.snapshot, rbs.inputs, opts, NO_RISK);
    expect(teamOf(m, "3").surplus.map((s) => s.playerId)).toEqual(["3-rb3", "3-rb4"]);
    expect(m.partners.map((x) => [x.teamId, x.mutual])).toEqual([
      ["2", false],
      ["3", false],
    ]);
    expect(m.partners[0]?.score).toBeCloseTo(13 - 5, 9);
    const three = m.partners[1];
    // Each alone would replace my 5-point RB2 (the card lists that), but there's one spot: together they add 6, not 12.
    expect(three?.theyCanGive.map((x) => x.playerId)).toEqual(["3-rb3", "3-rb4"]);
    for (const x of three?.theyCanGive ?? []) expect(x.ppw).toBeCloseTo(11 - 5, 9);
    expect(three?.score).toBeCloseTo(11 - 5, 9);
    const { table } = buildProjectionTable(rbs.snapshot, rbs.inputs, opts, NO_RISK);
    expect(mvAddGroupPpw(rbs.snapshot.teams[0]?.roster ?? [], ["3-rb3", "3-rb4"], table, prepareLeagueSlots(rbs.snapshot.settings))).toBeCloseTo(11 - 5, 9);
    // Team 4's players all sit at the value floor, so nothing tells them apart and it has no surplus, although lineup
    // cost alone would pick its 6-point RB2 (he'd start for me): that roster is no partner.
    const t4 = teamOf(m, "4");
    expect(t4.surplus).toEqual([]);
    const ids = Object.keys(t4.players);
    const costs = ids.map((id) => t4.players[id]?.mvLoseScen as number);
    const costOnly = qualifyingSurplus(
      ids.map((id, i) => ({ playerId: id, score: surplusScores(ids.map(() => 0), costs)[i] as number, costZ: standardize(costs)[i] as number, startsFor: t4.players[id]?.startsFor as number })),
      config.needs,
    );
    expect(costOnly.map((s) => s.playerId)).toEqual(["4-rb2"]);
  });

  it("without trade values (FantasyCalc down) picks no surplus by lineup cost alone: no surplus, no partners, one warning", () => {
    const down = buildTestLeague({ ...spec, market: false });
    const m = buildLeagueModel(down.snapshot, down.inputs, { now: TEST_NOW, scenarios: 8 }, NO_RISK);
    expect(m.market.format).toBeNull();
    for (const t of m.teams) expect(t.surplus, `team ${t.id}`).toEqual([]);
    expect(m.partners).toEqual([]);
    expect(m.warnings.filter((w) => w === NO_TRADE_VALUES_WARNING)).toHaveLength(1);
    expect(model.warnings).not.toContain(NO_TRADE_VALUES_WARNING);
    // Lineup costs and "would start for" are still there, and lineup cost alone would have picked my backup QB.
    const t1 = teamOf(m, "1");
    expect(t1.players["1-qb2"]).toMatchObject({ mvLoseEv: expect.closeTo(0, 9), startsFor: 2 });
    const ids = Object.keys(t1.players);
    const costs = ids.map((id) => t1.players[id]?.mvLoseScen as number);
    const costOnly = qualifyingSurplus(
      ids.map((id, i) => ({ playerId: id, score: surplusScores(ids.map(() => 0), costs)[i] as number, costZ: standardize(costs)[i] as number, startsFor: t1.players[id]?.startsFor as number })),
      config.needs,
    );
    expect(costOnly.map((s) => s.playerId)).toContain("1-qb2");
    // The season over: nothing to pick, so no warning.
    const over = buildTestLeague({ ...spec, market: false, currentWeek: 18 });
    expect(buildLeagueModel(over.snapshot, over.inputs, { now: TEST_NOW, scenarios: 0 }, NO_RISK).warnings).toEqual([]);
  });

  it("has no partners without my team", () => {
    const none = buildLeagueModel({ ...league.snapshot, myTeamId: null }, league.inputs, { now: TEST_NOW, scenarios: 0 }, NO_RISK);
    expect(none.partners).toEqual([]);
    expect(none.myTeamId).toBeNull();
    const unknown = buildLeagueModel({ ...league.snapshot, myTeamId: "99" }, league.inputs, { now: TEST_NOW, scenarios: 0 }, NO_RISK);
    expect(unknown.myTeamId).toBeNull();
    expect(unknown.partners).toEqual([]);
  });
});

describe("determinism and common random numbers (§0.10; addition C)", () => {
  const league = randomLeague({ teams: 6, seed: 42, freeAgentsPerPosition: 8 });

  it("the same seed gives the identical model; another seed changes only the scenario numbers", () => {
    const a = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 16, seed: 1 });
    const b = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 16, seed: 1 });
    expect(b).toEqual(a);
    const c = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 16, seed: 2 });
    expect(c.teams.map((t) => t.ev)).toEqual(a.teams.map((t) => t.ev));
    expect(c.teams.map((t) => t.scen?.lv)).not.toEqual(a.teams.map((t) => t.scen?.lv));
  });

  it("a player keeps his scenario draws when he changes teams, so a trade's before and after share them", () => {
    const before = league.snapshot;
    const [t1, t2] = before.teams;
    const moved = t1?.roster[1] as string;
    const after = {
      ...before,
      teams: before.teams.map((t) => (t.id === t1?.id ? { ...t, roster: t.roster.filter((id) => id !== moved) } : t.id === t2?.id ? { ...t, roster: [...t.roster, moved] } : t)),
    };
    const opts = { now: TEST_NOW, scenarios: 16, seed: 9 };
    const tb = buildProjectionTable(before, league.inputs, opts).table;
    const ta = buildProjectionTable(after, league.inputs, opts).table;
    expect(ta.rows.get(moved)?.flags).toEqual(tb.rows.get(moved)?.flags);
    // Team 2's scenario lineups after the trade, from the BEFORE table, equal the model built after it.
    const model = buildLeagueModel(after, league.inputs, opts);
    const slots = prepareLeagueSlots(after.settings);
    const fromBefore = scenarioLineups([...(t2?.roster ?? []), moved], tb, slots);
    teamOf(model, t2?.id as string).scen?.lv.forEach((v, w) => expect(v).toBeCloseTo(fromBefore.lv[w] as number, 9));
  });

  it("with nobody able to miss a game, scenario lineups equal expected-value lineups exactly", () => {
    const calm = randomLeague({ teams: 4, seed: 5, freeAgentsPerPosition: 4, injuries: false });
    const model = buildLeagueModel(calm.snapshot, calm.inputs, { now: TEST_NOW, scenarios: 8 }, NO_RISK);
    for (const t of model.teams) {
      t.ev.lv.forEach((v, w) => expect(t.scen?.lv[w]).toBeCloseTo(v, 9));
      expect(t.scen?.sd.every((x) => x < 1e-9)).toBe(true);
      for (const v of Object.values(t.players)) expect(v.mvLoseScen).toBeCloseTo(v.mvLoseEv, 9);
    }
  });

  it("with injury risk, the scenario mean stays close to the expected-value lineup week by week (S = 256)", () => {
    const model = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 256 });
    for (const t of model.teams) {
      expect((t.scen as NonNullable<TeamModel["scen"]>).ros).toBeGreaterThan(t.ev.ros);
      t.ev.lv.forEach((v, w) => expect(Math.abs((t.scen?.lv[w] as number) - v)).toBeLessThan(0.1 * v + 1));
    }
  });
});

describe("players, projections and warnings (§6; the League page's rosters)", () => {
  it("skips players without model inputs, counting them in a warning", () => {
    const league = buildTestLeague({ teams: [team("1", [...starters("1"), p("1-ghost", "RB", 9, { noInputs: true, name: "Casper Ghostly" })]), team("2", starters("2"))], freeAgents: [p("fa-ghost", "WR", 5, { noInputs: true })] });
    const model = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 4 });
    expect(model.players["1-ghost"]).toBeUndefined();
    expect(teamOf(model, "1").players["1-ghost"]).toBeUndefined();
    expect(model.warnings).toContain("No projections for 1 rostered player (Casper Ghostly), so they count as 0 points.");
    expect(model.warnings).toContain("No projections for 1 free agent, so they are left out.");
  });

  it("a game that has kicked off is no longer a game left for its players; team numbers skip the week in progress, so a starter's locked slot isn't refilled", () => {
    // The early QB (20) and the K (8) have played; the late QB (18) and a 7.5-point free-agent K play tonight.
    const league = buildTestLeague({
      teams: [team("1", [p("early", "QB", 20, { nflTeam: "KC" }), p("late", "QB", 18, { nflTeam: "BUF" }), p("k", "K", 8, { nflTeam: "KC" })])],
      freeAgents: [p("fa-k", "K", 7.5, { nflTeam: "BUF" })],
      kickoffs: { 4: { KC: "2026-09-29T17:00:00.000Z", BUF: "2026-09-30T00:15:00.000Z" } },
    });
    const omega = (weeksLeft: number) => weeksLeft + 3 * config.lineups.playoffWeight; // regular-season weeks counted + 3 playoff weeks
    const model = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 4 }, NO_RISK);
    expect(model.inProgressWeek).toBe(4);
    expect(model.players.early?.weekly[0]).toMatchObject({ a: 0, p: 0 });
    expect(model.players.late?.weekly[0]).toMatchObject({ a: 1, p: 18 });
    expect(model.players.early?.ros.gamesLeft).toBe((model.players.late?.ros.gamesLeft as number) - 1);
    expect(model.players.early?.ros.total).toBeCloseTo(20 * 13, 9); // weeks 5–17
    expect(model.players.late?.ros.total).toBeCloseTo(18 * 14, 9); // tonight's game still counts for him
    const t1 = teamOf(model, "1");
    // Week 4's LV is still reported, a partial week (the players whose games haven't started)…
    expect(t1.ev.lv).toHaveLength(model.weeks.length);
    expect(t1.ev.lv[0]).toBe(18);
    // …but team numbers skip it: ROS(T) and PPW count weeks 5–17 (the early QB and K start: 28 a week).
    expect(t1.ev.ros).toBeCloseTo(28 * omega(10), 9);
    expect(t1.ev.ppw).toBeCloseTo(28, 9);
    // The late QB can't take the early QB's locked slot: his lineup cost doesn't jump at kickoff, and the late
    // free-agent K doesn't "gain" this week in the early K's slot.
    expect(t1.players.late).toMatchObject({ mvLoseEv: expect.closeTo(0, 9), mvLoseScen: expect.closeTo(0, 9) });
    expect(t1.players.early?.mvLoseEv).toBeCloseTo((20 - 18) * omega(10), 9);
    expect(t1.waiver).toBeNull();
    // Before any kickoff the week counts like any other.
    const before = buildLeagueModel(league.snapshot, league.inputs, { now: new Date("2026-09-29T12:00:00.000Z"), scenarios: 4 }, NO_RISK);
    const b1 = teamOf(before, "1");
    expect(before.inProgressWeek).toBeNull();
    expect(b1.ev.lv[0]).toBe(28);
    expect(b1.ev.ros).toBeCloseTo(28 * omega(11), 9);
    expect(b1.players.late).toMatchObject({ mvLoseEv: expect.closeTo(0, 9), mvLoseScen: expect.closeTo(0, 9) });
    expect(b1.players.early?.mvLoseEv).toBeCloseTo((20 - 18) * omega(11), 9);
    expect(b1.waiver).toBeNull();
  });

  it("carries IR and taxi players in players (not in lineups), and the ROS split and byes (§6 step 7, addition A)", () => {
    const league = buildTestLeague({
      teams: [{ id: "1", roster: [p("qb", "QB", 20, { nflTeam: "KC" })], ir: [p("hurt", "RB", 15, { injury: "IR", injuryReturnWeek: 8 })], taxi: [p("kid", "WR", 6)] }],
      byeWeek: { KC: 10 },
    });
    const model = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 4 }, NO_RISK);
    expect(Object.keys(model.players).sort()).toEqual(["hurt", "kid", "qb"]);
    expect(Object.keys(teamOf(model, "1").players)).toEqual(["qb"]);
    const qb = model.players.qb;
    expect(qb?.ros.bye).toEqual({ status: "upcoming", week: 10 });
    expect(qb?.ros.total).toBeCloseTo(20 * 13, 9); // weeks 4–17 minus the bye
    expect(qb?.ros.regular).toBeCloseTo(20 * 10, 9);
    expect(qb?.ros.playoffs).toBeCloseTo(20 * 3, 9);
    expect(teamOf(model, "1").ev.ros).toBeCloseTo(20 * 10 + 20 * 3 * config.lineups.playoffWeight, 9);
    expect(teamOf(model, "1").ev.ppw).toBeCloseTo((20 * 10) / 11, 9);
    expect(model.players.hurt?.weekly.slice(0, 3).every((w) => w.a < 0.5)).toBe(true);
  });

  it("averages ESPN with Sleeper only when they agree (§6 step 1), and says so when they don't", () => {
    const close = (id: string, pts: number, espn: number) => p(id, "QB", pts, { espn: { 4: espn } });
    const agree = buildTestLeague({ platform: "espn", espnProjections: true, teams: [team("1", [close("a", 20, 21), close("b", 10, 10)])] });
    const m1 = buildLeagueModel(agree.snapshot, agree.inputs, { now: TEST_NOW, scenarios: 0 }, NO_RISK);
    expect(m1.projection.espnAveraged).toBe(true);
    expect(m1.projection.agreement).toEqual({ meanRelDiff: 1 / 30, players: 2, week: 4 });
    expect(m1.players.a?.base.source).toBe("espn+sleeper");
    expect(m1.projection.sources["espn+sleeper"]).toBe(2);
    const apart = buildTestLeague({ platform: "espn", espnProjections: true, teams: [team("1", [close("a", 20, 30), close("b", 10, 10)])] });
    const m2 = buildLeagueModel(apart.snapshot, apart.inputs, { now: TEST_NOW, scenarios: 0 }, NO_RISK);
    expect(m2.projection.espnAveraged).toBe(false);
    expect(m2.players.a?.base.source).toBe("sleeper");
    expect(m2.warnings.join(" ")).toMatch(/differ from Sleeper's by 33% on average/);
    // Sleeper leagues never compare.
    const sleeper = buildLeagueModel({ ...agree.snapshot, platform: "sleeper" }, agree.inputs, { now: TEST_NOW, scenarios: 0 }, NO_RISK);
    expect(sleeper.projection).toMatchObject({ espnAveraged: false, agreement: null, disagreements: [] });
  });

  it("words the ESPN/Sleeper note from what loaded: no comparison claimed without Sleeper's projections, and no note once the season is over", () => {
    const opts = { now: TEST_NOW, scenarios: 0 };
    // Sleeper projects nobody (stubs only: its projections didn't load, or nobody has a Sleeper id); ESPN projects everyone.
    const espnOnly = (id: string, pts: number) => p(id, "QB", 0, { espn: { 3: pts, 4: pts } });
    const missing = buildTestLeague({ platform: "espn", espnProjections: true, teams: [team("1", [espnOnly("a", 20), espnOnly("b", 12)])] });
    const m1 = buildLeagueModel(missing.snapshot, missing.inputs, opts, NO_RISK);
    expect(m1.projection.sources).toMatchObject({ espn: 2, sleeper: 0, "espn+sleeper": 0 });
    expect(m1.players.a?.base.b).toBe(20);
    expect(m1.warnings).toEqual(["Sleeper's projections are missing, so projections use ESPN's alone."]);
    // Both loaded, but ESPN projects only last week: nothing to compare this week.
    const past = buildTestLeague({ platform: "espn", espnProjections: true, teams: [team("1", [p("a", "QB", 20, { espn: { 3: 21 } }), p("b", "QB", 12, { espn: { 3: 12 } })])] });
    expect(buildLeagueModel(past.snapshot, past.inputs, opts, NO_RISK).warnings).toEqual(["ESPN's and Sleeper's projections couldn't be compared this week (no rostered player has both), so projections use Sleeper's alone."]);
    // They disagree, and the one player Sleeper doesn't project uses ESPN's.
    const mixed = buildTestLeague({ platform: "espn", espnProjections: true, teams: [team("1", [p("a", "QB", 20, { espn: { 4: 30 } }), p("b", "QB", 10, { espn: { 4: 10 } }), espnOnly("c", 9)])] });
    const m3 = buildLeagueModel(mixed.snapshot, mixed.inputs, opts, NO_RISK);
    expect(m3.projection.sources).toMatchObject({ espn: 1, sleeper: 2 });
    expect(m3.warnings).toEqual(["ESPN's projections differ from Sleeper's by 33% on average this week (more than 10%), so projections use Sleeper's alone (ESPN's for the 1 player Sleeper doesn't project)."]);
    // The season is over (ESPN's week-17 projections still come through): no week is left to project, so no note.
    const over = buildTestLeague({ platform: "espn", espnProjections: true, currentWeek: 18, teams: [team("1", [p("a", "QB", 20, { espn: { 17: 30 } }), espnOnly("b", 12)])] });
    const m4 = buildLeagueModel(over.snapshot, over.inputs, opts, NO_RISK);
    expect(m4.weeks).toEqual([]);
    expect(m4.warnings).toEqual([]);
  });

  it("a player ESPN says is out for the season (return week = the NFL's last week + 1) plays no week at all, week 18 included", () => {
    // A league whose playoffs run through NFL week 18; ESPN's out-for-season marker is week 19.
    const spec = { regularSeasonWeeks: range(1, 14), playoffWeeks: [15, 16, 17, 18], teams: [team("1", [p("qb", "QB", 20), p("gone", "RB", 15, { injury: "IR", injuryReturnWeek: 19 })])] };
    const known = buildTestLeague({ ...spec, nflLastWeek: 18 });
    expect(known.inputs.nfl.lastWeek).toBe(18);
    const model = buildLeagueModel(known.snapshot, known.inputs, { now: TEST_NOW, scenarios: 16 });
    expect(model.weeks.at(-1)).toBe(18);
    expect(model.players.gone?.weekly.every((w) => w.a === 0 && w.p === 0)).toBe(true);
    expect(model.players.gone?.ros.total).toBe(0);
    expect(teamOf(model, "1").players.gone).toMatchObject({ mvLoseEv: 0, mvLoseScen: 0 });
    // Without the NFL's last week, a return week spread over 18–20 left him a 25% chance in week 18.
    const noLast = buildTestLeague(spec);
    const unknown = buildLeagueModel(noLast.snapshot, noLast.inputs, { now: TEST_NOW, scenarios: 16 });
    expect(unknown.players.gone?.weekly.at(-1)?.a).toBeCloseTo(0.25, 12);
    expect(nflLastWeek({ byeWeek: {}, kickoffs: {}, lastWeek: 18 })).toBe(18);
    for (const bad of [0, 17.5, Number.NaN]) expect(nflLastWeek({ byeWeek: {}, kickoffs: {}, lastWeek: bad })).toBeUndefined();
    expect(nflLastWeek(undefined)).toBeUndefined();
  });

  it("warns when the inputs were built for another week", () => {
    const league = buildTestLeague({ teams: [team("1", starters("1"))], inputsWeek: 3 });
    expect(buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 0 }).warnings[0]).toMatch(/prepared for week 3, but the league is in week 4/);
  });
});

describe("market values in the model (§9)", () => {
  it("values every modeled player (FantasyCalc, estimates, floors), with the waiver credit from the best free agent", () => {
    const league = buildTestLeague({ teams: [team("1", starters("1").map((x, i) => (x.pos === "K" || x.pos === "DEF" ? x : { ...x, value: 1000 * (i + 1) })))], freeAgents: [p("fa-wr", "WR", 6, { value: 400 }), p("fa-k", "K", 7)], topValue: 10000 });
    const model = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 0 });
    expect(model.players["1-qb"]?.value).toEqual({ value: 1000, source: "fantasycalc" });
    expect(model.players["1-k"]?.value?.source).toBe("floor");
    expect(model.market.waiverCredit).toBe(400);
    expect(model.market.counts).toEqual({ fantasycalc: 8, estimate: 0, floor: 3, none: 0 });
    const down = buildTestLeague({ teams: [team("1", starters("1"))], market: false });
    const m2 = buildLeagueModel(down.snapshot, down.inputs, { now: TEST_NOW, scenarios: 0 });
    expect(m2.market).toMatchObject({ format: null, waiverCredit: 0, topValue: 0 });
    expect(m2.players["1-qb"]?.value).toBeNull();
  });
});

describe("edge cases", () => {
  it("a season with no weeks left gives a valid, empty model (no week in progress, even with week 18's games under way)", () => {
    const league = buildTestLeague({ currentWeek: 18, teams: [team("1", starters("1")), team("2", starters("2"))], freeAgents: [p("fa", "RB", 9)], kickoffs: { 18: { AAA: "2026-09-29T17:00:00.000Z" } } });
    const model = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW });
    expect(model.weeks).toEqual([]);
    expect(model.inProgressWeek).toBeNull();
    expect(model.teams[0]).toMatchObject({ ev: { lv: [], ros: 0, ppw: 0 }, scen: { lv: [], ros: 0, ppw: 0, sd: [] }, needs: [], surplus: [] });
    expect(model.players["1-qb"]?.weekly).toEqual([]);
    expect(model.partners).toEqual([]);
    expect(allFinite(model)).toEqual([]);
  });

  it("fills timings only when a clock is passed", () => {
    const league = buildTestLeague({ teams: [team("1", starters("1")), team("2", starters("2"))] });
    expect(buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 4 }).timings).toEqual({});
    let t = 0;
    const timings = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 4, clock: () => (t += 1) }).timings;
    expect(Object.keys(timings)).toEqual(["projections", "availability scenarios", "market values", "EV lineups and marginal values", "scenario lineups and marginal values", "needs, surplus and partners", "total"]);
    expect(timings.total).toBe(6);
  });

  it("scenarios: 0 skips scenario lineups (EV only)", () => {
    const league = buildTestLeague({ teams: [team("1", starters("1")), team("2", starters("2"))] });
    const model = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 0 });
    expect(model.scenarios).toBe(0);
    expect(model.teams.every((t) => t.scen === null && Object.values(t.players).every((v) => v.mvLoseScen === null))).toBe(true);
  });
});

describe("performance (§12 target: the engine runs in a browser Web Worker)", () => {
  it(`builds a 12-team league of 16-player rosters with ${config.lineups.scenarios} scenarios well within the budget`, { timeout: 60_000 }, () => {
    const league = randomLeague({ teams: 12, seed: 2026, freeAgentsPerPosition: 50 });
    const clock = () => performance.now();
    const ev = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 0, clock });
    const model = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 32, clock });
    const fmt = (t: Record<string, number>) => Object.entries(t).map(([k, v]) => `${k} ${v.toFixed(0)} ms`).join(", ");
    console.log(`[perf] 12 teams × 16, ${Object.keys(model.players).length} players, ${model.weeks.length} weeks. EV only: ${fmt(ev.timings)}. S = 32: ${fmt(model.timings)}`);
    expect(model.timings.total).toBeLessThan(5000);
    expect(allFinite(model)).toEqual([]);
  });
});

describe("Parker's league (committed sanitized ESPN fixture) with synthetic inputs: a smoke test", () => {
  const { snapshot } = normalizeEspnLeague(parkerBundle(), { leagueId: PARKER.leagueId, resolver: fakeResolver(), now: NOW, swid: PARKER.swid });
  const inputs = syntheticInputs(snapshot);
  const model = buildLeagueModel(snapshot, inputs, { now: NOW, clock: () => performance.now() });

  it("models every rostered player and team, with finite numbers everywhere", () => {
    expect(model.weeks).toEqual(range(PARKER.currentWeek, 17));
    expect(model.playoffWeeks).toEqual([15, 16, 17]);
    expect(model.myTeamId).toBe(PARKER.myTeamId);
    expect(model.teams.map((t) => t.id)).toEqual(snapshot.teams.map((t) => t.id));
    for (const t of snapshot.teams) {
      for (const id of [...t.roster, ...t.ir, ...t.taxi]) expect(model.players[id], id).toBeDefined();
      const tm = teamOf(model, t.id);
      expect(Object.keys(tm.players).sort()).toEqual([...new Set(t.roster)].sort());
      expect(Object.keys(tm.strength)).toEqual(model.slots.map((s) => s.key));
    }
    expect(model.slots.map((s) => s.label)).toEqual(["QB", "RB1", "RB2", "WR1", "WR2", "TE", "FLEX", "D/ST", "K"]);
    expect(model.projection.espnAveraged).toBe(true);
    expect(model.partners.length).toBeLessThanOrEqual(config.needs.partnersShown);
    expect(model.warnings).toEqual([]);
    expect(allFinite(model)).toEqual([]);
    const fmt = (t: Record<string, number>) => Object.entries(t).map(([k, v]) => `${k} ${v.toFixed(0)} ms`).join(", ");
    console.log(`[perf] Parker's league (synthetic inputs): ${Object.keys(model.players).length} players; ${fmt(model.timings)}`);
  });

  it("gives every team's depth credit: scenario lineups beat expected-value lineups over the rest of the season", () => {
    for (const t of model.teams) expect((t.scen as NonNullable<TeamModel["scen"]>).ros, `team ${t.id}`).toBeGreaterThan(t.ev.ros);
    // Starters cost their team more than bench players (§7 MV_lose), with the free agent the team would add.
    for (const t of model.teams) {
      const costs = Object.values(t.players).map((v) => v.mvLoseScen as number);
      expect(Math.max(...costs)).toBeGreaterThan(0);
    }
  });

  it("no lineup cost is below 0, and every waiver move adds a free agent (dropping a player of that team, or into an open spot)", () => {
    const freeAgents = new Set(snapshot.freeAgents);
    for (const t of model.teams) {
      for (const [id, v] of Object.entries(t.players)) {
        expect(v.mvLoseEv, `${t.id} ${id}`).toBeGreaterThanOrEqual(0);
        expect(v.mvLoseScen as number, `${t.id} ${id}`).toBeGreaterThanOrEqual(0);
      }
      const w = t.waiver;
      if (!w) continue;
      expect(freeAgents.has(w.add), w.add).toBe(true);
      // With scenarios the move is the scenario-best one, so its scenario gain is what's positive.
      expect(w.gainScen ?? w.gainEv).toBeGreaterThan(0);
      if (w.drop !== null) expect(t.players[w.drop], w.drop).toBeDefined();
      else expect(snapshot.teams.find((x) => x.id === t.id)?.roster.length).toBeLessThan(snapshot.settings.maxRosterSize);
      // The player dropped costs nothing from the team after the move (in the lineups the move was chosen by).
      if (w.drop !== null) expect(t.players[w.drop]?.mvLoseScen ?? t.players[w.drop]?.mvLoseEv).toBeCloseTo(0, 9);
    }
  });
});
