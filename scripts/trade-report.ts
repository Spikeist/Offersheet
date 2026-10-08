/**
 * Checkpoint 4c numbers for Parker's league (planner reply to Checkpoint 4b, reports/planner-reply-4b.md, "Checkpoint 4c
 * (short) must include"; the lead's Phase 4c design, track R), computed through the real engine exactly as the Trade
 * Finder's and the Trade Analyzer's Web Worker runs it: buildTradeContext, runTradeSearch, runRefilter and analyzeTrade
 * (src/engine/evaluate.ts, search.ts), the League model (league.ts buildLeagueModel), the market blend's records
 * (blend.ts blendRecords) and the acceptance model (acceptance.ts, premium.ts).
 *
 *   npm run trade:report                           no network: the newest git-ignored placeholder dump of Parker's league
 *                                                  (data-local/parker-league*, by meta.json's time; snapshot.json,
 *                                                  inputs.json, meta.json; league-report's loadDump), the engine's `now`
 *                                                  from meta.json
 *   npm run trade:report -- --dump <dir>           that dump instead (--offline <dir> is an alias)
 *   npm run trade:report -- --team <id>            his team, when the data doesn't say
 *   npm run trade:report -- --live                 Parker's ESPN league through the public-link path and the app's caches
 *   npm run trade:report -- --live --cookies       use the .env.local ESPN cookies (also with USE_ENV_COOKIES=1)
 *   npm run trade:report -- --out <file>           write the report there instead of reports/trade-report.md
 *   npm run trade:report -- --prizes 2000,1600,900,0   the league's prizes (1st, 2nd, 3rd, the weekly high score, the most
 *                                                  points; blank or 0 not paid; scripts/lib/runMode.ts prizesArg): "Several
 *                                                  prizes" on them in sections 2, 3 and 10 (Checkpoint 7c); the console
 *                                                  says how it read them first (prizesReadLine, prizesSplitLine)
 *
 * Offline by default (planner reply to Checkpoint 4c, A5; scripts/lib/runMode.ts): without --live the process's offline
 * guard is on, so nothing here can touch the network; the header prints the command with the dump named.
 *
 * The report (reports/trade-report.md) is short (the planner: "only what changed, plus the numbers asked for"); each
 * section says how its numbers were made:
 * 0. Header: the command line, the data and its timestamps, the waiver order used (importReport.waiverOrderText), the
 *    settings (the app's defaults: "Only the champion", "Chance they accept: at least 10%"; section 2's split), the baseline odds (with pickups,
 *    and as rosters stand), and the notes and warnings of the inputs, the League model, the context and the search. A dump
 *    from before the 4c adapter (league-report's waiverRanksPre4c: its ranks are ESPN's live order of the import's day) is
 *    first put on the 4c adapter's rule for a league whose order resets weekly, as Parker's does (league-report's
 *    asWeeklyResetData: the weekly reset order from the standings becomes Team.waiverRank, the dump's ranks
 *    Team.liveWaiverRank; ⚠️ assumed, the dump doesn't say), so every section runs on the order the app now uses and the
 *    search's baseline is section 7's headline (review of track R, R-4); the header says so with both orders (pre4cText).
 * 1. Your top 10 under "Only the champion" (the default goal): each card's give and get with its injury tags in the card's
 *    words (flags.tagged, tradeView.injuryTagText), the three numbers as printed (Helps you / Chance they accept, its
 *    chance of going through when the veto cuts it / Overall; a chance under 5% reads "<5%": chancePrinted), title and
 *    playoff odds before → after (the search's baseline, plus the trade's ΔCH and ΔPO on the same final block), the weekly
 *    lines (TradeDetail.winChance: weeklyLines), and its next step: the offer-first steps with their players' tags (the
 *    search's own rule, taggerOf), or Plan B in its box's own words (tradeView.planBView: its players' tags as the card
 *    shows them, and since Phase 4c's polish its odds lines: planBOddsText), each with its numbers (review of track R,
 *    R-2), and its trade value (tradeValueText: g_mkt(me) and B's market term in points a week on the card's scale,
 *    TradeEvaluation.marketWeekly; planner reply to Checkpoint 7a, §2 question 5); the counts over the top 10 and every card, the Plan B
 *    boxes receiving an injury-tagged player among them (cardCounts); the pattern note (TradeSearchResult.pattern) when it
 *    shows.
 * 2. "What does your league reward?" (planner change 8; Checkpoint 7c, planner reply to Checkpoint 7b, §6: "how his top 5
 *    changed from 'Only the champion'"): the search the app runs under "Several prizes" on the league's split (--prizes;
 *    ⚠️ the prefilled split, config.benefit.prizesDefault, without it: prizesSettingsOf), on the trade context the app builds
 *    under it (its own playoff-week weight ω, so its own pickups, baseline and shortlists, and the weekly high scores
 *    simulated when the split pays them), against section 1's: both top 5s in a line, the two top 10s side by side
 *    (goalCompare: each trade's place, B, Helps you, the chance it goes through and Overall under each setting; a trade the
 *    other list doesn't show gets the Analyzer's numbers on that setting's context), each side's ω. Until Checkpoint 7c the
 *    section ran both on the default goal's context, its ω held, and named the other's (omegaUnder, gone): a split that pays
 *    the weekly high score can't be priced from runs that didn't simulate them (reward.ts assertWeeklyMeasured).
 * 3. B₃ under each goal (Phase 7a; planner reply to Checkpoint 4c, A2: "Helps you" calibrates itself per league and goal;
 *    helpsScaleSection): the League model's calibration run (LeagueModel.helpsCalibration: ΔPO₃ and ΔCH₃ from +3 points a
 *    week in every week a trade can change), checked against the trade context's own run (evaluate.ts SimState.calibration,
 *    bit for bit), B₃ under each goal as the search scores it (evaluate.helpsScaleOf: raw, floored or not, used; B_ref(λ) in a
 *    dynasty or keeper league with long-term values, planner reply to Checkpoint 7a, §2 question 6), each off the trade
 *    context the app builds under that goal (its own ω, pickups, baseline and +3 run; review of Phase 7b: read off the
 *    default goal's context, Balanced and Make the playoffs were 5.88 and 7.53 where the app uses 5.93 and 7.66), with what
 *    "Protect my trade value" charges on it at Medium for giving 25% more value than you get (question 5), and
 *    league-report's scaleCheck from the one baseline (every team after its pickups: season.pickupSeasonModel,
 *    TeamModel.scoreWithPickups; the default goal's ω) for +1, +3 and +6 projected points a week (league-report's
 *    scaleFrom: a week under way is left out, as every trade's evaluation leaves it): ΔPO, ΔCH, B and Helps you on the new
 *    scale under each goal, its +3 row checked to be the calibration run. Section 1's cards are scored on the default goal's
 *    B₃; section 2's "Several prizes" cards on that setting's own context, so on its B₃ in this section's table (Checkpoint
 *    7c: "Several prizes" is section 2's context, on the league's split; the scale check's column reads the split too).
 * 4. The search gap (change 1): Garrett Wilson → Chuba Hubbard + Mike Evans with their team (searchGap: its rank among
 *    that partner's screened candidates by the screening objective, the g window, the partner's keep, the exact
 *    shortlist, the finalists, the card; whether the beams alone screen it; its numbers), the screened counts per
 *    partner with the exhaustive candidates and with the beams alone (search.partnerCandidates on the main context, each
 *    way; checked to reproduce the search's own count, and its exact trades: the shortlist and its lean companions,
 *    search.leanCompanions), what only the exhaustive candidates reach,
 *    the beams-alone search (TradeSearchOptions.exhaustive false, its own contexts: timedSearches), and the runtime per
 *    stage: the cold run (the first search in the process) and the warm median of SEARCH_RUNS, each with its own context.
 *    Checkpoint 7c: counts.simFinal holds the "Helps both" extras' final runs too (search.ts finalistsOf), so the section
 *    counts final runs, the finalists and the extras apart (finalRunsText; SearchGap.extra), and sections 8 and 9 read the
 *    finalists the ranking picked (rankedFinals: an extra listed as a finalist there was one only the second list ranks).
 * 5. The minimum-chance filter (change 10): from the one search, runRefilter at every option of
 *    config.ranking.minChanceOptions: the cards, the qualifying finalists, the ones the minimum hides, `few`, the time it
 *    took, and whether the search's own minimum reproduces its list (filterRows).
 * 6. The blend (change 4): blendRecords' most extreme factors before the clamp (|ln f|), each with what its record shows
 *    (blendReason, from the record and his points a game so far alone: a data flag the record can show, else "No data
 *    flag" with the facts that rule them out; the disagreement per game; where his results so far fall; the clamp; review
 *    of track R, R-3), how many carry each flag, and every factor the clamp cut (blendReport).
 * 7. Your odds on the one shared baseline (change 9; answer 2): P(playoffs), P(bye), P(title) and expected wins with every
 *    team's pickups in the weekly reset waiver order (the headline: the model every other section ran on), as rosters
 *    stand (the second line) and with the live order (oddsByOrder: Team.liveWaiverRank in place of waiverRank; for a dump
 *    from before the 4c adapter, its own ranks), my place in each order and my pickups; my win chance week by week under
 *    each; the check that the trade search's baseline equals LeagueModel.odds exactly; and that the reset order is today's
 *    standings by the league's rules reversed (resetWaiverOrder).
 * 8. Anything else worth a look: the acceptance anchors (both of the planner's tables through the real functions:
 *    anchorRows, premiumAnchorRows), the cards with a neutral throw-in (market.neutralThrowIns, its rule as built: up to the
 *    difference in player counts on the side giving more players, review of track R, R-5, then matched pairs, one from
 *    each side) against their lean versions from the Analyzer, unrounded (the chance they accept, B and the expected gain,
 *    expectedGain, and the lean version's place in the search, which evaluates it as a lean companion: neutralCards;
 *    review of track R, R-1), the headline's jump at the week's first kickoff (League models 1 ms either side of it:
 *    kickoffJump), and the weeks where every team's pickups move my win chance most (pickupWeeks: both teams' projected
 *    points with and without their pickups, and the pickups).
 * 9. Open roster spots (Phase 7c; planner reply to Checkpoint 7b, section 5, and its "Checkpoint 7c must include": "Parker's
 *    trades that leave him an open roster spot, with the pickup before and after the change"; openSpotSection): Checkpoint
 *    7b's rule (the free agent who most improves the EV lineup at any position, which V*(after) may drop: evaluate.ts
 *    TradeContextOptions.openSpotFill "bestAny", a report switch the app never sets) on its own context and its own search;
 *    the trades that open my roster spot on either list (its cards, this search's) and among this search's finalists (up to
 *    OPEN_SPOT_FINALISTS more), each with my pickup and the three numbers under each rule (the Analyzer's, on the cards'
 *    seasons); every exact trade of this search that opens my spot, grouped by what the spot takes now and my pickup under
 *    each rule (exact evaluation on each context, no simulation); the shown cards whose partner gets a spot, with its pickup,
 *    its lineup change and the chance it accepts under each rule (the rule is the partner's too); and every side's fills in
 *    the exact trades, with V*(after) run again without the keep set (how many fills it would drop).
 * 10. Helps both (Checkpoint 7c; planner reply to Checkpoint 7b, §7, and its "Checkpoint 7c must include": "how many of
 *    Parker's trades help both; his top 5 under the new sort, with Helps you, Helps them and the chance they accept; the
 *    extra runtime"; helpsBothSection): under each setting's search (section 1's and section 2's, the split on its own
 *    context), how many trades help both teams (benefit.helpsBoth) at each stage, read off the search's state
 *    (helpsBothCounts: the exact trades on the screening run, the extras finalistsOf adds, the finalists the ranking picked,
 *    the Overall cards, the "Helps both" list); the split's list (up to HELPS_BOTH_SHOWN cards, the partner's odds before →
 *    after from TradeEvaluation.them); each partner's scale under the split (evaluate.partnerScaleOf: B_ref,P, which is B₃,P
 *    unless it mixes in long-term value, scaleText; the intro's words follow the league type, helpsThemScaleWords); and the
 *    extra runtime (helpsBothCost), measured under section 1's setting: section 4's runs, each one's parts read off its own
 *    progress (helpsBothParts: the partner calibration runs and the extras' final runs), each timed one followed by the same
 *    search without "Helps them" on its own context (timedSearches' pairedWithout; withoutHelpsThem, ⚠️ the engine test's
 *    way: every partner's calibration memo set to none), so the second list's work is the ranking stage's difference. The
 *    extra is the three parts, and the search's total without it section 4's less them (⚠️ derived, cold and warm: on
 *    Parker's league the search totals of runs of either kind spread over up to about 250 ms from run to run, more than the
 *    extra itself; the runs without it are measured too, against section 4's with their own sign, said with each set's
 *    spread, of the totals and of the stages Helps them doesn't touch alone: measuredRunsText, UNTOUCHED_STAGES; review of
 *    the report track, HBR-1). Under the split, section 2's one search shows its own parts the same way. The console
 *    summary gives the split's counts and the extra under section 1's setting (helpsBothSummary; HBR-3).
 *
 * Phase 7b (planner reply to Checkpoint 7a, §6.1): the settings line names the playoff weeks' weight ω every ROS(T) of the
 * search reads, set automatically from my odds under my goal (league.ts step 5c; league-report's playoffWeightSummary: the
 * B per point in each part of the season), or the fallback and why, next to the League page's model's own ω; then the
 * thresholds in ROS lineup points under that ω (league-report's thresholdsLine: config's × Σω ÷ Σω₀, so a pickup, a chip and
 * a throw-in are judged by what those thresholds meant at ω₀; review of the engine track, Phase 7b).
 *
 * Everything after the network is buildTradeReport (pure but for the clock it is given), which
 * scripts/trade-report.test.ts runs on a synthetic league.
 *
 * Privacy (CLAUDE.md §0.5, §0.6): team, owner and league names are placeholders (league-report's placeholders())
 * before the engine runs; teams read "Team N" and Parker "Team 3 (you)"; the output is scrubbed with the .env.local
 * secrets and the ESPN redaction map, public NFL player names kept whole. Output: reports/trade-report.md and a
 * short console summary.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { importEspnLeagueForModel } from "@/adapters/espn";
import type { ImportDeps } from "@/adapters/types";
import { loadPlayerIdResolver } from "@/data";
import { acceptance, betaNeed, type AcceptanceLeague, type PartnerProfile, type TradeAcceptanceInput } from "@/engine/acceptance";
import { HELPS_AT_GAIN, goalWeights, helpsBoth, helpsScaleNotes, marketSanity, marketWeekly, protectValueWeight, tradePackage, type HelpsScale, type LeagueType, type PartnerScale } from "@/engine/benefit";
import { blendRecords, type BlendRecord } from "@/engine/blend";
import { config } from "@/engine/config";
import { analyzeTrade, buildTradeContext, evaluateExact, helpsScaleOf, partnerScaleOf, proposalKey, tradeInternals, tradeSides, type Screened, type TradeContext, type TradeInternals } from "@/engine/evaluate";
import { injuryTags, tagContextOf } from "@/engine/explain";
import type { MarketInputs, ModelInputs } from "@/engine/inputs";
import { buildLeagueModel, firstKickoff } from "@/engine/league";
import type { BaseRateSource, FaMove, HelpsCalibration, LeagueModel, SeasonOdds, TeamOdds } from "@/engine/leagueModel";
import { neutralThrowIns } from "@/engine/market";
import type { InjuryStatus, LeagueSnapshot } from "@/engine/model";
import { eliteIds, perceivedPackage, teamPremiums } from "@/engine/premium";
import { atMostWaiverCredit, buildPools, leanCompanions, partnerCandidates, runRefilter, runTradeSearch, searchStateOf, shortlistOf, type SearchState } from "@/engine/search";
import { prizePeriods, type Reward } from "@/engine/reward";
import { buildSimSetup, pickupSeasonModel } from "@/engine/season";
import { GOALS, PROTECT_VALUE_LEVELS, defaultTradeSettings, normalizeTradeSettings, type Goal, type PrizeAmounts, type TradeSettings } from "@/engine/settings";
import { simNormals } from "@/engine/sim";
import type { HelpsBothList, InjuryTag, OpenSpot, TradeAsset, TradeDetail, TradeEvaluation, TradeEvaluationCore, TradeProposal, TradeSearchResult, TradeSearchStage } from "@/engine/tradeModel";
import { waiverOrderText } from "@/lib/importReport";
import { acceptText, injuryTagText, knownTagsOf, planBView, seasonEndOf, topChance, topPlacesOf, weeklyLine, type PlanBView } from "@/lib/tradeView";
import { FileCache } from "@/server/cache";
import { createHttpClient } from "@/server/http";
import { buildModelInputs } from "@/server/modelInputs";
import {
  GOAL_WORDS,
  PRICE_EXAMPLE_G,
  asWeeklyResetData,
  byGoal,
  calibrationMatches,
  commandText,
  dumpNote,
  goalRewards,
  loadDump,
  ordinal,
  placeholders,
  playoffWeightSummary,
  pre4cText,
  prizesSplitLine,
  prizesWords,
  resetWaiverOrder,
  scaleCheck,
  scaleFrom,
  thresholdsLine,
  waiverRanksPre4c,
  type ByGoal,
  type Pre4cOrder,
  type ScaleCheck,
} from "./league-report";
import { ROOT, env, loadEnv } from "./lib/env";
import { redactorFromMap } from "./lib/minimize";
import { installConsoleScrubber, registerScrubber, scrubEverything, scrubEverythingExcept } from "./lib/redact";
import { isMainModule, prizesReadLine, reportArgs, reportCommandText, reportSourceLine, setNetworkMode, wantsLive, type DumpInfo, type Env, type ReportArgs } from "./lib/runMode";

// ---------------------------------------------------------------------------------------------
// Report choices (not model tunables: nothing the engine computes depends on them)

/** Timed runs after SEARCH_WARMUPS untimed ones (the lead's brief: the warm median of 3, plus the cold run). */
export const SEARCH_RUNS = 3;
export const SEARCH_WARMUPS = 1;
/** Trades shown in full and counted as "the top 10" (the planner: "Parker's top 10"). */
export const TOP_DETAIL = 10;
/**
 * The other goal section 2 searches (the planner at Checkpoint 4c: "how the top 10 changed from Balanced to 'Win the title'";
 * since Checkpoint 7c "Several prizes", planner reply to Checkpoint 7b, §6: "how his top 5 changed from 'Only the champion'",
 * on the league's split from --prizes, ⚠️ the prefilled split without it: prizesSettingsOf).
 */
export const COMPARE_GOAL: Goal = "prizes";

/**
 * The settings section 2's other search and section 3's "Several prizes" context run under (Checkpoint 7c): the report's
 * settings with COMPARE_GOAL and the league's prizes (--prizes), else the prefilled split they already hold.
 */
export function prizesSettingsOf(settings: TradeSettings, prizes?: PrizeAmounts | null): TradeSettings {
  return normalizeTradeSettings({ ...settings, goal: COMPARE_GOAL, ...(prizes ? { prizes } : {}) });
}
/** Section 4's trade (planner reply to Checkpoint 4b, change 1; public NFL names). */
export const GAP_TRADE = { give: ["Garrett Wilson"], get: ["Chuba Hubbard", "Mike Evans"] } as const;
/** Section 6: how many of the most extreme blend factors are listed (the planner: "the 10 most extreme factors"). */
export const BLEND_EXTREMES = 10;
/**
 * blendReason's words only: an age at most this reads "age N"; at most this many games played is a data flag (next to
 * nothing of this season to go on); points a game so far within this many of ours or the market's number read "at" it.
 */
export const YOUNG_AGE = 23;
export const FEW_GAMES = 1;
export const NEAR_POINTS = 0.5;
/** Section 8: the weeks where every team's pickups move my win chance most (at least config.explain.weeklyLineMin), listed. */
export const PICKUP_WEEKS_SHOWN = 2;
/** Checkpoint 3's B for +1, +3 and +6 a week in Parker's league (CLAUDE.md §10, the weights then 0.35 / 0.65, as rosters stood). */
export const CHECKPOINT3_SCALE: Readonly<Record<number, number>> = { 1: 2.05, 3: 6.3, 6: 12.4 };

/**
 * §11's anchor tests (the planner's reply to Checkpoint 4, change 2's table): the planner's scenarios and P_accept.
 * Features not named are 0 (even value, a = 0, no history, no hole, a 1-for-1, no season context, hot and urg 0); n
 * enters as ΔLineup_P = n × nScale; a redraft league unless `dynasty`.
 */
export const ANCHORS: readonly { name: string; dynasty?: true; g?: number; n?: number; h?: 0 | 1; a?: number; c?: number; percent: number }[] = [
  { name: "Even value; n = 0.5; fills a hole; active (a = +1)", n: 0.5, h: 1, a: 1, percent: 67.9 },
  { name: "Even value; nothing else", percent: 35.4 },
  { name: "g = −0.10; n = 0.5; fills a hole", g: -0.1, n: 0.5, h: 1, percent: 37.8 },
  { name: "g = −0.20; nothing else", g: -0.2, percent: 8.3 },
  { name: "g = +0.15; n = −0.3", g: 0.15, n: -0.3, percent: 48.5 },
  { name: "Even value; inactive (a = −2)", a: -2, percent: 21.4 },
  { name: "3-for-1 (c = 2); even value", c: 2, percent: 25.0 },
  { name: "g = +0.30; n = 0.5 (the 85% cap)", g: 0.3, n: 0.5, percent: 85.0 },
  { name: "Dynasty: even value; n = 0.5; fills a hole; active", dynasty: true, n: 0.5, h: 1, a: 1, percent: 61.1 },
];
/** Both tables within ±0.5 percentage points (the planner's reply to Checkpoint 4, change 2). */
export const ANCHOR_TOLERANCE = 0.5;

/**
 * The star premium's anchor tests (the same reply's table: default coefficients, W = 752, within ±0.5 points), as
 * src/engine/acceptance.test.ts builds them: ten players worth 9,100–10,000 plus partner A's #1 "star" (9,000) and one of
 * mine (9,000) are FantasyCalc's top 12; partner A rosters star, p2 … p7 (5,000 … 1,000), partner B "best" (5,000, not
 * top-12) and b2. A contender has 70% playoff odds, the others 40% (no season context); a = 0, no history.
 */
