"use client";
/**
 * The Trade Finder (CLAUDE.md §12, §13, §14 item 4; Phase 4 wave 2 decisions M12–M14). It loads the league this tab
 * shows (one of the leagues saved in this browser: src/lib/leagueStore.ts, Phase 4c) and its model inputs the way the
 * League page does (useLeagueInputs.ts), reads the league's settings and feedback (the Settings page and the cards save
 * them, per league; every setting goes with the search), and runs the trade search in the engine's Web Worker (§3)
 * as soon as it has all three: with every other team, or with one (the partner filter). The address's `?partner=`
 * picks it (the League page's partner cards link here that way); the page's top component reads it with useSearchParams
 * (through finderMemory.ts useLeagueQuery, never in the keyed part below it), which on a client navigation already holds
 * the new address while the page renders (window.location still holds the old one until the navigation commits), so
 * the app route wraps the page in <Suspense> (src/app/trades/page.tsx). A partner picked
 * here is written back into the address (history.replaceState, which Next keeps in step with useSearchParams) and
 * holds until the address names another one (a link here, the nav's Trades). A change of partner, of a setting
 * (saved here or in another tab; what the league rewards among them, since it changes B), of the league data or of "my
 * team" starts a new search, and the one under way stops; so does leaving the page. The sort (Overall by default, Helps
 * you, Chance they accept: §13) only reorders the ideas found (rank.ts sortTrades, through src/lib/tradeView.ts); since
 * Checkpoint 7c (planner reply to Checkpoint 7b, §7) "Helps both" shows the search's own second list instead
 * (TradeSearchResult.helpsBoth: the trades that help both teams, by Helps you, the minimum chance and the variety rules as
 * the engine applied them), so it never searches again either, with the planner's helper line under the sort, read with it
 * (aria-describedby: "Trades that help them too, sorted by how much they help you.").
 *
 * "Chance they accept: at least" (Phase 4c; planner reply to Checkpoint 4b, change 10): Any, 10% … 50% (the default 10%,
 * saved per league with the other settings: TradeSettings.minChance, changeSavedSettings). The search ranks with the
 * minimum it was started with; changing the minimum alone never searches again: the worker ranks the same ideas again
 * (engineClient.ts refilterTrades, engine.worker.ts `refilter`, search.ts refilterSearch), its progress the ranking
 * alone. The search key leaves the minimum out (searchKeyFor), so remembered ideas ranked at another minimum are
 * re-filtered too. When the worker can't re-filter (a kickoff since, or it no longer holds the search) it searches afresh,
 * and the page shows that search's progress, its status line a search's. The minimum reads the chance the trade goes
 * through (P_complete), which the control says in a league that reviews trades, naming the review as the cards do
 * ("which a league veto vote can cut", "which the commissioner's review can cut": tradeView.ts minChanceNote; review of
 * track UIC, finding 5).
 *
 * What the cards and "How to read" say about values follows the league's data (tradeView.ts valueFactsOf, from the
 * model inputs: FantasyCalc's values, long-term values, the market blend; review of track UIC, findings 2 and 3), and "How
 * to read" words Helps you's scale on the search's own (TradeSearchResult.helpsScale: the mix in a dynasty or keeper league
 * with long-term values, planner reply to Checkpoint 7a, §2 question 6). Under the intro, in season, when to look and how
 * fresh the data is (planner reply to Checkpoint 7a, 5.3: tradeView.ts finderTimingLines, from the league data and model
 * inputs) at the current time: the page's clock (useMinuteClock: when it opened, moved on every minute and when its tab
 * shows again), never the time of the ideas shown (review of Phase 7b: remembered ideas carry their search's time, so
 * values 5 hours old read "updated 30 minutes ago").
 *
 * States: loading the league, loading projections (or failed, with Try again), no team picked (a link to the Import
 * Report), searching or re-filtering (a progress bar with the stage in plain words, and Stop), stopped (Search again),
 * failed (Try again), and done: my odds before any trade (with what they count: src/lib/tradeView.ts baselineLines,
 * the League page's headline odds since Phase 4c) and what "Helps you" sums up, the pattern note when the search found
 * one (change 6), a line when the minimum leaves few ideas, the ideas as cards, what was left out on purpose, notes and
 * warnings, or an empty state that says why there's nothing (no team, season over, deadline passed, none at this
 * minimum, nothing found). While a new search or re-filter runs, and after it's stopped or has failed, the last ideas
 * found for the same partner stay on screen, dimmed.
 *
 * Another league (the switcher at the top of every page, Phase 4c): the page starts fresh for it (one page state per
 * saved league), and its engine client, ideas, address and sort are that league's own (finderMemory.ts), so nothing
 * from one league shows in another: ⚠️ an address read under one league is read as none under another (a switch, a
 * removal here or in another tab) and dropped (finderMemory.ts useLeagueQuery; review of track ML). A feedback press
 * shows on its card at once (the league store applies it), and the card says what it did once the browser has kept it,
 * or in an alert on the card when it refused (FeedbackControls awaits useFeedback.ts saveFeedbackPress; Phase 4c, the
 * crossTrack of track ML: it replaced the page-wide alert). Each press saves the sent version's model inputs, with what
 * the league rewards as the search weighted B (Done.goal; Checkpoint 7c: with the search's prize split, from its own
 * reward, TradeSearchResult.reward), and (Phase 7a, track FB), while "Share anonymous feedback" is on,
 * sends an anonymous copy (src/lib/feedbackShare.ts; the card's one-time note says so the first time).
 *
 * Coming back (review of Phase 4; finderMemory.ts): the trade pages share one engine client, whose worker keeps its
 * evaluation context between them. A search whose ideas were found before in this tab (same league data, inputs, team,
 * settings but the minimum chance, and partner) and still hold (no kickoff since, the same deadline readings:
 * src/workers/freshness.ts) shows them again at once instead of searching, in the sort the page was left in; the
 * Analyzer's "Back to the Trade Finder" returns to this page's address, partner included; and when the user left through
 * an idea's "Open in Analyzer" (its own, or its Plan B's), that link comes back into view with focus on
 * it.
 *
 * "How to offer it" (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1): a card's offers in order are worked out in
 * the engine worker when its disclosure opens (onOffers: engineClient.ts offers, the card by the id of the request whose
 * result holds it and its key, at the moment that search was for; the worker keeps each ladder, so a second open is
 * instant), and worded for the card (tradeView.ts buildLadderView; TradeCard.tsx shows them). An offer that is another card
 * of the list says so with that card's place in the sort shown, "Also shown as trade idea 2." (the lead's call, wave D: the
 * list's places, Results' `places`).
 *
 * "Now or after this week" (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.2): once the search answers, the engine worker
 * works out what each card's Helps you would be if done after this week's games, and each card shows "Helps you 37 now · 41 if
 * done after this week's games." as its numbers arrive (engineClient.ts laterLinesOf, read with useSyncExternalStore), when the
 * two differ by more than config.explain.nowOrLaterMin; ideas shown again (coming back from the Analyzer, or remembered) keep
 * the numbers that came. The ranking stays on "now". The list says in a data attribute whether every card's are in.
 *
 * Accessibility: one status line (role="status") stays mounted through every state, so each change is announced
 * (the stage while searching, then what was found); the progress bar's numbers are read on demand. A button that
 * goes away moves focus to what took its place: Stop → Search again; Search again or Try again (a search) → Stop;
 * Try again (the projections) → the status line, which shows while they load. Whenever a search's results come in
 * (a page-started one too: the first load, a settings change) and focus was left on nothing, on the status line or
 * on a control that went away (Stop, a dimmed card's button), it moves to the results' heading (or, coming back from
 * the Analyzer, to the "Open in Analyzer" link used); a re-filter started from the minimum's select leaves focus there.
 * Controls are native selects with labels, every target at least 44 px tall. The search starts a tick after its effect,
 * so React StrictMode's first run is cancelled before it starts and the worker searches once.
 */
