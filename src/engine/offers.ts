/**
 * "How to offer it": offers in order (CLAUDE.md §13; Checkpoint 7e, planner reply to Checkpoint 7d, item 4.1: "Replace 'Offer
 * first' and 'If they say no, add' with one ordered list of up to 4 offers to the same team: 1. Open: the version that's best
 * for Parker (highest Helps you) that still has at least a 15% chance, so it isn't insulting. 2. Then: versions a little
 * less good for him, each at least 5 points likelier than the step before. 3. The suggested trade. 4. Last offer: the
 * suggested trade plus the throw-in, using the existing rule (at least 5 points likelier, and Helps you at least 80% of the
 * suggested trade's)"; the lead's addendum for wave D). Built on demand in the engine worker when the user opens a card's
 * "How to offer it" (engine.worker.ts `offers`): a Trade Finder card from its search's state (offerLadderOfSearch), the Trade
 * Analyzer's card, or a Finder card whose search the worker no longer keeps, from its proposal (offerLadderOfProposal). Since
 * Checkpoint 7f also during the search, for the cards the merge reads (search.ts, "Merged cards": ladderNeighbors,
 * offerFeasible, ladderChoiceSteps), whose ladders the search keeps and the worker hands back as they are. Pure
 * and deterministic: the same context, settings and card give the same ladder; the only clock is the optional one for
 * OfferLadder.ms. Every number comes from config.offers, config.search.steps and the rest of config through evaluate.ts.
 *
 * The candidates (ladderCandidates):
 * - Variants: the suggested trade's own give side with any other get side from the partner's get pool H (the search's H for
 *   that partner, SearchState.getPools: its top getPool untagged and getPoolTagged "Harder to get" players by MV_add(me, j);
 *   for the Analyzer's card search.ts getPoolOf, the same function), every set of 1 to settings.maxPerSide of them but the
 *   card's own (⚠️ ours: in the Analyzer, whose card can ask for more, still the user's maxPerSide; and the card's own
 *   players of theirs stay candidates though H may not hold one there), each holding the partner's must-include players the
 *   card holds (all of them on a Finder card), in H's order. The planner's example: Nacua for London + Olave, or for Olave +
 *   Watson.
 * - The lean version (until Checkpoint 7e the steps' case 1): the suggested trade without my lowest-value throw-in in it
 *   (evaluate.ts throwIns: a player whose loss costs my lineup at most config.search.throwInMaxCost), when my side keeps a
 *   player without him.
 * - The smaller asks (Checkpoint 7g; planner reply to Checkpoint 7f, answer 3(a); smallerAsks), the Last offer's own: the
 *   card's players of mine for each proper, non-empty part of its players of theirs, holding the partner's must-include
 *   players the card holds, players only (none for a one-player get side). Each is a variant too (an Open's or a Then's
 *   candidate by the chance rules: those print a chance at least minAcceptGain under the card's, a smaller ask as a Last
 *   offer at least minAcceptGain above it, so one is never both).
 * - Never the card itself. Nothing else is barred since Checkpoint 7f (the lead's call): the trade its Plan B box shows can
 *   never be an offer by the rules. A box is at least minAcceptGain likelier to go through than its card (planB.ts
 *   planBPasses), so it prints a chance at least the card's, while an Open or Then prints one at least minAcceptGain under
 *   it; and a box is another set of their players (planB.ts, "Which"), while the lean version and the throw-in's Last offer
 *   keep the card's. (Checkpoint 7e barred the box from the candidates, which changed none of 893 ladders on Parker's leagues
 *   and 68 synthetic ones; ⚠️ the report switches planB otherTargetOnly false and minAcceptGain null can make a box an
 *   offer.) Since Checkpoint 7g a smaller ask is a likelier, other set of their players, which a box is too, so ⚠️ the search
 *   keeps a box off one its card's Last offer could take (the narrow rule, the lead's call D5: search.ts finish, planB.ts
 *   smallerAskOf and offerFeasible(card, box, "smaller") on both printed numbers, which don't depend on whether the ladder was
 *   worked out): a box is still never an offer, and ladders still don't read Plan B. A box can be a smaller ask the Last offer
 *   can't take (one that keeps less than lastMinOverallShare of the card's Overall, say). ⚠️ Reading only those two numbers,
 *   the rule can keep out of a box an ask the Last offer could take but doesn't (it picks another version), which then shows
 *   nowhere on the card (search.ts, "Merged cards, Checkpoint 7g": smallLeague 32's card has no box).
 * - ⚠️ Another card of its list can be an offer (the lead's call, wave D; it replaces the review's barring, D-ENG-2 and
 *   UI-D-2): the rules choose it as they choose any candidate. Since Checkpoint 7f (planner reply to Checkpoint 7e,
 *   decision 3: "When one card's offer list contains another card's trade, merge them") the search folds it into the
 *   card when the card has the higher Overall (search.ts, "Merged cards"), so it shows only among the card's offers;
 *   when it has the higher Overall itself (its own offers then don't include the card, or the merge would have folded
 *   the card into it: the review of the merge, MERGE-1), both stay, and the card labels it with that card's place in the
 *   sort the Trade Finder shows ("Also shown as trade idea 2.", Plan B's words: tradeView.ts planBAlsoText,
 *   TradeCard.tsx `places`). Checkpoint 7f's two shapes: (i) the card is a likelier variant of the other, a smaller ask
 *   that opens with the bigger one, which the other's ladder couldn't hold then (its offers before its suggested trade are
 *   less likely than it, and its Last offer was itself plus a player of mine); (ii) the card is the other's lean version,
 *   the other being the card plus a player of mine (the card's Last offer), which the other's ladder could hold as its Open
 *   or a Then by the rules but passed over, picking those by Helps you on the screening block's 1,000 seasons (Parker's
 *   "Helps both" list, Oct 15: Puka Nacua → Drake London + Christian Watson, whose Last offer is Marvin Harrison Jr. +
 *   Puka Nacua → Drake London + Christian Watson). Since Checkpoint 7g (planner reply to Checkpoint 7f, answer 3) a
 *   shape-(i) pair merges when the other's Last offer takes the card as a smaller ask ("4. Last offer": at least
 *   lastMinOverallShare of its unrounded Overall, the higher Overall of the two kinds), and a shape-(ii) pair when the
 *   other's ladder, preferring the cards of its list, takes the card ("Preferring the cards of its lists"); any other pair
 *   keeps the label. Why not bar it: the card's plan is lost, and "no version of it makes a better
 *   first offer" can be false (barred, on Parker's league, week 6, his top 3 cards each read "Offer this trade as it
 *   is", though #1 opens with #2's trade, #2 ends with #1's as its Last offer and #3 opens with #5's).
 * The pre-screen (preScreened; ⚠️ ours, the review of wave D, D-ENG-1 and D-ENG-7: evaluating every candidate exactly kept
 * about 33 MB a card in the engine worker's context, the optimizer's memos, and took 1.4–2.0 s in Node with 3 players a
 * side): each candidate's quick estimate of the chance on the screening's fast method (evaluate.ts quickScreen, as the Last
 * offer's pre-screen reads it), and only those within config.offers.preScreenMargin of the Open's and Then's window (at
 * least the Open's bar, at most the card's own quick estimate less minAcceptGain: every Then sits in the Open's window too)
 * go on, the most my EV lineup gains first (my ΔROS on the fast method, a stand-in for Helps you; ties: the key), at most
 * config.offers.preScreenMax of them. ⚠️ The fast method leaves out hot, urg and the exact lineups, so where its estimate
 * runs far under the exact chance an Open can fall under the window's floor (a synthetic card whose own estimate was 20
 * points under its chance lost an Open printing 18% that way; moving the floor by the card's own miss kept that one but
 * let low-chance asks crowd the cap and lost more: config.offers). Every card's candidates go through the same filter
 * whoever evaluated them before, so a ladder doesn't depend on which cards were opened first. The Analyzer's ladder for a
 * Finder card's trade differs ⚠️ through the Last offer, by the per-side limit (rule 4: the Analyzer's
 * analyzerMaxPerSide, the steps' case 2 rule there since Phase 4; the final review of Checkpoint 7e, ENG-7E-4: on Parker's two
 * leagues 10 of 25 cards opened in the Analyzer add a Last offer with a third player of mine, which the Trade Finder's
 * maxPerSide of 2 leaves out), and ⚠️ since Checkpoint 7g through the Finder card's preference ("Preferring the cards of its
 * lists"), which the Analyzer's card, on no list, doesn't have (the merge's design, §4.3, accepted; the final review,
 * merge-b-analyzer-disagrees: on Parker's league 1, Oct 14, his prizes, idea 1, Marvin Harrison Jr. + Puka Nacua → Tetairoa
 * McMillan + Nico Collins, opens on the Trade Finder with idea 2's trade, Puka Nacua → the same two, which it prefers, while
 * the Analyzer, as without the preference, offers it as it is); until Checkpoint 7f also by what the Finder barred, its Plan
 * B. ⚠️ The pre-screen yields every config.search.yieldEveryScreens quick estimates (ladderChoiceSteps), as the screening does.
 * The candidates that pass are evaluated exactly (legality re-checked, V* on both sides with item 2.1's either-way moves:
 * evaluate.ts tradeVersion) with the screening simulation, the search's own versions reused by key.
 *
 * The rules, judged first on the screening block's numbers (Helps you on the ranking block's B₃, as the search's screening
 * reads it), then on the numbers each step prints (the shown block's 20,000 seasons, item 1.1, as the card's own: the shown
 * pass's rule, so the card never shows a step that breaks one); the chance they accept doesn't depend on the seasons, only
 * Helps you does. A step that breaks a rule on its printed numbers leaves and the next candidate is tried, at most
 * config.offers.tries runs on the shown block a step (⚠️ ours, a speed bound like Plan B's tries). Every step helps me
 * (Helps you above 0 as printed, B > 0) and passes the market guard (not hidden: g_mkt(me) at least
 * config.benefit.marketHideBelow); ⚠️ on a card tagged "Helps both" (benefit.helpsBoth on its printed numbers) every step
 * helps both too (Checkpoint 7c's rule for the steps, HB-1). Chances are P_complete as the card prints it
 * (acceptance.displayAcceptance, the nearest 5%, the minimum chance's own reading; ⚠️ as the steps read it), "5 points" is
 * config.search.steps.minAcceptGain. "Better for me" is Helps you as printed and, ⚠️ where it prints the same, B: every
 * step's printed B is strictly below the step before's (betweenForMe, on the printed numbers only; the final review of
 * Checkpoint 7e, ENG-7E-1: Helps you is rounded and flattens near 100, so on equal printed Helps you the ladder had told the
 * user to send the worse deal first: on Parker's league, week 6, card #8's Last offer printed the card's 27 at B 1.196
 * against its 1.160, and was likelier):
 * 1. Open: the candidate with the highest Helps you (ties: the higher chance, then the key) among those that print a chance
 *    of at least max(config.offers.openMinChance, the user's minimum chance) (Phase 4c's rule: never suggest sending
 *    something below the minimum the user set), at least 5 points below the suggested trade's, and a Helps you at least the
 *    suggested trade's, at a higher B (betweenForMe).
 * 2. Then, while the ladder has room: after the step before, the candidate with the highest Helps you (same ties) among those
 *    that print a chance at least 5 points above the step before's and at least 5 points below the suggested trade's, and a
 *    Helps you at most the step before's and at least the suggested trade's, B strictly between theirs ("a little less good
 *    for him, each at least 5 points likelier").
 * 3. The suggested trade: the card itself, its own printed numbers.
 * 4. Last offer (since Checkpoint 7g, planner reply to Checkpoint 7f, answer 3(a): "The Last offer can be either the
 *    throw-in or a smaller ask, whichever has the higher Overall. It must be at least 5 points likelier and keep at least
 *    80% of the suggested trade's Overall."; until then the throw-in alone), each kind's own pick (lastOfferSteps):
 *    - the throw-in: the suggested trade plus the throw-in by the rule that was the steps' case 2 (evaluate.ts
 *      lastOfferVersions: the throw-in from my roster that raises the chance they accept most while B stays at least
 *      config.search.steps.minBShare of the suggested trade's, ⚠️ "Helps you at least 80%" read as that rule on B, within the
 *      per-side limit: the search's maxPerSide, the Analyzer's analyzerMaxPerSide), printing a chance at least 5 points
 *      above the suggested trade's and ⚠️ a Helps you at most the suggested trade's at a lower B (the review of wave D,
 *      D-ENG-4 and UI-D-3: one printing more on both would be a better card, not a last offer, the lead's rule for the
 *      variants, and on 7 of 1,023 synthetic cards the ladder told the user to send the worse deal first; ENG-7E-1 above for
 *      an equal one). ⚠️ It keeps its rule on B (the lead's call, D4), which meets the planner's: B at least minBShare of the
 *      card's at a higher chance makes EG at least that share of the card's, and Overall, concave in EG from 0, keeps at
 *      least that share too, so every throw-in Last offer keeps 80% of the card's Overall, more than the smaller ask's
 *      lastMinOverallShare (75% since Checkpoint 7h); the rule only leaves out throw-ins that keep that share of the Overall
 *      while giving up more of Helps you;
 *    - a smaller ask ("The candidates"), each evaluated exactly with the screening simulation (the search's own version when
 *      it has one), kept on the screening block when it helps me (and both teams under a card tagged "Helps both") and
 *      prints a chance at least 5 points above the card's (the chance doesn't depend on the seasons), the highest Overall
 *      first (EG on the screening block, then the key), then held on its printed numbers to the same chance and Helps you
 *      rules and to an Overall, ⚠️ unrounded (overallOf: what the printed Overall rounds), at least
 *      config.offers.lastMinOverallShare of the card's (overallShareOk; 75% since Checkpoint 7h, planner reply to Checkpoint
 *      7g, answer 2: "Use 75%."; 80% at Checkpoint 7g), at most config.offers.tries of them;
 *    then whichever of the two prints the higher Overall (EG on the printed block: one B₃, the unrounded Overall's order), a
 *    tie going to the throw-in (⚠️ the lead's call, D6: no throw-in Last offer that already showed changes because of the
 *    comparison). Its label is "Last offer" either way, and its message the follow-up naming its version.
 *    (Another card of its list can be one: "The candidates" above.)
 * At most config.offers.maxSteps offers in all, the suggested trade counted: Open first, then the Last offer, then as many
 * Thens as fit (4: Open, at most one Then with a Last offer, two without one). No Open: no Then (any Then would have been an
 * Open). ⚠️ A variant that prints a higher Helps you and a higher chance than the card isn't in the ladder (the lead's call:
 * it would be a better card, not a first offer); the chance rules keep it out.
 *
 * Preferring the cards of its lists (Checkpoint 7g; planner reply to Checkpoint 7f, answer 3(b): "When more than one version
 * meets a step's rules, prefer the one that's on the list, so it merges."; the lead's calls D7–D12): a search's card can carry
 * a preference, the cards of its lists the merge could fold into it (LadderJob.prefer: search.ts preferredOf, ⚠️ only cards
 * below it on Overall that hold no merged trade yet and that no card above it took this round or its list gave back, on either
 * list since the final review, E3, feasible by offerFeasible, and the cross-list guard). Its ladder is then worked out twice
 * (ladderChoiceSteps): as usual, and preferring them: at each step
 * (the Open, each Then, the Last offer) the preferred versions that meet the step's rules on the numbers they print come
 * first, in the step's own order (the Open and a Then: Helps you on the screening block, then the chance, then the key; the
 * Last offer: each kind's own order, then the higher Overall), every one tried, past the pre-screen and config.offers.tries
 * (their numbers are the search's, known already); the others follow as usual. ⚠️ The preferring ladder is kept only when it
 * holds more preferred versions than the usual one: the planner's "so it merges" read as the rule's reason (a ladder that
 * holds no more cards of its list merges no more; preferring a listed version at the Open, when the usual ladder held it as a
 * Then, dropped two more helpful offers for no merge on Parker's league 1, Oct 15, at 3 players a side, and on smallLeague 4
 * and 42). Every card of its list a preferring ladder can hold is one of ladderNeighbors' (with a preference a Last offer can
 * be any throw-in of mine, past the pre-screen: ladderNeighbors lists them all when the search prefers). The Trade Analyzer's
 * card has no list, so no preference (its ladder for a Finder card's trade can differ through it: "The pre-screen"); a Finder
 * card worked out from its trade (the worker's fallback) carries the one its search recorded (ProposalLadderOptions.prefer).
 * The narrowing (Checkpoint 7h; planner reply to Checkpoint 7g, answer 4: "Narrow the preference. Prefer an idea from the list
 * only when its Helps you is within 3 points of the best version that meets the step's rules. Otherwise take the best
 * version."; narrowedPick): at each step of the preferring ladder the step's usual pick is worked out too (the version its
 * rules pick without the preference, held to them on the numbers it prints, as every pick is), and the preferred pick is taken
 * only when its printed Helps you is at least the usual pick's less config.offers.preferWithinHelps (3); otherwise the usual
 * pick. When only preferred versions meet the step's rules the usual pick is the best of them anyway (no usual pick: the
 * preferred one). ⚠️ The lead's ruling: Helps you as printed at every step, the Last offer's too (whose own order is by
 * Overall). The rest of the preference stays (leaves only, the cross-list guard, the preferring ladder kept only when it
 * holds more of them, fixed per card, carried to the worker's fallback).
 *
 * The promoted card's Open (Checkpoint 7h; planner reply to Checkpoint 7g, answer 3: "When an offer list finds a version with
 * a higher Overall than the idea it sits under: that version becomes the idea; the original becomes its "Open with" step, the
 * bigger ask."; search.ts, "Promoted Last offers"): a search's card promoted from another card's Last offer carries that card's
 * key (LadderJob.open), and its ladder opens with it whatever the Open's rule (and the narrowing) would pick (forcedOpenSteps;
 * OfferStep.original): its exact evaluation and its numbers on the card's block (the store's, known already), held to every
 * rule of an Open but its least chance (forcedOpenOk: it can print under config.offers.openMinChance, ⚠️ never under the
 * user's minimum chance, as a card of the list never did), which hold by construction (it printed the higher B, and a chance
 * at least minAcceptGain under its Last offer's) but for "Helps both" (search.ts promotes only when forcedOpenOk holds). The
 * Thens and the Last offer follow by the usual rules, after it. When the idea can't be read or evaluated, the Open's own rule
 * picks, as without it. The worker's fallback carries it (ProposalLadderOptions.open, TradeSearchResult.offerOpen); the Trade
 * Analyzer's card never has one (the user built that trade).
 *
 * Each step carries its own evaluation (OfferStep.evaluation: its proposal in its own order, its printed numbers, its roster
 * moves and its words, evaluate.ts withWords), and its message: the first step's pitch (explain.ts: what the partner gains,
 * then the trade), each later step's a follow-up naming its version, Plan B's template (tradeView.ts planBPitch: "Thanks for
 * considering it! Would you trade … for … instead? Let me know what you think!"). The card's own evaluation is the
 * suggested step's (without its Plan B). A card that doesn't help me, is hidden by the market guard, or whose context stops
 * the search (no team, no odds, the deadline passed, …) gets the suggested trade alone.
 */
