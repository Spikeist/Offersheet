# Checkpoint 7d — the planner's reply to Checkpoint 7c
Status: ✅ Done. Everything in the reply is built, tested and reviewed, and checked live on your league today (check:browser, 150 passed). The production dry run passes except for the three launch-day items you do yourself (production's secrets and two firewall rules). Production waits for your "go" today, Tuesday, October 13, 2026.

## What changed
- **Answer 5:** "Helps both" needs Helps you of at least 10 too, both scores as the card prints them.
- **Answer 2, the helps-both lane:** up to 40 more exact trades, taken from every screened trade (not just each partner's kept 30) where both lineups gain on the fast method (your ΔROS > 0, their lineup gain > 0), best screening objective first, skipping the shortlist. Then the same exact evaluation, screening simulation and finalist rules as every other trade. ⚠️ Two rules of mine, so the lane never costs the "Helps both" list a trade: each lane trade that helps both on the screening run widens that list's extra final runs by one, and a finalist a lane trade pushes out keeps its final run (ranked on the "Helps both" list only, like the extras).
- **Answer 3:** a Trade Finder card shows "Helps them" and their odds only when it carries the "Helps both" tag. The Analyzer always shows them, "Helps them 0" included. How to read says so on both pages.
- **Answer 1:** the export file (version 3) holds only what you saw and entered (fields below). The records in your browser and the anonymous copies are unchanged.
- **Answer 4:** the third firewall rule is step 2's first rule, and `prod:deploy` checks it (below).
- **The correction:** no note says your league pays a weekly high score; the reports run with `--prizes 2000,1600,900`.
- **DynastyProcess:** the footer's "DynastyProcess" links to https://github.com/dynastyprocess/data, and the terms read "player ID maps from DynastyProcess (shared under the GPL-3.0 license)."
- **Your odds, Oct 4 data → week 5 data (60% → 47% playoffs):** almost all of it is week 4's result, your 94–112 loss to Team 2 as a 59% favorite (−12 points with that week's other games). The rest of the week-5 data nets about 1 point more: updated projections and trade values cost about 3 (and 2 points of title odds, mostly by making Team 4 and Team 6 stronger), the model moving on to week 5 gives about 2 back, and injuries, roster moves and the new waiver order are small either way. The prize setting moved nothing: 60.2% and 47.2% under both settings.
- **Reviews:** one build wave of four tracks, each implemented, reviewed and fixed (14 findings), then a final four-way review (21 findings, all confirmed and fixed).

## Helps both after the lane (your prizes; `reports/trade-report.md` §10 and the week-5 run)
| | Oct 4 data | Week 5 data (Oct 9) |
|---|---|---|
| Exact trades that help both (screening run), without → with the lane | 3 of 201 → 8 of 245 | 13 of 200 → 25 of 241 |
| Screened trades where both lineups gain · already on the shortlist · the lane (+ lean companions) | 161 · 56 · 40 (+4) | 223 · 32 · 40 (+1) |
| Extra final runs for the list (still helping both on the final run) | 0 → 5 (2) | 1 → 9 (8) |
| Finalists the lane pushed out, their final runs kept for the list (helping both on them) | 3 (0) | 10 (0) |
| **The "Helps both" list** | **1 → 3 cards** | **5 → 5 cards, 3 of them from the lane** |
| Overall cards that changed | 1 of 12 | 2 of 12 |

The cards (Helps you / Helps them / chance they accept):
- **Oct 4:** Team 8, Puka Nacua + Bo Nix → Chris Olave + Christian Watson, 46 / 11 / 10% (lane); Team 8, Puka Nacua → Drake London + Christian Watson, 30 / 38 / 25%; Team 6, Rico Dowdle + Bo Nix → Jadarian Price, 11 / 15 / 35% (lane).
- **Week 5:** Team 8, Breece Hall → Christian Watson + Carnell Tate, 39 / 16 / 10% (lane); Team 6, Brock Bowers + Rico Dowdle → Nico Collins + Travis Kelce, 28 / 11 / 25%; Team 8, Brock Bowers → Chris Olave + Juwan Johnson, 28 / 41 / 20% (lane); Team 6, Kyle Monangai + Brock Bowers → Nico Collins + Travis Kelce, 27 / 27 / 45%; Team 8, Puka Nacua + KC Concepcion → Drake London + Christian Watson, 26 / 40 / 35% (lane). The list keeps at most 3 cards a partner, so here the lane's more helpful, less likely Team 8 trades took the places of likelier ones (40–50%).
- **The extra runtime:** about 0.5 s a search, warm, in Node, measured under "Only the champion" (median of 3): +482 ms (+8%) on the Oct 4 data and +495 ms (+8%) on week 5 (its 41–45 exact evaluations about 0.27 s, their screening simulations 0.11 s, the extra final runs and the rest 0.09–0.12 s); under your prizes, one run each, +0.64 s and +0.68 s. In the production browser on today's data a full search took 6.9 s (240 exact trades, 71 final runs), under the 10 s target.

## The export's fields (version 3)
Each record holds:
- `league` (league-1, league-2, …) and `madeOn`, the day of your first press
- `trade`: the other team's id and the players given and received
- `shown`, what the card printed: Helps you, the chance they accept with its label ("about N% it goes through" when a veto vote cut it), Overall, your odds lines and weekly line, and Helps them with their odds when the card showed them
- `outcome` with its day; `version` (which one you sent, its players, its chance as printed); `report` (the reason, your note, its day)

The file's own date is a day too. Never in it: B, B₃, the raw estimates, g, the acceptance features, ΔPO, ΔCH, ΔPPW, the share id, a trade key or a time of day. A record saved before 7d exports its three numbers printed from its own numbers, with no odds lines.

## Launch day: the final steps (`reports/beta-infrastructure.md`, "Launch-day steps")
Before the go (PowerShell, one command per line):
1. Production's secrets:
   ```
   npm run vercel:secret -- --live --env production
   npm run vercel:secret -- --live --name CRON_SECRET
   ```
2. Three firewall rules, in this order (Vercel → offersheet → Firewall → Configure → New Rule; publish; drag them into this order if Vercel lists them otherwise, since a Deny ends the list):
   1. **Deny cross-site API requests:** *Request Path* starts with `/api/` AND *Request Header* `sec-fetch-site` equals `cross-site` → *Deny*. Both conditions in one group.
   2. **API rate limit:** *Request Path* starts with `/api/` → *Rate Limit*, fixed window 10 minutes, 80 requests, by IP, over the limit *Too Many Requests (429)* (never Deny or Challenge).
   3. **Block image optimizer:** *Request Path* starts with `/_next/image` OR starts with `/_vercel/image` → *Deny*.

   If Vercel refuses a third rule, add rule 1's two conditions as a third OR group of "Block image optimizer" and move it above the rate limit. The dry run can't see the order, so check it on the Firewall page.
3. Next: `npm view next@16.3 version` must end at 16.3.8.
4. The dry run, every line ✅:
   ```
   npm run prod:deploy -- --checkpoint checkpoint-7d
   ```
   It asks the cross-site rule three ways: `/api/health` sent cross-site must get the firewall's 403, sent same-origin must not be denied, and the home page opened from a link on another site must not be denied.

**Parker writes "go."**

5. The deploy, then the checks again only with `--verify`, never a second `--live`:
   ```
   npm run prod:deploy -- --live --checkpoint checkpoint-7d
   npm run prod:deploy -- --verify --checkpoint checkpoint-7d
   ```
6. Open https://offersheet.vercel.app on your phone and import your league.
7. After 20:00 UTC the cron's first run shows in `npm run beta:log -- --live --env production` (once the read-only store variables are typed in).

If 7d isn't approved in time, use `checkpoint-7c` in steps 4 and 5. **Rollback:** Vercel → offersheet → Deployments → the landing page's deployment (the dry run names it) → ⋯ → Instant Rollback. It works until the next production deploy.

## The `prod:deploy` dry run on the 7d commit
`npm run prod:deploy -- --ref HEAD` on 1d0d0bd (names only; read-only, nothing uploaded; this report's commit adds only files under reports/, which aren't deployed):
1 ✅ What: a rehearsal on 1d0d0bd (a real deploy needs `--checkpoint checkpoint-7d`) · 2 ✅ Clean copy: 450 files, 9.6 MB, byte for byte the commit · 3 ✅ What the build needs; `vercel.json`: nextjs, iad1, the cron · 4 ✅ the tag's own CSP and its 10 app pages · 5 ✅ Vercel's dry run: exactly the copy's files · 6 ✅ Leak check: 0 hard hits · 7 ✅ Deployment Protection: Standard (`all_except_custom_domains`) · **8 ❌ Production's variables:** KV_REST_API_URL, KV_REST_API_TOKEN set; missing SESSION_SECRET, CRON_SECRET (step 1) · 9 ✅ the production domain answers 200 · **10 ❌ Image optimizer:** `/_next/image` and `/_vercel/image` answer 404 (the landing page), not 403 (step 2, rule 3) · **11 ❌ Cross-site API requests:** `/api/health` sent cross-site answers 404, not the firewall's 403 (step 2, rule 1) · 12 ✅ Rollback target: offersheet-dtgsgk03x-parker-daniels.vercel.app (the landing page) · 13 ✅ Next 16.3.8, the newest 16.3 patch · 14 ✅ `.env.local` unchanged.

## Decisions I made (⚠️ = our reading)
- ⚠️ "Every screened trade" read as every screened trade that meets screening's own rules (legal, the must-include players, the value window, the dominance pruning); "their lineup gain" read as the number the quick acceptance's lineup term uses.
- ⚠️ The lane's trades also compete for the Overall list (the planner's "the same … finalist rules"): on the Oct 4 data 1 of your 12 cards changed under your prizes, and 3 of 14 under "Only the champion", better by Overall at every changed place but one.
- ⚠️ The export keeps days, never times; the printed texts must match the card's own forms, so no raw number can ride in the file.
- ⚠️ On a Trade Finder card, "Their long-term value" (dynasty and keeper leagues) goes with the partner's line.
- ⚠️ The dry run tells the firewall's 403 from the app's own cross-site 403 by the app's answer, and also asks a page as a link from another site: a rule that lost its `/api/` condition would turn away everyone arriving from a search result.
- ⚠️ The DynastyProcess link opens a new tab, like FantasyCalc's, and screen readers hear "(opens in a new tab)".

