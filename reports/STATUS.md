# Status: Offer Sheet (folder: fantasy-trade-finder)

**Current phase:** Checkpoint 7c approved and tagged `checkpoint-7c` on 2026-10-09 (the launch candidate). Checkpoint 7d (the planner's reply to Checkpoint 7c) approved and tagged `checkpoint-7d` on 2026-10-14: the launch tag. Parker is doing the launch-day steps (2026-10-14); production deploys `checkpoint-7d` only after his "go", through `npm run prod:deploy`.
**Last updated:** 2026-10-14

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
| 7: Production | ⏳ launch-day steps done (2026-10-14: production's secrets, the three firewall rules published, the dry run on `checkpoint-7d` all ✅); `checkpoint-7d` deploys only on Parker's "go", through `npm run prod:deploy` |
| 5–6 | ⏸ after the launch (order: 5 → 6) |

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
- Stable copy: `npm run stable` (http://127.0.0.1:3000; serves the newest checkpoint tag: `checkpoint-7d` from its first run after the 2026-10-14 tag, which reinstalls and rebuilds); development: `npm run dev` (http://127.0.0.1:3001)
- Protected preview: `npm run preview:deploy -- --live` (previews only; refuses production, uncommitted files and leaks)
- The beta's infrastructure, limits, free-tier arithmetic and the launch-day steps: `reports/beta-infrastructure.md`
- Trade search on Parker's league (top 10, B₃ and ω per goal, his prizes, open roster spots, Helps both): `reports/trade-report.md` (`npm run trade:report -- --dump data-local/parker-league-4c --team 3 --prizes 2000,1600,900`; `--live` fetches the league instead)
- League model, season odds, the automatic playoff weight and his places under his prizes: `reports/league-report.md` (`npm run league:report -- --dump data-local/parker-league-4c --team 3 --prizes 2000,1600,900`)
- Production deploy: the dry run, `npm run prod:deploy -- --checkpoint <the launch tag>` (read-only, before the go), then, only after the go, `npm run prod:deploy -- --live --checkpoint <the launch tag>`; the launch tag is `checkpoint-7d` if Parker approves Checkpoint 7d in time, else `checkpoint-7c` (CLAUDE.md §19)
- Production browser check: `npm run build`, then `npm run check:browser -- --live --team 3`
- The shared store's readers, read-only (`READONLY_STORE_URL` and `READONLY_STORE_TOKEN` typed into .env.local by hand; add `--env production` after launch, except for `snapshot:pull`, which reads production by default): `npm run beta:log -- --live`, `npm run usage:report -- --live`, `npm run feedback:report -- --live`, `npm run snapshot:pull -- --live`

## Waiting on Parker
- The launch: the launch-day steps below, then the "go". `npm run stable` serves `checkpoint-7d` from its next run.
- Launch day, Tuesday, October 13, 2026, before the go (`reports/beta-infrastructure.md`, "Launch-day steps"): production's SESSION_SECRET and CRON_SECRET (`npm run vercel:secret`); the three firewall rules published, in this order: "Deny cross-site API requests" first (`/api/` with the header `sec-fetch-site` equal to `cross-site` → Deny; required since the planner's reply to Checkpoint 7c, answer 4), then the `/api/*` rate limit answering 429, then the image-optimizer deny (⚠️ the dry run asks what each rule answers, not their order: check the order on Vercel's Firewall page before publishing); Next's check; then the dry run, `npm run prod:deploy -- --checkpoint <the launch tag>`. After the go: `npm run prod:deploy -- --live --checkpoint <the launch tag>` (`checkpoint-7d` if approved in time, else `checkpoint-7c`).
- In Settings for your league: "What does your league reward?" → "Several prizes", with 2000, 1600 and 900.
- After launch, to read the beta's usage: type the values of Vercel's `KV_REST_API_URL` and `KV_REST_API_READ_ONLY_TOKEN` into .env.local as `READONLY_STORE_URL` and `READONLY_STORE_TOKEN`.
- `SLEEPER_USERNAME` is still blank, so Sleeper runs on the public test league.
- Until launch, running `npm run snapshot:projections` on Wednesday nights keeps the pre-game projections Phase 6 needs (the cron takes over in production).
