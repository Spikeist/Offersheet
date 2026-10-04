/**
 * Trade evaluation (CLAUDE.md §7 roster legality, §10, §11, §12 steps 1–5; Phase 4 wave 2 lead decisions M1–M5,
 * M11, M15): the evaluation context built once per search or Analyzer session, roster legality, screening, exact
 * evaluation and the season simulations behind B. Pure and deterministic: no I/O, no clock (`now` and an optional
 * clock for timings are passed in), the only randomness is the scenarios' and the season simulation's seeded
 * common random numbers; every tunable number comes from config.
 *
 * The context (buildTradeContext; M1). Built once, reused by every search and Analyzer call on the same league:
 * - The League model's steps 1–6 (league.ts buildLeagueModelWithContext, no simulation of its own): projections,
 *   scenarios, values, streaming, every team's lineups, its free-agent-optimized roster V*(T) (from scratch) and
 *   lineup costs, trade chips, surplus scores and MV_add's bases. It reads only the settings the League model reads
 *   (streamPositions, playoffWeight); the search and the Analyzer take the rest per call.
 * - The baseline (L6): every team at V*(T), whose moves are judged in scenario lineups when scenarios run, the lineups
 *   B is measured in (optimizer.ts; review of track E, item 1: an EV-judged V* skipped depth pickups, so a trade
 *   bringing the same depth got credit for them). Each team's weekly score for the simulator comes from V*(T)'s lineups the
 *   way TeamModel.score is built (scenario mean and sqrt(within-lineup variance + the scenarios' spread²); EV lineups
 *   and sqrt(Σ σ²) without scenarios), streaming rows and IR returners included, finally priced (sideEval: the roster
 *   spot a returner needs from his week; "IR players" below). ⚠️ The week in progress (LeagueModel.inProgressWeek):
 *   its score stays each team's TeamModel.score week-0 value (rosters as they stand, as before kickoff) before and
 *   after every trade, since a trade or a pickup can't change a week under way. A trade made before kickoff counts
 *   the current week in full (⚠️ the platform's review period isn't modeled).
 * - One SimSetup (season.buildSimSetup on the baseline scores) and one common-random-numbers matrix (sim.simNormals of
 *   the simulation seed) of screeningSims + finalSims seasons in two blocks (review of track E, item 2): the screening
 *   simulation reads the first screeningSims seasons, the final one (the search's finalists, the Analyzer, and the
 *   baseline odds every profile reads) the next finalSims, seasons the screening never saw. Choosing trades on the
 *   screening's seasons and showing B from the same seasons would show the luck that chose them (the shown B was above
 *   other seeds' for 21 of 25 trades). Within each block every run shares the draws (common random numbers). The
 *   baseline odds of each block go through the same code as every trade's "after" run, so a trade that changes neither
 *   side's V* moves nothing.
 * - Once: partner profiles (acceptance.partnerProfile, P(playoffs) from the finalSims baseline), hot players, the
 *   deadline urgency, perception values and the waiver credit W (the League model's), long-term values and MyDynTotal
 *   when they loaded (benefit.futureValuesLoaded), the league median of every slot instance over the hole weeks (the
 *   holeWeeks weeks from the first week team numbers count; EV lineups for screening, the exact mode's for exact
 *   evaluation), every team's rank at every instance (TradeDetail.partnerSlots), my risky weeks (TradeDetail), and the
 *   star premium of every rostered player for his own team (planner addendum to Checkpoint 3, §1; lead decision N1:
 *   premium.leaguePremiums, the League model's own function, with each team's P(playoffs) from this finalSims baseline
 *   for the dynasty rebuilding rule), which also tags "Harder to get" players (§2; N2: the search's get pool reads it).
 * - Notes (TradeContext.notes): no team picked (nothing can be evaluated), no weeks left, my team certainly
 *   eliminated in a redraft league, the trade deadline passed, no odds (the schedule didn't load or the simulator
 *   refused it: B can't be computed). Any of them stops the search (no trades); the Analyzer still evaluates, with
 *   the note (without B when there are no odds), except without a team.
 *
 * One free agent, one team (CLAUDE.md §7; planner reply to Checkpoint 4, change 3; league.ts step 5). The League model
 * builds every V*(T) in the allocation order, each team claiming every free agent its run adds (TeamState.claimed), so
 * the baseline never gives one free agent to two teams. A trade re-optimizes only its two teams (tradeSides); every other
 * team keeps its baseline pickups: X = the free agents every other team claimed (othersPool). The earlier of me and the
 * partner in the allocation order goes first: its legality adds (rules 3–4 below) and its V*(after) draw from the pool
 * minus X; then the later one's, from the pool minus X minus every free agent the first one added here (legality's adds
 * and every add of its V*(after) run). So my V*(after) may take a free agent the partner picked up in the baseline when
 * I'm earlier in the order, and never one a third team picked up. A baseline pickup the first one gives up after the
 * trade: ⚠️ ours (Phase 4b track C and its review; the design let the later team take him whatever the order): the later
 * one may take him only when no team sits between the two in the order. Every team ahead of the first one passed on him
 * in the baseline (he was in its pool) and keeps its baseline, so the later one is next in line; a team between them
 * never had a chance at him and would claim him first, but it keeps its baseline allocation (the planner's rule), so then
 * nobody adds him. On Parker's league (Oct 3, live waiver order) the design's rule gave me Jordan Love in two of the top
 * 10 trades with Team 5, first in that order (I was last), while Team 10, between us, picks him up when each team is
 * optimized on its own. A trade that changes neither roster still reproduces the baseline (the later team's baseline run excluded the
 * earlier one's pickups too, and greedy determinism, optimizer.ts "The pool", makes each side's run against its pool the
 * moves its baseline run made), exactly but for gains within 1e-9 of each other (⚠️ optimizer.ts, "The pool").
 * Screening's legality adds skip each side's baseline exclusion excl(T) (TeamState.pool), ⚠️ whatever the trade's order:
 * screening is a filter. TradeContextOptions.faAllocation "independent" (Checkpoint 4's rule, for the Checkpoint 4b report
 * only) runs every team, and both sides of every trade, against the whole pool, mine first.
 *
 * Roster legality (§7; M2). Assets are players in this phase (M11: ⚠️ draft picks are deferred to Phase 5).
 * - Illegal, in plain English: a pick; no asset at all; a player twice; more than the per-side maximum (the
 *   Analyzer's analyzerMaxPerSide, the search's maxPerSide); an asset not on that side's active roster or IR (IR players
 *   are tradable since Phase 4b; taxi players still aren't; under irReturners false, Checkpoint 4's rule, only
 *   active-roster players are). One empty side is legal (a 1-for-0 the Analyzer can build).
 * - 5 (first: IR players; planner reply to Checkpoint 4, change 5; returners.irAfterTrade). An IR player given leaves the
 *   giver's IR (its IR slot opens; no active spot does). An IR player received goes into an open IR slot of the receiver
 *   (irSlots minus the IR players it keeps) when his status is one the slot takes (returners.irEligibleStatuses:
 *   LeagueSettings.irEligible, else config.lineups.irEligibleDefault, IR and PUP), as a returner (no active spot, never
 *   dropped); otherwise he joins the active roster like any received player. Several: the most ROS points first into the
 *   open slots (ties: the smaller id). ⚠️ A player received from the other team's active roster joins the active roster
 *   whatever his status. The side's IR after the trade is LegalSide.ir, and its spec (its streaming rows with that IR's
 *   returners: league.ts withReturners) is LegalSide.spec, which every later solve of the side uses (its V*(after), the
 *   final evaluation). Every lineup legality solves holds those returners (no displacement: legality isn't final).
 * - Each side's active roster after the trade = its roster − the active-roster players it gives + the players it receives
 *   who don't go to its IR. Then, in order:
 *   1. A position over its positionLimits → drop that position's lowest keep value player not just received (none →
 *      illegal). ⚠️ A team already over a limit before the trade is held only to its count before the trade.
 *   2. Over maxRosterSize → drop the lowest keep value players, never one just received, never one the starting
 *      lineup needs (optimizer.fillCount: the slots fillable before stay fillable, streaming rows counting for their
 *      position, returners not), never the last one the side rosters at a position it streams (⚠️ ours, final review of
 *      Phase 4b, the displacement's rule in returners.ts: streaming a K or D/ST takes a roster spot for the week's pickup,
 *      and the streaming row takes none, so the row covering the slot doesn't make the only rostered one free to drop),
 *      one at a time, recomputed. ⚠️ A roster already over the size before the trade isn't trimmed by it.
 *   3. A position under rosterMinimums → add the best free agent there (EV ROS gain, ties as in 4; none → illegal), from
 *      the side's pool ("One free agent, one team" above), as in 4.
 *      ⚠️ Only up to the count the team had before the trade (a shortfall the trade didn't cause isn't its to fix).
 *      ⚠️ The add takes a roster spot like any other: when it leaves the roster too big, rule 2 makes room again
 *      (never dropping the player added, nor one a position's minimum needs).
 *   4. Each roster spot the trade opened (fewer active players than before it) → add the free agent who most improves
 *      its lineup (EV ROS gain; ties, including no gain at all: higher ROS points, then the smaller id), within
 *      position limits, never at a position the team streams (its streaming row values that slot), only from the side's
 *      pool (legalSide's `pool`: "One free agent, one team" above). At a config.streaming.optimizerExcluded position
 *      (K, D/ST) only to refill a starting slot the trade emptied: the roster's structural fill (optimizer.fillCount,
 *      streaming rows counting) is below `before`'s, and he raises it. So a team that doesn't stream kickers and trades
 *      its only one still gets one in the spot (review of track E, item 5), but ⚠️ an upgrade of a kicker or D/ST it
 *      keeps is never the trade's (Phase 4b review of track C: V* never picks one up, so a 2-for-1 whose open spot took a
 *      better free-agent kicker credited the trade with a pickup the team could make anyway; on Parker's league, Oct 3,
 *      7 of the 19 shown trades raised the partner's lineup by about 1.1 a week that way).
 *   Keep value (§7): what losing him costs the roster's lineup with nobody refilling his spot (teamValue.
 *   evRemovalCosts / scenarioRemovalCosts) in the evaluation's lineup mode (EV in screening, scenario lineups in exact
 *   evaluation); in dynasty and keeper leagues with long-term values, ⚠️ (L7's reading of "plus normalized market
 *   value") removal cost ÷ the roster's largest removal cost + v_dyn ÷ the top dynasty value. Only players with a model
 *   are dropped (one without projections isn't known to be worthless); ties: teamValue.lowestKeepValue's (the lower
 *   perception value, then the smaller id). These forced moves are TradeEvaluation.required, per side, with rule 5's IR
 *   placements and the displacements the trade brings (rosterChangeOf).
 *
 * IR players (planner reply to Checkpoint 4, change 5 and answer 11; league.ts step 5b; returners.ts). Each team's IR
 * players expected back within the season (its returners) ride with its lineup rows everywhere a lineup is solved here:
 * screening, legality, V*(after) and the final pricing. The final pricing of a side (sideEval: the baseline at V*(T) and
 * both sides of every exact trade; B, n, h, the card's odds and the simulations) also puts a returner back on the active
 * roster from his return week: when that leaves it over maxRosterSize or his position over its limit, the lowest keep
 * value player goes from that week on (returners.finalLineups: its keep value over the weeks from the return on, in the
 * exact mode's lineups; ⚠️ the returner himself a candidate, so a return never lowers a side; never one the lineup needs,
 * one a position's minimum needs, or the last one at a position the side streams; at his position when its limit binds),
 * SideEval.displaced. Screening and legality don't (⚠️ the marginal machinery compares like with like without it). The
 * optimizer's memoized scenario lineups of a roster are reused only when nothing is displaced; else the lineups are
 * priced again where the dropped player started. The packages' open-spot credit counts each side's active-roster moves
 * (above): a given IR player opens no spot, a received one in an open IR slot fills none.
 * TradeContextOptions.irReturners false is Checkpoint 4's rule (no returner, no displacement, IR players not tradable).
 *
 * Screening (§12 step 2; M5): EV lineups, fast. My side: V*(me) − give + get with the legality above in EV mode (its adds
 * skip excl(me): "One free agent, one team" above), ⚠️ not re-optimized (for speed: the exact stage runs V*); myΔROS = EV
 * ROS(after) − EV ROS(V*(me)), Σ ω LV with the
 * user's playoff weight. The partner's side the same way from V*(P): ΔLineup_P (EV) → n, h from EV instance points
 * and the EV medians, g_mkt(P) (raw, i.e. no star premium, each player floored at W like every package, its open-spot
 * credit from its own moves on and off its active roster after rule 5 (spotsOf; market.ts's header):
 * Screened.gPartner, which the screening window reads) and the partner's perceived g
 * (the star premium on what it gives: perceivedG, the g feature), c, and acceptance.quickAcceptance (no hot, urg or
 * veto). Objective = myΔROS × quick P_accept. A screen that legality rejects is dropped. Speed (M14; about 15,000 screens on Parker's league), exactly:
 * a side's lineups start from the ones the context solved (V*(T)'s; the team's own in exact evaluation) and only the
 * weeks the trade can change are solved again (swapLook, swapSolve: a week where every outgoing player sits and no
 * incoming one's add bound is above 0 keeps its lineup); my side needs only its EV ROS, tracked through legality's moves
 * (a dropped player's removal cost, an added free agent's gain), and the partner's seats only in the hole weeks. Lineups
 * after a drop start from the ones solved before it (only the weeks he started are solved again: the same rows in the
 * same order, so the very same lineups; Phase 4 addendum, N6), and the position counts the rules read are kept as players
 * come and go.
 *
 * Exact evaluation (M3; L6, L8). Legality in scenario lineups, then V*(after) = the free-agent optimizer from scratch
 * on each side's post-legality roster, the two sides in the allocation order from their pools ("One free agent, one
 * team" above; tradeSides), memoized by roster and pool, judged in scenario lineups like the baseline, and its own
 * scenario lineups reused (optimizer.scenarioValuesOf); scenario lineups of both (EV without scenarios) → weekly
 * scores, LV per week and slot-instance points. ΔPPW / ΔPPW_playoffs: my average LV change over the remaining
 * regular-season / playoff weeks team numbers count. n from the partner's V* LV before and after
 * (acceptance.partnerLineupDelta from the first counted week); h (acceptance.holeFeature) from the partner's instance
 * points over the hole weeks before and after and the baseline league medians, with the received players who start in
 * the partner's after-V* EV lineup in at least one hole week; g from perception packages (benefit.tradePackage, each
 * player at max(v, W): planner reply to Checkpoint 4, change 4, which replaces lead decision N10; each side's open-spot
 * credit W from its own moves on and off its ACTIVE roster after rule 5 (spotsOf: an IR slot isn't a roster spot, review
 * of track E; market.ts's header), so with an IR player in the trade my package and the partner's needn't mirror each
 * other; the raw g_mkt(P), no
 * premium, on the card and for the veto rule, g_mkt(me) on the card and for B's market term) and the partner's perceived g
 * (premium.perceivedPackage: v′ = max(v, W) × (1 + e) on what it gives, the g feature; N1); the card's values (my
 * package, floored the same way), ROS points (§6 step 7) given and received, the injured flag; acceptance(...) with hot
 * and urg; TradeDetail.premium, one PremiumFact per player the partner gives. ΔDyn (dynasty and keeper leagues with
 * long-term values): my package on the future values and the future term's W, floored the same way (so a player worth
 * less than W given for nothing moves it by 0) with my active-roster spots; MyDynTotal raw (benefit.rosterValue).
 *
 * The simulation (M4): the baseline SimSetup with my team's and the partner's mean and SD rows replaced by their
 * after-V* scores (every other team, and the week in progress, unchanged), simulateSeason on the screening block
 * or the final block; ΔPO, ΔCH (null when title odds are unknown: benefit's titleMissing rule), ΔEW against the
 * baseline on the same block. Then benefit() (λ = settings.lambda ?? the default by my finalSims baseline
 * P(playoffs); κ = the "Protect my trade value" level's, redraft leagues only: planner addendum to Checkpoint 3, §3, N3;
 * the market term reads g_mkt(me), each player at max(v, W) on both sides: benefit.ts's header), tradeNumbers,
 * tradeFlags (on the same g_mkt(me)), and benefitNotes into the detail's notes.
 *
 * "Offer first / if they say no" (planner addendum to Checkpoint 3, §4; lead decision N4; tradeSteps). A throw-in is one of
 * my active-roster players with a model whose lineup cost in the exact mode (TeamPlayerValue.mvLoseScen with scenarios, else
 * mvLoseEv: MV_lose against my free-agent-optimized roster V*, so a backup who covers injuries and byes isn't free) is at
 * most config.search.throwInMaxCost, not at a position the search leaves out unless includeKDefIdp, not untouchable, not
 * must-include (throwIns). Every version below is evaluated as the search's exact trades are (legality re-checked, exact
 * evaluation, the screening simulation: tradeVersion), and the versions are compared on the screening block of seasons.
 * - Case 1, the ranked trade gives a throw-in and my side keeps a player without it: offer first = the trade without my
 *   lowest-value throw-in there (perception value; ties: the smaller id); if they say no, add it back (= the ranked trade).
 * - Case 2, otherwise: offer first = the ranked trade; if they say no, add the throw-in not in the trade (my side within the
 *   per-side maximum: the search's maxPerSide, the Analyzer's analyzerMaxPerSide; legal) with the highest P_complete among
 *   those keeping B at least minBShare × the offer's B (⚠️ both B at screeningSims on the screening block, a fair
 *   comparison); ties: the higher B, then the smaller id. ⚠️ For speed the candidates are pre-screened (preScreenOrder: the
 *   screening's quick P_accept, which moves with g, h and n, halved by the veto rule as P_complete is; then the screening's
 *   ΔROS) and only the best config.search.steps.preScreen get exact evaluation (the Checkpoint 4 report measures how often
 *   that misses the exact choice).
 * - Steps are kept only when P_complete(full) − P_complete(offer first) ≥ minAcceptGain and P_complete(offer first) ≥
 *   minOfferFirst (⚠️ on P_complete, the card's "Chance they accept"). ⚠️ Under the value floor (planner reply to
 *   Checkpoint 4, change 4) a throw-in worth less than W adds W to both sides of every package (his floored value on the
 *   side that gets him, the roster spot he takes on the other; nothing on either when that side gave more players):
 *   the value difference doesn't move, but each g, a ratio, edges toward 0, while the extra player costs the complexity
 *   term. So besides their lineup, such a throw-in moves the chance they accept through g: up when they lose value, down
 *   when they gain. A trade just past the veto line (g_mkt(P) < veto.gBelow) can come back above it with him, so the
 *   veto no longer cuts P_complete: a step from value nobody gains (market.ts's header; reported to the planner).
 * - ⚠️ The offer-first version must help me (B > 0 on the screening block; review of the addendum, engine findings 1 and
 *   10): case 1's lean version, case 2's ranked trade (so minBShare only ever compares positive B: with an offer at B −5,
 *   "B ≥ 0.8 × the offer's B" would ask for B ≥ −4, a better B rather than at most a fifth less, and coach a trade that
 *   hurts me), and case 2's full version too. No step ever advises offering a trade that doesn't help.
 * The search gives the shown trades steps (after ranking: the ranking stays on the ranked trade's numbers; versions its exact
 * stage evaluated are reused); the Analyzer gives the analyzed trade steps too, ⚠️ only when the Trade Finder could show it
 * (B > 0 and not hidden by the market guard: never "how to offer it" on a card that says the trade doesn't help), and none
 * when a context note stops the search. TradeStep.detail is each version's explanation facts: the pitch names the
 * offer-first version (explain.ts).
 *
 * Phase 4b removed the before/after variant (TradeContextOptions.beforeAddendum, lead decision N5: the model before the
 * planner's addendum to Checkpoint 3, kept for the Checkpoint 4 report's comparison only); Checkpoint 4b compares against
 * Checkpoint 4's committed numbers and a run of the Checkpoint 4 commit instead.
 *
 * ⚠️ Known approximations (M15): screening isn't re-optimized, and its legality adds skip each side's baseline exclusion
 * whatever the trade's order; after a trade every other team keeps its baseline pickups (the planner's rule: a free agent
 * a trading team no longer claims isn't offered to a third team, nor to the other trading team when a team sits between
 * the two in the order); IR players (Phase 4b): the roster spot a returner needs counts in final evaluations only (never
 * in screening, legality or V*'s moves), and from one week, his expected return week R (the return distribution's
 * median), while his points follow his availability week by week (TradeEvaluation.required names, per side, the received
 * IR players placed in IR slots and the displacements the trade brings: rosterChangeOf);
 * an IR player counts at max(v, W) in every package though no free agent could take his IR slot; the search's get pool
 * judges an open IR slot of mine before the trade; a player received from an active roster never goes to IR; the review
 * period isn't modeled; draft picks are deferred.
 */
