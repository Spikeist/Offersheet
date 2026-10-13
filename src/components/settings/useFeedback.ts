"use client";
/**
 * Trade feedback in the pages (CLAUDE.md §11 "Feedback on every suggestion", Phase 4: local only; lead decision
 * L12): the trade cards' outcome and Report buttons save presses and show what was pressed (feedbackFor,
 * src/lib/feedbackStore.ts); the Settings page counts, exports and deletes them.
 *
 * Phase 4c (planner reply to Checkpoint 4b, change 11): feedback lives in the league store (IndexedDB,
 * src/lib/leagueStore.ts), one list per league: useSavedFeedback reads one league's records or every league's (the
 * Settings page's count and export), saveFeedbackPress saves a press (the page shows it at once; the promise says
 * whether the browser kept it: the trade cards await it and show a refusal on the card), and deleteFeedback deletes one
 * league's or every league's.
 *
 * Phase 7a (planner reply to Checkpoint 4c, Part B, B2; track FB): once the browser has kept a press, and while "Share
 * anonymous feedback" is on (useFeedbackSharing, setFeedbackSharing: the Settings page), saveFeedbackPress also queues
 * the record's anonymous copy (src/lib/feedbackShare.ts: what it holds, and when it leaves), and its result says so
 * (`shared`: the card's one-time note). Each press carries the record's share id, a new random one when the record has
 * none (FeedbackChange.rid), so later copies of the same record can be matched to its first, and what the card's numbers
 * were computed from (FeedbackChange.basis: the season, week and goal of the share context), which a new record keeps with
 * them. Without a share context (a caller that passes none) a press is saved and nothing is sent.
 *
 * Checkpoint 7d (planner reply to Checkpoint 7c, answer 1): a press from a card also carries what the card prints
 * (FeedbackChange.shown, added by the card: tradeView.ts cardPress), which a new record keeps for the export
 * (feedbackStore.ts feedbackExport: what the user saw and entered, never the model's numbers); the anonymous copy is built as before
 * and holds none of it.
 *
 * Two presses on one card can overlap (a quick double click: the second lands before the first's save settles; review
 * FB-R1). So each press reads the record when it's made, from what the page holds once the store is loaded (the same
 * state the store's own step applies the press to), and its copy is built from the record as this press alone left it
 * (feedbackStore.ts applyFeedback on what it read), never from the store's state after its save settled, which can already
 * hold the next press. Presses on one card reach the sender in the order they were made (pressChains), and a press made
 * while an earlier one on that card failed to save shares nothing (what it read may hold the failed one).
 */
import { useMemo, useSyncExternalStore } from "react";
import type { SaveResult } from "@/lib/importStore";
import { feedbackRecordsOf, leagueStore, useLeagueStoreState, type LeagueStoreClient } from "@/lib/leagueStore";
import {
  FEEDBACK_DELETE_FAILED,
  FEEDBACK_SAVE_FAILED,
  applyFeedback,
  feedbackExportFileName,
  feedbackExportText,
  feedbackFor,
  type FeedbackChange,
  type FeedbackEvaluation,
  type FeedbackRecord,
} from "@/lib/feedbackStore";
import {
  feedbackBasisOf,
  newShareId,
  setSharing,
  shareFeedbackPress,
  sharingOn,
  subscribeSharePrefs,
  type FeedbackSaveResult,
  type FeedbackSender,
  type FeedbackShareContext,
} from "@/lib/feedbackShare";

/**
 * Saved feedback records from the league store: one league's (`leagueKey`, a saved league's `leagueKey`) or every
 * league's together (no key), from the least to the most recently pressed; undefined while the store loads.
 */
export function useSavedFeedback(leagueKey?: string): FeedbackRecord[] | undefined {
  const { status, feedback } = useLeagueStoreState();
  return useMemo(() => (status === "ready" ? feedbackRecordsOf(feedback, leagueKey) : undefined), [status, feedback, leagueKey]);
}

/**
 * A card's latest press (pressChains): whether it has settled, and, once it has, whether what it read could be trusted
 * (it saved, and so did every press on the card still settling when it was made).
 */
interface PressLink {
  settled: boolean;
  trusted: Promise<boolean>;
}

/**
 * Each card's latest press still settling (keyed by league and trade idea), so the next press on it shares after it, in
 * press order, and only when what it read can be trusted (the header). A press made once the card's last one has settled
 * waits for nothing: the store has put back any refused press by then.
 */
const pressChains = new Map<string, PressLink>();

