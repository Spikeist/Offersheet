# Status: Offer Sheet (folder: fantasy-trade-finder)

**Current phase:** 4c done. Checkpoint 4c written; waiting for Parker's go-ahead before Phase 5.
**Last updated:** 2026-10-04

| Phase | State |
|---|---|
| 0: Data access gate | ✅ approved. See `reports/checkpoint-0.md` and `reports/planner-reply-0.md`. |
| 1: ESPN and Sleeper import, scoring engine, Import Report | ✅ approved. See `reports/checkpoint-1.md` and `reports/planner-reply-1.md`. |
| 2: Projections, lineup solver, market values, needs, League page | ✅ approved. See `reports/checkpoint-2.md` and `reports/planner-reply-2.md`. |
| 3: Season simulator | ✅ approved. See `reports/checkpoint-3.md`, `reports/planner-reply-3.md` and `reports/planner-reply-3b.md`. |
| 4: Trade search, benefit, acceptance, Trade Finder and Analyzer | ✅ approved as built. See `reports/checkpoint-4.md` and `reports/planner-reply-4.md`. |
| 4b: The planner's reply to Checkpoint 4 | ✅ approved. See `reports/checkpoint-4b.md` and `reports/planner-reply-4b.md`. |
| 4c: The planner's reply to Checkpoint 4b | ⚠️ done with issues, awaiting approval. See `reports/checkpoint-4c.md`. |
| 5–7 | ⏸ not started (order: 5 → 6 → 7) |

## Phase 4c (done)
- [x] Exhaustive two-player candidates per partner and 60 finalists; Wilson → Hubbard + Evans found (card #3)
- [x] Neutral throw-ins (the planner's rule plus matched pairs, lean versions evaluated, Plan B bars, folding)
- [x] One value number per card (FantasyCalc's own), the model's figures under the Analyzer's "Details"
- [x] The blend factor clamped to [0.75, 1.35]
- [x] The weekly reset waiver order (ESPN and Sleeper), shown in the Import Report; the import format is now 4
- [x] The pattern note; the sent version's model inputs in feedback
- [x] "What matters most" (Win the title by default)
- [x] Real odds and the weekly line on every card, Plan B box and Analyzer result; one baseline everywhere
- [x] The minimum-chance filter, re-filtering without a new search; "<5%"
- [x] Multiple leagues in IndexedDB: switcher, Add/Remove, Sleeper multi-pick, migration
- [x] FantasyCalc fallbacks (saved list, our own curve, outage back-off); DynastyProcess's GPL-3.0 noted for Phase 7
- [x] Reviews per track, a final round (realism on Parker's cards, pages end to end, CLAUDE.md against the code), a verification of the final fixes, and a fact-check of the checkpoint
- [x] Reports from a fresh dump of Parker's league (2026-10-04 09:24 UTC, before Sunday's games)
- [x] Gate green (187 files, 3,394 tests, typecheck, lint, next build, leak check), `npm run check:browser -- --team 3 --second-league` 80 of 80, committed, Checkpoint 4c written

## Where things are
- Trade search on Parker's league for Checkpoint 4c (top 10, goals, B_ref check, search gap, minimum chance, blend, odds, anything else): `reports/trade-report.md` (`npm run trade:report -- --offline data-local/parker-league-4c --team 3`; live without `--offline`)
- League model and season odds: `reports/league-report.md` (`npm run league:report -- --offline data-local/parker-league-4c --team 3`)
- Production browser check: `npm run build`, then `npm run check:browser -- --team 3` (add `--second-league` to test adding, switching and removing a league)
- Import Report: `reports/import-report.md` (`npm run import:report -- --test-leagues`)
- Oracle results: `reports/oracle-results.md` (`npm run oracle:report`)
- Pre-game projection snapshots and daily FantasyCalc lists: `data-local/projection-snapshots/` and `data-local/fantasycalc-snapshots/` (git-ignored; `npm run snapshot:projections`)

## Waiting on Parker
- Approval of Checkpoint 4c and answers to its 5 questions. B_ref under "Win the title" (1) and the waiver credit W (2) change the numbers on the cards.
- In the app: reload any open Offer Sheet tab, then press "Import again" (the saved import's format changed). Your team pick, settings and feedback move over.
- `SLEEPER_USERNAME` is still blank, so Sleeper runs on the public test league.
- Running `npm run snapshot:projections` on Wednesday nights keeps the pre-game projections Phase 6 needs.
