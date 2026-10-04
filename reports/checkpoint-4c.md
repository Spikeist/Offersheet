# Checkpoint 4c — The planner's reply to Checkpoint 4b
Status: ⚠️ Done with issues. All 12 changes in `planner-reply-4b.md` are built, adversarially reviewed and run on your league (data from Sunday Oct 4, 09:24 UTC, before Sunday's first kickoff; weekly reset waiver order). Three planner questions came out of the numbers (questions 1, 2 and 5).

## What changed
1. **Search gap (§12):** every 1-for-2, 2-for-1 and top-6 2-for-2 per partner, on top of the beams; 60 finalists.
2. **Neutral throw-ins (§9):** a player worth at most W on the side giving more players leaves both totals with his roster-spot credit. ⚠️ Ours:
   - Matched pairs of such players (one per side) leave too.
   - Every exactly evaluated trade with one also gets its lean version (the same trade without him) evaluated.
   - The filler rule drops the bigger version when the lean one ranks above it and helps about as much.
3. **One value number (§13):** cards, reasons and pitch use FantasyCalc's own values ("By FantasyCalc's trade values, they get 18% more…"). The pitch mentions value from +5% (⚠️ still at most 25%). The model's figures sit under "Details" in the Analyzer.
4. **Blend cap (§6):** f clamped to [0.75, 1.35].
5. **Waiver order (§2.2, §7):** weekly reset (reverse standings). The Import Report shows "Waiver order used: Weekly reset (reverse standings)". You claim 4th, not 10th.
6. **Pattern note (§13):** it shows on your list (below).
7. **Feedback (§11):** each outcome stores the sent version's acceptance features. Its g is the partner's perceived g (star premium included), plus n, h, c, a, hist, ctx, hot, urg and z; its g without the premium is stored too (the premium is the difference), along with B and the goal.
8. **What matters most (§10):** Win the title (default) / Balanced / Make the playoffs.
9. **Real odds (§13, §14):** "Title odds 10.5% → 12.5% · Playoff odds 60% → 63%" and the weekly line on every card, Plan B box and Analyzer result. One baseline: the League page headline is every card's "before", with "As rosters stand" as its second line.
10. **Minimum chance (§13):** "Chance they accept: at least" Any/10–50%, default 10%, per league. It applies before the caps and re-filters in 11–38 ms without a new search. With fewer than 5 cards it suggests a lower setting when one would show more. Chances under 5% print "<5%".
11. **Multiple leagues (§3, §14):** saved in IndexedDB, a switcher on every page, Add/Remove, Sleeper multi-pick. The migration moves your team pick, settings and feedback; your 4b import itself asks to be imported again (the format is now 4).
12. **FantasyCalc resilience (§2.9):** a saved list of up to 7 days stands in, with a "values from <date>" note. After that, our own curve with a banner, plus an outage back-off. DynastyProcess is GPL-3.0: kept server-side, with a license review before any download (§19, Phase 7).

Lead decisions (⚠️, in CLAUDE.md):
- An offer-first version must also meet your minimum chance.
- "Protect my trade value" is off while values are our own estimates.
- A streamed K or D/ST's bye doesn't count toward a risky week.
- On a lineup near-tie (within 0.2 pts/wk), a forced or free-agent cut takes the cheaper player.
- A free-agent move of yours that a trade's numbers count on (one the baseline doesn't make) is named on its card. It counts in the model's trade value for your side, not in the FantasyCalc line.
- When a card's offer-first step (or its full version) is another card, the lower-ranked of the two leaves the list.
- The "Helps you" line adds "or plus a credit for gaining it" to the planner's sentence, since the redraft market term works both ways.
- The weekly line lists drops first, then the largest gains.

## Your top 10 under "Win the title"
Baseline 59.9% playoffs / 10.5% title. Odds are before → after. Weekly lines show up to 4 of the weeks moving 3+ points, drops first, as the cards print them.

