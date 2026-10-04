/**
 * Acceptance probability (CLAUDE.md §11; lead decision L8 of the Phase 4 design): the chance the partner P
 * accepts a trade, a logistic model over features of the trade and of P. Pure and deterministic: plain inputs,
 * no I/O and no clock (the moment, `now`, is passed in); every tunable number comes from config.acceptance. It's
 * a model, not a promise: the UI labels it "Est." and rounds it to the nearest 5%.
 *
 * Features (§11's table with L8's readings; P = the partner):
 * - g = P's perceived g, clamped to gClamp ±0.5; g⁺ = max(g, 0), g⁻ = min(g, 0). +∞ (P gives nothing of value)
 *   clamps; NaN counts 0. The perceived g (planner addendum to Checkpoint 3, §1; TradeAcceptanceInput.gPerceived) is
 *   g_mkt(P) with the star premium on the players P gives: v′ = max(v, W) × (1 + e), managers valuing their own best
 *   players a bit above market (premium.ts perceivedPackage). Without one (a caller that has no premiums), g = g_mkt(P)
 *   itself (§9; market.marketGain, or benefit.tradePackage when picks are in it). Both on perception values (redraft
 *   values in redraft and keeper leagues, dynasty values in dynasty leagues: market.valuesForTerm), each player counted
 *   at max(v, W) (planner reply to Checkpoint 4, change 4: market.packageValues, the one place every package sum goes
 *   through). Only this feature reads the perceived g: the veto rule, the partner's trade history and everything on
 *   the card read the raw g_mkt(P) (no premium; floored at W like every package).
 * - n = ΔLineup_P / nScale (5 points per week = 1 unit), clamped to nClamp ±2. ΔLineup_P is the change in P's
 *   average weekly starting points, blended 50/50 (weight nBlendWeight 0.5 on the first) between the next
 *   nBlendNextWeeks (4) weeks and the rest of the season, both from P's V* lineups before and after (§7's
 *   free-agent optimizer; EV lineups in screening, scenario lineups in exact evaluation): partnerLineupDelta,
 *   from the first week team numbers count (TeamWeeks.from: a week in progress is skipped), every remaining
 *   week unweighted (regular season and playoffs). Not §10's ΔPPW.
 * - h = 1 when the trade gives P a starter at a hole (holeFeature). A hole is one of P's slot instances (QB1,
 *   RB2, …) whose starter averages below holeFractionOfMedian (60%) × the league median there over the next
 *   holeWeeks (3) weeks (an injury or bye hole). The trade fills it when the instance's starter averages more
 *   over those weeks after the trade than before (P's V* lineups) and a player P receives who can play the
 *   slot (his positions overlap the slot's) starts for P after the trade. Who sits in the hole instance itself
 *   doesn't matter: instances are sorted by points within a slot name (needs.instancePointsInto), so a
 *   received RB better than P's RB1 takes RB1 and pushes the old RB1 down into an RB2 hole, and a received WR
 *   fills a FLEX hole by pushing P's old WR2 into FLEX. A better starter still under the cut counts (§11:
 *   "gives P a starter at a slot where …"). A hole only a free agent fills (P's V* re-optimization) doesn't
 *   count unless a received starter could play there. ⚠️ A cascade through two different flex slots (a
 *   received TE at W/T pushing a WR into a W/R hole) is missed; no common lineup has both.
 * - c = assets in the trade − 2 (L8: picks count), so 0 for a 1-for-1. ⚠️ Ours: never below 0 (a 1-for-0 the
 *   Analyzer can build isn't simpler than a 1-for-1).
 * - a (activity; first rule that matches): +1 when P made at least tradesForActive (2) trades this season or at
 *   least 1 in the last recentTradeWeeks (4) weeks; −2 when P had no transaction of any type in the last
 *   inactiveWeeks (5) weeks; −1 when none in the last quietWeeks (3) weeks; else 0. "The last N weeks" = the
 *   transactions whose week is above week − N, `week` being the week the platform numbers transactions in
 *   (snapshot.leagueWeek ?? snapshot.currentWeek: Sleeper numbers them by league week), so the current week
 *   counts (and a later one, which ESPN can give a waiver run, too). A transaction is P's when P is in its teams
 *   or one of its moves comes from or goes to P. Completed trades only (the adapters keep executed ones).
 * - hist: the average g_mkt(P) over P's completed trades this season at current perception values (and the
 *   current waiver credit W: each player at max(v, W), as in every package); only the average is clamped, to
 *   historyClamp ±0.15 (§11). Null without any
 *   (then it adds nothing). Positive = P usually wins trades on value, which lowers acceptance (−β_hist). A
 *   trade's sides are its legs (moves from one team to another; adds and drops riding along aren't). A trade
 *   where P gave nothing of value has g = +∞, so the average is +∞ and hist +0.15: the limit of a given side
 *   worth almost nothing (one lopsided win can decide the average; the clamp bounds its effect). Left out
 *   (counted in `skipped`): a trade without both of P's sides (ESPN hides other teams' trade details; a
 *   refilled ESPN trade misses players since dropped), one with a player who has no current value, and one
 *   with draft picks unless the caller values picks (pickValue) and the trade has two teams (a pick in the
 *   model names its new owner only, so in a 2-team trade the other team gave it).
 * - ctx (season context; P(playoffs) from the baseline simulation, every team at V*, computed once per search):
 *   redraft and keeper leagues: below checkedOutBelow (5%) → checkedOut (−0.8, they've checked out); dynasty
 *   leagues, a rebuilding partner (below rebuildingBelow, 25%): oldPlayerPenalty (−0.25) for each RB or WR P
 *   would receive aged oldPlayerAge (28) or older (an unknown age doesn't count); any league, a contender
 *   (above contenderAbove, 60%): n × contenderNeedFactor (1.3). The contender factor is carried in ctx as
 *   β_need × n × (factor − 1) (the league type's β_need: betaNeed), so z is exactly the sum of the stored features'
 *   terms (AcceptanceFeatures.n is before the factor, ctx is in logit units). Unknown P(playoffs) (no simulation) →
 *   no context.
 * - hot (recency): +bonus (0.15) when a player P receives scored at least multiple (1.5) × his projection in
 *   each of the last `weeks` (2) completed weeks (hotWeeks: the weeks before the current one), −bonus when a
 *   player P gives up did; both → 0. His projection that week: Sleeper's league-scored one (ModelInputs
 *   PlayerInputs.sleeper), else ESPN's (PlayerInputs.espn: §11's "or ESPN statSourceId 1"), a positive number;
 *   his points: PlayerInputs.actual (league scoring, weeks he played). Anything missing (a bye, a stub, no
 *   inputs) → not hot: it's his last two weeks, not his last two games. ⚠️ Sleeper re-stamps past weeks'
 *   projections after the games (§5), so these are the re-stamped ones.
 * - urg: +bonus (0.2) from deadline − days (7) through the deadline when its date is known (`now` passed in);
 *   when only its week is known, during the deadline week and the week before (the same `week` as activity:
 *   Sleeper's deadline is a league week). After the deadline, 0.
 *
 * Model (§11): z = β0 + β_gain·g⁺ + β_loss·g⁻ + β_need·n + β_hole·h − β_cx·c + β_act·a − β_hist·hist + ctx + hot
 * + urg; P_accept = clamp(σ(z), pAcceptClamp [0.02, 0.85]: no offer is a sure thing, planner reply to Checkpoint 4,
 * change 2), σ the logistic function. β_need (betaNeed) is beta.need (1.2) in redraft and keeper leagues and
 * beta.needDynasty (0.6) in dynasty leagues (change 2: in redraft a manager's own lineup weighs more), wherever n is
 * weighed: the need term, the contender factor's extra in ctx, and the quick variant. β_loss > β_gain on purpose
 * (losses weigh more). Veto risk: when the league reviews trades (tradeReview ≠ "none") and the raw g_mkt(P) <
 * veto.gBelow (−0.30), P_complete = P_accept × veto.factor (0.5); else P_complete = P_accept. ⚠️ The raw g, not the
 * perceived one (lead decision N1): league members judge a trade by the market, not by the owner's attachment to his
 * player. Ranking uses P_complete; the card shows both when they differ (vetoRisk). The quick variant (§12
 * screening) leaves out hot, urg and the veto: quickAcceptance (its g feature is the perceived g too).
 *
 * Display (§11): rounded to the nearest displayStep (5%), and ⚠️ never shown as 0% (the model never says
 * impossible: the clamp's floor is 2%, so anything under 7.5% shows as 5%). Labels (config.acceptance.labels:
 * under 15% Long shot, 15–35% Possible, 35–55% Decent, 55% and up Likely) are judged on the shown value (⚠️
 * ours, as the League page judges risky weeks on the printed percent): a 14.9% estimate shows "15%" and reads
 * "Possible", as the table says for 15%.
 *
 * How a search uses it (src/engine/evaluate.ts, search.ts):
 * - once per search: partnerProfile for each partner (snapshot.transactions, transactionWeek(snapshot), the
 *   perception values and W, its baseline P(playoffs)); hotPlayers(inputs.players, hotWeeks(snapshot.
 *   currentWeek)); urgencyTerm(settings.tradeDeadline, now, transactionWeek(snapshot));
 * - per screened candidate: quickAcceptance(settings, profile, { gPartner, gPerceived, deltaLineup (EV lineups), h,
 *   assets, partnerReceives }), h = holeFeature(P's slot instances with their averages over the hole weeks before and
 *   after the trade and the league medians, the received players who start for P after it).h; gPerceived =
 *   premium.perceivedPackage(...).g with P's premiums (premium.leaguePremiums);
 * - per exactly evaluated trade: acceptance(settings, profile, { …, hot: hotTerm(my give, my get, hot), urg }),
 *   whose features, P_accept, P_complete and label fill TradeEvaluation (benefit.tradeNumbers), and whose
 *   terms rank the explanations (what moved the estimate most).
 */
