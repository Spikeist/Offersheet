import { describe, expect, it } from "vitest";
import { normalizeEspnLeague } from "@/adapters/espn/normalize";
import { NOW, PARKER, fakeResolver, parkerBundle } from "@/adapters/espn/test-helpers";
import { returnDateConflict } from "./availability";
import { config } from "./config";
import type { ModelInputs, PlayerInputs } from "./inputs";
import {
  buildLeagueModel,
  buildProjectionTable,
  firstKickoff,
  gameStarted,
  leagueWeeks,
  nflLastWeek,
  preKickoffTable,
  sleeperWeekLoaded,
  teamWeeks,
  weekKickedOff,
  type BuildLeagueModelOptions,
  type LeagueModelConfig,
} from "./league";
import type { LeagueModel, TeamModel } from "./leagueModel";
import { prepareLeagueSlots } from "./lineup";
import type { LeagueSnapshot, Pos, SlotDef } from "./model";
import { surplusScores } from "./needs";
import { priorHealthyBaseRate } from "./projections";
import { bestFreeAgent, evLineups, lowestKeepValue, mvAddGroupPpw, mvAddPpw, mvLose, positionAllows, ppw, rosterScore, rosValue, scenarioLineups, weekWeights } from "./teamValue";
import { TEST_NOW, buildTestLeague, randomLeague, syntheticInputs, type TestLeagueSpec, type TestPlayer, type TestTeam } from "./testLeague";

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);
/** A weekly projection: `v` in every NFL week from..to. */
const flat = (from: number, to: number, v: number): Record<number, number> => Object.fromEntries(range(from, to).map((w) => [w, v]));

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

type BruteChip = { gap: number; cost: number; maxOther: number; bestTeamId: string };

/**
 * Every trade-chip candidate's numbers by brute force, from the rule in league.ts's header (step 6) and the
 * friendly API (its own solves): T′_V from the model's waiver move; when T′_V's active roster is full, the
 * drop by lowestKeepValue over what losing each of its modeled players (never the free agent just added)
 * costs T′_V's lineup, ROS(T′_V) − ROS(T′_V − k), each roster solved on its own (nothing from the model's
 * lineup costs); MV_add'(T′, i) = max(0, ROS(T′_V + i − drop) − ROS(T′_V)) in the model's lineup mode over
 * the weeks team numbers count; positionLimits on T′_V + i − drop. `pick` chooses the team among those
 * allowed (default: the largest value, ties to the smaller id).
 */
function bruteChips(
  league: { snapshot: LeagueSnapshot; inputs: ModelInputs },
  model: LeagueModel,
  opts: BuildLeagueModelOptions,
  cfg: LeagueModelConfig = config,
  pick?: (options: { teamId: string; value: number; ev: number }[]) => { teamId: string; value: number } | null,
): Map<string, BruteChip> {
  const { snapshot } = league;
  const { table } = buildProjectionTable(snapshot, league.inputs, opts, cfg);
  const slots = prepareLeagueSlots(snapshot.settings);
  const { weights } = teamWeeks(model, model.inProgressWeek, cfg.lineups);
  const rosEv = (roster: string[]) => rosValue(evLineups(roster, table, slots).lv, weights);
  const ros = (roster: string[]) => (model.scenarios > 0 ? rosValue(scenarioLineups(roster, table, slots).lv, weights) : rosEv(roster));
  const posOf = (id: string) => snapshot.players[id]?.pos;
  const bases = snapshot.teams.map((t) => {
    const tm = teamOf(model, t.id);
    const w = tm.waiver;
    const roster = [...new Set(t.roster)];
    const v = w ? [...roster.filter((id) => id !== w.drop), w.add] : roster;
    const full = roster.length + (w && w.drop === null ? 1 : 0) >= snapshot.settings.maxRosterSize;
    const vRos = ros(v);
    const drop = full ? lowestKeepValue(v.filter((id) => id !== w?.add && table.rows.has(id)).map((id) => ({ id, keep: vRos - ros(v.filter((x) => x !== id)), value: model.players[id]?.value?.value ?? 0 }))) : null;
    const b = drop ? v.filter((id) => id !== drop) : v;
    return { id: t.id, blocked: full && drop === null, vRos, vRosEv: rosEv(v), b, positions: b.flatMap((id) => posOf(id) ?? []) };
  });
  const out = new Map<string, BruteChip>();
  for (const t of snapshot.teams) {
    const tm = teamOf(model, t.id);
    for (const [id, x] of Object.entries(tm.players)) {
      const pos = posOf(id) as Pos;
      if (cfg.market.tradeSearchExcluded.includes(pos)) continue;
      const options = bases
        .filter((b) => b.id !== t.id && !b.blocked && positionAllows(snapshot.settings.positionLimits, b.positions, pos))
        .map((b) => ({ teamId: b.id, value: Math.max(0, ros([...b.b, id]) - b.vRos), ev: Math.max(0, rosEv([...b.b, id]) - b.vRosEv) }));
      let best: { teamId: string; value: number } | null = null;
      if (pick) best = pick(options);
      else for (const o of options) if (!best || o.value > best.value + 1e-9 || (Math.abs(o.value - best.value) <= 1e-9 && o.teamId < best.teamId)) best = o;
      if (!best) continue;
      const cost = x.mvLoseScen ?? x.mvLoseEv;
      out.set(id, { gap: best.value - cost, cost, maxOther: best.value, bestTeamId: best.teamId });
    }
  }
  return out;
}

/** The model's chips match brute force: exactly the candidates whose gap reaches chipMinGap, with the same numbers and team. */
function expectChipsMatch(model: LeagueModel, brute: Map<string, BruteChip>, cfg: LeagueModelConfig = config): number {
  let chips = 0;
  for (const t of model.teams) {
    for (const c of t.chips) expect(brute.get(c.playerId), `team ${t.id}: chip ${c.playerId} isn't a candidate`).toBeDefined();
    for (const [id, b] of brute) {
      if (!(id in t.players)) continue;
      const chip = t.chips.find((c) => c.playerId === id);
      if (b.gap >= cfg.needs.chipMinGap - 1e-9) {
        chips++;
        expect(chip, `team ${t.id}: ${id} (gap ${b.gap}) should be a chip`).toBeDefined();
        expect(chip?.gap, id).toBeCloseTo(b.gap, 6);
        expect(chip?.cost, id).toBeCloseTo(b.cost, 6);
        expect(chip?.maxOther, id).toBeCloseTo(b.maxOther, 6);
        expect(chip?.bestTeamId, id).toBe(b.bestTeamId);
      } else {
        expect(chip, `team ${t.id}: ${id} (gap ${b.gap}) isn't a chip`).toBeUndefined();
      }
    }
  }
  return chips;
}

type BrutePartner = { teamId: string; mutual: boolean; score: number };

/**
 * Best trade partners by brute force, from the rule in league.ts's header (step 7, lead decision D2) and the friendly API
 * (its own solves): each side's chips (the model's TeamModel.chips) that add something to the receiving team after its best
 * free-agent move, by own gain (ties: the larger gap, then the smaller id); the first counts; each next one counts while
 * maxOther − cost(T − counted) ≥ chipMinGap, the cost on T − counted by step 5's rules (V(T′) − ROS(T′ − i + fa_i): V the
 * best of T′, T′ plus the free agent its open spot would take, and every T′ − j + fa_j, in the model's lineup mode), at most
 * maxPerSide; each side scored by the joint gain of the chips counted. Ranked like rankPartners: mutual first, best first.
 */