import { acceptance, hotPlayers, hotTerm, hotWeeks, holeFeature, median, partnerLineupDelta, partnerProfile, quickAcceptance, tradeDeadlinePassed, transactionWeek, urgencyTerm, vetoApplies, type HoleSlot, type PartnerProfile, type ReceivedPlayer, type ReceivedStarter } from "./acceptance";
import { benefit, benefitNotes, futureValuesLoaded, injuredReceived, protectValueWeight, rosterValue, tradeFlags, tradeNumbers, tradePackage } from "./benefit";
import { config } from "./config";
import { explainTrade, injuryTags, tagContextOf, type ExplainContext } from "./explain";
import type { ModelInputs } from "./inputs";
import { ODDS_REFUSED_WARNING, buildLeagueModelWithContext, claimedBy, type FaAllocationMode, type LeagueContext, type TeamBase, type TeamWork } from "./league";
import type { LeagueModel, PlayerPremium, SeasonOdds, SlotInstance } from "./leagueModel";
import { marketValues, valuesForTerm, waiverCredit, type ActiveSpots } from "./market";
import { lineupTotal, prepareRoster } from "./lineup";
import { instancePointsInto } from "./needs";
import { POSITIONS, type InjuryStatus, type LeagueSnapshot, type PlayerInfo, type Pos, type Team } from "./model";
import { FULL_POOL, fillCount, poolRestriction, returnersOf, rosterKey, type OptimizedRoster, type PoolRestriction, type StreamSpec } from "./optimizer";
import { leaguePremiums, perceivedPackage, premiumFacts } from "./premium";
import { activeSpots, finalLineups, irAfterTrade, irEligibleStatuses, type Displacement } from "./returners";
import { buildSimSetup, oddsSkippedWarning, seasonOdds, type SeasonModel, type SimSetupResult } from "./season";
import { defaultTradeSettings, normalizeTradeSettings, type ProtectValue, type TradeSettings } from "./settings";
import { simNormals, simulateSeason, type SimNormals } from "./sim";
import {
  addGainExact,
  addFloors,
  addUpperBoundWeeks,
  evInstancePoints,
  evRemovalCosts,
  evScore,
  evStarter,
  isStreamId,
  lowestKeepValue,
  ppw,
  rosValue,
  scenarioRemovalCosts,
  scenarioScore,
  scenarioValues,
  solveEvWeeks,
  teamEval,
  type ScenarioCells,
  type SolvedWeeks,
  type TableRow,
  type WeeklyScore,
} from "./teamValue";
import type { RosterChange, SlotChange, TradeAsset, TradeDetail, TradeEvaluation, TradeEvaluationCore, TradeProposal, TradeStep, TradeSteps } from "./tradeModel";

/** Gains closer than this are ties or zero (float noise, not a tunable). */
const EPS = 1e-9;

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface TradeContextOptions {
  /** The moment the numbers are for (a game that kicked off before it no longer counts; urgency). */
  now: Date;
  /**
   * The user's settings. The context reads only what the League model reads (streamPositions, playoffWeight:
   * src/lib/settingsStore.ts LEAGUE_MODEL_SETTINGS); the search and the Analyzer take the rest per call.
   * Default: defaultTradeSettings().
   */
  settings?: TradeSettings;
  /** Availability scenarios (default config.lineups.scenarios), their seed, and the season simulation's seed. */
  scenarios?: number;
  seed?: number;
  simSeed?: number;
  /** Milliseconds (performance.now in the browser): TradeContext.timings is filled only when given. */
  clock?: () => number;
  /**
   * The League model's free-agent allocation (league.ts BuildLeagueModelOptions.faAllocation): "oneTeam" (the default)
   * or "independent" (Checkpoint 4's rule, for the Checkpoint 4b report only; the app never sets it): every team's
   * V* and both trade sides against the whole pool, mine evaluated first.
   */
  faAllocation?: FaAllocationMode;
  /**
   * IR returners (league.ts BuildLeagueModelOptions.irReturners; step 5b): true (the default) brings IR players back into
   * their teams' lineups and makes them tradable; false is Checkpoint 4's rule (IR players never join a lineup and aren't
   * tradable), for the Checkpoint 4b report only: the app never sets it.
   */
  irReturners?: boolean;
}

export interface TradeContext {
  /** The user's team (snapshot.myTeamId when it names a team), null when none is picked: then nothing can be evaluated. */
  readonly myTeamId: string | null;
  /** The other teams, snapshot order. */
  readonly partnerIds: readonly string[];
  /** Plain-English notes and warnings about the whole context (no team picked, season over, deadline passed, no odds, …). */
  readonly notes: readonly string[];
  readonly warnings: readonly string[];
  /** Milliseconds per setup stage (only with opts.clock). */
  readonly timings: Readonly<Record<string, number>>;
}

// ---------------------------------------------------------------------------------------------
// Plain-English notes (the pages show them)

export const NO_TEAM_NOTE = "Pick your team on the Import Report to see trade ideas.";
export const NO_WEEKS_NOTE = "No weeks are left in this season, so there are no trades to suggest.";
export const SEASON_OVER_NOTE = "Your season's over — no trade helps this year.";
export const DEADLINE_PASSED_NOTE = "Your league's trade deadline has passed.";
export const NO_ODDS_NOTE = "Trade ideas need your playoff odds, and they couldn't be worked out from this league's schedule, so trades can't be scored.";

// ---------------------------------------------------------------------------------------------
// The context's internals (search.ts and the tests read them; the pages only see TradeContext)

/**
 * One evaluated roster of a team: its lineups as the exact mode prices them (scenario lineups when there are scenarios, else
 * EV), finally: its IR returners in and, from a returner's week, the roster spot he needs (league.ts step 5b;
 * returners.finalLineups).
 */
export interface SideEval {
  /** The roster (active players; streaming rows and returners aside). */
  roster: readonly string[];
  /** The players the roster drops from a week on for its returners (none when it has room). */
  displaced: readonly Displacement[];
  /** LV per week (aligned with LeagueModel.weeks): the scenario mean, or the EV lineup's. */
  lv: Float64Array;
  /** The simulator's weekly score (the week in progress: TeamModel.score's week-0 value). */
  score: WeeklyScore;
  /** Average instance points (LeagueModel.slots order) over the counted regular-season weeks, and over the hole weeks. */
  regular: Float64Array;
  hole: Float64Array;
  /** EV lineups, finally priced (who starts: the received-starter check, likely starters). */
  ev: SolvedWeeks;
}

/** A team in the context: who it is, its streaming, V*(T) and its baseline in both modes. */
export interface TeamState {
  index: number;
  id: string;
  team: Team;
  /** Its streaming rows and positions, and its IR returners (league.ts TeamWork.stream). */
  stream: StreamSpec;
  /** Its active roster (team.roster, each id once). */
  roster: readonly string[];
  /** Its IR (team.ir, each id once; league.ts TeamWork.ir). */
  ir: readonly string[];
  /** V*(T): the free-agent optimizer from scratch on the roster (the League model's own). */
  vstar: OptimizedRoster;
  /**
   * The free agents V*(T) claimed (league.ts claimedBy: every one its run added) and excl(T), every other team's claims
   * (the League model's TeamWork.pool; FULL_POOL under faAllocation "independent"): screening's legality adds skip them.
   */
  claimed: readonly string[];
  pool: PoolRestriction;
  /** Its place in the free-agent allocation order (0 = first claim), or null under faAllocation "independent". */
  claimRank: number | null;
  /** Baseline in the exact mode. */
  base: SideEval;
  /** Baseline in EV lineups (screening): LV per week, EV ROS, instance points over the hole weeks. */
  baseEv: { lv: Float64Array; ros: number; hole: Float64Array };
}

interface MyOdds {
  pPlayoffs: number;
  pTitle: number | null;
  expWins: number;
}

/** Which block of simulated seasons a run reads: the screening's or the final one (the file header, M4). */
export type SimStage = "screen" | "final";

export interface SimState {
  built: SimSetupResult;
  /** The two blocks of one common-random-numbers matrix: the first screeningSims seasons, then the next finalSims. */
  blocks: Record<SimStage, SimNormals>;
  seed: number;
  /** The baseline on the final block, as the League page reads odds: eliminated, weekly win chances, P(playoffs). */
  odds: SeasonOdds;
  base: Record<SimStage, MyOdds>;
}

/** Everything a search or an Analyzer call reads. Mutable only through its memos. */
export interface TradeInternals {
  snapshot: LeagueSnapshot;
  inputs: ModelInputs;
  now: Date;
  league: LeagueContext;
  model: LeagueModel;
  bases: TeamBase[];
  settings: TradeSettings;
  W: number;
  S: number;
  weights: Float64Array;
  /** The first week index team numbers count (1 with a week in progress, else 0). */
  from: number;
  inProgress: boolean;
  /** Week indexes: the counted regular-season weeks, the counted playoff weeks, the hole weeks (§11 h). */
  regIdx: number[];
  poIdx: number[];
  holeIdx: number[];
  /** The counted regular-season and playoff weeks themselves (ppw's lists). */
  regWeeks: number[];
  poWeeks: number[];
  teams: TeamState[];
  byId: Map<string, TeamState>;
  me: TeamState | null;
  /** The search returns no trades (a context note says why). */
  blocked: boolean;
  instances: SlotInstance[];
  /** Per instance: the positions its slot takes. */
  slotEligible: Pos[][];
  /** Perception values (§9; the League model's, raw) and the waiver credit W (every package floors each player at it). */
  values: Record<string, number>;
  credit: number;
  /**
   * The star premium (premium.leaguePremiums): team id → its rostered players' premiums (active, IR and taxi), each team's
   * P(playoffs) from the baseline on the final block (every team at V*). premiumOf and harderToGetFor read it.
   */
  premiums: Map<string, Record<string, PlayerPremium>>;
  /** Long-term values (dynasty and keeper leagues whose dynasty values loaded): values, W, top value, MyDynTotal. */
  future: { values: Record<string, number>; credit: number; top: number; myTotal: number } | null;
  profiles: Map<string, PartnerProfile>;
  hot: Set<string>;
  urg: number;
  /** League medians per instance over the hole weeks: EV (screening) and the exact mode. */
  medians: { ev: Float64Array; exact: Float64Array };
  /** Per team id: its rank (1 = best) at each instance, exact-mode regular-season averages, every team at V*. */
  ranks: Map<string, Int32Array>;
  riskyWeeks: number[];
  sim: SimState | null;
  /**
   * Free agents with a model (legality's adds): with their slot masks and the most they could add to any lineup
   * (Σ ω × their points), most first; and by their own ROS points (most first, then the smaller id).
   */
  faByGain: FaPick[];
  faByRos: TableRow[];
  /** Position counts of rosters (legalityQuiet), by array. */
  countMemo: WeakMap<readonly string[], Int32Array>;
  /** Exact-mode side evaluations by team and roster (V* rosters before and after trades). */
  sideMemo: Map<string, SideEval>;
  /**
   * Per partner id: X, the pool restriction of a trade with it (the file header, "Exact evaluation"): the free agents every
   * team but me and the partner claimed (FULL_POOL under faAllocation "independent"), built when first needed.
   */
  othersPool: Map<string, PoolRestriction>;
  /** IR players tradable and back in lineups (TradeContextOptions.irReturners; the League model's). */
  irOn: boolean;
  /** Every IR player's team (IR player id → team id): a received IR player may go into an open IR slot (legality's rule 5). */
  irOwner: Map<string, string>;
  /** The statuses an IR slot accepts (returners.irEligibleStatuses: LeagueSettings.irEligible, else config's default). */
  irEligible: ReadonlySet<InjuryStatus>;
  notes: string[];
  warnings: string[];
  timings: Record<string, number>;
}

/** A free agent legality can add, with his slot mask and Σ ω × his points (the most he could add to any lineup). */
export interface FaPick {
  row: TableRow;
  mask: number;
  max: number;
}

const internalsOf = new WeakMap<TradeContext, TradeInternals>();

/** The internals of a context built by buildTradeContext (search.ts, tests). */
export function tradeInternals(ctx: TradeContext): TradeInternals {
  const I = internalsOf.get(ctx);
  if (!I) throw new Error("Not a trade context built by buildTradeContext");
  return I;
}

// ---------------------------------------------------------------------------------------------
// Keys and small helpers

