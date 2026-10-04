"use client";
/**
 * The Trade Finder (CLAUDE.md §12, §13, §14 item 4; Phase 4 wave 2 decisions M12–M14). It loads the imported league
 * and its model inputs the way the League page does (useLeagueInputs.ts), reads the league's settings (the Settings
 * page saves them; every setting goes with the search), and runs the trade search in the engine's Web Worker (§3)
 * as soon as it has all three: with every other team, or with one (the partner filter). The address's `?partner=`
 * picks it (the League page's partner cards link here that way); it's read with useSearchParams, which on a client
 * navigation already holds the new address while the page renders (window.location still holds the old one until
 * the navigation commits), so the app route wraps the page in <Suspense> (src/app/trades/page.tsx). A partner picked
 * here is written back into the address (history.replaceState, which Next keeps in step with useSearchParams) and
 * holds until the address names another one (a link here, the nav's Trades). A change of partner, of a setting
 * (saved here or in another tab), of the league data or of "my team" starts a new search, and the one under way
 * stops; so does leaving the page. The sort (Overall by default, Helps you, Chance they accept: §13) only reorders
 * the ideas found (rank.ts sortTrades, through src/lib/tradeView.ts).
 *
 * States: loading the league, loading projections (or failed, with Try again), no team picked (a link to the Import
 * Report), searching (a progress bar with the stage in plain words, and Stop), stopped (Search again), failed (Try
 * again), and done: my odds before any trade (with what they count: src/lib/tradeView.ts baselineLines), the ideas as
 * cards, what was left out on purpose, notes and warnings, or an empty state that says why there's nothing (no team,
 * season over, deadline passed, nothing found). While a new search runs, and after it's stopped or has failed, the
 * last ideas found for the same partner stay on screen, dimmed.
 *
 * Coming back (review of Phase 4; finderMemory.ts): the trade pages share one engine client, whose worker keeps its
 * evaluation context between them. A search whose ideas were found before in this tab (same league data, inputs, team,
 * settings and partner) and still hold (no kickoff since, the same deadline readings: src/workers/freshness.ts) shows
 * them again at once instead of searching, in the sort the page was left in; the Analyzer's "Back to the Trade
 * Finder" returns to this page's address, partner included; and when the user left through an idea's "Open in
 * Analyzer" (its own, or its "If they say no, try:" one), that link comes back into view with focus on it.
 *
 * Accessibility: one status line (role="status") stays mounted through every state, so each change is announced
 * (the stage while searching, then what was found); the progress bar's numbers are read on demand. A button that
 * goes away moves focus to what took its place: Stop → Search again; Search again or Try again (a search) → Stop;
 * Try again (the projections) → the status line, which shows while they load. Whenever a search's results come in
 * (a page-started one too: the first load, a settings change) and focus was left on nothing, on the status line or
 * on a control that went away (Stop, a dimmed card's button), it moves to the results' heading (or, coming back from
 * the Analyzer, to the "Open in Analyzer" link used). Controls are native selects with labels, every target at least
 * 44 px tall. The search starts a tick after its effect, so React StrictMode's first run is cancelled before it starts
 * and the worker searches once.
 */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { memo, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import type { LeagueSettings, LeagueSnapshot } from "@/engine/model";
import type { TradeSettings } from "@/engine/settings";
import type { TradeSearchResult, TradeSort } from "@/engine/tradeModel";
import { EngineError, type TradeSearchHandle } from "@/lib/engineClient";
import type { FeedbackChange, FeedbackRecord } from "@/lib/feedbackStore";
import type { StoredImport } from "@/lib/importStore";
import { modelKey, modelRequest } from "@/lib/modelStore";
import { settingsFingerprint } from "@/lib/settingsStore";
import {
  ANALYZER_PATH,
  SORT_OPTIONS,
  buildFinderView,
  cardFeedback,
  finderHref,
  isTradeSort,
  partnerOrNull,
  progressView,
  readFinderPartner,
  settingsSummary,
  teamNameOf,
  type FinderView,
  type ProgressView,
  type SnapshotPart,
} from "@/lib/tradeView";
import { contextStillValid } from "@/workers/freshness";
import { NoImportCard } from "../NoImportCard";
import { leagueTag, useLeagueInputs, useStoredImport } from "../league/useLeagueInputs";
import { revealResult } from "../reveal";
import { saveTradeFeedback, useFeedbackRecords } from "../settings/useFeedback";
import { useLeagueSettings } from "../settings/useLeagueSettings";
import { Callout, Card, FOCUS_TARGET, Spinner, buttonClass, cx, inputClass } from "../ui";
import { recallSearch, rememberFinderAddress, rememberReturn, rememberSearch, rememberSort, rememberedSort, takeReturnTarget, tradeEngine } from "./finderMemory";
import { HowToRead } from "./HowToRead";
import { LeagueLoading } from "./LeagueLoading";
import { SearchProgress } from "./SearchProgress";
import { TradeCard } from "./TradeCard";

export const FINDER_TITLE = "Trade Finder";
export const NO_IMPORT_TEXT = "Connect your ESPN or Sleeper league to get trade ideas for your team. Imports stay in this browser tab only.";
export const NO_TEAM_TEXT = "Pick your team on the Import Report to see trade ideas.";

const linkClass = "font-semibold text-brand-strong underline underline-offset-2 dark:text-brand";

export function TradeFinderPage() {
  const read = useStoredImport();
  if (read === undefined) return <LeagueLoading />;
  if (read.kind !== "ok") return <NoImportCard outdated={read.kind === "outdated"} text={NO_IMPORT_TEXT} />;
  const stored = read.stored;
  if (!modelRequest(stored)) {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <h1 className="text-2xl font-black tracking-tight">Not available for this league yet</h1>
        <p className="mt-2 text-muted">Trade ideas work with ESPN and Sleeper leagues for now.</p>
      </Card>
    );
  }
  // One page state per league: importing another league starts fresh (and stops the old worker).
  return <LoadedFinder key={modelKey(stored.response.snapshot)} stored={stored} />;
}

