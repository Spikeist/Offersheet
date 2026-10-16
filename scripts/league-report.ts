/**
 * Checkpoint numbers for Parker's league (CLAUDE.md §17 "Checkpoint 2 includes" and "Checkpoint 3
 * includes"), computed through the real app code: the ESPN adapter, the model-inputs builder (Sleeper
 * projections and stats, FantasyCalc values, the NFL schedule) and the pure engine (projections,
 * availability, lineups, scenarios, needs, trade chips, market values, the season simulation), exactly as
 * the League page's Web Worker runs it.
 *
 *   npm run league:report                   no network: the newest git-ignored placeholder dump of Parker's league
 *                                           (data-local/parker-league*, by meta.json's time; snapshot.json, inputs.json,
 *                                           meta.json; loadDump), the engine's `now` from meta.json
 *   npm run league:report -- --dump <dir>   that dump instead (--offline <dir> is an alias)
 *   npm run league:report -- --team <id>    his team, when the data doesn't say
 *   npm run league:report -- --live         Parker's ESPN league through the public-link path (the network)
 *   npm run league:report -- --live --cookies   use the .env.local ESPN cookies (also with USE_ENV_COOKIES=1),
 *                                           so ESPN itself says which team is his
 *   npm run league:report -- --prizes 2000,1600,900   the league's prizes (1st, 2nd, 3rd, the weekly high score, the most
 *                                           points; blank, 0 or left off not paid: Parker's league pays only the top 3):
 *                                           "Several prizes" on them, and the prizes section
 *                                           (Checkpoint 7c, below); the console says how it read them first
 *
 * Offline by default (planner reply to Checkpoint 4c, A5; scripts/lib/runMode.ts): without --live the process's offline
 * guard is on, so nothing here can touch the network; the header prints the command with the dump named.
 *
 * Phase 3, the season simulation (§8; planner reply to Checkpoint 2, "Checkpoint 3 must include"), on Phase 4c's one
 * baseline (below):
 * - Standings and playoff odds: today's standings by the league's rules (TeamOdds.rank) with each team's
 *   record, points for, P(playoffs), P(bye), P(title) and expected final record (the headline: every team after its
 *   free-agent pickups, LeagueModel.odds), P(playoffs) and P(title) as rosters stand (LeagueModel.oddsAsRostersStand,
 *   the second line), the Σ checks (Σ P(playoffs) = playoff teams, Σ P(title) = 1) and the simulation's own notes.
 * - Your remaining schedule (§8 "show each remaining week's risk"): each remaining regular-season game with
 *   both teams' weekly score (the simulator's mean ± SD with pickups, TeamModel.scoreWithPickups, summed over a
 *   multi-week matchup's weeks still to play), the win chance (with pickups, and as rosters stand), and my players on bye
 *   (the roster after my pickups, and IR returners from their expected return week). Likely starters and the risky-week
 *   flag are the League page's own rules, read from src/lib/leagueView.ts (scheduleByeRule: likely starters after my
 *   pickups, ⚠️ none at a position I stream, whose bye the streaming replacement covers; RISKY_WIN_CHANCE, RISKY_BYES;
 *   review POL-1: the report had kept its own copy, which drifted), the win chance the headline's.
 * - "Helps you" scale check (§10; Phase 7a, planner reply to Checkpoint 4c, A2: the scale calibrates itself per league and
 *   goal): the user's weekly score mean + 1, 3 and 6 points in every remaining week a trade can change (regular season and
 *   playoffs; ⚠️ a week in progress left out, as every trade's evaluation leaves it: evaluate.ts holds that week at the
 *   as-stands score before and after a trade), σ unchanged, on one common-random-numbers matrix (the League model's own:
 *   the shown block's seasons since Checkpoint 7e, season.shownSimsOf, from config.simulation.seed), from the one baseline (every team after its
 *   pickups: TeamModel.scoreWithPickups, the seasons LeagueModel.odds simulates, the trade search's baseline): ΔPO, ΔCH
 *   and Δ expected wins, B = 100 × (w_PO ΔPO + w_S ΔE[S]) under each "What does your league reward?" goal (benefitWin,
 *   config.benefit.goals; Checkpoint 7c: ΔE[S] the change in my share of the prizes, src/engine/reward.ts, ΔCH under "Only
 *   the champion" and "Making the playoffs", "Several prizes" on the league's split from --prizes, else ⚠️ the prefilled
 *   split, config.benefit.prizesDefault: goalRewards; no market term: only lineup points move), B₃ under each goal (the +config.benefit.helpsGain row's
 *   B through benefit.helpsScale: floored at config.benefit.helpsFloor; ⚠️ without λ, as the rows' B, so in a dynasty or
 *   keeper league with long-term values the app's scale is B_ref(λ) = (1 − λ) × this B₃ + λ × F₁₀ instead, planner reply
 *   to Checkpoint 7a, §2 question 6, and its lineup gains read lower than these rows unless λ is 0), and Helps
 *   you on it (benefit.tradeScore: +3 reads 63 by construction, +1 and +6 about 28 and 86 when B grows in proportion), next
 *   to the planner's toy league; and (planner reply to Checkpoint 7a, §2 question 5) what "Protect my trade value" charges
 *   on that B₃ (tradeValuePriceWords: the market term, (B₃ / 3) × κ × clamp(g_mkt(me)), at each level for giving 25% more
 *   value than you get). The +3 row is checked to equal the League model's own calibration run
 *   (LeagueModel.helpsCalibration, step 8c) bit for bit. Common
 *   random numbers compare every row with the baseline season by season, which takes out the noise of comparing separate
 *   runs, but each change is still a Monte Carlo estimate from the model's seasons (another seed gives a somewhat different
 *   B(+3)). So every change carries its standard error, by batch means: the run's seasons split into SE_BATCHES batches
 *   (batchRuns), the change computed in each batch alone (batchSe). B₃ gets B(+3)'s error. When title
 *   odds are unknown, the reason is given only when the report can confirm it (titleUnknownReason); otherwise it points
 *   to the notes under the standings. The rows' B can't be computed then, but B₃ still is, from the +3 run's ΔPO alone, as
 *   the app scores every card (review of track SC, SC-3; ScaleB3.playoffOnly, no error), and the +3 run is still checked
 *   against the League model's (ΔCH null in both). Then the same rows from the rosters as they stand (TeamModel.score, the seasons
 *   oddsAsRostersStand simulates: Checkpoint 4b's basis), and every team's pickups' own effect on my odds (the one
 *   baseline against as rosters stand, paired season by season, with its standard error). Each baseline run is checked
 *   to reproduce the model's own odds bit for bit. ⚠️ The depth values (depthValues) still price rosters without IR
 *   returners.
 * - No-op check (§8 common random numbers; §16): (a) one setup simulated twice, each run drawing its own
 *   matrix from the seed: every number bitwise identical; (b) a second League model built from the same
 *   snapshot and inputs with every roster copied (a trade that changes nothing), simulated with the same
 *   seed: the largest |Δ| in each team's P(playoffs), P(bye), P(title) and expected wins (both odds: with pickups and as
 *   rosters stand), and in the simulator's weekly score inputs (TeamModel.score and scoreWithPickups), which must all be
 *   exactly 0.
 * - Simulation runtime: simNormals and simulateSeason at 1,000, 5,000 and 20,000 seasons (config.simulation
 *   screeningSims, finalSims and, since Checkpoint 7e, shownSims, the League model's), and buildLeagueModel with and without the season simulation (expected-value
 *   lineups only, and S availability scenarios; both measuring the automatic playoff weight, as the app does), each the
 *   median of TIMING_RUNS runs after TIMING_WARMUPS warm-up.
 *
 * Phase 4, track A1 (planner reply to Checkpoint 3: model change 1, answers 1, 3 and 5):
 * - Streaming positions (CLAUDE.md §7): which positions each team streams and why (your setting, or detected
 *   from its adds this season, with the counts), each streamed position's replacement per week and its
 *   average, and "Streaming picks this week" with their opponents (LeagueModel.streaming). The model is built
 *   with the default settings (K and DEF streamed; since Phase 7b the automatic playoff weight under the default goal).
 * - Trade chips carry their cost per week and the "starter" tag (answer 3); lineup points are labeled with the
 *   model's playoff weight (LeagueModel.playoffWeight).
 * - Everything priced outside the model (the depth values) adds the team's streaming rows (league.tableWithStreaming,
 *   streamIds), so it still reproduces the model's own numbers. (Phase 4c: the scale check reads the model's own weekly
 *   scores, TeamModel.score and scoreWithPickups, so it prices no roster itself any more.)
 * - The Trade Score used B_ref 6 (answer 1) until Phase 7a; since then the scale is B₃ (the scale check above).
 *
 * Phase 4, track A2 (planner reply to Checkpoint 3, model change 2; "Checkpoint 4 must report"):
 * - The free-agent optimizer V* (CLAUDE.md §7): every team's pickups (TeamModel.faMoves, EV and scenario gains, the one
 *   V* decides by marked: optimizerJudging, scenario lineups when scenarios run without starter limits), how
 *   many moves teams make (the count distribution), and the named examples under V* through league.leagueMarginals
 *   (the model's own rules, outside it): Bo Nix → Team 1 (his MV_add there, with the drop that makes room, against his
 *   lineup cost: his chip gap) and McCaffrey's chip gap (OPTIMIZER_EXAMPLES; public NFL names).
 * - Lineup costs, chips and partners are worded for V*. The build timings (buildTimings) include the optimizer (lead
 *   decision L14: ≤ 400 ms).
 *
 * Phase 4b (planner reply to Checkpoint 4; the lead's design, track R):
 * - Offline mode (`--dump <dir>`, loadDump; the default since Phase 7a's A5): the same report from a placeholder dump, so
 *   the checkpoint reports come from one fixed set of data. A dump made before the adapter read ESPN's waiver ranks gets
 *   them from the dump folder's waiver-ranks.json when it has one (the header says so).
 * - The market blend (§6 step 8; blendLines): the blend's weight and, per position, the players it reaches and the curve
 *   points (LeaguePlayers.blend), the players whose projection it moved (PlayerModel.blend), and the League page's
 *   player breakdown lines (buildLeagueView: PlayerRow.blend, rosters and free-agent lists), counted by their words
 *   (Phase 7b, planner reply to Checkpoint 7a, 5.4: words only, never a number of the market's, leagueView.blendText;
 *   review of Phase 7b: the report still quoted the old "Our projection 210 · Trade market 170 · Used 190" line).
 * - One free agent, one team (§7; LeagueModel.faAllocation): the allocation's basis and order next to every team's
 *   pickups, and a check that no free agent is in two teams' pickups. A waiver-order allocation names the order used
 *   (waiverOrderNote, Phase 4c below).
 * - The header prints the command line the report ran with (commandText, displayPath: the dump folder and --team), so a
 *   reader can run it again on the same data.
 * - parseLeagueReport reads a committed league report's team and roster tables back, for the trade report's "what changed
 *   in the data" since Checkpoints 3 and 4.
 * - IR returners (§6, §7; irReturnerRows): every IR player, his expected return week R, whether he rejoins his team's
 *   lineups, and the player his team as it stands drops from R on to make room (returners.finalLineups, the displacement
 *   the League page's numbers and odds count).
 *
 * Phase 4c (planner reply to Checkpoint 4b; the lead's Phase 4c design, track R):
 * - One baseline everywhere (change 9): every odds reading is the headline, LeagueModel.odds (every team after its
 *   free-agent pickups), with LeagueModel.oddsAsRostersStand as the second line (the standings, the schedule's win
 *   chances, the scale check and its second set of rows, the no-op check). Seasons: the League model's own, seasons 1–
 *   shownSims of the seed's matrix (Checkpoint 7e), which are also the trade search's shown block (its ranking block the
 *   first finalSims of them, its screening block the next screeningSims).
 * - Goals (change 8): B under each "What matters most" goal (config.benefit.goals through benefit.goalWeights, the
 *   default goal config.benefit.goalDefault) wherever the report computes B (benefitWin, the scale check). Checkpoint 7c
 *   (planner reply to Checkpoint 7b, §6): "Several prizes" in place of "Balanced", on the league's split from --prizes, else
 *   the prefilled one (goalRewards); the goals named as the Settings page names them ("Only the champion", "Several prizes",
 *   "Making the playoffs": GOAL_WORDS).
 *
 * Checkpoint 7c (planner reply to Checkpoint 7b, §6 and "Checkpoint 7c must include": "Prizes, using the prizes Parker gives
 * for his league: how 3rd place is decided in his league, his odds of 1st, 2nd and 3rd, his B₃"), with --prizes
 * (scripts/lib/runMode.ts prizesArg): a League model built under the league's split as the app builds it (settingsFor: its own
 * ω, pickups and headline odds, and the weekly high scores simulated when the split pays them), and a "League prizes"
 * section (prizesReport, prizesLines): the split in whole percents, how 3rd place is decided (the Import Report's
 * "3rd-place game" row, where the league's data says it, LeagueSettings.thirdPlace, and the season simulation's rule,
 * SeasonOdds.thirdPlace), and under "Only the champion" and under the split, each from its own model: ω, B₃, my P(1st),
 * P(2nd), P(3rd), top 3 and P(playoffs). Every other "Several prizes" figure reads the split too: the scale check's column,
 * the app's own B₃ (appHelpsScales, on the split's model) and the playoff-week weight's table (the split's model's own ω:
 * playoffWeightLines). A split that pays the weekly high score is never priced from this model's runs, which didn't simulate
 * them (reward.ts assertWeeklyMeasured): the scale check simulates them itself, the rest read the split's own model. The
 * console says how --prizes was read before the long run (review FB-R2: runMode.ts prizesReadLine, then prizesSplitLine
 * once the league is loaded), since every comma starts the next prize ("2,500" is two).
 * - The waiver order used (change 5; answer 2): the data line names it as the Import Report does
 *   (importReport.waiverOrderText), and so does the allocation line (waiverOrderNote). A snapshot from before the 4c
 *   adapter (no settings.waiverOrderUsed: its ranks are ESPN's live order of the import's day) is first put on the 4c
 *   adapter's rule for a league whose order resets weekly, as Parker's does (asWeeklyResetData: ⚠️ assumed, the dump
 *   doesn't say; review of track R, R-4, so this report and the trade report run on the order the app now uses): the
 *   weekly reset order from the standings becomes Team.waiverRank and the dump's ranks Team.liveWaiverRank; both lines say
 *   so with the two orders and my place in each (pre4cText).
 * - The blend's clamp (change 4; review of track R, R-6): the formula with config.marketBlend.factorClamp, and every factor
 *   the clamp cut (BlendLines.clamped).
 * - FantasyCalc's fallback (change 12): the ID match rate is measured only when FantasyCalc's player list was read, which the
 *   data shows (fantasyCalcPlayersRead: knownIds names a player beyond the value lists' rows; review of track R, R-7: the
 *   server reads it whenever FantasyCalc served any list fresh, so a saved list alone doesn't mean it wasn't read);
 *   otherwise the report says why it isn't (the fallback, or the list's own warning), and the value rate says which list
 *   it read.
 *
 * Phase 7b (planner reply to Checkpoint 7a, §6.1; league.ts step 5c): the automatic playoff-week weight's own section
 * (playoffWeightLines): ω, measured or the fallback and why, both runs (my score + 3 in the regular-season weeks, then in the
 * playoff weeks: ΔPO and ΔCH), and the B per point and ω under each goal from the same runs (league.playoffWeightFrom). Every
 * "playoff weeks ×" label reads the model's ω (LeagueModel.playoffWeight). The thresholds in ROS lineup points under ω (review
 * of the engine track; LeagueModel.lineupThresholds, config's × Σω ÷ Σω₀: thresholdsLine) are printed there, and the
 * optimizer's and the trade chips' sections quote the model's own (thresholdText).
 *
 * Everything after the network is buildReport (pure but for the clock and the model builds it times), which
 * scripts/league-report.test.ts runs offline on Parker's committed sanitized fixture with synthetic inputs.
 *
 * Privacy (CLAUDE.md §0.5, §0.6): team, owner and league names are replaced with placeholders before
 * anything is rendered, and the output is scrubbed with the .env.local secrets and the redaction map.
 * NFL player names are public. Output: reports/league-report.md and a short console summary.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { importEspnLeagueForModel } from "@/adapters/espn";
import { espnWaiverOrder } from "@/adapters/espn/waivers";
import type { ImportDeps } from "@/adapters/types";
import { loadPlayerIdResolver } from "@/data";
import { goalWeights, helpsScale, marketSanity, marketWeekly, protectValueWeight, tradeScore } from "@/engine/benefit";
import { paysWeekly, prizeOddsOf, prizePercents, prizePeriods, prizeShares, rewardWith, runPrizeDeltas, shareChange, type PrizeDeltas, type PrizeOdds, type Reward } from "@/engine/reward";
import type { BlendPosition } from "@/engine/blend";
import { config } from "@/engine/config";
import type { MarketInputs, ModelInputs } from "@/engine/inputs";
import { buildLeagueModel, buildLeagueModelWithContext, buildProjectionTable, leagueMarginals, playoffWeightFrom, streamIds, tableWithStreaming, teamWeeks, type LeagueContext, type LeagueMarginals } from "@/engine/league";
import type { FaAllocation, FaMove, LeagueModel, LineupThresholds, PlayerModel, PlayoffWeightFallback, SeasonOdds, TeamOdds, TradeChip } from "@/engine/leagueModel";
import { prepareLeagueSlots } from "@/engine/lineup";
import { fantasyCalcFallbackText, fantasyCalcFormatLabel } from "@/engine/market";
import { POSITIONS, type InjuryStatus, type LeagueSettings, type LeagueSnapshot, type PlayerInfo, type Pos, type Team } from "@/engine/model";
import { returnersOf } from "@/engine/optimizer";
import { agreementAside } from "@/engine/projections";
import { finalLineups } from "@/engine/returners";
import { buildSimSetup, pickupSeasonModel, playoffRounds, seasonOdds, shownSimsOf, type SeasonModel, type SimSetupResult } from "@/engine/season";
import { simNormals, simulateSeason, type SimNormals, type SimResult, type SimSetup } from "@/engine/sim";
import { GOALS, PRIZE_KEYS, PROTECT_VALUE_LEVELS, defaultTradeSettings, type Goal, type PrizeAmounts, type PrizeKey, type ProtectValue, type TradeSettings } from "@/engine/settings";
import { evLineups, rosValue, scenarioLineups } from "@/engine/teamValue";
import { prizeSplitText } from "@/components/settings/settingsView";
import { thirdPlaceText, waiverOrderText } from "@/lib/importReport";
import { posLabel } from "@/lib/labels";
import { RISKY_BYES, RISKY_WIN_CHANCE, SEASON_OVER_TEXT, blendIsOwnPoint, buildLeagueView, lastNflWeekOf, scheduleByeRule } from "@/lib/leagueView";
import { FileCache } from "@/server/cache";
import { createHttpClient } from "@/server/http";
import { buildModelInputs } from "@/server/modelInputs";
import { ROOT, env, loadEnv } from "./lib/env";
import { redactorFromMap } from "./lib/minimize";
import { installConsoleScrubber, registerScrubber, scrubEverything, scrubEverythingExcept } from "./lib/redact";
import { commandText, isMainModule, prizesReadLine, relativePath, reportArgs, reportCommandText, reportSourceLine, setNetworkMode, wantsLive, type ReportArgs } from "./lib/runMode";

// The command-line helpers moved to scripts/lib/runMode.ts (Phase 7a, A5); kept importable from here (trade-report, tests).
export { commandText, displayPath, flagValue, relativePath } from "./lib/runMode";

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

// ---------------------------------------------------------------------------------------------
// The offline dump (both reports read it; which one: scripts/lib/runMode.ts reportArgs, default the newest)

/** A placeholder dump of Parker's league (git-ignored): what loadDump reads. */
export interface Dump {
  /** The dump's snapshot with placeholders put on again (the report never trusts a file to have them), its team from --team or the dump. */
  snapshot: LeagueSnapshot;
  inputs: ModelInputs;
  /** The engine's `now`: the moment the dump was made (meta.json). */
  now: Date;
  dumpedAt: string;
  /**
   * The waiver ranks read from the dump folder's waiver-ranks.json (a dump made before the ESPN adapter read
   * teams[].waiverRank: data-local/parker-league-oct3 has one), applied only when no team in the snapshot has a rank: when
   * it was read, and how many teams got one. Null when nothing was applied.
   */
  waiverRanks: { readAt: string | null; teams: number } | null;
}

/** A waiver rank the engine reads: a whole number ≥ 1 (league.ts allocationOrder), else undefined. */
function waiverRankOf(x: unknown): number | undefined {
  return typeof x === "number" && Number.isInteger(x) && x >= 1 ? x : undefined;
}

