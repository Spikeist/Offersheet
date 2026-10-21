# Checkpoint 7h — the planner's reply to Checkpoint 7g
Status: ✅ Done. All six sections and the three answers are built, reviewed twice and fixed. Checked live on your league today (203 checks passed, 0 failed), and the production dry run passes every check. Nothing was deployed: production serves offersheet-23d7wdmgp, the deployment after 7f's (your 7g deploy, I take it), until your go.

## What changed
- **1 Less clutter.** Trade cards are closed by default. A closed card shows what you give and get, the three numbers, its tags, small risk pills and one reason, then two buttons:
  - **Details:** the odds lines, weekly lines, roster moves, other reasons, the timing line, the feedback buttons and "Open in Analyzer".
  - **How to offer it:** the offers in order, the first offer's message open and the others closed, then Plan B.
  - "Assumed with or without a trade" is said once, above the list. A Plan B several ideas share shows only on the highest one.
  - "Trade idea N" moves onto the heading's line when it fits, and the card's spacing is trimmed: 12 px between ideas, 8 px above the numbers and buttons.
  - The League page's long notes are one line each with a "Why?". The team table, the heatmap, Best available and your roster card open on a tap.
- **2 The search against a brute force** (`npm run trade:report`, new section 12). The cheapest fix it pointed to is built: the get pool now holds each partner's IR players, which found the brute force's best trade (below).
- **3 Thorough search:** a switch on the Trade Finder, off by default. It shows "Takes about N seconds" before it starts, then the progress bar and Stop. Its ideas stay for the visit, like a normal search's, and the tab remembers the switch.
- **4 What if** in the Analyzer: take players off your roster and put any players on, from any team or free agency. You get Helps you, the odds lines and the weekly lines, with "Other teams don't change. To see a real trade, use the Analyzer with a partner."
- **5 Waiver rows** on "Rest of season" show the odds lines in their Details, from the same run as their Helps you. "This week" stays in points.
- **6 The draft assistant:** its spec is in CLAUDE.md as Phase 8, and `reports/draft-data.md` has the data check (below).
- **Answers:**
  - A smaller-ask Last offer needs 75% of the card's Overall.
  - A Last offer with a higher Overall than its idea is promoted: it becomes the idea, and the original becomes its "Open with".
  - An idea of the list is preferred only within 3 points of Helps you.
- **Reviews:** two reviews of the merged build found 19 defects (8 and 11). All are fixed, and a second agent checked each fix. The main ones:
  - A Thorough search could skip trades the normal search evaluates. It now evaluates and plays out every one of them.
  - A promoted idea lost its "now or after this week" line.
  - Coming back from the Analyzer didn't reopen the panel you'd used.
  - "Search again" stopped the Thorough switch from bringing back kept ideas.

## The clutter (screenshots in `reports/checkpoint-7h-screenshots/`; before: `reports/checkpoint-7g-screenshots/`)
Live on your first league at 375 px, names replaced by placeholders. Today is week 7, and the settings are "Only the champion" (a fresh browser).
| | 7g (Oct 19) | 7h (today) |
|---|---|---|
| Trade Finder, cards closed | 26.0 phone screens for 10 ideas | **7.7** for 11 |
| Ideas a phone screen, cards closed, your league's real team names | about 0.4 | **2.01** (goal: at least 2) |
| The first idea with everything opened | 4.3 | **1.9** |
| League page | 17.7 | **9.6** (9.1 of content; goal: about 8) |
| Waiver upgrades | 1.9 | 2.3 |

- **2 ideas a screen: met, narrowly.** Most of your team names are too long to fit beside "Trade idea N" (it fits on 1 of 11 ideas today), so the card's spacing was trimmed as well. With short placeholder names it's 2.13–2.21 on your dumps.
- **The League page** is 7.3–8.3 screens of content on the Oct 14 and 15 dumps. Today it's 9.1 because 8 waiver pickups help (2 did on Oct 15) and a "Things to know" banner shows (question 2). That's also why Waivers grew today.

