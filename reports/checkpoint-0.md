# Checkpoint 0: Data access gate
Status: ⚠️ Done with issues. Every platform we can reach gives us what the checklist needs, and no check failed. Several spec assumptions turned out wrong and need decisions (see Questions). Sleeper hasn't been checked on Parker's own league yet.

## What works
- **Scaffold:** Next.js 16.3.7 (App Router), strict TypeScript, Tailwind 4, Vitest 5, zod 4, tsx. Git is local only. `.env.local`, `.cache/`, `fixtures/raw/` and `data-local/` have been git-ignored since the first commit.
- **ESPN, Parker's league:**
  - Every checklist item A–M was found.
  - Points recomputed from raw stats match ESPN exactly: weeks 2–3, 165/165 and 166/166 players within 0.05. Starters sum to the matchup score for 10/10 teams.
  - Parker's team is found through his SWID.
  - FantasyCalc covers 99.3% of rostered players.
- **ESPN, the public test league** (a second scoring check): 901/901.
- **Sleeper,** tested on a public test league because the `SLEEPER_*` variables are blank:
  - Scoring matches 571/571.
  - Scoring also matches 2807/2807 across 4 other leagues, covering TE premium, IDP, yardage bonuses and PPR.
  - The `/stats` endpoint works; the spec listed it as unverified.
  - Every numeric settings code was checked against 250 real public leagues.
- **Shared sources:**
  - FantasyCalc: format parameters and TE premium verified; terms quoted verbatim.
  - The DynastyProcess ID map.
  - NFL schedule: 272 games. ESPN and nflverse bye weeks agree for 32/32 teams.
  - Sleeper projections for every week, and ESPN projections.
- **Fleaflicker and MFL:** the full checklist on public leagues.
  - MFL scoring matches 604/604.
  - Fleaflicker matches 99.4% in a conventional league and 87% in an exotic one.
- **Yahoo:** waiting on approval. Unauthenticated calls return 401 as expected, and the OAuth probe is ready.
- **Fantrax:** the public endpoints work, and player IDs crosswalk 435/435.
- **Privacy:**
  - Secrets, leaguemates' names, IDs and SWIDs are scrubbed from all output.
  - Committed fixtures use placeholders ("Team 3").
  - An independent audit found 0 leaks.
  - A git pre-commit hook runs `check:leaks`.
- **Verification:** an adversarial reviewer re-checked every probe. About 130 findings were fixed, including 11 high-severity overstated or wrong claims. Every number here comes from the final, re-run outputs.

## What doesn't / open issues
- **Sleeper not tested on Parker's league.** `SLEEPER_USERNAME` and `SLEEPER_LEAGUE_ID` are blank, so a stranger's public league stood in.
  - Fix: fill either one and run `npm run probe:sleeper`. The probe switches leagues automatically and deletes the stranger's fixtures.
- **ESPN private-league path untested.** Parker's league is public (`settings.isPublic = true`), so the 401, 403 and HTML-login responses never occurred. The cookies do work.
  - A wrong season returns HTTP 404 JSON (`GENERAL_NOT_FOUND`), not the HTML/401/403 that §2.2 describes.
- **ESPN `pointsOverrides` are keyed by position, not lineup slot** (§2.2 is wrong), and they replace the base points.
  - Evidence: on TE player-weeks the position reading matches 5/5 and the slot reading 0/5. Replace matches 72/72, add 0/72. ESPN's own `statIdToOverridePosition` agrees.
  - Parker's league only overrides D/ST, where both readings give the same result.
- **The §4/§5 scoring model can't express everything seen.**
  - ESPN D/ST points-allowed buckets (14–17, 22–27, 35–45, 46+) don't match Sleeper's keys. This affects 14 of 24 D/ST lines in weeks 2–3.
  - Fleaflicker and MFL use bounded or stepped tiers, composite-stat bonuses and per-game constants.
  - MFL lineups are per-position min–max ranges.
  - Roster minimums exist.
  - `Pos` has no P, TQB or HC.
- **Projection facts that change §6:**
  - Sleeper already zeroes out IR/PUP players and about half of Out players, so §6's injury table would count those absences twice.
  - Sleeper's far-future weeks are updated in season and vary by opponent, not "preseason" as the spec says. That's good for week shape.
  - An empty ESPN entry means "not projected", not "bye". Byes must come from the NFL schedule.
  - MFL projections run about 19% below Sleeper × league rules.
- **FantasyCalc:**
  - The redraft list holds only about 198 players, so the 98% value target fails in deep leagues. Every miss was an unvalued player, not an ID gap.
  - `valueFloor` (106) is higher than 30 real values.
  - The terms want attribution next to the values and an email before any public launch.
- **Sleeper codes the spec didn't expect:**
  - `type` 3 = guillotine, in 11% of sampled leagues.
  - Re-seeded playoffs and best-ball leagues.
  - `trade_review_days` only matters when `veto_auto_poll = 1`.
  - Position limits cap the active roster, with IR exempt.
  - `previous_league_id` can be `"0"`.
  - The players DB is 14.7 MB, not 5 MB.
- **Fleaflicker and MFL:**
  - Fleaflicker's playoff, deadline, review and tiebreaker settings are only on its public HTML rules page.
  - MFL's deadline and review settings are only visible to league owners.
  - Fleaflicker's exotic league matches 87%: 25 of its rules have no Sleeper key.