function brutePartners(league: { snapshot: LeagueSnapshot; inputs: ModelInputs }, model: LeagueModel, opts: BuildLeagueModelOptions, cfg: LeagueModelConfig = config): BrutePartner[] {
  const { snapshot } = league;
  const { table } = buildProjectionTable(snapshot, league.inputs, opts, cfg);
  const slots = prepareLeagueSlots(snapshot.settings);
  const tw = teamWeeks(model, model.inProgressWeek, cfg.lineups);
  const W = model.weeks.length;
  const window = { from: tw.from, to: W };
  const scen = model.scenarios > 0;
  const limits = snapshot.settings.positionLimits;
  const rosterOf = (id: string) => [...new Set(snapshot.teams.find((t) => t.id === id)?.roster ?? [])];
  const positionsOf = (ids: readonly string[]) => ids.flatMap((id) => snapshot.players[id]?.pos ?? []);
  const tv = (id: string): string[] => {
    const w = teamOf(model, id).waiver;
    const roster = rosterOf(id);
    return w ? [...roster.filter((x) => x !== w.drop), w.add] : roster;
  };
  const ros = (ids: readonly string[]) => rosValue(scen ? scenarioLineups(ids, table, slots).lv : evLineups(ids, table, slots).lv, tw.weights);
  /** His lineup cost on team `teamId` without the players in `gone`. */
  const costWithout = (teamId: string, gone: readonly string[], playerId: string): number => {
    const roster = rosterOf(teamId).filter((x) => !gone.includes(x));
    const fopts = { weights: tw.weights, rosterPositions: positionsOf(roster), ...(limits ? { positionLimits: limits } : {}) };
    const base = ros(roster);
    let v = base;
    if (roster.length < snapshot.settings.maxRosterSize) {
      const fa = bestFreeAgent(roster, snapshot.freeAgents, table, slots, fopts);
      if (fa) v = Math.max(v, ros([...roster, fa.id]));
    }
    const after = (id: string) => {
      const raw = mvLose(roster, id, snapshot.freeAgents, table, slots, fopts);
      return base - (scen ? (raw.scen as number) : raw.ev);
    };
    for (const id of roster) if (table.rows.has(id)) v = Math.max(v, after(id));
    return v - after(playerId);
  };
  const side = (from: string, to: string): number => {
    const chips = teamOf(model, from).chips.map((c) => ({ ...c, ppw: mvAddPpw(tv(to), c.playerId, table, slots, window) })).filter((c) => c.ppw > 1e-9);
    chips.sort((a, b) => (Math.abs(b.ppw - a.ppw) > 1e-9 ? b.ppw - a.ppw : Math.abs(b.gap - a.gap) > 1e-9 ? b.gap - a.gap : a.playerId < b.playerId ? -1 : 1));
    const counted: string[] = [];
    for (const c of chips) {
      if (counted.length >= cfg.search.maxPerSide) break;
      if (counted.length === 0 || c.maxOther - costWithout(from, counted, c.playerId) >= cfg.needs.chipMinGap - 1e-9) counted.push(c.playerId);
    }
    return mvAddGroupPpw(tv(to), counted, table, slots, window);
  };
  const me = model.myTeamId as string;
  const all = snapshot.teams
    .filter((t) => t.id !== me)
    .flatMap((t) => {
      const get = side(t.id, me);
      const give = side(me, t.id);
      return get > 1e-9 && give > 1e-9 ? [{ teamId: t.id, mutual: true, score: Math.sqrt(get * give) }] : get > 1e-9 ? [{ teamId: t.id, mutual: false, score: get }] : [];
    });
  const rank = (a: BrutePartner, b: BrutePartner) => (a.mutual !== b.mutual ? (a.mutual ? -1 : 1) : b.score - a.score || (a.teamId < b.teamId ? -1 : 1));
  return all.sort(rank).slice(0, cfg.needs.partnersShown);
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
    // The week's first kickoff (the pre-game moment of a week in progress): unreadable times are skipped.
    expect(firstKickoff(nfl, 4)).toBe(Date.parse("2026-09-29T17:00:00.000Z"));
    expect(firstKickoff(nfl, 6)).toBeNull();
    expect(firstKickoff(undefined, 4)).toBeNull();
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

  it("identical teams get identical strength, needs, PPW, ROS, lineup costs, trade chips and waiver moves, whoever has played", () => {
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
      expect(t.chips.map((c) => [c.playerId.slice(2), c.gap]), `team ${id}`).toEqual(one.chips.map((c) => [c.playerId.slice(2), c.gap]));
      for (const s of SUFFIXES) {
        const a = one.players[`1-${s}`] as NonNullable<TeamModel["players"][string]>;
        const b = t.players[`${id}-${s}`] as NonNullable<TeamModel["players"][string]>;
        expect(b.mvLoseEv, `${id}-${s}`).toBeCloseTo(a.mvLoseEv, 9);
        expect(b.mvLoseScen as number, `${id}-${s}`).toBeCloseTo(a.mvLoseScen as number, 9);
        expect(b.autoAdd, `${id}-${s}`).toBe(a.autoAdd);
        expect(b.surplusScore, `${id}-${s}`).toBeCloseTo(a.surplusScore, 9);
      }
    }
    // The numbers themselves: weeks 5–17 only.
    expect(one.ev.ros).toBeCloseTo(112 * OMEGA_AFTER, 9);
    expect(one.ev.ppw).toBeCloseTo(112, 9);
    expect(one.players["1-qb"]?.mvLoseEv).toBeCloseTo((20 - 12) * OMEGA_AFTER, 9); // his backup starts
    // Identical teams: nobody is worth more to another team than to his own.
    expect(model.teams.flatMap((t) => t.chips)).toEqual([]);
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

  it("trade chips and partner fit skip the week in progress: a spare RB adds to my lineup only what he'd add in the weeks left", () => {
    // Me (team 1): every player has played this week. Team 2 plays tonight and has a spare 13-point RB (its FLEX scores 13.2).
    const fit = buildTestLeague({
      teams: [team("1", starters("1").map((x) => ({ ...x, nflTeam: "EAR" }))), team("2", [...starters("2", 1.2), p("2-rb3", "RB", 13, { value: 9000 })].map((x) => ({ ...x, nflTeam: "LAT" })))],
      kickoffs: { 4: { EAR: EARLY, LAT: LATE } },
    });
    const model = buildLeagueModel(fit.snapshot, fit.inputs, OPTS, NO_RISK);
    // He'd replace my 11-point FLEX: +2 a week in weeks 5–17. Counting week 4, when my lineup has played, would add his whole 13.
    const rb3 = teamOf(model, "2").chips.find((c) => c.playerId === "2-rb3");
    expect(rb3).toEqual({ playerId: "2-rb3", gap: expect.closeTo(2 * OMEGA_AFTER, 9), cost: expect.closeTo(0, 9), maxOther: expect.closeTo(2 * OMEGA_AFTER, 9), bestTeamId: "1" });
    // His depth makes team 2's other RB/WR starters chips with the same gap (each one's loss is covered by him): every one is +2 a
    // week net. Equal gaps list the cheapest to lose first (D3): him (0), the FLEX (13.2 − 13), the 15.6s, then the 18s.
    expect(teamOf(model, "2").chips.map((c) => c.playerId)).toEqual(["2-rb3", "2-flex", "2-rb2", "2-wr2", "2-rb1", "2-wr1"]);
    for (const c of teamOf(model, "2").chips) expect(c.gap, c.playerId).toBeCloseTo(2 * OMEGA_AFTER, 9);
    const partner = model.partners[0];
    expect(model.partners).toHaveLength(1);
    expect(partner).toMatchObject({ teamId: "2", mutual: false, youCanGive: [] });
    expect(partner?.theyCanGive.find((x) => x.playerId === "2-rb3")?.ppw).toBeCloseTo(2, 9);
    // All six together would rebuild my RB, WR and FLEX spots (+15.2 a week), but they're chips only because each covers another
    // (D2): once the 18-point RB (+7 to me, the most; the WR's tie goes to the smaller id) has left, every other one is a starter
    // team 2 can't spare. So the fit counts him alone.
    expect(partner?.score).toBeCloseTo(18 + 15 + 13 - (15 + 13 + 11), 9);
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

describe("the weekly score the season simulator draws (§8; TeamModel.score)", () => {
  it("scenario lineups: the scenario mean and sqrt(within-lineup variance + LV spread²); EV lineups: the LV and sqrt(Σ σ²) of the starters", () => {
    const league = randomLeague({ teams: 4, seed: 17, freeAgentsPerPosition: 4 });
    const slots = prepareLeagueSlots(league.snapshot.settings);
    for (const scenarios of [0, 16]) {
      const opts = { now: TEST_NOW, scenarios, seed: 3, sims: 0 };
      const model = buildLeagueModel(league.snapshot, league.inputs, opts);
      const { table } = buildProjectionTable(league.snapshot, league.inputs, opts);
      for (const t of model.teams) {
        const roster = league.snapshot.teams.find((x) => x.id === t.id)?.roster ?? [];
        expect(t.score, `S = ${scenarios}, team ${t.id}`).toEqual(rosterScore(roster, table, slots));
        expect(t.score.mean).toEqual(scenarios > 0 ? t.scen?.lv : t.ev.lv);
        expect(t.score.mean).toHaveLength(model.weeks.length);
        // The weekly spread is mostly the starters' own (a team's σ is ~20 points); the scenario spread only adds to it.
        t.score.sd.forEach((s, w) => {
          expect(s).toBeGreaterThan(10);
          if (scenarios > 0) expect(s).toBeGreaterThanOrEqual(t.scen?.sd[w] as number);
        });
      }
    }
  });
});

describe("the week in progress in the simulation (lead decision D6): its games are played from projections as if none had started", () => {
  const EARLY = "2026-09-29T17:00:00.000Z"; // before TEST_NOW (20:00Z)
  const LATE = "2026-09-30T00:15:00.000Z";
  const BEFORE = new Date("2026-09-29T12:00:00.000Z");
  // Two identical teams: team 1's players played this afternoon, team 2's play tonight. They meet every week from week 4.
  const league = buildTestLeague({
    teams: [team("1", starters("1").map((x) => ({ ...x, nflTeam: "EAR" }))), team("2", starters("2").map((x) => ({ ...x, nflTeam: "LAT" })))],
    kickoffs: { 4: { EAR: EARLY, LAT: LATE } },
  });
  league.snapshot.schedule = range(4, 14).map((week) => ({ week, teamA: "1", teamB: "2", isPlayoff: false }));
  league.snapshot.settings.playoffTeams = 2;

  it("the first week's score is the whole week as it stood before kickoff; the partial week stays everywhere else; EV and scenario lineups", () => {
    for (const scenarios of [0, 16]) {
      const live = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios, sims: 0 });
      const before = buildLeagueModel(league.snapshot, league.inputs, { now: BEFORE, scenarios, sims: 0 });
      expect(live.inProgressWeek).toBe(4);
      expect(before.inProgressWeek).toBeNull();
      // The same scores as before any kickoff, every week: the first rebuilt for 1 ms before the first kickoff (the same
      // scenario draws, read with the table's own stride), the rest untouched.
      live.teams.forEach((t, i) => expect(t.score, `S = ${scenarios}, team ${t.id}`).toEqual(before.teams[i]?.score));
      // Nothing else about the week changes: team 1's week-4 lineup value is the partial week, its players having played.
      expect(teamOf(live, "1").ev.lv[0]).toBe(0);
      expect(teamOf(live, "1").score.mean[0]).toBeCloseTo(112, 9);
      expect(teamOf(live, "2").ev.lv[0]).toBeCloseTo(112, 9);
    }
  });

  it("so identical teams stay a coin flip in the week under way, and the odds say how that week is played", () => {
    const live = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 16, sims: 2000 });
    const week4 = live.odds?.weekly[0];
    expect(week4?.week).toBe(4);
    const p = week4?.games.find((g) => g.teamId === "1")?.pWin as number;
    expect(p).toBeGreaterThan(0.4); // from the partial week (0 against 112) team 1 would never win
    expect(p).toBeLessThan(0.6);
    expect(live.odds?.notes).toContain("Week 4 is under way: live scores aren't read yet, so all its games are simulated from projections as if none had started, with today's rosters and injury news.");
    expect(preKickoffTable(league.snapshot, league.inputs, null, { now: TEST_NOW })).toBeNull();
    expect(preKickoffTable(league.snapshot, league.inputs, 4, { now: TEST_NOW })?.now.toISOString()).toBe("2026-09-29T16:59:59.999Z");
  });

  it("only the clock goes back: a tag added after a player's game is in the week's score, as the note says (review SEASON-1: nothing records tags or rosters at kickoff)", () => {
    // Team 1's 15-point RB played this afternoon and is tagged OUT now. The week is rebuilt with today's tag: he misses it.
    const tagged = buildTestLeague({
      teams: [team("1", starters("1").map((x) => ({ ...x, nflTeam: "EAR", ...(x.id === "1-rb1" ? { injury: "OUT" as const } : {}) }))), team("2", starters("2").map((x) => ({ ...x, nflTeam: "LAT" })))],
      kickoffs: { 4: { EAR: EARLY, LAT: LATE } },
    });
    tagged.snapshot.schedule = league.snapshot.schedule;
    tagged.snapshot.settings.playoffTeams = 2;
    for (const scenarios of [0, 16]) {
      const live = buildLeagueModel(tagged.snapshot, tagged.inputs, { now: TEST_NOW, scenarios, sims: 0 }, NO_RISK);
      const untagged = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios, sims: 0 }, NO_RISK);
      // Without him team 1 has no bench to fill his RB spot: 112 − 15. The week as it stood at kickoff would have been 112.
      expect(teamOf(untagged, "1").score.mean[0], `S = ${scenarios}`).toBeCloseTo(112, 9);
      expect(teamOf(live, "1").score.mean[0], `S = ${scenarios}`).toBeCloseTo(97, 9);
      expect(teamOf(live, "2").score.mean[0], `S = ${scenarios}`).toBeCloseTo(112, 9);
    }
  });
});

