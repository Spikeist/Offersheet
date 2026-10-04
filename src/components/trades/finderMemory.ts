/**
 * What the trade pages keep while this tab stays in the app (review of Phase 4: the trip back from the Trade Analyzer
 * lost the user's place: "Back to the Trade Finder" dropped the partner filter, and every return searched again, about
 * 5 seconds with its progress bar, and landed at the top of the list). Module state in the browser, written only from
 * effects and event handlers (never while rendering, so never on the server); a reload starts fresh.
 *
 * Phase 4c (planner reply to Checkpoint 4b, change 11: several saved leagues): everything here is per saved league (its
 * id, src/lib/leagueStore.ts savedLeagueId), so nothing from one league shows in another.
 *
 * - One engine client for the Trade Finder and the Trade Analyzer of the league shown (tradeEngine; src/lib/
 *   engineClient.ts createLeagueEngine): its worker keeps the evaluation context it built (src/workers/engine.worker.ts),
 *   so the Analyzer opened from a trade idea, and a search after it, reuse the context instead of building it again
 *   (about half a second), and a search runs warm. A page that goes away stops its own search (the Finder cancels it),
 *   not the worker. Another league's trade page stops it first (its worker and the context it held go) and gets a new
 *   one. ⚠️ So a switch to another league stops it at that league's first trade page, not at the switch itself.
 * - The ideas the Finder found, per search (rememberSearch / recallSearch: the last KEPT_SEARCHES searches by key: the
 *   league data, the inputs' build, my team, every setting but the minimum chance, and the partner; the league data names
 *   the league), with the moment each was for. Coming back shows them again at once, without searching, while they still
 *   hold (src/workers/freshness.ts: no kickoff since, the same deadline readings): the search is deterministic, so
 *   searching again would find the very same ideas. Phase 4c: ideas ranked at another minimum chance are re-filtered by
 *   the worker (TradeFinderPage.tsx), and the re-filtered ones replace them under the same key.
 * - Each league's Finder address (its partner filter: rememberFinderAddress) for the Analyzer's "Back to the Trade
 *   Finder", and each league's Finder sort, so a return shows the ideas in the order left.
 * - Where to come back to: the idea whose "Open in Analyzer" was used, and which of its links (the card's own or its
 *   "If they say no, try:" one: Phase 4b) (rememberReturn). The Finder's next search start takes it (takeReturnTarget,
 *   once): when it shows that search's ideas again, it brings that link back into view with focus on it.
 * - Whose address it is (useLeagueQuery, the one hook here; ⚠️ review of track ML): a trade page's address names teams
 *   and players of the league it was opened or written under (`?partner=&give=&get=`), and ESPN numbers teams 1..N in
 *   every league, so another league would read them as its own: the Finder would filter on that league's team, the
 *   Analyzer evaluate a trade across leagues. The page's top component, which stays mounted across a switch (its loaded
 *   part is keyed by league), reads the address only while it's one it first read under the league shown: after a
 *   switch, or the league's removal here or in another tab, the old address reads as none, and it's dropped
 *   (history.replaceState) so a reload doesn't read it either. Next applies an address change in a transition, after
 *   the store's switch has rendered, so the switcher's own drop doesn't cover that render. ⚠️ A history entry from
 *   before a switch (the browser's Back to a trade page opened under the other league) reads as the league shown now:
 *   nothing says which league an entry was made under.
 */
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { TradeSearchResult, TradeSort } from "@/engine/tradeModel";
import { createLeagueEngine, type EngineClient } from "@/lib/engineClient";
import { FINDER_PATH } from "@/lib/tradeView";
import { useSavedLeagues } from "../league/useLeagueInputs";

/** Searches remembered (a display choice: the last few partners looked at). */
export const KEPT_SEARCHES = 4;

const engines = createLeagueEngine();

/** The trade pages' engine client for a saved league (its id), made on first use and kept; another league's comes fresh (see the header). */
export function tradeEngine(leagueId: string): EngineClient {
  return engines.forLeague(leagueId);
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
  return recallSearchEntry(key, holds)?.result ?? null;
}

/**
 * recallSearch with the moment the ideas were for (Phase 4c: a re-filter of recalled ideas keeps it, and the ideas a
 * re-filter ranks again are remembered under the same key: the key leaves the minimum chance out, TradeFinderPage.tsx
 * searchKeyFor).
 */
export function recallSearchEntry(key: string, holds: (nowIso: string) => boolean): { result: TradeSearchResult; nowIso: string } | null {
  const hit = searches.find((s) => s.key === key);
  if (!hit) return null;
  if (holds(hit.nowIso)) return { result: hit.result, nowIso: hit.nowIso };
  searches = searches.filter((s) => s !== hit);
  return null;
}

const addresses = new Map<string, string>();

/** A league's Finder address as it stands (its partner filter in `?partner=`). */
export function rememberFinderAddress(leagueId: string, href: string): void {
  addresses.set(leagueId, href);
}

/** Where "Back to the Trade Finder" goes in a league: its Finder's last address, else the Finder for every team. */
export function finderAddress(leagueId: string): string {
  return addresses.get(leagueId) ?? FINDER_PATH;
}

const sorts = new Map<string, TradeSort>();

export function rememberSort(leagueId: string, value: TradeSort): void {
  sorts.set(leagueId, value);
}

/** The sort a league's Finder was left in, or null. */
export function rememberedSort(leagueId: string): TradeSort | null {
  return sorts.get(leagueId) ?? null;
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

/** Whose address it is (useLeagueQuery): the query, and the saved league shown when the page first read it. */
export interface QueryOwner {
  query: string;
  leagueId: string;
}

/**
 * The owner after a render (pure): an address the page hasn't read yet (a link, the page's own write, a reload) belongs
 * to the league shown now; one it has read keeps its owner. Nothing changes while no league is shown (`leagueId` null).
 */
export function queryOwnerAfter(owner: QueryOwner | null, query: string, leagueId: string | null): QueryOwner | null {
  if (leagueId === null || (owner !== null && owner.query === query)) return owner;
  return { query, leagueId };
}

/** The query the page reads (pure): the address's, or "" while it belongs to another league than the one shown. */
export function honoredQuery(owner: QueryOwner | null, query: string, leagueId: string | null): string {
  return owner !== null && leagueId !== null && owner.query === query && owner.leagueId !== leagueId ? "" : query;
}

/**
 * The address's query for a trade page (see the header): called by the page's top component (it reads useSearchParams,
 * so it sits in the route's Suspense boundary), whose loaded part reads only what it returns.
 */
export function useLeagueQuery(): string {
  const query = useSearchParams()?.toString() ?? "";
  const leagueId = useSavedLeagues()?.currentId ?? null;
  const [owner, setOwner] = useState<QueryOwner | null>(null);
  const next = queryOwnerAfter(owner, query, leagueId);
  // Kept while rendering (React's "storing information from previous renders"), so the render that reads a new address claims it.
  if (next !== owner) setOwner(next);
  const read = honoredQuery(next, query, leagueId);
  const stale = read !== query;
  useEffect(() => {
    if (!stale) return;
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    } catch {
      // the address keeps it; this page still reads none
    }
  }, [stale]);
  return read;
}

/** Forgets everything but the engine client (tests). */
export function resetFinderMemory(): void {
  searches = [];
  addresses.clear();
  sorts.clear();
  back = null;
}
