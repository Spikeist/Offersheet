# Checkpoint 7e — launch-week fixes (the planner's reply to Checkpoint 7d)
Status: ✅ Done. Every item is built in the order listed, tested and reviewed. It was checked live on your league today (check:browser 162 passed, 0 failed), and the production dry run passes every check. Production keeps serving `checkpoint-7d` until your "go."

## What changed
- **1.1 Seasons:** every number a page prints now comes from 20,000 simulated seasons. That covers the League page's odds, every trade card, Plan B box and Analyzer result, and the waiver ratings. The search still ranks on the first 5,000 of those same seasons.
- **1.2 K and D/ST:** no season-to-date weight (`config.projections.actualWeightByPos`: K 0, DEF 0). Their projections are ESPN's and Sleeper's alone. Phase 6's backtest decides whether the weight comes back.
- **2.1:** an optional free-agent move after a trade is tested on your baseline with the same pickup bar. If it clears the bar there too, it's made in both versions and the trade gets no credit for it. Forced moves stay with the trade.
- **2.2:** each card lists every roster move its numbers assume, in order, each with its reason and its week. Moves made either way go on one line: "Assumed with or without this trade: …".
- **2.3:** a release when a player comes back from IR compares players from that week on: their points, their trade value and the free-agent bar.
- **3.1–3.4 Waiver upgrades:**
  - Each row is one move, "Add A, drop B", with "Outscores B by N". Rest-of-season rows also show Helps you for that exact swap and are sorted by it. The lineup gain moved to the row's details.
  - "Drop from the same position" is on by default and saved per league.
  - Untouchables are never a drop anywhere: Waivers, trade cards' moves and IR returns. You can lock players from the roster card and the waiver view. When every candidate is locked, the row says so ("All your RBs are untouchable.") and suggests turning the switch off.
  - This week and Next week stay in points.
- **3.5:** your injured players show "Expected back: week N", marked ESPN, our guess or your week, and you can change it. It's saved per league in your browser and never sent. It clears itself when the player is active again or the week passes.
- **4.1 "How to offer it":** up to 4 offers to the same team, in order: Open with, Then, the suggested trade, Last offer. Each shows Helps you, the chance and its own message, and they're worked out in your browser when you open the list. Plan B sits below it: "If they won't move: try …". Feedback records which offer you sent.
- **4.2:** "Helps you 37 now · 41 if done after this week's games." with the planner's tooltip. It shows when at least 2 weeks remain before the deadline and the two numbers differ by more than 3.
- **Old data:** stored settings load with the new defaults, and feedback saved as "Offer first" or "Full trade" still reads. The new settings never leave your browser. The anonymous copies' version field takes the new offer names, and the server still accepts the old ones.
- **Reviews:** four build waves (A–D), each reviewed and fixed, then a final five-way review: 21 findings, 15 fixed, 1 not a defect, 5 decided below.

## Left for later
- **Speed in a 12-team league:** your second league's search takes about 7.9 s in Node (8.8 s for the first search of a session). At Checkpoint 7d's Node-to-browser ratio that's about 9.8 s and 10.9 s, over the 10 s target. Your first league searched in 6.4 s in the browser today. A known fix gets back about 0.3 s: simulate only the 15,000 seasons the ranking run doesn't already cover. It isn't built.
- **Tabs left open from 7d:** after the deploy, a tab still running 7d drops 7e's new settings, and the offer recorded on feedback, when it saves. Reloading open tabs avoids this. Phase 5 makes the store keep fields it doesn't know. I didn't bump the store's version, because a rollback to 7d would then hide everyone's saved leagues.
- **2.3 on your case:** Pierce is still the week-7 release (below).

