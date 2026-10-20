/**
 * The trade search's progress bar (Phase 4 wave 2 decisions M13 and M14): the stage in plain words and how far it
 * is ("Screening trade ideas · 120 of 480"), a bar (role="progressbar", its value in words through
 * aria-valuetext), and Stop. The page's own status line announces each new stage; the bar's numbers are there for
 * whoever looks (a live region that changed every few milliseconds would drown a screen reader). Phase 4c: a re-filter
 * (the minimum chance changed) shows here too, the whole bar for its ranking (src/lib/tradeView.ts progressView).
 * Checkpoint 7h (the review of its page, thoroughui#2): under the bar, how long it takes says which search runs: a Thorough
 * search's own estimate, the one its switch gave before it started (searchTimeNote), else the usual few seconds.
 */
import type { Ref } from "react";
import type { ProgressView } from "@/lib/tradeView";
import { buttonClass, cx } from "../ui";

/**
 * The line under the bar: a Thorough search's estimate (`thoroughSeconds`: the switch's "about N seconds", engine thorough.ts
 * thoroughSeconds) while one runs, else the usual search's few seconds (a re-filter's too: it only ranks again).
 */
export function searchTimeNote(thoroughSeconds?: number | null): string {
  return typeof thoroughSeconds === "number" && Number.isFinite(thoroughSeconds) && thoroughSeconds > 0
    ? `This runs in your browser. A Thorough search takes about ${thoroughSeconds} seconds; on a phone it can take longer.`
    : "This runs in your browser. It usually takes a few seconds; on a phone it can take longer.";
}

export function SearchProgress({
  view,
  onStop,
  stopRef,
  thoroughSeconds,
}: {
  view: ProgressView;
  onStop: () => void;
  stopRef?: Ref<HTMLButtonElement> | undefined;
  /** While a Thorough search runs: about how many seconds it takes (searchTimeNote); absent: the usual search. */
  thoroughSeconds?: number | null | undefined;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="min-w-0 text-sm font-bold break-words" aria-hidden>
          {view.label}
          {view.detail ? <span className="font-semibold text-muted tabular-nums"> · {view.detail}</span> : null}
        </p>
        <button ref={stopRef} type="button" onClick={onStop} className={cx(buttonClass("secondary", "sm"), "min-h-11")}>
          Stop
        </button>
      </div>
      <div
        role="progressbar"
        aria-label="Trade search progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={view.percent}
        aria-valuetext={view.valueText}
        className="mt-3 h-3 overflow-hidden rounded-full bg-surface-muted"
      >
        <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${view.percent}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted">{searchTimeNote(thoroughSeconds)}</p>
    </div>
  );
}
