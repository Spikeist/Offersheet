# Status: Offer Sheet (folder: fantasy-trade-finder)

**Current phase:** 7b done (the planner's reply to Checkpoint 7a, and readiness B4). Checkpoint 7b written; waiting for Parker's go-ahead. Production stays off until his "go".
**Last updated:** 2026-10-06

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
| 7b: The planner's reply to Checkpoint 7a, readiness (B4), go/no-go | ⚠️ done with issues, awaiting approval. See `reports/checkpoint-7b.md`. |
| 7: Production | ⏸ only on Parker's "go" |
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

## Where things are
- Stable copy: `npm run stable` (http://127.0.0.1:3000; on `checkpoint-7a`, which still calls FantasyCalc's `/players` and shows values: don't run it until 7b is approved and tagged); development: `npm run dev` (http://127.0.0.1:3001)
- Protected preview: `npm run preview:deploy -- --live` (previews only; refuses production, uncommitted files and leaks)
- The beta's infrastructure, limits and free-tier arithmetic: `reports/beta-infrastructure.md`
- Trade search on Parker's league (top 10, B₃ and ω per goal): `reports/trade-report.md` (`npm run trade:report -- --dump data-local/parker-league-4c --team 3`; `--live` fetches the league instead)
- League model, season odds and the automatic playoff weight: `reports/league-report.md` (`npm run league:report -- --dump data-local/parker-league-4c --team 3`)
- Production browser check: `npm run build`, then `npm run check:browser -- --live --team 3`
- The shared store's readers (the store's REST URL and token typed into .env.local by hand): `npm run beta:log -- --live`, `npm run usage:report -- --live`, `npm run feedback:report -- --live`, `npm run snapshot:pull -- --live`

## Waiting on Parker
- Approval of Checkpoint 7b (tagging it moves the stable copy off FantasyCalc's `/players` and values) and answers to its 7 questions (2 for Parker, 5 for the planner).
- The launch date and the "go". At the go: production SESSION_SECRET and CRON_SECRET (`npm run vercel:secret`), the WAF rule, then the production deploy.
- To read the beta's usage: type `KV_REST_API_URL` and `KV_REST_API_TOKEN` into .env.local (Checkpoint 7b, "How Parker can try it").
- `SLEEPER_USERNAME` is still blank, so Sleeper runs on the public test league.
- Until launch, running `npm run snapshot:projections` on Wednesday nights keeps the pre-game projections Phase 6 needs (the cron takes over in production).