import Link from "next/link";
import { memo, useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from "react";
import type { LeagueSettings, LeagueSnapshot } from "@/engine/model";
import type { Goal, TradeSettings } from "@/engine/settings";
import type { TradeEvaluation, TradeSearchProgress, TradeSearchResult, TradeSort } from "@/engine/tradeModel";
import { EngineError, laterLinesOf, searchResultIdOf, watchLaterLines, type TradeSearchHandle } from "@/lib/engineClient";
import { feedbackShareContext, shownRewardOf, type FeedbackSaveResult } from "@/lib/feedbackShare";
import type { FeedbackChange, FeedbackRecord } from "@/lib/feedbackStore";
import type { CurrentLeagueRead } from "@/lib/leagueStore";
import { modelRequest } from "@/lib/modelStore";
import { TRADE_SETTINGS, settingsFingerprint } from "@/lib/settingsStore";
import {
  ANALYZER_PATH,
  MIN_CHANCE_OPTIONS,
  SORT_OPTIONS,
  buildFinderView,
  buildLadderView,
  cardFeedback,
  fantasyCalcLookup,
  finderHref,
  finderTimingLines,
  isTradeSort,
  minChanceNote,
  offersBarredOf,
  partnerOrNull,
  progressView,
  readFinderPartner,
  settingsSummary,
  sortNote,
  teamNameOf,
  valueFactsOf,
  type FinderTimingView,
  type FinderView,
  type LadderView,
  type ProgressView,
  type SnapshotPart,
  type TradeCardView,
  type ValueFacts,
} from "@/lib/tradeView";
import { contextStillValid } from "@/workers/freshness";
import { NoImportCard } from "../NoImportCard";
import { leagueTag, useCurrentLeague, useSavedLeagueInputs } from "../league/useLeagueInputs";
import { revealResult } from "../reveal";
import { saveFeedbackPress, useSavedFeedback } from "../settings/useFeedback";
import { changeSavedSettings, useSavedLeagueSettings } from "../settings/useLeagueSettings";
import { Callout, Card, FOCUS_TARGET, Spinner, buttonClass, cx, inputClass } from "../ui";
import { recallSearchEntry, rememberFinderAddress, rememberReturn, rememberSearch, rememberSort, rememberedSort, takeReturnTarget, tradeEngine, useLeagueQuery } from "./finderMemory";
import { HowToRead } from "./HowToRead";
import { LeagueLoading } from "./LeagueLoading";
import { SearchProgress } from "./SearchProgress";
import { TradeCard } from "./TradeCard";

export const FINDER_TITLE = "Trade Finder";
export const NO_IMPORT_TEXT = "Connect your ESPN or Sleeper league to get trade ideas for your team. Leagues you import stay saved in this browser until you remove them.";
export const NO_TEAM_TEXT = "Pick your team on the Import Report to see trade ideas.";

const linkClass = "font-semibold text-brand-strong underline underline-offset-2 dark:text-brand";

export function TradeFinderPage() {
  const read = useCurrentLeague();
  // The address's partner, while it's this league's (finderMemory.ts useLeagueQuery: kept here, across a switch).
  const query = useLeagueQuery();
  if (read === undefined) return <LeagueLoading />;
  if (read.kind !== "ok") return <NoImportCard read={read} text={NO_IMPORT_TEXT} />;
  if (!modelRequest(read.stored)) {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <h1 className="text-2xl font-black tracking-tight">Not available for this league yet</h1>
        <p className="mt-2 text-muted">Trade ideas work with ESPN and Sleeper leagues for now.</p>
      </Card>
    );
  }
  // One page state per saved league: switching to or importing another starts fresh (finderMemory.ts: its own worker).
  return <LoadedFinder key={read.league.id} read={read} query={query} />;
}

