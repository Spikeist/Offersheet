"use client";
/**
 * A batch of Sleeper leagues picked from a username's list (SleeperConnect; planner reply to Checkpoint 4b, change 11),
 * imported one after another: politely, one request at a time. It lives in module state, not in the Connect page,
 * because the batch outlives the page: the user can leave mid-batch (another page, or the platform picker's ESPN), and
 * coming back must not start a second batch next to the first (⚠️ review of track ML).
 *
 * - While the page that started it is open (`attached`), the first league imported becomes the league the tab shows,
 *   and SleeperConnect opens the Import Report once every league has imported.
 * - Once that page is gone, no new import starts. The one under way is still saved, without becoming the league the
 *   tab shows (unless the tab shows none: src/lib/leagueStore.ts saveImport), and nothing navigates. The leagues not
 *   started are left for the user to pick again; the Connect page says how the batch ended when it's opened again
 *   (detachedText).
 * - While a batch runs, the Connect page (opened again) says so, and its Sleeper buttons wait (useSleeperBatch).
 */
import { useSyncExternalStore } from "react";

export type BatchOutcome = { ok: true } | { ok: false; message: string };

export interface BatchDeps {
  /** Imports and saves one league; `makeCurrent()`, asked once its data is in, says whether it becomes the tab's league. */
  importOne: (id: string, makeCurrent: () => boolean) => Promise<BatchOutcome>;
  /** The Connect page that started the batch is still open. */
  attached: () => boolean;
  /** A league's import starts (`index`: its place in the batch). */
  onStart?: (id: string, index: number) => void;
  /** A league's import ended. */
  onEnd?: (id: string, outcome: BatchOutcome) => void;
}

export interface BatchResult {
  /** Leagues imported and saved. */
  imported: number;
  /** Leagues never started: the page was left before their turn. */
  notStarted: number;
}

/** The batch under way in this page load, and how the last one ended when its page had been left. */
export interface SleeperBatchState {
  running: boolean;
  /** A batch that ended after its Connect page was left: how many leagues it imported, of how many (null: none). */
  detached: { imported: number; total: number } | null;
}

/** What a league's import says when it fails unexpectedly (the import itself reports its own failures in words). */
export const BATCH_IMPORT_FAILED = "Something went wrong while importing this league. Try again.";

/** The Connect page's note while a batch it started before it was left is still finishing. */
export const BATCH_RUNNING_TEXT = "Still finishing the Sleeper import you started before leaving this page. One moment…";

/** The Connect page's note about a batch that ended after its page was left (pure). */
export function detachedText({ imported, total }: { imported: number; total: number }): string {
  if (imported === total) {
    return `Your Sleeper import finished after you left this page: ${total === 1 ? "the league is" : `all ${total} leagues are`} saved. Switch leagues at the top of any page.`;
  }
  const lead = "Your Sleeper import stopped when you left this page:";
  if (imported) return `${lead} ${imported} of ${total} leagues imported (switch leagues at the top of any page). Pick the others again to import them.`;
  return total === 1 ? `${lead} the league didn't import. Pick it again to import it.` : `${lead} none of the ${total} leagues imported. Pick them again to import them.`;
}

const IDLE: SleeperBatchState = Object.freeze({ running: false, detached: null }) as SleeperBatchState;
let state: SleeperBatchState = IDLE;
const listeners = new Set<() => void>();

function setState(next: SleeperBatchState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getState = (): SleeperBatchState => state;

/** The batch's state now (tests; pages use useSleeperBatch). */
export function sleeperBatchState(): SleeperBatchState {
  return state;
}

/**
 * The batch's state for the Connect page. (The server's render reads the same: no batch ever runs there, and a page's
 * first render in the browser comes before any batch starts.)
 */
export function useSleeperBatch(): SleeperBatchState {
  return useSyncExternalStore(subscribe, getState, getState);
}

/**
 * Imports `ids` one after another (see the header); null when a batch is already running (nothing starts). Never
 * rejects: a league whose import throws counts as failed.
 */
export async function runSleeperBatch(ids: readonly string[], deps: BatchDeps): Promise<BatchResult | null> {
  if (state.running) return null;
  setState({ running: true, detached: null });
  let imported = 0;
  let started = 0;
  try {
    for (const [index, id] of ids.entries()) {
      // The page that started the batch was left: the rest wait for the user to pick them again.
      if (!deps.attached()) break;
      started++;
      deps.onStart?.(id, index);
      let outcome: BatchOutcome;
      try {
        // The first league imported becomes the tab's league, while the page that started the batch is still open.
        outcome = await deps.importOne(id, () => imported === 0 && deps.attached());
      } catch {
        outcome = { ok: false, message: BATCH_IMPORT_FAILED };
      }
      if (outcome.ok) imported++;
      deps.onEnd?.(id, outcome);
    }
  } finally {
    setState({ running: false, detached: deps.attached() ? null : { imported, total: ids.length } });
  }
  return { imported, notStarted: ids.length - started };
}

/** Forgets the batch's state (tests). */
export function resetSleeperBatch(): void {
  setState(IDLE);
}
