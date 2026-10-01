# Checkpoint 3: Season simulator
Status: ⚠️ Done with issues. Every Phase 3 build item and every Checkpoint 2 answer is in, tested and running live on your league. The ⚠️ items are a few unverified rule readings, the Trade Score scale (Question 1) and four design questions for the planner.

## What works
- **Season simulator:** 5,000 simulated seasons on one common-random-numbers matrix (the first 1,000 are the screening run). Each team's weekly score is drawn around its projected lineup, with an SD that adds the spread across availability scenarios (law of total variance; about 21–27 points a week for you).
  - **League rules:** the real remaining schedule, today's records, median games, points-only leagues, the league's own standings tiebreaker (ESPN's setting; Sleeper's documented points for) and division winners first. Also byes, a fixed bracket or re-seeding, multi-week rounds, and finished playoff games replayed from their results.
  - **Outputs per team:** playoff, bye and title odds, the expected final record, the final-seed spread, today's rank, and each remaining week's chance to win.
- **League page:**
  - a **Playoff odds** table in today's standings order;
  - **Your remaining games**, with each week's win chance and your likely starters on bye; risky weeks are flagged in words;
  - notes on the rules simulated, and a "Playoff odds" paragraph in the explainer.
  - **Phone check** (headless Edge at 375 px, production build, your league through the public-link flow):
    - ready in 1.5 s, no sideways overflow, 20 tables all captioned, 0 console errors;
    - the printed odds add up: playoffs 602%, byes 201%, titles 99% (whole-percent rounding).
- **Checkpoint 2 answers:**
  1. Free-agent-adjusted baselines for MV_add as well as MV_lose.
  2. Trade chips (gap ≥ 10 lineup pts) in place of surplus, with partners built from them, mutual ones first. The League page's chips read "R. Dowdle: worth +19 to Team 2".
  3. The negative binomial is scheduled in Phase 6 (spec only).
  4. Pre-game projections are archived in `data-local/projection-snapshots/`, and `npm run snapshot:projections` runs it by hand. Weeks 4 and 5 were taken tonight before Thursday's kickoff, all 9 positions, 38 KB and 35 KB.
  5. te+/te++ is kept, and the Phase 7 FantasyCalc email will ask them to confirm it.
  6. Sleeper breaks the tie when a Q/D/P player's ESPN return date is far away, and the player's row shows the note.
- **Other notes:**
  - each NFL week's projections are cached separately (6 h for near weeks, 24 h for later ones), and overlapping requests share one download;
  - keeper leagues without dynasty values: ΔDyn will say so (Phase 4, spec only).
- **Adapters:**
  - ESPN final scores and decided flags; weeks 1–3 rebuild ESPN's own W-L-T, PF and PA exactly.
  - ESPN's seeding tiebreaker comes from settings.
  - Sleeper's scores run through `last_scored_leg`.
  - The Import Report has new "Ties in the standings" and "Final scores" rows.

## Your league (team names are placeholders; full tables: `reports/league-report.md`)
| # | Team | Record | Playoffs | Bye | Title | Proj. final |
|---|---|---|---|---|---|---|
| 1 | Team 6 | 3–0 | 86.0% | 39.3% | 11.3% | 8.4–5.6 |
| 2 | Team 7 | 3–0 | 82.2% | 34.7% | 16.4% | 8.3–5.7 |
| 3 | Team 1 | 2–1 | 57.5% | 12.6% | 7.0% | 6.7–7.3 |
| 4 | Team 8 | 2–1 | 83.7% | 38.1% | 17.4% | 8.0–6.0 |
| 5 | Team 9 | 2–1 | 74.9% | 23.1% | 11.3% | 7.8–6.2 |
| 6 | Team 5 | 1–2 | 43.6% | 6.7% | 4.8% | 6.2–7.8 |
| 7 | **Team 3 (you)** | 1–2 | **78.6%** | 27.3% | **19.7%** | 7.7–6.3 |
| 8 | Team 10 | 1–2 | 17.7% | 1.6% | 0.9% | 5.3–8.7 |
| 9 | Team 4 | 0–3 | 63.6% | 15.7% | 10.3% | 6.9–7.1 |
| 10 | Team 2 | 0–3 | 12.1% | 0.9% | 0.9% | 4.7–9.3 |

