"use client";
/**
 * League page container (CLAUDE.md §14 item 3). It reads the league this tab shows (one of the leagues
 * saved in this browser's IndexedDB: src/lib/leagueStore.ts, Phase 4c; the switcher at the top of every
 * page picks it), gets the league's model inputs (projections and values, §6 and §9) from its stored copy
 * (reused only while under 6 hours old: modelStore.ts MODEL_REUSE_MAX_AGE_MS) or the server, builds the
 * League model in the engine's Web Worker (§3), and renders the pure view model (src/lib/leagueView.ts).
 * Loading the league and its inputs is shared with the Trade Finder and the Trade Analyzer
 * (useLeagueInputs.ts, Phase 4 wave 2 decision M13); this page owns Refresh, the worker, and the League
 * model's computation. Another league starts a fresh page state (and its own worker).
 *
 * Settings (Phase 4 lead decision L12): the league's settings from the league store (the Settings page
 * saves them, per league; src/components/settings/useLeagueSettings.ts) go with every worker request,
 * since the League model reads the positions my team streams and the playoff weight. The model waits
 * until they've been read (never a first run with defaults it would throw away), and a change to one of
 * those two, saved in this tab or another, computes it again: the compute tag carries the fingerprint of
 * the settings the model reads (settingsStore.ts LEAGUE_MODEL_SETTINGS). A change to a setting only the
 * trade search reads (untouchables, Win now ↔ Future, …) leaves the page as it is, since the model would
 * come out the same, and the same settings in another order don't count as a change either.
 *
 * States: loading (reading storage), fetching inputs, computing, error (with Try again), ready. With no
 * league saved, a card says so, or that Offer Sheet was updated when the league was saved by an earlier
 * version (NoImportCard: Import again), with a link to the Connect page.
 * After a Refresh, a team change or a change to a setting the model reads, the previous numbers stay on
 * screen, dimmed, until the new ones are ready. Requests and computations are tagged with what they were for
 * (league, league data, inputs build, team, the model's settings, attempt), so a late answer for an older tag
 * is ignored. React state is only set in async callbacks and event handlers (the react-hooks lint rules).
 *
 * One request at a time: the model request is shared by key (useLeagueInputs.ts, sharedRequest.ts), so
 * React StrictMode's mount → unmount → mount in development sends one, and it's aborted once the page is
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
import { config } from "@/engine/config";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueModel } from "@/engine/leagueModel";
import type { LeagueSnapshot } from "@/engine/model";
import type { TradeSettings } from "@/engine/settings";
import { EngineError, createEngineClient, type EngineClient } from "@/lib/engineClient";
import { fmtWhole } from "@/lib/format";
import { refreshOutcomeText } from "@/lib/importReport";
import type { CurrentLeagueRead } from "@/lib/leagueStore";
import { buildLeagueView, type LeagueView as LeagueViewModel } from "@/lib/leagueView";
import { modelRequest } from "@/lib/modelStore";
import type { MyTeamSource } from "@/lib/myTeam";
import { LEAGUE_MODEL_SETTINGS, settingsFingerprint } from "@/lib/settingsStore";
import { NoImportCard } from "../NoImportCard";
import type { RefreshControl } from "../import/ReportView";
import { revealResult } from "../reveal";
import { useSavedLeagueSettings } from "../settings/useLeagueSettings";
import { Callout, Card, FOCUS_TARGET, Spinner, buttonClass, cx } from "../ui";
import { LeagueView } from "./LeagueView";
import { leagueTag, useCurrentLeague, useSavedLeagueInputs } from "./useLeagueInputs";

export { joinInputsRequest, type InputsOutcome } from "./useLeagueInputs";

export type LeagueWait = "loading" | "fetching" | "computing";

const WAIT_TEXT: Record<LeagueWait, string> = {
  loading: "Loading your league…",
  fetching: "Loading projections…",
  computing: "Crunching the numbers…",
};

const WAIT_NOTE: Record<LeagueWait, string | null> = {
  loading: null,
  fetching: "Projections, stats and trade values for every player in the league. The first load of the day can take half a minute.",
  computing: `Projections, lineups and values for every team, and ${fmtWhole(config.simulation.finalSims)} simulated seasons for the playoff odds. This runs in your browser and takes a few seconds.`,
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

export const NO_IMPORT_TEXT =
  "Connect your ESPN or Sleeper league to see every team's projected strength, needs and trade partners. Leagues you import stay saved in this browser until you remove them.";

export function LeaguePage() {
  const read = useCurrentLeague();

  if (read === undefined) return <LeagueFrame state={{ kind: "loading" }} />;
  if (read.kind !== "ok") return <NoImportCard read={read} text={NO_IMPORT_TEXT} />;
  if (!modelRequest(read.stored)) {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <h1 className="text-2xl font-black tracking-tight">Not available for this league yet</h1>
        <p className="mt-2 text-muted">The League page works with ESPN and Sleeper leagues for now.</p>
      </Card>
    );
  }
  // One page state per saved league: switching to or importing another starts fresh (and stops the old worker).
  return <LoadedLeague key={read.league.id} current={read} />;
}

interface Computed {
  tag: string;
  snapshot: LeagueSnapshot;
  inputs: ModelInputs;
  myTeamSource: MyTeamSource;
  result: LeagueModel;
  nowIso: string;
  /** The league's settings the model was built with. */
  settings: TradeSettings;
  /** Numbers were already on screen when these arrived (a Refresh, a team change, a settings change, a Try again). */
  updated: boolean;
}

