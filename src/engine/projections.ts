/**
 * Projection model (CLAUDE.md §6 steps 1, 2, 4, 5 and 7). Pure and deterministic: no I/O, no clock,
 * and every tunable number comes from config.projections.
 *
 * Per player and remaining NFL week w (`weeks` = currentWeek..lastWeek, in order; LeagueModel.weeks):
 * - Step 1, base rate b (points per game played, in this league's scoring):
 *   b = (1 − α)·(proj_now / m_now) + α·actual_ppg, α = w_pos × min(1, games / actualFullGames), w_pos his position's
 *   season-to-date weight (actualWeightFor: config.projections.actualWeightByPos, else actualWeight). Since the planner's
 *   reply to Checkpoint 7d (item 1.2) K and DEF weigh 0, so their b is proj_now / m_now: ESPN's and Sleeper's projections
 *   alone. The position comes from projectPlayer's `pos`, or BaseRateContext.pos for the exported base rates.
 *   proj_now is his most recent HEALTHY projection: Sleeper's value in the latest week ≤ currentWeek
 *   where it is > 0 (PlayerInputs.sleeper carries lookbackWeeks past weeks for this), else in the
 *   nearest later remaining week. A null or 0 week is a stub (bye, injured, unprojected), never a base
 *   rate: an injured star keeps his last healthy projection. In ESPN leagues, when the two sources agree
 *   league-wide (espnSleeperAgreement, kickers, D/STs and Q/D/P-tagged players aside) and ESPN projects him in that same
 *   week, proj_now is the average of ESPN's league-scored value and Sleeper's (a kicker's or a D/ST's too).
 *   Fallbacks, in order: ESPN alone (no Sleeper week at all), Sleeper's season projection per game,
 *   actual points per game, nothing (b = 0). b is never < 0.
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
 * Since the planner's reply to Checkpoint 7e (item 6: "If K and D/ST are what push it over, leave them out of the test.")
 * its sums leave out the positions config.projections.espnSleeperAgreementExcluded names, K and DEF, when given the
 * players' positions (both callers give them: the League model's, league.ts projectLeaguePlayers, and the Import Report's
 * note). On every saved day of Parker's two leagues ESPN projected nearly every kicker above Sleeper's line and most D/STs
 * below it: a difference in how the two sources project those positions, not about players' roles, which the test is meant
 * to measure. They're still logged, and averaged like every other player once the test passes.
 * Since the planner's reply to Checkpoint 7f (answer 4: "yes, leave questionable players out of the test, since their ESPN
 * numbers never reach a base rate") the sums also leave out the players whose injury status
 * config.projections.espnSleeperAgreementExcludedStatuses names, QUESTIONABLE, DOUBTFUL and PROBABLE (the callers' players
 * carry it): their base rate is the Q/D/P one below, which leaves this week's projections out and reads his nearest later
 * healthy week first, a week ESPN doesn't project (it projects only this week and last), so this week's ESPN line, the one
 * the test compares, never reaches it. A tagged kicker or D/ST is left out as his position. They're still logged.
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
 * missing, not negative). Only his availability follows the tiebreaker.
 *
 * The Q/D/P base rate (CLAUDE.md §6 step 3; planner reply to Checkpoint 3, answer 5): for every PROBABLE,
 * QUESTIONABLE or DOUBTFUL player (projectPlayer's ctx.injury), this week's projections, Sleeper's and
 * ESPN's, are injury-cut, so his whole projection is made as if neither source had projected him this
 * week (gameTimeBaseRate): the week shape's mean leaves this week out, this week's shape is 1, and proj_now
 * is his nearest LATER healthy week (nearestHealthyProjection: next week's projection is past the one-week
 * tag and carries his current role; Sleeper marks the weeks it expects him to miss with stubs, which never
 * count), else his latest healthy week before this one, else ESPN's the same way, Sleeper's season line per
 * game or his points per game, with the same α blend. His availability then comes from the injury table
 * alone (availability.ts), applied once. Before Phase 4 a cut projection lowered b for the rest of the
 * season and, in the stale-date case, counted the injury twice (Sleeper's cut × the tag's table). Track A1
 * first took the latest earlier week first (b = H, lead decision L4), which kept a role that changed this
 * week for the rest of the season (review of track A1): in Sleeper's projections of 2026-09-30, Ollie Gordon
 * (RB, questionable) went from 3.2 in week 3 to 7.3 this week and about 6.9 a week after it, and his b was
 * 4.2 instead of 6.9 (7.0 untagged; projections.test.ts). In ESPN leagues whose sources are averaged, a
 * later week has no ESPN value (the import carries ESPN's previous and current weeks only), so such a b is
 * Sleeper's alone. ⚠️ A reduced next week that isn't a stub (a return eased in) lowers b; none of the 8
 * questionable or doubtful players projected at 5+ points a week in Sleeper's 2026-09-30 data had one. The
 * stale-date tiebreaker's healthy base rate H (priorHealthyBaseRate, above) keeps the latest earlier week
 * first. Every other status keeps step 1 as above (an OUT or IR player's stub this week is never a base rate
 * anyway).
 */
