# Checkpoint 4: Trade search, benefit, acceptance, Trade Finder and Analyzer
Status: ⚠️ Done with issues. Every Phase 4 item except draft picks and IR-slot players (both deferred; questions 6 and 11), the Checkpoint 3 answers and both model changes, and the planner's addendum (`planner-reply-3b.md`) are built, tested, adversarially reviewed and running live on your league. The ⚠️ items are a few readings of our own and two model questions the live results raise: the top ideas still have you overpaying in trade value, and the offer-first steps rarely trigger.

## What works
- **Trade search (§12)** in the browser's Web Worker, with a progress bar and Stop: pools, screening with beams, exact evaluation, a 1,000-season screening simulation, a 5,000-season final run on seasons the screening never saw, ranking and diversity (§13), then the words. Deterministic: the same data gives the same ideas.
- **B and the three numbers (§10):** Helps you (B_ref 6), Chance they accept, Overall. Before and after both use every team's free-agent-optimized roster (V*), with pickups judged in the same injury-and-bye scenario lineups B is measured in.
- **Acceptance (§11)** with the addendum's star premium. Plain-English reasons and a copy-ready pitch, from templates.
- **Pages:**
  - **Trade Finder (`/trades`):** sort, a partner filter, risk flags, ROS in/out, required moves, the "Values: FantasyCalc" link, feedback buttons kept in this browser, and "Open in Analyzer".
  - **Trade Analyzer (`/analyzer`):** any trade or counteroffer, up to 4 a side.
  - **Settings (`/settings`):** "Positions I stream weekly", "Protect my trade value", untouchables, must-include and more.
  - **Feedback:** an export file and `npm run feedback:summary`.
- **Checkpoint 3 answers:**
  - B_ref 6.
  - Streaming positions, with "Streaming picks this week".
  - The free-agent optimizer everywhere a trade is scored.
  - Chips show their cost and a "starter" tag.
  - The Q/D/P base rate.
  - ESPN trades refilled from the rosters: Team 6 ↔ Team 10 is rebuilt with no warnings.
- **Addendum:**
  - the star premium;
  - "Harder to get" tags and partner rows ("Best target" / "Bigger upgrade, harder to get");
  - "Protect my trade value" (κ Low 2 / Medium 4 / High 8);
  - "Offer first / if they say no".
- **Variance cut:** title odds are now exact for each simulated season. Noise in a title-odds change fell about 5×, and noise in B about 2×; averages are unchanged.
- **Production check** (2026-10-03 08:15 UTC: a production build, your live league imported through the public link, 375 px, headless Chrome; ⚠️ its harness lives in the session's scratch folder, not the repo, so these browser numbers can't be re-run from it): every page works, with no overflow and no console errors, and every tap target is 44 px after a fix to two Import Report buttons. The "Harder to get" tag never appears on your own players.

## Your league, live (2026-10-03 09:28 UTC, week 4 under way; placeholders. `reports/trade-report.md` has the full cards with reasons and pitches (§1), the full before/after tables (§2) and the g_mkt distributions (§3))
Odds before any trade, counting each team's helpful pickups: playoffs 62.9%, title 11.6%. With rosters as they stand: 67.8% / 13.3%.

| # | Trade | Helps / Chance / Overall | B | ΔPPW reg/playoffs | ΔPO / ΔCH (pts) | ROS get / give | g_mkt you / them | Their n |
|---|---|---|---|---|---|---|---|---|
| 1 | T9: Brock Bowers → Zay Flowers | 65 / 55% / 42 | 6.26 | +3.1 / +2.7 | +11.7 / +4.8 | 210 / 155 | −23% / +30% | −0.93 |
| 2 | T9: Garrett Wilson + David Montgomery → Flowers | 57 / 60% / 40 | 5.12 | +2.2 / +3.5 | +8.3 / +5.0 | 210 / 283 | −25% / +34% | −0.57 |
| 3 | T9: Wilson + Montgomery → Flowers + J. Croskey-Merritt | 66 / 45% / 39 | 6.55 | +3.1 / +3.6 | +10.6 / +5.7 | 320 / 283 | −22% / +28% | −0.57 |
| 4 | T10: Wilson → Jalen Coker + Jaylen Warren | 56 / 50% / 34 | 4.95 | +2.5 / +2.3 | +9.1 / +3.9 | 277 / 148 | −20% / +25% | −0.90 |
| 5 | T1: Wilson + Kyle Monangai → Davante Adams + Isaiah Likely | 43 / 70% / 32 | 3.37 | +1.6 / +2.0 | +6.7 / +3.3 | 273 / 236 | −27% / +37% | −0.48 |
| 6 | T1: Wilson → Adams + Likely | 42 / 70% / 31 | 3.23 | +1.6 / +2.0 | +6.4 / +3.1 | 273 / 148 | −25% / +34% | −0.48 |
| 7 | T8: Wilson + Bo Nix → Christian Watson + Dallas Goedert | 39 / 75% / 31 | 2.97 | +1.6 / +2.3 | +5.6 / +3.3 | 266 / 344 | −27% / +38% | −0.15 |
| 8 | T8: Wilson → Watson + Goedert | 37 / 75% / 29 | 2.78 | +1.6 / +2.3 | +5.2 / +3.0 | 266 / 148 | −25% / +34% | −0.19 |
| 9 | T4: Wilson → Chuba Hubbard + Mike Evans | 60 / 35% / 28 | 5.53 | +2.7 / +2.8 | +8.8 / +4.2 | 295 / 148 | −6% / +7% | −0.27 |
| 10 | T10: Wilson + Monangai → Coker + Ladd McConkey | 26 / 90% / 23 | 1.81 | +1.4 / +1.2 | +5.0 / +2.2 | 272 / 236 | −34% / +51% | −0.12 |

