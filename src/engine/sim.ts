/**
 * Season simulator (CLAUDE.md §8; §16 simulation sanity tests; planner reply to Checkpoint 2, "Phase 3
 * reminders"). Pure and deterministic: no I/O, no clock; the only randomness is the common-random-numbers
 * matrix below, drawn from rng.ts. It knows nothing about LeagueSnapshot: the caller builds a SimSetup
 * (records, the remaining schedule as team indexes, and each team's weekly score mean and SD) and reads
 * back playoff, bye and title odds, expected records, seed distributions and each remaining week's
 * win chance, and (Checkpoint 7c) the odds of 2nd and 3rd place, the expected weekly high scores and the
 * odds of the most points for. Every tunable number arrives through SimSetup and SimOptions (config.simulation holds the
 * defaults: finalSims, shownSims, screeningSims, seed; simulateSeason reads exactReseedTeams from it itself when
 * SimOptions doesn't give one).
 *
 * Scores
 * - Team t's score in week index w of sim n is mean[t][w] + sd[t][w] × z[n][w][t]: §8's
 *   Normal(LV(T, w), σ_T,w). The caller folds the spread of LV across availability scenarios into σ.
 *   Scores aren't floored at 0: a floor would bias the mean, and a negative team total is as rare as it
 *   is harmless.
 * - A game's score is the sum over its weeks (ESPN multi-week matchups, multi-week playoff rounds).
 *   Each week of a remaining game or of a playoff round is either drawn (in setup.weeks) or over:
 *   before weeks[0], the first drawn week (every week is over when nothing is drawn). A week that's
 *   over adds nothing, so a multi-week game or round already under way is decided by its remaining
 *   weeks alone (⚠️ the points its first week already scored aren't in the setup).
 * - The setup is loud about what it can't decide. A RangeError is thrown for any of these:
 *   - a remaining game (not a bye) with no drawn week
 *   - a week after weeks[0] that isn't drawn, in a game or in a round the bracket uses
 *   - a round the bracket uses with no weeks at all
 *   - a median week that isn't drawn
 *   Skipping any of them would silently change the records or the bracket. For example, on a game day
 *   the week under way might be left out of the draws while its games have no result yet, and those
 *   games would drop off both teams' records. A decided game belongs in `played`. Rounds the bracket
 *   doesn't use are ignored, unchecked.
 *
 * Common random numbers (§8)
 * - simNormals(seed, sims, W, T): z[n][w][t] sits at n·W·T + w·T + t. Sim n draws from its own stream,
 *   streamFor(seed, "season", n) (SEASON_STREAM), filling week-major then team by Box–Muller: each pair
 *   of uniforms (u1, u2), in that order, gives two normals, √(−2 ln(1 − u1))·cos(2πu2) and then
 *   √(−2 ln(1 − u1))·sin(2πu2) (an odd count drops the last sine). The matrix therefore depends only on
 *   the seed, the sim index, the week index and the team index (for a given shape), never on the means,
 *   the schedule or the other sims, and the first k sims of an n-sim matrix are the k-sim matrix. So the
 *   League model's 20,000 seasons (config.simulation.shownSims since Checkpoint 7e, 5,000 before; LeagueModel.odds
 *   and oddsAsRostersStand, one matrix for both) are the first 20,000 of the trade search's matrix of 20,000 + 1,000
 *   (evaluate.ts): its shown block, whose baseline is therefore LeagueModel.odds exactly; its ranking block is the
 *   first 5,000 of them (finalSims: the same draws), its screening block the next 1,000 (Phase 4c: before, the
 *   screening block came first).
 * - The "before" run and every "after" run of a trade share one matrix (SimOptions.normals). A trade
 *   changes means and SDs, never the weeks or the teams, so the shape always fits; identical inputs give
 *   identical outputs bit for bit (a trade that changes nothing moves no odds), and a trade's deltas
 *   aren't just noise: comparing two runs on different draws would add their luck to the delta, and the
 *   shared draws take it out. Each delta is still an estimate from `sims` seasons.
 *
 * Regular season
 * - Records start from the platform's W-L-T, points for (PF) and points against (PA). Each remaining game
 *   adds a W and an L (exactly equal scores: a T for both, never a flipped coin), PF (the team's own
 *   score) and PA (the opponent's). A bye game (b null) adds nothing.
 * - Median weeks (medianGame; ESPN WIN_BONUS_TOP_HALF, Sleeper league_average_match): every team also
 *   plays the league. The top ⌊N/2⌋ scores that week get a W, the rest an L (⚠️ with an odd number of
 *   teams the middle team gets an L; exactly equal scores rank by team index). Median games add no PF,
 *   and they aren't head-to-head or division games.
 * - Points-only leagues: no W/L at all (games and median weeks give none). PF adds each team's score in
 *   every drawn week that isn't a playoff-round week, so the caller lists the remaining regular-season
 *   weeks in `weeks` even when there are no games. Games still add PA and weekly win chances (the chance
 *   to outscore that week's scheduled opponent).
 * - Regular season over (no games and no median weeks left): the standings come from the records and
 *   the played games alone, the same in every sim, and only the playoffs are simulated (§8).
 *
 * Standings (seeding; §8 and planner reply to Checkpoint 2)
 * - Win percentage = (W + T/2) / (W + L + T), 0 without games.
 * - The order follows the league's seeding tiebreaker the way espn-api computes ESPN standings
 *   (cwendt94/espn-api, MIT, espn_api/football/league.py League.standings_weekly and helper.py
 *   sort_team_data_list): sort by the first criterion, then sort every group still tied by the next
 *   criterion, recursively. A criterion is computed on the group being sorted (head-to-head among the
 *   tied teams only), and a group tied after a criterion moves on to the next one, never back to the
 *   first.
 *   - pointsFor (ESPN TOTAL_POINTS_SCORED): win %, PF, head-to-head, division record, PA.
 *   - headToHead (H2H_RECORD): win %, head-to-head, PF, division record, PA.
 *   - divisionRecord (INTRA_DIVISION_RECORD): win %, division record, head-to-head, PF, PA. ⚠️ Our
 *     order: espn-api puts division record before win %, which would rank a 3–11 team with a good
 *     division record above an 11–3 team.
 *   - Then team index, a deterministic stand-in for espn-api's coin flip (a flip would need numbers
 *     outside the CRN matrix; a tie that survives every criterion needs identical points, which only
 *     SD-0 inputs or a finished regular season can give).
 *   - PA: more points against ranks higher (espn-api sorts it descending).
 *   - Head-to-head within the tied group: two teams → their wins against each other (a tie counts ½),
 *     over played and simulated games; three or more → only when every pair in the group met equally
 *     often, each team's total wins against the others in the group; otherwise the criterion is skipped
 *     for that group.
 *   - Division record: each tied team's win % in its games against teams of its own division, played
 *     and simulated (a tie counts ½), whichever divisions the tied teams are in. A team without
 *     division games (or without a division) has 0. This follows espn-api's code (helper.py
 *     build_division_record_dict: division wins / max(division games, 1)). ⚠️ The standings_weekly
 *     docstring adds "if all tied teams are in the same division", but the code applies no such check,
 *     and ESPN doesn't document its own rule. We follow the code, so tied teams from different
 *     divisions are compared by their own division records.
 *   - Points-only leagues: PF, then team index.
 *   - Keys are compared exactly, like espn-api: records move in halves and PF is continuous, so PF ties
 *     need SD-0 inputs.
 * - Division winners first (divisionWinnersFirst with 2+ divisions: ESPN's rule, and Sleeper's):
 *   each division's winner is its top team by the order above; seeds 1..D are the winners in that
 *   order, then everyone else in that order. A team without a division is never a winner.
 * - SimTeamOdds.seedDist covers the whole final order (seeds past playoffTeams too).
 * - standingsOrder gives today's order (TeamOdds.rank): the same code on the records and played games
 *   alone, with nothing left to play.
 *
 * Playoffs
 * - N = playoffTeams (at most the number of teams): seeds 1..N make it. The bracket has B = the next
 *   power of two ≥ N slots, and the top B − N seeds get a round-1 bye. That is the only single-
 *   elimination bracket for N teams, so it is always used: SimSetup.byes should equal B − N (both
 *   adapters derive it that way), and a different value is ignored.
 * - R = log2 B rounds, played in rounds[0..R−1] (extra rounds are ignored); a playoff game's score is the
 *   sum over its round's weeks, and an exact tie goes to the better seed. Fixed bracket: slots in the
 *   standard order (bracketOrder: order(1) = [1], order(2m) = each s of order(m) followed by 2m + 1 − s),
 *   so with 6 teams the round-1 games are 4–5 and 3–6, seed 1 meets the 4/5 winner and seed 2 the 3/6
 *   winner (ESPN's 6-team bracket). Re-seeding: round 1 is the same, and before each later round the
 *   survivors are re-sorted by seed, best against worst.
 * - A game in playoffResults (the same pair, either order) is replayed, not drawn. A game whose round has
 *   no drawn week (it's over) and no result can't be replayed: our seeding doesn't match the platform's
 *   bracket, so playoffsKnown is false and title and bye odds are NaN.
 * - Fewer rounds than R: playoff and bye odds only, title odds NaN (the caller warns).
 * - N ≤ 1: no bracket. The champion is the top of the final standings (a league without playoffs crowns
 *   its regular-season winner), and nobody has a bye.
 *
 * Title odds: exact brackets (SimOptions.titleMode, default "exact"; Rao–Blackwellization)
 * - A sim's playoff bracket is computed exactly instead of drawn: given its final standings (from its own
 *   regular season), every team's chance to win the bracket is a sum over the bracket's outcomes, and
 *   P(title) is the average of those chances over the sims. The expectation is the drawn bracket's, but
 *   the luck of the playoff games no longer adds to the noise; only the regular season's (which decides
 *   the seeds) is left. A trade's ΔCH (§10's largest term) is the one this matters for. "sampled" draws the
 *   games as described under "Playoffs" (the tests compare the two). Nothing else reads the playoff games:
 *   P(playoffs), P(bye), seeds, records and weekly chances come from the regular season and are the same,
 *   bit for bit, in both modes.
 * - A game a vs b in round r: a replayed result is certain; otherwise a wins with probability
 *   Φ((Σ μ_a − Σ μ_b) / √(Σ σ_a² + Σ σ_b²)), the sums over the round's drawn weeks: the drawn game compares
 *   two independent normal sums, and an exact tie has probability 0. With zero variance it's decided the
 *   way the drawn game is: the higher sum of means wins, an exact tie goes to the better seed. The round's
 *   sums don't depend on the sim, so every pair's chance is computed once per run (rounds × teams²). Φ is
 *   distributions.ts normalCdf (Abramowitz & Stegun 7.1.26, absolute error < 1.5e-7, far below the Monte
 *   Carlo error; b's chance is 1 − a's, so each game's two chances add up to 1).
 * - Games are independent given the seeds: every draw z[n][w][t] is independent of the others, a team plays
 *   one game per round, and different rounds have different weeks. That needs the bracket rounds' drawn
 *   weeks to be pairwise disjoint and unread by the regular season (games, median weeks, points-only points
 *   for, high-score periods); otherwise the title is drawn as in "sampled" (⚠️ a fallback no season.ts setup
 *   triggers).
 * - Fixed bracket: dynamic programming over the slots. Before round r, P(slot i alive); it wins round r
 *   with P(alive) × Σ over the slots j of the other half of its block of P(j alive) × P(i beats j); a
 *   round-1 bye advances its team surely.
 * - Re-seeding: the pairing depends on who survived, so the outcomes are enumerated. From 4 teams left,
 *   best against worst pairs like fixed slots [1, 4, 2, 3] (and the final is the last two), so only a round
 *   with 8 teams left needs it: its 16 outcomes, each followed by a fixed 4-team bracket of the survivors in
 *   seed order. The bracket is exact from the first round with at most exactReseedTeams teams left
 *   (SimOptions, default config.simulation.exactReseedTeams = 8; read as 2, 4 or 8), and its earlier rounds
 *   are drawn as "sampled" does (⚠️ ours: enumerating a round of 16 would cost thousands of paths per sim;
 *   the estimate stays unbiased, with those rounds' luck left in). With 8, brackets of up to 8 slots (up to
 *   8 playoff teams) are exact throughout and bigger ones draw their rounds before the last three.
 * - Unknown playoffs: a game with neither a result nor a drawn week that is reached with positive
 *   probability makes the playoffs unknown (drawn: reached in some sim). Rounds already played come before
 *   the rounds still to play, so their games follow from the seeds and the results, and both modes agree.
 *   ⚠️ A round over after a round still to play (no real schedule) could differ.
 * - The exact mode skips drawing the scores of the playoff weeks it doesn't sample.
 *
 * Places, weekly high scores and the points leader (Checkpoint 7c; planner reply to Checkpoint 7b, §6, league prizes:
 * "2nd place: the losing finalist", "3rd place: simulate the 3rd-place game when the league has one", "each remaining
 * regular-season week's high score, with ties split", "the regular season's points leader"). benefit.ts weighs them by
 * the league's prize shares; the simulator knows nothing of prizes. They draw and consume no random number, so every
 * other output is the same, bit for bit, whatever the 3rd-place rule, and with or without high-score periods as long as
 * none shares a week with a playoff round (season.ts builds them on regular-season weeks only): in the exact title mode
 * such a period would make the bracket drawn (the "Title odds" rule above), which moves the title, 2nd and 3rd within
 * Monte Carlo error.
 * - 2nd: the final's loser: P(reach the final) − P(title), exact with the title (the same bracket computation; drawn in
 *   "sampled"), and unknown whenever the title is.
 * - 3rd (SimSetup.thirdPlace): "game", the default (the planner: assume a game when the league doesn't say): the two
 *   semifinal losers play in the final round's weeks, like any playoff game (Φ over those weeks; replayed when
 *   playoffResults has the pair). "bySeed", for a league whose data says there's no such game: the better regular-
 *   season seed of the two (⚠️ ours). "split": half each (tests only). Exact given the seeds: a fixed bracket's two
 *   semifinals are in different halves of it, and each half's games involve its own teams and their own draws only, so
 *   the halves' losers are independent: P(x 3rd) = P(x loses its semifinal) × Σ over the other half's teams y of
 *   P(y loses its semifinal) × P(x beats y), P(loses its semifinal) = alive at the semifinal's start − alive at the
 *   final's. A re-seeding bracket's semifinals pair its last four best against worst (fourExact), the same given them.
 *   A semifinal round drawn before the exact rounds (a re-seeding bracket with exactReseedTeams 2) keeps its losers,
 *   whose game is then exact (drawn in "sampled"). Without two semifinals (⚠️ ours): 3 playoff teams (the top seed's
 *   semifinal is a bye) → the other semifinal's loser is 3rd; 2 → seed 3 of the final standings; none (N ≤ 1) → 1st,
 *   2nd and 3rd are the top three of the final standings.
 * - Unknown 3rd: whenever the title is, or when the 3rd-place game is reached with positive probability and can't be
 *   known (its round over, no result): SimResult.thirdKnown false, pThird NaN; the title and 2nd stay known. The
 *   adapters import no consolation game (Checkpoint 7c, ⚠️ the lead's call), so once the final round is over 3rd is
 *   unknown: after the season, when nothing reads it.
 * - Weekly high scores (SimSetup.highScorePeriods): each period's score is the sum over its drawn weeks (like a game's);
 *   its top score takes 1, split evenly on an exact tie (SD-0 inputs only). Every team counts, a team on a bye too:
 *   its score is drawn all the same. Σ over the teams = the number of periods. The periods' weeks count as read by the
 *   regular season: the exact title mode draws them, and a playoff round sharing one is drawn too (the rule above).
 * - The points leader: the most points for at the end of the regular season (the standings' own: the platform's
 *   points for plus the simulated games', or every regular week's score in a points-only league), split evenly on an
 *   exact tie. ⚠️ Outside points-only leagues a bye week adds no points for, and a multi-week game under way misses its
 *   weeks already played (the same holds for the standings). In a points-only league the leader is seed 1.
 * - High scores and the leader are regular-season numbers: the same, bit for bit, in both title modes.
 *
 * Outputs are averages over the sims. weekly[k].pWin[t] = team t's wins in its game starting that week
 * (a multi-week game counts in its first drawn week) / sims, NaN without a game; pMedianWin likewise for
 * median weeks, null for other weeks. A trade's "Win chance by week" (TradeDetail.winChance, Phase 4c) is my
 * pWin from the baseline run and from the trade's run on the same block of draws (evaluate.ts winChanceOf), never
 * in a points-only league, whose games don't change the standings (evaluate.ts runSim lists none there).
 *
 * Performance: simulateSeason validates the setup and flattens it into typed arrays once (SimState);
 * each sim is simulateOne, which allocates nothing (the standings sort is an insertion sort over the
 * tied group with keys in a preallocated buffer; median weeks re-sort the previous week's order). In
 * Node on a Parker-sized league (10 teams, 11 regular-season weeks, 3 playoff rounds), once the JIT has
 * warmed up: the 5,000-sim matrix about 17 ms, 5,000 sims about 12 ms, 1,000 sims about 2.5 ms, in
 * either title mode (the exact bracket costs about as much as the playoff draws it replaces: within 5%
 * for a fixed 6-team bracket, about 5% more re-seeded, about 20% more for a re-seeding bracket of 8 or
 * more); the first two calls in a fresh process take about 20 ms longer while simulateOne is compiled.
 * Checkpoint 7c, on Parker's own setup (the 2026-10-04 data's headline odds, 10 teams × 14 drawn weeks): 5,000 sims
 * 12.1–12.4 ms before 2nd, 3rd and the points leader, 12.9–13.4 ms with them (+4–10%: the extra loops in the exact
 * bracket and one pass over points for), 15.2–15.9 ms with 11 high-score periods too (about 2.5% a period); 1,000 sims
 * 2.6–2.7, 2.7–2.8 and 3.2–3.6 ms. None of it allocates per sim. sim.test.ts prints the timings.
 */
