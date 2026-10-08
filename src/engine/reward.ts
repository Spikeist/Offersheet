/**
 * League prizes: what "What does your league reward?" pays for, and how a trade's change in my odds becomes a change in my
 * share of the league's prizes (CLAUDE.md §10; planner reply to Checkpoint 7b, §6; the lead's reward engine contract for
 * Checkpoint 7c). Pure and deterministic: no I/O, no clock, every number from the settings, the snapshot or the simulation.
 *
 * The planner's math (§6): S is the share of the league's prizes a team wins this season; each prize's share is its amount
 * ÷ the total of all prizes, the weekly high score counted once per regular-season week in that total; B_win = 100 × (0.15
 * × ΔPO + 0.85 × ΔE[S]) (benefit.ts benefitWin; config.benefit.goals). So:
 * - Prize shares (PrizeShares; prizeShares): 1st, 2nd and 3rd place, every regular-season prize period's weekly high score
 *   together (weeklyHigh), and the most points in the regular season (pointsLeader), fractions adding up to 1. Blank (null)
 *   pays nothing. "Only the champion" and "Making the playoffs" pay 1st place everything (TITLE_ONLY), so ΔE[S] is ΔCH there
 *   and every number they give is the one they gave before Checkpoint 7c, bit for bit (shareChange reads only what pays).
 * - Prize periods (prizePeriods): the weekly high score is paid each regular-season matchup period, so an ESPN matchup that
 *   spans several NFL weeks is one period (the lead's call; sim.ts decides one high score per period, season.ts
 *   buildSimSetup's highScores). Parker's league: 14.
 * - The simulator gives each team's prize components (TeamOdds: pTitle, pSecond, pThird, expHighScores, pPointsLeader;
 *   PrizeOdds here), so E[S] for any split is a dot product: no simulation per split. weeklyHigh there is the expected
 *   number of the remaining periods' high scores won (ties split); the ones already won are the same before and after every
 *   trade, so they never move ΔE[S] (they aren't simulated: season.ts). Hence the weekly term's per-period share,
 *   shares.weeklyHigh ÷ periods, times the change in that count. The high scores are simulated only when a run's reward pays
 *   them (paysWeekly), so a run's weekly change is null (unknown) without them, never a 0 that measured nothing
 *   (runPrizeDeltas): a split that pays the weekly high score can't price runs made without them, and the functions that
 *   price stored runs refuse them (assertWeeklyMeasured; the review of the reward engine, compat-R1).
 * - ΔE[S] (shareChange) = Σ over the prizes whose share is above 0 of share × Δ. A prize that pays nothing is never read:
 *   then "Only the champion" can't pick up a NaN from a 3rd place nobody pays for, and its sum is 1 × ΔCH exactly. A paid
 *   prize whose odds are unknown (a playoff round played without a result we can match: season.ts) makes ΔE[S] unknown,
 *   and B_win falls back to the playoff odds alone as before (benefit.ts); a split paying only weekly highs or the points
 *   leader still reads while the bracket is unknown.
 * - "Your season's over" (prizeStillMovable): a redraft team certainly out of the title race (TeamOdds.eliminated) can
 *   still win a weekly high score while a prize period a trade can change remains, the points title while a regular-season
 *   week a trade can change remains, and (the review of the reward engine) a place the final regular-season standings decide
 *   (3rd in a bracket of 2 playoff teams or fewer, 2nd too with 1 or none: sim.ts) while such a week remains and it can still
 *   finish there (TeamOdds.bestFinish), so the season-over stops wait for those when they pay. A week under way never counts:
 *   every trade holds it at its score as rosters stand (SeasonOdds.regularLeft). ⚠️ The same holds for 3rd place after a
 *   lost semifinal (a 3rd-place game is still to play), which the lead's contract leaves out: TeamOdds.eliminated is set by a
 *   lost playoff game, by then the trade deadline has passed.
 */
import type { SeasonOdds, TeamOdds } from "./leagueModel";
import type { LeagueSnapshot } from "./model";
import { PRIZE_KEYS, type Goal, type PrizeAmounts, type PrizeKey, type TradeSettings } from "./settings";

/**
 * The share of the season's prizes each prize pays, fractions adding up to 1 (prizeShares): 1st, 2nd and 3rd place,
 * `weeklyHigh` every regular-season prize period's weekly high score together, `pointsLeader` the most points in the
 * regular season.
 */
export interface PrizeShares {
  readonly first: number;
  readonly second: number;
  readonly third: number;
  readonly weeklyHigh: number;
  readonly pointsLeader: number;
}

/** 1st place pays everything: "Only the champion" and "Making the playoffs" (and "Several prizes" with nothing entered). */
export const TITLE_ONLY: PrizeShares = Object.freeze({ first: 1, second: 0, third: 0, weeklyHigh: 0, pointsLeader: 0 });