import { config } from "./config";
import type { PlayerInputs } from "./inputs";
import type { BaseRateSource, PlayerModel, ProjectionSummary, RosSummary, WeekProjection } from "./leagueModel";
import type { InjuryStatus, Pos } from "./model";

/**
 * The config.projections keys this module reads, with plain number types (config is `as const`), so
 * callers and tests can tune them. Pass `config.projections` (the default).
 */
export interface ProjectionConfig {
  /** The season-to-date weight of every position actualWeightByPos doesn't name (§6 step 1). */
  actualWeight: number;
  /**
   * Positions whose season-to-date weight replaces actualWeight (config: K and DEF 0; planner reply to Checkpoint 7d, item
   * 1.2). Absent (a test's own config): actualWeight for every position.
   */
  actualWeightByPos?: Readonly<Partial<Record<Pos, number>>>;
  actualFullGames: number;
  weekShapeClamp: readonly [number, number];
  espnSleeperAgreement: number;
  /**
   * Positions the averaging test leaves out of its sums when it's given the players' positions (config: K and DEF; planner
   * reply to Checkpoint 7e, item 6). Absent (a test's own config): none.
   */
  espnSleeperAgreementExcluded?: readonly Pos[];
  /**
   * Injury statuses the averaging test leaves out of its sums too, when it's given the players' info (config: QUESTIONABLE,
   * DOUBTFUL and PROBABLE, the statuses the Q/D/P base rate takes; planner reply to Checkpoint 7f, answer 4). Absent (a test's
   * own config): none.
   */
  espnSleeperAgreementExcludedStatuses?: readonly InjuryStatus[];
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
  /**
   * His primary position (PlayerInfo.pos), for his season-to-date weight (actualWeightFor; planner reply to Checkpoint 7d,
   * item 1.2: K and DEF 0). Absent: config.projections.actualWeight, every other position's. projectPlayer reads its own
   * `pos` argument instead.
   */
  pos?: Pos;
}

/**
 * His position's season-to-date weight (§6 step 1; planner reply to Checkpoint 7d, item 1.2): α once he has played
 * cfg.actualFullGames games. actualWeightByPos's entry for his position, else actualWeight (also without a position). K and
 * DEF read 0 in config, so their base rate comes from ESPN's and Sleeper's projections alone.
 */
