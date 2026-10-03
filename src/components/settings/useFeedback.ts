"use client";
/**
 * Trade feedback in the pages (CLAUDE.md §11 "Feedback on every suggestion", Phase 4: local only; lead decision
 * L12): the trade cards' outcome and Report buttons save presses with saveTradeFeedback and show what was
 * pressed with useFeedbackRecords + feedbackFor (src/lib/feedbackStore.ts); the Settings page counts, exports
 * and deletes them. Everything stays in this browser's localStorage.
 */
import { useMemo } from "react";
import type { SaveResult } from "@/lib/importStore";
import {
  FEEDBACK_SAVE_FAILED,
  FEEDBACK_STORAGE_KEY,
  clearFeedback,
  feedbackExportFileName,
  feedbackExportText,
  parseFeedback,
  saveFeedback,
  type FeedbackChange,
  type FeedbackEvaluation,
  type FeedbackRecord,
} from "@/lib/feedbackStore";
import { browserLocalStorage, notifyLocalChange, useLocalValue } from "./useLocalValue";

/** Every saved record (oldest touched first); undefined until the browser's storage has been read. */
export function useFeedbackRecords(): FeedbackRecord[] | undefined {
  const raw = useLocalValue(FEEDBACK_STORAGE_KEY);
  return useMemo(() => (raw === undefined ? undefined : parseFeedback(raw)), [raw]);
}

/** Saves one press of a card's outcome or Report button (at the current time) and tells the open pages. */
export function saveTradeFeedback(args: { leagueKey: string; evaluation: FeedbackEvaluation; change: FeedbackChange }): SaveResult {
  const storage = browserLocalStorage();
  if (!storage) return { ok: false, message: FEEDBACK_SAVE_FAILED };
  const saved = saveFeedback(storage, { ...args, at: new Date().toISOString() });
  if (saved.ok) notifyLocalChange();
  return saved;
}

/** Deletes every saved record and tells the open pages. */
export function deleteSavedFeedback(): SaveResult {
  const storage = browserLocalStorage();
  if (!storage) return { ok: true }; // nothing can be stored, so nothing is
  const cleared = clearFeedback(storage);
  if (cleared.ok) notifyLocalChange();
  return cleared;
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
