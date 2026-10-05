# Privacy policy and terms of use: drafts for Checkpoint 7a

Planner reply to Checkpoint 4c, Part B, B3: "New pages: `/privacy`, rewritten to match what the app really does, and `/terms`." Checkpoint 7a includes "the drafts of the privacy and terms pages". Below is their full text as the app renders it once Part B's second wave is built (generated from the pages themselves on 2026-10-04), for the planner, who can't open the app. The feedback page, also new and public, follows them.

**Until wave 2 lands, the live pages describe today's app.** Two features change what the pages say: browser reading (track BF) and anonymous feedback (track FB). Each page's words follow a switch per feature (`src/lib/site.ts` `POLICY_FEATURES`), off until the change that builds it turns it on, so a preview built before then never describes something that isn't there (review PG-1). Today both are off: our server reads every league, and feedback stays in the browser. The last section, "What the pages say today instead", lists those passages. `src/app/pages.test.ts` pins both versions, and fails while a switch and the code disagree (for example, once `src/lib/browserHttp.ts` exists while `browserReads` is still off). Regenerate this file once wave 2 has landed.

**Drafts, not legal advice.** Parker should read both before launch. The Checkpoint 7b go/no-go list carries what's still open.

## Open questions (for Parker)

1. **Contact address.** The privacy policy, the terms and the feedback page say "Contact: to be added before launch". One constant holds it (`src/lib/site.ts` `CONTACT_EMAIL`). Which address should they show?
2. **How long anonymous feedback is kept.** The privacy policy says each month's feedback is deleted a year after that month's last entry (`src/server/limits.ts` `feedbackLimits.retainDays`, 365). Is a year right?
3. **Notes typed with a report.** They stay in the browser and are never sent (the Part B design). Confirm that's what Parker wants.
4. **Where the installed app opens.** It opens on the League page (`start_url` "/league" in the manifest). Should it open on the home page instead?
5. **The icon.** The app's navy football on gold is now used everywhere: the browser tab, the home screen and the sharing image. Should it be the old landing page's green lines instead?
6. **Telling FantasyCalc where visitors come from.** Both FantasyCalc links (the footer's "Trade values: FantasyCalc" and the "Values: FantasyCalc" link next to values) open with `rel="noopener noreferrer"`, so FantasyCalc can't see that a visitor came from Offer Sheet, whatever the site's `Referrer-Policy` says. Should those links tell FantasyCalc? If yes, only the two links change (`rel="noopener"` with `referrerPolicy="origin"`: FantasyCalc would see Offer Sheet's address, never a page's); the site-wide `Referrer-Policy: same-origin` stays as it is.
7. **Search engines.** The pages that show only this browser's data (`/import`, `/league`, `/trades`, `/analyzer`, `/settings`) ask search engines not to index them. Is that OK?

## Where each statement comes from

The privacy policy follows the lead's Part B design ("Privacy facts" 1–8). Its code comment (`src/app/privacy/PrivacyPolicy.tsx`) lists the code each statement relies on, and Part B's final review checks each one against that code.

- **Fact 1, track BF (wave 2).** Shown once `browserReads` is on: your browser reads public ESPN leagues and Sleeper leagues itself and sends the server only the parts it needs; the server still reads a league itself while ESPN cookies are connected (every ESPN league, public ones too), when the browser can't, and when it can't use the copy the browser saved (for example, one saved before browser reading; review PG-1); the League page sends the saved league back. Today the server reads every league, and the League page's request carries only the league's ID, season and a Sleeper username.
- **Fact 4, track FB (wave 2).** Shown once `anonymousFeedback` is on: the anonymous copy's fields, the day the server stores with it (review PG-1), what's never sent, the "Share anonymous feedback" switch in Settings, the 5,000-a-month cap and the year. Today feedback stays in the browser.
- **Facts 2, 3 and 5, tracks CA and RL.** The Upstash cache under keys that hide league IDs, the rate-limit counts, and the 14-day error log. The numbers (rate-limit windows, log days, the feedback cap and retention) are read from `src/server/limits.ts`, so the page follows any change there. Review PG-6: Upstash deletes a copy when its time is up, and a rate-limit count one window after it starts (at most an hour; 10 minutes while there's no feedback route); a server's memory clears an expired copy or count only while that server is running, and loses everything when it shuts down. The page says that instead of promising the memory "never longer than the times above".
- **Unchanged from before.** This browser's storage (IndexedDB, settings, local feedback, Remove), the ESPN cookies, the SWID pseudonyms, FantasyCalc's lists, and what Sleeper's and FantasyCalc's requests carry. Review PG-5: closed weeks' transactions and matchups (Sleeper's import keeps both 6 hours; ESPN's only its transactions).
- **From outside sources (research, 2026-10-04).**
  - Vercel keeps runtime logs for 1 hour on the Hobby plan.
  - Safari deletes what a site saved after 7 days of Safari use without a visit (MDN).
  - An installed iPhone web app keeps its own storage, apart from Safari's (firt.dev; ⚠️ a secondary source).
  - The cache is in Upstash's US East region once Parker creates the database there (iad1), and copies are gone when their time is up as long as no Upstash backup is turned on.

The terms follow the research's outline:

- what Offer Sheet is
- estimates, not promises
- where the data comes from (the NFL schedule is ESPN's: the app downloads nothing from nflverse, review PG-2), and that each source's own terms apply
- no affiliation
- what users agree to
- feedback (today: it stays in the browser; with track FB: the anonymous copy and its opt-out)
- the beta can change (saved leagues stay until removed or until the browser clears them, review PG-7)
- no warranty
- changes and contact

Both pages are dated October 4, 2026, each from its own constant (`PRIVACY_LAST_UPDATED`, `TERMS_LAST_UPDATED`). Turning a feature on changes both: set their dates to that day.

In the text below, `###` is a page's title and `####` its sections. Links show their address.

## The privacy policy (/privacy)

### Privacy

Plain answers about what Offer Sheet keeps, where, and for how long.

Last updated October 4, 2026

#### The short version

- No accounts, no ads and no tracking or analytics. We don't sell or share your data, and we don't build profiles of you or your leaguemates.
- Offer Sheet only reads your league. It can't send offers or change anything.
- Your browser reads public ESPN leagues and Sleeper leagues straight from ESPN and Sleeper, and sends our server only the parts Offer Sheet needs. Our server still reads a league itself while you're connected with ESPN cookies (a private ESPN league needs them), when your browser can't, and when it can't use the copy your browser saved.
- The leagues you import stay saved in this browser, with your team pick, your settings for each, the projections the League page loaded for them and any feedback you give on trade ideas, until you remove a league or clear this site's data.
- Our server keeps copies of what it reads itself for a limited time (league data for about 10 minutes), filed under codes that hide league IDs, then deletes them. It never keeps the league data your browser sends it.
- When you mark what happened to a trade idea or report a problem with it, your browser also sends Offer Sheet an anonymous copy, to improve its estimates: never your league's ID, names, usernames or the notes you type. You can turn this off in Settings.
- To keep things fair, our server counts requests under a one-way code made from your IP address, never the address itself. The counts it keeps at Upstash are deleted within an hour.
- If you connect with ESPN cookies, they're kept only in an encrypted cookie in your browser for this session, and only ever sent to ESPN. They're never saved with your leagues.

#### Reading your league

When you connect a public ESPN league or a Sleeper league, your browser reads it straight from ESPN or Sleeper. Like any site your browser talks to, they see your IP address, which league (or Sleeper username) your browser asks for, and that the request comes from Offer Sheet. Your browser sends them no cookies with these requests.

Your browser then sends our server only the parts of the answers Offer Sheet reads (the league's settings, teams and owners' names, rosters, schedule and transactions, and for ESPN its free agents and projections), and our server turns them into the Import Report with public data it keeps itself, such as player lists and projections. Our server uses what your browser sends for that one request: it never saves it.

If your browser can't reach ESPN or Sleeper (some ad blockers and work or school networks stop it), our server reads the league itself instead. It does the same for your ESPN leagues, public ones too, while you're connected with your ESPN cookies, which a private league needs (below).

#### Your leagues in this browser

Your browser saves each league you import in its IndexedDB storage (in a database called “offersheet”), next to any other leagues you've imported, until you remove it or clear this site's data. What's saved is what the Import Report shows: the league's settings, teams and owners' names as the platform gives them, rosters, schedule and transactions, and the league's ID, so it can be read again. Your pick of “Your team” is saved with it.

Each browser tab remembers which of your saved leagues it shows, in that tab's session storage: only a short code made from the league's ID, and its season. Your tabs tell each other when you change something, with those codes only.

When you open the League page, your browser sends the league it saved to our server (reading it again first when its copy is more than 10 minutes old), and our server adds the projections and trade values for its players and scores the projections with your league's scoring rules. If our server can't use the copy your browser sends (one saved before Offer Sheet read leagues in your browser, for example), it reads the league itself. Your browser saves the latest projections and values with the league, and uses them again for up to 6 hours. The League page's math (lineups, needs, trade partners, playoff odds) runs in your browser; your league isn't sent to anyone else to be analyzed.

The Trade Finder and the Trade Analyzer use the same projections and values, kept and fetched the same way, and they search for and score trades in your browser too. A link to the Trade Finder for one team, or to a trade in the Trade Analyzer, carries only that team's ID number and the players' ID numbers in its web address (never names or your league's ID; a trade opened from “If they say no, try” also says so there), and the Finder and the Analyzer put the team you pick and the trade you evaluate into their address the same way. Offer Sheet never loads these addresses ahead of time, so our server sees one only when you open it, like any web address.

“Remove” in the league menu at the top of every page deletes a league from this browser: its import, your team pick, its projections, and its settings and feedback (those stay while another season of the same league is saved, since they're shared).

#### Our server's copies

To go easy on ESPN, Sleeper and the other sources, our server keeps copies of what it reads itself, then deletes them:

- League data our server reads itself (private ESPN leagues, any ESPN league while you're connected with ESPN cookies, any league your browser couldn't read, and any league whose saved copy our server couldn't use): about 10 minutes. Transactions and matchups from weeks that ended more than a week ago rarely change, so they may be kept for up to 6 hours.
- A Sleeper username lookup our server makes (which leagues that username is in): 10 minutes.
- Public data that isn't about any league (player lists, projections and stats, player ID maps and the NFL schedule): up to a week, so a saved copy can stand in if a source is down.
- FantasyCalc's trade value lists (public too, one per league format, not about any one league): up to 90 days. Once FantasyCalc answers, we don't ask it for that list again for a day. If it doesn't answer, we wait 5 minutes before asking it again (up to 15 while it stays down), and the newest saved list stands in for up to 7 days; after that, an older one is used only to work out our own estimates of trade values until FantasyCalc is back.

These copies are kept at Upstash, the database service we use through Vercel, in its US East region, each filed under a code made with a secret key only our server has, so league IDs and usernames never appear in the database's keys. Upstash deletes each copy when its time is up. Our servers may also hold copies in their memory: a server stops using a copy when its time is up and deletes it soon after while it keeps running, and everything in its memory is gone when it shuts down. League data your browser sends our server is never among these copies.

Data from a private ESPN league is filed under a one-way fingerprint of your cookies too, so someone else who types the same league ID can't see it.

ESPN league data includes every member's ESPN member ID (the SWID), yours among them. Before our server keeps a copy, it replaces every member ID with a one-way pseudonym, so the saved copy holds no SWIDs.

#### Limits on requests

To keep Offer Sheet free and fair for everyone, our server limits how many requests one visitor can send in a short window (10 minutes for imports and the League page, an hour for feedback). It counts them under a one-way code made from your IP address with a secret key, never the address itself. Each count kept at Upstash is deleted one window after it starts, so within an hour. A count a server holds in its memory is deleted soon after its window ends while that server keeps running, and is gone when it shuts down.

#### Anonymous feedback

When you press Sent, Accepted, Rejected or Countered on a trade idea, or report a problem with one, your browser saves it with that league (below). Unless you turn it off, it also sends Offer Sheet an anonymous copy, used only to improve how Offer Sheet estimates trades. The copy holds:

- what you pressed (the outcome, or the report's reason) and which version of the idea you sent;
- the platform (ESPN or Sleeper), the season and the week;
- your league's format: the number of teams, whether it's redraft, keeper or dynasty, the points per catch and per passing touchdown, any tight-end premium, whether it starts a second quarterback, how many of each lineup slot it starts, and how many teams make the playoffs;
- your “What matters most” setting;
- the players in the trade, as ID numbers with their positions;
- Offer Sheet's numbers for the trade (Helps you, the chance they accept, Overall, and the figures behind them, such as the change in your playoff and title odds) and what its estimate of the chance they accept was worked out from;
- a random code your browser makes for that one record, so a later change to it (an outcome after “Sent”) can be matched to it.

Our server stores it with the day it arrived (the date, not the time).

It never holds your league's ID, team IDs, team or owner names, usernames, ESPN member IDs (SWIDs), cookies, the code your browser files your league under, or any note you type: notes stay in your browser.

We keep at most the newest 5,000 a month, at Upstash, and delete each month's feedback a year after the last one that month. It isn't linked to you, so there's no way to pick out yours to delete it sooner; turning sharing off stops new copies.

To stop sending it, turn off “Share anonymous feedback” on the [Settings page](/settings). That choice is saved in this browser, for every league. The [feedback page](/feedback) says more.

#### Settings and trade feedback in this browser

These are saved with each league in this browser's IndexedDB storage, so they're there the next time you use Offer Sheet. Your settings never leave your browser, except your “What matters most” setting in the anonymous feedback above. Your feedback stays here too, apart from that anonymous copy, which leaves out your notes.

- Settings: what you choose on the Settings page for a league, and the “Chance they accept: at least” you pick on the Trade Finder. Each league's settings are filed under a short code made from its league ID (without the season, so a league renewed for next season keeps them), and hold player ID numbers and positions, never names.
- Trade feedback: when you mark what happened to a trade idea or report a problem with it (on the Trade Finder or the Trade Analyzer), it's saved with that league, for its latest 500 trade ideas, under the same short code as that league's settings. It holds the players and picks in the trade and the other team (all as ID numbers), Offer Sheet's numbers for the trade, when you pressed each button, and any note you typed. When you mark what happened, it also keeps which version you sent (a card can show more than one): its players as ID numbers too, Offer Sheet's estimate for it, and the numbers that estimate and its score were worked out from, such as how much trade value and lineup the other team would gain and how much the trade helps you, along with your “What matters most” setting.
- “Export feedback” on the Settings page downloads your feedback as a file. In the file your leagues are only numbered (league-1, league-2), and your notes appear exactly as you typed them.
- “Reset to defaults” on the Settings page removes a league's settings, “Delete saved feedback” removes all of your feedback, removing a league removes both for that league, and clearing this site's data in your browser removes everything.
- If you used Offer Sheet before October 4, 2026, your settings and feedback were in this browser's local storage (“offersheet:settings:v1” and “offersheet:feedback:v1”) and a tab's league in its session storage. Offer Sheet copied them into the new storage once and left the old copies as they were, unused. Removing a league or deleting your feedback deletes the old copies too, and a tab's session storage goes when you close the tab.

#### ESPN cookies (private leagues only)

- They work like a password to your ESPN account, so we treat them like one. We never ask for your ESPN password.
- They travel from your browser to our server once, inside the request, never in a web address.
- Our server puts them straight into a cookie in your browser that is encrypted with a key only our server has, can't be read by the page's scripts, and is deleted when you close your browser. Even if your browser restores its session, the encrypted cookie stops working after 12 hours.
- They're never saved with your leagues. A private league you saved stays saved after they're gone, but reading it again needs them again.
- Our server reads them only to read your league, and sends them only to ESPN. Your espn_s2 cookie is never stored on our server or written to logs, and your SWID is kept only as the one-way pseudonym described above.
- “Forget my credentials” on the [Connect page](/connect) (or “Forget my ESPN cookies” on the Import Report) deletes the cookie right away. League data our server copied with it expires within about 10 minutes (older weeks' transactions within 6 hours) and is then deleted.

#### Sleeper

Sleeper leagues are public. If you enter a username, your browser asks Sleeper which leagues it's in, to find your leagues and your team (if your browser can't reach Sleeper, our server asks instead and keeps that lookup for 10 minutes). Your browser saves the username with each league you import with it, so it can find your team again.

#### Other sources

Our server also downloads public data: player lists and weekly projections and stats from Sleeper, player ID maps from DynastyProcess, trade values from FantasyCalc, and the NFL schedule. Some of these requests are shaped by your league's settings:

- Sleeper's projection and stats requests carry only the season, week numbers up to your league's last playoff week, and the positions your league starts (for example, whether it uses a kicker or IDP).
- The FantasyCalc request carries only your league's format: the number of teams, points per catch, how many quarterbacks start, dynasty or not, and any tight-end premium.

They never carry names or IDs. The other requests (player lists, player ID maps and the NFL schedule) don't depend on your league at all (the schedule only on the season), so nothing about you or your league is sent with them.

#### Logs

Vercel, which hosts Offer Sheet, keeps a log of the requests it serves for Offer Sheet for 1 hour on our plan: the method, the web address and its query, the status, the type of browser and the region. Vercel can see IP addresses.

Our own error log keeps, for 14 days, only which part of Offer Sheet had a problem and what kind: an error code, the data source involved (ESPN or Sleeper, for example), the status it answered with, the error's type and how long the request took. Never league data, names, IDs, usernames, cookies or IP addresses.

#### Who handles the data

- Vercel hosts Offer Sheet and runs its server ([Vercel's privacy policy](https://vercel.com/legal/privacy-policy)).
- Upstash keeps our server's copies, the request counts, the anonymous feedback and the error log ([Upstash's privacy policy](https://upstash.com/trust/privacy.pdf)).

#### On an iPhone or iPad

Safari may delete what a site saved in your browser, your saved leagues, settings and feedback included, after you use Safari for 7 days without visiting Offer Sheet. If you add Offer Sheet to your Home Screen, the app you open from there keeps its own saved leagues, apart from Safari's, so import your leagues again inside it.

#### Children, changes and contact

Offer Sheet isn't directed at children under 13.

If this policy changes, we'll update it here and change the date above.

Contact: to be added before launch

Offer Sheet is an independent project, not affiliated with or endorsed by ESPN, Sleeper, Yahoo, Fleaflicker, MyFantasyLeague, Fantrax, FantasyCalc or the NFL. See also the [terms of use](/terms).

## The terms of use (/terms)

### Terms of use

The deal, in plain words. By using Offer Sheet, you agree to these terms.

Last updated October 4, 2026

#### What Offer Sheet is

Offer Sheet is a free, non-commercial project, offered as a beta. It reads your fantasy football league and suggests trades. It only reads: it never sends offers, changes lineups or posts anything for you. There are no accounts, no ads and nothing to buy.

#### Estimates, not promises

Every number Offer Sheet shows is an estimate: projections, playoff and title odds, “Helps you”, “Chance they accept” and “Overall”, and the trade values it quotes. Players get hurt, managers change their minds, and data can be late or wrong. You decide what to offer and what to accept, and those decisions are yours.

#### Where the data comes from

League data comes from ESPN and Sleeper, projections and stats from Sleeper and ESPN, trade values from FantasyCalc, player ID maps from DynastyProcess, and the NFL schedule from ESPN. ESPN's league data comes through an unofficial interface that ESPN doesn't support, so it can change or stop working at any time. Each of these services has its own terms, and your ESPN and Sleeper accounts stay under theirs.

#### Not affiliated

Offer Sheet is independent. It is not affiliated with, endorsed by or sponsored by ESPN, Sleeper, Yahoo, Fleaflicker, MyFantasyLeague, Fantrax, FantasyCalc, DynastyProcess or the NFL. Their names and trademarks belong to their owners, and appear here only to say which services Offer Sheet works with or reads from.

#### Your part

When you use Offer Sheet, you agree to:

- connect only leagues you're in, or leagues their managers have made public;
- keep your ESPN cookies to yourself: they work like a password, so paste them only into Offer Sheet's Connect page, on a computer you trust;
- not scrape Offer Sheet, point automated tools at it, overload it, or get around its limits;
- not sell, republish or reuse its trade values or other data, commercially or in bulk.

#### Feedback

When you mark what happened to a trade idea or report a problem with one, Offer Sheet may use an anonymous copy to improve its estimates. The [privacy policy](/privacy) says exactly what's sent. You can turn it off in [Settings](/settings).

#### A beta can change

Offer Sheet is a beta. Its features may change, break or go away, it may pause or stop, and ESPN, Sleeper or another source may change or block what it reads, at any time and without notice. The leagues you saved stay in your browser until you remove them or your browser clears them (the privacy policy says when).

#### No warranty

Offer Sheet is provided “as is”, without warranties of any kind. As far as the law allows, its maker isn't liable for any loss or damage from using it or from relying on its numbers, including trades you make or don't make.

#### Changes and contact

If these terms change, we'll update them here and change the date above. Using Offer Sheet after a change means you accept the new terms.

Contact: to be added before launch

## The feedback page (/feedback)

### Feedback

Offer Sheet learns from what happens to its trade ideas. Here's how to tell it.

#### On every trade idea

Each trade idea on the Trade Finder and the Trade Analyzer has buttons for what happened: Sent, Accepted, Rejected and Countered. If something looks wrong, press Report and pick a reason: Doesn't help me, They'd never accept, Player info is wrong, League settings look wrong, or Other, with a note if you like.

- Every press is saved with that league in this browser.
- Unless you turn it off, an anonymous copy also goes to Offer Sheet, to make its estimates better: what you pressed, the players as ID numbers, your league's format and Offer Sheet's numbers for the trade. Never your league's ID, names or usernames.
- A note you type with a report stays in this browser. It's never sent.
- To stop sending copies, turn off “Share anonymous feedback” on the [Settings page](/settings). That choice is saved in this browser.
- “Export feedback”, also on the Settings page, downloads everything you've saved, notes included, as a file.

The [privacy policy](/privacy) lists exactly what's sent and how long it's kept.

#### Anything else

A bug, a league that imported wrong, or an idea: get in touch.

Contact: to be added before launch

## What the pages say today instead

Until browser reading (track BF) and anonymous feedback (track FB) are built, `POLICY_FEATURES` has both off and the pages show these passages in place of the ones above (the rest is the same). Each is listed under the section it sits in; a section of the text above that has no passage here ("Anonymous feedback") doesn't show at all today.

### The privacy policy (/privacy)

#### The short version

- Our server reads your league from ESPN or Sleeper and scores each player's projections with your league's rules. The League page's math (lineups, needs, trade partners, playoff odds), the trade search and the Trade Analyzer all run in your browser.
- The leagues you import stay saved in this browser, with your team pick, your settings for each, the projections the League page loaded for them and any feedback you give on trade ideas, until you remove a league or clear this site's data. What's saved is read only in your browser: our server gets only what it needs to read a league again (its ID and season, and a Sleeper username you entered).
- Our server keeps copies of what it reads for a limited time (league data for about 10 minutes), filed under codes that hide league IDs, then deletes them.
- To keep things fair, our server counts requests under a one-way code made from your IP address, never the address itself. The counts it keeps at Upstash are deleted within 10 minutes.

#### Reading your league

When you connect a league, our server reads it from ESPN or Sleeper (a private ESPN league with the ESPN cookies you give it, below), turns it into the Import Report with public data it keeps itself, such as player lists and projections, and sends that to your browser.

#### Your leagues in this browser

When you open the League page, our server reads your league again (usually from its short-lived copy) along with the projections and trade values for its players, and scores the projections with your league's scoring rules. Your browser saves the latest projections and values with the league, and uses them again for up to 6 hours. The League page's math (lineups, needs, trade partners, playoff odds) runs in your browser; your league isn't sent to anyone else to be analyzed.

#### Our server's copies

To go easy on ESPN, Sleeper and the other sources, our server keeps copies of what it reads, then deletes them:

- League data (settings, rosters, schedule and transactions): about 10 minutes. Transactions and matchups from weeks that ended more than a week ago rarely change, so they may be kept for up to 6 hours.
- A Sleeper username lookup (which leagues that username is in): 10 minutes.

These copies are kept at Upstash, the database service we use through Vercel, in its US East region, each filed under a code made with a secret key only our server has, so league IDs and usernames never appear in the database's keys. Upstash deletes each copy when its time is up. Our servers may also hold copies in their memory: a server stops using a copy when its time is up and deletes it soon after while it keeps running, and everything in its memory is gone when it shuts down.

#### Limits on requests

To keep Offer Sheet free and fair for everyone, our server limits how many requests one visitor can send in 10 minutes. It counts them under a one-way code made from your IP address with a secret key, never the address itself. Each count kept at Upstash is deleted one window after it starts, so within 10 minutes. A count a server holds in its memory is deleted soon after its window ends while that server keeps running, and is gone when it shuts down.

#### Settings and trade feedback in this browser

These are saved with each league in this browser's IndexedDB storage, so they're there the next time you use Offer Sheet. They're read only in your browser and never sent to our server.

#### Sleeper

Sleeper leagues are public. If you enter a username, our server uses it only to look up your leagues and find your team, and keeps that lookup for 10 minutes. Your browser saves the username with each league you import with it, so the League page can find your team again.

#### Who handles the data

- Upstash keeps our server's copies, the request counts and the error log ([Upstash's privacy policy](https://upstash.com/trust/privacy.pdf)).

### The terms of use (/terms)

#### Feedback

When you mark what happened to a trade idea or report a problem with one, it's saved in your browser only: Offer Sheet doesn't receive it. The [privacy policy](/privacy) says what's kept.

### The feedback page (/feedback)

#### (under the title)

Here's how to record what happens to Offer Sheet's trade ideas, and how to reach us.

#### On every trade idea

- It stays in this browser, notes included: Offer Sheet doesn't receive it.
- “Export feedback” on the [Settings page](/settings) downloads everything you've saved, notes included, as a file.

The [privacy policy](/privacy) says what's kept.