import { displayAcceptance } from "./acceptance";
import { helpsBoth, overallUnrounded } from "./benefit";
import { config } from "./config";
import {
  addCandidates,
  coreInOrder,
  evaluateExact,
  explainContextOf,
  lastOfferVersions,
  proposalKey,
  quickScreen,
  rewardFor,
  simulateTrade,
  stepConfig,
  throwIns,
  tradeInternals,
  tradeVersion,
  withWords,
  type SimStage,
  type TradeContext,
  type TradeInternals,
  type TradeVersion,
} from "./evaluate";
import { getPoolOf, searchStateOf, sidesOf, type SearchState } from "./search";
import { normalizeTradeSettings, type TradeSettings } from "./settings";
import type { OfferLadder, OfferStep, OfferStepKind, TradeAsset, TradeEvaluation, TradeEvaluationCore, TradeProposal, TradeSearchResult } from "./tradeModel";

/** Float noise in comparisons (not a tunable). */
const EPS = 1e-9;

/** A ladder's options: a clock for OfferLadder.ms (none: no timing). */
export interface LadderOptions {
  clock?: () => number;
}

/** Where a ladder's numbers live and are kept (per search, or per context and settings: the file header). */
export interface LadderStore {
  /** Versions on the screening block by key (a search's own exact trades among them: SearchState.versions). */
  versions: Map<string, TradeVersion>;
  /** Printed numbers the ladder made, by key. */
  printed: Map<string, TradeEvaluationCore>;
  /** Printed numbers made elsewhere (a search's cards and boxes: SearchState.shownByKey), read only. */
  known?: ReadonlyMap<string, TradeEvaluationCore>;
  /**
   * Checkpoint 7f: a search's ladder choices by the minimum chance they were worked out for and the card (searchLadderChoiceSteps;
   * shared with its re-filters, which change only the minimum). Absent for a context's store (offerLadderOfProposal).
   */
  choices?: Map<string, LadderChoice | null>;
  /**
   * Checkpoint 7h (the promotion's cost; searchLastOfferSteps): a search's Last offers worked out alone, by the key its whole
   * ladder's choice has (choiceKey), shared with its re-filters like `choices`. Absent for a context's store.
   */
  lasts?: Map<string, LastOfferChoice | null>;
}

