# Checkpoint 4b — The planner's reply to Checkpoint 4
Status: ⚠️ Done with issues. All seven changes in `planner-reply-4.md` are built, tested, adversarially reviewed and run on your league. The typical overpay is gone: the top 10's median g_mkt(you) went from −22.6% to +2.8% on the same data. The top 3, all Wilson sales, still give 11.5–25.5% more than they get. Selling Garrett Wilson is capped, not cured: his own projection matches the market (question 4).

## What works
- **Market-blended projections (§6 step 8):** 193 players blended, f 0.84–1.60 (median 1.00). Zay Flowers 18.2 → 15.6 points a game. Garrett Wilson 12.6 → 12.9 (f 1.02). Built per game, not on totals (decision 1, question 1).
- **Acceptance (§11):** β_need 1.2 in redraft and keeper leagues, cap 85%, 15 of 15 anchors within ±0.5. Of the 200 trades evaluated exactly on an earlier dump (Oct 3 21:29 UTC), none that costs the partner 1.5+ points a week reaches 40%.
- **One free agent, one team (§7):** claims go in your league's waiver order. Duplicate pickups went from 3 (12 extra) to 0, and no top trade relies on another team's pickup.
- **Value floor at W on both sides (§9–§10):** replaces N10. An even swap and a dump read g = 0. A cheap throw-in adds no value difference, though it still pulls g toward 0 (question 6).
- **IR players (§6, §7, §12):**
  - All 7 IR players are returners from their expected return week, each with a drop at R (every roster is full). 6 play again as rosters stand; Team 6 releases Jordyn Tyson himself.
  - IR players are tradable. ESPN IR slots take IR and OUT players (✅ ESPN's help center).
- **Cards and pages (§13–§14):**
  - injury tags in words, and Plan B
  - at most 3 trades in the top 20 giving one player of yours
  - "Best of their trade chips" and "See trade ideas with Team X →"
  - the version you sent, kept in feedback
  - IR roster moves (card #4: "From week 7, when Alec Pierce comes back from IR, you'd drop Romeo Doubs.")
- **Small items:**
  - `npm run check:browser`: 55 of 55 checks pass on the production build at 375 px.
  - Daily FantasyCalc lists are archived in `data-local/`. ⚠️ That fits FantasyCalc's terms as we read them: no extra request, never published, and the terms say nothing about archives.

## Your league now (final data: Oct 4 00:51 UTC, week 4 under way; full cards: `reports/trade-report.md`)
| # | Trade | Helps / Chance / Overall | Injury tags (yours to get) |
|---|---|---|---|
| 1 | T8: Wilson → Christian Watson + Carnell Tate | 31 / 55% / 19 | – |
| 2 | T1: Wilson → Davante Adams + Rome Odunze | 21 / 70% / 16 | – (Market check: −25.5%) |
| 3 | T1: Wilson → Adams + Josh Jacobs | 34 / 40% / 15 | Jacobs: Questionable — ESPN expects him back wk 8 |
| 4 | T6: Monangai + Harrison Jr. → Jadarian Price | 27 / 25% / 8 | Price: On IR — back wk 8 |
| 5 | T4: Bowers → Trey McBride + Mike Evans | 40 / 15% / 8 | Evans: Questionable |
| 6 | T6: Monangai + Doubs → Price | 26 / 25% / 8 | Price: On IR — back wk 8 |
| 7 | T5: Monangai → Jakobi Meyers + Harold Fannin Jr. | 26 / 25% / 7 | – |
| 8 | T6: Doubs + Bo Nix → DK Metcalf | 17 / 40% / 7 | – |
| 9 | T4: Bowers → McBride + TreVeyon Henderson | 33 / 15% / 6 | – |
| 10 | T8: Doubs + Nix → Tate | 24 / 20% / 6 | – |

**Before and after.** Checkpoint 4's top 10, with the three numbers and tags, is in `trade-report.md` §2: (a) as reported and (b) its model on today's data. (a)'s #1 was Bowers → Zay Flowers (Questionable), 65 / 55% / 42; it no longer helps you (B −0.24).

| | (a) Checkpoint 4 as reported | (b) Checkpoint 4 model, same data | Now | Now, cap off |
|---|---|---|---|---|
| Cards shown | 22 | 19 | 16 | 24 |
| Top 10 receiving an injury-tagged player | 8 | 7 | 4 | 4 |
| Wilson given: top 10 / all | 9 / 15 | 8 / 14 | 3 / 3 (+3 Plan B boxes) | 10 / 12 |
| Median g_mkt(you): top 10 / all shown | about −25% / −20.1% | −22.6% / −19.7% | +2.8% / +6.3% | +0.1% / +7.8% |

**Blend sensitivity** (median g_mkt(you), top 10 / top 25; the cap on):
- w 0: −17.1% / −11.2% (18 shown)
- w 0.25: −16.0% / −6.4% (13 shown)
- w 0.5: +2.8% / +6.3% (16 shown)
- Injury-tagged received in the top 10: 8 / 8 / 4. With the cap off, Wilson is given in 9 / 8 / 10 of the top 10.

**Your odds over time** (playoffs / title):

| | Data | As rosters stand | With pickups |
|---|---|---|---|
| Checkpoint 3, as reported | Sep 30 | 78.6% / 19.7% | – |
| Checkpoint 4, as reported | Oct 3 09:28 | 67.8% / 13.3% | 62.9% / 11.6% |
| Checkpoint 3 model | final | 62.1% / 10.8% | – |
| Checkpoint 4 model | final | 64.7% / 11.7% | 59.2% / 10.1% |
| **Now** | final | **65.2% / 12.1%** | **58.4% / 9.9%** |

**Causes, one step at a time** (playoffs as rosters stand; each step changes only the data or only the model). No game was decided in between: every record is unchanged.
- **78.6 → 76.9 (−1.7):** league data Sep 30 → Oct 1 (rosters, injuries, ESPN's projections), Checkpoint 3 model.
- **→ 76.5 (−0.4):** Phase 4's model changes on Oct 1's data. On today's data the same changes are worth +2.6 (streaming +3.0, the rest −0.4), which is why the Checkpoint 3 model alone falls 16.5.
- **→ 66.5 (−10.0):** the projection refresh: Sleeper's (Sep 30 22:37 → Oct 3 09:25) and ESPN's.
- **→ 64.7 (−1.8):** rosters and injury tags since Oct 1. Your own Mark Andrews → Dalton Schultz move gave +1.2; Hall went Doubtful → Out, and Team 1's Caleb Williams and Keenan Allen went to Out.
- **→ 65.2 (+0.5):** Phase 4b.
  - The blend: +3.9.
  - IR returners: −3.4. The biggest return is Team 1's Williams in week 5, +3.8 points a week for Team 1; ⚠️ the −3.4 wasn't split by team.
  - The allocation can't move the odds as rosters stand; with pickups it costs −0.2.
- **Since Checkpoint 4's own run** (Sleeper's projections were the same fetch): −3.1, from ESPN's Oct 3 update and injury news (for example Puka Nacua 214.8 → 200.9 rest-of-season points with no status change).
- **The pickup baseline costs −6.5** (paired), against −5.5 for Checkpoint 4's model on the same data. You're last in the live waiver order after your own claim and get no pickup; in the weekly reset order you'd claim 4th (59.9% / 10.5%).

**Free-agent allocation:** Checkpoint 4's model had Malik Washington on 6 teams, Mark Andrews on 7 and Jordan Love on 2; now there are no duplicates. Andrews goes to Team 5 and Washington to Team 9. Top 10 trades taking a third team's pickup: 0; the partner's: 0; yours taken by the partner: 0.
**Cards:** Plan B on 5 of 16 (4 distinct trades), offer-first steps on 2, injury tags on 5.

## What doesn't / open issues
- **Wilson: capped, not fixed.** Without the cap the model sells him in 10 of the top 10 (8 for Checkpoint 4's model on the same data).
  - ⚠️ Our reading: the market agrees with our projection of Wilson himself (f 1.02). 8 of those 10 cover your week-13 bye crunch, your only risky week (42% to win). 8 swap him for two players, 4 of them two WRs, so mostly flex depth.
  - Gaps on the players you'd get aren't ruled out: the blend only halves them (question 4).
- **A search gap:** Checkpoint 4's Wilson → Chuba Hubbard + Mike Evans still rates 45 / 35% / 19 in the Analyzer, level with today's #1. The search never builds it: neither half helps you alone, so it misses the 60 best single swaps that get a second player.
- **Short list, padded with long shots:** 16 cards; 4 of them sit at the model's 2% floor, shown as 5% (#12–#14 Puka Nacua for two players, 87 / 5% / 4; #16 Bowers, 77 / 5% / 1). The given-player cap dropped 17 finalists (question 5).
- **Offer-first steps:** both come from g being a ratio. A throw-in counted at W adds no value but pulls the partner's negative g toward 0 (question 6).
- **The ESPN waiver order is read mid-week**, so the baseline depends on the day you import (question 2).
- **IR-slot trades:** none is shown on your data. Received OUT players from an active roster never use an open IR slot (question 8).
- **Progress yields:** the longest stretch between yields is 51 ms in Node (median of 3 warm runs; up to 54), above §12's ~40 ms. The page never blocks, since the engine runs in the worker; a slice only delays Stop by about 0.05 s.
- **Two value figures on one card:** #2's reasons say they get 34% more (each player at least W, plus the open-spot credit); its pitch says 18% (FantasyCalc's raw values, decision 7).

## Decisions I made
1. ⚠️ **Blend per game:**
   - b′ = (1 − w)b + w·R(v), with R a leave-one-out isotonic curve of healthy players' base rates on value (the two end players read their own point).
   - On Oct 1's data, the formula on total ROS left Wilson at exactly f 1.000 (an in-sample fit corrects only rank inversions) and inflated OUT and IR players up to ×1.58 (Charbonnet). In a test, a receiver back from IR in week 16 went from 16 to 37 points a game.
   - Totals also made a player whose bye is done look a game better than one whose bye is ahead, and changed the factors at the week's first kickoff.
   - Price: an injured player's discount partly counts twice (A.J. Brown f 0.93 on Oct 1's data).
2. ⚠️ **Dynasty blend values:** dynasty leagues use the redraft list's own value in the league's format, not FantasyCalc's `redraftValue` field (its 12-team PPR baseline).
3. ⚠️ **Claims:**
   - A team claims every free agent its run adds, even one it later swaps away, which keeps the allocation exact.
   - In a trade, the second team can't take the first team's baseline pickups unless no team sits between them in the waiver order; otherwise a released pickup goes to nobody.
4. ⚠️ **Plan B:**
   - It must be ≥ 5 points likelier to go through than its card.
   - It is never a card already shown.
   - At most 3 boxes in the top 20 may add the same player.
   - It has its own message, and "Open in Analyzer" evaluates it without steps.
   - The planner's rules alone: 14 boxes, 8 of them less likely than their card.
5. ⚠️ **IR:**
   - A returner can be the player released at his return, so a return never weakens a team.
   - The drop at return counts in final evaluations only.
   - Legality never drops a team's last rostered player at a position it streams.
   - The open-roster-spot credit counts active spots only.
6. ⚠️ **Rule 4 refill:** a free-agent K or D/ST refills only a starting slot the trade emptied. On Oct 3's data the shown cards carried 7 free K/D-ST adds; now 0.
7. **The pitch's value figure** uses FantasyCalc's own raw values, the number a partner can check.
8. **Removed** the before-addendum variant and `marketSanityWeight`. They existed only for Checkpoint 4's before/after comparison.
9. **Saved imports:** the stored import format is now 3; older saved imports must be imported again.

## Numbers
- **Gate:** 172 test files, 2,973 tests; typecheck 0; lint 0; `next build` OK; leak check 0 hard, the same 16 soft hits as before; `npm run check:browser` 55 of 55.
- **Anchors:** 15 of 15 within ±0.5. Redraft: 67.9, 35.4, 37.8, 8.3, 48.5, 21.4, 25.0, 85.0; dynasty 61.1. Star premium: 10.9, 35.4, 32.8, 55.4, 26.3, 62.0.
- **Consistency:** a no-op trade gives exactly 0 on 16 of 16 cards. Search and Analyzer agree bit for bit on 16 of 16 cards and 5 of 5 Plan Bs. The largest pickup-sized gain is +1.81 lineup points, under the 3-point bound.
- **Runtime, Node** (warm median of 3): League model 0.21 s (0.38 s cold); context 0.25 s; search 4.11 s (screening 1.72, exact 1.25, screening sim 0.50, final sim 0.47, steps + Plan B + words 0.19); the same search again 2.89 s.
- **Runtime, production browser worker:** a first Trade Finder visit took 4.3 s (Checkpoint 4: 5.1–6.8 s): screening 1.48, exact 1.25, screening sim 0.49, final sim 0.48, steps 0.21. The other ~0.4 s isn't split by stage.
- **Counts:** 12,907 screened, 200 exact, 40 finalists.
- **CLAUDE.md sections changed since Checkpoint 4:**
  - §2.2 ESPN waiver rank, FAAB, IR slots; §2.3 Sleeper IR slots and waiver position; §2.9 dynasty redraft list, the archive
  - §4 new fields; §6 expected return week, step 8 blend
  - §7 one free agent per team, IR players, legality rules 2, 4 and 5
  - §9 floor and active spots; §10 N10 replaced; §11 β_need, cap, anchors, version sent
  - §12 IR in pools, finalists; §13 cap, tags, Plan B, pitch; §14 pages; §15 config; §16 check:browser
  - §17 Phase 4b, picks to Phase 5, Phase 6 items

## Questions (each answerable in one line)
1. Keep the blend per game (byes and availability stay ours, but an injured player's market discount partly counts twice), or blend total ROS as written, keeping our leave-one-out curve, with a cap on f?
2. ESPN waiver order: keep the live mid-week order (you claim 10th today), or use the weekly reset order (4th)?
3. Plan B: keep our "≥ 5 points likelier than its card" bar (5 of 16 cards), or the literal rules (14 boxes, 8 less likely than their card)?
4. ⚠️ Wilson-selling looks like roster construction (week-13 bye, two-for-one depth), not a gap on Wilson himself. Keep the cap of 3, or show the model's preference?
5. Hide cards under some chance (for example 10%), so long shots don't pad the list?
6. A throw-in worth less than the best free agent adds no value, yet pulls the partner's g toward 0, which is where both offer-first steps come from. Keep that, or leave such a throw-in out of both sides' totals?
7. A pickup a trading team releases goes to nobody when a team sits between them in the waiver order: OK?
8. IR: an OUT player received from an active roster never takes an open IR slot, and teams don't move their own OUT players to IR. OK for now?
9. Store the sent version's model inputs in feedback now, for Phase 6's refit?

## How Parker can try it
In PowerShell, one per line, from the project folder: `npm run dev`, then open http://127.0.0.1:3000 (the address your saved settings and feedback live under) and import your league again (the saved format changed). Look at:
- League page: the free-agent line above the rosters, the blend line in a player's breakdown, the partner cards
- Trade Finder: tags, "If they say no, try:", "Which version did you send?"
- Analyzer: IR players
```
npm run build
npm run check:browser -- --team 3
npm run trade:report -- --offline data-local/parker-league-final --team 3 --compare data-local/cp4-compare-final.json --compare3 data-local/cp3-compare-final.json
npm run league:report -- --offline data-local/parker-league-final --team 3
```
The last two rewrite `reports/`; `git restore reports` brings back this checkpoint's versions.
