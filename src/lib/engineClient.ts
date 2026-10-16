/**
 * Runs the engine off the page's main thread (CLAUDE.md §3: the engine runs in a Web Worker in the
 * browser): one module worker (src/workers/engine.worker.ts), wrapped in promises matched to replies by
 * request id. Three jobs: the League model, the trade search (with progress, and a way to stop it) and the
 * Trade Analyzer's evaluation (Phase 4 wave 2 decision M12).
 *
 * One search at a time: starting a search stops the one before (its promise rejects as cancelled, like
 * Stop), and the worker drops it too. A cancelled search rejects at once, so the page never waits on work
 * it no longer wants; the worker stops it between two slices of work.
 *
 * Without Worker support, or when the worker fails to start or crashes, the same handler runs on the main
 * thread instead (createEngineHandler, loaded on demand): slower to respond, same numbers, and a search there
 * still runs in slices with a timer between them, so the page can paint its progress and take a Stop. A
 * request the worker had when it crashed is sent again there.
 *
 * Only types come from the worker module here, so the engine itself is never part of the page's
 * bundle; the main-thread fallback loads it on demand.
 *
 * Phase 4c (planner reply to Checkpoint 4b, change 11: several saved leagues): createLeagueEngine keeps one client for
 * one league at a time, for the trade pages (src/components/trades/finderMemory.ts). Asking it for another league stops
 * the client before (dispose: its worker goes, with the evaluation context it built and anything pending), so one
 * league's worker never answers for another. ⚠️ The worker's own context key names the league too (engine.worker.ts
 * contextKey), so this is belt and braces, and it frees the old league's memory at the switch.
 *
 * Phase 4c (change 10: "Re-filter instantly from the finalists, without re-running the search"): refilterTrades asks the
 * worker to rank a result's ideas again with the job's minimum chance (engine.worker.ts `refilter`). It names the result
 * by the id of the request that brought it (each result this client hands out is remembered by object, in a WeakMap);
 * a result it didn't hand out goes as -1, and the worker searches afresh. A re-filter is a search here: one at a time
 * with searches, with progress and Stop.
 *
 * Checkpoint 7e (planner reply to Checkpoint 7d, item 3.4; engine.worker.ts `waivers`): rateWaivers asks for "Waiver
 * upgrades" with the "Rest of season" list rated by Helps you, which the League model is built without. Every League model
 * a client hands out is remembered with the client and the job it was built for (a WeakMap by the model object), so the
 * Waivers section, which holds only the model, asks for its rating with waiverRatingFor(model) when it first shows: the
 * same worker, which still holds that build, answers in about a second. One request per model (the promise is kept; a failed
 * one is asked again next time); a model no client built (a test, a page that builds none) has none.
 *
 * Checkpoint 7e (planner reply to Checkpoint 7d, item 4.2, "Now or after this week"; engine.worker.ts `later`): after a search
 * or re-filter answers with cards, the worker posts each card's "Helps you … if done after this week's games" numbers under
 * that request's id as it makes them. The client files them by the result object it handed out for that request (a WeakMap),
 * and laterLinesOf(result) reads them: a new LaterLines each time more arrive (never changed in place), `done` once every
 * card has its own; null for a result without cards, or one no client handed out. watchLaterLines(result, onChange) hears
 * each change (the Trade Finder reads them through useSyncExternalStore). A result's lines are kept while the result lives,
 * so ideas the Finder shows again (coming back from the Analyzer) show their lines at once; a result whose lines the worker
 * dropped (a newer search's took over and the result was forgotten) keeps the ones that came.
 *
 * Checkpoint 7e (planner reply to Checkpoint 7d, item 4.1, "How to offer it"; engine.worker.ts `offers`): offers(job) asks
 * for a card's offers in order (OfferLadder), worked out in the worker when the card's "How to offer it" is opened. A Trade
 * Finder card goes by the id of the request whose result holds it and its key: searchResultIdOf(client, result) gives that
 * id for a result this client handed out (-1 for any other: the worker then works the card out from its trade, the
 * Analyzer's way, the same offers; nothing barred since Checkpoint 7f, so the page sends no keys to bar; another card of its
 * list can be an offer either way, the lead's call, wave D; since Checkpoint 7g the page sends the versions the card's ladder
 * prefers, TradeSearchResult.offerPrefer, which the worker reads that way so the offers stay the search's); the Analyzer's card
 * by its proposal. The worker keeps each ladder (since Checkpoint 7f a search's own for the cards its merge read), so a second
 * open answers at once.
 */
