"use client";
/**
 * The Trade Analyzer's "What if" (Checkpoint 7h; planner reply to Checkpoint 7g, section 4: "Parker wants to compare any players
 * and see how his odds move. … Pick players to take off your roster and any players to put on it, from any team or from free
 * agency. There's no partner and no chance they accept. Roster rules apply as usual."), the Analyzer's second mode
 * (AnalyzerPage.tsx's switch, AnalyzerModeSwitch here). Laid out from src/lib/whatIfView.ts, mobile-first (375 px):
 * - The form: "Take off" (my active roster and IR as 44 px checkbox rows, IR players saying "IR slot"), then "Put on": the
 *   players picked so far, each with a 44 px Remove (focus moves to the next one's, else to the name box), and a searchable
 *   picker (where: "Every team and free agents", one team or "Free agents"; a position; a name), its matches grouped by team
 *   and "Free agents" as 44 px checkbox rows, at most whatIfView.ts WHAT_IF_RESULTS_MAX at once with how many matched, nothing
 *   until one of the three narrows it. At most WHAT_IF_MAX of each (an unchecked row is disabled then, and the group says why).
 *   Then the change in a sentence, "Evaluate change" and "Clear players".
 * - The result ("The change, evaluated", which takes focus when it comes, as the trade's does): my odds before the change and
 *   what they count, what Helps you sums up and its scale, the planner's line ("Other teams don't change. To see a real trade,
 *   use the Analyzer with a partner."), then the card: the players taken off and put on (each put on says where he's from;
 *   injury tags in words), "Helps you" (its scale's tooltip) and "Helps you here counts your odds only.", my odds before →
 *   after (title, top-N when the league pays 2nd or 3rd place, playoffs; each kept on one line, the arrow said "from … to"), the
 *   weeks whose win chance moves, my lineup's change, the ROS points put on and taken off, and the roster moves the numbers
 *   assume (`data-roster-moves="whatif"`); the notes after. No chance they accept, no Overall, no offers, no Plan B, no feedback
 *   buttons. A result for an older change, older league data or settings stays dimmed, saying so.
 * - The address: Evaluate writes the change into it (`?mode=whatif&remove=…&add=…`, player ids only: whatIfView.ts whatIfHref,
 *   history.replaceState), so a reload keeps it and a complete what-if in the address is evaluated when the page opens. Never
 *   prefetched (no link carries one).
 * The engine works it out in this league's engine worker (engineClient.ts whatIf; the context its searches and evaluations
 * use, so a what-if after a search costs one run).
 */
import { useEffect, useEffectEvent, useId, useMemo, useRef, useState, type Ref } from "react";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueSnapshot } from "@/engine/model";
import type { TradeSettings } from "@/engine/settings";
import { EngineError } from "@/lib/engineClient";
import type { AssetView, OddsView, PlayerChoice, WeeklyLineView } from "@/lib/tradeView";
import {
  ANALYZER_MODES,
  DEFAULT_WHAT_IF_FILTER,
  WHAT_IF_MAX,
  buildWhatIfView,
  readAnalyzerMode,
  readWhatIfDraft,
  whatIfChoices,
  whatIfDraftKey,
  whatIfHref,
  whatIfProposalOf,
  whatIfStatus,
  whatIfSummary,
  type AnalyzerMode,
  type PutOnView,
  type WhatIfCardView,
  type WhatIfChoices,
  type WhatIfDraft,
  type WhatIfFilter,
  type WhatIfView,
} from "@/lib/whatIfView";
import type { WhatIfResult } from "@/workers/engine.worker";
import { revealResult } from "../reveal";
import { Badge, Callout, Card, CardTitle, FOCUS_TARGET, Spinner, buttonClass, cx, inputClass } from "../ui";
import { tradeEngine } from "./finderMemory";

/** The dot between the items of a line, after a no-break space (TradeCard.tsx's SEP: a line never starts with one). */
const SEP = `${String.fromCharCode(0xa0)}· `;

