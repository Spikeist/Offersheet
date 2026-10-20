"use client";
/**
 * The Trade Analyzer (CLAUDE.md §13 "Trade Analyzer", §14 item 5; Phase 4 wave 2 decision M13): the user builds any
 * trade with one team (a counteroffer included), and sees the same evaluation a trade idea gets
 * (src/engine/evaluate.ts analyzeTrade, in the engine's Web Worker: exact lineups and the full season simulation),
 * on the same card, or why the trade can't be made. It loads the league this tab shows (one of the leagues saved in this
 * browser: src/lib/leagueStore.ts, Phase 4c) the way the League page does (useLeagueInputs.ts), sends the league's
 * settings with every evaluation, and reads and saves its feedback per league (useFeedback.ts saveFeedbackPress: the card
 * says what a press did once the browser has kept it, or why not; each press saves the sent version's model inputs, with
 * what the league rewards ("What does your league reward?", TradeSettings.goal) as the evaluation weighted B (Checkpoint 7c:
 * with its prize split, from the evaluation's own reward, TradeAnalysis.reward); Phase 7a,
 * track FB: and, while "Share anonymous feedback" is on, sends
 * an anonymous copy, src/lib/feedbackShare.ts).
 *
 * Phase 4c (planner reply to Checkpoint 4b): the card is the Trade Finder's, with my title and playoff odds before and
 * after and the weeks whose win chance moves (change 9), and "Details", which only the Analyzer shows: since the planner's
 * reply to Checkpoint 7a (§2 question 5 and 5.4) what Helps you is worth in points a week, never a trade value (no
 * FantasyCalc value shows anywhere: tradeView.ts fantasyCalcLookup, from the model inputs this page holds, only says
 * whether values are behind the numbers). What "Helps you" sums up is said once, above the card, and "How to read" words
 * its scale on the evaluation's own (TradeAnalysis.helpsScale).
 * What the card and "How to read" say about values follows the league's data (tradeView.ts valueFactsOf: FantasyCalc's
 * values, long-term values, the market blend; review of track UIC, findings 2 and 3).
 *
 * Building: pick the partner, then my players to give and theirs to get, from the active rosters and IR (Phase 4b:
 * IR players are tradable, each choice saying "IR slot"; taxi players still aren't), up to config.search.analyzerMaxPerSide a side (a full side's other
 * boxes are disabled, and the page says why). The address can carry a trade (`?partner=&give=&get=`, a team id and
 * player ids only: the Trade Finder's "Open in Analyzer" links). It's read with useSearchParams, which on a client
 * navigation already holds the new address while the page renders (window.location still holds the old one until
 * the navigation commits), so the app route wraps the page in <Suspense> (src/app/analyzer/page.tsx). ⚠️ An address
 * read under one saved league is read as none under another (a switch, a removal here or in another tab) and dropped,
 * so another league's teams and players never prefill a trade here (finderMemory.ts useLeagueQuery; review of track
 * ML). Anything that isn't on those rosters is ignored, and a complete trade is evaluated straight away. Edits hold
 * until the address names another trade. Evaluate writes the trade back into the address (history.replaceState, which
 * Next keeps in step with useSearchParams), so a reload or a bookmark keeps it, and that write never counts as a new
 * trade to evaluate. The result stays editable: change anything and Evaluate again. A result for a trade that has since
 * changed, or for older league data or settings, stays on screen dimmed, saying so. Above the card, my odds before
 * this trade (the worker sends them with the evaluation), worded as the Trade Finder words them, so a trade's odds
 * read the same on both pages, end percents included (src/lib/tradeView.ts baselineLines; review of Phase 4). Under
 * the card, "How to read the evaluation" (HowToRead.tsx, as on the Trade Finder) says what the numbers, "Harder to
 * get" and "How to offer it" mean, and why the message can propose less than the trade built (review of the planner
 * addendum to Checkpoint 3).
 *
 * A trade opened from a Trade Finder card's Plan B ("If they won't move: try …") carries `from=planB` in its address (review
 * of Phase 4b): while the trade built is that one, it's shown as one offer, without "How to offer it" (tradeView.ts
 * CardContext.offers "none"; the worker's `steps: false` as before), so its first offer can't ask for more than the trade the
 * other manager just turned down, and its message proposes the trade itself; a note under the card says so. Change the trade
 * and it's evaluated as usual (the address drops the mark on Evaluate).
 *
 * "How to offer it" (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1): the card's offers in order, the trade built
 * among them ("The trade you built"), worked out in the engine worker when its disclosure opens (onOffers: engineClient.ts
 * offers, by the card's proposal, for the moment and settings it was evaluated for), not on a result gone stale (whose offers
 * already in stay, as its feedback reads them: TradeCard.tsx offersStateFor; the final review of Checkpoint 7e, UI-F-2). The
 * card is keyed by its trade, so the next trade evaluated starts with its own feedback and offers (UI-F-1).
 *
 * Getting there and back (review of Phase 4): on a phone the result sits a few screens below the form. Evaluate brings
 * it into view (its section's top at the top of the screen when it's taller than the screen) and moves focus to its
 * heading; so does the address's trade (the Trade Finder's "Open in Analyzer") once it's evaluated, unless the user
 * has put focus somewhere on the page meanwhile (they're busy there), and a failure is brought into view the same
 * way. The status line sits above the form, so "Evaluating the trade…" shows near the top while the address's trade
 * is evaluated. "Back to the Trade Finder" goes to this league's Finder's last address, its partner filter included,
 * where the Finder shows the ideas it found again (src/components/trades/finderMemory.ts, per saved league); the two
 * pages share the league's engine client, so the Analyzer reuses the evaluation context a search built.
 *
 * Checkpoint 7c (planner reply to Checkpoint 7b, §7: "The Analyzer shows the same"): the card is the Trade Finder's, so a
 * trade that helps both teams carries the "Helps both" tag with its heading and every evaluated trade the partner's line
 * after mine ("Helps them 24 · Their title odds 6.0% → 6.9% · Their playoff odds 41% → 45%"); the status line says the
 * partner's score too (analysisStatus), and "How to read the evaluation" says what it is and that the Trade Finder's
 * "Helps both" sort shows such trades.
 *
 * Accessibility: the partner is a labeled native select; each side's players are a fieldset of native checkboxes
 * (44 px rows; position, NFL team and injury in words); one status line (role="status") announces each evaluation.
 *
 * "What if" (Checkpoint 7h; planner reply to Checkpoint 7g, section 4: "Pick players to take off your roster and any players to
 * put on it, from any team or from free agency. There's no partner and no chance they accept."): once the league is in with a
 * team of mine, a 44 px switch ("Trade with a team" | "What if": WhatIfPanel.tsx AnalyzerModeSwitch) above the form; the
 * what-if mode is WhatIfPanel.tsx (its own form, status line and result: my odds before → after, Helps you on my odds alone,
 * the planner's "Other teams don't change. To see a real trade, use the Analyzer with a partner."; no offers, Plan B or
 * feedback). The mode is the address's (`?mode=whatif&remove=…&add=…`, player ids only: whatIfView.ts) until the switch is
 * pressed; both modes stay mounted (the other one hidden), and each one's draft holds while the address names the other mode
 * (an evaluation writes its own mode's address), so switching keeps each one's draft and result.
 */
