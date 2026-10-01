/**
 * Season simulator (CLAUDE.md §8; §16 simulation sanity tests; planner reply to Checkpoint 2, "Phase 3
 * reminders"). Pure and deterministic: no I/O, no clock; the only randomness is the common-random-numbers
 * matrix below, drawn from rng.ts. It knows nothing about LeagueSnapshot: the caller builds a SimSetup
 * (records, the remaining schedule as team indexes, and each team's weekly score mean and SD) and reads
 * back playoff, bye and title odds, expected records, seed distributions and each remaining week's
 * win chance. Every tunable number arrives through SimSetup and SimOptions (config.simulation holds the
 * defaults: finalSims, screeningSims, seed).
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
 *   the schedule or the other sims, and the first k sims of an n-sim matrix are the k-sim matrix: a
 *   1,000-sim screening run can read the first 1,000 sims of the 5,000-sim final matrix.
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
 * Outputs are averages over the sims. weekly[k].pWin[t] = team t's wins in its game starting that week
 * (a multi-week game counts in its first drawn week) / sims, NaN without a game; pMedianWin likewise for
 * median weeks, null for other weeks.
 *
 * Performance: simulateSeason validates the setup and flattens it into typed arrays once (SimState);
 * each sim is simulateOne, which allocates nothing (the standings sort is an insertion sort over the
 * tied group with keys in a preallocated buffer; median weeks re-sort the previous week's order). In
 * Node on a Parker-sized league (10 teams, 11 regular-season weeks, 3 playoff rounds), once the JIT has
 * warmed up: the 5,000-sim matrix about 17 ms, 5,000 sims about 12 ms, 1,000 sims about 2.5 ms; the
 * first two calls in a fresh process take about 20 ms longer while simulateOne is compiled. sim.test.ts
 * prints the timings.
 */
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
   * (consolation games) are ignored.
   */
  playoffResults: SimPlayoffResult[];
}

export interface SimOptions {
  sims: number;
  seed: number;
  /** The shared CRN matrix; when absent, simNormals(seed, sims, weeks, teams) is drawn. */
  normals?: SimNormals;
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
}

