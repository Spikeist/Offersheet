/**
 * The League model (CLAUDE.md §6, §7, §8, §9 and §14 "League"; planner reply to Checkpoint 1, additions
 * A–C; planner reply to Checkpoint 2, answers 1, 2 and 6): buildLeagueModel turns a LeagueSnapshot and its
 * ModelInputs into the LeagueModel (src/engine/leagueModel.ts) that the League page's Web Worker and the
 * checkpoint report show. Pure and deterministic: no I/O; the moment the model is for (`now`), the scenario
 * and simulation seeds and an optional clock (stage timings only) are passed in, and every tunable number
 * comes from config.
 *
 * 1. Weeks: the remaining NFL weeks currentWeek..lastWeek, lastWeek = the last playoff week (the last
 *    regular-season week without playoffs), and which of them are regular-season and playoff weeks. A
 *    season with no weeks left gives a valid model with empty weeks. Relevant players: everyone on a
 *    roster (IR and taxi included) and every snapshot free agent, when the snapshot knows him and the
 *    inputs have him; the others are left out and counted in a warning.
 * 2. ESPN leagues: ESPN's league-scored projections are averaged with Sleeper's only when the two agree
 *    within espnSleeperAgreement at currentWeek over the rostered players (§6 step 1).
 * 3. Per player: availability (§6 step 3; his currentWeek game "started" once its kickoff in
 *    inputs.nfl.kickoffs is at or before `now`, so it is no longer a game left; a known return week after
 *    inputs.nfl.lastWeek, the NFL's last week, means "not back this season"), the projection (§6 steps 1,
 *    2, 4, 5, 7) and, for active-roster players, free agents and (step 5b) IR players, S availability
 *    scenarios drawn with common random numbers (addition C: a player's draws depend only on the seed, his
 *    id and the scenario, never on his team). Conflicting ESPN signals (§6 step 3; availability.returnDateConflict):
 *    a PROBABLE, QUESTIONABLE or DOUBTFUL player whose return week is 2+ weeks away gets Sleeper as the
 *    tiebreaker (projections.staleReturnCheck). A stale date is dropped (the tag's one-week table, then
 *    healthy) for his expected availability and his scenarios alike, and PlayerModel.availabilityNote says
 *    which signal he follows. When Sleeper's projections for this week didn't load at all
 *    (sleeperWeekLoaded), there is no tiebreaker: he follows the date, and the note says the projections
 *    were missing (sleeperUnavailable), not that Sleeper doesn't project him. Every PROBABLE, QUESTIONABLE
 *    or DOUBTFUL player gets the Q/D/P base rate (projections.gameTimeBaseRate; planner reply to Checkpoint 3,
 *    answer 5): this week's injury-cut projections count neither in b nor in the week shape (this week's shape
 *    is 1), and proj_now is his nearest later healthy week, which carries his current role (review of track A1).
 * 3b. The market blend (§6 step 8; planner reply to Checkpoint 4, change 1; blend.ts): every QB, RB, WR and TE with a
 *    real FantasyCalc value in this season's list for the league's format (blend.blendValues: redraft values; a dynasty
 *    league's redraft list, MarketInputs.seasonValues) has his projection scaled by f = b′ / b, b′ = (1 − w)·b +
 *    w·R_pos(v): b his base rate (points per game when he plays), R_pos the isotonic curve of b on value over his
 *    position's healthy valued players (no injury tag, a game left), each of them inside the value range read off the
 *    curve fitted without him.
 *    ⚠️ Per game, not per rest-of-season total, and the curve without his own point (review of track A: blend.ts's header
 *    has why). b, every week's p and σ, and his ROS summary scale (blend.applyBlend), so everything from the projection
 *    table on reads blended points: free agents, needs, trade chips, V*, both lineups of every trade and the season
 *    simulation. The factors are computed once per build (projectLeaguePlayers; LeaguePlayers.blend), and a pre-kickoff
 *    rebuild applies the same ones (preKickoffTable). They don't depend on the moment, so a build made once a week is
 *    under way and one made before its first kickoff blend alike (the blend factors are the same either side of the
 *    first kickoff, so the odds as rosters stand keep Phase 3's game-day identity: "Game days" below). PlayerModel.blend
 *    says what moved for the player detail. Without this season's list (a dynasty or keeper league whose redraft list
 *    didn't load) nothing is blended, and the model warns (BLEND_OFF_WARNING); FantasyCalc's curve fallback (step 4) blends
 *    nothing either, and the model warns in its own words (BLEND_OFF_CURVE_WARNING: its old lists are there, but too old
 *    to blend toward; the model inputs' banner, FANTASYCALC_VALUES_ESTIMATED, speaks of trade values only: review of
 *    track EF, finding 2).
 * 4. Market values (§9, perception term) with the ROS totals feeding the estimate curve (blended: step 3b comes
 *    first), and the waiver credit W (the best free agent's value, estimates included, at least waiverCreditMin). In
 *    FantasyCalc's curve fallback (Phase 4c; MarketInputs.fallback kind "curve": market.curveMarketValues values every
 *    player off a curve of an old list's values on these ROS points) the curve is fitted on the players step 3b's rule
 *    lets shape a curve (marketCurveFit: healthy, a game left; review of track MK, finding 1: an injured player's old value
 *    prices games his ROS doesn't count, and pooled in it lifted the bottom of the curve, W included), and everyone is read
 *    off it.
 * 5. Per team (teamValue.ts): EV and scenario lineups of the team as it stands, ROS (playoff weeks × the user's
 *    playoff weight: opts.settings, TradeSettings.playoffWeight; LeagueModel.playoffWeight), PPW, slot strength
 *    and TeamModel.score, the weekly score the simulator draws (§8; teamValue.ts): with scenarios the scenario
 *    mean LV and sqrt(within-lineup variance + LV spread²), the law of total variance; without them the EV
 *    lineup's LV and sqrt(Σ σ²) of its starters. Then the free-agent-optimized baseline (§7; planner reply to
 *    Checkpoint 3, model change 2; lead decisions L2 and L3): V*(T), the free-agent optimizer's roster
 *    (optimizer.ts: from T, the best add/drop or open-spot add while it gains at least faMinGain ROS points, at most
 *    faMaxMoves moves; never K or DEF or a position the team streams; never a player the starting lineup needs; the
 *    dynasty guard in dynasty and keeper leagues whose dynasty values loaded, with §9's future-term values; ⚠️ without
 *    those, near-ties in whom a move cuts go to the cheaper player, values floored at W: config.lineups.dropNearTieWeekly
 *    a week, nearTieRos, legality's rule, optimizer.ts's header, verification finding VF-1). Its moves
 *    are judged in scenario lineups when scenarios run (review of track E, item 1: the lineups B and the lineup costs
 *    are measured in, so a depth pickup worth little in EV lineups is made, and a trade never gets credit for it), else
 *    in EV lineups. Its moves are TeamModel.faMoves, each with its EV gain and its scenario gain (the
 *    roster after the move minus the roster before it, in scenario lineups). Lineup costs:
 *    MV_lose(T, i) = ROS(V*(T)) − ROS(V*(T − i)), in EV and in scenario lineups (the same rosters priced in each
 *    mode), floored at 0, and 0 when V*(T) dropped him. V*(T − i) is the optimizer re-run from V*(T)'s roster
 *    without him (L3's shortcut; optimizer.reoptimize with one extra move). Like a run from scratch, the re-run
 *    holds at most faMaxMoves pickups ⚠️ and judges its moves in EV lineups (optimizer.reoptimize, for speed: the lineup
 *    costs, MV_add's re-runs and chips staying chips re-run it hundreds of times a build; V*(T) itself, the trade
 *    baseline and the League page's pickups, is scenario-judged): at a team that used every move, replacing him is an exchange, made only when
 *    giving back the pickup that then costs least (and bringing back the player its move dropped) still beats not
 *    replacing him; and when no free-agent move fills the spot he leaves, a player V*(T)'s moves dropped comes back
 *    into it (a run from scratch would have used that spot instead of dropping him). The roster it ends with is
 *    priced like any other, in each mode (optimizer.ts header, with the greedy-path difference that remains). Review of track A2: the first version let this re-run make one move
 *    past the cap for free (and MV_add none), which put lineup costs at capped teams up to 29 points below a run
 *    from scratch, about their smallest pickup (11 of 91 chips in Parker's league on the offline report's inputs,
 *    Bo Nix among them, would not have been chips at the from-scratch cost). A cost below 0 is the threshold at
 *    work (losing him opens a spot for a pickup worth less than faMinGain over him, which V*(T) didn't make), so
 *    it's floored. TeamPlayerValue.autoAdd is the re-run's first add. The optimizer is memoized by roster within
 *    the build (chips and partners re-run it too). With faMaxMoves 0 nothing is picked up anywhere: MV_lose is
 *    ROS(T) − ROS(T − i).
 *    One free agent, one team (§7; planner reply to Checkpoint 4, change 3): V*(T) is built team by team in the
 *    allocation order (allocationOrder: in a FAAB league whose teams all report a remaining budget, the most budget
 *    first; else, when every team reports a waiver rank, the platform's waiver order; else each team's best single-move
 *    gain against the whole pool first, in the optimizer's judging mode: firstMoveGain; ties: snapshot order), each
 *    team's run adding only free agents no earlier team's run claimed. A team claims every free agent its run adds
 *    (claimedBy), ⚠️ one a later move of the same run swapped away included (ours: the design counted only the final
 *    roster's): so no free agent shows in two teams' moves (TeamModel.faMoves), and greedy determinism holds (optimizer.
 *    ts, "The pool": no later team adds a free agent an earlier team's run added, so the earlier run against the pool
 *    minus every other team's claims makes the very same moves; exactly but for near-ties within 1e-9, ⚠️ that file
 *    says when). Counting only the final roster's would let a later team take the swapped-away player, and then the
 *    earlier team's every later run, against excl(T), couldn't make its first move again. excl(T), every other team's claims
 *    (TeamWork.pool), restricts every later run of T: the lineup costs' re-runs, MV_add's re-runs and their bases'
 *    bounds (step 6; the trade search's get pool reads them too), chips staying chips (step 7) and leagueMarginals.
 *    LeagueModel.faAllocation has the basis and the order. The streaming replacement is unchanged (the streamRank-th
 *    best free agent already allows for other teams streaming). BuildLeagueModelOptions.faAllocation "independent" is
 *    Checkpoint 4's rule, every team against the whole pool (two teams can then pick up the same free agent), for the
 *    Checkpoint 4b report only: faAllocation is absent then.
 * 5a. Streaming positions (§7; planner reply to Checkpoint 3, model change 1; lead decision L1): my team
 *    streams the positions of my setting (opts.settings.streamPositions, default K and DEF); every other team
 *    streams a config.streaming.streamable position (K, DEF, QB, TE) where it made detectAdds (2) or more adds
 *    this season (streamingAdds: "add" and "waiver" moves to the team, at the move's position, else the
 *    player's; unknown positions don't count). Only positions the lineup starts. A streamed position's
 *    replacement in week w is the streamRank-th (3rd) best free agent with a model at that primary position by
 *    p_w (fewer → the last one, none → 0; teamValue.streamingReplacement), and one virtual row per position
 *    carries it (teamValue.streamRow: id `stream:<POS>`, cond = ev = the replacement, flags all 1, σ from §6
 *    step 5). The row joins the team's lineup evaluation, after its players, wherever its lineup is valued:
 *    LV, ROS, PPW, strength and needs, the free-agent optimizer and lineup costs, trade chips (the drop that makes
 *    room never picks it), partner fit and TeamModel.score. So a streamed slot is worth max(the best rostered
 *    player, the replacement) every week, in every scenario (the exact lineup solver), and exactly that where no
 *    flex takes the position (K, D/ST). Where a flex takes it too (TE and FLEX, QB and SUPER_FLEX or OP), the
 *    streamer is one more player that week and
 *    starts wherever he helps most: in the flex when he beats its starter, or in the position's slot with the
 *    team's own player moving to the flex (teamValue's header: holding him to the position's slot changes no
 *    total; review of track A1). It takes no roster spot, isn't a player (TeamModel.players, chips and the
 *    free-agent candidates never see it), and a league that starts two at a position still gets one streamer.
 *    On a game day the current week's replacement uses that week's p (a free agent whose game started scores
 *    0), and TeamModel.score's pre-kickoff week rebuilds the free agents at streamed positions before kickoff
 *    too. LeagueModel.streaming has who streams what (with the adds behind it), each streamed position's
 *    replacement per week, and "Streaming picks this week" (streamingPicks: the top picksShown free agents at K
 *    and DEF this week, with their opponents). The free-agent optimizer (step 5) never adds or drops a K or DEF,
 *    nor a position the team streams: those slots are valued by streaming (or kept as rostered).
 * 5b. IR returners (§6, §7; planner reply to Checkpoint 4, change 5 and answer 11; src/engine/returners.ts). Each IR
 *    player's expected return week R (availability.expectedReturnWeek on what his availability reads: the first remaining
 *    week his chance of being back reaches config.projections.returnWeekQuantile; none when he isn't back within the
 *    weeks: out for the season, NA). The ones with a model and an R are the team's returners (StreamSpec.returners,
 *    returners.returnerSpec, in id order): their own rows join every lineup of the team after the streaming rows (the
 *    team as it stands, V*(T) and its moves, lineup costs, MV_add and its bases, chips staying chips, partner fit, and
 *    the trade evaluation), so a returner starts once his availability says he's back. They take no active roster spot,
 *    are never dropped (nor the drop that makes room for a chip; only the displacement below can release one at his
 *    return), never a free-agent move, never a trade chip (⚠️ chips stay active-roster only), and don't count for the
 *    lineup-fill rule (but in the displacement, from their return). TeamModel.players gains them: lineup cost = what
 *    losing him costs V*(T)'s lineups with nobody refilling him (his IR slot opens, no active spot does), floored at 0, in
 *    EV and scenario lineups, and the surplus scores are standardized over the active players and the returners together
 *    (the trade search's give pool ranks both). Their scenario flags are drawn like anyone's (step 3). The roster spot a
 *    returner needs from R (the displacement: returners.finalLineups) applies to FINAL evaluations only: here, each team as
 *    it stands (TeamModel.ev and scen, strength and needs, TeamModel.score and so oddsAsRostersStand) and each team's V*(T)
 *    (step 8a: TeamModel.scoreWithPickups and so LeagueModel.odds); in evaluate.ts, the trade baseline at V*(T) (step 8a's
 *    own lineups) and every trade side after V*. Returners join the active roster in order of R; a join
 *    that leaves it over maxRosterSize (⚠️ a roster already over it is held only to its own size) or his position over
 *    its positionLimits (the same rule) drops the lowest keep value player from R on, at his position when its limit
 *    binds (what losing him costs over the weeks from R on, in scenario lineups when scenarios ran, else EV; dynasty and
 *    keeper leagues with long-term values add the normalized market value, as legality does; ⚠️ the returner himself
 *    among the candidates, review of track E, so a return never lowers a team by more than the near-tie tolerance below
 *    (with exact ties not at all); never one the starting lineup needs, one a position's rosterMinimums needs, or the
 *    last one at a position the team streams; ties: the lower perception value, then the smaller id, and ⚠️ without
 *    long-term values near-ties within config.lineups.dropNearTieWeekly a week go to the less valuable player, values
 *    floored at W: returners.ts), as a masked copy of his row. ⚠️ Not inside the optimizer's moves, lineup costs, MV_add, chips
 *    or partner fit: that machinery compares rosters with each other, and the displacement is about the same on both
 *    sides (a constant per team). The week in progress's pre-kickoff score brings the returners in too, and leaves out a
 *    player displaced from the current week on, a returner released then included: the week as the model priced it before
 *    kickoff (finalScore).
 *    BuildLeagueModelOptions.irReturners false is Checkpoint 4's rule: no returner, no displacement, no IR flags.
 * 6. Trade chips (§7; answer 2): gap_i = maxOther_i − cost_i ≥ chipMinGap, all in ROS lineup points in the
 *    lineup costs' mode (scenario lineups when scenarios ran, else EV). cost_i = MV_lose(own team, i) (step 5).
 *    maxOther_i = the largest MV_add(T′, i) over the other teams (ties: the smaller team id), floored at 0:
 *    MV_add(T′, i) = ROS(V*(V*(T′) + i − drop)) − ROS(V*(T′)) (L3's shortcut: from V*(T′)'s roster), where drop
 *    is the player V*(T′) drops to make room when its active roster is full (every id on team.roster takes a
 *    spot, and every free agent V*(T′) added): the one whose loss costs V*(T′)'s lineup least, in the same lineup
 *    mode, with nobody refilling his spot (§7's keep value, marginal ROS contribution: teamValue.evRemovalCosts /
 *    scenarioRemovalCosts), among its players with a model (a free agent it added included), never the newcomer
 *    (ties: the lower market value, then the smaller id; teamValue.lowestKeepValue). Not his lineup cost: that
 *    refills his spot with free agents, so a starter with a free agent almost as good would cost ~0 there, be
 *    the one dropped, and take all his points with him. Position limits (L7, roster legality): when that leaves
 *    i's position at its limit, the drop is instead V*(T′)'s lowest keep value player AT i's position (the same
 *    keep value and ties, never the newcomer; often one of V*(T′)'s own pickups), which makes room on the roster
 *    and at the position at once, and T′ is skipped for i only when nobody there can go (only players with a
 *    model are dropped) or the roster is full with nobody to drop. (Review of track A2: the first version skipped
 *    T′ whenever V*(T′) minus the general drop was at the limit, so a team whose own pickups had filled its QB
 *    spots could take no QB at all: Bo Nix → Team 1 on the offline report's inputs, 18 such pairs in that league,
 *    every one legal on the team's own roster.) Then the optimizer re-runs from V*(T′) + i − drop
 *    (optimizer.reoptimize with one extra move, step 5's rule, against excl(T′)): it may hold at most faMaxMoves pickups, so a team
 *    that used every move makes one more pickup only as an exchange (giving back the pickup that then costs least,
 *    when that pays), while a swap of a pickup the newcomer made redundant needs none. So a newcomer who makes one
 *    of T′'s players redundant frees that spot for a pickup (Bo Nix to Team 1: a QB it has, or one it picked up,
 *    can go for a free agent), which Phase 3's pinned one-move baseline couldn't credit; and a pickup T′ could have
 *    made anyway, past its cap, counts only by what it beats T′'s cheapest pickup by. The drop doesn't depend on i
 *    (only on his position when a limit binds), so each team gets one base B′ = V*(T′) − drop (and one per limited
 *    position, built when first needed), and MV_add(T′, i) = gain(B′, i) − (ROS(V*(T′)) − ROS(B′)) + what the
 *    re-run adds. The re-run is run only for a newcomer who starts for B′ in some week team numbers count (rerunCounts:
 *    ⚠️ for speed, an approximation it measures). Candidates: active-roster players with a model
 *    whose position isn't in config.market.tradeSearchExcluded (P, K, DEF, IDP: excluded from trade search by
 *    default, §9); IR players (⚠️ step 5b: chips stay active-roster only, though IR players are tradable) and taxi
 *    players aren't candidates. Chips need no market values. The search is exact
 *    and all pairs count, but only pairs whose bound could reach the best value found, or make a chip at all, are
 *    solved: the bound is teamValue's bound on adding i to B′ plus a bound on what the re-run can add. That is 0
 *    when no free agent's add bound on B′ reaches faMinGain (the re-run's first move gains at most what adding
 *    its free agent to B′ + i gains, which is at most what adding him to B′ gains: more players never lower a
 *    lineup, and a player added to a bigger roster gains no more), else the sum of the largest (the re-run's
 *    moves: optimizer.rerunMoves) add bounds on B′ (all it adds is at most what adding its free agents to B′
 *    would add), plus the largest add bound of a player V*(T′) dropped (an exchange can bring one back). That
 *    leaves a few teams per chip candidate (the bounds are tight without starter limits). Under starter limits nothing is bounded and the re-run is skipped (⚠️ for speed: every move there
 *    is solved, so MV_add is the pinned formula), and with scenarios the other teams are screened by their exact
 *    EV value and the best chipScreenTeams of them get scenario lineups. Chips are listed best gap first; equal
 *    gaps list the cheaper one to lose first (lead decision D3: EV lineups give a starter and the backup who
 *    covers him the same gap). For the page (lead decision L5; planner reply to Checkpoint 3, answer 3) each chip
 *    also carries cost ÷ Σ ω over the weeks team numbers count (costPerWeek) and whether he starts for his team
 *    (starter: in the EV lineup of V*(T), the roster his cost is measured from, streaming rows included, in at
 *    least half of the counted weeks in which he plays; teamValue.evStarter; never when V*(T) dropped him, so a
 *    "starter" tag never sits next to the 0 cost of a player the team's pickups replace: review of track A2).
 *    leagueMarginals gives any team's V*, MV_lose and MV_add by these same rules (scripts, the trade search).
 * 7. needs.ts: strength z-scores across teams, needs, §12's surplus scores (kept for Phase 4's give pool),
 *    and my team's best trade partners from the chips: their chips that would start for me and mine that
 *    would start for them, over every week team numbers count, against the receiving team's V* (EV lineups,
 *    no drop). The cards list every such chip with its own gain; each side's score counts only chips that
 *    stay chips together (lead decision D2; needs.chipsTogether), at most config.search.maxPerSide of them
 *    (a partner trade has at most that many players a side): the side's chips by their own gain (ties: the
 *    larger gap, then the smaller id); the first counts; each next one counts only while he is still a chip
 *    once the chips already counted have left his team: maxOther − cost(T − counted) ≥ chipMinGap, his
 *    lineup cost on that roster by step 5's rules (chipsStayChips). Chips come in groups (a starter and his
 *    backup each qualify because the other covers him), so a deep team's whole group no longer inflates its
 *    fit. The side's score is the joint gain of the chips counted (one lineup solve per week, so chips
 *    competing for one slot count once). Partners don't need trade values either.
 * 8. The season simulation (§8; season.ts, sim.ts), opts.sims seasons (default config.simulation.finalSims; 0 = none,
 *    both odds null) on the common-random-numbers matrix of opts.simSeed (default config.simulation.seed), drawn once for both
 *    runs below. Null when nothing is left to simulate, and null with a warning when the rest of the regular season has
 *    no schedule (season.ts oddsSkippedWarning) or the simulator refuses the setup. Timings only when opts.clock is given.
 *    One baseline everywhere (Phase 4c; planner reply to Checkpoint 4b, change 9): the headline is every team after its
 *    free-agent pickups, the trade search's own baseline, so the League page and every card's "before" agree.
 *    8a. TeamModel.scoreWithPickups: each team's V*(T) (step 5, the allocation's: one free agent, one team) priced finally
 *        (finalRunLineups: its returners back and the roster spot each needs from his week, step 5b; its streaming rows),
 *        scored as TeamModel.score is, with the week in progress held at TeamModel.score's week (pickupScore: ⚠️ the
 *        model plays a week under way with today's rosters, so pickups count from the next week). evaluate.ts runs the same two functions on every trade side, and reuses these
 *        very lineups for its baseline (LeagueModelBuild.pickups), so its baseline odds on its final block (the first
 *        finalSims seasons of the same matrix) are LeagueModel.odds exactly.
 *    8b. LeagueModel.odds simulates every team's scoreWithPickups (season.pickupSeasonModel); oddsAsRostersStand, the
 *        page's smaller second line, every team's TeamModel.score (as it stands) on the same seasons. ⚠️ Who reads which
 *        (ours): the headline everywhere a number is judged or shown first: the standings table (today's rank, P(playoffs),
 *        P(bye), P(title), the projected record), the remaining schedule (my win and median-game chances each week; its
 *        projected points from scoreWithPickups), the risky weeks (a win chance under riskyWinChance), "Your season's
 *        over" (TeamOdds.eliminated: never read off simulation counts, so the same in both), step 9's P(playoffs) (so the
 *        League page's premiums and "Harder to get" tags are the trade search's), and the trade search's partner context
 *        (acceptance: checked out, rebuilding, contender), which reads its own baseline, these numbers. The odds as rosters
 *        stand only as the second line.
 * 9. The star premium (planner addendum to Checkpoint 3, §1–§2; lead decisions N1 and N2; premium.ts): every rostered
 *    player's (active, IR and taxi) for his own team, TeamModel.premiums: his rank by perception value on the roster
 *    (ties: more ROS points, then the smaller id), whether he is a top-12 FantasyCalc player, e and the "Harder to get"
 *    tag, from step 4's values and step 8's odds with pickups (dynasty leagues: a rebuilding team's older RBs and WRs
 *    count half; without odds, P(playoffs) is unknown and nothing is halved). Last, and read by nothing above it: no other
 *    number of the model depends on it.
 *
 * Game days (Phase 2 review decisions; LeagueModel.inProgressWeek): once any game of the current week has
 * kicked off (inputs.nfl.kickoffs[currentWeek] at or before `now`), every team-level number skips that
 * week (teamWeeks): ROS(T) and the free-agent moves, lineup costs and trade chips built on it (ω = 0), PPW, both
 * strength windows (they start the week after), needs and partner fit. Its lineups are locking and its
 * points are being scored, so a week whose early games are over would say more about kickoff times than
 * about teams (a team whose starters played Thursday would look weak all weekend). Its per-week LV is still
 * computed and reported, a partial week (the players whose games haven't started), so every per-week
 * array stays aligned with LeagueModel.weeks; players' own weekly points and ROS points still count their
 * games that haven't started. The simulator plays that week's games from projections (lead decision D6:
 * live scores aren't read), so TeamModel.score's first week is the whole week as if none of its games had
 * started (preKickoffTable: the players rebuilt for 1 ms before its earliest kickoff, each team's first
 * week solved alone; scenario lineups when scenarios ran, else EV), and TeamModel.scoreWithPickups's first week is that
 * same number (step 8a: ⚠️ the model plays a week under way with today's rosters). Nothing else about the week changes,
 * and the scenario draws are the same ones (they depend on the seed, the player and the scenario only), and
 * so are the market blend's factors (step 3b: they don't depend on the moment, and the rebuild applies the build's).
 * ⚠️ Only the clock is turned back: the rosters and injury tags are today's, since nothing records them as
 * they were at kickoff. A player tagged out after the game he already played counts as missing it, and a
 * player moved since kickoff counts for his new team (the odds' note says so: season.ts weekUnderWayNote).
 * ⚠️ Phase 4c: that identity (the odds just after the week's first kickoff are the odds just before it) holds for
 * oddsAsRostersStand, not for the headline LeagueModel.odds (step 8): before kickoff each team's pickups can still play
 * the week (its scoreWithPickups counts them there), after it they can't (the week is held at its score as it stands),
 * and V*(T) itself is re-judged without the week (ω = 0), so a pickup that mattered only then may go. The trade search's
 * baseline has always worked this way; it is the League page's headline since Phase 4c. On Parker's league (Oct 4 data,
 * 1 ms either side of week 4's first kickoff) the headline moved by up to 1.3 points of P(playoffs) and 0.3 of P(title)
 * (one team's V*(T) lost a move; Team 3's P(playoffs) moved 0.2), the odds as rosters stand by 0 (review of track EV;
 * league.test.ts pins both rules).
 *
 * Choices the spec leaves open (Checkpoints 2 and 3 list them): TeamModel.chips holds every chip, and the
 * page shows the first chipsShown; TeamModel.players covers the active-roster players with a model and (step 5b)
 * the IR returners;
 * Need.slot is a slot instance key (LeagueModel.slots). Only players with a model are drop candidates, for
 * the free-agent optimizer and for making room: one without projections isn't known to be worthless, so he is
 * never the one dropped (he still takes a roster spot). The keep value that picks the drop is his marginal ROS
 * contribution alone (step 6); §7's dynasty keep value (plus normalized market value) is Phase 4's
 * roster-legality work (a trade's forced moves).
 */