/** What a search is for: the league data, the inputs' build, my team, every setting and the partner (finderMemory.ts keys its ideas by it). */
export function searchKeyFor(args: {
  snapshot: Pick<LeagueSnapshot, "platform" | "leagueId" | "season" | "fetchedAt">;
  builtAt: string;
  myTeamId: string;
  settings: TradeSettings;
  partnerId: string | null;
}): string {
  return `${leagueTag(args.snapshot)}|${args.builtAt}|${args.myTeamId}|${settingsFingerprint(args.settings)}|${args.partnerId ?? "*"}`;
}

/** One search: what it's for (searchKeyFor) and the attempt (Search again, Try again). */
export function searchTagFor(args: Parameters<typeof searchKeyFor>[0] & { attempt: number }): string {
  return `${searchKeyFor(args)}|${args.attempt}`;
}

type FocusTo = "status" | "stop" | "again";

type Done = { tag: string; key: string; kind: "done"; result: TradeSearchResult; partnerId: string | null };
type Outcome = Done | { tag: string; kind: "error"; message: string } | { tag: string; kind: "stopped" };

/** The page's state for its status line and body (pure: FinderBody renders it; tests render each). */
export type FinderState =
  | { kind: "fetching" }
  | { kind: "fetchError"; message: string; onRetry: () => void }
  | { kind: "noTeam" }
  | { kind: "settings" }
  | { kind: "searching"; progress: ProgressView; onStop: () => void; previous: FinderView | null }
  | { kind: "stopped"; onAgain: () => void; previous: FinderView | null }
  | { kind: "error"; message: string; onRetry: () => void; previous: FinderView | null }
  | { kind: "done"; view: FinderView };

/** The status line's words for a state (the page announces each change). */
export function finderStatus(state: FinderState): string {
  switch (state.kind) {
    case "fetching":
      return "Loading projections…";
    case "settings":
      return "Loading your settings…";
    case "searching":
      return `Searching for trade ideas: ${state.progress.label.charAt(0).toLowerCase()}${state.progress.label.slice(1)}…`;
    case "stopped":
      return "Search stopped.";
    case "done":
      return state.view.statusText;
    default:
      return "";
  }
}

