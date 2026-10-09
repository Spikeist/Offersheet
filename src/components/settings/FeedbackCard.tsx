"use client";
/**
 * "Your trade feedback" on the Settings page (CLAUDE.md §11 "Feedback on every suggestion", Phase 4: local
 * only; §14 item 6 "Export feedback"): how many trade ideas have feedback saved in this browser, "Export
 * feedback" (a JSON file, src/lib/feedbackStore.ts feedbackExport: since Checkpoint 7d what the user saw and entered, leagues
 * numbered, no names: EXPORT_TEXT), and "Delete saved feedback"
 * behind a second step. It needs no league: it counts, exports and deletes every saved league's feedback (Phase 4c:
 * the league store keeps each league's apart, src/lib/leagueStore.ts; useFeedback.ts useSavedFeedback), and says so
 * (⚠️ review of track ML: on a page that edits one league, "N trade ideas" read as that league's, and Delete took every
 * league's): the card covers all leagues, and the count and the question name how many leagues when there are several.
 * Deleting waits for the browser: the confirmation's buttons stay until it answers.
 *
 * Keyboard focus: each step of Delete takes away the button just pressed, which would drop focus to the
 * page, so focus moves to what took its place (deleteStep): "Delete saved feedback" → the confirmation's
 * question (it says what will go; the confirmation is a group named by it); "Keep it" → "Delete saved
 * feedback" again; "Yes, delete it" → the status line saying it's done, or, when the browser refused,
 * "Delete saved feedback" again, with an alert saying why. FeedbackCardView is the card in each state (no
 * state of its own, so tests render it); FeedbackCard holds the state and moves focus.
 *
 * Phase 7a (planner reply to Checkpoint 4c, Part B, B2; track FB): "Share anonymous feedback", a checkbox (on by default,
 * saved in this browser for every league: src/lib/feedbackShare.ts), with one sentence on what each anonymous copy holds
 * and never holds, and a link to the privacy policy, which lists it field by field. Unchecked, presses are still saved
 * here; nothing is sent. A choice the browser won't keep holds for the page and says so (an alert under the checkbox).
 * Delete's question says the anonymous copies already sent aren't affected (review FB-R3).
 */
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type Ref } from "react";
import { feedbackExportFileName } from "@/lib/feedbackStore";
import { plural } from "@/lib/format";
import { revealResult } from "../reveal";
import { Callout, Card, CardTitle, FOCUS_TARGET, buttonClass, cx } from "../ui";
import { deleteFeedback, downloadFeedback, setFeedbackSharing, useFeedbackSharing, useSavedFeedback } from "./useFeedback";

/** The sharing checkbox's label (pages.test.ts checks the Settings page has it: the privacy policy names it). */
export const SHARE_LABEL = "Share anonymous feedback";

/** What a copy holds and never holds, in one sentence (the privacy policy's list, shortened), before its link. */
export const SHARE_TEXT =
  "When it's on, each press also sends Offer Sheet an anonymous copy, to help improve it: what you pressed, the players as ID numbers, your league's format and Offer Sheet's numbers for the trade, never your league's ID, names, usernames or the notes you type. This choice is saved in this browser, for every league.";

/** The card's words for a count (undefined while the browser's storage is read), with how many leagues it spans. */
export function feedbackCountText(count: number | undefined, leagues = 1): string {
  if (count === undefined) return "Checking this browser…";
  if (count === 0) return "Nothing saved yet.";
  return `${plural(count, "trade idea")} with feedback saved in this browser${leagues > 1 ? `, across ${leagues} leagues` : ""}.`;
}

/** What Delete doesn't do (deleteQuestionText; review FB-R3): the anonymous copies already sent stay. */
export const DELETE_KEEPS_SENT = "Anonymous copies already sent aren't affected.";

/**
 * The confirmation's question: every league's feedback goes, so it says so when there are several; and the anonymous
 * copies already sent aren't taken back (the privacy policy says how long they stay).
 */
export function deleteQuestionText(count: number, leagues = 1): string {
  const where = leagues > 2 ? ` in all ${leagues} leagues` : leagues === 2 ? " in both leagues" : "";
  return `Delete the feedback on ${plural(count, "trade idea")}${where}? You can't undo this. ${DELETE_KEEPS_SENT}`;
}

/** The card's scope, in its explanation (the page above it edits one league; this card doesn't). */
export const FEEDBACK_SCOPE_TEXT = "This card covers all your leagues in this browser together.";

