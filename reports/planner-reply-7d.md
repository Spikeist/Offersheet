# Planner reply to Checkpoint 7d: launch-week fixes

**The launch is approved and done.** Offer Sheet went live on 2026-10-14 from `checkpoint-7d`. Every check after the deploy passed, and the first snapshot run finished (DONE, 3.2 s).

**Next: Checkpoint 7e, the launch-week fixes below.** They come from Parker's first day on the live site.
- **Order:** do them in the order listed. If usage runs short, stop after any finished item, commit, and report what's done.
- **Then:** update CLAUDE.md to match, write a short Checkpoint 7e and stop.
- **Aim:** ready by Monday, October 19, so it can go live before week 7's trading.
- **Deploying:** production deploys only after Parker's "go," through `prod:deploy`. The one-time launch steps (secrets and firewall rules) are done, so a normal deploy is the dry run, Parker's go, the deploy with its checks, and his phone check.

After 7e comes Phase 5 (more platforms), then Phase 6 (calibration).

**Rules for all of it:**
- **The site is live:** saved leagues, settings and feedback must keep working. Give new settings defaults when old data loads.
- **New settings stay in the browser** and never go into the anonymous feedback.
- **No FantasyCalc numbers in the UI,** as before.

---

## 1. Quick checks first

### 1.1 Is 5,000 seasons enough?
- **The test:** rerun Parker's top 5 trades with 5 different random seeds, at 5,000 seasons each.
- **Report:** the spread in Helps you, and in the change to his title and top-3 odds.
- **If any trade's Helps you moves by more than 3 points across seeds:** raise the final simulation for the cards shown to 10,000 or 20,000 seasons, and report the runtime.

### 1.2 Kicker and D/ST projections
- **Set the season-to-date weight (α) to 0 for K and DEF,** as a per-position setting in config. Their projections then come from ESPN and Sleeper alone. Phase 6's backtest decides whether to bring the weight back.
- **Explain Parker's week-6 case.** The waiver view had the 49ers D/ST 2.6 points above his Giants D/ST, while ESPN projects the Giants higher. Show the numbers before and after the change:
  - ESPN's projection
  - Sleeper's projection
  - the season-to-date part
  - the week-shape factor
  - our final number

## 2. Correct the trade math

### 2.1 No credit for moves Parker could make anyway
- **The problem:** a trade's numbers can include free-agent moves. Parker's Nacua → London + Watson card says "you'd drop Rico Dowdle and Kyle Pitts Sr., and pick up Darren Waller."
- **The rule:** an optional free-agent move belongs to the trade only if the trade is what makes it worthwhile. When the trade's version of the roster wants an optional move the baseline doesn't make, test that move against the baseline with the same pickup bar:
  - if it clears the bar there too, apply it in both versions
  - if it doesn't, keep it with the trade
- **Forced moves stay with the trade:** drops to keep the roster legal, and filling open spots by the same-position rule.

### 2.2 Spell out every roster move
- **Each card lists every roster move its numbers assume,** in order, each with its reason and its week. For example:
  - "Make room for Watson: drop Rico Dowdle (RB)."
  - "This trade makes a waiver move worthwhile: add Darren Waller, drop Kyle Pitts Sr."
  - "Week 7, when Alec Pierce returns from IR: release X."
- **Moves Parker would make either way,** like his Malik Washington pickup, aren't listed as part of the trade. One line can say they're assumed either way.

### 2.3 Future decisions compare players from that week on
- A decision that happens in a future week compares players over the weeks from then on, not from today. That covers releasing someone when a player returns from IR, and any other drop scheduled for later.
- **Parker's case:** releasing Alec Pierce in week 7 rather than Wan'Dale Robinson or Marvin Harrison Jr.

## 3. Waivers

### 3.1 One move per row
- **The row reads as one move:** "Add A, drop B."
- **It shows two numbers:**
  - how many more rest-of-season points A scores than B, for example "outscores B by 18"
  - Helps you for that exact swap (3.4)
- **The lineup-gain number** moves to the row's details.

### 3.2 Same-position drops
- **New switch,** on by default: "Drop from the same position."
  - On: the suggested drop plays the pickup's position.
  - Off: the drop can be at any position.
