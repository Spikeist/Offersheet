/**
 * Trade evaluation (CLAUDE.md §7 roster legality, §10, §11, §12 steps 1–5; Phase 4 wave 2 lead decisions M1–M5,
 * M11, M15): the evaluation context built once per search or Analyzer session, roster legality, screening, exact
 * evaluation and the season simulations behind B. Pure and deterministic: no I/O, no clock (`now` and an optional
 * clock for timings are passed in), the only randomness is the scenarios' and the season simulation's seeded
 * common random numbers; every tunable number comes from config.
 *
 * The context (buildTradeContext; M1). Built once, reused by every search and Analyzer call on the same league:
 * - The League model's steps 1–6 and 8a (league.ts buildLeagueModelWithContext, no simulation of its own): projections,
 *   scenarios, values, streaming, every team's lineups, its free-agent-optimized roster V*(T) (from scratch) and
 *   lineup costs, trade chips, surplus scores and MV_add's bases, and every team's V*(T) priced finally (step 8a:
 *   LeagueModelBuild.pickups, the lineups behind TeamModel.scoreWithPickups; the baseline below). It reads only the
 *   settings the League model reads (streamPositions, and the goal and prizes its automatic playoff weight ω reads: league.ts
 *   step 5c, planner reply to Checkpoint 7a, §6.1; its reward, LeagueContext.reward); the search and the Analyzer take the
 *   rest per call. The model is built without a simulation of its own, but with ω measured on this context's final block
 *   (BuildLeagueModelOptions.playoffWeightSims and the seed), the seasons the League page's model measures it on, so the two
 *   have one ω and so one baseline.
 * - The baseline (L6): every team at V*(T), whose moves are judged in scenario lineups when scenarios run, the lineups
 *   B is measured in (optimizer.ts; review of track E, item 1: an EV-judged V* skipped depth pickups, so a trade
 *   bringing the same depth got credit for them). Each team's weekly score for the simulator comes from V*(T)'s lineups the
 *   way TeamModel.score is built (scenario mean and sqrt(within-lineup variance + the scenarios' spread²); EV lineups
 *   and sqrt(Σ σ²) without scenarios), streaming rows and IR returners included, finally priced (sideEval: the roster
 *   spot a returner needs from his week; "IR players" below). ⚠️ The week in progress (LeagueModel.inProgressWeek):
 *   its score stays each team's TeamModel.score week-0 value (rosters as they stand, as before kickoff) before and
 *   after every trade (⚠️ the model plays a week under way with today's rosters). A trade made before kickoff counts
 *   the current week in full (⚠️ the platform's review period isn't modeled). So the baseline moves at the week's first
 *   kickoff (league.ts "Game days"): before it a team's pickups play the week, after it they don't, and V*(T) is judged
 *   without the week (ω = 0). On Parker's league (Oct 4 data) that moved a team's P(playoffs) by up to 1.3 points and
 *   mine by 0.2; B compares both sides under the same rule either way.
 * - One baseline everywhere (Phase 4c; planner reply to Checkpoint 4b, change 9): that baseline is the League model's
 *   own. league.ts prices every team's V*(T) the same way (finalRunLineups and pickupScore, the functions sideEval runs:
 *   step 8a) for TeamModel.scoreWithPickups, and LeagueModel.odds simulates those scores on the first finalSims seasons of
 *   the simulation seed's matrix. The context reuses those final lineups for its baseline (LeagueModelBuild.pickups) and
 *   builds its setup from the same scores (season.pickupSeasonModel), so the baseline odds on the final block below are
 *   LeagueModel.odds exactly (every team's odds, weekly win chances, notes): the League page's headline and every card's
 *   "before" are one number (evaluate.baseline.test.ts checks it).
 * - One SimSetup (season.buildSimSetup on the baseline scores) and one common-random-numbers matrix (sim.simNormals of
 *   the simulation seed) of finalSims + screeningSims seasons in two blocks (review of track E, item 2): the final
 *   simulation (the search's finalists, the Analyzer, and the baseline odds every profile reads) reads the first
 *   finalSims seasons, the League model's own (Phase 4c: so the baseline is LeagueModel.odds; before, the screening block
 *   came first), the screening simulation the next screeningSims, seasons the final simulation never reads. Choosing
 *   trades on the screening's seasons and showing B from the same seasons would show the luck that chose them (the shown
 *   B was above other seeds' for 21 of 25 trades). Within each block every run shares the draws (common random numbers).
 *   The baseline odds of each block go through the same code as every trade's "after" run, so a trade that changes
 *   neither side's V* moves nothing. With my team, one more run on the final block: the "Helps you" calibration (Phase 7a,
 *   planner reply to Checkpoint 4c, A2; league.ts helpsCalibrationOf, the League model's step 8c on the same seasons and
 *   setup, so SimState.calibration is LeagueModel.helpsCalibration exactly): my score + 3 points a week in every week a
 *   trade can change, whose B_win under a call's reward is B₃, the scale of Helps you and Overall and the price of B's market
 *   term (helpsScaleOf; in dynasty and keeper leagues with long-term values B_ref(λ), mixed with +10% long-term value).
 *   Checkpoint 7c (planner reply to Checkpoint 7b, §6): the setup lists the weekly high scores when the context's reward
 *   pays them (reward.ts paysWeekly; SimState.highScores), as the League model's runs do, so its baseline, calibration and
 *   every trade's prize components are the League page's; a call whose reward pays them on a context that didn't simulate
 *   them is refused (rewardOn: build the context with that reward's settings; the app's never differ, since the engine
 *   worker keys its contexts by the goal and prizes). Checkpoint 7c (planner reply to Checkpoint 7b, §7, "Helps them"):
 *   each partner's own calibration run on the same block and baseline (partnerCalibrationOf, the same function with its
 *   id), made the first time a trade with it is simulated and kept with the context (SimState.partners).
 * - Once: partner profiles (acceptance.partnerProfile, P(playoffs) from the finalSims baseline), hot players, the
 *   deadline urgency, perception values and the waiver credit W (the League model's), long-term values and MyDynTotal
 *   when they loaded (benefit.futureValuesLoaded; since Checkpoint 7c every team's long-term total too, for "Helps
 *   them"'s B_future,P: TradeInternals.future.totals), the league median of every slot instance over the hole weeks (the
 *   holeWeeks weeks from the first week team numbers count; EV lineups for screening, the exact mode's for exact
 *   evaluation), every team's rank at every instance (TradeDetail.partnerSlots), my risky weeks (TradeDetail.riskyWeeks:
 *   riskyWeeksOf, the League page's rule, src/lib/leagueView.ts scheduleView; ⚠️ Phase 4c lead decision: a likely
 *   starter at a streamed K or D/ST, config.leaguePage.streamCoversBye, is never counted on bye, since the streaming
 *   replacement covers his slot, on both),
 *   and the star premium of every rostered player for his own team (planner addendum to Checkpoint 3, §1; lead decision
 *   N1: premium.leaguePremiums, the League model's own function, with each team's P(playoffs) from this finalSims
 *   baseline for the dynasty rebuilding rule), which also tags "Harder to get" players (§2; N2: the search's get pool
 *   reads it).
 * - Notes (TradeContext.notes): no team picked (nothing can be evaluated), no weeks left, my team certainly
 *   eliminated in a redraft league with no prize left that a trade can change (reward.ts prizeStillMovable: Checkpoint 7c,
 *   a paid weekly high score with a prize period left, or a paid points title or place the final standings decide with a
 *   regular-season week left, or a paid 3rd place still open after a lost semifinal with a playoff week left, keeps the
 *   season going; the week under way never counts, every trade holding it as rosters stand: SeasonOdds.regularLeft and
 *   playoffLeft), the trade deadline passed, no odds (the schedule didn't load or the simulator refused it: B can't be
 *   computed). Any of them stops the search (no trades); the Analyzer still evaluates, with the note (without B when there
 *   are no odds), except without a team.
 *
 * One free agent, one team (CLAUDE.md §7; planner reply to Checkpoint 4, change 3; league.ts step 5). The League model
 * builds every V*(T) in the allocation order, each team claiming every free agent its run adds (TeamState.claimed), so
 * the baseline never gives one free agent to two teams. A trade re-optimizes only its two teams (tradeSides); every other
 * team keeps its baseline pickups: X = the free agents every other team claimed (othersPool). The earlier of me and the
 * partner in the allocation order goes first: its legality adds (rules 3–4 below) and its V*(after) draw from the pool
 * minus X; then the later one's, from the pool minus X minus every free agent the first one added here (legality's adds
 * and every add of its V*(after) run). So my V*(after) may take a free agent the partner picked up in the baseline when
 * I'm earlier in the order, and never one a third team picked up. A baseline pickup the first one gives up after the
 * trade: ⚠️ ours (Phase 4b track C and its review; the design let the later team take him whatever the order): the later
 * one may take him only when no team sits between the two in the order. Every team ahead of the first one passed on him
 * in the baseline (he was in its pool) and keeps its baseline, so the later one is next in line; a team between them
 * never had a chance at him and would claim him first, but it keeps its baseline allocation (the planner's rule), so then
 * nobody adds him. On Parker's league (Oct 3, live waiver order) the design's rule gave me Jordan Love in two of the top
 * 10 trades with Team 5, first in that order (I was last), while Team 10, between us, picks him up when each team is
 * optimized on its own. A trade that changes neither roster still reproduces the baseline (the later team's baseline run excluded the
 * earlier one's pickups too, and greedy determinism, optimizer.ts "The pool", makes each side's run against its pool the
 * moves its baseline run made), exactly but for gains within 1e-9 of each other (⚠️ optimizer.ts, "The pool").
 * Screening's legality adds skip each side's baseline exclusion excl(T) (TeamState.pool), ⚠️ whatever the trade's order:
 * screening is a filter. TradeContextOptions.faAllocation "independent" (Checkpoint 4's rule, for the Checkpoint 4b report
 * only) runs every team, and both sides of every trade, against the whole pool, mine first.
 * Inactive teams (planner reply to Checkpoint 4c, A4; league.ts step 5; TeamState.inactive: no transaction in the last
 * config.allocation.inactiveWeeks weeks, never me): no pickups in the baseline, and after a trade an inactive partner makes
 * no V*(after) move and legality's rule 4 leaves the spots the trade opened open (⚠️ ours, the lead's design; rules 1–3 still
 * apply: roster minimums are a platform rule). ⚠️ An inactive team between me and the partner in the order doesn't count as
 * "a team between them" above (it would claim nobody): betweenActive.
 * W is the best free agent the allocation leaves unclaimed (league.ts step 4; A3), the perception one and, in dynasty and
 * keeper leagues with long-term values, the long-term one (TradeInternals.future.credit) alike.
 *
 * Roster legality (§7; M2). Assets are players in this phase (M11: ⚠️ draft picks are deferred to Phase 5).
 * - Illegal, in plain English: a pick; no asset at all; a player twice; more than the per-side maximum (the
 *   Analyzer's analyzerMaxPerSide, the search's maxPerSide); an asset not on that side's active roster or IR (IR players
 *   are tradable since Phase 4b; taxi players still aren't; under irReturners false, Checkpoint 4's rule, only
 *   active-roster players are). One empty side is legal (a 1-for-0 the Analyzer can build).
 * - 5 (first: IR players; planner reply to Checkpoint 4, change 5; returners.irAfterTrade). An IR player given leaves the
 *   giver's IR (its IR slot opens; no active spot does). An IR player received goes into an open IR slot of the receiver
 *   (irSlots minus the IR players it keeps) when his status is one the slot takes (returners.irEligibleStatuses:
 *   LeagueSettings.irEligible, else config.lineups.irEligibleDefault, IR and PUP), as a returner (no active spot, never
 *   dropped); otherwise he joins the active roster like any received player. Several: the most ROS points first into the
 *   open slots (ties: the smaller id). ⚠️ A player received from the other team's active roster joins the active roster
 *   whatever his status. The side's IR after the trade is LegalSide.ir, and its spec (its streaming rows with that IR's
 *   returners: league.ts withReturners) is LegalSide.spec, which every later solve of the side uses (its V*(after), the
 *   final evaluation). Every lineup legality solves holds those returners (no displacement: legality isn't final).
 * - Each side's active roster after the trade = its roster − the active-roster players it gives + the players it receives
 *   who don't go to its IR. Then, in order:
 *   1. A position over its positionLimits → drop that position's lowest keep value player not just received (none →
 *      illegal). ⚠️ A team already over a limit before the trade is held only to its count before the trade.
 *   2. Over maxRosterSize → drop the lowest keep value players, never one just received, never one the starting
 *      lineup needs (optimizer.fillCount: the slots fillable before stay fillable, streaming rows counting for their
 *      position, returners not), never the last one the side rosters at a position it streams (⚠️ ours, final review of
 *      Phase 4b, the displacement's rule in returners.ts: streaming a K or D/ST takes a roster spot for the week's pickup,
 *      and the streaming row takes none, so the row covering the slot doesn't make the only rostered one free to drop),
 *      one at a time, recomputed. ⚠️ A roster already over the size before the trade isn't trimmed by it.
 *   3. A position under rosterMinimums → add the best free agent there (EV ROS gain, ties as in 4; none → illegal), from
 *      the side's pool ("One free agent, one team" above), as in 4.
 *      ⚠️ Only up to the count the team had before the trade (a shortfall the trade didn't cause isn't its to fix).
 *      ⚠️ The add takes a roster spot like any other: when it leaves the roster too big, rule 2 makes room again
 *      (never dropping the player added, nor one a position's minimum needs).
 *   4. Each roster spot the trade opened (fewer active players than before it), one at a time (Phase 7c, planner reply
 *      to Checkpoint 7b, section 5: "fill each open spot with the best available free agent at a position where the team
 *      gave more players than it received … Several open spots: fill them one at a time, each from the positions still
 *      short. Fallback: only if no free agent is available at those positions, use the best at any position."; both
 *      sides) → add the best free agent at a position still short: one where the side's active roster holds fewer
 *      players than before the trade (rules 1–3's counts by primary position, players without a known position left out;
 *      a received IR player rule 5 put in an IR slot isn't received there, a given IR player isn't given, and ⚠️ nor is a
 *      player the side's own baseline cuts anyway, below), the largest
 *      ROS gain (ω-weighted lineup points) first, in scenario lineups in exact evaluation with scenarios (pickAddScenario:
 *      the lineups B is measured in, starter limits included; "best means the largest gain in the scenario lineups"), in
 *      EV lineups in screening and without scenarios; ties, including no gain at all: higher ROS points, then the smaller
 *      id. With no free agent allowed at any position still short, the same pick at any position (the fallback; also when
 *      no position is short, as when a given player's position is unknown). Every candidate within position limits, never
 *      at a position the team streams (its streaming row values that slot: ⚠️ a streamed position left short goes to the
 *      fallback, the lead's call, rather than leaving the spot open for the week's streaming pickup), only from the side's
 *      pool (legalSide's `pool`: "One free agent, one team" above; ⚠️ the side's own baseline pickups stay candidates, so
 *      a partner earlier in the allocation order can take mine as its fill, which my V*(after) then can't re-make: the card
 *      says so, OpenSpot.yours, rosterChangeOf). At a
 *      config.streaming.optimizerExcluded position (K, D/ST) only to refill a starting slot the trade emptied: the roster's
 *      structural fill (optimizer.fillCount, streaming rows counting) is below `before`'s, and he raises it. So a team that
 *      doesn't stream kickers and trades its only one still gets one in the spot (review of track E, item 5), but ⚠️ an
 *      upgrade of a kicker or D/ST it keeps is never the trade's (Phase 4b review of track C: V* never picks one up, so a
 *      2-for-1 whose open spot took a better free-agent kicker credited the trade with a pickup the team could make anyway;
 *      on Parker's league, Oct 3, 7 of the 19 shown trades raised the partner's lineup by about 1.1 a week that way).
 *      ⚠️ Never for an inactive side (planner reply to Checkpoint 4c, A4: it makes no pickups, so the spot stays open; the
 *      lead's design). ⚠️ Ours (review of Phase 7c's fill, finding pickups-1): a given player whom the side's own baseline
 *      cuts anyway (V*(T) drops him for a pickup) opens no spot of the trade's and leaves no position short. His spot is
 *      the baseline pickup's, which V*(after) makes again (and freeAgentMovesOf leaves off the card); screening, from V*(T),
 *      never has him on the roster, so the two agree. Counted as given, he left his position short, and the fill there,
 *      kept by V*(after), made it cut a real player for that pickup: on the trade report's synthetic league a finalist that
 *      gave such a QB with an RB read Helps you 46 instead of 59, and a 1-for-0 dump of him cost 1.25 points of title odds
 *      instead of 0.05 (the partner getting him); on Parker's league, Oct 4 09:24Z, one side among a search's exact trades
 *      (a partner giving a player its baseline cuts), none of mine. Why the position given up (the planner): "Any big
 *      upgrade at another position is already in the baseline's pickups. So the open spot only adds a small extra
 *      there", and a fill elsewhere made the card "read as if
 *      the trade depends on an unrelated pickup". Until Phase 7c the spot took the free agent who most improved the EV
 *      lineup at any position (TradeContextOptions.openSpotFill "bestAny", kept for the trade report's before-and-after):
 *      on Parker's league (Oct 4 09:24Z) every one of my RB-short spots took Malik Washington, a WR and my own League-page
 *      pickup. LegalSide.change.openSpots names each fill with the position it fills (null for the fallback).
 *   Keep value (§7): what losing him costs the roster's lineup with nobody refilling his spot (teamValue.
 *   evRemovalCosts / scenarioRemovalCosts) in the evaluation's lineup mode (EV in screening, scenario lineups in exact
 *   evaluation); in dynasty and keeper leagues with long-term values, ⚠️ (L7's reading of "plus normalized market
 *   value") removal cost ÷ the roster's largest removal cost + v_dyn ÷ the top dynasty value. Only players with a model
 *   are dropped (one without projections isn't known to be worthless); ties: teamValue.lowestKeepValue's (the lower
 *   perception value, then the smaller id). ⚠️ Where the keep value is the lineup cost alone (redraft leagues, and dynasty
 *   or keeper leagues without long-term values), near-ties count as ties (final review of Phase 4c, finding R6, ours:
 *   dropOrder): among the candidates within config.lineups.dropNearTieWeekly points a week (× the weeks' weights) of the
 *   lowest keep value, the lowest perception value floored at W goes (then the lower keep value), so a 2-for-1 cuts a
 *   near-free bench player worth at most W rather than a tradable one (on Parker's league, Oct 4 09:24Z: Marvin Harrison
 *   Jr., worth 610, rather than Kyle Monangai, [value], 0.02 points a week apart), and between players worth at most W the
 *   lineup decides as before (the free-agent optimizer's cuts follow the same rule since the verification of that review,
 *   finding VF-1: optimizer.ts's header). These forced moves are TradeEvaluation.required, per side, with rule 4's fills
 *   and the positions they fill (RosterChange.openSpots: the card's "Open roster spot: add X, the best available RB."),
 *   rule 5's IR placements, the displacements the trade brings (rosterChangeOf) and, on my side, my free-agent moves
 *   after the trade that my baseline doesn't make (RosterChange.faMoves: freeAgentMovesOf; "Exact evaluation" below).
 *
 * IR players (planner reply to Checkpoint 4, change 5 and answer 11; league.ts step 5b; returners.ts). Each team's IR
 * players expected back within the season (its returners) ride with its lineup rows everywhere a lineup is solved here:
 * screening, legality, V*(after) and the final pricing. The final pricing of a side (sideEval: the baseline at V*(T) and
 * both sides of every exact trade; B, n, h, the card's odds and the simulations) also puts a returner back on the active
 * roster from his return week: when that leaves it over maxRosterSize or his position over its limit, the lowest keep
 * value player goes from that week on (returners.finalLineups: its keep value over the weeks from the return on, in the
 * exact mode's lineups; ⚠️ the returner himself a candidate, so a return never lowers a side by more than the near-tie
 * tolerance (returners.ts: a returner worth more than W can keep his spot over a cheaper bench player); never one the
 * lineup needs, one a position's minimum needs, or the last one at a position the side streams; at his position when its
 * limit binds),
 * SideEval.displaced. Screening and legality don't (⚠️ the marginal machinery compares like with like without it). The
 * optimizer's memoized scenario lineups of a roster are reused only when nothing is displaced; else the lineups are
 * priced again where the dropped player started. The packages' open-spot credit counts each side's active-roster moves
 * (above): a given IR player opens no spot, a received one in an open IR slot fills none.
 * TradeContextOptions.irReturners false is Checkpoint 4's rule (no returner, no displacement, IR players not tradable).
 *
 * Screening (§12 step 2; M5): EV lineups, fast. My side: V*(me) − give + get with the legality above in EV mode (its adds
 * skip excl(me): "One free agent, one team" above; rule 4's fill at the position given up, judged by EV gain: ⚠️ a bench
 * fill's EV gain is mostly 0, so screening's is usually the most ROS points there, where exact evaluation judges it in
 * scenario lineups), ⚠️ not re-optimized (for speed: the exact stage runs V*); myΔROS = EV
 * ROS(after) − EV ROS(V*(me)), Σ ω LV with the
 * League model's ω (league.ts step 5c, the automatic playoff weight). The partner's side the same way from V*(P): ΔLineup_P (EV) → n, h from EV instance points
 * and the EV medians, g_mkt(P) (raw, i.e. no star premium, each player floored at W like every package, its open-spot
 * credit from its own moves on and off its active roster after rule 5 (spotsOf; market.ts's header):
 * Screened.gPartner, which the screening window reads) and the partner's perceived g
 * (the star premium on what it gives: perceivedG, the g feature), c, and acceptance.quickAcceptance (no hot, urg or
 * veto). Objective = myΔROS × quick P_accept. A screen that legality rejects is dropped. Speed (M14; about 15,000 screens on Parker's league), exactly:
 * a side's lineups start from the ones the context solved (V*(T)'s; the team's own in exact evaluation) and only the
 * weeks the trade can change are solved again (swapLook, swapSolve: a week where every outgoing player sits and no
 * incoming one's add bound is above 0 keeps its lineup); my side needs only its EV ROS, tracked through legality's moves
 * (a dropped player's removal cost, an added free agent's gain), and the partner's seats only in the hole weeks. Lineups
 * after a drop start from the ones solved before it (only the weeks he started are solved again: the same rows in the
 * same order, so the very same lineups; Phase 4 addendum, N6), and the position counts the rules read are kept as players
 * come and go.
 *
 * Exact evaluation (M3; L6, L8). Legality in scenario lineups (keep values, and since Phase 7c rule 4's fill: rule 3's
 * minimum adds stay EV-judged), then V*(after) = the free-agent optimizer from scratch on each side's post-legality
 * roster, never dropping a legality add (the optimizer's keep set: Phase 7c, planner reply to Checkpoint 7b, section 5;
 * without it, on Parker's league, Oct 4 09:24Z, V*(after) dropped the fill on 21 of the 96 sides with one in a search's
 * exact trades, 18 of them in a move making one of the side's own baseline pickups again, so the card would have named a
 * pickup the evaluated roster didn't hold; with it, V*(after) still makes that pickup on 19 of the 21, with another drop,
 * on 14 the baseline's own), the two sides in
 * the allocation order from their pools ("One free agent, one team" above; tradeSides), memoized by roster, pool and keep
 * set, judged in scenario lineups like the baseline, and its own
 * scenario lineups reused (optimizer.scenarioValuesOf); scenario lineups of both (EV without scenarios) → weekly
 * scores, LV per week and slot-instance points. ΔPPW / ΔPPW_playoffs: my average LV change over the remaining
 * regular-season / playoff weeks team numbers count. n from the partner's V* LV before and after
 * (acceptance.partnerLineupDelta from the first counted week); h (acceptance.holeFeature) from the partner's instance
 * points over the hole weeks before and after and the baseline league medians, with the received players who start in
 * the partner's after-V* EV lineup in at least one hole week; g from perception packages (benefit.tradePackage, each
 * player at max(v, W): planner reply to Checkpoint 4, change 4, which replaces lead decision N10; each side's open-spot
 * credit W from its own moves on and off its ACTIVE roster after rule 5 (spotsOf: an IR slot isn't a roster spot, review
 * of track E; market.ts's header), so with an IR player in the trade my package and the partner's needn't mirror each
 * other; spotsOf also names each side's own IR movers, ActiveSpots.inactive: a player it gives from its IR slot and one
 * it receives into an open IR slot, so the neutral throw-in rule of Phase 4c (planner reply to Checkpoint 4b, change 2;
 * market.packageValues) removes no roster-spot credit with one who took none; the raw g_mkt(P), no
 * premium, on the card and for the veto rule, g_mkt(me) on the card and for B's market term; ⚠️ my package also holds my
 * free-agent moves after the trade that my baseline doesn't make, final review of Phase 4c, finding R1:
 * freeAgentMovesOf, the set differences of V*(after) and V*(T), each pickup as received and each drop as given, every one
 * with an active roster spot (a player received and dropped at once leaves both), so a cut the trade makes necessary
 * costs his value as a traded player would; ⚠️ and whom such a pickup cuts follows the optimizer's near-tie rule
 * (verification of the final review, finding VF-1; optimizer.ts's header: where keep values are lineup costs alone, as
 * legality's, a cut worth more than W gives way to a cheaper one whose swap is within config.lineups.dropNearTieWeekly a
 * week), so the charge is never a coin flip between near-equal bench players. On Parker's league (Oct 4 09:24Z) Bo Nix →
 * Jadarian Price had my V*(after) pick up Malik Willis for Josh Allen's week-7 bye and cut Kyle Monangai, worth [value],
 * where cutting Marvin Harrison Jr. ([value]) cost 0.09 ROS points: R1's charge alone read g_mkt(me) −2.6%, the same as
 * Monangai + Nix → Price; with the near-tie rule the pickup cuts Harrison (and the baseline's Malik Washington, Rico
 * Dowdle), which leaves me the roster Rico Dowdle + Nix → Price does, and both read +8.4%. The card names those moves
 * (RosterChange.faMoves, with the baseline's pickups a drop makes room for); ⚠️ a baseline drop the trade makes
 * unnecessary isn't credited (the baseline's free-agent moves weigh trade value in near-ties only, so a cut it
 * recommends isn't counted as a loss avoided), and the partner's
 * package is the trade's alone, since its estimate reads the trade it's offered) and the partner's perceived g
 * (premium.perceivedPackage: v′ = max(v, W) × (1 + e) on what it gives, the g feature; N1); the card's values (my
 * package, floored the same way), ROS points (§6 step 7) given and received, the injured flag; acceptance(...) with hot
 * and urg; TradeDetail.premium, one PremiumFact per player the partner gives. ΔDyn (dynasty and keeper leagues with
 * long-term values): my package on the future values and the future term's W, floored the same way (so a player worth
 * less than W given for nothing moves it by 0) with my active-roster spots; MyDynTotal raw (benefit.rosterValue).
 * TradeDetail.depthCover (Phase 4c; the pattern note's injury cover, planner reply to Checkpoint 4b, change 6): my ΔPPW in
 * scenario lineups minus my ΔPPW in the same rosters' EV lineups (both finally priced: SideEval.ev), the part of the
 * weekly gain only injuries and byes show; absent without scenarios.
 *
 * The simulation (M4): the baseline SimSetup with my team's and the partner's mean and SD rows replaced by their
 * after-V* scores (every other team, and the week in progress, unchanged), simulateSeason on the screening block
 * or the final block; ΔPO, ΔCH (null when title odds are unknown: benefit's titleMissing rule), ΔEW and (Checkpoint 7c)
 * every prize component's change (TradeEvaluation.dPrizes, reward.ts runPrizeDeltas: P(2nd), P(3rd), the weekly high scores
 * won, unknown unless the context simulated them, the points title) against the baseline on the same block.
 * TradeDetail.winChance (Phase 4c; planner reply to
 * Checkpoint 4b, change 9, "Win chance by week"): from the same two runs, my head-to-head win chance before and after in each week sim.ts lists (a game's first
 * drawn week: a multi-week game at its first week still to play), a week without a game with an opponent left out
 * (winChanceOf); the final block's on a final trade and in the Analyzer, the screening block's on a screened one or a
 * step. ⚠️ None in a points-only league (review of track EV; an empty list): its scheduled games don't change the
 * standings (sim.ts plays them only for points against; the League page says so), so a weekly line there would show
 * moves in games that count for nothing, and riskyWeeks counts byes only there (TradeDetail.weekly keeps my projected
 * points by week). Then B₃ for the call's reward and λ (helpsScaleOf: one scale for every stage, so a step's or Plan B's Helps
 * you compares with its card's; Phase 7a; in dynasty and keeper leagues with long-term values B_ref(λ), planner reply to
 * Checkpoint 7a, §2 question 6), benefit() (λ = settings.lambda ?? the default by my finalSims baseline P(playoffs); κ = the
 * "Protect my trade value" level's, redraft leagues only: planner addendum to Checkpoint 3, §3, N3, in points a week per
 * 100% of trade value since the planner's reply to Checkpoint 7a, §2 question 5, the market term priced on that same B₃:
 * (B₃ / 3) × κ × clamp(g_mkt(me)), worth κ × clamp(g_mkt(me)) points a week, TradeEvaluation.marketWeekly; the term reads
 * g_mkt(me), each player at max(v, W) on both sides: benefit.ts's header; B_win's ΔPO / ΔE[S] weights and prize shares by the
 * per-call reward, TradeSettings.goal and prizes: Phase 4c, change 8, and Checkpoint 7c, reward.ts rewardOf), tradeNumbers
 * on the same B₃, tradeFlags (on the same g_mkt(me)), and benefitNotes and helpsScaleNotes (my odds barely move: the floor)
 * into the detail's notes. The search, the Analyzer, the steps' versions and Plan B's final simulations pass the call's
 * reward and protectValue (a cached context may hold older settings: rewardFor).
 * "Helps them" (Checkpoint 7c; planner reply to Checkpoint 7b, §7: "the partner's version of Helps you, from the same
 * simulation runs"): each run gives every team's odds (runSim's MyOdds.teams; the baseline on each block keeps every team's,
 * so on the final block the partner's "before" is LeagueModel.odds' for that team), so the partner's ΔPO, ΔCH and prize
 * components come from the very runs mine do, at no extra simulation. B_P is benefit.ts partnerBenefit on them under the
 * call's reward (no trade-value term; λ_P by the partner's final-block P(playoffs) at every stage, as mine reads my final-block
 * one; B_future,P from the trade's own long-term package, ExactTrade.partnerDynasty), its scale B_ref,P benefit.ts
 * partnerScale on the partner's own calibration run (partnerCalibrationOf: league.ts helpsCalibrationOf with its id on the
 * final block, made once per partner and context, about 12 ms on Parker's league), and Helps them their ratio as printed
 * (TradeEvaluation.them). It weighs nothing in B, the chance they accept or Overall.
 * ⚠️ κ = 0 when the trade values are our own estimates (Phase 4c lead decision; valuesEstimated: FantasyCalc's curve
 * fallback, MarketInputs.fallback kind "curve"): g_mkt(me) is then computed from values the model derives from its own
 * ROS points, so the market term would count lineup points a second time on top of B_win (the long-term term is already
 * off there: benefit.futureValuesLoaded). simulateTrade is the one place κ is chosen (the search's trades, the Analyzer,
 * the steps' versions and Plan B alike), and it adds ESTIMATED_VALUES_NOTE to the detail's notes in a redraft league (the
 * only kind with a market term; the search says it once, search.ts). The guards (the Market check flag, the hide
 * threshold) and the partner's g still read the estimated values. With no FantasyCalc values at all (valuesMissing:
 * MarketInputs null, no saved list to stand in) every package is empty and every g is 0, so the chance they accept reads
 * every trade as even on trade value: simulateTrade adds NO_VALUES_NOTE to the detail's notes, in every league type (the
 * search says it once too; Phase 4c's polish: the cards said only that each trade's values were unknown), and ⚠️ passes κ =
 * 0 (the term is 0 either way; marketWeekly null says there is none).
 *
 * "Offer first / if they say no" (planner addendum to Checkpoint 3, §4; lead decision N4; tradeSteps). A throw-in is one of
 * my active-roster players with a model whose lineup cost in the exact mode (TeamPlayerValue.mvLoseScen with scenarios, else
 * mvLoseEv: MV_lose against my free-agent-optimized roster V*, so a backup who covers injuries and byes isn't free) is at
 * most config.search.throwInMaxCost (× Σω ÷ Σω₀ under the automatic playoff weight: league.ts step 5c, LineupThresholds), not
 * at a position the search leaves out unless includeKDefIdp, not untouchable, not must-include (throwIns). Every version below is evaluated as the search's exact trades are (legality re-checked, exact
 * evaluation, the screening simulation: tradeVersion), and the versions are compared on the screening block of seasons.
 * - Case 1, the ranked trade gives a throw-in and my side keeps a player without it: offer first = the trade without my
 *   lowest-value throw-in there (perception value; ties: the smaller id); if they say no, add it back (= the ranked trade).
 * - Case 2, otherwise: offer first = the ranked trade; if they say no, add the throw-in not in the trade (my side within the
 *   per-side maximum: the search's maxPerSide, the Analyzer's analyzerMaxPerSide; legal) with the highest P_complete among
 *   those keeping B at least minBShare × the offer's B (⚠️ both B at screeningSims on the screening block, a fair
 *   comparison); ties: the higher B, then the smaller id. ⚠️ For speed the candidates are pre-screened (preScreenOrder: the
 *   screening's quick P_accept, which moves with g, h and n, halved by the veto rule as P_complete is; then the screening's
 *   ΔROS) and only the best config.search.steps.preScreen get exact evaluation (the Checkpoint 4 report measures how often
 *   that misses the exact choice).
 * - Steps are kept only when P_complete(full) − P_complete(offer first) ≥ minAcceptGain (⚠️ on P_complete, the card's
 *   "Chance they accept") and the offer-first version prints at least its bar (offerFirstBar): minOfferFirst, and in case 1,
 *   whose offer-first version is a trade the card doesn't show, the user's minimum chance too: max(minOfferFirst,
 *   TradeSettings.minChance) (⚠️ ours, Phase 4c lead decision: a step must never advise offering first a version under the
 *   minimum the user set; case 2's offer-first version is the card itself, which the Trade Finder's minimum already holds,
 *   and in the Analyzer the user's own trade). "Prints": P_complete as the card prints it (acceptance.displayAcceptance,
 *   the nearest 5%; rank.meetsMinChance, the minimum chance's own rule), so a version printed at the bar meets it (Phase 4b
 *   compared the raw P_complete with minOfferFirst). The search's re-filtering (search.ts refilterSearch) recomputes the
 *   steps with each new minimum. Phase 4c (planner reply to Checkpoint 4b, change 2, and answer 6, with the lead's
 *   matched pairs; market.packageValues has the rule and its reading): a throw-in worth at most W is left out of both
 *   sides' totals with his roster-spot credit, or left in where a credit stood, before any g or the market term, so when
 *   every player moves with an active roster spot he moves no g, whichever side he's added to: through value such a
 *   throw-in can only lower the chance they accept (the complexity term: with n, h and hot held fixed P_accept never
 *   rises), so a step that adds one raises the chance only through the partner's lineup (n, h) or a hot streak (hot), and
 *   one that adds a throw-in worth more than W through value too. (⚠️ Review of NT, finding 2: this said flatly that such
 *   a throw-in "can only lower" the chance; on Parker's league, the 00:51Z dump, the steps that add Rico Dowdle, worth [value]
 *   ≤ W [value], raise it 7.6 to 8.2 points through n and h, he fills a hole in Team 2's lineup, the partner's g 0% in both
 *   versions.) (Under Phase 4b's value floor alone he added W to both sides of every package, so each g, a ratio, edged
 *   toward 0: up for a partner losing value, down for one gaining, and a trade just past the veto line could come back
 *   above it; the planner's step alone still did when the partner gave d more players, at least d of them worth at most
 *   W: review of track EF, finding 1.) ⚠️ A version that moves an IR player can be the exception market.ts's header
 *   states precisely; on Parker's league (the 2026-10-04 00:51Z dump on the weekly reset order) no shown card, step or
 *   Plan B is. The search also evaluates the lean version of every shortlisted trade with such a throw-in (search.ts,
 *   "Lean companions"), so a card offering him has been weighed against the same trade without him.
 * - ⚠️ The offer-first version must help me (B > 0 on the screening block; review of the addendum, engine findings 1 and
 *   10): case 1's lean version, case 2's ranked trade (so minBShare only ever compares positive B: with an offer at B −5,
 *   "B ≥ 0.8 × the offer's B" would ask for B ≥ −4, a better B rather than at most a fifth less, and coach a trade that
 *   hurts me), and case 2's full version too. No step ever advises offering a trade that doesn't help.
 * - ⚠️ Checkpoint 7c (ours: review of the "Helps both" engine track, finding HB-1; planner reply to Checkpoint 7b, §7): on a
 *   trade that helps both teams (StepOptions.helpsBoth: its "Helps both" tag, benefit.helpsBoth on its final numbers; the
 *   search's cards on either list and the Analyzer's evaluation alike), case 1's lean version must help both too, on its
 *   screening-block numbers, else no steps, as when it doesn't help me (the card then gets a Plan B, which helps both too:
 *   planB.ts). The tag shows in every sort and the pitch names the offer-first version, so a card tagged "Helps both" never
 *   advises offering first a trade that doesn't help them (on Parker's league under his prizes the card Garrett Wilson + Bo
 *   Nix → Nico Collins, Helps them 14, said "Offer first: Garrett Wilson for Nico Collins", Helps them 0). Judged by the tag,
 *   not by the list a card is on: a card's steps are one per card, both lists fold on them, and a card on both lists is one
 *   evaluation. Case 2's offer first is the trade itself; its full version, one more player of mine for them, isn't checked.
 * The search gives the shown trades steps (after ranking: the ranking stays on the ranked trade's numbers; versions its exact
 * stage evaluated are reused); the Analyzer gives the analyzed trade steps too, ⚠️ only when the Trade Finder could show it
 * (B > 0 and not hidden by the market guard: never "how to offer it" on a card that says the trade doesn't help), and none
 * when a context note stops the search. TradeStep.detail is each version's explanation facts: the pitch names the
 * offer-first version (explain.ts); TradeStep.features its acceptance features (Phase 4c, planner reply to Checkpoint 4b,
 * change 7: feedback stores the version actually sent).
 *
 * Phase 4b removed the before/after variant (TradeContextOptions.beforeAddendum, lead decision N5: the model before the
 * planner's addendum to Checkpoint 3, kept for the Checkpoint 4 report's comparison only); Checkpoint 4b compares against
 * Checkpoint 4's committed numbers and a run of the Checkpoint 4 commit instead.
 *
 * ⚠️ Known approximations (M15): screening isn't re-optimized, and its legality adds skip each side's baseline exclusion
 * whatever the trade's order; screening judges rule 4's same-position fill in EV lineups, exact evaluation in scenario
 * lineups (Phase 7c), so the two can fill a spot with different players; rule 4 fills each spot greedily, one at a time
 * (the planner's "one at a time"), and a position is short by primary position only (multi-position eligibility aside, as
 * position limits read it); after a trade every other team keeps its baseline pickups (the planner's rule: a free agent
 * a trading team no longer claims isn't offered to a third team, nor to the other trading team when a team sits between
 * the two in the order); IR players (Phase 4b): the roster spot a returner needs counts in final evaluations only (never
 * in screening, legality or V*'s moves), and from one week, his expected return week R (the return distribution's
 * median), while his points follow his availability week by week (TradeEvaluation.required names, per side, the received
 * IR players placed in IR slots and the displacements the trade brings: rosterChangeOf);
 * an IR player counts at max(v, W) in every package though no free agent could take his IR slot (unless the neutral
 * throw-in rule leaves him out, and with IR moves that rule can let a cheap throw-in move g: market.ts's header, "The
 * exception"); the search's get pool
 * judges an open IR slot of mine before the trade; a player received from an active roster never goes to IR; the review
 * period isn't modeled; draft picks are deferred.
 */
