# Planner reply to Checkpoint 7a

**Checkpoint 7a is approved** once the Upstash check below passes and Parker confirms the preview works on his phone. Tag `checkpoint-7a` then.

**Next:** do everything below and stop at **Checkpoint 7b**. Production still waits for Parker's explicit "go."
- **Priority if time runs short:** sections 1–5 are launch blockers. Section 6 comes after them.
- The waiver view (6.2) may ship right after launch if needed.

---

## 1. Upstash check (do this first)

Parker connected the Upstash integration in the Vercel dashboard and ran `npm run preview:deploy -- --live` himself. That made https://offersheet-n7pedo6xa-parker-daniels.vercel.app. He saw `KV_REST_API_URL` and `KV_REST_API_TOKEN` in Upstash, but couldn't find the project's environment variables in Vercel.

Verify:
- the Upstash variables exist on the Vercel project for Preview and Production (names only, never values)
- the preview really uses the shared store, through a health check that shows the store type and never secrets
- the database is in **US East (us-east-1)** with **backups off**, which the privacy policy depends on

If you can't see something, give Parker click-by-click steps to check it, or to recreate the database in US East.

---

## 2. Planner questions

### 5. Price "Protect my trade value" in lineup points: yes
- **Formula:** market term = (B₃ / 3) × κ_pts × clamp(g_mkt(me), −0.5, 0.5).
- **κ_pts:** Low 1, Medium 2 (default), High 4, in points a week per 100% of trade value.
- **Medium in practice:** giving 25% more value than you get costs about 0.4 points a week.
- **Analyzer Details:** "Trade value: −0.4 pts/week equivalent."
- **Dynasty and keeper:** the term stays inside the win-now part.

### 6. The dynasty scale follows the slider
- **B_ref(λ)** = (1 − λ) × B₃ + λ × F₁₀, where F₁₀ = the B_future of gaining 10% of your roster's long-term value (= 4).
- **Helps you and Overall** both use B_ref(λ).
- **The tooltip follows the mix.**

### 7. Beta capacity: OK
- The infrastructure report says the free tiers carry about 100–400 sessions a day. That's fine for a beta.
- **At the limit:** show "The beta is at capacity today. It resets at <time>." Never a broken page.
- **Usage check:** add `npm run usage:report`.
- **If it's cheap, cut cold-instance Upstash reads.** About 3.9 MB per cold session makes Upstash bandwidth the first limit (about 80–140 cold sessions a day). For example, serve the public data bundles from Vercel's CDN cache (`s-maxage`) instead of Upstash. If that's more than a small change, ship as is and revisit with real traffic.
- **The WAF rule:** confirm the Vercel WAF rate-limit rule is available on Hobby. If it isn't, rely on the app's own limits.

---

## 3. Parker's answers
- **Contact email:** offersheet.app@gmail.com, on the privacy, terms and feedback pages (`CONTACT_EMAIL`).
- **Name:** the pages say "Offer Sheet," with no personal name.
- **Icon:** keep the navy football on gold, for the tab, the home screen and the sharing image.
- **Feedback retention:** 12 months, deleted automatically (section 4).

---

## 4. Privacy policy and terms: required edits

The drafts are accurate and honest, which is the hard part. They're too long and technical for users, though, and one promise depends on Parker remembering a chore.

### Privacy
1. **Keep "The short version" at the top,** and add one line: "Offer Sheet sets no cookies, except one encrypted cookie if you connect a private ESPN league."
2. **Cut implementation detail users don't need:**
   - the IndexedDB database name
   - tab session-storage codes and tab-to-tab messages
   - the old localStorage keys and the migration paragraph
   - how Finder and Analyzer addresses carry IDs, and "never loads these addresses ahead of time"
   - the in-memory signed-import reuse
   - the exact rate-limit windows and counts (say "per-visitor limits, counted under codes made from your IP address with a secret key, deleted within a day")

   Keep everything that tells users what is collected, where it goes, how long it's kept, how to delete it, the cookies, the logs, who handles the data, children and contact. **Aim for the detailed part to be about 1,000 words.** Update `pages.test.ts` with it, removing each statement and its test together.
3. **Feedback retention:**
   - The policy says: "We keep anonymous feedback for up to 12 months, then delete it." Remove the monthly-download promise and the download mechanics.
   - **Tooling:** the analysis and refit scripts read straight from Upstash and save only aggregate results and fitted numbers locally, never raw records. Rename or replace `feedback:pull` to match.
