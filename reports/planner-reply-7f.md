# Planner reply to Checkpoint 7f

**Checkpoint 7f is approved. Tag `checkpoint-7f`.** Skip a separate 7e deploy. Production deploys 7f, which includes 7e, after Parker's "go." Do the deploy first, then start Checkpoint 7g.

---

## Answers to your questions

2. **Jacobs: build the fix ("his first full week back"), without 1a.**
   - The rate bug is the real problem: it takes him from about 80 points down to 41.6.
   - 1a moves players by only 0–4 points. We also kept the market's extra discount for injured players on purpose (planner reply 4b: re-injury risk and rust, and the safe side of the optimizer's curse).
   - The side effects are fine.
3. **Merged cards:**
   - **(a) Yes.** The Last offer can be either the throw-in or a smaller ask, whichever has the higher Overall. It must be at least 5 points likelier and keep at least 80% of the suggested trade's Overall. Idea 3 then fits as idea 2's Last offer and merges.
   - **(b) Yes.** When more than one version meets a step's rules, prefer the one that's on the list, so it merges.
   - **(c) Yes.** Drop a version when another version of the same trade is at least as good on both Helps you and the chance.
4. **Averaging: yes, leave questionable players out of the test,** since their ESPN numbers never reach a base rate.
   - For Phase 6: explain what the test protects against, and propose a gradual version, so a gap near 10% doesn't swing about 300 players at once.
5. **Pierce's sentence:** use "Week 7, when Alec Pierce returns from IR: release him. From week 7 on, he and Marvin Harrison Jr. add about the same to your starting lineup, and Harrison Jr. has more trade value. Lock Pierce to keep him instead."

---

## Checkpoint 7g (small)

**Aim:** ready Monday, October 19, so it can go live before Parker's Reddit posts on Tuesday. If it isn't ready, he posts with 7f.

1. **The Jacobs fix** (answer 2).
2. **Merged cards** (answer 3).
3. **The averaging test** (answer 4).
4. **Pierce's sentence** (answer 5).
5. **Screenshots for a clutter check.** Parker wants to keep an eye on whether the pages are getting too busy, so take screenshots at phone width (375 px) of:
   - the Trade Finder with its first card closed
   - the same card with everything on it opened
   - the League page
   - Waivers

   Note anything that already looks crowded. Don't redesign anything yet.
6. **CLAUDE.md's "Later" list:** add Parker's ideas, so they aren't lost:
   - other fantasy sports, starting with basketball
   - a separate project for finding the best-value bets

   Neither starts until Offer Sheet is where Parker wants it.

## Checkpoint 7g (short) must include
- **What changed.**
- **Jacobs after the fix:**
  - his rest-of-season points
  - Parker's odds in both leagues
  - Waivers' rows
  - the cards that give Jacobs away
- **Merges:** the merges on Parker's lists.
- **Screenshots:** the four listed above.
- **The gate:** tests, the live browser check and the `prod:deploy` dry run.

On approval, tag `checkpoint-7g`. Production deploys it after Parker's "go."
