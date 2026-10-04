"use client";
/**
 * The Trade Analyzer (CLAUDE.md §13 "Trade Analyzer", §14 item 5; Phase 4 wave 2 decision M13): the user builds any
 * trade with one team (a counteroffer included), and sees the same evaluation a trade idea gets
 * (src/engine/evaluate.ts analyzeTrade, in the engine's Web Worker: exact lineups and the full season simulation),
 * on the same card, or why the trade can't be made. It loads the league the way the League page does
 * (useLeagueInputs.ts) and sends the league's settings with every evaluation.
 *
 * Building: pick the partner, then my players to give and theirs to get, from the active rosters and IR (Phase 4b:
 * IR players are tradable, each choice saying "IR slot"; taxi players still aren't), up to config.search.analyzerMaxPerSide a side (a full side's other
 * boxes are disabled, and the page says why). The address can carry a trade (`?partner=&give=&get=`, a team id and
 * player ids only: the Trade Finder's "Open in Analyzer" links). It's read with useSearchParams, which on a client
 * navigation already holds the new address while the page renders (window.location still holds the old one until
 * the navigation commits), so the app route wraps the page in <Suspense> (src/app/analyzer/page.tsx). Anything that
 * isn't on those rosters is ignored, and a complete trade is evaluated straight away. Edits hold until the address
 * names another trade. Evaluate writes the trade back into the address (history.replaceState, which Next keeps in
 * step with useSearchParams), so a reload or a bookmark keeps it, and that write never counts as a new trade to
 * evaluate. The result stays editable: change anything and Evaluate again. A result for a trade that has since
 * changed, or for older league data or settings, stays on screen dimmed, saying so. Above the card, my odds before
 * this trade (the worker sends them with the evaluation), worded as the Trade Finder words them, so a trade's odds
 * read the same on both pages, end percents included (src/lib/tradeView.ts baselineLines; review of Phase 4). Under
 * the card, "How to read the evaluation" (HowToRead.tsx, as on the Trade Finder) says what the numbers, "Harder to
 * get" and "How to offer it" mean, and why the message can propose less than the trade built (review of the planner
 * addendum to Checkpoint 3).
 *
 * A trade opened from a Trade Finder card's "If they say no, try:" carries `from=planB` in its address (review of Phase
 * 4b): while the trade built is that one, it's evaluated as one offer, without "How to offer it" (the worker's `steps:
 * false`), so its first offer can't be smaller than the trade the other manager just turned down, and its message proposes
 * the trade itself; a note under the card says so. Change the trade and it's evaluated as usual (the address drops the
 * mark on Evaluate).
 *
 * Getting there and back (review of Phase 4): on a phone the result sits a few screens below the form. Evaluate brings
 * it into view (its section's top at the top of the screen when it's taller than the screen) and moves focus to its
 * heading; so does the address's trade (the Trade Finder's "Open in Analyzer") once it's evaluated, unless the user
 * has put focus somewhere on the page meanwhile (they're busy there), and a failure is brought into view the same
 * way. The status line sits above the form, so "Evaluating the trade…" shows near the top while the address's trade
 * is evaluated. "Back to the Trade Finder" goes to the Finder's last address, its partner filter included, where the
 * Finder shows the ideas it found again (src/components/trades/finderMemory.ts); the two pages share one engine
 * client, so the Analyzer reuses the evaluation context a search built.
 *
 * Accessibility: the partner is a labeled native select; each side's players are a fieldset of native checkboxes
 * (44 px rows; position, NFL team and injury in words); one status line (role="status") announces each evaluation.
 */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useId, useMemo, useRef, useState, type Ref } from "react";
