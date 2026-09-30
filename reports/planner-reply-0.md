# Planner reply to Checkpoint 0

**Checkpoint 0 is approved.** This was thorough work, and the scoring oracle results are exactly the proof we needed.

**What to do now:**
1. Apply the decisions below.
2. **Update CLAUDE.md to match them.** Keep the edits minimal and precise, and list every section you changed in Checkpoint 1.
3. Start Phase 1.

---

## Answers to your questions

**1. Sleeper league.** If Parker has filled in `SLEEPER_USERNAME` in `.env.local`, run `npm run probe:sleeper` and build Phase 1 against his league. If it's still blank, he has no Sleeper league to test with, so keep using the public test league.

**2. Strangers' fixtures.**
- Move the full sanitized fixtures of strangers' leagues out of git, into git-ignored `data-local/`.
- Commit only minimized fixtures: just the fields the tests read, a subset of each roster, and shifted timestamps.
- Nothing has been pushed yet, so rewrite local history so those full fixtures appear in no commit.
- From now on, no new crawls of strangers' leagues without asking first.

**3. ESPN pointsOverrides.** Yes. Key them by the player's `defaultPositionId` → position, and treat the value as a replacement for the base points, not an addition. Fix §2.2 to say so.

**4. Scoring model.** Yes, extend it.
- `Scoring` gets general rules:
  - per-unit
  - threshold bonus
  - range buckets (for example D/ST points allowed 14–17)
  - stepped tiers (points for every N units)
  - bounded min–max
  - composite stats (for example pass + rush yards)
  - per-game constants
- `LeagueSettings` gets per-position starter min–max (for MFL) and roster minimums. The lineup solver must honor both.
- **For projections:** evaluate threshold, range and tier rules as expected values over a distribution around the projected stat. Use a normal distribution with a per-stat SD from config. For D/ST points allowed, use an SD of about 9 points.
- The oracle tests must cover every rule type.

**5. Positions.**
- Add P to `Pos`.
- Map ESPN TQB → QB, with an Import Report warning.
- Treat HC as unmapped, with a warning.
- Exclude P, K, DEF and HC from trade search by default.

**6. Injuries (§6).** Avoid double counting by separating *how good he is when he plays* from *whether he plays*:
- **Base rate:** use the player's most recent **healthy** projection, meaning the latest week the source projected him while active. Fall back to his season projection per game. Never use an injury-zeroed projection as a base rate. That would make an injured star look worthless for the rest of the season, which is exactly the buy-low case we want to find.
- **Availability:** comes only from our injury table in config, applied once.
- **Byes:** come only from the NFL schedule. An empty ESPN entry doesn't mean a bye.
- **Week shape (m):** uses Sleeper's future weeks for healthy players. Use m = 1 in weeks where a source zeroes a player for injury.
- Map DAY_TO_DAY → QUESTIONABLE.

**7. Unvalued players (§9).**
- Estimate their value from projections. For each position, fit a monotone curve of FantasyCalc value against rest-of-season projected points, using the players who have values. Extrapolate to the unvalued players.
- Cap the estimate at the lowest real value at that position.
- If fewer than 10 players at a position have values, use min(valueFloor, lowest real value) instead.
- **Item M:** report the ID match rate and the has-a-value rate separately. The ID match target stays at ≥ 98%.

**8. FantasyCalc attribution.** Yes, add the small "Values: FantasyCalc" link to trade cards and the League table. Also add "email FantasyCalc before public launch" to the Phase 7 checklist.

**9. Sleeper guillotine leagues (type 3).** Reject them at import for the MVP, with a friendly message.
- Best-ball leagues are allowed, with an Import Report note that lineups are set automatically. Our optimal-lineup model fits them.
- Handle re-seeded playoffs through item 11.

**10. Sleeper trade review.** `veto_auto_poll = 1` → `league_vote`; anything else → `none`. Position limits apply to the active roster only (IR exempt).

**11. Playoff seeding.** Yes. Model re-seeding (Sleeper `playoff_seed_type 1`) and division-winners-first seeding whenever a platform reports them. Otherwise use default seeding and show a warning.

**12. ESPN trade settings.** Trust what the API reports unless Parker says otherwise. DAY_TO_DAY → QUESTIONABLE: yes.

**13. Fleaflicker rules page.** Read the public HTML rules page with a tolerant parser, and cache it for 24 hours. If parsing fails, the Import Report asks the user for those settings.

**14. Projection sources.**
- **MFL:** don't average. Use Sleeper × league rules as the primary source, since your scoring engine matches MFL 604/604. Log MFL's own projection only as a sanity check.
- **ESPN:** keep averaging ESPN and Sleeper × rules only if they agree within 10% on average across the league's rostered players. Otherwise use Sleeper × rules and say so in the report.

