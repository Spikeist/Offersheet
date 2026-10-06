/**
 * "Waiver upgrades" (planner reply to Checkpoint 7a, §6.2; LeagueModel.waiverUpgrades; league.ts step 10 wires it): for my
 * team, every free agent who projects for more points than one of my players at his position, what picking him up adds to
 * my lineup, and whom he'd replace on my roster, in two lists (three while a week is under way). Pure and deterministic: no
 * I/O, no clock, no randomness of its own (the scenarios are the League model's draws; which games have kicked off comes in
 * as a function); the display rules come from config.waivers.
 *
 * The lists (WaiverList):
 * - "Rest of season" (WaiverUpgrades.ros): every remaining week team numbers count (the League model's TeamWeeks: a week
 *   under way is left out, its lineups locking), each counted once. The gains are the unweighted lineup points users see
 *   (planner reply to Checkpoint 7a, §6.1: "The ROS points users see stay unweighted"), not the ω-weighted ones the
 *   free-agent optimizer and the trade chips read. Positions: every one the lineup starts but the ones I stream (a streamed
 *   slot is filled from the free agents every week: the one-week lists are where they show).
 * - "This week" while the current week is under way (WaiverUpgrades.underWay; review of the Phase 7b lists: without it the
 *   page had no list for that week from its first kickoff, Thursday night, until the platform's week turned, while
 *   "Streaming picks this week", right under the section, kept listing that week's free agents still to play): the week
 *   under way, from its games still to play. ⚠️ Ours: a player whose game has kicked off is locked. Mine stay where my best
 *   lineup before the week's first kickoff put them (the League model's pre-kickoff table, WaiverInputs.underWay.preRow): a
 *   starter keeps a starting slot (his points are sunk: they cancel out of every gain), a bench player stays out; every
 *   other slot is open to my players still to play and the pickup. A free agent whose game has started scores nothing then,
 *   so he isn't listed. A player whose game has started can't be the drop (platforms lock him until the week ends; ⚠️
 *   assumed for every platform): the next one in the drop order goes, for that list only. That lineup is the model's best
 *   one, not the one actually set on the platform (the model never reads it), and a locked starter takes whichever slot
 *   leaves the most room. Null when no week is under way or none of its games is left (WaiverInputs.underWay absent).
 * - "This week", or while the current week is under way "Next week" (WaiverUpgrades.week): the first week team numbers
 *   count. Positions in both one-week lists: every one the lineup starts, the ones I stream included (the planner: "'This
 *   week' includes K and D/ST for the positions the user streams").
 *
 * Who's listed (the planner's rule): a free agent with a model, at one of the list's positions, who projects for more
 * points than at least one of my active players at his primary position (with a model), in the list's terms: rest-of-season
 * points (PlayerModel.ros.total, the League page's ROS column: it counts this week's games still to play) or the week's
 * projection (PlayerModel.weekly[w].p). Review of the Phase 7b lists: my players who score nothing in the list's terms (on
 * bye that week, out, a game already started; for the rest of the season, out for it) aren't compared, and the list names
 * them (WaiverList.idle): every free agent at the position "beat" one of them (one receiver on bye listed 51 free agents,
 * down to one projected at 0.7). ⚠️ Ours: where none of my players at his position scores (nobody there with a model, or
 * every one idle), nobody can be out-projected, yet the slot may be empty: the best config.waivers.perPositionCap free
 * agents there are listed; in the week under way, where one of mine there holds a starting slot (his game has started),
 * that slot isn't open, so only those of them who add lineup points (through a flex). And at most that many rows (the best
 * by the list's points) at config.waivers.cappedPositions (K and D/ST: only the best few matter; "Streaming picks this
 * week" lists as many) and, in a one-week list, at a position I stream.
 *
 * The lineup gain (WaiverRow.gain): ROS(R + a − k) − ROS(R) over the list's weeks. R is my active roster as it stands (the
 * list is about pickups I can make now, not after the pickups the League model expects of me), with my IR returners as the
 * League model has them (their rows join my lineups; ⚠️ no roster spot from their return: the marginal machinery's rule,
 * league.ts step 5b), in scenario lineups (the League model's own scenarios; expected-value lineups when it drew none), and:
 * - rest of season: with my streaming rows as the League model has them (a streamed QB or TE can start in a flex too);
 * - one week: ⚠️ without them (ours): that week's streaming pickup is the very decision the list helps with, so a kicker is
 *   compared with my roster as it stands, a kicker on bye included, not with the streamer the model already counts.
 * k is the engine's drop, roster legality's rules for one pickup (evaluate.ts legalSide, rules 1 and 2): nobody when my
 * active roster has an open spot (fewer players than maxRosterSize; a roster already over it is held to its own size) and
 * his position isn't at its limit; else, among my active players with a model, never the newcomer, never one a position's
 * rosterMinimums needs, never the last one at a position I stream (that slot needs its roster spot), at his position when
 * its limit binds: the lowest keep value (§7: what losing him costs R + a's lineup with nobody refilling his spot, plus, in
 * dynasty and keeper leagues with long-term values, legality's normalized market value: cost ÷ the roster's largest +
 * long-term value ÷ the top one, evaluate.ts keepValues), near-ties within config.lineups.dropNearTieWeekly a week going to
 * the lower trade value floored at W (teamValue.lowestKeepValue, as every forced drop; not with long-term values), skipping
 * one the starting lineup needs (optimizer.fillCount: every starting slot R + a can fill must stay fillable). None of them
 * left: the pickup can't be made (gain null). ⚠️ The keep values are the rest-of-season list's in every list (ours): a drop
 * is for good, and judged on one week a starter on bye that week costs nothing, so he'd be cut for a backup. Exact: keep(k)
 * = ROS(R + a) − ROS(R + a − k), so a list's gain is (ROS(R + a) − ROS(R)) − keep(k) in its own weeks and lineups, and in
 * the rest of season the lowest keep value is the largest gain (but for the near-tie and fill rules). R + a's scenario
 * lineups come from R's (teamValue.scenarioValuesAfterMove: only the scenario patterns he can get into are solved again)
 * and every keep value from them without solving (teamValue.scenarioRemovalCosts).
 *
 * "Depth only" (WaiverRow.depthOnly): he'd start in none of the list's weeks in expected-value lineups (no injuries
 * simulated) of R − k: he adds config.waivers.startsMinPoints or less there (teamValue.addGainExact). Whatever he gains then
 * comes from covering injuries and byes in the scenarios. ⚠️ Ours: the tag says why a gain is small, whatever its sign.
 *
 * Order (WaiverList.rows): by the gain as the page shows it (gainSteps, config.waivers.gainDecimals), every gain that shows
 * as no gain one tie, a pickup that can't be made last; then the list's points, then the id. So a row without gain sits
 * below every row with one (the planner: "Rows with no lineup gain still show, lower, tagged 'depth only'"; "by lineup gain,
 * then ROS points"). Review of the Phase 7b lists: comparing the raw gains let float noise (1e-14) decide between gains that
 * print the same, and ordered the "No gain" rows by small hidden losses no one can see. Whole steps keep the order total.
 *
 * ⚠️ Known approximations: an injured free agent who could go straight into an open IR slot is priced as taking an active
 * spot; a pickup's effect on the League model's other teams (one free agent, one team) isn't counted; and the gains compare
 * single pickups, each against my roster as it stands, so two rows' gains don't add up.
 */
