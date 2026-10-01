/**
 * Checkpoint numbers for Parker's league (CLAUDE.md §17 "Checkpoint 2 includes" and "Checkpoint 3
 * includes"), computed through the real app code: the ESPN adapter, the model-inputs builder (Sleeper
 * projections and stats, FantasyCalc values, the NFL schedule) and the pure engine (projections,
 * availability, lineups, scenarios, needs, trade chips, market values, the season simulation), exactly as
 * the League page's Web Worker runs it.
 *
 *   npm run league:report                   Parker's ESPN league through the public-link path
 *   npm run league:report -- --team <id>    his team, when the import can't find it (no cookies)
 *   npm run league:report -- --cookies      use the .env.local ESPN cookies (also with USE_ENV_COOKIES=1),
 *                                           so ESPN itself says which team is his
 *
 * Phase 3, the season simulation (§8; planner reply to Checkpoint 2, "Checkpoint 3 must include"):
 * - Standings and playoff odds: today's standings by the league's rules (TeamOdds.rank) with each team's
 *   record, points for, P(playoffs), P(bye), P(title) and expected final record, the Σ checks (Σ P(playoffs)
 *   = playoff teams, Σ P(title) = 1) and the simulation's own notes.
 * - Your remaining schedule (§8 "show each remaining week's risk"): each remaining regular-season game with
 *   both teams' weekly score (the simulator's mean ± SD, summed over a multi-week matchup's weeks still to
 *   play), the win chance, and the active-roster players on bye. Likely starters and the risky-week flag
 *   follow the League page's own rules (src/lib/leagueView.ts: likelyStarters, RISKY_WIN_CHANCE, RISKY_BYES).
 * - Trade Score scale check (§10): the user's weekly score mean + 1, 3 and 6 points in every remaining week
 *   (regular season and playoffs, a week in progress included), σ unchanged, on one common-random-numbers
 *   matrix (config.simulation.finalSims seasons from config.simulation.seed): ΔPO, ΔCH and Δ expected wins,
 *   B = 100 × (0.35 ΔPO + 0.65 ΔCH) (config.benefit.weights; no market term: only lineup points move) and
 *   the Trade Score (config.benefit.bRef), next to the planner's toy league, with the B_ref that would map
 *   this league's +3 to the toy league's 63. Common random numbers compare every row with the baseline
 *   season by season, which takes out the noise of comparing separate runs, but each change is still a
 *   Monte Carlo estimate from finalSims seasons (another seed gives a somewhat different B(+3)). So every
 *   change carries its standard error, by batch means: the run's seasons split into SE_BATCHES batches
 *   (batchRuns), the change computed in each batch alone (batchSe). B_ref gets B(+3)'s error and one
 *   decimal. When title odds are unknown, the reason is given only when the report can confirm it
 *   (titleUnknownReason); otherwise it points to the notes under the standings. Then the same rows from the
 *   team after its best free-agent move (TeamModel.waiver), since §10's B compares rosters after that move,
 *   with the move's own effect and its standard error. The model doesn't keep that roster's
 *   weekly scores, so they're priced with teamValue.rosterScore, the function behind TeamModel.score, on the
 *   projection table rebuilt as the model built it; the report first re-prices the user's current roster
 *   that way and skips these rows unless it reproduces the model's own scores (within float noise).
 * - No-op check (§8 common random numbers; §16): (a) one setup simulated twice, each run drawing its own
 *   matrix from the seed: every number bitwise identical; (b) a second League model built from the same
 *   snapshot and inputs with every roster copied (a trade that changes nothing), simulated with the same
 *   seed: the largest |Δ| in each team's P(playoffs), P(bye), P(title) and expected wins, and in the
 *   simulator's weekly score inputs, which must all be exactly 0.
 * - Simulation runtime: simNormals and simulateSeason at 1,000 and 5,000 seasons (config.simulation
 *   screeningSims and finalSims), and buildLeagueModel with and without the simulation (expected-value
 *   lineups only, and S availability scenarios), each the median of TIMING_RUNS runs after TIMING_WARMUPS
 *   warm-up.
 *
 * Everything after the network is buildReport (pure but for the clock and the model builds it times), which
 * scripts/league-report.test.ts runs offline on Parker's committed sanitized fixture with synthetic inputs.
 *
 * Privacy (CLAUDE.md §0.5, §0.6): team, owner and league names are replaced with placeholders before
 * anything is rendered, and the output is scrubbed with the .env.local secrets and the redaction map.
 * NFL player names are public. Output: reports/league-report.md and a short console summary.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { importEspnLeagueForModel } from "@/adapters/espn";
import type { ImportDeps } from "@/adapters/types";
import { loadPlayerIdResolver } from "@/data";
import { config } from "@/engine/config";
import type { ModelInputs } from "@/engine/inputs";
import { buildLeagueModel, buildProjectionTable, firstKickoff, teamWeeks } from "@/engine/league";
import type { LeagueModel, PlayerModel, SeasonOdds, TeamOdds, WaiverMove } from "@/engine/leagueModel";
import { prepareLeagueSlots } from "@/engine/lineup";
import { fantasyCalcFormatLabel } from "@/engine/market";
import type { LeagueSnapshot, PlayerInfo } from "@/engine/model";
import { buildSimSetup, playoffRounds, seasonOdds, type SeasonModel, type SimSetupResult } from "@/engine/season";
import { simNormals, simulateSeason, type SimNormals, type SimResult, type SimSetup } from "@/engine/sim";
import { evLineups, rosValue, rosterScore, scenarioLineups } from "@/engine/teamValue";
import { RISKY_BYES, RISKY_WIN_CHANCE, SEASON_OVER_TEXT, likelyStarters } from "@/lib/leagueView";
import { FileCache } from "@/server/cache";
import { createHttpClient } from "@/server/http";
import { buildModelInputs } from "@/server/modelInputs";
import { ROOT, env, loadEnv } from "./lib/env";
import { redactorFromMap } from "./lib/minimize";
import { installConsoleScrubber, registerScrubber, scrubEverything, scrubEverythingExcept } from "./lib/redact";

const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "–");
/** A player whose EV lineup cost is at most this many ROS points is "bench" in the depth example. */
const BENCH_EV_MAX = 2;
const ms = (x: number | undefined) => (x === undefined ? "–" : x >= 1000 ? `${(x / 1000).toFixed(2)} s` : `${Math.round(x)} ms`);
/** Milliseconds with a decimal under 10 ms (the simulator's runs are a few ms). */
const msFine = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "–" : x < 10 ? `${x.toFixed(1)} ms` : ms(x));
/** 5000 → "5,000". */
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
/** A signed number: "+0.0412", "-0.0030". */
const signed = (x: number, d: number) => (Number.isFinite(x) ? `${x < 0 ? "-" : "+"}${Math.abs(x).toFixed(d)}` : "–");

/**
 * A probability in the report: one decimal; "0%" and "100%" only when exact, "<0.1%" and ">99.9%" when it
 * merely rounds there (5,000 seasons resolve 0.02%); "–" when unknown.
 */
export function pct(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "–";
  if (p === 0) return "0%";
  if (p === 1) return "100%";
  if (p < 0.0005) return "<0.1%";
  if (p >= 0.9995) return ">99.9%";
  return `${(100 * p).toFixed(1)}%`;
}

/** Team, owner and league names → placeholders ("Team 3"), before any text is built. */
export function placeholders(s: LeagueSnapshot): LeagueSnapshot {
  return { ...s, name: "League 1", leagueId: "{leagueId}", teams: s.teams.map((t) => ({ ...t, name: `Team ${t.id}`, ownerName: `Owner ${t.id}` })) };
}

/** An NFL player's name: public, so the final scrub keeps it whole (scrubEverythingExcept). */
function playerName(p: PlayerInfo | undefined, id: string): string {
  return p ? p.name : id;
}

function playerLabel(p: PlayerInfo | undefined, id: string): string {
  return p ? `${playerName(p, id)} (${p.pos}${p.nflTeam ? `, ${p.nflTeam}` : ""})` : id;
}

const STATUS_SHORT: Readonly<Record<string, string>> = { ACTIVE: "", PROBABLE: "P", QUESTIONABLE: "Q", DOUBTFUL: "D", OUT: "O", IR: "IR", PUP: "PUP", SUSPENDED: "SUS", NA: "NA" };

function byeText(m: PlayerModel): string {
  const b = m.ros.bye;
  return b.status === "done" ? "bye done" : b.status === "upcoming" ? `bye wk ${b.week}` : "bye ?";
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return Number.NaN;
  return n % 2 ? (s[(n - 1) / 2] as number) : ((s[n / 2 - 1] as number) + (s[n / 2] as number)) / 2;
}

const recordOf = (r: { w: number; l: number; t: number }) => `${r.w}-${r.l}${r.t ? `-${r.t}` : ""}`;

/** A player's pure depth value: his team's ROS points with him minus without him, nobody added (EV and scenario lineups). */
type DepthOf = (teamId: string, playerId: string) => { ev: number; scen: number };

/** Depth values (section "Depth") from the projection table the model used (same scenarios and seed). */
function depthValues(snapshot: LeagueSnapshot, inputs: ModelInputs, model: LeagueModel, now: Date): DepthOf {
  const { table } = buildProjectionTable(snapshot, inputs, { now, scenarios: model.scenarios });
  const slots = prepareLeagueSlots(snapshot.settings);
  // The same week weights the model's lineup costs use (a week already under way counts 0, review SPEC-1).
  const weights = teamWeeks(model, model.inProgressWeek).weights;
  const rosters = new Map(snapshot.teams.map((t) => [t.id, t.roster.filter((id) => table.rows.has(id))]));
  const rosOf = (roster: string[]) => ({ ev: rosValue(evLineups(roster, table, slots).lv, weights), scen: rosValue(scenarioLineups(roster, table, slots).lv, weights) });
  const full = new Map([...rosters].map(([id, r]) => [id, rosOf(r)]));
  return (teamId, playerId) => {
    const roster = rosters.get(teamId) ?? [];
    const with_ = full.get(teamId) ?? { ev: 0, scen: 0 };
    const without = rosOf(roster.filter((id) => id !== playerId));
    return { ev: with_.ev - without.ev, scen: with_.scen - without.scen };
  };
}

// ---------------------------------------------------------------------------------------------
// Phase 3: the season simulation (see the file header)

