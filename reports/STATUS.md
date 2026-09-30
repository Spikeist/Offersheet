# Status: Offer Sheet (folder: fantasy-trade-finder)

**Current phase:** 1, ESPN and Sleeper import. In progress.
**Last updated:** 2026-09-29

| Phase | State |
|---|---|
| 0: Data access gate | ✅ approved. See `reports/checkpoint-0.md` and `reports/planner-reply-0.md`. |
| 1: ESPN and Sleeper import, scoring engine, Import Report | 🔄 in progress |
| 2–7 | ⏸ not started |

## Done since Checkpoint 0
- [x] Applied the planner's reply (`reports/planner-reply-0.md`) to CLAUDE.md. The changed sections will be listed in Checkpoint 1.
- [x] Moved strangers' full sanitized fixtures to git-ignored `data-local/fixtures-sanitized/`, and rewrote local history so they appear in no commit.
- [x] Library: fixtures from strangers' leagues are routed to `data-local/` automatically; `--allow-crawl` is required before crawling strangers' leagues; the HTTP client has an `offline` cache mode.

## Phase 1 plan
- [ ] Data model and scoring engine: the general rules, with expected values for projections
- [ ] Player ID crosswalk (DynastyProcess, FantasyCalc, Sleeper players DB)
- [ ] ESPN adapter: Parker's league; private-league error paths tested with mocks
- [ ] Sleeper adapter: public test league (`SLEEPER_*` still blank); guillotine and best-ball handling
- [ ] Oracle tests covering every rule type; minimized stranger fixtures in `fixtures/sanitized/min/`
- [ ] Connect and Import Report pages; ESPN connect flow; session-only credential cookie
- [ ] Probe upkeep: wire the crawl gate into the crawling probes
- [ ] Checkpoint 1

## Waiting on Parker
- Nothing blocking. `SLEEPER_USERNAME` is still blank, so Phase 1 uses the public Sleeper test league (planner answer 1).