/** An asset's stable key: the player id, or the pick's season, round and original team. */
export function assetKey(a: TradeAsset): string {
  return a.kind === "player" ? a.id : `pick:${a.season}:${a.round}:${a.originalTeamId}`;
}

/** TradeEvaluation.key: the partner and each side's assets, sorted (dedupe, diversity, feedback records). */
export function proposalKey(p: Pick<TradeProposal, "partnerId" | "give" | "get">): string {
  const side = (xs: readonly TradeAsset[]) => xs.map(assetKey).sort(byId).join(",");
  return `${p.partnerId}|give:${side(p.give)}|get:${side(p.get)}`;
}

/** The players of a side (picks aren't evaluated in this phase). */
const playerIds = (xs: readonly TradeAsset[]): string[] => xs.flatMap((a) => (a.kind === "player" ? [a.id] : []));

const players = (ids: readonly string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));

function avgOver(perWeek: readonly ArrayLike<number>[], idx: readonly number[], size: number): Float64Array {
  const out = new Float64Array(size);
  if (!idx.length) return out;
  for (const w of idx) {
    const row = perWeek[w];
    if (!row) continue;
    for (let i = 0; i < size; i++) out[i] = (out[i] as number) + ((row[i] as number) || 0);
  }
  for (let i = 0; i < size; i++) out[i] = (out[i] as number) / idx.length;
  return out;
}

// ---------------------------------------------------------------------------------------------
// The star premium (planner addendum to Checkpoint 3, §1–§2; lead decisions N1, N2)

/** A player's star premium e for team `teamId` (his owner): 0 for a player it doesn't roster. */
export function premiumOf(I: TradeInternals, teamId: string): (playerId: string) => number {
  const premiums = I.premiums.get(teamId);
  return (playerId) => premiums?.[playerId]?.e ?? 0;
}

/** Whether a player is "Harder to get" from team `teamId` (his owner): e ≥ harderToGetMin. */
export function harderToGetFor(I: TradeInternals, teamId: string, playerId: string): boolean {
  return I.premiums.get(teamId)?.[playerId]?.harderToGet === true;
}

/**
 * The partner's perceived g (premium.perceivedPackage): what it receives (`give`, my side) against what it gives (`get`)
 * with its own premiums on the latter, its open-spot credit from `spots` (its own moves on and off its active roster:
 * spotsOf its legality; absent, every player takes a spot). `raw`, the partner's raw g_mkt on the same values and spots
 * when the caller has it, is returned as it is when none of `get` carries a premium (perceivedPackage equals tradePackage
 * exactly then: a shortcut for the screening's thousands of trades).
 */
export function perceivedG(I: TradeInternals, partnerId: string, give: readonly string[], get: readonly string[], raw?: number, spots?: ActiveSpots): number {
  const e = premiumOf(I, partnerId);
  if (raw !== undefined && get.every((id) => e(id) === 0)) return raw;
  return perceivedPackage({ players: give }, { players: get }, I.values, I.credit, e, config.market, spots).g;
}

const POS_WORDS: Readonly<Record<Pos, [string, string]>> = {
  QB: ["QB", "QBs"],
  RB: ["RB", "RBs"],
  WR: ["WR", "WRs"],
  TE: ["TE", "TEs"],
  K: ["kicker", "kickers"],
  P: ["punter", "punters"],
  DEF: ["D/ST", "D/STs"],
  DL: ["DL", "DLs"],
  LB: ["LB", "LBs"],
  DB: ["DB", "DBs"],
};
const posWords = (pos: Pos, n: number): string => `${n} ${(POS_WORDS[pos] ?? [pos, `${pos}s`])[n === 1 ? 0 : 1]}`;

// ---------------------------------------------------------------------------------------------
// The context

/** The evaluation context (see the file header). */
export function buildTradeContext(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: TradeContextOptions): TradeContext {
  const clock = opts.clock;
  const timings: Record<string, number> = {};
  const start = clock ? clock() : 0;
  let last = start;
  const mark = (stage: string) => {
    if (!clock) return;
    const t = clock();
    timings[stage] = (timings[stage] ?? 0) + (t - last);
    last = t;
  };
  const settings = normalizeTradeSettings(opts.settings ?? defaultTradeSettings());
  const simSeed = opts.simSeed ?? config.simulation.seed;
  const built = buildLeagueModelWithContext(snapshot, inputs, {
    now: opts.now,
    sims: 0,
    settings,
    ...(opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {}),
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    ...(opts.faAllocation !== undefined ? { faAllocation: opts.faAllocation } : {}),
    ...(opts.irReturners !== undefined ? { irReturners: opts.irReturners } : {}),
  });
  const { model, context: league, bases } = built;
  mark("league model");

  const { W, S, tw, lp, instances, index } = league;
  const weeks = lp.weeks.weeks;
  const weekIndex = new Map(weeks.map((w, i) => [w, i]));
  const inProgress = tw.inProgressWeek !== null;
  const regWeeks = tw.regularWeeks;
  const poWeeks = lp.weeks.playoffWeeks.filter((w) => w !== tw.inProgressWeek);
  const regIdx = regWeeks.flatMap((w) => weekIndex.get(w) ?? []);
  const poIdx = poWeeks.flatMap((w) => weekIndex.get(w) ?? []);
  const holeWeeks = Number.isFinite(config.acceptance.holeWeeks) ? Math.max(0, Math.floor(config.acceptance.holeWeeks)) : 0;
  const holeIdx: number[] = [];
  for (let w = tw.from; w < Math.min(W, tw.from + holeWeeks); w++) holeIdx.push(w);
  const slotEligible = instances.map((inst) => [...new Set(snapshot.settings.lineup.filter((d) => d.slot === inst.slot).flatMap((d) => d.eligible))]);

  const values: Record<string, number> = {};
  for (const [id, pm] of Object.entries(lp.players)) if (pm.value) values[id] = pm.value.value;

  const I: TradeInternals = {
    snapshot,
    inputs,
    now: opts.now,
    league,
    model,
    bases,
    settings,
    W,
    S,
    weights: tw.weights,
    from: tw.from,
    inProgress,
    regIdx,
    poIdx,
    holeIdx,
    regWeeks,
    poWeeks,
    teams: [],
    byId: new Map(),
    me: null,
    blocked: false,
    instances,
    slotEligible,
    values,
    credit: league.market.waiverCredit,
    premiums: new Map(),
    future: null,
    profiles: new Map(),
    hot: new Set(),
    urg: 0,
    medians: { ev: new Float64Array(instances.length), exact: new Float64Array(instances.length) },
    ranks: new Map(),
    riskyWeeks: [],
    sim: null,
    faByGain: league.freeAgentIds
      .flatMap((id) => {
        const row = league.table.rows.get(id);
        return row ? [{ row, mask: league.maskOf(row), max: rosValue(row.ev, tw.weights) }] : [];
      })
      .sort((a, b) => b.max - a.max || byId(a.row.id, b.row.id)),
    faByRos: league.freeAgentIds
      .flatMap((id) => league.table.rows.get(id) ?? [])
      .sort((a, b) => (lp.players[b.id]?.ros.total ?? 0) - (lp.players[a.id]?.ros.total ?? 0) || byId(a.id, b.id)),
    countMemo: new WeakMap(),
    sideMemo: new Map(),
    othersPool: new Map(),
    irOn: league.irReturners,
    irOwner: new Map(league.irReturners ? league.work.flatMap((t) => t.ir.map((id): [string, string] => [id, t.team.id])) : []),
    irEligible: irEligibleStatuses(snapshot.settings),
    notes: [],
    warnings: [...model.warnings],
    timings,
  };

  // The baseline: every team at V*(T), in the exact mode and in EV lineups.
  const claimRanks = new Map((league.allocation?.order ?? []).map((ti, k) => [ti, k]));
  I.teams = league.work.map((t: TeamWork, ti) => {
    const state: TeamState = {
      index: ti,
      id: t.team.id,
      team: t.team,
      stream: t.stream,
      roster: t.ids,
      ir: t.ir,
      vstar: t.vstar,
      claimed: t.claimed,
      pool: t.pool,
      claimRank: league.allocation ? (claimRanks.get(ti) ?? null) : null,
      base: null as unknown as SideEval,
      baseEv: { lv: t.vstar.solved.lv, ros: t.vstar.evRos, hole: avgOver(evInstancePoints(t.vstar.solved, index), holeIdx, instances.length) },
    };
    state.base = sideEval(I, state, t.vstar);
    return state;
  });
  for (const t of I.teams) I.byId.set(t.id, t);
  const myIndex = snapshot.myTeamId === null ? -1 : I.teams.findIndex((t) => t.id === snapshot.myTeamId);
  I.me = myIndex >= 0 ? (I.teams[myIndex] as TeamState) : null;
  for (let i = 0; i < instances.length; i++) {
    I.medians.ev[i] = median(I.teams.map((t) => t.baseEv.hole[i] as number)) ?? 0;
    I.medians.exact[i] = median(I.teams.map((t) => t.base.hole[i] as number)) ?? 0;
  }
  for (const t of I.teams) {
    const ranks = new Int32Array(instances.length);
    for (let i = 0; i < instances.length; i++) {
      const x = t.base.regular[i] as number;
      ranks[i] = 1 + I.teams.filter((u) => (u.base.regular[i] as number) > x + EPS).length;
    }
    I.ranks.set(t.id, ranks);
  }
  mark("baseline lineups");

  // Long-term values (dynasty and keeper leagues whose dynasty values loaded).
  const market = inputs.market ?? null;
  if (market && futureValuesLoaded(snapshot.settings.leagueType, market)) {
    const modelIds = Object.keys(lp.players);
    const valuePlayers = modelIds.map((id) => ({ id, pos: (lp.contexts.get(id) as { info: PlayerInfo }).info.pos }));
    const rosPoints: Record<string, number> = {};
    for (const id of modelIds) rosPoints[id] = (lp.players[id]?.weekly ?? []).slice(tw.from).reduce((s, w) => s + w.p, 0);
    const fv = marketValues(valuePlayers, rosPoints, market, config.market, "future");
    const fValues: Record<string, number> = {};
    for (const [id, v] of Object.entries(fv)) fValues[id] = v.value;
    const top = valuesForTerm(market, "future").topValue;
    const myIds = I.me ? [...I.me.team.roster, ...I.me.team.ir, ...I.me.team.taxi] : [];
    I.future = { values: fValues, credit: waiverCredit(fValues, league.freeAgentIds, top, config.market), top: Number.isFinite(top) && top > 0 ? top : 0, myTotal: rosterValue(myIds, fValues) };
  }

  // The season simulation: one setup, one matrix, the baseline at both counts.
  const seasonModel: SeasonModel = {
    weeks,
    regularWeeks: lp.weeks.regularWeeks,
    playoffWeeks: lp.weeks.playoffWeeks,
    inProgressWeek: tw.inProgressWeek,
    teams: I.teams.map((t) => ({ id: t.id, score: { mean: Array.from(t.base.score.mean), sd: Array.from(t.base.score.sd) } })),
  };
  let simWarning: string | null = null;
  if (W > 0) {
    simWarning = oddsSkippedWarning(snapshot, seasonModel);
    if (simWarning === null) {
      try {
        const setup = buildSimSetup(snapshot, seasonModel);
        if (setup) {
          const { screen: screenSims, final: finalSims } = simCounts();
          const Wk = setup.setup.weeks.length;
          const T = setup.setup.teams.length;
          // One matrix of screeningSims + finalSims seasons: the screening reads the first block, the final simulation
          // (and its baseline) the second, seasons the screening never saw (no selection bias in the shown B).
          const all = simNormals(simSeed, screenSims + finalSims, Wk, T);
          const per = Wk * T;
          const blocks: Record<SimStage, SimNormals> = {
            screen: { sims: screenSims, weeks: Wk, teams: T, z: all.z.subarray(0, screenSims * per) },
            final: { sims: finalSims, weeks: Wk, teams: T, z: all.z.subarray(screenSims * per, (screenSims + finalSims) * per) },
          };
          const odds = seasonOdds(snapshot, seasonModel, { sims: finalSims, seed: simSeed, normals: blocks.final });
          if (odds) {
            const sim: SimState = { built: setup, blocks, seed: simSeed, odds, base: { screen: { pPlayoffs: 0, pTitle: null, expWins: 0 }, final: { pPlayoffs: 0, pTitle: null, expWins: 0 } } };
            I.sim = sim;
            if (I.me) {
              sim.base.screen = runSim(I, null, null, "screen");
              sim.base.final = runSim(I, null, null, "final");
            }
          }
        }
      } catch (err) {
        if (!(err instanceof RangeError)) throw err;
        simWarning = ODDS_REFUSED_WARNING;
        I.sim = null;
      }
    }
  }
  if (simWarning) I.warnings.push(simWarning);
  for (const w of I.sim?.built.warnings ?? []) if (!I.warnings.includes(w)) I.warnings.push(w);
  mark("simulation");

  // Partner profiles, the star premium, hot players, urgency, risky weeks.
  const txWeek = transactionWeek(snapshot);
  for (const t of I.teams) {
    if (t === I.me) continue;
    const odds = I.sim?.odds.teams[t.index];
    I.profiles.set(t.id, partnerProfile({ teamId: t.id, transactions: snapshot.transactions ?? [], week: txWeek, values, W: I.credit, pPlayoffs: odds ? odds.pPlayoffs : null }));
  }
  // The same function as the League model's TeamModel.premiums, with P(playoffs) from this baseline (every team at V*).
  I.premiums = leaguePremiums({
    snapshot,
    market,
    value: (id) => values[id] ?? 0,
    ros: (id) => lp.players[id]?.ros.total ?? 0,
    pPlayoffs: (teamId) => {
      const t = I.byId.get(teamId);
      const odds = t ? I.sim?.odds.teams[t.index] : undefined;
      return odds ? odds.pPlayoffs : null;
    },
  });
  const active = new Set(I.teams.flatMap((t) => t.roster));
  I.hot = hotPlayers(inputs.players ?? {}, hotWeeks(snapshot.currentWeek), config.acceptance, active);
  I.urg = urgencyTerm(snapshot.settings.tradeDeadline, opts.now, txWeek);
  I.riskyWeeks = riskyWeeksOf(I);
  mark("profiles");

  // Notes: what stops the search (the Analyzer still evaluates, except without a team).
  if (!I.me) I.notes.push(NO_TEAM_NOTE);
  else {
    if (W === 0) I.notes.push(NO_WEEKS_NOTE);
    else if (!I.sim) I.notes.push(NO_ODDS_NOTE);
    const mine = I.sim?.odds.teams[I.me.index];
    if (snapshot.settings.leagueType === "redraft" && mine?.eliminated) I.notes.push(SEASON_OVER_NOTE);
    if (tradeDeadlinePassed(snapshot.settings.tradeDeadline, opts.now, txWeek)) I.notes.push(DEADLINE_PASSED_NOTE);
  }
  I.blocked = I.notes.length > 0;
  if (clock) timings.total = last - start;

  const ctx: TradeContext = {
    myTeamId: I.me?.id ?? null,
    partnerIds: I.teams.filter((t) => t !== I.me).map((t) => t.id),
    notes: [...I.notes],
    warnings: [...I.warnings],
    timings,
  };
  internalsOf.set(ctx, I);
  return ctx;
}

/**
 * My remaining regular-season games the League page would flag as risky before the trade (TradeDetail.riskyWeeks;
 * leagueView's scheduleView rules), by each game's first week, when that week is one team numbers count: a game I'm
 * under riskyWinChance to win (judged on the printed whole percent; head-to-head leagues), or riskyByes or more of my
 * likely starters on bye in a game that counts for me (an opponent or a median game). The byes are counted over the
 * matchup's weeks that count (review of track E, item 6: an ESPN matchup spanning two weeks has its bye crunch in either),
 * each starter once. Likely starter: in my V* EV lineup (its final pricing: returners in, the roster spot one needs from
 * his week, SideEval.ev) in at least half of the counted weeks he plays. A starter's bye counts only in a week his row can
 * score for me (review of track E): a returner's from his expected return week on, a displaced player's before the week
 * his displacement starts (a bye he'd sit on IR for, or after he's dropped, isn't my crunch). In a points-only league
 * every counted week counts on its own (byes only). Empty without odds.
 */
