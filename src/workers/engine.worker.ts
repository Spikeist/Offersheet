/**
 * The engine's Web Worker (CLAUDE.md §3: the engine runs in a Web Worker in the browser, so the math
 * never blocks the page and costs our server nothing). It answers four messages:
 *
 * - `league`: build the League model (§6 projections, §7 lineups, needs and partners, §8 playoff odds,
 *   §9 values) from a snapshot, its model inputs and the user's settings for the league (src/engine/
 *   settings.ts: the positions my team streams and the playoff weight, Phase 4 lead decision L12).
 *   One reply: `league` (or `error`).
 * - `trades`: the trade search (§12, src/engine/search.ts) for the Trade Finder, with every other team or one
 *   partner. Replies: `progress` now and then, then `trades` with the result (or `error`, or `cancelled` when
 *   it was stopped). Phase 4 wave 2 decision M12: the search is a generator run in time slices of about
 *   SEARCH_SLICE_MS of work, with a timer (setTimeout 0) between slices, so the worker reads its messages
 *   between them: a `cancel` for it, or a newer `trades` request, stops it there (a newer one supersedes it:
 *   one search at a time). Each slice posts its latest progress, so the page's progress bar moves without a
 *   message per unit of work. Building the evaluation context is one piece of work that can't be sliced; a
 *   slice boundary follows it, so a Stop pressed meanwhile is seen before the search starts.
 * - `analyze`: the Trade Analyzer (§13, src/engine/evaluate.ts analyzeTrade): one proposal evaluated exactly as
 *   the search's finalists are. One reply: `analysis` (or `error`), which also carries my odds before any trade, the
 *   ones the search reports (contextBaseline), so the Analyzer's card reads like the Trade Finder's (review of Phase 4:
 *   the Finder's "+9.1 percentage points (63% to 72%)" read "+9.1 percentage points" in the Analyzer).
 * - `cancel` { id }: stops that search (a `cancelled` reply follows); anything else is ignored.
 *
 * The evaluation context (evaluate.ts buildTradeContext: projections, scenarios, every team's free-agent-
 * optimized roster, the baseline simulation) is the slow part, so the worker keeps the last one and reuses it
 * for the next search or analysis of the same league while it still holds (M12): same league, same league
 * data (snapshot.fetchedAt), same model inputs (ModelInputs.builtAt), same "my team", and the same settings the
 * context reads (settingsStore.ts LEAGUE_MODEL_SETTINGS, by fingerprint: the search's own settings are per
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
import { analyzeTrade, buildTradeContext, tradeInternals, type TradeAnalysis, type TradeContext, type TradeInternals } from "@/engine/evaluate";
import type { ModelInputs } from "@/engine/inputs";
import { buildLeagueModel } from "@/engine/league";
import type { LeagueModel } from "@/engine/leagueModel";
import type { LeagueSnapshot } from "@/engine/model";
import { tradeSearch } from "@/engine/search";
import { normalizeTradeSettings, type TradeSettings } from "@/engine/settings";
import type { TradeAsset, TradeProposal, TradeSearchProgress, TradeSearchResult } from "@/engine/tradeModel";
import { LEAGUE_MODEL_SETTINGS, settingsFingerprint } from "@/lib/settingsStore";
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
}

/** Search for trade ideas (§12): with every other team, or only `partnerId`. */
export interface TradesRequest extends LeagueJobFields {
  type: "trades";
  partnerId: string | null;
}

/** Evaluate one trade (the Trade Analyzer, §13). */
export interface AnalyzeRequest extends LeagueJobFields {
  type: "analyze";
  proposal: TradeProposal;
}

/** Stop the search with this id. */
export interface CancelRequest {
  type: "cancel";
  id: number;
}

export type EngineRequest = LeagueRequest | TradesRequest | AnalyzeRequest | CancelRequest;

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
  /** A search stopped by a `cancel` or superseded by a newer search: nothing more comes for it. */
  | { type: "cancelled"; id: number }
  /** `message` is for people; `detail` (the error itself) is for the console. */
  | { type: "error"; id: number; message: string; detail?: string };

export const ENGINE_ERROR_MESSAGE = "Something went wrong while crunching the numbers.";

/** About this many milliseconds of search work run between two looks at the worker's messages (M12: 30–50 ms). */
export const SEARCH_SLICE_MS = 40;

