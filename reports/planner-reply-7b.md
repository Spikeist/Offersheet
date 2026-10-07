# Planner reply to Checkpoint 7b

**Checkpoint 7b is approved,** and so are the follow-ups in `dfa4f5c`. Don't tag `dfa4f5c` separately: Checkpoint 7c's tag will include it.

**Launch stays Tuesday, October 13.** Production still waits for Parker's explicit "go."

**Next:** do these in order, update CLAUDE.md to match, write a short Checkpoint 7c (the launch candidate) and stop. Aim to finish by Sunday, October 11, so there's a day for review.
1. The answers to questions 3–7 (section 1)
2. The production deploy script (section 2)
3. The privacy and terms edits (section 3)
4. The review notes (section 4)
5. Same-position pickups (section 5)
6. League prizes (section 6)
7. The "Helps both" sort (section 7)

Items 6 and 7 don't block launch. If either isn't done and tested in time, ship it in the first update after launch.

---

## 1. Answers to questions 3–7

3. **Dynasty and keeper: no market term.** Keep it that way. B_future already counts trade value in those leagues, so a second term would count it twice.
   - In those leagues, hide "Protect my trade value."
   - In its place, show: "In dynasty and keeper leagues, the Win now ↔ Future slider covers trade value."
4. **Daily rest-of-season levels: yes,** if they come only from public projections: standard scoring formats only, never per league, and never blended with trade values. Keep them 730 days, like the other snapshots.
5. **Value ratios in feedback:**
   - Keep them in the anonymous server copies. Those are internal and needed for calibration.
   - Leave them out of the export file users download, since users can open it.
   - Keep the feedback page's sentence about the export accurate.
6. **+4.1 vs +3.3: no, show one number,** the unweighted one, in both places. §6.1 keeps the points users see unweighted.
7. **Privacy length: fine.** The planner has read the final text. The edits are in section 3.

## 2. Production deploy: yes to `npm run prod:deploy -- --live`

