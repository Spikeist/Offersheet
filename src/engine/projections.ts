/**
 * Projection model (CLAUDE.md §6 steps 1, 2, 4, 5 and 7). Pure and deterministic: no I/O, no clock,
 * and every tunable number comes from config.projections.
 *
 * Per player and remaining NFL week w (`weeks` = currentWeek..lastWeek, in order; LeagueModel.weeks):
 * - Step 1, base rate b (points per game played, in this league's scoring):
 *   b = (1 − α)·(proj_now / m_now) + α·actual_ppg, α = actualWeight × min(1, games / actualFullGames).
 *   proj_now is his most recent HEALTHY projection: Sleeper's value in the latest week ≤ currentWeek
 *   where it is > 0 (PlayerInputs.sleeper carries lookbackWeeks past weeks for this), else in the
 *   nearest later remaining week. A null or 0 week is a stub (bye, injured, unprojected), never a base
 *   rate: an injured star keeps his last healthy projection. In ESPN leagues, when the two sources agree
 *   league-wide (espnSleeperAgreement) and ESPN projects him in that same week, proj_now is the average
 *   of ESPN's league-scored value and Sleeper's. Fallbacks, in order: ESPN alone (no Sleeper week at
 *   all), Sleeper's season projection per game, actual points per game, nothing (b = 0). b is never < 0.
 * - Step 2, week shape m_w = clamp(S_w / mean S, weekShapeClamp), the mean taken over the REMAINING
 *   weeks with S > 0. Past weeks get a shape too, so m_now can take the matchup out of proj_now. A week
 *   without a positive Sleeper value has m = 1, and so does every week when no remaining week has one.
 * - Step 4, p_w = b × m_w × a_w, where the availability a_w (§6 step 3: byes, injuries, future injury
 *   risk, a game already kicked off) is an INPUT, from src/engine/availability.ts, aligned with `weeks`.
 * - Step 5, σ_w = c_pos × p_w + d_pos (config.projections.sigma); 0 when p_w = 0 (he certainly doesn't
 *   play, or has no projection: no points, no spread).
 * - Step 7, rest-of-season summary: Σ p over the remaining weeks, split into regular-season and playoff
 *   weeks, games his NFL team has left (not his bye, not a game that kicked off this week) and bye status.
 *
 * The ESPN/Sleeper agreement check (§6 "agree within 10% on average across the league's rostered
 * players") is a ratio of sums, Σ|E − S| / Σ S, so bench players with tiny projections don't dominate.
 *
 * Conflicting ESPN signals (§6 step 3; planner reply to Checkpoint 2, answer 6): a PROBABLE, QUESTIONABLE
 * or DOUBTFUL player whose ESPN return date is 2+ weeks away gets Sleeper as the tiebreaker
 * (staleReturnCheck). His healthy base rate H is step 1's base rate as if neither source had projected
 * him this week (priorHealthyBaseRate): this week's numbers, which his tag may have cut and which H is
 * compared with, count neither as proj_now nor in the week shape's mean. So proj_now is the latest week
 * before currentWeek that Sleeper projected him healthy (averaged with ESPN's value for that week when
 * the sources are averaged), else his nearest later healthy week (hurt all season so far: Sleeper's
 * projection once he's back, where the season line ÷ 17 counts the games he's expected to miss), else
 * ESPN's the same way, else Sleeper's season line per game, else his points per game so far, with the
 * same α blend. The date is stale when H > 0 and Sleeper's projection this week, S_now, is at least
 * config.projections.staleReturnShare × H: Sleeper still expects him to play. S_now includes this
 * week's matchup and H doesn't (the shape is clamped to [0.8, 1.2], small next to the 50% cut). A stub
 * or 0 this week (Sleeper doesn't project him, a bye included) is never stale: the date is followed, and
 * so it is when Sleeper's projections for this week didn't load (league.ts notes that the tiebreaker was
 * missing, not negative). ⚠️ Only his availability follows the tiebreaker: his base rate b is step 1's,
 * which takes this week's projection when Sleeper has one, cut or not (Checkpoint 3 lists it).
 */
import { config } from "./config";
import type { PlayerInputs } from "./inputs";
import type { BaseRateSource, PlayerModel, ProjectionSummary, RosSummary, WeekProjection } from "./leagueModel";
import type { Pos } from "./model";

