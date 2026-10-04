import type { Metadata } from "next";
import { LeaguePage } from "@/components/league/LeaguePage";

export const metadata: Metadata = {
  title: "League",
  description:
    "Your league at a glance: standings with playoff and title odds, your remaining schedule, every team's projected points per week, needs and trade chips, best trade partners, and each player's rest-of-season points.",
};

/**
 * CLAUDE.md §14 item 3. The page reads the league this tab shows from the leagues saved in this browser (IndexedDB:
 * src/lib/leagueStore.ts, Phase 4c), so it all happens in the browser.
 */
export default function LeagueRoute() {
  return <LeaguePage />;
}
