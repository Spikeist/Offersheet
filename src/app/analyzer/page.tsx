import type { Metadata } from "next";
import { Suspense } from "react";
import { LeagueLoading } from "@/components/trades/LeagueLoading";
import { AnalyzerPage } from "@/components/trades/AnalyzerPage";

export const metadata: Metadata = {
  title: "Trade Analyzer",
  description: "Build any trade, a counteroffer included, and see how much it helps your team and how likely the other manager is to accept. Runs in your browser.",
  // Only this browser's saved data shows here: nothing for a search engine (Part B, B3; robots.txt and the sitemap).
  robots: { index: false },
};

/**
 * CLAUDE.md §14 item 5. The page reads the league this tab shows from the leagues saved in this browser (IndexedDB:
 * src/lib/leagueStore.ts, Phase 4c) and evaluates trades in the browser's Web Worker. It reads the trade from the
 * address with useSearchParams, so it sits in a Suspense boundary (Next prerenders the fallback, the same "Loading your
 * league…" the page shows first).
 */
export default function AnalyzerRoute() {
  return (
    <Suspense fallback={<LeagueLoading />}>
      <AnalyzerPage />
    </Suspense>
  );
}