import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState, type Ref } from "react";
import type { LeagueSettings, LeagueSnapshot } from "@/engine/model";
import type { Goal, TradeSettings } from "@/engine/settings";
import type { TradeEvaluation } from "@/engine/tradeModel";
import { EngineError } from "@/lib/engineClient";
import { feedbackShareContext, shownRewardOf, type FeedbackSaveResult } from "@/lib/feedbackShare";
import type { FeedbackChange, FeedbackRecord } from "@/lib/feedbackStore";
import type { CurrentLeagueRead } from "@/lib/leagueStore";
import { modelRequest } from "@/lib/modelStore";
import { TRADE_SETTINGS, settingsFingerprint } from "@/lib/settingsStore";
import {
  ANALYZER_MAX_PER_SIDE,
  EMPTY_DRAFT,
  analyzerChoices,
  analyzerHref,
  buildAnalysisView,
  buildLadderView,
  cardFeedback,
  draftKey,
  draftProposal,
  draftSummary,
  fantasyCalcLookup,
  readAnalyzerDraft,
  readAnalyzerFrom,
  valueFactsOf,
  type AnalysisView,
  type AnalyzerChoices,
  type AnalyzerDraft,
  type AnalyzerFrom,
  type LadderView,
  type PlayerChoice,
  type SnapshotPart,
  type TradeCardView,
  type ValueFacts,
} from "@/lib/tradeView";
import { readAnalyzerMode, type AnalyzerMode } from "@/lib/whatIfView";
import type { AnalyzerResult } from "@/workers/engine.worker";
import { NoImportCard } from "../NoImportCard";
import { leagueTag, useCurrentLeague, useSavedLeagueInputs } from "../league/useLeagueInputs";
import { revealResult } from "../reveal";
import { saveFeedbackPress, useSavedFeedback } from "../settings/useFeedback";
import { useSavedLeagueSettings } from "../settings/useLeagueSettings";
import { Badge, Callout, Card, CardTitle, FOCUS_TARGET, Spinner, buttonClass, cx, inputClass } from "../ui";
import { finderAddress, tradeEngine, useLeagueQuery } from "./finderMemory";
import { HowToRead } from "./HowToRead";
import { TradeCard } from "./TradeCard";
import { LeagueLoading } from "./LeagueLoading";
import { AnalyzerModeSwitch, WhatIfPanel } from "./WhatIfPanel";

