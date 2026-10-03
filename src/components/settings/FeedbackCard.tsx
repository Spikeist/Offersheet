"use client";
/**
 * "Your trade feedback" on the Settings page (CLAUDE.md §11 "Feedback on every suggestion", Phase 4: local
 * only; §14 item 6 "Export feedback"): how many trade ideas have feedback saved in this browser, "Export
 * feedback" (a JSON file, src/lib/feedbackStore.ts: leagues numbered, no names), and "Delete saved feedback"
 * behind a second step. It needs no league: feedback from every league is kept together.
 *
 * Keyboard focus: each step of Delete takes away the button just pressed, which would drop focus to the
 * page, so focus moves to what took its place (deleteStep): "Delete saved feedback" → the confirmation's
 * question (it says what will go; the confirmation is a group named by it); "Keep it" → "Delete saved
 * feedback" again; "Yes, delete it" → the status line saying it's done, or, when the browser refused,
 * "Delete saved feedback" again, with an alert saying why. FeedbackCardView is the card in each state (no
 * state of its own, so tests render it); FeedbackCard holds the state and moves focus.
 */
import { useEffect, useId, useRef, useState, type Ref } from "react";
import { feedbackExportFileName } from "@/lib/feedbackStore";
import { plural } from "@/lib/format";
import { revealResult } from "../reveal";
import { Callout, Card, CardTitle, FOCUS_TARGET, buttonClass, cx } from "../ui";
import { deleteSavedFeedback, downloadFeedback, useFeedbackRecords } from "./useFeedback";

/** The card's words for a count (undefined while the browser's storage is read). */
export function feedbackCountText(count: number | undefined): string {
  if (count === undefined) return "Checking this browser…";
  if (count === 0) return "Nothing saved yet.";
  return `${plural(count, "trade idea")} with feedback saved in this browser.`;
}

/** A step of "Delete saved feedback": asking, keeping it, deleted, or the browser refused to delete. */
export type DeleteStep = "ask" | "keep" | "deleted" | "failed";
/** What takes focus after a step: the confirmation's question, "Delete saved feedback", or the status line. */
export type DeleteFocus = "question" | "delete" | "status";

/** After each step: whether the confirmation shows, and where focus goes (the button pressed is gone). */
export function deleteStep(step: DeleteStep): { confirming: boolean; focus: DeleteFocus } {
  switch (step) {
    case "ask":
      return { confirming: true, focus: "question" };
    case "keep":
      return { confirming: false, focus: "delete" };
    case "deleted":
      return { confirming: false, focus: "status" };
    case "failed":
      return { confirming: false, focus: "delete" };
  }
}

export interface FeedbackNote {
  tone: "ok" | "error";
  text: string;
}

export interface FeedbackCardViewProps {
  /** Trade ideas with feedback; undefined while the browser's storage is read. */
  count: number | undefined;
  confirming: boolean;
  note: FeedbackNote | null;
  onExport: () => void;
  onAsk: () => void;
  onKeep: () => void;
  onDelete: () => void;
  /** The elements focus moves to (deleteStep). */
  refs?: { delete?: Ref<HTMLButtonElement>; question?: Ref<HTMLParagraphElement>; status?: Ref<HTMLParagraphElement> };
}

/** The card in one state (FeedbackCard holds the state). */
export function FeedbackCardView({ count, confirming, note, onExport, onAsk, onKeep, onDelete, refs }: FeedbackCardViewProps) {
  const questionId = useId();
  return (
    <Card id="feedback">
      <CardTitle eyebrow="Feedback">Your trade feedback</CardTitle>
      <p className="text-sm leading-relaxed text-muted">
        On each trade idea you can mark what happened (Sent, Accepted, Rejected or Countered) or report a problem with it. Offer Sheet keeps that in this browser
        only, with the trade&apos;s numbers, so you can export it and help improve the estimates. Nothing is sent anywhere.
      </p>
      <p className="mt-3 font-semibold">{feedbackCountText(count)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onExport} disabled={!count} className={buttonClass("primary")}>
          Export feedback
        </button>
        {count && !confirming ? (
          <button ref={refs?.delete} type="button" onClick={onAsk} className={buttonClass("danger")}>
            Delete saved feedback
          </button>
        ) : null}
      </div>
      {count && confirming ? (
        <div role="group" aria-labelledby={questionId} className="mt-3 rounded-xl border border-danger-line p-3">
          <p ref={refs?.question} id={questionId} tabIndex={FOCUS_TARGET.tabIndex} className={cx("text-sm font-bold", FOCUS_TARGET.className)}>
            Delete the feedback on {plural(count, "trade idea")}? You can&apos;t undo this.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={onDelete} className={cx(buttonClass("danger", "sm"), "min-h-11")}>
              Yes, delete it
            </button>
            <button type="button" onClick={onKeep} className={cx(buttonClass("secondary", "sm"), "min-h-11")}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}
      {/* Always mounted, so each outcome is announced; focus moves here once the feedback is deleted. */}
      <p
        ref={refs?.status}
        role="status"
        tabIndex={FOCUS_TARGET.tabIndex}
        className={cx("mt-2 text-sm", note?.tone === "ok" ? "font-semibold" : "sr-only", FOCUS_TARGET.className)}
      >
        {note?.tone === "ok" ? note.text : ""}
      </p>
      {note?.tone === "error" ? (
        <Callout tone="danger" role="alert">
          {note.text}
        </Callout>
      ) : null}
      <p className="mt-3 text-xs text-muted">
        The file holds player and team ID numbers and Offer Sheet&apos;s numbers for each trade, plus any notes you typed. It has no names, and it numbers your
        leagues (league-1, league-2) rather than saying which they are.
      </p>
    </Card>
  );
}

export function FeedbackCard() {
  const records = useFeedbackRecords();
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<FeedbackNote | null>(null);
  // Where focus goes once the step's render is on screen (n: every step moves it, even to the same place).
  const [reveal, setReveal] = useState<{ n: number; focus: DeleteFocus } | null>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const count = records?.length;

  useEffect(() => {
    if (!reveal) return;
    revealResult(reveal.focus === "question" ? questionRef.current : reveal.focus === "delete" ? deleteRef.current : statusRef.current);
  }, [reveal]);

  function go(step: DeleteStep) {
    const next = deleteStep(step);
    setConfirming(next.confirming);
    setReveal((r) => ({ n: (r?.n ?? 0) + 1, focus: next.focus }));
  }

  function exportNow() {
    if (!records?.length) return;
    const now = new Date();
    try {
      downloadFeedback(records, now);
      setNote({ tone: "ok", text: `Downloaded ${feedbackExportFileName(now.toISOString())}.` });
    } catch {
      setNote({ tone: "error", text: "Your browser wouldn't start the download. Try again, or try another browser." });
    }
  }

  function deleteNow() {
    const done = deleteSavedFeedback();
    setNote(done.ok ? { tone: "ok", text: "Deleted. No feedback is saved in this browser now." } : { tone: "error", text: done.message });
    go(done.ok ? "deleted" : "failed");
  }

  return (
    <FeedbackCardView
      count={count}
      confirming={confirming}
      note={note}
      onExport={exportNow}
      onAsk={() => go("ask")}
      onKeep={() => go("keep")}
      onDelete={deleteNow}
      refs={{ delete: deleteRef, question: questionRef, status: statusRef }}
    />
  );
}