function LoadedFinder({ stored }: { stored: StoredImport }) {
  const snapshot = stored.response.snapshot;
  const { pair, myTeam, error: fetchError, retry: retryFetch } = useLeagueInputs(stored);
  const { settings, key: leagueKey } = useLeagueSettings(snapshot);
  const records = useFeedbackRecords();
  // The address's query (see the header: never window.location, which lags a client navigation). Null outside Next.
  const query = useSearchParams()?.toString() ?? "";
  // A partner picked here, and the query it was picked under (null = every team).
  const [picked, setPicked] = useState<{ id: string | null; query: string } | null>(null);
  // The sort the page was left in, in this tab (finderMemory.ts), else Overall.
  const [sort, setSort] = useState<TradeSort>(() => rememberedSort() ?? "overall");
  const [attempt, setAttempt] = useState(0);

  const myTeamId = myTeam?.myTeamId ?? null;
  const league = pair && myTeamId ? pair.snapshot : null;
  const fromAddress = league ? readFinderPartner(query, league, myTeamId) : null;
  // The pick holds while the address is the one it was made under, or names the same partner (our own write).
  const pickedId = league && picked ? partnerOrNull(league, myTeamId, picked.id) : null;
  const partnerId = league ? (picked && (picked.query === query || pickedId === fromAddress) ? pickedId : fromAddress) : null;
  const pickPartner = (id: string | null) => {
    setPicked({ id, query });
    try {
      window.history.replaceState(null, "", finderHref(id));
    } catch {
      // the address just doesn't keep the partner
    }
  };
  const pickSort = (value: TradeSort) => {
    setSort(value);
    rememberSort(value);
  };
  const searchKey = pair && myTeamId && settings ? searchKeyFor({ snapshot: pair.snapshot, builtAt: pair.inputs.builtAt, myTeamId, settings, partnerId }) : null;
  const searchTag = searchKey ? `${searchKey}|${attempt}` : null;

  // The Analyzer's "Back to the Trade Finder" comes back to this address, partner included (finderMemory.ts).
  useEffect(() => {
    if (league) rememberFinderAddress(finderHref(partnerId));
  }, [league, partnerId]);

  // The search, in the trade pages' engine worker (finderMemory.ts tradeEngine: shared with the Analyzer, never disposed here).
  const handleRef = useRef<TradeSearchHandle | null>(null);
  // Coming back from the Analyzer: the idea whose "Open in Analyzer" was used (and which link), to bring back into view when its search's ideas show.
  const returnRef = useRef<{ tag: string; cardKey: string; href: string | null } | null>(null);
  const [progress, setProgress] = useState<{ tag: string; view: ProgressView } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // The last ideas found (kept when a later search runs, stops or fails: shown dimmed for the same partner).
  const [lastDone, setLastDone] = useState<Done | null>(null);

  const startSearch = useEffectEvent((tag: string, key: string) => {
    if (!pair || !myTeamId || !settings) return undefined;
    const job = { snapshot: pair.snapshot, model: pair.inputs, myTeamId, settings, partnerId };
    // Search again and Try again search; a page-started search may show what it found before.
    const recall = attempt === 0;
    let live = true;
    // A tick later, so React StrictMode's first run (development) is cancelled before it starts.
    const timer = setTimeout(() => {
      const back = takeReturnTarget(key);
      const nowMs = Date.now();
      // The ideas this search found before in this tab, while they still hold (finderMemory.ts): shown again at once.
      const known = recall ? recallSearch(key, (iso) => contextStillValid(Date.parse(iso), nowMs, job.model, job.snapshot)) : null;
      if (known) {
        returnRef.current = back ? { tag, ...back } : null;
        const done: Done = { tag, key, kind: "done", result: known, partnerId: job.partnerId };
        setOutcome(done);
        setLastDone(done);
        return;
      }
      const nowIso = new Date(nowMs).toISOString();
      setProgress({ tag, view: progressView(null) });
      const handle = tradeEngine().searchTrades({ ...job, nowIso }, (p) => {
        if (!live) return;
        const view = progressView(p);
        // Only a change the bar or the status line shows (not every step): fewer renders while the cards wait.
        setProgress((prev) => (prev && prev.tag === tag && prev.view.percent === view.percent && prev.view.label === view.label ? prev : { tag, view }));
      });
      handleRef.current = handle;
      handle.promise.then(
        (result) => {
          // Remembered even when a newer search took over meanwhile: these ideas are this search's.
          rememberSearch(key, nowIso, result);
          if (!live) return;
          const done: Done = { tag, key, kind: "done", result, partnerId: job.partnerId };
          setOutcome(done);
          setLastDone(done);
        },
        (err: unknown) => {
          if (!live || (err instanceof EngineError && err.cancelled)) return;
          if (err instanceof EngineError && err.detail) console.error("Trade search:", err.detail);
          setOutcome({ tag, kind: "error", message: err instanceof Error ? err.message : "Something went wrong while crunching the numbers." });
        },
      );
    }, 0);
    return () => {
      live = false;
      clearTimeout(timer);
      handleRef.current?.cancel();
      handleRef.current = null;
    };
  });
  useEffect(() => {
    if (!searchTag || !searchKey) return;
    return startSearch(searchTag, searchKey);
  }, [searchTag, searchKey]);

  // Focus when a button goes away (see the header).
  const statusRef = useRef<HTMLParagraphElement>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);
  const againRef = useRef<HTMLButtonElement>(null);
  const stopRef = useRef<HTMLButtonElement>(null);
  const [focusTo, setFocusTo] = useState<{ n: number; to: FocusTo } | null>(null);
  const moveFocus = (to: FocusTo) => setFocusTo((f) => ({ n: (f?.n ?? 0) + 1, to }));
  useEffect(() => {
    if (!focusTo) return;
    revealResult(focusTo.to === "status" ? statusRef.current : focusTo.to === "stop" ? stopRef.current : againRef.current);
  }, [focusTo]);

  const current = outcome && outcome.tag === searchTag ? outcome : null;
  const doneResult = current?.kind === "done" ? current : null;
  useEffect(() => {
    if (!doneResult) return;
    // Coming back from the Analyzer: the "Open in Analyzer" link used, back in view and focused (see the header).
    const back = returnRef.current;
    returnRef.current = null;
    if (back && back.tag === doneResult.tag && revealIdea(back.cardKey, back.href)) return;
    // Focus left on nothing, on the status line or on a control that went away (Stop; a dimmed card's button) → the results.
    const active = document.activeElement;
    if (!active || active === document.body || active === statusRef.current || !active.isConnected) resultsRef.current?.focus({ preventScroll: true });
  }, [doneResult]);

  const again = () => {
    moveFocus("stop");
    setAttempt((a) => a + 1);
  };
  const stop = () => {
    if (!searchTag) return;
    handleRef.current?.cancel();
    handleRef.current = null;
    setOutcome({ tag: searchTag, kind: "stopped" });
    moveFocus("again");
  };

  // The ideas shown: this search's, or (while it runs) the last ones found for the same partner, dimmed.
  const shownOutcome = doneResult ?? (lastDone && lastDone.partnerId === partnerId ? lastDone : null);
  // The NFL's last week, for injury tags' "Out for the season" (tradeView.ts seasonEndOf).
  const lastNflWeek = pair?.inputs.nfl?.lastWeek;
  const view = useMemo(
    () => (shownOutcome && league ? buildFinderView({ result: shownOutcome.result, sort, snapshot: league, partnerId: shownOutcome.partnerId, lastNflWeek }) : null),
    [shownOutcome, sort, league, lastNflWeek],
  );

  const onFeedback = useCallback(
    (evaluation: TradeSearchResult["trades"][number], change: FeedbackChange) => saveTradeFeedback({ leagueKey, evaluation, change }),
    [leagueKey],
  );
  // "Open in Analyzer" remembers the idea and the link used, to come back to it (finderMemory.ts).
  const shownKey = shownOutcome?.key ?? null;
  const onOpenAnalyzer = useCallback(
    (cardKey: string, href?: string) => {
      if (shownKey) rememberReturn(shownKey, cardKey, href);
    },
    [shownKey],
  );

  let state: FinderState;
  if (!pair && fetchError) {
    state = {
      kind: "fetchError",
      message: fetchError,
      onRetry: () => {
        moveFocus("status");
        retryFetch();
      },
    };
  } else if (!pair) state = { kind: "fetching" };
  else if (!myTeamId) state = { kind: "noTeam" };
  else if (!settings) state = { kind: "settings" };
  else if (current?.kind === "stopped") state = { kind: "stopped", onAgain: again, previous: view };
  else if (current?.kind === "error") state = { kind: "error", message: current.message, onRetry: again, previous: view };
  else if (current?.kind === "done" && view) state = { kind: "done", view };
  else state = { kind: "searching", progress: progress && progress.tag === searchTag ? progress.view : progressView(null), onStop: stop, previous: view };

  const controls =
    league && myTeamId && settings ? (
      <FinderControls
        snapshot={league}
        myTeamId={myTeamId}
        partnerId={partnerId}
        onPartner={pickPartner}
        sort={sort}
        onSort={pickSort}
        summary={settingsSummary(settings, league.platform, league.settings.leagueType)}
      />
    ) : null;

  return (
    <FinderFrame
      state={state}
      teamName={league && myTeamId ? teamNameOf(league, myTeamId) : null}
      leagueType={(pair?.snapshot ?? snapshot).settings.leagueType}
      controls={controls}
      statusRef={statusRef}
      resultsRef={resultsRef}
      againRef={againRef}
      stopRef={stopRef}
      records={records}
      leagueKey={leagueKey}
      snapshot={league}
      onFeedback={onFeedback}
      onOpenAnalyzer={onOpenAnalyzer}
    />
  );
}

