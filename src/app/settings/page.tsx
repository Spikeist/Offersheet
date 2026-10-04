import type { Metadata } from "next";
import { SettingsPage } from "@/components/settings/SettingsPage";

export const metadata: Metadata = {
  title: "Settings",
  description:
    "Your Offer Sheet settings for each league: the positions you stream weekly, how much playoff weeks count, and what trade ideas may include. Saved in your browser.",
};

/**
 * CLAUDE.md §14 item 6. Settings are saved with each league in this browser (IndexedDB: src/lib/leagueStore.ts, Phase
 * 4c), so it all happens in the browser.
 */
export default function SettingsRoute() {
  return <SettingsPage />;
}