import { config } from "./config";
import type { PlayerModel, WaiverIdle, WaiverList, WaiverRow, WaiverUpgrades } from "./leagueModel";
import type { LineupCandidate, PreparedSlots } from "./lineup";
import { POSITIONS, type Pos } from "./model";
import { fillCount } from "./optimizer";
import {
  addGainExact,
  evRemovalCosts,
  lowestKeepValue,
  maskedRow,
  rosValue,
  scenarioRemovalCosts,
  scenarioValues,
  scenarioValuesAfterMove,
  slotMask,
  solveEvWeeks,
  teamEval,
  type ProjectionTable,
  type ScenarioValues,
  type SolvedWeeks,
  type TableRow,
} from "./teamValue";

/** Points closer than this are equal (float noise, not a tunable). */
const EPS = 1e-9;

/**
 * A locked starter's points in the week under way (heldRows): more than any lineup can score, so the solver always seats
 * him, and the same before and after every pickup, so they cancel out of every gain (not a tunable).
 */
const LOCKED_POINTS = 1e5;

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The config keys the waiver lists read (config.waivers), widened for tests. */
export interface WaiverConfig {
  readonly waivers: { readonly startsMinPoints: number; readonly cappedPositions: readonly Pos[]; readonly perPositionCap: number; readonly gainDecimals: number };
}