export const PREMIUM_ANCHORS: readonly { name: string; partner: "A" | "B"; contender: boolean; recv: readonly string[]; give: readonly string[]; n?: number; h?: 0 | 1; percent: number }[] = [
  { name: "1-for-1, equal raw value; partner's #1; top-12; contender; no lineup change", partner: "A", contender: true, recv: ["you9000"], give: ["star"], percent: 10.9 },
  { name: "1-for-1, equal raw value; partner's #6; not top-12", partner: "A", contender: false, recv: ["you2000"], give: ["p6"], percent: 35.4 },
  { name: "Partner gets 4,000 + 3,500 + 3,500 for their #1 top-12 player (9,000); contender; n = 0.6; fills a hole", partner: "A", contender: true, recv: ["r4000", "r3500a", "r3500b"], give: ["star"], n: 0.6, h: 1, percent: 32.8 },
  { name: "The same trade, where the RBs help them twice as much (n = 1.2)", partner: "A", contender: true, recv: ["r4000", "r3500a", "r3500b"], give: ["star"], n: 1.2, h: 1, percent: 55.4 },
  { name: "1-for-1, equal raw value; partner's #2; not top-12", partner: "A", contender: false, recv: ["you5000"], give: ["p2"], percent: 26.3 },
  { name: "1-for-1; partner's #1, not top-12; contender; partner gets 30% more raw value", partner: "B", contender: true, recv: ["you6500"], give: ["best"], percent: 62.0 },
];
export const PREMIUM_ANCHOR_W = 752;

// ---------------------------------------------------------------------------------------------
// Numbers in words

const MINUS = "−";
const EPS = 1e-9;
const finite = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
/** Fixed decimals with a real minus sign; "–" when unknown. */
export function fmt(x: number | null | undefined, d = 1): string {
  if (!finite(x)) return "–";
  const s = Math.abs(x).toFixed(d);
  return x < 0 && Number(s) !== 0 ? `${MINUS}${s}` : s;
}
/** Signed: "+1.2", "−0.4", "0.0". */
export function signed(x: number | null | undefined, d = 1): string {
  if (!finite(x)) return "–";
  const s = fmt(x, d);
  return x > 0 && Number(Math.abs(x).toFixed(d)) !== 0 ? `+${s}` : s;
}
/** A fraction as a plain percent: 0.445 → "44.5%" (`d` decimals). */
export const pctPlain = (x: number | null | undefined, d = 1): string => (finite(x) ? `${fmt(100 * x, d)}%` : "–");
/** A change in a probability, in percentage points: +0.081 → "+8.1 pts". */
export const pts = (x: number | null | undefined, d = 1): string => (finite(x) ? `${signed(100 * x, d)} pts` : "–");
const ms = (x: number | null | undefined): string => (!finite(x) ? "–" : x >= 1000 ? `${(x / 1000).toFixed(2)} s` : x < 10 ? `${x.toFixed(1)} ms` : `${Math.round(x)} ms`);
const thousands = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
/** "✅" when a check holds, "❌" when it doesn't (CLAUDE.md §0.12: ✅ only when the data verifies it). */
const mark = (ok: boolean): string => (ok ? "✅" : "❌");

/** The median of the finite numbers (NaN without any). */
export function median(xs: readonly number[]): number {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = s.length;
  if (!n) return Number.NaN;
  return n % 2 ? (s[(n - 1) / 2] as number) : ((s[n / 2 - 1] as number) + (s[n / 2] as number)) / 2;
}

const playerIds = (xs: readonly TradeAsset[]): string[] => xs.flatMap((a) => (a.kind === "player" ? [a.id] : []));
const asPlayers = (ids: readonly string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));
/** "Garrett Wilson": a public NFL name (the id when he isn't in the data). */
const nameOf = (snapshot: LeagueSnapshot, id: string): string => snapshot.players[id]?.name ?? id;
const names = (snapshot: LeagueSnapshot, ids: readonly string[]): string => (ids.length ? ids.map((id) => nameOf(snapshot, id)).join(" + ") : "nobody");

/** A player's id by his public name (the first one in the data with it), or null. */
export function idByName(snapshot: LeagueSnapshot, name: string): string | null {
  return Object.keys(snapshot.players).find((id) => snapshot.players[id]?.name === name) ?? null;
}

/**
 * "Chance they accept" as the card prints it (planner reply to Checkpoint 4b, answer 5): the card's own words
 * (tradeView.acceptText: a model value under 5%, config.acceptance.displayStep, reads "<5%", never rounded up; else the
 * nearest 5%, acceptance.displayAcceptance), so the report and the card can't drift; "–" when unknown.
 */
export function chancePrinted(p: number): string {
  return finite(p) ? acceptText(p) : "–";
}

/** The three numbers as the card prints them: "35 / 35% Decent / 14", and the chance it goes through when the veto rule cuts it. */
export function threeNumbers(t: Pick<TradeEvaluation, "tradeScore" | "pAccept" | "pComplete" | "acceptLabel" | "overall"> & { detail: Pick<TradeDetail, "vetoRisk"> }): string {
  const veto = t.detail.vetoRisk ? ` (goes through ${chancePrinted(t.pComplete)})` : "";
  return `${t.tradeScore ?? "–"} / ${chancePrinted(t.pAccept)} ${t.acceptLabel}${veto} / ${t.overall ?? "–"}`;
}

/**
 * A card's trade-value part of Helps you (planner reply to Checkpoint 7a, §2 question 5): g_mkt(me) and B's market term in
 * points a week on the card's scale (TradeEvaluation.marketWeekly, the Analyzer's "Trade value: … pts/week equivalent"):
 * "−12.2% · −0.24 pts/wk"; "–" for the term when B has none (dynasty and keeper leagues, no FantasyCalc values).
 */
export function tradeValueText(t: Pick<TradeEvaluation, "gMine" | "marketWeekly">): string {
  const g = t.gMine === Number.POSITIVE_INFINITY ? "+∞" : `${signed(100 * t.gMine, 1)}%`;
  return `${g} · ${finite(t.marketWeekly) ? `${signed(t.marketWeekly, 2)} pts/wk` : "–"}`;
}

/** A Plan B's or a step's three numbers (no veto detail of its own: P_complete beside P_accept when they differ). */
const boxNumbers = (b: { tradeScore: number | null; pAccept: number; pComplete: number; acceptLabel: string; overall?: number | null }): string =>
  `${b.tradeScore ?? "–"} / ${chancePrinted(b.pAccept)} ${b.acceptLabel}${Math.abs(b.pComplete - b.pAccept) > EPS ? ` (goes through ${chancePrinted(b.pComplete)})` : ""} / ${b.overall ?? "–"}`;

/** Title odds before → after, one decimal (the planner: "Title odds 12.1% → 13.4%"). */
export function titleMove(before: number | null, d: number | null): string {
  return finite(before) && finite(d) ? `${pctPlain(before)} → ${pctPlain(before + d)}` : "–";
}
/** Playoff odds before → after, whole percents (the planner: "Playoff odds 65% → 69%"). */
export function playoffMove(before: number | null, d: number | null): string {
  return finite(before) && finite(d) ? `${pctPlain(before, 0)} → ${pctPlain(before + d, 0)}` : "–";
}

/**
 * The card's "Win chance by week" (planner change 9; TradeDetail.winChance), the weeks the card itself picks
 * (tradeView.weeklyLine, so the report can't drift from the card): those whose win chance moves at least
 * config.explain.weeklyLineMin, drops first, then the largest gains, at most weeklyLineMax, in week order (final review
 * of Phase 4c: showing where a trade costs me is the line's point). Null when the evaluation has no weekly chances (no
 * odds); [] when no week moves enough.
 */
export function weeklyLines(winChance: TradeDetail["winChance"], cfg: { readonly weeklyLineMin: number; readonly weeklyLineMax: number } = config.explain): { week: number; before: number; after: number }[] | null {
  if (!winChance) return null;
  const view = weeklyLine(winChance, cfg);
  if (!view) return [];
  const byWeek = new Map(winChance.flatMap((w) => (finite(w.before) && finite(w.after) ? [[w.week, { before: w.before, after: w.after }] as const] : [])));
  return view.weeks.flatMap((v) => {
    const w = byWeek.get(v.week);
    return w ? [{ week: v.week, before: w.before, after: w.after }] : [];
  });
}

/** "Week 9: 68% → 64% · Week 13: 42% → 55%" ("no week moves 3+ points"; "–" without weekly chances). */
export function weeklyText(lines: ReturnType<typeof weeklyLines>): string {
  if (lines === null) return "–";
  if (!lines.length) return `no week moves ${Math.round(100 * config.explain.weeklyLineMin)}+ points`;
  return lines.map((l) => `Week ${l.week}: ${pctPlain(l.before, 0)} → ${pctPlain(l.after, 0)}`).join(" · ");
}

// ---------------------------------------------------------------------------------------------
// The searches and their runtime (sections 1, 2, 4, 10)

/** One yield of a search (runTradeSearch's onProgress) and when it came, on the report's clock. */
export interface Tick {
  t: number;
  stage: TradeSearchStage;
  done: number;
}

/**
 * What "Helps them" and the "Helps both" list cost inside one search (section 10; planner reply to Checkpoint 7b, §7), read
 * off its own yields: each partner's calibration run is followed by a "simScreen" yield at 0 done, before any screening
 * simulation (search.ts: one per partner of the exact trades), and each final run by a "simFinal" yield, in
 * SearchState.finals' order, so an extra's final run (SearchState.helpsBothExtras) is the time up to its yield. ⚠️ The first
 * final run's time also holds the choice of the finalists (finalistsOf), so an extra there counts the median of the other
 * final runs. The second list's own work (its ranking, steps, Plan B and words) is interleaved with the Overall list's in one
 * stage, so it's measured against a search without "Helps them" instead (helpsBothCost).
 */
export interface HelpsBothParts {
  calibrations: { count: number; ms: number };
  extras: { count: number; ms: number };
}

/** A search's parts (HelpsBothParts) from its yields, its start on the same clock and its state; null without a state (a search stopped before ranking). */
export function helpsBothParts(ticks: readonly Tick[], start: number, state: Pick<SearchState, "finals" | "helpsBothExtras"> | null): HelpsBothParts | null {
  if (!state) return null;
  const gap = (i: number): number => (ticks[i] as Tick).t - (i > 0 ? (ticks[i - 1] as Tick).t : start);
  const calibrations = { count: 0, ms: 0 };
  const finals: number[] = [];
  ticks.forEach((k, i) => {
    if (k.stage === "simScreen" && k.done === 0) {
      calibrations.count++;
      calibrations.ms += gap(i);
    } else if (k.stage === "simFinal") finals.push(gap(i));
  });
  const others = finals.slice(1);
  const typical = others.length ? median(others) : (finals[0] ?? 0);
  const extraKeys = new Set(state.helpsBothExtras);
  const extras = { count: 0, ms: 0 };
  state.finals.forEach((f, i) => {
    if (!extraKeys.has(f.key)) return;
    extras.count++;
    extras.ms += i === 0 ? typical : (finals[i] ?? 0);
  });
  return { calibrations, extras };
}

/**
 * The search without "Helps them" (section 10; ⚠️ ours, the engine test's way: search.helpsBoth.test.ts, "the Overall list is
 * what it is without the second list"): before the search, every team's calibration run is set to none in the context's memo
 * (evaluate.ts SimState.partners), so no partner's scale is known: no calibration run, Helps them unknown on every trade, no
 * "Helps both" extra and an empty second list. What's left of the feature is each run's partner numbers from the same two
 * runs (evaluate.ts partnerNumbersOf), next to nothing. The context, changed in place, is returned.
 */
export function withoutHelpsThem(ctx: TradeContext): TradeContext {
  const I = tradeInternals(ctx);
  if (I.sim) for (const t of I.teams) I.sim.partners.set(t.id, null);
  return ctx;
}

export interface RuntimeRun {
  /** buildTradeContext's own stages (TradeContext.timings). */
  context: Record<string, number>;
  /** runTradeSearch's stages (TradeSearchResult.timings: setup … rank, steps, total). */
  search: Record<string, number>;
  /** Context build plus search, wall clock. */
  total: number;
  /** The trades' keys and numbers: the same in every run when the search is deterministic. */
  signature: string;
  /** Section 10: the run's "Helps both" parts, read off its own progress (helpsBothParts); null when it stopped before ranking. */
  parts: HelpsBothParts | null;
}

export interface Runtime {
  /** The first run in the process (cold: the JIT and every memo empty: a first Trade Finder visit). */
  cold: RuntimeRun;
  /** The timed runs after the warm-ups, each with its own context, and their medians. */
  runs: RuntimeRun[];
  warmups: number;
  context: Record<string, number>;
  search: Record<string, number>;
  total: number;
  /** Every run returned the same trades with the same numbers. */
  sameEveryRun: boolean;
}

export const signatureOf = (r: TradeSearchResult): string => r.trades.map((t) => `${t.key}:${t.b}:${t.pComplete}:${t.gMine}:${t.planB?.key ?? ""}`).join("|");

function medians(rows: readonly Record<string, number>[]): Record<string, number> {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return Object.fromEntries(keys.map((k) => [k, median(rows.map((r) => r[k] ?? Number.NaN))]));
}

interface SearchRunOptions {
  now: Date;
  clock: () => number;
  scenarios?: number;
  settings: TradeSettings;
  runs: number;
  warmups: number;
}

/** Timed runs (`all`, the first `warmups` of them untimed) as a Runtime: the first is the cold one, the medians are the timed ones'. */
function runtimeOf(all: readonly RuntimeRun[], warmups: number): Runtime {
  const timed = all.slice(warmups);
  return {
    cold: all[0] as RuntimeRun,
    runs: timed,
    warmups,
    context: medians(timed.map((r) => r.context)),
    search: medians(timed.map((r) => r.search)),
    total: median(timed.map((r) => r.total)),
    sameEveryRun: all.every((r) => r.signature === all[0]?.signature),
  };
}

/** One search on its own context, timed, with its progress kept on the clock for its "Helps both" parts (helpsBothParts: a timestamp a yield, next to nothing against a search). */
function timedRun(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: SearchRunOptions & { exhaustive?: boolean; helpsThem?: boolean }): { ctx: TradeContext; result: TradeSearchResult; run: RuntimeRun } {
  const { clock } = opts;
  const t0 = clock();
  const ctx = buildTradeContext(snapshot, inputs, { now: opts.now, clock, settings: opts.settings, ...(opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {}) });
  if (opts.helpsThem === false) withoutHelpsThem(ctx);
  const ticks: Tick[] = [];
  const start = clock();
  const result = runTradeSearch(ctx, { clock, settings: opts.settings, ...(opts.exhaustive === false ? { exhaustive: false } : {}) }, (p) => ticks.push({ t: clock(), stage: p.stage, done: p.done }));
  const total = clock() - t0;
  return { ctx, result, run: { context: { ...ctx.timings }, search: { ...result.timings }, total, signature: signatureOf(result), parts: helpsBothParts(ticks, start, searchStateOf(result)) } };
}

/**
 * The default search `warmups` + `runs` times, each with its own context (`exhaustive` false: the beams alone; `helpsThem`
 * false: without "Helps them", withoutHelpsThem); the last run's context and result. `pairedWithout` (section 10): after each
 * timed run, the same search without "Helps them" on its own context, so each pair runs side by side in the process (⚠️ run
 * as a set afterwards, they came out faster on stages Helps them doesn't touch, screening and exact evaluation, as the JIT
 * kept warming up: 388 ms against 496 ms on the test league's screening); its runs come back as `without`.
 */
export function timedSearches(
  snapshot: LeagueSnapshot,
  inputs: ModelInputs,
  opts: SearchRunOptions & { exhaustive?: boolean; helpsThem?: boolean; pairedWithout?: boolean },
): { ctx: TradeContext; result: TradeSearchResult; runtime: Runtime; without: { ctx: TradeContext; result: TradeSearchResult; runtime: Runtime } | null } {
  const all: RuntimeRun[] = [];
  const paired: RuntimeRun[] = [];
  let last: { ctx: TradeContext; result: TradeSearchResult } | null = null;
  let lastWithout: { ctx: TradeContext; result: TradeSearchResult } | null = null;
  const warmups = Math.max(0, Math.floor(opts.warmups));
  const total = warmups + Math.max(1, Math.floor(opts.runs));
  for (let i = 0; i < total; i++) {
    const r = timedRun(snapshot, inputs, opts);
    all.push(r.run);
    last = { ctx: r.ctx, result: r.result };
    if (!opts.pairedWithout || i < warmups) continue;
    const w = timedRun(snapshot, inputs, { ...opts, helpsThem: false });
    paired.push(w.run);
    lastWithout = { ctx: w.ctx, result: w.result };
  }
  const done = last as { ctx: TradeContext; result: TradeSearchResult };
  return { ...done, runtime: runtimeOf(all, warmups), without: lastWithout ? { ...lastWithout, runtime: runtimeOf(paired, 0) } : null };
}

/** The League model's build time (as the League page builds it): the first build in the process and the median of the timed ones; the last build. */
export function leagueBuilds(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: SearchRunOptions): { model: LeagueModel; cold: number; warm: number } {
  const times: number[] = [];
  let model: LeagueModel | null = null;
  const warmups = Math.max(0, Math.floor(opts.warmups));
  for (let i = 0; i < warmups + Math.max(1, Math.floor(opts.runs)); i++) {
    const t0 = opts.clock();
    model = buildLeagueModel(snapshot, inputs, { now: opts.now, settings: opts.settings, ...(opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {}) });
    times.push(opts.clock() - t0);
  }
  return { model: model as LeagueModel, cold: times[0] as number, warm: median(times.slice(warmups)) };
}

// ---------------------------------------------------------------------------------------------
// Section 1: the cards

/**
 * The counts the planner asks for: cards, with Plan B, with offer-first steps, receiving an injury-tagged player (the
 * card's own tags), and the Plan B boxes receiving one (`tagsOf`, the search's rule: review of track R, R-2, the injured
 * targets a Plan B asks for were uncounted). An offer-first step receives the card's own players, so the card's count
 * covers it.
 */
export interface CardCounts {
  shown: number;
  planB: number;
  steps: number;
  injuredGet: number;
  planBInjuredGet: number;
}

export function cardCounts(trades: readonly TradeEvaluation[], tagsOf: Tagger): CardCounts {
  return {
    shown: trades.length,
    planB: trades.filter((t) => t.planB).length,
    steps: trades.filter((t) => t.steps).length,
    injuredGet: trades.filter((t) => (t.flags.tagged ?? []).some((g) => g.side === "get")).length,
    planBInjuredGet: trades.filter((t) => t.planB && tagsOf(t.planB.proposal).some((g) => g.side === "get")).length,
  };
}

// ---------------------------------------------------------------------------------------------
// Section 2: the goal setting

/**
 * One trade under each setting: its place among the shown cards (null: not shown), B, Helps you, the chance it goes through
 * and Overall, on that setting's own trade context.
 */
export interface GoalSide {
  rank: number | null;
  b: number | null;
  helps: number | null;
  /** P_complete there: each setting's context has its own pickups and baseline, so the chance can move a little too. */
  pComplete: number | null;
  overall: number | null;
}

export interface GoalRow {
  key: string;
  partnerId: string;
  give: string[];
  get: string[];
  title: GoalSide;
  other: GoalSide;
}

/** The trades the planner asks about in section 2 ("how his top 5 changed from 'Only the champion'"). */
export const GOAL_TOP = 5;

export interface GoalCompare {
  /** The other setting ("Several prizes": COMPARE_GOAL), the settings its search ran under, and the reward it scored on. */
  goal: Goal;
  settings: TradeSettings;
  reward: Reward | null;
  /** Each side's playoff weeks' weight ω (its context's League model). */
  omega: { title: number; other: number };
  result: TradeSearchResult;
  /** Section 10: with a clock, the other search's "Helps both" parts read off its own progress (helpsBothParts; its total in result.timings); else null. */
  parts: HelpsBothParts | null;
  /** The union of both top TOP_DETAIL lists: the default goal's order first, then the other's extras in its order. */
  rows: GoalRow[];
  /** Trades in both top lists, and in both top GOAL_TOP. */
  common: number;
  commonTop: number;
}

/**
 * Section 2 (Checkpoint 7c; planner reply to Checkpoint 7b, §6): the search the app runs under the other setting, on the
 * trade context it builds under it (`other`: its own ω, so its own pickups, baseline and shortlists, and the weekly high
 * scores simulated when its split pays them), against the main search; both top `top` lists side by side. A trade one list
 * doesn't show gets the Analyzer's numbers on that list's context and settings (analyzeTrade: the same final block of
 * seasons). Until Checkpoint 7c it ran on the main context, the main setting's ω held (only B's weights moved). With `clock`,
 * the other search is timed and its "Helps both" parts read off its progress (section 10).
 */
export function goalCompare(ctx: TradeContext, main: TradeSearchResult, settings: TradeSettings, other: { ctx: TradeContext; settings: TradeSettings }, top = TOP_DETAIL, clock?: () => number): GoalCompare {
  const ticks: Tick[] = [];
  const start = clock ? clock() : 0;
  const result = clock ? runTradeSearch(other.ctx, { settings: other.settings, clock }, (p) => ticks.push({ t: clock(), stage: p.stage, done: p.done })) : runTradeSearch(other.ctx, { settings: other.settings });
  const sideOf = (list: TradeSearchResult, key: string, proposal: TradeProposal, c: TradeContext, s: TradeSettings): GoalSide => {
    const at = list.trades.findIndex((t) => t.key === key);
    const t = at >= 0 ? list.trades[at] : analyzeTrade(c, proposal, { settings: s }).evaluation;
    return { rank: at >= 0 ? at + 1 : null, b: t?.b ?? null, helps: t?.tradeScore ?? null, pComplete: t?.pComplete ?? null, overall: t?.overall ?? null };
  };
  const seen = new Set<string>();
  const rows: GoalRow[] = [];
  for (const t of [...main.trades.slice(0, top), ...result.trades.slice(0, top)]) {
    if (seen.has(t.key)) continue;
    seen.add(t.key);
    rows.push({ key: t.key, partnerId: t.proposal.partnerId, give: playerIds(t.proposal.give), get: playerIds(t.proposal.get), title: sideOf(main, t.key, t.proposal, ctx, settings), other: sideOf(result, t.key, t.proposal, other.ctx, other.settings) });
  }
  const inBoth = (n: number) => {
    const keys = new Set(result.trades.slice(0, n).map((t) => t.key));
    return main.trades.slice(0, n).filter((t) => keys.has(t.key)).length;
  };
  return {
    goal: other.settings.goal,
    settings: other.settings,
    reward: result.reward ?? null,
    omega: { title: tradeInternals(ctx).model.playoffWeight, other: tradeInternals(other.ctx).model.playoffWeight },
    result,
    parts: clock ? helpsBothParts(ticks, start, searchStateOf(result)) : null,
    rows,
    common: inBoth(top),
    commonTop: inBoth(Math.min(GOAL_TOP, top)),
  };
}

// ---------------------------------------------------------------------------------------------
// Section 3: B₃ under each goal (planner reply to Checkpoint 4c, A2)

