import { describe, expect, it } from "vitest";
import { normalizeEspnLeague } from "@/adapters/espn/normalize";
import { NOW, PARKER, fakeResolver, parkerBundle } from "@/adapters/espn/test-helpers";
import { expectedReturnWeek, returnDateConflict } from "./availability";
import { config } from "./config";
import type { ModelInputs, PlayerInputs } from "./inputs";
import {
  buildLeagueModel,
  buildProjectionTable,
  firstKickoff,
  gameStarted,
  leagueMarginals,
  leagueWeeks,
  nearTieRos,
  nflLastWeek,
  preKickoffTable,
  modelSettings,
  sleeperWeekLoaded,
  startablePositions,
  streamIds,
  streamedPositions,
  streamingAdds,
  tableWithStreaming,
  teamRosterScorer,
  teamWeeks,
  weekKickedOff,
  type BuildLeagueModelOptions,
  type LeagueModelConfig,
} from "./league";
import type { LeagueModel, SeasonOdds, TeamModel } from "./leagueModel";
import { prepareLeagueSlots, prepareSlots } from "./lineup";
import type { LeagueSnapshot, Pos, SlotDef, Transaction } from "./model";
import { surplusScores } from "./needs";
import { FULL_POOL, applyStep, createOptimizer, poolRestriction, type PoolRestriction, type StreamSpec } from "./optimizer";
import { gameTimeBaseRate, priorHealthyBaseRate, weeklySd } from "./projections";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import {
  evLineups,
  evStarter,
  isStreamId,
  lowestKeepValue,
  mvAddGroupPpw,
  mvAddPpw,
  positionAllows,
  ppw,
  rosterScore,
  rosValue,
  scenarioLineups,
  solveEvWeeks,
  streamingReplacement,
  teamEval,
  weekWeights,
  type ProjectionTable,
  type TableRow,
} from "./teamValue";
import { TEST_LINEUP, TEST_NOW, buildTestLeague, randomLeague, syntheticInputs, type TestLeagueSpec, type TestPlayer, type TestTeam } from "./testLeague";

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

/**
 * `league` with a waiver order the platform reports (Team.waiverRank, 1 = first claim): team ids, first claim first. One
 * free agent, one team (league.ts step 5) then allocates free agents in this order ("waiver" basis).
 */
function withWaiverOrder<L extends { snapshot: LeagueSnapshot }>(league: L, order: readonly string[]): L {
  return { ...league, snapshot: { ...league.snapshot, teams: league.snapshot.teams.map((t) => ({ ...t, waiverRank: order.indexOf(t.id) + 1 })) } };
}

/**
 * The user's team streams nothing (§7 streaming positions; the default streams K and D/ST): for the Phase 2–3
 * cases whose free-agent kickers would otherwise be its K replacement. No test league has transactions, so no
 * other team streams either.
 */
const NO_STREAMING: TradeSettings = { ...defaultTradeSettings(), streamPositions: [] };

/**
 * The projection table the model used, with the model's streaming rows (league.tableWithStreaming), and a team's
 * roster as the model values it: its players plus its streaming rows (teamValue's friendly API then prices it as
 * the model does; a position without a row is skipped).
 */
function modelTable(league: { snapshot: LeagueSnapshot; inputs: ModelInputs }, model: LeagueModel, opts: BuildLeagueModelOptions, cfg: LeagueModelConfig = config): { table: ProjectionTable; withStream: (teamId: string, roster: readonly string[]) => string[] } {
  const table = tableWithStreaming(buildProjectionTable(league.snapshot, league.inputs, opts, cfg), model, cfg);
  return { table, withStream: (teamId, roster) => [...roster, ...streamIds(model, teamId)] };
}

/**
 * The free-agent optimizer outside the model (optimizer.ts; league.ts step 5), on the projection table the model used
 * (its streaming rows included), its weeks and settings, and rosters priced through teamValue's friendly API (its own
 * solves) in the model's lineup mode (scenario lineups when scenarios ran, else EV). V*(T) comes from the model's own
 * moves (TeamModel.faMoves applied to the roster); `vrun` is this optimizer's own run of it, which the re-runs
 * (optimizer.reoptimize) start from. One free agent, one team (league.ts step 5): `pool(T)` excludes every free agent
 * another team's moves added (FULL_POOL when the model has no faAllocation: "independent"), and `vrun` runs against it:
 * greedy determinism makes that the model's own V*(T), which the model built against the earlier teams' claims only.
 */
function harness(league: { snapshot: LeagueSnapshot; inputs: ModelInputs }, model: LeagueModel, opts: BuildLeagueModelOptions, cfg: LeagueModelConfig = config) {
  const { snapshot } = league;
  const { table } = modelTable(league, model, opts, cfg);
  const slots = prepareLeagueSlots(snapshot.settings);
  const { weights } = teamWeeks(model, model.inProgressWeek, { ...cfg.lineups, playoffWeight: model.playoffWeight });
  const rostered = new Set(snapshot.teams.flatMap((t) => [...t.roster, ...t.ir, ...t.taxi]));
  const spec = (teamId: string): StreamSpec => ({ rows: streamIds(model, teamId).flatMap((id) => table.rows.get(id) ?? []), positions: model.streaming.byTeam[teamId]?.positions ?? [] });
  const opt = createOptimizer(
    {
      rows: table.rows,
      weekCount: model.weeks.length,
      slots,
      weights,
      freeAgents: snapshot.freeAgents.filter((id) => table.rows.has(id) && !rostered.has(id)),
      info: (id) => snapshot.players[id],
      positionLimits: snapshot.settings.positionLimits,
      maxRosterSize: snapshot.settings.maxRosterSize,
      dropValue: (id) => model.players[id]?.value?.value ?? 0,
      // The model's near-tie cuts (optimizer.ts's header): its tolerance, values floored at its W (the best free agent the
      // allocation leaves unclaimed: league.ts step 4, A3), so whom a move cuts is the model's (these leagues are redraft).
      dropNearTie: nearTieRos(cfg.lineups.dropNearTieWeekly, weights),
      dropValueFloor: model.market.waiverCredit,
      dynasty: null,
      // V*(T) judges its moves in scenario lineups when the model's scenarios ran, as the model's optimizer does.
      scenarios: model.scenarios,
    },
    { faMinGain: cfg.freeAgentOptimizer.faMinGain, faMaxMoves: cfg.freeAgentOptimizer.faMaxMoves, optimizerExcluded: cfg.streaming.optimizerExcluded },
  );
  const rosterOf = (teamId: string) => [...new Set(snapshot.teams.find((t) => t.id === teamId)?.roster ?? [])];
  const vstar = (teamId: string): string[] => teamOf(model, teamId).faMoves.reduce<string[]>((r, m) => applyStep(r, m), rosterOf(teamId));
  /** excl(T): every free agent another team's moves added (none under "independent"). */
  const pool = (teamId: string): PoolRestriction => (model.faAllocation ? poolRestriction(model.teams.flatMap((t) => (t.id === teamId ? [] : t.faMoves.map((m) => m.add)))) : FULL_POOL);
  /** V*(T) by this optimizer against excl(T) (the same moves as the model's: the first V* test checks it), the run the re-runs start from. */
  const vrun = (teamId: string) => opt.optimize(rosterOf(teamId), spec(teamId), undefined, pool(teamId));
  const evRos = (ids: readonly string[], teamId: string) => rosValue(evLineups([...ids, ...streamIds(model, teamId)], table, slots).lv, weights);
  const scenRos = (ids: readonly string[], teamId: string) => rosValue(scenarioLineups([...ids, ...streamIds(model, teamId)], table, slots).lv, weights);
  const ros = (ids: readonly string[], teamId: string) => (model.scenarios > 0 ? scenRos(ids, teamId) : evRos(ids, teamId));
  return { table, slots, weights, opt, spec, rosterOf, vstar, pool, vrun, evRos, scenRos, ros };
}

type HandCost = { ev: number; scen: number | null; autoAdd: string | null };

/**
 * Every lineup cost of a team by league.ts step 5's rule, priced outside the model: 0 when V*(T) dropped him, else
 * ROS(V*(T)) − ROS(V*(T − i)), V*(T − i) the optimizer's re-run from V*(T)'s roster without him with one extra move
 * (optimizer.reoptimize: at most faMaxMoves pickups, an exchange past the cap, a dropped player back into the spot he
 * leaves), floored at 0, in EV and in scenario lineups, each roster priced on its own; autoAdd = the re-run's first add.
 */
function costsByHand(league: { snapshot: LeagueSnapshot; inputs: ModelInputs }, model: LeagueModel, teamId: string, opts: BuildLeagueModelOptions, cfg: LeagueModelConfig = config): Record<string, HandCost> {
  const h = harness(league, model, opts, cfg);
  const R = h.vstar(teamId);
  const from = h.vrun(teamId);
  const out: Record<string, HandCost> = {};
  for (const id of Object.keys(teamOf(model, teamId).players)) {
    if (!R.includes(id)) {
      out[id] = { ev: 0, scen: model.scenarios > 0 ? 0 : null, autoAdd: null };
      continue;
    }
    const l = h.opt.reoptimize(
      from,
      R.filter((x) => x !== id),
      h.spec(teamId),
      1,
      [id],
      undefined,
      h.pool(teamId),
    );
    out[id] = {
      ev: Math.max(0, h.evRos(R, teamId) - h.evRos(l.roster, teamId)),
      scen: model.scenarios > 0 ? Math.max(0, h.scenRos(R, teamId) - h.scenRos(l.roster, teamId)) : null,
      autoAdd: l.moves[0]?.add ?? null,
    };
  }
  return out;
}

type BruteChip = { gap: number; cost: number; maxOther: number; bestTeamId: string };

/**
 * Every trade-chip candidate's numbers by brute force, from the rule in league.ts's header (step 6), every pair solved
 * (no bounds): V*(T′) from the model's moves; the keep value of each of its modeled players, ROS(V*(T′)) − ROS(V*(T′) −
 * k), each roster solved on its own; when it is full, the drop by lowestKeepValue over them; when V*(T′) minus that drop
 * has i's position at its limit, the drop is the lowest keep value at i's position instead (L7), and T′ is skipped when
 * nobody there can go. Then, unless under starter limits or i starts in no counted week of the base's EV lineups, the
 * optimizer's re-run from V*(T′) − drop + i with one extra move (optimizer.reoptimize); MV_add(T′, i) = max(0, ROS(that)
 * − ROS(V*(T′))) in the model's lineup mode. `pick` chooses the team among those allowed (default: the largest value,
 * ties to the smaller id).
 */
function bruteChips(
  league: { snapshot: LeagueSnapshot; inputs: ModelInputs },
  model: LeagueModel,
  opts: BuildLeagueModelOptions,
  cfg: LeagueModelConfig = config,
  pick?: (options: { teamId: string; value: number; ev: number }[]) => { teamId: string; value: number } | null,
): Map<string, BruteChip> {
  const { snapshot } = league;
  const h = harness(league, model, opts, cfg);
  const limited = h.slots.limits !== null;
  const limits = snapshot.settings.positionLimits;
  const posOf = (id: string) => snapshot.players[id]?.pos;
  const bases = snapshot.teams.map((t) => {
    const R = h.vstar(t.id);
    const full = R.length >= snapshot.settings.maxRosterSize;
    const vRos = h.ros(R, t.id);
    const keep = (id: string) => ({ id, keep: vRos - h.ros(R.filter((x) => x !== id), t.id), value: model.players[id]?.value?.value ?? 0 });
    const modeled = R.filter((id) => h.table.rows.has(id));
    const drop = full ? lowestKeepValue(modeled.map(keep)) : null;
    const b = drop ? R.filter((id) => id !== drop) : R;
    /** The base a newcomer at `pos` joins (L7), or null when the team can't take him. */
    const baseAt = (pos: Pos): string[] | null => {
      if (full && drop === null) return null;
      if (positionAllows(limits, b.flatMap((id) => posOf(id) ?? []), pos)) return b;
      const d = lowestKeepValue(modeled.filter((id) => posOf(id) === pos).map(keep));
      if (d === null) return null;
      const bp = R.filter((id) => id !== d);
      return positionAllows(limits, bp.flatMap((id) => posOf(id) ?? []), pos) ? bp : null;
    };
    return { id: t.id, vRos, vRosEv: h.evRos(R, t.id), baseAt, from: h.vrun(t.id) };
  });
  const out = new Map<string, BruteChip>();
  for (const t of snapshot.teams) {
    const tm = teamOf(model, t.id);
    for (const [id, x] of Object.entries(tm.players)) {
      const pos = posOf(id) as Pos;
      if (cfg.market.tradeSearchExcluded.includes(pos)) continue;
      const options = bases.flatMap((b) => {
        const base = b.id === t.id ? null : b.baseAt(pos);
        if (!base) return [];
        const starts = h.evRos([...base, id], b.id) - h.evRos(base, b.id) > 1e-9;
        const run = !limited && starts ? h.opt.reoptimize(b.from, [...base, id], h.spec(b.id), 1, [], undefined, h.pool(b.id)) : null;
        const after = run && (run.moves.length || run.given.length) ? [...run.roster] : [...base, id];
        return [{ teamId: b.id, value: Math.max(0, h.ros(after, b.id) - b.vRos), ev: Math.max(0, h.evRos(after, b.id) - b.vRosEv) }];
      });
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
 * (its own solves): each side's chips (the model's TeamModel.chips) that add something to the receiving team's V*, by
 * own gain (ties: the larger gap, then the smaller id); the first counts; each next one counts while maxOther −
 * cost(T − counted) ≥ chipMinGap, the cost on T − counted by step 5's rules: ROS(V*(T − counted)) − ROS(V*(T −
 * counted − i)), each the optimizer's re-run from V*(T)'s roster with one extra move per player gone (a player counted
 * never comes back), each roster priced on its own; 0 when V*(T) dropped him), at most maxPerSide; each side scored by
 * the joint gain of the chips counted. Ranked like rankPartners.
 */
