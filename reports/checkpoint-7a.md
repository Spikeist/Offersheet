# Checkpoint 7a — Part A (small fixes) and the public beta's infrastructure (B1–B3)
Status: ⚠️ Done with issues. Everything is built and reviewed, and a protected preview is up. Upstash isn't connected yet (a 5-minute step for Parker, below), and a few answers are needed before launch.

Planner reply: `reports/planner-reply-4c.md`. Production stays off until Parker's "go" at Checkpoint 7b. Details: `reports/beta-infrastructure.md` (cache, limits, free tiers) and `reports/privacy-terms-draft.md` (the full text of /privacy, /terms and /feedback).

## What works

**Part A** (commit 713d966, tag `checkpoint-7a-part-a`, served by the stable copy)
- **A1, stable copy.** `npm run stable` keeps `D:\Source Code\VS Code\fantasy-trade-finder-stable` on the newest checkpoint tag and serves it at http://127.0.0.1:3000. It only installs or rebuilds when something changed, repairs a half-made copy, refuses a second run, and copies `.env.local` without reading it. Development moved to port 3001.
- **A2, "Helps you" on B₃.** B₃ is the B of +3 points a week in every week a trade can change (weeks 5–17), on the same baseline, goal and 5,000 seasons. Helps you = 100(1 − e^(−B/B₃)).
  - Parker's ΔPO₃ is +9.08 points and ΔCH₃ +4.23.
  - B₃ is 4.96 under "Win the title", 5.93 under Balanced and 7.63 under "Make the playoffs". None is floored.
  - +1, +3 and +6 points a week read 28 / 63 / 88 (title), 28 / 63 / 87 and 29 / 63 / 86.
  - Tooltip and info line: "63 ≈ as good as adding 3 points a week to your lineup for the rest of the season." The Analyzer's Details shows "≈ +X pts/week".
  - In dynasty and keeper leagues λ is capped at 0.75 inside B₃. The floor note reads the odds alone.
- **A3, W.** W is the best free agent the allocation leaves unclaimed, solved as a fixed point: 615 → 491 in 2 passes. On the dump the top card's chance fell from 55% to 50% (50.9%), and the list went from 14 cards to 12.
- **A4, inactive teams.** A team with no transaction in 5 weeks makes no baseline pickups, and the Import Report row names it. No team in Parker's league is inactive. Made inactive by hand, Team 6 would add nobody and Parker's week 11 would go from 62% to 84%.
- **A5, offline scripts.** Reports read the newest dump, every networked script except `snapshot:projections` needs `--live`, and the HTTP client refuses live fetches otherwise.

**Parker's top 10 on the new scale** (the 2026-10-04 09:24 UTC dump, "Win the title"). The order is unchanged: ranking is by expected gain. Brackets show the old scale, B_ref 6.

| # | Trade | Helps you | Chance | Overall |
|---|---|---|---|---|
| 1 | Wilson → Watson + Tate (Team 8) | 26 (22) | 50% | 14 (12) |
| 2 | Wilson → Hubbard + Evans (Team 4) | 36 (31) | 35% | 14 (11) |
| 3 | Nacua → Flowers + Hampton (Team 9) | 47 (40) | 25% | 14 (11) |
| 4 | Wilson + Nix → Flowers (Team 9) | 53 (46) | 20% | 13 (11) |
| 5 | Nacua → Swift + Adams (Team 1) | 33 (28) | 35% | 13 (11) |
| 6 | Nacua → J. Williams + P. Washington (Team 7) | 50 (44) | 20% | 13 (10) |
| 7 | Bowers → Flowers + Kincaid (Team 9) | 50 (43) | 10% | 8 (6) |
| 8 | Monangai + Harrison Jr. → J. Price (Team 6) | 15 (12) | 45% | 7 (6) |
| 9 | Bowers → McBride + Evans (Team 4) | 34 (29) | 10% | 5 (4) |
| 10 | Harrison Jr. + Nix → Tate (Team 8) | 11 (9) | 35% | 4 (3) |

Live data tonight: `check:browser --live` showed 12 ideas, led by Nacua → London + Watson (Team 8), 42 / 25% / 13.

**Part B** (commits 994a55f, 7fb7339 and 0db4d68: two build waves of five tracks, each built, reviewed and fixed, then a final review covering security, the policy text against the code, end-to-end flows and free-tier accounting)
- **B1, shared store and cache.**
  - Upstash Redis on Vercel only. Keys are HMAC'd, and values are gzipped and AES-GCM encrypted, bound to their key.
  - A memory tier, a 1 s breaker and cross-instance single-flight sit in front of it.
  - Public bodies are reduced to the fields our code reads, proved identical for every reader. A model build's CPU fell from 0.9 to 0.4–0.6 s.
