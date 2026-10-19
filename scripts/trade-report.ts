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
 *   npm run trade:report -- --prizes 2000,1600,900   the league's prizes (1st, 2nd, 3rd, the weekly high score, the most
 *                                                  points; blank, 0 or left off not paid: Parker's league pays only the
 *                                                  top 3; scripts/lib/runMode.ts prizesArg): "Several
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
 *    lines (TradeDetail.winChance: weeklyLines), and its Plan B in its box's own words (tradeView.planBView: its players'
 *    tags as the card shows them, and since Phase 4c's polish its odds lines: planBOddsText) with its numbers (review of
 *    track R, R-2; until Checkpoint 7e a card with "Offer first / if they say no" steps showed them instead, its players
 *    tagged by the search's own rule, taggerOf), and its trade value (tradeValueText: g_mkt(me) and B's market term in
 *    points a week on the card's scale, TradeEvaluation.marketWeekly; planner reply to Checkpoint 7a, §2 question 5); the
 *    counts over the top 10 and every card, the Plan B boxes receiving an injury-tagged player among them (cardCounts;
 *    Checkpoint 7e: no card has steps, its "How to offer it" is section 11's), the ideas hidden and those the variety rules
 *    dropped, and since Checkpoint 7f those merged into another idea's offers (TradeSearchResult.dropped.merged: section
 *    11), since Checkpoint 7g those dropped for a better version of the same trade (TradeSearchResult.dropped.dominated:
 *    section 11); the pattern note (TradeSearchResult.pattern) when it shows.
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
 *    Checkpoint 7d: counts.exact holds the helps-both lane's exact trades too (search.ts helpsBothLaneOf, SearchState.lane),
 *    so the section says how many came from it (exactText), the re-screening rebuilds the lane and checks it's the search's
 *    (SearchGap.reproduces.lane), and the named trade's funnel says when it came through the lane (SearchGap.lane).
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
 *    Checkpoint 7d (planner reply to Checkpoint 7c, answer 2; the lead's "trade-report section 10 counts the lane"): the
 *    helps-both lane under each setting, read off each search's state (laneCounts: the screened trades on which both lineups
 *    gain, those the shortlist and its companions held, the lane, its lean companions, the legal ones, and of those the ones
 *    that help both on the screening run, the finalists the ranking picked, the extras, those that help both on the final
 *    run, and the cards of each list; and the finalists its trades displace, kept for the "Helps both" list), the same
 *    counts as above for the same search without the lane
 *    (TradeSearchOptions.helpsBothLane false: under section 1's setting the last of section 4's runs paired with one, under
 *    the split section 2's search against the same search on a context of its own, built the same way, so its partners'
 *    calibration runs aren't free), how many Overall cards the search without it doesn't show, what
 *    else it changes on the Finder (laneShown; review of the lane, LANE-1 and LANE-2: the Plan B boxes of the cards both
 *    show, until Checkpoint 7e their offer-first steps too, the "Helps both" list's cards each way, the final runs without it, Helps them known, that it
 *    doesn't make (none since the lead's fix: search.ts finalistsOf widens the extras' room by one for each of the extras'
 *    candidates the lane brought, a lane trade or its lean companion that helps both on the screening run and isn't hidden,
 *    and keeps the final runs of the finalists the lane's trades displace: the final review, ENG-7D-1), and the
 *    "checked N closely" and "Left out on purpose" counts), and
 *    what the lane costs (laneCost), measured like the extra above: each timed run of section 4 is followed by the same
 *    search without the lane on its own context (timedSearches' pairedNoLane, after the one without Helps them), the lane's
 *    exact evaluations and screening simulations are read off each run's own progress (laneParts), and the rest (the final
 *    simulation, ranking and steps: more extras' final runs and the displaced finalists' kept ones, a bigger Plan B pool and
 *    second list) is those stages with the
 *    lane less without, warm only; under the split, section 2's one search's parts and its total against the search
 *    without the lane (one run each).
 * 11. How to offer it (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1, and its "Checkpoint 7e must include":
 *    "Offers in order: the list for Parker's top 3 cards, with Helps you and the chance at each step, and the time to build
 *    it"; LadderSection, laddersOf, ladderRuns): under each setting (section 1's search, and section 2's under "Several prizes" on the split), the
 *    first LADDER_CARDS cards' offers in order, as the engine worker builds them when the card's "How to offer it" is opened
 *    (offers.ts, on the search's own state: its get pool for the partner, the versions it evaluated; until Checkpoint 7f the
 *    card's Plan B barred): each offer's place, players, Helps you and the chance as printed (with its label; "goes through"
 *    when the veto cuts it), "also trade idea N" when it is another card of the list, by its place there (the lead's call,
 *    wave D: the card's "Also shown as trade idea N."; "also “Helps both” idea N" for a card of that list alone), since
 *    Checkpoint 7f "merged: was trade idea N" when it is a trade the search merged into a card (by its place on the list
 *    without the merge), and the ladder's build
 *    time: each card's first open, right after each run's own search (laddersOf, the cards opened in order as in the
 *    worker: under section 1's setting after each of section 4's
 *    timed runs, under the split after each of ladderRuns' runs), the median over the runs (the review of wave D, D-ENG-10:
 *    this said "the median of LADDER_RUNS builds each on a fresh ladder store", which nothing measured), or since Checkpoint
 *    7f "kept" for a ladder the search's merge read (handed back as it is; its time is the search's "offers"); the candidates
 *    there were and how many the pre-screen let through to be played out (offers.ts preScreened; the review of wave D,
 *    D-ENG-1); and on the first TOP_DETAIL cards every candidate played out (ladderBetter, offers.ts ladderChoice's
 *    `every`): whether the pre-screen picks the same offers, and (⚠️ the lead's question, "how often a variant prints a
 *    higher Helps you and a higher chance than its card") the candidates that print both higher (those with a higher printed
 *    chance, the same on every block, simulated on the card's block), which the ladder's chance rules keep out.
 *    Checkpoint 7f (planner reply to Checkpoint 7e, decision 3, merged cards; mergeSection): under each setting the search's
 *    merges against the same search without them (TradeSearchOptions.mergeCards false, on the same context): each merged trade
 *    with its numbers, its place without the merge, the card it went into and its place among that card's offers; the cards that
 *    came in and those that left otherwise; the pairs kept with a label (a card whose offers hold a card above it, the holder
 *    below: the lead's call, policy (a)); the rounds, the ladders the merge read and their time ("offers": section 4's warm
 *    median under section 1's setting, section 2's one search under the split). Checkpoint 7g (planner reply to Checkpoint 7f,
 *    answer 3; mergeSection): the Last offers that ask for fewer of their players, with the share of the card's Overall each
 *    keeps; the versions dropped for a better version of the same trade, with what each gave way to; the ladders a preference
 *    changed, the usual offers against the preferring ones; and each label's shape (a smaller ask, the higher idea's lean
 *    version, a throw-in added, or another version) with why the higher idea's offers don't hold it (labelWhy). The final
 *    review of Checkpoint 7g (merge-ui-report-after-merge, the lead's ruling W3): a merged or dropped trade that wasn't a card
 *    without the merge says what let it in, a merge or a dropped version, when its list's records tell, else both (freedByOf,
 *    freedWords: it read "a card only after another merge" whatever did), the cards that left say the same of what pushed them
 *    off, and a merged Last offer reads "a card without the merge" only when it was one.
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
import { acceptance, betaNeed, displayAcceptance, type AcceptanceLeague, type PartnerProfile, type TradeAcceptanceInput } from "@/engine/acceptance";
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
import { heldOf, ladderChoice, ladderChoicesOf, ladderJobOfSearch, ladderNeighbors, offerFeasible, offerLadderOfSearch, openBar, overallOf, printedOf, type LadderCandidate, type LadderChoice } from "@/engine/offers";
import { smallerAskOf } from "@/engine/planB";
import { eliteIds, perceivedPackage, teamPremiums } from "@/engine/premium";
import { compareOverall } from "@/engine/rank";
import { atMostWaiverCredit, buildPools, helpsBothLaneOf, helpsBothPoolOf, leanCompanions, partnerCandidates, runRefilter, runTradeSearch, searchStateOf, shortlistOf, type SearchState } from "@/engine/search";
import { prizePeriods, type Reward } from "@/engine/reward";
import { buildSimSetup, pickupSeasonModel, shownSimsOf } from "@/engine/season";
import { GOALS, PROTECT_VALUE_LEVELS, defaultTradeSettings, normalizeTradeSettings, type Goal, type PrizeAmounts, type TradeSettings } from "@/engine/settings";
import { simNormals } from "@/engine/sim";
import type { HelpsBothList, InjuryTag, MergedCards, MergedTrade, OfferLadder, OfferStep, OfferStepKind, OpenSpot, TradeAsset, TradeDetail, TradeEvaluation, TradeEvaluationCore, TradeProposal, TradeSearchResult, TradeSearchStage } from "@/engine/tradeModel";
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
 * final runs. The second list's own work (its ranking, since Checkpoint 7f its merge's ladders, Plan B and words; its steps too until Checkpoint 7e) is interleaved with the Overall list's in one
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
 * What the helps-both lane costs inside one search (section 10; Checkpoint 7d, planner reply to Checkpoint 7c, answer 2), read
 * off its own yields: the search evaluates the lane's trades and their lean companions last (SearchState.lane), with an
 * "exact" yield after each trade chosen, so their exact evaluations are the time from the yield before the first of them to
 * the last; it simulates the exact trades in that order, a "simScreen" yield after every config.search.yieldEverySims of them
 * (and after the last; the partners' calibration runs before them yield at 0 done), so their screening simulations are the
 * time from where the lane's legal trades begin, ⚠️ a batch's time shared out evenly among its trades where they begin
 * inside one. Null without a state (a search stopped before ranking).
 */
export interface LaneParts {
  /** The lane's trades and companions chosen (an illegal one is evaluated too, and found illegal). */
  exact: { count: number; ms: number };
  /** The legal ones, simulated. */
  simScreen: { count: number; ms: number };
}

export function laneParts(ticks: readonly Tick[], start: number, state: Pick<SearchState, "lane" | "exactByKey"> | null): LaneParts | null {
  if (!state) return null;
  const at = (i: number): number => (i >= 0 ? (ticks[i] as Tick).t : start);
  const chosen = state.lane.trades.length + state.lane.companions.length;
  const legal = [...state.lane.trades, ...state.lane.companions].filter((k) => state.exactByKey.has(k)).length;
  const exact = { count: chosen, ms: 0 };
  const exactAt = ticks.flatMap((k, i) => (k.stage === "exact" ? [i] : []));
  if (chosen > 0 && exactAt.length >= chosen) {
    const first = exactAt.length - chosen;
    const before = first > 0 ? (exactAt[first - 1] as number) : (exactAt[0] as number) - 1;
    exact.ms = at(exactAt.at(-1) as number) - at(before);
  }
  const simScreen = { count: legal, ms: 0 };
  const simsAt = ticks.flatMap((k, i) => (k.stage === "simScreen" && k.done > 0 ? [i] : []));
  const n = simsAt.length ? (ticks[simsAt.at(-1) as number] as Tick).done : 0;
  const from = n - legal;
  let prev = 0;
  for (const i of simsAt) {
    const d = (ticks[i] as Tick).done;
    const mine = d - Math.max(prev, from);
    if (legal > 0 && mine > 0 && d > prev) simScreen.ms += (at(i) - at(i - 1)) * (mine / (d - prev));
    prev = d;
  }
  return { exact, simScreen };
}

/**
 * The search without "Helps them" (section 10; ⚠️ ours, the engine test's way: search.helpsBoth.test.ts, "the Overall list is
 * what it is without the second list"): before the search, every team's calibration run is set to none in the context's memo
 * (evaluate.ts SimState.partners), so no partner's scale is known: no calibration run, Helps them unknown on every trade, no
 * "Helps both" extra and an empty second list. What's left of the feature is each run's partner numbers from the same two
 * runs (evaluate.ts partnerNumbersOf), next to nothing. Since Checkpoint 7e on both blocks' memos (SimState.partners, the shown
 * block's, and SimState.rank.partners, the ranking block's: the search chooses on the one and shows the other). The context,
 * changed in place, is returned.
 */
export function withoutHelpsThem(ctx: TradeContext): TradeContext {
  const I = tradeInternals(ctx);
  if (I.sim) for (const t of I.teams) for (const runs of [I.sim.partners, I.sim.rank.partners]) runs.set(t.id, null);
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
  /** Section 10 (Checkpoint 7d): the run's helps-both lane parts, read off its own progress (laneParts); null when it stopped before ranking. */
  lane: LaneParts | null;
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

/**
 * One search on its own context, timed, with its progress kept on the clock for its "Helps both" parts and its lane parts
 * (helpsBothParts, laneParts: a timestamp a yield, next to nothing against a search). `lane` false: without the helps-both
 * lane (TradeSearchOptions.helpsBothLane, Checkpoint 7d).
 */
function timedRun(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: SearchRunOptions & { exhaustive?: boolean; helpsThem?: boolean; lane?: boolean }): { ctx: TradeContext; result: TradeSearchResult; run: RuntimeRun } {
  const { clock } = opts;
  const t0 = clock();
  const ctx = buildTradeContext(snapshot, inputs, { now: opts.now, clock, settings: opts.settings, ...(opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {}) });
  if (opts.helpsThem === false) withoutHelpsThem(ctx);
  const ticks: Tick[] = [];
  const start = clock();
  const result = runTradeSearch(ctx, { clock, settings: opts.settings, ...(opts.exhaustive === false ? { exhaustive: false } : {}), ...(opts.lane === false ? { helpsBothLane: false } : {}) }, (p) => ticks.push({ t: clock(), stage: p.stage, done: p.done }));
  const total = clock() - t0;
  const state = searchStateOf(result);
  return { ctx, result, run: { context: { ...ctx.timings }, search: { ...result.timings }, total, signature: signatureOf(result), parts: helpsBothParts(ticks, start, state), lane: laneParts(ticks, start, state) } };
}

/** A set of runs that ran beside the timed ones (timedSearches' pairedWithout and pairedNoLane): the last one's context and result, and the set's runtime. */
export interface PairedRuns {
  ctx: TradeContext;
  result: TradeSearchResult;
  runtime: Runtime;
}

/**
 * The default search `warmups` + `runs` times, each with its own context (`exhaustive` false: the beams alone; `helpsThem`
 * false: without "Helps them", withoutHelpsThem); the last run's context and result. `pairedWithout` (section 10): after each
 * timed run, the same search without "Helps them" on its own context, so each pair runs side by side in the process (⚠️ run
 * as a set afterwards, they came out faster on stages Helps them doesn't touch, screening and exact evaluation, as the JIT
 * kept warming up: 388 ms against 496 ms on the test league's screening); its runs come back as `without`. `pairedNoLane`
 * (section 10, Checkpoint 7d): after that, the same search without the helps-both lane on its own context (its runs:
 * `noLane`). `ladders` (section 11, Checkpoint 7e): then the first that many cards' "How to offer it" on each timed run's
 * own search, as the worker builds them when first opened (laddersOf, after the paired runs, so their timings are as
 * before): the last run's ladders with every timed run's first opens (`ladders`; null without the option).
 */
export function timedSearches(
  snapshot: LeagueSnapshot,
  inputs: ModelInputs,
  opts: SearchRunOptions & { exhaustive?: boolean; helpsThem?: boolean; pairedWithout?: boolean; pairedNoLane?: boolean; ladders?: number },
): { ctx: TradeContext; result: TradeSearchResult; runtime: Runtime; without: PairedRuns | null; noLane: PairedRuns | null; ladders: LadderRow[] | null } {
  const all: RuntimeRun[] = [];
  const paired: RuntimeRun[] = [];
  const pairedNoLane: RuntimeRun[] = [];
  const ladderTimes: number[][] = [];
  let ladders: LadderRow[] | null = null;
  let last: { ctx: TradeContext; result: TradeSearchResult } | null = null;
  let lastWithout: { ctx: TradeContext; result: TradeSearchResult } | null = null;
  let lastNoLane: { ctx: TradeContext; result: TradeSearchResult } | null = null;
  const warmups = Math.max(0, Math.floor(opts.warmups));
  const total = warmups + Math.max(1, Math.floor(opts.runs));
  for (let i = 0; i < total; i++) {
    const r = timedRun(snapshot, inputs, opts);
    all.push(r.run);
    last = { ctx: r.ctx, result: r.result };
    if (i < warmups) continue;
    if (opts.pairedWithout) {
      const w = timedRun(snapshot, inputs, { ...opts, helpsThem: false });
      paired.push(w.run);
      lastWithout = { ctx: w.ctx, result: w.result };
    }
    if (opts.pairedNoLane) {
      const w = timedRun(snapshot, inputs, { ...opts, lane: false });
      pairedNoLane.push(w.run);
      lastNoLane = { ctx: w.ctx, result: w.result };
    }
    if (opts.ladders) {
      ladders = laddersOf(r.result, opts.ladders, opts.clock);
      ladders.forEach((row, k) => (ladderTimes[k] ??= []).push(...row.ms));
    }
  }
  const done = last as { ctx: TradeContext; result: TradeSearchResult };
  return {
    ...done,
    runtime: runtimeOf(all, warmups),
    without: lastWithout ? { ...lastWithout, runtime: runtimeOf(paired, 0) } : null,
    noLane: lastNoLane ? { ...lastNoLane, runtime: runtimeOf(pairedNoLane, 0) } : null,
    ladders: ladders ? ladders.map((row, k) => ({ ...row, ms: ladderTimes[k] ?? row.ms })) : null,
  };
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
 * The counts the planner asks for: cards, with Plan B, receiving an injury-tagged player (the card's own tags), and the Plan
 * B boxes receiving one (`tagsOf`, the search's rule: review of track R, R-2, the injured targets a Plan B asks for were
 * uncounted). Until Checkpoint 7e also the cards with "Offer first / if they say no" steps (planner reply to Checkpoint 7d,
 * item 4.1: no card has them now; its offers are section 11's, worked out when it's opened).
 */
export interface CardCounts {
  shown: number;
  planB: number;
  injuredGet: number;
  planBInjuredGet: number;
}

export function cardCounts(trades: readonly TradeEvaluation[], tagsOf: Tagger): CardCounts {
  return {
    shown: trades.length,
    planB: trades.filter((t) => t.planB).length,
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
  /** Section 10 (Checkpoint 7d): with a clock, the other search's helps-both lane parts read off its own progress (laneParts); else null. */
  lane: LaneParts | null;
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
    lane: clock ? laneParts(ticks, start, searchStateOf(result)) : null,
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
   * In the exactEvaluationMax shortlist over every partner; in the helps-both lane or among its lean companions (Checkpoint
   * 7d: SearchState.lane); evaluated exactly (legal); a finalist the ranking picked; a "Helps both" extra (a final run only
   * that list ranks: SearchState.helpsBothExtras, Checkpoint 7c); its card's place.
   */
  shortlisted: boolean;
  lane: boolean;
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
   * rebuilt here (search.shortlistOf with search.atMostWaiverCredit, the search's own call), among its lean companions
   * (search.leanCompanions on that shortlist, as the search calls it) or, since Checkpoint 7d, in the helps-both lane or
   * among its lean companions (search.helpsBothLaneOf and leanCompanions, as the search calls them); `lane`: that lane and
   * its companions are the search's own (SearchState.lane), in its order. Null when nothing was screened.
   */
  reproduces: { counts: boolean; shortlist: boolean; lane: boolean } | null;
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
  const empty: SearchGap = { trade, missing, screened: null, beams: false, inWindow: null, kept: null, shortlisted: false, lane: false, exact: false, finalist: false, extra: false, card: null, evaluation: null, bestSameFamily: null, perPartner: [], reproduces: null, beamsKeys: 0, onlyExhaustive: { exact: 0, finalRuns: 0, cards: 0 } };
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
  const cheap = atMostWaiverCredit(I);
  const shortlist = shortlistOf(lists, cheap);
  const shortKeys = new Set(shortlist.map((x) => x.key));
  // The search evaluates the shortlist's lean companions too (search.leanCompanions, its own call on that shortlist), then
  // (Checkpoint 7d) the helps-both lane past them and its own companions (search.helpsBothLaneOf; the lane's size as the
  // search ran it: none when it ran without the lane).
  const companions = drain(leanCompanions(I, shortlist, lists, pools)).map((x) => x.key);
  const taken = new Set([...shortKeys, ...companions]);
  const lane = helpsBothLaneOf(lists, taken, cheap, state.lane.trades.length ? config.search.helpsBothLane : 0).trades;
  const laneCompanions = drain(leanCompanions(I, lane, lists, pools, { screened: 0 }, taken)).map((x) => x.key);
  const laneKeys = new Set([...lane.map((x) => x.key), ...laneCompanions]);
  const evaluated = new Set([...taken, ...laneKeys]);
  const sameKeys = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i]);
  const reproduces = {
    counts: perPartner.reduce((n, p) => n + p.exhaustive, 0) === result.counts.screened,
    shortlist: exactKeys.every((k) => evaluated.has(k)),
    lane: sameKeys(lane.map((x) => x.key), state.lane.trades) && sameKeys(laneCompanions, state.lane.companions),
  };
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
    lane: laneKeys.has(trade.key),
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
 * extras: section 10)"; "60 finalists" without an extra. Since Checkpoint 7d (the final review, ENG-7D-1) the finalists the
 * helps-both lane displaced, kept for that list (SearchState.laneDisplaced, among helpsBothExtras), are named apart: "67
 * final runs (60 finalists, 5 "Helps both" extras and 2 finalists the helps-both lane displaced: section 10)".
 */
export function finalRunsText(result: TradeSearchResult): string {
  const n = result.counts.simFinal;
  const st = searchStateOf(result);
  const extras = st?.helpsBothExtras.length ?? 0;
  if (!extras) return `${n} finalists`;
  const displaced = st?.laneDisplaced.length ?? 0;
  const pool = extras - displaced;
  const parts = [`${n - extras} finalists`, ...(pool ? [`${pool} "Helps both" extra${pool === 1 ? "" : "s"}`] : []), ...(displaced ? [`${displaced} finalist${displaced === 1 ? "" : "s"} the helps-both lane displaced`] : [])];
  const words = parts.length > 2 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts.join(" and ");
  return `${n} final runs (${words}: section 10)`;
}

/**
 * A search's exact trades in words (section 4): since Checkpoint 7d counts.exact holds the helps-both lane's legal trades
 * and lean companions too (SearchState.lane; planner reply to Checkpoint 7c, answer 2), so "248 exact (45 from the helps-both
 * lane: section 10)"; "203 exact" without any.
 */
export function exactText(result: TradeSearchResult): string {
  const n = result.counts.exact;
  const st = searchStateOf(result);
  const lane = st ? [...st.lane.trades, ...st.lane.companions].filter((k) => st.exactByKey.has(k)).length : 0;
  return lane ? `${n} exact (${lane} from the helps-both lane: section 10)` : `${n} exact`;
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
 * One search's trades that help both teams at each stage (section 10; benefit.helpsBoth: Helps you and Helps them each at
 * least config.benefit.helpsThemMin, as printed: planner reply to Checkpoint 7c, answer 5, where Checkpoint 7c read "Helps
 * you above 0"), read off its state: the exact trades on their screening numbers (the run the extras are chosen on), the
 * extras' pool (search.ts helpsBothPoolOf, as finalistsOf reads it: by B among those that help both and that the §10 guards
 * don't hide, the first config.search.helpsBothFinalists, since Checkpoint 7d one more for each from the helps-both lane: the
 * room; the extras, the pool's trades the ranking hadn't picked already), the finalists the ranking picked and the extras on
 * their final numbers, the Overall cards, and the "Helps both" list.
 */
export interface HelpsBothCounts {
  /**
   * The exact trades on the screening run: Helps you at least the minimum (as printed; above 0 until answer 5), the partner's B
   * above 0, Helps them at least the minimum, both (helpsBoth), and of those the ones the §10 guards don't hide (the extras'
   * candidates).
   */
  exact: { total: number; helpsYou: number; theirB: number; helpsThem: number; both: number; shown: number };
  /**
   * The room (helpsBothFinalists, one more for each candidate from the helps-both lane: review of the lane, LANE-2), the pool
   * (its first `room` candidates), how many of those the ranking had already picked (counted, never a difference: the final
   * review, ENG-7D-2), the extras (the pool's others), and the extras that still help both on the final run. The finalists the
   * lane displaced (SearchState.laneDisplaced, among SearchState.helpsBothExtras) aren't in the pool: section 10's lane table
   * counts them.
   */
  room: number;
  pool: number;
  picked: number;
  extras: number;
  stillBoth: number;
  /** The finalists the ranking picked (every trade only the "Helps both" list ranks left out) and the Overall cards, each with those that help both on their final numbers (the cards' tag). */
  finalists: { total: number; both: number };
  cards: { total: number; both: number };
  /** TradeSearchResult.helpsBoth, with how many of its cards the Overall list shows too and how many only it ranks (SearchState.helpsBothExtras: the extras, and the finalists the lane displaced). */
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
  // The pool as the search chose it (search.ts helpsBothPoolOf): the room one wider for each of its candidates from the lane.
  const { room, pool } = helpsBothPoolOf(screen, new Set([...state.lane.trades, ...state.lane.companions]));
  const extras = new Set(state.helpsBothExtras);
  const regular = state.finals.filter((f) => !extras.has(f.key));
  const ranked = new Set(regular.map((f) => f.key));
  const poolExtras = new Set(pool.filter((c) => !ranked.has(c.key)).map((c) => c.key));
  const overall = new Set(result.trades.map((t) => t.key));
  return {
    exact: {
      total: screen.length,
      helpsYou: screen.filter((c) => finite(c.tradeScore) && c.tradeScore >= min).length,
      theirB: screen.filter((c) => finite(c.them?.b) && (c.them?.b as number) > 0).length,
      helpsThem: screen.filter((c) => finite(c.them?.helps) && (c.them?.helps as number) >= min).length,
      both: screen.filter((c) => helpsBoth(c)).length,
      shown,
    },
    room,
    pool: pool.length,
    picked: pool.filter((c) => ranked.has(c.key)).length,
    extras: poolExtras.size,
    stillBoth: state.finals.filter((f) => poolExtras.has(f.key) && helpsBoth(f)).length,
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
  /** The second list's own work (its ranking, since Checkpoint 7f its merge's ladders, Plan B and words; its steps too until Checkpoint 7e), warm only: the ranking stage (rank + steps + shown + offers) with Helps them less without, medians (⚠️ a difference of medians). */
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
  // Since Checkpoint 7e the shown pass (its own timing, "shown": the second list's cards and boxes on the shown block, and each
  // partner's "Helps them" scale there) is the second list's work too, and since Checkpoint 7f its merge's ladders ("offers").
  const rankSteps = (r: RuntimeRun): number => (r.search.rank ?? 0) + (r.search.steps ?? 0) + (r.search.shown ?? 0) + (r.search.offers ?? 0);
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

/**
 * One search's helps-both lane (section 10; Checkpoint 7d, planner reply to Checkpoint 7c, answer 2; search.ts
 * helpsBothLaneOf), read off its state: the screened trades past screening's rules on which both lineups gain, those the
 * shortlist and its lean companions held, the lane, its lean companions and how many of them (both) were legal; then of
 * those, the ones that help both on the screening run, the finalists the ranking picked, the extras, the finalists and
 * extras that help both on their final numbers, and the cards of each list; and (⚠️ the final review, ENG-7D-1) the
 * finalists the ranking would pick without the lane that its trades displaced, kept for the "Helps both" list
 * (SearchState.laneDisplaced), of them those that help both on the final run and those on that list.
 */
export interface LaneCounts {
  qualifying: number;
  onShortlist: number;
  trades: number;
  companions: number;
  exact: number;
  screenBoth: number;
  finalists: number;
  extras: number;
  finalBoth: number;
  list: number;
  overall: number;
  displaced: { kept: number; both: number; listed: number };
}

/** A search's LaneCounts; null when it stopped before ranking. */
export function laneCounts(result: TradeSearchResult): LaneCounts | null {
  const st = searchStateOf(result);
  if (!st) return null;
  const fromLane = new Set([...st.lane.trades, ...st.lane.companions]);
  const legal = [...fromLane].filter((k) => st.exactByKey.has(k));
  const extras = new Set(st.helpsBothExtras);
  const finals = st.finals.filter((f) => fromLane.has(f.key));
  const displaced = new Set(st.laneDisplaced);
  const listed = result.helpsBoth?.trades ?? [];
  return {
    qualifying: st.lane.qualifying,
    onShortlist: st.lane.onShortlist,
    trades: st.lane.trades.length,
    companions: st.lane.companions.length,
    exact: legal.length,
    screenBoth: legal.filter((k) => {
      const c = st.versions.get(k)?.screen;
      return c !== undefined && helpsBoth(c);
    }).length,
    finalists: finals.filter((f) => !extras.has(f.key)).length,
    extras: finals.filter((f) => extras.has(f.key)).length,
    finalBoth: finals.filter((f) => helpsBoth(f)).length,
    list: listed.filter((t) => fromLane.has(t.key)).length,
    overall: result.trades.filter((t) => fromLane.has(t.key)).length,
    displaced: {
      kept: displaced.size,
      both: st.finals.filter((f) => displaced.has(f.key) && helpsBoth(f)).length,
      listed: listed.filter((t) => displaced.has(t.key)).length,
    },
  };
}

/** The Overall cards of `on` that `off` doesn't show (section 10: with the lane against without it), by key. */
export function cardsNotIn(on: TradeSearchResult, off: TradeSearchResult): number {
  return keysNotIn(on.trades, off.trades);
}

/** The trades of `a` that `b` doesn't hold, by key. */
const keysNotIn = (a: readonly { key: string }[], b: readonly { key: string }[]): number => {
  const keys = new Set(b.map((t) => t.key));
  return a.filter((t) => !keys.has(t.key)).length;
};

/** The Finder's "Left out on purpose" counts (TradeSearchResult.hidden): ideas that wouldn't help you, that give up much more trade value, under the minimum chance. */
export interface LeftOut {
  benefit: number;
  market: number;
  chance: number;
}

/**
 * What else the lane changes on the Finder (section 10; review of the lane, LANE-1: cardsNotIn reads card keys only), with
 * the lane (`on`) against the same search without it (`off`): the Overall cards both show, and of them those whose Plan B box
 * differs (by key; until Checkpoint 7e also those whose offer-first step did: planner reply to Checkpoint 7d, item 4.1, no card
 * has steps now); the "Helps both" list's cards with the lane that the list without it
 * doesn't show (`added`), the other way (`dropped`), and its cards with the lane; the final runs of the search without the
 * lane (its finalists and its "Helps both" extras) whose Helps them is known, the "Helps both" list's candidates, that the
 * search with it doesn't make, and of them those on that list without it (`finalsLost`; review of the lane, LANE-2: as first
 * built, the plain top config.search.helpsBothFinalists by B, chosen without the minimum chance, the lane's long shots could
 * take an extra's place, so the lead widened the extras' room by one for each lane trade; the final review, ENG-7D-1: a
 * finalist the lane's trades push out that helps both only on its final numbers lost its final run too, so search.ts
 * finalistsOf keeps those, SearchState.laneDisplaced; so this reads 0, a guard; none when either search stopped before
 * ranking); and the Finder's "checked N closely" (counts.exact) and "Left out on purpose" counts, without and with.
 */
export interface LaneShown {
  shared: { cards: number; box: number };
  list: { added: number; dropped: number; cards: number };
  finalsLost: { count: number; listed: number };
  exact: { without: number; with: number };
  leftOut: { without: LeftOut; with: LeftOut };
}

export function laneShown(on: TradeSearchResult, off: TradeSearchResult): LaneShown {
  const offBy = new Map(off.trades.map((t) => [t.key, t]));
  const shared = { cards: 0, box: 0 };
  for (const t of on.trades) {
    const o = offBy.get(t.key);
    if (!o) continue;
    shared.cards++;
    if ((t.planB?.key ?? null) !== (o.planB?.key ?? null)) shared.box++;
  }
  const listOn = on.helpsBoth?.trades ?? [];
  const listOff = off.helpsBoth?.trades ?? [];
  const stOn = searchStateOf(on);
  const stOff = searchStateOf(off);
  const finalsOn = new Set((stOn?.finals ?? []).map((f) => f.key));
  const listedOff = new Set(listOff.map((t) => t.key));
  const lost = stOn && stOff ? stOff.finals.filter((f) => finite(f.them?.helps) && !finalsOn.has(f.key)).map((f) => f.key) : [];
  const leftOut = (r: TradeSearchResult): LeftOut => ({ benefit: r.hidden.byBenefit, market: r.hidden.byMarket, chance: r.hidden.byChance ?? 0 });
  return {
    shared,
    list: { added: keysNotIn(listOn, listOff), dropped: keysNotIn(listOff, listOn), cards: listOn.length },
    finalsLost: { count: lost.length, listed: lost.filter((k) => listedOff.has(k)).length },
    exact: { without: off.counts.exact, with: on.counts.exact },
    leftOut: { without: leftOut(off), with: leftOut(on) },
  };
}

/**
 * What the helps-both lane costs (section 10; the file header): section 4's runs (`main`, the app's search: its first run
 * the only cold search in the process) against the same search without the lane (`noLane`: one warm run right after each of
 * the timed ones, each on its own context: timedSearches' pairedNoLane).
 */
export interface LaneCost {
  /** The lane's exact evaluations and its trades' screening simulations, each read off its run's progress (laneParts): the cold run's, and the median of the timed runs'. */
  exact: { count: number; cold: number | null; warm: number | null };
  simScreen: { count: number; cold: number | null; warm: number | null };
  /** The rest, warm only: the final simulation, ranking and steps stages with the lane less without, medians (more extras' final runs and the displaced finalists' kept ones, a bigger Plan B pool and second list; ⚠️ a difference of medians). */
  rest: number | null;
  /** The three parts (cold: the cold run's own lane parts and the warm rest, ⚠️). */
  extra: { cold: number | null; warm: number | null };
  /** The search's total with the lane (section 4's cold run and warm median), and the runs without it as measured: their median and the largest spread of the search totals within either set (null without 2 timed runs in a set). */
  with: { cold: number | null; warm: number | null };
  measured: { without: number | null; spread: number | null };
}

/**
 * The stages the lane's rest is read from (search.ts: the extras' final runs, Plan B's pool and the second list come after the
 * screening simulation), and since Checkpoint 7e the shown pass ("shown", added when the run has it: laneCost), since
 * Checkpoint 7f the merge's ladders ("offers", the same way).
 */
export const LANE_REST_STAGES = ["simFinal", "rank", "steps"] as const;

export function laneCost(main: Runtime, noLane: Runtime): LaneCost {
  const warm = (rows: readonly RuntimeRun[], f: (r: RuntimeRun) => number | null | undefined): number | null => {
    const xs = rows.map(f).filter(finite);
    return xs.length ? median(xs) : null;
  };
  const spreadOf = (rows: readonly RuntimeRun[]): number | null => {
    const xs = rows.map((r) => r.search.total).filter(finite);
    return xs.length >= 2 ? Math.max(...xs) - Math.min(...xs) : null;
  };
  const rest = (r: RuntimeRun): number | null => (LANE_REST_STAGES.every((k) => finite(r.search[k])) ? LANE_REST_STAGES.reduce((acc, k) => acc + (r.search[k] as number), 0) + (r.search.shown ?? 0) + (r.search.offers ?? 0) : null);
  const withRest = warm(main.runs, rest);
  const withoutRest = warm(noLane.runs, rest);
  const cold = main.cold.lane;
  const exact = { count: cold?.exact.count ?? 0, cold: cold?.exact.ms ?? null, warm: warm(main.runs, (r) => r.lane?.exact.ms) };
  const simScreen = { count: cold?.simScreen.count ?? 0, cold: cold?.simScreen.ms ?? null, warm: warm(main.runs, (r) => r.lane?.simScreen.ms) };
  const restMs = finite(withRest) && finite(withoutRest) ? withRest - withoutRest : null;
  const sum = (xs: readonly (number | null)[]): number | null => (xs.every(finite) ? xs.reduce((s: number, x) => s + (x as number), 0) : null);
  const spreads = [spreadOf(main.runs), spreadOf(noLane.runs)].filter(finite);
  return {
    exact,
    simScreen,
    rest: restMs,
    extra: { cold: sum([exact.cold, simScreen.cold, restMs]), warm: sum([exact.warm, simScreen.warm, restMs]) },
    with: { cold: finite(main.cold.search.total) ? (main.cold.search.total as number) : null, warm: warm(main.runs, (r) => r.search.total) },
    measured: { without: warm(noLane.runs, (r) => r.search.total), spread: spreads.length ? Math.max(...spreads) : null },
  };
}

/** Section 10's helps-both lane (the file header): its counts and the counts without it under each setting, the Overall cards it changes, what else it changes on the Finder, and what it costs. */
export interface LaneSection {
  counts: { title: LaneCounts | null; other: LaneCounts | null };
  /** HelpsBothCounts for the same search without the lane: section 4's last paired run (title), the split's search again (other). */
  before: { title: HelpsBothCounts | null; other: HelpsBothCounts | null };
  /** The Overall cards with the lane that the search without it doesn't show. */
  differs: { title: number; other: number };
  /** What else it changes on the Finder (laneShown: the boxes and steps of the cards both show, the "Helps both" list's cards, the extras it pushes out, the exact and left-out counts). */
  shown: { title: LaneShown; other: LaneShown };
  cost: LaneCost;
  /** Under the split: section 2's one search's lane parts and total, and the search without the lane's total on the same context (one warm run each); null without a clock. */
  split: { parts: LaneParts | null; with: number | null; without: number | null } | null;
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
  /** Checkpoint 7d: the helps-both lane (LaneSection). */
  lane: LaneSection;
}

/**
 * The searches without the helps-both lane that section 10 reads (Checkpoint 7d): section 4's runs paired with one each
 * (timedSearches' pairedNoLane), and the same search as section 2's on a context of its own, built the same way, so its
 * partners' calibration runs aren't free (`split`, with its total when timed).
 */
export interface NoLaneRuns {
  paired: PairedRuns;
  split: { result: TradeSearchResult; total: number | null };
}

/** Section 10: the counts under each setting, the split's scales, and the extra runtime against the search without Helps them; the lane's against the search without it. */
export function helpsBothSection(main: { result: TradeSearchResult; runtime: Runtime }, goals: GoalCompare, without: { ctx: TradeContext; result: TradeSearchResult; runtime: Runtime }, noLane: NoLaneRuns): HelpsBothSection {
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
    lane: {
      counts: { title: laneCounts(main.result), other: laneCounts(goals.result) },
      before: { title: helpsBothCounts(noLane.paired.result), other: helpsBothCounts(noLane.split.result) },
      differs: { title: cardsNotIn(main.result, noLane.paired.result), other: cardsNotIn(goals.result, noLane.split.result) },
      shown: { title: laneShown(main.result, noLane.paired.result), other: laneShown(goals.result, noLane.split.result) },
      cost: laneCost(main.runtime, noLane.paired.runtime),
      split: goals.lane ? { parts: goals.lane, with: finite(goals.result.timings.total) ? (goals.result.timings.total as number) : null, without: noLane.split.total } : null,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Section 11: How to offer it (planner reply to Checkpoint 7d, item 4.1)

/** Section 11: the cards whose offers in order are listed (the planner: "the list for Parker's top 3 cards"). */
export const LADDER_CARDS = 3;

/** An offer's place in the card's own words (the lead's addendum for wave D: "Open with", "Then", "The suggested trade", "Last offer"). */
export const OFFER_WORDS: Readonly<Record<OfferStepKind, string>> = { open: "Open with", then: "Then", suggested: "The suggested trade", last: "Last offer" };

/**
 * One card's offers in order (section 11; the file header): the card, its ladder (offers.ts, as the engine worker builds it),
 * the candidates there were (`candidates`) and the legal ones the pre-screen let through to be played out (`screened`), and
 * its first opens' build times, one per run (laddersOf); since Checkpoint 7f whether the search kept it (`kept`: its merge
 * read it, so a first open hands it back as it is, and its time is the search's "offers").
 */
export interface LadderRow {
  card: TradeEvaluation;
  ladder: OfferLadder;
  candidates: number;
  screened: number;
  ms: number[];
  kept: boolean;
}

/** A candidate of a card's ladder that prints a higher Helps you and a higher chance than the card (ladderBetter). */
export interface BetterVariant {
  kind: LadderCandidate["kind"];
  proposal: TradeProposal;
  tradeScore: number | null;
  pComplete: number;
}

/**
 * For one card (ladderBetter): its legal candidates, every one played out, those that print a higher chance, and of them those
 * that also print a higher Helps you; and whether the pre-screen picks the same offers as every candidate does (`same`).
 */
export interface LadderBetter {
  card: TradeEvaluation;
  screened: number;
  likelier: number;
  better: BetterVariant[];
  same: boolean;
}

/**
 * Section 11 under one setting: the first LADDER_CARDS cards' ladders, the first TOP_DETAIL cards' better variants, and since
 * Checkpoint 7f the merge (null when the search stopped before ranking).
 */
export interface LadderSetting {
  rows: LadderRow[];
  better: LadderBetter[];
  merge: MergeSection | null;
}

/** One of a search's lists (section 11's merge). */
export type ListName = "overall" | "helpsBoth";

/**
 * What let a trade onto its list after the first ranking, or pushed a card off it (section 11's merge; the final review of
 * Checkpoint 7g, merge-ui-report-after-merge, the lead's ruling W3): other trades leaving the list, merged into a card's offers
 * ("merge") or, since Checkpoint 7g (planner reply to Checkpoint 7f, answer 3(c)), dropped for a better version of the same
 * trade ("drop"); "either" when both could have, or the records can't tell (freedByOf). Until then section 11 said "a card only
 * after another merge" whatever let it in: on Parker's league 1, Oct 15, under his prizes, Kyle Monangai → Tony Pollard + Blake
 * Corum came in only after the (c) drop of Puka Nacua → Nico Collins + Tetairoa McMillan (a replay of the rounds at the review;
 * ⚠️ the records can't tell it, a merge having been folded before it too, so it reads "either": naming it would take a search
 * without the drops, or the engine recording each round's events).
 */
export type FreedBy = "merge" | "drop" | "either";

/**
 * FreedBy from a search's merge records (MergedCards: each list's merges in the order they were folded, its dropped versions in
 * the order they were dropped). A list's places are freed by its own merges and drops (search.ts settle ranks each list again
 * without its own merged and dropped trades), so a trade that wasn't a card without the merge came onto it after one of those.
 * `self`, the row's own trade: a merged one reads only the merges folded before it (one folded after it came after it was a
 * card), a dropped one only the drops before it (likewise); without `self` (a card that left), everything on the list. "merge"
 * or "drop" when only that kind is left, else "either". ⚠️ The records hold every merge and drop only while nothing was given
 * back (MergedCards.released, a merged trade given back, and MergedCards.restored, a dropped version given back: the final
 * review's E2; either is in neither list, though its merge or drop freed a place), so "either" then.
 */
export function freedByOf(merged: MergedCards | null, list: ListName, self?: { kind: "merged" | "dropped"; key: string }): FreedBy {
  if (!merged || merged.released > 0 || (merged.restored ?? 0) > 0) return "either";
  const before = (keys: readonly string[], kind: "merged" | "dropped"): readonly string[] => {
    if (self?.kind !== kind) return keys;
    const at = keys.indexOf(self.key);
    return at < 0 ? keys.filter((k) => k !== self.key) : keys.slice(0, at);
  };
  const merges = before(merged[list].map((m) => m.key), "merged").length > 0;
  const drops = before((merged.dominated ?? []).filter((d) => d.list === list).map((d) => d.key), "dropped").length > 0;
  return merges && !drops ? "merge" : drops && !merges ? "drop" : "either";
}

/**
 * A trade merged into another card's "How to offer it" (section 11; Checkpoint 7f, planner reply to Checkpoint 7e, decision 3;
 * search.ts, "Merged cards"): its numbers as it printed as a card, its place on its list without the merge (`was`; null: it
 * wasn't a card without the merge, and `freed` says what let it in: the final review of Checkpoint 7g, where this read "it came
 * in after another merge"), the card it went into with that card's place, and its own place among that card's offers.
 */
export interface MergeRow {
  list: ListName;
  trade: TradeEvaluationCore;
  was: number | null;
  /** Null when `was` isn't (freedByOf, the row's own trade read as merged). */
  freed: FreedBy | null;
  into: TradeEvaluation;
  intoPlace: number;
  kind: MergedTrade["kind"];
}

/**
 * The shape of a holder-below pair (section 11; Checkpoint 7f's "the holder below", Checkpoint 7g's rules), `higher` the card
 * above on Overall, `lower` the one whose offers hold it: "smaller", the lower card asks for fewer of their players for the
 * same players of mine (offers.ts smallerAsks: since Checkpoint 7g the higher card's Last offer can be it, when it keeps at
 * least config.offers.lastMinOverallShare of its Overall); "lean", the lower card is the higher one without one player of
 * mine (the higher card's lean version, its Open or a Then by the rules); "throwIn", the lower card is the higher one plus
 * one player of mine (the higher card's Last offer by the throw-in's rule); "other", none of these.
 */
export type LabelShape = "smaller" | "lean" | "throwIn" | "other";

/** A card whose offers hold a card of its list above it on Overall (the holder below): both stay, that offer labeled (the lead's call, policy (a)). */
export interface LabelPair {
  list: ListName;
  holder: TradeEvaluation;
  holderPlace: number;
  held: TradeEvaluation;
  heldPlace: number;
  kind: OfferStepKind;
  /** Checkpoint 7g: the pair's shape and, in words, why the higher card's offers don't hold the lower one (labelWhy). */
  shape: LabelShape;
  why: string;
}

/**
 * A card whose Last offer asks for fewer of their players (section 11; Checkpoint 7g, planner reply to Checkpoint 7f, answer
 * 3(a)): the card, its place, that offer's printed numbers, the share of the card's Overall it keeps (both unrounded:
 * offers.ts overallOf; the rule's config.offers.lastMinOverallShare), whether the offer is a trade the search merged, and its
 * place without the merge when it was a card there (`was`, its MergeRow's: the final review of Checkpoint 7g,
 * merge-ui-report-after-merge, where every merged one read "a card without the merge"); null otherwise.
 */
export interface SmallerLastRow {
  list: ListName;
  card: TradeEvaluation;
  place: number;
  offer: TradeEvaluationCore;
  share: number | null;
  merged: boolean;
  was: number | null;
}

/**
 * A version dropped for a better version of the same trade (section 11; Checkpoint 7g, planner reply to Checkpoint 7f, answer
 * 3(c); TradeSearchResult.merged.dominated): its printed numbers, its place without the merge (null: it wasn't a card there,
 * and `freed` says what let it in), and the version it gave way to with where that one is ("idea N", or among the offers of
 * the idea it was merged into).
 */
export interface DroppedRow {
  list: ListName;
  trade: TradeEvaluationCore;
  was: number | null;
  /** Null when `was` isn't (freedByOf, the row's own trade read as dropped). */
  freed: FreedBy | null;
  by: TradeEvaluationCore | null;
  byWhere: string;
}

/** One offer of a ladder choice (PreferredRow). */
export interface ChoiceOffer {
  kind: Exclude<OfferStepKind, "suggested">;
  printed: TradeEvaluationCore;
}

/**
 * A card whose ladder its preference changed (section 11; Checkpoint 7g, planner reply to Checkpoint 7f, answer 3(b): "When
 * more than one version meets a step's rules, prefer the one that's on the list, so it merges."): the usual ladder's offers
 * and the preferring one's, kept because it holds more of the card's preferred versions (offers.ts ladderChoiceSteps), with
 * the preferred versions it holds.
 */
export interface PreferredRow {
  list: ListName;
  card: TradeEvaluation;
  place: number;
  usual: ChoiceOffer[];
  preferring: ChoiceOffer[];
  held: string[];
}

/**
 * Section 11's merge under one setting (Checkpoint 7f; mergeSection): the search's merges (TradeSearchResult.merged) with a
 * row each, against the same search without the merge (TradeSearchOptions.mergeCards false, Checkpoint 7e's lists): the cards
 * each list shows that it didn't (`cameIn`) and the ones it showed that it doesn't, neither merged nor dropped (`left`: the
 * usual rules after a merge or, since Checkpoint 7g, a drop, `freed` saying which: the final review of Checkpoint 7g,
 * merge-ui-report-after-merge), the holder-below pairs kept with a label, each list's length both ways, and the merge's ladders'
 * time (`ms`, the search's "offers" timing; null untimed). Checkpoint 7g: the cards whose Last offer asks for fewer of their
 * players (`smallerLast`), the versions dropped for a better version of the same trade (`dropped`), and the ladders a
 * preference changed (`preferred`).
 */
export interface MergeSection {
  merged: MergedCards | null;
  rows: MergeRow[];
  cameIn: { list: ListName; card: TradeEvaluation; place: number }[];
  left: { list: ListName; card: TradeEvaluation; was: number; freed: FreedBy }[];
  labels: LabelPair[];
  smallerLast: SmallerLastRow[];
  dropped: DroppedRow[];
  preferred: PreferredRow[];
  cards: Record<ListName, { without: number; with: number }>;
  ms: number | null;
}

/** A side's player ids, sorted (labelShape). */
const sideSet = (xs: readonly TradeAsset[]): string[] => playerIds(xs).sort();

/** A holder-below pair's shape (LabelShape): `higher` the card above on Overall, `lower` the one whose offers hold it. */
export function labelShape(higher: TradeProposal, lower: TradeProposal): LabelShape {
  if (higher.partnerId !== lower.partnerId) return "other";
  if (smallerAskOf(higher, lower)) return "smaller";
  const hg = sideSet(higher.give);
  const lg = sideSet(lower.give);
  const sameGet = sideSet(higher.get).join(",") === sideSet(lower.get).join(",");
  if (sameGet && hg.length === lg.length + 1 && lg.every((id) => hg.includes(id))) return "lean";
  if (sameGet && lg.length === hg.length + 1 && hg.every((id) => lg.includes(id))) return "throwIn";
  return "other";
}

/**
 * Why the higher card's offers don't hold the lower one (section 11's labels; Checkpoint 7g), in words: the first rule of the
 * offer it could be (a smaller ask's or a throw-in's Last offer, or an Open or a Then: offers.ts offerFeasible's rules on the
 * numbers both print; a throw-in's player one the Last offer can add, offers.ts ladderNeighbors) that turns it down; when every rule lets it in, why the higher card didn't prefer it (search.ts preferredOf: it holds
 * merged trades, so it isn't a leaf, or it isn't among the versions the card preferred), else that the ladder took others.
 */
export function labelWhy(state: SearchState, minChance: number, higher: TradeEvaluation, lower: TradeEvaluation, shape: LabelShape, holders: ReadonlySet<string>): string {
  const gain = config.search.steps.minAcceptGain;
  const pts = (x: number) => Math.round(100 * x);
  const chH = displayAcceptance(higher.pComplete);
  const chL = displayAcceptance(lower.pComplete);
  if (helpsBoth(higher) && !helpsBoth(lower)) return "it doesn't help both teams, under a card tagged “Helps both”";
  const pref = state.prefers?.get(higher.key);
  const notPreferred = (): string =>
    holders.has(lower.key)
      ? "it holds merged trades of its own, so the higher card doesn't prefer it (only leaves are preferred)"
      : pref
        ? "it isn't among the versions the higher card preferred (taken by a card above it, given back, or the cross-list guard)"
        : "the merge never worked out the higher card's ladder with a preference";
  if (shape === "smaller") {
    if (chL < chH + gain - EPS) return `only ${pts(chL - chH)} points likelier than the higher card (a Last offer needs ${pts(gain)})`;
    if (!(finite(lower.b) && finite(higher.b) && lower.b < higher.b - EPS)) return "its B isn't below the higher card's";
    if ((lower.tradeScore ?? Number.POSITIVE_INFINITY) > (higher.tradeScore ?? Number.NEGATIVE_INFINITY)) return "it prints a higher Helps you than the higher card";
    const oh = overallOf(higher);
    const ol = overallOf(lower);
    const share = config.offers.lastMinOverallShare;
    if (oh === null || ol === null || ol < share * oh - EPS) return `it keeps ${oh && ol !== null ? fmt((100 * ol) / oh, 1) : "–"}% of the higher card's Overall (unrounded), under ${fmt(100 * share, 0)}%`;
    if (!offerFeasible(higher, lower, "smaller", minChance)) return "a smaller ask's Last offer rules turn it down";
    return pref?.has(lower.key) ? "the higher card's Last offer is another version (the higher Overall)" : notPreferred();
  }
  if (shape === "throwIn") {
    if (chL < chH + gain - EPS) return `only ${pts(chL - chH)} points likelier than the higher card (a Last offer needs ${pts(gain)})`;
    const share = config.search.steps.minBShare;
    if (!(finite(lower.b) && finite(higher.b) && lower.b < higher.b - EPS)) return "its B isn't below the higher card's";
    if (lower.b < share * higher.b - EPS) return `it keeps ${fmt((100 * lower.b) / higher.b, 1)}% of the higher card's B, under the throw-in's ${fmt(100 * share, 0)}%`;
    if ((lower.tradeScore ?? Number.POSITIVE_INFINITY) > (higher.tradeScore ?? Number.NEGATIVE_INFINITY)) return "it prints a higher Helps you than the higher card";
    if (!ladderNeighbors(state, higher, [lower]).some((n) => n.kind === "last")) return "the player it adds isn't one the higher card's Last offer can add (a throw-in its pre-screen keeps)";
    return pref?.has(lower.key) ? "the higher card's Last offer is another version (the higher Overall)" : notPreferred();
  }
  if (shape === "lean") {
    const bar = openBar(minChance);
    if (chL > chH - gain + EPS) return `it's likelier than the higher card less ${pts(gain)} points (${chancePrinted(lower.pComplete)} against ${chancePrinted(higher.pComplete)}), past the Open's and a Then's window`;
    if (chL < bar - EPS) return `it prints under the Open's ${pctPlain(bar, 0)}`;
    if (!offerFeasible(higher, lower, "earlier", minChance)) return "it isn't better for you than the higher card (Helps you and B as printed)";
    return pref?.has(lower.key) ? "preferred, but the ladder's rules and room took other versions" : notPreferred();
  }
  if (offerFeasible(higher, lower, "earlier", minChance)) return pref?.has(lower.key) ? "preferred, but the ladder's rules and room took other versions" : notPreferred();
  return "neither a smaller ask, its lean version nor a throw-in added, and not in the Open's or a Then's window as printed";
}

/** A ladder choice's offers in order (Open, Thens, the Last offer), each with its printed numbers (PreferredRow). */
function choiceOffersPrinted(c: LadderChoice | null): ChoiceOffer[] {
  if (!c) return [];
  return [...(c.open ? [{ kind: "open" as const, printed: c.open.printed }] : []), ...c.thens.map((t) => ({ kind: "then" as const, printed: t.printed })), ...(c.last ? [{ kind: "last" as const, printed: c.last.printed }] : [])];
}

/**
 * Section 11's merge (the file header) from a search and the same search without the merge: each merged trade's row (its
 * numbers from the search's own shown block, SearchState.shownByKey), the cards that came in, those that left without being
 * merged or dropped, and the holder-below pairs: each card whose ladder can hold a card of its list above it on Overall
 * (offers.ts ladderNeighbors and offerFeasible, as the search reads them), its ladder then read (offerLadderOfSearch), with
 * each pair's shape and why (labelShape, labelWhy). Checkpoint 7g: every card's ladder read for a Last offer that asks for
 * fewer of their players (planB.ts smallerAskOf), the versions dropped (TradeSearchResult.merged.dominated) with what each
 * gave way to, and each card with a preference (SearchState.prefers) whose preferring ladder the search kept (offers.ts
 * ladderChoicesOf and heldOf, as ladderChoiceSteps keeps it).
 */
export function mergeSection(result: TradeSearchResult, unmerged: TradeSearchResult, ms: number | null): MergeSection | null {
  const state = searchStateOf(result);
  if (!state) return null;
  const minChance = result.filter?.minChance ?? state.settings.minChance;
  const lists: { list: ListName; cards: TradeEvaluation[]; before: TradeEvaluation[]; merged: MergedTrade[] }[] = [
    { list: "overall", cards: result.trades, before: unmerged.trades, merged: result.merged?.overall ?? [] },
    { list: "helpsBoth", cards: result.helpsBoth?.trades ?? [], before: unmerged.helpsBoth?.trades ?? [], merged: result.merged?.helpsBoth ?? [] },
  ];
  const placeIn = (list: readonly TradeEvaluation[], key: string): number | null => {
    const i = list.findIndex((t) => t.key === key);
    return i < 0 ? null : i + 1;
  };
  const out: MergeSection = {
    merged: result.merged ?? null,
    rows: [],
    cameIn: [],
    left: [],
    labels: [],
    smallerLast: [],
    dropped: [],
    preferred: [],
    cards: { overall: { without: unmerged.trades.length, with: result.trades.length }, helpsBoth: { without: unmerged.helpsBoth?.trades.length ?? 0, with: result.helpsBoth?.trades.length ?? 0 } },
    ms,
  };
  const allMerged = [...(result.merged?.overall ?? []), ...(result.merged?.helpsBoth ?? [])];
  const holders = new Set(allMerged.map((m) => m.into));
  const mergedKeys = new Set(allMerged.map((m) => m.key));
  const printedOfKey = (key: string): TradeEvaluationCore | null => state.shownByKey.get(key) ?? state.finalByKey.get(key) ?? null;
  for (const l of lists) {
    const merged = new Set(l.merged.map((m) => m.key));
    const dominated = (result.merged?.dominated ?? []).filter((d) => d.list === l.list);
    const dropped = new Set(dominated.map((d) => d.key));
    // What let a trade in that wasn't a card without the merge, and what pushed the others off (freedByOf: the final review of
    // Checkpoint 7g, merge-ui-report-after-merge).
    for (const m of l.merged) {
      const into = l.cards.find((t) => t.key === m.into);
      const trade = printedOfKey(m.key);
      const was = placeIn(l.before, m.key);
      if (into && trade) out.rows.push({ list: l.list, trade, was, freed: was === null ? freedByOf(out.merged, l.list, { kind: "merged", key: m.key }) : null, into, intoPlace: placeIn(l.cards, m.into) as number, kind: m.kind });
    }
    l.cards.forEach((card, i) => {
      if (placeIn(l.before, card.key) === null) out.cameIn.push({ list: l.list, card, place: i + 1 });
    });
    l.before.forEach((card, i) => {
      if (placeIn(l.cards, card.key) === null && !merged.has(card.key) && !dropped.has(card.key)) out.left.push({ list: l.list, card, was: i + 1, freed: freedByOf(out.merged, l.list) });
    });
    l.cards.forEach((holder, i) => {
      const above = l.cards.filter((x) => compareOverall(x, holder) < 0);
      const can = ladderNeighbors(state, holder, above).some((n) => offerFeasible(holder, above.find((x) => x.key === n.key) as TradeEvaluation, n.kind, minChance));
      if (!can) return;
      for (const step of offerLadderOfSearch(result, holder.key)?.steps ?? []) {
        const held = step.kind === "suggested" ? undefined : above.find((x) => x.key === step.evaluation.key);
        if (!held) continue;
        const shape = labelShape(held.proposal, holder.proposal);
        out.labels.push({ list: l.list, holder, holderPlace: i + 1, held, heldPlace: placeIn(l.cards, held.key) as number, kind: step.kind, shape, why: labelWhy(state, minChance, held, holder, shape, holders) });
      }
    });
    for (const d of dominated) {
      const trade = printedOfKey(d.key);
      if (!trade) continue;
      const at = placeIn(l.cards, d.by);
      const into = l.merged.find((m) => m.key === d.by);
      const byWhere = at !== null ? `idea ${at}` : into ? `among the offers of idea ${placeIn(l.cards, into.into) ?? "–"}` : "not shown";
      const was = placeIn(l.before, d.key);
      out.dropped.push({ list: l.list, trade, was, freed: was === null ? freedByOf(out.merged, l.list, { kind: "dropped", key: d.key }) : null, by: printedOfKey(d.by), byWhere });
    }
  }
  // Checkpoint 7g: every card's Last offer and preference (a card on both lists once, under the Overall list).
  const seen = new Set<string>();
  for (const l of lists) {
    l.cards.forEach((card, i) => {
      if (seen.has(card.key)) return;
      seen.add(card.key);
      const last = (offerLadderOfSearch(result, card.key)?.steps ?? []).find((s) => s.kind === "last");
      if (last && smallerAskOf(card.proposal, last.evaluation.proposal)) {
        const oc = overallOf(card);
        const on = overallOf(last.evaluation);
        const key = last.evaluation.key;
        // Its place without the merge, as its merged row has it (the card's list first: a card on both lists is read under the Overall list's).
        const row = out.rows.find((r) => r.trade.key === key && r.list === l.list) ?? out.rows.find((r) => r.trade.key === key);
        out.smallerLast.push({ list: l.list, card, place: i + 1, offer: last.evaluation, share: oc && on !== null ? on / oc : null, merged: mergedKeys.has(key), was: row?.was ?? null });
      }
      const prefer = state.prefers?.get(card.key);
      if (!prefer || prefer.size === 0) return;
      const { usual, preferring } = ladderChoicesOf(ladderJobOfSearch(state, card, prefer));
      if (!preferring || heldOf(preferring, prefer) <= heldOf(usual, prefer)) return;
      const offers = choiceOffersPrinted(preferring);
      out.preferred.push({ list: l.list, card, place: i + 1, usual: choiceOffersPrinted(usual), preferring: offers, held: offers.map((o) => o.printed.key).filter((k) => prefer.has(k)) });
    });
  }
  return out;
}

/** Section 11 under section 1's setting (`title`) and section 2's split (`other`). */
export interface LadderSection {
  title: LadderSetting;
  other: LadderSetting;
}

/**
 * The first `cards` cards' offers in order on a search's own state (the file header, section 11), as the engine worker builds
 * them when each card's "How to offer it" is first opened: offers.ts offerLadderOfSearch on the search's own ladder store,
 * the cards in order (⚠️ so a card can reuse what an earlier one built on the same context, as in the worker), each timed
 * with the clock; and the candidates there were and the legal ones the pre-screen let through (offers.ts ladderChoice on the
 * same store and job, since Checkpoint 7g with the card's preference as the search recorded it, SearchState.prefers: nothing
 * built again but the candidates legality turns down). None for a search that stopped before ranking.
 */
export function laddersOf(result: TradeSearchResult, cards: number, clock: () => number): LadderRow[] {
  const state = searchStateOf(result);
  if (!state) return [];
  return result.trades.slice(0, Math.max(0, Math.floor(cards))).flatMap((card) => {
    const t0 = clock();
    const ladder = offerLadderOfSearch(result, card.key);
    const took = clock() - t0;
    if (!ladder) return [];
    const choice = ladderChoice(ladderJobOfSearch(state, card, state.prefers?.get(card.key)));
    return [{ card, ladder, candidates: choice?.candidates ?? 0, screened: choice?.screened.length ?? 0, ms: [took], kept: state.ladders?.has(card.key) ?? false }];
  });
}

/** A ladder choice's offers by key (Open, Thens, Last offer), for comparing two choices (ladderBetter's `same`). */
function choiceKeys(c: LadderChoice | null): string {
  if (!c) return "";
  return [c.open?.candidate.key ?? "-", ...c.thens.map((t) => t.candidate.key), c.last ? c.last.printed.key : "-"].join(" > ");
}

/**
 * Each card's first opens over `opts.runs` runs, each on a trade context and search of its own (buildTradeContext and
 * runTradeSearch under `opts.settings`, as the worker holds them; the searches untimed): laddersOf after each, and the last
 * run's search and ladders with every run's times (the ladders are the same in every run: deterministic).
 */
export function ladderRuns(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: SearchRunOptions, cards: number): { result: TradeSearchResult; rows: LadderRow[] } {
  const times: number[][] = [];
  let last: { result: TradeSearchResult; rows: LadderRow[] } | null = null;
  for (let i = 0; i < Math.max(1, Math.floor(opts.runs)); i++) {
    const ctx = buildTradeContext(snapshot, inputs, { now: opts.now, settings: opts.settings, ...(opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {}) });
    const result = runTradeSearch(ctx, { settings: opts.settings });
    const rows = laddersOf(result, cards, opts.clock);
    rows.forEach((row, k) => (times[k] ??= []).push(...row.ms));
    last = { result, rows };
  }
  const done = last as { result: TradeSearchResult; rows: LadderRow[] };
  return { result: done.result, rows: done.rows.map((row, k) => ({ ...row, ms: times[k] ?? row.ms })) };
}

/**
 * ⚠️ The lead's question (the addendum for wave D, "a variant that prints a higher Helps you and a higher chance than the card
 * isn't in the ladder (it would be a better card, not a first offer); report how often one exists on Parker's top 10"): for
 * each of the first `cards` cards, its ladder's legal candidates, every one played out (offers.ts ladderChoice with `every`:
 * the variants and the lean version, on the search's own store), those that print a
 * higher chance than the card (the chance is the same on every block, so the screening block's numbers say it exactly), each
 * simulated on the card's block (offers.ts printedOf), and of them those that print a higher Helps you too; and whether the
 * ladder's pre-screen picks the same offers as every candidate does (the review of wave D, D-ENG-1: the pre-screen's check).
 * Since Checkpoint 7g each card's job carries its preference as the search recorded it (SearchState.prefers), as its first
 * open's does.
 */
export function ladderBetter(result: TradeSearchResult, cards: number): LadderBetter[] {
  const state = searchStateOf(result);
  if (!state) return [];
  return result.trades.slice(0, Math.max(0, Math.floor(cards))).map((card) => {
    const job = ladderJobOfSearch(state, card, state.prefers?.get(card.key));
    const pre = ladderChoice(job);
    const choice = ladderChoice(job, { every: true });
    const chance = displayAcceptance(card.pComplete);
    let likelier = 0;
    const better: BetterVariant[] = [];
    for (const s of choice?.screened ?? []) {
      if (!(displayAcceptance(s.screen.pComplete) > chance + EPS)) continue;
      const v = job.store.versions.get(s.candidate.key);
      if (!v) continue;
      likelier++;
      const p = printedOf(job, v);
      if (p.tradeScore !== null && card.tradeScore !== null && p.tradeScore > card.tradeScore && displayAcceptance(p.pComplete) > chance + EPS) better.push({ kind: s.candidate.kind, proposal: s.candidate.proposal, tradeScore: p.tradeScore, pComplete: p.pComplete });
    }
    return { card, screened: choice?.screened.length ?? 0, likelier, better, same: choiceKeys(pre) === choiceKeys(choice) };
  });
}

/**
 * The console's word on section 11 (ladderSummary): the split's top cards, their offers and how long the first opens took
 * ("kept" for a ladder the search's merge read: Checkpoint 7f), and the split's merges.
 */
export function ladderSummary(s: LadderSection, other: string): string {
  const rows = s.other.rows;
  if (!rows.length) return `How to offer it: no cards under ${other}`;
  const offers = rows.map((r) => r.ladder.steps.length);
  const better = s.other.better.filter((b) => b.better.length > 0).length;
  const same = s.other.better.filter((b) => b.same).length;
  const m = s.other.merge?.merged;
  const merged = m ? `; ${m.overall.length + m.helpsBoth.length} merged into another card (${m.overall.length} on the Overall list), ${m.dominated?.length ?? 0} dropped for a better version of the same trade` : "";
  return `How to offer it (${other}): the top ${rows.length} cards hold ${offers.join(" / ")} offers, built in ${rows.map((r) => (r.kept ? "kept" : ms(median(r.ms)))).join(" / ")} (first opens, medians); ${better} of the top ${s.other.better.length} ${better === 1 ? "has" : "have"} a candidate printing a higher Helps you and a higher chance; the pre-screen picks every candidate's offers on ${same} of ${s.other.better.length}${merged}`;
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
  /** Section 11 (Checkpoint 7e): "How to offer it" under each setting. */
  ladders: LadderSection;
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
  // Section 4's runs, each timed one followed by the same search without "Helps them" (section 10; withoutHelpsThem) and,
  // since Checkpoint 7d, without the helps-both lane; since Checkpoint 7e (section 11) then its top cards' "How to offer it",
  // each first opened on that run's own search.
  const { ctx, result, runtime, without: paired, noLane: pairedNoLane, ladders: mainLadders } = timedSearches(snapshot, inputs, { ...runOpts, pairedWithout: true, pairedNoLane: true, ladders: LADDER_CARDS });
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
  // Section 10 (Checkpoint 7d): the split's search without the helps-both lane, on a context of its own built the same way
  // (a context's memos are warm after a search: on section 2's own its partners' calibration runs would be free), timed.
  const splitNoLaneCtx = buildTradeContext(snapshot, inputs, { now, settings: prizesSettings, ...sc });
  const splitNoLane = runTradeSearch(splitNoLaneCtx, { settings: prizesSettings, helpsBothLane: false, clock });
  lap("lane");
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
  // Section 10: "Helps both" under each setting, the split's scales, and the extra runtime; the helps-both lane's against the
  // searches without it.
  const helpsBoth = helpsBothSection({ result, runtime }, goals, without, {
    paired: pairedNoLane as NonNullable<typeof pairedNoLane>,
    split: { result: splitNoLane, total: finite(splitNoLane.timings.total) ? (splitNoLane.timings.total as number) : null },
  });
  lap("helps both");
  // Section 11 (Checkpoint 7e): "How to offer it" under each setting: the top cards' ladders with their first opens (section
  // 1's setting from section 4's timed runs; the split's from runs of its own, each on a context and search of its own), and
  // on the top cards the candidates that print a higher Helps you and a higher chance than their card.
  const splitLadders = ladderRuns(snapshot, inputs, { ...runOpts, settings: prizesSettings }, LADDER_CARDS);
  // Checkpoint 7f: each setting's merges against the same search without them (mergeCards false; on that setting's context:
  // deterministic, so the same lists as on a context of its own), their time the search's own "offers" timing.
  const unmerged = { title: runTradeSearch(ctx, { settings, mergeCards: false }), other: runTradeSearch(prizesCtx, { settings: prizesSettings, mergeCards: false }) };
  const offersMs = (x: number | undefined | null): number | null => (finite(x) ? x : null);
  const ladders: LadderSection = {
    title: { rows: mainLadders ?? [], better: ladderBetter(result, TOP_DETAIL), merge: mergeSection(result, unmerged.title, offersMs(runtime.search.offers)) },
    other: { rows: splitLadders.rows, better: ladderBetter(splitLadders.result, TOP_DETAIL), merge: mergeSection(splitLadders.result, unmerged.other, offersMs(goals.result.timings.offers)) },
  };
  lap("ladders");
  timing.total = clock() - start;
  const report: Omit<TradeReport, "doc"> = { snapshot, pre4c, settings, prizes: opts.prizes ?? null, ctx, result, model: league.model, league: { cold: league.cold, warm: league.warm }, runtime, beams: { result: beams.result, runtime: beams.runtime }, goals, scale, gap, filter, blend, odds, anchors, premiumAnchors, neutral, kickoff, pickupWeeks: weeks, openSpots, helpsBoth, ladders, timing };
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
  renderLadders(L, snapshot, inputs, r, teamName);
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
  L.push("# Trade search: Parker's ESPN league (Checkpoint 7g)", "");
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
  L.push(`**Your baseline** (the trade search's: every team after its free-agent pickups in the waiver order above, seasons 1–${thousands(shownSimsOf())}, the shown block; it ${r.odds.baselineEqual === false ? "does NOT equal ❌" : "equals"} the League page's headline, section 7): playoffs ${pctPlain(b.pPlayoffs)}, title ${pctPlain(b.pTitle)}, expected wins ${fmt(b.expWins, 2)}. As rosters stand: playoffs ${pctPlain(stand?.pPlayoffs)}, title ${pctPlain(stand?.pTitle)}.`, "");
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
 * What the Plan B lines read besides the card: the tagger, the search's tags for its other ideas, and my odds before any
 * trade (the search's baseline: a Plan B box's odds start from it, as the card's do).
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
 * The card's Plan B in words (the file header, section 1), in its box's own words (tradeView.planBView, as the card shows it:
 * each tagged player's tag in parentheses; review of track R, R-2: an untagged Plan B read as healthy), with its numbers and
 * its box's odds lines (Phase 4c, change 9: its title and playoff odds before → after and its weekly line, from its own
 * simulation); or none. Until Checkpoint 7e a card with "Offer first / if they say no" steps had them here instead (planner
 * reply to Checkpoint 7d, item 4.1: its offers in order are section 11's, worked out when it's opened).
 */
function nextStep(snapshot: LeagueSnapshot, inputs: ModelInputs, t: TradeEvaluation, sc: StepContext): string | null {
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
    `The Trade Finder's first ${top.length} of ${trades.length} cards with the default settings, Overall order, Helps you and Overall on B₃ ${b3 === null ? "–" : fmt(b3, 2)} (section 3: ${HELPS_AT_GAIN} ≈ +${config.benefit.helpsGain} pts a week). The three numbers as the card prints them: Helps you / Chance they accept (with its label; "goes through" when the league vote's veto rule cuts it; under ${Math.round(100 * config.acceptance.displayStep)}% reads "<${Math.round(100 * config.acceptance.displayStep)}%") / Overall. Odds before → after: the search's baseline and the trade's change on the same ${thousands(shownSimsOf())} seasons (the shown block, Checkpoint 7e: the search ranks on the first ${thousands(config.simulation.finalSims)} of them). Win chance by week: the weeks whose chance moves at least ${Math.round(100 * config.explain.weeklyLineMin)} points, at most ${config.explain.weeklyLineMax} (the largest), in week order. Injury tags in brackets are the card's words, and a Plan B ("If they won't move: try …", the card's box since Checkpoint 7e, looked for on every card) is quoted in its box's own words (tags in parentheses); each card's "How to offer it" is section 11's. Trade value: g_mkt(me), the model's own figure counting roster spots, and what "Protect my trade value" charges or credits for it in Helps you, in points a week on the card's scale (planner reply to Checkpoint 7a, §2 question 5: κ × clamp(g_mkt(me)), the Analyzer's "Trade value: … pts/week equivalent").`,
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
  if (steps.length) L.push("Plan B on those cards:", "", ...steps, "");
  const c10 = cardCounts(top, sc.tagsOf);
  const all = cardCounts(trades, sc.tagsOf);
  L.push(
    `**Counts** (top ${c10.shown} / all ${all.shown} cards): with Plan B ${c10.planB} / ${all.planB}; receiving an injury-tagged player ${c10.injuredGet} / ${all.injuredGet}; Plan B boxes receiving one ${c10.planBInjuredGet} / ${all.planBInjuredGet}. Hidden: ${r.result.hidden.byBenefit} for B ≤ 0, ${r.result.hidden.byMarket} by the market guard, ${r.result.hidden.byChance ?? 0} under the minimum chance; dropped by the variety rules: ${r.result.dropped ? `${r.result.dropped.givenPlayer} by the given-player cap, ${r.result.dropped.partnerCap} by the partner cap, ${r.result.dropped.core} by the core rule, ${r.result.dropped.filler} as filler` : "–"}; ${r.result.dropped?.merged ?? 0} merged into another idea's offers (Checkpoint 7f: section 11); ${r.result.dropped?.dominated ?? 0} dropped for a better version of the same trade (Checkpoint 7g: section 11).`,
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
    `Planner reply to Checkpoint 4c, A2: Helps you = round(100 × (1 − e^(−B / B₃))) and Overall = round(100 × (1 − e^(−B × P_complete / B₃))), B₃ = the B of +${gain} projected points a week in every week a trade can change (weeks ${weeks[0] ?? "–"}–${weeks.at(-1) ?? "–"}${cal.from > 0 ? `; week ${r.model.inProgressWeek} is under way, held as rosters stand in every trade` : ""}), regular season and playoffs, from the one baseline (every team after its pickups: LeagueModel.odds), on its ${thousands(shownSimsOf())} seasons (common random numbers), under the same goal, floored at ${config.benefit.helpsFloor}; in a dynasty or keeper league with long-term values B_ref(λ) = (1 − λ) × that + λ × F₁₀, F₁₀ = ${fmt(config.benefit.bFutureScale * config.benefit.helpsFutureShare, 0)}, the B of +${Math.round(100 * config.benefit.helpsFutureShare)}% long-term value (planner reply to Checkpoint 7a, §2 question 6). "Protect my trade value" is priced on the same B₃ (question 5): B's market term = (B₃ / ${gain}) × κ × clamp(g_mkt(me)), κ ${PROTECT_VALUE_LEVELS.map((level) => protectValueWeight(level)).join(" / ")} points a week per 100% of trade value at Low / Medium / High, so the last column's 25%-more-value example costs the same points a week under every goal. The League model's run (LeagueModel.helpsCalibration): ΔPO₃ ${pts(cal.dPO, 2)}, ΔCH₃ ${cal.dCH === null ? "unknown" : pts(cal.dCH, 2)}.${matches(s.contextMatches, "The trade context's own run (its shown block)")}`,
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
  const keys = ["setup", "screening", "exact", "simScreen", "simFinal", "rank", "steps", "shown", "offers", "total"];
  const fin = config.simulation.finalSims;
  const scr = config.simulation.screeningSims;
  const shown = shownSimsOf();
  const label: Record<string, string> = {
    setup: "setup (pools)",
    screening: "screening",
    exact: "exact evaluation",
    simScreen: `screening simulation (seasons ${thousands(shown + 1)}–${thousands(shown + scr)})`,
    simFinal: `final simulation, the ranking block (seasons 1–${thousands(fin)})`,
    rank: "ranking",
    steps: "Plan B and words (the steps too until Checkpoint 7e)",
    shown: `the shown pass (seasons 1–${thousands(shown)}: the cards and boxes shown, Checkpoint 7e)`,
    offers: "the merge's ladders (Checkpoint 7f: worked out during the search, section 11; since Checkpoint 7g each with its preferred versions too)",
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
    `Planner change 1: every 1-for-2 and 2-for-1 from the give and get pools and every 2-for-2 from the first ${config.search.exhaustive.twoForTwoTop} of each, on top of the beams; ${config.search.finalists} finalists. **Screened**: ${thousands(c.screened)} (the beams alone: ${thousands(bc.screened)}); ${exactText(r.result)}, ${finalRunsText(r.result)}, ${r.result.trades.length} cards (the beams alone: ${exactText(r.beams.result)}, ${finalRunsText(r.beams.result)}, ${r.beams.result.trades.length} cards).`,
    "",
  );
  if (!g.trade) L.push(`**${GAP_TRADE.give.join(" + ")} → ${GAP_TRADE.get.join(" + ")}**: ${g.missing ?? "not available"}.`, "");
  else {
    const e = g.evaluation;
    const funnel = [
      g.screened ? `screened #${g.screened.rank} of ${thousands(g.screened.of)} ${teamName(g.trade.partnerId)} candidates by the objective (${fmt(g.screened.objective, 2)})` : "never screened",
      g.inWindow === null ? null : g.inWindow ? "inside the g window" : "outside the g window",
      g.kept ? `kept #${g.kept.rank} of ${g.kept.of} for that partner` : "not kept",
      g.exact ? (g.lane && !g.shortlisted ? "evaluated exactly, from the helps-both lane (section 10)" : "evaluated exactly") : g.shortlisted ? "shortlisted but illegal" : g.lane ? "in the helps-both lane but illegal" : `not in the exact ${config.search.exactEvaluationMax} nor the helps-both lane`,
      g.finalist ? "a finalist" : g.extra ? `not a finalist, but a "Helps both" extra (a final run only that list ranks: section 10)` : "not a finalist",
      g.card ? `**card #${g.card}**` : "not a card",
    ].filter((x): x is string => x !== null);
    L.push(
      `**${names(snapshot, g.trade.give)} → ${names(snapshot, g.trade.get)}** (${teamName(g.trade.partnerId)}): ${funnel.join(" → ")}. ${e ? `Its numbers${g.card ? "" : " (the Analyzer)"}: ${threeNumbers(e)}, B ${fmt(e.b, 2)}; title ${titleMove(r.result.baseline.pTitle, e.dCH)}, playoffs ${playoffMove(r.result.baseline.pPlayoffs, e.dPO)}.` : ""} The beams alone ${g.beams ? "screen it too" : "never screen it"}.${g.bestSameFamily ? ` The best card with that partner giving ${GAP_TRADE.give[0]} otherwise: #${g.bestSameFamily.rank} ${names(snapshot, playerIds(g.bestSameFamily.trade.proposal.get))} (${threeNumbers(g.bestSameFamily.trade)}).` : ""}`,
      "",
    );
  }
  L.push(
    `Only the exhaustive candidates reach (the beams alone never screen them): ${g.onlyExhaustive.exact} of ${c.exact} exact trades, ${g.onlyExhaustive.finalRuns} of the ${c.simFinal} final runs, ${g.onlyExhaustive.cards} of ${r.result.trades.length} cards.${g.reproduces ? ` The per-partner counts come from screening every partner again on the search's own context: they add up to the search's ${thousands(c.screened)} ${mark(g.reproduces.counts)}, every trade it evaluated exactly is in the rebuilt shortlist, among its lean companions or in the rebuilt helps-both lane with its own ${mark(g.reproduces.shortlist)}, and that lane is the search's ${mark(g.reproduces.lane)}.` : ""}`,
    "",
  );
  if (g.perPartner.length) {
    L.push("| Partner | Screened | Beams alone | Exact | Final runs | Cards |", "|---|---|---|---|---|---|");
    for (const p of g.perPartner) L.push(`| ${teamName(p.partnerId)} | ${thousands(p.exhaustive)} | ${thousands(p.beams)} | ${p.exact} | ${p.finalRuns} | ${p.cards} |`);
    const sum = (f: (p: PartnerCounts) => number) => g.perPartner.reduce((s, p) => s + f(p), 0);
    L.push(`| **all** | **${thousands(sum((p) => p.exhaustive))}** | ${thousands(sum((p) => p.beams))} | ${sum((p) => p.exact)} | ${sum((p) => p.finalRuns)} | ${sum((p) => p.cards)} |`, "");
  }
  L.push(`**Runtime** (Node ${process.version}, each run with its own context; cold = the first search in the process, after the League model's own timed builds; each timed run is followed by section 10's runs without "Helps them" and without the helps-both lane; the browser's worker is timed by \`npm run check:browser -- --live\`). ${r.runtime.sameEveryRun && r.beams.runtime.sameEveryRun ? "Every run returned the same trades with the same numbers ✅." : "❌ The runs did not all return the same trades."} The League model alone: ${ms(r.league.cold)} cold, ${ms(r.league.warm)} warm.`, "");
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
  L.push(`- **Neutral throw-ins** (${rule}): ${cards.length} card${cards.length === 1 ? "" : "s"}. Each card next to its lean version (the same trade without them, from the Analyzer on the cards' own seasons 1–${thousands(shownSimsOf())}), unrounded: ${summary}`, "");
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
  L.push("", `This report took ${ms(r.timing.total)} (the searches ${ms(r.timing.searches)}, section 10's runs without "Helps them" and without the helps-both lane and section 11's first opens under "${GOAL_WORDS[r.settings.goal]}" among them, the beams alone ${ms(r.timing.beams)}, the "${GOAL_WORDS[r.goals.goal]}" search ${ms(r.timing.goals)} and again without the lane ${ms(r.timing.lane)}, the search gap's re-screening ${ms(r.timing.gap)}, section 9's Checkpoint 7b search and evaluations ${ms(r.timing["open spots"])}, section 10's scales ${ms(r.timing["helps both"])}, section 11's runs under "${GOAL_WORDS[r.goals.goal]}" and its candidates played out ${ms(r.timing.ladders)}).`, "");
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
export function helpsBothSummary(h: Pick<HelpsBothSection, "counts" | "cost"> & { lane?: Pick<LaneSection, "counts" | "before" | "cost"> }, measuredUnder: Goal): string {
  const c = h.counts.other;
  const counts = c ? `${c.exact.both} of ${c.exact.total} exact trades help${c.exact.both === 1 ? "s" : ""} both on the screening run, the list shows ${c.list.trades.length} (${c.fromExtras} from the extras)` : "no trade counted as helping both (the search stopped before ranking)";
  // Checkpoint 7d: the helps-both lane under the split (its legal trades and companions, the list without it), and its cost.
  const lc = h.lane?.counts.other;
  const before = h.lane?.before.other;
  const n = before?.list.trades.length;
  const lane = lc ? `; the helps-both lane adds ${lc.exact} exact trade${lc.exact === 1 ? "" : "s"}, ${lc.list} on the list (${n === undefined ? "–" : `${n} card${n === 1 ? "" : "s"} without the lane`})` : "";
  const laneCost = h.lane ? `, the lane ${msChange(h.lane.cost.extra.warm)}` : "";
  return `${counts}${lane}; Helps both costs ${msChange(h.cost.extra.warm)} a search warm${laneCost} (${GOAL_WORDS[measuredUnder]}, section 4's runs)`;
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
    `Planner reply to Checkpoint 7b, §7: "Helps them" is the partner's Helps you from the same runs (${helpsThemScaleWords(snapshot.settings.leagueType)}), and a trade helps both when its Helps you and its Helps them, as printed, are each at least ${min} (planner reply to Checkpoint 7c, answer 5: Helps you above 0 before). The "Helps both" sort shows only those, by Helps you, under the chance filter and the variety caps. The first ${top} by B among the screening run's trades that help both and aren't hidden, one more for each of those from the helps-both lane (the room; Checkpoint 7d, review of the lane, LANE-2), get the final run (those the ranking hadn't picked: the extras), are checked again on it and are ranked on that list only, so it shows only trades exact evaluation saw. Each column is the app's search under that setting (sections 1 and 2):`,
    "",
  );
  const cell = (c: HelpsBothCounts | null, f: (c: HelpsBothCounts) => string) => (c ? f(c) : "–");
  const row = (label: string, f: (c: HelpsBothCounts) => string) => L.push(`| ${label} | ${cell(h.counts.title, f)} | ${cell(h.counts.other, f)} |`);
  const dropped = (d: HelpsBothList["dropped"]) => d.partnerCap + d.core + d.filler + d.givenPlayer;
  L.push(`| Trades that help both | ${main} | ${other} (the split) |`, "|---|---|---|");
  row(`Exact trades, screening run: Helps you ${min}+ · their B above 0 · Helps them ${min}+ · both (not hidden)`, (c) => `${c.exact.helpsYou} · ${c.exact.theirB} · ${c.exact.helpsThem} · ${c.exact.both} (${c.exact.shown}) of ${c.exact.total}`);
  row(`The extras: the first ${top} not hidden, one more for each from the helps-both lane (the room) · already finalists · extras · still helping both on the final run`, (c) => `${c.pool} (room ${c.room}) · ${c.picked} · ${c.extras} · ${c.stillBoth}`);
  row("Finalists the ranking picked, on the final run", (c) => `${c.finalists.both} of ${c.finalists.total}`);
  row(`Overall cards (their "Helps both" tag)`, (c) => `${c.cards.both} of ${c.cards.total}`);
  row(`**The "Helps both" list**: cards (also Overall cards · extras)`, (c) => `**${c.list.trades.length}** (${c.onOverall} · ${c.fromExtras})`);
  row("… qualifying · under the minimum chance · left out by the variety rules · a lower setting would add more", (c) => `${c.list.qualifying} · ${c.list.byChance} · ${dropped(c.list.dropped)} · ${c.list.lowerWouldAdd ? "yes" : "no"}`);
  L.push("");

  const list = r.goals.result.helpsBoth?.trades ?? [];
  const shown = list.slice(0, HELPS_BOTH_SHOWN);
  const scales = h.scales.map((s) => `${teamName(s.teamId)} ${scaleText(s.scale)}`).join(" · ");
  L.push(
    `**The list under "${other}"**: ${shown.length ? `its first ${shown.length} of ${list.length} card${list.length === 1 ? "" : "s"}, by Helps you, with the chance they accept as the card prints it and the partner's odds before → after on the same ${thousands(shownSimsOf())} seasons as yours (TradeEvaluation.them).` : "no trade helps both teams."} Each partner's "Helps them" scale under it, B_ref,P (B₃,P unless it mixes in long-term value): ${scales || "–"}.`,
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
    : `without it the Overall list is the same ${r.result.trades.length} cards with the same numbers, boxes and words ✅`;
  const measured = measuredRunsText(c);
  const sp = r.goals.parts;
  const many = (n: number, one: string, more: string): string => `${n} ${n === 1 ? one : more}`;
  const splitText = sp ? ` Under "${other}", section 2's one search (warm, ${ms(r.goals.result.timings.total)}): its ${many(sp.calibrations.count, "calibration run", "calibration runs")} ${ms(sp.calibrations.ms)} and its ${many(sp.extras.count, "extra's final run", "extras' final runs")} ${ms(sp.extras.ms)}.` : "";
  L.push(
    `**The extra runtime** (⚠️ ours: under "${main}", section 4's runs, whose first is the process's only cold search, each timed one followed by the same search without "Helps them" on its own context: every partner's calibration run set to none in the context's memo, the engine test's way, so no calibration run (${h.without.calibrated} made), no extra (${h.without.extras}) and an empty second list (${h.without.list}); ${same}). The calibration runs and the extras' final runs are read off each run's own progress; Helps them's share of the ranking stage (since Checkpoint 7e the shown pass's too: the partners' scales on the shown block, which every card's tag reads, and the second list's cards played out there; then the second list's ranking, since Checkpoint 7f its merge's ladders, Plan B and words) is that stage's difference between the two sets, warm only (the cold extra adds the warm figure).${measured ? ` ${measured}` : ""}${splitText}`,
    "",
  );
  L.push(`| | Cold | Warm (median of ${r.runtime.runs.length}) |`, "|---|---|---|");
  L.push(`| The partner calibration runs (${c.calibrations.count}, one per partner of the exact trades) | ${ms(c.calibrations.cold)} | ${ms(c.calibrations.warm)} |`);
  L.push(`| The extras' final runs (${c.extras.count}) | ${ms(c.extras.cold)} | ${ms(c.extras.warm)} |`);
  L.push(`| Helps them's share of the ranking stage: the shown pass's partner scales and the second list's cards on ${thousands(shownSimsOf())} seasons, its ranking, its merge's ladders, Plan B and words | – | ${msSigned(c.secondList)} |`);
  L.push(`| **The extra: the three parts** | ${c.extra.cold === null ? "–" : `≈ ${msChange(c.extra.cold)} ⚠️`} | ${c.extra.warm === null ? "–" : `${msChange(c.extra.warm)}${finite(c.without.warm) && c.without.warm > 0 ? ` (${signed((100 * c.extra.warm) / c.without.warm, 1)}%)` : ""}`} |`);
  L.push(`| Search total with "Helps them" (the app: section 4's) | ${ms(c.with.cold)} | ${ms(c.with.warm)} |`);
  L.push(`| Search total without (with, less the extra: ⚠️ derived) | ${ms(c.without.cold)} | ${ms(c.without.warm)} |`, "");
  renderLane(L, r, main, other);
}

/** "5 (5) of 203": the exact trades that help both on the screening run (not hidden) of all exact trades; "–" unknown. */
const exactBothText = (c: HelpsBothCounts | null): string => (c ? `${c.exact.both} (${c.exact.shown}) of ${c.exact.total}` : "–");

/**
 * Section 10's helps-both lane (Checkpoint 7d; the file header): its counts and the counts without it under each setting,
 * the Overall cards it changes and what else it changes on the Finder (laneShown), then what it costs, measured under section
 * 1's setting (section 4's runs against those without the lane), and under the split section 2's search against one without
 * it.
 */
function renderLane(L: string[], r: Report, main: string, other: string): void {
  const s = r.helpsBoth.lane;
  const cs = config.search;
  L.push(
    `**The helps-both lane** (Checkpoint 7d; planner reply to Checkpoint 7c, answer 2): up to ${cs.helpsBothLane} screened trades that the shortlist and its lean companions don't hold, on which both lineups gain on the fast method (my ΔROS and their ΔLineup_P above 0, after screening's rules: the g window and the dominance pruning), best screening objective first, are evaluated exactly too, each with its own lean companion, then go through the same screening simulation, finalist rules and extras as every other exact trade. Each column is the app's search under that setting against the same search without the lane (under "${main}" the last of section 4's runs paired with one; under "${other}" section 2's search against one on a context of its own):`,
    "",
  );
  const cell = (c: LaneCounts | null, f: (c: LaneCounts) => string) => (c ? f(c) : "–");
  const row = (label: string, f: (c: LaneCounts) => string) => L.push(`| ${label} | ${cell(s.counts.title, f)} | ${cell(s.counts.other, f)} |`);
  const move = (label: string, f: (c: HelpsBothCounts | null) => string) => L.push(`| ${label} | ${f(s.before.title)} → ${f(r.helpsBoth.counts.title)} | ${f(s.before.other)} → ${f(r.helpsBoth.counts.other)} |`);
  L.push(`| The helps-both lane | ${main} | ${other} (the split) |`, "|---|---|---|");
  row("Screened trades both lineups gain on · already on the shortlist or among its companions · the lane · its lean companions · legal", (c) => `${c.qualifying} · ${c.onShortlist} · ${c.trades} · ${c.companions} · ${c.exact}`);
  row(`From the lane: help both on the screening run · finalists the ranking picked · extras · help both on the final run · on the "Helps both" list · on the Overall list`, (c) => `${c.screenBoth} · ${c.finalists} · ${c.extras} · ${c.finalBoth} · ${c.list} · ${c.overall}`);
  row(`The lane's displaced finalists (the ranking picks them without it, not with it), kept for the "Helps both" list (Helps them known) · help both on the final run · on that list`, (c) => `${c.displaced.kept} · ${c.displaced.both} · ${c.displaced.listed}`);
  move("Without the lane → with it: exact trades that help both on the screening run (not hidden)", exactBothText);
  move("… the extras (still helping both on the final run)", (c) => (c ? `${c.extras} (${c.stillBoth})` : "–"));
  move("… finalists the ranking picked that help both", (c) => (c ? `${c.finalists.both} of ${c.finalists.total}` : "–"));
  move(`… Overall cards (their "Helps both" tag)`, (c) => (c ? `${c.cards.both} of ${c.cards.total}` : "–"));
  move(`**… the "Helps both" list's cards**`, (c) => (c ? `**${c.list.trades.length}**` : "–"));
  L.push(`| Overall cards the search without the lane doesn't show | ${s.differs.title} of ${r.result.trades.length} | ${s.differs.other} of ${r.goals.result.trades.length} |`);
  // What else it changes on the Finder (laneShown; review of the lane, LANE-1 and LANE-2).
  const shown = (label: string, f: (x: LaneShown) => string) => L.push(`| ${label} | ${f(s.shown.title)} | ${f(s.shown.other)} |`);
  const leftOutText = (x: LeftOut) => `${x.benefit} · ${x.market} · ${x.chance}`;
  shown("Overall cards both show with a different Plan B box", (x) => `${x.shared.box} of ${x.shared.cards}`);
  shown(`"Helps both" cards the search without the lane doesn't show · its cards this list doesn't show`, (x) => `${x.list.added} · ${x.list.dropped} of ${x.list.cards}`);
  shown(`Final runs without the lane, Helps them known (the "Helps both" list's candidates), that the search with it doesn't make · of them on its list`, (x) => `${x.finalsLost.count} · ${x.finalsLost.listed}`);
  shown(`The Finder's "checked N closely", without → with`, (x) => `${x.exact.without} → ${x.exact.with}`);
  shown(`The Finder's "Left out on purpose": ideas that wouldn't help you · that give up much more trade value · under the minimum chance, without → with`, (x) => `${leftOutText(x.leftOut.without)} → ${leftOutText(x.leftOut.with)}`);
  L.push("");

  const c = s.cost;
  const sp = s.split;
  const measured = finite(c.measured.without)
    ? ` The runs without it measured ${ms(c.measured.without)} (median)${finite(c.with.warm) ? `, ${underOver(c.measured.without - c.with.warm)} section 4's ${ms(c.with.warm)}` : ""}${finite(c.measured.spread) ? `; each set's search totals spread over up to ${ms(c.measured.spread)} from run to run` : ", from one timed run a set (no spread from run to run)"}.`
    : "";
  const splitText =
    sp && sp.parts
      ? ` Under "${other}", section 2's one search (warm, ${ms(sp.with)}): the lane's exact evaluations ${ms(sp.parts.exact.ms)} and screening simulations ${ms(sp.parts.simScreen.ms)}; the search without the lane, on a context of its own, ${ms(sp.without)}${finite(sp.with) && finite(sp.without) ? ` (${msChange(sp.with - sp.without)} with it, one run each)` : ""}.`
      : "";
  L.push(
    `**What the lane costs** (⚠️ ours: under "${main}", section 4's runs, each timed one followed by the same search without the lane on its own context, after the one without "Helps them"). Its exact evaluations and screening simulations are read off each run's own progress (⚠️ a batch of ${cs.yieldEverySims} simulations' time shared out evenly where the lane's begin inside one); the rest, the final simulation, ranking, the shown pass, the merge's ladders and Plan B with the lane less without (more extras' final runs and the displaced finalists' kept ones, a bigger Plan B pool and second list), is warm only (the cold extra adds the warm figure).${measured}${splitText}`,
    "",
  );
  L.push(`| | Cold | Warm (median of ${r.runtime.runs.length}) |`, "|---|---|---|");
  L.push(`| The lane's exact evaluations (${c.exact.count}: its trades and their lean companions) | ${ms(c.exact.cold)} | ${ms(c.exact.warm)} |`);
  L.push(`| Their screening simulations (${c.simScreen.count}, the legal ones) | ${ms(c.simScreen.cold)} | ${ms(c.simScreen.warm)} |`);
  L.push(`| The rest: final simulation, ranking, the shown pass, the merge's ladders and Plan B, with the lane less without | – | ${msSigned(c.rest)} |`);
  L.push(`| **The lane's extra: the three parts** | ${c.extra.cold === null ? "–" : `≈ ${msChange(c.extra.cold)} ⚠️`} | ${c.extra.warm === null ? "–" : `${msChange(c.extra.warm)}${finite(c.with.warm) && finite(c.extra.warm) && c.with.warm - c.extra.warm > 0 ? ` (${signed((100 * c.extra.warm) / (c.with.warm - c.extra.warm), 1)}%)` : ""}`} |`);
  L.push(`| Search total with the lane (the app: section 4's) | ${ms(c.with.cold)} | ${ms(c.with.warm)} |`);
  L.push(`| Search total without the lane (measured) | – | ${ms(c.measured.without)} |`, "");
}

/**
 * Whether an offer is another card of the search's lists (section 11; the lead's call, wave D: the card says "Also shown as
 * trade idea N."): "also trade idea N" by its place on the Overall list, else "also “Helps both” idea N" for a card of that
 * list alone; null for none, and for the suggested trade (the card itself).
 */
export function alsoCardText(result: Pick<TradeSearchResult, "trades" | "helpsBoth">, step: Pick<OfferStep, "kind" | "evaluation">): string | null {
  if (step.kind === "suggested") return null;
  const key = step.evaluation.key;
  const at = result.trades.findIndex((t) => t.key === key);
  if (at >= 0) return `also trade idea ${at + 1}`;
  const both = result.helpsBoth?.trades.findIndex((t) => t.key === key) ?? -1;
  return both >= 0 ? `also “Helps both” idea ${both + 1}` : null;
}

/**
 * An offer's mark in section 11 (the file header): "also trade idea N" when it's another card (alsoCardText), else since
 * Checkpoint 7f "merged: was trade idea N" when the search merged it into a card, by its place on the list without the merge
 * ("merged: was “Helps both” idea N" for one merged on that list alone; "merged" for one that wasn't a card without the merge:
 * it came in after a merge or, since Checkpoint 7g, a drop, MergeRow.freed); since Checkpoint 7g "dropped for a better
 * version: was trade idea N" when the search dropped it for a better version of the same trade (MergeSection.dropped; "dropped
 * for a better version" for one that wasn't a card without the merge); null for none and for the suggested trade.
 */
export function offerMarkText(result: Pick<TradeSearchResult, "trades" | "helpsBoth">, merge: (Pick<MergeSection, "rows"> & Partial<Pick<MergeSection, "dropped">>) | null, step: Pick<OfferStep, "kind" | "evaluation">): string | null {
  const also = alsoCardText(result, step);
  if (also || step.kind === "suggested") return also;
  const where = (l: ListName) => (l === "overall" ? "trade idea" : "“Helps both” idea");
  const rows = (merge?.rows ?? []).filter((r) => r.trade.key === step.evaluation.key);
  const row = rows.find((r) => r.list === "overall") ?? rows[0];
  if (row) return row.was === null ? "merged" : `merged: was ${where(row.list)} ${row.was}`;
  const drops = (merge?.dropped ?? []).filter((d) => d.trade.key === step.evaluation.key);
  const drop = drops.find((d) => d.list === "overall") ?? drops[0];
  if (!drop) return null;
  return drop.was === null ? "dropped for a better version" : `dropped for a better version: was ${where(drop.list)} ${drop.was}`;
}

/** A holder-below pair's shape in words (section 11's labels; LabelShape). */
export const LABEL_SHAPE_WORDS: Readonly<Record<LabelShape, string>> = { smaller: "it asks for fewer of their players", lean: "it's the higher idea's lean version", throwIn: "it adds a player of yours to the higher idea", other: "another version" };

/**
 * FreedBy in section 11's words (the final review of Checkpoint 7g, merge-ui-report-after-merge; the lead's ruling W3: "name
 * what freed the place (a merge or a dropped version) or say both"): after "a card only after" for a merged trade ("another
 * merge", "a dropped version", "another merge or a dropped version") or a dropped version ("a merge", "another dropped
 * version", "a merge or another dropped version"), and after "the usual rules after" for the cards that left ("a merge", "a
 * dropped version", "a merge or a dropped version").
 */
export function freedWords(freed: FreedBy, row: "merged" | "dropped" | "left"): string {
  const merge = row === "merged" ? "another merge" : "a merge";
  const drop = row === "dropped" ? "another dropped version" : "a dropped version";
  return freed === "merge" ? merge : freed === "drop" ? drop : `${merge} or ${drop}`;
}

/**
 * Section 11's merge in words (Checkpoint 7f; mergeSection): the counts, each merged trade with the card it went into, the
 * cards that came in and left, and the pairs kept with a label; since Checkpoint 7g each label's shape and why, the Last
 * offers that ask for fewer of their players, the versions dropped for a better version of the same trade, and the ladders a
 * preference changed.
 */
export function mergeLines(snapshot: LeagueSnapshot, m: MergeSection | null, teamName: (id: string) => string): string[] {
  if (!m) return ["**Merged cards**: the search stopped before ranking.", ""];
  const list = (l: ListName) => (l === "overall" ? "Overall" : "“Helps both”");
  const trade = (t: Pick<TradeEvaluation, "proposal" | "tradeScore" | "pAccept" | "pComplete" | "acceptLabel" | "overall"> & { detail: Pick<TradeDetail, "vetoRisk"> }) =>
    `${teamName(t.proposal.partnerId)}: ${names(snapshot, playerIds(t.proposal.give))} → ${names(snapshot, playerIds(t.proposal.get))} (${threeNumbers(t)})`;
  const offer = (o: ChoiceOffer) => `${OFFER_WORDS[o.kind]} ${names(snapshot, playerIds(o.printed.proposal.give))} → ${names(snapshot, playerIds(o.printed.proposal.get))} (${threeNumbers(o.printed)})`;
  const c = m.merged;
  const rounds = (n: number) => `${n} round${n === 1 ? "" : "s"}`;
  const share = fmt(100 * config.offers.lastMinOverallShare, 0);
  const dropped = c?.dominated?.length ?? 0;
  const L: string[] = [
    `**Merged cards** (planner reply to Checkpoint 7e, decision 3: a card whose "How to offer it" holds a card of its list below it on Overall takes it among its offers, and the next idea takes its place; since Checkpoint 7g, planner reply to Checkpoint 7f, answer 3: (a) a Last offer can ask for fewer of their players, keeping at least ${share}% of the card's Overall; (b) a ladder prefers the versions on its lists; (c) a version at least as good on both Helps you and the chance as another version of the same trade drops it): ${
      c
        ? `${c.overall.length} merged on the Overall list (${rounds(c.rounds.overall)}), ${c.helpsBoth.length} on "Helps both" (${rounds(c.rounds.helpsBoth)}); ${dropped} dropped for a better version of the same trade; ${c.ladders} ladder${c.ladders === 1 ? "" : "s"} read by the merge, worked out during the search${m.ms === null ? "" : ` in ${ms(m.ms)} (its "offers" timing)`}${c.released ? `; ${c.released} given back (in no offers of a card above it)` : ""}`
        : "off"
    }. The lists' cards without the merge → with it: Overall ${m.cards.overall.without} → ${m.cards.overall.with}, "Helps both" ${m.cards.helpsBoth.without} → ${m.cards.helpsBoth.with}.`,
    "",
  ];
  // The final review of Checkpoint 7g (merge-ui-report-after-merge): what let a trade in that wasn't a card without the merge, a
  // merge or a dropped version (freedWords), where these read "a card only after another merge" (or "a merge") whatever did; a
  // merged Last offer "a card without the merge" only when it was one.
  for (const r of m.rows) L.push(`- ${list(r.list)}: ${trade(r.trade)}, ${r.was === null ? `a card only after ${freedWords(r.freed ?? "either", "merged")},` : `idea ${r.was} without the merge,`} is now among the offers of idea ${r.intoPlace} (“${OFFER_WORDS[r.kind]}”), ${trade(r.into)}.`);
  for (const d of m.dropped) L.push(`- Dropped (${list(d.list)}; answer 3(c)): ${trade(d.trade)}, ${d.was === null ? `a card only after ${freedWords(d.freed ?? "either", "dropped")}` : `idea ${d.was} without the merge`}, for ${d.by ? trade(d.by) : "–"} (${d.byWhere}), at least as good on both Helps you and the chance as printed.`);
  if (m.smallerLast.length) L.push(`- Last offers that ask for fewer of their players (answer 3(a)): ${m.smallerLast.map((x) => `${list(x.list)} idea ${x.place}, ${trade(x.card)}: ${trade(x.offer)}, ${x.share === null ? "–" : `${fmt(100 * x.share, 1)}%`} of its Overall${x.merged ? (x.was !== null ? " (a card without the merge)" : " (merged)") : ""}`).join("; ")}.`);
  if (m.preferred.length) L.push(`- Ladders a preference changed (answer 3(b): a version on the list preferred where more than one meets a step's rules): ${m.preferred.map((x) => `${list(x.list)} idea ${x.place}, ${trade(x.card)}: ${x.usual.length ? x.usual.map(offer).join(", ") : "no offers"} → ${x.preferring.map(offer).join(", ")} (${x.held.length} preferred version${x.held.length === 1 ? "" : "s"} held)`).join("; ")}.`);
  if (m.cameIn.length) L.push(`- Came in: ${m.cameIn.map((x) => `${list(x.list)} idea ${x.place}, ${trade(x.card)}`).join("; ")}.`);
  if (m.left.length) {
    // One cause for them all when they share it, else each card's own after it (its list's records: freedByOf).
    const kinds = new Set(m.left.map((x) => x.freed));
    const one = kinds.size === 1;
    const freed: FreedBy = one ? ([...kinds][0] as FreedBy) : "either";
    L.push(`- Left, neither merged nor dropped (the usual rules after ${freedWords(freed, "left")}): ${m.left.map((x) => `${list(x.list)} idea ${x.was} without the merge, ${trade(x.card)}${one ? "" : ` (after ${freedWords(x.freed, "left")})`}`).join("; ")}.`);
  }
  if (m.labels.length) L.push(`- Kept with a label (⚠️ the lead's call: an idea whose offers hold an idea above it on Overall, whose own offers don't include this one, so both stay and that offer says "Also shown as trade idea N."): ${m.labels.map((x) => `${list(x.list)} idea ${x.holderPlace}, ${trade(x.holder)}, offers idea ${x.heldPlace} (“${OFFER_WORDS[x.kind]}”; ${LABEL_SHAPE_WORDS[x.shape]}: ${x.why})`).join("; ")}.`);
  if (!m.rows.length && !m.labels.length && !m.dropped.length) L.push("- No card's offers hold another card of its list.");
  L.push("");
  return L;
}

/**
 * One offer in the report's words: its place, its players with their tags (and "also trade idea N" when it's another card:
 * alsoCardText; since Checkpoint 7f "merged: was trade idea N" when it's a merged trade: offerMarkText), Helps you and the
 * chance as printed, and Helps them under a card tagged "Helps both".
 */
function offerLine(snapshot: LeagueSnapshot, inputs: ModelInputs, step: OfferStep, tagged: boolean, also: string | null): string {
  const e = step.evaluation;
  const veto = e.detail.vetoRisk ? ` (goes through ${chancePrinted(e.pComplete)})` : "";
  return `${OFFER_WORDS[step.kind]}: ${sideText(snapshot, inputs, e, "give")} → ${sideText(snapshot, inputs, e, "get")}${also ? ` (${also})` : ""}: Helps you ${e.tradeScore ?? "–"} · ${chancePrinted(e.pAccept)} ${e.acceptLabel}${veto}${tagged ? ` · Helps them ${e.them?.helps ?? "–"}` : ""}`;
}

/** Section 11 (the file header): each setting's top cards' offers in order, their build times, and the candidates that print better than their card. */
function renderLadders(L: string[], snapshot: LeagueSnapshot, inputs: ModelInputs, r: Report, teamName: (id: string) => string): void {
  const main = GOAL_WORDS[r.settings.goal];
  const other = GOAL_WORDS[r.goals.goal];
  const o = config.offers;
  const st = config.search.steps;
  const gain = Math.round(100 * st.minAcceptGain);
  L.push("## 11. How to offer it: offers in order", "");
  L.push(
    `Planner reply to Checkpoint 7d, item 4.1: a card's "How to offer it" is up to ${o.maxSteps} offers to the same team, in order, worked out by the engine worker when it's opened (offers.ts, on the search's own state). **Open with**: the version best for you (the highest Helps you, at least the card's) that prints a chance of at least ${pctPlain(o.openMinChance, 0)} (or the minimum chance, when higher) and at least ${gain} points under the card's; **Then**: versions a little less good for you, each at least ${gain} points likelier than the one before and still ${gain} under the card; **The suggested trade**: the card; **Last offer**: the card plus a throw-in, at least ${gain} points likelier, keeping at least ${pctPlain(st.minBShare, 0)} of its B and never printing a higher Helps you than the card; or since Checkpoint 7g (planner reply to Checkpoint 7f, answer 3(a)) the card's side asking for fewer of their players, at least ${gain} points likelier, at a lower B, never a higher Helps you, and keeping at least ${pctPlain(o.lastMinOverallShare, 0)} of the card's Overall (unrounded), whichever of the two has the higher Overall (a tie to the throw-in). Every offer helps you and passes the market guard, and under a card tagged "Helps both" helps both. The candidates: the card's own side with any 1 to ${r.settings.maxPerSide} players of that team's get pool H (the search's), and the lean version (the card without your cheapest throw-in in it); never the card's Plan B, which stays below the list ("If they won't move: try …"; since Checkpoint 7f by the rules alone, nothing barred). ⚠️ Another card of the list can be an offer (the lead's call, wave D, in place of the review's barring, D-ENG-2 and UI-D-2), marked "also trade idea N" by its place on the list, as the card says it ("Also shown as trade idea N."); since Checkpoint 7f only one above it on Overall, whose own offers don't include this card (the lead's call, policy (a)): one below it is merged into the card ("merged: was trade idea N", by its place without the merge; "Merged cards" below each setting). Since Checkpoint 7g (answer 3(b)) a ladder prefers, where more than one version meets a step's rules, the cards of its lists below it ("Ladders a preference changed" below each setting), and (answer 3(c)) a version at least as good on both Helps you and the chance as another version of the same trade drops it ("dropped for a better version: was trade idea N"). ⚠️ Pre-screened (the review of wave D, D-ENG-1): only the candidates whose quick estimate of the chance (the screening's fast method) lies within ${pctPlain(o.preScreenMargin, 0)} of the Open's and Then's window are played out, the most your lineup gains on the fast method first, at most ${o.preScreenMax}; on the first cards every candidate is played out too, to check it picks the same offers. Chosen on the screening block, each rule held on the numbers the offer prints (the shown block's ${thousands(shownSimsOf())} seasons, the card's). The chance as the card prints it, with its label ("goes through" when the veto cuts it). Built in: each card's first open right after a search, in Node, the median over the runs (under "${main}" section 4's ${r.runtime.runs.length} timed runs; under "${other}" as many of its own), each run on a trade context and search of its own; ⚠️ the cards opened in order, so a card can reuse what an earlier one built on the same context (the same partner's versions), as in the worker; the browser takes about ×1.24 (Checkpoint 7d's check:browser). "Kept" (Checkpoint 7f): the search's merge worked that ladder out, so a first open hands it back as it is (its time is the merge's, "offers").`,
    "",
  );
  const setting = (label: string, s: LadderSetting, result: TradeSearchResult): void => {
    L.push(`**${label}**:`, "");
    if (!s.rows.length) {
      L.push("No cards.", "");
      return;
    }
    s.rows.forEach((row, i) => {
      const c = row.card;
      const tagged = helpsBoth(c);
      const built = row.kept ? `kept from the search (its merge read it), handed back in ${ms(median(row.ms))}` : `built in ${ms(median(row.ms))} (${row.ms.map(ms).join(" / ")})`;
      L.push(`${i + 1}. ${teamName(c.proposal.partnerId)}: ${sideText(snapshot, inputs, c, "give")} → ${sideText(snapshot, inputs, c, "get")} (${threeNumbers(c)}${tagged ? `; Helps both, Helps them ${c.them?.helps ?? "–"}` : ""}): ${row.ladder.steps.length} offer${row.ladder.steps.length === 1 ? "" : "s"} from ${row.candidates} candidates, ${row.screened} legal ${row.screened === 1 ? "one" : "ones"} played out after the pre-screen, ${built}`);
      row.ladder.steps.forEach((step, k) => L.push(`   ${k + 1}. ${offerLine(snapshot, inputs, step, tagged, offerMarkText(result, s.merge, step))}`));
      if (c.planB) L.push(`   If they won't move: try ${names(snapshot, playerIds(c.planB.proposal.give))} → ${names(snapshot, playerIds(c.planB.proposal.get))} (${boxNumbers(c.planB)})`);
    });
    const offers = s.rows.flatMap((row) => row.ladder.steps.filter((step) => step.kind !== "suggested"));
    const cards = offers.filter((step) => alsoCardText(result, step) !== null).length;
    const marked = (prefix: string) => offers.filter((step) => alsoCardText(result, step) === null && (offerMarkText(result, s.merge, step) ?? "").startsWith(prefix)).length;
    const merged = marked("merged");
    const dropped = marked("dropped");
    const smaller = s.rows.filter((row) => row.ladder.steps.some((step) => step.kind === "last" && smallerAskOf(row.card.proposal, step.evaluation.proposal))).length;
    L.push("", `Of these ${offers.length} offer${offers.length === 1 ? "" : "s"} besides the cards themselves, ${cards} ${cards === 1 ? "is" : "are"} another card of the list${merged ? ` and ${merged} ${merged === 1 ? "is a trade" : "are trades"} merged into ${merged === 1 ? "its card" : "their cards"}` : ""}${dropped ? `; ${dropped} ${dropped === 1 ? "is a version" : "are versions"} dropped for a better version of the same trade` : ""}. ${smaller} of these ${s.rows.length} cards' Last offers ask${smaller === 1 ? "s" : ""} for fewer of their players (Checkpoint 7g).`);
    const withBetter = s.better.filter((b) => b.better.length > 0);
    const likelier = s.better.reduce((n, b) => n + b.likelier, 0);
    const list = withBetter.flatMap((b) => b.better.map((v) => `${names(snapshot, playerIds(b.card.proposal.give))} → ${names(snapshot, playerIds(b.card.proposal.get))} (${b.card.tradeScore ?? "–"}, ${chancePrinted(b.card.pComplete)}): ${v.kind === "lean" ? "its lean version" : "the variant"} ${names(snapshot, playerIds(v.proposal.give))} → ${names(snapshot, playerIds(v.proposal.get))} (${v.tradeScore ?? "–"}, ${chancePrinted(v.pComplete)})`));
    L.push(
      "",
      `⚠️ Candidates that print a higher Helps you and a higher chance than their card (the lead's question; the ladder's chance rules keep them out: "a better card, not a first offer"), on the first ${s.better.length} cards: ${list.length ? `${list.length} on ${withBetter.length} card${withBetter.length === 1 ? "" : "s"}: ${list.join("; ")}` : "none"} (of ${s.better.reduce((n, b) => n + b.screened, 0)} legal candidates, every one played out, ${likelier} print a higher chance, each played out on the card's seasons). The pre-screen picks the offers every candidate gives on ${s.better.filter((b) => b.same).length} of these ${s.better.length} cards.`,
      "",
    );
    L.push(...mergeLines(snapshot, s.merge, teamName));
  };
  setting(main, r.ladders.title, r.result);
  setting(`${other}${r.goals.reward ? ` (${prizesWords(r.goals.reward)})` : ""}`, r.ladders.other, r.goals.result);
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
      `trade report written (${args.dump ? "offline" : "live"}) in ${ms(report.timing.total)}: ${c.shown} cards (Plan B ${c.planB}, injury-tagged received ${c.injuredGet}, Plan B boxes with one ${c.planBInjuredGet}); playoff weeks × ${report.model.playoffWeight} (${report.model.playoffWeightAuto?.basis ?? "?"}); search ${ms(report.runtime.search.total)} warm, ${thousands(report.result.counts.screened)} screened; top card Helps you ${top?.tradeScore ?? "–"}, Overall ${top?.overall ?? "–"}; ${GAP_TRADE.get.join(" + ")} card ${report.gap.card ?? "–"}; anchors ${anchors.filter((a) => a.pass).length}/${anchors.length}; baseline = LeagueModel.odds ${report.odds.baselineEqual ? "yes" : "NO"}${report.pre4c ? "; a dump from before the 4c adapter, put on the weekly reset order" : ""}; ${GOAL_WORDS[report.goals.goal]} (${report.goals.reward ? prizesWords(report.goals.reward) : "–"}): ω ${report.goals.omega.other}×, B₃ ${fmt(report.scale.b3[report.goals.goal]?.b3, 2)}, ${report.goals.commonTop} of the top ${GOAL_TOP} kept, ${helpsBothSummary(report.helpsBoth, report.settings.goal)}; ${ladderSummary(report.ladders, GOAL_WORDS[report.goals.goal])}`,
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
