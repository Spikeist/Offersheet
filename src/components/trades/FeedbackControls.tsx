"use client";
/**
 * A trade card's feedback (CLAUDE.md §11 "Feedback on every suggestion", Phase 4: local only; lead decision L12):
 * the outcome buttons Sent, Accepted, Rejected and Countered (toggle buttons: pressing the one that's on clears it),
 * and Report, which opens its reasons (Doesn't help me · They'd never accept · Player info is wrong · League settings
 * look wrong · Other) and an optional note. Each press is saved at once in this browser through
 * src/lib/feedbackStore.ts (the page's `onChange` calls saveTradeFeedback), with the card's numbers as they were
 * shown; a saved report reads back as "Reported: …" with Undo.
 *
 * Which version was sent (planner reply to Checkpoint 4, change 6 and answer 8): a card can show two versions of the
 * trade (the first offer and the full one of "How to offer it"; the trade and its "If they say no, try:"). While none is
 * recorded, the first outcome pressed on such a card asks which one ("Which version did you send?", worded for the
 * outcome: "did they accept?" …), one 44 px button per version and Cancel; the choice is saved with the outcome
 * (feedbackStore.ts: the version, its key and its estimate). A plain card's one version is saved without asking. Once
 * recorded, later outcomes keep it, and a line under the buttons says which version it was (src/lib/tradeView.ts
 * versionLine: by its key, so after a refresh changed the card's Plan B or throw-in, or on the Analyzer's card for the
 * same trade, it reads "an earlier one" with that trade's players, never the version shown now); clearing the outcome
 * clears it.
 *
 * Accessibility: the outcome buttons are a labeled group of toggle buttons (aria-pressed), the pressed one marked by
 * a ring and a check mark, not color alone; the report's reasons are a fieldset of native radios, the version choice a
 * fieldset of buttons. Every target is at least 44 px tall. What a press did is announced by one status line that
 * stays mounted, and a failed save is an alert. When a press takes away the control just used, focus moves to what took
 * its place: Report → the reasons' legend; Cancel → Report; Save report → the "Reported" line; Undo → Report; an outcome
 * that asks → the choice's legend; a version chosen, or Cancel there → the outcome button pressed.
 */
import { useEffect, useId, useRef, useState, type Ref } from "react";
import { FEEDBACK_NOTE_MAX, FEEDBACK_OUTCOMES, FEEDBACK_REASONS, OUTCOME_LABEL, REASON_LABEL, type FeedbackChange, type FeedbackOutcome, type FeedbackReason, type FeedbackSent } from "@/lib/feedbackStore";
import type { SaveResult } from "@/lib/importStore";
import { versionLine, type CardFeedback, type VersionChoice } from "@/lib/tradeView";
import { revealResult } from "../reveal";
import { Callout, FOCUS_TARGET, buttonClass, cx, inputClass } from "../ui";

export interface FeedbackControlsProps {
  /** What's saved for this trade idea. */
  feedback: CardFeedback;
  /** Saves one press (the page: saveTradeFeedback with the league's key and the evaluation). */
  onChange: (change: FeedbackChange) => SaveResult;
  /** The trade's heading, to name the groups for screen readers ("Trade with Gravel Gophers"). */
  tradeName: string;
  /**
   * The versions the card shows (TradeCardView.versions, src/lib/tradeView.ts): two → the first outcome asks which one
   * was sent; one → it's saved with the outcome; none (absent) → no version is saved.
   */
  versions?: readonly VersionChoice[] | undefined;
}

/** Where focus goes after a press that took the control away. */
type FocusTo = "legend" | "report" | "reported" | "chooser" | FeedbackOutcome;

const TOGGLE = "relative min-h-11 px-3 text-sm";
const PRESSED = "bg-brand-soft ring-2 ring-brand";

/** The version choice's question, by the outcome pressed. */
export const VERSION_QUESTION: Record<FeedbackOutcome, string> = {
  sent: "Which version did you send?",
  accepted: "Which version did they accept?",
  rejected: "Which version did they turn down?",
  countered: "Which version did they counter?",
};

const sentOf = (v: VersionChoice): FeedbackSent => ({ version: v.version, key: v.key, pAccept: v.pAccept, pComplete: v.pComplete });

/**
 * What pressing an outcome button does (the file header), pure: clear it when it's the one on; else ask which version
 * was sent when none is recorded and the card shows two or more; else save it, with the card's only version when none is
 * recorded yet (a recorded one stays).
 */
export function outcomeAction(
  feedback: Pick<CardFeedback, "outcome" | "version">,
  versions: readonly VersionChoice[],
  kind: FeedbackOutcome,
): { action: "clear"; change: FeedbackChange } | { action: "ask" } | { action: "save"; change: FeedbackChange } {
  if (feedback.outcome === kind) return { action: "clear", change: { outcome: null } };
  if (feedback.version === null && versions.length > 1) return { action: "ask" };
  const only = feedback.version === null && versions.length === 1 ? versions[0] : undefined;
  return { action: "save", change: only ? { outcome: kind, sent: sentOf(only) } : { outcome: kind } };
}