import type { LeagueSettings, LeagueSnapshot } from "@/engine/model";
import type { TradeSettings } from "@/engine/settings";
import { EngineError } from "@/lib/engineClient";
import type { FeedbackChange, FeedbackRecord } from "@/lib/feedbackStore";
import type { SaveResult, StoredImport } from "@/lib/importStore";
import { modelKey, modelRequest } from "@/lib/modelStore";
import { settingsFingerprint } from "@/lib/settingsStore";
import {
  ANALYZER_MAX_PER_SIDE,
  EMPTY_DRAFT,
  analyzerChoices,
  analyzerHref,
  buildAnalysisView,
  cardFeedback,
  draftKey,
  draftProposal,
  draftSummary,
  readAnalyzerDraft,
  readAnalyzerFrom,
  type AnalysisView,
  type AnalyzerChoices,
  type AnalyzerDraft,
  type AnalyzerFrom,
  type PlayerChoice,
  type SnapshotPart,
} from "@/lib/tradeView";
import type { AnalyzerResult } from "@/workers/engine.worker";
import { NoImportCard } from "../NoImportCard";
import { leagueTag, useLeagueInputs, useStoredImport } from "../league/useLeagueInputs";
import { revealResult } from "../reveal";
import { saveTradeFeedback, useFeedbackRecords } from "../settings/useFeedback";
import { useLeagueSettings } from "../settings/useLeagueSettings";
import { Badge, Callout, Card, CardTitle, FOCUS_TARGET, Spinner, buttonClass, cx, inputClass } from "../ui";
import { finderAddress, tradeEngine } from "./finderMemory";
import { HowToRead } from "./HowToRead";
import { TradeCard } from "./TradeCard";
import { LeagueLoading } from "./LeagueLoading";

export const ANALYZER_TITLE = "Trade Analyzer";
export const NO_IMPORT_TEXT = "Connect your ESPN or Sleeper league to build and check your own trades. Imports stay in this browser tab only.";

const linkClass = "font-semibold text-brand-strong underline underline-offset-2 dark:text-brand";

export function AnalyzerPage() {
  const read = useStoredImport();
  if (read === undefined) return <LeagueLoading />;
  if (read.kind !== "ok") return <NoImportCard outdated={read.kind === "outdated"} text={NO_IMPORT_TEXT} />;
  const stored = read.stored;
  if (!modelRequest(stored)) {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <h1 className="text-2xl font-black tracking-tight">Not available for this league yet</h1>
        <p className="mt-2 text-muted">The Trade Analyzer works with ESPN and Sleeper leagues for now.</p>
      </Card>
    );
  }
  return <LoadedAnalyzer key={modelKey(stored.response.snapshot)} stored={stored} />;
}

/** What an evaluation is for besides the trade: the league data, the inputs' build, my team and every setting. */
function contextTagFor(snapshot: Pick<LeagueSnapshot, "platform" | "leagueId" | "season" | "fetchedAt">, builtAt: string, myTeamId: string, settings: TradeSettings): string {
  return `${leagueTag(snapshot)}|${builtAt}|${myTeamId}|${settingsFingerprint(settings)}`;
}

interface Evaluated {
  /** The trade (draftKey, with "|planB" when it was evaluated as a Plan B) and what it was evaluated against (contextTagFor). */
  draft: string;
  context: string;
  /** The evaluation, with my odds before any trade. */
  analysis: AnalyzerResult;
  /** "planB": opened from "If they say no, try:" and evaluated without "How to offer it" (the header). */
  from: AnalyzerFrom | null;
}

/** Focus is on nothing in particular (the page, or an element that's gone): the user isn't busy somewhere on the page. */
function focusIdle(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
}

