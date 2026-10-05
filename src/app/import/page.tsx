import type { Metadata } from "next";
import { ImportReport } from "@/components/import/ImportReport";

export const metadata: Metadata = {
  title: "Import report",
  description: "Here's what Offer Sheet understood about your league: scoring, lineup, playoffs, trade rules, teams and warnings.",
  // Only this browser's saved data shows here: nothing for a search engine (Part B, B3; robots.txt and the sitemap).
  robots: { index: false },
};

export default function ImportPage() {
  return <ImportReport />;
}
