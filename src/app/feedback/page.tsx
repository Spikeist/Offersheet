import type { Metadata } from "next";
import { POLICY_FEATURES } from "@/lib/site";
import { FeedbackGuide, feedbackDescription } from "./FeedbackGuide";

export const metadata: Metadata = {
  title: "Feedback",
  description: feedbackDescription(POLICY_FEATURES),
};

/**
 * The feedback page (planner reply to Checkpoint 4c, B3: "Footer: a feedback link"). Its text is FeedbackGuide.tsx; it
 * says what the features that are built do (src/lib/site.ts POLICY_FEATURES, review PG-1).
 */
export default function FeedbackPage() {
  return <FeedbackGuide features={POLICY_FEATURES} />;
}