## The search test (section 2; your Oct 15 dumps)
Of the brute force's top N by Overall, how many the normal search evaluated / showed (as a card, among a card's offers, or dropped for a better version it shows):
| League, setting | top 10 | top 25 |
|---|---|---|
| First, your prizes | 7 / 5 | 14 / 6 |
| First, Only the champion | 9 / 7 | 16 / 8 |
| Second | 4 / 3 | 9 / 3 |

- **The best trade it missed** was the brute force's #1 on your first league, before the fix: Alec Pierce → Ollie Gordon II + Jonah Coleman (Team 4), 39 · 65% · 27. Coleman is on Team 4's IR, so he was outside the search's get pool.
  - **Fixed:** IR players are now in the get pool, and this trade is your idea 1 under both settings. The cost is within run-to-run noise.
- **Misses left, by cause** (first league):
  - a 2-for-2 past the first 6 of each pool: Puka Nacua + Kyle Monangai → Kyren Williams + Mike Evans, 63 · 20% · 17;
  - a player of yours outside your top 10 by surplus: Puka Nacua + David Montgomery → Nico Collins + Tetairoa McMillan, 29 · 55% · 18;
  - one trade past a partner's keep of 30.
  - On your second league, #5–#10 are Team 10's Michael Wilson trades with one of their bench players added, versions of your idea 2.
- **Proposals, not built** (question 3):
  - the 2-for-2 window from 6 to 10: about +1.4 s on your first league, +0.7 s on the second;
  - a get pool with every player: about +1.1 s and +1.2 s.
  - The Thorough search finds all of these.
- **Answer 3's count, on your six runs:** 2 promotions, both on your first league, Oct 15, "Only the champion", "Helps both". 7 Last offers with a higher Overall weren't promoted: the list's own limits keep them out, mostly the 3-ideas-per-player cap on Marvin Harrison Jr.

## Thorough search
- **Time** (context and search, cold, in Node): first league 43 s, second league (12 teams) 37 s. That's about 54 s and 46 s in the browser estimate, under the planner's 60 s.
  - Live today in your browser, on your first league: **33.9 s**. Its help said "Takes about 40 seconds."
- **What it found that the normal search doesn't:**
  - Live today: 6 of its 12 ideas.
  - On your Oct 15 dumps: 12 of 16 ideas on the first league and 12 of 13 on the second.
  - The second league's top 3 are 3-for-2s above every normal idea. For example, Patrick Mahomes + Rome Odunze + Breece Hall → Tee Higgins + Aaron Jones Sr. (Team 10) prints 43 · 70% · 32. The normal search's best is 43 · 60% · 29.

## What if (your first league, Oct 15, your prizes)
Take off Puka Nacua, put on Drake London and Christian Watson: **Helps you 45**.
- Title odds 8.9% → 11.5% · Top 3 odds 27% → 32% · Playoff odds 61% → 65%.
- Week 6: 62% → 66% · Week 8: 62% → 65% · Week 13: 40% → 47%.
- Roster moves: "Make room for Christian Watson: drop Romeo Doubs (WR)."
- The same swap as a real trade with Team 8 reads 43, because there Team 8 gets Nacua and loses its two.

## The draft data check (`reports/draft-data.md`)
- **ADP:**
  - Sleeper: 10 formats, no league size, no spread.
  - Fantasy Football Calculator: formats plus a spread per player. Free, with attribution.
  - MFL: by league size (8–16) and PPR, real or mock drafts. Its lists mix 1QB and superflex leagues.
  - ESPN: one list only.
- **Preseason projections:** Sleeper's and ESPN's season stat lines, which can be scored with any league's rules.
- **Live picks:** Sleeper's and ESPN's draft data, both readable from the browser. Picks arriving during a live draft are still unseen (a Sleeper mock draft would show them). Yahoo waits for its approval.
- **Not usable:** FantasyPros and Underdog, by their terms.

