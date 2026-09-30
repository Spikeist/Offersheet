import type { Metadata } from "next";
import { LeaguePage } from "@/components/league/LeaguePage";

export const metadata: Metadata = {
  title: "League",
  description:
    "Your league at a glance: every team's projected points per week, needs and surplus, positional strength, best trade partners, and each player's rest-of-season points.",
};

/** CLAUDE.md §14 item 3. The page reads the imported league from this tab's sessionStorage, so it all happens in the browser. */
export default function LeagueRoute() {
  return <LeaguePage />;
}