/**
 * The offline dump in `dir` (snapshot.json, inputs.json, meta.json with `now`; data-local/dump-final.ts writes them with
 * the app's own import and model-inputs builder, team and owner names already placeholders). `teamArg` (--team) picks my
 * team; else the dump's. A waiver-ranks.json next to them fills in waiver ranks when the snapshot has none (Dump.waiverRanks).
 */
export function loadDump(dir: string, teamArg?: string): Dump {
  const read = <T>(file: string): T => JSON.parse(readFileSync(path.join(dir, file), "utf8")) as T;
  const raw = read<LeagueSnapshot>("snapshot.json");
  const inputs = read<ModelInputs>("inputs.json");
  const meta = read<{ now?: unknown }>("meta.json");
  const now = new Date(typeof meta.now === "string" ? meta.now : Number.NaN);
  if (Number.isNaN(now.getTime())) throw new Error(`${path.join(dir, "meta.json")} has no valid \`now\`.`);
  let teams = raw.teams;
  let waiverRanks: Dump["waiverRanks"] = null;
  const ranksFile = path.join(dir, "waiver-ranks.json");
  if (existsSync(ranksFile) && !raw.teams.some((t) => waiverRankOf(t.waiverRank) !== undefined)) {
    const file = JSON.parse(readFileSync(ranksFile, "utf8")) as { readAt?: unknown; ranks?: Record<string, unknown> };
    teams = raw.teams.map((t) => {
      const r = waiverRankOf(file.ranks?.[t.id]);
      return r === undefined ? t : { ...t, waiverRank: r };
    });
    waiverRanks = { readAt: typeof file.readAt === "string" ? file.readAt : null, teams: teams.filter((t) => t.waiverRank !== undefined).length };
  }
  return { snapshot: placeholders({ ...raw, teams, myTeamId: teamArg ?? raw.myTeamId }), inputs, now, dumpedAt: meta.now as string, waiverRanks };
}