function LoadedAnalyzer({ stored }: { stored: StoredImport }) {
  const snapshot = stored.response.snapshot;
  const { pair, myTeam, error: fetchError, retry: retryFetch } = useLeagueInputs(stored);
  const { settings, key: leagueKey } = useLeagueSettings(snapshot);
  const records = useFeedbackRecords();
  // The address's query (see the header: never window.location, which lags a client navigation). Null outside Next.
  const query = useSearchParams()?.toString() ?? "";
  // The trade as edited here, and the query it was edited under.
  const [edited, setEdited] = useState<{ draft: AnalyzerDraft; query: string } | null>(null);

  const myTeamId = myTeam?.myTeamId ?? null;
  const league = pair && myTeamId ? pair.snapshot : null;
  const prefill = useMemo(() => (league ? readAnalyzerDraft(query, league, myTeamId) : EMPTY_DRAFT), [league, query, myTeamId]);
  // An edit holds while the address is the one it was made under, or names the same trade (Evaluate's own write).
  const editHolds = edited !== null && (edited.query === query || draftKey(edited.draft) === draftKey(prefill));
  const draft = edited && editHolds ? edited.draft : prefill;
  // The address's trade opened from "If they say no, try:" (`?from=planB`): evaluated as one offer while it's the trade built (the header).
  const planBKey = league && readAnalyzerFrom(query) === "planB" && draftProposal(prefill) ? draftKey(prefill) : null;
  const fromOf = (d: AnalyzerDraft): AnalyzerFrom | null => (planBKey !== null && draftKey(d) === planBKey ? "planB" : null);
  const evalKey = (d: AnalyzerDraft): string => `${draftKey(d)}${fromOf(d) ? "|planB" : ""}`;
  const contextTag = pair && myTeamId && settings ? contextTagFor(pair.snapshot, pair.inputs.builtAt, myTeamId, settings) : null;
  // "Back to the Trade Finder": the Finder's last address in this tab, its partner filter included (finderMemory.ts).
  const [backHref] = useState(finderAddress);

  const latest = useRef(0);
  const [evaluated, setEvaluated] = useState<Evaluated | null>(null);
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
    tradeEngine()
      .analyzeTrade({ snapshot: pair.snapshot, model: pair.inputs, myTeamId, nowIso: new Date().toISOString(), settings, proposal, ...(from === "planB" ? { steps: false } : {}) })
      .then(
        (analysis) => {
          if (n !== latest.current) return;
          setWorking(null);
          setEvaluated({ draft: key, context, analysis, from });
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
  const resultView = useMemo(() => (evaluated && league ? buildAnalysisView(evaluated.analysis, league, lastNflWeek, { from: evaluated.from }) : null), [evaluated, league, lastNflWeek]);
  const stale = evaluated !== null && (evaluated.draft !== evalKey(draft) || evaluated.context !== contextTag);
  const busy = working !== null;

  const status = busy
    ? "Evaluating the trade…"
    : failure
      ? ""
      : resultView
        ? resultView.illegal
          ? `This trade can't be made: ${resultView.illegal}`
          : resultView.card
            ? `Evaluated: Helps you ${resultView.card.numbers.helps.value}, chance they accept ${resultView.card.numbers.accept.value}, Overall ${resultView.card.numbers.overall.value}.`
            : "Evaluated."
        : "";

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
          <Link href={backHref} className={cx(linkClass, "inline-flex min-h-11 items-center")}>
            Back to the Trade Finder
          </Link>
        </p>
      </header>

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
          onFeedback={(evaluation, change) => saveTradeFeedback({ leagueKey, evaluation, change })}
        />
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
 * The evaluation: my odds before the trade and what they count, the trade card, or why it can't be made, and the notes;
 * dimmed when it's for an older trade. Under a card, "How to read the evaluation" (HowToRead.tsx: the three numbers,
 * "Harder to get", "How to offer it" and why its message can propose less than the trade built), never dimmed: the
 * words don't go stale.
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
  onFeedback,
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
  onFeedback: (evaluation: NonNullable<AnalysisView["card"]>["evaluation"], change: FeedbackChange) => SaveResult;
}) {
  const card = view.card;
  return (
    <section ref={sectionRef} aria-labelledby="analysis-title" className="space-y-4">
      <h2 id="analysis-title" ref={headingRef} tabIndex={headingRef ? FOCUS_TARGET.tabIndex : undefined} className={cx("text-2xl font-extrabold tracking-tight", FOCUS_TARGET.className)}>
        The trade, evaluated
      </h2>
      {stale ? <Callout tone="warn">You&apos;ve changed the trade, your settings or the league data since. Evaluate it again to see the new numbers.</Callout> : null}
      <div className={cx("space-y-4 transition-opacity", stale && "opacity-60")}>
        {view.baseline ? (
          <div>
            <p className="text-sm font-semibold">{view.baseline}</p>
            {view.baselineNote ? <p className="mt-0.5 text-xs text-muted">{view.baselineNote}</p> : null}
          </div>
        ) : null}
        {view.illegal ? (
          <Callout tone="warn" title="This trade can't be made">
            {view.illegal}
          </Callout>
        ) : card ? (
          <TradeCard
            card={card}
            headingLevel="h3"
            showAnalyzerLink={false}
            feedback={cardFeedback(records, leagueKey, card.key, snapshot ?? undefined)}
            onFeedback={(change) => onFeedback(card.evaluation, change)}
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
      {card ? <HowToRead leagueType={leagueType} page="analyzer" /> : null}
    </section>
  );
}