export const ANALYZER_TITLE = "Trade Analyzer";
export const NO_IMPORT_TEXT = "Connect your ESPN or Sleeper league to build and check your own trades. Leagues you import stay saved in this browser until you remove them.";

const linkClass = "font-semibold text-brand-strong underline underline-offset-2 dark:text-brand";

export function AnalyzerPage() {
  const read = useCurrentLeague();
  // The address's trade, while it's this league's (finderMemory.ts useLeagueQuery: kept here, across a switch).
  const query = useLeagueQuery();
  if (read === undefined) return <LeagueLoading />;
  if (read.kind !== "ok") return <NoImportCard read={read} text={NO_IMPORT_TEXT} />;
  if (!modelRequest(read.stored)) {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <h1 className="text-2xl font-black tracking-tight">Not available for this league yet</h1>
        <p className="mt-2 text-muted">The Trade Analyzer works with ESPN and Sleeper leagues for now.</p>
      </Card>
    );
  }
  // One page state per saved league: switching to or importing another starts fresh (finderMemory.ts: its own worker).
  return <LoadedAnalyzer key={read.league.id} current={read} query={query} />;
}

/**
 * What an evaluation is for besides the trade: the league data, the inputs' build, my team and every setting a trade reads
 * (settingsStore.ts TRADE_SETTINGS: "Drop from the same position", Waiver upgrades' alone, dims nothing here; the final
 * review of Checkpoint 7e, RT-2).
 */
function contextTagFor(snapshot: Pick<LeagueSnapshot, "platform" | "leagueId" | "season" | "fetchedAt">, builtAt: string, myTeamId: string, settings: TradeSettings): string {
  return `${leagueTag(snapshot)}|${builtAt}|${myTeamId}|${settingsFingerprint(settings, TRADE_SETTINGS)}`;
}

interface Evaluated {
  /** The trade (draftKey, with "|planB" when it was evaluated as a Plan B) and what it was evaluated against (contextTagFor). */
  draft: string;
  context: string;
  /** The evaluation, with my odds before any trade. */
  analysis: AnalyzerResult;
  /** "planB": opened from a card's Plan B ("If they won't move: try …") and shown without "How to offer it" (the header). */
  from: AnalyzerFrom | null;
  /** What the league rewards (TradeSettings.goal) as the evaluation weighted B (the feedback's version inputs). */
  goal: Goal;
  /** The moment and the settings it was evaluated for: "How to offer it" works its offers out for the same (Checkpoint 7e). */
  nowIso: string;
  settings: TradeSettings;
}

/**
 * The status line once an evaluation is in (announced: the line is a live region): why the trade can't be made, or its three
 * numbers as the card prints them ("Evaluated: Helps you 39, chance they accept 40%, Overall 18."), and since Checkpoint 7c
 * (planner reply to Checkpoint 7b, §7: "The Analyzer shows the same") the partner's score when the card shows it (", Helps
 * them 24", and "It helps both teams." under the tag).
 */
export function analysisStatus(view: Pick<AnalysisView, "illegal" | "card">): string {
  if (view.illegal) return `This trade can't be made: ${view.illegal}`;
  const card = view.card;
  if (!card) return "Evaluated.";
  const n = card.numbers;
  const them = card.them ? `, ${card.them.label} ${card.them.helps.value}` : "";
  const both = card.helpsBothTag ? " It helps both teams." : "";
  return `Evaluated: Helps you ${n.helps.value}, chance they accept ${n.accept.srText ?? n.accept.value}, Overall ${n.overall.value}${them}.${both}`;
}

