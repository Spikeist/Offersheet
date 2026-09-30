import type { Metadata } from "next";
import { ImportReport } from "@/components/import/ImportReport";

export const metadata: Metadata = {
  title: "Import report",
  description: "Here's what Offer Sheet understood about your league: scoring, lineup, playoffs, trade rules, teams and warnings.",
};

export default function ImportPage() {
  return <ImportReport />;
}