/**
 * The config.projections keys this module reads, with plain number types (config is `as const`), so
 * callers and tests can tune them. Pass `config.projections` (the default).
 */
export interface ProjectionConfig {
  actualWeight: number;
  actualFullGames: number;
  weekShapeClamp: readonly [number, number];
  espnSleeperAgreement: number;
  sourceDisagreementLog: number;
  /** §6 step 3 "Conflicting ESPN signals": Sleeper's projection this week at this share of the healthy base rate or more makes an ESPN return date stale. */
  staleReturnShare: number;
  sigma: Readonly<Record<Pos, { readonly c: number; readonly d: number }>>;
}

export type PlayerBase = PlayerModel["base"];

/** Projection values by NFL week (PlayerInputs.sleeper / .espn); null = a stub, not projected. */
type WeeklyValues = Readonly<Record<number, number | null>>;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** A projection that counts: finite and > 0. Null, 0 and missing all mean "not projected healthy" (§6). */
function isProjected(v: number | null | undefined): v is number {
  return typeof v === "number" && v > 0 && Number.isFinite(v);
}

/**
 * §6 step 2: week shape m_w for every remaining week (1 without a positive Sleeper value) and for
 * every past week Sleeper projected (so m_now exists for a lookback week). Look weeks up with
 * `shape.get(w) ?? 1`.
 */
export function weekShape(inputs: PlayerInputs, weeks: readonly number[], cfg: ProjectionConfig = config.projections): Map<number, number> {
  const [lo, hi] = cfg.weekShapeClamp;
  let sum = 0;
  let n = 0;
  for (const w of weeks) {
    const s = inputs.sleeper[w];
    if (isProjected(s)) {
      sum += s;
      n++;
    }
  }
  const mean = n > 0 ? sum / n : null;
  const shape = new Map<number, number>();
  for (const w of weeks) shape.set(w, 1);
  for (const [key, s] of Object.entries(inputs.sleeper)) {
    const w = Number(key);
    if (!Number.isInteger(w) || !isProjected(s)) continue;
    shape.set(w, mean === null ? 1 : clamp(s / mean, lo, hi));
  }
  return shape;
}

/**
 * The most recent healthy projection in a weekly series (§6 step 1): the latest week ≤ currentWeek
 * with a value > 0, else the earliest remaining week after currentWeek with one; null when neither exists.
 */
export function latestHealthyProjection(values: WeeklyValues | undefined, currentWeek: number, weeks: readonly number[]): { week: number; value: number } | null {
  if (!values) return null;
  let latest: { week: number; value: number } | null = null;
  for (const [key, v] of Object.entries(values)) {
    const week = Number(key);
    if (!Number.isInteger(week) || week > currentWeek || !isProjected(v)) continue;
    if (latest === null || week > latest.week) latest = { week, value: v };
  }
  if (latest) return latest;
  let next: { week: number; value: number } | null = null;
  for (const week of weeks) {
    const v = values[week];
    if (week > currentWeek && isProjected(v) && (next === null || week < next.week)) next = { week, value: v };
  }
  return next;
}

export interface BaseRateContext {
  currentWeek: number;
  /** Remaining NFL weeks, currentWeek..lastWeek. */
  weeks: readonly number[];
  /** ESPN leagues: ESPN and Sleeper agree well enough to be averaged (espnSleeperAgreement(...).agree). */
  espnAveraged: boolean;
}

/** A projection the base rate starts from: its value, the week it came from (null for a season projection) and its source. */
interface BaseProjection {
  value: number;
  week: number | null;
  source: BaseRateSource;
}

/**
 * A Sleeper week, averaged with ESPN's value for that same week when the sources are averaged and ESPN
 * projects him then; else a week of ESPN's own (no Sleeper week); else Sleeper's season line per game.
 * `find` picks the week in a weekly series.
 */