import { config } from "./config";
import { expectedAvailability, expectedReturnWeek, returnDateConflict, scenarioAvailability, type AvailabilityConfig, type AvailabilityContext, type AvailabilityPlayer } from "./availability";
import { futureValuesLoaded } from "./benefit";
import { applyBlend, blendValues, marketBlend, noBlend, type MarketBlend, type MarketBlendConfig } from "./blend";
import type { ModelInputs, NflScheduleInputs, PlayerInputs } from "./inputs";
import type {
  AvailabilityNote,
  BaseRateSource,
  FaAllocation,
  FaMove,
  LeagueModel,
  LineupValues,
  MarketSummary,
  PlayerModel,
  ProjectionSummary,
  SeasonOdds,
  SlotInstance,
  StreamingPick,
  StreamingTeam,
  TeamModel,
  TeamPlayerValue,
  TradeChip,
} from "./leagueModel";
import { prepareLeagueSlots, type PreparedSlots } from "./lineup";
import { marketSummary, marketValues, valuesForTerm, waiverCredit, type MarketConfig } from "./market";
import { POSITIONS, type LeagueSettings, type LeagueSnapshot, type PlayerInfo, type Pos, type Team } from "./model";
import {
  chipsTogether,
  findNeeds,
  instanceIndex,
  rankPartners,
  slotInstances,
  strengthTable,
  surplusScores,
  tradeChips,
  windowAverage,
  type ChipCandidate,
  type InstanceIndex,
  type PartnerCandidate,
  type PartnerPlayer,
} from "./needs";
import { FULL_POOL, applyStep, createOptimizer, poolRestriction, returnersOf, rosterKey, type DynastyGuard, type OptimizedRoster, type PoolRestriction, type RosterOptimizer, type StreamSpec } from "./optimizer";
import { leaguePremiums, type StarPremiumConfig } from "./premium";
import { baseRateSourceCounts, espnSleeperAgreement, projectPlayer, staleReturnCheck, weeklySd, type BaseRateContext, type ProjectionConfig, type SourceAgreement } from "./projections";
import { finalLineups, returnerSpec, type FinalLineups, type FutureKeep, type ReturnerSetup } from "./returners";
import { buildSimSetup, oddsSkippedWarning, pickupSeasonModel, seasonOdds, type SeasonConfig } from "./season";
import { defaultTradeSettings, normalizeTradeSettings, type TradeSettings } from "./settings";
import { simNormals } from "./sim";
import {
  addGainExact,
  addRowsGain,
  addUpperBound,
  evInstancePoints,
  evRemovalCosts,
  evScore,
  evStarter,
  isStreamId,
  lowestKeepValue,
  maskedRow,
  positionAllows,
  ppw,
  rosValue,
  scenarioAddGain,
  scenarioAddUpperBound,
  scenarioRemovalCosts,
  scenarioScore,
  scenarioValues,
  slotMask,
  solveEvWeeks,
  streamRow,
  streamRowId,
  streamingReplacement,
  teamEval,
  weekWeights,
  windowWeights,
  type ProjectionTable,
  type ScenarioCells,
  type ScenarioValues,
  type SolvedWeeks,
  type TableRow,
  type TeamEval,
  type WeeklyScore,
} from "./teamValue";

/** Gains closer than this are zero (float noise, not a tunable). */
const EPS = 1e-9;

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The config keys the League model reads, widened from config's `as const` literals so tests and calibration can vary them. */
export interface LeagueModelConfig extends SeasonConfig {
  /** returnWeekQuantile: an IR player's expected return week (step 5b; availability.expectedReturnWeek). */
  readonly projections: ProjectionConfig & AvailabilityConfig & { readonly returnWeekQuantile: number };
  /** The market blend (the file header, step 3b; blend.ts). */
  readonly marketBlend: MarketBlendConfig;
  readonly market: MarketConfig & { readonly tradeSearchExcluded: readonly Pos[] };
  readonly lineups: {
    readonly playoffWeight: number;
    readonly needZThreshold: number;
    readonly strengthWeeks: number;
    readonly scenarios: number;
    readonly scenarioSeed: number;
    /**
     * Near-ties in whom a forced drop or a free-agent move cuts, points a week (an IR player's return:
     * returners.ReturnerSetup.nearTieWeekly; the optimizer's moves: OptimizerSetup.dropNearTie, nearTieRos; absent: none).
     */
    readonly dropNearTieWeekly?: number;
  };
  readonly needs: {
    readonly chipMinGap: number;
    readonly chipScreenTeams: number;
    readonly needsShown: number;
    readonly partnersShown: number;
  };
  /** Partner fit counts at most maxPerSide chips a side (a partner trade has at most that many players a side, §12). */
  readonly search: { readonly maxPerSide: number };
  /** Streaming positions (§7; the file header, step 5a); optimizerExcluded: never the free-agent optimizer's moves (K, DEF). */
  readonly streaming: {
    readonly streamable: readonly Pos[];
    readonly streamRank: number;
    readonly detectAdds: number;
    readonly picksShown: number;
    readonly optimizerExcluded: readonly Pos[];
  };
  /** The free-agent optimizer V* (§7; the file header, step 5). */
  readonly freeAgentOptimizer: {
    readonly faMinGain: number;
    readonly faMaxMoves: number;
    readonly faDynGuard: number;
  };
  /** The star premium (the file header, step 9; premium.ts). */
  readonly acceptance: { readonly starPremium: StarPremiumConfig };
}

export interface BuildLeagueModelOptions {
  /** The moment the model is for: a game that kicked off at or before it is no longer a game left. */
  now: Date;
  /** Availability scenarios per lineup evaluation (default config.lineups.scenarios; 0 = expected-value lineups only). */
  scenarios?: number;
  /** Scenario seed (default config.lineups.scenarioSeed). */
  seed?: number;
  /** Simulated seasons for LeagueModel.odds and oddsAsRostersStand (§8; default config.simulation.finalSims; 0 = no simulation, both null). */
  sims?: number;
  /** The season simulation's common-random-numbers seed (default config.simulation.seed). */
  simSeed?: number;
  /** Milliseconds (performance.now in the browser): LeagueModel.timings is filled only when given. */
  clock?: () => number;
  /**
   * The user's settings (src/engine/settings.ts; Phase 4): the positions my team streams weekly and the playoff
   * weight. Default: defaultTradeSettings(). Read through normalizeTradeSettings (a stored copy from an older
   * version, or a bad value, falls back to its default); without them, the playoff weight is the config's.
   */
  settings?: TradeSettings;
  /**
   * How free agents are shared out (step 5): "oneTeam" (the default; §7 one free agent, one team) allocates them team
   * by team in the allocation order; "independent" is Checkpoint 4's rule (every team's V* against the whole pool, so
   * two teams can pick up the same free agent), for the Checkpoint 4b report's comparison only: the app never sets it.
   */
  faAllocation?: FaAllocationMode;
  /**
   * IR returners (step 5b; planner reply to Checkpoint 4, change 5): true (the default) brings each team's IR players back
   * into its lineups from their expected return week, with the roster spot they need then; false is Checkpoint 4's rule
   * (IR players never join a lineup and, in the trade evaluation, aren't tradable), for the Checkpoint 4b report's
   * comparison only: the app never sets it.
   */
  irReturners?: boolean;
}

/** BuildLeagueModelOptions.faAllocation. */
export type FaAllocationMode = "oneTeam" | "independent";

// ---------------------------------------------------------------------------------------------
// Weeks and players

export interface LeagueWeeks {
  /** currentWeek..lastWeek. */
  weeks: number[];
  regularWeeks: number[];
  playoffWeeks: number[];
  lastWeek: number;
}

/**
 * The remaining NFL weeks (the Weeks section of the Phase 2 spec): currentWeek..lastWeek, lastWeek =
 * the last playoff week, else the last regular-season week, else `fallbackLastWeek` (inputs.lastWeek).
 */
