/**
 * The trade search (CLAUDE.md §12; Phase 4 wave 2 lead decisions M6–M8, M11, M14; Phase 4c's exhaustive candidates,
 * lean companions, minimum chance, pattern note and re-filtering; Checkpoint 7d's helps-both lane): pools, screening with
 * beams and exhaustive candidates, exact evaluation (the shortlist and its lean companions, then the helps-both lane and
 * its own), the screening and final simulations, then ranking and explanations. Pure and deterministic: the same context
 * and options give the same result; the only clock is the optional one for timings. Every number comes from
 * config.search, config.simulation, config.ranking and config.explain (src/engine/evaluate.ts does the evaluating).
 *
 * Pools (§12 step 2; M6). Candidates are players with a model on the active rosters and, with IR returners (planner reply
 * to Checkpoint 4, change 5; league.ts step 5b, evaluate.ts rule 5), on the IRs: IR players appear in both pools.
 * - G (mine): my top givePool by surplus score (TeamModel.players surplusScore: z(value) − z(MV_lose); an IR returner's
 *   lineup cost is what losing him costs V*(me)'s lineups, no active spot opening; an IR player who isn't back this
 *   season has no surplus score and ranks last) ∪ every trade chip of mine (active players) ∪ my must-include players,
 *   minus untouchables, minus P, K, D/ST and IDP unless includeKDefIdp; ⚠️ the filters come before the top givePool is
 *   taken (the pool is my top tradable players), and must-include players always stay (even untouchable ones).
 * - H (per partner P): P's players by MV_add(me, j) in EV lineups (league.ts's rule: V*(me) plus him minus the drop that
 *   makes room, the optimizer re-run from there, against V*(me)); an IR player of P whom an open IR slot of mine would
 *   take (⚠️ judged on my IR before the trade; the slot takes his status) as a returner instead: what he adds to V*(me)'s
 *   lineups, no drop. Keeping those above 0, after the position filters
 *   (targetPositions non-empty: only those; never avoidPositions; the K/D/ST/IDP rule): the top getPool players not
 *   tagged "Harder to get" for P (evaluate.harderToGetFor: e ≥ harderToGetMin, a top-12 player who is P's #1 or #2;
 *   planner addendum to Checkpoint 3, §2, lead decision N2) plus the top getPoolTagged tagged ones (star trades are still
 *   evaluated, and rank on their honest acceptance), in MV_add order ∪ P's must-include players.
 * - Must-include ids on no team's active roster (or IR) are ignored (a note); must-include players on two or more other teams:
 *   no trade can hold them all (no trades, a note); one partner's: only that partner is searched; mine: every
 *   candidate contains them (and the given-player cap skips them: "Must-include players of mine" below). opts.partnerId
 *   searches that partner only.
 *
 * Candidates per partner (partnerCandidates; every one screened once, by key, whichever way it's reached).
 * - Beams (M7, §12 as we read it). Seeds: every 1-for-1 in G × H; with must-include players, the forced core completed
 *   to at least one player a side (the core alone when both sides have forced players, else the core plus each single
 *   from the other pool). An extension adds one player from G, one from H, or one from each: every single addition is
 *   screened, and the one-on-each additions pair the pairExtensionTop best single additions on each side; never past
 *   maxPerSide on a side. maxPerSide ≥ 2: the best beamSecond seeds are extended once (2-for-1, 1-for-2 and 2-for-2).
 * - Exhaustive candidates (planner reply to Checkpoint 4b, change 1: Checkpoint 4's Wilson → Chuba Hubbard + Mike Evans
 *   rated level with 4b's #1 in the Analyzer, but neither half helps me alone, so its 1-for-1s never made the 60 seeds the
 *   beams extend): with maxPerSide ≥ 2, on top of the beams, every 1-for-2 (one of G, two of H) and every 2-for-1 (two of
 *   G, one of H) from the whole pools, and every 2-for-2 from the first config.search.exhaustive.twoForTwoTop of each pool,
 *   in the pools' own order (G: surplus order, then chips and must-include players; H: MV_add order with the tagged
 *   players). Every candidate holds the must-include players; ⚠️ ours: they aren't counted among a 2-for-2's first
 *   twoForTwoTop (each side's other players come from the first twoForTwoTop others), and a candidate's sides list the
 *   must-include players first, then the others in pool order (the beams list a seed's players first, then the one
 *   added: a trade both reach keeps the beams' order, which the beams screen first). maxPerSide 1: none. On Parker's
 *   league (the 2026-10-04 00:51Z dump) they add about a quarter to the beams' screens and reach Wilson → Hubbard +
 *   Evans, which the beams alone never screen; Checkpoint 4c gives the counts, the runtime and where it ranks.
 * - maxPerSide 3: the best beamThird two-player trades are extended once more, ⚠️ ours: chosen among the beams'
 *   extensions and the exhaustive candidates alike (by the objective, then the key).
 * TradeSearchOptions.exhaustive false (a report switch the app never sets) keeps Phase 4b's beams alone.
 * Then trades whose g_mkt(P) falls outside screeningGWindow are dropped, then the dominated ones (lead decision N11, ⚠️
 * ours, in the spirit of §13's filler rule; review of the addendum: variants with a player of mine worth less than the
 * waiver credit took 85 of the 200 exact slots on Parker's league, 3 after the pruning): a trade that gives one of my
 * players worth at most W (perception value; W = the waiver credit; Phase 4c: "at most", the neutral throw-ins' bar,
 * atMostWaiverCredit) is dropped when the same trade without him (same partner and players of theirs, my side keeping at
 * least one player) was screened and kept with an objective at least as high (dominancePruned). Since Phase 4c's neutral
 * throw-ins (planner reply to Checkpoint 4b, change 2, with the lead's matched pairs; market.ts's header) such a player
 * moves neither side's g, whatever the counts, when every player moves with an active roster spot: a package is then
 * the one with every player worth at most W left out with his spot (⚠️ a trade that moves an IR player can be the
 * exception market.ts's header states precisely; on Parker's league, the 2026-10-04 00:51Z dump on the weekly reset
 * order, 4 of the 205 exact trades move one and none is in that shape). So he only costs the complexity term, and a
 * variant with him screens better only through the lineups (the roster spot he opens for me, what he adds to the
 * partner's lineup: n, h). The pruning holds either way: it drops only a variant that screened no better than the trade
 * without him. Each partner then keeps its best keptPerPartner, and the best exactEvaluationMax over all partners go to
 * exact evaluation (with their lean companions, below): the exhaustive candidates through the very same funnel. Order
 * everywhere: the screening objective (my ΔROS × quick P_accept), then the key.
 * (Phase 4c measured a cap on how many of those slots may give the same player of mine, overall and within each
 * partner's keep, to fill the list. On Parker's league, the 00:51Z dump, the 200 exact trades give a helping trade
 * (B > 0) to only 8 of my players, so the given-player cap leaves 17 of 25 cards. Of the caps tried, only two reached 22
 * cards (24: at most 3 trades giving one player of mine within each partner's keep, and at most 20 or 30 over all 200),
 * and both by evaluating other trades in place of a top-10 card: Marvin Harrison Jr. + Bo Nix → DK Metcalf, Overall 6,
 * gave way to Courtland Sutton → Dallas Goedert, Overall 5. So none was adopted; Checkpoint 4c has the numbers.)
 *
 * Lean companions (⚠️ ours, a Phase 4c lead decision in the spirit of the planner's reply to Checkpoint 4b, change 2: a
 * throw-in worth at most W "can only lower acceptance", so the app shouldn't suggest a pointless extra player; review of
 * track R, finding 1). ⚠️ That holds through value, with n, h and hot held fixed (market.ts's header): such a player can
 * still raise the chance through the partner's lineup (n, h) or a hot streak, so the funnel below weighs the two versions
 * rather than a rule dropping him. Screening isn't re-optimized, so legality's free-agent add in the roster spot a
 * throw-in opens can lift a trade's objective above the same trade without him, which then misses the cut while the
 * bigger one gets in: on Parker's league (the 00:51Z dump, the live order) three cards carried a neutral throw-in whose
 * lean version, never evaluated exactly, was likelier to be accepted (Romeo Doubs + Bo Nix → DK Metcalf 43.1%, Bo Nix →
 * DK Metcalf 47.2%, the same Helps you). So every shortlisted trade whose packages leave players out under the neutral
 * rule (leanVersionOf: market.neutralThrowIns on the perception values and W, the planner's step and the matched pairs,
 * either side) brings its lean version, the same trade without them, to exact evaluation too, on top of
 * exactEvaluationMax (leanCompanions): one per trade, each lean version once, in the shortlist's order, when both sides
 * keep a player, it holds every must-include player, it isn't in the shortlist already, and its screen is legal with
 * g_mkt(P) inside screeningGWindow (the partner's candidates' own screen when they had it, as they have every legal lean
 * version at maxPerSide 2: a 1-for-1 seed; else screened then, not counted in counts.screened). The funnel then decides
 * between them as between any trades: the screening simulation, the finalists by B × P_complete, and the final ranking,
 * whose filler rule drops the bigger variant when it ranks below the lean one with a B within 20% of it, or ⚠️ (final
 * review of Phase 4c, finding R5) no more helpful and less likely (rank.ts). ⚠️ When leaving every such player out would
 * empty a side (every player in the trade worth at most W), the lean version is the trade without the planner's step's
 * players alone (the side moving more players' cheapest, up to the difference: leanVersionOf; same review, finding R5: on
 * Parker's league, Oct 4 09:24Z, Rico Dowdle → Jordan Mason + Kalif Raymond had none, so Rico Dowdle → Jordan Mason,
 * likelier at the same Helps you, was never evaluated). ⚠️ Nor does a Plan B box offer a card plus more players who don't
 * make it minAcceptGain likelier (barredFromBoxes, "Final stages" below: once the lean version became a card, a box offered
 * it with the throw-in). ⚠️ A companion skips the
 * dominance pruning (it comes after it), so one can be a trade the pruning dropped for a leaner variant that screened at
 * least as well, judged from then on by its exact numbers (review of NT: at maxPerSide 3 on synthetic leagues, 94 of 461
 * companions over 20 seeds; one became a #1 card, B 6.53 at 42.1% against the 5.97 at 37.0% of the variant that had
 * dominated it at screening, card #3 there). ⚠️ Only the players the rule leaves out make a lean version: a player worth
 * at most W it leaves in, standing in for a roster-spot credit (A + x → B + C reads as A → B + C), moves no g either but
 * brings no companion. SearchState.companions lists them; TradeSearchOptions.leanCompanions false (a report switch the
 * app never sets) leaves them out. On that dump put on the weekly reset order: 17 of the 200 shortlisted trades leave
 * players out; 9 of their lean versions were shortlisted already, 1 has none (every player in it worth at most W), and
 * the other 7 brought 5 companions: 1 a finalist and a card (Bo Nix → Jadarian Price, 31.8%, in place of Rico Dowdle +
 * Bo Nix → Jadarian Price, 29.9%, the same Helps you); the other 4 don't help me (B ≤ 0; in 3 of them the player left
 * out is one I'd receive, whose lineup value the full trade has).
 *
 * The helps-both lane (Checkpoint 7d; planner reply to Checkpoint 7c, answer 2: "take them from every screened trade, not
 * just each partner's kept 30. Add up to 40 to the exact shortlist where both lineups gain on the fast method: your ΔROS >
 * 0 and their lineup gain > 0 … best screening objective first, skipping trades already on the shortlist … After that: they
 * go through the same exact evaluation, screening simulation and finalist rules as every other trade"; at Checkpoint 7c the
 * shortlist, chosen by my gain × the quick chance, held few trades that help the partner too, so the "Helps both" list had
 * little to promote: "Helps both" below). From every partner's screened trades after screening's rules (legal, holding the
 * must-include players, inside screeningGWindow and past the dominance pruning: ⚠️ ours, the lead's reading, these are
 * screening's rules and the keep isn't one; screeningRules), the ones on which both lineups gain on the fast method
 * (bothLineupsGain: my ΔROS, Screened.myDelta, the objective's own number, and the partner's ΔLineup_P,
 * Screened.partnerDelta, the number the quick acceptance's n is made from, ⚠️ ours; both above 0, float noise aside) that
 * the shortlist and its lean companions don't hold, the first config.search.helpsBothLane by the screening objective, then
 * the key (helpsBothLaneOf). They're evaluated exactly after the shortlist and its companions, each bringing its lean
 * version like a shortlisted trade (leanCompanions, skipping what's chosen already; ⚠️ not counted in the lane's size), and
 * from then on they're exact trades like any other: the screening simulation, the finalists' rules (so one can be a
 * finalist and a card on the Overall list) and the "Helps both" extras, never at another trade's expense on that list (each
 * widens the extras' room, and a finalist they push out keeps its final run: "Helps both" below). SearchState.lane keeps
 * their keys, their companions' and how many screened trades qualified; TradeSearchOptions.helpsBothLane false (a report
 * switch the app never sets) or the config at 0 leaves them out.
 *
 * Final stages (M8). Every exact trade gets the screening simulation (the screening block of seasons, screeningSims) → B
 * (λ, κ and the reward from the call's settings: lambda, "Protect my trade value" protectValue and "What does your league
 * reward?", the goal and since Checkpoint 7c its prizes, evaluate.rewardFor; evaluate.simulateTrade; Helps you and Overall on
 * B₃ for that reward and λ, Phase 7a). Finalists: ⚠️ the first
 * config.search.finalists (60 since Phase 4c, planner reply to Checkpoint 4b, change 1: the minimum chance and the caps
 * apply after them, so more trades that qualify remain for the list; no
 * promise of a full one, config.ts) trades rankTrades keeps from those numbers with its caps relaxed by one (perCore + 1
 * trades a core, perPartnerInTop20 + 1 a partner, perGivenPlayerInTop20 + 1 trades giving a player of mine; review of
 * track E, item 3: at 1,000 seasons the order is noisy, and the strict caps dropped trades that rank near the top at
 * 5,000), `finalists` in place of resultsShown, and
 * ⚠️ the partner and given-player caps' window covering every finalist rather than the first 20 (rankCaps; final review
 * of Phase 4b: the strict ranking applies those caps to its whole list until it keeps 20, which on Parker's league, Oct 3,
 * it never did, so finalists picked with no such cap were mostly the players and partners already at it); then, if the
 * caps left room, the best others by EG = B × P_complete (ties: the key), never one hidden by default (B ≤ 0 or the
 * market guard): so the final ranking has diverse trades to choose from rather than variants of a few cores. ⚠️ The
 * finalists are chosen without the minimum chance (the lead's design), so changing it needs no new search. They get the
 * final simulation (the ranking block, the first finalSims seasons, which the screening never saw: evaluate.ts; the cards
 * shown are simulated again on all shownSims seasons after the lists are made: "The shown pass" below); rankTrades on their
 * numbers, with §13's strict caps and the user's minimum chance (TradeSettings.minChance on P_complete as the card prints
 * it, applied before the caps: planner reply to Checkpoint 4b, change 10; rank.ts), gives TradeSearchResult.trades, and
 * TradeSearchResult.filter says how many finalists qualified and whether the page should suggest a lower setting (the
 * planner: "If fewer than 5 ideas qualify, say so and suggest a lower setting"): ⚠️ `few` when the list shows fewer than
 * config.ranking.minChanceFew trades and the same finalists ranked with no minimum (Any, the lowest setting) would show
 * more (review of track SR, finding 2: read on the qualifying finalists, before the caps, it missed lists the caps cut
 * short, and at Any it suggested a setting that doesn't exist; on Parker's league, the 00:51Z dump, at 50%: 4 cards from
 * 10 qualifying, 17 at Any; ours: never when a lower setting would add no card). Since Checkpoint 7e (planner reply to
 * Checkpoint 7d, item 4.1) the shown trades get no "Offer first / if they say no" steps (planner addendum to Checkpoint 3,
 * §4; lead decision N4): a card's "How to offer it" is worked out when it's opened, offers in order (src/engine/offers.ts,
 * from this search's state: "What the ladder reads" below). With the steps went their folding (final review of Phase 4c,
 * finding PAGES-3: when a card's steps named another card of the list, the lower-ranked of the two left the list, since both
 * messages proposed the same first offer). ⚠️ A ladder's Open, Then or Last offer can be another card of its list (on
 * Parker's league, week 6, card #1 opens with card #2's trade and #2 ends with #1's, #3 opens with #5's and #5 ends with
 * #3's): the card then says so, "Also shown as trade idea 2." (the lead's call, wave D, in place of the review's barring,
 * D-ENG-2 and UI-D-2, which lost those plans and read "Offer this trade as it is" where a better first offer existed).
 * Since Checkpoint 7f the search merges such pairs ("Merged cards" below): a card whose offers hold a card of its list below
 * it takes it among its offers, which leaves the list. Every card gets a Plan B ("If they won't move: try …", a different target: the planner's words in the
 * reply to Checkpoint 7d, item 4.1, and since the review of wave D, D-ENG-5, only another set of their players; "If they say no,
 * try:" on a card without steps until then, planner reply to Checkpoint 4, change 6; planB.ts: the best other exact trade
 * with that partner by its rules, ⚠️ at least the steps' minAcceptGain likelier to go through than the card and never one
 * the list shows as a card, nor since Checkpoint 7f one merged into a card of the list), from a pool fixed before any card picks,
 * of every exact trade with its best numbers, a finalist's final ones; a chosen trade that wasn't a finalist is simulated
 * on the ranking block first, once per key, ⚠️ not counted in counts.simFinal, which stays the finalists'. A box's odds
 * (PlanB.dPO, dCH, winChance; planner reply to Checkpoint 4b, change 9) come from its simulation on the shown block, the
 * card's basis (since Checkpoint 7e: "The shown pass" below; until then the final block's). ⚠️ Nor is a box (until
 * Checkpoint 7e) a version a card's steps showed (final review of Phase 4c, finding PAGES-3), nor one another card with its
 * partner matches or beats on
 * both Helps you (as printed) and P_complete (planB.ts dominatedByCard, on the ranking block's numbers and, since
 * Checkpoint 7e, again on the printed ones: "The shown pass" below; same review, finding R2: Garrett Wilson → Tee Higgins +
 * Mike Evans, 25 and 32.0%, sat on a Team 4 card while the list showed Garrett Wilson → Chuba Hubbard + Mike Evans, 30 and
 * 36.1%), nor
 * a card plus more players, on either side, who don't make it at least config.search.steps.minAcceptGain likelier to go
 * through than that card (P_complete; barredFromBoxes; players worth at most W at first, any player since the same review,
 * findings R2 and PAGES-1: the card Puka Nacua → Zay Flowers + Omarion Hampton, 25.1%, came back in a box with Kyle
 * Monangai, worth [value] > W, at 23.2%): that box would offer a card the list already shows, no easier to say yes to, with
 * players who cost the complexity term (worth at most W, without IR moves they move no g either: market.ts's header); one
 * whose players raise the chance that much keeps it possible ("add him, they need him"). ⚠️ The bar reads the chance only: a cheap player
 * who'd help me more makes a bigger ask of a card already shown, not an easier "try again", and B differences that small
 * are inside the simulations' noise at Parker's B (barredFromBoxes); so such a box is barred too (on 60 synthetic leagues,
 * 1 of the 7 boxes the bar newly removed: B 7.8 at 26.6% against the card's 4.9 at 50.5%, and a box much like it took its
 * place). Review of NT, finding 1: the bar first read only "the card plus every player the neutral rule leaves out", so on
 * Parker's league (the 00:51Z dump on the weekly reset order) Team 2's list showed Rico Dowdle → Jordan Mason + Kalif
 * Raymond, 40.8%, in 3 boxes beside the card Rico Dowdle → Jordan Mason, 47.0%, the same Helps you, while on those 60
 * synthetic leagues it barred 5 cards' own boxes whose throw-ins made them 5 to 13 points likelier ("add him, they need
 * him", when the steps didn't qualify). Since then Team 2's lists keep no such box, the main lists are unchanged (both
 * waiver orders), and on the 60 every box that is a card plus players worth at most W is at least minAcceptGain likelier.
 * ⚠️ The Plan Bs of the cards in the top-20 window keep to the given-player cap among themselves (planB.ts: in the cards'
 * order, each box counts the players of mine its card doesn't give, and a candidate that would add one already added by
 * that many boxes is skipped). Then its words and its injury tags (evaluate.ts withWords, as the Analyzer's: explain.ts
 * with the app's names, the pitch naming the card's own trade; flags.tagged, explain.injuryTags from the snapshot with
 * explain.tagContextOf: the week now and the League model's word on which conflicted Probable, Questionable or Doubtful
 * players follow their ESPN return date). The ranking stays on the ranked trades' numbers. Hidden counts: the finalists'
 * (rankTrades: byBenefit and byMarket, and byChance for the minimum chance) plus the other exact trades the guards hide at
 * screening numbers; TradeSearchResult.dropped counts the finalists the final ranking's variety rules left out
 * (rankTrades' dropped, its given-player cap's `givenPlayer` too, on every path).
 *
 * The pattern note (planner reply to Checkpoint 4b, change 6; pattern.ts): the same finalists ranked again without the
 * given-player cap (⚠️ ours: the other caps and the minimum chance as the list shows them), and when at least
 * config.explain.patternMinCount of its first patternTop give one player of mine (never a must-include one: "Must-include
 * players of mine" below), TradeSearchResult.pattern says so and why, from those trades' own numbers
 * (TradeDetail.winChance, mySlots, depthCover; his bye from ModelInputs.nfl.byeWeek), and (final review of Phase 4c,
 * finding R7) how many of his trades the list itself shows when the cap shows fewer.
 *
 * Helps both (Checkpoint 7c; planner reply to Checkpoint 7b, §7: "only trades that help both teams, sorted by Helps you,
 * highest first … the chance filter and the diversity caps still apply … add to the final simulation the top 20 by Helps
 * you among trades that help both on the screening run. Check again on the final run that each one still helps both"):
 * every simulated trade carries its partner's numbers from the same runs (TradeEvaluation.them, evaluate.ts simulateTrade;
 * each partner's calibration run is made before the screening simulation, one partner at a time with a yield after each,
 * evaluate.partnerCalibrationOf), and a trade helps both when its Helps you and its Helps them, as printed, are each at
 * least config.benefit.helpsThemMin (benefit.helpsBoth; planner reply to Checkpoint 7c, answer 5: Checkpoint 7c read "Helps
 * you > 0"). On top of the finalists, finalistsOf adds the first config.search.helpsBothFinalists exact trades by B on the
 * screening block (ties: EG, then the key) that help both and aren't hidden by default (helpsBothPoolOf; since Checkpoint 7d
 * the helps-both lane's among them, above, each widening the room by one: ⚠️ the lead's call, review of the lane, LANE-2),
 * ⚠️ the plain top 20 (the lead's call: no caps in the choice); those that aren't finalists already
 * (SearchState.helpsBothExtras) get the final simulation too and count in counts.simFinal. ⚠️ Since Checkpoint 7d so do the
 * finalists the ranking would pick without the lane's trades that it doesn't pick with them, each whose Helps them is known
 * (SearchState.laneDisplaced, among helpsBothExtras; ours, the final review, ENG-7D-1: one that helps both only on its final
 * numbers isn't in the pool, which reads the screening run), so the lane never takes a final run another trade would have
 * had: every trade the search without the lane would simulate on the final block, its Helps them known, it simulates too.
 * ⚠️ Only the second list ranks them (review of the "Helps both" engine track, finding HB-5): they're simulated so that
 * list has enough candidates, and in the Overall list a trade that missed the finalists would get a second chance only
 * because it helps the partner (on synthetic leagues one pushed a card out under the core cap); Plan B's pool keeps their
 * screening numbers as before. So the Overall list, its boxes, words, `few` and pattern note are the same as without
 * the second list, but for the rules of a card that helps both, below. finish then ranks a second list
 * (TradeSearchResult.helpsBoth) from every finalist, the extras too: rankTrades with RankOptions.order "helps" (B, highest
 * first, the order the caps go through them in) and keep benefit.helpsBoth (on the final numbers: the re-check), the §10
 * guards, the minimum chance and §13's caps as the Overall list's (one partner, must-include players alike; ⚠️ the filler
 * rule judging each pair as the Overall order does: rank.ts, HB-3), and lowerWouldAdd (the same finalists at Any would
 * show more: the page's suggestion of a lower setting). (Until Checkpoint 7e each list also folded its cards that showed one
 * plan, by their steps.) Plan B and words are made once per card for both lists: a card on both is the very same evaluation
 * (the Overall list's cards first, then the second list's others). ⚠️ A card that helps both teams (its "Helps both" tag, on
 * its printed numbers since Checkpoint 7e, in either list) has a Plan B box that helps both too (planB.ts planBPasses; HB-4),
 * and since Checkpoint 7e every offer of its "How to offer it" helps both too (offers.ts; until then its offer-first step,
 * HB-1): judged by the card's own numbers, never by the list it's on, so the tag the page shows in every sort holds for what
 * the card suggests. ⚠️ A Plan B box names no card of its card's list, nor one a card of that list matches or beats (a card
 * on both lists reads both lists' cards: its one box is
 * read in either; HB-2: the page shows one list at a time, so an Overall card's box doesn't depend on the second list); ⚠️
 * the second list's boxes keep to the given-player cap among themselves in its own top-20 window, the boxes its cards on
 * the Overall list already have counted first. The pattern note is the Overall list's only.
 *
 * The shown pass (Checkpoint 7e; planner reply to Checkpoint 7d, item 1.1: "If any trade's Helps you moves by more than 3
 * points across seeds: raise the final simulation for the cards shown to 10,000 or 20,000 seasons"; the lead's design, as
 * built, with the review of it, SHOWN-1 to SHOWN-3): everything above ranks and chooses on the ranking block, the final
 * simulation's config.simulation.finalSims seasons (evaluate.ts: the first seasons of the shown block, the same draws),
 * scored on that block's B₃ and partners' scales: the finalists, the "Helps both" extras, both lists' membership (and until
 * item 4.1 their folding), Plan B's candidates and choice, `few` and lowerWouldAdd. Every card of either list and every Plan B box is
 * simulated once more on the shown block, config.simulation.shownSims seasons (20,000), against its baseline (the League
 * page's headline), on its B₃ and each partner's scale there (made when first needed, one calibration run a yield), once
 * per key (SearchState.shownByKey): a card the first time a list holds it; a box when its card's choice reaches it. Every
 * number a card or a box prints comes from that run (B, Helps you, Overall, the odds lines, the weekly line, Helps them and
 * the "Helps both" tag), and its words are made on it. ⚠️ Ours (the review), so every rule the lists and the boxes are chosen
 * by holds on the numbers they print, as it did before Checkpoint 7e:
 * - a card's "Helps both" rule for its box reads its printed numbers, its tag (SHOWN-1; until item 4.1 its steps' too), and so
 *   does "How to offer it" (offers.ts), so its pitch and its offers are the Analyzer's (on the shown block) too;
 * - each list is ranked again on its cards' printed numbers by rank.ts, in its own order (the Overall list by EG, the "Helps
 *   both" list by B; SHOWN-3): nothing comes in (a merge's next round aside, since Checkpoint 7f: "Merged cards" below),
 *   but a card whose shown B isn't above 0 leaves (§10's guard: counted among
 *   the trades that wouldn't help me), one whose printed numbers don't help both teams leaves the "Helps both" list (the
 *   lead's call), and one §13's rules drop in the printed order leaves, counted among the dropped (the caps in the top 20:
 *   a card from past the 20th place sorted into the window gave a partner or a player of mine a 4th card there, 2 of 40
 *   twelve-team synthetic lists at Any; the core cap; the filler rule). None is refilled;
 * - a box is chosen on the ranking numbers (planB.ts's order and rules, the card's printed tag) in its list's printed order
 *   (the box cap's window too), then must pass the same rules on its printed numbers against its card's and its list's
 *   (half the card's Helps you, helping both under a card tagged "Helps both", no card of its list matching or beating it;
 *   SHOWN-2: 19 of about 1,180 boxes on 300 synthetic searches broke one), else the next candidate is tried (within
 *   planB.tries), so a box never prints numbers its rules turn down.
 * ⚠️ Not done (ours): a card whose printed numbers help both teams and its ranking numbers don't is tagged "Helps both" (its
 * box and its offers held to the rule) but doesn't join the "Helps both" list, whose cards the ranking chose, as a card that
 * list's caps leave out doesn't (1 card in 150 synthetic searches under the default goal, 2 under "Several prizes").
 * `few` and lowerWouldAdd compare the rankings at Any and at the minimum, as before (what the printed numbers take out of a
 * list they'd take out at Any too). The pattern note is made on the list shown; its drivers read the ranking block's
 * trades, as its ranking does. On Parker's league (week 6 under his prizes; Node) the pass simulated 19 trades at
 * Checkpoint 7e's wave A (the 17 its lists showed, cards and boxes, and 2 cards a list held, then left: one folded off, one
 * that doesn't help both as printed) and 8 partners' scales, about 1.2 s of a 6.5 s search. Since Checkpoint 7f (planner
 * reply to Checkpoint 7e, answer 2) each of those runs continues its ranking run (evaluate.ts runSim and
 * partnerCalibrationOf; sim.ts, "Continuing a run"), so the pass plays 15,000 of each one's 20,000 seasons, with the same
 * numbers bit for bit. With the merge ("Merged cards" below), a search's runs on the shown block on his league, Oct 14: 29
 * (21 trades, cards and boxes, and 8 partners' scales), 435,000 seasons played where full runs would play 580,000; Oct 15:
 * 38 (27 trades, 9 partners' scales and 2 ladder offers the search had ranked), 570,000 of 760,000; on his 12-team league 21
 * runs (315,000 of 420,000) and 23 (345,000 of 460,000), each continuing its ranking run (the review of the speed track,
 * SPEED-2). When the shown block is the ranking block (shownSims at most finalSims) a trade's ranking numbers are its shown
 * ones, bit for bit, and are taken as they are, and without the pass (TradeSearchOptions.shownPass false) every number is
 * the ranking block's: either way the search is Checkpoint 7d's exactly.
 *
 * Merged cards (Checkpoint 7f; planner reply to Checkpoint 7e, decision 3: "When one card's offer list contains another
 * card's trade, merge them: Keep only the card with the higher Overall in the list. The other trade appears only inside that
 * card's offer list. Fill the freed slot with the next idea, under the usual diversity rules."; the lead's decisions): each
 * list (the Overall list, then "Helps both") settles in rounds (finish's settle). A round ranks the list on the ranking block,
 * plays each new card out on the shown block and ranks the list again on the printed numbers ("The shown pass"); then it works
 * out the ladders (offers.ts: the card's "How to offer it", the very one its first open gives) of the cards that can hold a
 * card of the list below them: one of offers.ts ladderNeighbors (a candidate of the card's ladder, or the card plus a throw-in
 * its Last offer's pre-screen keeps) whose printed numbers pass offerFeasible against the card's (a necessary condition: every
 * rule an offer of its kind holds as printed). Going down the cards by Overall as printed (rank.ts compareOverall: EG, then
 * the key; on the "Helps both" list too, the planner's "higher Overall", though that list goes by Helps you), each card not
 * merged this round takes every card of the list below it that its offers hold (TradeSearchResult.merged: the trade, its
 * card, its place among the card's offers); they leave, and the next round ranks the list without them, the filler rule
 * reading them as kept (rank.ts RankOptions.shownElsewhere; ⚠️ the lead's call, for that rule only, never a place or a cap:
 * without it their own filler variants took the freed places on Parker's league, Oct 14, and counted for the caps the freed
 * places mostly couldn't be filled), until a round merges none. ⚠️ The lead's calls: a card whose offers hold a card ABOVE it
 * (the holder below) merges nothing, both stay and that offer keeps its label ("Also shown as trade idea N."); what holds is
 * that the higher card's own offers don't include this one (the review of the merge, MERGE-1: these words had said it "can't
 * offer it back", true of the first shape only). Checkpoint 7f's two shapes: (i) a likelier variant, a smaller ask that opens
 * with a bigger one, which the higher card's ladder couldn't hold then (before its suggested trade a ladder offers only
 * versions less likely than the card, and its Last offer was itself plus a player of mine): on Parker's league, Oct 15, idea
 * 3, Breece Hall + Marvin Harrison Jr. → Mike Evans (65%), opens with idea 2, the same two for Mike Evans + Ollie Gordon II
 * (35%); (ii) the higher card's lean version, when the higher card is the lower one plus a player of mine (the lower card's
 * Last offer), which the higher card's ladder could hold as its Open or a Then by the rules but passed over, since it picks its
 * Open and Thens by Helps you on the screening block's 1,000 seasons: his "Helps both" list, Oct 15, Puka Nacua → Drake London
 * + Christian Watson, whose Last offer is Marvin Harrison Jr. + Puka Nacua → Drake London + Christian Watson (4 of the 36
 * holder-below pairs the review found were this shape, that pair 3 times). The planner answered both (reply to Checkpoint 7f,
 * answer 3; "Merged cards, Checkpoint 7g" below): since then a shape-(i) pair merges when the higher card's Last offer takes
 * the smaller ask (3(a): at least minAcceptGain likelier, keeping at least config.offers.lastMinOverallShare of the higher
 * card's unrounded Overall, the higher Overall of the two kinds), and a shape-(ii) pair when the higher card's ladder,
 * preferring the cards of its list, takes the lower one (3(b): a leaf, below it, not taken this round); any other pair keeps
 * its label (on this tree one of Parker's seven runs keeps one: the planner's own (a) example, idea 3 above, under "Only the
 * champion", under 80% of idea 2's Overall). A merged trade may still be an offer of other cards (ladders don't depend on the
 * list). And the release
 * rule (⚠️ ours; at Checkpoint 7f never seen on Parker's dumps or 1,369 synthetic searches, the review of the merge;
 * search.merge.release.test.ts drives it with made-up ladders, MERGE-5; since Checkpoint 7g it acts when rule (c) drops a card
 * that holds merged trades: on smallLeague 48 at 10%, and on Parker's league 1, Oct 15, searched with Team 8 alone): once a
 * round merges none and (Checkpoint 7g) drops none, and at once in a round that drops a card holding merged trades (the final
 * review's E2: "Merged cards, Checkpoint 7g"), a merged trade no card of the list above it offers (its card merged in turn,
 * dropped for a better version, or pushed off by the rules) comes back for good, never merged again, and the rounds go on,
 * while one whose card left but that another card above it offers is that card's from then on (MergedTrade.into is a card of
 * the list). A trade merges at most once and comes back at most once, so the rounds end (with the dropped versions: "Merged
 * cards, Checkpoint 7g"). A card's ladder is worked out once per minimum chance (offers.ts
 * searchLadderChoiceSteps, in the search's store, which its re-filters share: a re-filter back to a minimum seen reads it
 * there), in steps of one exact evaluation or one run on the shown block (offers.ts ladderChoiceSteps), each a progress
 * unit and a yield, so the search's slices stay short (a ladder takes up to about 100 ms on Parker's leagues, about 200 ms
 * searching one team); the ones the merge read are kept with words (SearchState.ladders) and handed back as they are when
 * the card is opened (offers.ts offerLadderOfSearch: the ladder worked out on demand, or from the card's trade on a fresh
 * context, is the same, deep-equal since the review of the merge, MERGE-4: evaluate.ts coreInOrder puts every offer's
 * per-player facts in its own order). Plan B reads a list's merged trades as its cards (barredFromBoxes, dominatedByCard:
 * the lead's call), and since Checkpoint 7g its dropped versions too, so no box is one or one they match or beat. The counts:
 * dropped.merged (both lists') counts them, filter.qualifying and HelpsBothList.qualifying count them among the qualifying
 * (Phase 4c counted its folded cards so), as they count the dropped versions (dropped.dominated); "Left out on purpose"
 * (hidden) and counts.exact don't (a ladder's evaluations aren't counted, as an opened card's aren't); simShown counts cards
 * and boxes as before. `few`, lowerWouldAdd and the pattern note rank without the merged trades (and the dropped versions),
 * as filler references, ⚠️ at Any too (Any's own merges could differ: Phase 4c's approximation). TradeSearchOptions.mergeCards
 * false (a report and test switch the app never sets) gives Checkpoint 7e's lists. Its time is the "offers" timing.
 *
 * Merged cards, Checkpoint 7g (planner reply to Checkpoint 7f, answer 3: "(a) Yes. The Last offer can be either the throw-in or a
 * smaller ask, whichever has the higher Overall. It must be at least 5 points likelier and keep at least 80% of the suggested
 * trade's Overall. … (b) Yes. When more than one version meets a step's rules, prefer the one that's on the list, so it merges.
 * (c) Yes. Drop a version when another version of the same trade is at least as good on both Helps you and the chance."; the
 * lead's calls D1–D21 and the final review's E1–E3). Three switches, each a report and test switch the app never sets
 * (TradeSearchOptions.smallerAsks, preferListed, dropDominated: SearchState keeps them); with all three off, Checkpoint 7f's
 * search, bit for bit (search.merge7g.test.ts).
 * - (a) The smaller ask (offers.ts, "The candidates" and "4. Last offer"): a card's Last offer is the throw-in or a smaller ask
 *   (the card's players of mine for part of its players of theirs), whichever prints the higher Overall, a smaller ask held to
 *   at least config.offers.lastMinOverallShare (80%) of the card's unrounded Overall besides the Last offer's other rules. The
 *   merge reads a card's smaller asks among the cards of its list (offers.ts ladderNeighbors kind "smaller", offerFeasible
 *   "smaller"), so a shape-(i) pair merges when the bigger card's Last offer takes the smaller ask (smallLeague 24, 25 and 56 at
 *   10%). On Parker's league 1, Oct 14, his "Helps both" card Marvin Harrison Jr. + Breece Hall → Dallas Goedert + Christian
 *   Watson ends with the same two for Christian Watson alone, a trade no list shows. ⚠️ Plan B's narrow rule (the lead's D5;
 *   planB.ts smallerAskOf; finish's lastCouldTake): a box is never a smaller ask of its card that the card's Last offer could
 *   take by its rules on both printed numbers (offerFeasible "smaller"), so the box and the Last offer never show one trade
 *   twice; such a candidate is passed over, counted as tried.
 *   The rule reads only those two printed numbers, never the Last offer the ladder picks (so it doesn't depend on whether the
 *   ladder was worked out, and ladders still don't read Plan B), so a skipped box isn't always the Last offer: when the Last
 *   offer is another version (a throw-in with a higher Overall, another smaller ask, a preferred one), the skipped ask shows
 *   nowhere on the card, and its box is the next candidate that passes, or none (smallLeague 32 at 10%: card 5|give:1005|get:
 *   1049,1053, 36 / 65% / 25, ends with the throw-in 5|give:1002,1005|get:1049,1053, Overall 25.11, over the smaller ask
 *   5|give:1005|get:1053, 23.81, which the rule keeps out of its box, and it has no box). smallerAsks false gives Checkpoint
 *   7f's Last offer, the throw-in alone, and turns the narrow rule off with it (a box can then be a smaller ask, as at 7f).
 * - (b) Preferring the cards of the list (offers.ts, "Preferring the cards of its lists"; preferredOf, takenTopDown): each
 *   list's rounds go top-down. Going down the cards by Overall as printed, a card not taken this round whose ladder isn't
 *   known yet and one of whose cards of the list below it can be an offer (feasibleOf) gets its ladder worked out just then,
 *   with its preference fixed from then on (SearchState.prefers; one ladder per card and minimum chance): the cards of its
 *   lists below it that are leaves (holding no merged trade), that no card above it took this round and its list didn't give
 *   back (both lists' since the final review, E3, merge-b-theirs-ignores-taken), and that could be its offers on both printed
 *   numbers, with the cross-list guard (while the Overall list is merged, a card that helps both teams but isn't on the "Helps
 *   both" list's first printed ranking prefers none of its list's cards that help both); its ladder prefers them at each step
 *   and is kept only when it holds more of them than the usual one. Then each card not taken this round takes every card of
 *   the list below it that its offers hold. The "Helps both" list's first printed ranking is made before the Overall list's
 *   rounds (the guard reads it, and a card on it prefers from it too); the "Helps both" list's cards prefer from the Overall
 *   list's final cards, its holders no leaves. A card taken in a round never gets a ladder (MergedCards.ladders reads fewer
 *   than at Checkpoint 7f). On Parker's league 1, Oct 14, his prizes, idea 1, Marvin Harrison Jr. + Puka Nacua → Tetairoa
 *   McMillan + Nico Collins, whose usual ladder offers nothing, prefers idea 2, Puka Nacua → the same two, as its Open; on his
 *   league 2, Oct 14, idea 1, Patrick Mahomes + Breece Hall → Kyle Monangai + Parker Washington, takes the same with David
 *   Montgomery in place of Monangai as its Open the same way. ⚠️ The preference is fixed per card, so a version that comes onto
 *   the list below it in a later round isn't seen (the lead's D11: one missed merge in 889 cards, smallLeague 24). The worker's
 *   fallback carries the card's preference (TradeSearchResult.offerPrefer, the page's OffersSource.prefer, offers.ts
 *   ProposalLadderOptions.prefer); the Trade Analyzer's card has no list and no preference, so
 *   its ladder for a Finder card's trade can differ through it (offers.ts, "The pre-screen"). preferListed false works the
 *   ladders out as at Checkpoint 7f (takenAsBefore).
 * - (c) Dropped versions (dominatedOf; settle): once a round merges none, each card of the list that another version of the
 *   same trade (rank.ts versionsOfSameTrade, the filler rule's relation) beats on the printed numbers leaves (beatsVersion: at
 *   least as good on both Helps you as printed and the chance P_complete as printed, its nearest 5% and "<5%" under every step,
 *   acceptance.printedAcceptance, the final review's E1: read as the nearest 5%, "<5%" tied with "5%", so at "Any" a card
 *   printing "5%" left for its version printing "<5%", smallLeague 72; and, when each is at least as good as the other, the one
 *   higher in Overall order). A card that stays or a trade merged into one of its cards can beat one; a merged trade is never
 *   dropped. On Parker's league 1 Puka Nacua → Tetairoa McMillan + Nico Collins leaves for Marvin Harrison Jr. + Puka Nacua →
 *   the same two on Oct 15 under both settings and on Oct 14 under "Only the champion" (on Oct 14 under his prizes (b) merges it
 *   instead). The dropped versions leave like merged trades: out of the later rankings, read by the filler rule as kept (rank.ts
 *   RankOptions.shownElsewhere), Plan B reads them as their list's cards, `few`, lowerWouldAdd and the pattern note rank
 *   without them, and the rounds go on (the next idea takes the freed place). ⚠️ The final review's E2 (merge-c-by-can-leave):
 *   when a dropped card held merged trades, the release rule runs at once, on the list without the dropped cards, so the
 *   trades it gives back are ranked in the next round before (c) reads the list again (on smallLeague 48 searched with Team 2
 *   they came back rounds later, took the given-player cap's places and pushed off the version a third card had been dropped
 *   for, so neither showed); and once a round merges none, drops none and gives no merged trade back, each dropped version
 *   whose `by` is no longer a card of the list or a trade merged into one is re-pointed to another that beats it (beaterOf:
 *   the cards in Overall order, then the merged trades; smallLeague 29 searched with Team 5 at "Any": its `by` dropped in turn
 *   for a version that beats both), else given back for good, never dropped again (MergedCards.restored). The rounds end: a
 *   trade is merged, given back from a merge, dropped and given back from a drop at most once each, and every round but the
 *   last does one of the four. Counts: dropped.dominated on both lists, qualifying counting them (each was a card),
 *   MergedCards.dominated (each with its `by` and list) and restored.
 *
 * Re-filtering (planner reply to Checkpoint 4b, change 10: "re-filter instantly from the finalists, without re-running the
 * search"): a finished search keeps its finalists and caches (searchStateOf: the result object → its state; null when the
 * search stopped before ranking, whose result holds for any minimum), and refilterSearch ranks them again with another
 * minimum chance on the ranking block, recomputing the shown lists' Plan Bs, words and pattern note from them, and
 * running the shown pass for the trades it shows that no earlier list showed (final simulations and shown runs reused by
 * key: they're deterministic, so the result equals a fresh search's with that minimum, the "Helps both" list included, and
 * since Checkpoint 7f its merges, which read the ladders the store holds for that minimum or work them out; Plan B's pool
 * stays the one fixed before any card picked). Only the minimum changes; any other setting needs a new search.
 *
 * What the ladder reads (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1; src/engine/offers.ts): a card's "How to
 * offer it" is built on demand from the search's state (offerLadderOfSearch, by the result object), so the state keeps what
 * it needs besides the caches above: each partner's get pool H and its must-include players as the search built them
 * (SearchState.getPools: the ladder's variants keep my side and take any 1 to maxPerSide of them), the exact trades'
 * versions on the screening block (SearchState.versions, which the ladder adds its own to: a re-filter shares them), and the
 * printed numbers of the cards and boxes (shownByKey). Since Checkpoint 7f nothing is barred (offers.ts, "The candidates"),
 * the ladders' choices are kept per minimum chance in the store, and the ladders the merge read are a result's own
 * (SearchState.ladders: "Merged cards" above).
 *
 * One partner (⚠️ ours, end-of-Phase-4 review, finding 5): a search of a single partner (opts.partnerId, must-include
 * players of theirs, or a league with one other team: Pools.partners holds one team) ranks without the per-partner cap,
 * in both rankings (rankCaps). §13's "at most 3 trades per partner in the top 20" keeps the all-teams list varied across
 * partners; with one partner searched there is no other partner to make room for, and the cap would cut the list to 3
 * whatever else qualified (every one-partner search on Parker's league showed 3, of up to 30 finalists). The per-core and
 * filler rules still apply. A search of all teams ranks exactly as before.
 *
 * Must-include players of mine (⚠️ ours, review of track SR, finding 1; the one-partner rule's reasoning, for the
 * given-player cap): every candidate gives them because the user asked, so the cap would cut the list to
 * perGivenPlayerInTop20 cards whatever else qualified (on Parker's league, the 00:51Z dump, Garrett Wilson must-include
 * showed 3 cards; outside the cap, 22 from 8 partners). Every ranking (the finalists', the final one, the one behind
 * `few` and the pattern note's) passes them to rankTrades as givenCapExempt: the cap counts my other players only. The
 * pattern note never names one (pattern.ts).
 *
 * Notes: the context's (no team, no weeks, season over, deadline passed, no odds: then no trades), B's own
 * (benefit.benefitNotes, once; and Phase 4c's evaluate.estimatedValuesNotes, once: no market term in B while the trade
 * values are our own estimates), the "Helps you" scale's (Phase 7a, planner reply to Checkpoint 4c, A2: benefit.
 * helpsScaleNotes once when B₃ for the search's reward and λ is floored: my odds barely move; every trade, step and Plan B of
 * the search is scored on that one B₃, evaluate.helpsScaleOf, TradeSearchResult.helpsScale, and its B's market term priced
 * on it: planner reply to Checkpoint 7a, §2 question 5), evaluate.missingValuesNotes once (no trade values at all: the
 * chance they accept reads every trade as even on value), positions left out by settings, must-include problems, emptied
 * pools, and draft picks (M11: ⚠️ deferred to Phase 5; with includePicks on in a dynasty or keeper league, a note says so).
 *
 * Progress (M8, M14): the generator yields between units of work (a batch of screens, each partner's "Helps them"
 * calibration run, each exact trade, each final simulation; then under the "rank" stage one unit each for every card's
 * numbers (and until Checkpoint 7e its steps), since Checkpoint 7c the "Helps both" list's cards the Overall list doesn't
 * show too, every card's Plan B, with a yield before each of Plan B's simulations, and since Checkpoint 7e every run on the
 * shown block, a card's, a box's or a partner's scale, and since Checkpoint 7f each step of a ladder the merge works out:
 * done of the units planned so far, a later round's added as done, so the bar only moves forward (the review's SHOWN-5: the
 * pass restarted it); since Checkpoint 7f a card the rounds take off its list (merged, or left under the usual rules) leaves
 * its Plan B's unit out of the total, so the last event is the count itself, every unit done (the review of the merge: on
 * Parker's league, Oct 15, the bar stood at 79 of 82 until a last event set it done), with TradeSearchProgress.part "shown"
 * while the pass runs on a block of its own and since Checkpoint 7f "offers" while the merge works a ladder out, which
 * tradeView.ts names (still the "rank" stage, so a re-filter reads as one), so a worker can slice it and stop it. ⚠️ A run on
 * the shown block is one unit of about 45–50 ms on Parker's league in Node (20,000 seasons), over the 40 ms the other units
 * keep to; about 35 ms since Checkpoint 7f, continuing its ranking run (about 47 ms on his 12-team league, 61 before). ⚠️ A
 * ladder's run on the shown block, which the merge makes during the search since Checkpoint 7f, plays all 20,000 seasons, a
 * unit of about 44 ms on his league and 61 ms on his 12-team one: a ladder's versions are screened but never ranked, so
 * there's no ranking run to continue, unless the version is one the search ranked anyway (at 2 players a side every ladder
 * offer printed on Parker's four dumps was such a trade; at 3 a side, on his league, Oct 15, 2 of the search's 26 runs on
 * the shown block played every season; the review of the speed track). The review of the merge (MERGE-3) measured the
 * stage's longest slice at about 44–57 ms with the merge, 35–40 ms without it, within the 45–65 ms units Checkpoint 7e
 * accepted. Timings:
 * one key per TradeSearchStage, "steps" (the shown trades' Plan B and words; until Checkpoint 7e their steps too: the key
 * keeps its name), "shown" (the runs on the shown block,
 * Checkpoint 7e), "offers" (Checkpoint 7f: the ladders the merge works out, their runs on the shown block among them, and their
 * words) and "total"; a re-filter's: "rank", "steps", "shown" (when the pass has a block of its own), "offers" (when the merge
 * read a ladder) and "total".
 */
