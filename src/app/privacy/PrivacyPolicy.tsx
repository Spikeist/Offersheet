import Link from "next/link";
import { ContactLine } from "@/components/ContactLine";
import { Card } from "@/components/ui";
import { FANTASYCALC_OUTAGE_HOLD_MS, FANTASYCALC_OUTAGE_MAX_HOLD_MS } from "@/data/fantasyCalcValues";
import { config } from "@/engine/config";
import type { PolicyFeatures } from "@/lib/site";
import { feedbackLimits, logLimits, rateLimits } from "@/server/limits";

/** When this policy last changed (Parker's local date). Update it with every change below, a feature turned on included. */
export const PRIVACY_LAST_UPDATED = "October 4, 2026";

/** A hold in whole minutes, for the FantasyCalc sentence. */
const minutes = (ms: number): number => Math.round(ms / 60_000);

/** A time window in words: "10 minutes", "an hour", "2 hours". */
function windowWords(seconds: number): string {
  if (seconds % 3600 === 0) return seconds === 3600 ? "an hour" : `${seconds / 3600} hours`;
  return `${Math.round(seconds / 60)} minutes`;
}

/** A number of days in words: "a year" for 365, else "N days". */
const daysWords = (days: number): string => (days === 365 ? "a year" : `${days} days`);

/** The route kinds whose requests the server counts: the feedback route exists only with anonymous feedback. */
export function countedKinds(features: PolicyFeatures): Array<"import" | "model" | "session" | "feedback"> {
  return features.anonymousFeedback ? ["import", "model", "session", "feedback"] : ["import", "model", "session"];
}

