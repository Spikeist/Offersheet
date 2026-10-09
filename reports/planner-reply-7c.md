# Planner reply to Checkpoint 7c

**Checkpoint 7c is approved. Tag `checkpoint-7c` now.** It's the launch candidate. If nothing newer is approved by Tuesday, production deploys it after Parker's "go."

**Next:** make the changes below, write a short Checkpoint 7d and stop. Aim for Sunday, October 11. If 7d is approved in time, production deploys `checkpoint-7d` instead.

**A correction:** Parker's test league pays only the top 3 ($2,000 / $1,600 / $900). The weekly high-score prize mentioned in the last reply was an example from another league. The 7c numbers are right as they are. Fix any note that says his league pays a weekly high score.

---

## Answers to your questions

1. **The export file:** export only what the user saw and entered:
   - the trade
   - the numbers on its card: Helps you, Helps them, the chance they accept, Overall and the odds lines
   - the outcome, the version sent and the notes

   Leave out everything else the model used, so no value ratio can be worked back out. The anonymous server copies keep everything, as before.
2. **A helps-both lane: yes.**
   - **Which trades:** take them from every screened trade, not just each partner's kept 30. Add up to 40 to the exact shortlist where both lineups gain on the fast method: your ΔROS > 0 and their lineup gain > 0.
   - **Order:** best screening objective first, skipping trades already on the shortlist.
   - **After that:** they go through the same exact evaluation, screening simulation and finalist rules as every other trade.
3. **Their line on Finder cards:** show "Helps them" and their odds only on cards that help both. The Analyzer always shows them, including when the trade hurts the other team.
4. **The third firewall rule: yes.**
   - **The rule:** deny `/api/` requests whose `Sec-Fetch-Site` header is `cross-site`.
   - **Order:** put it before the rate-limit rule so those requests don't count toward a visitor's limit. Check that Vercel applies the rules in that order.
   - **If Hobby's rule count is tight:** make it another condition in the image-optimizer Deny rule.
   - **Launch-day check:** a request with that header gets 403, and the app still works.
5. **"Helps both" needs Helps you ≥ 10 too,** the same bar as Helps them, so trades that barely help Parker stay out.

## Also

- **DynastyProcess (security finding 10):** its ID pairs reach the browser, so credit the license where users can see it.
  - Link "DynastyProcess" in the footer to its data repository.
  - Make the terms' data line say "player ID maps from DynastyProcess (shared under the GPL-3.0 license)."
  - The full GPL review still happens before any downloadable version.
- **Parker's odds:** say in one line what moved them between the Oct 4 data and the week 5 data: results, injuries or projections. That confirms the drop comes from the data, not from the prize change.

## Checkpoint 7d (short) must include

- **What changed,** briefly.
- **Helps both after the lane:**
  - how many of Parker's trades help both
  - the cards shown, with Helps you, Helps them and the chance they accept
  - the extra runtime
- **The export:** its fields.
- **Launch day:** the final launch-day steps, with the third rule.
- **The dry run:** the `prod:deploy` dry run on the 7d commit.

On approval, tag `checkpoint-7d`.