/**
 * Every setting a trade reads but the minimum chance: changing the minimum alone re-filters the ideas found instead of
 * searching (the header). (Since the planner's reply to Checkpoint 7a, §6.1, there's no playoff-weight setting: the League
 * model sets the weight from the goal, which is one of these.) "Drop from the same position", which only Waiver upgrades
 * reads, isn't one either (settingsStore.ts TRADE_SETTINGS; the final review of Checkpoint 7e, RT-2: switching it searched
 * again for the same ideas).
 */
const SEARCH_SETTINGS = TRADE_SETTINGS.filter((k) => k !== "minChance");

/**
 * What a search is for: the league data, the inputs' build, my team, every setting but the minimum chance (the header),
 * and the partner (finderMemory.ts keys its ideas by it).
 */
export function searchKeyFor(args: {
  snapshot: Pick<LeagueSnapshot, "platform" | "leagueId" | "season" | "fetchedAt">;
  builtAt: string;
  myTeamId: string;
  settings: TradeSettings;
  partnerId: string | null;
}): string {
  return `${leagueTag(args.snapshot)}|${args.builtAt}|${args.myTeamId}|${settingsFingerprint(args.settings, SEARCH_SETTINGS)}|${args.partnerId ?? "*"}`;
}

/** One search: what it's for (searchKeyFor) and the attempt (Search again, Try again). */
export function searchTagFor(args: Parameters<typeof searchKeyFor>[0] & { attempt: number }): string {
  return `${searchKeyFor(args)}|${args.attempt}`;
}

/**
 * Whether ideas found need ranking again for the minimum chance shown (the header): they were ranked at another one.
 * A search that stopped before ranking (no TradeSearchResult.filter) holds for any minimum.
 */
export function needsRefilter(result: Pick<TradeSearchResult, "filter">, minChance: number): boolean {
  return result.filter !== undefined && Math.abs(result.filter.minChance - minChance) > 1e-9;
}

/** A run's progress as the page keeps it: its tag, the bar, and whether a re-filter turned into a new search. */
export type RunProgress = { tag: string; view: ProgressView; searching?: boolean };

/**
 * A re-filter's progress, step by step (the header): the ranking's alone, the whole bar, until the worker answers with a
 * new search (any stage but "rank"); from then on, for good, a search's (its own ranking comes last, near the bar's end).
 */
export function refilterProgress(): (p: TradeSearchProgress | null) => { view: ProgressView; searching: boolean } {
  let searching = false;
  return (p) => {
    if (p && p.stage !== "rank") searching = true;
    return { view: progressView(p, searching ? "search" : "refilter"), searching };
  };
}

/**
 * What the searching state shows for the run under way (`runTag`): its own progress, else the bar's start; and whether
 * it reads as a re-filter (the status line): a re-filter (`refilter`) the worker hasn't turned into a new search.
 */
export function runShown(progress: RunProgress | null, runTag: string | null, refilter: boolean): { view: ProgressView; refilter: boolean } {
  const own = progress && progress.tag === runTag ? progress : null;
  const asRefilter = refilter && !own?.searching;
  return { view: own ? own.view : progressView(null, asRefilter ? "refilter" : "search"), refilter: asRefilter };
}

type FocusTo = "status" | "stop" | "again";