4. **Public-data archive** (section 6.6): say that pre-game projection snapshots and daily trade-value lists are public and not about any league, and that they're kept up to 2 seasons to measure accuracy.
5. **Checks on the 7b go/no-go list:**
   - no league ID, username, SWID or cookie ever appears in a URL or query string (Vercel logs addresses for an hour), so everything sensitive goes in request bodies
   - Upstash is in US East with backups off
   - no analytics or third-party scripts
   - the footer and terms credit exactly the sources production uses: if nflverse or anything else is still used, credit it, and remove any that aren't used
   - the iPhone storage sentence is checked on a real iPhone, if Parker has one; otherwise soften it to "may"
   - "Last updated" is set to launch day, and the contact email is filled in

### Terms
1. **"Your part,"** first bullet: "connect only leagues you're in, or leagues you're allowed to view (Sleeper leagues are public; an ESPN league is public only if its manager made it viewable)". Add a bullet: "don't use Offer Sheet to collect information about other people."
2. **The cookie bullet:** "keep your ESPN cookies private: they work like a password, so never share them, and paste them into Offer Sheet only on a computer you trust."
3. **Add:** "You must be at least 13 to use Offer Sheet."

Three of the four lead decisions in the drafts are fine: the app opens on the League page, notes are never sent, and the app pages are noindex. The FantasyCalc links change per 5.4: no `noreferrer`, with `referrerpolicy="origin"`.

---

## 5. Launch-blocker additions from Parker's preview test

### 5.1 Plain-language data notices
Parker's Import Report and League page show internal text: codes like `ESPN_SCORING_UNMAPPED`, JSON paths, stat IDs, and free-agent ID matching. Users should never see that.
- **Notice:** show one, in plain words, only when it can change what the user sees or decides:
  - a player on the user's roster, or a likely starter on any roster, is missing projections or was matched uncertainly
  - a scoring rule isn't counted, and it's a common rule or has scored points in this league this season
  - a setting that affects results couldn't be read
- **Quiet line** in the Import Report's scoring section, for rare uncounted rules: "Two rare rules aren't counted: 1-point safeties and blocked-kick return touchdowns. They almost never happen."
- **Everything else** goes in a collapsed **"Technical details (for bug reports)"** section at the bottom of the Import Report, never on the League page. That includes free agents matched by name, ID conflicts on deep backups, codes, paths and stat IDs.
- **The League page's yellow banner** appears only for notices. For Parker's league today, that should mean no banner, unless one of the three players without a Sleeper id is a likely starter.

### 5.2 Goal setting: framed by what the league rewards, with no auto-switching
- Parker asked about switching the goal automatically by playoff odds. Don't. "Win the title" already values making the playoffs, because you can't win without getting in. Switching a bubble team to "Make the playoffs" would push it toward safe moves exactly when it needs upside. The right choice depends on the league's prizes, not the team's odds.
- **Reword the setting** as "What does your league reward?":
  - **Only the champion** (default; the weights of "Win the title")
  - **Top finishers too** (Balanced)
  - **Making the playoffs** (Make the playoffs)
- **Helper line:** "On the bubble? Keep 'Only the champion.' It already counts getting into the playoffs."

### 5.3 Freshness and the best time to look (Trade Finder)
- **In season, one line:** "Best time to look: Tuesday or Wednesday, after Monday night's game. Trade values and projections have caught up with the weekend, and a trade still has time to clear your league's <review period> review before Thursday."
- **Freshness:** "Trade values updated <time ago> · Projections updated <time ago>."

### 5.4 FantasyCalc's conditions (they replied on 2026-10-05)
FantasyCalc approved free use under these conditions. Save the reply's terms in `reports/fantasycalc-permission.md`, dated.
- **Traffic:** free while we're under about 10,000 sessions a month (or $2,000 a month in revenue; we have none).
  - `usage:report` shows monthly sessions against 10,000 and warns at 8,000, so Parker can contact them before we cross it.
- **Attribution:** a clear link back to fantasycalc.com on **every page that shows their data or anything derived from it**.
  - At least one such link per page must be plain server-rendered HTML: not loaded by JavaScript, not behind anything.
  - Use `rel="noopener"` (no `nofollow`, no `noreferrer`) and `referrerpolicy="origin"`. That way FantasyCalc sees visits come from Offer Sheet but not which page. Update the privacy policy's sentence about these links.
  - The footer counts if it's server-rendered on every app page. Verify it in the built HTML.