export interface EngineHandlerDeps {
  /** The League model builder (tests pass a fake). */
  build?: typeof buildLeagueModel;
  /** The trade engine (tests pass fakes): the evaluation context, the search generator and the Analyzer. */
  buildContext?: typeof buildTradeContext;
  search?: typeof tradeSearch;
  analyze?: typeof analyzeTrade;
  /** My odds before any trade in a context (default contextBaseline; tests with fake contexts pass their own). */
  baseline?: (ctx: TradeContext) => BaselineOdds | null;
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

function isJob(x: unknown): x is LeagueRequest | TradesRequest | AnalyzeRequest {
  if (!isRecord(x)) return false;
  const r = x as Partial<LeagueJobFields> & { type?: unknown; partnerId?: unknown; proposal?: unknown };
  const common =
    typeof r.id === "number" &&
    !!r.snapshot &&
    typeof r.snapshot === "object" &&
    !!r.model &&
    typeof r.model === "object" &&
    (r.myTeamId === null || typeof r.myTeamId === "string") &&
    typeof r.nowIso === "string";
  if (!common) return false;
  if (r.type === "league") return true;
  if (r.type === "trades") return r.partnerId === undefined || r.partnerId === null || typeof r.partnerId === "string";
  if (r.type === "analyze") return isProposal(r.proposal);
  return false;
}

function isCancel(x: unknown): x is CancelRequest {
  return isRecord(x) && x.type === "cancel" && typeof x.id === "number";
}

function errorDetail(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/**
 * What a cached evaluation context is for (see the header): the league and its data, the inputs' build, my team
 * and the settings the context reads. The time is checked apart (contextStillValid).
 */
export function contextKey(req: Pick<LeagueJobFields, "snapshot" | "model" | "myTeamId">, settings: TradeSettings): string {
  const s = req.snapshot;
  return [s.platform, s.leagueId, s.season, s.fetchedAt, req.model.builtAt, req.myTeamId ?? "-", settingsFingerprint(settings, LEAGUE_MODEL_SETTINGS)].join("|");
}

/**
 * Whether a context built for `builtForMs` still holds at `nowMs` (epoch ms; see the header): no kickoff in
 * between, and the same deadline urgency and deadline-passed readings at both times. It lives in ./freshness.ts,
 * client-safe, since the Trade Finder reads the same rule for the ideas it remembers.
 */
export { contextStillValid };

/**
 * My odds before any trade in a context, exactly as the search reports them (search.ts: TradeSearchResult.baseline, the
 * final block of seasons with every team at its free-agent-optimized roster). Null without a team or a simulated
 * season, and for a context the engine didn't build (the tests' fakes).
 */
export function contextBaseline(ctx: TradeContext): BaselineOdds | null {
  let I: TradeInternals;
  try {
    I = tradeInternals(ctx);
  } catch {
    return null;
  }
  const base = I.sim && I.me ? I.sim.base.final : null;
  return base ? { pPlayoffs: base.pPlayoffs, pTitle: base.pTitle, expWins: base.expWins } : null;
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
  const build = deps.build ?? buildLeagueModel;
  const buildContext = deps.buildContext ?? buildTradeContext;
  const search = deps.search ?? tradeSearch;
  const analyze = deps.analyze ?? analyzeTrade;
  const baselineOf = deps.baseline ?? contextBaseline;
  const schedule = deps.schedule ?? defaultSchedule;
  const sliceClock = deps.clock ?? defaultClock;
  const sliceMs = deps.sliceMs ?? SEARCH_SLICE_MS;
  // The engine's own timings only when a clock was given (the tests check that none is passed otherwise).
  const timing = deps.clock ? { clock: deps.clock } : {};

  let cached: { key: string; builtForMs: number; ctx: TradeContext } | null = null;
  /** The search under way (one at a time); null when none. */
  let active: { id: number } | null = null;

  const fail = (id: number, err: unknown) => post({ type: "error", id, message: ENGINE_ERROR_MESSAGE, detail: errorDetail(err) });

  function contextFor(req: TradesRequest | AnalyzeRequest, now: Date, settings: TradeSettings): TradeContext {
    const key = contextKey(req, settings);
    const nowMs = now.getTime();
    if (cached && cached.key === key && contextStillValid(cached.builtForMs, nowMs, req.model, req.snapshot)) return cached.ctx;
    cached = null; // a build that fails leaves nothing behind
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

  function startSearch(req: TradesRequest, now: Date, settings: TradeSettings): void {
    stopActive();
    const run = { id: req.id };
    active = run;
    post({ type: "progress", id: req.id, progress: { stage: "setup", done: 0, total: 1 } });
    let it: Generator<TradeSearchProgress, TradeSearchResult, void> | null = null;
    const step = () => {
      if (active !== run) return; // stopped or superseded
      try {
        if (!it) {
          it = search(contextFor(req, now, settings), { settings, partnerId: req.partnerId ?? null, ...timing });
          schedule(step);
          return;
        }
        const start = sliceClock();
        let last: TradeSearchProgress | null = null;
        for (;;) {
          const r = it.next();
          if (r.done) {
            active = null;
            post({ type: "trades", id: req.id, result: r.value });
            return;
          }
          last = r.value;
          if (sliceClock() - start >= sliceMs) break;
        }
        if (last) post({ type: "progress", id: req.id, progress: last });
        schedule(step);
      } catch (err) {
        if (active === run) active = null;
        fail(req.id, err);
      }
    };
    schedule(step);
  }

  return (message: unknown) => {
    if (isCancel(message)) {
      if (active?.id === message.id) stopActive();
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
          post({ type: "league", id, result: build({ ...message.snapshot, myTeamId: message.myTeamId }, message.model, { now, settings, ...timing }) });
        } catch (err) {
          fail(id, err);
        }
        return;
      case "trades":
        startSearch(message, now, settings);
        return;
      case "analyze":
        try {
          const ctx = contextFor(message, now, settings);
          const analysis = analyze(ctx, message.proposal, { settings, ...timing });
          post({ type: "analysis", id, result: { ...analysis, baseline: baselineOf(ctx) } });
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