function riskyWeeksOf(I: TradeInternals): number[] {
  const me = I.me;
  const odds = I.sim?.odds;
  if (!me || !odds) return [];
  const solved = me.base.ev;
  const starters = solved.team.rows.flatMap((r, k) => (!isStreamId(r.id) && evStarter(solved, k, I.weights) ? [r.id] : []));
  const weekIndex = new Map(I.league.lp.weeks.weeks.map((w, i) => [w, i]));
  const counted = new Set(I.regWeeks);
  // The week indexes a starter is on my active roster: a returner from his return, a displaced player before his drop.
  const back = new Map(returnersOf(me.stream).map((r) => [r.id, I.league.returnerSetup.returnIndex(r.id) ?? Number.POSITIVE_INFINITY]));
  const gone = new Map(me.base.displaced.map((d) => [d.id, d.from]));
  const withMe = (id: string, w: number): boolean => w >= (back.get(id) ?? 0) && w < (gone.get(id) ?? Number.POSITIVE_INFINITY);
  const onBye = (weeks: readonly number[]): number =>
    starters.filter((id) =>
      weeks.some((week) => {
        const w = weekIndex.get(week);
        return w !== undefined && withMe(id, w) && I.league.lp.players[id]?.weekly[w]?.bye === true;
      }),
    ).length;
  const byes = config.leaguePage.riskyByes;
  if (I.snapshot.settings.pointsOnly) return I.regWeeks.filter((week) => onBye([week]) >= byes);
  const limit = Math.round(config.leaguePage.riskyWinChance * 100);
  const out: number[] = [];
  for (const wk of odds.weekly) {
    if (!counted.has(wk.week)) continue;
    const game = wk.games.find((g) => g.teamId === me.id);
    if (!game) continue;
    const winPct = game.pWin !== null && Number.isFinite(game.pWin) ? Math.round(game.pWin * 100) : null;
    const low = winPct !== null && winPct < limit;
    const counts = game.opponentId !== null || game.pMedianWin !== null;
    const weeks = matchupWeeksOf(I.snapshot, me.id, game.opponentId, wk.week).filter((w) => counted.has(w));
    if (low || (counts && onBye(weeks.length ? weeks : [wk.week]) >= byes)) out.push(wk.week);
  }
  return out;
}

/** The NFL weeks of my regular-season matchup listed under `week` (Matchup.weeks for a multi-week one; leagueView's matchupWeeks), [week] when not found. */
function matchupWeeksOf(snapshot: LeagueSnapshot, me: string, opponentId: string | null, week: number): number[] {
  for (const m of snapshot.schedule) {
    if (m.isPlayoff) continue;
    const pair = (m.teamA === me && m.teamB === opponentId) || (opponentId !== null && m.teamA === opponentId && m.teamB === me);
    if (!pair) continue;
    const weeks = m.weeks?.length ? [...m.weeks].sort((a, b) => a - b) : [m.week];
    if (weeks.includes(week)) return weeks;
  }
  return [week];
}

// ---------------------------------------------------------------------------------------------
// Side evaluations (exact mode) and EV solves (screening)

/**
 * A team's roster priced in the exact mode (SideEval), from an optimizer run's roster made with `spec` (the team's
 * streaming rows and the returners of its IR after the trade; default its own, TeamState.stream): scenario lineups with
 * S > 0 (the law-of-total-variance score, instance points), else its EV lineups; finally priced (returners.finalLineups:
 * from a returner's week, the roster spot he needs, when it's full: the file header, "IR players"). Memoized by team,
 * roster and spec, so a roster the trade leaves as it was gives the very same numbers (the no-op test). The week in
 * progress keeps TeamModel.score's week-0 value (the file header).
 */
export function sideEval(I: TradeInternals, t: Pick<TeamState, "index" | "stream">, run: OptimizedRoster, spec: StreamSpec = t.stream): SideEval {
  const key = `${t.index}\u0004${rosterKey(run.roster, spec)}`;
  const hit = I.sideMemo.get(key);
  if (hit) return hit;
  const { W, S, league } = I;
  // The roster's lineups before any displacement: the optimizer's own scenario lineups when it judged in them (V* passed
  // through it), else solved here with their cells kept (the displacement prices from them).
  const raw = S > 0 ? (league.optimizer.scenarioValuesOf(run.roster, spec) ?? scenarioValues(run.team, W, S, league.index, true, true)) : null;
  const final = finalLineups(league.returnerSetup, run.roster, spec, { ev: run.solved, scen: raw });
  let lv: Float64Array;
  let score: WeeklyScore;
  let perWeek: Float64Array[];
  if (final.scen) {
    const v = final.scen;
    lv = v.mean;
    score = scenarioScore(v);
    perWeek = v.instances as Float64Array[];
  } else {
    lv = final.ev.lv;
    score = evScore(final.ev);
    perWeek = evInstancePoints(final.ev, league.index);
  }
  if (I.inProgress && W > 0) {
    const pre = I.model.teams[t.index]?.score;
    if (pre) {
      score.mean[0] = pre.mean[0] as number;
      score.sd[0] = pre.sd[0] as number;
    }
  }
  const out: SideEval = {
    roster: run.roster,
    displaced: final.displaced,
    lv,
    score,
    regular: avgOver(perWeek, I.regIdx, I.instances.length),
    hole: avgOver(perWeek, I.holeIdx, I.instances.length),
    ev: final.ev,
  };
  I.sideMemo.set(key, out);
  return out;
}

/** EV lineups of a roster with the team's streaming rows and returners (after its players, as the optimizer orders them). */
function evSolve(I: TradeInternals, roster: readonly string[], stream: StreamSpec): SolvedWeeks {
  const rows: TableRow[] = [];
  for (const id of roster) {
    const row = I.league.table.rows.get(id);
    if (row) rows.push(row);
  }
  return solveEvWeeks(teamEval([...rows, ...stream.rows, ...returnersOf(stream)], I.league.slots), I.W);
}

/** Scenario lineups of a roster kept cell by cell (keep values in the exact mode), with the streaming rows and returners. */
function scenarioCells(I: TradeInternals, roster: readonly string[], stream: StreamSpec): ScenarioCells {
  const rows: TableRow[] = [];
  for (const id of roster) {
    const row = I.league.table.rows.get(id);
    if (row) rows.push(row);
  }
  return scenarioValues(teamEval([...rows, ...stream.rows, ...returnersOf(stream)], I.league.slots), I.W, I.S, null, true).cells as ScenarioCells;
}

// ---------------------------------------------------------------------------------------------
// Roster legality (the file header; M2)

export type LineupMode = "ev" | "exact";

export interface LegalSide {
  /** The active roster after the trade and the roster rules. */
  roster: string[];
  change: RosterChange;
  /** The final roster's EV ROS (EV mode, need "ros" or "look"), else null. */
  ros: number | null;
  /** The final roster's EV look (need "look"), else null. */
  look: EvLook | null;
  /** The side's IR after the trade (rule 5: given IR players leave it, received ones fill its open IR slots when eligible). */
  ir: string[];
  /** The side's streaming rows with the returners of that IR (league.ts withReturners): every later solve of the side uses it. */
  spec: StreamSpec;
  /** Rule 5's moves: the IR players it gives (leaving its IR) and the received ones going into its IR slots (returners.irAfterTrade). */
  givenIR: readonly string[];
  toIR: readonly string[];
}

/**
 * A side's moves on and off its active roster (returners.activeSpots: what §9's open-spot credit counts, market.ts's
 * header): `given` and `received` from the side's point of view, less the IR players legality's rule 5 placed.
 */
function spotsOf(side: Pick<LegalSide, "givenIR" | "toIR">, given: readonly string[], received: readonly string[]): ActiveSpots {
  return activeSpots(given, received, side);
}

const POS_INDEX: ReadonlyMap<Pos, number> = new Map(POSITIONS.map((p, i) => [p, i]));

/** Players per position (POSITIONS order) on a roster, players without a known position left out; memoized per array. */
function positionCounts(I: TradeInternals, roster: readonly string[]): Int32Array {
  let out = I.countMemo.get(roster);
  if (!out) {
    out = new Int32Array(POSITIONS.length);
    for (const id of roster) {
      const i = POS_INDEX.get(I.league.posOf(id) as Pos);
      if (i !== undefined) out[i] = (out[i] as number) + 1;
    }
    I.countMemo.set(roster, out);
  }
  return out;
}

/**
 * Whether no roster rule can apply to `before` − given + received (rules 1–4): no position above its cap, the roster
 * not above its size cap, no position below its minimum target, no spot opened. Then legality makes no move.
 */
function legalityQuiet(I: TradeInternals, before: readonly string[], given: readonly string[], received: readonly string[]): boolean {
  // Only given players on `before` leave it (screening's V*(T) may have dropped one already).
  const leaving = given.length === 0 ? given : given.filter((id) => before.includes(id));
  if (received.length < leaving.length) return false; // rule 4: a spot opened
  const maxSize = I.league.maxRosterSize;
  if (received.length > leaving.length && Number.isFinite(maxSize) && maxSize > 0 && before.length - leaving.length + received.length > Math.max(maxSize, before.length)) return false;
  const limits = I.league.limits;
  const minimums = I.snapshot.settings.rosterMinimums;
  if (!limits && !minimums) return true;
  const base = positionCounts(I, before);
  const counts = Int32Array.from(base);
  for (const id of leaving) {
    const i = POS_INDEX.get(I.league.posOf(id) as Pos);
    if (i !== undefined) counts[i] = (counts[i] as number) - 1;
  }
  for (const id of received) {
    const i = POS_INDEX.get(I.league.posOf(id) as Pos);
    if (i !== undefined) counts[i] = (counts[i] as number) + 1;
  }
  for (let i = 0; i < POSITIONS.length; i++) {
    const pos = POSITIONS[i] as Pos;
    const limit = limits?.[pos];
    if (limit !== undefined && Number.isFinite(limit) && (counts[i] as number) > Math.max(limit, base[i] as number)) return false;
    const min = minimums?.[pos];
    if (min !== undefined && Number.isFinite(min) && (counts[i] as number) < Math.min(min, base[i] as number)) return false;
  }
  return true;
}

/**
 * Keep values of a roster's players (the file header): removal cost in the mode, plus the dynasty part, for the active
 * roster's players only (never a streaming row or a returner: neither is ever dropped). `raw` holds the EV removal costs
 * (ROS points) in EV mode, so legality can track the roster's EV ROS after a drop.
 */
function keepValues(I: TradeInternals, roster: readonly string[], stream: StreamSpec, mode: LineupMode, solvedEv: SolvedWeeks | null): { keep: Map<string, number>; raw: Map<string, number> | null } {
  const costs = new Map<string, number>();
  let raw: Map<string, number> | null = null;
  const onRoster = new Set(roster);
  if (mode === "exact" && I.S > 0) {
    const cells = scenarioCells(I, roster, stream);
    const c = scenarioRemovalCosts(cells, I.weights);
    cells.team.rows.forEach((r, k) => {
      if (onRoster.has(r.id)) costs.set(r.id, c[k] as number);
    });
  } else {
    const solved = solvedEv ?? evSolve(I, roster, stream);
    const c = evRemovalCosts(solved, I.weights);
    solved.team.rows.forEach((r, k) => {
      if (onRoster.has(r.id)) costs.set(r.id, c[k] as number);
    });
    raw = costs;
  }
  const f = I.future;
  if (!f || I.snapshot.settings.leagueType === "redraft") return { keep: costs, raw };
  let max = 0;
  for (const v of costs.values()) if (v > max) max = v;
  const keep = new Map<string, number>();
  for (const [id, cost] of costs) keep.set(id, (max > EPS ? cost / max : 0) + (f.top > 0 ? (f.values[id] ?? 0) / f.top : 0));
  return { keep, raw };
}

/**
 * The candidates in drop order: the lowest keep value first, ties as teamValue.lowestKeepValue (the lower perception
 * value, then the smaller id). Candidates without a keep value (no model) aren't dropped. Lazily, one at a time: the
 * first is usually the one dropped.
 */
function* dropOrder(I: TradeInternals, keep: ReadonlyMap<string, number>, candidates: readonly string[]): Generator<string, void, void> {
  const list = candidates.flatMap((id) => (keep.has(id) ? [{ id, keep: keep.get(id) as number, value: I.values[id] ?? 0 }] : []));
  while (list.length) {
    const id = lowestKeepValue(list) as string;
    yield id;
    list.splice(
      list.findIndex((c) => c.id === id),
      1,
    );
  }
}

/**
 * Which free agents a legality add may take: not on the roster or added, not in `pool` (free agents other teams claimed:
 * the file header, "One free agent, one team"), within position limits, and either at `pos` (rule 3) or not at an
 * `excluded` position (rule 4); at a `refillOnly` position (rule 4: K and D/ST), only one `refills` accepts (he fills a
 * starting slot the trade emptied).
 */
interface AddFilter {
  on: ReadonlySet<string>;
  counts: Int32Array;
  pool: ReadonlySet<string>;
  pos?: Pos;
  excluded?: ReadonlySet<Pos>;
  refillOnly?: ReadonlySet<Pos>;
  refills?: (row: TableRow) => boolean;
}

function addAllowed(I: TradeInternals, f: AddFilter, row: TableRow): boolean {
  if (f.pos !== undefined ? row.pos !== f.pos : f.excluded?.has(row.pos) === true) return false;
  if (f.on.has(row.id) || f.pool.has(row.id) || !limitAllows(I, f.counts, row.pos)) return false;
  return f.refillOnly?.has(row.pos) !== true || f.refills?.(row) === true;
}

/**
 * The free agent a roster adds (rules 3 and 4) and his exact EV ROS gain: the largest gain among the allowed ones; ties
 * within 1e-9 go to the higher ROS points, then the smaller id, and when none gains anything, the allowed one with the
 * most ROS points (then the smaller id), gain 0. Exact, solving as few as it can (the bounds are tight without starter
 * limits, so usually one): a free agent gains at most his add bound (teamValue's floors: per week, his points above the
 * lowest starter he could displace), which is at most Σ ω × his points (FaPick.max). Free agents are scanned by that
 * most first, each allowed one's bound computed, while it could still reach the largest bound found; then they're solved
 * in bound order (ties: the smaller id), the scan resuming whenever someone not scanned yet could still beat the best
 * gain, until no bound can reach it. Under starter limits nothing is bounded and every allowed one is solved.
 */
function pickAdd(I: TradeInternals, solved: SolvedWeeks, filter: AddFilter): { row: TableRow; mask: number; gain: number } | null {
  const rosOf = (id: string) => I.league.lp.players[id]?.ros.total ?? 0;
  const { W, weights } = I;
  const fas = I.faByGain;
  const floors = new Map<number, Float64Array | null>();
  const list: { row: TableRow; mask: number; ub: number; done: boolean }[] = [];
  let i = 0;
  let maxUb = 0;
  /** Scans the next free agent: his bound when he's allowed and could gain anything. */
  const scanOne = () => {
    const c = fas[i++] as FaPick;
    if (c.mask === 0 || !addAllowed(I, filter, c.row)) return;
    let f = floors.get(c.mask);
    if (f === undefined) {
      f = addFloors(solved, c.mask);
      floors.set(c.mask, f);
    }
    let ub = Number.POSITIVE_INFINITY;
    if (f) {
      ub = 0;
      const ev = c.row.ev;
      for (let w = 0; w < W; w++) {
        const wt = weights[w] as number;
        const x = (ev[w] as number) - (f[w] as number);
        if (wt > 0 && x > 0) ub += wt * x;
      }
    }
    if (!(ub > EPS)) return;
    list.push({ row: c.row, mask: c.mask, ub, done: false });
    if (ub > maxUb) maxUb = ub;
  };
  const more = (bar: number) => i < fas.length && ((fas[i] as FaPick).max > EPS) && (fas[i] as FaPick).max >= bar - EPS;
  while (more(maxUb)) scanOne();
  let best: { row: TableRow; mask: number; gain: number } | null = null;
  for (;;) {
    let next: (typeof list)[number] | null = null;
    for (const x of list) if (!x.done && (!next || x.ub > next.ub || (x.ub === next.ub && x.row.id < next.row.id))) next = x;
    const bar = best ? best.gain : 0;
    if (!next || (best && next.ub < bar - EPS)) {
      if (more(Math.max(bar, EPS))) {
        scanOne();
        continue;
      }
      break;
    }
    next.done = true;
    const gain = addGainExact(solved, next.row, next.mask, weights).gain;
    if (!(gain > EPS)) continue;
    const b: { row: TableRow; gain: number } | null = best;
    if (!b || gain > b.gain + EPS || (Math.abs(gain - b.gain) <= EPS && (rosOf(next.row.id) > rosOf(b.row.id) || (rosOf(next.row.id) === rosOf(b.row.id) && next.row.id < b.row.id)))) best = { row: next.row, mask: next.mask, gain };
  }
  if (best) return best;
  for (const row of I.faByRos) if (addAllowed(I, filter, row)) return { row, mask: I.league.maskOf(row), gain: 0 };
  return null;
}

