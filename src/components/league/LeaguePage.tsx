"use client";
/**
 * League page container (CLAUDE.md §14 item 3). It reads the imported league from this tab's
 * sessionStorage, gets the league's model inputs (projections and values, §6 and §9) from this
 * tab's stored copy (reused only while under 6 hours old: modelStore.ts MODEL_REUSE_MAX_AGE_MS) or
 * the server, builds the League model in the engine's Web Worker (§3), and renders the pure view
 * model (src/lib/leagueView.ts). It owns the page's requests (the inputs, Refresh), the worker, and
 * what the page keeps in sessionStorage.
 *
 * States: loading (reading storage), fetching inputs, computing, error (with Try again), ready.
 * After a Refresh or a team change, the previous numbers stay on screen, dimmed, until the new ones
 * are ready. Requests and computations are tagged with what they were for (league, league data,
 * inputs build, team, attempt), so a late answer for an older tag is ignored. React state is only
 * set in async callbacks and event handlers (the react-hooks lint rules).
 *
 * One request at a time: the model request is shared by key (sharedRequest.ts), so React
 * StrictMode's mount → unmount → mount in development sends one, and it's aborted once the page is
 * gone. The worker job starts a tick after its effect, so StrictMode's first run is cancelled before
 * it starts and the worker computes once.
 *
 * Accessibility: every state renders in one LeagueFrame whose status line (role="status") stays
 * mounted from the first wait to the ready page, so each change is announced. There's no aria-busy:
 * it would hold back the very announcements it wraps. Try again moves focus to the status line (its
 * button is gone), then to the league's name once the page is ready; Refresh keeps focus
 * (aria-disabled while it works, LeagueView.tsx).
 */
import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type Ref } from "react";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueModel } from "@/engine/leagueModel";
import type { LeagueSnapshot } from "@/engine/model";
import { callApi, isApiError, isModelResponse, type ModelResponse } from "@/lib/api";
import { EngineError, createEngineClient, type EngineClient } from "@/lib/engineClient";
import { refreshOutcomeText } from "@/lib/importReport";
import { IMPORT_STORAGE_KEY, myTeamKey, parseMyTeamPick, parseStoredImport, type StoredImport } from "@/lib/importStore";
import { buildLeagueView, type LeagueView as LeagueViewModel } from "@/lib/leagueView";
import { MODEL_STORAGE_KEY, keepModelResponse, modelForSnapshot, modelKey, modelRequest, parseStoredModel, withImportedTeam } from "@/lib/modelStore";
import { resolveMyTeam, type MyTeamSource } from "@/lib/myTeam";
import { browserSessionStorage, notifySessionChange, useSessionValue } from "@/lib/useSessionValue";
import type { RefreshControl } from "../import/ReportView";
import { revealResult } from "../reveal";
import { Callout, Card, FOCUS_TARGET, Spinner, buttonClass, cx } from "../ui";
import { LeagueView } from "./LeagueView";
import { createRequestSharer, type JoinedRequest } from "./sharedRequest";

export type LeagueWait = "loading" | "fetching" | "computing";

const WAIT_TEXT: Record<LeagueWait, string> = {
  loading: "Loading your league…",
  fetching: "Loading projections…",
  computing: "Crunching the numbers…",
};

const WAIT_NOTE: Record<LeagueWait, string | null> = {
  loading: null,
  fetching: "Projections, stats and trade values for every player in the league. The first load of the day can take half a minute.",
  computing: "Projections, lineups and values for every team. This runs in your browser and takes a few seconds.",
};

export const UPDATING_TEXT = "Updating the numbers…";
/** The status line once the page is ready: after the first load, and after an update. Screen readers only. */
export const READY_TEXT = "Your League page is ready.";
export const UPDATED_TEXT = "The numbers are up to date.";

export type LeagueFrameState =
  | { kind: LeagueWait }
  | { kind: "error"; message: string; onRetry: () => void }
  | { kind: "ready"; view: LeagueViewModel; updating: boolean; readyText: string; refresh?: RefreshControl | undefined; headingRef?: Ref<HTMLHeadingElement> | undefined };

function waitOf(state: LeagueFrameState): LeagueWait | null {
  return state.kind === "loading" || state.kind === "fetching" || state.kind === "computing" ? state.kind : null;
}

/** A failed fetch or computation, with Try again (LeagueFrame holds the page's status line around it). */
export function LeagueError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-4">
      <Callout tone="danger" role="alert" title="We couldn't build your League page">
        {message}
      </Callout>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onRetry} className={buttonClass("primary")}>
          Try again
        </button>
        <Link href="/import" className={buttonClass("secondary")}>
          Back to the Import Report
        </Link>
      </div>
    </div>
  );
}

