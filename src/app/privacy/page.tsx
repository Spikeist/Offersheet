import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { FANTASYCALC_OUTAGE_HOLD_MS, FANTASYCALC_OUTAGE_MAX_HOLD_MS } from "@/data/fantasyCalcValues";
import { config } from "@/engine/config";

/** A hold in whole minutes, for the FantasyCalc sentence. */
const minutes = (ms: number): number => Math.round(ms / 60_000);

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Offer Sheet does with your league data and your ESPN cookies.",
};

/** When this policy last changed (Parker's local date). Update it with every change below. */
const LAST_UPDATED = "October 4, 2026";

/**
 * CLAUDE.md §14: the privacy policy must match what the app actually does. Update it whenever data
 * handling changes (e.g. the Phase 7 feedback store). What it relies on:
 *   - src/server/cache.ts: every cached entry is deleted once its retention passes (TTL.league 10 min;
 *     TTL.closedTransactions 6 h; public sources up to STALE_PUBLIC_RETAIN_MS, 7 days; Phase 4c: FantasyCalc's value
 *     lists up to FANTASYCALC_RETAIN_MS, config.market.fantasyCalcCurveDays (90) days, one per league format, read fresh
 *     only within a day and otherwise only while FantasyCalc doesn't answer: a list at most
 *     config.market.fantasyCalcStaleDays (7) old stands in, an older one only calibrates our own value estimates,
 *     src/server/modelInputs.ts). ⚠️ "Once FantasyCalc answers, we don't ask it for that list again for a day", not "at
 *     most once a day" (review of track UIP): the 24-hour TTL holds back a request only after an answer. While FantasyCalc
 *     doesn't answer, src/data/fantasyCalcValues.ts's outage memory (fantasyCalcGate, Phase 4c's polish: the Sleeper gate's
 *     rule) asks it nothing for FANTASYCALC_OUTAGE_HOLD_MS (5 minutes), doubling while it lasts to at most
 *     FANTASYCALC_OUTAGE_MAX_HOLD_MS (15), in-process, serving the copies the cache holds meanwhile; then a build asks again
 *     (one request and its retry). Before it, each build past the TTL asked again.
 *   - src/adapters/espn: member IDs (SWIDs) are replaced by one-way pseudonyms before a body is cached;
 *     private-league cache keys carry a one-way fingerprint of the cookies (credentialScope).
 *   - src/server/session.ts: the sealed, httpOnly, session-only cookie; 12-hour seal.
 *   - src/lib/leagueStore.ts (Phase 4c, planner reply to Checkpoint 4b, change 11): every league the user imports is
 *     saved in this browser's IndexedDB, database "offersheet", until the user removes it (the league switcher's
 *     Remove) or clears the site's data: the import (the snapshot, with team and owner names and the league id, and the
 *     request summary, never credentials), the "my team" pick, the latest model inputs (reused while under 6 hours old:
 *     modelStore.ts), settings and feedback (per leagueKey, settingsStore.ts: no season). Removing a league deletes its
 *     import, pick and model inputs, and its settings and feedback unless another saved season of it shares them. Each
 *     tab keeps the saved league id it shows in sessionStorage ("offersheet:current-league:v1"; a short code made from
 *     the league id, and the season), and tabs tell each other about changes (BroadcastChannel, else a localStorage
 *     ping) with those ids only. src/workers/engine.worker.ts: the League math, the trade search (Trade Finder) and the
 *     Trade Analyzer's evaluations run in the browser; the pages load the inputs the same way
 *     (src/components/league/useLeagueInputs.ts).
 *   - The pre-4c storage (leagueStore.ts migration): settings ("offersheet:settings:v1") and feedback
 *     ("offersheet:feedback:v1") in localStorage, a tab's import, model inputs and picks in its sessionStorage. They're
 *     copied in once and left as they were, unused; removing a league deletes its old copies, deleting feedback
 *     deletes the old feedback, and a tab's session storage goes when the tab closes.
 *   - src/lib/tradeView.ts finderHref / analyzerHref (Phase 4): links to the Trade Finder for one team and
 *     to a trade in the Trade Analyzer carry a team ID and player IDs in the URL query, never names or
 *     the league ID (Phase 4b: a trade opened from a card's "If they say no, try:" also carries `from=planB`,
 *     which says only where it was opened from); the Finder (a partner picked) and the Analyzer (the trade it evaluated) write theirs
 *     back into the address the same way (history.replaceState: no request). Those links are never
 *     prefetched (prefetch={false}: TradeCard, TradePartners), so the server sees such an address only
 *     when the user opens it.
 *   - src/lib/settingsStore.ts (Phase 4): each league's settings, filed under leagueKey (a short hash of the platform and
 *     league ID): player IDs, positions, numbers and on/off flags, no names; Phase 4c: the Trade Finder's "Chance they
 *     accept: at least" (TradeSettings.minChance) is saved with them. Only the in-browser engine reads them (never sent to
 *     a server).
 *   - src/lib/feedbackStore.ts (Phase 4): feedback on trade ideas (outcome and report buttons), the newest
 *     FEEDBACK_MAX_RECORDS = 500 per league (Phase 4c): the trade's player, pick and partner team IDs, Offer Sheet's
 *     numbers and features, which version of the idea was sent, with an outcome (a plain card's one version is recorded
 *     too: Phase 4b, the version's key, made of the same team and player IDs, and its estimate; Phase 4c, planner reply to
 *     Checkpoint 4b, change 7: its model inputs, VersionInputs: the acceptance features, which are the other team's (its
 *     value and lineup change among them), the raw value change for the other team, my B and the "What matters most" goal,
 *     numbers and that one setting only), when each button was pressed and the typed note.
 *     "Export feedback" (feedbackExport) numbers the leagues (league-1, league-2, …) and keeps notes as
 *     typed; "Delete saved feedback" removes it all. Nothing is sent anywhere until Phase 7's server-side
 *     store, which must update this page.
 *   - src/server/modelInputs.ts assembleModelInputs: the server scores every player's projections and
 *     stats with the league's scoring rules and joins FantasyCalc values to the league's players.
 *   - The FantasyCalc values request carries only the league's format (src/engine/market.ts
 *     fantasyCalcFormat). Sleeper's projection and stats requests are shaped by the league: its season,
 *     week numbers through its last playoff week (modelWeekPlan: completed weeks' stats, projections
 *     from a few weeks back) and the positions its lineup starts (startablePositions), never names or
 *     IDs. The player lists and ID maps requests don't depend on the league; the NFL schedule's only
 *     on its season.
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
          <li>
            The leagues you import stay saved in this browser, with your team pick, your settings for each, the projections the League page loaded for them and any
            feedback you give on trade ideas, until you remove a league or clear this site&apos;s data. What&apos;s saved is read only in your browser: our server gets
            only what it needs to fetch a league again (its ID and season, and a Sleeper username you entered).
          </li>
          <li>
            Our server fetches the data and scores each player&apos;s projections with your league&apos;s rules. The League page&apos;s math (lineups, needs, trade partners,
            playoff odds), the trade search and the Trade Analyzer all run in your browser.
          </li>
          <li>Our server keeps a copy of what it fetches for a limited time (league data for about 10 minutes), then deletes it.</li>
          <li>
            If you connect with ESPN cookies, they&apos;re kept only in an encrypted cookie in your browser for this session, and only ever sent to ESPN. They&apos;re never
            saved with your leagues.
          </li>
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Your leagues</h2>
        <p className="mt-2 text-sm leading-relaxed">
          When you connect, our server fetches your league from ESPN or Sleeper, turns it into the Import Report, and sends it to your browser. Your browser saves it in
          its IndexedDB storage (in a database called &ldquo;offersheet&rdquo;), next to any other leagues you&apos;ve imported, until you remove it or clear this
          site&apos;s data. What&apos;s saved is what the Import Report shows: the league&apos;s settings, teams and owners&apos; names as the platform gives them, rosters,
          schedule and transactions, and the league&apos;s ID, so it can be fetched again. Your pick of &ldquo;Your team&rdquo; is saved with it.
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          Each browser tab remembers which of your saved leagues it shows, in that tab&apos;s session storage: only a short code made from the league&apos;s ID, and its
          season. Your tabs tell each other when you change something, with those codes only.
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          When you open the League page, our server fetches your league again (usually from its short-lived copy) along with the projections and trade values for its
          players, and scores the projections with your league&apos;s scoring rules. Your browser saves the latest projections and values with the league, and uses them
          again for up to 6 hours. The League page&apos;s math (lineups, needs, trade partners, playoff odds) runs in your browser; your league isn&apos;t sent to anyone
          else to be analyzed.
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          The Trade Finder and the Trade Analyzer use the same projections and values, kept and fetched the same way, and they search for and score trades in your
          browser too. A link to the Trade Finder for one team, or to a trade in the Trade Analyzer, carries only that team&apos;s ID number and the players&apos; ID
          numbers in its web address (never names or your league&apos;s ID; a trade opened from &ldquo;If they say no, try&rdquo; also says so there), and the
          Finder and the Analyzer put the team you pick and the trade you evaluate into their address the same way. Offer Sheet never loads these addresses ahead of time, so our server sees one only when you open it, like any web
          address.
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          &ldquo;Remove&rdquo; in the league menu at the top of every page deletes a league from this browser: its import, your team pick, its projections, and its
          settings and feedback (those stay while another season of the same league is saved, since they&apos;re shared).
        </p>
        <p className="mt-2 text-sm leading-relaxed">To go easy on ESPN, Sleeper and the other sources, our server keeps a copy of what it fetched for a limited time, then deletes it:</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
          <li>
            League data (settings, rosters, schedule and transactions): about 10 minutes. Transactions from weeks that ended more than a week ago rarely change, so they
            may be kept for up to 6 hours.
          </li>
          <li>A Sleeper username lookup (which leagues that username is in): 10 minutes.</li>
          <li>
            Public data that isn&apos;t about any league (player lists, projections and stats, player ID maps and the NFL schedule): up to a week, so a saved copy can
            stand in if a source is down.
          </li>
          <li>
            FantasyCalc&apos;s trade value lists (public too, one per league format, not about any one league): up to {config.market.fantasyCalcCurveDays} days.
            Once FantasyCalc answers, we don&apos;t ask it for that list again for a day. If it doesn&apos;t answer, we wait {minutes(FANTASYCALC_OUTAGE_HOLD_MS)}{" "}
            minutes before asking it again (up to {minutes(FANTASYCALC_OUTAGE_MAX_HOLD_MS)} while it stays down), and the newest saved list stands in for up to{" "}
            {config.market.fantasyCalcStaleDays} days; after that, an older one is used only to work out our own estimates of trade values until FantasyCalc is back.
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
        <h2 className="text-lg font-extrabold">Settings and trade feedback</h2>
        <p className="mt-2 text-sm leading-relaxed">
          These are saved with each league in this browser&apos;s IndexedDB storage, so they&apos;re there the next time you use Offer Sheet. They&apos;re read only in your
          browser and never sent to our server.
        </p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
          <li>
            Settings: what you choose on the Settings page for a league, and the &ldquo;Chance they accept: at least&rdquo; you pick on the Trade Finder. Each
            league&apos;s settings are filed under a short code made from its league ID (without the season, so a league renewed for next season keeps them), and hold
            player ID numbers and positions, never names.
          </li>
          <li>
            Trade feedback: when you mark what happened to a trade idea or report a problem with it (on the Trade Finder or the Trade Analyzer), it&apos;s saved with
            that league, for its latest 500 trade ideas, under the same short code as that league&apos;s settings. It holds the players and picks in the trade and the
            other team (all as ID numbers), Offer Sheet&apos;s numbers for the trade, when you pressed each button, and any note you typed. When you mark what
            happened, it also keeps which version you sent (a card can show more than one): its players as ID numbers too, Offer Sheet&apos;s estimate for it, and the
            numbers that estimate and its score were worked out from, such as how much trade value and lineup the other team would gain and how much the trade helps
            you, along with your &ldquo;What matters most&rdquo; setting.
          </li>
          <li>
            &ldquo;Export feedback&rdquo; on the Settings page downloads your feedback as a file. In the file your leagues are only numbered (league-1, league-2), and your
            notes appear exactly as you typed them.
          </li>
          <li>
            &ldquo;Reset to defaults&rdquo; on the Settings page removes a league&apos;s settings, &ldquo;Delete saved feedback&rdquo; removes all of your feedback,
            removing a league removes both for that league, and clearing this site&apos;s data in your browser removes everything.
          </li>
          <li>
            If you used Offer Sheet before October 4, 2026, your settings and feedback were in this browser&apos;s local storage (&ldquo;offersheet:settings:v1&rdquo;
            and &ldquo;offersheet:feedback:v1&rdquo;) and a tab&apos;s league in its session storage. Offer Sheet copied them into the new storage once and left the old
            copies as they were, unused. Removing a league or deleting your feedback deletes the old copies too, and a tab&apos;s session storage goes when you close the
            tab.
          </li>
        </ul>
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
            They&apos;re never saved with your leagues. A private league you saved stays saved after they&apos;re gone, but fetching it again needs them again.
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
          Your browser saves the username with each league you import with it, so the League page can find your team again.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Other sources</h2>
        <p className="mt-2 text-sm leading-relaxed">
          Our server also downloads public data: player lists and weekly projections and stats from Sleeper, player ID maps from DynastyProcess, trade values from
          FantasyCalc, and the NFL schedule. Some of these requests are shaped by your league&apos;s settings:
        </p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
          <li>
            Sleeper&apos;s projection and stats requests carry only the season, week numbers up to your league&apos;s last playoff week, and the positions your league
            starts (for example, whether it uses a kicker or IDP).
          </li>
          <li>
            The FantasyCalc request carries only your league&apos;s format: the number of teams, points per catch, how many quarterbacks start, dynasty or not, and any
            tight-end premium.
          </li>
        </ul>
        <p className="mt-2 text-sm leading-relaxed">
          They never carry names or IDs. The other requests (player lists, player ID maps and the NFL schedule) don&apos;t depend on your league at all (the schedule only
          on the season), so nothing about you or your league is sent with them.
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