/** "Rest of season", the week under way ("This week" while it is), or the first week team numbers count (the file header). */
export type WaiverMode = "ros" | "underWay" | "week";

/** The week under way (the file header; league.ts step 10 fills it while a week is in progress and some of its games are left). */
export interface WaiverUnderWay {
  /** Whether his NFL team's game in the week under way has kicked off (league.gameStarted). */
  started: (id: string) => boolean;
  /** His row in the table rebuilt for just before the week's first kickoff (league.ts preKickoffOf), when it has one. */
  preRow: (id: string) => TableRow | undefined;
}

/** What the waiver lists read (league.ts step 10 fills it from the League model's build: LeagueContext and my TeamWork). */
export interface WaiverInputs {
  teamId: string;
  /** The model's weeks (LeagueModel.weeks) and which are regular-season and playoff weeks. */
  weeks: readonly number[];
  regularWeeks: readonly number[];
  playoffWeeks: readonly number[];
  /** The first week index team numbers count (league.TeamWeeks.from): 1 while the current week is under way, else 0. */
  from: number;
  /** Availability scenarios the table's rows carry (0: expected-value lineups only). */
  scenarios: number;
  slots: PreparedSlots;
  /** Every modeled player's row (the League model's projection table). */
  table: ProjectionTable;
  /** Every modeled player (LeagueModel.players): his rest-of-season points and each week's projection. */
  players: Readonly<Record<string, PlayerModel>>;
  /** Position and eligibility of any rostered id or free agent, with a model or not (snapshot.players). */
  info: (id: string) => { readonly pos: Pos; readonly eligible: readonly Pos[] } | undefined;
  /** My active roster: every id takes a roster spot, with a model or not (league.TeamWork.ids). */
  roster: readonly string[];
  /** My active players with a model, in roster order (league.TeamWork.rows). */
  rows: readonly TableRow[];
  /** My streaming rows and the positions I stream (league.TeamWork.stream). */
  streamRows: readonly TableRow[];
  streamed: readonly Pos[];
  /** My IR returners' rows (league.TeamWork.stream's returners). */
  returners: readonly TableRow[];
  /** The snapshot's free agents with a model (league.LeagueContext.freeAgentIds). */
  freeAgents: readonly string[];
  /** Positions the lineup starts (league.startablePositions). */
  startable: ReadonlySet<Pos>;
  maxRosterSize: number;
  positionLimits?: Partial<Record<Pos, number>> | undefined;
  rosterMinimums?: Partial<Record<Pos, number>> | undefined;
  /** Trade value (perception) for the drop's near-ties and ties. */
  value: (id: string) => number;
  /** The waiver credit W: the near-ties' trade values are floored at it. */
  credit: number;
  /** config.lineups.dropNearTieWeekly, or 0 where keep values carry long-term values (no near-ties then). */
  nearTieWeekly: number;
  /**
   * Long-term values in dynasty and keeper leagues that have them (returners.FutureKeep, the League model's: league.ts
   * futureTerm): the drop's keep value adds each one's normalized value, as roster legality's does. Null or absent: none.
   */
  future?: { readonly value: (id: string) => number; readonly top: number } | null | undefined;
  /**
   * My lineups as I stand, over every model week, with my streaming rows and returners after my players (league.TeamWork:
   * solved, and scen with its cells kept): "Rest of season" reuses them when their rows are exactly those. Absent: solved here.
   */
  standing?: { readonly ev: SolvedWeeks; readonly scen: ScenarioValues | null } | undefined;
  /**
   * The week under way (the model's first week, `from` 1) while some of its games are left: which games have kicked off and
   * the rows from before the first one, for its "This week" list (the file header). Absent or null: no such list.
   */
  underWay?: WaiverUnderWay | null | undefined;
}

/** A candidate before pricing: who, his row, his points in the list's terms and my players he out-projects. */
interface Candidate {
  id: string;
  row: TableRow;
  points: number;
  betterThan: string[];
  /**
   * Listed only if he adds lineup points (as shown): one of the best few where none of mine plays, at a position where one
   * of mine holds a starting slot in the week under way (Frame.pinned): that slot isn't open, so a pickup there helps only
   * through another slot (a flex) and a row without gain would be noise.
   */
  needsGain: boolean;
}

