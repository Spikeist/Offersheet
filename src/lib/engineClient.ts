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
 */
import type { LeagueModel } from "@/engine/leagueModel";
import type { TradeSearchProgress, TradeSearchResult } from "@/engine/tradeModel";
import type { AnalyzeRequest, AnalyzerResult, EngineRequest, EngineResponse, LeagueRequest, TradesRequest } from "@/workers/engine.worker";

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
  /** Evaluates one trade (the Trade Analyzer), with my odds before any trade (AnalyzerResult); rejects with an EngineError. */
  analyzeTrade(job: AnalyzeJob): Promise<AnalyzerResult>;
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

const RESPONSE_TYPES: ReadonlySet<unknown> = new Set(["league", "progress", "trades", "analysis", "cancelled", "error"]);

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

  function settle(response: EngineResponse): void {
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

  return {
    buildLeague(job) {
      if (disposed) return Promise.reject(new EngineError(ENGINE_STOPPED));
      const request: LeagueRequest = { type: "league", id: nextId++, ...job };
      return new Promise<LeagueModel>((resolve, reject) => {
        send({
          request,
          where: "worker",
          reject,
          onReply(response) {
            if (response.type === "league") resolve(response.result);
            else reject(unexpected(response));
            return true;
          },
        });
      });
    },

    searchTrades(job, onProgress) {
      if (disposed) return { promise: Promise.reject(new EngineError(ENGINE_STOPPED)), cancel() {} };
      if (searchId !== null) cancelSearch(searchId);
      const request: TradesRequest = { type: "trades", id: nextId++, ...job };
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
            if (response.type === "trades") resolve(response.result);
            else if (response.type === "cancelled") reject(new EngineError(SEARCH_CANCELLED, undefined, true));
            else reject(unexpected(response));
            return true;
          },
        });
      });
      return { promise, cancel: () => cancelSearch(request.id) };
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

    dispose() {
      disposed = true;
      // A search on the main thread can't be terminated with a worker: told to stop, it does at its next slice.
      for (const job of pending.values()) if (job.where === "main" && job.request.type === "trades") sendCancel(job);
      worker?.terminate();
      worker = null;
      searchId = null;
      const jobs = [...pending.values()];
      pending.clear();
      for (const job of jobs) job.reject(new EngineError(ENGINE_STOPPED, undefined, true));
    },
  };
}