/** Timed runs per runtime measurement, after TIMING_WARMUPS untimed ones (lead design R1: the median of 5 runs after one warm-up). */
export const TIMING_RUNS = 5;
export const TIMING_WARMUPS = 1;
/** The scale check's lineup gains, points per week in every remaining week (planner reply to Checkpoint 2: +1, +3 and +6). */
export const SCALE_GAINS: readonly number[] = [1, 3, 6];
/**
 * Batches the scale check splits its run into for the Monte Carlo standard errors (batchRuns, batchSe): 20
 * batches of 250 seasons at 5,000. A report-only choice, not a tunable. The standard error's own relative
 * error is about 1 / √(2 × (batches − 1)), 16% at 20.
 */
export const SE_BATCHES = 20;
/** The planner's toy league (CLAUDE.md §10 "Planner's check": 12 teams, 10 weeks left): B and the Trade Score per gain. */
const PLANNER_TOY: Readonly<Record<number, { B: number; score: number }>> = { 1: { B: 1.7, score: 29 }, 3: { B: 5, score: 63 }, 6: { B: 10, score: 86 } };
/** The Trade Score the toy league gives +3 points per week: the scale check reports the B_ref that maps this league's +3 to it. */
const TOY_GAIN = 3;
const TOY_SCORE_AT_GAIN = 63;
/** A re-priced weekly score counts as the model's own when no mean or SD differs by more than this (float noise, not a tunable). */
const REPRODUCED_TOLERANCE = 1e-9;

interface BenefitWeights {
  readonly weights: { readonly playoffs: number; readonly title: number };
  readonly bRef: number;
}

/** §10's B_win in percentage points: 100 × (0.35 ΔPO + 0.65 ΔCH), ΔPO and ΔCH as fractions (config.benefit.weights). */
export function benefitWin(dPO: number, dCH: number, cfg: BenefitWeights = config.benefit): number {
  return 100 * (cfg.weights.playoffs * dPO + cfg.weights.title * dCH);
}

/** The Trade Score ("Helps you", §10): round(100 × (1 − e^(−B / B_ref))) when B > 0; null (hidden by default) otherwise. */
export function tradeScore(B: number, bRef: number = config.benefit.bRef): number | null {
  return Number.isFinite(B) && B > 0 ? Math.round(100 * (1 - Math.exp(-B / bRef))) : null;
}

/** The B_ref that maps benefit B to the given Trade Score: −B / ln(1 − score / 100) (for 63: −B / ln 0.37); null when B ≤ 0. */
export function bRefFor(B: number, score: number): number | null {
  return Number.isFinite(B) && B > 0 && score > 0 && score < 100 ? -B / Math.log(1 - score / 100) : null;
}

/** A team's weekly score distribution per model week (TeamModel.score). */
export interface WeeklyScores {
  mean: number[];
  sd: number[];
}

/** The largest |Δ| between two weekly scores, means and SDs (Infinity when their lengths differ). */
function scoreDiff(a: WeeklyScores, b: WeeklyScores): number {
  if (a.mean.length !== b.mean.length || a.sd.length !== b.sd.length) return Number.POSITIVE_INFINITY;
  let d = 0;
  a.mean.forEach((x, i) => (d = Math.max(d, Math.abs(x - (b.mean[i] as number)))));
  a.sd.forEach((x, i) => (d = Math.max(d, Math.abs(x - (b.sd[i] as number)))));
  return d;
}

/** The League model as the simulator reads it (a SeasonModel), with one team's weekly scores replaced. */
function withScore(model: SeasonModel, teamId: string, score: WeeklyScores): SeasonModel {
  return { ...model, teams: model.teams.map((t) => (t.id === teamId ? { id: t.id, score } : t)) };
}

const plus = (score: WeeklyScores, x: number): WeeklyScores => ({ mean: score.mean.map((m) => m + x), sd: [...score.sd] });

const oddsOf = (odds: SeasonOdds | null, teamId: string): TeamOdds | null => odds?.teams.find((t) => t.teamId === teamId) ?? null;

/** The common-random-numbers run every scale-check row shares: sims, seed and the one matrix. */
export interface SharedRun {
  sims: number;
  seed: number;
  normals: SimNormals;
}

/**
 * The run's seasons in `batches` batches of b = ⌊sims / batches⌋ consecutive seasons, each a view into the
 * same matrix (batch j = seasons j·b … j·b + b − 1; a remainder of fewer than `batches` seasons is left
 * out). A season's outcome depends only on its own row of the matrix (sim.ts), so a batch replays its
 * seasons of the full run exactly. A number's batch values therefore average to its value over those
 * seasons, and their spread measures its Monte Carlo error (batchSe). Fewer than 2 batches possible → [].
 */
export function batchRuns(run: SharedRun, batches: number = SE_BATCHES): SharedRun[] {
  const k = Math.min(Math.floor(batches), Math.floor(run.sims));
  if (!(k >= 2)) return [];
  const b = Math.floor(run.sims / k);
  const { weeks, teams, z } = run.normals;
  const per = b * weeks * teams;
  return Array.from({ length: k }, (_, j) => ({ sims: b, seed: run.seed, normals: { sims: b, weeks, teams, z: z.subarray(j * per, (j + 1) * per) } }));
}

/**
 * The Monte Carlo standard error of a run's number from its batch values (batch means): the batches'
 * sample SD (n − 1) × √(batchSims / sims). The factor is 1 / √batches when the batches cover the whole run.
 * It holds with a remainder too, because the SD of a b-season batch estimates σ / √b. NaN with fewer than 2
 * batches, or when a batch's value is unknown (NaN).
 */
export function batchSe(values: readonly number[], batchSims: number, sims: number): number {
  const k = values.length;
  if (k < 2 || !(batchSims > 0) || !(sims > 0)) return Number.NaN;
  const mean = values.reduce((s, x) => s + x, 0) / k;
  const variance = values.reduce((s, x) => s + (x - mean) ** 2, 0) / (k - 1);
  return Math.sqrt((variance * batchSims) / sims);
}

/** The team's odds in one simulated run: P(playoffs), P(title) (null = unknown) and expected wins. */
export type MyOdds = Pick<TeamOdds, "pPlayoffs" | "pTitle" | "expWins">;

/** §10's changes from one run's odds to another's: ΔPO and ΔCH as fractions, Δ expected wins, and B. */
export interface Deltas {
  dPO: number;
  dCH: number;
  dEW: number;
  B: number;
}

const UNKNOWN_ODDS: MyOdds = { pPlayoffs: Number.NaN, pTitle: null, expWins: Number.NaN };

/** The changes from `from` to `to`: ΔCH (and so B) is NaN when either title chance is unknown. */
function deltas(from: MyOdds, to: MyOdds, cfg: BenefitWeights): Deltas {
  const dPO = to.pPlayoffs - from.pPlayoffs;
  const dCH = to.pTitle !== null && from.pTitle !== null ? to.pTitle - from.pTitle : Number.NaN;
  return { dPO, dCH, dEW: to.expWins - from.expWins, B: benefitWin(dPO, dCH, cfg) };
}

/** Each change's Monte Carlo standard error from its values in the batches (batchSe). */
function deltasSe(parts: readonly Deltas[], batchSims: number, sims: number): Deltas {
  const se = (k: keyof Deltas) => batchSe(parts.map((p) => p[k]), batchSims, sims);
  return { dPO: se("dPO"), dCH: se("dCH"), dEW: se("dEW"), B: se("B") };
}

export interface ScaleRow extends Deltas {
  /** Points per week added to the weekly score mean in every remaining week. */
  gain: number;
  score: number | null;
  /** Each change's Monte Carlo standard error (batch means: batchRuns, batchSe); NaN when it can't be estimated. */
  se: Deltas;
}

export interface ScaleCheck {
  /** The baseline's odds for the team. */
  base: MyOdds;
  /**
   * The baseline in each batch of the run (batchRuns). Another baseline on the same run takes the standard
   * error of its change from these (waiverScale's move). Empty when title odds are unknown: no row needs them.
   */
  baseBatches: MyOdds[];
  /** The run's batches (batchRuns): how many, and seasons in each (0 and 0 when the run is too short to split). */
  batches: number;
  batchSims: number;
  /** One row per gain; null when title odds are unknown (B needs ΔCH). */
  rows: ScaleRow[] | null;
  /** Why title odds are unknown, when the report can confirm it (titleUnknownReason); null otherwise. */
  titleUnknown: string | null;
  /** The B_ref that would map this league's +3 to the toy league's 63; null without a +3 row or when its B ≤ 0. */
  bRefAtToyGain: number | null;
  /** Its Monte Carlo standard error: B(+3)'s, scaled by the same constant (−1 / ln 0.37); null with B_ref, NaN when unknown. */
  bRefSe: number | null;
}

/** Playoff rounds a bracket of `teams` needs: log2 of the next power of two (0 for fewer than 2 teams). */
function roundsNeeded(teams: number): number {
  let rounds = 0;
  for (let slots = 1; slots < teams; slots *= 2) rounds++;
  return rounds;
}

/**
 * Why title odds are unknown (TeamOdds.pTitle null), for the scale check. season.ts leaves them unknown in
 * two cases, and the reason is given only when the setup shows it:
 * - A playoff game already played has no result we can use: SeasonOdds.playoffsKnown is false.
 * - The league lists fewer playoff rounds than its bracket needs: season.ts's own playoffRounds, against
 *   the rounds a bracket of SeasonOdds.playoffTeams teams needs.
 * Null when title odds are known, or when neither case holds. The report then points to the notes under the
 * standings (SeasonOdds.notes), which say why.
 */
export function titleUnknownReason(snapshot: LeagueSnapshot, odds: SeasonOdds, mine: MyOdds): string | null {
  if (mine.pTitle !== null) return null;
  if (!odds.playoffsKnown) return "a playoff game already played has no result we can read or match to the bracket";
  const N = odds.playoffTeams;
  return N >= 2 && playoffRounds(snapshot.settings).length < roundsNeeded(N) ? `the league's playoff schedule has fewer rounds than a bracket of ${N} teams needs` : null;
}

/**
 * The Trade Score scale check (the file header) for one team from `base` (its weekly scores). The season is
 * simulated with base, then with base + gain in every model week, all on `run`'s matrix. Each gain is then
 * simulated again in every batch of `batches` (batchRuns) for its standard errors. Null when the season
 * can't be simulated.
 */