- **Your standing:** you're 7th today but have the league's best title odds, because you project as its strongest team (111.0 pts/wk). Odds sum to 6.000 playoff spots, 2.000 byes and 1.000 titles.
- **Week risk:**
  - Week 13 is the only flagged week: 35% against Team 2, with Hall, Wilson, Bowers and Loop on bye.
  - Week 7 (Allen and Bills D/ST on bye) is 44%.
- **Runtime** (Node, median of 5):
  - 1,000 seasons in 5.6 ms; 5,000 in 27 ms (16 ms of it drawing the matrix).
  - The whole League model with 32 scenarios takes 120 ms, or 150 ms with the simulation.
- **No-op check:**
  - the same setup run twice is bit for bit identical (283 numbers);
  - a model rebuilt with every roster unchanged moves every team's P(playoffs), P(bye), P(title) and expected wins by exactly 0.
- **Trade Score scale check:** your weekly mean +x in every remaining week, 5,000 seasons on the same draws (± one standard error):

  | Gain | ΔPO | ΔCH | B | Score (B_ref 5) | Toy B / score | Score with B_ref 6 |
  |---|---|---|---|---|---|---|
  | +1 pt/wk | +2.3 pts | +1.9 pts | 2.05 ± 0.18 | 34 | 1.7 / 29 | 29 |
  | +3 pt/wk | +6.9 pts | +6.0 pts | 6.32 ± 0.32 | 72 | 5 / 63 | 65 |
  | +6 pt/wk | +12.0 pts | +12.5 pts | 12.35 ± 0.32 | 92 | 10 / 86 | 87 |

  - B runs about 25% above the planner's toy league; the B_ref that maps +3 to 63 is 6.4 ± 0.3.
  - From your team after its best free-agent move, B is 1.88, 6.19 and 11.88, and that B_ref is 6.2 ± 0.3.
- **Trade chips:**
  - 42 across the league (Team 6 has none, Team 8 has 10). 33 of them would help Team 2 most: its RB2 slot sits at z −2.7, and no free-agent RB helps it.
  - Yours: Rico Dowdle +19, Rhamondre Stevenson +15, David Montgomery +15, Kyle Monangai +14 and Breece Hall +12 (all to Team 2), and Mark Andrews +10 (to Team 7).
- **Bo Nix isn't a chip:** five free-agent QBs project within about 15 ROS points of his 195 (Mariota 210, Brissett 198, Cousins 196, Herbert 192, Ward 189). His cost to you is 14.1 lineup pts and the most he adds anywhere is +14.9 (Team 10), a gap of 0.8. §7's literal formula gives at most +18.4, so he isn't a chip under either rule.
- **Partners:** all mutual now: Team 8 (fit 4.0; Smith-Njigba would add +7.5/wk), Team 5 (3.6) and Team 9 (3.4).
- **Josh Jacobs:** questionable, ESPN return week 8. Sleeper doesn't project him in week 4, so he follows the date: weeks 4–6 0%, week 7 25%, week 8 73%. His row shows the note.

## CLAUDE.md sections changed since Checkpoint 2
- §1 item 3: "needs and trade chips".
- §2.2: the seeding tiebreaker values and mapping; division winners first (ESPN help center); ESPN's seed-by-seed tie procedure ⚠️; final scores, decided flags, multi-week periods.
- §2.3: pre-game snapshots (format, what archives, `pts_allow` kept); per-week caching with 24 h retention; the documented Sleeper tiebreaker and division seeding; final scores via `last_scored_leg`; `custom_points`.
- §2.9 te+/te++ approved; §2.10 per-week caching and single-flight; §4 `Matchup.weeks/decided/result`, `seedingTiebreaker`; §5 the negative binomial in Phase 6 and the SD refit.
- §6 step 3: conflicting ESPN signals, which tags use a return week, the healthy base rate, the outage case, and the open b question.
- §7: free-agent baselines, the pinned move and the drop rule, trade chips and their order, partners from chips, the game-day list, and the open baseline question.
- §8 the league's tiebreaker, week risk and Phase 3 details; §10 and §11 the baseline for B and n (open); §12 chips in the give pool.
- §14: the Import Report rows and the League page's standings, games, chips and messages; §15 new rows; §17 Phase 3 (build and checkpoint) and Phases 4, 6 and 7.

