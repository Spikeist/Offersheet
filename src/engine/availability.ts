/**
 * Availability (CLAUDE.md §6 step 3 and §7; planner reply to Checkpoint 1, answer 5 and additions B
 * and C). Pure and deterministic: no I/O, no clock. Every tunable number comes from config.projections
 * (injury, returnWeekSpread, injuryRisk); randomness comes from rng.ts.
 *
 * Availability a_{i,w} is the chance player i plays in NFL week w. It's kept apart from how many points
 * he scores when he plays (b × m, §6 steps 1–2), so nothing is counted twice. ONE model gives both the
 * expected availability that p = b·m·a uses (§6 step 4) and the availability scenarios whose lineups
 * give depth its credit (§7, addition C):
 *
 * 1. Return week T, the first week he can play again (returnWeekDistribution), from his status in the
 *    current NFL week w0:
 *    - ACTIVE: w0.
 *    - PROBABLE / QUESTIONABLE / DOUBTFUL: w0 with the table's chance (0.95 / 0.85 / 0.25), else w0 + 1.
 *    - OUT: the table [0, 0.5, 0.85] is the cumulative chance he's back, so T = w0+1 (0.5), w0+2 (0.35)
 *      or w0+3 (0.15). Without future injuries this reproduces §6's multipliers exactly.
 *    - IR / PUP without a return week: 0 for 4 weeks, then 0.8, then 1: T = w0+4 (0.8) or w0+5 (0.2).
 *    - SUSPENDED: exactly the known week (suspensions have fixed lengths), else w0 + 2.
 *    - NA (not an active NFL player): never when notActive is 0; otherwise healthy now, and every week
 *      he plays with chance notActive.
 *    - A known return week R (ESPN's expected return date) is uncertain by a week either way: T is
 *      R − 1, R or R + 1 with returnWeekSpread, never earlier than his status allows (OUT, IR, PUP and
 *      SUSPENDED miss w0). Mass below that week moves up to it, so a date that has passed means "back
 *      at the first week he can be", and R at that first week still keeps its chance of a week's delay.
 *      IR and PUP use any known R; OUT uses R ≥ w0 + 1 (an OUT player whose date has passed falls back
 *      to the table); PROBABLE / QUESTIONABLE / DOUBTFUL use R only when it's at least two weeks out
 *      (ESPN then expects a longer absence than the tag says).
 *    - Conflicting ESPN signals (CLAUDE.md §6 step 3; planner reply to Checkpoint 2, answer 6): that last
 *      case, a PROBABLE / QUESTIONABLE / DOUBTFUL tag with a return week 2+ weeks out, is two ESPN
 *      signals that disagree (returnDateConflict names it). Sleeper breaks the tie, in league.ts: when it
 *      still projects him this week at config.projections.staleReturnShare or more of his healthy base
 *      rate (projections.ts staleReturnCheck), the date is stale and the player is passed WITHOUT his
 *      return week, so the one-week table for his tag applies (then he's healthy); otherwise he keeps it
 *      and follows the date. Expected availability and the scenarios read the same player, so both
 *      follow the same signal, and his random stream doesn't change (see common random numbers below).
 *    - injuryReturnWeek = last NFL week + 1 means "not back this season" (§4). Given lastNflWeek, any
 *      R after it means no return at all. Without it, the spread lies past every fantasy week when the
 *      fantasy season ends before the NFL's last week, which gives 0 there too.
 * 2. Future injuries (addition B): a two-state weekly chain. Healthy → out with chance h each week,
 *    out → healthy with chance r = 1 / meanInjuryWeeks, and h = M·r / (1 − M), so the long-run share of
 *    weeks out is M = missShare[pos]. Healthy at T, he's out k weeks later with chance
 *    pOut(k) = M·(1 − (1 − h − r)^k); a player out now is healthy k weeks later with chance
 *    pRecover(k) = (1 − M)·(1 − (1 − h − r)^k).
 * 3. Gates: nobody plays in his NFL team's bye week, in week w0 once his game has kicked off
 *    ("started": the game is no longer a remaining one), or at all without an NFL team.
 *
 * Expected availability: a_w = gates(w) · Σ_t P(T = t)·1{w ≥ t}·(1 − pOut(w − t)), times notActive for NA.
 * Scenario s draws T by inverse CDF and walks the chain; its flags average to exactly a_w (tested).
 *
 * Common random numbers: scenario s of a player uses streamFor(seed, playerId, s) and always draws its
 * uniforms in the same order: u0 picks T; then, for each listed week in order, one uniform for the chain
 * step into that week (drawn but unused before T) and, only for an NA player with 0 < notActive < 1, one
 * more for whether he plays. (A scenario whose T is after the last listed week has no flags to set and
 * stops after u0.) His draws therefore depend only on (seed, playerId, s): not on T, his team,
 * the other players or S (the first S' rows of an S-scenario run are the S'-scenario run), and two
 * versions of a player (say, before and after news of an injury) walk the same chain once both are
 * healthy. Weeks with gaps between them are walked with the exact g-week transition probabilities, so
 * a_w stays exact for any ascending list of weeks.
 */
