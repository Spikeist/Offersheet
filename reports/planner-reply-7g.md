# Planner reply to Checkpoint 7g

**Checkpoint 7g is approved. Tag `checkpoint-7g`.** Parker runs the dry run and the deploy himself, so the permission block on deploys stays.

---

## Answers to your questions

2. **Use 75%.** Cutting near-duplicate ideas matters more now (section 1), and a Last offer that keeps 75% of the Overall is still a fair final offer.
3. **No: promote it.** When an offer list finds a version with a higher Overall than the idea it sits under:
   - that version becomes the idea
   - the original becomes its "Open with" step, the bigger ask

   Count how often this happens on Parker's leagues. It's a sign of what the search misses (section 2).
4. **Narrow the preference.** Prefer an idea from the list only when its Helps you is within 3 points of the best version that meets the step's rules. Otherwise take the best version.

---

## Checkpoint 7h

**Order:** do the sections in order. Section 1 (the clutter) comes first, because it decides when Parker posts on r/fantasyfootball. If time runs short, ship what's done and report the rest.

**Aim:** Monday, October 26.

### 1. Less clutter
Your screenshots confirm Parker's worry: the Trade Finder takes 26 phone screens for 10 ideas, and the League page takes 17.7.

**Goals on a phone:**
- With cards closed, the Trade Finder shows at least 2 ideas per screen.
- The League page fits in about 8 screens.

**The changes:**
- **Cards are closed by default.** A closed card shows only:
  - what Parker gives and what he gets
  - the three numbers
  - its tags ("Helps both," "Harder to get")
  - one reason
- **Everything else goes behind one "Details" control:** the odds lines, the weekly lines, the roster moves, the other reasons and the timing line. "How to offer it" stays a separate control.
- **"Assumed with or without this trade":** show it once, above the list, not on every idea and Plan B box.
- **Messages:** a closed card shows none. Inside "How to offer it," the first offer's message shows open, and the others stay behind their own steps.
- **Plan B:** when several ideas share a Plan B, show it only on the highest idea.
- **League page:** cut each long explanation paragraph to one line. The rest goes behind a "Why?" control or moves to How to read.
- **Screenshots:** the same four pages, before and after, with the screen count for each.

### 2. Is the search finding the best trades?
Parker wants to be sure we aren't missing better trades. Test the search against brute force:
- **The brute force:** on both of Parker's leagues, screen every 1-for-1, 1-for-2, 2-for-1 and 2-for-2 trade with every partner. Use whole rosters, not just the pools, and the same screening objective. Then run exact evaluation and the simulation on the best of them.
- **Report:**
  - of the brute force's top 10 and top 25 by Overall, how many the normal search also found
  - the best trade the normal search missed, with its numbers
  - the count from answer 3
- **If the normal search misses any top-10 trade:** propose the smallest change that finds it, such as bigger pools or a second pass, with its cost in seconds.

### 3. A "Thorough search" option
For people willing to wait for the most complete search. Build it on section 2's brute force.
- **The switch:** a "Thorough search" switch on the Trade Finder, off by default.
- **What it does:**
  - screens every 1- and 2-player trade with every partner, across whole rosters
  - adds trades with 3 players on a side, from bigger pools (for example, the top 15 on each side)
  - sends more trades to the full simulation (for example, 120 instead of 60)
- **While it runs:**
  - before it starts, show roughly how long it will take
  - show a progress bar and a Cancel button
  - aim for under 60 seconds on Parker's computer in his 12-team league
- **Results:** keep them for the session, like a normal search.
- **Report:** its time on both of Parker's leagues, and anything it found that the normal search didn't.

### 4. "What if" comparisons
Parker wants to compare any players and see how his odds move.
- **The mode:** add "What if" to the Analyzer.
  - Pick players to take off your roster and any players to put on it, from any team or from free agency.
  - There's no partner and no chance they accept.
  - Roster rules apply as usual.
- **Show:**
  - Helps you
  - the odds lines, before → after: title, playoffs, and top-N when the league pays more places
  - the weekly lines
- **Other teams stay as they are.** Say so in one line: "Other teams don't change. To see a real trade, use the Analyzer with a partner."

### 5. Waiver rows show the odds change
- **Rest of season:** each row's details show the odds lines (title, playoffs, and top-N under the league's prizes), before → after, from the same run as its Helps you.
- **This week and Next week** stay in points, for streaming K and D/ST.

### 6. The draft assistant: a spec and a data check (don't build it yet)
Parker drafts with "value over next available" and wants a draft assistant high on the list. Drafts start in August, so it becomes **Phase 8, the first big project after this season's trade deadlines** (late November). Winter and spring then leave time to test it in mock drafts. In 7h, write its spec into CLAUDE.md as Phase 8, and do the data check below.

**The spec:**
- **Setup:**
  - pick an imported league (its scoring, lineup and teams) or enter the settings by hand
  - the user's draft position
  - snake or linear order. Auction drafts come later.
- **Before the draft, a projected team:**
  - Play out the draft with every other team picking by average draft position, with realistic randomness, and the user following the recommendations.
  - Show the user's likely roster round by round, with its projected weekly points.
  - If it's fast enough, also show its title odds.
- **During the draft, a draft session:**
  - **Manual mode, for any platform:** the user enters each pick as it happens, with a quick player search.
  - **Live sync where the platform allows it:** Sleeper first, since its draft picks are public, then ESPN, then Yahoo once it's approved.
  - **After every pick,** for each position the user still needs:
    - the best player available now
    - the best player expected to still be there at the user's next pick
    - each player's chance of lasting to that pick
- **The recommendation (Parker's method, the default):** among the positions the user still needs to fill, the pick with the biggest value over next available. That's the best player's projected season points now, minus the expected best at that position at the user's next pick.
- **Other strategies, as options:**
  - value over replacement
  - best player available
  - value vs. average draft position
  - tiers
  - roster plans such as Zero RB and Robust RB
- **Stretch goal:** rate each pick by its effect on title odds, from a season simulation of the projected rosters.

**The data check (like Phase 0).** Find free sources whose terms allow our use, for:
- average draft position, by scoring format and league size
- preseason season-long projections (Sleeper's and ESPN's season projections)
- live draft picks: Sleeper's draft endpoints, ESPN's draft data and Yahoo's draft results

For each source, report its terms, what it covers, and a sample.

## Checkpoint 7h (short) must include
- **What changed,** briefly.
- **Clutter:** the before and after screenshots, and the screen counts.
- **The search test:** its results.
- **Thorough search:** its times, and what it found that the normal search didn't.
- **"What if":** one example from Parker's league.
- **The draft data check:** its results.
- **The gate:** tests, the live browser check and the `prod:deploy` dry run.

On approval, tag `checkpoint-7h`. Production deploys it after Parker's "go."
