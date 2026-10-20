"use client";
/**
 * One trade idea (CLAUDE.md §13 "Each trade card shows"; §10's three numbers; §11's "Est." and labels; Phase 4 wave 2
 * decision M13), laid out from its view model (src/lib/tradeView.ts buildTradeCard), mobile-first (375 px).
 *
 * Checkpoint 7h (planner reply to Checkpoint 7g, §1: "Cards are closed by default. A closed card shows only: what Parker gives
 * and what he gets; the three numbers; its tags ("Helps both," "Harder to get"); one reason. Everything else goes behind one
 * "Details" control … "How to offer it" stays a separate control."; the lead's rulings for track "clutter", items 1–3 and 6):
 * - Closed: "Trade idea N", the heading and its "Helps both" tag, on one row that wraps when they don't fit (the first
 *   review's item 3); You give / You get, each player with position, NFL team, an injury tag in words and "Harder to get";
 *   the three numbers (the veto note right under them when it shows); its risk flags
 *   as small pills in words (FlagView.pill: "Market check", "Injured player"; ⚠️ ours, their sentences behind Details); one
 *   reason, the first of the card's reasons; then two 44 px disclosure buttons side by side, Details and How to offer it
 *   (aria-expanded, aria-controls naming its panel; the panels below them, full width, each kept in the page while closed
 *   with the hidden attribute, so focus stays on the button pressed and a reader of the page finds the card's words either way).
 * - Details, in this order: my odds lines and the partner's line when it shows (in the format of mine, the planner's tooltip on
 *   "Helps them"; Checkpoint 7c/7d), the odds note, the weekly line, the timing line ("Helps you 37 now · 41 if done after this
 *   week's games." with its words right under it, which a phone can't hover for), the injury note and the risk sentences, "You
 *   get 142 ROS pts, give 118" and its note, the facts, the sentence with the "Values: FantasyCalc" link (§2.9; no trade value
 *   is ever shown), the Analyzer's "How Helps you adds up" (what Helps you is worth in points a week; its "Details" disclosure
 *   until Checkpoint 7h), the roster moves its numbers assume (without the line of moves made either way the Trade Finder says
 *   once above its list: tradeView.ts CardContext.assumedLine), the other reasons ("More reasons"), the card's own message when
 *   it has no "How to offer it" (⚠️ ours), "Open in Analyzer" and the feedback buttons (⚠️ ours, the planner's "everything
 *   else"). Closed on a Trade Finder card, open on the Trade Analyzer's (one card): `detailsOpen`, by default open without a
 *   `rank`.
 * - How to offer it: the offers in order, the first offer's "Message to send them" open and the others closed (the planner: "the
 *   first offer's message shows open, and the others stay behind their own steps"); the card's own message, open, when its
 *   offers don't list it (the trade alone, or they couldn't be worked out; ⚠️ ours); then the Plan B box ("If they won't move:
 *   try …", ⚠️ ours: inside How to offer it, after the offers it has always followed), its message closed. A closed card shows no
 *   message, and the note over the card's own message (the review of wave D, UI-D-6) goes with it.
 *
 * "How to offer it" (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1: "one ordered list of up to 4 offers to the same
 * team"): its offers are worked out by the page's engine worker the first time it's opened (`onOffers`: "Working out the
 * offers…" in a status line that stays mounted, then "Offer them in order: if they say no, try the next.", or "Offer this
 * trade as it is: …" when nothing beats it; a failure says so with a 44 px Try again): a numbered list, each offer with its
 * label ("Open with", "Then", "The suggested trade", "Last offer"), its players, Helps you and the chance they accept, its
 * roster moves when they aren't the card's, and its own "Message to send them" with Copy. An offer that is another card the
 * Trade Finder shows says so under its players, Plan B's words with that card's place in the sort shown ("Also shown as trade
 * idea 2."; the lead's call, wave D: the page's `places`; none in the Analyzer). Once they're in, they're the versions the
 * feedback asks about. The review of wave D: its open state is the card's (`useOffers`), and its offers are asked for only while
 * it's open (UI-D-10), or when the feedback needs them: a first outcome pressed on a card whose offers haven't loaded asks for
 * them first, then which version was sent among them (UI-D-1); Try again hands focus to the status line that replaces it
 * (UI-D-7). The final review of Checkpoint 7e: offers already in stay, and stay the versions the feedback asks about, when the
 * page stops giving a loader (the Trade Analyzer's result gone stale: UI-F-2); the panel then shows only offers that are in.
 *
 * Planner reply to Checkpoint 4, change 6: every injury-tagged player on either side carries his tag in words under his name
 * ("Out — expected back week 8"; a tinted tag that wraps, so a long one never widens the card past a 375 px screen); what a
 * hurt player's projection assumes is said in Details (the injury note, or the "Depends on an injured player" flag). A Plan B
 * box: the other trade (each tagged player with his tag in words after his name), which kind it is, its three numbers in words
 * (each kept on one line, the estimate's label apart), its own odds and weekly line, "Also shown as trade idea 6." when the list
 * has it as a card of its own, its roster moves, its own "Message to send them" with Copy, and its own "Open in Analyzer".
 * Checkpoint 7e (planner reply to Checkpoint 7d, item 2.1; review of wave B, finding B-4): a card or Plan B box whose odds start
 * from its own "before" says so in a small line under them (TradeCardView.oddsNote, PlanBView.oddsNote).
 * Each list of roster moves (the card's, its Plan B box's, each offer's) carries `data-roster-moves` ("card", "plan-b",
 * "offer"), so `npm run check:browser` reads its lines alone (review of Checkpoint 7f, PIERCE-1).
 * "Open in Analyzer" carries the trade's ids in its address, so it's never prefetched: the server sees that address only when
 * the user opens it (the privacy page says so); using it tells the Finder which idea to bring back into view (onOpenAnalyzer).
 * The feedback buttons (FeedbackControls) wait for the browser to keep a press, and every press carries what the card prints
 * (tradeView.ts cardPress, TradeCardView.shown), which the record keeps for the export (Checkpoint 7d).
 * It's an <article> named by its heading; the heading level is the page's to choose.
 */