import { acceptance, hotPlayers, hotTerm, hotWeeks, holeFeature, median, partnerLineupDelta, partnerProfile, quickAcceptance, tradeDeadlinePassed, transactionWeek, urgencyTerm, vetoApplies, type HoleSlot, type PartnerProfile, type ReceivedPlayer, type ReceivedStarter } from "./acceptance";
import {
  benefit,
  benefitNotes,
  futureValuesLoaded,
  helpsBoth,
  helpsScale,
  helpsScaleNotes,
  helpsThemScore,
  injuredReceived,
  partnerBenefit,
  partnerScale,
  protectValueWeight,
  rosterValue,
  tradeFlags,
  tradeNumbers,
  tradePackage,
  type HelpsScale,
  type PartnerScale,
} from "./benefit";
import { config } from "./config";
import { explainTrade, injuryTags, tagContextOf, type ExplainContext } from "./explain";
import type { ModelInputs } from "./inputs";
import { ODDS_REFUSED_WARNING, buildLeagueModelWithContext, claimedBy, finalRunLineups, helpsCalibrationOf, nearTieRos, pickupScore, type FaAllocationMode, type LeagueContext, type TeamBase, type TeamWork } from "./league";
import type { HelpsCalibration, LeagueModel, PlayerPremium, SeasonOdds, SlotInstance } from "./leagueModel";
import { marketValues, valuesForTerm, waiverCredit, type ActiveSpots } from "./market";
import { lineupTotal, prepareRoster } from "./lineup";
import { instancePointsInto } from "./needs";
import { POSITIONS, type InjuryStatus, type LeagueSnapshot, type PlayerInfo, type Pos, type Team } from "./model";
import { FULL_POOL, fillCount, poolRestriction, returnersOf, rosterKey, type OptimizedRoster, type PoolRestriction, type StreamSpec } from "./optimizer";
import { leaguePremiums, perceivedPackage, premiumFacts } from "./premium";
import { meetsMinChance } from "./rank";
import { activeSpots, irAfterTrade, irEligibleStatuses, type Displacement, type FinalLineups } from "./returners";
import { buildSimSetup, oddsSkippedWarning, pickupSeasonModel, seasonOdds, type SeasonModel, type SimSetupResult } from "./season";
import { paysWeekly, prizeStillMovable, rewardOf, runPrizeDeltas, type PrizeOdds, type Reward } from "./reward";
import { PRIZE_KEYS, defaultTradeSettings, normalizeTradeSettings, type ProtectValue, type TradeSettings } from "./settings";
import { simNormals, simulateSeason, type SimNormals, type SimTeamOdds } from "./sim";
import {
  addGainExact,
  addFloors,
  addUpperBoundWeeks,
  evInstancePoints,
  evRemovalCosts,
  evStarter,
  isStreamId,
  lowestKeepValue,
  ppw,
  rosValue,
  scenarioAddGain,
  scenarioAddUpperBound,
  scenarioRemovalCosts,
  scenarioValues,
  solveEvWeeks,
  teamEval,
  type ScenarioCells,
  type SolvedWeeks,
  type TableRow,
  type WeeklyScore,
} from "./teamValue";
import type { OpenSpot, PartnerNumbers, RosterChange, SlotChange, TradeAsset, TradeDetail, TradeEvaluation, TradeEvaluationCore, TradeProposal, TradeStep, TradeSteps } from "./tradeModel";

/** Gains closer than this are ties or zero (float noise, not a tunable). */
const EPS = 1e-9;

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface TradeContextOptions {
  /** The moment the numbers are for (a game that kicked off before it no longer counts; urgency). */
  now: Date;
  /**
   * The user's settings. The context reads only what the League model reads (streamPositions, and the goal and prizes its
   * automatic playoff weight weighs my odds by, which also decide whether its simulation lists the weekly high scores:
   * src/lib/settingsStore.ts LEAGUE_MODEL_SETTINGS); the search and the Analyzer take the rest per call (the goal and prizes
   * too: a cached context is rebuilt when they change, since its key holds them). Default: defaultTradeSettings().
   */
  settings?: TradeSettings;
  /** Availability scenarios (default config.lineups.scenarios), their seed, and the season simulation's seed. */
  scenarios?: number;
  seed?: number;
  simSeed?: number;
  /** Milliseconds (performance.now in the browser): TradeContext.timings is filled only when given. */
  clock?: () => number;
  /**
   * The League model's free-agent allocation (league.ts BuildLeagueModelOptions.faAllocation): "oneTeam" (the default)
   * or "independent" (Checkpoint 4's rule, for the Checkpoint 4b report only; the app never sets it): every team's
   * V* and both trade sides against the whole pool, mine evaluated first.
   */
  faAllocation?: FaAllocationMode;
  /**
   * IR returners (league.ts BuildLeagueModelOptions.irReturners; step 5b): true (the default) brings IR players back into
   * their teams' lineups and makes them tradable; false is Checkpoint 4's rule (IR players never join a lineup and aren't
   * tradable), for the Checkpoint 4b report only: the app never sets it.
   */
  irReturners?: boolean;
  /**
   * The automatic playoff weight's seasons (league.ts BuildLeagueModelOptions.playoffWeightSims; step 5c): default this
   * context's final block (simCounts().final), the seasons the League page's model measures ω on. 0 = ω isn't measured: the
   * fallback config.lineups.playoffWeight (1.25, every ROS(T)'s weight before the planner's reply to Checkpoint 7a, §6.1),
   * for tests whose hand-built leagues were measured with it and reports that compare the two: the app never sets it.
   */
  playoffWeightSims?: number;
  /**
   * How legality's rule 4 fills a roster spot a trade opens (the file header, rule 4): "samePosition" (the default; Phase
   * 7c, planner reply to Checkpoint 7b, section 5: the best available free agent at a position the side gave more players
   * than it received, by scenario gain in exact evaluation; V*(after) never drops him) or "bestAny" (Checkpoint 7b's rule:
   * the free agent who most improves the EV lineup at any position, which V*(after) may drop), for the trade report's
   * before-and-after only: the app never sets it.
   */
  openSpotFill?: OpenSpotFill;
}

/** TradeContextOptions.openSpotFill. */
export type OpenSpotFill = "samePosition" | "bestAny";

export interface TradeContext {
  /** The user's team (snapshot.myTeamId when it names a team), null when none is picked: then nothing can be evaluated. */
  readonly myTeamId: string | null;
  /** The other teams, snapshot order. */
  readonly partnerIds: readonly string[];
  /** Plain-English notes and warnings about the whole context (no team picked, season over, deadline passed, no odds, …). */
  readonly notes: readonly string[];
  readonly warnings: readonly string[];
  /** Milliseconds per setup stage (only with opts.clock). */
  readonly timings: Readonly<Record<string, number>>;
}

// ---------------------------------------------------------------------------------------------
// Plain-English notes (the pages show them)

export const NO_TEAM_NOTE = "Pick your team on the Import Report to see trade ideas.";
export const NO_WEEKS_NOTE = "No weeks are left in this season, so there are no trades to suggest.";
export const SEASON_OVER_NOTE = "Your season's over — no trade helps this year.";
export const DEADLINE_PASSED_NOTE = "Your league's trade deadline has passed.";
export const NO_ODDS_NOTE = "Trade ideas need your playoff odds, and they couldn't be worked out from this league's schedule, so trades can't be scored.";
/**
 * B without its market term in FantasyCalc's curve fallback (the file header, "The simulation"; estimatedValuesNotes). Only
 * "Helps you" leaves trade value out: the values shown, the guards and the partner's g (so the chance they accept) still
 * read the estimates, and the note says so (review of track EF, finding 3).
 */
export const ESTIMATED_VALUES_NOTE = "While FantasyCalc is unavailable, “Helps you” leaves trade value out, and the chance they accept uses our own estimates of trade value.";

/**
 * Whether the trade values are the model's own estimates: FantasyCalc's curve fallback (Phase 4c; MarketInputs.fallback
 * kind "curve": market.curveMarketValues values every player off a curve of an old list's values on this season's ROS
 * points). B's market term is off then (simulateTrade: κ = 0).
 */
export function valuesEstimated(I: Pick<TradeInternals, "inputs">): boolean {
  return I.inputs.market?.fallback?.kind === "curve";
}

/** ESTIMATED_VALUES_NOTE when the values are estimated (valuesEstimated) in a league whose B has a market term (redraft), else none. */
export function estimatedValuesNotes(I: Pick<TradeInternals, "inputs" | "snapshot">): string[] {
  return valuesEstimated(I) && I.snapshot.settings.leagueType === "redraft" ? [ESTIMATED_VALUES_NOTE] : [];
}

/**
 * No FantasyCalc values at all (valuesMissing: ModelInputs.market null, FantasyCalc unreadable with no saved list to stand
 * in; Phase 4c's polish, review of track UIC). Every value is then missing and W is 0, so every package is empty and every
 * g is 0: the partner's g, perceived or not (a star premium multiplies nothing), and hist (no past trade has values), so
 * the chance they accept reads every trade as even on trade value; g_mkt(me) is 0 too, so B's market term adds nothing and
 * the Market check never fires. The cards then drop their "These numbers weigh each player's trade value." line (until
 * Phase 7b they said their trade values were unknown; since the planner's reply to Checkpoint 7a, 5.4 no value or value
 * comparison shows anywhere), and the info line and How to read say that Helps you leaves trade value out
 * (src/lib/tradeView.ts), while nothing said what the chance they accept does then:
 * this note does, once per search (search.ts) and with each evaluation (the Analyzer's notes), in every league type
 * (every acceptance estimate reads g).
 */
export const NO_VALUES_NOTE = "While FantasyCalc's trade values aren't available, the chance they accept treats every trade as even on trade value.";

/** Whether no trade values loaded at all (ModelInputs.market null): NO_VALUES_NOTE's case. */
export function valuesMissing(I: Pick<TradeInternals, "inputs">): boolean {
  return !I.inputs.market;
}