/** Whether a roster with these position counts (POSITIONS order) can add a player at `pos` (position limits). */
function limitAllows(I: TradeInternals, counts: Int32Array, pos: Pos): boolean {
  const limit = I.league.limits?.[pos];
  if (limit === undefined || !Number.isFinite(limit)) return true;
  const i = POS_INDEX.get(pos);
  return i === undefined || (counts[i] as number) < limit;
}

/** Position counts (POSITIONS order) of a roster, not memoized (legality's adds). */
function countsOf(I: TradeInternals, roster: readonly string[]): Int32Array {
  const out = new Int32Array(POSITIONS.length);
  for (const id of roster) {
    const i = POS_INDEX.get(I.league.posOf(id) as Pos);
    if (i !== undefined) out[i] = (out[i] as number) + 1;
  }
  return out;
}

/**
 * The look (EvLook) of a solved roster plus one player, exactly, re-solving only the weeks where he could change the
 * lineup (teamValue.addUpperBoundWeeks above 0; every week under starter limits): elsewhere the old lineup stays the
 * best one, with him on the bench.
 */
function addLook(I: TradeInternals, base: SolvedWeeks, row: TableRow, mask: number): EvLook {
  const rows = [...base.team.rows, row];
  const prep = prepareRoster(rows, I.league.slots);
  const n = rows.length;
  const ubw = addUpperBoundWeeks(base, row, mask);
  const lv = new Float64Array(I.W);
  const pts = new Float64Array(n);
  const lo = I.holeIdx.length ? (I.holeIdx[0] as number) : -1;
  const hi = I.holeIdx.length ? (I.holeIdx[I.holeIdx.length - 1] as number) : -2;
  const seats: Int32Array[] = [];
  const holePts: Float64Array[] = [];
  for (let w = 0; w < I.W; w++) {
    const hole = w >= lo && w <= hi;
    if (ubw && !((ubw[w] as number) > 0)) {
      lv[w] = base.lv[w] as number;
      if (hole) {
        const seat = new Int32Array(n);
        seat.set(base.seat[w] as Int32Array);
        seat[n - 1] = -1;
        const p = new Float64Array(n);
        p.set(base.pts[w] as Float64Array);
        p[n - 1] = row.ev[w] as number;
        seats.push(seat);
        holePts.push(p);
      }
      continue;
    }
    for (let k = 0; k < n; k++) pts[k] = (rows[k] as TableRow).ev[w] as number;
    if (hole) {
      const seat = new Int32Array(n);
      lv[w] = lineupTotal(prep, pts, null, seat);
      seats.push(seat);
      holePts.push(Float64Array.from(pts));
    } else {
      lv[w] = lineupTotal(prep, pts);
    }
  }
  return { rows, lv, seats, pts: holePts };
}

/**
 * `before` − given + received, in roster order: each received player takes the place of a given one (the first
 * received the first given player's place on the roster, and so on; teamValue.applyStep's convention), extra received
 * players go at the end. The order changes no lineup value; it keeps two rosters that differ only in who fills a spot
 * in the same order (the free-agent pickup a trade reproduces, the Checkpoint 4 consistency test).
 */
export function tradeRoster(before: readonly string[], given: readonly string[], received: readonly string[]): string[] {
  const gone = new Set(given);
  const incoming = received.filter((id) => !before.includes(id));
  const out: string[] = [];
  let r = 0;
  for (const id of before) {
    if (!gone.has(id)) out.push(id);
    else if (r < incoming.length) out.push(incoming[r++] as string);
  }
  for (; r < incoming.length; r++) out.push(incoming[r] as string);
  return out;
}

/** What legality's caller needs besides the roster (EV mode): its EV ROS, or its look (LV per week and the hole weeks). */
export type LegalNeed = "none" | "ros" | "look";

/**
 * Rule 5 (the file header): a side's IR after a trade (returners.irAfterTrade: given IR players leave it; players received
 * from the other side's IR fill its open IR slots when the slot takes their status, the most ROS points first) and its
 * spec with that IR's returners. The side's own IR and spec (TeamState.stream, the same object) when the trade moves no IR
 * player of it, and always under irReturners false (no IR player is tradable then).
 */
function irMoves(I: TradeInternals, side: TeamState, given: readonly string[], received: readonly string[]): { givenIR: readonly string[]; toIR: readonly string[]; ir: readonly string[]; spec: StreamSpec } {
  const none = { givenIR: [], toIR: [], ir: side.ir, spec: side.stream };
  if (!I.irOn) return none;
  const after = irAfterTrade({
    ir: side.ir,
    irSlots: I.snapshot.settings.irSlots,
    given,
    received,
    fromIR: (id) => I.irOwner.has(id) && I.irOwner.get(id) !== side.id,
    eligible: (id) => I.irEligible.has(I.snapshot.players[id]?.injury ?? "ACTIVE"),
    ros: (id) => I.league.lp.players[id]?.ros.total ?? 0,
  });
  if (!after.givenIR.length && !after.toIR.length) return none;
  return { ...after, spec: I.league.withReturners(side.stream, after.ir) };
}

/**
 * Roster legality after a trade for one side (the file header, rules 1–5): `before` is the active roster the trade applies
 * to (the team's roster in exact evaluation, V*(T) in screening), `given` and `received` its sides (IR players included:
 * rule 5 sends them to or from the side's IR first; the rest are active-roster moves). `who` words the illegal reasons
 * ("You", or the team's name). Rules 3 and 4 add only free agents `pool` doesn't exclude (the file header, "One free
 * agent, one team": the free agents other teams claimed; default FULL_POOL). Every lineup solved here holds the side's
 * returners after the trade (LegalSide.spec), never a displacement (legality isn't a final evaluation). In EV mode it also
 * prices the final roster as `need` asks, solving as little as it can: dropping a player who starts in no week leaves the
 * best lineups as they were (removing a bench player never changes an optimal lineup), dropping a starter lowers EV ROS by
 * exactly his removal cost (nobody refilling his spot), and an added free agent raises it by exactly his gain (pickAdd),
 * his lineups re-solved only in the weeks he could change (addLook).
 */
export function legalSide(
  I: TradeInternals,
  side: TeamState,
  before: readonly string[],
  given: readonly string[],
  received: readonly string[],
  mode: LineupMode,
  who: string,
  need: LegalNeed = mode === "ev" ? "look" : "none",
  pool: PoolRestriction = FULL_POOL,
): LegalSide | { illegal: string } {
  // Rule 5: IR players move first; what's left are the active roster's moves.
  const irMove = irMoves(I, side, given, received);
  const ir = [...irMove.ir];
  const spec = irMove.spec;
  const placed = { ir, spec, givenIR: irMove.givenIR, toIR: irMove.toIR };
  const givenActive = irMove.givenIR.length ? given.filter((id) => !irMove.givenIR.includes(id)) : given;
  const receivedActive = irMove.toIR.length ? received.filter((id) => !irMove.toIR.includes(id)) : received;
  const inbound = new Set(receivedActive);
  const roster = tradeRoster(before, givenActive, receivedActive);
  const drops: string[] = [];
  const adds: string[] = [];
  // `before`'s EV lineups when the context has them: V*(T)'s (screening) or the team's as it stands (exact evaluation).
  // Their rows hold the side's own returners: the solves from them take out the ones the trade takes away and bring in
  // the ones it brings (a returner's row is his own row, whichever lineup he joins).
  const base = before === side.vstar.roster ? side.vstar.solved : before === side.roster ? (I.league.work[side.index]?.solved ?? null) : null;
  const backBefore = new Set(returnersOf(side.stream).map((r) => r.id));
  const backAfter = new Set(returnersOf(spec).map((r) => r.id));
  const removedBase = [...givenActive, ...[...backBefore].filter((id) => !backAfter.has(id))];
  const addedBase = [...receivedActive, ...[...backAfter].filter((id) => !backBefore.has(id))];
  if (legalityQuiet(I, before, givenActive, receivedActive)) {
    if (need === "none") return { roster, change: { drops, adds }, ros: null, look: null, ...placed };
    // From a solved roster (V*(T) in screening), only the weeks the trade can change are solved again (swapLook).
    const look = base ? swapLook(I, base, removedBase, addedBase, need === "look") : quickLook(I, roster, spec, need === "look");
    return { roster, change: { drops, adds }, ros: rosValue(look.lv, I.weights), look: need === "look" ? look : null, ...placed };
  }
  /** The current roster's exact EV lineups (null: not solved since the last change). */
  let solved: SolvedWeeks | null = null;
  /**
   * The lineups solved before the drops since (`pending`; no add since): the next solve starts from them and solves again
   * only the weeks a dropped player started (swapSolve: the same rows in the same order, so the very same lineups as a
   * solve from `base`, where removing bench players never changes an optimal lineup).
   */
  let prev: SolvedWeeks | null = null;
  let pending: string[] = [];
  /** EV lineups still optimal for the current roster, with dropped bench players aboard (the final look only). */
  let reusable: SolvedWeeks | null = null;
  /** The current roster's look after a free agent was added (the final look only). */
  let look: EvLook | null = null;
  /** The current roster's EV ROS when known. */
  let ros: number | null = null;
  /** Players per position on the current roster (POSITIONS order), and on `before` (rules 1–3; countsOf's counting). */
  const counts = countsOf(I, roster);
  const beforeCounts = positionCounts(I, before);
  const countNow = (pos: Pos): number => {
    const i = POS_INDEX.get(pos);
    return i === undefined ? 0 : (counts[i] as number);
  };
  const countBefore = (pos: Pos): number => {
    const i = POS_INDEX.get(pos);
    return i === undefined ? 0 : (beforeCounts[i] as number);
  };
  const recount = (id: string, by: number) => {
    const i = POS_INDEX.get(I.league.posOf(id) as Pos);
    if (i !== undefined) counts[i] = (counts[i] as number) + by;
  };
  const ev = (): SolvedWeeks => {
    if (!solved) {
      if (prev && pending.length && !adds.length) solved = swapSolve(I, prev, pending, []);
      else solved = base ? swapSolve(I, base, [...removedBase, ...drops], [...addedBase, ...adds]) : evSolve(I, roster, spec);
      prev = null;
      pending = [];
      ros = rosValue(solved.lv, I.weights);
    }
    return solved;
  };
  const benched = (s: SolvedWeeks, id: string): boolean => {
    const k = s.team.rows.findIndex((r) => r.id === id);
    return k < 0 || s.seat.every((seat) => (seat[k] as number) < 0);
  };
  const drop = (id: string, raw: ReadonlyMap<string, number> | null) => {
    const s = solved ?? reusable;
    reusable = s && benched(s, id) ? s : null;
    const cost = raw?.get(id);
    ros = ros !== null && cost !== undefined && solved !== null ? ros - cost : null;
    if (solved) {
      prev = solved;
      pending = [id];
    } else if (prev) pending.push(id);
    roster.splice(roster.indexOf(id), 1);
    recount(id, -1);
    drops.push(id);
    solved = null;
    look = null;
  };
  const add = (pick: { row: TableRow; mask: number; gain: number }, base: SolvedWeeks) => {
    look = need === "look" ? addLook(I, base, pick.row, pick.mask) : null;
    ros = ros !== null ? ros + pick.gain : null;
    roster.push(pick.row.id);
    recount(pick.row.id, 1);
    adds.push(pick.row.id);
    solved = null;
    reusable = null;
    prev = null;
    pending = [];
  };
  const hasRow = (id: string) => I.league.table.rows.has(id);
  const limits = I.league.limits;
  const evMode = mode === "ev" || I.S === 0;

  // 1. Positions over their limit: drop the position's lowest keep value player not just received.
  if (limits) {
    for (const pos of POSITIONS) {
      const limit = limits[pos];
      if (limit === undefined || !Number.isFinite(limit)) continue;
      const cap = Math.max(limit, countBefore(pos));
      while (countNow(pos) > cap) {
        const cands = roster.filter((id) => !inbound.has(id) && hasRow(id) && I.league.posOf(id) === pos);
        const kv = cands.length ? keepValues(I, roster, spec, mode, evMode ? ev() : null) : null;
        const k = kv ? dropOrder(I, kv.keep, cands).next().value : undefined;
        if (k === undefined) return { illegal: `${who} can have at most ${posWords(pos, limit)}.` };
        drop(k, kv?.raw ?? null);
      }
    }
  }

  // 2. Over the roster size: drop the lowest keep value player, never one just received (or added by rule 3), one the
  // lineup needs, one a position's minimum needs (rule 3's target), or the last one at a position the side streams (the
  // file header). Run again after rule 3's adds.
  const maxSize = I.league.maxRosterSize;
  const minimums = I.snapshot.settings.rosterMinimums;
  const minTarget = (pos: Pos | undefined): number => {
    const min = pos === undefined ? undefined : minimums?.[pos];
    return min === undefined || !Number.isFinite(min) ? 0 : Math.min(min, countBefore(pos as Pos));
  };
  /** The positions the side streams: rule 2 keeps the last player it rosters at each (the file header). */
  const streamedHere = new Set<Pos>(spec.positions);
  /** A roster's structural lineup entries (optimizer.fillCount): its known players and the side's streaming rows (never its returners: they can't play now). */
  const entries = (ids: readonly string[]) => [
    ...ids.flatMap((id) => {
      const info = I.snapshot.players[id];
      return info ? [{ id, pos: info.pos, eligible: info.eligible }] : [];
    }),
    ...side.stream.rows.map((r) => ({ id: r.id, pos: r.pos, eligible: r.eligible })),
  ];
  const trim = (): string | null => {
    if (!(Number.isFinite(maxSize) && maxSize > 0)) return null;
    const cap = Math.max(maxSize, before.length);
    while (roster.length > cap) {
      const cands = roster.filter((id) => {
        if (inbound.has(id) || adds.includes(id) || !hasRow(id)) return false;
        const pos = I.league.posOf(id);
        if (pos !== undefined && streamedHere.has(pos) && countNow(pos) <= 1) return false; // the last one at a streamed position
        return !(minTarget(pos) > 0 && countNow(pos as Pos) <= minTarget(pos));
      });
      const kv = cands.length ? keepValues(I, roster, spec, mode, evMode ? ev() : null) : null;
      // In drop order, the first one the starting lineup doesn't need (optimizer.fillCount), checked lazily.
      let fill: number | null = null;
      let k: string | undefined;
      // Not needed when some week's EV lineup fills every slot without him and without a returner (then the roster without
      // him still can: the fill rule leaves returners out).
      const cur = evMode ? (solved as SolvedWeeks | null) : null;
      const backAt = cur && backAfter.size ? cur.team.rows.flatMap((r, x) => (backAfter.has(r.id) ? [x] : [])) : [];
      const sparedIn = (id: string): boolean => {
        if (!cur) return false;
        const at = cur.team.rows.findIndex((r) => r.id === id);
        if (at < 0) return false;
        for (let w = 0; w < cur.lv.length; w++) {
          const seat = cur.seat[w] as Int32Array;
          if ((cur.open[w] as number) === 0 && (seat[at] as number) < 0 && backAt.every((x) => (seat[x] as number) < 0)) return true;
        }
        return false;
      };
      for (const id of kv ? dropOrder(I, kv.keep, cands) : []) {
        if (sparedIn(id)) {
          k = id;
          break;
        }
        fill ??= fillCount(entries(roster), I.league.slots);
        if (fillCount(entries(roster.filter((x) => x !== id)), I.league.slots) >= fill) {
          k = id;
          break;
        }
      }
      if (k === undefined) return `${who} would have more than ${maxSize} players on the active roster, and nobody can be dropped without leaving a starting spot empty.`;
      drop(k, kv?.raw ?? null);
    }
    return null;
  };
  const tooBig = trim();
  if (tooBig) return { illegal: tooBig };

  // 3. Positions under their minimum (only as far as the trade caused it): add the best free agent there, then make
  // room by rule 2 when that leaves the roster too big (⚠️ ours: the add needs a roster spot like any other).
  const taken = () => new Set([...roster, ...adds]);
  if (minimums) {
    for (const pos of POSITIONS) {
      const min = minimums[pos];
      if (min === undefined || !Number.isFinite(min)) continue;
      const target = Math.min(min, countBefore(pos));
      while (countNow(pos) < target) {
        const base = ev();
        const pick = pickAdd(I, base, { on: taken(), counts, pool: pool.excluded, pos });
        if (!pick) return { illegal: `${who} must keep at least ${posWords(pos, min)}, and no free agent is available to fill the spot.` };
        add(pick, base);
      }
    }
    const still = adds.length ? trim() : null;
    if (still) return { illegal: still };
  }

  // 4. Roster spots the trade opened: the free agent who most improves the lineup (never at a position the team streams),
  // at a K or D/ST position (optimizerExcluded: V* never picks one up) only to refill a starting slot the trade emptied:
  // the structural fill is below `before`'s and he raises it (the file header, rule 4). Fill counts are computed lazily,
  // only for such a candidate.
  const excluded = new Set<Pos>(side.stream.positions);
  const refillOnly = new Set<Pos>(I.league.cfg.streaming.optimizerExcluded.filter((p) => !excluded.has(p)));
  let fillBefore: number | null = null;
  for (let open = before.length - roster.length; open > 0; open--) {
    const base = ev();
    let fillNow: number | null = null;
    const refills = (row: TableRow): boolean => {
      fillBefore ??= fillCount(entries(before), I.league.slots);
      fillNow ??= fillCount(entries(roster), I.league.slots);
      return fillNow < fillBefore && fillCount([...entries(roster), { id: row.id, pos: row.pos, eligible: row.eligible }], I.league.slots) > fillNow;
    };
    const pick = pickAdd(I, base, { on: taken(), counts, pool: pool.excluded, excluded, refillOnly, refills });
    if (!pick) break;
    add(pick, base);
  }
  const change = { drops, adds };
  if (need === "none") return { roster, change, ros: null, look: null, ...placed };
  if (need === "ros") return { roster, change, ros: ros ?? rosValue(ev().lv, I.weights), look: null, ...placed };
  const final = look ?? lookOf(I, solved ?? reusable ?? ev());
  return { roster, change, ros: ros ?? rosValue(final.lv, I.weights), look: final, ...placed };
}