function pickProjection(inputs: PlayerInputs, ctx: BaseRateContext, find: (values: WeeklyValues | undefined) => { week: number; value: number } | null): BaseProjection | null {
  const sleeper = find(inputs.sleeper);
  if (sleeper) {
    const espn = inputs.espn?.[sleeper.week];
    if (ctx.espnAveraged && isProjected(espn)) return { value: (sleeper.value + espn) / 2, week: sleeper.week, source: "espn+sleeper" };
    return { value: sleeper.value, week: sleeper.week, source: "sleeper" };
  }
  // No Sleeper week to use (no Sleeper id, or only stubs): ESPN's own projection is the best there is.
  const espn = find(inputs.espn);
  if (espn) return { value: espn.value, week: espn.week, source: "espn" };
  if (isProjected(inputs.sleeperSeasonPerGame)) return { value: inputs.sleeperSeasonPerGame, week: null, source: "season" };
  return null;
}

/** proj_now (§6 step 1): the most recent healthy week (latestHealthyProjection). */
function projectionNow(inputs: PlayerInputs, ctx: BaseRateContext): BaseProjection | null {
  return pickProjection(inputs, ctx, (values) => latestHealthyProjection(values, ctx.currentWeek, ctx.weeks));
}

/** Season-to-date points per game played and games played (PlayerInputs.actual holds only games played). */
function actualForm(actual: Readonly<Record<number, number>>): { ppg: number | null; games: number } {
  let sum = 0;
  let games = 0;
  for (const v of Object.values(actual)) {
    if (!Number.isFinite(v)) continue;
    sum += v;
    games++;
  }
  return { ppg: games > 0 ? sum / games : null, games };
}

function baseRateWithShape(inputs: PlayerInputs, ctx: BaseRateContext, shape: ReadonlyMap<number, number>, cfg: ProjectionConfig): PlayerBase {
  return blendBaseRate(projectionNow(inputs, ctx), inputs, shape, cfg);
}

/** §6 step 1's formula from a projection (null = none): the α blend with actual points per game, the week shape taken out. */
function blendBaseRate(proj: BaseProjection | null, inputs: PlayerInputs, shape: ReadonlyMap<number, number>, cfg: ProjectionConfig): PlayerBase {
  const { ppg: actualPpg, games } = actualForm(inputs.actual);
  if (proj) {
    const alpha = games > 0 ? cfg.actualWeight * Math.min(1, games / cfg.actualFullGames) : 0;
    const mNow = proj.week === null ? 1 : (shape.get(proj.week) ?? 1);
    const b = (1 - alpha) * (proj.value / mNow) + alpha * (actualPpg ?? 0);
    return { b: Math.max(0, b), projNow: proj.value, projWeek: proj.week, mNow, actualPpg, games, alpha, source: proj.source };
  }
  // No projection anywhere: his actual points per game ARE the base rate (α = 1 in the step 1 formula).
  if (actualPpg !== null) return { b: Math.max(0, actualPpg), projNow: null, projWeek: null, mNow: 1, actualPpg, games, alpha: 1, source: "actual" };
  return { b: 0, projNow: null, projWeek: null, mNow: 1, actualPpg: null, games: 0, alpha: 0, source: "none" };
}

/** §6 step 1: the base rate b and how it was made. */
export function baseRate(inputs: PlayerInputs, ctx: BaseRateContext, cfg: ProjectionConfig = config.projections): PlayerBase {
  return baseRateWithShape(inputs, ctx, weekShape(inputs, ctx.weeks, cfg), cfg);
}

/** A weekly series without week `week` (the same object when it has no such week). */
function withoutWeek(values: WeeklyValues, week: number): WeeklyValues {
  if (!Object.prototype.hasOwnProperty.call(values, week)) return values;
  const out: Record<number, number | null> = { ...values };
  delete out[week];
  return out;
}

/**
 * His healthy base rate H (§6 step 3 "Conflicting ESPN signals"; the file header): step 1's base rate as
 * if neither source had projected him this week, the same α blend. This week's numbers are the ones his
 * tag may have cut, and the one H is compared with, so they count nowhere: not as proj_now, and not in the
 * week shape's mean (a cut this week would pull the mean down and H with it). proj_now is then the latest
 * healthy week before this week, else his nearest later healthy week (a player hurt all season so far:
 * Sleeper's projection once he's back is his healthy rate, where the season line ÷ 17 counts the games
 * he's expected to miss), else ESPN's the same way, else Sleeper's season line per game, else his points
 * per game (b 0, source "none", without any).
 */