/** The report's data line for an offline dump: where it came from, when, and the waiver ranks when they were filled in. */
export function dumpNote(root: string, dir: string, dump: Pick<Dump, "dumpedAt" | "waiverRanks">): string {
  const ranks = dump.waiverRanks ? ` Waiver ranks for ${dump.waiverRanks.teams} teams come from the dump folder's waiver-ranks.json${dump.waiverRanks.readAt ? ` (read from ESPN at ${dump.waiverRanks.readAt})` : ""}: the dump was made before the adapter read them.` : "";
  return `Offline: the git-ignored dump in ${relativePath(root, dir)}/ (made by the app's own import and model-inputs builder at ${dump.dumpedAt}, team and owner names placeholders); the engine's "now" is that moment.${ranks}`;
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

/** The week weights the model's lineup costs use: a week already under way counts 0 (review SPEC-1), playoff weeks the model's playoff weight. */
function modelWeights(model: LeagueModel): Float64Array {
  return teamWeeks(model, model.inProgressWeek, { ...config.lineups, playoffWeight: model.playoffWeight }).weights;
}

/**
 * Depth values (section "Depth") from the projection table the model used (same scenarios and seed), with the
 * model's streaming rows: a team's lineups count its streamed slots as the model's do (league.tableWithStreaming).
 */
function depthValues(snapshot: LeagueSnapshot, inputs: ModelInputs, model: LeagueModel, now: Date): DepthOf {
  const table = tableWithStreaming(buildProjectionTable(snapshot, inputs, { now, scenarios: model.scenarios }), model);
  const slots = prepareLeagueSlots(snapshot.settings);
  const weights = modelWeights(model);
  const rosters = new Map(snapshot.teams.map((t) => [t.id, [...t.roster.filter((id) => table.rows.has(id)), ...streamIds(model, t.id)]]));
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
/** The scale check's lineup gains, points per week in every remaining week a trade can change (planner reply to Checkpoint 2: +1, +3 and +6). */
export const SCALE_GAINS: readonly number[] = [1, 3, 6];
/**
 * Batches the scale check splits its run into for the Monte Carlo standard errors (batchRuns, batchSe): 20
 * batches of 250 seasons at 5,000. A report-only choice, not a tunable. The standard error's own relative
 * error is about 1 / √(2 × (batches − 1)), 16% at 20.
 */
export const SE_BATCHES = 20;
/**
 * The planner's toy league (CLAUDE.md §10 "Planner's check": 12 teams, 10 weeks left): B and the Trade Score per gain, the
 * scores the self-calibrating scale aims for everywhere (planner reply to Checkpoint 4c, A2: 28, 63 and 86).
 */
const PLANNER_TOY: Readonly<Record<number, { B: number; score: number }>> = { 1: { B: 1.7, score: 29 }, 3: { B: 5, score: 63 }, 6: { B: 10, score: 86 } };

/** One value per "What matters most" goal (GOALS, config.benefit.goals). */
export type ByGoal<T> = Record<Goal, T>;

/** A value for every goal, in GOALS order. */
export function byGoal<T>(f: (goal: Goal) => T): ByGoal<T> {
  return Object.fromEntries(GOALS.map((g) => [g, f(g)])) as ByGoal<T>;
}

/**
 * The goals' names as the report words them: the Settings page's "What does your league reward?" options (Checkpoint 7c;
 * planner reply to Checkpoint 7b, §6, whose words they are: "Only the champion", "Several prizes", "Making the playoffs").
 * Phase 4c to Checkpoint 7b's reports said "Win the title", "Balanced" and "Make the playoffs".
 */
export const GOAL_WORDS: Readonly<Record<Goal, string>> = { title: "Only the champion", prizes: "Several prizes", playoffs: "Making the playoffs" };

/**
 * Each goal's reward on a league with `periods` prize periods (reward.ts rewardWith): "Only the champion" and "Making the
 * playoffs" pay 1st place everything; "Several prizes" `own`'s split when `own` is one (the model's own reward: its user's
 * prizes), else `prizes` (Checkpoint 7c: the report's --prizes, the league's own split), else ⚠️ the prefilled split
 * (config.benefit.prizesDefault).
 */
export function goalRewards(periods: number, own?: Reward | null, prizes?: PrizeAmounts | null): ByGoal<Reward> {
  return byGoal((g) => (own && own.goal === g ? own : rewardWith({ goal: g, prizes: prizes ?? config.benefit.prizesDefault }, periods)));
}

/**
 * §10's B_win in percentage points under a reward: 100 × (w_PO ΔPO + w_S ΔE[S]), ΔPO and the prize components' changes as
 * fractions (benefit.goalWeights: config.benefit.goals; reward.ts shareChange: only the prizes that pay are read, so ΔE[S] is
 * ΔCH when 1st place pays everything). NaN when a paid prize's change is unknown (the rows' "title odds unknown").
 */
export function benefitWin(dPO: number, dPrizes: Partial<PrizeDeltas>, reward: Reward): number {
  const w = goalWeights(reward.goal);
  const dES = shareChange(dPrizes, reward);
  return dES === null ? Number.NaN : 100 * (w.playoffs * dPO + w.prizes * dES);
}

/** A team's weekly score distribution per model week (TeamModel.score, scoreWithPickups). */
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

/** `score` with `x` points added to every week's mean from model week `from` on (the SDs unchanged). */
const plus = (score: WeeklyScores, x: number, from: number): WeeklyScores => ({ mean: score.mean.map((m, i) => (i >= from ? m + x : m)), sd: [...score.sd] });

const oddsOf = (odds: SeasonOdds | null | undefined, teamId: string): TeamOdds | null => odds?.teams.find((t) => t.teamId === teamId) ?? null;

/**
 * The first model week a trade can change, which the scale check adds its gain from: 1 when the model's first week is under
 * way (evaluate.ts holds that week at the as-stands score before and after every trade), else 0.
 */
export function scaleFrom(model: Pick<LeagueModel, "weeks" | "inProgressWeek">): number {
  return model.inProgressWeek !== null && model.weeks[0] === model.inProgressWeek ? 1 : 0;
}

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

/**
 * The team's odds in one simulated run: P(playoffs), P(title) (null = unknown) and expected wins, and (Checkpoint 7c) its
 * prize components (reward.ts PrizeOdds).
 */
export type MyOdds = Pick<TeamOdds, "pPlayoffs" | "pTitle" | "expWins"> & { prizes: PrizeOdds };

/**
 * §10's changes from one run's odds to another's: ΔPO and ΔCH as fractions, Δ expected wins, every prize component's change
 * (Checkpoint 7c) and B under each goal.
 */
export interface Deltas {
  dPO: number;
  dCH: number;
  dEW: number;
  /** Every prize component's change (reward.ts runPrizeDeltas; null where unknown, the weekly high scores' unless simulated). */
  dPrizes: PrizeDeltas;
  /** B (benefitWin; no market term: only lineup points move) under each goal's reward; NaN when a paid prize's change is unknown. */
  B: ByGoal<number>;
}

/** A Deltas' standard errors (deltasSe): the prize components have none. */
export type DeltasSe = Omit<Deltas, "dPrizes">;

const UNKNOWN_ODDS: MyOdds = { pPlayoffs: Number.NaN, pTitle: null, expWins: Number.NaN, prizes: { first: null, second: null, third: null, weeklyHigh: Number.NaN, pointsLeader: Number.NaN } };

/** A team's odds in a run as the report reads them (MyOdds), from its TeamOdds. */
function myOddsOf(o: TeamOdds): MyOdds {
  return { pPlayoffs: o.pPlayoffs, pTitle: o.pTitle, expWins: o.expWins, prizes: prizeOddsOf(o) };
}

/** The changes from `from` to `to` (B under each goal's reward, `rewards`): ΔCH is NaN when either title chance is unknown. */
function deltas(from: MyOdds, to: MyOdds, rewards: ByGoal<Reward>): Deltas {
  const dPO = to.pPlayoffs - from.pPlayoffs;
  const dCH = to.pTitle !== null && from.pTitle !== null ? to.pTitle - from.pTitle : Number.NaN;
  // The weekly high scores were simulated when a goal's reward pays them (scaleCheck's rule), else their change is unknown.
  const dPrizes = runPrizeDeltas(from.prizes, to.prizes, GOALS.some((g) => paysWeekly(rewards[g])));
  return { dPO, dCH, dEW: to.expWins - from.expWins, dPrizes, B: byGoal((g) => benefitWin(dPO, dPrizes, rewards[g])) };
}

/** Each change's Monte Carlo standard error from its values in the batches (batchSe). */
function deltasSe(parts: readonly Deltas[], batchSims: number, sims: number): DeltasSe {
  const se = (f: (d: Deltas) => number) => batchSe(parts.map(f), batchSims, sims);
  return { dPO: se((d) => d.dPO), dCH: se((d) => d.dCH), dEW: se((d) => d.dEW), B: byGoal((g) => se((d) => d.B[g])) };
}

export interface ScaleRow extends Deltas {
  /** Points per week added to the weekly score mean in every remaining week a trade can change (ScaleCheck.from on). */
  gain: number;
  /** Helps you under each goal on that goal's B₃ (ScaleCheck.b3; benefit.tradeScore). */
  score: ByGoal<number | null>;
  /** Each change's Monte Carlo standard error (batch means: batchRuns, batchSe); NaN when it can't be estimated. */
  se: DeltasSe;
}

/** One goal's B₃ in a scale check (ScaleCheck.b3). */
export interface ScaleB3 {
  /**
   * B of the +config.benefit.helpsGain row under the goal (benefit.helpsScale's raw); with title odds unknown, the playoff
   * term scaled up to the whole weight, as the app scores every card then (`playoffOnly`; review of track SC, SC-3: the
   * report had printed none while the app had one). Null only when the +helpsGain run has no odds.
   */
  raw: number | null;
  /** raw floored at config.benefit.helpsFloor: the scale Helps you is scored on; null with raw. */
  value: number | null;
  floored: boolean;
  /** A paid prize's odds are unknown (title odds, under the title-only goals): B₃ counts the playoff odds alone (benefit.benefitWin's rule for every trade's B). */
  playoffOnly: boolean;
  /**
   * B(+helpsGain)'s Monte Carlo standard error (the row's); null when the row wasn't among the check's gains, when title odds
   * are unknown (no rows, so no batches), or raw is null.
   */
  se: number | null;
}

export interface ScaleCheck {
  /** The baseline's odds for the team. */
  base: MyOdds;
  /** Checkpoint 7c: each goal's reward the rows' B and B₃ read (goalRewards: the league's prize periods). */
  rewards: ByGoal<Reward>;
  /**
   * The baseline in each batch of the run (batchRuns). Another baseline on the same run takes the standard
   * error of its change from these (pickupsEffect). Empty when title odds are unknown: no row needs them.
   */
  baseBatches: MyOdds[];
  /** The run's batches (batchRuns): how many, and seasons in each (0 and 0 when the run is too short to split). */
  batches: number;
  batchSims: number;
  /** The first model week the gain is added to (scaleFrom: 1 when the first week is under way). */
  from: number;
  /** One row per gain; null when title odds are unknown (B needs ΔCH). */
  rows: ScaleRow[] | null;
  /** Why title odds are unknown, when the report can confirm it (titleUnknownReason); null otherwise. */
  titleUnknown: string | null;
  /**
   * Per goal: B₃, the "Helps you" scale (Phase 7a, planner reply to Checkpoint 4c, A2): the +config.benefit.helpsGain row's
   * ΔPO and ΔCH through benefit.helpsScale (simulated on its own when the gains leave it out, and when title odds are unknown:
   * then ΔPO alone, as the app's), and B(+3)'s error.
   */
  b3: ByGoal<ScaleB3>;
  /**
   * The +helpsGain row's ΔPO and ΔCH (the calibration run as the League model makes it, step 8c; ΔCH null when title odds are
   * unknown, as LeagueModel.helpsCalibration's); null when that run has no odds.
   */
  calibration: { dPO: number; dCH: number | null } | null;
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
export function titleUnknownReason(snapshot: LeagueSnapshot, odds: SeasonOdds, mine: Pick<MyOdds, "pTitle">): string | null {
  if (mine.pTitle !== null) return null;
  if (!odds.playoffsKnown) return "a playoff game already played has no result we can read or match to the bracket";
  const N = odds.playoffTeams;
  return N >= 2 && playoffRounds(snapshot.settings).length < roundsNeeded(N) ? `the league's playoff schedule has fewer rounds than a bracket of ${N} teams needs` : null;
}

/**
 * scaleCheck's options: the gains (default SCALE_GAINS), the first model week they're added from (default 0), the batches
 * (default SE_BATCHES) and each goal's reward (default goalRewards on the league's prize periods).
 */
export interface ScaleOptions {
  gains?: readonly number[];
  from?: number;
  batches?: number;
  rewards?: ByGoal<Reward>;
}

/**
 * The "Helps you" scale check (the file header) for one team from `base` (its weekly scores in `model`, the season
 * simulated: the one baseline's pickupSeasonModel with TeamModel.scoreWithPickups, or the model as rosters stand with
 * TeamModel.score). The season is simulated with base, then with base + gain in every model week from `opts.from` on,
 * all on `run`'s matrix; each gain is then simulated again in every batch (batchRuns) for its standard errors. B under
 * every goal (benefitWin), B₃ under every goal (the +config.benefit.helpsGain row through benefit.helpsScale, as the engine
 * makes it: helpsCalibrationOf's run is this row when `model`, `run` and `opts.from` are the League model's), and Helps you
 * on it. Null when the season can't be simulated.
 */
export function scaleCheck(snapshot: LeagueSnapshot, model: SeasonModel, teamId: string, base: WeeklyScores, run: SharedRun, opts: ScaleOptions = {}): ScaleCheck | null {
  const gains = opts.gains ?? SCALE_GAINS;
  const from = Math.max(0, Math.floor(opts.from ?? 0));
  const rewards = opts.rewards ?? goalRewards(prizePeriods(snapshot));
  // The weekly high scores when a goal's reward pays them (reward.ts paysWeekly; ⚠️ never with the prefilled split).
  const highScores = GOALS.some((g) => paysWeekly(rewards[g]));
  const simulate = (score: WeeklyScores, r: SharedRun) => seasonOdds(snapshot, withScore(model, teamId, score), { sims: r.sims, seed: r.seed, normals: r.normals, highScores });
  const mine = (odds: SeasonOdds | null): MyOdds | null => {
    const o = oddsOf(odds, teamId);
    return o ? myOddsOf(o) : null;
  };
  const baseOdds = simulate(base, run);
  const b = mine(baseOdds);
  if (!baseOdds || !b) return null;
  const parts = batchRuns(run, opts.batches ?? SE_BATCHES);
  const batchSims = parts[0]?.sims ?? 0;
  const inBatches = (score: WeeklyScores): MyOdds[] => parts.map((p) => mine(simulate(score, p)) ?? UNKNOWN_ODDS);
  const known = b.pTitle !== null;
  const baseBatches = known ? inBatches(base) : [];
  const measured = !known
    ? null
    : gains.map((gain) => {
        const score = plus(base, gain, from);
        const d = deltas(b, mine(simulate(score, run)) ?? UNKNOWN_ODDS, rewards);
        // The same change in each batch, against the baseline's same seasons: the standard error.
        const se = deltasSe(
          inBatches(score).map((o, j) => deltas(baseBatches[j] as MyOdds, o, rewards)),
          batchSims,
          run.sims,
        );
        return { gain, ...d, se };
      });
  // B₃ under each goal (planner reply to Checkpoint 4c, A2): the +helpsGain row, simulated alone when the gains leave it out
  // or title odds are unknown (review of track SC, SC-3: then ΔPO alone, the app's own B₃ by benefit.benefitWin's rule).
  const gainB3 = config.benefit.helpsGain;
  const at: Deltas & { se: DeltasSe | null } = measured?.find((r) => r.gain === gainB3) ?? { ...deltas(b, mine(simulate(plus(base, gainB3, from), run)) ?? UNKNOWN_ODDS, rewards), se: null };
  const dCH3 = Number.isNaN(at.dCH) ? null : at.dCH;
  const b3 = byGoal((g): ScaleB3 => {
    const s = helpsScale({ dPO: at.dPO, dCH: dCH3, dPrizes: at.dPrizes }, { leagueType: snapshot.settings.leagueType, myPPlayoffs: b.pPlayoffs, reward: rewards[g], dynastyTotal: null });
    return { raw: s?.raw ?? null, value: s?.b3 ?? null, floored: s?.floored ?? false, playoffOnly: s !== null && shareChange(at.dPrizes, rewards[g]) === null, se: s && at.se ? at.se.B[g] : null };
  });
  const rows: ScaleRow[] | null = measured?.map((r) => ({ ...r, score: byGoal((g) => tradeScore(r.B[g], b3[g].value)) })) ?? null;
  return {
    base: b,
    rewards,
    baseBatches,
    batches: parts.length,
    batchSims,
    from,
    rows,
    titleUnknown: titleUnknownReason(snapshot, baseOdds, b),
    b3,
    calibration: Number.isFinite(at.dPO) ? { dPO: at.dPO, dCH: dCH3 } : null,
  };
}

/**
 * Whether a scale check's +helpsGain row is the League model's own calibration run (LeagueModel.helpsCalibration, step 8c):
 * the same gain, ΔPO and ΔCH bitwise (ΔCH null in both when title odds are unknown). Null when either is missing (no odds,
 * no team).
 */
export function calibrationMatches(check: Pick<ScaleCheck, "calibration"> | null, cal: { gain: number; dPO: number; dCH: number | null } | null | undefined): boolean | null {
  if (!check?.calibration || !cal) return null;
  return cal.gain === config.benefit.helpsGain && Object.is(check.calibration.dPO, cal.dPO) && Object.is(check.calibration.dCH, cal.dCH);
}

/** Every team's free-agent pickups' own effect on my odds (the one baseline against as rosters stand; pickupsEffect). */
export interface PickupsEffect extends Deltas {
  /** Paired on the same batches of the same run (NaN when the two checks' batches don't pair up). */
  se: DeltasSe;
}

/**
 * The change from the odds as rosters stand to the one baseline's (every team after its pickups) for my team, from the two
 * scale checks' baselines on the same run: paired season by season, so its standard error comes from their batches
 * pairwise. Null when title odds are unknown in either.
 */
export function pickupsEffect(withPickups: ScaleCheck, asStands: ScaleCheck, sims: number): PickupsEffect | null {
  if (withPickups.base.pTitle === null || asStands.base.pTitle === null) return null;
  const d = deltas(asStands.base, withPickups.base, withPickups.rewards);
  const paired = withPickups.batchSims === asStands.batchSims && withPickups.baseBatches.length === asStands.baseBatches.length;
  const parts = paired ? withPickups.baseBatches.map((o, j) => deltas(asStands.baseBatches[j] as MyOdds, o, withPickups.rewards)) : [];
  return { ...d, se: deltasSe(parts, withPickups.batchSims, sims) };
}

// ---------------------------------------------------------------------------------------------
// Phase 4, track A2: the free-agent optimizer (V*) in numbers

/** Players the report follows by name under the optimizer (Checkpoint 4: "the Bo Nix → Team 1 example, McCaffrey's chip gap"): public NFL names, and the team each example is about (null = his best one). */
export const OPTIMIZER_EXAMPLES: readonly { name: string; teamId: string | null }[] = [
  { name: "Bo Nix", teamId: "1" },
  { name: "Christian McCaffrey", teamId: null },
];

/** One player's marginal values under V* (step 5 and 6 of league.ts): what his team loses, what each other team gains, and his chip. */
export interface OptimizerExample {
  name: string;
  playerId: string | null;
  /** His team, or null when he isn't on a roster. */
  teamId: string | null;
  /** The team the example is about (OPTIMIZER_EXAMPLES), or null; and why it can't take him, when it can't. */
  focusTeamId: string | null;
  focusBlocked: ReturnType<LeagueMarginals["mvAddBlocked"]>;
  cost: { ev: number; scen: number | null; autoAdd: string | null } | null;
  /** MV_add to every other team (unfloored, as leagueMarginals gives it), with the player that team drops to make room. */
  adds: { teamId: string; ev: number; scen: number | null; drop: string | null }[];
  /** His trade chip, when he is one (TeamModel.chips). */
  chip: TradeChip | null;
}

/** The free-agent optimizer's numbers (track A2): moves per team and their count distribution, and the named examples. */
export interface OptimizerReport {
  /** Moves per team, in snapshot order. */
  moves: { teamId: string; moves: FaMove[] }[];
  /** How many teams make 0, 1, … faMaxMoves moves. */
  distribution: number[];
  examples: OptimizerExample[];
}

/**
 * What V*(T) judges its moves by (src/engine/optimizer.ts, "Judging moves in scenario lineups"; league.ts step 5):
 * "scenario" when the League model runs availability scenarios and the league has no starter limits (the gain in
 * scenario lineups, the lineups B and the lineup costs are measured in); "ev" in an expected-value-only run; "evLimits"
 * under starter limits (⚠️ the optimizer judges in EV lineups there). The re-runs behind lineup costs and MV_add
 * (optimizer.reoptimize) always judge by the EV gain.
 */
export type OptimizerJudging = "scenario" | "ev" | "evLimits";

export function optimizerJudging(snapshot: LeagueSnapshot, model: Pick<LeagueModel, "scenarios">): OptimizerJudging {
  if (!(model.scenarios > 0)) return "ev";
  return prepareLeagueSlots(snapshot.settings).limits !== null ? "evLimits" : "scenario";
}

/**
 * The optimizer's rule in words (this report's and the trade report's optimizer sections): what its moves are judged by.
 * `minGain`: the least gain a move needs, as the report quotes it (thresholdText; default config.freeAgentOptimizer.faMinGain).
 */
export function optimizerJudgingText(judging: OptimizerJudging, scenarios: number, minGain: string = `${config.freeAgentOptimizer.faMinGain}`): string {
  if (judging === "scenario") return `by their gain in scenario lineups (S = ${scenarios}), the lineups B and the lineup costs are measured in, so a depth pickup that rarely starts in the average-case lineup can still qualify; the expected-value gain is shown for reference (it can be under ${minGain}, even below 0, for such a pickup)`;
  if (judging === "evLimits") return `by their expected-value gain (⚠️ under starter limits the optimizer judges in expected-value lineups even when scenarios run); the scenario gain is shown for reference`;
  return "by their expected-value gain (this run has no availability scenarios)";
}

/** The optimizer report from the League model and leagueMarginals (the same rules, outside the model). */
export function optimizerReport(snapshot: LeagueSnapshot, model: LeagueModel, marginals: LeagueMarginals): OptimizerReport {
  const moves = model.teams.map((t) => ({ teamId: t.id, moves: t.faMoves }));
  const distribution = new Array<number>(config.freeAgentOptimizer.faMaxMoves + 1).fill(0);
  for (const m of moves) distribution[Math.min(m.moves.length, distribution.length - 1)] = (distribution[Math.min(m.moves.length, distribution.length - 1)] ?? 0) + 1;
  const examples = OPTIMIZER_EXAMPLES.map(({ name, teamId: focusTeamId }) => {
    const playerId = Object.keys(snapshot.players).find((id) => snapshot.players[id]?.name === name) ?? null;
    const team = playerId ? snapshot.teams.find((t) => t.roster.includes(playerId)) : undefined;
    const teamId = team?.id ?? null;
    const cost = playerId && teamId ? marginals.mvLose(teamId, playerId) : null;
    const adds = playerId
      ? snapshot.teams.flatMap((t) => {
          if (t.id === teamId) return [];
          const a = marginals.mvAdd(t.id, playerId);
          return a ? [{ teamId: t.id, ev: a.ev, scen: a.scen, drop: a.drop }] : [];
        })
      : [];
    const chip = playerId && teamId ? (model.teams.find((t) => t.id === teamId)?.chips.find((c) => c.playerId === playerId) ?? null) : null;
    const focusBlocked = focusTeamId && playerId ? marginals.mvAddBlocked(focusTeamId, playerId) : null;
    return { name, playerId, teamId, focusTeamId, focusBlocked, cost, adds, chip };
  });
  return { moves, distribution, examples };
}

// ---------------------------------------------------------------------------------------------
// Phase 4b: the market blend, one free agent one team, IR returners

/** The free agents two or more teams pick up (TeamModel.faMoves' adds; each team counted once), by player id. */
export function duplicatePickups(teams: readonly { id: string; faMoves: readonly FaMove[] }[]): { playerId: string; teamIds: string[] }[] {
  const by = new Map<string, string[]>();
  for (const t of teams) for (const id of new Set(t.faMoves.map((m) => m.add))) by.set(id, [...(by.get(id) ?? []), t.id]);
  return [...by]
    .filter(([, ids]) => ids.length > 1)
    .map(([playerId, teamIds]) => ({ playerId, teamIds }))
    .sort((a, b) => b.teamIds.length - a.teamIds.length || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0));
}

/** The allocation's basis in words (LeagueModel.faAllocation; league.ts allocationOrder). */
export function allocationBasisText(basis: FaAllocation["basis"]): string {
  if (basis === "faab") return "remaining FAAB budget, the most first";
  if (basis === "waiver") return "the league's waiver order (Team.waiverRank)";
  return "each team's best available gain first (the league reports no waiver order)";
}

/**
 * The waiver order a weekly reset would give today (CLAUDE.md §2.2: at ESPN's weekly reset, rank = number of teams + 1 −
 * the team's seed; the 4c adapter's rule in a league without divisions): today's standings by the league's rules reversed
 * (TeamOdds.rank; the last-placed team claims first). Null without odds.
 */
export function resetWaiverOrder(model: Pick<LeagueModel, "odds">): string[] | null {
  const teams = model.odds?.teams;
  if (!teams?.length) return null;
  return [...teams].sort((a, b) => b.rank - a.rank || (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0)).map((t) => t.teamId);
}

/**
 * Whether a snapshot's waiver ranks come from before the 4c adapter (the file header, Phase 4c): every team has one (so the
 * allocation follows them) but settings.waiverOrderUsed is absent. The 4c adapters set it whenever every team is ranked, so
 * such ranks are Phase 4b's: ESPN's live order of the import's day (data-local/parker-league-final's).
 */
export function waiverRanksPre4c(snapshot: Pick<LeagueSnapshot, "settings" | "teams">): boolean {
  return snapshot.settings.waiverOrderUsed === undefined && snapshot.teams.length > 0 && snapshot.teams.every((t) => typeof t.waiverRank === "number" && Number.isInteger(t.waiverRank) && t.waiverRank >= 1);
}

/** How a report put a snapshot from before the 4c adapter on the 4c rule (asWeeklyResetData). */
export interface Pre4cOrder {
  /** The dump's own order (its ranks: ESPN's live order on the day of the import; now Team.liveWaiverRank), first claim first. */
  live: string[];
  /** The order the report runs on (Team.waiverRank: the weekly reset order once a game has been played), and which one it is. */
  used: string[];
  waiverOrderUsed: NonNullable<LeagueSettings["waiverOrderUsed"]>;
}

/** Team ids by a rank, first claim first (ties: the id). */
function orderBy(teams: readonly Team[], rank: (t: Team) => number | undefined): string[] {
  const r = (t: Team) => rank(t) ?? Number.POSITIVE_INFINITY;
  return [...teams].sort((a, b) => r(a) - r(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((t) => t.id);
}

/**
 * A snapshot from before the 4c adapter (waiverRanksPre4c) put on the 4c adapter's rule, so a report on an old dump runs on
 * the order the app now uses everywhere (the file header, Phase 4c; review of track R, R-4: the trade report's search and
 * the odds' headline used different orders): ESPN's own rule (src/adapters/espn/waivers.ts espnWaiverOrder) for a league
 * whose order resets weekly, as Parker's does (acquisitionSettings.waiverOrderReset true in his sanitized fixture, track AD;
 * ⚠️ assumed for such a dump, whose snapshot doesn't say). Once a game has been played that is Team.waiverRank = the weekly
 * reset order (the dump carries no playoff seeds, so the reverse of the overall standings: worst win percentage first, then
 * fewer points for), Team.liveWaiverRank = the dump's ranks, settings.waiverOrderUsed "weeklyReset" ("faab" in a FAAB league,
 * whose ties it breaks; before any game the dump's own order stays, "live", as the adapter keeps it); the adapter's warnings
 * join the snapshot's. Data from the 4c adapter comes back unchanged, with null.
 */
export function asWeeklyResetData(snapshot: LeagueSnapshot): { snapshot: LeagueSnapshot; pre4c: Pre4cOrder | null } {
  if (!waiverRanksPre4c(snapshot)) return { snapshot, pre4c: null };
  const order = espnWaiverOrder(
    snapshot.teams.map((t) => ({ id: t.id, waiverRank: t.waiverRank ?? null, record: t.record, pointsFor: t.pointsFor })),
    { faab: snapshot.settings.faabBudget !== undefined, acquisitionType: null, waiverOrderReset: true, orderEdited: false, divisions: (snapshot.settings.divisions?.length ?? 0) >= 2 },
  );
  if (!order.used) return { snapshot, pre4c: null };
  const teams = snapshot.teams.map((t) => {
    const r = order.ranks.get(t.id) ?? {};
    const { waiverRank: _rank, liveWaiverRank: _live, ...rest } = t;
    void _rank;
    void _live;
    return { ...rest, ...(r.waiverRank !== undefined ? { waiverRank: r.waiverRank } : {}), ...(r.liveWaiverRank !== undefined ? { liveWaiverRank: r.liveWaiverRank } : {}) };
  });
  const converted: LeagueSnapshot = { ...snapshot, settings: { ...snapshot.settings, waiverOrderUsed: order.used }, teams, warnings: [...snapshot.warnings, ...order.warnings] };
  return { snapshot: converted, pre4c: { live: orderBy(snapshot.teams, (t) => t.waiverRank), used: orderBy(teams, (t) => t.waiverRank), waiverOrderUsed: order.used } };
}

/**
 * A team order with my place in it: "Team 2 > Team 4 > … > Team 6; you claim 4th" (a clause of its own: "Team 6 (you claim
 * 4th)" read as if the last team were mine).
 */
export function orderText(order: readonly string[], myTeamId: string | null, teamName: (id: string) => string, claim = "claim"): string {
  const place = myTeamId ? order.indexOf(myTeamId) : -1;
  return `${order.map((id) => teamName(id)).join(" > ")}${place >= 0 ? `; you ${claim} ${ordinal(place + 1)}` : ""}`;
}

/**
 * What a report says about a dump it put on the 4c rule (asWeeklyResetData): the ⚠️, the order it runs on, and the dump's
 * own (ESPN's live order on the day of the import) with my place in each.
 */
export function pre4cText(p: Pre4cOrder, myTeamId: string | null, teamName: (id: string) => string): string {
  const runsOn =
    p.waiverOrderUsed === "live"
      ? "the dump's own order: no game had been played, so there were no standings to reset to"
      : `the weekly reset order from today's standings${p.waiverOrderUsed === "faab" ? " (it breaks ties between equal FAAB budgets)" : ""}: ${orderText(p.used, myTeamId, teamName)}, and the dump's ranks become the live order (Team.liveWaiverRank)`;
  return `⚠️ This dump comes from before the 4c adapter, so its waiver ranks are ESPN's live order on the day of the import (${orderText(p.live, myTeamId, teamName, "claimed")}). The report puts it on the 4c adapter's rule for a league whose order resets weekly, as Parker's does (src/adapters/espn/waivers.ts; ⚠️ assumed: the dump doesn't say), so every number here runs on ${runsOn}.`;
}

/**
 * The waiver order a waiver-order allocation used (`order`, LeagueModel.faAllocation's), in words (the file header, Phase
 * 4c; planner reply to Checkpoint 4b, answer 2 and change 5): the Import Report's row (importReport.waiverOrderText) and
 * the order with my place; for a dump the report put on the 4c rule (`pre4c`, asWeeklyResetData), what it did (pre4cText).
 * For a snapshot still from before the 4c adapter (waiverRanksPre4c: a caller that didn't convert it) a ⚠️ instead: its
 * ranks are ESPN's live order of the import's day, which the app no longer uses in a league whose order resets weekly,
 * with the weekly reset order from today's standings (`reset`, resetWaiverOrder) and my place in it.
 */
export function waiverOrderNote(snapshot: Pick<LeagueSnapshot, "settings" | "teams" | "warnings">, order: readonly string[], reset: readonly string[] | null, myTeamId: string | null, teamName: (id: string) => string, pre4c: Pre4cOrder | null = null): string {
  if (!waiverRanksPre4c(snapshot)) return `Waiver order used: ${waiverOrderText(snapshot)}: ${orderText(order, myTeamId, teamName)}.${pre4c ? ` ${pre4cText(pre4c, myTeamId, teamName)}` : ""}`;
  const head = `⚠️ This data comes from before the 4c adapter: its waiver ranks are ESPN's live order on the day of the import (${orderText(order, myTeamId, teamName)}), and the pickups follow it. Since Phase 4c the app uses the weekly reset order in a league whose order resets weekly, as Parker's does (planner reply to Checkpoint 4b, answer 2), so the baseline doesn't depend on the day of the import.`;
  if (!reset || reset.length !== order.length) return head;
  if (reset.every((id, i) => id === order[i])) return `${head} Today the two orders are the same.`;
  return `${head} The weekly reset order from today's standings (reverse standings): ${orderText(reset, myTeamId, teamName, "would claim")}.`;
}


// ---------------------------------------------------------------------------------------------
// A committed league report read back (the trade report's data attribution: what changed in the data since a checkpoint)

/** One roster table row of a league report (the section "Rest-of-season and weekly projected points, every rostered player"). */
export interface ReportedPlayer {
  /** The St column's short code (STATUS_SHORT: "" active, P, Q, D, O, IR, PUP, SUS, NA). */
  status: string;
  /** His rest-of-season points (null: "no projection"). */
  ros: number | null;
  slot: "active" | "ir" | "taxi";
}

/** The tables a league report prints that a later report compares with (parseLeagueReport). */
export interface LeagueReportTables {
  /** Per team id: its record ("2-1"), points for and projected points per week (scenario lineups), from "Projected starting-lineup points per week". */
  teams: Map<string, { record: string; pointsFor: number | null; ppw: number | null }>;
  /** Per team id: its roster table's players by public NFL name. */
  rosters: Map<string, Map<string, ReportedPlayer>>;
}

const numberCell = (s: string | undefined): number | null => {
  const x = Number((s ?? "").replace(/[−]/g, "-"));
  return (s ?? "").trim() !== "" && Number.isFinite(x) ? x : null;
};

/**
 * A league report's markdown read back (this script's own render: the team table under "Projected starting-lineup points per
 * week", "| Team | Record | PF | Proj/wk (scenario) | …", and the roster tables "### Team N" with "| Player | Pos | NFL | St |
 * ROS | …"). Tolerant: rows it can't read are skipped. The trade report reads Checkpoint 3's and Checkpoint 4's committed
 * reports (git show 6a83beb / b27e90f:reports/league-report.md) with it.
 */
export function parseLeagueReport(md: string): LeagueReportTables {
  const teams: LeagueReportTables["teams"] = new Map();
  const rosters: LeagueReportTables["rosters"] = new Map();
  let inTeams = false;
  let roster: Map<string, ReportedPlayer> | null = null;
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith("| Team | Record | PF | Proj/wk (scenario) |")) {
      inTeams = true;
      continue;
    }
    if (inTeams && !line.startsWith("|")) inTeams = false;
    const cells = line.split("|").map((c) => c.trim());
    if (inTeams) {
      const id = /^Team (\d+)/.exec(cells[1] ?? "")?.[1];
      if (id) teams.set(id, { record: cells[2] ?? "", pointsFor: numberCell(cells[3]), ppw: numberCell(cells[4]) });
      continue;
    }
    const heading = /^### Team (\d+)/.exec(line);
    if (heading) {
      roster = new Map();
      rosters.set(heading[1] as string, roster);
      continue;
    }
    if (line.startsWith("## ") || line.startsWith("### ")) {
      roster = null;
      continue;
    }
    if (!roster || !line.startsWith("| ") || line.startsWith("| Player |")) continue;
    const raw = cells[1] ?? "";
    if (!raw || /^-+$/.test(raw)) continue;
    const slot = / \(IR\)$/.test(raw) ? "ir" : / \(taxi\)$/.test(raw) ? "taxi" : "active";
    roster.set(raw.replace(/ \((IR|taxi)\)$/, ""), { status: cells[4] ?? "", ros: numberCell(cells[5]), slot });
  }
  return { teams, rosters };
}

/** A player's status as a league report's St column prints it (STATUS_SHORT; "" when active). */
export const statusShort = (status: InjuryStatus | undefined): string => STATUS_SHORT[status ?? "ACTIVE"] ?? "";

// The command line in a report's header (displayPath, commandText) is scripts/lib/runMode.ts's (re-exported above): the
// dump always named, so the report can be run again on the same data (review of track R; Phase 7a, A5).

/** The market blend in numbers (the file header, Phase 4b). */
export interface BlendLines {
  /** w (config.marketBlend.weight as the build clamped it; 0: nothing blended). */
  weight: number;
  /** Per configured position: players with a real value, curve points, blended (blend.ts). */
  positions: BlendPosition[];
  /** Players the blend reaches (a real value at a blended position), and those of them with a base rate above 0. */
  reached: number;
  scaled: number;
  /** Players whose rest-of-season points it moved (PlayerModel.blend: a weight above 0 and ROS above 0). */
  moved: number;
  /** Of those, the ones whose market number is their own (the end of their position's value range: blendIsOwnPoint). */
  ownPoint: number;
  /** The League page's player breakdown lines (PlayerRow.blend) on the rosters and in the free-agent lists. */
  rosterLines: number;
  freeAgentLines: number;
  /**
   * Those lines by their words (leagueView.blendText; Phase 7b: words only, planner reply to Checkpoint 7a, 5.4): leaning up
   * or down toward the trade market's view, capped ("…, by the most it can": the clamp cut his factor), or "The trade market
   * barely moves his projection." (his ROS prints the same before and after; the players at one end of their position's
   * value range among them).
   */
  words: { leansUp: number; leansDown: number; capped: number; barely: number };
  /**
   * Phase 4c (planner reply to Checkpoint 4b, change 4; review of track R, R-6): the factor's clamp
   * (config.marketBlend.factorClamp) and every factor it cut (BlendFactor.clamped: the factor before the clamp, after it,
   * and the bound), the most extreme first (|ln fRaw|; ties: the id).
   */
  clamp: readonly [number, number];
  clamped: { id: string; fRaw: number; f: number; bound: "low" | "high" }[];
}

/** The blend's counts (BlendLines) from a League model build and the League page built on it. */
export function blendLines(snapshot: LeagueSnapshot, inputs: ModelInputs, model: LeagueModel, context: Pick<LeagueContext, "lp">, now: Date): BlendLines {
  const blend = context.lp.blend;
  const factors = [...blend.factors.values()];
  const moved = Object.values(model.players).flatMap((pm) => (pm.blend ? [pm.blend] : []));
  const ownPoint = moved.filter((b) => blendIsOwnPoint(b)).length;
  const view = buildLeagueView({ snapshot, model, inputs, myTeamSource: "you", timeZone: "UTC", now: now.toISOString() });
  const rows = view.rosters.flatMap((r) => r.players).filter((p) => p.blend);
  const fa = view.freeAgents.flatMap((g) => g.players).filter((p) => p.blend);
  // The lines by their words (BlendLines.words; leagueView.blendText's three sentences).
  const texts = [...rows, ...fa].map((p) => p.blend?.text ?? "");
  const capped = (t: string) => t.includes("by the most it can");
  const words = {
    leansUp: texts.filter((t) => !capped(t) && t.startsWith("His projection leans up")).length,
    leansDown: texts.filter((t) => !capped(t) && t.startsWith("His projection leans down")).length,
    capped: texts.filter(capped).length,
    barely: texts.filter((t) => t.startsWith("The trade market barely moves")).length,
  };
  const far = (f: number) => (f > 0 && Number.isFinite(f) ? Math.abs(Math.log(f)) : Number.POSITIVE_INFINITY);
  const clamped = [...blend.factors]
    .flatMap(([id, f]) => (f.clamped ? [{ id, fRaw: f.fRaw ?? f.f, f: f.f, bound: f.clamped }] : []))
    .sort((a, b) => far(b.fRaw) - far(a.fRaw) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    weight: blend.weight,
    positions: blend.positions,
    reached: factors.length,
    scaled: factors.filter((f) => f.ours > 0).length,
    moved: moved.length,
    ownPoint,
    rosterLines: rows.length,
    freeAgentLines: fa.length,
    words,
    clamp: config.marketBlend.factorClamp,
    clamped,
  };
}

/** The warning src/server/modelInputs.ts (loadFantasyCalc) gives when FantasyCalc's player list (/players) couldn't be loaded. */
export const FANTASYCALC_PLAYERS_UNAVAILABLE = "FANTASYCALC_PLAYERS_UNAVAILABLE";

/**
 * Whether the model inputs read FantasyCalc's player list (/players), from the data itself (the file header, Phase 4c;
 * review of track R, R-7: the fallback alone doesn't tell, since src/server/modelInputs.ts asks for the list whenever
 * FantasyCalc served any list fresh in the build, a dynasty league's season list or a keeper league's redraft list
 * included): MarketInputs.knownIds names a player beyond the value lists' own rows (values, redraftValues, seasonValues).
 * Without the player list knownIds is exactly the players those rows name (data/fantasyCalcValues.ts marketInputsFrom: the
 * same matcher on the same rows). False too when the list was read and added nobody: an ID match would then only repeat
 * the value rate.
 */
export function fantasyCalcPlayersRead(market: Pick<MarketInputs, "knownIds" | "values" | "redraftValues" | "seasonValues">): boolean {
  const rows = new Set([...Object.keys(market.values), ...Object.keys(market.redraftValues ?? {}), ...Object.keys(market.seasonValues ?? {})]);
  return market.knownIds.some((id) => !rows.has(id));
}

/** One IR player (the file header, Phase 4b): his team, status, ESPN's return week, R, and the displacement at R. */
export interface IrReturnerRow {
  teamId: string;
  playerId: string;
  status: InjuryStatus | null;
  /** ESPN's return week (PlayerInfo.injuryReturnWeek; after the NFL's last week: out for the season). */
  espnWeek: number | null;
  /** His expected return week R (an NFL week of the model's), or null when he isn't back within them or has no model. */
  R: number | null;
  /** He rejoins his team's lineups (a returner: a model and an R). */
  returner: boolean;
  /**
   * The roster spot his return needs, on the team as it stands (returners.finalLineups: the League page's numbers and
   * odds): the player dropped and from which NFL week (`self`: the returner himself is released then), or null when the
   * roster has room.
   */
  drop: { playerId: string; week: number; self: boolean } | null;
}

/** Every team's IR players (league.ts TeamWork.ir) with their returns and the displacement each one causes (IrReturnerRow). */
export function irReturnerRows(context: Pick<LeagueContext, "work" | "returnerSetup" | "returnWeek" | "lp" | "snapshot">): IrReturnerRow[] {
  const weeks = context.lp.weeks.weeks;
  const rows: IrReturnerRow[] = [];
  for (const t of context.work) {
    if (!t.ir.length) continue;
    const final = finalLineups(context.returnerSetup, t.ids, t.stream, { ev: t.solved, scen: t.scen });
    const back = new Set(returnersOf(t.stream).map((r) => r.id));
    for (const id of t.ir) {
      const info = context.snapshot.players[id];
      const d = final.displaced.find((x) => x.returner === id);
      const week = d ? weeks[d.from] : undefined;
      rows.push({
        teamId: t.team.id,
        playerId: id,
        status: info?.injury ?? null,
        espnWeek: info?.injuryReturnWeek ?? null,
        R: context.returnWeek(id),
        returner: back.has(id),
        drop: d && week !== undefined ? { playerId: d.id, week, self: d.id === id } : null,
      });
    }
  }
  return rows;
}

export interface ScheduleRow {
  /** The week the simulation lists the game under (its first week still to play), and its weeks still to play. */
  week: number;
  weeks: number[];
  /** null = my fantasy bye week (no game). */
  opponentId: string | null;
  /**
   * The simulator's weekly score with pickups (TeamModel.scoreWithPickups, the headline's; TeamModel.score in a model
   * without it) summed over those weeks: means add, SDs add in quadrature (each week is drawn independently).
   */
  mine: { mean: number; sd: number };
  theirs: { mean: number; sd: number } | null;
  /** My win chance: the headline's (with pickups), and as rosters stand (null when the model has no such odds). */
  pWin: number | null;
  pWinStand: number | null;
  pMedianWin: number | null;
  /**
   * My players whose NFL team is on bye in one of those weeks (leagueView.scheduleByeRule: my active roster after my
   * free-agent pickups, as the odds count it, then my IR returners, a returner only from his expected return week). First
   * the likely starters whose byes count (`starter`: the League page's "On bye" list, in its order; never a player at a
   * position I stream), then the rest by ROS points.
   */
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
 * SeasonOdds.weekly (`odds`: the headline, LeagueModel.odds, with pickups; `stand`: as rosters stand), over the weeks the
 * simulator sums (the setup's game). The byes and the risky-week rule are the League page's, read from
 * src/lib/leagueView.ts so the two can't drift (review POL-1: this report had kept its own copy, which took likely
 * starters from the roster as it stood and still counted a streamed kicker): its bye rule, scheduleByeRule (likely
 * starters after my free-agent pickups, as the odds count them, ⚠️ none at a position I stream, whose bye the streaming
 * replacement covers; a returner's bye only from his expected return week, read with `lastNflWeek`,
 * leagueView.lastNflWeekOf), and a win chance under RISKY_WIN_CHANCE as the page prints it (whole percents; head-to-head
 * leagues; the headline's), or RISKY_BYES or more of those starters on bye in a week that counts (a game, a median game,
 * or any week of a points-only league). Null without my team.
 */
export function remainingSchedule(snapshot: LeagueSnapshot, model: LeagueModel, odds: SeasonOdds, built: SimSetupResult, stand: SeasonOdds | null, lastNflWeek: number | undefined): ScheduleRow[] | null {
  const me = model.myTeamId;
  const team = snapshot.teams.find((t) => t.id === me);
  if (!me || !team) return null;
  const mi = built.teamIds.indexOf(me);
  const drawn = new Set(built.setup.weeks);
  const weekIndex = new Map(model.weeks.map((w, i) => [w, i]));
  const scores = new Map(model.teams.map((t) => [t.id, t.scoreWithPickups ?? t.score]));
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
  // The League page's bye rule: who's listed, which of them count (`starter`), and when a player is off.
  const rule = scheduleByeRule(snapshot, model, me, lastNflWeek);
  const starterRank = new Map(rule.starters.map((id, k) => [id, k]));
  const pointsOnly = snapshot.settings.pointsOnly;
  const riskyPct = Math.round(RISKY_WIN_CHANCE * 100);
  const rows: ScheduleRow[] = [];
  for (const wk of odds.weekly) {
    const game = wk.games.find((g) => g.teamId === me);
    if (!game) continue;
    const sim = built.setup.games.find((g) => (g.a === mi || g.b === mi) && g.weeks.find((w) => drawn.has(w)) === wk.week);
    const weeks = sim ? sim.weeks.filter((w) => drawn.has(w)) : [wk.week];
    const byes = rule.players
      .filter((id) => rule.onBye(id, weeks))
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
      pWinStand: stand?.weekly.find((w) => w.week === wk.week)?.games.find((g) => g.teamId === me)?.pWin ?? null,
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
   * measure over the teams and both odds (the headline with pickups and as rosters stand), "score" over every team's
   * weekly score means and SDs (TeamModel.score and scoreWithPickups), and `nulls` = odds or scores known in one model
   * and not the other. Null when either model has no odds.
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

/** (b) of the no-op check: the largest |Δ| per measure between two League models' odds (both) and weekly scores (both). */
function oddsDelta(a: LeagueModel, b: LeagueModel): NoOpCheck["rebuilt"] {
  if (!a.odds || !b.odds) return null;
  const out = { pPlayoffs: 0, pBye: 0, pTitle: 0, expWins: 0, score: 0, nulls: 0 };
  const diff = (x: number | null, y: number | null): number => {
    if (x === null || y === null) {
      if (x !== y) out.nulls++;
      return 0;
    }
    return Math.abs(x - y);
  };
  for (const [oa, ob] of [
    [a.odds, b.odds],
    [a.oddsAsRostersStand ?? null, b.oddsAsRostersStand ?? null],
  ] as const) {
    if (!oa || !ob) {
      if (oa !== ob) out.nulls++;
      continue;
    }
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
  }
  for (const t of a.teams) {
    const u = b.teams.find((x) => x.id === t.id);
    if (!u) {
      out.score = Number.POSITIVE_INFINITY;
      continue;
    }
    out.score = Math.max(out.score, scoreDiff(t.score, u.score));
    if (t.scoreWithPickups && u.scoreWithPickups) out.score = Math.max(out.score, scoreDiff(t.scoreWithPickups, u.scoreWithPickups));
    else if (t.scoreWithPickups || u.scoreWithPickups) out.nulls++;
  }
  return out;
}

/** The no-op check (the file header): (a) on the model's own setup; (b) from a second model built like the first, every roster copied. */
export function noOpCheck(snapshot: LeagueSnapshot, inputs: ModelInputs, model: LeagueModel, built: SimSetupResult, now: Date): NoOpCheck {
  const sims = model.odds?.sims ?? shownSimsOf();
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
  /** Simulated seasons of the headline odds (0 = without the season simulation; the playoff weight's runs happen either way). */
  sims: number;
  /** Median build time, ms, and the median of the build's own "season simulation" stage (null without it). */
  total: number;
  simulation: number | null;
}

/**
 * buildLeagueModel with and without the season simulation, EV lineups only and with S scenarios: medians of `runs` builds
 * after `warmups`. Every variant simulates and measures the automatic playoff weight on the shown block's seasons
 * (season.shownSimsOf: Checkpoint 7e), as the app does
 * (playoffWeightSims; league.ts step 5c): with `sims` 0 alone it would default to 0, skip that measurement and build another
 * model (the fallback ω), so "without" would also leave out the ω runs and everything ω moves (review of Phase 7b).
 */
export function buildTimings(snapshot: LeagueSnapshot, inputs: ModelInputs, now: Date, scenarios: number, clock: () => number, runs = TIMING_RUNS, warmups = TIMING_WARMUPS): BuildTiming[] {
  const variants = [0, scenarios].flatMap((s) => [0, shownSimsOf()].map((sims) => ({ scenarios: s, sims })));
  return variants.map((v) => {
    const totals: number[] = [];
    const stage: number[] = [];
    for (let i = 0; i < warmups + Math.max(1, runs); i++) {
      const t0 = clock();
      const m = buildLeagueModel(snapshot, inputs, { now, scenarios: v.scenarios, sims: v.sims, playoffWeightSims: shownSimsOf(), clock });
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
  /** The headline odds (LeagueModel.odds: every team after its free-agent pickups) and the second line (oddsAsRostersStand). */
  odds: SeasonOdds | null;
  stand: SeasonOdds | null;
  /** The simulator's setup for the headline (pickupSeasonModel: TeamModel.scoreWithPickups). */
  built: SimSetupResult | null;
  schedule: ScheduleRow[] | null;
  /** The scale check from the one baseline (every team after its pickups), and from the rosters as they stand. */
  scale: ScaleCheck | null;
  scaleStand: ScaleCheck | null;
  /**
   * Each scale check's baseline odds are the model's own (the same matrix): my P(playoffs), P(title) and expected wins
   * bitwise equal to LeagueModel.odds' (pickups) and oddsAsRostersStand's (stand; null without that check); and the one
   * baseline's +3 row is the League model's own "Helps you" calibration run (calibration: ΔPO and ΔCH bitwise equal to
   * LeagueModel.helpsCalibration's; null when either is missing).
   */
  scaleMatchesModel: { pickups: boolean; stand: boolean | null; calibration: boolean | null } | null;
  /**
   * The app's own B₃ under each goal (appHelpsScales; review of Phase 7b): the scale check holds this report's model, the
   * default goal's, for every goal's weights; the app under another goal builds its own model (its own playoff-week
   * weight ω, so its own pickups, baseline and +3 run). Null without odds or a team.
   */
  appB3: ByGoal<AppB3> | null;
  /** Every team's pickups' own effect on my odds: the one baseline against as rosters stand, paired (pickupsEffect). */
  pickups: PickupsEffect | null;
  noOp: NoOpCheck | null;
  simTimings: SimTiming[];
  buildTimings: BuildTiming[];
  /** Checkpoint 7c: the league's prizes (--prizes) against "Only the champion" (prizesReport); null without --prizes, odds or a team. */
  prizes: PrizesReport | null;
}

/** One setting's numbers for my team in the prizes section (PrizesReport.rows), from that setting's own League model. */
export interface PrizesRow {
  goal: Goal;
  /** The playoff weeks' weight ω the model used (LeagueModel.playoffWeight). */
  omega: number;
  /** Its "Helps you" scale: benefit.helpsScale on its own calibration run (step 8c) under its own reward; null without one. */
  b3: number | null;
  floored: boolean;
  /** My headline odds there (every team after its pickups: LeagueModel.odds): P(1st), P(2nd), P(3rd), P(1st, 2nd or 3rd), P(playoffs); null where unknown. */
  pFirst: number | null;
  pSecond: number | null;
  pThird: number | null;
  top3: number | null;
  pPlayoffs: number | null;
  /** The weekly high scores I'm expected to win of the remaining periods (ties split), when the model simulated them; else null. */
  expHighScores: number | null;
  /** P(the most points in the regular season). */
  pPointsLeader: number | null;
}

/**
 * Checkpoint 7c (planner reply to Checkpoint 7b, §6; its "Checkpoint 7c must include": "Prizes, using the prizes Parker gives
 * for his league: how 3rd place is decided in his league, his odds of 1st, 2nd and 3rd, his B₃"): the split, how 3rd place
 * goes, and my numbers under "Only the champion" (the report's model) and under the split (the model the app builds under
 * it: `model`).
 */
export interface PrizesReport {
  /** The amounts as --prizes gave them, and the split's reward (its shares and the league's prize periods: reward.ts rewardOf). */
  amounts: PrizeAmounts;
  reward: Reward;
  /** The League model under the split. */
  model: LeagueModel;
  /**
   * How 3rd place is decided: the Import Report's "3rd-place game" row (importReport.ts thirdPlaceText), what the league's
   * data says (LeagueSettings.thirdPlace: absent when it says nothing) and the season simulation's rule (SeasonOdds.thirdPlace).
   */
  thirdPlace: { row: string; data: LeagueSettings["thirdPlace"] | null; sim: SeasonOdds["thirdPlace"] | null };
  rows: PrizesRow[];
}

/** My numbers in one setting's League model (PrizesRow). */
function prizesRowOf(snapshot: LeagueSnapshot, m: LeagueModel, goal: Goal): PrizesRow {
  const me = m.myTeamId;
  const mine = me ? (m.odds?.teams.find((t) => t.teamId === me) ?? null) : null;
  const s = mine ? helpsScale(m.helpsCalibration, { leagueType: snapshot.settings.leagueType, myPPlayoffs: mine.pPlayoffs, reward: m.reward ?? goalRewards(prizePeriods(snapshot))[goal], dynastyTotal: null }) : null;
  const p = mine ? prizeOddsOf(mine) : null;
  const top3 = p && p.first !== null && p.second !== null && p.third !== null ? p.first + p.second + p.third : null;
  return {
    goal,
    omega: m.playoffWeight,
    b3: s?.b3 ?? null,
    floored: s?.floored ?? false,
    pFirst: p?.first ?? null,
    pSecond: p?.second ?? null,
    pThird: p?.third ?? null,
    top3,
    pPlayoffs: mine?.pPlayoffs ?? null,
    expHighScores: mine && (m.odds?.highScorePeriods ?? 0) > 0 ? mine.expHighScores : null,
    pPointsLeader: mine?.pPointsLeader ?? null,
  };
}

/**
 * The prizes section's numbers (PrizesReport): `model`, the report's League model ("Only the champion", the default), and
 * `prizesModel`, the one the app builds under the league's split (`amounts`). Null without odds or my team in either.
 */
export function prizesReport(snapshot: LeagueSnapshot, model: LeagueModel, prizesModel: LeagueModel, amounts: PrizeAmounts): PrizesReport | null {
  if (!model.odds || !prizesModel.odds || !model.myTeamId || !prizesModel.reward) return null;
  const playoffsUnknown = snapshot.settings.unknownSettings?.includes("playoffs") ?? false;
  return {
    amounts,
    reward: prizesModel.reward,
    model: prizesModel,
    thirdPlace: { row: thirdPlaceText(snapshot.settings, playoffsUnknown), data: snapshot.settings.thirdPlace ?? null, sim: prizesModel.odds.thirdPlace ?? null },
    rows: [prizesRowOf(snapshot, model, model.reward?.goal ?? defaultTradeSettings().goal), prizesRowOf(snapshot, prizesModel, "prizes")],
  };
}

/** One goal's B₃ as the app computes it under that goal (SeasonReport.appB3), with the ω its model used. */
export interface AppB3 {
  b3: number | null;
  floored: boolean;
  omega: number;
}

/** The settings the app builds a League model with under `goal` (the defaults; "Several prizes" on `prizes` when given, Checkpoint 7c). */
export function settingsFor(goal: Goal, prizes?: PrizeAmounts | null): TradeSettings {
  const defaults = defaultTradeSettings();
  return goal === "prizes" && prizes ? { ...defaults, goal, prizes } : { ...defaults, goal };
}

/**
 * Each goal's B₃ off that goal's own League model (SeasonReport.appB3): this report's `model` for the default goal (built
 * with the default settings), a model built with the goal for each other one (its helpsCalibration; benefit.helpsScale, no
 * long-term part, as the scale check's). Checkpoint 7c: "Several prizes" on `opts.prizes` (the report's --prizes) when given,
 * else the prefilled split; `opts.models` stands in for a goal's model already built (the report's split model). Null
 * without odds or my team.
 */
export function appHelpsScales(snapshot: LeagueSnapshot, inputs: ModelInputs, model: LeagueModel, now: Date, opts: { prizes?: PrizeAmounts | null; models?: Partial<ByGoal<LeagueModel>> } = {}): ByGoal<AppB3> | null {
  const me = model.myTeamId;
  if (!me || !model.odds) return null;
  const defaults = defaultTradeSettings();
  const rewards = goalRewards(prizePeriods(snapshot), null, opts.prizes);
  const of = (m: LeagueModel, goal: Goal): AppB3 => {
    const mine = m.odds?.teams.find((t) => t.teamId === me);
    // That goal's own model's reward (its settings' goal and prizes).
    const s = mine ? helpsScale(m.helpsCalibration, { leagueType: snapshot.settings.leagueType, myPPlayoffs: mine.pPlayoffs, reward: m.reward ?? rewards[goal], dynastyTotal: null }) : null;
    return { b3: s?.b3 ?? null, floored: s?.floored ?? false, omega: m.playoffWeight };
  };
  return byGoal((goal) => of(goal === defaults.goal ? model : (opts.models?.[goal] ?? buildLeagueModel(snapshot, inputs, { now, scenarios: model.scenarios, settings: settingsFor(goal, opts.prizes) })), goal));
}

export interface SeasonReportOptions {
  now: Date;
  clock: () => number;
  /** Timed runs per runtime measurement (default TIMING_RUNS) after `warmups` untimed ones (default TIMING_WARMUPS). */
  runs?: number;
  warmups?: number;
  /** Timed buildLeagueModel runs per variant (default `runs`); 0 skips the build timings. */
  buildRuns?: number;
  /**
   * Checkpoint 7c (planner reply to Checkpoint 7b, §6): the league's prizes (--prizes), which "Several prizes" reads
   * everywhere the report prices it (goalRewards, appHelpsScales, the prizes section), and the League model the app builds
   * under them (`prizesModel`: its own ω, pickups, headline odds and, when the weekly prize pays, its high scores).
   */
  prizes?: PrizeAmounts | null;
  prizesModel?: LeagueModel | null;
}

/** Every Phase 3 number in the report (the file header), from the League model buildReport built. */
export function seasonReport(snapshot: LeagueSnapshot, inputs: ModelInputs, model: LeagueModel, opts: SeasonReportOptions): SeasonReport {
  const { now, clock } = opts;
  const runs = opts.runs ?? TIMING_RUNS;
  const warmups = opts.warmups ?? TIMING_WARMUPS;
  const buildRuns = opts.buildRuns ?? runs;
  const odds = model.odds;
  const stand = model.oddsAsRostersStand ?? null;
  // The headline's season: every team after its pickups (season.pickupSeasonModel), as LeagueModel.odds simulates it.
  const pickups = pickupSeasonModel(model);
  const built = buildSimSetup(snapshot, pickups);
  const builds = buildRuns > 0 ? buildTimings(snapshot, inputs, now, model.scenarios, clock, buildRuns, warmups) : [];
  if (!odds || !built) return { odds, stand, built, schedule: null, scale: null, scaleStand: null, scaleMatchesModel: null, appB3: null, pickups: null, noOp: null, simTimings: [], buildTimings: builds, prizes: null };
  // The League model's own seasons: both odds share the seed's first shownSims seasons (league.ts step 8b; Checkpoint 7e).
  const run: SharedRun = { sims: odds.sims, seed: odds.seed, normals: simNormals(odds.seed, odds.sims, built.setup.weeks.length, built.setup.teams.length) };
  const me = model.myTeamId;
  const mine = model.teams.find((t) => t.id === me);
  const from = scaleFrom(model);
  // Checkpoint 7c: the league's prizes (--prizes) and the League model the app builds under them (its own ω and pickups; its
  // runs simulate the weekly high scores when the split pays them, which this model's runs don't).
  const prizes = opts.prizes ?? null;
  const prizesModel = prizes ? (opts.prizesModel ?? buildLeagueModel(snapshot, inputs, { now, scenarios: model.scenarios, settings: settingsFor("prizes", prizes) })) : null;
  // Each goal's reward on the league's prize periods (the model's own for its goal; "Several prizes" on the league's split
  // when given: goalRewards).
  const rewards = goalRewards(prizePeriods(snapshot), model.reward, prizes);
  const scale = me && mine ? scaleCheck(snapshot, pickups, me, mine.scoreWithPickups ?? mine.score, run, { from, rewards }) : null;
  const scaleStand = me && mine && stand ? scaleCheck(snapshot, model, me, mine.score, run, { from, rewards }) : null;
  const same = (check: ScaleCheck | null, o: TeamOdds | null): boolean | null => (check && o ? Object.is(check.base.pPlayoffs, o.pPlayoffs) && Object.is(check.base.pTitle, o.pTitle) && Object.is(check.base.expWins, o.expWins) : null);
  const matchPickups = me ? same(scale, oddsOf(odds, me)) : null;
  return {
    odds,
    stand,
    built,
    schedule: remainingSchedule(snapshot, model, odds, built, stand, lastNflWeekOf(inputs)),
    scale,
    scaleStand,
    scaleMatchesModel: matchPickups === null ? null : { pickups: matchPickups, stand: me ? same(scaleStand, oddsOf(stand, me)) : null, calibration: calibrationMatches(scale, model.helpsCalibration) },
    appB3: scale ? appHelpsScales(snapshot, inputs, model, now, { prizes, ...(prizesModel ? { models: { prizes: prizesModel } } : {}) }) : null,
    pickups: scale && scaleStand ? pickupsEffect(scale, scaleStand, run.sims) : null,
    noOp: noOpCheck(snapshot, inputs, model, built, now),
    simTimings: [...new Set([config.simulation.screeningSims, config.simulation.finalSims, shownSimsOf()])].map((sims) => simTiming(built.setup, odds.seed, sims, clock, runs, warmups)),
    buildTimings: builds,
    prizes: prizes && prizesModel ? prizesReport(snapshot, model, prizesModel, prizes) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Rendering

/** Expected final record, one decimal: "8.3–5.7" (and ties when the league has any). */
function expectedRecord(t: TeamOdds, ties: boolean): string {
  return `${fmt(t.expWins)}–${fmt(t.expLosses)}${ties ? `–${fmt(t.expTies)}` : ""}`;
}

/** 1 → "1st", 2 → "2nd", 11 → "11th". */
export const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

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
  const stand = season.stand;
  L.push(
    `Today's standings by the league's rules (rank), with each team's chance to make the playoffs (${odds.playoffTeams} teams)${showBye ? `, earn a first-round bye (the top ${odds.byes})` : ""} and win the title${pointsOnly ? "" : ", and its expected final regular-season record"}: ${thousands(odds.sims)} simulated seasons on the common-random-numbers matrix of seed ${odds.seed} (seasons 1–${thousands(odds.sims)}, which are also the trade search's shown block, every card's numbers; its ranking block is the first ${thousands(config.simulation.finalSims)} of them, its screening block the next ${thousands(config.simulation.screeningSims)}). The headline (Phase 4c, one baseline everywhere): every team after its free-agent pickups (TeamModel.scoreWithPickups, LeagueModel.odds), the odds every trade card's "before" reads. Weekly scores are drawn around each team's projected lineup (scenario lineups when scenarios ran; SD by the law of total variance).${stand ? ` "As rosters stand" is the second line (LeagueModel.oddsAsRostersStand: every team as it is today, TeamModel.score), on the same seasons.` : ""}${out}`,
    "",
  );
  const standCols = stand ? " As rosters stand: playoffs | … title |" : "";
  L.push(`| Rank | Team | Record | PF | Playoffs |${showBye ? " Bye |" : ""} Title | Expected final record |${standCols}`, `|---|---|---|---|---|${showBye ? "---|" : ""}---|---|${stand ? "---|---|" : ""}`);
  for (const t of rows) {
    const st = snapshot.teams.find((x) => x.id === t.teamId);
    const s = oddsOf(stand, t.teamId);
    L.push(`| ${t.rank} | ${teamName(t.teamId)}${t.eliminated ? " (out)" : ""} | ${st ? recordOf(st.record) : "–"} | ${st ? fmt(st.pointsFor) : "–"} | ${pct(t.pPlayoffs)} |${showBye ? ` ${pct(t.pBye)} |` : ""} ${pct(t.pTitle)} | ${pointsOnly ? "– (points only)" : expectedRecord(t, ties)} |${stand ? ` ${pct(s?.pPlayoffs)} | ${pct(s?.pTitle)} |` : ""}`);
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
  const showStand = season.stand !== null;
  const riskyPct = Math.round(RISKY_WIN_CHANCE * 100);
  // The positions I stream, whose byes the page doesn't count (leagueView.scheduleByeRule).
  const streamed = (model.myTeamId ? (model.streaming.byTeam[model.myTeamId]?.positions ?? []) : []).map((p) => posLabel(p, snapshot.platform));
  const streamedText = streamed.length ? `, never one at a position you stream (${streamed.join(", ")}: the streaming replacement covers his bye)` : "";
  L.push(
    `Each remaining regular-season game (§8 "show each remaining week's risk"): your weekly score and your opponent's, as the simulator draws them for the headline odds (mean ± SD, every team after its free-agent pickups: TeamModel.scoreWithPickups; a multi-week matchup sums its weeks still to play), your chance to win it in the ${thousands(season.odds.sims)} simulated seasons${showStand ? " (and as rosters stand, the second line)" : ""}${showMedian ? ", your chance of a top-half score (the median game)" : ""}, and your players whose NFL team is off that week (your roster after your free-agent pickups, as the odds count it, and an IR player from his expected return week). **Bold** = a likely starter whose bye counts, the League page's "On bye" rule (src/lib/leagueView.ts scheduleByeRule, the same code): in your best lineup after your free-agent pickups in at least half the weeks he plays${streamedText}. A week is flagged risky as the League page flags it: your chance to win (the headline's) under ${riskyPct}% as the page prints it (whole percents), or ${RISKY_BYES} or more of those likely starters on bye in a week that counts.`,
    "",
  );
  L.push(`| Week | Opponent | You | Them | Win |${showStand ? " Win, as rosters stand |" : ""}${showMedian ? " Median |" : ""} On bye | Risk |`, `|---|---|---|---|---|${showStand ? "---|" : ""}${showMedian ? "---|" : ""}---|---|`);
  for (const r of rows) {
    const first = r.weeks[0] ?? r.week;
    const last = r.weeks.at(-1) ?? r.week;
    const week = `${first === last ? first : `${first}–${last}`}${r.underWay ? " (under way: projected as if no game had started)" : ""}`;
    const byes = r.byes.map((b) => (b.starter ? `**${playerName(snapshot.players[b.id], b.id)}**` : playerName(snapshot.players[b.id], b.id))).join(", ") || "–";
    const opp = r.opponentId === null ? "bye week (no game)" : teamName(r.opponentId);
    const them = r.theirs ? `${fmt(r.theirs.mean)} ± ${fmt(r.theirs.sd)}` : "–";
    const win = r.opponentId === null ? "no game" : pct(r.pWin);
    const winStand = r.opponentId === null ? "no game" : pct(r.pWinStand);
    L.push(`| ${week} | ${opp} | ${fmt(r.mine.mean)} ± ${fmt(r.mine.sd)} | ${them} | ${win} |${showStand ? ` ${winStand} |` : ""}${showMedian ? ` ${pct(r.pMedianWin)} |` : ""} ${byes} | ${r.risk.length ? `Risky: ${r.risk.join("; ")}` : ""} |`);
  }
  const risky = rows.filter((r) => r.risk.length);
  L.push("", risky.length ? `Risky weeks: ${risky.map((r) => `week ${r.week} (${r.risk.join("; ")})`).join(", ")}.` : "No risky weeks.", "");
}

/** An estimate with its Monte Carlo standard error: "+0.0412 ± 0.0030" (the error reads "–" when it can't be estimated). */
const pm = (x: string, se: number, d: number) => `${x} ± ${fmt(se, d)}`;

/** Every team's pickups' own effect on my odds (pickupsEffect), one line: every change with its standard error. */
function pickupsLine(p: PickupsEffect): string {
  const s = p.se;
  return `Every team's free-agent pickups, for your team (the one baseline against as rosters stand, the same seasons): ΔPO ${pm(signed(p.dPO, 4), s.dPO, 4)}, ΔCH ${pm(signed(p.dCH, 4), s.dCH, 4)}, Δ expected wins ${pm(signed(p.dEW, 3), s.dEW, 3)}.`;
}

function scaleTable(L: string[], check: ScaleCheck): void {
  const rows = check.rows;
  const gain = config.benefit.helpsGain;
  if (!rows) {
    // Review of track SC, SC-3: the app still has a B₃ then (the playoff odds alone), so say it.
    L.push(`Title odds are unknown (${check.titleUnknown ? `${check.titleUnknown}; ` : ""}see the notes under Standings and playoff odds), so the rows' B can't be computed.`, "");
    L.push(`B₃, the B of +${gain} points a week, under each goal, by the rule every card's B follows when title odds are unknown: ${b3Words(check)}.`, "");
    return;
  }
  L.push(`Baseline: P(playoffs) ${pct(check.base.pPlayoffs)}, P(title) ${pct(check.base.pTitle)}, expected wins ${fmt(check.base.expWins, 2)}.`, "");
  L.push(`| Lineup gain | ΔPO | ΔCH | Δ expected wins | ${GOALS.map((g) => `${GOAL_WORDS[g]}: B / Helps you`).join(" | ")} | Toy league B / score |`, `|---|---|---|---|${GOALS.map(() => "---|").join("")}---|`);
  for (const r of rows) {
    const toy = PLANNER_TOY[r.gain];
    const s = r.se;
    const goals = GOALS.map((g) => `${pm(fmt(r.B[g], 2), s.B[g], 2)} / ${r.score[g] ?? "– (B ≤ 0)"}`).join(" | ");
    L.push(`| +${r.gain} pt/wk | ${pm(signed(r.dPO, 4), s.dPO, 4)} | ${pm(signed(r.dCH, 4), s.dCH, 4)} | ${pm(signed(r.dEW, 3), s.dEW, 3)} | ${goals} | ${toy ? `≈ ${toy.B} / ≈ ${toy.score}` : "–"} |`);
  }
  L.push("");
  L.push(`B₃, the B of +${gain} points a week, under each goal (± B(+${gain})'s Monte Carlo standard error): ${b3Words(check)}.`, "");
}

/** "Protect my trade value" levels in the Settings page's words. */
const PROTECT_LEVEL_WORDS: Readonly<Record<ProtectValue, string>> = { low: "Low", medium: "Medium", high: "High" };

/** g_mkt(me) the "Protect my trade value" line prices: giving 25% more value than you get (the planner's example). */
export const PRICE_EXAMPLE_G = 1 / 1.25 - 1;

/**
 * What "Protect my trade value" charges on each goal's B₃ (planner reply to Checkpoint 7a, §2 question 5; benefit.marketWeekly
 * and marketSanity, the engine's own functions): giving 25% more value than you get (g_mkt(me) −0.20) costs κ × 0.20 points a
 * week at every level (Low, Medium, High), the same under every goal; in B, (B₃ / 3) × that, which depends on the goal's B₃.
 */
export function tradeValuePriceWords(check: Pick<ScaleCheck, "b3">, app: ByGoal<AppB3> | null = null): string {
  const levels = PROTECT_VALUE_LEVELS.map((level) => `${fmt(-marketWeekly(PRICE_EXAMPLE_G, protectValueWeight(level)), 1)} at ${PROTECT_LEVEL_WORDS[level]}`).join(", ");
  const medium = protectValueWeight("medium");
  // On the app's own B₃ under each goal when it's known (appHelpsScales; review of Phase 7b), else the check's.
  const perGoal = GOALS.map((g) => {
    const b3 = app ? app[g].b3 : check.b3[g].value;
    return b3 === null ? `${GOAL_WORDS[g]} –` : `${GOAL_WORDS[g]} ${signed(marketSanity(PRICE_EXAMPLE_G, b3, medium), 2)}`;
  }).join("; ");
  const kappas = PROTECT_VALUE_LEVELS.map((level) => String(protectValueWeight(level))).join(" / ");
  return `“Protect my trade value” is priced on the same B₃ (planner reply to Checkpoint 7a, §2 question 5: the market term = (B₃ / ${config.benefit.helpsGain}) × κ × clamp(g_mkt(me)), κ = ${kappas} points a week per 100% of trade value at Low / Medium / High): giving 25% more value than you get (g_mkt(me) −0.20) costs ${levels} points a week under every goal; in B at Medium${app ? ", on the app's own B₃ under each goal" : ""}: ${perGoal}.`;
}

/**
 * The app's own B₃ under each goal in words (SeasonReport.appB3; review of Phase 7b): "Only the champion **4.94** (ω 1.6×); …",
 * floored ones saying so.
 */
export function appB3Words(app: ByGoal<AppB3>): string {
  return GOALS.map((g) => {
    const a = app[g];
    return `${GOAL_WORDS[g]} ${a.b3 === null ? "none" : `**${fmt(a.b3, 2)}**${a.floored ? " (floored)" : ""}`} (ω ${a.omega}×)`;
  }).join("; ");
}

/**
 * Each goal's B₃ in words: "Only the champion **5.04 ± 0.21**; …" (floored ones say so, and so do B₃s from the playoff odds alone
 * when title odds are unknown).
 */
export function b3Words(check: Pick<ScaleCheck, "b3">): string {
  return GOALS.map((g) => {
    const b = check.b3[g];
    if (b.raw === null || b.value === null) return `${GOAL_WORDS[g]}: none (no odds for +${config.benefit.helpsGain} a week)`;
    const se = b.se !== null && Number.isFinite(b.se) ? ` ± ${fmt(b.se, 2)}` : "";
    const floored = b.floored ? ` (floored: B(+${config.benefit.helpsGain}) is ${fmt(b.raw, 2)}, under ${config.benefit.helpsFloor})` : "";
    return `${GOAL_WORDS[g]} **${fmt(b.value, 2)}${se}**${b.playoffOnly ? " (playoff odds only: title odds unknown)" : ""}${floored}`;
  }).join("; ");
}

function renderScale(L: string[], season: SeasonReport, model: LeagueModel, leagueType: LeagueSnapshot["settings"]["leagueType"]): void {
  L.push("## “Helps you” scale check", "");
  const check = season.scale;
  const odds = season.odds;
  if (!odds || !check) {
    L.push(odds ? "Parker's team isn't known, so there's nothing to check." : "No odds, so no check.", "");
    return;
  }
  const weeks = model.weeks.slice(check.from);
  const sims = thousands(odds.sims);
  const error =
    check.batches >= 2
      ? `± is its Monte Carlo standard error, by batch means: the ${sims} seasons split into ${check.batches} batches of ${thousands(check.batchSims)}, the change computed in each batch alone, SE = the batches' SD × √(${thousands(check.batchSims)} / ${sims}).`
      : "The run is too short to split into batches, so the changes have no standard error (–).";
  const goals = GOALS.map((g) => `${GOAL_WORDS[g]} ${goalWeights(g).playoffs} / ${goalWeights(g).prizes}`).join(", ");
  L.push(
    `CLAUDE.md §10 and the planner's reply to Checkpoint 4c (A2: "Helps you" calibrates itself per league and goal): your weekly score mean + x points in every remaining week a trade can change (weeks ${weeks[0] ?? "–"}–${weeks.at(-1) ?? "–"}: regular season and playoffs${check.from > 0 ? `; week ${model.inProgressWeek} is under way, and a trade's evaluation holds a week under way at its score as rosters stand, so the gain starts the week after` : ""}), σ unchanged, x = ${SCALE_GAINS.join(", ")}. From the one baseline: every team after its free-agent pickups (TeamModel.scoreWithPickups, the seasons LeagueModel.odds simulates, the trade search's baseline). Every row is ${sims} simulated seasons on the same common-random-numbers matrix (seed ${odds.seed}, the League model's own seasons): each season is played with and without the gain on the same random draws. That takes out the noise of comparing separate runs, but each change is still an estimate from ${sims} seasons, and another seed would give a somewhat different one. ${error} ΔPO and ΔCH are fractions; B = 100 × (w_PO ΔPO + w_S ΔE[S]) under each goal (w_PO / w_S: ${goals}; ΔE[S], the change in your share of the league's prizes, is ΔCH under Only the champion and Making the playoffs, and under Several prizes ${prizesWords(check.rewards.prizes)}; no market term: only lineup points move); B₃ = B(+${config.benefit.helpsGain}) under the same goal, at least ${config.benefit.helpsFloor} (benefit.helpsScale; under the default goal the app's own B₃ is the same run, LeagueModel.helpsCalibration; under another goal it comes from that goal's own model: below the table); Helps you = round(100 × (1 − e^(−B / B₃))), so +${config.benefit.helpsGain} reads 63 by construction. The planner's toy league (12 teams, 10 weeks left, the weights before Phase 4c): B ≈ ${SCALE_GAINS.map((g) => PLANNER_TOY[g]?.B ?? "–").join(" / ")}, scores ≈ ${SCALE_GAINS.map((g) => PLANNER_TOY[g]?.score ?? "–").join(" / ")}.`,
    "",
  );
  const m = season.scaleMatchesModel;
  if (m) {
    const cal = m.calibration === null ? "" : ` The +${config.benefit.helpsGain} row ${m.calibration ? "is" : "is NOT"} the League model's own "Helps you" calibration run bit for bit (LeagueModel.helpsCalibration: ΔPO and ΔCH).`;
    L.push(`Baseline check: the baseline run ${m.pickups ? "reproduces" : "does NOT reproduce"} the League model's own odds for your team bit for bit (LeagueModel.odds; same seed, same matrix)${m.stand === null ? "" : `, and so ${m.stand ? "does" : "does NOT"} the as-rosters-stand run (LeagueModel.oddsAsRostersStand)`}.${cal}`, "");
  }
  L.push("**From the one baseline (every team after its free-agent pickups)**", "");
  scaleTable(L, check);
  // Review of Phase 7b: the check holds this model (the default goal's ω) for every goal's weights; the app's own B₃ under
  // another goal comes from that goal's own model.
  if (season.appB3) {
    L.push(
      `⚠️ This check is on the default goal's baseline (playoff weeks count ${model.playoffWeight}×) for every goal's weights, so the goals compare on one run. Since the planner's reply to Checkpoint 7a (§6.1) each goal sets the playoff weeks' weight ω itself, so the app under another goal builds its own baseline (other pickups, another +${config.benefit.helpsGain} run). The app's own B₃ under each goal, off that goal's own League model: ${appB3Words(season.appB3)}.`,
      "",
    );
  }
  // The redraft market term's price on this B₃ (dynasty and keeper leagues have no market term: B_future carries value).
  if (leagueType === "redraft") L.push(tradeValuePriceWords(check, season.appB3), "");
  L.push("**As rosters stand** (TeamModel.score: every team as it is today, Checkpoint 4b's basis; Helps you on this basis's own B₃, its +3 row)", "");
  if (season.scaleStand) {
    if (season.pickups) L.push(pickupsLine(season.pickups), "");
    scaleTable(L, season.scaleStand);
  } else L.push("Skipped: the model has no odds as rosters stand.", "");
}

/** Why the automatic playoff weight fell back to config.lineups.playoffWeight (PlayoffWeightAuto.reason), in words. */
export const PLAYOFF_WEIGHT_FALLBACK_WORDS: Readonly<Record<PlayoffWeightFallback, string>> = {
  noTeam: "no team is picked",
  noRegularWeeks: "no regular-season week is left to count",
  noPlayoffWeeks: "no playoff week is left to count",
  noOdds: "there are no odds to measure it on",
  titleUnknown: "title odds are unknown",
  noEffect: "neither run moves your odds",
  notFinite: "a B per point isn't a number",
};

/**
 * ω in one phrase for a settings line: "1.63× (set automatically from your odds under “Only the champion”: B per projected point
 * 0.0488 in the regular season, 0.0257 in the playoffs)", or "1.25× (the fallback: title odds are unknown)".
 */
export function playoffWeightSummary(model: Pick<LeagueModel, "playoffWeight" | "playoffWeightAuto">): string {
  const a = model.playoffWeightAuto;
  if (!a) return `${model.playoffWeight}×`;
  if (a.basis !== "auto") return `${a.omega}× (the fallback: ${PLAYOFF_WEIGHT_FALLBACK_WORDS[a.reason ?? "noOdds"]})`;
  const per = (x: number | null) => (x === null ? "–" : fmt(x, 4));
  return `${a.omega}× (set automatically from your odds under “${GOAL_WORDS[a.goal]}”: B per projected point ${per(a.regularPerPoint)} in the regular season, ${per(a.playoffPerPoint)} in the playoffs${a.clamped ? `; at the ${a.clamped === "high" ? "top" : "bottom"} of its clamp` : ""})`;
}

/** A model's thresholds in ROS lineup points (LeagueModel.lineupThresholds), config's for a model built before Phase 7b. */
export function thresholdsOf(model: Pick<LeagueModel, "lineupThresholds">): LineupThresholds {
  return model.lineupThresholds ?? { scale: 1, faMinGain: config.freeAgentOptimizer.faMinGain, chipMinGap: config.needs.chipMinGap };
}

/**
 * A threshold in ROS lineup points as the report quotes it: config's `base` alone at scale 1 ("10"), else the model's value
 * and where it comes from ("11.59 (10 × Σω ÷ Σω₀)"; league.ts step 5c, LeagueModel.lineupThresholds).
 */
export function thresholdText(value: number, base: number, scale: number): string {
  return Math.abs(scale - 1) < 1e-12 ? `${base}` : `${fmt(value, 2)} (${base} × Σω ÷ Σω₀)`;
}

/**
 * The thresholds in ROS lineup points under ω in one line (league.ts step 5c; review of the engine track, Phase 7b): what a
 * free-agent pickup must gain, a trade chip's least gap and a throw-in's most lineup cost, each config's × Σω ÷ Σω₀ over the
 * weeks team numbers count, so they keep the meaning they had at ω₀ (config.lineups.playoffWeight).
 */
export function thresholdsLine(model: Pick<LeagueModel, "lineupThresholds">): string {
  const t = thresholdsOf(model);
  const throwIn = config.search.throwInMaxCost;
  if (Math.abs(t.scale - 1) < 1e-12) return `The thresholds in ROS lineup points are config's (playoff weeks at ω₀ = ${config.lineups.playoffWeight}): a free-agent pickup must gain at least ${config.freeAgentOptimizer.faMinGain}, a trade chip's gap must be at least ${config.needs.chipMinGap}, and a throw-in may cost at most ${throwIn}.`;
  return `The thresholds in ROS lineup points keep the meaning they had at ω₀ = ${config.lineups.playoffWeight}: each is config's × Σω ÷ Σω₀ = ${fmt(t.scale, 3)} over the weeks team numbers count, so a free-agent pickup must gain at least ${fmt(t.faMinGain, 2)} (${config.freeAgentOptimizer.faMinGain} at ω₀), a trade chip's gap must be at least ${fmt(t.chipMinGap, 2)} (${config.needs.chipMinGap}), and a throw-in may cost at most ${fmt(throwIn * t.scale, 2)} (${throwIn}).`;
}

/**
 * "Several prizes"' split in words for the report's lines ("the prefilled split, 1st 60%, 2nd 30%, 3rd 10%"): whole percents
 * (reward.ts prizePercents), the weekly high score's for the whole season; every paid prize, "<1%" for one that rounds to
 * none, as the Settings page shows it (review FB-R2: a paid 1st place that rounds to 0% was left out).
 */
export function prizesWords(reward: Reward): string {
  const pct = prizePercents(reward.shares);
  const words: Record<PrizeKey, string> = { first: "1st", second: "2nd", third: "3rd", weeklyHigh: `weekly high scores (${reward.periods} weeks)`, pointsLeader: "most points" };
  const paid = PRIZE_KEYS.filter((k) => reward.shares[k] > 0).map((k) => `${words[k]} ${pct[k] > 0 ? `${pct[k]}%` : "<1%"}`);
  const same = PRIZE_KEYS.every((k) => Object.is(rewardWith({ goal: "prizes", prizes: config.benefit.prizesDefault }, reward.periods).shares[k], reward.shares[k]));
  return `${same ? "the prefilled split, " : "the league's split, "}${paid.join(", ")}`;
}

/**
 * --prizes' split in this league, for the console once the league is loaded and before the long run (review FB-R2; both
 * reports' main, after runMode.ts prizesReadLine): the Settings page's own line for the same amounts (settingsView.ts
 * prizeSplitText: whole percents, "<1%" for a paid prize that rounds to none, the weekly high score's for the season with
 * how many times it's paid, `periods`: reward.ts prizePeriods), so a list read otherwise than meant, such as amounts typed
 * with thousands separators, shows for what it is. Amounts that pay nothing here (only a weekly high score, in a league with
 * no regular-season prize period) say so: "Several prizes" then counts the title only (reward.ts rewardWith, `empty`).
 */
export function prizesSplitLine(amounts: PrizeAmounts, periods: number): string {
  const shares = prizeShares(amounts, periods);
  if (!shares) return `--prizes pays nothing in this league${(amounts.weeklyHigh ?? 0) > 0 ? " (it has no regular-season prize period to pay a weekly high score in)" : ""}, so “Several prizes” counts the title only.`;
  return `--prizes in this league, as the Settings page would show them: ${prizeSplitText(shares, periods)}`;
}

/** "weeks 5–14" (a run of consecutive weeks), else the list. */
function weekSpan(weeks: readonly number[]): string {
  if (!weeks.length) return "no weeks";
  const consecutive = weeks.every((w, i) => i === 0 || w === (weeks[i - 1] as number) + 1);
  return consecutive && weeks.length > 1 ? `weeks ${weeks[0]}–${weeks.at(-1)}` : `week${weeks.length > 1 ? "s" : ""} ${weeks.join(", ")}`;
}

/**
 * The automatic playoff-week weight (planner reply to Checkpoint 7a, §6.1; league.ts step 5c; LeagueModel.playoffWeightAuto):
 * ω and how it was set, both runs, and ω under each goal from the same runs (league.playoffWeightFrom: the runs don't depend on
 * the goal, only their B per point does). Lines of markdown; a model built before Phase 7b says it has none. Checkpoint 7c:
 * "Several prizes" on `opts.prizes` (the report's --prizes) when given, and its row from the model the app builds under them
 * (`opts.prizesModel`) when there is one: its own ω, the same as these runs priced under its split unless the split pays the
 * weekly high score, which only its runs measured (pricing these under it throws: reward.ts assertWeeklyMeasured).
 */
export function playoffWeightLines(
  model: Pick<LeagueModel, "playoffWeight" | "playoffWeightAuto" | "myTeamId" | "lineupThresholds">,
  teamName: (id: string) => string,
  opts: { prizes?: PrizeAmounts | null; prizesModel?: Pick<LeagueModel, "playoffWeightAuto"> | null } = {},
): string[] {
  const a = model.playoffWeightAuto;
  if (!a) return [`Playoff weeks count ${model.playoffWeight}× (a model built before the automatic weight).`];
  const who = model.myTeamId === null ? "your team" : `${teamName(model.myTeamId)}`;
  const head =
    a.basis === "auto"
      ? `Playoff weeks count **${a.omega}×**, set automatically from ${who}'s odds under “${GOAL_WORDS[a.goal]}” (league.ts step 5c): ω = B per projected point in the playoff weeks ÷ B per point in the regular-season weeks${a.clamped ? `, at the ${a.clamped === "high" ? "top" : "bottom"} of its clamp [${config.lineups.playoffWeightAuto.clamp.join(", ")}]` : ""}${a.ratio !== null ? ` (ratio ${fmt(a.ratio, 3)}, rounded to ${config.lineups.playoffWeightAuto.decimals} decimals)` : ""}.`
      : `Playoff weeks count **${a.omega}×**: the fallback (config.lineups.playoffWeight), since ${PLAYOFF_WEIGHT_FALLBACK_WORDS[a.reason ?? "noOdds"]}.`;
  const out = [head, ""];
  if (!a.runs) return out;
  const r = a.runs;
  // Each goal's reward on the league's prize periods; the model's own when it's "Several prizes" (its user's split), else the
  // report's --prizes (Checkpoint 7c).
  const rewards = goalRewards(a.reward?.periods ?? 0, a.reward, opts.prizes);
  const pts = (x: number | null) => (x === null ? "–" : signed(100 * x, 2));
  out.push(
    `Two runs on the headline's ${thousands(a.sims)} seasons (common random numbers), every team as it stands (before any free-agent pickup: the pickups depend on ω): your weekly score +${a.gain} in the regular-season ${weekSpan(r.regular.weeks)} only: ΔPO ${pts(r.regular.dPO)}, ΔCH ${pts(r.regular.dCH)} points; +${a.gain} in the playoff ${weekSpan(r.playoffs.weeks)} only: ΔPO ${pts(r.playoffs.dPO)}, ΔCH ${pts(r.playoffs.dCH)} points. B per point = 100 × (w_PO ΔPO + w_S ΔE[S]) ÷ (${a.gain} × the weeks changed), ΔE[S] the change in your share of the league's prizes (ΔCH when 1st place pays everything; under Several prizes ${prizesWords(rewards.prizes)}). It weighs every ROS(T) (the free-agent optimizer, lineup costs, trade chips, the search's shortlists), never a player's own ROS points.`,
    "",
    "| Goal | B per point, regular season | B per point, playoffs | ω |",
    "|---|---|---|---|",
  );
  for (const g of GOALS) {
    const own = g === "prizes" && a.goal !== "prizes" ? opts.prizesModel?.playoffWeightAuto : undefined;
    const w = own ?? playoffWeightFrom(r, rewards[g], a.sims);
    const omega = w.basis === "auto" ? `${w.omega}×${w.clamped ? ` (clamped ${w.clamped})` : ""}` : `${w.omega}× (fallback: ${PLAYOFF_WEIGHT_FALLBACK_WORDS[w.reason ?? "noOdds"]})`;
    out.push(`| ${GOAL_WORDS[g]}${g === a.goal ? " (yours)" : ""} | ${w.regularPerPoint === null ? "–" : fmt(w.regularPerPoint, 4)} | ${w.playoffPerPoint === null ? "–" : fmt(w.playoffPerPoint, 4)} | ${omega} |`);
  }
  out.push("", thresholdsLine(model), "");
  return out;
}

function renderPlayoffWeight(L: string[], model: LeagueModel, season: SeasonReport, teamName: (id: string) => string): void {
  L.push("## Playoff-week weight (automatic)", "");
  const p = season.prizes;
  L.push(...playoffWeightLines(model, teamName, p ? { prizes: p.amounts, prizesModel: p.model } : {}));
}

/** Where the league's data says how 3rd place goes (LeagueSettings.thirdPlace's basis), in words. */
const THIRD_PLACE_BASIS_WORDS: Readonly<Record<NonNullable<LeagueSettings["thirdPlace"]>["basis"], string>> = {
  schedule: "ESPN's playoff schedule lists the game",
  setting: "⚠️ our reading of ESPN's consolation-ladder setting: its playoff schedule doesn't list the game yet",
  bracket: "Sleeper's winners bracket",
};

/** How 3rd place is decided, in a sentence (PrizesReport.thirdPlace). */
export function thirdPlaceWords(t: PrizesReport["thirdPlace"]): string {
  const source = t.data ? ` (${THIRD_PLACE_BASIS_WORDS[t.data.basis]})` : "";
  const sim = t.sim ? (t.sim.rule === "game" ? `The season simulation plays a 3rd-place game between the two semifinal losers${t.sim.assumed ? ", assumed: the league's data doesn't say" : ""}.` : "The season simulation gives 3rd to the better regular-season seed of the two semifinal losers (⚠️ our assumption).") : "";
  return `The Import Report's "3rd-place game" row: ${t.row.replace(/\.$/, "")}${source}. ${sim}`.trim();
}

/** A share of my odds as the section prints it: one decimal ("<0.1%", ">99.9%" at the edges), "–" when unknown. */
const oddsCell = (x: number | null): string => pct(x);

/**
 * The league prizes section (Checkpoint 7c; planner reply to Checkpoint 7b, §6 and "Checkpoint 7c must include": "how 3rd
 * place is decided in his league, his odds of 1st, 2nd and 3rd, his B₃"), with --prizes only.
 */
export function prizesLines(p: PrizesReport): string[] {
  const shares = PRIZE_KEYS.filter((k) => p.reward.shares[k] > 0);
  const weekly = p.reward.shares.weeklyHigh > 0;
  const out = [
    `Planner reply to Checkpoint 7b, §6: the league's prizes as --prizes gave them, "Several prizes" in Settings (${prizesWords(p.reward)} of the season's prizes, whole percents; src/engine/reward.ts prizeShares: each amount ÷ the total of all prizes, the weekly high score counted once per regular-season prize period, ${p.reward.periods} in this league). B_win = 100 × (${goalWeights("prizes").playoffs} × ΔPO + ${goalWeights("prizes").prizes} × ΔE[S]), ΔE[S] the change in your share of the prizes, so "Helps you", Overall, B₃ and the playoff-week weight ω all follow the split (${shares.length} prize${shares.length === 1 ? "" : "s"} paid).`,
    "",
    `**How 3rd place is decided:** ${thirdPlaceWords(p.thirdPlace)}`,
    "",
    "| Setting | ω | B₃ | P(1st) | P(2nd) | P(3rd) | Top 3 | P(playoffs) |" + (weekly ? " Weekly high scores won |" : ""),
    "|---|---|---|---|---|---|---|---|" + (weekly ? "---|" : ""),
  ];
  for (const r of p.rows) {
    const percents = prizePercents(p.reward.shares);
    const label = r.goal === "prizes" ? `${GOAL_WORDS.prizes} (${PRIZE_KEYS.filter((k) => p.reward.shares[k] > 0).map((k) => `${PRIZE_SHORT[k]} ${percents[k] > 0 ? `${percents[k]}%` : "<1%"}`).join(", ")})` : GOAL_WORDS[r.goal];
    const b3 = r.b3 === null ? "–" : `${fmt(r.b3, 2)}${r.floored ? " (floored)" : ""}`;
    out.push(`| ${label} | ${r.omega}× | ${b3} | ${oddsCell(r.pFirst)} | ${oddsCell(r.pSecond)} | ${oddsCell(r.pThird)} | ${oddsCell(r.top3)} | ${oddsCell(r.pPlayoffs)} |${weekly ? ` ${r.expHighScores === null ? "–" : fmt(r.expHighScores, 2)} |` : ""}`);
  }
  out.push(
    "",
    `Each row is the League model the app builds under that setting: its own playoff-week weight ω (so its own free-agent pickups, lineup costs and trade chips) and its headline odds (every team after its pickups, the same ${thousands(p.model.odds?.sims ?? shownSimsOf())} seasons: common random numbers), and B₃, the B of +${config.benefit.helpsGain} projected points a week under that setting (its "Helps you" scale: +${config.benefit.helpsGain} a week reads 63). Top 3 = P(1st) + P(2nd) + P(3rd).${weekly ? " The weekly high scores are simulated under the split only (it pays them)." : ""}`,
    "",
  );
  return out;
}

/** The prizes in a few letters, for the split's label ("1st 44%"). */
const PRIZE_SHORT: Readonly<Record<PrizeKey, string>> = { first: "1st", second: "2nd", third: "3rd", weeklyHigh: "weekly high scores", pointsLeader: "most points" };

function renderPrizes(L: string[], season: SeasonReport): void {
  if (!season.prizes) return;
  L.push("## League prizes (Checkpoint 7c)", "", ...prizesLines(season.prizes));
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
  L.push("(b) A second League model built from the same snapshot and inputs, every roster copied unchanged (a trade that changes nothing), simulated with the same seed (both odds: with pickups and as rosters stand):", "");
  L.push("| Measure | Largest \\|Δ\\| over the teams |", "|---|---|");
  L.push(`| P(playoffs) | ${b.pPlayoffs} |`, `| P(bye) | ${b.pBye} |`, `| P(title) | ${b.pTitle} |`, `| Expected wins | ${b.expWins} |`, `| Weekly score means and SDs (the simulator's inputs, with pickups and as rosters stand) | ${b.score} |`);
  const zero = b.pPlayoffs === 0 && b.pBye === 0 && b.pTitle === 0 && b.expWins === 0 && b.score === 0 && b.nulls === 0;
  L.push("", zero ? "Every difference is exactly 0. **Pass.**" : `**FAIL**${b.nulls ? ` (${b.nulls} odds or scores known in one model and not the other)` : ""}.`, "");
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
    L.push(
      `buildLeagueModel, the whole League model (the League page's Web Worker runs it), without and with its season simulation (the headline odds); both measure the automatic playoff weight on ${thousands(shownSimsOf())} seasons, as the app does, so the difference is the season simulation's alone:`,
      "",
    );
    L.push("| Lineups | Without the season simulation | With it | The build's own \"season simulation\" stage |", "|---|---|---|---|");
    for (const s of [...new Set(season.buildTimings.map((b) => b.scenarios))]) {
      const off = season.buildTimings.find((b) => b.scenarios === s && b.sims === 0);
      const on = season.buildTimings.find((b) => b.scenarios === s && b.sims > 0);
      L.push(`| ${s === 0 ? "expected-value lineups only" : `${s} availability scenarios`} | ${ms(off?.total)} | ${ms(on?.total)}${on ? ` (${thousands(on.sims)} seasons)` : ""} | ${msFine(on?.simulation)} |`);
    }
    L.push("");
  }
}

/**
 * Streaming positions (CLAUDE.md §7; planner reply to Checkpoint 3, model change 1; Phase 4): who streams what
 * (my setting, or detected from the team's adds at the position this season), each streamed position's
 * replacement per week (the streamRank-th best free agent that week, LeagueModel.streaming.replacement) and its
 * average over the weeks team numbers count, and "Streaming picks this week" with their opponents.
 */
function renderStreaming(L: string[], snapshot: LeagueSnapshot, model: LeagueModel, teamName: (id: string) => string): void {
  const s = config.streaming;
  const streaming = model.streaming;
  const players = snapshot.players;
  L.push("## Streaming positions", "");
  L.push(
    `CLAUDE.md §7 (planner reply to Checkpoint 3, model change 1): a streamed slot is worth, each week, max(the best rostered player, the streaming replacement), the ${ordinal(s.streamRank)}-best free agent at that position that week by that week's projection (fewer free agents: the last one). Your team streams your setting (by default ${s.defaultPositions.join(" and ")}); another team streams a position (${s.streamable.join(", ")}) once it has made ${s.detectAdds} or more adds there this season (add and waiver transactions). Only positions the lineup starts count, with one streamer per position; where a flex takes the position too (TE and FLEX, QB and SUPER_FLEX or OP), the replacement is one more player that week and can start there as well. A streamed slot counts in every team number: lineups, strength and needs, lineup costs, trade chips, partners and the simulator's weekly scores.`,
    "",
  );
  L.push(`| Team | Streams | Why | Adds this season (${s.streamable.join(", ")}) |`, "|---|---|---|---|");
  for (const t of snapshot.teams) {
    const x = streaming.byTeam[t.id];
    const adds = s.streamable.map((p) => `${p} ${x?.adds[p] ?? 0}`).join(", ");
    const why = !x ? "–" : x.source === "setting" ? "your setting" : x.positions.length ? `detected (${s.detectAdds}+ adds)` : "–";
    L.push(`| ${teamName(t.id)} | ${x?.positions.join(", ") || "–"} | ${why} | ${adds} |`);
  }
  L.push("");
  const positions = POSITIONS.filter((p) => streaming.replacement[p] !== undefined);
  if (positions.length) {
    const from = model.inProgressWeek !== null && model.weeks[0] === model.inProgressWeek ? 1 : 0;
    L.push(`The streaming replacement per week (expected points, availability included${from ? `; week ${model.inProgressWeek} is under way, so the average starts the week after` : ""}):`, "");
    L.push(`| Position | ${model.weeks.map((w) => `W${w}`).join(" | ")} | Average |`, `|---|${model.weeks.map(() => "---").join("|")}|---|`);
    for (const p of positions) {
      const rep = streaming.replacement[p] ?? [];
      const counted = rep.slice(from);
      L.push(`| ${p} | ${rep.map((x) => fmt(x)).join(" | ")} | ${counted.length ? fmt(counted.reduce((a, b) => a + b, 0) / counted.length) : "–"} |`);
    }
    L.push("");
  } else {
    L.push("No team streams a position this league starts.", "");
  }
  L.push(`**Streaming picks this week** (week ${snapshot.currentWeek}: the best ${s.picksShown} free agents at K and at DEF by this week's projection, those who can still play this week; the League page's list)`, "");
  if (!streaming.picks.length) {
    L.push("None: no free agent at K or DEF is projected to play this week, or the lineup starts neither.", "");
    return;
  }
  L.push("| Pos | Player | Opponent | Projection |", "|---|---|---|---|");
  for (const p of streaming.picks) L.push(`| ${p.pos} | ${playerLabel(players[p.playerId], p.playerId)} | ${p.opponent ? `${p.opponent.home ? "vs" : "@"} ${p.opponent.team}` : "unknown"} | ${fmt(p.projection)} |`);
  L.push("");
}

/** Why a team can't take a player (leagueMarginals.mvAddBlocked), in words. */
function blockedText(b: ReturnType<LeagueMarginals["mvAddBlocked"]>, team: string, platform: LeagueSnapshot["platform"]): string {
  if (!b) return `${team} can take him`;
  if (b.reason === "onTeam") return `${team} is his own team`;
  if (b.reason === "full") return `${team} can't take him: its roster is full and nobody can be dropped`;
  if (b.reason === "positionLimit") return `${team} can't take him: it has its limit of ${b.limit} at ${posLabel(b.pos, platform)} and nobody there it could drop to make room`;
  return `${team}: not a team of this league`;
}

/**
 * The free-agent optimizer (CLAUDE.md §7 V*; planner reply to Checkpoint 3, model change 2; Checkpoint 4 asks for these):
 * each team's pickups and how many moves teams make, then the named examples under V*: what each player costs his team,
 * what he'd add to every other team (MV_add, with the player it drops to make room), and his chip gap.
 */
function renderOptimizer(L: string[], snapshot: LeagueSnapshot, model: LeagueModel, opt: OptimizerReport, teamName: (id: string) => string, pre4c: Pre4cOrder | null): void {
  const o = config.freeAgentOptimizer;
  const th = thresholdsOf(model);
  const minGain = thresholdText(th.faMinGain, o.faMinGain, th.scale);
  const players = snapshot.players;
  const lineupPts = `lineup pts, playoff weeks × ${model.playoffWeight}`;
  const mode = model.scenarios > 0 ? `scenario lineups (S = ${model.scenarios})` : "expected-value lineups";
  const judging = optimizerJudging(snapshot, model);
  L.push("## The free-agent optimizer (V*)", "");
  L.push(
    `CLAUDE.md §7 (planner reply to Checkpoint 3, model change 2): every team is measured after the free-agent pickups that would help it, one move at a time: the add (dropping a player, or into an open roster spot) with the largest gain in ${lineupPts}, while it gains at least ${minGain}, at most ${o.faMaxMoves} moves; never ${config.streaming.optimizerExcluded.join(" or ")} (streamed or kept) nor a position the team streams, never a player its starting lineup needs. Moves are judged ${optimizerJudgingText(judging, model.scenarios, minGain)}.${judging === "ev" ? "" : " The re-runs behind the lineup costs and MV_add below (from a team's optimized roster after a player leaves or joins) judge their moves by the expected-value gain."} Lineup costs (MV_lose), trade chips (MV_add) and partners compare rosters after these moves, so no trade is credited with a pickup a team could make anyway.`,
    "",
  );
  const alloc = model.faAllocation;
  const dups = duplicatePickups(model.teams);
  L.push(
    alloc
      ? `**One free agent, one team** (§7; planner reply to Checkpoint 4, change 3): teams claim free agents in ${allocationBasisText(alloc.basis)}: ${alloc.order.map((id) => teamName(id)).join(" > ")}; each team's run adds only free agents no earlier team's run claimed (a free agent a later move of the run swapped away stays claimed). Free agents in two or more teams' pickups: **${dups.length}**${dups.length ? ` (${dups.map((d) => `${playerLabel(players[d.playerId], d.playerId)}: ${d.teamIds.map((id) => teamName(id)).join(", ")}`).join("; ")})` : ""}.${alloc.basis === "waiver" ? ` ${waiverOrderNote(snapshot, alloc.order, resetWaiverOrder(model), model.myTeamId, teamName, pre4c)}` : ""}`
      : `**No free-agent allocation** in this model (each team optimized on its own against the whole pool, Checkpoint 4's rule): free agents in two or more teams' pickups: ${dups.length}.`,
    "",
  );
  const total = opt.moves.reduce((s, m) => s + m.moves.length, 0);
  const dist = opt.distribution.map((n, k) => `${k} ${k === 1 ? "move" : "moves"}: ${n} ${n === 1 ? "team" : "teams"}`).join(" · ");
  L.push(`**How many moves teams make:** ${dist}; ${total} in all, ${fmt(total / Math.max(1, opt.moves.length))} a team.`, "");
  const evHead = judging === "scenario" ? "Gain, EV (for reference)" : "Gain, EV (decides)";
  const scenHead = judging === "scenario" ? "Gain, scenarios (decides)" : judging === "evLimits" ? "Gain, scenarios (for reference)" : "Gain, scenarios";
  L.push(`| Team | # | Move | ${evHead} | ${scenHead} |`, "|---|---|---|---|---|");
  for (const m of opt.moves) {
    if (!m.moves.length) {
      L.push(`| ${teamName(m.teamId)} | – | none helps | – | – |`);
      continue;
    }
    m.moves.forEach((x, i) => {
      const move = `add ${playerLabel(players[x.add], x.add)}${x.drop ? `, drop ${playerLabel(players[x.drop], x.drop)}` : " into an open spot"}`;
      L.push(`| ${i === 0 ? teamName(m.teamId) : ""} | ${i + 1} | ${move} | +${fmt(x.gainEv)} | ${x.gainScen === null ? "–" : signed(x.gainScen, 1)} |`);
    });
  }
  L.push("");
  L.push(
    `**Named examples under V*** (${lineupPts}, ${mode}): his lineup cost (MV_lose: his team after its pickups, against the same team without him after it re-optimizes), and MV_add to each other team (that team after its pickups, plus him, minus the player it drops to make room when full, or its lowest keep value at his position when a position limit binds, then its optimizer re-run; unfloored here, a chip floors it at 0). Each re-run holds at most ${o.faMaxMoves} pickups, as a run from scratch could: at a team that used every move, one more pickup is an exchange that must beat its cheapest pickup, which it gives back (league.ts steps 5 and 6). A chip needs maxOther − cost ≥ ${thresholdText(th.chipMinGap, config.needs.chipMinGap, th.scale)}.`,
    "",
  );
  for (const ex of opt.examples) {
    if (!ex.playerId) {
      L.push(`- **${ex.name}**: not in this league's player list.`, "");
      continue;
    }
    const label = playerLabel(players[ex.playerId], ex.playerId);
    if (!ex.teamId || !ex.cost) {
      L.push(`- **${label}**: not on an active roster with a projection.`, "");
      continue;
    }
    const value = (x: { ev: number; scen: number | null }) => x.scen ?? x.ev;
    const cost = value(ex.cost);
    const best = [...ex.adds].sort((a, b) => value(b) - value(a) || (a.teamId < b.teamId ? -1 : 1))[0];
    const focus = ex.focusTeamId ? ex.adds.find((a) => a.teamId === ex.focusTeamId) : undefined;
    const parts = [`on ${teamName(ex.teamId)}; lineup cost ${fmt(cost)}${ex.cost.scen !== null ? ` (EV ${fmt(ex.cost.ev)})` : ""}${ex.cost.autoAdd ? `, his team would add ${playerLabel(players[ex.cost.autoAdd], ex.cost.autoAdd)} without him` : ""}`];
    if (ex.focusTeamId) {
      parts.push(
        focus
          ? `to ${teamName(ex.focusTeamId)}: ${signed(value(focus), 1)}${focus.scen !== null ? ` (EV ${signed(focus.ev, 1)})` : ""}${focus.drop ? `, making room by dropping ${playerLabel(players[focus.drop], focus.drop)}` : " into an open spot"}`
          : blockedText(ex.focusBlocked, teamName(ex.focusTeamId), snapshot.platform),
      );
    }
    if (best) parts.push(`the most to ${teamName(best.teamId)}: ${signed(value(best), 1)}`);
    const gap = best ? Math.max(0, value(best)) - cost : Number.NaN;
    parts.push(ex.chip ? `a trade chip: gap ${fmt(ex.chip.gap)} (maxOther ${fmt(ex.chip.maxOther)} to ${teamName(ex.chip.bestTeamId)} − cost ${fmt(ex.chip.cost)})` : `not a trade chip: gap ${fmt(gap)}${config.market.tradeSearchExcluded.includes(players[ex.playerId]?.pos as Pos) ? " (his position is left out of trade search)" : ""}`);
    L.push(`- **${label}**: ${parts.join("; ")}.`, "");
    L.push("| Team | MV_add | EV | Makes room by dropping |", "|---|---|---|---|");
    for (const a of ex.adds) L.push(`| ${teamName(a.teamId)}${a.teamId === ex.focusTeamId ? " ←" : ""} | ${signed(value(a), 1)} | ${signed(a.ev, 1)} | ${a.drop ? playerLabel(players[a.drop], a.drop) : "– (an open spot)"} |`);
    L.push("");
  }
}

/** The market blend (§6 step 8; the file header, Phases 4b and 4c): the curve's coverage per position, the clamp, and the League page's lines. */
function renderBlend(L: string[], b: BlendLines, snapshot: LeagueSnapshot): void {
  const mb = config.marketBlend;
  const [lo, hi] = b.clamp;
  L.push("## Market-blended projections", "");
  L.push(
    `CLAUDE.md §6 step 8 (planner reply to Checkpoint 4, change 1): every ${mb.positions.join(", ")} with a real FantasyCalc value in this season's list for the league's format has his points per game pulled part of the way toward what our base rates give healthy players valued like him: b′ = (1 − w)·b + w·R_pos(v), w = ${fmt(b.weight, 2)} (config.marketBlend.weight ${mb.weight}), R_pos the isotonic curve of base rates on value over his position's healthy valued players (each read off the curve fitted without him, except at the two ends of the value range, who read it with their own point in it). Then the factor f = b′ / b is clamped to [${lo}, ${hi}] (config.marketBlend.factorClamp; Phase 4c, planner reply to Checkpoint 4b, change 4: "Extreme factors are where data glitches and market hype concentrate"), so a clamped player's base rate is b × f, not b′. His weekly points and ROS points scale by f, so byes, availability and week shape stay the model's, and every team number (lineups, needs, chips, V*, the odds) reads the blended points. A position with fewer than ${mb.minPlayers} curve points isn't blended.`,
    "",
  );
  if (!b.positions.length) {
    L.push("Nothing is blended in this model (no weight, or no season list of values).", "");
    return;
  }
  L.push("| Position | Players with a real value | Curve points (healthy, a game left) | Blended |", "|---|---|---|---|");
  for (const p of b.positions) L.push(`| ${p.pos} | ${p.players} | ${p.fit} | ${p.blended ? "yes" : `no (under ${mb.minPlayers} curve points)`} |`);
  L.push("");
  L.push(
    `- Players the blend reaches: **${b.reached}** (${b.scaled} with a base rate above 0); players whose rest-of-season points it moved (PlayerModel.blend): **${b.moved}**.`,
    b.clamped.length
      ? `- The clamp cut **${b.clamped.length}** factor${b.clamped.length === 1 ? "" : "s"}: ${b.clamped.map((c) => `${playerLabel(snapshot.players[c.id], c.id)} ×${fmt(c.fRaw, 3)} → ×${fmt(c.f, 2)} (its ${c.bound === "high" ? "upper" : "lower"} bound)`).join("; ")}. The trade report's section 6 lists the most extreme factors with what each one's record shows.`
      : `- The clamp cut no factor (every f within [${lo}, ${hi}]).`,
    `- The League page's player breakdown line (tap or hover on a player; in words only, never a number of the market's: planner reply to Checkpoint 7a, 5.4): **${b.rosterLines + b.freeAgentLines}** lines, ${b.rosterLines} on the rosters and ${b.freeAgentLines} in the free-agent lists. **${b.words.leansUp}** read "His projection leans up toward the trade market's view.", **${b.words.leansDown}** "…leans down…", **${b.words.capped}** add that the clamp cut it ("…, by the most it can: ${Math.round((hi - 1) * 100)}%." up, ${Math.round((1 - lo) * 100)}% down), and **${b.words.barely}** "The trade market barely moves his projection." (his rest-of-season points print the same before and after; it includes players at one end of their position's value range, whose market number is their own: ${b.ownPoint} such players in the model).`,
    "",
  );
}

/** IR returners (§6–§7; the file header, Phase 4b). */
function renderIrReturners(L: string[], rows: readonly IrReturnerRow[], snapshot: LeagueSnapshot, inputs: ModelInputs, teamName: (id: string) => string): void {
  const players = snapshot.players;
  const last = inputs.nfl.lastWeek;
  L.push("## IR returners", "");
  L.push(
    `CLAUDE.md §6–§7 (planner reply to Checkpoint 4, change 5): an IR player with a model rejoins his team's lineups from his expected return week R, the first remaining week his chance of being back reaches ${fmt(100 * config.projections.returnWeekQuantile, 0)}% (availability.expectedReturnWeek; his own availability keeps him out before it). From R he needs an active roster spot: when the roster is full then, the lowest keep value player goes from R on (never one the starting lineup needs, nor the last one at a position the team streams; the returner himself can be the one released). That displacement counts in the final numbers only: each team as it stands here (lineups, strength, needs and the odds), and in the trade evaluation the baseline at V*(T) and both sides of every trade.`,
    "",
  );
  if (!rows.length) {
    L.push("No team has a player on IR.", "");
    return;
  }
  L.push("| Team | IR player | Status | ESPN return week | Expected return week R | Rejoins the lineups | From R, the team as it stands drops |", "|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const espn = r.espnWeek === null ? "–" : last !== undefined && r.espnWeek > last ? `${r.espnWeek} (out for the season)` : String(r.espnWeek);
    const drop = !r.returner ? "–" : r.drop ? (r.drop.self ? `releases him at week ${r.drop.week}` : `${playerLabel(players[r.drop.playerId], r.drop.playerId)} from week ${r.drop.week}`) : "nobody (room on the roster)";
    L.push(`| ${teamName(r.teamId)} | ${playerLabel(players[r.playerId], r.playerId)} | ${r.status ?? "–"} | ${espn} | ${r.R ?? "not back this season"} | ${r.returner ? "yes" : "no"} | ${drop} |`);
  }
  L.push("");
  const back = rows.filter((r) => r.returner);
  L.push(`${back.length} of ${rows.length} IR players rejoin their teams' lineups; ${back.filter((r) => r.drop).length} of those returns need a roster spot their team makes by dropping someone from R on.`, "");
}

/** How a report run was made (the header): the command's mode, the data line, the day it was written, and the command itself. */
export interface ReportHead {
  mode: "offline" | "live";
  dataNote: string | null;
  generatedAt: Date;
  /** The command line it ran with (runMode.reportCommandText), so the header reproduces it; default: the script, with --live when live. */
  command?: string;
  /** A dump from before the 4c adapter that the report put on the 4c rule (asWeeklyResetData), or null/absent. */
  pre4c?: Pre4cOrder | null;
}

function render(snapshot: LeagueSnapshot, inputs: ModelInputs, model: LeagueModel, evOnly: LeagueModel, timing: Record<string, number>, depthOf: DepthOf, season: SeasonReport, optimizer: OptimizerReport, head: ReportHead, blend: BlendLines, ir: readonly IrReturnerRow[]): string {
  const L: string[] = [];
  const teamName = (id: string) => `Team ${id}${id === model.myTeamId ? " (you)" : ""}`;
  const players = snapshot.players;
  const weeks = model.weeks;
  const myTeam = model.teams.find((t) => t.id === model.myTeamId);

  L.push("# League model: Parker's ESPN league", "");
  L.push(`Generated by \`${head.command ?? commandText("league:report", [head.mode === "live" ? "--live" : null])}\` on ${head.generatedAt.toISOString().slice(0, 10)} through the real adapters, model-inputs builder and engine. Team, owner and league names are placeholders; NFL player names are public.`, "");
  L.push(`**League 1** · ESPN · ${snapshot.season} · week ${snapshot.currentWeek} · ${snapshot.teams.length} teams · remaining weeks ${weeks[0] ?? "–"}–${weeks.at(-1) ?? "–"} (regular season ${model.regularWeeks.length}, playoffs ${model.playoffWeeks.length}) · ${model.scenarios} availability scenarios · ${model.odds ? `${thousands(model.odds.sims)} simulated seasons` : "no season simulation"}`, "");
  L.push("**Data**", "");
  if (head.dataNote) L.push(`- ${head.dataNote}`);
  for (const s of inputs.sources) L.push(`- ${s.source}: ${s.fetchedAt}${s.stale ? " (saved copy; the live fetch failed)" : ""}`);
  L.push(`- FantasyCalc format: ${model.market.format ? fantasyCalcFormatLabel(model.market.format) : "values unavailable"}${inputs.market?.fallback ? ` (⚠️ ${fantasyCalcFallbackText(inputs.market.fallback)})` : ""}`);
  if (head.pre4c) L.push(`- Waiver order used: ${waiverOrderText(snapshot)}. ${pre4cText(head.pre4c, model.myTeamId, teamName)}`);
  else L.push(`- Waiver order used: ${waiverOrderText(snapshot)}${waiverRanksPre4c(snapshot) ? " (⚠️ this data comes from before the 4c adapter: its waiver ranks are ESPN's live order on the day of the import; the free-agent optimizer's section says more)" : ""}`);
  const ag = model.projection.agreement;
  L.push(`- ESPN vs Sleeper projections, week ${ag?.week ?? snapshot.currentWeek}: ${ag ? `Σ|ESPN − Sleeper| / Σ Sleeper = ${fmt(100 * ag.meanRelDiff)}% over ${ag.players} rostered players${agreementAside(ag.leftOut, ag.leftOutStatuses)}` : "not compared"} → ${model.projection.espnAveraged ? "averaged" : "Sleeper only"} (§6: average only within ${100 * config.projections.espnSleeperAgreement}%)`);
  if (model.projection.disagreements.length) L.push(`- Sources disagree by more than ${100 * config.projections.sourceDisagreementLog}% on: ${model.projection.disagreements.map((d) => `${playerLabel(players[d.playerId], d.playerId)} ESPN ${fmt(d.espn)} vs Sleeper ${fmt(d.sleeper)}`).join("; ")}`);
  L.push(`- Base rates by source: ${Object.entries(model.projection.sources).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  for (const n of inputs.notes) L.push(`- Note: ${n}`);
  for (const w of inputs.warnings) L.push(`- Warning \`${w.code}\`: ${w.message}`);
  for (const w of model.warnings) L.push(`- Engine: ${w}`);
  L.push("");

  // Phase 3: the season simulation.
  renderStandings(L, season, snapshot, model, teamName);
  renderSchedule(L, season, snapshot, model, teamName);
  renderScale(L, season, model, snapshot.settings.leagueType);
  renderPlayoffWeight(L, model, season, teamName);
  renderPrizes(L, season);
  renderNoOp(L, season);

  L.push("## Timings", "", "| Stage | Time |", "|---|---|");
  for (const [k, v] of Object.entries(timing)) L.push(`| ${k} | ${ms(v)} |`);
  for (const [k, v] of Object.entries(model.timings)) L.push(`| engine (S = ${model.scenarios}): ${k} | ${ms(v)} |`);
  for (const [k, v] of Object.entries(evOnly.timings)) L.push(`| engine (expected-value lineups only): ${k} | ${ms(v)} |`);
  L.push("", "The engine rows are each model's first build in this process (the JIT still cold); the medians below are steadier.", "");
  renderRuntime(L, season);

  // Parker's projected points per week against the league.
  L.push("## Projected starting-lineup points per week", "");
  L.push("Scenario lineups as rosters stand (§7: the average over availability scenarios, so depth counts). EV = expected-value lineups. Simulator = your weekly score as the season simulation draws it (mean ± SD; a week in progress as if none of its games had started, with today's rosters and injury news): as rosters stand (TeamModel.score), and after every team's free-agent pickups (TeamModel.scoreWithPickups, the headline odds'; a week in progress keeps its as-stands score).", "");
  L.push("| Week | You | Rank | League median | Best | You, EV | Simulator, you | Simulator, you with pickups |", "|---|---|---|---|---|---|---|---|");
  weeks.forEach((w, wi) => {
    const lvs = model.teams.map((t) => ({ id: t.id, lv: (t.scen ?? t.ev).lv[wi] ?? 0 }));
    const mine = lvs.find((x) => x.id === model.myTeamId)?.lv;
    const rank = mine === undefined ? "–" : String(1 + lvs.filter((x) => x.lv > mine).length);
    const po = model.playoffWeeks.includes(w) ? " (playoffs)" : w === model.inProgressWeek ? " (in progress: its games have started; team numbers skip it)" : "";
    const simOf = (s: WeeklyScores | undefined) => (s ? `${fmt(s.mean[wi] ?? Number.NaN)} ± ${fmt(s.sd[wi] ?? Number.NaN)}` : "–");
    L.push(`| ${w}${po} | ${mine === undefined ? "–" : fmt(mine)} | ${rank} | ${fmt(median(lvs.map((x) => x.lv)))} | ${fmt(Math.max(...lvs.map((x) => x.lv)))} | ${myTeam ? fmt(myTeam.ev.lv[wi] ?? 0) : "–"} | ${simOf(myTeam?.score)} | ${simOf(myTeam?.scoreWithPickups)} |`);
  });
  L.push("", "| Team | Record | PF | Proj/wk (scenario) | Proj/wk (EV) | ROS (scenario, playoff weeks × " + model.playoffWeight + ") |", "|---|---|---|---|---|---|");
  const ranked = [...model.teams].sort((a, b) => (b.scen ?? b.ev).ppw - (a.scen ?? a.ev).ppw);
  for (const t of ranked) {
    const st = snapshot.teams.find((x) => x.id === t.id);
    L.push(`| ${teamName(t.id)} | ${st ? recordOf(st.record) : "–"} | ${st ? fmt(st.pointsFor) : "–"} | ${fmt((t.scen ?? t.ev).ppw)} | ${fmt(t.ev.ppw)} | ${fmt((t.scen ?? t.ev).ros, 0)} |`);
  }
  L.push("");

  // The market blend (Phase 4b; its clamp, Phase 4c).
  renderBlend(L, blend, snapshot);

  // Streaming positions (Phase 4).
  renderStreaming(L, snapshot, model, teamName);

  // The free-agent optimizer (Phase 4; one free agent, one team since Phase 4b).
  renderOptimizer(L, snapshot, model, optimizer, teamName, head.pre4c ?? null);

  // IR returners (Phase 4b).
  renderIrReturners(L, ir, snapshot, inputs, teamName);

  // Needs, trade chips and partners.
  const lineupPts = `lineup pts, playoff weeks × ${model.playoffWeight}${model.scenarios ? `, scenario lineups (S = ${model.scenarios})` : ", expected-value lineups"}`;
  L.push("## Needs and trade chips, every team", "");
  L.push(`Needs: lineup slots at or below z = ${config.lineups.needZThreshold} against the league (rest of season; "next" = only over the next ${config.lineups.strengthWeeks} weeks).`, "");
  L.push("| Team | Needs | Trade chips |", "|---|---|---|");
  for (const t of model.teams) {
    const needs = t.needs.map((n) => `${n.slot}${n.window === "next" ? " (next)" : ""} z ${fmt(n.z)}`).join(", ") || "none";
    L.push(`| ${teamName(t.id)} | ${needs} | ${t.chips.length} |`);
  }
  L.push("");
  L.push(
    `Trade chips (§7; planner reply to Checkpoint 2, answer 2): gap = maxOther − cost ≥ ${thresholdText(thresholdsOf(model).chipMinGap, config.needs.chipMinGap, thresholdsOf(model).scale)} (${lineupPts}). cost = what his team loses without him (lineup cost: his team after its free-agent pickups, against the same team without him after it re-optimizes); maxOther = the most he'd add to another team's lineup: that team after its free-agent pickups, plus him, minus the player it would drop to make room when its roster is full (the one whose loss costs its lineup least, nobody refilling his spot), at his position instead when a position limit binds, then its optimizer re-run (at most ${config.freeAgentOptimizer.faMaxMoves} pickups, as from scratch: past the cap only an exchange for its cheapest pickup). ${config.market.tradeSearchExcluded.join(", ")} are never chips (left out of trade search). Every chip is listed; the League page shows the first ${config.needs.chipsShown} per team. For the page (planner reply to Checkpoint 3, answer 3): cost/wk = cost ÷ Σ ω over the weeks team numbers count (the page's "costs you 6.1 pts/wk"), and Starter = he's in his team's expected-value lineup after its free-agent pickups in at least half of those weeks in which he plays (the page's "starter" tag; never a player those pickups drop).`,
    "",
  );
  L.push("| Team | Player | Gap | Cost | Cost/wk | Starter | maxOther | Best team |", "|---|---|---|---|---|---|---|---|");
  let chipRows = 0;
  for (const t of model.teams) {
    for (const c of t.chips) {
      chipRows++;
      L.push(`| ${teamName(t.id)} | ${playerLabel(players[c.playerId], c.playerId)} | ${fmt(c.gap)} | ${fmt(c.cost)} | ${fmt(c.costPerWeek)} | ${c.starter ? "starter" : "–"} | ${fmt(c.maxOther)} | ${teamName(c.bestTeamId)} |`);
    }
  }
  if (!chipRows) L.push("| – | no trade chips | | | | | | |");
  L.push("");
  if (model.partners.length) {
    L.push("**Best trade partners for your team** (from the trade chips: what each would add per week to the other lineup, after that team's free-agent pickups)", "");
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
  const fallback = inputs.market?.fallback;
  L.push("## FantasyCalc match rates (rostered QB/RB/WR/TE)", "");
  // Phase 4c (the file header; review of track R, R-7): the ID match is measured only when FantasyCalc's player list was read.
  if (inputs.market && !fantasyCalcPlayersRead(inputs.market)) {
    const why = fallback
      ? ` FantasyCalc didn't answer this build (${fallback.kind === "saved" ? "a saved list stands in" : "an old list calibrates our own value curve"}, from ${fallback.listDate}), and its player list is asked only when it serves a list fresh.`
      : inputs.warnings.some((w) => w.code === FANTASYCALC_PLAYERS_UNAVAILABLE)
        ? ` Its player list couldn't be loaded (the \`${FANTASYCALC_PLAYERS_UNAVAILABLE}\` warning above).`
        : "";
    L.push(`- ID match: not measured. MarketInputs.knownIds names no player beyond FantasyCalc's value lists, so its player list wasn't read in this build (or added nobody), and the match would only repeat the value rate below.${why}`);
  } else L.push(`- ID match (FantasyCalc knows the player): ${skill.length - idMisses.length}/${skill.length} = ${fmt((100 * (skill.length - idMisses.length)) / Math.max(1, skill.length))}% (target ≥ 98%)${idMisses.length ? `; misses: ${idMisses.map((id) => playerLabel(players[id], id)).join("; ")}` : ""}`);
  L.push(`- Has a value in ${fallback ? `the list from ${fallback.listDate}` : "this format"}: ${skill.length - valueMisses.length}/${skill.length} = ${fmt((100 * (skill.length - valueMisses.length)) / Math.max(1, skill.length))}%${fallback?.kind === "curve" ? " (⚠️ in the curve fallback the list only calibrates our curve: every player's value below is our estimate)" : ""}${valueMisses.length ? `; without one (estimated instead): ${valueMisses.map((id) => `${playerLabel(players[id], id)} → ${model.players[id]?.value ? `${Math.round(model.players[id]!.value!.value)} (${model.players[id]!.value!.source})` : "none"}`).join("; ")}` : ""}`);
  L.push(`- Values by source, all relevant players: ${Object.entries(model.market.counts).map(([k, v]) => `${k} ${v}`).join(", ")}; waiver credit W = ${Math.round(model.market.waiverCredit)}; top value ${Math.round(model.market.topValue)}`, "");

  // Depth: expected-value lineups vs scenario lineups.
  L.push("## Depth: a bench player's value to his team, EV lineups vs scenario lineups", "");
  L.push("MV_lose = the team's rest-of-season lineup points with him, minus without him, both after its free-agent pickups (V*: above). EV lineups only count him when he starts in the average case; scenario lineups also count the weeks he fills in for an injured or bye-week starter.", "");
  L.push(`Bench players here are those whose lineup cost under EV lineups is at most ${BENCH_EV_MAX} lineup points: the average-case lineup almost never starts them. Lineup cost is floored at 0, and is 0 for a player the optimizer drops anyway.`, "");
  L.push(`Depth value = his team's rest-of-season lineup points with him minus without him, as the roster stands and with nobody added in his place: the pure effect of scenario lineups. Lineup cost (§7 MV_lose) is measured after the team's pickups and lets it pick up a replacement, so in a deep 10-team waiver pool it is smaller. Both are lineup points with playoff weeks counted ${model.playoffWeight}×.`, "");
  L.push("| Team | Player | ROS pts | Depth value, EV | Depth value, scenarios | Lineup cost, EV | Lineup cost, scenarios |", "|---|---|---|---|---|---|---|");
  const costs = model.teams.flatMap((t) => Object.entries(t.players).map(([id, v]) => ({ team: t.id, id, ev: v.mvLoseEv, scen: v.mvLoseScen ?? Number.NaN, depth: depthOf(t.id, id) })));
  const bench = costs.filter((g) => g.ev <= BENCH_EV_MAX).sort((a, b) => b.depth.scen - a.depth.scen);
  const pick = [...bench.filter((g) => g.team === model.myTeamId).slice(0, 4), ...bench.filter((g) => g.team !== model.myTeamId).slice(0, 6)];
  for (const g of pick) L.push(`| ${teamName(g.team)} | ${playerLabel(players[g.id], g.id)} | ${fmt(model.players[g.id]?.ros.total ?? Number.NaN)} | ${fmt(g.depth.ev)} | ${fmt(g.depth.scen)} | ${fmt(g.ev)} | ${fmt(g.scen)} |`);
  const benchAll = costs.filter((g) => g.ev <= BENCH_EV_MAX && Number.isFinite(g.scen));
  const avg = (f: (g: (typeof benchAll)[number]) => number) => fmt(benchAll.reduce((s, g) => s + f(g), 0) / Math.max(1, benchAll.length));
  if (benchAll.length) L.push("", `Across all ${benchAll.length} such bench players: depth value ${avg((g) => g.depth.ev)} lineup pts under EV lineups vs ${avg((g) => g.depth.scen)} under scenario lineups; lineup cost ${avg((g) => g.ev)} vs ${avg((g) => g.scen)}.`);
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
  /** "offline" (a dump: loadDump) or "live" (default), the data line the header prints (dumpNote), and the day written (default `now`). */
  mode?: "offline" | "live";
  dataNote?: string;
  generatedAt?: Date;
  /** The command line the header prints (ReportHead.command). */
  command?: string;
}

/** What buildReport returns: the markdown (not yet scrubbed) and the numbers behind it. */
export interface LeagueReport {
  doc: string;
  /** The snapshot the report ran on: the one given, or a dump from before the 4c adapter put on the 4c rule (`pre4c`, asWeeklyResetData). */
  snapshot: LeagueSnapshot;
  pre4c: Pre4cOrder | null;
  model: LeagueModel;
  /** The main model's steps 1–5 (its blend, its teams' IR players and lineups). */
  context: LeagueContext;
  season: SeasonReport;
  optimizer: OptimizerReport;
  blend: BlendLines;
  ir: IrReturnerRow[];
  timing: Record<string, number>;
}

/**
 * Everything after the network (the file header): the League models (expected-value lineups only, and with
 * scenarios, both with the season simulation), the Phase 3 numbers and the markdown, not yet scrubbed.
 * `input` must already carry placeholders (placeholders()); a dump from before the 4c adapter is put on the 4c rule
 * first (asWeeklyResetData).
 */
export function buildReport(input: LeagueSnapshot, inputs: ModelInputs, opts: ReportOptions): LeagueReport {
  const { snapshot, pre4c } = asWeeklyResetData(input);
  const { now, clock } = opts;
  const timing = { ...(opts.timing ?? {}) };
  const scenarios = opts.scenarios ?? config.lineups.scenarios;
  let t0 = clock();
  const evOnly = buildLeagueModel(snapshot, inputs, { now, scenarios: 0, clock });
  timing["engine, expected-value lineups only (season simulation included)"] = clock() - t0;
  t0 = clock();
  const { model, context } = buildLeagueModelWithContext(snapshot, inputs, { now, scenarios, clock });
  timing[`engine, with ${scenarios} availability scenarios (season simulation included)`] = clock() - t0;
  const season = seasonReport(snapshot, inputs, model, {
    now,
    clock,
    ...(opts.runs !== undefined ? { runs: opts.runs } : {}),
    ...(opts.warmups !== undefined ? { warmups: opts.warmups } : {}),
    ...(opts.buildRuns !== undefined ? { buildRuns: opts.buildRuns } : {}),
    // Checkpoint 7c: the league's prizes (--prizes), and the model the app builds under them (seasonReport builds it).
    ...(opts.prizes ? { prizes: opts.prizes } : {}),
    ...(opts.prizesModel ? { prizesModel: opts.prizesModel } : {}),
  });
  const optimizer = optimizerReport(snapshot, model, leagueMarginals(snapshot, inputs, { now, scenarios }));
  const blend = blendLines(snapshot, inputs, model, context, now);
  const ir = irReturnerRows(context);
  const head: ReportHead = { mode: opts.mode ?? "live", dataNote: opts.dataNote ?? null, generatedAt: opts.generatedAt ?? now, ...(opts.command ? { command: opts.command } : {}), pre4c };
  const doc = render(snapshot, inputs, model, evOnly, timing, depthValues(snapshot, inputs, model, now), season, optimizer, head, blend, ir);
  return { doc, snapshot, pre4c, model, context, season, optimizer, blend, ir, timing };
}

/** Live (--live): Parker's league through the app's public-link import (or his cookies) and its caches, as the League page loads it. */
async function loadLive(cookies: ReportArgs["cookies"], teamArg: string | undefined, timing: Record<string, number>): Promise<{ snapshot: LeagueSnapshot; inputs: ModelInputs; now: Date }> {
  const useCookies = cookies !== "off" && (cookies === "on" || env("USE_ENV_COOKIES") === "1");
  const leagueId = env("ESPN_LEAGUE_ID");
  if (!leagueId) throw new Error("ESPN_LEAGUE_ID is blank in .env.local.");
  const season = Number(env("ESPN_SEASON") || 2026);
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
  return { snapshot, inputs, now };
}

async function main(): Promise<void> {
  const args = reportArgs(process.argv.slice(2), ROOT);
  if ("error" in args) {
    console.error(args.error);
    process.exitCode = 1;
    return;
  }
  console.log(reportSourceLine(args, ROOT));
  // How --prizes was read, before anything runs (review FB-R2: every comma starts the next prize).
  if (args.prizes) console.log(prizesReadLine(args.prizes));
  registerScrubber(await redactorFromMap("espn"));
  const timing: Record<string, number> = {};
  const clock = () => performance.now();
  const generatedAt = new Date();
  let loaded: { snapshot: LeagueSnapshot; inputs: ModelInputs; now: Date; dataNote: string };
  if (args.dump) {
    const dump = loadDump(args.dump, args.team);
    loaded = { ...dump, dataNote: dumpNote(ROOT, args.dump, dump) };
  } else {
    loaded = { ...(await loadLive(args.cookies, args.team, timing)), dataNote: "Live: Parker's league through the app's public-link import and its caches (league data 10 minutes, projections 6 hours, values 24 hours)." };
  }
  const { snapshot, inputs, now } = loaded;
  // Their split in this league, once it's loaded and before the long run (review FB-R2).
  if (args.prizes) console.log(prizesSplitLine(args.prizes, prizePeriods(snapshot)));
  const command = reportCommandText("league:report", args, ROOT);
  const { doc: raw, model, season: sim, timing: timings, pre4c } = buildReport(snapshot, inputs, { now, clock, timing, mode: args.dump ? "offline" : "live", dataNote: loaded.dataNote, generatedAt, command, ...(args.prizes ? { prizes: args.prizes } : {}) });
  // Public NFL player names are kept whole: a leaguemate's first or last name can be a word of one, and a
  // scrubbed fragment next to the rest of a public name would reveal it (review PRIV-1).
  const doc = scrubEverythingExcept(raw, Object.values(snapshot.players).map((p) => p.name));
  writeFileSync(args.out ?? path.join(ROOT, "reports", "league-report.md"), doc);
  const me = model.teams.find((t) => t.id === model.myTeamId);
  const mine = oddsOf(model.odds, model.myTeamId ?? "");
  const stand = oddsOf(model.oddsAsRostersStand, model.myTeamId ?? "");
  const odds = mine ? `; with pickups: playoffs ${pct(mine.pPlayoffs)}, title ${pct(mine.pTitle)}${stand ? ` (as rosters stand ${pct(stand.pPlayoffs)}, ${pct(stand.pTitle)})` : ""}` : "";
  // The League model's own count (the shown block's since Checkpoint 7e).
  const t5000 = sim.simTimings.find((t) => t.sims === shownSimsOf());
  console.log(
    scrubEverything(
      `league report written: ${Object.keys(model.players).length} players, ${model.teams.length} teams, weeks ${model.weeks[0]}–${model.weeks.at(-1)}; Parker ${me ? `${fmt((me.scen ?? me.ev).ppw)} pts/wk${odds}` : "team unknown"}; playoff weeks × ${model.playoffWeight} (${model.playoffWeightAuto?.basis === "auto" ? "automatic" : `fallback${model.playoffWeightAuto?.reason ? `: ${model.playoffWeightAuto.reason}` : ""}`}); ${t5000 ? `${thousands(t5000.sims)} seasons ${msFine(t5000.total)}; ` : ""}timings ${Object.entries(timings).map(([k, v]) => `${k} ${ms(v)}`).join(", ")}${pre4c ? `; a dump from before the 4c adapter, put on the ${pre4c.waiverOrderUsed === "live" ? "dump's own order" : "weekly reset order"}` : ""}${prizesSummary(sim.prizes)}`,
    ),
  );
}

/** The console line's prizes part (Checkpoint 7c): each setting's ω, B₃ and P(1st) / P(2nd) / P(3rd) / top 3; empty without --prizes. */
export function prizesSummary(p: PrizesReport | null): string {
  if (!p) return "";
  const rows = p.rows.map((r) => `${GOAL_WORDS[r.goal]}: ω ${r.omega}×, B₃ ${r.b3 === null ? "–" : fmt(r.b3, 2)}, P(1st) ${pct(r.pFirst)}, P(2nd) ${pct(r.pSecond)}, P(3rd) ${pct(r.pThird)}, top 3 ${pct(r.top3)}`);
  return `; prizes (${prizesWords(p.reward)}): ${rows.join("; ")}; 3rd place: ${p.thirdPlace.sim ? (p.thirdPlace.sim.rule === "game" ? `a game${p.thirdPlace.sim.assumed ? " (assumed)" : ""}` : "the better seed") : "–"}`;
}

// Run only as a script (npm run league:report), never when a test or another script imports the logic above (an exact
// path: scripts/lib/runMode.ts isMainModule). The offline guard goes on first unless --live (A5).
if (isMainModule(import.meta.url)) {
  setNetworkMode(wantsLive(process.argv.slice(2)));
  loadEnv();
  installConsoleScrubber();
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    process.exit(1);
  });
}