/**
 * Brings back into view the idea (its TradeEvaluation.key) whose "Open in Analyzer" was used, with focus on that link
 * (the one with `href`: the card's own or its "If they say no, try:" one; else the idea's first), the way the user left
 * it; false when that idea isn't shown.
 */
function revealIdea(cardKey: string, href: string | null): boolean {
  const item = [...document.querySelectorAll<HTMLElement>("li[data-trade-key]")].find((li) => li.dataset.tradeKey === cardKey);
  const links = item ? [...item.querySelectorAll<HTMLElement>(`a[href^="${ANALYZER_PATH}?"]`)] : [];
  const link = (href ? links.find((a) => a.getAttribute("href") === href) : undefined) ?? links[0] ?? null;
  if (!link) return false;
  link.scrollIntoView({ block: "center" });
  link.focus({ preventScroll: true });
  return true;
}

/** The partner filter and the sort (native selects, labeled), and what the settings let a trade idea be. */
export function FinderControls({
  snapshot,
  myTeamId,
  partnerId,
  onPartner,
  sort,
  onSort,
  summary,
}: {
  snapshot: Pick<LeagueSnapshot, "teams">;
  myTeamId: string;
  partnerId: string | null;
  onPartner: (id: string | null) => void;
  sort: TradeSort;
  onSort: (sort: TradeSort) => void;
  summary: string;
}) {
  const others = snapshot.teams.filter((t) => t.id !== myTeamId);
  return (
    <Card>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="finder-partner" className="text-sm font-bold">
            Trade partner
          </label>
          <select id="finder-partner" value={partnerId ?? ""} onChange={(e) => onPartner(e.target.value || null)} className={cx(inputClass, "mt-1")}>
            <option value="">All teams</option>
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="finder-sort" className="text-sm font-bold">
            Sort by
          </label>
          <select
            id="finder-sort"
            value={sort}
            onChange={(e) => {
              if (isTradeSort(e.target.value)) onSort(e.target.value);
            }}
            className={cx(inputClass, "mt-1")}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="mt-3 text-sm text-muted">
        {summary}{" "}
        <Link href="/settings" className={linkClass}>
          Change in Settings
        </Link>
      </p>
    </Card>
  );
}

