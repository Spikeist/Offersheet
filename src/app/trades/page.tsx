import type { Metadata } from "next";
import { Suspense } from "react";
import { LeagueLoading } from "@/components/trades/LeagueLoading";
import { TradeFinderPage } from "@/components/trades/TradeFinderPage";

export const metadata: Metadata = {
  title: "Trade Finder",
  description:
    "Trade ideas for your fantasy football team, ranked by how much they raise your playoff and title odds and how likely the other manager is to say yes. Runs in your browser.",
};

/**
 * CLAUDE.md §14 item 4. The page reads the league this tab shows from the leagues saved in this browser (IndexedDB:
 * src/lib/leagueStore.ts, Phase 4c) and searches in the browser's Web Worker. It reads its partner from the address
 * with useSearchParams, so it sits in a Suspense boundary (Next prerenders the fallback, the same "Loading your
 * league…" the page shows first).
 */
export default function TradesRoute() {
  return (
    <Suspense fallback={<LeagueLoading />}>
      <TradeFinderPage />
    </Suspense>
  );
}