/**
 * Every state of the League page around one status line (role="status"). The line is always the
 * frame's second child, so React keeps the same element through every change of state and each new
 * text is announced (a live region created with its text already in it often isn't). It shows with a
 * spinner while the page waits or updates, and is read to screen readers only otherwise. It can take
 * focus from script (after Try again).
 */
export function LeagueFrame({ state, leagueName, statusRef }: { state: LeagueFrameState; leagueName?: string | undefined; statusRef?: Ref<HTMLParagraphElement> | undefined }) {
  const wait = waitOf(state);
  const updating = state.kind === "ready" && state.updating;
  const busy = wait !== null || updating;
  const text = wait ? WAIT_TEXT[wait] : state.kind === "ready" ? (state.updating ? UPDATING_TEXT : state.readyText) : "";
  const note = wait ? WAIT_NOTE[wait] : null;
  return (
    <div className={wait ? "py-16" : state.kind === "error" ? "mx-auto max-w-xl py-10" : undefined}>
      {wait && leagueName ? <p className="text-sm font-bold break-words text-muted">{leagueName}</p> : null}
      <p
        ref={statusRef}
        role="status"
        tabIndex={FOCUS_TARGET.tabIndex}
        className={cx(wait ? "mt-1 flex items-center gap-3 text-muted" : updating ? "mb-3 flex items-center gap-2 text-sm font-semibold text-muted" : "sr-only", FOCUS_TARGET.className)}
      >
        {busy ? <Spinner /> : null}
        {busy ? " " : null}
        {text}
      </p>
      {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
      {state.kind === "error" ? <LeagueError message={state.message} onRetry={state.onRetry} /> : null}
      {state.kind === "ready" ? (
        <div className={cx("transition-opacity", state.updating && "opacity-60")}>
          <LeagueView view={state.view} refresh={state.refresh} headingRef={state.headingRef} />
        </div>
      ) : null}
    </div>
  );
}

export function LeaguePage() {
  const raw = useSessionValue(IMPORT_STORAGE_KEY);
  const stored = useMemo(() => (raw === undefined ? undefined : (parseStoredImport(raw) ?? null)), [raw]);

  if (stored === undefined) return <LeagueFrame state={{ kind: "loading" }} />;
  if (stored === null) {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <h1 className="text-2xl font-black tracking-tight">No league imported yet</h1>
        <p className="mt-2 text-muted">Connect your ESPN or Sleeper league to see every team&apos;s projected strength, needs and trade partners. Imports stay in this browser tab only.</p>
        <Link href="/connect" className={`${buttonClass("primary")} mt-5`}>
          Connect your league
        </Link>
      </Card>
    );
  }
  const snapshot = stored.response.snapshot;
  if (!modelRequest(stored)) {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <h1 className="text-2xl font-black tracking-tight">Not available for this league yet</h1>
        <p className="mt-2 text-muted">The League page works with ESPN and Sleeper leagues for now.</p>
      </Card>
    );
  }
  // One page state per league: importing another league starts fresh (and stops the old worker).
  return <LoadedLeague key={modelKey(snapshot)} stored={stored} />;
}

/** Model inputs fetched in this page view (kept in memory too, in case the browser won't store them). */
interface Fetched {
  /** The stored-import tags this answers: the one it was asked for, and its own snapshot's. */
  tags: string[];
  snapshot: LeagueSnapshot;
  inputs: ModelInputs;
}

interface Computed {
  tag: string;
  snapshot: LeagueSnapshot;
  inputs: ModelInputs;
  myTeamSource: MyTeamSource;
  result: LeagueModel;
  nowIso: string;
  /** Numbers were already on screen when these arrived (a Refresh, a team change, a Try again). */
  updated: boolean;
}

export type InputsOutcome = { ok: true; response: ModelResponse } | { ok: false; message: string };

const leagueTag = (s: Pick<LeagueSnapshot, "platform" | "leagueId" | "season" | "fetchedAt">) => `${modelKey(s)}|${s.fetchedAt}`;

/** The League page's model requests in flight, shared by URL and body (see the header). */
const inputRequests = createRequestSharer<InputsOutcome>();

const UNREACHABLE = "We couldn't reach Offer Sheet. Check your connection and try again.";

/**
 * The model request for the stored import that is already in flight, or a new one (a page load's,
 * never Refresh's): React StrictMode's second mount joins the first's, and it's aborted once every
 * page that joined it has left.
 */