import { config } from "./config";
import type { InjuryStatus, PlayerInfo, Pos } from "./model";
import { hash32, mix32, mulberry32 } from "./rng";

/** First week he can play again, and its probability; weeks may lie past the last fantasy week. */
export interface ReturnWeek {
  week: number;
  p: number;
}

/** The future-injury chain for a position (addition B): long-run share of weeks out, weekly recovery and new-injury chances. */
export interface InjuryRisk {
  M: number;
  r: number;
  h: number;
}

export interface AvailabilityContext {
  /** The weeks to evaluate, ascending: the remaining NFL weeks currentWeek..lastWeek. */
  weeks: readonly number[];
  currentWeek: number;
  /** His NFL team's bye week (undefined = none or unknown). */
  byeWeek: number | undefined;
  /** His currentWeek game has kicked off: that week is no longer a remaining game. */
  started: boolean;
  /** nflTeam !== null: a player without an NFL team never plays. */
  hasTeam: boolean;
  /** The NFL regular season's last week, when known: a known return week after it means "not back this season" (§4). */
  lastNflWeek?: number;
}

/** What availability reads from a player (PlayerInfo satisfies it). */
export type AvailabilityPlayer = Pick<PlayerInfo, "injury" | "injuryReturnWeek">;

/** The slice of config.projections this module reads (widened from the `as const` literals so tests can vary it). */
export interface AvailabilityConfig {
  injury: {
    readonly OUT: readonly number[];
    readonly DOUBTFUL: readonly number[];
    readonly QUESTIONABLE: readonly number[];
    readonly PROBABLE: readonly number[];
    readonly irUnknown: { readonly outWeeks: number; readonly after: readonly number[] };
    readonly suspendedUnknownWeeks: number;
    readonly notActive: number;
  };
  returnWeekSpread: readonly number[];
  injuryRisk: { readonly meanInjuryWeeks: number; readonly missShare: Readonly<Record<Pos, number>> };
}

/** A whole, non-negative number of weeks from config. */
function weekCount(x: number): number {
  return Number.isFinite(x) ? Math.max(0, Math.round(x)) : 0;
}

/** A known return week as a whole week, or undefined when none is known (missing or not a number). */
function knownWeek(injuryReturnWeek: number | undefined): number | undefined {
  return injuryReturnWeek !== undefined && Number.isFinite(injuryReturnWeek) ? Math.round(injuryReturnWeek) : undefined;
}

/** The statuses that say a player may play this week ("game-time" tags). */
export type GameTimeStatus = "PROBABLE" | "QUESTIONABLE" | "DOUBTFUL";

function isGameTime(injury: InjuryStatus): injury is GameTimeStatus {
  return injury === "PROBABLE" || injury === "QUESTIONABLE" || injury === "DOUBTFUL";
}

/**
 * Conflicting ESPN signals (§6 step 3): a PROBABLE, QUESTIONABLE or DOUBTFUL player whose known return
 * week is 2+ weeks away. His tag says he may play this week, ESPN's return date says he's out longer;
 * returnWeekDistribution follows the date for him, and the caller breaks the tie (see the file header).
 * Null for everyone else: another status, no known return week, or one within a week of now (the tag's
 * one-week table then applies whatever the date says). A return week after the NFL's last week ("out for
 * the season") is a conflict too.
 */