export function leagueWeeks(settings: Pick<LeagueSettings, "regularSeasonWeeks" | "playoffWeeks">, currentWeek: number, fallbackLastWeek?: number): LeagueWeeks {
  const regular = settings.regularSeasonWeeks.filter((w) => Number.isInteger(w));
  const playoff = settings.playoffWeeks.filter((w) => Number.isInteger(w));
  const lastWeek = playoff.length ? Math.max(...playoff) : regular.length ? Math.max(...regular) : fallbackLastWeek !== undefined && Number.isInteger(fallbackLastWeek) ? fallbackLastWeek : currentWeek - 1;
  const weeks: number[] = [];
  if (Number.isInteger(currentWeek)) for (let w = currentWeek; w <= lastWeek; w++) weeks.push(w);
  const reg = new Set(regular);
  const po = new Set(playoff);
  return { weeks, regularWeeks: weeks.filter((w) => reg.has(w)), playoffWeeks: weeks.filter((w) => po.has(w)), lastWeek };
}

/**
 * The NFL regular season's last week from the inputs' schedule (ESPN's out-for-season marker is this + 1,
 * §4), or undefined when unknown (no schedule, or not a whole week ≥ 1).
 */
export function nflLastWeek(nfl: NflScheduleInputs | undefined): number | undefined {
  const w = nfl?.lastWeek;
  return typeof w === "number" && Number.isInteger(w) && w >= 1 ? w : undefined;
}

/** Whether his NFL team's currentWeek game has kicked off by `nowMs` (an unknown kickoff = not started). */
export function gameStarted(nflTeam: string | null, nfl: NflScheduleInputs | undefined, currentWeek: number, nowMs: number): boolean {
  if (!nflTeam || !nfl) return false;
  const iso = nfl.kickoffs?.[currentWeek]?.[nflTeam];
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t <= nowMs;
}

/** Whether any game of NFL week `week` has kicked off by `nowMs` (inputs.nfl.kickoffs; unknown kickoffs haven't). */
export function weekKickedOff(nfl: NflScheduleInputs | undefined, week: number, nowMs: number): boolean {
  const games = nfl?.kickoffs?.[week];
  if (!games) return false;
  return Object.values(games).some((iso) => {
    const t = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
    return Number.isFinite(t) && t <= nowMs;
  });
}

/**
 * The weeks team-level numbers count (the file header's game days), as indexes into LeagueModel.weeks.
 * With an in-progress current week (the first of `weeks`) they start the week after it.
 */
export interface TeamWeeks {
  /** The skipped current week, or null when every week counts (none in progress, or it isn't weeks[0]). */
  inProgressWeek: number | null;
  /** The first week index team numbers count: 1 with a week in progress, else 0. */
  from: number;
  /** ω per week for ROS(T), the free-agent optimizer, lineup costs and trade chips (weekWeights; 0 for the week in progress). */
  weights: Float64Array;
  /** The regular-season weeks PPW averages (the week in progress left out; none left → PPW 0). */
  regularWeeks: number[];
  /** Weeks in the "next" strength window: strengthWeeks, or fewer when fewer are left from `from`. */
  nNext: number;
  /** Equal weights over the next nNext weeks from `from`, and over every week from `from` (partner fit). */
  nextWeights: Float64Array;
  allWeights: Float64Array;
}

/**
 * TeamWeeks for a model's weeks and its week in progress (LeagueModel.inProgressWeek): scripts and Phase 4
 * price rosters over the same weeks the League model does.
 */
export function teamWeeks(
  weeks: { readonly weeks: readonly number[]; readonly regularWeeks: readonly number[]; readonly playoffWeeks: readonly number[] },
  inProgressWeek: number | null,
  cfg: { readonly playoffWeight: number; readonly strengthWeeks: number } = config.lineups,
): TeamWeeks {
  const W = weeks.weeks.length;
  const skipped = inProgressWeek !== null && W > 0 && weeks.weeks[0] === inProgressWeek ? inProgressWeek : null;
  const from = skipped === null ? 0 : 1;
  const weights = weekWeights(weeks.weeks, weeks.regularWeeks, weeks.playoffWeeks, cfg);
  if (skipped !== null) weights[0] = 0;
  const strengthWeeks = Number.isFinite(cfg.strengthWeeks) ? Math.max(0, Math.floor(cfg.strengthWeeks)) : 0;
  const nNext = Math.min(W - from, strengthWeeks);
  return {
    inProgressWeek: skipped,
    from,
    weights,
    regularWeeks: weeks.regularWeeks.filter((w) => w !== skipped),
    nNext,
    nextWeights: windowWeights(W, from, from + nNext),
    allWeights: windowWeights(W, from, W),
  };
}

/** Relevant player ids by role, in snapshot order (unique). */
interface Relevant {
  /** Every rostered id (active, IR, taxi), then every free agent not on a roster. */
  all: string[];
  active: Set<string>;
  /** Players on a team's IR (and on no active roster). */
  ir: Set<string>;
  rostered: Set<string>;
  freeAgents: string[];
}

function relevantIds(snapshot: LeagueSnapshot): Relevant {
  const all: string[] = [];
  const seen = new Set<string>();
  const active = new Set<string>();
  const ir = new Set<string>();
  const rostered = new Set<string>();
  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    all.push(id);
  };
  for (const t of snapshot.teams) {
    for (const id of t.roster) {
      active.add(id);
      rostered.add(id);
      add(id);
    }
    for (const id of [...t.ir, ...t.taxi]) {
      rostered.add(id);
      add(id);
    }
  }
  for (const t of snapshot.teams) for (const id of t.ir) if (!active.has(id)) ir.add(id);
  const freeAgents: string[] = [];
  for (const id of snapshot.freeAgents) {
    if (rostered.has(id) || seen.has(id)) continue;
    add(id);
    freeAgents.push(id);
  }
  return { all, active, ir, rostered, freeAgents };
}

/**
 * Conflicting ESPN signals (§6 step 3; the file header, step 3): for a PROBABLE, QUESTIONABLE or DOUBTFUL
 * player whose ESPN return week is 2+ weeks away (availability.returnDateConflict: config.projections.
 * returnConflictWeeks), which signal his availability follows (Sleeper breaks the tie) and the numbers behind it;
 * undefined for everyone else. `sleeperWeekLoaded` false (sleeperWeekLoaded, below: Sleeper's projections for this
 * week didn't load) leaves no tiebreaker: he follows the date, and the note says the projections were missing rather
 * than that Sleeper doesn't project him.
 */
export function availabilityNoteFor(
  info: Pick<PlayerInfo, "injury" | "injuryReturnWeek">,
  inputs: PlayerInputs,
  ctx: BaseRateContext,
  cfg: ProjectionConfig & Pick<AvailabilityConfig, "returnConflictWeeks"> = config.projections,
  sleeperWeekLoaded = true,
): AvailabilityNote | undefined {
  const conflict = returnDateConflict(info, ctx.currentWeek, cfg);
  if (!conflict) return undefined;
  const check = staleReturnCheck(inputs, ctx, cfg);
  const note: AvailabilityNote = { status: conflict.status, returnWeek: conflict.returnWeek, used: check.stale ? "sleeper" : "returnDate", sleeperNow: check.sleeperNow, healthyRate: check.healthyRate };
  if (sleeperWeekLoaded) return note;
  return { ...note, used: "returnDate", sleeperNow: null, sleeperUnavailable: true };
}

/**
 * Whether Sleeper's projections for NFL week `week` loaded: some player's inputs have that week (the model
 * inputs write every loaded week for every player with a Sleeper id, null when he has no real line, and
 * leave a week that didn't load out for everyone: src/server/modelInputs.ts assembleModelInputs).
 */
export function sleeperWeekLoaded(players: Readonly<Record<string, PlayerInputs>>, week: number): boolean {
  return Object.values(players).some((p) => Object.prototype.hasOwnProperty.call(p.sleeper, week));
}

/** A modeled player's availability inputs: who he is, his week context, and the availability player the model reads (without a stale return week). */
export interface PlayerContext {
  info: PlayerInfo;
  ctx: AvailabilityContext;
  /** What availability reads (availability.ts): his info, or his tag alone when Sleeper found his ESPN return date stale. */
  avail: AvailabilityPlayer;
}

/** Players, projections and the projection table (steps 1–3b), before scenarios are drawn. */
export interface LeaguePlayers {
  weeks: LeagueWeeks;
  /** Relevant players with a model (LeagueModel.players, values still null), the market blend applied (step 3b). */
  players: Record<string, PlayerModel>;
  /** Availability context per modeled player (scenario draws reuse it). */
  contexts: Map<string, PlayerContext>;
  relevant: Relevant;
  /** Relevant players left out: not in snapshot.players, or without model inputs. */
  skipped: { rostered: string[]; freeAgents: string[] };
  agreement: SourceAgreement | null;
  espnAveraged: boolean;
  /**
   * The market blend applied (step 3b; blend.ts): its weight, every player it reaches with his factor (his base rate
   * before it, the market curve's, the blend's and f, all points per game; whether he is a curve point) and each
   * position's curve size. Scripts report the factors from here; a pre-kickoff rebuild applies the same ones
   * (preKickoffTable).
   */
  blend: MarketBlend;
}

/**
 * Whether a modeled player may shape a market curve (step 3b's curve, blend.ts rule 4; and in FantasyCalc's curve
 * fallback the value curve of step 4, market.MarketPlayer.fit): healthy with a game left, i.e. no injury tag
 * (PlayerInfo.injury ACTIVE) and a game left on his NFL team's schedule (he has a team and a remaining week isn't his
 * bye). It doesn't depend on the moment (a game that kicked off still counts as on the schedule).
 */
export function marketCurveFit(c: Pick<PlayerContext, "info" | "ctx">, weeks: Pick<LeagueWeeks, "weeks">): boolean {
  return c.info.injury === "ACTIVE" && c.ctx.hasTeam && weeks.weeks.some((w) => w !== c.ctx.byeWeek);
}

/**
 * The build's market blend (step 3b; blend.ts) from its unblended players: each one's base rate b (points per game when he
 * plays) against this season's values for the league type (blend.blendValues), the curve fitted on the healthy ones
 * (marketCurveFit). None of it depends on the moment (b doesn't, and neither does marketCurveFit), so a build made once a
 * week is under way gets the factors one made before its first kickoff gets. No blend without this season's values.
 */
function buildMarketBlend(
  snapshot: LeagueSnapshot,
  inputs: ModelInputs,
  weeks: LeagueWeeks,
  players: Readonly<Record<string, PlayerModel>>,
  contexts: ReadonlyMap<string, PlayerContext>,
  cfg: LeagueModelConfig,
): MarketBlend {
  const values = blendValues(inputs.market, snapshot.settings.leagueType);
  if (!values) return noBlend();
  const list = Object.entries(players).flatMap(([id, pm]) => {
    const c = contexts.get(id);
    if (!c) return [];
    return [{ id, pos: c.info.pos, rate: pm.base.b, fit: marketCurveFit(c, weeks) }];
  });
  return marketBlend(list, values, cfg.marketBlend);
}

/**
 * Steps 1–3b without the scenarios: weeks, the ESPN/Sleeper agreement, availability, projections and the market blend.
 * The blend's factors are this build's own (buildMarketBlend, over every modeled player), unless `blend` gives them: a
 * rebuild that models fewer players (preKickoffTable: the streamed positions' free agents only) applies the build's.
 */
export function projectLeaguePlayers(snapshot: LeagueSnapshot, inputs: ModelInputs, now: Date, cfg: LeagueModelConfig = config, blend?: MarketBlend): LeaguePlayers {
  const currentWeek = snapshot.currentWeek;
  const weeks = leagueWeeks(snapshot.settings, currentWeek, inputs.lastWeek);
  const relevant = relevantIds(snapshot);
  const inputPlayers = inputs.players ?? {};

  let agreement: SourceAgreement | null = null;
  if (snapshot.platform === "espn" && inputs.espnProjections) {
    agreement = espnSleeperAgreement(
      [...relevant.rostered].filter((id) => inputPlayers[id]),
      inputPlayers,
      currentWeek,
      cfg.projections,
    );
  }
  const espnAveraged = agreement?.agree === true;

  const nowMs = now.getTime();
  const lastNflWeek = nflLastWeek(inputs.nfl);
  const players: Record<string, PlayerModel> = {};
  const contexts = new Map<string, PlayerContext>();
  const skipped = { rostered: [] as string[], freeAgents: [] as string[] };
  const baseCtx: BaseRateContext = { currentWeek, weeks: weeks.weeks, espnAveraged };
  const sleeperNowLoaded = sleeperWeekLoaded(inputPlayers, currentWeek);
  for (const id of relevant.all) {
    const info = snapshot.players[id];
    const pin = inputPlayers[id];
    if (!info || !pin) {
      (relevant.rostered.has(id) ? skipped.rostered : skipped.freeAgents).push(id);
      continue;
    }
    const team = info.nflTeam ? info.nflTeam : null;
    const byeWeek = team ? inputs.nfl?.byeWeek?.[team] : undefined;
    const started = gameStarted(team, inputs.nfl, currentWeek, nowMs);
    const ctx: AvailabilityContext = { weeks: weeks.weeks, currentWeek, byeWeek, started, hasTeam: team !== null, ...(lastNflWeek !== undefined ? { lastNflWeek } : {}) };
    // Conflicting ESPN signals: a stale return date is dropped, for his expected availability and his scenarios alike.
    const note = availabilityNoteFor(info, pin, baseCtx, cfg.projections, sleeperNowLoaded);
    const avail: AvailabilityPlayer = note?.used === "sleeper" ? { injury: info.injury } : info;
    const availability = expectedAvailability(avail, info.pos, ctx, cfg.projections);
    // A PROBABLE, QUESTIONABLE or DOUBTFUL player gets the Q/D/P base rate (projections.ts): this week's cut projections count nowhere.
    const pm = projectPlayer(id, info.pos, pin, availability, { ...baseCtx, regularWeeks: weeks.regularWeeks, playoffWeeks: weeks.playoffWeeks, byeWeek, started, hasTeam: team !== null, injury: info.injury }, cfg.projections);
    players[id] = note ? { ...pm, availabilityNote: note } : pm;
    contexts.set(id, { info, ctx, avail });
  }
  // 3b. The market blend: this build's factors, or the ones given (a rebuild of the same build with fewer players).
  const applied = blend ?? buildMarketBlend(snapshot, inputs, weeks, players, contexts, cfg);
  if (applied.weight > 0) {
    for (const [id, pm] of Object.entries(players)) {
      const c = contexts.get(id);
      if (c) players[id] = applyBlend(pm, c.info.pos, applied, cfg.projections);
    }
  }
  return { weeks, players, contexts, relevant, skipped, agreement, espnAveraged, blend: applied };
}

/**
 * The projection table (teamValue.ts) from projected players: conditional points b·m_w, expected points
 * p_w, their SDs (§6 step 5: σ given he plays, c_pos × b·m_w + d_pos, and PlayerModel.weekly[w].sd) and,
 * when S > 0, S availability scenarios for active-roster players, free agents and, with `irFlags` (step 5b's IR
 * returners; the default), IR players (streamFor(seed, playerId, s): the same flags whichever team he is on, so
 * drawing an IR player's changes nobody else's). Taxi players never get flags (they never start).
 */
export function projectionTable(lp: LeaguePlayers, S: number, seed: number, cfg: LeagueModelConfig = config, irFlags = true): ProjectionTable {
  const rows = new Map<string, TableRow>();
  const scenarios = Number.isFinite(S) ? Math.max(0, Math.floor(S)) : 0;
  const freeAgents = new Set(lp.relevant.freeAgents);
  for (const [id, pm] of Object.entries(lp.players)) {
    const c = lp.contexts.get(id);
    if (!c) continue;
    const drawn = scenarios > 0 && (lp.relevant.active.has(id) || freeAgents.has(id) || (irFlags && lp.relevant.ir.has(id)));
    const cond = Float64Array.from(pm.weekly, (w) => pm.base.b * w.m);
    rows.set(id, {
      id,
      pos: c.info.pos,
      eligible: c.info.eligible,
      cond,
      ev: Float64Array.from(pm.weekly, (w) => w.p),
      condSd: Float64Array.from(cond, (x) => weeklySd(x, c.info.pos, cfg.projections)),
      evSd: Float64Array.from(pm.weekly, (w) => w.sd),
      flags: drawn ? scenarioAvailability(id, c.avail, c.info.pos, c.ctx, scenarios, seed, cfg.projections) : null,
    });
  }
  return { weeks: lp.weeks.weeks, scenarios, rows };
}

/**
 * Steps 1–3b in one call (tests and scripts): projected players and their projection table. The market blend's factors
 * are the ones the League model computes for the same snapshot and inputs, unless `blend` gives them (a script rebuilding
 * a model's week in progress before its kickoff may pass that model build's LeaguePlayers.blend, as preKickoffTable does).
 */
export function buildProjectionTable(
  snapshot: LeagueSnapshot,
  inputs: ModelInputs,
  opts: BuildLeagueModelOptions,
  cfg: LeagueModelConfig = config,
  blend?: MarketBlend,
): { players: LeaguePlayers; table: ProjectionTable } {
  const players = projectLeaguePlayers(snapshot, inputs, opts.now, cfg, blend);
  return { players, table: projectionTable(players, scenarioCount(opts.scenarios ?? cfg.lineups.scenarios), opts.seed ?? cfg.lineups.scenarioSeed, cfg, opts.irReturners !== false) };
}

function scenarioCount(s: number): number {
  return Number.isFinite(s) ? Math.max(0, Math.floor(s)) : 0;
}

