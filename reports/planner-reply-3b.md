# Planner addendum for Phase 4

Apply this **before** regenerating the Checkpoint 4 reports, then add it to CLAUDE.md (§10, §11, §12, §13, §14, §15). The changes are small, so your planned final review pass covers them.

**Why:** two findings point the same way.
- **Your finding:** most top suggestions have Parker giving up 25–35% more trade value than he gets. The benefit model treats his bench players as free sweeteners.
- **Parker's question:** "Would someone really give up Smith-Njigba for three RBs?" The old acceptance model has nothing for managers holding onto their best players. A 3-for-1 for a contender's top player that fills their RB holes came out about 51% likely. That's too high, but it's still a fair trade when the RBs genuinely help them, so the fix should be moderate.

---

## 1. A moderate star premium (§11)

Managers value their own best players a bit above market value.

**The premium**
- For each player j the partner gives, their perceived value is v′_j = v_j × (1 + e_j).
- e_j = e_rank + e_elite:
  - **e_rank** uses j's rank **by market value on the partner's roster**, with ties broken by ROS points: #1 → 0.10, #2 → 0.05, others → 0. Rank by market value, not lineup cost: managers think of "my best players" by name and value.
  - **e_elite** = 0.10 if j is in the top 12 overall by FantasyCalc value in the league's format.
- **Dynasty only:** for a rebuilding partner (P(playoffs) below 25%), halve e for RB and WR aged 27 or older.
- Don't add a separate contender multiplier. Contenders already weigh lineup gains more (n × 1.3).

**Where it's used**
- Use v′ in place of v for the partner's given players when computing the partner's g. The waiver credit is unchanged.
- Parker's own g_mkt and B still use raw values.
- Put every number in config.

**Anchor tests** (default coefficients, W = 752, within ±0.5 points):

| Case | P_accept |
|---|---|
| 1-for-1, equal raw value; partner's #1; top-12; contender; no lineup change | 10.9% |
| 1-for-1, equal raw value; partner's #6; not top-12 | 35.4% (unchanged) |
| Partner gets 4,000 + 3,500 + 3,500 for their #1 top-12 player (9,000); contender; n = 0.6; fills a hole | 23.4% (51.3% before) |
| The same trade, where the RBs help them twice as much (n = 1.2) | 32.8% |
| 1-for-1, equal raw value; partner's #2; not top-12 | 26.3% |
| 1-for-1; partner's #1, not top-12; contender; partner gets 30% more raw value | 62.0% |

**Card reason**, when it applies: "Their best player (or a top-12 player): expect them to want a little extra."

**Calibration:** these values are starting assumptions. In Phase 6, Accepted and Rejected outcomes and "They'd never accept" reports calibrate them: fit a scale factor for e alongside the β refit.

## 2. Realistic targets (League page and search)

- **Tag:** a player with e ≥ 0.15 for his owner (a top-12 player who is also his team's #1 or #2) gets a **"Harder to get"** tag on the League page and on trade cards.
- **Partner rows:** show the best untagged target first. If the single best player for Parker is tagged, show him second. For example:
  - "Best target: X, +3.1/wk"
  - "Bigger upgrade, harder to get: Smith-Njigba, +7.5/wk"
- **Search get pool H (§12):** the top 10 by MV_add(me, j) among untagged players, plus the top 3 tagged players. Star trades are still evaluated and rank on their honest acceptance.

## 3. Bench value (§10)

Parker's own players have two kinds of value beyond the starting lineup.
- **Depth for injuries and byes:** already in B_win, through the scenario lineups (Phase 2, addition C). Keep it there.
- **Trade value for later deals before his Dec 2 deadline:** replace the fixed market-term weight (1.0) in B with a user setting, **"Protect my trade value":**

  | Setting | κ |
  |---|---|
  | Low | 2 |
  | Medium (default) | 4 |
  | High | 8 |

  So B = B_win + κ × clamp(g_mkt(me), −0.5, 0.5). At Medium, giving 25% more value than you get (g_mkt(me) = −0.20) costs 0.8 B, about 0.4 points a week in Parker's league.

The Market check warning (−15%) and the hide threshold (−35%) are unchanged.

## 4. "Offer first / if they say no" (§13 cards)

**Throw-ins**
- A throw-in is a player on Parker's side whose loss costs Parker at most `config.throwInMaxCost` ROS points (default 5) against his free-agent-optimized baseline.
- **Measure that cost with scenario lineups,** so a backup who covers injuries and byes isn't treated as free.

**Every final trade gets two steps:**
1. **If the ranked trade includes a throw-in:**
   - **Offer first:** the lean version without the lowest-value throw-in.
   - **If they say no, add:** that throw-in, which gives the full ranked trade.
2. **If it has no throw-in:**
   - **Offer first:** the ranked trade.
   - **If they say no, add:** the single throw-in from Parker's roster that raises acceptance the most, as long as B stays at least 80% of the offer's B.

**Details**
- Show each step's estimated acceptance.
- Show a step only if it raises acceptance by at least 5 points and the offer-first version is at least 10% likely.
- Evaluate each variant with exact evaluation plus the 1,000-season screening sim, and re-check legality.
- The pitch message uses the offer-first version.
- Ranking stays on the ranked trade's numbers.

## 5. Add to the Checkpoint 4 report

These are in addition to planner-reply-3's list:
- Parker's top 10 **before vs after** this addendum, with the three numbers for each and any "Harder to get" players.
- The Smith-Njigba example under the old and new models.
- The g_mkt(me) distribution for the top 25, before and after.
- How many cards show an "If they say no" step.