- **Card #1, as shown:**
  - Reasons: "Your WR2 spot goes from 11.2 to 15.3 projected points per week." · "Raises your playoff odds by 11.7 and your title odds by 4.8 percentage points." · "They get 30% more trade value than they give, which makes a yes more likely." · "It costs their starting lineup 4.7 projected points per week, a harder sell." · "Zay Flowers is their second-best player, but even if they rate him a bit above his trade value, they'd still come out ahead." · "Your TE spot drops from 12.3 to 8.5 projected points per week."
  - Pitch: "Hey! Would you trade Zay Flowers for Brock Bowers? Let me know what you think!"
- **Holes:** h = 0 on all ten.
- **Before vs after the addendum**, as Helps / Chance / Overall:
  - #1 69/60/51 → 65/55/42.
  - #2 62/65/48 → 57/60/40.
  - 6 of the before top 10 are still in the after top 10.
  - B fell 0.71 on average (the market term alone). P_accept fell 3.0 points on average (the star premium alone).
  - No "Harder to get" player is in either top 10. The 4 star trades the before list showed fall to 4–14% (2 now Long shots, 2 at Est. 15%, Possible): for example, T5 Wilson + Bowers → Jahmyr Gibbs goes from 12.6% to 3.7%.
- **Realism, top 22 shown:**
  - Trades that ask the partner to give up more than 15% (g_mkt(them) < −15%): **0**. g_mkt(them): min −7.2%, median +25.2%, max +50.6%.
  - Only 22 of the 25 places fill: 17 trades are hidden for B ≤ 0 and 3 by the market guard.
  - Trades with a Market check (you give up more than 15%): **12 of 22**, 9 of the top 10.
  - Median g_mkt(you): −20.1% (−18.2% before the addendum). Market checks: 11 of 21 before, 12 of 22 after.
  - So the search does not favor offers lopsided against partners. It leans the other way: the top ideas give value away to gain lineup points and acceptance (question 1).
  - Garrett Wilson is given in 15 of 22 ideas.
- **The Smith-Njigba example:**
  - The planner's anchor goes 51.3% → 23.4%.
  - On your real rosters all 10 packages of three of your RBs sit at the 2% floor in both models. Team 8 lists RB1 and RB2 as needs, but neither is a §11 hole (a starter below 60% of the median), and every package lowers its lineup.
  - Star trades near even value (−8% to +16% for the partner at market; ⚠️ two chosen by name, plus every star trade the before list showed) fall to 29–45% of their old chance: Bowers + Wilson → Smith-Njigba + Juwan Johnson goes from 16.3% to 4.7%.
  - So the 51% wasn't from your league.