describe("trade chips (§7; planner reply to Checkpoint 2, answers 1 and 2): worth at least chipMinGap more to another team than to his own", () => {
  /** Σ ω over weeks 4–17: 11 regular-season weeks and 3 playoff weeks at playoffWeight. */
  const OMEGA = 11 + 3 * config.lineups.playoffWeight;
  const OPTS = { now: TEST_NOW, scenarios: 8 };
  const withQb = (t: string, qb: number): TestPlayer[] => starters(t).map((x) => (x.pos === "QB" ? { ...x, points: qb } : x));
  /** Team 1: a 25-point QB and an 18-point backup in a 1-QB league; the other teams' QBs score `qbs`. */
  const qbLeague = (qbs: [number, number, number], extra: Partial<TestLeagueSpec> = {}) =>
    buildTestLeague({ teams: [team("1", [...withQb("1", 25), p("1-qb2", "QB", 18)]), team("2", withQb("2", qbs[0])), team("3", withQb("3", qbs[1])), team("4", withQb("4", qbs[2]))], ...extra });

  it("a backup QB behind a star is a chip when another team's QB is weak: his edge over that QB, to that team (Bo Nix behind Josh Allen)", () => {
    const league = qbLeague([10, 12, 14]);
    const model = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);
    const t1 = teamOf(model, "1");
    // He never starts for team 1 (cost 0) and would replace team 2's 10-point QB: +8 a week, the most of any team.
    expect(t1.chips.find((c) => c.playerId === "1-qb2")).toEqual({ playerId: "1-qb2", gap: expect.closeTo(8 * OMEGA, 9), cost: expect.closeTo(0, 9), maxOther: expect.closeTo(8 * OMEGA, 9), bestTeamId: "2" });
    // The star is one too, with the same gap: trading him costs team 1 his edge over the backup (25 − 18) and gives team 2 25 − 10.
    expect(t1.chips.find((c) => c.playerId === "1-qb")).toEqual({ playerId: "1-qb", gap: expect.closeTo(8 * OMEGA, 9), cost: expect.closeTo(7 * OMEGA, 9), maxOther: expect.closeTo(15 * OMEGA, 9), bestTeamId: "2" });
    expect(t1.chips.map((c) => c.playerId)).toEqual(["1-qb2", "1-qb"]); // equal gaps: the cheaper one to lose first (D3)
    // No depth elsewhere: every other starter costs his team more than he'd add to another.
    for (const id of ["2", "3", "4"]) expect(teamOf(model, id).chips, `team ${id}`).toEqual([]);
    // Chips are lineup points: FantasyCalc down, the same chips.
    const down = qbLeague([10, 12, 14], { market: false });
    expect(buildLeagueModel(down.snapshot, down.inputs, OPTS, NO_RISK).teams.map((t) => t.chips)).toEqual(model.teams.map((t) => t.chips));
  });

  it("isn't a chip when no other team's QB is weak enough: a half-point edge (under chipMinGap), or none at all", () => {
    expect(0.5 * OMEGA).toBeLessThan(config.needs.chipMinGap);
    for (const qbs of [
      [17.5, 24, 26],
      [24, 26, 27],
    ] as [number, number, number][]) {
      const league = qbLeague(qbs);
      expect(buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK).teams.flatMap((t) => t.chips), JSON.stringify(qbs)).toEqual([]);
    }
  });

  it("measures what he'd add against each team's best free-agent move: a free-agent upgrade doesn't create or inflate a chip (answer 1)", () => {
    // Team 2's QB scores 10, but a 16-point QB is on waivers: team 2 would add him anyway, so the backup's edge there is 18 − 16.
    const withFa = qbLeague([10, 24, 26], { freeAgents: [p("fa-qb", "QB", 16)] });
    const model = buildLeagueModel(withFa.snapshot, withFa.inputs, OPTS, NO_RISK);
    expect(teamOf(model, "2").waiver).toMatchObject({ add: "fa-qb", drop: null });
    expect(teamOf(model, "1").chips.find((c) => c.playerId === "1-qb2")).toMatchObject({ gap: expect.closeTo(2 * OMEGA, 9), maxOther: expect.closeTo(2 * OMEGA, 9), bestTeamId: "2" });
    // Without the free agent, the same backup is worth 8 a week there: the pickup would have been counted four times over.
    const without = qbLeague([10, 24, 26]);
    expect(teamOf(buildLeagueModel(without.snapshot, without.inputs, OPTS, NO_RISK), "1").chips.find((c) => c.playerId === "1-qb2")?.gap).toBeCloseTo(8 * OMEGA, 9);
    // A 17.5-point free agent leaves him half a point a week: no chip at all.
    const close = qbLeague([10, 24, 26], { freeAgents: [p("fa-qb", "QB", 17.5)] });
    expect(buildLeagueModel(close.snapshot, close.inputs, OPTS, NO_RISK).teams.flatMap((t) => t.chips)).toEqual([]);
  });

  it("makes room on a full roster by dropping the player whose loss costs its lineup least (ties: the lower value, then the id), and skips a team the newcomer would put over a position limit", () => {
    // Team 2: a 10-point QB and a full 16-player active roster whose seven bench players never start (losing one costs 0); QB limit 2.
    const bench = (qb2Value: number): TestPlayer[] => [
      p("2-qb2", "QB", 8, { value: qb2Value }),
      p("2-rb3", "RB", 6, { value: 600 }),
      p("2-rb4", "RB", 5, { value: 500 }),
      p("2-wr3", "WR", 7, { value: 700 }),
      p("2-wr4", "WR", 6, { value: 650 }),
      p("2-te2", "TE", 4, { value: 300 }),
      p("2-k2", "K", 5, { value: 400 }),
    ];
    const valued = (t: string, qb: number) => withQb(t, qb).map((x, i) => (x.pos === "K" || x.pos === "DEF" ? x : { ...x, value: 3000 - 100 * i }));
    const league = (qb2Value: number) =>
      buildTestLeague({ positionLimits: { QB: 2 }, teams: [team("1", [...valued("1", 25), p("1-qb2", "QB", 18, { value: 2000 })]), team("2", [...valued("2", 10), ...bench(qb2Value)]), team("3", withQb("3", 24)), team("4", withQb("4", 26))] });
    // Every bench player costs 0 to lose, so the least valuable goes: team 2's backup QB, so a QB fits (8 a week over their 10-point starter).
    const cheap = league(100);
    expect(cheap.snapshot.teams[1]?.roster).toHaveLength(cheap.snapshot.settings.maxRosterSize);
    const m1 = buildLeagueModel(cheap.snapshot, cheap.inputs, OPTS, NO_RISK);
    expect(teamOf(m1, "1").chips.find((c) => c.playerId === "1-qb2")).toMatchObject({ gap: expect.closeTo(8 * OMEGA, 9), bestTeamId: "2" });
    expectChipsMatch(m1, bruteChips(cheap, m1, OPTS, NO_RISK), NO_RISK);
    // Worth more than the bench TE (300), the backup QB stays and the TE goes: a third QB would break the limit, so team 2 is skipped.
    const pricey = league(900);
    const m2 = buildLeagueModel(pricey.snapshot, pricey.inputs, OPTS, NO_RISK);
    expect(m2.teams.flatMap((t) => t.chips)).toEqual([]);
    expectChipsMatch(m2, bruteChips(pricey, m2, OPTS, NO_RISK), NO_RISK);
  });

  it("makes room with the player whose loss costs the lineup least, nobody refilling his spot: not a starting K whose free-agent twin makes his lineup cost ~0 (review finding)", () => {
    // Team 2: a 10-point QB and a full roster whose bench players each start in a starter's bye week, so each costs something;
    // its 8-point K has no backup, and a 7.99-point K is on waivers. A lineup cost refills the spot with that free agent, so the
    // K's is ~0 (the lowest on the team), but dropping him to make room loses his 8 a week: a bench player goes instead, and the
    // backup QB stays worth his edge over team 2's QB. Injury risk on (the default config), EV and scenario lineups.
    const two: TestPlayer[] = [
      p("2-qb", "QB", 10, { nflTeam: "B06" }),
      p("2-rb1", "RB", 15, { nflTeam: "B07" }),
      p("2-rb2", "RB", 13, { nflTeam: "B07" }),
      p("2-wr1", "WR", 15, { nflTeam: "B08" }),
      p("2-wr2", "WR", 13, { nflTeam: "B08" }),
      p("2-te", "TE", 10, { nflTeam: "B09" }),
      p("2-flex", "WR", 11, { nflTeam: "B08" }),
      p("2-k", "K", 8),
      p("2-def", "DEF", 7, { nflTeam: "B11" }),
      ...[p("2-qb2", "QB", 9), p("2-rb3", "RB", 9), p("2-rb4", "RB", 8), p("2-wr3", "WR", 9), p("2-wr4", "WR", 8), p("2-te2", "TE", 6), p("2-def2", "DEF", 6)],
    ];
    const league = (faK: number) =>
      buildTestLeague({
        teams: [team("1", [...withQb("1", 25), p("1-qb2", "QB", 18)]), team("2", two), team("3", withQb("3", 24)), team("4", withQb("4", 26))],
        freeAgents: [p("fa-k", "K", faK)],
        byeWeek: { B06: 6, B07: 7, B08: 8, B09: 9, B11: 11 },
      });
    const close = league(7.99);
    expect(close.snapshot.teams[1]?.roster).toHaveLength(close.snapshot.settings.maxRosterSize);
    for (const scenarios of [0, 32]) {
      const opts = { now: TEST_NOW, scenarios, seed: 7 };
      const m = buildLeagueModel(close.snapshot, close.inputs, opts);
      const t2 = teamOf(m, "2");
      expect(t2.waiver, `S = ${scenarios}`).toBeNull();
      const cost = (id: string) => (t2.players[id]?.mvLoseScen ?? t2.players[id]?.mvLoseEv) as number;
      for (const id of Object.keys(t2.players)) if (id !== "2-k") expect(cost("2-k"), `S = ${scenarios}: ${id}`).toBeLessThan(cost(id));
      const chip = teamOf(m, "1").chips.find((c) => c.playerId === "1-qb2");
      expect(chip?.bestTeamId, `S = ${scenarios}`).toBe("2");
      // Worth his 8-a-week edge over team 2's QB, less what the bench player who makes room was worth: far past the cut.
      expect(chip?.maxOther as number, `S = ${scenarios}`).toBeGreaterThan(5 * OMEGA);
      expect(expectChipsMatch(m, bruteChips(close, m, opts)), `S = ${scenarios}`).toBeGreaterThan(0);
      // How good the free-agent K is doesn't change who makes room: the same chips with a 3-point one.
      const far = league(3);
      expect(buildLeagueModel(far.snapshot, far.inputs, opts).teams.map((t) => t.chips), `S = ${scenarios}`).toEqual(m.teams.map((t) => t.chips));
    }
  });

  it("kickers, punters, team defenses and IDP are never chips (trade search leaves them out, §9), however much another team needs one", () => {
    // Team 1 has a 7-point backup K behind its 8-point K; team 2's kicker scores 2.
    const kickers = buildTestLeague({ teams: [team("1", [...starters("1"), p("1-k2", "K", 7)]), team("2", starters("2").map((x) => (x.pos === "K" ? { ...x, points: 2 } : x)))] });
    expect(buildLeagueModel(kickers.snapshot, kickers.inputs, OPTS, NO_RISK).teams.flatMap((t) => t.chips)).toEqual([]);
    // Only the exclusion keeps him out: with none, the backup is worth 5 a week to team 2 (and his starter too, by the same gap).
    const open: LeagueModelConfig = { ...NO_RISK, market: { ...NO_RISK.market, tradeSearchExcluded: [] } };
    const all = buildLeagueModel(kickers.snapshot, kickers.inputs, OPTS, open);
    expect(teamOf(all, "1").chips.map((c) => c.playerId)).toEqual(["1-k2", "1-k"]);
    expect(teamOf(all, "1").chips.find((c) => c.playerId === "1-k2")).toMatchObject({ gap: expect.closeTo(5 * OMEGA, 9), bestTeamId: "2" });
  });

  it("matches brute force on a random league with injuries, full rosters (so drops) and position limits: every candidate, every other team", () => {
    const league = randomLeague({ teams: 6, seed: 11, freeAgentsPerPosition: 6 });
    league.snapshot.settings.positionLimits = { QB: 3, RB: 6, WR: 6, TE: 2 };
    expect(league.snapshot.teams.every((t) => t.roster.length === league.snapshot.settings.maxRosterSize)).toBe(true);
    const opts = { now: TEST_NOW, scenarios: 8, seed: 5 };
    const model = buildLeagueModel(league.snapshot, league.inputs, opts);
    expect(expectChipsMatch(model, bruteChips(league, model, opts))).toBeGreaterThan(3);
    // Expected-value lineups (no scenarios) too.
    const evOpts = { ...opts, scenarios: 0 };
    const ev = buildLeagueModel(league.snapshot, league.inputs, evOpts);
    expect(expectChipsMatch(ev, bruteChips(league, ev, evOpts))).toBeGreaterThan(3);
  });

  it("under starter limits nothing is bounded: the best chipScreenTeams other teams by exact EV value get scenario lineups", () => {
    // MFL-style: a QB, six flex spots with RB/WR/TE minimums, a K.
    const lineup: SlotDef[] = [
      { slot: "QB", count: 1, eligible: ["QB"] },
      { slot: "FLEX", count: 6, eligible: ["RB", "WR", "TE"] },
      { slot: "K", count: 1, eligible: ["K"] },
    ];
    const league = randomLeague({ teams: 6, seed: 23, freeAgentsPerPosition: 4, lineup });
    league.snapshot.settings.starterLimits = { RB: { min: 2, max: 4 }, WR: { min: 2, max: 4 }, TE: { min: 1, max: 2 } };
    const opts = { now: TEST_NOW, scenarios: 8, seed: 5 };
    // Every other team screened: exactly the brute-force chips.
    const wide: LeagueModelConfig = { ...config, needs: { ...config.needs, chipScreenTeams: 99 } };
    const all = buildLeagueModel(league.snapshot, league.inputs, opts, wide);
    expect(expectChipsMatch(all, bruteChips(league, all, opts, wide), wide)).toBeGreaterThan(0);
    // One team screened: each chip's team is the one with the best exact EV value (ties: the smaller id), priced in scenario lineups.
    const one: LeagueModelConfig = { ...config, needs: { ...config.needs, chipScreenTeams: 1 } };
    const m = buildLeagueModel(league.snapshot, league.inputs, opts, one);
    const pickEv = (options: { teamId: string; value: number; ev: number }[]) => {
      let best: (typeof options)[number] | null = null;
      for (const o of options) if (!best || o.ev > best.ev + 1e-9 || (Math.abs(o.ev - best.ev) <= 1e-9 && o.teamId < best.teamId)) best = o;
      return best;
    };
    expectChipsMatch(m, bruteChips(league, m, opts, one, pickEv), one);
  });
});

