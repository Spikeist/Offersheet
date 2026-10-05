import type { Metadata } from "next";
import { POLICY_FEATURES } from "@/lib/site";
import { TermsOfUse } from "./TermsOfUse";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The terms for using Offer Sheet: a free, read-only beta whose numbers are estimates, not promises.",
};

/**
 * The terms of use (planner reply to Checkpoint 4c, B3). Their text, and what it has to stay true of, is TermsOfUse.tsx;
 * it says what the features that are built do (src/lib/site.ts POLICY_FEATURES, review PG-1).
 */
export default function TermsPage() {
  return <TermsOfUse features={POLICY_FEATURES} />;
}
