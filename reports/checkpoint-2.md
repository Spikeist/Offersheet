# Checkpoint 2: Projections, lineup solver, market values, needs, League page
Status: ⚠️ Done with issues. Every Phase 2 build item and every Checkpoint 1 answer is in, tested and running live on your league. The ⚠️ items are calibration: SD fits measured on post-game-restamped projections, assumed injury defaults, and two model decisions for the planner (Questions 1–2).

## What works
- **League page** (`/league`, phones first): team table (record, PF, projected points/week, ROS, need and surplus chips), positional strength heatmap (rest of season / next 4 weeks), best trade partners, every roster with ROS points (regular season / playoffs, games left, bye status; tap for week-by-week points and availability), each team's best free-agent move, best free agents by position, "How these numbers work", and "Values: FantasyCalc" links next to values. The math runs in a Web Worker: the page is ready 1.6 s after opening it in a production build, about 1 s of that on the server building model inputs.
- **Projection model (§6):** base rate from Sleeper × your scoring, averaged with ESPN's own league-scored projection because they agree within 10% (9.5% over 152 rostered players this week), plus recent form; opponent week shape; availability with the injury table (PROBABLE 0.95 added), ESPN's expected return dates (±1 week), byes, games already kicked off, and the new future-injury risk (P_out(k) = M(1 − (1 − h − r)^k)).
- **ROS points (addition A)** for every player: remaining weeks only, split regular/playoffs, games left, "bye done" / "bye wk 9".
- **Availability scenarios (addition C):** 32 scenarios with common random numbers; injuries persist across weeks; lineups solved per scenario. Scenario mean equals expected availability (checked at S = 20,000: worst gap 0.007).
- **Lineup solver (§7):** one exact solver for screening and exact evaluation (a matroid greedy with augmenting paths, plus a min-cost-flow fallback for mixed eligibility under starter limits). It matches brute force on 2,440 random cases and runs about 1.5M lineups/s.
- **Market values (§9):** FantasyCalc in your format (10 teams · half-PPR · 1 QB · redraft), estimates for unvalued players, floors, and the waiver credit (W = 752).
- **Needs, surplus, partners (§7)** for every team.
- **Checkpoint 1 answers:**
  - name matches are strict and uncapped
  - crosswalk overrides are logged as notes (5 ids, 2 players, tested on their real records)
  - Poisson count stats and measured yardage SDs
  - PROBABLE status
  - `USE_ENV_COOKIES=1` opt-in
  - Sleeper 200-yard tiers and pick window ✅ with citations
  - compact phone picker: the Import button is now at y 612–656 of 812 (was 882–926)
  - FantasyCalc format row in the Import Report

## Your league (full tables: `reports/league-report.md`; names are placeholders)
- **Projected starting points per week** (scenario lineups): you average 111.1, 1st of 10 by a hair (Team 4 111.0). You rank 1st in weeks 5, 10, 12, 14, 16 and 17, and 9th in week 13, when Bowers, Hall, Wilson, Andrews and Loop are all on bye (85.9).

  | Wk | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
  |---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
  | You | 113.1 | 117.8 | 117.6 | 107.8 | 110.6 | 112.3 | 121.0 | 102.0 | 118.3 | 85.9 | 115.7 | 115.6 | 113.7 | 121.4 |
  | League median | 113.1 | 107.2 | 99.8 | 102.4 | 105.7 | 108.3 | 106.3 | 100.2 | 110.5 | 96.5 | 104.6 | 109.6 | 108.6 | 107.9 |

- **Your ROS leaders:** Josh Allen 315.8 (Q this week: 85%), Puka Nacua 222.9, Bo Nix 194.3, Bowers 155.8, Montgomery 152.6. Every rostered player's ROS and weekly points are in the report.
- **Needs / surplus, every team** (surplus = valuable depth his team would barely miss that would start elsewhere):

  | Team | Needs (z) | Surplus |
  |---|---|---|
  | 1 | K1 −3.3, QB1 −1.2, WR1 −1.1, WR2 (next) −0.7 | none |
  | 2 | RB2 −2.3, RB1 −1.1, FLEX1 −0.9, WR2 (next) −0.7, TE1 −0.6 | none |
  | 3 (you) | FLEX1 −1.3, RB1 −1.1, D/ST1 (next) −0.8 | none |
  | 4 | none | none |
  | 5 | WR1 −2.0, WR2 −1.2, QB1 −0.6 | none |
  | 6 | QB1 −1.1, WR1 −0.6, K1 (next) −0.6, WR2 (next) −0.5 | none |
  | 7 | TE1 (next) −1.3, FLEX1 −0.6, WR1 (next) −0.5 | George Pickens |
  | 8 | RB1 −1.1, RB2 −0.6, D/ST1 −0.6, K1 (next) −0.6 | Drake London |
  | 9 | RB2 (next) −0.8, FLEX1 (next) −0.7, WR2 −0.5, D/ST1 −0.5, K1 (next) −0.5 | Omarion Hampton |
  | 10 | RB1 −1.7, QB1 (next) −1.7, RB2 −1.7, D/ST1 −1.1, TE1 −0.8 | none |