/** What a ladder is built from (ladderJobOfSearch, ladderJobOfProposal). */
export interface LadderJob {
  I: TradeInternals;
  /** The card as printed, with its words (its Plan B and steps left out). */
  card: TradeEvaluation;
  /** The card's version: its exact evaluation and its numbers on the screening block; null when it has none. */
  cardVersion: TradeVersion | null;
  /** The settings the card's numbers were made with (the search's, or the Analyzer call's), normalized. */
  settings: TradeSettings;
  /** The variants' get sides hold 1 to this many players (settings.maxPerSide). */
  variantsMax: number;
  /** The per-side limit legality and the Last offer read: the search's maxPerSide, the Analyzer's analyzerMaxPerSide. */
  legalMax: number;
  /** The partner's get pool H (its must-include players last) and its must-include players. */
  pool: readonly string[];
  forcedGet: readonly string[];
  store: LadderStore;
  /** The block the card prints from ("shown"; the ranking block's "final" when the search prints its ranking numbers). */
  printed: SimStage;
  /**
   * Checkpoint 7g (planner reply to Checkpoint 7f, answer 3(a); the file header, "4. Last offer"): whether the Last offer can
   * be a smaller ask. The app's always can; false (a search's report and test switch, TradeSearchOptions.smallerAsks, or
   * ProposalLadderOptions.smallerAsks) gives Checkpoint 7f's Last offer, the throw-in alone.
   */
  smallerAsks: boolean;
  /**
   * Checkpoint 7g (answer 3(b); the file header, "Preferring the cards of its lists"): the versions, by key, this card's ladder
   * prefers (search.ts preferredOf: cards of its lists the merge could fold into it). Absent or empty: none.
   */
  prefer?: ReadonlySet<string>;
  /**
   * Checkpoint 7h (planner reply to Checkpoint 7g, answer 3; the file header, "The promoted card's Open"): the key of the version
   * this card's ladder opens with whatever the Open's rule would pick, the idea it was promoted from (search.ts, "Promoted Last
   * offers"). Absent: none.
   */
  open?: string;
}

/** A candidate version of the card (ladderCandidates): a variant (another get side) or the lean version. */
export interface LadderCandidate {
  kind: "variant" | "lean";
  key: string;
  proposal: TradeProposal;
}

const playerIds = (xs: readonly TradeAsset[]): string[] => xs.flatMap((a) => (a.kind === "player" ? [a.id] : []));
const players = (ids: readonly string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));

/**
 * The proposal a trade key names (evaluate.ts proposalKey: `${partnerId}|give:${ids}|get:${ids}`, each side's player ids
 * sorted), or null when the key doesn't read as one (a pick, an empty partner, a side that isn't listed).
 */
export function proposalFromKey(key: string): TradeProposal | null {
  const m = /^([^|]+)\|give:([^|]*)\|get:([^|]*)$/.exec(key);
  if (!m) return null;
  const ids = (s: string | undefined) => (s ? s.split(",").filter((x) => x.length > 0) : []);
  const give = ids(m[2]);
  const get = ids(m[3]);
  if ([...give, ...get].some((id) => id.startsWith("pick:"))) return null;
  return { partnerId: m[1] as string, give: players(give), get: players(get) };
}

/** A card of a search's result by its key (either list), or null. */
function cardOf(result: TradeSearchResult, key: string): TradeEvaluation | null {
  return result.trades.find((t) => t.key === key) ?? result.helpsBoth?.trades.find((t) => t.key === key) ?? null;
}

/** A card's evaluation without its Plan B and steps (the suggested step's: the card shows its Plan B itself). */
function bareCard(card: TradeEvaluation): TradeEvaluation {
  const { planB: _planB, steps: _steps, ...rest } = card;
  void _planB;
  void _steps;
  return rest;
}

// ---------------------------------------------------------------------------------------------
// The rules (the file header), on one set of numbers

/** The chance a version prints (P_complete, the nearest 5%: acceptance.displayAcceptance). */
const chanceOf = (e: Pick<TradeEvaluationCore, "pComplete">): number => displayAcceptance(e.pComplete);

/** Its Helps you as printed (null when not a number). */
const helpsOf = (e: Pick<TradeEvaluationCore, "tradeScore">): number | null => (typeof e.tradeScore === "number" && Number.isFinite(e.tradeScore) ? e.tradeScore : null);

/** Every step's own rules (the file header): legal, B > 0 and Helps you above 0, not hidden by the market guard, and helping both under a card tagged "Helps both". */
function stepPasses(e: TradeEvaluationCore, tagged: boolean): boolean {
  if (e.illegal !== null) return false;
  if (e.b === null || !Number.isFinite(e.b) || !(e.b > 0)) return false;
  const hy = helpsOf(e);
  if (hy === null || !(hy > 0)) return false;
  if (e.flags.hiddenByMarket) return false;
  return !tagged || helpsBoth(e);
}

/** The chance window of an Open or a Then (the file header): at least `low` and at least minAcceptGain below the card's. */
function inWindow(e: TradeEvaluationCore, low: number, card: TradeEvaluationCore): boolean {
  const c = chanceOf(e);
  return c >= low - EPS && c <= chanceOf(card) - config.search.steps.minAcceptGain + EPS;
}

/** Its B (null when not a number). */
const bOf = (e: Pick<TradeEvaluationCore, "b">): number | null => (typeof e.b === "number" && Number.isFinite(e.b) ? e.b : null);

/** Helps you between the card's and, after a step (`step`; null: none), that step's, as each prints it (the screening block's pre-filter). */
function helpsBetween(e: TradeEvaluationCore, card: TradeEvaluationCore, step: TradeEvaluationCore | null): boolean {
  const hy = helpsOf(e);
  const floor = helpsOf(card);
  if (hy === null || floor === null || hy < floor) return false;
  if (step === null) return true;
  const ceiling = helpsOf(step);
  return ceiling !== null && hy <= ceiling;
}

/**
 * Better for me than the card and, after a step, less good than that step, on the numbers they print (the file header):
 * helpsBetween, and ⚠️ B strictly between theirs (the final review of Checkpoint 7e, ENG-7E-1: Helps you is rounded and
 * flattens near 100, so two versions printing the same Helps you can rank either way on B, and an Open printing the card's
 * Helps you at a lower B was the worse deal sent first; an equal B is no better). On one block, one B₃: a higher B never
 * prints a lower Helps you, so the two agree wherever Helps you differs. ⚠️ On the printed numbers only: the screening
 * block's 1,000 seasons tie or turn round versions a hair apart, and holding them to it there turned down Opens and Thens
 * that print better than their card (on synthetic leagues, as for the Last offer's rule below).
 */
function betweenForMe(e: TradeEvaluationCore, card: TradeEvaluationCore, step: TradeEvaluationCore | null): boolean {
  if (!helpsBetween(e, card, step)) return false;
  const b = bOf(e);
  const bCard = bOf(card);
  if (b === null || bCard === null || !(b > bCard + EPS)) return false;
  if (step === null) return true;
  const bStep = bOf(step);
  return bStep !== null && b < bStep - EPS;
}

/** The Open's least chance (the file header): config.offers.openMinChance, or the user's minimum chance when that's higher. */
export function openBar(minChance: number): number {
  const own = config.offers.openMinChance;
  return Number.isFinite(minChance) && minChance > own ? minChance : own;
}