/** NO_VALUES_NOTE when no trade values loaded (valuesMissing), else none. */
export function missingValuesNotes(I: Pick<TradeInternals, "inputs">): string[] {
  return valuesMissing(I) ? [NO_VALUES_NOTE] : [];
}

// ---------------------------------------------------------------------------------------------
// The context's internals (search.ts and the tests read them; the pages only see TradeContext)

/**
 * One evaluated roster of a team: its lineups as the exact mode prices them (scenario lineups when there are scenarios, else
 * EV), finally: its IR returners in and, from a returner's week, the roster spot he needs (league.ts step 5b;
 * returners.finalLineups).
 */
export interface SideEval {
  /** The roster (active players; streaming rows and returners aside). */
  roster: readonly string[];
  /** The players the roster drops from a week on for its returners (none when it has room). */
  displaced: readonly Displacement[];
  /** LV per week (aligned with LeagueModel.weeks): the scenario mean, or the EV lineup's. */
  lv: Float64Array;
  /** The simulator's weekly score (the week in progress: TeamModel.score's week-0 value). */
  score: WeeklyScore;
  /** Average instance points (LeagueModel.slots order) over the counted regular-season weeks, and over the hole weeks. */
  regular: Float64Array;
  hole: Float64Array;
  /** EV lineups, finally priced (who starts: the received-starter check, likely starters). */
  ev: SolvedWeeks;
}

/** A team in the context: who it is, its streaming, V*(T) and its baseline in both modes. */
export interface TeamState {
  index: number;
  id: string;
  team: Team;
  /** Its streaming rows and positions, and its IR returners (league.ts TeamWork.stream). */
  stream: StreamSpec;
  /** Its active roster (team.roster, each id once). */
  roster: readonly string[];
  /** Its IR (team.ir, each id once; league.ts TeamWork.ir). */
  ir: readonly string[];
  /** V*(T): the free-agent optimizer from scratch on the roster (the League model's own). */
  vstar: OptimizedRoster;
  /**
   * The free agents V*(T) claimed (league.ts claimedBy: every one its run added) and excl(T), every other team's claims
   * (the League model's TeamWork.pool; FULL_POOL under faAllocation "independent"): screening's legality adds skip them.
   */
  claimed: readonly string[];
  pool: PoolRestriction;
  /** Its place in the free-agent allocation order (0 = first claim), or null under faAllocation "independent". */
  claimRank: number | null;
  /**
   * An inactive team (league.ts TeamWork.inactive; planner reply to Checkpoint 4c, A4): no free-agent pickups in its
   * baseline, and after a trade neither V*(after) moves nor legality's rule 4 (the file header). Never me.
   */
  inactive: boolean;
  /** Baseline in the exact mode. */
  base: SideEval;
  /** Baseline in EV lineups (screening): LV per week, EV ROS, instance points over the hole weeks. */
  baseEv: { lv: Float64Array; ros: number; hole: Float64Array };
}

/** One team's odds from one simulation run (runSim; RunOdds per team since Checkpoint 7c). */
export interface RunOdds {
  pPlayoffs: number;
  /** Null when the league's title odds are unknown (season.ts's rules). */
  pTitle: number | null;
  expWins: number;
  /**
   * Checkpoint 7c (planner reply to Checkpoint 7b, §6): the team's prize components (reward.ts PrizeOdds: P(1st) = pTitle,
   * P(2nd), P(3rd), the remaining periods' high scores it's expected to win, P(points title)), season.ts's rules for unknown
   * ones.
   */
  prizes: PrizeOdds;
}

/** My odds from one simulation run (runSim), and every team's from the same run. */
export interface MyOdds extends RunOdds {
  /**
   * My head-to-head win chance in each week sim.ts lists (SimResult.weekly: a game's first drawn week, and median weeks),
   * in its order; null in a week I have no game with an opponent (a bye, a median game alone). Empty in a points-only
   * league (⚠️ its games don't change the standings: the file header, "The simulation").
   */
  weekly: { week: number; pWin: number | null }[];
  /**
   * Checkpoint 7c (planner reply to Checkpoint 7b, §7: "Helps them … from the same simulation runs"): every team's odds from
   * this run, snapshot order (mine among them, the very numbers above), so a trade's partner reads its changes from the runs
   * mine come from at no extra cost. On the final block's baseline, each team's are LeagueModel.odds' (SimState.odds).
   */
  teams: RunOdds[];
}

/** Which block of simulated seasons a run reads: the screening's or the final one (the file header, M4). */
export type SimStage = "screen" | "final";

export interface SimState {
  built: SimSetupResult;
  /**
   * Checkpoint 7c: the setup lists the remaining weekly high-score periods (the context's reward pays them: reward.ts
   * paysWeekly), so the runs' expected high scores mean something; a call's reward that pays them needs it (rewardOn), and
   * runSim refuses a setup without them. Without them every trade's weekly change is unknown (reward.ts runPrizeDeltas).
   */
  highScores: boolean;
  /** The two blocks of one common-random-numbers matrix: the first finalSims seasons (the final block), then the next screeningSims. */
  blocks: Record<SimStage, SimNormals>;
  seed: number;
  /**
   * The baseline on the final block: LeagueModel.odds exactly (the same setup and seasons; the file header), which the
   * League page reads too: eliminated, weekly win chances, P(playoffs).
   */
  odds: SeasonOdds;
  base: Record<SimStage, MyOdds>;
  /**
   * Phase 7a (planner reply to Checkpoint 4c, A2): the "Helps you" calibration run on the final block against `odds`
   * (league.ts helpsCalibrationOf, the League model's step 8c on the same seasons and setup: LeagueModel.helpsCalibration
   * exactly). helpsScaleOf turns it into B₃ for a call's goal and λ. Null without my team.
   */
  calibration: HelpsCalibration | null;
  /** Checkpoint 7c: the season model `odds` simulates (season.pickupSeasonModel: every team's TeamModel.scoreWithPickups), which each partner's calibration run reads. */
  season: SeasonModel;
  /**
   * Checkpoint 7c (planner reply to Checkpoint 7b, §7, "Helps them"): each partner's calibration run by team id, the same run
   * as `calibration` with that team's score + 3 a week (league.ts helpsCalibrationOf), on the final block against `odds`, made
   * when first needed (partnerCalibrationOf; null when none could be made). Memoized per context: the Analyzer pays one run
   * the first time it evaluates a trade with a team, a search one per partner of its exact trades.
   */
  partners: Map<string, HelpsCalibration | null>;
}

/** Everything a search or an Analyzer call reads. Mutable only through its memos. */
export interface TradeInternals {
  snapshot: LeagueSnapshot;
  inputs: ModelInputs;
  now: Date;
  league: LeagueContext;
  model: LeagueModel;
  bases: TeamBase[];
  settings: TradeSettings;
  W: number;
  S: number;
  weights: Float64Array;
  /** The first week index team numbers count (1 with a week in progress, else 0). */
  from: number;
  inProgress: boolean;
  /** Week indexes: the counted regular-season weeks, the counted playoff weeks, the hole weeks (§11 h). */
  regIdx: number[];
  poIdx: number[];
  holeIdx: number[];
  /** The counted regular-season and playoff weeks themselves (ppw's lists). */
  regWeeks: number[];
  poWeeks: number[];
  teams: TeamState[];
  byId: Map<string, TeamState>;
  me: TeamState | null;
  /** The search returns no trades (a context note says why). */
  blocked: boolean;
  instances: SlotInstance[];
  /** Per instance: the positions its slot takes. */
  slotEligible: Pos[][];
  /** Perception values (§9; the League model's, raw) and the waiver credit W (every package floors each player at it). */
  values: Record<string, number>;
  credit: number;
  /**
   * The star premium (premium.leaguePremiums): team id → its rostered players' premiums (active, IR and taxi), each team's
   * P(playoffs) from the baseline on the final block (every team at V*). premiumOf and harderToGetFor read it.
   */
  premiums: Map<string, Record<string, PlayerPremium>>;
  /**
   * Long-term values (dynasty and keeper leagues whose dynasty values loaded): values, W, top value, MyDynTotal, and (Checkpoint
   * 7c, "Helps them") every team's roster's long-term value by team id (its roster, IR and taxi: rosterValue, as MyDynTotal).
   */
  future: { values: Record<string, number>; credit: number; top: number; myTotal: number; totals: Record<string, number> } | null;
  profiles: Map<string, PartnerProfile>;
  hot: Set<string>;
  urg: number;
  /** League medians per instance over the hole weeks: EV (screening) and the exact mode. */
  medians: { ev: Float64Array; exact: Float64Array };
  /** Per team id: its rank (1 = best) at each instance, exact-mode regular-season averages, every team at V*. */
  ranks: Map<string, Int32Array>;
  riskyWeeks: number[];
  sim: SimState | null;
  /**
   * Free agents with a model (legality's adds): with their slot masks and the most they could add to any lineup
   * (Σ ω × their points), most first; and by their own ROS points (most first, then the smaller id).
   */
  faByGain: FaPick[];
  faByRos: TableRow[];
  /** Position counts of rosters (legalityQuiet), by array. */
  countMemo: WeakMap<readonly string[], Int32Array>;
  /** Exact-mode side evaluations by team and roster (V* rosters before and after trades). */
  sideMemo: Map<string, SideEval>;
  /**
   * Per partner id: X, the pool restriction of a trade with it (the file header, "Exact evaluation"): the free agents every
   * team but me and the partner claimed (FULL_POOL under faAllocation "independent"), built when first needed.
   */
  othersPool: Map<string, PoolRestriction>;
  /** IR players tradable and back in lineups (TradeContextOptions.irReturners; the League model's). */
  irOn: boolean;
  /** Every IR player's team (IR player id → team id): a received IR player may go into an open IR slot (legality's rule 5). */
  irOwner: Map<string, string>;
  /** The statuses an IR slot accepts (returners.irEligibleStatuses: LeagueSettings.irEligible, else config's default). */
  irEligible: ReadonlySet<InjuryStatus>;
  /** How rule 4 fills a roster spot a trade opens (TradeContextOptions.openSpotFill; "samePosition" unless a report says otherwise). */
  openSpotFill: OpenSpotFill;
  notes: string[];
  warnings: string[];
  timings: Record<string, number>;
}

/** A free agent legality can add, with his slot mask and Σ ω × his points (the most he could add to any lineup). */
export interface FaPick {
  row: TableRow;
  mask: number;
  max: number;
}

const internalsOf = new WeakMap<TradeContext, TradeInternals>();

/** The internals of a context built by buildTradeContext (search.ts, tests). */
export function tradeInternals(ctx: TradeContext): TradeInternals {
  const I = internalsOf.get(ctx);
  if (!I) throw new Error("Not a trade context built by buildTradeContext");
  return I;
}

// ---------------------------------------------------------------------------------------------
// Keys and small helpers

/** An asset's stable key: the player id, or the pick's season, round and original team. */
export function assetKey(a: TradeAsset): string {
  return a.kind === "player" ? a.id : `pick:${a.season}:${a.round}:${a.originalTeamId}`;
}

/** TradeEvaluation.key: the partner and each side's assets, sorted (dedupe, diversity, feedback records). */
export function proposalKey(p: Pick<TradeProposal, "partnerId" | "give" | "get">): string {
  const side = (xs: readonly TradeAsset[]) => xs.map(assetKey).sort(byId).join(",");
  return `${p.partnerId}|give:${side(p.give)}|get:${side(p.get)}`;
}

/** The players of a side (picks aren't evaluated in this phase). */
const playerIds = (xs: readonly TradeAsset[]): string[] => xs.flatMap((a) => (a.kind === "player" ? [a.id] : []));

const players = (ids: readonly string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));

function avgOver(perWeek: readonly ArrayLike<number>[], idx: readonly number[], size: number): Float64Array {
  const out = new Float64Array(size);
  if (!idx.length) return out;
  for (const w of idx) {
    const row = perWeek[w];
    if (!row) continue;
    for (let i = 0; i < size; i++) out[i] = (out[i] as number) + ((row[i] as number) || 0);
  }
  for (let i = 0; i < size; i++) out[i] = (out[i] as number) / idx.length;
  return out;
}

// ---------------------------------------------------------------------------------------------
// The star premium (planner addendum to Checkpoint 3, §1–§2; lead decisions N1, N2)

/** A player's star premium e for team `teamId` (his owner): 0 for a player it doesn't roster. */
export function premiumOf(I: TradeInternals, teamId: string): (playerId: string) => number {
  const premiums = I.premiums.get(teamId);
  return (playerId) => premiums?.[playerId]?.e ?? 0;
}

/** Whether a player is "Harder to get" from team `teamId` (his owner): e ≥ harderToGetMin. */
export function harderToGetFor(I: TradeInternals, teamId: string, playerId: string): boolean {
  return I.premiums.get(teamId)?.[playerId]?.harderToGet === true;
}

/**
 * The partner's perceived g (premium.perceivedPackage): what it receives (`give`, my side) against what it gives (`get`)
 * with its own premiums on the latter, its open-spot credit from `spots` (its own moves on and off its active roster:
 * spotsOf its legality; absent, every player takes a spot). `raw`, the partner's raw g_mkt on the same values and spots
 * when the caller has it, is returned as it is when none of `get` carries a premium (perceivedPackage equals tradePackage
 * exactly then: a shortcut for the screening's thousands of trades).
 */
export function perceivedG(I: TradeInternals, partnerId: string, give: readonly string[], get: readonly string[], raw?: number, spots?: ActiveSpots): number {
  const e = premiumOf(I, partnerId);
  if (raw !== undefined && get.every((id) => e(id) === 0)) return raw;
  return perceivedPackage({ players: give }, { players: get }, I.values, I.credit, e, config.market, spots).g;
}

const POS_WORDS: Readonly<Record<Pos, [string, string]>> = {
  QB: ["QB", "QBs"],
  RB: ["RB", "RBs"],
  WR: ["WR", "WRs"],
  TE: ["TE", "TEs"],
  K: ["kicker", "kickers"],
  P: ["punter", "punters"],
  DEF: ["D/ST", "D/STs"],
  DL: ["DL", "DLs"],
  LB: ["LB", "LBs"],
  DB: ["DB", "DBs"],
};
const posWords = (pos: Pos, n: number): string => `${n} ${(POS_WORDS[pos] ?? [pos, `${pos}s`])[n === 1 ? 0 : 1]}`;

// ---------------------------------------------------------------------------------------------
// The context

/** The evaluation context (see the file header). */
export function buildTradeContext(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: TradeContextOptions): TradeContext {
  const clock = opts.clock;
  const timings: Record<string, number> = {};
  const start = clock ? clock() : 0;
  let last = start;
  const mark = (stage: string) => {
    if (!clock) return;
    const t = clock();
    timings[stage] = (timings[stage] ?? 0) + (t - last);
    last = t;
  };
  const settings = normalizeTradeSettings(opts.settings ?? defaultTradeSettings());
  const simSeed = opts.simSeed ?? config.simulation.seed;
  const built = buildLeagueModelWithContext(snapshot, inputs, {
    now: opts.now,
    sims: 0,
    // The automatic playoff weight (league.ts step 5c) on this context's final block: the seasons the League page's model
    // measures it on (its headline's), so every ROS(T) here weighs the playoff weeks as the League page does.
    playoffWeightSims: opts.playoffWeightSims ?? simCounts().final,
    simSeed,
    settings,
    // The League page's "Waiver upgrades" lists (league.ts step 10): the trade search never shows them, so skip the work.
    waiverUpgrades: false,
    ...(opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {}),
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    ...(opts.faAllocation !== undefined ? { faAllocation: opts.faAllocation } : {}),
    ...(opts.irReturners !== undefined ? { irReturners: opts.irReturners } : {}),
  });
  const { model, context: league, bases, pickups } = built;
  mark("league model");

  const { W, S, tw, lp, instances, index } = league;
  const weeks = lp.weeks.weeks;
  const weekIndex = new Map(weeks.map((w, i) => [w, i]));
  const inProgress = tw.inProgressWeek !== null;
  const regWeeks = tw.regularWeeks;
  const poWeeks = lp.weeks.playoffWeeks.filter((w) => w !== tw.inProgressWeek);
  const regIdx = regWeeks.flatMap((w) => weekIndex.get(w) ?? []);
  const poIdx = poWeeks.flatMap((w) => weekIndex.get(w) ?? []);
  const holeWeeks = Number.isFinite(config.acceptance.holeWeeks) ? Math.max(0, Math.floor(config.acceptance.holeWeeks)) : 0;
  const holeIdx: number[] = [];
  for (let w = tw.from; w < Math.min(W, tw.from + holeWeeks); w++) holeIdx.push(w);
  const slotEligible = instances.map((inst) => [...new Set(snapshot.settings.lineup.filter((d) => d.slot === inst.slot).flatMap((d) => d.eligible))]);

  const values: Record<string, number> = {};
  for (const [id, pm] of Object.entries(lp.players)) if (pm.value) values[id] = pm.value.value;

  const I: TradeInternals = {
    snapshot,
    inputs,
    now: opts.now,
    league,
    model,
    bases,
    settings,
    W,
    S,
    weights: tw.weights,
    from: tw.from,
    inProgress,
    regIdx,
    poIdx,
    holeIdx,
    regWeeks,
    poWeeks,
    teams: [],
    byId: new Map(),
    me: null,
    blocked: false,
    instances,
    slotEligible,
    values,
    credit: league.market.waiverCredit,
    premiums: new Map(),
    future: null,
    profiles: new Map(),
    hot: new Set(),
    urg: 0,
    medians: { ev: new Float64Array(instances.length), exact: new Float64Array(instances.length) },
    ranks: new Map(),
    riskyWeeks: [],
    sim: null,
    faByGain: league.freeAgentIds
      .flatMap((id) => {
        const row = league.table.rows.get(id);
        return row ? [{ row, mask: league.maskOf(row), max: rosValue(row.ev, tw.weights) }] : [];
      })
      .sort((a, b) => b.max - a.max || byId(a.row.id, b.row.id)),
    faByRos: league.freeAgentIds
      .flatMap((id) => league.table.rows.get(id) ?? [])
      .sort((a, b) => (lp.players[b.id]?.ros.total ?? 0) - (lp.players[a.id]?.ros.total ?? 0) || byId(a.id, b.id)),
    countMemo: new WeakMap(),
    sideMemo: new Map(),
    othersPool: new Map(),
    irOn: league.irReturners,
    irOwner: new Map(league.irReturners ? league.work.flatMap((t) => t.ir.map((id): [string, string] => [id, t.team.id])) : []),
    irEligible: irEligibleStatuses(snapshot.settings),
    openSpotFill: opts.openSpotFill ?? "samePosition",
    notes: [],
    warnings: [...model.warnings],
    timings,
  };

  // The baseline: every team at V*(T), in the exact mode (the League model's own final lineups of V*(T), behind
  // TeamModel.scoreWithPickups: LeagueModelBuild.pickups) and in EV lineups.
  const claimRanks = new Map((league.allocation?.order ?? []).map((ti, k) => [ti, k]));
  I.teams = league.work.map((t: TeamWork, ti) => {
    const state: TeamState = {
      index: ti,
      id: t.team.id,
      team: t.team,
      stream: t.stream,
      roster: t.ids,
      ir: t.ir,
      vstar: t.vstar,
      claimed: t.claimed,
      pool: t.pool,
      claimRank: league.allocation ? (claimRanks.get(ti) ?? null) : null,
      inactive: t.inactive,
      base: null as unknown as SideEval,
      baseEv: { lv: t.vstar.solved.lv, ros: t.vstar.evRos, hole: avgOver(evInstancePoints(t.vstar.solved, index), holeIdx, instances.length) },
    };
    state.base = sideEval(I, state, t.vstar, t.stream, pickups[ti]);
    return state;
  });
  for (const t of I.teams) I.byId.set(t.id, t);
  const myIndex = snapshot.myTeamId === null ? -1 : I.teams.findIndex((t) => t.id === snapshot.myTeamId);
  I.me = myIndex >= 0 ? (I.teams[myIndex] as TeamState) : null;
  for (let i = 0; i < instances.length; i++) {
    I.medians.ev[i] = median(I.teams.map((t) => t.baseEv.hole[i] as number)) ?? 0;
    I.medians.exact[i] = median(I.teams.map((t) => t.base.hole[i] as number)) ?? 0;
  }
  for (const t of I.teams) {
    const ranks = new Int32Array(instances.length);
    for (let i = 0; i < instances.length; i++) {
      const x = t.base.regular[i] as number;
      ranks[i] = 1 + I.teams.filter((u) => (u.base.regular[i] as number) > x + EPS).length;
    }
    I.ranks.set(t.id, ranks);
  }
  mark("baseline lineups");

  // Long-term values (dynasty and keeper leagues whose dynasty values loaded).
  const market = inputs.market ?? null;
  if (market && futureValuesLoaded(snapshot.settings.leagueType, market)) {
    const modelIds = Object.keys(lp.players);
    const valuePlayers = modelIds.map((id) => ({ id, pos: (lp.contexts.get(id) as { info: PlayerInfo }).info.pos }));
    const rosPoints: Record<string, number> = {};
    for (const id of modelIds) rosPoints[id] = (lp.players[id]?.weekly ?? []).slice(tw.from).reduce((s, w) => s + w.p, 0);
    const fv = marketValues(valuePlayers, rosPoints, market, config.market, "future");
    const fValues: Record<string, number> = {};
    for (const [id, v] of Object.entries(fv)) fValues[id] = v.value;
    const top = valuesForTerm(market, "future").topValue;
    const myIds = I.me ? [...I.me.team.roster, ...I.me.team.ir, ...I.me.team.taxi] : [];
    // Every team's, for "Helps them"'s B_future,P and B_ref,P (Checkpoint 7c): the same rule as MyDynTotal.
    const totals: Record<string, number> = {};
    for (const t of I.teams) totals[t.id] = rosterValue([...t.team.roster, ...t.team.ir, ...t.team.taxi], fValues);
    // The long-term W like the perception one (league.ts step 4; planner reply to Checkpoint 4c, A3): the best free agent the
    // allocation leaves unclaimed, on the long-term values.
    I.future = { values: fValues, credit: waiverCredit(fValues, league.freeAgentIds, top, config.market, league.claimedAll), top: Number.isFinite(top) && top > 0 ? top : 0, myTotal: rosterValue(myIds, fValues), totals };
  }

  // The season simulation: one setup, one matrix, the baseline on both blocks. The setup is LeagueModel.odds's: every
  // team's TeamModel.scoreWithPickups (season.pickupSeasonModel), the scores of the baseline lineups above.
  const seasonModel: SeasonModel = pickupSeasonModel(model);
  let simWarning: string | null = null;
  if (W > 0) {
    simWarning = oddsSkippedWarning(snapshot, seasonModel);
    if (simWarning === null) {
      try {
        // The weekly high scores when the context's reward pays them, as the League model's runs (league.ts step 8).
        const highScores = paysWeekly(league.reward);
        const setup = buildSimSetup(snapshot, seasonModel, { highScores });
        if (setup) {
          const { screen: screenSims, final: finalSims } = simCounts();
          const Wk = setup.setup.weeks.length;
          const T = setup.setup.teams.length;
          // One matrix of finalSims + screeningSims seasons: the final simulation (and its baseline) reads the first block,
          // the League model's own seasons (so its baseline odds are LeagueModel.odds), and the screening the next one,
          // seasons the final simulation never reads (no selection bias in the shown B). When the automatic playoff weight
          // drew the first block already (league.ts step 5c, PlayoffWeightSim: the same seed, count, weeks and teams), it is
          // that block, and only the screening block is drawn here (sim.simNormals from season finalSims on: the same draws).
          const pw = league.playoffWeightSim;
          const drawn = pw && pw.sims === finalSims && pw.seed === simSeed && pw.normals.weeks === Wk && pw.normals.teams === T ? pw.normals : null;
          let blocks: Record<SimStage, SimNormals>;
          if (drawn) blocks = { final: drawn, screen: simNormals(simSeed, screenSims, Wk, T, finalSims) };
          else {
            const all = simNormals(simSeed, finalSims + screenSims, Wk, T);
            const per = Wk * T;
            blocks = {
              final: { sims: finalSims, weeks: Wk, teams: T, z: all.z.subarray(0, finalSims * per) },
              screen: { sims: screenSims, weeks: Wk, teams: T, z: all.z.subarray(finalSims * per, (finalSims + screenSims) * per) },
            };
          }
          const odds = seasonOdds(snapshot, seasonModel, { sims: finalSims, seed: simSeed, normals: blocks.final, highScores });
          if (odds) {
            const unknown: MyOdds = { pPlayoffs: 0, pTitle: null, expWins: 0, prizes: { first: null, second: null, third: null, weeklyHigh: 0, pointsLeader: 0 }, weekly: [], teams: [] };
            const sim: SimState = { built: setup, highScores, blocks, seed: simSeed, odds, base: { screen: unknown, final: unknown }, calibration: null, season: seasonModel, partners: new Map() };
            I.sim = sim;
            if (I.me) {
              sim.base.screen = runSim(I, null, null, "screen");
              sim.base.final = runSim(I, null, null, "final");
              // The "Helps you" calibration (B₃'s run): the League model's step 8c on the same block and setup.
              sim.calibration = helpsCalibrationOf(snapshot, seasonModel, I.me.id, odds, { sims: finalSims, seed: simSeed, normals: blocks.final, highScores }, tw.from);
            }
          }
        }
      } catch (err) {
        if (!(err instanceof RangeError)) throw err;
        simWarning = ODDS_REFUSED_WARNING;
        I.sim = null;
      }
    }
  }
  if (simWarning) I.warnings.push(simWarning);
  for (const w of I.sim?.built.warnings ?? []) if (!I.warnings.includes(w)) I.warnings.push(w);
  mark("simulation");

  // Partner profiles, the star premium, hot players, urgency, risky weeks.
  const txWeek = transactionWeek(snapshot);
  for (const t of I.teams) {
    if (t === I.me) continue;
    const odds = I.sim?.odds.teams[t.index];
    I.profiles.set(t.id, partnerProfile({ teamId: t.id, transactions: snapshot.transactions ?? [], week: txWeek, values, W: I.credit, pPlayoffs: odds ? odds.pPlayoffs : null }));
  }
  // The same function as the League model's TeamModel.premiums, with P(playoffs) from this baseline (every team at V*).
  I.premiums = leaguePremiums({
    snapshot,
    market,
    value: (id) => values[id] ?? 0,
    ros: (id) => lp.players[id]?.ros.total ?? 0,
    pPlayoffs: (teamId) => {
      const t = I.byId.get(teamId);
      const odds = t ? I.sim?.odds.teams[t.index] : undefined;
      return odds ? odds.pPlayoffs : null;
    },
  });
  const active = new Set(I.teams.flatMap((t) => t.roster));
  I.hot = hotPlayers(inputs.players ?? {}, hotWeeks(snapshot.currentWeek), config.acceptance, active);
  I.urg = urgencyTerm(snapshot.settings.tradeDeadline, opts.now, txWeek);
  I.riskyWeeks = riskyWeeksOf(I);
  mark("profiles");

  // Notes: what stops the search (the Analyzer still evaluates, except without a team).
  if (!I.me) I.notes.push(NO_TEAM_NOTE);
  else {
    if (W === 0) I.notes.push(NO_WEEKS_NOTE);
    else if (!I.sim) I.notes.push(NO_ODDS_NOTE);
    const mine = I.sim?.odds.teams[I.me.index];
    // Certainly out of the title race, and no prize the reward pays still within a trade's reach (reward.ts prizeStillMovable
    // on the baseline's odds, Checkpoint 7c: a weekly high score with a prize period left, the points title or a place the
    // final standings decide with a regular-season week left, 3rd place after a lost semifinal with a playoff week left;
    // SeasonOdds.regularLeft and playoffLeft leave the week under way out, since every trade holds it as rosters stand).
    const over = I.sim && mine ? !prizeStillMovable(league.reward, I.sim.odds, mine) : false;
    if (snapshot.settings.leagueType === "redraft" && over) I.notes.push(SEASON_OVER_NOTE);
    if (tradeDeadlinePassed(snapshot.settings.tradeDeadline, opts.now, txWeek)) I.notes.push(DEADLINE_PASSED_NOTE);
  }
  I.blocked = I.notes.length > 0;
  if (clock) timings.total = last - start;

  const ctx: TradeContext = {
    myTeamId: I.me?.id ?? null,
    partnerIds: I.teams.filter((t) => t !== I.me).map((t) => t.id),
    notes: [...I.notes],
    warnings: [...I.warnings],
    timings,
  };
  internalsOf.set(ctx, I);
  return ctx;
}