import { config } from "./config";
import { normalCdf } from "./distributions";
import { hash32, mix32, mulberry32 } from "./rng";

export type SimTiebreaker = "pointsFor" | "headToHead" | "divisionRecord";

export interface SimTeam {
  id: string;
  /** The current record and points, from the platform. */
  w: number;
  l: number;
  t: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Any number naming the division (teams with the same number share one); null = no division. */
  division: number | null;
}

/** A remaining regular-season game: its NFL weeks (score = sum over them) and the two team indexes (b null = a bye). */
export interface SimGame {
  weeks: number[];
  a: number;
  b: number | null;
}

/** A decided regular-season game (for head-to-head and division records). winner null = tie. */
export interface SimPlayedGame {
  a: number;
  b: number;
  winner: number | null;
}

/** A decided playoff game (winners' bracket), for replaying rounds already played. */
export interface SimPlayoffResult {
  a: number;
  b: number;
  winner: number;
}

export interface SimSetup {
  teams: SimTeam[];
  /**
   * NFL weeks that get score draws, ascending: every week of `games`, of the median weeks and of the
   * playoff rounds still to play (in a points-only league, every remaining regular-season week). A
   * week before weeks[0] is over: a game or round may span it, a median week may not. Anything else
   * missing throws a RangeError (see the file header).
   */
  weeks: number[];
  /** Per team, per week index of `weeks`: score mean and SD (σ ≥ 0). */
  mean: Float64Array[];
  sd: Float64Array[];
  /** Remaining regular-season games: each needs at least one drawn week (a decided game belongs in `played`). */
  games: SimGame[];
  /** Remaining regular-season NFL weeks where every team also plays the league median (medianGame); each must be in `weeks`. */
  medianWeeks: number[];
  played: SimPlayedGame[];
  pointsOnly: boolean;
  /** 0 = no playoffs. */
  playoffTeams: number;
  /** Top seeds that skip round 1: always B − N for N playoff teams (see the file header). */
  byes: number;
  /** Playoff rounds in order, each with its NFL weeks (a multi-week round sums its weeks). */
  rounds: { weeks: number[] }[];
  reseed: boolean;
  divisionWinnersFirst: boolean;
  tiebreaker: SimTiebreaker;
  /**
   * Playoff games already decided (replayed). A bracket game whose round has no drawn week (its weeks are
   * all before weeks[0]) and no result here makes the playoffs unknown. Results for other pairs
   * (consolation games) are ignored, except the 3rd-place game's: the two semifinal losers never meet in the bracket,
   * so a result for that pair can only be theirs (the file header's "Places").
   */
  playoffResults: SimPlayoffResult[];
  /**
   * Checkpoint 7c (planner reply to Checkpoint 7b, §6: "each remaining regular-season week's high score, with ties
   * split"): the remaining regular-season prize periods of the weekly high score, each its NFL weeks (one week, or a
   * matchup period of several: its score is the sum over its drawn weeks, like a game's). Checked like games: every
   * week drawn or over, at least one drawn (a RangeError otherwise). Absent or empty: none, and expHighScores is 0.
   * season.ts lists them only when asked (the weekly prize pays): each costs about 2.5% of a run (the file header).
   */
  highScorePeriods?: number[][];
  /** How 3rd place goes between the two semifinal losers (the file header's "Places"); default "game". */
  thirdPlace?: SimThirdPlace;
}

/**
 * 3rd place between the two semifinal losers (the file header's "Places"): "game", a game in the final round's weeks
 * (the planner: assume there's one when the league doesn't say); "bySeed", the better regular-season seed takes it
 * (a league without that game, ⚠️ ours); "split", half each (tests only: no league setting maps to it).
 */
export type SimThirdPlace = "game" | "bySeed" | "split";

/** How P(title) is estimated (the file header's "Title odds"): each sim's bracket computed exactly, or drawn. */
export type SimTitleMode = "exact" | "sampled";