/** Whether `shares` pays 1st place everything (TITLE_ONLY's split, however it was made). */
export function isTitleOnly(shares: PrizeShares): boolean {
  return PRIZE_KEYS.every((k) => (k === "first" ? shares[k] === 1 : !(shares[k] > 0)));
}

const isFiniteNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * The league's regular-season prize periods, each paying one weekly high score (the file header): the distinct regular-season
 * matchup periods in the schedule (a matchup's NFL weeks: an ESPN period of several weeks counts once), plus each
 * regular-season week no listed matchup covers, one each (⚠️ ours: so a schedule with weeks missing still counts the season,
 * and one listing none counts settings.regularSeasonWeeks); a points-only league counts its regular-season weeks (its
 * points accrue weekly: season.ts draws each). A matchup counts when any of its weeks is a regular-season week and it isn't
 * a playoff game.
 */
export function prizePeriods(snapshot: Pick<LeagueSnapshot, "settings" | "schedule">): number {
  const regular = new Set(snapshot.settings.regularSeasonWeeks.filter((w) => Number.isInteger(w)));
  if (snapshot.settings.pointsOnly) return regular.size;
  const periods = new Set<string>();
  const covered = new Set<number>();
  for (const m of snapshot.schedule ?? []) {
    if (m.isPlayoff) continue;
    const weeks = (m.weeks && m.weeks.length > 0 ? m.weeks : [m.week]).filter((w) => Number.isInteger(w));
    if (!weeks.some((w) => regular.has(w))) continue;
    periods.add([...weeks].sort((a, b) => a - b).join(","));
    for (const w of weeks) covered.add(w);
  }
  let uncovered = 0;
  for (const w of regular) if (!covered.has(w)) uncovered++;
  return periods.size + uncovered;
}

/**
 * Each prize's share of the season's prizes (the file header; planner reply to Checkpoint 7b, §6): its amount ÷ (1st + 2nd +
 * 3rd + the weekly high score × `periods` + the points leader), blank (null) or not above 0 paying nothing. Null when that
 * total isn't above 0 (nothing entered). Parker's 2000 / 1600 / 900: 4/9, 16/45 and 1/5.
 */
export function prizeShares(amounts: PrizeAmounts, periods: number): PrizeShares | null {
  const pay = (x: number | null | undefined): number => (isFiniteNumber(x) && x > 0 ? x : 0);
  const n = isFiniteNumber(periods) && periods > 0 ? Math.floor(periods) : 0;
  const first = pay(amounts.first);
  const second = pay(amounts.second);
  const third = pay(amounts.third);
  const weekly = pay(amounts.weeklyHigh) * n;
  const leader = pay(amounts.pointsLeader);
  const total = first + second + third + weekly + leader;
  if (!(total > 0) || !Number.isFinite(total)) return null;
  return { first: first / total, second: second / total, third: third / total, weeklyHigh: weekly / total, pointsLeader: leader / total };
}

/**
 * `shares` as whole percents adding up to exactly 100, by the largest remainder (ties in PRIZE_KEYS order; remainders within
 * 1e-9 are ties, so float noise can't break one): Parker's 4/9, 16/45, 1/5 read 44 / 36 / 20. A share of 0 stays 0. What the
 * anonymous feedback copy keeps (planner reply to Checkpoint 7b, §6: "only the shares, rounded to whole percents, never the
 * amounts").
 */
export function prizePercents(shares: PrizeShares): Record<PrizeKey, number> {
  const out = {} as Record<PrizeKey, number>;
  const rest: { k: PrizeKey; frac: number; order: number }[] = [];
  let sum = 0;
  PRIZE_KEYS.forEach((k, order) => {
    const raw = Math.max(0, isFiniteNumber(shares[k]) ? shares[k] * 100 : 0);
    const whole = Math.floor(raw + 1e-9);
    out[k] = whole;
    sum += whole;
    if (shares[k] > 0) rest.push({ k, frac: raw - whole, order });
  });
  rest.sort((a, b) => (Math.abs(a.frac - b.frac) > 1e-9 ? b.frac - a.frac : a.order - b.order));
  for (let i = 0; sum < 100 && rest.length > 0; i = (i + 1) % rest.length) {
    out[(rest[i] as (typeof rest)[number]).k]++;
    sum++;
  }
  return out;
}

/**
 * What a League model or a trade reads B_win by (rewardOf; LeagueModel.reward, TradeSearchResult.reward): the goal (its
 * weights on ΔPO and ΔE[S]: config.benefit.goals), the prize shares, the league's prize periods (the weekly term's divisor)
 * and `empty`: "Several prizes" with nothing entered, read as 1st place paying everything until something is (the Settings
 * page says so).
 */
export interface Reward {
  readonly goal: Goal;
  readonly shares: PrizeShares;
  readonly periods: number;
  readonly empty: boolean;
}

/**
 * The reward a league's settings give (the file header): "title" and "playoffs" pay 1st place everything (TITLE_ONLY);
 * "prizes" pays the league's split (prizeShares over prizePeriods), or 1st place everything, `empty`, while the amounts add
 * up to nothing.
 */
export function rewardOf(settings: Pick<TradeSettings, "goal" | "prizes">, snapshot: Pick<LeagueSnapshot, "settings" | "schedule">): Reward {
  return rewardWith(settings, prizePeriods(snapshot));
}

/** rewardOf with the league's prize periods given (prizePeriods): the reports price stored runs under another split with it. */
export function rewardWith(settings: Pick<TradeSettings, "goal" | "prizes">, periods: number): Reward {
  if (settings.goal !== "prizes") return { goal: settings.goal, shares: TITLE_ONLY, periods, empty: false };
  const shares = settings.prizes ? prizeShares(settings.prizes, periods) : null;
  return shares ? { goal: "prizes", shares, periods, empty: false } : { goal: "prizes", shares: TITLE_ONLY, periods, empty: true };
}

/**
 * Whether a reward pays the weekly high score, so the season's runs simulate the high scores (season.ts buildSimSetup's
 * highScores: league.ts step 8, the trade context's simulation in evaluate.ts, the reports).
 */
export function paysWeekly(reward: Pick<Reward, "shares"> | null | undefined): boolean {
  return (reward?.shares.weeklyHigh ?? 0) > 0;
}

/**
 * One team's prize components from a simulation (TeamOdds; the file header), on PrizeShares' keys: P(1st) = P(title),
 * P(2nd), P(3rd) (null when unknown: season.ts), the expected number of the remaining prize periods' high scores won (ties
 * split; 0 when none were simulated) and P(most points in the regular season) (ties split).
 */
export interface PrizeOdds {
  first: number | null;
  second: number | null;
  third: number | null;
  weeklyHigh: number;
  pointsLeader: number;
}

/** The changes in a team's prize components from one simulation to another (prizeDeltas); null when either side is unknown. */
export type PrizeDeltas = { [K in PrizeKey]: number | null };

/** A team's prize components (PrizeOdds) from its TeamOdds. */
export function prizeOddsOf(t: Pick<TeamOdds, "pTitle"> & Partial<Pick<TeamOdds, "pSecond" | "pThird" | "expHighScores" | "pPointsLeader">>): PrizeOdds {
  return { first: t.pTitle, second: t.pSecond ?? null, third: t.pThird ?? null, weeklyHigh: t.expHighScores ?? 0, pointsLeader: t.pPointsLeader ?? 0 };
}

/** `after` − `before`, component by component; null where either is unknown (not a finite number). */
export function prizeDeltas(before: PrizeOdds, after: PrizeOdds): PrizeDeltas {
  const d = {} as Record<PrizeKey, number | null>;
  for (const k of PRIZE_KEYS) {
    const a = after[k];
    const b = before[k];
    d[k] = isFiniteNumber(a) && isFiniteNumber(b) ? a - b : null;
  }
  return d;
}

/**
 * Two runs' prize changes as the engine keeps them (league.ts gainedOdds: ω's runs and the "Helps you" calibration;
 * evaluate.ts simulateTrade): prizeDeltas, with the weekly high scores' change known only when both runs simulated them
 * (`highScores`, season.ts buildSimSetup's option, which a build sets only when its own reward pays them). Without them
 * every team reads 0 high scores in both runs, a 0 that measured nothing, so the change is null (unknown): a reward that pays
 * the weekly high score then can't read these runs (shareChange null), and the functions that price stored runs refuse them
 * (assertWeeklyMeasured; the review of the reward engine, compat-R1: a report pricing a title build's runs under a split that
 * pays the weekly prize got an "auto" ω and a B₃ that left it out, with no word).
 */
export function runPrizeDeltas(before: PrizeOdds, after: PrizeOdds, highScores: boolean): PrizeDeltas {
  const d = prizeDeltas(before, after);
  return highScores ? d : { ...d, weeklyHigh: null };
}

/**
 * Throws when `reward` pays the weekly high score and `run`, a run that was made (its ΔPO a number), didn't simulate the
 * high scores (its weekly change unknown: runPrizeDeltas, or absent in a run made before Checkpoint 7c): pricing it under
 * that reward would leave the weekly prize out with no word, a wrong ω or B₃ (league.ts playoffWeightFrom, benefit.ts
 * helpsScale read it; evaluate.ts rewardOn is the trade context's own guard). The app never gets here: a League model's and a
 * trade context's runs simulate the high scores whenever their own reward pays them, and every call is priced under its own
 * build's reward. A report that prices runs under another split must build them under that split when it pays the weekly
 * high score. `what` names the runs in the message.
 */
export function assertWeeklyMeasured(reward: Pick<Reward, "shares">, run: { readonly dPO: number | null; readonly dPrizes?: Partial<PrizeDeltas> | null }, what: string): void {
  if (!paysWeekly(reward) || !isFiniteNumber(run.dPO) || isFiniteNumber(run.dPrizes?.weeklyHigh)) return;
  throw new Error(`${what} didn't simulate the weekly high scores this reward pays: make them under its settings.`);
}

/** Only P(title)'s change known (the title-only callers: tests, the reports' runs made before Checkpoint 7c). */
export function titleDeltas(dCH: number | null): PrizeDeltas {
  return { first: dCH, second: null, third: null, weeklyHigh: null, pointsLeader: null };
}

/** The share one unit of a prize component pays: its share, the weekly high score's per prize period. */
function perUnit(k: PrizeKey, reward: Pick<Reward, "shares" | "periods">): number {
  const share = reward.shares[k];
  if (!(share > 0)) return 0;
  if (k !== "weeklyHigh") return share;
  return isFiniteNumber(reward.periods) && reward.periods > 0 ? share / reward.periods : 0;
}

/**
 * ΔE[S] (the file header): Σ over the prizes that pay (share above 0) of share × Δ (the weekly high score: its share ÷ the
 * prize periods × the change in high scores won), in PRIZE_KEYS order; a prize that pays nothing is never read. Null when a
 * paid prize's change is unknown. TITLE_ONLY: 1 × ΔCH, exactly ΔCH.
 */
export function shareChange(d: Partial<PrizeDeltas> | null | undefined, reward: Pick<Reward, "shares" | "periods">): number | null {
  let sum: number | null = null;
  for (const k of PRIZE_KEYS) {
    const unit = perUnit(k, reward);
    if (!(unit > 0)) continue;
    const x = d?.[k];
    if (!isFiniteNumber(x)) return null;
    const term = unit * x;
    sum = sum === null ? term : sum + term;
  }
  return sum ?? 0;
}

/** Whether every prize that pays has known odds (`odds`; the weekly high score and the points leader always do). */
export function paidPrizesKnown(odds: PrizeOdds, reward: Pick<Reward, "shares" | "periods">): boolean {
  return PRIZE_KEYS.every((k) => !(perUnit(k, reward) > 0) || isFiniteNumber(odds[k]));
}

/**
 * Whether a team's trades can still change its share of the prizes (the file header, "Your season's over"), on a season's
 * odds (`odds`) and the team's own in them (`team`). False
 * only when the team is certainly out of the title race (TeamOdds.eliminated) and no prize the reward pays is still within a
 * trade's reach (SeasonOdds.regularLeft: the week under way left out, since every trade holds it at its score as rosters
 * stand):
 * - a weekly high score, while a prize period is left;
 * - the points title, while a regular-season week is left;
 * - (the review of the reward engine) a place the final regular-season standings decide (sim.ts: 3rd in a bracket of 2
 *   playoff teams or fewer, 2nd too with 1 or none), while a regular-season week is left and the team can still finish
 *   there (TeamOdds.bestFinish).
 * The season-over stops read it (evaluate.ts on its baseline's odds; the League page and Waiver upgrades on the headline's,
 * LeagueModel.odds, the same numbers).
 */
export function prizeStillMovable(reward: Pick<Reward, "shares">, odds: Pick<SeasonOdds, "playoffTeams" | "regularLeft">, team: Pick<TeamOdds, "eliminated" | "bestFinish">): boolean {
  if (!team.eliminated) return true;
  const { shares } = reward;
  // Not known (an odds object made before Checkpoint 7c): a paid prize is taken as still within reach.
  const periods = odds.regularLeft ? odds.regularLeft.periods : Number.POSITIVE_INFINITY;
  const weeks = odds.regularLeft ? odds.regularLeft.weeks : Number.POSITIVE_INFINITY;
  if (shares.weeklyHigh > 0 && periods > 0) return true;
  if (!(weeks > 0)) return false;
  if (shares.pointsLeader > 0) return true;
  // The deepest paid place the final standings decide (none in a bracket of 3 or more: its places are the playoffs').
  const n = odds.playoffTeams;
  const place = shares.third > 0 && n <= 2 ? 3 : shares.second > 0 && n <= 1 ? 2 : 0;
  // A best finish that isn't a number (an odds object made before it) can't rule the place out.
  return place > 0 && !(team.bestFinish > place);
}