/**
 * My remaining regular-season games the League page would flag as risky before the trade (TradeDetail.riskyWeeks;
 * leagueView's scheduleView rules), by each game's first week, when that week is one team numbers count: a game I'm
 * under riskyWinChance to win (judged on the printed whole percent; head-to-head leagues), or riskyByes or more of my
 * likely starters on bye in a game that counts for me (an opponent or a median game). The byes are counted over the
 * matchup's weeks that count (review of track E, item 6: an ESPN matchup spanning two weeks has its bye crunch in either),
 * each starter once. Likely starter: in my V* EV lineup (its final pricing: returners in, the roster spot one needs from
 * his week, SideEval.ev) in at least half of the counted weeks he plays. A starter's bye counts only in a week his row can
 * score for me (review of track E): a returner's from his expected return week on, a displaced player's before the week
 * his displacement starts (a bye he'd sit on IR for, or after he's dropped, isn't my crunch). ⚠️ Never a likely starter at
 * a position I stream whose streaming replacement covers his bye (StreamSpec.positions within
 * config.leaguePage.streamCoversBye: K and D/ST; Phase 4c lead decisions on the reviews of tracks UIP and polish): his
 * slot's streaming row starts that week's streaming replacement when he's off, about as good as he is, so his bye is no
 * crunch; a streamed QB's or TE's replacement is much weaker, so their byes still count (on Parker's league, the 2026-10-04 09:24Z dump, his kicker was the 4th of week 13's starters on
 * bye; week 13 stays risky with the other 3). ⚠️ By position: a league that starts two at a position I stream still gets
 * one streamer (league.ts step 5a), and a second starter there off the same week isn't counted either. leagueView.ts
 * scheduleView applies the same rule to the League page's bye list (leagueView.engine.test.ts checks the two agree).
 * In a points-only league every counted week counts on its own (byes only). Empty without odds.
 */
function riskyWeeksOf(I: TradeInternals): number[] {
  const me = I.me;
  const odds = I.sim?.odds;
  if (!me || !odds) return [];
  const solved = me.base.ev;
  const streamed = new Set<Pos>(me.stream.positions.filter((p) => config.leaguePage.streamCoversBye.includes(p)));
  const starters = solved.team.rows.flatMap((r, k) => (!isStreamId(r.id) && !streamed.has(r.pos) && evStarter(solved, k, I.weights) ? [r.id] : []));
  const weekIndex = new Map(I.league.lp.weeks.weeks.map((w, i) => [w, i]));
  const counted = new Set(I.regWeeks);
  // The week indexes a starter is on my active roster: a returner from his return, a displaced player before his drop.
  const back = new Map(returnersOf(me.stream).map((r) => [r.id, I.league.returnerSetup.returnIndex(r.id) ?? Number.POSITIVE_INFINITY]));
  const gone = new Map(me.base.displaced.map((d) => [d.id, d.from]));
  const withMe = (id: string, w: number): boolean => w >= (back.get(id) ?? 0) && w < (gone.get(id) ?? Number.POSITIVE_INFINITY);
  const onBye = (weeks: readonly number[]): number =>
    starters.filter((id) =>
      weeks.some((week) => {
        const w = weekIndex.get(week);
        return w !== undefined && withMe(id, w) && I.league.lp.players[id]?.weekly[w]?.bye === true;
      }),
    ).length;
  const byes = config.leaguePage.riskyByes;
  if (I.snapshot.settings.pointsOnly) return I.regWeeks.filter((week) => onBye([week]) >= byes);
  const limit = Math.round(config.leaguePage.riskyWinChance * 100);
  const out: number[] = [];
  for (const wk of odds.weekly) {
    if (!counted.has(wk.week)) continue;
    const game = wk.games.find((g) => g.teamId === me.id);
    if (!game) continue;
    const winPct = game.pWin !== null && Number.isFinite(game.pWin) ? Math.round(game.pWin * 100) : null;
    const low = winPct !== null && winPct < limit;
    const counts = game.opponentId !== null || game.pMedianWin !== null;
    const weeks = matchupWeeksOf(I.snapshot, me.id, game.opponentId, wk.week).filter((w) => counted.has(w));
    if (low || (counts && onBye(weeks.length ? weeks : [wk.week]) >= byes)) out.push(wk.week);
  }
  return out;
}

/** The NFL weeks of my regular-season matchup listed under `week` (Matchup.weeks for a multi-week one; leagueView's matchupWeeks), [week] when not found. */
function matchupWeeksOf(snapshot: LeagueSnapshot, me: string, opponentId: string | null, week: number): number[] {
  for (const m of snapshot.schedule) {
    if (m.isPlayoff) continue;
    const pair = (m.teamA === me && m.teamB === opponentId) || (opponentId !== null && m.teamA === opponentId && m.teamB === me);
    if (!pair) continue;
    const weeks = m.weeks?.length ? [...m.weeks].sort((a, b) => a - b) : [m.week];
    if (weeks.includes(week)) return weeks;
  }
  return [week];
}

// ---------------------------------------------------------------------------------------------
// Side evaluations (exact mode) and EV solves (screening)

/**
 * A team's roster priced in the exact mode (SideEval), from an optimizer run's roster made with `spec` (the team's
 * streaming rows and the returners of its IR after the trade; default its own, TeamState.stream): league.ts
 * finalRunLineups, the League model's own pricing of every team's V*(T) (scenario lineups with S > 0: the
 * law-of-total-variance score, instance points; else its EV lineups; finally priced, returners.finalLineups: from a
 * returner's week, the roster spot he needs, when it's full: the file header, "IR players"), and its score by
 * league.pickupScore, TeamModel.scoreWithPickups's rule (the week in progress keeps TeamModel.score's week-0 value: the
 * file header). `priced`: those final lineups when the caller has them (the baseline: the League model's,
 * LeagueModelBuild.pickups). Memoized by team, roster and spec, so a roster the trade leaves as it was gives the very same
 * numbers (the no-op test).
 */
export function sideEval(I: TradeInternals, t: Pick<TeamState, "index" | "stream">, run: OptimizedRoster, spec: StreamSpec = t.stream, priced?: FinalLineups): SideEval {
  const key = `${t.index}\u0004${rosterKey(run.roster, spec)}`;
  const hit = I.sideMemo.get(key);
  if (hit) return hit;
  const { league } = I;
  const final = priced ?? finalRunLineups(league, run, spec);
  const perWeek = final.scen ? (final.scen.instances as Float64Array[]) : evInstancePoints(final.ev, league.index);
  const out: SideEval = {
    roster: run.roster,
    displaced: final.displaced,
    lv: final.scen ? final.scen.mean : final.ev.lv,
    score: pickupScore(league, final, I.model.teams[t.index]?.score),
    regular: avgOver(perWeek, I.regIdx, I.instances.length),
    hole: avgOver(perWeek, I.holeIdx, I.instances.length),
    ev: final.ev,
  };
  I.sideMemo.set(key, out);
  return out;
}

/** EV lineups of a roster with the team's streaming rows and returners (after its players, as the optimizer orders them). */
function evSolve(I: TradeInternals, roster: readonly string[], stream: StreamSpec): SolvedWeeks {
  const rows: TableRow[] = [];
  for (const id of roster) {
    const row = I.league.table.rows.get(id);
    if (row) rows.push(row);
  }
  return solveEvWeeks(teamEval([...rows, ...stream.rows, ...returnersOf(stream)], I.league.slots), I.W);
}

/** Scenario lineups of a roster kept cell by cell (keep values in the exact mode), with the streaming rows and returners. */
function scenarioCells(I: TradeInternals, roster: readonly string[], stream: StreamSpec): ScenarioCells {
  const rows: TableRow[] = [];
  for (const id of roster) {
    const row = I.league.table.rows.get(id);
    if (row) rows.push(row);
  }
  return scenarioValues(teamEval([...rows, ...stream.rows, ...returnersOf(stream)], I.league.slots), I.W, I.S, null, true).cells as ScenarioCells;
}

// ---------------------------------------------------------------------------------------------
// Roster legality (the file header; M2)

export type LineupMode = "ev" | "exact";

export interface LegalSide {
  /** The active roster after the trade and the roster rules. */
  roster: string[];
  /** Rules 1–4's drops and adds; rule 4's fills also in `openSpots` with the position each one fills (absent: none). */
  change: RosterChange;
  /** The final roster's EV ROS (EV mode, need "ros" or "look"), else null. */
  ros: number | null;
  /** The final roster's EV look (need "look"), else null. */
  look: EvLook | null;
  /** The side's IR after the trade (rule 5: given IR players leave it, received ones fill its open IR slots when eligible). */
  ir: string[];
  /** The side's streaming rows with the returners of that IR (league.ts withReturners): every later solve of the side uses it. */
  spec: StreamSpec;
  /** Rule 5's moves: the IR players it gives (leaving its IR) and the received ones going into its IR slots (returners.irAfterTrade). */
  givenIR: readonly string[];
  toIR: readonly string[];
}

/**
 * A side's moves on and off its active roster (returners.activeSpots: what §9's open-spot credit counts, market.ts's
 * header): `given` and `received` from the side's point of view, less the IR players legality's rule 5 placed; and those
 * IR players themselves (ActiveSpots.inactive, the side's own: one it gives from its IR slot, one it receives into an open
 * IR slot), each of whom moves without an active roster spot, so the neutral throw-in rule (planner reply to Checkpoint 4b,
 * change 2: market.packageValues) removes no roster-spot credit with him. `inactive` is absent when no IR player of the
 * side moves. activeSpots itself names them (Phase 4c), so a reader outside the engine (irSlots.tradeActiveSpots) gets the
 * same packages.
 */
export function spotsOf(side: Pick<LegalSide, "givenIR" | "toIR">, given: readonly string[], received: readonly string[]): ActiveSpots {
  return activeSpots(given, received, side);
}

const POS_INDEX: ReadonlyMap<Pos, number> = new Map(POSITIONS.map((p, i) => [p, i]));

/** Players per position (POSITIONS order) on a roster, players without a known position left out; memoized per array. */
function positionCounts(I: TradeInternals, roster: readonly string[]): Int32Array {
  let out = I.countMemo.get(roster);
  if (!out) {
    out = new Int32Array(POSITIONS.length);
    for (const id of roster) {
      const i = POS_INDEX.get(I.league.posOf(id) as Pos);
      if (i !== undefined) out[i] = (out[i] as number) + 1;
    }
    I.countMemo.set(roster, out);
  }
  return out;
}

/**
 * Whether no roster rule can apply to `before` − given + received (rules 1–4): no position above its cap, the roster
 * not above its size cap, no position below its minimum target, no spot opened (`refills` false: an inactive side, whose
 * open spots rule 4 leaves open). Then legality makes no move.
 */
function legalityQuiet(I: TradeInternals, before: readonly string[], given: readonly string[], received: readonly string[], refills = true): boolean {
  // Only given players on `before` leave it (screening's V*(T) may have dropped one already).
  const leaving = given.length === 0 ? given : given.filter((id) => before.includes(id));
  if (refills && received.length < leaving.length) return false; // rule 4: a spot opened
  const maxSize = I.league.maxRosterSize;
  if (received.length > leaving.length && Number.isFinite(maxSize) && maxSize > 0 && before.length - leaving.length + received.length > Math.max(maxSize, before.length)) return false;
  const limits = I.league.limits;
  const minimums = I.snapshot.settings.rosterMinimums;
  if (!limits && !minimums) return true;
  const base = positionCounts(I, before);
  const counts = Int32Array.from(base);
  for (const id of leaving) {
    const i = POS_INDEX.get(I.league.posOf(id) as Pos);
    if (i !== undefined) counts[i] = (counts[i] as number) - 1;
  }
  for (const id of received) {
    const i = POS_INDEX.get(I.league.posOf(id) as Pos);
    if (i !== undefined) counts[i] = (counts[i] as number) + 1;
  }
  for (let i = 0; i < POSITIONS.length; i++) {
    const pos = POSITIONS[i] as Pos;
    const limit = limits?.[pos];
    if (limit !== undefined && Number.isFinite(limit) && (counts[i] as number) > Math.max(limit, base[i] as number)) return false;
    const min = minimums?.[pos];
    if (min !== undefined && Number.isFinite(min) && (counts[i] as number) < Math.min(min, base[i] as number)) return false;
  }
  return true;
}

/**
 * Keep values of a roster's players (the file header): removal cost in the mode, plus the dynasty part, for the active
 * roster's players only (never a streaming row or a returner: neither is ever dropped). `raw` holds the EV removal costs
 * (ROS points) in EV mode, so legality can track the roster's EV ROS after a drop. `tie`: the near-tie dropOrder reads
 * (config.lineups.dropNearTieWeekly × the weeks' weights, ROS lineup points) when the keep values are lineup costs alone
 * (no long-term part), else 0.
 */
function keepValues(I: TradeInternals, roster: readonly string[], stream: StreamSpec, mode: LineupMode, solvedEv: SolvedWeeks | null): { keep: Map<string, number>; raw: Map<string, number> | null; tie: number } {
  const costs = new Map<string, number>();
  let raw: Map<string, number> | null = null;
  const onRoster = new Set(roster);
  if (mode === "exact" && I.S > 0) {
    const cells = scenarioCells(I, roster, stream);
    const c = scenarioRemovalCosts(cells, I.weights);
    cells.team.rows.forEach((r, k) => {
      if (onRoster.has(r.id)) costs.set(r.id, c[k] as number);
    });
  } else {
    const solved = solvedEv ?? evSolve(I, roster, stream);
    const c = evRemovalCosts(solved, I.weights);
    solved.team.rows.forEach((r, k) => {
      if (onRoster.has(r.id)) costs.set(r.id, c[k] as number);
    });
    raw = costs;
  }
  const f = I.future;
  if (!f || I.snapshot.settings.leagueType === "redraft") return { keep: costs, raw, tie: nearTieOf(I) };
  let max = 0;
  for (const v of costs.values()) if (v > max) max = v;
  const keep = new Map<string, number>();
  for (const [id, cost] of costs) keep.set(id, (max > EPS ? cost / max : 0) + (f.top > 0 ? (f.values[id] ?? 0) / f.top : 0));
  return { keep, raw, tie: 0 };
}

/**
 * config.lineups.dropNearTieWeekly in ROS lineup points: × the sum of the weeks' weights (the weeks team numbers count;
 * league.nearTieRos, the optimizer's tolerance too).
 */
function nearTieOf(I: Pick<TradeInternals, "weights">): number {
  return nearTieRos(config.lineups.dropNearTieWeekly, I.weights);
}

/**
 * The candidates in drop order: the lowest keep value first, ties as teamValue.lowestKeepValue (the lower perception
 * value, then the smaller id). With `tie` > 0 (keepValues: keep values that are lineup costs alone; final review of Phase
 * 4c, finding R6), each next one is lowestKeepValue's near-tie pick among the candidates left: the lowest perception value
 * floored at the waiver credit W, whose keep value is within `tie` of the lowest left (ties: the lower keep value), so a
 * near-free bench player worth W or less goes before one worth more, while between players worth at most W (replaceable:
 * every package counts them at W) the lineup decides as before. Candidates without a keep value (no model) aren't dropped.
 * Lazily, one at a time: the first is usually the one dropped.
 */
function* dropOrder(I: TradeInternals, keep: ReadonlyMap<string, number>, candidates: readonly string[], tie = 0): Generator<string, void, void> {
  const list = candidates.flatMap((id) => (keep.has(id) ? [{ id, keep: keep.get(id) as number, value: I.values[id] ?? 0 }] : []));
  while (list.length) {
    const id = lowestKeepValue(list, tie, I.credit) as string;
    yield id;
    list.splice(
      list.findIndex((c) => c.id === id),
      1,
    );
  }
}

/**
 * Which free agents a legality add may take: not on the roster or added, not in `pool` (free agents other teams claimed:
 * the file header, "One free agent, one team"), within position limits, and either at `pos` (rule 3) or not at an
 * `excluded` position (rule 4); at a `refillOnly` position (rule 4: K and D/ST), only one `refills` accepts (he fills a
 * starting slot the trade emptied). `positions` (rule 4's same-position fill: the positions still short) keeps only those
 * positions, on top of the rest (so a streamed or refill-only one among them is still judged as above).
 */
interface AddFilter {
  on: ReadonlySet<string>;
  counts: Int32Array;
  pool: ReadonlySet<string>;
  pos?: Pos;
  positions?: ReadonlySet<Pos>;
  excluded?: ReadonlySet<Pos>;
  refillOnly?: ReadonlySet<Pos>;
  refills?: (row: TableRow) => boolean;
}

function addAllowed(I: TradeInternals, f: AddFilter, row: TableRow): boolean {
  if (f.positions && !f.positions.has(row.pos)) return false;
  if (f.pos !== undefined ? row.pos !== f.pos : f.excluded?.has(row.pos) === true) return false;
  if (f.on.has(row.id) || f.pool.has(row.id) || !limitAllows(I, f.counts, row.pos)) return false;
  return f.refillOnly?.has(row.pos) !== true || f.refills?.(row) === true;
}

/**
 * The free agent a roster adds (rules 3 and 4) and his exact EV ROS gain: the largest gain among the allowed ones; ties
 * within 1e-9 go to the higher ROS points, then the smaller id, and when none gains anything, the allowed one with the
 * most ROS points (then the smaller id), gain 0. Exact, solving as few as it can (the bounds are tight without starter
 * limits, so usually one): a free agent gains at most his add bound (teamValue's floors: per week, his points above the
 * lowest starter he could displace), which is at most Σ ω × his points (FaPick.max). Free agents are scanned by that
 * most first, each allowed one's bound computed, while it could still reach the largest bound found; then they're solved
 * in bound order (ties: the smaller id), the scan resuming whenever someone not scanned yet could still beat the best
 * gain, until no bound can reach it. Under starter limits nothing is bounded and every allowed one is solved.
 */
function pickAdd(I: TradeInternals, solved: SolvedWeeks, filter: AddFilter): { row: TableRow; mask: number; gain: number } | null {
  const rosOf = (id: string) => I.league.lp.players[id]?.ros.total ?? 0;
  const { W, weights } = I;
  const fas = I.faByGain;
  const floors = new Map<number, Float64Array | null>();
  const list: { row: TableRow; mask: number; ub: number; done: boolean }[] = [];
  let i = 0;
  let maxUb = 0;
  /** Scans the next free agent: his bound when he's allowed and could gain anything. */
  const scanOne = () => {
    const c = fas[i++] as FaPick;
    if (c.mask === 0 || !addAllowed(I, filter, c.row)) return;
    let f = floors.get(c.mask);
    if (f === undefined) {
      f = addFloors(solved, c.mask);
      floors.set(c.mask, f);
    }
    let ub = Number.POSITIVE_INFINITY;
    if (f) {
      ub = 0;
      const ev = c.row.ev;
      for (let w = 0; w < W; w++) {
        const wt = weights[w] as number;
        const x = (ev[w] as number) - (f[w] as number);
        if (wt > 0 && x > 0) ub += wt * x;
      }
    }
    if (!(ub > EPS)) return;
    list.push({ row: c.row, mask: c.mask, ub, done: false });
    if (ub > maxUb) maxUb = ub;
  };
  const more = (bar: number) => i < fas.length && ((fas[i] as FaPick).max > EPS) && (fas[i] as FaPick).max >= bar - EPS;
  while (more(maxUb)) scanOne();
  let best: { row: TableRow; mask: number; gain: number } | null = null;
  for (;;) {
    let next: (typeof list)[number] | null = null;
    for (const x of list) if (!x.done && (!next || x.ub > next.ub || (x.ub === next.ub && x.row.id < next.row.id))) next = x;
    const bar = best ? best.gain : 0;
    if (!next || (best && next.ub < bar - EPS)) {
      if (more(Math.max(bar, EPS))) {
        scanOne();
        continue;
      }
      break;
    }
    next.done = true;
    const gain = addGainExact(solved, next.row, next.mask, weights).gain;
    if (!(gain > EPS)) continue;
    const b: { row: TableRow; gain: number } | null = best;
    if (!b || gain > b.gain + EPS || (Math.abs(gain - b.gain) <= EPS && (rosOf(next.row.id) > rosOf(b.row.id) || (rosOf(next.row.id) === rosOf(b.row.id) && next.row.id < b.row.id)))) best = { row: next.row, mask: next.mask, gain };
  }
  if (best) return best;
  for (const row of I.faByRos) if (addAllowed(I, filter, row)) return { row, mask: I.league.maskOf(row), gain: 0 };
  return null;
}

/**
 * pickAdd in scenario lineups (rule 4 in exact evaluation with scenarios; the file header, rule 4): the allowed free agent
 * whose add gains the most ROS points in the roster's scenario lineups (`cells`, the roster with the side's streaming
 * rows and returners: scenarioCells), ω-weighted like every gain; ties within 1e-9 go to the higher ROS points, then the
 * smaller id, and when none gains anything, the allowed one with the most ROS points (then the smaller id), gain 0:
 * pickAdd's rules. Exact: each allowed free agent's scenario add bound (teamValue.scenarioAddUpperBound: per scenario and
 * week, his points above the floor there when he plays; +Infinity under starter limits, so every one is solved there) is
 * computed, and they're solved best bound first (ties: the smaller id) while a bound can still reach the best gain (a tie
 * can still win on ROS points). `gain` is a scenario gain: the EV trackers can't use it (legalSide's add()).
 */