## Seasons (1.1)
- **The planner's test** (top 5 cards, 5 seeds, 5,000 seasons) on 7d's engine: the top card's Helps you spread by 5 (4 at 10,000 seasons, 3 at 20,000). The title-odds change spread by at most 0.18 points and the top-3 change by at most 0.55. Since 5 is over 3, I raised it.
- **On the engine as built:** the top 5 spread by 3 / 3 / 3 / 1 / 3 at 5,000 seasons and 1 / 1 / 2 / 1 / 2 at 20,000. The title change spreads by at most 0.16 → 0.13 points and the top-3 change by at most 0.41 → 0.38. A 100-seed check (20 groups of 5) puts a top-5 card more than 3 apart in 12 of 20 groups at 5,000 and in none at 20,000.
- **Final count: 20,000 seasons** for everything shown. Ranking uses 5,000 (the first 5,000 of the same seasons) and screening 1,000.
- **Cost** (Node, warm, all of 7e): the League page's build 0.35 → 0.58 s. Context + search 5.5 → 7.1 s in your first league and 6.2 → 7.9 s in your second.

## K and D/ST (1.2): your week-6 case (second league, Team 7; data from Oct 14, 9:06 PM UTC)
| Week 6 | Giants D/ST (yours) | 49ers D/ST (free agent) |
|---|---|---|
| ESPN's projection | 5.33 | 4.75 |
| Sleeper's projection | 5.44 | 7.79 |
| Season-to-date part (5 games, weight 0.21) | 1.43 (6.4 a game so far) → 0 | 2.15 (8.6 a game) → 0 |
| Week-shape factor | 1.07 | 1.20 (1.33, capped) |
| **Our number** | **5.74 → 5.44** | **8.32 → 7.79** |

- **Why the 49ers led:** ESPN and Sleeper differ by 11.6% across your league this week, over the 10% bar, so the model uses Sleeper alone. Sleeper has the 49ers 2.35 ahead (7.79 against 5.44); points so far (8.6 a game against 6.4) added the rest of the 2.58. Only ESPN has the Giants ahead. Averaged with ESPN, the 49ers would still lead by 0.9.
- **Now** each D/ST reads Sleeper's own number. The gap narrows to 2.35, and "This week" now leads with the Colts D/ST: add Colts, drop Giants, +2.45 (the 49ers +2.35).

## Trade math (2.1–2.3): first league, your prizes
**Nacua → Drake London + Christian Watson** (Team 8, in the Analyzer):
| | Helps you | Chance | Overall | The card's roster moves |
|---|---|---|---|---|
| 7d (the live site, on this data) | 49 | 20% | 13 | "You'd drop Romeo Doubs (WR, NE) to stay within your roster limits." "From week 7, when Alec Pierce comes back from IR, you'd release him instead of dropping someone else." |
| Before 2.1–2.3 (after 1.1, 1.2) | 46 | 20% | 12 | the same |
| After 2.1–2.3 | 46 | 20% | 12 | "Make room for Christian Watson: drop Kyle Pitts Sr. (TE)." "Week 7, when Alec Pierce returns from IR: release him; without this trade, Kyle Pitts Sr. (TE) would go then." "Assumed with or without this trade: add Jake Ferguson, drop Romeo Doubs." |