/** Whether two lists hold the very same rows (objects), in order. */
function sameRows(a: readonly TableRow[], b: readonly TableRow[]): boolean {
  return a.length === b.length && a.every((r, i) => r === b[i]);
}

/** A whole number ≥ 0 from a config value (else 0). */
function count(x: number): number {
  return Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0;
}

/**
 * A lineup gain in the page's steps (`decimals`: config.waivers.gainDecimals, tenths of a point), rounded half away from
 * zero as the page prints it (format.ts fmtNum): 2.25 → 23, −0.04 → 0. Rows are ordered by it (the file header), and a gain
 * of 0 steps or fewer reads "No gain" (waiversView.ts).
 */
export function gainSteps(gain: number, decimals: number): number {
  const d = count(decimals);
  const steps = Math.round(Math.abs(gain) * 10 ** d);
  return gain < 0 && steps > 0 ? -steps : steps;
}

/** A row's place by its gain as shown: its steps, every gain of 0 steps or fewer one tie (0), a move that can't be made below them. */
function shownGain(gain: number | null, decimals: number): number {
  return gain === null ? -1 : Math.max(0, gainSteps(gain, decimals));
}

/**
 * The rows' order (WaiverList.rows; the file header): the gain as shown, most first (gainSteps: two gains that print the
 * same tie, every gain that prints as no gain is one tie, a move that can't be made last), then more points, then the
 * smaller id. Whole steps make it a total order (an epsilon comparison isn't transitive).
 */
export function compareWaiverRows(a: Pick<WaiverRow, "gain" | "points" | "playerId">, b: Pick<WaiverRow, "gain" | "points" | "playerId">, decimals: number): number {
  return shownGain(b.gain, decimals) - shownGain(a.gain, decimals) || b.points - a.points || byId(a.playerId, b.playerId);
}

/**
 * One list's frame: its weeks (each weighted 1: unweighted lineup points; a one-week list solves only the weeks up to its
 * one), positions, points, my roster's rows in its terms, and my lineups as I stand in them (ListSetup). Null when it has
 * no week to count.
 */
interface Frame {
  mode: WaiverMode;
  weekCount: number;
  weights: Float64Array;
  weeks: number[];
  positions: Pos[];
  pointsOf: (id: string) => number;
  /** My active players' rows in the frame's terms, index for index with WaiverInputs.rows (the week under way: heldRows). */
  rows: readonly TableRow[];
  /** My players whose games have started (the week under way; empty in the other lists): locked, never the drop. */
  locked: ReadonlySet<string>;
  /** Those of them held in a starting slot (heldRows): the slot isn't open to a pickup. */
  pinned: ReadonlySet<string>;
  /** Why one of my players scores nothing in the frame's terms (WaiverIdle.why). */
  idleWhy: (id: string) => WaiverIdle["why"];
  setup: ListSetup;
}

function frameOf(input: WaiverInputs, mode: WaiverMode, from: number): Frame | null {
  const W = input.weeks.length;
  // The one week a one-week list counts: the week under way (index 0, only while it is: `from` 1) or the first week team
  // numbers count.
  const at = mode === "underWay" ? 0 : from;
  if (!(at < W)) return null;
  if (mode === "underWay" && !(from === 1 && input.underWay)) return null;
  const regular = new Set(input.regularWeeks);
  const playoff = new Set(input.playoffWeeks);
  const weekCount = mode === "ros" ? W : at + 1;
  const weights = new Float64Array(weekCount);
  for (let i = mode === "ros" ? from : at; i < weekCount; i++) {
    const w = input.weeks[i] as number;
    if (regular.has(w) || playoff.has(w)) weights[i] = 1;
  }
  const weeks = input.weeks.filter((_, i) => i < weekCount && (weights[i] as number) > 0);
  if (!weeks.length) return null;
  const streamed = new Set(input.streamed);
  const positions = POSITIONS.filter((p) => input.startable.has(p) && (mode !== "ros" || !streamed.has(p)));
  const pointsOf = (id: string): number => {
    const pm = input.players[id];
    const x = mode === "ros" ? pm?.ros.total : pm?.weekly[at]?.p;
    return typeof x === "number" && Number.isFinite(x) ? x : 0;
  };
  const held = mode === "underWay" && input.underWay ? heldRows(input, input.underWay) : null;
  const rows = held?.rows ?? input.rows;
  const locked: ReadonlySet<string> = held?.locked ?? new Set<string>();
  const pinned: ReadonlySet<string> = held?.pinned ?? new Set<string>();
  const idleWhy = (id: string): WaiverIdle["why"] => {
    if (mode === "ros") return "out";
    if (locked.has(id)) return "started";
    return input.players[id]?.weekly[at]?.bye === true ? "bye" : "out";
  };
  return { mode, weekCount, weights, weeks, positions, pointsOf, rows, locked, pinned, idleWhy, setup: listSetup(input, mode, rows, weekCount, weights) };
}