interface FrameProps {
  state: FinderState;
  teamName: string | null;
  /** Says how Helps you weighs later seasons (HowToRead); default redraft. */
  leagueType?: LeagueSettings["leagueType"] | undefined;
  controls: ReactNode;
  statusRef?: Ref<HTMLParagraphElement> | undefined;
  resultsRef?: Ref<HTMLHeadingElement> | undefined;
  againRef?: Ref<HTMLButtonElement> | undefined;
  stopRef?: Ref<HTMLButtonElement> | undefined;
  records: FeedbackRecord[] | undefined;
  leagueKey: string;
  /** The league, to name a recorded version a card no longer shows (tradeView.ts cardFeedback's versionWords); absent: unnamed. */
  snapshot?: SnapshotPart | null | undefined;
  onFeedback: (evaluation: TradeSearchResult["trades"][number], change: FeedbackChange) => ReturnType<typeof saveTradeFeedback>;
  /** A card's "Open in Analyzer" was used (its TradeEvaluation.key, and the link's address): the page remembers it, to come back to it. */
  onOpenAnalyzer?: ((cardKey: string, href?: string) => void) | undefined;
}

/**
 * Every state of the Finder around one status line (role="status"), always the frame's third child, so React
 * keeps the element and each new text is announced. It shows with a spinner while the page waits, and is read to
 * screen readers only otherwise.
 */