- **The numbers didn't move with 2.1–2.3** (B the same to the last digit); the words now name the real cost. Your League-page pickup, Ferguson for Doubs, happens either way. Against it, the trade costs Pitts now rather than in week 7, and then Pierce in week 7, whom the League page's plan keeps.
- **The planner's example** ("drop Rico Dowdle and Kyle Pitts Sr., pick up Darren Waller") came from the live site at another moment and doesn't appear on this data. Here Waller is Team 4's pickup, and Team 4 claims first.
- **2.1 moves no number on your leagues:** none of the searches' optional moves clears the bar on your baseline (31 in your first league, 112 in your second). On made-up leagues it does: a giveaway that read Helps you 70 now reads 0.
- **Cards that moved by more than 3 points:** none from 2.1–2.3 (0 of 13; one card's B moved by 0.001). Across all of 7e, 1 of the 11 cards both versions show moved by more than 3: card #1, 48 → 44, mostly from the 20,000 seasons and the K/D-ST change.
- **2.3, Alec Pierce:** still released in week 7.
  - From week 7 on, losing Wan'Dale Robinson costs your lineup 8.8 points against Pierce's 2.1, so Robinson stays.
  - Marvin Harrison Jr. costs only 0.2, within the near-tie window (2.3) of Pierce's 2.1. The near-tie rule keeps the one with more trade value: [value] from week 7 for Harrison Jr., against [value] for Pierce.
  - Ranked on lineup points alone, Harrison Jr. would go.

## Waivers (3.1–3.5)
**Your top 5 rest-of-season rows** (first league, your prizes, "Drop from the same position" on):
| # | Move | Outscores | Helps you |
|---|---|---|---|
| 1 | Add Alvin Kamara, drop Rico Dowdle | by 11 | 5 |
| 2 | Add Malik Washington, drop Romeo Doubs (Depth only) | by 5 | 5 |
| 3 | Add Pat Freiermuth, drop Kyle Pitts Sr. | by 2 | 4 |
| 4 | Add Jake Ferguson, drop Kyle Pitts Sr. | by 10 | 3 |
| 5 | Add Darren Waller, drop Kyle Pitts Sr. | by 7 | 2 |

6 of 48 rows rate above 0; the rest read "No gain." The rating runs when Waivers first shows (0.46 s in Node after the League page's 0.58 s build), and the rows show their points meanwhile.

**Josh Jacobs** (second league, Team 7): his return week comes from ESPN (week 8), so his roster row reads "Expected back: week 8 (ESPN)" rather than our guess.
| His return week | Jacobs suggested as the drop | Rows that rate above 0 |
|---|---|---|
| ESPN's week 8 | 20 of 21 season rows, 27 of 31 "This week" rows | 1: add RJ Harvey, drop Jacobs, Helps you 3 (outscores him by 43) |
| Week 7, set by you | the same 20 of 21 and 27 of 31 | 1: the same row, Helps you 1 (by 40) |
| Jacobs locked | never | the season list keeps 1 row: add Wan'Dale Robinson, drop Rome Odunze, "No gain" |

With "Drop from the same position" on, an RB pickup drops an RB. Jacobs (41.6 points left) is the only RB of yours most of them outscore. The other rows read "No gain," because dropping him gives up his trade value. Turning the switch off lets the drop come from any position.

## Offers in order (4.1): your top 3 cards (first league, your prizes)
1. **Team 6: Marvin Harrison Jr. + Puka Nacua → Nico Collins + Tetairoa McMillan** (44 · 55%)
   1. Open with Puka Nacua → Nico Collins + Tetairoa McMillan: Helps you 45 · 50% ("Also shown as trade idea 2.")
   2. The suggested trade: 44 · 55%
2. **Team 6: Puka Nacua → Nico Collins + Tetairoa McMillan** (45 · 50%)
   1. The suggested trade: 45 · 50%
   2. Last offer, adding Marvin Harrison Jr.: 44 · 55% ("Also shown as trade idea 1.")
3. **Team 4: Breece Hall + Marvin Harrison Jr. → Mike Evans + Ollie Gordon II** (49 · 40%)
   1. Open with Breece Hall → Mike Evans + Ollie Gordon II: 52 · 25% ("Also shown as trade idea 5.")
   2. The suggested trade: 49 · 40%

**Time to build:** 18, 8 and 33 ms in Node (the first open after a search, median of 3); 30, 30 and 102 ms in your second league. In the browser today it took 0.2 s, on the live data, where your first card was Hall + Harrison Jr. → Evans + Gordon: Open with 56 · 20%, then the card at 53 · 35%. No version on your top 10 beat its card on both Helps you and the chance (481 candidates).

## Now or after this week (4.2): your top 5 cards
| Card | Helps you now | If done after this week | Line shown? |
|---|---|---|---|
| 1. Harrison Jr. + Nacua → Collins + McMillan | 44 | 47 | no (3 apart) |
| 2. Nacua → Collins + McMillan | 45 | 47 | no |
| 3. Hall + Harrison Jr. → Evans + Gordon | 49 | 46 | no |
| 4. Harrison Jr. + Nacua → Kyren Williams + Evans | 59 | 56 | no |
| 5. Hall → Evans + Gordon | 52 | 49 | no |

The line shows on 3 of your 13 cards: #6 31 → 27, #7 25 → 31, #8 27 → 20. In your second league it shows on none. On today's live data it showed on 5 of 13. Cost: 0.6 s for 13 cards after the search, in Node; each line appears when it's ready.

## Decisions I made (⚠️ = our reading)
- ⚠️ Waiver ratings count trade value only when the move gives it up. Credited for gains too, Kamara's row read 27, mostly trade value.
- ⚠️ A rated row's drop is the best Helps you among the players the pickup outscores, when one can go, so no row reads "Doubs outscores him." Rows past the top 10 keep their 1,000-season Helps you.
- ⚠️ An offer can be another card of the list; it says "Also shown as trade idea N." rather than being left out. Each offer is strictly less good for you than the one before, even when the printed Helps you ties.
- ⚠️ A return week you set: 0 before it, 75% back that week, 100% after. "Expected back" also shows for a questionable player whose ESPN date the model follows, like Jacobs. Changing "Your team" clears return weeks set for the old team.
- ⚠️ The Analyzer's Last offer can add a player up to its 4 a side; the Trade Finder's stays within your max per side.

## Gate
- **Tests:** 283 files, 5,468 tests (1 skipped), typecheck, lint, build, leak check 0 hard hits (7d: 255 files, 5,202 tests).
- **check:browser** (live, your league today, 375 px): 162 passed, 0 failed, 2 skipped (a second league not asked; a prefetch Next had in memory).
  - The first run failed one check, the card's Copy. The fault was in the check: it tapped the first "Message to send them" in the card, which is now an offer's, inside the closed "How to offer it." I fixed the check, and the rerun passed.
  - Today: import 7.1 s (read by your browser), League page 1.7 s, search 6.4 s, "How to offer it" 0.2 s, an Analyzer evaluation 0.3 s. "Helps both" shows 3 ideas, and the now/after line shows on 5 cards.
  - Info: a "Things to know" banner, because your kicker Dominic Zvada is matched only by name, position and team.
- **`npm run prod:deploy -- --ref HEAD` on 38a1c8e** (read-only, nothing uploaded; this report's commit adds only files under reports/, which aren't deployed): all 14 checks ✅.
  - Clean copy: 483 files, 10.4 MB, byte for byte the commit, with the tag's own CSP and its 10 app pages. Vercel's dry run lists exactly the copy's files, and the leak check finds 0 hard hits.
  - Deployment Protection is Standard. Production's variables (names only) are all there.
  - The domain answers 200. The image optimizer answers 403. The cross-site rule answers 403 cross-site and 200 same-origin, and a page opened from another site gets 200.
  - Rollback target: offersheet-e50m4rlg3-parker-daniels.vercel.app (7d). Next 16.3.8 is the newest patch, and `.env.local` is unchanged.

## Deploying 7e, after your approval and your go (`reports/beta-infrastructure.md`, "A normal deploy")
```
npm run prod:deploy -- --checkpoint checkpoint-7e
npm run prod:deploy -- --live --checkpoint checkpoint-7e
npm run prod:deploy -- --verify --checkpoint checkpoint-7e
```
- Run the dry run (the first line) before the go, and the deploy (the second) after it.
- Use `--verify` only if a check after the deploy needs asking again; never run `--live` twice.
- Then reload any Offer Sheet tab you had open, and check the League page and a card on your phone.
- **Rollback:** Vercel → offersheet → Deployments → the 7d deployment the dry run names → ⋯ → Instant Rollback.

## Questions (numbered, each answerable in one line)
1. Parker: approve Checkpoint 7e so I tag `checkpoint-7e`? Production deploys it after your go.
2. Planner: the 12-team search runs about 10–11 s in the browser estimate. Accept that for now, or build the 0.3 s fix first?
3. Planner: waiver ratings count trade value only when the move gives it up. OK?
4. Planner: under 2.3, Pierce stays your week-7 release, because the near-tie rule keeps Harrison Jr. for his trade value. Keep that, or decide future releases on lineup points alone?

## How Parker can try it
- `npm run dev` (http://127.0.0.1:3001). On the League page: the lock icons, "Expected back" and Waivers' new rows and switch. On the Trade Finder: "How to offer it" and the now/after line.
- `npm run stable` keeps serving `checkpoint-7d` until 7e is tagged.