export function joinInputsRequest(stored: StoredImport): JoinedRequest<InputsOutcome> {
  const req = modelRequest(stored, false);
  const key = req ? `${req.url} ${JSON.stringify(req.body)}` : leagueTag(stored.response.snapshot);
  return inputRequests.join(key, (signal) => requestInputs(stored, false, signal));
}

/**
 * The stored import's model inputs from the server (with the Sleeper username it was imported with,
 * so the re-import finds the user's team). `signal` aborts the request.
 */
async function requestInputs(stored: StoredImport, refresh: boolean, signal?: AbortSignal): Promise<InputsOutcome> {
  const snapshot = stored.response.snapshot;
  const req = modelRequest(stored, refresh);
  if (!req) return { ok: false, message: "The League page works with ESPN and Sleeper leagues for now." };
  const res = await callApi<ModelResponse>(req.url, { method: "POST", body: req.body }, signal ? (input, init) => fetch(input, { ...init, signal }) : undefined);
  if (isApiError(res)) return { ok: false, message: res.error.message };
  if (!isModelResponse(res) || modelKey(res.import.snapshot) !== modelKey(snapshot)) return { ok: false, message: "We couldn't read the projections for this league. Try again in a moment." };
  return { ok: true, response: res };
}

/**
 * Keeps a model response in this tab (keepModelResponse: a newer snapshot replaces the stored
 * import, keeping the team pick, and the inputs are stored with it), then one change notification.
 * Whatever the browser refuses to store, the page still has in memory; it fetches again next time.
 */
function keepResponse(stored: StoredImport, response: ModelResponse, requestTag: string): Fetched {
  const res = withImportedTeam(response, stored);
  const snap = res.import.snapshot;
  const storage = browserSessionStorage();
  if (storage) {
    const kept = keepModelResponse(storage, { stored, response: res, savedAt: new Date().toISOString() });
    if (kept.importSaved || kept.modelSaved) notifySessionChange();
  }
  return { tags: [requestTag, leagueTag(snap)], snapshot: snap, inputs: res.model };
}