/** Highest Helps you first, then the higher chance, then the key (the file header). */
function byHelps(a: TradeEvaluationCore, b: TradeEvaluationCore): number {
  const ha = helpsOf(a) ?? Number.NEGATIVE_INFINITY;
  const hb = helpsOf(b) ?? Number.NEGATIVE_INFINITY;
  if (ha !== hb) return hb - ha;
  const ca = chanceOf(a);
  const cb = chanceOf(b);
  if (Math.abs(ca - cb) > EPS) return cb - ca;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Whether a card `n` of the list can be an offer of the card `k` on the numbers both print (Checkpoint 7f; search.ts, "Merged
 * cards": the merge works out a ladder only for a card one of whose ladderNeighbors passes it): a necessary condition, every
 * rule of the file header an offer of that kind holds on its printed numbers, which an offer that is a card prints (the
 * ladder reads the search's own). "earlier", an Open or a Then (a variant or the lean version): it helps me, passes the
 * market guard and, under a `k` tagged "Helps both", helps both; it prints a chance of at least the Open's bar for
 * `minChance` (a Then's is higher still) and at least minAcceptGain under `k`'s, and a Helps you at least `k`'s at a higher B.
 * "last", the Last offer (`k` plus a throw-in): the same first rules, a chance at least minAcceptGain above `k`'s, a B under
 * `k`'s but at least minBShare of it, and a Helps you at most `k`'s. "smaller" (Checkpoint 7g: a smaller ask's Last offer,
 * the file header): the same first rules, a chance at least minAcceptGain above `k`'s, a B under `k`'s and a Helps you at most
 * `k`'s, and an unrounded Overall at least config.offers.lastMinOverallShare of `k`'s (overallShareOk).
 */
export function offerFeasible(k: TradeEvaluationCore, n: TradeEvaluationCore, kind: "earlier" | "last" | "smaller", minChance: number): boolean {
  if (!stepPasses(n, helpsBoth(k))) return false;
  if (kind === "earlier") return inWindow(n, openBar(minChance), k) && betweenForMe(n, k, null);
  const hn = helpsOf(n);
  const hk = helpsOf(k);
  const bn = bOf(n);
  const bk = bOf(k);
  if (hn === null || hk === null || bn === null || bk === null) return false;
  const lastRules = chanceOf(n) >= chanceOf(k) + config.search.steps.minAcceptGain - EPS && bn < bk - EPS && hn <= hk;
  if (kind === "smaller") return lastRules && overallShareOk(n, k);
  return lastRules && bn >= config.search.steps.minBShare * bk - EPS;
}

/**
 * A version's Overall before it's rounded (Checkpoint 7g; the file header, "4. Last offer"): 100 × (1 − e^(−B × P_complete /
 * B₃)) on its own numbers (benefit.ts overallUnrounded, what its printed Overall rounds); null without a B above 0 or a B₃.
 */
export function overallOf(e: Pick<TradeEvaluationCore, "b" | "pComplete" | "b3">): number | null {
  return overallUnrounded(e.b, e.pComplete, e.b3);
}

/**
 * Whether `n` keeps at least `share` (config.offers.lastMinOverallShare) of `card`'s Overall, both unrounded (overallOf; the
 * planner: "keep at least 80% of the suggested trade's Overall"); false when either has none.
 */
export function overallShareOk(n: Pick<TradeEvaluationCore, "b" | "pComplete" | "b3">, card: Pick<TradeEvaluationCore, "b" | "pComplete" | "b3">, share: number = config.offers.lastMinOverallShare): boolean {
  const on = overallOf(n);
  const oc = overallOf(card);
  return on !== null && oc !== null && Number.isFinite(share) && on >= share * oc - EPS;
}

// ---------------------------------------------------------------------------------------------
// Numbers

/** A version of `proposal` with its numbers on the screening block (null: illegal), the store's when known. */
function versionOf(job: LadderJob, proposal: TradeProposal): TradeVersion | null {
  return tradeVersion(job.I, proposal, { settings: job.settings, maxPerSide: job.legalMax, versions: job.store.versions });
}

/** The numbers a version prints (the card's block: LadderJob.printed), simulated once per key and kept (LadderStore). */
export function printedOf(job: LadderJob, v: TradeVersion): TradeEvaluationCore {
  const key = v.screen.key;
  const known = job.store.printed.get(key) ?? job.store.known?.get(key);
  if (known) return known;
  const s = job.settings;
  const core = simulateTrade(job.I, v.x, job.printed, s.lambda, s.protectValue, rewardFor(job.I, s));
  job.store.printed.set(key, core);
  return core;
}

/**
 * The card's candidate versions (the file header, "The candidates"): every variant, in order of size then H's order, then the
 * lean version; never the card, each key once.
 */
export function ladderCandidates(job: LadderJob): LadderCandidate[] {
  const { card } = job;
  const proposal = card.proposal;
  if ([...proposal.give, ...proposal.get].some((a) => a.kind !== "player")) return [];
  const give = playerIds(proposal.give);
  const cardGet = playerIds(proposal.get);
  const pool = [...new Set([...job.pool, ...cardGet])];
  const forced = job.forcedGet.filter((id) => cardGet.includes(id));
  const free = pool.filter((id) => !forced.includes(id));
  const seen = new Set<string>([card.key]);
  const out: LadderCandidate[] = [];
  const add = (kind: LadderCandidate["kind"], p: TradeProposal) => {
    const key = proposalKey(p);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, key, proposal: p });
  };
  const most = Math.max(0, Math.floor(job.variantsMax));
  for (let size = 1; size <= most; size++) {
    for (const get of sidesOf(forced, free, size)) add("variant", { partnerId: proposal.partnerId, give: players(give), get: players(get) });
  }
  // The lean version: without my lowest-value throw-in in the trade, my side keeping a player.
  const mine = throwIns(job.I, job.settings).filter((id) => give.includes(id));
  if (mine.length > 0 && give.length >= 2) add("lean", { partnerId: proposal.partnerId, give: players(give.filter((id) => id !== mine[0])), get: players(cardGet) });
  return out;
}

/**
 * The card's smaller asks (Checkpoint 7g; the file header, "The candidates"), the Last offer's own candidates: the card's own
 * players of mine (in its order) for each proper, non-empty part of its players of theirs (in the card's order), the larger
 * parts first, each holding the partner's must-include players the card holds; players only, never the card, none for a
 * one-player get side. Each is a variant too (kind "variant": the same trade, an Open's or a Then's candidate by its chance).
 */
export function smallerAsks(job: Pick<LadderJob, "card" | "forcedGet">): LadderCandidate[] {
  const proposal = job.card.proposal;
  if ([...proposal.give, ...proposal.get].some((a) => a.kind !== "player")) return [];
  const give = playerIds(proposal.give);
  const get = playerIds(proposal.get);
  const forced = job.forcedGet.filter((id) => get.includes(id));
  const out: LadderCandidate[] = [];
  const seen = new Set<string>([job.card.key]);
  for (let size = get.length - 1; size >= 1; size--) {
    for (const part of partsOf(get, size)) {
      if (!forced.every((id) => part.includes(id))) continue;
      const p: TradeProposal = { partnerId: proposal.partnerId, give: players(give), get: players(part) };
      const key = proposalKey(p);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: "variant", key, proposal: p });
    }
  }
  return out;
}

/** Every part of `xs` of exactly `size` members, each in `xs`'s order, in lexicographic order of their places. */
function partsOf(xs: readonly string[], size: number): string[][] {
  if (size === 0) return [[]];
  if (xs.length < size) return [];
  const [head, ...rest] = xs as [string, ...string[]];
  return [...partsOf(rest, size - 1).map((t) => [head, ...t]), ...partsOf(rest, size)];
}

/**
 * The candidates the ladder evaluates exactly (the file header, "The pre-screen"): ladderCandidates' whose quick estimate of
 * the chance (evaluate.ts quickScreen) lies in [the Open's bar − config.offers.preScreenMargin, the card's own quick estimate −
 * minAcceptGain + preScreenMargin] (the card's printed chance when the fast method turns the card itself down), the most my
 * EV lineup gains first (ties: the key), at most config.offers.preScreenMax; none the fast method turns down. `all`:
 * ladderCandidates(job) when the caller has them.
 */
export function preScreened(job: LadderJob, all: readonly LadderCandidate[] = ladderCandidates(job)): LadderCandidate[] {
  return ranOut(preScreenSteps(job, all));
}

/** Quick estimates between two yields of the pre-screen (config.search: responsiveness, as the screening's). */
const SCREEN_BATCH = Math.max(1, Math.floor(config.search.yieldEveryScreens));

/** preScreened as a generator (ladderChoiceSteps): it yields after every SCREEN_BATCH quick estimates. */
function* preScreenSteps(job: LadderJob, all: readonly LadderCandidate[]): Generator<void, LadderCandidate[], void> {
  const { I, card } = job;
  const partner = I.byId.get(card.proposal.partnerId);
  if (!partner || !I.me) return [];
  const margin = Number.isFinite(config.offers.preScreenMargin) ? Math.max(0, config.offers.preScreenMargin) : 0;
  const most = Number.isFinite(config.offers.preScreenMax) ? Math.max(0, Math.floor(config.offers.preScreenMax)) : all.length;
  const own = quickScreen(I, partner, playerIds(card.proposal.give), playerIds(card.proposal.get));
  const low = openBar(job.settings.minChance) - margin;
  const high = (own ? own.pComplete : card.pComplete) - config.search.steps.minAcceptGain + margin;
  const kept: { c: LadderCandidate; gain: number }[] = [];
  let screens = 0;
  for (const c of all) {
    if (++screens % SCREEN_BATCH === 0) yield;
    const q = quickScreen(I, partner, playerIds(c.proposal.give), playerIds(c.proposal.get));
    if (!q || q.pComplete < low - EPS || q.pComplete > high + EPS) continue;
    kept.push({ c, gain: q.myDelta });
  }
  kept.sort((a, b) => (Math.abs(b.gain - a.gain) > EPS ? b.gain - a.gain : a.c.key < b.c.key ? -1 : a.c.key > b.c.key ? 1 : 0));
  return kept.slice(0, most).map((x) => x.c);
}

