"use client";
/**
 * A trade card's feedback (CLAUDE.md §11 "Feedback on every suggestion", Phase 4: local only; lead decision L12):
 * the outcome buttons Sent, Accepted, Rejected and Countered (toggle buttons: pressing the one that's on clears it),
 * and Report, which opens its reasons (Doesn't help me · They'd never accept · Player info is wrong · League settings
 * look wrong · Other) and an optional note. Each press is saved at once in this browser through
 * src/lib/feedbackStore.ts (the page's `onChange` calls saveTradeFeedback), with the card's numbers as they were
 * shown; a saved report reads back as "Reported: …" with Undo.
 *
 * Accessibility: the outcome buttons are a labeled group of toggle buttons (aria-pressed), the pressed one marked by
 * a ring and a check mark, not color alone; the report's reasons are a fieldset of native radios. Every target is
 * at least 44 px tall. What a press did is announced by one status line that stays mounted, and a failed save is an
 * alert. When a press takes away the control just used, focus moves to what took its place: Report → the reasons'
 * legend; Cancel → Report; Save report → the "Reported" line; Undo → Report.
 */
import { useEffect, useId, useRef, useState } from "react";
import { FEEDBACK_NOTE_MAX, FEEDBACK_OUTCOMES, FEEDBACK_REASONS, OUTCOME_LABEL, REASON_LABEL, type FeedbackChange, type FeedbackReason } from "@/lib/feedbackStore";
import type { SaveResult } from "@/lib/importStore";
import type { CardFeedback } from "@/lib/tradeView";
import { revealResult } from "../reveal";
import { Callout, FOCUS_TARGET, buttonClass, cx, inputClass } from "../ui";

export interface FeedbackControlsProps {
  /** What's saved for this trade idea. */
  feedback: CardFeedback;
  /** Saves one press (the page: saveTradeFeedback with the league's key and the evaluation). */
  onChange: (change: FeedbackChange) => SaveResult;
  /** The trade's heading, to name the groups for screen readers ("Trade with Gravel Gophers"). */
  tradeName: string;
}

/** Where focus goes after a press that took the control away. */
type FocusTo = "legend" | "report" | "reported";

const TOGGLE = "relative min-h-11 px-3 text-sm";
const PRESSED = "bg-brand-soft ring-2 ring-brand";

export function FeedbackControls({ feedback, onChange, tradeName }: FeedbackControlsProps) {
  const groupId = useId();
  const noteId = useId();
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<FeedbackReason | null>(null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ n: number; to: FocusTo } | null>(null);
  const legendRef = useRef<HTMLLegendElement>(null);
  const reportRef = useRef<HTMLButtonElement>(null);
  const reportedRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!focus) return;
    revealResult(focus.to === "legend" ? legendRef.current : focus.to === "report" ? reportRef.current : reportedRef.current);
  }, [focus]);
  const moveFocus = (to: FocusTo) => setFocus((f) => ({ n: (f?.n ?? 0) + 1, to }));

  function save(change: FeedbackChange, done: string): boolean {
    const saved = onChange(change);
    if (!saved.ok) {
      setError(saved.message);
      setStatus("");
      return false;
    }
    setError(null);
    setStatus(done);
    return true;
  }

  function pressOutcome(kind: (typeof FEEDBACK_OUTCOMES)[number]) {
    const on = feedback.outcome !== kind;
    save({ outcome: on ? kind : null }, on ? `Saved: ${OUTCOME_LABEL[kind]}.` : `Cleared: ${OUTCOME_LABEL[kind]}.`);
  }

  function submitReport() {
    if (!reason) return;
    if (save({ report: { reason, note } }, `Saved your report: ${REASON_LABEL[reason]}.`)) {
      setReporting(false);
      setReason(null);
      setNote("");
      moveFocus("reported");
    }
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      <p id={groupId} className="text-sm font-bold">
        What happened with it?
      </p>
      <div role="group" aria-labelledby={groupId} className="mt-2 flex flex-wrap gap-2">
        {FEEDBACK_OUTCOMES.map((kind) => {
          const pressed = feedback.outcome === kind;
          return (
            <button key={kind} type="button" aria-pressed={pressed} onClick={() => pressOutcome(kind)} className={cx(buttonClass("secondary", "sm"), TOGGLE, pressed && PRESSED)}>
              {pressed ? <span aria-hidden>✓</span> : null}
              {OUTCOME_LABEL[kind]}
              <span className="sr-only"> ({tradeName})</span>
            </button>
          );
        })}
      </div>

      {feedback.report ? (
        <p ref={reportedRef} tabIndex={FOCUS_TARGET.tabIndex} className={cx("mt-3 flex flex-wrap items-center gap-x-2 text-sm", FOCUS_TARGET.className)}>
          <span className="min-w-0 break-words">
            <span className="font-bold">Reported:</span> {REASON_LABEL[feedback.report.reason]}
            {feedback.report.note ? <span className="text-muted"> · “{feedback.report.note}”</span> : null}
          </span>
          <button
            type="button"
            onClick={() => {
              if (save({ report: null }, "Report removed.")) moveFocus("report");
            }}
            className={cx(buttonClass("ghost", "sm"), "min-h-11")}
          >
            Undo<span className="sr-only"> the report on {tradeName}</span>
          </button>
        </p>
      ) : reporting ? (
        <form
          className="mt-3 rounded-xl border border-line p-3"
          onSubmit={(event) => {
            event.preventDefault();
            submitReport();
          }}
        >
          <fieldset>
            <legend ref={legendRef} tabIndex={FOCUS_TARGET.tabIndex} className={cx("text-sm font-bold", FOCUS_TARGET.className)}>
              What&apos;s wrong with this trade idea?
            </legend>
            <div className="mt-1 grid gap-0.5">
              {FEEDBACK_REASONS.map((r) => (
                <label key={r} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-surface-muted">
                  <input type="radio" name={`${groupId}-reason`} value={r} checked={reason === r} onChange={() => setReason(r)} className="size-5 shrink-0 accent-brand" />
                  <span className="min-w-0 break-words">{REASON_LABEL[r]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label htmlFor={noteId} className="mt-2 block text-sm font-semibold">
            Note (optional)
          </label>
          <textarea id={noteId} value={note} maxLength={FEEDBACK_NOTE_MAX} rows={2} onChange={(e) => setNote(e.target.value)} className={cx(inputClass, "mt-1")} />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="submit" aria-disabled={!reason || undefined} className={cx(buttonClass("primary", "sm"), "min-h-11", !reason && "opacity-60")}>
              Save report
            </button>
            <button
              type="button"
              onClick={() => {
                setReporting(false);
                setReason(null);
                setNote("");
                moveFocus("report");
              }}
              className={cx(buttonClass("secondary", "sm"), "min-h-11")}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          ref={reportRef}
          type="button"
          aria-expanded={false}
          onClick={() => {
            setReporting(true);
            setStatus("");
            moveFocus("legend");
          }}
          className={cx(buttonClass("ghost", "sm"), "mt-2 min-h-11")}
        >
          Report a problem<span className="sr-only"> with {tradeName}</span>
        </button>
      )}

      {/* Always mounted, so each press is announced. */}
      <p role="status" className={status ? "mt-2 text-sm font-semibold" : "sr-only"}>
        {status}
      </p>
      {error ? (
        <div className="mt-2">
          <Callout tone="danger" role="alert">
            {error}
          </Callout>
        </div>
      ) : null}
    </div>
  );
}