import type { LeagueModel, WaiverUpgrades } from "@/engine/leagueModel";
import type { LaterNumbers, OfferLadder, TradeSearchProgress, TradeSearchResult } from "@/engine/tradeModel";
import type { AnalyzeRequest, AnalyzerResult, EngineRequest, EngineResponse, LeagueRequest, OffersRequest, RefilterRequest, TradesRequest, WaiversRequest } from "@/workers/engine.worker";

/** The parts of a Worker this client uses (a real Worker, or a fake in tests). */
export interface WorkerLike {
  postMessage(message: EngineRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

/** A League model request without the protocol fields the client fills in (the league's settings included: Phase 4 L12). */
export type LeagueJob = Omit<LeagueRequest, "type" | "id">;
/** A trade search request without the protocol fields (partnerId null = every other team). */
export type TradesJob = Omit<TradesRequest, "type" | "id">;
/** A Trade Analyzer request without the protocol fields. */
export type AnalyzeJob = Omit<AnalyzeRequest, "type" | "id">;
/** A re-filter request without the protocol fields: a search's job (its settings carry the new minimum chance) and the result to rank again. */
export type RefilterJob = TradesJob & { result: TradeSearchResult };
/** A "How to offer it" request without the protocol fields: a League job and the card (OffersRequest.source; the header). */
export type OffersJob = Omit<OffersRequest, "type" | "id">;

/** A search under way: its result, and Stop. */
export interface TradeSearchHandle {
  /** The result; rejects with an EngineError (`cancelled` when it was stopped or superseded). */
  promise: Promise<TradeSearchResult>;
  /** Stops the search: the promise rejects as cancelled at once. Does nothing once it has settled. */
  cancel(): void;
}

export interface EngineClient {
  /** Builds the League model; rejects with an EngineError. */
  buildLeague(job: LeagueJob): Promise<LeagueModel>;
  /** Searches for trade ideas; `onProgress` hears each progress step. Stops any search started before it. */
  searchTrades(job: TradesJob, onProgress?: (progress: TradeSearchProgress) => void): TradeSearchHandle;
  /**
   * Ranks a result's ideas again with the job's minimum chance (the header), as a search: progress, Stop, one at a time.
   * The worker searches afresh when it can't (a result it no longer holds, or a kickoff since).
   */
  refilterTrades(job: RefilterJob, onProgress?: (progress: TradeSearchProgress) => void): TradeSearchHandle;
  /** Evaluates one trade (the Trade Analyzer), with my odds before any trade (AnalyzerResult); rejects with an EngineError. */
  analyzeTrade(job: AnalyzeJob): Promise<AnalyzerResult>;
  /**
   * "Waiver upgrades" with the season list rated by Helps you, for the job a League model was built for (the header; null
   * without my team); rejects with an EngineError. waiverRatingFor asks it for a model this client built.
   */
  rateWaivers(job: LeagueJob): Promise<WaiverUpgrades | null>;
  /**
   * A card's "How to offer it", offers in order (the header; engine.worker.ts `offers`): a Trade Finder card by its result's
   * request id (searchResultIdOf) and key, or the Trade Analyzer's by its proposal; rejects with an EngineError.
   */
  offers(job: OffersJob): Promise<OfferLadder>;
  /** Stops the worker. Pending requests reject, and later replies are ignored. */
  dispose(): void;
}

export class EngineError extends Error {
  /** The underlying error, for the console (never shown to people). */
  readonly detail: string | undefined;
  /** The request was stopped (Stop, a newer search, or the page going away), not failed: nothing to show. */
  readonly cancelled: boolean;
  constructor(message: string, detail?: string, cancelled = false) {
    super(message);
    this.name = "EngineError";
    this.detail = detail;
    this.cancelled = cancelled;
  }
}

export const ENGINE_STOPPED = "The number cruncher was stopped.";
export const SEARCH_CANCELLED = "The search was stopped.";
const MAIN_THREAD_FAILED = "We couldn't start the number cruncher. Reload the page and try again.";
const UNEXPECTED_REPLY = "Something went wrong while crunching the numbers.";

/** The engine running on the page's own thread: it takes messages and replies through the `post` it was started with. */
export type MainThreadEngine = (message: EngineRequest) => void;

export interface EngineClientOptions {
  /** Makes the worker; null when there's no Worker support. Default: a module worker for engine.worker.ts. */
  createWorker?: () => WorkerLike | null;
  /** Starts the engine on the main thread (the fallback), replying through `post`. Default: the worker's own handler, loaded on demand. */
  startMainThread?: (post: (response: EngineResponse) => void) => Promise<MainThreadEngine>;
}

function defaultWorker(): WorkerLike | null {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("../workers/engine.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
}

async function defaultMainThread(post: (response: EngineResponse) => void): Promise<MainThreadEngine> {
  const { createEngineHandler } = await import("@/workers/engine.worker");
  return createEngineHandler(post, { clock: () => performance.now() });
}

const RESPONSE_TYPES: ReadonlySet<unknown> = new Set(["league", "progress", "trades", "analysis", "waivers", "later", "offers", "cancelled", "error"]);

/** Each search result a client handed out, with that client and the id of the request it answered (searchResultIdOf). */
const resultOwners = new WeakMap<TradeSearchResult, { client: EngineClient; id: number }>();

/**
 * The id `client`'s worker knows a search result by (OffersRequest's source.resultId: the header), the id of the search or
 * re-filter request that brought it; -1 for a result `client` didn't hand out (another league's, or one from a client since
 * stopped), whose card the worker then works out from its trade (the source's proposal, else its key).
 */
export function searchResultIdOf(client: EngineClient, result: TradeSearchResult): number {
  const owner = resultOwners.get(result);
  return owner && owner.client === client ? owner.id : -1;
}

/**
 * A result's "now or after this week" numbers as they've come so far (the header; engine.worker.ts `later`): by card key
 * (TradeEvaluation.key), null for a card whose context gives none; `done` once every card has its own.
 */
export interface LaterLines {
  lines: ReadonlyMap<string, LaterNumbers | null>;
  done: boolean;
}

/** Each result's lines (the header), by the result object a client handed out: replaced, never changed in place. */
const laterOfResult = new WeakMap<TradeSearchResult, LaterLines>();
/** Who hears each result's lines change (watchLaterLines). */
const laterWatchers = new WeakMap<TradeSearchResult, Set<() => void>>();
/** A client's results whose lines are still coming, kept by request id: the newest this many (older ones keep what came). */
const LATER_TRACKED = 8;

/** The "now or after this week" numbers of a result a client handed out (the header), as they've come so far; null for one without cards or that no client handed out. */
export function laterLinesOf(result: TradeSearchResult): LaterLines | null {
  return laterOfResult.get(result) ?? null;
}

/** Calls `onChange` each time more of `result`'s lines arrive (laterLinesOf reads them); returns a function that stops it. */
export function watchLaterLines(result: TradeSearchResult, onChange: () => void): () => void {
  let set = laterWatchers.get(result);
  if (!set) {
    set = new Set();
    laterWatchers.set(result, set);
  }
  set.add(onChange);
  const mine = set;
  return () => {
    mine.delete(onChange);
  };
}

/** Files lines for `result` (more of them, or `done`) and tells whoever listens. */
function fileLater(result: TradeSearchResult, more: readonly { key: string; later: LaterNumbers | null }[], done: boolean): void {
  const lines = new Map(laterOfResult.get(result)?.lines ?? []);
  for (const l of more) if (l && typeof l.key === "string") lines.set(l.key, l.later ?? null);
  laterOfResult.set(result, { lines, done });
  for (const fn of [...(laterWatchers.get(result) ?? [])]) fn();
}

/** Each League model a client handed out, with the client and the job it was built for (the header; waiverRatingFor). */
const builtBy = new WeakMap<LeagueModel, { client: EngineClient; job: LeagueJob }>();
/** The rating asked for each model, so a model is rated once (waiverRatingFor). */
const ratings = new WeakMap<LeagueModel, Promise<WaiverUpgrades | null>>();

/** Whether a client built `model`, so waiverRatingFor will ask for its rating (the section shows "Rating these…" meanwhile). */
export function waiverRatingKnown(model: LeagueModel): boolean {
  return ratings.has(model) || builtBy.has(model);
}

/**
 * The rated "Waiver upgrades" for a League model a client built (the header): the client's rateWaivers with the model's own
 * job, asked once per model (the same promise again; a failed one is asked again next time). Null for a model no client
 * built.
 */
export function waiverRatingFor(model: LeagueModel): Promise<WaiverUpgrades | null> | null {
  const known = ratings.get(model);
  if (known) return known;
  const by = builtBy.get(model);
  if (!by) return null;
  const rating = by.client.rateWaivers(by.job);
  ratings.set(model, rating);
  rating.catch(() => {
    if (ratings.get(model) === rating) ratings.delete(model);
  });
  return rating;
}

function isResponse(x: unknown): x is EngineResponse {
  return !!x && typeof x === "object" && typeof (x as { id?: unknown }).id === "number" && RESPONSE_TYPES.has((x as { type?: unknown }).type);
}

/** A request waiting for its reply: where it runs, and what to do with each reply (true once it's settled). */
interface Pending {
  request: Exclude<EngineRequest, { type: "cancel" }>;
  where: "worker" | "main";
  onReply(response: EngineResponse): boolean;
  reject(err: EngineError): void;
}

export function createEngineClient(opts: EngineClientOptions = {}): EngineClient {
  const createWorker = opts.createWorker ?? defaultWorker;
  const startMainThread = opts.startMainThread ?? defaultMainThread;
  /** undefined = not started yet; null = none (no support, failed or stopped). */
  let worker: WorkerLike | null | undefined;
  let mainThread: Promise<MainThreadEngine> | null = null;
  let disposed = false;
  let nextId = 1;
  const pending = new Map<number, Pending>();
  /** The id of the search under way (one at a time), if any. */
  let searchId: number | null = null;
  /** The request id behind each result this client handed out (a re-filter names its result by it: the header). */
  const resultIds = new WeakMap<TradeSearchResult, number>();
  /** The results whose "now or after this week" numbers are still coming (the header), by the request id they come under. */
  const laterResults = new Map<number, TradeSearchResult>();

  /** A result handed out with cards: its lines are filed as they come (the header), starting with none. */
  function expectLater(id: number, result: TradeSearchResult): void {
    const both = result.helpsBoth?.trades;
    const cards = (Array.isArray(result.trades) ? result.trades.length : 0) + (Array.isArray(both) ? both.length : 0);
    if (!cards) return;
    laterResults.set(id, result);
    while (laterResults.size > LATER_TRACKED) laterResults.delete(laterResults.keys().next().value as number);
    if (!laterOfResult.has(result)) laterOfResult.set(result, { lines: new Map(), done: false });
  }

  function settle(response: EngineResponse): void {
    if (response.type === "later") {
      // Lines for a result handed out earlier, not a reply anything waits on (the header).
      const result = laterResults.get(response.id);
      if (!result) return;
      if (response.done) laterResults.delete(response.id);
      fileLater(result, Array.isArray(response.result) ? response.result : [], response.done === true);
      return;
    }
    const job = pending.get(response.id);
    if (!job) return; // a reply to a request nobody waits for any more
    if (job.onReply(response)) {
      pending.delete(response.id);
      if (searchId === response.id) searchId = null;
    }
  }

  function onMainThread(job: Pending): void {
    job.where = "main";
    const id = job.request.id;
    mainThread ??= startMainThread((response) => {
      if (!disposed) settle(response);
    });
    mainThread.then(
      (engine) => {
        // Sent only while still wanted: a search stopped while the engine loaded never starts.
        if (!disposed && pending.get(id) === job) engine(job.request);
      },
      (err: unknown) => settle({ type: "error", id, message: MAIN_THREAD_FAILED, detail: String(err) }),
    );
  }

  /** The worker failed to load or crashed: finish what's pending on the main thread, and stay there. */
  function workerFailed(): void {
    worker?.terminate();
    worker = null;
    for (const job of pending.values()) if (job.where === "worker") onMainThread(job);
  }

  function ensureWorker(): WorkerLike | null {
    if (worker !== undefined) return worker;
    try {
      worker = createWorker();
    } catch {
      worker = null;
    }
    if (worker) {
      worker.onmessage = (event) => {
        if (isResponse(event.data)) settle(event.data);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        workerFailed();
      };
    }
    return worker;
  }

  /** Sends a request to the worker, or runs it here when there's none (or it can't take it). */
  function send(job: Pending): void {
    pending.set(job.request.id, job);
    const w = ensureWorker();
    if (!w) {
      onMainThread(job);
      return;
    }
    try {
      w.postMessage(job.request);
    } catch {
      // The request couldn't be copied to the worker: this one runs here instead.
      onMainThread(job);
    }
  }

  /** Tells whichever runs it to stop a search (it may be gone already). */
  function sendCancel(job: Pending): void {
    const message: EngineRequest = { type: "cancel", id: job.request.id };
    if (job.where === "worker") {
      try {
        worker?.postMessage(message);
      } catch {
        // nothing to stop
      }
    } else {
      void mainThread?.then((engine) => engine(message), () => {});
    }
  }

  /** Stops a pending search: it rejects as cancelled at once, and the engine is told. */
  function cancelSearch(id: number, message = SEARCH_CANCELLED): void {
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    if (searchId === id) searchId = null;
    sendCancel(job);
    job.reject(new EngineError(message, undefined, true));
  }

  function unexpected(response: EngineResponse): EngineError {
    return response.type === "error" ? new EngineError(response.message, response.detail) : new EngineError(UNEXPECTED_REPLY, `Unexpected "${response.type}" reply.`);
  }

  /** A search or re-filter (one at a time: it stops the one before), its result remembered by its request id. */
  function startSearchLike(request: TradesRequest | RefilterRequest, onProgress?: (progress: TradeSearchProgress) => void): TradeSearchHandle {
    if (searchId !== null) cancelSearch(searchId);
    searchId = request.id;
    const promise = new Promise<TradeSearchResult>((resolve, reject) => {
      send({
        request,
        where: "worker",
        reject,
        onReply(response) {
          if (response.type === "progress") {
            onProgress?.(response.progress);
            return false;
          }
          if (response.type === "trades") {
            if (response.result && typeof response.result === "object") {
              resultIds.set(response.result, request.id);
              resultOwners.set(response.result, { client, id: request.id });
              expectLater(request.id, response.result);
            }
            resolve(response.result);
          } else if (response.type === "cancelled") reject(new EngineError(SEARCH_CANCELLED, undefined, true));
          else reject(unexpected(response));
          return true;
        },
      });
    });
    return { promise, cancel: () => cancelSearch(request.id) };
  }

  const client: EngineClient = {
    buildLeague(job) {
      if (disposed) return Promise.reject(new EngineError(ENGINE_STOPPED));
      const request: LeagueRequest = { type: "league", id: nextId++, ...job };
      return new Promise<LeagueModel>((resolve, reject) => {
        send({
          request,
          where: "worker",
          reject,
          onReply(response) {
            if (response.type === "league") {
              // Remembered with its job, so the Waivers section can ask this client for its rating (waiverRatingFor).
              if (response.result && typeof response.result === "object") builtBy.set(response.result, { client, job });
              resolve(response.result);
            } else reject(unexpected(response));
            return true;
          },
        });
      });
    },

    rateWaivers(job) {
      if (disposed) return Promise.reject(new EngineError(ENGINE_STOPPED, undefined, true));
      const request: WaiversRequest = { type: "waivers", id: nextId++, ...job };
      return new Promise<WaiverUpgrades | null>((resolve, reject) => {
        send({
          request,
          where: "worker",
          reject,
          onReply(response) {
            if (response.type === "waivers") resolve(response.result);
            else reject(unexpected(response));
            return true;
          },
        });
      });
    },

    searchTrades(job, onProgress) {
      if (disposed) return { promise: Promise.reject(new EngineError(ENGINE_STOPPED)), cancel() {} };
      return startSearchLike({ type: "trades", id: nextId++, ...job }, onProgress);
    },

    refilterTrades(job, onProgress) {
      if (disposed) return { promise: Promise.reject(new EngineError(ENGINE_STOPPED)), cancel() {} };
      // Only the result's id goes to the worker, never the result itself.
      const { result, ...rest } = job;
      return startSearchLike({ type: "refilter", id: nextId++, of: resultIds.get(result) ?? -1, ...rest }, onProgress);
    },

    analyzeTrade(job) {
      if (disposed) return Promise.reject(new EngineError(ENGINE_STOPPED));
      const request: AnalyzeRequest = { type: "analyze", id: nextId++, ...job };
      return new Promise<AnalyzerResult>((resolve, reject) => {
        send({
          request,
          where: "worker",
          reject,
          onReply(response) {
            if (response.type === "analysis") resolve(response.result);
            else reject(unexpected(response));
            return true;
          },
        });
      });
    },

    offers(job) {
      if (disposed) return Promise.reject(new EngineError(ENGINE_STOPPED, undefined, true));
      const request: OffersRequest = { type: "offers", id: nextId++, ...job };
      return new Promise<OfferLadder>((resolve, reject) => {
        send({
          request,
          where: "worker",
          reject,
          onReply(response) {
            if (response.type === "offers") resolve(response.result);
            else reject(unexpected(response));
            return true;
          },
        });
      });
    },

    dispose() {
      disposed = true;
      // A search on the main thread can't be terminated with a worker: told to stop, it does at its next slice.
      for (const job of pending.values()) if (job.where === "main" && job.request.type === "trades") sendCancel(job);
      worker?.terminate();
      worker = null;
      searchId = null;
      laterResults.clear(); // no more lines come: the results keep the ones that came
      const jobs = [...pending.values()];
      pending.clear();
      for (const job of jobs) job.reject(new EngineError(ENGINE_STOPPED, undefined, true));
    },
  };
  return client;
}

/** One engine client for one saved league at a time (the header). */
export interface LeagueEngine {
  /**
   * The client for a saved league (its id: src/lib/leagueStore.ts savedLeagueId), made on first use and kept while the
   * same league asks. Another league's request stops the client before first (dispose: a search under way rejects as
   * cancelled), then makes a new one.
   */
  forLeague(leagueId: string): EngineClient;
  /** The league the current client is for (null: none). */
  leagueId(): string | null;
  /** Stops the client, if any. */
  release(): void;
}

export function createLeagueEngine(make: () => EngineClient = () => createEngineClient()): LeagueEngine {
  let current: { leagueId: string; client: EngineClient } | null = null;
  const release = () => {
    current?.client.dispose();
    current = null;
  };
  return {
    forLeague(leagueId) {
      if (current && current.leagueId !== leagueId) release();
      current ??= { leagueId, client: make() };
      return current.client;
    },
    leagueId: () => current?.leagueId ?? null,
    release,
  };
}
