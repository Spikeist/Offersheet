# Status: Offer Sheet (folder: fantasy-trade-finder)

**Current phase:** Checkpoint 7c approved and tagged `checkpoint-7c` on 2026-10-09 (the launch candidate). Checkpoint 7d (the planner's reply to Checkpoint 7c) approved and tagged `checkpoint-7d` on 2026-10-14. **Offer Sheet is live** at https://offersheet.vercel.app since 2026-10-14: production serves `checkpoint-7d` (offersheet-e50m4rlg3-parker-daniels.vercel.app), deployed after Parker's "go" through `npm run prod:deploy`; `--verify` passes every check. **Checkpoint 7e** (the planner's reply to Checkpoint 7d: launch-week fixes) approved and tagged `checkpoint-7e` (cec277a) on 2026-10-15; no separate 7e deploy (the planner's reply to Checkpoint 7f). **Checkpoint 7f** (the planner's reply to Checkpoint 7e) approved and tagged `checkpoint-7f` (9940b6f) on 2026-10-16, and **deployed to production** the same day after Parker's go (offersheet-5o2i7zpot-parker-daniels.vercel.app, 7e included; `--verify` passes every check). **Checkpoint 7g** (the planner's reply to Checkpoint 7f) approved and tagged `checkpoint-7g` (fd2b4b4) on 2026-10-19; Parker runs its dry run and deploy himself. **Checkpoint 7h** (the planner's reply to Checkpoint 7g) is in progress.
**Last updated:** 2026-10-19

| Phase | State |
|---|---|
| 0: Data access gate | ✅ approved. See `reports/checkpoint-0.md` and `reports/planner-reply-0.md`. |
| 1: ESPN and Sleeper import, scoring engine, Import Report | ✅ approved. See `reports/checkpoint-1.md` and `reports/planner-reply-1.md`. |
| 2: Projections, lineup solver, market values, needs, League page | ✅ approved. See `reports/checkpoint-2.md` and `reports/planner-reply-2.md`. |
| 3: Season simulator | ✅ approved. See `reports/checkpoint-3.md`, `reports/planner-reply-3.md` and `reports/planner-reply-3b.md`. |
| 4: Trade search, benefit, acceptance, Trade Finder and Analyzer | ✅ approved as built. See `reports/checkpoint-4.md` and `reports/planner-reply-4.md`. |
| 4b: The planner's reply to Checkpoint 4 | ✅ approved. See `reports/checkpoint-4b.md` and `reports/planner-reply-4b.md`. |
| 4c: The planner's reply to Checkpoint 4b | ✅ approved. See `reports/checkpoint-4c.md` and `reports/planner-reply-4c.md`. |
| 7a: Part A (small fixes), Part B (the beta: B1–B3) | ✅ approved after the Upstash check (tag `checkpoint-7a`). See `reports/checkpoint-7a.md` and `reports/planner-reply-7a.md`. |
| 7b: The planner's reply to Checkpoint 7a, readiness (B4), go/no-go | ✅ approved (tag `checkpoint-7b`). See `reports/checkpoint-7b.md` and `reports/planner-reply-7b.md`. |
| 7c: The planner's reply to Checkpoint 7b: the launch candidate | ✅ approved 2026-10-09 (tag `checkpoint-7c`). See `reports/checkpoint-7c.md` and `reports/planner-reply-7c.md`. |
| 7d: The planner's reply to Checkpoint 7c | ✅ approved 2026-10-14 (tag `checkpoint-7d`). See `reports/checkpoint-7d.md`. |
| 7e: The planner's reply to Checkpoint 7d: launch-week fixes | ✅ approved 2026-10-15 (tag `checkpoint-7e`; no separate deploy: production gets it with 7f). See `reports/checkpoint-7e.md` and `reports/planner-reply-7e.md`. |
| 7f: The planner's reply to Checkpoint 7e | ✅ approved 2026-10-16 (tag `checkpoint-7f`), live since 2026-10-16 (7e included). See `reports/checkpoint-7f.md` and `reports/planner-reply-7f.md`. |
| 7g: The planner's reply to Checkpoint 7f | ✅ approved 2026-10-19 (tag `checkpoint-7g`; Parker deploys it). See `reports/checkpoint-7g.md` and `reports/planner-reply-7g.md`. |
| 7h: The planner's reply to Checkpoint 7g | 🔨 in progress (aim: Monday, October 26; section 1, the clutter, first). See `reports/planner-reply-7g.md`. |
| 7: Production | ✅ live since 2026-10-14; serves `checkpoint-7f` since 2026-10-16 (offersheet-5o2i7zpot-parker-daniels.vercel.app, deployed by Parker), `npm run prod:deploy -- --verify --checkpoint checkpoint-7f` all ✅; Instant Rollback reaches `checkpoint-7d`'s deployment (offersheet-e50m4rlg3-parker-daniels.vercel.app) |
| 5–6 | ⏸ after the launch (order: 5 → 6) |

## Phase 7h (in progress)
- [ ] The answers: the smaller ask's bar 75%; a version with a higher Overall than its idea promoted (and counted); the preference only within 3 points of the best version's Helps you
- [ ] 1. Less clutter: cards closed by default (the trade, the three numbers, tags, one reason), the rest behind "Details"; "Assumed with or without this trade" once above the list; messages only inside "How to offer it"; a shared Plan B on the highest idea only; the League page's paragraphs cut to one line; before/after screenshots with screen counts (goals: 2+ ideas a screen, the League page about 8 screens)
- [ ] 2. The search against a brute force over whole rosters (both leagues): top 10 and top 25 found, the best trade missed, answer 3's count
- [ ] 3. "Thorough search": a Trade Finder switch, every 1- and 2-player trade over whole rosters plus 3-a-side from bigger pools, 120 finalists, a time estimate, progress and Cancel (aim under 60 s on the 12-team league)
- [ ] 4. "What if" in the Analyzer: take players off, put any on, no partner; Helps you, odds and weekly lines
- [ ] 5. Waivers' "Rest of season" rows show the odds lines from their rating's run
- [ ] 6. The draft assistant: Phase 8's spec in CLAUDE.md and the draft data check (ADP, preseason projections, live draft picks)
- [ ] The gate, the live browser check, the `prod:deploy` dry run, `reports/checkpoint-7h.md`

## Phase 7g (done; approved 2026-10-19)
- [x] 1. The Jacobs fix ("his first full week back", without 1a): Josh Jacobs 41.6 → 82.7 rest-of-season points (Oct 14) and 78.5 (Oct 15); Parker's second league 91.00% / 13.62% → 92.52% / 15.32% (Oct 14); its Waivers season list 21 rows → 2 and 1, none helping; 1 card gives Jacobs away, where 3 did
- [x] 2. Merged cards: (a) a Last offer can ask for fewer of their players (80% of the card's Overall, unrounded; the higher Overall of it and the throw-in), (b) a ladder prefers an idea of its list below it, (c) a version at least as good on both numbers drops the other; Plan B never a smaller ask the Last offer could take; How to read says all three. Parker's six runs at 2 a side: merges 4 → 7, 4 versions dropped, 89 → 85 cards; the planner's (a) example keeps 75.9% (a question)
- [x] 3. The averaging test leaves questionable, doubtful and probable players out: over the bar on 2 of 12 saved readings (Oct 14), so Oct 15 is averaged in both leagues; a gradual version proposed in CLAUDE.md's Phase 6
- [x] 4. Pierce's sentence in the planner's words ("From week 7 on, he and Marvin Harrison Jr. add about the same to your starting lineup, …")
- [x] 5. Four screenshots at 375 px in `reports/checkpoint-7g-screenshots/` (check:browser's clutter shots); what already looks crowded is in the report
- [x] 6. CLAUDE.md Section 20's "Later" list (other fantasy sports, basketball first; a best-value bets project)
- [x] Four build tracks, a review of the first three and its fixes; a final review of the merged build (31 findings) and two fix tracks (engine, words); the log test's clock (it had failed on every tree since 2026-10-18)
- [x] Gate green (298 files, 5,715 tests, typecheck, lint, build, leak check 0 hard hits); `npm run check:browser -- --live --team 3` 174 passed, 0 failed; `npm run prod:deploy -- --ref HEAD` on 8b6557b: all 14 checks ✅ (rollback target: 7f's deployment)
- [x] Parker's approval, then the tag `checkpoint-7g` (fd2b4b4); production after his go (he runs the dry run and the deploy himself); the planner's reply (`reports/planner-reply-7g.md`) is Checkpoint 7h's work

## Phase 7f (done; approved 2026-10-16)
- [x] 1. Speed: each card's shown run continues its ranking run (every number the same, bit for bit): context + search 0.33–0.39 s shorter; the 12-team league's first search about 10.4 → 9.8 s in the browser estimate
- [x] 2. Merged cards: an idea whose offers hold an idea below it on Overall takes it among its offers, and the next idea takes the place; pairs held the other way stay labeled (a planner question)
- [x] 3. Waivers: only the rows that help show (6 of 48 and 1 of 21 on Oct 14), the "No gain" rows behind "N more pickups that don't help you (show)"; moves the user's settings block still show
- [x] 4. Pierce's release line says why (the planner's sentence on the League page's roster card); releases made either way named in the cards' "Assumed with or without this trade" line
- [x] 5. Josh Jacobs's 41.6 points broken down (a hedged week-7 projection read as his rate); the fix ("his first full week back") proposed, not built
- [x] 6. The averaging test leaves kickers and D/STs out (they decide 1 of 12 saved readings; today nothing moves)
- [x] Five build tracks, merged; a six-way review of the merged build (28 findings: 1 high, 3 medium) and three fix tracks; the final timings on a quiet machine
- [x] Gate green (290 files, 5,596 tests, typecheck, lint, build, leak check 0 hard hits); `npm run check:browser -- --live --team 3` 180 passed, 0 failed; `npm run prod:deploy -- --ref HEAD` on f148937: all 14 checks ✅
- [x] Parker's approval, then the tag `checkpoint-7f` (9940b6f); deployed to production on 2026-10-16 after his go (7e included, no separate 7e deploy: `reports/planner-reply-7f.md`); `--verify` all ✅

## Phase 7e (done; approved 2026-10-15)
- [x] 1.1: 20,000 seasons for every number a page prints (the top 5's Helps you spread 1–2 across seeds, 3 at 5,000); the search still ranks on 5,000
- [x] 1.2: K and D/ST without the season-to-date weight (the 49ers/Giants case explained)
- [x] 2.1–2.3: no credit for moves made either way; every roster move on the card; IR-return releases decided from that week on (Parker's week-7 release stays Pierce: a planner question)
- [x] 3.1–3.5: Waiver upgrades as one move a row rated by Helps you, "Drop from the same position", untouchables never dropped (lock icons), "Expected back" with the user's own week
- [x] 4.1–4.2: "How to offer it" as offers in order (built in the worker when opened); "Helps you N now · M if done after this week's games"
- [x] Four build waves (A–D), each reviewed and fixed, and a final five-way review (21 findings: 15 fixed, 1 not a defect, 5 the lead's calls); CLAUDE.md updated (Section 17's Phase 7e entry, Section 19's normal deploy)
- [x] Gate green (283 files, 5,468 tests, typecheck, lint, build, leak check 0 hard hits); `npm run check:browser -- --live --team 3` 162 passed, 0 failed (its card step's Copy lookup fixed for the offers' messages); `npm run prod:deploy -- --ref HEAD` on 38a1c8e: all 14 checks ✅
- [x] Parker's approval, then the tag `checkpoint-7e` (cec277a); production after his go (`reports/beta-infrastructure.md`, "A normal deploy")

## Phase 7d (done; approved 2026-10-14)
- [x] Answer 5: "Helps both" needs Helps you of at least 10 too
- [x] Answer 2: the helps-both lane (up to 40 more exact trades on which both lineups gain), never costing the "Helps both" list a trade (the extras' room widened by one per lane trade; a displaced finalist keeps its final run)
- [x] Answer 3: the partner's line only on Trade Finder cards that help both; the Analyzer always
- [x] Answer 1: the export file holds only what the user saw and entered (version 3; days, no time of day)
- [x] Answer 4: the third firewall rule, first in the list, and `prod:deploy`'s check of it (`reports/beta-infrastructure.md`, "Launch-day steps")
- [x] The correction (no weekly high score in Parker's league), DynastyProcess credited in the footer and the terms, Parker's odds explained (`reports/checkpoint-7d.md`)
- [x] One build wave of four tracks (14 findings) and a final four-way review (21 findings), all fixed; gate green (255 files, 5,202 tests, typecheck, lint, build, leak check); `npm run check:browser -- --live --team 3` 150 passed, 0 failed (today's data: "Helps both" shows 5 ideas, search 6.9 s)
- [x] `npm run prod:deploy -- --ref HEAD` on 1d0d0bd: every check ✅ but production's secrets, the image-optimizer rule and the cross-site rule (launch-day steps 1 and 2)
- [x] Parker's approval, then the tag `checkpoint-7d` (0051436); question 2's three model behaviors added to Phase 6

## Phase 7c (done; approved 2026-10-09)
- [x] §1: Q3 (dynasty and keeper say why "Protect my trade value" isn't there), Q4 (the cron's daily rest-of-season levels), Q5 (the export without the value ratios), Q6 (one unweighted pickup gain), Q7 (nothing to change)
- [x] §2: `npm run prod:deploy` (dry run by default; `--live --checkpoint <tag>` after the go; `--verify`); Next 16.3.8 and source-map-js 1.2.2
- [x] §3: the privacy and terms edits behind switches (all eight on), cap 1,300 words (`reports/privacy-terms-draft.md`)
- [x] §4: accepted decisions recorded; Phase 6 addition; the firewall's 80 confirmed; security finding 15 and an optional third rule (required, and first in the list, since the planner's reply to Checkpoint 7c, answer 4)
- [x] §5: same-position pickups (the optimizer's keep set; the card names each fill)
- [x] §6: "Several prizes": 2nd and 3rd place, weekly high scores and the points leader in the simulator; the 3rd-place game from ESPN and Sleeper; E[S] in B, B₃ and ω; Settings' prizes; "Top 3 odds"; prize shares in feedback; the reports' `--prizes`
- [x] §7: "Helps them" and the "Helps both" sort, tag and partner lines
- [x] Six build waves with a review each (61 findings) and a final five-way review (11 confirmed), all fixed; gate green (253 files, 5,122 tests, typecheck, lint, build, leak check); `npm run check:browser -- --live --team 3` 148 passed, 0 failed; `npm run check:sleeper-cors -- --live` 5 of 5
- [x] `npm run prod:deploy -- --ref HEAD`: every check ✅ but production's secrets and the image-optimizer rule (launch-day steps 1 and 2)
- [x] Approved on 2026-10-09 and tagged `checkpoint-7c` (4d63693); the planner's reply (`reports/planner-reply-7c.md`) is Checkpoint 7d's work

## Phase 7b (done)
- [x] §1 Upstash check: variables on Preview and Production, US East (iad1) with backups off, `/api/health` shows the shared store; tag `checkpoint-7a`
- [x] §2: trade value as a lineup price (κ 1/2/4 pts a week per 100%), B_ref(λ) for dynasty and keeper, the capacity message, `npm run usage:report`, the CDN decision, the WAF confirmed on Hobby
- [x] §3–§4: contact email, no personal name, 12-month feedback retention, the shorter privacy policy and the terms edits (`reports/privacy-terms-draft.md`)
- [x] §5: plain-language notices, "What does your league reward?", the Trade Finder's best-time and freshness lines, FantasyCalc's conditions (`reports/fantasycalc-permission.md`)
- [x] §6: the automatic playoff-week weight, Waiver upgrades, the daily snapshot cron (`npm run snapshot:pull`)
- [x] B4: security review (`reports/security-review.md`), load test (`reports/load-test.md`, `npm run load:test`), base-rate stability (`reports/stability.md`)
- [x] Reviews per track, a final adversarial review and its fixes; CLAUDE.md and `reports/beta-infrastructure.md` updated
- [x] Gate green (244 files, 4,513 tests, typecheck, lint, build, leak check); `npm run check:browser -- --live --team 3` 126 passed, 0 failed
- [x] Protected preview https://offersheet-ptq1waodj-parker-daniels.vercel.app, checked live (health, headers, the FantasyCalc link in every page's server HTML, a small live load test)

## After approval (2026-10-07)
- [x] Tagged `checkpoint-7b` (199844a): `npm run stable` serves it from its next run (which reinstalls and rebuilds), so the stable copy no longer calls FantasyCalc's `/players` or shows values
- [x] "Last updated" is October 13, 2026 on the privacy and terms pages (`reports/privacy-terms-draft.md` regenerated)
- [x] Launch-day steps: a second WAF rule denies `/_next/image` and `/_vercel/image` (both answer on the preview), in the same step as the `/api/*` rate limit (`reports/beta-infrastructure.md`, "Launch-day steps")
- [x] The store-reading scripts read with a read-only token under names the app never reads (`READONLY_STORE_URL`, `READONLY_STORE_TOKEN`; `scripts/lib/storeReader.ts`), and the app's `OFFERSHEET_REDIS` opt-in is gone. Before the first read the token must be refused a write (⚠️ Upstash's wording of that refusal is assumed until the first live run); otherwise the scripts stop and read nothing
- [x] An adversarial review of these follow-ups (8 agents: 28 findings, 21 confirmed) and its fixes: the token check fails closed, the `/api/*` rule answers 429 only (never Deny, which the app shows as "Something went wrong"), one launch-day order (secrets and both rules before the go, the deploy after), the image evidence recorded exactly, and CLAUDE.md no longer says the small live test is still to run. A second round on the fixes (4 agents: 12 findings, 6 confirmed: test gaps and wording) and its fixes
- [x] The planner's answers to Checkpoint 7b's questions 3–7 (`reports/planner-reply-7b.md`), built in Checkpoint 7c

## Where things are
- Stable copy: `npm run stable` (http://127.0.0.1:3000; serves the newest checkpoint tag: `checkpoint-7f` from its first run after the 2026-10-16 tag, which reinstalls and rebuilds); development: `npm run dev` (http://127.0.0.1:3001)
- Protected preview: `npm run preview:deploy -- --live` (previews only; refuses production, uncommitted files and leaks)
- The beta's infrastructure, limits, free-tier arithmetic and the launch-day steps: `reports/beta-infrastructure.md`
- Trade search on Parker's league (top 10, B₃ and ω per goal, his prizes, open roster spots, Helps both): `reports/trade-report.md` (`npm run trade:report -- --dump data-local/parker-league-7f --team 3 --prizes 2000,1600,900`, the Oct 15 week-6 dump; since Checkpoint 7e also offers in order, since 7f the merged cards, since 7g the smaller asks, preferences and dropped versions; `--live` fetches the league instead)
- League model, season odds, the automatic playoff weight and his places under his prizes: `reports/league-report.md` (`npm run league:report -- --dump data-local/parker-league-7f --team 3 --prizes 2000,1600,900`)
- Production deploy (a normal deploy since launch: `reports/beta-infrastructure.md`, "A normal deploy"): the dry run, `npm run prod:deploy -- --checkpoint <the approved tag>` (read-only, before the go), then, only after the go, `npm run prod:deploy -- --live --checkpoint <the approved tag>`, `--verify` to ask its checks again, then the phone check (CLAUDE.md §19)
- Production browser check: `npm run build`, then `npm run check:browser -- --live --team 3`
- The shared store's readers, read-only (`READONLY_STORE_URL` and `READONLY_STORE_TOKEN` typed into .env.local by hand; add `--env production` after launch, except for `snapshot:pull`, which reads production by default): `npm run beta:log -- --live`, `npm run usage:report -- --live`, `npm run feedback:report -- --live`, `npm run snapshot:pull -- --live`

## Waiting on Parker
- Checkpoint 7g is tagged: run the dry run, `npm run prod:deploy -- --checkpoint checkpoint-7g`, then after your go `npm run prod:deploy -- --live --checkpoint checkpoint-7g`.
- Checkpoint 7h: in progress; its report is next (`reports/planner-reply-7g.md` lists what it includes).
- `npm run stable` serves `checkpoint-7f` from its next run. The cron's first production run finished on 2026-10-14 (the planner: DONE, 3.2 s).
- In Settings for your league: "What does your league reward?" → "Several prizes", with 2000, 1600 and 900.
- After launch, to read the beta's usage: type the values of Vercel's `KV_REST_API_URL` and `KV_REST_API_READ_ONLY_TOKEN` into .env.local as `READONLY_STORE_URL` and `READONLY_STORE_TOKEN`.
- `SLEEPER_USERNAME` is still blank, so Sleeper runs on the public test league.