import { printedAcceptance } from "./acceptance";
import { benefit, benefitNotes, helpsBoth, helpsScaleNotes } from "./benefit";
import { config } from "./config";
import {
  assetValue,
  estimatedValuesNotes,
  evaluateExact,
  helpsScaleOf,
  missingValuesNotes,
  harderToGetFor,
  partnerCalibrationOf,
  proposalKey,
  rewardFor,
  screenTrade,
  simulateTrade,
  tradeInternals,
  withWords,
  type ExactTrade,
  type Screened,
  type TeamState,
  type TradeContext,
  type TradeInternals,
  type TradeVersion,
} from "./evaluate";
import { addValueOf, baseFor, startablePositions } from "./league";
import { neutralThrowIns } from "./market";
import type { Pos } from "./model";
import { patternNote, type PatternInputs } from "./pattern";
import { prizeDeltas } from "./reward";
import { addGainExact } from "./teamValue";
import { addedGiven, choosePlanB, givenCapSkip, planBCandidates, planBConfig, smallerAskOf, type PlanBConfig } from "./planB";
import { choiceOffers, forcedOpenOk, ladderFromChoice, ladderJobOfSearch, ladderNeighbors, offerFeasible, searchLadderChoiceSteps, type LadderChoice } from "./offers";
import { compareOverall, rankTrades, versionsOfSameTrade, type RankConfig, type RankedTrades, type RankOptions } from "./rank";
import { defaultTradeSettings, normalizeTradeSettings, type TradeSettings } from "./settings";
import type {
  DominatedTrade,
  HelpsBothList,
  HigherEarlierOffer,
  MergedCards,
  MergedTrade,
  NotPromoted,
  OfferLadder,
  PatternNote,
  PlanB,
  PromotedTrade,
  TradeAsset,
  TradeEvaluation,
  TradeEvaluationCore,
  TradeProposal,
  TradeSearchProgress,
  TradeSearchResult,
  TradeSearchStage,
} from "./tradeModel";