/** The earliest kickoff of NFL week `week` (inputs.nfl.kickoffs; unreadable times skipped), ms since the epoch, or null when none is known. */
export function firstKickoff(nfl: NflScheduleInputs | undefined, week: number): number | null {
  let first = Number.POSITIVE_INFINITY;
  for (const iso of Object.values(nfl?.kickoffs?.[week] ?? {})) {
    const t = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
    if (Number.isFinite(t) && t < first) first = t;
  }
  return Number.isFinite(first) ? first : null;
}

/**
 * The week in progress with every game still to play (the file header, "Game days"; TeamModel.score): the
 * projection table rebuilt for 1 ms before the week's earliest known kickoff. Rostered players, and the free
 * agents at `freeAgentPositions` (the streamed positions: their streaming replacement that week is taken
 * before kickoff too); other free agents don't change a team's score. A player's projection doesn't depend
 * on the moment, and his scenario draws depend only on the seed, his id and the scenario, so the table
 * matches the one at `opts.now` in every week but the first, where only the games that had kicked off come
 * back. The market blend (step 3b) applies the build's own factors, `blend` (the build's LeaguePlayers.blend; when
 * absent, the ones the whole snapshot gives), not factors of its own: every modeled free agent is one of the blend's
 * curve points, and this table models only the streamed positions' ones. The factors don't depend on the moment, so
 * every week but the first stays identical.
 * ⚠️ It is not the week as it stood at kickoff: the snapshot's rosters and injury tags are today's (a
 * tag added after a player's game zeroes that game here, and a player moved since kickoff plays for his new
 * team). Null when `inProgressWeek` is null (LeagueModel.inProgressWeek) or its kickoffs are unknown.
 */
export function preKickoffTable(
  snapshot: LeagueSnapshot,
  inputs: ModelInputs,
  inProgressWeek: number | null,
  opts: BuildLeagueModelOptions,
  cfg: LeagueModelConfig = config,
  freeAgentPositions: ReadonlySet<Pos> = new Set(),
  blend?: MarketBlend,
): { now: Date; table: ProjectionTable } | null {
  if (inProgressWeek === null) return null;
  const first = firstKickoff(inputs.nfl, inProgressWeek);
  if (first === null) return null;
  const now = new Date(first - 1);
  const freeAgents = snapshot.freeAgents.filter((id) => {
    const pos = snapshot.players[id]?.pos;
    return pos !== undefined && freeAgentPositions.has(pos);
  });
  const factors = blend ?? projectLeaguePlayers(snapshot, inputs, now, cfg).blend;
  const players = projectLeaguePlayers({ ...snapshot, freeAgents }, inputs, now, cfg, factors);
  return { now, table: projectionTable(players, scenarioCount(opts.scenarios ?? cfg.lineups.scenarios), opts.seed ?? cfg.lineups.scenarioSeed, cfg, opts.irReturners !== false) };
}

// ---------------------------------------------------------------------------------------------
// Streaming positions (§7; planner reply to Checkpoint 3, model change 1; the file header, step 5a)

/** Positions the league's lineup starts: a starting slot with at least one spot lists them (lineup.ts drops the rest). */
export function startablePositions(settings: Pick<LeagueSettings, "lineup">): Set<Pos> {
  const known = new Set<Pos>(POSITIONS);
  const out = new Set<Pos>();
  for (const s of settings.lineup) {
    if (!(Number.isFinite(s.count) && Math.floor(s.count) >= 1)) continue;
    for (const p of s.eligible) if (known.has(p)) out.add(p);
  }
  return out;
}


/**
 * Adds per team at each streamable position this season (the detection's evidence; step 5a): every move to
 * a team in an "add" or "waiver" transaction (snapshot.transactions are this season's), at the move's
 * position (Transaction moves carry it since Phase 4) or, without one, the player's in snapshot.players. A
 * move whose position is unknown or not streamable doesn't count. Team id → position → adds.
 */
export function streamingAdds(snapshot: Pick<LeagueSnapshot, "transactions" | "players">, streamable: readonly Pos[]): Map<string, Partial<Record<Pos, number>>> {
  const allowed = new Set<Pos>(streamable);
  const out = new Map<string, Partial<Record<Pos, number>>>();
  for (const t of snapshot.transactions ?? []) {
    if (t.type !== "add" && t.type !== "waiver") continue;
    for (const m of t.moves ?? []) {
      if (!m.to) continue;
      const pos = m.pos ?? snapshot.players[m.playerId]?.pos;
      if (pos === undefined || !allowed.has(pos)) continue;
      const counts = out.get(m.to) ?? {};
      counts[pos] = (counts[pos] ?? 0) + 1;
      out.set(m.to, counts);
    }
  }
  return out;
}

/**
 * The positions each team streams (step 5a; lead decision L1): my team (`myTeamId`, when it is one of the
 * league's teams) streams `streamPositions` (the user's "Positions I stream weekly"), whatever its adds; every
 * other team streams each config.streaming.streamable position where it made detectAdds or more adds this
 * season (streamingAdds). Only streamable positions the lineup starts count, in POSITIONS order.
 */
export function streamedPositions(
  snapshot: Pick<LeagueSnapshot, "teams" | "transactions" | "players" | "settings">,
  myTeamId: string | null,
  settings: Pick<TradeSettings, "streamPositions">,
  cfg: Pick<LeagueModelConfig, "streaming"> = config,
): Record<string, StreamingTeam> {
  const streamable = new Set<Pos>(cfg.streaming.streamable);
  const startable = startablePositions(snapshot.settings);
  const usable = (p: Pos) => streamable.has(p) && startable.has(p);
  const adds = streamingAdds(snapshot, cfg.streaming.streamable);
  const mine = new Set<Pos>(settings.streamPositions);
  const out: Record<string, StreamingTeam> = {};
  for (const team of snapshot.teams) {
    const counts = adds.get(team.id) ?? {};
    const setting = team.id === myTeamId;
    const positions = POSITIONS.filter((p) => usable(p) && (setting ? mine.has(p) : (counts[p] ?? 0) >= cfg.streaming.detectAdds));
    out[team.id] = { positions, source: setting ? "setting" : "detected", adds: { ...counts } };
  }
  return out;
}

/** Streaming rows from one projection table (streamingRows). */
export interface StreamingRows {
  /** The virtual row per position (teamValue.streamRow), only when its replacement scores in some week (a row of 0s changes no lineup). */
  rows: Map<Pos, TableRow>;
  /** The replacement per week (aligned with the table's weeks) for every position asked for (0s without free agents there). */
  replacement: Map<Pos, Float64Array>;
}

/**
 * The streaming rows for `positions` (step 5a): at each, the replacement per week from the free agents with a
 * row in `table` at that primary position (teamValue.streamingReplacement: the config.streaming.streamRank-th
 * best that week), and its virtual row. One row per position serves every team that streams it.
 */
export function streamingRows(table: ProjectionTable, freeAgentIds: readonly string[], positions: Iterable<Pos>, cfg: Pick<LeagueModelConfig, "streaming" | "projections"> = config): StreamingRows {
  const rows = new Map<Pos, TableRow>();
  const replacement = new Map<Pos, Float64Array>();
  const W = table.weeks.length;
  for (const pos of new Set(positions)) {
    const candidates = freeAgentIds.flatMap((id) => {
      const row = table.rows.get(id);
      return row && row.pos === pos && !isStreamId(id) ? [row] : [];
    });
    const rep = streamingReplacement(candidates, W, cfg.streaming.streamRank);
    replacement.set(pos, rep);
    if (rep.some((x) => x > 0)) rows.set(pos, streamRow(pos, rep, table.scenarios, cfg.projections));
  }
  return { rows, replacement };
}

/** The positions "Streaming picks this week" lists (§7, planner's model change 1): kickers and team defenses. */
const PICK_POSITIONS: readonly StreamingPick["pos"][] = ["K", "DEF"];

/**
 * "Streaming picks this week" (step 5a): for K and DEF, when the lineup starts them, the free agents with a row
 * in `table` at that primary position, by their expected points in the table's first week (the current NFL
 * week; availability included, so one on bye or whose game has started scores 0 and isn't a pick), best first
 * (ties: the smaller id), the first config.streaming.picksShown; each with that week's opponent from
 * `nfl.opponents` (null when unknown). Empty when the table's first week isn't `currentWeek` (no week left).
 */
export function streamingPicks(
  table: ProjectionTable,
  freeAgentIds: readonly string[],
  snapshot: Pick<LeagueSnapshot, "players" | "settings" | "currentWeek">,
  nfl: NflScheduleInputs | undefined,
  cfg: Pick<LeagueModelConfig, "streaming"> = config,
): StreamingPick[] {
  if (table.weeks[0] !== snapshot.currentWeek) return [];
  const startable = startablePositions(snapshot.settings);
  const shown = Number.isFinite(cfg.streaming.picksShown) ? Math.max(0, Math.floor(cfg.streaming.picksShown)) : 0;
  const out: StreamingPick[] = [];
  for (const pos of PICK_POSITIONS) {
    if (!startable.has(pos)) continue;
    const best = freeAgentIds
      .flatMap((id) => {
        const row = table.rows.get(id);
        const p = row?.ev[0] ?? 0;
        return row && row.pos === pos && p > 0 && Number.isFinite(p) ? [{ id, p }] : [];
      })
      .sort((a, b) => b.p - a.p || byId(a.id, b.id))
      .slice(0, shown);
    for (const { id, p } of best) {
      const team = snapshot.players[id]?.nflTeam;
      const opp = team ? nfl?.opponents?.[snapshot.currentWeek]?.[team] : undefined;
      out.push({ playerId: id, pos, projection: p, opponent: opp ? { team: opp.team, home: opp.home } : null });
    }
  }
  return out;
}

/**
 * `table` with streaming rows added under their ids (`stream:<POS>`), so teamValue's friendly API (functions
 * that take roster ids) prices a team as the League model does when the roster lists its streamIds. Scripts,
 * tests and trade evaluation use it; the model itself keeps the rows apart from the table.
 */
export function withStreamingRows(table: ProjectionTable, rows: Iterable<TableRow>): ProjectionTable {
  const all = new Map(table.rows);
  for (const r of rows) all.set(r.id, r);
  return { weeks: table.weeks, scenarios: table.scenarios, rows: all };
}

/** A team's streaming row ids (LeagueModel.streaming.byTeam), for rosters priced through withStreamingRows (a position without a row is skipped there). */
export function streamIds(model: Pick<LeagueModel, "streaming">, teamId: string): string[] {
  return (model.streaming.byTeam[teamId]?.positions ?? []).map(streamRowId);
}

/**
 * A projection table (buildProjectionTable's) with the League model's streaming rows added
 * (withStreamingRows), built from the table's own free agents the way buildLeagueModel builds them.
 */
export function tableWithStreaming(built: { players: LeaguePlayers; table: ProjectionTable }, model: Pick<LeagueModel, "streaming">, cfg: Pick<LeagueModelConfig, "streaming" | "projections"> = config): ProjectionTable {
  const positions = new Set(Object.values(model.streaming.byTeam).flatMap((s) => s.positions));
  const freeAgents = built.players.relevant.freeAgents.filter((id) => built.table.rows.has(id));
  return withStreamingRows(built.table, streamingRows(built.table, freeAgents, positions, cfg).rows.values());
}

/**
 * The settings the model runs with (BuildLeagueModelOptions.settings): normalized (settings.ts), or the
 * defaults with the config's playoff weight (the same as defaultTradeSettings() unless a caller tunes the
 * config).
 */
export function modelSettings(raw: TradeSettings | undefined, cfg: Pick<LeagueModelConfig, "lineups"> = config): TradeSettings {
  return raw ? normalizeTradeSettings(raw) : { ...defaultTradeSettings(), playoffWeight: cfg.lineups.playoffWeight };
}

// ---------------------------------------------------------------------------------------------
// Warnings

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The market blend is off (the file header, step 3b) although FantasyCalc's values loaded: this season's list it needs
 * (a dynasty league's redraft list in its format, MarketInputs.seasonValues, or a keeper league's redraft list) didn't.
 * Never in FantasyCalc's curve fallback (MarketInputs.fallback kind "curve"): the blend is off there too, but the lists did
 * load (old ones), so BLEND_OFF_CURVE_WARNING says it there.
 */
export const BLEND_OFF_WARNING = "The trade-market blend is off: FantasyCalc's redraft values didn't load.";

/**
 * The market blend is off in FantasyCalc's curve fallback (the file header, step 3b; MarketInputs.fallback kind "curve":
 * FantasyCalc didn't answer and the newest list is too old to read as today's, so nothing is blended toward it). The model
 * inputs' banner (FANTASYCALC_VALUES_ESTIMATED, market.fantasyCalcFallbackText) speaks of trade values only, so this says
 * what it means for projections (review of track EF, finding 2: with the blend off, nothing else on the League page or
 * the Trade Finder did).
 */
export const BLEND_OFF_CURVE_WARNING =
  "The trade-market blend is off: FantasyCalc didn't answer and its newest values are too old, so projections aren't pulled toward the trade market.";

function nameList(ids: readonly string[], snapshot: LeagueSnapshot, max = 5): string {
  const names = ids.slice(0, max).map((id) => snapshot.players[id]?.name ?? id);
  return `${names.join(", ")}${ids.length > max ? ", …" : ""}`;
}

/**
 * Plain-English notes about gaps, worded from what actually loaded. The ESPN/Sleeper note (ESPN leagues
 * whose projections weren't averaged) follows the base-rate sources (`sources`): which projections the
 * numbers use, and it says the two were compared only when they were. Nothing about projections once no
 * week is left to project. Missing trade values are the model inputs' own warning (nothing here needs
 * them: trade chips and partners are lineup points); values that loaded without this season's list the
 * market blend needs (step 3b) get BLEND_OFF_WARNING, while some player is projected (a league renewed for
 * a season that hasn't started projects nobody, and its server doesn't ask for the list); FantasyCalc's curve fallback,
 * whose old lists blend nothing, gets BLEND_OFF_CURVE_WARNING under the same conditions instead.
 */