/**
 * What the exported file holds (Checkpoint 7d; planner reply to Checkpoint 7c, answer 1: "export only what the user saw and
 * entered"; src/lib/feedbackStore.ts feedbackExport, version 3), in the feedback page's words for it (src/app/feedback/FeedbackGuide.tsx:
 * "what you saw and entered: each trade, the numbers on its card, your outcome, the version you sent and your notes"), with
 * what it holds as ID numbers, its days and what it never names. Its days are the record's first press and its latest outcome's
 * and report's (FeedbackExportEntry madeOn, outcome.on, report.on): a record keeps no earlier outcome's time, so the words
 * never say "each press" (review of track cards, cards-4). Until then it held "Offer Sheet's numbers for each trade"
 * and the random code each record's anonymous copies carry.
 */
export const EXPORT_TEXT =
  "The file holds what you saw and entered: each trade (its players and the other team as ID numbers), the numbers on its card, your outcome, the version you sent and your notes, with the day you first marked or reported each trade and the days of its latest outcome and report. Apart from what your notes say, it has no names, and it numbers your leagues (league-1, league-2) rather than saying which they are.";

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
  /** How many leagues that feedback is from (default 1). */
  leagues?: number;
  confirming: boolean;
  note: FeedbackNote | null;
  onExport: () => void;
  onAsk: () => void;
  onKeep: () => void;
  onDelete: () => void;
  /**
   * "Share anonymous feedback" (the header): whether it's on, what a change does, and why the browser wouldn't keep the
   * last change (or null). Absent: the checkbox isn't shown (tests of the card's other parts).
   */
  sharing?: { on: boolean; onChange: (on: boolean) => void; error: string | null } | undefined;
  /** The elements focus moves to (deleteStep). */
  refs?: { delete?: Ref<HTMLButtonElement>; question?: Ref<HTMLParagraphElement>; status?: Ref<HTMLParagraphElement> };
}

/** The sharing checkbox, its sentence and the privacy policy's link (the header). */
function SharingToggle({ on, onChange, error }: NonNullable<FeedbackCardViewProps["sharing"]>) {
  const textId = useId();
  return (
    <div className="mt-4 rounded-xl border border-line p-3">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 font-semibold">
        <input type="checkbox" checked={on} aria-describedby={textId} onChange={(e) => onChange(e.target.checked)} className="size-5 shrink-0 accent-brand" />
        <span>{SHARE_LABEL}</span>
      </label>
      <p id={textId} className="mt-1 text-sm leading-relaxed text-muted">
        {SHARE_TEXT} The{" "}
        <Link href="/privacy" className="font-semibold underline underline-offset-2">
          privacy policy
        </Link>{" "}
        lists what&apos;s sent.
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

/** The card in one state (FeedbackCard holds the state). */
export function FeedbackCardView({ count, leagues = 1, confirming, note, onExport, onAsk, onKeep, onDelete, sharing, refs }: FeedbackCardViewProps) {
  const questionId = useId();
  return (
    <Card id="feedback">
      <CardTitle eyebrow="Feedback">Your trade feedback</CardTitle>
      <p className="text-sm leading-relaxed text-muted">
        On each trade idea you can mark what happened (Sent, Accepted, Rejected or Countered) or report a problem with it. Offer Sheet keeps that in this browser,
        with the trade&apos;s numbers, so you can export it. {FEEDBACK_SCOPE_TEXT}
      </p>
      {sharing ? <SharingToggle {...sharing} /> : null}
      <p className="mt-3 font-semibold">{feedbackCountText(count, leagues)}</p>
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
            {deleteQuestionText(count, leagues)}
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
      <p className="mt-3 text-xs text-muted">{EXPORT_TEXT}</p>
    </Card>
  );
}

export function FeedbackCard() {
  const records = useSavedFeedback();
  const sharingOn = useFeedbackSharing();
  const [sharingError, setSharingError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [note, setNote] = useState<FeedbackNote | null>(null);
  // Where focus goes once the step's render is on screen (n: every step moves it, even to the same place).
  const [reveal, setReveal] = useState<{ n: number; focus: DeleteFocus } | null>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const count = records?.length;
  // How many leagues the feedback is from (the card covers them all: the header).
  const leagues = useMemo(() => new Set((records ?? []).map((r) => r.leagueKey)).size, [records]);

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

  async function deleteNow() {
    if (deleting) return;
    setDeleting(true);
    const done = await deleteFeedback();
    setDeleting(false);
    setNote(done.ok ? { tone: "ok", text: "Deleted. No feedback is saved in this browser now." } : { tone: "error", text: done.message });
    go(done.ok ? "deleted" : "failed");
  }

  return (
    <FeedbackCardView
      count={count}
      leagues={leagues}
      confirming={confirming}
      note={note}
      onExport={exportNow}
      onAsk={() => go("ask")}
      onKeep={() => go("keep")}
      onDelete={() => void deleteNow()}
      sharing={{
        on: sharingOn,
        onChange: (on) => {
          const saved = setFeedbackSharing(on);
          setSharingError(saved.ok ? null : saved.message);
        },
        error: sharingError,
      }}
      refs={{ delete: deleteRef, question: questionRef, status: statusRef }}
    />
  );
}