| # | Trade (you give → you get) | Helps / Chance / Overall | Title | Playoffs | Win chance by week |
|---|---|---|---|---|---|
| 1 | T8: Wilson → Christian Watson + Carnell Tate | 22 / 55% / 13 | → 12.5% | → 63% | Wk 12: 53→49 · Wk 13: 42→52 |
| 2 | T9: Nacua → Zay Flowers (Q) + Omarion Hampton | 40 / 25% / 12 | → 13.3% | → 66% | Wk 8: 60→65 · Wk 11: 63→74 · Wk 13: 42→39 · Wk 14: 49→53 |
| 3 | T4: Wilson → Chuba Hubbard + Mike Evans (Q) | 30 / 35% / 12 | → 12.4% | → 65% | Wk 13: 42→50 |
| 4 | T1: Wilson → Davante Adams + Josh Jacobs (Q, ESPN wk 8) | 26 / 40% / 11 | → 12.5% | → 64% | Wk 9: 48→52 · Wk 11: 63→57 · Wk 13: 42→50 · Wk 14: 49→55 |
| 5 | T1: Nacua → D'Andre Swift + Adams | 28 / 35% / 11 | → 12.5% | → 65% | Wk 5: 55→62 · Wk 10: 60→57 · Wk 11: 63→66 · Wk 14: 49→53 |
| 6 | T7: Nacua → Javonte Williams + Parker Washington | 40 / 20% / 10 | → 13.3% | → 65% | Wk 7: 47→42 · Wk 8: 60→65 · Wk 11: 63→74 · Wk 14: 49→45 |
| 7 | T9: Bowers → Flowers (Q) + Dalton Kincaid | 42 / 15% / 7 | → 13.1% | → 68% | Wk 6: 55→63 · Wk 10: 60→64 · Wk 11: 63→66 · Wk 14: 49→54 |
| 8 | T6: Kyle Monangai → Jadarian Price (IR, wk 8) | 23 / 20% / 5 | → 11.2% | → 62% | Wk 13: 42→46 |
| 9 | T6: Bo Nix → Jadarian Price (IR, wk 8) | 13 / 30% / 4 | → 11.1% | → 60% | none |
| 10 | T4: Bowers → Trey McBride + Evans (Q) | 27 / 15% / 4 | → 11.6% | → 64% | Wk 10: 60→63 · Wk 12: 53→56 · Wk 13: 42→53 · Wk 14: 49→44 |

- **Next steps:** Plan B on 4 of the top 10 (#1, #6, #8, and #9's "add Monangai, 7 / 50% / 4"). Offer-first steps on 0 of the top 10 (1 of 14 cards).
- **Injury tags:** 7 of the top 10 receive an injury-tagged player: 4 Questionable this week, Jacobs (Questionable, ESPN wk 8), and Price on IR twice.
- **Pattern note:** "Most of your best ideas trade Garrett Wilson: his bye is in week 13, your riskiest week. The list shows 3 ideas that trade him, to make room for other ideas." (7 of the uncapped top 10.)

## Balanced → Win the title
8 of the top 10 are in both lists. Under "Win the title" B is a median 0.79× B under Balanced (Helps you about 0.84×), because these trades raise playoff odds more than title odds.
- Watson + Tate: Balanced #4 → title #1.
- Hubbard + Evans: #1 → #3.
- Swift + Adams: #3 → #5.
- Bowers → McBride + Evans: #8 → #10.
- J. Williams + P. Washington and Nix → Price enter; Nacua → Flowers + Bucky Irving and Monangai → DK Metcalf leave.

## Search gap
- **Found:** Wilson → Hubbard + Evans is screened #1 of Team 4's 1,783 candidates and shows as card #3 (30 / 35% / 12). The beams alone never screen it.
- **Funnel:** 17,215 screened (beams alone 13,603), 206 evaluated exactly, 60 finalists, 14 cards (beams alone 13). The exhaustive candidates alone produce 6 of the 14 cards.
- **Runtime** (Node, warm): screening 2.45 s, exact 1.46 s, simulations 0.53 + 0.71 s, steps and words 0.23 s; 5.6 s with the context, cold 5.7 s. In the production browser worker: 5.4 s (live data during Sunday's games, 17,612 screened).
- **Why not 25 cards:** the 206 exact trades give a helping trade to only 7 of your players, so the given-player cap binds first (38 trades dropped by it). A per-player cap on the exact pool was tried on the earlier 00:51 UTC data and rejected: it reached 24 cards only by swapping a top-10 card for a worse one.

## Blend: the 10 most extreme factors before the clamp
193 players are blended. f before the clamp runs 0.842–1.595 (median 1.00), and the clamp cut 2. None of the 10 has a fallback base rate; 8 have no data flag (healthy, both projections, 3 games), so they're real disagreements with the market.

| Player | f | Ours / market (pts a game) | Scored so far | Reason |
|---|---|---|---|---|
| Jordyn Tyson | 1.595 → **1.35** | 4.1 / 9.0 | – | On IR, rookie age 22, no game yet; Sleeper alone |
| Marvin Harrison Jr. | 1.372 → **1.35** | 4.8 / 8.5 | 3.1 | Below both numbers |
| Tank Bigsby | 1.316 | 3.3 / 5.5 | 3.4 | At our number |
| Mike Washington Jr. | 1.313 | 3.5 / 5.7 | 5.4 | At the market's number |
| Kyle Pitts Sr. | 1.213 | 5.5 / 7.8 | 1.0 | Below both |
| Kayshon Boutte | 1.201 | 4.3 / 6.1 | 3.6 | Below both |
| Emanuel Wilson | 0.842 | 7.7 / 5.3 | 3.6 | Below both; we're the high side |
| Kaelon Black | 1.185 | 4.2 / 5.7 | 3.9 | At our number |
| Zay Flowers | 0.858 | 18.2 / 13.0 | 18.2 | Questionable; at our number |
| Tyler Warren | 1.163 | 8.9 / 11.8 | 10.1 | Between, nearer ours |

## Odds on the one shared baseline
| Baseline | Your place | Your pickups | Playoffs | Bye | Title | Exp. wins |
|---|---|---|---|---|---|---|
| **With every team's pickups, weekly reset order (the headline)** | 4th | +Malik Washington −Harrison | 59.9% | 13.2% | 10.5% | 6.93 |
| As rosters stand (the second line) | – | – | 65.0% | 16.6% | 12.0% | 7.15 |
| With pickups, ESPN's live order (4b's) | 10th | none | 58.3% | 12.2% | 9.8% | 6.87 |

- The trade search's baseline equals the League page's headline exactly.
- Week 13 is your one risky week: 42%, with Hall, Wilson and Bowers on bye.

## Multiple leagues
- **Migration:**
  - In tests on a fake IndexedDB, a browser with 4b storage moves every league's settings and all feedback once, plus the tab's team pick. The old keys stay untouched.
  - Since the format is now 4, a 4b import reads "Offer Sheet was updated" with a one-click "Import again".
  - It ran once in headless Chrome on the production build during the final review, from a profile seeded with 4b storage. "Import again" was offered; settings, feedback and the team pick moved in; the old keys were kept. That was before the review's last fixes, and not yet on your own browser.
- **Switching** (`npm run check:browser -- --team 3 --second-league`): 80 of 80 checks passed on the final code.
  - Adds the public ESPN test league through "Add league".
  - Each page shows it with its own settings and feedback.
  - Switching back restores yours.
  - A partner picked on one league's Finder doesn't carry over.
  - Removing the league from a trade page deletes only its data.

## Anything else that looks off
Under "Win the title" the planner's B_ref premise doesn't hold: a uniform gain moves ΔPO about twice as much as ΔCH, so the same trade's B reads about a fifth lower (question 1). The waiver credit W ([value]) is Justin Herbert, whom the baseline predicts Team 4 claims; with the best unclaimed free agent (491) the top card's chance would be 51%, not 55% (question 2). In week 11 the pickup baseline has Team 6 adding Baker Mayfield and Kenny Gainwell now for its bye, so your win chance that week reads 63% instead of 84%. The headline moves at a week's first kickoff (on today's data 0.7 playoff points for one team; yours don't move). Two of your players each worth less than W, for one player worth their sum and more than W, read as a value gain in the model's figures (no card shows this). The list during Sunday's games (17:08 UTC, the browser check's live import) shows 11 cards, led by Nacua → Adams + Swift (34 / 35% / 14). A verification script once ran the trade report live by accident, one extra public-link fetch of your league.