export function priorHealthyBaseRate(inputs: PlayerInputs, ctx: BaseRateContext, cfg: ProjectionConfig = config.projections): PlayerBase {
  const week = ctx.currentWeek;
  const without: PlayerInputs = { ...inputs, sleeper: withoutWeek(inputs.sleeper, week), ...(inputs.espn ? { espn: withoutWeek(inputs.espn, week) } : {}) };
  return baseRate(without, ctx, cfg);
}

/** Sleeper as the tiebreaker for a conflicting ESPN return date (§6 step 3; staleReturnCheck). */
export interface StaleReturnCheck {
  /** Sleeper's projection this week in league points; null when it doesn't project him (a stub or 0). */
  sleeperNow: number | null;
  /** His healthy base rate (priorHealthyBaseRate), null when there is none (no projection, no games). */
  healthyRate: number | null;
  /** sleeperNow ≥ staleReturnShare × healthyRate: Sleeper still expects him to play, so the date is stale. */
  stale: boolean;
}

/**
 * Whether ESPN's return date for a PROBABLE, QUESTIONABLE or DOUBTFUL player 2+ weeks out is stale (the
 * file header): Sleeper still projects him this week at config.projections.staleReturnShare or more of
 * his healthy base rate. The caller decides who it applies to (availability.returnDateConflict).
 */
export function staleReturnCheck(inputs: PlayerInputs, ctx: BaseRateContext, cfg: ProjectionConfig = config.projections): StaleReturnCheck {
  const now = inputs.sleeper[ctx.currentWeek];
  const sleeperNow = isProjected(now) ? now : null;
  const h = priorHealthyBaseRate(inputs, ctx, cfg).b;
  const healthyRate = h > 0 && Number.isFinite(h) ? h : null;
  return { sleeperNow, healthyRate, stale: sleeperNow !== null && healthyRate !== null && sleeperNow >= cfg.staleReturnShare * healthyRate };
}

/** §6 step 5: σ = c_pos × p + d_pos for a week he's projected to score p > 0; 0 when p = 0 (no points, no spread). */
export function weeklySd(points: number, pos: Pos, cfg: ProjectionConfig = config.projections): number {
  if (!(points > 0)) return 0;
  const { c, d } = cfg.sigma[pos];
  return c * points + d;
}

export interface ProjectPlayerContext extends BaseRateContext {
  /** Regular-season and playoff weeks (membership only: LeagueModel.regularWeeks/playoffWeeks or the settings' full lists). */
  regularWeeks: readonly number[];
  playoffWeeks: readonly number[];
  /** His NFL team's bye week (undefined = no team, or the schedule doesn't say). */
  byeWeek: number | undefined;
  /** His currentWeek game has kicked off: that week is no longer a game left. */
  started: boolean;
  /** He has an NFL team (PlayerInfo.nflTeam !== null); a teamless player has no games left. Default true. */
  hasTeam?: boolean;
}

/**
 * §6 steps 1, 2, 4, 5 and 7 for one player. `availability` is a_w per week of ctx.weeks (§6 step 3).
 * `value` is null here; the market layer (§9) fills it in.
 */
export function projectPlayer(id: string, pos: Pos, inputs: PlayerInputs, availability: ArrayLike<number>, ctx: ProjectPlayerContext, cfg: ProjectionConfig = config.projections): PlayerModel {
  if (availability.length !== ctx.weeks.length) {
    throw new Error(`projectPlayer: ${availability.length} availability values for ${ctx.weeks.length} weeks (player ${id})`);
  }
  const shape = weekShape(inputs, ctx.weeks, cfg);
  const base = baseRateWithShape(inputs, ctx, shape, cfg);
  const weekly: WeekProjection[] = ctx.weeks.map((w, i) => {
    const a = availability[i] ?? 0;
    const m = shape.get(w) ?? 1;
    const p = base.b * m * a;
    return { p, a, m, bye: w === ctx.byeWeek, sd: weeklySd(p, pos, cfg) };
  });
  const ros = rosSummary(weekly, ctx.weeks, ctx.regularWeeks, ctx.playoffWeeks, ctx.byeWeek, ctx.currentWeek, ctx.started, ctx.hasTeam ?? true);
  return { id, base, weekly, ros, value: null };
}