export interface SimOptions {
  sims: number;
  seed: number;
  /** The shared CRN matrix; when absent, simNormals(seed, sims, weeks, teams) is drawn. */
  normals?: SimNormals;
  /** How P(title) is estimated (the file header's "Title odds"); default "exact". */
  titleMode?: SimTitleMode;
  /** A re-seeding bracket is exact from the first round with at most this many teams left (2, 4 or 8); default config.simulation.exactReseedTeams. */
  exactReseedTeams?: number;
}

/** The common-random-numbers matrix: standard normals, z[n][w][t] at n·weeks·teams + w·teams + t. */
export interface SimNormals {
  sims: number;
  weeks: number;
  teams: number;
  z: Float64Array;
}

export interface SimTeamOdds {
  pPlayoffs: number;
  pBye: number;
  pTitle: number;
  /** The final regular-season record, median games included (current record + the rest of the season). */
  expWins: number;
  expLosses: number;
  expTies: number;
  /** P(final seed = k + 1), over the whole final order: length teams.length. */
  seedDist: number[];
  // Checkpoint 7c (planner reply to Checkpoint 7b, §6; the file header's "Places, weekly high scores and the points leader").
  /** P(2nd place): the final's loser. NaN whenever pTitle is. */
  pSecond: number;
  /** P(3rd place). NaN when it can't be known (SimResult.thirdKnown false). */
  pThird: number;
  /** The expected number of weekly high scores over SimSetup.highScorePeriods, ties split: 0 without periods. */
  expHighScores: number;
  /** P(the most points for at the end of the regular season), ties split. */
  pPointsLeader: number;
}

export interface SimResult {
  sims: number;
  /** Same order as SimSetup.teams. */
  teams: SimTeamOdds[];
  /** Per remaining regular-season week (ascending): per team P(win that week's game), NaN without a game; and P(win the median game) when medianGame. */
  weekly: { week: number; pWin: Float64Array; pMedianWin: Float64Array | null }[];
  /** False when a playoff round already played has no result (title/bye odds then unknown). */
  playoffsKnown: boolean;
  /**
   * Checkpoint 7c: false when 3rd place can't be known: whenever the title can't, or when the 3rd-place game is reached
   * and can't be known (its round over without a result). It never makes the title or 2nd place unknown.
   */
  thirdKnown: boolean;
}

/** The rng key of the season matrix: sim n draws from streamFor(seed, SEASON_STREAM, n). */
export const SEASON_STREAM = "season";

const TWO_PI = 2 * Math.PI;

// Standings criteria (see the file header).
const WIN_PCT = 0;
const POINTS_FOR = 1;
const HEAD_TO_HEAD = 2;
const DIVISION = 3;
const POINTS_AGAINST = 4;

const HIERARCHY: Readonly<Record<SimTiebreaker, readonly number[]>> = {
  pointsFor: [WIN_PCT, POINTS_FOR, HEAD_TO_HEAD, DIVISION, POINTS_AGAINST],
  headToHead: [WIN_PCT, HEAD_TO_HEAD, POINTS_FOR, DIVISION, POINTS_AGAINST],
  divisionRecord: [WIN_PCT, DIVISION, HEAD_TO_HEAD, POINTS_FOR, POINTS_AGAINST],
};
const POINTS_ONLY_HIERARCHY: readonly number[] = [POINTS_FOR];

function wholeCount(fn: string, name: string, x: number, min: number): number {
  if (!Number.isInteger(x) || x < min) throw new RangeError(`${fn}: ${name} must be a whole number ≥ ${min} (got ${x})`);
  return x;
}

/**
 * The common-random-numbers matrix (§8): `sims` × `weeks` × `teams` standard normals, sim n from
 * streamFor(seed, SEASON_STREAM, n) by Box–Muller (see the file header for the fill order). `first` (default 0) starts the
 * matrix at that season: simNormals(seed, b, w, t, a) is seasons a … a + b − 1 of the seed's matrix, so a block of a longer
 * matrix can be drawn alone (evaluate.ts: the screening block after a final block drawn elsewhere).
 */
export function simNormals(seed: number, sims: number, weeks: number, teams: number, first = 0): SimNormals {
  wholeCount("simNormals", "sims", sims, 0);
  wholeCount("simNormals", "weeks", weeks, 0);
  wholeCount("simNormals", "teams", teams, 0);
  wholeCount("simNormals", "first", first, 0);
  const per = weeks * teams;
  const z = new Float64Array(sims * per);
  const keySeed = mix32(seed, hash32(SEASON_STREAM));
  for (let n = 0; n < sims; n++) {
    const rand = mulberry32(mix32(keySeed, first + n)); // = streamFor(seed, SEASON_STREAM, first + n)
    let k = n * per;
    const end = k + per;
    while (k < end) {
      const radius = Math.sqrt(-2 * Math.log(1 - rand())); // 1 − u1 ∈ (0, 1]: the log is finite
      const angle = TWO_PI * rand();
      z[k++] = radius * Math.cos(angle);
      if (k < end) z[k++] = radius * Math.sin(angle);
    }
  }
  return { sims, weeks, teams, z };
}

/**
 * Seeds in bracket-slot order for a bracket of `slots` (a power of two): order(1) = [1], order(2m) =
 * each s of order(m) followed by 2m + 1 − s. Slots 2i and 2i + 1 meet in round 1 and the winners keep
 * their order, so bracketOrder(8) = [1, 8, 4, 5, 2, 7, 3, 6]: 1 meets the 4/5 winner, 2 the 3/6 winner.
 */
export function bracketOrder(slots: number): number[] {
  let order = [1];
  while (order.length < slots) {
    const m2 = order.length * 2;
    order = order.flatMap((s) => [s, m2 + 1 - s]);
  }
  return order;
}

/**
 * The winners'-bracket games that the seeds and the results already played pin down, round by round, paired
 * the way simulateSeason plays them (the file header's "Playoffs"): round 1 from `order` (team indexes,
 * seed 1 first) in bracketOrder slots, the top seeds' byes left out; each later round from the winners of
 * the round before (setup.playoffResults), in fixed slots or, when setup.reseed, re-sorted by seed, best
 * against worst. It stops after the first round with a game no result decides: that round's games are
 * listed, the rounds after it aren't known yet. Empty without a bracket (fewer than 2 playoff teams).
 * season.ts compares these with the league's own playoff schedule.
 */
export function bracketGames(setup: Pick<SimSetup, "teams" | "playoffTeams" | "reseed" | "playoffResults">, order: readonly number[]): [number, number][][] {
  const T = setup.teams.length;
  const N = Math.min(T, Math.max(0, Number.isFinite(setup.playoffTeams) ? Math.floor(setup.playoffTeams) : 0));
  if (N < 2) return [];
  let B = 1;
  while (B < N) B *= 2;
  const seedOf = new Map(order.map((t, k) => [t, k]));
  const seedRank = (t: number): number => seedOf.get(t) ?? T;
  const winner = new Map<string, number>();
  for (const r of setup.playoffResults) winner.set(`${Math.min(r.a, r.b)}:${Math.max(r.a, r.b)}`, r.winner);
  let slots = bracketOrder(B).map((s) => (s <= N ? (order[s - 1] ?? -1) : -1));
  const rounds: [number, number][][] = [];
  for (let r = 0; slots.length > 1; r++) {
    // Re-seeding sorts the survivors by seed before every round after the first (byes are settled by then).
    if (setup.reseed && r > 0) slots = [...slots].sort((x, y) => seedRank(x) - seedRank(y));
    const live = slots.length;
    const games: [number, number][] = [];
    const next: number[] = [];
    let decided = true;
    for (let i = 0; i < live / 2; i++) {
      const x = (setup.reseed && r > 0 ? slots[i] : slots[2 * i]) as number;
      const y = (setup.reseed && r > 0 ? slots[live - 1 - i] : slots[2 * i + 1]) as number;
      if (x < 0 || y < 0) {
        next.push(x < 0 ? y : x);
        continue;
      }
      games.push([x, y]);
      const w = winner.get(`${Math.min(x, y)}:${Math.max(x, y)}`);
      if (w === undefined) decided = false;
      else next.push(w);
    }
    rounds.push(games);
    if (!decided) break;
    slots = next;
  }
  return rounds;
}

/** x as a team index of a T-team league; throws for anything else. */
function teamIndex(x: number, T: number, what: string): number {
  if (!Number.isInteger(x) || x < 0 || x >= T) throw new RangeError(`simulateSeason: ${what} names team index ${x} (${T} teams)`);
  return x;
}

/** Whether teams a and b share a division (dense indexes, -1 = none). */
function sameDivision(divOf: Int32Array, a: number, b: number): boolean {
  return (divOf[a] as number) >= 0 && divOf[a] === divOf[b];
}