/** A generator run to its end on the calling thread (the ladder's steps, when nothing waits on them). */
function ranOut<T>(it: Generator<void, T, void>): T {
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

// ---------------------------------------------------------------------------------------------
// The ladder

/** A candidate with its numbers on the screening block. */
interface Screened {
  candidate: LadderCandidate;
  version: TradeVersion;
}

/** versionOf, yielding first when it makes a new exact evaluation (ladderChoiceSteps). */
function* versionSteps(job: LadderJob, proposal: TradeProposal): Generator<void, TradeVersion | null, void> {
  if (!job.store.versions.has(proposalKey(proposal))) yield;
  return versionOf(job, proposal);
}

/** printedOf, yielding first when it makes a new run on the printed block (ladderChoiceSteps). */
function* printedSteps(job: LadderJob, v: TradeVersion): Generator<void, TradeEvaluationCore, void> {
  const key = v.screen.key;
  if (!job.store.printed.has(key) && !job.store.known?.has(key)) yield;
  return printedOf(job, v);
}

/**
 * The first of `ordered` whose printed numbers pass `ok`, trying at most config.offers.tries of them on the printed block
 * (the file header): the version and its printed numbers, or null.
 */
function* firstPrinted(job: LadderJob, ordered: readonly Screened[], ok: (printed: TradeEvaluationCore) => boolean): Generator<void, { s: Screened; printed: TradeEvaluationCore } | null, void> {
  return yield* firstPrintedOf(job, ordered, ok, Math.max(0, Math.floor(config.offers.tries)));
}

/** firstPrinted with its own bound on the candidates tried (Checkpoint 7g: a preferred version is tried whatever config.offers.tries says). */
function* firstPrintedOf(job: LadderJob, ordered: readonly Screened[], ok: (printed: TradeEvaluationCore) => boolean, tries: number): Generator<void, { s: Screened; printed: TradeEvaluationCore } | null, void> {
  let tried = 0;
  for (const s of ordered) {
    if (tried >= tries) break;
    tried++;
    const printed = yield* printedSteps(job, s.version);
    if (ok(printed)) return { s, printed };
  }
  return null;
}

/**
 * The trades the Last offer's rule evaluates (evaluate.ts lastOfferVersions: the card plus each throw-in its pre-screen keeps,
 * when the card helps me on the screening block, holds only players and my side has room), so ladderChoiceSteps can make
 * their exact evaluations one at a time first; lastOfferVersions then finds them in the store.
 */
function lastOfferProposals(job: LadderJob): TradeProposal[] {
  const card = job.cardVersion;
  if (!card || !job.I.me) return [];
  const proposal = card.screen.proposal;
  if ([...proposal.give, ...proposal.get].some((a) => a.kind !== "player")) return [];
  const give = playerIds(proposal.give);
  const get = playerIds(proposal.get);
  const b = card.screen.b;
  if (b === null || !Number.isFinite(b) || !(b > 0) || give.length + 1 > job.legalMax) return [];
  return addCandidates(job.I, proposal, throwIns(job.I, job.settings), stepConfig()).map((id) => ({ partnerId: proposal.partnerId, give: players([...give, id]), get: players(get) }));
}

/** "Thanks for considering it! Would you trade … for … instead? Let me know what you think!" (the file header). */
function followUp(I: TradeInternals, p: Pick<TradeProposal, "give" | "get">): string {
  const ctx = explainContextOf(I);
  const nameOf = (a: TradeAsset) => (a.kind === "player" ? (ctx.player(a.id)?.name ?? a.id) : `${a.season} round ${a.round} pick`);
  const names = (xs: readonly TradeAsset[]) => {
    const ns = xs.map(nameOf);
    return ns.length <= 1 ? (ns[0] ?? "") : `${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`;
  };
  let ask = "";
  if (p.give.length && p.get.length) ask = `Would you trade ${names(p.get)} for ${names(p.give)} instead?`;
  else if (p.get.length) ask = `Would you send me ${names(p.get)} instead?`;
  else if (p.give.length) ask = `Would you take ${names(p.give)} instead, with nothing needed back?`;
  return ["Thanks for considering it!", ask, "Let me know what you think!"].filter((s) => s.length > 0).join(" ");
}

/**
 * A step's evaluation: its printed numbers with its words, its players in its own order (the candidate's), and since
 * Checkpoint 7f (the review of the merge, MERGE-4) its per-player facts in that order too (evaluate.ts coreInOrder: printed
 * numbers the search made, a card's or a box's, list them in the search's order), so a ladder the search kept is the one
 * worked out on demand and the worker's fallback, deep-equal.
 */
function stepEvaluation(job: LadderJob, printed: TradeEvaluationCore, proposal: TradeProposal): TradeEvaluation {
  return withWords(job.I, coreInOrder(printed, proposal));
}

/**
 * The Last offer a ladder chose (the file header, "4. Last offer"): the card plus a throw-in (`add`, the player of mine it
 * adds), or since Checkpoint 7g a smaller ask; its proposal and its printed numbers.
 */
export type LastOfferChoice = { kind: "throwIn"; add: string; proposal: TradeProposal; printed: TradeEvaluationCore } | { kind: "smaller"; proposal: TradeProposal; printed: TradeEvaluationCore };

/** The ladder's chosen versions before their words (buildOfferLadder; the report reads them too). */
export interface LadderChoice {
  /** `forced` (Checkpoint 7h): the promoted card's Open, the idea it was promoted from (LadderJob.open), not the Open's rule's pick. */
  open: { candidate: LadderCandidate; printed: TradeEvaluationCore; forced?: true } | null;
  thens: { candidate: LadderCandidate; printed: TradeEvaluationCore }[];
  last: LastOfferChoice | null;
  /** Every candidate the pre-screen let through that's legal, with its numbers on the screening block (the report's). */
  screened: { candidate: LadderCandidate; screen: TradeEvaluationCore }[];
  /** How many candidates there were before the pre-screen (ladderCandidates; the report's). */
  candidates: number;
  /**
   * Checkpoint 7g (the file header, "Preferring the cards of its lists"): true when this is the preferring ladder, kept over
   * the usual one because it holds more of the card's preferred versions (the report names those ladders); absent otherwise.
   */
  preferred?: true;
}

/** ladderChoice's options: `every`, every candidate evaluated exactly (no pre-screen: a report's switch, preScreened). */
export interface LadderChoiceOptions {
  every?: boolean;
}

/**
 * How a ladder of at most `maxSteps` offers shares its places (the file header): the suggested trade first, then Open when
 * there is one, then the Last offer when there is one and room is left, then as many Thens as fit; no Then without an Open.
 */
export function ladderRoom(maxSteps: number, open: boolean, last: boolean): { open: boolean; last: boolean; thens: number } {
  let room = Math.max(1, Math.floor(maxSteps)) - 1;
  const openFits = open && room > 0;
  if (openFits) room--;
  const lastFits = last && room > 0;
  if (lastFits) room--;
  return { open: openFits, last: lastFits, thens: openFits ? room : 0 };
}

/** Whether a card gets offers at all (the file header): my team and odds, a context that doesn't stop the search, B > 0, not hidden. */
function offersApply(job: LadderJob): boolean {
  const { I, card } = job;
  return !!I.me && !!I.sim && !I.blocked && card.b !== null && Number.isFinite(card.b) && card.b > 0 && !card.flags.hiddenByMarket && job.cardVersion !== null;
}

/** The ladder's choices (the file header, "The rules"), or null when the card gets the suggested trade alone. */
export function ladderChoice(job: LadderJob, opts: LadderChoiceOptions = {}): LadderChoice | null {
  return ranOut(ladderChoiceSteps(job, opts));
}

/**
 * ladderChoice as a generator (Checkpoint 7f: the search works ladders out for the merge, search.ts "Merged cards"), the same
 * choices: it yields before each exact evaluation and each run on the printed block it makes (one of the store doesn't hold
 * yet), and every SCREEN_BATCH quick estimates of the pre-screen, so no slice of the search holds more than one of them (a
 * ladder takes up to about 100 ms on Parker's leagues, 200 ms searching one team, against the search's 40 ms slices).
 */
export function* ladderChoiceSteps(job: LadderJob, opts: LadderChoiceOptions = {}): Generator<void, LadderChoice | null, void> {
  if (!offersApply(job)) return null;
  const usual = yield* choiceSteps(job, opts, null);
  // Checkpoint 7g (the file header, "Preferring the cards of its lists"): with a preference, the preferring ladder too, kept
  // only when it holds more of the preferred versions than the usual one ("so it merges").
  const prefer = job.prefer;
  if (!prefer || prefer.size === 0) return usual;
  const preferring = yield* choiceSteps(job, opts, prefer);
  return heldOf(preferring, prefer) > heldOf(usual, prefer) ? { ...preferring, preferred: true } : usual;
}

/** How many of a choice's offers (Open, Thens, the Last offer) `prefer` holds (ladderChoiceSteps). */
export function heldOf(choice: LadderChoice | null, prefer: ReadonlySet<string>): number {
  return choiceOffers(choice).filter((o) => prefer.has(o.key)).length;
}

/**
 * Both of a card's ladders before ladderChoiceSteps keeps one (Checkpoint 7g; the file header, "Preferring the cards of its
 * lists"): the usual one, and the preferring one when the card has a preference (else null); null for both when the card gets
 * the suggested trade alone. For tests and reports: the app reads ladderChoiceSteps.
 */
export function ladderChoicesOf(job: LadderJob, opts: LadderChoiceOptions = {}): { usual: LadderChoice | null; preferring: LadderChoice | null } {
  if (!offersApply(job)) return { usual: null, preferring: null };
  const usual = ranOut(choiceSteps(job, opts, null));
  const preferring = job.prefer && job.prefer.size ? ranOut(choiceSteps(job, opts, job.prefer)) : null;
  return { usual, preferring };
}

/**
 * One ladder's choices (ladderChoiceSteps): as usual (`prefer` null), or preferring `prefer`'s versions at each step (the file
 * header, "Preferring the cards of its lists").
 */
function* choiceSteps(job: LadderJob, opts: LadderChoiceOptions, prefer: ReadonlySet<string> | null): Generator<void, LadderChoice, void> {
  const card = job.card;
  const cardScreen = (job.cardVersion as TradeVersion).screen;
  const tagged = helpsBoth(card);
  const gain = config.search.steps.minAcceptGain;
  const maxSteps = Math.max(1, Math.floor(config.offers.maxSteps));

  // The Last offer (the file header, "4. Last offer").
  let last = yield* lastOfferSteps(job, tagged, prefer);

  // The candidates the pre-screen lets through (the file header, "The pre-screen"), on the screening block.
  const all = ladderCandidates(job);
  const considered = opts.every ? all : yield* preScreenSteps(job, all);
  const screened: Screened[] = [];
  for (const c of considered) {
    const v = yield* versionSteps(job, c.proposal);
    if (v) screened.push({ candidate: c, version: v });
  }
  const passing = screened.filter((s) => stepPasses(s.version.screen, tagged) && helpsBetween(s.version.screen, cardScreen, null));
  const bar = openBar(job.settings.minChance);

  // Open: since Checkpoint 7h a promoted card's is the idea it was promoted from (forcedOpenSteps; the file header, "The promoted
  // card's Open"); else the Open's rule (preferring: the preferred candidates that pass first, narrowed: narrowedPick).
  const openOk = (p: TradeEvaluationCore) => stepPasses(p, tagged) && inWindow(p, bar, card) && betweenForMe(p, card, null);
  const openPool = passing.filter((s) => inWindow(s.version.screen, bar, card)).sort((a, b) => byHelps(a.version.screen, b.version.screen));
  let openHit = job.open ? yield* forcedOpenSteps(job, all) : null;
  const forced = openHit !== null;
  if (!openHit) {
    const listed = prefer ? yield* listedFirst(job, all, prefer, new Set(), openOk) : null;
    openHit = listed ? narrowedPick(listed, yield* firstPrinted(job, openPool, openOk)) : yield* firstPrinted(job, openPool, openOk);
  }
  let open: LadderChoice["open"] = openHit ? { candidate: openHit.s.candidate, printed: openHit.printed, ...(forced ? { forced: true as const } : {}) } : null;

  // Room: the suggested trade, then Open, then the Last offer, then as many Thens as fit.
  const room = ladderRoom(maxSteps, open !== null, last !== null);
  if (!room.open) open = null;
  if (!room.last) last = null;
  let thensLeft = room.thens;

  // Then, after the step before (preferring: the preferred candidates that pass first, narrowed: narrowedPick).
  const thens: LadderChoice["thens"] = [];
  let prev: { screen: TradeEvaluationCore; printed: TradeEvaluationCore } | null = open && openHit ? { screen: openHit.s.version.screen, printed: openHit.printed } : null;
  const used = new Set<string>(open ? [open.candidate.key] : []);
  while (prev && thensLeft > 0) {
    const before = prev;
    const thenOk = (p: TradeEvaluationCore) => stepPasses(p, tagged) && inWindow(p, chanceOf(before.printed) + gain, card) && betweenForMe(p, card, before.printed);
    const pool = passing
      .filter((s) => !used.has(s.candidate.key))
      .filter((s) => inWindow(s.version.screen, chanceOf(before.screen) + gain, card) && helpsBetween(s.version.screen, cardScreen, before.screen))
      .sort((a, b) => byHelps(a.version.screen, b.version.screen));
    const listed = prefer ? yield* listedFirst(job, all, prefer, used, thenOk) : null;
    const hit = listed ? narrowedPick(listed, yield* firstPrinted(job, pool, thenOk)) : yield* firstPrinted(job, pool, thenOk);
    if (!hit) break;
    thens.push({ candidate: hit.s.candidate, printed: hit.printed });
    used.add(hit.s.candidate.key);
    prev = { screen: hit.s.version.screen, printed: hit.printed };
    thensLeft--;
  }
  return { open, thens, last, screened: screened.map((s) => ({ candidate: s.candidate, screen: s.version.screen })), candidates: all.length };
}

/**
 * The first of the card's preferred candidates (`all`'s that `prefer` holds and `used` doesn't) whose printed numbers pass `ok`,
 * in an Open's or a Then's own order (byHelps on the screening block: Helps you, then the chance, then the key), every one
 * tried, past the pre-screen and config.offers.tries (the file header, "Preferring the cards of its lists"), or null.
 */
function* listedFirst(job: LadderJob, all: readonly LadderCandidate[], prefer: ReadonlySet<string>, used: ReadonlySet<string>, ok: (printed: TradeEvaluationCore) => boolean): Generator<void, { s: Screened; printed: TradeEvaluationCore } | null, void> {
  const listed: Screened[] = [];
  for (const c of all) {
    if (!prefer.has(c.key) || used.has(c.key)) continue;
    const v = yield* versionSteps(job, c.proposal);
    if (v) listed.push({ candidate: c, version: v });
  }
  listed.sort((a, b) => byHelps(a.version.screen, b.version.screen));
  return yield* firstPrintedOf(job, listed, ok, Number.POSITIVE_INFINITY);
}

/** EG on a version's numbers (B × P_complete; −∞ without B): the order of Overall on one block (one B₃). */
const egOf = (e: Pick<TradeEvaluationCore, "b" | "pComplete">): number => {
  const b = bOf(e);
  return b === null ? Number.NEGATIVE_INFINITY : b * e.pComplete;
};

/** The higher Overall first (EG on the screening block), then the key: a smaller ask's order (the file header, "4. Last offer"). */
const byOverallThenKey = (a: Screened, b: Screened): number => {
  const ea = egOf(a.version.screen);
  const eb = egOf(b.version.screen);
  if (ea !== eb && !(Math.abs(eb - ea) <= EPS)) return eb > ea ? 1 : -1;
  return a.candidate.key < b.candidate.key ? -1 : a.candidate.key > b.candidate.key ? 1 : 0;
};

/** Of a throw-in Last offer and a smaller ask's, the one that prints the higher Overall (EG: one block, one B₃); a tie: the throw-in (the lead's call, D6). */
export function higherOverall(throwIn: LastOfferChoice | null, smaller: LastOfferChoice | null): LastOfferChoice | null {
  if (!smaller) return throwIn;
  if (!throwIn) return smaller;
  return egOf(smaller.printed) > egOf(throwIn.printed) + EPS ? smaller : throwIn;
}

/**
 * The Last offer (the file header, "4. Last offer"): the throw-in's own pick and (Checkpoint 7g, LadderJob.smallerAsks) a
 * smaller ask's, each the first of its kind whose printed numbers pass its rules within config.offers.tries, then the one that
 * prints the higher Overall (higherOverall). Preferring (`prefer`): the preferred versions of each kind first, every one tried
 * (a throw-in: every throw-in of mine the card doesn't give, within the per-side limit, in the throw-in's own order: the
 * highest P_complete on the screening block first, then B, then the id; a smaller ask in its own order), the higher Overall
 * of the two; with none of them passing, the usual pick. Printed: ⚠️ never a higher Helps you than the suggested trade's, nor
 * ⚠️ a B as high (the final review of Checkpoint 7e, ENG-7E-1: printing the card's own Helps you at a higher B, it was the
 * better deal and likelier), judged on the printed numbers only (the card plus a cheap throw-in is often a hair from the card
 * on Helps you, and the screening block's 1,000 seasons turned down Last offers that print the card's own Helps you).
 */
function* lastOfferSteps(job: LadderJob, tagged: boolean, prefer: ReadonlySet<string> | null): Generator<void, LastOfferChoice | null, void> {
  const card = job.card;
  const cardScreen = (job.cardVersion as TradeVersion).screen;
  const gain = config.search.steps.minAcceptGain;
  const tries = Math.max(0, Math.floor(config.offers.tries));
  const notAbove = (n: TradeEvaluationCore) => {
    const hn = helpsOf(n);
    const hb = helpsOf(card);
    const bn = bOf(n);
    const bc = bOf(card);
    return hn !== null && hb !== null && hn <= hb && bn !== null && bc !== null && bn < bc - EPS;
  };
  const likelier = (n: TradeEvaluationCore) => chanceOf(n) >= chanceOf(card) + gain - EPS;
  const throwInRule = (n: TradeEvaluationCore, base: TradeEvaluationCore) => stepPasses(n, tagged) && likelier(n) && (n.b as number) >= config.search.steps.minBShare * (base.b as number) - EPS;
  const throwInPrinted = (n: TradeEvaluationCore) => throwInRule(n, card) && notAbove(n);
  const smallerPrinted = (n: TradeEvaluationCore) => stepPasses(n, tagged) && likelier(n) && notAbove(n) && overallShareOk(n, card);

  // The throw-in: its candidates' exact evaluations one at a time first (lastOfferVersions finds them in the store).
  for (const p of lastOfferProposals(job)) yield* versionSteps(job, p);
  const throwIn = lastOfferVersions(job.I, job.cardVersion as TradeVersion, { settings: job.settings, maxPerSide: job.legalMax, versions: job.store.versions }).filter((t) => throwInRule(t.version.screen, cardScreen));
  let usualThrowIn: LastOfferChoice | null = null;
  for (const t of throwIn.slice(0, tries)) {
    const printed = yield* printedSteps(job, t.version);
    if (throwInPrinted(printed)) {
      usualThrowIn = { kind: "throwIn", add: t.add, proposal: t.version.screen.proposal, printed };
      break;
    }
  }

  // A smaller ask (Checkpoint 7g): each evaluated exactly (the store's version when it has one), kept on the screening block
  // when it helps me (both teams under a card tagged "Helps both") and is likelier by minAcceptGain, the highest Overall first.
  const asks: Screened[] = [];
  if (job.smallerAsks) {
    for (const c of smallerAsks(job)) {
      const v = yield* versionSteps(job, c.proposal);
      if (v) asks.push({ candidate: c, version: v });
    }
  }
  const askPool = asks.filter((s) => stepPasses(s.version.screen, tagged) && likelier(s.version.screen)).sort(byOverallThenKey);
  const askHit = yield* firstPrinted(job, askPool, smallerPrinted);
  const usual = higherOverall(usualThrowIn, askHit ? { kind: "smaller", proposal: askHit.s.candidate.proposal, printed: askHit.printed } : null);
  if (!prefer) return usual;

  // Preferring: the preferred throw-ins (every one, past the pre-screen) and smaller asks first, each kind in its own order.
  const proposal = cardScreen.proposal;
  const give = playerIds(proposal.give);
  const get = playerIds(proposal.get);
  const listedThrowIns: { add: string; version: TradeVersion }[] = [];
  if (give.length + 1 <= job.legalMax && [...proposal.give, ...proposal.get].every((a) => a.kind === "player")) {
    for (const id of throwIns(job.I, job.settings)) {
      if (give.includes(id)) continue;
      const p: TradeProposal = { partnerId: proposal.partnerId, give: players([...give, id]), get: players(get) };
      if (!prefer.has(proposalKey(p))) continue;
      const v = yield* versionSteps(job, p);
      if (v) listedThrowIns.push({ add: id, version: v });
    }
  }
  listedThrowIns.sort((x, y) => {
    const px = x.version.screen.pComplete;
    const py = y.version.screen.pComplete;
    if (Math.abs(py - px) > EPS) return py - px;
    const bx = bOf(x.version.screen) ?? Number.NEGATIVE_INFINITY;
    const by = bOf(y.version.screen) ?? Number.NEGATIVE_INFINITY;
    if (Math.abs(by - bx) > EPS && Number.isFinite(by - bx)) return by - bx;
    return x.add < y.add ? -1 : x.add > y.add ? 1 : 0;
  });
  let listedThrowIn: LastOfferChoice | null = null;
  for (const t of listedThrowIns) {
    const printed = yield* printedSteps(job, t.version);
    if (throwInPrinted(printed)) {
      listedThrowIn = { kind: "throwIn", add: t.add, proposal: t.version.screen.proposal, printed };
      break;
    }
  }
  const listedAsks = asks.filter((s) => prefer.has(s.candidate.key)).sort(byOverallThenKey);
  const listedAsk = yield* firstPrintedOf(job, listedAsks, smallerPrinted, Number.POSITIVE_INFINITY);
  // Checkpoint 7h (answer 4): the preferred pick only within config.offers.preferWithinHelps of the usual pick's Helps you.
  return narrowedPick(higherOverall(listedThrowIn, listedAsk ? { kind: "smaller", proposal: listedAsk.s.candidate.proposal, printed: listedAsk.printed } : null), usual);
}

/**
 * The narrowing (Checkpoint 7h; planner reply to Checkpoint 7g, answer 4: "Narrow the preference. Prefer an idea from the list
 * only when its Helps you is within 3 points of the best version that meets the step's rules. Otherwise take the best
 * version."; the file header, "Preferring the cards of its lists"): of a step's preferred pick (`listed`) and its usual pick
 * (`usual`: the version the step's rules pick without the preference, held to them on the numbers it prints, as every pick is),
 * the preferred one when there's no usual pick (only preferred versions meet the step's rules, so the best of them is the
 * usual pick anyway) or its printed Helps you is at least the usual pick's less config.offers.preferWithinHelps; else the usual
 * one. ⚠️ Ours, the lead's ruling: Helps you as printed at every step, the Last offer's too (whose own rule picks by Overall).
 */
export function narrowedPick<T extends { printed: Pick<TradeEvaluationCore, "tradeScore"> }>(listed: T | null, usual: T | null): T | null {
  if (!listed) return usual;
  if (!usual) return listed;
  const within = config.offers.preferWithinHelps;
  const hl = helpsOf(listed.printed);
  const hu = helpsOf(usual.printed);
  if (hl === null || hu === null) return usual;
  return hl >= hu - within - EPS ? listed : usual;
}

/**
 * Whether `original` can be `card`'s forced Open (Checkpoint 7h; the file header, "The promoted card's Open"), on the numbers
 * both print: every rule of an Open but its least chance (config.offers.openMinChance or the minimum chance, openBar) and the
 * preference: every step's rules (stepPasses: it helps me and passes the market guard, and helps both under a card tagged
 * "Helps both"), a chance at least minAcceptGain under the card's, and better for me than the card (betweenForMe: a Helps you at
 * least the card's at a higher B); and ⚠️ a chance at least the user's minimum chance (`minChance`: it was a card of the list,
 * which printed at least that). Those hold by construction for a card whose Last offer is `card` (that offer prints a chance at
 * least minAcceptGain above it, a lower B and a Helps you at most its), but the tag: search.ts promotes only when this holds.
 */
export function forcedOpenOk(card: TradeEvaluationCore, original: TradeEvaluationCore, minChance: number): boolean {
  if (!stepPasses(original, helpsBoth(card))) return false;
  if (chanceOf(original) > chanceOf(card) - config.search.steps.minAcceptGain + EPS) return false;
  if (Number.isFinite(minChance) && chanceOf(original) < minChance - EPS) return false;
  return betweenForMe(original, card, null);
}

/**
 * The promoted card's Open (Checkpoint 7h; the file header, "The promoted card's Open"): the version LadderJob.open names, the
 * candidate of `all` with that key when the card's ladder has one (its proposal in the candidate's order: the same in every
 * path), else the trade its key names (proposalFromKey: its players in key order), evaluated exactly and played out on the
 * card's block (the store's numbers when known: the search's, a card's, for the idea it was promoted from), held to
 * forcedOpenOk; null when it can't be read, evaluated or held there (then the Open's own rule picks, as without it).
 */
function* forcedOpenSteps(job: LadderJob, all: readonly LadderCandidate[]): Generator<void, { s: Screened; printed: TradeEvaluationCore } | null, void> {
  const key = job.open;
  if (!key || key === job.card.key) return null;
  let candidate = all.find((c) => c.key === key) ?? null;
  if (!candidate) {
    const proposal = proposalFromKey(key);
    if (!proposal || proposal.partnerId !== job.card.proposal.partnerId) return null;
    const mine = playerIds(job.card.proposal.give);
    const sameGive = playerIds(proposal.give).length === mine.length && playerIds(proposal.give).every((id) => mine.includes(id));
    candidate = { kind: sameGive ? "variant" : "lean", key, proposal };
  }
  const version = yield* versionSteps(job, candidate.proposal);
  if (!version) return null;
  const printed = yield* printedSteps(job, version);
  if (!forcedOpenOk(job.card, printed, job.settings.minChance)) return null;
  return { s: { candidate, version }, printed };
}

/** The ladder (the file header) from a job. */
export function buildOfferLadder(job: LadderJob, opts: LadderOptions = {}): OfferLadder {
  const start = opts.clock?.();
  const ladder = ladderFromChoice(job, ladderChoice(job));
  const end = opts.clock?.();
  return { ...ladder, ...(start !== undefined && end !== undefined ? { ms: end - start } : {}) };
}

/**
 * The ladder in words from its choices (ladderChoice; null: the suggested trade alone): each offer's evaluation with its words
 * and its message (the file header), the suggested trade the job's card.
 */
export function ladderFromChoice(job: LadderJob, choice: LadderChoice | null): OfferLadder {
  const card = job.card;
  const picked: { kind: OfferStepKind; evaluation: TradeEvaluation; original?: true }[] = [];
  if (choice?.open) picked.push({ kind: "open", evaluation: stepEvaluation(job, choice.open.printed, choice.open.candidate.proposal), ...(choice.open.forced ? { original: true as const } : {}) });
  for (const t of choice?.thens ?? []) picked.push({ kind: "then", evaluation: stepEvaluation(job, t.printed, t.candidate.proposal) });
  picked.push({ kind: "suggested", evaluation: card });
  if (choice?.last) picked.push({ kind: "last", evaluation: stepEvaluation(job, choice.last.printed, choice.last.proposal) });
  const steps: OfferStep[] = picked.map((p, i) => ({ kind: p.kind, evaluation: p.evaluation, message: i === 0 ? p.evaluation.pitch : followUp(job.I, p.evaluation.proposal), ...(p.original ? { original: true as const } : {}) }));
  return { cardKey: card.key, steps };
}

/** The keys of a ladder choice's offers (Open, Thens, the Last offer; null: none), each with its place. */
export function choiceOffers(choice: LadderChoice | null): { key: string; kind: Exclude<OfferStepKind, "suggested"> }[] {
  if (!choice) return [];
  return [
    ...(choice.open ? [{ key: choice.open.candidate.key, kind: "open" as const }] : []),
    ...choice.thens.map((t) => ({ key: t.candidate.key, kind: "then" as const })),
    ...(choice.last ? [{ key: choice.last.printed.key, kind: "last" as const }] : []),
  ];
}

// ---------------------------------------------------------------------------------------------
// Jobs

/** The ladder caches of a search (by its versions map, which its re-filters share: search.ts refilterSearch). */
const searchStores = new WeakMap<Map<string, TradeVersion>, LadderStore>();

/**
 * A card's job from its search's state (the file header): the search's settings (the state's: a re-filter's carries its own
 * minimum chance), its get pool for the partner (SearchState.getPools), its versions and printed numbers. Nothing barred
 * since Checkpoint 7f (the file header, "The candidates": its Plan B can't be an offer, and another card of its list can).
 * The card prints from the shown block when the search ran its shown pass on a block of its own, else from the ranking block
 * (search.ts finish: the numbers it printed). Since Checkpoint 7g the search's switch for smaller asks (SearchState.smallerAsks)
 * and `prefer`, the versions its ladder prefers (search.ts preferredOf, as the merge read them; the file header, "Preferring the
 * cards of its lists"), never read from the state: a re-filter's merge reads its own. Since Checkpoint 7h `open`, the idea a
 * promoted card was promoted from (its forced Open: the file header, "The promoted card's Open"), likewise.
 */
export function ladderJobOfSearch(state: SearchState, card: TradeEvaluation, prefer?: ReadonlySet<string>, open?: string): LadderJob {
  const { I, settings } = state;
  const sim = I.sim;
  const own = state.shownPass && sim !== null && sim.blocks.shown !== sim.blocks.final;
  let store = searchStores.get(state.versions);
  if (!store) {
    store = { versions: state.versions, printed: new Map(), known: own ? state.shownByKey : state.finalByKey, choices: new Map(), lasts: new Map() };
    searchStores.set(state.versions, store);
  }
  const pool = state.getPools.get(card.proposal.partnerId);
  return {
    I,
    card: bareCard(card),
    cardVersion: state.versions.get(card.key) ?? null,
    settings,
    variantsMax: settings.maxPerSide,
    legalMax: settings.maxPerSide,
    pool: pool?.pool ?? [],
    forcedGet: pool?.forced ?? [],
    store,
    printed: own ? "shown" : "final",
    smallerAsks: state.smallerAsks,
    ...(prefer && prefer.size ? { prefer } : {}),
    ...(open ? { open } : {}),
  };
}

/** A preference as a key (Checkpoint 7g): its versions' keys, sorted, joined; "" for none. */
export function preferKey(prefer: ReadonlySet<string> | undefined): string {
  return prefer && prefer.size ? [...prefer].sort().join(";") : "";
}

/**
 * A ladder choice's key in a search's store (searchLadderChoiceSteps): the minimum chance, the card and its preference
 * (Checkpoint 7g), and since Checkpoint 7h its forced Open when it has one (`|open:` and its key; a card without one keeps
 * Checkpoint 7g's key).
 */
export function choiceKey(minChance: number, cardKey: string, prefer: ReadonlySet<string> | undefined, open?: string): string {
  return `${minChance}|${cardKey}|${preferKey(prefer)}${open ? `|open:${open}` : ""}`;
}

/**
 * A search card's ladder choices (ladderChoiceSteps; Checkpoint 7f), worked out once per minimum chance and card in the
 * search's store (LadderStore.choices), so the merge (search.ts, "Merged cards") and the card's first open read one choice,
 * and a re-filter back to a minimum seen reads it there. They depend on nothing else a re-filter changes (the card's numbers
 * on each block are the search's, its get pool and versions the search's), but for (Checkpoint 7g) the card's preference,
 * which the key holds too (the same minimum gives the same preference: search.ts finish is deterministic).
 */
export function* searchLadderChoiceSteps(job: LadderJob): Generator<void, LadderChoice | null, void> {
  const choices = job.store.choices;
  if (!choices) return yield* ladderChoiceSteps(job);
  const key = choiceKey(job.settings.minChance, job.card.key, job.prefer, job.open);
  if (choices.has(key)) return choices.get(key) ?? null;
  const choice = yield* ladderChoiceSteps(job);
  choices.set(key, choice);
  return choice;
}

/**
 * A search card's Last offer alone (Checkpoint 7h, the promotion's cost: the lead's ruling, "check each card's Last offer alone
 * (the Last offer doesn't depend on the Open or the Thens) and work out the full ladder only for promoted cards and the cards
 * the merge reads, so the promotions are the same"; search.ts, "Promoted Last offers"): the Last offer the card's whole ladder
 * (searchLadderChoiceSteps, the same job) would hold, without its Open and Thens. The same, by construction: ladderChoiceSteps
 * works the Last offer out first (lastOfferSteps), from the card, its version and the store alone, never from the Open or the
 * Thens, and its ladder always has room for it (ladderRoom: with config.offers.maxSteps at least 3, the suggested trade, an Open
 * and the Last offer fit); null when the card gets the suggested trade alone (offersApply), as its ladder is then. Read from
 * the store's whole choice when it holds one (a re-filter, a card already opened), else worked out once per key and kept
 * (LadderStore.lasts). ⚠️ Where it couldn't be the same (a ladder of fewer than 3 offers, which could drop the Last offer for
 * an Open, or a job with a preference, whose ladder is chosen between two), the whole ladder is worked out and its Last offer
 * read. Its runs on the shown block are the whole ladder's Last offer's, in the same order, so they're the very numbers.
 */
export function* searchLastOfferSteps(job: LadderJob): Generator<void, LastOfferChoice | null, void> {
  const key = choiceKey(job.settings.minChance, job.card.key, job.prefer, job.open);
  const whole = job.store.choices;
  if (whole?.has(key)) return whole.get(key)?.last ?? null;
  if ((job.prefer && job.prefer.size) || !ladderRoom(config.offers.maxSteps, true, true).last) return (yield* searchLadderChoiceSteps(job))?.last ?? null;
  const lasts = job.store.lasts;
  if (lasts?.has(key)) return lasts.get(key) ?? null;
  const last = offersApply(job) ? yield* lastOfferSteps(job, helpsBoth(job.card), null) : null;
  lasts?.set(key, last);
  return last;
}

/** A neighbor's kind of offer (ladderNeighbors): an Open or a Then, the Last offer's throw-in, or (Checkpoint 7g) its smaller ask. */
export type NeighborKind = "earlier" | "last" | "smaller";

/**
 * The cards of `listed` that can be offers of `card` whatever their numbers (Checkpoint 7f; search.ts, "Merged cards": a card
 * none of whose listed cards is one, or passes offerFeasible, needs no ladder for the merge), in `listed`'s order, never the
 * card, each with the kind of offer it would be: "earlier" for one of its ladder's candidates (ladderCandidates: a variant or
 * the lean version, an Open or a Then), "last" for the card plus one of the throw-ins the Last offer's pre-screen keeps
 * (evaluate.ts addCandidates, my side within the per-side limit), and since Checkpoint 7g "smaller" for one of its smaller asks
 * (smallerAsks, when the search allows them: SearchState.smallerAsks), which is a variant too, so it comes twice, "smaller"
 * then "earlier" (each kind it can be: offerFeasible's callers read them with `.some`); with the search's preference on
 * (SearchState.preferListed) "last" for the card plus any of my throw-ins (a preferred Last offer is tried past the
 * pre-screen: the file header, "Preferring the cards of its lists"). A superset of the cards its ladder can hold: exactly the
 * versions the ladder could pick.
 */
export function ladderNeighbors(state: SearchState, card: TradeEvaluation, listed: readonly Pick<TradeEvaluationCore, "key" | "proposal">[]): { key: string; kind: NeighborKind }[] {
  const others = listed.filter((n) => n.key !== card.key);
  if (!others.length) return [];
  const job = ladderJobOfSearch(state, card);
  const earlier = new Set(ladderCandidates(job).map((c) => c.key));
  const smaller = new Set(job.smallerAsks ? smallerAsks(job).map((c) => c.key) : []);
  const proposal = job.cardVersion?.screen.proposal ?? card.proposal;
  const onlyPlayers = [...proposal.give, ...proposal.get].every((a) => a.kind === "player");
  const give = playerIds(proposal.give);
  const theirs = [...playerIds(proposal.get)].sort().join(",");
  let adds: Set<string> | null = null;
  const out: { key: string; kind: NeighborKind }[] = [];
  for (const n of others) {
    if (smaller.has(n.key)) out.push({ key: n.key, kind: "smaller" });
    if (earlier.has(n.key)) {
      out.push({ key: n.key, kind: "earlier" });
      continue;
    }
    // The card plus one player of mine: the same partner and players of theirs, my side with one more.
    if (!onlyPlayers || give.length + 1 > job.legalMax || n.proposal.partnerId !== proposal.partnerId) continue;
    const nGive = playerIds(n.proposal.give);
    if (nGive.length !== give.length + 1 || !give.every((id) => nGive.includes(id)) || [...playerIds(n.proposal.get)].sort().join(",") !== theirs) continue;
    const added = nGive.find((id) => !give.includes(id)) as string;
    adds ??= new Set(state.preferListed ? throwIns(state.I, state.settings).filter((id) => !give.includes(id)) : addCandidates(state.I, proposal, throwIns(state.I, state.settings), stepConfig()));
    if (adds.has(added)) out.push({ key: n.key, kind: "last" });
  }
  return out;
}

/**
 * The ladder for a card of a finished search's result (the result object the engine returned, whose state it reads:
 * search.ts searchStateOf): since Checkpoint 7f the one the search kept for it when its merge read it (SearchState.ladders),
 * else worked out (its choices once per minimum chance: searchLadderChoiceSteps, with since Checkpoint 7g the preference the
 * search's merge recorded for it, SearchState.prefers); null when the result has no state or no card under `key`. Every way
 * gives the same ladder: the choices depend only on the card, the minimum chance and the preference, and the words on the
 * card's printed numbers.
 */
export function offerLadderOfSearch(result: TradeSearchResult, key: string, opts: LadderOptions = {}): OfferLadder | null {
  const state = searchStateOf(result);
  const card = cardOf(result, key);
  if (!state || !card) return null;
  const start = opts.clock?.();
  let ladder = state.ladders?.get(key);
  if (!ladder) {
    const job = ladderJobOfSearch(state, card, state.prefers?.get(key), state.opens?.get(key));
    ladder = ladderFromChoice(job, ranOut(searchLadderChoiceSteps(job)));
  }
  const end = opts.clock?.();
  return start !== undefined && end !== undefined ? { ...ladder, ms: end - start } : ladder;
}

/** The ladder caches of a context, by the settings its numbers read and the per-side limit. */
const contextStores = new WeakMap<TradeInternals, Map<string, LadderStore>>();

/**
 * A proposal ladder's options: the call's settings (default: the defaults) and whose card it is (default the Analyzer's).
 * `barred`, the keys a Finder card's offers couldn't be (its Plan B, which the page sent for a card whose search the engine no
 * longer keeps: the review of wave D, D-ENG-3 and UI-D-4), is ignored since Checkpoint 7f (the file header, "The candidates":
 * a Plan B can't be an offer) and kept so a request from an older page still reads.
 */
export interface ProposalLadderOptions extends LadderOptions {
  settings?: TradeSettings;
  page?: "finder" | "analysis";
  /** Ignored since Checkpoint 7f (above). */
  barred?: Iterable<string>;
  /**
   * Checkpoint 7g (the file header, "Preferring the cards of its lists"): the versions a Finder card's ladder prefers, as its
   * search recorded them (TradeSearchResult.offerPrefer, which the page sends for a card whose search the engine no longer
   * keeps), so the ladder is the one the search kept; absent or empty: none (the Analyzer's card, which has no list).
   */
  prefer?: Iterable<string>;
  /** Checkpoint 7g: false leaves out the smaller asks' Last offer (LadderJob.smallerAsks; a test switch the app never sets). */
  smallerAsks?: boolean;
  /**
   * Checkpoint 7h (the file header, "The promoted card's Open"): the idea a Finder card was promoted from, its forced Open, as
   * its search recorded it (TradeSearchResult.offerOpen, which the page sends for a card whose search the engine no longer
   * keeps), so the ladder is the one the search kept; absent: none (every card the search didn't promote, and the Analyzer's
   * card: the user built that trade, so nothing is promoted there).
   */
  open?: string;
}

/**
 * A card's job from its proposal on a context (the file header): the Trade Analyzer's card (page "analysis": legality and the
 * Last offer within config.search.analyzerMaxPerSide), or a Finder card whose search isn't kept (page "finder": within the
 * settings' maxPerSide). The card is evaluated as analyzeTrade evaluates it (exact evaluation in the proposal's own order,
 * the shown block), its version on the screening block from the same exact evaluation; the partner's get pool from
 * search.ts getPoolOf with the settings' must-include players of that partner. Nothing barred (`opts.barred` is ignored), so a
 * Finder card's ladder here is the one its search kept or works out (Checkpoint 7f), with since Checkpoint 7g the preference
 * its search recorded (`opts.prefer`: its preferred versions are evaluated and played out here when the context doesn't hold
 * them).
 * Null when the proposal can't be evaluated (no team, another team's partner, illegal).
 */
export function ladderJobOfProposal(ctx: TradeContext, proposal: TradeProposal, opts: Omit<ProposalLadderOptions, "clock"> = {}): LadderJob | null {
  const I = tradeInternals(ctx);
  if (!I.me) return null;
  const settings = normalizeTradeSettings(opts.settings ?? {});
  const legalMax = opts.page === "finder" ? settings.maxPerSide : Math.max(1, Math.floor(config.search.analyzerMaxPerSide));
  const exact = evaluateExact(I, proposal, legalMax);
  if ("illegal" in exact) return null;
  const reward = rewardFor(I, settings);
  const card = withWords(I, simulateTrade(I, exact, "shown", settings.lambda, settings.protectValue, reward));
  const cardVersion: TradeVersion = { x: exact, screen: simulateTrade(I, exact, "screen", settings.lambda, settings.protectValue, reward) };
  const partner = I.byId.get(proposal.partnerId);
  if (!partner) return null;
  const tradable = new Set(I.irOn ? [...partner.roster, ...partner.ir] : partner.roster);
  const forced = settings.mustInclude.filter((id) => tradable.has(id));
  const fingerprint = JSON.stringify([settings.lambda, settings.protectValue, settings.goal, settings.prizes, settings.untouchables, settings.mustInclude, settings.includeKDefIdp, legalMax]);
  let byContext = contextStores.get(I);
  if (!byContext) {
    byContext = new Map();
    contextStores.set(I, byContext);
  }
  let store = byContext.get(fingerprint);
  if (!store) {
    store = { versions: new Map(), printed: new Map() };
    byContext.set(fingerprint, store);
  }
  const prefer = new Set(opts.prefer ?? []);
  return {
    I,
    card,
    cardVersion,
    settings,
    variantsMax: settings.maxPerSide,
    legalMax,
    pool: getPoolOf(I, settings, partner, forced),
    forcedGet: forced,
    store,
    printed: "shown",
    smallerAsks: opts.smallerAsks !== false,
    ...(prefer.size ? { prefer } : {}),
    ...(opts.open ? { open: opts.open } : {}),
  };
}

/** The ladder for any proposal on a context (ladderJobOfProposal): the suggested trade's key and no offers when it can't be evaluated. */
export function offerLadderOfProposal(ctx: TradeContext, proposal: TradeProposal, opts: ProposalLadderOptions = {}): OfferLadder {
  const start = opts.clock?.();
  const job = ladderJobOfProposal(ctx, proposal, opts);
  if (!job) return { cardKey: proposalKey(proposal), steps: [] };
  const ladder = buildOfferLadder(job);
  const end = opts.clock?.();
  return { ...ladder, ...(start !== undefined && end !== undefined ? { ms: end - start } : {}) };
}
