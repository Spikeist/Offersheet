# Planner reply to Checkpoint 2

**Checkpoint 2 is approved.** The projections, the scenario lineups and the depth before/after example are exactly what we needed, and the free-agent move is a nice touch.

**What to do now:**
1. Apply the answers and changes below.
2. Update CLAUDE.md to match, and list the sections you changed in Checkpoint 3.
3. Start Phase 3.

---

## Answers to your questions

**1. Lineup cost from the team after its best free-agent move.** Yes. Also apply the same free-agent-adjusted baseline everywhere a trade is scored, both before and after the trade (B, n, MV_add and MV_lose). A trade must never get credit for a free-agent pickup the user could make anyway, and an open roster spot is only worth what the best free agent adds.

**2. Surplus and partners.** Mutual partners listed before one-sided ones: yes. But **replace the surplus rule** with "trade chips." Today only 3 players in the whole league count as surplus. Parker shows none even though he rosters Bo Nix behind Josh Allen in a 1-QB league while four teams have QB needs, and that's the classic trade chip.
- chip gap_i = maxOther_i − cost_i, both in rest-of-season lineup points against free-agent-adjusted baselines:
  - maxOther_i = the largest MV_add(T′, i) over other teams T′
  - cost_i = MV_lose(own team, i)
- A player is a **trade chip** if gap_i ≥ `config.chipMinGap` (default 10 ROS points). In plain words, he's worth at least 10 more points to some other team than to his own.
- Show up to 3 chips per team, ranked by gap, with the team where he'd help most ("Worth +31 to Team 6").
- Add every chip to the give pool G in §12.
- Rename the League page's "Surplus" chips to "Trade chips." Keep "Needs" as it is.

**3. Negative binomial for volume counts.** Yes, in Phase 6. Rush attempts, completions and receptions move to a negative binomial with the measured dispersion. TDs stay Poisson.

**4. Save pre-game projections.** Yes, start now.
- Whenever the app or a script fetches Sleeper projections before a week's first kickoff, archive that snapshot in git-ignored `data-local/`. Keep only the fields we use, compressed, and only the last pre-kickoff snapshot per week.
- Add `npm run snapshot:projections` so Parker can run it by hand, for example on Wednesday nights.
- Don't set up any scheduled task on this computer.
- Phase 6 refits the SDs on these true pre-game numbers.

**5. TE premium mapping.** Yes: below 0.75 per catch → `te+`, and 0.75 or more → `te++`. Add "confirm the te+/te++ meaning" to the Phase 7 FantasyCalc email.

**6. A questionable or doubtful player with a return date 2+ weeks away.** Use Sleeper as the tiebreaker, since the two ESPN signals conflict:
- **If Sleeper still projects him this week** (at least 50% of his healthy base rate): treat the return date as stale. Use the Q/D table for this week, then treat him as healthy.
- **Otherwise:** follow the return date.

Either way, show the conflict as a note on the player ("ESPN: questionable, return week 8 — using …"). Josh Jacobs is the test case.

---

## Other notes on the report

- **Projection downloads (≈40 MB every 6 h):** cache each NFL week's projections separately. Refresh the current week and the next 2 every 6 hours, and later weeks every 24 hours. Add a single-flight fetch now, because it also helps in development.
- **SD fits from re-stamped projections:** keep the ⚠️. Item 4 fixes it in Phase 6.
- **Keeper leagues without dynasty values:** noted for Phase 4. ΔDyn treats long-term values as missing and says so on the card.

---

## Phase 3 (season simulator): reminders

- Use the league's own seeding tiebreaker when the platform reports it. For ESPN, read it from the settings, and warn if you can't.
- Parker's league plays a 6-team fixed bracket with 2 byes in weeks 15–17, and it has a real bye crunch in week 13 (his projection drops to 85.9). The sim should show that week's risk.
- The weekly σ includes the spread across scenarios (Phase 2, item C).
- **Checkpoint 3 must include:**
  - playoff, bye and title odds for all 10 teams, next to the current standings
  - sim runtime at 1,000 and at 5,000 simulations
  - the no-op check (a trade that changes nothing moves no odds)
  - **a Trade Score scale check:** for Parker's team, B and the Trade Score from a hypothetical +1, +3 and +6 projected points per week for the rest of the season. The planner's toy league gave B ≈ 1.7 / 5 / 10. If Parker's league differs a lot, propose a new B_ref.