- **Partners for you:** you have no surplus, so every fit is one-sided (they have a player who would start for you): Team 8's Drake London (+2.9/wk), Team 9's Hampton (+1.0), Team 7's Pickens (+0.9).
- **Your best free-agent move:** add Chase McLaughlin (K, TB), drop Kyle Monangai: +13.6 lineup pts (playoffs count 1.25×).
- **FantasyCalc (rostered QB/RB/WR/TE):** ID match 146/146 = 100%. Has a value 144/146 = 98.6%; Jaylen Wright and De'Von Achane (out for the season) are estimated.
- **Depth, before/after (addition C):** a bench player's value to his team with nobody replacing him:
  - Hand-built league (a bench RB behind two stars): 0.0 lineup pts with expected-value lineups, 55.0 with scenario lineups.
  - Your league: J.K. Dobbins (Team 8) 0.0 → 13.1 lineup pts, Tucker Kraft (Team 5) 0.0 → 10.7, your Mark Andrews 0.5 → 8.6. Across all 37 bench players: 0.2 → 3.1. Depth matters less in a 10-team league with 7 bench spots and a deep waiver wire.
- **Runtime:** engine 60–80 ms with expected-value lineups vs 120–130 ms with 32 scenarios (≈2×, in the browser). Model inputs on the server: 5.0 s cold (21 Sleeper and 2 FantasyCalc requests), about 1 s cached. ESPN import 6.6–8.1 s cold, 0.2 s cached.

## CLAUDE.md sections changed since Checkpoint 1
- **From the planner's reply:**
  - Timing (priority)
  - §0.5 (`USE_ENV_COOKIES`)
  - §2.2 (Login)
  - §2.3 (yardage tiers ✅, pick window ✅)
  - §2.9 (crosswalk rules)
  - §3 (Credentials)
  - §4 (PROBABLE)
  - §5 (distributions)
  - §6 (PROBABLE, future injury risk, step 7 ROS points, Phase 6 tuning)
  - §7 (availability scenarios)
  - §8 (σ adds the scenario spread)
  - §12 step 3
  - §13 (ROS on trade cards)
  - §14 (phone picker, roster tables)
  - §15
  - §17 (Phases 1–6)