/** An injury tag's tint by its tone (the words say it all; the tint only helps scanning: TradeCard.tsx's). */
const TAG_CLASS: Record<NonNullable<AssetView["status"]>["tone"], string> = {
  muted: "bg-surface-muted text-muted",
  warn: "bg-warn-bg text-warn-fg",
  danger: "bg-danger-bg text-danger-fg",
};

/**
 * The Analyzer's two modes (Checkpoint 7h): "Trade with a team" and "What if", a group of two 44 px toggle buttons (aria-pressed),
 * named for screen readers. The page holds the mode.
 */
export function AnalyzerModeSwitch({ mode, onChange }: { mode: AnalyzerMode; onChange: (mode: AnalyzerMode) => void }) {
  return (
    <div role="group" aria-label="What to evaluate" className="inline-flex max-w-full flex-wrap rounded-xl border border-line bg-surface-muted p-1">
      {ANALYZER_MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          aria-pressed={mode === m.value}
          onClick={() => onChange(m.value)}
          className={cx("min-h-11 rounded-lg px-3 text-sm font-bold", mode === m.value ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground")}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** Focus is on nothing in particular (the page, or an element that's gone): the user isn't busy somewhere on the page. */
function focusIdle(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
}

/**
 * The what-if mode (the file header): its form, its status line and its result. `query` is the address's query while it's this
 * league's (AnalyzerPage.tsx: useLeagueQuery); `contextTag` what an evaluation is for besides the change (the league data, the
 * inputs' build, my team and the trade settings: AnalyzerPage.tsx contextTagFor), so a result for another reads as stale.
 */
export function WhatIfPanel({
  leagueId,
  snapshot,
  model,
  myTeamId,
  settings,
  query,
  contextTag,
  lastNflWeek,
  blendOn,
}: {
  leagueId: string;
  snapshot: LeagueSnapshot;
  model: ModelInputs;
  myTeamId: string;
  settings: TradeSettings;
  query: string;
  contextTag: string;
  lastNflWeek?: number | undefined;
  blendOn?: boolean | undefined;
}) {
  const prefill = useMemo(() => readWhatIfDraft(query, snapshot, myTeamId), [query, snapshot, myTeamId]);
  // An edit holds while the address is the one it was made under, or names the same change (Evaluate's own write), or names no
  // what-if (the trade mode's evaluation wrote it: the change being built waits for its mode).
  const [edited, setEdited] = useState<{ draft: WhatIfDraft; query: string } | null>(null);
  const editHolds = edited !== null && (edited.query === query || whatIfDraftKey(edited.draft) === whatIfDraftKey(prefill) || readAnalyzerMode(query) !== "whatif");
  const draft = edited && editHolds ? edited.draft : prefill;
  const [filter, setFilter] = useState<WhatIfFilter>(DEFAULT_WHAT_IF_FILTER);
  const choices = useMemo(() => whatIfChoices(snapshot, myTeamId, draft, filter), [snapshot, myTeamId, draft, filter]);

  const latest = useRef(0);
  const [evaluated, setEvaluated] = useState<{ draft: string; context: string; result: WhatIfResult } | null>(null);
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const [reveal, setReveal] = useState<{ n: number; to: "result" | "failure" } | null>(null);
  useEffect(() => {
    if (!reveal) return;
    if (reveal.to === "result") revealResult(sectionRef.current, headingRef.current);
    else revealResult(failureRef.current);
  }, [reveal]);

  /** Evaluates a change (Evaluate, or the address's on opening: auto); only the latest one's answer counts. */
  function evaluate(d: WhatIfDraft, auto: boolean) {
    const proposal = whatIfProposalOf(d);
    if (!proposal) return;
    const n = ++latest.current;
    const key = whatIfDraftKey(d);
    const context = contextTag;
    const show = (to: "result" | "failure") => {
      if (!auto || focusIdle()) setReveal((r) => ({ n: (r?.n ?? 0) + 1, to }));
    };
    setWorking(true);
    setFailure(null);
    try {
      window.history.replaceState(null, "", whatIfHref(d));
    } catch {
      // the address just doesn't keep the change
    }
    tradeEngine(leagueId)
      .whatIf({ snapshot, model, myTeamId, nowIso: new Date().toISOString(), settings, proposal })
      .then(
        (result) => {
          if (n !== latest.current) return;
          setWorking(false);
          setEvaluated({ draft: key, context, result });
          show("result");
        },
        (err: unknown) => {
          if (n !== latest.current || (err instanceof EngineError && err.cancelled)) return;
          if (err instanceof EngineError && err.detail) console.error("Trade Analyzer (what if):", err.detail);
          setWorking(false);
          setFailure(err instanceof Error ? err.message : "Something went wrong while crunching the numbers.");
          show("failure");
        },
      );
  }

  // The address's what-if, evaluated once when it isn't being edited (a tick later: StrictMode's first run is cancelled).
  const autoKey = !editHolds && whatIfProposalOf(prefill) ? whatIfDraftKey(prefill) : null;
  const startAuto = useEffectEvent(() => {
    const d = prefill;
    const timer = setTimeout(() => evaluate(d, true), 0);
    return () => clearTimeout(timer);
  });
  useEffect(() => {
    if (!autoKey) return;
    return startAuto();
  }, [autoKey]);

  const view = useMemo(() => (evaluated ? buildWhatIfView(evaluated.result, snapshot, { lastNflWeek, blendOn }) : null), [evaluated, snapshot, lastNflWeek, blendOn]);
  const stale = evaluated !== null && (evaluated.draft !== whatIfDraftKey(draft) || evaluated.context !== contextTag);
  const status = working ? "Evaluating the change…" : failure ? "" : view ? whatIfStatus(view) : "";

  return (
    <div className="space-y-6">
      {/* Always mounted, so each evaluation is announced; above the form, as the trade's. */}
      <p role="status" className={working ? "flex items-center gap-3 text-sm font-semibold text-muted" : "sr-only"}>
        {working ? <Spinner /> : null}
        {working ? " " : null}
        {status}
      </p>
      <WhatIfForm
        choices={choices}
        draft={draft}
        filter={filter}
        summary={whatIfSummary(draft, snapshot)}
        busy={working}
        onChange={(d) => setEdited({ draft: d, query })}
        onFilter={setFilter}
        onEvaluate={() => evaluate(draft, false)}
      />
      {failure ? (
        <div ref={failureRef}>
          <Callout tone="danger" role="alert" title="The change couldn't be evaluated">
            {failure}
          </Callout>
        </div>
      ) : null}
      {view ? <WhatIfResultView view={view} stale={stale} sectionRef={sectionRef} headingRef={headingRef} /> : null}
    </div>
  );
}

/** A group of 44 px checkbox rows (my players to take off, a team's or the free agents' players to put on). */
function CheckRows({ players, onToggle }: { players: PlayerChoice[]; onToggle: (id: string, on: boolean) => void }) {
  return (
    <div className="mt-2 grid gap-0.5">
      {players.map((p) => (
        <label key={p.id} className={cx("flex min-h-11 items-center gap-3 rounded-lg px-2 py-1", p.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-surface-muted")}>
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
  );
}

/** "That's 4 players, the most here. …" when a side is full. */
const fullText = (verb: string) => `That's ${WHAT_IF_MAX} ${WHAT_IF_MAX === 1 ? "player" : "players"}, the most you can ${verb} here. Uncheck one to pick another.`;

/** The players picked to put on, each with a 44 px Remove; a removal hands focus to the next one's Remove, else to `fallback`. */
function PickedList({ picked, onRemove, fallback }: { picked: PutOnView[]; onRemove: (id: string) => void; fallback: () => void }) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  // The place of the Remove just pressed: after the list renders without him, focus goes to the one now there (else the last
  // one, else `fallback`), so it never falls to the page.
  const focusNext = useRef<number | null>(null);
  useEffect(() => {
    const at = focusNext.current;
    if (at === null) return;
    focusNext.current = null;
    const next = picked[Math.min(at, picked.length - 1)];
    const button = next ? buttons.current.get(next.id) : undefined;
    if (button) button.focus();
    else fallback();
  });
  if (!picked.length) return <p className="mt-1 text-sm text-muted">Nobody yet: pick players below.</p>;
  return (
    <ul className="mt-1 space-y-1">
      {picked.map((p, i) => (
        <li key={p.id} className="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-surface-muted px-2 py-1">
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
          <button
            type="button"
            ref={(el) => {
              if (el) buttons.current.set(p.id, el);
              else buttons.current.delete(p.id);
            }}
            onClick={() => {
              focusNext.current = i;
              onRemove(p.id);
            }}
            className={cx(buttonClass("secondary", "sm"), "min-h-11 shrink-0")}
          >
            Remove<span className="sr-only"> {p.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The what-if being built: the players to take off, the players to put on with the picker, and Evaluate (pure layout; the panel holds the draft). */
export function WhatIfForm({
  choices,
  draft,
  filter,
  summary,
  busy,
  onChange,
  onFilter,
  onEvaluate,
}: {
  choices: WhatIfChoices;
  draft: WhatIfDraft;
  filter: WhatIfFilter;
  summary: string | null;
  busy: boolean;
  onChange: (draft: WhatIfDraft) => void;
  onFilter: (filter: WhatIfFilter) => void;
  onEvaluate: () => void;
}) {
  const fromId = useId();
  const posId = useId();
  const nameId = useId();
  const takeNoteId = useId();
  const putNoteId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const evaluateRef = useRef<HTMLButtonElement>(null);
  const ready = whatIfProposalOf(draft) !== null;
  const toggle = (side: "remove" | "add", id: string, on: boolean) => {
    const list = draft[side].filter((x) => x !== id);
    if (on && list.length < WHAT_IF_MAX) list.push(id);
    onChange({ ...draft, [side]: list });
  };
  const takeFull = draft.remove.length >= WHAT_IF_MAX;
  const putFull = draft.add.length >= WHAT_IF_MAX;
  return (
    <Card>
      <CardTitle eyebrow="What if">Change your roster</CardTitle>
      <p className="-mt-1 text-sm text-muted">Take players off your roster and put others on, from any team or from free agents, to see how your odds move.</p>
      <p className="mt-2 text-sm text-muted">{choices.limitText}</p>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <fieldset aria-describedby={takeFull ? takeNoteId : undefined} className="min-w-0">
          <legend className="text-base font-extrabold tracking-tight">Take off</legend>
          {takeFull ? (
            <p id={takeNoteId} className="mt-1 text-sm text-muted">
              {fullText("take off")}
            </p>
          ) : null}
          {choices.mine.length ? <CheckRows players={choices.mine} onToggle={(id, on) => toggle("remove", id, on)} /> : <p className="mt-2 text-sm text-muted">Your active roster is empty.</p>}
        </fieldset>
        <fieldset aria-describedby={putFull ? putNoteId : undefined} className="min-w-0">
          <legend className="text-base font-extrabold tracking-tight">Put on</legend>
          {putFull ? (
            <p id={putNoteId} className="mt-1 text-sm text-muted">
              {fullText("put on")}
            </p>
          ) : null}
          <PickedList picked={choices.picked} onRemove={(id) => toggle("add", id, false)} fallback={() => nameRef.current?.focus()} />
          <div className="mt-3 grid gap-3">
            <div>
              <label htmlFor={fromId} className="text-sm font-bold">
                From
              </label>
              <select id={fromId} value={filter.from} onChange={(e) => onFilter({ ...filter, from: e.target.value })} className={cx(inputClass, "mt-1")}>
                {choices.sources.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={posId} className="text-sm font-bold">
                Position
              </label>
              <select id={posId} value={filter.pos} onChange={(e) => onFilter({ ...filter, pos: e.target.value })} className={cx(inputClass, "mt-1")}>
                {choices.positions.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={nameId} className="text-sm font-bold">
                Name
              </label>
              <input
                id={nameId}
                ref={nameRef}
                type="search"
                autoComplete="off"
                value={filter.query}
                onChange={(e) => onFilter({ ...filter, query: e.target.value })}
                placeholder="Search players"
                className={cx(inputClass, "mt-1")}
              />
            </div>
          </div>
          {/* The matches, announced politely as the filter narrows them (their count, or why none show). */}
          <p aria-live="polite" className="mt-2 text-sm text-muted">
            {choices.prompt ?? choices.none ?? choices.more ?? ""}
          </p>
          {choices.groups.map((g) => (
            <div key={g.id} role="group" aria-label={g.name} className="mt-2">
              <p className="text-xs font-bold tracking-wider text-muted uppercase">{g.name}</p>
              <CheckRows players={g.players} onToggle={(id, on) => toggle("add", id, on)} />
            </div>
          ))}
        </fieldset>
      </div>
      <div className="mt-4 border-t border-line pt-4">
        {summary ? <p className="text-sm font-semibold break-words">{summary}</p> : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            ref={evaluateRef}
            type="button"
            onClick={() => {
              if (ready && !busy) onEvaluate();
            }}
            aria-disabled={!ready || busy || undefined}
            className={cx(buttonClass("primary"), (!ready || busy) && "cursor-not-allowed opacity-60")}
          >
            {busy ? "Evaluating…" : "Evaluate change"}
          </button>
          {draft.remove.length || draft.add.length ? (
            <button
              type="button"
              onClick={() => {
                onChange({ remove: [], add: [] });
                // The button goes with the players: focus stays on the form's own button rather than falling to the page.
                evaluateRef.current?.focus();
              }}
              className={buttonClass("secondary")}
            >
              Clear players
            </button>
          ) : null}
        </div>
        {!ready ? <p className="mt-2 text-sm text-muted">Pick at least one player to take off or put on.</p> : null}
      </div>
    </Card>
  );
}

/** "You take off" / "You put on": each player with position, NFL team, where he's from and his injury tag in words. */
function PlayerList({ title, assets }: { title: string; assets: AssetView[] }) {
  return (
    <div className="min-w-0">
      <h4 className="text-xs font-bold tracking-wider text-muted uppercase">{title}</h4>
      {assets.length ? (
        <ul className="mt-1 space-y-1">
          {assets.map((a) => (
            <li key={a.id} className="min-w-0">
              <span className="font-extrabold break-words">{a.name}</span>
              {a.detail ? <span className="block text-xs text-muted">{a.detail}</span> : null}
              {a.status ? <span className={cx("mt-0.5 inline-block rounded-md px-1.5 py-0.5 text-xs font-bold break-words", TAG_CLASS[a.status.tone])}>{a.status.text}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted">Nobody</p>
      )}
    </div>
  );
}

/** One odds on a line, kept on one line, the arrow said "from … to" to screen readers (TradeCard.tsx's OddsItem). */
function OddsItem({ odds, first }: { odds: OddsView; first: boolean }) {
  return (
    <>
      {first ? null : <span aria-hidden>{SEP}</span>}
      {first ? null : <span className="sr-only">, </span>}
      <span className="whitespace-nowrap">
        <span className="font-semibold">{odds.label}</span>{" "}
        {odds.srValue === odds.value ? (
          <span className="tabular-nums">{odds.value}</span>
        ) : (
          <>
            <span aria-hidden className="tabular-nums">
              {odds.value}
            </span>
            <span className="sr-only">{odds.srValue}</span>
          </>
        )}
      </span>
    </>
  );
}

/** My odds before → after, and the weeks whose win chance moves (each week kept whole). */
function OddsLines({ odds, weekly }: { odds: OddsView[]; weekly: WeeklyLineView | null }) {
  return (
    <div className="mt-2 space-y-0.5 text-sm">
      {odds.length ? (
        <p>
          {odds.map((o, i) => (
            <OddsItem key={o.label} odds={o} first={i === 0} />
          ))}
        </p>
      ) : null}
      {weekly ? (
        <p className="text-muted">
          <span className="font-semibold">{weekly.label}:</span>{" "}
          {weekly.weeks.map((w, i) => (
            <span key={w.week}>
              {i > 0 ? <span aria-hidden>{SEP}</span> : null}
              {i > 0 ? <span className="sr-only">, </span> : null}
              <span aria-hidden className="whitespace-nowrap tabular-nums">
                {w.text}
              </span>
              <span className="sr-only">{w.srText}</span>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/** A what-if's card (the file header): an <article> named by its heading. */
export function WhatIfCard({ card }: { card: WhatIfCardView }) {
  const headingId = useId();
  const n = card.helps;
  return (
    <article aria-labelledby={headingId} className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
      <h3 id={headingId} className="text-lg leading-tight font-extrabold tracking-tight">
        Your roster with this change
      </h3>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <PlayerList title="You take off" assets={card.remove} />
        <PlayerList title="You put on" assets={card.add} />
      </div>
      {card.injuryNote ? <p className="mt-2 text-xs leading-relaxed break-words text-muted">{card.injuryNote}</p> : null}
      <dl className="mt-4 grid grid-cols-1">
        <div title={n.title} className="flex min-w-0 flex-col-reverse justify-end rounded-xl bg-surface-muted px-1.5 py-2 text-center">
          <dt className="mt-0.5 text-xs leading-tight font-semibold text-muted">Helps you</dt>
          <dd>
            <span className="block text-2xl font-black tracking-tight tabular-nums" aria-hidden={n.srText ? true : undefined}>
              {n.value}
            </span>
            {n.srText ? <span className="sr-only">{n.srText}</span> : null}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-sm text-muted">{card.helpsNote}</p>
      <OddsLines odds={card.odds} weekly={card.weekly} />
      <p className="mt-3 text-sm font-bold">{card.ros}</p>
      {card.rosNote ? <p className="mt-0.5 text-xs leading-relaxed break-words text-muted">{card.rosNote}</p> : null}
      <dl className="mt-2 divide-y divide-line text-sm">
        <div className="grid gap-0.5 py-1.5 sm:grid-cols-[minmax(0,10rem)_1fr] sm:gap-3">
          <dt className="font-semibold text-muted">Your lineup</dt>
          <dd className="min-w-0 break-words">{card.lineup}</dd>
        </div>
      </dl>
      {card.moves.length ? (
        <div className="mt-3 rounded-xl bg-surface-muted px-3 py-2 text-sm">
          <p className="font-bold">{card.movesHeading}</p>
          <ul data-roster-moves="whatif" className="mt-1 list-disc space-y-0.5 pl-5">
            {card.moves.map((r) => (
              <li key={r} className="break-words">
                {r}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

/**
 * The what-if's result (the file header): my odds before the change and what they count, what Helps you sums up, the planner's
 * line about other teams, the card, or why the change can't be made, and the notes; dimmed when it's for an older change.
 */
export function WhatIfResultView({ view, stale, sectionRef, headingRef }: { view: WhatIfView; stale: boolean; sectionRef?: Ref<HTMLElement> | undefined; headingRef?: Ref<HTMLHeadingElement> | undefined }) {
  return (
    <section ref={sectionRef} aria-labelledby="whatif-title" className="space-y-4">
      <h2 id="whatif-title" ref={headingRef} tabIndex={headingRef ? FOCUS_TARGET.tabIndex : undefined} className={cx("text-2xl font-extrabold tracking-tight", FOCUS_TARGET.className)}>
        The change, evaluated
      </h2>
      {stale ? <Callout tone="warn">You&apos;ve changed the players, your settings or the league data since. Evaluate it again to see the new numbers.</Callout> : null}
      <div className={cx("space-y-4 transition-opacity", stale && "opacity-60")}>
        {view.baseline || view.helpsInfo ? (
          <div>
            {view.baseline ? <p className="text-sm font-semibold">{view.baseline}</p> : null}
            {view.baselineNote ? <p className="mt-0.5 text-xs text-muted">{view.baselineNote}</p> : null}
            {view.helpsInfo ? <p className="mt-0.5 text-xs text-muted">{view.helpsInfo}</p> : null}
          </div>
        ) : null}
        {view.otherTeams ? <p className="text-sm font-semibold">{view.otherTeams}</p> : null}
        {view.illegal ? (
          <Callout tone="warn" title="This change can't be made">
            {view.illegal}
          </Callout>
        ) : view.card ? (
          <WhatIfCard key={view.card.key} card={view.card} />
        ) : null}
        {view.notes.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            {view.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