/**
 * Saves one press of a card's outcome or Report button (at the current time) in the league store, with the record's share
 * id and the numbers' basis; once the browser has kept it, queues its anonymous copy while sharing is on (the header;
 * `share`: the league data and goal the card's numbers came from, feedbackShare.ts feedbackShareContext).
 */
export async function saveFeedbackPress(
  args: { leagueKey: string; evaluation: FeedbackEvaluation; change: FeedbackChange; share?: FeedbackShareContext | null },
  deps: {
    /** Tests: the league store (default the browser's), the copies' sender and the sharing choice (feedbackShare.ts's), the share id and the time. */
    client?: Pick<LeagueStoreClient, "getState" | "saveFeedback" | "start"> | null;
    sender?: FeedbackSender | null;
    sharing?: () => boolean;
    newId?: () => string;
    now?: () => string;
  } = {},
): Promise<FeedbackSaveResult> {
  const client = deps.client === undefined ? leagueStore() : deps.client;
  if (!client) return { ok: false, message: FEEDBACK_SAVE_FAILED };
  // The store applies a press to the records the page holds once it has loaded them: read the record from those too.
  if (client.getState().status !== "ready") await client.start();
  const { leagueKey, evaluation, share } = args;
  // From here to the save, no await: the store's own step (applied as the save starts) sees exactly what this press read.
  const before = feedbackFor(feedbackRecordsOf(client.getState().feedback, leagueKey), leagueKey, evaluation.key);
  const at = deps.now?.() ?? new Date().toISOString();
  const change: FeedbackChange = { ...args.change, rid: before?.rid ?? (deps.newId ?? newShareId)(), ...(share ? { basis: feedbackBasisOf(share) } : {}) };
  const saving = client.saveFeedback({ leagueKey, evaluation, change, at });
  const chainKey = `${leagueKey}\u0000${evaluation.key}`;
  const earlier = pressChains.get(chainKey);
  const waitFor = earlier && !earlier.settled ? earlier.trusted : null;
  const link: PressLink = { settled: false, trusted: Promise.resolve(false) };
  pressChains.set(chainKey, link);
  const settle = (trusted: boolean): boolean => {
    link.settled = true;
    if (pressChains.get(chainKey) === link) pressChains.delete(chainKey);
    return trusted;
  };
  const result = (async (): Promise<{ saved: FeedbackSaveResult; trusted: boolean }> => {
    const saved = await saving;
    // An earlier press on this card that failed may still be in what this one read: share nothing then.
    const trusted = (waitFor ? await waitFor : true) && saved.ok;
    if (!trusted || !share) return { saved, trusted };
    // The record as this press alone left it (the store's own step on what it read), never the store's state now.
    const after = feedbackFor(applyFeedback(before ? [before] : [], { leagueKey, evaluation, change, at }), leagueKey, evaluation.key);
    let shared = false;
    try {
      shared = shareFeedbackPress({
        before,
        after,
        change,
        context: share,
        ...(deps.sender !== undefined ? { sender: deps.sender } : {}),
        ...(deps.sharing ? { sharing: deps.sharing } : {}),
      });
    } catch {
      // Sharing never gets in the way of the press, which the browser has kept.
    }
    return { saved: shared ? { ...saved, shared } : saved, trusted };
  })();
  // Registered before this press's own caller waits on `result`, so the card counts as settled before anyone sees the result.
  link.trusted = result.then(
    (r) => settle(r.trusted),
    () => settle(false),
  );
  return (await result).saved;
}

/** Deletes one league's saved feedback (`leagueKey`) or every league's (no key) from the league store. */
export function deleteFeedback(leagueKey?: string): Promise<SaveResult> {
  return leagueStore()?.clearFeedback(leagueKey) ?? Promise.resolve({ ok: false, message: FEEDBACK_DELETE_FAILED });
}

/** The server's render and hydration: sharing reads as on (the default) until the browser's choice is known. */
const sharingDefault = () => true;

/** "Share anonymous feedback" in this browser (the Settings page's toggle), following changes in this tab and others. */
export function useFeedbackSharing(): boolean {
  return useSyncExternalStore(subscribeSharePrefs, () => sharingOn(), sharingDefault);
}

/** Turns "Share anonymous feedback" on or off for this browser (feedbackShare.ts setSharing). */
export function setFeedbackSharing(on: boolean): SaveResult {
  return setSharing(on);
}

/**
 * Downloads the records as a JSON file (the Settings page's "Export feedback": feedbackStore.ts feedbackExportText, version 3),
 * named by the export's UTC day; the file says that day too, never the time (feedbackExport; review of Checkpoint 7d,
 * cards-export-1).
 */
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
