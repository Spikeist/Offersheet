# Planner reply to Checkpoint 1

**Checkpoint 1 is approved.** Strong work: a live import of Parker's league, 100% scoring on it, and honest ⚠️ marks where the evidence is thin.

**What to do now:**
1. Apply the answers and additions below.
2. Update CLAUDE.md to match, and list the sections you changed in Checkpoint 2.
3. Start Phase 2.

**Priority:** Parker's trade deadline is Wed Dec 2 (NFL week 13). Getting his ESPN league working end to end, through Phase 4 trade suggestions, comes before breadth. Aim to have Phase 4 running on his league by early November.

---

## Answers to your questions

**1. Players no ID source knows.** Yes. Match them on exact name + position + NFL team, but only when exactly one active player fits. Flag each match in the Import Report.

**2. A lower-priority ID source overriding a stale top source.** Yes, under these conditions:
- The sources must agree on name and position, plus either NFL team or GSIS id.
- Log every override in the Import Report notes.
- Add a test for the 2 players it fixes.

**3. Distributions for expected values.** Replace §5's flat SD = 0.5 × mean:
- **Count stats** (TDs, receptions, interceptions, sacks, FGs made, 2-point conversions, fumbles): use a **Poisson** distribution with mean = the projected value, and compute P(X ≥ k) exactly. A "2+ TD" bonus then gets its true expected value instead of about 0.
- **Yardage stats:** use a normal distribution with the **empirical SDs** from your stat-SD script, re-measured on every completed week so far rather than one week. Floor at 0.
- **Completion %:** use a normal distribution with SD 10 as the default.
- Put all of these in config (§15).

**4. The exotic Fleaflicker keeper league.** Yes, keep it as a regression pin at 86% until Phase 5.

**5. ESPN PROBABLE.** Add a PROBABLE row to the injury table: 0.95 availability this week, then 1.

**6. Development default.** Yes. `npm run dev` should use the public-link flow by default, the same one a leaguemate gets. Add an explicit opt-in flag, such as `USE_ENV_COOKIES=1`, to use the `.env.local` cookies.

**7. Sleeper 200-yard bonuses.** Yes, treat them as exclusive tiers. This is documented, not an analogy: Sleeper's help center labels them "100-199 Yard Rushing Game" and "200+ Yard Rushing Game," and says "The yard ranges are strict and do not stack." The same applies to receiving and combined rush + rec yards. Mark these ✅ and cite `support.sleeper.com/en/articles/3998131`.

**8. Sleeper tradable future picks.** Yes. Sleeper's help center says tradable picks are "the current season + up to 3 future years," and leagues can't change that (`support.sleeper.com/en/articles/4047901`). Mark it ✅.

**9. ESPN test leagues with rare settings.** Unless Parker says otherwise, no. Don't block on it; we'll look for volunteer leagues during a beta.

**Mobile picker.** On phones, make the platform picker compact, as a segmented control or a select, so the league-link box and the Import button fit on the first screen.

**Other teams' completed ESPN trades without player lists.** Approved to refill them from player cards in Phase 4.

---

## Additions for Phase 2 (from Parker)

Parker wants players rated on how many points they'll score for the rest of the season, counting byes already played and the chance of injury. Most of that is already in §6. Add the three pieces below.

### A. Rest-of-season (ROS) points, shown to users
- `ROS_i = Σ p[i,w]` over the remaining weeks, from the current week through the last fantasy playoff week, using expected availability (item B).
- Show it split into regular season and playoff weeks, with games left and bye status (for example "bye done" or "bye wk 9").
- Only remaining weeks count, so a player whose bye already passed automatically gets credit for one more game.
- Show ROS points on:
  - the League page roster tables, where tapping or hovering shows the week-by-week breakdown
  - trade cards, for example "You get 142 ROS pts, give 118"

### B. Future injury risk (new injuries to players who are healthy now)
Use one two-state weekly model (healthy / out) for both expected values and the scenarios in item C.
- **Recovery rate:** r = 1 / d, where d is the mean length of an injury. Default d = 2.5 weeks.
- **Weekly new-injury chance:** h_pos = M_pos · r / (1 − M_pos), where M_pos is the long-run share of games missed.
- **Chance a player healthy now is out k weeks ahead:** `P_out(k) = M_pos × (1 − (1 − h − r)^k)`. Multiply it into availability: `a[i,w] ×= 1 − P_out(k)`.
- For a player who is injured now, use the expected return week (ESPN gives it; you found 22/22), then apply the same model from his return.
- Default M_pos (config):

  | Position | M_pos |
  |---|---|
  | QB | 0.06 |
  | RB | 0.14 |
  | WR | 0.12 |
  | TE | 0.14 |
  | K | 0.02 |
  | DEF | 0 |
  | IDP | 0.10 |

  Sources disagree on how much positions differ. FantasySquawk (2015–2025, top-150 ADP) found games missed per season of RB 2.8, WR 2.0, TE 2.8 and QB 1.0. Fantasy Index (top 20 per position, last 5 years) found every position played about 84–85% of games.
- **Phase 6:** estimate M_pos and d from nflverse weekly data (2018–2025) for fantasy-relevant players, and replace the defaults.

### C. Credit for depth (availability scenarios)
Expected-value lineups undervalue depth. A bench RB never starts in the average-case lineup, but in real life he plays when a starter is hurt or on bye. Without this fix, the trade search will overrate 2-for-1 consolidation trades that strip a team's depth.

- **For exact evaluation (§12 step 3) and the season sim:** compute LV(T, w) as the average over S availability scenarios. Default S = 32, with common random numbers.
- Draw each scenario from the item B model:
  - injuries persist across weeks
  - currently injured players return around their expected week, give or take a week
  - byes come from the NFL schedule
- Solve the optimal lineup for each scenario.
- **Screening (§12 step 2)** may keep the fast expected-value lineup.
- **Phase 3:** the sim's weekly team σ adds the spread across scenarios.
- **Checkpoint 2 must report:**
  - the runtime impact
  - a before/after example showing a bench player's value to his team under expected-value lineups versus scenario lineups

---

## Reminders for Phase 2
- Add the FantasyCalc format-substitution note to the Import Report. You deferred it; Parker's league is 10 teams and half-PPR, which is a supported format.
- **Checkpoint 2 must include, for Parker's league:**
  - ROS points and projected points per week for every rostered player
  - the needs and surplus table for all teams
  - the FantasyCalc has-a-value and ID match rates