import { tradePackage, type LeagueType } from "./benefit";
import { config } from "./config";
import type { PlayerInputs } from "./inputs";
import type { MarketConfig, ValueLookup } from "./market";
import type { DraftPick, LeagueSettings, LeagueSnapshot, Pos, Transaction } from "./model";
import type { AcceptanceFeatures } from "./tradeModel";

/** The config.acceptance keys this module reads, widened so calibration (the refit) and tests can pass other numbers. */
export interface AcceptanceConfig {
  readonly beta: {
    readonly b0: number;
    readonly gain: number;
    readonly loss: number;
    /** β_need in redraft and keeper leagues (betaNeed). */
    readonly need: number;
    /** β_need in dynasty leagues (betaNeed). */
    readonly needDynasty: number;
    readonly hole: number;
    readonly complexity: number;
    readonly activity: number;
    readonly history: number;
  };
  readonly pAcceptClamp: readonly [number, number];
  readonly veto: { readonly gBelow: number; readonly factor: number };
  readonly gClamp: readonly [number, number];
  readonly nScale: number;
  readonly nClamp: readonly [number, number];
  readonly nBlendNextWeeks: number;
  /** ΔLineup_P's weight on the next nBlendNextWeeks weeks; the rest of the season gets 1 − it (§11: 50/50). */
  readonly nBlendWeight: number;
  readonly holeFractionOfMedian: number;
  readonly holeWeeks: number;
  readonly activity: { readonly recentTradeWeeks: number; readonly inactiveWeeks: number; readonly quietWeeks: number; readonly tradesForActive: number };
  readonly historyClamp: readonly [number, number];
  readonly context: {
    readonly checkedOutBelow: number;
    readonly checkedOut: number;
    readonly rebuildingBelow: number;
    readonly oldPlayerAge: number;
    readonly oldPlayerPenalty: number;
    readonly contenderAbove: number;
    readonly contenderNeedFactor: number;
  };
  readonly hot: { readonly multiple: number; readonly weeks: number; readonly bonus: number };
  readonly urgency: { readonly days: number; readonly bonus: number };
  readonly displayStep: number;
  readonly labels: readonly { readonly below: number; readonly label: string }[];
}