/**
 * My rows for the week under way (the file header): a player whose game has started held where my best lineup before the
 * week's first kickoff put him (expected-value lineups of my active players' pre-kickoff rows; no streaming rows or
 * returners, which a lineup actually set can't hold): a starter pinned to a starting slot (lockedStarter), a bench player
 * kept out (no points that week); every other row as it is.
 */
function heldRows(input: WaiverInputs, u: WaiverUnderWay): { rows: TableRow[]; locked: Set<string>; pinned: Set<string> } {
  const locked = new Set(input.rows.filter((r) => u.started(r.id)).map((r) => r.id));
  const pinned = new Set<string>();
  if (!locked.size) return { rows: [...input.rows], locked, pinned };
  const pre = input.rows.map((r) => u.preRow(r.id) ?? r);
  const before = solveEvWeeks(teamEval(pre, input.slots), 1);
  const seat = before.seat[0];
  const pts = before.pts[0];
  const rows = input.rows.map((r, k) => {
    if (!locked.has(r.id)) return r;
    if (!((seat?.[k] ?? -1) >= 0 && (pts?.[k] ?? 0) > EPS)) return maskedRow(r, 0);
    pinned.add(r.id);
    return lockedStarter(r);
  });
  return { rows, locked, pinned };
}

/** `row` held in a starting slot in the week under way (index 0): LOCKED_POINTS in every scenario; the other weeks as they are. */
function lockedStarter(row: TableRow): TableRow {
  const W = row.cond.length;
  const first = (xs: Float64Array, v: number) => {
    const out = Float64Array.from(xs);
    if (W > 0) out[0] = v;
    return out;
  };
  let flags: Uint8Array | null = null;
  if (row.flags) {
    flags = Uint8Array.from(row.flags);
    const scenarios = W > 0 ? Math.floor(flags.length / W) : 0;
    for (let s = 0; s < scenarios; s++) flags[s * W] = 1;
  }
  return { id: row.id, pos: row.pos, eligible: row.eligible, cond: first(row.cond, LOCKED_POINTS), ev: first(row.ev, LOCKED_POINTS), condSd: first(row.condSd, 0), evSd: first(row.evSd, 0), flags };
}

/**
 * Every list for my team (the file header). The drop is a roster move for good, so every list names the same one for a
 * free agent: the rest-of-season list's (its keep values over every week team numbers count), but in the week under way
 * when he's locked (his game has started): the next one in that order. Each list prices the move over its own weeks.
 * ⚠️ Ours: judged on one week, a starter on bye that week costs nothing and would be the drop for a backup.
 */
