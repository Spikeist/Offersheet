# Planner reply to Checkpoint 4

**Phase 4 is approved as built.** The search, the pages, the reasons, the consistency tests and the honest ⚠️ notes are all good work.

**Before Phase 5, do a short Phase 4b.** The live results show the model isn't ready for Parker to act on yet. Make the changes below, update CLAUDE.md to match (list the sections you changed), write Checkpoint 4b, and stop.

---

## What the live results tell us

The top ideas mostly do two things:
- **Sell Garrett Wilson** (in 15 of 22 ideas). The market values him well above our projection.
- **Buy injury-tagged players** (8 of the top 10). The market discounts them, while our base rate assumes they return at full strength.

The search ranks about 12,800 trades by our own model's edge, so the top of the list fills with the places where our projections disagree most with the market. Those are disproportionately places where our projections are wrong. This is the optimizer's curse: rank many options by noisy estimates, and the winners are biased toward the biggest estimation errors.

So the fix is to shrink our projections toward the market, not to raise κ. Your break-even κ of 23.5 shows that κ can't fix it.

The acceptance side has the matching problem. Card #1 shows 55% even though it costs Team 9's lineup 4.7 points a week. In redraft, a manager's own lineup should weigh more than that.

---

## Phase 4b changes

### 1. Market-blended projections (§6, new final step)
- **Who:** QB, RB, WR and TE players with a real FantasyCalc value (not estimated). Everyone else gets w = 0.
- **The curve:** for each position, fit a monotone increasing curve R_pos(v) by regressing our ROS points on market value. Use every player at that position with a real value, rostered or free agent. Use redraft values in the league's format; dynasty leagues use redraftValue here too, since B_win is about this season.
- **The blend:** ROS′ = (1 − w) × ROS + w × R_pos(v), with w = `config.marketBlend` = 0.5.
- **Applying it:** scale the player's weekly projections p[i,w] by ROS′ / ROS, so bye weeks, availability and week shape stay intact. If ROS = 0, leave it at 0.
- **Where it applies:** every player in the league model, including free agents, needs, chips, V*, both lineups in every trade, and the sim.
- **On the player detail view:** "Our projection 210 · Trade market 170 · Used 190."

### 2. Acceptance rebalance (§11)
- **β_need:** 1.2 in redraft and keeper leagues; dynasty stays at 0.6. Put both in config.
- **Cap:** lower the P_accept cap from 0.95 to **0.85**. No offer is a sure thing.
- **Replace the anchor tables** with these values (within ±0.5 points):

  | §11 case (redraft) | New | Old |
  |---|---|---|
  | Even value; n = 0.5; fills a hole; active | 67.9% | 61.1% |
  | Even value; nothing else | 35.4% | 35.4% |
  | g = −0.10; n = 0.5; fills a hole | 37.8% | 31.0% |
  | g = −0.20; nothing else | 8.3% | 8.3% |
  | g = +0.15; n = −0.3 | 48.5% | 53.0% |
  | Even value; inactive (a = −2) | 21.4% | 21.4% |
  | 3-for-1 (c = 2); even value | 25.0% | 25.0% |
  | g = +0.30; n = 0.5 | 85.0% (cap) | 81.8% |
  | Dynasty: even value; n = 0.5; fills a hole; active | 61.1% | 61.1% |

  | Star-premium case (redraft) | New | Old |
  |---|---|---|
  | 1-for-1, equal raw; their #1; top-12; contender | 10.9% | 10.9% |
  | 1-for-1, equal raw; their #6 | 35.4% | 35.4% |
  | 4,000 + 3,500 + 3,500 for their #1 top-12 (9,000); contender; n = 0.6; hole | 32.8% | 23.4% |
  | The same with n = 1.2 | 55.4% | 32.8% |
  | 1-for-1, equal raw; their #2 | 26.3% | 26.3% |
  | 1-for-1; their #1, not top-12; contender; +30% raw | 62.0% | 62.0% |

### 3. One free agent, one team (§7)
- **Baseline:** allocate free agents once. Process teams in waiver order when the platform reports it:
  - ESPN: check the team data for a waiver rank
  - Sleeper: `settings.waiver_position`
  - FAAB leagues: remaining budget, highest first
  - otherwise: in order of each team's best available gain

  Each team in turn runs the optimizer (up to `faMaxMoves`) against the pool minus the free agents already taken.
- **Trade evaluation:** the two trading teams re-optimize against the pool minus the free agents allocated to the other teams. Every other team keeps its baseline allocation.
- **Streaming slots** are unchanged: the streamRank-th best already allows for competition.