## Decisions I made (⚠️ = our reading)
- ⚠️ The closed card shows risks as small pills; their sentences are in Details. The line above the list reads "with or without a trade".
- ⚠️ The spacing trim (12 px between ideas, tighter card padding) was added because your real team names rarely fit beside "Trade idea N".
- ⚠️ The League page's standings stay visible, and its other parts close (question 2).
- ⚠️ Thorough search:
  - It allows 3 players a side whatever your setting.
  - Its 3-a-side trades are kept apart in the funnel, so they can't crowd out the best 2-player trades.
  - The estimate is 6× your last normal search for every team, or 4× for one partner.
  - The switch isn't saved with your settings, but this tab remembers it. A return after its ideas expire runs it again.
- ⚠️ What if: Helps you counts your odds only (no trade value). A player you put on stays on his team too. No feedback buttons.
- ⚠️ Waiver odds start from your roster as it stands, without the League page's suggested pickups.
- ⚠️ Promotion: only a Last offer is promoted. An Open or Then with a higher Overall is counted, not promoted. The list's own limits still apply.

## Gate
- **Tests:** 320 files, 5,943 tests (1 skipped). Typecheck, lint and build are clean, and the leak check has 0 hard hits. (7g: 298 files, 5,715 tests.)
- **check:browser** (live, your first league today, 375 px): 203 passed, 0 failed, 3 skipped.
  - Timings: the import 8 s (read by your browser), the League page 5 s, the search 7.1 s, "How to offer it" 0.2 s, an Analyzer evaluation 0.3 s, a What if 0.2 s, the Thorough search 33.9 s.
  - Info, as at 7g: blocked-kick return touchdowns (+6) have scored, so that uncounted rule is a notice; your kicker is matched by name.
  - Skipped: "Show all" (8 rows), a prefetch check, and a second league (not asked for).
- **`npm run prod:deploy -- --ref HEAD` on 73b59bb:** read-only, nothing uploaded. All 14 checks ✅:
  - the clean copy is 519 files and 11.5 MB, byte for byte the commit, with 0 hard leak hits;
  - Deployment Protection is Standard, and production's variables (names only) are all there;
  - the firewall's rules answer as they should;
  - the rollback target is offersheet-23d7wdmgp-parker-daniels.vercel.app;
  - Next 16.3.8 is the newest patch.
  - This report's commit adds only files under reports/, which aren't deployed.

## Deploying
After your approval (tag `checkpoint-7h`) and your go:
```
npm run prod:deploy -- --checkpoint checkpoint-7h
npm run prod:deploy -- --live --checkpoint checkpoint-7h
```
- Run the first (the dry run) before the go, and the second after it. To check again afterwards: `npm run prod:deploy -- --verify --checkpoint checkpoint-7h`, never `--live` twice.
- Then reload any open Offer Sheet tab, and check a card and the League page on your phone.
- **Rollback:** Vercel → offersheet → Deployments → offersheet-23d7wdmgp → ⋯ → Instant Rollback.

## Questions (numbered, each answerable in one line)
1. Parker: approve Checkpoint 7h so I tag `checkpoint-7h`? Production deploys it after your go.
2. Planner, the League page: it's 7.3–8.3 screens on the dumps but 9.1 today, when 8 waiver pickups help. Should Waivers show 5 rows before "Show all" (about 8.4 today), or should the standings table close too (about −0.8 screens)?
3. Planner, the normal search: build the 2-for-2 window 6 → 10 (+1.4 s on your first league) so it finds its remaining top-10 misses, or leave them to the Thorough search?
4. Planner, 2 ideas a screen: it's met at 2.01 with your real names. Want more room? For example, holding the first reason to one line (cut off with "…") would give about 2.1.

## How Parker can try it
- `npm run dev` (http://127.0.0.1:3001):
  - the closed cards and the Thorough switch on the Trade Finder;
  - What if in the Analyzer;
  - the League page's closed parts and the waiver rows' odds lines.
- `npm run trade:report` reproduces the search test (section 12).
- `npm run stable` serves `checkpoint-7g` until 7h is approved and tagged.
