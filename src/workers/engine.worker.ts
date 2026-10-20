/**
 * The engine's Web Worker (CLAUDE.md §3: the engine runs in a Web Worker in the browser, so the math
 * never blocks the page and costs our server nothing). It answers these messages:
 *
 * - `league`: build the League model (§6 projections, §7 lineups, needs and partners, §8 playoff odds,
 *   §9 values) from a snapshot, its model inputs and the user's settings for the league (src/engine/
 *   settings.ts: the positions my team streams, Phase 4 lead decision L12, and the goal its automatic playoff weight
 *   weighs my odds by, planner reply to Checkpoint 7a, §6.1). Since Checkpoint 7e without the waiver rating, its build kept
 *   for `waivers` (below).
 *   One reply: `league` (or `error`).
 * - `trades`: the trade search (§12, src/engine/search.ts) for the Trade Finder, with every other team or one
 *   partner. Replies: `progress` now and then, then `trades` with the result (or `error`, or `cancelled` when
 *   it was stopped). Phase 4 wave 2 decision M12: the search is a generator run in time slices of about
 *   SEARCH_SLICE_MS of work, with a timer (setTimeout 0) between slices, so the worker reads its messages
 *   between them: a `cancel` for it, or a newer `trades` request, stops it there (a newer one supersedes it:
 *   one search at a time). Each slice posts its latest progress, so the page's progress bar moves without a
 *   message per unit of work. Building the evaluation context is one piece of work that can't be sliced; a
 *   slice boundary follows it, so a Stop pressed meanwhile is seen before the search starts. Checkpoint 7c (planner reply
 *   to Checkpoint 7b, §7): the result carries the "Helps both" list too (TradeSearchResult.helpsBoth, ranked by the
 *   engine) and every evaluation its partner's numbers (TradeEvaluation.them), plain data in the same reply: the page's
 *   sort stays its own (no message for it), and a card on both lists is one object, which the structured clone keeps one.
 *   Checkpoint 7h (planner reply to Checkpoint 7g, §1): the result it posts carries my baseline's moves made with or without any
 *   trade (TradeSearchResult.baselineMoves: contextBaselineMoves, on the context the search ran on), which the Trade Finder
 *   says once above its list; a re-filter's too.
 * - `refilter` (Phase 4c; planner reply to Checkpoint 4b, change 10: "Re-filter instantly from the finalists, without
 *   re-running the search"): the ideas of a finished search (`of`: its request id, or an earlier re-filter's) ranked again
 *   with the request's minimum chance (TradeSettings.minChance; search.ts refilterSearch: the same finalists, their Plan
 *   Bs, words and pattern note made again; until Checkpoint 7e their steps too), run in slices like a search (its progress is the "rank" stage alone) and
 *   answered like one (`progress`, then `trades`, or `error` or `cancelled`; one search or re-filter at a time). The
 *   worker keeps the results of its last KEPT_RESULTS searches and re-filters by id, as long as the evaluation context
 *   they ran on is the one it holds (a new context, after a kickoff for instance, forgets them). When it holds none under
 *   `of` (an id from a worker that restarted, one forgotten, or none: -1), or the context it holds now isn't the one the
 *   search ran on (refilterSearch refuses another context: a kickoff since), it runs a new search with the request's
 *   settings instead, which carry the new minimum (the request has every field a search has); when the search stopped
 *   before ranking (no state: search.ts searchStateOf, a result that holds for any minimum), it answers with that same
 *   result. ⚠️ A re-filter's result is answered with the search's own timings (TradeSearchResult.timings: what the page
 *   says the search took), the re-filter's time under "refilter".
 * - `analyze`: the Trade Analyzer (§13, src/engine/evaluate.ts analyzeTrade): one proposal evaluated exactly as
 *   the search's finalists are. One reply: `analysis` (or `error`), which also carries my odds before any trade, the
 *   ones the search reports (contextBaseline), so the Analyzer's card reads like the Trade Finder's (review of Phase 4:
 *   the Finder's "+9.1 percentage points (63% to 72%)" read "+9.1 percentage points" in the Analyzer). With `steps:
 *   false` (a trade opened from a card's "If they say no, try:"; review of Phase 4b) the evaluation comes without "Offer
 *   first / if they say no" and its words are made again without them (withoutSteps), so its message proposes the trade
 *   itself, never a smaller first offer than the trade the other manager just turned down. Since Checkpoint 7e (planner
 *   reply to Checkpoint 7d, item 4.1) analyzeTrade makes no steps (the card's "How to offer it" is `offers`, asked for when
 *   it's opened, and the page asks none for such a trade), so withoutSteps leaves its evaluation as it is.
 * - `waivers` (Checkpoint 7e; planner reply to Checkpoint 7d, item 3.4): "Waiver upgrades" with the "Rest of season" list
 *   rated by Helps you (league.ts rateWaiverUpgrades). Rating it takes about a second on Parker's league, over the lead's
 *   rule for the League model build, so `league` builds without it (BuildLeagueModelOptions.waiverRating false) and keeps
 *   its build (the context, the model and its seasons' odds: the last one only, about 15–26 MB on Parker's leagues, until
 *   it's rated) when the request says the page will ask for the rating (LeagueRequest.keepForWaivers: the League page's;
 *   review of wave C, RC-ENG-6) and the list waits for it as the page judges (waivers.waiverRatingPending: a season list
 *   with a move to rate, odds and the "Helps you" calibration; ⚠️ a redraft season over still keeps it, though the page
 *   then doesn't ask: until the next build, or the page closes); the Waivers section asks for the rating when it first
 *   shows (src/lib/engineClient.ts waiverRatingFor, with the very job its model was built for), and the worker rates the
 *   kept build when it's that job's (the same contextKey over LEAGUE_MODEL_SETTINGS, "Drop from the same position"
 *   included, and the same moment), else builds the League model again
 *   for that job and rates it, with the request's own "Protect my trade value" and Win now ↔ Future either way (the key
 *   doesn't hold them: RC-ENG-4). One reply: `waivers` with the rated lists (null without my team, or when the list can't
 *   be rated: no odds, or a move's season the simulator refuses), or `error`. ⚠️ One piece of work, not sliced: a
 *   `league` request sent meanwhile waits for it (about a second).
 * - `later` replies (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.2, "Now or after this week"; no request of its
 *   own): once a search or re-filter has answered with cards, the worker works out each card's "Helps you … if done after
 *   this week's games" numbers (evaluate.ts laterNumbers: one more run on the shown block a card, about 45–65 ms on Parker's
 *   leagues in Node) and posts them under that request's id as they're made (`{ type: "later", id, result: [{ key, later
 *   }], done }`, a slice of about sliceMs at a time, `done` with the last), the Overall list's cards first in its order, then
 *   the "Helps both" list's others (cardKeysOf). They run only while no search or re-filter is under way: a newer one
 *   pauses them, and its own come first once it answers, then the older ones resume (each card's numbers are memoized, so a
 *   re-filter's cards known from before go at once). Jobs of results the worker no longer keeps (KEPT_RESULTS, or a new
 *   context) are dropped. A result without cards gets none. A line that fails ends its job: `done`, with `detail`.
 * - `offers` (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1: "When to build it: when the user opens a card's
 *   'How to offer it,' in the Web Worker"): a card's "How to offer it", offers in order (src/engine/offers.ts). `source`
 *   names the card: a Trade Finder card by the id of the search or re-filter whose result holds it (engineClient.ts
 *   searchResultIdOf) and its key, built from that result's search state (the search's own get pool for the partner, the
 *   evaluations it made; since Checkpoint 7f the very ladder the search kept when its merge read it, search.ts "Merged
 *   cards"); a Trade Analyzer card by its proposal, built on the evaluation context for the request (offers.ts
 *   offerLadderOfProposal). ⚠️ A Finder card whose result the worker no longer holds (KEPT_RESULTS, a new context, a worker
 *   that restarted) is built the Analyzer's way from its trade (the source's `proposal`, in the card's own order, else the
 *   trade its key names; the review of wave D, D-ENG-3 and UI-D-4: it named the players in id order), with the request's
 *   settings: the same offers as from the result (nothing barred since Checkpoint 7f, so the `barred` keys an older page
 *   sends, its Plan B, are read and ignored: a Plan B can't be an offer by the rules, offers.ts "The candidates"; since
 *   Checkpoint 7g with the preference its search recorded for it, the source's `prefer`, TradeSearchResult.offerPrefer, part of
 *   the ladder's key there: offers.ts "Preferring the cards of its lists"; a request without it, an older page's, still
 *   answers, without one). ⚠️ A result the worker keeps answers for its cards whatever the request's
 *   settings or moment (no context is built for it): the offers are the card's as it was found, from the state that made it.
 *   ⚠️ An `offers` request never replaces the context the worker keeps for its searches, nor forgets the results it keeps
 *   (the review of wave D, D-ENG-8 and UI-D-4: opening a dimmed idea's offers while a newer search ran rebuilt the old
 *   settings' context, so the newer search's next minimum chance searched again instead of re-filtering): when the kept
 *   context isn't the request's, the request's own goes into a second slot (`aside`), dropped once a search or re-filter
 *   answers or the kept one is built again. Each ladder is kept per result (or per context, settings and trade) and card
 *   key, so a second open is instant. One reply: `offers` with the ladder, or `error`. One piece of work, not
 *   sliced: on Parker's leagues the first open of a top card takes a few tenths of a second in Node (⚠️ about ×1.24 in the
 *   browser; its candidates pre-screened since the review of wave D: offers.ts), and a search or re-filter under way waits
 *   for it.
 * - `cancel` { id }: stops that search or re-filter (a `cancelled` reply follows); anything else is ignored.
 *
 * The evaluation context (evaluate.ts buildTradeContext: projections, scenarios, every team's free-agent-
 * optimized roster, the baseline simulation) is the slow part, so the worker keeps the last one and reuses it
 * for the next search or analysis of the same league while it still holds (M12): same league, same league
 * data (snapshot.fetchedAt), same model inputs (ModelInputs.builtAt), same "my team", and the same settings the
 * context reads (settingsStore.ts TRADE_CONTEXT_SETTINGS, by fingerprint: the League model's but "Drop from the same
 * position", which only Waiver upgrades reads, the final review of Checkpoint 7e, RT-2; the search's own settings are per
 * call), and no NFL kickoff (ModelInputs.nfl.kickoffs) between the time it was built for and the request's: a
 * game that kicks off no longer counts (§6 step 7), so the numbers change at kickoffs. ⚠️ Ours, on top of M12:
 * the trade deadline's two readings (acceptance.ts urgencyTerm and tradeDeadlinePassed) must be the same at both
 * times too, since crossing either changes the context (deadline urgency; "Your league's trade deadline has
 * passed").
 *
 * The settings cross a message boundary, so they go through normalizeTradeSettings first: a request
 * without them, or with a damaged copy, gets the defaults rather than an error.
 *
 * The handler (createEngineHandler) is a plain function that replies through a callback, so tests run it
 * without a real Worker (with fakes for the engine and a timer of their own), and the page runs the same
 * handler on its main thread when the browser has no Worker support (src/lib/engineClient.ts). The listener
 * is registered only when this module runs as a worker.
 */
