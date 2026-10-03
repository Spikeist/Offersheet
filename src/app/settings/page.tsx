import type { Metadata } from "next";
import { SettingsPage } from "@/components/settings/SettingsPage";

export const metadata: Metadata = {
  title: "Settings",
  description:
    "Your Offer Sheet settings for each league: the positions you stream weekly, how much playoff weeks count, and what trade ideas may include. Saved in your browser.",
};

/** CLAUDE.md §14 item 6. Settings are kept in this browser's localStorage, per league, so it all happens in the browser. */
export default function SettingsRoute() {
  return <SettingsPage />;
}