/** The press saved once a version is chosen (the version choice's buttons). */
export function chosenVersionChange(kind: FeedbackOutcome, v: VersionChoice): FeedbackChange {
  return { outcome: kind, sent: sentOf(v) };
}

/**
 * "Which version did you send?" (worded for the outcome pressed): a fieldset with one button per version the card shows
 * (44 px, full width on a phone, wrapping its words) and Cancel; its legend can take focus.
 */
export function VersionChooser({
  kind,
  versions,
  tradeName,
  legendRef,
  onChoose,
  onCancel,
}: {
  kind: FeedbackOutcome;
  versions: readonly VersionChoice[];
  tradeName: string;
  legendRef?: Ref<HTMLLegendElement> | undefined;
  onChoose: (v: VersionChoice) => void;
  onCancel: () => void;
}) {
  return (
    <fieldset className="mt-3 rounded-xl border border-line p-3">
      <legend ref={legendRef} tabIndex={FOCUS_TARGET.tabIndex} className={cx("text-sm font-bold", FOCUS_TARGET.className)}>
        {VERSION_QUESTION[kind]}
        <span className="sr-only"> ({tradeName})</span>
      </legend>
      <div className="mt-1 grid gap-2 sm:flex sm:flex-wrap">
        {versions.map((v) => (
          <button key={v.version} type="button" onClick={() => onChoose(v)} className={cx(buttonClass("secondary", "sm"), "h-auto min-h-11 justify-start py-2 text-left break-words")}>
            {v.label}
          </button>
        ))}
        <button type="button" onClick={onCancel} className={cx(buttonClass("ghost", "sm"), "min-h-11")}>
          Cancel
        </button>
      </div>
    </fieldset>
  );
}

export function FeedbackControls({ feedback, onChange, tradeName, versions = [] }: FeedbackControlsProps) {
  const groupId = useId();
  const noteId = useId();
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<FeedbackReason | null>(null);
  const [note, setNote] = useState("");
  // An outcome waiting for its version (the choice is open).
  const [choosing, setChoosing] = useState<FeedbackOutcome | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ n: number; to: FocusTo } | null>(null);
  const legendRef = useRef<HTMLLegendElement>(null);
  const reportRef = useRef<HTMLButtonElement>(null);
  const reportedRef = useRef<HTMLParagraphElement>(null);
  const chooserRef = useRef<HTMLLegendElement>(null);
  const outcomeRefs = useRef<Partial<Record<FeedbackOutcome, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (!focus) return;
    const to = focus.to;
    const target =
      to === "legend" ? legendRef.current : to === "report" ? reportRef.current : to === "reported" ? reportedRef.current : to === "chooser" ? chooserRef.current : (outcomeRefs.current[to] ?? null);
    revealResult(target);
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

  function pressOutcome(kind: FeedbackOutcome) {
    const next = outcomeAction(feedback, versions, kind);
    if (next.action === "clear") {
      setChoosing(null);
      save(next.change, `Cleared: ${OUTCOME_LABEL[kind]}.`);
    } else if (next.action === "ask") {
      // Which version was sent: asked once, while none is recorded, when the card shows two.
      setChoosing(kind);
      setStatus("");
      moveFocus("chooser");
    } else {
      save(next.change, `Saved: ${OUTCOME_LABEL[kind]}.`);
    }
  }

  function chooseVersion(v: VersionChoice) {
    if (!choosing) return;
    const kind = choosing;
    if (save(chosenVersionChange(kind, v), `Saved: ${OUTCOME_LABEL[kind]} (${v.label}).`)) {
      setChoosing(null);
      moveFocus(kind);
    }
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

  const recorded = versionLine(feedback, versions);

  return (
    <div className="mt-4 border-t border-line pt-3">
      <p id={groupId} className="text-sm font-bold">
        What happened with it?
      </p>
      <div role="group" aria-labelledby={groupId} className="mt-2 flex flex-wrap gap-2">
        {FEEDBACK_OUTCOMES.map((kind) => {
          const pressed = feedback.outcome === kind;
          return (
            <button
              key={kind}
              ref={(el) => {
                outcomeRefs.current[kind] = el;
              }}
              type="button"
              aria-pressed={pressed}
              onClick={() => pressOutcome(kind)}
              className={cx(buttonClass("secondary", "sm"), TOGGLE, pressed && PRESSED)}
            >
              {pressed ? <span aria-hidden>✓</span> : null}
              {OUTCOME_LABEL[kind]}
              <span className="sr-only"> ({tradeName})</span>
            </button>
          );
        })}
      </div>
      {recorded ? (
        <p className="mt-2 text-sm break-words text-muted">
          <span className="font-semibold">Version:</span> {recorded}
        </p>
      ) : null}

      {choosing ? (
        <VersionChooser
          kind={choosing}
          versions={versions}
          tradeName={tradeName}
          legendRef={chooserRef}
          onChoose={chooseVersion}
          onCancel={() => {
            const kind = choosing;
            setChoosing(null);
            moveFocus(kind);
          }}
        />
      ) : null}

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
