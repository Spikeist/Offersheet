import Link from "next/link";
import { ContactLine } from "@/components/ContactLine";
import { Card } from "@/components/ui";
import type { PolicyFeatures } from "@/lib/site";

/**
 * When these terms last changed. The go/no-go set it to launch day, when the page goes public, so changes before launch keep
 * it; after launch, update it with every change below, a feature turned on included (helpsThem, if section 7 ships then).
 */
export const TERMS_LAST_UPDATED = "October 13, 2026";

/**
 * The terms of use (planner reply to Checkpoint 4c, B3: "New pages: /privacy … and /terms"; outline: the Part B
 * research, "/terms outline"). Not legal advice: reports/privacy-terms-draft.md carries the same text for the planner.
 * Checkpoint 7b (planner reply to Checkpoint 7a, 4 "Terms" 1–3 and 5.4): "Your part" in the planner's words (leagues
 * you're in or allowed to view; not collecting information about other people; keeping ESPN cookies private), "You must
 * be at least 13 to use Offer Sheet.", and FantasyCalc's values no longer among the numbers it shows. What it says has to
 * stay true of the app:
 *   - free, non-commercial, no accounts, no ads, read-only (CLAUDE.md §1, §19, §20);
 *   - the numbers it works out are estimates (the projections, the season simulation, "Chance they accept": CLAUDE.md
 *     §6–§11; with `features.helpsThem`, "Helps them" too: planner reply to Checkpoint 7b, section 3, "Helps them (section
 *     7): when it ships, add it to the terms' list of estimates", which pages.test.ts ties to the Trade Finder's "Helps both"
 *     sort); the league's own records, points and settings are the platform's (review POL-21); FantasyCalc's values are
 *     used in its own numbers and never shown (FantasyCalc's condition, planner reply to Checkpoint 7a, 5.4), said only
 *     with `features.fantasyCalcHidden`, which pages.test.ts ties to the code that showed them;
 *   - the sources and their terms: ESPN's API is unofficial (CLAUDE.md §2.2, §19), Sleeper's is free for non-commercial
 *     use, FantasyCalc's values are non-commercial and credited with a link (§2.9), DynastyProcess's ID map is GPL-3.0 and
 *     stays on the server; the NFL schedule is ESPN's (src/data/nflSchedule.ts nflScheduleUrl: the app downloads nothing
 *     from nflverse, review PG-2). Since Checkpoint 7d the data line names the map's license, in the planner's words
 *     ("player ID maps from DynastyProcess (shared under the GPL-3.0 license)": planner reply to Checkpoint 7c, "Also"):
 *     a saved import keeps its players' ID pairs, DynastyProcess's links among them, in the user's browser (security
 *     finding 10), so the license is credited where users can see it, here and in the footer's link to the repository
 *     (src/components/SiteFooter.tsx). The full GPL review still comes before any downloadable version (CLAUDE.md §19);
 *   - feedback: with `features.anonymousFeedback` (track FB) an anonymous copy with an opt-out (the privacy page lists the
 *     fields); without it it stays in the browser (src/lib/feedbackStore.ts), and the words say so (review PG-1);
 *   - saved leagues stay until removed or until the browser clears them (the privacy page says when; review PG-7);
 *   - the contact line: src/lib/site.ts CONTACT_EMAIL.
 */
