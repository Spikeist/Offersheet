import Link from "next/link";
import { ContactLine } from "@/components/ContactLine";
import { Card } from "@/components/ui";
import { config } from "@/engine/config";
import type { PolicyFeatures } from "@/lib/site";
import { DAY, HOUR, MINUTE, TTL } from "@/server/cache";
import { browserFetchLimits, feedbackLimits, logLimits, snapshotLimits } from "@/server/limits";

/**
 * When this policy last changed. The go/no-go set it to launch day, when the page goes public, so changes before launch keep
 * it (Checkpoint 7c's edits did); after launch, update it with every change below, a feature turned on included.
 */
export const PRIVACY_LAST_UPDATED = "October 13, 2026";

/** A length of time in words: "a day", "an hour", "3 hours", "15 minutes". */
export function durationWords(ms: number): string {
  if (ms === DAY) return "a day";
  if (ms === HOUR) return "an hour";
  if (ms % HOUR === 0) return `${ms / HOUR} hours`;
  return `${Math.round(ms / MINUTE)} minutes`;
}

/** A list in words: "a", "a and b", "a, b and c". */
export function listWords(items: readonly string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** How long anonymous feedback is kept, in words: "12 months" for 365 days, else "N days". */
export const feedbackKeptWords = (days: number): string => (days === 365 ? "12 months" : `${days} days`);

const P = "mt-2 text-sm leading-relaxed";
const UL = "mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed";
const A = "font-semibold underline underline-offset-2";

/**
 * The privacy policy's text (CLAUDE.md §14: it must match what the app actually does; update it whenever data handling
 * changes). Checkpoint 7b (planner reply to Checkpoint 7a, 3, 4 and 5.4): shortened for users ("The short version" first,
 * with the cookie line; the detailed part after it from about 3,000 words to about 1,250, pages.test.ts holding it there);
 * implementation details cut (the browser database's name, tabs' session codes and messages, the old storage keys, how
 * trade-page addresses carry IDs, how the model routes reuse a signed import, the rate limits' windows and counts);
 * feedback kept up to 12 months with no download promise; the daily totals and FantasyCalc's conditions added. Checkpoint
 * 7c (planner reply to Checkpoint 7b, section 3: "approved, with small edits"): "Email us to ask what we hold about you or
 * to have it deleted." just before the contact line, the archive sentence naming the daily rest-of-season levels (with
 * dailyLevels), the anonymous copy's prize split in place of how the title is weighed against the playoffs (with
 * prizeShares), and the detailed part held at 1,300 words. Its words follow `features` (src/lib/site.ts POLICY_FEATURES;
 * review PG-1): each sentence that rests on a feature shows only while the feature is built, and src/app/pages.test.ts
 * fails while a flag and the code disagree. What each part relies on:
 *   - Cookies: src/server/session.ts is the only code that sets one (the sealed, httpOnly, session-only
 *     "offersheet_session", Path=/, SESSION_SEAL_TTL_SECONDS: a 12-hour seal, so a cookie a browser restores with its
 *     session stops working then), through src/app/api/session/espn (connect, forget); no browser code writes a cookie.
 *   - Reading a league (with browserReads): src/lib/browserHttp.ts (credentials "omit"), src/lib/leagueFetch.ts and the
 *     upload's parts (src/app/api/_lib/upload.ts: the league's settings, members, rosters, matchups and transactions,
 *     ESPN's free agents, projections and player cards, Sleeper's traded picks, drafts and playoff bracket (since
 *     Checkpoint 7c, each match's round, number and place only) and the username); the server
 *     never caches browser-supplied data. The model routes keep the answer they build from a saved league the browser
 *     sends (src/app/api/model/memo.ts: per instance, in memory only) until the import's token expires,
 *     browserFetchLimits.tokenMaxAgeMs (15 minutes) after the league was read (review of Checkpoint 7b's text: "doesn't
 *     keep them" was false while that holds ESPN's projections from the upload, players[id].espn). The server reads a
 *     league itself after a CORS, network or timeout failure, without CompressionStream, for an ESPN league imported while
 *     ESPN cookies were connected (every later read too, ImportResponse.usedEspnCookies) and when it can't check a saved
 *     import's signature (src/server/importToken.ts). Without browserReads: the server reads every league.
 *   - The browser: src/lib/leagueStore.ts (IndexedDB) keeps each league's import, "my team", model inputs (reused under 6
 *     hours: src/lib/modelStore.ts MODEL_REUSE_MAX_AGE_MS), settings and feedback (src/lib/settingsStore.ts,
 *     src/lib/feedbackStore.ts: the newest 500 per league) until removed; the League math, the trade search and the
 *     Analyzer run in the browser (src/workers/engine.worker.ts). The League page reads a league again when its copy is
 *     over browserFetchLimits.reimportAfterMs (10 minutes) old.
 *   - The server's copies: src/server/cache.ts TTL (league 10 minutes; closed weeks' transactions and matchups 6 hours;
 *     public sources STALE_PUBLIC_RETAIN_MS, a week; FantasyCalc's lists kept FANTASYCALC_RETAIN_MS,
 *     config.market.fantasyCalcCurveDays days, for outages). FantasyCalc: only a usable list is cached
 *     (src/data/fantasyCalcValues.ts getPublicSource's check), and a cached one is served fresh for TTL.fantasyCalc, so
 *     "once our server has a format's list, it doesn't ask for it again for 3 hours", never "at most once every 3 hours":
 *     during an outage the gate (fantasyCalcGate) probes every 5 to 15 minutes per instance, and a 404 or a list that fails
 *     the checks is asked again by the next build (review of Checkpoint 7b's text; HEAD's "once FantasyCalc answers",
 *     review POL-2). Only League page builds ask (src/server/modelInputs.ts), and the snapshot cron for a format one read
 *     that day or the day before (src/server/snapshots.ts, through the same loader and cache): "only when needed". Upstash
 *     keys are HMACs (src/server/redis.ts hmacId), values AES-256-GCM encrypted (RedisCache), SWIDs pseudonymized before
 *     caching, private-league keys carry a credential fingerprint. In memory (the cache's memory tier, MemoryLruCache, and the model
 *     routes' answers): never served once due, deleted on a later read or sweep while the instance handles requests (a
 *     paused instance holds them until it runs again or stops: review PG-6), gone when it stops. The database: Upstash's
 *     US East region (us-east-1) with backups off (planner reply to Checkpoint 7a, 1; ⚠️ Parker checks backups in
 *     Upstash's console, and the 7b go/no-go re-checks it).
 *   - The public-data archive (with publicArchive; planner reply to Checkpoint 7a, 4.4 and 6.3): the snapshot cron
 *     (vercel.json, src/app/api/cron/snapshot, src/server/snapshots.ts) keeps Sleeper's pre-game projections (each week
 *     snapshotLimits.retainDays, 730: 2 seasons, after its last write) and the day's FantasyCalc lists for the formats League
 *     page builds read that day or the day before (src/app/api/cron/snapshot/formats.ts: format keys only, a set per UTC day
 *     kept snapshotLimits.formatsInUseRetainDays, 3), each list and the day's index naming their formats until retainDays
 *     after that day began (snapshots.ts dayRetainMs), never shown. So the archive says which formats were in use each day
 *     for 2 seasons (review of Phase 7b: "isn't about any league or person" left that out, and the page said the formats were
 *     noted for 3 days while one index a season kept them up to about 3 years); the builds' own 3-day record is the same
 *     fact for less time, so "Daily totals" no longer names it. Not "data we fetch anyway": a run fetches what the model
 *     builds' cache doesn't hold. `npm run snapshot:pull` deletes its local copies by the same rule (pruneLocalLists).
 *     With dailyLevels (Checkpoint 7c; planner reply to Checkpoint 7b, question 4: "only from public projections: standard
 *     scoring formats only, never per league, and never blended with trade values. Keep them 730 days"): the same run saves
 *     each UTC day's rest-of-season levels (snapshots.ts snapshotLevels, key snap:lvl:<season>:<day>, until retainDays after
 *     that day began, dayRetainMs): every offense player's mean of Sleeper's own standard, half-PPR and PPR totals over the
 *     weeks left (src/server/projectionLevels.ts LEVEL_TOTALS), never a league's scoring, the model's blended projections or
 *     FantasyCalc, and nothing about the formats in use, so "its daily rest-of-season projections in standard scoring
 *     formats" adds nothing about any league or person, and the second sentence holds as it is. No page reads them.
 *   - Limits (src/server/rateLimit.ts, src/server/budget.ts): the short version's sentence, the planner's words (4.2):
 *     every count under an HMAC of the IP address (or its block) with a key derived from SESSION_SECRET; a window's count at
 *     Upstash goes one window after it starts (an hour at most), a day's count a minute after the UTC day ends, a count in
 *     a server's memory soon after (or with the server): "deleted within a day".
 *   - The daily totals (planner reply to Checkpoint 7a, 2.7: `npm run usage:report`; src/server/usage.ts USAGE_COUNTERS):
 *     imports, League page builds, work units, refusals and the server's requests per source, per UTC day, with no
 *     identifier, each kept usageLimits.retainDays (400) after its day's last count: "about 13 months".
 *   - Anonymous feedback (with anonymousFeedback): src/lib/feedbackShare.ts builds the copy, the route's strict schema
 *     (src/server/feedbackSink.ts) refuses anything else and adds the UTC day; each day's list goes
 *     feedbackLimits.retainDays (365) after its UTC day began (feedbackSink.ts feedbackDayTtlMs), so no copy is kept longer
 *     than "12 months". With feedbackTotalsOnly (planner reply to Checkpoint 7a, 4.3): studying it keeps only totals and
 *     fitted numbers (`npm run feedback:report`, scripts/feedback-report.ts, reads the store and writes totals only; it
 *     replaced `npm run feedback:pull`, which saved the copies themselves). The copy's goal field is described by what it
 *     weighs, not by the setting's label, which Checkpoint 7b rewords (5.2). With
 *     prizeShares (Checkpoint 7c; planner reply to Checkpoint 7b, sections 3 and 6: "the anonymous copy holds the reward
 *     setting as shares only"), the copy also holds the league's prize split as whole-percent shares, which the server's
 *     schema (feedbackSink.ts FeedbackEventSchema) takes and no amount, so the planner's words: "how your league splits its
 *     prizes (as shares, never amounts)".
 *   - Your rights (planner reply to Checkpoint 7b, section 3; shown whatever the features): asked, we can find only what a
 *     person points us to: mail from their address (the Gmail inbox), and their anonymous copies by what a file they export
 *     holds (since Checkpoint 7d's export, version 3, no share code, `rid`: its trades, days and the card's printed numbers,
 *     matched against each copy's players, UTC day and printed Helps you, chance and Overall; src/lib/feedbackStore.ts
 *     feedbackExport). Everything else is filed under codes made with
 *     the server's secret, which no one reads (SESSION_SECRET is never shown), held in a server's memory for minutes, or
 *     names no one, and goes on its own schedule (above). ⚠️ No tool deletes a copy by its code yet: by hand, in Upstash's
 *     console.
 *   - FantasyCalc never shown (with fantasyCalcHidden; 5.4): no value number or value comparison anywhere in the app.
 *   - Logs: src/server/log.ts's allowlist (the time, route, event, code, platform, status, error name, duration), each
 *     day's list deleted logLimits.retainDays (14) after the day began: errors and a few routine events (review of Phase 7b:
 *     the snapshot cron logs "snapshot_run" on every run, src/app/api/cron/snapshot/handler.ts, so not "only what went
 *     wrong"); Vercel's runtime logs are kept 1 hour on Hobby (vercel.com/docs/logs/runtime, 2026-08-28).
 *   - Forget (ESPN cookies): the cookie at once; the league data cached with it TTL.league (10 minutes; older weeks'
 *     transactions 6 hours); and a League page that sends back a signed import read with the cookies (src/lib/modelStore.ts
 *     modelPlan sends a fresh signed import before it looks at usedEspnCookies) leaves the answer built from it, ESPN's
 *     league-scored projections included, in the model route's memory until browserFetchLimits.tokenMaxAgeMs after the
 *     import (src/app/api/model/espn/handler.ts fromSignedImport): "copied or worked out with it ... within about 15
 *     minutes" (review of Phase 7b: the page said 10 minutes).
 *   - Providers: Vercel (functions in iad1: vercel.json), Upstash, and Google for the contact address's Gmail inbox
 *     (review of Checkpoint 7b's text: the pages publish it).
 *   - Other sources: src/data/sleeperProjections.ts sleeperRequestPositions (the offense, plus DL, LB and DB for a league
 *     that starts one), src/engine/market.ts fantasyCalcFormat; FantasyCalc's links (src/components/league/ValuesCredit.tsx
 *     FANTASYCALC_LINK) send only the site's origin.
 *   - iPhone: Safari deletes a site's storage after 7 days of use without a visit (MDN); an installed Home Screen app keeps
 *     its own storage (firt.dev, 2023, a secondary source: hence "may" until it's checked on an iPhone).
 *   - Contact: src/lib/site.ts CONTACT_EMAIL (src/components/ContactLine.tsx).
 */
export function PrivacyPolicy({ features }: { features: PolicyFeatures }) {
  const { browserReads, anonymousFeedback, fantasyCalcHidden, publicArchive, feedbackTotalsOnly, dailyLevels, prizeShares } = features;
  const itself = browserReads ? " itself" : "";
  const upstashKeeps = [
    "our server's copies",
    "the per-visitor counts",
    "the daily totals",
    ...(publicArchive ? ["the public data above"] : []),
    ...(anonymousFeedback ? ["the anonymous feedback"] : []),
    "the error log",
  ];
  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Privacy</h1>
        <p className="mt-2 text-muted">Plain answers about what Offer Sheet keeps, where, and for how long.</p>
        <p className="mt-1 text-sm text-muted">Last updated {PRIVACY_LAST_UPDATED}</p>
      </header>

      <Card>
        <h2 className="text-lg font-extrabold">The short version</h2>
        <ul className={UL}>
          <li>
            No accounts, no ads and no tracking or analytics. We don&apos;t sell your data or share it with anyone but the services that run Offer Sheet and the
            sites it reads for you (below), and we don&apos;t build profiles of you or your leaguemates.
          </li>
          <li>Offer Sheet only reads your league. It can&apos;t send offers or change anything.</li>
          <li>Offer Sheet sets no cookies, except one encrypted cookie if you connect a private ESPN league.</li>
          <li>
            If you connect with ESPN cookies, they&apos;re kept only in that encrypted cookie, for this browser session. Our server opens it only to read your
            league, and sends them only to ESPN.
          </li>
          {browserReads ? (
            <li>
              Your browser reads public ESPN leagues and Sleeper leagues straight from ESPN and Sleeper, and sends our server only the parts Offer Sheet needs. Our
              server still reads some leagues itself, such as private ESPN leagues.
            </li>
          ) : (
            <li>
              Our server reads your league from ESPN or Sleeper and scores its players&apos; projections with your league&apos;s rules. The League page, the trade
              search and the Trade Analyzer do their math in your browser.
            </li>
          )}
          <li>
            The leagues you import stay saved in this browser, with your team pick, settings, projections and feedback, until you remove a league or clear this
            site&apos;s data.
          </li>
          <li>
            Our server keeps copies of what it reads{itself} for a limited time (league data for about 10 minutes), filed under codes that hide league IDs, then
            deletes them.{browserReads ? " It never adds the league data your browser sends it to those copies." : null}
          </li>
          {anonymousFeedback ? (
            <li>
              When you mark what happened to a trade idea or report a problem with it, your browser also sends Offer Sheet an anonymous copy, to help improve it:
              never your league&apos;s ID, names, usernames or the notes you type. We keep it for up to {feedbackKeptWords(feedbackLimits.retainDays)}. You can
              turn this off in Settings.
            </li>
          ) : null}
          <li>Our server has per-visitor limits, counted under codes made from your IP address with a secret key, deleted within a day.</li>
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Reading your league</h2>
        {browserReads ? (
          <>
            <p className={P}>
              Your browser reads public ESPN and Sleeper leagues without cookies, but as with any site, ESPN and Sleeper see your IP address, which league it asks
              for, and that the request comes from Offer Sheet. It sends our server only the parts Offer Sheet uses (the ones it saves, below, and extras such as
              ESPN&apos;s projections). Our server doesn&apos;t save them, but holds the numbers it works out from them in memory for up to{" "}
              {durationWords(browserFetchLimits.tokenMaxAgeMs)}.
            </p>
            <p className={P}>
              Our server reads a league itself for private ESPN leagues and any ESPN league imported with ESPN cookies (even after you forget them), when your
              browser can&apos;t (some ad blockers and networks block it), and when our server can&apos;t use the copy your browser saved.
            </p>
            <p className={P}>
              If you enter a Sleeper username, your browser (or our server, if your browser can&apos;t) asks Sleeper which leagues it&apos;s in. The username is saved
              with those leagues and sent to our server with their requests, only to find your team.
            </p>
          </>
        ) : (
          <>
            <p className={P}>
              When you connect a league, our server reads it from ESPN or Sleeper (a private ESPN league with the ESPN cookies you give it, below) and adds public
              data to make the Import Report.
            </p>
            <p className={P}>
              A Sleeper username you enter is used only to find your leagues and your team. Your browser saves it with those leagues, to find your team again.
            </p>
          </>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">What stays in your browser</h2>
        <p className={P}>
          Your browser saves each league you import: what the Import Report shows (settings, teams and owners&apos; names, rosters, schedule and transactions), its
          ID, your team pick and settings, the projections and trade values our server sent, and your feedback on trade ideas, notes included, for the latest 500
          ideas.{" "}
          {anonymousFeedback
            ? "Your settings never leave your browser, except the one setting the anonymous feedback includes."
            : "Your settings and feedback never leave your browser."}
        </p>
        <p className={P}>
          {browserReads
            ? "Opening the League page sends the saved league to our server, which adds projections and trade values for its players."
            : "Opening the League page has our server read your league again (usually from its short-lived copy) and add projections and trade values for its players; it gets only what it needs to read the league (its ID and season, and a Sleeper username)."}{" "}
          The math (lineups, odds, trade ideas) runs in your browser.
        </p>
        <p className={P}>
          To delete: &ldquo;Remove&rdquo; in the league menu deletes a league and what&apos;s saved with it (its settings and feedback stay while another season of
          it is saved). On the Settings page, &ldquo;Reset to defaults&rdquo; removes a league&apos;s settings and &ldquo;Delete saved feedback&rdquo; your
          feedback; clearing this site&apos;s data removes everything.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Our server&apos;s copies</h2>
        <p className={P}>
          Our server keeps copies of what it reads{itself}, then deletes them: league data after about 10 minutes (older weeks&apos; transactions and matchups after
          up to 6 hours), a Sleeper username lookup after 10 minutes, public data that isn&apos;t about any league after up to a week, and FantasyCalc&apos;s trade
          value lists after up to {config.market.fantasyCalcCurveDays} days, in case FantasyCalc is down. Once it has a format&apos;s list, it doesn&apos;t ask
          FantasyCalc for it again for {durationWords(TTL.fantasyCalc)}, and asks only when needed.
        </p>
        <p className={P}>
          The copies are kept at Upstash under codes made with a secret key, so league IDs and usernames never appear there, and encrypted, so Upstash can&apos;t
          read them. A private ESPN league&apos;s copies are also filed under a fingerprint of your cookies, so typing its ID isn&apos;t enough to see them, and ESPN
          member IDs (SWIDs) are replaced with one-way pseudonyms. Anything our servers hold in memory stops being used once it&apos;s due, is deleted soon after
          while the server keeps working, and is gone when it shuts down.
        </p>
        {publicArchive ? (
          <p className={P}>
            We also keep public data, Sleeper&apos;s pre-game projections
            {dailyLevels ? ", its daily rest-of-season projections in standard scoring formats," : null} and FantasyCalc&apos;s daily lists for the league
            formats in use, up to {snapshotLimits.retainDays / 365} seasons, to measure how accurate our numbers are. It&apos;s never shown and says nothing about
            any league or person beyond which formats were in use each day.
          </p>
        ) : null}
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Daily totals</h2>
        <p className={P}>
          Each day (UTC), our server counts the leagues imported, League pages built, the work they took, requests refused and requests made to each source, and
          keeps these totals about 13 months. None of this says who made the requests.
        </p>
      </Card>

      {anonymousFeedback ? (
        <Card>
          <h2 className="text-lg font-extrabold">Anonymous feedback</h2>
          <p className={P}>
            Each anonymous copy is used only to improve Offer Sheet. It holds what you pressed and which version you sent; the platform, season and week; your
            league&apos;s format (teams, league type, main scoring settings, lineup and playoff spots) and{" "}
            {prizeShares ? "how your league splits its prizes (as shares, never amounts)" : "how you weigh the title against the playoffs"}; the players as ID
            numbers with positions; Offer Sheet&apos;s numbers for the trade and what they came from; a random code that links later changes to the same record;
            and the date it arrived.
          </p>
          <p className={P}>
            It never holds your league&apos;s ID in any form, team IDs, team or owner names, usernames, ESPN member IDs, cookies, your IP address or your notes.
            Only your browser, and a file you export, can tell which copies are yours, though the players, format and week could lead someone who searched public
            leagues to yours. We never try to match copies to anyone.
          </p>
          <p className={P}>
            We keep anonymous feedback for up to {feedbackKeptWords(feedbackLimits.retainDays)}, then delete it.
            {feedbackTotalsOnly ? " When we study it, we keep only totals and the numbers our estimates learn from it, never individual copies." : null} Turning
            off &ldquo;Share anonymous feedback&rdquo; on the{" "}
            <Link href="/settings" className={A}>
              Settings page
            </Link>{" "}
            stops new copies; deleting your saved feedback doesn&apos;t take back copies already sent (more on the{" "}
            <Link href="/feedback" className={A}>
              feedback page
            </Link>
            ).
          </p>
        </Card>
      ) : null}

      <Card>
        <h2 className="text-lg font-extrabold">ESPN cookies (private leagues only)</h2>
        <ul className={UL}>
          <li>They work like a password, so we treat them like one. We never ask for your ESPN password.</li>
          <li>
            They reach our server inside a request, never in a web address, and go into a cookie encrypted with a key only our server has and hidden from the
            page&apos;s scripts. Your browser sends it with each request to Offer Sheet and deletes it when you close your browser; even if your browser restores
            its session, it stops working after 12 hours.
          </li>
          <li>Our server never stores or logs your espn_s2 cookie, and your ESPN cookies are never saved with your leagues.</li>
          <li>
            &ldquo;Forget my credentials&rdquo; on the{" "}
            <Link href="/connect" className={A}>
              Connect page
            </Link>{" "}
            (or &ldquo;Forget my ESPN cookies&rdquo; on the Import Report) deletes the cookie right away; league data our server copied or worked out with it is
            deleted within about {durationWords(browserFetchLimits.tokenMaxAgeMs)} (older weeks&apos; transactions within 6 hours).
          </li>
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Other sources</h2>
        <p className={P}>
          Our server also downloads public data: player lists, projections and stats from Sleeper, the NFL schedule from ESPN, player ID maps from DynastyProcess, and
          trade values from FantasyCalc{fantasyCalcHidden ? ", which Offer Sheet uses in its own numbers but never shows" : null}. These requests carry no names or
          IDs, only things like the season, the week and your league&apos;s format. If you follow a link to FantasyCalc, it can see that you came from Offer Sheet,
          but not from which page.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Logs</h2>
        <p className={P}>
          Vercel, our host, logs each request it serves (its web address and the browser type, for example), keeps that log for 1 hour, and can see IP addresses.
          Our own log keeps errors and a few routine events, where and when (an error code and the source involved, for example), for up to {logLimits.retainDays}{" "}
          days: never league data, names, IDs, usernames, cookies or IP addresses.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Who handles the data</h2>
        <ul className={UL}>
          <li>
            Vercel hosts Offer Sheet and runs its server, in its US East region near Washington, D.C. (
            <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className={A}>
              Vercel&apos;s privacy policy
            </a>
            ).
          </li>
          <li>
            Upstash, our database service, in its US East region with backups turned off, keeps {listWords(upstashKeeps)} (
            <a href="https://upstash.com/trust/privacy.pdf" target="_blank" rel="noopener noreferrer" className={A}>
              Upstash&apos;s privacy policy
            </a>
            ).
          </li>
          <li>
            Google keeps the emails you send us (your address and message) in Offer Sheet&apos;s Gmail inbox, used only to answer you. Ask, and we&apos;ll delete them
            (
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className={A}>
              Google&apos;s privacy policy
            </a>
            ).
          </li>
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">On an iPhone or iPad</h2>
        <p className={P}>
          Safari may delete what Offer Sheet saved if you use Safari for 7 days without visiting Offer Sheet. A Home Screen app may keep its own saved leagues and
          settings{anonymousFeedback ? " (“Share anonymous feedback” included)" : ""}, apart from Safari&apos;s, so you may need to import your leagues there again.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Children, changes and contact</h2>
        <p className={P}>
          Offer Sheet isn&apos;t directed at children under 13. If this policy changes, we&apos;ll update it here and change the date above.
        </p>
        <p className={P}>Email us to ask what we hold about you or to have it deleted.</p>
        <ContactLine className={P} />
        <p className={P}>
          See also the{" "}
          <Link href="/terms" className={A}>
            terms of use
          </Link>
          .
        </p>
      </Card>
    </article>
  );
}
