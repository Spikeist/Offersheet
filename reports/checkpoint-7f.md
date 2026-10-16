# Checkpoint 7f — the planner's reply to Checkpoint 7e
Status: ✅ Done. Items 1–4 and 6 are built in the order listed, tested and reviewed; item 5 is a report with a proposed fix, not built. It was checked live on your league today (180 checks passed, 0 failed), and the production dry run passes every check. Nothing was deployed: production serves `checkpoint-7d` until your go.

## What changed
- **1 Speed:** each card's 20,000-season run now continues the same trade's 5,000-season ranking run, so only the other 15,000 seasons are played. Every number is the same, bit for bit. The trade context's baseline and calibration work the same way, and two duplicate baseline runs are gone.
  - **The fix alone** (on vs off, final code, Node, warm): the shown stage is 0.29–0.39 s shorter and context + search 0.33–0.39 s shorter on your four dumps. The planner's 0.3 s holds.
  - **Against 7e**, the merge's cost included (warm context + search, Node, Oct 14 → Oct 15 dumps):
    - your first league 7.05 → 6.67 s and 6.86 → 6.68 s;
    - your second league 7.86 → 7.38 s and 7.88 → 7.45 s.
  - **Your 12-team league's first search of a session:** 8.39 → 7.93 s in Node. That's about 10.4 → 9.8 s in the browser estimate (×1.24), just under the 10 s target on this computer. ⚠️ A mid-range laptop is slower.
- **2 Merged cards:** when an idea's "How to offer it" holds another idea below it on Overall, that idea leaves the list and stays only in the higher one's offers. The next idea takes its place, under the usual rules.
  - Your first league, Oct 15: 1 merge on the Overall list (13 cards either way) and 4 on "Helps both" (5 cards either way).
    - Nacua → Collins + McMillan (43 · 50%) is now the Open of Harrison Jr. + Nacua → Collins + McMillan (43 · 55%).
    - Team 4's Nacua → Kyren Williams + Mike Evans (59 · 20%) takes the freed place.
  - On Oct 14: 2 merges, 10 → 9 cards.
  - Your second league: 1 merge on "Helps both" (Oct 15), none on Oct 14.
  - **Pairs that stay labeled:** an idea whose offers hold an idea *above* it can't merge, because the higher idea's own offers don't include it (question 3):
    - Idea 3, Hall + Harrison Jr. → Evans (27 · 65%), opens with idea 2, Hall + Harrison Jr. → Evans + Gordon (54 · 35%).
    - On "Helps both", Nacua → London + Watson ends with Harrison Jr. + Nacua → London + Watson.
  - Cost: 0.01–0.25 s added to the search's last stage. The most is on your first league's Oct 15 data: 5 trades merged, 0.12 s of it working out their offers. The bar reads "Working out how to offer the ideas" meanwhile, and a merged search's bar now ends at 100%.
  - **Not merged:** under "Only the champion" on Oct 15, Nacua → Collins + McMillan (38 · 50%) shows next to the same trade plus Harrison Jr. (38 · 55%), which is at least as good on both numbers. Neither can be the other's offer, so nothing merges (question 3). Under your prizes they do merge.