function pickAddScenario(I: TradeInternals, cells: ScenarioCells, filter: AddFilter): { row: TableRow; mask: number; gain: number } | null {
  const rosOf = (id: string) => I.league.lp.players[id]?.ros.total ?? 0;
  const list: { row: TableRow; mask: number; ub: number }[] = [];
  for (const c of I.faByGain) {
    if (c.mask === 0 || !addAllowed(I, filter, c.row)) continue;
    const ub = scenarioAddUpperBound(cells, c.row, c.mask, I.weights);
    if (ub > EPS) list.push({ row: c.row, mask: c.mask, ub });
  }
  list.sort((a, b) => (a.ub === b.ub ? 0 : b.ub - a.ub) || byId(a.row.id, b.row.id));
  let best: { row: TableRow; mask: number; gain: number } | null = null;
  for (const x of list) {
    if (best && x.ub < best.gain - EPS) break;
    const gain = scenarioAddGain(cells, x.row, x.mask, I.weights);
    if (!(gain > EPS)) continue;
    const b: { row: TableRow; gain: number } | null = best;
    if (!b || gain > b.gain + EPS || (Math.abs(gain - b.gain) <= EPS && (rosOf(x.row.id) > rosOf(b.row.id) || (rosOf(x.row.id) === rosOf(b.row.id) && x.row.id < b.row.id)))) best = { row: x.row, mask: x.mask, gain };
  }
  if (best) return best;
  for (const row of I.faByRos) if (addAllowed(I, filter, row)) return { row, mask: I.league.maskOf(row), gain: 0 };
  return null;
}

/** Whether a roster with these position counts (POSITIONS order) can add a player at `pos` (position limits). */
function limitAllows(I: TradeInternals, counts: Int32Array, pos: Pos): boolean {
  const limit = I.league.limits?.[pos];
  if (limit === undefined || !Number.isFinite(limit)) return true;
  const i = POS_INDEX.get(pos);
  return i === undefined || (counts[i] as number) < limit;
}

/** Position counts (POSITIONS order) of a roster, not memoized (legality's adds). */
function countsOf(I: TradeInternals, roster: readonly string[]): Int32Array {
  const out = new Int32Array(POSITIONS.length);
  for (const id of roster) {
    const i = POS_INDEX.get(I.league.posOf(id) as Pos);
    if (i !== undefined) out[i] = (out[i] as number) + 1;
  }
  return out;
}

/**
 * The look (EvLook) of a solved roster plus one player, exactly, re-solving only the weeks where he could change the
 * lineup (teamValue.addUpperBoundWeeks above 0; every week under starter limits): elsewhere the old lineup stays the
 * best one, with him on the bench.
 */
function addLook(I: TradeInternals, base: SolvedWeeks, row: TableRow, mask: number): EvLook {
  const rows = [...base.team.rows, row];
  const prep = prepareRoster(rows, I.league.slots);
  const n = rows.length;
  const ubw = addUpperBoundWeeks(base, row, mask);
  const lv = new Float64Array(I.W);
  const pts = new Float64Array(n);
  const lo = I.holeIdx.length ? (I.holeIdx[0] as number) : -1;
  const hi = I.holeIdx.length ? (I.holeIdx[I.holeIdx.length - 1] as number) : -2;
  const seats: Int32Array[] = [];
  const holePts: Float64Array[] = [];
  for (let w = 0; w < I.W; w++) {
    const hole = w >= lo && w <= hi;
    if (ubw && !((ubw[w] as number) > 0)) {
      lv[w] = base.lv[w] as number;
      if (hole) {
        const seat = new Int32Array(n);
        seat.set(base.seat[w] as Int32Array);
        seat[n - 1] = -1;
        const p = new Float64Array(n);
        p.set(base.pts[w] as Float64Array);
        p[n - 1] = row.ev[w] as number;
        seats.push(seat);
        holePts.push(p);
      }
      continue;
    }
    for (let k = 0; k < n; k++) pts[k] = (rows[k] as TableRow).ev[w] as number;
    if (hole) {
      const seat = new Int32Array(n);
      lv[w] = lineupTotal(prep, pts, null, seat);
      seats.push(seat);
      holePts.push(Float64Array.from(pts));
    } else {
      lv[w] = lineupTotal(prep, pts);
    }
  }
  return { rows, lv, seats, pts: holePts };
}

/**
 * `before` − given + received, in roster order: each received player takes the place of a given one (the first
 * received the first given player's place on the roster, and so on; teamValue.applyStep's convention), extra received
 * players go at the end. The order changes no lineup value; it keeps two rosters that differ only in who fills a spot
 * in the same order (the free-agent pickup a trade reproduces, the Checkpoint 4 consistency test).
 */
export function tradeRoster(before: readonly string[], given: readonly string[], received: readonly string[]): string[] {
  const gone = new Set(given);
  const incoming = received.filter((id) => !before.includes(id));
  const out: string[] = [];
  let r = 0;
  for (const id of before) {
    if (!gone.has(id)) out.push(id);
    else if (r < incoming.length) out.push(incoming[r++] as string);
  }
  for (; r < incoming.length; r++) out.push(incoming[r] as string);
  return out;
}

/** What legality's caller needs besides the roster (EV mode): its EV ROS, or its look (LV per week and the hole weeks). */
export type LegalNeed = "none" | "ros" | "look";

/**
 * Rule 5 (the file header): a side's IR after a trade (returners.irAfterTrade: given IR players leave it; players received
 * from the other side's IR fill its open IR slots when the slot takes their status, the most ROS points first) and its
 * spec with that IR's returners. The side's own IR and spec (TeamState.stream, the same object) when the trade moves no IR
 * player of it, and always under irReturners false (no IR player is tradable then).
 */
function irMoves(I: TradeInternals, side: TeamState, given: readonly string[], received: readonly string[]): { givenIR: readonly string[]; toIR: readonly string[]; ir: readonly string[]; spec: StreamSpec } {
  const none = { givenIR: [], toIR: [], ir: side.ir, spec: side.stream };
  if (!I.irOn) return none;
  const after = irAfterTrade({
    ir: side.ir,
    irSlots: I.snapshot.settings.irSlots,
    given,
    received,
    fromIR: (id) => I.irOwner.has(id) && I.irOwner.get(id) !== side.id,
    eligible: (id) => I.irEligible.has(I.snapshot.players[id]?.injury ?? "ACTIVE"),
    ros: (id) => I.league.lp.players[id]?.ros.total ?? 0,
  });
  if (!after.givenIR.length && !after.toIR.length) return none;
  return { ...after, spec: I.league.withReturners(side.stream, after.ir) };
}

/**
 * The players of `given` (active-roster moves) on `before` whom the side's own baseline cuts anyway: V*(T) drops them for
 * its pickups (TeamState.vstar: on its start roster, not on its roster). Rule 4 leaves them out (the file header, rule 4:
 * such a player's spot is the baseline pickup's, which V*(after) makes again; review of Phase 7c's fill, finding
 * pickups-1). None in screening, whose `before` is V*(T) itself, nor for an inactive side (V*(T) = T).
 */
function baselineCutsGiven(side: Pick<TeamState, "vstar">, before: readonly string[], given: readonly string[]): string[] {
  if (!given.length || !side.vstar.moves.length) return [];
  const kept = new Set(side.vstar.roster);
  const cuts = new Set(side.vstar.start.filter((id) => !kept.has(id)));
  if (!cuts.size) return [];
  const on = new Set(before);
  return given.filter((id) => cuts.has(id) && on.has(id));
}

/**
 * A team's own baseline pickups: the free agents on its V*(T)'s roster (the League page's "Free-agent pickups that would
 * help"; not one its run picked up and swapped away again), in roster order.
 */
function baselinePickups(side: Pick<TeamState, "vstar">): string[] {
  if (!side.vstar.moves.length) return [];
  const start = new Set(side.vstar.start);
  return side.vstar.roster.filter((id) => !start.has(id));
}

/**
 * Roster legality after a trade for one side (the file header, rules 1–5): `before` is the active roster the trade applies
 * to (the team's roster in exact evaluation, V*(T) in screening), `given` and `received` its sides (IR players included:
 * rule 5 sends them to or from the side's IR first; the rest are active-roster moves). `who` words the illegal reasons
 * ("You", or the team's name). Rules 3 and 4 add only free agents `pool` doesn't exclude (the file header, "One free
 * agent, one team": the free agents other teams claimed; default FULL_POOL); rule 4 at a position still short, judged in
 * scenario lineups in the exact mode with scenarios (pickAddScenario; LegalSide.change.openSpots names each fill), never
 * for the spot of a given player the side's own baseline cuts anyway (baselineCutsGiven). Every lineup solved here holds
 * the side's
 * returners after the trade (LegalSide.spec), never a displacement (legality isn't a final evaluation). In EV mode it also
 * prices the final roster as `need` asks, solving as little as it can: dropping a player who starts in no week leaves the
 * best lineups as they were (removing a bench player never changes an optimal lineup), dropping a starter lowers EV ROS by
 * exactly his removal cost (nobody refilling his spot), and an added free agent raises it by exactly his gain (pickAdd),
 * his lineups re-solved only in the weeks he could change (addLook).
 */
export function legalSide(
  I: TradeInternals,
  side: TeamState,
  before: readonly string[],
  given: readonly string[],
  received: readonly string[],
  mode: LineupMode,
  who: string,
  need: LegalNeed = mode === "ev" ? "look" : "none",
  pool: PoolRestriction = FULL_POOL,
): LegalSide | { illegal: string } {
  // Rule 5: IR players move first; what's left are the active roster's moves.
  const irMove = irMoves(I, side, given, received);
  const ir = [...irMove.ir];
  const spec = irMove.spec;
  const placed = { ir, spec, givenIR: irMove.givenIR, toIR: irMove.toIR };
  const givenActive = irMove.givenIR.length ? given.filter((id) => !irMove.givenIR.includes(id)) : given;
  const receivedActive = irMove.toIR.length ? received.filter((id) => !irMove.toIR.includes(id)) : received;
  const inbound = new Set(receivedActive);
  const roster = tradeRoster(before, givenActive, receivedActive);
  const drops: string[] = [];
  const adds: string[] = [];
  // `before`'s EV lineups when the context has them: V*(T)'s (screening) or the team's as it stands (exact evaluation).
  // Their rows hold the side's own returners: the solves from them take out the ones the trade takes away and bring in
  // the ones it brings (a returner's row is his own row, whichever lineup he joins).
  const base = before === side.vstar.roster ? side.vstar.solved : before === side.roster ? (I.league.work[side.index]?.solved ?? null) : null;
  const backBefore = new Set(returnersOf(side.stream).map((r) => r.id));
  const backAfter = new Set(returnersOf(spec).map((r) => r.id));
  const removedBase = [...givenActive, ...[...backBefore].filter((id) => !backAfter.has(id))];
  const addedBase = [...receivedActive, ...[...backAfter].filter((id) => !backBefore.has(id))];
  if (legalityQuiet(I, before, givenActive, receivedActive, !side.inactive)) {
    if (need === "none") return { roster, change: { drops, adds }, ros: null, look: null, ...placed };
    // From a solved roster (V*(T) in screening), only the weeks the trade can change are solved again (swapLook).
    const look = base ? swapLook(I, base, removedBase, addedBase, need === "look") : quickLook(I, roster, spec, need === "look");
    return { roster, change: { drops, adds }, ros: rosValue(look.lv, I.weights), look: need === "look" ? look : null, ...placed };
  }
  /** The current roster's exact EV lineups (null: not solved since the last change). */
  let solved: SolvedWeeks | null = null;
  /**
   * The lineups solved before the drops since (`pending`; no add since): the next solve starts from them and solves again
   * only the weeks a dropped player started (swapSolve: the same rows in the same order, so the very same lineups as a
   * solve from `base`, where removing bench players never changes an optimal lineup).
   */
  let prev: SolvedWeeks | null = null;
  let pending: string[] = [];
  /** EV lineups still optimal for the current roster, with dropped bench players aboard (the final look only). */
  let reusable: SolvedWeeks | null = null;
  /** The current roster's look after a free agent was added (the final look only). */
  let look: EvLook | null = null;
  /** The current roster's EV ROS when known. */
  let ros: number | null = null;
  /** Players per position on the current roster (POSITIONS order), and on `before` (rules 1–3; countsOf's counting). */
  const counts = countsOf(I, roster);
  const beforeCounts = positionCounts(I, before);
  const countNow = (pos: Pos): number => {
    const i = POS_INDEX.get(pos);
    return i === undefined ? 0 : (counts[i] as number);
  };
  const countBefore = (pos: Pos): number => {
    const i = POS_INDEX.get(pos);
    return i === undefined ? 0 : (beforeCounts[i] as number);
  };
  const recount = (id: string, by: number) => {
    const i = POS_INDEX.get(I.league.posOf(id) as Pos);
    if (i !== undefined) counts[i] = (counts[i] as number) + by;
  };
  const ev = (): SolvedWeeks => {
    if (!solved) {
      if (prev && pending.length && !adds.length) solved = swapSolve(I, prev, pending, []);
      else solved = base ? swapSolve(I, base, [...removedBase, ...drops], [...addedBase, ...adds]) : evSolve(I, roster, spec);
      prev = null;
      pending = [];
      ros = rosValue(solved.lv, I.weights);
    }
    return solved;
  };
  const benched = (s: SolvedWeeks, id: string): boolean => {
    const k = s.team.rows.findIndex((r) => r.id === id);
    return k < 0 || s.seat.every((seat) => (seat[k] as number) < 0);
  };
  const drop = (id: string, raw: ReadonlyMap<string, number> | null) => {
    const s = solved ?? reusable;
    reusable = s && benched(s, id) ? s : null;
    const cost = raw?.get(id);
    ros = ros !== null && cost !== undefined && solved !== null ? ros - cost : null;
    if (solved) {
      prev = solved;
      pending = [id];
    } else if (prev) pending.push(id);
    roster.splice(roster.indexOf(id), 1);
    recount(id, -1);
    drops.push(id);
    solved = null;
    look = null;
  };
  /**
   * Adds a free agent picked against `base`, the roster's EV lineups, with his exact EV gain; `base` null for a pick judged
   * in scenario lineups (rule 4 in exact evaluation: pickAddScenario), whose gain the EV trackers can't use, so they're
   * dropped and recomputed when asked for (the final look and ROS below).
   */
  const add = (pick: { row: TableRow; mask: number; gain: number }, base: SolvedWeeks | null) => {
    look = need === "look" && base ? addLook(I, base, pick.row, pick.mask) : null;
    ros = ros !== null && base ? ros + pick.gain : null;
    roster.push(pick.row.id);
    recount(pick.row.id, 1);
    adds.push(pick.row.id);
    solved = null;
    reusable = null;
    prev = null;
    pending = [];
  };
  const hasRow = (id: string) => I.league.table.rows.has(id);
  const limits = I.league.limits;
  const evMode = mode === "ev" || I.S === 0;

  // 1. Positions over their limit: drop the position's lowest keep value player not just received.
  if (limits) {
    for (const pos of POSITIONS) {
      const limit = limits[pos];
      if (limit === undefined || !Number.isFinite(limit)) continue;
      const cap = Math.max(limit, countBefore(pos));
      while (countNow(pos) > cap) {
        const cands = roster.filter((id) => !inbound.has(id) && hasRow(id) && I.league.posOf(id) === pos);
        const kv = cands.length ? keepValues(I, roster, spec, mode, evMode ? ev() : null) : null;
        const k = kv ? dropOrder(I, kv.keep, cands, kv.tie).next().value : undefined;
        if (k === undefined) return { illegal: `${who} can have at most ${posWords(pos, limit)}.` };
        drop(k, kv?.raw ?? null);
      }
    }
  }

  // 2. Over the roster size: drop the lowest keep value player, never one just received (or added by rule 3), one the
  // lineup needs, one a position's minimum needs (rule 3's target), or the last one at a position the side streams (the
  // file header). Run again after rule 3's adds.
  const maxSize = I.league.maxRosterSize;
  const minimums = I.snapshot.settings.rosterMinimums;
  const minTarget = (pos: Pos | undefined): number => {
    const min = pos === undefined ? undefined : minimums?.[pos];
    return min === undefined || !Number.isFinite(min) ? 0 : Math.min(min, countBefore(pos as Pos));
  };
  /** The positions the side streams: rule 2 keeps the last player it rosters at each (the file header). */
  const streamedHere = new Set<Pos>(spec.positions);
  /** A roster's structural lineup entries (optimizer.fillCount): its known players and the side's streaming rows (never its returners: they can't play now). */
  const entries = (ids: readonly string[]) => [
    ...ids.flatMap((id) => {
      const info = I.snapshot.players[id];
      return info ? [{ id, pos: info.pos, eligible: info.eligible }] : [];
    }),
    ...side.stream.rows.map((r) => ({ id: r.id, pos: r.pos, eligible: r.eligible })),
  ];
  const trim = (): string | null => {
    if (!(Number.isFinite(maxSize) && maxSize > 0)) return null;
    const cap = Math.max(maxSize, before.length);
    while (roster.length > cap) {
      const cands = roster.filter((id) => {
        if (inbound.has(id) || adds.includes(id) || !hasRow(id)) return false;
        const pos = I.league.posOf(id);
        if (pos !== undefined && streamedHere.has(pos) && countNow(pos) <= 1) return false; // the last one at a streamed position
        return !(minTarget(pos) > 0 && countNow(pos as Pos) <= minTarget(pos));
      });
      const kv = cands.length ? keepValues(I, roster, spec, mode, evMode ? ev() : null) : null;
      // In drop order, the first one the starting lineup doesn't need (optimizer.fillCount), checked lazily.
      let fill: number | null = null;
      let k: string | undefined;
      // Not needed when some week's EV lineup fills every slot without him and without a returner (then the roster without
      // him still can: the fill rule leaves returners out).
      const cur = evMode ? (solved as SolvedWeeks | null) : null;
      const backAt = cur && backAfter.size ? cur.team.rows.flatMap((r, x) => (backAfter.has(r.id) ? [x] : [])) : [];
      const sparedIn = (id: string): boolean => {
        if (!cur) return false;
        const at = cur.team.rows.findIndex((r) => r.id === id);
        if (at < 0) return false;
        for (let w = 0; w < cur.lv.length; w++) {
          const seat = cur.seat[w] as Int32Array;
          if ((cur.open[w] as number) === 0 && (seat[at] as number) < 0 && backAt.every((x) => (seat[x] as number) < 0)) return true;
        }
        return false;
      };
      for (const id of kv ? dropOrder(I, kv.keep, cands, kv.tie) : []) {
        if (sparedIn(id)) {
          k = id;
          break;
        }
        fill ??= fillCount(entries(roster), I.league.slots);
        if (fillCount(entries(roster.filter((x) => x !== id)), I.league.slots) >= fill) {
          k = id;
          break;
        }
      }
      if (k === undefined) return `${who} would have more than ${maxSize} players on the active roster, and nobody can be dropped without leaving a starting spot empty.`;
      drop(k, kv?.raw ?? null);
    }
    return null;
  };
  const tooBig = trim();
  if (tooBig) return { illegal: tooBig };

  // 3. Positions under their minimum (only as far as the trade caused it): add the best free agent there, then make
  // room by rule 2 when that leaves the roster too big (⚠️ ours: the add needs a roster spot like any other).
  const taken = () => new Set([...roster, ...adds]);
  if (minimums) {
    for (const pos of POSITIONS) {
      const min = minimums[pos];
      if (min === undefined || !Number.isFinite(min)) continue;
      const target = Math.min(min, countBefore(pos));
      while (countNow(pos) < target) {
        const base = ev();
        const pick = pickAdd(I, base, { on: taken(), counts, pool: pool.excluded, pos });
        if (!pick) return { illegal: `${who} must keep at least ${posWords(pos, min)}, and no free agent is available to fill the spot.` };
        add(pick, base);
      }
    }
    const still = adds.length ? trim() : null;
    if (still) return { illegal: still };
  }

  // 4. Roster spots the trade opened, one at a time (the file header, rule 4; planner reply to Checkpoint 7b, section 5):
  // the best available free agent at a position still short (fewer players there than before the trade), by his gain in
  // scenario lineups in exact evaluation with scenarios, else in EV lineups; none available there: the best at any
  // position. Never at a position the team streams (its streaming row values that slot), and at a K or D/ST position
  // (optimizerExcluded: V* never picks one up) only to refill a starting slot the trade emptied: the structural fill is
  // below `before`'s and he raises it. Fill counts are computed lazily, only for such a candidate. ⚠️ Not for an inactive
  // side (A4: it makes no pickups; the spot stays open). ⚠️ A given player the side's own baseline cuts anyway opens no
  // spot of the trade's and leaves no position short (the file header, rule 4: his spot is the baseline pickup's, which
  // V*(after) makes again). Under openSpotFill "bestAny" (Checkpoint 7b's rule, for the trade report) the EV pick at any
  // position, in every spot that opened.
  const excluded = new Set<Pos>(side.stream.positions);
  const refillOnly = new Set<Pos>(I.league.cfg.streaming.optimizerExcluded.filter((p) => !excluded.has(p)));
  const samePosition = I.openSpotFill !== "bestAny";
  const freed = samePosition ? baselineCutsGiven(side, before, givenActive) : [];
  /** Players per position among `freed` (POSITIONS order), whom the counts before the trade leave out here. */
  const freedCounts = freed.length ? countsOf(I, freed) : null;
  const countGivenUp = (pos: Pos): number => {
    const i = POS_INDEX.get(pos);
    return countBefore(pos) - (freedCounts && i !== undefined ? (freedCounts[i] as number) : 0);
  };
  const openSpots: OpenSpot[] = [];
  let fillBefore: number | null = null;
  for (let open = side.inactive ? 0 : before.length - roster.length - freed.length; open > 0; open--) {
    let fillNow: number | null = null;
    const refills = (row: TableRow): boolean => {
      fillBefore ??= fillCount(entries(before), I.league.slots);
      fillNow ??= fillCount(entries(roster), I.league.slots);
      return fillNow < fillBefore && fillCount([...entries(roster), { id: row.id, pos: row.pos, eligible: row.eligible }], I.league.slots) > fillNow;
    };
    const filter: AddFilter = { on: taken(), counts, pool: pool.excluded, excluded, refillOnly, refills };
    // Exact evaluation with scenarios judges the pick in scenario lineups, the ones B is measured in (screening and S = 0
    // in EV lineups); its gain isn't an EV one (add()).
    const cells = samePosition && !evMode ? scenarioCells(I, roster, spec) : null;
    const base = cells ? null : ev();
    const pickFrom = (f: AddFilter) => (cells ? pickAddScenario(I, cells, f) : pickAdd(I, base as SolvedWeeks, f));
    // The positions still short, where the side has fewer players than before the trade (players without a known position
    // aside, as in rules 1–3; the baseline's own cuts given away aside, above).
    const short = samePosition ? POSITIONS.filter((pos) => countNow(pos) < countGivenUp(pos)) : [];
    const same = short.length ? pickFrom({ ...filter, positions: new Set(short) }) : null;
    const pick = same ?? pickFrom(filter);
    if (!pick) break;
    add(pick, base);
    if (same) openSpots.push({ playerId: pick.row.id, pos: pick.row.pos });
    else {
      // The fallback: the short positions none could fill, never one the side streams or a K or D/ST it doesn't (OpenSpot.short).
      const none = short.filter((pos) => !excluded.has(pos) && !refillOnly.has(pos));
      openSpots.push({ playerId: pick.row.id, pos: null, ...(none.length ? { short: none } : {}) });
    }
  }
  const change: RosterChange = { drops, adds, ...(openSpots.length ? { openSpots } : {}) };
  if (need === "none") return { roster, change, ros: null, look: null, ...placed };
  if (need === "ros") return { roster, change, ros: ros ?? rosValue(ev().lv, I.weights), look: null, ...placed };
  const final = look ?? lookOf(I, solved ?? reusable ?? ev());
  return { roster, change, ros: ros ?? rosValue(final.lv, I.weights), look: final, ...placed };
}

// ---------------------------------------------------------------------------------------------
// Proposal checks (M2's illegal reasons before the roster rules)

function playerName(I: TradeInternals, id: string): string {
  return I.snapshot.players[id]?.name ?? "A player";
}

function teamName(I: TradeInternals, id: string): string {
  return I.snapshot.teams.find((t) => t.id === id)?.name ?? `Team ${id}`;
}

