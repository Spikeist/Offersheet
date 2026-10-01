# Status: Offer Sheet (folder: fantasy-trade-finder)

**Current phase:** 3 done. Checkpoint 3 written; waiting for Parker's go-ahead before Phase 4.
**Last updated:** 2026-09-30

| Phase | State |
|---|---|
| 0: Data access gate | ✅ approved. See `reports/checkpoint-0.md` and `reports/planner-reply-0.md`. |
| 1: ESPN and Sleeper import, scoring engine, Import Report | ✅ approved. See `reports/checkpoint-1.md` and `reports/planner-reply-1.md`. |
| 2: Projections, lineup solver, market values, needs, League page | ✅ approved. See `reports/checkpoint-2.md` and `reports/planner-reply-2.md`. |
| 3: Season simulator | ⚠️ done with issues, awaiting approval. See `reports/checkpoint-3.md`. |
| 4–7 | ⏸ not started |

## Phase 3 (done)
- [x] Checkpoint 2 answers: free-agent-adjusted MV_add, trade chips and partners from them, Sleeper as the tiebreaker for far ESPN return dates (with a note), pre-game projection snapshots and `npm run snapshot:projections`, per-week projection caching and single-flight fetches, te+/te++ and the Phase 7 email
- [x] Final scores, decided flags and multi-week spans from ESPN and Sleeper; the league's own seeding tiebreaker; Import Report rows
- [x] Season simulator (common random numbers, the league's rules, byes and brackets) and the League page's playoff odds and remaining-games risk
- [x] Live run on Parker's league: odds, week-13 risk, runtime at 1,000 and 5,000 seasons, the no-op check, the Trade Score scale check
- [x] Reviews per track and a final adversarial review (9 lenses): 23 findings, 22 confirmed and fixed or documented
- [x] Gate green, committed, Checkpoint 3 written

## Where things are
- League model and season odds for Parker's league: `reports/league-report.md` (`npm run league:report -- --team 3`)
- Import Report for Parker's league and the Sleeper test league: `reports/import-report.md` (`npm run import:report -- --test-leagues`)
- Oracle results per suite and rule type: `reports/oracle-results.md` (`npm run oracle:report`)
- Pre-game projection snapshots: `data-local/projection-snapshots/` (git-ignored; `npm run snapshot:projections`)

## Waiting on Parker
- Approval of Checkpoint 3 and answers to its 7 questions (B_ref, the free-agent baseline and the chip rule matter for Phase 4).
- `SLEEPER_USERNAME` is still blank, so Sleeper runs on the public test league.
- Running `npm run snapshot:projections` on Wednesday nights keeps the pre-game projections Phase 6 needs.