import { analyzeTrade, baselineRosterMoves, buildTradeContext, laterNumbers, tradeInternals, withWords, type TradeAnalysis, type TradeContext, type TradeInternals } from "@/engine/evaluate";
import type { ModelInputs } from "@/engine/inputs";
import { buildLeagueModel, buildLeagueModelWithContext, rateWaiverUpgrades, type BuildLeagueModelOptions, type LeagueModelBuild } from "@/engine/league";
import type { LeagueModel, WaiverUpgrades } from "@/engine/leagueModel";
import type { LeagueSnapshot } from "@/engine/model";
import { offerLadderOfProposal, offerLadderOfSearch, proposalFromKey } from "@/engine/offers";
import { refilterSearch, searchStateOf, tradeSearch } from "@/engine/search";
import { normalizeTradeSettings, type TradeSettings } from "@/engine/settings";
import type { LaterNumbers, OfferLadder, TradeAsset, TradeEvaluation, TradeEvaluationCore, TradeProposal, TradeSearchProgress, TradeSearchResult } from "@/engine/tradeModel";
import { waiverRatingPending } from "@/engine/waivers";
import { LEAGUE_MODEL_SETTINGS, TRADE_CONTEXT_SETTINGS, TRADE_SETTINGS, settingsFingerprint } from "@/lib/settingsStore";
import { contextStillValid } from "./freshness";