/** Why a proposal can't be evaluated before any roster rule (M2), or null. */
export function proposalProblem(I: TradeInternals, proposal: TradeProposal, maxPerSide: number): string | null {
  const me = I.me;
  if (!me) return NO_TEAM_NOTE;
  const partner = I.byId.get(proposal.partnerId);
  if (!partner || partner === me) return "Pick a team to trade with.";
  if ([...proposal.give, ...proposal.get].some((a) => a.kind !== "player")) return "Draft picks can't be part of a trade here yet: pick players only.";
  const give = playerIds(proposal.give);
  const get = playerIds(proposal.get);
  if (give.length + get.length === 0) return "Pick at least one player to trade.";
  if (give.length > maxPerSide || get.length > maxPerSide) return `A trade can have at most ${maxPerSide} ${maxPerSide === 1 ? "player" : "players"} a side here.`;
  const seen = new Set<string>();
  for (const id of [...give, ...get]) {
    if (seen.has(id)) return `${playerName(I, id)} is in the trade twice.`;
    seen.add(id);
  }
  // Active-roster players, and IR players too since Phase 4b (planner reply to Checkpoint 4, change 5; rule 5 places them);
  // taxi players still aren't tradable. Under irReturners false, Checkpoint 4's rule: active-roster players only.
  if (I.irOn) {
    for (const id of give) {
      if (me.roster.includes(id) || me.ir.includes(id)) continue;
      return me.team.taxi.includes(id) ? `${playerName(I, id)} is on your taxi squad: only active-roster and IR players can be traded here.` : `${playerName(I, id)} isn't on your active roster or IR.`;
    }
    for (const id of get) {
      if (partner.roster.includes(id) || partner.ir.includes(id)) continue;
      const name = teamName(I, partner.id);
      return partner.team.taxi.includes(id) ? `${playerName(I, id)} is on ${name}'s taxi squad: only active-roster and IR players can be traded here.` : `${playerName(I, id)} isn't on ${name}'s active roster or IR.`;
    }
    return null;
  }
  const reserve = (t: Team, id: string) => t.ir.includes(id) || t.taxi.includes(id);
  for (const id of give) {
    if (me.roster.includes(id)) continue;
    return reserve(me.team, id) ? `${playerName(I, id)} is on your IR or taxi squad: only active-roster players can be traded here.` : `${playerName(I, id)} isn't on your active roster.`;
  }
  for (const id of get) {
    if (partner.roster.includes(id)) continue;
    const name = teamName(I, partner.id);
    return reserve(partner.team, id) ? `${playerName(I, id)} is on ${name}'s IR or taxi squad: only active-roster players can be traded here.` : `${playerName(I, id)} isn't on ${name}'s active roster.`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Screening (M5)

export interface Screened {
  key: string;
  partnerId: string;
  give: string[];
  get: string[];
  /** myΔROS × quick P_accept. */
  objective: number;
  /** EV ROS(after) − EV ROS(V*(me)), lineup points. */
  myDelta: number;
  pQuick: number;
  gPartner: number;
}

/** The players P would receive (my side), as the context rule reads them. */
function receivedPlayers(I: TradeInternals, ids: readonly string[]): ReceivedPlayer[] {
  return ids.flatMap((id) => {
    const info = I.snapshot.players[id];
    return info ? [{ pos: info.pos, ...(info.age !== undefined ? { age: info.age } : {}) }] : [];
  });
}

/**
 * One roster's EV lineups as screening reads them: LV per week, and in the hole weeks (TradeInternals.holeIdx) the
 * seats and points (instance points, who starts). From a SolvedWeeks, or solved here without seats outside the hole
 * weeks (seats cost a canonical ordering per solve).
 */
interface EvLook {
  rows: readonly TableRow[];
  lv: Float64Array;
  /** Per hole week (holeIdx order): the seats and the points. */
  seats: Int32Array[];
  pts: Float64Array[];
}

function lookOf(I: TradeInternals, solved: SolvedWeeks): EvLook {
  return { rows: solved.team.rows, lv: solved.lv, seats: I.holeIdx.map((w) => solved.seat[w] as Int32Array), pts: I.holeIdx.map((w) => solved.pts[w] as Float64Array) };
}

/** EV lineups of a roster plus the team's streaming rows and returners (the optimizer's order), seats only in the hole weeks when `holes`. */
function quickLook(I: TradeInternals, roster: readonly string[], stream: StreamSpec, holes: boolean): EvLook {
  const rows: TableRow[] = [];
  for (const id of roster) {
    const row = I.league.table.rows.get(id);
    if (row) rows.push(row);
  }
  for (const r of stream.rows) rows.push(r);
  for (const r of returnersOf(stream)) rows.push(r);
  const prep = prepareRoster(rows, I.league.slots);
  const n = rows.length;
  const lv = new Float64Array(I.W);
  const pts = new Float64Array(n);
  const lo = holes && I.holeIdx.length ? (I.holeIdx[0] as number) : -1;
  const hi = holes && I.holeIdx.length ? (I.holeIdx[I.holeIdx.length - 1] as number) : -2;
  const seats: Int32Array[] = [];
  const holePts: Float64Array[] = [];
  for (let w = 0; w < I.W; w++) {
    for (let k = 0; k < n; k++) pts[k] = (rows[k] as TableRow).ev[w] as number;
    if (w >= lo && w <= hi) {
      const seat = new Int32Array(n);
      lv[w] = lineupTotal(prep, pts, null, seat);
      seats.push(seat);
      holePts.push(Float64Array.from(pts));
    } else {
      lv[w] = lineupTotal(prep, pts);
    }
  }
  return { rows, lv, seats, pts: holePts };
}

/**
 * The look of `base`'s roster minus `removed` plus `added`, exactly, solving only the weeks the trade can change: in a
 * week where every removed player sits on the bench and no added one's add bound on `base` is above 0
 * (teamValue.addUpperBoundWeeks), base's lineup stays the best one (removing bench players never changes an optimal
 * lineup, the bounds don't see bench players, and without starter limits newcomers who can't improve it alone can't
 * together either: their joint gain is at most the sum of their own). Under starter limits every week is solved. Rows:
 * base's players kept, the added players, then base's streaming rows.
 */
function swapLook(I: TradeInternals, base: SolvedWeeks, removed: readonly string[], added: readonly string[], holes: boolean): EvLook {
  const { rows, from, out, ubs } = swapRows(I, base, removed, added);
  const n = rows.length;
  const lv = new Float64Array(I.W);
  const pts = new Float64Array(n);
  const lo = holes && I.holeIdx.length ? (I.holeIdx[0] as number) : -1;
  const hi = holes && I.holeIdx.length ? (I.holeIdx[I.holeIdx.length - 1] as number) : -2;
  const seats: Int32Array[] = [];
  const holePts: Float64Array[] = [];
  let prep: ReturnType<typeof prepareRoster> | null = null;
  for (let w = 0; w < I.W; w++) {
    const hole = w >= lo && w <= hi;
    if (sameWeek(base, out, ubs, w)) {
      lv[w] = base.lv[w] as number;
      if (hole) {
        const seat = new Int32Array(n);
        const p = new Float64Array(n);
        const bs = base.seat[w] as Int32Array;
        for (let j = 0; j < n; j++) {
          const k = from[j] as number;
          seat[j] = k < 0 ? -1 : (bs[k] as number);
          p[j] = (rows[j] as TableRow).ev[w] as number;
        }
        seats.push(seat);
        holePts.push(p);
      }
      continue;
    }
    prep ??= prepareRoster(rows, I.league.slots);
    for (let k = 0; k < n; k++) pts[k] = (rows[k] as TableRow).ev[w] as number;
    if (hole) {
      const seat = new Int32Array(n);
      lv[w] = lineupTotal(prep, pts, null, seat);
      seats.push(seat);
      holePts.push(Float64Array.from(pts));
    } else {
      lv[w] = lineupTotal(prep, pts);
    }
  }
  return { rows, lv, seats, pts: holePts };
}

/**
 * swapLook's rows: base's players kept, the added players, base's streaming rows; base indexes (−1: added), removed
 * indexes, the added players' weekly add bounds (null under starter limits). Base's IR returners (rows after its streaming
 * rows) stay among the kept rows, before the added ones: the order changes no lineup value (lineup.ts seats and sums by
 * points, ties by id), and every reader finds rows by id.
 */
function swapRows(I: TradeInternals, base: SolvedWeeks, removed: readonly string[], added: readonly string[]): { rows: TableRow[]; from: number[]; out: number[]; ubs: Float64Array[] | null } {
  const baseRows = base.team.rows;
  const gone = new Set(removed);
  const kept: number[] = [];
  const out: number[] = [];
  const streamAt: number[] = [];
  baseRows.forEach((r, k) => {
    if (gone.has(r.id)) out.push(k);
    else if (isStreamId(r.id)) streamAt.push(k);
    else kept.push(k);
  });
  const addRows = added.flatMap((id) => I.league.table.rows.get(id) ?? []);
  const order = [...kept, -1, ...streamAt]; // −1 marks where the added rows go
  const rows: TableRow[] = [];
  /** New index → base index (−1 for an added row). */
  const from: number[] = [];
  for (const k of order) {
    if (k === -1) {
      for (const r of addRows) {
        rows.push(r);
        from.push(-1);
      }
    } else {
      rows.push(baseRows[k] as TableRow);
      from.push(k);
    }
  }
  const ubs = I.league.slots.limits !== null ? null : addRows.map((r) => addUpperBoundWeeks(base, r, I.league.maskOf(r)) as Float64Array);
  return { rows, from, out, ubs };
}

/** Whether week w keeps base's lineup (swapLook's rule): every removed player benched there, no added one's bound above 0. */
function sameWeek(base: SolvedWeeks, out: readonly number[], ubs: readonly Float64Array[] | null, w: number): boolean {
  if (ubs === null) return false;
  const seat = base.seat[w] as Int32Array;
  for (const k of out) if ((seat[k] as number) >= 0) return false;
  for (const ub of ubs) if ((ub[w] as number) > 0) return false;
  return true;
}

/**
 * swapLook's lineups in full (SolvedWeeks: every week's points and seats, the open slot groups), for legality's keep
 * values and free-agent picks: the weeks the trade can't change keep base's lineup (its seats, which stay an optimal
 * assignment), the others are solved.
 */
function swapSolve(I: TradeInternals, base: SolvedWeeks, removed: readonly string[], added: readonly string[]): SolvedWeeks {
  const { rows, from, out, ubs } = swapRows(I, base, removed, added);
  const n = rows.length;
  const W = I.W;
  const team = teamEval(rows, I.league.slots);
  const { groups } = team.prep.slots;
  const capacity = team.prep.slots.capacity;
  const lv = new Float64Array(W);
  const open = new Int32Array(W);
  const ptsAll = new Float64Array(W * n);
  const seatAll = new Int32Array(W * n);
  const pts: Float64Array[] = [];
  const seat: Int32Array[] = [];
  const fill = new Int32Array(groups.length);
  for (let w = 0; w < W; w++) {
    const p = ptsAll.subarray(w * n, (w + 1) * n);
    const st = seatAll.subarray(w * n, (w + 1) * n);
    for (let j = 0; j < n; j++) p[j] = (rows[j] as TableRow).ev[w] as number;
    if (sameWeek(base, out, ubs, w)) {
      lv[w] = base.lv[w] as number;
      const bs = base.seat[w] as Int32Array;
      for (let j = 0; j < n; j++) {
        const k = from[j] as number;
        st[j] = k < 0 ? -1 : (bs[k] as number);
      }
      open[w] = base.open[w] as number;
    } else {
      lv[w] = lineupTotal(team.prep, p, null, st);
      fill.fill(0);
      for (let j = 0; j < n; j++) {
        const g = st[j] as number;
        if (g >= 0) fill[g] = (fill[g] as number) + 1;
      }
      let free = 0;
      for (let g = 0; g < groups.length; g++) if ((fill[g] as number) < (capacity[g] as number)) free |= 1 << g;
      open[w] = free;
    }
    pts.push(p);
    seat.push(st);
  }
  return { team, lv, pts, seat, open, floors: new Map() };
}

/** Average instance points over the hole weeks of a look. */
function holeAverage(I: TradeInternals, look: EvLook): Float64Array {
  const size = I.instances.length;
  const out = new Float64Array(size);
  const buf = new Float64Array(size);
  const m = look.seats.length;
  if (!m) return out;
  for (let j = 0; j < m; j++) {
    instancePointsInto(I.league.index, look.seats[j] as Int32Array, look.pts[j] as Float64Array, null, look.rows.length, buf);
    for (let i = 0; i < size; i++) out[i] = (out[i] as number) + (buf[i] as number);
  }
  for (let i = 0; i < size; i++) out[i] = (out[i] as number) / m;
  return out;
}

/** The received players who start in at least one hole week (§11 h). */
function startersIn(I: TradeInternals, rows: readonly TableRow[], seats: readonly Int32Array[], received: readonly string[]): ReceivedStarter[] {
  const out: ReceivedStarter[] = [];
  for (const id of received) {
    const k = rows.findIndex((r) => r.id === id);
    if (k < 0 || !seats.some((seat) => (seat[k] as number) >= 0)) continue;
    const info = I.snapshot.players[id];
    out.push({ pos: info?.pos ?? (rows[k] as TableRow).pos, eligible: info?.eligible ?? (rows[k] as TableRow).eligible });
  }
  return out;
}

/** The received players who start in `solved`'s lineup in at least one hole week (§11 h). */
function receivedStarters(I: TradeInternals, solved: SolvedWeeks, received: readonly string[]): ReceivedStarter[] {
  return startersIn(
    I,
    solved.team.rows,
    I.holeIdx.map((w) => solved.seat[w] as Int32Array),
    received,
  );
}

function holeSlots(I: TradeInternals, before: Float64Array, after: Float64Array, medians: Float64Array): HoleSlot[] {
  return I.instances.map((inst, i) => ({ key: inst.key, eligible: I.slotEligible[i] ?? [], starter: before[i] as number, after: after[i] as number, median: medians[i] as number }));
}

/**
 * Screens one trade (M5; the file header): EV lineups, legality in EV mode from each side's V*(T), not re-optimized.
 * Null when a roster rule makes it illegal. Each side is priced as leanly as legality allows (legalSide): my side's EV
 * ROS alone, the partner's LV per week with seats in the hole weeks only.
 */
export function screenTrade(I: TradeInternals, partner: TeamState, give: readonly string[], get: readonly string[], key?: string): Screened | null {
  const me = I.me as TeamState;
  // Each side's legality adds skip the free agents the other teams claimed (its baseline exclusion excl(T): ⚠️ screening
  // is a filter, so the trade's own allocation order isn't followed here).
  const mine = legalSide(I, me, me.vstar.roster, give, get, "ev", "You", "ros", me.pool);
  if ("illegal" in mine) return null;
  const theirs = legalSide(I, partner, partner.vstar.roster, get, give, "ev", teamName(I, partner.id), "look", partner.pool);
  if ("illegal" in theirs) return null;
  const look = theirs.look as EvLook;
  const myDelta = (mine.ros as number) - me.baseEv.ros;
  // The partner's open-spot credit follows its own active roster (rule 5 placed the IR players: market.ts's header).
  const theirSpots = spotsOf(theirs, get, give);
  const gPartner = tradePackage({ players: give }, { players: get }, I.values, I.credit, config.market, theirSpots).g;
  const gPerceived = perceivedG(I, partner.id, give, get, gPartner, theirSpots);
  const delta = partnerLineupDelta(partner.baseEv.lv, look.lv, I.from);
  const h = holeFeature(holeSlots(I, partner.baseEv.hole, holeAverage(I, look), I.medians.ev), startersIn(I, look.rows, look.seats, give)).h;
  const profile = I.profiles.get(partner.id) as PartnerProfile;
  const pQuick = quickAcceptance({ leagueType: I.snapshot.settings.leagueType }, profile, {
    gPartner,
    gPerceived,
    deltaLineup: delta.blended,
    h,
    assets: give.length + get.length,
    partnerReceives: receivedPlayers(I, give),
  });
  return {
    key: key ?? proposalKey({ partnerId: partner.id, give: players(give), get: players(get) }),
    partnerId: partner.id,
    give: [...give],
    get: [...get],
    objective: myDelta * pQuick,
    myDelta,
    pQuick,
    gPartner,
  };
}

// ---------------------------------------------------------------------------------------------
// Exact evaluation (M3)

/**
 * X for a trade with `partner` (the file header, "One free agent, one team"): the free agents every team but me and the
 * partner claimed; FULL_POOL under faAllocation "independent". Memoized per partner.
 */
export function othersPool(I: TradeInternals, partner: TeamState): PoolRestriction {
  let pool = I.othersPool.get(partner.id);
  if (!pool) {
    const me = I.me;
    pool = I.league.allocation ? poolRestriction(I.teams.flatMap((t) => (t === me || t === partner ? [] : t.claimed))) : FULL_POOL;
    I.othersPool.set(partner.id, pool);
  }
  return pool;
}

/**
 * Whether a team that makes pickups sits strictly between allocation places `a` and `b` (TeamState.claimRank): one that
 * isn't inactive (league.ts step 5, A4: an inactive team claims nobody, so a pickup released between the two never goes to
 * it). Every team with a place counts (me and the partner hold `a` and `b` themselves).
 */
function betweenActive(I: Pick<TradeInternals, "teams">, a: number, b: number): boolean {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return I.teams.some((t) => t.claimRank !== null && t.claimRank > lo && t.claimRank < hi && !t.inactive);
}

/** Both sides of a trade after legality, and each one's free-agent-optimized roster V*(after) (tradeSides). */
export interface TradeSidesAfter {
  mineLegal: LegalSide;
  theirLegal: LegalSide;
  mine: OptimizedRoster;
  theirs: OptimizedRoster;
  /** The side that went first: the earlier of the two in the allocation order ("me" under faAllocation "independent"). */
  first: "me" | "partner";
  /**
   * The pool each side's legality adds and V*(after) drew from (the second one's excludes what the first one added and,
   * with a team between them in the order, the first one's baseline pickups).
   */
  pools: { mine: PoolRestriction; theirs: PoolRestriction };
  /** Each side's spec after the trade (LegalSide.spec: its streaming rows and the returners of its IR after the trade), which its V*(after) ran with. */
  specs: { mine: StreamSpec; theirs: StreamSpec };
}

/**
 * Both sides of a trade in the exact mode (the file header, "Exact evaluation" and "One free agent, one team"): the earlier
 * of me and the partner in the allocation order goes first, its legality adds (rules 3–4) and its V*(after) from the pool
 * minus X (othersPool); then the other one's, from the pool minus X minus every free agent the first one added here
 * (legality's adds and every add of its V*(after) run: league.claimedBy) and, ⚠️ when a team that makes pickups sits between
 * the two in the order (betweenActive: an inactive one claims nobody), minus the first one's baseline pickups
 * (TeamState.claimed) too: one it gives up after the trade would go to that team first, which keeps its baseline, so nobody
 * adds him; with no such team between them the other one is next in line. An inactive side (A4) makes no V*(after) move and
 * no rule-4 add. Without an allocation (faAllocation "independent"), mine first and both from the whole pool: Checkpoint
 * 4's rule. `{ illegal }` when a side's roster rules make it illegal (the first side's reason when both are).
 */
export function tradeSides(I: TradeInternals, me: TeamState, partner: TeamState, give: readonly string[], get: readonly string[], partnerName: string): TradeSidesAfter | { illegal: string } {
  const optimizer = I.league.optimizer;
  const allocated = I.league.allocation !== null;
  const partnerFirst = allocated && me.claimRank !== null && partner.claimRank !== null && partner.claimRank < me.claimRank;
  // Whether some team that makes pickups sits between the two in the allocation order (an unknown place counts as one: the
  // cautious reading). ⚠️ An inactive team (A4) between them claims nobody, so it doesn't count (ours).
  const between = me.claimRank === null || partner.claimRank === null || betweenActive(I, me.claimRank, partner.claimRank);
  const sides = [
    { team: me, given: give, received: get, who: "You" },
    { team: partner, given: get, received: give, who: partnerName },
  ] as const;
  const legal: LegalSide[] = [];
  const runs: OptimizedRoster[] = [];
  const pools: PoolRestriction[] = [];
  let pool = othersPool(I, partner);
  for (const k of partnerFirst ? [1, 0] : [0, 1]) {
    const s = sides[k as 0 | 1];
    const l = legalSide(I, s.team, s.team.roster, s.given, s.received, "exact", s.who, "none", pool);
    if ("illegal" in l) return { illegal: l.illegal };
    // With the side's IR after the trade: a returner given away leaves its lineups, one received joins them. An inactive
    // side (A4) makes no free-agent move after the trade either. V*(after) never drops a legality add (the optimizer's keep
    // set; planner reply to Checkpoint 7b, section 5: the card names rule 4's fill, so the evaluated roster holds him),
    // but under openSpotFill "bestAny" (Checkpoint 7b's rule, for the trade report).
    const keep = I.openSpotFill === "bestAny" ? [] : l.change.adds;
    const run = s.team.inactive ? optimizer.optimize(l.roster, l.spec, 0) : optimizer.optimize(l.roster, l.spec, undefined, pool, keep);
    legal[k] = l;
    runs[k] = run;
    pools[k] = pool;
    // The second side may not add what the first one added here, nor, ⚠️ with a team between them in the order, the first
    // one's baseline pickups, even one it no longer wants after the trade (that team would claim him first). With none
    // between, every team ahead of the first one passed on such a player in the baseline: the second side is next in line.
    if (allocated) pool = poolRestriction([...pool.excluded, ...(between ? s.team.claimed : []), ...l.change.adds, ...claimedBy(run)]);
  }
  return {
    mineLegal: legal[0] as LegalSide,
    theirLegal: legal[1] as LegalSide,
    mine: runs[0] as OptimizedRoster,
    theirs: runs[1] as OptimizedRoster,
    first: partnerFirst ? "partner" : "me",
    pools: { mine: pools[0] as PoolRestriction, theirs: pools[1] as PoolRestriction },
    specs: { mine: (legal[0] as LegalSide).spec, theirs: (legal[1] as LegalSide).spec },
  };
}

/**
 * A side's forced roster moves on the card (TradeEvaluation.required; tradeModel.ts RosterChange): legality's drops and
 * adds (rules 1–4), with `openSpots`, rule 4's fills of the roster spots the trade opened and the position each one fills
 * (Phase 7c, planner reply to Checkpoint 7b, section 5); `toIR`, the received IR players rule 5 put into its open IR slots
 * (LegalSide.toIR); and `displaced`, the roster spot a returner needs from his week (returners.finalLineups) on its final
 * evaluation after the trade (SideEval.displaced after V*(after); `week` the NFL week from which the drop counts) that its
 * baseline at V*(T) doesn't have. ⚠️ Ours (final review of Phase 4b): a displacement the baseline has too (the same player
 * from the same week for the same returner) isn't the trade's move, and B doesn't count it (both sides of the comparison
 * have it): on Parker's league, Oct 3, my own IR WR displaces a bench WR from week 7 in the baseline, so every card would
 * repeat it. `openSpots`, `toIR` and `displaced` are present only when not empty ("absent or empty: none"). `mine`: on the
 * partner's side when it claims before me (TradeSidesAfter.first), my own baseline pickups, so a fill that takes one is
 * marked (OpenSpot.yours; review of Phase 7c's fill, finding pickups-4).
 */
export function rosterChangeOf(I: TradeInternals, legal: Pick<LegalSide, "change" | "toIR">, after: Pick<SideEval, "displaced">, side: Pick<TeamState, "base">, faMoves?: RosterChange["faMoves"], mine: readonly string[] = []): RosterChange {
  const weeks = I.league.lp.weeks.weeks;
  const key = (d: Displacement) => `${d.id}\u0004${d.from}\u0004${d.returner}`;
  const before = new Set(side.base.displaced.map(key));
  const displaced = after.displaced.flatMap((d) => {
    const week = weeks[d.from];
    return before.has(key(d)) || week === undefined ? [] : [{ playerId: d.id, week, returner: d.returner }];
  });
  const spots = legal.change.openSpots ?? [];
  const yours = new Set(mine);
  return {
    drops: [...legal.change.drops],
    adds: [...legal.change.adds],
    ...(spots.length
      ? { openSpots: spots.map((s) => ({ playerId: s.playerId, pos: s.pos, ...(s.short?.length ? { short: [...s.short] } : {}), ...(yours.has(s.playerId) ? { yours: true as const } : {}) })) }
      : {}),
    ...(legal.toIR.length ? { toIR: [...legal.toIR] } : {}),
    ...(displaced.length ? { displaced } : {}),
    ...(faMoves && (faMoves.adds.length || faMoves.drops.length) ? { faMoves } : {}),
  };
}

/**
 * A side's free-agent moves after a trade that its baseline doesn't make (RosterChange.faMoves; final review of Phase 4c,
 * finding R1: on Parker's league, Oct 4 09:24Z, Bo Nix → Jadarian Price left my QB slot empty in Josh Allen's week-7 bye,
 * so my V*(after) picked up Malik Willis and cut Kyle Monangai, worth [value], a move the card didn't name and the market term
 * didn't count). Set differences of the two optimizer runs, so the order of their steps doesn't matter: `adds`, the free
 * agents `after` ends with that it didn't start with and `base` (V*(T)) didn't pick up either; `drops`, the players
 * `after` started with and dropped that `base` didn't drop; `kept`, the players `base` drops who are still on `after`'s
 * roster (traded away or dropped by legality, a player isn't kept); `room` (verification of the final review, finding
 * VF-1: "you'd drop Kyle Monangai" alone gave no reason), the pickups on `after`'s roster that `base` makes too and whose
 * spot one of `drops` opened, through `after`'s moves (a pickup later swapped for another passes the spot on), so the card
 * can say whom a drop without a pickup of its own makes room for. Each list in its run's roster order.
 */
export function freeAgentMovesOf(base: Pick<OptimizedRoster, "start" | "roster">, after: Pick<OptimizedRoster, "start" | "roster"> & { readonly moves?: OptimizedRoster["moves"] }): { adds: string[]; drops: string[]; kept: string[]; room: string[] } {
  const baseStart = new Set(base.start);
  const baseEnd = new Set(base.roster);
  const afterStart = new Set(after.start);
  const afterEnd = new Set(after.roster);
  const baseDrops = base.start.filter((id) => !baseEnd.has(id));
  const baseAdds = new Set(base.roster.filter((id) => !baseStart.has(id)));
  const dropped = new Set(baseDrops);
  const adds = after.roster.filter((id) => !afterStart.has(id) && !baseAdds.has(id));
  const drops = after.start.filter((id) => !afterEnd.has(id) && !dropped.has(id));
  // Whose spot each pickup holds: the player its move dropped (null: an open spot), passed on through swaps of pickups.
  const spotOf = new Map<string, string | null>();
  for (const m of after.moves ?? []) {
    if (m.drop !== null && spotOf.has(m.drop)) {
      spotOf.set(m.add, spotOf.get(m.drop) ?? null);
      spotOf.delete(m.drop);
    } else spotOf.set(m.add, m.drop);
  }
  const dropSet = new Set(drops);
  return {
    adds,
    drops,
    kept: baseDrops.filter((id) => afterEnd.has(id)),
    room: after.roster.filter((id) => baseAdds.has(id) && !afterStart.has(id) && dropSet.has(spotOf.get(id) ?? "")),
  };
}

/**
 * Whether the card names a side's free-agent moves (RosterChange.faMoves): a pickup the baseline doesn't make, or a drop
 * of a player worth more than the waiver credit W (his value is the market term's cost). ⚠️ Ours: a drop swap alone
 * between bench players worth at most W (the baseline's pickup made dropping Rico Dowdle rather than Marvin Harrison Jr.,
 * both worth at most W on Parker's league) moves no trade value and the lineup by a hair, so the card doesn't say it; the
 * market term reads every move either way (such a player counts W, as the roster spot he stands for would).
 */
function faShown(I: Pick<TradeInternals, "values" | "credit">, fa: { adds: readonly string[]; drops: readonly string[] }): boolean {
  return fa.adds.length > 0 || fa.drops.some((id) => (I.values[id] ?? 0) > I.credit);
}

/**
 * The NFL weeks each player of `ids` starts in a side's expected-value lineups (SideEval.ev, finally priced), among the
 * weeks team numbers count (weight above 0), in week order: RosterChange.faMoves' `starts`.
 */
function startWeeksOf(I: TradeInternals, ev: SolvedWeeks, ids: readonly string[]): Record<string, number[]> {
  const weeks = I.league.lp.weeks.weeks;
  const out: Record<string, number[]> = {};
  for (const id of ids) {
    const k = ev.team.rows.findIndex((r) => r.id === id);
    out[id] = k < 0 ? [] : weeks.flatMap((week, w) => ((I.weights[w] as number) > 0 && ((ev.seat[w] as Int32Array)[k] as number) >= 0 ? [week] : []));
  }
  return out;
}

/** An exactly evaluated trade with what its simulation needs. */
export interface ExactTrade {
  evaluation: TradeEvaluationCore;
  partner: TeamState;
  mine: SideEval;
  theirs: SideEval;
  /** ΔDyn and MyDynTotal (dynasty and keeper leagues with long-term values), else null. */
  dynasty: { delta: number; total: number } | null;
  /**
   * Checkpoint 7c ("Helps them"'s B_future,P): the partner's ΔDyn_P, the trade's own long-term package from its side
   * (tradePackage on the long-term values and W with its own roster spots: ⚠️ none of its free-agent moves, as gPartner), and
   * its roster's long-term value (TradeInternals.future.totals); null without long-term values or in a redraft league.
   */
  partnerDynasty: { delta: number; total: number } | null;
}

/**
 * Exact evaluation of a proposal (M3; the file header): legality in the exact mode, V* on both sides, the exact-mode
 * lineups, acceptance with hot and urg, and the card's numbers that don't need the simulation (stage "exact", B null).
 * `{ illegal }` when the proposal or a roster rule makes it illegal.
 */
export function evaluateExact(I: TradeInternals, proposal: TradeProposal, maxPerSide: number): ExactTrade | { illegal: string } {
  const problem = proposalProblem(I, proposal, maxPerSide);
  if (problem) return { illegal: problem };
  const me = I.me as TeamState;
  const partner = I.byId.get(proposal.partnerId) as TeamState;
  const give = playerIds(proposal.give);
  const get = playerIds(proposal.get);
  const partnerName = teamName(I, partner.id);
  const after = tradeSides(I, me, partner, give, get, partnerName);
  if ("illegal" in after) return after;
  const { mineLegal, theirLegal } = after;
  const mine = sideEval(I, me, after.mine, after.specs.mine);
  const theirs = sideEval(I, partner, after.theirs, after.specs.theirs);
  const weeks = I.league.lp.weeks.weeks;

  const dPPW = ppw(mine.lv, weeks, I.regWeeks) - ppw(me.base.lv, weeks, I.regWeeks);
  const dPPWPlayoffs = ppw(mine.lv, weeks, I.poWeeks) - ppw(me.base.lv, weeks, I.poWeeks);
  // The depth cover (TradeDetail.depthCover): the part of ΔPPW, scenario lineups, that the same rosters' EV lineups don't
  // see (both finally priced: SideEval.ev); only with scenarios.
  const depthCover = I.S > 0 ? dPPW - (ppw(mine.ev.lv, weeks, I.regWeeks) - ppw(me.base.ev.lv, weeks, I.regWeeks)) : null;
  const delta = partnerLineupDelta(partner.base.lv, theirs.lv, I.from);
  const hole = holeFeature(holeSlots(I, partner.base.hole, theirs.hole, I.medians.exact), receivedStarters(I, theirs.ev, give));
  // Each side's open-spot credit follows its own active roster after rule 5 (an IR slot isn't a roster spot: market.ts's
  // header), so with an IR player in the trade my package and the partner's needn't mirror each other.
  const mySpots = spotsOf(mineLegal, give, get);
  const theirSpots = spotsOf(theirLegal, get, give);
  // My free-agent moves after the trade that my baseline doesn't make (the file header, "Exact evaluation"; final review of
  // Phase 4c, finding R1) join my package: each pickup as received, each drop as given, each with an active roster spot
  // (a player received and dropped at once leaves both). The partner's package is the trade's alone.
  const fa = freeAgentMovesOf(me.vstar, after.mine);
  const both = new Set(fa.drops.filter((id) => get.includes(id)));
  const myRecv = [...get.filter((id) => !both.has(id)), ...fa.adds];
  const myGive = [...give, ...fa.drops.filter((id) => !both.has(id))];
  const myPkgSpots: ActiveSpots = { ...mySpots, recv: mySpots.recv - both.size + fa.adds.length, give: mySpots.give + fa.drops.length - both.size };
  const myPkg = tradePackage({ players: myRecv }, { players: myGive }, I.values, I.credit, config.market, myPkgSpots);
  const gPartner = tradePackage({ players: give }, { players: get }, I.values, I.credit, config.market, theirSpots).g;
  // The partner's g as it perceives it (the star premium on what it gives): the g feature only; the veto reads gPartner.
  const gPerceived = perceivedG(I, partner.id, give, get, gPartner, theirSpots);
  const rosOf = (ids: readonly string[]) => ids.reduce((s, id) => s + (I.league.lp.players[id]?.ros.total ?? 0), 0);
  const profile = I.profiles.get(partner.id) as PartnerProfile;
  const hot = hotTerm(give, get, I.hot);
  const accept = acceptance(
    { leagueType: I.snapshot.settings.leagueType, tradeReview: I.snapshot.settings.tradeReview },
    profile,
    { gPartner, gPerceived, deltaLineup: delta.blended, h: hole.h, assets: give.length + get.length, partnerReceives: receivedPlayers(I, give), hot, urg: I.urg },
  );
  const f = I.future;
  // ΔDyn (§10): my long-term package change, each player at max(v, W) on the future term's values and W like every
  // package (planner reply to Checkpoint 4, change 4): a player worth less than W, the best free agent no team is predicted
  // to claim (A3), is replaceable, and V*(me) already counts that, so dumping him is no long-term gain either. MyDynTotal
  // stays raw (rosterValue).
  const dynasty = f && I.snapshot.settings.leagueType !== "redraft" ? (() => {
    const pkg = tradePackage({ players: myRecv }, { players: myGive }, f.values, f.credit, config.market, myPkgSpots);
    return { delta: pkg.recv - pkg.give, total: f.myTotal };
  })() : null;
  // The partner's (Checkpoint 7c, "Helps them"'s B_future,P): the trade's own package from its side, as gPartner reads it.
  const partnerDynasty = f && I.snapshot.settings.leagueType !== "redraft" ? (() => {
    const pkg = tradePackage({ players: give }, { players: get }, f.values, f.credit, config.market, theirSpots);
    return { delta: pkg.recv - pkg.give, total: f.totals[partner.id] ?? 0 };
  })() : null;

  const partnerRanks = I.ranks.get(partner.id) as Int32Array;
  const slotChanges = (before: Float64Array, after: Float64Array): SlotChange[] => I.instances.map((inst, i) => ({ key: inst.key, before: before[i] as number, after: after[i] as number }));
  const notes: string[] = [];
  if (I.inProgress && I.model.inProgressWeek !== null) notes.push(`Week ${I.model.inProgressWeek} is under way: these odds play it with today's rosters, before and after the trade.`);
  if (I.snapshot.settings.leagueType === "keeper") notes.push("Keeper costs aren't modeled.");
  const detail: TradeDetail = {
    myTeamId: me.id,
    mySlots: slotChanges(me.base.regular, mine.regular),
    partnerSlots: slotChanges(partner.base.regular, theirs.regular).map((s, i) => ({ ...s, rank: partnerRanks[i] as number })),
    teams: I.snapshot.teams.length,
    holes: hole.holes,
    holesFilled: hole.filled,
    terms: accept.terms,
    vetoRisk: accept.vetoRisk,
    activity: profile.activity,
    history: { trades: profile.history.trades, average: profile.history.average },
    context: accept.context,
    hotReceived: give.filter((id) => I.hot.has(id)),
    hotGiven: get.filter((id) => I.hot.has(id)),
    urgency: I.urg,
    weekly: weeks.map((week, w) => ({ week, before: me.base.score.mean[w] as number, after: mine.score.mean[w] as number })),
    riskyWeeks: [...I.riskyWeeks],
    notes,
    // One fact per player the partner gives (e may be 0).
    premium: premiumFacts(get, I.premiums.get(partner.id)),
    ...(depthCover !== null ? { depthCover } : {}),
  };
  const gMine = myPkg.g;
  const injured = injuredReceived(get, I.snapshot.players);
  const faMovesShown = faShown(I, fa) ? { adds: fa.adds, drops: fa.drops, kept: fa.kept, starts: startWeeksOf(I, mine.ev, fa.adds), ...(fa.room.length ? { room: fa.room } : {}) } : undefined;
  const evaluation: TradeEvaluationCore = {
    key: proposalKey(proposal),
    proposal: { partnerId: partner.id, give: players(give), get: players(get) },
    illegal: null,
    stage: "exact",
    sims: 0,
    required: {
      me: rosterChangeOf(I, mineLegal, mine, me, faMovesShown),
      // A partner that claims before me can fill its spot with one of my own baseline pickups (OpenSpot.yours).
      partner: rosterChangeOf(I, theirLegal, theirs, partner, undefined, after.first === "partner" ? baselinePickups(me) : []),
    },
    b: null,
    tradeScore: null,
    pAccept: accept.pAccept,
    pComplete: accept.pComplete,
    acceptLabel: accept.label,
    overall: null,
    b3: null,
    dPO: null,
    dCH: null,
    dEW: null,
    dPPW,
    dPPWPlayoffs,
    bWin: null,
    bFuture: null,
    lambda: null,
    marketWeekly: null,
    dDyn: null,
    dynMissing: false,
    value: { given: myPkg.give, received: myPkg.recv },
    gMine,
    gPartner,
    ros: { given: rosOf(give), received: rosOf(get) },
    partnerDeltaLineup: delta.blended,
    features: accept.features,
    flags: tradeFlags({ gMine, b: null, injured }),
    detail,
  };
  return { evaluation, partner, mine, theirs, dynasty, partnerDynasty };
}

// ---------------------------------------------------------------------------------------------
// The simulation (M4)

/**
 * My odds with my team's and `partner`'s score rows replaced (null rows: the baseline's), `sims` seasons on the shared
 * matrix, and (Checkpoint 7c, "Helps them") every team's from the same run (MyOdds.teams, by the same rules: mine are its
 * entry for my team). P(title) is null when the league's title odds are unknown (season.ts's rules), and P(2nd) with it;
 * P(3rd) also when the 3rd-place game can't be known (season.ts seasonOdds' rules, Checkpoint 7c).
 */
function runSim(I: TradeInternals, mine: SideEval | null, theirs: { partner: TeamState; side: SideEval } | null, stage: SimStage): MyOdds {
  const sim = I.sim as SimState;
  const me = I.me as TeamState;
  const { setup, simWeekToModelWeek } = sim.built;
  // The high scores the context's reward pays must be in the setup (SimState.highScores), or every team reads 0 of them and B
  // leaves the weekly prize out with no word (the review of the reward engine, RW-1).
  if (sim.highScores && setup.highScorePeriods === undefined) throw new Error("This trade context's simulation doesn't list the weekly high scores its reward pays.");
  const rowsOf = (score: WeeklyScore) => ({ mean: Float64Array.from(simWeekToModelWeek, (k) => score.mean[k] as number), sd: Float64Array.from(simWeekToModelWeek, (k) => score.sd[k] as number) });
  const mean = [...setup.mean];
  const sd = [...setup.sd];
  if (mine) {
    const r = rowsOf(mine.score);
    mean[me.index] = r.mean;
    sd[me.index] = r.sd;
  }
  if (theirs) {
    const r = rowsOf(theirs.side.score);
    mean[theirs.partner.index] = r.mean;
    sd[theirs.partner.index] = r.sd;
  }
  const normals = sim.blocks[stage];
  const res = simulateSeason({ ...setup, mean, sd }, { sims: normals.sims, seed: sim.seed, normals });
  const playoffsKnown = sim.built.playoffsKnown && res.playoffsKnown;
  const known = (x: number | undefined, ok: boolean): number | null => (ok && x !== undefined && Number.isFinite(x) ? x : null);
  // One team's odds from this run (absent: a team the run doesn't list, read as nothing).
  const oddsOf = (o: SimTeamOdds | undefined): RunOdds => {
    const titleKnown = playoffsKnown && o !== undefined && Number.isFinite(o.pTitle);
    const prizes: PrizeOdds = {
      first: titleKnown ? (o as { pTitle: number }).pTitle : null,
      second: known(o?.pSecond, playoffsKnown),
      third: known(o?.pThird, playoffsKnown && res.thirdKnown),
      weeklyHigh: o?.expHighScores ?? 0,
      pointsLeader: o?.pPointsLeader ?? 0,
    };
    return { pPlayoffs: o?.pPlayoffs ?? 0, pTitle: titleKnown ? (o as { pTitle: number }).pTitle : null, expWins: o?.expWins ?? 0, prizes };
  };
  const teams = res.teams.map((o) => oddsOf(o));
  // My head-to-head win chance per listed week (sim.ts: NaN without a game that week, here null). None in a points-only
  // league: sim.ts still plays its scheduled games (points against), but they don't change the standings (the file header).
  const weekly = setup.pointsOnly
    ? []
    : res.weekly.map((wk) => {
        const p = wk.pWin[me.index];
        return { week: wk.week, pWin: p !== undefined && Number.isFinite(p) ? p : null };
      });
  return { ...(teams[me.index] ?? oddsOf(undefined)), weekly, teams };
}

/**
 * TradeDetail.winChance (the file header, "The simulation"): my head-to-head win chance before (the baseline run on the
 * block) and after (the trade's run on it), per week sim.ts lists in order (a game's first drawn week); a week without a
 * game with an opponent in either run is left out, and so is every week of a points-only league (runSim lists none). The
 * two runs share the setup, so their weeks and games are the same.
 */
export function winChanceOf(before: Pick<MyOdds, "weekly">, after: Pick<MyOdds, "weekly">): NonNullable<TradeDetail["winChance"]> {
  const out: NonNullable<TradeDetail["winChance"]> = [];
  for (const b of before.weekly) {
    const a = after.weekly.find((x) => x.week === b.week)?.pWin ?? null;
    if (b.pWin === null && a === null) continue;
    out.push({ week: b.week, before: b.pWin, after: a });
  }
  return out;
}

/** Seasons simulated at each stage (config.simulation). */
export function simCounts(): { screen: number; final: number } {
  return { screen: Math.max(1, Math.floor(config.simulation.screeningSims)), final: Math.max(1, Math.floor(config.simulation.finalSims)) };
}

/**
 * The reward a call's settings give (reward.ts rewardOf; Checkpoint 7c): the context's own (LeagueContext.reward, its League
 * model's) when their goal and prizes are the context's, else made from them on this league.
 */
export function rewardFor(I: Pick<TradeInternals, "league" | "snapshot">, s: Pick<TradeSettings, "goal" | "prizes">): Reward {
  const own = I.league.settings;
  if (s.goal === own.goal && PRIZE_KEYS.every((k) => Object.is(s.prizes[k], own.prizes[k]))) return I.league.reward;
  return rewardOf(s, I.snapshot);
}

/**
 * The reward a call is scored under: `reward`, else the context's (LeagueContext.reward). ⚠️ One that pays the weekly high
 * score on a context whose simulation doesn't list them (SimState.highScores: the context's own reward doesn't pay them) is
 * refused with an Error: its prize components would read 0 high scores for everyone, a silent wrong B. Build the context
 * with that reward's settings (its ω is that reward's too); the app's contexts and calls always share theirs.
 */
function rewardOn(I: Pick<TradeInternals, "sim" | "league">, reward?: Reward | null): Reward {
  const r = reward ?? I.league.reward;
  if (paysWeekly(r) && I.sim && !I.sim.highScores) throw new Error("This trade context didn't simulate the weekly high scores its reward pays: build it with that reward's settings.");
  return r;
}

/**
 * B₃ for a call's reward and λ (planner reply to Checkpoint 4c, A2; benefit.ts's header, the three numbers): the context's
 * calibration run (SimState.calibration, the League model's step 8c on the final block) through benefit.helpsScale with my
 * baseline P(playoffs) (the default λ, as for every trade) and, in dynasty and keeper leagues whose long-term values loaded,
 * MyDynTotal (B₃ = B_ref(λ) = (1 − λ) × B_win₃ + λ × F₁₀: planner reply to Checkpoint 7a, §2 question 6). The same for every
 * stage (screening, final, steps, Plan B, the Analyzer): one scale per search, which B's redraft market term is priced on too
 * (simulateTrade). `reward` absent: the context's (rewardOn). Null without odds or my team.
 */
export function helpsScaleOf(I: Pick<TradeInternals, "sim" | "me" | "snapshot" | "future" | "league">, lambda: number | null, reward?: Reward | null): HelpsScale | null {
  if (!I.sim || !I.me) return null;
  const leagueType = I.snapshot.settings.leagueType;
  const dynastyTotal = I.future && leagueType !== "redraft" ? I.future.myTotal : null;
  return helpsScale(I.sim.calibration, { leagueType, myPPlayoffs: I.sim.base.final.pPlayoffs, lambda, reward: rewardOn(I, reward), dynastyTotal });
}

/**
 * A partner's calibration run for "Helps them" (Checkpoint 7c; planner reply to Checkpoint 7b, §7: "B₃,P = the B of +3
 * points a week for that partner, on the same baseline with the same common random numbers"): league.ts helpsCalibrationOf
 * with its team id, on the context's final block against its baseline (SimState.odds, LeagueModel.odds: the run behind
 * SimState.calibration, the partner's score + 3 a week in place of mine), memoized per context (SimState.partners). ⚠️ In the
 * trade context, not the League model (the lead's call): the planner's "once per league model build" read as once per trade
 * context, which builds its own League model, since the League page never shows Helps them and every League model build would
 * otherwise pay one run per team (about 12 ms each on Parker's league). Null without odds, for a team the odds don't list, and
 * (⚠️ ours) when the simulator refuses the run (a RangeError: Helps them is then unknown for that partner rather than the
 * search failing, as a refused baseline gives no odds).
 */
export function partnerCalibrationOf(I: Pick<TradeInternals, "sim" | "snapshot" | "from">, teamId: string): HelpsCalibration | null {
  const sim = I.sim;
  if (!sim) return null;
  const known = sim.partners.get(teamId);
  if (known !== undefined) return known;
  let run: HelpsCalibration | null = null;
  try {
    run = helpsCalibrationOf(I.snapshot, sim.season, teamId, sim.odds, { sims: sim.blocks.final.sims, seed: sim.seed, normals: sim.blocks.final, highScores: sim.highScores }, I.from);
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
  }
  sim.partners.set(teamId, run);
  return run;
}

/**
 * "Helps them"'s scale for a partner and a call's reward (Checkpoint 7c; benefit.ts partnerScale): the partner's calibration
 * run (partnerCalibrationOf), its baseline P(playoffs) on the final block (LeagueModel.odds, the number its acceptance
 * profile reads: λ_P's default, never the user's slider) and, in dynasty and keeper leagues whose long-term values loaded, its
 * roster's long-term value (TradeInternals.future.totals). The same for every stage (the screening and final simulations,
 * the steps' versions, the Analyzer), as mine is: one scale per partner and reward. Null without odds or a run.
 */
export function partnerScaleOf(I: Pick<TradeInternals, "sim" | "snapshot" | "future" | "league" | "from">, partner: Pick<TeamState, "id" | "index">, reward?: Reward | null): PartnerScale | null {
  if (!I.sim) return null;
  const leagueType = I.snapshot.settings.leagueType;
  const dynastyTotal = I.future && leagueType !== "redraft" ? (I.future.totals[partner.id] ?? null) : null;
  const pPlayoffs = I.sim.odds.teams[partner.index]?.pPlayoffs ?? null;
  return partnerScale(partnerCalibrationOf(I, partner.id), { leagueType, pPlayoffs, reward: rewardOn(I, reward), dynastyTotal });
}

/**
 * The partner's side of a trade's runs ("Helps them"; Checkpoint 7c, planner reply to Checkpoint 7b, §7; TradeEvaluation.them):
 * its changes from `before` (the block's baseline) to `after` (the trade's run, my row and its own replaced), B_P
 * (benefit.ts partnerBenefit: the call's reward, no trade-value term, λ_P by its final-block baseline P(playoffs), B_future,P
 * from the trade's own long-term package: ExactTrade.partnerDynasty), B_ref,P (partnerScaleOf) and Helps them as printed
 * (helpsThemScore).
 */
function partnerNumbersOf(I: TradeInternals, x: ExactTrade, reward: Reward, before: RunOdds, after: RunOdds): PartnerNumbers {
  const sim = I.sim as SimState;
  const dPO = after.pPlayoffs - before.pPlayoffs;
  const dCH = after.pTitle !== null && before.pTitle !== null ? after.pTitle - before.pTitle : null;
  // The weekly high scores' change only when this context simulated them (reward.ts runPrizeDeltas), as mine.
  const dPrizes = runPrizeDeltas(before.prizes, after.prizes, sim.highScores);
  const pPlayoffs = sim.odds.teams[x.partner.index]?.pPlayoffs ?? null;
  const b = partnerBenefit({ leagueType: I.snapshot.settings.leagueType, dPO, dCH, dPrizes, dynasty: x.partnerDynasty, pPlayoffs, reward });
  const b3 = partnerScaleOf(I, x.partner, reward)?.b3 ?? null;
  return {
    b: b.b,
    bWin: b.bWin,
    bFuture: b.bFuture,
    lambda: b.lambda,
    b3,
    helps: helpsThemScore(b.b, b3),
    dPO,
    dCH,
    dPrizes,
    before: { pPlayoffs: before.pPlayoffs, pTitle: before.pTitle, prizes: { ...before.prizes } },
  };
}

/**
 * The trade's season simulation (M4) on the `stage` block of seasons (screening or final), and every number that follows
 * from it: ΔPO, ΔCH, ΔEW, every prize component's change (TradeEvaluation.dPrizes; Checkpoint 7c), my win chance by week
 * before and after (TradeDetail.winChance, winChanceOf: the baseline and the trade's run on that block; empty in a points-only
 * league), B₃ for the reward and λ (helpsScaleOf; TradeEvaluation.b3), B and
 * its parts (benefit, with λ = the setting or the default by my finalSims baseline P(playoffs), κ = the "Protect my trade
 * value" level's: benefit.protectValueWeight, points a week per 100% of trade value, or 0 when the values are our own
 * estimates (valuesEstimated) or missing (valuesMissing), the market term priced on that B₃: planner reply to Checkpoint 7a,
 * §2 question 5, TradeEvaluation.marketWeekly; and B_win's weights and prize shares by the reward: the goal and prizes), the
 * Trade Score and Overall on the same B₃, the flags, and benefitNotes (and helpsScaleNotes, estimatedValuesNotes,
 * missingValuesNotes) in the detail's notes. The one place a B is made (the search's screening and final simulations, the
 * steps' versions, Plan B's candidates, the Analyzer), so every B reads the B₃ its scores read. Checkpoint 7c (planner reply
 * to Checkpoint 7b, §7): from the same two runs, the partner's side (TradeEvaluation.them, partnerNumbersOf: its changes, B_P
 * under the same reward, B_ref,P and Helps them), with no run of its own but the partner's calibration the first time
 * (partnerCalibrationOf).
 * Without odds (the context's note), B stays null and winChance and `them` absent. `protectValue` and `reward` are the user's
 * per-call settings (TradeSettings.protectValue; the goal and prizes' reward, rewardFor); absent, the context's (the search
 * and the Analyzer always pass theirs: a cached context may hold older settings, and protectValue doesn't rebuild it).
 */
export function simulateTrade(I: TradeInternals, x: ExactTrade, stage: SimStage, lambda: number | null, protectValue?: ProtectValue, reward?: Reward | null): TradeEvaluationCore {
  const ev = x.evaluation;
  const final = stage === "final";
  const sims = simCounts()[stage];
  const rw = rewardOn(I, reward);
  let dPO: number | null = null;
  let dCH: number | null = null;
  let dEW: number | null = null;
  let dPrizes: TradeEvaluationCore["dPrizes"] = null;
  let winChance: TradeDetail["winChance"];
  let them: PartnerNumbers | undefined;
  if (I.sim && I.me) {
    const base = I.sim.base[stage];
    const after = runSim(I, x.mine, { partner: x.partner, side: x.theirs }, stage);
    dPO = after.pPlayoffs - base.pPlayoffs;
    dCH = after.pTitle !== null && base.pTitle !== null ? after.pTitle - base.pTitle : null;
    dEW = after.expWins - base.expWins;
    // The weekly high scores' change only when this context simulated them (reward.ts runPrizeDeltas: unknown otherwise).
    dPrizes = runPrizeDeltas(base.prizes, after.prizes, I.sim.highScores);
    winChance = winChanceOf(base, after);
    // "Helps them" (Checkpoint 7c; planner reply to Checkpoint 7b, §7): the partner's side of the same two runs.
    const theirsBefore = base.teams[x.partner.index];
    const theirsAfter = after.teams[x.partner.index];
    if (theirsBefore && theirsAfter) them = partnerNumbersOf(I, x, rw, theirsBefore, theirsAfter);
  }
  // κ: the "Protect my trade value" level's, but 0 when the trade values are our own estimates (valuesEstimated: the market
  // term would count lineup points twice; the file header, "The simulation"), with ESTIMATED_VALUES_NOTE, and ⚠️ when there
  // are none at all (valuesMissing: every g is 0, so the term is 0 either way; κ 0 says there is none: marketWeekly null).
  const kappa = valuesEstimated(I) || valuesMissing(I) ? 0 : protectValueWeight(protectValue ?? I.settings.protectValue);
  // The scores' scale, B₃, under the same reward and λ (planner reply to Checkpoint 4c, A2), which also prices B's market term
  // (planner reply to Checkpoint 7a, §2 question 5): one B₃ for the B and the scores.
  const scale = helpsScaleOf(I, lambda, rw);
  const b3 = scale?.b3 ?? null;
  const b = benefit({ leagueType: I.snapshot.settings.leagueType, dPO, dCH, dPrizes, gMine: ev.gMine, dynasty: x.dynasty, myPPlayoffs: I.sim ? I.sim.base.final.pPlayoffs : null, lambda, kappa, b3, reward: rw });
  const numbers = tradeNumbers(b, { pAccept: ev.pAccept, pComplete: ev.pComplete, label: ev.acceptLabel }, b3);
  const { titleMissing: _titleMissing, ...cardNumbers } = numbers;
  void _titleMissing;
  const notes = [...ev.detail.notes, ...benefitNotes(b, rw), ...helpsScaleNotes(scale), ...estimatedValuesNotes(I), ...missingValuesNotes(I)];
  return {
    ...ev,
    ...cardNumbers,
    stage: I.sim ? (final ? "final" : "exact") : ev.stage,
    sims: I.sim ? sims : 0,
    dPO,
    dCH,
    dEW,
    dPrizes,
    ...(them ? { them } : {}),
    flags: tradeFlags({ gMine: ev.gMine, b: b.b, injured: ev.flags.injured }),
    detail: { ...ev.detail, notes, ...(winChance ? { winChance } : {}) },
  };
}

// ---------------------------------------------------------------------------------------------
// "Offer first / if they say no" (planner addendum to Checkpoint 3, §4; lead decision N4)

/** One version of a trade for the steps: its exact evaluation and its numbers on the screening block of seasons (simulateTrade "screen"). */
export interface TradeVersion {
  x: ExactTrade;
  screen: TradeEvaluationCore;
}

/** The config keys the steps read (config.search.throwInMaxCost and config.search.steps), widened so tests can pass others. */
export interface StepConfig {
  /** A throw-in's lineup cost is at most this (ROS lineup points, the exact mode's lineups). */
  readonly throwInMaxCost: number;
  /** Steps are shown when the full version's P_complete is at least this above the offer-first's, … */
  readonly minAcceptGain: number;
  /** … and the offer-first version's, as the card prints it, is at least this (in case 1, at least the user's minimum chance too: offerFirstBar). */
  readonly minOfferFirst: number;
  /** Case 2: the throw-in added must keep B at least this share of the offer's B (both on the screening block). */
  readonly minBShare: number;
  /** Case 2's pre-screen (performance, not a model number): only the best this many candidates get exact evaluation; Infinity: all. */
  readonly preScreen: number;
}

/** The steps' config (§15 defaults). */
export function stepConfig(): StepConfig {
  const s = config.search.steps;
  return { throwInMaxCost: config.search.throwInMaxCost, minAcceptGain: s.minAcceptGain, minOfferFirst: s.minOfferFirst, minBShare: s.minBShare, preScreen: s.preScreen };
}

/**
 * My throw-ins (the file header, "Offer first"): my active-roster players with a model whose lineup cost in the exact mode
 * (TeamPlayerValue.mvLoseScen with scenarios, else mvLoseEv: MV_lose against my free-agent-optimized roster V*) is at most
 * throwInMaxCost × the build's threshold scale (league.ts step 5c, LeagueContext.thresholds.scale = Σω ÷ Σω₀: the cost is in
 * ROS lineup points under ω, the threshold was calibrated at ω₀; review of the engine track, Phase 7b), not at a position
 * the search leaves out (config.market.tradeSearchExcluded) unless includeKDefIdp, not untouchable and not must-include.
 * Cheapest first by perception value (the values g reads), ties: the smaller id. Empty without my team.
 */
export function throwIns(I: TradeInternals, settings: Pick<TradeSettings, "includeKDefIdp" | "untouchables" | "mustInclude">, cfg: Pick<StepConfig, "throwInMaxCost"> = stepConfig()): string[] {
  const me = I.me;
  if (!me) return [];
  const costs = I.model.teams[me.index]?.players ?? {};
  const excluded = new Set<Pos>(settings.includeKDefIdp ? [] : config.market.tradeSearchExcluded);
  const untouchable = new Set(settings.untouchables);
  const forced = new Set(settings.mustInclude);
  const value = (id: string) => I.values[id] ?? 0;
  const maxCost = cfg.throwInMaxCost * I.league.thresholds.scale;
  return me.roster
    .filter((id) => {
      const pv = costs[id];
      if (!pv || !I.league.table.rows.has(id) || untouchable.has(id) || forced.has(id)) return false;
      const pos = I.league.posOf(id);
      if (pos === undefined || excluded.has(pos)) return false;
      const cost = pv.mvLoseScen ?? pv.mvLoseEv;
      return Number.isFinite(cost) && cost <= maxCost + EPS;
    })
    .sort((a, b) => value(a) - value(b) || byId(a, b));
}

/** The settings the steps read: the search's (or the Analyzer's) per-call settings (the goal and prizes: their reward, rewardFor). */
export type StepSettings = Pick<TradeSettings, "lambda" | "protectValue" | "goal" | "prizes" | "minChance" | "includeKDefIdp" | "untouchables" | "mustInclude">;

export interface StepOptions {
  settings: StepSettings;
  /** My side's most players in a version: the search's maxPerSide, the Analyzer's analyzerMaxPerSide. */
  maxPerSide: number;
  /**
   * Versions already evaluated (the search's exact trades with their screening-block numbers), by key: a version found here
   * isn't evaluated again (exact evaluation and the simulation are deterministic: the numbers are the same). New versions
   * are added.
   */
  versions?: Map<string, TradeVersion>;
  /** Default stepConfig(). */
  cfg?: StepConfig;
  /**
   * ⚠️ Checkpoint 7c (the file header, "Offer first"): the trade as ranked helps both teams (its "Helps both" tag:
   * benefit.helpsBoth on its final numbers, the search's finalist or the Analyzer's evaluation), so case 1's lean offer-first
   * version must help both too. Absent or false: no such rule.
   */
  helpsBoth?: boolean;
}

/**
 * A version of a trade, exactly evaluated with the screening simulation; null when it's illegal (every roster rule
 * re-checked). ⚠️ Returned with `proposal`'s own order of players (verification of the final review of Phase 4c, finding
 * VF-2): versions are cached by key (each side's players sorted), so one cached for another order came back in that order
 * (a card's case-2 attempt cached [A, B], and another card asking for [B, A] got [A, B]), and a re-filter, whose cache
 * holds the versions an earlier minimum's cards asked for, could list a step's players in another order than a fresh
 * search. A version not cached yet is evaluated in the key's order (inKeyOrder), so its numbers never depend on which card
 * asked first either (the search's own exact trades, cached in the search's order, are the same for both).
 */
export function tradeVersion(I: TradeInternals, proposal: TradeProposal, opts: Pick<StepOptions, "settings" | "maxPerSide" | "versions">): TradeVersion | null {
  const key = proposalKey(proposal);
  let version = opts.versions?.get(key);
  if (!version) {
    const x = evaluateExact(I, inKeyOrder(proposal), opts.maxPerSide);
    if ("illegal" in x) return null;
    version = { x, screen: simulateTrade(I, x, "screen", opts.settings.lambda, opts.settings.protectValue, rewardFor(I, opts.settings)) };
    opts.versions?.set(key, version);
  }
  return inProposalOrder(version, proposal);
}

/** A proposal with each side's assets in key order (assetKey, sorted as proposalKey sorts them). */
export function inKeyOrder(p: TradeProposal): TradeProposal {
  const sorted = (xs: readonly TradeAsset[]) => [...xs].sort((a, b) => byId(assetKey(a), assetKey(b)));
  return { partnerId: p.partnerId, give: sorted(p.give), get: sorted(p.get) };
}

/** A version of `proposal`'s key listing its players in `proposal`'s order: the version itself when it already does. */
function inProposalOrder(v: TradeVersion, proposal: TradeProposal): TradeVersion {
  const sameOrder = (a: readonly TradeAsset[], b: readonly TradeAsset[]) => a.length === b.length && a.every((x, i) => assetKey(x) === assetKey(b[i] as TradeAsset));
  const have = v.screen.proposal;
  if (sameOrder(have.give, proposal.give) && sameOrder(have.get, proposal.get)) return v;
  const ordered: TradeProposal = { partnerId: have.partnerId, give: proposal.give.map((a) => ({ ...a })), get: proposal.get.map((a) => ({ ...a })) };
  return { x: { ...v.x, evaluation: { ...v.x.evaluation, proposal: ordered } }, screen: { ...v.screen, proposal: ordered } };
}

/**
 * A version's step (TradeStep): its proposal, its screening-block numbers, its forced moves, its explanation facts and its
 * acceptance features (planner reply to Checkpoint 4b, change 7: feedback stores the sent version's).
 */
function stepOf(v: TradeVersion): TradeStep {
  const c = v.screen;
  return { proposal: c.proposal, key: c.key, b: c.b, tradeScore: c.tradeScore, pAccept: c.pAccept, pComplete: c.pComplete, acceptLabel: c.acceptLabel, gMine: c.gMine, gPartner: c.gPartner, required: c.required, detail: c.detail, features: c.features };
}

/**
 * Case 2's candidates in pre-screen order (the file header): the screening's quick estimate of P_complete (quick P_accept,
 * halved by the veto rule on the raw g_mkt(P) as P_complete is), then the screening's ΔROS, then the smaller id; those the
 * screening's legality rejects last.
 */
export function preScreenOrder(I: TradeInternals, partner: TeamState, give: readonly string[], get: readonly string[], candidates: readonly string[]): string[] {
  const review = I.snapshot.settings.tradeReview;
  const scored = candidates.map((id) => {
    const s = screenTrade(I, partner, [...give, id], get);
    const p = s ? (vetoApplies(review, s.gPartner) ? s.pQuick * config.acceptance.veto.factor : s.pQuick) : Number.NEGATIVE_INFINITY;
    return { id, p, delta: s ? s.myDelta : Number.NEGATIVE_INFINITY };
  });
  const ahead = (x: number, y: number) => (x === y || Math.abs(x - y) <= EPS ? 0 : y - x);
  scored.sort((a, b) => ahead(a.p, b.p) || ahead(a.delta, b.delta) || byId(a.id, b.id));
  return scored.map((x) => x.id);
}

/** Case 2's candidates (the file header): my throw-ins not in the trade, pre-screened to the best cfg.preScreen when there are more. */
export function addCandidates(I: TradeInternals, proposal: TradeProposal, throwInIds: readonly string[], cfg: Pick<StepConfig, "preScreen">): string[] {
  const give = playerIds(proposal.give);
  const get = playerIds(proposal.get);
  const candidates = throwInIds.filter((id) => !give.includes(id));
  const partner = I.byId.get(proposal.partnerId);
  if (!partner || !(candidates.length > cfg.preScreen)) return candidates;
  return preScreenOrder(I, partner, give, get, candidates).slice(0, Math.max(0, Math.floor(cfg.preScreen)));
}

/**
 * The chance the offer-first version must print (the file header, "Offer first"; rank.meetsMinChance judges it):
 * minOfferFirst, and in case 1 (`ranked` "full": the offer first is the lean version, not the card) at least the user's
 * minimum chance (TradeSettings.minChance) too.
 */
export function offerFirstBar(ranked: TradeSteps["ranked"], minChance: number, cfg: Pick<StepConfig, "minOfferFirst"> = stepConfig()): number {
  const own = Number.isFinite(cfg.minOfferFirst) ? cfg.minOfferFirst : 0;
  return ranked === "full" && Number.isFinite(minChance) ? Math.max(own, minChance) : own;
}

/** Whether a version helps me: its B (screening block) is known and above 0 (the file header: the offer first must help). */
const helps = (v: TradeVersion): boolean => {
  const b = v.screen.b;
  return b !== null && Number.isFinite(b) && b > 0;
};

/**
 * "Offer first / if they say no" for a trade (the file header): its two steps, or null when none qualify (the offer-first
 * version must help me: B > 0 on the screening block), or without my team. `ranked` is the trade as ranked, with its
 * screening-block numbers.
 */
export function tradeSteps(I: TradeInternals, ranked: TradeVersion, opts: StepOptions): TradeSteps | null {
  if (!I.me) return null;
  const cfg = opts.cfg ?? stepConfig();
  const proposal = ranked.screen.proposal;
  if ([...proposal.give, ...proposal.get].some((a) => a.kind !== "player")) return null;
  const give = playerIds(proposal.give);
  const get = playerIds(proposal.get);
  const all = throwIns(I, opts.settings, cfg);
  const mine = all.filter((id) => give.includes(id));
  const version = (ids: readonly string[]) => tradeVersion(I, { partnerId: proposal.partnerId, give: players(ids), get: players(get) }, opts);
  let offer: TradeVersion;
  let full: TradeVersion;
  let add: string;
  let rankedAs: TradeSteps["ranked"];
  if (mine.length > 0 && give.length >= 2) {
    // Case 1: offer first without my lowest-value throw-in in the trade; if they say no, add it back (the ranked trade).
    // The lean version must help me too: never advise offering a trade that doesn't. ⚠️ And on a trade that helps both teams
    // it must help both (on its screening-block numbers, as the bars read them): never advise offering first, under a card
    // tagged "Helps both", a trade that doesn't help them (Checkpoint 7c).
    add = mine[0] as string;
    const lean = version(give.filter((id) => id !== add));
    if (!lean || !helps(lean) || (opts.helpsBoth && !helpsBoth(lean.screen))) return null;
    offer = lean;
    full = ranked;
    rankedAs = "full";
  } else {
    // Case 2: offer the ranked trade first (it must help me, so minBShare compares positive B); if they say no, add the
    // throw-in that raises P_complete most while B stays at least minBShare of the offer's (both on the screening block)
    // and above 0; ties: the higher B, then the smaller id.
    const bOffer = ranked.screen.b;
    if (bOffer === null || !helps(ranked) || give.length + 1 > opts.maxPerSide) return null;
    let best: { id: string; v: TradeVersion; p: number; b: number } | null = null;
    for (const id of addCandidates(I, proposal, all, cfg)) {
      const v = version([...give, id]);
      const b = v?.screen.b;
      if (!v || b === null || b === undefined || !helps(v) || b < cfg.minBShare * bOffer - EPS) continue;
      const p = v.screen.pComplete;
      if (!best || p > best.p + EPS || (Math.abs(p - best.p) <= EPS && (b > best.b + EPS || (Math.abs(b - best.b) <= EPS && id < best.id)))) best = { id, v, p, b };
    }
    if (!best) return null;
    offer = ranked;
    full = best.v;
    add = best.id;
    rankedAs = "offerFirst";
  }
  const first = offer.screen.pComplete;
  if (!(full.screen.pComplete - first >= cfg.minAcceptGain - EPS) || !meetsMinChance(first, offerFirstBar(rankedAs, opts.settings.minChance, cfg))) return null;
  return { offerFirst: stepOf(offer), ifNo: { add, full: stepOf(full) }, ranked: rankedAs };
}

// ---------------------------------------------------------------------------------------------
// Words (explain.ts) and values (rank.ts)

/**
 * The names and league facts explain.ts reads: the app's own names (snapshot teams and players), and FantasyCalc's values,
 * which since Phase 7b only tell whether any trade value is behind a trade (planner reply to Checkpoint 7a, 5.4: the words
 * never quote or compare them; until then the pitch and the reasons did).
 */
export function explainContextOf(I: TradeInternals): ExplainContext {
  return {
    teamName: (id) => teamName(I, id),
    player: (id) => {
      const info = I.snapshot.players[id];
      return info ? { name: info.name, pos: info.pos, nflTeam: info.nflTeam, injury: info.injury } : null;
    },
    slots: I.instances.map((inst, i) => ({ ...inst, eligible: I.slotEligible[i] ?? [] })),
    leagueType: I.snapshot.settings.leagueType,
    tradeDeadline: I.snapshot.settings.tradeDeadline,
    // FantasyCalc's own perception value, never an estimate: explain.ts reads only whether a trade has any (it never quotes one).
    fantasyCalcValue: (id) => {
      const v = I.league.lp.players[id]?.value;
      return v && v.source === "fantasycalc" ? v.value : null;
    },
    // My odds before any trade on the final block: the card's "before" (TradeSearchResult.baseline, the Analyzer's), so the
    // reasons' odds line quotes the change the card prints (explain.ts oddsLine).
    baseline: I.sim && I.me ? { pPlayoffs: I.sim.base.final.pPlayoffs, pTitle: I.sim.base.final.pTitle } : null,
  };
}

/** A finished evaluation: the core plus its reasons and pitch (explain.ts). */
export function withWords(I: TradeInternals, core: TradeEvaluationCore): TradeEvaluation {
  const words = explainTrade(core, explainContextOf(I));
  // The card's injury tags (planner reply to Checkpoint 4, change 6): every tagged player on either side, with the return
  // week the model counts on (explain.tagContextOf), for the Trade Finder's cards and the Analyzer's alike.
  const tagged = injuryTags(core.proposal, I.snapshot.players, tagContextOf(I));
  return { ...core, flags: { ...core.flags, tagged }, reasons: words.reasons, pitch: words.pitch };
}

/** An asset's perception value (§9), for rank.ts's cores; picks are 0 in this phase. */
export function assetValue(I: TradeInternals): (asset: TradeAsset) => number {
  return (asset) => (asset.kind === "player" ? (I.values[asset.id] ?? 0) : 0);
}

// ---------------------------------------------------------------------------------------------
// The Trade Analyzer

export interface AnalyzeOptions {
  /** The settings the evaluation reads per call (lambda, protectValue, goal and prizes; the rest is the context's). Default: defaultTradeSettings(). */
  settings?: TradeSettings;
  clock?: () => number;
}

export interface TradeAnalysis {
  /** The full evaluation (exact lineups and config.simulation.finalSims seasons), null when the trade is illegal or can't be evaluated. */
  evaluation: TradeEvaluation | null;
  /** Why the trade can't be made, in plain English (null when it can). */
  illegal: string | null;
  /** Plain-English notes (the context's notes that apply, and this trade's). */
  notes: string[];
  /**
   * The call's "Helps you" scale (helpsScaleOf for its reward and λ: the evaluation's b3, with what the tooltip words, planner
   * reply to Checkpoint 7a, §2 question 6: benefit.ts HelpsScale), with every evaluation analyzeTrade makes; null when it has
   * no odds. Absent without an evaluation (no team picked, or an illegal trade: nothing is scored).
   */
  helpsScale?: HelpsScale | null;
  /**
   * Checkpoint 7c (planner reply to Checkpoint 7b, §6): the reward the evaluation was scored under (rewardFor: the call's goal
   * and prizes), so a page reads its prize shares (the "Top 3 odds" line, the feedback's) without making it again. Absent
   * without an evaluation.
   */
  reward?: Reward;
}

/** The Trade Analyzer (§13): any proposal, evaluated exactly as the search's finalists are. */
export function analyzeTrade(ctx: TradeContext, proposal: TradeProposal, opts: AnalyzeOptions = {}): TradeAnalysis {
  const I = tradeInternals(ctx);
  const notes = [...I.notes];
  if (!I.me) return { evaluation: null, illegal: null, notes };
  const settings = normalizeTradeSettings(opts.settings ?? defaultTradeSettings());
  const maxPerSide = Math.max(1, Math.floor(config.search.analyzerMaxPerSide));
  const exact = evaluateExact(I, proposal, maxPerSide);
  if ("illegal" in exact) return { evaluation: null, illegal: exact.illegal, notes };
  // The scale the evaluation is scored on (simulateTrade's B₃ for the same reward and λ), for the tooltip.
  const reward = rewardFor(I, settings);
  const helpsScale = helpsScaleOf(I, settings.lambda, reward);
  const core = simulateTrade(I, exact, "final", settings.lambda, settings.protectValue, reward);
  for (const n of core.detail.notes) if (!notes.includes(n)) notes.push(n);
  // "Offer first / if they say no" for the analyzed trade too (N4: useful for counteroffers), from its numbers on the
  // screening block, its versions within the Analyzer's per-side maximum. ⚠️ Only for a trade the Trade Finder could show
  // (B > 0, not hidden by the market guard: review of the addendum, engine findings 1 and 10), so a card that says the
  // trade doesn't help never says how to land it; and none when a context note stops the search (the deadline passed,
  // the season's over, no odds, …): the Analyzer still evaluates, but there's nothing to offer.
  const shown = core.b !== null && core.b > 0 && !core.flags.hiddenByMarket; // B > 0: not hidden by benefit either
  // ⚠️ A trade that helps both teams (its "Helps both" tag, on these final numbers) is offered first only in a version that
  // helps both too (Checkpoint 7c; the file header, "Offer first"), as on the Trade Finder's cards.
  const steps = I.blocked || !shown ? null : tradeSteps(I, { x: exact, screen: simulateTrade(I, exact, "screen", settings.lambda, settings.protectValue, reward) }, { settings, maxPerSide, helpsBoth: helpsBoth(core) });
  return { evaluation: withWords(I, steps ? { ...core, steps } : core), illegal: null, notes, helpsScale, reward };
}
