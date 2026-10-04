/**
 * What the trade pages keep while this tab stays in the app (review of Phase 4: the trip back from the Trade Analyzer
 * lost the user's place: "Back to the Trade Finder" dropped the partner filter, and every return searched again, about
 * 5 seconds with its progress bar, and landed at the top of the list). Module state in the browser, written only from
 * effects and event handlers (never while rendering, so never on the server); a reload starts fresh.
 *
 * - One engine client for the Trade Finder and the Trade Analyzer (tradeEngine), never disposed: its worker keeps the
 *   evaluation context it built (src/workers/engine.worker.ts), so the Analyzer opened from a trade idea, and a search
 *   after it, reuse the context instead of building it again (about half a second), and a search runs warm. A page
 *   that goes away stops its own search (the Finder cancels it), not the worker.
 * - The ideas the Finder found, per search (rememberSearch / recallSearch: the last KEPT_SEARCHES searches by key: the
 *   league data, the inputs' build, my team, every setting and the partner), with the moment each was for. Coming back
 *   shows them again at once, without searching, while they still hold (src/workers/freshness.ts: no kickoff since, the
 *   same deadline readings): the search is deterministic, so searching again would find the very same ideas.
 * - The Finder's address (its partner filter: rememberFinderAddress) for the Analyzer's "Back to the Trade Finder", and
 *   the Finder's sort, so a return shows the ideas in the order left.
 * - Where to come back to: the idea whose "Open in Analyzer" was used, and which of its links (the card's own or its
 *   "If they say no, try:" one: Phase 4b) (rememberReturn). The Finder's next search start takes it (takeReturnTarget,
 *   once): when it shows that search's ideas again, it brings that link back into view with focus on it.
 */
import type { TradeSearchResult, TradeSort } from "@/engine/tradeModel";
import { createEngineClient, type EngineClient } from "@/lib/engineClient";
import { FINDER_PATH } from "@/lib/tradeView";

/** Searches remembered (a display choice: the last few partners looked at). */
export const KEPT_SEARCHES = 4;

let engine: EngineClient | null = null;

/** The trade pages' engine client, made on first use and kept (see the header). */
export function tradeEngine(): EngineClient {
  engine ??= createEngineClient();
  return engine;
}

interface Remembered {
  key: string;
  /** The moment the search was for (its request's nowIso). */
  nowIso: string;
  result: TradeSearchResult;
}

let searches: Remembered[] = [];

/** Keeps a finished search's ideas under its key (the newest first, at most KEPT_SEARCHES). */
export function rememberSearch(key: string, nowIso: string, result: TradeSearchResult): void {
  searches = [{ key, nowIso, result }, ...searches.filter((s) => s.key !== key)].slice(0, KEPT_SEARCHES);
}

/** The ideas a search under `key` found, while `holds(the moment they were for)` says they still hold; else null (and they're forgotten). */
export function recallSearch(key: string, holds: (nowIso: string) => boolean): TradeSearchResult | null {
  const hit = searches.find((s) => s.key === key);
  if (!hit) return null;
  if (holds(hit.nowIso)) return hit.result;
  searches = searches.filter((s) => s !== hit);
  return null;
}

let address: string | null = null;

/** The Finder's address as it stands (its partner filter in `?partner=`). */
export function rememberFinderAddress(href: string): void {
  address = href;
}

/** Where "Back to the Trade Finder" goes: the Finder's last address, else the Finder for every team. */
export function finderAddress(): string {
  return address ?? FINDER_PATH;
}

let sort: TradeSort | null = null;

export function rememberSort(value: TradeSort): void {
  sort = value;
}

/** The sort the Finder was left in, or null. */
export function rememberedSort(): TradeSort | null {
  return sort;
}

let back: { key: string; cardKey: string; href: string | null } | null = null;

/**
 * The idea (its TradeEvaluation.key) whose "Open in Analyzer" was used, in the search under `key`, and that link's
 * address (`href`: the card's own or its Plan B's; absent: the idea's first link).
 */
export function rememberReturn(key: string, cardKey: string, href?: string): void {
  back = { key, cardKey, href: href ?? null };
}

/** The idea and link to come back to in the search under `key` (null for another search); taken once either way. */
export function takeReturnTarget(key: string): { cardKey: string; href: string | null } | null {
  const b = back;
  back = null;
  return b && b.key === key ? { cardKey: b.cardKey, href: b.href } : null;
}

/** The idea to come back to in the search under `key` (takeReturnTarget's idea alone); taken once either way. */
export function takeReturn(key: string): string | null {
  return takeReturnTarget(key)?.cardKey ?? null;
}

/** Forgets everything but the engine client (tests). */
export function resetFinderMemory(): void {
  searches = [];
  address = null;
  sort = null;
  back = null;
}
