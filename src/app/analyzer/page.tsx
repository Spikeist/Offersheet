import type { Metadata } from "next";
import { Suspense } from "react";
import { LeagueLoading } from "@/components/trades/LeagueLoading";
import { AnalyzerPage } from "@/components/trades/AnalyzerPage";

export const metadata: Metadata = {
  title: "Trade Analyzer",
  description: "Build any trade, a counteroffer included, and see how much it helps your team and how likely the other manager is to accept. Runs in your browser.",
};

/**
 * CLAUDE.md §14 item 5. The page reads the imported league from this tab's sessionStorage and evaluates trades in the
 * browser's Web Worker. It reads the trade from the address with useSearchParams, so it sits in a Suspense boundary
 * (Next prerenders the fallback, the same "Loading your league…" the page shows first).
 */
export default function AnalyzerRoute() {
  return (
    <Suspense fallback={<LeagueLoading />}>
      <AnalyzerPage />
    </Suspense>
  );
}