/** Ideas found: the search's tag and key, the result, its partner, the moment it was for and the goal B was weighted by. */
/** A search or re-filter that answered, with the settings and time it ran with (`settings`: what "How to offer it" asks with, Checkpoint 7e). */
type Done = { tag: string; key: string; kind: "done"; result: TradeSearchResult; partnerId: string | null; nowIso: string; goal: Goal; settings: TradeSettings };
type Outcome = Done | { tag: string; kind: "error"; message: string } | { tag: string; kind: "stopped" };

/** The page's state for its status line and body (pure: FinderBody renders it; tests render each). */
export type FinderState =
  | { kind: "fetching" }
  | { kind: "fetchError"; message: string; onRetry: () => void }
  | { kind: "noTeam" }
  | { kind: "settings" }
  | { kind: "searching"; progress: ProgressView; onStop: () => void; previous: FinderView | null; refilter?: boolean }
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
      return state.refilter ? "Showing the trade ideas at your minimum chance…" : `Searching for trade ideas: ${state.progress.label.charAt(0).toLowerCase()}${state.progress.label.slice(1)}…`;
    case "stopped":
      return "Search stopped.";
    case "done":
      return state.view.statusText;
    default:
      return "";
  }
}

/** How often the page's clock moves (useMinuteClock): "updated … ago" counts whole minutes. */
const CLOCK_STEP_MS = 60_000;

/**
 * The page's clock for its timing lines (the header; tradeView.ts finderTimingLines): the time the page opened, moved on
 * every minute it stays open and at once when its tab shows again (a hidden tab's timers can wait), so "updated … ago"
 * reads how old the data is now. Only the timing lines read it: the cards are memoized and don't render again.
 */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, CLOCK_STEP_MS);
    const onShow = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);
  return now;
}