/**
 * league-report's scaleCheck for my team from the one baseline (every team after its pickups: pickupSeasonModel and
 * TeamModel.scoreWithPickups), on the League model's own seasons, the gains from the first week a trade can change
 * (scaleFrom); "Several prizes" on `prizes` (Checkpoint 7c: the report's --prizes) when given. Null without odds or a team.
 */
export function scaleCheckOf(snapshot: LeagueSnapshot, model: LeagueModel, prizes?: PrizeAmounts | null): ScaleCheck | null {
  const odds = model.odds;
  const me = model.teams.find((t) => t.id === model.myTeamId);
  if (!odds || !me) return null;
  const pick = pickupSeasonModel(model);
  const built = buildSimSetup(snapshot, pick);
  if (!built) return null;
  const run = { sims: odds.sims, seed: odds.seed, normals: simNormals(odds.seed, odds.sims, built.setup.weeks.length, built.setup.teams.length) };
  return scaleCheck(snapshot, pick, me.id, me.scoreWithPickups ?? me.score, run, { from: scaleFrom(model), rewards: goalRewards(prizePeriods(snapshot), model.reward, prizes) });
}

/** Section 3 (the file header). */
export interface HelpsScaleSection {
  /** The League model's calibration run (LeagueModel.helpsCalibration, step 8c): ΔPO₃ and ΔCH₃; null without odds or a team. */
  calibration: HelpsCalibration | null;
  /** The trade context's run on its final block (evaluate.ts SimState.calibration) is the same, bit for bit; null without either. */
  contextMatches: boolean | null;
  /**
   * B₃ under each goal as the app's search scores its cards under that goal (evaluate.helpsScaleOf with the report's
   * settings' λ), each on that goal's own trade context: since the planner's reply to Checkpoint 7a (§6.1) the goal sets the
   * playoff weeks' weight ω, so each goal has its own pickups, baseline and +3 run (review of Phase 7b: every goal's B₃ was
   * read off the default goal's context, Balanced 5.88 where the app uses 5.93); null without odds.
   */
  b3: ByGoal<HelpsScale | null>;
  /** Each goal's own context: its ω (LeagueModel.playoffWeight) and its calibration run (SimState.calibration; null without odds). */
  omega: ByGoal<number>;
  calibrations: ByGoal<HelpsCalibration | null>;
  /** league-report's scale check from the one baseline: +1, +3 and +6 a week, Helps you on its +3 row's B₃ (the same B₃). */
  check: ScaleCheck | null;
  /** The check's +3 row is the League model's calibration run, bit for bit (league-report calibrationMatches). */
  checkMatches: boolean | null;
}

/**
 * Section 3: the calibration run, B₃ under each goal as the search uses it, and the scale check on the new scale.
 * `contextFor`: the trade context the app builds under a goal (the report's own `ctx` for the settings' goal); each goal's
 * B₃ and ω are read off its own (HelpsScaleSection.b3). Without it every goal reads `ctx` (tests). Checkpoint 7c: `prizes`,
 * the league's split (--prizes), for the scale check's "Several prizes" column; the "Several prizes" context (contextFor)
 * is built under it too (buildTradeReport: section 2's).
 */
export function helpsScaleSection(snapshot: LeagueSnapshot, model: LeagueModel, ctx: TradeContext, settings: TradeSettings, contextFor: (goal: Goal) => TradeContext = () => ctx, prizes?: PrizeAmounts | null): HelpsScaleSection {
  const I = tradeInternals(ctx);
  const calibration = model.helpsCalibration ?? null;
  const own = I.sim?.calibration ?? null;
  const contextMatches = calibration && own ? own.gain === calibration.gain && own.from === calibration.from && Object.is(own.dPO, calibration.dPO) && Object.is(own.dCH, calibration.dCH) : null;
  // Checkpoint 7c: the scale check's "Several prizes" column on the league's split (the report's --prizes) when given.
  const check = scaleCheckOf(snapshot, model, prizes);
  const contexts = byGoal((g) => (g === settings.goal ? I : tradeInternals(contextFor(g))));
  return {
    calibration,
    contextMatches,
    // Each goal's context scores on its own reward (its settings' goal and prizes: evaluate.ts rewardOn).
    b3: byGoal((g) => helpsScaleOf(contexts[g], settings.lambda)),
    omega: byGoal((g) => contexts[g].model.playoffWeight),
    calibrations: byGoal((g) => contexts[g].sim?.calibration ?? null),
    check,
    checkMatches: calibrationMatches(check, calibration),
  };
}

// ---------------------------------------------------------------------------------------------
// Section 4: the search gap

/**
 * One partner's screened counts (exhaustive candidates and beams alone) and how many of its trades reach each stage
 * (`finalRuns`: the final simulation, the finalists and, since Checkpoint 7c, the "Helps both" extras: search.ts finalistsOf).
 */
export interface PartnerCounts {
  partnerId: string;
  exhaustive: number;
  beams: number;
  exact: number;
  finalRuns: number;
  cards: number;
}

export interface SearchGap {
  /** GAP_TRADE in this data (Wilson mine, Hubbard and Evans on one other team), or null with the reason. */
  trade: { key: string; partnerId: string; give: string[]; get: string[] } | null;
  missing: string | null;
  /** Its rank among that partner's legal screened candidates by the screening objective (then the key), and its numbers there. */
  screened: { rank: number; of: number; objective: number; gPartner: number } | null;
  /** The beams alone screen it too (TradeSearchOptions.exhaustive false). */
  beams: boolean;
  /** Inside config.search.screeningGWindow on g_mkt(P). */
  inWindow: boolean | null;
  /** Its rank in that partner's keep (the window, the dominance pruning, the best keptPerPartner), and the keep's size. */
  kept: { rank: number; of: number } | null;
  /**
   * In the exactEvaluationMax shortlist over every partner; evaluated exactly (legal); a finalist the ranking picked; a "Helps
   * both" extra (a final run only that list ranks: SearchState.helpsBothExtras, Checkpoint 7c); its card's place.
   */
  shortlisted: boolean;
  exact: boolean;
  finalist: boolean;
  extra: boolean;
  card: number | null;
  /** Its numbers: the card's when shown, else the Analyzer's (the same final block). */
  evaluation: TradeEvaluation | null;
  /** The best card with the same partner that gives Garrett Wilson ("or better"), when it isn't this trade. */
  bestSameFamily: { rank: number; trade: TradeEvaluation } | null;
  perPartner: PartnerCounts[];
  /**
   * The re-screening reproduces the search (its rules can't have drifted from the report's reading of them): the screens per
   * partner add up to TradeSearchResult.counts.screened, and every trade the search evaluated exactly is in the shortlist
   * rebuilt here (search.shortlistOf with search.atMostWaiverCredit, the search's own call) or among its lean companions
   * (search.leanCompanions on that shortlist, as the search calls it). Null when nothing was screened.
   */
  reproduces: { counts: boolean; shortlist: boolean } | null;
  /** The legal candidates the beams alone screen, over every partner (their keys). */
  beamsKeys: number;
  /** What only the exhaustive candidates reach (keys the beams alone never screen): exact trades, final runs (the extras too), cards. */
  onlyExhaustive: { exact: number; finalRuns: number; cards: number };
}