export function FinderFrame({ state, teamName, leagueType = "redraft", controls, statusRef, resultsRef, againRef, stopRef, records, leagueKey, snapshot, onFeedback, onOpenAnalyzer }: FrameProps) {
  const text = finderStatus(state);
  const waiting = state.kind === "fetching" || state.kind === "settings";
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-bold tracking-widest text-brand uppercase">Trade ideas</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">{FINDER_TITLE}</h1>
        <p className="mt-2 max-w-2xl text-muted">
          {teamName ? (
            <>
              Trades for <span className="font-bold break-words text-foreground">{teamName}</span>, ranked by how much they help you and how likely the other
              manager is to say yes. The search runs in your browser.
            </>
          ) : (
            "Trades ranked by how much they help you and how likely the other manager is to say yes. The search runs in your browser."
          )}
        </p>
        <p className="mt-2 text-sm">
          <Link href={ANALYZER_PATH} className={cx(linkClass, "inline-flex min-h-11 items-center")}>
            Build your own trade in the Trade Analyzer
          </Link>
        </p>
      </header>
      {controls}
      <p
        ref={statusRef}
        role="status"
        tabIndex={FOCUS_TARGET.tabIndex}
        className={cx(waiting ? "flex items-center gap-3 text-muted" : "sr-only", FOCUS_TARGET.className)}
      >
        {waiting ? <Spinner /> : null}
        {waiting ? " " : null}
        {text}
      </p>
      <FinderBody
        state={state}
        resultsRef={resultsRef}
        againRef={againRef}
        stopRef={stopRef}
        records={records}
        leagueKey={leagueKey}
        snapshot={snapshot}
        onFeedback={onFeedback}
        onOpenAnalyzer={onOpenAnalyzer}
      />
      <HowToRead leagueType={leagueType} />
    </div>
  );
}

function FinderBody({ state, resultsRef, againRef, stopRef, records, leagueKey, snapshot, onFeedback, onOpenAnalyzer }: Omit<FrameProps, "teamName" | "leagueType" | "controls" | "statusRef">) {
  const previous =
    (state.kind === "searching" || state.kind === "stopped" || state.kind === "error") && state.previous ? (
      <div className="opacity-60 transition-opacity">
        <Results view={state.previous} records={records} leagueKey={leagueKey} snapshot={snapshot} onFeedback={onFeedback} onOpenAnalyzer={onOpenAnalyzer} headingText="The last trade ideas found" />
      </div>
    ) : null;
  switch (state.kind) {
    case "fetching":
      return <p className="text-sm text-muted">Projections, stats and trade values for every player in the league. The first load of the day can take half a minute.</p>;
    case "settings":
      return null;
    case "fetchError":
      return (
        <div className="space-y-4">
          <Callout tone="danger" role="alert" title="We couldn't load your league's projections">
            {state.message}
          </Callout>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={state.onRetry} className={buttonClass("primary")}>
              Try again
            </button>
            <Link href="/import" className={buttonClass("secondary")}>
              Back to the Import Report
            </Link>
          </div>
        </div>
      );
    case "noTeam":
      return (
        <Callout tone="warn" title="Which team is yours?">
          <p>{NO_TEAM_TEXT}</p>
          <Link href="/import#your-team" className="mt-1 inline-flex min-h-11 items-center font-bold underline underline-offset-2">
            Pick your team
          </Link>
        </Callout>
      );
    case "searching":
      return (
        <div className="space-y-4">
          <SearchProgress view={state.progress} onStop={state.onStop} stopRef={stopRef} />
          {previous}
        </div>
      );
    case "stopped":
      return (
        <div className="space-y-4">
          <Card>
            <p className="font-bold">You stopped the search.</p>
            <p className="mt-1 text-sm text-muted">
              {state.previous ? "The last trade ideas found are still below. Search again whenever you're ready." : "Search again whenever you're ready."}
            </p>
            <button ref={againRef} type="button" onClick={state.onAgain} className={cx(buttonClass("primary"), "mt-3")}>
              Search again
            </button>
          </Card>
          {previous}
        </div>
      );
    case "error":
      return (
        <div className="space-y-4">
          <Callout tone="danger" role="alert" title="The trade search didn't finish">
            {state.message}
          </Callout>
          <button type="button" onClick={state.onRetry} className={buttonClass("primary")}>
            Try again
          </button>
          {previous}
        </div>
      );
    case "done":
      return (
        <Results view={state.view} records={records} leagueKey={leagueKey} snapshot={snapshot} onFeedback={onFeedback} onOpenAnalyzer={onOpenAnalyzer} headingRef={resultsRef} headingText="Trade ideas" />
      );
  }
}

