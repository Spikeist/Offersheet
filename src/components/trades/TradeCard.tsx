"use client";
/**
 * One trade idea (CLAUDE.md §13 "Each trade card shows"; §10's three numbers; §11's "Est." and labels; Phase 4 wave 2
 * decision M13), laid out from its view model (src/lib/tradeView.ts buildTradeCard), mobile-first (375 px):
 * - the partner, then You give / You get (each player with position, NFL team and an injury tag in words);
 * - the three numbers side by side: Helps you, Chance they accept (with "Est." and its label; the chance it goes
 *   through when the league's review could veto it), Overall;
 * - the risk flags apart from the numbers, each saying what it is in words (not color alone);
 * - "You get 142 ROS pts, give 118", the numbers behind the score in words, then a sentence saying the numbers weigh trade
 *   value with the "Values: FantasyCalc" link after it (§2.9; TradeCardView.valuesCredit: no trade value is ever shown,
 *   planner reply to Checkpoint 7a, 5.4), and the roster moves its numbers assume (since Checkpoint 7e, planner reply to
 *   Checkpoint 7d, item 2.2: every one of mine in order, each with its reason, and one line for those made either way; the
 *   partner's after mine; a Plan B box lists its own, mine, under its odds);
 * - the reasons, the pitch message (opened on demand) with Copy, "Open in Analyzer" (the Finder's cards), and the
 *   feedback buttons (FeedbackControls). "Open in Analyzer" carries the trade's ids in its address, so it's never
 *   prefetched: the server sees that address only when the user opens it (the privacy page says so). Using it tells
 *   the Finder which idea to bring back into view when the user comes back (onOpenAnalyzer; finderMemory.ts).
 * Planner addendum to Checkpoint 3: a player I'd get whom his manager values above market carries a gold "Harder to
 * get" pill in words (why on hover, and said in full to screen readers: a title alone isn't reliably read). Checkpoint 7e
 * (planner reply to Checkpoint 7d, item 4.1: "one ordered list of up to 4 offers to the same team"): right under the odds,
 * "How to offer it", a closed 44 px disclosure on every card that helps me (tradeView.ts offersView), whose offers the page's
 * engine worker works out the first time it's opened (`onOffers`: "Working out the offers…" in a status line that stays
 * mounted, then "Offer them in order: if they say no, try the next.", or "Offer this trade as it is: …" when nothing beats
 * it; a failure says so with a 44 px Try again): a numbered list, each offer with its label ("Open with", "Then", "The
 * suggested trade", "Last offer"), its players, Helps you and the chance they accept, its roster moves when they aren't the
 * card's, and its own "Message to send them" with Copy. An offer that is another card the Trade Finder shows says so under its
 * players, Plan B's words with that card's place in the sort shown ("Also shown as trade idea 2."; the lead's call, wave D:
 * the page's `places`; none in the Analyzer). Once they're in, they're the versions the feedback asks about. Both pages
 * explain it under the cards (HowToRead.tsx). The review of wave D: the disclosure's open state is the card's
 * (`useOffers`), and its offers are asked for only while it's open (UI-D-10: a card built for another evaluation asked again
 * in the background once it had been opened), or when the feedback needs them: a first outcome pressed on a card whose offers
 * haven't loaded asks for them first, then which version was sent among them (UI-D-1: such a card saved "the suggested
 * trade" without a word, though its offers said to open with another); Try again hands focus to the status line that
 * replaces it (UI-D-7); and once the offers open with another trade, a line over the card's own "Message to send them" says
 * that message proposes the trade as it is (UI-D-6).
 * Planner reply to Checkpoint 4, change 6: every injury-tagged player on either side carries his tag in words under his
 * name ("Out — expected back week 8"; a tinted tag that wraps, so a long one never widens the card past a 375 px
 * screen), and when a player I'd get is tagged, one line under the two lists says his projection assumes he returns at
 * full strength, blended with the trade market while the blend is on (for a player the "Depends on an injured player"
 * flag names, the flag says it instead: src/lib/tradeView.ts). A Finder card can show "If they won't move: try …" (Plan B;
 * "If they say no, try:" until Checkpoint 7e, on a card without steps): the other trade (each tagged player with his tag in
 * words after his name), which kind it is, its three numbers
 * in words (each kept on one line, the estimate's label apart), its own odds and weekly line as the card's (Phase 4c,
 * change 9), "Also shown as trade idea 6." when the list has it as a card of its own, its own "Message to send them"
 * with Copy, and its own "Open in Analyzer" (both named for screen readers). Review of Phase 4b: it sits after the
 * card's own reasons, message and "Open in Analyzer", just before the feedback buttons, so the card's flags, facts and
 * reasons read as the card's (they sat under a Plan B that didn't include their player). The feedback buttons get the
 * card's versions (FeedbackControls asks which one was sent when there are two): its own trade and its Plan B, and once
 * "How to offer it" has loaded, its offers in their order (tradeView.ts cardVersions).
 * Under "You get 142 ROS pts, give 118", a line when my starting lineup moves the other way from those points (a backup
 * given away scores nothing for me). The roster moves its numbers assume include Phase 4b's IR slots and returns. Checkpoint
 * 7e (planner reply to Checkpoint 7d, item 2.1; review of wave B, finding B-4): a card or Plan B box whose odds start from its
 * own "before" (its either-way moves) says so in a small line under them (TradeCardView.oddsNote, PlanBView.oddsNote).
 * Planner reply to Checkpoint 4b (Phase 4c): under the three numbers (after the veto note, which stays right under
 * them), my real odds, "Title odds 12.1% → 13.4% · Playoff odds 65% → 69%" (change 9; each kept on one line, the arrow
 * said as "from … to" for screen readers; since Checkpoint 7c, under "Several prizes" paying 2nd or 3rd place, "Top 3
 * odds 30% → 32%" or "Top 2 odds …" between them, planner reply to Checkpoint 7b, §6: OddsLines lays out whatever lines
 * the view gives, a Plan B box's too), and "Win chance by week: Week 9: 68% → 64% · Week 13: 42% → 55%" when the
 * trade moves a week's chance enough, and the Trade Analyzer's card has "Details" (a closed 44 px disclosure: what Helps you
 * is worth in points a week). An estimate under 5% prints "<5%" (answer 5), said "under 5%" to screen readers.
 * The feedback buttons wait for the browser to keep a press (onFeedback returns the save's promise: change 7's
 * FeedbackControls), so a refused press is said on the card itself.
 * Planner reply to Checkpoint 4c (Phase 7a, A2): "Helps you" has a tooltip saying what its scale means ("63 ≈ as good as
 * adding 3 points a week to your lineup for the rest of the season."; the page's info line says it in words too, for a
 * phone), and the Analyzer's Details ends with what the trade is worth in lineup points a week ("≈ +1.8 pts/week").
 * Checkpoint 7c (planner reply to Checkpoint 7b, §7): a card that helps both teams carries a "Helps both" pill in words right
 * after its heading (in every sort, and on the Analyzer's card; why on hover), outside the heading, so the card is still
 * named by "Trade with …" alone; and after my odds and my weekly line, the partner's line in the format of mine ("Helps
 * them 24 · Their title odds 6.0% → 6.9% · Their playoff odds 41% → 45%", each item kept on one line, the arrow read as
 * "from … to", the planner's tooltip on "Helps them"; OddsLines). A Plan B box shows neither. Since Checkpoint 7d (planner
 * reply to Checkpoint 7c, answer 3) a Trade Finder card shows the partner's line only with the tag, the Analyzer's card
 * whenever it has one (the view decides: tradeView.ts CardContext.partnerLine).
 * Checkpoint 7d (planner reply to Checkpoint 7c, answer 1): every press on the feedback buttons carries what the card prints
 * (tradeView.ts cardPress, TradeCardView.shown), which the record it makes keeps for the export.
 * Checkpoint 7e (planner reply to Checkpoint 7d, item 4.2): when doing the trade after this week's games moves its Helps you by
 * more than config.explain.nowOrLaterMin, "Helps you 37 now · 41 if done after this week's games." right under the three
 * numbers (after the veto note), the planner's tooltip on it, and the same words among the card's facts ("After this week's
 * games"), so a phone shows them too (TradeCardView.nowOrLater). A Trade Finder card's line arrives after the search; the
 * Analyzer's comes with its evaluation. A Plan B box has none.
 * It's an <article> named by its heading; the heading level is the page's to choose.
 */