function brutePartners(league: { snapshot: LeagueSnapshot; inputs: ModelInputs }, model: LeagueModel, opts: BuildLeagueModelOptions, cfg: LeagueModelConfig = config): BrutePartner[] {
  const { snapshot } = league;
  const h = harness(league, model, opts, cfg);
  const tw = teamWeeks(model, model.inProgressWeek, { ...cfg.lineups, playoffWeight: model.playoffWeight });
  const window = { from: tw.from, to: model.weeks.length };
  /** A team's V* roster with its streaming rows, as partner fit values it (EV lineups, no drop). */
  const tv = (id: string) => [...h.vstar(id), ...streamIds(model, id)];
  const costWithout = (teamId: string, gone: readonly string[], playerId: string): number => {
    const R = h.vstar(teamId);
    if (!R.includes(playerId)) return 0;
    const from = h.vrun(teamId);
    const start = R.filter((x) => !gone.includes(x));
    const out = R.length - start.length;
    const before = h.opt.reoptimize(from, start, h.spec(teamId), out, gone, undefined, h.pool(teamId));
    const after = h.opt.reoptimize(
      from,
      start.filter((x) => x !== playerId),
      h.spec(teamId),
      out + 1,
      [...gone, playerId],
      undefined,
      h.pool(teamId),
    );
    return Math.max(0, h.ros(before.roster, teamId) - h.ros(after.roster, teamId));
  };
  const side = (from: string, to: string): number => {
    const chips = teamOf(model, from)
      .chips.map((c) => ({ ...c, ppw: mvAddPpw(tv(to), c.playerId, h.table, h.slots, window) }))
      .filter((c) => c.ppw > 1e-9);
    chips.sort((a, b) => (Math.abs(b.ppw - a.ppw) > 1e-9 ? b.ppw - a.ppw : Math.abs(b.gap - a.gap) > 1e-9 ? b.gap - a.gap : a.playerId < b.playerId ? -1 : 1));
    const counted: string[] = [];
    for (const c of chips) {
      if (counted.length >= cfg.search.maxPerSide) break;
      if (counted.length === 0 || c.maxOther - costWithout(from, counted, c.playerId) >= cfg.needs.chipMinGap - 1e-9) counted.push(c.playerId);
    }
    return mvAddGroupPpw(tv(to), counted, h.table, h.slots, window);
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

  it("with no free agent to help, there's no move, and a lineup cost is ROS(T) − ROS(T − i): nobody to add in his place (also with a free agent who starts nowhere)", () => {
    for (const t of model.teams) expect(t.faMoves, `team ${t.id}`).toEqual([]);
    const hand = costsByHand(league, model, "1", { now: TEST_NOW });
    const h = harness(league, model, { now: TEST_NOW });
    const roster = h.rosterOf("1");
    for (const [id, v] of Object.entries(teamOf(model, "1").players)) {
      expect(v.mvLoseEv, id).toBeCloseTo(hand[id]?.ev as number, 9);
      expect(v.mvLoseScen as number, id).toBeCloseTo(hand[id]?.scen as number, 9);
      const without = roster.filter((x) => x !== id);
      expect(v.mvLoseScen as number, id).toBeCloseTo(Math.max(0, h.scenRos(roster, "1") - h.scenRos(without, "1")), 9);
    }
    // A 2-point free-agent RB improves no expected-value lineup (every team has an open roster spot). V*(T) judges its
    // moves in scenario lineups (review of track E, item 1): teams 2–4 have no bench, so he's depth there (he plays when a
    // starting RB is hurt), worth faMinGain or more in scenario lineups while ~0 in EV ones; team 1's bench RB already
    // covers that, so it changes nothing.
    const weak = buildTestLeague({
      teams: [
        team("1", [...starters("1").filter((x) => x.id !== "1-rb1" && x.id !== "1-rb2" && x.id !== "1-flex"), p("1-starA", "RB", 20), p("1-starB", "RB", 18), p("1-wr3", "WR", 13), p("1-bench", "RB", 10)]),
        team("2", starters("2")),
        team("3", starters("3")),
        team("4", starters("4")),
      ],
      freeAgents: [p("fa-rb", "RB", 2)],
    });
    const depthMove = (moves: readonly TeamModel["faMoves"][number][], id: string) => {
      expect(moves.map((m) => [m.add, m.drop]), `team ${id}`).toEqual([["fa-rb", null]]);
      expect(moves[0]?.gainEv as number, `team ${id}`).toBeLessThan(config.freeAgentOptimizer.faMinGain);
      expect(moves[0]?.gainScen as number, `team ${id}`).toBeGreaterThanOrEqual(config.freeAgentOptimizer.faMinGain - 1e-9);
    };
    // One free agent, one team (league.ts step 5): no team reports a waiver order, so the team he helps most (its first
    // move's scenario gain: "gain" basis) gets him, and teams 2–4 can't all add him.
    const m2 = buildLeagueModel(weak.snapshot, weak.inputs, { now: TEST_NOW });
    expect(m2.faAllocation?.basis).toBe("gain");
    expect(teamOf(m2, "1").faMoves).toEqual([]);
    const takers = ["2", "3", "4"].filter((id) => teamOf(m2, id).faMoves.length > 0);
    expect(takers).toEqual([m2.faAllocation?.order[0]]);
    depthMove(teamOf(m2, takers[0] as string).faMoves, takers[0] as string);
    expect(teamOf(m2, "1").players).toEqual(teamOf(model, "1").players);
    // Each team on its own (faAllocation "independent", Checkpoint 4's rule): all three add him.
    const each = buildLeagueModel(weak.snapshot, weak.inputs, { now: TEST_NOW, faAllocation: "independent" });
    expect(each.faAllocation).toBeUndefined();
    for (const id of ["2", "3", "4"]) depthMove(teamOf(each, id).faMoves, id);
    expect(teamOf(each, "1").players).toEqual(teamOf(model, "1").players);
    // In EV lineups (no scenarios) nobody picks him up.
    const m3 = buildLeagueModel(weak.snapshot, weak.inputs, { now: TEST_NOW, scenarios: 0 });
    for (const t of m3.teams) expect(t.faMoves, `team ${t.id}`).toEqual([]);
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

describe("lineup costs from the free-agent-optimized team (§7 MV_lose under V*; planner reply to Checkpoint 3, model change 2)", () => {
  /** Σ ω over weeks 4–17: 11 regular-season weeks and 3 playoff weeks at playoffWeight. */
  const OMEGA = 11 + 3 * config.lineups.playoffWeight;
  const OPTS = { now: TEST_NOW, scenarios: 8, settings: NO_STREAMING };
  /** Values for the non-kicking starters, so a bench player is the least valuable to lose. */
  const valued = (t: string): TestPlayer[] => starters(t).map((x, i) => (x.pos === "K" || x.pos === "DEF" ? x : { ...x, value: 3000 - 100 * i }));
  // Team 1's active roster is full (16 of 16): the nine starters and seven bench players who never start.
  const bench = [
    p("1-qb2", "QB", 12, { value: 800 }),
    p("1-rb3", "RB", 6, { value: 600 }),
    p("1-rb4", "RB", 5, { value: 500 }),
    p("1-rb5", "RB", 3, { value: 400 }),
    p("1-wr4", "WR", 7, { value: 700 }),
    p("1-b-wr", "WR", 6, { value: 650 }),
    p("1-te2", "TE", 4, { value: 300 }),
  ];
  // A 14-point free-agent WR starts over the 13-point WR2, who moves to the FLEX over the 11-point FLEX WR: +3 a week.
  const wrLeague = buildTestLeague({ teams: [team("1", [...valued("1"), ...bench]), team("2", valued("2")), team("3", valued("3")), team("4", valued("4"))], freeAgents: [p("fa-wr", "WR", 14)] });

  it("V*(T) makes the free-agent move, and lineup costs are measured from it: never below 0, a bench player nothing, a starter his edge over who replaces him", () => {
    expect(wrLeague.snapshot.teams[0]?.roster).toHaveLength(wrLeague.snapshot.settings.maxRosterSize);
    const model = buildLeagueModel(wrLeague.snapshot, wrLeague.inputs, OPTS, NO_RISK);
    const t1 = teamOf(model, "1");
    // Every bench player never starts, so dropping any of them for the free agent gains the same +3 a week (and so does
    // dropping the FLEX WR, who'd sit behind him): the least valuable goes, the backup TE.
    expect(t1.faMoves).toEqual([{ add: "fa-wr", drop: "1-te2", gainEv: expect.closeTo(3 * OMEGA, 9), gainScen: expect.closeTo(3 * OMEGA, 9) }]);
    // MV_lose by the rule, priced outside the model.
    const hand = costsByHand(wrLeague, model, "1", OPTS, NO_RISK);
    for (const [id, v] of Object.entries(t1.players)) {
      expect(v.mvLoseEv, id).toBeCloseTo(hand[id]?.ev as number, 9);
      expect(v.mvLoseScen as number, id).toBeCloseTo(hand[id]?.scen as number, 9);
      expect(v.autoAdd, id).toBe(hand[id]?.autoAdd);
      expect(v.mvLoseEv, id).toBeGreaterThanOrEqual(0);
    }
    // V*(T) dropped the backup TE: losing him costs nothing.
    expect(t1.players["1-te2"]).toMatchObject({ mvLoseEv: 0, mvLoseScen: 0, autoAdd: null });
    for (const b of bench) expect(t1.players[b.id]?.mvLoseEv, b.id).toBeCloseTo(0, 9);
    expect(t1.players["1-qb"]?.mvLoseEv).toBeCloseTo((20 - 12) * OMEGA, 9); // his 12-point backup starts
    expect(t1.players["1-wr1"]?.mvLoseEv).toBeCloseTo((15 + 14 + 13 - (14 + 13 + 11)) * OMEGA, 9); // the WRs move up, the FLEX WR comes back
    // His backup is the one V*(T) dropped: he comes back into the spot the TE leaves (a run from scratch from T − TE would
    // have put the WR in that spot instead of dropping him; review of track A2), so losing the TE costs 10 − 4 a week.
    expect(t1.players["1-te"]?.mvLoseEv).toBeCloseTo((10 - 4) * OMEGA, 9);
    expect(t1.players["1-te"]?.autoAdd).toBeNull(); // no free agent comes in: the backup does
    // The surplus score: z(value) − z(lineup cost), within the roster.
    const ids = Object.keys(t1.players);
    const expected = surplusScores(
      ids.map((id) => model.players[id]?.value?.value ?? 0),
      ids.map((id) => t1.players[id]?.mvLoseScen as number),
    );
    ids.forEach((id, i) => expect(t1.players[id]?.surplusScore, id).toBeCloseTo(expected[i] as number, 9));
  });

  it("an open active-roster spot: the team adds the free agent without dropping anyone; he goes to one team (each team on its own, all of them add him)", () => {
    // Teams 2–4 (9 of 16 players) have room: each team on its own (faAllocation "independent", Checkpoint 4's rule), the
    // same WR goes into each one's open spot.
    const each = buildLeagueModel(wrLeague.snapshot, wrLeague.inputs, { ...OPTS, faAllocation: "independent" }, NO_RISK);
    for (const id of ["2", "3", "4"]) {
      const t = teamOf(each, id);
      expect(t.faMoves, id).toEqual([{ add: "fa-wr", drop: null, gainEv: expect.closeTo(3 * OMEGA, 9), gainScen: expect.closeTo(3 * OMEGA, 9) }]);
      expect(t.players[`${id}-qb`]?.mvLoseEv).toBeCloseTo(20 * OMEGA, 9); // no backup: his whole 20 a week
    }
    // One free agent, one team (league.ts step 5): every team gains the same +3 a week from him, a tie, so snapshot order
    // decides and team 1 gets him (by a drop: its roster is full); teams 2–4 make no move, and their numbers stay as they
    // would without him.
    const model = buildLeagueModel(wrLeague.snapshot, wrLeague.inputs, OPTS, NO_RISK);
    expect(model.faAllocation).toEqual({ basis: "gain", order: ["1", "2", "3", "4"] });
    expect(teamOf(model, "1").faMoves.map((m) => m.add)).toEqual(["fa-wr"]);
    for (const id of ["2", "3", "4"]) {
      const t = teamOf(model, id);
      expect(t.faMoves, id).toEqual([]);
      expect(t.players[`${id}-qb`]?.mvLoseEv).toBeCloseTo(20 * OMEGA, 9);
    }
    // A team without a TE: a 6-point free-agent TE fills the empty spot (and starts nowhere else: TEs of 10, a FLEX of 11).
    const noTe = buildTestLeague({ teams: [team("1", starters("1").filter((x) => x.pos !== "TE")), team("2", starters("2")), team("3", starters("3"))], freeAgents: [p("fa-te", "TE", 6)] });
    const m2 = buildLeagueModel(noTe.snapshot, noTe.inputs, OPTS, NO_RISK);
    expect(teamOf(m2, "1").faMoves).toEqual([{ add: "fa-te", drop: null, gainEv: expect.closeTo(6 * OMEGA, 9), gainScen: expect.closeTo(6 * OMEGA, 9) }]);
    expect(teamOf(m2, "2").faMoves).toEqual([]);
    expect(teamOf(m2, "3").faMoves).toEqual([]);
    // Losing the K: kickers are never picked up (they're streamed or kept), so it's his whole 8 a week.
    expect(teamOf(m2, "1").players["1-k"]?.mvLoseEv).toBeCloseTo(8 * OMEGA, 9);
  });

  it("scenario mode (injury risk on): costs by the rule in both modes, never below 0, and each move's scenario gain is its own rosters' difference", () => {
    const opts = { now: TEST_NOW, scenarios: 32, settings: NO_STREAMING };
    const model = buildLeagueModel(wrLeague.snapshot, wrLeague.inputs, opts);
    const h = harness(wrLeague, model, opts);
    for (const t of model.teams) {
      const hand = costsByHand(wrLeague, model, t.id, opts);
      for (const [id, v] of Object.entries(t.players)) {
        expect(v.mvLoseEv, `${t.id} ${id}`).toBeCloseTo(hand[id]?.ev as number, 9);
        expect(v.mvLoseScen as number, `${t.id} ${id}`).toBeCloseTo(hand[id]?.scen as number, 9);
        expect(v.mvLoseScen as number, `${t.id} ${id}`).toBeGreaterThanOrEqual(0);
      }
      // The model's moves are the optimizer's, and each move's scenario gain is the rosters' scenario ROS difference.
      expect(t.faMoves.map((m) => [m.add, m.drop]), `team ${t.id}`).toEqual(h.vrun(t.id).moves.map((m) => [m.add, m.drop]));
      let roster = h.rosterOf(t.id);
      for (const m of t.faMoves) {
        const next = applyStep(roster, m);
        expect(m.gainEv, `team ${t.id} ${m.add}`).toBeCloseTo(h.evRos(next, t.id) - h.evRos(roster, t.id), 9);
        expect(m.gainScen as number, `team ${t.id} ${m.add}`).toBeCloseTo(h.scenRos(next, t.id) - h.scenRos(roster, t.id), 9);
        roster = next;
      }
      expect(t.scen?.ros).toBeCloseTo(h.scenRos(h.rosterOf(t.id), t.id), 9); // the team's own numbers are as it stands
    }
  });
});

describe("position limits in the free-agent optimizer and lineup costs (§7 roster legality: positionLimits on the active roster)", () => {
  /** Σ ω over weeks 4–17: 11 regular-season weeks and 3 playoff weeks at playoffWeight. */
  const OMEGA = 11 + 3 * config.lineups.playoffWeight;
  const OPTS = { now: TEST_NOW, scenarios: 8, settings: NO_STREAMING };
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
    expect(t1.faMoves).toEqual([]); // the free-agent QB beats no starter, and a third QB would break the limit
    expect(t1.players["1-qb"]?.autoAdd).toBe("fa-qb");
    expect(t1.players["1-qb"]?.mvLoseEv).toBeCloseTo((20 - 15) * OMEGA, 9); // the free agent, not the 12-point backup, replaces him
    expect(t1.players["1-rb5"]?.autoAdd).toBeNull(); // two QBs stay: the limit blocks a third
    const hand = costsByHand(league, model, "1", OPTS, NO_RISK);
    for (const [id, v] of Object.entries(t1.players)) {
      expect(v.autoAdd, id).toBe(hand[id]?.autoAdd);
      expect(v.mvLoseEv, id).toBeCloseTo(hand[id]?.ev as number, 9);
    }
  });

  it("a limit already reached: the free agent at that position comes in only for a player there (TE limit 2, full roster)", () => {
    const { model } = build({ positionLimits: { TE: 2 }, roster: [...starters("1"), ...bench], freeAgents: [p("fa-te", "TE", 12)] });
    const t1 = teamOf(model, "1");
    // He replaces a TE: +2 a week (the 10-point TE sits: the FLEX is the 11-point WR).
    expect(t1.faMoves).toHaveLength(1);
    expect(t1.faMoves[0]).toMatchObject({ add: "fa-te", gainEv: expect.closeTo(2 * OMEGA, 9) });
    expect(["1-te", "1-te2"]).toContain(t1.faMoves[0]?.drop);
  });

  it("an open spot doesn't get around a limit already reached: the move drops a TE (TE limit 2, 15 players)", () => {
    const { league, model } = build({ positionLimits: { TE: 2 }, roster: [...starters("1"), ...bench.filter((x) => x.id !== "1-rb5")], freeAgents: [p("fa-te", "TE", 12)] });
    expect(league.snapshot.teams[0]?.roster).toHaveLength(15);
    const t1 = teamOf(model, "1");
    expect(t1.faMoves[0]?.add).toBe("fa-te");
    expect(["1-te", "1-te2"]).toContain(t1.faMoves[0]?.drop);
  });

  it("a player without projections still counts toward a limit (and takes a roster spot), but is never the one dropped", () => {
    // 15 players; the two TEs are the 10-point starter and one without inputs: the open spot can't take the free-agent TE.
    const ghostTe = build({ positionLimits: { TE: 2 }, roster: [...starters("1"), ...bench.filter((x) => x.id !== "1-rb5" && x.id !== "1-te2"), p("1-ghost-te", "TE", 9, { noInputs: true })], freeAgents: [p("fa-te", "TE", 12)] });
    expect(ghostTe.league.snapshot.teams[0]?.roster).toHaveLength(15);
    expect(teamOf(ghostTe.model, "1").faMoves).toEqual([{ add: "fa-te", drop: "1-te", gainEv: expect.closeTo(2 * OMEGA, 9), gainScen: expect.closeTo(2 * OMEGA, 9) }]);
    // 16 players, one without inputs: the roster is full, so the better free-agent WR comes in for someone, never him.
    const full = build({ roster: [...starters("1"), ...bench.filter((x) => x.id !== "1-rb5"), p("1-ghost", "RB", 9, { noInputs: true })], freeAgents: [p("fa-wr", "WR", 14)] });
    expect(full.league.snapshot.teams[0]?.roster).toHaveLength(16);
    const moves = teamOf(full.model, "1").faMoves;
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ add: "fa-wr", gainEv: expect.closeTo(3 * OMEGA, 9) });
    expect(moves[0]?.drop).not.toBeNull();
    expect(moves[0]?.drop).not.toBe("1-ghost");
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
  // A 14-point free-agent WR (he plays tonight): each team would add him (+3 a week: he starts over the 13-point WR2, who takes
  // the FLEX from the 11-point WR).
  const league = buildTestLeague({
    teams: [team("1", roster("1", "EAR")), team("2", roster("2", "LAT")), team("3", roster("3", "LAT")), team("4", roster("4", "LAT"))],
    freeAgents: [p("fa-wr", "WR", 14, { nflTeam: "LAT" })],
    kickoffs: { 4: { EAR: EARLY, LAT: LATE } },
  });
  // Identical teams: the user's team doesn't stream either.
  const OPTS: BuildLeagueModelOptions = { now: TEST_NOW, scenarios: 8, settings: NO_STREAMING };
  /**
   * Each team optimized on its own (faAllocation "independent", Checkpoint 4's rule): under one free agent, one team only
   * one of the four identical teams can add the one free agent, so the identity checks compare the teams this way.
   */
  const EACH: BuildLeagueModelOptions = { ...OPTS, faAllocation: "independent" };

  it("one free agent, one team: identical teams tie on what he adds (the week in progress skipped), so the first in snapshot order gets him", () => {
    const model = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);
    expect(model.faAllocation).toEqual({ basis: "gain", order: ["1", "2", "3", "4"] });
    expect(teamOf(model, "1").faMoves).toEqual([{ add: "fa-wr", drop: null, gainEv: expect.closeTo(3 * OMEGA_AFTER, 9), gainScen: expect.closeTo(3 * OMEGA_AFTER, 9) }]);
    for (const id of ["2", "3", "4"]) expect(teamOf(model, id).faMoves, `team ${id}`).toEqual([]);
  });

  it("identical teams get identical strength, needs, PPW, ROS, lineup costs, trade chips and free-agent moves, whoever has played", () => {
    const model = buildLeagueModel(league.snapshot, league.inputs, EACH, NO_RISK);
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
      expect(t.faMoves, `team ${id}`).toEqual(one.faMoves);
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
    // Each team on its own adds the free agent: weeks 5–17 only.
    expect(one.faMoves).toEqual([{ add: "fa-wr", drop: null, gainEv: expect.closeTo(3 * OMEGA_AFTER, 9), gainScen: expect.closeTo(3 * OMEGA_AFTER, 9) }]);
    // Week 4 is still reported, a partial week: team 1's players have all played, team 2's haven't.
    expect(one.ev.lv[0]).toBe(0);
    expect(teamOf(model, "2").ev.lv[0]).toBe(112);
    // Players' own numbers count only the games that haven't started.
    expect(model.players["1-qb"]?.ros.total).toBeCloseTo(20 * 13, 9);
    expect(model.players["2-qb"]?.ros.total).toBeCloseTo(20 * 14, 9);
  });

  it("before any kickoff there is no week in progress and week 4 counts like any other", () => {
    const model = buildLeagueModel(league.snapshot, league.inputs, { ...EACH, now: BEFORE }, NO_RISK);
    expect(model.inProgressWeek).toBeNull();
    for (const t of model.teams) {
      expect(t.ev.lv[0], `team ${t.id}`).toBe(112);
      expect(t.ev.ros, `team ${t.id}`).toBeCloseTo(112 * OMEGA_ALL, 9);
      expect(t.ev.ppw, `team ${t.id}`).toBeCloseTo(112, 9);
      expect(t.needs, `team ${t.id}`).toEqual([]);
      expect(t.players[`${t.id}-qb`]?.mvLoseEv, `team ${t.id}`).toBeCloseTo((20 - 12) * OMEGA_ALL, 9);
      expect(t.faMoves[0]?.gainEv, `team ${t.id}`).toBeCloseTo(3 * OMEGA_ALL, 9);
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
    // A bench back (team 2's FLEX scores 13.2): no cost a week, and no "starter" tag (L5).
    expect(rb3).toEqual({ playerId: "2-rb3", gap: expect.closeTo(2 * OMEGA_AFTER, 9), cost: expect.closeTo(0, 9), maxOther: expect.closeTo(2 * OMEGA_AFTER, 9), bestTeamId: "1", costPerWeek: expect.closeTo(0, 9), starter: false });
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
      // The user's team streams K and D/ST (the default): its score counts the streaming rows, as its lineups do.
      expect(streamIds(model, "1")).toEqual(["stream:K", "stream:DEF"]);
      const { table, withStream } = modelTable(league, model, opts);
      for (const t of model.teams) {
        const roster = withStream(t.id, league.snapshot.teams.find((x) => x.id === t.id)?.roster ?? []);
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

describe("the score with pickups (Phase 4c, one baseline everywhere; TeamModel.scoreWithPickups, LeagueModel.odds)", () => {
  it("each team's V*(T) priced as TeamModel.score prices a roster; the team's own score when V*(T) made no move; the odds simulate it", () => {
    const league = randomLeague({ teams: 4, seed: 17, freeAgentsPerPosition: 4 });
    league.snapshot.schedule = range(4, 14).flatMap((week) => [
      { week, teamA: "1", teamB: String(2 + (week % 3)), isPlayoff: false },
      { week, teamA: ["3", "4", "2"][week % 3] as string, teamB: ["4", "2", "3"][week % 3] as string, isPlayoff: false },
    ]);
    for (const scenarios of [0, 16]) {
      const opts = { now: TEST_NOW, scenarios, seed: 3 };
      const model = buildLeagueModel(league.snapshot, league.inputs, opts);
      const marginals = leagueMarginals(league.snapshot, league.inputs, opts);
      const score = teamRosterScorer(league.snapshot, league.inputs, opts);
      let moved = 0;
      for (const t of model.teams) {
        const vstar = marginals.vStar(t.id);
        const priced = score(vstar?.roster ?? [], t.id);
        expect(t.scoreWithPickups?.mean, `S = ${scenarios}, team ${t.id}`).toHaveLength(model.weeks.length);
        t.scoreWithPickups?.mean.forEach((m, w) => expect(m, `S = ${scenarios}, team ${t.id}, week index ${w}`).toBeCloseTo(priced?.mean[w] as number, 9));
        t.scoreWithPickups?.sd.forEach((s, w) => expect(s, `S = ${scenarios}, team ${t.id}, week index ${w}`).toBeCloseTo(priced?.sd[w] as number, 9));
        if (vstar?.moves.length) moved++;
        else expect(t.scoreWithPickups, `S = ${scenarios}, team ${t.id}`).toEqual(t.score);
      }
      expect(moved, `S = ${scenarios}`).toBeGreaterThan(0);
      expect(model.odds).not.toBeNull();
      expect(model.odds?.teams).not.toEqual(model.oddsAsRostersStand?.teams);
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

  it("Phase 4c: the odds as rosters stand are the same either side of the first kickoff; the headline odds (with pickups) move by what the pickups add to the week under way (⚠️ the file header, Game days)", () => {
    // A 14-point free-agent WR who plays tonight. Team 1 gets him (one free agent, one team: the identical teams tie on his
    // gain, so snapshot order decides): +3 a week before the kickoff and after it (he starts over the 13-point WR2, who
    // takes the FLEX from the 11-point WR).
    const fa = buildTestLeague({
      teams: [team("1", starters("1").map((x) => ({ ...x, nflTeam: "EAR" }))), team("2", starters("2").map((x) => ({ ...x, nflTeam: "LAT" })))],
      freeAgents: [p("fa-wr", "WR", 14, { nflTeam: "LAT" })],
      kickoffs: { 4: { EAR: EARLY, LAT: LATE } },
    });
    fa.snapshot.schedule = league.snapshot.schedule;
    fa.snapshot.settings.playoffTeams = 2;
    const week4 = (odds: SeasonOdds | null | undefined): number => odds?.weekly[0]?.games.find((g) => g.teamId === "1")?.pWin as number;
    const one = (m: LeagueModel): TeamModel => teamOf(m, "1");
    for (const scenarios of [0, 16]) {
      const opts = { scenarios, sims: 2000, settings: NO_STREAMING };
      const live = buildLeagueModel(fa.snapshot, fa.inputs, { ...opts, now: TEST_NOW }, NO_RISK);
      const before = buildLeagueModel(fa.snapshot, fa.inputs, { ...opts, now: BEFORE }, NO_RISK);
      expect(live.inProgressWeek).toBe(4);
      for (const m of [live, before]) {
        expect(one(m).faMoves.map((x) => x.add), `S = ${scenarios}`).toEqual(["fa-wr"]);
        expect(teamOf(m, "2").faMoves, `S = ${scenarios}`).toEqual([]);
      }
      // As rosters stand: the same odds either side of the kickoff (only the week-under-way note is new).
      expect(live.oddsAsRostersStand?.teams, `S = ${scenarios}`).toEqual(before.oddsAsRostersStand?.teams);
      expect(live.oddsAsRostersStand?.weekly, `S = ${scenarios}`).toEqual(before.oddsAsRostersStand?.weekly);
      // With pickups: before the kickoff the pickup plays week 4 (112 + 3); once the week is under way it's held at the
      // team's score as it stands (the model plays it with today's rosters); every later week counts him either way.
      expect(one(before).scoreWithPickups?.mean[0], `S = ${scenarios}`).toBeCloseTo(115, 9);
      expect([one(live).scoreWithPickups?.mean[0], one(live).scoreWithPickups?.sd[0]], `S = ${scenarios}`).toEqual([one(live).score.mean[0], one(live).score.sd[0]]);
      expect(one(live).score.mean[0], `S = ${scenarios}`).toBeCloseTo(112, 9);
      one(live).scoreWithPickups?.mean.slice(1).forEach((x, w) => expect(x, `S = ${scenarios}, week index ${w + 1}`).toBeCloseTo(one(before).scoreWithPickups?.mean[w + 1] as number, 9));
      // So the headline's week-4 chance drops back to a coin flip with team 1's identical rival at the kickoff, the odds as
      // rosters stand don't move, and on game day the two agree about the week under way.
      expect(week4(before.odds), `S = ${scenarios}`).toBeGreaterThan(week4(live.odds));
      expect(week4(live.odds), `S = ${scenarios}`).toBe(week4(live.oddsAsRostersStand));
      // teamRosterScorer (scripts) prices V*(T)'s roster with the pickup in the week under way: only that week differs.
      const priced = teamRosterScorer(fa.snapshot, fa.inputs, { ...opts, now: TEST_NOW }, NO_RISK)([...(fa.snapshot.teams[0]?.roster ?? []), "fa-wr"], "1");
      expect(priced?.mean[0], `S = ${scenarios}`).toBeCloseTo(115, 9);
      priced?.mean.slice(1).forEach((x, w) => expect(x, `S = ${scenarios}, week index ${w + 1}`).toBeCloseTo(one(live).scoreWithPickups?.mean[w + 1] as number, 9));
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
    expect(t1.chips.find((c) => c.playerId === "1-qb2")).toEqual({ playerId: "1-qb2", gap: expect.closeTo(8 * OMEGA, 9), cost: expect.closeTo(0, 9), maxOther: expect.closeTo(8 * OMEGA, 9), bestTeamId: "2", costPerWeek: expect.closeTo(0, 9), starter: false });
    // The star is one too, with the same gap: trading him costs team 1 his edge over the backup (25 − 18) and gives team 2 25 − 10.
    // He costs team 1 his 7-point edge every week (cost ÷ Σ ω), and he starts for it (L5).
    expect(t1.chips.find((c) => c.playerId === "1-qb")).toEqual({ playerId: "1-qb", gap: expect.closeTo(8 * OMEGA, 9), cost: expect.closeTo(7 * OMEGA, 9), maxOther: expect.closeTo(15 * OMEGA, 9), bestTeamId: "2", costPerWeek: expect.closeTo(7, 9), starter: true });
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

  it("measures what he'd add against each team's free-agent-optimized roster: a free-agent upgrade doesn't create or inflate a chip (answer 1)", () => {
    // Team 2's QB scores 10, but a 16-point QB is on waivers: team 2 would add him anyway, so the backup's edge there is 18 − 16.
    const withFa = qbLeague([10, 24, 26], { freeAgents: [p("fa-qb", "QB", 16)] });
    const model = buildLeagueModel(withFa.snapshot, withFa.inputs, OPTS, NO_RISK);
    expect(teamOf(model, "2").faMoves[0]).toMatchObject({ add: "fa-qb", drop: null });
    expect(teamOf(model, "1").chips.find((c) => c.playerId === "1-qb2")).toMatchObject({ gap: expect.closeTo(2 * OMEGA, 9), maxOther: expect.closeTo(2 * OMEGA, 9), bestTeamId: "2" });
    // Without the free agent, the same backup is worth 8 a week there: the pickup would have been counted four times over.
    const without = qbLeague([10, 24, 26]);
    expect(teamOf(buildLeagueModel(without.snapshot, without.inputs, OPTS, NO_RISK), "1").chips.find((c) => c.playerId === "1-qb2")?.gap).toBeCloseTo(8 * OMEGA, 9);
    // A 17.5-point free agent leaves him half a point a week: no chip at all.
    const close = qbLeague([10, 24, 26], { freeAgents: [p("fa-qb", "QB", 17.5)] });
    expect(buildLeagueModel(close.snapshot, close.inputs, OPTS, NO_RISK).teams.flatMap((t) => t.chips)).toEqual([]);
  });

  it("makes room on a full roster by dropping the player whose loss costs its lineup least (ties: the lower value, then the id); at a position limit the lowest keep value there goes instead (L7), and only a team with nobody there to drop is skipped", () => {
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
    // Worth more than the bench TE (300), the backup QB isn't the general drop (the TE is), but a third QB would break the
    // limit: team 2 makes room at QB instead, with its lowest keep value there (the backup, who never starts), so the chip is
    // the same. (Review of track A2: the first version skipped team 2 here and the chip went unmade.)
    const pricey = league(900);
    const m2 = buildLeagueModel(pricey.snapshot, pricey.inputs, OPTS, NO_RISK);
    expect(teamOf(m2, "1").chips.find((c) => c.playerId === "1-qb2")).toMatchObject({ gap: expect.closeTo(8 * OMEGA, 9), bestTeamId: "2" });
    const priced = leagueMarginals(pricey.snapshot, pricey.inputs, OPTS, NO_RISK);
    expect(priced.mvAddBlocked("2", "1-qb2")).toBeNull();
    expect(priced.mvAdd("2", "1-qb2")).toMatchObject({ drop: "2-qb2", scen: expect.closeTo(8 * OMEGA, 9) });
    expect(priced.mvAdd("2", "1-rb1")?.drop).toBe("2-te2"); // a newcomer at another position: the general drop
    expectChipsMatch(m2, bruteChips(pricey, m2, OPTS, NO_RISK), NO_RISK);
    // Nobody at QB who can go (two QBs without projections fill the limit; only players with a model are dropped): team 2
    // can't take him, and says why. Its QB slot is empty, so he'd be worth his whole 18 a week there.
    const ghosts = buildTestLeague({
      positionLimits: { QB: 2 },
      teams: [team("1", [...valued("1", 25), p("1-qb2", "QB", 18, { value: 2000 })]), team("2", [...valued("2", 10).filter((x) => x.pos !== "QB"), p("2-gq1", "QB", 10, { noInputs: true }), p("2-gq2", "QB", 8, { noInputs: true })]), team("3", withQb("3", 24)), team("4", withQb("4", 26))],
    });
    const m3 = buildLeagueModel(ghosts.snapshot, ghosts.inputs, OPTS, NO_RISK);
    const blocked = leagueMarginals(ghosts.snapshot, ghosts.inputs, OPTS, NO_RISK);
    expect(blocked.mvAddBlocked("2", "1-qb2")).toEqual({ reason: "positionLimit", pos: "QB", limit: 2 });
    expect(blocked.mvAdd("2", "1-qb2")).toBeNull();
    expect(teamOf(m3, "1").chips).toEqual([]);
    expectChipsMatch(m3, bruteChips(ghosts, m3, OPTS, NO_RISK), NO_RISK);
  });

  it("a position limit filled by a team's own free-agent pickups doesn't block a better player: it makes room at the position (review of track A2)", () => {
    // Team 2: a 10-point QB with a week-9 bye and open roster spots; QB limit 2. Its optimizer adds a 9-point free-agent QB for
    // the bye week (+9), which fills the limit. Team 1's 18-point backup QB would still start for team 2 every week: it gives
    // back its own pickup to make room (the lowest keep value at QB), the design's MV_add from team 2's own roster:
    // ROS(V*(T2 + him)) − ROS(V*(T2)) = 8 × 14 weeks + the bye week he covers (18 − 9) + 3 playoff weeks × 1.25 × 8.
    const league = buildTestLeague({
      teams: [team("1", [...withQb("1", 25), p("1-qb2", "QB", 18)]), team("2", withQb("2", 10).map((x) => (x.pos === "QB" ? { ...x, nflTeam: "B09" } : x))), team("3", withQb("3", 24)), team("4", withQb("4", 26))],
      freeAgents: [p("fa-qb", "QB", 9)],
      byeWeek: { B09: 9 },
      positionLimits: { QB: 2 },
    });
    const opts = { now: TEST_NOW, scenarios: 0, sims: 0, settings: NO_STREAMING };
    const model = buildLeagueModel(league.snapshot, league.inputs, opts, NO_RISK);
    expect(teamOf(model, "2").faMoves).toEqual([{ add: "fa-qb", drop: null, gainEv: expect.closeTo(9, 9), gainScen: null }]);
    const marginals = leagueMarginals(league.snapshot, league.inputs, opts, NO_RISK);
    expect(marginals.mvAddBlocked("2", "1-qb2")).toBeNull();
    const add = marginals.mvAdd("2", "1-qb2");
    expect(add).toMatchObject({ drop: "fa-qb" });
    // From team 2's own roster (two QBs: legal), priced outside the model.
    const h = harness(league, model, opts, NO_RISK);
    const scratch = h.opt.optimize([...h.rosterOf("2"), "1-qb2"], h.spec("2"), undefined, h.pool("2"));
    expect(scratch.moves).toEqual([]);
    expect(add?.ev).toBeCloseTo(h.evRos(scratch.roster, "2") - h.evRos(h.vstar("2"), "2"), 9);
    expect(teamOf(model, "1").chips.find((c) => c.playerId === "1-qb2")).toMatchObject({ bestTeamId: "2", maxOther: expect.closeTo(add?.ev as number, 9) });
    expect(expectChipsMatch(model, bruteChips(league, model, opts, NO_RISK), NO_RISK)).toBeGreaterThan(0);
  });

  it("makes room with the player whose loss costs the lineup least, nobody refilling his spot: not a starting TE whose free-agent twin makes his lineup cost ~0 (review finding)", () => {
    // Team 2: a 10-point QB and a full roster whose bench players each start in a starter's bye week, so each costs something;
    // its 10-point TE (no bye) has no backup, and a 9.99-point TE is on waivers. A lineup cost refills the spot with that free
    // agent, so the TE's is ~0 (the lowest on the team), but dropping him to make room loses his 10 a week: a bench player goes
    // instead, and the backup QB stays worth his edge over team 2's QB. Injury risk on (the default config), EV and scenario
    // lineups. (Phase 3's case was a kicker; kickers are never picked up now, so the twin is a TE.)
    const two: TestPlayer[] = [
      p("2-qb", "QB", 10, { nflTeam: "B06" }),
      p("2-rb1", "RB", 15, { nflTeam: "B07" }),
      p("2-rb2", "RB", 13, { nflTeam: "B07" }),
      p("2-wr1", "WR", 15, { nflTeam: "B08" }),
      p("2-wr2", "WR", 13, { nflTeam: "B08" }),
      p("2-te", "TE", 10),
      p("2-flex", "WR", 11, { nflTeam: "B08" }),
      p("2-k", "K", 8, { nflTeam: "B10" }),
      p("2-def", "DEF", 7, { nflTeam: "B11" }),
      ...[p("2-qb2", "QB", 9), p("2-rb3", "RB", 9), p("2-rb4", "RB", 8), p("2-wr3", "WR", 9), p("2-wr4", "WR", 8), p("2-k2", "K", 5), p("2-def2", "DEF", 6)],
    ];
    // Team 2 has the first waiver claim: the twin is depth for every team without a backup TE, and one free agent goes to
    // one team (league.ts step 5), so team 2 gets him first.
    const league = (faTe: number) =>
      withWaiverOrder(
        buildTestLeague({
          teams: [team("1", [...withQb("1", 25), p("1-qb2", "QB", 18)]), team("2", two), team("3", withQb("3", 24)), team("4", withQb("4", 26))],
          freeAgents: [p("fa-te", "TE", faTe)],
          byeWeek: { B06: 6, B07: 7, B08: 8, B10: 10, B11: 11 },
        }),
        ["2", "1", "3", "4"],
      );
    const close = league(9.99);
    expect(close.snapshot.teams[1]?.roster).toHaveLength(close.snapshot.settings.maxRosterSize);
    for (const scenarios of [0, 32]) {
      const opts = { now: TEST_NOW, scenarios, seed: 7 };
      const m = buildLeagueModel(close.snapshot, close.inputs, opts);
      const t2 = teamOf(m, "2");
      const cost = (id: string) => (t2.players[id]?.mvLoseScen ?? t2.players[id]?.mvLoseEv) as number;
      if (scenarios === 0) {
        expect(t2.faMoves, `S = ${scenarios}`).toEqual([]);
        // The twin replaces him, so his lineup cost is a sliver of his 10 a week: the lowest on the team.
        expect(cost("2-te")).toBeLessThan(OMEGA);
        for (const id of Object.keys(t2.players)) if (id !== "2-te") expect(cost("2-te"), id).toBeLessThan(cost(id));
        expect(t2.players["2-te"]?.autoAdd).toBe("fa-te");
      } else {
        // Judged in scenario lineups (review of track E, item 1), the twin is a depth pickup: he plays when the TE is
        // hurt. Then the TE's lineup cost is small again (the twin is on the roster), under one week's worth.
        expect(t2.faMoves.map((m) => m.add)).toEqual(["fa-te"]);
        expect(t2.faMoves[0]?.gainScen as number).toBeGreaterThanOrEqual(config.freeAgentOptimizer.faMinGain - 1e-9);
        expect(cost("2-te")).toBeLessThan(0.25 * 10 * OMEGA); // a fraction of his 10 a week
      }
      const chip = teamOf(m, "1").chips.find((c) => c.playerId === "1-qb2");
      expect(chip?.bestTeamId, `S = ${scenarios}`).toBe("2");
      // Worth his 8-a-week edge over team 2's QB, less what the bench player who makes room was worth: far past the cut.
      expect(chip?.maxOther as number, `S = ${scenarios}`).toBeGreaterThan(5 * OMEGA);
      expect(expectChipsMatch(m, bruteChips(close, m, opts)), `S = ${scenarios}`).toBeGreaterThan(0);
      // How good the free-agent TE is doesn't change who makes room: the same chip with a 3-point one (other teams' TEs change:
      // the twin would replace them too, so only this chip is compared), and the same drop.
      const far = league(3);
      const farChip = teamOf(buildLeagueModel(far.snapshot, far.inputs, opts), "1").chips.find((c) => c.playerId === "1-qb2");
      expect(farChip, `S = ${scenarios}`).toEqual(chip);
      expect(leagueMarginals(far.snapshot, far.inputs, opts).mvAdd("2", "1-qb2")?.drop, `S = ${scenarios}`).toBe(leagueMarginals(close.snapshot, close.inputs, opts).mvAdd("2", "1-qb2")?.drop);
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

  it("matches brute force on a random league with injuries, full rosters (so drops) and position limits: every candidate, every other team", { timeout: 60_000 }, () => {
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

  it("under starter limits nothing is bounded: the best chipScreenTeams other teams by exact EV value get scenario lineups", { timeout: 60_000 }, () => {
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

  it("measures their chips against my roster after my free-agent moves (V*): a free agent I'd add anyway shrinks what they add", () => {
    // An 18-point free-agent WR: I'd add him into an open spot (my WRs become 18 and 8).
    const fa = buildTestLeague({ ...spec, freeAgents: [p("fa-wr", "WR", 18)] });
    const m = buildLeagueModel(fa.snapshot, fa.inputs, OPTS, NO_RISK);
    expect(teamOf(m, "1").faMoves[0]).toMatchObject({ add: "fa-wr", drop: null });
    const two = m.partners.find((x) => x.teamId === "2");
    expect(ppwOf(two?.theyCanGive)).toEqual([
      ["2-wr1", 22 - 8],
      ["2-wr2", 21 - 8],
      ["2-wr3", 19 - 8],
    ]);
    // Only their best WR counts (D2): with him gone, team 2 can't spare its second one. The 18-point free agent is mine (one
    // free agent, one team: league.ts step 5), so losing the second would cost team 2 his whole 21 a week, against his
    // 21 − 8 to me: no longer a chip. (Each team on its own, team 2 would add that free agent too and lose only 21 − 18.)
    expect(two?.score).toBeCloseTo(Math.sqrt((22 - 8) * 15), 9);
    const each = buildLeagueModel(fa.snapshot, fa.inputs, { ...OPTS, faAllocation: "independent" }, NO_RISK);
    expect(each.partners.find((x) => x.teamId === "2")?.score).toBeCloseTo(Math.sqrt((22 + 21 - 18 - 8) * 15), 9);
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

  // Brute force over ten models, six under starter limits, where the free-agent optimizer solves every move: seconds, not ms.
  it("counts only chips that stay chips together (D2): brute force on random leagues, EV and scenario lineups, 2 and 3 a side, and under starter limits", { timeout: 60_000 }, () => {
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
    // The user's team doesn't stream here: the free-agent K stays a free agent (streaming would make him its K replacement).
    const model = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 4, settings: NO_STREAMING }, NO_RISK);
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
    expect(t1.faMoves).toEqual([]); // kickers are never picked up
    // Before any kickoff the week counts like any other.
    const before = buildLeagueModel(league.snapshot, league.inputs, { now: new Date("2026-09-29T12:00:00.000Z"), scenarios: 4, settings: NO_STREAMING }, NO_RISK);
    const b1 = teamOf(before, "1");
    expect(before.inProgressWeek).toBeNull();
    expect(b1.ev.lv[0]).toBe(28);
    expect(b1.ev.ros).toBeCloseTo(28 * omega(11), 9);
    expect(b1.players.late).toMatchObject({ mvLoseEv: expect.closeTo(0, 9), mvLoseScen: expect.closeTo(0, 9) });
    expect(b1.players.early?.mvLoseEv).toBeCloseTo((20 - 18) * omega(11), 9);
    expect(b1.faMoves).toEqual([]);
  });

  it("carries IR and taxi players in players, an IR returner in the lineups from his return (step 5b), never a taxi player; and the ROS split and byes (§6 step 7, addition A)", () => {
    const league = buildTestLeague({
      teams: [{ id: "1", roster: [p("qb", "QB", 20, { nflTeam: "KC" })], ir: [p("hurt", "RB", 15, { injury: "IR", injuryReturnWeek: 8 })], taxi: [p("kid", "WR", 6)] }],
      byeWeek: { KC: 10 },
    });
    const model = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 4 }, NO_RISK);
    expect(Object.keys(model.players).sort()).toEqual(["hurt", "kid", "qb"]);
    // The IR RB is a returner (back in week 8: 25% / 50% / 25% over weeks 7–9): in TeamModel.players, at his lineup cost.
    expect(Object.keys(teamOf(model, "1").players)).toEqual(["qb", "hurt"]);
    expect(teamOf(model, "1").players.hurt?.autoAdd).toBeNull();
    const qb = model.players.qb;
    expect(qb?.ros.bye).toEqual({ status: "upcoming", week: 10 });
    expect(qb?.ros.total).toBeCloseTo(20 * 13, 9); // weeks 4–17 minus the bye
    expect(qb?.ros.regular).toBeCloseTo(20 * 10, 9);
    expect(qb?.ros.playoffs).toBeCloseTo(20 * 3, 9);
    expect(model.players.hurt?.weekly.slice(0, 3).every((w) => w.a < 0.5)).toBe(true);
    // He starts at RB from his return (the roster has room: no one is displaced): 15 × a in week 7 (0.25), 8 (0.75), then 15.
    const hurtRegular = 15 * (0.25 + 0.75 + 6);
    expect(teamOf(model, "1").ev.ros).toBeCloseTo(20 * 10 + hurtRegular + (20 + 15) * 3 * config.lineups.playoffWeight, 9);
    expect(teamOf(model, "1").ev.ppw).toBeCloseTo((20 * 10 + hurtRegular) / 11, 9);
    expect(teamOf(model, "1").players.hurt?.mvLoseEv).toBeCloseTo(hurtRegular + 15 * 3 * config.lineups.playoffWeight, 9);
    // Checkpoint 4's rule (irReturners false, for the report): IR players stay out of the lineups and of TeamModel.players.
    const old = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 4, irReturners: false }, NO_RISK);
    expect(Object.keys(teamOf(old, "1").players)).toEqual(["qb"]);
    expect(teamOf(old, "1").ev.ros).toBeCloseTo(20 * 10 + 20 * 3 * config.lineups.playoffWeight, 9);
    expect(teamOf(old, "1").ev.ppw).toBeCloseTo((20 * 10) / 11, 9);
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
    expect(Object.keys(timings)).toEqual(["projections", "availability scenarios", "market values", "streaming", "EV lineups and the free-agent optimizer", "scenario lineups and marginal values", "teams after their pickups", "trade chips", "needs and partners", "season simulation", "total"]);
    expect(timings.total).toBe(10);
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
      // The active roster and the IR returners (step 5b: IR players expected back within the weeks), nobody else.
      const back = t.ir.filter((id) => {
        const info = snapshot.players[id];
        const ctx = { weeks: model.weeks, currentWeek: snapshot.currentWeek, hasTeam: !!info?.nflTeam, lastNflWeek: 18 };
        return info !== undefined && expectedReturnWeek(info, ctx) !== null;
      });
      expect(Object.keys(tm.players).sort()).toEqual([...new Set([...t.roster, ...back])].sort());
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

  it("no lineup cost is below 0, and every free-agent move adds a free agent (never K or DEF), worth faMinGain, at most faMaxMoves a team", () => {
    const freeAgents = new Set(snapshot.freeAgents);
    for (const t of model.teams) {
      for (const [id, v] of Object.entries(t.players)) {
        expect(v.mvLoseEv, `${t.id} ${id}`).toBeGreaterThanOrEqual(0);
        expect(v.mvLoseScen as number, `${t.id} ${id}`).toBeGreaterThanOrEqual(0);
      }
      expect(t.faMoves.length).toBeLessThanOrEqual(config.freeAgentOptimizer.faMaxMoves);
      let roster = [...new Set(snapshot.teams.find((x) => x.id === t.id)?.roster ?? [])];
      for (const m of t.faMoves) {
        expect(freeAgents.has(m.add), m.add).toBe(true);
        expect(config.streaming.optimizerExcluded).not.toContain(snapshot.players[m.add]?.pos);
        // Judged in scenario lineups when they ran (review of track E, item 1).
        expect(model.scenarios > 0 ? (m.gainScen as number) : m.gainEv).toBeGreaterThanOrEqual(config.freeAgentOptimizer.faMinGain - 1e-9);
        if (m.drop !== null) expect(roster, m.drop).toContain(m.drop);
        else expect(roster.length).toBeLessThan(snapshot.settings.maxRosterSize);
        roster = applyStep(roster, m);
      }
      // A player the optimizer dropped costs nothing.
      for (const m of t.faMoves) if (m.drop !== null && t.players[m.drop]) expect(t.players[m.drop]).toMatchObject({ mvLoseEv: 0, mvLoseScen: 0, autoAdd: null });
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

  it("tags a chip 'starter' from his team after its pickups (V*(T), the roster his cost is measured from): never one they drop (review of track A2)", () => {
    // Before the review's fix, four chips here were tagged starter (from the team as it stands) while V*(T) dropped them, so
    // each read "costs you 0.0 pts/wk · starter" (KC Concepcion, Nico Collins, Jonathan Taylor, Zay Flowers).
    // Both lineup modes (V*(T) judges its moves in each mode's lineups, so each drops different players).
    let dropped = 0;
    let starters = 0;
    for (const [m, opts] of [
      [model, { now: NOW }],
      [buildLeagueModel(snapshot, inputs, { now: NOW, scenarios: 0 }), { now: NOW, scenarios: 0 }],
    ] as const) {
      const h = harness({ snapshot, inputs }, m, opts);
      for (const t of m.teams) {
        const vstar = h.vstar(t.id);
        const { starters: seated } = evLineups([...vstar, ...streamIds(m, t.id)], h.table, h.slots);
        for (const c of t.chips) {
          if (!vstar.includes(c.playerId)) {
            dropped++;
            expect(c.starter, c.playerId).toBe(false);
            expect(c.cost, c.playerId).toBe(0);
            continue;
          }
          // The rule (teamValue.evStarter) on V*(T)'s EV lineups: seated in at least half of the counted weeks he plays.
          let plays = 0;
          let seats = 0;
          m.weeks.forEach((_, w) => {
            if (!((h.weights[w] ?? 0) > 0) || !((m.players[c.playerId]?.weekly[w]?.p ?? 0) > 0)) return;
            plays++;
            if (seated[w]?.some((x) => x.id === c.playerId)) seats++;
          });
          expect(c.starter, c.playerId).toBe(plays > 0 && 2 * seats >= plays);
          if (c.starter) starters++;
        }
      }
    }
    // Since V*(T) judges its moves in scenario lineups (review of track E, item 1), no chip in this fixture is one V*(T)
    // drops, in either mode: the dropped branch above is checked whenever it occurs (and the rule's code path is the
    // same), the starter rule on every chip.
    expect(dropped).toBeGreaterThanOrEqual(0);
    expect(starters).toBeGreaterThan(0);
  });
});

describe("streaming positions (§7; planner reply to Checkpoint 3, model change 1; lead decision L1)", () => {
  /** Free-agent kickers of 10, 9 (bye in week 6), 8 and 7.5 a week: the 3rd best is 8, and 7.5 in week 6. */
  const faKs = (): TestPlayer[] => [p("fa-k1", "K", 10), p("fa-k2", "K", 9, { nflTeam: "BYE6" }), p("fa-k3", "K", 8), p("fa-k4", "K", 7.5)];
  const BYES = { BYE6: 6, BYE7: 7 };
  const OPTS = { now: TEST_NOW, scenarios: 0, sims: 0 };
  /** Σ ω over weeks 4–17: 11 regular-season weeks and 3 playoff weeks at playoffWeight. */
  const OMEGA = 11 + 3 * config.lineups.playoffWeight;
  /** Settings in which my team (team 1) streams `positions`. */
  const streaming = (positions: Pos[]): TradeSettings => ({ ...defaultTradeSettings(), streamPositions: positions });

  it("the replacement each week is the streamRank-th best free agent there by that week's expected points (fewer: the last one; none: 0)", () => {
    expect(config.streaming.streamRank).toBe(3);
    const league = buildTestLeague({ teams: [team("1", starters("1")), team("2", starters("2"))], freeAgents: [...faKs(), p("fa-def1", "DEF", 6), p("fa-def2", "DEF", 5)], byeWeek: BYES });
    const model = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);
    const W = model.weeks.length;
    // Weeks 4–17: 10, 9, 8, 7.5 → 8; week 6, the 9-point kicker on bye: 10, 8, 7.5, 0 → 7.5.
    expect(model.streaming.replacement.K).toEqual(model.weeks.map((w) => (w === 6 ? 7.5 : 8)));
    // Two free-agent D/STs, fewer than 3: the last (worse) one.
    expect(model.streaming.replacement.DEF).toEqual(new Array(W).fill(5));
    // The table's own function, ties included: equal points give the same value whoever holds them; a rank below 1 reads as 1.
    const rows = (pts: number[][]): TableRow[] =>
      pts.map((ev, i) => ({ id: `r${i}`, pos: "K", eligible: ["K"], cond: Float64Array.from(ev), ev: Float64Array.from(ev), condSd: new Float64Array(ev.length), evSd: new Float64Array(ev.length), flags: null }));
    expect([...streamingReplacement(rows([[5, 5], [9, 5], [5, 1]]), 2, 3)]).toEqual([5, 1]);
    expect([...streamingReplacement(rows([[5, 5], [9, 5], [5, 1]]), 2, 1)]).toEqual([9, 5]);
    expect([...streamingReplacement(rows([[5, 5], [9, 5], [5, 1]]), 2, 0)]).toEqual([9, 5]);
    expect([...streamingReplacement([], 3, 3)]).toEqual([0, 0, 0]);
    // No free agent at a streamed position: a replacement of 0 and no row, so the slot counts the team's own players alone.
    const none = buildTestLeague({ teams: [team("1", starters("1")), team("2", starters("2"))] });
    const m0 = buildLeagueModel(none.snapshot, none.inputs, OPTS, NO_RISK);
    expect(m0.streaming.byTeam["1"]?.positions).toEqual(["K", "DEF"]);
    expect(m0.streaming.replacement).toEqual({ K: new Array(W).fill(0), DEF: new Array(W).fill(0) });
    const plain = buildLeagueModel(none.snapshot, none.inputs, { ...OPTS, settings: NO_STREAMING }, NO_RISK);
    expect(m0.teams.map((t) => t.ev)).toEqual(plain.teams.map((t) => t.ev));
    expect(m0.warnings).toEqual(plain.warnings);
  });

  it("detection: 2+ adds at a streamable position this season (add and waiver moves to the team, at the move's position or the player's); unknown positions, trades and drops don't count; my team follows my setting", () => {
    const league = buildTestLeague({ teams: ["1", "2", "3", "4", "5"].map((id) => team(id, starters(id))), freeAgents: faKs(), byeWeek: BYES });
    const add = (to: string, playerId: string, pos?: Pos, type: Transaction["type"] = "add"): Transaction => ({
      id: `${to}-${playerId}-${type}`,
      type,
      week: 2,
      timestamp: "2026-09-16T10:00:00.000Z",
      teams: [to],
      moves: [{ playerId, from: null, to, ...(pos ? { pos } : {}) }, { playerId: `${to}-dropped`, from: to, to: null, pos: "K" }],
    });
    league.snapshot.transactions = [
      // Team 2: a kicker the snapshot no longer knows (the move says K) and one it knows: streams K.
      add("2", "gone-k", "K"),
      add("2", "fa-k4"),
      // Team 3: an add and a waiver claim at D/ST: streams DEF. Two D/STs that came by trade don't count.
      add("3", "x-def1", "DEF"),
      add("3", "x-def2", "DEF", "waiver"),
      add("3", "t-def1", "DEF", "trade"),
      add("3", "t-def2", "DEF", "trade"),
      // Team 4: two adds of players whose position is unknown, and one kicker: no stream.
      add("4", "mystery-1"),
      add("4", "mystery-2"),
      add("4", "fa-k3"),
      // Team 5: two adds at QB (streamable, and the lineup starts one): streams QB. Two RBs aren't streamable.
      add("5", "x-qb1", "QB"),
      add("5", "x-qb2", "QB"),
      add("5", "x-rb1", "RB"),
      add("5", "x-rb2", "RB"),
      // Me: three adds at TE, but I stream only what my setting says.
      add("1", "x-te1", "TE"),
      add("1", "x-te2", "TE"),
      add("1", "x-te3", "TE"),
    ];
    const model = buildLeagueModel(league.snapshot, league.inputs, { ...OPTS, settings: streaming(["K"]) }, NO_RISK);
    expect(model.streaming.byTeam).toEqual({
      "1": { positions: ["K"], source: "setting", adds: { TE: 3 } },
      "2": { positions: ["K"], source: "detected", adds: { K: 2 } },
      "3": { positions: ["DEF"], source: "detected", adds: { DEF: 2 } },
      "4": { positions: [], source: "detected", adds: { K: 1 } },
      "5": { positions: ["QB"], source: "detected", adds: { QB: 2 } },
    });
    expect(streamingAdds(league.snapshot, config.streaming.streamable).get("1")).toEqual({ TE: 3 });
    // Without a team of mine, every team is detected (team 1 by its TE adds).
    expect(streamedPositions(league.snapshot, null, defaultTradeSettings())["1"]).toEqual({ positions: ["TE"], source: "detected", adds: { TE: 3 } });
    // Only positions the lineup starts: in a league without a kicker, nobody streams K, whatever the setting or the adds.
    const noK = { ...league.snapshot, settings: { ...league.snapshot.settings, lineup: TEST_LINEUP.filter((s) => s.slot !== "K") } };
    const byTeam = streamedPositions(noK, "1", streaming(["K", "DEF"]));
    expect(byTeam["1"]?.positions).toEqual(["DEF"]);
    expect(byTeam["2"]?.positions).toEqual([]);
    expect(startablePositions(noK.settings)).toEqual(new Set(["QB", "RB", "WR", "TE", "DEF"]));
  });

  it("a streamed slot is worth max(the best rostered player, the replacement) every week, exactly, in EV and scenario lineups; other teams are untouched", () => {
    // My kicker scores 7.75 with a bye in week 7; the replacement is 8 (7.5 in week 6).
    const roster = starters("1").map((x) => (x.pos === "K" ? { ...x, points: 7.75, nflTeam: "BYE7" } : x));
    const league = buildTestLeague({ teams: [team("1", roster), team("2", starters("2"))], freeAgents: faKs(), byeWeek: BYES });
    for (const scenarios of [0, 8]) {
      const opts = { ...OPTS, scenarios };
      const on = buildLeagueModel(league.snapshot, league.inputs, { ...opts, settings: streaming(["K"]) }, NO_RISK);
      const off = buildLeagueModel(league.snapshot, league.inputs, { ...opts, settings: NO_STREAMING }, NO_RISK);
      const rep = on.streaming.replacement.K as number[];
      const [mine, before] = [teamOf(on, "1"), teamOf(off, "1")];
      on.weeks.forEach((w, i) => {
        const gain = Math.max(0, (rep[i] as number) - (w === 7 ? 0 : 7.75));
        expect((mine.ev.lv[i] as number) - (before.ev.lv[i] as number), `S ${scenarios}, week ${w}`).toBeCloseTo(gain, 9);
        if (scenarios) expect((mine.scen?.lv[i] as number) - (before.scen?.lv[i] as number), `S ${scenarios}, week ${w}`).toBeCloseTo(gain, 9);
      });
      // +0.25 a week in 9 regular-season weeks and the 3 playoff weeks (weighted), +0 in week 6 (7.5 < 7.75), +8 in his bye week.
      expect(mine.ev.ros - before.ev.ros).toBeCloseTo(9 * 0.25 + 8 + 3 * 0.25 * config.lineups.playoffWeight, 9);
      expect(teamOf(on, "2").ev).toEqual(teamOf(off, "2").ev);
      expect(teamOf(on, "2").score).toEqual(teamOf(off, "2").score);
    }
  });

  it("a team that streams K has no K need, while the same kicker unstreamed is one; its K strength is the replacement's", () => {
    // My kicker scores 3; everyone else's 8, and so does the replacement (10, 9, 8 and 7.5 on waivers, no byes).
    const weakK = starters("1").map((x) => (x.pos === "K" ? { ...x, points: 3 } : x));
    const league = buildTestLeague({ teams: [team("1", weakK), team("2", starters("2")), team("3", starters("3")), team("4", starters("4"))], freeAgents: faKs().map((k) => ({ ...k, nflTeam: "AAA" })) });
    const on = buildLeagueModel(league.snapshot, league.inputs, { ...OPTS, scenarios: 8, settings: streaming(["K"]) }, NO_RISK);
    const off = buildLeagueModel(league.snapshot, league.inputs, { ...OPTS, scenarios: 8, settings: NO_STREAMING }, NO_RISK);
    expect(teamOf(off, "1").needs.find((n) => n.slot === "K1")).toMatchObject({ window: "ros" });
    expect(teamOf(off, "1").strength.K1?.ros).toBeCloseTo(3, 9);
    expect(teamOf(on, "1").needs.find((n) => n.slot === "K1")).toBeUndefined();
    expect(teamOf(on, "1").strength.K1).toMatchObject({ ros: expect.closeTo(8, 9), next: expect.closeTo(8, 9), zRos: expect.closeTo(0, 9), zNext: expect.closeTo(0, 9) });
  });

  it("common random numbers are unchanged for real players: streaming adds a row (flags all 1), never changes a player's projection or draws", () => {
    const league = randomLeague({ teams: 4, seed: 31, freeAgentsPerPosition: 5 });
    const opts = { now: TEST_NOW, scenarios: 8, seed: 4, sims: 0 };
    const on = buildLeagueModel(league.snapshot, league.inputs, opts);
    const off = buildLeagueModel(league.snapshot, league.inputs, { ...opts, settings: NO_STREAMING });
    expect(on.players).toEqual(off.players);
    expect(Object.keys(on.players).some(isStreamId)).toBe(false);
    const built = buildProjectionTable(league.snapshot, league.inputs, opts);
    const table = tableWithStreaming(built, on);
    for (const [id, row] of built.table.rows) expect(table.rows.get(id), id).toBe(row);
    for (const pos of ["K", "DEF"] as const) {
      const row = table.rows.get(`stream:${pos}`) as TableRow;
      expect(row).toMatchObject({ id: `stream:${pos}`, pos, eligible: [pos] });
      expect([...(row.flags as Uint8Array)]).toEqual(new Array(8 * on.weeks.length).fill(1));
      expect([...row.ev]).toEqual(on.streaming.replacement[pos]);
      expect([...row.cond]).toEqual([...row.ev]);
      expect([...row.evSd]).toEqual([...row.ev].map((x) => weeklySd(x, pos)));
    }
    // Only my team's lineups change (nobody else streams in a league without transactions).
    for (const t of on.teams) if (t.id !== "1") expect(t.scen, `team ${t.id}`).toEqual(teamOf(off, t.id).scen);
  });

  it("the streaming row is never a player: no roster spot, lineup cost or chip, and never the one a full roster drops to make room", () => {
    // Every one of my 16 players starts (six bench spots that take RBs, WRs and TEs, and two kickers), so each costs his points
    // to lose, except my 7-point D/ST: the D/ST streamer (the replacement 6) covers him, so he costs 1. The streaming row itself
    // never starts and would cost nothing, but it is never the one dropped: making room for team 2's backup QB drops my D/ST,
    // so that QB is worth 18 − 10 a week to me, less the D/ST's 1 (dropping the row instead would have made it 8).
    const lineup: SlotDef[] = [...TEST_LINEUP.map((s) => (s.slot === "K" ? { ...s, count: 2 } : s)), { slot: "BF", count: 6, eligible: ["RB", "WR", "TE"] }];
    const mine = [...starters("1").map((x) => (x.pos === "QB" ? { ...x, points: 10 } : x)), p("1-k2", "K", 2), p("1-rb3", "RB", 6), p("1-rb4", "RB", 5), p("1-wr3", "WR", 7), p("1-wr4", "WR", 6), p("1-te2", "TE", 4), p("1-te3", "TE", 3)];
    const two = [...starters("2").map((x) => (x.pos === "QB" ? { ...x, points: 25 } : x)), p("2-qb2", "QB", 18)];
    const league = buildTestLeague({ lineup, teams: [team("1", mine), team("2", two)], freeAgents: [p("fa-def", "DEF", 6)] });
    expect(league.snapshot.teams[0]?.roster).toHaveLength(league.snapshot.settings.maxRosterSize);
    for (const scenarios of [0, 8]) {
      const opts = { now: TEST_NOW, scenarios, seed: 3, sims: 0, settings: streaming(["DEF"]) };
      const model = buildLeagueModel(league.snapshot, league.inputs, opts, NO_RISK);
      expect(streamIds(model, "1")).toEqual(["stream:DEF"]);
      for (const t of model.teams) {
        expect(Object.keys(t.players).some(isStreamId), `team ${t.id}`).toBe(false);
        expect(t.chips.some((c) => isStreamId(c.playerId)), `team ${t.id}`).toBe(false);
      }
      expect(Object.keys(teamOf(model, "1").players).sort()).toEqual(mine.map((x) => x.id).sort());
      expect(teamOf(model, "2").chips.find((c) => c.playerId === "2-qb2")).toMatchObject({ bestTeamId: "1", maxOther: expect.closeTo((18 - 10 - 1) * OMEGA, 9) });
      expect(expectChipsMatch(model, bruteChips(league, model, opts, NO_RISK), NO_RISK), `S = ${scenarios}`).toBeGreaterThan(0);
    }
  });

  it("game days: this week's replacement uses this week's points (a free agent whose game started scores 0); the simulator's week before kickoff uses the pre-kickoff ones", () => {
    const EARLY = "2026-09-29T17:00:00.000Z"; // before TEST_NOW
    const LATE = "2026-09-30T00:15:00.000Z";
    const BEFORE = new Date("2026-09-29T12:00:00.000Z");
    // The 10-point free-agent kicker played this afternoon; the others play tonight, as do both teams.
    const ks = faKs().map((k) => ({ ...k, nflTeam: k.id === "fa-k1" ? "EAR" : "LAT" }));
    const build = (kicker: number) => buildTestLeague({ teams: [team("1", starters("1").map((x) => ({ ...x, nflTeam: "LAT", ...(x.pos === "K" ? { points: kicker } : {}) }))), team("2", starters("2").map((x) => ({ ...x, nflTeam: "LAT" })))], freeAgents: ks, kickoffs: { 4: { EAR: EARLY, LAT: LATE } } });
    for (const scenarios of [0, 8]) {
      const run = (l: ReturnType<typeof build>, now: Date) => buildLeagueModel(l.snapshot, l.inputs, { ...OPTS, scenarios, now, settings: streaming(["K"]) }, NO_RISK);
      const league = build(8);
      const live = run(league, TEST_NOW);
      const before = run(league, BEFORE);
      expect(live.inProgressWeek).toBe(4);
      // Week 4 now: 9, 8, 7.5 and the 10 that has played (0) → 7.5; before kickoff → 8. Later weeks: the same both ways.
      expect(live.streaming.replacement.K?.[0]).toBe(7.5);
      expect(before.streaming.replacement.K?.[0]).toBe(8);
      expect(live.streaming.replacement.K?.slice(1)).toEqual(before.streaming.replacement.K?.slice(1));
      // An 8-point kicker beats both, so the simulator's scores match; a 7.75 one shows the difference.
      expect(teamOf(live, "1").score).toEqual(teamOf(before, "1").score);
      const weak = build(7.75);
      const live2 = run(weak, TEST_NOW);
      // The partial week counts this week's replacement (7.5 < 7.75: his own kicker); the simulator's week 4, the 8 before kickoff.
      expect(teamOf(live2, "1").ev.lv[0]).toBeCloseTo(112 - 8 + 7.75, 9);
      expect(teamOf(live2, "1").score.mean[0]).toBeCloseTo(112, 9);
      expect(teamOf(live2, "1").score).toEqual(teamOf(run(weak, BEFORE), "1").score);
    }
  });

  it("'Streaming picks this week': the best picksShown free agents at K and at DEF by this week's points, ties by id, with their opponents; one who can't play this week isn't one", () => {
    expect(config.streaming.picksShown).toBe(3);
    const league = buildTestLeague({
      teams: [team("1", starters("1")), team("2", starters("2"))],
      // Week 4: a 9.5 kicker on bye (BYE4), two at 9 (a tie: the smaller id first), an 8 and a 7.5; one D/ST.
      freeAgents: [p("k-bye", "K", 9.5, { nflTeam: "BYE4" }), p("k-b", "K", 9, { nflTeam: "BUF" }), p("k-a", "K", 9, { nflTeam: "KC" }), p("k-c", "K", 8, { nflTeam: "NYJ" }), p("k-d", "K", 7.5), p("d-1", "DEF", 6, { nflTeam: "SEA" })],
      byeWeek: { BYE4: 4 },
    });
    league.inputs.nfl.opponents = { 4: { KC: { team: "BUF", home: true }, BUF: { team: "KC", home: false }, SEA: { team: "ARI", home: false } } };
    const model = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);
    expect(model.streaming.picks).toEqual([
      { playerId: "k-a", pos: "K", projection: 9, opponent: { team: "BUF", home: true } },
      { playerId: "k-b", pos: "K", projection: 9, opponent: { team: "KC", home: false } },
      { playerId: "k-c", pos: "K", projection: 8, opponent: null },
      { playerId: "d-1", pos: "DEF", projection: 6, opponent: { team: "ARI", home: false } },
    ]);
    // Inputs from before Phase 4 have no opponents: the picks say none.
    delete league.inputs.nfl.opponents;
    expect(buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK).streaming.picks.every((x) => x.opponent === null)).toBe(true);
    // A league that starts no kicker lists no kickers; once no week is left, nothing.
    const noK = { ...league.snapshot, settings: { ...league.snapshot.settings, lineup: TEST_LINEUP.filter((s) => s.slot !== "K") } };
    expect(buildLeagueModel(noK, league.inputs, OPTS, NO_RISK).streaming.picks.map((x) => x.playerId)).toEqual(["d-1"]);
    const over = buildLeagueModel({ ...league.snapshot, currentWeek: 18 }, { ...league.inputs, currentWeek: 18 }, OPTS, NO_RISK);
    expect(over.weeks).toEqual([]);
    expect(over.streaming.picks).toEqual([]);
  });

  it("settings plumbing: my streamed positions and the playoff weight come from opts.settings (normalized), defaulting to K and D/ST and the config's weight", () => {
    const league = buildTestLeague({ teams: [team("1", starters("1")), team("2", starters("2"))], freeAgents: [...faKs(), p("fa-def", "DEF", 6), p("fa-qb", "QB", 12)], byeWeek: BYES });
    const dflt = buildLeagueModel(league.snapshot, league.inputs, OPTS, NO_RISK);
    expect(dflt.playoffWeight).toBe(config.lineups.playoffWeight);
    expect(dflt.streaming.byTeam["1"]).toMatchObject({ positions: ["K", "DEF"], source: "setting" });
    expect(modelSettings(undefined)).toEqual(defaultTradeSettings());
    // A playoff weight of 1.5 and K + QB (listed in position order).
    const custom = buildLeagueModel(league.snapshot, league.inputs, { ...OPTS, settings: { ...defaultTradeSettings(), playoffWeight: 1.5, streamPositions: ["K", "QB"] } }, NO_RISK);
    expect(custom.playoffWeight).toBe(1.5);
    expect(custom.streaming.byTeam["1"]?.positions).toEqual(["QB", "K"]);
    const t1 = teamOf(custom, "1");
    expect(t1.ev.ros).toBeCloseTo(rosValue(t1.ev.lv, weekWeights(custom.weeks, custom.regularWeeks, custom.playoffWeeks, { playoffWeight: 1.5 })), 9);
    expect(t1.ev.ros).not.toBeCloseTo(rosValue(t1.ev.lv, weekWeights(custom.weeks, custom.regularWeeks, custom.playoffWeeks)), 3);
    // Bad values fall back to their defaults (settings.ts normalizeTradeSettings): a weight out of range, RB (not streamable), a duplicate.
    const bad = buildLeagueModel(league.snapshot, league.inputs, { ...OPTS, settings: { ...defaultTradeSettings(), playoffWeight: 7, streamPositions: ["RB", "K", "K"] } }, NO_RISK);
    expect(bad.playoffWeight).toBe(config.lineups.playoffWeight);
    expect(bad.streaming.byTeam["1"]?.positions).toEqual(["K"]);
    // Without settings, a config tuned for calibration keeps its own playoff weight.
    const tuned: LeagueModelConfig = { ...NO_RISK, lineups: { ...NO_RISK.lineups, playoffWeight: 2 } };
    expect(buildLeagueModel(league.snapshot, league.inputs, OPTS, tuned).playoffWeight).toBe(2);
  });

  it("chip display (L5): cost per week = cost ÷ Σ ω over the weeks team numbers count (the setting's playoff weight, a week in progress left out); starter = in his team's EV lineup in at least half of the counted weeks he plays", () => {
    // Bo Nix behind Josh Allen: team 1's 25-point QB and an 18-point backup; team 2's QB scores 10. All play tonight.
    const withQb = (t: string, qb: number) => starters(t).map((x) => ({ ...x, nflTeam: "LAT", ...(x.pos === "QB" ? { points: qb } : {}) }));
    const league = buildTestLeague({ teams: [team("1", [...withQb("1", 25), p("1-qb2", "QB", 18, { nflTeam: "LAT" })]), team("2", withQb("2", 10))], kickoffs: { 4: { EAR: "2026-09-29T17:00:00.000Z", LAT: "2026-09-30T00:15:00.000Z" } } });
    // A game has kicked off (EAR's): week 4 is in progress, so Σ ω = 10 regular-season weeks + 3 playoff weeks × 1.5.
    const model = buildLeagueModel(league.snapshot, league.inputs, { ...OPTS, scenarios: 8, settings: { ...NO_STREAMING, playoffWeight: 1.5 } }, NO_RISK);
    expect(model.inProgressWeek).toBe(4);
    const omega = 10 + 3 * 1.5;
    const chips = teamOf(model, "1").chips;
    expect(chips.find((c) => c.playerId === "1-qb")).toMatchObject({ cost: expect.closeTo(7 * omega, 9), costPerWeek: expect.closeTo(7, 9), starter: true });
    expect(chips.find((c) => c.playerId === "1-qb2")).toMatchObject({ cost: expect.closeTo(0, 9), costPerWeek: expect.closeTo(0, 9), starter: false });
    // The rule (teamValue.evStarter): seated in at least half of the counted weeks he plays. One RB slot: a (10 a week) starts in
    // weeks 0 and 2, b (5, 12, 5, 12) in weeks 1 and 3; c never plays.
    const rb = (id: string, ev: number[]): TableRow => ({ id, pos: "RB", eligible: ["RB"], cond: Float64Array.from(ev), ev: Float64Array.from(ev), condSd: new Float64Array(ev.length), evSd: new Float64Array(ev.length), flags: null });
    const solved = solveEvWeeks(teamEval([rb("a", [10, 10, 10, 10]), rb("b", [5, 12, 5, 12]), rb("c", [0, 0, 0, 0])], prepareSlots([{ slot: "RB", count: 1, eligible: ["RB"] }])), 4);
    expect([0, 1, 2].map((k) => evStarter(solved, k, [1, 1, 1, 1]))).toEqual([true, true, false]); // 2 of 4 each: half is enough
    expect(evStarter(solved, 1, [1, 1, 0, 1])).toBe(true); // 2 of the 3 weeks that count
    expect(evStarter(solved, 1, [1, 0, 1, 0])).toBe(false); // 0 of 2
    expect(evStarter(solved, 0, [0, 0, 0, 0])).toBe(false); // no week counts
  });
});

describe("the free-agent-optimized baseline V* (§7; planner reply to Checkpoint 3, model change 2; lead decisions L2 and L3)", () => {
  /** Σ ω over weeks 4–17: 11 regular-season weeks and 3 playoff weeks at playoffWeight. */
  const OMEGA = 11 + 3 * config.lineups.playoffWeight;

  it("TeamModel.faMoves are the optimizer's moves for the roster as it stands: at most faMaxMoves, each worth faMinGain, never K, DEF or a streamed position; leagueMarginals agrees with the model", () => {
    const league = randomLeague({ teams: 6, seed: 11, freeAgentsPerPosition: 6 });
    league.snapshot.settings.positionLimits = { QB: 3, RB: 6, WR: 6, TE: 2 };
    const opts = { now: TEST_NOW, scenarios: 8, seed: 5, sims: 0 };
    const model = buildLeagueModel(league.snapshot, league.inputs, opts);
    const h = harness(league, model, opts);
    const marginals = leagueMarginals(league.snapshot, league.inputs, opts);
    const fas = new Set(league.snapshot.freeAgents);
    let moves = 0;
    for (const t of model.teams) {
      const run = h.vrun(t.id);
      expect(t.faMoves.map((m) => [m.add, m.drop]), `team ${t.id}`).toEqual(run.moves.map((m) => [m.add, m.drop]));
      expect(t.faMoves.length).toBeLessThanOrEqual(config.freeAgentOptimizer.faMaxMoves);
      for (const m of t.faMoves) {
        moves++;
        expect(fas.has(m.add), m.add).toBe(true);
        const pos = league.snapshot.players[m.add]?.pos as Pos;
        expect(config.streaming.optimizerExcluded, m.add).not.toContain(pos);
        expect(model.streaming.byTeam[t.id]?.positions, m.add).not.toContain(pos);
        if (m.drop !== null) expect(config.streaming.optimizerExcluded).not.toContain(league.snapshot.players[m.drop]?.pos);
        expect(m.gainScen as number).toBeGreaterThanOrEqual(config.freeAgentOptimizer.faMinGain - 1e-9);
      }
      // leagueMarginals: the same V*, lineup costs and autoAdds.
      const v = marginals.vStar(t.id);
      expect(v?.roster.slice().sort()).toEqual(h.vstar(t.id).slice().sort());
      expect(v?.moves).toEqual(t.faMoves);
      for (const [id, x] of Object.entries(t.players)) expect(marginals.mvLose(t.id, id)).toEqual({ ev: x.mvLoseEv, scen: x.mvLoseScen, autoAdd: x.autoAdd });
      // A chip's maxOther is the largest MV_add over the other teams (floored at 0), its team the one that gets it.
      for (const c of t.chips) {
        const values = model.teams.filter((u) => u.id !== t.id).flatMap((u) => {
          const add = marginals.mvAdd(u.id, c.playerId);
          return add ? [{ teamId: u.id, value: Math.max(0, add.scen as number) }] : [];
        });
        const best = Math.max(...values.map((x) => x.value));
        expect(c.maxOther, c.playerId).toBeCloseTo(best, 9);
        expect(values.find((x) => x.teamId === c.bestTeamId)?.value, c.playerId).toBeCloseTo(best, 9);
      }
    }
    expect(moves).toBeGreaterThan(3);
    // optimize: any roster of a team, by the same optimizer (V*(T) from the roster as it stands is the model's own).
    for (const t of model.teams) {
      const again = marginals.optimize(t.id, h.rosterOf(t.id));
      expect(again?.moves).toEqual(t.faMoves);
      expect(again?.roster.slice().sort()).toEqual(h.vstar(t.id).slice().sort());
      expect(again?.scen).toBeCloseTo(h.scenRos(h.vstar(t.id), t.id), 9);
    }
    // A roster after a trade: team 1 gives its first player to team 2 for team 2's first.
    const [give, get] = [league.snapshot.teams[0]?.roster[0] as string, league.snapshot.teams[1]?.roster[0] as string];
    const after = h.rosterOf("1").map((id) => (id === give ? get : id));
    const traded = marginals.optimize("1", after, 2);
    expect(traded?.moves.length).toBeLessThanOrEqual(2);
    expect(traded?.moves.map((m) => [m.add, m.drop])).toEqual(h.opt.optimize(after, h.spec("1"), 2, h.pool("1")).moves.map((m) => [m.add, m.drop]));
    expect(traded?.ev).toBeCloseTo(h.evRos(traded?.roster ?? [], "1"), 9);
    expect(marginals.optimize("nobody", after)).toBeNull();
    expect(marginals.vStar("nobody")).toBeNull();
    expect(marginals.mvLose("1", "nobody")).toBeNull();
    expect(marginals.mvAdd("1", league.snapshot.teams[0]?.roster[0] as string)).toBeNull(); // already on that team
  });

  it("MV_lose: 0 for a player V* drops anyway; at a team that used every move, replacing a lost starter is an exchange that must beat its cheapest pickup, as from scratch (review of track A2)", () => {
    // Team 1: a 20-point QB with a 12-point backup, the TE 10 and FLEX 11, and three bench RBs who never start. Free agents: a
    // 14-point WR (+3 a week), a 12-point TE (+2) and a 15-point QB (behind the starter, so no gain while he plays).
    const capped: LeagueModelConfig = { ...NO_RISK, freeAgentOptimizer: { ...NO_RISK.freeAgentOptimizer, faMaxMoves: 2 } };
    const roster = [...starters("1"), p("1-qb2", "QB", 12), p("1-b1", "RB", 1), p("1-b2", "RB", 1), p("1-b3", "RB", 1)];
    const build = (faQb: number) => buildTestLeague({ teams: [team("1", roster), team("2", starters("2"))], freeAgents: [p("fa-wr", "WR", 14), p("fa-te", "TE", 12), p("fa-qb", "QB", faQb)] });
    const league = build(15);
    const opts = { now: TEST_NOW, scenarios: 0, sims: 0, settings: NO_STREAMING };
    const model = buildLeagueModel(league.snapshot, league.inputs, opts, capped);
    const t1 = teamOf(model, "1");
    // Both moves used (team 1 has open spots: 13 of 16).
    expect(t1.faMoves).toEqual([
      { add: "fa-wr", drop: null, gainEv: expect.closeTo(3 * OMEGA, 9), gainScen: null },
      { add: "fa-te", drop: null, gainEv: expect.closeTo(2 * OMEGA, 9), gainScen: null },
    ]);
    // Losing the QB: a run from scratch from T − QB makes its two best moves, the free-agent QB (+3 over the 12-point backup)
    // and the WR (+3), and gives up the TE (+2). The re-run gets there by an exchange: the QB comes in, the TE pickup goes. So
    // the QB costs his 5-point edge over the free agent plus the TE pickup given up. (The first version let the re-run add the
    // QB for free, 5 a week; review of track A2.)
    expect(t1.players["1-qb"]).toMatchObject({ mvLoseEv: expect.closeTo((20 - 15 + 2) * OMEGA, 9), autoAdd: "fa-qb" });
    expect(costsByHand(league, model, "1", opts, capped)["1-qb"]?.ev).toBeCloseTo((20 - 15 + 2) * OMEGA, 9);
    const h = harness(league, model, opts, capped);
    const scratch = h.opt.optimize(h.rosterOf("1").filter((x) => x !== "1-qb"), h.spec("1"), undefined, h.pool("1"));
    expect(scratch.moves.map((m) => m.add).sort()).toEqual(["fa-qb", "fa-wr"]);
    expect(t1.players["1-qb"]?.mvLoseEv).toBeCloseTo(h.evRos(h.vstar("1"), "1") - scratch.evRos, 9);
    // A 13-point free-agent QB (+1 over the backup) doesn't beat the TE pickup (+2): no exchange, and from scratch keeps both
    // pickups too, so the QB costs his whole edge over the backup.
    const weak = build(13);
    const mw = buildLeagueModel(weak.snapshot, weak.inputs, opts, capped);
    expect(teamOf(mw, "1").players["1-qb"]).toMatchObject({ mvLoseEv: expect.closeTo((20 - 12) * OMEGA, 9), autoAdd: null });
    // With the optimizer off (faMaxMoves 0) nothing is picked up anywhere, not even after a loss: ROS(T) − ROS(T − QB).
    const off: LeagueModelConfig = { ...NO_RISK, freeAgentOptimizer: { ...NO_RISK.freeAgentOptimizer, faMaxMoves: 0 } };
    const m0 = buildLeagueModel(league.snapshot, league.inputs, opts, off);
    expect(teamOf(m0, "1").faMoves).toEqual([]);
    expect(teamOf(m0, "1").players["1-qb"]).toMatchObject({ mvLoseEv: expect.closeTo((20 - 12) * OMEGA, 9), autoAdd: null });
    // A roster at 16 drops: V*(T) swaps a never-starting bench RB for the WR, and that RB then costs nothing (nor does anyone the
    // optimizer drops).
    const full = buildTestLeague({ teams: [team("1", [...roster, p("1-b4", "RB", 1), p("1-b5", "RB", 1), p("1-b6", "RB", 1)]), team("2", starters("2"))], freeAgents: [p("fa-wr", "WR", 14)] });
    expect(full.snapshot.teams[0]?.roster).toHaveLength(16);
    const m2 = buildLeagueModel(full.snapshot, full.inputs, opts, NO_RISK);
    const dropped = teamOf(m2, "1").faMoves[0]?.drop as string;
    expect(dropped).toMatch(/^1-b\d$/);
    expect(teamOf(m2, "1").players[dropped]).toEqual({ mvLoseEv: 0, mvLoseScen: null, autoAdd: null, surplusScore: expect.any(Number) });
  });

  it("chips under V*: a player a free agent can match is never a chip (the team he'd join adds that free agent anyway)", () => {
    // Team 1: a 25-point QB and an 18-point backup; team 2's QB scores 10, teams 3 and 4's 24 and 26. An 18-point free-agent QB:
    // team 2 adds him into an open spot, so the backup adds nothing there.
    const withQb = (t: string, qb: number): TestPlayer[] => starters(t).map((x) => (x.pos === "QB" ? { ...x, points: qb } : x));
    const league = buildTestLeague({ teams: [team("1", [...withQb("1", 25), p("1-qb2", "QB", 18)]), team("2", withQb("2", 10)), team("3", withQb("3", 24)), team("4", withQb("4", 26))], freeAgents: [p("fa-qb", "QB", 18)] });
    const opts = { now: TEST_NOW, scenarios: 8 };
    const model = buildLeagueModel(league.snapshot, league.inputs, opts, NO_RISK);
    expect(teamOf(model, "2").faMoves).toEqual([{ add: "fa-qb", drop: null, gainEv: expect.closeTo(8 * OMEGA, 9), gainScen: expect.closeTo(8 * OMEGA, 9) }]);
    expect(model.teams.flatMap((t) => t.chips)).toEqual([]);
    const marginals = leagueMarginals(league.snapshot, league.inputs, opts, NO_RISK);
    expect(marginals.mvAdd("2", "1-qb2")?.scen).toBeCloseTo(0, 9);
    expect(marginals.mvAdd("2", "1-qb")?.scen).toBeCloseTo((25 - 18) * OMEGA, 9); // his edge over the free agent…
    expect(teamOf(model, "1").players["1-qb"]?.mvLoseScen).toBeCloseTo((25 - 18) * OMEGA, 9); // …is what his team loses: no gap
    expect(expectChipsMatch(model, bruteChips(league, model, opts, NO_RISK), NO_RISK)).toBe(0);
  });

  it("MV_add re-runs the optimizer: a newcomer who makes a player redundant frees his spot for a pickup the team couldn't make (Bo Nix → Team 1)", () => {
    // Team 2: a 10-point QB (its only one) and a full roster whose bench players each cover a bye week (week 9 leaves an RB slot
    // empty: both RBs are off and its one bench RB covers one; the 10-point bench WR takes the FLEX in weeks 6, 7 and 10). A
    // 7.5-point free-agent RB would fill that hole, but dropping anyone droppable for him nets less than faMinGain (kickers and
    // D/STs are never dropped by the optimizer), so V*(team 2) makes no move. Team 1's 18-point backup QB arrives
    // (the drop that makes room is a backup D/ST who never starts): team 2's old QB now sits, so the re-run drops him for the
    // free-agent RB, +7.5 in week 9 on top of the newcomer's 8 a week.
    const two: TestPlayer[] = [
      p("2-qb", "QB", 10),
      p("2-rb1", "RB", 15, { nflTeam: "B09" }),
      p("2-rb2", "RB", 13, { nflTeam: "B09" }),
      p("2-wr1", "WR", 15, { nflTeam: "B06" }),
      p("2-wr2", "WR", 13, { nflTeam: "B07" }),
      p("2-te", "TE", 10, { nflTeam: "B08" }),
      p("2-flex", "WR", 11, { nflTeam: "B10" }),
      p("2-k", "K", 8, { nflTeam: "B11" }),
      p("2-def", "DEF", 7, { nflTeam: "B12" }),
      ...[p("2-rb3", "RB", 6), p("2-wr3", "WR", 10), p("2-te2", "TE", 6), p("2-k2", "K", 5), p("2-def2", "DEF", 6), p("2-k3", "K", 4), p("2-def3", "DEF", 5)],
    ];
    const withQb = (t: string, qb: number): TestPlayer[] => starters(t).map((x) => (x.pos === "QB" ? { ...x, points: qb } : x));
    const league = buildTestLeague({
      teams: [team("1", [...withQb("1", 25), p("1-qb2", "QB", 18)]), team("2", two), team("3", withQb("3", 24)), team("4", withQb("4", 26))],
      freeAgents: [p("fa-rb", "RB", 7.5)],
      byeWeek: { B06: 6, B07: 7, B08: 8, B09: 9, B10: 10, B11: 11, B12: 12 },
    });
    expect(league.snapshot.teams[1]?.roster).toHaveLength(16);
    const opts = { now: TEST_NOW, scenarios: 0, sims: 0, settings: NO_STREAMING };
    const model = buildLeagueModel(league.snapshot, league.inputs, opts, NO_RISK);
    expect(teamOf(model, "2").faMoves).toEqual([]);
    const marginals = leagueMarginals(league.snapshot, league.inputs, opts, NO_RISK);
    const add = marginals.mvAdd("2", "1-qb2");
    expect(add).toMatchObject({ drop: "2-def3", ev: expect.closeTo((18 - 10) * OMEGA + 7.5, 9) });
    // Without the re-run (the pinned move of Phase 3) it would be the newcomer's 8 a week alone.
    const chip = teamOf(model, "1").chips.find((c) => c.playerId === "1-qb2");
    expect(chip).toMatchObject({ bestTeamId: "2", maxOther: expect.closeTo((18 - 10) * OMEGA + 7.5, 9), cost: expect.closeTo(0, 9) });
    expect(expectChipsMatch(model, bruteChips(league, model, opts, NO_RISK), NO_RISK)).toBeGreaterThan(0);
    // With no move left (faMaxMoves 0), the re-run makes none: the pinned number.
    const none: LeagueModelConfig = { ...NO_RISK, freeAgentOptimizer: { ...NO_RISK.freeAgentOptimizer, faMaxMoves: 0 } };
    expect(leagueMarginals(league.snapshot, league.inputs, opts, none).mvAdd("2", "1-qb2")?.ev).toBeCloseTo((18 - 10) * OMEGA, 9);
  });

  it("dynasty and keeper leagues with dynasty values: the optimizer never drops a player worth more than the guard over the free agent", () => {
    // Team 1 is full: the nine starters (dynasty values 3,000 down to 2,400; top 3,000, so the guard is 150) and seven bench
    // prospects worth 1,000 each who never start. A 14-point free-agent WR would replace a prospect in a redraft league (every
    // bench player ties at +3 a week, and so does the FLEX WR he'd push to the bench: the least valuable goes).
    const valuedStarters = starters("1").map((x, i) => (x.pos === "K" || x.pos === "DEF" ? x : { ...x, value: 3000 - 100 * i }));
    const prospects = [1, 2, 3, 4, 5, 6, 7].map((k) => p(`1-pr${k}`, "RB", 1, { value: 1000 }));
    const spec: TestLeagueSpec = { teams: [team("1", [...valuedStarters, ...prospects]), team("2", starters("2"))], freeAgents: [p("fa-wr", "WR", 14)] };
    const opts = { now: TEST_NOW, scenarios: 0, sims: 0, settings: NO_STREAMING };
    const redraft = buildTestLeague(spec);
    expect(teamOf(buildLeagueModel(redraft.snapshot, redraft.inputs, opts, NO_RISK), "1").faMoves).toEqual([{ add: "fa-wr", drop: "1-pr1", gainEv: expect.closeTo(3 * OMEGA, 9), gainScen: null }]);
    const dynasty = buildTestLeague({ ...spec, leagueType: "dynasty" });
    const market = dynasty.inputs.market as NonNullable<ModelInputs["market"]>;
    dynasty.inputs.market = { ...market, format: { ...market.format, isDynasty: true } };
    expect(config.freeAgentOptimizer.faDynGuard * market.topValue).toBe(150);
    // Everyone droppable is worth far more than the free agent (a floor value): no move.
    expect(teamOf(buildLeagueModel(dynasty.snapshot, dynasty.inputs, opts, NO_RISK), "1").faMoves).toEqual([]);
    // A keeper league whose dynasty list didn't load (format.isDynasty false): no guard.
    const noValues = buildTestLeague({ ...spec, leagueType: "keeper" });
    expect(teamOf(buildLeagueModel(noValues.snapshot, noValues.inputs, opts, NO_RISK), "1").faMoves).toHaveLength(1);
  });
});

describe("the Q/D/P base rate (§6 step 3; planner reply to Checkpoint 3, answer 5): this week's injury-cut projections count nowhere", () => {
  it("a questionable, doubtful or probable player's base rate leaves this week's cut out (his nearest later healthy week), this week's shape is 1, and his tag's table is applied once", () => {
    // Healthy 15 a week; this week Sleeper cut him to 7. No return date, so no tiebreaker: the tag's one-week table.
    const tagged = (injury: "QUESTIONABLE" | "DOUBTFUL" | "PROBABLE" | "ACTIVE"): TestPlayer => ({ id: `rb-${injury}`, pos: "RB", points: { ...flat(1, 17, 15), 4: 7 }, injury });
    const league = buildTestLeague({ teams: [team("1", [...starters("1"), tagged("QUESTIONABLE"), tagged("DOUBTFUL"), tagged("PROBABLE"), tagged("ACTIVE")])] });
    const model = buildLeagueModel(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 0, sims: 0 }, NO_RISK);
    const injury = config.projections.injury;
    for (const [status, now] of [
      ["QUESTIONABLE", injury.QUESTIONABLE[0]],
      ["DOUBTFUL", injury.DOUBTFUL[0]],
      ["PROBABLE", injury.PROBABLE[0]],
    ] as const) {
      const pm = model.players[`rb-${status}`] as NonNullable<LeagueModel["players"][string]>;
      const g = gameTimeBaseRate(league.inputs.players[`rb-${status}`] as PlayerInputs, { currentWeek: 4, weeks: model.weeks, espnAveraged: false });
      expect(pm.base, status).toEqual(g);
      expect(pm.base).toMatchObject({ b: 15, projNow: 15, projWeek: 5 });
      expect(pm.weekly[0]).toMatchObject({ m: 1, a: now, p: expect.closeTo(15 * (now as number), 9) });
      expect(pm.weekly[1]).toMatchObject({ m: 1, a: 1, p: 15 });
    }
    // An ACTIVE player with the same line keeps step 1: this week's 7 is his proj_now (its shape clamped to 0.8).
    const active = model.players["rb-ACTIVE"] as NonNullable<LeagueModel["players"][string]>;
    expect(active.base).toMatchObject({ projNow: 7, projWeek: 4, mNow: 0.8 });
    expect(active.weekly[0]?.p).toBeCloseTo(7, 9);
    expect(active.weekly[1]?.p).toBeCloseTo((7 / 0.8) * (15 / (202 / 14)), 9);
  });
});