/**
 * The ideas found: my odds before any trade and what they count, the count, the cards (or why there are none), what
 * was left out on purpose, notes and warnings. Each card's item carries its key (data-trade-key), so a return from the
 * Analyzer can bring it back into view. Memoized: the progress bar re-renders the page while a new search runs, and
 * these cards don't change.
 */
const Results = memo(function Results({
  view,
  records,
  leagueKey,
  snapshot,
  onFeedback,
  onOpenAnalyzer,
  headingRef,
  headingText,
}: {
  view: FinderView;
  records: FeedbackRecord[] | undefined;
  leagueKey: string;
  snapshot?: FrameProps["snapshot"];
  onFeedback: FrameProps["onFeedback"];
  onOpenAnalyzer?: FrameProps["onOpenAnalyzer"];
  headingRef?: Ref<HTMLHeadingElement> | undefined;
  headingText: string;
}) {
  return (
    <section aria-labelledby="results-title" className="space-y-4">
      <div>
        <h2 id="results-title" ref={headingRef} tabIndex={headingRef ? FOCUS_TARGET.tabIndex : undefined} className={cx("text-2xl font-extrabold tracking-tight", FOCUS_TARGET.className)}>
          {headingText}
        </h2>
        {view.baseline ? <p className="mt-1 text-sm font-semibold">{view.baseline}</p> : null}
        {view.baselineNote ? <p className="mt-0.5 text-xs text-muted">{view.baselineNote}</p> : null}
        {view.countText ? <p className="mt-1 text-sm text-muted">{view.countText}</p> : null}
      </div>
      {view.warnings.length ? (
        <Callout tone="warn" title="Some data is missing">
          <ul className="list-disc space-y-0.5 pl-5">
            {view.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
      {view.empty ? (
        <Card>
          <h3 className="text-lg font-extrabold tracking-tight">{view.empty.title}</h3>
          {view.empty.text.map((t) => (
            <p key={t} className="mt-2 text-sm leading-relaxed">
              {t}
            </p>
          ))}
          <p className="mt-3 flex flex-wrap gap-x-4 text-sm">
            <Link href="/settings" className={cx(linkClass, "inline-flex min-h-11 items-center")}>
              Settings
            </Link>
            <Link href={ANALYZER_PATH} className={cx(linkClass, "inline-flex min-h-11 items-center")}>
              Trade Analyzer
            </Link>
          </p>
        </Card>
      ) : (
        <ol className="space-y-4">
          {view.cards.map((card, i) => (
            <li key={card.key} data-trade-key={card.key}>
              <TradeCard
                card={card}
                rank={i + 1}
                feedback={cardFeedback(records, leagueKey, card.key, snapshot ?? undefined)}
                onFeedback={(change) => onFeedback(card.evaluation, change)}
                onOpenAnalyzer={onOpenAnalyzer ? (href: string) => onOpenAnalyzer(card.key, href) : undefined}
              />
            </li>
          ))}
        </ol>
      )}
      {view.hidden ? <p className="text-sm text-muted">{view.hidden}</p> : null}
      {view.notes.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          {view.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      {view.searched ? <p className="text-xs text-muted">{view.searched}</p> : null}
    </section>
  );
});