- **"If they say no" steps: 2 of 22 cards live** (0 of 25 on Oct 1's data):
  - T8: Monangai + Nix → Goedert + Carnell Tate: offer it first without Monangai (63.5%), then add him (70.4%).
  - T6: Monangai + Nix → Jadarian Price: 28.0% → 42.5%.
  - Why so few: under §9's waiver credit, a throw-in raises the partner's value only when he's worth more than W × (1 + their gain): about 770–850 here, with partners already gaining 25–38%. Bo Nix ([value]) and Monangai ([value]) barely clear it, the −0.25 logit for an extra player cancels them, and 5 of your 7 throw-ins are under W outright (question 2).
- **Consistency (no B from pickups):**
  - **By construction:** both sides are V*, judged in the same scenario lineups as B.
  - **Tests:** `evaluate.test.ts` (EV) and `evaluate.consistency.test.ts` (scenario lineups) assert ΔPO = ΔCH = ΔEW = 0 exactly for a trade that only reproduces a pickup. `evaluate.addendum.test.ts` asserts B = 0 for dumping a player worth less than W.
  - **Re-check:** all 22 ideas re-run in a fresh Analyzer context match bit for bit.
  - **Known bound:** a sub-3-point swap a trade happens to realize (Bo Nix → Jordan Love, +0.8 lineup pts, B_win +0.13).
- **Acceptance anchors:** 14 of 14 pass: §11's 8 within ±1 point, and the addendum's 6 within ±0.5 (10.91, 35.43, 23.40, 32.79, 26.34, 62.03%).
- **Analyzer example** (great for you, a long shot):
  - The trade: T1, Wilson + Bo Nix → Derrick Henry [Harder to get]. Helps you 89, Est. 5% (model 2.0%), Overall 2.
  - Why so low, in logit terms: value −3.93 (they give up 50% more at market, 77% as they see it with Henry's premium), their lineup −6.0 points a week (−0.73), an extra player (−0.25), contender (−0.22).
- **Free-agent optimizer:**
  - 21 moves, 2.1 a team (0–4).
  - Bo Nix → Team 1: +3.6 (Team 1's own pickups include QB Jacoby Brissett), and at most +5.2 anywhere: not a chip (gap 5.2). At Checkpoint 3, on your data, he added at most +14.9 (gap 0.8). The +83 / +45 quoted then for Team 1 came from a test fixture with synthetic inputs, not your league.
  - McCaffrey's chip gap: 20.7, against 33.1 at Checkpoint 3.

## What doesn't / open issues
- **The overpay pattern survives κ.**
  - Live top-10 median g_mkt(you): −25% at Medium, −24% at High.
  - Break-even κ for today's #1 against the best even trade: 23.5 live (7.6 on Oct 1's data). The top ideas have a real lineup edge (B_win 7.2 against 2.2).
  - ⚠️ Our reading names two drivers. The first is the acceptance value term: it adds +1.20 logits on average, so P_accept runs 52% against 26% at even value. The second is lineup edges from our projections where they sit above the market. Injury-tagged players' base rates come from Sleeper's next healthy week alone (all 19 here are Q, O or IR), and 8 of the top 10 ideas receive one (Flowers is Q). On Oct 1's data the #1 led on acceptance alone (questions 1 and 10).
- **Same free agent on several rosters:** each team is optimized alone, so two teams can count on the same free agent. Mark Andrews is in 7 teams' pickups and Malik Washington in 6 (13 of the 21 moves). A known approximation (§7). Options: hand out each free agent once (by waiver order, or by gain), or keep it.
- **Draft picks are deferred:** the inputs carry no pick values. The setting is kept, with a note (question 6).
- **IR-slot players aren't tradable yet, and their return isn't valued while they sit on IR:** 7 in your league, among them Caleb Williams (QB, Team 1, 223 ROS points) and your Alec Pierce. That leaves out the injured-star buy-low case §6 aims for. Options: allow them in the pools now, with the injured flag, or defer (question 11).
- **Cold load times:** the League page's first load is 9.4 s on a cold server cache (near-week projections and stats refresh every 6 hours, later weeks daily). After that, a first Trade Finder visit takes 5.1–6.8 s with the inputs already loaded (warm: 2.8 s). Options: Phase 7's shared server cache (one user's fetch serves the next), or accept it.

## Decisions I made (⚠️ ours; CLAUDE.md records each)
- ⚠️ **N10:** in B's value terms (the redraft market term and ΔDyn), a player I give counts at least the waiver credit W. Dumping Romeo Doubs scored "Helps you" 28 before this fix.
- ⚠️ **N11:** screening drops a variant that adds a player worth less than W when the lean version screened at least as well. That took such variants from 85 of the 200 exact slots to 3 on Oct 1's data (77 to 9 live).
- ⚠️ **N12:** "Best target" needs at least +1/wk, for a tagged lead too: a "+0.1/wk" best target next to a "+7.2/wk" star read oddly.
- ⚠️ **Lineup basis:** V* judges moves in scenario lineups, so no depth pickup leaks into B. Only the League model's many re-runs, and every run under starter limits, stay on expected-value lineups, for speed.
- ⚠️ **Final simulation:** it uses seasons the screening never saw, which removed a +0.26 bias in the shown B. Finalists are picked with diversity caps one looser than §13's, so the final ranking still has varied trades after the noisy screening (21 of the 25 a full ranking would show).
- ⚠️ **Raw g where it matters:** the veto rule and the screening window read raw g, because league members judge a trade by the market, not by the owner's attachment. The premium ranks every player a team rosters, IR and taxi included.
- ⚠️ **Steps:** thresholds read P_complete, the chance it goes through after a veto. The Analyzer shows steps only for trades that help you and that the market guard doesn't hide, so it never coaches a trade that hurts you.
- ⚠️ **One-partner searches** drop the per-partner cap; they were stuck at 3 ideas.
- ⚠️ **Known limit:** the platform's review period isn't modeled (a trade made before kickoff counts the current week in full).

## Numbers
- **Tests:** 2,667 pass (158 files). Typecheck, lint and `next build` are clean. `check:leaks`: 0 hard, 16 soft, the same as Checkpoint 3.
- **Runtime, Node** (live league, median of 3): context 0.26 s; search 4.63 s (screening 1.68, exact 1.89, screening simulation 0.51, final simulation 0.48, steps and words 0.07); Analyzer 43 ms per trade.
- **Counts:** 12,825 screened, 200 exact, 40 final, 22 shown.
- **Runtime, production browser worker:** first Finder visit 5.1–6.8 s, warm 2.8 s, a one-partner search 0.7–1.4 s, the Analyzer about 1 s first and 0.16 s after. All within the 10 s target.
- **League model:** 0.20 s median with 32 scenarios and 5,000 seasons (0.31 s on a cold first build; Checkpoint 3: 0.15 s). 5,000 seasons take 28 ms in all (12 ms of it simulating), about Checkpoint 3's 27 ms.
- **CLAUDE.md sections changed since Checkpoint 3:**
  - §2.2: ESPN trade refill and vote reading, move positions.
  - §2.9: NFL opponents.
  - §4: `pos`, `refilled`, free-agent ranking.
  - §6: Q/D/P base rate.
  - §7: streaming, the optimizer, chips, legality.
  - §8: exact title odds, two simulation blocks.
  - §10: κ, bench value, N10.
  - §11: star premium, Phase 4 readings.
  - §12: the search as built, N11.
  - §13: ranking, words, steps.
  - §14: pages.
  - §15: config rows.
  - §17: Phase 4 items, the addendum, Phase 6.

## Questions (numbered, each answerable in one line)
1. The top ideas still overpay at κ 4 (live top-10 median g_mkt(you) about −25%, even at High). Keep Medium as the default, make High the default, or keep κ and have Phase 6 shrink our projections toward market values?
2. Offer-first steps show on 2 of 22 cards. Keep them as is, value a throw-in at no less than W for the partner, drop the complexity term for throw-ins, or lower the 5-point bar?
3. Confirm N10 (my given players count at least W in B)? Floor my side only (current), or both sides? Floored on both, an even swap of two cheap players would stop reading as a loss.
4. Confirm N11 (pruning dominated sub-W variants) and N12 (the 1 pt/wk "Best target" floor)?
5. Accept that "no B from pickups" holds only up to about 3 lineup points per player given (largest seen: +0.8)?
6. Defer draft picks to Phase 5? FantasyCalc already values picks, but only Sleeper and MFL report who owns them; redraft leagues like yours are unaffected.
7. Garrett Wilson is in 15 of 22 ideas. Cap how many ideas give the same player of mine?
8. When a card has steps, should feedback record which version you sent (Phase 6)?
9. "Best target" comes from trade chips, so it can differ from the Finder's best ideas (Flowers isn't a chip). Keep it, or reword it as "best of their trade chips"?
10. Injury-tagged players' base rates come from Sleeper alone (all 19 here are Q, O or IR), and 8 of the top 10 ideas receive one. Flag them on cards now, or leave it to Phase 6?
11. IR-slot players: allow them in the trade pools now, with the injured flag, or defer?

## How Parker can try it
```
npm run dev
```
- Open http://127.0.0.1:3000, then Connect → your league link → Import Report (pick your team) → League → **Trades** → **Open in Analyzer** → **Settings**.
- Reports, live: `npm run league:report -- --team 3` and `npm run trade:report -- --team 3`.
- The same trade report from Oct 1's offline copy: `npm run trade:report -- --offline --team 3`.
- These commands rewrite `reports/trade-report.md` and `reports/league-report.md`; `git restore reports` brings back this checkpoint's versions.
- Feedback you've exported: `npm run feedback:summary -- "<path to the file>"`.