- **Strangers' test leagues are committed as sanitized fixtures.** They were picked by a salted, non-reproducible walk and are described only generically. Even so, full rosters plus timestamps could let a determined crawler re-identify them.
- **Privacy incidents (nothing committed):**
  - A scratch script's `> NUL` created a file holding public MFL search results. It was deleted and never tracked, and it's now blocked by `.gitignore` and `check:leaks`.
  - Two agent consoles briefly printed a stranger's public league data. It was not saved.

All ~33 deviations, with evidence and options, are in `reports/data-access.md`.

## Decisions I made
- Kept `AGENTS.md` from create-next-app. `next dev` writes its rules there; without it, it would edit CLAUDE.md.
- Committed Parker's CLAUDE.md edit (Offer Sheet, public launch) on its own. It changes nothing in Phase 0. The Sleeper CORS check is scheduled for Phase 1.
- ESPN ID tables and X-Fantasy-Filter payloads come from cwendt94/espn-api@663d726 (MIT). They're parsed at run time, never hand-typed, with a drift check.
- Where Parker had no league, the probes use strangers' public leagues chosen by a salted random walk; the salt is git-ignored. Crawled data stays git-ignored, and reports show aggregates only.
- A check gets ✅ only when data verifies it. Inferred meanings, small samples (fewer than 3 independent leagues) and derived values get ⚠️. A gap with a working workaround is ⚠️, not ❌.
- MFL: followed MFL's "don't retry; wait 1 s" rule instead of §0.9's backoff, with one pacing bucket for all MFL hosts.
- FantasyCalc: 11 formats, each fetched at most once a day. numTeams=16 was dropped after proving it silently returns the 12-team values.
- Added `YAHOO_AUTH_CODE` and `YAHOO_REFRESH_TOKEN` to `.env.example` for the OAuth probe. They're not in §0.5's list.
- Generated `SESSION_SECRET` straight into `.env.local` without printing it.
- Fixture filenames are the sha256 of a placeholder label. A hash of a real league ID could be brute-forced.
- `noUncheckedIndexedAccess` is on. `npm run typecheck` runs `next typegen` first, because Next 16 generates global types.

## Numbers
- **Tests and checks:** 373 tests passing in 40 files. Typecheck and lint are clean. `check:leaks`: 0 hard hits across 428 files, checked against 8,191 identity values.
- **Sub-checks in the final run:**

  | Probe | ✅ | ⚠️ | ❌ | ➖/⏸ | Runtime |
  |---|---|---|---|---|---|
  | ESPN | 125 | 20 | 0 | 3 | 36 s |
  | Sleeper | 65 | 16 | 0 | 2 | 17 s |
  | Sleeper codes | 24 | 9 | 0 | 0 | 11 s cached (first live crawl: 344 s) |
  | Shared | 53 | 8 | 0 | 0 | 3 s |
  | Fleaflicker | 47 | 39 | 0 | 0 | 89 s |
  | MFL | 66 | 17 | 0 | 2 | 30 s |
  | Yahoo | 2 | 0 | 0 | 14 ⏸ | 1 s |
  | Fantrax | 15 | 4 | 0 | 9 ⏸ | 2 s |

- **Full run:** `probe:all` took 188 s in total, sequential and polite, with league data fetched live.
- **Scoring oracle (target ≥ 99%):** ESPN 100% (331, plus 901 in the public league). Sleeper 100% (571, plus 2807 across 4 leagues). MFL 100% (604). Fleaflicker 99.4% (conventional) and 87.0% (exotic).
- **FantasyCalc match (target ≥ 98%):** ESPN 99.3%, Sleeper 100%, Fleaflicker 98.5%. MFL: 96.3% have a value, 100% match by ID.

## Questions (numbered, each answerable in one line)
1. Will you fill in `SLEEPER_USERNAME` (or `SLEEPER_LEAGUE_ID`) so Phase 1 builds against your own Sleeper league?
2. Should strangers' sanitized test-league fixtures stay committed, or move out of git with only minimized ones committed?
3. Should the Phase 1 adapter read ESPN `pointsOverrides` as defaultPositionId → replacement points?
4. Should §4 `Scoring` gain range/tier rules (min–max, stepped, composite stats, per-game constants), and `LeagueSettings` gain starter caps and roster minimums?
5. Should we add P to `Pos`, map ESPN TQB → QB, and treat HC as unmapped?
6. §6: should the injury table apply only in weeks where the projection source still projects the player?
7. §9: should unvalued players get `min(valueFloor, lowest real value)`? And should item M count any ID match, not only "has a value"?
8. May we show a small "Values: FantasyCalc" link on trade cards and the League table, and add "email FantasyCalc" to the Phase 7 checklist?
9. Should we reject Sleeper guillotine leagues (`type` 3) at import for the MVP?
10. Sleeper: should trade review map to `veto_auto_poll` 1 → league_vote, else none? And should position limits apply to the active roster only?
11. Should the §8 simulator model playoff re-seeding (Sleeper `playoff_seed_type` 1) and division-winners-first seeding?
12. Does your ESPN settings page show a 24-hour trade review with 4 veto votes? And should `DAY_TO_DAY` map to QUESTIONABLE?
13. May the Fleaflicker adapter read the public HTML rules page, or should the Import Report ask the user instead?
14. For MFL leagues, should §6 still average MFL's projections with Sleeper × rules, given MFL runs about 19% lower?

## How Parker can try it
```powershell
Set-Location "D:\Source Code\VS Code\fantasy-trade-finder"
npm install
npm run check-env
npm test
npm run probe:espn
npm run probe:all
npm run check:leaks
```
Then open `reports/data-access.md` for the matrix and deviations, and `reports/probe-output/espn.md` for the evidence on your league.