/** The positions §11's rebuilding-partner rule penalizes by age (RB and WR). */
const AGING_POSITIONS: ReadonlySet<Pos> = new Set<Pos>(["RB", "WR"]);

/** Milliseconds per day (urgency window). */
const DAY_MS = 86_400_000;

/** Float noise in rounding and comparisons (not a tunable). */
const EPS = 1e-9;

const isFiniteNumber = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
const finiteOr0 = (x: number | null | undefined): number => (isFiniteNumber(x) ? x : 0);

/** x clamped to [lo, hi]; ±Infinity land on the bounds. */
const clampTo = (x: number, range: readonly [number, number]): number => Math.min(range[1], Math.max(range[0], x));

/**
 * β_need for a league type (the file header; planner reply to Checkpoint 4, change 2): beta.needDynasty in dynasty
 * leagues, beta.need in redraft and keeper leagues. Every place n is weighed reads it: the need term, the contender
 * factor's extra in ctx, the quick variant, and whoever reads ΔLineup_P back from a need term.
 */
export function betaNeed(leagueType: LeagueType, cfg: Pick<AcceptanceConfig, "beta"> = config.acceptance): number {
  return leagueType === "dynasty" ? cfg.beta.needDynasty : cfg.beta.need;
}

// ---------------------------------------------------------------------------------------------
// g, n, h, c (the trade)

/** g: g_mkt(P) clamped to gClamp (NaN counts 0). */
export function gFeature(gPartner: number, cfg: AcceptanceConfig = config.acceptance): number {
  return clampTo(Number.isNaN(gPartner) ? 0 : gPartner, cfg.gClamp);
}

/** n: ΔLineup_P / nScale, clamped to nClamp (before the contender factor); a non-finite ΔLineup counts 0. */
export function needFeature(deltaLineup: number, cfg: AcceptanceConfig = config.acceptance): number {
  return isFiniteNumber(deltaLineup) ? clampTo(deltaLineup / cfg.nScale, cfg.nClamp) : 0;
}

/** The change in P's average weekly starting points (§11's ΔLineup_P) and its two windows. */
export interface LineupDelta {
  /** Mean change over the next nBlendNextWeeks weeks from `from` (fewer when fewer are left). */
  next: number;
  /** Mean change over every week from `from` (the rest of the season). */
  ros: number;
  /** ΔLineup_P: nBlendWeight × next + (1 − nBlendWeight) × ros (§11: 50/50). */
  blended: number;
  nextWeeks: number;
  rosWeeks: number;
}

/**
 * ΔLineup_P from P's weekly lineup values before and after the trade (both V*, aligned with the model's weeks),
 * starting at week index `from` (TeamWeeks.from). No weeks left → all 0. A missing or non-finite entry counts 0.
 */
export function partnerLineupDelta(before: ArrayLike<number>, after: ArrayLike<number>, from = 0, cfg: AcceptanceConfig = config.acceptance): LineupDelta {
  const end = Math.min(before.length, after.length);
  const start = Math.max(0, Math.floor(Number.isFinite(from) ? from : 0));
  const nextEnd = Math.min(end, start + Math.max(0, Math.floor(cfg.nBlendNextWeeks)));
  const meanChange = (lo: number, hi: number): number => {
    if (hi <= lo) return 0;
    let sum = 0;
    for (let w = lo; w < hi; w++) sum += finiteOr0(after[w]) - finiteOr0(before[w]);
    return sum / (hi - lo);
  };
  const next = meanChange(start, nextEnd);
  const ros = meanChange(start, end);
  const w = cfg.nBlendWeight;
  return { next, ros, blended: w * next + (1 - w) * ros, nextWeeks: Math.max(0, nextEnd - start), rosWeeks: Math.max(0, end - start) };
}

