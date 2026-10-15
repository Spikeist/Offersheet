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
 *   step 5c, planner reply to Checkpoint 7a, §6.1; its reward, LeagueContext.reward; since Checkpoint 7e my untouchables, no
 *   drop of mine, TeamState.keep); the search and the Analyzer take the
 *   rest per call. The model is built without a simulation of its own, but with ω measured on this context's shown block
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
 *   step 8a) for TeamModel.scoreWithPickups, and LeagueModel.odds simulates those scores on the first shownSims seasons of
 *   the simulation seed's matrix (Checkpoint 7e; finalSims before). The context reuses those final lineups for its baseline
 *   (LeagueModelBuild.pickups) and builds its setup from the same scores (season.pickupSeasonModel), so the baseline odds on
 *   the shown block below are LeagueModel.odds exactly (every team's odds, weekly win chances, notes): the League page's
 *   headline and every card's "before" are one number (evaluate.baseline.test.ts checks it).
 * - One SimSetup (season.buildSimSetup on the baseline scores) and one common-random-numbers matrix (sim.simNormals of
 *   the simulation seed) of shownSims + screeningSims seasons in three blocks (review of track E, item 2; Checkpoint 7e,
 *   planner reply to Checkpoint 7d, item 1.1: "raise the final simulation for the cards shown to 10,000 or 20,000
 *   seasons"): the shown block, the first shownSims seasons, the League model's own (Phase 4c: so the baseline is
 *   LeagueModel.odds; before, the screening block came first), on which every number a page prints is simulated (the
 *   Trade Finder's cards and Plan B boxes, search.ts "The shown pass"; the Analyzer; the baseline odds every profile, λ and
 *   note reads); the ranking block ("final"), its first finalSims seasons, the very same draws (season n's depend only on
 *   the seed and n), on which the search's final simulation ranks and chooses its trades (its finalists, "Helps both"
 *   extras and Plan B candidates) at a quarter of the cost; and the screening block, the next screeningSims seasons, which
 *   neither of the others reads. Choosing trades on the screening's seasons and showing B from the same seasons would show
 *   the luck that chose them (the shown B was above other seeds' for 21 of 25 trades). ⚠️ The shown block holds the ranking
 *   block's seasons, so a card's shown B still reads the seasons that ranked it, now a quarter of its seasons rather than all
 *   of them (the lead's design: at 20,000 seasons a card's Helps you spreads by at most 3 across seeds). Within each block
 *   every run shares the draws (common random numbers). The baseline odds of each block go through the same code as every
 *   trade's "after" run, so a trade that changes neither side's V* moves nothing. With my team, one more run on the shown
 *   block and one on the ranking block (the same run when the two blocks are the same seasons): the "Helps you" calibration (Phase 7a,
 *   planner reply to Checkpoint 4c, A2; league.ts helpsCalibrationOf, the League model's step 8c on the same seasons and
 *   setup, so SimState.calibration, the shown block's, is LeagueModel.helpsCalibration exactly): my score + 3 points a week in every week a
 *   trade can change, whose B_win under a call's reward is B₃, the scale of Helps you and Overall and the price of B's market
 *   term (helpsScaleOf; in dynasty and keeper leagues with long-term values B_ref(λ), mixed with +10% long-term value).
 *   Checkpoint 7c (planner reply to Checkpoint 7b, §6): the setup lists the weekly high scores when the context's reward
 *   pays them (reward.ts paysWeekly; SimState.highScores), as the League model's runs do, so its baseline, calibration and
 *   every trade's prize components are the League page's; a call whose reward pays them on a context that didn't simulate
 *   them is refused (rewardOn: build the context with that reward's settings; the app's never differ, since the engine
 *   worker keys its contexts by the goal and prizes). Checkpoint 7c (planner reply to Checkpoint 7b, §7, "Helps them"):
 *   each partner's own calibration run on the same block and baseline (partnerCalibrationOf, the same function with its
 *   id), made the first time a trade with it is simulated on that block and kept with the context (SimState.partners, the
 *   shown block's; SimState.rank.partners, the ranking block's). Every stage reads one block's scale: the screening and
 *   ranking stages the ranking block's B₃ and partners' scales (so the search ranks as it did on 5,000 seasons), the shown
 *   stage the shown block's (scaleBlockOf).
 * - Checkpoint 7f (planner reply to Checkpoint 7e, answer 2: "simulate only the 15,000 seasons the ranking run doesn't
 *   already cover"; sim.ts, "Continuing a run"): the ranking block is the shown block's first seasons, so a run on the shown
 *   block continues the same run on the ranking block (SimState.resume), into the same running sums in the same order: its
 *   numbers are the full run's, bit for bit, the baseline still LeagueModel.odds exactly. The context makes its ranking
 *   block's baseline and calibration first, keeping their progress, and its shown block's continue them (the baseline on
 *   each block is read off those very runs: until then runSim played each again). runSim keeps each ranking run's progress
 *   by its rows (rankProgressOf: the side evaluations, which the context memoizes), and a run of the same rows on the shown
 *   block continues it: every card and Plan B box of a search, a trade's own "before", a re-filter's new cards, an offer's
 *   version and the Analyzer's trade when the search ranked them; each partner's scale likewise (partnerCalibrationOf).
 *   Rows no ranking run had play every season: "now or after this week" (this week as before the trade, another setup), a
 *   trade the search never ranked, the Analyzer before any search. The progress is kept for the context's life (about 5 KB a
 *   run: +0.3–0.7 MB of heap after a search on Parker's leagues, against 135–150 MB for the search). TradeContextOptions.resume
 *   false plays every run in full (tests and reports). On Parker's leagues, with the merge (search.ts, "Merged cards"; the
 *   review of the speed track, SPEED-2), a search's runs on the shown block all continue: on his first league 29 runs on Oct
 *   14 (21 trades, cards and boxes, and 8 partners' scales), 435,000 seasons played where full runs would play 580,000, and
 *   38 on Oct 15 (27 trades, 9 partners' scales and 2 ladder offers the search had ranked), 570,000 of 760,000; on his
 *   12-team league 21 runs (315,000 of 420,000) and 23 (345,000 of 460,000). A ladder offer the search never ranked plays
 *   every season (none in those searches, at 2 players a side; 2 of 26 runs at 3 a side on his first league, Oct 15).
 * - Once: partner profiles (acceptance.partnerProfile, P(playoffs) from the shown block's baseline), hot players, the
 *   deadline urgency, perception values and the waiver credit W (the League model's), long-term values and MyDynTotal
 *   when they loaded (benefit.futureValuesLoaded; since Checkpoint 7c every team's long-term total too, for "Helps
 *   them"'s B_future,P: TradeInternals.future.totals), the league median of every slot instance over the hole weeks (the
 *   holeWeeks weeks from the first week team numbers count; EV lineups for screening, the exact mode's for exact
 *   evaluation), every team's rank at every instance (TradeDetail.partnerSlots), my risky weeks (TradeDetail.riskyWeeks:
 *   riskyWeeksOf, the League page's rule, src/lib/leagueView.ts scheduleView; ⚠️ Phase 4c lead decision: a likely
 *   starter at a streamed K or D/ST, config.leaguePage.streamCoversBye, is never counted on bye, since the streaming
 *   replacement covers his slot, on both),
 *   and the star premium of every rostered player for his own team (planner addendum to Checkpoint 3, §1; lead decision
 *   N1: premium.leaguePremiums, the League model's own function, with each team's P(playoffs) from this shown block's
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
 *      Never one of my untouchables (Checkpoint 7e; planner reply to Checkpoint 7d, item 3.3: "Untouchables are never
 *      suggested as drops anywhere"; TeamState.keep, mine only, here and in rule 2): when only they could go, the trade is
 *      illegal and says so (untouchableDropNote: "Every RB you could drop is untouchable."; rule 2's, "Every player you could
 *      drop to make room is untouchable."), so the search never suggests it and the Analyzer gives the reason.
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
 * exact mode's lineups, and since Checkpoint 7e the trade values and W its near-ties compare from then on too, planner
 * reply to Checkpoint 7d, item 2.3; ⚠️ the returner himself a candidate, so a return never lowers a side by more than the near-tie
 * tolerance (returners.ts: a returner worth more than W can keep his spot over a cheaper bench player); never one the
 * lineup needs, one a position's minimum needs, the last one at a position the side streams, or, on my side, one of my
 * untouchables (Checkpoint 7e, item 3.3: TeamState.keep; when only they could go, nobody does and the roster runs over);
 * at his position when its limit binds),
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
 * roster, never dropping one of my untouchables on my side (Checkpoint 7e, item 3.3: TeamState.keep, as my baseline V*(T)
 * never does) nor a legality add (the optimizer's keep set: Phase 7c, planner reply to Checkpoint 7b, section 5;
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
 * No credit for moves I could make anyway (Checkpoint 7e; planner reply to Checkpoint 7d, item 2.1; eitherWayMoves): my
 * free-agent pickups after the trade that clear the pickup bar on my baseline too (tried in V*(after)'s order on V*(T), with
 * the ones found so far made; ⚠️ one whose very move can't be made there for a reason of its drop, with the drop my optimizer
 * itself would make: review of wave B, finding B-2) are made in both versions. The trade's own "before" (ExactTrade.before:
 * V*(T) with them, priced finally) is then what every number of mine is measured from: ΔPPW, the slots, the weekly scores
 * and the depth cover, my market package and ΔDyn (which leave them out), and in the simulation ΔPO, ΔCH, the prize
 * components and the win chances; the partner's odds before and Helps them come from that same run (beforeOddsOf: its own
 * run on the same block, common random numbers: my row is the "before"'s there), while its acceptance (g, n, h) reads the
 * trade itself. Every other such move stays with the trade, as before; forced moves never come there. A trade without one
 * reads exactly as before (the baseline's run), and so does every trade under TradeContextOptions.eitherWay false. The card
 * lists my roster moves against that "before" (TradeEvaluation.myMoves, myRosterMoves; item 2.2).
 *
 * The simulation (M4): the baseline SimSetup with my team's and the partner's mean and SD rows replaced by their
 * after-V* scores (every other team, and the week in progress, unchanged), simulateSeason on the screening block, the
 * ranking block ("final") or the shown block (Checkpoint 7e; since Checkpoint 7f a run on the shown block continues the same
 * rows' run on the ranking block when there was one: runSim); ΔPO, ΔCH (null when title odds are unknown: benefit's titleMissing rule), ΔEW and (Checkpoint 7c)
 * every prize component's change (TradeEvaluation.dPrizes, reward.ts runPrizeDeltas: P(2nd), P(3rd), the weekly high scores
 * won, unknown unless the context simulated them, the points title) against the baseline on the same block.
 * TradeDetail.winChance (Phase 4c; planner reply to
 * Checkpoint 4b, change 9, "Win chance by week"): from the same two runs, my head-to-head win chance before and after in each week sim.ts lists (a game's first
 * drawn week: a multi-week game at its first week still to play), a week without a game with an opponent left out
 * (winChanceOf); the shown block's on a card shown and in the Analyzer, the ranking block's on a finalist the search ranks,
 * the screening block's on a screened one or a step. ⚠️ None in a points-only league (review of track EV; an empty list): its scheduled games don't change the
 * standings (sim.ts plays them only for points against; the League page says so), so a weekly line there would show
 * moves in games that count for nothing, and riskyWeeks counts byes only there (TradeDetail.weekly keeps my projected
 * points by week). Then B₃ for the call's reward and λ (helpsScaleOf: one scale per block, so a step's or Plan B's Helps
 * you compares with its card's on the block they're ranked on: the screening and ranking stages read the ranking block's
 * calibration, the shown stage the shown block's, scaleBlockOf, Checkpoint 7e; Phase 7a; in dynasty and keeper leagues with
 * long-term values B_ref(λ), planner reply to Checkpoint 7a, §2 question 6), benefit() (λ = settings.lambda ?? the default
 * by my baseline P(playoffs), the shown block's, the League page's headline, at every stage; κ = the
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
 * so on the shown block the partner's "before" is LeagueModel.odds' for that team), so the partner's ΔPO, ΔCH and prize
 * components come from the very runs mine do, at no extra simulation. B_P is benefit.ts partnerBenefit on them under the
 * call's reward (no trade-value term; λ_P by the partner's baseline P(playoffs), the shown block's, at every stage, as mine
 * reads mine; B_future,P from the trade's own long-term package, ExactTrade.partnerDynasty), its scale B_ref,P benefit.ts
 * partnerScale on the partner's own calibration run (partnerCalibrationOf: league.ts helpsCalibrationOf with its id on the
 * stage's scale block, made once per partner, block and context, about 12 ms on Parker's league at 5,000 seasons, about 45
 * at 20,000, three quarters of that since Checkpoint 7f when it continues the partner's run on the ranking block), and Helps
 * them their ratio as printed
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
 * Versions and throw-ins (planner addendum to Checkpoint 3, §4; lead decision N4; since Checkpoint 7e, planner reply to
 * Checkpoint 7d, item 4.1, for "How to offer it": src/engine/offers.ts, which replaced "Offer first / if they say no"). A
 * throw-in is one of my active-roster players with a model whose lineup cost in the exact mode (TeamPlayerValue.mvLoseScen
 * with scenarios, else mvLoseEv: MV_lose against my free-agent-optimized roster V*, so a backup who covers injuries and byes
 * isn't free) is at most config.search.throwInMaxCost (× Σω ÷ Σω₀ under the automatic playoff weight: league.ts step 5c,
 * LineupThresholds), not at a position the search leaves out unless includeKDefIdp, not untouchable, not must-include
 * (throwIns). Every version of a trade is evaluated as the search's exact trades are (legality re-checked, exact
 * evaluation, the screening simulation: tradeVersion, in the key's order whoever asks first), and offers.ts compares the
 * versions on the screening block of seasons before it simulates the ones it shows on the shown block.
 * - The lean version (until Checkpoint 7e case 1's offer first; offers.ts): the trade without my lowest-value throw-in in it
 *   (perception value; ties: the smaller id), when my side keeps a player without him.
 * - The Last offer (until Checkpoint 7e case 2's "if they say no"; lastOfferVersions): the trade plus the throw-in it doesn't
 *   give (my side within the per-side maximum: the search's maxPerSide, the Analyzer's analyzerMaxPerSide; legal) with the
 *   highest P_complete among those keeping B at least minBShare × the trade's B (⚠️ both B at screeningSims on the screening
 *   block, a fair comparison) and above 0; ties: the higher B, then the smaller id. ⚠️ For speed the candidates are
 *   pre-screened (preScreenOrder: the screening's quick P_accept, which moves with g, h and n, halved by the veto rule as
 *   P_complete is; then the screening's ΔROS) and only the best config.search.steps.preScreen get exact evaluation (the
 *   Checkpoint 4 report measures how often that misses the exact choice). offers.ts holds it to the ladder's rules on the
 *   numbers it prints (at least minAcceptGain likelier than the trade, B at least minBShare of the trade's, both as printed).
 * - Phase 4c (planner reply to Checkpoint 4b, change 2, and answer 6, with the lead's matched pairs; market.packageValues has
 *   the rule and its reading): a throw-in worth at most W is left out of both sides' totals with his roster-spot credit, or
 *   left in where a credit stood, before any g or the market term, so when every player moves with an active roster spot he
 *   moves no g, whichever side he's added to: through value such a throw-in can only lower the chance they accept (the
 *   complexity term: with n, h and hot held fixed P_accept never rises), so a version that adds one raises the chance only
 *   through the partner's lineup (n, h) or a hot streak (hot), and one that adds a throw-in worth more than W through value
 *   too. (⚠️ Review of NT, finding 2: this said flatly that such a throw-in "can only lower" the chance; on Parker's league,
 *   the 00:51Z dump, the steps that added Rico Dowdle, worth [value] ≤ W [value], raised it 7.6 to 8.2 points through n and h, he
 *   fills a hole in Team 2's lineup, the partner's g 0% in both versions.) (Under Phase 4b's value floor alone he added W to
 *   both sides of every package, so each g, a ratio, edged toward 0: up for a partner losing value, down for one gaining,
 *   and a trade just past the veto line could come back above it; the planner's step alone still did when the partner gave
 *   d more players, at least d of them worth at most W: review of track EF, finding 1.) ⚠️ A version that moves an IR player
 *   can be the exception market.ts's header states precisely. The search also evaluates the lean version of every
 *   shortlisted trade with such a throw-in (search.ts, "Lean companions"), so a card offering him has been weighed against
 *   the same trade without him.
 * Until Checkpoint 7e the search gave its shown trades two steps ("Offer first / if they say no": the lean version first and
 * the card if they say no, or the card first and the Last offer's version if they say no, each shown only when the second
 * was at least minAcceptGain likelier and the first printed at least minOfferFirst, a lean one at least the user's minimum
 * chance too), and the Analyzer its trade's; a card's pitch named its offer-first version. TradeEvaluation.steps stays in the
 * types so an evaluation made before reads.
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
import { acceptance, hotPlayers, hotTerm, hotWeeks, holeFeature, laterBeforeDeadline, median, partnerLineupDelta, partnerProfile, quickAcceptance, tradeDeadlinePassed, transactionWeek, urgencyTerm, vetoApplies, type HoleSlot, type PartnerProfile, type ReceivedPlayer, type ReceivedStarter } from "./acceptance";
import {
  benefit,
  benefitNotes,
  futureValuesLoaded,
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
  tradeScore,
  type HelpsScale,
  type PartnerScale,
} from "./benefit";
import { config } from "./config";
import { explainTrade, injuryTags, tagContextOf, type ExplainContext } from "./explain";
import type { ModelInputs } from "./inputs";
import { ODDS_REFUSED_WARNING, buildLeagueModelWithContext, claimedBy, finalRunLineups, helpsCalibrationRun, nearTieRos, pickupScore, type FaAllocationMode, type LeagueContext, type TeamBase, type TeamWork } from "./league";
import type { HelpsCalibration, LeagueModel, PlayerPremium, SeasonOdds, SlotInstance } from "./leagueModel";
import { marketValues, valuesForTerm, waiverCredit, type ActiveSpots } from "./market";
import { lineupTotal, prepareRoster } from "./lineup";
import { instancePointsInto } from "./needs";
import { POSITIONS, type InjuryStatus, type LeagueSnapshot, type PlayerInfo, type Pos, type Team } from "./model";
import { FULL_POOL, applyStep, fillCount, poolRestriction, returnersOf, rosterKey, type FaStep, type OptimizedRoster, type PoolRestriction, type StreamSpec } from "./optimizer";
import { leaguePremiums, perceivedPackage, premiumFacts } from "./premium";
import { activeSpots, irAfterTrade, irEligibleStatuses, type Displacement, type FinalLineups } from "./returners";
import { buildSimSetup, oddsSkippedWarning, pickupSeasonModel, seasonOddsWith, shownSimsOf, type SeasonModel, type SimSetupResult } from "./season";
import { paysWeekly, prizeStillMovable, rewardOf, runPrizeDeltas, type PrizeOdds, type Reward } from "./reward";
import { PRIZE_KEYS, defaultTradeSettings, normalizeTradeSettings, type ProtectValue, type TradeSettings } from "./settings";
import { simNormals, simulateSeason, type SimNormals, type SimProgress, type SimResult, type SimTeamOdds } from "./sim";
import {
  addGainExact,
  addFloors,
  addUpperBoundWeeks,
  evInstancePoints,
  evRemovalCosts,
  evStarter,
  isStreamId,
  lowestKeepValue,
  positionAllows,
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
import type { AssumedMove, AssumedRelease, LaterNumbers, NearTieRelease, OddsBefore, OpenSpot, PartnerNumbers, PickupOf, RosterChange, RosterMove, RosterMoves, SlotChange, TradeAsset, TradeDetail, TradeEvaluation, TradeEvaluationCore, TradeProposal } from "./tradeModel";

/** Gains closer than this are ties or zero (float noise, not a tunable). */
const EPS = 1e-9;

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface TradeContextOptions {
  /** The moment the numbers are for (a game that kicked off before it no longer counts; urgency). */
  now: Date;
  /**
   * The user's settings. The context reads only what the League model reads (streamPositions, and the goal and prizes its
   * automatic playoff weight weighs my odds by, which also decide whether its simulation lists the weekly high scores, and
   * since Checkpoint 7e my untouchables, which no drop of mine makes, TeamState.keep: src/lib/settingsStore.ts
   * LEAGUE_MODEL_SETTINGS); the search and the Analyzer take the rest per call (the goal and prizes too, and the untouchables
   * for the search's give pool: a cached context is rebuilt when they change, since its key holds them). Default:
   * defaultTradeSettings().
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
   * context's shown block (simCounts().shown; Checkpoint 7e), the seasons the League page's model measures ω on. 0 = ω isn't measured: the
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
  /**
   * Item 2.1's either-way moves (the file header, "No credit for moves I could make anyway"; Checkpoint 7e, planner reply to
   * Checkpoint 7d): true (the default) makes my pickups after a trade that clear the pickup bar on my baseline too in both
   * versions; false is Checkpoint 7d's rule (every one of them stays with the trade), for tests that compare the two (review
   * of wave B, finding B-5): the app never sets it.
   */
  eitherWay?: boolean;
  /**
   * Checkpoint 7f (planner reply to Checkpoint 7e, answer 2; the file header, "One SimSetup … in three blocks"): true (the
   * default) plays a run on the shown block from the same run's progress on the ranking block, the shown block's first
   * finalSims seasons, so only the seasons the ranking block doesn't hold are played (sim.ts, "Continuing a run": the full
   * run's numbers, bit for bit); false plays every run on the shown block in full, for tests and reports that compare the
   * two: the app never sets it.
   */
  resume?: boolean;
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
  /**
   * The players it never drops (league.ts TeamWork.keep; Checkpoint 7e, planner reply to Checkpoint 7d, item 3.3): mine, my
   * untouchables on my active roster or IR; every other team's, none. Legality's rule 1 and 2 drops (the file header), my
   * V*(after) (the optimizer's keep set) and the release when one of my IR players returns (sideEval) leave them alone.
   */
  keep: readonly string[];
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
   * mine come from at no extra cost. On the shown block's baseline, each team's are LeagueModel.odds' (SimState.odds).
   */
  teams: RunOdds[];
}

/**
 * Which block of simulated seasons a run reads (the file header, M4; Checkpoint 7e): the screening block, the ranking block
 * ("final": the search's final simulation, which ranks and chooses its trades) or the shown block (every number a page
 * prints: the cards, the Plan B boxes and the Analyzer).
 */
export type SimStage = "screen" | "final" | "shown";

/**
 * The block whose calibration runs score a stage's numbers (scaleBlockOf): the ranking block's for the screening and ranking
 * stages, the shown block's for the shown stage.
 */
export type ScaleBlock = "final" | "shown";

/** The scale block of a stage (the file header, "The simulation"): the shown block's for "shown", else the ranking block's. */
export function scaleBlockOf(stage: SimStage): ScaleBlock {
  return stage === "shown" ? "shown" : "final";
}

/** A scale block's baseline odds and calibration runs (SimState's own fields are the shown block's; SimState.rank the ranking block's). */
export interface BlockScale {
  /** The baseline (every team at V*) on the block: on the shown block LeagueModel.odds exactly. */
  odds: SeasonOdds;
  /** My "Helps you" calibration run on the block against `odds` (null without my team): on the shown block LeagueModel.helpsCalibration exactly. */
  calibration: HelpsCalibration | null;
  /** Each partner's calibration run on the block, by team id, made when first needed (partnerCalibrationOf; null when none could be made). */
  partners: Map<string, HelpsCalibration | null>;
}

export interface SimState extends BlockScale {
  built: SimSetupResult;
  /**
   * Checkpoint 7c: the setup lists the remaining weekly high-score periods (the context's reward pays them: reward.ts
   * paysWeekly), so the runs' expected high scores mean something; a call's reward that pays them needs it (rewardOn), and
   * runSim refuses a setup without them. Without them every trade's weekly change is unknown (reward.ts runPrizeDeltas).
   */
  highScores: boolean;
  /**
   * The three blocks of one common-random-numbers matrix (Checkpoint 7e; the file header): the shown block, the first
   * shownSims seasons; the ranking block ("final"), its first finalSims seasons (the very same draws: the shown block's own
   * object when the two are the same seasons); the screening block, the next screeningSims after the shown block's.
   */
  blocks: Record<SimStage, SimNormals>;
  seed: number;
  /**
   * The baseline on the shown block: LeagueModel.odds exactly (the same setup and seasons; the file header), which the
   * League page reads too: eliminated, weekly win chances, P(playoffs) (so the partner profiles, the star premium, λ's and
   * λ_P's defaults and the context's notes read the League page's numbers).
   */
  odds: SeasonOdds;
  base: Record<SimStage, MyOdds>;
  /**
   * Phase 7a (planner reply to Checkpoint 4c, A2): the "Helps you" calibration run on the shown block against `odds`
   * (league.ts helpsCalibrationOf, the League model's step 8c on the same seasons and setup: LeagueModel.helpsCalibration
   * exactly). helpsScaleOf turns it into B₃ for a call's goal and λ. Null without my team.
   */
  calibration: HelpsCalibration | null;
  /** Checkpoint 7c: the season model `odds` simulates (season.pickupSeasonModel: every team's TeamModel.scoreWithPickups), which each partner's calibration run reads. */
  season: SeasonModel;
  /**
   * Checkpoint 7c (planner reply to Checkpoint 7b, §7, "Helps them"): each partner's calibration run by team id, the same run
   * as `calibration` with that team's score + 3 a week (league.ts helpsCalibrationOf), on the shown block against `odds`, made
   * when first needed (partnerCalibrationOf; null when none could be made). Memoized per context: the Analyzer pays one run
   * the first time it evaluates a trade with a team, a search one per partner of the trades it shows.
   */
  partners: Map<string, HelpsCalibration | null>;
  /**
   * Checkpoint 7e (planner reply to Checkpoint 7d, item 1.1; the file header): the ranking block's own baseline, calibration
   * and partners' runs, which the screening and ranking stages are scored on (a search pays one partner run per partner of
   * its exact trades here). The shown block's very fields (`odds`, `calibration`, `partners`) when the two blocks are the
   * same seasons (config.simulation.shownSims at most finalSims), so nothing is simulated twice.
   */
  rank: BlockScale;
  /**
   * Checkpoint 7f (planner reply to Checkpoint 7e, answer 2: "simulate only the 15,000 seasons the ranking run doesn't already
   * cover"; the file header): whether a run on the shown block continues the same run on the ranking block, its first
   * finalSims seasons (sim.ts SimOptions.resume: the full run's numbers, bit for bit): the two blocks aren't one, and
   * TradeContextOptions.resume isn't false. Runs on the ranking block keep their progress only then.
   */
  resume: boolean;
  /**
   * Checkpoint 7f: each run's progress on the ranking block by its rows (rankProgressOf: my row's side evaluation, then the
   * partner's; a key of its own for a row the run doesn't replace), for the same rows' run on the shown block to continue.
   * Kept for the context's life, as its side evaluations are (sideEval's memo), so a re-filter's cards, an offer's version
   * the search ranked and the Analyzer on a card's trade continue theirs too.
   */
  rankRuns: WeakMap<object, WeakMap<object, SimProgress>>;
  /** Checkpoint 7f: each partner's calibration run's progress on the ranking block (partnerCalibrationOf), by team id, for its run on the shown block to continue. */
  partnerProgress: Map<string, SimProgress>;
}

/** A scale block's baseline and calibration runs: the shown block's (SimState's own fields) or the ranking block's (SimState.rank). */
function blockScale(sim: SimState, block: ScaleBlock): BlockScale {
  return block === "shown" ? sim : sim.rank;
}

/** SimState.rankRuns' key for a row a run doesn't replace (the baseline's own: no side evaluation of mine, or no partner's). */
const NO_ROW: object = Object.freeze({});

/**
 * The progress a run of these rows on the shown block continues (Checkpoint 7f; runSim): the same rows' run on the ranking
 * block (SimState.rankRuns: `mine` my row's side evaluation, `theirs` the partner's; null, a row the run doesn't replace).
 * Undefined when that run wasn't made, or kept nothing (SimState.resume false).
 */
export function rankProgressOf(sim: Pick<SimState, "rankRuns">, mine: SideEval | null, theirs: SideEval | null): SimProgress | undefined {
  return sim.rankRuns.get(mine ?? NO_ROW)?.get(theirs ?? NO_ROW);
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
   * P(playoffs) from the baseline on the shown block (every team at V*: LeagueModel.odds). premiumOf and harderToGetFor read it.
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
  /** Item 2.1's either-way moves (TradeContextOptions.eitherWay; on unless a test says otherwise). */
  eitherWay: boolean;
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

/** No kept player (legalSide: a side without untouchables). */
const NONE_KEPT: ReadonlySet<string> = new Set();

/**
 * Why a trade is illegal when legality's drop can't be made because every player it could drop is one of my untouchables
 * (Checkpoint 7e; planner reply to Checkpoint 7d, item 3.3: "If every candidate is untouchable, say so, for example 'All your
 * RBs are untouchable.'"; the lead's words): rule 1, a position over its limit (`pos`), "Every RB you could drop is
 * untouchable."; rule 2, the roster size (`pos` null), "Every player you could drop to make room is untouchable." The
 * Analyzer shows it; the search never suggests such a trade.
 */
export function untouchableDropNote(pos: Pos | null): string {
  return pos === null ? "Every player you could drop to make room is untouchable." : `Every ${(POS_WORDS[pos] ?? [pos])[0]} you could drop is untouchable.`;
}

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
    // The automatic playoff weight (league.ts step 5c) on this context's shown block: the seasons the League page's model
    // measures it on (its headline's), so every ROS(T) here weighs the playoff weeks as the League page does.
    playoffWeightSims: opts.playoffWeightSims ?? simCounts().shown,
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
    eitherWay: opts.eitherWay !== false,
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
      keep: t.keep,
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
          const { screen: screenSims, final: finalSims, shown: shownSims } = simCounts();
          const Wk = setup.setup.weeks.length;
          const T = setup.setup.teams.length;
          const per = Wk * T;
          // One matrix of shownSims + screeningSims seasons (Checkpoint 7e): the shown block (every number a page prints, and
          // its baseline) reads the first shownSims, the League model's own seasons (so its baseline odds are
          // LeagueModel.odds); the ranking block, the search's final simulation, its first finalSims (the same draws); the
          // screening the next screeningSims, seasons neither of them reads (no selection bias in the shown B). When the
          // automatic playoff weight drew the shown block already (league.ts step 5c, PlayoffWeightSim: the same seed, count,
          // weeks and teams), it is that block, and only the screening block is drawn here (sim.simNormals from season
          // shownSims on: the same draws).
          const pw = league.playoffWeightSim;
          const drawn = pw && pw.sims === shownSims && pw.seed === simSeed && pw.normals.weeks === Wk && pw.normals.teams === T ? pw.normals : null;
          let shown: SimNormals;
          let screen: SimNormals;
          if (drawn) {
            shown = drawn;
            screen = simNormals(simSeed, screenSims, Wk, T, shownSims);
          } else {
            const all = simNormals(simSeed, shownSims + screenSims, Wk, T);
            shown = { sims: shownSims, weeks: Wk, teams: T, z: all.z.subarray(0, shownSims * per) };
            screen = { sims: screenSims, weeks: Wk, teams: T, z: all.z.subarray(shownSims * per, (shownSims + screenSims) * per) };
          }
          // The ranking block: the shown block's first finalSims seasons (simCounts: never more than shownSims), the shown
          // block itself when they're the same seasons.
          const same = finalSims === shownSims;
          const final: SimNormals = same ? shown : { sims: finalSims, weeks: Wk, teams: T, z: shown.z.subarray(0, finalSims * per) };
          const blocks: Record<SimStage, SimNormals> = { screen, final, shown };
          const on = (normals: SimNormals) => ({ sims: normals.sims, seed: simSeed, normals, highScores });
          // Checkpoint 7f (planner reply to Checkpoint 7e, answer 2; sim.ts, "Continuing a run"): the ranking block is the shown
          // block's first seasons, the same matrix from its season 0, so a run on the shown block continues the same run on
          // the ranking block and plays only the seasons the ranking block doesn't hold (TradeContextOptions.resume false:
          // every one in full); runs on the ranking block keep their progress for it.
          const resume = !same && opts.resume !== false && final.z.buffer === shown.z.buffer && final.z.byteOffset === shown.z.byteOffset;
          // The baseline on the ranking block (the same setup on its seasons), then on the shown block continuing it, whose
          // odds are LeagueModel.odds exactly; one run when the two are the same seasons.
          const rankRun = same ? null : seasonOddsWith(snapshot, seasonModel, { ...on(final), keep: resume });
          const shownRun = seasonOddsWith(snapshot, seasonModel, { ...on(shown), ...(rankRun?.res.progress ? { resume: rankRun.res.progress } : {}) });
          const ranking = same ? shownRun : rankRun;
          if (shownRun && ranking) {
            const odds = shownRun.odds;
            const rankOdds = ranking.odds;
            const unknown: MyOdds = { pPlayoffs: 0, pTitle: null, expWins: 0, prizes: { first: null, second: null, third: null, weeklyHigh: 0, pointsLeader: 0 }, weekly: [], teams: [] };
            const partners = new Map<string, HelpsCalibration | null>();
            const sim: SimState = {
              built: setup,
              highScores,
              blocks,
              seed: simSeed,
              odds,
              base: { screen: unknown, final: unknown, shown: unknown },
              calibration: null,
              season: seasonModel,
              partners,
              rank: same ? { odds, calibration: null, partners } : { odds: rankOdds, calibration: null, partners: new Map() },
              resume,
              rankRuns: new WeakMap(),
              partnerProgress: new Map(),
            };
            I.sim = sim;
            if (I.me) {
              sim.base.screen = runSim(I, null, null, "screen");
              // The baseline's runs on the shown and ranking blocks are the very runs behind `odds` and `rankOdds` (the same setup,
              // season.buildSimSetup of the same season model, on the same seasons), read as runSim reads a run (Checkpoint 7f:
              // until then runSim played each of them again).
              sim.base.shown = myOddsOf(I, shownRun.res);
              sim.base.final = same ? sim.base.shown : myOddsOf(I, ranking.res);
              // The "Helps you" calibration (B₃'s run): the League model's step 8c on the same block and setup, on the ranking
              // block, then on the shown block continuing it (LeagueModel.helpsCalibration exactly).
              const rankCal = same ? null : helpsCalibrationRun(snapshot, seasonModel, I.me.id, rankOdds, on(final), tw.from, config, { keep: resume });
              sim.calibration = helpsCalibrationRun(snapshot, seasonModel, I.me.id, odds, on(shown), tw.from, config, rankCal?.progress ? { resume: rankCal.progress } : {}).calibration;
              sim.rank.calibration = rankCal ? rankCal.calibration : sim.calibration;
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
 * LeagueModelBuild.pickups). A return never releases one of the team's kept players (TeamState.keep: my untouchables on my
 * side; Checkpoint 7e, item 3.3). Memoized by team, roster and spec, so a roster the trade leaves as it was gives the very same
 * numbers (the no-op test).
 */
export function sideEval(I: TradeInternals, t: Pick<TeamState, "index" | "stream" | "keep">, run: OptimizedRoster, spec: StreamSpec = t.stream, priced?: FinalLineups): SideEval {
  const key = `${t.index}\u0004${rosterKey(run.roster, spec)}`;
  const hit = I.sideMemo.get(key);
  if (hit) return hit;
  const { league } = I;
  const final = priced ?? finalRunLineups(league, run, spec, t.keep);
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
  // The side's kept players: my untouchables on my side, never a drop of rules 1 and 2 (Checkpoint 7e; planner reply to
  // Checkpoint 7d, item 3.3; TeamState.keep); none on the partner's.
  const kept: ReadonlySet<string> = side.keep.length ? new Set(side.keep) : NONE_KEPT;

  // 1. Positions over their limit: drop the position's lowest keep value player not just received, never a kept one (when
  // only kept ones could go, the trade is illegal, and the reason says so: untouchableDropNote).
  if (limits) {
    for (const pos of POSITIONS) {
      const limit = limits[pos];
      if (limit === undefined || !Number.isFinite(limit)) continue;
      const cap = Math.max(limit, countBefore(pos));
      while (countNow(pos) > cap) {
        const at = roster.filter((id) => !inbound.has(id) && hasRow(id) && I.league.posOf(id) === pos);
        const cands = kept.size ? at.filter((id) => !kept.has(id)) : at;
        const kv = cands.length ? keepValues(I, roster, spec, mode, evMode ? ev() : null) : null;
        const k = kv ? dropOrder(I, kv.keep, cands, kv.tie).next().value : undefined;
        if (k === undefined) return { illegal: at.length > cands.length ? untouchableDropNote(pos) : `${who} can have at most ${posWords(pos, limit)}.` };
        drop(k, kv?.raw ?? null);
      }
    }
  }
  // Rule 1's drops are the first ones (RosterChange.limitDrops: the card words them apart from rule 2's; Checkpoint 7e).
  const limitDrops = drops.length;

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
      const all = roster.filter((id) => {
        if (inbound.has(id) || adds.includes(id) || !hasRow(id)) return false;
        const pos = I.league.posOf(id);
        if (pos !== undefined && streamedHere.has(pos) && countNow(pos) <= 1) return false; // the last one at a streamed position
        return !(minTarget(pos) > 0 && countNow(pos as Pos) <= minTarget(pos));
      });
      // Never a kept one (my untouchables: `kept` above).
      const cands = kept.size ? all.filter((id) => !kept.has(id)) : all;
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
      /** Whether the starting lineup doesn't need him: the fill rule (sparedIn first, a shortcut it implies). */
      const canGo = (id: string): boolean => {
        if (sparedIn(id)) return true;
        fill ??= fillCount(entries(roster), I.league.slots);
        return fillCount(entries(roster.filter((x) => x !== id)), I.league.slots) >= fill;
      };
      for (const id of kv ? dropOrder(I, kv.keep, cands, kv.tie) : []) {
        if (canGo(id)) {
          k = id;
          break;
        }
      }
      if (k === undefined) {
        // Only kept players could go (each one the rules above allow, the lineup not needing him): say so.
        if (all.length > cands.length && all.some((id) => kept.has(id) && canGo(id))) return untouchableDropNote(null);
        return `${who} would have more than ${maxSize} players on the active roster, and nobody can be dropped without leaving a starting spot empty.`;
      }
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
  const change: RosterChange = { drops, adds, ...(limitDrops ? { limitDrops } : {}), ...(openSpots.length ? { openSpots } : {}) };
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
  /**
   * Checkpoint 7d (planner reply to Checkpoint 7c, answer 2: "their lineup gain > 0" on the fast method): the partner's
   * ΔLineup_P on this screen, points a week (acceptance.partnerLineupDelta's blend of the next weeks and the rest of the
   * season, EV lineups from V*(P)), the number the quick acceptance's n is made from. search.ts's helps-both lane reads it.
   */
  partnerDelta: number;
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
    partnerDelta: delta.blended,
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
    // but under openSpotFill "bestAny" (Checkpoint 7b's rule, for the trade report), nor one of my untouchables (TeamState.
    // keep, mine only; Checkpoint 7e, planner reply to Checkpoint 7d, item 3.3).
    const keep = [...(I.openSpotFill === "bestAny" ? [] : l.change.adds), ...s.team.keep];
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

// ---------------------------------------------------------------------------------------------
// No credit for moves I could make anyway (Checkpoint 7e; planner reply to Checkpoint 7d, item 2.1), and the card's list of
// my roster moves (item 2.2)

/**
 * A roster's lineup points as the free-agent optimizer judges a move (optimizer.ts's header: scenario ROS when it judges in
 * scenario lineups, else EV ROS; Σω-weighted over the weeks team numbers count, my streaming rows and IR returners in).
 */
function judgedRos(I: Pick<TradeInternals, "league">, roster: readonly string[], stream: StreamSpec): number {
  const opt = I.league.optimizer;
  const scen = opt.judgesScenarios ? opt.scenarioValuesOf(roster, stream) : null;
  return scen ? rosValue(scen.mean, opt.setup.weights) : opt.evaluate(roster, stream).evRos;
}

/**
 * Whether my free-agent optimizer could add `add` to `roster` at all (optimizer.ts's candidate rules, the ones V* applies):
 * he has a model, isn't on the roster, isn't one another team claims in the baseline (TeamState.pool, excl(me)) and isn't at
 * a position the optimizer leaves alone (K, D/ST, a position I stream).
 */
function claimableOn(I: TradeInternals, me: TeamState, roster: readonly string[], add: string): boolean {
  const opt = I.league.optimizer;
  const row = opt.setup.rows.get(add);
  if (!row || roster.includes(add) || me.pool.excluded.has(add)) return false;
  return !opt.cfg.optimizerExcluded.includes(row.pos) && !me.stream.positions.includes(row.pos);
}

/**
 * Whether my free-agent optimizer could make move `m` from `roster` (optimizer.ts's candidate and drop rules, the ones V*
 * applies): its free agent claimable there (claimableOn); into an open spot only when the roster has one; its drop is on the
 * roster with a model, at no position the optimizer leaves alone, not untouchable (TradeSettings.untouchables, Checkpoint
 * 7e's setting: never dropped), not needed to fill the starting lineup unless the newcomer fills it again (optimizer.fillCount,
 * my streaming rows counting), the position limits hold after the move and, with long-term values, the dynasty guard does.
 */
function canMakeOn(I: TradeInternals, me: TeamState, roster: readonly string[], m: Pick<FaStep, "add" | "drop">): boolean {
  if (!claimableOn(I, me, roster, m.add)) return false;
  const opt = I.league.optimizer;
  const setup = opt.setup;
  const on = new Set(roster);
  const row = setup.rows.get(m.add) as TableRow;
  const excluded = new Set<Pos>([...opt.cfg.optimizerExcluded, ...me.stream.positions]);
  const positions = roster.flatMap((id) => {
    const info = setup.info(id);
    return info ? [info.pos] : [];
  });
  if (m.drop === null) return roster.length < setup.maxRosterSize && positionAllows(setup.positionLimits, positions, row.pos);
  const drop = setup.rows.get(m.drop);
  if (!drop || !on.has(m.drop) || excluded.has(drop.pos) || I.settings.untouchables.includes(m.drop)) return false;
  const left = [...positions];
  const at = left.indexOf(drop.pos);
  if (at >= 0) left.splice(at, 1);
  if (!positionAllows(setup.positionLimits, left, row.pos)) return false;
  const dyn = setup.dynasty;
  if (dyn && dyn.value(m.drop) - dyn.value(m.add) > dyn.maxDrop + EPS) return false;
  const entries = (ids: readonly string[]) => [
    ...ids.flatMap((id) => {
      const info = setup.info(id);
      return info ? [{ id, pos: info.pos, eligible: info.eligible }] : [];
    }),
    ...me.stream.rows.map((r) => ({ id: r.id, pos: r.pos, eligible: r.eligible })),
  ];
  const fill = fillCount(entries(roster), setup.slots);
  const rest = entries(roster.filter((id) => id !== m.drop));
  return fillCount(rest, setup.slots) >= fill || fillCount([...rest, { id: row.id, pos: row.pos, eligible: row.eligible }], setup.slots) >= fill;
}

/**
 * The move my free-agent optimizer itself would make from `roster` with `add` the only free agent it may pick up (one move,
 * the rest of the pool left out, my untouchables kept: optimizer.ts's own rules for whom it drops, its pickup bar in the
 * lineups it judges moves in, and its near-tie cut), or null when it makes none there. Memoized by the optimizer (its memo
 * key holds the roster and the pool).
 */
function stepWith(I: TradeInternals, me: TeamState, roster: readonly string[], add: string): FaStep | null {
  const opt = I.league.optimizer;
  const pool = poolRestriction(opt.setup.freeAgents.filter((id) => id !== add));
  const step = opt.optimize(roster, me.stream, 1, pool, I.settings.untouchables).moves[0];
  return step && step.add === add ? step : null;
}

/**
 * A trade's either-way moves (Checkpoint 7e; planner reply to Checkpoint 7d, item 2.1: "an optional free-agent move belongs
 * to the trade only if the trade is what makes it worthwhile. When the trade's version of the roster wants an optional move
 * the baseline doesn't make, test that move against the baseline with the same pickup bar: if it clears the bar there too,
 * apply it in both versions; if it doesn't, keep it with the trade."). An optional move is a step of my free-agent optimizer
 * after the trade, V*(after), whose free agent isn't one of my baseline's pickups (V*(T)'s, the League page's); in V*(after)'s
 * order, each is tried on my baseline roster V*(T) with the either-way moves found so far: when V* could make it there
 * (canMakeOn: its drop is on that roster, its free agent mine to claim, the rules V* applies) and it gains at least the
 * pickup bar as V* judges a move (judgedRos: the same lineups and Σω-weighted weeks; the optimizer's own faMinGain, ×
 * Σω ÷ Σω₀: LineupThresholds), it's an either-way move: made in both versions. ⚠️ Ours (review of wave B, finding B-2): when
 * that very move can't be made there for a reason of its drop (the drop isn't on that roster, most often a player my baseline
 * already cut for one of its own pickups; or an open-spot add with no open spot there; or a drop V* may not make there) but
 * its free agent is mine to claim, the free agent is tried with the drop my optimizer itself would make for him there
 * (stepWith), and when it makes that pickup, that move is the either-way one (the decisions' first reading kept such a pickup
 * with the trade, so a trade got full credit for a pickup I could make anyway: on a league whose pickups were held to one a
 * run, giving away a bench RB for nothing read Helps you 70). Else it stays with the trade (as every one did before). Forced
 * moves never come here (legality's drops, roster-minimum adds and open-spot fills, IR placements and the releases when an IR
 * player returns: they aren't V*(after)'s steps). ⚠️ Ours: the gain is the difference of the two rosters' judged ROS (the
 * optimizer prices a move from its cells: the two agree to float noise), and the optimizer's move cap (faMaxMoves) isn't
 * applied (the planner's rule names the bar alone). ⚠️ By construction V*(T) stops only when no move from its roster clears
 * the bar, so an optional move clears it there only when V*(T) stopped at its move cap, or couldn't make it (a free agent its
 * own run added and swapped away), or a near-tie cut (optimizer.ts) left it a different roster: on both of Parker's leagues
 * (Oct 14 week 6 dumps) none of the searches' 31 and 112 optional moves does (the largest, +Tyler Allgeier −Josh Jacobs in
 * the second, gains 4.17 against a bar of 4.94), and neither does any free agent of theirs with another drop. My side only
 * (my odds and Helps them read the trade's own "before", the partner's acceptance the trade itself). None for an inactive
 * side (I'm never one), without moves, or under TradeContextOptions.eitherWay false (evaluateExact).
 */
export function eitherWayMoves(I: TradeInternals, me: TeamState, after: Pick<OptimizedRoster, "moves">): FaStep[] {
  if (!after.moves.length || me.inactive) return [];
  const start = new Set(me.vstar.start);
  const own = new Set(me.vstar.roster.filter((id) => !start.has(id)));
  const bar = I.league.optimizer.cfg.faMinGain;
  let roster: readonly string[] = me.vstar.roster;
  let ros: number | null = null;
  const out: FaStep[] = [];
  for (const m of after.moves) {
    if (own.has(m.add) || !claimableOn(I, me, roster, m.add)) continue;
    let step: FaStep | null = null;
    if (canMakeOn(I, me, roster, m)) {
      const next = applyStep(roster, m);
      ros ??= judgedRos(I, roster, me.stream);
      if (judgedRos(I, next, me.stream) - ros >= bar - EPS) step = m;
    } else step = stepWith(I, me, roster, m.add);
    if (!step) continue;
    out.push(step);
    roster = applyStep(roster, step);
    ros = null;
  }
  return out;
}

/** A trade's "before" with its either-way moves (item 2.1): my baseline V*(T) with them made, as an optimizer run's roster (sideEval prices it). */
function eitherWayRun(I: TradeInternals, me: TeamState, either: readonly FaStep[]): OptimizedRoster {
  let roster: readonly string[] = me.vstar.roster;
  for (const m of either) roster = applyStep(roster, m);
  const cur = I.league.optimizer.evaluate(roster, me.stream);
  return { start: me.vstar.start, roster, moves: [...me.vstar.moves, ...either], team: cur.team, solved: cur.solved, evRos: cur.evRos, given: [] };
}

/** Each per-trade "before"'s simulation runs (item 2.1), by its side (sideEval memoizes a side by roster) and block. */
const beforeRuns = new WeakMap<SideEval, Partial<Record<SimStage, MyOdds>>>();

/** The run of a trade's own "before" on a block (item 2.1): the baseline's setup with my row replaced by `before`'s, memoized. */
function beforeOddsOf(I: TradeInternals, before: SideEval, stage: SimStage): MyOdds {
  let runs = beforeRuns.get(before);
  if (!runs) {
    runs = {};
    beforeRuns.set(before, runs);
  }
  return (runs[stage] ??= runSim(I, before, null, stage));
}

/**
 * The player each pickup of an optimizer run holds the spot of, through swaps (a pickup later swapped for another passes the
 * spot on; null: an open spot): the run's pickups still on its roster are its keys.
 */
function pickupSpots(moves: readonly Pick<FaStep, "add" | "drop">[]): Map<string, string | null> {
  const spot = new Map<string, string | null>();
  for (const m of moves) {
    if (m.drop !== null && spot.has(m.drop)) {
      spot.set(m.add, spot.get(m.drop) ?? null);
      spot.delete(m.drop);
    } else spot.set(m.add, m.drop);
  }
  return spot;
}

/**
 * My roster moves a trade's numbers assume (Checkpoint 7e; planner reply to Checkpoint 7d, item 2.2: "Each card lists every
 * roster move its numbers assume, in order, each with its reason and its week … Moves Parker would make either way, like his
 * Malik Washington pickup, aren't listed as part of the trade. One line can say they're assumed either way."; TradeEvaluation.
 * myMoves, tradeModel.ts RosterMove), against the trade's "before" (`sides.before`: my baseline V*(T) with its either-way moves,
 * item 2.1). Since the review of wave B (findings B-1, B-3, moves-skip-reason-spot-taken, moves-waiver-takes-pickup-drop,
 * moves-before-release-unnamed) the list names every way my roster after the trade differs from the "before", the trade's own
 * players aside, each once, and nothing that doesn't (evaluate.moves.test.ts checks it on every exact trade of whole
 * searches): this week, the players of my roster as it stands that the "before" keeps and the roster after the trade drops
 * ("lost"), the ones the "before" drops and the roster after the trade keeps ("kept"), the "before"'s pickups the roster after
 * the trade leaves out, the free agents it holds that the "before" doesn't, and the players the trade brings in whom my
 * pickups drop again; later, each IR player's return where the two release different players. Each goes with the move that
 * makes it, worded by its cause; a move whose drop the "before" makes too stands for what that drop costs against the
 * "before" (took): the player himself; a player the trade brings in; nothing (an open spot); or the "before"'s pickup for his
 * spot when the roster after the trade leaves that pickup out; and when the roster after the trade holds that pickup too, the
 * pickup is made either way with him as its drop, and the move takes over the pickup's own spot after the trade, read the
 * same way. In order:
 * - Legality's rule-1 drops the "before" doesn't make ("positionLimit"); its rule-2 drops ("makeRoom", to make room for the
 *   players received beyond those given: none named when my pickups drop one of them, finding B-3), each read through
 *   took (⚠️ ours, as before: on Parker's first league, Oct 14, Puka Nacua → Drake London + Christian Watson: legality drops
 *   Romeo Doubs, whom the baseline cuts for Jake Ferguson, and my pickups then cut Kyle Pitts Sr. for Ferguson: "Make room for
 *   Christian Watson: drop Kyle Pitts Sr." and "Assumed with or without this trade: add Jake Ferguson, drop Romeo Doubs."; a
 *   rule-2 drop that stands for a pickup the trade leaves out gives that pickup's skip, "spot"); its roster-minimum adds and
 *   open-spot fills ("rosterMinimum", "openSpot"; one that is a pickup of the "before" too says so, with the player the
 *   "before" drops for him when the roster after the trade keeps him: finding B-1); its IR placements ("toIR").
 * - My pickups after the trade that the "before" doesn't make ("waiver": they stay with the trade, item 2.1), each with what
 *   its drop costs (took: a pickup of the "before" it takes the place of is named instead, finding
 *   moves-waiver-takes-pickup-drop).
 * - The "before"'s pickups the roster after the trade holds with another drop ("pickupDrop", with the "before"'s own drop
 *   kept: "instead"), or with the same one (assumed either way); ⚠️ ours, as before: one whose own drop I send away (a player
 *   my baseline cuts anyway: legality's rule 4 opens no spot for him) and that my pickups make with another drop names that
 *   drop on the make-room line, the pickup assumed either way.
 * - The "before"'s pickups the roster after the trade leaves out ("skip"): "taken" when the partner, claiming before me, picks
 *   him up after the trade; "spot" when the players this trade brings in take his roster spot (his drop goes in the trade or
 *   to make room for them; finding moves-skip-reason-spot-taken); else "unneeded".
 * - A difference nothing above names ("drop", "keep", "add": none on any test league, a safety net).
 * - Later weeks (finding moves-before-release-unnamed): at each IR player's return where the "before" and the roster after the
 *   trade release different players (Displacement, one per returner), the release after the trade with the "before"'s
 *   ("release": `instead`, `kept` when he's still on my roster then), or, when the roster after the trade releases nobody
 *   then, the player the "before" would ("keepAtReturn", when he's still on my roster), by week. A release the near-tie rule
 *   decided after the trade says why (`nearTie`: Checkpoint 7f, planner reply to Checkpoint 7e, answer 4: "keep the rule, but
 *   the card must say why"; returners.Displacement.keptInstead, and whether the player released is mine as imported).
 * - Assumed with or without the trade: the League page's pickups my roster after the trade holds too, each with the drop the
 *   "before" makes for him (none named when that player is traded away), then the either-way moves, then the players dropped
 *   in both versions whom none of those names; and (Checkpoint 7f, the lead's R3) at each return where the two release the
 *   same player from the same week, that release, by week, with why when the near-tie rule decided it after the trade
 *   (`assumedLater`).
 */
function myRosterMoves(
  I: TradeInternals,
  me: TeamState,
  trade: { give: readonly string[]; get: readonly string[] },
  legal: Pick<LegalSide, "change" | "toIR" | "givenIR">,
  run: Pick<OptimizedRoster, "roster" | "moves">,
  either: readonly FaStep[],
  sides: { mine: Pick<SideEval, "displaced" | "ev">; before: Pick<SideEval, "displaced" | "roster"> },
  partnerAdds: ReadonlySet<string>,
): RosterMoves {
  const weeks = I.league.lp.weeks.weeks;
  const now = weeks[I.from] ?? I.snapshot.currentWeek;
  const asStands = me.vstar.start;
  const given = new Set(trade.give);
  const before = new Set(sides.before.roster);
  const after = new Set(run.roster);
  const eitherAdds = new Set(either.map((m) => m.add));
  const ew = (p: string) => (eitherAdds.has(p) ? { eitherWay: true as const } : {});
  // The "before"'s pickups (the League page's, then the either-way moves) and mine after the trade, each with the player whose
  // spot it holds (null: an open spot), through swaps; and the "before"'s pickup for each player it drops.
  const beforeSpot = pickupSpots([...me.vstar.moves, ...either]);
  const afterSpot = pickupSpots(run.moves);
  const pickupFor = new Map<string, string>();
  for (const [p, d] of beforeSpot) if (d !== null) pickupFor.set(d, p);
  const order = [...new Set([...me.vstar.roster.filter((id) => beforeSpot.has(id) && !eitherAdds.has(id)), ...either.map((m) => m.add).filter((id) => beforeSpot.has(id))])];
  const receivedActive = trade.get.filter((id) => !legal.toIR.includes(id));
  const givenActive = trade.give.filter((id) => !legal.givenIR.includes(id));
  // The differences (the trade's own players aside): lost, kept, and the players it brings in that my pickups drop again.
  const lost = new Set(asStands.filter((id) => !given.has(id) && before.has(id) && !after.has(id)));
  const kept = new Set(asStands.filter((id) => !given.has(id) && !before.has(id) && after.has(id)));
  const droppedIn = new Set(receivedActive.filter((id) => !after.has(id)));
  /** The differences a move already names (each once), and the "before"'s pickups already placed. */
  const named = new Set<string>();
  const settled = new Set<string>();
  /** The "before"'s pickups made either way, with the drop the assumed line names for each. */
  const assumedDrop = new Map<string, string | null>();
  /** The "before"'s pickups whose roster spot the trade's players take ("spot"), with whom to name. */
  const spotTaken = new Map<string, string[]>();
  /** A skipped pickup's kept player, passed on by a pickup of the "before" that took its spot. */
  const keepFor = new Map<string, string>();
  // The players received beyond those given (a given player the "before" drops anyway opens no spot: legality's rule 4), to
  // make room for; none when my pickups drop one of the players the trade brings in (review of wave B, finding B-3). ⚠️ Ours
  // (the final review of Checkpoint 7e, UI-F-6): those with the fewest rest-of-season points (ties: the smaller id), so a trade
  // names the same players whichever way it was evaluated; it took the trade's own order, which the search, a ladder (key
  // order) and the Analyzer (the order the user picked) each build their own way.
  const cuts = new Set(asStands.filter((id) => !before.has(id)));
  const givenSpots = givenActive.filter((id) => !cuts.has(id));
  const rosOf = (id: string) => I.league.lp.players[id]?.ros.total ?? 0;
  const mostRos = [...receivedActive].sort((a, b) => rosOf(b) - rosOf(a) || byId(a, b));
  const forPlayers = droppedIn.size ? [] : mostRos.length > givenSpots.length ? mostRos.slice(givenSpots.length) : [];

  type Took = { kind: "lost" | "in"; id: string } | { kind: "open" } | { kind: "instead"; pickup: string };
  const took = (x: string | null, seen: Set<string> = new Set()): Took => {
    if (x === null) return { kind: "open" };
    if ((lost.has(x) || droppedIn.has(x)) && !named.has(x)) {
      named.add(x);
      return { kind: lost.has(x) ? "lost" : "in", id: x };
    }
    const p = pickupFor.get(x);
    if (p === undefined || seen.has(x) || settled.has(p)) return { kind: "open" };
    seen.add(x);
    if (!after.has(p)) return { kind: "instead", pickup: p };
    settled.add(p);
    if (!afterSpot.has(p)) return { kind: "open" };
    assumedDrop.set(p, x);
    return took(afterSpot.get(p) ?? null, seen);
  };

  // Legality's adds that are pickups of the "before" too (review of wave B, finding B-1): their lines say so, with the
  // player the "before" drops for him when my roster after the trade keeps him.
  const pickupOf = new Map<string, PickupOf>();
  for (const id of legal.change.adds) {
    if (!beforeSpot.has(id) || !after.has(id)) continue;
    const d = beforeSpot.get(id) ?? null;
    const keep = d !== null && kept.has(d) && !named.has(d) ? d : null;
    if (keep !== null) named.add(keep);
    pickupOf.set(id, { keep, ...ew(id) });
    settled.add(id);
  }

  // Legality's drops: rule 1's the "before" doesn't make (one it makes too is that pickup's to say), then rule 2's, each read
  // through took.
  const limitCount = Math.max(0, Math.min(legal.change.limitDrops ?? 0, legal.change.drops.length));
  const moves: RosterMove[] = [];
  for (const id of legal.change.drops.slice(0, limitCount)) {
    if (!lost.has(id) || named.has(id)) continue;
    named.add(id);
    const pos = I.league.posOf(id);
    const limit = pos === undefined ? undefined : I.league.limits?.[pos];
    if (pos !== undefined && limit !== undefined && Number.isFinite(limit)) moves.push({ kind: "positionLimit", week: now, drop: id, pos, limit });
    else moves.push({ kind: "makeRoom", week: now, drop: [id], for: [] });
  }
  const room: string[] = [];
  const roomIn: string[] = [];
  const toRoom = (t: Took): void => {
    if (t.kind === "lost" || t.kind === "in") {
      room.push(t.id);
      if (t.kind === "in") roomIn.push(t.id);
    } else if (t.kind === "instead" && !partnerAdds.has(t.pickup)) spotTaken.set(t.pickup, forPlayers);
  };
  for (const id of legal.change.drops.slice(limitCount)) toRoom(took(id));

  // Legality's adds and IR placements.
  const legalLines: RosterMove[] = [];
  const spots = legal.change.openSpots ?? [];
  const filled = new Set(spots.map((s) => s.playerId));
  const minimums = I.snapshot.settings.rosterMinimums;
  for (const id of legal.change.adds) {
    named.add(id);
    if (filled.has(id)) continue;
    const pos = I.league.posOf(id) ?? null;
    const min = pos === null ? undefined : minimums?.[pos];
    const pickup = pickupOf.get(id);
    legalLines.push({ kind: "rosterMinimum", week: now, add: id, pos, min: min !== undefined && Number.isFinite(min) ? min : null, ...(pickup ? { pickup } : {}) });
  }
  for (const s of spots) {
    const pickup = pickupOf.get(s.playerId);
    legalLines.push({ kind: "openSpot", week: now, spot: { ...s, ...(s.short ? { short: [...s.short] } : {}) }, ...(pickup ? { pickup } : {}) });
  }
  for (const id of legal.toIR) legalLines.push({ kind: "toIR", week: now, player: id });

  // My pickups after the trade that the "before" doesn't make: the waiver moves that stay with the trade (item 2.1).
  const waivers: RosterMove[] = [];
  for (const q of run.roster) {
    if (!afterSpot.has(q) || before.has(q)) continue;
    named.add(q);
    const t = took(afterSpot.get(q) ?? null);
    const starts = startWeeksOf(I, sides.mine.ev, [q])[q] ?? [];
    const base = { kind: "waiver" as const, week: now, add: q, ...(starts.length ? { starts } : {}) };
    if (t.kind === "lost") waivers.push({ ...base, drop: t.id });
    else if (t.kind === "in") waivers.push({ ...base, drop: t.id, received: true });
    else if (t.kind === "instead" && !partnerAdds.has(t.pickup)) {
      settled.add(t.pickup);
      waivers.push({ ...base, drop: null, insteadOf: t.pickup, ...(eitherAdds.has(t.pickup) ? { insteadOfEitherWay: true as const } : {}) });
    } else waivers.push({ ...base, drop: null });
  }

  // The "before"'s pickups my roster after the trade holds too.
  const changed: RosterMove[] = [];
  for (const p of order) {
    if (settled.has(p) || !after.has(p)) continue;
    settled.add(p);
    if (!afterSpot.has(p)) continue;
    const d = beforeSpot.get(p) ?? null;
    const a = afterSpot.get(p) ?? null;
    if (a === d) {
      assumedDrop.set(p, d);
      continue;
    }
    const t = took(a);
    if (d !== null && given.has(d)) {
      // ⚠️ Ours (as before): its own drop goes in the trade (a player my baseline cuts anyway: legality's rule 4 opens no spot
      // for him), so the players received take that spot, and his drop after the trade makes room for them.
      assumedDrop.set(p, null);
      toRoom(t);
      continue;
    }
    const instead = d !== null && kept.has(d) && !named.has(d) ? d : null;
    if (instead !== null) named.add(instead);
    if (t.kind === "instead") {
      // He took the spot of another pickup of the "before", which my roster after the trade leaves out: he's made either way
      // with that spot's drop, and the other one's skip keeps his own drop (or the trade's players took the spot).
      assumedDrop.set(p, a);
      if (instead !== null) keepFor.set(t.pickup, instead);
      else if (!partnerAdds.has(t.pickup)) spotTaken.set(t.pickup, []);
      continue;
    }
    if (t.kind === "open" && instead === null) {
      assumedDrop.set(p, d !== null && !after.has(d) ? d : null);
      continue;
    }
    changed.push({ kind: "pickupDrop", week: now, add: p, drop: t.kind === "open" ? null : t.id, instead, ...(t.kind === "in" ? { received: true as const } : {}), ...ew(p) });
  }

  // The "before"'s pickups my roster after the trade leaves out.
  const skips: RosterMove[] = [];
  for (const p of order) {
    if (settled.has(p) || after.has(p)) continue;
    settled.add(p);
    const d = beforeSpot.get(p) ?? null;
    const own = d !== null && kept.has(d) && !named.has(d) ? d : null;
    if (own !== null) named.add(own);
    const keep = own ?? keepFor.get(p) ?? null;
    const spot = spotTaken.get(p);
    const why = partnerAdds.has(p) ? "taken" : spot !== undefined || (d !== null && given.has(d)) || (d === null && forPlayers.length > 0) ? "spot" : "unneeded";
    const by = why === "spot" ? (spot ?? forPlayers) : [];
    skips.push({ kind: "skip", week: now, add: p, keep, why, ...(by.length ? { by: [...by] } : {}), ...ew(p) });
  }

  // A difference none of the above names (none on any test league: the safety net, so the list still names it).
  const extra: RosterMove[] = [];
  for (const id of asStands) {
    if (named.has(id)) continue;
    if (lost.has(id)) extra.push({ kind: "drop", week: now, player: id });
    else if (kept.has(id)) extra.push({ kind: "keep", week: now, player: id });
  }
  for (const id of droppedIn) if (!named.has(id)) extra.push({ kind: "drop", week: now, player: id, received: true });
  const mine = new Set(asStands);
  const received = new Set(trade.get);
  for (const id of run.roster) if (!mine.has(id) && !received.has(id) && !before.has(id) && !named.has(id)) extra.push({ kind: "add", week: now, player: id });

  if (room.length) moves.push({ kind: "makeRoom", week: now, drop: room, for: forPlayers, ...(roomIn.length ? { received: roomIn } : {}) });
  moves.push(...legalLines, ...waivers, ...changed, ...skips, ...extra);

  // Later weeks: what happens at each IR player's return, where the "before" and my roster after the trade differ.
  const firstOf = (list: readonly Displacement[]) => {
    const out = new Map<string, Displacement>();
    for (const d of list) if (!out.has(d.returner)) out.set(d.returner, d);
    return out;
  };
  const relAfter = firstOf(sides.mine.displaced);
  const relBefore = firstOf(sides.before.displaced);
  const goes = new Map<string, number>();
  for (const d of sides.mine.displaced) goes.set(d.id, Math.min(goes.get(d.id) ?? Number.POSITIVE_INFINITY, d.from));
  // Whether a player is still on my roster after the trade at week index `from`: the returner himself while he's mine, else
  // one it holds this week and doesn't release by then.
  const stays = (id: string, returner: string, from: number) => (id === returner ? !given.has(id) : after.has(id) && !((goes.get(id) ?? Number.POSITIVE_INFINITY) <= from));
  // Why the near-tie rule released him after the trade (Checkpoint 7f; planner reply to Checkpoint 7e, answer 4): the player the
  // lineup alone would have released, and whether the released one is mine as imported (the League page's lock is there).
  const nearTieOf = (d: Displacement): { nearTie?: NearTieRelease } =>
    d.keptInstead !== undefined ? { nearTie: { keptInstead: d.keptInstead, lockable: me.roster.includes(d.id) || me.ir.includes(d.id) } } : {};
  const later: { from: number; move: RosterMove }[] = [];
  const alike: { from: number; release: AssumedRelease }[] = [];
  for (const returner of new Set([...relAfter.keys(), ...relBefore.keys()])) {
    const a = relAfter.get(returner);
    const b = relBefore.get(returner);
    if (a && b && a.id === b.id && a.from === b.from) {
      // The same release with or without the trade (the lead's R3): named in the card's line of moves made either way
      // (tradeView.ts myMovesLines; review of Checkpoint 7f, INTEGRATION-4), not as the trade's move.
      const week = weeks[a.from];
      if (week !== undefined) alike.push({ from: a.from, release: { week, player: a.id, returner, ...nearTieOf(a) } });
      continue;
    }
    if (a) {
      const week = weeks[a.from];
      if (week === undefined) continue;
      const other = b && b.id !== a.id ? { instead: b.id, kept: stays(b.id, returner, a.from) } : {};
      later.push({ from: a.from, move: { kind: "release", week, player: a.id, returner, ...other, ...nearTieOf(a) } });
    } else if (b) {
      const week = weeks[b.from];
      if (week === undefined || !stays(b.id, returner, b.from)) continue;
      later.push({ from: b.from, move: { kind: "keepAtReturn", week, player: b.id, returner, returnerStays: !given.has(returner) } });
    }
  }
  later.sort((x, y) => x.from - y.from);
  moves.push(...later.map((l) => l.move));

  // Assumed with or without the trade.
  const assumed: AssumedMove[] = [];
  const dropsNamed = new Set<string>();
  for (const p of order) {
    if (!assumedDrop.has(p)) continue;
    const d = assumedDrop.get(p) ?? null;
    const drop = d !== null && !given.has(d) ? d : null;
    if (drop !== null) dropsNamed.add(drop);
    assumed.push({ add: p, drop, ...ew(p) });
  }
  for (const id of asStands) if (cuts.has(id) && !after.has(id) && !given.has(id) && !dropsNamed.has(id)) assumed.push({ add: null, drop: id });
  alike.sort((x, y) => x.from - y.from);
  return { moves, assumed, ...(alike.length ? { assumedLater: alike.map((l) => l.release) } : {}) };
}

/** An exactly evaluated trade with what its simulation needs. */
export interface ExactTrade {
  evaluation: TradeEvaluationCore;
  partner: TeamState;
  mine: SideEval;
  theirs: SideEval;
  /**
   * Checkpoint 7e (planner reply to Checkpoint 7d, item 2.1): the trade's own "before" when it has either-way moves
   * (eitherWayMoves): my baseline V*(T) with them made, priced finally (sideEval), which simulateTrade simulates on each block
   * (beforeOddsOf) in place of the baseline's run. Null or absent: the baseline (TeamState.base), as for every trade without
   * such a move.
   */
  before?: SideEval | null;
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
  // Item 2.1 (Checkpoint 7e; eitherWayMoves): my moves after the trade that clear the pickup bar on my baseline too are made in
  // both versions, so my numbers start from my baseline with them (the trade's own "before"), never from the baseline alone
  // (none under TradeContextOptions.eitherWay false: Checkpoint 7d's rule, for tests and reports).
  const either = I.eitherWay ? eitherWayMoves(I, me, after.mine) : [];
  const beforeRun = either.length ? eitherWayRun(I, me, either) : null;
  const before = beforeRun ? sideEval(I, me, beforeRun) : me.base;

  const dPPW = ppw(mine.lv, weeks, I.regWeeks) - ppw(before.lv, weeks, I.regWeeks);
  const dPPWPlayoffs = ppw(mine.lv, weeks, I.poWeeks) - ppw(before.lv, weeks, I.poWeeks);
  // The depth cover (TradeDetail.depthCover): the part of ΔPPW, scenario lineups, that the same rosters' EV lineups don't
  // see (both finally priced: SideEval.ev); only with scenarios.
  const depthCover = I.S > 0 ? dPPW - (ppw(mine.ev.lv, weeks, I.regWeeks) - ppw(before.ev.lv, weeks, I.regWeeks)) : null;
  const delta = partnerLineupDelta(partner.base.lv, theirs.lv, I.from);
  const hole = holeFeature(holeSlots(I, partner.base.hole, theirs.hole, I.medians.exact), receivedStarters(I, theirs.ev, give));
  // Each side's open-spot credit follows its own active roster after rule 5 (an IR slot isn't a roster spot: market.ts's
  // header), so with an IR player in the trade my package and the partner's needn't mirror each other.
  const mySpots = spotsOf(mineLegal, give, get);
  const theirSpots = spotsOf(theirLegal, get, give);
  // My free-agent moves after the trade that my baseline doesn't make (the file header, "Exact evaluation"; final review of
  // Phase 4c, finding R1) join my package: each pickup as received, each drop as given, each with an active roster spot
  // (a player received and dropped at once leaves both). The partner's package is the trade's alone. Since Checkpoint 7e
  // (item 2.1) against the trade's own "before": an either-way move is in both versions, so it isn't counted.
  const fa = freeAgentMovesOf(beforeRun ?? me.vstar, after.mine);
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
    mySlots: slotChanges(before.regular, mine.regular),
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
    weekly: weeks.map((week, w) => ({ week, before: before.score.mean[w] as number, after: mine.score.mean[w] as number })),
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
      // My displacements against the trade's own "before" (item 2.1): its releases are made either way.
      me: rosterChangeOf(I, mineLegal, mine, { base: before }, faMovesShown),
      // A partner that claims before me can fill its spot with one of my own baseline pickups (OpenSpot.yours).
      partner: rosterChangeOf(I, theirLegal, theirs, partner, undefined, after.first === "partner" ? baselinePickups(me) : []),
    },
    // Every roster move my numbers assume, in order, and those made either way (item 2.2; myRosterMoves): a partner that claims
    // before me takes one of my League-page pickups first when its pickups after the trade add him (legality's or V*'s).
    myMoves: myRosterMoves(I, me, { give, get }, mineLegal, after.mine, either, { mine, before }, new Set(after.first === "partner" ? [...theirLegal.change.adds, ...claimedBy(after.theirs)] : [])),
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
  return { evaluation, partner, mine, theirs, before: beforeRun ? before : null, dynasty, partnerDynasty };
}

// ---------------------------------------------------------------------------------------------
// The simulation (M4)

/**
 * My odds with my team's and `partner`'s score rows replaced (null rows: the baseline's), `sims` seasons on the shared
 * matrix, and (Checkpoint 7c, "Helps them") every team's from the same run (MyOdds.teams, by the same rules: mine are its
 * entry for my team). P(title) is null when the league's title odds are unknown (season.ts's rules), and P(2nd) with it;
 * P(3rd) also when the 3rd-place game can't be known (season.ts seasonOdds' rules, Checkpoint 7c). Checkpoint 7f (planner
 * reply to Checkpoint 7e, answer 2; the file header, "One SimSetup … in three blocks"): with SimState.resume, a run on the
 * ranking block keeps its progress by its rows (the side evaluations, which the context memoizes: sideEval), and the same
 * rows' run on the shown block continues it (rankProgressOf), playing only the seasons the ranking block doesn't hold (sim.ts,
 * "Continuing a run": the full run's numbers, bit for bit); rows no ranking run had (a trade the search never ranked, "now or
 * after this week"'s own rows, the Analyzer before any search) play every season.
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
  const keep = sim.resume && stage === "final";
  const prior = sim.resume && stage === "shown" ? rankProgressOf(sim, mine, theirs?.side ?? null) : undefined;
  const res = simulateSeason({ ...setup, mean, sd }, { sims: normals.sims, seed: sim.seed, normals, ...(prior ? { resume: prior } : {}), ...(keep ? { keep } : {}) });
  if (res.progress) {
    const key = mine ?? NO_ROW;
    const byPartner = sim.rankRuns.get(key) ?? new WeakMap<object, SimProgress>();
    byPartner.set(theirs?.side ?? NO_ROW, res.progress);
    sim.rankRuns.set(key, byPartner);
  }
  return myOddsOf(I, res);
}

/**
 * A run's numbers as runSim reads them: my odds, my win chance by week and every team's odds from it (MyOdds). Also the
 * context's baseline on the shown and ranking blocks, read from the very runs behind SimState.odds and rank.odds (the same
 * setup on the same seasons; buildTradeContext).
 */
function myOddsOf(I: TradeInternals, res: SimResult): MyOdds {
  const sim = I.sim as SimState;
  const me = I.me as TeamState;
  const { setup } = sim.built;
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

/**
 * Seasons simulated at each stage (config.simulation): the screening block, the ranking block ("final") and the shown block
 * (Checkpoint 7e; season.ts shownSimsOf: never fewer than the ranking block's, whose seasons it holds first).
 */
export function simCounts(): Record<SimStage, number> {
  return { screen: Math.max(1, Math.floor(config.simulation.screeningSims)), final: Math.max(1, Math.floor(config.simulation.finalSims)), shown: shownSimsOf(config) };
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
 * calibration run on `block` (the shown block's, SimState.calibration, the League model's step 8c on the same seasons, by
 * default; the ranking block's, SimState.rank.calibration, for the search's screening and ranking stages: scaleBlockOf,
 * Checkpoint 7e) through benefit.helpsScale with my baseline P(playoffs) (the shown block's, the League page's headline: the
 * default λ, as for every trade) and, in dynasty and keeper leagues whose long-term values loaded, MyDynTotal (B₃ = B_ref(λ) =
 * (1 − λ) × B_win₃ + λ × F₁₀: planner reply to Checkpoint 7a, §2 question 6). The same for every stage on a block: one scale
 * per search and block, which B's redraft market term is priced on too (simulateTrade). `reward` absent: the context's
 * (rewardOn). Null without odds or my team.
 */
export function helpsScaleOf(I: Pick<TradeInternals, "sim" | "me" | "snapshot" | "future" | "league">, lambda: number | null, reward?: Reward | null, block: ScaleBlock = "shown"): HelpsScale | null {
  if (!I.sim || !I.me) return null;
  const leagueType = I.snapshot.settings.leagueType;
  const dynastyTotal = I.future && leagueType !== "redraft" ? I.future.myTotal : null;
  return helpsScale(blockScale(I.sim, block).calibration, { leagueType, myPPlayoffs: I.sim.base.shown.pPlayoffs, lambda, reward: rewardOn(I, reward), dynastyTotal });
}

/**
 * A partner's calibration run for "Helps them" (Checkpoint 7c; planner reply to Checkpoint 7b, §7: "B₃,P = the B of +3
 * points a week for that partner, on the same baseline with the same common random numbers"): league.ts helpsCalibrationOf
 * with its team id, on the context's `block` against its baseline there (the shown block's by default: SimState.odds,
 * LeagueModel.odds, the run behind SimState.calibration, the partner's score + 3 a week in place of mine; the ranking block's
 * for the search's screening and ranking stages, Checkpoint 7e), memoized per context and block (SimState.partners,
 * SimState.rank.partners). ⚠️ In the trade context, not the League model (the lead's call): the planner's "once per league
 * model build" read as once per trade context, which builds its own League model, since the League page never shows Helps
 * them and every League model build would otherwise pay one run per team (about 12 ms each on Parker's league at 5,000
 * seasons). Null without odds, for a team the odds don't list, and (⚠️ ours) when the simulator refuses the run (a
 * RangeError: Helps them is then unknown for that partner rather than the search failing, as a refused baseline gives no odds).
 * Checkpoint 7f (runSim's rule): with SimState.resume its run on the ranking block keeps its progress
 * (SimState.partnerProgress), and its run on the shown block continues it (league.ts helpsCalibrationRun), playing only the
 * seasons the ranking block doesn't hold; made first on the shown block (the Analyzer before any search), it plays them all.
 */
export function partnerCalibrationOf(I: Pick<TradeInternals, "sim" | "snapshot" | "from">, teamId: string, block: ScaleBlock = "shown"): HelpsCalibration | null {
  const sim = I.sim;
  if (!sim) return null;
  const at = blockScale(sim, block);
  const known = at.partners.get(teamId);
  if (known !== undefined) return known;
  let run: HelpsCalibration | null = null;
  try {
    const normals = sim.blocks[block];
    const prior = sim.resume && block === "shown" ? sim.partnerProgress.get(teamId) : undefined;
    const prefix = prior ? { resume: prior } : { keep: sim.resume && block === "final" };
    const r = helpsCalibrationRun(I.snapshot, sim.season, teamId, at.odds, { sims: normals.sims, seed: sim.seed, normals, highScores: sim.highScores }, I.from, config, prefix);
    run = r.calibration;
    if (r.progress) sim.partnerProgress.set(teamId, r.progress);
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
  }
  at.partners.set(teamId, run);
  return run;
}

/**
 * "Helps them"'s scale for a partner and a call's reward (Checkpoint 7c; benefit.ts partnerScale): the partner's calibration
 * run on `block` (partnerCalibrationOf; the shown block's by default), its baseline P(playoffs) on the shown block
 * (LeagueModel.odds, the number its acceptance profile reads: λ_P's default, never the user's slider) and, in dynasty and
 * keeper leagues whose long-term values loaded, its roster's long-term value (TradeInternals.future.totals). The same for
 * every stage on a block (the screening and ranking simulations and the steps' versions on the ranking block's; the cards
 * shown and the Analyzer on the shown block's), as mine is: one scale per partner, block and reward. Null without odds or a run.
 */
export function partnerScaleOf(I: Pick<TradeInternals, "sim" | "snapshot" | "future" | "league" | "from">, partner: Pick<TeamState, "id" | "index">, reward?: Reward | null, block: ScaleBlock = "shown"): PartnerScale | null {
  if (!I.sim) return null;
  const leagueType = I.snapshot.settings.leagueType;
  const dynastyTotal = I.future && leagueType !== "redraft" ? (I.future.totals[partner.id] ?? null) : null;
  const pPlayoffs = I.sim.odds.teams[partner.index]?.pPlayoffs ?? null;
  return partnerScale(partnerCalibrationOf(I, partner.id, block), { leagueType, pPlayoffs, reward: rewardOn(I, reward), dynastyTotal });
}

/**
 * The partner's side of a trade's runs ("Helps them"; Checkpoint 7c, planner reply to Checkpoint 7b, §7; TradeEvaluation.them):
 * its changes from `before` (the block's baseline) to `after` (the trade's run, my row and its own replaced), B_P
 * (benefit.ts partnerBenefit: the call's reward, no trade-value term, λ_P by its baseline P(playoffs) on the shown block,
 * B_future,P from the trade's own long-term package: ExactTrade.partnerDynasty), B_ref,P (partnerScaleOf on the runs' scale
 * block) and Helps them as printed (helpsThemScore).
 */
function partnerNumbersOf(I: TradeInternals, x: ExactTrade, reward: Reward, before: RunOdds, after: RunOdds, block: ScaleBlock): PartnerNumbers {
  const sim = I.sim as SimState;
  const dPO = after.pPlayoffs - before.pPlayoffs;
  const dCH = after.pTitle !== null && before.pTitle !== null ? after.pTitle - before.pTitle : null;
  // The weekly high scores' change only when this context simulated them (reward.ts runPrizeDeltas), as mine.
  const dPrizes = runPrizeDeltas(before.prizes, after.prizes, sim.highScores);
  const pPlayoffs = sim.odds.teams[x.partner.index]?.pPlayoffs ?? null;
  const b = partnerBenefit({ leagueType: I.snapshot.settings.leagueType, dPO, dCH, dPrizes, dynasty: x.partnerDynasty, pPlayoffs, reward });
  const b3 = partnerScaleOf(I, x.partner, reward, block)?.b3 ?? null;
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
 * The trade's season simulation (M4) on the `stage` block of seasons (the screening block; the ranking block, "final", the
 * search's final simulation; or the shown block, every number a page prints: Checkpoint 7e), and every number that follows
 * from it: ΔPO, ΔCH, ΔEW, every prize component's change (TradeEvaluation.dPrizes; Checkpoint 7c), my win chance by week
 * before and after (TradeDetail.winChance, winChanceOf: the baseline and the trade's run on that block; empty in a points-only
 * league), B₃ for the reward and λ on the stage's scale block (helpsScaleOf, scaleBlockOf; TradeEvaluation.b3), B and
 * its parts (benefit, with λ = the setting or the default by my baseline P(playoffs), the shown block's, κ = the "Protect my trade
 * value" level's: benefit.protectValueWeight, points a week per 100% of trade value, or 0 when the values are our own
 * estimates (valuesEstimated) or missing (valuesMissing), the market term priced on that B₃: planner reply to Checkpoint 7a,
 * §2 question 5, TradeEvaluation.marketWeekly; and B_win's weights and prize shares by the reward: the goal and prizes), the
 * Trade Score and Overall on the same B₃, the flags, and benefitNotes (and helpsScaleNotes, estimatedValuesNotes,
 * missingValuesNotes) in the detail's notes. The one place a B is made (the search's screening, ranking and shown
 * simulations, the steps' versions, Plan B's candidates, the Analyzer), so every B reads the B₃ its scores read. Checkpoint
 * 7c (planner reply to Checkpoint 7b, §7): from the same two runs, the partner's side (TradeEvaluation.them,
 * partnerNumbersOf: its changes, B_P under the same reward, B_ref,P on the same scale block and Helps them), with no run of
 * its own but the partner's calibration on that block the first time (partnerCalibrationOf). The evaluation's stage is
 * "final" on the ranking and shown blocks alike, its `sims` the block's seasons (so 20,000 on a card shown: rank.ts keeps the
 * furthest-evaluated copy of a key, more seasons first).
 * Without odds (the context's note), B stays null and winChance and `them` absent. `protectValue` and `reward` are the user's
 * per-call settings (TradeSettings.protectValue; the goal and prizes' reward, rewardFor); absent, the context's (the search
 * and the Analyzer always pass theirs: a cached context may hold older settings, and protectValue doesn't rebuild it).
 */
export function simulateTrade(I: TradeInternals, x: ExactTrade, stage: SimStage, lambda: number | null, protectValue?: ProtectValue, reward?: Reward | null): TradeEvaluationCore {
  const ev = x.evaluation;
  const block = scaleBlockOf(stage);
  const rw = rewardOn(I, reward);
  let dPO: number | null = null;
  let dCH: number | null = null;
  let dEW: number | null = null;
  let dPrizes: TradeEvaluationCore["dPrizes"] = null;
  let winChance: TradeDetail["winChance"];
  let them: PartnerNumbers | undefined;
  let before: OddsBefore | undefined;
  if (I.sim && I.me) {
    // The trade's own "before" when it has either-way moves (item 2.1, Checkpoint 7e: ExactTrade.before), on this block's
    // seasons: every change below, the partner's too, is measured from it. Else the baseline's run, as before.
    const base = x.before ? beforeOddsOf(I, x.before, stage) : I.sim.base[stage];
    if (x.before) before = { pPlayoffs: base.pPlayoffs, pTitle: base.pTitle, prizes: { ...base.prizes } };
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
    if (theirsBefore && theirsAfter) them = partnerNumbersOf(I, x, rw, theirsBefore, theirsAfter, block);
  }
  // κ: the "Protect my trade value" level's, but 0 when the trade values are our own estimates (valuesEstimated: the market
  // term would count lineup points twice; the file header, "The simulation"), with ESTIMATED_VALUES_NOTE, and ⚠️ when there
  // are none at all (valuesMissing: every g is 0, so the term is 0 either way; κ 0 says there is none: marketWeekly null).
  const kappa = valuesEstimated(I) || valuesMissing(I) ? 0 : protectValueWeight(protectValue ?? I.settings.protectValue);
  // The scores' scale, B₃, under the same reward and λ (planner reply to Checkpoint 4c, A2) on the stage's scale block
  // (Checkpoint 7e), which also prices B's market term (planner reply to Checkpoint 7a, §2 question 5): one B₃ for the B and
  // the scores.
  const scale = helpsScaleOf(I, lambda, rw, block);
  const b3 = scale?.b3 ?? null;
  const b = benefit({ leagueType: I.snapshot.settings.leagueType, dPO, dCH, dPrizes, gMine: ev.gMine, dynasty: x.dynasty, myPPlayoffs: I.sim ? I.sim.base.shown.pPlayoffs : null, lambda, kappa, b3, reward: rw });
  const numbers = tradeNumbers(b, { pAccept: ev.pAccept, pComplete: ev.pComplete, label: ev.acceptLabel }, b3);
  const { titleMissing: _titleMissing, ...cardNumbers } = numbers;
  void _titleMissing;
  const notes = [...ev.detail.notes, ...benefitNotes(b, rw), ...helpsScaleNotes(scale), ...estimatedValuesNotes(I), ...missingValuesNotes(I)];
  return {
    ...ev,
    ...cardNumbers,
    stage: I.sim ? (stage === "screen" ? "exact" : "final") : ev.stage,
    sims: I.sim ? I.sim.blocks[stage].sims : 0,
    dPO,
    dCH,
    dEW,
    dPrizes,
    ...(them ? { them } : {}),
    ...(before ? { before } : {}),
    flags: tradeFlags({ gMine: ev.gMine, b: b.b, injured: ev.flags.injured }),
    detail: { ...ev.detail, notes, ...(winChance ? { winChance } : {}) },
  };
}

// ---------------------------------------------------------------------------------------------
// Now or after this week (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.2)

/**
 * Weeks left before the trade deadline (Checkpoint 7e, item 4.2): acceptance.ts weeksToDeadline, re-exported here, where it
 * was until the review of wave D (D-ENG-9: src/workers/freshness.ts reads the same reading, and can't load this file).
 */
export { weeksToDeadline } from "./acceptance";

/**
 * Whether a trade context gives "now or after this week" numbers (laterNumbers; Checkpoint 7e, item 4.2): with odds and my
 * team; with no week under way (its games are held as rosters stand before and after every trade, the file header's week
 * in progress, so "now" already starts next week: the lead's design); with a week after the current one that team numbers
 * count (a regular-season or playoff week the season simulation plays); and while at least config.explain.nowOrLaterWeeks
 * weeks remain before the trade deadline (acceptance.ts laterBeforeDeadline, weeksToDeadline; no known deadline: no limit),
 * a reading src/workers/freshness.ts holds a cached context to (the review of wave D, D-ENG-9).
 */
export function laterApplies(I: Pick<TradeInternals, "sim" | "me" | "inProgress" | "from" | "regIdx" | "poIdx" | "snapshot" | "now">): boolean {
  if (!I.sim || !I.me || I.inProgress) return false;
  if (!I.regIdx.some((w) => w > I.from) && !I.poIdx.some((w) => w > I.from)) return false;
  return laterBeforeDeadline(I.snapshot.settings.tradeDeadline, I.now, transactionWeek(I.snapshot));
}

/** A side's weekly score with its first `held` counted weeks (from `from`) as `before`'s: the trade made after those weeks' games (laterNumbers). */
function heldScore(after: WeeklyScore, before: WeeklyScore, from: number, held: number): WeeklyScore {
  if (held <= 0) return after;
  const mean = Float64Array.from(after.mean);
  const sd = Float64Array.from(after.sd);
  for (let w = from; w < Math.min(from + held, mean.length); w++) {
    mean[w] = before.mean[w] as number;
    sd[w] = before.sd[w] as number;
  }
  return { mean, sd };
}

/** laterNumbers' memo: per exact trade (a search's re-filters share its exact trades), by the settings and weeks held it was made for. */
const laterMemo = new WeakMap<ExactTrade, Map<string, LaterNumbers | null>>();

/**
 * "Now or after this week" (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.2: "run the simulation once more with the
 * trade starting next week. Show it as 'Helps you 37 now · 41 if done after this week's games.' … Ranking stays on 'now'";
 * TradeEvaluation.later): the trade's B and Helps you if it's done after this week's games. One more run on the shown block
 * (the card's own seasons, common random numbers) with my row and the partner's spliced: this week as in the trade's "before"
 * (mine: ExactTrade.before, its own "before" with its either-way moves, else my baseline V*(T); the partner's: its
 * baseline), every later week as after the trade; measured from that same "before"'s run on the shown block, as the card's
 * numbers are, so the two differ by this week's games alone. B from those changes as simulateTrade makes it on the shown
 * stage (benefit under the same reward, λ, κ and g_mkt(me): the same market term and ΔDyn, since the trade value doesn't
 * wait), on the shown block's B₃, the card's own scale. ⚠️ The lead's design (decisions-d-addendum, 4.2): nothing else
 * changes, so the rosters, the roster moves the card names (legality's, a pickup the trade makes worthwhile, a release at an
 * IR player's return) and the chance they accept are today's, though a week on the free agents, the injuries and the other
 * manager's answer can differ (the card's tooltip says so). Null when the context gives none (laterApplies). `held` (tests
 * only): the counted weeks played as before, 1 (this week) by default; 0 holds none, which is the trade's own run on the
 * shown block, its B bit for bit (evaluate.later.test.ts). Memoized per exact trade and settings, so a re-filter of a search
 * reuses its cards' numbers (the engine worker's `later`).
 */
export function laterNumbers(I: TradeInternals, x: ExactTrade, s: Pick<TradeSettings, "lambda" | "protectValue" | "goal" | "prizes">, held = 1): LaterNumbers | null {
  if (!laterApplies(I)) return null;
  const key = JSON.stringify([s.lambda, s.protectValue, s.goal, PRIZE_KEYS.map((k) => s.prizes[k]), held]);
  let memo = laterMemo.get(x);
  if (!memo) {
    memo = new Map();
    laterMemo.set(x, memo);
  }
  const known = memo.get(key);
  if (known !== undefined) return known;
  const sim = I.sim as SimState;
  const me = I.me as TeamState;
  const rw = rewardOn(I, rewardFor(I, s));
  const mine: SideEval = { ...x.mine, score: heldScore(x.mine.score, (x.before ?? me.base).score, I.from, held) };
  const theirs: SideEval = { ...x.theirs, score: heldScore(x.theirs.score, x.partner.base.score, I.from, held) };
  const base = x.before ? beforeOddsOf(I, x.before, "shown") : sim.base.shown;
  const after = runSim(I, mine, { partner: x.partner, side: theirs }, "shown");
  const dPO = after.pPlayoffs - base.pPlayoffs;
  const dCH = after.pTitle !== null && base.pTitle !== null ? after.pTitle - base.pTitle : null;
  const dPrizes = runPrizeDeltas(base.prizes, after.prizes, sim.highScores);
  // κ and B₃ as simulateTrade chooses them on the shown stage (the card's numbers): κ 0 with estimated or missing values.
  const kappa = valuesEstimated(I) || valuesMissing(I) ? 0 : protectValueWeight(s.protectValue ?? I.settings.protectValue);
  const b3 = helpsScaleOf(I, s.lambda, rw, "shown")?.b3 ?? null;
  const b = benefit({ leagueType: I.snapshot.settings.leagueType, dPO, dCH, dPrizes, gMine: x.evaluation.gMine, dynasty: x.dynasty, myPPlayoffs: sim.base.shown.pPlayoffs, lambda: s.lambda, kappa, b3, reward: rw });
  const out: LaterNumbers = { b: b.b, tradeScore: tradeScore(b.b, b3) };
  memo.set(key, out);
  return out;
}

/** An evaluation with its "now or after this week" numbers (laterNumbers) when the context gives them, for settings `s` (null: none asked for). */
function withLater<T extends TradeEvaluationCore>(I: TradeInternals, x: ExactTrade, core: T, s: Pick<TradeSettings, "lambda" | "protectValue" | "goal" | "prizes"> | null): T {
  const later = s ? laterNumbers(I, x, s) : null;
  return later ? { ...core, later } : core;
}

// ---------------------------------------------------------------------------------------------
// Versions of a trade and the throw-in (planner addendum to Checkpoint 3, §4; lead decision N4). Since Checkpoint 7e
// (planner reply to Checkpoint 7d, item 4.1) for "How to offer it" (src/engine/offers.ts): its versions, and the Last offer's
// throw-in by the rule that was case 2 of "Offer first / if they say no" (lastOfferVersions).

/**
 * One version of a trade (offers.ts's candidates, the Last offer's): its exact evaluation and its numbers on the screening block
 * of seasons (simulateTrade "screen").
 */
export interface TradeVersion {
  x: ExactTrade;
  screen: TradeEvaluationCore;
}

/** The config keys the throw-in rules read (config.search.throwInMaxCost and config.search.steps), widened so tests can pass others. */
export interface StepConfig {
  /** A throw-in's lineup cost is at most this (ROS lineup points, the exact mode's lineups). */
  readonly throwInMaxCost: number;
  /** "How to offer it" (offers.ts): each offer prints a chance at least this above the one before it (the Last offer above the suggested trade's), … */
  readonly minAcceptGain: number;
  /** Until Checkpoint 7e the offer-first version's least chance as printed; "How to offer it" reads config.offers.openMinChance instead. */
  readonly minOfferFirst: number;
  /** The Last offer's throw-in must keep B at least this share of the suggested trade's B (lastOfferVersions: both on the screening block). */
  readonly minBShare: number;
  /** The Last offer's pre-screen (performance, not a model number): only the best this many candidates get exact evaluation; Infinity: all. */
  readonly preScreen: number;
}

/** The steps' config (§15 defaults). */
export function stepConfig(): StepConfig {
  const s = config.search.steps;
  return { throwInMaxCost: config.search.throwInMaxCost, minAcceptGain: s.minAcceptGain, minOfferFirst: s.minOfferFirst, minBShare: s.minBShare, preScreen: s.preScreen };
}

/**
 * My throw-ins (the file header, "Offer first"; since Checkpoint 7e "How to offer it": the lean version leaves the cheapest one
 * the trade gives out, the Last offer adds one, offers.ts): my active-roster players with a model whose lineup cost in the exact mode
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

/** The settings a version reads: the search's (or the Analyzer's) per-call settings (the goal and prizes: their reward, rewardFor). */
export type StepSettings = Pick<TradeSettings, "lambda" | "protectValue" | "goal" | "prizes" | "minChance" | "includeKDefIdp" | "untouchables" | "mustInclude">;

export interface StepOptions {
  settings: StepSettings;
  /** Each side's most players in a version (legality's per-side limit; the Last offer's): the search's maxPerSide, the Analyzer's analyzerMaxPerSide. */
  maxPerSide: number;
  /**
   * Versions already evaluated (the search's exact trades with their screening-block numbers), by key: a version found here
   * isn't evaluated again (exact evaluation and the simulation are deterministic: the numbers are the same). New versions
   * are added.
   */
  versions?: Map<string, TradeVersion>;
  /** Default stepConfig(). */
  cfg?: StepConfig;
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

/**
 * A version of `proposal`'s key listing its players in `proposal`'s order: the version itself when it already does. Its
 * evaluation and its numbers on the screening block are put in that order whole (coreInOrder): the proposal and, since
 * Checkpoint 7f, the per-player lists that follow the order the version was evaluated in.
 */
function inProposalOrder(v: TradeVersion, proposal: TradeProposal): TradeVersion {
  const sameOrder = (a: readonly TradeAsset[], b: readonly TradeAsset[]) => a.length === b.length && a.every((x, i) => assetKey(x) === assetKey(b[i] as TradeAsset));
  const have = v.screen.proposal;
  if (sameOrder(have.give, proposal.give) && sameOrder(have.get, proposal.get)) return v;
  return { x: { ...v.x, evaluation: coreInOrder(v.x.evaluation, proposal) }, screen: coreInOrder(v.screen, proposal) };
}

/**
 * An evaluation of `proposal`'s key put in `proposal`'s order of players (Checkpoint 7f; the review of the merge, MERGE-4):
 * its proposal (copies of `proposal`'s assets, its own partner), and the lists that follow the order it was evaluated in,
 * each put in that order too: TradeDetail.premium (a fact for each player I'd get) and hotGiven by the players I get,
 * hotReceived by the players I give, and ⚠️ flags.injured by the players I get (ours: the words read the hot and injured
 * lists in their order, explain.ts hotLine and injuredLine; premium orders itself). An id the proposal doesn't hold keeps
 * its place after the others (a stable sort). A version is evaluated in the order of whoever asked first (the search's
 * screening order for its exact trades, the key's for a version evaluated afresh: tradeVersion), so without this a ladder
 * step reusing one of the search's versions and the same step evaluated afresh on another context listed those facts in
 * different orders (40 of 119 ladders on Parker's leagues and synthetic ones, review of the merge), and a kept ladder
 * wasn't deep-equal to the worker's fallback, though the page showed the same. offers.ts puts every offer it prints in its
 * own order this way (its numbers may be the search's, in the search's order).
 */
export function coreInOrder<T extends TradeEvaluationCore>(core: T, proposal: TradeProposal): T {
  const placeIn = (side: readonly TradeAsset[]) => {
    const at = new Map<string, number>();
    for (const a of side) if (!at.has(assetKey(a))) at.set(assetKey(a), at.size);
    return (id: string) => at.get(id) ?? Number.MAX_SAFE_INTEGER;
  };
  const byGet = placeIn(proposal.get);
  const byGive = placeIn(proposal.give);
  // Each list sorted by its players' places (an older evaluation without a list keeps it absent).
  const ids = (xs: readonly string[], place: (id: string) => number): string[] => [...xs].sort((a, b) => place(a) - place(b));
  const d = core.detail;
  const detail: TradeDetail = {
    ...d,
    ...(Array.isArray(d.hotReceived) ? { hotReceived: ids(d.hotReceived, byGive) } : {}),
    ...(Array.isArray(d.hotGiven) ? { hotGiven: ids(d.hotGiven, byGet) } : {}),
    ...(Array.isArray(d.premium) ? { premium: [...d.premium].sort((a, b) => byGet(a.playerId) - byGet(b.playerId)) } : {}),
  };
  return {
    ...core,
    proposal: { partnerId: core.proposal.partnerId, give: proposal.give.map((a) => ({ ...a })), get: proposal.get.map((a) => ({ ...a })) },
    detail,
    flags: { ...core.flags, ...(Array.isArray(core.flags.injured) ? { injured: ids(core.flags.injured, byGet) } : {}) },
  };
}

/**
 * A version's numbers on the screening's fast method (screenTrade): the quick estimate of P_complete (quick P_accept, halved by
 * the veto rule on the raw g_mkt(P) as P_complete is) and my EV ΔROS; null when the screening's legality turns it down. The
 * Last offer's pre-screen reads it (preScreenOrder), and since the review of wave D (D-ENG-1) so does "How to offer it"'s
 * (offers.ts preScreened).
 */
export function quickScreen(I: TradeInternals, partner: TeamState, give: readonly string[], get: readonly string[]): { pComplete: number; myDelta: number } | null {
  const s = screenTrade(I, partner, give, get);
  if (!s) return null;
  return { pComplete: vetoApplies(I.snapshot.settings.tradeReview, s.gPartner) ? s.pQuick * config.acceptance.veto.factor : s.pQuick, myDelta: s.myDelta };
}

/**
 * The Last offer's candidates in pre-screen order (the file header; until Checkpoint 7e case 2 of "Offer first / if they say
 * no"): the screening's quick estimate of P_complete (quickScreen: quick P_accept,
 * halved by the veto rule on the raw g_mkt(P) as P_complete is), then the screening's ΔROS, then the smaller id; those the
 * screening's legality rejects last.
 */
export function preScreenOrder(I: TradeInternals, partner: TeamState, give: readonly string[], get: readonly string[], candidates: readonly string[]): string[] {
  const scored = candidates.map((id) => {
    const s = quickScreen(I, partner, [...give, id], get);
    return { id, p: s ? s.pComplete : Number.NEGATIVE_INFINITY, delta: s ? s.myDelta : Number.NEGATIVE_INFINITY };
  });
  const ahead = (x: number, y: number) => (x === y || Math.abs(x - y) <= EPS ? 0 : y - x);
  scored.sort((a, b) => ahead(a.p, b.p) || ahead(a.delta, b.delta) || byId(a.id, b.id));
  return scored.map((x) => x.id);
}

/** The Last offer's candidates (the file header): my throw-ins not in the trade, pre-screened to the best cfg.preScreen when there are more. */
export function addCandidates(I: TradeInternals, proposal: TradeProposal, throwInIds: readonly string[], cfg: Pick<StepConfig, "preScreen">): string[] {
  const give = playerIds(proposal.give);
  const get = playerIds(proposal.get);
  const candidates = throwInIds.filter((id) => !give.includes(id));
  const partner = I.byId.get(proposal.partnerId);
  if (!partner || !(candidates.length > cfg.preScreen)) return candidates;
  return preScreenOrder(I, partner, give, get, candidates).slice(0, Math.max(0, Math.floor(cfg.preScreen)));
}

/**
 * The Last offer's throw-in (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1: "Last offer: the suggested trade plus the
 * throw-in, using the existing rule (at least 5 points likelier, and Helps you at least 80% of the suggested trade's)";
 * offers.ts, which judges the rest on the numbers a step prints): the rule that was case 2 of "Offer first / if they say no"
 * (planner addendum to Checkpoint 3, §4; lead decision N4). The candidates are my throw-ins the trade doesn't give, while my
 * side stays within opts.maxPerSide (the search's, the Analyzer's analyzerMaxPerSide), pre-screened to the best
 * cfg.preScreen by the screening's quick estimate (addCandidates); each one's version (the trade plus him) is evaluated
 * exactly with the screening simulation, and kept when it helps me (B > 0 on the screening block) and keeps B at least
 * cfg.minBShare of the trade's (⚠️ ours, as in the lead's addendum: "Helps you at least 80%" read as today's rule on B). In the
 * order the rule picks: the highest P_complete first ("raises the chance they accept most"), ties: the higher B, then the
 * smaller id. Empty when the trade doesn't help me on the screening block (so minBShare compares positive B), holds a pick,
 * or my side is already at the limit, or without my team.
 */
export function lastOfferVersions(I: TradeInternals, card: TradeVersion, opts: StepOptions): { add: string; version: TradeVersion }[] {
  if (!I.me) return [];
  const cfg = opts.cfg ?? stepConfig();
  const proposal = card.screen.proposal;
  if ([...proposal.give, ...proposal.get].some((a) => a.kind !== "player")) return [];
  const give = playerIds(proposal.give);
  const get = playerIds(proposal.get);
  const bCard = card.screen.b;
  if (bCard === null || !Number.isFinite(bCard) || !(bCard > 0) || give.length + 1 > opts.maxPerSide) return [];
  const out: { add: string; version: TradeVersion; p: number; b: number }[] = [];
  for (const id of addCandidates(I, proposal, throwIns(I, opts.settings, cfg), cfg)) {
    const v = tradeVersion(I, { partnerId: proposal.partnerId, give: players([...give, id]), get: players(get) }, opts);
    const b = v?.screen.b;
    if (!v || b === null || b === undefined || !Number.isFinite(b) || !(b > 0) || b < cfg.minBShare * bCard - EPS) continue;
    out.push({ add: id, version: v, p: v.screen.pComplete, b });
  }
  out.sort((x, y) => (Math.abs(y.p - x.p) > EPS ? y.p - x.p : Math.abs(y.b - x.b) > EPS ? y.b - x.b : byId(x.add, y.add)));
  return out.map(({ add, version }) => ({ add, version }));
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
    // My odds before any trade on the shown block: the card's "before" (TradeSearchResult.baseline, the Analyzer's, the League
    // page's headline), so the reasons' odds line quotes the change the card prints (explain.ts oddsLine).
    baseline: I.sim && I.me ? { pPlayoffs: I.sim.base.shown.pPlayoffs, pTitle: I.sim.base.shown.pTitle } : null,
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
  /**
   * Checkpoint 7e (planner reply to Checkpoint 7d, item 4.2): the evaluation's "now or after this week" numbers
   * (TradeEvaluation.later, laterNumbers: one more run on the shown block), on by default ("in the Analyzer with each
   * evaluation"); false skips that run (scripts and tests that don't read it).
   */
  later?: boolean;
}

export interface TradeAnalysis {
  /** The full evaluation (exact lineups and the shown block's seasons, config.simulation.shownSims: Checkpoint 7e), null when the trade is illegal or can't be evaluated. */
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

/**
 * The Trade Analyzer (§13): any proposal, evaluated exactly as the search's cards are shown: on the shown block (Checkpoint 7e;
 * planner reply to Checkpoint 7d, item 1.1), so a card opened in the Analyzer reads the very numbers it printed.
 */
export function analyzeTrade(ctx: TradeContext, proposal: TradeProposal, opts: AnalyzeOptions = {}): TradeAnalysis {
  const I = tradeInternals(ctx);
  const notes = [...I.notes];
  if (!I.me) return { evaluation: null, illegal: null, notes };
  const settings = normalizeTradeSettings(opts.settings ?? defaultTradeSettings());
  const maxPerSide = Math.max(1, Math.floor(config.search.analyzerMaxPerSide));
  const exact = evaluateExact(I, proposal, maxPerSide);
  if ("illegal" in exact) return { evaluation: null, illegal: exact.illegal, notes };
  // The scale the evaluation is scored on (simulateTrade's B₃ for the same reward and λ, the shown block's), for the tooltip.
  const reward = rewardFor(I, settings);
  const helpsScale = helpsScaleOf(I, settings.lambda, reward);
  // With its "now or after this week" numbers (Checkpoint 7e, item 4.2; AnalyzeOptions.later).
  const core = withLater(I, exact, simulateTrade(I, exact, "shown", settings.lambda, settings.protectValue, reward), opts.later === false ? null : settings);
  for (const n of core.detail.notes) if (!notes.includes(n)) notes.push(n);
  // Since Checkpoint 7e (planner reply to Checkpoint 7d, item 4.1) no "Offer first / if they say no" steps: the card's "How to
  // offer it" is worked out when it's opened (src/engine/offers.ts offerLadderOfProposal, the engine worker's `offers`).
  return { evaluation: withWords(I, core), illegal: null, notes, helpsScale, reward };
}