/** What every engine job carries: the league, its model inputs, "my team", the time and the league's settings. */
interface LeagueJobFields {
  /** Request id: the replies carry it, so the caller can ignore replies to requests it dropped. */
  id: number;
  snapshot: LeagueSnapshot;
  model: ModelInputs;
  myTeamId: string | null;
  /** The moment the numbers are for (ISO): a game that kicked off before it no longer counts (§6 step 7). */
  nowIso: string;
  /** The user's settings for this league (src/lib/settingsStore.ts), normalized here; missing or damaged = the defaults. */
  settings: TradeSettings;
}

/** Build the League model for this snapshot, with "my team" as the user picked it. */
export interface LeagueRequest extends LeagueJobFields {
  type: "league";
  /**
   * The page asks for the "Rest of season" list's rating next (`waivers`), so the build is kept for it (the header). Only the
   * League page sets it; the Settings page's playoff-weight build never asks, so it keeps nothing (review of wave C,
   * RC-ENG-6: it held a build of 15–26 MB while that page was open).
   */
  keepForWaivers?: boolean;
}

/** Search for trade ideas (§12): with every other team, or only `partnerId`. */
export interface TradesRequest extends LeagueJobFields {
  type: "trades";
  partnerId: string | null;
}

/**
 * Rank a finished search's ideas again with the settings' minimum chance (the header: Phase 4c). It carries a search's
 * every field, so the worker can search afresh when it can't re-filter.
 */
export interface RefilterRequest extends LeagueJobFields {
  type: "refilter";
  /** The id of the search, or earlier re-filter, whose ideas to rank again (-1: none known: a new search). */
  of: number;
  partnerId: string | null;
}

/** Evaluate one trade (the Trade Analyzer, §13). */
export interface AnalyzeRequest extends LeagueJobFields {
  type: "analyze";
  proposal: TradeProposal;
  /**
   * false: without "Offer first / if they say no" (the trade opened from a card's "If they say no, try:": the header);
   * absent or true: as analyzeTrade gives it.
   */
  steps?: boolean;
}

/** "Waiver upgrades" with the season list rated by Helps you (the header: Checkpoint 7e), for the job a League model was built for. */
export interface WaiversRequest extends LeagueJobFields {
  type: "waivers";
}

/**
 * Which card "How to offer it" is for (the header, `offers`): a Trade Finder card, by the id of the search or re-filter whose
 * result holds it (engineClient.ts searchResultIdOf; -1 when unknown) and its key (TradeEvaluation.key), with (the review of
 * wave D, D-ENG-3) its trade in its own order (`proposal`), which the worker reads when it no longer keeps that result; or the
 * Trade Analyzer's card, by its proposal. `barred`, the keys no offer of it could be (its Plan B, which the page sent until
 * Checkpoint 7f), is still read so an older page's request answers, and ignored (the header, `offers`). `prefer` (Checkpoint
 * 7g), the versions its ladder prefers as its search recorded them (TradeSearchResult.offerPrefer), which the worker reads when
 * it no longer keeps that result; a request without it (an older page's) still answers.
 */
export type OffersSource = { kind: "search"; resultId: number; key: string; proposal?: TradeProposal; barred?: string[]; prefer?: string[] } | { kind: "analysis"; proposal: TradeProposal };

/** A card's "How to offer it", offers in order (the header: Checkpoint 7e, item 4.1; src/engine/offers.ts). */
export interface OffersRequest extends LeagueJobFields {
  type: "offers";
  source: OffersSource;
}

/** Stop the search with this id. */
export interface CancelRequest {
  type: "cancel";
  id: number;
}

export type EngineRequest = LeagueRequest | TradesRequest | RefilterRequest | AnalyzeRequest | WaiversRequest | OffersRequest | CancelRequest;

/** My odds before any trade, every team at its free-agent-optimized roster: the search's TradeSearchResult.baseline. */
export type BaselineOdds = TradeSearchResult["baseline"];

/**
 * The Trade Analyzer's reply: the evaluation (evaluate.ts analyzeTrade) and my odds before any trade, the same ones the
 * search reports (contextBaseline; null without a team or a simulated season), so the Analyzer's card gives its odds the
 * same end points as the Trade Finder's.
 */
export type AnalyzerResult = TradeAnalysis & { baseline: BaselineOdds | null };

export type EngineResponse =
  | { type: "league"; id: number; result: LeagueModel }
  /** A search under way: the stage and how far it is (the progress bar). */
  | { type: "progress"; id: number; progress: TradeSearchProgress }
  | { type: "trades"; id: number; result: TradeSearchResult }
  | { type: "analysis"; id: number; result: AnalyzerResult }
  /** The rated "Waiver upgrades" (null without my team). */
  | { type: "waivers"; id: number; result: WaiverUpgrades | null }
  /** A card's "How to offer it" (the header, `offers`: Checkpoint 7e). */
  | { type: "offers"; id: number; result: OfferLadder }
  /**
   * Checkpoint 7e (the header, `later`): some of the "now or after this week" numbers of the cards of search or re-filter `id`,
   * in the order they were made; `done` with the last of them; `detail` when a line failed (the job ends there).
   */
  | { type: "later"; id: number; result: LaterLine[]; done: boolean; detail?: string }
  /** A search stopped by a `cancel` or superseded by a newer search: nothing more comes for it. */
  | { type: "cancelled"; id: number }
  /** `message` is for people; `detail` (the error itself) is for the console. */
  | { type: "error"; id: number; message: string; detail?: string };

export const ENGINE_ERROR_MESSAGE = "Something went wrong while crunching the numbers.";

/** About this many milliseconds of search work run between two looks at the worker's messages (M12: 30–50 ms). */
export const SEARCH_SLICE_MS = 40;

/** Results of finished searches and re-filters kept for a re-filter (the header): the last few, like the Trade Finder's memory. */
export const KEPT_RESULTS = 4;