// ---------------------------------------------------------------------------------------------
// Proposal checks (M2's illegal reasons before the roster rules)

function playerName(I: TradeInternals, id: string): string {
  return I.snapshot.players[id]?.name ?? "A player";
}

function teamName(I: TradeInternals, id: string): string {
  return I.snapshot.teams.find((t) => t.id === id)?.name ?? `Team ${id}`;
}

/** Why a proposal can't be evaluated before any roster rule (M2), or null. */
export function proposalProblem(I: TradeInternals, proposal: TradeProposal, maxPerSide: number): string | null {
  const me = I.me;
  if (!me) return NO_TEAM_NOTE;
  const partner = I.byId.get(proposal.partnerId);
  if (!partner || partner === me) return "Pick a team to trade with.";
  if ([...proposal.give, ...proposal.get].some((a) => a.kind !== "player")) return "Draft picks can't be part of a trade here yet: pick players only.";
  const give = playerIds(proposal.give);
  const get = playerIds(proposal.get);
  if (give.length + get.length === 0) return "Pick at least one player to trade.";
  if (give.length > maxPerSide || get.length > maxPerSide) return `A trade can have at most ${maxPerSide} ${maxPerSide === 1 ? "player" : "players"} a side here.`;
  const seen = new Set<string>();
  for (const id of [...give, ...get]) {
    if (seen.has(id)) return `${playerName(I, id)} is in the trade twice.`;
    seen.add(id);
  }
  // Active-roster players, and IR players too since Phase 4b (planner reply to Checkpoint 4, change 5; rule 5 places them);
  // taxi players still aren't tradable. Under irReturners false, Checkpoint 4's rule: active-roster players only.
  if (I.irOn) {
    for (const id of give) {
      if (me.roster.includes(id) || me.ir.includes(id)) continue;
      return me.team.taxi.includes(id) ? `${playerName(I, id)} is on your taxi squad: only active-roster and IR players can be traded here.` : `${playerName(I, id)} isn't on your active roster or IR.`;
    }
    for (const id of get) {
      if (partner.roster.includes(id) || partner.ir.includes(id)) continue;
      const name = teamName(I, partner.id);
      return partner.team.taxi.includes(id) ? `${playerName(I, id)} is on ${name}'s taxi squad: only active-roster and IR players can be traded here.` : `${playerName(I, id)} isn't on ${name}'s active roster or IR.`;
    }
    return null;
  }
  const reserve = (t: Team, id: string) => t.ir.includes(id) || t.taxi.includes(id);
  for (const id of give) {
    if (me.roster.includes(id)) continue;
    return reserve(me.team, id) ? `${playerName(I, id)} is on your IR or taxi squad: only active-roster players can be traded here.` : `${playerName(I, id)} isn't on your active roster.`;
  }
  for (const id of get) {
    if (partner.roster.includes(id)) continue;
    const name = teamName(I, partner.id);
    return reserve(partner.team, id) ? `${playerName(I, id)} is on ${name}'s IR or taxi squad: only active-roster players can be traded here.` : `${playerName(I, id)} isn't on ${name}'s active roster.`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Screening (M5)

export interface Screened {
  key: string;
  partnerId: string;
  give: string[];
  get: string[];
  /** myΔROS × quick P_accept. */
  objective: number;
  /** EV ROS(after) − EV ROS(V*(me)), lineup points. */
  myDelta: number;
  pQuick: number;
  gPartner: number;
}

/** The players P would receive (my side), as the context rule reads them. */
function receivedPlayers(I: TradeInternals, ids: readonly string[]): ReceivedPlayer[] {
  return ids.flatMap((id) => {
    const info = I.snapshot.players[id];
    return info ? [{ pos: info.pos, ...(info.age !== undefined ? { age: info.age } : {}) }] : [];
  });
}

/**
 * One roster's EV lineups as screening reads them: LV per week, and in the hole weeks (TradeInternals.holeIdx) the
 * seats and points (instance points, who starts). From a SolvedWeeks, or solved here without seats outside the hole
 * weeks (seats cost a canonical ordering per solve).
 */
interface EvLook {
  rows: readonly TableRow[];
  lv: Float64Array;
  /** Per hole week (holeIdx order): the seats and the points. */
  seats: Int32Array[];
  pts: Float64Array[];
}

function lookOf(I: TradeInternals, solved: SolvedWeeks): EvLook {
  return { rows: solved.team.rows, lv: solved.lv, seats: I.holeIdx.map((w) => solved.seat[w] as Int32Array), pts: I.holeIdx.map((w) => solved.pts[w] as Float64Array) };
}

/** EV lineups of a roster plus the team's streaming rows and returners (the optimizer's order), seats only in the hole weeks when `holes`. */
function quickLook(I: TradeInternals, roster: readonly string[], stream: StreamSpec, holes: boolean): EvLook {
  const rows: TableRow[] = [];
  for (const id of roster) {
    const row = I.league.table.rows.get(id);
    if (row) rows.push(row);
  }
  for (const r of stream.rows) rows.push(r);
  for (const r of returnersOf(stream)) rows.push(r);
  const prep = prepareRoster(rows, I.league.slots);
  const n = rows.length;
  const lv = new Float64Array(I.W);
  const pts = new Float64Array(n);
  const lo = holes && I.holeIdx.length ? (I.holeIdx[0] as number) : -1;
  const hi = holes && I.holeIdx.length ? (I.holeIdx[I.holeIdx.length - 1] as number) : -2;
  const seats: Int32Array[] = [];
  const holePts: Float64Array[] = [];
  for (let w = 0; w < I.W; w++) {
    for (let k = 0; k < n; k++) pts[k] = (rows[k] as TableRow).ev[w] as number;
    if (w >= lo && w <= hi) {
      const seat = new Int32Array(n);
      lv[w] = lineupTotal(prep, pts, null, seat);
      seats.push(seat);
      holePts.push(Float64Array.from(pts));
    } else {
      lv[w] = lineupTotal(prep, pts);
    }
  }
  return { rows, lv, seats, pts: holePts };
}

/**
 * The look of `base`'s roster minus `removed` plus `added`, exactly, solving only the weeks the trade can change: in a
 * week where every removed player sits on the bench and no added one's add bound on `base` is above 0
 * (teamValue.addUpperBoundWeeks), base's lineup stays the best one (removing bench players never changes an optimal
 * lineup, the bounds don't see bench players, and without starter limits newcomers who can't improve it alone can't
 * together either: their joint gain is at most the sum of their own). Under starter limits every week is solved. Rows:
 * base's players kept, the added players, then base's streaming rows.
 */
function swapLook(I: TradeInternals, base: SolvedWeeks, removed: readonly string[], added: readonly string[], holes: boolean): EvLook {
  const { rows, from, out, ubs } = swapRows(I, base, removed, added);
  const n = rows.length;
  const lv = new Float64Array(I.W);
  const pts = new Float64Array(n);
  const lo = holes && I.holeIdx.length ? (I.holeIdx[0] as number) : -1;
  const hi = holes && I.holeIdx.length ? (I.holeIdx[I.holeIdx.length - 1] as number) : -2;
  const seats: Int32Array[] = [];
  const holePts: Float64Array[] = [];
  let prep: ReturnType<typeof prepareRoster> | null = null;
  for (let w = 0; w < I.W; w++) {
    const hole = w >= lo && w <= hi;
    if (sameWeek(base, out, ubs, w)) {
      lv[w] = base.lv[w] as number;
      if (hole) {
        const seat = new Int32Array(n);
        const p = new Float64Array(n);
        const bs = base.seat[w] as Int32Array;
        for (let j = 0; j < n; j++) {
          const k = from[j] as number;
          seat[j] = k < 0 ? -1 : (bs[k] as number);
          p[j] = (rows[j] as TableRow).ev[w] as number;
        }
        seats.push(seat);
        holePts.push(p);
      }
      continue;
    }
    prep ??= prepareRoster(rows, I.league.slots);
    for (let k = 0; k < n; k++) pts[k] = (rows[k] as TableRow).ev[w] as number;
    if (hole) {
      const seat = new Int32Array(n);
      lv[w] = lineupTotal(prep, pts, null, seat);
      seats.push(seat);
      holePts.push(Float64Array.from(pts));
    } else {
      lv[w] = lineupTotal(prep, pts);
    }
  }
  return { rows, lv, seats, pts: holePts };
}

/**
 * swapLook's rows: base's players kept, the added players, base's streaming rows; base indexes (−1: added), removed
 * indexes, the added players' weekly add bounds (null under starter limits). Base's IR returners (rows after its streaming
 * rows) stay among the kept rows, before the added ones: the order changes no lineup value (lineup.ts seats and sums by
 * points, ties by id), and every reader finds rows by id.
 */
function swapRows(I: TradeInternals, base: SolvedWeeks, removed: readonly string[], added: readonly string[]): { rows: TableRow[]; from: number[]; out: number[]; ubs: Float64Array[] | null } {
  const baseRows = base.team.rows;
  const gone = new Set(removed);
  const kept: number[] = [];
  const out: number[] = [];
  const streamAt: number[] = [];
  baseRows.forEach((r, k) => {
    if (gone.has(r.id)) out.push(k);
    else if (isStreamId(r.id)) streamAt.push(k);
    else kept.push(k);
  });
  const addRows = added.flatMap((id) => I.league.table.rows.get(id) ?? []);
  const order = [...kept, -1, ...streamAt]; // −1 marks where the added rows go
  const rows: TableRow[] = [];
  /** New index → base index (−1 for an added row). */
  const from: number[] = [];
  for (const k of order) {
    if (k === -1) {
      for (const r of addRows) {
        rows.push(r);
        from.push(-1);
      }
    } else {
      rows.push(baseRows[k] as TableRow);
      from.push(k);
    }
  }
  const ubs = I.league.slots.limits !== null ? null : addRows.map((r) => addUpperBoundWeeks(base, r, I.league.maskOf(r)) as Float64Array);
  return { rows, from, out, ubs };
}

/** Whether week w keeps base's lineup (swapLook's rule): every removed player benched there, no added one's bound above 0. */
function sameWeek(base: SolvedWeeks, out: readonly number[], ubs: readonly Float64Array[] | null, w: number): boolean {
  if (ubs === null) return false;
  const seat = base.seat[w] as Int32Array;
  for (const k of out) if ((seat[k] as number) >= 0) return false;
  for (const ub of ubs) if ((ub[w] as number) > 0) return false;
  return true;
}

/**
 * swapLook's lineups in full (SolvedWeeks: every week's points and seats, the open slot groups), for legality's keep
 * values and free-agent picks: the weeks the trade can't change keep base's lineup (its seats, which stay an optimal
 * assignment), the others are solved.
 */
function swapSolve(I: TradeInternals, base: SolvedWeeks, removed: readonly string[], added: readonly string[]): SolvedWeeks {
  const { rows, from, out, ubs } = swapRows(I, base, removed, added);
  const n = rows.length;
  const W = I.W;
  const team = teamEval(rows, I.league.slots);
  const { groups } = team.prep.slots;
  const capacity = team.prep.slots.capacity;
  const lv = new Float64Array(W);
  const open = new Int32Array(W);
  const ptsAll = new Float64Array(W * n);
  const seatAll = new Int32Array(W * n);
  const pts: Float64Array[] = [];
  const seat: Int32Array[] = [];
  const fill = new Int32Array(groups.length);
  for (let w = 0; w < W; w++) {
    const p = ptsAll.subarray(w * n, (w + 1) * n);
    const st = seatAll.subarray(w * n, (w + 1) * n);
    for (let j = 0; j < n; j++) p[j] = (rows[j] as TableRow).ev[w] as number;
    if (sameWeek(base, out, ubs, w)) {
      lv[w] = base.lv[w] as number;
      const bs = base.seat[w] as Int32Array;
      for (let j = 0; j < n; j++) {
        const k = from[j] as number;
        st[j] = k < 0 ? -1 : (bs[k] as number);
      }
      open[w] = base.open[w] as number;
    } else {
      lv[w] = lineupTotal(team.prep, p, null, st);
      fill.fill(0);
      for (let j = 0; j < n; j++) {
        const g = st[j] as number;
        if (g >= 0) fill[g] = (fill[g] as number) + 1;
      }
      let free = 0;
      for (let g = 0; g < groups.length; g++) if ((fill[g] as number) < (capacity[g] as number)) free |= 1 << g;
      open[w] = free;
    }
    pts.push(p);
    seat.push(st);
  }
  return { team, lv, pts, seat, open, floors: new Map() };
}

/** Average instance points over the hole weeks of a look. */
function holeAverage(I: TradeInternals, look: EvLook): Float64Array {
  const size = I.instances.length;
  const out = new Float64Array(size);
  const buf = new Float64Array(size);
  const m = look.seats.length;
  if (!m) return out;
  for (let j = 0; j < m; j++) {
    instancePointsInto(I.league.index, look.seats[j] as Int32Array, look.pts[j] as Float64Array, null, look.rows.length, buf);
    for (let i = 0; i < size; i++) out[i] = (out[i] as number) + (buf[i] as number);
  }
  for (let i = 0; i < size; i++) out[i] = (out[i] as number) / m;
  return out;
}

/** The received players who start in at least one hole week (§11 h). */
function startersIn(I: TradeInternals, rows: readonly TableRow[], seats: readonly Int32Array[], received: readonly string[]): ReceivedStarter[] {
  const out: ReceivedStarter[] = [];
  for (const id of received) {
    const k = rows.findIndex((r) => r.id === id);
    if (k < 0 || !seats.some((seat) => (seat[k] as number) >= 0)) continue;
    const info = I.snapshot.players[id];
    out.push({ pos: info?.pos ?? (rows[k] as TableRow).pos, eligible: info?.eligible ?? (rows[k] as TableRow).eligible });
  }
  return out;
}

/** The received players who start in `solved`'s lineup in at least one hole week (§11 h). */
function receivedStarters(I: TradeInternals, solved: SolvedWeeks, received: readonly string[]): ReceivedStarter[] {
  return startersIn(
    I,
    solved.team.rows,
    I.holeIdx.map((w) => solved.seat[w] as Int32Array),
    received,
  );
}

function holeSlots(I: TradeInternals, before: Float64Array, after: Float64Array, medians: Float64Array): HoleSlot[] {
  return I.instances.map((inst, i) => ({ key: inst.key, eligible: I.slotEligible[i] ?? [], starter: before[i] as number, after: after[i] as number, median: medians[i] as number }));
}

/**
 * Screens one trade (M5; the file header): EV lineups, legality in EV mode from each side's V*(T), not re-optimized.
 * Null when a roster rule makes it illegal. Each side is priced as leanly as legality allows (legalSide): my side's EV
 * ROS alone, the partner's LV per week with seats in the hole weeks only.
 */
export function screenTrade(I: TradeInternals, partner: TeamState, give: readonly string[], get: readonly string[], key?: string): Screened | null {
  const me = I.me as TeamState;
  // Each side's legality adds skip the free agents the other teams claimed (its baseline exclusion excl(T): ⚠️ screening
  // is a filter, so the trade's own allocation order isn't followed here).
  const mine = legalSide(I, me, me.vstar.roster, give, get, "ev", "You", "ros", me.pool);
  if ("illegal" in mine) return null;
  const theirs = legalSide(I, partner, partner.vstar.roster, get, give, "ev", teamName(I, partner.id), "look", partner.pool);
  if ("illegal" in theirs) return null;
  const look = theirs.look as EvLook;
  const myDelta = (mine.ros as number) - me.baseEv.ros;
  // The partner's open-spot credit follows its own active roster (rule 5 placed the IR players: market.ts's header).
  const theirSpots = spotsOf(theirs, get, give);
  const gPartner = tradePackage({ players: give }, { players: get }, I.values, I.credit, config.market, theirSpots).g;
  const gPerceived = perceivedG(I, partner.id, give, get, gPartner, theirSpots);
  const delta = partnerLineupDelta(partner.baseEv.lv, look.lv, I.from);
  const h = holeFeature(holeSlots(I, partner.baseEv.hole, holeAverage(I, look), I.medians.ev), startersIn(I, look.rows, look.seats, give)).h;
  const profile = I.profiles.get(partner.id) as PartnerProfile;
  const pQuick = quickAcceptance({ leagueType: I.snapshot.settings.leagueType }, profile, {
    gPartner,
    gPerceived,
    deltaLineup: delta.blended,
    h,
    assets: give.length + get.length,
    partnerReceives: receivedPlayers(I, give),
  });
  return {
    key: key ?? proposalKey({ partnerId: partner.id, give: players(give), get: players(get) }),
    partnerId: partner.id,
    give: [...give],
    get: [...get],
    objective: myDelta * pQuick,
    myDelta,
    pQuick,
    gPartner,
  };
}

// ---------------------------------------------------------------------------------------------
// Exact evaluation (M3)

/**
 * X for a trade with `partner` (the file header, "One free agent, one team"): the free agents every team but me and the
 * partner claimed; FULL_POOL under faAllocation "independent". Memoized per partner.
 */
export function othersPool(I: TradeInternals, partner: TeamState): PoolRestriction {
  let pool = I.othersPool.get(partner.id);
  if (!pool) {
    const me = I.me;
    pool = I.league.allocation ? poolRestriction(I.teams.flatMap((t) => (t === me || t === partner ? [] : t.claimed))) : FULL_POOL;
    I.othersPool.set(partner.id, pool);
  }
  return pool;
}

/** Both sides of a trade after legality, and each one's free-agent-optimized roster V*(after) (tradeSides). */
export interface TradeSidesAfter {
  mineLegal: LegalSide;
  theirLegal: LegalSide;
  mine: OptimizedRoster;
  theirs: OptimizedRoster;
  /** The side that went first: the earlier of the two in the allocation order ("me" under faAllocation "independent"). */
  first: "me" | "partner";
  /**
   * The pool each side's legality adds and V*(after) drew from (the second one's excludes what the first one added and,
   * with a team between them in the order, the first one's baseline pickups).
   */
  pools: { mine: PoolRestriction; theirs: PoolRestriction };
  /** Each side's spec after the trade (LegalSide.spec: its streaming rows and the returners of its IR after the trade), which its V*(after) ran with. */
  specs: { mine: StreamSpec; theirs: StreamSpec };
}

/**
 * Both sides of a trade in the exact mode (the file header, "Exact evaluation" and "One free agent, one team"): the earlier
 * of me and the partner in the allocation order goes first, its legality adds (rules 3–4) and its V*(after) from the pool
 * minus X (othersPool); then the other one's, from the pool minus X minus every free agent the first one added here
 * (legality's adds and every add of its V*(after) run: league.claimedBy) and, ⚠️ when a team sits between the two in the
 * order, minus the first one's baseline pickups (TeamState.claimed) too: one it gives up after the trade would go to that
 * team first, which keeps its baseline, so nobody adds him; with no team between them the other one is next in line.
 * Without an allocation (faAllocation "independent"), mine first and both from the whole pool: Checkpoint 4's rule.
 * `{ illegal }` when a side's roster rules make it illegal (the first side's reason when both are).
 */
export function tradeSides(I: TradeInternals, me: TeamState, partner: TeamState, give: readonly string[], get: readonly string[], partnerName: string): TradeSidesAfter | { illegal: string } {
  const optimizer = I.league.optimizer;
  const allocated = I.league.allocation !== null;
  const partnerFirst = allocated && me.claimRank !== null && partner.claimRank !== null && partner.claimRank < me.claimRank;
  // Whether some team sits between the two in the allocation order (an unknown place counts as one: the cautious reading).
  const between = me.claimRank === null || partner.claimRank === null || Math.abs(me.claimRank - partner.claimRank) > 1;
  const sides = [
    { team: me, given: give, received: get, who: "You" },
    { team: partner, given: get, received: give, who: partnerName },
  ] as const;
  const legal: LegalSide[] = [];
  const runs: OptimizedRoster[] = [];
  const pools: PoolRestriction[] = [];
  let pool = othersPool(I, partner);
  for (const k of partnerFirst ? [1, 0] : [0, 1]) {
    const s = sides[k as 0 | 1];
    const l = legalSide(I, s.team, s.team.roster, s.given, s.received, "exact", s.who, "none", pool);
    if ("illegal" in l) return { illegal: l.illegal };
    // With the side's IR after the trade: a returner given away leaves its lineups, one received joins them.
    const run = optimizer.optimize(l.roster, l.spec, undefined, pool);
    legal[k] = l;
    runs[k] = run;
    pools[k] = pool;
    // The second side may not add what the first one added here, nor, ⚠️ with a team between them in the order, the first
    // one's baseline pickups, even one it no longer wants after the trade (that team would claim him first). With none
    // between, every team ahead of the first one passed on such a player in the baseline: the second side is next in line.
    if (allocated) pool = poolRestriction([...pool.excluded, ...(between ? s.team.claimed : []), ...l.change.adds, ...claimedBy(run)]);
  }
  return {
    mineLegal: legal[0] as LegalSide,
    theirLegal: legal[1] as LegalSide,
    mine: runs[0] as OptimizedRoster,
    theirs: runs[1] as OptimizedRoster,
    first: partnerFirst ? "partner" : "me",
    pools: { mine: pools[0] as PoolRestriction, theirs: pools[1] as PoolRestriction },
    specs: { mine: (legal[0] as LegalSide).spec, theirs: (legal[1] as LegalSide).spec },
  };
}

/**
 * A side's forced roster moves on the card (TradeEvaluation.required; tradeModel.ts RosterChange): legality's drops and
 * adds (rules 1–4); `toIR`, the received IR players rule 5 put into its open IR slots (LegalSide.toIR); and `displaced`,
 * the roster spot a returner needs from his week (returners.finalLineups) on its final evaluation after the trade
 * (SideEval.displaced after V*(after); `week` the NFL week from which the drop counts) that its baseline at V*(T) doesn't
 * have. ⚠️ Ours (final review of Phase 4b): a displacement the baseline has too (the same player from the same week for
 * the same returner) isn't the trade's move, and B doesn't count it (both sides of the comparison have it): on Parker's
 * league, Oct 3, my own IR WR displaces a bench WR from week 7 in the baseline, so every card would repeat it. `toIR` and
 * `displaced` are present only when not empty ("absent or empty: none").
 */
export function rosterChangeOf(I: TradeInternals, legal: Pick<LegalSide, "change" | "toIR">, after: Pick<SideEval, "displaced">, side: Pick<TeamState, "base">): RosterChange {
  const weeks = I.league.lp.weeks.weeks;
  const key = (d: Displacement) => `${d.id}\u0004${d.from}\u0004${d.returner}`;
  const before = new Set(side.base.displaced.map(key));
  const displaced = after.displaced.flatMap((d) => {
    const week = weeks[d.from];
    return before.has(key(d)) || week === undefined ? [] : [{ playerId: d.id, week, returner: d.returner }];
  });
  return {
    drops: [...legal.change.drops],
    adds: [...legal.change.adds],
    ...(legal.toIR.length ? { toIR: [...legal.toIR] } : {}),
    ...(displaced.length ? { displaced } : {}),
  };
}

/** An exactly evaluated trade with what its simulation needs. */
export interface ExactTrade {
  evaluation: TradeEvaluationCore;
  partner: TeamState;
  mine: SideEval;
  theirs: SideEval;
  /** ΔDyn and MyDynTotal (dynasty and keeper leagues with long-term values), else null. */
  dynasty: { delta: number; total: number } | null;
}

/**
 * Exact evaluation of a proposal (M3; the file header): legality in the exact mode, V* on both sides, the exact-mode
 * lineups, acceptance with hot and urg, and the card's numbers that don't need the simulation (stage "exact", B null).
 * `{ illegal }` when the proposal or a roster rule makes it illegal.
 */
export function evaluateExact(I: TradeInternals, proposal: TradeProposal, maxPerSide: number): ExactTrade | { illegal: string } {
  const problem = proposalProblem(I, proposal, maxPerSide);
  if (problem) return { illegal: problem };
  const me = I.me as TeamState;
  const partner = I.byId.get(proposal.partnerId) as TeamState;
  const give = playerIds(proposal.give);
  const get = playerIds(proposal.get);
  const partnerName = teamName(I, partner.id);
  const after = tradeSides(I, me, partner, give, get, partnerName);
  if ("illegal" in after) return after;
  const { mineLegal, theirLegal } = after;
  const mine = sideEval(I, me, after.mine, after.specs.mine);
  const theirs = sideEval(I, partner, after.theirs, after.specs.theirs);
  const weeks = I.league.lp.weeks.weeks;

  const dPPW = ppw(mine.lv, weeks, I.regWeeks) - ppw(me.base.lv, weeks, I.regWeeks);
  const dPPWPlayoffs = ppw(mine.lv, weeks, I.poWeeks) - ppw(me.base.lv, weeks, I.poWeeks);
  const delta = partnerLineupDelta(partner.base.lv, theirs.lv, I.from);
  const hole = holeFeature(holeSlots(I, partner.base.hole, theirs.hole, I.medians.exact), receivedStarters(I, theirs.ev, give));
  // Each side's open-spot credit follows its own active roster after rule 5 (an IR slot isn't a roster spot: market.ts's
  // header), so with an IR player in the trade my package and the partner's needn't mirror each other.
  const mySpots = spotsOf(mineLegal, give, get);
  const theirSpots = spotsOf(theirLegal, get, give);
  const myPkg = tradePackage({ players: get }, { players: give }, I.values, I.credit, config.market, mySpots);
  const gPartner = tradePackage({ players: give }, { players: get }, I.values, I.credit, config.market, theirSpots).g;
  // The partner's g as it perceives it (the star premium on what it gives): the g feature only; the veto reads gPartner.
  const gPerceived = perceivedG(I, partner.id, give, get, gPartner, theirSpots);
  const rosOf = (ids: readonly string[]) => ids.reduce((s, id) => s + (I.league.lp.players[id]?.ros.total ?? 0), 0);
  const profile = I.profiles.get(partner.id) as PartnerProfile;
  const hot = hotTerm(give, get, I.hot);
  const accept = acceptance(
    { leagueType: I.snapshot.settings.leagueType, tradeReview: I.snapshot.settings.tradeReview },
    profile,
    { gPartner, gPerceived, deltaLineup: delta.blended, h: hole.h, assets: give.length + get.length, partnerReceives: receivedPlayers(I, give), hot, urg: I.urg },
  );
  const f = I.future;
  // ΔDyn (§10): my long-term package change, each player at max(v, W) on the future term's values and W like every
  // package (planner reply to Checkpoint 4, change 4): a player worth less than the best free agent is replaceable, and
  // V*(me) already counts that, so dumping him is no long-term gain either. MyDynTotal stays raw (rosterValue).
  const dynasty = f && I.snapshot.settings.leagueType !== "redraft" ? (() => {
    const pkg = tradePackage({ players: get }, { players: give }, f.values, f.credit, config.market, mySpots);
    return { delta: pkg.recv - pkg.give, total: f.myTotal };
  })() : null;

  const partnerRanks = I.ranks.get(partner.id) as Int32Array;
  const slotChanges = (before: Float64Array, after: Float64Array): SlotChange[] => I.instances.map((inst, i) => ({ key: inst.key, before: before[i] as number, after: after[i] as number }));
  const notes: string[] = [];
  if (I.inProgress && I.model.inProgressWeek !== null) notes.push(`Week ${I.model.inProgressWeek} is under way, so this trade can't change it: its odds count week ${I.model.inProgressWeek} as it stands.`);
  if (I.snapshot.settings.leagueType === "keeper") notes.push("Keeper costs aren't modeled.");
  const detail: TradeDetail = {
    myTeamId: me.id,
    mySlots: slotChanges(me.base.regular, mine.regular),
    partnerSlots: slotChanges(partner.base.regular, theirs.regular).map((s, i) => ({ ...s, rank: partnerRanks[i] as number })),
    teams: I.snapshot.teams.length,
    holes: hole.holes,
    holesFilled: hole.filled,
    terms: accept.terms,
    vetoRisk: accept.vetoRisk,
    activity: profile.activity,
    history: { trades: profile.history.trades, average: profile.history.average },
    context: accept.context,
    hotReceived: give.filter((id) => I.hot.has(id)),
    hotGiven: get.filter((id) => I.hot.has(id)),
    urgency: I.urg,
    weekly: weeks.map((week, w) => ({ week, before: me.base.score.mean[w] as number, after: mine.score.mean[w] as number })),
    riskyWeeks: [...I.riskyWeeks],
    notes,
    // One fact per player the partner gives (e may be 0).
    premium: premiumFacts(get, I.premiums.get(partner.id)),
  };
  const gMine = myPkg.g;
  const injured = injuredReceived(get, I.snapshot.players);
  const evaluation: TradeEvaluationCore = {
    key: proposalKey(proposal),
    proposal: { partnerId: partner.id, give: players(give), get: players(get) },
    illegal: null,
    stage: "exact",
    sims: 0,
    required: { me: rosterChangeOf(I, mineLegal, mine, me), partner: rosterChangeOf(I, theirLegal, theirs, partner) },
    b: null,
    tradeScore: null,
    pAccept: accept.pAccept,
    pComplete: accept.pComplete,
    acceptLabel: accept.label,
    overall: null,
    dPO: null,
    dCH: null,
    dEW: null,
    dPPW,
    dPPWPlayoffs,
    bWin: null,
    bFuture: null,
    lambda: null,
    dDyn: null,
    dynMissing: false,
    value: { given: myPkg.give, received: myPkg.recv },
    gMine,
    gPartner,
    ros: { given: rosOf(give), received: rosOf(get) },
    partnerDeltaLineup: delta.blended,
    features: accept.features,
    flags: tradeFlags({ gMine, b: null, injured }),
    detail,
  };
  return { evaluation, partner, mine, theirs, dynasty };
}

// ---------------------------------------------------------------------------------------------
// The simulation (M4)

/**
 * My odds with my team's and `partner`'s score rows replaced (null rows: the baseline's), `sims` seasons on the shared
 * matrix. P(title) is null when the league's title odds are unknown (season.ts's rules).
 */
function runSim(I: TradeInternals, mine: SideEval | null, theirs: { partner: TeamState; side: SideEval } | null, stage: SimStage): MyOdds {
  const sim = I.sim as SimState;
  const me = I.me as TeamState;
  const { setup, simWeekToModelWeek } = sim.built;
  const rowsOf = (score: WeeklyScore) => ({ mean: Float64Array.from(simWeekToModelWeek, (k) => score.mean[k] as number), sd: Float64Array.from(simWeekToModelWeek, (k) => score.sd[k] as number) });
  const mean = [...setup.mean];
  const sd = [...setup.sd];
  if (mine) {
    const r = rowsOf(mine.score);
    mean[me.index] = r.mean;
    sd[me.index] = r.sd;
  }
  if (theirs) {
    const r = rowsOf(theirs.side.score);
    mean[theirs.partner.index] = r.mean;
    sd[theirs.partner.index] = r.sd;
  }
  const normals = sim.blocks[stage];
  const res = simulateSeason({ ...setup, mean, sd }, { sims: normals.sims, seed: sim.seed, normals });
  const o = res.teams[me.index];
  const titleKnown = sim.built.playoffsKnown && res.playoffsKnown && o !== undefined && Number.isFinite(o.pTitle);
  return { pPlayoffs: o?.pPlayoffs ?? 0, pTitle: titleKnown ? (o as { pTitle: number }).pTitle : null, expWins: o?.expWins ?? 0 };
}

/** Seasons simulated at each stage (config.simulation). */
export function simCounts(): { screen: number; final: number } {
  return { screen: Math.max(1, Math.floor(config.simulation.screeningSims)), final: Math.max(1, Math.floor(config.simulation.finalSims)) };
}

/**
 * The trade's season simulation (M4) on the `stage` block of seasons (screening or final), and every number that follows from it: ΔPO, ΔCH, ΔEW, B and its
 * parts (benefit, with λ = the setting or the default by my finalSims baseline P(playoffs), and κ = the "Protect my trade
 * value" level's: benefit.protectValueWeight), the Trade Score and Overall, the flags, and benefitNotes in the detail's notes. Without odds
 * (the context's note), B stays null. `protectValue` is the user's per-call setting (TradeSettings.protectValue); absent,
 * the context's settings' (the search and the Analyzer always pass theirs: a cached context may hold older settings).
 */
export function simulateTrade(I: TradeInternals, x: ExactTrade, stage: SimStage, lambda: number | null, protectValue?: ProtectValue): TradeEvaluationCore {
  const ev = x.evaluation;
  const final = stage === "final";
  const sims = simCounts()[stage];
  let dPO: number | null = null;
  let dCH: number | null = null;
  let dEW: number | null = null;
  if (I.sim && I.me) {
    const base = I.sim.base[stage];
    const after = runSim(I, x.mine, { partner: x.partner, side: x.theirs }, stage);
    dPO = after.pPlayoffs - base.pPlayoffs;
    dCH = after.pTitle !== null && base.pTitle !== null ? after.pTitle - base.pTitle : null;
    dEW = after.expWins - base.expWins;
  }
  const kappa = protectValueWeight(protectValue ?? I.settings.protectValue);
  const b = benefit({ leagueType: I.snapshot.settings.leagueType, dPO, dCH, gMine: ev.gMine, dynasty: x.dynasty, myPPlayoffs: I.sim ? I.sim.base.final.pPlayoffs : null, lambda, kappa });
  const numbers = tradeNumbers(b, { pAccept: ev.pAccept, pComplete: ev.pComplete, label: ev.acceptLabel });
  const { titleMissing: _titleMissing, ...cardNumbers } = numbers;
  void _titleMissing;
  const notes = [...ev.detail.notes, ...benefitNotes(b)];
  return {
    ...ev,
    ...cardNumbers,
    stage: I.sim ? (final ? "final" : "exact") : ev.stage,
    sims: I.sim ? sims : 0,
    dPO,
    dCH,
    dEW,
    flags: tradeFlags({ gMine: ev.gMine, b: b.b, injured: ev.flags.injured }),
    detail: { ...ev.detail, notes },
  };
}

// ---------------------------------------------------------------------------------------------
// "Offer first / if they say no" (planner addendum to Checkpoint 3, §4; lead decision N4)

/** One version of a trade for the steps: its exact evaluation and its numbers on the screening block of seasons (simulateTrade "screen"). */
export interface TradeVersion {
  x: ExactTrade;
  screen: TradeEvaluationCore;
}

/** The config keys the steps read (config.search.throwInMaxCost and config.search.steps), widened so tests can pass others. */
export interface StepConfig {
  /** A throw-in's lineup cost is at most this (ROS lineup points, the exact mode's lineups). */
  readonly throwInMaxCost: number;
  /** Steps are shown when the full version's P_complete is at least this above the offer-first's, … */
  readonly minAcceptGain: number;
  /** … and the offer-first version's is at least this. */
  readonly minOfferFirst: number;
  /** Case 2: the throw-in added must keep B at least this share of the offer's B (both on the screening block). */
  readonly minBShare: number;
  /** Case 2's pre-screen (performance, not a model number): only the best this many candidates get exact evaluation; Infinity: all. */
  readonly preScreen: number;
}

/** The steps' config (§15 defaults). */
export function stepConfig(): StepConfig {
  const s = config.search.steps;
  return { throwInMaxCost: config.search.throwInMaxCost, minAcceptGain: s.minAcceptGain, minOfferFirst: s.minOfferFirst, minBShare: s.minBShare, preScreen: s.preScreen };
}

/**
 * My throw-ins (the file header, "Offer first"): my active-roster players with a model whose lineup cost in the exact mode
 * (TeamPlayerValue.mvLoseScen with scenarios, else mvLoseEv: MV_lose against my free-agent-optimized roster V*) is at most
 * throwInMaxCost, not at a position the search leaves out (config.market.tradeSearchExcluded) unless includeKDefIdp, not
 * untouchable and not must-include. Cheapest first by perception value (the values g reads), ties: the smaller id. Empty
 * without my team.
 */
export function throwIns(I: TradeInternals, settings: Pick<TradeSettings, "includeKDefIdp" | "untouchables" | "mustInclude">, cfg: Pick<StepConfig, "throwInMaxCost"> = stepConfig()): string[] {
  const me = I.me;
  if (!me) return [];
  const costs = I.model.teams[me.index]?.players ?? {};
  const excluded = new Set<Pos>(settings.includeKDefIdp ? [] : config.market.tradeSearchExcluded);
  const untouchable = new Set(settings.untouchables);
  const forced = new Set(settings.mustInclude);
  const value = (id: string) => I.values[id] ?? 0;
  return me.roster
    .filter((id) => {
      const pv = costs[id];
      if (!pv || !I.league.table.rows.has(id) || untouchable.has(id) || forced.has(id)) return false;
      const pos = I.league.posOf(id);
      if (pos === undefined || excluded.has(pos)) return false;
      const cost = pv.mvLoseScen ?? pv.mvLoseEv;
      return Number.isFinite(cost) && cost <= cfg.throwInMaxCost + EPS;
    })
    .sort((a, b) => value(a) - value(b) || byId(a, b));
}

/** The settings the steps read: the search's (or the Analyzer's) per-call settings. */
export type StepSettings = Pick<TradeSettings, "lambda" | "protectValue" | "includeKDefIdp" | "untouchables" | "mustInclude">;

export interface StepOptions {
  settings: StepSettings;
  /** My side's most players in a version: the search's maxPerSide, the Analyzer's analyzerMaxPerSide. */
  maxPerSide: number;
  /**
   * Versions already evaluated (the search's exact trades with their screening-block numbers), by key: a version found here
   * isn't evaluated again (exact evaluation and the simulation are deterministic: the numbers are the same). New versions
   * are added.
   */
  versions?: Map<string, TradeVersion>;
  /** Default stepConfig(). */
  cfg?: StepConfig;
}

/** A version of a trade, exactly evaluated with the screening simulation; null when it's illegal (every roster rule re-checked). */
export function tradeVersion(I: TradeInternals, proposal: TradeProposal, opts: Pick<StepOptions, "settings" | "maxPerSide" | "versions">): TradeVersion | null {
  const key = proposalKey(proposal);
  const known = opts.versions?.get(key);
  if (known) return known;
  const x = evaluateExact(I, proposal, opts.maxPerSide);
  if ("illegal" in x) return null;
  const version: TradeVersion = { x, screen: simulateTrade(I, x, "screen", opts.settings.lambda, opts.settings.protectValue) };
  opts.versions?.set(key, version);
  return version;
}

/** A version's step (TradeStep): its proposal, its screening-block numbers, its forced moves and its explanation facts. */
function stepOf(v: TradeVersion): TradeStep {
  const c = v.screen;
  return { proposal: c.proposal, key: c.key, b: c.b, tradeScore: c.tradeScore, pAccept: c.pAccept, pComplete: c.pComplete, acceptLabel: c.acceptLabel, gMine: c.gMine, gPartner: c.gPartner, required: c.required, detail: c.detail };
}

/**
 * Case 2's candidates in pre-screen order (the file header): the screening's quick estimate of P_complete (quick P_accept,
 * halved by the veto rule on the raw g_mkt(P) as P_complete is), then the screening's ΔROS, then the smaller id; those the
 * screening's legality rejects last.
 */
export function preScreenOrder(I: TradeInternals, partner: TeamState, give: readonly string[], get: readonly string[], candidates: readonly string[]): string[] {
  const review = I.snapshot.settings.tradeReview;
  const scored = candidates.map((id) => {
    const s = screenTrade(I, partner, [...give, id], get);
    const p = s ? (vetoApplies(review, s.gPartner) ? s.pQuick * config.acceptance.veto.factor : s.pQuick) : Number.NEGATIVE_INFINITY;
    return { id, p, delta: s ? s.myDelta : Number.NEGATIVE_INFINITY };
  });
  const ahead = (x: number, y: number) => (x === y || Math.abs(x - y) <= EPS ? 0 : y - x);
  scored.sort((a, b) => ahead(a.p, b.p) || ahead(a.delta, b.delta) || byId(a.id, b.id));
  return scored.map((x) => x.id);
}

/** Case 2's candidates (the file header): my throw-ins not in the trade, pre-screened to the best cfg.preScreen when there are more. */
export function addCandidates(I: TradeInternals, proposal: TradeProposal, throwInIds: readonly string[], cfg: Pick<StepConfig, "preScreen">): string[] {
  const give = playerIds(proposal.give);
  const get = playerIds(proposal.get);
  const candidates = throwInIds.filter((id) => !give.includes(id));
  const partner = I.byId.get(proposal.partnerId);
  if (!partner || !(candidates.length > cfg.preScreen)) return candidates;
  return preScreenOrder(I, partner, give, get, candidates).slice(0, Math.max(0, Math.floor(cfg.preScreen)));
}

/** Whether a version helps me: its B (screening block) is known and above 0 (the file header: the offer first must help). */
const helps = (v: TradeVersion): boolean => {
  const b = v.screen.b;
  return b !== null && Number.isFinite(b) && b > 0;
};

/**
 * "Offer first / if they say no" for a trade (the file header): its two steps, or null when none qualify (the offer-first
 * version must help me: B > 0 on the screening block), or without my team. `ranked` is the trade as ranked, with its
 * screening-block numbers.
 */
export function tradeSteps(I: TradeInternals, ranked: TradeVersion, opts: StepOptions): TradeSteps | null {
  if (!I.me) return null;
  const cfg = opts.cfg ?? stepConfig();
  const proposal = ranked.screen.proposal;
  if ([...proposal.give, ...proposal.get].some((a) => a.kind !== "player")) return null;
  const give = playerIds(proposal.give);
  const get = playerIds(proposal.get);
  const all = throwIns(I, opts.settings, cfg);
  const mine = all.filter((id) => give.includes(id));
  const version = (ids: readonly string[]) => tradeVersion(I, { partnerId: proposal.partnerId, give: players(ids), get: players(get) }, opts);
  let offer: TradeVersion;
  let full: TradeVersion;
  let add: string;
  let rankedAs: TradeSteps["ranked"];
  if (mine.length > 0 && give.length >= 2) {
    // Case 1: offer first without my lowest-value throw-in in the trade; if they say no, add it back (the ranked trade).
    // The lean version must help me too: never advise offering a trade that doesn't.
    add = mine[0] as string;
    const lean = version(give.filter((id) => id !== add));
    if (!lean || !helps(lean)) return null;
    offer = lean;
    full = ranked;
    rankedAs = "full";
  } else {
    // Case 2: offer the ranked trade first (it must help me, so minBShare compares positive B); if they say no, add the
    // throw-in that raises P_complete most while B stays at least minBShare of the offer's (both on the screening block)
    // and above 0; ties: the higher B, then the smaller id.
    const bOffer = ranked.screen.b;
    if (bOffer === null || !helps(ranked) || give.length + 1 > opts.maxPerSide) return null;
    let best: { id: string; v: TradeVersion; p: number; b: number } | null = null;
    for (const id of addCandidates(I, proposal, all, cfg)) {
      const v = version([...give, id]);
      const b = v?.screen.b;
      if (!v || b === null || b === undefined || !helps(v) || b < cfg.minBShare * bOffer - EPS) continue;
      const p = v.screen.pComplete;
      if (!best || p > best.p + EPS || (Math.abs(p - best.p) <= EPS && (b > best.b + EPS || (Math.abs(b - best.b) <= EPS && id < best.id)))) best = { id, v, p, b };
    }
    if (!best) return null;
    offer = ranked;
    full = best.v;
    add = best.id;
    rankedAs = "offerFirst";
  }
  const first = offer.screen.pComplete;
  if (!(full.screen.pComplete - first >= cfg.minAcceptGain - EPS) || !(first >= cfg.minOfferFirst - EPS)) return null;
  return { offerFirst: stepOf(offer), ifNo: { add, full: stepOf(full) }, ranked: rankedAs };
}

// ---------------------------------------------------------------------------------------------
// Words (explain.ts) and values (rank.ts)

/** The names and league facts explain.ts reads: the app's own names (snapshot teams and players), and FantasyCalc's values for the pitch. */
export function explainContextOf(I: TradeInternals): ExplainContext {
  return {
    teamName: (id) => teamName(I, id),
    player: (id) => {
      const info = I.snapshot.players[id];
      return info ? { name: info.name, pos: info.pos, nflTeam: info.nflTeam, injury: info.injury } : null;
    },
    slots: I.instances.map((inst, i) => ({ ...inst, eligible: I.slotEligible[i] ?? [] })),
    leagueType: I.snapshot.settings.leagueType,
    tradeDeadline: I.snapshot.settings.tradeDeadline,
    // The pitch quotes FantasyCalc's own values (explain.ts): a perception value from FantasyCalc, never an estimate.
    fantasyCalcValue: (id) => {
      const v = I.league.lp.players[id]?.value;
      return v && v.source === "fantasycalc" ? v.value : null;
    },
  };
}

/** A finished evaluation: the core plus its reasons and pitch (explain.ts). */
export function withWords(I: TradeInternals, core: TradeEvaluationCore): TradeEvaluation {
  const words = explainTrade(core, explainContextOf(I));
  // The card's injury tags (planner reply to Checkpoint 4, change 6): every tagged player on either side, with the return
  // week the model counts on (explain.tagContextOf), for the Trade Finder's cards and the Analyzer's alike.
  const tagged = injuryTags(core.proposal, I.snapshot.players, tagContextOf(I));
  return { ...core, flags: { ...core.flags, tagged }, reasons: words.reasons, pitch: words.pitch };
}

/** An asset's perception value (§9), for rank.ts's cores; picks are 0 in this phase. */
export function assetValue(I: TradeInternals): (asset: TradeAsset) => number {
  return (asset) => (asset.kind === "player" ? (I.values[asset.id] ?? 0) : 0);
}

// ---------------------------------------------------------------------------------------------
// The Trade Analyzer

export interface AnalyzeOptions {
  /** The settings the evaluation reads per call (lambda and protectValue; the rest is the context's). Default: defaultTradeSettings(). */
  settings?: TradeSettings;
  clock?: () => number;
}

export interface TradeAnalysis {
  /** The full evaluation (exact lineups and config.simulation.finalSims seasons), null when the trade is illegal or can't be evaluated. */
  evaluation: TradeEvaluation | null;
  /** Why the trade can't be made, in plain English (null when it can). */
  illegal: string | null;
  /** Plain-English notes (the context's notes that apply, and this trade's). */
  notes: string[];
}

/** The Trade Analyzer (§13): any proposal, evaluated exactly as the search's finalists are. */
export function analyzeTrade(ctx: TradeContext, proposal: TradeProposal, opts: AnalyzeOptions = {}): TradeAnalysis {
  const I = tradeInternals(ctx);
  const notes = [...I.notes];
  if (!I.me) return { evaluation: null, illegal: null, notes };
  const settings = normalizeTradeSettings(opts.settings ?? defaultTradeSettings());
  const maxPerSide = Math.max(1, Math.floor(config.search.analyzerMaxPerSide));
  const exact = evaluateExact(I, proposal, maxPerSide);
  if ("illegal" in exact) return { evaluation: null, illegal: exact.illegal, notes };
  const core = simulateTrade(I, exact, "final", settings.lambda, settings.protectValue);
  for (const n of core.detail.notes) if (!notes.includes(n)) notes.push(n);
  // "Offer first / if they say no" for the analyzed trade too (N4: useful for counteroffers), from its numbers on the
  // screening block, its versions within the Analyzer's per-side maximum. ⚠️ Only for a trade the Trade Finder could show
  // (B > 0, not hidden by the market guard: review of the addendum, engine findings 1 and 10), so a card that says the
  // trade doesn't help never says how to land it; and none when a context note stops the search (the deadline passed,
  // the season's over, no odds, …): the Analyzer still evaluates, but there's nothing to offer.
  const shown = core.b !== null && core.b > 0 && !core.flags.hiddenByMarket; // B > 0: not hidden by benefit either
  const steps = I.blocked || !shown ? null : tradeSteps(I, { x: exact, screen: simulateTrade(I, exact, "screen", settings.lambda, settings.protectValue) }, { settings, maxPerSide });
  return { evaluation: withWords(I, steps ? { ...core, steps } : core), illegal: null, notes };
}
