# Checkpoint 7g — the planner's reply to Checkpoint 7f
Status: ✅ Done. All six items are built in the order listed, tested and reviewed. Checked live on your league today (174 checks passed, 0 failed), and the production dry run passes every check. Nothing was deployed: production serves `checkpoint-7f` until your go.

## What changed
- **1 Jacobs ("his first full week back", without 1a):** a player's numbers can follow a known return week (ESPN's, or one you set). For him, the weeks before it no longer set his rate or week shape. Nor do the hedged weeks right after it, the ones below 0.8 × his usual level. Results below.
- **2 Merged cards:** the three kinds of pair the planner named now merge where the rules allow.
  - (a) A Last offer can ask for fewer of their players. It must be at least 5 points likelier and keep at least 80% of the card's Overall (unrounded). Of it and the throw-in, the one with the higher Overall wins.
  - (b) Where more than one version meets a step's rules, a card's ladder prefers an idea of its list below it, so that idea merges.
  - (c) A version at least as good on both Helps you and the chance (as printed) as another version of the same trade drops that version.
  - How to read says all three. A Plan B box is never a smaller ask its card's Last offer could take.
  - Cost: working out the offers of ideas that can merge takes 0.06–0.13 s more per search (Node, warm). Whole searches moved within their ±0.1 s run-to-run noise. Today's live search took 6.5 s.
- **3 The averaging test:** questionable, doubtful and probable players are left out too.
  - It's over the 10% bar on 2 of 12 saved readings, down from 4: Oct 14, both leagues (10.44%, 10.28%).
  - Oct 15 is now under it in both leagues (9.91%, 9.74%), so ESPN's projections are averaged in there.
  - For Phase 6, CLAUDE.md explains what the test protects against and proposes a gradual version: ESPN's weight fades from 50% at a 9% gap to 0 at 11%, instead of switching about 290 base rates at 10%.
- **4 Pierce's sentence:** the planner's words, wherever a release says why: "From week 7 on, he and Marvin Harrison Jr. add about the same to your starting lineup, and Harrison Jr. has more trade value."
  - It reads word for word on your first league, Oct 14, under "Only the champion".
  - On Oct 15 that league releases Romeo Doubs instead, a side effect of item 1: with Jacobs at full strength, Team 1 stops claiming two free agents, so the free-agent bar W rises from 419 to 522.
- **5 Screenshots:** four, at 375 px (below).
- **6 CLAUDE.md:** Section 20 has the "Later" list: other fantasy sports (basketball first), and a separate best-value bets project. Neither starts until Offer Sheet is where you want it.
- **Reviews:** a review of the first three build tracks (items 1 and 3–5), fixed. Then a final review of the whole build: 31 findings (7 medium, 24 low), each fixed in code, tests or CLAUDE.md, or ruled on (Decisions, below). None of the fixes moved your numbers.