### 4. Value floor at W on both sides (§9 and §10; replaces N10)
- In every market-value sum, count each player at max(v, W). That covers B's market term, ΔDyn and the partner's g.
- **Results:**
  - An even swap of two sub-W players → g = 0 for both sides.
  - Dumping a sub-W player for nothing → g = 0.
  - A sub-W throw-in adds 0 value, and the extra-player term still applies.

### 5. IR players (§6, §7, §12)
- **Team strength:** from his expected return week, an IR player joins his team's lineup pool. If the active roster would go over its limit, auto-drop the lowest keep-value bench player (§7). This applies to every team and to the sim.
- **Trades:** IR players may appear in both pools, with the injured flag.
- **Legality:** a received IR player goes into an open IR slot if he's eligible. Otherwise he takes an active roster spot, and auto-drop applies.
- The blend (change 1) applies to them too, so the market's injury discount is part of the projection.

### 6. Cards and pages (§13, §14)
- **Injury flags:** show one for every injury-tagged player on either side, for example "Questionable" or "Out — expected back week 8". When an incoming player is tagged, add the reason: "His projection assumes he returns at full strength, blended with the trade market."
- **Plan B ("If they say no, try:")** when the card has no qualifying throw-in step:
  - Show the best other evaluated trade with the same partner that differs in at least one player, has B > 0 and Helps you at least 50% of the card's, and isn't hidden by the market guard.
  - Prefer a different package for the same partner player(s); otherwise pick a different target.
  - Show its three numbers and an "Open in Analyzer" link.
- **Diversity:** at most 3 trades in the top 20 that give the same player of mine.
- **League page partner rows:**
  - Reword "Best target" to "Best of their trade chips".
  - Add "See trade ideas with Team X →", which opens the one-partner Finder search.
- **Feedback** records which version was sent: offer-first, full or Plan B.

### 7. Small items
- **Browser check:** commit the production browser-check harness to `scripts/` and add `npm run check:browser`, so it can be re-run.
- **FantasyCalc archive:** archive the daily FantasyCalc values for the league's format into `data-local/`, next to the projection snapshots, for a Phase 6 backtest of `marketBlend`. Do it only if it's consistent with the FantasyCalc terms you quoted in Phase 0; otherwise skip it and say so.

---

## Answers to your questions

1. **κ:** keep Medium as the default. The overpay comes from projection-vs-market gaps and the acceptance value term, so fix those now (changes 1 and 2), not in Phase 6.
2. **Offer-first steps:** keep the throw-in rules. In a 10-team league with a deep waiver wire, a throw-in worth less than the best free agent really adds nothing. Plan B (change 6) gives most cards a "try again" step.
3. **N10:** replaced by the floor on both sides (change 4).
4. **N11 and N12:** confirmed.
5. **Up to about 3 lineup points per player from pickups:** accepted.
6. **Draft picks:** yes, defer them to Phase 5.
7. **Same player given in many ideas:** yes, cap it at 3 in the top 20.
8. **Which version was sent:** yes, record it now and analyze it in Phase 6.
9. **"Best target":** reword it and add the link (change 6).
10. **Injury-tagged players:** flag them now (change 6). The blend (change 1) fixes the bias.
11. **IR players:** allow them now, and count their return in team strength (change 5).

**Also:**
- Cold load times: accept them until Phase 7's shared cache.
- The review period: model it in Phase 6.
- After 4b, the order stays Phase 5 → 6 → 7.

---

## Checkpoint 4b must include
- **Parker's top 10:** before (Checkpoint 4) and after, with the three numbers, injury flags, how many receive an injury-tagged player, and how many give Garrett Wilson.
- **Blend sensitivity:** median g_mkt(you) for the top 10 and the top 25 at `marketBlend` 0, 0.25 and 0.5.
- **Parker's odds over time:** Checkpoint 3 (78.6% playoffs / 19.7% title), Checkpoint 4 (67.8 / 13.3 with rosters as they stand; 62.9 / 11.6 with pickups), and now. Explain the moves by cause: roster and injury news, streaming, the pickup baseline, and model changes. A drop that big needs a clear cause.
- **Free-agent allocation:** how many duplicate pickups went away, where Mark Andrews lands, and whether any top trade still depends on a pickup another team would make first.
- **Cards:** how many show Plan B, and how many show an offer-first step.
- **Tests:** the new anchor tables pass.
- **Runtime:** total, and per stage.
