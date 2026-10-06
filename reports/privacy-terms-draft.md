# Privacy policy and terms of use: final text for Checkpoint 7b

Written for the planner (who can't open the app) and Parker. Below is the full text of `/privacy`, `/terms`, `/feedback` and the footer, exactly as the app renders them today, generated from the pages themselves on 2026-10-05 (a throwaway script renders the components to text). At Checkpoint 7a this file held the first drafts; this is the shortened text the planner asked for in the reply to Checkpoint 7a (sections 3, 4 and 5.4), after a review against the code.

**Not legal advice.** Parker should read both before launch.

## What changed at Checkpoint 7b

- **Privacy, shorter.** "The short version" stays first and gains the cookie line: "Offer Sheet sets no cookies, except one encrypted cookie if you connect a private ESPN league." (Checked in the code: only the ESPN cookie session's connect and forget requests set a cookie, and nothing in the browser writes one.) Cut: the browser database's name, tabs' session codes and messages, the old storage keys and the migration paragraph, how trade-page addresses carry IDs, how the server reuses a saved league it was sent, and the rate limits' windows and counts, now "per-visitor limits, counted under codes made from your IP address with a secret key, deleted within a day". Sleeper usernames moved into "Reading your league", settings and feedback into "What stays in your browser"; the affiliation sentence is left to the footer, which every page has.
- **Feedback:** "We keep anonymous feedback for up to 12 months, then delete it." The monthly-download promise and its mechanics are gone, and so is the tool they described: `npm run feedback:report` replaced `npm run feedback:pull`; it reads the store and saves totals only. So the page also says: "When we study it, we keep only totals and the numbers our estimates learn from it, never individual copies."
- **New facts:** the public data kept to measure accuracy (Sleeper's pre-game projections and FantasyCalc's daily lists for the league formats in use, up to 2 seasons, never shown, saying nothing about any league or person beyond which formats were in use each day; the daily snapshot cron keeps them); the daily totals (about nobody, kept about 13 months); Upstash in US East with backups off; FantasyCalc (once our server has a format's list, it doesn't ask for it again for 3 hours, and asks only when needed; copies up to 90 days; its links tell it only that a visit came from Offer Sheet).
- **iPhone:** the Home Screen sentence says "may" (one secondary source so far).
- **Terms:** "Your part" in the planner's words (leagues you're in or allowed to view; no collecting information about other people; ESPN cookies kept private), "You must be at least 13 to use Offer Sheet.", and trade values no longer among the numbers Offer Sheet "quotes".
- **Contact:** offersheet.app@gmail.com on the privacy, terms and feedback pages. No person's name on any page, in the metadata, the footer, the manifest or the sharing image (a test checks them).
- **FantasyCalc links** (every one, the footer's included): `rel="noopener"` and `referrerpolicy="origin"`, no `noreferrer` or `nofollow` (React writes the attribute as `referrerPolicy`; HTML attribute names aren't case-sensitive). The footer's is a plain link in the root layout's server-rendered footer, so it's in every page's HTML.

## After the review of this text

- **Nothing the code doesn't do yet.** Three sentences rested on Checkpoint 7b work that wasn't built when they were written. Each shows only while that work is in the code, like browser reading and anonymous feedback before them, and `src/app/pages.test.ts` fails, both ways, while a sentence and the code disagree. All three are now **on**, so every sentence quoted below is on the pages:
  - **FantasyCalc's values never shown** (5.4): **on** since 2026-10-05. No trade card, reason, pitch, Analyzer Details, League page or How to read shows a FantasyCalc value or compares values by them (`src/lib/fantasyCalcHidden.test.ts` guards the words, the pages test the code that showed them), so both "never shown" sentences (below) appear.
  - **The public-data archive** (4.4, 6.3): **on**. The snapshot cron is in `vercel.json`, with its route.
  - **Feedback studied in totals only** (4.3): **on**. `npm run feedback:pull` is gone.
- **FantasyCalc's 3 hours.** The page said "at most once every 3 hours". That isn't so while FantasyCalc is down: each server asks again within 15 minutes. And after a list that fails our checks, another server instance can ask again at once (the one that saw it holds off for 3 hours, in its own memory). It now says what the cache guarantees: "Once it has a format's list, it doesn't ask FantasyCalc for it again for 3 hours, and asks only when needed."
- **What the server holds in memory.** "It never keeps the league data your browser sends it" was false. When the League page sends a saved league, the server keeps the numbers it works out from it (ESPN's own projections included) in its memory until 15 minutes after the league was read. Now: "It never adds the league data your browser sends it to those copies." and "Our server doesn't save them, but holds the numbers it works out from them in memory for up to 15 minutes." The page again says when memory copies go: "Anything our servers hold in memory stops being used once it's due, is deleted soon after while the server keeps working, and is gone when it shuts down."
- **ESPN cookies.** The section's four bullets are pinned by tests, with the 12 hours read from the session's own setting. The caveat for a browser that restores its session is back ("even if your browser restores its session, it stops working after 12 hours"), and the repeat of the short version's "sends them only to ESPN" is gone.
- **Email.** The pages publish a Gmail address, so "Who handles the data" says: "Google keeps the emails you send us (your address and message) in Offer Sheet's Gmail inbox, used only to answer you. Ask, and we'll delete them."
- **The archive's words.** It now says "We also keep public data", not "public data we fetch anyway": when no League page has fetched a week's projections or a day's list, the cron fetches it itself.

## After the review of Phase 7b

- **Which formats were in use.** The cron saves a FantasyCalc list only for the formats League pages read that day or the day before, so the archive shows which league formats were in use each day (a rare format can point to one league). The page said the archive "isn't about any league or person" and, under "Daily totals", that formats were noted "for 3 days", while the code kept a day's entry in a season-long index whose expiry every later save set again: up to about 3 years. Now each day's lists and the day's index go two seasons after that day began (`src/server/snapshots.ts` dayRetainMs), `npm run snapshot:pull` deletes its local copies by the same rule, and the page says: "We also keep public data, Sleeper's pre-game projections and FantasyCalc's daily lists for the league formats in use, up to 2 seasons, to measure how accurate our numbers are. It's never shown and says nothing about any league or person beyond which formats were in use each day." The daily totals no longer name the formats (the builds' own 3-day note is the same fact for less time).
- **Forget my credentials.** An import read with ESPN cookies is signed too, and the League page sends it back while it's fresh, so the model route keeps what it works out from it (ESPN's league-scored projections included) in memory until 15 minutes after the import. The line now reads: "league data our server copied or worked out with it is deleted within about 15 minutes (older weeks' transactions within 6 hours)" (it said 10 minutes).
- **Logs.** The error log also keeps a few routine events (the snapshot cron logs every run), so: "Our own log keeps errors and a few routine events, where and when …", not "only what went wrong".

## Choices made in this pass (for the planner)

- **About 1,250 words, not 1,000.** The detailed part (everything after the short version) is 1,249 words as the app shows it today, with every feature on (1,249 with every flag on, the most it can be). It was 3,042 at Checkpoint 7a and 1,286 after the first pass. The review cut the repeats of the short version (the limits sentence, the cookie sentence), the log's list of fields, the Export line and two re-read details. It added what the review found missing: what the server holds in memory and when it goes, the cookie after a restored session, and the Gmail inbox. What's left is what the reply asked to keep (what's collected, where it goes, how long, how to delete it, cookies, logs, providers, children, contact) plus the facts the reply added. The next cuts would drop facts, such as the list of what an anonymous copy holds. The review of Phase 7b's three corrections (above) fit by dropping the daily totals' formats sentence and a few words. A test holds the detailed part at 1,250 words, so making it longer needs your OK. The short version is 288 words.
- **The anonymous copy's goal setting** is described by what it does ("how you weigh the title against the playoffs"), not by its label, since Checkpoint 7b renames the setting ("What does your league reward?"). Its scoring fields read "main scoring settings" (points per catch, per passing touchdown and the tight-end premium).
- **"About 13 months"** for the daily totals: the counters are kept 400 days after their day, a little over 13 months.
- **"Your part"** is a list of rules ("When you use it, you agree to these rules:"), so the planner's "don't use Offer Sheet to collect information about other people" fits as written; the other "not …" items now read "don't …".

## The "never shown" words (on since 2026-10-05)

- Privacy, "Other sources": "…and trade values from FantasyCalc, which Offer Sheet uses in its own numbers but never shows."
- Terms, "Where the data comes from": "…trade values from FantasyCalc (Offer Sheet uses them in its own numbers and doesn't show them), …"

## Checks before launch (Checkpoint 7b's go/no-go list)

- **FantasyCalc's condition (5.4): done.** No value number or comparison is left in the app, and the "never shown" sentences are on (`POLICY_FEATURES.fantasyCalcHidden`, since 2026-10-05; both "Last updated" dates moved that day).
- **Upstash** is in US East (us-east-1) with backups off: done (Parker checked backups in Upstash's console on 2026-10-05; `reports/beta-infrastructure.md`).
- **The iPhone sentence** is checked on a real iPhone if Parker has one; until then it says "may".
- **"Last updated"** (`PRIVACY_LAST_UPDATED`, `TERMS_LAST_UPDATED`, now October 5, 2026) is set to launch day.
- **"Up to 12 months": done.** Each day's feedback list now goes 365 days after that day began (`src/server/feedbackSink.ts` feedbackDayTtlMs), so no copy is kept longer than 12 months.
- **"Up to 2 seasons" for the archive: done** (review of Phase 7b, above). Its local copies follow it only while `npm run snapshot:pull` runs now and then: each run deletes the lists of days past the store's rule.
- **Old raw feedback downloads** (`data-local/feedback-server/`, from `feedback:pull`): there were none on this PC on 2026-10-05. `npm run feedback:report` says so if any turn up, and they should be deleted.
- **Vercel's own cookies:** the cookie line covers Offer Sheet's own code. Vercel sets cookies of its own on protected previews (`_vercel_jwt`), and when a firewall rule challenges a visitor (`_vcrcs`). The 7b firewall rule should deny or rate-limit rather than challenge, or the line needs a qualifier.
- **CLAUDE.md: done.** §14 gives the pages' contact line ("Contact: offersheet.app@gmail.com"), and §11 and §16 describe `feedback:report`, which replaced `feedback:pull`.

## Where each statement comes from

The policy's code comment (`src/app/privacy/PrivacyPolicy.tsx`) names the code each statement relies on. `src/app/pages.test.ts` pins the words and fails when they and the code disagree. Outside sources: Vercel keeps request logs 1 hour on the Hobby plan (Vercel's docs); Safari deletes a site's storage after 7 days of use without a visit (MDN); an installed iPhone web app keeps its own storage (firt.dev, 2023, a secondary source).

The feedback page's description for search engines and link previews: "How to tell Offer Sheet what happened to its trade ideas, or what went wrong. The copies it gets are anonymous, and you can turn them off."

## Privacy policy (`/privacy`)

Plain answers about what Offer Sheet keeps, where, and for how long.

Last updated October 5, 2026

### The short version

- No accounts, no ads and no tracking or analytics. We don't sell your data or share it with anyone but the services that run Offer Sheet and the sites it reads for you (below), and we don't build profiles of you or your leaguemates.
- Offer Sheet only reads your league. It can't send offers or change anything.
- Offer Sheet sets no cookies, except one encrypted cookie if you connect a private ESPN league.
- If you connect with ESPN cookies, they're kept only in that encrypted cookie, for this browser session. Our server opens it only to read your league, and sends them only to ESPN.
- Your browser reads public ESPN leagues and Sleeper leagues straight from ESPN and Sleeper, and sends our server only the parts Offer Sheet needs. Our server still reads some leagues itself, such as private ESPN leagues.
- The leagues you import stay saved in this browser, with your team pick, settings, projections and feedback, until you remove a league or clear this site's data.
- Our server keeps copies of what it reads itself for a limited time (league data for about 10 minutes), filed under codes that hide league IDs, then deletes them. It never adds the league data your browser sends it to those copies.
- When you mark what happened to a trade idea or report a problem with it, your browser also sends Offer Sheet an anonymous copy, to help improve it: never your league's ID, names, usernames or the notes you type. We keep it for up to 12 months. You can turn this off in Settings.
- Our server has per-visitor limits, counted under codes made from your IP address with a secret key, deleted within a day.

### Reading your league

Your browser reads public ESPN and Sleeper leagues without cookies, but as with any site, ESPN and Sleeper see your IP address, which league it asks for, and that the request comes from Offer Sheet. It sends our server only the parts Offer Sheet uses (the ones it saves, below, and extras such as ESPN's projections). Our server doesn't save them, but holds the numbers it works out from them in memory for up to 15 minutes.

Our server reads a league itself for private ESPN leagues and any ESPN league imported with ESPN cookies (even after you forget them), when your browser can't (some ad blockers and networks block it), and when our server can't use the copy your browser saved.

If you enter a Sleeper username, your browser (or our server, if your browser can't) asks Sleeper which leagues it's in. The username is saved with those leagues and sent to our server with their requests, only to find your team.

### What stays in your browser

Your browser saves each league you import: what the Import Report shows (settings, teams and owners' names, rosters, schedule and transactions), its ID, your team pick and settings, the projections and trade values our server sent, and your feedback on trade ideas, notes included, for the latest 500 ideas. Your settings never leave your browser, except the one setting the anonymous feedback includes.

Opening the League page sends the saved league to our server, which adds projections and trade values for its players. The math (lineups, odds, trade ideas) runs in your browser.

To delete: “Remove” in the league menu deletes a league and what's saved with it (its settings and feedback stay while another season of it is saved). On the Settings page, “Reset to defaults” removes a league's settings and “Delete saved feedback” your feedback; clearing this site's data removes everything.

### Our server's copies

Our server keeps copies of what it reads itself, then deletes them: league data after about 10 minutes (older weeks' transactions and matchups after up to 6 hours), a Sleeper username lookup after 10 minutes, public data that isn't about any league after up to a week, and FantasyCalc's trade value lists after up to 90 days, in case FantasyCalc is down. Once it has a format's list, it doesn't ask FantasyCalc for it again for 3 hours, and asks only when needed.

The copies are kept at Upstash under codes made with a secret key, so league IDs and usernames never appear there, and encrypted, so Upstash can't read them. A private ESPN league's copies are also filed under a fingerprint of your cookies, so typing its ID isn't enough to see them, and ESPN member IDs (SWIDs) are replaced with one-way pseudonyms. Anything our servers hold in memory stops being used once it's due, is deleted soon after while the server keeps working, and is gone when it shuts down.

We also keep public data, Sleeper's pre-game projections and FantasyCalc's daily lists for the league formats in use, up to 2 seasons, to measure how accurate our numbers are. It's never shown and says nothing about any league or person beyond which formats were in use each day.

### Daily totals

Each day (UTC), our server counts the leagues imported, League pages built, the work they took, requests refused and requests made to each source, and keeps these totals about 13 months. None of this says who made the requests.

### Anonymous feedback

Each anonymous copy is used only to improve Offer Sheet. It holds what you pressed and which version you sent; the platform, season and week; your league's format (teams, league type, main scoring settings, lineup and playoff spots) and how you weigh the title against the playoffs; the players as ID numbers with positions; Offer Sheet's numbers for the trade and what they came from; a random code that links later changes to the same record; and the date it arrived.

It never holds your league's ID in any form, team IDs, team or owner names, usernames, ESPN member IDs, cookies, your IP address or your notes. Only your browser, and a file you export, can tell which copies are yours, though the players, format and week could lead someone who searched public leagues to yours. We never try to match copies to anyone.

We keep anonymous feedback for up to 12 months, then delete it. When we study it, we keep only totals and the numbers our estimates learn from it, never individual copies. Turning off “Share anonymous feedback” on the Settings page stops new copies; deleting your saved feedback doesn't take back copies already sent (more on the feedback page).

### ESPN cookies (private leagues only)

- They work like a password, so we treat them like one. We never ask for your ESPN password.
- They reach our server inside a request, never in a web address, and go into a cookie encrypted with a key only our server has and hidden from the page's scripts. Your browser sends it with each request to Offer Sheet and deletes it when you close your browser; even if your browser restores its session, it stops working after 12 hours.
- Our server never stores or logs your espn_s2 cookie, and your ESPN cookies are never saved with your leagues.
- “Forget my credentials” on the Connect page (or “Forget my ESPN cookies” on the Import Report) deletes the cookie right away; league data our server copied or worked out with it is deleted within about 15 minutes (older weeks' transactions within 6 hours).

### Other sources

Our server also downloads public data: player lists, projections and stats from Sleeper, the NFL schedule from ESPN, player ID maps from DynastyProcess, and trade values from FantasyCalc, which Offer Sheet uses in its own numbers but never shows. These requests carry no names or IDs, only things like the season, the week and your league's format. If you follow a link to FantasyCalc, it can see that you came from Offer Sheet, but not from which page.

### Logs

Vercel, our host, logs each request it serves (its web address and the browser type, for example), keeps that log for 1 hour, and can see IP addresses. Our own log keeps errors and a few routine events, where and when (an error code and the source involved, for example), for up to 14 days: never league data, names, IDs, usernames, cookies or IP addresses.

### Who handles the data

- Vercel hosts Offer Sheet and runs its server, in its US East region near Washington, D.C. (Vercel's privacy policy).
- Upstash, our database service, in its US East region with backups turned off, keeps our server's copies, the per-visitor counts, the daily totals, the public data above, the anonymous feedback and the error log (Upstash's privacy policy).
- Google keeps the emails you send us (your address and message) in Offer Sheet's Gmail inbox, used only to answer you. Ask, and we'll delete them (Google's privacy policy).

### On an iPhone or iPad

Safari may delete what Offer Sheet saved if you use Safari for 7 days without visiting Offer Sheet. A Home Screen app may keep its own saved leagues and settings (“Share anonymous feedback” included), apart from Safari's, so you may need to import your leagues there again.

### Children, changes and contact

Offer Sheet isn't directed at children under 13. If this policy changes, we'll update it here and change the date above.

Contact: offersheet.app@gmail.com

See also the terms of use.

## Terms of use (`/terms`)

The deal, in plain words. By using Offer Sheet, you agree to these terms.

Last updated October 5, 2026

### What Offer Sheet is

Offer Sheet is a free, non-commercial project, offered as a beta. It reads your fantasy football league and suggests trades. It only reads: it never sends offers, changes lineups or posts anything for you. There are no accounts, no ads and nothing to buy.

### Estimates, not promises

The numbers Offer Sheet works out are estimates: projections, playoff and title odds, “Helps you”, “Chance they accept” and “Overall”. Players get hurt, managers change their minds, and data can be late or wrong. You decide what to offer and what to accept, and those decisions are yours.

### Where the data comes from

League data comes from ESPN and Sleeper, projections and stats from Sleeper and ESPN, trade values from FantasyCalc (Offer Sheet uses them in its own numbers and doesn't show them), player ID maps from DynastyProcess, and the NFL schedule from ESPN. ESPN's league data comes through an unofficial interface that ESPN doesn't support, so it can change or stop working at any time. Each of these services has its own terms, and your ESPN and Sleeper accounts stay under theirs.

### Not affiliated

Offer Sheet is independent. It is not affiliated with, endorsed by or sponsored by ESPN, Sleeper, Yahoo, Fleaflicker, MyFantasyLeague, Fantrax, FantasyCalc, DynastyProcess or the NFL. Their names and trademarks belong to their owners, and appear here only to say which services Offer Sheet works with or reads from.

### Your part

You must be at least 13 to use Offer Sheet. When you use it, you agree to these rules:

- connect only leagues you're in, or leagues you're allowed to view (Sleeper leagues are public; an ESPN league is public only if its manager made it viewable);
- don't use Offer Sheet to collect information about other people;
- keep your ESPN cookies private: they work like a password, so never share them, and paste them into Offer Sheet only on a computer you trust;
- don't scrape Offer Sheet, point automated tools at it, overload it, or get around its limits;
- don't sell, republish or reuse Offer Sheet's numbers or data, commercially or in bulk.

### Feedback

When you mark what happened to a trade idea or report a problem with one, Offer Sheet may use an anonymous copy to improve its estimates and fix what it gets wrong. The privacy policy says what's sent. You can turn it off in Settings.

### A beta can change

Offer Sheet is a beta. Its features may change, break or go away, it may pause or stop, and ESPN, Sleeper or another source may change or block what it reads, at any time and without notice. The leagues you saved stay in your browser until you remove them or your browser clears them (the privacy policy says when).

### No warranty

Offer Sheet is provided “as is”, without warranties of any kind. As far as the law allows, its maker isn't liable for any loss or damage from using it or from relying on its numbers, including trades you make or don't make.

### Changes and contact

If these terms change, we'll update them here and change the date above. Using Offer Sheet after a change means you accept the new terms.

Contact: offersheet.app@gmail.com

## Feedback page (`/feedback`)

Offer Sheet learns from what happens to its trade ideas. Here's how to tell it.

### On every trade idea

Each trade idea on the Trade Finder and the Trade Analyzer has buttons for what happened: Sent, Accepted, Rejected and Countered. If something looks wrong, press “Report a problem” and pick a reason (Doesn't help me, They'd never accept, Player info is wrong, League settings look wrong, or Other), and add a note if you like.

- Every press is saved with that league in this browser.
- Unless you turn it off, an anonymous copy also goes to Offer Sheet, to help improve it: what you pressed, the players as ID numbers, your league's format and Offer Sheet's numbers for the trade. Never your league's ID, names or usernames.
- A note you type with a report stays in this browser. It's never sent.
- To stop sending copies, turn off “Share anonymous feedback” on the Settings page. That choice is saved in this browser.
- “Export feedback”, also on the Settings page, downloads everything you've saved, notes included, as a file.

The privacy policy lists what's sent and how long it's kept.

### Anything else

A bug, a league that imported wrong, or an idea: get in touch.

Contact: offersheet.app@gmail.com

## Footer (every page)

- Feedback
- Privacy
- Terms

Trade values: FantasyCalc

Projections and stats: Sleeper and ESPN · Player IDs: DynastyProcess · NFL schedule: ESPN

Offer Sheet is a free, independent beta. It is not affiliated with or endorsed by ESPN, Sleeper, Yahoo, Fleaflicker, MyFantasyLeague, Fantrax, FantasyCalc, DynastyProcess or the NFL.

© 2026 Offer Sheet