## What doesn't / open issues
- **Live scores aren't read.** On game days the week in progress is simulated as if no game had started, with today's rosters and injury news (⚠️). The page says so.
- **Sleeper playoff results aren't imported.** Once a Sleeper playoff round is played, its title odds show as unknown.
- **ESPN 3+ team ties.** ESPN's help center describes them seed by seed, resetting to head-to-head after each seed; we follow espn-api's grouped order. This matters only for H2H_RECORD leagues, not yours.
- **Unverified readings (⚠️):** ESPN's H2H_RECORD and INTRA_DIVISION_RECORD values (from espn-api); the median game with an odd team count; one median game per multi-week matchup; head-to-head playoffs in points-only leagues.
- **Earlier archive files.** Weeks 6–17 were archived before a review fix and lack D/ST points allowed; each re-archives on its next pre-kickoff fetch.

## Decisions I made
- **Chips keep the receiving team's pre-trade free-agent move (pinned).** Re-picking its one move would credit the trade with a pickup it could make anyway.
- **Partner fit counts only chips that stay chips together, at most 2 per side.** A starter and his backup are each chips only because the other covers him. Counting a deep team's whole group gave 15.2 points a week where its best single chip adds 7.
- **Chip order:** gap first, then the cheaper player to lose.
- **Weekly score SD** uses the law of total variance (within-lineup SD plus the spread across scenarios).
- **Missing data:**
  - a finished week that isn't scored yet is left out of the odds, with a warning;
  - a league whose remaining schedule didn't load gets no odds, rather than today's standings printed as final.
- **"Eliminated" is shown only when certain,** never from 0 in 5,000 seasons.
- **ESPN division winners are seeded first** (✅ ESPN help center).
- **Sleeper's tiebreaker is points for, then points against** (✅ Sleeper help center).
- **Sleeper's scores are read through `last_scored_leg`.** "Before the league week" would drop a week the records already count.
- **Risky weeks:** under 40% to win, or 3+ likely starters on bye, in `config.leaguePage`.

## Numbers
- **Tests and checks:** 1,898 tests pass (127 files); typecheck, lint and `next build` are clean. `check:leaks` finds 0 hard and 16 soft hits (same as Checkpoint 2).
- **Reviews:**
  - Every implementation track had its own reviewer.
  - The final adversarial review (9 lenses, a skeptic per serious finding) found 23 issues: 22 confirmed and fixed or documented, 1 refuted.
  - The biggest catches across all the reviews: the archive dropped D/ST points allowed; "eliminated" relied on unverified tiebreaks; a full roster could drop its starting kicker.
- **Simulator check:** it matched an independent reference simulator on 30,000 random leagues.
- **FantasyCalc rates:** unchanged (ID 146/146, value 144/146).

## Questions (numbered, each answerable in one line)
1. Change B_ref from 5 to 6 so +1/+3/+6 pts/wk score 29/65/87 in your league (34/72/92 today), matching the toy's 29/63/86?
2. One free-agent move per team is an approximation either way. Should chips, B and n use a baseline where every team makes every pickup that helps it? (Recommended; Phase 4 needs the answer.)
3. Chips follow the rule as written: 33 of 42 point to RB-starved Team 2, and starters qualify when their team has depth (McCaffrey +33). Keep it, or show only chips whose own-team cost is small?
4. OK that Bo Nix isn't a chip, because free agents as good as him are available (the free-agent rule at work)?
5. For a Q/D/P player, should his base rate ignore this week's injury-cut Sleeper projection, so the cut isn't counted on top of the tag's table?
6. Read ESPN's and Sleeper's live matchup scores so game-day odds count points already scored (Phase 4 or 6)?
7. For ESPN head-to-head leagues, follow ESPN's documented seed-by-seed procedure for ties among 3+ teams?

## How Parker can try it (PowerShell)
```powershell
npm run dev
```
Open http://127.0.0.1:3000/connect, paste your league link, pick your team, then open the League page. An import saved before this update asks you to import again. Other checks:
```powershell
npm test
npm run league:report -- --team 3
npm run import:report
npm run snapshot:projections
```
Run the last one on Wednesday nights to keep pre-game projections for Phase 6.
