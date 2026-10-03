# Planner reply to Checkpoint 3

**Checkpoint 3 is approved.** The simulator is fast, matches an independent reference, and the no-op check is exact.

**What to do now:**
1. Apply the answers and the two model changes below.
2. Update CLAUDE.md to match, and list the sections you changed in Checkpoint 4.
3. Start Phase 4. This is the trade search, the core of the product.

---

## Answers to your questions

**1. B_ref.** Yes, change it from 5 to 6. Then +1, +3 and +6 points a week score about 29, 65 and 87 in Parker's league.

**2. The free-agent baseline.** Yes, every team makes every pickup that helps it. The guardrails are in Model change 2 below, and that change replaces the pinned single move.

**3. Chips.** Keep the rule as written for the search. For display:
- Show the cost to the player's own team next to the gain, for example "Worth +33 to Team 2 · costs you 6.1 pts/wk."
- Mark starters with a "starter" tag.
- Keep showing at most 3 chips per team.

**4. Bo Nix.** Agreed, he's not a chip. That's the free-agent rule working: in a 10-team, 1-QB league, five free-agent QBs are about as good as he is. The planner's earlier example was wrong, and the model is right.

**5. The base rate for Q/D/P players.** Yes. Ignore this week's injury-cut Sleeper projection when computing the base rate, and take availability from the injury table only, applied once. That's consistent with the Checkpoint 0 answer.

**6. Live game-day scores.** Yes, but in Phase 6, not Phase 4.

**7. ESPN ties among 3+ teams.** Yes, follow ESPN's documented seed-by-seed procedure, in Phase 6. It's low priority, since Parker's league doesn't use head-to-head tiebreakers.

**Also approved:**
- Partner fit counts only chips that stay chips together, at most 2 per side.
- Chip order: gap first, then the cheaper player to lose.
- Sleeper's tiebreak is points for, then points against.
- "Eliminated" is shown only when it's certain.
- The weekly SD uses the law of total variance.

---

## Model change 1: streaming positions (from Parker)

Parker streams K and D/ST every week, starting whichever available one is projected highest for that week's matchup. Most managers do the same. Build this first in Phase 4, because it changes baselines, needs, chips and B.

- **User setting:** "Positions I stream weekly." The default is K and DEF, and the user can add QB or TE. Store it with the user's other settings.
- **How a streamed slot is valued:** each week, it's worth max(the best rostered player, the streaming replacement).
  - The streaming replacement is the `config.streamRank`-th best free agent at that position that week, ranked by that week's projection. The default is the 3rd best, which allows for other teams streaming too.
- **Who it applies to:**
  - the user's team, using their setting
  - any other team detected as a streamer at a position, meaning it made 2 or more adds at that position this season
  - all other teams use their rostered players
- **Remove K and DEF from the "best free-agent move."** Replace that with a **"Streaming picks this week"** list on the League page: the top 3 K and top 3 D/ST free agents for the current week, each with its projection and opponent.
- K and DEF stay out of trade search by default.
- This also removes, at the source, the negative lineup costs caused by free-agent kickers.

## Model change 2: the free-agent-optimized baseline (answers Question 2)

Replace the "best single free-agent move" with a greedy roster optimizer:
1. Repeatedly apply the best add/drop while it improves ROS by at least `config.faMinGain` (default 3 points).
2. Stop after `config.faMaxMoves` moves (default 5).
3. Never drop a player the team needs to fill its starting lineup.
4. Exclude streamed positions, which Model change 1 handles.
5. In dynasty and keeper leagues, never drop a player whose dynasty value exceeds the added player's by more than `config.faDynGuard`.

Rules for using it:
- Use the same optimizer for every team, before and after every trade, for B, n, MV_add, MV_lose and chips. It replaces the pinned-move patch.
- Each team is optimized on its own. Two teams could both "claim" the same free agent; note that as a known approximation.
- **Checkpoint 4 must report:**
  - the Bo Nix → Team 1 example
  - McCaffrey's chip gap under the new baseline
  - how many moves teams typically make

---

## Phase 4: trade search, benefit, acceptance, Trade Finder and Analyzer

Build what §10–§13 specify, plus the decisions above. Things to watch in particular:

1. **Three numbers on every card,** sortable, with Overall as the default sort: Helps you (Trade Score, B_ref 6), Chance they accept, and Overall. Add ROS points given and received, required drops and adds, risk flags, plain-English reasons, and the copy-ready pitch message.
2. **Feedback, stored locally:** the Sent / Accepted / Rejected / Countered buttons, a Report button with its reasons, JSON export, and the summary script.
3. **Refill other teams' completed ESPN trades** from player cards, so the activity and hist features have data.
4. **Trade Analyzer:** the user builds any trade, including counteroffers, and sees the same evaluation.
5. **Performance:** 10 seconds or less for Parker's league, in the Web Worker, with a progress bar.

**Checkpoint 4 must include:**
- **Parker's top 10 trades:** for each, give/get, the three numbers, ΔPPW, ΔPO, ΔCH, ROS points in and out, g_mkt for both sides, the partner's n, the reasons and the pitch message.
- **A realism check on the top 25:** the distribution of g_mkt(partner). If most suggestions ask partners to give up more than 15% in value, say so; that would mean the search favors lopsided offers.
- **A consistency check:** no suggested trade's B should come from free-agent pickups. Confirm it holds by construction, and show one test.
- **The acceptance anchor tests**, still within ±1 point.
- **Runtime:** total and per stage (screening, exact evaluation, screening sim, final sim).
- **One example evaluated in the Trade Analyzer.** Pick a trade that looks great for Parker but that the model gives a low acceptance chance, and explain why.