export function waiverUpgrades(input: WaiverInputs, cfg: WaiverConfig = config): WaiverUpgrades {
  const from = Number.isFinite(input.from) ? Math.max(0, Math.floor(input.from)) : 0;
  const ros = frameOf(input, "ros", from);
  // The one-week lists' weeks are among the rest of season's (or just before them): without those there's no drop to name.
  if (!ros) return { teamId: input.teamId, ros: null, underWay: null, week: null };
  const underWay = frameOf(input, "underWay", from);
  const week = frameOf(input, "week", from);
  const drops = new Map<string, DropChoice>();
  const dropOf = (c: Candidate): DropChoice => {
    let d = drops.get(c.id);
    if (!d) {
      const priced = priceAdd(input, ros, c.row);
      d = { ...chooseDrop(input, ros, c, priced.keep), add: priced.add, keep: priced.keep };
      drops.set(c.id, d);
    }
    return d;
  };
  // A frame's drop: the shared one, unless his game has started (the week under way): then the next one in the drop order.
  const dropIn = (f: Frame, c: Candidate): DropChoice => {
    const d = dropOf(c);
    const k = d.k === null ? undefined : input.rows[d.k]?.id;
    if (k === undefined || !f.locked.has(k)) return d;
    return { ...chooseDrop(input, ros, c, d.keep, f.locked), add: d.add, keep: d.keep };
  };
  const decimals = cfg.waivers.gainDecimals;
  const listOf = (f: Frame): WaiverList => {
    const { candidates, idle } = candidatesOf(input, f, cfg);
    const rows = candidates.flatMap((c): WaiverRow[] => {
      const d = dropIn(f, c);
      const priced = f === ros ? { add: d.add, keep: d.keep } : priceAdd(input, f, c.row);
      let gain: number | null = d.possible ? priced.add - (d.k === null ? 0 : (priced.keep[d.k] as number)) : null;
      // Gains closer to 0 than float noise are 0.
      if (gain !== null && Math.abs(gain) < EPS) gain = 0;
      if (c.needsGain && !(shownGain(gain, decimals) > 0)) return [];
      // "Depth only": he'd start nowhere in my expected-value lineups without the drop, in the list's weeks.
      const ev = d.k === null ? f.setup.baseEv : f.setup.evWithout(d.k);
      const starts = addGainExact(ev, c.row, slotMask(input.slots, c.row.pos, c.row.eligible), f.weights).gain > cfg.waivers.startsMinPoints;
      return [{ playerId: c.id, points: c.points, betterThan: c.betterThan, gain, drop: d.possible ? d.drop : null, depthOnly: gain !== null && !starts }];
    });
    rows.sort((a, b) => compareWaiverRows(a, b, decimals));
    return { weeks: f.weeks, positions: f.positions, streaming: f.mode === "ros", rows, idle };
  };
  return { teamId: input.teamId, ros: listOf(ros), underWay: underWay ? listOf(underWay) : null, week: week ? listOf(week) : null };
}

/**
 * Who's listed in a frame (the file header): free agents with a model at its positions who out-project one of my players
 * there who scores in its terms, or the best few where none of mine scores; capped at K, D/ST and (one week) the positions
 * I stream. Position order, then the most points first (ties: the smaller id). With my players who score nothing (idle).
 */
function candidatesOf(input: WaiverInputs, f: Frame, cfg: WaiverConfig): { candidates: Candidate[]; idle: WaiverIdle[] } {
  const listed = new Set(f.positions);
  const streamed = new Set(input.streamed);
  // My active players with a model at each listed position who score in the frame's terms, most points first (ties: the
  // smaller id); the ones who score nothing are idle (on bye, out, a game already started): nobody "beats" them.
  const mine = new Map<Pos, { id: string; points: number }[]>();
  const idle: WaiverIdle[] = [];
  for (const r of input.rows) {
    if (!listed.has(r.pos)) continue;
    const points = f.pointsOf(r.id);
    if (!(points > EPS)) {
      idle.push({ playerId: r.id, pos: r.pos, why: f.idleWhy(r.id) });
      continue;
    }
    const list = mine.get(r.pos) ?? [];
    list.push({ id: r.id, points });
    mine.set(r.pos, list);
  }
  for (const list of mine.values()) list.sort((a, b) => b.points - a.points || byId(a.id, b.id));
  // Positions where one of mine holds a starting slot in the week under way (Frame.pinned): not an open slot.
  const heldAt = new Set(input.rows.filter((r) => f.pinned.has(r.id)).map((r) => r.pos));
  const onRoster = new Set(input.roster);
  const byPos = new Map<Pos, Candidate[]>();
  for (const id of new Set(input.freeAgents)) {
    const row = input.table.rows.get(id);
    if (!row || onRoster.has(id) || !listed.has(row.pos)) continue;
    const points = f.pointsOf(id);
    if (!(points > EPS)) continue;
    const here = mine.get(row.pos) ?? [];
    const betterThan = here.filter((m) => points > m.points + EPS).map((m) => m.id);
    if (here.length && !betterThan.length) continue;
    const list = byPos.get(row.pos) ?? [];
    list.push({ id, row, points, betterThan, needsGain: !here.length && heldAt.has(row.pos) });
    byPos.set(row.pos, list);
  }
  const cap = count(cfg.waivers.perPositionCap);
  const capped = new Set(cfg.waivers.cappedPositions);
  const candidates: Candidate[] = [];
  for (const pos of f.positions) {
    const list = (byPos.get(pos) ?? []).sort((a, b) => b.points - a.points || byId(a.id, b.id));
    const cut = capped.has(pos) || (f.mode !== "ros" && streamed.has(pos)) || !(mine.get(pos) ?? []).length;
    candidates.push(...(cut ? list.slice(0, cap) : list));
  }
  return { candidates, idle };
}

