/**
 * The engine's Web Worker (CLAUDE.md §3: the engine runs in a Web Worker in the browser, so the math
 * never blocks the page and costs our server nothing). Today it answers one request: build the
 * League model (§6 projections, §7 lineups, needs and partners, §8 playoff odds, §9 values) from a
 * snapshot and its model inputs. Trade search (Phase 4, §12) adds its own request type here.
 *
 * The message handler is a plain exported function, so tests run it without a real Worker, and the
 * page can run it on its main thread when the browser has no Worker support (src/lib/engineClient.ts).
 * The listener is registered only when this module runs as a worker.
 */
import type { ModelInputs } from "@/engine/inputs";
import { buildLeagueModel } from "@/engine/league";
import type { LeagueModel } from "@/engine/leagueModel";
import type { LeagueSnapshot } from "@/engine/model";

/** Build the League model for this snapshot, with "my team" as the user picked it. */
export interface LeagueRequest {
  type: "league";
  /** Request id: the reply carries it, so the caller can ignore replies to requests it dropped. */
  id: number;
  snapshot: LeagueSnapshot;
  model: ModelInputs;
  myTeamId: string | null;
  /** The moment the model is for (ISO): a game that kicked off before it no longer counts (§6 step 7). */
  nowIso: string;
}

export type EngineRequest = LeagueRequest;

export type EngineResponse =
  | { type: "league"; id: number; result: LeagueModel }
  /** `message` is for people; `detail` (the error itself) is for the console. */
  | { type: "error"; id: number; message: string; detail?: string };

export const ENGINE_ERROR_MESSAGE = "Something went wrong while crunching the numbers.";

export interface EngineHandlerDeps {
  /** The League model builder (tests pass a fake). */
  build?: typeof buildLeagueModel;
  /** Milliseconds for the model's stage timings (performance.now in the browser). */
  clock?: () => number;
}

function isLeagueRequest(x: unknown): x is LeagueRequest {
  if (!x || typeof x !== "object") return false;
  const r = x as Partial<LeagueRequest>;
  return (
    r.type === "league" &&
    typeof r.id === "number" &&
    !!r.snapshot &&
    typeof r.snapshot === "object" &&
    !!r.model &&
    typeof r.model === "object" &&
    (r.myTeamId === null || typeof r.myTeamId === "string") &&
    typeof r.nowIso === "string"
  );
}

/** Answers one request. Never throws: an engine failure becomes an "error" reply with the same id. */
export function handleEngineRequest(message: unknown, deps: EngineHandlerDeps = {}): EngineResponse {
  const rawId = message && typeof message === "object" ? (message as { id?: unknown }).id : undefined;
  const id = typeof rawId === "number" ? rawId : -1;
  if (!isLeagueRequest(message)) return { type: "error", id, message: ENGINE_ERROR_MESSAGE, detail: "Not an engine request." };
  const now = new Date(message.nowIso);
  if (Number.isNaN(now.getTime())) return { type: "error", id, message: ENGINE_ERROR_MESSAGE, detail: "The request's time isn't a date." };
  try {
    const build = deps.build ?? buildLeagueModel;
    const result = build({ ...message.snapshot, myTeamId: message.myTeamId }, message.model, { now, ...(deps.clock ? { clock: deps.clock } : {}) });
    return { type: "league", id, result };
  } catch (err) {
    return { type: "error", id, message: ENGINE_ERROR_MESSAGE, detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
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
  scope.addEventListener("message", (event) => {
    scope.postMessage(handleEngineRequest(event.data, { clock: () => performance.now() }));
  });
}