## Jacobs after the fix
Your second league, where he's yours. Week 6 dumps. Oct 14 is item 1 alone; Oct 15 also has item 3's averaging on.
| | Checkpoint 7f | 7g, Oct 14 | 7g, Oct 15 |
|---|---|---|---|
| His rest-of-season points (regular / playoffs) | 41.6 (27.5 / 14.1) | **82.7** (54.9 / 27.8) | **78.5** (52.1 / 26.4) |
| His rate, points a game before the market blend | 3.61 (week 7's hedge) | 9.78 (from week 8) | 9.78 |
| The blend's factor | 1.35 (capped) | 1.06 | 1.00 |
| Your odds there (playoffs / title / top 3) | 91.00 / 13.62 / 40.37% (Oct 14), 91.06 / 13.68 / 40.52% (Oct 15) | 92.52 / 15.32 / 43.45% | 91.85 / 14.55 / 42.06% |
| Your first league, where he's Team 1's (playoffs / title / top 3) | 62.24 / 9.21 / 28.16% (Oct 14), 58.48 / 7.84 / 24.89% (Oct 15) | 61.83 / 9.14 / 27.93% | 60.57 / 8.93 / 27.20% |
| Waivers, "Rest of season" | 21 rows, Jacobs the drop of 20; 1 helps (RJ Harvey for Jacobs) | 2 rows, none help | 1 row, doesn't help |
| Cards that give Jacobs away | 3 of 9 both days, and 1 of 3 "Helps both" on Oct 15 | 1 of 7 | 1 of 8, and 1 of 7 "Helps both" |

- **The cards:**
  - Oct 14: Josh Jacobs + Rome Odunze → Ollie Gordon II (3 · 50% · 1), which opens with Josh Jacobs → Ollie Gordon II (17 · 30% · 5).
  - Oct 15: Carnell Tate + Josh Jacobs → DJ Moore (19 · 15% · 4), on both lists.
- **Waivers, "This week" (week 6, which he misses):** the drop is whichever of your running backs the lineup misses least over the season. That's Woody Marks on Oct 14 (26 of 31 rows) and Jacobs on Oct 15 (24 of 31). At 7f it was Jacobs on 27.
- **Oct 15 mixes two changes.** The fix alone there:
  - second league 90.41 / 13.24 / 39.65% → 91.85 / 14.55 / 42.06%;
  - first league 60.62 / 8.90 / 27.16% → 60.57 / 8.93 / 27.20%.
- **Other players** (league 1, Oct 15, the fix alone): Pierce 62.2 → 65.1 rest-of-season points, Jonah Coleman 30.6 → 36.9, Jadarian Price 64.3 → 57.4, Jalen Hurts 167.3 → 168.6.

## The merges on your lists
Item 2's own effect: the code without item 2 → with it, Helps you · chance · Overall.
- **First league, Oct 14, your prizes:** Overall 10 → 9 cards.
  - (b) Idea 2, Nacua → Collins + McMillan (45 · 50% · 27), is now the Open of idea 1, Harrison Jr. + Nacua → Collins + McMillan (45 · 55% · 28).
  - Hall → Evans + Gordon stays merged into idea 2, as at 7f.
  - "Helps both": (c) drops Hall → Watson (50 · 10% · 7) for Hall + Harrison Jr. → Watson + Goedert (50 · 15% · 10). That card's Last offer is now the smaller ask, → Watson (40 · 25% · 11).
- **First league, Oct 15, your prizes:** Overall 12 → 10.
  - (c) drops Nacua → Collins + McMillan (44 · 50% · 25) for Harrison Jr. + Nacua → Collins + McMillan (45 · 50% · 26). This is the planner's (c) example; neither could be the other's offer, since both print 50%.
  - Monangai → Pollard + Corum merges into Monangai → Pollard as its Open.
  - Hall → Evans + Gordon stays merged.
- **"Only the champion", both days:** (c) drops the same Nacua pair.
- **The planner's (a) example, Oct 15, "Only the champion":** idea 3, Hall + Harrison Jr. → Evans (26 · 60% · 17), opens with idea 2, the same + Ollie Gordon II (49 · 35% · 22). As idea 2's Last offer it would keep 75.9% of idea 2's Overall, under 80%, so both stay, labeled (question 2).
  - Under your prizes it's idea 2's Plan B box (25 · 60% · 15, 70.9%).
- **Second league, Oct 14:** (b) idea 2, Hall + Mahomes → Washington + Montgomery (50 · 65% · 36), is now the Open of idea 1, the same with Monangai (49 · 70% · 37). Oct 15: nothing merges.
- **In all**, on your six runs at 2 a side (four dumps, both settings on league 1): merges 4 → 7, labeled pairs 2 → 1 (the planner's (a) pair), 4 versions dropped, a smaller-ask Last offer on 1 card, 89 → 85 cards. At 3 a side (first league, Oct 15): 1 more version dropped, smaller-ask Last offers on 2 cards, 12 → 11 cards.
- The planner's (b) pair from 7f (Nacua → London + Watson on "Helps both", Oct 15) no longer arises: items 1 and 3 changed that list, and the card now ends with no Last offer.

## The screenshots: what already looks crowded
In `reports/checkpoint-7g-screenshots/`. They were taken live today, Monday Oct 19, with week 6 under way. The browser was fresh, so the settings are "Only the champion". Each shot is cut into images of under two phone screens; names are placeholders. Nothing was redesigned, as asked.
- **clutter-1, the Trade Finder** (15 images, 26.0 phone screens for 10 ideas):
  - **Before the first idea:** 1.6 screens. The intro, "Best time to look", the freshness line, the Analyzer link, three menus, your odds with two explanation lines, and the pattern note.
  - **Each idea:** about 1.8–2.2 screens closed, 2.5–2.8 with a Plan B box (idea 1: 2.5, 2,070 px). Measured off the images, at check:browser's 812 px a screen.
  - **Lines repeated on every idea:**
    - "Assumed with or without this trade: add Carnell Tate, drop Romeo Doubs, release Alec Pierce in week 7, when he returns from IR." (the League page's pickup and Pierce's release) is on all 10 ideas and all 5 Plan B boxes.
    - "These numbers weigh each player's trade value. Values: FantasyCalc" appears 10 times.
    - The four outcome buttons and "Report a problem" appear 10 times.
  - **"Why":** 5–8 bullets each, mixing your gains, their view and the costs.
  - **Plan B boxes repeat:** ideas 1 and 3 show the same box, and so do ideas 9 and 10. Ideas 9 and 10 differ only by David Montgomery vs Kyle Monangai.
  - **A Plan B box is nearly a card of its own** (about 0.8 screens): three numbers, odds, a weekly line, roster moves, a message and an Analyzer link.
- **clutter-2, idea 1 with everything opened** (3 images, 4.3 screens): four messages to send (the Open's, the suggested trade's follow-up, the card's own and Plan B's). The card's own message sits under a line that says to send the Open's first. The "Assumed" line shows three times (the Open, the card and its box).
- **clutter-3, the League page** (10 images, 17.7 screens):
  - **Long explanations in the body:** under your remaining games (8 lines), under trade partners (13 lines), Waiver upgrades' note (11 lines), streaming (9 lines) and the standings' notes (6 lines).
  - **The positional-strength grid is wider than the phone:** the columns from WR2 on scroll sideways inside the card.
  - **Trade-chip pills:** a team can carry three, each 2–3 lines with tags.
  - **Your roster:** each injured player has an "Expected back" menu (four today).
  - **Best available:** 30 players.
- **clutter-4, Waivers** (2 images, 1.9 screens): the first row starts about 665 px down, after the intro, the switch with two help lines, the list toggle and the 11-line note. Below that it's compact: 3 rows, then the fold.

## Decisions I made (⚠️ = our reading)
- ⚠️ (a) The 80% is read on the unrounded Overall; the printed whole numbers would let 79.5% pass.
  - The throw-in keeps its own rule, B ≥ 80% of the card's, which already keeps 80% of its Overall.
  - Held to the Overall bar instead, 26 of 878 cards in the 75 searches checked would gain a Last offer and 3 would swap theirs for a likelier one worth much less to you. 8 of your cards' Last offers would change, but none of your lists.
  - A tie in Overall goes to the throw-in.
- ⚠️ (a) A Plan B box is never a smaller ask the card's Last offer could take, so the box and the Last offer never show one trade twice. A card can then be left with no box (synthetic leagues only).
- ⚠️ (b) The preference has these rules:
  - Only ideas that hold no merged trade are preferred; preferring one that does would break up its plan.
  - The preferring ladder is kept only when it holds more preferred ideas than the usual one.
  - The preference is fixed per card, search and minimum chance. That missed 1 merge in the 75 searches checked (a synthetic league).
  - A card that helps both teams but isn't on "Helps both"'s first ranking doesn't prefer that list's ideas.
- ⚠️ (b) The Analyzer's card is on no list, so it prefers nothing, and its ladder can differ from the Trade Finder's. Your first league, Oct 14: idea 1 opens with idea 2's trade on the Trade Finder, but offers itself as it is in the Analyzer.
- ⚠️ (c) reads the chance as printed ("<5%" counts below 5%). If the version that beat a dropped version leaves the list, the dropped one is pointed at another version that beats it, else it comes back. Coming back never happened in 687 searches; a test pins it.
- ⚠️ Item 1:
  - R can be this week: a week you set earlier that has become this week.
  - A lookback week is never left out.
  - A bad matchup in the first week back reads as a hedge too. Zach Charbonnet's sits at 0.805 of his usual: kept, by a hair.
- ⚠️ Item 3: a tagged kicker or D/ST is left out as a tagged player.
- The release reason names which player has more trade value in words, never a number, as at 7f.

## Gate
- **Tests:** 298 files, 5,715 tests (1 skipped). Typecheck, lint and build are clean, and the leak check has 0 hard hits. (7f: 290 files, 5,596 tests.)
  - A log test had failed on every tree since Oct 18: its line dated Oct 4 aged past 14 days. Lines are now kept by their own time.
- **check:browser** (live, your first league today, 375 px): 174 passed, 0 failed, 6 skipped.
  - Today: the import took 10.4 s (read by your browser), the League page 7.5 s, the search 6.5 s, "How to offer it" 0.2 s and an Analyzer evaluation 0.3 s.
  - The new checks passed. No idea is a version of another at least as good on both numbers (10 ideas read). The first idea's offers hold no idea below it. Each Last offer's shape is checked; the first idea had none today.
  - Info, not failures:
    - blocked-kick return touchdowns (+6) have now scored this season, so that uncounted rule is a notice in "Things to know" instead of a quiet line;
    - your kicker Dominic Zvada is matched only by name, position and team, as at 7f.
  - Skipped (nothing to check today, or not asked for): the partner's odds line twice (no idea in the Overall sort helps both), "This week"'s waiver rows (week 6 is under way), "Show all" (3 rows), a prefetch check, and a second league.
- **`npm run prod:deploy -- --ref HEAD` on 8b6557b:** read-only, nothing uploaded. This report's commit adds only files under reports/, which aren't deployed. All 14 checks ✅:
  - the clean copy is 496 files and 10.9 MB, byte for byte the commit, and the leak check finds 0 hard hits in it;
  - Deployment Protection is Standard, and production's variables (names only) are all there;
  - the firewall answers 403 on the image optimizer and on cross-site API requests, and 200 same-origin;
  - the rollback target is offersheet-5o2i7zpot-parker-daniels.vercel.app, the 7f deployment production serves now;
  - Next 16.3.8 is the newest patch, and `.env.local` is unchanged.

## Deploying
- Production serves 7f, which includes 7e.
- After your approval (tag `checkpoint-7g`) and your go:
```
npm run prod:deploy -- --checkpoint checkpoint-7g
npm run prod:deploy -- --live --checkpoint checkpoint-7g
```
- Run the first command (the dry run) before the go, and the second (the deploy) after it.
- If a check after the deploy needs asking again, use `npm run prod:deploy -- --verify --checkpoint checkpoint-7g`. Never run `--live` twice.
- Then reload any Offer Sheet tab you had open, and check the League page and a card on your phone.
- **Rollback:** Vercel → offersheet → Deployments → the deployment the dry run names (7f's) → ⋯ → Instant Rollback.

## Questions (numbered, each answerable in one line)
1. Parker: approve Checkpoint 7g so I tag `checkpoint-7g`? Production deploys it after your go.
2. Planner, (a)'s bar: the planner's own example keeps 75.9% of idea 2's Overall, so at 80% it stays labeled. Keep 80%, or 75%? At 75% it merges, and your merges go 7 → 9.
3. Planner, (a): a smaller ask can print a higher Overall than its card, as a throw-in could before. Your first league's "Helps both" idea 1 on Oct 14 (50 · 15% · 10) ends with one at 40 · 25% · 11, 114% of its Overall. Fine as a Last offer?
4. Planner, (b) as worded: a card takes an idea of its list where it fits, even when another version helps you more or, as its Last offer, has a higher Overall. In 1 of 81 synthetic Last offers that meant 81 · 10% · 16 instead of 91 · 10% · 18; none of yours. How to read says it can happen. OK?

## How Parker can try it
- `npm run dev` (http://127.0.0.1:3001): Jacobs on your second league's League page; the merged and dropped ideas on the Trade Finder; Pierce's line on your first league's roster card.
- `npm run stable` serves `checkpoint-7f` until 7g is approved and tagged.