- **B1, limits.**
  - Every route: cross-site refusal, per-IP windows, deadlines, and an allowlisted error log.
  - Daily outbound budgets, with ESPN requests kept back for private leagues.
  - A daily work budget that keeps server CPU and transfer under Hobby's monthly allowance (units measured on an i9; page loads aren't counted).
  - Friendly RATE_LIMITED, BUSY and SOURCE_SLOW messages that say when to retry; BUSY and SOURCE_SLOW also name the source.

  | Limit | Value (`src/server/limits.ts`) |
  |---|---|
  | Per IP (IPv6: per /64, and its /48 at 10×) | import 30 and model 30 per 10 min; session 20 per 10 min (Forget is never limited); feedback 60 an hour |
  | Outbound, the server's own requests, per UTC day | ESPN 4,000 (1,000 kept for cookie requests), Sleeper 15,000, FantasyCalc 200, GitHub 100; per address block (IPv4 /24, IPv6 /48) ESPN 400 and Sleeper 1,500 |
  | Work budget, per UTC day (Vercel) | 500 units per visitor, 2,000 per address block, 4,000 for the server (a unit ≈ 100 ms CPU or 75 KB of request body) |
  | Private-league cache entries | keyed by a fingerprint of the user's cookies (and HMAC'd), never by the league ID alone |
- **B1, browser reads.** Public ESPN leagues and Sleeper leagues are read by the visitor's browser and uploaded (ESPN about 515 KB gzip, Sleeper 13 KB). The server re-checks them and replays them through the same adapters, so the snapshot is identical. They're never cached.
  - The League page sends back the signed import (HMAC, 15 minutes) while its league data is under 10 minutes old, so the server doesn't read the league again. Older data, or Refresh, reads it again.
  - Leagues read with ESPN cookies (private ones) use the server path. Browser-side failures (CORS, network, timeout, an unanswered request, a refused upload, no gzip) fall back to it automatically. A platform's own answer (not found, not activated, private without cookies) is shown as is, and the Connect page keeps both private-ESPN paths (ask your commissioner, or paste cookies).
- **B2, anonymous feedback.** Each outcome or report sends an anonymous copy unless "Share anonymous feedback" (Settings) is off. A copy holds player ids, positions, the league's format, the numbers and features, and the version sent; never league or team ids, team or owner names, usernames, SWIDs, notes or IP addresses. Copies go to day lists, at most 100 a day, kept a year. `npm run feedback:pull -- --live` downloads them for Phase 6.
- **B3, pages.**
  - Home with the landing page's words and a "Beta" pill, /privacy rewritten, a new /terms, and /feedback.
  - A footer with the attributions.
  - Installable: a manifest and icons drawn from the app's football mark.
  - SEO metadata, an Open Graph image, robots, a sitemap and noindex on per-browser pages.
  - Branded error pages, a production CSP and security headers, all working at 375 px.
- **Protected preview:** https://offersheet-h2pdzi7jm-parker-daniels.vercel.app. A visitor who isn't logged in gets Vercel's login (302).
  - Through Vercel's owner bypass: every page answers 200, a public-league import takes 12.2 s cold, and the signed League page build 7.8 s.
  - The deploy script refuses production flags, uncommitted files and leaks, and checks protection and SESSION_SECRET (set for Preview, never shown).

## What doesn't / open issues
- **Upstash isn't connected yet** (Parker's step below). Until then the preview caches per instance, counts limits and budgets per instance, logs errors to Vercel's console only (kept 1 hour) and doesn't store feedback. A redeploy after connecting picks it up, at a new preview address.
- **Contact address:** /privacy, /terms and /feedback say "Contact: to be added before launch".
- **The "Helps you" scale counts lineup points only** (review SC-2). The redraft market term is still in Checkpoint 3's B units, so where B₃ is small a trade-value change reads large. For Team 2 (B₃ 1.36), a pure +25% value gain reads 52 at Medium. Question 5.
- **Unverified, for 7b:**
  - ESPN's CORS is undocumented. Checked for offersheet.vercel.app and 127.0.0.1:3000.
  - A Home Screen app on iPhone keeping its own storage (one 2023 secondary source).
  - How Vercel's WAF keys IPv6.
  - Vercel's CPU speed against the work units (measured on an i9).
- **Stable copy:** stays on Part A until you approve this checkpoint; then I tag `checkpoint-7a`.

## Decisions I made
- **Values encrypted at rest** in Upstash, bound to their key. The free plan has no encryption at rest, and a private ESPN league's body names its members.
- **Upstash on Vercel only.** KV_* values in `.env.local` never switch the local app to Upstash.
- **The daily work budget** caps the server at about 400 CPU-seconds and 300 MB a day, under Hobby's allowance. That means about 270 ESPN or 500 Sleeper sessions a day before BUSY, so for ESPN it binds before the free tiers do. It's meant to prevent the 30-day pause.
- **Signed imports last 15 minutes.** A model answer is memoized per signed import, so a replay on the same instance costs a lookup.
- **Feedback:** per-day lists, 30 copies per visitor a day, notes never sent.
- **Defaults kept:** start_url /league, FantasyCalc links stay noreferrer, noindex on per-browser pages.
- **Sleeper projections use two fixed position groups.** A forged league can't make the server fetch arbitrary resources. Parker's URLs are unchanged.
- **A3's near-tie side effect is accepted.** With the lower W, Team 2 keeps a player worth W + 20 and makes two small pickups instead of one.
- **Node is pinned to 22.x on Vercel** (the project defaulted to 24), matching this computer.
- **Never `vercel link` this folder.** Linking a scratch folder wrote a token into its `.env.local`.