/** `query`: the address's query while it's this league's (useLeagueQuery, in TradeFinderPage: never window.location, which lags a client navigation). */
function LoadedFinder({ read, query }: { read: Extract<CurrentLeagueRead, { kind: "ok" }>; query: string }) {
  const snapshot = read.stored.response.snapshot;
  // The saved league's id: this page's engine client, address and sort are that league's (finderMemory.ts).
  const leagueId = read.league.id;
  const { pair, myTeam, error: fetchError, retry: retryFetch } = useSavedLeagueInputs(read);
  const { settings, key: leagueKey } = useSavedLeagueSettings(read.league.leagueKey);
  const records = useSavedFeedback(read.league.leagueKey);
  // A partner picked here, and the query it was picked under (null = every team).
  const [picked, setPicked] = useState<{ id: string | null; query: string } | null>(null);
  // The sort this league's page was left in, in this tab (finderMemory.ts), else Overall.
  const [sort, setSort] = useState<TradeSort>(() => rememberedSort(leagueId) ?? "overall");
  const [attempt, setAttempt] = useState(0);
  // Why the minimum chance couldn't be saved (the store put the page back), or null.
  const [minChanceError, setMinChanceError] = useState<string | null>(null);

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
    rememberSort(leagueId, value);
  };
  // The minimum chance: saved with the league's settings; the page's copy changes at once, and the ideas are re-filtered.
  const pickMinChance = (value: number) => {
    setMinChanceError(null);
    void changeSavedSettings(leagueKey, (s) => ({ ...s, minChance: value })).then((saved) => {
      if (!saved.ok) setMinChanceError(saved.message);
    });
  };
  const searchKey = pair && myTeamId && settings ? searchKeyFor({ snapshot: pair.snapshot, builtAt: pair.inputs.builtAt, myTeamId, settings, partnerId }) : null;
  const searchTag = searchKey ? `${searchKey}|${attempt}` : null;

  // The Analyzer's "Back to the Trade Finder" comes back to this address, partner included (finderMemory.ts).
  useEffect(() => {
    if (league) rememberFinderAddress(leagueId, finderHref(partnerId));
  }, [league, leagueId, partnerId]);

  // The search, in the trade pages' engine worker (finderMemory.ts tradeEngine: this league's, shared with the Analyzer, never disposed here).
  const handleRef = useRef<TradeSearchHandle | null>(null);
  // Coming back from the Analyzer: the idea whose "Open in Analyzer" was used (and which link), to bring back into view when its search's ideas show.
  const returnRef = useRef<{ tag: string; cardKey: string; href: string | null } | null>(null);
  // `searching`: a re-filter the worker answers with a new search (the header), so the status line says it searches.
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // The last ideas found (kept when a later search runs, stops or fails: shown dimmed for the same partner).
  const [lastDone, setLastDone] = useState<Done | null>(null);

  /** Progress for a run (`tag`), changed only when the bar or the status line shows it (fewer renders while the cards wait). */
  const showProgress = (tag: string, view: ProgressView, searching = false) =>
    setProgress((prev) =>
      prev && prev.tag === tag && prev.view.percent === view.percent && prev.view.label === view.label && !!prev.searching === searching ? prev : { tag, view, searching },
    );

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
      // The ideas this search found before in this tab, while they still hold (finderMemory.ts): shown again at once
      // (re-filtered next when they were ranked at another minimum chance).
      const known = recall ? recallSearchEntry(key, (iso) => contextStillValid(Date.parse(iso), nowMs, job.model, job.snapshot)) : null;
      if (known) {
        returnRef.current = back ? { tag, ...back } : null;
        const done: Done = { tag, key, kind: "done", result: known.result, partnerId: job.partnerId, nowIso: known.nowIso, goal: job.settings.goal, settings: job.settings };
        setOutcome(done);
        setLastDone(done);
        return;
      }
      const nowIso = new Date(nowMs).toISOString();
      setProgress({ tag, view: progressView(null) });
      const handle = tradeEngine(leagueId).searchTrades({ ...job, nowIso }, (p) => {
        if (live) showProgress(tag, progressView(p));
      });
      handleRef.current = handle;
      handle.promise.then(
        (result) => {
          // Remembered even when a newer search took over meanwhile: these ideas are this search's.
          rememberSearch(key, nowIso, result);
          if (!live) return;
          const done: Done = { tag, key, kind: "done", result, partnerId: job.partnerId, nowIso, goal: job.settings.goal, settings: job.settings };
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

  const current = outcome && outcome.tag === searchTag ? outcome : null;
  const doneResult = current?.kind === "done" ? current : null;
  // The minimum chance changed since these ideas were ranked (the header): the worker ranks them again.
  const minChance = settings?.minChance;
  const refilterTag = doneResult && minChance !== undefined && needsRefilter(doneResult.result, minChance) ? `${doneResult.tag}|min:${minChance}` : null;

  const startRefilter = useEffectEvent((tag: string, done: Done) => {
    if (!pair || !myTeamId || !settings) return undefined;
    const job = { snapshot: pair.snapshot, model: pair.inputs, myTeamId, settings, partnerId: done.partnerId, result: done.result };
    let live = true;
    let handle: TradeSearchHandle | null = null;
    // Its progress is the ranking's alone, unless the worker has to search afresh (any other stage).
    const step = refilterProgress();
    // A tick later, as a search starts (StrictMode's first run is cancelled before it starts).
    const timer = setTimeout(() => {
      const nowIso = new Date().toISOString();
      setProgress({ tag, ...step(null) });
      const h = tradeEngine(leagueId).refilterTrades({ ...job, nowIso }, (p) => {
        if (!live) return;
        const shown = step(p);
        showProgress(tag, shown.view, shown.searching);
      });
      handle = h;
      handleRef.current = h;
      h.promise.then(
        (result) => {
          // The same search's ideas at the new minimum, under the same key (finderMemory.ts).
          rememberSearch(done.key, nowIso, result);
          if (!live) return;
          const next: Done = { ...done, result, nowIso, settings: job.settings };
          setOutcome(next);
          setLastDone(next);
        },
        (err: unknown) => {
          if (!live || (err instanceof EngineError && err.cancelled)) return;
          if (err instanceof EngineError && err.detail) console.error("Trade search (re-filter):", err.detail);
          setOutcome({ tag: done.tag, kind: "error", message: err instanceof Error ? err.message : "Something went wrong while crunching the numbers." });
        },
      );
    }, 0);
    return () => {
      live = false;
      clearTimeout(timer);
      const h: TradeSearchHandle | null = handle;
      if (h) {
        h.cancel();
        if (handleRef.current === h) handleRef.current = null;
      }
    };
  });
  useEffect(() => {
    if (!refilterTag || !doneResult) return;
    return startRefilter(refilterTag, doneResult);
  }, [refilterTag, doneResult]);

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

  // The ideas shown are done once they're ranked at the minimum shown (not while a re-filter runs).
  const shownDone = doneResult && !refilterTag ? doneResult : null;
  useEffect(() => {
    if (!shownDone) return;
    // Coming back from the Analyzer: the "Open in Analyzer" link used, back in view and focused (see the header).
    const back = returnRef.current;
    returnRef.current = null;
    if (back && back.tag === shownDone.tag && revealIdea(back.cardKey, back.href)) return;
    // Focus left on nothing, on the status line or on a control that went away (Stop; a dimmed card's button) → the results.
    const active = document.activeElement;
    if (!active || active === document.body || active === statusRef.current || !active.isConnected) resultsRef.current?.focus({ preventScroll: true });
  }, [shownDone]);

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
  // When to look and how fresh the data is (tradeView.ts finderTimingLines), at the page's clock (the header): never the
  // time of the ideas shown, which a remembered search keeps from when it ran.
  const clock = useMinuteClock();
  const timing = useMemo(() => (pair ? finderTimingLines({ snapshot: pair.snapshot, inputs: pair.inputs, now: new Date(clock) }) : null), [pair, clock]);
  // The NFL's last week, for injury tags' "Out for the season" (tradeView.ts seasonEndOf).
  const lastNflWeek = pair?.inputs.nfl?.lastWeek;
  // FantasyCalc's values as the page holds them, never shown (tradeView.ts fantasyCalcLookup).
  const market = pair?.inputs.market;
  const fantasyCalc = useMemo(() => fantasyCalcLookup(market), [market]);
  // What the league's data lets the cards and "How to read" say about values and the market blend (tradeView.ts
  // valueFactsOf; null until the inputs load: the usual words).
  const leagueType = (pair?.snapshot ?? snapshot).settings.leagueType;
  const facts = useMemo(() => (pair ? valueFactsOf(market, leagueType) : null), [pair, market, leagueType]);
  const blendOn = facts?.blendOn;
  // The ideas' "now or after this week" numbers (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.2): the engine worker
  // works them out once the search has answered, and each card shows its line as they arrive (engineClient.ts laterLinesOf,
  // filed with the result the client handed out, so ideas shown again keep theirs).
  const shownResult = shownOutcome?.result ?? null;
  const watchLater = useCallback((onChange: () => void) => (shownResult ? watchLaterLines(shownResult, onChange) : () => undefined), [shownResult]);
  const later = useSyncExternalStore(
    watchLater,
    () => (shownResult ? laterLinesOf(shownResult) : null),
    () => null,
  );
  const view = useMemo(
    () =>
      shownOutcome && league
        ? buildFinderView({ result: shownOutcome.result, sort, snapshot: league, partnerId: shownOutcome.partnerId, lastNflWeek, fantasyCalc, goal: shownOutcome.goal, blendOn, later })
        : null,
    [shownOutcome, sort, league, lastNflWeek, fantasyCalc, blendOn, later],
  );

  // A press shows at once (the league store applies it); the card says what it did once the browser has kept it. Phase 7a
  // (track FB): its anonymous copy reads the league's format and what the cards shown were weighed by: since Checkpoint 7c
  // the search's own reward (TradeSearchResult.reward, the goal with its prize shares, which the copy keeps as whole
  // percents: feedbackShare.ts feedbackRewardOf), else the goal it ran under (shownRewardOf, review FB-R3).
  const shownReward = shownRewardOf(shownOutcome?.result, shownOutcome?.goal);
  const share = useMemo(() => (league ? feedbackShareContext(league, shownReward) : null), [league, shownReward]);
  const onFeedback = useCallback((evaluation: TradeEvaluation, change: FeedbackChange) => saveFeedbackPress({ leagueKey, evaluation, change, share }), [leagueKey, share]);
  // "Open in Analyzer" remembers the idea and the link used, to come back to it (finderMemory.ts).
  const shownKey = shownOutcome?.key ?? null;
  const onOpenAnalyzer = useCallback(
    (cardKey: string, href?: string) => {
      if (shownKey) rememberReturn(shownKey, cardKey, href);
    },
    [shownKey],
  );
  // "How to offer it" (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1): a card's offers, asked of this league's engine
  // worker when its disclosure opens (engineClient.ts offers: the card by the id of the request whose result holds it,
  // searchResultIdOf, and its key; at the moment and with the settings that search ran with, so a dimmed idea, shown while a
  // newer search runs, gets offers on its own numbers even where the worker no longer keeps its result), then worded for the
  // card (tradeView.ts buildLadderView).
  const onOffers = useCallback(
    (card: TradeCardView): Promise<LadderView> => {
      if (!pair || !myTeamId || !shownOutcome || !league) return Promise.reject(new Error("The trade ideas aren't loaded."));
      const client = tradeEngine(leagueId);
      // With its trade in its own order and the keys none of its offers may be (its Plan B: another card of its list can be
      // one, which the card labels), which the worker reads when it no longer keeps the result (the review of wave D, D-ENG-3
      // and UI-D-4: tradeView.ts offersBarredOf).
      const source = {
        kind: "search" as const,
        resultId: searchResultIdOf(client, shownOutcome.result),
        key: card.key,
        proposal: card.evaluation.proposal,
        barred: offersBarredOf(card.evaluation),
      };
      return client
        .offers({ snapshot: pair.snapshot, model: pair.inputs, myTeamId, nowIso: shownOutcome.nowIso, settings: shownOutcome.settings, source })
        .then((ladder) => buildLadderView(ladder, card, { snapshot: league, lastNflWeek, goal: shownOutcome.goal }));
    },
    [pair, myTeamId, shownOutcome, league, leagueId, lastNflWeek],
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
  else if (shownDone && view) state = { kind: "done", view };
  else {
    // A re-filter the worker answers with a new search says so (the header).
    const run = runShown(progress, refilterTag ?? searchTag, refilterTag !== null);
    state = { kind: "searching", progress: run.view, onStop: stop, previous: view, refilter: run.refilter };
  }

  const controls =
    league && myTeamId && settings ? (
      <FinderControls
        snapshot={league}
        myTeamId={myTeamId}
        partnerId={partnerId}
        onPartner={pickPartner}
        sort={sort}
        onSort={pickSort}
        minChance={settings.minChance}
        onMinChance={pickMinChance}
        minChanceNote={minChanceNote(league.settings.tradeReview)}
        minChanceError={minChanceError}
        summary={settingsSummary(settings, league.platform, league.settings.leagueType)}
      />
    ) : null;

  return (
    <FinderFrame
      state={state}
      teamName={league && myTeamId ? teamNameOf(league, myTeamId) : null}
      leagueType={leagueType}
      facts={facts}
      timing={timing}
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
      onOffers={onOffers}
    />
  );
}

/**
 * Brings back into view the idea (its TradeEvaluation.key) whose "Open in Analyzer" was used, with focus on that link
 * (the one with `href`: the card's own or its Plan B's; else the idea's first), the way the user left
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

/**
 * The partner filter, the sort and the minimum chance (native selects, labeled; the minimum's note, in a league that
 * reviews trades, and a save that failed, read with it; under "Helps both", the planner's helper line read with the sort),
 * and what the settings let a trade idea be.
 */
export function FinderControls({
  snapshot,
  myTeamId,
  partnerId,
  onPartner,
  sort,
  onSort,
  minChance,
  onMinChance,
  minChanceNote = null,
  minChanceError = null,
  summary,
}: {
  snapshot: Pick<LeagueSnapshot, "teams">;
  myTeamId: string;
  partnerId: string | null;
  onPartner: (id: string | null) => void;
  sort: TradeSort;
  onSort: (sort: TradeSort) => void;
  /** "Chance they accept: at least" (TradeSettings.minChance: one of MIN_CHANCE_OPTIONS). */
  minChance: number;
  onMinChance: (minChance: number) => void;
  minChanceNote?: string | null | undefined;
  minChanceError?: string | null | undefined;
  summary: string;
}) {
  const others = snapshot.teams.filter((t) => t.id !== myTeamId);
  const noteId = useId();
  const errorId = useId();
  const sortNoteId = useId();
  const described = [minChanceNote ? noteId : null, minChanceError ? errorId : null].filter(Boolean).join(" ");
  // The planner's helper line under "Helps both" (Checkpoint 7c; tradeView.ts sortNote), read with the sort.
  const sortHelp = sortNote(sort);
  return (
    <Card>
      <div className="grid gap-3 sm:grid-cols-3">
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
            aria-describedby={sortHelp ? sortNoteId : undefined}
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
          {sortHelp ? (
            <p id={sortNoteId} className="mt-1 text-xs text-muted">
              {sortHelp}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="finder-min-chance" className="text-sm font-bold">
            Chance they accept: at least
          </label>
          <select
            id="finder-min-chance"
            value={String(minChance)}
            aria-describedby={described || undefined}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (MIN_CHANCE_OPTIONS.some((o) => o.value === value)) onMinChance(value);
            }}
            className={cx(inputClass, "mt-1")}
          >
            {MIN_CHANCE_OPTIONS.map((o) => (
              <option key={o.value} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
          {minChanceNote ? (
            <p id={noteId} className="mt-1 text-xs text-muted">
              {minChanceNote}
            </p>
          ) : null}
          {minChanceError ? (
            <p id={errorId} role="alert" className="mt-1 text-xs font-semibold text-danger-fg">
              {minChanceError}
            </p>
          ) : null}
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
  /**
   * What the league's data lets "How to read" say about values and the market blend (tradeView.ts valueFactsOf); absent or
   * null: the usual words. Long-term values also count as missing when a card shown says so (TradeEvaluation.dynMissing).
   */
  facts?: ValueFacts | null | undefined;
  /** When to look and how fresh the data is, under the intro (tradeView.ts finderTimingLines); absent or null: not shown. */
  timing?: FinderTimingView | null | undefined;
  controls: ReactNode;
  statusRef?: Ref<HTMLParagraphElement> | undefined;
  resultsRef?: Ref<HTMLHeadingElement> | undefined;
  againRef?: Ref<HTMLButtonElement> | undefined;
  stopRef?: Ref<HTMLButtonElement> | undefined;
  records: FeedbackRecord[] | undefined;
  leagueKey: string;
  /** The league, to name a recorded version a card no longer shows (tradeView.ts cardFeedback's versionWords); absent: unnamed. */
  snapshot?: SnapshotPart | null | undefined;
  /** Saves a card's feedback press; its promise says whether the browser kept it (the card says so), and whether an anonymous copy is on its way. */
  onFeedback: (evaluation: TradeSearchResult["trades"][number], change: FeedbackChange) => FeedbackSaveResult | Promise<FeedbackSaveResult>;
  /** A card's "Open in Analyzer" was used (its TradeEvaluation.key, and the link's address): the page remembers it, to come back to it. */
  onOpenAnalyzer?: ((cardKey: string, href?: string) => void) | undefined;
  /** "How to offer it" (Checkpoint 7e, item 4.1): works a card's offers out when its disclosure opens (TradeCard's `onOffers`); absent: no card shows it. */
  onOffers?: ((card: TradeCardView) => Promise<LadderView>) | undefined;
}

/**
 * Every state of the Finder around one status line (role="status"), always the frame's third child, so React
 * keeps the element and each new text is announced. It shows with a spinner while the page waits, and is read to
 * screen readers only otherwise.
 */
export function FinderFrame({ state, teamName, leagueType = "redraft", facts, timing, controls, statusRef, resultsRef, againRef, stopRef, records, leagueKey, snapshot, onFeedback, onOpenAnalyzer, onOffers }: FrameProps) {
  const text = finderStatus(state);
  const waiting = state.kind === "fetching" || state.kind === "settings";
  // The ideas on screen (dimmed ones included): a card whose long-term values are missing says Helps you counts this season only.
  const shown = state.kind === "done" ? state.view : state.kind === "searching" || state.kind === "stopped" || state.kind === "error" ? state.previous : null;
  const longTermOn = (facts?.longTermOn ?? true) && !(shown?.cards.some((c) => c.evaluation.dynMissing) ?? false);
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
        {timing?.bestTime ? <p className="mt-2 max-w-2xl text-sm text-muted">{timing.bestTime}</p> : null}
        {timing?.freshness ? <p className="mt-1 text-xs text-muted">{timing.freshness}</p> : null}
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
        onOffers={onOffers}
      />
      <HowToRead leagueType={leagueType} valuesOn={facts?.valuesOn ?? true} longTermOn={longTermOn} blendOn={facts?.blendOn ?? true} helpsScale={shown?.helpsScale ?? null} reward={shown?.reward ?? null} />
    </div>
  );
}

function FinderBody({ state, resultsRef, againRef, stopRef, records, leagueKey, snapshot, onFeedback, onOpenAnalyzer, onOffers }: Omit<FrameProps, "teamName" | "leagueType" | "facts" | "timing" | "controls" | "statusRef">) {
  const previous =
    (state.kind === "searching" || state.kind === "stopped" || state.kind === "error") && state.previous ? (
      <div className="opacity-60 transition-opacity">
        <Results view={state.previous} records={records} leagueKey={leagueKey} snapshot={snapshot} onFeedback={onFeedback} onOpenAnalyzer={onOpenAnalyzer} onOffers={onOffers} headingText="The last trade ideas found" />
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
        <Results view={state.view} records={records} leagueKey={leagueKey} snapshot={snapshot} onFeedback={onFeedback} onOpenAnalyzer={onOpenAnalyzer} onOffers={onOffers} headingRef={resultsRef} headingText="Trade ideas" />
      );
  }
}

/**
 * The ideas found: my odds before any trade and what they count, what "Helps you" sums up, the count, the pattern note
 * and the few-ideas line above the list, the cards (or why there are none), what was left out on purpose, notes and
 * warnings. Each card's item carries its key (data-trade-key), so a return from the Analyzer can bring it back into
 * view. Memoized: the progress bar re-renders the page while a new search runs, and these cards don't change.
 */
const Results = memo(function Results({
  view,
  records,
  leagueKey,
  snapshot,
  onFeedback,
  onOpenAnalyzer,
  onOffers,
  headingRef,
  headingText,
}: {
  view: FinderView;
  records: FeedbackRecord[] | undefined;
  leagueKey: string;
  snapshot?: FrameProps["snapshot"];
  onFeedback: FrameProps["onFeedback"];
  onOpenAnalyzer?: FrameProps["onOpenAnalyzer"];
  onOffers?: FrameProps["onOffers"];
  headingRef?: Ref<HTMLHeadingElement> | undefined;
  headingText: string;
}) {
  // Each card's place in the list shown (1 = first), for the offers of "How to offer it" that are other cards (the lead's
  // call, wave D: "Also shown as trade idea 2.", TradeCard's `places`); this sort's, so it follows a re-sort.
  const places = useMemo(() => new Map(view.cards.map((c, i) => [c.key, i + 1] as const)), [view.cards]);
  return (
    <section aria-labelledby="results-title" className="space-y-4">
      <div>
        <h2 id="results-title" ref={headingRef} tabIndex={headingRef ? FOCUS_TARGET.tabIndex : undefined} className={cx("text-2xl font-extrabold tracking-tight", FOCUS_TARGET.className)}>
          {headingText}
        </h2>
        {view.baseline ? <p className="mt-1 text-sm font-semibold">{view.baseline}</p> : null}
        {view.baselineNote ? <p className="mt-0.5 text-xs text-muted">{view.baselineNote}</p> : null}
        {view.helpsInfo ? <p className="mt-0.5 text-xs text-muted">{view.helpsInfo}</p> : null}
        {view.countText ? <p className="mt-1 text-sm text-muted">{view.countText}</p> : null}
      </div>
      {view.warnings.length ? (
        <Callout tone="warn" title="Things to know">
          <ul className="list-disc space-y-0.5 pl-5">
            {view.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
      {view.pattern ? <Callout>{view.pattern}</Callout> : null}
      {view.few ? <p className="text-sm font-semibold">{view.few}</p> : null}
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
        // Whether every card's "now or after this week" numbers are in (FinderView.nowOrLater; `npm run check:browser` waits on it).
        <ol className="space-y-4" data-now-or-later={view.nowOrLater}>
          {view.cards.map((card, i) => (
            <li key={card.key} data-trade-key={card.key}>
              <TradeCard
                card={card}
                rank={i + 1}
                feedback={cardFeedback(records, leagueKey, card.key, snapshot ?? undefined)}
                onFeedback={(change) => onFeedback(card.evaluation, change)}
                onOpenAnalyzer={onOpenAnalyzer ? (href: string) => onOpenAnalyzer(card.key, href) : undefined}
                onOffers={onOffers}
                places={places}
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