---

## Other notes on the report

- **Wrong season (ESPN 404 GENERAL_NOT_FOUND):** show "league not found for that season," and update §2.2.
- **Parker's ESPN league is public,** so it needs no cookies at all. Test the private-league error paths with mocks for now; a real private-league test can come later.
- **Sleeper players DB (14.7 MB):** fetch it with position and active filters, cache it for 24 hours, and never send the whole thing to the browser.
- **MFL deadline and review settings** are hidden from non-owners. Show "unknown" in the Import Report and let the user fill them in.
- **FantasyCalc `numTeams=16`:** map it to the nearest supported value (14), and note the substitution in the Import Report.
- **Keep:** the pre-commit leak check, the ✅/⚠️ rules, and the adversarial review pass. All three are working well.

---

## New product decisions

These are Parker's ideas, and they're approved.

### A. Three numbers on every trade

| Number | What it is | Formula |
|---|---|---|
| **Helps you** | How much the trade improves your team, 0–100 | The Trade Score from §10: round(100 × (1 − e^(−B/5))) |
| **Chance they accept** | Estimated %, labeled "Est." | P_complete from §11 |
| **Overall** | The expected gain, 0–100 | round(100 × (1 − e^(−(B × P_complete)/5))) |

- **Overall** is how much a trade helps, discounted by the chance it actually happens. It's always at or below Helps you.
- Sample values:

  | Helps you (B) | Chance they accept | Overall |
  |---|---|---|
  | 63 (B = 5) | 50% | 39 |
  | 86 (B = 10) | 30% | 45 |
  | 45 (B = 3) | 80% | 38 |
  | 80 (B = 8) | 60% | 62 |

- Users can sort by any of the three. The default sort is Overall.
- **Don't add extra factors to Overall.** Trade-value fairness, injuries, the number of players, manager activity and season context already feed into B or P_complete. Counting them again would double count and make Overall harder to explain.
- Show risk flags separately, such as "depends on an injured player" and "Market check."
- Update §10 and §13. The Section 13 sort options become Overall / Helps you / Chance they accept.

### B. Feedback on every suggestion

This model will be wrong in places. That's especially true of the acceptance estimate until it has real results to learn from, so we want users to tell us.

**On each trade card:**
- Outcome buttons: **Sent**, **Accepted**, **Rejected**, **Countered**
- A **Report** button, with these reasons:
  - Doesn't help me
  - They'd never accept
  - Player info is wrong (injured, traded, wrong position)
  - League settings look wrong
  - Other, with an optional note

**Phase 4 (local only)**
- Store each report and outcome in the browser, together with the trade's model inputs and scores.
- Export them as JSON.
- Add a script that summarizes reports by reason and by model part.

**Phase 7 (public launch)**
- Send reports and outcomes to a small server-side store on a free tier.
- **Store only anonymized data:**
  - player IDs and positions
  - league format settings
  - model inputs and scores
  - the reason and the outcome
- **Never store:** league IDs, team names, owner names, usernames, SWIDs or cookies.
- Say so plainly in the UI and in the privacy policy, and give users an opt-out toggle.
- Rate-limit submissions.

**How we use the data**
- "They'd never accept" and Rejected outcomes → refit the acceptance coefficients (§11).
- "Doesn't help me" → review the benefit and projection logic for those cases.
- "Player info is wrong" and "League settings look wrong" → a bug queue for the adapters.

### C. How users connect ESPN leagues

ESPN leagues are **private by default**, and only the league manager can make one viewable. That setting is under League → Settings → Basic Settings → "Make League Viewable to Public."

1. The user **pastes their ESPN league link** (or just the ID). If the league is viewable to the public, as Parker's is, they're done.
2. **If the league is private,** offer two choices:
   - **Ask the commissioner** to turn on "Make League Viewable to Public." Give the user a copy-ready message to send. Once it's on, everyone in that league can connect with just the link, including on phones. Mention that it lets anyone with the link view league pages, but doesn't let them join.
   - **Connect with ESPN cookies** (desktop only). Walk them through it step by step, following the rules already in the spec (§0.5, §3 and Phase 1).
3. **Phase 7, before public launch:** build an Offer Sheet Chrome extension.
   - It reads the two ESPN cookies with one click, using the `cookies` permission scoped to `*.espn.com` only.
   - It sends them only to Offer Sheet's own site, over HTTPS, and only when the user explicitly clicks.
   - Plan for the Chrome Web Store listing, which has a one-time developer fee.
4. **Never ask for ESPN passwords.**

---

## Then

Update CLAUDE.md, then start Phase 1.
