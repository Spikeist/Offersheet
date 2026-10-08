# Checkpoint 7c — the planner's reply to Checkpoint 7b: the launch candidate
Status: ✅ Done. Everything in the reply is built, tested and reviewed, and checked live on Parker's league (check:browser, 148 passed). The production dry run passes except for the two launch-day items Parker does himself (production's secrets and the image-optimizer firewall rule). Production waits for Parker's "go" on Tuesday, October 13, 2026.

## What changed
- **§1 answers.** Q3: dynasty and keeper leagues show "In dynasty and keeper leagues, the Win now ↔ Future slider covers trade value." where "Protect my trade value" would be. Q4: the daily cron also saves each day's rest-of-season levels, from Sleeper's public projections in its standard formats only (never league scoring, the blend or FantasyCalc; 730 days). Q5: the export file leaves out the value ratios (the anonymous copies keep them). Q6: one pickup gain, the unweighted one: Parker's +Malik Washington −Romeo Doubs reads +3.3 on his roster and in Waiver upgrades (was +4.1 on the roster). Q7: nothing to change.
- **§2** `npm run prod:deploy`, the only production deploy path: the approved, newest annotated `checkpoint-*` tag, exported into a clean copy, every check before any upload, checks after, and the rollback printed. Its dry run is below. Also: Next 16.3.8 and source-map-js 1.2.2 (2026-09-30's security releases; `npm audit --omit=dev` 0).
- **§3** privacy and terms (quoted below); all eight policy switches on; detailed part 1,273 words (cap 1,300).
- **§4** review notes: the accepted decisions recorded; Phase 6 gains "other teams' pickups at ω₀"; the firewall's 80 confirmed (below); the five security findings (below).
- **§5** same-position pickups (below).
- **§6** "Several prizes" (1st, 2nd, 3rd, weekly high score, most points), with 2nd and 3rd place, weekly high scores and the points leader in the simulator, and the 3rd-place game read from ESPN and Sleeper.
- **§7** "Helps them" and the "Helps both" sort (below).
- **Reviews:** six build waves, each implemented, reviewed and fixed (61 findings), then a final five-way review (12 findings, 11 confirmed, all fixed; safety and compatibility found nothing).

## The `prod:deploy` dry run (names only; read-only, nothing uploaded; `--ref HEAD` on 86f94d9: this report's commit adds only files under reports/, which aren't deployed)
1 ✅ What: a rehearsal on 86f94d9 (a real deploy needs `--checkpoint checkpoint-7c`) · 2 ✅ Clean copy: 447 files, 9.4 MB, byte for byte the commit · 3 ✅ What the build needs; `vercel.json`: nextjs, iad1, the cron · 4 ✅ the tag's own CSP and its 10 app pages · 5 ✅ Vercel's dry run: exactly the copy's files · 6 ✅ Leak check: 0 hard hits · 7 ✅ Deployment Protection: Standard (`all_except_custom_domains`) · **8 ❌ Production's variables:** KV_REST_API_URL, KV_REST_API_TOKEN set; missing SESSION_SECRET, CRON_SECRET (launch-day step 1); present, not read: KV_REST_API_READ_ONLY_TOKEN, KV_URL, REDIS_URL · 9 ✅ the production domain answers 200 · **10 ❌ Image optimizer:** `/_next/image` and `/_vercel/image` answer 404 (the landing page), not 403 (launch-day step 2's rule) · 11 ✅ Rollback target: offersheet-dtgsgk03x-parker-daniels.vercel.app (the landing page) · 12 ✅ Next 16.3.8, the newest 16.3 patch · 13 ✅ `.env.local` unchanged.

## Privacy and terms: the changed sentences
- Privacy, before the contact line: "Email us to ask what we hold about you or to have it deleted."
- Privacy, the archive: "We also keep public data, Sleeper's pre-game projections, its daily rest-of-season projections in standard scoring formats, and FantasyCalc's daily lists for the league formats in use, up to 2 seasons, to measure how accurate our numbers are. It's never shown and says nothing about any league or person beyond which formats were in use each day."
- Privacy, the anonymous copy: "…your league's format (…) and how your league splits its prizes (as shares, never amounts); …" (was "how you weigh the title against the playoffs").
- Terms: "The numbers Offer Sheet works out are estimates: projections, playoff and title odds, “Helps you”, “Helps them”, “Chance they accept” and “Overall”."
- Feedback page (Q5): "“Export feedback”, also on the Settings page, downloads what you've saved as a file, notes included. It leaves out the trade-value comparisons behind Offer Sheet's estimates."
- "Last updated" stays October 13, 2026. Full text: `reports/privacy-terms-draft.md`.

## Pickups: Parker's trades that open his roster spot (the Oct 4 dump; `reports/trade-report.md` §9)
A spot a trade opens now takes the best free agent at a position the team gave up (scenario gain, then rest-of-season points; any position only when none is left there); the pickups after the trade never drop him. Before → after, Helps you / chance / Overall:
- Card #12, Team 8: Bo Nix + Marvin Harrison Jr. → Carnell Tate: Geno Smith → **Malik Willis** (QB); 11 / 35% / 4 both.
- Card #13 (new), Team 5: Kyle Monangai + Marvin Harrison Jr. → Deebo Samuel Sr.: Malik Washington (WR) → **George Holani** (RB); 13 / 30% / 4 → 11 / 30% / 3.
- Finalists: Wilson + Nix → Flowers and Monangai + Nix → Tate, and Dowdle + Nix → Price: Smith → Willis; Wilson + Monangai → Flowers: Washington → Holani; Wilson + Schultz → Flowers: AJ Barner → T.J. Hockenson; Wilson + Harrison → Flowers: Washington both. Numbers within a point.
- All 42 exact trades that open his spot: QB 21 (Smith → Willis), TE 7 (Barner → Hockenson or Freiermuth), WR 6 (Washington both), RB 8 (Washington → Holani, Kenny Gainwell or Kendre Miller).
- The partners' spots fill the same way, so their chance to accept moves by a point or less on every card but two: #2 52.1% → 49.6%, #6 37.1% → 34.3%. 14 cards (13 before); the top 10 holds the same trades.

## Prizes: his $2,000 / $1,600 / $900, weekly $0 (shares 44 / 36 / 20)
- **3rd place in his league:** the two semifinal losers play for it in week 17. A fresh import reads it from ESPN's consolation-ladder setting (on): "3rd-place game: Yes: the two semifinal losers play for 3rd." with the line "Our reading of ESPN's consolation-ladder setting: its playoff schedule doesn't list a 3rd-place game yet." (⚠️ one league's evidence: the test league's 2025 playoffs, where the semifinal losers played for 3rd in the final round.) The Oct 4 dump predates the reading and assumes the game, the same rule.
- **His odds** (Oct 4 dump, every team after its pickups): playoffs 60.2%, **1st 10.6%, 2nd 8.3%, 3rd 11.2%**, top 3 30.1%. Live today (Oct 8, week 5): 47.0%, 6.2%, 5.6%, 7.1%, top 3 18.9%.
- **His B₃: 3.98** (4.94 under "Only the champion"); the playoff-week weight 1.06× (1.98×): 2nd pays 80% of 1st, so reaching the final matters more than winning it. Live today: 3.61 and 0.81×.
- **Top 5, "Only the champion" → "Several prizes"** (Helps you / chance / Overall): the old #1 Wilson → Watson + Goedert (23 / 65% / 15) drops to #3 (19 / 65% / 13); the new top two are Nacua → Flowers + Hampton (49 / 25% / 15, was #3) and Wilson → Hubbard + Evans (39 / 30% / 15, was #4); #4 is new, Wilson + Bo Nix → Zay Flowers (51 / 20% / 13); #5 Nacua → J. Williams + P. Washington (49 / 20% / 12, was #5). Wilson → Watson + Tate (#2 before) leaves the list. 4 of the top 5 stay; 12 cards (14 before).

## Helps both (his prizes; Oct 4 dump)
- **How many:** 5 of 201 exact trades help both on the screening run; 3 of the 60 finalists; 2 extras (1 still helps both on the final run); 0 of the 12 Overall cards. The "Helps both" sort shows **2 cards** ("Only 2 trades help both teams right now."):
  1. Team 8: Puka Nacua → Drake London + Christian Watson: Helps you 30 · Helps them 38 · 25% (their title 16.7% → 19.2%, top 3 50% → 54%, playoffs 85% → 88%)
  2. Team 6: Garrett Wilson + Bo Nix → Nico Collins: 2 · 14 · 40%
- Under "Only the champion": 3 cards (Nacua → Olave + Watson 50 / 13 / 10%; Nacua → London + Watson 28 / 42 / 25%; Monangai + Schultz → Price 12 / 11 / 30%). Live today, under the default setting: 3.
- **Extra runtime:** +0.21 s warm (+3.6% of 5.8 s): 8 partner calibration runs 0.11 s, the extras' final runs 0.07 s, the second list 0.04 s.

## Security: the five accepted or noted findings (`reports/security-review.md`)
- **9** The session cookie has no `__Host-` prefix: accepted on `*.vercel.app` (public suffix list); revisit with a custom domain.
- **10** A saved ESPN import keeps its players' ESPN-to-Sleeper id pairs in the browser: worth the GPL-3.0 review before any downloadable version.
- **11** No HSTS header of our own: Vercel sends one (`max-age=63072000; includeSubDomains; preload`).
- **13** Phase 5: Yahoo team keys contain the league id: put a per-league index in `?partner=` then.
- **14** The dev-only `braces` lint chain: accepted (unreachable from the build); the new production advisory (`source-map-js`) is fixed by 1.2.2.
- New, **15** (the firewall review): the firewall counts cross-site requests the app refuses before counting, so another site could use up a visitor's 80; an optional third rule would deny them (question 4).

## Launch day, in order (`reports/beta-infrastructure.md`, "Launch-day steps")
1. Production's secrets: `npm run vercel:secret -- --live --env production`, then `npm run vercel:secret -- --live --name CRON_SECRET`.
2. The firewall rules, published: "API rate limit" (`/api/`, fixed window 10 minutes, 80 requests, by IP, Too Many Requests (429)); "Block image optimizer" (`/_next/image` or `/_vercel/image`, Deny); and, if the planner says yes, "Deny cross-site API requests" above the rate limit.
3. Next: `npm view next@16.3 version` must end with 16.3.8.
4. The dry run: `npm run prod:deploy -- --checkpoint checkpoint-7c`, every line ✅.
5. **Parker writes "go."** Then `npm run prod:deploy -- --live --checkpoint checkpoint-7c`; if a check after it fails, `npm run prod:deploy -- --verify --checkpoint checkpoint-7c` (never `--live` twice).
6. Parker opens https://offersheet.vercel.app on his phone and imports his league. After 20:00 UTC the cron's first run shows in `npm run beta:log -- --live --env production` (once the read-only store variables are typed in).
- **Rollback:** Vercel → offersheet → Deployments → offersheet-dtgsgk03x-parker-daniels.vercel.app → ⋯ → Instant Rollback (or `npx --yes vercel@62.2.0 rollback <that address>` from your home folder). It works until the next production deploy; after one, Undo Rollback before the next `prod:deploy` can take the domain.

## Decisions I made (⚠️ = our reading)
- ⚠️ B₃,P is made in the trade context, once per partner when first needed (not in every League page build, which never shows it); floor, then mix, as the planner wrote.
- ⚠️ A given player his own side's baseline would cut anyway opens no roster spot. A partner's fill that takes your League-page pickup, when they claim first, says so on the card.
- ⚠️ 3rd place when a league plays no 3rd-place game: the better seed of the two semifinal losers. A weekly prize counts once per matchup period.
- ⚠️ The Overall list never ranks the Helps-both extras (it's unchanged on Parker's data); a helps-both card's steps and Plan B help both too.
- ⚠️ Waiver upgrades count the week under way (a pickup can still change it); the season-over messages wait while a paid prize can still move, a 3rd-place game included.
- Under "Only the champion" and "Making the playoffs" every League model number and every card is unchanged by the prizes work (checked on Parker's dump and synthetic leagues); same-position pickups move only trades that open a roster spot.
- I read the ESPN test league's 2025 season once (playoff tiers only) and ran the Sleeper CORS check on the pinned test league, to confirm the 3rd-place data; no other league was read.

## Numbers
- **Gate:** 253 test files, 5,122 tests (1 skipped), typecheck, lint, build, leak check 0 hard (7b: 244 files, 4,513 tests).
- **check:browser** on the live league at 375 px: 148 passed, 0 failed, 3 skipped (a second league not asked; nothing to "Show all"; a prefetch Next had in memory). Import 7.5 s (your browser, 27 reads), League page 5.2 s, search 5.4 s (target 10 s). It switched to "Several prizes" and read "Your odds: 47% playoffs · 19% top 3 · 6.3% title", 15 card odds lines with "Top 3 odds" and the partners' lines, then put the setting back.
- **Sleeper CORS** (live): 5 of 5 endpoints readable from any origin, `winners_bracket` included.

## Questions (numbered, each answerable in one line)
1. Planner: the export file still holds B, P_accept, P_complete and the sent version's estimate, which give the value ratios back to someone who works at it (CLAUDE.md §11). Leave those out too, or accept?
2. Planner: "Helps both" is thin: 5 of about 200 exact trades help both, so Parker sees 2 cards. Add a helps-both lane to the exact shortlist (about 10 ms a trade), or keep it?
3. Planner: 11 of Parker's 12 Overall cards read "Helps them 0". Keep their line on every card, or show it only when Helps them is above 0?
4. Planner: add the third firewall rule (deny cross-site `/api` requests, above the rate limit)? It uses Hobby's last custom rule.
5. Planner: the Helps-both list admits Helps you 2 (Wilson + Nix → Collins). Keep "Helps you above 0", or ask for at least 10 there too?
6. Parker: approve Checkpoint 7c so I tag `checkpoint-7c`? Your stable copy then serves it, and it's what production deploys after your go.

## How Parker can try it
- `npm run dev` (http://127.0.0.1:3001; the stable copy still serves 7b until the tag). Settings → "What does your league reward?" → "Several prizes", then type 2000, 1600 and 900 in the first three boxes. The League page shows "top 3"; the Trade Finder's cards show "Top 3 odds" and the partner's line; the sort menu has "Helps both".
- The checks (PowerShell, one per line):
  ```
  npm run build
  npm run check:browser -- --live --team 3
  npm run prod:deploy -- --ref HEAD
  ```