function modelWarnings(snapshot: LeagueSnapshot, inputs: ModelInputs, lp: LeaguePlayers, sources: Readonly<Record<BaseRateSource, number>>, cfg: LeagueModelConfig): string[] {
  const out: string[] = [];
  const weeksLeft = lp.weeks.weeks.length > 0;
  if (inputs.currentWeek !== snapshot.currentWeek) {
    out.push(`The projections were prepared for week ${inputs.currentWeek}, but the league is in week ${snapshot.currentWeek}. Refresh to update them.`);
  }
  const { rostered, freeAgents } = lp.skipped;
  if (rostered.length) out.push(`No projections for ${plural(rostered.length, "rostered player")} (${nameList(rostered, snapshot)}), so they count as 0 points.`);
  if (freeAgents.length) out.push(`No projections for ${plural(freeAgents.length, "free agent")}, so they are left out.`);
  if (weeksLeft && snapshot.platform === "espn" && inputs.espnProjections && !lp.espnAveraged) {
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const a = lp.agreement?.agreement;
    const fromSleeper = sources.sleeper + sources["espn+sleeper"];
    // Players Sleeper doesn't project fall back to ESPN's own projection (projections.ts).
    const espnOnly = sources.espn > 0 ? ` (ESPN's for the ${plural(sources.espn, "player")} Sleeper doesn't project)` : "";
    if (a) {
      out.push(`ESPN's projections differ from Sleeper's by ${pct(a.meanRelDiff)} on average this week (more than ${pct(cfg.projections.espnSleeperAgreement)}), so projections use Sleeper's alone${espnOnly}.`);
    } else if (fromSleeper > 0) {
      out.push(`ESPN's and Sleeper's projections couldn't be compared this week (no rostered player has both), so projections use Sleeper's alone${espnOnly}.`);
    } else if (sources.espn > 0) {
      out.push("Sleeper's projections are missing, so projections use ESPN's alone.");
    }
  }
  // The blend is off for want of this season's list, and there was something to blend: someone is projected. The curve
  // fallback's lists loaded (old ones, read only by the value curve): its own words say so.
  const projected = Object.values(lp.players).some((pm) => pm.ros.total > 0);
  if (weeksLeft && projected && inputs.market && cfg.marketBlend.weight > 0 && !blendValues(inputs.market, snapshot.settings.leagueType)) {
    out.push(inputs.market.fallback?.kind === "curve" ? BLEND_OFF_CURVE_WARNING : BLEND_OFF_WARNING);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Teams

export interface TeamWork {
  team: Team;
  /** Every distinct id on team.roster, in roster order: each takes an active-roster spot, with a model or not. */
  ids: string[];
  /** Active-roster players with a model, in roster order. */
  rows: TableRow[];
  /** Every distinct id on team.ir, in IR order (step 5b), but one also on team.roster (a data error: he's an active player). */
  ir: string[];
  /**
   * The team's streaming rows and streamed positions (step 5a) and its IR returners (step 5b: StreamSpec.returners; none
   * under irReturners false). Every lineup of the team is valued with the streaming rows after its players and the
   * returners after them (so a player's roster index is the same in all), but they are never one of its active players:
   * no roster spot, no lineup cost among the active players', never dropped (but by a final evaluation's displacement,
   * returners.finalLineups), a chip or a free-agent move.
   */
  stream: StreamSpec;
  /**
   * The returners' lineup costs (step 5b; TeamModel.players): what losing each one costs V*(T)'s lineups, EV and scenario
   * (null without scenarios), floored at 0. Nobody refills him: his IR slot opens, no active spot.
   */
  returnerCosts: { id: string; ev: number; scen: number | null }[];
  /** The returners' surplus scores (step 7, aligned with returnerCosts), standardized with the active players'. */
  returnerScores: number[];
  /** The team as it stands: its rows and streaming rows prepared, its EV lineups and EV ROS. */
  evalT: TeamEval;
  solved: SolvedWeeks;
  evRos: number;
  /** Its scenario lineups (instances for strength, the within-lineup variance for its score) and scenario ROS; null without scenarios. */
  scen: ScenarioValues | null;
  scenRos: number | null;
  /** V*(T), the free-agent optimizer's roster (step 5), its scenario ROS and scenario lineups cell by cell (null without scenarios). */
  vstar: OptimizedRoster;
  vstarScen: number | null;
  vstarCells: ScenarioCells | null;
  /**
   * The free agents V*(T) claimed (step 5: every free agent its run added, in move order, one a later move swapped away
   * included), and excl(T), the pool restriction of every later run of T: the free agents every other team claimed
   * (FULL_POOL under faAllocation "independent").
   */
  claimed: string[];
  pool: PoolRestriction;
  /** Per row: V*(T − i), the re-run from V*(T)'s roster without him (step 5; its exchanges in `given`), or null when V*(T) dropped him. */
  losses: (OptimizedRoster | null)[];
  /** Per row: MV_lose, EV and scenario lineups (step 5). */
  mvLoseEv: number[];
  mvLoseScen: (number | null)[];
  faMoves: FaMove[];
  scores: number[];
}

/** Everything steps 1–5 build: the League model, its trade chips and partners, and leagueMarginals read it (and Phase 4's trade evaluation: evaluate.ts). */
export interface LeagueContext {
  snapshot: LeagueSnapshot;
  cfg: LeagueModelConfig;
  settings: TradeSettings;
  S: number;
  W: number;
  lp: LeaguePlayers;
  tw: TeamWeeks;
  weights: Float64Array;
  table: ProjectionTable;
  valueOf: (id: string) => number;
  market: MarketSummary;
  freeAgentIds: string[];
  slots: PreparedSlots;
  instances: SlotInstance[];
  index: InstanceIndex;
  maskOf: (row: TableRow) => number;
  posOf: (id: string) => Pos | undefined;
  limits: Partial<Record<Pos, number>> | undefined;
  maxRosterSize: number;
  byTeam: Record<string, StreamingTeam>;
  streamed: Set<Pos>;
  stream: StreamingRows;
  picks: StreamingPick[];
  optimizer: RosterOptimizer;
  /** A roster's ROS in scenario lineups (memoized by its key); only with scenarios. */
  scenRosOf: (roster: readonly string[], stream: StreamSpec) => number;
  work: TeamWork[];
  /** The free-agent allocation (step 5): its basis and the order, as indexes into `work`; null under faAllocation "independent". */
  allocation: { basis: FaAllocation["basis"]; order: number[] } | null;
  /** IR returners on (step 5b; BuildLeagueModelOptions.irReturners, default true). */
  irReturners: boolean;
  /**
   * A modeled player's expected return week (step 5b; availability.expectedReturnWeek on what his availability reads):
   * an NFL week of the model's weeks, or null when he isn't back within them (or has no model).
   */
  returnWeek: (id: string) => number | null;
  /**
   * `base` (a team's streaming rows and positions) with the returners among `ir` (returners.returnerSpec: IR players with
   * a model and a return week, in id order); `base`'s rows and positions alone under irReturners false.
   */
  withReturners: (base: StreamSpec, ir: readonly string[]) => StreamSpec;
  /** What final evaluations read for the displacement (step 5b; returners.finalLineups): this build's lineups and values. */
  returnerSetup: ReturnerSetup;
}

/** A team's place in the allocation order (allocationOrder): what it reports. */
export type AllocationTeam = Pick<Team, "waiverRank" | "faabRemaining">;

/** allocationOrder's "gain" basis compares gains to the nearest this many points (float noise, not a tunable). */
const GAIN_TIE = 1e-6;

/** A whole number ≥ 1 (a waiver rank the engine reads), else undefined. */
function rankOf(t: AllocationTeam): number | undefined {
  const r = t.waiverRank;
  return typeof r === "number" && Number.isInteger(r) && r >= 1 ? r : undefined;
}

/** A finite budget ≥ 0 (a remaining FAAB budget the engine reads), else undefined. */
function budgetOf(t: AllocationTeam): number | undefined {
  const b = t.faabRemaining;
  return typeof b === "number" && Number.isFinite(b) && b >= 0 ? b : undefined;
}

/**
 * The order teams claim free agents in (step 5; §7 one free agent, one team), as indexes into `teams` (snapshot order),
 * and what decided it:
 * - "faab": a FAAB league (`faabLeague`: settings.faabBudget set) where every team reports a remaining budget
 *   (Team.faabRemaining, a finite number ≥ 0): the most remaining budget first; ties: the better waiver rank (a team
 *   with one before a team without), then snapshot order;
 * - "waiver": otherwise, when every team reports a waiver rank (Team.waiverRank, a whole number ≥ 1; 1 = first
 *   claim): waiver rank ascending; ties: snapshot order;
 * - "gain": otherwise, `gain(i)`, each team's best single-move gain against the whole pool (0 when it makes none),
 *   highest first, compared to the nearest GAIN_TIE points (float noise: two identical teams' gains can differ in the
 *   last bits); ties keep snapshot order. `gain` is called only for this basis, once per team.
 */
export function allocationOrder(teams: readonly AllocationTeam[], faabLeague: boolean, gain: (index: number) => number): { basis: FaAllocation["basis"]; order: number[] } {
  const idx = teams.map((_, i) => i);
  const rank = (i: number) => rankOf(teams[i] as AllocationTeam) ?? Number.POSITIVE_INFINITY;
  if (faabLeague && teams.length > 0 && teams.every((t) => budgetOf(t) !== undefined)) {
    const budget = (i: number) => budgetOf(teams[i] as AllocationTeam) as number;
    return { basis: "faab", order: idx.sort((a, b) => budget(b) - budget(a) || (rank(a) === rank(b) ? 0 : rank(a) < rank(b) ? -1 : 1) || a - b) };
  }
  if (teams.length > 0 && teams.every((t) => rankOf(t) !== undefined)) {
    return { basis: "waiver", order: idx.sort((a, b) => rank(a) - rank(b) || a - b) };
  }
  // Whole multiples of GAIN_TIE: a total order (an epsilon comparison isn't transitive).
  const gains = idx.map((i) => {
    const g = gain(i);
    return Number.isFinite(g) ? Math.round(g / GAIN_TIE) : 0;
  });
  return { basis: "gain", order: idx.sort((a, b) => (gains[b] as number) - (gains[a] as number) || a - b) };
}

/**
 * A near-tie tolerance in points a week (config.lineups.dropNearTieWeekly) in ROS lineup points: × the sum of the weeks'
 * weights (the weeks team numbers count, the user's playoff weight). 0 for a tolerance that isn't a positive number.
 * Roster legality's forced drops (evaluate.ts keepValues) and the optimizer's moves (OptimizerSetup.dropNearTie) read it.
 */
export function nearTieRos(perWeek: number | undefined, weights: ArrayLike<number>): number {
  if (perWeek === undefined || !Number.isFinite(perWeek) || !(perWeek > 0)) return 0;
  let sum = 0;
  for (let w = 0; w < weights.length; w++) {
    const x = weights[w] as number;
    if (Number.isFinite(x) && x > 0) sum += x;
  }
  return perWeek * sum;
}

/**
 * The free agents an optimizer run claims (step 5): every free agent one of its moves added, in move order, each once
 * (⚠️ one a later move of the same run swapped away included: no other team's run may add him, so no free agent shows in
 * two teams' moves and greedy determinism holds, but for near-ties; optimizer.ts, "The pool").
 */
export function claimedBy(run: Pick<OptimizedRoster, "moves">): string[] {
  return [...new Set(run.moves.map((m) => m.add))];
}

/** A lineup cost in the mode chips and drops read: scenario lineups when scenarios ran, else EV. */
function costOf(t: TeamWork, x: number): number {
  return t.mvLoseScen[x] ?? (t.mvLoseEv[x] as number);
}

/** A re-run's ROS in the lineup costs' mode (scenario lineups when scenarios ran, else EV). */
function rerunRos(ctx: LeagueContext, t: TeamWork, run: OptimizedRoster): number {
  return ctx.S > 0 ? ctx.scenRosOf(run.roster, t.stream) : run.evRos;
}

/** LV per week (every week, a week in progress included: a partial week), and ROS(T) and PPW over the weeks team numbers count. */
function lineupValues(lv: ArrayLike<number>, tw: TeamWeeks, weeks: LeagueWeeks): LineupValues {
  return { lv: Array.from(lv), ros: rosValue(lv, tw.weights), ppw: ppw(lv, weeks.weeks, tw.regularWeeks) };
}

/** positions without one occurrence of `pos`. */
function withoutOne(positions: readonly Pos[], pos: Pos): Pos[] {
  const i = positions.indexOf(pos);
  return i < 0 ? [...positions] : [...positions.slice(0, i), ...positions.slice(i + 1)];
}

/**
 * The long-term values (§9's future term, estimates for players FantasyCalc doesn't value) and the top dynasty value, in
 * dynasty and keeper leagues whose dynasty values loaded (benefit.futureValuesLoaded); null otherwise. The dynasty guard
 * (step 5) and the displacement's keep value (step 5b) read them.
 */
function futureTerm(snapshot: LeagueSnapshot, inputs: ModelInputs, players: readonly { id: string; pos: Pos }[], rosPoints: Readonly<Record<string, number>>, cfg: LeagueModelConfig): FutureKeep | null {
  const market = inputs.market ?? null;
  if (!market || !futureValuesLoaded(snapshot.settings.leagueType, market)) return null;
  const future = marketValues(players, rosPoints, market, cfg.market, "future");
  const top = valuesForTerm(market, "future").topValue;
  return { value: (id) => future[id]?.value ?? 0, top: Number.isFinite(top) && top > 0 ? top : 0 };
}

/** The dynasty guard (step 5) from the long-term values: the most a drop may give up over the free agent added, faDynGuard × the top dynasty value. Null without them (no guard). */
function dynastyGuard(future: FutureKeep | null, cfg: LeagueModelConfig): DynastyGuard | null {
  return future ? { value: future.value, maxDrop: cfg.freeAgentOptimizer.faDynGuard * future.top } : null;
}

/** Steps 1–5 (the file header): projections, scenarios, values, streaming, every team's lineups, V* and lineup costs. */
function prepareLeague(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: BuildLeagueModelOptions, cfg: LeagueModelConfig, mark: (stage: string) => void): LeagueContext {
  const S = scenarioCount(opts.scenarios ?? cfg.lineups.scenarios);
  const seed = opts.seed ?? cfg.lineups.scenarioSeed;
  // The user's settings: my streamed positions (step 5a) and the playoff weight every ROS(T) uses.
  const settings = modelSettings(opts.settings, cfg);
  // IR returners (step 5b): on unless a report asks for Checkpoint 4's rule.
  const irOn = opts.irReturners !== false;

  // 1–3b. Weeks, players, projections and the market blend (its factors computed once, here), then the scenarios; the
  // weeks team numbers count (game days: the file header). Everything from the table on reads blended points.
  const lp = projectLeaguePlayers(snapshot, inputs, opts.now, cfg);
  const { weeks } = lp;
  const W = weeks.weeks.length;
  const tw = teamWeeks(weeks, weekKickedOff(inputs.nfl, snapshot.currentWeek, opts.now.getTime()) ? snapshot.currentWeek : null, { ...cfg.lineups, playoffWeight: settings.playoffWeight });
  const { weights } = tw;
  mark("projections");
  const table = projectionTable(lp, S, seed, cfg, irOn);
  if (S > 0) mark("availability scenarios");

  // 4. Market values and the waiver credit, after the blend (step 3b). `fit`: whether he may be a point of FantasyCalc's
  // curve fallback (the file header, step 4; only that path reads it): step 3b's healthy rule.
  const modelIds = Object.keys(lp.players);
  const valuePlayers = modelIds.map((id) => {
    const c = lp.contexts.get(id) as PlayerContext;
    return { id, pos: c.info.pos, fit: marketCurveFit(c, weeks) };
  });
  // The estimate curve (§9) fits values to ROS points over the weeks team numbers count, so on game days a
  // player whose game has kicked off isn't worth less than one who plays later that week (review final check).
  // They are the blended points (step 3b), the ones every lineup reads.
  const rosPoints: Record<string, number> = {};
  for (const id of modelIds) rosPoints[id] = (lp.players[id] as PlayerModel).weekly.slice(tw.from).reduce((s, w) => s + w.p, 0);
  const values = marketValues(valuePlayers, rosPoints, inputs.market ?? null, cfg.market);
  for (const id of modelIds) (lp.players[id] as PlayerModel).value = values[id] ?? null;
  const freeAgentIds = lp.relevant.freeAgents.filter((id) => table.rows.has(id));
  const topValue = inputs.market ? valuesForTerm(inputs.market).topValue : 0;
  const credit = inputs.market ? waiverCredit(values, freeAgentIds, topValue, cfg.market) : 0;
  const market = marketSummary(modelIds, values, inputs.market ?? null, credit);
  const valueOf = (id: string) => values[id]?.value ?? 0;
  mark("market values");

  // 5. Slots, masks, limits.
  const slots = prepareLeagueSlots(snapshot.settings);
  const instances = slotInstances(snapshot.settings.lineup);
  const index = instanceIndex(instances, slots);
  const masks = new Map<string, number>();
  for (const row of table.rows.values()) masks.set(row.id, slotMask(slots, row.pos, row.eligible));
  const maskOf = (row: TableRow) => masks.get(row.id) ?? 0;
  const posOf = (id: string) => table.rows.get(id)?.pos ?? snapshot.players[id]?.pos;
  const limits = snapshot.settings.positionLimits;
  const maxRosterSize = snapshot.settings.maxRosterSize;

  // 5a. Streaming: who streams what, one virtual row per streamed position, and this week's picks.
  const myTeamKnown = snapshot.myTeamId !== null && snapshot.teams.some((t) => t.id === snapshot.myTeamId);
  const byTeam = streamedPositions(snapshot, myTeamKnown ? snapshot.myTeamId : null, settings, cfg);
  const streamed = new Set<Pos>(Object.values(byTeam).flatMap((s) => s.positions));
  const stream = streamingRows(table, freeAgentIds, streamed, cfg);
  const picks = streamingPicks(table, freeAgentIds, snapshot, inputs.nfl, cfg);
  mark("streaming");

  // 5b. IR returners: each IR player's expected return week (null: not back within the weeks), and the specs that bring
  // the ones who are back (with a model) into their team's lineups. None under irReturners false.
  const weekAt = new Map(weeks.weeks.map((w, i) => [w, i]));
  const returnWeeks = new Map<string, number | null>();
  const returnWeek = (id: string): number | null => {
    let r = returnWeeks.get(id);
    if (r === undefined) {
      const c = lp.contexts.get(id);
      r = c ? expectedReturnWeek(c.avail, c.ctx, cfg.projections, cfg.projections.returnWeekQuantile) : null;
      returnWeeks.set(id, r);
    }
    return r;
  };
  const isReturner = (id: string) => table.rows.has(id) && returnWeek(id) !== null;
  const withReturners = (base: StreamSpec, ir: readonly string[]): StreamSpec => (irOn ? returnerSpec(base, ir, (id) => table.rows.get(id), isReturner) : { rows: base.rows, positions: base.positions });
  const future = futureTerm(snapshot, inputs, valuePlayers, rosPoints, cfg);
  const returnerSetup: ReturnerSetup = {
    slots,
    weekCount: W,
    scenarios: S,
    weights,
    maxRosterSize,
    positionLimits: limits,
    rosterMinimums: snapshot.settings.rosterMinimums,
    info: (id) => snapshot.players[id],
    dropValue: valueOf,
    nearTieWeekly: cfg.lineups.dropNearTieWeekly ?? 0,
    valueFloor: credit,
    future,
    returnIndex: (id) => {
      const r = returnWeek(id);
      return r === null ? null : (weekAt.get(r) ?? null);
    },
    index,
  };

  // 5. Teams: EV lineups, V*(T) and its moves, and every V*(V*(T) − i).
  const optimizer = createOptimizer(
    {
      rows: table.rows,
      weekCount: W,
      slots,
      weights,
      freeAgents: freeAgentIds,
      info: (id) => snapshot.players[id],
      positionLimits: limits,
      maxRosterSize,
      dropValue: valueOf,
      // ⚠️ Near-ties in whom a move cuts (optimizer.ts's header; roster legality's rule, evaluate.ts keepValues): only where
      // a keep value is the lineup cost alone (no long-term values: the dynasty guard is off too), the values floored at W.
      dropNearTie: future ? 0 : nearTieRos(cfg.lineups.dropNearTieWeekly, weights),
      dropValueFloor: credit,
      dynasty: dynastyGuard(future, cfg),
      // V*(T) judges its moves in scenario lineups when scenarios run (the file header, step 5); the re-runs don't.
      scenarios: S,
      instanceIndex: index,
    },
    { faMinGain: cfg.freeAgentOptimizer.faMinGain, faMaxMoves: cfg.freeAgentOptimizer.faMaxMoves, optimizerExcluded: cfg.streaming.optimizerExcluded },
  );
  const teams = snapshot.teams.map((team) => {
    const ids = [...new Set(team.roster)];
    // A player listed on the active roster too (a data error) is an active player, never a second row.
    const ir = [...new Set(team.ir)].filter((id) => !ids.includes(id));
    const spec = withReturners({ rows: (byTeam[team.id]?.positions ?? []).flatMap((p) => stream.rows.get(p) ?? []), positions: byTeam[team.id]?.positions ?? [] }, ir);
    return { team, ids, ir, rows: ids.flatMap((id) => table.rows.get(id) ?? []), spec, cur: optimizer.evaluate(ids, spec) };
  });
  // V*(T), team by team in the allocation order (one free agent, one team), each against the free agents no earlier team
  // claimed; or every team against the whole pool (faAllocation "independent": Checkpoint 4's rule).
  const vstars: OptimizedRoster[] = new Array<OptimizedRoster>(teams.length);
  const claimed: string[][] = teams.map(() => []);
  let allocation: LeagueContext["allocation"] = null;
  if (opts.faAllocation === "independent") {
    teams.forEach((t, i) => {
      vstars[i] = optimizer.optimize(t.ids, t.spec);
      claimed[i] = claimedBy(vstars[i] as OptimizedRoster);
    });
  } else {
    allocation = allocationOrder(snapshot.teams, snapshot.settings.faabBudget !== undefined, (i) => {
      const t = teams[i] as (typeof teams)[number];
      return firstMoveGain(optimizer, t.ids, t.spec, weights);
    });
    const taken = new Set<string>();
    for (const i of allocation.order) {
      const t = teams[i] as (typeof teams)[number];
      const run = optimizer.optimize(t.ids, t.spec, undefined, poolRestriction(taken));
      vstars[i] = run;
      claimed[i] = claimedBy(run);
      for (const id of claimed[i] as string[]) taken.add(id);
    }
  }
  const work: TeamWork[] = teams.map(({ team, ids, ir, rows, spec, cur }, i) => {
    const vstar = vstars[i] as OptimizedRoster;
    // excl(T): every other team's claims, the pool of every later run of T (greedy determinism: V*(T) against it is V*(T),
    // but for near-ties: optimizer.ts, "The pool").
    const pool = allocation ? poolRestriction(claimed.flatMap((c, j) => (j === i ? [] : c))) : FULL_POOL;
    const inV = new Set(vstar.roster);
    // V*(T − i): the re-run from V*(T)'s roster without him, one move beyond the free ones (step 5: an exchange at the cap).
    const losses = rows.map((r) => (inV.has(r.id) ? optimizer.reoptimize(vstar, vstar.roster.filter((id) => id !== r.id), spec, 1, [r.id], undefined, pool) : null));
    return {
      team,
      ids,
      rows,
      ir,
      stream: spec,
      returnerCosts: [],
      returnerScores: [],
      evalT: cur.team,
      solved: cur.solved,
      evRos: cur.evRos,
      scen: null,
      scenRos: null,
      vstar,
      vstarScen: null,
      vstarCells: null,
      claimed: claimed[i] as string[],
      pool,
      losses,
      mvLoseEv: losses.map((l) => (l ? Math.max(0, vstar.evRos - l.evRos) : 0)),
      mvLoseScen: rows.map(() => null),
      faMoves: [],
      scores: rows.map(() => 0),
    };
  });
  mark("EV lineups and the free-agent optimizer");

  // 5. Scenario lineups of T (its strength and score), of V*(T) (cell by cell: removal costs and the chip base), of
  // each roster after a move, and of every V*(V*(T) − i): lineup costs and the moves' scenario gains.
  const scenMemo = new Map<string, number>();
  const scenRosOf = (roster: readonly string[], spec: StreamSpec): number => {
    const key = rosterKey(roster, spec);
    let ros = scenMemo.get(key);
    if (ros === undefined) {
      ros = rosValue(scenarioValues(optimizer.evaluate(roster, spec).team, W, S).mean, weights);
      scenMemo.set(key, ros);
    }
    return ros;
  };
  for (const t of work) {
    const steps = t.vstar.moves;
    if (S > 0) {
      const noMove = steps.length === 0;
      // Cells kept: V*(T)'s when it made no move, and the displacement prices the team's final lineups from them (step 5b).
      t.scen = scenarioValues(t.evalT, W, S, index, true, true);
      t.scenRos = rosValue(t.scen.mean, weights);
      scenMemo.set(rosterKey(t.ids, t.stream), t.scenRos);
      if (noMove) {
        t.vstarCells = t.scen.cells;
        t.vstarScen = t.scenRos;
      } else {
        const v = scenarioValues(t.vstar.team, W, S, null, true);
        t.vstarCells = v.cells;
        t.vstarScen = rosValue(v.mean, weights);
        scenMemo.set(rosterKey(t.vstar.roster, t.stream), t.vstarScen);
      }
    }
    let roster: readonly string[] = t.ids;
    let evBefore = t.evRos;
    let scenBefore = t.scenRos;
    t.faMoves = steps.map((m) => {
      roster = applyStep(roster, m);
      const ev = optimizer.evaluate(roster, t.stream).evRos;
      const scen = S > 0 ? scenRosOf(roster, t.stream) : null;
      const move: FaMove = { add: m.add, drop: m.drop, gainEv: ev - evBefore, gainScen: scen !== null && scenBefore !== null ? scen - scenBefore : null };
      evBefore = ev;
      scenBefore = scen;
      return move;
    });
    const removal = S > 0 ? scenarioRemovalCosts(t.vstarCells as ScenarioCells, weights) : null;
    const at = new Map(t.vstar.team.rows.map((r, k) => [r.id, k]));
    if (removal) {
      // A re-run that changed nothing is V*(T) minus him: his scenario removal cost, without solving again (teamValue.ts).
      t.mvLoseScen = t.rows.map((r, x) => {
        const l = t.losses[x];
        if (!l) return 0;
        const lost = l.moves.length === 0 && l.given.length === 0 ? (removal[at.get(r.id) as number] as number) : (t.vstarScen as number) - scenRosOf(l.roster, t.stream);
        return Math.max(0, lost);
      });
    }
    // 5b. The returners' lineup costs: what losing each costs V*(T)'s lineups, nobody refilling him (his IR slot opens, no
    // active spot does, so no free agent comes in), floored at 0.
    const back = returnersOf(t.stream);
    if (back.length) {
      const evCost = evRemovalCosts(t.vstar.solved, weights);
      const cost = (xs: Float64Array, id: string) => {
        const k = at.get(id);
        return k === undefined ? 0 : Math.max(0, xs[k] as number);
      };
      t.returnerCosts = back.map((r) => ({ id: r.id, ev: cost(evCost, r.id), scen: removal ? cost(removal, r.id) : null }));
    }
  }
  if (S > 0) mark("scenario lineups and marginal values");

  return { snapshot, cfg, settings, S, W, lp, tw, weights, table, valueOf, market, freeAgentIds, slots, instances, index, maskOf, posOf, limits, maxRosterSize, byTeam, streamed, stream, picks, optimizer, scenRosOf, work, allocation, irReturners: irOn, returnWeek, withReturners, returnerSetup };
}

/**
 * A team's best single-move gain against the whole pool (allocationOrder's "gain" basis): the first move of its optimizer
 * run (a run of one move, the same move a full run makes first: the moves are greedy), in the optimizer's judging mode
 * (scenario ROS when it judges in scenario lineups, else EV ROS, over the weeks team numbers count); 0 when it makes
 * none. The roster after the move minus the roster before it, priced as the optimizer prices them.
 */
function firstMoveGain(optimizer: RosterOptimizer, ids: readonly string[], spec: StreamSpec, weights: ArrayLike<number>): number {
  const run = optimizer.optimize(ids, spec, 1);
  if (!run.moves.length) return 0;
  if (optimizer.judgesScenarios) {
    const before = optimizer.scenarioValuesOf(run.start, spec);
    const after = optimizer.scenarioValuesOf(run.roster, spec);
    if (before && after) return rosValue(after.mean, weights) - rosValue(before.mean, weights);
  }
  return run.evRos - optimizer.evaluate(run.start, spec).evRos;
}

/**
 * A team's bases for trade chips (step 6): V*(T′)'s ROS in the lineup costs' mode; B′ = V*(T′) minus the player it
 * drops to make room when its active roster is full (null when it's full and nobody can be dropped); and, built when
 * first needed, B′ for a newcomer at a position B′ has at its limit (L7: V*(T′) minus its lowest keep value player at
 * that position; null when nobody there can go).
 */
export interface TeamBase {
  vRos: number;
  base: AddBase | null;
  atLimit: Map<Pos, AddBase | null>;
  /** What losing each of V*(T′)'s players (its team rows) costs its lineup, nobody refilling his spot, in the chips' mode: the keep value. */
  keep: Float64Array | null;
}

export interface AddBase {
  /** B′'s roster: the optimizer re-runs from B′ + i. */
  ids: string[];
  /** B′'s EV lineups, and its scenario lineups cell by cell (null without scenarios). */
  ev: SolvedWeeks;
  cells: ScenarioCells | null;
  /** ROS(V*(T′)) − ROS(B′), EV and scenario: what making room costs (0 without a drop). */
  dropCostEv: number;
  dropCostScen: number;
  /** Positions on B′ (the newcomer must fit positionLimits). */
  positions: Pos[];
  /** The player V*(T′) drops to make room, or null (an open spot). */
  drop: string | null;
  /**
   * A bound on what the re-run adds after any newcomer, in the lineup costs' mode and in EV lineups (step 6): 0 when
   * no free-agent move can follow (no free agent's add bound on B′ reaching faMinGain, no move allowed, or starter
   * limits: the re-run is skipped there).
   */
  extra: number;
  extraEv: number;
}

/**
 * Whether the optimizer's re-run from B′ + i is run for MV_add (step 6): only when i starts for B′ in some week team
 * numbers count (his EV gain on B′'s lineups is above 0). A newcomer who starts nowhere there is priced without it, and
 * his bound has no re-run part, for speed (L14: re-running for every such pair took the League model on Parker's league
 * from about 345 to about 550 ms). ⚠️ An approximation: he can still free a move, as a backup good enough that the
 * team's backup QB can go for a free agent and its QB pickup can be given back (Drake Maye to Team 10 on the offline
 * report's inputs: 1.2 without the re-run, 17.2 with it). Measured on Parker's league: 10 of 1,413 (player, team) pairs
 * change, one chip of 89 is missed; in random 10-team leagues, 0 and 50 of 1,440 pairs, by at most 4.3 points, no chip.
 */
function rerunCounts(b: AddBase, row: TableRow, mask: number, weights: ArrayLike<number>): boolean {
  return addGainExact(b.ev, row, mask, weights).gain > EPS;
}

/** The sum of the k largest of xs (0 for k ≤ 0). */
function topSum(xs: number[], k: number): number {
  if (!(k > 0)) return 0;
  return [...xs]
    .sort((a, b) => b - a)
    .slice(0, k)
    .reduce((s, x) => s + Math.max(0, x), 0);
}

/** TeamBase.keep, computed once: each V*(T′) player's removal cost, nobody refilling his spot, in the chips' lineup mode (§7 keep value). */
function keepCosts(ctx: LeagueContext, t: TeamWork, tb: TeamBase): Float64Array {
  if (!tb.keep) tb.keep = t.vstarCells ? scenarioRemovalCosts(t.vstarCells, ctx.weights) : evRemovalCosts(t.vstar.solved, ctx.weights);
  return tb.keep;
}

/** B′ = V*(T′) minus `drop` (null: V*(T′) itself, an open spot), with what making room costs and the re-run's bound (step 6). */
function makeBase(ctx: LeagueContext, t: TeamWork, drop: string | null): AddBase {
  const { S, W, weights, slots, posOf } = ctx;
  const R = t.vstar;
  const noise = (x: number) => (Math.abs(x) < EPS ? 0 : x);
  const positions = R.roster.flatMap((id) => posOf(id) ?? []);
  let base: AddBase;
  if (drop === null) {
    base = { ids: [...R.roster], ev: R.solved, cells: t.vstarCells, dropCostEv: 0, dropCostScen: 0, positions, drop: null, extra: 0, extraEv: 0 };
  } else {
    const bEval = teamEval(
      R.team.rows.filter((r) => r.id !== drop),
      slots,
    );
    const ev = solveEvWeeks(bEval, W);
    const scen = S > 0 ? scenarioValues(bEval, W, S, null, true) : null;
    const dropPos = posOf(drop);
    base = {
      ids: R.roster.filter((id) => id !== drop),
      ev,
      cells: scen?.cells ?? null,
      // Both sides through the same lineup functions, so a drop who never starts costs 0; differences under 1e-9 are float noise, 0.
      dropCostEv: noise(R.evRos - rosValue(ev.lv, weights)),
      dropCostScen: scen && t.vstarScen !== null ? noise(t.vstarScen - rosValue(scen.mean, weights)) : 0,
      positions: dropPos ? withoutOne(positions, dropPos) : positions,
      drop,
      extra: 0,
      extraEv: 0,
    };
  }
  // The re-run's bound (step 6): its first move gains at most what a free agent adds to B′ (none reaching faMinGain: no
  // move at all); everything it ends with is at most B′ + i plus its free agents and, after an exchange, the player who
  // comes back (more players never lower a lineup), and each adds at most his add bound on B′ (a player added to a
  // bigger roster gains no more). So: the (its moves: optimizer.rerunMoves, one extra for the newcomer) largest free
  // agents' add bounds, plus the largest add bound of a player V*(T′) dropped (the one exchange can bring one back).
  // Under starter limits the re-run is skipped.
  const moves = slots.limits === null ? ctx.optimizer.rerunMoves(R, base.ids, 1) : 0;
  if (moves > 0) {
    const minGain = ctx.cfg.freeAgentOptimizer.faMinGain;
    const always = new Set<Pos>(ctx.cfg.streaming.optimizerExcluded);
    const onBase = new Set(base.ids);
    const excluded = (pos: Pos) => always.has(pos) || t.stream.positions.includes(pos);
    // With one move (a team at its cap: the extra one), it starts from B′ + i, a superset of B′, so its free agent's EV
    // gain, at least faMinGain, is at most his add bound on B′: only those free agents can be in it.
    const single = moves === 1;
    const evB: number[] = [];
    const scB: number[] = [];
    let first = 0;
    // Only free agents the re-run may add: not on B′, not at an excluded position, not claimed by another team (excl(T)).
    for (const id of ctx.freeAgentIds) {
      const row = ctx.table.rows.get(id) as TableRow;
      if (onBase.has(id) || t.pool.excluded.has(id) || excluded(row.pos)) continue;
      const mask = ctx.maskOf(row);
      const ub = addUpperBound(base.ev, row, mask, weights);
      if (ub > first) first = ub;
      evB.push(ub);
      if (base.cells && (!single || ub >= minGain - EPS)) scB.push(scenarioAddUpperBound(base.cells, row, mask, weights));
    }
    if (first >= minGain - EPS) {
      let backEv = 0;
      let backScen = 0;
      for (const id of droppedBy(R)) {
        const row = ctx.table.rows.get(id);
        if (!row || onBase.has(id)) continue;
        const mask = ctx.maskOf(row);
        backEv = Math.max(backEv, addUpperBound(base.ev, row, mask, weights));
        if (base.cells) backScen = Math.max(backScen, scenarioAddUpperBound(base.cells, row, mask, weights));
      }
      base.extraEv = topSum(evB, moves) + backEv + EPS;
      base.extra = base.cells ? topSum(scB, moves) + backScen + EPS : base.extraEv;
    }
  }
  return base;
}

/** The team's own players an optimizer run dropped (a drop that wasn't one of its own pickups): who an exchange can bring back. */
function droppedBy(run: OptimizedRoster): string[] {
  const added = new Set<string>();
  const out: string[] = [];
  for (const m of run.moves) {
    if (m.drop !== null && !added.has(m.drop)) out.push(m.drop);
    added.add(m.add);
  }
  return out;
}

/** TeamBase for every team (step 6; the file header): the general B′ now, the ones for limited positions when first needed (baseFor). */
export function teamBases(ctx: LeagueContext): TeamBase[] {
  return ctx.work.map((t) => {
    const R = t.vstar;
    const tb: TeamBase = { vRos: ctx.S > 0 ? (t.vstarScen as number) : R.evRos, base: null, atLimit: new Map(), keep: null };
    if (R.roster.length < ctx.maxRosterSize) {
      tb.base = makeBase(ctx, t, null);
      return tb;
    }
    // A full roster drops the player whose loss costs V*(T′)'s lineup least, in the chips' lineup mode, with nobody
    // refilling his spot (the newcomer takes it): §7's keep value, marginal ROS contribution. Not his lineup cost,
    // which refills the spot with free agents (the file header, step 6). Candidates: V*(T′)'s players with a model
    // (free agents it added included); never a streaming row or an IR returner (neither takes a roster spot).
    const keep = keepCosts(ctx, t, tb);
    const onRoster = new Set(R.roster);
    const drop = lowestKeepValue(R.team.rows.flatMap((r, k) => (isStreamId(r.id) || !onRoster.has(r.id) ? [] : [{ id: r.id, keep: keep[k] as number, value: ctx.valueOf(r.id) }])));
    tb.base = drop === null ? null : makeBase(ctx, t, drop);
    return tb;
  });
}

/**
 * The base a newcomer at `pos` joins on team `u` (step 6; L7 roster legality): its general B′ when that leaves room
 * at his position, else V*(T′) minus its lowest keep value player at `pos` (his primary position; a player with a
 * model, never a streaming row or an IR returner; ties as lowestKeepValue), built once per position. Null when the roster is full with
 * nobody to drop, when nobody at `pos` can go, or when one going still leaves the position at its limit.
 */
export function baseFor(ctx: LeagueContext, bases: readonly TeamBase[], u: number, pos: Pos): AddBase | null {
  const tb = bases[u] as TeamBase;
  if (!tb.base) return null;
  if (positionAllows(ctx.limits, tb.base.positions, pos)) return tb.base;
  let b = tb.atLimit.get(pos);
  if (b === undefined) {
    const t = ctx.work[u] as TeamWork;
    const keep = keepCosts(ctx, t, tb);
    const onRoster = new Set(t.vstar.roster);
    const drop = lowestKeepValue(t.vstar.team.rows.flatMap((r, k) => (isStreamId(r.id) || !onRoster.has(r.id) || r.pos !== pos ? [] : [{ id: r.id, keep: keep[k] as number, value: ctx.valueOf(r.id) }])));
    const positions = t.vstar.roster.flatMap((id) => ctx.posOf(id) ?? []);
    b = drop !== null && positionAllows(ctx.limits, withoutOne(positions, pos), pos) ? makeBase(ctx, t, drop) : null;
    tb.atLimit.set(pos, b);
  }
  return b;
}

/**
 * MV_add(T′, i) exactly (step 6) on base `b` of team `u`, in scenario lineups (`scenario`) or EV: the pinned part,
 * gain(B′, i) − what making room costs, and when a free-agent move can follow (AddBase.extraEv > 0), the optimizer
 * re-run from B′ + i (optimizer.reoptimize with one extra move) priced against V*(T′). Not floored.
 */
export function addValueOf(ctx: LeagueContext): (u: number, b: AddBase, row: TableRow, mask: number, scenario: boolean) => number {
  return (u, b, row, mask, scenario) => {
    const pinned = () => (scenario ? scenarioAddGain(b.cells as ScenarioCells, row, mask, ctx.weights) - b.dropCostScen : addGainExact(b.ev, row, mask, ctx.weights).gain - b.dropCostEv);
    if (!(b.extraEv > 0) || !rerunCounts(b, row, mask, ctx.weights)) return pinned();
    const t = ctx.work[u] as TeamWork;
    const run = ctx.optimizer.reoptimize(t.vstar, [...b.ids, row.id], t.stream, 1, [], b.ids, t.pool);
    if (!run.moves.length && !run.given.length) return pinned();
    return scenario ? ctx.scenRosOf(run.roster, t.stream) - (t.vstarScen as number) : run.evRos - t.vstar.evRos;
  };
}

/** One other team a candidate could go to: its bound on MV_add (+Infinity when nothing is bounded) and the exact value. */
interface AddOption {
  teamId: string;
  ub: number;
  exact: () => number;
}

/**
 * The largest MV_add over `options` and its team (ties: the smaller team id), exactly, solving as few as
 * it can (the file header, step 6): options in bound order, and the search stops once no bound can reach
 * the best value found, or once neither that value nor any remaining bound can make a chip (then the
 * player isn't a chip, whatever the rest are worth). Null when no option is solved.
 */
function bestAddition(options: readonly AddOption[], cost: number, minGap: number): { value: number; teamId: string } | null {
  const sorted = [...options].sort((a, b) => (a.ub === b.ub ? 0 : b.ub - a.ub) || byId(a.teamId, b.teamId));
  let best: { value: number; teamId: string } | null = null;
  for (const o of sorted) {
    const couldChip = o.ub - cost >= minGap - EPS;
    if (best) {
      if (o.ub < best.value - EPS) break;
      if (!couldChip && best.value - cost < minGap - EPS) break;
    } else if (!couldChip) {
      break;
    }
    const value = Math.max(0, o.exact());
    if (!best || value > best.value + EPS || (Math.abs(value - best.value) <= EPS && o.teamId < best.teamId)) best = { value, teamId: o.teamId };
  }
  return best;
}

/** Step 6: every team's trade chips (the file header). */
function tradeChipsAll(ctx: LeagueContext, bases: readonly TeamBase[]): TradeChip[][] {
  const { S, weights, work, cfg } = ctx;
  const excluded = new Set<Pos>(cfg.market.tradeSearchExcluded);
  const limited = ctx.slots.limits !== null;
  const minGap = cfg.needs.chipMinGap;
  const screenTeams = Number.isFinite(cfg.needs.chipScreenTeams) ? Math.max(1, Math.floor(cfg.needs.chipScreenTeams)) : 1;
  const addValue = addValueOf(ctx);
  // Σ ω over the weeks team numbers count: a chip's cost per week (lead decision L5).
  let omega = 0;
  for (let w = 0; w < ctx.W; w++) omega += weights[w] ?? 0;
  return work.map((t, ti) => {
    // The starter tag reads V*(T)'s EV lineups, the roster his cost is measured from: each player's index there.
    const inV = new Map(t.vstar.team.rows.map((r, k) => [r.id, k]));
    const cands: ChipCandidate[] = [];
    t.rows.forEach((row, x) => {
      if (excluded.has(row.pos)) return;
      const mask = ctx.maskOf(row);
      const cost = costOf(t, x);
      // Display only (L5): what he costs per week, and whether he starts for his team after its pickups (never when V*(T) dropped him).
      const k = inV.get(row.id);
      const display = { costPerWeek: omega > EPS ? cost / omega : 0, starter: k !== undefined && evStarter(t.vstar.solved, k, weights) };
      const options: (AddOption & { ui: number; base: AddBase })[] = [];
      work.forEach((u, ui) => {
        if (ui === ti || u.team.roster.includes(row.id)) return;
        const base = baseFor(ctx, bases, ui, row.pos);
        if (!base) return;
        const evUb = addUpperBound(base.ev, row, mask, weights);
        const pinnedUb = S > 0 ? scenarioAddUpperBound(base.cells as ScenarioCells, row, mask, weights) - base.dropCostScen : evUb - base.dropCostEv;
        // Nothing beyond the pinned part when the re-run is skipped: no EV gain on B′ (rerunCounts; a bound of 0 says so).
        options.push({ ui, base, teamId: u.team.id, ub: pinnedUb + (evUb > EPS ? base.extra : 0), exact: () => addValue(ui, base, row, mask, S > 0) });
      });
      let best: { value: number; teamId: string } | null;
      if (S > 0 && limited) {
        // Starter limits bound nothing: the best chipScreenTeams teams by exact EV value get scenario lineups.
        const screened = options
          .map((o) => ({ o, ev: Math.max(0, addValue(o.ui, o.base, row, mask, false)) }))
          .sort((a, b) => (Math.abs(b.ev - a.ev) > EPS ? b.ev - a.ev : byId(a.o.teamId, b.o.teamId)))
          .slice(0, screenTeams);
        best = bestAddition(
          screened.map(({ o }) => ({ teamId: o.teamId, ub: Number.POSITIVE_INFINITY, exact: o.exact })),
          cost,
          minGap,
        );
      } else {
        best = bestAddition(options, cost, minGap);
      }
      cands.push({ playerId: row.id, cost, best, ...display });
    });
    return tradeChips(cands, cfg.needs);
  });
}

/**
 * D2 (step 7 in the file header): whether chip `playerId` of team `ti` is still a chip once the chips in `taken`
 * have left that team: maxOther − cost(T − taken) ≥ chipMinGap, with maxOther his chip's and the cost his lineup
 * cost on T − taken by step 5's rules: ROS(V*(T − taken)) − ROS(V*(T − taken − i)), each the re-run from V*(T)'s
 * roster (optimizer.reoptimize) with one extra move per player gone (an exchange at the cap, as step 5 lets a team
 * replace a lost player; a player taken never comes back), in the lineup costs' mode, floored at 0; 0 when V*(T)
 * dropped him. Rosters are memoized by the optimizer.
 */
function chipsStayChips(ctx: LeagueContext, chipsAll: readonly (readonly TradeChip[])[], minGap: number): (ti: number, playerId: string, taken: readonly string[]) => boolean {
  return (ti, playerId, taken) => {
    const chip = (chipsAll[ti] ?? []).find((c) => c.playerId === playerId);
    const t = ctx.work[ti];
    if (!chip || !t) return false;
    const R = t.vstar.roster;
    let cost = 0;
    if (R.includes(playerId)) {
      const gone = new Set(taken);
      const start = R.filter((id) => !gone.has(id));
      const out = R.length - start.length;
      const before = ctx.optimizer.reoptimize(t.vstar, start, t.stream, out, taken, undefined, t.pool);
      const after = ctx.optimizer.reoptimize(
        t.vstar,
        start.filter((id) => id !== playerId),
        t.stream,
        out + 1,
        [...taken, playerId],
        undefined,
        t.pool,
      );
      cost = Math.max(0, rerunRos(ctx, t, before) - rerunRos(ctx, t, after));
    }
    return chip.maxOther - cost >= minGap - EPS;
  };
}

/** The week in progress before its first kickoff (step 8; preKickoffTable): its projection table and streaming rows. */
interface PreKickoff {
  table: ProjectionTable;
  stream: Map<Pos, TableRow>;
}

/**
 * The week in progress before its first kickoff (step 8), or null when no week is in progress (or its kickoffs are
 * unknown, or no week is left): the projection table rebuilt for 1 ms before it (preKickoffTable, with the build's blend
 * factors), with the free agents at the streamed positions only (the model's own teams), or every free agent (`allFree`:
 * a script pricing a roster with pickups; a player's row doesn't depend on who else is in the table), and the streaming
 * rows from it.
 */
function preKickoffOf(ctx: LeagueContext, inputs: ModelInputs, opts: BuildLeagueModelOptions, allFree: boolean): PreKickoff | null {
  if (ctx.W === 0) return null;
  const { snapshot, cfg, tw, lp, streamed } = ctx;
  let table: ProjectionTable | null;
  if (allFree) {
    const first = tw.inProgressWeek === null ? null : firstKickoff(inputs.nfl, tw.inProgressWeek);
    table = first === null ? null : buildProjectionTable(snapshot, inputs, { ...opts, now: new Date(first - 1) }, cfg, lp.blend).table;
  } else {
    table = preKickoffTable(snapshot, inputs, tw.inProgressWeek, opts, cfg, streamed, lp.blend)?.table ?? null;
  }
  if (!table) return null;
  const pre = table;
  const stream = streamingRows(
    pre,
    ctx.freeAgentIds.filter((id) => pre.rows.has(id)),
    streamed,
    cfg,
  ).rows;
  return { table: pre, stream };
}

/**
 * TeamModel.score's rule (step 8) for a final evaluation (step 5b) of an active roster of team `t`: the scenario mean and
 * sqrt(within-lineup variance + the scenarios' spread²) with scenarios, else the EV lineup's LV and sqrt(Σ σ²); and a week
 * in progress (`pre`) as if none of its games had started: the roster's rows from the pre-kickoff table, the team's
 * streaming rows from it and its returners, every player displaced from the current week on masked there too, an
 * active player or a returner alike (a returner released at his own return, or one an earlier returner's week displaces:
 * returners.finalLineups lets either go, and the week under way weighs 0 in keep values, so a returner back now is the
 * likelier one to go; review of Phase 4b: unmasked, he still played the pre-kickoff week). That is the week as the model
 * priced it 1 ms before kickoff, when a returner whose expected return week is the current week (a healthy, Probable or
 * Questionable player in an IR slot: he can be activated now) plays it and the player he displaces doesn't, so the odds
 * don't jump at the first kickoff (the file header, "Game days": only the clock is turned back). ⚠️ Review of track E
 * asked to leave such a returner out of the week under way (he sat in the IR slot at kickoff); kept as is, since the week
 * is priced from projections and the best lineup, never from the lineup actually set.
 */
function finalScore(ctx: LeagueContext, t: TeamWork, roster: readonly string[], final: FinalLineups, pre: PreKickoff | null): WeeklyScore {
  const score = final.scen ? scenarioScore(final.scen) : evScore(final.ev);
  if (!pre || ctx.W === 0) return score;
  const outNow = new Set(final.displaced.filter((d) => d.from === 0).map((d) => d.id));
  /** A player's pre-kickoff row, masked for the whole week when he's displaced from the current week on. */
  const preRow = (id: string): TableRow[] => {
    const row = pre.table.rows.get(id);
    return row ? [outNow.has(id) ? maskedRow(row, 0) : row] : [];
  };
  const rows = [
    ...[...new Set(roster)].flatMap(preRow),
    ...(ctx.byTeam[t.team.id]?.positions ?? []).flatMap((p) => pre.stream.get(p) ?? []),
    ...returnersOf(t.stream).flatMap((r) => preRow(r.id)),
  ];
  const first = teamEval(rows, ctx.slots);
  const s = ctx.S > 0 ? scenarioScore(scenarioValues(first, 1, ctx.S, null, false, true)) : evScore(solveEvWeeks(first, 1));
  score.mean[0] = s.mean[0] as number;
  score.sd[0] = s.sd[0] as number;
  return score;
}

/**
 * A team's roster after a free-agent optimizer run, priced finally (steps 5b and 8a; the trade evaluation's exact mode):
 * its scenario lineups when scenarios ran (the optimizer's own when it judged the run in them, memoized; else solved
 * here, cells kept, since the displacement prices from them), else its EV lineups; then, from a returner's week, the
 * roster spot he needs (returners.finalLineups). V*(T) with the team's own spec for TeamModel.scoreWithPickups and the
 * trade search's baseline; V*(after) with a side's spec after a trade for every exact trade (evaluate.ts sideEval).
 */
export function finalRunLineups(ctx: LeagueContext, run: OptimizedRoster, spec: StreamSpec): FinalLineups {
  const raw = ctx.S > 0 ? (ctx.optimizer.scenarioValuesOf(run.roster, spec) ?? scenarioValues(run.team, ctx.W, ctx.S, ctx.index, true, true)) : null;
  return finalLineups(ctx.returnerSetup, run.roster, spec, { ev: run.solved, scen: raw });
}

/**
 * The weekly score the simulator draws for a team after free-agent pickups (step 8a): TeamModel.score's rule on `final`
 * (finalRunLineups: the scenario mean and sqrt(within-lineup variance + the scenarios' spread²) with scenarios, else the
 * EV lineup's LV and sqrt(Σ σ²)), with a week in progress held at `standing`'s first week, the team's TeamModel.score as it
 * stands (that week as it was before kickoff): ⚠️ the model plays a week under way with today's rosters. TeamModel.
 * scoreWithPickups (V*(T)), the trade search's baseline (the same numbers) and every trade's sides after it (evaluate.ts
 * sideEval). A fresh score: the caller may keep it.
 */
export function pickupScore(ctx: Pick<LeagueContext, "tw" | "W">, final: FinalLineups, standing: { readonly mean: ArrayLike<number>; readonly sd: ArrayLike<number> } | null | undefined): WeeklyScore {
  const score = final.scen ? scenarioScore(final.scen) : evScore(final.ev);
  if (ctx.tw.inProgressWeek !== null && ctx.W > 0 && standing && standing.mean.length > 0 && standing.sd.length > 0) {
    score.mean[0] = standing.mean[0] as number;
    score.sd[0] = standing.sd[0] as number;
  }
  return score;
}

/**
 * Weekly scores for any active roster of a team (its streaming rows and IR returners, as the build gives them), priced as
 * TeamModel.score prices the team as it stands (steps 5b and 8: the roster spot a returner needs from his week, a week in
 * progress from before its first kickoff), from the same steps 1–5 a League model with these options builds: the team's
 * own roster gives its TeamModel.score exactly. For scripts that price rosters the model doesn't keep (the league
 * report's free-agent baseline). Null for an unknown team. ⚠️ Not the score with pickups: given V*(T)'s roster it plays
 * the week in progress with the pickups (every free agent's pre-kickoff row), while TeamModel.scoreWithPickups, the
 * headline odds' score (step 8a), holds that week at the team's score as it stands; the other weeks agree.
 */
export function teamRosterScorer(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: BuildLeagueModelOptions, cfg: LeagueModelConfig = config): (roster: readonly string[], teamId: string) => { mean: number[]; sd: number[] } | null {
  const ctx = prepareLeague(snapshot, inputs, opts, cfg, () => undefined);
  const pre = preKickoffOf(ctx, inputs, opts, true);
  return (roster, teamId) => {
    const t = ctx.work.find((w) => w.team.id === teamId);
    if (!t) return null;
    const cur = ctx.optimizer.evaluate(roster, t.stream);
    const scen = ctx.S > 0 ? scenarioValues(cur.team, ctx.W, ctx.S, ctx.index, true, true) : null;
    const score = finalScore(ctx, t, roster, finalLineups(ctx.returnerSetup, roster, t.stream, { ev: cur.solved, scen }), pre);
    return { mean: Array.from(score.mean), sd: Array.from(score.sd) };
  };
}

/**
 * The League model (see the file header). `snapshot.myTeamId` is the user's team (null = none picked);
 * `opts.now` decides which current-week games have started, and so whether the current week is in progress.
 */
export function buildLeagueModel(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: BuildLeagueModelOptions, cfg: LeagueModelConfig = config): LeagueModel {
  return buildLeagueModelWithContext(snapshot, inputs, opts, cfg).model;
}

/**
 * buildLeagueModel's result with what it was built from, for Phase 4's trade evaluation (evaluate.ts): steps 1–5, step 6's
 * bases and step 8a's priced V*(T) lineups.
 */
export interface LeagueModelBuild {
  model: LeagueModel;
  /** Steps 1–5: projections, scenarios, values, streaming, every team's lineups, V* and lineup costs. */
  context: LeagueContext;
  /** Step 6's bases for MV_add (teamBases; baseFor builds the position-limited ones when first needed). */
  bases: TeamBase[];
  /**
   * Step 8a: every team's V*(T) priced finally (finalRunLineups with its own spec), context.work order: the lineups behind
   * TeamModel.scoreWithPickups, which the trade evaluation reuses as its baseline (evaluate.ts), so the two are one.
   */
  pickups: FinalLineups[];
}

/**
 * buildLeagueModel, also returning the context and bases it was built from (LeagueModelBuild), so the trade evaluation
 * reuses every number the League model computed instead of building it twice. The model is the same object
 * buildLeagueModel returns.
 */
export function buildLeagueModelWithContext(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: BuildLeagueModelOptions, cfg: LeagueModelConfig = config): LeagueModelBuild {
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
  const ctx = prepareLeague(snapshot, inputs, opts, cfg, mark);
  const { S, W, lp, tw, work, index, instances, byTeam, stream } = ctx;
  const { weeks } = lp;

  // 5b. Each team as it stands, priced finally: its returners back, and from a returner's week on the roster spot he needs
  // (returners.finalLineups; nothing changes without one, or with room for every one). Its lineups make LV, ROS, PPW,
  // strength, needs and the weekly score below.
  const finals: FinalLineups[] = work.map((t) => finalLineups(ctx.returnerSetup, t.ids, t.stream, { ev: t.solved, scen: t.scen }));
  if (work.some((t) => returnersOf(t.stream).length)) mark("IR returners");

  // The weekly score the season simulator draws (step 8): T as it stands, its streaming rows and returners included, and
  // a week in progress with every game still to play (finalScore).
  const pre = preKickoffOf(ctx, inputs, opts, false);
  const scores: WeeklyScore[] = work.map((t, ti) => finalScore(ctx, t, t.ids, finals[ti] as FinalLineups, pre));
  if (pre) mark("week in progress before kickoff");

  // 8a. The same for every team after its free-agent pickups (one baseline everywhere: the file header, step 8): V*(T),
  // step 5's allocation (one free agent, one team), priced finally (its returners back, the roster spot each needs from his
  // week; finalRunLineups) with the week in progress held at the team's score as it stands (pickupScore). These are the
  // trade search's baseline lineups (evaluate.ts reuses them: LeagueModelBuild.pickups), and LeagueModel.odds simulates
  // their scores (TeamModel.scoreWithPickups).
  const pickups: FinalLineups[] = work.map((t) => finalRunLineups(ctx, t.vstar, t.stream));
  const pickupScores: WeeklyScore[] = work.map((_, ti) => pickupScore(ctx, pickups[ti] as FinalLineups, scores[ti]));
  mark("teams after their pickups");

  // 6. Trade chips: each team's base B′ (from V*), then every candidate's best other team (the file header).
  const bases = teamBases(ctx);
  const chipsAll = tradeChipsAll(ctx, bases);
  mark("trade chips");

  // 7. Strength, needs, partners and surplus scores: over the weeks team numbers count (tw). Strength from each team's
  // final lineups (step 5b).
  const perWeek = finals.map((f) => (f.scen?.instances ? f.scen.instances : evInstancePoints(f.ev, index)));
  const strengths = strengthTable(
    instances,
    perWeek.map((p) => windowAverage(p, tw.from, tw.from + tw.nNext, index.size)),
    perWeek.map((p) => windowAverage(p, tw.from, W, index.size)),
  );
  // Surplus scores over the active players and the returners (step 5b: the give pool ranks both), each returner at his
  // lineup cost in the costs' mode.
  for (const t of work) {
    const scores = surplusScores(
      [...t.rows.map((r) => ctx.valueOf(r.id)), ...t.returnerCosts.map((c) => ctx.valueOf(c.id))],
      [...t.rows.map((_, x) => costOf(t, x)), ...t.returnerCosts.map((c) => c.scen ?? c.ev)],
    );
    t.scores = scores.slice(0, t.rows.length);
    t.returnerScores = scores.slice(t.rows.length);
  }

  const myIndex = snapshot.myTeamId === null ? -1 : work.findIndex((t) => t.team.id === snapshot.myTeamId);
  const myTeamId = myIndex >= 0 ? (work[myIndex] as TeamWork).team.id : null;
  let partners: LeagueModel["partners"] = [];
  if (myIndex >= 0) {
    /** What one player adds to team `to`'s lineup per week, after its free-agent optimizer (V*), over every week team numbers count. */
    const gainOf = (to: number, playerId: string): number => {
      const row = ctx.table.rows.get(playerId);
      if (!row || (work[to] as TeamWork).team.roster.includes(playerId)) return 0;
      const mask = ctx.maskOf(row);
      const base = (work[to] as TeamWork).vstar.solved;
      if (addUpperBound(base, row, mask, tw.allWeights) <= EPS) return 0;
      return addGainExact(base, row, mask, tw.allWeights).gain;
    };
    /** What the players add to team `to`'s lineup together, per week (one lineup per week: players competing for one slot count once). */
    const jointGain = (to: number, ids: readonly string[]): number => {
      const rows = ids.flatMap((id) => {
        const row = ctx.table.rows.get(id);
        return row && !(work[to] as TeamWork).team.roster.includes(id) ? [row] : [];
      });
      return addRowsGain(
        (work[to] as TeamWork).vstar.solved,
        rows,
        rows.map((row) => ctx.maskOf(row)),
        tw.allWeights,
      );
    };
    // D2: a side counts only chips that stay chips together (step 7 in the file header).
    const stillChip = chipsStayChips(ctx, chipsAll, cfg.needs.chipMinGap);
    const maxPerSide = Number.isFinite(cfg.search.maxPerSide) ? Math.max(1, Math.floor(cfg.search.maxPerSide)) : 1;
    /** One side's chips with what each alone adds to team `to`, and the ones that count for the fit. */
    const side = (from: number, to: number): { players: PartnerPlayer[]; counted: string[] } => {
      const chips = chipsAll[from] ?? [];
      const players = chips.map((c) => ({ playerId: c.playerId, ppw: gainOf(to, c.playerId) }));
      const counted = chipsTogether(
        chips.map((c, i) => ({ playerId: c.playerId, ppw: (players[i] as PartnerPlayer).ppw, gap: c.gap })),
        maxPerSide,
        (playerId, taken) => stillChip(from, playerId, taken),
      );
      return { players, counted };
    };
    const cands: PartnerCandidate[] = work.flatMap((p, pi) => {
      if (pi === myIndex) return [];
      const theirs = side(pi, myIndex);
      const mine = side(myIndex, pi);
      return [{ teamId: p.team.id, theyCanGive: theirs.players, youCanGive: mine.players, get: jointGain(myIndex, theirs.counted), give: jointGain(pi, mine.counted) }];
    });
    partners = rankPartners(cands, cfg.needs);
  }

  const teams: TeamModel[] = work.map((t, ti) => {
    const strength = strengths[ti] ?? {};
    const players: Record<string, TeamPlayerValue> = {};
    t.rows.forEach((row, x) => {
      players[row.id] = {
        mvLoseEv: t.mvLoseEv[x] as number,
        mvLoseScen: t.mvLoseScen[x] ?? null,
        autoAdd: t.losses[x]?.moves[0]?.add ?? null,
        surplusScore: t.scores[x] as number,
      };
    });
    // The IR returners (step 5b): their lineup cost from V*(T)'s lineups; nobody refills them.
    t.returnerCosts.forEach((c, x) => {
      players[c.id] = { mvLoseEv: c.ev, mvLoseScen: c.scen, autoAdd: null, surplusScore: t.returnerScores[x] as number };
    });
    const score = scores[ti] as WeeklyScore;
    const withPickups = pickupScores[ti] as WeeklyScore;
    const final = finals[ti] as FinalLineups;
    return {
      id: t.team.id,
      ev: lineupValues(final.ev.lv, tw, weeks),
      scen: final.scen ? { ...lineupValues(final.scen.mean, tw, weeks), sd: Array.from(final.scen.sd) } : null,
      strength,
      needs: findNeeds(strength, instances, cfg.lineups.needZThreshold),
      chips: chipsAll[ti] ?? [],
      players,
      faMoves: t.faMoves,
      score: { mean: Array.from(score.mean), sd: Array.from(score.sd) },
      scoreWithPickups: { mean: Array.from(withPickups.mean), sd: Array.from(withPickups.sd) },
    };
  });

  const projection: ProjectionSummary = {
    espnAveraged: lp.espnAveraged,
    agreement: lp.agreement?.agreement ?? null,
    disagreements: lp.agreement?.disagreements ?? [],
    sources: baseRateSourceCounts(Object.values(lp.players)),
  };
  mark("needs and partners");

  const replacement: LeagueModel["streaming"]["replacement"] = {};
  for (const [pos, rep] of stream.replacement) replacement[pos] = Array.from(rep);
  const model: LeagueModel = {
    weeks: weeks.weeks,
    regularWeeks: weeks.regularWeeks,
    playoffWeeks: weeks.playoffWeeks,
    scenarios: S,
    playoffWeight: ctx.settings.playoffWeight,
    streaming: { byTeam, replacement, picks: ctx.picks },
    // One free agent, one team (step 5): the basis and the order (team ids, first claim first); absent under "independent".
    ...(ctx.allocation ? { faAllocation: { basis: ctx.allocation.basis, order: ctx.allocation.order.map((i) => (work[i] as TeamWork).team.id) } } : {}),
    inProgressWeek: tw.inProgressWeek,
    players: lp.players,
    teams,
    myTeamId,
    slots: instances,
    partners,
    market: ctx.market,
    projection,
    odds: null,
    oddsAsRostersStand: null,
    timings,
    warnings: modelWarnings(snapshot, inputs, lp, projection.sources, cfg),
  };

  // 8. The season simulation (§8): every team after its pickups (LeagueModel.odds, the headline and the trade search's
  // baseline), and every team as it stands (oddsAsRostersStand), on the same seasons.
  const sims = opts.sims ?? cfg.simulation.finalSims;
  if (Number.isFinite(sims) && sims >= 1) {
    const both = simulate(snapshot, model, Math.floor(sims), opts.simSeed ?? cfg.simulation.seed, cfg);
    model.odds = both.withPickups;
    model.oddsAsRostersStand = both.asRostersStand;
    mark("season simulation");
  }

  // 9. The star premium (the file header): every rostered player's, for his own team, from the values and the odds (with
  // pickups: the trade search's own baseline, so its premiums are the League page's).
  const odds = model.odds;
  const premiums = leaguePremiums(
    {
      snapshot,
      market: inputs.market,
      value: ctx.valueOf,
      ros: (id) => lp.players[id]?.ros.total ?? 0,
      pPlayoffs: (teamId) => odds?.teams.find((o) => o.teamId === teamId)?.pPlayoffs ?? null,
    },
    cfg.acceptance.starPremium,
  );
  for (const t of model.teams) t.premiums = premiums.get(t.id) ?? {};
  if (clock) timings.total = last - start;
  return { model, context: ctx, bases, pickups };
}

/**
 * The warning when the season simulator refuses the league's setup (simulate, below): plain and generic.
 * The simulator's own message is for developers (it names week numbers and team indexes), never the page.
 */
export const ODDS_REFUSED_WARNING = "The playoff odds couldn't be worked out from this league's schedule, so they're left out.";

/**
 * LeagueModel.odds and oddsAsRostersStand (step 8): every team's TeamModel.scoreWithPickups (season.ts
 * pickupSeasonModel), and every team's TeamModel.score, simulated on the same `sims` seasons of `seed`'s matrix (drawn
 * once: the two setups differ only in their scores). Those seasons are the trade search's final block (evaluate.ts), so
 * LeagueModel.odds is its baseline exactly. A season that can't be simulated although weeks remain (season.ts
 * oddsSkippedWarning: the rest of the schedule didn't load) has no odds, with that warning. The simulator refuses a
 * setup it can't decide (a RangeError; season.ts builds setups it accepts): the rest of the model is still good, so the
 * odds are left out with ODDS_REFUSED_WARNING instead of losing the whole League page. The RangeError's message stays out
 * of every user-facing text. Either way both are null (oddsAsRostersStand is null whenever odds is).
 */
function simulate(snapshot: LeagueSnapshot, model: LeagueModel, sims: number, seed: number, cfg: LeagueModelConfig): { withPickups: SeasonOdds | null; asRostersStand: SeasonOdds | null } {
  const none = { withPickups: null, asRostersStand: null };
  const skipped = oddsSkippedWarning(snapshot, model);
  if (skipped !== null) {
    model.warnings.push(skipped);
    return none;
  }
  try {
    const built = buildSimSetup(snapshot, model);
    if (!built) return none;
    const normals = simNormals(seed, sims, built.setup.weeks.length, built.setup.teams.length);
    const withPickups = seasonOdds(snapshot, pickupSeasonModel(model), { sims, seed, normals }, cfg);
    return { withPickups, asRostersStand: withPickups ? seasonOdds(snapshot, model, { sims, seed, normals }, cfg) : null };
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    model.warnings.push(ODDS_REFUSED_WARNING);
    return none;
  }
}

// ---------------------------------------------------------------------------------------------
// Marginal values outside the model (scripts, tests, Phase 4's trade search)

/** V*(T) of a team: the roster after the free-agent optimizer, its moves, and its ROS in EV and scenario lineups (null without scenarios). */
export interface VStarSummary {
  roster: string[];
  moves: FaMove[];
  ev: number;
  scen: number | null;
}

/** A marginal value in ROS lineup points (§7), EV and scenario lineups (null without scenarios), unfloored. */
export interface MarginalValue {
  ev: number;
  scen: number | null;
}

export interface LeagueMarginals {
  /** The model's settings, weeks and scenario count the numbers come from. */
  readonly scenarios: number;
  /** V*(T) (step 5); null for an unknown team. */
  vStar(teamId: string): VStarSummary | null;
  /**
   * The free-agent optimizer from any active roster of a team (its streaming rows and streamed positions; the build's
   * optimizer and memo), with at most `maxMoves` moves (default faMaxMoves), against the pool minus every other team's
   * claims (excl(T), step 5): the roster after, its moves with their EV and scenario gains, and its ROS in EV and
   * scenario lineups. Null for an unknown team.
   */
  optimize(teamId: string, roster: readonly string[], maxMoves?: number): VStarSummary | null;
  /**
   * MV_lose(T, i) as TeamModel.players has it (step 5: floored at 0, 0 when V*(T) dropped him; an IR returner's removal cost
   * from V*(T)'s lineups, step 5b); null when he isn't one of T's active players with a model or returners.
   */
  mvLose(teamId: string, playerId: string): (MarginalValue & { autoAdd: string | null }) | null;
  /**
   * MV_add(T′, j) as trade chips measure it (step 6: V*(T′) + j − the drop, the optimizer re-run from there with one
   * extra move, net of what its exchanges give back, against V*(T′); unfloored), with the player V*(T′) drops to make
   * room (at j's position when a position limit binds). Null when j has no model, is on T′'s roster, T′ is full with
   * nobody to drop, or j's position is at its limit with nobody there who can go.
   */
  mvAdd(teamId: string, playerId: string): (MarginalValue & { drop: string | null }) | null;
  /**
   * Why mvAdd is null: an unknown team or a player without a model, a player already on that team, a full V*(T′) with
   * nobody to drop, or a position at its limit on V*(T′) with nobody there who can be dropped (with the limit); null
   * when mvAdd has a value.
   */
  mvAddBlocked(teamId: string, playerId: string): { reason: "unknown" | "onTeam" | "full" } | { reason: "positionLimit"; pos: Pos; limit: number } | null;
}

/**
 * The marginal values behind the League model's lineup costs and trade chips, for any team and player (the report's
 * Bo Nix → Team 1 example; Phase 4's trade search): built from the same steps 1–5 and step 6's bases, so every
 * number equals the model's own (a chip's maxOther is the largest mvAdd over the other teams, floored at 0).
 */
export function leagueMarginals(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: BuildLeagueModelOptions, cfg: LeagueModelConfig = config): LeagueMarginals {
  const ctx = prepareLeague(snapshot, inputs, opts, cfg, () => undefined);
  const bases = teamBases(ctx);
  const addValue = addValueOf(ctx);
  const indexOf = new Map(ctx.work.map((t, i) => [t.team.id, i]));
  const scen = ctx.S > 0;
  const blocked: LeagueMarginals["mvAddBlocked"] = (teamId, playerId) => {
    const ui = indexOf.get(teamId) ?? -1;
    const t = ctx.work[ui];
    const row = ctx.table.rows.get(playerId);
    if (!t || !row) return { reason: "unknown" };
    if (t.team.roster.includes(playerId)) return { reason: "onTeam" };
    if (!(bases[ui] as TeamBase).base) return { reason: "full" };
    if (!baseFor(ctx, bases, ui, row.pos)) return { reason: "positionLimit", pos: row.pos, limit: ctx.limits?.[row.pos] as number };
    return null;
  };
  return {
    scenarios: ctx.S,
    vStar(teamId) {
      const t = ctx.work[indexOf.get(teamId) ?? -1];
      return t ? { roster: [...t.vstar.roster], moves: t.faMoves.map((m) => ({ ...m })), ev: t.vstar.evRos, scen: t.vstarScen } : null;
    },
    mvLose(teamId, playerId) {
      const t = ctx.work[indexOf.get(teamId) ?? -1];
      if (!t) return null;
      const x = t.rows.findIndex((r) => r.id === playerId);
      if (x >= 0) return { ev: t.mvLoseEv[x] as number, scen: t.mvLoseScen[x] ?? null, autoAdd: t.losses[x]?.moves[0]?.add ?? null };
      // An IR returner (step 5b): his removal cost from V*(T)'s lineups.
      const c = t.returnerCosts.find((r) => r.id === playerId);
      return c ? { ev: c.ev, scen: c.scen, autoAdd: null } : null;
    },
    mvAdd(teamId, playerId) {
      if (blocked(teamId, playerId)) return null;
      const ui = indexOf.get(teamId) as number;
      const row = ctx.table.rows.get(playerId) as TableRow;
      const mask = ctx.maskOf(row);
      const base = baseFor(ctx, bases, ui, row.pos) as AddBase;
      return { ev: addValue(ui, base, row, mask, false), scen: scen ? addValue(ui, base, row, mask, true) : null, drop: base.drop };
    },
    mvAddBlocked: blocked,
    optimize(teamId, roster, maxMoves) {
      const t = ctx.work[indexOf.get(teamId) ?? -1];
      if (!t) return null;
      const run = ctx.optimizer.optimize(roster, t.stream, maxMoves, t.pool);
      let at: readonly string[] = run.start;
      let ev = ctx.optimizer.evaluate(at, t.stream).evRos;
      let sc = scen ? ctx.scenRosOf(at, t.stream) : null;
      const moves = run.moves.map((m) => {
        at = applyStep(at, m);
        const nextEv = ctx.optimizer.evaluate(at, t.stream).evRos;
        const nextSc = scen ? ctx.scenRosOf(at, t.stream) : null;
        const move: FaMove = { add: m.add, drop: m.drop, gainEv: nextEv - ev, gainScen: nextSc !== null && sc !== null ? nextSc - sc : null };
        ev = nextEv;
        sc = nextSc;
        return move;
      });
      return { roster: [...run.roster], moves, ev: run.evRos, scen: sc };
    },
  };
}
