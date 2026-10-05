# Privacy policy and terms of use: drafts for Checkpoint 7a

Written for the planner (who can't open the app) and Parker. Planner reply to Checkpoint 4c, Part B, B3: "New pages: `/privacy`, rewritten to match what the app really does, and `/terms`." Below is the full text of both, and of the new `/feedback` page and the footer, exactly as the app renders them now (generated from the pages themselves on 2026-10-05, after Part B's final review). The privacy policy describes everything Part B built: browser reading, the shared cache, the request limits and daily counts, and the anonymous feedback copies.

**Drafts, not legal advice.** Parker should read both before launch. The pages say "Contact: to be added before launch" until he picks an address.

## Open questions (for Parker)

1. **Contact address.** One constant holds it (`src/lib/site.ts` `CONTACT_EMAIL`). Which address should the pages show?
2. **How long anonymous feedback is kept.** Each day's copies are deleted a year after that day's last copy (`feedbackLimits.retainDays`, 365), at most 100 a day. A year, or shorter?
3. **Downloading feedback monthly.** The policy says the developer downloads the feedback at least once a month (`npm run feedback:pull -- --live`, which also deletes old downloads by the same one-year rule). Nothing runs it on a schedule, so this is a promise Parker keeps by hand. OK, or weaker wording?
4. **The icon.** The app's navy football on gold is used for the tab, the home screen and the sharing image. Keep it, or the old landing page's green lines?
5. **The terms' "Your part".** "connect only leagues you're in, or public ones (any Sleeper league, or an ESPN league its manager made viewable to the public)". OK?

Lead decisions you may want to change (each one line):
- The installed app opens on the League page (`start_url` "/league").
- Notes typed with a report stay in the browser and are never sent.
- The FantasyCalc links keep `noreferrer`, so FantasyCalc can't see that a visitor came from Offer Sheet.
- The pages that show only this browser's data (`/import`, `/league`, `/trades`, `/analyzer`, `/settings`) ask search engines not to index them.

## Checks before launch (Checkpoint 7b's list)

- "in its US East region" and "Upstash deletes each copy when its time is up" hold once the database is created in US East (us-east-1, next to Vercel's iad1) with no backups turned on (Checkpoint 7a's setup steps).
- The iPhone sentence (a Home Screen app keeps its own saved leagues and its own "Share anonymous feedback" choice) rests on one 2023 secondary source: check it on a real iPhone.
- Set the "Last updated" dates (`PRIVACY_LAST_UPDATED`, `TERMS_LAST_UPDATED`) to the launch day.

## Where each statement comes from