import Link from "next/link";
import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";
import type { TradeEvaluation } from "@/engine/tradeModel";
import type { FeedbackSaveResult } from "@/lib/feedbackShare";
import type { FeedbackChange } from "@/lib/feedbackStore";
import {
  OFFERS_FAILED_TEXT,
  OFFERS_LOADING_TEXT,
  ROSTER_MOVES_HEADING,
  cardPress,
  cardVersions,
  ownMessageNote,
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
  type OffersView,
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
        <ul className="mt-1 space-y-1">
          {assets.map((a) => (
            <li key={a.id} className="min-w-0">
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
        <p className="mt-1 text-sm text-muted">Nothing</p>
      )}
    </div>
  );
}

/** One of the three numbers; its tooltip (NumberView.title: Helps you's scale) on the whole tile. */
function Score({ label, number, sub }: { label: string; number: NumberView; sub?: string | undefined }) {
  return (
    <div title={number.title} className="flex min-w-0 flex-col-reverse justify-end rounded-xl bg-surface-muted px-1.5 py-2 text-center">
      <dt className="mt-0.5 text-xs leading-tight font-semibold text-muted">{label}</dt>
      <dd>
        <span className="block text-2xl font-black tracking-tight tabular-nums" aria-hidden={number.srText ? true : undefined}>
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
 * My odds before and after the trade, next to the three numbers: each odds kept on one line (it wraps between them on a
 * 320 px phone), the arrow said as "from … to" to screen readers; then the weeks whose win chance moves, each kept whole;
 * then (Checkpoint 7c) the partner's line, "Helps them 24" with the planner's tooltip, then their odds as mine.
 */
function OddsLines({ odds, weekly, them = null }: { odds: OddsView[]; weekly: WeeklyLineView | null; them?: ThemView | null }) {
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
 * "Helps you 37 now · 41 if done after this week's games." (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.2) under the
 * three numbers, the planner's tooltip on hover (the card's facts say it too, which a phone shows: tradeView.ts
 * NOW_OR_LATER_LABEL); the first half kept on one line, the dot read as a pause.
 */
function NowOrLater({ line }: { line: NowOrLaterView }) {
  return (
    <p className="mt-2 text-sm" title={line.title}>
      <span className="font-semibold whitespace-nowrap">{line.now}</span>
      <span aria-hidden>{SEP}</span>
      <span className="sr-only">, </span>
      <span>{line.later}</span>
    </p>
  );
}

/** The Trade Analyzer's "Details": what Helps you is worth in points a week, behind a closed 44 px summary named for screen readers. */
function Details({ details, name }: { details: DetailsView; name: string }) {
  return (
    <details className="mt-3 rounded-xl border border-line">
      <summary className="flex min-h-11 items-center justify-between gap-2 px-3 text-sm font-bold">
        <span>
          {details.summary}
          <span className="sr-only"> ({name})</span>
        </span>
        <span aria-hidden className="text-muted">
          ▾
        </span>
      </summary>
      <div className="border-t border-line p-3 text-sm leading-relaxed">
        <p className="text-muted">{details.intro}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {details.items.map((item) => (
            <li key={item} className="break-words">
              {item}
            </li>
          ))}
        </ul>
      </div>
    </details>
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
 * card's, and its own message to send them with Copy, named for screen readers by the offer and the card. The item carries
 * the offer's key (data-offer-key, which `npm run check:browser` reads; never data-trade-key, the cards' own).
 */
function OfferStepItem({ step, name, places }: { step: OfferStepView; name: string; places?: CardPlaces | undefined }) {
  const place = step.kind === "suggested" ? undefined : places?.get(step.key);
  return (
    <li className="break-words" data-offer-key={step.key}>
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
          <ul className="list-disc space-y-0.5 pl-5">
            {step.moves.map((m) => (
              <li key={m} className="break-words">
                {m}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Message text={step.message} name={`${step.label}: ${step.trade}; ${name}`} className="mt-2" />
    </li>
  );
}

/**
 * What the opened "How to offer it" shows for a state (tests render each): one status line that stays mounted, so each change
 * is announced ("Working out the offers…" with a spinner, then the line above the offers, "Offer this trade as it is: …"
 * when no version makes a better first offer, or that the trade can't be worked out), a failure with a 44 px Try again, and
 * the offers as a numbered list (an offer that is another card of `places` says so). Try again goes away once pressed, so it
 * hands focus to the status line that says what happens next (the review of wave D, UI-D-7: focus fell to the page).
 */
export function OffersPanel({ state, name, onRetry, places }: { state: OffersState; name: string; onRetry?: (() => void) | undefined; places?: CardPlaces | undefined }) {
  const loading = state.kind === "loading";
  const statusRef = useRef<HTMLParagraphElement>(null);
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
      {state.kind === "done" && !state.ladder.alone && state.ladder.steps.length ? (
        <ol className="mt-2 list-decimal space-y-3 pl-5">
          {state.ladder.steps.map((s) => (
            <OfferStepItem key={s.key} step={s} name={name} places={places} />
          ))}
        </ol>
      ) : null}
    </>
  );
}

/**
 * "How to offer it" behind a 44 px summary named for screen readers, closed at first; its open state is the card's (`open`,
 * `onToggle`: useOffers asks for the offers while it's open), so it stays as the user left it when the card is built for
 * another evaluation; `places`, the Trade Finder's cards' places (TradeCardProps.places), for the offers that are cards.
 */
function OffersDisclosure({
  offers,
  state,
  open,
  name,
  onToggle,
  onRetry,
  places,
}: {
  offers: OffersView;
  state: OffersState;
  open: boolean;
  name: string;
  onToggle: (open: boolean) => void;
  onRetry: () => void;
  places?: CardPlaces | undefined;
}) {
  return (
    <details className="mt-3 rounded-xl border border-line" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary className="flex min-h-11 items-center justify-between gap-2 px-3 text-sm font-bold">
        <span>
          {offers.heading}
          <span className="sr-only"> ({name})</span>
        </span>
        <span aria-hidden className="text-muted">
          ▾
        </span>
      </summary>
      <div className="border-t border-line p-3 text-sm leading-relaxed">
        <OffersPanel state={state} name={name} onRetry={onRetry} places={places} />
      </div>
    </details>
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
 * Where a card's "How to offer it" is (useOffers; pure, tests read it): no loader, "idle"; an answer for the evaluation and
 * attempt shown, "done" with it, or "failed" (asked by the disclosure or by the feedback, open or not); else "loading" while
 * the disclosure is open (it asks) and "idle" while it's closed: nothing is asked then (the review of wave D, UI-D-10).
 */
export function offersStateFor(on: boolean, open: boolean, answer: Pick<OffersAnswer, "ladder"> | null): OffersState {
  if (!on) return { kind: "idle" };
  if (answer) return answer.ladder ? { kind: "done", ladder: answer.ladder } : { kind: "failed" };
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
  // couldn't be worked out.
  const versions = useCallback(
    (): Promise<readonly VersionChoice[]> =>
      ask(attempt).then(
        (ladder) => (ladder ? cardVersions(latest.current, ladder) : latest.current.versions),
        () => latest.current.versions,
      ),
    [ask, attempt],
  );
  const state = offersStateFor(!!onOffers, open, done);
  return { state, open, toggle: setOpen, retry: () => setAttempt((a) => a + 1), versions };
}

/** A message behind a 44 px "Message to send them" summary, with a 44 px Copy button; `name` says whose for screen readers. */
function Message({ text, name, className }: { text: string; name: string; className?: string }) {
  return (
    <details className={cx("rounded-xl border border-line", className)}>
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
 * "If they won't move: try …" (Plan B; Checkpoint 7e, the planner's heading): the other trade in words (tags after the names), which kind it is, its three numbers
 * (each kept on one line, the estimate's label apart, so nothing breaks inside "(Est. · Likely)" on a 375 px phone; the
 * chance it goes through when a veto could cut it), its own odds and weekly line laid out as the card's (OddsLines;
 * Phase 4c, change 9: none when the Plan B carries no odds), whether the list shows it as an idea of its own, its own
 * message to send them and its own "Open in Analyzer", both named for screen readers by the card.
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
      {planB.odds.length || planB.weekly ? <OddsLines odds={planB.odds} weekly={planB.weekly} /> : null}
      {planB.oddsNote ? <p className="text-xs text-muted">{planB.oddsNote}</p> : null}
      {planB.moves.length ? (
        <>
          <p className="mt-1 font-semibold">{ROSTER_MOVES_HEADING}</p>
          <ul className="list-disc space-y-0.5 pl-5">
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
   * shows no "How to offer it".
   */
  onOffers?: ((card: TradeCardView) => Promise<LadderView>) | undefined;
  /**
   * The Trade Finder's cards by key, each its place in the list it shows now (1 = first; the sort shown, so it follows a
   * re-sort): an offer of "How to offer it" that is another of those cards says so, "Also shown as trade idea 2." (the lead's
   * call, wave D: an offer can be another card of its list). Absent (the Analyzer): no offer says it.
   */
  places?: ReadonlyMap<string, number> | undefined;
}

export function TradeCard({ card, rank, headingLevel = "h3", feedback, onFeedback, showAnalyzerLink = true, onOpenAnalyzer, onOffers, places }: TradeCardProps) {
  const headingId = useId();
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
  const heading = (
    <Heading id={headingId} className="text-lg leading-tight font-extrabold tracking-tight wrap-anywhere">
      {card.heading}
    </Heading>
  );
  return (
    <article aria-labelledby={headingId} className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
      {rank ? <p className="text-xs font-bold tracking-wider text-brand uppercase">Trade idea {rank}</p> : null}
      {/* "Helps both" next to the heading, wrapping under it on a narrow phone (Checkpoint 7c); the heading alone names the card. */}
      {card.helpsBothTag ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {heading}
          <HelpsBothBadge tag={card.helpsBothTag} />
        </div>
      ) : (
        heading
      )}

      <div className="mt-3 grid grid-cols-2 gap-3">
        <AssetList title="You give" assets={card.give} />
        <AssetList title="You get" assets={card.get} />
      </div>
      {card.injuryNote ? <p className="mt-2 text-xs leading-relaxed break-words text-muted">{card.injuryNote}</p> : null}

      <dl className="mt-4 grid grid-cols-3 gap-2">
        <Score label="Helps you" number={n.helps} />
        <Score label="Chance they accept" number={n.accept} sub={n.acceptLabel} />
        <Score label="Overall" number={n.overall} />
      </dl>
      {/* The veto note right under the numbers it qualifies (`npm run check:browser` reads it as the <dl>'s next element). */}
      {n.acceptNote ? <p className="mt-2 text-sm text-muted">{n.acceptNote}</p> : null}
      {card.nowOrLater ? <NowOrLater line={card.nowOrLater} /> : null}
      <OddsLines odds={card.odds} weekly={card.weekly} them={card.them} />
      {card.oddsNote ? <p className="mt-1 text-xs leading-relaxed break-words text-muted">{card.oddsNote}</p> : null}
      {card.offers && onOffers ? <OffersDisclosure offers={card.offers} state={offers.state} open={offers.open} name={name} onToggle={offers.toggle} onRetry={offers.retry} places={places} /> : null}

      {card.flags.length ? (
        <ul aria-label="Risks" className="mt-3 space-y-1.5">
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
      {card.details ? <Details details={card.details} name={name} /> : null}

      {card.required.length ? (
        <div className="mt-3 rounded-xl bg-surface-muted px-3 py-2 text-sm">
          <p className="font-bold">{ROSTER_MOVES_HEADING}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {card.required.map((r) => (
              <li key={r} className="break-words">
                {r}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {card.reasons.length ? (
        <div className="mt-3">
          <p className="text-sm font-bold">Why</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed">
            {card.reasons.map((r) => (
              <li key={r} className="break-words">
                {r}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* The card's own message proposes the trade as it is: said when "How to offer it" opens with another (UI-D-6). */}
      {card.pitch && ownMessageNote(ladder) ? <p className="mt-3 text-sm break-words text-muted">{ownMessageNote(ladder)}</p> : null}
      {card.pitch ? <Message text={card.pitch} name={name} className={ownMessageNote(ladder) ? "mt-1" : "mt-3"} /> : null}

      {showAnalyzerLink ? (
        <div className="mt-3">
          <Link href={card.analyzerHref} prefetch={false} onClick={onOpenAnalyzer ? () => onOpenAnalyzer(card.analyzerHref) : undefined} className={cx(buttonClass("secondary", "sm"), "min-h-11")}>
            Open in Analyzer<span className="sr-only"> ({name})</span>
          </Link>
        </div>
      ) : null}

      {/* After the card's own content (review of Phase 4b: its flags read as the Plan B's when they sat under it). */}
      {card.planB ? <PlanBBox planB={card.planB} name={name} showLink={showAnalyzerLink} onOpen={onOpenAnalyzer} /> : null}

      {/* Each press carries what this card prints, for the record and the export (Checkpoint 7d: cardPress). */}
      <FeedbackControls feedback={feedback} onChange={(change) => onFeedback(cardPress(change, card))} tradeName={name} versions={versions} loadVersions={loadVersions} />
    </article>
  );
}