/**
 * One card's "now or after this week" numbers (Checkpoint 7e; the header, `later`): its key (TradeEvaluation.key) and its
 * numbers (evaluate.ts laterNumbers), null when its context gives none (evaluate.ts laterApplies: a week under way, no week
 * after this one, the trade deadline within config.explain.nowOrLaterWeeks weeks, no odds) or its exact trade isn't known.
 */
export interface LaterLine {
  key: string;
  later: LaterNumbers | null;
}

/** A finished search's or re-filter's cards, and how to make each one's numbers (the header, `later`; EngineHandlerDeps.laterSource). */
export interface LaterSource {
  /** The cards' keys (cardKeysOf). */
  keys: string[];
  line(key: string): LaterNumbers | null;
}

/** The keys of a result's cards, each once: the Overall list's in its order, then the "Helps both" list's others. */
export function cardKeysOf(result: Pick<TradeSearchResult, "trades" | "helpsBoth">): string[] {
  return [...new Set([...result.trades, ...(result.helpsBoth?.trades ?? [])].map((t) => t.key))];
}

/**
 * The cards of a search's or re-filter's result and their "now or after this week" numbers (the header, `later`): each card's
 * exact trade from the result's search state (search.ts searchStateOf: the engine's own result object, never a copy), on the
 * context and with the settings the search ran with (evaluate.ts laterNumbers). Null for a result without cards; each line
 * null for one no search ranked (no state).
 */
export function laterSourceOf(result: TradeSearchResult): LaterSource | null {
  const keys = cardKeysOf(result);
  if (!keys.length) return null;
  const state = searchStateOf(result);
  if (!state) return { keys, line: () => null };
  return {
    keys,
    line: (key) => {
      const x = state.exactByKey.get(key);
      return x ? laterNumbers(state.I, x, state.settings) : null;
    },
  };
}

export interface EngineHandlerDeps {
  /** The League model builder (tests pass a fake): given, `league` uses it and keeps no build (the `waivers` request then builds). */
  build?: typeof buildLeagueModel;
  /** The League model builder that keeps its build (the header, `waivers`), and the rating of a kept build (tests pass fakes). */
  buildWithContext?: typeof buildLeagueModelWithContext;
  rateWaivers?: typeof rateWaiverUpgrades;
  /** The trade engine (tests pass fakes): the evaluation context, the search generator and the Analyzer. */
  buildContext?: typeof buildTradeContext;
  search?: typeof tradeSearch;
  analyze?: typeof analyzeTrade;
  /** Re-filtering (search.ts; tests pass fakes): a finished search's state by its result, and the re-ranking generator. */
  searchState?: typeof searchStateOf;
  refilter?: typeof refilterSearch;
  /** My odds before any trade in a context (default contextBaseline; tests with fake contexts pass their own). */
  baseline?: (ctx: TradeContext) => BaselineOdds | null;
  /**
   * My moves made with or without any trade in a context (Checkpoint 7h; default contextBaselineMoves; tests with fake contexts
   * pass their own), added to every search's and re-filter's result posted (TradeSearchResult.baselineMoves).
   */
  baselineMoves?: (ctx: TradeContext) => TradeSearchResult["baselineMoves"];
  /** An evaluation's words made again (default: evaluate.ts withWords in the context; tests with fake contexts pass their own). */
  reword?: (ctx: TradeContext, core: TradeEvaluationCore) => TradeEvaluation;
  /** A finished result's cards and their "now or after this week" numbers (the header, `later`; default laterSourceOf; tests pass fakes). */
  laterSource?: (result: TradeSearchResult) => LaterSource | null;
  /**
   * "How to offer it" (the header, `offers`; src/engine/offers.ts; tests pass fakes): a card's ladder from a finished search's
   * result (null when the result can't give it: no state, no such card), and any proposal's on a context.
   */
  offersOfSearch?: typeof offerLadderOfSearch;
  offersOfProposal?: typeof offerLadderOfProposal;
  /** Milliseconds for the engine's stage timings (performance.now in the browser); also times the search's slices. */
  clock?: () => number;
  /** Runs `fn` once the messages already waiting have been handled (default setTimeout 0). */
  schedule?: (fn: () => void) => void;
  /** Search work per slice in milliseconds (default SEARCH_SLICE_MS). */
  sliceMs?: number;
}

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

function isAsset(x: unknown): x is TradeAsset {
  if (!isRecord(x)) return false;
  if (x.kind === "player") return typeof x.id === "string" && x.id.length > 0;
  return x.kind === "pick" && typeof x.season === "number" && typeof x.round === "number" && typeof x.originalTeamId === "string";
}

/** A proposal that crossed the message boundary: a partner and two lists of assets (the engine judges the rest). */
export function isProposal(x: unknown): x is TradeProposal {
  return isRecord(x) && typeof x.partnerId === "string" && Array.isArray(x.give) && Array.isArray(x.get) && x.give.every(isAsset) && x.get.every(isAsset);
}

/** Whether two proposals are the same trade: the same partner and the same assets on each side, in any order (the card's own order against its key's). */
function sameTrade(a: TradeProposal, b: TradeProposal): boolean {
  const side = (xs: readonly TradeAsset[]) => xs.map((x) => (x.kind === "player" ? x.id : `pick:${x.season}:${x.round}:${x.originalTeamId}`)).sort().join(",");
  return a.partnerId === b.partnerId && side(a.give) === side(b.give) && side(a.get) === side(b.get);
}

/** A card's source that crossed the message boundary (OffersSource): a search's card by result id and key, or a proposal. */
function isOffersSource(x: unknown): x is OffersSource {
  if (!isRecord(x)) return false;
  if (x.kind === "search") {
    const proposalOk = x.proposal === undefined || isProposal(x.proposal);
    const barredOk = x.barred === undefined || (Array.isArray(x.barred) && x.barred.every((k) => typeof k === "string"));
    const preferOk = x.prefer === undefined || (Array.isArray(x.prefer) && x.prefer.every((k) => typeof k === "string"));
    return typeof x.resultId === "number" && typeof x.key === "string" && x.key.length > 0 && proposalOk && barredOk && preferOk;
  }
  return x.kind === "analysis" && isProposal(x.proposal);
}