The policy's code comment (`src/app/privacy/PrivacyPolicy.tsx`) names the code each statement relies on, its numbers are read from `src/server/limits.ts` and the engine config, and `src/app/pages.test.ts` fails when the text and the code disagree (for example, it rebuilds the daily counts' keys and checks their expiry). Outside sources: Vercel keeps request logs 1 hour on the Hobby plan (Vercel's docs); Safari deletes a site's storage after 7 days of use without a visit (MDN); an installed iPhone web app keeps its own storage (firt.dev, 2023, ⚠️ secondary).

The feedback page's description for search engines and link previews: "How to tell Offer Sheet what happened to its trade ideas, or what went wrong. The copies it gets are anonymous, and you can turn them off."

## Privacy policy (`/privacy`)

Plain answers about what Offer Sheet keeps, where, and for how long.

Last updated October 4, 2026

### The short version

- No accounts, no ads and no tracking or analytics. We don't sell your data or share it with anyone but the services that run Offer Sheet and the sites it reads for you (below), and we don't build profiles of you or your leaguemates.
- Offer Sheet only reads your league. It can't send offers or change anything.
- Your browser reads public ESPN leagues and Sleeper leagues straight from ESPN and Sleeper, and sends our server only the parts Offer Sheet needs. Our server still reads some leagues itself: private ESPN leagues and any other ESPN league you import with ESPN cookies, and any league your browser can't read or whose saved copy our server can't use.
- The leagues you import stay saved in this browser, with your team pick, your settings for each, the projections the League page loaded for them and any feedback you give on trade ideas, until you remove a league or clear this site's data.
- Our server keeps copies of what it reads itself for a limited time (league data for about 10 minutes), filed under codes that hide league IDs, then deletes them. It never keeps the league data your browser sends it.
- When you mark what happened to a trade idea or report a problem with it, your browser also sends Offer Sheet an anonymous copy, to help improve it: never your league's ID, names, usernames or the notes you type. You can turn this off in Settings.
- To keep things fair, our server counts requests under codes made from your IP address, and from the block of nearby addresses it's in, with a secret key, never the addresses themselves. The counts it keeps at Upstash are deleted within an hour, or for a count of the whole day, a minute after the day ends (midnight UTC).
- If you connect with ESPN cookies, they're kept only in an encrypted cookie in your browser for this session. Our server opens it only to read your league, and sends them only to ESPN. They're never saved with your leagues.

### Reading your league

When you connect a public ESPN league or a Sleeper league, your browser reads it straight from ESPN or Sleeper. Like any site your browser talks to, they see your IP address, which league (or Sleeper username) your browser asks for, and that the request comes from Offer Sheet. Your browser sends them no cookies with these requests.

Your browser then sends our server only the parts of the answers Offer Sheet reads (the league's settings, teams and owners' names, rosters, schedule and results, and transactions; for ESPN also its free agents, projections and injured players' expected return dates; for Sleeper also its traded draft picks and drafts, and the username you entered, which finds your team), and our server turns them into the Import Report with public data it keeps itself, such as player lists and projections. Our server uses what your browser sends for that one request: it never saves it.

If your browser can't reach ESPN or Sleeper (some ad blockers and work or school networks stop it), our server reads the league itself instead. It does the same for private ESPN leagues and any other ESPN league you import while you're connected with your ESPN cookies (below), and it keeps reading such a league itself, even after you forget the cookies.

### Your leagues in this browser

Your browser saves each league you import in its IndexedDB storage (in a database called “offersheet”), next to any other leagues you've imported, until you remove it or clear this site's data. What's saved is what the Import Report shows: the league's settings, teams and owners' names as the platform gives them, rosters, schedule and transactions, and the league's ID, so it can be read again. Your pick of “Your team” is saved with it.

Each browser tab remembers which of your saved leagues it shows, in that tab's session storage: only a short code made from the league's ID, and its season. Your tabs tell each other when you change something, with those codes only.

When you open the League page, your browser sends the league it saved to our server (reading it again first when its copy is more than 10 minutes old), and our server adds the projections and trade values for its players and scores the projections with your league's scoring rules. If our server can't check the copy your browser sends (after Offer Sheet's keys change, for example), it reads the league itself. So that the same copy sent again doesn't cost it the same work twice, a server keeps the projections and values it worked out from it in its memory, never at Upstash: it stops using them when that copy stops being good, 15 minutes after Offer Sheet read the league, and deletes them soon after while it keeps running. Your browser saves the latest projections and values with the league, and uses them again for up to 6 hours. The League page's math (lineups, needs, trade partners, playoff odds) runs in your browser; your league isn't sent to anyone else to be analyzed.

The Trade Finder and the Trade Analyzer use the same projections and values, kept and fetched the same way, and they search for and score trades in your browser too. A link to the Trade Finder for one team, or to a trade in the Trade Analyzer, carries only that team's ID number and the players' ID numbers in its web address (never names or your league's ID; a trade opened from “If they say no, try” also says so there), and the Finder and the Analyzer put the team you pick and the trade you evaluate into their address the same way. Offer Sheet never loads these addresses ahead of time, so our server sees one only when you open it, like any web address.

“Remove” in the league menu at the top of every page deletes a league from this browser: its import, your team pick, its projections, and its settings and feedback (those stay while another season of the same league is saved, since they're shared).

### Our server's copies

To go easy on ESPN, Sleeper and the other sources, our server keeps copies of what it reads itself, then deletes them:
- League data our server reads itself (private ESPN leagues and any other ESPN league you import with ESPN cookies, any league your browser couldn't read, and any league whose saved copy our server couldn't use): about 10 minutes. Transactions and matchups from weeks that ended more than a week ago rarely change, so they may be kept for up to 6 hours.
- A Sleeper username lookup our server makes (which leagues that username is in): 10 minutes.
- Public data that isn't about any league (player lists, projections and stats, player ID maps and the NFL schedule): up to a week, so a saved copy can stand in if a source is down.
- FantasyCalc's trade value lists (public too, one per league format, not about any one league): up to 90 days. Once FantasyCalc answers, we don't ask it for that list again for a day. If it doesn't answer, we wait 5 minutes before asking it again (up to 15 while it stays down), and the newest saved list stands in for up to 7 days; after that, an older one is used only to work out our own estimates of trade values until FantasyCalc is back.

These copies are kept at Upstash, the database service we use through Vercel, in its US East region, each filed under a code made with a secret key only our server has, so league IDs and usernames never appear in the database's keys, and each copy is encrypted with another such key before it is stored, so Upstash holds only text it can't read. Upstash deletes each copy when its time is up. Our servers may also hold copies in their memory: a server stops using a copy when its time is up and deletes it soon after while it keeps running, and everything in its memory is gone when it shuts down. League data your browser sends our server is never among these copies.

Data from a private ESPN league is filed under a one-way fingerprint of your cookies too, so someone else who types the same league ID can't see it.

ESPN league data includes every member's ESPN member ID (the SWID), yours among them. Before our server keeps a copy, it replaces every member ID with a one-way pseudonym, so the saved copy holds no SWIDs.

### Limits on requests

To keep Offer Sheet free and fair for everyone, our server limits how many requests one visitor can send in a short window (10 minutes for imports, the League page and ESPN cookies, an hour for feedback), and how much it does in a day for one visitor and for the block of nearby addresses the visitor's address is in: the work of importing leagues and working out League pages, the requests it makes to ESPN or Sleeper, and the anonymous feedback copies it takes. It counts these under codes made from your IP address and from that block, each with a secret key, never the addresses themselves: without that key, a code can't be turned back into an address. Each short-window count kept at Upstash is deleted one window after it starts, so within an hour; each day's count, a minute after the day ends (midnight UTC). A count a server holds in its memory is deleted soon after its window or day ends while that server keeps running, and is gone when it shuts down.

### Anonymous feedback

When you press Sent, Accepted, Rejected or Countered on a trade idea, or report a problem with one, your browser saves it with that league (below). Unless you turn it off, it also sends Offer Sheet an anonymous copy, used only to improve Offer Sheet: how it estimates trades, and anything it reads or shows wrong. The copy holds:
- the trade idea's outcome and report reason as they stand after your press (when you clear one, a copy without it follows, so the earlier copies no longer count), and which version of the idea you sent;
- the platform (ESPN or Sleeper), the season and the week;
- your league's format: the number of teams, whether it's redraft, keeper or dynasty, the points per catch and per passing touchdown, any tight-end premium, whether it starts a second quarterback, how many of each lineup slot it starts, and how many teams make the playoffs;
- your “What matters most” setting;
- the players in the trade, and in the version you sent when it differs, as ID numbers with their positions;
- Offer Sheet's numbers for the trade (Helps you, the chance they accept, Overall, and the figures behind them, such as the change in your playoff and title odds) and what its estimate of the chance they accept was worked out from;
- for the version you sent: Offer Sheet's estimate for it, and what that estimate and its score were worked out from;
- a random code your browser makes for that one record, so a later change to it (an outcome after “Sent”) can be matched to it.

Our server stores it with the day it arrived (the date, not the time).

It never holds your league's ID, team IDs, team or owner names, usernames, ESPN member IDs (SWIDs), cookies, the code your browser files your league under, or any note you type: notes stay in your browser.

We keep at most the newest 100 a day, at Upstash, and delete each day's feedback a year after the last one that day. Offer Sheet's developer downloads it from there to study it, at least once a month, and keeps each month's download until a year after that month's last copy, deleting it at the first download after that, so a downloaded copy is kept at most about two months longer than at Upstash.

Offer Sheet stores nothing with a copy that ties it to you: no IP address, account, league ID or name. (The day's limit on copies counts them under codes made from your IP address and its block, above, and those counts are deleted a minute after the day ends (midnight UTC).) Each copy carries its record's random code, but only your browser (and any file you save with “Export feedback”) keeps that code with your feedback, so only someone with your browser or that file could match copies to you by it. Still, the players in a trade, with your league's format and the week, could lead someone who searched public leagues to yours. Offer Sheet never tries to match copies to anyone. Turning sharing off stops new copies; deleting your saved feedback doesn't take back copies already sent.

To stop sending it, turn off “Share anonymous feedback” on the Settings page. That choice is saved in this browser, for every league. The feedback page says more.

### Settings and trade feedback in this browser

These are saved with each league in this browser's IndexedDB storage, so they're there the next time you use Offer Sheet. Your settings never leave your browser, except your “What matters most” setting in the anonymous feedback above. Your feedback stays here too, apart from that anonymous copy, which leaves out your notes.
- Settings: what you choose on the Settings page for a league, and the “Chance they accept: at least” you pick on the Trade Finder. Each league's settings are filed under a short code made from its league ID (without the season, so a league renewed for next season keeps them), and hold player ID numbers and positions, never names.
- Trade feedback: when you mark what happened to a trade idea or report a problem with it (on the Trade Finder or the Trade Analyzer), it's saved with that league, for its latest 500 trade ideas, under the same short code as that league's settings. It holds the players and picks in the trade and the other team (all as ID numbers), Offer Sheet's numbers for the trade, when you pressed each button, and any note you typed. When you mark what happened, it also keeps which version you sent (a card can show more than one): its players as ID numbers too, Offer Sheet's estimate for it, and the numbers that estimate and its score were worked out from, such as how much trade value and lineup the other team would gain and how much the trade helps you, along with your “What matters most” setting. It also keeps the week and season Offer Sheet's numbers were worked out for, your “What matters most” setting for the trade's own numbers, and the random code its anonymous copies carry (above).
- “Export feedback” on the Settings page downloads your feedback as a file. In the file your leagues are only numbered (league-1, league-2), and your notes appear exactly as you typed them. It includes each record's random code, which matches it to its anonymous copies.
- “Reset to defaults” on the Settings page removes a league's settings, “Delete saved feedback” removes all of your feedback, removing a league removes both for that league, and clearing this site's data in your browser removes everything. Anonymous copies already sent aren't affected: they're deleted on their own schedule (above).
- If you used Offer Sheet before October 4, 2026, your settings and feedback were in this browser's local storage (“offersheet:settings:v1” and “offersheet:feedback:v1”) and a tab's league in its session storage. Offer Sheet copied them into the new storage once and left the old copies as they were, unused. Removing a league or deleting your feedback deletes the old copies too, and a tab's session storage goes when you close the tab.

ESPN cookies (private leagues only)
- They work like a password to your ESPN account, so we treat them like one. We never ask for your ESPN password.
- You type them into Offer Sheet once, and they travel to our server inside that request, never in a web address.
- Our server puts them straight into a cookie in your browser that is encrypted with a key only our server has, can't be read by the page's scripts, and is deleted when you close your browser. Your browser sends that encrypted cookie back with each request to Offer Sheet, as browsers do with a site's cookies. Even if your browser restores its session, the encrypted cookie stops working after 12 hours.
- They're never saved with your leagues. A private league you saved stays saved after they're gone, but reading it again needs them again.
- Our server opens the encrypted cookie only to read your league, and sends your ESPN cookies only to ESPN. Your espn_s2 cookie is never stored on our server or written to logs, and your SWID is kept only as the one-way pseudonym described above.
- “Forget my credentials” on the Connect page (or “Forget my ESPN cookies” on the Import Report) deletes the cookie right away. League data our server copied with it expires within about 10 minutes (older weeks' transactions within 6 hours) and is then deleted.

### Sleeper

Sleeper leagues are public. If you enter a username, your browser asks Sleeper which leagues it's in, to find your leagues and your team (if your browser can't reach Sleeper, our server asks instead and keeps that lookup for 10 minutes). Your browser sends the username to our server with the league you import, and whenever the League page asks for that league's numbers, only to find your team there. It saves the username with each league you import with it, so it can find your team again.

### Other sources

Our server also downloads public data: player lists and weekly projections and stats from Sleeper, player ID maps from DynastyProcess, trade values from FantasyCalc, and the NFL schedule. Some of these requests are shaped by your league's settings:
- Sleeper's projection and stats requests carry only the season, week numbers up to your league's last playoff week, and the positions your league starts (for example, whether it uses a kicker or IDP).
- The FantasyCalc request carries only your league's format: the number of teams, points per catch, how many quarterbacks start, dynasty or not, and any tight-end premium.

They never carry names or IDs. The other requests (player lists, player ID maps and the NFL schedule) don't depend on your league at all (the schedule only on the season), so nothing about you or your league is sent with them.

### Logs

Vercel, which hosts Offer Sheet, keeps a log of the requests it serves for Offer Sheet for 1 hour on our plan: the method, the web address and its query, the status, the type of browser and the region. Vercel can see IP addresses.

Our own error log keeps, for up to 14 days, only when something went wrong, which part of Offer Sheet had the problem and what kind: an error code, the data source involved (ESPN or Sleeper, for example), the status it answered with, the error's type and how long the request took. Never league data, names, IDs, usernames, cookies or IP addresses.

### Who handles the data

- Vercel hosts Offer Sheet and runs its server, in Vercel's US East region near Washington, D.C. (Vercel's privacy policy).
- Upstash keeps our server's copies, the request counts, the anonymous feedback and the error log (Upstash's privacy policy).

### On an iPhone or iPad

Safari may delete what a site saved in your browser, your saved leagues, settings and feedback included, after you use Safari for 7 days without visiting Offer Sheet. If you add Offer Sheet to your Home Screen, the app you open from there keeps its own saved leagues and settings, apart from Safari's, “Share anonymous feedback” included, so import your leagues again inside it, and turn sharing off there too if you want it off.

### Children, changes and contact

Offer Sheet isn't directed at children under 13.

If this policy changes, we'll update it here and change the date above.

Contact: to be added before launch

Offer Sheet is an independent project, not affiliated with or endorsed by ESPN, Sleeper, Yahoo, Fleaflicker, MyFantasyLeague, Fantrax, FantasyCalc, DynastyProcess or the NFL. See also the terms of use.

## Terms of use (`/terms`)

The deal, in plain words. By using Offer Sheet, you agree to these terms.

Last updated October 4, 2026

### What Offer Sheet is

Offer Sheet is a free, non-commercial project, offered as a beta. It reads your fantasy football league and suggests trades. It only reads: it never sends offers, changes lineups or posts anything for you. There are no accounts, no ads and nothing to buy.

### Estimates, not promises

The numbers Offer Sheet works out or quotes are estimates: projections, playoff and title odds, “Helps you”, “Chance they accept” and “Overall”, and the trade values it shows. Players get hurt, managers change their minds, and data can be late or wrong. You decide what to offer and what to accept, and those decisions are yours.

### Where the data comes from

League data comes from ESPN and Sleeper, projections and stats from Sleeper and ESPN, trade values from FantasyCalc, player ID maps from DynastyProcess, and the NFL schedule from ESPN. ESPN's league data comes through an unofficial interface that ESPN doesn't support, so it can change or stop working at any time. Each of these services has its own terms, and your ESPN and Sleeper accounts stay under theirs.

### Not affiliated

Offer Sheet is independent. It is not affiliated with, endorsed by or sponsored by ESPN, Sleeper, Yahoo, Fleaflicker, MyFantasyLeague, Fantrax, FantasyCalc, DynastyProcess or the NFL. Their names and trademarks belong to their owners, and appear here only to say which services Offer Sheet works with or reads from.

### Your part

When you use Offer Sheet, you agree to:
- connect only leagues you're in, or public ones (any Sleeper league, or an ESPN league its manager made viewable to the public);
- keep your ESPN cookies to yourself: they work like a password, so paste them only into Offer Sheet's Connect page, on a computer you trust;
- not scrape Offer Sheet, point automated tools at it, overload it, or get around its limits;
- not sell, republish or reuse its trade values or other data, commercially or in bulk.

### Feedback

When you mark what happened to a trade idea or report a problem with one, Offer Sheet may use an anonymous copy to improve its estimates and fix what it gets wrong. The privacy policy says what's sent. You can turn it off in Settings.

### A beta can change

Offer Sheet is a beta. Its features may change, break or go away, it may pause or stop, and ESPN, Sleeper or another source may change or block what it reads, at any time and without notice. The leagues you saved stay in your browser until you remove them or your browser clears them (the privacy policy says when).

### No warranty

Offer Sheet is provided “as is”, without warranties of any kind. As far as the law allows, its maker isn't liable for any loss or damage from using it or from relying on its numbers, including trades you make or don't make.

### Changes and contact

If these terms change, we'll update them here and change the date above. Using Offer Sheet after a change means you accept the new terms.

Contact: to be added before launch

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

Contact: to be added before launch

## Footer (every page)

- Feedback

- Privacy

- Terms

Trade values: FantasyCalc

Projections and stats: Sleeper and ESPN · Player IDs: DynastyProcess · NFL schedule: ESPN

Offer Sheet is a free, independent beta. It is not affiliated with or endorsed by ESPN, Sleeper, Yahoo, Fleaflicker, MyFantasyLeague, Fantrax, FantasyCalc, DynastyProcess or the NFL.

© 2026 Offer Sheet