import Link from "next/link";
import { Fragment, useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { TradeEvaluation } from "@/engine/tradeModel";
import type { FeedbackSaveResult } from "@/lib/feedbackShare";
import type { FeedbackChange } from "@/lib/feedbackStore";
import {
  DETAILS_HEADING,
  MORE_REASONS_HEADING,
  OFFERS_FAILED_TEXT,
  OFFERS_HEADING,
  OFFERS_LOADING_TEXT,
  ROSTER_MOVES_HEADING,
  cardPress,
  cardVersions,
  planBAlsoText,
  type AssetView,
  type CardFeedback,
  type DetailsView,
  type HelpsBothTagView,
  type InjuryTone,
  type LadderView,
  type NowOrLaterView,
  type NumberView,
  type OddsView,
  type OfferStepView,
  type PlanBView,
  type ThemView,
  type TradeCardView,
  type VersionChoice,
  type WeeklyLineView,
} from "@/lib/tradeView";
import { CopyButton } from "../CopyButton";
import { HarderToGetBadge } from "../league/HarderToGetBadge";
import { ValuesCredit } from "../league/ValuesCredit";
import { revealResult } from "../reveal";
import { Badge, Callout, FOCUS_TARGET, Spinner, buttonClass, cx } from "../ui";
import { FeedbackControls } from "./FeedbackControls";

/**
 * The dot between the items of a line ("Title odds … · Playoff odds …", "Week 9: … · Week 13: …", a step's estimate, Plan
 * B's three numbers): a no-break space before it, so a line breaks only after the dot and never starts with one (final
 * review of Phase 4c, finding PAGES-7: a Plan B box's weekly line wrapped to "· Week 13: 43% → 53%").
 */
const SEP = `${String.fromCharCode(0xa0)}· `;

/** An injury tag's tint by its tone (the words say it all; the tint only helps scanning). */
const TAG_CLASS: Record<InjuryTone, string> = {
  muted: "bg-surface-muted text-muted",
  warn: "bg-warn-bg text-warn-fg",
  danger: "bg-danger-bg text-danger-fg",
};

function AssetList({ title, assets }: { title: string; assets: AssetView[] }) {
  return (
    <div className="min-w-0">
      <h4 className="text-xs font-bold tracking-wider text-muted uppercase">{title}</h4>
      {assets.length ? (
        <ul className="mt-0.5 space-y-0.5">
          {assets.map((a) => (
            <li key={a.id} className="min-w-0 text-sm leading-snug">
              <span className="font-extrabold break-words">{a.name}</span>
              {a.tag ? (
                <>
                  {" "}
                  <HarderToGetBadge tag={a.tag} describe />
                </>
              ) : null}
              {a.detail ? <span className="block text-xs text-muted">{a.detail}</span> : null}
              {a.status ? <span className={cx("mt-0.5 inline-block rounded-md px-1.5 py-0.5 text-xs font-bold break-words", TAG_CLASS[a.status.tone])}>{a.status.text}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-0.5 text-sm text-muted">Nothing</p>
      )}
    </div>
  );
}

/** One of the three numbers; its tooltip (NumberView.title: Helps you's scale) on the whole tile. */
function Score({ label, number, sub }: { label: string; number: NumberView; sub?: string | undefined }) {
  return (
    <div title={number.title} className="flex min-w-0 flex-col-reverse justify-end rounded-xl bg-surface-muted px-1.5 py-1.5 text-center">
      <dt className="text-xs leading-tight font-semibold text-muted">{label}</dt>
      <dd>
        <span className="block text-2xl leading-tight font-black tracking-tight tabular-nums" aria-hidden={number.srText ? true : undefined}>
          {number.value}
        </span>
        {number.srText ? <span className="sr-only">{number.srText}</span> : null}
        {sub ? <span className="block text-xs leading-tight font-semibold text-muted">{sub}</span> : null}
      </dd>
    </div>
  );
}

/** One odds on a line, kept on one line, the arrow said as "from … to" to screen readers; after the line's separator when it isn't first. */
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

/**
 * My odds before and after the trade (each odds kept on one line: it wraps between them on a 320 px phone, the arrow said as
 * "from … to" to screen readers); then (Checkpoint 7c) the partner's line, "Helps them 24" with the planner's tooltip, then their
 * odds as mine; then the note on whose "before" they start from (Checkpoint 7e); then the weeks whose win chance moves, each kept
 * whole (Checkpoint 7h's order: "the odds lines (and the partner's line when it shows), the odds note, the weekly line").
 */
function OddsLines({ odds, weekly, them = null, note = null }: { odds: OddsView[]; weekly: WeeklyLineView | null; them?: ThemView | null; note?: string | null }) {
  return (
    <div className="space-y-0.5 text-sm">
      {odds.length ? (
        <p>
          {odds.map((o, i) => (
            <OddsItem key={o.label} odds={o} first={i === 0} />
          ))}
        </p>
      ) : null}
      {them ? (
        <p>
          <span className="whitespace-nowrap" title={them.helps.title}>
            <span className="font-semibold">{them.label}</span> <span className="tabular-nums">{them.helps.value}</span>
          </span>
          {them.odds.map((o) => (
            <OddsItem key={o.label} odds={o} first={false} />
          ))}
        </p>
      ) : null}
      {note ? <p className="text-xs leading-relaxed break-words text-muted">{note}</p> : null}
      {weekly ? (
        <p className="text-muted">
          <span className="font-semibold">{weekly.label}:</span>{" "}
          {weekly.weeks.map((w, i) => (
            <Fragment key={w.week}>
              {i > 0 ? <span aria-hidden>{SEP}</span> : null}
              {i > 0 ? <span className="sr-only">, </span> : null}
              <span aria-hidden className="whitespace-nowrap tabular-nums">
                {w.text}
              </span>
              <span className="sr-only">{w.srText}</span>
            </Fragment>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/**
 * "Helps both" (Checkpoint 7c): a pill in words (never color alone) right after the card's heading, why on hover. Its two
 * words say it to screen readers too; How to read says what it means.
 */
function HelpsBothBadge({ tag }: { tag: HelpsBothTagView }) {
  return (
    <span title={tag.title} className="shrink-0">
      <Badge tone="brand" className="align-middle">
        {tag.text}
      </Badge>
    </span>
  );
}

/**
 * "Helps you 37 now · 41 if done after this week's games." (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.2), the planner's
 * tooltip on hover and, since Checkpoint 7h, its words right under it in the card's Details, which a phone shows (it can't
 * hover); the first half kept on one line, the dot read as a pause. The words carry `data-now-or-later-words` (check:browser).
 */
function NowOrLater({ line }: { line: NowOrLaterView }) {
  return (
    <div className="mt-2 text-sm">
      <p title={line.title}>
        <span className="font-semibold whitespace-nowrap">{line.now}</span>
        <span aria-hidden>{SEP}</span>
        <span className="sr-only">, </span>
        <span>{line.later}</span>
      </p>
      <p data-now-or-later-words className="text-xs leading-relaxed text-muted">
        {line.title}
      </p>
    </div>
  );
}

/** The Trade Analyzer's "How Helps you adds up" (DetailsView: what Helps you is worth in points a week), inside its card's Details since Checkpoint 7h. */
function HelpsWorth({ details }: { details: DetailsView }) {
  return (
    <div className="mt-3 text-sm leading-relaxed">
      <p className="text-muted">{details.intro}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {details.items.map((item) => (
          <li key={item} className="break-words">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A disclosure button (Checkpoint 7h: the card's Details and How to offer it, side by side), 44 px, aria-expanded with
 * aria-controls naming its panel, named for screen readers by the card; the arrow turns when it's open.
 */
function DisclosureButton({ open, controls, onToggle, name, children }: { open: boolean; controls: string; onToggle: () => void; name: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className="inline-flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 text-left text-sm font-bold hover:bg-surface-muted sm:flex-none"
    >
      <span className="min-w-0">
        {children}
        <span className="sr-only"> ({name})</span>
      </span>
      <span aria-hidden className={cx("shrink-0 text-muted transition-transform", open && "rotate-180")}>
        ▾
      </span>
    </button>
  );
}

/**
 * Where a card's "How to offer it" is (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1): "idle" while nothing is asked
 * (its disclosure closed), "loading" while the engine works the offers out, "done" with them (asked by the disclosure or by
 * the feedback), "failed" when it couldn't (Try again asks again).
 */
export type OffersState = { kind: "idle" } | { kind: "loading" } | { kind: "done"; ladder: LadderView } | { kind: "failed" };

/** The Trade Finder's cards by key, each its place in the list shown (1 = first): TradeCardProps.places. */
type CardPlaces = ReadonlyMap<string, number>;

/**
 * One offer of "How to offer it": its label and players (tags after the names), then, when it's another card the Trade Finder
 * shows (its key in `places`; never the suggested trade, the card itself), "Also shown as trade idea 2." as a Plan B box says
 * it (the lead's call, wave D), Helps you and the chance they accept (each kept on one line, the estimate's label apart, as a
 * Plan B box prints its numbers), the veto note when the league's review could cut it, its roster moves when they aren't the
 * card's, and its own message to send them with Copy, named for screen readers by the offer and the card, open on the first
 * offer (`first`; Checkpoint 7h, the planner: "the first offer's message shows open, and the others stay behind their own
 * steps"). The item carries the offer's key (data-offer-key, which `npm run check:browser` reads; never data-trade-key) and,
 * since Checkpoint 7h, on a promoted card's "Open with" (the idea it was promoted from: OfferStepView.original), the mark
 * data-offer-original, which check:browser reads to hold that Open to the minimum chance alone (the first review's item 5).
 */
function OfferStepItem({ step, name, places, first }: { step: OfferStepView; name: string; places?: CardPlaces | undefined; first: boolean }) {
  const place = step.kind === "suggested" ? undefined : places?.get(step.key);
  return (
    <li className="break-words" data-offer-key={step.key} data-offer-original={step.original ? "true" : undefined}>
      <p>
        <span className="font-semibold">{step.label}:</span> {step.trade}
      </p>
      {place !== undefined ? <p className="text-muted">{planBAlsoText(place)}</p> : null}
      <p className="font-semibold">
        {step.numberParts.map((part, i) => (
          <Fragment key={part.text}>
            {i > 0 ? SEP : null}
            <span className="whitespace-nowrap">{part.text}</span>
            {part.label ? (
              <>
                {" "}
                <span className="whitespace-nowrap">{part.label}</span>
              </>
            ) : null}
          </Fragment>
        ))}
      </p>
      {step.acceptNote ? <p className="text-muted">{step.acceptNote}</p> : null}
      {step.moves.length ? (
        <>
          <p className="mt-1 font-semibold">{ROSTER_MOVES_HEADING}</p>
          <ul data-roster-moves="offer" className="list-disc space-y-0.5 pl-5">
            {step.moves.map((m) => (
              <li key={m} className="break-words">
                {m}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Message text={step.message} name={`${step.label}: ${step.trade}; ${name}`} className="mt-2" defaultOpen={first} />
    </li>
  );
}

/**
 * What the opened "How to offer it" shows for a state (tests render each): one status line that stays mounted, so each change
 * is announced ("Working out the offers…" with a spinner, then the line above the offers, "Offer this trade as it is: …"
 * when no version makes a better first offer, or that the trade can't be worked out), a failure with a 44 px Try again, and
 * the offers as a numbered list (an offer that is another card of `places` says so), the first offer's message open. Since
 * Checkpoint 7h the card's own message (`pitch`), open, where the list doesn't show it: the trade alone, or the offers couldn't
 * be worked out (⚠️ ours: the card body shows no message). Try again goes away once pressed, so it hands focus to the status
 * line that says what happens next (the review of wave D, UI-D-7: focus fell to the page).
 */
export function OffersPanel({
  state,
  name,
  onRetry,
  places,
  pitch,
}: {
  state: OffersState;
  name: string;
  onRetry?: (() => void) | undefined;
  places?: CardPlaces | undefined;
  pitch?: string | null | undefined;
}) {
  const loading = state.kind === "loading";
  const statusRef = useRef<HTMLParagraphElement>(null);
  const listed = state.kind === "done" && !state.ladder.alone && state.ladder.steps.length > 0;
  const own = !!pitch && ((state.kind === "done" && state.ladder.alone) || state.kind === "failed");
  return (
    <>
      <p
        ref={statusRef}
        role="status"
        tabIndex={FOCUS_TARGET.tabIndex}
        className={cx(loading ? "flex items-center gap-2 font-semibold text-muted" : state.kind === "done" ? "font-semibold" : "sr-only", FOCUS_TARGET.className)}
      >
        {loading ? <Spinner /> : null}
        {loading ? " " : null}
        {loading ? OFFERS_LOADING_TEXT : state.kind === "done" ? state.ladder.intro : ""}
      </p>
      {state.kind === "failed" ? (
        <div className="mt-2 space-y-2">
          <Callout tone="danger" role="alert">
            {OFFERS_FAILED_TEXT}
          </Callout>
          {onRetry ? (
            <button
              type="button"
              onClick={() => {
                onRetry();
                revealResult(statusRef.current);
              }}
              className={cx(buttonClass("secondary", "sm"), "min-h-11")}
            >
              Try again<span className="sr-only"> (how to offer {name})</span>
            </button>
          ) : null}
        </div>
      ) : null}
      {listed ? (
        <ol className="mt-2 list-decimal space-y-3 pl-5">
          {state.ladder.steps.map((s, i) => (
            <OfferStepItem key={s.key} step={s} name={name} places={places} first={i === 0} />
          ))}
        </ol>
      ) : null}
      {own && pitch ? <Message text={pitch} name={name} className="mt-2" defaultOpen /> : null}
    </>
  );
}

/** An engine request stopped (the page gone, another league's: engineClient.ts EngineError.cancelled), not failed: nothing to say. */
function isCancelled(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { cancelled?: unknown }).cancelled === true;
}

/** An answer of "How to offer it": the evaluation and attempt it was asked for, and the offers (null: they couldn't be worked out). */
interface OffersAnswer {
  for: TradeEvaluation;
  attempt: number;
  ladder: LadderView | null;
}

/** The answers a card keeps (the newest few: a card is built for one evaluation at a time, and a page goes back to an older one rarely). */
const OFFERS_ANSWERS_KEPT = 4;

/**
 * Where a card's "How to offer it" is (useOffers; pure, tests read it): offers for the evaluation and attempt shown, "done"
 * with them, loader or not (the final review of Checkpoint 7e, UI-F-2: the Trade Analyzer gives none while its result is
 * stale, and the offers already in still count for the feedback, which asks which one was sent); without a loader nothing
 * else ("idle"); an answer that they couldn't be worked out, "failed" (asked by the disclosure or by the feedback, open or
 * not); else "loading" while the disclosure is open (it asks) and "idle" while it's closed: nothing is asked then (the review
 * of wave D, UI-D-10).
 */
export function offersStateFor(on: boolean, open: boolean, answer: Pick<OffersAnswer, "ladder"> | null): OffersState {
  if (answer?.ladder) return { kind: "done", ladder: answer.ladder };
  if (!on) return { kind: "idle" };
  if (answer) return { kind: "failed" };
  return open ? { kind: "loading" } : { kind: "idle" };
}

/**
 * A card's "How to offer it" (the file header), through the page's `onOffers`: asked for while its disclosure is open (`open`,
 * `toggle`; opened, or still open when the card is built for another evaluation: a new search's or re-filter's, the Analyzer's
 * next trade), again with Try again (`retry`), and when the feedback needs its offers to ask which one was sent (`versions`:
 * the review of wave D, UI-D-1); never while it's closed otherwise (UI-D-10: a card built for another evaluation asked again
 * in the background once it had been opened). One request per evaluation and attempt, shared by both askers; each answer
 * kept for the evaluation and attempt it was asked for, so a page that builds the card again for the same evaluation (a sort,
 * the "now or after this week" numbers arriving) keeps it. The card it's worded for is the latest one built (`latest`).
 */
function useOffers(
  card: TradeCardView,
  onOffers: ((card: TradeCardView) => Promise<LadderView>) | undefined,
): { state: OffersState; open: boolean; toggle: (open: boolean) => void; retry: () => void; versions: () => Promise<readonly VersionChoice[]> } {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [answers, setAnswers] = useState<readonly OffersAnswer[]>([]);
  const latest = useRef(card);
  useEffect(() => {
    latest.current = card;
  });
  // The requests made, by evaluation and attempt (read and written in callbacks only).
  const requests = useRef(new WeakMap<TradeEvaluation, Map<number, Promise<LadderView | null>>>());
  const evaluation = card.evaluation;
  const done = answers.find((a) => a.for === evaluation && a.attempt === attempt) ?? null;
  // The latest card's offers for attempt `at`, asked once (a request under way is shared); filed among the answers when they
  // come, null when they couldn't be worked out (a loader that throws reads as one that failed); a cancelled request (the page
  // gone: engineClient.ts EngineError.cancelled) files nothing, rejects, and is asked again next time.
  const ask = useCallback(
    (at: number): Promise<LadderView | null> => {
      const c = latest.current;
      const ev = c.evaluation;
      let byAttempt = requests.current.get(ev);
      if (!byAttempt) {
        byAttempt = new Map();
        requests.current.set(ev, byAttempt);
      }
      const known = byAttempt.get(at);
      if (known) return known;
      if (!onOffers) return Promise.resolve(null);
      const mine = byAttempt;
      const file = (ladder: LadderView | null) => setAnswers((xs) => [...xs.filter((a) => !(a.for === ev && a.attempt === at)), { for: ev, attempt: at, ladder }].slice(-OFFERS_ANSWERS_KEPT));
      const made = new Promise<LadderView>((resolve) => resolve(onOffers(c))).then(
        (ladder) => {
          file(ladder);
          return ladder;
        },
        (err: unknown) => {
          if (isCancelled(err)) {
            mine.delete(at);
            throw err;
          }
          file(null);
          return null;
        },
      );
      mine.set(at, made);
      return made;
    },
    [onOffers],
  );
  useEffect(() => {
    if (!open || !onOffers || done) return;
    ask(attempt).catch(() => undefined); // cancelled: nothing to say
  }, [open, onOffers, evaluation, attempt, done, ask]);
  // The versions the feedback asks about once the offers are in (cardVersions); the card's own and its Plan B's when they
  // couldn't be worked out. Of the card the offers were asked for (`ask` reads the latest one when it's called), never one
  // built since for another evaluation (the final review of Checkpoint 7e, UI-F-1: one trade's offers with the next one's own
  // versions listed "The suggested trade" twice).
  const versions = useCallback((): Promise<readonly VersionChoice[]> => {
    const c = latest.current;
    return ask(attempt).then(
      (ladder) => (ladder ? cardVersions(c, ladder) : c.versions),
      () => c.versions,
    );
  }, [ask, attempt]);
  const state = offersStateFor(!!onOffers, open, done);
  return { state, open, toggle: setOpen, retry: () => setAttempt((a) => a + 1), versions };
}

/**
 * A message behind a 44 px "Message to send them" summary, with a 44 px Copy button; `name` says whose for screen readers;
 * `defaultOpen` opens it at first (Checkpoint 7h: the first offer's), after which it's the user's.
 */
function Message({ text, name, className, defaultOpen = false }: { text: string; name: string; className?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className={cx("rounded-xl border border-line", className)} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="flex min-h-11 items-center justify-between gap-2 px-3 text-sm font-bold">
        <span>
          Message to send them<span className="sr-only"> ({name})</span>
        </span>
        <span aria-hidden className="text-muted">
          ▾
        </span>
      </summary>
      <div className="border-t border-line p-3">
        <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{text}</p>
        {/* CopyButton is a small button; the wrapper makes it a 44 px target. */}
        <div className="mt-2 [&>button]:min-h-11">
          <CopyButton text={text} />
        </div>
      </div>
    </details>
  );
}

/**
 * "If they won't move: try …" (Plan B; Checkpoint 7e, the planner's heading), inside "How to offer it" after the offers since
 * Checkpoint 7h: the other trade in words (tags after the names), which kind it is, its three numbers (each kept on one line,
 * the estimate's label apart, so nothing breaks inside "(Est. · Likely)" on a 375 px phone; the chance it goes through when a
 * veto could cut it), its own odds and weekly line laid out as the card's (OddsLines; Phase 4c, change 9: none when the Plan B
 * carries no odds), whether the list shows it as an idea of its own, its roster moves (without the list's line of moves made
 * either way: Checkpoint 7h), its own message to send them (closed) and its own "Open in Analyzer", both named for screen
 * readers by the card.
 */
function PlanBBox({ planB, name, showLink, onOpen }: { planB: PlanBView; name: string; showLink: boolean; onOpen?: ((href: string) => void) | undefined }) {
  const which = `if they won't move: ${planB.give} for ${planB.get}; ${name}`;
  return (
    <div className="mt-3 rounded-xl border border-line px-3 py-2 text-sm leading-relaxed">
      <p className="font-bold">{planB.heading}</p>
      <p className="text-xs text-muted">{planB.kindText}</p>
      <p className="mt-1 break-words">
        <span className="font-semibold">You give:</span> {planB.give}
      </p>
      <p className="break-words">
        <span className="font-semibold">You get:</span> {planB.get}
      </p>
      <p className="mt-1 font-semibold">
        {planB.numberParts.map((part, i) => (
          <Fragment key={part.text}>
            {i > 0 ? SEP : null}
            <span className="whitespace-nowrap">{part.text}</span>
            {part.label ? (
              <>
                {" "}
                <span className="whitespace-nowrap">{part.label}</span>
              </>
            ) : null}
          </Fragment>
        ))}
      </p>
      {planB.acceptNote ? <p className="text-muted">{planB.acceptNote}</p> : null}
      {planB.odds.length || planB.weekly ? (
        <div className="mt-2">
          <OddsLines odds={planB.odds} weekly={planB.weekly} note={planB.oddsNote} />
        </div>
      ) : null}
      {planB.moves.length ? (
        <>
          <p className="mt-1 font-semibold">{ROSTER_MOVES_HEADING}</p>
          <ul data-roster-moves="plan-b" className="list-disc space-y-0.5 pl-5">
            {planB.moves.map((m) => (
              <li key={m} className="break-words">
                {m}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {planB.also ? <p className="text-muted">{planB.also}</p> : null}
      <Message text={planB.pitch} name={which} className="mt-2" />
      {showLink ? (
        <div className="mt-2">
          <Link href={planB.analyzerHref} prefetch={false} onClick={onOpen ? () => onOpen(planB.analyzerHref) : undefined} className={cx(buttonClass("secondary", "sm"), "min-h-11")}>
            Open in Analyzer<span className="sr-only"> ({which})</span>
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export interface TradeCardProps {
  card: TradeCardView;
  /** Its place in the list (1 = first), shown above the heading; omitted in the Analyzer. */
  rank?: number;
  headingLevel?: "h2" | "h3";
  feedback: CardFeedback;
  /**
   * Saves one press (the page: useFeedback.ts saveFeedbackPress); its promise says whether the browser kept it, and
   * whether an anonymous copy is on its way (Phase 7a: the card's one-time note, FeedbackControls). Checkpoint 7d: the press
   * comes with what the card prints (FeedbackChange.shown; tradeView.ts cardPress).
   */
  onFeedback: (change: FeedbackChange) => FeedbackSaveResult | Promise<FeedbackSaveResult>;
  /** "Open in Analyzer" (the Finder's cards; Plan B's too). */
  showAnalyzerLink?: boolean;
  /**
   * Called with the link's address when an "Open in Analyzer" is used (the card's or its Plan B's): the Finder remembers
   * the idea and the link, to bring that link back into view on return.
   */
  onOpenAnalyzer?: ((href: string) => void) | undefined;
  /**
   * "How to offer it" (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1): works the card's offers out when its
   * disclosure is opened (the page asks its engine worker and words the answer: tradeView.ts buildLadderView). Absent: the card
   * shows no offers (its own message instead, and its Plan B box when it has one).
   */
  onOffers?: ((card: TradeCardView) => Promise<LadderView>) | undefined;
  /**
   * The Trade Finder's cards by key, each its place in the list it shows now (1 = first; the sort shown, so it follows a
   * re-sort): an offer of "How to offer it" that is another of those cards says so, "Also shown as trade idea 2." (the lead's
   * call, wave D: an offer can be another card of its list). Absent (the Analyzer): no offer says it.
   */
  places?: ReadonlyMap<string, number> | undefined;
  /**
   * Whether "Details" is open at first (Checkpoint 7h, the lead's item 6: the Trade Analyzer's one card opens with Details, a
   * Trade Finder card closed); absent: open without a `rank` (the Analyzer's card has none), closed with one.
   */
  detailsOpen?: boolean;
}

export function TradeCard({ card, rank, headingLevel = "h3", feedback, onFeedback, showAnalyzerLink = true, onOpenAnalyzer, onOffers, places, detailsOpen }: TradeCardProps) {
  const headingId = useId();
  const detailsId = useId();
  const offersId = useId();
  const Heading = headingLevel;
  const n = card.numbers;
  // Several ideas can be with the same team: buttons name their card by its place too.
  const name = rank ? `trade idea ${rank}, ${card.heading}` : card.heading;
  // "How to offer it": once its offers are in, they're the versions the feedback asks about (with Plan B's); until then (nor
  // failed) a first outcome pressed asks for them first (the review of wave D, UI-D-1).
  const offersOn = !!(card.offers && onOffers);
  const offers = useOffers(card, offersOn ? onOffers : undefined);
  const ladder = offers.state.kind === "done" ? offers.state.ladder : null;
  const versions = ladder ? cardVersions(card, ladder) : card.versions;
  const loadVersions = offersOn && offers.state.kind !== "done" && offers.state.kind !== "failed" ? offers.versions : undefined;
  // Details: closed on a Trade Finder card, open on the Analyzer's one card (Checkpoint 7h).
  const [showDetails, setShowDetails] = useState(detailsOpen ?? rank === undefined);
  // The offers themselves show while the page can work them out, or ones already in do (a stale Analyzer result: UI-F-2).
  const offersShown = !!card.offers && (offersOn || !!ladder);
  // "How to offer it" holds the offers, the card's own message and its Plan B box; without offers or a Plan B (a trade that
  // doesn't help me, one opened from a Plan B in the Analyzer) there's no such control, and the message goes in Details.
  const offerPanel = !!card.offers || !!card.planB;
  const heading = (
    <Heading id={headingId} className="text-lg leading-tight font-extrabold tracking-tight wrap-anywhere">
      {card.heading}
    </Heading>
  );
  // "Helps both" next to the heading, wrapping under it on a narrow phone (Checkpoint 7c); the heading alone names the card.
  const titled = card.helpsBothTag ? (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {heading}
      <HelpsBothBadge tag={card.helpsBothTag} />
    </div>
  ) : (
    heading
  );
  // The first reason shows on the closed card; the others in Details (Checkpoint 7h: "one reason").
  const [reason, ...moreReasons] = card.reasons;
  return (
    <article aria-labelledby={headingId} className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
      {/* "Trade idea N" on one row with the heading and its "Helps both" tag, on one baseline, wrapping when they don't fit
          (Checkpoint 7h, the first review's item 3: the eyebrow's own line saved, toward at least 2 closed ideas a phone
          screen). ⚠️ Ours: the heading and its tag move down together, as one piece, with no gap above them: a card tagged
          "Helps both" that can't fit all three on a line (every one at 375 px) is laid out as before, rather than the tag
          dropping to a line of its own under the heading, 10.5 px taller than before. */}
      {rank ? (
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="text-xs font-bold tracking-wider text-brand uppercase">Trade idea {rank}</p>
          {titled}
        </div>
      ) : (
        titled
      )}

      <div className="mt-2 grid grid-cols-2 gap-3">
        <AssetList title="You give" assets={card.give} />
        <AssetList title="You get" assets={card.get} />
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        <Score label="Helps you" number={n.helps} />
        <Score label="Chance they accept" number={n.accept} sub={n.acceptLabel} />
        <Score label="Overall" number={n.overall} />
      </dl>
      {/* The veto note right under the numbers it qualifies (`npm run check:browser` reads it as the <dl>'s next element). */}
      {n.acceptNote ? <p className="mt-2 text-sm text-muted">{n.acceptNote}</p> : null}
      {/* The risk flags as small pills in words (Checkpoint 7h); their sentences are in Details. */}
      {card.flags.length ? (
        <ul aria-label="Risks" className="mt-2 flex flex-wrap gap-1.5">
          {card.flags.map((f) => (
            <li key={f.kind} className="inline-flex items-center gap-1 rounded-full border border-warn-line bg-warn-bg px-2 py-0.5 text-xs font-bold text-warn-fg">
              <span aria-hidden>⚠</span>
              {f.pill}
            </li>
          ))}
        </ul>
      ) : null}
      {reason ? <p className="mt-2 text-sm leading-snug break-words">{reason}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <DisclosureButton open={showDetails} controls={detailsId} onToggle={() => setShowDetails((o) => !o)} name={name}>
          {DETAILS_HEADING}
        </DisclosureButton>
        {offerPanel ? (
          <DisclosureButton open={offers.open} controls={offersId} onToggle={() => offers.toggle(!offers.open)} name={name}>
            {card.offers?.heading ?? OFFERS_HEADING}
          </DisclosureButton>
        ) : null}
      </div>

      <div id={detailsId} hidden={!showDetails} className="mt-3 border-t border-line pt-3">
        <OddsLines odds={card.odds} weekly={card.weekly} them={card.them} note={card.oddsNote} />
        {card.nowOrLater ? <NowOrLater line={card.nowOrLater} /> : null}
        {card.injuryNote ? <p className="mt-2 text-xs leading-relaxed break-words text-muted">{card.injuryNote}</p> : null}
        {card.flags.length ? (
          <ul aria-label="Risks in full" className="mt-3 space-y-1.5">
            {card.flags.map((f) => (
              <li key={f.kind} className="flex gap-2 rounded-xl border border-warn-line bg-warn-bg px-3 py-2 text-sm font-semibold text-warn-fg">
                <span aria-hidden className="shrink-0">
                  ⚠
                </span>
                <span className="min-w-0 break-words">{f.text}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="mt-3 text-sm font-bold">{card.ros}</p>
        {card.rosNote ? <p className="mt-0.5 text-xs leading-relaxed break-words text-muted">{card.rosNote}</p> : null}
        <dl className="mt-2 divide-y divide-line text-sm">
          {card.facts.map((f) => (
            <div key={f.label} className="grid gap-0.5 py-1.5 sm:grid-cols-[minmax(0,10rem)_1fr] sm:gap-3">
              <dt className="font-semibold text-muted">{f.label}</dt>
              <dd className="min-w-0 break-words">{f.value}</dd>
            </div>
          ))}
        </dl>
        {/* The attribution after a sentence (a link inside a sentence, so its line needn't be a 44 px target). */}
        {card.valuesCredit ? (
          <p className="mt-1 text-xs text-muted">
            {card.valuesCredit} <ValuesCredit className="text-xs" />
          </p>
        ) : null}
        {card.details ? <HelpsWorth details={card.details} /> : null}

        {card.required.length ? (
          <div className="mt-3 rounded-xl bg-surface-muted px-3 py-2 text-sm">
            <p className="font-bold">{ROSTER_MOVES_HEADING}</p>
            <ul data-roster-moves="card" className="mt-1 list-disc space-y-0.5 pl-5">
              {card.required.map((r) => (
                <li key={r} className="break-words">
                  {r}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {moreReasons.length ? (
          <div className="mt-3">
            <p className="text-sm font-bold">{MORE_REASONS_HEADING}</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed">
              {moreReasons.map((r) => (
                <li key={r} className="break-words">
                  {r}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* No "How to offer it" (a trade that doesn't help me, a Plan B opened in the Analyzer): its own message here (⚠️ ours). */}
        {!offerPanel && card.pitch ? <Message text={card.pitch} name={name} className="mt-3" /> : null}

        {showAnalyzerLink ? (
          <div className="mt-3">
            <Link href={card.analyzerHref} prefetch={false} onClick={onOpenAnalyzer ? () => onOpenAnalyzer(card.analyzerHref) : undefined} className={cx(buttonClass("secondary", "sm"), "min-h-11")}>
              Open in Analyzer<span className="sr-only"> ({name})</span>
            </Link>
          </div>
        ) : null}

        {/* Each press carries what this card prints, for the record and the export (Checkpoint 7d: cardPress). */}
        <FeedbackControls feedback={feedback} onChange={(change) => onFeedback(cardPress(change, card))} tradeName={name} versions={versions} loadVersions={loadVersions} />
      </div>

      {offerPanel ? (
        <div id={offersId} hidden={!offers.open} className="mt-3 border-t border-line pt-3 text-sm leading-relaxed">
          {offersShown ? (
            <OffersPanel state={offers.state} name={name} onRetry={offers.retry} places={places} pitch={card.pitch} />
          ) : card.pitch ? (
            <Message text={card.pitch} name={name} defaultOpen />
          ) : null}
          {card.planB ? <PlanBBox planB={card.planB} name={name} showLink={showAnalyzerLink} onOpen={onOpenAnalyzer} /> : null}
        </div>
      ) : null}
    </article>
  );
}