function isJob(x: unknown): x is LeagueRequest | TradesRequest | RefilterRequest | AnalyzeRequest | WaiversRequest | OffersRequest {
  if (!isRecord(x)) return false;
  const r = x as Partial<LeagueJobFields> & { type?: unknown; partnerId?: unknown; proposal?: unknown; of?: unknown; source?: unknown };
  const common =
    typeof r.id === "number" &&
    !!r.snapshot &&
    typeof r.snapshot === "object" &&
    !!r.model &&
    typeof r.model === "object" &&
    (r.myTeamId === null || typeof r.myTeamId === "string") &&
    typeof r.nowIso === "string";
  if (!common) return false;
  const partnerOk = r.partnerId === undefined || r.partnerId === null || typeof r.partnerId === "string";
  if (r.type === "league" || r.type === "waivers") return true;
  if (r.type === "trades") return partnerOk;
  if (r.type === "refilter") return partnerOk && typeof r.of === "number";
  if (r.type === "analyze") return isProposal(r.proposal);
  if (r.type === "offers") return isOffersSource(r.source);
  return false;
}

/** A generator that gives `first` (a step already taken) and then the rest of `g` (refilterSearch's first step is taken to see whether it runs). */
function* resumed<P, R>(first: IteratorResult<P, R>, g: Generator<P, R, void>): Generator<P, R, void> {
  if (first.done) return first.value;
  yield first.value;
  return yield* g;
}

/** A generator that returns `result` at once (a re-filter of a search that stopped before ranking: its result holds). */
function* already<P, R>(result: R): Generator<P, R, void> {
  return result;
}

function isCancel(x: unknown): x is CancelRequest {
  return isRecord(x) && x.type === "cancel" && typeof x.id === "number";
}