- It's saved per league and applies to all three lists.

### 3.3 Untouchables are never dropped
- **Untouchables are never suggested as drops** anywhere:
  - in Waivers
  - in trade cards' roster moves
  - when a player returns from IR
- **Marking untouchables:** users can do it from the roster card and the waiver view, with a lock icon, not only from the Trade Finder.
- **If every candidate is untouchable,** say so, for example "All your RBs are untouchable." In the waiver view, also suggest turning off "Drop from the same position."

### 3.4 Rest of season rated by Helps you
- **The score:** rate each rest-of-season row with the season simulation under the league's reward setting, as for trades. Pick the drop with the best Helps you, following 3.2 and 3.3.
- **Before and after:**
  - Before: the roster as it stands, with the other teams' modeled pickups. Leave out the user's own modeled pickups, or the model's own pickup would always score 0.
  - After: this one move added.
- **Sorting:** by Helps you. Rows at 0 or below go lower, marked "No gain," or "Depth only" where that applies.
- **Speed:** screen with 1,000 seasons, and finish the top 10 with 5,000 (or the count chosen in 1.1). Report the runtime.
- **This week and Next week:** these stay in points, since they're for streaming, with 3.2 and 3.3 applied.

### 3.5 Return week for the user's injured players
- **Where:** on the user's roster card and on the player detail view, each injured player (OUT, IR, PUP, SUSPENDED) shows "Expected back: week N."
  - Marked "ESPN" when the platform gives the week.
  - Marked "our guess" when it's our default.
- **Changing it:** the user can change the week, and the new week works like a return week from the platform: 0 until that week, then the normal return rule.
- **Storage:** saved per league in the browser and never sent. It clears when the player is active again or the week passes.

## 4. Trade cards

### 4.1 "How to offer it": offers in order
Replace "Offer first" and "If they say no, add" with one ordered list of up to 4 offers to the same team:
1. **Open:** the version that's best for Parker (highest Helps you) that still has at least a 15% chance, so it isn't insulting.
2. **Then:** versions a little less good for him, each at least 5 points likelier than the step before.
3. **The suggested trade.**
4. **Last offer:** the suggested trade plus the throw-in, using the existing rule (at least 5 points likelier, and Helps you at least 80% of the suggested trade's).

Details:
- **Variants:**
  - Keep what Parker gives and change what he gets from that team. His example: Nacua for London + Olave, or for Olave + Watson.
  - Include the lean and throw-in versions.
  - Every step needs Helps you above 0 and must pass the market guard.
- **When to build it:** when the user opens a card's "How to offer it," in the Web Worker. Aim for under 2 seconds.
- **Each step shows** Helps you and the chance they accept, with its own copy-ready message.
- **Plan B stays below the list:** "If they won't move: try …", a different target.
- **Feedback** records which step was sent.

### 4.2 Now or after this week
- **The line:** on each card and in the Analyzer, run the simulation once more with the trade starting next week. Show it as "Helps you 37 now · 41 if done after this week's games."
- **When it shows:**
  - only when at least 2 weeks remain before the trade deadline
  - only when the two numbers differ by more than the noise found in 1.1 (3 points by default)
- **Tooltip:** "Assumes the same deal is still there next week. Injuries, big games or another trade can change that, and their answer may change too."
- **Ranking** stays on "now."

---

## Checkpoint 7e (short) must include
- **What changed,** and anything left for later.
- **Seasons:** the spread across seeds, and the final count.
- **K/DEF:** the 49ers/Giants breakdown, before and after.
- **Trade math:**
  - the Nacua card's moves and its Helps you, before and after 2.1–2.3
  - how many of Parker's cards moved by more than 3 points
- **Waivers:**
  - Parker's top 5 rest-of-season rows
  - whether Josh Jacobs is still suggested as a drop, once with our guessed return week and once with a week Parker sets
- **Offers in order:** the list for Parker's top 3 cards, with Helps you and the chance at each step, and the time to build it.
- **Timing:** Parker's top 5 cards, now vs. after this week.
- **Gate:** tests, the live browser check and the `prod:deploy` dry run.

On approval, tag `checkpoint-7e`. Production deploys it after Parker's "go."