export interface TradeSearchOptions {
  /**
   * The user's settings (maxPerSide, untouchables, mustInclude, target/avoid positions, includeKDefIdp, includePicks,
   * lambda, protectValue, goal, prizes, minChance). Default: defaultTradeSettings().
   */
  settings?: TradeSettings;
  /** Only trades with this partner (null or absent = every other team). */
  partnerId?: string | null;
  /** Milliseconds (performance.now in the browser) for TradeSearchResult.timings; without it the timings are empty. */
  clock?: () => number;
  /**
   * Report switch (the app never sets it): Plan B's rules in place of config's (planB.ts planBConfig), for instance
   * `{ minAcceptGain: null }` (no "likelier to go through" rule: the planner's rules as first read) or
   * `{ givenPlayerCap: null }` (Plan B's offers not capped), so a report can measure what each rule does.
   */
  planB?: Partial<PlanBConfig>;
  /**
   * Report switch (the app never sets it): false screens the beams alone, without Phase 4c's exhaustive candidates (the
   * file header), so a report can measure what they add. Default true.
   */
  exhaustive?: boolean;
  /**
   * Report switch (the app never sets it): false evaluates the shortlist alone, without Phase 4c's lean companions (the
   * file header, "Lean companions"), so a report can measure what they change. Default true.
   */
  leanCompanions?: boolean;
  /**
   * Report switch (the app never sets it): false evaluates without Checkpoint 7d's helps-both lane (the file header, "The
   * helps-both lane"), as config.search.helpsBothLane 0 does, so a report can measure what it adds. Default true.
   */
  helpsBothLane?: boolean;
  /**
   * Report and test switch (the app never sets it): false skips Checkpoint 7e's shown pass (the file header, "The shown
   * pass"), so every card and box prints its ranking block's numbers and every rule reads them, as before Checkpoint 7e, and a
   * test or a report can see what the pass changes (the same cards but those the printed numbers take out, and the boxes
   * they turn down). ⚠️ For comparing lists only: the result's baseline and the words' "before" stay the shown block's (the
   * League page's headline), so a card's odds lines then add a ranking-block change to it. Default true.
   */
  shownPass?: boolean;
  /**
   * Report and test switch (the app never sets it): false leaves out Checkpoint 7f's merge (the file header, "Merged cards"),
   * so the lists are Checkpoint 7e's and a report can say what the merge changes. Default true.
   */
  mergeCards?: boolean;
  /**
   * Report and test switch (the app never sets it): false leaves out Checkpoint 7g's smaller asks (planner reply to Checkpoint
   * 7f, answer 3(a); the file header, "Merged cards, Checkpoint 7g"): every Last offer is the throw-in, as at Checkpoint 7f
   * (offers.ts LadderJob.smallerAsks), and Plan B's narrow rule is off with them (a box can then be a smaller ask, as at
   * Checkpoint 7f). Default true.
   */
  smallerAsks?: boolean;
  /**
   * Report and test switch (the app never sets it): false leaves out Checkpoint 7g's preference for the cards of the list
   * (answer 3(b)): the merge works its ladders out as at Checkpoint 7f. Default true.
   */
  preferListed?: boolean;
  /**
   * Report and test switch (the app never sets it): false leaves out Checkpoint 7g's dropped versions (answer 3(c)). Default
   * true. With every Checkpoint 7g switch off (these three) and Checkpoint 7h's promoteLastOffers off, the search is Checkpoint
   * 7f's on Checkpoint 7h's config, bit for bit (search.merge7g.test.ts).
   */
  dropDominated?: boolean;
  /**
   * Report and test switch (the app never sets it): false leaves out Checkpoint 7h's promoted Last offers (planner reply to
   * Checkpoint 7g, answer 3; the file header, "Promoted Last offers"), so a Last offer printing a higher Overall than its card
   * stays its Last offer, as at Checkpoint 7g, and the merge works out only the ladders it reads. Default true.
   */
  promoteLastOffers?: boolean;
}

/** Gains closer than this are ties (float noise, not a tunable). */
const EPS = 1e-9;

/** Screens, and screening simulations, between two progress yields (config.search: responsiveness, M8). */
const SCREEN_BATCH = Math.max(1, Math.floor(config.search.yieldEveryScreens));
const SIM_BATCH = Math.max(1, Math.floor(config.search.yieldEverySims));

const byKey = (a: { key: string }, b: { key: string }): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const byObjective = (a: Screened, b: Screened): number => (Math.abs(b.objective - a.objective) > EPS ? b.objective - a.objective : byKey(a, b));

const players = (ids: readonly string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));

/** A core as rankTrades reads it: the numbers, without words (they never change the order). */
const bare = (core: TradeEvaluationCore): TradeEvaluation => ({ ...core, reasons: [], pitch: "" });

/** Words for the positions left out of the search by default (config.market.tradeSearchExcluded). */
const EXCLUDED_WORDS: Readonly<Partial<Record<Pos, string>>> = { P: "punters", K: "kickers", DEF: "D/STs", DL: "IDP players", LB: "IDP players", DB: "IDP players" };

