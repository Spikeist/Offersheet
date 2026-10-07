import Link from "next/link";
import { ContactLine } from "@/components/ContactLine";
import { Card } from "@/components/ui";
import type { PolicyFeatures } from "@/lib/site";

/** The feedback page's description (its metadata), as the page says it today. */
export function feedbackDescription(features: PolicyFeatures): string {
  return features.anonymousFeedback
    ? "How to tell Offer Sheet what happened to its trade ideas, or what went wrong. The copies it gets are anonymous, and you can turn them off."
    : "How to record what happens to Offer Sheet's trade ideas, and how to reach us.";
}

/**
 * The feedback page (planner reply to Checkpoint 4c, B3: "Footer: a feedback link"; the lead's Part B design, track PG):
 * how to give feedback, without a form. The outcome and Report buttons on every trade idea (CLAUDE.md §11) save the press
 * in this browser (src/lib/feedbackStore.ts). With `features.anonymousFeedback` (track FB) they also send an anonymous copy
 * unless "Share anonymous feedback" is off in Settings (src/lib/feedbackShare.ts; the privacy page lists its fields), and
 * a note typed with a report never leaves the browser; without it (today) nothing is sent, and the words say so (review
 * PG-1). Nothing typed here by the public is stored on a server: anything else goes to the contact line (src/lib/site.ts).
 * "Export feedback" downloads the saved presses without the value ratios behind the estimates, and both branches say so
 * (planner reply to Checkpoint 7b, Q5: keep the export sentence accurate; feedbackStore.ts EXPORT_LEFT_OUT).
 */
export function FeedbackGuide({ features }: { features: PolicyFeatures }) {
  const shared = features.anonymousFeedback;
  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Feedback</h1>
        <p className="mt-2 text-muted">
          {shared
            ? "Offer Sheet learns from what happens to its trade ideas. Here's how to tell it."
            : "Here's how to record what happens to Offer Sheet's trade ideas, and how to reach us."}
        </p>
      </header>

      <Card>
        <h2 className="text-lg font-extrabold">On every trade idea</h2>
        <p className="mt-2 text-sm leading-relaxed">
          Each trade idea on the Trade Finder and the Trade Analyzer has buttons for what happened: Sent, Accepted, Rejected and Countered. If something looks wrong,
          press &ldquo;Report a problem&rdquo; and pick a reason (Doesn&apos;t help me, They&apos;d never accept, Player info is wrong, League settings look wrong,
          or Other), and add a note if you like.
        </p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
          <li>Every press is saved with that league in this browser.</li>
          {shared ? (
            <>
              <li>
                Unless you turn it off, an anonymous copy also goes to Offer Sheet, to help improve it: what you pressed, the players as ID numbers, your
                league&apos;s format and Offer Sheet&apos;s numbers for the trade. Never your league&apos;s ID, names or usernames.
              </li>
              <li>A note you type with a report stays in this browser. It&apos;s never sent.</li>
              <li>
                To stop sending copies, turn off &ldquo;Share anonymous feedback&rdquo; on the{" "}
                <Link href="/settings" className="font-semibold underline underline-offset-2">
                  Settings page
                </Link>
                . That choice is saved in this browser.
              </li>
              <li>
                &ldquo;Export feedback&rdquo;, also on the Settings page, downloads what you&apos;ve saved as a file, notes included. It leaves out the
                trade-value comparisons behind Offer Sheet&apos;s estimates.
              </li>
            </>
          ) : (
            <>
              <li>It stays in this browser, notes included: Offer Sheet doesn&apos;t receive it.</li>
              <li>
                &ldquo;Export feedback&rdquo; on the{" "}
                <Link href="/settings" className="font-semibold underline underline-offset-2">
                  Settings page
                </Link>{" "}
                downloads what you&apos;ve saved as a file, notes included. It leaves out the trade-value comparisons behind Offer Sheet&apos;s
                estimates.
              </li>
            </>
          )}
        </ul>
        <p className="mt-2 text-sm leading-relaxed">
          The{" "}
          <Link href="/privacy" className="font-semibold underline underline-offset-2">
            privacy policy
          </Link>{" "}
          {shared ? "lists what's sent and how long it's kept." : "says what's kept."}
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Anything else</h2>
        <p className="mt-2 text-sm leading-relaxed">A bug, a league that imported wrong, or an idea: get in touch.</p>
        <ContactLine className="mt-2 text-sm leading-relaxed" />
      </Card>
    </article>
  );
}