/** What every candidate of one list shares: the rows after my players, my lineups as I stand, and the drop's helpers. */
interface ListSetup {
  /** Rows after my players and the newcomer: streaming rows ("Rest of season") and returners. */
  extra: readonly TableRow[];
  baseEv: SolvedWeeks;
  baseScen: ScenarioValues | null;
  baseRosEv: number;
  baseRosScen: number | null;
  /** My lineups without roster row k (EV), for the "depth only" test: solved once per drop. */
  evWithout: (k: number) => SolvedWeeks;
  /** Players per position on my active roster (players without a model included). */
  posCount: (pos: Pos) => number;
  /** My roster's structural lineup entries (optimizer.fillCount): known players and my streaming rows, never returners. */
  entries: readonly LineupCandidate[];
}

/** The list's shared setup (ListSetup), built once per list from its rows of my players (Frame.rows). */
function listSetup(input: WaiverInputs, mode: WaiverMode, rows: readonly TableRow[], weekCount: number, weights: Float64Array): ListSetup {
  const S = count(input.scenarios);
  const extra = mode === "ros" ? [...input.streamRows, ...input.returners] : [...input.returners];
  const baseRows = [...rows, ...extra];
  // "Rest of season" prices my roster as the League model does (its streaming rows and returners after my players): its
  // own lineups when they're exactly these rows over every week; otherwise (and for one week) they're solved here.
  const standing = input.standing;
  let baseEv: SolvedWeeks;
  let baseScen: ScenarioValues | null;
  if (standing && sameRows(standing.ev.team.rows, baseRows) && standing.ev.lv.length >= weekCount && (S === 0 || (standing.scen?.cells && standing.scen.cells.weekCount >= weekCount && sameRows(standing.scen.cells.team.rows, baseRows)))) {
    baseEv = standing.ev;
    baseScen = S > 0 ? standing.scen : null;
  } else {
    const team = teamEval(baseRows, input.slots);
    baseEv = solveEvWeeks(team, weekCount);
    baseScen = S > 0 ? scenarioValues(team, weekCount, S, null, true) : null;
  }
  const without = new Map<number, SolvedWeeks>();
  const counts = new Map<Pos, number>();
  for (const id of new Set(input.roster)) {
    const pos = input.info(id)?.pos;
    if (pos !== undefined) counts.set(pos, (counts.get(pos) ?? 0) + 1);
  }
  const entries: LineupCandidate[] = [
    ...[...new Set(input.roster)].flatMap((id) => {
      const info = input.info(id);
      return info ? [{ id, pos: info.pos, eligible: info.eligible }] : [];
    }),
    ...input.streamRows.map((r) => ({ id: r.id, pos: r.pos, eligible: r.eligible })),
  ];
  return {
    extra,
    baseEv,
    baseScen,
    baseRosEv: rosValue(baseEv.lv, weights),
    baseRosScen: baseScen ? rosValue(baseScen.mean, weights) : null,
    evWithout: (k) => {
      let s = without.get(k);
      if (!s) {
        s = solveEvWeeks(
          teamEval(
            baseRows.filter((_, i) => i !== k),
            input.slots,
          ),
          weekCount,
        );
        without.set(k, s);
      }
      return s;
    },
    posCount: (pos) => counts.get(pos) ?? 0,
    entries,
  };
}

/**
 * Adding `row` to my roster in a frame's terms: ROS(R + a) − ROS(R), and what losing each of R + a's rows costs it with nobody
 * refilling his spot (§7's keep value; my players first, in roster order, the newcomer after them). Scenario lineups when
 * the frame has them, R + a's from R's (only the patterns he can get into solved again); expected-value lineups otherwise.
 */
