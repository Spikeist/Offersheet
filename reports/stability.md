# Base-rate stability (Checkpoint 7b, B4)

Status: ⚠️ Measured on Parker's league over Oct 1–5, all inside week 4. No week rollover or game result reached the model yet, and the dumps hold only 3 full refreshes. Parker (Team 3) sits near 60% playoff odds, where odds move most.

**Answer:** day to day, the swings that injuries and results don't explain stayed under the bar. Parker moved at most 2.4 points of playoff odds per refresh about a day apart (1.8–2.4 over seeds), and any other team at most about 2.7 from projections. One refresh, whose Sleeper pulls were 2.5 days apart, crossed it for Parker (−3.5 to −4.9 over four seed sets on the app's waiver-order frame; −5.7 on the dump as saved), and that was role news that held. **Recommendation: no base-rate smoothing for launch.** The numbers are below, with a ready rule in case it's wanted.

⚠️ **The bar** (over 3 points for Parker, or over 5 for any team without injury news) is the lead's, set in the study's brief; the planner's reply asks only whether the swings are "large".

## Method
- **Engine:** checkpoint-7a (c321752), run from a separate git worktree. Nothing under src/ or scripts/ was edited. I used the League model's headline odds: every team after its pickups, 5,000 seasons, common random numbers.
- **Data:** the five saved dumps (Oct 1 19:01Z to Oct 4 09:24Z), plus two new data points:
  - one new live dump (Oct 5 19:42Z), made the way data-local/dump-final.ts made the others: the app's public-link import and its caches, with the local archives not written;
  - Sleeper's Oct 4 13:33Z pull of weeks 5–17 from the local pre-game archive, scored through the engine's expectedPoints. On every line Sleeper didn't change, it matches the dumps to the hundredth (weeks 6, 9, 13 and 17 checked: 368–374 of 418 players exact, plus 0–5 within 0.02; week 5: 187 exact plus 37 within 0.02).
- **Swap:** dump A's snapshot, time, actual points, schedule and FantasyCalc lists, with dump B's projections (Sleeper weekly and season, and ESPN). Only forecasts move: a current-week line whose game had kicked off by B's time keeps A's value.
- **Unexplained:** players whose injury status, return week or NFL team changed between A and B keep A's projections. FantasyCalc is swapped on its own, since it moves the odds through the market blend. ⚠️ The separation reads ESPN's tags only: a player whose Sleeper later weeks flipped between stubs and projections with no ESPN change counts as unexplained (Oct 4 → Oct 5: Travis Etienne Jr., Team 10, IR, weeks 5–7 now stubs; Josh Jacobs, Team 1, Questionable, week 7 now projected; Sep 30 → Oct 3: Zach Charbonnet, Team 10). Holding those too changes the Sep 30 → Oct 3 pair not at all, Oct 4 09:24 → Oct 5 to Parker +1.4 (largest other team: Team 6, −0.8), and Oct 4 13:33 → Oct 5 to Parker −0.7 (largest other team: Team 1, +2.7).
- **Waiver order:** the Oct 1 dump was saved by pre-4b code, without waiver ranks, so the engine shares out free agents by gain there (Parker picks up T.J. Hockenson). Every other dump uses the weekly reset order. Standings were the same on Oct 1 and Oct 3, so the first pair is also given Oct 3's reset ranks (the app's own frame); both readings are quoted.
- ⚠️ The dumps from Oct 3 15:37Z to Oct 4 09:24Z share one cached Sleeper pull of weeks 7–17 (Oct 3 09:25Z) and one FantasyCalc list. Weeks 5–6 (6-hour cache) were fetched again by each dump, with no line changed. "2.5 days apart" and "28 h apart" below describe weeks 7–17.

## Swings
All numbers are points of Parker's playoff odds, with his title odds in brackets. "Max" is the largest change of any team (T = Team).