export function TermsOfUse({ features }: { features: PolicyFeatures }) {
  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Terms of use</h1>
        <p className="mt-2 text-muted">The deal, in plain words. By using Offer Sheet, you agree to these terms.</p>
        <p className="mt-1 text-sm text-muted">Last updated {TERMS_LAST_UPDATED}</p>
      </header>

      <Card>
        <h2 className="text-lg font-extrabold">What Offer Sheet is</h2>
        <p className="mt-2 text-sm leading-relaxed">
          Offer Sheet is a free, non-commercial project, offered as a beta. It reads your fantasy football league and suggests trades. It only reads: it never sends
          offers, changes lineups or posts anything for you. There are no accounts, no ads and nothing to buy.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Estimates, not promises</h2>
        <p className="mt-2 text-sm leading-relaxed">
          The numbers Offer Sheet works out are estimates: projections, playoff and title odds, &ldquo;Helps you&rdquo;,{" "}
          {features.helpsThem ? "“Helps them”, " : null}&ldquo;Chance they accept&rdquo; and &ldquo;Overall&rdquo;. Players get hurt, managers change their minds,
          and data can be late or wrong. You decide what to offer and what to accept, and those decisions are yours.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Where the data comes from</h2>
        <p className="mt-2 text-sm leading-relaxed">
          League data comes from ESPN and Sleeper, projections and stats from Sleeper and ESPN, trade values from FantasyCalc
          {features.fantasyCalcHidden ? " (Offer Sheet uses them in its own numbers and doesn't show them)" : null}, player ID maps from DynastyProcess (shared under
          the GPL-3.0 license), and the NFL schedule from ESPN. ESPN&apos;s league data comes through an unofficial interface that ESPN doesn&apos;t support, so it
          can change or stop working at any time. Each of these services has its own terms, and your ESPN and Sleeper accounts stay under theirs.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Not affiliated</h2>
        <p className="mt-2 text-sm leading-relaxed">
          Offer Sheet is independent. It is not affiliated with, endorsed by or sponsored by ESPN, Sleeper, Yahoo, Fleaflicker, MyFantasyLeague, Fantrax, FantasyCalc,
          DynastyProcess or the NFL. Their names and trademarks belong to their owners, and appear here only to say which services Offer Sheet works with or reads
          from.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Your part</h2>
        <p className="mt-2 text-sm leading-relaxed">You must be at least 13 to use Offer Sheet. When you use it, you agree to these rules:</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
          <li>
            connect only leagues you&apos;re in, or leagues you&apos;re allowed to view (Sleeper leagues are public; an ESPN league is public only if its manager made
            it viewable);
          </li>
          <li>don&apos;t use Offer Sheet to collect information about other people;</li>
          <li>
            keep your ESPN cookies private: they work like a password, so never share them, and paste them into Offer Sheet only on a computer you trust;
          </li>
          <li>don&apos;t scrape Offer Sheet, point automated tools at it, overload it, or get around its limits;</li>
          <li>don&apos;t sell, republish or reuse Offer Sheet&apos;s numbers or data, commercially or in bulk.</li>
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Feedback</h2>
        {features.anonymousFeedback ? (
          <p className="mt-2 text-sm leading-relaxed">
            When you mark what happened to a trade idea or report a problem with one, Offer Sheet may use an anonymous copy to improve its estimates and fix what it
            gets wrong. The{" "}
            <Link href="/privacy" className="font-semibold underline underline-offset-2">
              privacy policy
            </Link>{" "}
            says what&apos;s sent. You can turn it off in{" "}
            <Link href="/settings" className="font-semibold underline underline-offset-2">
              Settings
            </Link>
            .
          </p>
        ) : (
          <p className="mt-2 text-sm leading-relaxed">
            When you mark what happened to a trade idea or report a problem with one, it&apos;s saved in your browser only: Offer Sheet doesn&apos;t receive it. The{" "}
            <Link href="/privacy" className="font-semibold underline underline-offset-2">
              privacy policy
            </Link>{" "}
            says what&apos;s kept.
          </p>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">A beta can change</h2>
        <p className="mt-2 text-sm leading-relaxed">
          Offer Sheet is a beta. Its features may change, break or go away, it may pause or stop, and ESPN, Sleeper or another source may change or block what it
          reads, at any time and without notice. The leagues you saved stay in your browser until you remove them or your browser clears them (the privacy policy says
          when).
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">No warranty</h2>
        <p className="mt-2 text-sm leading-relaxed">
          Offer Sheet is provided &ldquo;as is&rdquo;, without warranties of any kind. As far as the law allows, its maker isn&apos;t liable for any loss or damage
          from using it or from relying on its numbers, including trades you make or don&apos;t make.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Changes and contact</h2>
        <p className="mt-2 text-sm leading-relaxed">
          If these terms change, we&apos;ll update them here and change the date above. Using Offer Sheet after a change means you accept the new terms.
        </p>
        <ContactLine className="mt-2 text-sm leading-relaxed" />
      </Card>
    </article>
  );
}
