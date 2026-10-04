# Status: Offer Sheet (folder: fantasy-trade-finder)

**Current phase:** 4b done. Checkpoint 4b written; waiting for Parker's go-ahead before Phase 5.
**Last updated:** 2026-10-04

| Phase | State |
|---|---|
| 0: Data access gate | ✅ approved. See `reports/checkpoint-0.md` and `reports/planner-reply-0.md`. |
| 1: ESPN and Sleeper import, scoring engine, Import Report | ✅ approved. See `reports/checkpoint-1.md` and `reports/planner-reply-1.md`. |
| 2: Projections, lineup solver, market values, needs, League page | ✅ approved. See `reports/checkpoint-2.md` and `reports/planner-reply-2.md`. |
| 3: Season simulator | ✅ approved. See `reports/checkpoint-3.md`, `reports/planner-reply-3.md` and `reports/planner-reply-3b.md`. |
| 4: Trade search, benefit, acceptance, Trade Finder and Analyzer | ✅ approved as built. See `reports/checkpoint-4.md` and `reports/planner-reply-4.md`. |
| 4b: The planner's reply to Checkpoint 4 | ⚠️ done with issues, awaiting approval. See `reports/checkpoint-4b.md`. |
| 5–7 | ⏸ not started (order after 4b: 5 → 6 → 7) |

## Phase 4b (done)
- [x] Market-blended projections (§6 step 8), built per game with a leave-one-out curve (a planner question)
- [x] Acceptance rebalance: β_need 1.2 in redraft and keeper, the 85% cap, the new anchor tables (15 of 15)
- [x] One free agent, one team, in the league's waiver order (§7)
- [x] The value floor at W on both sides (§9–§10), replacing N10; the before-addendum variant removed
- [x] IR players: their return counted in team strength, tradable, IR-slot legality (ESPN: IR and OUT)
- [x] Cards and pages: injury tags, Plan B, the given-player cap, "Best of their trade chips" and "See trade ideas with Team X →", the version sent in feedback, IR roster moves on cards
- [x] `npm run check:browser` (55 of 55) and the local FantasyCalc archive
- [x] Reviews per track and a final round (engine integration, realism on Parker's league, pages end to end, CLAUDE.md against the code, the report's completeness); findings fixed or listed as planner questions
- [x] Reports from one final dump of Parker's league (2026-10-04 00:51 UTC), with the Checkpoint 3 and 4 models run on the same data from worktrees of their commits
- [x] Gate green (172 files, 2,973 tests, typecheck, lint, next build, leak check), committed, Checkpoint 4b written

## Where things are
- Trade search on Parker's league for Checkpoint 4b (top 10, before/after, blend sensitivity, odds over time, allocation, cards, IR players, consistency, anchors, runtime): `reports/trade-report.md` (`npm run trade:report -- --offline data-local/parker-league-final --team 3 --compare data-local/cp4-compare-final.json --compare3 data-local/cp3-compare-final.json`; live without `--offline`)
- League model and season odds: `reports/league-report.md` (`npm run league:report -- --offline data-local/parker-league-final --team 3`)
- Production browser check: `npm run build`, then `npm run check:browser -- --team 3`
- Import Report: `reports/import-report.md` (`npm run import:report -- --test-leagues`)
- Oracle results: `reports/oracle-results.md` (`npm run oracle:report`)
- Pre-game projection snapshots and daily FantasyCalc lists: `data-local/projection-snapshots/` and `data-local/fantasycalc-snapshots/` (git-ignored; `npm run snapshot:projections`)

## Waiting on Parker
- Approval of Checkpoint 4b and answers to its 9 questions. The blend's basis (1), the ESPN waiver order (2), Plan B's bar (3) and what to do about Wilson-selling (4) matter most for what comes next.
- Importing the league again in the app: the saved import's format changed.
- `SLEEPER_USERNAME` is still blank, so Sleeper runs on the public test league.
- Running `npm run snapshot:projections` on Wednesday nights keeps the pre-game projections Phase 6 needs.
