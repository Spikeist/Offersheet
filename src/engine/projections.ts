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

/** proj_now, the week it came from (null for a season projection) and its source. */
function projectionNow(inputs: PlayerInputs, ctx: BaseRateContext): { value: number; week: number | null; source: BaseRateSource } | null {
  const sleeper = latestHealthyProjection(inputs.sleeper, ctx.currentWeek, ctx.weeks);
  if (sleeper) {
    const espn = inputs.espn?.[sleeper.week];
    if (ctx.espnAveraged && isProjected(espn)) return { value: (sleeper.value + espn) / 2, week: sleeper.week, source: "espn+sleeper" };
    return { value: sleeper.value, week: sleeper.week, source: "sleeper" };
  }
  // No Sleeper week at all (no Sleeper id, or only stubs): ESPN's own projection is the best there is.
  const espn = latestHealthyProjection(inputs.espn, ctx.currentWeek, ctx.weeks);
  if (espn) return { value: espn.value, week: espn.week, source: "espn" };
  if (isProjected(inputs.sleeperSeasonPerGame)) return { value: inputs.sleeperSeasonPerGame, week: null, source: "season" };
  return null;
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
  const { ppg: actualPpg, games } = actualForm(inputs.actual);
  const proj = projectionNow(inputs, ctx);
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