export function scaleCheck(snapshot: LeagueSnapshot, model: SeasonModel, teamId: string, base: WeeklyScores, run: SharedRun, gains: readonly number[] = SCALE_GAINS, cfg: BenefitWeights = config.benefit, batches: number = SE_BATCHES): ScaleCheck | null {
  const simulate = (score: WeeklyScores, r: SharedRun) => seasonOdds(snapshot, withScore(model, teamId, score), { sims: r.sims, seed: r.seed, normals: r.normals });
  const mine = (odds: SeasonOdds | null): MyOdds | null => {
    const o = oddsOf(odds, teamId);
    return o ? { pPlayoffs: o.pPlayoffs, pTitle: o.pTitle, expWins: o.expWins } : null;
  };
  const baseOdds = simulate(base, run);
  const b = mine(baseOdds);
  if (!baseOdds || !b) return null;
  const parts = batchRuns(run, batches);
  const batchSims = parts[0]?.sims ?? 0;
  const inBatches = (score: WeeklyScores): MyOdds[] => parts.map((p) => mine(simulate(score, p)) ?? UNKNOWN_ODDS);
  const known = b.pTitle !== null;
  const baseBatches = known ? inBatches(base) : [];
  const rows: ScaleRow[] | null = !known
    ? null
    : gains.map((gain) => {
        const score = plus(base, gain);
        const d = deltas(b, mine(simulate(score, run)) ?? UNKNOWN_ODDS, cfg);
        // The same change in each batch, against the baseline's same seasons: the standard error.
        const se = deltasSe(inBatches(score).map((o, j) => deltas(baseBatches[j] as MyOdds, o, cfg)), batchSims, run.sims);
        return { gain, ...d, score: tradeScore(d.B, cfg.bRef), se };
      });
  const toy = rows?.find((r) => r.gain === TOY_GAIN);
  const bRef = toy ? bRefFor(toy.B, TOY_SCORE_AT_GAIN) : null;
  return {
    base: b,
    baseBatches,
    batches: parts.length,
    batchSims,
    rows,
    titleUnknown: titleUnknownReason(snapshot, baseOdds, b),
    bRefAtToyGain: bRef,
    // B_ref = B(+3) × (−1 / ln 0.37), so its standard error is B(+3)'s times the same constant (bRef / B).
    bRefSe: toy && bRef !== null ? toy.se.B * (bRef / toy.B) : null,
  };
}

/**
 * Weekly scores for any active roster, priced outside the model by TeamModel.score's own rule
 * (teamValue.rosterScore: scenario lineups and the law of total variance when the model ran scenarios,
 * else expected-value lineups) on the projection table rebuilt as the model built it (buildProjectionTable at
 * `now`, the model's scenario count and the default seed). A week in progress takes its first week from the
 * table as it stood 1 ms before that week's first kickoff, as the model's preKickoffTable does; built here
 * with the free agents, which a free-agent move needs (a player's row doesn't depend on who else is in it).
 */
export function rosterScorer(snapshot: LeagueSnapshot, inputs: ModelInputs, model: LeagueModel, now: Date): (roster: readonly string[]) => WeeklyScores {
  const { table } = buildProjectionTable(snapshot, inputs, { now, scenarios: model.scenarios });
  const slots = prepareLeagueSlots(snapshot.settings);
  const first = model.inProgressWeek !== null && model.weeks.length > 0 ? firstKickoff(inputs.nfl, model.inProgressWeek) : null;
  const pre = first === null ? null : buildProjectionTable(snapshot, inputs, { now: new Date(first - 1), scenarios: model.scenarios }).table;
  return (roster) => {
    const score = rosterScore(roster, table, slots);
    if (pre && score.mean.length > 0) {
      const before = rosterScore(roster, pre, slots, 1);
      score.mean[0] = before.mean[0] as number;
      score.sd[0] = before.sd[0] as number;
    }
    return score;
  };
}

export interface WaiverScale {
  waiver: WaiverMove;
  /** The largest |Δ| between the model's weekly scores for the current roster and the same scores re-priced by rosterScorer. */
  reproduced: number;
  /** ROS(T_V) from its re-priced weekly scores minus (the model's ROS(T) + the move's gain): float noise when the two agree. */
  rosDiff: number;
  /** The move alone: T_V's odds against the current roster's, with standard errors from both baselines' shared batches (null when title odds are unknown). */
  move: Omit<ScaleRow, "gain"> | null;
  check: ScaleCheck;
}

/**
 * The scale check from my team after its best free-agent move (T_V = TeamModel.waiver's roster): §10's B
 * compares rosters after that move. `current` is the scale check from the roster as it is (its baseline
 * gives the move's own effect). Skipped, with the reason, when there's no move, or when rosterScorer
 * doesn't reproduce the model's weekly scores for the current roster.
 */
export function waiverScale(snapshot: LeagueSnapshot, inputs: ModelInputs, model: LeagueModel, now: Date, run: SharedRun, current: ScaleCheck, cfg: BenefitWeights = config.benefit): WaiverScale | { skipped: string } {
  const me = model.myTeamId;
  const team = snapshot.teams.find((t) => t.id === me);
  const tm = model.teams.find((t) => t.id === me);
  if (!me || !team || !tm) return { skipped: "your team isn't known." };
  const waiver = tm.waiver;
  if (!waiver) return { skipped: "no free-agent move gains your team lineup points, so the rows above already start from the roster §10 compares." };
  const scoreOf = rosterScorer(snapshot, inputs, model, now);
  const reproduced = scoreDiff(scoreOf(team.roster), tm.score);
  if (!(reproduced <= REPRODUCED_TOLERANCE))
    return { skipped: `the model doesn't keep the weekly scores of that roster, and re-pricing your current roster outside the model didn't reproduce the model's own (largest difference ${reproduced}), so they're left out.` };
  const tv = scoreOf([...team.roster.filter((id) => id !== waiver.drop), waiver.add]);
  const weights = teamWeeks(model, model.inProgressWeek).weights;
  const rosDiff = rosValue(tv.mean, weights) - ((tm.scen?.ros ?? tm.ev.ros) + (waiver.gainScen ?? waiver.gainEv));
  const check = scaleCheck(snapshot, model, me, tv, run, SCALE_GAINS, cfg);
  if (!check) return { skipped: "the season couldn't be simulated from that roster." };
  let move: WaiverScale["move"] = null;
  if (check.base.pTitle !== null && current.base.pTitle !== null) {
    const d = deltas(current.base, check.base, cfg);
    // Both baselines ran on the same batches of the same run, so the move's change pairs up batch by batch.
    const paired = check.batchSims === current.batchSims && check.baseBatches.length === current.baseBatches.length;
    const parts = paired ? check.baseBatches.map((o, j) => deltas(current.baseBatches[j] as MyOdds, o, cfg)) : [];
    move = { ...d, score: tradeScore(d.B, cfg.bRef), se: deltasSe(parts, check.batchSims, run.sims) };
  }
  return { waiver, reproduced, rosDiff, move, check };
}

export interface ScheduleRow {
  /** The week the simulation lists the game under (its first week still to play), and its weeks still to play. */
  week: number;
  weeks: number[];
  /** null = my fantasy bye week (no game). */
  opponentId: string | null;
  /** TeamModel.score summed over those weeks: means add, SDs add in quadrature (each week is drawn independently). */
  mine: { mean: number; sd: number };
  theirs: { mean: number; sd: number } | null;
  pWin: number | null;
  pMedianWin: number | null;
  /** My active-roster players whose NFL team is on bye in one of those weeks: likely starters first (lineup order), then by ROS points. */
  byes: { id: string; starter: boolean }[];
  /** Why the League page flags the week risky (empty = not risky). */
  risk: string[];
  /**
   * The week in progress: live scores aren't read, so its games are simulated as if none had started, with
   * today's rosters and injury news (season.ts weekUnderWayNote).
   */
  underWay: boolean;
}

/**
 * My remaining regular-season games (§8 "show each remaining week's risk"): one row per game of mine in
 * SeasonOdds.weekly, over the weeks the simulator sums (the setup's game); likely starters and the risky-week
 * rule are the League page's (src/lib/leagueView.ts): a win chance under RISKY_WIN_CHANCE as the page prints
 * it (whole percents; head-to-head leagues), or RISKY_BYES or more likely starters on bye in a week that
 * counts (a game, a median game, or any week of a points-only league). Null without my team.
 */
export function remainingSchedule(snapshot: LeagueSnapshot, model: LeagueModel, odds: SeasonOdds, built: SimSetupResult): ScheduleRow[] | null {
  const me = model.myTeamId;
  const team = snapshot.teams.find((t) => t.id === me);
  if (!me || !team) return null;
  const mi = built.teamIds.indexOf(me);
  const drawn = new Set(built.setup.weeks);
  const weekIndex = new Map(model.weeks.map((w, i) => [w, i]));
  const scores = new Map(model.teams.map((t) => [t.id, t.score]));
  const total = (teamId: string, weeks: readonly number[]) => {
    const s = scores.get(teamId);
    let mean = 0;
    let variance = 0;
    for (const w of weeks) {
      const i = weekIndex.get(w);
      if (!s || i === undefined) continue;
      mean += s.mean[i] ?? 0;
      variance += (s.sd[i] ?? 0) ** 2;
    }
    return { mean, sd: Math.sqrt(variance) };
  };
  const starters = likelyStarters(snapshot, model, me);
  const starterRank = new Map(starters.map((id, k) => [id, k]));
  const pointsOnly = snapshot.settings.pointsOnly;
  const riskyPct = Math.round(RISKY_WIN_CHANCE * 100);
  const rows: ScheduleRow[] = [];
  for (const wk of odds.weekly) {
    const game = wk.games.find((g) => g.teamId === me);
    if (!game) continue;
    const sim = built.setup.games.find((g) => (g.a === mi || g.b === mi) && g.weeks.find((w) => drawn.has(w)) === wk.week);
    const weeks = sim ? sim.weeks.filter((w) => drawn.has(w)) : [wk.week];
    const byes = team.roster
      .filter((id) => {
        const bye = model.players[id]?.ros.bye;
        return bye?.status === "upcoming" && bye.week !== undefined && weeks.includes(bye.week);
      })
      .map((id) => ({ id, starter: starterRank.has(id) }))
      .sort((a, b) => (starterRank.get(a.id) ?? Number.POSITIVE_INFINITY) - (starterRank.get(b.id) ?? Number.POSITIVE_INFINITY) || (model.players[b.id]?.ros.total ?? 0) - (model.players[a.id]?.ros.total ?? 0));
    const off = byes.filter((b) => b.starter).length;
    const winPct = game.pWin === null || !Number.isFinite(game.pWin) ? null : Math.round(game.pWin * 100);
    const low = !pointsOnly && winPct !== null && winPct < riskyPct;
    const counts = game.opponentId !== null || game.pMedianWin !== null || pointsOnly;
    const many = counts && off >= RISKY_BYES;
    rows.push({
      week: wk.week,
      weeks,
      opponentId: game.opponentId,
      mine: total(me, weeks),
      theirs: game.opponentId === null ? null : total(game.opponentId, weeks),
      pWin: game.pWin,
      pMedianWin: game.pMedianWin,
      byes,
      risk: [...(many ? [`${off} likely starters on bye`] : []), ...(low ? [`under ${riskyPct}% to win`] : [])],
      underWay: model.inProgressWeek !== null && weeks.includes(model.inProgressWeek),
    });
  }
  return rows;
}

