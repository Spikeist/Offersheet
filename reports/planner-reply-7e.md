# Planner reply to Checkpoint 7e

**Checkpoint 7e is approved. Tag `checkpoint-7e`.** Production deploys it after Parker's "go," with the normal deploy: dry run, go, deploy and its checks. Then Parker reloads any open tabs and checks his phone.

---

## Answers to your questions

2. **The 12-team league's speed:**
   - Build the 0.3 s fix now: simulate only the 15,000 seasons the ranking run doesn't already cover.
   - Accept the rest for now, since the progress bar covers it. Phase 6's performance work looks at it again.
3. **Waiver ratings count trade value only when a move gives it up: yes.** A free agent's market value isn't value you could trade for, because anyone can pick him up, so a pickup shouldn't be credited for it. Giving up a rostered player's value should still count.
4. **Pierce and the near-tie rule:** keep the rule, but the card must say why. For example: "Week 7, when Alec Pierce returns from IR: release him. He and Marvin Harrison Jr. are nearly even for your lineup, and Harrison Jr. has more trade value. Lock Pierce to keep him instead."

**Decision 3 changes.** When one card's offer list contains another card's trade, merge them:
- Keep only the card with the higher Overall in the list.
- The other trade appears only inside that card's offer list.
- Fill the freed slot with the next idea, under the usual diversity rules.

---

## Checkpoint 7f (small)

**Aim:** ready by Monday, October 19, so it can go live before Parker's Reddit posts on Tuesday. If it isn't ready, he posts with 7e.

1. **Speed:** the 0.3 s fix (answer 2).
2. **Merged cards** (decision 3).
3. **Waivers: hide "No gain" rows by default.**
   - Show the rows that rate above 0, followed by a collapsed "N more pickups that don't help you (show)."
   - In Parker's first league that's 6 rows instead of 48. In his second league it's 1 instead of 21.
4. **Pierce's release line,** with the reason (answer 4).
5. **Josh Jacobs's 41.6 points:** for a starter back in week 8, that looks low.
   - Break it down: our per-game projection, his availability by week, the trade-market part of the blend, and the clamp.
   - The blend may count his injury twice: once in the weeks we already set to zero, and again in his market value. If it does, propose a fix for injured players with a known return week. Report the proposal before building it.
6. **The averaging test:** report how often the league-wide gap between ESPN and Sleeper crosses the 10% bar, with and without K and D/ST included. Use both of Parker's leagues and every day we have saved. If K and D/ST are what push it over, leave them out of the test.

## Checkpoint 7f (short) must include
- **What changed.**
- **Jacobs:** his breakdown, and any proposed fix.
- **The averaging test:** its numbers.
- **The gate:** tests, the live browser check and the `prod:deploy` dry run.
