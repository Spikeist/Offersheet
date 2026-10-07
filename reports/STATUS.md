# Status: Offer Sheet (folder: fantasy-trade-finder)

**Current phase:** 7b approved and tagged (`checkpoint-7b`, 2026-10-07). Waiting for the planner's answers to Checkpoint 7b's questions 3–7, then the launch on Tuesday, October 13, 2026. Production only on Parker's "go" that day.
**Last updated:** 2026-10-07

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
| 7b: The planner's reply to Checkpoint 7a, readiness (B4), go/no-go | ✅ build approved 2026-10-07 (tag `checkpoint-7b`). See `reports/checkpoint-7b.md`. The planner's answers to questions 3–7 are pending. |
| 7: Production | ⏸ launch on Tuesday, October 13, 2026, only on Parker's "go" |
| 5–6 | ⏸ after the launch (order: 5 → 6) |

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
- [ ] The planner's answers to Checkpoint 7b's questions 3–7

## Where things are
- Stable copy: `npm run stable` (http://127.0.0.1:3000; serves `checkpoint-7b` since 2026-10-07, its first run reinstalling and rebuilding); development: `npm run dev` (http://127.0.0.1:3001)
- Protected preview: `npm run preview:deploy -- --live` (previews only; refuses production, uncommitted files and leaks)
- The beta's infrastructure, limits, free-tier arithmetic and the launch-day steps: `reports/beta-infrastructure.md`
- Trade search on Parker's league (top 10, B₃ and ω per goal): `reports/trade-report.md` (`npm run trade:report -- --dump data-local/parker-league-4c --team 3`; `--live` fetches the league instead)
- League model, season odds and the automatic playoff weight: `reports/league-report.md` (`npm run league:report -- --dump data-local/parker-league-4c --team 3`)
- Production browser check: `npm run build`, then `npm run check:browser -- --live --team 3`
- The shared store's readers, read-only (`READONLY_STORE_URL` and `READONLY_STORE_TOKEN` typed into .env.local by hand; add `--env production` after launch, except for `snapshot:pull`, which reads production by default): `npm run beta:log -- --live`, `npm run usage:report -- --live`, `npm run feedback:report -- --live`, `npm run snapshot:pull -- --live`

## Waiting on Parker
- The planner's answers to Checkpoint 7b's questions 3–7.
- Launch day, Tuesday, October 13, 2026: production's SESSION_SECRET and CRON_SECRET (`npm run vercel:secret`), both WAF rules in one sitting (the `/api/*` rate limit answering 429, and the image-optimizer deny), Next on the latest 16.3.x, then the "go" and the production deploy (`reports/beta-infrastructure.md`, "Launch-day steps").
- How to deploy production on launch day: `npm run preview:deploy` refuses production, and CLAUDE.md §19 rules out `vercel --prod`. Proposal: a `npm run prod:deploy -- --live` with preview:deploy's checks (committed files only, the allowlist, the leak scan, production's secrets by name), usable only after the go, built and tested before launch day; it needs §19 to allow that one script. It deploys the newest approved commit (the `checkpoint-7b` tag's pages still say "Last updated October 5").
- After launch, to read the beta's usage: type the values of Vercel's `KV_REST_API_URL` and `KV_REST_API_READ_ONLY_TOKEN` into .env.local as `READONLY_STORE_URL` and `READONLY_STORE_TOKEN`.
- `SLEEPER_USERNAME` is still blank, so Sleeper runs on the public test league.
- Until launch, running `npm run snapshot:projections` on Wednesday nights keeps the pre-game projections Phase 6 needs (the cron takes over in production).