/**
 * The privacy policy's text (CLAUDE.md §14: it must match what the app actually does; update it whenever data handling
 * changes). Part B (planner reply to Checkpoint 4c, B3: "/privacy, rewritten to match what the app really does"; the
 * lead's Part B design, "Privacy facts" 1–8, which Part B's final review checks against the code). Its words follow
 * `features` (src/lib/site.ts POLICY_FEATURES; review PG-1): until track BF's browser reading and track FB's anonymous
 * feedback are built, the page says what the app does without them; src/app/pages.test.ts pins both. What each part
 * relies on:
 *   - Reading a league (fact 1). Without browserReads (today): the server reads every league itself, the import route
 *     and, for the League page, the model route (src/lib/api.ts EspnModelBody, SleeperModelBody: the league's ID and
 *     season and a Sleeper username, nothing saved in the browser), private ESPN leagues with the session's cookies;
 *     the Sleeper username lookup is the server's (src/adapters/sleeper/fetch.ts). With browserReads (track BF): public
 *     ESPN leagues (no session cookies connected) and Sleeper leagues are read by the browser (src/lib/browserHttp.ts:
 *     credentials "omit", no cookie ever; src/lib/leagueFetch.ts), which uploads the parts the adapters' schemas keep
 *     (src/app/api/_lib/upload.ts); the server pseudonymizes SWIDs, completes the import with its own public data and
 *     never writes browser-supplied data to the cache. The server still reads a league itself while ESPN cookies are
 *     connected (every ESPN league, public ones too), after a CORS/network failure or a timeout, and when the League
 *     page's saved import carries no valid signature (src/server/importToken.ts; leagues saved before browser reading,
 *     for example). The League page sends the saved import back, after reading the league again when its copy is older
 *     than the league TTL.
 *   - The server's cache (fact 2; track CA): src/server/cache.ts (TTL.league 10 min; TTL.closedTransactions 6 h for
 *     ESPN's transactions and Sleeper's transactions and matchups of league weeks that ended over a week ago:
 *     src/adapters/espn/fetch.ts closedCache, src/adapters/sleeper/fetch.ts CLOSED_WEEK_POLICY; public sources up to
 *     STALE_PUBLIC_RETAIN_MS, 7 days; FantasyCalc's value lists up to FANTASYCALC_RETAIN_MS,
 *     config.market.fantasyCalcCurveDays (90) days, one per league format, read fresh only within a day and otherwise
 *     only while FantasyCalc doesn't answer: a list at most config.market.fantasyCalcStaleDays (7) old stands in, an
 *     older one only calibrates our own value estimates, src/server/modelInputs.ts; "Once FantasyCalc answers, we don't
 *     ask it for that list again for a day", not "at most once a day": while it doesn't answer,
 *     src/data/fantasyCalcValues.ts's outage memory asks it nothing for FANTASYCALC_OUTAGE_HOLD_MS (5 minutes), doubling
 *     to at most FANTASYCALC_OUTAGE_MAX_HOLD_MS (15), per server instance). With Redis (src/app/api/_lib/deps.ts): a
 *     memory tier per instance (MemoryLruCache: an expired copy is never served, and is deleted when read or by a sweep
 *     that runs only while the instance handles requests, so a paused instance keeps it until it runs again or stops:
 *     review PG-6) in front of Upstash (RedisCache: SET … PX, the entry's retention), whose keys are
 *     hmacId("cache-key/v1", key) (src/server/redis.ts: an HMAC under a key derived from SESSION_SECRET), so league ids,
 *     usernames and credential scopes never reach a key; the database is the one Parker creates through the Vercel
 *     Marketplace, in Upstash's US East region (iad1; ⚠️ only if he picks it, the Checkpoint 7a steps; and with no
 *     Upstash backup turned on). src/adapters/espn: member IDs (SWIDs) become one-way pseudonyms before a body is
 *     cached; private-league keys carry a one-way fingerprint of the cookies (credentialScope).
 *   - Rate limits (fact 3; track RL): src/server/rateLimit.ts: per route kind, per client = hmacId("client-id/v1", the
 *     IP address, IPv6 by its /64), fixed windows from limits.rateLimits (import, model and session 10 minutes; feedback
 *     an hour, counted only once the feedback route exists). At Upstash, @upstash/ratelimit's fixed window sets a key's
 *     expiry to one window at the window's first request (PEXPIRE), so a count is deleted one window after it starts
 *     (it can outlive the window's end, never a window's length). In memory (no Redis, Redis down, and the record of
 *     refused clients) a count whose window ended is swept while the instance handles requests (review PG-6).
 *   - Anonymous feedback (fact 4; track FB, with anonymousFeedback): the event is built in the browser from the local
 *     record (src/lib/feedbackShare.ts) with only the fields listed on the page (zod-strict on the server,
 *     src/app/api/feedback; the version's players only when they aren't the card's, review FB-R7); src/server/feedbackSink.ts
 *     adds the UTC day it arrived, keeps the newest feedbackLimits.maxPerMonth per month and deletes each month's list
 *     feedbackLimits.retainDays after its last entry (one transaction sets the expiry with every copy, review FB-R5);
 *     scripts/feedback-pull.ts deletes its downloaded copies by the same rule on every run (review FB-R2: "on the same
 *     schedule"); "Share anonymous feedback" in Settings (on by default, stored per browser), the one-time note until the
 *     first copy leaves. Notes never leave the browser. Only the browser keeps a record's random code (and the export
 *     carries it: review FB-R3), so the server can't tell whose copies are whose; Delete saved feedback recalls nothing
 *     sent. Without it (today): nothing about feedback reaches the server.
 *   - Logs (fact 5; track RL): src/server/log.ts's allowlist (route, event, code, platform, status, errorName, ms), kept
 *     in Redis on Vercel only, each day's list deleted logLimits.retainDays (14) after the day began; Vercel's own
 *     runtime logs are kept 1 hour on the Hobby plan (vercel.com/docs/logs/runtime, 2026-08-28).
 *   - Providers (fact 6): Vercel (hosting), Upstash (the cache, the rate limits, the error log, and the feedback store
 *     with anonymousFeedback).
 *   - iPhone (fact 7): research, 2026-10-04: an installed Home Screen app keeps its own storage (firt.dev); Safari deletes
 *     what a site saved after 7 days of Safari use without a visit (MDN storage quotas, 2026-01).
 *   - Contact (fact 8): src/lib/site.ts CONTACT_EMAIL (src/components/ContactLine.tsx).
 *   - src/server/session.ts: the sealed, httpOnly, session-only cookie; 12-hour seal.
 *   - src/lib/leagueStore.ts (Phase 4c): every imported league is saved in this browser's IndexedDB, database
 *     "offersheet", until the user removes it or clears the site's data: the import (the snapshot, with team and owner
 *     names and the league id, and the request summary, never credentials), the "my team" pick, the latest model inputs
 *     (reused while under 6 hours old: modelStore.ts), settings and feedback (per leagueKey, settingsStore.ts: no
 *     season). Each tab keeps the saved league id it shows in sessionStorage ("offersheet:current-league:v1"), and tabs
 *     tell each other about changes with those ids only. src/workers/engine.worker.ts: the League math, the trade search
 *     and the Trade Analyzer run in the browser. The pre-4c storage (localStorage "offersheet:settings:v1" and
 *     "offersheet:feedback:v1") is copied in once and left unused; removing a league or deleting feedback deletes it.
 *   - src/lib/tradeView.ts finderHref / analyzerHref: links to the Trade Finder for one team and to a trade in the
 *     Analyzer carry team and player IDs in the URL query, never names or the league ID (`from=planB` says only where
 *     a trade was opened from); never prefetched (prefetch={false}).
 *   - src/lib/feedbackStore.ts: the local feedback records (the newest 500 per league; the trade's player, pick and
 *     partner team IDs, Offer Sheet's numbers and features, which version was sent with its key, estimate and model
 *     inputs, when each button was pressed, the typed note; with anonymousFeedback also the share id and the season, week
 *     and goal of the numbers, FeedbackRecord.basis and VersionInputs.week). "Export feedback" numbers the leagues and keeps
 *     the share id; "Delete saved feedback" removes it all.
 *   - src/server/modelInputs.ts: the server scores every player's projections and stats with the league's scoring rules
 *     and joins FantasyCalc values. The FantasyCalc request carries only the league's format (src/engine/market.ts
 *     fantasyCalcFormat); Sleeper's projection and stats requests carry the season, week numbers and the positions the
 *     lineup starts, never names or IDs; the player lists and ID maps don't depend on the league; the NFL schedule only
 *     on its season.
 */