export function actualWeightFor(pos: Pos | undefined, cfg: Pick<ProjectionConfig, "actualWeight" | "actualWeightByPos"> = config.projections): number {
  return (pos === undefined ? undefined : cfg.actualWeightByPos?.[pos]) ?? cfg.actualWeight;
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

function baseRateWithShape(inputs: PlayerInputs, ctx: BaseRateContext, shape: ReadonlyMap<number, number>, cfg: ProjectionConfig, pos: Pos | undefined): PlayerBase {
  return blendBaseRate(projectionNow(inputs, ctx), inputs, shape, cfg, pos);
}

/**
 * §6 step 1's formula from a projection (null = none): the α blend with actual points per game at his position's weight
 * (actualWeightFor; 0 for K and DEF, whose b is then proj_now / m_now), the week shape taken out.
 */
function blendBaseRate(proj: BaseProjection | null, inputs: PlayerInputs, shape: ReadonlyMap<number, number>, cfg: ProjectionConfig, pos: Pos | undefined): PlayerBase {
  const { ppg: actualPpg, games } = actualForm(inputs.actual);
  if (proj) {
    const alpha = games > 0 ? actualWeightFor(pos, cfg) * Math.min(1, games / cfg.actualFullGames) : 0;
    const mNow = proj.week === null ? 1 : (shape.get(proj.week) ?? 1);
    const b = (1 - alpha) * (proj.value / mNow) + alpha * (actualPpg ?? 0);
    return { b: Math.max(0, b), projNow: proj.value, projWeek: proj.week, mNow, actualPpg, games, alpha, source: proj.source };
  }
  // No projection anywhere: his actual points per game ARE the base rate (α = 1 in the step 1 formula). ⚠️ Ours: K and DEF
  // too, since this last resort isn't the season-to-date weight they weigh 0 (config.projections.actualWeightByPos).
  if (actualPpg !== null) return { b: Math.max(0, actualPpg), projNow: null, projWeek: null, mNow: 1, actualPpg, games, alpha: 1, source: "actual" };
  return { b: 0, projNow: null, projWeek: null, mNow: 1, actualPpg: null, games: 0, alpha: 0, source: "none" };
}

/** §6 step 1: the base rate b and how it was made, at ctx.pos's season-to-date weight. */
export function baseRate(inputs: PlayerInputs, ctx: BaseRateContext, cfg: ProjectionConfig = config.projections): PlayerBase {
  return baseRateWithShape(inputs, ctx, weekShape(inputs, ctx.weeks, cfg), cfg, ctx.pos);
}

/** A weekly series without week `week` (the same object when it has no such week). */
function withoutWeek(values: WeeklyValues, week: number): WeeklyValues {
  if (!Object.prototype.hasOwnProperty.call(values, week)) return values;
  const out: Record<number, number | null> = { ...values };
  delete out[week];
  return out;
}

/** His inputs as if neither source had projected him in `week` (Sleeper's and ESPN's weekly lines without it). */
function withoutWeekInputs(inputs: PlayerInputs, week: number): PlayerInputs {
  return { ...inputs, sleeper: withoutWeek(inputs.sleeper, week), ...(inputs.espn ? { espn: withoutWeek(inputs.espn, week) } : {}) };
}

/**
 * His healthy base rate H (§6 step 3 "Conflicting ESPN signals"; the file header), what the stale-date
 * tiebreaker compares Sleeper's projection this week with: step 1's base rate as if neither source had
 * projected him this week, the same α blend (at ctx.pos's weight). This week's numbers are the ones his
 * tag may have cut, and the one H is compared with, so they count nowhere: not as proj_now, and not in the
 * week shape's mean (a cut this week would pull the mean down and H with it). proj_now is then the latest
 * healthy week before this week, else his nearest later healthy week (a player hurt all season so far:
 * Sleeper's projection once he's back is his healthy rate, where the season line ÷ 17 counts the games he's
 * expected to miss), else ESPN's the same way, else Sleeper's season line per game, else his points per game
 * (b 0, source "none", without any). The Q/D/P base rate (gameTimeBaseRate) takes the later week first instead.
 */
export function priorHealthyBaseRate(inputs: PlayerInputs, ctx: BaseRateContext, cfg: ProjectionConfig = config.projections): PlayerBase {
  return baseRate(withoutWeekInputs(inputs, ctx.currentWeek), ctx, cfg);
}

/**
 * The Q/D/P base rate's week (the file header): the earliest remaining week after currentWeek with a value > 0
 * (his current role, past the one-week tag), else the latest week before currentWeek with one. currentWeek
 * itself never counts (its projection is the one the tag may have cut). Null when neither exists.
 */
export function nearestHealthyProjection(values: WeeklyValues | undefined, currentWeek: number, weeks: readonly number[]): { week: number; value: number } | null {
  if (!values) return null;
  let next: { week: number; value: number } | null = null;
  for (const week of weeks) {
    const v = values[week];
    if (week > currentWeek && isProjected(v) && (next === null || week < next.week)) next = { week, value: v };
  }
  if (next) return next;
  let latest: { week: number; value: number } | null = null;
  for (const [key, v] of Object.entries(values)) {
    const week = Number(key);
    if (!Number.isInteger(week) || week >= currentWeek || !isProjected(v)) continue;
    if (latest === null || week > latest.week) latest = { week, value: v };
  }
  return latest;
}

/**
 * The Q/D/P base rate (the file header): step 1's base rate as if neither source had projected him this week,
 * proj_now from his nearest later healthy week first (nearestHealthyProjection), averaged with ESPN's value for
 * that week when the sources are averaged and ESPN has one, the week shape's mean without this week, the same α
 * blend. projectPlayer uses it for every PROBABLE, QUESTIONABLE and DOUBTFUL player.
 */
export function gameTimeBaseRate(inputs: PlayerInputs, ctx: BaseRateContext, cfg: ProjectionConfig = config.projections): PlayerBase {
  const source = withoutWeekInputs(inputs, ctx.currentWeek);
  return gameTimeBase(source, ctx, weekShape(source, ctx.weeks, cfg), cfg, ctx.pos);
}

/** gameTimeBaseRate from inputs already without this week and their week shape, at `pos`'s season-to-date weight. */
function gameTimeBase(source: PlayerInputs, ctx: BaseRateContext, shape: ReadonlyMap<number, number>, cfg: ProjectionConfig, pos: Pos | undefined): PlayerBase {
  return blendBaseRate(
    pickProjection(source, ctx, (values) => nearestHealthyProjection(values, ctx.currentWeek, ctx.weeks)),
    source,
    shape,
    cfg,
    pos,
  );
}

/** The game-time tags (§6 step 3): this week's projections are injury-cut, so the Q/D/P base rate ignores them. */
const GAME_TIME: ReadonlySet<InjuryStatus> = new Set<InjuryStatus>(["PROBABLE", "QUESTIONABLE", "DOUBTFUL"]);

/** Whether a status gets the Q/D/P base rate (the file header): PROBABLE, QUESTIONABLE or DOUBTFUL. */
export function usesHealthyBaseRate(injury: InjuryStatus | undefined): boolean {
  return injury !== undefined && GAME_TIME.has(injury);
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
 * his healthy base rate (at ctx.pos's season-to-date weight, as his own b: league.ts availabilityNoteFor passes his
 * position). The caller decides who it applies to (availability.returnDateConflict).
 */
export function staleReturnCheck(inputs: PlayerInputs, ctx: BaseRateContext, cfg: ProjectionConfig = config.projections): StaleReturnCheck {
  const now = inputs.sleeper[ctx.currentWeek];
  const sleeperNow = isProjected(now) ? now : null;
  const h = priorHealthyBaseRate(inputs, ctx, cfg).b;
  const healthyRate = h > 0 && Number.isFinite(h) ? h : null;
  return { sleeperNow, healthyRate, stale: sleeperNow !== null && healthyRate !== null && sleeperNow >= cfg.staleReturnShare * healthyRate };
}

/** §6 step 5: σ = c_pos × p + d_pos for a week he's projected to score p > 0; 0 when p = 0 (no points, no spread). */
export function weeklySd(points: number, pos: Pos, cfg: Pick<ProjectionConfig, "sigma"> = config.projections): number {
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
  /**
   * His injury status (PlayerInfo.injury). PROBABLE, QUESTIONABLE and DOUBTFUL get the Q/D/P base rate (the
   * file header): this week's projections are left out of b and the week shape, and proj_now is his nearest
   * later healthy week. Absent = step 1 as is.
   */
  injury?: InjuryStatus;
}

/**
 * §6 steps 1, 2, 4, 5 and 7 for one player. `availability` is a_w per week of ctx.weeks (§6 step 3).
 * `value` is null here; the market layer (§9) fills it in. A PROBABLE, QUESTIONABLE or DOUBTFUL player
 * (ctx.injury) is projected as if neither source had projected him this week (the Q/D/P base rate in the
 * file header): b = gameTimeBaseRate's (his nearest later healthy week first), and this week's shape is 1.
 * His season-to-date weight is `pos`'s (actualWeightFor; ctx.pos isn't read).
 */
export function projectPlayer(id: string, pos: Pos, inputs: PlayerInputs, availability: ArrayLike<number>, ctx: ProjectPlayerContext, cfg: ProjectionConfig = config.projections): PlayerModel {
  if (availability.length !== ctx.weeks.length) {
    throw new Error(`projectPlayer: ${availability.length} availability values for ${ctx.weeks.length} weeks (player ${id})`);
  }
  // The Q/D/P base rate: this week's injury-cut projections count neither in b nor in the week shape (its
  // mean, and this week's own shape, which is then 1: weekShape gives 1 to a week without a projection).
  const gameTime = usesHealthyBaseRate(ctx.injury);
  const source = gameTime ? withoutWeekInputs(inputs, ctx.currentWeek) : inputs;
  const shape = weekShape(source, ctx.weeks, cfg);
  const base = gameTime ? gameTimeBase(source, ctx, shape, cfg, pos) : baseRateWithShape(source, ctx, shape, cfg, pos);
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
  /**
   * The positions left out of the sums (cfg.espnSleeperAgreementExcluded) that had a player both sources project, in the
   * config's order; absent when none was. agreement.leftOut repeats it; this one also says it when nobody else was compared
   * (agreement null), so "no rostered player has both" can say whom it leaves aside.
   */
  leftOut?: Pos[];
  /**
   * The injury statuses left out of the sums (cfg.espnSleeperAgreementExcludedStatuses) that had a player both sources project,
   * in the config's order; absent when none was. agreement.leftOutStatuses repeats it, as agreement.leftOut does leftOut. A
   * player at a left-out position is left out as that position, never under his status.
   */
  leftOutStatuses?: InjuryStatus[];
  /** Players whose sources differ by more than sourceDisagreementLog of the larger value, largest gap first (§6 "log"). */
  disagreements: ProjectionSummary["disagreements"];
}

/** What the averaging test reads of a player beside his projections (the snapshot's PlayerInfo): his position and status. */
export interface AgreementPlayerInfo {
  readonly pos: Pos;
  readonly injury?: InjuryStatus;
}

/**
 * §6 step 1, ESPN leagues: do ESPN's league-scored projections and Sleeper's (× league scoring) agree
 * within config.projections.espnSleeperAgreement on average? Measured in `week` (currentWeek) over the
 * rostered players both sources project (> 0) that week, as the ratio of sums Σ|E − S| / Σ S.
 * With `info` (the snapshot's players), a player whose position cfg.espnSleeperAgreementExcluded names (K and DEF:
 * planner reply to Checkpoint 7e, item 6), or whose injury status cfg.espnSleeperAgreementExcludedStatuses names
 * (QUESTIONABLE, DOUBTFUL and PROBABLE: planner reply to Checkpoint 7f, answer 4), is left out of the sums and the count,
 * never out of the disagreement log; a player `info` doesn't know counts. Without it every player counts, as before
 * Checkpoint 7f.
 */
export function espnSleeperAgreement(
  rosteredIds: Iterable<string>,
  players: Readonly<Record<string, PlayerInputs>>,
  week: number,
  cfg: ProjectionConfig = config.projections,
  info?: Readonly<Record<string, AgreementPlayerInfo | undefined>>,
): SourceAgreement {
  const excluded = new Set(info ? (cfg.espnSleeperAgreementExcluded ?? []) : []);
  const excludedStatuses = new Set(info ? (cfg.espnSleeperAgreementExcludedStatuses ?? []) : []);
  const leftOutSeen = new Set<Pos>();
  const statusesSeen = new Set<InjuryStatus>();
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
    const gap = Math.abs(e - s) / Math.max(e, s);
    if (gap > cfg.sourceDisagreementLog) gaps.push({ gap, row: { playerId: id, espn: e, sleeper: s, week } });
    const who = info?.[id];
    if (who !== undefined && excluded.has(who.pos)) {
      leftOutSeen.add(who.pos);
      continue;
    }
    if (who?.injury !== undefined && excludedStatuses.has(who.injury)) {
      statusesSeen.add(who.injury);
      continue;
    }
    n++;
    absDiff += Math.abs(e - s);
    sleeperSum += s;
  }
  gaps.sort((a, b) => b.gap - a.gap || (a.row.playerId < b.row.playerId ? -1 : a.row.playerId > b.row.playerId ? 1 : 0));
  const disagreements = gaps.map((g) => g.row);
  const leftOut = [...excluded].filter((pos) => leftOutSeen.has(pos));
  const leftOutStatuses = [...excludedStatuses].filter((status) => statusesSeen.has(status));
  const aside = { ...(leftOut.length ? { leftOut } : {}), ...(leftOutStatuses.length ? { leftOutStatuses } : {}) };
  if (n === 0) return { agree: false, agreement: null, ...aside, disagreements };
  const meanRelDiff = absDiff / sleeperSum;
  const agreement = {
    meanRelDiff,
    players: n,
    week,
    ...(leftOut.length ? { leftOut: [...leftOut] } : {}),
    ...(leftOutStatuses.length ? { leftOutStatuses: [...leftOutStatuses] } : {}),
  };
  return { agree: meanRelDiff <= cfg.espnSleeperAgreement, agreement, ...aside, disagreements };
}

/** The averaging test's left-out positions as a sentence names them: only ESPN leagues compare, so a team defense is a "D/ST". */
const LEFT_OUT_WORDS: Readonly<Partial<Record<Pos, string>>> = { K: "kickers", P: "punters", DEF: "D/STs" };

/** Its left-out injury statuses as an adjective before "players" ("questionable players"). */
const LEFT_OUT_STATUS_WORDS: Readonly<Partial<Record<InjuryStatus, string>>> = { QUESTIONABLE: "questionable", DOUBTFUL: "doubtful", PROBABLE: "probable" };

/** "a", "a and b", "a, b and c" (`last` "or": "a, b or c"). */
function listText(words: readonly string[], last: "and" | "or"): string {
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} ${last} ${words.at(-1)}` : (words[0] ?? "");
}

/**
 * Whom the averaging test left out of its sums, as a list: "kickers, D/STs and questionable players" (positions first, then
 * the statuses as one group: "questionable or doubtful players"), only those that had a player both sources project
 * (SourceAgreement.leftOut and .leftOutStatuses, ProjectionSummary.agreement's); "" when it left none out.
 */
export function agreementLeftOutText(leftOut: readonly Pos[] | undefined, leftOutStatuses?: readonly InjuryStatus[] | undefined): string {
  const words = (leftOut ?? []).map((pos) => LEFT_OUT_WORDS[pos] ?? `${pos}s`);
  const statuses = (leftOutStatuses ?? []).map((status) => LEFT_OUT_STATUS_WORDS[status] ?? status.toLowerCase());
  if (statuses.length) words.push(`${listText(statuses, "or")} players`);
  return listText(words, "and");
}

/**
 * ", kickers, D/STs and questionable players aside" (", kickers aside" when no D/ST and no tagged player had both
 * projections): whom the averaging test left out of its sums (agreementLeftOutText), for every text that states its result:
 * the League model's warning, the Import Report's projection note, the League page's explainer and league-report's line. ""
 * when it left none out.
 */
export function agreementAside(leftOut: readonly Pos[] | undefined, leftOutStatuses?: readonly InjuryStatus[] | undefined): string {
  const list = agreementLeftOutText(leftOut, leftOutStatuses);
  return list ? `, ${list} aside` : "";
}

/**
 * The averaging test's gap (meanRelDiff) as a text states it: a whole percent, or one decimal when that whole percent is
 * the bar's ("10.0%", "9.9%"), so a gap beside the bar never reads "differ by 10%, more than the 10% we allow" (Checkpoint
 * 7f; ⚠️ the lead's call: Oct 9's 10.03% read just that). Two decimals when the one decimal is the bar's too and the gap
 * isn't the bar itself ("10.03%", "9.96%"; review of Checkpoint 7f, AVERAGING-1: a gap from 10.00% to 10.05% still read
 * "10.0%, more than the 10% we allow"). ⚠️ Ours: within 0.005 points of the bar, where two decimals would print the bar too,
 * the nearest hundredth on the verdict's side ("10.01%" over it, "9.99%" under it). The bar itself reads "10.0%".
 */
export function agreementPercent(meanRelDiff: number, bar: number = config.projections.espnSleeperAgreement): string {
  const gap = meanRelDiff * 100;
  const at = bar * 100;
  const whole = Math.round(gap);
  if (whole !== Math.round(at)) return `${whole}%`;
  const one = gap.toFixed(1);
  if (one !== at.toFixed(1) || meanRelDiff === bar) return `${one}%`;
  const two = gap.toFixed(2);
  if (two !== at.toFixed(2)) return `${two}%`;
  return `${(at + (meanRelDiff > bar ? 0.01 : -0.01)).toFixed(2)}%`;
}

/** Players by base-rate source (ProjectionSummary.sources). */
export function baseRateSourceCounts(models: Iterable<Pick<PlayerModel, "base">>): Record<BaseRateSource, number> {
  const counts: Record<BaseRateSource, number> = { "espn+sleeper": 0, sleeper: 0, espn: 0, season: 0, actual: 0, none: 0 };
  for (const m of models) counts[m.base.source]++;
  return counts;
}