/** Draw indexes of the given NFL weeks that have draws, ascending and without repeats. */
function drawnIndexes(weeks: readonly number[], weekIndex: ReadonlyMap<number, number>): number[] {
  const out = new Set<number>();
  for (const w of weeks) {
    const i = weekIndex.get(w);
    if (i !== undefined) out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * The first of `weeks` that's neither drawn nor over (before `firstDrawn`, the first drawn week), else
 * undefined. A week that isn't a number counts as missing.
 */
function missingWeek(weeks: readonly number[], weekIndex: ReadonlyMap<number, number>, firstDrawn: number): number | undefined {
  for (const w of weeks) if (!weekIndex.has(w) && !(w < firstDrawn)) return w;
  return undefined;
}

/**
 * Everything the sims read and write, built once per simulateSeason call: the setup flattened into
 * typed arrays, the working arrays every sim resets, and the accumulators. The per-sim work is the
 * module-level simulateOne(st, n): the JIT optimizes it like any hot function and reuses that code
 * for every later call, where one long loop inside simulateSeason would be recompiled on the fly
 * (on-stack replacement) at the start of each call.
 */
interface SimState {
  // Shape.
  readonly T: number;
  /** weeks × teams: one sim's slice of the normals. */
  readonly WT: number;
  readonly pointsOnly: boolean;
  // Scores: the normals and the flattened means and SDs, week-major ([w·T + t]).
  readonly z: Float64Array;
  readonly meanF: Float64Array;
  readonly sdF: Float64Array;
  /**
   * The score cells each sim draws, as [start, end) ranges of [w·T + t]: every week, or in the exact title mode only
   * the weeks something samples (the regular season's, and the drawn rounds of a large re-seeding bracket).
   */
  readonly scoreCells: Int32Array;
  // Starting records.
  readonly baseW: Float64Array;
  readonly baseL: Float64Array;
  readonly baseT: Float64Array;
  readonly basePF: Float64Array;
  readonly basePA: Float64Array;
  /** [a·T + b]: a's wins against b in the played games (a tie ½). */
  readonly h2hWinsBase: Float64Array;
  /** Wins in played division games (a tie ½). */
  readonly divWinsBase: Float64Array;
  // Remaining games: g is gameA[g] vs gameB[g] over the draw indexes gameWeek[gameStart[g]..gameStart[g + 1]).
  readonly gameA: Int32Array;
  readonly gameB: Int32Array;
  /** 1 = a division game. */
  readonly gameSame: Uint8Array;
  readonly gameStart: Int32Array;
  readonly gameWeek: Int32Array;
  /** The game's entry in SimResult.weekly (its first drawn week). */
  readonly gameSlot: Int32Array;
  // Median weeks: draw index, entry in SimResult.weekly, and how many teams win (⌊T/2⌋).
  readonly medianWeek: Int32Array;
  readonly medianSlot: Int32Array;
  readonly medianWinners: number;
  /** Points-only leagues: the draw indexes whose scores are PF. */
  readonly pfWeek: Int32Array;
  // Standings.
  readonly hierarchy: readonly number[];
  /** divisionWinnersFirst with 2+ divisions. */
  readonly divisionWinnersFirst: boolean;
  readonly D: number;
  /** Dense division index per team, -1 = none. */
  readonly divOf: Int32Array;
  /** [a·T + b]: games between a and b, played and remaining. */
  readonly h2hMeetings: Float64Array;
  readonly divGames: Float64Array;
  // Playoffs: N teams in a B-slot bracket of R rounds, the top `byes` seeds skip round 1.
  readonly N: number;
  readonly B: number;
  readonly R: number;
  readonly byes: number;
  /** N ≥ 2 and the setup lists at least R rounds. */
  readonly bracketPlayed: boolean;
  readonly reseed: boolean;
  /** bracketOrder(B). */
  readonly seedSlots: Int32Array;
  /** [a·T + b]: the replayed playoff winner, -1 = none. */
  readonly resultWinner: Int32Array;
  /** Per playoff round: the draw indexes of its weeks. */
  readonly roundWeek: readonly Int32Array[];
  // Exact title odds (the file header's "Title odds").
  /** The bracket is computed exactly (the title mode is "exact" and its rounds' weeks are independent). */
  readonly exact: boolean;
  /** The first round computed exactly; earlier rounds are drawn (a re-seeding bracket with more than exactReseedTeams teams). */
  readonly exactFrom: number;
  /** [(r·T + a)·T + b]: P(a beats b in round r); NaN = can't be known, TIE_BY_SEED = the better seed wins. */
  readonly winP: Float64Array;
  /** Bracket slots' chances to be alive: this round's and the next's. */
  readonly pAlive: Float64Array;
  readonly pNext: Float64Array;
  /** A re-seeding bracket's round of 8: its 4 pairs (x vs y, -1 = an empty slot), the games' chances, the byes' teams and an outcome's survivors. */
  readonly pairX: Int32Array;
  readonly pairY: Int32Array;
  readonly pairW: Float64Array;
  readonly byeTeam: Int32Array;
  readonly quad: Int32Array;
  // Working arrays, reset or rewritten every sim.
  /** This sim's scores: [w·T + t]. */
  readonly score: Float64Array;
  readonly wins: Float64Array;
  readonly losses: Float64Array;
  readonly ties: Float64Array;
  readonly pf: Float64Array;
  readonly pa: Float64Array;
  /** [a·T + b]: a's wins against b (a tie ½), played and simulated. */
  readonly h2hWins: Float64Array;
  readonly divWins: Float64Array;
  readonly winPct: Float64Array;
  /** One row of keys per depth of the hierarchy: [depth·T + team]. */
  readonly keys: Float64Array;
  /** The final standings: team indexes, seed 1 first. */
  readonly order: Int32Array;
  readonly scratch: Int32Array;
  readonly isWinner: Uint8Array;
  /** 0-based seed per team. */
  readonly seedOf: Int32Array;
  /** Bracket slots: team indexes, -1 = an empty slot (a bye). */
  readonly slots: Int32Array;
  /** The teams ranked by the last median week's score: any permutation to start. */
  readonly medianOrder: Int32Array;
  // Accumulators over the sims.
  readonly cPlayoffs: Float64Array;
  readonly cBye: Float64Array;
  readonly cTitle: Float64Array;
  readonly sumW: Float64Array;
  readonly sumL: Float64Array;
  readonly sumT: Float64Array;
  /** [team·T + seed index]. */
  readonly cSeed: Float64Array;
  /** [weekly entry·T + team]. */
  readonly cWeekWin: Float64Array;
  readonly cMedianWin: Float64Array;
  // Places, weekly high scores and the points leader (the file header).
  /** The semifinal round (R − 2; -1 without one, R < 2) and the final (R − 1). */
  readonly semiRound: number;
  readonly finalRound: number;
  readonly thirdRule: SimThirdPlace;
  /** High-score periods as draw indexes: period q is hsWeek[hsStart[q]..hsStart[q + 1]). */
  readonly hsStart: Int32Array;
  readonly hsWeek: Int32Array;
  /** Working: one period's score per team. */
  readonly hsScore: Float64Array;
  /** Working: a drawn semifinal round's losers (semiLosers[0..semiLosers[2])) and a drawn final's loser (-1 = none). */
  readonly semiLosers: Int32Array;
  finalLoser: number;
  /** Sticky over the sims: a 3rd-place game reached with positive probability couldn't be known. */
  thirdUnknown: boolean;
  /** Exact brackets: each slot's chance to be alive at the start of the semifinal round and of the final. */
  readonly pSemi: Float64Array;
  readonly pReach: Float64Array;
  readonly cSecond: Float64Array;
  readonly cThird: Float64Array;
  readonly cHigh: Float64Array;
  readonly cLeader: Float64Array;
}

/** Keys of criterion `crit` for the group arr[lo..hi), into keys row `row` (see the file header for each criterion). */
function computeKeys(st: SimState, arr: Int32Array, lo: number, hi: number, crit: number, row: number): void {
  const { T, keys } = st;
  switch (crit) {
    case WIN_PCT: {
      const v = st.winPct;
      for (let i = lo; i < hi; i++) keys[row + (arr[i] as number)] = v[arr[i] as number] as number;
      return;
    }
    case POINTS_FOR: {
      const v = st.pf;
      for (let i = lo; i < hi; i++) keys[row + (arr[i] as number)] = v[arr[i] as number] as number;
      return;
    }
    case POINTS_AGAINST: {
      const v = st.pa;
      for (let i = lo; i < hi; i++) keys[row + (arr[i] as number)] = v[arr[i] as number] as number;
      return;
    }
    case HEAD_TO_HEAD: {
      const { h2hWins, h2hMeetings } = st;
      if (hi - lo === 2) {
        const a = arr[lo] as number;
        const b = arr[lo + 1] as number;
        keys[row + a] = h2hWins[a * T + b] as number;
        keys[row + b] = h2hWins[b * T + a] as number;
        return;
      }
      // 3+ teams: only when every pair met equally often.
      const meetings = h2hMeetings[(arr[lo] as number) * T + (arr[lo + 1] as number)] as number;
      let equal = true;
      for (let i = lo; i < hi && equal; i++) for (let j = i + 1; j < hi; j++) if (h2hMeetings[(arr[i] as number) * T + (arr[j] as number)] !== meetings) equal = false;
      for (let i = lo; i < hi; i++) {
        const a = arr[i] as number;
        let total = 0;
        if (equal) for (let j = lo; j < hi; j++) if (j !== i) total += h2hWins[a * T + (arr[j] as number)] as number;
        keys[row + a] = total;
      }
      return;
    }
    case DIVISION: {
      // Every team's own division record, whatever the group's divisions (espn-api's code).
      const { divWins, divGames } = st;
      for (let i = lo; i < hi; i++) {
        const a = arr[i] as number;
        const games = divGames[a] as number;
        keys[row + a] = games > 0 ? (divWins[a] as number) / games : 0;
      }
      return;
    }
  }
}

/** Sorts the group arr[lo..hi) by the hierarchy from `depth` on (key desc, then team index asc), recursing into groups still tied. */
function sortGroup(st: SimState, arr: Int32Array, lo: number, hi: number, depth: number): void {
  if (hi - lo < 2 || depth >= st.hierarchy.length) return;
  const keys = st.keys;
  const row = depth * st.T;
  computeKeys(st, arr, lo, hi, st.hierarchy[depth] as number, row);
  for (let i = lo + 1; i < hi; i++) {
    const a = arr[i] as number;
    const ka = keys[row + a] as number;
    let j = i - 1;
    while (j >= lo) {
      const b = arr[j] as number;
      const kb = keys[row + b] as number;
      if (kb > ka || (kb === ka && b < a)) break;
      arr[j + 1] = b;
      j--;
    }
    arr[j + 1] = a;
  }
  let i = lo;
  while (i < hi) {
    const k = keys[row + (arr[i] as number)] as number;
    let j = i + 1;
    while (j < hi && keys[row + (arr[j] as number)] === k) j++;
    if (j - i > 1) sortGroup(st, arr, i, j, depth + 1);
    i = j;
  }
}

/** The final standings into st.order (seed 1 first), division winners first when the league seeds them so. */
function rankStandings(st: SimState): void {
  const { T, order } = st;
  if (!st.divisionWinnersFirst) {
    for (let i = 0; i < T; i++) order[i] = i;
    sortGroup(st, order, 0, T, 0);
    return;
  }
  const { divOf, scratch, isWinner } = st;
  isWinner.fill(0);
  let nw = 0;
  for (let d = 0; d < st.D; d++) {
    let c = 0;
    for (let i = 0; i < T; i++) if (divOf[i] === d) scratch[c++] = i;
    if (c === 0) continue;
    sortGroup(st, scratch, 0, c, 0);
    const winner = scratch[0] as number;
    order[nw++] = winner;
    isWinner[winner] = 1;
  }
  sortGroup(st, order, 0, nw, 0);
  let k = nw;
  for (let i = 0; i < T; i++) if (isWinner[i] === 0) order[k++] = i;
  sortGroup(st, order, nw, T, 0);
}

/** The winner of playoff round r's game x vs y: replayed, else drawn (an exact tie goes to the better seed); -1 when it can't be known (no drawn week, no result). */
function playoffGame(st: SimState, x: number, y: number, r: number): number {
  const { T, score } = st;
  const known = st.resultWinner[x * T + y] as number;
  if (known >= 0) return known;
  const rw = st.roundWeek[r] as Int32Array;
  if (rw.length === 0) return -1;
  let sx = 0;
  let sy = 0;
  for (let k = 0; k < rw.length; k++) {
    const o = (rw[k] as number) * T;
    sx += score[o + x] as number;
    sy += score[o + y] as number;
  }
  if (sx > sy) return x;
  if (sy > sx) return y;
  return (st.seedOf[x] as number) < (st.seedOf[y] as number) ? x : y;
}

/**
 * Drawn playoff round r on st.slots[0..live): its winners go to slots[0..live / 2), in fixed slots or, when the
 * league re-seeds and r > 0, best seed against worst. The semifinal round's losers go to st.semiLosers and the
 * final's to st.finalLoser (a bye has none; playBracket resets both). False when one of its games can't be known.
 */
function playRound(st: SimState, r: number, live: number): boolean {
  const { slots, seedOf } = st;
  const half = live >> 1;
  const bestVsWorst = st.reseed && r > 0;
  if (bestVsWorst) sortBySeed(slots, live, seedOf);
  for (let i = 0; i < half; i++) {
    const x = (bestVsWorst ? slots[i] : slots[2 * i]) as number;
    const y = (bestVsWorst ? slots[live - 1 - i] : slots[2 * i + 1]) as number;
    const winner = x < 0 ? y : y < 0 ? x : playoffGame(st, x, y, r);
    if (winner < 0) return false;
    if (x >= 0 && y >= 0) {
      const loser = winner === x ? y : x;
      if (r === st.semiRound) st.semiLosers[st.semiLosers[2]!++] = loser;
      else if (r === st.finalRound) st.finalLoser = loser;
    }
    slots[i] = winner;
  }
  return true;
}

/** Insertion sort of arr[0..n) by seed, best first (team indexes; no empty slots). */
function sortBySeed(arr: Int32Array, n: number, seedOf: Int32Array): void {
  for (let i = 1; i < n; i++) {
    const a = arr[i] as number;
    let j = i - 1;
    while (j >= 0 && (seedOf[arr[j] as number] as number) > (seedOf[a] as number)) {
      arr[j + 1] = arr[j] as number;
      j--;
    }
    arr[j + 1] = a;
  }
}

/** winP's marker for a zero-variance game between equal sums: the better seed wins (the drawn game's tie rule). */
const TIE_BY_SEED = 2;

/** P(a beats b in round r) from st.winP, the tie rule applied; NaN when the game can't be known. */
function winChance(st: SimState, r: number, a: number, b: number): number {
  const { T } = st;
  const w = st.winP[(r * T + a) * T + b] as number;
  return w === TIE_BY_SEED ? ((st.seedOf[a] as number) < (st.seedOf[b] as number) ? 1 : 0) : w;
}

/**
 * P(x takes 3rd place from y), x and y the two semifinal losers, by st.thirdRule (the file header's "Places"): their game
 * in the final round's weeks (exact: winChance, NaN when it can't be known), the better regular-season seed, or a split.
 */
function thirdChance(st: SimState, x: number, y: number): number {
  if (st.thirdRule === "split") return 0.5;
  if (st.thirdRule === "bySeed") return (st.seedOf[x] as number) < (st.seedOf[y] as number) ? 1 : 0;
  return winChance(st, st.finalRound, x, y);
}

/**
 * 3rd place when the semifinal round wasn't computed exactly (the file header's "Places"), weight × each team's chance
 * added to st.cThird: a bracket of 2 slots (no semifinal) gives it to seed 3 of the final standings; one semifinal loser
 * (the other semifinal a bye: 3 playoff teams) takes it outright; two play for it (`drawn`, the sampled mode: their game
 * drawn like any playoff game; else thirdChance, exact). A 3rd-place game that can't be known sets st.thirdUnknown.
 */
function thirdFromDrawn(st: SimState, weight: number, drawn: boolean): void {
  const { cThird, semiLosers } = st;
  if (st.semiRound < 0) {
    if (st.T >= 3) cThird[st.order[2] as number]! += weight;
    return;
  }
  const k = semiLosers[2] as number;
  if (k === 1) {
    cThird[semiLosers[0] as number]! += weight;
    return;
  }
  if (k !== 2) return; // unreachable: a semifinal round always has one or two games
  const x = semiLosers[0] as number;
  const y = semiLosers[1] as number;
  if (drawn && st.thirdRule === "game") {
    const w = playoffGame(st, x, y, st.finalRound);
    if (w < 0) st.thirdUnknown = true;
    else cThird[w]! += weight;
    return;
  }
  const w = thirdChance(st, x, y);
  if (w !== w) {
    st.thirdUnknown = true;
    return;
  }
  cThird[x]! += weight * w;
  cThird[y]! += weight * (1 - w);
}

/**
 * The exact title chances of a fixed bracket (the file header's "Title odds"): slots[0..L) (team indexes, -1 = an
 * empty slot), L a power of two, playing rounds r0, r0 + 1, … An empty slot is always a round-1 bye: its pair partner
 * is a team (bracketOrder puts seeds N + 1..B against seeds B − N..1), which goes through. After that, every pair
 * (i, j) that can meet (i in one half of a block, j in the other) adds P(i alive) × P(j alive) × P(i beats j) to i's
 * chance to go through and the rest to j's. Adds weight × each team's chance to win it to st.cTitle, to be 2nd (alive
 * at the final's start, not after it) to st.cSecond, and to be 3rd to st.cThird (the file header's "Places": the two
 * halves' semifinal losers are independent). False when a game reached with positive probability can't be known (a
 * 3rd-place game that can't be known only sets st.thirdUnknown).
 */
function fixedExact(st: SimState, slots: Int32Array, L: number, r0: number, weight: number): boolean {
  const { T, winP, seedOf, pSemi, pReach } = st;
  let p = st.pAlive;
  let q = st.pNext;
  for (let i = 0; i < L; i++) p[i] = (slots[i] as number) >= 0 ? 1 : 0;
  for (let h = 1, r = r0; h < L; h <<= 1, r++) {
    if (r === st.semiRound) for (let i = 0; i < L; i++) pSemi[i] = p[i] as number;
    if (r === st.finalRound) for (let i = 0; i < L; i++) pReach[i] = p[i] as number;
    for (let i = 0; i < L; i++) q[i] = 0;
    for (let lo = 0; lo < L; lo += 2 * h) {
      const mid = lo + h;
      const hi = mid + h;
      for (let i = lo; i < mid; i++) {
        const pi = p[i] as number;
        const a = slots[i] as number;
        if (h === 1 && (a < 0 || (slots[mid] as number) < 0)) {
          // A round-1 bye: the team in the pair goes through.
          q[i] = pi;
          q[mid] = p[mid] as number;
          continue;
        }
        if (pi === 0) continue;
        const row = (r * T + a) * T;
        for (let j = mid; j < hi; j++) {
          const pj = p[j] as number;
          if (pj === 0) continue;
          const b = slots[j] as number;
          let w = winP[row + b] as number;
          if (w !== w) return false; // NaN: can't be known
          if (w === TIE_BY_SEED) w = (seedOf[a] as number) < (seedOf[b] as number) ? 1 : 0;
          const both = pi * pj;
          q[i]! += both * w;
          q[j]! += both * (1 - w);
        }
      }
    }
    const t = p;
    p = q;
    q = t;
  }
  const { cTitle, cSecond, cThird } = st;
  for (let i = 0; i < L; i++) {
    const a = slots[i] as number;
    if (a < 0) continue;
    cTitle[a]! += weight * (p[i] as number);
    cSecond[a]! += weight * ((pReach[i] as number) - (p[i] as number));
  }
  // 3rd: the semifinal drawn before r0 (a re-seeding bracket's) or no semifinal at all.
  if (st.semiRound < r0) {
    thirdFromDrawn(st, weight, false);
    return true;
  }
  // The semifinal losers, one per half: P(slot i loses its semifinal) = alive at its start − alive at the final's.
  const half = L >> 1;
  // A semifinal that is a bye: only a 4-slot bracket of 3 playoff teams (the top seed's round-1 bye).
  const leftGame = !(L === 4 && ((slots[0] as number) < 0 || (slots[1] as number) < 0));
  const rightGame = !(L === 4 && ((slots[2] as number) < 0 || (slots[3] as number) < 0));
  for (let i = 0; i < half; i++) {
    const a = slots[i] as number;
    if (a < 0) continue;
    const li = (pSemi[i] as number) - (pReach[i] as number);
    if (li === 0) continue;
    if (!rightGame) {
      cThird[a]! += weight * li; // the other semifinal is a bye: no one to play, 3rd outright
      continue;
    }
    for (let j = half; j < L; j++) {
      const b = slots[j] as number;
      if (b < 0) continue;
      const lj = (pSemi[j] as number) - (pReach[j] as number);
      if (lj === 0) continue;
      const w = thirdChance(st, a, b);
      if (w !== w) {
        st.thirdUnknown = true; // NaN: the 3rd-place game can't be known
        continue;
      }
      const both = li * lj;
      cThird[a]! += weight * both * w;
      cThird[b]! += weight * both * (1 - w);
    }
  }
  if (!leftGame)
    for (let j = half; j < L; j++) {
      const b = slots[j] as number;
      if (b >= 0) cThird[b]! += weight * ((pSemi[j] as number) - (pReach[j] as number));
    }
  return true;
}

/**
 * The exact title chances of a 4-team fixed bracket (fixedExact's rule, written out): s0 vs s1 and s2 vs s3 in
 * round r, the winners in round r + 1. Adds weight × the chances to st.cTitle, and to st.cSecond and st.cThird (the
 * semifinals' losers meet in round r + 1's weeks: r + 1 is always the final here); false when a game reached with
 * positive probability can't be known (a 3rd-place game that can't be known only sets st.thirdUnknown).
 */
function fourExact(st: SimState, r: number, s0: number, s1: number, s2: number, s3: number, weight: number): boolean {
  const a = winChance(st, r, s0, s1);
  const b = winChance(st, r, s2, s3);
  if (a !== a || b !== b) return false;
  const { cTitle } = st;
  let t0 = 0;
  let t1 = 0;
  let t2 = 0;
  let t3 = 0;
  // The final: each pair that can meet, weighted by both getting there.
  const f = r + 1;
  if (a > 0 && b > 0) {
    const w = winChance(st, f, s0, s2);
    if (w !== w) return false;
    t0 += a * b * w;
    t2 += a * b * (1 - w);
  }
  if (a > 0 && b < 1) {
    const w = winChance(st, f, s0, s3);
    if (w !== w) return false;
    t0 += a * (1 - b) * w;
    t3 += a * (1 - b) * (1 - w);
  }
  if (a < 1 && b > 0) {
    const w = winChance(st, f, s1, s2);
    if (w !== w) return false;
    t1 += (1 - a) * b * w;
    t2 += (1 - a) * b * (1 - w);
  }
  if (a < 1 && b < 1) {
    const w = winChance(st, f, s1, s3);
    if (w !== w) return false;
    t1 += (1 - a) * (1 - b) * w;
    t3 += (1 - a) * (1 - b) * (1 - w);
  }
  cTitle[s0]! += weight * t0;
  cTitle[s1]! += weight * t1;
  cTitle[s2]! += weight * t2;
  cTitle[s3]! += weight * t3;
  // 2nd: reached the final (s0 with chance a, s1 1 − a, s2 b, s3 1 − b) and lost it.
  const { cSecond, cThird } = st;
  cSecond[s0]! += weight * (a - t0);
  cSecond[s1]! += weight * (1 - a - t1);
  cSecond[s2]! += weight * (b - t2);
  cSecond[s3]! += weight * (1 - b - t3);
  // 3rd: the semifinals' losers (s1 with chance a, s0 1 − a; s3 with chance b, s2 1 − b), independent, play each other.
  for (let k = 0; k < 4; k++) {
    const x = k < 2 ? s1 : s0;
    const y = (k & 1) === 0 ? s3 : s2;
    const both = (k < 2 ? a : 1 - a) * ((k & 1) === 0 ? b : 1 - b);
    if (both === 0) continue;
    const w = thirdChance(st, x, y);
    if (w !== w) {
      st.thirdUnknown = true;
      continue;
    }
    cThird[x]! += weight * both * w;
    cThird[y]! += weight * both * (1 - w);
  }
  return true;
}

/**
 * A re-seeding bracket's round r with 8 teams left (its games st.pairX[g] vs st.pairY[g], -1 = an empty slot: a
 * bye), exactly: each outcome of its games, then the survivors' 4-team bracket in seed order, best against worst
 * (fixed slots [1, 4, 2, 3]). Adds weight × the title chances to st.cTitle, and the places to st.cSecond and
 * st.cThird (fourExact's); false when a game can't be known.
 */
function eightExact(st: SimState, r: number, weight: number): boolean {
  const { pairX, pairY, pairW, byeTeam, quad, seedOf } = st;
  // The games, compacted into pairX/pairY[0..games); the byes' teams go through in every outcome.
  let games = 0;
  let byes = 0;
  for (let g = 0; g < 4; g++) {
    const x = pairX[g] as number;
    const y = pairY[g] as number;
    if (x < 0 || y < 0) {
      byeTeam[byes++] = x < 0 ? y : x;
      continue;
    }
    const w = winChance(st, r, x, y);
    if (w !== w) return false;
    pairX[games] = x;
    pairY[games] = y;
    pairW[games++] = w;
  }
  for (let c = 0; c < 1 << games; c++) {
    let prob = weight;
    for (let g = 0; g < games; g++) {
      const yWins = (c >> g) & 1;
      prob *= yWins === 1 ? 1 - (pairW[g] as number) : (pairW[g] as number);
      quad[g] = (yWins === 1 ? pairY[g] : pairX[g]) as number;
    }
    if (prob === 0) continue;
    for (let k = 0; k < byes; k++) quad[games + k] = byeTeam[k] as number;
    sortBySeed(quad, 4, seedOf);
    if (!fourExact(st, r + 1, quad[0] as number, quad[3] as number, quad[1] as number, quad[2] as number, prob)) return false;
  }
  return true;
}

/**
 * The bracket from st.slots[0..B) (seeds in bracketOrder slots), its title chances added to st.cTitle and its places
 * to st.cSecond and st.cThird: drawn (sampled), or exact from st.exactFrom on (the file header's "Title odds" and
 * "Places"). False when the playoffs can't be known.
 */
function playBracket(st: SimState): boolean {
  const { B, R, slots, cTitle } = st;
  let live = B;
  if (!st.exact) {
    for (let r = 0; r < R; r++, live >>= 1) if (!playRound(st, r, live)) return false;
    cTitle[slots[0] as number]! += 1;
    if (st.finalLoser >= 0) st.cSecond[st.finalLoser]! += 1;
    thirdFromDrawn(st, 1, true);
    return true;
  }
  const r0 = st.exactFrom;
  for (let r = 0; r < r0; r++, live >>= 1) if (!playRound(st, r, live)) return false;
  // Fixed slots, or a re-seeding bracket's round 1 (fixed slots) with at most 4 teams: it pairs like fixed slots.
  if (!st.reseed || (r0 === 0 && live <= 4)) return fixedExact(st, slots, live, r0, 1);
  // A re-seeded round (after round 1): the survivors best first, best against worst.
  if (r0 > 0) {
    sortBySeed(slots, live, st.seedOf);
    if (live === 2) return fixedExact(st, slots, 2, r0, 1);
    if (live === 4) return fourExact(st, r0, slots[0] as number, slots[3] as number, slots[1] as number, slots[2] as number, 1);
  }
  // A round of 8: round 1 in fixed slots (byes included), a later round best against worst.
  const { pairX, pairY } = st;
  for (let g = 0; g < 4; g++) {
    pairX[g] = (r0 > 0 ? slots[g] : slots[2 * g]) as number;
    pairY[g] = (r0 > 0 ? slots[7 - g] : slots[2 * g + 1]) as number;
  }
  return eightExact(st, r0, 1);
}

/**
 * Sim n: its scores, the rest of the regular season, the final standings and the playoffs, added to
 * st's accumulators. Allocates nothing. Returns false when the playoffs can't be known (a round already
 * played has no result for one of its games); the title isn't counted then.
 */
function simulateOne(st: SimState, n: number): boolean {
  const { T, WT, z, meanF, sdF, score, wins, losses, ties, pf, pa, h2hWins, divWins } = st;
  const zBase = n * WT;
  const scoreCells = st.scoreCells;
  for (let i = 0; i < scoreCells.length; i += 2) {
    const end = scoreCells[i + 1] as number;
    for (let k = scoreCells[i] as number; k < end; k++) score[k] = (meanF[k] as number) + (sdF[k] as number) * (z[zBase + k] as number);
  }
  wins.set(st.baseW);
  losses.set(st.baseL);
  ties.set(st.baseT);
  pf.set(st.basePF);
  pa.set(st.basePA);
  h2hWins.set(st.h2hWinsBase);
  divWins.set(st.divWinsBase);

  // Remaining games.
  const { gameA, gameB, gameSame, gameStart, gameWeek, gameSlot, cWeekWin, pointsOnly } = st;
  const G = gameA.length;
  for (let g = 0; g < G; g++) {
    const a = gameA[g] as number;
    const b = gameB[g] as number;
    let sa = 0;
    let sb = 0;
    const end = gameStart[g + 1] as number;
    for (let k = gameStart[g] as number; k < end; k++) {
      const o = (gameWeek[k] as number) * T;
      sa += score[o + a] as number;
      sb += score[o + b] as number;
    }
    pa[a]! += sb;
    pa[b]! += sa;
    const slot = (gameSlot[g] as number) * T;
    if (sa > sb) cWeekWin[slot + a]! += 1;
    else if (sb > sa) cWeekWin[slot + b]! += 1;
    if (pointsOnly) continue;
    pf[a]! += sa;
    pf[b]! += sb;
    const same = gameSame[g] === 1;
    if (sa > sb) {
      wins[a]! += 1;
      losses[b]! += 1;
      h2hWins[a * T + b]! += 1;
      if (same) divWins[a]! += 1;
    } else if (sb > sa) {
      wins[b]! += 1;
      losses[a]! += 1;
      h2hWins[b * T + a]! += 1;
      if (same) divWins[b]! += 1;
    } else {
      ties[a]! += 1;
      ties[b]! += 1;
      h2hWins[a * T + b]! += 0.5;
      h2hWins[b * T + a]! += 0.5;
      if (same) {
        divWins[a]! += 0.5;
        divWins[b]! += 0.5;
      }
    }
  }

  // Median games: the top ⌊T/2⌋ scores win (equal scores rank by team index). The insertion sort
  // starts from the last median week's order: scores are correlated, so it's nearly sorted, and the
  // order (score desc, index asc) is total, so the start doesn't change the result.
  const { medianWeek, medianSlot, medianOrder, medianWinners, cMedianWin } = st;
  for (let m = 0; m < medianWeek.length; m++) {
    const o = (medianWeek[m] as number) * T;
    const slot = (medianSlot[m] as number) * T;
    for (let i = 1; i < T; i++) {
      const a = medianOrder[i] as number;
      const sa = score[o + a] as number;
      let j = i - 1;
      while (j >= 0) {
        const b = medianOrder[j] as number;
        const sb = score[o + b] as number;
        if (sb > sa || (sb === sa && b < a)) break;
        medianOrder[j + 1] = b;
        j--;
      }
      medianOrder[j + 1] = a;
    }
    for (let k = 0; k < T; k++) {
      const t = medianOrder[k] as number;
      if (k < medianWinners) {
        wins[t]! += 1;
        cMedianWin[slot + t]! += 1;
      } else losses[t]! += 1;
    }
  }

  // Points-only leagues: every regular-season week's score is PF.
  const pfWeek = st.pfWeek;
  for (let k = 0; k < pfWeek.length; k++) {
    const o = (pfWeek[k] as number) * T;
    for (let i = 0; i < T; i++) pf[i]! += score[o + i] as number;
  }

  // Weekly high scores: each period's top score (the sum over its drawn weeks), split evenly on an exact tie.
  const { hsStart, hsWeek, hsScore, cHigh } = st;
  const periods = hsStart.length - 1;
  for (let q = 0; q < periods; q++) {
    const s0 = hsStart[q] as number;
    const s1 = hsStart[q + 1] as number;
    let best = Number.NEGATIVE_INFINITY;
    let at = -1;
    let tied = 0;
    if (s1 - s0 === 1) {
      // One week (nearly every period): its scores as drawn.
      const o = (hsWeek[s0] as number) * T;
      for (let i = 0; i < T; i++) {
        const v = score[o + i] as number;
        hsScore[i] = v;
        if (v > best) {
          best = v;
          at = i;
          tied = 1;
        } else if (v === best) tied++;
      }
    } else {
      for (let i = 0; i < T; i++) {
        let v = 0;
        for (let k = s0; k < s1; k++) v += score[(hsWeek[k] as number) * T + i] as number;
        hsScore[i] = v;
        if (v > best) {
          best = v;
          at = i;
          tied = 1;
        } else if (v === best) tied++;
      }
    }
    if (tied === 1) cHigh[at]! += 1;
    else if (tied > 1) {
      const share = 1 / tied;
      for (let i = 0; i < T; i++) if (hsScore[i] === best) cHigh[i]! += share;
    }
  }
  // The points leader: the most points for after the regular season, split evenly on an exact tie.
  {
    let best = Number.NEGATIVE_INFINITY;
    let at = -1;
    let tied = 0;
    for (let i = 0; i < T; i++) {
      const v = pf[i] as number;
      if (v > best) {
        best = v;
        at = i;
        tied = 1;
      } else if (v === best) tied++;
    }
    const { cLeader } = st;
    if (tied === 1) cLeader[at]! += 1;
    else if (tied > 1) {
      const share = 1 / tied;
      for (let i = 0; i < T; i++) if (pf[i] === best) cLeader[i]! += share;
    }
  }

  // Standings.
  const { winPct, order, seedOf, sumW, sumL, sumT, cSeed } = st;
  for (let i = 0; i < T; i++) {
    const games = (wins[i] as number) + (losses[i] as number) + (ties[i] as number);
    winPct[i] = games > 0 ? ((wins[i] as number) + (ties[i] as number) / 2) / games : 0;
    sumW[i]! += wins[i] as number;
    sumL[i]! += losses[i] as number;
    sumT[i]! += ties[i] as number;
  }
  rankStandings(st);
  for (let k = 0; k < T; k++) {
    const t = order[k] as number;
    seedOf[t] = k;
    cSeed[t * T + k]! += 1;
  }

  // Playoffs.
  const { N, B, byes, seedSlots, slots, cPlayoffs, cBye, cTitle } = st;
  for (let k = 0; k < N; k++) cPlayoffs[order[k] as number]! += 1;
  for (let k = 0; k < byes; k++) cBye[order[k] as number]! += 1;
  if (N <= 1) {
    // No bracket: 1st, 2nd and 3rd are the top of the final standings.
    if (T > 0) cTitle[order[0] as number]! += 1;
    if (T > 1) st.cSecond[order[1] as number]! += 1;
    if (T > 2) st.cThird[order[2] as number]! += 1;
    return true;
  }
  if (!st.bracketPlayed) return true;
  for (let i = 0; i < B; i++) {
    const seed = seedSlots[i] as number;
    slots[i] = seed <= N ? (order[seed - 1] as number) : -1;
  }
  st.semiLosers[2] = 0;
  st.finalLoser = -1;
  return playBracket(st);
}

/**
 * Today's standings (TeamOdds.rank): team indexes, seed 1 first, by the league's rules (the file header's
 * "Standings": the same hierarchy, and division winners first when the league seeds them so) from the
 * current records and the played games alone. It is the simulator's own final-standings code on the
 * setup with nothing left to play (no games, median weeks, high-score periods, draws or playoffs), so head-to-head
 * meetings count the played games only, and the order can't drift from the one the simulations use.
 */
export function standingsOrder(setup: SimSetup): number[] {
  const T = setup.teams.length;
  const today = simulateSeason(
    {
      ...setup,
      weeks: [],
      mean: setup.teams.map(() => new Float64Array(0)),
      sd: setup.teams.map(() => new Float64Array(0)),
      games: [],
      medianWeeks: [],
      playoffTeams: 0,
      byes: 0,
      rounds: [],
      playoffResults: [],
      highScorePeriods: [],
    },
    { sims: 1, seed: 0 },
  );
  // One sim with nothing drawn: each team holds exactly one seed.
  const order = new Array<number>(T).fill(-1);
  today.teams.forEach((o, t) => {
    order[o.seedDist.indexOf(1)] = t;
  });
  return order;
}

/** Simulates the rest of the season `opts.sims` times (§8). See the file header for every rule. */
export function simulateSeason(setup: SimSetup, opts: SimOptions): SimResult {
  const fn = "simulateSeason";
  const sims = wholeCount(fn, "sims", opts.sims, 1);
  const T = setup.teams.length;
  const W = setup.weeks.length;
  const WT = W * T;
  const pointsOnly = setup.pointsOnly;

  // ---- Validate and index the setup. Everything allocated here is reused by every sim.
  const weekIndex = new Map<number, number>();
  for (let i = 0; i < W; i++) {
    const w = setup.weeks[i] as number;
    if (!Number.isFinite(w) || (i > 0 && !(w > (setup.weeks[i - 1] as number)))) throw new RangeError(`${fn}: weeks must be strictly ascending (got ${setup.weeks.join(", ")})`);
    weekIndex.set(w, i);
  }
  if (setup.mean.length !== T || setup.sd.length !== T) throw new RangeError(`${fn}: ${setup.mean.length} mean and ${setup.sd.length} sd rows for ${T} teams`);
  // Flattened week-major like the normals: [w·T + t].
  const meanF = new Float64Array(WT);
  const sdF = new Float64Array(WT);
  for (let t = 0; t < T; t++) {
    const m = setup.mean[t] as Float64Array;
    const s = setup.sd[t] as Float64Array;
    if (m.length !== W || s.length !== W) throw new RangeError(`${fn}: team ${t} has ${m.length} means and ${s.length} SDs for ${W} weeks`);
    for (let w = 0; w < W; w++) {
      const mv = m[w] as number;
      const sv = s[w] as number;
      if (!Number.isFinite(mv) || !Number.isFinite(sv) || sv < 0) throw new RangeError(`${fn}: team ${t}, week ${setup.weeks[w]}: mean ${mv} and SD ${sv} must be finite, SD ≥ 0`);
      meanF[w * T + t] = mv;
      sdF[w * T + t] = sv;
    }
  }
  const normals = opts.normals ?? simNormals(opts.seed, sims, W, T);
  if (normals.weeks !== W || normals.teams !== T || normals.sims < sims || normals.z.length < sims * WT)
    throw new RangeError(`${fn}: the normals matrix (${normals.sims} sims × ${normals.weeks} weeks × ${normals.teams} teams) doesn't fit ${sims} sims × ${W} weeks × ${T} teams`);
  const z = normals.z;

  // Divisions as dense indexes (-1 = none), in ascending order of the division numbers.
  const divisionNumbers = [...new Set(setup.teams.map((tm) => tm.division).filter((d): d is number => d !== null && Number.isFinite(d)))].sort((a, b) => a - b);
  const D = divisionNumbers.length;
  const divOf = new Int32Array(T).fill(-1);

  // Starting records.
  const baseW = new Float64Array(T);
  const baseL = new Float64Array(T);
  const baseT = new Float64Array(T);
  const basePF = new Float64Array(T);
  const basePA = new Float64Array(T);
  for (let i = 0; i < T; i++) {
    const tm = setup.teams[i] as SimTeam;
    for (const [name, v] of [["w", tm.w], ["l", tm.l], ["t", tm.t], ["pointsFor", tm.pointsFor], ["pointsAgainst", tm.pointsAgainst]] as const)
      if (!Number.isFinite(v)) throw new RangeError(`${fn}: team ${i} ${name} is ${v}`);
    baseW[i] = tm.w;
    baseL[i] = tm.l;
    baseT[i] = tm.t;
    basePF[i] = tm.pointsFor;
    basePA[i] = tm.pointsAgainst;
    if (tm.division !== null) divOf[i] = divisionNumbers.indexOf(tm.division);
  }

  // Head-to-head and division records: wins (a tie ½) from the played games; meetings and division
  // games from played and remaining games alike (the schedule is the same in every sim).
  const h2hWinsBase = new Float64Array(T * T);
  const h2hMeetings = new Float64Array(T * T);
  const divWinsBase = new Float64Array(T);
  const divGames = new Float64Array(T);
  for (const g of setup.played) {
    const a = teamIndex(g.a, T, "a played game");
    const b = teamIndex(g.b, T, "a played game");
    if (a === b) throw new RangeError(`${fn}: a played game pits team ${a} against itself`);
    if (g.winner !== null && g.winner !== a && g.winner !== b) throw new RangeError(`${fn}: played game ${a}–${b} has winner ${g.winner}`);
    const shareA = g.winner === null ? 0.5 : g.winner === a ? 1 : 0;
    h2hMeetings[a * T + b]! += 1;
    h2hMeetings[b * T + a]! += 1;
    h2hWinsBase[a * T + b]! += shareA;
    h2hWinsBase[b * T + a]! += 1 - shareA;
    if (sameDivision(divOf, a, b)) {
      divGames[a]! += 1;
      divGames[b]! += 1;
      divWinsBase[a]! += shareA;
      divWinsBase[b]! += 1 - shareA;
    }
  }

  // Remaining games with an opponent (a bye adds nothing). Each is decided by its drawn weeks; a week
  // it spans that's neither drawn nor over, or no drawn week at all, is the caller's mistake: the game
  // would drop off both teams' records.
  const firstDrawn = W > 0 ? (setup.weeks[0] as number) : Number.POSITIVE_INFINITY;
  const listedWeeks = `weeks (${setup.weeks.join(", ")})`;
  const keptA: number[] = [];
  const keptB: number[] = [];
  const keptWeeks: number[][] = [];
  for (const g of setup.games) {
    const a = teamIndex(g.a, T, "a game");
    if (g.b === null) continue;
    const b = teamIndex(g.b, T, "a game");
    if (a === b) throw new RangeError(`${fn}: a game pits team ${a} against itself`);
    const missing = missingWeek(g.weeks, weekIndex, firstDrawn);
    if (missing !== undefined) throw new RangeError(`${fn}: the game ${a}–${b} (weeks ${g.weeks.join(", ")}) needs week ${missing}, which isn't in ${listedWeeks}`);
    const drawn = drawnIndexes(g.weeks, weekIndex);
    if (drawn.length === 0)
      throw new RangeError(`${fn}: the game ${a}–${b} (weeks ${g.weeks.join(", ")}) has no week in ${listedWeeks}: a decided game belongs in played, and one still undecided needs its week drawn`);
    keptA.push(a);
    keptB.push(b);
    keptWeeks.push(drawn);
    h2hMeetings[a * T + b]! += 1;
    h2hMeetings[b * T + a]! += 1;
    if (sameDivision(divOf, a, b)) {
      divGames[a]! += 1;
      divGames[b]! += 1;
    }
  }
  const G = keptA.length;
  const gameA = Int32Array.from(keptA);
  const gameB = Int32Array.from(keptB);
  const gameSame = new Uint8Array(G);
  const gameStart = new Int32Array(G + 1);
  for (let g = 0; g < G; g++) {
    gameSame[g] = sameDivision(divOf, keptA[g] as number, keptB[g] as number) ? 1 : 0;
    gameStart[g + 1] = (gameStart[g] as number) + (keptWeeks[g] as number[]).length;
  }
  const gameWeek = Int32Array.from(keptWeeks.flat());

  // Median weeks (checked always, used outside points-only leagues) and the weeks listed in SimResult.weekly.
  for (const w of setup.medianWeeks) if (!weekIndex.has(w)) throw new RangeError(`${fn}: median week ${w} isn't in ${listedWeeks}`);
  const medianIdx = pointsOnly ? [] : drawnIndexes(setup.medianWeeks, weekIndex);
  const medianWeek = Int32Array.from(medianIdx);
  const weeklyWeeks = [...new Set([...keptWeeks.map((ws) => setup.weeks[ws[0] as number] as number), ...medianIdx.map((i) => setup.weeks[i] as number)])].sort((a, b) => a - b);
  const S = weeklyWeeks.length;
  const slotOf = new Map(weeklyWeeks.map((w, s) => [w, s]));
  const gameSlot = Int32Array.from(keptWeeks, (ws) => slotOf.get(setup.weeks[ws[0] as number] as number) as number);
  const medianSlot = Int32Array.from(medianIdx, (i) => slotOf.get(setup.weeks[i] as number) as number);
  const hasGame = new Uint8Array(S * T);
  for (let g = 0; g < G; g++) {
    hasGame[(gameSlot[g] as number) * T + (gameA[g] as number)] = 1;
    hasGame[(gameSlot[g] as number) * T + (gameB[g] as number)] = 1;
  }
  const isMedianSlot = new Uint8Array(S);
  for (const s of medianSlot) isMedianSlot[s] = 1;

  // Points-only leagues: PF adds every drawn week that isn't a playoff-round week.
  const playoffWeekSet = new Set(setup.rounds.flatMap((r) => r.weeks));
  const pfWeek = pointsOnly ? Int32Array.from(setup.weeks.flatMap((w, i) => (playoffWeekSet.has(w) ? [] : [i]))) : new Int32Array(0);

  // Weekly high-score periods, checked like games (each week drawn or over, at least one drawn), as draw indexes.
  const hsLists: number[][] = [];
  for (const ws of setup.highScorePeriods ?? []) {
    const missing = missingWeek(ws, weekIndex, firstDrawn);
    if (missing !== undefined) throw new RangeError(`${fn}: the high-score period (weeks ${ws.join(", ")}) needs week ${missing}, which isn't in ${listedWeeks}`);
    const drawn = drawnIndexes(ws, weekIndex);
    if (drawn.length === 0) throw new RangeError(`${fn}: the high-score period (weeks ${ws.join(", ")}) has no week in ${listedWeeks}`);
    hsLists.push(drawn);
  }
  const hsStart = new Int32Array(hsLists.length + 1);
  hsLists.forEach((l, q) => {
    hsStart[q + 1] = (hsStart[q] as number) + l.length;
  });
  const hsWeek = Int32Array.from(hsLists.flat());
  const thirdRule = setup.thirdPlace ?? "game";
  if (thirdRule !== "game" && thirdRule !== "bySeed" && thirdRule !== "split") throw new RangeError(`${fn}: thirdPlace must be "game", "bySeed" or "split" (got ${String(thirdRule)})`);

  // Playoff bracket.
  const N = Math.min(T, Math.max(0, Number.isFinite(setup.playoffTeams) ? Math.floor(setup.playoffTeams) : 0));
  let B = N >= 1 ? 1 : 0;
  while (B < N) B *= 2;
  let R = 0;
  for (let x = B; x > 1; x >>= 1) R++;
  const byes = N >= 2 ? B - N : 0;
  const bracketPlayed = N >= 2 && setup.rounds.length >= R;
  // The rounds the bracket uses: each week drawn or over (a round with no drawn week is over, and its
  // games need results).
  const bracketRounds = setup.rounds.slice(0, R);
  bracketRounds.forEach((r, i) => {
    if (r.weeks.length === 0) throw new RangeError(`${fn}: playoff round ${i + 1} has no weeks`);
    const missing = missingWeek(r.weeks, weekIndex, firstDrawn);
    if (missing !== undefined) throw new RangeError(`${fn}: playoff round ${i + 1} (weeks ${r.weeks.join(", ")}) needs week ${missing}, which isn't in ${listedWeeks}`);
  });
  const seedSlots = Int32Array.from(N >= 2 ? bracketOrder(B) : []);
  const resultWinner = new Int32Array(T * T).fill(-1);
  for (const r of setup.playoffResults) {
    const a = teamIndex(r.a, T, "a playoff result");
    const b = teamIndex(r.b, T, "a playoff result");
    if (a === b || (r.winner !== a && r.winner !== b)) throw new RangeError(`${fn}: playoff result ${a}–${b} has winner ${r.winner}`);
    resultWinner[a * T + b] = r.winner;
    resultWinner[b * T + a] = r.winner;
  }
  const roundWeek = bracketRounds.map((r) => Int32Array.from(drawnIndexes(r.weeks, weekIndex)));

  // Exact title odds (the file header's "Title odds"): when the bracket is played and its rounds' drawn weeks are
  // independent of each other and of the regular season. A re-seeding bracket draws its rounds before the first one
  // with at most exactReseedTeams teams left.
  const regularRead = new Uint8Array(W);
  for (const idx of [gameWeek, medianWeek, pfWeek, hsWeek]) for (const k of idx) regularRead[k] = 1;
  const roundRead = new Uint8Array(W);
  let independent = true;
  for (const rw of roundWeek)
    for (const k of rw) {
      if (regularRead[k] === 1 || roundRead[k] === 1) independent = false;
      roundRead[k] = 1;
    }
  const exact = (opts.titleMode ?? "exact") === "exact" && bracketPlayed && independent;
  // Re-seeding: exact from the first round with at most `cap` teams left (2, 4 or 8: the rounds playBracket enumerates).
  const capOption = opts.exactReseedTeams ?? config.simulation.exactReseedTeams;
  const capWhole = Number.isFinite(capOption) ? Math.floor(capOption) : 2;
  const cap = capWhole >= 8 ? 8 : capWhole >= 4 ? 4 : 2;
  let exactFrom = 0;
  if (exact && setup.reseed) while (B >> exactFrom > cap) exactFrom++;
  const scoreCells: number[] = [];
  if (!exact) scoreCells.push(0, WT);
  else {
    for (let r = 0; r < exactFrom; r++) for (const k of roundWeek[r] as Int32Array) regularRead[k] = 1;
    for (let k = 0; k < W; k++) {
      if (regularRead[k] !== 1) continue;
      if (scoreCells.length > 0 && scoreCells.at(-1) === k * T) scoreCells[scoreCells.length - 1] = (k + 1) * T;
      else scoreCells.push(k * T, (k + 1) * T);
    }
  }
  const winP = new Float64Array(exact ? R * T * T : 0);
  if (exact) {
    const mu = new Float64Array(T);
    const v = new Float64Array(T);
    for (let r = 0; r < R; r++) {
      // Each team's sum of means and variances over the round's drawn weeks, in the drawn game's order.
      const rw = roundWeek[r] as Int32Array;
      mu.fill(0);
      v.fill(0);
      for (let k = 0; k < rw.length; k++) {
        const o = (rw[k] as number) * T;
        for (let t = 0; t < T; t++) {
          mu[t]! += meanF[o + t] as number;
          v[t]! += (sdF[o + t] as number) ** 2;
        }
      }
      for (let a = 0; a < T; a++)
        for (let b = a + 1; b < T; b++) {
          const known = resultWinner[a * T + b] as number;
          let w: number;
          if (known >= 0) w = known === a ? 1 : 0;
          else if (rw.length === 0) w = Number.NaN;
          else {
            const variance = (v[a] as number) + (v[b] as number);
            const d = (mu[a] as number) - (mu[b] as number);
            w = variance > 0 ? normalCdf(d / Math.sqrt(variance)) : (mu[a] as number) > (mu[b] as number) ? 1 : (mu[b] as number) > (mu[a] as number) ? 0 : TIE_BY_SEED;
          }
          winP[(r * T + a) * T + b] = w;
          winP[(r * T + b) * T + a] = w === TIE_BY_SEED || Number.isNaN(w) ? w : 1 - w;
        }
    }
  }

  // ---- The state every sim reads and writes, and the sims.
  const hierarchy = pointsOnly ? POINTS_ONLY_HIERARCHY : HIERARCHY[setup.tiebreaker];
  const st: SimState = {
    T,
    WT,
    pointsOnly,
    z,
    meanF,
    sdF,
    scoreCells: Int32Array.from(scoreCells),
    baseW,
    baseL,
    baseT,
    basePF,
    basePA,
    h2hWinsBase,
    divWinsBase,
    gameA,
    gameB,
    gameSame,
    gameStart,
    gameWeek,
    gameSlot,
    medianWeek,
    medianSlot,
    medianWinners: Math.floor(T / 2),
    pfWeek,
    hierarchy,
    divisionWinnersFirst: setup.divisionWinnersFirst && D >= 2,
    D,
    divOf,
    h2hMeetings,
    divGames,
    N,
    B,
    R,
    byes,
    bracketPlayed,
    reseed: setup.reseed,
    seedSlots,
    resultWinner,
    roundWeek,
    exact,
    exactFrom,
    winP,
    pAlive: new Float64Array(Math.max(B, 1)),
    pNext: new Float64Array(Math.max(B, 1)),
    pairX: new Int32Array(4),
    pairY: new Int32Array(4),
    pairW: new Float64Array(4),
    byeTeam: new Int32Array(4),
    quad: new Int32Array(4),
    score: new Float64Array(WT),
    wins: new Float64Array(T),
    losses: new Float64Array(T),
    ties: new Float64Array(T),
    pf: new Float64Array(T),
    pa: new Float64Array(T),
    h2hWins: new Float64Array(T * T),
    divWins: new Float64Array(T),
    winPct: new Float64Array(T),
    keys: new Float64Array(hierarchy.length * T),
    order: new Int32Array(T),
    scratch: new Int32Array(T),
    isWinner: new Uint8Array(T),
    seedOf: new Int32Array(T),
    slots: new Int32Array(Math.max(B, 1)),
    medianOrder: Int32Array.from({ length: T }, (_, i) => i),
    cPlayoffs: new Float64Array(T),
    cBye: new Float64Array(T),
    cTitle: new Float64Array(T),
    sumW: new Float64Array(T),
    sumL: new Float64Array(T),
    sumT: new Float64Array(T),
    cSeed: new Float64Array(T * T),
    cWeekWin: new Float64Array(S * T),
    cMedianWin: new Float64Array(S * T),
    semiRound: R >= 2 ? R - 2 : -1,
    finalRound: R - 1,
    thirdRule,
    hsStart,
    hsWeek,
    hsScore: new Float64Array(T),
    semiLosers: new Int32Array(3),
    finalLoser: -1,
    thirdUnknown: false,
    pSemi: new Float64Array(Math.max(B, 1)),
    pReach: new Float64Array(Math.max(B, 1)),
    cSecond: new Float64Array(T),
    cThird: new Float64Array(T),
    cHigh: new Float64Array(T),
    cLeader: new Float64Array(T),
  };
  let unknownPlayoffs = false;
  for (let n = 0; n < sims; n++) if (!simulateOne(st, n)) unknownPlayoffs = true;

  // ---- Averages.
  const { cPlayoffs, cBye, cTitle, sumW, sumL, sumT, cSeed, cWeekWin, cMedianWin, cSecond, cThird, cHigh, cLeader } = st;
  const titlesKnown = !unknownPlayoffs && (N <= 1 || bracketPlayed);
  const thirdKnown = titlesKnown && !st.thirdUnknown;
  const teams: SimTeamOdds[] = setup.teams.map((_, t) => ({
    pPlayoffs: (cPlayoffs[t] as number) / sims,
    pBye: unknownPlayoffs ? Number.NaN : (cBye[t] as number) / sims,
    pTitle: titlesKnown ? (cTitle[t] as number) / sims : Number.NaN,
    expWins: (sumW[t] as number) / sims,
    expLosses: (sumL[t] as number) / sims,
    expTies: (sumT[t] as number) / sims,
    seedDist: Array.from({ length: T }, (_, k) => (cSeed[t * T + k] as number) / sims),
    pSecond: titlesKnown ? (cSecond[t] as number) / sims : Number.NaN,
    pThird: thirdKnown ? (cThird[t] as number) / sims : Number.NaN,
    expHighScores: (cHigh[t] as number) / sims,
    pPointsLeader: (cLeader[t] as number) / sims,
  }));
  const weekly = weeklyWeeks.map((week, s) => ({
    week,
    pWin: Float64Array.from({ length: T }, (_, t) => (hasGame[s * T + t] === 1 ? (cWeekWin[s * T + t] as number) / sims : Number.NaN)),
    pMedianWin: isMedianSlot[s] === 1 ? Float64Array.from({ length: T }, (_, t) => (cMedianWin[s * T + t] as number) / sims) : null,
  }));
  return { sims, teams, weekly, playoffsKnown: !unknownPlayoffs, thirdKnown };
}