/** The median of the finite numbers in xs (the mean of the middle two for an even count); null when none. */
export function median(xs: readonly number[]): number | null {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return null;
  const mid = n >> 1;
  return n % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** A hole (§11 h): a starter averaging below holeFractionOfMedian × the league median there (a median ≤ 0 has no hole). */
export function isHole(starter: number, leagueMedian: number, cfg: AcceptanceConfig = config.acceptance): boolean {
  return isFiniteNumber(starter) && isFiniteNumber(leagueMedian) && leagueMedian > 0 && starter < cfg.holeFractionOfMedian * leagueMedian - EPS;
}

/**
 * One of P's slot instances, as the hole feature reads it: averages over the next holeWeeks weeks of instance
 * points (needs.instancePointsInto: within a slot name the starters sorted by points), from P's V* lineups.
 */
export interface HoleSlot {
  /** Slot instance key (needs.slotInstances: "QB1", "RB2", …). */
  key: string;
  /** The positions its slot takes (the instance's SlotDef.eligible). */
  eligible: readonly Pos[];
  /** P's starter there before the trade: average points per week over the next holeWeeks weeks. */
  starter: number;
  /** P's starter there after the trade, over the same weeks (P's lineups after the trade, instances sorted the same way). */
  after: number;
  /** The league median there over the same weeks: every team's starter at that instance, before the trade. */
  median: number;
}

/** A player P receives who starts for P after the trade (in at least one of the hole weeks): his positions (PlayerInfo's pos and eligible). */
export interface ReceivedStarter {
  pos: Pos;
  eligible: readonly Pos[];
}

/** Whether a player can play a slot: his position or one he's eligible at is one the slot takes. */
function canPlay(player: ReceivedStarter, slot: readonly Pos[]): boolean {
  return slot.includes(player.pos) || player.eligible.some((p) => slot.includes(p));
}

/**
 * h (§11; the file header): 1 when some hole's starter averages more after the trade than before and a received
 * starter can play its slot, whichever instance he sits in. Also lists the holes and the filled ones (explanations).
 */
export function holeFeature(slots: readonly HoleSlot[], receivedStarters: readonly ReceivedStarter[], cfg: AcceptanceConfig = config.acceptance): { h: 0 | 1; holes: string[]; filled: string[] } {
  const holes: string[] = [];
  const filled: string[] = [];
  for (const s of slots) {
    if (!isHole(s.starter, s.median, cfg)) continue;
    holes.push(s.key);
    if (isFiniteNumber(s.after) && s.after > s.starter + EPS && receivedStarters.some((p) => canPlay(p, s.eligible))) filled.push(s.key);
  }
  return { h: filled.length > 0 ? 1 : 0, holes, filled };
}

/** c: assets in the trade (both sides, picks included) − 2, never below 0. */
export function complexityFeature(assets: number): number {
  return isFiniteNumber(assets) ? Math.max(0, Math.round(assets) - 2) : 0;
}

// ---------------------------------------------------------------------------------------------
// a and hist (the partner's transactions)

/**
 * The week transactions and a week-only trade deadline are numbered in: the platform's league week when it has
 * one (Sleeper's settings.leg, which can lag the NFL week by a day), else the NFL week. activity, urgencyTerm and
 * tradeDeadlinePassed take it; hotWeeks takes the NFL week (snapshot.currentWeek: ModelInputs are by NFL week).
 */
export function transactionWeek(snapshot: Pick<LeagueSnapshot, "currentWeek" | "leagueWeek">): number {
  return snapshot.leagueWeek ?? snapshot.currentWeek;
}

/** Whether a transaction is the team's: it is in its teams, or one of its moves comes from or goes to it. */
export function involves(t: Pick<Transaction, "teams" | "moves">, teamId: string): boolean {
  return t.teams.includes(teamId) || t.moves.some((m) => m.from === teamId || m.to === teamId);
}

/** Which activity rule matched: active +1, inactive −2, quiet −1, normal 0. */
export type ActivityRule = "active" | "inactive" | "quiet" | "normal";

export interface ActivitySummary {
  /** The activity feature a: +1, 0, −1 or −2. */
  a: number;
  rule: ActivityRule;
  /** P's completed trades this season, and those in the last recentTradeWeeks weeks. */
  trades: number;
  recentTrades: number;
  /** P's transactions of any type this season. */
  transactions: number;
  /** The latest week P had a transaction, or null. */
  lastWeek: number | null;
}

/** The activity feature a for team `teamId` (the file header): `week` = the week transactions are numbered in (leagueWeek ?? currentWeek). */
export function activity(transactions: readonly Transaction[], teamId: string, week: number, cfg: AcceptanceConfig = config.acceptance): ActivitySummary {
  const rules = cfg.activity;
  const within = (w: number, n: number): boolean => Number.isFinite(w) && Number.isFinite(week) && w > week - n;
  const seen = new Set<string>();
  let trades = 0;
  let recentTrades = 0;
  let count = 0;
  let lastWeek: number | null = null;
  let anyInactiveWindow = false;
  let anyQuietWindow = false;
  for (const t of transactions) {
    if (seen.has(t.id) || !involves(t, teamId)) continue;
    seen.add(t.id);
    count++;
    if (Number.isFinite(t.week) && (lastWeek === null || t.week > lastWeek)) lastWeek = t.week;
    if (t.type === "trade") {
      trades++;
      if (within(t.week, rules.recentTradeWeeks)) recentTrades++;
    }
    if (within(t.week, rules.inactiveWeeks)) anyInactiveWindow = true;
    if (within(t.week, rules.quietWeeks)) anyQuietWindow = true;
  }
  let a = 0;
  let rule: ActivityRule = "normal";
  if (trades >= rules.tradesForActive || recentTrades >= 1) {
    a = 1;
    rule = "active";
  } else if (!anyInactiveWindow) {
    a = -2;
    rule = "inactive";
  } else if (!anyQuietWindow) {
    a = -1;
    rule = "quiet";
  }
  return { a, rule, trades, recentTrades, transactions: count, lastWeek };
}

export interface TradeHistory {
  /** The hist feature: the average below clamped to historyClamp; null when no trade could be valued. */
  hist: number | null;
  /** The unclamped average of the trades' g (+∞ when one of them is). */
  average: number | null;
  /** P's completed trades this season, valued or not. */
  trades: number;
  /** Trades valued, and trades left out (the file header). */
  used: number;
  skipped: number;
  /** Each valued trade's g_mkt(P) (unclamped; +∞ when P gave nothing of value), in transaction order. */
  perTrade: { id: string; week: number; g: number }[];
}

export interface TradeHistoryOptions {
  /** A pick's current value on the perception term (dynasty and keeper leagues); without it, trades with picks are left out. */
  pickValue?: (pick: DraftPick) => number | null | undefined;
  /** Package-value config (default config.market). */
  market?: MarketConfig;
}

/** g_mkt(P) of one completed trade at current values, or null when it can't be valued (the file header). */
function pastTradeGain(t: Transaction, teamId: string, values: ValueLookup, W: number, opts: TradeHistoryOptions): number | null {
  const recv: string[] = [];
  const give: string[] = [];
  for (const m of t.moves) {
    if (m.from === null || m.to === null || m.from === m.to) continue; // adds and drops riding along aren't trade legs
    if (m.to === teamId) recv.push(m.playerId);
    else if (m.from === teamId) give.push(m.playerId);
  }
  const recvPicks: number[] = [];
  const givePicks: number[] = [];
  if (t.picks && t.picks.length > 0) {
    const others = [...new Set(t.teams)].filter((id) => id !== teamId);
    if (!opts.pickValue || others.length !== 1) return null;
    for (const pick of t.picks) {
      const v = opts.pickValue(pick);
      if (!isFiniteNumber(v)) return null;
      if (pick.ownerTeamId === teamId) recvPicks.push(v);
      else if (pick.ownerTeamId === others[0]) givePicks.push(v);
      else return null;
    }
  }
  if (recv.length + recvPicks.length === 0 || give.length + givePicks.length === 0) return null;
  for (const id of [...recv, ...give]) if (values[id] === undefined) return null;
  return tradePackage({ players: recv, pickValues: recvPicks }, { players: give, pickValues: givePicks }, values, W, opts.market ?? config.market).g;
}

/**
 * The hist feature for team `teamId`: its completed trades this season valued at current perception values
 * (`values`, the waiver credit `W`), averaged and clamped (the file header).
 */
export function tradeHistory(
  transactions: readonly Transaction[],
  teamId: string,
  values: ValueLookup,
  W: number,
  opts: TradeHistoryOptions = {},
  cfg: AcceptanceConfig = config.acceptance,
): TradeHistory {
  const seen = new Set<string>();
  const perTrade: TradeHistory["perTrade"] = [];
  let trades = 0;
  let skipped = 0;
  for (const t of transactions) {
    if (t.type !== "trade" || seen.has(t.id) || !involves(t, teamId)) continue;
    seen.add(t.id);
    trades++;
    const g = pastTradeGain(t, teamId, values, W, opts);
    if (g === null || Number.isNaN(g)) {
      skipped++;
      continue;
    }
    perTrade.push({ id: t.id, week: t.week, g });
  }
  if (perTrade.length === 0) return { hist: null, average: null, trades, used: 0, skipped, perTrade };
  let sum = 0;
  for (const x of perTrade) sum += x.g;
  const average = sum / perTrade.length;
  return { hist: clampTo(average, cfg.historyClamp), average, trades, used: perTrade.length, skipped, perTrade };
}

// ---------------------------------------------------------------------------------------------
// ctx, hot, urg

/** A player P would receive, as the context rule reads him (PlayerInfo has these fields). */
export interface ReceivedPlayer {
  pos: Pos;
  age?: number;
}

export interface ContextInput {
  leagueType: LeagueType;
  /** P's baseline P(playoffs) (before any trade, every team at V*); null when the season wasn't simulated. */
  pPlayoffs: number | null;
  /** The players P would receive (my side's players). */
  partnerReceives: readonly ReceivedPlayer[];
  /** n before the contender factor (needFeature). */
  n: number;
}

export interface ContextTerm {
  /** ctx in logit units: the checked-out or aging-player terms plus the contender factor's extra β_need × n × (factor − 1) (betaNeed). */
  ctx: number;
  /** Redraft or keeper partner below checkedOutBelow. */
  checkedOut: boolean;
  /** Dynasty rebuilding partner: RBs and WRs aged oldPlayerAge or older it would receive. */
  agingPlayers: number;
  /** P(playoffs) above contenderAbove: n counts contenderNeedFactor times. */
  contender: boolean;
}

/** §11's season context (the file header). */
export function contextTerm(x: ContextInput, cfg: AcceptanceConfig = config.acceptance): ContextTerm {
  const c = cfg.context;
  const p = x.pPlayoffs;
  if (!isFiniteNumber(p)) return { ctx: 0, checkedOut: false, agingPlayers: 0, contender: false };
  let ctx = 0;
  const checkedOut = x.leagueType !== "dynasty" && p < c.checkedOutBelow;
  if (checkedOut) ctx += c.checkedOut;
  let agingPlayers = 0;
  if (x.leagueType === "dynasty" && p < c.rebuildingBelow) {
    for (const player of x.partnerReceives) if (AGING_POSITIONS.has(player.pos) && isFiniteNumber(player.age) && player.age >= c.oldPlayerAge) agingPlayers++;
    ctx += agingPlayers * c.oldPlayerPenalty;
  }
  const contender = p > c.contenderAbove;
  if (contender) ctx += betaNeed(x.leagueType, cfg) * finiteOr0(x.n) * (c.contenderNeedFactor - 1);
  return { ctx, checkedOut, agingPlayers, contender };
}

/**
 * The last hot.weeks completed NFL weeks before `currentWeek` (the NFL week, snapshot.currentWeek: PlayerInputs
 * are by NFL week), latest first; [] when fewer than that have been played.
 */
export function hotWeeks(currentWeek: number, cfg: AcceptanceConfig = config.acceptance): number[] {
  const k = Math.max(0, Math.floor(cfg.hot.weeks));
  if (k === 0 || !Number.isInteger(currentWeek)) return [];
  const weeks: number[] = [];
  for (let i = 1; i <= k; i++) weeks.push(currentWeek - i);
  return weeks.every((w) => w >= 1) ? weeks : [];
}

/** His projection for a past week in league points: Sleeper's, else ESPN's; null unless a positive number. */
export function pastProjection(inputs: Pick<PlayerInputs, "sleeper" | "espn">, week: number): number | null {
  const s = inputs.sleeper[week];
  if (isFiniteNumber(s) && s > 0) return s;
  const e = inputs.espn?.[week];
  if (isFiniteNumber(e) && e > 0) return e;
  return null;
}

/** Whether he scored at least hot.multiple × his projection in each of `weeks` (hotWeeks); anything missing → false. */
export function isHot(inputs: Pick<PlayerInputs, "sleeper" | "espn" | "actual"> | undefined, weeks: readonly number[], cfg: AcceptanceConfig = config.acceptance): boolean {
  if (!inputs || weeks.length === 0 || weeks.length < cfg.hot.weeks) return false;
  for (const w of weeks) {
    const projection = pastProjection(inputs, w);
    const actual = inputs.actual[w];
    if (projection === null || !isFiniteNumber(actual) || actual < cfg.hot.multiple * projection - EPS) return false;
  }
  return true;
}

/** The hot players among `ids` (default: every player in `players`), for hotTerm; computed once per search. */
export function hotPlayers(
  players: Readonly<Record<string, Pick<PlayerInputs, "sleeper" | "espn" | "actual"> | undefined>>,
  weeks: readonly number[],
  cfg: AcceptanceConfig = config.acceptance,
  ids: Iterable<string> = Object.keys(players),
): Set<string> {
  const out = new Set<string>();
  if (weeks.length === 0) return out;
  for (const id of ids) if (isHot(players[id], weeks, cfg)) out.add(id);
  return out;
}

/** hot: +bonus when a player P receives (my give) is hot, −bonus when one P gives (my get) is; both → 0. */
export function hotTerm(partnerReceives: readonly string[], partnerGives: readonly string[], hot: ReadonlySet<string>, cfg: AcceptanceConfig = config.acceptance): number {
  const receivesHot = partnerReceives.some((id) => hot.has(id));
  const givesHot = partnerGives.some((id) => hot.has(id));
  return (receivesHot ? cfg.hot.bonus : 0) - (givesHot ? cfg.hot.bonus : 0);
}

/** The deadline as epoch ms, when its date parses. */
function deadlineMs(deadline: NonNullable<LeagueSettings["tradeDeadline"]>): number | null {
  if (deadline.date === undefined) return null;
  const t = Date.parse(deadline.date);
  return Number.isFinite(t) ? t : null;
}

/** urg (the file header): `week` = the week the deadline's week is numbered in (leagueWeek ?? currentWeek). */
export function urgencyTerm(deadline: LeagueSettings["tradeDeadline"], now: Date, week: number, cfg: AcceptanceConfig = config.acceptance): number {
  if (!deadline) return 0;
  const at = deadlineMs(deadline);
  const nowMs = now.getTime();
  if (at !== null && Number.isFinite(nowMs)) {
    const left = at - nowMs;
    return left >= 0 && left <= cfg.urgency.days * DAY_MS ? cfg.urgency.bonus : 0;
  }
  const d = deadline.week;
  if (isFiniteNumber(d) && isFiniteNumber(week)) return week >= d - 1 && week <= d ? cfg.urgency.bonus : 0;
  return 0;
}

/**
 * Whether the trade deadline has passed: after its date when the date is known, else once `week` (leagueWeek ??
 * currentWeek) is past its week (Sleeper: trades complete through league week D). No deadline → never.
 */
export function tradeDeadlinePassed(deadline: LeagueSettings["tradeDeadline"], now: Date, week: number): boolean {
  if (!deadline) return false;
  const at = deadlineMs(deadline);
  if (at !== null) return now.getTime() > at;
  return isFiniteNumber(deadline.week) && isFiniteNumber(week) && week > deadline.week;
}

// ---------------------------------------------------------------------------------------------
// The model

/** What the model knows about a partner before any particular trade (computed once per search). */
export interface PartnerProfile {
  teamId: string;
  activity: ActivitySummary;
  history: TradeHistory;
  /** P's baseline P(playoffs) (before any trade, every team at V*), null when the season wasn't simulated. */
  pPlayoffs: number | null;
}

/** partnerProfile's inputs: the league's transactions, the transaction week, current perception values and W, and P's baseline P(playoffs). */
export interface PartnerProfileInput {
  teamId: string;
  transactions: readonly Transaction[];
  /** The week transactions are numbered in: snapshot.leagueWeek ?? snapshot.currentWeek. */
  week: number;
  values: ValueLookup;
  W: number;
  pPlayoffs: number | null;
  pickValue?: TradeHistoryOptions["pickValue"];
}

/** A partner's activity, trade history and baseline P(playoffs). */
export function partnerProfile(x: PartnerProfileInput, cfg: AcceptanceConfig = config.acceptance, market: MarketConfig = config.market): PartnerProfile {
  return {
    teamId: x.teamId,
    activity: activity(x.transactions, x.teamId, x.week, cfg),
    history: tradeHistory(x.transactions, x.teamId, x.values, x.W, { ...(x.pickValue ? { pickValue: x.pickValue } : {}), market }, cfg),
    pPlayoffs: isFiniteNumber(x.pPlayoffs) ? x.pPlayoffs : null,
  };
}

/** The trade as the model reads it. */
export interface TradeAcceptanceInput {
  /** g_mkt(P) on perception values (each player at max(v, W)), before the clamp: the market's reading of the trade (the veto rule reads it). */
  gPartner: number;
  /**
   * P's perceived g, before the clamp (planner addendum to Checkpoint 3, §1: the star premium on the players P gives;
   * premium.perceivedPackage): the g feature reads it when given, else gPartner (a caller without premiums).
   */
  gPerceived?: number;
  /** ΔLineup_P in points per week (partnerLineupDelta(...).blended). */
  deltaLineup: number;
  /** holeFeature(...).h. */
  h: 0 | 1;
  /** Assets in the trade, both sides, picks included. */
  assets: number;
  /** The players P would receive (my side's players): position and age, for the dynasty rebuilding rule. */
  partnerReceives: readonly ReceivedPlayer[];
  /** hotTerm(...); left out of the quick variant. Default 0. */
  hot?: number;
  /** urgencyTerm(...); left out of the quick variant. Default 0. */
  urg?: number;
}

/** The league facts the model reads (LeagueSettings has them). */
export interface AcceptanceLeague {
  leagueType: LeagueType;
  tradeReview: LeagueSettings["tradeReview"];
}

/** Each feature's contribution to z, in logit units (z is their sum): what moved the estimate, for explanations. */
export interface AcceptanceTerms {
  base: number;
  /** β_gain·g⁺ + β_loss·g⁻. */
  value: number;
  /** β_need·n (the league type's β_need: betaNeed), before the contender factor (its extra is in `context`). */
  need: number;
  hole: number;
  /** −β_cx·c. */
  complexity: number;
  activity: number;
  /** −β_hist·hist (0 without history). */
  history: number;
  context: number;
  hot: number;
  urgency: number;
}

export interface AcceptanceResult {
  features: AcceptanceFeatures;
  terms: AcceptanceTerms;
  context: ContextTerm;
  pAccept: number;
  /** P_accept with the veto rule (P_accept when it doesn't apply). */
  pComplete: number;
  /** The veto rule halved P_complete: the card shows both numbers. */
  vetoRisk: boolean;
  /** The label of P_accept (acceptanceLabel). */
  label: string;
  /** P_accept and P_complete as shown (displayAcceptance). */
  shown: { accept: number; complete: number };
}

/** σ(z) = 1 / (1 + e^(−z)); ±∞ give 1 and 0. */
export function logistic(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** P_accept from z: clamp(σ(z), pAcceptClamp). */
export function pAcceptFromLogit(z: number, cfg: AcceptanceConfig = config.acceptance): number {
  return clampTo(logistic(Number.isNaN(z) ? 0 : z), cfg.pAcceptClamp);
}

/** The features (with z), the terms and the context for one trade; `quick` leaves out hot and urg (§12 screening). */
function buildFeatures(
  league: AcceptanceLeague,
  partner: PartnerProfile,
  trade: TradeAcceptanceInput,
  quick: boolean,
  cfg: AcceptanceConfig,
): { features: AcceptanceFeatures; terms: AcceptanceTerms; context: ContextTerm } {
  const beta = cfg.beta;
  // The perceived g when the caller has one (the star premium); the veto reads the raw g (vetoApplies).
  const g = gFeature(trade.gPerceived ?? trade.gPartner, cfg);
  const n = needFeature(trade.deltaLineup, cfg);
  const h: 0 | 1 = trade.h === 1 ? 1 : 0;
  const c = complexityFeature(trade.assets);
  const a = finiteOr0(partner.activity.a);
  const hist = isFiniteNumber(partner.history.hist) ? partner.history.hist : null;
  const context = contextTerm({ leagueType: league.leagueType, pPlayoffs: partner.pPlayoffs, partnerReceives: trade.partnerReceives, n }, cfg);
  const hot = quick ? 0 : finiteOr0(trade.hot);
  const urg = quick ? 0 : finiteOr0(trade.urg);
  const terms: AcceptanceTerms = {
    base: beta.b0,
    value: beta.gain * Math.max(g, 0) + beta.loss * Math.min(g, 0),
    need: betaNeed(league.leagueType, cfg) * n,
    hole: beta.hole * h,
    complexity: -beta.complexity * c,
    activity: beta.activity * a,
    history: hist === null ? 0 : -beta.history * hist,
    context: context.ctx,
    hot,
    urgency: urg,
  };
  const z = terms.base + terms.value + terms.need + terms.hole + terms.complexity + terms.activity + terms.history + terms.context + terms.hot + terms.urgency;
  return { features: { g, n, h, c, a, hist, ctx: context.ctx, hot, urg, z }, terms, context };
}

/** The features for one trade (AcceptanceFeatures, z included), with each term's contribution and the context. */
export function acceptanceFeatures(league: AcceptanceLeague, partner: PartnerProfile, trade: TradeAcceptanceInput, cfg: AcceptanceConfig = config.acceptance): { features: AcceptanceFeatures; terms: AcceptanceTerms; context: ContextTerm } {
  return buildFeatures(league, partner, trade, false, cfg);
}

/**
 * Whether §11's veto rule applies: the league reviews trades and g_mkt(P) < veto.gBelow. It reads the raw g_mkt(P)
 * (TradeAcceptanceInput.gPartner, never the perceived g: ⚠️ the file header) before the clamp, the same as a clamped
 * g while veto.gBelow is inside gClamp (−0.30 vs ±0.5).
 */
export function vetoApplies(tradeReview: LeagueSettings["tradeReview"], gPartner: number, cfg: AcceptanceConfig = config.acceptance): boolean {
  return tradeReview !== "none" && !Number.isNaN(gPartner) && gPartner < cfg.veto.gBelow;
}

/** §11 in full: features, P_accept, the veto, P_complete, the label and the shown values. */
export function acceptance(league: AcceptanceLeague, partner: PartnerProfile, trade: TradeAcceptanceInput, cfg: AcceptanceConfig = config.acceptance): AcceptanceResult {
  const built = buildFeatures(league, partner, trade, false, cfg);
  const pAccept = pAcceptFromLogit(built.features.z, cfg);
  const vetoRisk = vetoApplies(league.tradeReview, trade.gPartner, cfg);
  const pComplete = vetoRisk ? pAccept * cfg.veto.factor : pAccept;
  return {
    ...built,
    pAccept,
    pComplete,
    vetoRisk,
    label: acceptanceLabel(pAccept, cfg),
    shown: { accept: displayAcceptance(pAccept, cfg), complete: displayAcceptance(pComplete, cfg) },
  };
}

/** The quick P_accept (§12 screening): the same model without hot, urg and the veto rule. */
export function quickAcceptance(league: Pick<AcceptanceLeague, "leagueType">, partner: PartnerProfile, trade: TradeAcceptanceInput, cfg: AcceptanceConfig = config.acceptance): number {
  return pAcceptFromLogit(buildFeatures({ leagueType: league.leagueType, tradeReview: "none" }, partner, trade, true, cfg).features.z, cfg);
}

// ---------------------------------------------------------------------------------------------
// Display (§11)

/** A probability as shown: the nearest displayStep (5%), never 0 for a positive one (the file header); 0 for p ≤ 0. */
export function displayAcceptance(p: number, cfg: Pick<AcceptanceConfig, "displayStep"> = config.acceptance): number {
  if (!isFiniteNumber(p) || p <= 0) return 0;
  const step = cfg.displayStep;
  if (!(step > 0)) return p;
  const k = Math.max(1, Math.round(p / step + EPS));
  return Math.round(k * step * 1e6) / 1e6;
}

/** The label for a probability (config.acceptance.labels), judged on its shown value. */
export function acceptanceLabel(p: number, cfg: Pick<AcceptanceConfig, "displayStep" | "labels"> = config.acceptance): string {
  const shown = displayAcceptance(p, cfg);
  for (const l of cfg.labels) if (shown < l.below - EPS) return l.label;
  return cfg.labels[cfg.labels.length - 1]?.label ?? "";
}