describe("best trade partners (§7: their trade chips fit my needs AND mine fit theirs)", () => {
  // No FLEX. Me (team 1): a 25-point QB and a 22-point backup, weak WRs (8, 7). Team 2: a weak QB (10), WRs of 22 and 21 and a
  // 19-point bench WR → mutual. Team 3: the same WRs but a strong QB (26) → one-sided. Team 4: a weak QB and no depth: no chips.
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
      team("1", [...core("1", 25, [8, 7]), p("1-qb2", "QB", 22)]),
      team("2", [...core("2", 10, [22, 21]), p("2-wr3", "WR", 19)]),
      team("3", [...core("3", 26, [22, 21]), p("3-wr3", "WR", 19)]),
      team("4", core("4", 9, [15, 13])),
    ],
  };
  const OPTS = { now: TEST_NOW, scenarios: 8 };
  const league = buildTestLeague(spec);
  const model = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);
  const ppwOf = (xs: readonly { playerId: string; ppw: number }[] | undefined) => (xs ?? []).map((x) => [x.playerId, Math.round(x.ppw * 1e9) / 1e9]);

  it("builds partners from the trade chips: mutual fits first, then one-sided ones, with what each chip adds to the other lineup", () => {
    expect(model.myTeamId).toBe("1");
    // Chips: my two QBs (either covers the other; team 4's 9-point QB gains the most) and every WR of teams 2 and 3 (the bench
    // WR covers either starter), equal gaps each, the cheapest to lose first (D3). Team 4 has no depth, so no chips.
    expect(teamOf(model, "1").chips.map((c) => [c.playerId, c.bestTeamId])).toEqual([
      ["1-qb2", "4"],
      ["1-qb", "4"],
    ]);
    expect(teamOf(model, "2").chips.map((c) => c.playerId)).toEqual(["2-wr3", "2-wr2", "2-wr1"]);
    expect(teamOf(model, "3").chips.map((c) => c.playerId)).toEqual(["3-wr3", "3-wr2", "3-wr1"]);
    expect(teamOf(model, "4").chips).toEqual([]);
    // Team 3 could help me but my QBs can't help it: after the mutual fit. Team 4 has no chips: no fit.
    expect(model.partners.map((x) => [x.teamId, x.mutual])).toEqual([
      ["2", true],
      ["3", false],
    ]);
    const two = model.partners[0];
    // Each of their WRs would replace my 7-point WR, most helpful first.
    expect(ppwOf(two?.theyCanGive)).toEqual([
      ["2-wr1", 22 - 7],
      ["2-wr2", 21 - 7],
      ["2-wr3", 19 - 7],
    ]);
    // Either of my QBs would replace their 10-point QB.
    expect(ppwOf(two?.youCanGive)).toEqual([
      ["1-qb", 25 - 10],
      ["1-qb2", 22 - 10],
    ]);
    // Only chips that stay chips together count (D2): once their best WR (+15 to me) has left, the other two are the starters
    // team 2 can't spare (no free agent to cover them), and once my starting QB has left, my backup is my only QB. Each side
    // counts its best chip: 22 against my 7, and 25 against their 10.
    expect(two?.score).toBeCloseTo(Math.sqrt((22 - 7) * (25 - 10)), 9);
    const three = model.partners[1];
    expect(three?.youCanGive).toEqual([]);
    expect(three?.score).toBeCloseTo(22 - 7, 9);
    const { table } = buildProjectionTable(league.snapshot, league.inputs, OPTS, NO_RISK);
    expect(mvAddGroupPpw(league.snapshot.teams[0]?.roster ?? [], ["3-wr1"], table, prepareLeagueSlots(league.snapshot.settings))).toBeCloseTo(three?.score as number, 9);
  });

  it("measures their chips against my roster after my best free-agent move: a free agent I'd add anyway shrinks what they add", () => {
    // An 18-point free-agent WR: I'd add him into an open spot (my WRs become 18 and 8).
    const fa = buildTestLeague({ ...spec, freeAgents: [p("fa-wr", "WR", 18)] });
    const m = buildLeagueModel(fa.snapshot, fa.inputs, OPTS, NO_RISK);
    expect(teamOf(m, "1").waiver).toMatchObject({ add: "fa-wr", drop: null });
    const two = m.partners.find((x) => x.teamId === "2");
    expect(ppwOf(two?.theyCanGive)).toEqual([
      ["2-wr1", 22 - 8],
      ["2-wr2", 21 - 8],
      ["2-wr3", 19 - 8],
    ]);
    // Together: 22 + 21 against my 18 + 8. Both count (D2): with their best WR gone, team 2 would lose only 21 − 18 a week
    // without the second (it adds the 18-point free agent), while he's worth 21 − 8 to me: still a chip.
    expect(two?.score).toBeCloseTo(Math.sqrt((22 + 21 - 18 - 8) * 15), 9);
  });

  it("needs no trade values: FantasyCalc down gives the same chips and partners, and no warning about them", () => {
    const down = buildTestLeague({ ...spec, market: false });
    const m = buildLeagueModel(down.snapshot, down.inputs, OPTS, NO_RISK);
    expect(m.market.format).toBeNull();
    expect(m.teams.map((t) => t.chips)).toEqual(model.teams.map((t) => t.chips));
    expect(m.partners).toEqual(model.partners);
    // No warning beyond the league's own (this test league has no schedule, so no playoff odds either way).
    expect(m.warnings).toEqual(model.warnings);
  });

  it("counts only chips that stay chips together (D2): brute force on random leagues, EV and scenario lineups, 2 and 3 a side, and under starter limits", () => {
    const check = (league: ReturnType<typeof randomLeague>, opts: BuildLeagueModelOptions, cfg: LeagueModelConfig = config) => {
      const model = buildLeagueModel(league.snapshot, league.inputs, opts, cfg);
      const brute = brutePartners(league, model, opts, cfg);
      expect(model.partners.map((x) => [x.teamId, x.mutual])).toEqual(brute.map((x) => [x.teamId, x.mutual]));
      model.partners.forEach((x, i) => expect(x.score, x.teamId).toBeCloseTo(brute[i]?.score as number, 6));
      return model.partners.length;
    };
    const league = randomLeague({ teams: 6, seed: 11, freeAgentsPerPosition: 6 });
    league.snapshot.settings.positionLimits = { QB: 3, RB: 6, WR: 6, TE: 2 };
    let partners = 0;
    for (const scenarios of [0, 8]) {
      const opts = { now: TEST_NOW, scenarios, seed: 5, sims: 0 };
      partners += check(league, opts);
      partners += check(league, opts, { ...config, search: { ...config.search, maxPerSide: 3 } });
    }
    // MFL-style starter limits: nothing is bounded, so the chips' costs on T − counted are solved exactly.
    const lineup: SlotDef[] = [
      { slot: "QB", count: 1, eligible: ["QB"] },
      { slot: "FLEX", count: 6, eligible: ["RB", "WR", "TE"] },
      { slot: "K", count: 1, eligible: ["K"] },
    ];
    for (const seed of [23, 24, 25]) {
      const limited = randomLeague({ teams: 6, seed, freeAgentsPerPosition: 4, lineup });
      limited.snapshot.settings.starterLimits = { RB: { min: 2, max: 4 }, WR: { min: 2, max: 4 }, TE: { min: 1, max: 2 } };
      partners += check(limited, { now: TEST_NOW, scenarios: 8, seed: 5, sims: 0 });
      partners += check(limited, { now: TEST_NOW, scenarios: 0, seed: 5, sims: 0 }, { ...config, search: { ...config.search, maxPerSide: 3 } });
    }
    expect(partners).toBeGreaterThan(12);
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
    // No season simulation: these one-team leagues have no schedule (it would add its own warning).
    const opts = { now: TEST_NOW, scenarios: 0, sims: 0 };
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

describe("conflicting ESPN signals (§6 step 3; planner reply to Checkpoint 2, answer 6): Sleeper breaks the tie", () => {
  const OPTS = { now: TEST_NOW, scenarios: 16, seed: 5 };
  /** A questionable RB whom ESPN expects back in week 8. Sleeper projected him 15 a game before this week, and `now` this week (0 = a stub). */
  const withQ = (now: number, extra: Partial<TestPlayer> = {}) =>
    buildTestLeague({ teams: [team("1", [...starters("1"), { id: "rb-q", pos: "RB", points: { ...flat(1, 17, 15), 4: now }, injury: "QUESTIONABLE", injuryReturnWeek: 8, ...extra }]), team("2", starters("2"))] });
  const expectClose = (actual: readonly number[] | undefined, expected: readonly number[]) => {
    expect(actual).toHaveLength(expected.length);
    expected.forEach((x, i) => expect(actual?.[i], `index ${i}`).toBeCloseTo(x, 12));
  };

  it("Sleeper still projects him (50% of his healthy rate or more): the date is stale, so the tag's one-week table applies this week, then he's healthy", () => {
    const league = withQ(12);
    const model = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);
    const pm = model.players["rb-q"];
    const healthy = priorHealthyBaseRate(league.inputs.players["rb-q"] as PlayerInputs, { currentWeek: 4, weeks: model.weeks, espnAveraged: false }).b;
    expect(12).toBeGreaterThanOrEqual(0.5 * healthy);
    expect(pm?.availabilityNote).toEqual({ status: "QUESTIONABLE", returnWeek: 8, used: "sleeper", sleeperNow: 12, healthyRate: expect.closeTo(healthy, 12) });
    expectClose(
      pm?.weekly.map((w) => w.a),
      [0.85, ...new Array<number>(13).fill(1)],
    );
  });

  it("Sleeper projects him under 50% of it, or not at all (a stub): he follows the return date, give or take a week", () => {
    for (const now of [5, 0]) {
      const league = withQ(now);
      const model = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);
      const pm = model.players["rb-q"];
      expect(pm?.availabilityNote, `now ${now}`).toMatchObject({ status: "QUESTIONABLE", returnWeek: 8, used: "returnDate", sleeperNow: now === 0 ? null : now });
      // Back in week 7, 8 or 9 (25% / 50% / 25%).
      expectClose(pm?.weekly.map((w) => w.a).slice(0, 7), [0, 0, 0, 0.25, 0.75, 1, 1]);
    }
  });

  it("when Sleeper's projections for this week didn't load, there's no tiebreaker: he follows the date, and the note says the projections are missing (review AVAIL-4)", () => {
    const opts = { ...OPTS, sims: 0 };
    // Sleeper projects him 15 this week too: loaded, the date is stale.
    const league = withQ(15);
    expect(buildLeagueModel(league.snapshot, league.inputs, opts, NO_RISK).players["rb-q"]?.availabilityNote).toEqual({ status: "QUESTIONABLE", returnWeek: 8, used: "sleeper", sleeperNow: 15, healthyRate: 15 });
    // Week 4's list didn't load (an outage): the model inputs leave its key out for every player.
    const down = structuredClone(league.inputs);
    for (const pin of Object.values(down.players)) delete pin.sleeper[4];
    expect(sleeperWeekLoaded(league.inputs.players, 4)).toBe(true);
    expect(sleeperWeekLoaded(down.players, 4)).toBe(false);
    const model = buildLeagueModel(league.snapshot, down, opts, NO_RISK);
    expect(model.players["rb-q"]?.availabilityNote).toEqual({ status: "QUESTIONABLE", returnWeek: 8, used: "returnDate", sleeperNow: null, sleeperUnavailable: true, healthyRate: 15 });
    expectClose(model.players["rb-q"]?.weekly.map((w) => w.a).slice(0, 7), [0, 0, 0, 0.25, 0.75, 1, 1]);
    // The week loaded but has no line for him (a stub): Sleeper doesn't project him, which is a real answer, not an outage.
    const stub = withQ(0);
    expect(buildLeagueModel(stub.snapshot, stub.inputs, opts, NO_RISK).players["rb-q"]?.availabilityNote).toEqual({ status: "QUESTIONABLE", returnWeek: 8, used: "returnDate", sleeperNow: null, healthyRate: 15 });
    // A player Sleeper doesn't cover (no Sleeper id: no weeks at all) in a week that loaded for the others: no flag either.
    const ids = { ...stub.inputs, players: { ...stub.inputs.players, "rb-q": { ...(stub.inputs.players["rb-q"] as PlayerInputs), sleeper: {} } } };
    expect(buildLeagueModel(stub.snapshot, ids, opts, NO_RISK).players["rb-q"]?.availabilityNote).toMatchObject({ used: "returnDate", sleeperNow: null });
    expect(buildLeagueModel(stub.snapshot, ids, opts, NO_RISK).players["rb-q"]?.availabilityNote?.sleeperUnavailable).toBeUndefined();
  });

  it("his scenario draws follow the same signal, and nobody else's change (common random numbers)", () => {
    const table = (league: ReturnType<typeof withQ>) => buildProjectionTable(league.snapshot, league.inputs, OPTS, NO_RISK).table;
    const stale = table(withQ(12));
    const dated = table(withQ(5));
    // A stale date is dropped for his scenarios too: the same flags as the same player without a return date.
    expect(stale.rows.get("rb-q")?.flags).toEqual(table(withQ(12, { injuryReturnWeek: undefined })).rows.get("rb-q")?.flags);
    // Following the date, he plays no scenario before week 7.
    const flags = dated.rows.get("rb-q")?.flags as Uint8Array;
    const W = dated.weeks.length;
    for (let s = 0; s < OPTS.scenarios; s++) for (let wi = 0; wi < 3; wi++) expect(flags[s * W + wi], `scenario ${s} week ${dated.weeks[wi]}`).toBe(0);
    expect(flags).not.toEqual(stale.rows.get("rb-q")?.flags);
    expect(stale.rows.size).toBeGreaterThan(10);
    for (const [id, row] of stale.rows) if (id !== "rb-q") expect(dated.rows.get(id)?.flags, id).toEqual(row.flags);
  });

  it("notes only the conflicts: a game-time tag with a return week 2+ weeks out (out for the season too), not OUT or IR players or a date next week", () => {
    const league = buildTestLeague({
      nflLastWeek: 18,
      teams: [
        team("1", [
          ...starters("1"),
          p("q-next", "RB", 10, { injury: "QUESTIONABLE", injuryReturnWeek: 5 }),
          p("out-8", "RB", 10, { injury: "OUT", injuryReturnWeek: 8 }),
          p("p-season", "WR", 10, { injury: "PROBABLE", injuryReturnWeek: 19 }),
          p("d-6", "WR", 10, { injury: "DOUBTFUL", injuryReturnWeek: 6 }),
        ]),
        { id: "2", roster: starters("2"), ir: [p("ir-8", "RB", 10, { injury: "IR", injuryReturnWeek: 8 })] },
      ],
    });
    const model = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 0 }, NO_RISK);
    expect(
      Object.entries(model.players)
        .filter(([, pm]) => pm.availabilityNote)
        .map(([id]) => id)
        .sort(),
    ).toEqual(["d-6", "p-season"]);
    // Sleeper projects both this week at their healthy rate, so both dates are stale: the probable WR ESPN calls out for the season plays.
    expect(model.players["p-season"]?.availabilityNote).toMatchObject({ status: "PROBABLE", returnWeek: 19, used: "sleeper" });
    expect(model.players["p-season"]?.weekly[1]?.a).toBeCloseTo(1, 12);
    expect(model.players["d-6"]?.availabilityNote).toMatchObject({ status: "DOUBTFUL", returnWeek: 6, used: "sleeper" });
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
    expect(model.teams[0]).toMatchObject({ ev: { lv: [], ros: 0, ppw: 0 }, scen: { lv: [], ros: 0, ppw: 0, sd: [] }, needs: [], chips: [] });
    expect(model.players["1-qb"]?.weekly).toEqual([]);
    expect(model.partners).toEqual([]);
    expect(model.odds).toBeNull(); // nothing left to simulate
    expect(model.teams[0]?.score).toEqual({ mean: [], sd: [] });
    expect(allFinite(model)).toEqual([]);
  });

  it("fills timings only when a clock is passed", () => {
    const league = buildTestLeague({ teams: [team("1", starters("1")), team("2", starters("2"))] });
    expect(buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 4 }).timings).toEqual({});
    let t = 0;
    const timings = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 4, clock: () => (t += 1) }).timings;
    expect(Object.keys(timings)).toEqual(["projections", "availability scenarios", "market values", "EV lineups and marginal values", "scenario lineups and marginal values", "trade chips", "needs and partners", "season simulation", "total"]);
    expect(timings.total).toBe(8);
    // No simulation (sims 0): no stage for it, and no odds.
    const none = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 4, sims: 0, clock: () => (t += 1) });
    expect(Object.keys(none.timings)).not.toContain("season simulation");
    expect(none.odds).toBeNull();
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
    const chips = model.teams.reduce((n, t) => n + t.chips.length, 0);
    console.log(`[perf] 12 teams × 16, ${Object.keys(model.players).length} players, ${model.weeks.length} weeks, ${chips} trade chips. EV only: ${fmt(ev.timings)}. S = 32: ${fmt(model.timings)}`);
    expect(model.timings.total).toBeLessThan(5000);
    expect(allFinite(model)).toEqual([]);
  });

  it("Parker's league (sanitized fixture, synthetic inputs): the model build with and without the season simulation, EV only and S = 32", { timeout: 60_000 }, () => {
    const { snapshot } = normalizeEspnLeague(parkerBundle(), { leagueId: PARKER.leagueId, resolver: fakeResolver(), now: NOW, swid: PARKER.swid });
    const inputs = syntheticInputs(snapshot);
    const clock = () => performance.now();
    const build = (scenarios: number, sims: number) => buildLeagueModel(snapshot, inputs, { now: NOW, scenarios, sims, clock });
    build(32, config.simulation.finalSims); // warm up the JIT
    const runs: [string, number, number][] = [
      ["EV only", 0, 0],
      ["EV only + simulation", 0, config.simulation.finalSims],
      [`S = ${config.lineups.scenarios}`, config.lineups.scenarios, 0],
      [`S = ${config.lineups.scenarios} + simulation`, config.lineups.scenarios, config.lineups.scenarios > 0 ? config.simulation.finalSims : 0],
    ];
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;
    const lines = runs.map(([label, S, sims]) => {
      const models = [1, 2, 3].map(() => build(S, sims));
      const total = median(models.map((m) => m.timings.total as number));
      const sim = sims > 0 ? `, simulation ${median(models.map((m) => m.timings["season simulation"] as number)).toFixed(0)} ms` : "";
      expect(total, label).toBeLessThan(5000);
      if (sims > 0) expect(models[0]?.odds, label).not.toBeNull();
      return `${label} ${total.toFixed(0)} ms${sim}`;
    });
    console.log(`[perf] Parker's league model build (median of 3): ${lines.join("; ")}`);
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

  it("gives Josh Jacobs (questionable, ESPN return week 8) Sleeper as the tiebreaker: the synthetic inputs project him this week, so the date is stale", () => {
    const id = Object.keys(snapshot.players).find((k) => snapshot.players[k]?.name === "Josh Jacobs") as string;
    expect(snapshot.players[id]).toMatchObject({ injury: "QUESTIONABLE", injuryReturnWeek: 8 });
    expect(model.players[id]?.availabilityNote).toMatchObject({ status: "QUESTIONABLE", returnWeek: 8, used: "sleeper" });
    expect(model.players[id]?.weekly[0]?.a).toBeCloseTo(config.projections.injury.QUESTIONABLE[0] as number, 12);
    // Only conflicted players carry a note.
    for (const [pid, pm] of Object.entries(model.players)) {
      const info = snapshot.players[pid];
      expect(pm.availabilityNote !== undefined, pid).toBe(info !== undefined && returnDateConflict(info, snapshot.currentWeek) !== null);
    }
  });

  it("every trade chip is an active-roster player trade search includes, worth at least chipMinGap more to another team; biggest gap first", () => {
    let chips = 0;
    for (const t of model.teams) {
      const roster = snapshot.teams.find((x) => x.id === t.id)?.roster ?? [];
      t.chips.forEach((c, i) => {
        chips++;
        expect(roster, c.playerId).toContain(c.playerId);
        expect(config.market.tradeSearchExcluded, c.playerId).not.toContain(snapshot.players[c.playerId]?.pos);
        expect(c.bestTeamId).not.toBe(t.id);
        expect(c.gap).toBeCloseTo(c.maxOther - c.cost, 9);
        expect(c.gap).toBeGreaterThanOrEqual(config.needs.chipMinGap - 1e-9);
        expect(c.cost).toBeCloseTo(t.players[c.playerId]?.mvLoseScen as number, 9);
        if (i > 0) expect(t.chips[i - 1]?.gap as number).toBeGreaterThanOrEqual(c.gap - 1e-9);
      });
    }
    expect(chips).toBeGreaterThan(0);
  });
});