/** Focus is on nothing in particular (the page, or an element that's gone): the user isn't busy somewhere on the page. */
function focusIdle(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
}

/** `query`: the address's query while it's this league's (useLeagueQuery, in AnalyzerPage: never window.location, which lags a client navigation). */
function LoadedAnalyzer({ current, query }: { current: Extract<CurrentLeagueRead, { kind: "ok" }>; query: string }) {
  // The saved league's id: its engine client and its Finder's address are that league's (finderMemory.ts).
  const leagueId = current.league.id;
  const { pair, myTeam, error: fetchError, retry: retryFetch } = useSavedLeagueInputs(current);
  const { settings, key: leagueKey } = useSavedLeagueSettings(current.league.leagueKey);
  const records = useSavedFeedback(current.league.leagueKey);
  // The trade as edited here, and the query it was edited under.
  const [edited, setEdited] = useState<{ draft: AnalyzerDraft; query: string } | null>(null);

  const myTeamId = myTeam?.myTeamId ?? null;
  const league = pair && myTeamId ? pair.snapshot : null;
  const prefill = useMemo(() => (league ? readAnalyzerDraft(query, league, myTeamId) : EMPTY_DRAFT), [league, query, myTeamId]);
  // An edit holds while the address is the one it was made under, or names the same trade (Evaluate's own write), or (Checkpoint
  // 7h) names a what-if (the other mode's evaluation wrote it: the trade being built waits for its mode).
  const editHolds = edited !== null && (edited.query === query || draftKey(edited.draft) === draftKey(prefill) || readAnalyzerMode(query) === "whatif");
  const draft = edited && editHolds ? edited.draft : prefill;
  // The address's trade opened from a card's Plan B (`?from=planB`): shown as one offer while it's the trade built (the header).
  const planBKey = league && readAnalyzerFrom(query) === "planB" && draftProposal(prefill) ? draftKey(prefill) : null;
  const fromOf = (d: AnalyzerDraft): AnalyzerFrom | null => (planBKey !== null && draftKey(d) === planBKey ? "planB" : null);
  const evalKey = (d: AnalyzerDraft): string => `${draftKey(d)}${fromOf(d) ? "|planB" : ""}`;
  const contextTag = pair && myTeamId && settings ? contextTagFor(pair.snapshot, pair.inputs.builtAt, myTeamId, settings) : null;
  // "Back to the Trade Finder": this league's Finder's last address in this tab, its partner filter included (finderMemory.ts).
  const [backHref] = useState(() => finderAddress(leagueId));

  const latest = useRef(0);
  const [evaluated, setEvaluated] = useState<Evaluated | null>(null);
  // A press shows at once (the league store applies it); the card says what it did once the browser has kept it. Phase 7a
  // (track FB): its anonymous copy reads the league's format and what the evaluation shown was weighed by: since Checkpoint
  // 7c its own reward (TradeAnalysis.reward, the goal with its prize shares, which the copy keeps as whole percents:
  // feedbackShare.ts feedbackRewardOf), else the goal it ran under (shownRewardOf, review FB-R3).
  const shownReward = shownRewardOf(evaluated?.analysis, evaluated?.goal);
  const share = useMemo(() => (league ? feedbackShareContext(league, shownReward) : null), [league, shownReward]);
  const onFeedback = useCallback((evaluation: TradeEvaluation, change: FeedbackChange) => saveFeedbackPress({ leagueKey, evaluation, change, share }), [leagueKey, share]);
  // "How to offer it" (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1): the card's offers, asked of this league's
  // engine worker when its disclosure opens (engineClient.ts offers: the card by its proposal, for the moment and settings it
  // was evaluated for), then worded for the card (tradeView.ts buildLadderView).
  const lastWeek = pair?.inputs.nfl?.lastWeek;
  const onOffers = useCallback(
    (card: TradeCardView): Promise<LadderView> => {
      if (!pair || !myTeamId || !evaluated || !league) return Promise.reject(new Error("The trade isn't evaluated."));
      return tradeEngine(leagueId)
        .offers({ snapshot: pair.snapshot, model: pair.inputs, myTeamId, nowIso: evaluated.nowIso, settings: evaluated.settings, source: { kind: "analysis", proposal: card.evaluation.proposal } })
        .then((ladder) => buildLadderView(ladder, card, { snapshot: league, lastNflWeek: lastWeek, goal: evaluated.goal }));
    },
    [pair, myTeamId, evaluated, league, leagueId, lastWeek],
  );
  const [working, setWorking] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const [reveal, setReveal] = useState<{ n: number; to: "result" | "failure" } | null>(null);
  useEffect(() => {
    if (!reveal) return;
    // The whole result into view (its top at the top of the screen when it's taller), focus on its heading (see the header).
    if (reveal.to === "result") revealResult(sectionRef.current, resultRef.current);
    else revealResult(failureRef.current);
  }, [reveal]);

  /**
   * Evaluates a trade (Evaluate, or the address's trade on opening: auto); only the latest one's answer counts. Its
   * result (or failure) is brought into view, the address's trade's only while focus is idle (see the header).
   */
  function evaluate(d: AnalyzerDraft, auto: boolean) {
    const proposal = draftProposal(d);
    if (!proposal || !pair || !myTeamId || !settings || !contextTag) return;
    const n = ++latest.current;
    const from = fromOf(d);
    const key = evalKey(d);
    const context = contextTag;
    const goal = settings.goal;
    const asked = settings;
    const nowIso = new Date().toISOString();
    const show = (to: "result" | "failure") => {
      if (!auto || focusIdle()) setReveal((r) => ({ n: (r?.n ?? 0) + 1, to }));
    };
    setWorking(key);
    setFailure(null);
    try {
      window.history.replaceState(null, "", analyzerHref(proposal, { from }));
    } catch {
      // the address just doesn't keep the trade
    }
    tradeEngine(leagueId)
      .analyzeTrade({ snapshot: pair.snapshot, model: pair.inputs, myTeamId, nowIso, settings, proposal, ...(from === "planB" ? { steps: false } : {}) })
      .then(
        (analysis) => {
          if (n !== latest.current) return;
          setWorking(null);
          setEvaluated({ draft: key, context, analysis, from, goal, nowIso, settings: asked });
          show("result");
        },
        (err: unknown) => {
          if (n !== latest.current || (err instanceof EngineError && err.cancelled)) return;
          if (err instanceof EngineError && err.detail) console.error("Trade Analyzer:", err.detail);
          setWorking(null);
          setFailure(err instanceof Error ? err.message : "Something went wrong while crunching the numbers.");
          show("failure");
        },
      );
  }

  // The address's trade, evaluated once when everything it needs is in and it isn't being edited (a tick later:
  // StrictMode's first run is cancelled). A new trade in the address is evaluated in turn.
  const autoKey = contextTag && !editHolds && draftProposal(prefill) ? evalKey(prefill) : null;
  const startAuto = useEffectEvent(() => {
    const d = prefill;
    const timer = setTimeout(() => evaluate(d, true), 0);
    return () => clearTimeout(timer);
  });
  useEffect(() => {
    if (!autoKey) return;
    return startAuto();
  }, [autoKey]);

  const choices = useMemo(() => (league ? analyzerChoices(league, myTeamId, draft) : null), [league, myTeamId, draft]);
  // The NFL's last week, for injury tags' "Out for the season" (tradeView.ts seasonEndOf).
  const lastNflWeek = pair?.inputs.nfl?.lastWeek;
  // FantasyCalc's values as the page holds them, never shown (tradeView.ts fantasyCalcLookup).
  const market = pair?.inputs.market;
  const fantasyCalc = useMemo(() => fantasyCalcLookup(market), [market]);
  // What the league's data lets the card and "How to read" say about values and the market blend (tradeView.ts valueFactsOf).
  const leagueType = pair?.snapshot.settings.leagueType ?? "redraft";
  const facts = useMemo(() => (pair ? valueFactsOf(market, leagueType) : null), [pair, market, leagueType]);
  const blendOn = facts?.blendOn;
  const resultView = useMemo(
    () => (evaluated && league ? buildAnalysisView(evaluated.analysis, league, lastNflWeek, { from: evaluated.from, fantasyCalc, goal: evaluated.goal, blendOn }) : null),
    [evaluated, league, lastNflWeek, fantasyCalc, blendOn],
  );
  const stale = evaluated !== null && (evaluated.draft !== evalKey(draft) || evaluated.context !== contextTag);
  const busy = working !== null;

  const status = busy ? "Evaluating the trade…" : failure ? "" : resultView ? analysisStatus(resultView) : "";

  // Checkpoint 7h (the header, "What if"): the mode the address names (whatIfView.ts readAnalyzerMode), until the switch is
  // pressed under it; an address written since (an evaluation's) names its own. The switch shows once the league is in with a
  // team of mine, and both modes stay mounted, so switching keeps each one's draft and result.
  const [modeEdit, setModeEdit] = useState<{ mode: AnalyzerMode; query: string } | null>(null);
  const mode: AnalyzerMode = modeEdit && modeEdit.query === query ? modeEdit.mode : readAnalyzerMode(query);
  const whatIfReady = !!(pair && settings && myTeamId && contextTag);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-bold tracking-widest text-brand uppercase">Trade ideas</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">{ANALYZER_TITLE}</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Build any trade, a counteroffer included, and see how much it helps you and how likely the other manager is to say yes, the same way trade ideas are
          scored. It runs in your browser.
        </p>
        <p className="mt-2 text-sm">
          {/* No prefetch: the address can carry a team id (?partner=), and links that carry ids reach the server only when opened (CLAUDE.md §14; B4 review). */}
          <Link href={backHref} prefetch={false} className={cx(linkClass, "inline-flex min-h-11 items-center")}>
            Back to the Trade Finder
          </Link>
        </p>
      </header>

      {/* Checkpoint 7h: the two modes, once the league is in with a team of mine (the header, "What if"). */}
      {whatIfReady ? <AnalyzerModeSwitch mode={mode} onChange={(m) => setModeEdit({ mode: m, query })} /> : null}

      {/* The trade: hidden, still mounted, while the what-if shows (its draft and result wait for it). */}
      <div hidden={mode === "whatif" && whatIfReady} className="space-y-6">
        {/* Always mounted, so each evaluation is announced; above the form, so the address's trade shows it's being evaluated near the top. */}
        <p role="status" className={busy ? "flex items-center gap-3 text-sm font-semibold text-muted" : "sr-only"}>
          {busy ? <Spinner /> : null}
          {busy ? " " : null}
          {status}
        </p>

        {!pair && fetchError ? (
          <div className="space-y-4">
            <Callout tone="danger" role="alert" title="We couldn't load your league's projections">
              {fetchError}
            </Callout>
            <button type="button" onClick={retryFetch} className={buttonClass("primary")}>
              Try again
            </button>
          </div>
        ) : !pair || !settings ? (
          <p className="flex items-center gap-3 text-muted">
            <Spinner /> {pair ? "Loading your settings…" : "Loading projections…"}
          </p>
        ) : !myTeamId ? (
          <Callout tone="warn" title="Which team is yours?">
            <p>Pick your team on the Import Report to build trades.</p>
            <Link href="/import#your-team" className="mt-1 inline-flex min-h-11 items-center font-bold underline underline-offset-2">
              Pick your team
            </Link>
          </Callout>
        ) : choices && league ? (
          <AnalyzerForm
            choices={choices}
            draft={draft}
            summary={draftSummary(draft, league)}
            busy={busy}
            onChange={(d) => setEdited({ draft: d, query })}
            onEvaluate={() => evaluate(draft, false)}
          />
        ) : null}

        {failure ? (
          <div ref={failureRef}>
            <Callout tone="danger" role="alert" title="The trade couldn't be evaluated">
              {failure}
            </Callout>
          </div>
        ) : null}
        {resultView ? (
          <AnalysisResult
            view={resultView}
            stale={stale}
            sectionRef={sectionRef}
            headingRef={resultRef}
            records={records}
            leagueKey={leagueKey}
            snapshot={league}
            leagueType={league?.settings.leagueType}
            facts={facts}
            onFeedback={onFeedback}
            onOffers={stale ? undefined : onOffers}
          />
        ) : null}
      </div>

      {/* Checkpoint 7h: the what-if (WhatIfPanel.tsx), hidden, still mounted, while the trade shows. */}
      {whatIfReady && pair && myTeamId && settings && contextTag ? (
        <div hidden={mode !== "whatif"}>
          <WhatIfPanel
            leagueId={leagueId}
            snapshot={pair.snapshot}
            model={pair.inputs}
            myTeamId={myTeamId}
            settings={settings}
            query={query}
            contextTag={contextTag}
            lastNflWeek={lastNflWeek}
            blendOn={blendOn}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The trade being built: the partner, both sides' players, and Evaluate (pure layout; the page holds the draft). */
export function AnalyzerForm({
  choices,
  draft,
  summary,
  busy,
  onChange,
  onEvaluate,
}: {
  choices: AnalyzerChoices;
  draft: AnalyzerDraft;
  summary: string | null;
  busy: boolean;
  onChange: (draft: AnalyzerDraft) => void;
  onEvaluate: () => void;
}) {
  const partnerId = useId();
  const ready = draftProposal(draft) !== null;
  const partnerName = choices.partners.find((p) => p.id === draft.partnerId)?.name ?? null;
  const toggle = (side: "give" | "get", id: string, on: boolean) => {
    const list = draft[side].filter((x) => x !== id);
    if (on && list.length < ANALYZER_MAX_PER_SIDE) list.push(id);
    onChange({ ...draft, [side]: list });
  };
  return (
    <Card>
      <CardTitle eyebrow="Build a trade">Who and what</CardTitle>
      <label htmlFor={partnerId} className="text-sm font-bold">
        Trade with
      </label>
      <select
        id={partnerId}
        value={draft.partnerId ?? ""}
        onChange={(e) => onChange({ partnerId: e.target.value || null, give: draft.give, get: [] })}
        className={cx(inputClass, "mt-1 sm:max-w-md")}
      >
        <option value="">Choose a team…</option>
        {choices.partners.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <p className="mt-2 text-sm text-muted">{choices.limitText}</p>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <PlayerGroup legend="You give" players={choices.mine} onToggle={(id, on) => toggle("give", id, on)} empty="Your active roster is empty." />
        {draft.partnerId ? (
          <PlayerGroup legend={`You get from ${partnerName ?? "them"}`} players={choices.theirs} onToggle={(id, on) => toggle("get", id, on)} empty="Their active roster is empty." />
        ) : (
          <div>
            <p className="text-base font-extrabold tracking-tight">You get</p>
            <p className="mt-2 text-sm text-muted">Choose a team first to see its players.</p>
          </div>
        )}
      </div>
      <div className="mt-4 border-t border-line pt-4">
        {summary ? <p className="text-sm font-semibold break-words">{summary}</p> : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              if (ready && !busy) onEvaluate();
            }}
            aria-disabled={!ready || busy || undefined}
            className={cx(buttonClass("primary"), (!ready || busy) && "cursor-not-allowed opacity-60")}
          >
            {busy ? "Evaluating…" : "Evaluate trade"}
          </button>
          {draft.give.length || draft.get.length ? (
            <button type="button" onClick={() => onChange({ partnerId: draft.partnerId, give: [], get: [] })} className={buttonClass("secondary")}>
              Clear players
            </button>
          ) : null}
        </div>
        {!ready ? <p className="mt-2 text-sm text-muted">Choose a team and at least one player to evaluate a trade.</p> : null}
      </div>
    </Card>
  );
}

function PlayerGroup({ legend, players, onToggle, empty }: { legend: string; players: PlayerChoice[]; onToggle: (id: string, on: boolean) => void; empty: string }) {
  const full = players.some((p) => p.disabled);
  const noteId = useId();
  return (
    <fieldset aria-describedby={full ? noteId : undefined} className="min-w-0">
      <legend className="text-base font-extrabold tracking-tight break-words">{legend}</legend>
      {full ? (
        <p id={noteId} className="mt-1 text-sm text-muted">
          That&apos;s {ANALYZER_MAX_PER_SIDE} players, the most a side can have here. Uncheck one to pick another.
        </p>
      ) : null}
      {players.length ? (
        <div className="mt-2 grid gap-0.5">
          {players.map((p) => (
            <label
              key={p.id}
              className={cx("flex min-h-11 items-center gap-3 rounded-lg px-2 py-1", p.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-surface-muted")}
            >
              <input type="checkbox" checked={p.checked} disabled={p.disabled} onChange={(e) => onToggle(p.id, e.target.checked)} className="size-5 shrink-0 accent-brand" />
              <span className="min-w-0">
                <span className="font-semibold break-words">{p.name}</span>{" "}
                {p.injury ? (
                  <Badge tone={p.injury.tone} className="align-middle">
                    <span aria-hidden>{p.injury.short}</span>
                    <span className="sr-only">{p.injury.long}</span>
                  </Badge>
                ) : null}
                <span className="block text-xs text-muted">{p.detail}</span>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">{empty}</p>
      )}
    </fieldset>
  );
}

/**
 * The evaluation: my odds before the trade and what they count, what "Helps you" sums up, the trade card (with "Details",
 * the model's trade-value figures), or why it can't be made, and the notes; dimmed when it's for an older trade. Under a
 * card, "How to read the evaluation" (HowToRead.tsx: the three numbers, "Harder to get", "How to offer it" and why its
 * message can propose less than the trade built), never dimmed: the words don't go stale.
 */
export function AnalysisResult({
  view,
  stale,
  sectionRef,
  headingRef,
  records,
  leagueKey,
  snapshot,
  leagueType = "redraft",
  facts,
  onFeedback,
  onOffers,
}: {
  view: AnalysisView;
  stale: boolean;
  /** The section the page brings into view after an evaluation; its heading takes focus. */
  sectionRef?: Ref<HTMLElement> | undefined;
  headingRef?: Ref<HTMLHeadingElement> | undefined;
  records: FeedbackRecord[] | undefined;
  leagueKey: string;
  /** The league, to name a recorded version this card doesn't show (tradeView.ts cardFeedback's versionWords); absent: unnamed. */
  snapshot?: SnapshotPart | null | undefined;
  /** Says how Helps you weighs later seasons (HowToRead); default redraft. */
  leagueType?: LeagueSettings["leagueType"] | undefined;
  /**
   * What the league's data lets "How to read" say about values and the market blend (tradeView.ts valueFactsOf); absent or
   * null: the usual words. Long-term values also count as missing when the card says so (TradeEvaluation.dynMissing).
   */
  facts?: ValueFacts | null | undefined;
  /** Saves a feedback press; its promise says whether the browser kept it (the card says so). */
  onFeedback: (evaluation: NonNullable<AnalysisView["card"]>["evaluation"], change: FeedbackChange) => FeedbackSaveResult | Promise<FeedbackSaveResult>;
  /**
   * "How to offer it" (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1): works the card's offers out when its disclosure
   * is opened (the page's engine worker; TradeCard's `onOffers`). Absent: the card shows no "How to offer it".
   */
  onOffers?: ((card: TradeCardView) => Promise<LadderView>) | undefined;
}) {
  const card = view.card;
  return (
    <section ref={sectionRef} aria-labelledby="analysis-title" className="space-y-4">
      <h2 id="analysis-title" ref={headingRef} tabIndex={headingRef ? FOCUS_TARGET.tabIndex : undefined} className={cx("text-2xl font-extrabold tracking-tight", FOCUS_TARGET.className)}>
        The trade, evaluated
      </h2>
      {stale ? <Callout tone="warn">You&apos;ve changed the trade, your settings or the league data since. Evaluate it again to see the new numbers.</Callout> : null}
      <div className={cx("space-y-4 transition-opacity", stale && "opacity-60")}>
        {view.baseline || view.helpsInfo ? (
          <div>
            {view.baseline ? <p className="text-sm font-semibold">{view.baseline}</p> : null}
            {view.baselineNote ? <p className="mt-0.5 text-xs text-muted">{view.baselineNote}</p> : null}
            {view.helpsInfo ? <p className="mt-0.5 text-xs text-muted">{view.helpsInfo}</p> : null}
          </div>
        ) : null}
        {view.illegal ? (
          <Callout tone="warn" title="This trade can't be made">
            {view.illegal}
          </Callout>
        ) : card ? (
          // Keyed by the trade (the final review of Checkpoint 7e, UI-F-1): another trade evaluated is another card, so a
          // version question left open on the last one, its versions and its offers' answers never carry over to it.
          <TradeCard
            key={card.key}
            card={card}
            headingLevel="h3"
            showAnalyzerLink={false}
            feedback={cardFeedback(records, leagueKey, card.key, snapshot ?? undefined)}
            onFeedback={(change) => onFeedback(card.evaluation, change)}
            onOffers={onOffers}
          />
        ) : null}
        {view.notes.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            {view.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
      </div>
      {card ? (
        <HowToRead
          leagueType={leagueType}
          page="analyzer"
          valuesOn={facts?.valuesOn ?? true}
          longTermOn={(facts?.longTermOn ?? true) && !card.evaluation.dynMissing}
          blendOn={facts?.blendOn ?? true}
          helpsScale={view.helpsScale}
          reward={view.reward}
        />
      ) : null}
    </section>
  );
}