## Numbers
- **Gate:** 3,394 tests in 187 files pass; typecheck 0, lint 0, `next build` OK; leak check 0 hard hits.
- **Acceptance anchors:** 15 of 15 within ±0.5.
- **B_ref check:** with uniform gains from the one baseline, weeks 5–17:

| Gain | ΔPO / ΔCH | Win the title B (Helps) | Balanced | Make the playoffs |
|---|---|---|---|---|
| +1 pt/wk | +3.1 / +1.3 | 1.60 (23) | 1.94 (28) | 2.54 (35) |
| +3 pt/wk | +9.1 / +4.2 | 4.97 (56) | 5.94 (63) | 7.63 (72) |
| +6 pt/wk | +17.4 / +9.4 | 10.61 (83) | 12.20 (87) | 14.98 (92) |

The B_ref that keeps +3 at 63: Win the title 5.0, Balanced 6.0, Make the playoffs 7.7.

## Questions
1. B_ref under "Win the title": keep 6, where the same trade's B reads about a fifth lower than under Balanced (Helps you 56 against 63 at +3 pts/wk), or use 5 for that goal?
2. The waiver credit W: keep the best free agent on the wire (615), or use the best one no team is predicted to claim (491)?
3. Our additions to the throw-in rule: keep them? They are matched pairs, lean versions, and Plan B boxes that never offer a shown card plus players who don't make it 5+ points likelier, nor a trade a card with that partner beats on both numbers.
4. The lead decisions above: OK?
5. 7 of the top 10 receive an injury-tagged player, mostly Questionable for this week only: fine as is?

## How Parker can try it
Start the app, then reload any open Offer Sheet tab. Your old import will say "Offer Sheet was updated"; press **Import again**, and your team, settings and feedback come along.
```
cd "D:\Source Code\VS Code\fantasy-trade-finder"
npm run dev
```
Then open http://127.0.0.1:3000.

To regenerate the reports:
```
npm run trade:report -- --offline data-local/parker-league-4c --team 3
npm run league:report -- --offline data-local/parker-league-4c --team 3
```