function errorDetail(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/**
 * What a cached evaluation context is for (see the header): the league and its data, the inputs' build, my team
 * and the settings the context reads (`fields`: TRADE_CONTEXT_SETTINGS; the League page's kept build, whose Waiver
 * upgrades read "Drop from the same position" too, passes LEAGUE_MODEL_SETTINGS). The time is checked apart
 * (contextStillValid).
 */
export function contextKey(req: Pick<LeagueJobFields, "snapshot" | "model" | "myTeamId">, settings: TradeSettings, fields: readonly (keyof TradeSettings)[] = TRADE_CONTEXT_SETTINGS): string {
  const s = req.snapshot;
  return [s.platform, s.leagueId, s.season, s.fetchedAt, req.model.builtAt, req.myTeamId ?? "-", settingsFingerprint(settings, fields)].join("|");
}

/**
 * Whether a context built for `builtForMs` still holds at `nowMs` (epoch ms; see the header): no kickoff in
 * between, and the same deadline urgency and deadline-passed readings at both times. It lives in ./freshness.ts,
 * client-safe, since the Trade Finder reads the same rule for the ideas it remembers.
 */
export { contextStillValid };

/**
 * My odds before any trade in a context, exactly as the search reports them (search.ts: TradeSearchResult.baseline, the
 * shown block of seasons with every team at its free-agent-optimized roster: the League page's headline, Checkpoint 7e). Null without a team or a simulated
 * season, and for a context the engine didn't build (the tests' fakes).
 */
export function contextBaseline(ctx: TradeContext): BaselineOdds | null {
  let I: TradeInternals;
  try {
    I = tradeInternals(ctx);
  } catch {
    return null;
  }
  const base = I.sim && I.me ? I.sim.base.shown : null;
  return base ? { pPlayoffs: base.pPlayoffs, pTitle: base.pTitle, expWins: base.expWins, prizes: { ...base.prizes } } : null;
}

/**
 * My moves made with or without any trade in a context (Checkpoint 7h; planner reply to Checkpoint 7g, §1: the Trade Finder says
 * "Assumed with or without this trade" once, above its list): evaluate.ts baselineRosterMoves' assumed line, the League page's
 * pickups and my IR returns' releases. Null without a team of mine, for a context the engine didn't build (the tests' fakes),
 * or when it can't be worked out (the list's cards then name their own, as before).
 */
export function contextBaselineMoves(ctx: TradeContext): TradeSearchResult["baselineMoves"] {
  try {
    const moves = baselineRosterMoves(ctx);
    return moves ? { assumed: moves.assumed, ...(moves.assumedLater?.length ? { assumedLater: moves.assumedLater } : {}) } : null;
  } catch {
    return null;
  }
}

/** An evaluation's reasons and pitch made again in its context (evaluate.ts withWords: explain.ts's words, the injury tags). */
const defaultReword = (ctx: TradeContext, core: TradeEvaluationCore): TradeEvaluation => withWords(tradeInternals(ctx), core);

/**
 * An Analyzer evaluation without "Offer first / if they say no" (the header: `steps: false`): the same numbers, its steps
 * dropped and its words made again without them, so the pitch proposes the trade itself (explain.ts names the offer-first
 * version when steps exist). Unchanged when it has no steps.
 */
export function withoutSteps(ctx: TradeContext, analysis: TradeAnalysis, reword: (ctx: TradeContext, core: TradeEvaluationCore) => TradeEvaluation = defaultReword): TradeAnalysis {
  const e = analysis.evaluation;
  if (!e?.steps) return analysis;
  const { steps: _steps, reasons: _reasons, pitch: _pitch, ...core } = e;
  void _steps;
  void _reasons;
  void _pitch;
  return { ...analysis, evaluation: reword(ctx, core) };
}

const defaultClock = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
const defaultSchedule = (fn: () => void): void => void setTimeout(fn, 0);

/**
 * The engine's message handler: call the returned function with each message; replies go to `post` (now, or
 * later for a search). One instance keeps the cached context and the search under way, so a worker (or the
 * page's main-thread fallback) makes exactly one. Never throws: a failure becomes an `error` reply with the
 * request's id (-1 when the message has none).
 */
export function createEngineHandler(post: (response: EngineResponse) => void, deps: EngineHandlerDeps = {}): (message: unknown) => void {
  const build = deps.build;
  const buildWithContext = deps.buildWithContext ?? buildLeagueModelWithContext;
  const rateWaivers = deps.rateWaivers ?? rateWaiverUpgrades;
  const buildContext = deps.buildContext ?? buildTradeContext;
  const search = deps.search ?? tradeSearch;
  const analyze = deps.analyze ?? analyzeTrade;
  const stateOf = deps.searchState ?? searchStateOf;
  const refilter = deps.refilter ?? refilterSearch;
  const baselineOf = deps.baseline ?? contextBaseline;
  const baselineMovesOf = deps.baselineMoves ?? contextBaselineMoves;
  /** A result as it's posted: with my baseline's moves on the context it ran on (Checkpoint 7h), the engine's own object kept apart. */
  const posted = (result: TradeSearchResult, ctx: TradeContext | null): TradeSearchResult => {
    const moves = ctx ? baselineMovesOf(ctx) : null;
    return moves ? { ...result, baselineMoves: moves } : result;
  };
  const reword = deps.reword ?? defaultReword;
  const laterSource = deps.laterSource ?? laterSourceOf;
  const offersOfSearch = deps.offersOfSearch ?? offerLadderOfSearch;
  const offersOfProposal = deps.offersOfProposal ?? offerLadderOfProposal;
  const schedule = deps.schedule ?? defaultSchedule;
  const sliceClock = deps.clock ?? defaultClock;
  const sliceMs = deps.sliceMs ?? SEARCH_SLICE_MS;
  // The engine's own timings only when a clock was given (the tests check that none is passed otherwise).
  const timing = deps.clock ? { clock: deps.clock } : {};

  let cached: { key: string; builtForMs: number; ctx: TradeContext } | null = null;
  /**
   * The context an `offers` request built because the kept one (`cached`) isn't the request's (the header, `offers`): never
   * the searches' own, so an offer never costs a re-filter its search; dropped once a search or re-filter answers, or
   * `cached` is built again.
   */
  let aside: { key: string; builtForMs: number; ctx: TradeContext } | null = null;
  /**
   * The last `league` request's build (the header, `waivers`): its key (contextKey), its moment, the build, the inputs and
   * options it was made with. Replaced by the next one; none with a fake builder (deps.build).
   */
  let keptLeague: { key: string; nowIso: string; built: LeagueModelBuild; inputs: ModelInputs; opts: BuildLeagueModelOptions } | null = null;
  /** The search or re-filter under way (one at a time); null when none. */
  let active: { id: number } | null = null;
  /**
   * The last KEPT_RESULTS finished searches' and re-filters' results by request id (the objects the engine returned: a
   * re-filter reads their state), each with its search's own timings. Forgotten with the context they ran on.
   */
  const results = new Map<number, { result: TradeSearchResult; searchTimings: Record<string, number> }>();
  const keep = (id: number, result: TradeSearchResult, searchTimings: Record<string, number>) => {
    results.delete(id);
    results.set(id, { result, searchTimings });
    while (results.size > KEPT_RESULTS) results.delete(results.keys().next().value as number);
  };

  const fail = (id: number, err: unknown) => post({ type: "error", id, message: ENGINE_ERROR_MESSAGE, detail: errorDetail(err) });

  /**
   * The ladders built (the header, `offers`), by card key: a Finder card's under the result object it came from (gone with the
   * result), any other under its context with the request's settings (gone with the context).
   */
  const ladders = new WeakMap<object, Map<string, OfferLadder>>();
  const ladderIn = (owner: object, key: string, make: () => OfferLadder | null): OfferLadder | null => {
    const known = ladders.get(owner)?.get(key);
    if (known) return known;
    const made = make();
    if (!made) return null;
    const map = ladders.get(owner) ?? new Map<string, OfferLadder>();
    map.set(key, made);
    ladders.set(owner, map);
    return made;
  };

  /**
   * A card's "How to offer it" (the header, `offers`): a Finder card from the result the worker keeps under its id (since
   * Checkpoint 7f the very ladder the search's merge read, when it did: offers.ts offerLadderOfSearch), else (⚠️ a result no
   * longer kept) its trade (the source's proposal when it's the trade the key names, else the key's), built the Analyzer's way
   * on the context for the request (the source's barred keys, which an older page sends, ignored: nothing is barred since
   * Checkpoint 7f), with since Checkpoint 7g the preference its search recorded (the source's `prefer`, in the ladder's key);
   * the Analyzer's card from its proposal. The context: the kept one when it's the request's, else the `aside` slot's
   * (offersContext).
   */
  function offersFor(req: OffersRequest, now: Date, settings: TradeSettings): OfferLadder {
    const src = req.source;
    if (src.kind === "search") {
      const kept = results.get(src.resultId)?.result;
      const fromSearch = kept ? ladderIn(kept, src.key, () => offersOfSearch(kept, src.key, timing)) : null;
      if (fromSearch) return fromSearch;
    }
    const fromKey = src.kind === "search" ? proposalFromKey(src.key) : null;
    const proposal = src.kind === "analysis" ? src.proposal : src.proposal && fromKey && sameTrade(src.proposal, fromKey) ? src.proposal : fromKey;
    if (!proposal) throw new Error("The card's trade can't be read from its key.");
    const ctx = offersContext(req, now, settings);
    const scope = src.kind === "analysis" ? "analysis" : "finder";
    const prefer = src.kind === "search" ? [...new Set(src.prefer ?? [])].sort() : [];
    const made = ladderIn(ctx, `${scope}|${settingsFingerprint(settings, TRADE_SETTINGS)}|${JSON.stringify(proposal)}|${prefer.join(";")}`, () =>
      offersOfProposal(ctx, proposal, { settings, page: scope, ...(prefer.length ? { prefer } : {}), ...timing }),
    );
    return made as OfferLadder;
  }

  /**
   * The context an `offers` request is worked out on (the header, `offers`): the kept one when it's the request's (contextFor's
   * rule), else the `aside` slot's, built for the request when it isn't the request's either: never `cached` replaced, nor
   * the kept results forgotten.
   */
  function offersContext(req: OffersRequest, now: Date, settings: TradeSettings): TradeContext {
    const key = contextKey(req, settings);
    const nowMs = now.getTime();
    if (cached && cached.key === key && contextStillValid(cached.builtForMs, nowMs, req.model, req.snapshot)) return cached.ctx;
    if (aside && aside.key === key && contextStillValid(aside.builtForMs, nowMs, req.model, req.snapshot)) return aside.ctx;
    aside = null; // a build that fails leaves nothing behind
    const ctx = buildContext({ ...req.snapshot, myTeamId: req.myTeamId }, req.model, { now, settings, ...timing });
    aside = { key, builtForMs: nowMs, ctx };
    return ctx;
  }

  function contextFor(req: TradesRequest | RefilterRequest | AnalyzeRequest, now: Date, settings: TradeSettings): TradeContext {
    const key = contextKey(req, settings);
    const nowMs = now.getTime();
    if (cached && cached.key === key && contextStillValid(cached.builtForMs, nowMs, req.model, req.snapshot)) return cached.ctx;
    cached = null; // a build that fails leaves nothing behind
    results.clear(); // their states belong to the context that goes
    aside = null; // an `offers` request's own: the searches' context is built again (the header, `offers`)
    const ctx = buildContext({ ...req.snapshot, myTeamId: req.myTeamId }, req.model, { now, settings, ...timing });
    cached = { key, builtForMs: nowMs, ctx };
    return ctx;
  }

  function stopActive(): void {
    if (!active) return;
    const stopped = active;
    active = null;
    post({ type: "cancelled", id: stopped.id });
  }

  /**
   * The "now or after this week" jobs (the header, `later`), the newest first: each answered search's or re-filter's request id,
   * its cards' keys, the next one to make and how. They run while no search or re-filter is under way (`active`), one slice
   * at a time (at least one card), the newest job first.
   */
  const laterJobs: { id: number; keys: string[]; next: number; line: LaterSource["line"] }[] = [];
  let laterScheduled = false;

  /** Schedules the next slice of line work, unless one is scheduled, a search or re-filter runs (it pumps again when it ends) or none is left. */
  function pumpLater(): void {
    if (laterScheduled || active || !laterJobs.length) return;
    laterScheduled = true;
    schedule(laterSlice);
  }

  /** One slice of line work: the newest job's next cards (about sliceMs, at least one), posted together, `done` with its last. */
  function laterSlice(): void {
    laterScheduled = false;
    if (active) return;
    // A result the worker no longer keeps (KEPT_RESULTS, or a new context) isn't one a re-filter or the page will come back to.
    while (laterJobs.length && !results.has((laterJobs[0] as (typeof laterJobs)[number]).id)) laterJobs.shift();
    const job = laterJobs[0];
    if (!job) return;
    const begin = sliceClock();
    const lines: LaterLine[] = [];
    let detail: string | undefined;
    try {
      while (job.next < job.keys.length) {
        const key = job.keys[job.next] as string;
        job.next++;
        lines.push({ key, later: job.line(key) });
        if (sliceClock() - begin >= sliceMs) break;
      }
    } catch (err) {
      // A card's numbers that can't be made end the job: its cards just show no line.
      detail = errorDetail(err);
      job.next = job.keys.length;
    }
    const done = job.next >= job.keys.length;
    if (done) laterJobs.shift();
    post({ type: "later", id: job.id, result: lines, done, ...(detail !== undefined ? { detail } : {}) });
    pumpLater();
  }

  /** A job for the cards of a result just answered (`result`: the engine's own object, with its search state), the first in line. */
  function queueLater(id: number, result: TradeSearchResult): void {
    let source: LaterSource | null;
    try {
      source = laterSource(result);
    } catch (err) {
      post({ type: "later", id, result: [], done: true, detail: errorDetail(err) });
      return;
    }
    if (!source || !source.keys.length) return;
    laterJobs.unshift({ id, keys: source.keys, next: 0, line: source.line });
    pumpLater();
  }

  /**
   * Runs one search or re-filter (one at a time: it stops the one before) in slices of about sliceMs of work: `first` is
   * posted at once; `start`, at the first slice, makes the generator (building the context is one piece of work, and a
   * slice boundary follows it); `finish` turns the generator's result into the one posted.
   */
  function runSliced(id: number, first: TradeSearchProgress, start: () => Generator<TradeSearchProgress, TradeSearchResult, void>, finish: (result: TradeSearchResult) => TradeSearchResult): void {
    stopActive();
    const run = { id };
    active = run;
    post({ type: "progress", id, progress: first });
    let it: Generator<TradeSearchProgress, TradeSearchResult, void> | null = null;
    const step = () => {
      if (active !== run) return; // stopped or superseded
      try {
        if (!it) {
          it = start();
          schedule(step);
          return;
        }
        const begin = sliceClock();
        let last: TradeSearchProgress | null = null;
        for (;;) {
          const r = it.next();
          if (r.done) {
            active = null;
            aside = null; // the ideas an `offers` request's own context was for are a search behind now (the header, `offers`)
            post({ type: "trades", id, result: finish(r.value) });
            // Its cards' "now or after this week" numbers next (the header, `later`), then any older job's.
            queueLater(id, r.value);
            pumpLater();
            return;
          }
          last = r.value;
          if (sliceClock() - begin >= sliceMs) break;
        }
        if (last) post({ type: "progress", id, progress: last });
        schedule(step);
      } catch (err) {
        if (active === run) active = null;
        fail(id, err);
        pumpLater();
      }
    };
    schedule(step);
  }

  /** A search's generator on the context the request names (a new search: kept by its id when it finishes). */
  const searchOn = (ctx: TradeContext, req: TradesRequest | RefilterRequest, settings: TradeSettings) => search(ctx, { settings, partnerId: req.partnerId ?? null, ...timing });

  function startSearch(req: TradesRequest, now: Date, settings: TradeSettings): void {
    let ran: TradeContext | null = null;
    runSliced(
      req.id,
      { stage: "setup", done: 0, total: 1 },
      () => {
        ran = contextFor(req, now, settings);
        return searchOn(ran, req, settings);
      },
      (result) => {
        keep(req.id, result, result.timings);
        return posted(result, ran);
      },
    );
  }

  /** A re-filter (the header): the kept result's ideas ranked again, else what stands in for it. */
  function startRefilter(req: RefilterRequest, now: Date, settings: TradeSettings): void {
    const prior = results.get(req.of);
    let path: "refilter" | "same" | "search" = "search";
    let ran: TradeContext | null = null;
    runSliced(
      req.id,
      { stage: "rank", done: 0, total: 1 },
      () => {
        const ctx = contextFor(req, now, settings);
        ran = ctx;
        // contextFor forgets the kept results when it builds a new context: then `prior` ran on another one.
        if (prior && results.get(req.of) === prior) {
          const state = stateOf(prior.result);
          if (state === null) {
            path = "same"; // stopped before ranking: its result holds for any minimum
            return already<TradeSearchProgress, TradeSearchResult>(prior.result);
          }
          const g = refilter(ctx, state, { minChance: settings.minChance, ...timing });
          try {
            const firstStep = g.next(); // refilterSearch refuses a state of another context here
            path = "refilter";
            return resumed(firstStep, g);
          } catch {
            // Another context (a kickoff since): a new search below.
          }
        }
        path = "search";
        return searchOn(ctx, req, settings);
      },
      (result) => {
        if (path === "search" || !prior) {
          keep(req.id, result, result.timings);
          return posted(result, ran);
        }
        keep(req.id, result, prior.searchTimings);
        if (path === "same") return posted(result, ran);
        // The page says how long the search took: its own timings, the re-filter's time apart.
        const took = result.timings.total;
        return posted({ ...result, timings: { ...prior.searchTimings, ...(typeof took === "number" ? { refilter: took } : {}) } }, ran);
      },
    );
  }

  return (message: unknown) => {
    if (isCancel(message)) {
      if (active?.id === message.id) {
        stopActive();
        pumpLater(); // the older jobs resume (the header, `later`)
      }
      return;
    }
    const rawId = isRecord(message) ? message.id : undefined;
    const id = typeof rawId === "number" ? rawId : -1;
    if (!isJob(message)) {
      post({ type: "error", id, message: ENGINE_ERROR_MESSAGE, detail: "Not an engine request." });
      return;
    }
    const now = new Date(message.nowIso);
    if (Number.isNaN(now.getTime())) {
      post({ type: "error", id, message: ENGINE_ERROR_MESSAGE, detail: "The request's time isn't a date." });
      return;
    }
    const settings = normalizeTradeSettings(message.settings);
    switch (message.type) {
      case "league":
        try {
          const snap = { ...message.snapshot, myTeamId: message.myTeamId };
          if (build) {
            post({ type: "league", id, result: build(snap, message.model, { now, settings, ...timing }) });
            return;
          }
          // Without the waiver rating (the header: `waivers` rates it), the build kept for that request when the page will ask
          // for it (keepForWaivers) and the list waits for it, as the page judges (waivers.waiverRatingPending: a season list
          // with a move to rate on the build's odds); a build holds about 15–26 MB on Parker's leagues, its model 1 MB.
          const opts: BuildLeagueModelOptions = { now, settings, waiverRating: false, ...timing };
          keptLeague = null; // a build that fails leaves nothing behind
          const built = buildWithContext(snap, message.model, opts);
          const m = built.model;
          if (message.keepForWaivers === true && waiverRatingPending(m)) keptLeague = { key: contextKey(message, settings, LEAGUE_MODEL_SETTINGS), nowIso: message.nowIso, built, inputs: message.model, opts };
          post({ type: "league", id, result: m });
        } catch (err) {
          fail(id, err);
        }
        return;
      case "waivers":
        try {
          // The kept build when it's this job's (the same key and moment), else the League model built again for the job
          // (not kept: the kept build stays the last `league` request's); rated either way.
          const kept = keptLeague && keptLeague.key === contextKey(message, settings, LEAGUE_MODEL_SETTINGS) && keptLeague.nowIso === message.nowIso ? keptLeague : null;
          const opts: BuildLeagueModelOptions = { now, settings, waiverRating: false, ...timing };
          const job = kept ?? { built: buildWithContext({ ...message.snapshot, myTeamId: message.myTeamId }, message.model, opts), inputs: message.model, opts };
          // The request's own settings: "Protect my trade value" and Win now ↔ Future, which the rating reads and the key
          // doesn't (review of wave C, RC-ENG-4; league.ts rateWaiverUpgrades), are this request's, not the kept build's.
          const result = rateWaivers(job.built, job.inputs, { ...job.opts, settings });
          // Rated once (the page asks once per model: engineClient.waiverRatingFor), so the kept build's memory goes.
          if (kept && keptLeague === kept) keptLeague = null;
          post({ type: "waivers", id, result });
        } catch (err) {
          fail(id, err);
        }
        return;
      case "trades":
        startSearch(message, now, settings);
        return;
      case "refilter":
        startRefilter(message, now, settings);
        return;
      case "analyze":
        try {
          const ctx = contextFor(message, now, settings);
          const analyzed = analyze(ctx, message.proposal, { settings, ...timing });
          // A Plan B opened in the Analyzer: one offer, without a smaller first offer (the header).
          const analysis = message.steps === false ? withoutSteps(ctx, analyzed, reword) : analyzed;
          post({ type: "analysis", id, result: { ...analysis, baseline: baselineOf(ctx) } });
        } catch (err) {
          fail(id, err);
        }
        return;
      case "offers":
        try {
          post({ type: "offers", id, result: offersFor(message, now, settings) });
        } catch (err) {
          fail(id, err);
        }
        return;
    }
  };
}

/** The parts of a dedicated worker's global scope used here (tsconfig's lib has no "webworker"). */
interface WorkerScope {
  postMessage(message: EngineResponse): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

/** This module's global scope when it runs as a dedicated worker; null on a page and in Node. */
function workerScope(): WorkerScope | null {
  const g = globalThis as { WorkerGlobalScope?: unknown; document?: unknown };
  return typeof g.WorkerGlobalScope === "function" && g.document === undefined ? (globalThis as unknown as WorkerScope) : null;
}

const scope = workerScope();
if (scope) {
  const handle = createEngineHandler((response) => scope.postMessage(response), { clock: () => performance.now() });
  scope.addEventListener("message", (event) => handle(event.data));
}