- **From Phase 2 findings:**
  - §2.2 (ESPN's weekly projections live in mRoster, league-scored exactly)
  - §2.3 (stubs, `gp`, what the model fetches)
  - §2.9 (FantasyCalc `value` vs `redraftValue`, keeper double fetch, te+/te++ and tie rules, crosswalk wording, TBD kickoffs)
  - §2.10 (stats row)
  - §5 (measured SDs, mean-matched floor, overdispersion ⚠️)
  - §6 (proj_now and the agreement metric, return weeks, started games, σ = 0 without a game)
  - §7 (one solver, scenario streams, waiver-adjusted lineup cost, surplus rule, one-sided partners, slot instances; review decisions: game days, joint partner fit, no surplus without trade values)
  - §14 (Import Report and League page additions, labels, 6-hour reuse)
  - §15 (new rows)

## What doesn't / open issues
- ⚠️ **SD fits:** they come from weeks 1–3 of Sleeper projections re-stamped after the games (stamps 04:00Z the Tuesday after), so they may understate forecast error.
  - Fits: rec_yd 8.8 + 0.50 × mean; rush_yd 3.9 + 0.48; pass_yd 0.341 × mean; D/ST yards allowed 77.
  - Volume counts are overdispersed against Poisson: rush attempts 2.0, completions 1.9, receptions 1.3. TDs fit.
- ⚠️ **Defaults are assumptions until Phase 6:** M_pos and d (planner defaults), the ±1-week return spread (25/50/25), the te+/te++ cut (0.75 per catch), the season-projection ÷ 17 fallback (used for 32 of 423 players: mostly deep free agents).
- ⚠️ ESPN's projections come only from the import (current and previous week). A player injured longer uses Sleeper's history alone.
- A QUESTIONABLE player whose ESPN return date is 2+ weeks out follows the return date: Josh Jacobs (Team 1, ESPN expects him back in week 8, give or take a week) is projected 0 for weeks 4–6.
- Leftover crosswalk links no rule can fix: MFL 14683, GSIS 00-0039677, and a disputed Sportradar id. None is in your league.
- **Development only:** the first League page load after a code change can take about 70 s while Next.js writes its compile cache. The model route itself takes 2.1 s cold and 1.2 s warm.
- A cold model build downloads about 40 MB of Sleeper projections every 6 h. That's fine on your machine; Phase 7's shared cache must plan for it, and should add single-flight fetches so two users loading at once share one download.
- For Phase 4: when a keeper league's dynasty list fails, the market falls back to redraft values; ΔDyn must then treat the long-term values as missing.
- **Game days:** once the week's first game kicks off, team numbers (points per week, strength, needs, lineup costs, partners) count from next week, and the page says so. Players' own ROS points still count their unplayed games.

## Decisions I made
- **Lineup cost** is measured from the team after its best free-agent move (Question 1).
- **Surplus** requires a below-average lineup cost. One-sided partners are listed after mutual ones (Question 2).
- **A floored normal is mean-matched:** its floored mean equals the projection. Plain flooring would inflate small means (a 5.6-yd WR would average 10.7).
- **Report names:** reports print public NFL player names in full and shield them from the last-line scrubber. Scrubbing a leaguemate's first or last name inside a player's name ("First 6 London") would have let a reader work the leaguemate's name back out.
- **Server payload:** model inputs are rounded to 0.01 point and computed on the server, so the browser gets about 130 KB of points, not stat lines. Stored inputs are reused for up to 6 hours.
- **Sleeper outages:** a Sleeper outage fails fast. It costs about 1.3 s instead of minutes, and later builds wait 5–15 minutes before asking again.
- **Team shape:** the lineup-cost baseline also fills an open roster spot. Strength uses slot instances (RB1, RB2, FLEX1).
- **ESPN:** no extra ESPN request. Its league-scored projections are read from the import.

## Numbers
- 1,589 tests pass (120 files); typecheck and lint clean; `check:leaks` 0 hard, 16 soft (the two new ones are one ordinary English word in code that happens to be a stranger's league name); `next build` OK.
- **Adversarial review** (7 lenses; a skeptic tried to refute each finding): 39 findings, 37 confirmed, all fixed; an independent check re-verified them. The biggest: game-day skew, a Sleeper outage stalling the page, partner fit double-counting, and surplus without trade values.
- **Lineup solver:** 30 tests, 2,440 brute-force comparisons, 2,400 fast-path equivalence checks, 14/15 mutants caught (the 15th was unreachable and removed).
- **Browser check at 375×812** (headless Edge, production build, your league through the public-link flow):
  - League page ready in 1.6 s
  - no page overflow
  - 18 tables, all captioned
  - 5 FantasyCalc links
  - 0 console errors
  - reload reuses the stored inputs
  - stored import 95 KB, model 130 KB
- **Oracle:** unchanged, 12 suites.

## Questions (numbered, each answerable in one line)
1. OK to measure lineup cost (MV_lose) from the team after its best single free-agent move? The formula as written went negative for 107 of 157 players in your league because free-agent kickers beat starters.
2. OK that surplus means depth only (a below-average lineup cost on its roster), with one-sided partners ("Would start for you") listed after mutual ones?
3. Should Phase 6 move rush attempts, completions and receptions to a negative binomial (measured overdispersion 1.3–2.0), keeping TDs Poisson?
4. Start saving each week's Sleeper projections before Thursday kickoff now, so Phase 6 can re-fit SDs on true pre-game numbers?
5. OK to map a TE premium below 0.75 per catch to FantasyCalc's te+ and 0.75 or more to te++ until FantasyCalc says otherwise?
6. OK that a questionable or doubtful player with an ESPN return date 2+ weeks away follows the date rather than the one-week table?

## How Parker can try it (PowerShell)
```powershell
npm run dev
```
Open http://localhost:3000/connect, paste your league link, pick your team on the Import Report, then open http://localhost:3000/league. Other checks:
```powershell
npm test
npm run league:report -- --team 3
npm run import:report
```
