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
 *   planner reply to Checkpoint 7a, 5.4), and any roster moves the trade forces;
 * - the reasons, the pitch message (opened on demand) with Copy, "Open in Analyzer" (the Finder's cards), and the
 *   feedback buttons (FeedbackControls). "Open in Analyzer" carries the trade's ids in its address, so it's never
 *   prefetched: the server sees that address only when the user opens it (the privacy page says so). Using it tells
 *   the Finder which idea to bring back into view when the user comes back (onOpenAnalyzer; finderMemory.ts).
 * Planner addendum to Checkpoint 3: a player I'd get whom his manager values above market carries a gold "Harder to
 * get" pill in words (why on hover, and said in full to screen readers: a title alone isn't reliably read); a trade
 * with steps shows "How to offer it" right under the three numbers, an ordered list ("Offer first: … · Est. 35%", "If
 * they say no, add … · Est. 55%"), each estimate said in full to screen readers. Both pages explain the two under the
 * cards (HowToRead.tsx).
 * Planner reply to Checkpoint 4, change 6: every injury-tagged player on either side carries his tag in words under his
 * name ("Out — expected back week 8"; a tinted tag that wraps, so a long one never widens the card past a 375 px
 * screen), and when a player I'd get is tagged, one line under the two lists says his projection assumes he returns at
 * full strength, blended with the trade market while the blend is on (for a player the "Depends on an injured player"
 * flag names, the flag says it instead: src/lib/tradeView.ts). A Finder card without steps can show "If they say no,
 * try:": the other trade (each tagged player with his tag in words after his name), which kind it is, its three numbers
 * in words (each kept on one line, the estimate's label apart), its own odds and weekly line as the card's (Phase 4c,
 * change 9), "Also shown as trade idea 6." when the list has it as a card of its own, its own "Message to send them"
 * with Copy, and its own "Open in Analyzer" (both named for screen readers). Review of Phase 4b: it sits after the
 * card's own reasons, message and "Open in Analyzer", just before the feedback buttons, so the card's flags, facts and
 * reasons read as the card's (they sat under a Plan B that didn't include their player). The feedback buttons get the
 * card's versions (FeedbackControls asks which one was sent when there are two).
 * Under "You get 142 ROS pts, give 118", a line when my starting lineup moves the other way from those points (a backup
 * given away scores nothing for me). The roster moves the trade forces include Phase 4b's IR slots and returns.
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
 * It's an <article> named by its heading; the heading level is the page's to choose.
 */
import Link from "next/link";
import { Fragment, useId } from "react";
import type { FeedbackSaveResult } from "@/lib/feedbackShare";
import type { FeedbackChange } from "@/lib/feedbackStore";
import type { AssetView, CardFeedback, DetailsView, InjuryTone, NumberView, OddsView, PlanBView, StepsView, TradeCardView, WeeklyLineView } from "@/lib/tradeView";
import { CopyButton } from "../CopyButton";
import { HarderToGetBadge } from "../league/HarderToGetBadge";
import { ValuesCredit } from "../league/ValuesCredit";
import { buttonClass, cx } from "../ui";
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

/**
 * My odds before and after the trade, next to the three numbers: each odds kept on one line (it wraps between them on a
 * 320 px phone), the arrow said as "from … to" to screen readers; then the weeks whose win chance moves, each kept whole.
 */
function OddsLines({ odds, weekly }: { odds: OddsView[]; weekly: WeeklyLineView | null }) {
  return (
    <div className="mt-2 space-y-0.5 text-sm">
      {odds.length ? (
        <p>
          {odds.map((o, i) => (
            <Fragment key={o.label}>
              {i > 0 ? <span aria-hidden>{SEP}</span> : null}
              {i > 0 ? <span className="sr-only">, </span> : null}
              <span className="whitespace-nowrap">
                <span className="font-semibold">{o.label}</span>{" "}
                {o.srValue === o.value ? (
                  <span className="tabular-nums">{o.value}</span>
                ) : (
                  <>
                    <span aria-hidden className="tabular-nums">
                      {o.value}
                    </span>
                    <span className="sr-only">{o.srValue}</span>
                  </>
                )}
              </span>
            </Fragment>
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
    </div>
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

/** "How to offer it": the first offer, then what to add if they say no, each with its estimate. */
function Steps({ steps }: { steps: StepsView }) {
  return (
    <div className="mt-3 rounded-xl border border-line px-3 py-2">
      <p className="text-sm font-bold">{steps.heading}</p>
      <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm leading-relaxed">
        {steps.items.map((s) => (
          <li key={s.lead} className="break-words">
            <span className="font-semibold">{s.lead}</span> {s.what}
            <span aria-hidden>{SEP}</span>
            <span className="sr-only">, </span>
            <span aria-hidden className="font-semibold">
              <span className="whitespace-nowrap tabular-nums">{s.est}</span>
              {s.through ? `, ${s.through}` : null}
            </span>
            <span className="sr-only">{s.acceptSr}</span>
          </li>
        ))}
      </ol>
    </div>
  );
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
 * "If they say no, try:" (Plan B): the other trade in words (tags after the names), which kind it is, its three numbers
 * (each kept on one line, the estimate's label apart, so nothing breaks inside "(Est. · Likely)" on a 375 px phone; the
 * chance it goes through when a veto could cut it), its own odds and weekly line laid out as the card's (OddsLines;
 * Phase 4c, change 9: none when the Plan B carries no odds), whether the list shows it as an idea of its own, its own
 * message to send them and its own "Open in Analyzer", both named for screen readers by the card.
 */
function PlanBBox({ planB, name, showLink, onOpen }: { planB: PlanBView; name: string; showLink: boolean; onOpen?: ((href: string) => void) | undefined }) {
  const which = `if they say no, try: ${planB.give} for ${planB.get}; ${name}`;
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
   * whether an anonymous copy is on its way (Phase 7a: the card's one-time note, FeedbackControls).
   */
  onFeedback: (change: FeedbackChange) => FeedbackSaveResult | Promise<FeedbackSaveResult>;
  /** "Open in Analyzer" (the Finder's cards; Plan B's too). */
  showAnalyzerLink?: boolean;
  /**
   * Called with the link's address when an "Open in Analyzer" is used (the card's or its Plan B's): the Finder remembers
   * the idea and the link, to bring that link back into view on return.
   */
  onOpenAnalyzer?: ((href: string) => void) | undefined;
}

export function TradeCard({ card, rank, headingLevel = "h3", feedback, onFeedback, showAnalyzerLink = true, onOpenAnalyzer }: TradeCardProps) {
  const headingId = useId();
  const Heading = headingLevel;
  const n = card.numbers;
  // Several ideas can be with the same team: buttons name their card by its place too.
  const name = rank ? `trade idea ${rank}, ${card.heading}` : card.heading;
  return (
    <article aria-labelledby={headingId} className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
      {rank ? <p className="text-xs font-bold tracking-wider text-brand uppercase">Trade idea {rank}</p> : null}
      <Heading id={headingId} className="text-lg leading-tight font-extrabold tracking-tight wrap-anywhere">
        {card.heading}
      </Heading>

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
      <OddsLines odds={card.odds} weekly={card.weekly} />
      {card.steps ? <Steps steps={card.steps} /> : null}

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
          <p className="font-bold">Roster moves this trade forces</p>
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

      {card.pitch ? <Message text={card.pitch} name={name} className="mt-3" /> : null}

      {showAnalyzerLink ? (
        <div className="mt-3">
          <Link href={card.analyzerHref} prefetch={false} onClick={onOpenAnalyzer ? () => onOpenAnalyzer(card.analyzerHref) : undefined} className={cx(buttonClass("secondary", "sm"), "min-h-11")}>
            Open in Analyzer<span className="sr-only"> ({name})</span>
          </Link>
        </div>
      ) : null}

      {/* After the card's own content (review of Phase 4b: its flags read as the Plan B's when they sat under it). */}
      {card.planB ? <PlanBBox planB={card.planB} name={name} showLink={showAnalyzerLink} onOpen={onOpenAnalyzer} /> : null}

      <FeedbackControls feedback={feedback} onChange={onFeedback} tradeName={name} versions={card.versions} />
    </article>
  );
}