- **Caching:** call only `/values/current`. Their values update every 3 hours, so refresh each format's list at most once every 3 hours, and only when someone needs it (this replaces once a day). Update the privacy text to match.
- **Don't compete with their trade calculator or league analyzer.** FantasyCalc approved because they understood we **don't display their values in the UI at all**. Make that true:
  - Remove every FantasyCalc value number and value comparison from the cards, reasons, pitch messages, League page and Analyzer Details.
  - Where a reason needs it, use plain words with no number, for example "They come out ahead on trade value, which makes a yes more likely."
  - Our own outputs (chance they accept, projections, Helps you, odds) stay as they are, with the attribution link.
- **TE premium:** our te+ / te++ mapping is confirmed. Mark it ✅.
- **Parker** will send FantasyCalc a short follow-up describing the Analyzer and the League page, so there are no surprises.

---

## 6. Additions after the blockers

### 6.1 Automatic playoff-week weight (replaces the 1.25 setting)
- **The weight:** ω = (B per point in playoff weeks) ÷ (B per point in regular-season weeks). It's per league, team and goal, from two extra runs with common random numbers: +3 points a week in the remaining regular-season weeks only, and +3 in the playoff weeks only, each normalized per week.
  - Clamp ω to [0.5, 4].
  - If no regular-season weeks remain, ω doesn't matter.
- **Where it's used:** wherever ω is used today (ROS weighting for shortlists, the free-agent optimizer, needs and chips).
- **The ROS points users see** stay unweighted.
- **Settings shows it read-only,** for example: "Playoff weeks count: 1.6×, set automatically from your odds. It only affects shortlists, free-agent rankings, needs and trade chips. Final scores come from playing out the season, which weighs each week by its real effect on your odds."
- Remove the manual control.

### 6.2 Waiver upgrades (League page, linked from the nav)
- **Who's listed:** every free agent who projects for more rest-of-season points than at least one player on the user's roster at the same position.
- **Columns:**
  - player, position, NFL team, bye and injury tag
  - ROS points and this week's projection
  - **"Better than":** the user's players at that position he out-projects
  - **"Lineup gain":** the change in the user's ROS lineup points from adding him and dropping the engine's best drop candidate, computed with the scenario lineups, naming the drop
- **Sorting:** by lineup gain, then ROS points. Rows with no lineup gain still show, lower, tagged "depth only."
- **Toggle:** "Rest of season" (default) or "This week." "This week" includes K and D/ST for the positions the user streams.
- **Waiver status:** show it when the platform reports it, for example "On waivers until Wed" or "Free agent now."
- Works at 375 px.

### 6.3 Automatic pre-game snapshots (production only)
- **Schedule:** a daily Vercel cron at `0 20 * * *`. That's UTC, and on Hobby it runs sometime within that hour.
- **Security:** the route checks `CRON_SECRET`, takes a lock, and is idempotent. Delivery is best effort, so handle missed and duplicate runs.
- **What it saves:**
  - when the current NFL week's first kickoff is still ahead, the week's Sleeper projections, overwriting that week's earlier save, so the last pre-kickoff copy wins
  - the day's FantasyCalc lists for the formats in use
- **Storage:** Upstash, compressed, kept up to 2 seasons.
- **Download:** `npm run snapshot:pull` copies them to `data-local/` for Phase 6.
- **Until launch:** Vercel runs crons only on production, so Parker keeps running `npm run snapshot:projections` by hand. It's optional.

---

## Checkpoint 7b must include
- **Upstash:** the check results.
- **Privacy and terms:** the final, shortened text.
- **Notices:** what Parker's league shows after the cleanup.
- **Parker's numbers:** his B₃, his automatic playoff weight, and his top 10 under the new trade-value pricing, briefly.
- **The waiver upgrades view:** the top rows for Parker's team, or a note that it ships right after launch.
- **B4:** the security findings, the load test, and the stability numbers (with smoothing if it was needed).
- **Capacity:** the capacity message and the `usage:report` output.
- **The snapshot cron:** configured, and tested locally by calling the route with the secret.
- **The go/no-go list:** FantasyCalc's conditions met (5.4), with no value numbers anywhere in the UI, the backlink in server HTML on every app page, and the 3-hour caching. Also the contact email, the launch dates, and the checks in section 4.
