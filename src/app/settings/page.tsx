import type { Metadata } from "next";
import { SettingsPage } from "@/components/settings/SettingsPage";

export const metadata: Metadata = {
  title: "Settings",
  // How much playoff weeks count is set automatically now, shown read-only (planner reply to Checkpoint 7a, §6.1), and the
  // goal is worded by what the league rewards (5.2): review of Phase 7b.
  description: "Your Offer Sheet settings for each league: the positions you stream weekly, what your league rewards, and what trade ideas may include. Saved in your browser.",
  // Only this browser's saved data shows here: nothing for a search engine (Part B, B3; robots.txt and the sitemap).
  robots: { index: false },
};

/**
 * CLAUDE.md §14 item 6. Settings are saved with each league in this browser (IndexedDB: src/lib/leagueStore.ts, Phase
 * 4c), so it all happens in the browser.
 */
export default function SettingsRoute() {
  return <SettingsPage />;
}