export interface NoOpCheck {
  /** (a) One setup simulated twice, each run drawing its own matrix from the seed: numbers compared bitwise, and how many differ. */
  sameSetup: { sims: number; compared: number; differing: number };
  /**
   * (b) A second League model from the same snapshot and inputs (every roster copied): the largest |Δ| per
   * measure over the teams, "score" over every team's weekly score means and SDs, and `nulls` = odds known in
   * one model and not the other. Null when either model has no odds.
   */
  rebuilt: { pPlayoffs: number; pBye: number; pTitle: number; expWins: number; score: number; nulls: number } | null;
}

/** Every number of two simulation results compared bitwise (Object.is): how many were compared and how many differ. */
function compareSims(a: SimResult, b: SimResult): { compared: number; differing: number } {
  let compared = 0;
  let differing = 0;
  const same = (x: number, y: number | undefined) => {
    compared++;
    if (y === undefined || !Object.is(x, y)) differing++;
  };
  same(a.sims, b.sims);
  same(Number(a.playoffsKnown), Number(b.playoffsKnown));
  if (a.teams.length !== b.teams.length || a.weekly.length !== b.weekly.length) differing++;
  a.teams.forEach((t, i) => {
    const u = b.teams[i];
    for (const k of ["pPlayoffs", "pBye", "pTitle", "expWins", "expLosses", "expTies"] as const) same(t[k], u?.[k]);
    t.seedDist.forEach((x, k) => same(x, u?.seedDist[k]));
  });
  a.weekly.forEach((w, i) => {
    const v = b.weekly[i];
    same(w.week, v?.week);
    w.pWin.forEach((x, k) => same(x, v?.pWin[k]));
    if ((w.pMedianWin === null) !== ((v?.pMedianWin ?? null) === null)) differing++;
    w.pMedianWin?.forEach((x, k) => same(x, v?.pMedianWin?.[k]));
  });
  return { compared, differing };
}

/** (b) of the no-op check: the largest |Δ| per measure between two League models' odds and weekly scores. */
function oddsDelta(a: LeagueModel, b: LeagueModel): NoOpCheck["rebuilt"] {
  const oa = a.odds;
  const ob = b.odds;
  if (!oa || !ob) return null;
  const out = { pPlayoffs: 0, pBye: 0, pTitle: 0, expWins: 0, score: 0, nulls: 0 };
  const diff = (x: number | null, y: number | null): number => {
    if (x === null || y === null) {
      if (x !== y) out.nulls++;
      return 0;
    }
    return Math.abs(x - y);
  };
  for (const t of oa.teams) {
    const u = ob.teams.find((x) => x.teamId === t.teamId);
    if (!u) {
      out.nulls++;
      continue;
    }
    out.pPlayoffs = Math.max(out.pPlayoffs, diff(t.pPlayoffs, u.pPlayoffs));
    out.pBye = Math.max(out.pBye, diff(t.pBye, u.pBye));
    out.pTitle = Math.max(out.pTitle, diff(t.pTitle, u.pTitle));
    out.expWins = Math.max(out.expWins, diff(t.expWins, u.expWins));
  }
  for (const t of a.teams) {
    const u = b.teams.find((x) => x.id === t.id);
    out.score = Math.max(out.score, u ? scoreDiff(t.score, u.score) : Number.POSITIVE_INFINITY);
  }
  return out;
}

/** The no-op check (the file header): (a) on the model's own setup; (b) from a second model built like the first, every roster copied. */
export function noOpCheck(snapshot: LeagueSnapshot, inputs: ModelInputs, model: LeagueModel, built: SimSetupResult, now: Date): NoOpCheck {
  const sims = model.odds?.sims ?? config.simulation.finalSims;
  const seed = model.odds?.seed ?? config.simulation.seed;
  const sameSetup = { sims, ...compareSims(simulateSeason(built.setup, { sims, seed }), simulateSeason(built.setup, { sims, seed })) };
  const copied: LeagueSnapshot = { ...snapshot, teams: snapshot.teams.map((t) => ({ ...t, roster: [...t.roster], ir: [...t.ir], taxi: [...t.taxi] })) };
  const again = buildLeagueModel(copied, inputs, { now, scenarios: model.scenarios, sims, simSeed: seed });
  return { sameSetup, rebuilt: oddsDelta(model, again) };
}

export interface SimTiming {
  sims: number;
  /** Medians over the timed runs, ms. */
  normals: number;
  simulate: number;
  total: number;
}

/** simNormals, then simulateSeason on that matrix, at `sims` seasons: medians of `runs` runs after `warmups` untimed ones. */
export function simTiming(setup: SimSetup, seed: number, sims: number, clock: () => number, runs = TIMING_RUNS, warmups = TIMING_WARMUPS): SimTiming {
  const W = setup.weeks.length;
  const T = setup.teams.length;
  const once = (): [number, number, number] => {
    const t0 = clock();
    const normals = simNormals(seed, sims, W, T);
    const t1 = clock();
    simulateSeason(setup, { sims, seed, normals });
    const t2 = clock();
    return [t1 - t0, t2 - t1, t2 - t0];
  };
  for (let i = 0; i < warmups; i++) once();
  const timed = Array.from({ length: Math.max(1, runs) }, once);
  return { sims, normals: median(timed.map((r) => r[0])), simulate: median(timed.map((r) => r[1])), total: median(timed.map((r) => r[2])) };
}

export interface BuildTiming {
  scenarios: number;
  /** Simulated seasons (0 = without the simulation). */
  sims: number;
  /** Median build time, ms, and the median of the build's own "season simulation" stage (null without it). */
  total: number;
  simulation: number | null;
}

/** buildLeagueModel with and without the simulation, EV lineups only and with S scenarios: medians of `runs` builds after `warmups`. */
export function buildTimings(snapshot: LeagueSnapshot, inputs: ModelInputs, now: Date, scenarios: number, clock: () => number, runs = TIMING_RUNS, warmups = TIMING_WARMUPS): BuildTiming[] {
  const variants = [0, scenarios].flatMap((s) => [0, config.simulation.finalSims].map((sims) => ({ scenarios: s, sims })));
  return variants.map((v) => {
    const totals: number[] = [];
    const stage: number[] = [];
    for (let i = 0; i < warmups + Math.max(1, runs); i++) {
      const t0 = clock();
      const m = buildLeagueModel(snapshot, inputs, { now, scenarios: v.scenarios, sims: v.sims, clock });
      const dt = clock() - t0;
      if (i < warmups) continue;
      totals.push(dt);
      const sim = m.timings["season simulation"];
      if (sim !== undefined) stage.push(sim);
    }
    return { ...v, total: median(totals), simulation: stage.length ? median(stage) : null };
  });
}

export interface SeasonReport {
  odds: SeasonOdds | null;
  built: SimSetupResult | null;
  schedule: ScheduleRow[] | null;
  scale: ScaleCheck | null;
  /** The scale check's baseline odds are the model's own (the same matrix): my P(playoffs), P(title) and expected wins bitwise equal. */
  scaleMatchesModel: boolean | null;
  waiver: WaiverScale | { skipped: string } | null;
  noOp: NoOpCheck | null;
  simTimings: SimTiming[];
  buildTimings: BuildTiming[];
}

export interface SeasonReportOptions {
  now: Date;
  clock: () => number;
  /** Timed runs per runtime measurement (default TIMING_RUNS) after `warmups` untimed ones (default TIMING_WARMUPS). */
  runs?: number;
  warmups?: number;
  /** Timed buildLeagueModel runs per variant (default `runs`); 0 skips the build timings. */
  buildRuns?: number;
}

/** Every Phase 3 number in the report (the file header), from the League model buildReport built. */
export function seasonReport(snapshot: LeagueSnapshot, inputs: ModelInputs, model: LeagueModel, opts: SeasonReportOptions): SeasonReport {
  const { now, clock } = opts;
  const runs = opts.runs ?? TIMING_RUNS;
  const warmups = opts.warmups ?? TIMING_WARMUPS;
  const buildRuns = opts.buildRuns ?? runs;
  const odds = model.odds;
  const built = buildSimSetup(snapshot, model);
  const builds = buildRuns > 0 ? buildTimings(snapshot, inputs, now, model.scenarios, clock, buildRuns, warmups) : [];
  if (!odds || !built) return { odds, built, schedule: null, scale: null, scaleMatchesModel: null, waiver: null, noOp: null, simTimings: [], buildTimings: builds };
  const run: SharedRun = { sims: odds.sims, seed: odds.seed, normals: simNormals(odds.seed, odds.sims, built.setup.weeks.length, built.setup.teams.length) };
  const me = model.myTeamId;
  const mine = model.teams.find((t) => t.id === me);
  const scale = me && mine ? scaleCheck(snapshot, model, me, mine.score, run) : null;
  const own = me ? oddsOf(odds, me) : null;
  const scaleMatchesModel = scale && own ? Object.is(scale.base.pPlayoffs, own.pPlayoffs) && Object.is(scale.base.pTitle, own.pTitle) && Object.is(scale.base.expWins, own.expWins) : null;
  return {
    odds,
    built,
    schedule: remainingSchedule(snapshot, model, odds, built),
    scale,
    scaleMatchesModel,
    waiver: scale ? waiverScale(snapshot, inputs, model, now, run, scale) : null,
    noOp: noOpCheck(snapshot, inputs, model, built, now),
    simTimings: [config.simulation.screeningSims, config.simulation.finalSims].map((sims) => simTiming(built.setup, odds.seed, sims, clock, runs, warmups)),
    buildTimings: builds,
  };
}

// ---------------------------------------------------------------------------------------------
// Rendering

