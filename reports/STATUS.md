# Status: Offer Sheet (folder: fantasy-trade-finder)

**Current phase:** 7a done (Part A and Part B: B1–B3). Checkpoint 7a written; waiting for Parker's go-ahead. Production stays off until his "go" at Checkpoint 7b.
**Last updated:** 2026-10-05

| Phase | State |
|---|---|
| 0: Data access gate | ✅ approved. See `reports/checkpoint-0.md` and `reports/planner-reply-0.md`. |
| 1: ESPN and Sleeper import, scoring engine, Import Report | ✅ approved. See `reports/checkpoint-1.md` and `reports/planner-reply-1.md`. |
| 2: Projections, lineup solver, market values, needs, League page | ✅ approved. See `reports/checkpoint-2.md` and `reports/planner-reply-2.md`. |
| 3: Season simulator | ✅ approved. See `reports/checkpoint-3.md`, `reports/planner-reply-3.md` and `reports/planner-reply-3b.md`. |
| 4: Trade search, benefit, acceptance, Trade Finder and Analyzer | ✅ approved as built. See `reports/checkpoint-4.md` and `reports/planner-reply-4.md`. |
| 4b: The planner's reply to Checkpoint 4 | ✅ approved. See `reports/checkpoint-4b.md` and `reports/planner-reply-4b.md`. |
| 4c: The planner's reply to Checkpoint 4b | ✅ approved. See `reports/checkpoint-4c.md` and `reports/planner-reply-4c.md`. |
| 7a: Part A (small fixes), Part B (the beta: B1–B3) | ⚠️ done with issues, awaiting approval. See `reports/checkpoint-7a.md`. |
| 7b: Readiness (B4), go/no-go | ⏸ next. Production only on Parker's "go". |
| 5–6 | ⏸ after the launch (order: 5 → 6) |

## Phase 7a (done)
- [x] Part A (commit 713d966, tag `checkpoint-7a-part-a`): the stable copy, "Helps you" on B₃, W unclaimed, inactive teams, offline scripts
- [x] B1: shared cache (Upstash on Vercel only; HMAC keys, encrypted values), per-IP limits, outbound and work budgets, deadlines, error log, browser reads with signed imports
- [x] B2: anonymous feedback store with an opt-out
- [x] B3: home with "Beta", /privacy, /terms, /feedback, footer, PWA, SEO, Open Graph image, CSP and headers
- [x] Reviews per track, a final review (security, policy text against the code, end-to-end flows, free-tier accounting) and its fixes
- [x] Gate green (223 files, 4,068 tests, typecheck, lint, next build, leak check); `npm run check:browser -- --live --team 3` 84 passed
- [x] A protected preview (https://offersheet-h2pdzi7jm-parker-daniels.vercel.app), checked through Vercel's owner bypass
- [x] Checkpoint 7a, `reports/beta-infrastructure.md`, `reports/privacy-terms-draft.md`, CLAUDE.md

## Where things are
- Stable copy: `npm run stable` (http://127.0.0.1:3000; on `checkpoint-7a-part-a` until Checkpoint 7a is approved and tagged); development: `npm run dev` (http://127.0.0.1:3001)
- Protected preview: `npm run preview:deploy -- --live` (previews only; refuses production, uncommitted files and leaks)
- The beta's infrastructure and free-tier arithmetic: `reports/beta-infrastructure.md` (`npm run measure:cache`, `npm run measure:upload`)
- The policy pages' full text: `reports/privacy-terms-draft.md`
- Trade search on Parker's league (top 10 on B₃, B₃ per goal): `reports/trade-report.md` (`npm run trade:report -- --dump data-local/parker-league-4c --team 3`; `--live` fetches the league instead)
- League model and season odds: `reports/league-report.md` (`npm run league:report -- --dump data-local/parker-league-4c --team 3`)
- Production browser check: `npm run build`, then `npm run check:browser -- --live --team 3`
- The beta's error log and feedback (once Upstash is connected): `npm run beta:log -- --live`, `npm run feedback:pull -- --live` (the store's REST URL and token typed into .env.local by hand)

## Waiting on Parker
- Approval of Checkpoint 7a and answers to its 7 questions (4 for Parker, 2 for the planner, 1 for both).
- Connect Upstash (Checkpoint 7a's click-by-click steps), then say "Redis connected" so the preview is redeployed.
- Open the preview on your phone and import your league.
- `SLEEPER_USERNAME` is still blank, so Sleeper runs on the public test league.
- Running `npm run snapshot:projections` on Wednesday nights keeps the pre-game projections Phase 6 needs.