## Numbers
- **Gate:** 255 test files, 5,202 tests (1 skipped), typecheck, lint, build, leak check 0 hard hits (7c: 253 files, 5,122 tests).
- **check:browser** (live league today, 375 px): 150 passed, 0 failed, 3 skipped (a second league not asked; under "Several prizes" no Finder card showed a partner's line, since only cards that help both show one now; a prefetch Next had in memory). Import 10.5 s (your browser, 27 reads), League page 5.9 s, search 6.9 s (7c's run: 5.4 s on Oct 8's data). "Helps both" shows 5 ideas on today's data; the partner's line shows only with the tag, in every sort; the Analyzer's card reads "Helps them 0" for a trade that costs them; every app page's server HTML credits DynastyProcess with its link.

## Questions (numbered, each answerable in one line)
1. Parker: approve Checkpoint 7d so I tag `checkpoint-7d`? Production then deploys it after your go; otherwise `checkpoint-7c`, as approved.
2. Planner: the odds analysis turned up three model behaviors that move a team's odds a point or two. A questionable tag can raise a player's projection. A tagged player moves others' projections through the market blend. And the ESPN/Sleeper averaging test sits at 10.03% against its 10% bar on the week 5 data, so small data changes flip about 285 base rates. Add them to Phase 6?

## How Parker can try it
- `npm run dev` (http://127.0.0.1:3001): the Trade Finder shows "Helps them" only on cards tagged "Helps both"; the Analyzer always shows it; Settings → "Export feedback" downloads the new file.
- `npm run stable` serves `checkpoint-7c` from its next run, and `checkpoint-7d` once it's tagged.