## Numbers
- Gate:
  - Tests: 223 files, 4,068 passed, 1 skipped.
  - Typecheck, lint and `next build` pass. The leak check has 0 hard hits.
  - `npm run check:browser -- --live --team 3`: 84 passed, 0 failed, 1 skipped (the second league, not requested). It read the league in the browser (23 requests to ESPN: 12 reads and 11 CORS preflights), built the League page from the signed import, ran a full search and checked the CSP.
- Live timings on this PC's production build: import through the browser 9.9 s, League page 8.5 s, Trade Finder search 5.3 s in the worker.
- Part B changed no engine number: the trade and league reports reproduce Part A's exactly on the dump.
- Free tiers: roughly 100–400 sessions a day. Cold instances are bound by Upstash bandwidth (about 80–140), warm ESPN sessions by Fast Origin Transfer (about 400), but the work budget stops ESPN sessions at about 270 first. The free allowances: Upstash 500K commands, 10 GB and 256 MB; Vercel 4 h CPU, 10 GB Fast Origin Transfer and 1M invocations a month. Tables are in `reports/beta-infrastructure.md`.
- **Please forward to the planner:** this file, `reports/beta-infrastructure.md` (the cache and rate-limit design with the free-tier arithmetic) and `reports/privacy-terms-draft.md` (the full privacy and terms text).

## Questions (numbered, each answerable in one line)
1. Which contact email should /privacy, /terms and /feedback show?
2. Keep anonymous feedback for a year (at most 100 copies a day), and is it OK for the privacy page to promise you'll run `npm run feedback:pull -- --live` at least monthly?
3. Keep the app's navy football on gold as the icon (tab, home screen, sharing image)?
4. Is the terms' "connect only leagues you're in, or public ones" wording right?
5. Planner: should "Protect my trade value" become a lineup price (κ_eff = κ_pts × B₃ / 3, Medium κ_pts 2) so trade value reads the same in every league, or stay in B units? For Parker: κ 4 → 3.3, and a −21% card enters at #2. For weak teams, value-losing trades rise.
6. Planner: in dynasty and keeper leagues at high λ, keep B₃ = (1 − min(λ, 0.75)) × B_win₃ (a 15% long-term gain can read 100), or use B_win₃ alone?
7. Is the work budget (about 270 ESPN or 500 Sleeper sessions a day across all users) the right ceiling for the beta?

## How Parker can try it
**Stable copy (unchanged; Part A).** In PowerShell, one line at a time:
```
cd "D:\Source Code\VS Code\fantasy-trade-finder"
npm run stable
```
Open http://127.0.0.1:3000. Ctrl+C stops it. Run it again after each approved checkpoint to update.

**The preview on your phone.** Open https://offersheet-h2pdzi7jm-parker-daniels.vercel.app and log in to Vercel when asked. Then import your ESPN league by its link, and try League, Trades, the Analyzer, Settings and the feedback buttons. The Import Report should say "League data read by: Your browser".

**Connect Upstash (about 5 minutes, in the Vercel dashboard):**
1. Open https://vercel.com → the **offersheet** project → **Storage** (or Integrations → Browse Marketplace).
2. **Upstash** → **Upstash for Redis** → **Install** (accept Upstash's terms).
3. Create a database:
   - plan **Free**
   - primary region **Washington, D.C., USA** (shown as iad1 or us-east-1, next to the app's functions)
   - no read regions
   - **Eviction** left off, no backups
   - any name
   - then **Create**.
4. On the database: **Connect Project** → **offersheet** → tick **Preview** and **Production**, leave **Development** unticked, leave the prefix empty → **Connect**. Don't pick "Production only".
5. Check that Settings → Environment Variables shows KV_REST_API_URL and KV_REST_API_TOKEN (names only).
6. Tell me "Redis connected", and I'll redeploy the preview and send its new link (each deploy gets a new address). Or run this yourself (it uses the Vercel login already on this PC, and fetches the Vercel CLI through npx):
   ```
   npm run preview:deploy -- --live
   ```
   Never run `vercel link` or `vercel env pull` in the project folder: they write into `.env.local`.

**Already done:**
- Deployment Protection (Vercel Authentication, Standard Protection) was already on.
- SESSION_SECRET is set for previews (generated, never shown).
- Fluid compute is on.
