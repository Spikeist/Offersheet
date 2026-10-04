"use client";
/**
 * Trade feedback in the pages (CLAUDE.md §11 "Feedback on every suggestion", Phase 4: local only; lead decision
 * L12): the trade cards' outcome and Report buttons save presses and show what was pressed (feedbackFor,
 * src/lib/feedbackStore.ts); the Settings page counts, exports and deletes them. Everything stays in this browser.
 *
 * Phase 4c (planner reply to Checkpoint 4b, change 11): feedback lives in the league store (IndexedDB,
 * src/lib/leagueStore.ts), one list per league: useSavedFeedback reads one league's records or every league's (the
 * Settings page's count and export), saveFeedbackPress saves a press (the page shows it at once; the promise says
 * whether the browser kept it: the trade cards await it and show a refusal on the card), and deleteFeedback deletes one
 * league's or every league's.
 */
import { useMemo } from "react";
import type { SaveResult } from "@/lib/importStore";
import { feedbackRecordsOf, leagueStore, useLeagueStoreState } from "@/lib/leagueStore";
import { FEEDBACK_DELETE_FAILED, FEEDBACK_SAVE_FAILED, feedbackExportFileName, feedbackExportText, type FeedbackChange, type FeedbackEvaluation, type FeedbackRecord } from "@/lib/feedbackStore";

/**
 * Saved feedback records from the league store: one league's (`leagueKey`, a saved league's `leagueKey`) or every
 * league's together (no key), from the least to the most recently pressed; undefined while the store loads.
 */
export function useSavedFeedback(leagueKey?: string): FeedbackRecord[] | undefined {
  const { status, feedback } = useLeagueStoreState();
  return useMemo(() => (status === "ready" ? feedbackRecordsOf(feedback, leagueKey) : undefined), [status, feedback, leagueKey]);
}

/** Saves one press of a card's outcome or Report button (at the current time) in the league store. */
export function saveFeedbackPress(args: { leagueKey: string; evaluation: FeedbackEvaluation; change: FeedbackChange }): Promise<SaveResult> {
  return leagueStore()?.saveFeedback({ ...args, at: new Date().toISOString() }) ?? Promise.resolve({ ok: false, message: FEEDBACK_SAVE_FAILED });
}

/** Deletes one league's saved feedback (`leagueKey`) or every league's (no key) from the league store. */
export function deleteFeedback(leagueKey?: string): Promise<SaveResult> {
  return leagueStore()?.clearFeedback(leagueKey) ?? Promise.resolve({ ok: false, message: FEEDBACK_DELETE_FAILED });
}

/** Downloads the records as a JSON file (the Settings page's "Export feedback"). */
export function downloadFeedback(records: readonly FeedbackRecord[], now: Date = new Date()): void {
  const exportedAt = now.toISOString();
  const blob = new Blob([feedbackExportText(records, exportedAt)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = feedbackExportFileName(exportedAt);
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked a moment later: some browsers start the download only after the click's task ends.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
