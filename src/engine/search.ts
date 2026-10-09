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
 * finalist and a card on the Overall list) and the "Helps both" extras. SearchState.lane keeps their keys, their companions'
 * and how many screened trades qualified; TradeSearchOptions.helpsBothLane false (a report switch the app never sets) or the
 * config at 0 leaves them out.
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
 * final simulation (the final block, finalSims seasons the screening never saw: evaluate.ts); rankTrades on their
 * numbers, with §13's strict caps and the user's minimum chance (TradeSettings.minChance on P_complete as the card prints
 * it, applied before the caps: planner reply to Checkpoint 4b, change 10; rank.ts), gives TradeSearchResult.trades, and
 * TradeSearchResult.filter says how many finalists qualified and whether the page should suggest a lower setting (the
 * planner: "If fewer than 5 ideas qualify, say so and suggest a lower setting"): ⚠️ `few` when the list shows fewer than
 * config.ranking.minChanceFew trades and the same finalists ranked with no minimum (Any, the lowest setting) would show
 * more (review of track SR, finding 2: read on the qualifying finalists, before the caps, it missed lists the caps cut
 * short, and at Any it suggested a setting that doesn't exist; on Parker's league, the 00:51Z dump, at 50%: 4 cards from
 * 10 qualifying, 17 at Any; ours: never when a lower setting would add no card). Then each shown trade gets its
 * "Offer first / if they say no" steps (planner addendum to Checkpoint 3, §4; lead decision N4: evaluate.ts
 * tradeSteps, the versions on the screening block, reusing the exact stage's evaluations; ⚠️ Phase 4c: a lean offer-first
 * version prints at least the user's minimum chance too, evaluate.offerFirstBar, so a step can come and go with the
 * minimum while its card stays). ⚠️ Folding (final review of Phase 4c, finding PAGES-3; foldedCards): when a card's steps
 * name another card of the list (its offer first or its full version), the two show one plan and both messages would
 * propose the same first offer (on Parker's league, Oct 4 09:24Z, Kyle Monangai + Bo Nix → Jadarian Price said "Offer
 * first: Bo Nix for Jadarian Price", the card two places above it), so the lower-ranked of the two leaves the list and the
 * finalists are ranked again without it, until no two cards share a plan; the cards folded count among the variety rules'
 * drops (as filler) and among the qualifying, and the ranking behind `few` and the pattern note leaves them out too. One
 * without steps gets a Plan B ("If they say no, try:", planner reply to Checkpoint 4,
 * change 6; planB.ts: the best other exact trade with that partner by its rules, ⚠️ at least the steps' minAcceptGain
 * likelier to go through than the card and never one the list shows as a card), from a pool fixed before any card picks,
 * of every exact trade with its best numbers, a finalist's final ones; a chosen trade that wasn't a finalist is simulated
 * on the final block first, once per key, ⚠️ not counted in counts.simFinal, which stays the finalists'. A box's odds
 * (PlanB.dPO, dCH, winChance; planner reply to Checkpoint 4b, change 9) come from that final-block simulation, the card's
 * basis. ⚠️ Nor is a box a version a card's steps show (final review of Phase 4c, finding PAGES-3), nor one another card
 * with its partner matches or beats on both Helps you (as printed) and P_complete (planB.ts dominatedByCard, on the final
 * block's numbers; same review, finding R2: Garrett Wilson → Tee Higgins + Mike Evans, 25 and 32.0%, sat on a Team 4 card
 * while the list showed Garrett Wilson → Chuba Hubbard + Mike Evans, 30 and 36.1%), nor
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
 * with the app's names, the pitch naming the offer-first version; flags.tagged, explain.injuryTags from the snapshot with
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
 * screening block (ties: EG, then the key) that help both and aren't hidden by default (since Checkpoint 7d the helps-both
 * lane's among them, above, each widening the room by one: ⚠️ the lead's call, review of the lane, LANE-2, so the lane never
 * takes another trade's place), ⚠️ the plain top 20 (the lead's call: no caps in the choice); those that aren't finalists
 * already (SearchState.helpsBothExtras) get the final simulation too and count in counts.simFinal. ⚠️ Only the second list
 * ranks them (review of the "Helps both" engine track, finding HB-5): they're simulated so that list has enough candidates,
 * and in the Overall list a trade that missed the finalists would get a second chance only because it helps the partner (on
 * synthetic leagues one pushed a card out under the core cap); Plan B's pool keeps their screening numbers as before. So the
 * Overall list, its steps, boxes, words, `few` and pattern note are the same as without the second list, but for the rules
 * of a card that helps both, below. finish then ranks a second list (TradeSearchResult.helpsBoth) from every finalist, the
 * extras too: rankTrades with RankOptions.order "helps" (B, highest first, the order the caps go through them in) and keep
 * benefit.helpsBoth (on the final numbers: the re-check), the §10 guards, the minimum chance and §13's caps as the Overall
 * list's (one partner, must-include players alike; ⚠️ the filler rule judging each pair as the Overall order does: rank.ts,
 * HB-3), its own folding of cards that show one plan, and lowerWouldAdd (the same finalists at Any, its folded cards left
 * out, would show more: the page's suggestion of a lower setting). Steps, Plan B and words are made once per card for both
 * lists: a card on both is the very same evaluation (the Overall list's cards first, then the second list's others). ⚠️ A
 * card that helps both teams (its "Helps both" tag, on its final numbers, in either list) offers first only a version that
 * helps both too (evaluate.ts tradeSteps, StepOptions.helpsBoth; HB-1), and its Plan B box helps both too (planB.ts
 * planBPasses; HB-4): judged by the card's own numbers, never by the list it's on, so its steps are one per card (both
 * lists fold on them) and the tag the page shows in every sort holds for what the card suggests. ⚠️ A Plan B box names no
 * card of its card's list, nor a version that list's steps show, nor one a card of that list matches or beats (a card on
 * both lists reads both lists' cards: its one box is read in either; HB-2: the page shows one list at a time, so an
 * Overall card's box doesn't depend on the second list); ⚠️ the second list's boxes keep to the given-player cap among
 * themselves in its own top-20 window, the boxes its cards on the Overall list already have counted first. The pattern note
 * is the Overall list's only.
 *
 * Re-filtering (planner reply to Checkpoint 4b, change 10: "re-filter instantly from the finalists, without re-running the
 * search"): a finished search keeps its finalists and caches (searchStateOf: the result object → its state; null when the
 * search stopped before ranking, whose result holds for any minimum), and refilterSearch ranks them again with another
 * minimum chance, recomputing the shown lists' steps, Plan Bs, words and pattern note from them (versions on the
 * screening block and final simulations reused by key: they're deterministic, so the result equals a fresh search's with
 * that minimum, the "Helps both" list included; Plan B's pool stays the one fixed before any card picked). Only the minimum
 * changes; any other setting needs a new search.
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
 * calibration run, each exact trade, each final simulation, each shown trade's steps and Plan B: reported under the "rank"
 * stage, one unit per card of either list, since Checkpoint 7c the "Helps both" list's cards the Overall list doesn't show
 * too, with a yield before each of Plan B's simulations), so a worker can slice it and stop it. Timings: one key per
 * TradeSearchStage, "steps" (the shown trades' steps, Plan B and words) and "total"; a re-filter's: "rank", "steps" and
 * "total".
 */
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
  tradeSteps,
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
import { addedGiven, choosePlanB, givenCapSkip, planBCandidates, planBConfig, type PlanBConfig } from "./planB";
import { rankTrades, type RankConfig, type RankedTrades } from "./rank";
import { defaultTradeSettings, normalizeTradeSettings, type TradeSettings } from "./settings";
import type { HelpsBothList, PatternNote, PlanB, TradeAsset, TradeEvaluation, TradeEvaluationCore, TradeProposal, TradeSearchProgress, TradeSearchResult, TradeSearchStage, TradeSteps } from "./tradeModel";

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

  // H per partner: its top players by what they'd add to my lineup (MV_add(me, j), EV), the "Harder to get" ones apart,
  // and its must-include players.
  const target = new Set<Pos>(settings.targetPositions);
  const avoid = new Set<Pos>(settings.avoidPositions);
  const addValue = addValueOf(I.league);
  const wanted = (pos: Pos | undefined) => pos !== undefined && !excluded.has(pos) && !avoid.has(pos) && (target.size === 0 || target.has(pos));
  const getPool = Math.max(0, Math.floor(config.search.getPool));
  const getPoolTagged = Math.max(0, Math.floor(config.search.getPoolTagged));
  // A partner's IR player comes to me as a returner when I'd have an open IR slot (⚠️ judged before any trade: my IR as it
  // stands) and the slot takes his status (evaluate.ts rule 5): MV_add is then what he adds to V*(me)'s lineups, no drop.
  const myIrOpen = I.irOn && me.ir.length < Math.max(0, Math.floor(I.snapshot.settings.irSlots));
  for (const p of partners) {
    const forced = p.id === forcedTeam ? forcedGet : [];
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
    const pool = [...top, ...forced];
    out.get.set(p.id, { pool, forced });
  }
  if (partners.every((p) => (out.get.get(p.id)?.pool.length ?? 0) === 0)) {
    return stop(target.size > 0 || avoid.size > 0 ? "No player at the positions your settings allow would improve your lineup." : "No player on the other teams would improve your lineup right now.");
  }
  out.partners = partners;
  out.give = give;
  out.forcedGive = forcedGive;
  return out;
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
    // component's change is 0 where the baseline knows it and unknown where it doesn't (reward.ts prizeDeltas).
    const base = I.sim.base.final;
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
 * The finalists (the file header, "Final stages") among the trades with screening numbers: the first
 * config.search.finalists that rankTrades keeps with its per-core, per-partner and given-player caps relaxed by one, the
 * caps' window covering every finalist (rankCaps; no per-partner cap when `onePartner`: the file header's "One
 * partner"; the given-player cap never counts `forcedGive`, my must-include players: the file header's "Must-include
 * players of mine"), then, while room is left, the best others by EG = B × P_complete (ties: the key) that aren't hidden
 * by default. ⚠️ Never the minimum chance (the file header). Then (Checkpoint 7c; planner reply to Checkpoint 7b, §7; the
 * file header's "Helps both") the first config.search.helpsBothFinalists by B (ties: EG, then the key) among the trades that
 * help both teams on these numbers (benefit.helpsBoth) and aren't hidden by default, finalists or not, the room one wider
 * for each such trade `lane` holds (Checkpoint 7d, the helps-both lane's trades and their companions: ⚠️ the lead's call,
 * review of the lane, LANE-2, so the lane adds to the extras and never takes a place another trade would have had): those
 * that aren't finalists yet join them (`extras`, in that order; `keys` holds them too). Also the counts of the others the
 * guards hide (B ≤ 0 or unknown: by benefit; else the market guard).
 */
export function finalistsOf(
  cores: readonly TradeEvaluationCore[],
  value: (asset: TradeAsset) => number,
  onePartner = false,
  forcedGive: readonly string[] = [],
  lane: ReadonlySet<string> = new Set<string>(),
): { keys: Set<string>; extras: string[]; hidden: { byBenefit: number; byMarket: number } } {
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
  // "Helps both" (the plain top helpsBothFinalists, the lead's call: no caps in the choice), chosen without the minimum
  // chance. Since Checkpoint 7d each candidate from the helps-both lane widens the room by one (⚠️ the lead's call; review of
  // the lane, LANE-2): as the plain top 20, the lane's long shots took a likelier trade's place (smallLeague 13 at 10%: seven
  // lane trades under 5% as printed entered the 20, and the list went from 2 cards to 1). Every trade the 20 would hold
  // without the lane ranks at most that many places lower with it, so it keeps its final run.
  const extras: string[] = [];
  const candidates = cores.filter((c) => !hiddenAt(c) && helpsBoth(c)).sort(byBThenEg);
  const room = Math.max(0, Math.floor(config.search.helpsBothFinalists)) + candidates.filter((c) => lane.has(c.key)).length;
  const both = candidates.slice(0, room);
  for (const c of both) {
    if (keys.has(c.key)) continue;
    keys.add(c.key);
    extras.push(c.key);
  }
  const hidden = { byBenefit: 0, byMarket: 0 };
  for (const c of cores) {
    if (keys.has(c.key)) continue;
    if (c.b === null || !(c.b > 0)) hidden.byBenefit++;
    else if (c.flags.hiddenByMarket) hidden.byMarket++;
  }
  return { keys, extras, hidden };
}

/**
 * What a finished search keeps so the shown list can be ranked again with another minimum chance (refilterSearch; the file
 * header, "Re-filtering"): the context it ran on, its settings, its finalists and Plan B's pool, and the caches the shown
 * list's steps and Plan Bs read (deterministic numbers, keyed by trade: reusing them changes nothing).
 */
export interface SearchState {
  /** The context's internals the search ran on (refilterSearch checks it's given the same context). */
  readonly I: TradeInternals;
  /** The search's settings (its minChance is the one it ranked with). */
  readonly settings: TradeSettings;
  readonly onePartner: boolean;
  /** My must-include players (Pools.forcedGive): in every trade, so the given-player cap and the pattern note skip them. */
  readonly forcedGive: readonly string[];
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
   * Checkpoint 7c (the file header, "Helps both"): the keys of the trades that got the final simulation as "Helps both"
   * finalists only (finalistsOf's extras, in their order: by B on the screening block), on top of the finalists the ranking
   * picked; they're among `finals` and count in counts.simFinal, and only the "Helps both" list ranks them.
   */
  readonly helpsBothExtras: readonly string[];
  /** The finalists (with the "Helps both" extras, which only that list ranks) with their numbers on the final block. */
  readonly finals: readonly TradeEvaluationCore[];
  /**
   * Plan B's pool, fixed before any card picked: every exact trade with its best numbers (a finalist's final ones; a "Helps
   * both" extra's screening ones, as before the extras).
   */
  readonly planBPool: readonly TradeEvaluationCore[];
  readonly planBCfg: PlanBConfig;
  /** Versions on the screening block by key (the steps; new versions are added as they're evaluated). */
  readonly versions: Map<string, TradeVersion>;
  /** Numbers on the final block by key: the finalists', then each Plan B candidate's once simulated. */
  readonly finalByKey: Map<string, TradeEvaluationCore>;
  /** The exact trades by key (a Plan B candidate's simulation reads them). */
  readonly exactByKey: ReadonlyMap<string, ExactTrade>;
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
  ranked: RankedTrades;
  pattern: PatternNote | null;
  /** TradeSearchResult.filter.few (the file header, "Final stages"). */
  few: boolean;
  /** TradeSearchResult.helpsBoth (Checkpoint 7c; the file header, "Helps both"). */
  both: HelpsBothList;
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

/**
 * Folding (finish; final review of Phase 4c, finding PAGES-3: on Parker's league, Oct 4 09:24Z, the card Kyle Monangai +
 * Bo Nix → Jadarian Price said "Offer first: Bo Nix for Jadarian Price", the card shown two places above it, and both
 * cards' messages proposed that trade): the keys of the cards, in list order, that leave the list because they and another
 * card show one plan. For each card not already leaving, each version its steps show (offer first, full) that is another
 * card not already leaving: the lower-ranked of the two leaves (the card itself when the other is above it, then its other
 * versions aren't checked; else the other). Cards without steps fold nothing themselves.
 */
export function foldedCards(cards: readonly { readonly key: string; readonly steps: TradeSteps | null }[]): string[] {
  const at = new Map(cards.map((c, i) => [c.key, i]));
  const out = new Set<string>();
  cards.forEach((c, i) => {
    if (out.has(c.key) || !c.steps) return;
    for (const k of [c.steps.offerFirst.key, c.steps.ifNo.full.key]) {
      const j = at.get(k);
      if (k === c.key || j === undefined || out.has(k)) continue;
      if (j < i) {
        out.add(c.key);
        return;
      }
      out.add(k);
    }
  });
  return [...out];
}

/**
 * Rank the state's finalists with `minChance` and build the shown lists (the file header, "Final stages" from the final
 * ranking on, and "Helps both"): the Overall ranking, each shown trade's steps and the folding (foldedCards: ranked again
 * until no two cards show one plan), the ranking with no minimum behind `few` and the uncapped one behind the pattern note;
 * the "Helps both" list the same way in Helps-you order (its own folding, and whether a lower minimum would add to it); then
 * each card's Plan B, words and injury tags, once per card for both lists, reusing and growing the state's caches.
 */
function* finish(state: SearchState, settings: TradeSettings, mark: (stage: TradeSearchStage | "steps") => void): Generator<TradeSearchProgress, Finished, void> {
  const { I, onePartner, forcedGive, versions, finalByKey, exactByKey } = state;
  const maxPerSide = settings.maxPerSide;
  const value = assetValue(I);
  const minChance = settings.minChance;

  // Rank and diversify (§13), on the numbers (the words never change the order), the minimum chance before the caps; my
  // must-include players outside the given-player cap.
  yield { stage: "rank", done: 0, total: 1 };
  const all = state.finals.map(bare);
  // ⚠️ The Overall list (and the rankings behind `few` and the pattern note) ranks the finalists the ranking picked, never the
  // "Helps both" extras (the file header, "Helps both"): they were simulated so that list has enough candidates.
  const extras = new Set(state.helpsBothExtras);
  const regular = extras.size ? all.filter((c) => !extras.has(c.key)) : all;
  const caps = rankCaps({ relaxed: false, onePartner });
  const without = (list: TradeEvaluation[], folded: ReadonlySet<string>) => (folded.size ? list.filter((c) => !folded.has(c.key)) : list);
  const rankOf = (folded: ReadonlySet<string>) => rankTrades(without(regular, folded), value, caps, { minChance, givenCapExempt: forcedGive });
  // The "Helps both" list's ranking (Checkpoint 7c; the file header, "Helps both"): every finalist, the extras too, with the
  // same guards, minimum and caps, only the trades that help both teams on their final numbers (benefit.helpsBoth), in
  // Helps-you order.
  const keepBoth = (t: TradeEvaluation) => helpsBoth(t);
  const rankBothOf = (folded: ReadonlySet<string>) => rankTrades(without(all, folded), value, caps, { minChance, givenCapExempt: forcedGive, order: "helps", keep: keepBoth });
  let ranked = rankOf(new Set());
  mark("rank");

  // The shown trades' steps ("Offer first / if they say no", N4), once per trade (deterministic, so a trade ranked again,
  // or shown on both lists, keeps them). ⚠️ Folding (final review of Phase 4c, finding PAGES-3; the file header, "Final
  // stages"): when a card's steps name another card of the list (its offer-first version or its full one), the two show one
  // plan, and both messages would propose the same first offer: the lower-ranked of the two leaves the list, and the list is
  // ranked again without it, so another idea can take its place (a card that leaves through another card's steps, or whose
  // own steps name a card above it, is never one whose steps fold a third). Repeated until no two cards share a plan. Each
  // list folds its own cards (the "Helps both" list in its own order). ⚠️ A card that helps both teams (its "Helps both"
  // tag, on its final numbers) offers first only a version that helps both too (evaluate.ts tradeSteps, StepOptions.helpsBoth;
  // the file header, "Helps both"): judged by the card's own numbers, so its steps are the same on both lists.
  const stepsByKey = new Map<string, TradeSteps | null>();
  function* settle(rank: (folded: ReadonlySet<string>) => RankedTrades, first: RankedTrades): Generator<TradeSearchProgress, { ranked: RankedTrades; folded: Set<string> }, void> {
    const folded = new Set<string>();
    let r = first;
    for (;;) {
      const total = Math.max(1, r.trades.length);
      for (let i = 0; i < r.trades.length; i++) {
        const t = r.trades[i] as TradeEvaluation;
        if (!stepsByKey.has(t.key)) {
          const version = versions.get(t.key);
          stepsByKey.set(t.key, version ? tradeSteps(I, version, { settings, maxPerSide, versions, helpsBoth: helpsBoth(t) }) : null);
          yield { stage: "rank", done: i, total };
        }
      }
      const fold = foldedCards(r.trades.map((t) => ({ key: t.key, steps: stepsByKey.get(t.key) ?? null })));
      if (!fold.length) break;
      for (const k of fold) folded.add(k);
      r = rank(folded);
    }
    return { ranked: r, folded };
  }
  const main = yield* settle(rankOf, ranked);
  ranked = main.ranked;
  const folded = main.folded;
  // "Few": the list shows fewer than minChanceFew trades, and a lower setting would show more (Any, the lowest, ranks the
  // same finalists with no minimum, the folded cards left out as here).
  const kept = without(regular, folded);
  const few = minChance > 0 && ranked.trades.length < config.ranking.minChanceFew && rankTrades(kept, value, caps, { givenCapExempt: forcedGive }).trades.length > ranked.trades.length;
  // The pattern note (pattern.ts): the same finalists without the given-player cap (the folded cards left out), never
  // naming a must-include player; it says how many of them the list itself shows. The Overall list's only.
  const uncapped = rankTrades(kept, value, { ...caps, perGivenPlayerInTop20: Number.POSITIVE_INFINITY }, { minChance, givenCapExempt: forcedGive });
  const pattern = patternNote({ ...patternInputsOf(I, uncapped.trades, forcedGive), shown: ranked.trades });
  // The folded cards count among the trades the variety rules left out (as filler: each is a card's other version), and
  // among those that qualified.
  if (folded.size) ranked = { ...ranked, qualifying: ranked.qualifying + folded.size, dropped: { ...ranked.dropped, filler: ranked.dropped.filler + folded.size } };

  // The "Helps both" list: its steps and folding as above, then whether the same finalists at Any (the lowest setting, its
  // folded cards left out) would show more trades that help both (the page's suggestion of a lower setting).
  const second = yield* settle(rankBothOf, rankBothOf(new Set()));
  let both = second.ranked;
  const lowerWouldAdd = minChance > 0 && rankTrades(without(all, second.folded), value, caps, { givenCapExempt: forcedGive, order: "helps", keep: keepBoth }).trades.length > both.trades.length;
  if (second.folded.size) both = { ...both, qualifying: both.qualifying + second.folded.size, dropped: { ...both.dropped, filler: both.dropped.filler + second.folded.size } };

  // A Plan B for each card without steps (planB.ts), their words (the pitch names the offer-first version) and their
  // injury tags, once per card: the Overall list's cards first, then the "Helps both" list's that the Overall list doesn't
  // show (a card on both lists is the very same evaluation). A Plan B candidate that isn't a finalist is simulated on the
  // final block once, whichever card asks first (finalByKey keeps it).
  const finalOf = (core: TradeEvaluationCore): TradeEvaluationCore => {
    const known = finalByKey.get(core.key);
    if (known) return known;
    const x = exactByKey.get(core.key);
    if (!x) return core;
    const sim = simulateTrade(I, x, "final", settings.lambda, settings.protectValue, rewardFor(I, settings));
    finalByKey.set(core.key, sim);
    return sim;
  };
  const planBCfg = state.planBCfg;
  const overallKeys = new Set(ranked.trades.map((t) => t.key));
  const bothKeys = new Set(both.trades.map((t) => t.key));
  const cards = [...ranked.trades, ...both.trades.filter((t) => !overallKeys.has(t.key))];
  // A box never names a trade its list shows as a card (planB.ts: the card above or below already offers it), nor ⚠️ one that
  // is a card plus more players who don't make it minAcceptGain likelier (barredFromBoxes), nor ⚠️ a version a card's steps
  // show (its offer first or its full trade: final review of Phase 4c, finding PAGES-3); and once its numbers are final, ⚠️
  // none that a card with the same partner matches or beats on both numbers (planB.ts dominatedByCard). ⚠️ "Its list"
  // (Checkpoint 7c; review of the "Helps both" engine track, finding HB-2): the cards of the list the card is on, and of both
  // lists for a card on both (its one box is read in either), so an Overall card's box is what it was before the second list:
  // the page shows one list at a time.
  const barOf = (list: readonly TradeEvaluation[]): Set<string> => {
    const keys = barredFromBoxes(state.planBPool, list);
    for (const t of list) {
      const s = stepsByKey.get(t.key);
      if (s) for (const k of [s.offerFirst.key, s.ifNo.full.key]) keys.add(k);
    }
    return keys;
  };
  const barOverall = barOf(ranked.trades);
  const barBoth = barOf(both.trades);
  const barShared = new Set([...barOverall, ...barBoth]);
  const boxRules = (key: string): { bar: ReadonlySet<string>; cards: readonly TradeEvaluation[] } => {
    const onOverall = overallKeys.has(key);
    if (onOverall && bothKeys.has(key)) return { bar: barShared, cards };
    return onOverall ? { bar: barOverall, cards: ranked.trades } : { bar: barBoth, cards: both.trades };
  };
  // The given-player cap on the Plan B boxes (planB.ts): the boxes of a list's cards in the cap's top-20 window, each
  // counting the players of mine its card doesn't give, in the list's order (`boxes`: that list's counts; null past the
  // window: neither checked nor counted).
  const capWindow = Math.max(0, Math.floor(config.ranking.partnerCapTop));
  const count = (boxes: Map<string, number>, ids: readonly string[]) => {
    for (const id of ids) boxes.set(id, (boxes.get(id) ?? 0) + 1);
  };
  const total = Math.max(1, cards.length);
  function* finishCard(card: TradeEvaluation, boxes: Map<string, number> | null, at: number): Generator<TradeSearchProgress, TradeEvaluation, void> {
    const { reasons: _reasons, pitch: _pitch, ...core } = card;
    void _reasons;
    void _pitch;
    const steps = stepsByKey.get(core.key) ?? null;
    let planB: PlanB | null = null;
    if (!steps) {
      const skip = boxes ? givenCapSkip(core.proposal, boxes, planBCfg.givenPlayerCap) : undefined;
      // ⚠️ A card that helps both teams gets a box that helps both too (planB.ts planBPasses; the file header, "Helps both").
      const rules = boxRules(core.key);
      const it = choosePlanB(core, planBCandidates(core, state.planBPool, planBCfg, rules.bar), finalOf, planBCfg, skip, rules.cards);
      let r = it.next();
      while (!r.done) {
        yield { stage: "rank", done: at, total };
        r = it.next();
      }
      planB = r.value;
      if (planB && boxes) count(boxes, addedGiven(core.proposal, planB.proposal));
    }
    return withWords(I, { ...core, ...(steps ? { steps } : {}), ...(planB ? { planB } : {}) });
  }
  const byKeyDone = new Map<string, TradeEvaluation>();
  const inBoxes = new Map<string, number>();
  const shown: TradeEvaluation[] = [];
  for (let i = 0; i < ranked.trades.length; i++) {
    const card = yield* finishCard(ranked.trades[i] as TradeEvaluation, i < capWindow ? inBoxes : null, i);
    byKeyDone.set(card.key, card);
    shown.push(card);
    yield { stage: "rank", done: i + 1, total };
  }
  // ⚠️ The "Helps both" list's boxes keep to the cap among themselves in its own top-20 window (the lead's call): the boxes
  // its cards on the Overall list already have count first (they're fixed), then each other card's box, in the list's order.
  const inBoxesBoth = new Map<string, number>();
  both.trades.forEach((t, j) => {
    const card = byKeyDone.get(t.key);
    if (j < capWindow && card?.planB) count(inBoxesBoth, addedGiven(card.proposal, card.planB.proposal));
  });
  let at = ranked.trades.length;
  for (let j = 0; j < both.trades.length; j++) {
    const t = both.trades[j] as TradeEvaluation;
    if (byKeyDone.has(t.key)) continue;
    const card = yield* finishCard(t, j < capWindow ? inBoxesBoth : null, at);
    byKeyDone.set(card.key, card);
    at++;
    yield { stage: "rank", done: at, total };
  }
  if (!cards.length) yield { stage: "rank", done: 1, total: 1 };
  mark("steps");
  const bothList: HelpsBothList = {
    trades: both.trades.map((t) => byKeyDone.get(t.key) as TradeEvaluation),
    qualifying: both.qualifying,
    byChance: both.hidden.byChance,
    lowerWouldAdd,
    dropped: { ...both.dropped },
  };
  return { shown, ranked, pattern, few, both: bothList };
}

/** A timer for one run: `mark(stage)` adds the time since the last mark to that stage (nothing without a clock). */
function stageTimer(clock: (() => number) | undefined): { timings: Record<string, number>; mark: (stage: TradeSearchStage | "steps") => void; end: () => void } {
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
  const base = I.sim && I.me ? I.sim.base.final : null;
  const { ranked } = done;
  const reward = rewardFor(I, settings);
  const result: TradeSearchResult = {
    trades: done.shown,
    myTeamId: I.me?.id ?? null,
    baseline: { pPlayoffs: base?.pPlayoffs ?? null, pTitle: base?.pTitle ?? null, expWins: base?.expWins ?? null, prizes: base ? { ...base.prizes } : null },
    hidden: { byBenefit: ranked.hidden.byBenefit + state.hiddenElsewhere.byBenefit, byMarket: ranked.hidden.byMarket + state.hiddenElsewhere.byMarket, byChance: ranked.hidden.byChance },
    dropped: { ...ranked.dropped },
    counts: { ...state.counts },
    timings,
    notes: [...new Set(state.notes)],
    warnings: [...I.warnings],
    filter: { minChance: settings.minChance, qualifying: ranked.qualifying, few: done.few },
    ...(done.pattern ? { pattern: done.pattern } : {}),
    // The one scale every card, step and Plan B was scored on (and its B's market term priced on), and the reward behind it.
    helpsScale: helpsScaleOf(I, settings.lambda, reward),
    reward,
    // The "Helps both" list (Checkpoint 7c; the file header).
    helpsBoth: done.both,
  };
  states.set(result, state);
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
    const base = I.sim && I.me ? I.sim.base.final : null;
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
  // each partner the exact trades are with, one at a time with a yield after each (about 12 ms each on Parker's league), so a
  // slice never holds several; evaluate.partnerCalibrationOf keeps them with the context.
  for (const id of new Set(exact.map((x) => x.partner.id))) {
    partnerCalibrationOf(I, id);
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
    extras: helpsBothExtras,
    hidden: hiddenElsewhere,
  } = finalistsOf(
    screened.map((s) => s.core),
    value,
    onePartner,
    pools.forcedGive,
    new Set([...lane.trades, ...laneCompanions].map((s) => s.key)),
  );
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
  // Overall list's boxes are what they were: the file header, "Helps both"), and the caches (an extra's final numbers among
  // them: a box that names one reads them there, with no new run).
  const finalByKey = new Map<string, TradeEvaluationCore>(finals.map((c) => [c.key, c]));
  const extraKeys = new Set(helpsBothExtras);
  const state: SearchState = {
    I,
    settings,
    onePartner,
    forcedGive: [...pools.forcedGive],
    notes,
    counts: { ...counts },
    companions: companions.map((s) => s.key),
    lane: { trades: lane.trades.map((s) => s.key), companions: laneCompanions.map((s) => s.key), qualifying: lane.qualifying, onShortlist: lane.onShortlist },
    hiddenElsewhere,
    helpsBothExtras,
    finals,
    planBPool: screened.map((s) => (extraKeys.has(s.core.key) ? s.core : (finalByKey.get(s.core.key) ?? s.core))),
    planBCfg: { ...planBConfig(), ...opts.planB },
    versions: new Map<string, TradeVersion>(screened.map((s) => [s.core.key, { x: s.x, screen: s.core }])),
    finalByKey,
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
