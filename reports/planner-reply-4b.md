# Planner reply to Checkpoint 4b

**Checkpoint 4b is approved.** The blend did what it was meant to. The top-10 median g_mkt(you) went from −22.6% to +2.8%, injury-tagged buys went from 8 to 4, and no trade leans on another team's pickup anymore. The per-game blend and your leave-one-out curve were good calls.

**Before Phase 5, do Phase 4c.** Make the changes below (items 8–12 come from Parker's first look at the site), update CLAUDE.md to match, write a **short** Checkpoint 4c (only what changed, plus the numbers asked for at the end), and stop. Parker plans to send his first offers from the 4c list.

---

## Answers to your questions

1. **Blend per game:** keep it. The partial double count on injured players (A.J. Brown f 0.93) is a mild, conservative bias that we accept on purpose. The market also prices in re-injury risk and rust, and erring against injured players is the safe side of the optimizer's curse.
2. **ESPN waiver order:** use the weekly reset order when the league resets weekly, as Parker's does; use the live order for rolling waivers. The baseline must not depend on which day someone imports.
3. **Plan B:** keep your rule (at least 5 points likelier than its card). A "try again" offer they're less likely to accept makes no sense.
4. **Wilson:** keep the cap of 3, and add the pattern note (change 6).
5. **Long shots:** replaced by Parker's minimum-chance filter (change 10). Show a model value under 5% as "<5%", never rounded up to 5%.
6. **Throw-ins:** leave them out of both sides' totals (change 2), so a throw-in worth less than a free agent can never raise acceptance.
7. **Released pickups going to nobody:** OK, as a known approximation.
8. **OUT players and IR slots:** OK for now. Moving OUT players to open IR slots is a Phase 6 item.
9. **Model inputs for the sent version:** yes, store them in feedback now, so Phase 6 can refit on the version actually sent.

**Also approved:**
- dynasty blend values from the format's own list
- the claim rules
- the Plan B rules
- the IR rules
- the K/D-ST refill rule
- removing the before/after variants

---

## Phase 4c changes

### 1. Close the search gap (§12)
- Wilson → Hubbard + Evans rates level with today's #1, but the search never built it. Beam extension misses two-player packages when neither half helps on its own.
- **Add exhaustive candidate generation per partner,** on top of the beams:
  - every 1-for-2 and 2-for-1 from the give and get pools
  - every 2-for-2 from the top 6 of each pool
- Everything new goes through the same screening and funnel.
- **Raise the final-simulation finalists from 40 to 60,** so caps and filters still leave a full list.
- Report the new screened count and runtime, and confirm Hubbard + Evans (or better) is now found.

### 2. Throw-ins worth less than a free agent are neutral (§9, §11)
- **Rule:** before computing either side's g and the market term, drop any player worth at most W who's on the side giving more players, together with his roster-spot credit. Then apply the usual floor and credit to what's left.
- He still counts as an extra player (c), and roster legality still handles the partner's drop.
- **Result:** such a throw-in can only lower acceptance.

### 3. One value number per card (§13)
- Cards use FantasyCalc's raw values, the number a leaguemate can check, in both the reasons and the pitch. For example: "By FantasyCalc's trade values, they get 18% more."
- The model's floored and premium-adjusted figures stay internal; the Analyzer can show them under "Details."
- The pitch mentions value only when the partner's raw gain is +5% or more.

### 4. Cap the blend factor (§6 step 8)
- Clamp f to [0.75, 1.35]. Extreme factors are where data glitches and market hype concentrate.
- Checkpoint 4c lists the 10 most extreme factors before the clamp, with the reason for each (for example: a fallback base rate, a rookie role change, an injury, hype), and which ones hit the clamp.

### 5. Waiver order (§7)
- Use the weekly reset order or the live order per answer 2, and show it in the Import Report as "Waiver order used: weekly reset."

### 6. Pattern note (§13 Trade Finder)
- When at least 5 of the **uncapped** top 10 give the same player of Parker's, show one line above the list, built from the model's actual drivers. For example: "Most of your best ideas trade Garrett Wilson: his bye is in week 13, your riskiest week, and the players you'd get have byes in weeks you're favored to win."
- Don't invent a reason. Use the drivers that most often account for the B gain:
  - bye-week coverage, including where the incoming players' byes land
  - lineup slot gains
  - injury cover from the scenarios

### 7. Feedback (§11)
- Store the sent version's model inputs (g, n, h, c, a, hist, ctx, premium, B) with each outcome.

### 8. Goal setting: the title comes first (§10)
Parker's main goal is winning the title. Make the B weights a per-league setting called **"What matters most"**:

| Option | ΔPO weight | ΔCH weight |
|---|---|---|
| **Win the title** (default) | 0.15 | 0.85 |
| Balanced | 0.35 | 0.65 |
| Make the playoffs | 0.70 | 0.30 |

- Keep B_ref at 6. Uniform gains move ΔPO and ΔCH about equally in Parker's league, so the scale barely changes. Confirm this in Checkpoint 4c.

### 9. Real odds on every card (§13, §14)
"Helps you" alone means nothing to a user. Next to it, show:
- **"Title odds 12.1% → 13.4%"** and **"Playoff odds 65% → 69%"**, from the same runs that produce B.
- **Win chance by week:** the weeks whose win chance moves by 3 or more points, up to 4 weeks, in week order. For example: "Week 9: 68% → 64% · Week 13: 42% → 55%."

Parker's question is whether a trade just moves his bye problem from week 13 to another week. The simulation already nets out every week, and this line makes that visible.

Other requirements:
- **One baseline everywhere:** the League page's headline odds and the cards' "before" numbers come from the same baseline, the one with every team's pickups. Show "as rosters stand" as a smaller second line on the League page.
- **Explain once,** in a tooltip or info line: "Helps you (0–100) sums up how much your title and playoff odds rise, minus a cost for giving away trade value."
- **The Analyzer** shows the same odds and weekly lines.

### 10. Minimum-chance filter (§13)
- Add a control on the Finder: **"Chance they accept: at least Any / 10% / 20% / 30% / 40% / 50%."** The default is 10%, and it's saved per league. It replaces the hide-under-10% rule and the long-shot toggle.
- **Apply it before the diversity caps,** so the list fills with trades that qualify.
- **Re-filter instantly** from the finalists, without re-running the search.
- If fewer than 5 ideas qualify, say so and suggest a lower setting.

### 11. Multiple leagues (§14)
- **Save** any number of imported leagues in the browser (IndexedDB), across ESPN and Sleeper now, and every platform later.
- **Switch leagues** from a dropdown at the top of every page, showing the league name, platform and season. Default to the last league used.
- **Manage leagues:**
  - an "Add league" button
  - "Remove" with a confirmation
  - Sleeper: pick several leagues at once from the username's list
  - one set of ESPN cookies covers all of that account's leagues
- **Per league:** "my team", every setting (stream positions, trade value, goal, filters, untouchables), stored model inputs and feedback.
- **Migration:** move the current single saved import, settings and feedback into the new per-league store, so Parker doesn't lose anything.

### 12. FantasyCalc stays the market source; add resilience (§2.9)
- **Keep FantasyCalc** as the only market-value source. It's built from real trades, comes in each league's exact format, and tested best among the free calculators. Player value already combines three sources: Sleeper and ESPN projections, blended with FantasyCalc.
- **There's no good free second source of redraft trade values.** KeepTradeCut has no API, and its terms forbid scraping. FantasyPros needs a paid key and allows personal use only. DynastyProcess values are dynasty-only, expert-based and GPL-3.0.
- **Fallbacks:** if FantasyCalc is unavailable, use the last archived values for up to 7 days, with a "values from <date>" note. After that, use the model's own value curve, with a clear banner. Test both paths.
- **Phase 7 checklist:** the DynastyProcess ID map is GPL-3.0. Keep it server-side, credit DynastyProcess, and review the license before any downloadable or app-store version.

### Phase 6 additions
- **Base-rate stability:** one projection refresh moved Parker's playoff odds by 10 points. Measure day-to-day odds swings that injuries and results don't explain, and smooth the base rate if they're large (for example, average the last 2–3 pre-game projections).
- **OUT players to IR:** teams move OUT players into open IR slots.
- **A second dynasty value source:** consider DynastyProcess for dynasty leagues (a median after normalizing), but only after a license review.

---

## Checkpoint 4c (short) must include
- **Parker's top 10** under "Win the title":
  - the three numbers, title and playoff odds before → after, and the weekly lines
  - injury tags, Plan B and offer-first counts
  - the pattern note, if it shows
- **The goal setting:** how the top 10 changed from Balanced to "Win the title."
- **The search gap:** confirmation that Hubbard + Evans (or better) is found, plus the new screened count and runtime.
- **The blend:** the 10 most extreme factors before the clamp, with reasons.
- **Odds:** Parker's odds with the weekly reset waiver order, on the one shared baseline.
- **Multiple leagues:** that the migration kept Parker's settings and feedback, and that switching leagues works (with one test league added).
- **Anything else that looks off,** in one paragraph.
