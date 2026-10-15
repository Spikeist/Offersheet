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
 * - Never the card itself. Nothing else is barred since Checkpoint 7f (the lead's call): the trade its Plan B box shows can
 *   never be an offer by the rules. A box is at least minAcceptGain likelier to go through than its card (planB.ts
 *   planBPasses), so it prints a chance at least the card's, while an Open or Then prints one at least minAcceptGain under
 *   it; and a box is another set of their players (planB.ts, "Which"), while the Last offer and the lean version keep the
 *   card's. (Checkpoint 7e barred the box from the candidates, which changed none of 893 ladders on Parker's leagues and 68
 *   synthetic ones; ⚠️ the report switches planB otherTargetOnly false and minAcceptGain null can make a box an offer.)
 * - ⚠️ Another card of its list can be an offer (the lead's call, wave D; it replaces the review's barring, D-ENG-2 and
 *   UI-D-2): the rules choose it as they choose any candidate. Since Checkpoint 7f (planner reply to Checkpoint 7e, decision 3:
 *   "When one card's offer list contains another card's trade, merge them") the search folds it into the card when the card
 *   has the higher Overall (search.ts, "Merged cards"), so it shows only among the card's offers; when it has the higher
 *   Overall itself, and so its own offers don't include the card (the review of the merge, MERGE-1), both stay, and the card
 *   labels it with that card's place in the sort the Trade Finder shows ("Also shown as trade idea 2.", Plan B's words:
 *   tradeView.ts planBAlsoText, TradeCard.tsx `places`). Two shapes: (i) the card is a likelier variant of the other, a
 *   smaller ask that opens with the bigger one, which the other's ladder can't hold (its offers before its suggested trade
 *   are less likely than it, and its Last offer is itself plus a player of mine); (ii) the card is the other's lean version,
 *   the other being the card plus a player of mine (the card's Last offer), which the other's ladder could hold as its Open
 *   or a Then by the rules but passed over, picking those by Helps you on the screening block's 1,000 seasons (Parker's
 *   "Helps both" list, Oct 15: Puka Nacua → Drake London + Christian Watson, whose Last offer is Marvin Harrison Jr. + Puka
 *   Nacua → Drake London + Christian Watson). Why not bar it: the card's plan is lost, and "no version of it makes
 *   a better first offer" can be false (barred, on Parker's league, week 6, his top 3 cards each read "Offer this trade as
 *   it is", though #1 opens with #2's trade, #2 ends with #1's as its Last offer and #3 opens with #5's).
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
 * Finder card's trade differs only ⚠️ through the Last offer, by the per-side limit (rule 4: the Analyzer's
 * analyzerMaxPerSide, the steps' case 2 rule there since Phase 4; the final review of Checkpoint 7e, ENG-7E-4: on Parker's two
 * leagues 10 of 25 cards opened in the Analyzer add a Last offer with a third player of mine, which the Trade Finder's
 * maxPerSide of 2 leaves out); until Checkpoint 7f also by what the Finder barred, its Plan B. ⚠️ The pre-screen yields
 * every config.search.yieldEveryScreens quick estimates (ladderChoiceSteps), as the screening does.
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
 * 4. Last offer: the suggested trade plus the throw-in by the rule that was the steps' case 2 (evaluate.ts
 *    lastOfferVersions: the throw-in from my roster that raises the chance they accept most while B stays at least
 *    config.search.steps.minBShare of the suggested trade's, ⚠️ "Helps you at least 80%" read as that rule on B, within the
 *    per-side limit: the search's maxPerSide, the Analyzer's analyzerMaxPerSide), printing a chance at least 5 points above
 *    the suggested trade's and ⚠️ a Helps you at most the suggested trade's at a lower B (the review of wave D, D-ENG-4 and
 *    UI-D-3: one printing more on both would be a better card, not a last offer, the lead's rule for the variants, and on 7
 *    of 1,023 synthetic cards the ladder told the user to send the worse deal first; ENG-7E-1 above for an equal one).
 *    (Another card of its list can be one: "The candidates" above.)
 * At most config.offers.maxSteps offers in all, the suggested trade counted: Open first, then the Last offer, then as many
 * Thens as fit (4: Open, at most one Then with a Last offer, two without one). No Open: no Then (any Then would have been an
 * Open). ⚠️ A variant that prints a higher Helps you and a higher chance than the card isn't in the ladder (the lead's call:
 * it would be a better card, not a first offer); the chance rules keep it out.
 *
 * Each step carries its own evaluation (OfferStep.evaluation: its proposal in its own order, its printed numbers, its roster
 * moves and its words, evaluate.ts withWords), and its message: the first step's pitch (explain.ts: what the partner gains,
 * then the trade), each later step's a follow-up naming its version, Plan B's template (tradeView.ts planBPitch: "Thanks for
 * considering it! Would you trade … for … instead? Let me know what you think!"). The card's own evaluation is the
 * suggested step's (without its Plan B). A card that doesn't help me, is hidden by the market guard, or whose context stops
 * the search (no team, no odds, the deadline passed, …) gets the suggested trade alone.
 */
import { displayAcceptance } from "./acceptance";
import { helpsBoth } from "./benefit";
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
 * `k`'s but at least minBShare of it, and a Helps you at most `k`'s.
 */
export function offerFeasible(k: TradeEvaluationCore, n: TradeEvaluationCore, kind: "earlier" | "last", minChance: number): boolean {
  if (!stepPasses(n, helpsBoth(k))) return false;
  if (kind === "earlier") return inWindow(n, openBar(minChance), k) && betweenForMe(n, k, null);
  const hn = helpsOf(n);
  const hk = helpsOf(k);
  const bn = bOf(n);
  const bk = bOf(k);
  if (hn === null || hk === null || bn === null || bk === null) return false;
  return chanceOf(n) >= chanceOf(k) + config.search.steps.minAcceptGain - EPS && bn >= config.search.steps.minBShare * bk - EPS && bn < bk - EPS && hn <= hk;
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
  const tries = Math.max(0, Math.floor(config.offers.tries));
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

/** The ladder's chosen versions before their words (buildOfferLadder; the report reads them too). */
export interface LadderChoice {
  open: { candidate: LadderCandidate; printed: TradeEvaluationCore } | null;
  thens: { candidate: LadderCandidate; printed: TradeEvaluationCore }[];
  last: { add: string; proposal: TradeProposal; printed: TradeEvaluationCore } | null;
  /** Every candidate the pre-screen let through that's legal, with its numbers on the screening block (the report's). */
  screened: { candidate: LadderCandidate; screen: TradeEvaluationCore }[];
  /** How many candidates there were before the pre-screen (ladderCandidates; the report's). */
  candidates: number;
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
  const card = job.card;
  const cardScreen = (job.cardVersion as TradeVersion).screen;
  const tagged = helpsBoth(card);
  const gain = config.search.steps.minAcceptGain;
  const maxSteps = Math.max(1, Math.floor(config.offers.maxSteps));

  // The Last offer (the rule that was the steps' case 2), on the screening block first, then printed: ⚠️ never printing a
  // higher Helps you than the suggested trade's, nor ⚠️ a B as high (the file header, "4. Last offer"; the final review of
  // Checkpoint 7e, ENG-7E-1: printing the card's own Helps you at a higher B, it was the better deal and likelier), judged on
  // the printed numbers only (the card plus a cheap throw-in is often a hair from the card on Helps you, and the screening
  // block's 1,000 seasons turned down Last offers that print the card's own Helps you).
  let last: LadderChoice["last"] = null;
  const notAbove = (n: TradeEvaluationCore) => {
    const hn = helpsOf(n);
    const hb = helpsOf(card);
    const bn = bOf(n);
    const bc = bOf(card);
    return hn !== null && hb !== null && hn <= hb && bn !== null && bc !== null && bn < bc - EPS;
  };
  const lastRule = (n: TradeEvaluationCore, base: TradeEvaluationCore) => stepPasses(n, tagged) && chanceOf(n) >= chanceOf(card) + gain - EPS && (n.b as number) >= config.search.steps.minBShare * (base.b as number) - EPS;
  // Its candidates' exact evaluations one at a time first (lastOfferVersions finds them in the store).
  for (const p of lastOfferProposals(job)) yield* versionSteps(job, p);
  const throwIn = lastOfferVersions(job.I, job.cardVersion as TradeVersion, { settings: job.settings, maxPerSide: job.legalMax, versions: job.store.versions }).filter((t) => lastRule(t.version.screen, cardScreen));
  const tries = Math.max(0, Math.floor(config.offers.tries));
  for (const t of throwIn.slice(0, tries)) {
    const printed = yield* printedSteps(job, t.version);
    if (lastRule(printed, card) && notAbove(printed)) {
      last = { add: t.add, proposal: t.version.screen.proposal, printed };
      break;
    }
  }

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

  // Open.
  const openPool = passing.filter((s) => inWindow(s.version.screen, bar, card)).sort((a, b) => byHelps(a.version.screen, b.version.screen));
  const openHit = yield* firstPrinted(job, openPool, (p) => stepPasses(p, tagged) && inWindow(p, bar, card) && betweenForMe(p, card, null));
  let open: LadderChoice["open"] = openHit ? { candidate: openHit.s.candidate, printed: openHit.printed } : null;

  // Room: the suggested trade, then Open, then the Last offer, then as many Thens as fit.
  const room = ladderRoom(maxSteps, open !== null, last !== null);
  if (!room.open) open = null;
  if (!room.last) last = null;
  let thensLeft = room.thens;

  // Then, after the step before.
  const thens: LadderChoice["thens"] = [];
  let prev: { screen: TradeEvaluationCore; printed: TradeEvaluationCore } | null = open && openHit ? { screen: openHit.s.version.screen, printed: openHit.printed } : null;
  const used = new Set<string>(open ? [open.candidate.key] : []);
  while (prev && thensLeft > 0) {
    const before = prev;
    const pool = passing
      .filter((s) => !used.has(s.candidate.key))
      .filter((s) => inWindow(s.version.screen, chanceOf(before.screen) + gain, card) && helpsBetween(s.version.screen, cardScreen, before.screen))
      .sort((a, b) => byHelps(a.version.screen, b.version.screen));
    const hit = yield* firstPrinted(job, pool, (p) => stepPasses(p, tagged) && inWindow(p, chanceOf(before.printed) + gain, card) && betweenForMe(p, card, before.printed));
    if (!hit) break;
    thens.push({ candidate: hit.s.candidate, printed: hit.printed });
    used.add(hit.s.candidate.key);
    prev = { screen: hit.s.version.screen, printed: hit.printed };
    thensLeft--;
  }
  return { open, thens, last, screened: screened.map((s) => ({ candidate: s.candidate, screen: s.version.screen })), candidates: all.length };
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
  const picked: { kind: OfferStepKind; evaluation: TradeEvaluation }[] = [];
  if (choice?.open) picked.push({ kind: "open", evaluation: stepEvaluation(job, choice.open.printed, choice.open.candidate.proposal) });
  for (const t of choice?.thens ?? []) picked.push({ kind: "then", evaluation: stepEvaluation(job, t.printed, t.candidate.proposal) });
  picked.push({ kind: "suggested", evaluation: card });
  if (choice?.last) picked.push({ kind: "last", evaluation: stepEvaluation(job, choice.last.printed, choice.last.proposal) });
  const steps: OfferStep[] = picked.map((p, i) => ({ kind: p.kind, evaluation: p.evaluation, message: i === 0 ? p.evaluation.pitch : followUp(job.I, p.evaluation.proposal) }));
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
 * (search.ts finish: the numbers it printed).
 */
export function ladderJobOfSearch(state: SearchState, card: TradeEvaluation): LadderJob {
  const { I, settings } = state;
  const sim = I.sim;
  const own = state.shownPass && sim !== null && sim.blocks.shown !== sim.blocks.final;
  let store = searchStores.get(state.versions);
  if (!store) {
    store = { versions: state.versions, printed: new Map(), known: own ? state.shownByKey : state.finalByKey, choices: new Map() };
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
  };
}

/**
 * A search card's ladder choices (ladderChoiceSteps; Checkpoint 7f), worked out once per minimum chance and card in the
 * search's store (LadderStore.choices), so the merge (search.ts, "Merged cards") and the card's first open read one choice,
 * and a re-filter back to a minimum seen reads it there. They depend on nothing else a re-filter changes (the card's numbers
 * on each block are the search's, its get pool and versions the search's).
 */
export function* searchLadderChoiceSteps(job: LadderJob): Generator<void, LadderChoice | null, void> {
  const choices = job.store.choices;
  if (!choices) return yield* ladderChoiceSteps(job);
  const key = `${job.settings.minChance}|${job.card.key}`;
  if (choices.has(key)) return choices.get(key) ?? null;
  const choice = yield* ladderChoiceSteps(job);
  choices.set(key, choice);
  return choice;
}

/**
 * The cards of `listed` that can be offers of `card` whatever their numbers (Checkpoint 7f; search.ts, "Merged cards": a card
 * none of whose listed cards is one, or passes offerFeasible, needs no ladder for the merge), in `listed`'s order, never the
 * card, each with the kind of offer it would be: "earlier" for one of its ladder's candidates (ladderCandidates: a variant or
 * the lean version, an Open or a Then), "last" for the card plus one of the throw-ins the Last offer's pre-screen keeps
 * (evaluate.ts addCandidates, my side within the per-side limit). A superset of the cards its ladder can hold: exactly the
 * versions the ladder could pick.
 */
export function ladderNeighbors(state: SearchState, card: TradeEvaluation, listed: readonly Pick<TradeEvaluationCore, "key" | "proposal">[]): { key: string; kind: "earlier" | "last" }[] {
  const others = listed.filter((n) => n.key !== card.key);
  if (!others.length) return [];
  const job = ladderJobOfSearch(state, card);
  const earlier = new Set(ladderCandidates(job).map((c) => c.key));
  const proposal = job.cardVersion?.screen.proposal ?? card.proposal;
  const onlyPlayers = [...proposal.give, ...proposal.get].every((a) => a.kind === "player");
  const give = playerIds(proposal.give);
  const theirs = [...playerIds(proposal.get)].sort().join(",");
  let adds: Set<string> | null = null;
  const out: { key: string; kind: "earlier" | "last" }[] = [];
  for (const n of others) {
    if (earlier.has(n.key)) {
      out.push({ key: n.key, kind: "earlier" });
      continue;
    }
    // The card plus one player of mine: the same partner and players of theirs, my side with one more.
    if (!onlyPlayers || give.length + 1 > job.legalMax || n.proposal.partnerId !== proposal.partnerId) continue;
    const nGive = playerIds(n.proposal.give);
    if (nGive.length !== give.length + 1 || !give.every((id) => nGive.includes(id)) || [...playerIds(n.proposal.get)].sort().join(",") !== theirs) continue;
    const added = nGive.find((id) => !give.includes(id)) as string;
    adds ??= new Set(addCandidates(state.I, proposal, throwIns(state.I, state.settings), stepConfig()));
    if (adds.has(added)) out.push({ key: n.key, kind: "last" });
  }
  return out;
}

/**
 * The ladder for a card of a finished search's result (the result object the engine returned, whose state it reads:
 * search.ts searchStateOf): since Checkpoint 7f the one the search kept for it when its merge read it (SearchState.ladders),
 * else worked out (its choices once per minimum chance: searchLadderChoiceSteps); null when the result has no state or no
 * card under `key`. Every way gives the same ladder: the choices depend only on the card and the minimum chance, and the
 * words on the card's printed numbers.
 */
export function offerLadderOfSearch(result: TradeSearchResult, key: string, opts: LadderOptions = {}): OfferLadder | null {
  const state = searchStateOf(result);
  const card = cardOf(result, key);
  if (!state || !card) return null;
  const start = opts.clock?.();
  let ladder = state.ladders?.get(key);
  if (!ladder) {
    const job = ladderJobOfSearch(state, card);
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
}

/**
 * A card's job from its proposal on a context (the file header): the Trade Analyzer's card (page "analysis": legality and the
 * Last offer within config.search.analyzerMaxPerSide), or a Finder card whose search isn't kept (page "finder": within the
 * settings' maxPerSide). The card is evaluated as analyzeTrade evaluates it (exact evaluation in the proposal's own order,
 * the shown block), its version on the screening block from the same exact evaluation; the partner's get pool from
 * search.ts getPoolOf with the settings' must-include players of that partner. Nothing barred (`opts.barred` is ignored), so a
 * Finder card's ladder here is the one its search kept or works out (Checkpoint 7f).
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