/**
 * §6 step 7: rest-of-season points (Σ p over `weeks`) split into regular-season and playoff weeks, the
 * games his NFL team has left, and bye status ("done" before currentWeek; "upcoming" from currentWeek
 * on, with its week; "unknown" without a bye). A week in neither list counts only in the totals.
 */
export function rosSummary(
  weekly: readonly Pick<WeekProjection, "p">[],
  weeks: readonly number[],
  regularWeeks: readonly number[],
  playoffWeeks: readonly number[],
  byeWeek: number | undefined,
  currentWeek: number,
  started: boolean,
  hasTeam = true,
): RosSummary {
  if (weekly.length !== weeks.length) throw new Error(`rosSummary: ${weekly.length} weekly projections for ${weeks.length} weeks`);
  const regular = new Set(regularWeeks);
  const playoff = new Set(playoffWeeks);
  const bye: RosSummary["bye"] = byeWeek === undefined ? { status: "unknown" } : byeWeek < currentWeek ? { status: "done" } : { status: "upcoming", week: byeWeek };
  const out: RosSummary = { total: 0, regular: 0, playoffs: 0, gamesLeft: 0, gamesLeftRegular: 0, gamesLeftPlayoffs: 0, bye };
  weeks.forEach((w, i) => {
    const p = weekly[i]?.p ?? 0;
    const plays = hasTeam && w !== byeWeek && !(started && w === currentWeek) ? 1 : 0;
    out.total += p;
    out.gamesLeft += plays;
    if (regular.has(w)) {
      out.regular += p;
      out.gamesLeftRegular += plays;
    } else if (playoff.has(w)) {
      out.playoffs += p;
      out.gamesLeftPlayoffs += plays;
    }
  });
  return out;
}

export interface SourceAgreement {
  /** Average ESPN with Sleeper (§6): Σ|E − S| / Σ S ≤ config.projections.espnSleeperAgreement. False when no player has both. */
  agree: boolean;
  agreement: ProjectionSummary["agreement"];
  /** Players whose sources differ by more than sourceDisagreementLog of the larger value, largest gap first (§6 "log"). */
  disagreements: ProjectionSummary["disagreements"];
}

/**
 * §6 step 1, ESPN leagues: do ESPN's league-scored projections and Sleeper's (× league scoring) agree
 * within config.projections.espnSleeperAgreement on average? Measured in `week` (currentWeek) over the
 * rostered players both sources project (> 0) that week, as the ratio of sums Σ|E − S| / Σ S.
 */
export function espnSleeperAgreement(rosteredIds: Iterable<string>, players: Readonly<Record<string, PlayerInputs>>, week: number, cfg: ProjectionConfig = config.projections): SourceAgreement {
  let absDiff = 0;
  let sleeperSum = 0;
  let n = 0;
  const seen = new Set<string>();
  const gaps: { gap: number; row: ProjectionSummary["disagreements"][number] }[] = [];
  for (const id of rosteredIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const inputs = players[id];
    const e = inputs?.espn?.[week];
    const s = inputs?.sleeper[week];
    if (!isProjected(e) || !isProjected(s)) continue;
    n++;
    absDiff += Math.abs(e - s);
    sleeperSum += s;
    const gap = Math.abs(e - s) / Math.max(e, s);
    if (gap > cfg.sourceDisagreementLog) gaps.push({ gap, row: { playerId: id, espn: e, sleeper: s, week } });
  }
  gaps.sort((a, b) => b.gap - a.gap || (a.row.playerId < b.row.playerId ? -1 : a.row.playerId > b.row.playerId ? 1 : 0));
  const disagreements = gaps.map((g) => g.row);
  if (n === 0) return { agree: false, agreement: null, disagreements };
  const meanRelDiff = absDiff / sleeperSum;
  return { agree: meanRelDiff <= cfg.espnSleeperAgreement, agreement: { meanRelDiff, players: n, week }, disagreements };
}

/** Players by base-rate source (ProjectionSummary.sources). */
export function baseRateSourceCounts(models: Iterable<Pick<PlayerModel, "base">>): Record<BaseRateSource, number> {
  const counts: Record<BaseRateSource, number> = { "espn+sleeper": 0, sleeper: 0, espn: 0, season: 0, actual: 0, none: 0 };
  for (const m of models) counts[m.base.source]++;
  return counts;
}
