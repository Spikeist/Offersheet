# Checkpoint 7b — the planner's reply to Checkpoint 7a, and readiness (B4)
Status: ⚠️ Done with issues. Everything in the reply is built, tested and reviewed; what Parker's league shows was checked live (check:browser, the preview), the cron only locally, as asked, and `usage:report` only on made-up counts. The go/no-go list is below. Production waits for Parker's "go". The open issues: Parker's stable copy still runs Checkpoint 7a's code (it calls FantasyCalc's `/players` and shows values until 7b is tagged), and three steps happen at the go.

## What works
- **§1 Upstash check** (this unlocked the `checkpoint-7a` tag, on c321752, after Parker's phone check):
  - **Variables:** the database's variables are on Vercel for Preview and Production (names only): `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL`, `REDIS_URL`.
  - **Region and plan:** ✅ the store's settings, read through Vercel's API, say primary region iad1 (AWS us-east-1), no read regions, Free plan, eviction off and auto-upgrade off. Backups are off ✅ (Parker checked Upstash's console).
  - **In use:** `/api/health` on the previews reports `"store":"shared"` and a timed write/read/delete (2026-10-06: GET 14 ms, DEL 9 ms; first SET 151 ms with TLS), never a secret.
- **§2:**
  - **Q5:** "Protect my trade value" is a lineup price: Low 1, Medium 2, High 4 points a week per 100% of trade value, on each evaluation's own B₃. At Medium, giving 25% more value costs 0.4 points a week. The Analyzer's Details read "Trade value: −0.4 pts/week equivalent."
  - **Q6:** dynasty and keeper scale B_ref(λ) = (1 − λ) × B₃ + λ × 4. The tooltip follows the mix (+3 a week this season plus 10% long-term value reads 63).
  - **Q7:**
    - **At capacity:** "The beta is at capacity today. It resets at <time>.", in the visitor's own time.
    - **Usage:** `npm run usage:report`.
    - **WAF:** confirmed on Hobby (Vercel's docs: 1 rule, fixed window 10 s–10 min, by IP).
    - **CDN:** not built (reasons in `reports/beta-infrastructure.md`). Cold reads fell anyway, from 3.9 to about 2.1 MB.
- **§3, §4 policies:**
  - **Contact and name:** offersheet.app@gmail.com on privacy, terms and feedback; "Offer Sheet" with no personal name; the icon unchanged.
  - **Feedback:** kept up to 12 months, now exact (each day's list goes 365 days after that day began). `npm run feedback:report` (totals only) replaces `feedback:pull`.
  - **Privacy:** the detailed part went from 3,042 to 1,249 words, with the cookie line, the public-data archive sentence and every cut on the planner's list.
  - **Terms:** the planner's three edits.
  - **FantasyCalc links:** `rel="noopener"`, `referrerpolicy="origin"`.
  - Full text: `reports/privacy-terms-draft.md`.
- **§5.1 notices:**
  - Every one of the 116 warning codes is a notice, a quiet scoring line or "Technical details (for bug reports)", collapsed last on the Import Report. Banners show notices only.
  - **Parker's league:** no League page banner; the Import Report's tile says "Notices: None"; the scoring card shows "Two rare rules aren't counted: 1-point safeties and blocked-kick return touchdowns. They almost never happen."; 8 items sit under technical details.
- **§5.2:** "What does your league reward?" with Only the champion (default) / Top finishers too / Making the playoffs, plus the bubble helper line.
- **§5.3:** the Trade Finder shows "Best time to look: … clear your league's 1-day review before Thursday." in season, and "Trade values updated … · Projections updated …".
- **§5.4 FantasyCalc** (conditions in `reports/fantasycalc-permission.md`, with Parker's decision to send FantasyCalc no follow-up email):
  - only `/values/current`; each format refreshed at most every 3 hours, on demand
  - no value number or value comparison anywhere in the UI
  - a server-HTML backlink on every page
  - sessions tracked against 10,000 a month
  - te+/te++ ✅
- **§6.1:** the playoff-week weight is set automatically (read-only in Settings). The manual control is gone.
- **§6.2:** Waiver upgrades, on the League page and in the nav: Rest of season / This week / Next week, the lineup gain naming the drop, "Depth only", and ESPN's waiver status.
- **§6.3:**
  - **Schedule:** the snapshot cron (`0 20 * * *` UTC, production only).
  - **What it saves:** this week's and next week's Sleeper projections before kickoff, and the day's FantasyCalc lists for the formats in use (at most 12, in turns). Both are kept 730 days.
  - **Security:** the route checks `CRON_SECRET` in constant time and takes a lock.
  - **Tested locally:** no header 401, wrong header 401, the secret 200 (week 5 saved, and the format in use saved from the list FantasyCalc had served that day, with no FantasyCalc request), a second call changed nothing.
  - **Copying it down:** `npm run snapshot:pull -- --live`.
- **B4:** the security review (`reports/security-review.md`), the load test (`reports/load-test.md`) and base-rate stability (`reports/stability.md`). Numbers below.
- **Checks:**
  - **check:browser:** `npm run check:browser -- --live --team 3` on the production build: **126 passed, 0 failed, 3 skipped** (2026-10-06). It covers no values shown, notices, the waiver view, the nav, the Finder's lines and Settings.
  - **Built HTML:** all 11 pages carry exactly one footer FantasyCalc link with the right attributes, and no third-party scripts. The same holds on the 10 deployed pages of the preview.

## What doesn't / open issues
- **Parker's stable copy:** `npm run stable` still serves `checkpoint-7a` (`git show checkpoint-7a:src/data/load.ts`), which calls FantasyCalc's `/players` about once a day and shows FantasyCalc value numbers. FantasyCalc's conditions rule both out. The options: tag 7b once approved (question 1), or don't run `npm run stable` until then.
- **Image endpoint:** Vercel's own optimizer still answers `/_next/image` for our 5 icons despite `images.unoptimized` (other widths and other sites' images get 400). It's bounded, so I accepted it; a WAF custom rule can deny it at launch.
- **Partial imports:** an ESPN import whose free-agent or player-card reads our own queue cut at the deadline answers 200, with a plain notice of what's missing (Refresh fixes it).
- **Sam Hartman:** without `/players`, his ESPN id correction is lost (a backup QB; Parker's league is unaffected).
- **Build cap's cost:** in a cold burst the cap costs CPU: 50 builds took 26–30.5 s against 22.5–23.2 s uncapped. The heap's peak growth was 0.5–1.1 GB over the capped runs (366 MB live under a 768 MB limit) instead of 2 GB.
- **`usage:report` live:** it needs the store's URL and token typed into `.env.local` (How Parker can try it). The sample below uses made-up counts.

## Decisions I made (⚠️ = our reading)
- ⚠️ **Dynasty and keeper:** still no market term. We read "the term stays inside the win-now part" as no change: there is no term there.
- ⚠️ **One ω for all teams:** from your team and goal, measured on the teams as they stand (ω₀ 1.25 where that setup reads ω), clamped to [0.5, 4].
- ⚠️ **Scaled thresholds:** the 3-point pickup bar, the 10-point chip gap and the 5-point throw-in cost scale with Σω ÷ Σω₀. Without that, your goal would change every team's modeled pickups. Your headline now moves at most 0.4 points across goals.
- **Words for trade value:** they come from the model's view, counting roster spots, never a number. The message to send no longer mentions value. The League page's blend line is words only.
- ⚠️ **Sessions:** League page builds answered, which over-counts slightly (the safe side of 10,000). FantasyCalc's daily budget is 1,500, sized to the 3-hour rule over all 144 formats.
- **Waiver view:**
  - The gain is unweighted (§6.1), and the drop is chosen by rest-of-season keep value.
  - ⚠️ "Depth only" marks only a pickup who wouldn't start in a normal week.
  - ⚠️ A third list covers the week under way.
- **Sleeper review period:** unknown when the league's veto setting is missing.
- **No base-rate smoothing for launch**, and no CDN route (both explained in the reports).

## Numbers
- **Gate:**
  - 244 test files, 4,513 tests pass (1 skipped); typecheck and lint clean; leak check 0 hard hits.
  - 7b added about 440 tests, including guards: no FantasyCalc values, notices, client bundle, Next config.
- **Your league (Oct 4 09:24Z dump, team 3; `reports/trade-report.md`, `reports/league-report.md`):**
  - B₃ 4.94 (Top finishers too 5.93, Making the playoffs 7.66).
  - ω 1.98 (1.08, 0.5; live today 2.2).
  - Odds with pickups 60.2% / 10.5% (as rosters stand 65.0% / 12.0%).
  - 13 cards, 17,182 trades screened, search 5.4 s warm.
- **Top 10 (Helps you / chance / Overall · trade value in points a week):**
  1. T8 Wilson → Watson + Tate: 27 / 50% / 15 · −0.24
  2. T8 Wilson → Watson + Goedert (Out): 22 / 65% / 15 · −0.42 (new under the price)
  3. T4 Wilson → Hubbard + Evans: 37 / 35% / 14 · −0.08
  4. T9 Nacua → Flowers + Hampton: 47 / 25% / 14 · −0.12
  5. T1 Nacua → Swift + Adams: 33 / 35% / 14 · −0.21
  6. T7 Nacua → J. Williams + P. Washington: 51 / 20% / 13 · −0.01
  7. T9 Bowers → Flowers + Kincaid: 48 / 10% / 7 · −0.01
  8. T6 Monangai → Metcalf: 16 / 35% / 6 · +0.09
  9. T6 Monangai + Harrison → Price (IR) + Pittman: 15 / 40% / 6 · 0.00
  10. T6 Nix → Price (IR): 15 / 35% / 6 · +0.17
- **Waiver upgrades (your team):**
  - Rest of season: Malik Washington +3.3 (drop R. Doubs; the model's own pickup), Hunter Henry +2.2, Mark Andrews +0.9, Xavier Worthy +0.9; then "No gain" rows.
  - Next week: Jaguars D/ST +2.2 over the Bills.
- **Live, production build at 375 px:** import 5.7 s (browser path, 23 platform reads), League page 4.1 s, full search 5.5 s (target 10 s).
- **Preview, live burst** (the public test league, server path): 5 concurrent ESPN imports, all 200 in 10.0–10.5 s; 5 concurrent League page builds, all 200 in 6.6–6.8 s.
- **Load test** (50 at once against mocks): no 500s, every host paced. Fixes, before → after:
  - outbound counted 82/35 sent → 34/34
  - refused work no longer inflates the day (660 → 498)
  - heap of a cold burst 2,046 → 546 MB
  - cache commands 1,173 → 69
- **Security:**
  - **Coverage:** 69 checks.
  - **Findings:** 14 in all.
    - Fixed: 8 (the image endpoint only partly: Vercel still answers it, bounded).
    - Left for launch: the WAF rule.
    - Accepted or noted: 5, including HSTS, which the preview confirms.
  - **Audit:** `npm audit --omit=dev` found 0 advisories.
- **Stability:** with refreshes about a day apart, your playoff odds move at most 2.4 points and other teams' at most about 2.7. One refresh 2.5 days apart moved you −3.5 to −4.9, from role news that held.
- **`usage:report` sample** (made-up counts): "Sessions this month: 201 of 10,000 (FantasyCalc's free limit). … at this pace about 1,039 by the month's end."; today's work units and outbound requests against each budget; a 7-day table.

## Go/no-go list
| Item | State |
|---|---|
| No FantasyCalc value number or comparison anywhere in the UI | ✅ guard test, check:browser on the live league |
| FantasyCalc link in the server HTML of every app page (`noopener`, `origin`) | ✅ built pages and the preview |
| FantasyCalc: `/values/current` only, each format at most every 3 hours | ✅ app and probes · ❌ stable copy until 7b is tagged |
| Sessions tracked against 10,000 a month (warning at 8,000) | ✅ `usage:report`, tested · ⚠️ not read live yet |
| Contact email on privacy, terms, feedback | ✅ |
| No league id, username, SWID or cookie in our URLs | ✅ security review |
| Upstash in US East, backups off | ✅ |
| No analytics or third-party scripts | ✅ dependencies, CSP, built and deployed HTML |
| Footer and terms credit exactly ESPN, Sleeper, FantasyCalc, DynastyProcess | ✅ (nflverse isn't used) |
| iPhone storage sentence | ✅ softened to "may" (not checked on an iPhone) |
| "Last updated" on launch day; launch date | ⏸ Parker (question 2) |
| Production SESSION_SECRET and CRON_SECRET | ⏸ at the go |
| WAF rate-limit rule on `/api/*` (rate limit or deny with 429, never a challenge) | ⏸ at the go |
| Next on the latest 16.3.x patch | ⏸ checked at the go |

## Questions (numbered, each answerable in one line)
1. Parker: approve Checkpoint 7b so I tag it, which moves your stable copy off `/players` and FantasyCalc's values?
2. Parker: what launch date (for "Last updated"), and is the go now or later?
3. Planner: are dynasty and keeper leagues right to keep no market term (our reading of "inside the win-now part")?
4. Planner: the Phase 6 stability re-measurement needs each player's rest-of-season level daily. Should the cron also save that, a few KB a day?
5. Planner: OK that the feedback export file and the anonymous copies keep the model's value ratios (no FantasyCalc numbers)?
6. Planner: the same pickup reads +4.1 on the roster card (playoff weeks weighted) and +3.3 in Waiver upgrades (unweighted), both labeled. Keep both?
7. Planner: accept the privacy page's detailed part at 1,249 words (the target was about 1,000)?

## How Parker can try it
- **The preview** (protected): https://offersheet-ptq1waodj-parker-daniels.vercel.app. Log in with Vercel, import your league, then try Waivers, Settings ("What does your league reward?", "Playoff weeks count") and the Trade Finder's two new lines.
- **The browser check** (PowerShell, one per line):
  ```
  npm run build
  npm run check:browser -- --live --team 3
  ```
- **`usage:report`:**
  1. In Vercel, open Storage → upstash-kv-alizarin-saddle and copy the REST URL and token into `.env.local` as `KV_REST_API_URL` and `KV_REST_API_TOKEN`, typed by hand (never `vercel env pull`).
  2. Run:
     ```
     npm run usage:report -- --live --env preview
     ```
- **Until 7b is tagged:** don't run `npm run stable`. Use the preview or `npm run dev` (http://127.0.0.1:3001; import your league there).
- **At the go** (after your "go"):
  ```
  npm run vercel:secret -- --live --env production
  npm run vercel:secret -- --live --name CRON_SECRET
  ```
  Then add the WAF rule (Firewall → Configure → New Rule: path starts with `/api/`, Rate Limit, fixed window 10 minutes, 80 requests, key IP, action 429). I then deploy production and check `/api/health`, the pages and the cron.