function drain<T>(it: Generator<void, T, void>): T {
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** The screening objective's order (search.ts byObjective): the objective, highest first, then the key. */
const byObjective = (a: { objective: number; key: string }, b: { objective: number; key: string }): number => (Math.abs(b.objective - a.objective) > EPS ? b.objective - a.objective : a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * The search gap (the file header, section 4): every partner's candidates screened again on the search's own context
 * (search.buildPools, search.partnerCandidates with the exhaustive candidates and without), so the counts per partner and
 * GAP_TRADE's place at each stage (search.shortlistOf with the dominance pruning, then the search's state: its exact
 * trades and finalists, and the result's cards) come from the same rules the search ran.
 */
export function searchGap(ctx: TradeContext, result: TradeSearchResult, settings: TradeSettings): SearchGap {
  const I = tradeInternals(ctx);
  const snapshot = I.snapshot;
  const state = searchStateOf(result);
  const wilson = idByName(snapshot, GAP_TRADE.give[0]);
  const gets = GAP_TRADE.get.map((n) => idByName(snapshot, n));
  const holder = (id: string | null) => (id ? (snapshot.teams.find((t) => t.roster.includes(id) || t.ir.includes(id))?.id ?? null) : null);
  const partnerId = holder(gets[0] ?? null);
  const absent = [GAP_TRADE.give[0], ...GAP_TRADE.get].filter((n) => !idByName(snapshot, n));
  let missing: string | null = null;
  if (absent.length) missing = `${absent.join(" and ")} ${absent.length === 1 ? "isn't" : "aren't"} in this data`;
  else if (holder(wilson) !== result.myTeamId) missing = `${GAP_TRADE.give[0]} isn't on your roster in this data`;
  else if (!partnerId || partnerId === result.myTeamId || gets.some((id) => holder(id) !== partnerId)) missing = `${GAP_TRADE.get.join(" and ")} aren't on the same other team in this data`;
  const trade = missing ? null : { partnerId: partnerId as string, give: [wilson as string], get: gets as string[], key: proposalKey({ partnerId: partnerId as string, give: asPlayers([wilson as string]), get: asPlayers(gets as string[]) }) };
  const empty: SearchGap = { trade, missing, screened: null, beams: false, inWindow: null, kept: null, shortlisted: false, exact: false, finalist: false, extra: false, card: null, evaluation: null, bestSameFamily: null, perPartner: [], reproduces: null, beamsKeys: 0, onlyExhaustive: { exact: 0, finalRuns: 0, cards: 0 } };
  if (I.blocked || !I.me || !state) return empty;
  const pools = buildPools(I, settings, null);
  if (pools.stop) return empty;
  const lists: Screened[][] = [];
  const beamsKeys = new Set<string>();
  const perPartner: PartnerCounts[] = [];
  const exactKeys = [...state.exactByKey.keys()];
  const finalKeys = state.finals.map((f) => f.key);
  for (const partner of pools.partners) {
    const H = pools.get.get(partner.id) as { pool: string[]; forced: string[] };
    const pool = { give: pools.give, forcedGive: pools.forcedGive, get: H.pool, forcedGet: H.forced };
    const ex = { screened: 0 };
    lists.push(drain(partnerCandidates(I, partner, pool, settings.maxPerSide, ex, { exhaustive: true })));
    const bm = { screened: 0 };
    for (const s of drain(partnerCandidates(I, partner, pool, settings.maxPerSide, bm, { exhaustive: false }))) beamsKeys.add(s.key);
    perPartner.push({
      partnerId: partner.id,
      exhaustive: ex.screened,
      beams: bm.screened,
      exact: exactKeys.filter((k) => state.exactByKey.get(k)?.partner.id === partner.id).length,
      finalRuns: state.finals.filter((f) => f.proposal.partnerId === partner.id).length,
      cards: result.trades.filter((t) => t.proposal.partnerId === partner.id).length,
    });
  }
  const only = (keys: readonly string[]) => keys.filter((k) => !beamsKeys.has(k)).length;
  const shortlist = shortlistOf(lists, atMostWaiverCredit(I));
  const shortKeys = new Set(shortlist.map((x) => x.key));
  // The search evaluates the shortlist's lean companions too (search.leanCompanions, its own call on that shortlist).
  const evaluated = new Set([...shortKeys, ...drain(leanCompanions(I, shortlist, lists, pools)).map((x) => x.key)]);
  const reproduces = { counts: perPartner.reduce((n, p) => n + p.exhaustive, 0) === result.counts.screened, shortlist: exactKeys.every((k) => evaluated.has(k)) };
  const out: SearchGap = { ...empty, perPartner, reproduces, beamsKeys: beamsKeys.size, onlyExhaustive: { exact: only(exactKeys), finalRuns: only(finalKeys), cards: only(result.trades.map((t) => t.key)) } };
  if (!trade) return out;
  const at = pools.partners.findIndex((p) => p.id === trade.partnerId);
  const list = at >= 0 ? [...(lists[at] ?? [])].sort(byObjective) : [];
  const s = list.findIndex((x) => x.key === trade.key);
  const screened = s >= 0 ? (list[s] as (typeof list)[number]) : null;
  const [gLo, gHi] = config.search.screeningGWindow;
  const kept = at >= 0 ? shortlistOf([lists[at] ?? []], atMostWaiverCredit(I)) : [];
  const k = kept.findIndex((x) => x.key === trade.key);
  const card = result.trades.findIndex((t) => t.key === trade.key);
  const evaluation = card >= 0 ? (result.trades[card] as TradeEvaluation) : analyzeTrade(ctx, { partnerId: trade.partnerId, give: asPlayers(trade.give), get: asPlayers(trade.get) }, { settings }).evaluation;
  const family = result.trades.findIndex((t) => t.key !== trade.key && t.proposal.partnerId === trade.partnerId && playerIds(t.proposal.give).includes(wilson as string));
  return {
    ...out,
    screened: screened ? { rank: s + 1, of: list.length, objective: screened.objective, gPartner: screened.gPartner } : null,
    beams: beamsKeys.has(trade.key),
    inWindow: screened ? Number.isFinite(screened.gPartner) && screened.gPartner >= gLo - EPS && screened.gPartner <= gHi + EPS : null,
    kept: k >= 0 ? { rank: k + 1, of: kept.length } : null,
    shortlisted: shortKeys.has(trade.key),
    exact: state.exactByKey.has(trade.key),
    finalist: finalKeys.includes(trade.key) && !state.helpsBothExtras.includes(trade.key),
    extra: state.helpsBothExtras.includes(trade.key),
    card: card >= 0 ? card + 1 : null,
    evaluation,
    bestSameFamily: family >= 0 ? { rank: family + 1, trade: result.trades[family] as TradeEvaluation } : null,
  };
}

/**
 * The finalists the ranking picked (sections 8 and 9): SearchState.finals less the "Helps both" extras, which since
 * Checkpoint 7c get a final run too but only the second list ranks (planner reply to Checkpoint 7b, §7). Empty without a state.
 */
export function rankedFinals(state: Pick<SearchState, "finals" | "helpsBothExtras"> | null): TradeEvaluationCore[] {
  if (!state) return [];
  const extras = new Set(state.helpsBothExtras);
  return state.finals.filter((f) => !extras.has(f.key));
}

/**
 * A search's final runs in words (section 4): since Checkpoint 7c counts.simFinal holds the "Helps both" extras' final runs
 * too (SearchState.helpsBothExtras; planner reply to Checkpoint 7b, §7), so "65 final runs (60 finalists and 5 "Helps both"
 * extras: section 10)"; "60 finalists" without an extra.
 */
export function finalRunsText(result: TradeSearchResult): string {
  const n = result.counts.simFinal;
  const extras = searchStateOf(result)?.helpsBothExtras.length ?? 0;
  return extras ? `${n} final runs (${n - extras} finalists and ${extras} "Helps both" extra${extras === 1 ? "" : "s"}: section 10)` : `${n} finalists`;
}

// ---------------------------------------------------------------------------------------------
// Section 5: the minimum-chance filter

export interface FilterRow {
  minChance: number;
  cards: number;
  qualifying: number;
  byChance: number;
  few: boolean;
  ms: number;
  /** At the search's own minimum: the re-filtered list is the search's, card for card (null at the other options). */
  same: boolean | null;
}

/** runRefilter from the one search at every option (the file header, section 5); null when the search stopped before ranking. */
export function filterRows(ctx: TradeContext, result: TradeSearchResult, clock: () => number, options: readonly number[] = config.ranking.minChanceOptions): FilterRow[] | null {
  const state = searchStateOf(result);
  if (!state) return null;
  return options.map((minChance) => {
    const t0 = clock();
    const r = runRefilter(ctx, state, { minChance });
    const dt = clock() - t0;
    const same = Math.abs(minChance - (result.filter?.minChance ?? Number.NaN)) <= EPS ? signatureOf(r) === signatureOf(result) : null;
    return { minChance, cards: r.trades.length, qualifying: r.filter?.qualifying ?? 0, byChance: r.hidden.byChance ?? 0, few: r.filter?.few ?? false, ms: dt, same };
  });
}

// ---------------------------------------------------------------------------------------------
// Section 6: the blend

/** A blend record with its reason in words, and the player's points per game so far (PlayerModel.base.actualPpg: a fact shown beside it). */
export interface BlendRow extends BlendRecord {
  reason: string;
  actualPpg: number | null;
}

export interface BlendReport {
  /** Players the blend scales (a base rate above 0), the clamp, and the raw factors' range. */
  count: number;
  clamp: readonly [number, number];
  range: { min: number; median: number; max: number } | null;
  /** The most extreme factors before the clamp, and every factor the clamp cut. */
  rows: BlendRow[];
  clamped: BlendRecord[];
}

const STATUS_WORDS: Readonly<Record<InjuryStatus, string>> = { ACTIVE: "healthy", PROBABLE: "probable", QUESTIONABLE: "questionable", DOUBTFUL: "doubtful", OUT: "out", IR: "on IR", PUP: "on the PUP list", SUSPENDED: "suspended", NA: "not an active NFL player" };

/** Where a base rate comes from (PlayerModel.base.source), in words; the last three are fallbacks (no weekly projection). */
const SOURCE_WORDS: Readonly<Record<BaseRateSource, string>> = {
  "espn+sleeper": "ESPN's and Sleeper's projections averaged",
  sleeper: "Sleeper's projection alone",
  espn: "ESPN's projection alone",
  season: "no weekly projection, so Sleeper's season line ÷ 17",
  actual: "no projection, so his own points a game",
  none: "no projection at all",
};

const capitalized = (s: string): string => (s ? `${s[0]?.toUpperCase() ?? ""}${s.slice(1)}` : s);

/**
 * Where a player's points a game so far (PlayerModel.base.actualPpg, league scoring) fall against our base rate and the
 * market's number: within NEAR_POINTS of one reads "at" it; else below both, above both, or between the two and nearer
 * one. "" without a game played.
 */
function resultsSoFar(r: Pick<BlendRow, "ours" | "market" | "games" | "actualPpg">): string {
  const a = r.actualPpg;
  if (a === null || !finite(a) || r.games === null || r.games <= 0) return "";
  const nearOurs = Math.abs(a - r.ours) <= NEAR_POINTS;
  const nearMarket = Math.abs(a - r.market) <= NEAR_POINTS;
  const where =
    nearOurs && nearMarket
      ? "at both"
      : nearOurs
        ? "at our projection"
        : nearMarket
          ? "at the market's number"
          : a < Math.min(r.ours, r.market)
            ? "below both"
            : a > Math.max(r.ours, r.market)
              ? "above both"
              : `between the two, nearer ${Math.abs(a - r.ours) < Math.abs(a - r.market) ? "ours" : "the market's"}`;
  return `He has scored ${fmt(a)} a game so far (${r.games} game${r.games === 1 ? "" : "s"}), ${where}.`;
}

/**
 * A blend factor's reason in words (planner reply to Checkpoint 4b, change 4: "the reason for each … a fallback base rate,
 * a rookie role change, an injury, hype"), built from its record and his points a game so far alone (review of track R,
 * R-3: the words had only restated the factor). First what the record shows about the data: the flags it can show (a
 * fallback base rate; an injury, which also takes him off the curve: he reads it but doesn't shape it; no game left; at most
 * FEW_GAMES games played), else "No data flag", each with the facts that rule the others out (where his base rate comes
 * from, healthy, games, a young age up to YOUNG_AGE, a curve read with his own point). Then the disagreement per game: the
 * market's number R_pos(v) is the curve of our base rates over healthy players by value (blend.ts rule 4), so "healthy
 * players valued like him are projected X a game". Then where his results so far fall (resultsSoFar), and the clamp when
 * it cut. Never a guess the record can't support: hype and role changes aren't facts it holds, so they're never named.
 */
export function blendReason(r: Pick<BlendRow, "fRaw" | "f" | "clamped" | "ours" | "market" | "curve" | "source" | "fallback" | "games" | "injury" | "age" | "actualPpg">): string {
  const injured = r.injury !== null && r.injury !== "ACTIVE";
  const flags: string[] = [];
  if (r.fallback) flags.push(`a fallback base rate (${r.source ? SOURCE_WORDS[r.source] : "no projection"})`);
  if (injured) flags.push(`${STATUS_WORDS[r.injury as InjuryStatus]}, so off the curve (he reads it but doesn't shape it)`);
  else if (r.curve === "offCurve") flags.push("off the curve (no game left)");
  if (r.games !== null && r.games <= FEW_GAMES) flags.push(r.games === 0 ? "no game played yet" : `${r.games} game played`);
  const facts: string[] = [];
  if (!r.fallback && r.source) facts.push(SOURCE_WORDS[r.source]);
  if (r.injury === "ACTIVE") facts.push("healthy");
  if (r.games !== null && r.games > FEW_GAMES) facts.push(`${r.games} games`);
  if (r.age !== null && r.age <= YOUNG_AGE) facts.push(`age ${r.age}`);
  if (r.curve === "ownPoint") facts.push("the curve read with his own point (an end of his position's value range)");
  const head = flags.length ? `${capitalized(flags.join("; "))}${facts.length ? `; ${facts.join(", ")}` : ""}.` : `No data flag${facts.length ? ` (${facts.join(", ")})` : ""}.`;
  const gap = `Healthy players valued like him are projected ${fmt(r.market)} a game; we project ${fmt(r.ours)}${injured ? " when he plays" : ""}.`;
  const so = resultsSoFar(r);
  const cut = r.clamped ? ` The clamp cuts ×${fmt(r.fRaw, 2)} to ×${fmt(r.f, 2)}.` : "";
  return `${head} ${gap}${so ? ` ${so}` : ""}${cut}`;
}

/** The blend of the trade context's League build (blendRecords on LeaguePlayers.blend and the model's players): section 6. */
export function blendReport(I: TradeInternals, n = BLEND_EXTREMES): BlendReport {
  const records = blendRecords(I.league.lp.blend, I.model.players, (id) => I.snapshot.players[id]);
  const fs = records.map((r) => r.fRaw);
  return {
    count: records.length,
    clamp: config.marketBlend.factorClamp,
    range: fs.length ? { min: Math.min(...fs), median: median(fs), max: Math.max(...fs) } : null,
    rows: records.slice(0, n).map((r) => {
      const actualPpg = I.model.players[r.id]?.base.actualPpg ?? null;
      return { ...r, actualPpg, reason: blendReason({ ...r, actualPpg }) };
    }),
    clamped: records.filter((r) => r.clamped !== null),
  };
}

// ---------------------------------------------------------------------------------------------
// Section 7: odds by waiver order

/** Which order a snapshot's Team.waiverRank holds (settings.waiverOrderUsed; "pre4c": ESPN's live order, before the 4c adapter). */
export type DataOrder = "weeklyReset" | "live" | "faab" | "pre4c" | "none";

export function dataOrderOf(snapshot: LeagueSnapshot): DataOrder {
  return snapshot.settings.waiverOrderUsed ?? (waiverRanksPre4c(snapshot) ? "pre4c" : "none");
}

/** A League model under one waiver order: the order, where it came from, my place and pickups, my odds with pickups. */
export interface OrderOdds {
  how: string;
  order: string[];
  model: LeagueModel;
  place: number | null;
  mine: TeamOdds | null;
  pickups: FaMove[];
}

export interface OddsReport {
  /** Which order the data held as loaded ("pre4c": a dump from before the 4c adapter, which the report put on the 4c rule). */
  data: DataOrder;
  /** The weekly reset order (the headline: the model the report ran on), null when the league doesn't reset weekly (with why). */
  reset: OrderOdds | null;
  resetMissing: string | null;
  /** The live order, null when the data doesn't have it (with why). */
  live: OrderOdds | null;
  liveMissing: string | null;
  /** As rosters stand (the data's model: no pickups, so no order). */
  stand: TeamOdds | null;
  /** My games: the win chance with pickups in the reset order (else the data's), as rosters stand, and in the live order. */
  weekly: { week: number; opponentId: string | null; reset: number | null; stand: number | null; live: number | null }[];
  /** The trade search's baseline equals LeagueModel.odds exactly (JSON, every team and week and the notes). */
  baselineEqual: boolean | null;
  /**
   * When the headline is a weekly reset order (4c data, or a dump put on the 4c rule): the reset order equals today's
   * standings by the league's rules reversed (resetWaiverOrder: the simulator's ranks); null otherwise.
   */
  resetMatchesStandings: boolean | null;
}

const oddsOf = (odds: SeasonOdds | null | undefined, teamId: string | null): TeamOdds | null => (teamId ? (odds?.teams.find((t) => t.teamId === teamId) ?? null) : null);
const myGame = (odds: SeasonOdds | null | undefined, week: number, teamId: string | null) => odds?.weekly.find((w) => w.week === week)?.games.find((g) => g.teamId === teamId) ?? null;

/** The snapshot with every team's waiver rank set from `rank` (a team without one keeps its own). */
function withRanks(snapshot: LeagueSnapshot, rank: (teamId: string) => number | undefined): LeagueSnapshot {
  return { ...snapshot, teams: snapshot.teams.map((t) => ({ ...t, waiverRank: rank(t.id) ?? t.waiverRank })) };
}

/**
 * My odds by waiver order (the file header, section 7). `model` is the League model of the snapshot the report ran on and
 * `ctx` the trade context the search ran on (its baseline must equal model.odds). The other order's model is built with the
 * same options. `opts.pre4c`: the snapshot is a dump from before the 4c adapter that the report put on the 4c rule
 * (league-report's asWeeklyResetData): its reset order was built from the standings and its live order is the dump's own
 * ranks (Team.liveWaiverRank now), and the rows say so.
 */
export function oddsByOrder(snapshot: LeagueSnapshot, inputs: ModelInputs, model: LeagueModel, ctx: TradeContext, opts: { now: Date; settings: TradeSettings; scenarios?: number; pre4c?: Pre4cOrder | null }): OddsReport {
  const me = model.myTeamId;
  const used = dataOrderOf(snapshot);
  const pre4c = opts.pre4c ?? null;
  const data: DataOrder = pre4c ? "pre4c" : used;
  const build = (s: LeagueSnapshot) => buildLeagueModel(s, inputs, { now: opts.now, settings: opts.settings, ...(opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {}) });
  const of = (how: string, m: LeagueModel): OrderOdds => {
    const order = [...(m.faAllocation?.order ?? [])];
    const place = me ? order.indexOf(me) : -1;
    return { how, order, model: m, place: place >= 0 ? place + 1 : null, mine: oddsOf(m.odds, me), pickups: [...(m.teams.find((t) => t.id === me)?.faMoves ?? [])] };
  };
  let reset: OrderOdds | null = null;
  let resetMissing: string | null = null;
  let live: OrderOdds | null = null;
  let liveMissing: string | null = null;
  if (used === "weeklyReset") {
    reset = of(pre4c ? "built by this report from today's standings (reverse standings: the 4c adapter's rule), since the dump comes from before the 4c adapter" : "the data's own: the 4c adapter's weekly reset order (reverse standings)", model);
    const hasLive = snapshot.teams.length > 0 && snapshot.teams.every((t) => typeof t.liveWaiverRank === "number");
    const liveHow = pre4c ? "the dump's own ranks (ESPN's order on the day of the import), now Team.liveWaiverRank, in place of waiverRank" : "the data's Team.liveWaiverRank (ESPN's order on the day of the import) in place of waiverRank";
    if (hasLive) live = of(liveHow, build(withRanks(snapshot, (id) => snapshot.teams.find((t) => t.id === id)?.liveWaiverRank)));
    else liveMissing = "the data has no live order (Team.liveWaiverRank)";
  } else if (used === "pre4c") {
    // A dump from before the 4c adapter that the caller didn't put on the 4c rule (buildTradeReport always does).
    live = of("the data's own: its waiver ranks, ESPN's order on the day of the import (a dump from before the 4c adapter)", model);
    resetMissing = "the dump comes from before the 4c adapter and wasn't put on its rule (league-report's asWeeklyResetData)";
  } else if (used === "live") {
    live = of(pre4c ? "the dump's own (no game had been played: no standings to reset to)" : "the data's own (the league doesn't reset its order weekly)", model);
    resetMissing = pre4c ? "no game had been played: no standings to reset to" : "the league doesn't reset its waiver order weekly";
  } else {
    resetMissing = used === "faab" ? "a FAAB league: free agents go by budget left" : "the data has no waiver order";
    liveMissing = resetMissing;
  }
  const head = reset?.model ?? model;
  const weeks = (head.odds?.weekly ?? []).filter((w) => w.games.some((g) => g.teamId === me));
  const sim = tradeInternals(ctx).sim;
  const reverse = resetWaiverOrder(model);
  return {
    data,
    reset,
    resetMissing,
    live,
    liveMissing,
    stand: oddsOf(model.oddsAsRostersStand, me),
    weekly: weeks.map((w) => ({
      week: w.week,
      opponentId: myGame(head.odds, w.week, me)?.opponentId ?? null,
      reset: myGame(head.odds, w.week, me)?.pWin ?? null,
      stand: myGame(model.oddsAsRostersStand, w.week, me)?.pWin ?? null,
      live: live ? (myGame(live.model.odds, w.week, me)?.pWin ?? null) : null,
    })),
    baselineEqual: model.odds ? JSON.stringify(sim?.odds ?? null) === JSON.stringify(model.odds) : null,
    resetMatchesStandings: used === "weeklyReset" && reverse ? reverse.length === (reset?.order.length ?? -1) && reverse.every((id, i) => id === reset?.order[i]) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Section 8: anything else

export interface AnchorRow {
  name: string;
  planner: number;
  computed: number;
  diff: number;
  pass: boolean;
}

/** A partner without trade history at activity `a` and `pPlayoffs` playoff odds (0.4: no season context). */
function anchorProfile(a: number, pPlayoffs: number): PartnerProfile {
  return {
    teamId: "P",
    activity: { a, rule: a === 1 ? "active" : a === -2 ? "inactive" : a === -1 ? "quiet" : "normal", trades: 0, recentTrades: 0, transactions: 0, lastWeek: null },
    history: { hist: null, average: null, trades: 0, used: 0, skipped: 0, perTrade: [] },
    pPlayoffs,
  };
}

const ANCHOR_LEAGUE: AcceptanceLeague = { leagueType: "redraft", tradeReview: "none" };
const DYNASTY_ANCHOR_LEAGUE: AcceptanceLeague = { leagueType: "dynasty", tradeReview: "none" };
/** Playoff odds of a partner with no season context, and of a contender (above config.acceptance.context.contenderAbove). */
const NEUTRAL_PLAYOFFS = 0.4;
const CONTENDER_PLAYOFFS = 0.7;

/** §11's anchors through acceptance() itself (a league without trade review, redraft unless the scenario says dynasty; a partner with no history and 40% playoff odds). */
export function anchorRows(): AnchorRow[] {
  return ANCHORS.map((s) => {
    const r = acceptance(s.dynasty ? DYNASTY_ANCHOR_LEAGUE : ANCHOR_LEAGUE, anchorProfile(s.a ?? 0, NEUTRAL_PLAYOFFS), { gPartner: s.g ?? 0, deltaLineup: (s.n ?? 0) * config.acceptance.nScale, h: s.h ?? 0, assets: (s.c ?? 0) + 2, partnerReceives: [] });
    const computed = 100 * r.pAccept;
    return { name: s.name, planner: s.percent, computed, diff: computed - s.percent, pass: Math.abs(computed - s.percent) <= ANCHOR_TOLERANCE };
  });
}

/** The star premium's anchors (PREMIUM_ANCHORS) through the real functions, as src/engine/acceptance.test.ts builds them. */
export function premiumAnchorRows(): AnchorRow[] {
  const W = PREMIUM_ANCHOR_W;
  const values: Record<string, number> = { star: 9000, you9000: 9000, p2: 5000, p3: 4000, p4: 3000, p5: 2500, p6: 2000, p7: 1000, best: 5000, b2: 3000, you2000: 2000, you5000: 5000, you6500: 6500, r4000: 4000, r3500a: 3500, r3500b: 3500 };
  for (let i = 1; i <= 10; i++) values[`x${String(i).padStart(2, "0")}`] = 9000 + 100 * i;
  const market: MarketInputs = { format: { isDynasty: false, numQbs: 1, numTeams: 10, ppr: 0.5, substitutions: [] }, fetchedAt: "2026-10-01T00:00:00.000Z", values, knownIds: Object.keys(values), topValue: Math.max(...Object.values(values)) };
  const elite = eliteIds(market);
  const rosters: Record<"A" | "B", string[]> = { A: ["star", "p2", "p3", "p4", "p5", "p6", "p7"], B: ["best", "b2"] };
  return PREMIUM_ANCHORS.map((s) => {
    const pPlayoffs = s.contender ? CONTENDER_PLAYOFFS : NEUTRAL_PLAYOFFS;
    const premiums = teamPremiums({ players: rosters[s.partner].map((id) => ({ id, value: values[id] ?? 0, ros: 0 })), elite, leagueType: "redraft", pPlayoffs });
    const gPartner = tradePackage({ players: s.recv }, { players: s.give }, values, W).g;
    const gPerceived = perceivedPackage({ players: s.recv }, { players: s.give }, values, W, (id) => premiums[id]?.e ?? 0).g;
    const input: TradeAcceptanceInput = { gPartner, gPerceived, deltaLineup: (s.n ?? 0) * config.acceptance.nScale, h: s.h ?? 0, assets: s.recv.length + s.give.length, partnerReceives: [] };
    const computed = 100 * acceptance(ANCHOR_LEAGUE, anchorProfile(0, pPlayoffs), input).pAccept;
    return { name: s.name, planner: s.percent, computed, diff: computed - s.percent, pass: Math.abs(computed - s.percent) <= ANCHOR_TOLERANCE };
  });
}

/**
 * A shown card with a neutral throw-in (market.neutralThrowIns: on the side moving more players, up to the difference in
 * player counts, its lowest-valued players worth at most W; then matched pairs of such players, one from each side).
 */
export interface NeutralCard {
  rank: number;
  trade: TradeEvaluation;
  /** The throw-ins left out of the trade-value sums, with their values. */
  removed: { id: string; value: number }[];
  /** The same trade without them (the Analyzer), or null when a side would be empty; or why it can't be made. */
  lean: TradeEvaluation | null;
  leanIllegal: string | null;
  /** Where the lean version stands in the search (its state): its card's place, a finalist, evaluated exactly. */
  leanStatus: { card: number | null; finalist: boolean; exact: boolean } | null;
  /**
   * The expected gain of the card and of the lean version (expectedGain: B × P_complete, what Overall scales; review of
   * track R, R-1: compared unrounded, since the cards' rounded numbers hid the lean version's edge).
   */
  eg: { card: number | null; lean: number | null };
}

/** §13's expected gain, EG = B × P_complete (Overall is round(100 × (1 − e^(−EG / B₃))) when B > 0); null when B is unknown. */
export function expectedGain(t: Pick<TradeEvaluation, "b" | "pComplete">): number | null {
  return finite(t.b) && finite(t.pComplete) ? t.b * t.pComplete : null;
}

/** Every shown card with a neutral throw-in (planner change 2), and its lean version's numbers and place in the search (section 8). */
export function neutralCards(ctx: TradeContext, result: TradeSearchResult, settings: TradeSettings): NeutralCard[] {
  const I = tradeInternals(ctx);
  const state = searchStateOf(result);
  return result.trades.flatMap((t, i): NeutralCard[] => {
    const give = playerIds(t.proposal.give);
    const get = playerIds(t.proposal.get);
    const removed = neutralThrowIns(get, give, I.values, I.credit).removed;
    if (!removed.length) return [];
    const leanGive = give.filter((id) => !removed.includes(id));
    const leanGet = get.filter((id) => !removed.includes(id));
    const proposal: TradeProposal = { partnerId: t.proposal.partnerId, give: asPlayers(leanGive), get: asPlayers(leanGet) };
    const a = leanGive.length && leanGet.length ? analyzeTrade(ctx, proposal, { settings }) : null;
    const key = proposalKey(proposal);
    const card = result.trades.findIndex((x) => x.key === key);
    const leanStatus = a && state ? { card: card >= 0 ? card + 1 : null, finalist: rankedFinals(state).some((f) => f.key === key), exact: state.exactByKey.has(key) } : null;
    const lean = a?.evaluation ?? null;
    return [{ rank: i + 1, trade: t, removed: removed.map((id) => ({ id, value: I.values[id] ?? 0 })), lean, leanIllegal: a?.illegal ?? null, leanStatus, eg: { card: expectedGain(t), lean: lean ? expectedGain(lean) : null } }];
  });
}

/** The headline odds 1 ms either side of the week's first kickoff (section 8): mine both ways, and the largest move over the teams. */
export interface KickoffJump {
  week: number;
  kickoff: string;
  mine: { before: TeamOdds | null; after: TeamOdds | null };
  /** The largest |Δ P(playoffs)| and |Δ P(title)| over the teams: the headline (with pickups), and as rosters stand. */
  headline: { teamId: string | null; dPO: number; dCH: number };
  stand: { dPO: number; dCH: number };
}

export function kickoffJump(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: { settings: TradeSettings; scenarios?: number }): KickoffJump | null {
  const week = snapshot.currentWeek;
  const k = firstKickoff(inputs.nfl, week);
  if (k === null) return null;
  const build = (t: number) => buildLeagueModel(snapshot, inputs, { now: new Date(t), settings: opts.settings, ...(opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {}) });
  const before = build(k - 1);
  const after = build(k + 1);
  const most = (a: SeasonOdds | null | undefined, b: SeasonOdds | null | undefined) => {
    let out = { teamId: null as string | null, dPO: 0, dCH: 0 };
    for (const t of a?.teams ?? []) {
      const u = oddsOf(b, t.teamId);
      if (!u) continue;
      const dPO = Math.abs(u.pPlayoffs - t.pPlayoffs);
      const dCH = t.pTitle !== null && u.pTitle !== null ? Math.abs(u.pTitle - t.pTitle) : 0;
      if (dPO > out.dPO + EPS) out = { teamId: t.teamId, dPO, dCH: Math.max(out.dCH, dCH) };
      else out = { ...out, dCH: Math.max(out.dCH, dCH) };
    }
    return out;
  };
  const stand = most(before.oddsAsRostersStand, after.oddsAsRostersStand);
  return { week, kickoff: new Date(k).toISOString(), mine: { before: oddsOf(before.odds, before.myTeamId), after: oddsOf(after.odds, after.myTeamId) }, headline: most(before.odds, after.odds), stand: { dPO: stand.dPO, dCH: stand.dCH } };
}

/** A week where every team's pickups move my win chance (section 8): both chances, both teams' projected points both ways, and the pickups. */
export interface PickupWeek {
  week: number;
  opponentId: string;
  withPickups: number;
  asStands: number;
  mine: { stand: number; pickups: number };
  theirs: { stand: number; pickups: number };
  myMoves: FaMove[];
  theirMoves: FaMove[];
}

/** The `n` weeks where my win chance with pickups differs most from as rosters stand (at least weeklyLineMin), in week order. */
export function pickupWeeks(model: LeagueModel, n = PICKUP_WEEKS_SHOWN): PickupWeek[] {
  const me = model.myTeamId;
  const team = (id: string | null) => model.teams.find((t) => t.id === id);
  const at = (id: string | null, wi: number, which: "score" | "scoreWithPickups") => {
    const t = team(id);
    const s = which === "score" ? t?.score : (t?.scoreWithPickups ?? t?.score);
    return s?.mean[wi] ?? Number.NaN;
  };
  const rows = (model.odds?.weekly ?? []).flatMap((w): PickupWeek[] => {
    const g = myGame(model.odds, w.week, me);
    const s = myGame(model.oddsAsRostersStand, w.week, me);
    const wi = model.weeks.indexOf(w.week);
    if (!g || !s || g.opponentId === null || !finite(g.pWin) || !finite(s.pWin) || wi < 0) return [];
    if (Math.abs(g.pWin - s.pWin) < config.explain.weeklyLineMin - EPS) return [];
    return [{ week: w.week, opponentId: g.opponentId, withPickups: g.pWin, asStands: s.pWin, mine: { stand: at(me, wi, "score"), pickups: at(me, wi, "scoreWithPickups") }, theirs: { stand: at(g.opponentId, wi, "score"), pickups: at(g.opponentId, wi, "scoreWithPickups") }, myMoves: [...(team(me)?.faMoves ?? [])], theirMoves: [...(team(g.opponentId)?.faMoves ?? [])] }];
  });
  return rows
    .sort((a, b) => Math.abs(b.withPickups - b.asStands) - Math.abs(a.withPickups - a.asStands) || a.week - b.week)
    .slice(0, Math.max(0, n))
    .sort((a, b) => a.week - b.week);
}

// ---------------------------------------------------------------------------------------------
// Section 9: open roster spots (planner reply to Checkpoint 7b, section 5)

/** A trade on either list (or this search's finalists) that opens my roster spot, with the Analyzer's evaluation under each rule. */
export interface OpenSpotRow {
  key: string;
  proposal: TradeProposal;
  /** Its card number under Checkpoint 7b's rule (that rule's own search) and now (null: not a card there); a finalist now. */
  card: { before: number | null; now: number | null };
  finalist: boolean;
  /** analyzeTrade on Checkpoint 7b's rule's context and on the report's (null: illegal there). */
  before: TradeEvaluation | null;
  now: TradeEvaluation | null;
}

/** Every exact trade of the search that opens my spot, grouped by what's short and my pickup under each rule. */
export interface OpenSpotGroup {
  /** The positions the spots fill now ("RB", "RB + WR"), "any position (no TE allowed)" for a fallback. */
  short: string;
  /** My fills: Checkpoint 7b's rule's and now ("Malik Washington (WR)"; "illegal" when that rule can't make the trade). */
  before: string;
  now: string;
  trades: number;
}

/** A shown card whose partner gets an open spot (the planner: "Both teams"): the card now and the Analyzer's evaluation under Checkpoint 7b's rule. */
export interface PartnerSpotRow {
  rank: number;
  trade: TradeEvaluation;
  before: TradeEvaluation | null;
  /**
   * Its fill now is one of my own baseline pickups and it claims before me, so my V*(after) can't make that pickup: the
   * engine's OpenSpot.yours, which the card says too (review of Phase 7c's fill, finding pickups-5: one of my pickups alone
   * isn't enough, a partner claiming after me takes only one my V*(after) no longer wants).
   */
  takesMine: boolean;
}

export interface OpenSpotSection {
  /** Checkpoint 7b's rule's own search (TradeContextOptions.openSpotFill "bestAny", its own context): its card count. */
  beforeCards: number;
  rows: OpenSpotRow[];
  /** The search's exact trades, and those that open my spot. */
  exact: number;
  exactMine: number;
  groups: OpenSpotGroup[];
  partner: PartnerSpotRow[];
  /**
   * Every side with a fill in the search's exact trades: sides, spots, fills at a position given up and fallbacks, and the
   * sides whose V*(after) would drop a fill without the keep set (`unkept`) and with it (`kept`: the rule, 0).
   */
  fills: { sides: number; spots: number; same: number; fallback: number; unkept: number; kept: number };
}

/** Section 9's finalists not on either list, listed at most (a line budget; this search's finalists in its own order). */
export const OPEN_SPOT_FINALISTS = 6;

/** "Malik Washington (WR)": a fill (or several, joined with "+"), "none" for none. */
function spotNames(snapshot: LeagueSnapshot, spots: readonly OpenSpot[] | undefined): string {
  return spots?.length ? spots.map((s) => `${nameOf(snapshot, s.playerId)} (${snapshot.players[s.playerId]?.pos ?? "?"})`).join(" + ") : "none";
}

/** What a fill fills: its position, or "any position" for a fallback, with the positions none could fill. */
function spotShort(spots: readonly OpenSpot[]): string {
  return spots.map((s) => (s.pos !== null ? s.pos : `any position${s.short?.length ? ` (no ${s.short.join(", ")} allowed)` : ""}`)).join(" + ");
}

/**
 * Section 9 (the file header): Checkpoint 7b's rule on its own context (openSpotFill "bestAny") and its own search; the
 * trades on either list (cards) and this search's finalists (up to OPEN_SPOT_FINALISTS more) that open my spot, each through
 * the Analyzer under both rules (the cards' own numbers: the final block); every exact trade of this search that opens my
 * spot, grouped (its Checkpoint 7b fill from evaluateExact on that rule's context, no simulation); the shown cards whose
 * partner gets a spot; and every side's fills in the exact trades, with V*(after) run again without the keep set.
 */
export function openSpotSection(snapshot: LeagueSnapshot, inputs: ModelInputs, ctx: TradeContext, result: TradeSearchResult, settings: TradeSettings, opts: { now: Date; scenarios?: number }): OpenSpotSection {
  const I = tradeInternals(ctx);
  const sc = opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {};
  const before = buildTradeContext(snapshot, inputs, { now: opts.now, settings, ...sc, openSpotFill: "bestAny" });
  const beforeResult = runTradeSearch(before, { settings });
  const state = searchStateOf(result);
  const opens = (e: Pick<TradeEvaluationCore, "required">) => (e.required.me.openSpots?.length ?? 0) > 0;
  const rank = (r: TradeSearchResult, key: string) => {
    const i = r.trades.findIndex((t) => t.key === key);
    return i < 0 ? null : i + 1;
  };
  // This list's cards, Checkpoint 7b's rule's cards, then this search's finalists (the ranking's: Checkpoint 7c's "Helps
  // both" extras left out, rankedFinals), each once.
  const picked = new Map<string, TradeProposal>();
  for (const t of result.trades) if (opens(t)) picked.set(t.key, t.proposal);
  for (const t of beforeResult.trades) if (opens(t) && !picked.has(t.key)) picked.set(t.key, t.proposal);
  const ranked = rankedFinals(state);
  let extra = 0;
  for (const f of ranked) {
    if (extra >= OPEN_SPOT_FINALISTS || !opens(f) || picked.has(f.key)) continue;
    picked.set(f.key, f.proposal);
    extra++;
  }
  const finals = new Set(ranked.map((f) => f.key));
  const rows: OpenSpotRow[] = [...picked].map(([key, proposal]) => ({
    key,
    proposal,
    card: { before: rank(beforeResult, key), now: rank(result, key) },
    finalist: finals.has(key),
    before: analyzeTrade(before, proposal, { settings }).evaluation,
    now: analyzeTrade(ctx, proposal, { settings }).evaluation,
  }));
  // Every exact trade that opens my spot, grouped; every side's fills, with V*(after) again without the keep set.
  const bI = tradeInternals(before);
  const maxPerSide = Math.max(settings.maxPerSide, config.search.analyzerMaxPerSide);
  const groups = new Map<string, OpenSpotGroup>();
  const fills = { sides: 0, spots: 0, same: 0, fallback: 0, unkept: 0, kept: 0 };
  const me = I.me;
  for (const x of state?.exactByKey.values() ?? []) {
    const now = x.evaluation.required.me.openSpots ?? [];
    if (now.length) {
      const b = evaluateExact(bI, x.evaluation.proposal, maxPerSide);
      const was = "illegal" in b ? "illegal" : spotNames(snapshot, b.evaluation.required.me.openSpots);
      const g = { short: spotShort(now), before: was, now: spotNames(snapshot, now) };
      const k = `${g.short}\u0000${g.before}\u0000${g.now}`;
      const at = groups.get(k);
      if (at) at.trades++;
      else groups.set(k, { ...g, trades: 1 });
    }
    if (!me) continue;
    const give = playerIds(x.evaluation.proposal.give);
    const get = playerIds(x.evaluation.proposal.get);
    const after = tradeSides(I, me, x.partner, give, get, `Team ${x.partner.id}`);
    if ("illegal" in after) continue;
    for (const [side, legal, run, pool] of [
      [me, after.mineLegal, after.mine, after.pools.mine],
      [x.partner, after.theirLegal, after.theirs, after.pools.theirs],
    ] as const) {
      const spots = legal.change.openSpots ?? [];
      if (!spots.length) continue;
      fills.sides++;
      fills.spots += spots.length;
      fills.same += spots.filter((s) => s.pos !== null).length;
      fills.fallback += spots.filter((s) => s.pos === null).length;
      if (spots.some((s) => !run.roster.includes(s.playerId))) fills.kept++;
      const unkept = side.inactive ? run : I.league.optimizer.optimize(legal.roster, legal.spec, undefined, pool);
      if (spots.some((s) => !unkept.roster.includes(s.playerId))) fills.unkept++;
    }
  }
  const partner: PartnerSpotRow[] = result.trades.flatMap((t, i) =>
    t.required.partner.openSpots?.length ? [{ rank: i + 1, trade: t, before: analyzeTrade(before, t.proposal, { settings }).evaluation, takesMine: t.required.partner.openSpots.some((s) => s.yours === true) }] : [],
  );
  return {
    beforeCards: beforeResult.trades.length,
    rows,
    exact: state?.exactByKey.size ?? 0,
    exactMine: [...(state?.exactByKey.values() ?? [])].filter((x) => opens(x.evaluation)).length,
    groups: [...groups.values()].sort((a, b) => b.trades - a.trades || (a.short < b.short ? -1 : a.short > b.short ? 1 : 0) || (a.now < b.now ? -1 : a.now > b.now ? 1 : 0)),
    partner,
    fills,
  };
}

// ---------------------------------------------------------------------------------------------
// Section 10: Helps both (planner reply to Checkpoint 7b, §7)

/** The "Helps both" list's cards section 10 shows (the planner: "his top 5 under the new sort"). */
export const HELPS_BOTH_SHOWN = 5;

/**
 * One search's trades that help both teams at each stage (section 10; benefit.helpsBoth: Helps you above 0 and Helps them at
 * least config.benefit.helpsThemMin, both as printed), read off its state: the exact trades on their screening numbers (the
 * run the extras are chosen on), the extras (search.ts finalistsOf: the first config.search.helpsBothFinalists by B among
 * those that help both and that the §10 guards don't hide, the ones the ranking hadn't picked already), the finalists the
 * ranking picked and the extras on their final numbers, the Overall cards, and the "Helps both" list.
 */
export interface HelpsBothCounts {
  /**
   * The exact trades on the screening run: Helps you above 0 (as printed), the partner's B above 0, Helps them at least the
   * minimum, both (helpsBoth), and of those the ones the §10 guards don't hide (the extras' pool).
   */
  exact: { total: number; helpsYou: number; theirB: number; helpsThem: number; both: number; shown: number };
  /** The pool's first helpsBothFinalists, how many of those the ranking had already picked, the extras, and the extras that still help both on the final run. */
  pool: number;
  picked: number;
  extras: number;
  stillBoth: number;
  /** The finalists the ranking picked (the extras left out) and the Overall cards, each with those that help both on their final numbers (the cards' tag). */
  finalists: { total: number; both: number };
  cards: { total: number; both: number };
  /** TradeSearchResult.helpsBoth, with how many of its cards the Overall list shows too and how many are extras. */
  list: HelpsBothList;
  onOverall: number;
  fromExtras: number;
}

/** A search's HelpsBothCounts; null when it stopped before ranking (no state, no list). */
export function helpsBothCounts(result: TradeSearchResult): HelpsBothCounts | null {
  const state = searchStateOf(result);
  const list = result.helpsBoth;
  if (!state || !list) return null;
  const min = config.benefit.helpsThemMin;
  const screen = [...state.exactByKey.keys()].flatMap((k) => {
    const c = state.versions.get(k)?.screen;
    return c ? [c] : [];
  });
  const shown = screen.filter((c) => helpsBoth(c) && !c.flags.hiddenByMarket).length;
  const pool = Math.min(shown, Math.max(0, Math.floor(config.search.helpsBothFinalists)));
  const extras = new Set(state.helpsBothExtras);
  const regular = state.finals.filter((f) => !extras.has(f.key));
  const overall = new Set(result.trades.map((t) => t.key));
  return {
    exact: {
      total: screen.length,
      helpsYou: screen.filter((c) => finite(c.tradeScore) && c.tradeScore > 0).length,
      theirB: screen.filter((c) => finite(c.them?.b) && (c.them?.b as number) > 0).length,
      helpsThem: screen.filter((c) => finite(c.them?.helps) && (c.them?.helps as number) >= min).length,
      both: screen.filter((c) => helpsBoth(c)).length,
      shown,
    },
    pool,
    picked: pool - extras.size,
    extras: extras.size,
    stillBoth: state.finals.filter((f) => extras.has(f.key) && helpsBoth(f)).length,
    finalists: { total: regular.length, both: regular.filter((f) => helpsBoth(f)).length },
    cards: { total: result.trades.length, both: result.trades.filter((t) => helpsBoth(t)).length },
    list,
    onOverall: list.trades.filter((t) => overall.has(t.key)).length,
    fromExtras: list.trades.filter((t) => extras.has(t.key)).length,
  };
}

/**
 * Section 10's extra runtime (the file header): section 4's runs (`main`: the app's search, its first run the only cold
 * search in the process) against the same search without "Helps them" (`without`: withoutHelpsThem, one warm run right after
 * each of the timed ones, each on its own context: timedSearches' pairedWithout).
 */
export interface HelpsBothCost {
  /** The partner calibration runs and the extras' final runs, each read off its run's progress (helpsBothParts): section 4's cold run and the median of its timed runs. */
  calibrations: { count: number; cold: number | null; warm: number | null };
  extras: { count: number; cold: number | null; warm: number | null };
  /** The second list's own work (its ranking, steps, Plan B and words), warm only: the ranking stage (rank + steps) with Helps them less without, medians (⚠️ a difference of medians). */
  secondList: number | null;
  /** What Helps both adds to a search: the three parts (cold: the cold run's own calibration and extra runs and the warm second list, ⚠️). */
  extra: { cold: number | null; warm: number | null };
  /**
   * The search's total (TradeSearchResult.timings.total) with Helps them (section 4's cold run and warm median), and without
   * it: ⚠️ the same runs less the extra. A process has one first search, and a difference of warm medians carries the
   * run-to-run noise of the stages Helps them doesn't touch too (UNTOUCHED_STAGES: about 4 s of Parker's 5.8 s search), so
   * the runs without it are given as measured beside these (`measured`).
   */
  with: { cold: number | null; warm: number | null };
  without: { cold: number | null; warm: number | null };
  /**
   * The runs without Helps them as measured: their median search total, and the largest spread within either set of timed
   * runs (the largest less the smallest), of the search totals and of the stages Helps them doesn't touch (UNTOUCHED_STAGES,
   * summed per run), the noise a difference of the two medians carries; a spread is null without 2 timed runs in a set
   * (review of the report track, HBR-1: one run read "0.0 ms").
   */
  measured: { without: number | null; spread: number | null; untouched: number | null };
}

/**
 * The search's stages "Helps them" doesn't touch (search.ts: the partner calibration runs come in the screening
 * simulation's stage, the extras' final runs in the final simulation's, the second list in the ranking's and the steps'),
 * as TradeSearchResult.timings names them; helpsBothCost's `measured.untouched`.
 */
export const UNTOUCHED_STAGES = ["setup", "screening", "exact"] as const;

export function helpsBothCost(main: Runtime, without: Runtime): HelpsBothCost {
  const warm = (rows: readonly RuntimeRun[], f: (r: RuntimeRun) => number | null | undefined): number | null => {
    const xs = rows.map(f).filter(finite);
    return xs.length ? median(xs) : null;
  };
  // The largest less the smallest within one set, from 2 timed runs on; the larger of the two sets'.
  const spreadOf = (rows: readonly RuntimeRun[], f: (r: RuntimeRun) => number | null | undefined): number | null => {
    const xs = rows.map(f).filter(finite);
    return xs.length >= 2 ? Math.max(...xs) - Math.min(...xs) : null;
  };
  const largest = (f: (r: RuntimeRun) => number | null | undefined): number | null => {
    const xs = [spreadOf(main.runs, f), spreadOf(without.runs, f)].filter(finite);
    return xs.length ? Math.max(...xs) : null;
  };
  const untouched = (r: RuntimeRun): number | null => (UNTOUCHED_STAGES.every((k) => finite(r.search[k])) ? UNTOUCHED_STAGES.reduce((acc, k) => acc + (r.search[k] as number), 0) : null);
  const sum = (xs: readonly (number | null)[]): number | null => (xs.every(finite) ? xs.reduce((s: number, x) => s + (x as number), 0) : null);
  const rankSteps = (r: RuntimeRun): number => (r.search.rank ?? 0) + (r.search.steps ?? 0);
  const withRank = warm(main.runs, rankSteps);
  const withoutRank = warm(without.runs, rankSteps);
  const secondList = finite(withRank) && finite(withoutRank) ? withRank - withoutRank : null;
  const cold = main.cold.parts;
  const calibrations = { count: cold?.calibrations.count ?? 0, cold: cold?.calibrations.ms ?? null, warm: warm(main.runs, (r) => r.parts?.calibrations.ms) };
  const extras = { count: cold?.extras.count ?? 0, cold: cold?.extras.ms ?? null, warm: warm(main.runs, (r) => r.parts?.extras.ms) };
  const extra = { cold: sum([calibrations.cold, extras.cold, secondList]), warm: sum([calibrations.warm, extras.warm, secondList]) };
  const withTotal = { cold: finite(main.cold.search.total) ? (main.cold.search.total as number) : null, warm: warm(main.runs, (r) => r.search.total) };
  const less = (a: number | null, b: number | null): number | null => (finite(a) && finite(b) ? a - b : null);
  return {
    calibrations,
    extras,
    secondList,
    extra,
    with: withTotal,
    without: { cold: less(withTotal.cold, extra.cold), warm: less(withTotal.warm, extra.warm) },
    measured: { without: warm(without.runs, (r) => r.search.total), spread: largest((r) => r.search.total), untouched: largest(untouched) },
  };
}

/** A measured time against another, with its own sign: "91 ms under", "12 ms over", "the same as" (review of the report track, HBR-1). */
const underOver = (x: number): string => (x < 0 ? `${ms(-x)} under` : x > 0 ? `${ms(x)} over` : "the same as");

/**
 * Section 10's sentence on the runs without "Helps them" as measured (review of the report track, HBR-1: it printed the
 * difference with the wrong sign and a cause it never computed): their median search total against section 4's warm one, with
 * its own sign ("91 ms under section 4's 5.81 s"), then each set's run-to-run spread, of the search totals and of the stages
 * Helps them doesn't touch alone (UNTOUCHED_STAGES), the noise their difference carries; with one timed run a set, no spread.
 * "" when nothing was measured.
 */
export function measuredRunsText(c: Pick<HelpsBothCost, "with" | "measured">): string {
  const m = c.measured;
  if (!finite(m.without)) return "";
  const against = finite(c.with.warm) ? `, ${underOver(m.without - c.with.warm)} section 4's ${ms(c.with.warm)}` : "";
  const noise = finite(m.spread)
    ? `, but each set's search totals spread over up to ${ms(m.spread)} from run to run${finite(m.untouched) ? `, setup, screening and exact evaluation alone (which Helps them doesn't touch) over up to ${ms(m.untouched)}` : ""}`
    : ", from one timed run a set (no spread from run to run)";
  return `The runs without it measured ${ms(m.without)} (median)${against}${noise}, so the totals without are section 4's less the three parts.`;
}

/** Section 10 (the file header). */
export interface HelpsBothSection {
  /** Each setting's search: section 1's (the default goal) and section 2's (the split, on its own context). */
  counts: { title: HelpsBothCounts | null; other: HelpsBothCounts | null };
  /** The split's top-N odds line (tradeView.topPlacesOf on section 2's reward: "Top 3 odds" when the split pays 3rd place). */
  places: 2 | 3 | null;
  /** Each other team's "Helps them" scale under the split (evaluate.partnerScaleOf on section 2's context), in the snapshot's order. */
  scales: { teamId: string; scale: PartnerScale | null }[];
  cost: HelpsBothCost;
  /** The runs without Helps them (helpsBothCost's `without`), and in the last one the extras, the second list's cards and the calibration runs made (none of each). */
  without: { runtime: Runtime; extras: number; list: number; calibrated: number };
  /**
   * Section 4's last run's Overall list against the last run without Helps them, card by card, each stripped of its `them`:
   * the cards that differ (none: the same cards, numbers, steps, boxes and words, as the engine's own test pins), each with
   * whether it helps both (such a card offers first, and gets a box, only versions that help both too).
   */
  differs: { key: string; helpsBoth: boolean }[];
}

/** Section 10: the counts under each setting, the split's scales, and the extra runtime against the search without Helps them. */
export function helpsBothSection(main: { result: TradeSearchResult; runtime: Runtime }, goals: GoalCompare, without: { ctx: TradeContext; result: TradeSearchResult; runtime: Runtime }): HelpsBothSection {
  const split = searchStateOf(goals.result);
  const I = split?.I ?? null;
  const scales = I ? I.teams.filter((t) => t.id !== I.me?.id).map((t) => ({ teamId: t.id, scale: partnerScaleOf(I, t, goals.reward) })) : [];
  const plain = (t: TradeEvaluation): string => JSON.stringify({ ...t, them: undefined });
  const other = without.result.trades;
  const differs = main.result.trades.flatMap((t, i) => (other[i] && plain(other[i] as TradeEvaluation) === plain(t) ? [] : [{ key: t.key, helpsBoth: helpsBoth(t) }]));
  for (const t of other.slice(main.result.trades.length)) differs.push({ key: t.key, helpsBoth: false });
  const memo = tradeInternals(without.ctx).sim?.partners;
  return {
    counts: { title: helpsBothCounts(main.result), other: helpsBothCounts(goals.result) },
    places: topPlacesOf(goals.reward),
    scales,
    cost: helpsBothCost(main.runtime, without.runtime),
    without: {
      runtime: without.runtime,
      extras: searchStateOf(without.result)?.helpsBothExtras.length ?? 0,
      list: without.result.helpsBoth?.trades.length ?? 0,
      calibrated: [...(memo?.values() ?? [])].filter((x) => x !== null).length,
    },
    differs,
  };
}

// ---------------------------------------------------------------------------------------------
// The report

export interface TradeReportOptions {
  now: Date;
  clock: () => number;
  /** "offline" (a dump) or "live" (through the app's caches); and a line saying where the data came from. */
  mode: "offline" | "live";
  dataNote: string;
  /** When the report is written (the header's date). Default: `now`. */
  generatedAt?: Date;
  /** Availability scenarios (default config.lineups.scenarios). */
  scenarios?: number;
  /** Timed runs and warm-ups (default SEARCH_RUNS, SEARCH_WARMUPS), for the League model, the search and the beams alone. */
  runs?: number;
  warmups?: number;
  /** The command line the header prints (runMode.reportCommandText; default: the script, with --live when live). */
  command?: string;
  /** Timings of the stages before the engine (live: the crosswalk, the import, the model inputs). */
  timing?: Record<string, number>;
  /**
   * Checkpoint 7c: the league's prizes (--prizes; scripts/lib/runMode.ts prizesArg), which "Several prizes" reads in sections
   * 2, 3 and 10 (prizesSettingsOf; section 10 reads section 2's search); without them, the prefilled split.
   */
  prizes?: PrizeAmounts | null;
}

export interface TradeReport {
  doc: string;
  /** The snapshot every section ran on: the one given, or a dump from before the 4c adapter put on the 4c rule (`pre4c`: league-report's asWeeklyResetData). */
  snapshot: LeagueSnapshot;
  pre4c: Pre4cOrder | null;
  settings: TradeSettings;
  /** Checkpoint 7c: the league's prizes the report was given (--prizes), or null (sections 2, 3 and 10 on the prefilled split). */
  prizes: PrizeAmounts | null;
  ctx: TradeContext;
  result: TradeSearchResult;
  model: LeagueModel;
  league: { cold: number; warm: number };
  runtime: Runtime;
  beams: { result: TradeSearchResult; runtime: Runtime };
  goals: GoalCompare;
  scale: HelpsScaleSection;
  gap: SearchGap;
  filter: FilterRow[] | null;
  blend: BlendReport;
  odds: OddsReport;
  anchors: AnchorRow[];
  premiumAnchors: AnchorRow[];
  neutral: NeutralCard[];
  kickoff: KickoffJump | null;
  pickupWeeks: PickupWeek[];
  openSpots: OpenSpotSection;
  helpsBoth: HelpsBothSection;
  /** This report's own stages, ms ("total": everything buildTradeReport did). */
  timing: Record<string, number>;
}

/**
 * Everything after the network (the file header): the searches, the checks and the markdown, not yet scrubbed.
 * `input` must already carry placeholders (league-report's placeholders()); a dump from before the 4c adapter is put on
 * the 4c rule first (league-report's asWeeklyResetData), so every section runs on the order the app now uses.
 */
export function buildTradeReport(input: LeagueSnapshot, inputs: ModelInputs, opts: TradeReportOptions): TradeReport {
  const { snapshot, pre4c } = asWeeklyResetData(input);
  const settings = normalizeTradeSettings(defaultTradeSettings());
  const { now, clock } = opts;
  const sc = opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {};
  const runOpts: SearchRunOptions = { now, clock, settings, runs: opts.runs ?? SEARCH_RUNS, warmups: opts.warmups ?? SEARCH_WARMUPS, ...sc };
  const timing: Record<string, number> = {};
  const start = clock();
  let last = start;
  const lap = (stage: string) => {
    const t = clock();
    timing[stage] = t - last;
    last = t;
  };
  const league = leagueBuilds(snapshot, inputs, runOpts);
  lap("league");
  // Section 4's runs, each timed one followed by the same search without "Helps them" (section 10; withoutHelpsThem).
  const { ctx, result, runtime, without: paired } = timedSearches(snapshot, inputs, { ...runOpts, pairedWithout: true });
  const without = paired as NonNullable<typeof paired>;
  lap("searches");
  const beams = timedSearches(snapshot, inputs, { ...runOpts, warmups: 0, exhaustive: false });
  lap("beams");
  // Section 2 (Checkpoint 7c): the app's search under "Several prizes" on the league's split (--prizes), on the trade context
  // it builds under it (its own ω, pickups and baseline; the weekly high scores simulated when the split pays them); timed, so
  // section 10 reads its "Helps both" parts too.
  const prizesSettings = prizesSettingsOf(settings, opts.prizes);
  const prizesCtx = buildTradeContext(snapshot, inputs, { now, settings: prizesSettings, ...sc });
  const goals = goalCompare(ctx, result, settings, { ctx: prizesCtx, settings: prizesSettings }, TOP_DETAIL, clock);
  lap("goals");
  // Section 3: each goal's B₃ off the context the app builds under that goal (its own ω; helpsScaleSection), "Several
  // prizes" section 2's.
  const scale = helpsScaleSection(snapshot, league.model, ctx, settings, (goal) => (goal === COMPARE_GOAL ? prizesCtx : buildTradeContext(snapshot, inputs, { now, settings: { ...settings, goal }, ...sc })), opts.prizes);
  lap("scale");
  const gap = searchGap(ctx, result, settings);
  lap("gap");
  const filter = filterRows(ctx, result, clock);
  lap("filter");
  const blend = blendReport(tradeInternals(ctx));
  const odds = oddsByOrder(snapshot, inputs, league.model, ctx, { now, settings, ...sc, pre4c });
  lap("odds");
  const anchors = anchorRows();
  const premiumAnchors = premiumAnchorRows();
  const neutral = neutralCards(ctx, result, settings);
  const kickoff = kickoffJump(snapshot, inputs, { settings, ...sc });
  const weeks = pickupWeeks(league.model);
  lap("other");
  // Section 9: Checkpoint 7b's rule for the roster spot a trade opens, on its own context and search, against this one.
  const openSpots = openSpotSection(snapshot, inputs, ctx, result, settings, { now, ...sc });
  lap("open spots");
  // Section 10: "Helps both" under each setting, the split's scales, and the extra runtime.
  const helpsBoth = helpsBothSection({ result, runtime }, goals, without);
  lap("helps both");
  timing.total = clock() - start;
  const report: Omit<TradeReport, "doc"> = { snapshot, pre4c, settings, prizes: opts.prizes ?? null, ctx, result, model: league.model, league: { cold: league.cold, warm: league.warm }, runtime, beams: { result: beams.result, runtime: beams.runtime }, goals, scale, gap, filter, blend, odds, anchors, premiumAnchors, neutral, kickoff, pickupWeeks: weeks, openSpots, helpsBoth, timing };
  return { ...report, doc: render(snapshot, inputs, opts, report) };
}

// ---------------------------------------------------------------------------------------------
// Rendering

type Report = Omit<TradeReport, "doc">;

const teamNameOf =
  (me: string | null) =>
  (id: string): string =>
    `Team ${id}${id === me ? " (you)" : ""}`;

function render(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: TradeReportOptions, r: Report): string {
  const L: string[] = [];
  const teamName = teamNameOf(r.result.myTeamId);
  renderHeader(L, snapshot, inputs, opts, r);
  renderTop(L, snapshot, inputs, r, teamName);
  renderGoals(L, snapshot, r, teamName);
  renderScale(L, r);
  renderGap(L, snapshot, r, teamName);
  renderFilter(L, r);
  renderBlend(L, snapshot, r);
  renderOdds(L, snapshot, r, teamName);
  renderOther(L, snapshot, r, teamName);
  renderOpenSpots(L, snapshot, r, teamName);
  renderHelpsBoth(L, snapshot, inputs, r, teamName);
  return L.join("\n");
}

const LEVEL_WORDS: Readonly<Record<TradeSettings["protectValue"], string>> = { low: "Low", medium: "Medium", high: "High" };
const goalWeightsText = (g: Goal): string => `ΔPO ${goalWeights(g).playoffs} / ${g === "prizes" ? "ΔE[S]" : "ΔCH"} ${goalWeights(g).prizes}`;
const minChanceText = (x: number): string => (x > 0 ? `at least ${pctPlain(x, 0)}` : "Any");

function renderHeader(L: string[], snapshot: LeagueSnapshot, inputs: ModelInputs, opts: TradeReportOptions, r: Report): void {
  const I = tradeInternals(r.ctx);
  const s = r.settings;
  const model = r.model;
  const me = r.result.myTeamId;
  L.push("# Trade search: Parker's ESPN league (Checkpoint 7c)", "");
  L.push(
    `Generated by \`${opts.command ?? commandText("trade:report", [opts.mode === "live" ? "--live" : null])}\` on ${(opts.generatedAt ?? opts.now).toISOString().slice(0, 10)} through the real engine, as the app's Web Workers run it. Team, owner and league names are placeholders (you are Team ${me ?? "–"}); NFL player names are public.`,
    "",
  );
  L.push(`**League 1** · ESPN · ${snapshot.season} · week ${snapshot.currentWeek}${model.inProgressWeek !== null ? " (under way)" : ""} · ${snapshot.teams.length} teams · ${snapshot.settings.leagueType} · remaining weeks ${model.weeks[0] ?? "–"}–${model.weeks.at(-1) ?? "–"} · ${I.S} availability scenarios · trade review: ${snapshot.settings.tradeReview} · numbers as of ${opts.now.toISOString()}`, "");
  L.push("**Data**", "", `- ${opts.dataNote}`);
  for (const x of inputs.sources) L.push(`- ${x.source}: ${x.fetchedAt}${x.stale ? " (saved copy; the live fetch failed)" : ""}`);
  L.push(`- League snapshot fetched: ${snapshot.fetchedAt}`);
  L.push(`- Waiver order used: ${waiverOrderText(snapshot)}.${r.pre4c ? ` ${pre4cText(r.pre4c, me, teamNameOf(me))} Section 7 compares the two orders.` : ""}`);
  L.push("");
  L.push(
    `**Settings** (the app's defaults): What does your league reward?: ${GOAL_WORDS[s.goal]} (${goalWeightsText(s.goal)}; section 2: ${GOAL_WORDS[r.goals.goal]}, ${r.goals.reward ? prizesWords(r.goals.reward) : "–"}${opts.prizes ? ", from --prizes" : ""}); Chance they accept: ${minChanceText(s.minChance)}; Protect my trade value: ${LEVEL_WORDS[s.protectValue]} (κ ${protectValueWeight(s.protectValue)} points a week per 100% of trade value, priced on B₃: section 3); max ${s.maxPerSide} players a side; streamed ${s.streamPositions.join(", ") || "none"}; P/K/D/ST/IDP ${s.includeKDefIdp ? "included" : "left out"}; β_need ${betaNeed(snapshot.settings.leagueType)}; W (the trade value of the best free agent the allocation leaves unclaimed: §9, Checkpoint 7a) ${thousands(Math.round(I.credit))}; playoff weeks count ${playoffWeightSummary(I.model)} in every ROS(T): the search's shortlists, free-agent pickups and trade chips (planner reply to Checkpoint 7a, §6.1; the League page's model has the same, ${model.playoffWeight}×). ${thresholdsLine(I.model)}`,
    "",
  );
  const b = r.result.baseline;
  const stand = r.odds.stand;
  L.push(`**Your baseline** (the trade search's: every team after its free-agent pickups in the waiver order above, seasons 1–${thousands(config.simulation.finalSims)}; it ${r.odds.baselineEqual === false ? "does NOT equal ❌" : "equals"} the League page's headline, section 7): playoffs ${pctPlain(b.pPlayoffs)}, title ${pctPlain(b.pTitle)}, expected wins ${fmt(b.expWins, 2)}. As rosters stand: playoffs ${pctPlain(stand?.pPlayoffs)}, title ${pctPlain(stand?.pTitle)}.`, "");
  const notes = [...new Set([...inputs.notes, ...r.ctx.notes, ...r.result.notes])];
  const warnings = [...new Set([...inputs.warnings.map((w) => `\`${w.code}\` ${w.message}`), ...r.ctx.warnings, ...r.result.warnings, ...model.warnings])];
  if (notes.length || warnings.length) {
    L.push("**Notes and warnings** (the inputs', the League model's, the context's and the search's):", "");
    for (const n of notes) L.push(`- Note: ${n}`);
    for (const w of warnings) L.push(`- Warning: ${w}`);
    L.push("");
  }
}

/** Players with their injury tags in the card's words (tradeView.injuryTagText): "Zay Flowers [Questionable]" ("nobody" for none). */
function taggedNames(snapshot: LeagueSnapshot, inputs: ModelInputs, ids: readonly string[], tags: readonly InjuryTag[], side: InjuryTag["side"]): string {
  const by = new Map(tags.filter((g) => g.side === side).map((g) => [g.playerId, g]));
  const end = seasonEndOf(snapshot.settings, inputs.nfl.lastWeek);
  const source = snapshot.platform === "espn" ? "ESPN" : undefined;
  return ids.length ? ids.map((id) => `${nameOf(snapshot, id)}${by.has(id) ? ` [${injuryTagText(by.get(id) as InjuryTag, end, source)}]` : ""}`).join(" + ") : "nobody";
}

/** A card's side with its own tags (TradeEvaluation.flags.tagged). */
function sideText(snapshot: LeagueSnapshot, inputs: ModelInputs, t: TradeEvaluation, side: "give" | "get"): string {
  return taggedNames(snapshot, inputs, playerIds(side === "give" ? t.proposal.give : t.proposal.get), t.flags.tagged ?? [], side);
}

/**
 * A trade's injury tags by the search's own rule (explain.injuryTags with explain.tagContextOf: what evaluate.ts puts in a
 * card's flags.tagged, so a step's or a Plan B's players read as they would on a card): every player whose status isn't
 * ACTIVE, with the return week his projection counts on.
 */
export type Tagger = (p: Pick<TradeProposal, "give" | "get">) => InjuryTag[];

export function taggerOf(I: Pick<TradeInternals, "snapshot" | "model">): Tagger {
  const tc = tagContextOf(I);
  return (p) => injuryTags(p, I.snapshot.players, tc);
}

/**
 * What the next-step lines read besides the card: the tagger, the search's tags for its other ideas, and my odds before
 * any trade (the search's baseline: a Plan B box's odds start from it, as the card's do).
 */
interface StepContext {
  tagsOf: Tagger;
  knownTags: ReadonlyMap<string, InjuryTag>;
  baseline: TradeSearchResult["baseline"];
}

/** A Plan B box's odds lines in the report's words ("; Title odds 10.5% → 11.2% · Playoff odds 60% → 62%; Win chance by week: …"), "" without odds. */
export function planBOddsText(box: Pick<PlanBView, "odds" | "weekly">): string {
  const odds = box.odds.map((o) => `${o.label} ${o.value}`).join(" · ");
  return `${odds ? `; ${odds}` : ""}${box.weekly ? `; ${box.weekly.text}` : ""}`;
}

/**
 * The card's next step in words (the file header, section 1): the offer-first steps with their players' tags (tagsOf), or
 * Plan B in its box's own words (tradeView.planBView, as the card shows it: each tagged player's tag in parentheses; review
 * of track R, R-2: an untagged Plan B read as healthy), each with its numbers, and a Plan B with its box's odds lines
 * (Phase 4c, change 9: its title and playoff odds before → after and its weekly line, from its own final-block
 * simulation); or none.
 */
function nextStep(snapshot: LeagueSnapshot, inputs: ModelInputs, t: TradeEvaluation, sc: StepContext): string | null {
  if (t.steps) {
    const o = t.steps.offerFirst;
    const full = t.steps.ifNo.full;
    const oTags = sc.tagsOf(o.proposal);
    return `offer first ${taggedNames(snapshot, inputs, playerIds(o.proposal.give), oTags, "give")} → ${taggedNames(snapshot, inputs, playerIds(o.proposal.get), oTags, "get")} (${boxNumbers(o)}); if they say no, add ${taggedNames(snapshot, inputs, [t.steps.ifNo.add], sc.tagsOf(full.proposal), "give")} (${boxNumbers(full)})`;
  }
  if (t.planB) {
    const p = t.planB;
    const box = planBView(p, snapshot, { cardTags: t.flags.tagged, knownTags: sc.knownTags, seasonEnd: seasonEndOf(snapshot.settings, inputs.nfl.lastWeek), baseline: sc.baseline });
    const kind = p.kind === "samePlayers" ? "a different package for the same players of theirs" : "a different target";
    return box ? `Plan B (${kind}), in the box's words: ${box.give} → ${box.get}; ${boxNumbers(p)}${planBOddsText(box)}` : null;
  }
  return null;
}

function renderTop(L: string[], snapshot: LeagueSnapshot, inputs: ModelInputs, r: Report, teamName: (id: string) => string): void {
  const trades = r.result.trades;
  const top = trades.slice(0, TOP_DETAIL);
  const b = r.result.baseline;
  L.push(`## 1. Your top ${TOP_DETAIL} under "${GOAL_WORDS[r.settings.goal]}"`, "");
  if (!top.length) {
    L.push(`No trades: ${[...r.ctx.notes, ...r.result.notes].join(" ") || "nothing helps your team."}`, "");
    return;
  }
  const b3 = top[0]?.b3 ?? null;
  L.push(
    `The Trade Finder's first ${top.length} of ${trades.length} cards with the default settings, Overall order, Helps you and Overall on B₃ ${b3 === null ? "–" : fmt(b3, 2)} (section 3: ${HELPS_AT_GAIN} ≈ +${config.benefit.helpsGain} pts a week). The three numbers as the card prints them: Helps you / Chance they accept (with its label; "goes through" when the league vote's veto rule cuts it; under ${Math.round(100 * config.acceptance.displayStep)}% reads "<${Math.round(100 * config.acceptance.displayStep)}%") / Overall. Odds before → after: the search's baseline and the trade's change on the same ${thousands(config.simulation.finalSims)} seasons. Win chance by week: the weeks whose chance moves at least ${Math.round(100 * config.explain.weeklyLineMin)} points, at most ${config.explain.weeklyLineMax} (the largest), in week order. Injury tags in brackets are the card's words; the offer-first steps' players carry the same tags (the search's own rule), and a Plan B is quoted in its box's own words (tags in parentheses). Trade value: g_mkt(me), the model's own figure counting roster spots, and what "Protect my trade value" charges or credits for it in Helps you, in points a week on the card's scale (planner reply to Checkpoint 7a, §2 question 5: κ × clamp(g_mkt(me)), the Analyzer's "Trade value: … pts/week equivalent").`,
    "",
  );
  L.push("| # | Partner | You give → you get | Helps / Chance / Overall | Title odds | Playoff odds | Win chance by week | Trade value |", "|---|---|---|---|---|---|---|---|");
  top.forEach((t, i) =>
    L.push(`| ${i + 1} | ${teamName(t.proposal.partnerId)} | ${sideText(snapshot, inputs, t, "give")} → ${sideText(snapshot, inputs, t, "get")} | ${threeNumbers(t)} | ${titleMove(b.pTitle, t.dCH)} | ${playoffMove(b.pPlayoffs, t.dPO)} | ${weeklyText(weeklyLines(t.detail.winChance))} | ${tradeValueText(t)} |`),
  );
  L.push("");
  const sc: StepContext = { tagsOf: taggerOf(tradeInternals(r.ctx)), knownTags: knownTagsOf(trades), baseline: r.result.baseline };
  const steps = top.flatMap((t, i) => {
    const s = nextStep(snapshot, inputs, t, sc);
    return s ? [`- #${i + 1}: ${s}`] : [];
  });
  if (steps.length) L.push("Next steps on those cards:", "", ...steps, "");
  const c10 = cardCounts(top, sc.tagsOf);
  const all = cardCounts(trades, sc.tagsOf);
  L.push(
    `**Counts** (top ${c10.shown} / all ${all.shown} cards): with Plan B ${c10.planB} / ${all.planB}; with offer-first steps ${c10.steps} / ${all.steps}; receiving an injury-tagged player ${c10.injuredGet} / ${all.injuredGet}; Plan B boxes receiving one ${c10.planBInjuredGet} / ${all.planBInjuredGet}. Hidden: ${r.result.hidden.byBenefit} for B ≤ 0, ${r.result.hidden.byMarket} by the market guard, ${r.result.hidden.byChance ?? 0} under the minimum chance; dropped by the variety rules: ${r.result.dropped ? `${r.result.dropped.givenPlayer} by the given-player cap, ${r.result.dropped.partnerCap} by the partner cap, ${r.result.dropped.core} by the core rule, ${r.result.dropped.filler} as filler` : "–"}.`,
    "",
  );
  const p = r.result.pattern;
  L.push(p ? `**The pattern note** (${p.count} of the uncapped top ${p.of} give ${nameOf(snapshot, p.playerId)}; drivers: ${p.drivers.join(", ") || "none"}): "${p.text}"` : `**The pattern note** doesn't show: fewer than ${config.explain.patternMinCount} of the uncapped top ${config.explain.patternTop} give the same player of yours.`, "");
}

/** A top-GOAL_TOP list in a line: "#1 Team 4: A → B (Helps 50 · 35% · Overall 20); …" (Helps you · goes through · Overall). */
function topLine(snapshot: LeagueSnapshot, trades: readonly TradeEvaluation[], teamName: (id: string) => string): string {
  const top = trades.slice(0, GOAL_TOP);
  if (!top.length) return "no cards";
  return top.map((t, i) => `#${i + 1} ${teamName(t.proposal.partnerId)}: ${names(snapshot, playerIds(t.proposal.give))} → ${names(snapshot, playerIds(t.proposal.get))} (Helps ${t.tradeScore ?? "–"} · ${chancePrinted(t.pComplete)} · Overall ${t.overall ?? "–"})`).join("; ");
}

function renderGoals(L: string[], snapshot: LeagueSnapshot, r: Report, teamName: (id: string) => string): void {
  const g = r.goals;
  const main = GOAL_WORDS[r.settings.goal];
  const other = GOAL_WORDS[g.goal];
  const split = g.reward ? prizesWords(g.reward) : "–";
  L.push(`## 2. What does your league reward?: "${main}" against "${other}"`, "");
  L.push(
    `Planner reply to Checkpoint 7b, §6 ("how his top 5 changed from 'Only the champion'"): the search the app runs under "${other}" on ${split}${r.prizes ? " (from --prizes)" : " (⚠️ no --prizes given)"}, against the default "${main}" (section 1). Each runs on the trade context the app builds under its setting: B_win's weights (${main}: ${goalWeightsText(r.settings.goal)}; ${other}: ${goalWeightsText(g.goal)}, ΔE[S] the change in your share of the league's prizes) and its own playoff-week weight ω (${main} ${g.omega.title}×, ${other} ${g.omega.other}×: planner reply to Checkpoint 7a, §6.1), so its own free-agent pickups, baseline and shortlists; the "Helps you" scale is each setting's own B₃ (section 3). Each column: the card's place (– when that list doesn't show it; its numbers are then the Analyzer's on that setting's context), B, Helps you, the chance it goes through and Overall. ${g.commonTop} of the top ${GOAL_TOP} and ${g.common} of the top ${TOP_DETAIL} are in both lists; "${other}" shows ${g.result.trades.length} cards ("${main}": ${r.result.trades.length}).`,
    "",
  );
  L.push(`**Top ${GOAL_TOP}, ${main}:** ${topLine(snapshot, r.result.trades, teamName)}.`, "", `**Top ${GOAL_TOP}, ${other}:** ${topLine(snapshot, g.result.trades, teamName)}.`, "");
  L.push(`| Trade | ${main}: # · B · Helps · goes through · Overall | ${other}: # · B · Helps · goes through · Overall |`, "|---|---|---|");
  const side = (x: GoalSide) => `${x.rank === null ? "–" : `#${x.rank}`} · ${fmt(x.b, 2)} · ${x.helps ?? "–"} · ${x.pComplete === null ? "–" : chancePrinted(x.pComplete)} · ${x.overall ?? "–"}`;
  for (const row of g.rows) L.push(`| ${teamName(row.partnerId)}: ${names(snapshot, row.give)} → ${names(snapshot, row.get)} | ${side(row.title)} | ${side(row.other)} |`);
  const both = g.rows.filter((x) => x.title.b !== null && x.other.b !== null);
  const ratio = median(both.map((x) => (x.title.b as number) / (x.other.b as number)).filter((x) => Number.isFinite(x)));
  L.push("", `Across these ${both.length} trades the median B under "${main}" is ${fmt(ratio, 2)}× its B under "${other}".`, "");
}

function renderScale(L: string[], r: Report): void {
  const s = r.scale;
  const gain = config.benefit.helpsGain;
  L.push("## 3. B₃ under each goal", "");
  const cal = s.calibration;
  if (!cal) {
    L.push("No odds or no team, so no calibration run: no card has a Helps you.", "");
    return;
  }
  const weeks = r.model.weeks.slice(cal.from);
  const matches = (m: boolean | null, what: string) => (m === null ? "" : ` ${what} ${m ? "is the same run, bit for bit." : "is NOT the same run."}`);
  L.push(
    `Planner reply to Checkpoint 4c, A2: Helps you = round(100 × (1 − e^(−B / B₃))) and Overall = round(100 × (1 − e^(−B × P_complete / B₃))), B₃ = the B of +${gain} projected points a week in every week a trade can change (weeks ${weeks[0] ?? "–"}–${weeks.at(-1) ?? "–"}${cal.from > 0 ? `; week ${r.model.inProgressWeek} is under way, held as rosters stand in every trade` : ""}), regular season and playoffs, from the one baseline (every team after its pickups: LeagueModel.odds), on its ${thousands(config.simulation.finalSims)} seasons (common random numbers), under the same goal, floored at ${config.benefit.helpsFloor}; in a dynasty or keeper league with long-term values B_ref(λ) = (1 − λ) × that + λ × F₁₀, F₁₀ = ${fmt(config.benefit.bFutureScale * config.benefit.helpsFutureShare, 0)}, the B of +${Math.round(100 * config.benefit.helpsFutureShare)}% long-term value (planner reply to Checkpoint 7a, §2 question 6). "Protect my trade value" is priced on the same B₃ (question 5): B's market term = (B₃ / ${gain}) × κ × clamp(g_mkt(me)), κ ${PROTECT_VALUE_LEVELS.map((level) => protectValueWeight(level)).join(" / ")} points a week per 100% of trade value at Low / Medium / High, so the last column's 25%-more-value example costs the same points a week under every goal. The League model's run (LeagueModel.helpsCalibration): ΔPO₃ ${pts(cal.dPO, 2)}, ΔCH₃ ${cal.dCH === null ? "unknown" : pts(cal.dCH, 2)}.${matches(s.contextMatches, "The trade context's own run (its final block)")}`,
    "",
  );
  const kMedium = protectValueWeight("medium");
  const redraft = r.snapshot.settings.leagueType === "redraft";
  L.push(
    `Each goal's B₃ below is the one the app's search scores that goal's cards on: off the trade context the app builds under that goal. Since the planner's reply to Checkpoint 7a (§6.1) the goal also sets the playoff weeks' weight ω, so each goal has its own pickups, baseline and +${gain} run (its ΔPO₃ / ΔCH₃ in the table). The "read" column is the scale check further down, on the default goal's baseline.`,
    "",
  );
  L.push("| Goal | Weights | ω | ΔPO₃ / ΔCH₃ | B₃ | Floored | +1 / +3 / +6 pts a week read | Giving 25% more value at Medium: B (pts a week) |", "|---|---|---|---|---|---|---|---|");
  for (const g of GOALS) {
    const b = s.b3[g];
    const own = s.calibrations[g];
    const runText = own ? `${pts(own.dPO, 2)} / ${own.dCH === null ? "unknown" : pts(own.dCH, 2)}` : "–";
    const reads = s.check?.rows ? s.check.rows.map((row) => `+${row.gain} → ${row.score[g] ?? "–"}`).join(", ") : "–";
    const price = !redraft ? "– (no market term)" : b ? `${signed(marketSanity(PRICE_EXAMPLE_G, b.b3, kMedium), 2)} (${signed(marketWeekly(PRICE_EXAMPLE_G, kMedium), 1)})` : "–";
    L.push(`| ${GOAL_WORDS[g]}${g === r.settings.goal ? " (the app's default)" : ""} | ${goalWeightsText(g)} | ${s.omega[g]}× | ${runText} | ${b ? fmt(b.b3, 2) : "–"} | ${b ? (b.floored ? `yes (raw ${fmt(b.raw, 2)})` : "no") : "–"} | ${reads} | ${price} |`);
  }
  L.push("");
  // The note a search shows when its B₃ is floored (benefit.helpsScaleNotes; review of track SC).
  const scaleNotes = GOALS.flatMap((g) => helpsScaleNotes(s.b3[g]).map((n) => `${GOAL_WORDS[g]}: “${n}”`));
  L.push(scaleNotes.length ? `The searches' notes on the scale: ${scaleNotes.join("; ")}` : `No goal's B₃ is floored: no search shows a note on the scale.`, "");
  const c = s.check;
  if (!c || !c.rows) {
    L.push(c ? `The scale check: title odds are unknown${c.titleUnknown ? ` (${c.titleUnknown})` : ""}, so its B can't be computed.` : "No scale check (no odds or no team).", "");
    return;
  }
  L.push(
    `The scale check (league-report's scaleCheck): your weekly score + 1, 3 and 6 projected points in the same weeks, the same seasons (± one standard error by batch means), on the default goal's baseline (ω ${r.model.playoffWeight}×) for every goal's weights, so the goals compare on one run. B = 100 × (w_PO ΔPO + w_S ΔE[S]) (ΔE[S] = ΔCH but under Several prizes: ${prizesWords(c.rewards.prizes)}), no market term; Helps you on that goal's B(+${gain}) on this baseline (its +${gain} row), so +${gain} reads 63 by construction; the app's own B₃ under another goal is the table's above, from that goal's own baseline. Baseline: playoffs ${pctPlain(c.base.pPlayoffs)}, title ${pctPlain(c.base.pTitle)}.${matches(s.checkMatches, `Its +${gain} row`)}`,
    "",
  );
  L.push(`| Gain | ΔPO | ΔCH | ${GOALS.map((g) => `${GOAL_WORDS[g]}: B / Helps`).join(" | ")} | Checkpoint 3's B (0.35 / 0.65) |`, `|---|---|---|${GOALS.map(() => "---|").join("")}---|`);
  for (const row of c.rows) L.push(`| +${row.gain} pt/wk | ${pts(row.dPO)} ± ${fmt(100 * row.se.dPO, 2)} | ${pts(row.dCH)} ± ${fmt(100 * row.se.dCH, 2)} | ${GOALS.map((g) => `${fmt(row.B[g], 2)} ± ${fmt(row.se.B[g], 2)} / ${row.score[g] ?? "–"}`).join(" | ")} | ${CHECKPOINT3_SCALE[row.gain] ?? "–"} |`);
  L.push("");
}

function stagesTable(L: string[], main: Runtime, beams: Runtime): void {
  const keys = ["setup", "screening", "exact", "simScreen", "simFinal", "rank", "steps", "total"];
  const fin = config.simulation.finalSims;
  const scr = config.simulation.screeningSims;
  const label: Record<string, string> = {
    setup: "setup (pools)",
    screening: "screening",
    exact: "exact evaluation",
    simScreen: `screening simulation (seasons ${thousands(fin + 1)}–${thousands(fin + scr)})`,
    simFinal: `final simulation (seasons 1–${thousands(fin)})`,
    rank: "ranking",
    steps: "steps, Plan B and words",
    total: "search, total",
  };
  L.push(`| Stage | Cold | Warm (median of ${main.runs.length}) | Beams alone (median of ${beams.runs.length}) |`, "|---|---|---|---|");
  L.push(`| context (League model and baseline) | ${ms(main.cold.context.total)} | ${ms(main.context.total)} | ${ms(beams.context.total)} |`);
  for (const k of keys) if (main.search[k] !== undefined) L.push(`| ${label[k] ?? k} | ${ms(main.cold.search[k])} | ${ms(main.search[k])} | ${ms(beams.search[k])} |`);
  L.push(`| **context + search** | **${ms(main.cold.total)}** | **${ms(main.total)}** | ${ms(beams.total)} |`, "");
}

function renderGap(L: string[], snapshot: LeagueSnapshot, r: Report, teamName: (id: string) => string): void {
  const g = r.gap;
  const c = r.result.counts;
  const bc = r.beams.result.counts;
  L.push("## 4. The search gap", "");
  L.push(
    `Planner change 1: every 1-for-2 and 2-for-1 from the give and get pools and every 2-for-2 from the first ${config.search.exhaustive.twoForTwoTop} of each, on top of the beams; ${config.search.finalists} finalists. **Screened**: ${thousands(c.screened)} (the beams alone: ${thousands(bc.screened)}); ${c.exact} exact, ${finalRunsText(r.result)}, ${r.result.trades.length} cards (the beams alone: ${bc.exact} exact, ${finalRunsText(r.beams.result)}, ${r.beams.result.trades.length} cards).`,
    "",
  );
  if (!g.trade) L.push(`**${GAP_TRADE.give.join(" + ")} → ${GAP_TRADE.get.join(" + ")}**: ${g.missing ?? "not available"}.`, "");
  else {
    const e = g.evaluation;
    const funnel = [
      g.screened ? `screened #${g.screened.rank} of ${thousands(g.screened.of)} ${teamName(g.trade.partnerId)} candidates by the objective (${fmt(g.screened.objective, 2)})` : "never screened",
      g.inWindow === null ? null : g.inWindow ? "inside the g window" : "outside the g window",
      g.kept ? `kept #${g.kept.rank} of ${g.kept.of} for that partner` : "not kept",
      g.exact ? "evaluated exactly" : g.shortlisted ? "shortlisted but illegal" : "not in the exact 200",
      g.finalist ? "a finalist" : g.extra ? `not a finalist, but a "Helps both" extra (a final run only that list ranks: section 10)` : "not a finalist",
      g.card ? `**card #${g.card}**` : "not a card",
    ].filter((x): x is string => x !== null);
    L.push(
      `**${names(snapshot, g.trade.give)} → ${names(snapshot, g.trade.get)}** (${teamName(g.trade.partnerId)}): ${funnel.join(" → ")}. ${e ? `Its numbers${g.card ? "" : " (the Analyzer)"}: ${threeNumbers(e)}, B ${fmt(e.b, 2)}; title ${titleMove(r.result.baseline.pTitle, e.dCH)}, playoffs ${playoffMove(r.result.baseline.pPlayoffs, e.dPO)}.` : ""} The beams alone ${g.beams ? "screen it too" : "never screen it"}.${g.bestSameFamily ? ` The best card with that partner giving ${GAP_TRADE.give[0]} otherwise: #${g.bestSameFamily.rank} ${names(snapshot, playerIds(g.bestSameFamily.trade.proposal.get))} (${threeNumbers(g.bestSameFamily.trade)}).` : ""}`,
      "",
    );
  }
  L.push(
    `Only the exhaustive candidates reach (the beams alone never screen them): ${g.onlyExhaustive.exact} of ${c.exact} exact trades, ${g.onlyExhaustive.finalRuns} of the ${c.simFinal} final runs, ${g.onlyExhaustive.cards} of ${r.result.trades.length} cards.${g.reproduces ? ` The per-partner counts come from screening every partner again on the search's own context: they add up to the search's ${thousands(c.screened)} ${mark(g.reproduces.counts)}, and every trade it evaluated exactly is in the rebuilt shortlist or among its lean companions ${mark(g.reproduces.shortlist)}.` : ""}`,
    "",
  );
  if (g.perPartner.length) {
    L.push("| Partner | Screened | Beams alone | Exact | Final runs | Cards |", "|---|---|---|---|---|---|");
    for (const p of g.perPartner) L.push(`| ${teamName(p.partnerId)} | ${thousands(p.exhaustive)} | ${thousands(p.beams)} | ${p.exact} | ${p.finalRuns} | ${p.cards} |`);
    const sum = (f: (p: PartnerCounts) => number) => g.perPartner.reduce((s, p) => s + f(p), 0);
    L.push(`| **all** | **${thousands(sum((p) => p.exhaustive))}** | ${thousands(sum((p) => p.beams))} | ${sum((p) => p.exact)} | ${sum((p) => p.finalRuns)} | ${sum((p) => p.cards)} |`, "");
  }
  L.push(`**Runtime** (Node ${process.version}, each run with its own context; cold = the first search in the process, after the League model's own timed builds; each timed run is followed by section 10's run without "Helps them"; the browser's worker is timed by \`npm run check:browser -- --live\`). ${r.runtime.sameEveryRun && r.beams.runtime.sameEveryRun ? "Every run returned the same trades with the same numbers ✅." : "❌ The runs did not all return the same trades."} The League model alone: ${ms(r.league.cold)} cold, ${ms(r.league.warm)} warm.`, "");
  stagesTable(L, r.runtime, r.beams.runtime);
}

function renderFilter(L: string[], r: Report): void {
  L.push("## 5. The minimum-chance filter", "");
  const rows = r.filter;
  if (!rows) {
    L.push("The search stopped before ranking, so there's nothing to filter.", "");
    return;
  }
  L.push(
    `Planner change 10: "Chance they accept: at least …" on the chance a trade goes through as the card prints it, before the variety caps; re-filtered from the one search's ${config.search.finalists} finalists (runRefilter), no new search. Qualifying = finalists that pass the guards and the minimum; "few" = fewer than ${config.ranking.minChanceFew} cards while a lower setting would show more (the page suggests one).`,
    "",
  );
  L.push("| Chance they accept | Cards | Qualifying | Under the minimum | Few | Re-filter time |", "|---|---|---|---|---|---|");
  for (const x of rows) L.push(`| ${minChanceText(x.minChance)}${x.same === null ? "" : ` (the search's own: ${x.same ? "the same list ✅" : "a different list ❌"})`} | ${x.cards} | ${x.qualifying} | ${x.byChance} | ${x.few ? "yes" : "no"} | ${ms(x.ms)} |`);
  L.push("");
}

function renderBlend(L: string[], snapshot: LeagueSnapshot, r: Report): void {
  const b = r.blend;
  L.push("## 6. The blend's most extreme factors", "");
  const fallback = b.rows.filter((x) => x.fallback).length;
  const injured = b.rows.filter((x) => x.injury !== null && x.injury !== "ACTIVE").length;
  const few = b.rows.filter((x) => x.games !== null && x.games <= FEW_GAMES).length;
  const clean = b.rows.filter((x) => x.reason.startsWith("No data flag")).length;
  L.push(
    `Planner change 4: f clamped to [${b.clamp[0]}, ${b.clamp[1]}]. ${b.count} players blended; f before the clamp ${b.range ? `from ${fmt(b.range.min, 3)} to ${fmt(b.range.max, 3)} (median ${fmt(b.range.median, 3)})` : "–"}; the clamp cut ${b.clamped.length}${b.clamped.length ? ` (${b.clamped.map((x) => `${nameOf(snapshot, x.id)}, ${x.clamped === "high" ? "upper" : "lower"} bound`).join("; ")})` : ""}. The ${b.rows.length} most extreme before the clamp (|ln f|), per game: our base rate (b) against the market's number for his value (the curve of our base rates over healthy players by value), and his points a game so far. The words come only from each player's record (blend.blendRecords) and those points: a data flag when the record shows one (a fallback base rate, an injury, at most ${FEW_GAMES} game played), else "No data flag" with the facts that rule them out; hype and role changes aren't facts the record holds, so they're never named. Of these ${b.rows.length}: ${fallback} with a fallback base rate, ${injured} injury-tagged, ${few} with at most ${FEW_GAMES} game played, ${clean} with no data flag.`,
    "",
  );
  L.push("| # | Player | f (→ after the clamp) | Ours / market, a game | So far, a game | What the record shows |", "|---|---|---|---|---|---|");
  b.rows.forEach((x, i) => {
    const p = snapshot.players[x.id];
    L.push(`| ${i + 1} | ${nameOf(snapshot, x.id)} (${x.pos ?? "–"}, ${p?.nflTeam ?? "FA"}) | ${fmt(x.fRaw, 3)}${x.clamped ? ` → ${fmt(x.f, 2)}` : ""} | ${fmt(x.ours, 2)} / ${fmt(x.market, 2)} | ${x.games ? `${fmt(x.actualPpg, 2)} (${x.games} game${x.games === 1 ? "" : "s"})` : "–"} | ${x.reason} |`);
  });
  L.push("");
}

function renderOdds(L: string[], snapshot: LeagueSnapshot, r: Report, teamName: (id: string) => string): void {
  const o = r.odds;
  L.push("## 7. Your odds on the one shared baseline", "");
  L.push(
    `Planner change 9 and answer 2: the League page's headline and every card's "before" are one baseline, every team after its free-agent pickups, in the weekly reset waiver order where the league resets weekly; "as rosters stand" is the second line. The trade search's baseline ${o.baselineEqual === null ? "– (no odds)" : o.baselineEqual ? "equals LeagueModel.odds exactly (every team, every week, the notes) ✅" : "does NOT equal LeagueModel.odds ❌"}.${o.resetMatchesStandings === null ? "" : ` The reset order ${r.pre4c ? "this report built (the 4c adapter's rule: win percentage, then points for)" : "the 4c adapter wrote"} ${o.resetMatchesStandings ? "is" : "is NOT"} today's standings by the league's rules reversed (the simulator's ranks) ${mark(o.resetMatchesStandings)}.`}`,
    "",
  );
  L.push("| Baseline | Waiver order (team numbers, first claim first) | Your place | Your pickups | Playoffs | Bye | Title | Expected wins |", "|---|---|---|---|---|---|---|---|");
  const pickupsText = (moves: readonly FaMove[]) => (moves.length ? moves.map((m) => `+${nameOf(snapshot, m.add)}${m.drop ? ` −${nameOf(snapshot, m.drop)}` : ""}`).join(", ") : "none");
  const row = (label: string, x: OrderOdds | null, missing: string | null) =>
    x ? `| ${label} | ${x.how}: ${x.order.join(" > ")} | ${x.place === null ? "–" : ordinal(x.place)} | ${pickupsText(x.pickups)} | ${pctPlain(x.mine?.pPlayoffs)} | ${pctPlain(x.mine?.pBye)} | ${pctPlain(x.mine?.pTitle)} | ${fmt(x.mine?.expWins, 2)} |` : `| ${label} | not available: ${missing ?? "–"} | – | – | – | – | – | – |`;
  L.push(row("**With pickups, weekly reset order (the headline)**", o.reset, o.resetMissing));
  L.push(`| As rosters stand (the second line) | – (no pickups) | – | – | ${pctPlain(o.stand?.pPlayoffs)} | ${pctPlain(o.stand?.pBye)} | ${pctPlain(o.stand?.pTitle)} | ${fmt(o.stand?.expWins, 2)} |`);
  L.push(row("With pickups, live order", o.live, o.liveMissing), "");
  if (o.weekly.length) {
    L.push("Your win chance by week:", "", "| Week | Opponent | With pickups (reset order) | As rosters stand | With pickups (live order) |", "|---|---|---|---|---|");
    for (const w of o.weekly) L.push(`| ${w.week}${w.week === r.model.inProgressWeek ? " (under way)" : ""} | ${w.opponentId ? teamName(w.opponentId) : "–"} | ${pctPlain(w.reset, 0)} | ${pctPlain(w.stand, 0)} | ${pctPlain(w.live, 0)} |`);
    L.push("");
  }
}

/** "43.1% → 47.2% (+4.1 pts)": a chance from the card to its lean version, unrounded to one decimal, and the change. */
function chanceMove(card: number, lean: number): string {
  return `${pctPlain(card)} → ${pctPlain(lean)} (${pts(lean - card)})`;
}

/**
 * The cards with a neutral throw-in against their lean versions (the file header, section 8; review of track R, R-1): the
 * chance they accept, B and the expected gain unrounded (the card's rounded numbers hid a lean version's 4-point edge),
 * the chance it goes through too when the veto rule cuts either, the card-style numbers second, and where the lean version
 * stands in the search. A summary line counts the lean versions that are likelier and those with the higher expected gain.
 */
function renderNeutral(L: string[], snapshot: LeagueSnapshot, cards: readonly NeutralCard[], rule: string, teamName: (id: string) => string): void {
  const withLean = cards.filter((n) => n.lean !== null);
  const likelier = withLean.filter((n) => (n.lean as TradeEvaluation).pAccept > n.trade.pAccept + EPS);
  const better = withLean.filter((n) => n.eg.lean !== null && n.eg.card !== null && n.eg.lean > n.eg.card + EPS);
  const unseen = withLean.filter((n) => n.leanStatus !== null && !n.leanStatus.exact);
  const list = (xs: readonly NeutralCard[]) => (xs.length ? ` (${xs.map((n) => `#${n.rank}`).join(", ")})` : "");
  const summary = withLean.length
    ? `the lean version is likelier to be accepted on ${likelier.length} of ${withLean.length}${list(likelier)} and has the higher expected gain (B × the chance it goes through, what Overall scales) on ${better.length}${list(better)}; the search never evaluated ${unseen.length} of these ${withLean.length} lean versions exactly.`
    : "none has a lean version (every player in it is left out, or a side would be empty).";
  L.push(`- **Neutral throw-ins** (${rule}): ${cards.length} card${cards.length === 1 ? "" : "s"}. Each card next to its lean version (the same trade without them, from the Analyzer on the cards' own seasons 1–${thousands(config.simulation.finalSims)}), unrounded: ${summary}`, "");
  L.push("| Card | Left out (value) | Chance they accept: card → lean | B: card → lean | Expected gain: card → lean | As printed: card · lean | The lean version in the search |", "|---|---|---|---|---|---|---|");
  const status = (s: NeutralCard["leanStatus"]) => (!s ? "–" : s.card ? `card #${s.card}` : s.finalist ? "a finalist the variety rules left out" : s.exact ? "evaluated exactly, not a finalist" : "never evaluated exactly");
  for (const n of cards) {
    const t = n.trade;
    const head = `#${n.rank} ${teamName(t.proposal.partnerId)}: ${names(snapshot, playerIds(t.proposal.give))} → ${names(snapshot, playerIds(t.proposal.get))}`;
    const removed = n.removed.map((x) => `${nameOf(snapshot, x.id)} (${thousands(Math.round(x.value))})`).join(", ");
    const lean = n.lean;
    if (!lean) {
      L.push(`| ${head} | ${removed} | ${n.leanIllegal ? `without them it can't be made: ${n.leanIllegal}` : "no lean version (a side would be empty)"} | – | – | ${threeNumbers(t)} | – |`);
      continue;
    }
    const vetoed = Math.abs(t.pComplete - t.pAccept) > EPS || Math.abs(lean.pComplete - lean.pAccept) > EPS;
    const chance = `${chanceMove(t.pAccept, lean.pAccept)}${vetoed ? `; goes through ${chanceMove(t.pComplete, lean.pComplete)}` : ""}`;
    const eg = n.eg.card !== null && n.eg.lean !== null ? `${fmt(n.eg.card, 3)} → ${fmt(n.eg.lean, 3)} (${signed(n.eg.lean - n.eg.card, 3)})` : "–";
    L.push(`| ${head} | ${removed} | ${chance} | ${fmt(t.b, 2)} → ${fmt(lean.b, 2)} | ${eg} | ${threeNumbers(t)} · ${threeNumbers(lean)} | ${status(n.leanStatus)} |`);
  }
  L.push("");
}

function renderOther(L: string[], snapshot: LeagueSnapshot, r: Report, teamName: (id: string) => string): void {
  L.push("## 8. Anything else worth a look", "");
  const anchors = [...r.anchors, ...r.premiumAnchors];
  const failed = anchors.filter((a) => !a.pass);
  L.push(
    `- **The acceptance anchors** (the planner's two tables through acceptance(), premium.perceivedPackage and benefit.tradePackage): ${anchors.length - failed.length} of ${anchors.length} within ±${ANCHOR_TOLERANCE} point ${mark(!failed.length)}${failed.length ? ` (off: ${failed.map((a) => `${a.name}: ${fmt(a.computed, 1)}% against ${fmt(a.planner, 1)}%`).join("; ")})` : ""}; the largest difference ${fmt(Math.max(...anchors.map((a) => Math.abs(a.diff))), 2)} points.`,
  );
  // Planner change 2 as market.neutralThrowIns builds it (review of track R, R-5: not every player worth at most W on that
  // side), with Phase 4c's matched pairs; the search evaluates each shortlisted trade's lean version too (its lean companions).
  const rule = `planner change 2 as built, market.neutralThrowIns: on the side giving more players, up to the difference in player counts, its lowest-valued players worth at most W = ${thousands(Math.round(tradeInternals(r.ctx).credit))}, then matched pairs of such players, one from each side, cheapest first, count in neither side's value, only in c; the search evaluates the lean version of every shortlisted trade that has one (search.leanCompanions)`;
  if (!r.neutral.length) L.push(`- **Neutral throw-ins** (${rule}): no card carries one.`);
  else renderNeutral(L, snapshot, r.neutral, rule, teamName);
  const k = r.kickoff;
  if (k) {
    const m = k.mine;
    const size = (x: number) => `${fmt(100 * x)} points`;
    L.push(
      `- **The headline at the week's first kickoff** (week ${k.week}, ${k.kickoff}; League models 1 ms either side): your playoffs ${pctPlain(m.before?.pPlayoffs)} → ${pctPlain(m.after?.pPlayoffs)}, title ${pctPlain(m.before?.pTitle)} → ${pctPlain(m.after?.pTitle)}; the largest move of any team ${size(k.headline.dPO)} of playoff odds${k.headline.teamId ? ` (${teamName(k.headline.teamId)})` : ""} and ${size(k.headline.dCH)} of title odds. As rosters stand the largest moves are ${size(k.stand.dPO)} and ${size(k.stand.dCH)}${k.stand.dPO === 0 && k.stand.dCH === 0 ? " ✅" : ""}.`,
    );
  }
  for (const w of r.pickupWeeks) {
    const moves = (xs: readonly FaMove[]) => (xs.length ? xs.map((m) => `+${nameOf(snapshot, m.add)}`).join(", ") : "none");
    L.push(
      `- **Week ${w.week} against ${teamName(w.opponentId)}**: your win chance ${pctPlain(w.asStands, 0)} as rosters stand, ${pctPlain(w.withPickups, 0)} with every team's pickups. Projected that week, as rosters stand → with pickups: you ${fmt(w.mine.stand)} → ${fmt(w.mine.pickups)} (your pickups: ${moves(w.myMoves)}), ${teamName(w.opponentId)} ${fmt(w.theirs.stand)} → ${fmt(w.theirs.pickups)} (its pickups: ${moves(w.theirMoves)}).`,
    );
  }
  L.push("", `This report took ${ms(r.timing.total)} (the searches ${ms(r.timing.searches)}, section 10's runs without "Helps them" among them, the beams alone ${ms(r.timing.beams)}, the "${GOAL_WORDS[r.goals.goal]}" search ${ms(r.timing.goals)}, the search gap's re-screening ${ms(r.timing.gap)}, section 9's Checkpoint 7b search and evaluations ${ms(r.timing["open spots"])}, section 10's scales ${ms(r.timing["helps both"])}).`, "");
}

/** A trade's card number under each rule ("#12 → #12", "– → #3"), and "(a finalist)" when it's a finalist but not a card now. */
function cardMove(row: OpenSpotRow): string {
  const at = (n: number | null) => (n === null ? "–" : `#${n}`);
  return `${at(row.card.before)} → ${at(row.card.now)}${row.card.now === null && row.finalist ? " (a finalist)" : ""}`;
}

/**
 * Section 9 (the file header): my open roster spots on either list and among this search's finalists, every exact trade
 * that opens my spot grouped, the partners' spots on the shown cards, and every side's fills with and without the keep set.
 */
function renderOpenSpots(L: string[], snapshot: LeagueSnapshot, r: Report, teamName: (id: string) => string): void {
  const o = r.openSpots;
  const head = (p: Pick<TradeProposal, "partnerId" | "give" | "get">) => `${teamName(p.partnerId)}: ${names(snapshot, playerIds(p.give))} → ${names(snapshot, playerIds(p.get))}`;
  L.push("## 9. Open roster spots", "");
  L.push(
    `Planner reply to Checkpoint 7b, section 5: the roster spot a trade opens takes the best available free agent at a position where the team gave more players than it received (the largest gain in scenario lineups, then the most ROS points), one spot at a time; with none allowed there, the best at any position; for both teams; and the free-agent pickups after the trade never drop him (the optimizer's keep set). Against Checkpoint 7b's rule (the free agent who most improves the expected-value lineup, at any position: TradeContextOptions.openSpotFill "bestAny", for this comparison only) on the same data and settings, with its own search: ${o.beforeCards} cards there, ${r.result.trades.length} here. Your trades that open your spot, on either list and among this search's finalists (up to ${OPEN_SPOT_FINALISTS} of those), each through the Analyzer under each rule (the cards' own numbers, the same seasons):`,
    "",
  );
  const nums = (e: TradeEvaluation | null) => (e ? threeNumbers(e) : "illegal");
  if (o.rows.length) {
    L.push("| Trade | Card: 7b → now | Your pickup: 7b → now | Helps / Chance / Overall: 7b → now |", "|---|---|---|---|");
    for (const row of o.rows) L.push(`| ${head(row.proposal)} | ${cardMove(row)} | ${spotNames(snapshot, row.before?.required.me.openSpots)} → ${spotNames(snapshot, row.now?.required.me.openSpots)} | ${nums(row.before)} → ${nums(row.now)} |`);
    L.push("");
  } else L.push("No card under either rule, and no finalist, leaves you an open roster spot.", "");
  if (o.groups.length) {
    L.push(`Every exact trade of this search that opens your spot (${o.exactMine} of ${o.exact}), by what the spot takes now (Checkpoint 7b's pickup from exact evaluation on its rule's context):`, "");
    L.push("| The spot now | Your pickup: 7b → now | Trades |", "|---|---|---|");
    for (const g of o.groups) L.push(`| ${g.short} | ${g.before} → ${g.now} | ${g.trades} |`);
    L.push("");
  }
  if (o.partner.length) {
    L.push("The partners' open roster spots on the shown cards (the rule is theirs too, so their lineup and the chance they accept move):", "");
    L.push("| Card | Their pickup: 7b → now | Their lineup a week: 7b → now | Chance they accept: 7b → now |", "|---|---|---|---|");
    for (const p of o.partner) {
      const t = p.trade;
      const lineup = `${p.before ? signed(p.before.partnerDeltaLineup, 2) : "–"} → ${signed(t.partnerDeltaLineup, 2)}`;
      const chance = `${p.before ? pctPlain(p.before.pAccept) : "–"} → ${pctPlain(t.pAccept)}`;
      L.push(`| #${p.rank} ${head(t.proposal)} | ${spotNames(snapshot, p.before?.required.partner.openSpots)} → ${spotNames(snapshot, t.required.partner.openSpots)}${p.takesMine ? " (your own baseline pickup: it claims before you)" : ""} | ${lineup} | ${chance} |`);
    }
    L.push("");
  }
  const f = o.fills;
  L.push(
    `Every side with an open spot in the search's ${o.exact} exact trades: ${f.sides} sides, ${f.spots} spots, ${f.same} at a position the team gave up and ${f.fallback} at any position. The free-agent pickups after the trade keep every fill ${mark(f.kept === 0)}${f.kept ? ` (${f.kept} sides drop one)` : ""}; without the keep set they'd drop the fill on ${f.unkept} of these sides.`,
    "",
  );
}

/** A duration with a real minus sign when it's negative (a difference of runs: noise can turn a small one around). */
const msSigned = (x: number | null): string => (!finite(x) ? "–" : x < 0 ? `${MINUS}${ms(-x)}` : ms(x));
/** A signed duration: "+270 ms", "−12 ms". */
const msChange = (x: number | null): string => (!finite(x) ? "–" : `${x < 0 ? MINUS : "+"}${ms(Math.abs(x))}`);

/** The chance they accept as the card prints it, with its label, and the chance it goes through when the veto rule cuts it. */
function chanceWithLabel(t: Pick<TradeEvaluation, "pAccept" | "pComplete" | "acceptLabel"> & { detail: Pick<TradeDetail, "vetoRisk"> }): string {
  return `${chancePrinted(t.pAccept)} ${t.acceptLabel}${t.detail.vetoRisk ? ` (goes through ${chancePrinted(t.pComplete)})` : ""}`;
}

/**
 * A partner's "Helps them" scale (benefit.partnerScale) as section 10 lists it: B_ref,P, which is B₃,P ("4.37"; floored:
 * "0.50 (floored: 0.21)", the calibration run's own B_win₃,P in brackets) unless it mixes in long-term value (a dynasty or
 * keeper league with long-term values): then B₃,P with its floor first, then the mix with λ_P ("B₃,P 0.50 (floored: 0.30) →
 * B_ref,P 1.70 (λ_P 0.35)"; review of the report track, HBR-2: the mix printed first, then "(floored: …)", read as B₃,P
 * floored from the run).
 */
export function scaleText(s: PartnerScale | null): string {
  if (!s) return "–";
  const floor = s.floored ? ` (floored: ${fmt(s.odds, 2)})` : "";
  return s.lambda === null ? `${fmt(s.b3, 2)}${floor}` : `B₃,P ${fmt(s.b3P, 2)}${floor} → B_ref,P ${fmt(s.b3, 2)} (λ_P ${fmt(s.lambda, 2)})`;
}

/**
 * Section 10's words for B_P and its scale (review of the report track, HBR-2): B_win,P with no trade-value term on B₃,P,
 * floored; outside redraft leagues also the mix with long-term values (benefit.partnerBenefit, partnerScale: λ_P the
 * default by the partner's playoff odds, keeper leagues' own, never the user's setting), B_ref,P = (1 − λ_P) × B₃,P + λ_P ×
 * F₁₀ (bFutureScale × helpsFutureShare: 4).
 */
export function helpsThemScaleWords(leagueType: LeagueType): string {
  const b = config.benefit;
  const words = `B_P, its B_win under the league's reward with no trade-value term, on its own scale B₃,P: the B of +${b.helpsGain} points a week for it on the same seasons, floored at ${b.helpsFloor}`;
  if (leagueType === "redraft") return words;
  const f10 = String(Number((b.bFutureScale * b.helpsFutureShare).toFixed(2)));
  return `${words}; with long-term values, B_P also weighs its B_future (its long-term value change) and the scale is B_ref,P = (1 − λ_P) × B₃,P + λ_P × ${f10}, both by λ_P, its default by its playoff odds (keeper ${b.lambda.keeper}), never the Win now ↔ Future setting`;
}

/**
 * The console summary's "Helps both" part (main(); review of the report track, HBR-3): the split's counts (section 2's search:
 * the exact trades that help both on the screening run, the list's cards, judged on their final numbers, and those of them
 * that are extras), then the extra runtime, named with the setting it was measured under (section 4's runs: section 1's).
 */
export function helpsBothSummary(h: Pick<HelpsBothSection, "counts" | "cost">, measuredUnder: Goal): string {
  const c = h.counts.other;
  const counts = c ? `${c.exact.both} of ${c.exact.total} exact trades help${c.exact.both === 1 ? "s" : ""} both on the screening run, the list shows ${c.list.trades.length} (${c.fromExtras} from the extras)` : "no trade counted as helping both (the search stopped before ranking)";
  return `${counts}; Helps both costs ${msChange(h.cost.extra.warm)} a search warm (${GOAL_WORDS[measuredUnder]}, section 4's runs)`;
}

/**
 * Section 10 (the file header): how many trades help both at each stage under each setting, the split's "Helps both" list
 * with the partners' odds and scales, and the extra runtime against the same search without "Helps them".
 */
function renderHelpsBoth(L: string[], snapshot: LeagueSnapshot, inputs: ModelInputs, r: Report, teamName: (id: string) => string): void {
  const h = r.helpsBoth;
  const main = GOAL_WORDS[r.settings.goal];
  const other = GOAL_WORDS[r.goals.goal];
  const min = config.benefit.helpsThemMin;
  const top = Math.max(0, Math.floor(config.search.helpsBothFinalists));
  L.push("## 10. Helps both", "");
  L.push(
    `Planner reply to Checkpoint 7b, §7: "Helps them" is the partner's Helps you from the same runs (${helpsThemScaleWords(snapshot.settings.leagueType)}), and a trade helps both when its Helps you, as printed, is above 0 and its Helps them at least ${min}. The "Helps both" sort shows only those, by Helps you, under the chance filter and the variety caps. The first ${top} by B among the screening run's trades that help both and aren't hidden get the final run (those the ranking hadn't picked: the extras), are checked again on it and are ranked on that list only, so it shows only trades exact evaluation saw. Each column is the app's search under that setting (sections 1 and 2):`,
    "",
  );
  const cell = (c: HelpsBothCounts | null, f: (c: HelpsBothCounts) => string) => (c ? f(c) : "–");
  const row = (label: string, f: (c: HelpsBothCounts) => string) => L.push(`| ${label} | ${cell(h.counts.title, f)} | ${cell(h.counts.other, f)} |`);
  const dropped = (d: HelpsBothList["dropped"]) => d.partnerCap + d.core + d.filler + d.givenPlayer;
  L.push(`| Trades that help both | ${main} | ${other} (the split) |`, "|---|---|---|");
  row(`Exact trades, screening run: Helps you above 0 · their B above 0 · Helps them ${min}+ · both (not hidden)`, (c) => `${c.exact.helpsYou} · ${c.exact.theirB} · ${c.exact.helpsThem} · ${c.exact.both} (${c.exact.shown}) of ${c.exact.total}`);
  row(`The extras: the first ${top} not hidden · already finalists · extras · still helping both on the final run`, (c) => `${c.pool} · ${c.picked} · ${c.extras} · ${c.stillBoth}`);
  row("Finalists the ranking picked, on the final run", (c) => `${c.finalists.both} of ${c.finalists.total}`);
  row(`Overall cards (their "Helps both" tag)`, (c) => `${c.cards.both} of ${c.cards.total}`);
  row(`**The "Helps both" list**: cards (also Overall cards · extras)`, (c) => `**${c.list.trades.length}** (${c.onOverall} · ${c.fromExtras})`);
  row("… qualifying · under the minimum chance · left out by the variety rules · a lower setting would add more", (c) => `${c.list.qualifying} · ${c.list.byChance} · ${dropped(c.list.dropped)} · ${c.list.lowerWouldAdd ? "yes" : "no"}`);
  L.push("");

  const list = r.goals.result.helpsBoth?.trades ?? [];
  const shown = list.slice(0, HELPS_BOTH_SHOWN);
  const scales = h.scales.map((s) => `${teamName(s.teamId)} ${scaleText(s.scale)}`).join(" · ");
  L.push(
    `**The list under "${other}"**: ${shown.length ? `its first ${shown.length} of ${list.length} card${list.length === 1 ? "" : "s"}, by Helps you, with the chance they accept as the card prints it and the partner's odds before → after on the same ${thousands(config.simulation.finalSims)} seasons as yours (TradeEvaluation.them).` : "no trade helps both teams."} Each partner's "Helps them" scale under it, B_ref,P (B₃,P unless it mixes in long-term value): ${scales || "–"}.`,
    "",
  );
  if (shown.length) {
    const places = h.places;
    const extras = new Set(searchStateOf(r.goals.result)?.helpsBothExtras ?? []);
    const overall = r.goals.result.trades;
    L.push(`| # | Partner | You give → you get | Helps you | Helps them | Chance they accept | Their title odds |${places ? ` Their top ${places} odds |` : ""} Their playoff odds | On the Overall list |`, `|---|---|---|---|---|---|---|${places ? "---|" : ""}---|---|`);
    shown.forEach((t, i) => {
      const th = t.them;
      const at = overall.findIndex((x) => x.key === t.key);
      const where = at >= 0 ? `card #${at + 1}` : extras.has(t.key) ? "no: an extra" : "no: a finalist it leaves out";
      const topCell = places ? ` ${th ? playoffMove(topChance(th.before.prizes, places), topChance(th.dPrizes, places)) : "–"} |` : "";
      L.push(
        `| ${i + 1} | ${teamName(t.proposal.partnerId)} | ${sideText(snapshot, inputs, t, "give")} → ${sideText(snapshot, inputs, t, "get")} | ${t.tradeScore ?? "–"} | ${th?.helps ?? "–"} | ${chanceWithLabel(t)} | ${titleMove(th?.before.pTitle ?? null, th?.dCH ?? null)} |${topCell} ${playoffMove(th?.before.pPlayoffs ?? null, th?.dPO ?? null)} | ${where} |`,
      );
    });
    L.push("");
  }

  const c = h.cost;
  const d = h.differs;
  const same = d.length
    ? `without it ${d.length} Overall card${d.length === 1 ? " differs" : "s differ"}${d.every((x) => x.helpsBoth) ? " (each helps both: such a card offers first, and gets a box, only versions that help both too)" : " ❌"}`
    : `without it the Overall list is the same ${r.result.trades.length} cards with the same numbers, steps, boxes and words ✅`;
  const measured = measuredRunsText(c);
  const sp = r.goals.parts;
  const many = (n: number, one: string, more: string): string => `${n} ${n === 1 ? one : more}`;
  const splitText = sp ? ` Under "${other}", section 2's one search (warm, ${ms(r.goals.result.timings.total)}): its ${many(sp.calibrations.count, "calibration run", "calibration runs")} ${ms(sp.calibrations.ms)} and its ${many(sp.extras.count, "extra's final run", "extras' final runs")} ${ms(sp.extras.ms)}.` : "";
  L.push(
    `**The extra runtime** (⚠️ ours: under "${main}", section 4's runs, whose first is the process's only cold search, each timed one followed by the same search without "Helps them" on its own context: every partner's calibration run set to none in the context's memo, the engine test's way, so no calibration run (${h.without.calibrated} made), no extra (${h.without.extras}) and an empty second list (${h.without.list}); ${same}). The calibration runs and the extras' final runs are read off each run's own progress; the second list's own work is the ranking stage's difference between the two sets, warm only (the cold extra adds the warm figure).${measured ? ` ${measured}` : ""}${splitText}`,
    "",
  );
  L.push(`| | Cold | Warm (median of ${r.runtime.runs.length}) |`, "|---|---|---|");
  L.push(`| The partner calibration runs (${c.calibrations.count}, one per partner of the exact trades) | ${ms(c.calibrations.cold)} | ${ms(c.calibrations.warm)} |`);
  L.push(`| The extras' final runs (${c.extras.count}) | ${ms(c.extras.cold)} | ${ms(c.extras.warm)} |`);
  L.push(`| The second list: its ranking, steps, Plan B and words | – | ${msSigned(c.secondList)} |`);
  L.push(`| **The extra: the three parts** | ${c.extra.cold === null ? "–" : `≈ ${msChange(c.extra.cold)} ⚠️`} | ${c.extra.warm === null ? "–" : `${msChange(c.extra.warm)}${finite(c.without.warm) && c.without.warm > 0 ? ` (${signed((100 * c.extra.warm) / c.without.warm, 1)}%)` : ""}`} |`);
  L.push(`| Search total with "Helps them" (the app: section 4's) | ${ms(c.with.cold)} | ${ms(c.with.warm)} |`);
  L.push(`| Search total without (with, less the extra: ⚠️ derived) | ${ms(c.without.cold)} | ${ms(c.without.warm)} |`, "");
}

// ---------------------------------------------------------------------------------------------
// Loading (live through the app's caches, or the offline dump)

/** Live (--live): Parker's league through the app's public-link import (or his cookies) and its caches. */
async function loadLive(cookies: ReportArgs["cookies"], teamArg: string | undefined): Promise<{ snapshot: LeagueSnapshot; inputs: ModelInputs; now: Date; timing: Record<string, number> }> {
  const useCookies = cookies !== "off" && (cookies === "on" || env("USE_ENV_COOKIES") === "1");
  const leagueId = env("ESPN_LEAGUE_ID");
  if (!leagueId) throw new Error("ESPN_LEAGUE_ID is blank in .env.local.");
  const season = Number(env("ESPN_SEASON") || 2026);
  const timing: Record<string, number> = {};
  const clock = () => performance.now();
  const http = createHttpClient({ cache: new FileCache() });
  let t0 = clock();
  const resolver = await loadPlayerIdResolver({ http });
  timing["player-ID crosswalk"] = clock() - t0;
  const now = new Date();
  const deps: ImportDeps = { http, resolver, now };
  const s2 = useCookies ? env("ESPN_S2") : undefined;
  const swid = useCookies ? env("ESPN_SWID") : undefined;
  t0 = clock();
  const { result, espn } = await importEspnLeagueForModel({ leagueId, season, ...(s2 && swid ? { credentials: { espnS2: s2, swid } } : {}) }, deps);
  timing["ESPN import"] = clock() - t0;
  const myTeamId = result.snapshot.myTeamId ?? teamArg ?? null;
  if (!myTeamId) console.log("Parker's team isn't known: pass --team <id> or --cookies.");
  t0 = clock();
  const inputs = await buildModelInputs({ snapshot: result.snapshot, http, resolver, now, espn });
  timing["model inputs (server: Sleeper, FantasyCalc, NFL schedule, scoring)"] = clock() - t0;
  return { snapshot: placeholders({ ...result.snapshot, myTeamId }), inputs, now, timing };
}

/**
 * The command line (the file header; scripts/lib/runMode.ts reportArgs): the saved dump (default the newest; null with
 * --live), --team, --cookies / --no-cookies (with --live) and --out. `env` and `dumps` for tests (default process.env and
 * data-local/ under `root`).
 */
export type TradeReportArgs = ReportArgs;

export function parseArgs(argv: readonly string[], root: string, opts: { env?: Env; dumps?: () => readonly DumpInfo[] } = {}): TradeReportArgs | { error: string } {
  return reportArgs(argv, root, opts);
}

/** The command line the report ran with, for its header (the dump always named, relative to the project root), so it can be run again on the same data. */
export function reportCommand(args: TradeReportArgs, root: string): string {
  return reportCommandText("trade:report", args, root);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), ROOT);
  if ("error" in args) {
    console.error(args.error);
    process.exitCode = 1;
    return;
  }
  console.log(reportSourceLine(args, ROOT));
  // How --prizes was read, before anything runs (review FB-R2: every comma starts the next prize).
  if (args.prizes) console.log(prizesReadLine(args.prizes));
  registerScrubber(await redactorFromMap("espn"));
  const clock = () => performance.now();
  const generatedAt = new Date();
  let loaded: { snapshot: LeagueSnapshot; inputs: ModelInputs; now: Date; timing: Record<string, number>; note: string };
  if (args.dump) {
    const d = loadDump(args.dump, args.team);
    loaded = { ...d, timing: {}, note: dumpNote(ROOT, args.dump, d) };
  } else {
    const l = await loadLive(args.cookies, args.team);
    loaded = { ...l, note: "Live: Parker's league through the app's public-link import and its caches (league data 10 minutes, projections 6 hours, values 24 hours)." };
  }
  const { snapshot, inputs, now, timing, note } = loaded;
  // Their split in this league, once it's loaded and before the search (review FB-R2).
  if (args.prizes) console.log(prizesSplitLine(args.prizes, prizePeriods(snapshot)));
  const report = buildTradeReport(snapshot, inputs, { now, clock, mode: args.dump ? "offline" : "live", dataNote: note, generatedAt, timing, command: reportCommand(args, ROOT), ...(args.prizes ? { prizes: args.prizes } : {}) });
  // Public NFL player names are kept whole: a leaguemate's first or last name can be a word of one (league-report, review PRIV-1).
  const doc = scrubEverythingExcept(report.doc, Object.values(snapshot.players).map((p) => p.name));
  writeFileSync(args.out ?? path.join(ROOT, "reports", "trade-report.md"), doc);
  const top = report.result.trades[0];
  const c = cardCounts(report.result.trades, taggerOf(tradeInternals(report.ctx)));
  const anchors = [...report.anchors, ...report.premiumAnchors];
  console.log(
    scrubEverything(
      `trade report written (${args.dump ? "offline" : "live"}) in ${ms(report.timing.total)}: ${c.shown} cards (Plan B ${c.planB}, steps ${c.steps}, injury-tagged received ${c.injuredGet}, Plan B boxes with one ${c.planBInjuredGet}); playoff weeks × ${report.model.playoffWeight} (${report.model.playoffWeightAuto?.basis ?? "?"}); search ${ms(report.runtime.search.total)} warm, ${thousands(report.result.counts.screened)} screened; top card Helps you ${top?.tradeScore ?? "–"}, Overall ${top?.overall ?? "–"}; ${GAP_TRADE.get.join(" + ")} card ${report.gap.card ?? "–"}; anchors ${anchors.filter((a) => a.pass).length}/${anchors.length}; baseline = LeagueModel.odds ${report.odds.baselineEqual ? "yes" : "NO"}${report.pre4c ? "; a dump from before the 4c adapter, put on the weekly reset order" : ""}; ${GOAL_WORDS[report.goals.goal]} (${report.goals.reward ? prizesWords(report.goals.reward) : "–"}): ω ${report.goals.omega.other}×, B₃ ${fmt(report.scale.b3[report.goals.goal]?.b3, 2)}, ${report.goals.commonTop} of the top ${GOAL_TOP} kept, ${helpsBothSummary(report.helpsBoth, report.settings.goal)}`,
    ),
  );
}

// Run only as a script (npm run trade:report), never when a test or another script imports the logic above (an exact
// path: scripts/lib/runMode.ts isMainModule; a scratch run-trade-report.ts doesn't start it). The offline guard goes on
// first unless --live (A5).
if (isMainModule(import.meta.url)) {
  setNetworkMode(wantsLive(process.argv.slice(2)));
  loadEnv();
  installConsoleScrubber();
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    process.exit(1);
  });
}