/**
 * What a League model computation is for: the league data, the inputs' build, my team, the settings the
 * model reads (LEAGUE_MODEL_SETTINGS, by fingerprint: the same settings in any order are the same
 * computation, and the trade search's own settings aren't part of it) and the attempt (Try again). A result
 * whose tag isn't the current one is for something the page no longer shows.
 */
export function computeTagFor(args: {
  snapshot: Pick<LeagueSnapshot, "platform" | "leagueId" | "season" | "fetchedAt">;
  builtAt: string;
  myTeamId: string | null;
  settings: TradeSettings;
  attempt: number;
}): string {
  return `${leagueTag(args.snapshot)}|${args.builtAt}|${args.myTeamId ?? "-"}|${settingsFingerprint(args.settings, LEAGUE_MODEL_SETTINGS)}|${args.attempt}`;
}

function LoadedLeague({ current }: { current: Extract<CurrentLeagueRead, { kind: "ok" }> }) {
  const snapshot = current.stored.response.snapshot;
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // 1. Model inputs and my team (useLeagueInputs.ts): this page view's latest answer, else the league's stored copy, else fetch.
  const { pair, myTeam, error: fetchError, retry: retryFetch, refreshInputs } = useSavedLeagueInputs(current);

  // 2. The League model, in the engine's worker, with the league's settings (undefined until read).
  const { settings } = useSavedLeagueSettings(current.league.leagueKey);
  const [computeAttempt, setComputeAttempt] = useState(0);
  const computeTag =
    pair && myTeam && settings ? computeTagFor({ snapshot: pair.snapshot, builtAt: pair.inputs.builtAt, myTeamId: myTeam.myTeamId, settings, attempt: computeAttempt }) : null;
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
    if (!pair || !myTeam || !settings) return undefined;
    const job = { snapshot: pair.snapshot, inputs: pair.inputs, myTeamSource: myTeam.source };
    const myTeamId = myTeam.myTeamId;
    const leagueSettings = settings;
    let live = true;
    // A tick later, so React StrictMode's first run (development) is cancelled before it starts.
    const timer = setTimeout(() => {
      const engine = engineRef.current ?? createEngineClient();
      engineRef.current = engine;
      const nowIso = new Date().toISOString();
      engine.buildLeague({ snapshot: job.snapshot, model: job.inputs, myTeamId, nowIso, settings: leagueSettings }).then(
        (result) => {
          if (live) setComputed((prev) => ({ tag, ...job, result, nowIso, settings: leagueSettings, updated: prev !== null }));
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
    const outcome = await refreshInputs();
    setRefreshing(false);
    if (!outcome.ok) {
      setRefreshError(outcome.message);
      return;
    }
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
  if (!pair && fetchError) state = { kind: "error", message: fetchError, onRetry: () => retry(retryFetch) };
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