function LoadedLeague({ stored }: { stored: StoredImport }) {
  const snapshot = stored.response.snapshot;
  const requestTag = leagueTag(snapshot);
  const pickRaw = useSessionValue(myTeamKey(snapshot));
  const pick = useMemo(() => parseMyTeamPick(pickRaw), [pickRaw]);
  const modelRaw = useSessionValue(MODEL_STORAGE_KEY);
  // When the page opened: stored inputs built over MODEL_REUSE_MAX_AGE_MS before it are fetched again.
  const [openedAt] = useState(() => Date.now());
  // undefined while storage hasn't been read; null when nothing stored (and fresh) matches this snapshot.
  const storedInputs = useMemo(
    () => (modelRaw === undefined ? undefined : (modelForSnapshot(parseStoredModel(modelRaw), snapshot, { now: openedAt }) ?? null)),
    [modelRaw, snapshot, openedAt],
  );
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // 1. Model inputs: this page view's latest answer, else this tab's stored copy, else fetch.
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [fetchError, setFetchError] = useState<{ tag: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const fetchTag = `${requestTag}|${attempt}`;
  const pair = useMemo(() => {
    if (fetched && fetched.tags.includes(requestTag)) return { snapshot: fetched.snapshot, inputs: fetched.inputs };
    if (storedInputs) return { snapshot, inputs: storedInputs };
    return null;
  }, [fetched, requestTag, storedInputs, snapshot]);
  const fetchFailed = fetchError !== null && fetchError.tag === fetchTag;
  const needFetch = storedInputs !== undefined && !pair && !fetchFailed;

  const startFetch = useEffectEvent((tag: string) => {
    const joined = joinInputsRequest(stored);
    let live = true;
    joined.promise.then(
      (outcome) => {
        if (!live) return;
        if (outcome.ok) setFetched(keepResponse(stored, outcome.response, requestTag));
        else setFetchError({ tag, message: outcome.message });
      },
      () => {
        if (live) setFetchError({ tag, message: UNREACHABLE });
      },
    );
    return () => {
      live = false;
      joined.leave();
    };
  });
  useEffect(() => {
    if (!needFetch) return;
    return startFetch(fetchTag);
  }, [needFetch, fetchTag]);

  // 2. The League model, in the engine's worker.
  const myTeam = useMemo(() => (pair ? resolveMyTeam(pair.snapshot, pick) : null), [pair, pick]);
  const [computeAttempt, setComputeAttempt] = useState(0);
  const computeTag = pair && myTeam ? `${leagueTag(pair.snapshot)}|${pair.inputs.builtAt}|${myTeam.myTeamId ?? "-"}|${computeAttempt}` : null;
  const [computed, setComputed] = useState<Computed | null>(null);
  const [computeError, setComputeError] = useState<{ tag: string; message: string } | null>(null);
  const engineRef = useRef<EngineClient | null>(null);

  useEffect(
    () => () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    },
    [],
  );

  const startCompute = useEffectEvent((tag: string) => {
    if (!pair || !myTeam) return undefined;
    const job = { snapshot: pair.snapshot, inputs: pair.inputs, myTeamSource: myTeam.source };
    const myTeamId = myTeam.myTeamId;
    let live = true;
    // A tick later, so React StrictMode's first run (development) is cancelled before it starts.
    const timer = setTimeout(() => {
      const engine = engineRef.current ?? createEngineClient();
      engineRef.current = engine;
      const nowIso = new Date().toISOString();
      engine.buildLeague({ snapshot: job.snapshot, model: job.inputs, myTeamId, nowIso }).then(
        (result) => {
          if (live) setComputed((prev) => ({ tag, ...job, result, nowIso, updated: prev !== null }));
        },
        (err: unknown) => {
          if (!live) return;
          if (err instanceof EngineError && err.detail) console.error("League model:", err.detail);
          setComputeError({ tag, message: err instanceof Error ? err.message : "Something went wrong while crunching the numbers." });
        },
      );
    }, 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  });
  useEffect(() => {
    if (!computeTag) return;
    return startCompute(computeTag);
  }, [computeTag]);

  const ready = computed && computed.tag === computeTag ? computed : null;
  // While new numbers are computed, the last ones stay on screen (dimmed): they're for this league.
  const shown = ready ?? computed;
  const updating = !ready;
  const view = useMemo(
    () => (shown ? buildLeagueView({ snapshot: shown.snapshot, model: shown.result, inputs: shown.inputs, myTeamSource: shown.myTeamSource, timeZone, now: shown.nowIso }) : null),
    [shown, timeZone],
  );

  // 3. Refresh: the model route again with refresh (the server fetches data over a minute old).
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  async function refresh() {
    // The button stays focusable while busy (aria-disabled), so a click then is ignored here.
    if (refreshing || updating) return;
    const before = (pair?.snapshot ?? snapshot).fetchedAt;
    setRefreshing(true);
    setRefreshError(null);
    setRefreshStatus(null);
    const outcome = await requestInputs(stored, true);
    setRefreshing(false);
    if (!outcome.ok) {
      setRefreshError(outcome.message);
      return;
    }
    setFetched(keepResponse(stored, outcome.response, requestTag));
    setRefreshStatus(refreshOutcomeText({ before, after: outcome.response.import.snapshot.fetchedAt, now: new Date(), platform: snapshot.platform, timeZone }));
  }

  // 4. Focus after Try again: its button is gone, so focus goes to the status line (it says what's
  // happening now), then to the league's name once the page is ready, if it's still on the line.
  const [retries, setRetries] = useState(0);
  const focusWhenReady = useRef(false);
  const retry = (again: () => void) => {
    setRetries((n) => n + 1);
    again();
  };
  useEffect(() => {
    if (retries === 0) return;
    focusWhenReady.current = true;
    revealResult(statusRef.current);
  }, [retries]);
  useEffect(() => {
    if (!ready || !focusWhenReady.current) return;
    focusWhenReady.current = false;
    if (document.activeElement === statusRef.current) headingRef.current?.focus({ preventScroll: true });
  }, [ready]);

  let state: LeagueFrameState;
  if (!pair && fetchError && fetchFailed) state = { kind: "error", message: fetchError.message, onRetry: () => retry(() => setAttempt((a) => a + 1)) };
  else if (!pair) state = { kind: "fetching" };
  else if (!ready && computeError && computeError.tag === computeTag) state = { kind: "error", message: computeError.message, onRetry: () => retry(() => setComputeAttempt((a) => a + 1)) };
  else if (!view || !shown) state = { kind: "computing" };
  else {
    state = {
      kind: "ready",
      view,
      updating,
      readyText: shown.updated ? UPDATED_TEXT : READY_TEXT,
      refresh: { onRefresh: () => void refresh(), refreshing: refreshing || updating, error: refreshError, status: refreshStatus },
      headingRef,
    };
  }
  return <LeagueFrame state={state} leagueName={snapshot.name} statusRef={statusRef} />;
}