function listText(xs: readonly string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The pools and the partners to search (M6), or the notes that stop the search. */
export interface Pools {
  partners: TeamState[];
  give: string[];
  forcedGive: string[];
  get: Map<string, { pool: string[]; forced: string[] }>;
  notes: string[];
  stop: boolean;
}

export function buildPools(I: TradeInternals, settings: TradeSettings, partnerId: string | null): Pools {
  const me = I.me as TeamState;
  const notes: string[] = [];
  const out: Pools = { partners: [], give: [], forcedGive: [], get: new Map(), notes, stop: false };
  const stop = (note: string): Pools => {
    notes.push(note);
    out.stop = true;
    return out;
  };
  const maxPerSide = settings.maxPerSide;
  const hasRow = (id: string) => I.league.table.rows.has(id);
  const posOf = (id: string) => I.league.posOf(id);
  const excluded = new Set<Pos>(settings.includeKDefIdp ? [] : config.market.tradeSearchExcluded);
  const untouchable = new Set(settings.untouchables);

  // Must-include players: mine, one partner's, or nobody's (ignored). Tradable: active-roster players and, with IR
  // returners (evaluate.ts rule 5), IR players.
  const tradableOf = (t: TeamState): readonly string[] => (I.irOn ? [...t.roster, ...t.ir] : t.roster);
  const forcedGive: string[] = [];
  const forcedBy = new Map<string, string[]>();
  let ignored = 0;
  for (const id of settings.mustInclude) {
    if (tradableOf(me).includes(id)) {
      forcedGive.push(id);
      continue;
    }
    const owner = I.teams.find((t) => t !== me && tradableOf(t).includes(id));
    if (!owner) {
      ignored++;
      continue;
    }
    forcedBy.set(owner.id, [...(forcedBy.get(owner.id) ?? []), id]);
  }
  if (ignored > 0) notes.push(`${ignored === 1 ? "1 must-include player isn't" : `${ignored} must-include players aren't`} on any team's active roster${I.irOn ? " or IR" : ""}, so ${ignored === 1 ? "it's" : "they're"} ignored.`);
  if (forcedBy.size >= 2) return stop("Your must-include players are on different teams, and a trade is with one team, so no trade can include them all.");
  if (forcedGive.length > maxPerSide) return stop(`You must include ${forcedGive.length} of your players, more than the ${maxPerSide} a side your settings allow.`);
  const [forcedTeam, forcedGet] = [...forcedBy.entries()][0] ?? [null, []];
  if (forcedGet.length > maxPerSide) return stop(`You must include ${forcedGet.length} of their players, more than the ${maxPerSide} a side your settings allow.`);
  let partners = I.teams.filter((t) => t !== me);
  if (partnerId !== null) partners = partners.filter((t) => t.id === partnerId);
  if (forcedTeam !== null) {
    if (partnerId !== null && partnerId !== forcedTeam) return stop("Your must-include players are on another team than the one you picked, so no trade with this team can include them.");
    partners = partners.filter((t) => t.id === forcedTeam);
  }
  if (!partners.length) return stop("Pick a team to trade with.");

  // G: my top tradable players by surplus score (my IR returners included: TeamModel.players ranks them by their lineup
  // cost from V*(me)'s lineups), my trade chips, my must-include players.
  const myModel = I.model.teams[me.index];
  const tradable = (id: string) => hasRow(id) && !untouchable.has(id) && !excluded.has(posOf(id) as Pos);
  const surplus = (id: string) => myModel?.players[id]?.surplusScore ?? Number.NEGATIVE_INFINITY;
  const top = [...new Set(tradableOf(me))]
    .filter(tradable)
    .sort((a, b) => surplus(b) - surplus(a) || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, Math.max(0, Math.floor(config.search.givePool)));
  const chips = (myModel?.chips ?? []).map((c) => c.playerId).filter((id) => me.roster.includes(id) && tradable(id));
  const give = [...new Set([...top, ...chips, ...forcedGive])];
  if (!give.length) return stop("None of your players can be offered with your settings (untouchable, or at positions left out of the search).");
  // H per partner (getPoolPicker): its top players by what they'd add to my lineup (MV_add(me, j), EV), the "Harder to get"
  // ones apart, and its must-include players.
  const pick = getPoolPicker(I, settings);
  for (const p of partners) {
    const forced = p.id === forcedTeam ? forcedGet : [];
    out.get.set(p.id, { pool: pick(p, forced), forced });
  }
  if (partners.every((p) => (out.get.get(p.id)?.pool.length ?? 0) === 0)) {
    return stop(settings.targetPositions.length > 0 || settings.avoidPositions.length > 0 ? "No player at the positions your settings allow would improve your lineup." : "No player on the other teams would improve your lineup right now.");
  }
  out.partners = partners;
  out.give = give;
  out.forcedGive = forcedGive;
  return out;
}

/**
 * The get pool H of a partner (§12 step 2; the file header, "Pools"), as buildPools builds it for each partner it searches:
 * the partner's tradable players (active roster and, with IR returners, IR) by MV_add(me, j) in EV lineups above 0, after the
 * position filters (targetPositions, avoidPositions, the K/D/ST/IDP rule), the top config.search.getPool untagged and the top
 * getPoolTagged "Harder to get" ones in MV_add order, then `forced` (its must-include players, kept out of the ranking). A
 * partner's IR player whom an open IR slot of mine would take is priced as a returner. Since Checkpoint 7e (planner reply to
 * Checkpoint 7d, item 4.1) "How to offer it" reads it for the Trade Analyzer's card, and for a Finder card whose search the
 * engine no longer keeps (offers.ts); a search's own are kept in its state (SearchState.getPools). Empty without my team.
 */
export function getPoolOf(I: TradeInternals, settings: TradeSettings, partner: TeamState, forced: readonly string[] = []): string[] {
  return I.me ? getPoolPicker(I, settings)(partner, forced) : [];
}

/** getPoolOf's work for any number of partners, its per-call parts made once (buildPools). */
function getPoolPicker(I: TradeInternals, settings: TradeSettings): (p: TeamState, forced: readonly string[]) => string[] {
  const me = I.me as TeamState;
  const excluded = new Set<Pos>(settings.includeKDefIdp ? [] : config.market.tradeSearchExcluded);
  const tradableOf = (t: TeamState): readonly string[] => (I.irOn ? [...t.roster, ...t.ir] : t.roster);
  const target = new Set<Pos>(settings.targetPositions);
  const avoid = new Set<Pos>(settings.avoidPositions);
  const addValue = addValueOf(I.league);
  const wanted = (pos: Pos | undefined) => pos !== undefined && !excluded.has(pos) && !avoid.has(pos) && (target.size === 0 || target.has(pos));
  const getPool = Math.max(0, Math.floor(config.search.getPool));
  const getPoolTagged = Math.max(0, Math.floor(config.search.getPoolTagged));
  // A partner's IR player comes to me as a returner when I'd have an open IR slot (⚠️ judged before any trade: my IR as it
  // stands) and the slot takes his status (evaluate.ts rule 5): MV_add is then what he adds to V*(me)'s lineups, no drop.
  const myIrOpen = I.irOn && me.ir.length < Math.max(0, Math.floor(I.snapshot.settings.irSlots));
  return (p, forced) => {
    const scored: { id: string; mv: number }[] = [];
    for (const id of new Set(tradableOf(p))) {
      const row = I.league.table.rows.get(id);
      if (!row || forced.includes(id) || !wanted(row.pos)) continue;
      const mask = I.league.maskOf(row);
      let mv: number;
      if (myIrOpen && p.ir.includes(id) && I.irEligible.has(I.snapshot.players[id]?.injury ?? "ACTIVE")) {
        mv = addGainExact(me.vstar.solved, row, mask, I.weights).gain;
      } else {
        const base = baseFor(I.league, I.bases, me.index, row.pos);
        if (!base) continue;
        mv = addValue(me.index, base, row, mask, false);
      }
      if (mv > EPS) scored.push({ id, mv });
    }
    scored.sort((a, b) => (Math.abs(b.mv - a.mv) > EPS ? b.mv - a.mv : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // The top getPool untagged and the top getPoolTagged tagged, kept in MV_add order.
    let untagged = 0;
    let tagged = 0;
    const top: string[] = [];
    for (const x of scored) {
      if (harderToGetFor(I, p.id, x.id) ? tagged++ < getPoolTagged : untagged++ < getPool) top.push(x.id);
    }
    return [...top, ...forced];
  };
}

/** Notes that hold for the whole search: positions left out, picks deferred, B's own (benefit.benefitNotes). */
function searchNotes(I: TradeInternals, settings: TradeSettings): string[] {
  const notes: string[] = [];
  if (!settings.includeKDefIdp) {
    const started = startablePositions(I.snapshot.settings);
    const words = [...new Set(config.market.tradeSearchExcluded.filter((p) => started.has(p)).flatMap((p) => EXCLUDED_WORDS[p] ?? []))];
    if (words.length) notes.push(`${capitalize(listText(words))} are left out; turn them on in Settings.`);
  }
  if (settings.includePicks && I.snapshot.settings.leagueType !== "redraft") notes.push("Draft picks aren't part of trade ideas yet.");
  if (I.sim && I.me) {
    // The same rules benefit() applies to every trade: a paid prize's odds unknown, long-term values missing. Each prize
    // component's change is 0 where the baseline knows it and unknown where it doesn't (reward.ts prizeDeltas). On the shown
    // block's baseline, the cards' "before" (Checkpoint 7e).
    const base = I.sim.base.shown;
    const reward = rewardFor(I, settings);
    const b = benefit({
      leagueType: I.snapshot.settings.leagueType,
      dPO: 0,
      dCH: base.pTitle === null ? null : 0,
      dPrizes: prizeDeltas(base.prizes, base.prizes),
      gMine: 0,
      dynasty: I.future && I.future.myTotal > 0 ? { delta: 0, total: I.future.myTotal } : null,
      myPPlayoffs: base.pPlayoffs,
      lambda: settings.lambda,
      reward,
    });
    notes.push(...benefitNotes(b, reward));
    // B₃ is floored (planner reply to Checkpoint 4c, A2: "When it's floored, note it"): my odds barely move.
    notes.push(...helpsScaleNotes(helpsScaleOf(I, settings.lambda, reward)));
    // B without its market term while the trade values are our own estimates (evaluate.simulateTrade: κ = 0).
    notes.push(...estimatedValuesNotes(I));
  }
  // No trade values at all: the chance they accept reads every trade as even on trade value (evaluate.NO_VALUES_NOTE).
  notes.push(...missingValuesNotes(I));
  return notes;
}

/** One partner's pools (M6): my give pool G and its forced players, the partner's get pool H and its forced players. */
export interface PartnerPool {
  give: readonly string[];
  forcedGive: readonly string[];
  get: readonly string[];
  forcedGet: readonly string[];
}

/**
 * Every side of exactly `size` players that holds every `forced` player, its others from `free` (in that order), in
 * lexicographic order of their places in `free`: the forced players first, then the others in pool order (the exhaustive
 * candidates' sides). None when there are more forced players than `size`.
 */
export function sidesOf(forced: readonly string[], free: readonly string[], size: number): string[][] {
  const k = size - forced.length;
  if (k < 0) return [];
  const out: string[][] = [];
  const pick = (from: number, chosen: readonly string[]) => {
    if (chosen.length === k) {
      out.push([...forced, ...chosen]);
      return;
    }
    for (let i = from; i < free.length; i++) pick(i + 1, [...chosen, free[i] as string]);
  };
  pick(0, []);
  return out;
}

/**
 * One partner's screened candidates (M7, Phase 4c; the file header's "Candidates per partner"), legal ones only, each
 * trade once, before the g window: the seeds (every 1-for-1 of G × H, or the forced core completed to a player a side),
 * then with maxPerSide ≥ 2 the best beamSecond seeds extended once (each single addition from G and from H screened, and
 * the pairExtensionTop best of each side paired) and the exhaustive candidates (unless opts.exhaustive is false), and
 * with maxPerSide ≥ 3 the best beamThird of those two-player trades (the beams' and the exhaustive ones alike) extended
 * once more. Every candidate holds the forced players. `tally.screened` counts the screens (a trade reached twice is
 * screened once). It yields after every SCREEN_BATCH screens (the search's progress).
 */
export function* partnerCandidates(I: TradeInternals, partner: TeamState, pool: PartnerPool, maxPerSide: number, tally: { screened: number }, opts: { exhaustive?: boolean } = {}): Generator<void, Screened[], void> {
  const seen = new Map<string, Screened | null>();
  let sinceYield = 0;
  const screen = (give: readonly string[], get: readonly string[]): Screened | null => {
    const key = proposalKey({ partnerId: partner.id, give: players(give), get: players(get) });
    if (seen.has(key)) return seen.get(key) ?? null;
    tally.screened++;
    sinceYield++;
    const s = screenTrade(I, partner, give, get, key);
    seen.set(key, s);
    return s;
  };

  // Seeds.
  const seeds: Screened[] = [];
  const { forcedGive, forcedGet } = pool;
  const giveOthers = pool.give.filter((id) => !forcedGive.includes(id));
  const getOthers = pool.get.filter((id) => !forcedGet.includes(id));
  const seedSides: [readonly string[], readonly string[]][] = [];
  if (forcedGive.length && forcedGet.length) seedSides.push([forcedGive, forcedGet]);
  else if (forcedGive.length) for (const h of getOthers) seedSides.push([forcedGive, [h]]);
  else if (forcedGet.length) for (const g of giveOthers) seedSides.push([[g], forcedGet]);
  else for (const g of giveOthers) for (const h of getOthers) seedSides.push([[g], [h]]);
  for (const [give, get] of seedSides) {
    if (give.length > maxPerSide || get.length > maxPerSide) continue;
    const s = screen(give, get);
    if (s) seeds.push(s);
    if (sinceYield >= SCREEN_BATCH) {
      sinceYield = 0;
      yield;
    }
  }

  // Extensions: one player from G, one from H, or one from each (the best single additions paired).
  const top = Math.max(0, Math.floor(config.search.pairExtensionTop));
  function* extend(from: readonly Screened[]): Generator<void, Screened[], void> {
    const made = new Map<string, Screened>();
    for (const s of from) {
      const singlesGive: Screened[] = [];
      const singlesGet: Screened[] = [];
      if (s.give.length < maxPerSide) {
        for (const g of pool.give) {
          if (s.give.includes(g)) continue;
          const x = screen([...s.give, g], s.get);
          if (x) singlesGive.push(x);
        }
      }
      if (s.get.length < maxPerSide) {
        for (const h of pool.get) {
          if (s.get.includes(h)) continue;
          const x = screen(s.give, [...s.get, h]);
          if (x) singlesGet.push(x);
        }
      }
      for (const x of [...singlesGive, ...singlesGet]) made.set(x.key, x);
      const bestGive = [...singlesGive].sort(byObjective).slice(0, top);
      const bestGet = [...singlesGet].sort(byObjective).slice(0, top);
      for (const g of bestGive) {
        const addG = g.give.find((id) => !s.give.includes(id)) as string;
        for (const h of bestGet) {
          const addH = h.get.find((id) => !s.get.includes(id)) as string;
          const x = screen([...s.give, addG], [...s.get, addH]);
          if (x) made.set(x.key, x);
        }
      }
      if (sinceYield >= SCREEN_BATCH) {
        sinceYield = 0;
        yield;
      }
    }
    return [...made.values()];
  }

  // The exhaustive candidates (planner reply to Checkpoint 4b, change 1): every 1-for-2 and 2-for-1 from the whole pools,
  // every 2-for-2 from the first twoForTwoTop of each (the forced players in every one, not counted among them).
  function* exhaustive(): Generator<void, Screened[], void> {
    const made = new Map<string, Screened>();
    const best = Math.max(0, Math.floor(config.search.exhaustive.twoForTwoTop));
    const shapes: [string[][], string[][]][] = [
      [sidesOf(forcedGive, giveOthers, 1), sidesOf(forcedGet, getOthers, 2)],
      [sidesOf(forcedGive, giveOthers, 2), sidesOf(forcedGet, getOthers, 1)],
      [sidesOf(forcedGive, giveOthers.slice(0, best), 2), sidesOf(forcedGet, getOthers.slice(0, best), 2)],
    ];
    for (const [gives, gets] of shapes) {
      for (const give of gives) {
        for (const get of gets) {
          const x = screen(give, get);
          if (x) made.set(x.key, x);
          if (sinceYield >= SCREEN_BATCH) {
            sinceYield = 0;
            yield;
          }
        }
      }
    }
    return [...made.values()];
  }

  const all = new Map<string, Screened>(seeds.map((s) => [s.key, s]));
  if (maxPerSide >= 2) {
    const second = yield* extend([...seeds].sort(byObjective).slice(0, Math.max(0, Math.floor(config.search.beamSecond))));
    for (const x of second) all.set(x.key, x);
    const wide = opts.exhaustive === false ? [] : yield* exhaustive();
    for (const x of wide) all.set(x.key, x);
    if (maxPerSide >= 3) {
      // ⚠️ Ours: the third player extends the best two-player trades among the beams' and the exhaustive ones alike.
      const level = new Map<string, Screened>([...second, ...wide].map((x) => [x.key, x]));
      const third = yield* extend([...level.values()].sort(byObjective).slice(0, Math.max(0, Math.floor(config.search.beamThird))));
      for (const x of third) all.set(x.key, x);
    }
  }
  return [...all.values()];
}

/**
 * Whether a player is worth at most the waiver credit W (raw perception values; a player without one counts 0): "a player
 * of mine worth at most W" in the dominance pruning (lead decision N11; dominancePruned), the bar of Phase 4c's neutral
 * throw-ins (market.neutralThrowIns: worth at most W, his own value before the floor; review of track MK: the pruning read
 * "less than W" until then). W must be above 0, as there: with no market values W is 0 and nobody is.
 */
export function atMostWaiverCredit(I: Pick<TradeInternals, "values" | "credit">): (id: string) => boolean {
  const W = I.credit;
  return (id) => Number.isFinite(W) && W > 0 && (I.values[id] ?? 0) <= W;
}

/**
 * The dominance pruning of one partner's screened trades (lead decision N11; the file header): a trade that gives a player
 * of mine worth at most W (`cheap`) is dropped when the same trade without him (same partner, same players of
 * theirs, my side keeping at least one player) is in `list` with an objective at least as high (ties within float noise
 * count as equal). The trades it compares with are the ones passed in (screened and kept by the g window), dropped or
 * not, so a chain of variants keeps its leanest best one: every trade dropped leaves one at least as good with fewer of my
 * players. A must-include player of mine is in every candidate, so no trade without him exists to drop one with him.
 */
export function dominancePruned(list: readonly Screened[], cheap: (id: string) => boolean): Screened[] {
  const byKeyOf = new Map(list.map((s) => [s.key, s]));
  return list.filter((s) => {
    if (s.give.length < 2) return true;
    for (const id of s.give) {
      if (!cheap(id)) continue;
      const lean = byKeyOf.get(proposalKey({ partnerId: s.partnerId, give: players(s.give.filter((x) => x !== id)), get: players(s.get) }));
      if (lean && lean.objective >= s.objective - EPS) return false;
    }
    return true;
  });
}

/**
 * Screening's rules for one partner's candidates, before the keep (M7, N11): the ones inside the screeningGWindow on
 * g_mkt(P) (a non-finite g is outside), without the dominated ones when `cheap` is given (N11: dominancePruned with my
 * players worth at most W, as the search passes it; null: no pruning, for reports that measure it), in their order.
 * (Legality and the must-include players hold for every candidate already: partnerCandidates.)
 */
export function screeningRules(list: readonly Screened[], cheap: ((id: string) => boolean) | null = null): Screened[] {
  const [gLo, gHi] = config.search.screeningGWindow;
  const inWindow = list.filter((x) => Number.isFinite(x.gPartner) && x.gPartner >= gLo - EPS && x.gPartner <= gHi + EPS);
  return cheap ? dominancePruned(inWindow, cheap) : inWindow;
}

/** The shortlist from each partner's candidates past screening's rules (shortlistOf, without the rules). */
function shortlistFrom(ruled: readonly (readonly Screened[])[]): Screened[] {
  const shortlist: Screened[] = [];
  for (const list of ruled) shortlist.push(...[...list].sort(byObjective).slice(0, Math.max(0, Math.floor(config.search.keptPerPartner))));
  return shortlist.sort(byObjective).slice(0, Math.max(0, Math.floor(config.search.exactEvaluationMax)));
}

/**
 * The trades exact evaluation takes from the screening (M7): each partner's candidates past screening's rules
 * (screeningRules: the g window, and the dominance pruning when `cheap` is given), that partner's best keptPerPartner, then
 * the best exactEvaluationMax over all partners. Order: the objective, then the key.
 */
export function shortlistOf(perPartner: readonly (readonly Screened[])[], cheap: ((id: string) => boolean) | null = null): Screened[] {
  return shortlistFrom(perPartner.map((list) => screeningRules(list, cheap)));
}

/**
 * Both lineups gain on the fast method (Checkpoint 7d; the file header, "The helps-both lane"): my ΔROS (Screened.myDelta,
 * the screening objective's own number) and the partner's ΔLineup_P (Screened.partnerDelta, the quick acceptance's), both
 * above 0, float noise aside.
 */
export const bothLineupsGain = (s: Pick<Screened, "myDelta" | "partnerDelta">): boolean => s.myDelta > EPS && s.partnerDelta > EPS;

/** A search's helps-both lane (the file header, "The helps-both lane"), as helpsBothLaneOf chooses it. */
export interface HelpsBothLaneChoice {
  /** The lane: at most `max` trades, best screening objective first (ties: the key). */
  trades: Screened[];
  /** Every candidate past screening's rules on which both lineups gain (bothLineupsGain), and how many of them `taken` held. */
  qualifying: number;
  onShortlist: number;
}

/** helpsBothLaneOf from each partner's candidates past screening's rules. */
function laneFrom(ruled: readonly (readonly Screened[])[], taken: ReadonlySet<string>, max: number): HelpsBothLaneChoice {
  const size = Math.max(0, Math.floor(Number.isFinite(max) ? max : 0));
  const out: Screened[] = [];
  let qualifying = 0;
  let onShortlist = 0;
  for (const list of ruled) {
    for (const s of list) {
      if (!bothLineupsGain(s)) continue;
      qualifying++;
      if (taken.has(s.key)) onShortlist++;
      else out.push(s);
    }
  }
  return { trades: size ? out.sort(byObjective).slice(0, size) : [], qualifying, onShortlist };
}

/**
 * The helps-both lane (Checkpoint 7d; planner reply to Checkpoint 7c, answer 2; the file header): from every partner's
 * candidates (`perPartner`, as partnerCandidates returns them) past screening's rules (screeningRules with `cheap`, as the
 * shortlist reads them), the ones on which both lineups gain (bothLineupsGain) and that `taken` (the shortlist and its lean
 * companions) doesn't hold, the first `max` (config.search.helpsBothLane; 0: none) by the screening objective, then the
 * key; with how many candidates qualified, `taken` or not. Deterministic.
 */
export function helpsBothLaneOf(
  perPartner: readonly (readonly Screened[])[],
  taken: ReadonlySet<string>,
  cheap: ((id: string) => boolean) | null = null,
  max: number = config.search.helpsBothLane,
): HelpsBothLaneChoice {
  return laneFrom(
    perPartner.map((list) => screeningRules(list, cheap)),
    taken,
    max,
  );
}

/**
 * A trade without the players the neutral throw-in rule leaves out of its packages (market.neutralThrowIns on the
 * perception values and W, as g reads them: the planner's step and the matched pairs, on either side), or null when the
 * rule leaves nobody out. The rule reads only values and ids, so it's the same trade from either side. ⚠️ When that
 * leaves a side empty (every player worth at most W) and the planner's step alone leaves somebody out (the side moving
 * more players' cheapest, up to the difference), the trade without those alone (final review of Phase 4c, finding R5: on
 * Parker's league, Oct 4 09:24Z, Rico Dowdle → Jordan Mason + Kalif Raymond, all three worth at most W, had no lean
 * version, so Rico Dowdle → Jordan Mason, likelier at the same Helps you, was never evaluated).
 */
export function leanVersionOf(I: Pick<TradeInternals, "values" | "credit">, give: readonly string[], get: readonly string[]): { give: string[]; get: string[]; removed: readonly string[] } | null {
  const { removed } = neutralThrowIns(get, give, I.values, I.credit);
  if (!removed.length) return null;
  const without = (gone: readonly string[]) => {
    const out = new Set(gone);
    return { give: give.filter((id) => !out.has(id)), get: get.filter((id) => !out.has(id)), removed: gone };
  };
  const lean = without(removed);
  if (lean.give.length && lean.get.length) return lean;
  const step = neutralThrowIns(get, give, I.values, I.credit, undefined, { pairs: false }).removed;
  return step.length ? without(step) : lean;
}

/** An asset's id on its side of a trade (a pick by its season, round and original team: the search never offers one). */
const assetIdOf = (a: TradeAsset): string => (a.kind === "player" ? a.id : `pick:${a.season}:${a.round}:${a.originalTeamId}`);

/**
 * The players `bigger` holds beyond `smaller`, both sides together, when `smaller` is a proper part of it side by side
 * (every asset of `smaller` on the same side of `bigger`, and at least one more); else null, and null too when a pick is
 * among the extras (no player, so no throw-in).
 */
export function extraPlayersOf(smaller: Pick<TradeProposal, "give" | "get">, bigger: Pick<TradeProposal, "give" | "get">): string[] | null {
  const extras: string[] = [];
  for (const side of ["give", "get"] as const) {
    const inSmaller = new Set(smaller[side].map(assetIdOf));
    const inBigger = new Set(bigger[side].map(assetIdOf));
    for (const id of inSmaller) if (!inBigger.has(id)) return null;
    for (const a of bigger[side]) {
      if (inSmaller.has(assetIdOf(a))) continue;
      if (a.kind !== "player") return null;
      extras.push(a.id);
    }
  }
  return extras.length ? extras : null;
}

/** The numbers of a trade barredFromBoxes compares (a pool trade's, a card's). */
export type BoxBarTrade = Pick<TradeEvaluationCore, "key" | "proposal" | "pComplete">;

/**
 * The trades no Plan B box may name (the file header, "Final stages"): the cards, and ⚠️ every trade in `pool` that is a
 * card plus more players (on either side, every player of the card in it on the same side; extraPlayersOf) that don't
 * make it at least `minAcceptGain` likelier to go through than that card (P_complete; default
 * config.search.steps.minAcceptGain, Plan B's own "try again" bar; review of NT, finding 1). Such a box offers a card the
 * list shows again, no easier to say yes to, with players who cost the complexity term; one whose players raise the
 * chance that much (through value, or the partner's lineup, n and h, or a hot streak) keeps the box possible ("add him,
 * they need him"). ⚠️ Since the final review of Phase 4c (findings R2 and PAGES-1) whatever the extra players are worth:
 * the bar first took only players worth at most W, who add nothing through value (without IR moves they move no g:
 * market.ts's header, "Neutral throw-ins"), so on Parker's league (Oct 4 09:24Z) a box offered the card Puka Nacua → Zay
 * Flowers + Omarion Hampton (25.1%) plus Kyle Monangai, worth [value] > W [value], at 23.2% and a lower Helps you. ⚠️ Ours: the bar
 * reads the chance only, never B: an extra player who'd help me more makes a bigger ask of a card already shown, not an
 * easier "try again", and at Parker's B a 20% B difference is inside the simulations' noise (Rico Dowdle → Jordan Mason +
 * Kalif Raymond against the card Rico Dowdle → Jordan Mason: B 0.257 against 0.054 on the screening block, 0.132 against
 * 0.131 on the final one). P_complete is the exact evaluation's, the same on every block of seasons. (A box that another
 * card with the same partner matches or beats on both numbers is passed over too, once its final numbers are known:
 * planB.ts dominatedByCard.)
 */
export function barredFromBoxes(pool: readonly BoxBarTrade[], cards: readonly BoxBarTrade[], minAcceptGain: number = config.search.steps.minAcceptGain): Set<string> {
  const out = new Set(cards.map((c) => c.key));
  const byPartner = new Map<string, BoxBarTrade[]>();
  for (const c of cards) byPartner.set(c.proposal.partnerId, [...(byPartner.get(c.proposal.partnerId) ?? []), c]);
  for (const p of pool) {
    if (out.has(p.key)) continue;
    for (const c of byPartner.get(p.proposal.partnerId) ?? []) {
      if (!extraPlayersOf(c.proposal, p.proposal)) continue;
      if (Number.isFinite(p.pComplete) && Number.isFinite(c.pComplete) && p.pComplete >= c.pComplete + minAcceptGain - EPS) continue;
      out.add(p.key);
      break;
    }
  }
  return out;
}

/**
 * The lean companions of the exact shortlist (the file header, "Lean companions"; ⚠️ ours): for each trade in `shortlist`,
 * in its order, its lean version (leanVersionOf) when both sides keep a player, it holds every must-include player of
 * mine (`pools.forcedGive`) and of that partner's (`pools.get`'s forced), it isn't in the shortlist and no earlier trade
 * brought it, and its screen is legal with g_mkt(P) inside screeningGWindow: the screen from `perPartner` when the
 * candidates had it (every legal lean version, at maxPerSide 2: a 1-for-1 seed), else screened here (`tally.screened`
 * counts those; the search passes none, so counts.screened stays the candidates'). Yields after every SCREEN_BATCH
 * screens of its own. Deterministic. Checkpoint 7d: `skip`, the keys chosen for exact evaluation already (the helps-both
 * lane's call: the shortlist and its companions), which no companion repeats.
 */
export function* leanCompanions(
  I: TradeInternals,
  shortlist: readonly Screened[],
  perPartner: readonly (readonly Screened[])[],
  pools: Pick<Pools, "forcedGive" | "get">,
  tally: { screened: number } = { screened: 0 },
  skip: ReadonlySet<string> = new Set(),
): Generator<void, Screened[], void> {
  const [gLo, gHi] = config.search.screeningGWindow;
  const known = new Map<string, Screened>();
  for (const list of perPartner) for (const s of list) known.set(s.key, s);
  const taken = new Set([...skip, ...shortlist.map((s) => s.key)]);
  const out: Screened[] = [];
  let sinceYield = 0;
  for (const s of shortlist) {
    const lean = leanVersionOf(I, s.give, s.get);
    if (!lean || !lean.give.length || !lean.get.length) continue;
    const forcedGet = pools.get.get(s.partnerId)?.forced ?? [];
    if (!pools.forcedGive.every((id) => lean.give.includes(id)) || !forcedGet.every((id) => lean.get.includes(id))) continue;
    const key = proposalKey({ partnerId: s.partnerId, give: players(lean.give), get: players(lean.get) });
    if (taken.has(key)) continue;
    taken.add(key);
    let screen = known.get(key) ?? null;
    if (!screen) {
      const partner = I.byId.get(s.partnerId);
      if (!partner) continue;
      screen = screenTrade(I, partner, lean.give, lean.get, key);
      tally.screened++;
      if (++sinceYield >= SCREEN_BATCH) {
        sinceYield = 0;
        yield;
      }
    }
    if (screen && Number.isFinite(screen.gPartner) && screen.gPartner >= gLo - EPS && screen.gPartner <= gHi + EPS) out.push(screen);
  }
  return out;
}

/**
 * The caps a ranking in the search reads (rank.ts; §13): config's (the final ranking, resultsShown trades), or `relaxed`
 * (the finalists): one looser per core, per partner and per player of mine given, over every finalist (the partner and
 * given-player caps' window covers all config.search.finalists of them: the file header, "Final stages"), and
 * config.search.finalists trades. `onePartner` (the file header, "One partner"): no per-partner cap at all; the per-core,
 * given-player and filler rules stay.
 */
export function rankCaps(opts: { relaxed: boolean; onePartner: boolean }): RankConfig {
  const loosen = opts.relaxed ? 1 : 0;
  const finalists = Math.max(0, Math.floor(config.search.finalists));
  return {
    perPartnerInTop20: opts.onePartner ? Number.POSITIVE_INFINITY : config.ranking.perPartnerInTop20 + loosen,
    partnerCapTop: opts.relaxed ? Math.max(config.ranking.partnerCapTop, finalists) : config.ranking.partnerCapTop,
    // ⚠️ Ours: one partner keeps it (a one-team list that sells the same player of mine again and again needs it too).
    perGivenPlayerInTop20: config.ranking.perGivenPlayerInTop20 + loosen,
    perCore: config.ranking.perCore + loosen,
    fillerCutoffFraction: config.ranking.fillerCutoffFraction,
    resultsShown: opts.relaxed ? finalists : config.search.resultsShown,
    marketHideBelow: config.benefit.marketHideBelow,
  };
}

/** EG = B × P_complete (−∞ without B): the order the finalists' last places are filled in. */
const egOf = (c: TradeEvaluationCore): number => (c.b === null ? Number.NEGATIVE_INFINITY : c.b * c.pComplete);

/** Hidden by default at these numbers (§10 guards): B ≤ 0 or unknown, or the market guard. */
const hiddenAt = (c: TradeEvaluationCore): boolean => c.b === null || !(c.b > 0) || c.flags.hiddenByMarket;

/** EG, highest first, then the key. */
const byEgThenKey = (a: TradeEvaluationCore, b: TradeEvaluationCore): number => (Math.abs(egOf(b) - egOf(a)) > EPS ? egOf(b) - egOf(a) : byKey(a, b));

/** B (−∞ without one): "by Helps you", the "Helps both" extras' order. */
const bOf = (c: TradeEvaluationCore): number => (c.b === null ? Number.NEGATIVE_INFINITY : c.b);

/** B, highest first, then EG, then the key. */
const byBThenEg = (a: TradeEvaluationCore, b: TradeEvaluationCore): number => (Math.abs(bOf(b) - bOf(a)) > EPS ? bOf(b) - bOf(a) : byEgThenKey(a, b));

/**
 * The finalists the ranking picks (finalistsOf's first part; the file header, "Final stages") among the trades with
 * screening numbers: the first config.search.finalists that rankTrades keeps with its caps relaxed by one (finalistsOf),
 * then, while room is left, the best others by EG (ties: the key) that aren't hidden by default.
 */
function rankedFinalistsOf(cores: readonly TradeEvaluationCore[], value: (asset: TradeAsset) => number, onePartner: boolean, forcedGive: readonly string[]): Set<string> {
  const maxFinalists = Math.max(0, Math.floor(config.search.finalists));
  // Relaxed by one (review of track E, item 3): at 1,000 seasons the order is noisy, and the strict caps dropped trades the
  // 5,000-season numbers rank near the top. The strict rules apply in the final ranking.
  const pre = rankTrades(cores.map(bare), value, rankCaps({ relaxed: true, onePartner }), { givenCapExempt: forcedGive });
  const keys = new Set(pre.trades.map((t) => t.key));
  const rest = cores.filter((c) => !keys.has(c.key) && !hiddenAt(c)).sort(byEgThenKey);
  for (const c of rest) {
    if (keys.size >= maxFinalists) break;
    keys.add(c.key);
  }
  return keys;
}

/** The "Helps both" extras' pool (helpsBothPoolOf): the candidates in their order, the room, and the first `room` of them. */
export interface HelpsBothPool {
  candidates: TradeEvaluationCore[];
  room: number;
  pool: TradeEvaluationCore[];
}

/**
 * The "Helps both" extras' pool (Checkpoint 7c; planner reply to Checkpoint 7b, §7; the file header's "Helps both";
 * finalistsOf): the trades with these numbers that help both teams (benefit.helpsBoth) and aren't hidden by default,
 * finalists or not, by B (ties: EG, then the key); the room, config.search.helpsBothFinalists, one wider for each of them
 * `lane` holds (Checkpoint 7d, the helps-both lane's trades and their companions: ⚠️ the lead's call, review of the lane,
 * LANE-2); and the pool, the first `room`. ⚠️ The plain top 20 (the lead's call: no caps in the choice), chosen without the
 * minimum chance. trade-report's section 10 counts it the same way.
 */
export function helpsBothPoolOf(cores: readonly TradeEvaluationCore[], lane: ReadonlySet<string> = new Set<string>()): HelpsBothPool {
  const candidates = cores.filter((c) => !hiddenAt(c) && helpsBoth(c)).sort(byBThenEg);
  const room = Math.max(0, Math.floor(config.search.helpsBothFinalists)) + candidates.filter((c) => lane.has(c.key)).length;
  return { candidates, room, pool: candidates.slice(0, room) };
}

/**
 * The finalists (the file header, "Final stages") among the trades with screening numbers: the first
 * config.search.finalists that rankTrades keeps with its per-core, per-partner and given-player caps relaxed by one, the
 * caps' window covering every finalist (rankCaps; no per-partner cap when `onePartner`: the file header's "One
 * partner"; the given-player cap never counts `forcedGive`, my must-include players: the file header's "Must-include
 * players of mine"), then, while room is left, the best others by EG = B × P_complete (ties: the key) that aren't hidden
 * by default (rankedFinalistsOf). ⚠️ Never the minimum chance (the file header). Then (Checkpoint 7c; planner reply to
 * Checkpoint 7b, §7; the file header's "Helps both") the "Helps both" pool (helpsBothPoolOf, the room one wider for each of
 * its trades `lane` holds, the helps-both lane's trades and their companions: Checkpoint 7d): those that aren't finalists
 * yet join them (`extras`, in that order). Then (Checkpoint 7d, ⚠️ ours: the final review, ENG-7D-1) the finalists the
 * ranking would pick without the trades `lane` holds that it doesn't pick with them, each whose Helps them is known
 * (`displaced`, in that ranking's order), so the lane never takes a final run another trade would have had.
 * `keys` holds all of them. Also the counts of the others the guards hide (B ≤ 0 or unknown: by benefit; else the market
 * guard).
 */
export function finalistsOf(
  cores: readonly TradeEvaluationCore[],
  value: (asset: TradeAsset) => number,
  onePartner = false,
  forcedGive: readonly string[] = [],
  lane: ReadonlySet<string> = new Set<string>(),
): { keys: Set<string>; extras: string[]; displaced: string[]; hidden: { byBenefit: number; byMarket: number } } {
  const keys = rankedFinalistsOf(cores, value, onePartner, forcedGive);
  // "Helps both": since Checkpoint 7d each candidate from the helps-both lane widens the room by one (⚠️ the lead's call;
  // review of the lane, LANE-2): as the plain top 20, the lane's long shots took a likelier trade's place (smallLeague 13 at
  // 10%: seven lane trades under 5% as printed entered the 20, and the list went from 2 cards to 1). Every trade the 20 would
  // hold without the lane ranks at most that many places lower with it, so it keeps its final run.
  const extras: string[] = [];
  for (const c of helpsBothPoolOf(cores, lane).pool) {
    if (keys.has(c.key)) continue;
    keys.add(c.key);
    extras.push(c.key);
  }
  // ⚠️ The finalists the ranking would pick without the lane (Checkpoint 7d, ours: the final review, ENG-7D-1). The lane's
  // trades take finalists' places like any other trade (the planner's "the same … finalist rules"), and a finalist they push
  // out that helps both only on its final numbers isn't in the pool above, which reads the screening run: without its final
  // run it left the "Helps both" list (smallLeague 45: Helps them 0 on the screening run, 14 on the final one; at 84% the
  // likeliest card the list without the lane shows at 20%, where the lane's long shots are under the minimum). So each one
  // whose Helps them is known (a trade whose partner's scale is unknown can't help both) keeps its final run, which only the
  // "Helps both" list ranks, like the extras; the Overall list keeps to the ranking's finalists.
  const displaced: string[] = [];
  if (lane.size) {
    const byKey = new Map(cores.map((c) => [c.key, c]));
    for (const k of rankedFinalistsOf(cores.filter((c) => !lane.has(c.key)), value, onePartner, forcedGive)) {
      const helps = byKey.get(k)?.them?.helps;
      if (keys.has(k) || typeof helps !== "number" || !Number.isFinite(helps)) continue;
      keys.add(k);
      displaced.push(k);
    }
  }
  const hidden = { byBenefit: 0, byMarket: 0 };
  for (const c of cores) {
    if (keys.has(c.key)) continue;
    if (c.b === null || !(c.b > 0)) hidden.byBenefit++;
    else if (c.flags.hiddenByMarket) hidden.byMarket++;
  }
  return { keys, extras, displaced, hidden };
}

/**
 * What a finished search keeps so the shown list can be ranked again with another minimum chance (refilterSearch; the file
 * header, "Re-filtering"): the context it ran on, its settings, its finalists and Plan B's pool, and the caches the shown
 * list's Plan Bs read, and since Checkpoint 7e what "How to offer it" reads (the file header, "What the ladder reads";
 * deterministic numbers, keyed by trade: reusing them changes nothing).
 */
export interface SearchState {
  /** The context's internals the search ran on (refilterSearch checks it's given the same context). */
  readonly I: TradeInternals;
  /** The search's settings (its minChance is the one it ranked with). */
  readonly settings: TradeSettings;
  readonly onePartner: boolean;
  /** My must-include players (Pools.forcedGive): in every trade, so the given-player cap and the pattern note skip them. */
  readonly forcedGive: readonly string[];
  /**
   * Checkpoint 7e ("How to offer it", planner reply to Checkpoint 7d, item 4.1; the file header, "What the ladder reads"): each
   * searched partner's get pool H and its must-include players (Pools.get), as the search built them.
   */
  readonly getPools: ReadonlyMap<string, { readonly pool: readonly string[]; readonly forced: readonly string[] }>;
  readonly notes: readonly string[];
  readonly counts: TradeSearchResult["counts"];
  /**
   * The keys of the lean companions (the file header, "Lean companions") that went to exact evaluation on top of the
   * shortlist, in their order (an illegal one among them isn't in exactByKey).
   */
  readonly companions: readonly string[];
  /**
   * Checkpoint 7d (the file header, "The helps-both lane"): the lane's trades (keys, in their order: by the screening
   * objective) and the lean companions they brought (keys, in their order), evaluated exactly after the shortlist and its
   * companions (an illegal one isn't in exactByKey); `qualifying`, the screened trades past screening's rules on which both
   * lineups gain, and `onShortlist`, how many of those the shortlist and its companions held. Empty trades and companions
   * with the lane off (the counts still made).
   */
  readonly lane: { readonly trades: readonly string[]; readonly companions: readonly string[]; readonly qualifying: number; readonly onShortlist: number };
  /** The exact trades other than the finalists that the guards hide at screening numbers (finalistsOf). */
  readonly hiddenElsewhere: { readonly byBenefit: number; readonly byMarket: number };
  /**
   * Checkpoint 7c (the file header, "Helps both"): the keys of the trades that got the final simulation for the "Helps both"
   * list only, on top of the finalists the ranking picked: finalistsOf's extras (in their order: by B on the screening
   * block), then since Checkpoint 7d the finalists the helps-both lane displaced (laneDisplaced, in their order). They're
   * among `finals` and count in counts.simFinal, and only the "Helps both" list ranks them.
   */
  readonly helpsBothExtras: readonly string[];
  /**
   * Checkpoint 7d (the file header, "Helps both"; ⚠️ ours, the final review, ENG-7D-1): the finalists the ranking would pick
   * without the helps-both lane's trades and their companions that it doesn't pick with them, each whose Helps them is known
   * (finalistsOf's `displaced`): their final runs are kept for the "Helps both" list (helpsBothExtras holds them too, after
   * the extras). Empty with the lane off.
   */
  readonly laneDisplaced: readonly string[];
  /** The finalists (with the "Helps both" extras, which only that list ranks) with their numbers on the ranking block. */
  readonly finals: readonly TradeEvaluationCore[];
  /**
   * Plan B's pool, fixed before any card picked: every exact trade with its best numbers (a finalist's final ones; a "Helps
   * both" extra's screening ones, as before the extras).
   */
  readonly planBPool: readonly TradeEvaluationCore[];
  readonly planBCfg: PlanBConfig;
  /** Checkpoint 7e: whether the shown pass runs (TradeSearchOptions.shownPass; the file header, "The shown pass"). */
  readonly shownPass: boolean;
  /** Checkpoint 7f: whether the merge runs (TradeSearchOptions.mergeCards; the file header, "Merged cards"). */
  readonly mergeCards: boolean;
  /**
   * Checkpoint 7g (the file header, "Merged cards, Checkpoint 7g"): whether a Last offer can be a smaller ask, the merge's
   * ladders prefer the cards of their lists, and a version a better one of the same trade shows is dropped
   * (TradeSearchOptions.smallerAsks, preferListed, dropDominated).
   */
  readonly smallerAsks: boolean;
  readonly preferListed: boolean;
  readonly dropDominated: boolean;
  /** Checkpoint 7h: whether a Last offer printing a higher Overall than its card is promoted (TradeSearchOptions.promoteLastOffers). */
  readonly promoteLastOffers: boolean;
  /**
   * Versions on the screening block by key: the exact trades' (their screening numbers) and, since Checkpoint 7e, the ones
   * "How to offer it" evaluates (offers.ts adds them; a re-filter's state shares the map). Until then the steps'.
   */
  readonly versions: Map<string, TradeVersion>;
  /** Numbers on the ranking block by key: the finalists', then each Plan B candidate's once simulated. */
  readonly finalByKey: Map<string, TradeEvaluationCore>;
  /**
   * Checkpoint 7e (the file header, "The shown pass"): numbers on the shown block by key, simulated once each: every card a
   * list of the search or of a re-filter of it held (so also one its printed numbers ruled out after),
   * and every Plan B candidate a card's choice reached (a box, or one its printed numbers turned down). A re-filter
   * simulates only the trades no earlier list held.
   */
  readonly shownByKey: Map<string, TradeEvaluationCore>;
  /** The exact trades by key (a Plan B candidate's simulation, and the shown pass, read them). */
  readonly exactByKey: ReadonlyMap<string, ExactTrade>;
  /**
   * Checkpoint 7f (the file header, "Merged cards"): the ladders with words of the cards of this result the merge read, by card
   * key, which offers.ts offerLadderOfSearch hands back as they are (the worker's `offers`). Set on the state a result is
   * registered with (resultOf), never read by the ranking.
   */
  readonly ladders?: ReadonlyMap<string, OfferLadder>;
  /**
   * Checkpoint 7g (the file header, "Merged cards, Checkpoint 7g"): the preference each card's ladder was worked out with when
   * the merge first needed it (its preferred versions, by card key; none for a card without one), so offers.ts
   * offerLadderOfSearch works out the very ladder the merge read. Set on the state a result is registered with (resultOf).
   */
  readonly prefers?: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * Checkpoint 7h (the file header, "Promoted Last offers"): each promoted card's forced "Open with", the idea it was promoted
   * from (by card key), so offers.ts offerLadderOfSearch works out the very ladder the merge read. Set on the state a result is
   * registered with (resultOf).
   */
  readonly opens?: ReadonlyMap<string, string>;
}

const states = new WeakMap<TradeSearchResult, SearchState>();

/**
 * A finished search's state (the file header, "Re-filtering"), by its result object (the one tradeSearch or refilterSearch
 * returned, not a copy that crossed a message boundary); null when the search stopped before ranking (no team, no odds,
 * pools that can't make a trade, …: its result holds for any minimum chance) or for an object no search returned.
 */
export function searchStateOf(result: TradeSearchResult): SearchState | null {
  return states.get(result) ?? null;
}

/** The shown lists built from a state (finish). */
interface Finished {
  shown: TradeEvaluation[];
  /**
   * The Overall list's counts (rank.ts RankedTrades): the trades the guards and the minimum chance kept out, those that
   * qualified, and those the variety rules left out (until Checkpoint 7e with the folded cards), ⚠️ with what the printed numbers took out (Checkpoint
   * 7e; the file header, "The shown pass": a card whose shown B isn't above 0 among the hidden by benefit, one §13's rules
   * drop in the printed order among the dropped).
   */
  hidden: RankedTrades["hidden"];
  qualifying: number;
  dropped: RankedTrades["dropped"] & { merged?: number };
  pattern: PatternNote | null;
  /** TradeSearchResult.filter.few (the file header, "Final stages"). */
  few: boolean;
  /** TradeSearchResult.helpsBoth (Checkpoint 7c; the file header, "Helps both"). */
  both: HelpsBothList;
  /** Checkpoint 7e: the trades the lists show (cards and Plan B boxes, each once) with numbers on the shown block (TradeSearchResult.counts.simShown). */
  simShown: number;
  /** Checkpoint 7f (the file header, "Merged cards"): TradeSearchResult.merged (null without the merge), and the ladders it read, with words (SearchState.ladders). */
  merged: MergedCards | null;
  ladders: Map<string, OfferLadder>;
  /** Checkpoint 7g (the file header, "Merged cards, Checkpoint 7g"): the shown cards' preferences (SearchState.prefers, TradeSearchResult.offerPrefer). */
  prefers: Map<string, ReadonlySet<string>>;
  /** Checkpoint 7h (the file header, "Promoted Last offers"): the shown cards' forced Opens (SearchState.opens, TradeSearchResult.offerOpen). */
  opens: Map<string, string>;
}

/** Two of rank.ts's dropped counts added up. */
function addDropped(a: RankedTrades["dropped"], b: RankedTrades["dropped"]): RankedTrades["dropped"] {
  return { partnerCap: a.partnerCap + b.partnerCap, core: a.core + b.core, filler: a.filler + b.filler, givenPlayer: a.givenPlayer + b.givenPlayer };
}

/** A generator run to its end on the calling thread (planB.ts choosePlanB on numbers it needn't simulate never yields). */
function ranOut<T>(it: Generator<void, T, void>): T {
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/**
 * The pattern note's view of the context (pattern.ts PatternInputs) for a ranking: names and positions from the snapshot,
 * each player's bye by his NFL team (ModelInputs.nfl.byeWeek), the first week team numbers count, the slot instances'
 * labels, and my must-include players (`forcedGive`: the note never names one).
 */
export function patternInputsOf(I: TradeInternals, ranked: readonly TradeEvaluation[], forcedGive: readonly string[] = []): PatternInputs {
  const weeks = I.league.lp.weeks.weeks;
  const labels = new Map(I.instances.map((s) => [s.key, s.label]));
  return {
    ranked,
    forced: forcedGive,
    player: (id) => {
      const info = I.snapshot.players[id];
      return info ? { name: info.name, pos: info.pos } : null;
    },
    byeWeek: (id) => {
      const team = I.snapshot.players[id]?.nflTeam;
      const bye = team ? I.inputs.nfl?.byeWeek?.[team] : undefined;
      return typeof bye === "number" && Number.isFinite(bye) ? bye : null;
    },
    firstWeek: weeks[I.from] ?? Number.POSITIVE_INFINITY,
    slotLabel: (key) => labels.get(key) ?? key,
  };
}

/** What preferredOf reads (Checkpoint 7g; the file header, "Merged cards, Checkpoint 7g"), every card as printed. */
export interface PreferInputs {
  /** The card whose ladder the merge is about to work out. */
  card: TradeEvaluation;
  /** Its list's cards this round. */
  cards: readonly TradeEvaluation[];
  /**
   * The other list's cards: the "Helps both" list's first printed ranking while the Overall list is merged, the Overall
   * list's final cards while the "Helps both" list is. A card on it prefers from it too.
   */
  other: readonly TradeEvaluation[];
  /** Cards that hold merged trades (this list's and, merging "Helps both", the Overall list's), and those that took one this round. */
  holders: ReadonlySet<string>;
  /** The cards of its list a card above it took this round, and the trades its list gave back (released): neither is preferred, from either list. */
  taken: ReadonlySet<string>;
  released: ReadonlySet<string>;
  /** Whether the Overall list is being merged (the cross-list guard's time). */
  overallList: boolean;
  /** The keys of `pool` that could be the card's offers by the rules on both printed numbers (ladderNeighbors, offerFeasible). */
  feasible: (card: TradeEvaluation, pool: readonly TradeEvaluation[]) => string[];
}

/**
 * The versions a card's ladder prefers (Checkpoint 7g; planner reply to Checkpoint 7f, answer 3(b): "When more than one
 * version meets a step's rules, prefer the one that's on the list, so it merges."; the lead's calls D7–D12; the file header,
 * "Merged cards, Checkpoint 7g"): the cards of its list below it on Overall as printed (rank.ts compareOverall) and, when it's
 * on the other list too, that list's cards below it, each that no card above it took this round and its list didn't give back
 * (the other list's too since the final review, E3, merge-b-theirs-ignores-taken: the design's "weren't taken by a card above
 * it in this round", for a trade on both lists), which could be its offers by the rules on the numbers both print
 * (`feasible`), ⚠️ each a leaf: holding no merged trade
 * (preferring one that holds some would break up that card's plan: on Parker's "Helps both" list, league 1, Oct 15, merges went
 * 5 → 2 and 3 trades came back as cards, the design's prototype on 7e9697e), and ⚠️ the cross-list guard: while the Overall
 * list is merged, a card that helps both teams (benefit.helpsBoth, as printed) but isn't on the "Helps both" list's first
 * printed ranking prefers none of its list's cards that help both teams (there, it could arrive late and take a version that
 * holds merges by then: at 75% on that league the guard kept 3 trades from coming back as cards, the same prototype). Pure:
 * the caller hands it the lists.
 */
export function preferredOf(x: PreferInputs): Set<string> {
  const { card, holders } = x;
  const below = (n: TradeEvaluation) => n.key !== card.key && compareOverall(card, n) < 0;
  const free = (n: TradeEvaluation) => !x.taken.has(n.key) && !x.released.has(n.key);
  const leaf = (k: string) => !holders.has(k);
  const byKey = new Map(x.cards.map((n) => [n.key, n]));
  const onOther = x.other.some((t) => t.key === card.key);
  const guard = x.overallList && helpsBoth(card) && !onOther;
  const mine = x
    .feasible(
      card,
      x.cards.filter((n) => below(n) && free(n)),
    )
    .filter(leaf)
    .filter((k) => {
      const n = byKey.get(k);
      return !guard || !(n && helpsBoth(n));
    });
  const theirs = onOther ? x.feasible(card, x.other.filter((n) => below(n) && free(n))).filter(leaf) : [];
  return new Set([...mine, ...theirs]);
}

/**
 * Whether `k` is at least as good as `c` on both Helps you and the chance as printed (Checkpoint 7g, answer 3(c); dominatedOf):
 * Helps you as the card prints it, and the chance P_complete as it prints, its nearest 5% and "<5%" under every step
 * (acceptance.printedAcceptance: 0 for "<5%"; ⚠️ the final review, merge-c-under5-reads-as-5: read as displayAcceptance, "<5%"
 * tied with "5%", so at "Any" a version printing "<5%" dropped one printing "5%", the likelier one).
 */
function atLeastAsGood(k: TradeEvaluation, c: TradeEvaluation): boolean {
  const hk = k.tradeScore;
  const hc = c.tradeScore;
  if (typeof hk !== "number" || typeof hc !== "number" || !Number.isFinite(hk) || !Number.isFinite(hc)) return false;
  return hk >= hc && printedAcceptance(k.pComplete) >= printedAcceptance(c.pComplete) - EPS;
}

/**
 * Whether `k` beats `c` for rule (c) (Checkpoint 7g, answer 3(c); dominatedOf): another version of the same trade (rank.ts
 * versionsOfSameTrade) at least as good on both Helps you and the chance as printed (atLeastAsGood), and, when each is at least
 * as good as the other (both print the same), the one higher in Overall order (rank.ts compareOverall).
 */
export function beatsVersion(k: TradeEvaluation, c: TradeEvaluation): boolean {
  return k.key !== c.key && versionsOfSameTrade(k, c) && atLeastAsGood(k, c) && !(atLeastAsGood(c, k) && compareOverall(c, k) < 0);
}

/**
 * The first version that beats `c` (beatsVersion) among `cards`, in Overall order, then `merged` in their order (dominatedOf's
 * `by`, and the give-back's re-pointing: the file header, "Merged cards, Checkpoint 7g"); undefined for none.
 */
function beaterOf(c: TradeEvaluation, cards: readonly TradeEvaluation[], merged: readonly TradeEvaluation[]): TradeEvaluation | undefined {
  return [...[...cards].sort(compareOverall), ...merged].find((k) => beatsVersion(k, c));
}

/**
 * The cards of one list (as printed, `cards`) to drop (Checkpoint 7g; planner reply to Checkpoint 7f, answer 3(c): "Drop a
 * version when another version of the same trade is at least as good on both Helps you and the chance."; the file header,
 * "Merged cards, Checkpoint 7g"): each card another version of the same trade (rank.ts versionsOfSameTrade, the filler rule's
 * relation: the same partner, one's players side by side a proper part of the other's) beats (beatsVersion): at least as good
 * on both Helps you and the chance as they print them (P_complete as it prints, "<5%" under every step: atLeastAsGood), and,
 * when each is at least as good as the other (both print the same), the one higher in Overall order. Beaten by a card of the
 * list that stays, or by a trade merged into one of its cards (`merged`: shown among that card's offers, never dropped). ⚠️
 * Ours: decided in an order that puts every card that can beat one before it (Helps you, then the chance as printed, then
 * Overall order), each card dropped only for one that stays, so no dropped card's version is dropped too; `by`: the first such
 * version in Overall order, the cards before the merged trades. `exempt`: cards never dropped, though they can beat others
 * (the versions given back once, the final review's E2: each version is dropped at most once). In Overall order the drops'
 * order.
 */
export function dominatedOf(cards: readonly TradeEvaluation[], merged: readonly TradeEvaluation[], exempt: ReadonlySet<string> = new Set()): { key: string; by: string }[] {
  const helpsOf = (t: TradeEvaluation) => (typeof t.tradeScore === "number" && Number.isFinite(t.tradeScore) ? t.tradeScore : Number.NEGATIVE_INFINITY);
  const order = [...cards].sort((a, b) => {
    const ha = helpsOf(a);
    const hb = helpsOf(b);
    if (ha !== hb) return hb > ha ? 1 : -1;
    const ca = printedAcceptance(a.pComplete);
    const cb = printedAcceptance(b.pComplete);
    if (Math.abs(cb - ca) > EPS) return cb > ca ? 1 : -1;
    return compareOverall(a, b);
  });
  const stays: TradeEvaluation[] = [];
  const out = new Map<string, string>();
  for (const c of order) {
    const by = exempt.has(c.key) ? undefined : beaterOf(c, stays, merged);
    if (by) out.set(c.key, by.key);
    else stays.push(c);
  }
  return [...cards]
    .sort(compareOverall)
    .flatMap((c) => (out.has(c.key) ? [{ key: c.key, by: out.get(c.key) as string }] : []));
}

/**
 * Rank the state's finalists with `minChance` and build the shown lists (the file header, "Final stages" from the final
 * ranking on, "Helps both", "The shown pass" and "Merged cards"): each list ranked on the ranking block (the Overall list in
 * Overall order, the "Helps both" list in Helps-you order), each card's numbers on the shown block, then the list ranked again
 * on the numbers its cards print, which only takes out and sorts; since Checkpoint 7f, each list's merge (settle: the ladders
 * of the cards that can hold another card of the list, the trades the cards above them offer folded into those cards, and the
 * list ranked again without them, until a round folds nothing); then each card's Plan B in the printed order, its words and
 * its injury tags, once per card for both lists, reusing and growing the state's caches; the ladders the merge read, with
 * words; the uncapped ranking behind the pattern note, `few` and the "Helps both" list's lowerWouldAdd last, on the lists
 * shown. (Until Checkpoint 7e each card also got its "Offer first / if they say no" steps here, and each list folded the cards
 * that showed one plan.)
 */
function* finish(state: SearchState, settings: TradeSettings, mark: (stage: TimingKey) => void): Generator<TradeSearchProgress, Finished, void> {
  const { I, onePartner, forcedGive, finalByKey, exactByKey } = state;
  const value = assetValue(I);
  const minChance = settings.minChance;
  const reward = rewardFor(I, settings);

  // Rank and diversify (§13), on the ranking block's numbers (the words never change the order), the minimum chance before
  // the caps; my must-include players outside the given-player cap.
  yield { stage: "rank", done: 0, total: 1 };
  const all = state.finals.map(bare);
  const finalOfKey = new Map(all.map((c) => [c.key, c]));
  // ⚠️ The Overall list (and the rankings behind `few` and the pattern note) ranks the finalists the ranking picked, never the
  // "Helps both" extras (the file header, "Helps both"): they were simulated so that list has enough candidates.
  const extras = new Set(state.helpsBothExtras);
  const regular = extras.size ? all.filter((c) => !extras.has(c.key)) : all;
  const caps = rankCaps({ relaxed: false, onePartner });
  // The "Helps both" list's ranking (Checkpoint 7c; the file header, "Helps both"): every finalist, the extras too, with the
  // same guards, minimum and caps, only the trades that help both teams on their ranking numbers (benefit.helpsBoth), in
  // Helps-you order. Each list's rankings leave out the trades merged into one of its cards, which the filler rule reads as
  // kept (Checkpoint 7f: rank.ts RankOptions.shownElsewhere; the file header, "Merged cards").
  const keepBoth = (t: TradeEvaluation) => helpsBoth(t);
  // Checkpoint 7h: `exempt`, a list's promoted Last offers by key, each with the idea it was promoted from (rank.ts
  // RankOptions.fillerExempt: never filler of it).
  const exemptOf = (exempt?: ReadonlyMap<string, string>): Partial<RankOptions> => (exempt && exempt.size ? { fillerExempt: exempt } : {});
  const overallOptions = (elsewhere: readonly TradeEvaluation[], exempt?: ReadonlyMap<string, string>): RankOptions => ({ minChance, givenCapExempt: forcedGive, shownElsewhere: elsewhere, ...exemptOf(exempt) });
  const bothOptions = (elsewhere: readonly TradeEvaluation[], exempt?: ReadonlyMap<string, string>): RankOptions => ({ minChance, givenCapExempt: forcedGive, order: "helps", keep: keepBoth, shownElsewhere: elsewhere, ...exemptOf(exempt) });
  const without = (list: readonly TradeEvaluation[], merged: ReadonlyMap<string, unknown>): readonly TradeEvaluation[] => (merged.size ? list.filter((c) => !merged.has(c.key)) : list);
  // The merged trades with the numbers `numbers` gives (the ranking block's: as they are; or as printed).
  const mergedTrades = (merged: ReadonlyMap<string, unknown>, numbers: (t: TradeEvaluation) => TradeEvaluation): TradeEvaluation[] =>
    [...merged.keys()].flatMap((k) => {
      const t = finalOfKey.get(k);
      return t ? [numbers(t)] : [];
    });
  const asRanked = (t: TradeEvaluation): TradeEvaluation => t;
  // Checkpoint 7h (the file header, "Promoted Last offers"): a list ranks its promoted Last offers too, with their numbers on the
  // ranking block (`added`: the ones its own candidates don't hold already).
  const withAdded = (base: readonly TradeEvaluation[], added: readonly TradeEvaluation[]): readonly TradeEvaluation[] => (added.length ? [...base, ...added] : base);
  const rankOverall = (merged: ReadonlyMap<string, unknown>, added: readonly TradeEvaluation[] = [], exempt?: ReadonlyMap<string, string>): RankedTrades =>
    rankTrades(without(withAdded(regular, added), merged), value, caps, overallOptions(mergedTrades(merged, asRanked), exempt));
  const rankBoth = (merged: ReadonlyMap<string, unknown>, added: readonly TradeEvaluation[] = [], exempt?: ReadonlyMap<string, string>): RankedTrades =>
    rankTrades(without(withAdded(all, added), merged), value, caps, bothOptions(mergedTrades(merged, asRanked), exempt));
  const noneMerged = new Map<string, MergedTrade>();
  const firstOverall = rankOverall(noneMerged);
  const firstBoth = rankBoth(noneMerged);
  mark("rank");

  // The numbers a card or a box prints (Checkpoint 7e; the file header, "The shown pass"): its run on the shown block,
  // simulated the first time a list holds it (its partner's "Helps them" scale on that block first), once per key
  // (SearchState.shownByKey, so a re-filter simulates only what no earlier list held). Without the pass
  // (TradeSearchOptions.shownPass false) its ranking numbers; when the shown block is the ranking block
  // (config.simulation.shownSims at most finalSims: the same seasons, baseline and scales) its ranking numbers too, bit for
  // bit, taken as they are. The timings put the runs under "shown", the rest of this stage under "steps".
  const sim = I.sim;
  const own = state.shownPass && sim !== null && sim.blocks.shown !== sim.blocks.final;
  const printedOf = (t: TradeEvaluationCore): TradeEvaluationCore => (state.shownPass ? (state.shownByKey.get(t.key) ?? t) : t);
  // Progress under "rank" (the file header, "Progress"): units done of the units planned (each card's numbers, its Plan B,
  // each run on the shown block, each partner's scale there, and since Checkpoint 7f each step of a ladder the merge works
  // out), planned up front for the cards of the first rankings and, for any other, as it's done (a unit added to both
  // counts), so the bar only moves forward; a card the rounds take off its list leaves its Plan B's unit out of the total
  // (below), so the units done reach the total; with `part` "shown" while the pass plays the ideas out on a block of its own,
  // and since Checkpoint 7f "offers" while the merge works a ladder out (tradeView.ts progressView names both).
  const planned = new Set<string>();
  const finished = new Set<string>();
  const unit = (id: string) => {
    planned.add(id);
    finished.add(id);
  };
  let part: TradeSearchProgress["part"] = own ? "shown" : undefined;
  const progress = (): TradeSearchProgress => ({ stage: "rank", done: finished.size, total: Math.max(1, planned.size), ...(part ? { part } : {}) });
  // A trade's exact evaluation: an exact trade's, or since Checkpoint 7h a ladder's version (a promoted Last offer: SearchState.versions).
  const exactOf = (key: string): ExactTrade | undefined => exactByKey.get(key) ?? state.versions.get(key)?.x;
  function* shownRun(key: string): Generator<TradeSearchProgress, void, void> {
    if (!state.shownPass || !sim || state.shownByKey.has(key)) return;
    if (!own) {
      const ranking = finalByKey.get(key);
      if (ranking) state.shownByKey.set(key, ranking);
      return;
    }
    const x = exactOf(key);
    if (!x) return;
    // A yield before each run too: a run on the shown block is the stage's longest unit of work (about 35–47 ms on Parker's
    // leagues in Node since Checkpoint 7f, continuing its ranking run; 45–61 before), so no slice holds a run and other work
    // besides.
    yield progress();
    if (!sim.partners.has(x.partner.id)) {
      mark("steps");
      partnerCalibrationOf(I, x.partner.id, "shown");
      mark("shown");
      unit(`partner:${x.partner.id}`);
      yield progress();
    }
    mark("steps");
    state.shownByKey.set(key, simulateTrade(I, x, "shown", settings.lambda, settings.protectValue, reward));
    mark("shown");
    unit(`run:${key}`);
    yield progress();
  }
  const firstListed = [...new Map([...firstOverall.trades, ...firstBoth.trades].map((c) => [c.key, c])).values()];
  for (const t of firstListed) {
    planned.add(`card:${t.key}`);
    planned.add(`box:${t.key}`);
    const partner = exactByKey.get(t.key)?.partner.id;
    if (!own || state.shownByKey.has(t.key) || partner === undefined) continue;
    planned.add(`run:${t.key}`);
    if (sim && !sim.partners.has(partner)) planned.add(`partner:${partner}`);
  }
  const printed = (t: TradeEvaluation): TradeEvaluation => bare(printedOf(t));

  // The ladders the merge reads (Checkpoint 7f; the file header, "Merged cards"): a card's choices (offers.ts
  // searchLadderChoiceSteps, once per minimum chance and card in the search's store), worked out in steps of one exact
  // evaluation or one run on the shown block each, a progress unit and a yield each, so no slice of the search holds more;
  // by card key, each read once per finish. Its progress reads `part` "offers" meanwhile (the bar says the ideas' offers are
  // being worked out, not played out). ⚠️ A ladder's run on the shown block plays all 20,000 seasons unless the search
  // ranked that version: its versions are screened, not ranked, so most have no ranking run to continue (about 44 ms on
  // Parker's league in Node, 61 ms on his 12-team one: the file header, "Progress").
  const choices = new Map<string, LadderChoice | null>();
  // Checkpoint 7g (answer 3(b)): each card's preference, fixed when its ladder is first worked out (SearchState.prefers).
  const prefers = new Map<string, ReadonlySet<string>>();
  // Checkpoint 7h (answer 3; "Promoted Last offers" in the file header): each promoted card's forced Open, the idea it was
  // promoted from, set before its ladder is first worked out and fixed from then on (SearchState.opens), both lists'.
  const opens = new Map<string, string>();
  let ladderSteps = 0;
  function* choiceOf(card: TradeEvaluation, prefer?: ReadonlySet<string>): Generator<TradeSearchProgress, LadderChoice | null, void> {
    const known = choices.get(card.key);
    if (known !== undefined) return known;
    if (prefer && prefer.size) prefers.set(card.key, prefer);
    mark("steps");
    const it = searchLadderChoiceSteps(ladderJobOfSearch(state, card, prefers.get(card.key), opens.get(card.key)));
    const was = part;
    part = "offers";
    let r = it.next();
    while (!r.done) {
      mark("offers");
      unit(`offer:${++ladderSteps}`);
      yield progress();
      r = it.next();
    }
    part = was;
    mark("offers");
    choices.set(card.key, r.value);
    return r.value;
  }

  /**
   * One list's cards (settle): its ranking on the ranking block, again on the printed numbers, its merges, its versions dropped
   * for a better one (Checkpoint 7g; DominatedTrade), the merged trades given back (released), the dropped versions given back
   * (restored: the final review's E2) and how many rounds.
   */
  interface Settled {
    ranking: RankedTrades;
    printed: RankedTrades;
    merged: Map<string, MergedTrade>;
    dominated: Map<string, DominatedTrade>;
    released: Set<string>;
    restored: Set<string>;
    rounds: number;
    /** Checkpoint 7h ("Promoted Last offers"): the list's promoted Last offers, by key, in the order they were promoted. */
    promoted: Map<string, PromotedTrade>;
    /** Their numbers on the ranking block, for those the list's own candidates don't hold (the list ranks them too). */
    added: Map<string, TradeEvaluation>;
    /** The ideas a chain of promotions left out, for good. */
    superseded: Set<string>;
    /** The Last offers printing a higher Overall than their card that weren't promoted, as the list's last pass found them. */
    notPromoted: NotPromoted[];
  }
  // Every trade's printed EG (B × P_complete on the printed numbers; −∞ without B): the Overall order on one block (one B₃).
  const printedEg = (c: Pick<TradeEvaluationCore, "b" | "pComplete">): number => (c.b === null || !Number.isFinite(c.b) ? Number.NEGATIVE_INFINITY : c.b * c.pComplete);
  // The keys of `pool` that could be `card`'s offers by the rules on the numbers both print (offers.ts ladderNeighbors, each
  // kind a neighbor can be, and offerFeasible), each once, in `pool`'s order (Checkpoint 7f's test; preferredOf's `feasible`).
  const feasibleOf = (card: TradeEvaluation, pool: readonly TradeEvaluation[]): string[] => {
    const byKey = new Map(pool.map((t) => [t.key, t]));
    return [...new Set(ladderNeighbors(state, card, pool).flatMap((n) => (offerFeasible(card, byKey.get(n.key) as TradeEvaluation, n.kind, minChance) ? [n.key] : [])))];
  };
  // ⚠️ The card of the list above a merged trade whose offers hold it (the release rule, ours: the file header, "Merged
  // cards"), with its place there: its own card when it's still on the list (its choices hold it), else the first card above
  // it (in the list's order) whose ladder holds it, of those that can (ladderNeighbors, offerFeasible on both cards' printed
  // numbers, since Checkpoint 7g each kind it can be: their ladders worked out to see); null for none.
  function* holderAbove(m: MergedTrade, cards: readonly TradeEvaluation[]): Generator<TradeSearchProgress, MergedTrade | null, void> {
    if (cards.some((c) => c.key === m.into)) return m;
    const t = finalOfKey.get(m.key);
    if (!t) return null;
    const trade = printed(t);
    for (const c of cards) {
      if (compareOverall(c, trade) >= 0) continue;
      if (!feasibleOf(c, [trade]).length) continue;
      const offer = choiceOffers(yield* choiceOf(c)).find((o) => o.key === m.key);
      if (offer) return { key: m.key, into: c.key, kind: offer.kind };
    }
    return null;
  }
  // The merge's step of one round (Checkpoint 7f): the ladders of the cards one of whose cards of the list below it (Overall as
  // printed) can be an offer by the rules on the numbers both print, worked out in the list's order, then, going down the cards
  // by Overall, each card not merged this round takes every card of the list below it that its offers hold.
  function* takenAsBefore(cards: readonly TradeEvaluation[], listed: ReadonlyMap<string, TradeEvaluation>, released: ReadonlySet<string>): Generator<TradeSearchProgress, Map<string, MergedTrade>, void> {
    for (const c of cards) {
      const below = (n: TradeEvaluation) => !released.has(n.key) && compareOverall(c, n) < 0;
      const near = ladderNeighbors(state, c, cards.filter(below)).some((n) => offerFeasible(c, listed.get(n.key) as TradeEvaluation, n.kind, minChance));
      if (near) yield* choiceOf(c);
    }
    mark("steps");
    const now = new Map<string, MergedTrade>();
    for (const k of [...cards].sort(compareOverall)) {
      if (now.has(k.key)) continue;
      for (const o of choiceOffers(choices.get(k.key) ?? null)) {
        const f = listed.get(o.key);
        if (!f || f.key === k.key || now.has(f.key) || released.has(f.key)) continue;
        if (compareOverall(k, f) < 0) now.set(f.key, { key: f.key, into: k.key, kind: o.kind });
      }
    }
    return now;
  }
  // Since Checkpoint 7g (answer 3(b); the file header, "Merged cards, Checkpoint 7g"): top-down. Going down the cards by
  // Overall as printed, a card not taken this round whose ladder isn't known yet and one of whose cards of the list below it
  // (not taken this round, not given back) can be an offer gets its ladder worked out just then, with its preference
  // (preferredOf: fixed from then on), and each card not taken this round takes every card of the list below it that its
  // offers hold. A card taken this round never gets a ladder (it holds nothing once it's an offer: ⚠️ so the merge reads fewer
  // ladders than Checkpoint 7f's, MergedCards.ladders).
  function* takenTopDown(
    cards: readonly TradeEvaluation[],
    listed: ReadonlyMap<string, TradeEvaluation>,
    released: ReadonlySet<string>,
    holders: ReadonlySet<string>,
    other: readonly TradeEvaluation[],
    overallList: boolean,
  ): Generator<TradeSearchProgress, Map<string, MergedTrade>, void> {
    const now = new Map<string, MergedTrade>();
    for (const c of [...cards].sort(compareOverall)) {
      if (now.has(c.key)) continue;
      let choice = choices.get(c.key);
      if (choice === undefined) {
        const below = cards.filter((n) => n.key !== c.key && !released.has(n.key) && !now.has(n.key) && compareOverall(c, n) < 0);
        if (!feasibleOf(c, below).length) continue;
        const taking = new Set([...holders, ...[...now.values()].map((m) => m.into)]);
        const prefer = preferredOf({ card: c, cards, other, holders: taking, taken: new Set(now.keys()), released, overallList, feasible: feasibleOf });
        choice = yield* choiceOf(c, prefer);
      }
      for (const o of choiceOffers(choice)) {
        const f = listed.get(o.key);
        if (!f || f.key === c.key || now.has(f.key) || released.has(f.key)) continue;
        if (compareOverall(c, f) < 0) now.set(f.key, { key: f.key, into: c.key, kind: o.kind });
      }
    }
    mark("steps");
    return now;
  }
  // One list (Checkpoint 7f; the file header, "Merged cards"; until then the first round alone): each round, its cards'
  // numbers on the shown block (once per key: the first round's planned up front, a later one's counted as done), then the
  // list ranked again on the numbers its cards print (⚠️ ours: Checkpoint 7e's review, SHOWN-3; the file header, "The shown
  // pass": rankTrades on the list's own cards, so it can only take cards out and sort the rest: a card whose shown B isn't
  // above 0, §10's guard; one whose printed numbers don't help both teams, from the "Helps both" list; one §13's rules drop in
  // the printed order: the caps in the top 20, the core cap, the filler rule; without the pass, or with the shown block the
  // ranking block, it changes nothing). Then, with the merge on: the ladders of its cards one of whose cards of the list
  // below it (Overall as printed: rank.ts compareOverall, the list's own order on the Overall list) can be an offer by the
  // rules on the numbers both print (ladderNeighbors, offerFeasible), and, going down the cards by Overall, each card not
  // merged this round takes every card of the list below it that its offers hold (⚠️ the lead's call, policy (a): one above
  // it stays a card, which the offer's label names, so a card needs no ladder for those); they leave the list, which is
  // ranked again without them, until a round merges none. ⚠️ Then the release rule (ours): a merged trade in no offers of a
  // card above it on the list comes back for good and the rounds go on. Checkpoint 7g (the file header, "Merged cards,
  // Checkpoint 7g"): the ladders worked out top-down with each card's preference (takenTopDown; takenAsBefore with the
  // preference off), and once a round merges none, the versions a better one of the same trade beats on the printed numbers
  // leave (dominatedOf), like merged trades: out of the later rankings, read by the filler rule as kept, and the rounds go on;
  // ⚠️ when one of them held merged trades, the release rule runs at once, on the list without them, so the next round ranks
  // the trades given back before (c) reads the list again; and once a round merges none, drops none and gives no merged
  // trade back, a dropped version whose `by` is no longer a card of the list or a trade merged into one is re-pointed to
  // another that beats it, else given back for good (the final review's E2, merge-c-by-can-leave). Checkpoint 7h (the file
  // header, "Promoted Last offers"): once a round merges none, drops none and gives nothing back, every card's ladder, and the
  // cards whose Last offer prints a higher Overall than they do are promoted (promote), and the rounds go on; the release rule
  // leaves out for good an idea whose promoted card was promoted in turn and that no card above it offers (`superseded`).
  function* settle(
    first: RankedTrades,
    rank: (out: ReadonlyMap<string, unknown>, added: readonly TradeEvaluation[], exempt?: ReadonlyMap<string, string>) => RankedTrades,
    options: (elsewhere: readonly TradeEvaluation[], exempt?: ReadonlyMap<string, string>) => RankOptions,
    list: "overall" | "helpsBoth",
    other: () => readonly TradeEvaluation[],
    otherHolders: () => ReadonlySet<string>,
    base: ReadonlySet<string>,
  ): Generator<TradeSearchProgress, Settled, void> {
    const merged = new Map<string, MergedTrade>();
    const dominated = new Map<string, DominatedTrade>();
    const released = new Set<string>();
    const restored = new Set<string>();
    // Checkpoint 7h: the list's promotions, the promoted trades its candidates add, the ideas promoted (merged into their
    // promoted card), the ideas a chain left out, and the Last offers its last pass didn't promote.
    const promoted = new Map<string, PromotedTrade>();
    const added = new Map<string, TradeEvaluation>();
    const origins = new Set<string>();
    const superseded = new Set<string>();
    let notPromoted: NotPromoted[] = [];
    // The trades out of the list's rankings (the filler rule's references): the merged ones and the dropped versions (and since
    // Checkpoint 7h the ideas a chain of promotions left out).
    const outOf = (): ReadonlyMap<string, unknown> =>
      dominated.size || superseded.size ? new Map<string, unknown>([...merged, ...dominated, ...[...superseded].map((k): [string, unknown] => [k, true])]) : merged;
    // Checkpoint 7h: each promoted Last offer with the idea it was promoted from, never its filler (rank.ts RankOptions.fillerExempt).
    const exemptNow = (): ReadonlyMap<string, string> => new Map([...promoted.values()].map((p) => [p.key, p.from]));
    // The release rule on `cards` (the list as it stands): each merged trade's card is one on the list above it (a card merged
    // or dropped later hands its own on to the one holding them: holderAbove), the others come back for good. ⚠️ Since
    // Checkpoint 7h (the lead's ruling for a chain of promotions: "the earlier version goes where the newest card's ladder rules
    // place it, or leaves (counted)"): an idea merged into its promoted card, whose card was promoted in turn (merged into the
    // newer card as its forced Open) and that no card above it offers, leaves the list for good (`superseded`) rather than
    // coming back. Their keys, given back or left out.
    function* release(cards: readonly TradeEvaluation[]): Generator<TradeSearchProgress, string[], void> {
      const back: string[] = [];
      const gone: string[] = [];
      for (const m of [...merged.values()]) {
        const holder = yield* holderAbove(m, cards);
        if (holder) merged.set(m.key, holder);
        else if (origins.has(m.key) && origins.has(m.into)) gone.push(m.key);
        else back.push(m.key);
      }
      for (const key of gone) {
        merged.delete(key);
        superseded.add(key);
      }
      for (const key of back) {
        merged.delete(key);
        released.add(key);
      }
      return [...back, ...gone];
    }
    // A trade's numbers on the ranking block (Checkpoint 7h: a promoted Last offer is a ladder's version, never simulated there
    // unless the search ranked it or a Plan B box needed it), simulated once (finalByKey, as a Plan B candidate is), a progress
    // unit; under the "offers" timing, the merge's own work.
    function* rankingCoreOf(key: string): Generator<TradeSearchProgress, TradeEvaluationCore | null, void> {
      const known = finalByKey.get(key);
      if (known) return known;
      const x = exactOf(key);
      if (!x) return null;
      yield progress();
      mark("steps");
      const core = simulateTrade(I, x, "final", settings.lambda, settings.protectValue, reward);
      finalByKey.set(key, core);
      mark("offers");
      unit(`promote:${key}`);
      yield progress();
      return core;
    }
    // ⚠️ The promotion pass (Checkpoint 7h; planner reply to Checkpoint 7g, answer 3: "When an offer list finds a version with a
    // higher Overall than the idea it sits under: that version becomes the idea; the original becomes its "Open with" step, the
    // bigger ask."; the lead's rulings; the file header, "Promoted Last offers"). Every card's ladder first (choiceOf: a card
    // whose ladder the merge didn't read gets the one its first open would give, with no preference, so its offers are the
    // ones Checkpoint 7g showed when it was opened). Then, going down the cards by Overall as printed, each card whose Last
    // offer prints a higher Overall (EG on the printed numbers) than it does is a candidate, unless (NotPromoted's reasons): the
    // card is a merged trade given back ("released": never merged again); the Last offer is a card of the list already
    // ("card": it stays, labeled on this card's offers as before); it's merged, dropped or left out on the list ("shown");
    // another idea's promotion took it, this pass or before, or its ladder was worked out before without this card as its Open
    // ("taken": a card's ladder, once worked out, is fixed, as its preference is: Checkpoint 7g's D11); or the card can't be its
    // Open by the Open's other rules (offers.ts forcedOpenOk: "open"). Each candidate's Last offer gets its numbers on the
    // ranking block (rankingCoreOf; its printed ones are the ladder's). ⚠️ Then (ours) the list is ranked as the next round
    // would rank it, with every candidate promoted, and a candidate whose Last offer that ranking doesn't keep (the list's own
    // rules: the given-player cap, most often, the throw-in being a player of mine other cards give too, or the partner's or
    // the core's cap) isn't promoted ("rules"), until every candidate left is kept: its card stays, with that Last offer, so no
    // round is spent promoting a version the list then drops and giving its card back (on smallLeague 1 at 10%, 7 of 7 promoted
    // throw-ins gave a player of mine the top 3 cards give already). The rest are promoted: the Last offer joins the list's
    // candidates, its forced Open the card (`opens`: offers.ts LadderJob.open, its ladder worked out with it), and the card is
    // merged into it as its "open". Whether any was promoted.
    function* promote(cards: readonly TradeEvaluation[]): Generator<TradeSearchProgress, boolean, void> {
      const order = [...cards].sort(compareOverall);
      for (const c of order) yield* choiceOf(c);
      const listed = new Set(cards.map((c) => c.key));
      const misses: NotPromoted[] = [];
      let candidates: { card: TradeEvaluation; last: NonNullable<LadderChoice["last"]>; ranked: TradeEvaluation }[] = [];
      const takenNow = new Set<string>();
      for (const c of order) {
        const last = choices.get(c.key)?.last;
        if (!last || !(printedEg(last.printed) > printedEg(c) + EPS)) continue;
        const p = last.printed.key;
        const reason: NotPromoted["reason"] | null = released.has(c.key)
          ? "released"
          : listed.has(p)
            ? "card"
            : merged.has(p) || dominated.has(p) || superseded.has(p)
              ? "shown"
              : takenNow.has(p) || ((opens.has(p) || choices.has(p)) && opens.get(p) !== c.key)
                ? "taken"
                : !forcedOpenOk(last.printed, c, minChance)
                  ? "open"
                  : null;
        if (reason) {
          misses.push({ card: c.key, offer: p, list, reason });
          continue;
        }
        const core = yield* rankingCoreOf(p);
        if (!core) {
          misses.push({ card: c.key, offer: p, list, reason: "taken" });
          continue;
        }
        takenNow.add(p);
        candidates.push({ card: c, last, ranked: bare(core) });
      }
      // The list as the next round ranks it, every candidate promoted; the ones it doesn't keep leave the candidates, until none.
      for (;;) {
        if (!candidates.length) break;
        const out = new Map<string, unknown>([...outOf(), ...candidates.map((x): [string, unknown] => [x.card.key, true])]);
        const add = [...added.values(), ...candidates.filter((x) => !base.has(x.ranked.key)).map((x) => x.ranked)];
        const exempt = new Map([...exemptNow(), ...candidates.map((x): [string, string] => [x.ranked.key, x.card.key])]);
        const kept = new Set(rank(out, add, exempt).trades.map((t) => t.key));
        const next = candidates.filter((x) => kept.has(x.ranked.key));
        if (next.length === candidates.length) break;
        for (const x of candidates) if (!kept.has(x.ranked.key)) misses.push({ card: x.card.key, offer: x.ranked.key, list, reason: "rules" });
        candidates = next;
      }
      for (const { card: c, last, ranked } of candidates) {
        const p = ranked.key;
        finalOfKey.set(p, ranked);
        if (!base.has(p)) added.set(p, ranked);
        if (own && !state.shownByKey.has(p)) state.shownByKey.set(p, last.printed);
        opens.set(p, c.key);
        merged.set(c.key, { key: c.key, into: p, kind: "open" });
        origins.add(c.key);
        promoted.set(p, { key: p, from: c.key, list, kind: last.kind });
      }
      mark("rank");
      notPromoted = misses;
      return candidates.length > 0;
    }
    // ⚠️ The give-back (the final review's E2): each dropped version whose `by` is no longer a card of the list (`cards`) or a
    // trade merged into one, the release rule having just placed every merged trade with a card of the list, is re-pointed to
    // the first other version that beats it on the printed numbers (beaterOf: the cards in Overall order, then the merged
    // trades), else given back for good (`restored`: never dropped again). Whether any came back.
    const giveBack = (cards: readonly TradeEvaluation[]): boolean => {
      const shown = mergedTrades(merged, printed);
      const here = new Set([...cards, ...shown].map((t) => t.key));
      let back = false;
      for (const d of [...dominated.values()]) {
        if (here.has(d.by)) continue;
        const self = finalOfKey.get(d.key);
        const by = self ? beaterOf(printed(self), cards, shown) : undefined;
        if (by) {
          dominated.set(d.key, { ...d, by: by.key });
          continue;
        }
        dominated.delete(d.key);
        restored.add(d.key);
        back = true;
      }
      return back;
    };
    // ⚠️ The rounds end (ours, as the release rule's): every round but the last merges a trade, drops a version, gives a merged
    // trade back or gives a dropped version back (since Checkpoint 7h also promotes a Last offer, merging the idea it sat under
    // into it, or leaves an idea out for good), and each of these happens to a trade at most once (a merged trade given back is
    // never merged again, `released`, and a promotion merges the idea it promotes from, never one merged or given back before;
    // a dropped version given back is never dropped again, `restored`; an idea left out never comes back, `superseded`; a merged
    // or dropped trade is out of the list, so nothing merges or drops it again meanwhile; a Last offer is promoted to once, its
    // forced Open fixed then, `opens`). The trades are finite (the finalists and the versions promoted, one a promotion), and each
    // promotion raises the list's printed Overall at that place (the promoted Last offer prints a higher EG than the idea it
    // replaces, so no chain of promotions comes back to a trade), so a list takes a bounded number of rounds, plus its last.
    let ranking = first;
    for (let rounds = 1; ; rounds++) {
      if (rounds > 1) {
        ranking = rank(outOf(), [...added.values()], exemptNow());
        mark("rank");
      }
      for (const t of ranking.trades) {
        yield* shownRun(t.key);
        unit(`card:${t.key}`);
        yield progress();
      }
      const printedList = rankTrades(ranking.trades.map(printed), value, caps, options(mergedTrades(outOf(), printed), exemptNow()));
      mark("rank");
      const settled = (): Settled => ({ ranking, printed: printedList, merged, dominated, released, restored, rounds, promoted, added, superseded, notPromoted });
      if (!state.mergeCards) return settled();
      const cards = printedList.trades;
      const listed = new Map(cards.map((c) => [c.key, c]));
      const now = state.preferListed
        ? yield* takenTopDown(cards, listed, released, new Set([...[...merged.values()].map((m) => m.into), ...otherHolders()]), other(), list === "overall")
        : yield* takenAsBefore(cards, listed, released);
      if (now.size) {
        for (const [key, m] of now) merged.set(key, m);
        continue;
      }
      // Checkpoint 7g (answer 3(c)): once a round merges none, the versions of a trade a better one beats on the printed numbers
      // (none given back before: `restored`).
      if (state.dropDominated) {
        const drops = dominatedOf(cards, mergedTrades(merged, printed), restored);
        if (drops.length) {
          const holders = new Set([...merged.values()].map((m) => m.into));
          for (const d of drops) dominated.set(d.key, { key: d.key, by: d.by, list });
          // ⚠️ A dropped card held merged trades: the release rule at once, on the list without the dropped cards, so the trades
          // it gives back are ranked in the next round before (c) reads the list again (the final review, merge-c-by-can-leave:
          // on smallLeague 48, a one-partner search of Team 2, two trades came back only rounds later, took the given-player
          // cap's places and pushed the version a third card was dropped for off the list, so neither showed).
          if (drops.some((d) => holders.has(d.key))) yield* release(cards.filter((c) => !dominated.has(c.key)));
          continue;
        }
      }
      if ((yield* release(cards)).length) continue;
      if (state.dropDominated && giveBack(cards)) continue;
      // Checkpoint 7h (answer 3): once a round merges none, drops none and gives nothing back, the promotions.
      if (state.promoteLastOffers && (yield* promote(cards))) continue;
      return settled();
    }
  }
  // The Overall list first, then the "Helps both" list (each its own merges; a card on both lists has one ladder). Checkpoint
  // 7g (answer 3(b)): the Overall list's cards on the "Helps both" list prefer from it too, its first ranking as printed (its
  // cards played out first), and its cross-list guard reads it; the "Helps both" list's prefer from the Overall list's final
  // cards, the cards holding merged trades there no leaves.
  let firstBothPrinted: readonly TradeEvaluation[] = [];
  if (state.mergeCards && state.preferListed) {
    for (const t of firstBoth.trades) {
      yield* shownRun(t.key);
      yield progress();
    }
    firstBothPrinted = rankTrades(firstBoth.trades.map(printed), value, caps, bothOptions([])).trades;
    mark("rank");
  }
  const so = yield* settle(firstOverall, rankOverall, overallOptions, "overall", () => firstBothPrinted, () => new Set<string>(), new Set(regular.map((c) => c.key)));
  const sb = yield* settle(firstBoth, rankBoth, bothOptions, "helpsBoth", () => so.printed.trades, () => new Set([...so.merged.values()].map((m) => m.into)), new Set(all.map((c) => c.key)));
  const ranked = so.ranking;
  const overall = so.printed;
  const both = sb.ranking;
  const bothShown = sb.printed;
  // A list's trades out of its rankings (merged and, Checkpoint 7g, dropped; Checkpoint 7h, left out by a chain of promotions):
  // `few`, lowerWouldAdd and the pattern note rank without them, and with its promoted Last offers (Checkpoint 7h).
  const outOf = (s: Settled): ReadonlyMap<string, unknown> => new Map<string, unknown>([...s.merged, ...s.dominated, ...[...s.superseded].map((k): [string, unknown] => [k, true])]);
  const outOverall = outOf(so);
  const outBoth = outOf(sb);
  const regularAdded = withAdded(regular, [...so.added.values()]);
  const allAdded = withAdded(all, [...sb.added.values()]);
  const exemptOverall = new Map([...so.promoted.values()].map((p) => [p.key, p.from]));
  const exemptBoth = new Map([...sb.promoted.values()].map((p) => [p.key, p.from]));

  // A Plan B for every card (planB.ts; since Checkpoint 7e on a card with steps too, which no card has now), once per card,
  // in the printed order: the Overall list's cards first, then the "Helps both" list's that the Overall list doesn't show (a
  // card on both lists is the very same evaluation). Chosen on the ranking block's numbers, as the lists are (a Plan B
  // candidate that isn't a finalist is simulated on the ranking block once, whichever card asks first: finalByKey keeps it),
  // then held to the same rules on the numbers it would print.
  const finalOf = (core: TradeEvaluationCore): TradeEvaluationCore => {
    const known = finalByKey.get(core.key);
    if (known) return known;
    const x = exactByKey.get(core.key);
    if (!x) return core;
    const ranking = simulateTrade(I, x, "final", settings.lambda, settings.protectValue, reward);
    finalByKey.set(core.key, ranking);
    return ranking;
  };
  const rankingOf = (t: TradeEvaluation): TradeEvaluation => bare(finalByKey.get(t.key) ?? t);
  const planBCfg = state.planBCfg;
  const overallKeys = new Set(overall.trades.map((t) => t.key));
  const bothKeys = new Set(bothShown.trades.map((t) => t.key));
  const cards = [...overall.trades, ...bothShown.trades.filter((t) => !overallKeys.has(t.key))];
  // A card of the first rankings that neither list shows now (merged into a card's offers, left in a later round under the
  // usual rules, or left on its printed numbers) gets no Plan B: its box's unit, planned up front, leaves the total, so the
  // units done reach it (Checkpoint 7f; the review of the merge: the bar stood at 79 of 82 units before its last step on
  // Parker's league, Oct 15, the boxes of the cards the merge took off its lists planned and never done). The bar only moves
  // forward: the units done stay, the total shrinks.
  const finalCards = new Set(cards.map((t) => t.key));
  for (const t of firstListed) if (!finalCards.has(t.key)) planned.delete(`box:${t.key}`);
  // A box never names a trade its list shows as a card (planB.ts: the card above or below already offers it), nor ⚠️ one that
  // is a card plus more players who don't make it minAcceptGain likelier (barredFromBoxes); and ⚠️ none that a card with the
  // same partner matches or beats on both numbers (planB.ts dominatedByCard), on the ranking numbers and again on the
  // printed ones. (Until Checkpoint 7e nor a version a card's steps showed: final review of Phase 4c, finding PAGES-3.) ⚠️
  // "Its list" (Checkpoint 7c; review of the "Helps both" engine track, finding HB-2): the cards of the list the card is on,
  // and of both lists for a card on both (its one box is read in either), so an Overall card's box is what it was before the
  // second list: the page shows one list at a time. Since Checkpoint 7f (the lead's call) a list's merged trades count as its
  // cards in all of it: each is shown among a card's offers; since Checkpoint 7g so do its dropped versions (the file header,
  // "Merged cards, Checkpoint 7g": a better version of each is shown).
  const overallShown = [...overall.trades, ...mergedTrades(outOverall, printed)];
  const bothAll = [...bothShown.trades, ...mergedTrades(outBoth, printed)];
  const sharedAll = [...new Map([...overallShown, ...bothAll].map((t) => [t.key, t])).values()];
  const barOverall = barredFromBoxes(state.planBPool, overallShown);
  const barBoth = barredFromBoxes(state.planBPool, bothAll);
  const barShared = new Set([...barOverall, ...barBoth]);
  const boxRules = (key: string): { bar: ReadonlySet<string>; cards: readonly TradeEvaluation[] } => {
    const onOverall = overallKeys.has(key);
    if (onOverall && bothKeys.has(key)) return { bar: barShared, cards: sharedAll };
    return onOverall ? { bar: barOverall, cards: overallShown } : { bar: barBoth, cards: bothAll };
  };
  // The given-player cap on the Plan B boxes (planB.ts): the boxes of a list's cards in the cap's top-20 window, each
  // counting the players of mine its card doesn't give, in the list's printed order (`boxes`: that list's counts; null past
  // the window: neither checked nor counted).
  const capWindow = Math.max(0, Math.floor(config.ranking.partnerCapTop));
  const count = (boxes: Map<string, number>, ids: readonly string[]) => {
    for (const id of ids) boxes.set(id, (boxes.get(id) ?? 0) + 1);
  };
  // A card's box (planB.ts choosePlanB's choice, candidate by candidate): the candidates in planB.ts's order, at most
  // planBCfg.tries of them tried, each by planB.ts's rules on its ranking numbers against the card's (the card's ranking
  // numbers without its partner's, so planB.ts reads no "Helps both" tag: ⚠️ Checkpoint 7e, the review's SHOWN-1, the tag is
  // the card's printed one, applied here to the candidate's pool and ranking numbers); ⚠️ then (the review's SHOWN-2) by the
  // same rules on the numbers it would print against the card's printed numbers and its list's (half the card's Helps you,
  // helping both under a card tagged "Helps both", no card of its list matching or beating it), or the next candidate is
  // tried, so a box never prints numbers its rules turn down. ⚠️ Since Checkpoint 7g (the narrow rule, the lead's call D5;
  // planB.ts's header): nor a smaller ask of its card (planB.ts smallerAskOf) that its card's Last offer could take by its rules
  // on both printed numbers (offers.ts offerFeasible "smaller"), passed over as tried.
  const lastCouldTake = (card: TradeEvaluation, box: TradeEvaluationCore): boolean => state.smallerAsks && smallerAskOf(card.proposal, box.proposal) && offerFeasible(card, box, "smaller", minChance);
  function* boxOf(card: TradeEvaluation, boxes: Map<string, number> | null): Generator<TradeSearchProgress, PlanB | null, void> {
    const skip = boxes ? givenCapSkip(card.proposal, boxes, planBCfg.givenPlayerCap) : undefined;
    const rules = boxRules(card.key);
    const rankingCards = rules.cards.map(rankingOf);
    const tag = helpsBoth(card);
    const untagged: TradeEvaluationCore = { ...rankingOf(card), them: undefined };
    const candidates = planBCandidates(untagged, state.planBPool, planBCfg, rules.bar).filter((c) => !tag || helpsBoth(c.core));
    const tries = Math.max(0, Math.floor(planBCfg.tries));
    let tried = 0;
    for (const candidate of candidates) {
      if (tried >= tries) break;
      if (skip?.(candidate)) continue;
      tried++;
      const it = choosePlanB(untagged, [candidate], finalOf, planBCfg, undefined, rankingCards);
      let r = it.next();
      while (!r.done) {
        yield progress();
        r = it.next();
      }
      if (!r.value || (tag && !helpsBoth(finalByKey.get(candidate.core.key) ?? candidate.core))) continue;
      yield* shownRun(candidate.core.key);
      if (!own) {
        const ranking = finalByKey.get(candidate.core.key) ?? candidate.core;
        if (lastCouldTake(card, ranking)) continue;
        return boxWith(r.value, ranking);
      }
      const printedCore = printedOf(candidate.core);
      if (lastCouldTake(card, printedCore)) continue;
      const box = ranOut(choosePlanB(card, [{ core: printedCore, kind: candidate.kind }], (c) => c, planBCfg, undefined, rules.cards));
      if (box) return boxWith(box, printedCore);
    }
    return null;
  }
  // A box carries what its evaluation's numbers rest on (Checkpoint 7e, planner reply to Checkpoint 7d, items 2.1 and 2.2): my
  // roster moves they assume (TradeEvaluation.myMoves: "a Plan B box when it has moves") and, with either-way moves, its own
  // "before" (TradeEvaluation.before), which its odds start from.
  function boxWith(box: PlanB, core: TradeEvaluationCore): PlanB {
    return { ...box, ...(core.myMoves ? { myMoves: core.myMoves } : {}), ...(core.before ? { before: { ...core.before, prizes: { ...core.before.prizes } } } : {}) };
  }
  const boxByKey = new Map<string, PlanB | null>();
  const inBoxes = new Map<string, number>();
  for (let i = 0; i < overall.trades.length; i++) {
    const card = overall.trades[i] as TradeEvaluation;
    const box = yield* boxOf(card, i < capWindow ? inBoxes : null);
    if (box && i < capWindow) count(inBoxes, addedGiven(card.proposal, box.proposal));
    boxByKey.set(card.key, box);
    unit(`box:${card.key}`);
    yield progress();
  }
  // ⚠️ The "Helps both" list's boxes keep to the cap among themselves in its own top-20 window (the lead's call): the boxes
  // its cards on the Overall list already have count first (they're fixed), then each other card's box, in the list's order.
  const inBoxesBoth = new Map<string, number>();
  bothShown.trades.forEach((t, j) => {
    const box = boxByKey.get(t.key);
    if (j < capWindow && box) count(inBoxesBoth, addedGiven(t.proposal, box.proposal));
  });
  for (let j = 0; j < bothShown.trades.length; j++) {
    const t = bothShown.trades[j] as TradeEvaluation;
    if (boxByKey.has(t.key)) continue;
    const box = yield* boxOf(t, j < capWindow ? inBoxesBoth : null);
    if (box && j < capWindow) count(inBoxesBoth, addedGiven(t.proposal, box.proposal));
    boxByKey.set(t.key, box);
    unit(`box:${t.key}`);
    yield progress();
  }

  // Each card's words and injury tags on its printed numbers (evaluate.ts withWords: the pitch names the card's own trade),
  // with its box.
  const byKeyDone = new Map<string, TradeEvaluation>();
  for (const t of cards) {
    const { reasons: _reasons, pitch: _pitch, ...core } = t;
    void _reasons;
    void _pitch;
    const box = boxByKey.get(t.key) ?? null;
    byKeyDone.set(t.key, withWords(I, { ...core, ...(box ? { planB: box } : {}) }));
    yield progress();
  }
  mark("steps");
  if (own) mark("shown");
  // The ladders the merge read, in words on the cards as shown (Checkpoint 7f; the file header, "Merged cards"): offers.ts
  // offerLadderOfSearch hands them back as they are, the very ladders it would work out (the choices are the card's, the
  // words its printed numbers').
  const ladders = new Map<string, OfferLadder>();
  for (const [key, choice] of choices) {
    const card = byKeyDone.get(key);
    if (!card) continue;
    ladders.set(key, ladderFromChoice(ladderJobOfSearch(state, card, prefers.get(key), opens.get(key)), choice));
    yield progress();
  }
  if (choices.size) mark("offers");
  const shown = overall.trades.map((t) => byKeyDone.get(t.key) as TradeEvaluation);
  const bothCards = bothShown.trades.map((t) => byKeyDone.get(t.key) as TradeEvaluation);
  // The pattern note (pattern.ts): the same finalists without the given-player cap, never naming a must-include player, the
  // trades merged into an Overall card left out (Checkpoint 7f), and the versions dropped for a better one (Checkpoint 7g); it
  // says how many of its trades the list itself shows. The Overall list's only. Since Checkpoint 7h with the list's promoted
  // Last offers, and without the ideas a chain of promotions left out.
  const uncapped = rankTrades(without(regularAdded, outOverall), value, { ...caps, perGivenPlayerInTop20: Number.POSITIVE_INFINITY }, overallOptions(mergedTrades(outOverall, asRanked), exemptOverall));
  const pattern = patternNote({ ...patternInputsOf(I, uncapped.trades, forcedGive), shown });
  // "Few": the list shows fewer than minChanceFew trades, and a lower setting would show more (Any, the lowest, ranks the
  // same finalists with no minimum). And the "Helps both" list's lowerWouldAdd: the same finalists at Any would show more
  // trades that help both. ⚠️ "Would show more" compares the ranking at Any with the ranking at the minimum, both on the
  // ranking block's numbers (Checkpoint 7e): what the printed numbers take out of a list (the file header, "The shown pass")
  // they'd take out at Any too; ⚠️ and since Checkpoint 7f both without the trades merged at the minimum (with them as filler
  // references), though Any's own merges could differ; since Checkpoint 7g likewise without the dropped versions; since
  // Checkpoint 7h with the promoted Last offers (Any's own promotions could differ).
  const anyOf = (opts: RankOptions): RankOptions => ({ ...opts, minChance: 0 });
  const few = minChance > 0 && shown.length < config.ranking.minChanceFew && rankTrades(without(regularAdded, outOverall), value, caps, anyOf(overallOptions(mergedTrades(outOverall, asRanked), exemptOverall))).trades.length > ranked.trades.length;
  const lowerWouldAdd = minChance > 0 && rankTrades(without(allAdded, outBoth), value, caps, anyOf(bothOptions(mergedTrades(outBoth, asRanked), exemptBoth))).trades.length > both.trades.length;
  mark("rank");
  // Checkpoint 7f: a list's merged trades qualified before the caps (each was one of its cards), so they count among its
  // qualifying trades (Phase 4c counted its folded cards so), and as `merged` among those its rules left out. Checkpoint 7g:
  // so do its dropped versions (each was one of its cards), as `dominated`. So a list's qualifying count is its finalists' with
  // no merge, its first ranking's (every trade the merge took out was a card, so it qualified: the same count Checkpoint 7g's
  // sum gave), and since Checkpoint 7h (⚠️ ours) the promoted Last offers, which aren't finalists, aren't among them.
  const merging = state.mergeCards;
  const dropping = merging && state.dropDominated;
  const promoting = merging && state.promoteLastOffers;
  const bothList: HelpsBothList = {
    trades: bothCards,
    qualifying: firstBoth.qualifying,
    byChance: both.hidden.byChance,
    lowerWouldAdd,
    dropped: { ...addDropped(both.dropped, bothShown.dropped), ...(merging ? { merged: sb.merged.size } : {}), ...(dropping ? { dominated: sb.dominated.size } : {}) },
  };
  const simShown = new Set(cards.flatMap((t) => [t.key, ...(boxByKey.get(t.key) ? [(boxByKey.get(t.key) as PlanB).key] : [])]).filter((k) => state.shownByKey.has(k))).size;
  // ⚠️ Checkpoint 7h (the lead's ruling): the Opens and Thens of the cards shown (a card on both lists once) that print a higher
  // Overall than their card, counted, never promoted (their card is the smaller ask).
  const higherEarlier: HigherEarlierOffer[] = [];
  if (promoting) {
    for (const t of cards) {
      const choice = choices.get(t.key);
      const card = printedOf(t);
      if (!choice) continue;
      const earlier = [...(choice.open && !choice.open.forced ? [{ kind: "open" as const, printed: choice.open.printed }] : []), ...choice.thens.map((x) => ({ kind: "then" as const, printed: x.printed }))];
      for (const o of earlier) if (printedEg(o.printed) > printedEg(card) + EPS) higherEarlier.push({ card: t.key, offer: o.printed.key, kind: o.kind });
    }
  }
  const merged: MergedCards | null = merging
    ? {
        overall: [...so.merged.values()],
        helpsBoth: [...sb.merged.values()],
        rounds: { overall: so.rounds, helpsBoth: sb.rounds },
        ladders: choices.size,
        released: so.released.size + sb.released.size,
        ...(dropping ? { dominated: [...so.dominated.values(), ...sb.dominated.values()], restored: so.restored.size + sb.restored.size } : {}),
        ...(promoting
          ? {
              promoted: [...so.promoted.values(), ...sb.promoted.values()],
              notPromoted: [...so.notPromoted, ...sb.notPromoted],
              higherEarlier,
              superseded: so.superseded.size + sb.superseded.size,
            }
          : {}),
      }
    : null;
  // The last event is the count itself: every unit planned is done by now (above), so it reads done = total (with nothing
  // planned at all, empty lists, one unit done of one). Until Checkpoint 7f it was set to done = total whatever the count.
  yield planned.size ? progress() : { ...progress(), done: 1 };
  // Checkpoint 7g: the preferences of the cards the lists show (TradeSearchResult.offerPrefer, SearchState.prefers); Checkpoint
  // 7h: their forced Opens (TradeSearchResult.offerOpen, SearchState.opens).
  const shownPrefers = new Map([...prefers].filter(([key]) => byKeyDone.has(key)));
  const shownOpens = new Map([...opens].filter(([key]) => byKeyDone.has(key)));
  return {
    shown,
    hidden: { byBenefit: ranked.hidden.byBenefit + overall.hidden.byBenefit, byMarket: ranked.hidden.byMarket + overall.hidden.byMarket, byChance: ranked.hidden.byChance + overall.hidden.byChance },
    qualifying: firstOverall.qualifying,
    dropped: { ...addDropped(ranked.dropped, overall.dropped), ...(merging ? { merged: so.merged.size } : {}), ...(dropping ? { dominated: so.dominated.size } : {}) },
    pattern,
    few,
    both: bothList,
    simShown,
    merged,
    ladders,
    prefers: shownPrefers,
    opens: shownOpens,
  };
}

/**
 * The timings' keys (TradeSearchResult.timings): the progress stages, "steps" (the shown trades' Plan B and words; their steps too until Checkpoint 7e),
 * since Checkpoint 7e "shown" (the shown pass alone: the file header), since Checkpoint 7f "offers" (the ladders the merge
 * works out, their runs on the shown block among them, and their words: the file header, "Merged cards"), and "total".
 */
type TimingKey = TradeSearchStage | "steps" | "shown" | "offers";

/** A timer for one run: `mark(stage)` adds the time since the last mark to that stage (nothing without a clock). */
function stageTimer(clock: (() => number) | undefined): { timings: Record<string, number>; mark: (stage: TimingKey) => void; end: () => void } {
  const timings: Record<string, number> = {};
  const start = clock ? clock() : 0;
  let last = start;
  return {
    timings,
    mark: (stage) => {
      if (!clock) return;
      const t = clock();
      timings[stage] = (timings[stage] ?? 0) + (t - last);
      last = t;
    },
    end: () => {
      if (clock) timings.total = last - start;
    },
  };
}

/** A result from a state and its finished list (tradeSearch and refilterSearch alike), registered for re-filtering. */
function resultOf(state: SearchState, done: Finished, timings: Record<string, number>): TradeSearchResult {
  const { I, settings } = state;
  // My odds before any trade: the shown block's baseline, the League page's headline (Checkpoint 7e), the cards' "before".
  const base = I.sim && I.me ? I.sim.base.shown : null;
  const reward = rewardFor(I, settings);
  const result: TradeSearchResult = {
    trades: done.shown,
    myTeamId: I.me?.id ?? null,
    baseline: { pPlayoffs: base?.pPlayoffs ?? null, pTitle: base?.pTitle ?? null, expWins: base?.expWins ?? null, prizes: base ? { ...base.prizes } : null },
    // ⚠️ With what the printed numbers took out (the file header, "The shown pass"): a card whose shown B isn't above 0 among
    // the trades hidden by benefit, one §13's rules drop in the printed order among the dropped.
    hidden: { byBenefit: done.hidden.byBenefit + state.hiddenElsewhere.byBenefit, byMarket: done.hidden.byMarket + state.hiddenElsewhere.byMarket, byChance: done.hidden.byChance },
    dropped: { ...done.dropped },
    counts: { ...state.counts, simShown: done.simShown },
    timings,
    notes: [...new Set(state.notes)],
    warnings: [...I.warnings],
    filter: { minChance: settings.minChance, qualifying: done.qualifying, few: done.few },
    ...(done.pattern ? { pattern: done.pattern } : {}),
    // The one scale every card and Plan B box shown was scored on (and its B's market term priced on): the shown block's
    // (Checkpoint 7e; "How to offer it" screens its versions on the ranking block's: offers.ts), and the reward behind it.
    helpsScale: helpsScaleOf(I, settings.lambda, reward),
    reward,
    // The "Helps both" list (Checkpoint 7c; the file header).
    helpsBoth: done.both,
    // The merge (Checkpoint 7f; the file header, "Merged cards").
    ...(done.merged ? { merged: done.merged } : {}),
    // Each shown card's preference (Checkpoint 7g), for the page to send with a card's "How to offer it" (the worker's fallback).
    ...(done.prefers.size ? { offerPrefer: Object.fromEntries([...done.prefers].map(([key, keys]) => [key, [...keys].sort()])) } : {}),
    // Each shown promoted card's forced Open (Checkpoint 7h), likewise.
    ...(done.opens.size ? { offerOpen: Object.fromEntries(done.opens) } : {}),
  };
  // The state with this result's own ladders (the ones its merge read: offers.ts offerLadderOfSearch hands them back) and the
  // preferences (Checkpoint 7g) and forced Opens (Checkpoint 7h) they were worked out with.
  states.set(result, { ...state, ladders: done.ladders, prefers: done.prefers, opens: done.opens });
  return result;
}

/**
 * The search as a generator: it yields progress between units of work (so a worker can slice it and stop it) and
 * returns the result. Deterministic: the same context and options give the same result.
 */
export function* tradeSearch(ctx: TradeContext, opts: TradeSearchOptions = {}): Generator<TradeSearchProgress, TradeSearchResult, void> {
  const I = tradeInternals(ctx);
  const timer = stageTimer(opts.clock);
  const { timings, mark } = timer;
  const settings = normalizeTradeSettings(opts.settings ?? defaultTradeSettings());
  // The reward every B of the search is weighed by (Checkpoint 7c: the goal and prizes; the context's own when they match).
  const reward = rewardFor(I, settings);
  const counts = { screened: 0, exact: 0, simScreen: 0, simFinal: 0 };
  // A search stopped before ranking: no trades, nothing filtered (no `filter`), nothing dropped.
  const stopped = (notes: string[]): TradeSearchResult => {
    timer.end();
    const base = I.sim && I.me ? I.sim.base.shown : null;
    return {
      trades: [],
      myTeamId: I.me?.id ?? null,
      baseline: { pPlayoffs: base?.pPlayoffs ?? null, pTitle: base?.pTitle ?? null, expWins: base?.expWins ?? null, prizes: base ? { ...base.prizes } : null },
      hidden: { byBenefit: 0, byMarket: 0, byChance: 0 },
      dropped: { partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 },
      counts,
      timings,
      notes: [...new Set(notes)],
      warnings: [...I.warnings],
      helpsScale: helpsScaleOf(I, settings.lambda, reward),
      reward,
    };
  };

  yield { stage: "setup", done: 0, total: 1 };
  if (I.blocked || !I.me) {
    mark("setup");
    return stopped([...I.notes]);
  }
  const notes = searchNotes(I, settings);
  const pools = buildPools(I, settings, opts.partnerId ?? null);
  notes.push(...pools.notes);
  mark("setup");
  if (pools.stop) return stopped(notes);
  yield { stage: "setup", done: 1, total: 1 };

  // Screening (§12 step 2): beams and exhaustive candidates per partner.
  const maxPerSide = settings.maxPerSide;
  const perPartner: Screened[][] = [];
  for (let pi = 0; pi < pools.partners.length; pi++) {
    const partner = pools.partners[pi] as TeamState;
    const H = pools.get.get(partner.id) as { pool: string[]; forced: string[] };
    const it = partnerCandidates(I, partner, { give: pools.give, forcedGive: pools.forcedGive, get: H.pool, forcedGet: H.forced }, maxPerSide, counts, { exhaustive: opts.exhaustive !== false });
    let r = it.next();
    while (!r.done) {
      yield { stage: "screening", done: pi, total: pools.partners.length };
      r = it.next();
    }
    perPartner.push(r.value);
    yield { stage: "screening", done: pi + 1, total: pools.partners.length };
  }
  // Screening's rules (the g window, the dominance pruning: N11), the shortlist, then the lean companions (the file header).
  const ruled = perPartner.map((list) => screeningRules(list, atMostWaiverCredit(I)));
  const shortlist = shortlistFrom(ruled);
  function* companionsOf(trades: readonly Screened[], skip?: ReadonlySet<string>): Generator<TradeSearchProgress, Screened[], void> {
    if (opts.leanCompanions === false || !trades.length) return [];
    const it = leanCompanions(I, trades, perPartner, pools, undefined, skip);
    let r = it.next();
    while (!r.done) {
      yield { stage: "screening", done: pools.partners.length, total: pools.partners.length };
      r = it.next();
    }
    return r.value;
  }
  const companions = yield* companionsOf(shortlist);
  // The helps-both lane (Checkpoint 7d; the file header): screened trades on which both lineups gain that the shortlist and
  // its companions don't hold, best objective first, with their own lean companions.
  const taken = new Set([...shortlist, ...companions].map((s) => s.key));
  const lane = laneFrom(ruled, taken, opts.helpsBothLane === false ? 0 : config.search.helpsBothLane);
  const laneCompanions = yield* companionsOf(lane.trades, taken);
  const chosen = [...shortlist, ...companions, ...lane.trades, ...laneCompanions];
  mark("screening");

  // Exact evaluation (§12 step 3): the shortlist and its lean companions, then the helps-both lane and its own.
  const exact: ExactTrade[] = [];
  for (let i = 0; i < chosen.length; i++) {
    const s = chosen[i] as Screened;
    const x = evaluateExact(I, { partnerId: s.partnerId, give: players(s.give), get: players(s.get) }, maxPerSide);
    if (!("illegal" in x)) exact.push(x);
    yield { stage: "exact", done: i + 1, total: chosen.length };
  }
  counts.exact = exact.length;
  mark("exact");

  // The screening simulation (§12 step 4): B for every exact trade. First (Checkpoint 7c, "Helps them") the calibration run of
  // each partner the exact trades are with, on the ranking block (Checkpoint 7e: the screening and ranking stages are scored
  // on its scale), one at a time with a yield after each (about 12 ms each on Parker's league), so a slice never holds
  // several; evaluate.partnerCalibrationOf keeps them with the context.
  for (const id of new Set(exact.map((x) => x.partner.id))) {
    partnerCalibrationOf(I, id, "final");
    yield { stage: "simScreen", done: 0, total: exact.length };
  }
  const screened: { x: ExactTrade; core: TradeEvaluationCore }[] = [];
  for (let i = 0; i < exact.length; i++) {
    const x = exact[i] as ExactTrade;
    screened.push({ x, core: simulateTrade(I, x, "screen", settings.lambda, settings.protectValue, reward) });
    if ((i + 1) % SIM_BATCH === 0 || i + 1 === exact.length) yield { stage: "simScreen", done: i + 1, total: exact.length };
  }
  counts.simScreen = screened.length;
  mark("simScreen");

  // Finalists (the file header): relaxed-cap ranking at screening numbers, then the best others by EG. One partner
  // searched: no per-partner cap in either ranking (the file header, "One partner"); my must-include players outside the
  // given-player cap in every ranking ("Must-include players of mine").
  const value = assetValue(I);
  const onePartner = pools.partners.length === 1;
  const {
    keys: finalKeys,
    extras,
    displaced: laneDisplaced,
    hidden: hiddenElsewhere,
  } = finalistsOf(
    screened.map((s) => s.core),
    value,
    onePartner,
    pools.forcedGive,
    new Set([...lane.trades, ...laneCompanions].map((s) => s.key)),
  );
  // Only the "Helps both" list ranks the extras and (Checkpoint 7d) the finalists the lane displaced (finish).
  const helpsBothExtras = [...extras, ...laneDisplaced];
  const finalists = screened.filter((s) => finalKeys.has(s.core.key));

  // The final simulation (§12 step 5).
  const finals: TradeEvaluationCore[] = [];
  for (let i = 0; i < finalists.length; i++) {
    const s = finalists[i] as { x: ExactTrade; core: TradeEvaluationCore };
    finals.push(simulateTrade(I, s.x, "final", settings.lambda, settings.protectValue, reward));
    yield { stage: "simFinal", done: i + 1, total: finalists.length };
  }
  counts.simFinal = finals.length;
  mark("simFinal");

  // What the shown list (and any re-filter of it) reads: Plan B's pool, fixed before any card picks, of every exact trade
  // with its best numbers (a finalist's final ones; ⚠️ a "Helps both" extra's screening ones, as before the extras, so the
  // Overall list's boxes are what they were: the file header, "Helps both"; a finalist the lane displaced is one of them), and
  // the caches (an extra's final numbers among them: a box that names one reads them there, with no new run).
  const finalByKey = new Map<string, TradeEvaluationCore>(finals.map((c) => [c.key, c]));
  const extraKeys = new Set(helpsBothExtras);
  const state: SearchState = {
    I,
    settings,
    onePartner,
    forcedGive: [...pools.forcedGive],
    getPools: new Map(pools.get),
    notes,
    counts: { ...counts },
    companions: companions.map((s) => s.key),
    lane: { trades: lane.trades.map((s) => s.key), companions: laneCompanions.map((s) => s.key), qualifying: lane.qualifying, onShortlist: lane.onShortlist },
    hiddenElsewhere,
    helpsBothExtras,
    laneDisplaced,
    finals,
    planBPool: screened.map((s) => (extraKeys.has(s.core.key) ? s.core : (finalByKey.get(s.core.key) ?? s.core))),
    planBCfg: { ...planBConfig(), ...opts.planB },
    shownPass: opts.shownPass !== false,
    mergeCards: opts.mergeCards !== false,
    smallerAsks: opts.smallerAsks !== false,
    preferListed: opts.preferListed !== false,
    dropDominated: opts.dropDominated !== false,
    promoteLastOffers: opts.promoteLastOffers !== false,
    versions: new Map<string, TradeVersion>(screened.map((s) => [s.core.key, { x: s.x, screen: s.core }])),
    finalByKey,
    shownByKey: new Map<string, TradeEvaluationCore>(),
    exactByKey: new Map<string, ExactTrade>(screened.map((s) => [s.core.key, s.x])),
  };
  const done = yield* finish(state, settings, mark);
  timer.end();
  return resultOf(state, done, timings);
}

/** refilterSearch's options: the new minimum chance (normalized like TradeSettings.minChance) and an optional clock. */
export interface RefilterOptions {
  minChance: number;
  /** Milliseconds for the result's timings ("rank", "steps", "total"); without it the timings are empty. */
  clock?: () => number;
}

/**
 * The finished search behind `state` ranked again with another minimum chance (the file header, "Re-filtering"): a
 * generator like tradeSearch (progress under the "rank" stage, stoppable between shown trades), whose result equals what
 * tradeSearch gives with that minimum (the same counts, notes and baseline; the shown list, hidden counts, filter and
 * pattern note for the new minimum). `ctx` must be the context the search ran on. The new result is registered too
 * (searchStateOf), so it can be re-filtered again.
 */
export function* refilterSearch(ctx: TradeContext, state: SearchState, opts: RefilterOptions): Generator<TradeSearchProgress, TradeSearchResult, void> {
  if (tradeInternals(ctx) !== state.I) throw new Error("This search state belongs to another trade context");
  const settings = normalizeTradeSettings({ ...state.settings, minChance: opts.minChance });
  const timer = stageTimer(opts.clock);
  const done = yield* finish({ ...state, settings }, settings, timer.mark);
  timer.end();
  return resultOf({ ...state, settings }, done, timer.timings);
}

/** Runs tradeSearch to the end on the calling thread, reporting each progress step. */
export function runTradeSearch(ctx: TradeContext, opts: TradeSearchOptions = {}, onProgress?: (p: TradeSearchProgress) => void): TradeSearchResult {
  const it = tradeSearch(ctx, opts);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    onProgress?.(r.value);
  }
}

/** Runs refilterSearch to the end on the calling thread, reporting each progress step. */
export function runRefilter(ctx: TradeContext, state: SearchState, opts: RefilterOptions, onProgress?: (p: TradeSearchProgress) => void): TradeSearchResult {
  const it = refilterSearch(ctx, state, opts);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    onProgress?.(r.value);
  }
}