export function returnDateConflict(player: AvailabilityPlayer, currentWeek: number): { status: GameTimeStatus; returnWeek: number } | null {
  const R = knownWeek(player.injuryReturnWeek);
  if (R === undefined || !isGameTime(player.injury) || !(R >= currentWeek + 2)) return null;
  return { status: player.injury, returnWeek: R };
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

/**
 * Return weeks from a table of availability multipliers by weeks from now (index 0 = w0, then 1),
 * read as the cumulative chance he's back: P(T ≤ w0 + k) = table[k]. A table that dips is read as
 * its running maximum (a player back can't be un-back).
 */
function fromCumulative(table: readonly number[], w0: number): ReturnWeek[] {
  const out: ReturnWeek[] = [];
  let prev = 0;
  for (let k = 0; k < table.length; k++) {
    const cum = Math.max(prev, clamp01(table[k] ?? 0));
    if (cum > prev) out.push({ week: w0 + k, p: cum - prev });
    prev = cum;
  }
  if (prev < 1) out.push({ week: w0 + table.length, p: 1 - prev });
  return out;
}

/** returnWeekSpread centered on R (odd length; entries normalized to sum 1), never before `earliest`. */
function spreadAround(R: number, earliest: number, spread: readonly number[]): ReturnWeek[] {
  let total = 0;
  for (const p of spread) total += Math.max(0, Number.isFinite(p) ? p : 0);
  if (!(total > 0)) return [{ week: Math.max(R, earliest), p: 1 }];
  const half = Math.floor((spread.length - 1) / 2);
  const byWeek = new Map<number, number>();
  spread.forEach((raw, i) => {
    const p = Math.max(0, Number.isFinite(raw) ? raw : 0) / total;
    if (p === 0) return;
    const week = Math.max(earliest, R - half + i);
    byWeek.set(week, (byWeek.get(week) ?? 0) + p);
  });
  return [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([week, p]) => ({ week, p }));
}

/**
 * The distribution of the first week he can play again (§6 step 3, addition C), sorted by week. Sums
 * to 1; empty = never back (NA with notActive 0, or a known return week after lastNflWeek: "not back
 * this season"). See the file header for the rule per status.
 */
export function returnWeekDistribution(
  injury: InjuryStatus,
  injuryReturnWeek: number | undefined,
  currentWeek: number,
  cfg: AvailabilityConfig = config.projections,
  lastNflWeek?: number,
): ReturnWeek[] {
  const w0 = currentWeek;
  const R = knownWeek(injuryReturnWeek);
  const notBackThisSeason = R !== undefined && lastNflWeek !== undefined && R > lastNflWeek;
  const known = (r: number, earliest: number): ReturnWeek[] => (notBackThisSeason ? [] : spreadAround(r, earliest, cfg.returnWeekSpread));
  switch (injury) {
    case "ACTIVE":
      return [{ week: w0, p: 1 }];
    case "PROBABLE":
    case "QUESTIONABLE":
    case "DOUBTFUL":
      // A date 2+ weeks out conflicts with the tag (returnDateConflict); the caller drops it when stale.
      return R !== undefined && R >= w0 + 2 ? known(R, w0) : fromCumulative(cfg.injury[injury], w0);
    case "OUT":
      return R !== undefined && R >= w0 + 1 ? known(R, w0 + 1) : fromCumulative(cfg.injury.OUT, w0);
    case "IR":
    case "PUP": {
      if (R !== undefined) return known(R, w0 + 1);
      const { outWeeks, after } = cfg.injury.irUnknown;
      return fromCumulative([...new Array<number>(weekCount(outWeeks)).fill(0), ...after], w0);
    }
    case "SUSPENDED":
      // A suspension's length is exact: no spread. He's suspended now, so never back before w0 + 1.
      if (R !== undefined) return notBackThisSeason ? [] : [{ week: Math.max(R, w0 + 1), p: 1 }];
      return [{ week: w0 + weekCount(cfg.injury.suspendedUnknownWeeks), p: 1 }];
    case "NA":
      return clamp01(cfg.injury.notActive) > 0 ? [{ week: w0, p: 1 }] : [];
  }
  // Unreachable for a typed status; an unknown one at runtime plays like ACTIVE.
  return [{ week: w0, p: 1 }];
}

/** The chance he plays in a week he's healthy for: notActive for NA (applied every week), else 1. */
export function activeShare(injury: InjuryStatus, cfg: AvailabilityConfig = config.projections): number {
  return injury === "NA" ? clamp01(cfg.injury.notActive) : 1;
}

/**
 * The future-injury chain for a position (addition B): r = 1 / meanInjuryWeeks (an injury lasts at
 * least a week, so r ≤ 1), h = M·r / (1 − M) (M = 0 → h = 0). M is capped at 1 / (1 + r) so h ≤ 1;
 * an infinite mean length (r = 0: injuries never heal) turns the risk off.
 */
export function injuryRisk(pos: Pos, cfg: AvailabilityConfig = config.projections): InjuryRisk {
  const d = cfg.injuryRisk.meanInjuryWeeks;
  const r = d >= 1 ? 1 / d : 1;
  const share = cfg.injuryRisk.missShare[pos] ?? 0;
  const M = r > 0 ? Math.min(clamp01(share), 1 / (1 + r)) : 0;
  const h = M > 0 ? (M * r) / (1 - M) : 0;
  return { M, r, h };
}

/** P(out k weeks later | healthy now) = M·(1 − (1 − h − r)^k); k whole weeks, pOut(0) = 0. */
export function pOut(k: number, risk: InjuryRisk): number {
  if (!(k > 0) || !(risk.M > 0)) return 0;
  return risk.M * (1 - Math.pow(1 - risk.h - risk.r, k));
}

/** P(healthy k weeks later | out now) = (1 − M)·(1 − (1 − h − r)^k); k whole weeks, pRecover(0) = 0. */
export function pRecover(k: number, risk: InjuryRisk): number {
  if (!(k > 0)) return 0;
  return (1 - risk.M) * (1 - Math.pow(1 - risk.h - risk.r, k));
}

/** Whether his NFL team still has a game he can play in `week`: he has a team, it isn't his bye, and it hasn't kicked off (currentWeek). */
export function canPlayWeek(ctx: AvailabilityContext, week: number): boolean {
  return ctx.hasTeam && week !== ctx.byeWeek && !(ctx.started && week === ctx.currentWeek);
}

/** a_{i,w} per week of ctx.weeks (§6 step 3 with future injury risk): the exact expectation of scenarioAvailability. */
export function expectedAvailability(player: AvailabilityPlayer, pos: Pos, ctx: AvailabilityContext, cfg: AvailabilityConfig = config.projections): number[] {
  const out = new Array<number>(ctx.weeks.length).fill(0);
  if (!ctx.hasTeam) return out;
  const dist = returnWeekDistribution(player.injury, player.injuryReturnWeek, ctx.currentWeek, cfg, ctx.lastNflWeek);
  const share = activeShare(player.injury, cfg);
  if (dist.length === 0 || share === 0) return out;
  const risk = injuryRisk(pos, cfg);
  ctx.weeks.forEach((w, wi) => {
    if (!canPlayWeek(ctx, w)) return;
    let a = 0;
    for (const { week: t, p } of dist) if (w >= t) a += p * (1 - pOut(w - t, risk));
    out[wi] = share * a;
  });
  return out;
}

/**
 * S availability scenarios (§7, addition C): flags, 1 = he plays, as S × weeks.length bytes in
 * row-major order (scenario s, week index wi at [s·W + wi]). Scenario s uses streamFor(seed, playerId, s);
 * see the file header for the draw order. Their mean is expectedAvailability exactly.
 */
export function scenarioAvailability(
  playerId: string,
  player: AvailabilityPlayer,
  pos: Pos,
  ctx: AvailabilityContext,
  S: number,
  seed: number,
  cfg: AvailabilityConfig = config.projections,
): Uint8Array {
  const weeks = ctx.weeks;
  const W = weeks.length;
  const n = Number.isFinite(S) ? Math.max(0, Math.floor(S)) : 0;
  const flags = new Uint8Array(n * W);
  if (!ctx.hasTeam || W === 0 || n === 0) return flags;
  const dist = returnWeekDistribution(player.injury, player.injuryReturnWeek, ctx.currentWeek, cfg, ctx.lastNflWeek);
  const share = activeShare(player.injury, cfg);
  if (dist.length === 0 || share === 0) return flags;
  const risk = injuryRisk(pos, cfg);

  // Inverse CDF of the return week.
  const tWeeks = dist.map((d) => d.week);
  const cum = new Float64Array(dist.length);
  let acc = 0;
  dist.forEach((d, i) => {
    acc += d.p;
    cum[i] = acc;
  });
  const lastT = tWeeks.length - 1;

  // Per week: the gates; per gap of g weeks: the chain's g-week transition chances.
  const gate = new Uint8Array(W);
  weeks.forEach((w, wi) => {
    gate[wi] = canPlayWeek(ctx, w) ? 1 : 0;
  });
  const firstWeek = weeks[0] as number;
  const lastWeek = weeks[W - 1] as number;
  const maxGap = Math.max(1, lastWeek - Math.min(firstWeek, tWeeks[0] as number));
  const hurt = new Float64Array(maxGap + 1);
  const heal = new Float64Array(maxGap + 1);
  for (let g = 1; g <= maxGap; g++) {
    hurt[g] = pOut(g, risk);
    heal[g] = pRecover(g, risk);
  }
  const drawShare = share < 1;

  const keySeed = mix32(seed, hash32(playerId));
  for (let s = 0; s < n; s++) {
    const rand = mulberry32(mix32(keySeed, s)); // = streamFor(seed, playerId, s)
    const u0 = rand();
    let ti = 0;
    while (ti < lastT && u0 >= (cum[ti] as number)) ti++;
    const t = tWeeks[ti] as number;
    if (t > lastWeek) continue; // back only after the last week: never plays
    const row = s * W;
    // Healthy at T. The first listed week ≥ T is w − T chain steps after it; each later week is g steps on.
    let healthy = true;
    let prev = t;
    for (let wi = 0; wi < W; wi++) {
      const w = weeks[wi] as number;
      const u = rand();
      const v = drawShare ? rand() : 0;
      if (w < t) continue;
      const g = w > prev ? Math.min(w - prev, maxGap) : 0;
      healthy = healthy ? !(u < (hurt[g] as number)) : u < (heal[g] as number);
      prev = w;
      if (healthy && gate[wi] === 1 && (!drawShare || v < share)) flags[row + wi] = 1;
    }
  }
  return flags;
}
