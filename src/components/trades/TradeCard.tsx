"use client";
/**
 * One trade idea (CLAUDE.md §13 "Each trade card shows"; §10's three numbers; §11's "Est." and labels; Phase 4 wave 2
 * decision M13), laid out from its view model (src/lib/tradeView.ts buildTradeCard), mobile-first (375 px):
 * - the partner, then You give / You get (each player with position, NFL team and an injury tag in words);
 * - the three numbers side by side: Helps you, Chance they accept (with "Est." and its label; the chance it goes
 *   through when the league's review could veto it), Overall;
 * - the risk flags apart from the numbers, each saying what it is in words (not color alone);
 * - "You get 142 ROS pts, give 118", the numbers behind the score in words, with the trade values' "Values:
 *   FantasyCalc" link beside them (§2.9), and any roster moves the trade forces;
 * - the reasons, the pitch message (opened on demand) with Copy, "Open in Analyzer" (the Finder's cards), and the
 *   feedback buttons (FeedbackControls). "Open in Analyzer" carries the trade's ids in its address, so it's never
 *   prefetched: the server sees that address only when the user opens it (the privacy page says so). Using it tells
 *   the Finder which idea to bring back into view when the user comes back (onOpenAnalyzer; finderMemory.ts).
 * Planner addendum to Checkpoint 3: a player I'd get whom his manager values above market carries a gold "Harder to
 * get" pill in words (why on hover, and said in full to screen readers: a title alone isn't reliably read); a trade
 * with steps shows "How to offer it" right under the three numbers, an ordered list ("Offer first: … · Est. 35%", "If
 * they say no, add … · Est. 55%"), each estimate said in full to screen readers. Both pages explain the two under the
 * cards (HowToRead.tsx).
 * It's an <article> named by its heading; the heading level is the page's to choose.
 */
import Link from "next/link";
import { useId } from "react";
import type { FeedbackChange } from "@/lib/feedbackStore";
import type { SaveResult } from "@/lib/importStore";
import type { AssetView, CardFeedback, NumberView, StepsView, TradeCardView } from "@/lib/tradeView";
import { CopyButton } from "../CopyButton";
import { HarderToGetBadge } from "../league/HarderToGetBadge";
import { ValuesCredit } from "../league/ValuesCredit";
import { Badge, buttonClass, cx } from "../ui";
import { FeedbackControls } from "./FeedbackControls";

const INJURY_BADGE = { muted: "muted", warn: "warn", danger: "danger" } as const;

function AssetList({ title, assets }: { title: string; assets: AssetView[] }) {
  return (
    <div className="min-w-0">
      <h4 className="text-xs font-bold tracking-wider text-muted uppercase">{title}</h4>
      {assets.length ? (
        <ul className="mt-1 space-y-1">
          {assets.map((a) => (
            <li key={a.id} className="min-w-0">
              <span className="font-extrabold break-words">{a.name}</span>{" "}
              {a.injury ? (
                <Badge tone={INJURY_BADGE[a.injury.tone]} className="align-middle">
                  <span aria-hidden>{a.injury.short}</span>
                  <span className="sr-only">{a.injury.long}</span>
                </Badge>
              ) : null}
              {a.tag ? <HarderToGetBadge tag={a.tag} className={a.injury ? "ml-1" : undefined} describe /> : null}
              {a.detail ? <span className="block text-xs text-muted">{a.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted">Nothing</p>
      )}
    </div>
  );
}

function Score({ label, number, sub }: { label: string; number: NumberView; sub?: string | undefined }) {
  return (
    <div className="flex min-w-0 flex-col-reverse justify-end rounded-xl bg-surface-muted px-1.5 py-2 text-center">
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

/** "How to offer it": the first offer, then what to add if they say no, each with its estimate. */
function Steps({ steps }: { steps: StepsView }) {
  return (
    <div className="mt-3 rounded-xl border border-line px-3 py-2">
      <p className="text-sm font-bold">{steps.heading}</p>
      <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm leading-relaxed">
        {steps.items.map((s) => (
          <li key={s.lead} className="break-words">
            <span className="font-semibold">{s.lead}</span> {s.what}
            <span aria-hidden> · </span>
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

export interface TradeCardProps {
  card: TradeCardView;
  /** Its place in the list (1 = first), shown above the heading; omitted in the Analyzer. */
  rank?: number;
  headingLevel?: "h2" | "h3";
  feedback: CardFeedback;
  onFeedback: (change: FeedbackChange) => SaveResult;
  /** "Open in Analyzer" (the Finder's cards). */
  showAnalyzerLink?: boolean;
  /** Called when "Open in Analyzer" is used (the Finder remembers the idea, to bring it back into view on return). */
  onOpenAnalyzer?: (() => void) | undefined;
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

      <dl className="mt-4 grid grid-cols-3 gap-2">
        <Score label="Helps you" number={n.helps} />
        <Score label="Chance they accept" number={n.accept} sub={n.acceptLabel} />
        <Score label="Overall" number={n.overall} />
      </dl>
      {n.acceptNote ? <p className="mt-2 text-sm text-muted">{n.acceptNote}</p> : null}
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
      <dl className="mt-2 divide-y divide-line text-sm">
        {card.facts.map((f) => (
          <div key={f.label} className="grid gap-0.5 py-1.5 sm:grid-cols-[minmax(0,10rem)_1fr] sm:gap-3">
            <dt className="font-semibold text-muted">{f.label}</dt>
            <dd className="min-w-0 break-words">
              {f.value}
              {f.kind === "values" ? (
                <>
                  {" "}
                  · <ValuesCredit className="text-xs" />
                </>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>

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

      {card.pitch ? (
        <details className="mt-3 rounded-xl border border-line">
          <summary className="flex min-h-11 items-center justify-between gap-2 px-3 text-sm font-bold">
            <span>
              Message to send them<span className="sr-only"> ({name})</span>
            </span>
            <span aria-hidden className="text-muted">
              ▾
            </span>
          </summary>
          <div className="border-t border-line p-3">
            <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{card.pitch}</p>
            {/* CopyButton is a small button; the wrapper makes it a 44 px target. */}
            <div className="mt-2 [&>button]:min-h-11">
              <CopyButton text={card.pitch} />
            </div>
          </div>
        </details>
      ) : null}

      {showAnalyzerLink ? (
        <div className="mt-3">
          <Link href={card.analyzerHref} prefetch={false} onClick={onOpenAnalyzer} className={cx(buttonClass("secondary", "sm"), "min-h-11")}>
            Open in Analyzer<span className="sr-only"> ({name})</span>
          </Link>
        </div>
      ) : null}

      <FeedbackControls feedback={feedback} onChange={onFeedback} tradeName={name} />
    </article>
  );
}
