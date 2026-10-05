import type { Metadata } from "next";
import { POLICY_FEATURES } from "@/lib/site";
import { PrivacyPolicy } from "./PrivacyPolicy";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Offer Sheet does with your league data, your ESPN cookies and your feedback, where it's kept and for how long.",
};

/**
 * The privacy policy (CLAUDE.md §14; planner reply to Checkpoint 4c, B3). Its text, and what each statement rests on, is
 * PrivacyPolicy.tsx; it says what the features that are built do (src/lib/site.ts POLICY_FEATURES, review PG-1).
 */
export default function PrivacyPage() {
  return <PrivacyPolicy features={POLICY_FEATURES} />;
}