- **3 Waivers:** each list shows only the rows that help, then "42 more pickups that don't help you (show)".
  - Oct 14 (the planner's numbers): 6 of 48 rows in your first league and 1 of 21 in your second.
  - Oct 15: 3 of 42 and 1 of 21.
  - A move your locks or the "Drop from the same position" switch block still shows, with how to make it. Only "No gain" rows fold.
- **4 Pierce:** a release the near-tie rule decides now says why.
  - Your League page's roster card has a "Returns from IR" block. On Oct 15 it reads the planner's sentence word for word: "Week 7, when Alec Pierce returns from IR: release him. He and Marvin Harrison Jr. are nearly even for your lineup, and Harrison Jr. has more trade value. Lock Pierce to keep him instead."
  - On the trade pages a release the trade changes says why, ending "Lock Pierce on the League page to keep him instead." (the lock is on the League page).
  - A release made with or without the trade is named in the card's "Assumed with or without this trade" line, without the reason, which is on the League page. On Oct 15, under your prizes, that's 9 of your 13 cards ("… release Alec Pierce in week 7, when he returns from IR."). Before the review it was a 214-character sentence, 12 times on one list.
  - No number moves.
- **5 Jacobs:** a breakdown and a proposed fix, not built (below).
- **6 The averaging test:** kickers and D/STs are left out (below).
- **Review:** a six-way review of the merged build found 28 issues (1 high, 3 medium). All are fixed or decided.
  - The high one was in the live browser check: its release reader read whole cards and would have failed on the app's own correct words.

## Jacobs's 41.6 points (5): a bug, mostly not the blend
Your second league, week 6. He's questionable, and ESPN expects him back in week 8. Same breakdown on Oct 14 and 15.
| Step | Value |
|---|---|
| His rate (points a game) | **3.61**, from Sleeper's week-7 projection of 2.89 ÷ 0.8 (the week-shape clamp). Healthy he's 9.78, Sleeper's weeks 8–17. |
| Why week 7 | Our rule for a questionable player reads his next projected week. Sleeper's 2.89 is its own expectation for a week he'll probably miss: 2.8 carries and 0.5 catches, against 11.5 and 1.5 in week 8. |
| Availability | 25% in week 7, 73% in week 8, then 86–94% (future injury risk), 0 on his week-11 bye: 8.0 games over weeks 7–17 |
| Points before the blend | 3.61 × his week shapes × availability = **30.8** |
| The blend | The market's value for him reads 10.9 points a game (9.7 on Oct 15). That's a factor of 2.01 (1.84), clamped to 1.35: 30.8 × 1.35 = **41.6** (61.9 without the clamp) |

- **The double count you suspected:** real but small for him today. With the rate fixed, reading the market curve at his healthy-equivalent value moves him +0.0 (Oct 14) and +0.5 (Oct 15). It was +7.7 on Oct 4, and it's 0–4 points for other injured players.
- **When it started:** he read 73–79 until Sleeper began projecting his week 7, between Oct 4 and 9. The same pattern hits Jonah Coleman (Team 4) and, more mildly, Alec Pierce.
- **Proposed fix (not built): "his first full week back."** For a player whose numbers follow a known return week (ESPN's or yours), the weeks before it don't set his rate or week shape. Nor do the hedged weeks from it on: those below 0.8 × his usual level before his first normal week. 0.8 is the week-shape clamp's own bound, not a new setting.
  - Jacobs: 41.6 → 82.7 (Oct 14) and 77.7 (Oct 15). For comparison: back for sure in week 8 he'd be 78.5, and healthy now 95.4.
  - Optional addition, 1a: the blend reads his value scaled to a healthy player's games, at most ×1.5: 82.7 / 78.2.

| Effect | As built | With the fix |
|---|---|---|
| Your second league's odds (playoffs / title) | 91.0 / 13.6% | 92.5 / 15.3% (Oct 14), 92.3 / 14.9% (Oct 15) |
| Your first league (he's Team 1's) | 62.2 / 9.2 / 28.2% (Oct 14) | 61.8 / 9.1 / 27.9% |
| Second league, Waivers season list | 21 rows, Jacobs the drop of 20 | 2 rows, both "No gain" |
| Second league, cards giving Jacobs away | 3 of 9 | 1 of 7 (Oct 14), 1 of 8 (Oct 15) |

- **Side effects:**
  - On your first league's Oct 15 data your week-7 release would become Romeo Doubs instead of Pierce. Team 1, with Jacobs at full strength, stops claiming two free agents, which raises the free-agent bar.
  - Players whose rate comes from before their injury, like Jadarian Price, fall about 11%.
  - No measurable cost.

## The averaging test (6): K and D/ST decide one reading of 12
12 readings: your first league on 8 days, Sept 30 to Oct 15 (Sept 30 rebuilt from Phase 0's captures), and your second on Oct 14 and 15.
| | Over the 10% bar |
|---|---|
| With K and D/ST (the test until now) | 5 of 12: first league Oct 9, 14, 15; second league Oct 14, 15 |
| Without them | 4 of 12: the four week-6 readings (10.6–11.1%) |

- **They decide one reading:** your first league on Oct 9 (week 5), 10.03% with them and 9.86% without. The kickers alone do it: 9.89% without them, 10.001% without the D/STs alone.
- ESPN projects nearly every kicker 0.9–1.7 points above Sleeper's line, scored by your rules, and most D/STs below it. Together they raise the gap on all 12 readings, by 0.15–0.89 points.
- **Built as the planner said:** they're left out of the test, and averaged like everyone once it passes. Week 6 is over the bar either way (its running backs run 14.9–15.7%), so today nothing moves. On Oct 9 it would have averaged 296 base rates, and your odds would have gone 51.2 / 7.1 / 21.2% → 51.2 / 7.5 / 21.8%.
- A gap at the bar now shows enough decimals to read right ("10.03%", never "10%, more than the 10% we allow").

## Decisions I made (⚠️ = our reading)
- ⚠️ A pair whose lower idea's offers hold the higher idea stays, labeled "Also shown as trade idea N.": the higher idea's ladder doesn't hold the lower one (question 3).
- ⚠️ A merged trade can still be another idea's offer. That happened in 3 of 46 synthetic cases, never on your lists. The planner wrote "only inside that card's offer list."
- ⚠️ The freed place goes to a fresh ranking under the usual rules, so an unrelated idea can leave. On Oct 14 Hall + Doubs → McMillan left: two newcomers give Hall.
- ⚠️ Waivers: moves your settings block show above the fold; the fold holds only "No gain" rows. While the season list is being rated, the fold uses the lineup gain.
- ⚠️ Pierce: a release made either way is named in the assumed line, with its reason on the League page. On trade pages the lock sentence says "on the League page".
- The reason names which player has more trade value in words, never a number, like "They come out ahead on trade value." The planner asked for it. This is within FantasyCalc's condition 4 as recorded.

## Gate
- **Tests:** 290 files, 5,596 tests (1 skipped). Typecheck, lint and build are clean, and the leak check has 0 hard hits. (7e: 283 files, 5,468 tests.)
- **check:browser** (live, your first league today, 375 px): 180 passed, 0 failed, 3 skipped.
  - Today: the import took 10.3 s (read by your browser), the League page 6.5 s, the search 6.0 s, "How to offer it" 0.2 s and an Analyzer evaluation 0.3 s.
  - The new checks, all passed:
    - your roster card's release line, with its reason;
    - 15 release lines on the trade ideas: 7 with a reason, 3 in the "Assumed" line;
    - the first idea's offers hold no idea below it;
    - every waiver list folds and unfolds with focus kept. "Rest of season" has 3 of 40 rows that help; week 6 is under way, so there's a "Next week" list too.
  - Info: the "Things to know" banner, as at 7e. Your kicker Dominic Zvada is matched only by name, position and team.
  - Skipped: a second league (not asked for); "Show all" (only 3 rows help); one prefetch check (Next already had the page in memory).
- **`npm run prod:deploy -- --ref HEAD` on f148937:** read-only, nothing uploaded. This report's commit adds only files under reports/, which aren't deployed. All 14 checks ✅:
  - the clean copy is 490 files and 10.7 MB, byte for byte the commit, and the leak check finds 0 hard hits in it;
  - Deployment Protection is Standard, and production's variables (names only) are all there;
  - the firewall's rules answer 403 on the image optimizer and cross-site API requests, and 200 same-origin;
  - the rollback target is offersheet-e50m4rlg3-parker-daniels.vercel.app, the 7d deployment production still serves;
  - Next 16.3.8 is the newest patch, and `.env.local` is unchanged.

## Deploying
- Production still serves 7d.
- `prod:deploy` deploys only the newest checkpoint tag. Once `checkpoint-7f` is tagged, 7e can't go out on its own. So either deploy 7e before approving 7f, or skip it and deploy 7f.
- 7f, after your approval and your go:
```
npm run prod:deploy -- --checkpoint checkpoint-7f
npm run prod:deploy -- --live --checkpoint checkpoint-7f
```
- Run the first command (the dry run) before the go, and the second (the deploy) after it.
- If a check after the deploy needs asking again, use `npm run prod:deploy -- --verify --checkpoint checkpoint-7f`. Never run `--live` twice.
- Then reload any Offer Sheet tab you had open, and check the League page and a card on your phone.
- **Rollback:** Vercel → offersheet → Deployments → the deployment the dry run names → ⋯ → Instant Rollback.

## Questions (numbered, each answerable in one line)
1. Parker: approve Checkpoint 7f so I tag `checkpoint-7f`? Production deploys it after your go.
2. Planner, Jacobs: build the fix ("his first full week back")? With 1a or without?
3. Planner, merged cards: three kinds of pair stay on the list. Merge which?
   - (a) Idea 3 opens with idea 2, a bigger ask: allow a smaller ask after the suggested trade? That's a new kind of offer.
   - (b) On "Helps both", the higher idea could hold the lower one as a Then, but its ladder picked another version on the 1,000-season screening: should a ladder prefer an idea of the list when its rules allow it? Ladders would then depend on the list.
   - (c) Under "Only the champion", a smaller trade shows below its bigger version, which is at least as good on both numbers: drop it like filler?
4. Planner, averaging: leave questionable players out of the test too? Their ESPN numbers never reach a base rate.
   - Leaving them out puts both leagues under the bar today (9.91%, 9.74%) and turns averaging on.
   - Your odds would move 58.5 / 7.8 / 24.9% → 60.6 / 8.9 / 27.2% in your first league, and 91.1 / 13.7% → 90.4 / 13.2% in your second.
5. Planner, Pierce's sentence: "nearly even for your lineup" sits above a roster table showing 62 vs 26 rest-of-season points. Is "for your starting lineup from week 7 on" OK?

## How Parker can try it
- `npm run dev` (http://127.0.0.1:3001): Waivers' fold, the League page's "Returns from IR", merged cards on the Trade Finder.
- `npm run stable` serves `checkpoint-7e` (tagged today) until 7f is approved and tagged.