export function PrivacyPolicy({ features }: { features: PolicyFeatures }) {
  const { browserReads, anonymousFeedback } = features;
  const longestWindow = windowWords(Math.max(...countedKinds(features).map((k) => rateLimits[k].windowS)));
  const importWindow = windowWords(rateLimits.import.windowS);
  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Privacy</h1>
        <p className="mt-2 text-muted">Plain answers about what Offer Sheet keeps, where, and for how long.</p>
        <p className="mt-1 text-sm text-muted">Last updated {PRIVACY_LAST_UPDATED}</p>
      </header>

      <Card>
        <h2 className="text-lg font-extrabold">The short version</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
          <li>No accounts, no ads and no tracking or analytics. We don&apos;t sell or share your data, and we don&apos;t build profiles of you or your leaguemates.</li>
          <li>Offer Sheet only reads your league. It can&apos;t send offers or change anything.</li>
          {browserReads ? (
            <li>
              Your browser reads public ESPN leagues and Sleeper leagues straight from ESPN and Sleeper, and sends our server only the parts Offer Sheet needs. Our
              server still reads a league itself while you&apos;re connected with ESPN cookies (a private ESPN league needs them), when your browser can&apos;t, and
              when it can&apos;t use the copy your browser saved.
            </li>
          ) : (
            <li>
              Our server reads your league from ESPN or Sleeper and scores each player&apos;s projections with your league&apos;s rules. The League page&apos;s math
              (lineups, needs, trade partners, playoff odds), the trade search and the Trade Analyzer all run in your browser.
            </li>
          )}
          <li>
            The leagues you import stay saved in this browser, with your team pick, your settings for each, the projections the League page loaded for them and any
            feedback you give on trade ideas, until you remove a league or clear this site&apos;s data.
            {browserReads ? null : (
              <>
                {" "}
                What&apos;s saved is read only in your browser: our server gets only what it needs to read a league again (its ID and season, and a Sleeper username
                you entered).
              </>
            )}
          </li>
          <li>
            Our server keeps copies of what it reads{browserReads ? " itself" : ""} for a limited time (league data for about 10 minutes), filed under codes that hide
            league IDs, then deletes them.{browserReads ? " It never keeps the league data your browser sends it." : null}
          </li>
          {anonymousFeedback ? (
            <li>
              When you mark what happened to a trade idea or report a problem with it, your browser also sends Offer Sheet an anonymous copy, to improve its estimates:
              never your league&apos;s ID, names, usernames or the notes you type. You can turn this off in Settings.
            </li>
          ) : null}
          <li>
            To keep things fair, our server counts requests under a one-way code made from your IP address, never the address itself. The counts it keeps at Upstash
            are deleted within {longestWindow}.
          </li>
          <li>
            If you connect with ESPN cookies, they&apos;re kept only in an encrypted cookie in your browser for this session, and only ever sent to ESPN. They&apos;re never
            saved with your leagues.
          </li>
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Reading your league</h2>
        {browserReads ? (
          <>
            <p className="mt-2 text-sm leading-relaxed">
              When you connect a public ESPN league or a Sleeper league, your browser reads it straight from ESPN or Sleeper. Like any site your browser talks to, they
              see your IP address, which league (or Sleeper username) your browser asks for, and that the request comes from Offer Sheet. Your browser sends them no
              cookies with these requests.
            </p>
            <p className="mt-2 text-sm leading-relaxed">
              Your browser then sends our server only the parts of the answers Offer Sheet reads (the league&apos;s settings, teams and owners&apos; names, rosters,
              schedule and transactions, for ESPN its free agents, projections and injured players&apos; expected return dates, and for Sleeper the username you
              entered, which finds your team), and our server turns them into the Import Report with public data it keeps itself, such as player lists and
              projections. Our server uses what your browser sends for that one request: it never saves it.
            </p>
            <p className="mt-2 text-sm leading-relaxed">
              If your browser can&apos;t reach ESPN or Sleeper (some ad blockers and work or school networks stop it), our server reads the league itself instead. It
              does the same for your ESPN leagues, public ones too, while you&apos;re connected with your ESPN cookies, which a private league needs (below).
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm leading-relaxed">
            When you connect a league, our server reads it from ESPN or Sleeper (a private ESPN league with the ESPN cookies you give it, below), turns it into the
            Import Report with public data it keeps itself, such as player lists and projections, and sends that to your browser.
          </p>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Your leagues in this browser</h2>
        <p className="mt-2 text-sm leading-relaxed">
          Your browser saves each league you import in its IndexedDB storage (in a database called &ldquo;offersheet&rdquo;), next to any other leagues you&apos;ve
          imported, until you remove it or clear this site&apos;s data. What&apos;s saved is what the Import Report shows: the league&apos;s settings, teams and
          owners&apos; names as the platform gives them, rosters, schedule and transactions, and the league&apos;s ID, so it can be read again. Your pick of &ldquo;Your
          team&rdquo; is saved with it.
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          Each browser tab remembers which of your saved leagues it shows, in that tab&apos;s session storage: only a short code made from the league&apos;s ID, and its
          season. Your tabs tell each other when you change something, with those codes only.
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          {browserReads ? (
            <>
              When you open the League page, your browser sends the league it saved to our server (reading it again first when its copy is more than 10 minutes old),
              and our server adds the projections and trade values for its players and scores the projections with your league&apos;s scoring rules. If our server
              can&apos;t use the copy your browser sends (one saved before Offer Sheet read leagues in your browser, for example), it reads the league itself.
            </>
          ) : (
            <>
              When you open the League page, our server reads your league again (usually from its short-lived copy) along with the projections and trade values for
              its players, and scores the projections with your league&apos;s scoring rules.
            </>
          )}{" "}
          Your browser saves the latest projections and values with the league, and uses them again for up to 6 hours. The League page&apos;s math (lineups, needs,
          trade partners, playoff odds) runs in your browser; your league isn&apos;t sent to anyone else to be analyzed.
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          The Trade Finder and the Trade Analyzer use the same projections and values, kept and fetched the same way, and they search for and score trades in your
          browser too. A link to the Trade Finder for one team, or to a trade in the Trade Analyzer, carries only that team&apos;s ID number and the players&apos; ID
          numbers in its web address (never names or your league&apos;s ID; a trade opened from &ldquo;If they say no, try&rdquo; also says so there), and the Finder
          and the Analyzer put the team you pick and the trade you evaluate into their address the same way. Offer Sheet never loads these addresses ahead of time, so
          our server sees one only when you open it, like any web address.
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          &ldquo;Remove&rdquo; in the league menu at the top of every page deletes a league from this browser: its import, your team pick, its projections, and its
          settings and feedback (those stay while another season of the same league is saved, since they&apos;re shared).
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Our server&apos;s copies</h2>
        <p className="mt-2 text-sm leading-relaxed">
          To go easy on ESPN, Sleeper and the other sources, our server keeps copies of what it reads{browserReads ? " itself" : ""}, then deletes them:
        </p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
          <li>
            {browserReads
              ? "League data our server reads itself (private ESPN leagues, any ESPN league while you're connected with ESPN cookies, any league your browser couldn't read, and any league whose saved copy our server couldn't use): about 10 minutes."
              : "League data (settings, rosters, schedule and transactions): about 10 minutes."}{" "}
            Transactions and matchups from weeks that ended more than a week ago rarely change, so they may be kept for up to 6 hours.
          </li>
          <li>A Sleeper username lookup{browserReads ? " our server makes" : ""} (which leagues that username is in): 10 minutes.</li>
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
          These copies are kept at Upstash, the database service we use through Vercel, in its US East region, each filed under a code made with a secret key only our
          server has, so league IDs and usernames never appear in the database&apos;s keys, and each copy is encrypted with another such key before it is stored,
          so Upstash holds only text it can&apos;t read. Upstash deletes each copy when its time is up. Our servers may also hold
          copies in their memory: a server stops using a copy when its time is up and deletes it soon after while it keeps running, and everything in its memory is
          gone when it shuts down.{browserReads ? " League data your browser sends our server is never among these copies." : null}
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          Data from a private ESPN league is filed under a one-way fingerprint of your cookies too, so someone else who types the same league ID can&apos;t see it.
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          ESPN league data includes every member&apos;s ESPN member ID (the SWID), yours among them. Before our server keeps a copy, it replaces every member ID with a
          one-way pseudonym, so the saved copy holds no SWIDs.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Limits on requests</h2>
        <p className="mt-2 text-sm leading-relaxed">
          To keep Offer Sheet free and fair for everyone, our server limits how many requests one visitor can send{" "}
          {anonymousFeedback
            ? `in a short window (${importWindow} for imports and the League page, ${windowWords(rateLimits.feedback.windowS)} for feedback)`
            : `in ${importWindow}`}
          . It counts them under a one-way code made from your IP address with a secret key, never the address itself. Each count kept at Upstash is deleted one
          window after it starts, so within {longestWindow}. A count a server holds in its memory is deleted soon after its window ends while that server keeps
          running, and is gone when it shuts down.
        </p>
      </Card>

      {anonymousFeedback ? (
        <Card>
          <h2 className="text-lg font-extrabold">Anonymous feedback</h2>
          <p className="mt-2 text-sm leading-relaxed">
            When you press Sent, Accepted, Rejected or Countered on a trade idea, or report a problem with one, your browser saves it with that league (below). Unless
            you turn it off, it also sends Offer Sheet an anonymous copy, used only to improve how Offer Sheet estimates trades. The copy holds:
          </p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
            <li>what you pressed (the outcome, or the report&apos;s reason) and which version of the idea you sent;</li>
            <li>the platform (ESPN or Sleeper), the season and the week;</li>
            <li>
              your league&apos;s format: the number of teams, whether it&apos;s redraft, keeper or dynasty, the points per catch and per passing touchdown, any
              tight-end premium, whether it starts a second quarterback, how many of each lineup slot it starts, and how many teams make the playoffs;
            </li>
            <li>your &ldquo;What matters most&rdquo; setting;</li>
            <li>the players in the trade, and in the version you sent when it differs, as ID numbers with their positions;</li>
            <li>
              Offer Sheet&apos;s numbers for the trade (Helps you, the chance they accept, Overall, and the figures behind them, such as the change in your playoff and
              title odds) and what its estimate of the chance they accept was worked out from;
            </li>
            <li>a random code your browser makes for that one record, so a later change to it (an outcome after &ldquo;Sent&rdquo;) can be matched to it.</li>
          </ul>
          <p className="mt-2 text-sm leading-relaxed">Our server stores it with the day it arrived (the date, not the time).</p>
          <p className="mt-2 text-sm leading-relaxed">
            It never holds your league&apos;s ID, team IDs, team or owner names, usernames, ESPN member IDs (SWIDs), cookies, the code your browser files your league
            under, or any note you type: notes stay in your browser.
          </p>
          <p className="mt-2 text-sm leading-relaxed">
            We keep at most the newest {feedbackLimits.maxPerMonth.toLocaleString("en-US")} a month, at Upstash, and delete each month&apos;s feedback{" "}
            {daysWords(feedbackLimits.retainDays)} after the last one that month. Offer Sheet&apos;s developer downloads it from there to study it, and deletes the
            downloaded copies on the same schedule.
          </p>
          <p className="mt-2 text-sm leading-relaxed">
            Offer Sheet can&apos;t tell which copies are yours. The random code a record&apos;s copies carry stays only in your browser (and in any file you save with
            &ldquo;Export feedback&rdquo;), so only someone with your browser or that file could match copies to you. Turning sharing off stops new copies; deleting
            your saved feedback doesn&apos;t take back copies already sent.
          </p>
          <p className="mt-2 text-sm leading-relaxed">
            To stop sending it, turn off &ldquo;Share anonymous feedback&rdquo; on the{" "}
            <Link href="/settings" className="font-semibold underline underline-offset-2">
              Settings page
            </Link>
            . That choice is saved in this browser, for every league. The{" "}
            <Link href="/feedback" className="font-semibold underline underline-offset-2">
              feedback page
            </Link>{" "}
            says more.
          </p>
        </Card>
      ) : null}

      <Card>
        <h2 className="text-lg font-extrabold">Settings and trade feedback in this browser</h2>
        <p className="mt-2 text-sm leading-relaxed">
          These are saved with each league in this browser&apos;s IndexedDB storage, so they&apos;re there the next time you use Offer Sheet.{" "}
          {anonymousFeedback
            ? "Your settings never leave your browser, except your “What matters most” setting in the anonymous feedback above. Your feedback stays here too, apart from that anonymous copy, which leaves out your notes."
            : "They're read only in your browser and never sent to our server."}
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
            {anonymousFeedback
              ? " It also keeps the week and season Offer Sheet's numbers were worked out for, your “What matters most” setting for the trade's own numbers, and the random code its anonymous copies carry (above)."
              : null}
          </li>
          <li>
            &ldquo;Export feedback&rdquo; on the Settings page downloads your feedback as a file. In the file your leagues are only numbered (league-1, league-2), and your
            notes appear exactly as you typed them.
            {anonymousFeedback ? " It includes each record's random code, which matches it to its anonymous copies." : null}
          </li>
          <li>
            &ldquo;Reset to defaults&rdquo; on the Settings page removes a league&apos;s settings, &ldquo;Delete saved feedback&rdquo; removes all of your feedback,
            removing a league removes both for that league, and clearing this site&apos;s data in your browser removes everything.
            {anonymousFeedback ? " Anonymous copies already sent stay at Upstash for their year (above)." : null}
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
            They&apos;re never saved with your leagues. A private league you saved stays saved after they&apos;re gone, but reading it again needs them again.
          </li>
          <li>
            Our server reads them only to read your league, and sends them only to ESPN. Your espn_s2 cookie is never stored on our server or written to logs, and your
            SWID is kept only as the one-way pseudonym described above.
          </li>
          <li>
            &ldquo;Forget my credentials&rdquo; on the{" "}
            <Link href="/connect" className="font-semibold underline underline-offset-2">
              Connect page
            </Link>{" "}
            (or &ldquo;Forget my ESPN cookies&rdquo; on the Import Report) deletes the cookie right away. League data our server copied with it expires within about 10
            minutes (older weeks&apos; transactions within 6 hours) and is then deleted.
          </li>
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Sleeper</h2>
        <p className="mt-2 text-sm leading-relaxed">
          {browserReads ? (
            <>
              Sleeper leagues are public. If you enter a username, your browser asks Sleeper which leagues it&apos;s in, to find your leagues and your team (if your
              browser can&apos;t reach Sleeper, our server asks instead and keeps that lookup for 10 minutes). Your browser sends the username to our server with the
              league you import, only to find your team there, and saves it with each league you import with it, so it can find your team again.
            </>
          ) : (
            <>
              Sleeper leagues are public. If you enter a username, our server uses it only to look up your leagues and find your team, and keeps that lookup for 10
              minutes. Your browser saves the username with each league you import with it, so the League page can find your team again.
            </>
          )}
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
        <h2 className="text-lg font-extrabold">Logs</h2>
        <p className="mt-2 text-sm leading-relaxed">
          Vercel, which hosts Offer Sheet, keeps a log of the requests it serves for Offer Sheet for 1 hour on our plan: the method, the web address and its query, the
          status, the type of browser and the region. Vercel can see IP addresses.
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          Our own error log keeps, for {logLimits.retainDays} days, only which part of Offer Sheet had a problem and what kind: an error code, the data source involved
          (ESPN or Sleeper, for example), the status it answered with, the error&apos;s type and how long the request took. Never league data, names, IDs, usernames,
          cookies or IP addresses.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Who handles the data</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
          <li>
            Vercel hosts Offer Sheet and runs its server (
            <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">
              Vercel&apos;s privacy policy
            </a>
            ).
          </li>
          <li>
            Upstash keeps our server&apos;s copies, the request counts{anonymousFeedback ? ", the anonymous feedback" : ""} and the error log (
            <a href="https://upstash.com/trust/privacy.pdf" target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">
              Upstash&apos;s privacy policy
            </a>
            ).
          </li>
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">On an iPhone or iPad</h2>
        <p className="mt-2 text-sm leading-relaxed">
          Safari may delete what a site saved in your browser, your saved leagues, settings and feedback included, after you use Safari for 7 days without visiting
          Offer Sheet. If you add Offer Sheet to your Home Screen, the app you open from there keeps its own saved leagues, apart from Safari&apos;s, so import your
          leagues again inside it.
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-extrabold">Children, changes and contact</h2>
        <p className="mt-2 text-sm leading-relaxed">Offer Sheet isn&apos;t directed at children under 13.</p>
        <p className="mt-2 text-sm leading-relaxed">If this policy changes, we&apos;ll update it here and change the date above.</p>
        <ContactLine className="mt-2 text-sm leading-relaxed" />
        <p className="mt-2 text-sm leading-relaxed">
          Offer Sheet is an independent project, not affiliated with or endorsed by ESPN, Sleeper, Yahoo, Fleaflicker, MyFantasyLeague, Fantrax, FantasyCalc or the
          NFL. See also the{" "}
          <Link href="/terms" className="font-semibold underline underline-offset-2">
            terms of use
          </Link>
          .
        </p>
      </Card>
    </article>
  );
}
