# Status: Offer Sheet (folder: fantasy-trade-finder)

**Current phase:** 7a (planner reply to Checkpoint 4c). Part A is done, committed and tagged `checkpoint-7a-part-a`, so the stable copy serves it. Part B (the public beta's infrastructure, B1–B3) is in progress. Checkpoint 7a comes after Part B.
**Last updated:** 2026-10-04

| Phase | State |
|---|---|
| 0: Data access gate | ✅ approved. See `reports/checkpoint-0.md` and `reports/planner-reply-0.md`. |
| 1: ESPN and Sleeper import, scoring engine, Import Report | ✅ approved. See `reports/checkpoint-1.md` and `reports/planner-reply-1.md`. |
| 2: Projections, lineup solver, market values, needs, League page | ✅ approved. See `reports/checkpoint-2.md` and `reports/planner-reply-2.md`. |
| 3: Season simulator | ✅ approved. See `reports/checkpoint-3.md`, `reports/planner-reply-3.md` and `reports/planner-reply-3b.md`. |
| 4: Trade search, benefit, acceptance, Trade Finder and Analyzer | ✅ approved as built. See `reports/checkpoint-4.md` and `reports/planner-reply-4.md`. |
| 4b: The planner's reply to Checkpoint 4 | ✅ approved. See `reports/checkpoint-4b.md` and `reports/planner-reply-4b.md`. |
| 4c: The planner's reply to Checkpoint 4b | ✅ approved. See `reports/checkpoint-4c.md` and `reports/planner-reply-4c.md`. |
| 7a: Part A (small fixes), then Part B (the beta: B1–B3) | 🔄 Part A done; Part B in progress. Plan: `reports/planner-reply-4c.md`. |
| 7b: Readiness (B4), go/no-go | ⏸ after Checkpoint 7a. Production only on Parker's "go". |
| 5–6 | ⏸ after the launch (order: 5 → 6) |

## Phase 7a, Part A (done)
- [x] A1: `npm run stable` serves the newest `checkpoint-*` tag at http://127.0.0.1:3000 from `..\fantasy-trade-finder-stable`; development moved to port 3001
- [x] A2: "Helps you" and Overall on B₃, the B of +3 points a week (Parker: 4.96 under "Win the title", 5.93 Balanced, 7.63 "Make the playoffs"; none floored)
- [x] A3: W = the best free agent no team is predicted to claim (Parker's league: [value] → [value])
- [x] A4: teams with no transaction in 5 weeks make no baseline pickups (none in Parker's league today)
- [x] A5: scripts offline by default; `--live` for the network
- [x] Reviews per track, fixes, reports regenerated from the dump, CLAUDE.md updated
- [x] Gate green (194 files, 3,510 tests, typecheck, lint, next build, leak check), `npm run check:browser -- --live --team 3` 56 passed

## Phase 7a, Part B (in progress)
- [ ] B1: shared cache (Upstash Redis), per-IP rate limits, outbound budgets, browser fetching, friendly errors, safe error log
- [ ] B2: anonymized server-side feedback with an opt-out
- [ ] B3: home page with "Beta", /privacy, /terms, footer, PWA, SEO, Open Graph image
- [ ] A protected preview deployment Parker can open on his phone
- [ ] Checkpoint 7a

## Where things are
- Stable copy: `npm run stable` (http://127.0.0.1:3000); development: `npm run dev` (http://127.0.0.1:3001)
- Trade search on Parker's league (top 10 on the B₃ scale, goals, B₃ per goal, search gap, minimum chance, blend, odds): `reports/trade-report.md` (`npm run trade:report -- --dump data-local/parker-league-4c --team 3`; `--live` fetches the league instead)
- League model and season odds: `reports/league-report.md` (`npm run league:report -- --dump data-local/parker-league-4c --team 3`)
- Production browser check: `npm run build`, then `npm run check:browser -- --live --team 3` (add `--second-league` to test adding, switching and removing a league)
- Import Report: `reports/import-report.md` (`npm run import:report -- --live --test-leagues`)
- Oracle results: `reports/oracle-results.md` (`npm run oracle:report`)
- Pre-game projection snapshots and daily FantasyCalc lists: `data-local/projection-snapshots/` and `data-local/fantasycalc-snapshots/` (git-ignored; `npm run snapshot:projections`; the stable copy writes there too)

## Waiting on Parker
- Nothing for Part A. Part B's dashboard steps (Upstash, preview protection) come with Checkpoint 7a.
- `SLEEPER_USERNAME` is still blank, so Sleeper runs on the public test league.
- Running `npm run snapshot:projections` on Wednesday nights keeps the pre-game projections Phase 6 needs.