| From → to (hours) | What refreshed | What you'd see | Projections only | Unexplained | FantasyCalc only |
|---|---|---|---|---|---|
| Oct 1 19:01 → Oct 3 15:37 (45), reset-order frame | Sleeper pulls 2.5 days apart, ESPN, FantasyCalc; 38 players with injury news | −5.7, max T3 | −5.5, max T3 | **−4.8** (seeds: −3.5 to −4.9), max T3 | +0.5, max T1 −3.5 |
| the same, dump as saved (no waiver order) | as above | −4.2 (−1.5), max T3 | −5.5 (−2.1), max T3 | −5.7 (−2.1) (seeds: −4.0 to −5.7), max T3 | +1.5 (+0.7), max T1 −3.6 |
| Oct 3 15:37 → Oct 4 09:24 (18) | this week's game lines only; 3 with news | −0.1 (−0.1), max T10 −0.6 | 0.0, max T10 −0.6 | 0.0, max T10 −0.6 | none |
| Oct 4 09:24 → 13:33* (4) | Sleeper's weeks 5–17 (pulls 28 h apart) | +2.4 (+0.7), max T3 | +2.4 (+0.7) | +2.4 (+0.7) | none |
| Oct 4 13:33* → Oct 5 19:42 (30) | Sleeper (after Sunday's games), ESPN, FantasyCalc; 30 with news | +1.9 (+0.8), max T10 −5.1 | −0.3 (+0.3), max T6 −0.9 | −0.2 (+0.4), max T10 +1.1 | −1.6 (−0.9), max T7 +2.2 |

\* The Oct 4 09:24 dump with the archive's pull; no injury news after 09:24 is known. The two real dumps Oct 4 09:24 → Oct 5 19:42 (34 h): unexplained +1.7 (+0.9), max T1 −2.0 (with Sleeper-only injury news held too: Parker +1.4, max T6 −0.8). What you'd see is +4.2 (+1.5), max T10 −6.2, of which Sunday's injury news and two roster moves (Team 4 swapped D/STs, Team 7 added a player) explain about two-thirds for Parker (+2.8) and about half for Team 10 (−3.1); the rest is the projection and FantasyCalc refresh measured on the post-injury snapshot.

All swings are for one simulation seed unless a range is given. Discrete pickup choices move single-seed numbers by about ±1 point.

## What drives them
- **Sleeper's later weeks, almost entirely.** Of the −5.5 from Oct 1 to Oct 3, −4.4 comes from weeks 5–17 (−3.9 on the reset-order frame), −1.1 from this week's game lines and 0.0 from ESPN. ESPN never moved any team more than 0.7.
  - It isn't simulation noise: on the fixed frame below, four simulation and scenario seed sets move Parker −4.8, −4.9, −4.8 and −5.6 for this refresh.
- **Mostly real role news** (⚠️ our reading of persistence). From Sep 30 to Oct 3, 26 rostered players' later-week level moved by 5% or more. 23 still held it at the next pull, 1.2 days later; on average none of the move was given back.
  - One at a time on the fixed frame (−4.8 in all): David Montgomery (Team 3) went from 14.1 to 12.1 points a game as Woody Marks rose 29%, costing Parker −1.6. Davante Adams (Team 1, +23%) cost −1.4; DJ Moore (Team 1, +12%) and Tee Higgins (Team 4, +9%) −0.4 each.
  - Adams rose after a teammate's injury news. Holding injured players' same-team, same-position teammates as well leaves −4.8 on the pair above (−4.1 on the reset-order frame).
- **One pure blip.** Sleeper's Oct 4 12:45Z update cut all 10 rostered kickers' later weeks by 8–18% (median −13%), and the next pull restored all 10. Parker's kicker fell less than most rivals' kickers, worth +0.4 to +0.8 on its own; the whole Oct 4 pull gave him +1.8 to +2.4, the rest from other one-day moves (for example Team 9's Zay Flowers −10%, a free-agent D/ST +7%). Of the 16 players who moved 5% or more that day, 15 reversed (105% given back); restoring the kickers on Oct 5 cost −0.9.
- **The market blend already halves projection churn.** The Sep 30 → Oct 3 refresh is −9.2 with the blend off, −6.6 at weight 0.25 and −4.8 at 0.5 (with pickups). As rosters stand, the blend-off figure is −7.9; Checkpoint 4b's −10.0 for this refresh also included ESPN's refresh and was measured as rosters stood on its own model.
- **Some swing is discrete.** Team 1's −1.9 on the Oct 4 pull is −0.9 as rosters stand, plus a pickup that fell under the 3-point bar.
- **FantasyCalc.** Lists 1.6 and 2.4 days apart moved Parker +1.5 and −1.6 (−0.8 on the real dumps). Any team moved up to 3.6 (Team 1) and 2.2 (Team 7).

## Smoothing prototypes
**The rule tested.** A player's level is his mean healthy Sleeper projection from this week on. Each player's base-rate projection term (proj_now / m_now) is multiplied by the mean or median of his level over the last k pulls, divided by today's level. Week shapes, stubs (injuries, byes) and this week's game line stay as today's pull has them.

**Frame.** The Oct 4 09:24 dump, with only Sleeper's weeks 5–17 changing across its four pulls. Injury news is held; numbers in brackets include all players. ⚠️ There is no pull before Sep 30, so the first windows repeat it.

| Rule | Parker's steps: →Oct 3, →Oct 4, →Oct 5 | Parker's largest | Any team's largest | Parker's total movement |
|---|---|---|---|---|
| Today's pull (as now) | −4.3, +1.8, +0.3 | 4.3 (4.8) | 4.3 (4.8) | 6.4 (7.4) |
| Mean of last 2 pulls | −1.6, −1.9, +1.0 | 1.9 (2.0) | 1.9 (2.0) | 4.5 (4.8) |
| Mean of last 3 pulls | −0.9, −1.2, −0.6 | 1.2 (1.1) | 2.4 (2.8) | 2.7 (3.1) |
| Median of last 3 pulls | +0.3, −4.6, +0.9 | 4.6 (5.4) | 4.6 (5.4) | 5.8 (7.3) |

- **On the dumps' own snapshots,** where this week's lines and pickups move too, the drop arrives in parts rather than getting smaller. On the reset-order frame over four seed sets, Oct 1 → Oct 3 goes from −3.5 to −4.9 raw, to −2.5 to −4.2 with a 2-pull mean (default seed −2.8, then −2.3 the next step: under the bar), and to −2.0 to −3.9 with 3 pulls. (As saved, default seed: −5.7 raw, −3.9 with 2 pulls, −3.6 with 3.) ⚠️ The prototype treats the Sep 30 and Oct 3 pulls as consecutive; a server pulling daily would compare with a pull about a day old, so the rule's real effect depends on when the news lands.
- **The cost is lag on real news,** in rest-of-season points after the blend:
  - Montgomery goes 143 → 138 at once today; 143 → 140 → 138 with 2 pulls; 143 → 141 → 139 → 138 with 3. Adams goes 142 → 157, or 142 → 149 → 157 with 2 pulls.
  - The median removes the kicker blip (Tyler Loop 102 → 102 → 103 instead of 103 → 95 → 103), but it delivers role news whole, one pull late.

## Recommendation
- **Don't smooth the base rate for launch.** The bar is over 3 points for Parker, or over 5 for any team without injury news. Every refresh about a day apart stayed under it.
  - The one crossing came from Sleeper pulls 2.5 days apart, and it was role news that held.
  - Averaging would spread it over 2–3 days without changing where Parker ends up. It would also show a trade target's new role a day or two late.
- **If the planner wants a guard anyway,** use the 2-pull mean in src/engine/projections.ts blendBaseRate:
  - Multiply proj.value / mNow by f = (L_yesterday + L_today) / (2 × L_today).
  - Set f = 1 when there is no previous pull, when today's pull doesn't project him, when his status, return week or NFL team changed (the server stores those with the level), or when Sleeper's projected weeks for him changed between projected and stub.
  - It needs yesterday's pull: the server keeps a second copy of each Sleeper projection week for 48 hours, assembleModelInputs adds one number per player (PlayerInputs.sleeperPrevLevel), and config gets projections.smoothPulls = 2.
  - Measured effect: Parker's largest step falls from 4.3 to 1.9 on the fixed frame; on the worst pair, −3.5 to −4.9 becomes −2.5 to −4.2 over seeds.
- **Re-measure in Phase 6** with several weeks of daily pulls, week rollovers and real results. Since Checkpoint 7c (planner reply to Checkpoint 7b, question 4) the snapshot cron supplies them: every day it also saves each offense player's rest-of-season level, his mean Sleeper projection over the weeks not yet kicked off, in Sleeper's own standard, half-PPR and PPR totals, with the weeks he's projected (about 8 KB a day, kept two seasons; src/server/projectionLevels.ts, copied to data-local/projection-levels/ by `npm run snapshot:pull -- --live`). ⚠️ They're never in a league's scoring, so the 2-pull rule would read a format's ratio, and its status, return-week and team guard needs those from elsewhere; the pre-game archive alone (the current and next week) wouldn't do, since the later weeks drive these swings (weeks 5–17 gave −4.4 of −5.5).

## Runtimes (this PC, Node 22, warm)
- One League model build takes 0.21–0.57 s (median about 0.3 s). measure.ts (6 pairs × 10 variants) 21 s; sequence.ts (32 builds) 15 s; attribution.ts (about 150 builds) 51 s; the live dump 12 s.
- The rule itself costs one multiplication per player.

## Rerun
- The drivers are in data-local/stability/ (git-ignored), their outputs in data-local/stability/out/, and the new dump in data-local/stability/dump-oct5/. That folder isn't a parker-league* folder, so no report picks it up.
- The drivers import ../../src, so run them from a checkpoint-7a worktree (node_modules as a junction) with the .ts files copied into its data-local/stability/. They work offline and read the dumps, and the archive's Sleeper pull, from this folder by absolute path. ⚠️ A later pre-kickoff pull (Oct 5 21:00Z) has since replaced week 5 in data-local/projection-snapshots/, so the pairs built on the Oct 4 13:33Z pull no longer reproduce exactly (weeks 6–17 are still that pull).
- Run `npx tsx data-local/stability/measure.ts` with the pairs listed in out/measure.txt, then sequence.ts, smoothPair.ts, attribution.ts, movers.ts (given dump-oct5's absolute path), blendCheck.ts, pickups.ts, kickers.ts and checkArchive.ts.
- Never rerun fetchToday.ts: it makes the live dump, and it refuses while dump-oct5 exists.