/** Expected final record, one decimal: "8.3–5.7" (and ties when the league has any). */
function expectedRecord(t: TeamOdds, ties: boolean): string {
  return `${fmt(t.expWins)}–${fmt(t.expLosses)}${ties ? `–${fmt(t.expTies)}` : ""}`;
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

function renderStandings(L: string[], season: SeasonReport, snapshot: LeagueSnapshot, model: LeagueModel, teamName: (id: string) => string): void {
  L.push("## Standings and playoff odds", "");
  const odds = season.odds;
  if (!odds) {
    const why = model.warnings.filter((w) => /odds/i.test(w));
    L.push(`No odds: ${why.length ? why.join(" ") : "nothing is left to simulate (the season is over)."}`, "");
    return;
  }
  const rows = [...odds.teams].sort((a, b) => a.rank - b.rank);
  const showBye = odds.byes > 0 && rows.some((t) => t.pBye !== null);
  const ties = rows.some((t) => t.expTies > 0) || snapshot.teams.some((t) => t.record.t > 0);
  // A points-only league has no W-L: its standings go by points for, so an expected record would read 0–0.
  const pointsOnly = snapshot.settings.pointsOnly;
  const out = rows.some((t) => t.eliminated) ? ' "(out)" = certainly out of the title race.' : "";
  L.push(
    `Today's standings by the league's rules (rank), with each team's chance to make the playoffs (${odds.playoffTeams} teams)${showBye ? `, earn a first-round bye (the top ${odds.byes})` : ""} and win the title${pointsOnly ? "" : ", and its expected final regular-season record"}: ${thousands(odds.sims)} simulated seasons on the common-random-numbers matrix of seed ${odds.seed}. Weekly scores are drawn around each team's projected lineup (TeamModel.score: scenario lineups when scenarios ran; SD by the law of total variance).${out}`,
    "",
  );
  L.push(`| Rank | Team | Record | PF | Playoffs |${showBye ? " Bye |" : ""} Title | Expected final record |`, `|---|---|---|---|---|${showBye ? "---|" : ""}---|---|`);
  for (const t of rows) {
    const st = snapshot.teams.find((x) => x.id === t.teamId);
    L.push(`| ${t.rank} | ${teamName(t.teamId)}${t.eliminated ? " (out)" : ""} | ${st ? recordOf(st.record) : "–"} | ${st ? fmt(st.pointsFor) : "–"} | ${pct(t.pPlayoffs)} |${showBye ? ` ${pct(t.pBye)} |` : ""} ${pct(t.pTitle)} | ${pointsOnly ? "– (points only)" : expectedRecord(t, ties)} |`);
  }
  const sum = (f: (t: TeamOdds) => number | null) => rows.reduce<number | null>((s, t) => (s === null || f(t) === null ? null : s + (f(t) as number)), 0);
  const sums = [`Σ P(playoffs) = ${fmt(sum((t) => t.pPlayoffs) ?? Number.NaN, 3)} (${odds.playoffTeams} playoff teams)`];
  if (showBye) sums.push(`Σ P(bye) = ${fmt(sum((t) => t.pBye) ?? Number.NaN, 3)} (${odds.byes} byes)`);
  const titles = sum((t) => t.pTitle);
  sums.push(titles === null ? "title odds unknown" : `Σ P(title) = ${fmt(titles, 3)}`);
  L.push("", `${sums.join(" · ")}.`);
  const mine = oddsOf(odds, model.myTeamId ?? "");
  if (mine) {
    const seeds = mine.seedDist.flatMap((p, k) => (p > 0 ? [`${ordinal(k + 1)} ${pct(p)}`] : []));
    L.push("", `Your final seed: ${seeds.join(" · ") || "–"}.`);
    if (mine.eliminated && snapshot.settings.leagueType === "redraft") L.push("", `**${SEASON_OVER_TEXT}**`);
  }
  L.push("", "Notes (SeasonOdds.notes: the rules as simulated, and any gaps in the data):", "");
  for (const n of odds.notes) L.push(`- ${n}`);
  L.push("");
}

function renderSchedule(L: string[], season: SeasonReport, snapshot: LeagueSnapshot, model: LeagueModel, teamName: (id: string) => string): void {
  L.push("## Your remaining schedule", "");
  const rows = season.schedule;
  if (!season.odds) {
    L.push("No odds, so no schedule (above).", "");
    return;
  }
  if (!rows) {
    L.push("Parker's team isn't known: pass --team <id> or --cookies.", "");
    return;
  }
  if (!rows.length) {
    L.push("No regular-season games of yours are left to simulate.", "");
    return;
  }
  const showMedian = rows.some((r) => r.pMedianWin !== null);
  const riskyPct = Math.round(RISKY_WIN_CHANCE * 100);
  L.push(
    `Each remaining regular-season game (§8 "show each remaining week's risk"): your weekly score and your opponent's, as the simulator draws them (mean ± SD; a multi-week matchup sums its weeks still to play), your chance to win it in the ${thousands(season.odds.sims)} simulated seasons${showMedian ? ", your chance of a top-half score (the median game)" : ""}, and your active-roster players whose NFL team is off that week. **Bold** = a likely starter, the League page's rule: your best lineup by each player's projected points per game left. A week is flagged risky as the League page flags it: your chance to win under ${riskyPct}% as the page prints it (whole percents), or ${RISKY_BYES} or more likely starters on bye in a week that counts.`,
    "",
  );
  L.push(`| Week | Opponent | You | Them | Win |${showMedian ? " Median |" : ""} On bye | Risk |`, `|---|---|---|---|---|${showMedian ? "---|" : ""}---|---|`);
  for (const r of rows) {
    const first = r.weeks[0] ?? r.week;
    const last = r.weeks.at(-1) ?? r.week;
    const week = `${first === last ? first : `${first}–${last}`}${r.underWay ? " (under way: projected as if no game had started)" : ""}`;
    const byes = r.byes.map((b) => (b.starter ? `**${playerName(snapshot.players[b.id], b.id)}**` : playerName(snapshot.players[b.id], b.id))).join(", ") || "–";
    const opp = r.opponentId === null ? "bye week (no game)" : teamName(r.opponentId);
    const them = r.theirs ? `${fmt(r.theirs.mean)} ± ${fmt(r.theirs.sd)}` : "–";
    const win = r.opponentId === null ? "no game" : pct(r.pWin);
    L.push(`| ${week} | ${opp} | ${fmt(r.mine.mean)} ± ${fmt(r.mine.sd)} | ${them} | ${win} |${showMedian ? ` ${pct(r.pMedianWin)} |` : ""} ${byes} | ${r.risk.length ? `Risky: ${r.risk.join("; ")}` : ""} |`);
  }
  const risky = rows.filter((r) => r.risk.length);
  L.push("", risky.length ? `Risky weeks: ${risky.map((r) => `week ${r.week} (${r.risk.join("; ")})`).join(", ")}.` : "No risky weeks.", "");
}

/** An estimate with its Monte Carlo standard error: "+0.0412 ± 0.0030" (the error reads "–" when it can't be estimated). */
const pm = (x: string, se: number, d: number) => `${x} ± ${fmt(se, d)}`;

/** The move alone (waiverScale), one line: every change with its standard error. */
function moveLine(move: NonNullable<WaiverScale["move"]>): string {
  const s = move.se;
  return `The move alone, against your roster as it is: ΔPO ${pm(signed(move.dPO, 4), s.dPO, 4)}, ΔCH ${pm(signed(move.dCH, 4), s.dCH, 4)}, Δ expected wins ${pm(signed(move.dEW, 3), s.dEW, 3)}, B ${pm(fmt(move.B, 2), s.B, 2)}, Trade Score ${move.score ?? "– (B ≤ 0)"}.`;
}

function scaleTable(L: string[], check: ScaleCheck): void {
  const rows = check.rows;
  if (!rows) {
    L.push(`Title odds are unknown (${check.titleUnknown ? `${check.titleUnknown}; ` : ""}see the notes under Standings and playoff odds), so B can't be computed.`, "");
    return;
  }
  L.push(`Baseline: P(playoffs) ${pct(check.base.pPlayoffs)}, P(title) ${pct(check.base.pTitle)}, expected wins ${fmt(check.base.expWins, 2)}.`, "");
  L.push("| Lineup gain | ΔPO | ΔCH | Δ expected wins | B | Trade Score | Toy league B | Toy score |", "|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const toy = PLANNER_TOY[r.gain];
    const s = r.se;
    L.push(`| +${r.gain} pt/wk | ${pm(signed(r.dPO, 4), s.dPO, 4)} | ${pm(signed(r.dCH, 4), s.dCH, 4)} | ${pm(signed(r.dEW, 3), s.dEW, 3)} | ${pm(fmt(r.B, 2), s.B, 2)} | ${r.score ?? "– (B ≤ 0)"} | ${toy ? `≈ ${toy.B}` : "–"} | ${toy ? `≈ ${toy.score}` : "–"} |`);
  }
  L.push("");
  const bRef = check.bRefAtToyGain;
  if (bRef === null) {
    L.push(`No B_ref maps this league's +${TOY_GAIN} to ${TOY_SCORE_AT_GAIN} (its B isn't above 0).`, "");
    return;
  }
  const scores = rows.map((r) => `+${r.gain} → ${tradeScore(r.B, bRef) ?? "–"}`).join(", ");
  // One decimal: B_ref carries B(+3)'s Monte Carlo error, tenths rather than hundredths at 5,000 seasons on
  // Parker's fixture (review finding: seeds 1–20 gave B(+3) an SD of 0.18).
  const se = check.bRefSe;
  const error = se !== null && Number.isFinite(se) ? { text: ` ± ${fmt(se, 1)}`, range: ` (± its Monte Carlo standard error, as B(+${TOY_GAIN})'s; two standard errors span ${fmt(bRef - 2 * se, 1)}–${fmt(bRef + 2 * se, 1)})` } : { text: "", range: "" };
  L.push(`B_ref that maps this league's +${TOY_GAIN} to a Trade Score of ${TOY_SCORE_AT_GAIN}: −B(+${TOY_GAIN}) / ln ${fmt(1 - TOY_SCORE_AT_GAIN / 100, 2)} = **${fmt(bRef, 1)}${error.text}**${error.range}; config.benefit.bRef is ${config.benefit.bRef}. With it: ${scores}.`, "");
}

function renderScale(L: string[], season: SeasonReport, snapshot: LeagueSnapshot, model: LeagueModel): void {
  L.push("## Trade Score scale check", "");
  const check = season.scale;
  const odds = season.odds;
  if (!odds || !check) {
    L.push(odds ? "Parker's team isn't known, so there's nothing to check." : "No odds, so no check.", "");
    return;
  }
  const w = config.benefit.weights;
  const weeks = model.weeks;
  const sims = thousands(odds.sims);
  const error =
    check.batches >= 2
      ? `± is its Monte Carlo standard error, by batch means: the ${sims} seasons split into ${check.batches} batches of ${thousands(check.batchSims)}, the change computed in each batch alone, SE = the batches' SD × √(${thousands(check.batchSims)} / ${sims}).`
      : "The run is too short to split into batches, so the changes have no standard error (–).";
  L.push(
    `CLAUDE.md §10 and the planner's reply to Checkpoint 2: your weekly score mean + x points in every remaining week (weeks ${weeks[0] ?? "–"}–${weeks.at(-1) ?? "–"}: regular season and playoffs${model.inProgressWeek !== null ? `, week ${model.inProgressWeek} in progress included` : ""}), σ unchanged, x = ${SCALE_GAINS.join(", ")}. Every row is ${sims} simulated seasons on the same common-random-numbers matrix (seed ${odds.seed}): each season is played with and without the gain on the same random draws. That takes out the noise of comparing separate runs, but each change is still an estimate from ${sims} seasons, and another seed would give a somewhat different one. ${error} ΔPO and ΔCH are fractions; B = 100 × (${w.playoffs} ΔPO + ${w.title} ΔCH) (no market term: only lineup points move); Trade Score = round(100 × (1 − e^(−B / ${config.benefit.bRef}))). The planner's toy league (12 teams, 10 weeks left): B ≈ ${SCALE_GAINS.map((g) => PLANNER_TOY[g]?.B ?? "–").join(" / ")}, scores ≈ ${SCALE_GAINS.map((g) => PLANNER_TOY[g]?.score ?? "–").join(" / ")}.`,
    "",
  );
  if (season.scaleMatchesModel !== null) L.push(`Baseline check: the baseline run ${season.scaleMatchesModel ? "reproduces" : "does NOT reproduce"} the League model's own odds for your team bit for bit (same seed, same matrix).`, "");
  L.push("**From your roster as it is**", "");
  scaleTable(L, check);
  L.push("**From your team after its best free-agent move** (§10: B compares rosters after that move)", "");
  const wv = season.waiver;
  if (!wv) L.push("Skipped.", "");
  else if ("skipped" in wv) L.push(`Skipped: ${wv.skipped}`, "");
  else {
    const move = `add ${playerLabel(snapshot.players[wv.waiver.add], wv.waiver.add)}${wv.waiver.drop ? `, drop ${playerLabel(snapshot.players[wv.waiver.drop], wv.waiver.drop)}` : " into an open spot"}`;
    L.push(
      `The move: ${move} (+${fmt(wv.waiver.gainScen ?? wv.waiver.gainEv)} lineup pts, playoff weeks × ${config.lineups.playoffWeight}). Its weekly scores come from teamValue.rosterScore, TeamModel.score's own rule; re-pricing your current roster the same way reproduced the model's scores ${wv.reproduced === 0 ? "bit for bit" : `within ${wv.reproduced.toExponential(1)}`}, and the new roster's ROS matches the model's ROS plus the move's gain ${wv.rosDiff === 0 ? "exactly" : `within ${Math.abs(wv.rosDiff).toExponential(1)}`}.`,
      "",
    );
    if (wv.move) L.push(moveLine(wv.move), "");
    scaleTable(L, wv.check);
  }
}

function renderNoOp(L: string[], season: SeasonReport): void {
  L.push("## No-op check", "");
  const n = season.noOp;
  if (!n) {
    L.push("No odds, so no check.", "");
    return;
  }
  const a = n.sameSetup;
  L.push(
    `(a) The same setup simulated twice, ${thousands(a.sims)} seasons each, each run drawing its own common-random-numbers matrix from the seed: ${thousands(a.compared)} numbers compared bitwise (every team's odds, expected record and seed distribution, every weekly win chance): ${a.differing === 0 ? "none differ. **Pass.**" : `**${a.differing} differ. FAIL.**`}`,
    "",
  );
  const b = n.rebuilt;
  if (!b) {
    L.push("(b) Skipped: the second model has no odds.", "");
    return;
  }
  L.push("(b) A second League model built from the same snapshot and inputs, every roster copied unchanged (a trade that changes nothing), simulated with the same seed:", "");
  L.push("| Measure | Largest \\|Δ\\| over the teams |", "|---|---|");
  L.push(`| P(playoffs) | ${b.pPlayoffs} |`, `| P(bye) | ${b.pBye} |`, `| P(title) | ${b.pTitle} |`, `| Expected wins | ${b.expWins} |`, `| Weekly score means and SDs (the simulator's inputs) | ${b.score} |`);
  const zero = b.pPlayoffs === 0 && b.pBye === 0 && b.pTitle === 0 && b.expWins === 0 && b.score === 0 && b.nulls === 0;
  L.push("", zero ? "Every difference is exactly 0. **Pass.**" : `**FAIL**${b.nulls ? ` (${b.nulls} odds known in one model and not the other)` : ""}.`, "");
}

function renderRuntime(L: string[], season: SeasonReport): void {
  L.push("### Season simulation runtime", "");
  const built = season.built;
  if (built) {
    const s = built.setup;
    const games = s.games.filter((g) => g.b !== null).length;
    const w = s.weeks;
    const medianWeeks = s.medianWeeks.length ? `; ${s.medianWeeks.length} median weeks` : "";
    L.push(
      `Setup: ${s.teams.length} teams; ${w.length} drawn weeks (${w[0] ?? "–"}–${w.at(-1) ?? "–"}); ${games} remaining games, ${s.played.length} played${medianWeeks}; ${s.playoffTeams} playoff teams in ${s.rounds.length} rounds. Node ${process.version}; each number is the median of ${TIMING_RUNS} runs after ${TIMING_WARMUPS} warm-up.`,
      "",
    );
  }
  if (season.simTimings.length) {
    L.push("| Seasons | simNormals (the matrix) | simulateSeason | Both |", "|---|---|---|---|");
    for (const t of season.simTimings) L.push(`| ${thousands(t.sims)} | ${msFine(t.normals)} | ${msFine(t.simulate)} | ${msFine(t.total)} |`);
    L.push("");
  }
  if (season.buildTimings.length) {
    L.push("buildLeagueModel, the whole League model (the League page's Web Worker runs it):", "");
    L.push("| Lineups | Without the simulation | With it | The build's own \"season simulation\" stage |", "|---|---|---|---|");
    for (const s of [...new Set(season.buildTimings.map((b) => b.scenarios))]) {
      const off = season.buildTimings.find((b) => b.scenarios === s && b.sims === 0);
      const on = season.buildTimings.find((b) => b.scenarios === s && b.sims > 0);
      L.push(`| ${s === 0 ? "expected-value lineups only" : `${s} availability scenarios`} | ${ms(off?.total)} | ${ms(on?.total)}${on ? ` (${thousands(on.sims)} seasons)` : ""} | ${msFine(on?.simulation)} |`);
    }
    L.push("");
  }
}

function render(snapshot: LeagueSnapshot, inputs: ModelInputs, model: LeagueModel, evOnly: LeagueModel, timing: Record<string, number>, depthOf: DepthOf, season: SeasonReport): string {
  const L: string[] = [];
  const teamName = (id: string) => `Team ${id}${id === model.myTeamId ? " (you)" : ""}`;
  const players = snapshot.players;
  const weeks = model.weeks;
  const myTeam = model.teams.find((t) => t.id === model.myTeamId);

  L.push("# League model: Parker's ESPN league", "");
  L.push(`Generated by \`npm run league:report\` on ${new Date().toISOString().slice(0, 10)} through the real adapters, model-inputs builder and engine. Team, owner and league names are placeholders; NFL player names are public.`, "");
  L.push(`**League 1** · ESPN · ${snapshot.season} · week ${snapshot.currentWeek} · ${snapshot.teams.length} teams · remaining weeks ${weeks[0] ?? "–"}–${weeks.at(-1) ?? "–"} (regular season ${model.regularWeeks.length}, playoffs ${model.playoffWeeks.length}) · ${model.scenarios} availability scenarios · ${model.odds ? `${thousands(model.odds.sims)} simulated seasons` : "no season simulation"}`, "");
  L.push("**Data**", "");
  for (const s of inputs.sources) L.push(`- ${s.source}: ${s.fetchedAt}${s.stale ? " (saved copy; the live fetch failed)" : ""}`);
  L.push(`- FantasyCalc format: ${model.market.format ? fantasyCalcFormatLabel(model.market.format) : "values unavailable"}`);
  const ag = model.projection.agreement;
  L.push(`- ESPN vs Sleeper projections, week ${ag?.week ?? snapshot.currentWeek}: ${ag ? `Σ|ESPN − Sleeper| / Σ Sleeper = ${fmt(100 * ag.meanRelDiff)}% over ${ag.players} rostered players` : "not compared"} → ${model.projection.espnAveraged ? "averaged" : "Sleeper only"} (§6: average only within ${100 * config.projections.espnSleeperAgreement}%)`);
  if (model.projection.disagreements.length) L.push(`- Sources disagree by more than ${100 * config.projections.sourceDisagreementLog}% on: ${model.projection.disagreements.map((d) => `${playerLabel(players[d.playerId], d.playerId)} ESPN ${fmt(d.espn)} vs Sleeper ${fmt(d.sleeper)}`).join("; ")}`);
  L.push(`- Base rates by source: ${Object.entries(model.projection.sources).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  for (const n of inputs.notes) L.push(`- Note: ${n}`);
  for (const w of inputs.warnings) L.push(`- Warning \`${w.code}\`: ${w.message}`);
  for (const w of model.warnings) L.push(`- Engine: ${w}`);
  L.push("");

  // Phase 3: the season simulation.
  renderStandings(L, season, snapshot, model, teamName);
  renderSchedule(L, season, snapshot, model, teamName);
  renderScale(L, season, snapshot, model);
  renderNoOp(L, season);

  L.push("## Timings", "", "| Stage | Time |", "|---|---|");
  for (const [k, v] of Object.entries(timing)) L.push(`| ${k} | ${ms(v)} |`);
  for (const [k, v] of Object.entries(model.timings)) L.push(`| engine (S = ${model.scenarios}): ${k} | ${ms(v)} |`);
  for (const [k, v] of Object.entries(evOnly.timings)) L.push(`| engine (expected-value lineups only): ${k} | ${ms(v)} |`);
  L.push("", "The engine rows are each model's first build in this process (the JIT still cold); the medians below are steadier.", "");
  renderRuntime(L, season);

  // Parker's projected points per week against the league.
  L.push("## Projected starting-lineup points per week", "");
  L.push("Scenario lineups (§7: the average over availability scenarios, so depth counts). EV = expected-value lineups. Simulator = your weekly score as the season simulation draws it (mean ± SD; a week in progress as if none of its games had started, with today's rosters and injury news).", "");
  L.push("| Week | You | Rank | League median | Best | You, EV | Simulator, you |", "|---|---|---|---|---|---|---|");
  weeks.forEach((w, wi) => {
    const lvs = model.teams.map((t) => ({ id: t.id, lv: (t.scen ?? t.ev).lv[wi] ?? 0 }));
    const mine = lvs.find((x) => x.id === model.myTeamId)?.lv;
    const rank = mine === undefined ? "–" : String(1 + lvs.filter((x) => x.lv > mine).length);
    const po = model.playoffWeeks.includes(w) ? " (playoffs)" : w === model.inProgressWeek ? " (in progress: its games have started; team numbers skip it)" : "";
    const sim = myTeam ? `${fmt(myTeam.score.mean[wi] ?? Number.NaN)} ± ${fmt(myTeam.score.sd[wi] ?? Number.NaN)}` : "–";
    L.push(`| ${w}${po} | ${mine === undefined ? "–" : fmt(mine)} | ${rank} | ${fmt(median(lvs.map((x) => x.lv)))} | ${fmt(Math.max(...lvs.map((x) => x.lv)))} | ${myTeam ? fmt(myTeam.ev.lv[wi] ?? 0) : "–"} | ${sim} |`);
  });
  L.push("", "| Team | Record | PF | Proj/wk (scenario) | Proj/wk (EV) | ROS (scenario, playoff weeks × " + config.lineups.playoffWeight + ") |", "|---|---|---|---|---|---|");
  const ranked = [...model.teams].sort((a, b) => (b.scen ?? b.ev).ppw - (a.scen ?? a.ev).ppw);
  for (const t of ranked) {
    const st = snapshot.teams.find((x) => x.id === t.id);
    L.push(`| ${teamName(t.id)} | ${st ? recordOf(st.record) : "–"} | ${st ? fmt(st.pointsFor) : "–"} | ${fmt((t.scen ?? t.ev).ppw)} | ${fmt(t.ev.ppw)} | ${fmt((t.scen ?? t.ev).ros, 0)} |`);
  }
  L.push("");

  // Needs, trade chips and partners.
  const lineupPts = `lineup pts, playoff weeks × ${config.lineups.playoffWeight}${model.scenarios ? `, scenario lineups (S = ${model.scenarios})` : ", expected-value lineups"}`;
  L.push("## Needs and trade chips, every team", "");
  L.push(`Needs: lineup slots at or below z = ${config.lineups.needZThreshold} against the league (rest of season; "next" = only over the next ${config.lineups.strengthWeeks} weeks).`, "");
  L.push("| Team | Needs | Trade chips |", "|---|---|---|");
  for (const t of model.teams) {
    const needs = t.needs.map((n) => `${n.slot}${n.window === "next" ? " (next)" : ""} z ${fmt(n.z)}`).join(", ") || "none";
    L.push(`| ${teamName(t.id)} | ${needs} | ${t.chips.length} |`);
  }
  L.push("");
  L.push(
    `Trade chips (§7; planner reply to Checkpoint 2, answer 2): gap = maxOther − cost ≥ ${config.needs.chipMinGap} (${lineupPts}). cost = what his team loses without him (lineup cost, from the team after its best free-agent move); maxOther = the most he'd add to another team's lineup, measured from that team after its best free-agent move, minus the player it would drop to make room when its roster is full (the one whose loss costs its lineup least, nobody refilling his spot). ${config.market.tradeSearchExcluded.join(", ")} are never chips (left out of trade search). Every chip is listed; the League page shows the first ${config.needs.chipsShown} per team.`,
    "",
  );
  L.push("| Team | Player | Gap | Cost | maxOther | Best team |", "|---|---|---|---|---|---|");
  let chipRows = 0;
  for (const t of model.teams) {
    for (const c of t.chips) {
      chipRows++;
      L.push(`| ${teamName(t.id)} | ${playerLabel(players[c.playerId], c.playerId)} | ${fmt(c.gap)} | ${fmt(c.cost)} | ${fmt(c.maxOther)} | ${teamName(c.bestTeamId)} |`);
    }
  }
  if (!chipRows) L.push("| – | no trade chips | | | | |");
  L.push("");
  if (model.partners.length) {
    L.push("**Best trade partners for your team** (from the trade chips: what each would add per week to the other lineup, after that team's best free-agent move)", "");
    for (const p of model.partners) {
      const give = p.youCanGive.map((x) => `${playerLabel(players[x.playerId], x.playerId)} +${fmt(x.ppw)}/wk`).join(", ");
      const get = p.theyCanGive.map((x) => `${playerLabel(players[x.playerId], x.playerId)} +${fmt(x.ppw)}/wk`).join(", ");
      L.push(p.mutual ? `- ${teamName(p.teamId)} (mutual fit ${fmt(p.score, 2)}): they could give ${get || "–"}; you could give ${give || "–"}` : `- ${teamName(p.teamId)} (one-sided, +${fmt(p.score)}/wk): they could give ${get || "–"}; none of your trade chips would start for them`);
    }
    L.push("");
  } else if (model.myTeamId) {
    L.push("**Best trade partners for your team:** none (no team has a trade chip who would start for you).", "");
  }

  // Conflicting ESPN signals: every questionable, doubtful or probable player whose ESPN return date is 2+ weeks away.
  L.push("## Conflicting ESPN signals: far return dates on game-time tags", "");
  L.push(
    `CLAUDE.md §6 step 3 (planner reply to Checkpoint 2, answer 6): a PROBABLE, QUESTIONABLE or DOUBTFUL player whose ESPN return week is 2+ weeks away gets Sleeper as the tiebreaker. If Sleeper projects him this week at ${Math.round(config.projections.staleReturnShare * 100)}% or more of his healthy base rate (step 1's base rate as if neither source had projected him this week), the date is stale: the tag's one-week table, then healthy. Otherwise he follows the date (give or take a week).`,
    "",
  );
  const noted = Object.entries(model.players).filter(([, m]) => m.availabilityNote);
  if (noted.length) {
    L.push("| Player | Team | Tag | ESPN return week | Sleeper this week | Healthy base rate | Follows | Availability, next weeks |", "|---|---|---|---|---|---|---|---|");
    for (const [id, m] of noted) {
      const n = m.availabilityNote as NonNullable<PlayerModel["availabilityNote"]>;
      const team = snapshot.teams.find((t) => [...t.roster, ...t.ir, ...t.taxi].includes(id));
      const out = inputs.nfl.lastWeek !== undefined && n.returnWeek > inputs.nfl.lastWeek ? `${n.returnWeek} (out for the season)` : String(n.returnWeek);
      const avail = m.weekly
        .slice(0, 6)
        .map((w, i) => `W${weeks[i]} ${Math.round(w.a * 100)}%`)
        .join(", ");
      L.push(`| ${playerLabel(players[id], id)} | ${team ? teamName(team.id) : "free agent"} | ${n.status} | ${out} | ${n.sleeperUnavailable ? "didn't load" : n.sleeperNow === null ? "not projected" : fmt(n.sleeperNow)} | ${n.healthyRate === null ? "–" : fmt(n.healthyRate)} | ${n.used === "sleeper" ? "Sleeper (date stale)" : "the return date"} | ${avail} |`);
    }
  } else {
    L.push("None this week.");
  }
  L.push("");

  // FantasyCalc rates (rostered QB/RB/WR/TE, roster + IR + taxi).
  const rostered = snapshot.teams.flatMap((t) => [...t.roster, ...t.ir, ...t.taxi]);
  const skill = rostered.filter((id) => ["QB", "RB", "WR", "TE"].includes(players[id]?.pos ?? ""));
  const known = new Set(inputs.market?.knownIds ?? []);
  const valued = new Set(Object.keys(inputs.market?.values ?? {}));
  const idMisses = skill.filter((id) => !known.has(id) && !valued.has(id));
  const valueMisses = skill.filter((id) => !valued.has(id));
  L.push("## FantasyCalc match rates (rostered QB/RB/WR/TE)", "");
  L.push(`- ID match (FantasyCalc knows the player): ${skill.length - idMisses.length}/${skill.length} = ${fmt((100 * (skill.length - idMisses.length)) / Math.max(1, skill.length))}% (target ≥ 98%)${idMisses.length ? `; misses: ${idMisses.map((id) => playerLabel(players[id], id)).join("; ")}` : ""}`);
  L.push(`- Has a value in this format: ${skill.length - valueMisses.length}/${skill.length} = ${fmt((100 * (skill.length - valueMisses.length)) / Math.max(1, skill.length))}%${valueMisses.length ? `; without one (estimated instead): ${valueMisses.map((id) => `${playerLabel(players[id], id)} → ${model.players[id]?.value ? `${Math.round(model.players[id]!.value!.value)} (${model.players[id]!.value!.source})` : "none"}`).join("; ")}` : ""}`);
  L.push(`- Values by source, all relevant players: ${Object.entries(model.market.counts).map(([k, v]) => `${k} ${v}`).join(", ")}; waiver credit W = ${Math.round(model.market.waiverCredit)}; top value ${Math.round(model.market.topValue)}`, "");

  // Depth: expected-value lineups vs scenario lineups.
  L.push("## Depth: a bench player's value to his team, EV lineups vs scenario lineups", "");
  L.push("MV_lose = the team's rest-of-season lineup points with him, minus without him (after it adds the best free agent). EV lineups only count him when he starts in the average case; scenario lineups also count the weeks he fills in for an injured or bye-week starter.", "");
  L.push(`Bench players here are those whose lineup cost under EV lineups is at most ${BENCH_EV_MAX} lineup points: the average-case lineup almost never starts them. Lineup cost is measured from the team after its best free-agent move (below), so it is never negative.`, "");
  L.push(`Depth value = his team's rest-of-season lineup points with him minus without him, with nobody added in his place: the pure effect of scenario lineups. Lineup cost (§7 MV_lose) also lets the team add the best free agent, so in a deep 10-team waiver pool it is smaller. Both are lineup points with playoff weeks counted ${config.lineups.playoffWeight}×.`, "");
  L.push("| Team | Player | ROS pts | Depth value, EV | Depth value, scenarios | Lineup cost, EV | Lineup cost, scenarios |", "|---|---|---|---|---|---|---|");
  const costs = model.teams.flatMap((t) => Object.entries(t.players).map(([id, v]) => ({ team: t.id, id, ev: v.mvLoseEv, scen: v.mvLoseScen ?? Number.NaN, depth: depthOf(t.id, id) })));
  const bench = costs.filter((g) => g.ev <= BENCH_EV_MAX).sort((a, b) => b.depth.scen - a.depth.scen);
  const pick = [...bench.filter((g) => g.team === model.myTeamId).slice(0, 4), ...bench.filter((g) => g.team !== model.myTeamId).slice(0, 6)];
  for (const g of pick) L.push(`| ${teamName(g.team)} | ${playerLabel(players[g.id], g.id)} | ${fmt(model.players[g.id]?.ros.total ?? Number.NaN)} | ${fmt(g.depth.ev)} | ${fmt(g.depth.scen)} | ${fmt(g.ev)} | ${fmt(g.scen)} |`);
  const benchAll = costs.filter((g) => g.ev <= BENCH_EV_MAX && Number.isFinite(g.scen));
  const avg = (f: (g: (typeof benchAll)[number]) => number) => fmt(benchAll.reduce((s, g) => s + f(g), 0) / Math.max(1, benchAll.length));
  if (benchAll.length) L.push("", `Across all ${benchAll.length} such bench players: depth value ${avg((g) => g.depth.ev)} lineup pts under EV lineups vs ${avg((g) => g.depth.scen)} under scenario lineups; lineup cost ${avg((g) => g.ev)} vs ${avg((g) => g.scen)}.`);
  L.push("", "**Best free-agent move per team** (the baseline lineup cost is measured from)", "", `| Team | Move | Lineup pts gained, playoff weeks ×${config.lineups.playoffWeight} (EV / scenarios) |`, "|---|---|---|");
  for (const t of model.teams) {
    const w = t.waiver;
    L.push(`| ${teamName(t.id)} | ${w ? `add ${playerLabel(players[w.add], w.add)}${w.drop ? `, drop ${playerLabel(players[w.drop], w.drop)}` : " into an open spot"}` : "none helps"} | ${w ? `${fmt(w.gainEv)} / ${w.gainScen === null ? "–" : fmt(w.gainScen)}` : "–"} |`);
  }
  L.push("");

  // ROS and weekly projections for every rostered player.
  L.push("## Rest-of-season and weekly projected points, every rostered player", "");
  L.push(`ROS = Σ p over the remaining weeks (p = base rate × week shape × availability, §6). Weeks ${weeks.join(", ")}; playoff weeks ${model.playoffWeeks.join(", ") || "none"}. Status: P/Q/D/O = probable/questionable/doubtful/out.`, "");
  for (const t of snapshot.teams) {
    const ids = [...t.roster, ...t.ir, ...t.taxi];
    L.push(`### ${teamName(t.id)}`, "");
    L.push(`| Player | Pos | NFL | St | ROS | Reg | PO | Games | Bye | Value | Base | ${weeks.map((w) => `W${w}`).join(" | ")} |`);
    L.push(`|---|---|---|---|---|---|---|---|---|---|---|${weeks.map(() => "---").join("|")}|`);
    const rows = ids.map((id) => ({ id, m: model.players[id], p: players[id] })).sort((a, b) => (b.m?.ros.total ?? -1) - (a.m?.ros.total ?? -1));
    for (const r of rows) {
      const m = r.m;
      const onIr = t.ir.includes(r.id) ? " (IR)" : t.taxi.includes(r.id) ? " (taxi)" : "";
      if (!m) {
        L.push(`| ${playerName(r.p, r.id)}${onIr} | ${r.p?.pos ?? ""} | ${r.p?.nflTeam ?? ""} | ${STATUS_SHORT[r.p?.injury ?? "ACTIVE"] ?? ""} | no projection | | | | | | | ${weeks.map(() => "").join(" | ")} |`);
        continue;
      }
      const v = m.value ? `${Math.round(m.value.value)}${m.value.source === "fantasycalc" ? "" : "*"}` : "–";
      L.push(`| ${playerName(r.p, r.id)}${onIr} | ${r.p?.pos ?? ""} | ${r.p?.nflTeam ?? "FA"} | ${STATUS_SHORT[r.p?.injury ?? "ACTIVE"] ?? ""} | ${fmt(m.ros.total)} | ${fmt(m.ros.regular)} | ${fmt(m.ros.playoffs)} | ${m.ros.gamesLeft} | ${byeText(m)} | ${v} | ${fmt(m.base.b)} (${m.base.source}) | ${m.weekly.map((x) => (x.bye ? "bye" : fmt(x.p))).join(" | ")} |`);
    }
    L.push("");
  }
  L.push("\\* estimated value (FantasyCalc doesn't value him in this format; §9). Values: FantasyCalc (fantasycalc.com).", "");
  return L.join("\n");
}

export interface ReportOptions extends Omit<SeasonReportOptions, "now" | "clock"> {
  now: Date;
  clock: () => number;
  /** Timings of the stages before the engine (main: the crosswalk, the import, the model inputs); the engine's are added. */
  timing?: Record<string, number>;
  /** Availability scenarios of the main model (default config.lineups.scenarios). */
  scenarios?: number;
}

/**
 * Everything after the network (the file header): the League models (expected-value lineups only, and with
 * scenarios, both with the season simulation), the Phase 3 numbers and the markdown, not yet scrubbed.
 * `snapshot` must already carry placeholders (placeholders()).
 */
export function buildReport(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: ReportOptions): { doc: string; model: LeagueModel; season: SeasonReport; timing: Record<string, number> } {
  const { now, clock } = opts;
  const timing = { ...(opts.timing ?? {}) };
  const scenarios = opts.scenarios ?? config.lineups.scenarios;
  let t0 = clock();
  const evOnly = buildLeagueModel(snapshot, inputs, { now, scenarios: 0, clock });
  timing["engine, expected-value lineups only (season simulation included)"] = clock() - t0;
  t0 = clock();
  const model = buildLeagueModel(snapshot, inputs, { now, scenarios, clock });
  timing[`engine, with ${scenarios} availability scenarios (season simulation included)`] = clock() - t0;
  const season = seasonReport(snapshot, inputs, model, {
    now,
    clock,
    ...(opts.runs !== undefined ? { runs: opts.runs } : {}),
    ...(opts.warmups !== undefined ? { warmups: opts.warmups } : {}),
    ...(opts.buildRuns !== undefined ? { buildRuns: opts.buildRuns } : {}),
  });
  const doc = render(snapshot, inputs, model, evOnly, timing, depthValues(snapshot, inputs, model, now), season);
  return { doc, model, season, timing };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const teamFlag = argv.indexOf("--team");
  const teamArg = teamFlag >= 0 ? argv[teamFlag + 1] : undefined;
  const useCookies = !argv.includes("--no-cookies") && (argv.includes("--cookies") || env("USE_ENV_COOKIES") === "1");
  registerScrubber(await redactorFromMap("espn"));
  const leagueId = env("ESPN_LEAGUE_ID");
  if (!leagueId) throw new Error("ESPN_LEAGUE_ID is blank in .env.local.");
  const season = Number(env("ESPN_SEASON") || 2026);
  const timing: Record<string, number> = {};
  const clock = () => performance.now();

  const http = createHttpClient({ cache: new FileCache() });
  let t0 = clock();
  const resolver = await loadPlayerIdResolver({ http });
  timing["player-ID crosswalk"] = clock() - t0;
  const now = new Date();
  const deps: ImportDeps = { http, resolver, now };

  const s2 = useCookies ? env("ESPN_S2") : undefined;
  const swid = useCookies ? env("ESPN_SWID") : undefined;
  t0 = clock();
  const { result, espn } = await importEspnLeagueForModel({ leagueId, season, ...(s2 && swid ? { credentials: { espnS2: s2, swid } } : {}) }, deps);
  timing["ESPN import"] = clock() - t0;

  const myTeamId = result.snapshot.myTeamId ?? teamArg ?? null;
  if (!myTeamId) console.log("Parker's team isn't known: pass --team <id> or --cookies for the per-team sections.");
  const snapshot = placeholders({ ...result.snapshot, myTeamId });

  t0 = clock();
  const inputs = await buildModelInputs({ snapshot: result.snapshot, http, resolver, now, espn });
  timing["model inputs (server: Sleeper, FantasyCalc, NFL schedule, scoring)"] = clock() - t0;

  const { doc: raw, model, season: sim, timing: timings } = buildReport(snapshot, inputs, { now, clock, timing });
  // Public NFL player names are kept whole: a leaguemate's first or last name can be a word of one, and a
  // scrubbed fragment next to the rest of a public name would reveal it (review PRIV-1).
  const doc = scrubEverythingExcept(raw, Object.values(snapshot.players).map((p) => p.name));
  writeFileSync(path.join(ROOT, "reports", "league-report.md"), doc);
  const me = model.teams.find((t) => t.id === model.myTeamId);
  const mine = oddsOf(model.odds, model.myTeamId ?? "");
  const odds = mine ? `; playoffs ${pct(mine.pPlayoffs)}, title ${pct(mine.pTitle)}` : "";
  const t5000 = sim.simTimings.find((t) => t.sims === config.simulation.finalSims);
  console.log(
    scrubEverything(
      `league report written: ${Object.keys(model.players).length} players, ${model.teams.length} teams, weeks ${model.weeks[0]}–${model.weeks.at(-1)}; Parker ${me ? `${fmt((me.scen ?? me.ev).ppw)} pts/wk${odds}` : "team unknown"}; ${t5000 ? `${thousands(t5000.sims)} seasons ${msFine(t5000.total)}; ` : ""}timings ${Object.entries(timings).map(([k, v]) => `${k} ${ms(v)}`).join(", ")}`,
    ),
  );
}

// Run only as a script (npm run league:report), never when a test imports the offline logic above.
const isMain = process.argv[1] !== undefined && /league-report\.ts$/.test(process.argv[1]);
if (isMain) {
  loadEnv();
  installConsoleScrubber();
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    process.exit(1);
  });
}