function priceAdd(input: WaiverInputs, f: Frame, row: TableRow): { add: number; keep: Float64Array } {
  const { setup, weekCount, weights } = f;
  const S = count(input.scenarios);
  const after = teamEval([...f.rows, row, ...setup.extra], input.slots);
  if (setup.baseScen && setup.baseRosScen !== null) {
    const plus = scenarioValuesAfterMove(setup.baseScen, after, { drop: null, at: f.rows.length }, weekCount, S, null, true) ?? scenarioValues(after, weekCount, S, null, true);
    return { add: rosValue(plus.mean, weights) - setup.baseRosScen, keep: plus.cells ? scenarioRemovalCosts(plus.cells, weights) : new Float64Array(after.rows.length) };
  }
  const plusEv = solveEvWeeks(after, weekCount);
  return { add: rosValue(plusEv.lv, weights) - setup.baseRosEv, keep: evRemovalCosts(plusEv, weights) };
}

/**
 * The drop for one free agent (roster legality's rules 1 and 2 for one pickup; the file header), from the rest-of-season
 * frame's keep values: `possible` false when nobody can make room; k his index in my rows (null: an open spot).
 */
interface DropChoice {
  possible: boolean;
  drop: string | null;
  k: number | null;
  /** The rest-of-season frame's priceAdd (its list reuses them). */
  add: number;
  keep: Float64Array;
}

/** The drop (DropChoice); `locked`: players who can't go (their games in the week under way have started). */
function chooseDrop(input: WaiverInputs, ros: Frame, c: Candidate, keep: Float64Array, locked?: ReadonlySet<string>): Pick<DropChoice, "possible" | "drop" | "k"> {
  const { setup } = ros;
  const pos = c.row.pos;
  const limit = input.positionLimits?.[pos];
  const limitBinds = limit !== undefined && Number.isFinite(limit) && setup.posCount(pos) >= limit;
  const size = input.maxRosterSize;
  const sizeBinds = Number.isFinite(size) && size > 0 && new Set(input.roster).size >= size;
  if (!limitBinds && !sizeBinds) return { possible: true, drop: null, k: null };
  const streamed = new Set(input.streamed);
  const minimums = input.rosterMinimums;
  const afterCount = (p: Pos) => setup.posCount(p) + (p === pos ? 1 : 0);
  // The keep value: the lineup cost, or with long-term values legality's normalized sum (evaluate.ts keepValues: over R + a's
  // players, the newcomer included in the largest cost).
  const future = input.future && input.future.top > 0 ? input.future : null;
  let largest = 0;
  if (future) for (let i = 0; i <= input.rows.length; i++) largest = Math.max(largest, keep[i] ?? 0);
  const keepOf = (i: number, id: string): number => {
    const cost = keep[i] as number;
    return future ? (largest > EPS ? cost / largest : 0) + future.value(id) / future.top : cost;
  };
  const pool = input.rows.flatMap((r, i) => {
    if (locked?.has(r.id)) return [];
    if (limitBinds && r.pos !== pos) return [];
    const min = minimums?.[r.pos];
    if (min !== undefined && Number.isFinite(min) && afterCount(r.pos) - 1 < Math.min(min, setup.posCount(r.pos))) return [];
    if (streamed.has(r.pos) && afterCount(r.pos) <= 1) return [];
    return [{ id: r.id, keep: keepOf(i, r.id), value: input.value(r.id) || 0, i }];
  });
  let tie = 0;
  if (!future && Number.isFinite(input.nearTieWeekly) && input.nearTieWeekly > 0) for (let w = 0; w < ros.weekCount; w++) tie += input.nearTieWeekly * (ros.weights[w] as number);
  const newcomer: LineupCandidate = { id: c.id, pos, eligible: c.row.eligible };
  let fillWith: number | null = null;
  // In drop order (the lowest keep value first, near-ties to the lower trade value floored at W), the first one the
  // starting lineup doesn't need.
  while (pool.length) {
    const id = lowestKeepValue(pool, tie, input.credit);
    const at = pool.findIndex((x) => x.id === id);
    const pick = pool[at];
    if (!pick) break;
    fillWith ??= fillCount([...setup.entries, newcomer], input.slots);
    if (fillCount([...setup.entries.filter((e) => e.id !== pick.id), newcomer], input.slots) >= fillWith) return { possible: true, drop: pick.id, k: pick.i };
    pool.splice(at, 1);
  }
  return { possible: false, drop: null, k: null };
}
