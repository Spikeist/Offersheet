/**
 * Runs the engine off the page's main thread (CLAUDE.md §3: the engine runs in a Web Worker in the
 * browser): one module worker (src/workers/engine.worker.ts), wrapped in promises matched to
 * replies by request id. Without Worker support, or when the worker fails to start, the same
 * handler runs on the main thread instead: slower to respond, same numbers.
 *
 * Only types come from the worker module here, so the engine itself is never part of the page's
 * bundle; the main-thread fallback loads it on demand.
 */
import type { LeagueModel } from "@/engine/leagueModel";
import type { EngineRequest, EngineResponse, LeagueRequest } from "@/workers/engine.worker";

/** The parts of a Worker this client uses (a real Worker, or a fake in tests). */
export interface WorkerLike {
  postMessage(message: EngineRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

/** A League model request without the protocol fields the client fills in. */
export type LeagueJob = Omit<LeagueRequest, "type" | "id">;

export interface EngineClient {
  /** Builds the League model; rejects with an EngineError. */
  buildLeague(job: LeagueJob): Promise<LeagueModel>;
  /** Stops the worker. Pending requests reject, and later replies are ignored. */
  dispose(): void;
}

export class EngineError extends Error {
  /** The underlying error, for the console (never shown to people). */
  readonly detail: string | undefined;
  constructor(message: string, detail?: string) {
    super(message);
    this.name = "EngineError";
    this.detail = detail;
  }
}

export const ENGINE_STOPPED = "The number cruncher was stopped.";
const MAIN_THREAD_FAILED = "We couldn't start the number cruncher. Reload the page and try again.";

export interface EngineClientOptions {
  /** Makes the worker; null when there's no Worker support. Default: a module worker for engine.worker.ts. */
  createWorker?: () => WorkerLike | null;
  /** Runs a request on the main thread (the fallback). Default: the worker's own handler, loaded on demand. */
  runOnMainThread?: (request: EngineRequest) => Promise<EngineResponse>;
}

function defaultWorker(): WorkerLike | null {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("../workers/engine.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
}

async function defaultMainThread(request: EngineRequest): Promise<EngineResponse> {
  const { handleEngineRequest } = await import("@/workers/engine.worker");
  return handleEngineRequest(request, { clock: () => performance.now() });
}

function isResponse(x: unknown): x is EngineResponse {
  return !!x && typeof x === "object" && typeof (x as { id?: unknown }).id === "number" && ((x as { type?: unknown }).type === "league" || (x as { type?: unknown }).type === "error");
}

export function createEngineClient(opts: EngineClientOptions = {}): EngineClient {
  const createWorker = opts.createWorker ?? defaultWorker;
  const runOnMainThread = opts.runOnMainThread ?? defaultMainThread;
  /** undefined = not started yet; null = none (no support, failed or stopped). */
  let worker: WorkerLike | null | undefined;
  let disposed = false;
  let nextId = 1;
  const pending = new Map<number, { request: EngineRequest; resolve: (model: LeagueModel) => void; reject: (err: EngineError) => void }>();

  function settle(response: EngineResponse): void {
    const job = pending.get(response.id);
    if (!job) return; // a reply to a request nobody waits for any more
    pending.delete(response.id);
    if (response.type === "league") job.resolve(response.result);
    else job.reject(new EngineError(response.message, response.detail));
  }

  function onMainThread(request: EngineRequest): void {
    runOnMainThread(request).then(settle, (err: unknown) => settle({ type: "error", id: request.id, message: MAIN_THREAD_FAILED, detail: String(err) }));
  }

  /** The worker failed to load or crashed: finish what's pending on the main thread, and stay there. */
  function workerFailed(): void {
    worker?.terminate();
    worker = null;
    for (const job of pending.values()) onMainThread(job.request);
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

  return {
    buildLeague(job) {
      if (disposed) return Promise.reject(new EngineError(ENGINE_STOPPED));
      const request: LeagueRequest = { type: "league", id: nextId++, ...job };
      return new Promise<LeagueModel>((resolve, reject) => {
        pending.set(request.id, { request, resolve, reject });
        const w = ensureWorker();
        if (!w) {
          onMainThread(request);
          return;
        }
        try {
          w.postMessage(request);
        } catch {
          // The request couldn't be copied to the worker: this one runs here instead.
          onMainThread(request);
        }
      });
    },
    dispose() {
      disposed = true;
      worker?.terminate();
      worker = null;
      const jobs = [...pending.values()];
      pending.clear();
      for (const job of jobs) job.reject(new EngineError(ENGINE_STOPPED));
    },
  };
}
