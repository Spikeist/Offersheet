import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Offer Sheet does with your league data and your ESPN cookies.",
};

/** When this policy last changed (Parker's local date). Update it with every change below. */
const LAST_UPDATED = "September 29, 2026";

/**
 * CLAUDE.md §14: the privacy policy must match what the app actually does. Update it whenever data
 * handling changes (e.g. the Phase 7 feedback store). What it relies on:
 *   - src/server/cache.ts: every cached entry is deleted once its retention passes (TTL.league 10 min;
 *     TTL.closedTransactions 6 h; public sources up to STALE_PUBLIC_RETAIN_MS, 7 days).
 *   - src/adapters/espn: member IDs (SWIDs) are replaced by one-way pseudonyms before a body is cached;
 *     private-league cache keys carry a one-way fingerprint of the cookies (credentialScope).
 *   - src/server/session.ts: the sealed, httpOnly, session-only cookie; 12-hour seal.
 */
export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Privacy</h1>
        <p className="mt-2 text-muted">Plain answers about what Offer Sheet keeps, and for how long.</p>
        <p className="mt-1 text-sm text-muted">Last updated {LAST_UPDATED}</p>
      </header>

      <Card>
        <h2 className="text-lg font-extrabold">The short version</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
          <li>No accounts, no ads and no tracking or analytics. We don&apos;t sell or share your data, and we don&apos;t build profiles of you or your leaguemates.</li>
          <li>Offer Sheet only reads your league. It can&apos;t send offers or change anything.</li>
          <li>Your imported league lives in this browser tab and is gone when you close it.</li>
          <li>Our server keeps a short-lived copy of what it fetches (league data for about 10 minutes), then deletes it.</li>
          <li>If you connect with ESPN cookies, they&apos;re kept only in an encrypted cookie in your browser for this session, and only ever sent to ESPN.</li>
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Your league</h2>
        <p className="mt-2 text-sm leading-relaxed">
          When you connect, our server fetches your league from ESPN or Sleeper, turns it into the Import Report, and sends it to your browser. Your browser keeps it in this
          tab&apos;s session storage (not local storage) until you close the tab. Your pick of &ldquo;Your team&rdquo; is kept the same way.
        </p>
        <p className="mt-2 text-sm leading-relaxed">To go easy on ESPN and Sleeper, our server keeps a copy of what it fetched for a short time, then deletes it:</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
          <li>
            League data (settings, rosters, schedule and transactions): about 10 minutes. Transactions from weeks that ended more than a week ago rarely change, so they
            may be kept for up to 6 hours.
          </li>
          <li>A Sleeper username lookup (which leagues that username is in): 10 minutes.</li>
          <li>
            Public data that isn&apos;t about any league (player lists, player ID maps and the NFL schedule): up to a week, so a saved copy can stand in if a source is down.
          </li>
        </ul>
        <p className="mt-2 text-sm leading-relaxed">
          Data from a private ESPN league is stored under a one-way fingerprint of your cookies, so someone else who types the same league ID can&apos;t see it.
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          ESPN league data includes every member&apos;s ESPN member ID (the SWID), yours among them. Before our server keeps a copy, it replaces every member ID with a
          one-way pseudonym, so the saved copy holds no SWIDs.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">ESPN cookies (private leagues only)</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
          <li>They work like a password to your ESPN account, so we treat them like one. We never ask for your ESPN password.</li>
          <li>They travel from your browser to our server once, inside the request, never in a web address.</li>
          <li>
            Our server puts them straight into a cookie in your browser that is encrypted with a key only our server has, can&apos;t be read by the page&apos;s scripts, and is
            deleted when you close your browser. Even if your browser restores its session, the encrypted cookie stops working after 12 hours.
          </li>
          <li>
            Our server reads them only to fetch your league, and sends them only to ESPN. Your espn_s2 cookie is never stored on our server or written to logs, and your SWID
            is kept only as the one-way pseudonym described above.
          </li>
          <li>
            &ldquo;Forget my credentials&rdquo; on the{" "}
            <Link href="/connect" className="font-semibold underline underline-offset-2">
              Connect page
            </Link>{" "}
            (or &ldquo;Forget my ESPN cookies&rdquo; on the Import Report) deletes the cookie right away. League data our server cached with it expires within about 10
            minutes (older weeks&apos; transactions within 6 hours) and is then deleted.
          </li>
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Sleeper</h2>
        <p className="mt-2 text-sm leading-relaxed">
          Sleeper leagues are public. If you enter a username, we use it only to look up your leagues and find your team, and our server keeps that lookup for 10 minutes.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Other sources</h2>
        <p className="mt-2 text-sm leading-relaxed">
          Our server also downloads public player data from Sleeper, FantasyCalc and DynastyProcess, and the NFL schedule. Nothing about you or your league is sent with those
          requests.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Children and changes</h2>
        <p className="mt-2 text-sm leading-relaxed">Offer Sheet isn&apos;t directed at children under 13.</p>
        <p className="mt-2 text-sm leading-relaxed">If this policy changes, we&apos;ll update it here and change the date above.</p>
        <p className="mt-2 text-sm leading-relaxed">
          Offer Sheet is an independent project. It is not affiliated with ESPN, Yahoo, Sleeper, Fleaflicker, MyFantasyLeague or Fantrax.
        </p>
      </Card>
    </article>
  );
}