- **The exception:** add it to CLAUDE.md. Production deploys only through this script, and only after Parker writes "go." `vercel --prod` stays forbidden.
- **What it deploys:**
  - only the approved launch tag (Checkpoint 7c's), from a clean copy of that tag
  - with the preview script's checks: committed files only, the upload allowlist and the leak scan
- **Before uploading,** it confirms that every variable the app reads in production is set for Production (names only). That includes:
  - `SESSION_SECRET` and `CRON_SECRET`
  - the store's variables
  - `CONTACT_EMAIL`, if it's a variable
- **Dry run:** without `--live`, it runs every check and stops before uploading. Put the dry run's output (names only) in Checkpoint 7c.
- **After deploying,** it checks:
  - `/api/health` shows the shared store
  - every page answers 200, with the FantasyCalc link in its HTML and no third-party scripts
  - the cron route answers 401 without the secret
- **Rollback:**
  - The launch-day steps say how to put the landing page back quickly if something goes wrong.
  - The script prints those steps when it finishes.

## 3. Privacy and terms: approved, with small edits

The planner read the final text in `reports/privacy-terms-draft.md` (2026-10-07). It's accurate, honest and easy to read, and the review against the code paid off. Make these edits:
- **Your rights:** on the privacy page, add this line before "Contact": "Email us to ask what we hold about you or to have it deleted."
- **Prizes (section 6):** the anonymous copy holds the reward setting as shares only. Replace "how you weigh the title against the playoffs" with "how your league splits its prizes (as shares, never amounts)."
- **Daily levels (question 4):** extend the archive sentence to cover them.
- **Helps them (section 7):** when it ships, add it to the terms' list of estimates.
- **Word cap:** raise the test's cap to 1,300 words to fit these.

## 4. Review notes

- **Your ⚠️ decisions are accepted:**
  - one ω
  - the scaled thresholds
  - sessions
  - the two waiver-view decisions
- **Also accepted:**
  - no smoothing and no CDN route for launch
  - the open issues as they stand: partial imports, Sam Hartman and the build cap
  - the cron fetching a format's FantasyCalc list itself, at most once a day and only for formats in use. Parker's first email to FantasyCalc described these daily copies.
- **Phase 6 addition:** model other teams' pickups with ω₀, so a user's goal never changes how other teams behave.
- **The firewall limit:** confirm that 80 requests per 10 minutes sits above the app's own per-IP limits, so a normal user always sees the app's own message first.
- **Security:** in Checkpoint 7c, list the five accepted or noted findings, one line each.

## 5. Same-position pickups (Parker's request)

When a trade leaves a team with an open roster spot, the card can name a free agent at a different position from the one given up. Parker would rather replace the position he gave up.

This is also the better model:
- Any big upgrade at another position is already in the baseline's pickups. So the open spot only adds a small extra there.
- It also makes the card read as if the trade depends on an unrelated pickup.

The changes:
- **Rule:** fill each open spot with the best available free agent at a position where the team gave more players than it received. "Best" means the largest gain in the scenario lineups, then the most rest-of-season points.
- **Several open spots:** fill them one at a time, each from the positions still short.
- **Fallback:** only if no free agent is available at those positions, use the best at any position.
- **Both teams:** the rule applies to the partner too, so it also changes their lineup gain, the chance they accept and Helps them.
- **The card says:** "Open roster spot: add X, the best available RB."

## 6. League prizes (replaces the three options from 7a §5.2)

Parker's league pays the top 3 places, plus a small prize for each week's high score. "What does your league reward?" becomes:
- **Only the champion:** the default, unchanged. Many leagues pay nothing, or only the winner.
- **Several prizes:** the user enters the league's prizes:
  - 1st, 2nd and 3rd place
  - the weekly high score, paid each regular-season week
  - the most points in the regular season
  - Helper line: "Enter each prize in dollars or percent, the same way for all. Only the split matters. Leave blank what your league doesn't pay."
  - Prefilled: 60 / 30 / 10, with the rest blank.
- **Making the playoffs:** unchanged.
- **Keep the bubble helper line.**

### The math
- **S** = the share of the league's prizes a team wins this season.
  - Each prize's share = its amount ÷ the total of all prizes.
  - The weekly prize counts once per regular-season week in that total.
- **B_win** = 100 × (0.15 × ΔPO + 0.85 × ΔE[S]).
  - "Only the champion" is this formula with 1st = 100%, so today's numbers don't change.
  - "Making the playoffs" stays 0.70 × ΔPO + 0.30 × ΔCH.
- **The simulation adds:**
  - **2nd place:** the losing finalist.
  - **3rd place:** simulate the 3rd-place game when the league has one.
    - Check the platform data: ESPN's playoff schedule, including last season's, and Sleeper's winners bracket.
    - If the data doesn't say, assume there's one, and say so in the Import Report.
  - **Weekly high scores:** each remaining regular-season week's high score, with ties split. High scores already won stay as they are.
  - **Points leader:** the regular season's points leader.
- **Everything follows E[S]:** B₃, Helps you, Overall, the automatic playoff weight and Helps them all use it, so +3 points a week still reads 63.
- **Odds lines:** when 2nd or 3rd place pays, cards and the League page add "Top 3 odds" (or "Top 2 odds").
- **Migration:** a league saved with "Top finishers too" becomes "Several prizes," with the prefilled split.
- **Feedback:** the anonymous copy holds only the shares, rounded to whole percents, never the amounts.

## 7. The "Helps both" sort (Parker's request)

Parker wants to sort by how much a trade helps him, keeping only trades that also help the team he's trading with.

### Helps them (0–100)
This is the partner's version of Helps you, from the same simulation runs.
- **Redraft:** B_P = the partner's B_win under the league's reward setting (section 6), with no trade-value term.
- **Dynasty and keeper:** B_P = (1 − λ_P) × B_win,P + λ_P × B_future,P. λ_P is §10's default for the partner's playoff odds (keeper: 0.2).
- **Scale:**
  - B₃,P = the B of +3 points a week for that partner, on the same baseline with the same common random numbers, floored at 0.5. Compute it once per league model build.
  - Helps them = 100 × (1 − e^(−B_P / B_ref,P)).
  - B_ref,P = B₃,P in redraft, and (1 − λ_P) × B₃,P + λ_P × 4 in dynasty and keeper.
- **A trade "helps both"** when Helps you > 0 and Helps them ≥ 10 (`config.helpsThemMin`). A score of 10 is about +0.3 points a week for them.

### The sort
- **The option:** add "Helps both" to the sort menu. It shows only trades that help both teams, sorted by Helps you, highest first.
- **Filters:** the chance filter and the diversity caps still apply.
- **Helper line:** "Trades that help them too, sorted by how much they help you."
- **Fewer than 5:** say "Only N trades help both teams right now." If a lower chance filter would add more, suggest it.
- **Finalists:** so this sort has enough candidates, add to the final simulation the top 20 by Helps you among trades that help both on the screening run. Check again on the final run that each one still helps both.

### Cards and the Analyzer
- **Tag:** cards that help both get a small "Helps both" tag in every sort.
- **The odds section** adds their lines next to yours: "Helps them 24 · Their title odds 6.0% → 6.9%," plus their other odds lines in the same format as yours.
- **The Analyzer** shows the same.
- **Tooltip:** "Helps them uses the same scale as Helps you, from their side. Both teams can gain when each fills the other's weak spot. Helps you already counts the cost of making them stronger."
- **No FantasyCalc numbers** anywhere in it.

---

## Checkpoint 7c (short) must include
- **What changed,** briefly.
- **The `prod:deploy` dry run:** its output (names only).
- **Privacy and terms:** the changed sentences, quoted.
- **Pickups:** Parker's trades that leave him an open roster spot, with the pickup before and after the change.
- **Prizes,** using the prizes Parker gives for his league:
  - how 3rd place is decided in his league
  - his odds of 1st, 2nd and 3rd
  - his B₃
  - how his top 5 changed from "Only the champion"
- **Helps both:**
  - how many of Parker's trades help both
  - his top 5 under the new sort, with Helps you, Helps them and the chance they accept
  - the extra runtime
- **Security:** the five accepted or noted findings, one line each.
- **Launch day:** the final launch-day steps, in order, including the rollback.

On approval, tag 7c. That tag is what production deploys after Parker's "go."