export interface SimResult {
  sims: number;
  /** Same order as SimSetup.teams. */
  teams: SimTeamOdds[];
  /** Per remaining regular-season week (ascending): per team P(win that week's game), NaN without a game; and P(win the median game) when medianGame. */
  weekly: { week: number; pWin: Float64Array; pMedianWin: Float64Array | null }[];
  /** False when a playoff round already played has no result (title/bye odds then unknown). */
  playoffsKnown: boolean;
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
 * streamFor(seed, SEASON_STREAM, n) by Box–Muller (see the file header for the fill order).
 */
export function simNormals(seed: number, sims: number, weeks: number, teams: number): SimNormals {
  wholeCount("simNormals", "sims", sims, 0);
  wholeCount("simNormals", "weeks", weeks, 0);
  wholeCount("simNormals", "teams", teams, 0);
  const per = weeks * teams;
  const z = new Float64Array(sims * per);
  const keySeed = mix32(seed, hash32(SEASON_STREAM));
  for (let n = 0; n < sims; n++) {
    const rand = mulberry32(mix32(keySeed, n)); // = streamFor(seed, SEASON_STREAM, n)
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
 * Sim n: its scores, the rest of the regular season, the final standings and the playoffs, added to
 * st's accumulators. Allocates nothing. Returns false when the playoffs can't be known (a round already
 * played has no result for one of its games); the title isn't counted then.
 */
function simulateOne(st: SimState, n: number): boolean {
  const { T, WT, z, meanF, sdF, score, wins, losses, ties, pf, pa, h2hWins, divWins } = st;
  const zBase = n * WT;
  for (let k = 0; k < WT; k++) score[k] = (meanF[k] as number) + (sdF[k] as number) * (z[zBase + k] as number);
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
  const { N, B, R, byes, reseed, seedSlots, slots, cPlayoffs, cBye, cTitle } = st;
  for (let k = 0; k < N; k++) cPlayoffs[order[k] as number]! += 1;
  for (let k = 0; k < byes; k++) cBye[order[k] as number]! += 1;
  if (N <= 1) {
    if (T > 0) cTitle[order[0] as number]! += 1;
    return true;
  }
  if (!st.bracketPlayed) return true;
  for (let i = 0; i < B; i++) {
    const seed = seedSlots[i] as number;
    slots[i] = seed <= N ? (order[seed - 1] as number) : -1;
  }
  let live = B;
  for (let r = 0; r < R; r++) {
    const half = live >> 1;
    const bestVsWorst = reseed && r > 0;
    if (bestVsWorst) {
      // Re-seed the survivors: sort by seed, best first.
      for (let i = 1; i < live; i++) {
        const a = slots[i] as number;
        let j = i - 1;
        while (j >= 0 && (seedOf[slots[j] as number] as number) > (seedOf[a] as number)) {
          slots[j + 1] = slots[j] as number;
          j--;
        }
        slots[j + 1] = a;
      }
    }
    for (let i = 0; i < half; i++) {
      const x = (bestVsWorst ? slots[i] : slots[2 * i]) as number;
      const y = (bestVsWorst ? slots[live - 1 - i] : slots[2 * i + 1]) as number;
      const winner = x < 0 ? y : y < 0 ? x : playoffGame(st, x, y, r);
      if (winner < 0) return false;
      slots[i] = winner;
    }
    live = half;
  }
  cTitle[slots[0] as number]! += 1;
  return true;
}

/**
 * Today's standings (TeamOdds.rank): team indexes, seed 1 first, by the league's rules (the file header's
 * "Standings": the same hierarchy, and division winners first when the league seeds them so) from the
 * current records and the played games alone. It is the simulator's own final-standings code on the
 * setup with nothing left to play (no games, median weeks, draws or playoffs), so head-to-head meetings
 * count the played games only, and the order can't drift from the one the simulations use.
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

  // ---- The state every sim reads and writes, and the sims.
  const hierarchy = pointsOnly ? POINTS_ONLY_HIERARCHY : HIERARCHY[setup.tiebreaker];
  const st: SimState = {
    T,
    WT,
    pointsOnly,
    z,
    meanF,
    sdF,
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
    roundWeek: bracketRounds.map((r) => Int32Array.from(drawnIndexes(r.weeks, weekIndex))),
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
  };
  let unknownPlayoffs = false;
  for (let n = 0; n < sims; n++) if (!simulateOne(st, n)) unknownPlayoffs = true;

  // ---- Averages.
  const { cPlayoffs, cBye, cTitle, sumW, sumL, sumT, cSeed, cWeekWin, cMedianWin } = st;
  const titlesKnown = !unknownPlayoffs && (N <= 1 || bracketPlayed);
  const teams: SimTeamOdds[] = setup.teams.map((_, t) => ({
    pPlayoffs: (cPlayoffs[t] as number) / sims,
    pBye: unknownPlayoffs ? Number.NaN : (cBye[t] as number) / sims,
    pTitle: titlesKnown ? (cTitle[t] as number) / sims : Number.NaN,
    expWins: (sumW[t] as number) / sims,
    expLosses: (sumL[t] as number) / sims,
    expTies: (sumT[t] as number) / sims,
    seedDist: Array.from({ length: T }, (_, k) => (cSeed[t * T + k] as number) / sims),
  }));
  const weekly = weeklyWeeks.map((week, s) => ({
    week,
    pWin: Float64Array.from({ length: T }, (_, t) => (hasGame[s * T + t] === 1 ? (cWeekWin[s * T + t] as number) / sims : Number.NaN)),
    pMedianWin: isMedianSlot[s] === 1 ? Float64Array.from({ length: T }, (_, t) => (cMedianWin[s * T + t] as number) / sims) : null,
  }));
  return { sims, teams, weekly, playoffsKnown: !unknownPlayoffs };
}
