/**
 * "Loading your league…" (CLAUDE.md §14 items 4–5): what the Trade Finder and the Trade Analyzer show before this tab's
 * storage has been read, and their routes' Suspense fallback (useSearchParams: src/app/trades/page.tsx,
 * src/app/analyzer/page.tsx), so the prerendered page and the first client render say the same thing.
 */
import { Spinner } from "../ui";

export function LeagueLoading() {
  return (
    <p role="status" className="flex items-center gap-3 py-16 text-muted">
      <Spinner /> Loading your league…
    </p>
  );
}
