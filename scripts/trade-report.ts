/**
 * Checkpoint 4c numbers for Parker's league (planner reply to Checkpoint 4b, reports/planner-reply-4b.md, "Checkpoint 4c
 * (short) must include"; the lead's Phase 4c design, track R), computed through the real engine exactly as the Trade
 * Finder's and the Trade Analyzer's Web Worker runs it: buildTradeContext, runTradeSearch, runRefilter and analyzeTrade
 * (src/engine/evaluate.ts, search.ts), the League model (league.ts buildLeagueModel), the market blend's records
 * (blend.ts blendRecords) and the acceptance model (acceptance.ts, premium.ts).
 *
 *   npm run trade:report                           no network: the newest git-ignored placeholder dump of Parker's league
 *                                                  (data-local/parker-league*, by meta.json's time; snapshot.json,
 *                                                  inputs.json, meta.json; league-report's loadDump), the engine's `now`
 *                                                  from meta.json
 *   npm run trade:report -- --dump <dir>           that dump instead (--offline <dir> is an alias)
 *   npm run trade:report -- --team <id>            his team, when the data doesn't say
 *   npm run trade:report -- --live                 Parker's ESPN league through the public-link path and the app's caches
 *   npm run trade:report -- --live --cookies       use the .env.local ESPN cookies (also with USE_ENV_COOKIES=1)
 *   npm run trade:report -- --out <file>           write the report there instead of reports/trade-report.md
 *
 * Offline by default (planner reply to Checkpoint 4c, A5; scripts/lib/runMode.ts): without --live the process's offline
 * guard is on, so nothing here can touch the network; the header prints the command with the dump named.
 *
 * The report (reports/trade-report.md) is short (the planner: "only what changed, plus the numbers asked for"); each
 * section says how its numbers were made:
 * 0. Header: the command line, the data and its timestamps, the waiver order used (importReport.waiverOrderText), the
 *    settings (the app's defaults: "Win the title", "Chance they accept: at least 10%"), the baseline odds (with pickups,
 *    and as rosters stand), and the notes and warnings of the inputs, the League model, the context and the search. A dump
 *    from before the 4c adapter (league-report's waiverRanksPre4c: its ranks are ESPN's live order of the import's day) is
 *    first put on the 4c adapter's rule for a league whose order resets weekly, as Parker's does (league-report's
 *    asWeeklyResetData: the weekly reset order from the standings becomes Team.waiverRank, the dump's ranks
 *    Team.liveWaiverRank; ⚠️ assumed, the dump doesn't say), so every section runs on the order the app now uses and the
 *    search's baseline is section 7's headline (review of track R, R-4); the header says so with both orders (pre4cText).
 * 1. Your top 10 under "Win the title" (the default goal): each card's give and get with its injury tags in the card's
 *    words (flags.tagged, tradeView.injuryTagText), the three numbers as printed (Helps you / Chance they accept, its
 *    chance of going through when the veto cuts it / Overall; a chance under 5% reads "<5%": chancePrinted), title and
 *    playoff odds before → after (the search's baseline, plus the trade's ΔCH and ΔPO on the same final block), the weekly
 *    lines (TradeDetail.winChance: weeklyLines), and its next step: the offer-first steps with their players' tags (the
 *    search's own rule, taggerOf), or Plan B in its box's own words (tradeView.planBView: its players' tags as the card
 *    shows them, and since Phase 4c's polish its odds lines: planBOddsText), each with its numbers (review of track R,
 *    R-2); the counts over the top 10 and every card, the Plan B
 *    boxes receiving an injury-tagged player among them (cardCounts); the pattern note (TradeSearchResult.pattern) when it
 *    shows.
 * 2. The goal setting (planner change 8): the same search on the same context under "Balanced" (TradeSettings.goal), the
 *    two top 10s side by side (goalCompare: each trade's place, B, Helps you and Overall under each goal; a trade the
 *    other list doesn't show gets the Analyzer's numbers under that goal, the same final block of seasons).
 * 3. B₃ under each goal (Phase 7a; planner reply to Checkpoint 4c, A2: "Helps you" calibrates itself per league and goal;
 *    helpsScaleSection): the League model's calibration run (LeagueModel.helpsCalibration: ΔPO₃ and ΔCH₃ from +3 points a
 *    week in every week a trade can change), checked against the trade context's own run (evaluate.ts SimState.calibration,
 *    bit for bit), B₃ under each goal as the search scores it (evaluate.helpsScaleOf: raw, floored or not, used), and
 *    league-report's scaleCheck from the one baseline (every team after its pickups: season.pickupSeasonModel,
 *    TeamModel.scoreWithPickups) for +1, +3 and +6 projected points a week (league-report's scaleFrom: a week under way is
 *    left out, as every trade's evaluation leaves it): ΔPO, ΔCH, B and Helps you on the new scale under each goal, its +3
 *    row checked to be the calibration run. Section 1's and 2's cards are scored on the same B₃ (their goal's).
 * 4. The search gap (change 1): Garrett Wilson → Chuba Hubbard + Mike Evans with their team (searchGap: its rank among
 *    that partner's screened candidates by the screening objective, the g window, the partner's keep, the exact
 *    shortlist, the finalists, the card; whether the beams alone screen it; its numbers), the screened counts per
 *    partner with the exhaustive candidates and with the beams alone (search.partnerCandidates on the main context, each
 *    way; checked to reproduce the search's own count, and its exact trades: the shortlist and its lean companions,
 *    search.leanCompanions), what only the exhaustive candidates reach,
 *    the beams-alone search (TradeSearchOptions.exhaustive false, its own contexts: timedSearches), and the runtime per
 *    stage: the cold run (the first search in the process) and the warm median of SEARCH_RUNS, each with its own context.
 * 5. The minimum-chance filter (change 10): from the one search, runRefilter at every option of
 *    config.ranking.minChanceOptions: the cards, the qualifying finalists, the ones the minimum hides, `few`, the time it
 *    took, and whether the search's own minimum reproduces its list (filterRows).
 * 6. The blend (change 4): blendRecords' most extreme factors before the clamp (|ln f|), each with what its record shows
 *    (blendReason, from the record and his points a game so far alone: a data flag the record can show, else "No data
 *    flag" with the facts that rule them out; the disagreement per game; where his results so far fall; the clamp; review
 *    of track R, R-3), how many carry each flag, and every factor the clamp cut (blendReport).
 * 7. Your odds on the one shared baseline (change 9; answer 2): P(playoffs), P(bye), P(title) and expected wins with every
 *    team's pickups in the weekly reset waiver order (the headline: the model every other section ran on), as rosters
 *    stand (the second line) and with the live order (oddsByOrder: Team.liveWaiverRank in place of waiverRank; for a dump
 *    from before the 4c adapter, its own ranks), my place in each order and my pickups; my win chance week by week under
 *    each; the check that the trade search's baseline equals LeagueModel.odds exactly; and that the reset order is today's
 *    standings by the league's rules reversed (resetWaiverOrder).
 * 8. Anything else worth a look: the acceptance anchors (both of the planner's tables through the real functions:
 *    anchorRows, premiumAnchorRows), the cards with a neutral throw-in (market.neutralThrowIns, its rule as built: up to the
 *    difference in player counts on the side giving more players, review of track R, R-5, then matched pairs, one from
 *    each side) against their lean versions from the Analyzer, unrounded (the chance they accept, B and the expected gain,
 *    expectedGain, and the lean version's place in the search, which evaluates it as a lean companion: neutralCards;
 *    review of track R, R-1), the headline's jump at the week's first kickoff (League models 1 ms either side of it:
 *    kickoffJump), and the weeks where every team's pickups move my win chance most (pickupWeeks: both teams' projected
 *    points with and without their pickups, and the pickups).
 *
 * Everything after the network is buildTradeReport (pure but for the clock it is given), which
 * scripts/trade-report.test.ts runs on a synthetic league.
 *
 * Privacy (CLAUDE.md §0.5, §0.6): team, owner and league names are placeholders (league-report's placeholders())
 * before the engine runs; teams read "Team N" and Parker "Team 3 (you)"; the output is scrubbed with the .env.local
 * secrets and the ESPN redaction map, public NFL player names kept whole. Output: reports/trade-report.md and a
 * short console summary.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { importEspnLeagueForModel } from "@/adapters/espn";
import type { ImportDeps } from "@/adapters/types";
import { loadPlayerIdResolver } from "@/data";
import { acceptance, betaNeed, type AcceptanceLeague, type PartnerProfile, type TradeAcceptanceInput } from "@/engine/acceptance";
import { HELPS_AT_GAIN, goalWeights, helpsScaleNotes, protectValueWeight, tradePackage, type HelpsScale } from "@/engine/benefit";
import { blendRecords, type BlendRecord } from "@/engine/blend";
import { config } from "@/engine/config";
import { analyzeTrade, buildTradeContext, helpsScaleOf, proposalKey, tradeInternals, type Screened, type TradeContext, type TradeInternals } from "@/engine/evaluate";
import { injuryTags, tagContextOf } from "@/engine/explain";
import type { MarketInputs, ModelInputs } from "@/engine/inputs";
import { buildLeagueModel, firstKickoff } from "@/engine/league";
import type { BaseRateSource, FaMove, HelpsCalibration, LeagueModel, SeasonOdds, TeamOdds } from "@/engine/leagueModel";
import { neutralThrowIns } from "@/engine/market";
import type { InjuryStatus, LeagueSnapshot } from "@/engine/model";
import { eliteIds, perceivedPackage, teamPremiums } from "@/engine/premium";
import { atMostWaiverCredit, buildPools, leanCompanions, partnerCandidates, runRefilter, runTradeSearch, searchStateOf, shortlistOf } from "@/engine/search";
import { buildSimSetup, pickupSeasonModel } from "@/engine/season";
import { GOALS, defaultTradeSettings, normalizeTradeSettings, type Goal, type TradeSettings } from "@/engine/settings";
import { simNormals } from "@/engine/sim";
import type { InjuryTag, TradeAsset, TradeDetail, TradeEvaluation, TradeProposal, TradeSearchResult } from "@/engine/tradeModel";
import { waiverOrderText } from "@/lib/importReport";
import { acceptText, injuryTagText, knownTagsOf, planBView, seasonEndOf, weeklyLine, type PlanBView } from "@/lib/tradeView";
import { FileCache } from "@/server/cache";
import { createHttpClient } from "@/server/http";
import { buildModelInputs } from "@/server/modelInputs";
import {
  GOAL_WORDS,
  asWeeklyResetData,
  byGoal,
  calibrationMatches,
  commandText,
  dumpNote,
  loadDump,
  ordinal,
  placeholders,
  pre4cText,
  resetWaiverOrder,
  scaleCheck,
  scaleFrom,
  waiverRanksPre4c,
  type ByGoal,
  type Pre4cOrder,
  type ScaleCheck,
} from "./league-report";
import { ROOT, env, loadEnv } from "./lib/env";
import { redactorFromMap } from "./lib/minimize";
import { installConsoleScrubber, registerScrubber, scrubEverything, scrubEverythingExcept } from "./lib/redact";
import { isMainModule, reportArgs, reportCommandText, reportSourceLine, setNetworkMode, wantsLive, type DumpInfo, type Env, type ReportArgs } from "./lib/runMode";

// ---------------------------------------------------------------------------------------------
// Report choices (not model tunables: nothing the engine computes depends on them)

/** Timed runs after SEARCH_WARMUPS untimed ones (the lead's brief: the warm median of 3, plus the cold run). */
export const SEARCH_RUNS = 3;
export const SEARCH_WARMUPS = 1;
/** Trades shown in full and counted as "the top 10" (the planner: "Parker's top 10"). */
export const TOP_DETAIL = 10;
/** The other goal section 2 searches (the planner: "how the top 10 changed from Balanced to 'Win the title'"). */
export const COMPARE_GOAL: Goal = "balanced";
/** Section 4's trade (planner reply to Checkpoint 4b, change 1; public NFL names). */
export const GAP_TRADE = { give: ["Garrett Wilson"], get: ["Chuba Hubbard", "Mike Evans"] } as const;
/** Section 6: how many of the most extreme blend factors are listed (the planner: "the 10 most extreme factors"). */
export const BLEND_EXTREMES = 10;
/**
 * blendReason's words only: an age at most this reads "age N"; at most this many games played is a data flag (next to
 * nothing of this season to go on); points a game so far within this many of ours or the market's number read "at" it.
 */
export const YOUNG_AGE = 23;
export const FEW_GAMES = 1;
export const NEAR_POINTS = 0.5;
/** Section 8: the weeks where every team's pickups move my win chance most (at least config.explain.weeklyLineMin), listed. */
export const PICKUP_WEEKS_SHOWN = 2;
/** Checkpoint 3's B for +1, +3 and +6 a week in Parker's league (CLAUDE.md §10, the weights then 0.35 / 0.65, as rosters stood). */
export const CHECKPOINT3_SCALE: Readonly<Record<number, number>> = { 1: 2.05, 3: 6.3, 6: 12.4 };

/**
 * §11's anchor tests (the planner's reply to Checkpoint 4, change 2's table): the planner's scenarios and P_accept.
 * Features not named are 0 (even value, a = 0, no history, no hole, a 1-for-1, no season context, hot and urg 0); n
 * enters as ΔLineup_P = n × nScale; a redraft league unless `dynasty`.
 */
export const ANCHORS: readonly { name: string; dynasty?: true; g?: number; n?: number; h?: 0 | 1; a?: number; c?: number; percent: number }[] = [
  { name: "Even value; n = 0.5; fills a hole; active (a = +1)", n: 0.5, h: 1, a: 1, percent: 67.9 },
  { name: "Even value; nothing else", percent: 35.4 },
  { name: "g = −0.10; n = 0.5; fills a hole", g: -0.1, n: 0.5, h: 1, percent: 37.8 },
  { name: "g = −0.20; nothing else", g: -0.2, percent: 8.3 },
  { name: "g = +0.15; n = −0.3", g: 0.15, n: -0.3, percent: 48.5 },
  { name: "Even value; inactive (a = −2)", a: -2, percent: 21.4 },
  { name: "3-for-1 (c = 2); even value", c: 2, percent: 25.0 },
  { name: "g = +0.30; n = 0.5 (the 85% cap)", g: 0.3, n: 0.5, percent: 85.0 },
  { name: "Dynasty: even value; n = 0.5; fills a hole; active", dynasty: true, n: 0.5, h: 1, a: 1, percent: 61.1 },
];
/** Both tables within ±0.5 percentage points (the planner's reply to Checkpoint 4, change 2). */
export const ANCHOR_TOLERANCE = 0.5;

/**
 * The star premium's anchor tests (the same reply's table: default coefficients, W = 752, within ±0.5 points), as
 * src/engine/acceptance.test.ts builds them: ten players worth 9,100–10,000 plus partner A's #1 "star" (9,000) and one of
 * mine (9,000) are FantasyCalc's top 12; partner A rosters star, p2 … p7 (5,000 … 1,000), partner B "best" (5,000, not
 * top-12) and b2. A contender has 70% playoff odds, the others 40% (no season context); a = 0, no history.
 */
export const PREMIUM_ANCHORS: readonly { name: string; partner: "A" | "B"; contender: boolean; recv: readonly string[]; give: readonly string[]; n?: number; h?: 0 | 1; percent: number }[] = [
  { name: "1-for-1, equal raw value; partner's #1; top-12; contender; no lineup change", partner: "A", contender: true, recv: ["you9000"], give: ["star"], percent: 10.9 },
  { name: "1-for-1, equal raw value; partner's #6; not top-12", partner: "A", contender: false, recv: ["you2000"], give: ["p6"], percent: 35.4 },
  { name: "Partner gets 4,000 + 3,500 + 3,500 for their #1 top-12 player (9,000); contender; n = 0.6; fills a hole", partner: "A", contender: true, recv: ["r4000", "r3500a", "r3500b"], give: ["star"], n: 0.6, h: 1, percent: 32.8 },
  { name: "The same trade, where the RBs help them twice as much (n = 1.2)", partner: "A", contender: true, recv: ["r4000", "r3500a", "r3500b"], give: ["star"], n: 1.2, h: 1, percent: 55.4 },
  { name: "1-for-1, equal raw value; partner's #2; not top-12", partner: "A", contender: false, recv: ["you5000"], give: ["p2"], percent: 26.3 },
  { name: "1-for-1; partner's #1, not top-12; contender; partner gets 30% more raw value", partner: "B", contender: true, recv: ["you6500"], give: ["best"], percent: 62.0 },
];
export const PREMIUM_ANCHOR_W = 752;

// ---------------------------------------------------------------------------------------------
// Numbers in words

const MINUS = "−";
const EPS = 1e-9;
const finite = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
/** Fixed decimals with a real minus sign; "–" when unknown. */
export function fmt(x: number | null | undefined, d = 1): string {
  if (!finite(x)) return "–";
  const s = Math.abs(x).toFixed(d);
  return x < 0 && Number(s) !== 0 ? `${MINUS}${s}` : s;
}
/** Signed: "+1.2", "−0.4", "0.0". */
export function signed(x: number | null | undefined, d = 1): string {
  if (!finite(x)) return "–";
  const s = fmt(x, d);
  return x > 0 && Number(Math.abs(x).toFixed(d)) !== 0 ? `+${s}` : s;
}
/** A fraction as a plain percent: 0.445 → "44.5%" (`d` decimals). */
export const pctPlain = (x: number | null | undefined, d = 1): string => (finite(x) ? `${fmt(100 * x, d)}%` : "–");
/** A change in a probability, in percentage points: +0.081 → "+8.1 pts". */
export const pts = (x: number | null | undefined, d = 1): string => (finite(x) ? `${signed(100 * x, d)} pts` : "–");
const ms = (x: number | null | undefined): string => (!finite(x) ? "–" : x >= 1000 ? `${(x / 1000).toFixed(2)} s` : x < 10 ? `${x.toFixed(1)} ms` : `${Math.round(x)} ms`);
const thousands = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
/** "✅" when a check holds, "❌" when it doesn't (CLAUDE.md §0.12: ✅ only when the data verifies it). */
const mark = (ok: boolean): string => (ok ? "✅" : "❌");

/** The median of the finite numbers (NaN without any). */
export function median(xs: readonly number[]): number {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = s.length;
  if (!n) return Number.NaN;
  return n % 2 ? (s[(n - 1) / 2] as number) : ((s[n / 2 - 1] as number) + (s[n / 2] as number)) / 2;
}

const playerIds = (xs: readonly TradeAsset[]): string[] => xs.flatMap((a) => (a.kind === "player" ? [a.id] : []));
const asPlayers = (ids: readonly string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));
/** "Garrett Wilson": a public NFL name (the id when he isn't in the data). */
const nameOf = (snapshot: LeagueSnapshot, id: string): string => snapshot.players[id]?.name ?? id;
const names = (snapshot: LeagueSnapshot, ids: readonly string[]): string => (ids.length ? ids.map((id) => nameOf(snapshot, id)).join(" + ") : "nobody");

/** A player's id by his public name (the first one in the data with it), or null. */
export function idByName(snapshot: LeagueSnapshot, name: string): string | null {
  return Object.keys(snapshot.players).find((id) => snapshot.players[id]?.name === name) ?? null;
}

/**
 * "Chance they accept" as the card prints it (planner reply to Checkpoint 4b, answer 5): the card's own words
 * (tradeView.acceptText: a model value under 5%, config.acceptance.displayStep, reads "<5%", never rounded up; else the
 * nearest 5%, acceptance.displayAcceptance), so the report and the card can't drift; "–" when unknown.
 */
export function chancePrinted(p: number): string {
  return finite(p) ? acceptText(p) : "–";
}

/** The three numbers as the card prints them: "35 / 35% Decent / 14", and the chance it goes through when the veto rule cuts it. */
export function threeNumbers(t: Pick<TradeEvaluation, "tradeScore" | "pAccept" | "pComplete" | "acceptLabel" | "overall"> & { detail: Pick<TradeDetail, "vetoRisk"> }): string {
  const veto = t.detail.vetoRisk ? ` (goes through ${chancePrinted(t.pComplete)})` : "";
  return `${t.tradeScore ?? "–"} / ${chancePrinted(t.pAccept)} ${t.acceptLabel}${veto} / ${t.overall ?? "–"}`;
}

/** A Plan B's or a step's three numbers (no veto detail of its own: P_complete beside P_accept when they differ). */
const boxNumbers = (b: { tradeScore: number | null; pAccept: number; pComplete: number; acceptLabel: string; overall?: number | null }): string =>
  `${b.tradeScore ?? "–"} / ${chancePrinted(b.pAccept)} ${b.acceptLabel}${Math.abs(b.pComplete - b.pAccept) > EPS ? ` (goes through ${chancePrinted(b.pComplete)})` : ""} / ${b.overall ?? "–"}`;

/** Title odds before → after, one decimal (the planner: "Title odds 12.1% → 13.4%"). */
export function titleMove(before: number | null, d: number | null): string {
  return finite(before) && finite(d) ? `${pctPlain(before)} → ${pctPlain(before + d)}` : "–";
}
/** Playoff odds before → after, whole percents (the planner: "Playoff odds 65% → 69%"). */
export function playoffMove(before: number | null, d: number | null): string {
  return finite(before) && finite(d) ? `${pctPlain(before, 0)} → ${pctPlain(before + d, 0)}` : "–";
}

/**
 * The card's "Win chance by week" (planner change 9; TradeDetail.winChance), the weeks the card itself picks
 * (tradeView.weeklyLine, so the report can't drift from the card): those whose win chance moves at least
 * config.explain.weeklyLineMin, drops first, then the largest gains, at most weeklyLineMax, in week order (final review
 * of Phase 4c: showing where a trade costs me is the line's point). Null when the evaluation has no weekly chances (no
 * odds); [] when no week moves enough.
 */
export function weeklyLines(winChance: TradeDetail["winChance"], cfg: { readonly weeklyLineMin: number; readonly weeklyLineMax: number } = config.explain): { week: number; before: number; after: number }[] | null {
  if (!winChance) return null;
  const view = weeklyLine(winChance, cfg);
  if (!view) return [];
  const byWeek = new Map(winChance.flatMap((w) => (finite(w.before) && finite(w.after) ? [[w.week, { before: w.before, after: w.after }] as const] : [])));
  return view.weeks.flatMap((v) => {
    const w = byWeek.get(v.week);
    return w ? [{ week: v.week, before: w.before, after: w.after }] : [];
  });
}

/** "Week 9: 68% → 64% · Week 13: 42% → 55%" ("no week moves 3+ points"; "–" without weekly chances). */
export function weeklyText(lines: ReturnType<typeof weeklyLines>): string {
  if (lines === null) return "–";
  if (!lines.length) return `no week moves ${Math.round(100 * config.explain.weeklyLineMin)}+ points`;
  return lines.map((l) => `Week ${l.week}: ${pctPlain(l.before, 0)} → ${pctPlain(l.after, 0)}`).join(" · ");
}

// ---------------------------------------------------------------------------------------------
// The searches and their runtime (sections 1, 2, 4)

export interface RuntimeRun {
  /** buildTradeContext's own stages (TradeContext.timings). */
  context: Record<string, number>;
  /** runTradeSearch's stages (TradeSearchResult.timings: setup … rank, steps, total). */
  search: Record<string, number>;
  /** Context build plus search, wall clock. */
  total: number;
  /** The trades' keys and numbers: the same in every run when the search is deterministic. */
  signature: string;
}

export interface Runtime {
  /** The first run in the process (cold: the JIT and every memo empty: a first Trade Finder visit). */
  cold: RuntimeRun;
  /** The timed runs after the warm-ups, each with its own context, and their medians. */
  runs: RuntimeRun[];
  warmups: number;
  context: Record<string, number>;
  search: Record<string, number>;
  total: number;
  /** Every run returned the same trades with the same numbers. */
  sameEveryRun: boolean;
}

export const signatureOf = (r: TradeSearchResult): string => r.trades.map((t) => `${t.key}:${t.b}:${t.pComplete}:${t.gMine}:${t.planB?.key ?? ""}`).join("|");

function medians(rows: readonly Record<string, number>[]): Record<string, number> {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return Object.fromEntries(keys.map((k) => [k, median(rows.map((r) => r[k] ?? Number.NaN))]));
}

interface SearchRunOptions {
  now: Date;
  clock: () => number;
  scenarios?: number;
  settings: TradeSettings;
  runs: number;
  warmups: number;
}

/** The default search `warmups` + `runs` times, each with its own context (`exhaustive` false: the beams alone); the last run's context and result. */
export function timedSearches(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: SearchRunOptions & { exhaustive?: boolean }): { ctx: TradeContext; result: TradeSearchResult; runtime: Runtime } {
  const { clock } = opts;
  const all: RuntimeRun[] = [];
  let last: { ctx: TradeContext; result: TradeSearchResult } | null = null;
  const warmups = Math.max(0, Math.floor(opts.warmups));
  const total = warmups + Math.max(1, Math.floor(opts.runs));
  for (let i = 0; i < total; i++) {
    const t0 = clock();
    const ctx = buildTradeContext(snapshot, inputs, { now: opts.now, clock, settings: opts.settings, ...(opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {}) });
    const result = runTradeSearch(ctx, { clock, settings: opts.settings, ...(opts.exhaustive === false ? { exhaustive: false } : {}) });
    all.push({ context: { ...ctx.timings }, search: { ...result.timings }, total: clock() - t0, signature: signatureOf(result) });
    last = { ctx, result };
  }
  const done = last as { ctx: TradeContext; result: TradeSearchResult };
  const timed = all.slice(warmups);
  return {
    ...done,
    runtime: {
      cold: all[0] as RuntimeRun,
      runs: timed,
      warmups,
      context: medians(timed.map((r) => r.context)),
      search: medians(timed.map((r) => r.search)),
      total: median(timed.map((r) => r.total)),
      sameEveryRun: all.every((r) => r.signature === all[0]?.signature),
    },
  };
}

/** The League model's build time (as the League page builds it): the first build in the process and the median of the timed ones; the last build. */
export function leagueBuilds(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: SearchRunOptions): { model: LeagueModel; cold: number; warm: number } {
  const times: number[] = [];
  let model: LeagueModel | null = null;
  const warmups = Math.max(0, Math.floor(opts.warmups));
  for (let i = 0; i < warmups + Math.max(1, Math.floor(opts.runs)); i++) {
    const t0 = opts.clock();
    model = buildLeagueModel(snapshot, inputs, { now: opts.now, settings: opts.settings, ...(opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {}) });
    times.push(opts.clock() - t0);
  }
  return { model: model as LeagueModel, cold: times[0] as number, warm: median(times.slice(warmups)) };
}

// ---------------------------------------------------------------------------------------------
// Section 1: the cards

/**
 * The counts the planner asks for: cards, with Plan B, with offer-first steps, receiving an injury-tagged player (the
 * card's own tags), and the Plan B boxes receiving one (`tagsOf`, the search's rule: review of track R, R-2, the injured
 * targets a Plan B asks for were uncounted). An offer-first step receives the card's own players, so the card's count
 * covers it.
 */
export interface CardCounts {
  shown: number;
  planB: number;
  steps: number;
  injuredGet: number;
  planBInjuredGet: number;
}

export function cardCounts(trades: readonly TradeEvaluation[], tagsOf: Tagger): CardCounts {
  return {
    shown: trades.length,
    planB: trades.filter((t) => t.planB).length,
    steps: trades.filter((t) => t.steps).length,
    injuredGet: trades.filter((t) => (t.flags.tagged ?? []).some((g) => g.side === "get")).length,
    planBInjuredGet: trades.filter((t) => t.planB && tagsOf(t.planB.proposal).some((g) => g.side === "get")).length,
  };
}

// ---------------------------------------------------------------------------------------------
// Section 2: the goal setting

/** One trade under each goal: its place among the shown cards (null: not shown), B, Helps you and Overall. */
export interface GoalSide {
  rank: number | null;
  b: number | null;
  helps: number | null;
  overall: number | null;
}

export interface GoalRow {
  key: string;
  partnerId: string;
  give: string[];
  get: string[];
  /** Its chance of going through (the same under every goal: the goal moves B only). */
  pComplete: number;
  title: GoalSide;
  other: GoalSide;
}

export interface GoalCompare {
  goal: Goal;
  result: TradeSearchResult;
  /** The union of both top TOP_DETAIL lists: the default goal's order first, then the other's extras in its order. */
  rows: GoalRow[];
  /** Trades in both top lists. */
  common: number;
}

/**
 * The same search on the same context under `goal` (section 2), and both top `top` lists side by side. A trade one list
 * doesn't show gets the Analyzer's numbers under that list's goal (analyzeTrade: the same final block of seasons).
 */
export function goalCompare(ctx: TradeContext, main: TradeSearchResult, settings: TradeSettings, goal: Goal = COMPARE_GOAL, top = TOP_DETAIL): GoalCompare {
  const result = runTradeSearch(ctx, { settings: { ...settings, goal } });
  const sideOf = (list: TradeSearchResult, key: string, proposal: TradeProposal, g: Goal): GoalSide => {
    const at = list.trades.findIndex((t) => t.key === key);
    const t = at >= 0 ? list.trades[at] : analyzeTrade(ctx, proposal, { settings: { ...settings, goal: g } }).evaluation;
    return { rank: at >= 0 ? at + 1 : null, b: t?.b ?? null, helps: t?.tradeScore ?? null, overall: t?.overall ?? null };
  };
  const seen = new Set<string>();
  const rows: GoalRow[] = [];
  for (const t of [...main.trades.slice(0, top), ...result.trades.slice(0, top)]) {
    if (seen.has(t.key)) continue;
    seen.add(t.key);
    rows.push({ key: t.key, partnerId: t.proposal.partnerId, give: playerIds(t.proposal.give), get: playerIds(t.proposal.get), pComplete: t.pComplete, title: sideOf(main, t.key, t.proposal, settings.goal), other: sideOf(result, t.key, t.proposal, goal) });
  }
  const topKeys = new Set(result.trades.slice(0, top).map((t) => t.key));
  return { goal, result, rows, common: main.trades.slice(0, top).filter((t) => topKeys.has(t.key)).length };
}

// ---------------------------------------------------------------------------------------------
// Section 3: B₃ under each goal (planner reply to Checkpoint 4c, A2)

/**
 * league-report's scaleCheck for my team from the one baseline (every team after its pickups: pickupSeasonModel and
 * TeamModel.scoreWithPickups), on the League model's own seasons, the gains from the first week a trade can change
 * (scaleFrom). Null without odds or a team.
 */
export function scaleCheckOf(snapshot: LeagueSnapshot, model: LeagueModel): ScaleCheck | null {
  const odds = model.odds;
  const me = model.teams.find((t) => t.id === model.myTeamId);
  if (!odds || !me) return null;
  const pick = pickupSeasonModel(model);
  const built = buildSimSetup(snapshot, pick);
  if (!built) return null;
  const run = { sims: odds.sims, seed: odds.seed, normals: simNormals(odds.seed, odds.sims, built.setup.weeks.length, built.setup.teams.length) };
  return scaleCheck(snapshot, pick, me.id, me.scoreWithPickups ?? me.score, run, { from: scaleFrom(model) });
}

/** Section 3 (the file header). */
export interface HelpsScaleSection {
  /** The League model's calibration run (LeagueModel.helpsCalibration, step 8c): ΔPO₃ and ΔCH₃; null without odds or a team. */
  calibration: HelpsCalibration | null;
  /** The trade context's run on its final block (evaluate.ts SimState.calibration) is the same, bit for bit; null without either. */
  contextMatches: boolean | null;
  /** B₃ under each goal as the search scores its cards (evaluate.helpsScaleOf with the report's settings' λ); null without odds. */
  b3: ByGoal<HelpsScale | null>;
  /** league-report's scale check from the one baseline: +1, +3 and +6 a week, Helps you on its +3 row's B₃ (the same B₃). */
  check: ScaleCheck | null;
  /** The check's +3 row is the League model's calibration run, bit for bit (league-report calibrationMatches). */
  checkMatches: boolean | null;
}

/** Section 3: the calibration run, B₃ under each goal as the search uses it, and the scale check on the new scale. */
export function helpsScaleSection(snapshot: LeagueSnapshot, model: LeagueModel, ctx: TradeContext, settings: TradeSettings): HelpsScaleSection {
  const I = tradeInternals(ctx);
  const calibration = model.helpsCalibration ?? null;
  const own = I.sim?.calibration ?? null;
  const contextMatches = calibration && own ? own.gain === calibration.gain && own.from === calibration.from && Object.is(own.dPO, calibration.dPO) && Object.is(own.dCH, calibration.dCH) : null;
  const check = scaleCheckOf(snapshot, model);
  return { calibration, contextMatches, b3: byGoal((g) => helpsScaleOf(I, settings.lambda, g)), check, checkMatches: calibrationMatches(check, calibration) };
}

// ---------------------------------------------------------------------------------------------
// Section 4: the search gap

/** One partner's screened counts (exhaustive candidates and beams alone) and how many of its trades reach each stage. */
export interface PartnerCounts {
  partnerId: string;
  exhaustive: number;
  beams: number;
  exact: number;
  finalists: number;
  cards: number;
}

export interface SearchGap {
  /** GAP_TRADE in this data (Wilson mine, Hubbard and Evans on one other team), or null with the reason. */
  trade: { key: string; partnerId: string; give: string[]; get: string[] } | null;
  missing: string | null;
  /** Its rank among that partner's legal screened candidates by the screening objective (then the key), and its numbers there. */
  screened: { rank: number; of: number; objective: number; gPartner: number } | null;
  /** The beams alone screen it too (TradeSearchOptions.exhaustive false). */
  beams: boolean;
  /** Inside config.search.screeningGWindow on g_mkt(P). */
  inWindow: boolean | null;
  /** Its rank in that partner's keep (the window, the dominance pruning, the best keptPerPartner), and the keep's size. */
  kept: { rank: number; of: number } | null;
  /** In the exactEvaluationMax shortlist over every partner; evaluated exactly (legal); a finalist; its card's place. */
  shortlisted: boolean;
  exact: boolean;
  finalist: boolean;
  card: number | null;
  /** Its numbers: the card's when shown, else the Analyzer's (the same final block). */
  evaluation: TradeEvaluation | null;
  /** The best card with the same partner that gives Garrett Wilson ("or better"), when it isn't this trade. */
  bestSameFamily: { rank: number; trade: TradeEvaluation } | null;
  perPartner: PartnerCounts[];
  /**
   * The re-screening reproduces the search (its rules can't have drifted from the report's reading of them): the screens per
   * partner add up to TradeSearchResult.counts.screened, and every trade the search evaluated exactly is in the shortlist
   * rebuilt here (search.shortlistOf with search.atMostWaiverCredit, the search's own call) or among its lean companions
   * (search.leanCompanions on that shortlist, as the search calls it). Null when nothing was screened.
   */
  reproduces: { counts: boolean; shortlist: boolean } | null;
  /** The legal candidates the beams alone screen, over every partner (their keys). */
  beamsKeys: number;
  /** What only the exhaustive candidates reach (keys the beams alone never screen): exact trades, finalists, cards. */
  onlyExhaustive: { exact: number; finalists: number; cards: number };
}

function drain<T>(it: Generator<void, T, void>): T {
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** The screening objective's order (search.ts byObjective): the objective, highest first, then the key. */
const byObjective = (a: { objective: number; key: string }, b: { objective: number; key: string }): number => (Math.abs(b.objective - a.objective) > EPS ? b.objective - a.objective : a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * The search gap (the file header, section 4): every partner's candidates screened again on the search's own context
 * (search.buildPools, search.partnerCandidates with the exhaustive candidates and without), so the counts per partner and
 * GAP_TRADE's place at each stage (search.shortlistOf with the dominance pruning, then the search's state: its exact
 * trades and finalists, and the result's cards) come from the same rules the search ran.
 */
export function searchGap(ctx: TradeContext, result: TradeSearchResult, settings: TradeSettings): SearchGap {
  const I = tradeInternals(ctx);
  const snapshot = I.snapshot;
  const state = searchStateOf(result);
  const wilson = idByName(snapshot, GAP_TRADE.give[0]);
  const gets = GAP_TRADE.get.map((n) => idByName(snapshot, n));
  const holder = (id: string | null) => (id ? (snapshot.teams.find((t) => t.roster.includes(id) || t.ir.includes(id))?.id ?? null) : null);
  const partnerId = holder(gets[0] ?? null);
  const absent = [GAP_TRADE.give[0], ...GAP_TRADE.get].filter((n) => !idByName(snapshot, n));
  let missing: string | null = null;
  if (absent.length) missing = `${absent.join(" and ")} ${absent.length === 1 ? "isn't" : "aren't"} in this data`;
  else if (holder(wilson) !== result.myTeamId) missing = `${GAP_TRADE.give[0]} isn't on your roster in this data`;
  else if (!partnerId || partnerId === result.myTeamId || gets.some((id) => holder(id) !== partnerId)) missing = `${GAP_TRADE.get.join(" and ")} aren't on the same other team in this data`;
  const trade = missing ? null : { partnerId: partnerId as string, give: [wilson as string], get: gets as string[], key: proposalKey({ partnerId: partnerId as string, give: asPlayers([wilson as string]), get: asPlayers(gets as string[]) }) };
  const empty: SearchGap = { trade, missing, screened: null, beams: false, inWindow: null, kept: null, shortlisted: false, exact: false, finalist: false, card: null, evaluation: null, bestSameFamily: null, perPartner: [], reproduces: null, beamsKeys: 0, onlyExhaustive: { exact: 0, finalists: 0, cards: 0 } };
  if (I.blocked || !I.me || !state) return empty;
  const pools = buildPools(I, settings, null);
  if (pools.stop) return empty;
  const lists: Screened[][] = [];
  const beamsKeys = new Set<string>();
  const perPartner: PartnerCounts[] = [];
  const exactKeys = [...state.exactByKey.keys()];
  const finalKeys = state.finals.map((f) => f.key);
  for (const partner of pools.partners) {
    const H = pools.get.get(partner.id) as { pool: string[]; forced: string[] };
    const pool = { give: pools.give, forcedGive: pools.forcedGive, get: H.pool, forcedGet: H.forced };
    const ex = { screened: 0 };
    lists.push(drain(partnerCandidates(I, partner, pool, settings.maxPerSide, ex, { exhaustive: true })));
    const bm = { screened: 0 };
    for (const s of drain(partnerCandidates(I, partner, pool, settings.maxPerSide, bm, { exhaustive: false }))) beamsKeys.add(s.key);
    perPartner.push({
      partnerId: partner.id,
      exhaustive: ex.screened,
      beams: bm.screened,
      exact: exactKeys.filter((k) => state.exactByKey.get(k)?.partner.id === partner.id).length,
      finalists: state.finals.filter((f) => f.proposal.partnerId === partner.id).length,
      cards: result.trades.filter((t) => t.proposal.partnerId === partner.id).length,
    });
  }
  const only = (keys: readonly string[]) => keys.filter((k) => !beamsKeys.has(k)).length;
  const shortlist = shortlistOf(lists, atMostWaiverCredit(I));
  const shortKeys = new Set(shortlist.map((x) => x.key));
  // The search evaluates the shortlist's lean companions too (search.leanCompanions, its own call on that shortlist).
  const evaluated = new Set([...shortKeys, ...drain(leanCompanions(I, shortlist, lists, pools)).map((x) => x.key)]);
  const reproduces = { counts: perPartner.reduce((n, p) => n + p.exhaustive, 0) === result.counts.screened, shortlist: exactKeys.every((k) => evaluated.has(k)) };
  const out: SearchGap = { ...empty, perPartner, reproduces, beamsKeys: beamsKeys.size, onlyExhaustive: { exact: only(exactKeys), finalists: only(finalKeys), cards: only(result.trades.map((t) => t.key)) } };
  if (!trade) return out;
  const at = pools.partners.findIndex((p) => p.id === trade.partnerId);
  const list = at >= 0 ? [...(lists[at] ?? [])].sort(byObjective) : [];
  const s = list.findIndex((x) => x.key === trade.key);
  const screened = s >= 0 ? (list[s] as (typeof list)[number]) : null;
  const [gLo, gHi] = config.search.screeningGWindow;
  const kept = at >= 0 ? shortlistOf([lists[at] ?? []], atMostWaiverCredit(I)) : [];
  const k = kept.findIndex((x) => x.key === trade.key);
  const card = result.trades.findIndex((t) => t.key === trade.key);
  const evaluation = card >= 0 ? (result.trades[card] as TradeEvaluation) : analyzeTrade(ctx, { partnerId: trade.partnerId, give: asPlayers(trade.give), get: asPlayers(trade.get) }, { settings }).evaluation;
  const family = result.trades.findIndex((t) => t.key !== trade.key && t.proposal.partnerId === trade.partnerId && playerIds(t.proposal.give).includes(wilson as string));
  return {
    ...out,
    screened: screened ? { rank: s + 1, of: list.length, objective: screened.objective, gPartner: screened.gPartner } : null,
    beams: beamsKeys.has(trade.key),
    inWindow: screened ? Number.isFinite(screened.gPartner) && screened.gPartner >= gLo - EPS && screened.gPartner <= gHi + EPS : null,
    kept: k >= 0 ? { rank: k + 1, of: kept.length } : null,
    shortlisted: shortKeys.has(trade.key),
    exact: state.exactByKey.has(trade.key),
    finalist: finalKeys.includes(trade.key),
    card: card >= 0 ? card + 1 : null,
    evaluation,
    bestSameFamily: family >= 0 ? { rank: family + 1, trade: result.trades[family] as TradeEvaluation } : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Section 5: the minimum-chance filter

export interface FilterRow {
  minChance: number;
  cards: number;
  qualifying: number;
  byChance: number;
  few: boolean;
  ms: number;
  /** At the search's own minimum: the re-filtered list is the search's, card for card (null at the other options). */
  same: boolean | null;
}

/** runRefilter from the one search at every option (the file header, section 5); null when the search stopped before ranking. */
export function filterRows(ctx: TradeContext, result: TradeSearchResult, clock: () => number, options: readonly number[] = config.ranking.minChanceOptions): FilterRow[] | null {
  const state = searchStateOf(result);
  if (!state) return null;
  return options.map((minChance) => {
    const t0 = clock();
    const r = runRefilter(ctx, state, { minChance });
    const dt = clock() - t0;
    const same = Math.abs(minChance - (result.filter?.minChance ?? Number.NaN)) <= EPS ? signatureOf(r) === signatureOf(result) : null;
    return { minChance, cards: r.trades.length, qualifying: r.filter?.qualifying ?? 0, byChance: r.hidden.byChance ?? 0, few: r.filter?.few ?? false, ms: dt, same };
  });
}

// ---------------------------------------------------------------------------------------------
// Section 6: the blend

/** A blend record with its reason in words, and the player's points per game so far (PlayerModel.base.actualPpg: a fact shown beside it). */
export interface BlendRow extends BlendRecord {
  reason: string;
  actualPpg: number | null;
}

export interface BlendReport {
  /** Players the blend scales (a base rate above 0), the clamp, and the raw factors' range. */
  count: number;
  clamp: readonly [number, number];
  range: { min: number; median: number; max: number } | null;
  /** The most extreme factors before the clamp, and every factor the clamp cut. */
  rows: BlendRow[];
  clamped: BlendRecord[];
}

const STATUS_WORDS: Readonly<Record<InjuryStatus, string>> = { ACTIVE: "healthy", PROBABLE: "probable", QUESTIONABLE: "questionable", DOUBTFUL: "doubtful", OUT: "out", IR: "on IR", PUP: "on the PUP list", SUSPENDED: "suspended", NA: "not an active NFL player" };

/** Where a base rate comes from (PlayerModel.base.source), in words; the last three are fallbacks (no weekly projection). */
const SOURCE_WORDS: Readonly<Record<BaseRateSource, string>> = {
  "espn+sleeper": "ESPN's and Sleeper's projections averaged",
  sleeper: "Sleeper's projection alone",
  espn: "ESPN's projection alone",
  season: "no weekly projection, so Sleeper's season line ÷ 17",
  actual: "no projection, so his own points a game",
  none: "no projection at all",
};

const capitalized = (s: string): string => (s ? `${s[0]?.toUpperCase() ?? ""}${s.slice(1)}` : s);

/**
 * Where a player's points a game so far (PlayerModel.base.actualPpg, league scoring) fall against our base rate and the
 * market's number: within NEAR_POINTS of one reads "at" it; else below both, above both, or between the two and nearer
 * one. "" without a game played.
 */
function resultsSoFar(r: Pick<BlendRow, "ours" | "market" | "games" | "actualPpg">): string {
  const a = r.actualPpg;
  if (a === null || !finite(a) || r.games === null || r.games <= 0) return "";
  const nearOurs = Math.abs(a - r.ours) <= NEAR_POINTS;
  const nearMarket = Math.abs(a - r.market) <= NEAR_POINTS;
  const where =
    nearOurs && nearMarket
      ? "at both"
      : nearOurs
        ? "at our projection"
        : nearMarket
          ? "at the market's number"
          : a < Math.min(r.ours, r.market)
            ? "below both"
            : a > Math.max(r.ours, r.market)
              ? "above both"
              : `between the two, nearer ${Math.abs(a - r.ours) < Math.abs(a - r.market) ? "ours" : "the market's"}`;
  return `He has scored ${fmt(a)} a game so far (${r.games} game${r.games === 1 ? "" : "s"}), ${where}.`;
}

/**
 * A blend factor's reason in words (planner reply to Checkpoint 4b, change 4: "the reason for each … a fallback base rate,
 * a rookie role change, an injury, hype"), built from its record and his points a game so far alone (review of track R,
 * R-3: the words had only restated the factor). First what the record shows about the data: the flags it can show (a
 * fallback base rate; an injury, which also takes him off the curve: he reads it but doesn't shape it; no game left; at most
 * FEW_GAMES games played), else "No data flag", each with the facts that rule the others out (where his base rate comes
 * from, healthy, games, a young age up to YOUNG_AGE, a curve read with his own point). Then the disagreement per game: the
 * market's number R_pos(v) is the curve of our base rates over healthy players by value (blend.ts rule 4), so "healthy
 * players valued like him are projected X a game". Then where his results so far fall (resultsSoFar), and the clamp when
 * it cut. Never a guess the record can't support: hype and role changes aren't facts it holds, so they're never named.
 */
export function blendReason(r: Pick<BlendRow, "fRaw" | "f" | "clamped" | "ours" | "market" | "curve" | "source" | "fallback" | "games" | "injury" | "age" | "actualPpg">): string {
  const injured = r.injury !== null && r.injury !== "ACTIVE";
  const flags: string[] = [];
  if (r.fallback) flags.push(`a fallback base rate (${r.source ? SOURCE_WORDS[r.source] : "no projection"})`);
  if (injured) flags.push(`${STATUS_WORDS[r.injury as InjuryStatus]}, so off the curve (he reads it but doesn't shape it)`);
  else if (r.curve === "offCurve") flags.push("off the curve (no game left)");
  if (r.games !== null && r.games <= FEW_GAMES) flags.push(r.games === 0 ? "no game played yet" : `${r.games} game played`);
  const facts: string[] = [];
  if (!r.fallback && r.source) facts.push(SOURCE_WORDS[r.source]);
  if (r.injury === "ACTIVE") facts.push("healthy");
  if (r.games !== null && r.games > FEW_GAMES) facts.push(`${r.games} games`);
  if (r.age !== null && r.age <= YOUNG_AGE) facts.push(`age ${r.age}`);
  if (r.curve === "ownPoint") facts.push("the curve read with his own point (an end of his position's value range)");
  const head = flags.length ? `${capitalized(flags.join("; "))}${facts.length ? `; ${facts.join(", ")}` : ""}.` : `No data flag${facts.length ? ` (${facts.join(", ")})` : ""}.`;
  const gap = `Healthy players valued like him are projected ${fmt(r.market)} a game; we project ${fmt(r.ours)}${injured ? " when he plays" : ""}.`;
  const so = resultsSoFar(r);
  const cut = r.clamped ? ` The clamp cuts ×${fmt(r.fRaw, 2)} to ×${fmt(r.f, 2)}.` : "";
  return `${head} ${gap}${so ? ` ${so}` : ""}${cut}`;
}

/** The blend of the trade context's League build (blendRecords on LeaguePlayers.blend and the model's players): section 6. */
export function blendReport(I: TradeInternals, n = BLEND_EXTREMES): BlendReport {
  const records = blendRecords(I.league.lp.blend, I.model.players, (id) => I.snapshot.players[id]);
  const fs = records.map((r) => r.fRaw);
  return {
    count: records.length,
    clamp: config.marketBlend.factorClamp,
    range: fs.length ? { min: Math.min(...fs), median: median(fs), max: Math.max(...fs) } : null,
    rows: records.slice(0, n).map((r) => {
      const actualPpg = I.model.players[r.id]?.base.actualPpg ?? null;
      return { ...r, actualPpg, reason: blendReason({ ...r, actualPpg }) };
    }),
    clamped: records.filter((r) => r.clamped !== null),
  };
}

// ---------------------------------------------------------------------------------------------
// Section 7: odds by waiver order

/** Which order a snapshot's Team.waiverRank holds (settings.waiverOrderUsed; "pre4c": ESPN's live order, before the 4c adapter). */
export type DataOrder = "weeklyReset" | "live" | "faab" | "pre4c" | "none";

export function dataOrderOf(snapshot: LeagueSnapshot): DataOrder {
  return snapshot.settings.waiverOrderUsed ?? (waiverRanksPre4c(snapshot) ? "pre4c" : "none");
}

/** A League model under one waiver order: the order, where it came from, my place and pickups, my odds with pickups. */
export interface OrderOdds {
  how: string;
  order: string[];
  model: LeagueModel;
  place: number | null;
  mine: TeamOdds | null;
  pickups: FaMove[];
}

export interface OddsReport {
  /** Which order the data held as loaded ("pre4c": a dump from before the 4c adapter, which the report put on the 4c rule). */
  data: DataOrder;
  /** The weekly reset order (the headline: the model the report ran on), null when the league doesn't reset weekly (with why). */
  reset: OrderOdds | null;
  resetMissing: string | null;
  /** The live order, null when the data doesn't have it (with why). */
  live: OrderOdds | null;
  liveMissing: string | null;
  /** As rosters stand (the data's model: no pickups, so no order). */
  stand: TeamOdds | null;
  /** My games: the win chance with pickups in the reset order (else the data's), as rosters stand, and in the live order. */
  weekly: { week: number; opponentId: string | null; reset: number | null; stand: number | null; live: number | null }[];
  /** The trade search's baseline equals LeagueModel.odds exactly (JSON, every team and week and the notes). */
  baselineEqual: boolean | null;
  /**
   * When the headline is a weekly reset order (4c data, or a dump put on the 4c rule): the reset order equals today's
   * standings by the league's rules reversed (resetWaiverOrder: the simulator's ranks); null otherwise.
   */
  resetMatchesStandings: boolean | null;
}

const oddsOf = (odds: SeasonOdds | null | undefined, teamId: string | null): TeamOdds | null => (teamId ? (odds?.teams.find((t) => t.teamId === teamId) ?? null) : null);
const myGame = (odds: SeasonOdds | null | undefined, week: number, teamId: string | null) => odds?.weekly.find((w) => w.week === week)?.games.find((g) => g.teamId === teamId) ?? null;

/** The snapshot with every team's waiver rank set from `rank` (a team without one keeps its own). */
function withRanks(snapshot: LeagueSnapshot, rank: (teamId: string) => number | undefined): LeagueSnapshot {
  return { ...snapshot, teams: snapshot.teams.map((t) => ({ ...t, waiverRank: rank(t.id) ?? t.waiverRank })) };
}

/**
 * My odds by waiver order (the file header, section 7). `model` is the League model of the snapshot the report ran on and
 * `ctx` the trade context the search ran on (its baseline must equal model.odds). The other order's model is built with the
 * same options. `opts.pre4c`: the snapshot is a dump from before the 4c adapter that the report put on the 4c rule
 * (league-report's asWeeklyResetData): its reset order was built from the standings and its live order is the dump's own
 * ranks (Team.liveWaiverRank now), and the rows say so.
 */
export function oddsByOrder(snapshot: LeagueSnapshot, inputs: ModelInputs, model: LeagueModel, ctx: TradeContext, opts: { now: Date; settings: TradeSettings; scenarios?: number; pre4c?: Pre4cOrder | null }): OddsReport {
  const me = model.myTeamId;
  const used = dataOrderOf(snapshot);
  const pre4c = opts.pre4c ?? null;
  const data: DataOrder = pre4c ? "pre4c" : used;
  const build = (s: LeagueSnapshot) => buildLeagueModel(s, inputs, { now: opts.now, settings: opts.settings, ...(opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {}) });
  const of = (how: string, m: LeagueModel): OrderOdds => {
    const order = [...(m.faAllocation?.order ?? [])];
    const place = me ? order.indexOf(me) : -1;
    return { how, order, model: m, place: place >= 0 ? place + 1 : null, mine: oddsOf(m.odds, me), pickups: [...(m.teams.find((t) => t.id === me)?.faMoves ?? [])] };
  };
  let reset: OrderOdds | null = null;
  let resetMissing: string | null = null;
  let live: OrderOdds | null = null;
  let liveMissing: string | null = null;
  if (used === "weeklyReset") {
    reset = of(pre4c ? "built by this report from today's standings (reverse standings: the 4c adapter's rule), since the dump comes from before the 4c adapter" : "the data's own: the 4c adapter's weekly reset order (reverse standings)", model);
    const hasLive = snapshot.teams.length > 0 && snapshot.teams.every((t) => typeof t.liveWaiverRank === "number");
    const liveHow = pre4c ? "the dump's own ranks (ESPN's order on the day of the import), now Team.liveWaiverRank, in place of waiverRank" : "the data's Team.liveWaiverRank (ESPN's order on the day of the import) in place of waiverRank";
    if (hasLive) live = of(liveHow, build(withRanks(snapshot, (id) => snapshot.teams.find((t) => t.id === id)?.liveWaiverRank)));
    else liveMissing = "the data has no live order (Team.liveWaiverRank)";
  } else if (used === "pre4c") {
    // A dump from before the 4c adapter that the caller didn't put on the 4c rule (buildTradeReport always does).
    live = of("the data's own: its waiver ranks, ESPN's order on the day of the import (a dump from before the 4c adapter)", model);
    resetMissing = "the dump comes from before the 4c adapter and wasn't put on its rule (league-report's asWeeklyResetData)";
  } else if (used === "live") {
    live = of(pre4c ? "the dump's own (no game had been played: no standings to reset to)" : "the data's own (the league doesn't reset its order weekly)", model);
    resetMissing = pre4c ? "no game had been played: no standings to reset to" : "the league doesn't reset its waiver order weekly";
  } else {
    resetMissing = used === "faab" ? "a FAAB league: free agents go by budget left" : "the data has no waiver order";
    liveMissing = resetMissing;
  }
  const head = reset?.model ?? model;
  const weeks = (head.odds?.weekly ?? []).filter((w) => w.games.some((g) => g.teamId === me));
  const sim = tradeInternals(ctx).sim;
  const reverse = resetWaiverOrder(model);
  return {
    data,
    reset,
    resetMissing,
    live,
    liveMissing,
    stand: oddsOf(model.oddsAsRostersStand, me),
    weekly: weeks.map((w) => ({
      week: w.week,
      opponentId: myGame(head.odds, w.week, me)?.opponentId ?? null,
      reset: myGame(head.odds, w.week, me)?.pWin ?? null,
      stand: myGame(model.oddsAsRostersStand, w.week, me)?.pWin ?? null,
      live: live ? (myGame(live.model.odds, w.week, me)?.pWin ?? null) : null,
    })),
    baselineEqual: model.odds ? JSON.stringify(sim?.odds ?? null) === JSON.stringify(model.odds) : null,
    resetMatchesStandings: used === "weeklyReset" && reverse ? reverse.length === (reset?.order.length ?? -1) && reverse.every((id, i) => id === reset?.order[i]) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Section 8: anything else

export interface AnchorRow {
  name: string;
  planner: number;
  computed: number;
  diff: number;
  pass: boolean;
}

/** A partner without trade history at activity `a` and `pPlayoffs` playoff odds (0.4: no season context). */
function anchorProfile(a: number, pPlayoffs: number): PartnerProfile {
  return {
    teamId: "P",
    activity: { a, rule: a === 1 ? "active" : a === -2 ? "inactive" : a === -1 ? "quiet" : "normal", trades: 0, recentTrades: 0, transactions: 0, lastWeek: null },
    history: { hist: null, average: null, trades: 0, used: 0, skipped: 0, perTrade: [] },
    pPlayoffs,
  };
}

const ANCHOR_LEAGUE: AcceptanceLeague = { leagueType: "redraft", tradeReview: "none" };
const DYNASTY_ANCHOR_LEAGUE: AcceptanceLeague = { leagueType: "dynasty", tradeReview: "none" };
/** Playoff odds of a partner with no season context, and of a contender (above config.acceptance.context.contenderAbove). */
const NEUTRAL_PLAYOFFS = 0.4;
const CONTENDER_PLAYOFFS = 0.7;

/** §11's anchors through acceptance() itself (a league without trade review, redraft unless the scenario says dynasty; a partner with no history and 40% playoff odds). */
export function anchorRows(): AnchorRow[] {
  return ANCHORS.map((s) => {
    const r = acceptance(s.dynasty ? DYNASTY_ANCHOR_LEAGUE : ANCHOR_LEAGUE, anchorProfile(s.a ?? 0, NEUTRAL_PLAYOFFS), { gPartner: s.g ?? 0, deltaLineup: (s.n ?? 0) * config.acceptance.nScale, h: s.h ?? 0, assets: (s.c ?? 0) + 2, partnerReceives: [] });
    const computed = 100 * r.pAccept;
    return { name: s.name, planner: s.percent, computed, diff: computed - s.percent, pass: Math.abs(computed - s.percent) <= ANCHOR_TOLERANCE };
  });
}

/** The star premium's anchors (PREMIUM_ANCHORS) through the real functions, as src/engine/acceptance.test.ts builds them. */
export function premiumAnchorRows(): AnchorRow[] {
  const W = PREMIUM_ANCHOR_W;
  const values: Record<string, number> = { star: 9000, you9000: 9000, p2: 5000, p3: 4000, p4: 3000, p5: 2500, p6: 2000, p7: 1000, best: 5000, b2: 3000, you2000: 2000, you5000: 5000, you6500: 6500, r4000: 4000, r3500a: 3500, r3500b: 3500 };
  for (let i = 1; i <= 10; i++) values[`x${String(i).padStart(2, "0")}`] = 9000 + 100 * i;
  const market: MarketInputs = { format: { isDynasty: false, numQbs: 1, numTeams: 10, ppr: 0.5, substitutions: [] }, fetchedAt: "2026-10-01T00:00:00.000Z", values, knownIds: Object.keys(values), topValue: Math.max(...Object.values(values)) };
  const elite = eliteIds(market);
  const rosters: Record<"A" | "B", string[]> = { A: ["star", "p2", "p3", "p4", "p5", "p6", "p7"], B: ["best", "b2"] };
  return PREMIUM_ANCHORS.map((s) => {
    const pPlayoffs = s.contender ? CONTENDER_PLAYOFFS : NEUTRAL_PLAYOFFS;
    const premiums = teamPremiums({ players: rosters[s.partner].map((id) => ({ id, value: values[id] ?? 0, ros: 0 })), elite, leagueType: "redraft", pPlayoffs });
    const gPartner = tradePackage({ players: s.recv }, { players: s.give }, values, W).g;
    const gPerceived = perceivedPackage({ players: s.recv }, { players: s.give }, values, W, (id) => premiums[id]?.e ?? 0).g;
    const input: TradeAcceptanceInput = { gPartner, gPerceived, deltaLineup: (s.n ?? 0) * config.acceptance.nScale, h: s.h ?? 0, assets: s.recv.length + s.give.length, partnerReceives: [] };
    const computed = 100 * acceptance(ANCHOR_LEAGUE, anchorProfile(0, pPlayoffs), input).pAccept;
    return { name: s.name, planner: s.percent, computed, diff: computed - s.percent, pass: Math.abs(computed - s.percent) <= ANCHOR_TOLERANCE };
  });
}

/**
 * A shown card with a neutral throw-in (market.neutralThrowIns: on the side moving more players, up to the difference in
 * player counts, its lowest-valued players worth at most W; then matched pairs of such players, one from each side).
 */
export interface NeutralCard {
  rank: number;
  trade: TradeEvaluation;
  /** The throw-ins left out of the trade-value sums, with their values. */
  removed: { id: string; value: number }[];
  /** The same trade without them (the Analyzer), or null when a side would be empty; or why it can't be made. */
  lean: TradeEvaluation | null;
  leanIllegal: string | null;
  /** Where the lean version stands in the search (its state): its card's place, a finalist, evaluated exactly. */
  leanStatus: { card: number | null; finalist: boolean; exact: boolean } | null;
  /**
   * The expected gain of the card and of the lean version (expectedGain: B × P_complete, what Overall scales; review of
   * track R, R-1: compared unrounded, since the cards' rounded numbers hid the lean version's edge).
   */
  eg: { card: number | null; lean: number | null };
}

/** §13's expected gain, EG = B × P_complete (Overall is round(100 × (1 − e^(−EG / B₃))) when B > 0); null when B is unknown. */
export function expectedGain(t: Pick<TradeEvaluation, "b" | "pComplete">): number | null {
  return finite(t.b) && finite(t.pComplete) ? t.b * t.pComplete : null;
}

/** Every shown card with a neutral throw-in (planner change 2), and its lean version's numbers and place in the search (section 8). */
export function neutralCards(ctx: TradeContext, result: TradeSearchResult, settings: TradeSettings): NeutralCard[] {
  const I = tradeInternals(ctx);
  const state = searchStateOf(result);
  return result.trades.flatMap((t, i): NeutralCard[] => {
    const give = playerIds(t.proposal.give);
    const get = playerIds(t.proposal.get);
    const removed = neutralThrowIns(get, give, I.values, I.credit).removed;
    if (!removed.length) return [];
    const leanGive = give.filter((id) => !removed.includes(id));
    const leanGet = get.filter((id) => !removed.includes(id));
    const proposal: TradeProposal = { partnerId: t.proposal.partnerId, give: asPlayers(leanGive), get: asPlayers(leanGet) };
    const a = leanGive.length && leanGet.length ? analyzeTrade(ctx, proposal, { settings }) : null;
    const key = proposalKey(proposal);
    const card = result.trades.findIndex((x) => x.key === key);
    const leanStatus = a && state ? { card: card >= 0 ? card + 1 : null, finalist: state.finals.some((f) => f.key === key), exact: state.exactByKey.has(key) } : null;
    const lean = a?.evaluation ?? null;
    return [{ rank: i + 1, trade: t, removed: removed.map((id) => ({ id, value: I.values[id] ?? 0 })), lean, leanIllegal: a?.illegal ?? null, leanStatus, eg: { card: expectedGain(t), lean: lean ? expectedGain(lean) : null } }];
  });
}

/** The headline odds 1 ms either side of the week's first kickoff (section 8): mine both ways, and the largest move over the teams. */
export interface KickoffJump {
  week: number;
  kickoff: string;
  mine: { before: TeamOdds | null; after: TeamOdds | null };
  /** The largest |Δ P(playoffs)| and |Δ P(title)| over the teams: the headline (with pickups), and as rosters stand. */
  headline: { teamId: string | null; dPO: number; dCH: number };
  stand: { dPO: number; dCH: number };
}

export function kickoffJump(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: { settings: TradeSettings; scenarios?: number }): KickoffJump | null {
  const week = snapshot.currentWeek;
  const k = firstKickoff(inputs.nfl, week);
  if (k === null) return null;
  const build = (t: number) => buildLeagueModel(snapshot, inputs, { now: new Date(t), settings: opts.settings, ...(opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {}) });
  const before = build(k - 1);
  const after = build(k + 1);
  const most = (a: SeasonOdds | null | undefined, b: SeasonOdds | null | undefined) => {
    let out = { teamId: null as string | null, dPO: 0, dCH: 0 };
    for (const t of a?.teams ?? []) {
      const u = oddsOf(b, t.teamId);
      if (!u) continue;
      const dPO = Math.abs(u.pPlayoffs - t.pPlayoffs);
      const dCH = t.pTitle !== null && u.pTitle !== null ? Math.abs(u.pTitle - t.pTitle) : 0;
      if (dPO > out.dPO + EPS) out = { teamId: t.teamId, dPO, dCH: Math.max(out.dCH, dCH) };
      else out = { ...out, dCH: Math.max(out.dCH, dCH) };
    }
    return out;
  };
  const stand = most(before.oddsAsRostersStand, after.oddsAsRostersStand);
  return { week, kickoff: new Date(k).toISOString(), mine: { before: oddsOf(before.odds, before.myTeamId), after: oddsOf(after.odds, after.myTeamId) }, headline: most(before.odds, after.odds), stand: { dPO: stand.dPO, dCH: stand.dCH } };
}

/** A week where every team's pickups move my win chance (section 8): both chances, both teams' projected points both ways, and the pickups. */
export interface PickupWeek {
  week: number;
  opponentId: string;
  withPickups: number;
  asStands: number;
  mine: { stand: number; pickups: number };
  theirs: { stand: number; pickups: number };
  myMoves: FaMove[];
  theirMoves: FaMove[];
}

/** The `n` weeks where my win chance with pickups differs most from as rosters stand (at least weeklyLineMin), in week order. */
export function pickupWeeks(model: LeagueModel, n = PICKUP_WEEKS_SHOWN): PickupWeek[] {
  const me = model.myTeamId;
  const team = (id: string | null) => model.teams.find((t) => t.id === id);
  const at = (id: string | null, wi: number, which: "score" | "scoreWithPickups") => {
    const t = team(id);
    const s = which === "score" ? t?.score : (t?.scoreWithPickups ?? t?.score);
    return s?.mean[wi] ?? Number.NaN;
  };
  const rows = (model.odds?.weekly ?? []).flatMap((w): PickupWeek[] => {
    const g = myGame(model.odds, w.week, me);
    const s = myGame(model.oddsAsRostersStand, w.week, me);
    const wi = model.weeks.indexOf(w.week);
    if (!g || !s || g.opponentId === null || !finite(g.pWin) || !finite(s.pWin) || wi < 0) return [];
    if (Math.abs(g.pWin - s.pWin) < config.explain.weeklyLineMin - EPS) return [];
    return [{ week: w.week, opponentId: g.opponentId, withPickups: g.pWin, asStands: s.pWin, mine: { stand: at(me, wi, "score"), pickups: at(me, wi, "scoreWithPickups") }, theirs: { stand: at(g.opponentId, wi, "score"), pickups: at(g.opponentId, wi, "scoreWithPickups") }, myMoves: [...(team(me)?.faMoves ?? [])], theirMoves: [...(team(g.opponentId)?.faMoves ?? [])] }];
  });
  return rows
    .sort((a, b) => Math.abs(b.withPickups - b.asStands) - Math.abs(a.withPickups - a.asStands) || a.week - b.week)
    .slice(0, Math.max(0, n))
    .sort((a, b) => a.week - b.week);
}

// ---------------------------------------------------------------------------------------------
// The report

export interface TradeReportOptions {
  now: Date;
  clock: () => number;
  /** "offline" (a dump) or "live" (through the app's caches); and a line saying where the data came from. */
  mode: "offline" | "live";
  dataNote: string;
  /** When the report is written (the header's date). Default: `now`. */
  generatedAt?: Date;
  /** Availability scenarios (default config.lineups.scenarios). */
  scenarios?: number;
  /** Timed runs and warm-ups (default SEARCH_RUNS, SEARCH_WARMUPS), for the League model, the search and the beams alone. */
  runs?: number;
  warmups?: number;
  /** The command line the header prints (runMode.reportCommandText; default: the script, with --live when live). */
  command?: string;
  /** Timings of the stages before the engine (live: the crosswalk, the import, the model inputs). */
  timing?: Record<string, number>;
}

export interface TradeReport {
  doc: string;
  /** The snapshot every section ran on: the one given, or a dump from before the 4c adapter put on the 4c rule (`pre4c`: league-report's asWeeklyResetData). */
  snapshot: LeagueSnapshot;
  pre4c: Pre4cOrder | null;
  settings: TradeSettings;
  ctx: TradeContext;
  result: TradeSearchResult;
  model: LeagueModel;
  league: { cold: number; warm: number };
  runtime: Runtime;
  beams: { result: TradeSearchResult; runtime: Runtime };
  goals: GoalCompare;
  scale: HelpsScaleSection;
  gap: SearchGap;
  filter: FilterRow[] | null;
  blend: BlendReport;
  odds: OddsReport;
  anchors: AnchorRow[];
  premiumAnchors: AnchorRow[];
  neutral: NeutralCard[];
  kickoff: KickoffJump | null;
  pickupWeeks: PickupWeek[];
  /** This report's own stages, ms ("total": everything buildTradeReport did). */
  timing: Record<string, number>;
}

/**
 * Everything after the network (the file header): the searches, the checks and the markdown, not yet scrubbed.
 * `input` must already carry placeholders (league-report's placeholders()); a dump from before the 4c adapter is put on
 * the 4c rule first (league-report's asWeeklyResetData), so every section runs on the order the app now uses.
 */
export function buildTradeReport(input: LeagueSnapshot, inputs: ModelInputs, opts: TradeReportOptions): TradeReport {
  const { snapshot, pre4c } = asWeeklyResetData(input);
  const settings = normalizeTradeSettings(defaultTradeSettings());
  const { now, clock } = opts;
  const sc = opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {};
  const runOpts: SearchRunOptions = { now, clock, settings, runs: opts.runs ?? SEARCH_RUNS, warmups: opts.warmups ?? SEARCH_WARMUPS, ...sc };
  const timing: Record<string, number> = {};
  const start = clock();
  let last = start;
  const lap = (stage: string) => {
    const t = clock();
    timing[stage] = t - last;
    last = t;
  };
  const league = leagueBuilds(snapshot, inputs, runOpts);
  lap("league");
  const { ctx, result, runtime } = timedSearches(snapshot, inputs, runOpts);
  lap("searches");
  const beams = timedSearches(snapshot, inputs, { ...runOpts, warmups: 0, exhaustive: false });
  lap("beams");
  const goals = goalCompare(ctx, result, settings);
  lap("goals");
  const scale = helpsScaleSection(snapshot, league.model, ctx, settings);
  lap("scale");
  const gap = searchGap(ctx, result, settings);
  lap("gap");
  const filter = filterRows(ctx, result, clock);
  lap("filter");
  const blend = blendReport(tradeInternals(ctx));
  const odds = oddsByOrder(snapshot, inputs, league.model, ctx, { now, settings, ...sc, pre4c });
  lap("odds");
  const anchors = anchorRows();
  const premiumAnchors = premiumAnchorRows();
  const neutral = neutralCards(ctx, result, settings);
  const kickoff = kickoffJump(snapshot, inputs, { settings, ...sc });
  const weeks = pickupWeeks(league.model);
  lap("other");
  timing.total = clock() - start;
  const report: Omit<TradeReport, "doc"> = { snapshot, pre4c, settings, ctx, result, model: league.model, league: { cold: league.cold, warm: league.warm }, runtime, beams: { result: beams.result, runtime: beams.runtime }, goals, scale, gap, filter, blend, odds, anchors, premiumAnchors, neutral, kickoff, pickupWeeks: weeks, timing };
  return { ...report, doc: render(snapshot, inputs, opts, report) };
}

// ---------------------------------------------------------------------------------------------
// Rendering

type Report = Omit<TradeReport, "doc">;

const teamNameOf =
  (me: string | null) =>
  (id: string): string =>
    `Team ${id}${id === me ? " (you)" : ""}`;

function render(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: TradeReportOptions, r: Report): string {
  const L: string[] = [];
  const teamName = teamNameOf(r.result.myTeamId);
  renderHeader(L, snapshot, inputs, opts, r);
  renderTop(L, snapshot, inputs, r, teamName);
  renderGoals(L, snapshot, r, teamName);
  renderScale(L, r);
  renderGap(L, snapshot, r, teamName);
  renderFilter(L, r);
  renderBlend(L, snapshot, r);
  renderOdds(L, snapshot, r, teamName);
  renderOther(L, snapshot, r, teamName);
  return L.join("\n");
}

const LEVEL_WORDS: Readonly<Record<TradeSettings["protectValue"], string>> = { low: "Low", medium: "Medium", high: "High" };
const goalWeightsText = (g: Goal): string => `ΔPO ${goalWeights(g).playoffs} / ΔCH ${goalWeights(g).title}`;
const minChanceText = (x: number): string => (x > 0 ? `at least ${pctPlain(x, 0)}` : "Any");

function renderHeader(L: string[], snapshot: LeagueSnapshot, inputs: ModelInputs, opts: TradeReportOptions, r: Report): void {
  const I = tradeInternals(r.ctx);
  const s = r.settings;
  const model = r.model;
  const me = r.result.myTeamId;
  L.push("# Trade search: Parker's ESPN league (Checkpoint 7a)", "");
  L.push(
    `Generated by \`${opts.command ?? commandText("trade:report", [opts.mode === "live" ? "--live" : null])}\` on ${(opts.generatedAt ?? opts.now).toISOString().slice(0, 10)} through the real engine, as the app's Web Workers run it. Team, owner and league names are placeholders (you are Team ${me ?? "–"}); NFL player names are public.`,
    "",
  );
  L.push(`**League 1** · ESPN · ${snapshot.season} · week ${snapshot.currentWeek}${model.inProgressWeek !== null ? " (under way)" : ""} · ${snapshot.teams.length} teams · ${snapshot.settings.leagueType} · remaining weeks ${model.weeks[0] ?? "–"}–${model.weeks.at(-1) ?? "–"} · ${I.S} availability scenarios · trade review: ${snapshot.settings.tradeReview} · numbers as of ${opts.now.toISOString()}`, "");
  L.push("**Data**", "", `- ${opts.dataNote}`);
  for (const x of inputs.sources) L.push(`- ${x.source}: ${x.fetchedAt}${x.stale ? " (saved copy; the live fetch failed)" : ""}`);
  L.push(`- League snapshot fetched: ${snapshot.fetchedAt}`);
  L.push(`- Waiver order used: ${waiverOrderText(snapshot)}.${r.pre4c ? ` ${pre4cText(r.pre4c, me, teamNameOf(me))} Section 7 compares the two orders.` : ""}`);
  L.push("");
  L.push(
    `**Settings** (the app's defaults): What matters most: ${GOAL_WORDS[s.goal]} (${goalWeightsText(s.goal)}); Chance they accept: ${minChanceText(s.minChance)}; Protect my trade value: ${LEVEL_WORDS[s.protectValue]} (κ ${protectValueWeight(s.protectValue)}); max ${s.maxPerSide} players a side; streamed ${s.streamPositions.join(", ") || "none"}; P/K/D/ST/IDP ${s.includeKDefIdp ? "included" : "left out"}; β_need ${betaNeed(snapshot.settings.leagueType)}; W (the best free agent's trade value) ${thousands(Math.round(I.credit))}.`,
    "",
  );
  const b = r.result.baseline;
  const stand = r.odds.stand;
  L.push(`**Your baseline** (the trade search's: every team after its free-agent pickups in the waiver order above, seasons 1–${thousands(config.simulation.finalSims)}; it ${r.odds.baselineEqual === false ? "does NOT equal ❌" : "equals"} the League page's headline, section 7): playoffs ${pctPlain(b.pPlayoffs)}, title ${pctPlain(b.pTitle)}, expected wins ${fmt(b.expWins, 2)}. As rosters stand: playoffs ${pctPlain(stand?.pPlayoffs)}, title ${pctPlain(stand?.pTitle)}.`, "");
  const notes = [...new Set([...inputs.notes, ...r.ctx.notes, ...r.result.notes])];
  const warnings = [...new Set([...inputs.warnings.map((w) => `\`${w.code}\` ${w.message}`), ...r.ctx.warnings, ...r.result.warnings, ...model.warnings])];
  if (notes.length || warnings.length) {
    L.push("**Notes and warnings** (the inputs', the League model's, the context's and the search's):", "");
    for (const n of notes) L.push(`- Note: ${n}`);
    for (const w of warnings) L.push(`- Warning: ${w}`);
    L.push("");
  }
}

/** Players with their injury tags in the card's words (tradeView.injuryTagText): "Zay Flowers [Questionable]" ("nobody" for none). */
function taggedNames(snapshot: LeagueSnapshot, inputs: ModelInputs, ids: readonly string[], tags: readonly InjuryTag[], side: InjuryTag["side"]): string {
  const by = new Map(tags.filter((g) => g.side === side).map((g) => [g.playerId, g]));
  const end = seasonEndOf(snapshot.settings, inputs.nfl.lastWeek);
  const source = snapshot.platform === "espn" ? "ESPN" : undefined;
  return ids.length ? ids.map((id) => `${nameOf(snapshot, id)}${by.has(id) ? ` [${injuryTagText(by.get(id) as InjuryTag, end, source)}]` : ""}`).join(" + ") : "nobody";
}

/** A card's side with its own tags (TradeEvaluation.flags.tagged). */
function sideText(snapshot: LeagueSnapshot, inputs: ModelInputs, t: TradeEvaluation, side: "give" | "get"): string {
  return taggedNames(snapshot, inputs, playerIds(side === "give" ? t.proposal.give : t.proposal.get), t.flags.tagged ?? [], side);
}

/**
 * A trade's injury tags by the search's own rule (explain.injuryTags with explain.tagContextOf: what evaluate.ts puts in a
 * card's flags.tagged, so a step's or a Plan B's players read as they would on a card): every player whose status isn't
 * ACTIVE, with the return week his projection counts on.
 */
export type Tagger = (p: Pick<TradeProposal, "give" | "get">) => InjuryTag[];

export function taggerOf(I: Pick<TradeInternals, "snapshot" | "model">): Tagger {
  const tc = tagContextOf(I);
  return (p) => injuryTags(p, I.snapshot.players, tc);
}

/**
 * What the next-step lines read besides the card: the tagger, the search's tags for its other ideas, and my odds before
 * any trade (the search's baseline: a Plan B box's odds start from it, as the card's do).
 */
interface StepContext {
  tagsOf: Tagger;
  knownTags: ReadonlyMap<string, InjuryTag>;
  baseline: TradeSearchResult["baseline"];
}

/** A Plan B box's odds lines in the report's words ("; Title odds 10.5% → 11.2% · Playoff odds 60% → 62%; Win chance by week: …"), "" without odds. */
export function planBOddsText(box: Pick<PlanBView, "odds" | "weekly">): string {
  const odds = box.odds.map((o) => `${o.label} ${o.value}`).join(" · ");
  return `${odds ? `; ${odds}` : ""}${box.weekly ? `; ${box.weekly.text}` : ""}`;
}

/**
 * The card's next step in words (the file header, section 1): the offer-first steps with their players' tags (tagsOf), or
 * Plan B in its box's own words (tradeView.planBView, as the card shows it: each tagged player's tag in parentheses; review
 * of track R, R-2: an untagged Plan B read as healthy), each with its numbers, and a Plan B with its box's odds lines
 * (Phase 4c, change 9: its title and playoff odds before → after and its weekly line, from its own final-block
 * simulation); or none.
 */
function nextStep(snapshot: LeagueSnapshot, inputs: ModelInputs, t: TradeEvaluation, sc: StepContext): string | null {
  if (t.steps) {
    const o = t.steps.offerFirst;
    const full = t.steps.ifNo.full;
    const oTags = sc.tagsOf(o.proposal);
    return `offer first ${taggedNames(snapshot, inputs, playerIds(o.proposal.give), oTags, "give")} → ${taggedNames(snapshot, inputs, playerIds(o.proposal.get), oTags, "get")} (${boxNumbers(o)}); if they say no, add ${taggedNames(snapshot, inputs, [t.steps.ifNo.add], sc.tagsOf(full.proposal), "give")} (${boxNumbers(full)})`;
  }
  if (t.planB) {
    const p = t.planB;
    const box = planBView(p, snapshot, { cardTags: t.flags.tagged, knownTags: sc.knownTags, seasonEnd: seasonEndOf(snapshot.settings, inputs.nfl.lastWeek), baseline: sc.baseline });
    const kind = p.kind === "samePlayers" ? "a different package for the same players of theirs" : "a different target";
    return box ? `Plan B (${kind}), in the box's words: ${box.give} → ${box.get}; ${boxNumbers(p)}${planBOddsText(box)}` : null;
  }
  return null;
}

function renderTop(L: string[], snapshot: LeagueSnapshot, inputs: ModelInputs, r: Report, teamName: (id: string) => string): void {
  const trades = r.result.trades;
  const top = trades.slice(0, TOP_DETAIL);
  const b = r.result.baseline;
  L.push(`## 1. Your top ${TOP_DETAIL} under "${GOAL_WORDS[r.settings.goal]}"`, "");
  if (!top.length) {
    L.push(`No trades: ${[...r.ctx.notes, ...r.result.notes].join(" ") || "nothing helps your team."}`, "");
    return;
  }
  const b3 = top[0]?.b3 ?? null;
  L.push(
    `The Trade Finder's first ${top.length} of ${trades.length} cards with the default settings, Overall order, Helps you and Overall on B₃ ${b3 === null ? "–" : fmt(b3, 2)} (section 3: ${HELPS_AT_GAIN} ≈ +${config.benefit.helpsGain} pts a week). The three numbers as the card prints them: Helps you / Chance they accept (with its label; "goes through" when the league vote's veto rule cuts it; under ${Math.round(100 * config.acceptance.displayStep)}% reads "<${Math.round(100 * config.acceptance.displayStep)}%") / Overall. Odds before → after: the search's baseline and the trade's change on the same ${thousands(config.simulation.finalSims)} seasons. Win chance by week: the weeks whose chance moves at least ${Math.round(100 * config.explain.weeklyLineMin)} points, at most ${config.explain.weeklyLineMax} (the largest), in week order. Injury tags in brackets are the card's words; the offer-first steps' players carry the same tags (the search's own rule), and a Plan B is quoted in its box's own words (tags in parentheses).`,
    "",
  );
  L.push("| # | Partner | You give → you get | Helps / Chance / Overall | Title odds | Playoff odds | Win chance by week |", "|---|---|---|---|---|---|---|");
  top.forEach((t, i) =>
    L.push(`| ${i + 1} | ${teamName(t.proposal.partnerId)} | ${sideText(snapshot, inputs, t, "give")} → ${sideText(snapshot, inputs, t, "get")} | ${threeNumbers(t)} | ${titleMove(b.pTitle, t.dCH)} | ${playoffMove(b.pPlayoffs, t.dPO)} | ${weeklyText(weeklyLines(t.detail.winChance))} |`),
  );
  L.push("");
  const sc: StepContext = { tagsOf: taggerOf(tradeInternals(r.ctx)), knownTags: knownTagsOf(trades), baseline: r.result.baseline };
  const steps = top.flatMap((t, i) => {
    const s = nextStep(snapshot, inputs, t, sc);
    return s ? [`- #${i + 1}: ${s}`] : [];
  });
  if (steps.length) L.push("Next steps on those cards:", "", ...steps, "");
  const c10 = cardCounts(top, sc.tagsOf);
  const all = cardCounts(trades, sc.tagsOf);
  L.push(
    `**Counts** (top ${c10.shown} / all ${all.shown} cards): with Plan B ${c10.planB} / ${all.planB}; with offer-first steps ${c10.steps} / ${all.steps}; receiving an injury-tagged player ${c10.injuredGet} / ${all.injuredGet}; Plan B boxes receiving one ${c10.planBInjuredGet} / ${all.planBInjuredGet}. Hidden: ${r.result.hidden.byBenefit} for B ≤ 0, ${r.result.hidden.byMarket} by the market guard, ${r.result.hidden.byChance ?? 0} under the minimum chance; dropped by the variety rules: ${r.result.dropped ? `${r.result.dropped.givenPlayer} by the given-player cap, ${r.result.dropped.partnerCap} by the partner cap, ${r.result.dropped.core} by the core rule, ${r.result.dropped.filler} as filler` : "–"}.`,
    "",
  );
  const p = r.result.pattern;
  L.push(p ? `**The pattern note** (${p.count} of the uncapped top ${p.of} give ${nameOf(snapshot, p.playerId)}; drivers: ${p.drivers.join(", ") || "none"}): "${p.text}"` : `**The pattern note** doesn't show: fewer than ${config.explain.patternMinCount} of the uncapped top ${config.explain.patternTop} give the same player of yours.`, "");
}

function renderGoals(L: string[], snapshot: LeagueSnapshot, r: Report, teamName: (id: string) => string): void {
  const g = r.goals;
  const main = GOAL_WORDS[r.settings.goal];
  const other = GOAL_WORDS[g.goal];
  L.push(`## 2. The goal setting: "${main}" against "${other}"`, "");
  L.push(
    `The same search on the same context with "What matters most" set to ${other} (${goalWeightsText(g.goal)}; ${main}: ${goalWeightsText(r.settings.goal)}). Each column: the card's place (– when that list doesn't show it; its numbers are then the Analyzer's under that goal), B, Helps you and Overall. The chance they accept doesn't depend on the goal. ${g.common} of the top ${TOP_DETAIL} are in both lists; "${other}" shows ${g.result.trades.length} cards.`,
    "",
  );
  L.push(`| Trade | Goes through | ${main}: # · B · Helps · Overall | ${other}: # · B · Helps · Overall |`, "|---|---|---|---|");
  const side = (x: GoalSide) => `${x.rank === null ? "–" : `#${x.rank}`} · ${fmt(x.b, 2)} · ${x.helps ?? "–"} · ${x.overall ?? "–"}`;
  for (const row of g.rows) L.push(`| ${teamName(row.partnerId)}: ${names(snapshot, row.give)} → ${names(snapshot, row.get)} | ${chancePrinted(row.pComplete)} | ${side(row.title)} | ${side(row.other)} |`);
  const both = g.rows.filter((x) => x.title.b !== null && x.other.b !== null);
  const ratio = median(both.map((x) => (x.title.b as number) / (x.other.b as number)).filter((x) => Number.isFinite(x)));
  L.push("", `Across these ${both.length} trades the median B under "${main}" is ${fmt(ratio, 2)}× its B under "${other}".`, "");
}

function renderScale(L: string[], r: Report): void {
  const s = r.scale;
  const gain = config.benefit.helpsGain;
  L.push("## 3. B₃ under each goal", "");
  const cal = s.calibration;
  if (!cal) {
    L.push("No odds or no team, so no calibration run: no card has a Helps you.", "");
    return;
  }
  const weeks = r.model.weeks.slice(cal.from);
  const matches = (m: boolean | null, what: string) => (m === null ? "" : ` ${what} ${m ? "is the same run, bit for bit." : "is NOT the same run."}`);
  L.push(
    `Planner reply to Checkpoint 4c, A2: Helps you = round(100 × (1 − e^(−B / B₃))) and Overall = round(100 × (1 − e^(−B × P_complete / B₃))), B₃ = the B of +${gain} projected points a week in every week a trade can change (weeks ${weeks[0] ?? "–"}–${weeks.at(-1) ?? "–"}${cal.from > 0 ? `; week ${r.model.inProgressWeek} is under way, held as rosters stand in every trade` : ""}), regular season and playoffs, from the one baseline (every team after its pickups: LeagueModel.odds), on its ${thousands(config.simulation.finalSims)} seasons (common random numbers), under the same goal (and λ, at most ${config.benefit.helpsLambdaMax}, in dynasty and keeper leagues), floored at ${config.benefit.helpsFloor}. The League model's run (LeagueModel.helpsCalibration): ΔPO₃ ${pts(cal.dPO, 2)}, ΔCH₃ ${cal.dCH === null ? "unknown" : pts(cal.dCH, 2)}.${matches(s.contextMatches, "The trade context's own run (its final block)")}`,
    "",
  );
  L.push("| Goal | Weights | B₃ | Floored | +1 / +3 / +6 pts a week read |", "|---|---|---|---|---|");
  for (const g of GOALS) {
    const b = s.b3[g];
    const reads = s.check?.rows ? s.check.rows.map((row) => `+${row.gain} → ${row.score[g] ?? "–"}`).join(", ") : "–";
    L.push(`| ${GOAL_WORDS[g]}${g === r.settings.goal ? " (the app's default)" : ""} | ${goalWeightsText(g)} | ${b ? fmt(b.b3, 2) : "–"} | ${b ? (b.floored ? `yes (raw ${fmt(b.raw, 2)})` : "no") : "–"} | ${reads} |`);
  }
  L.push("");
  // The note a search shows when its B₃ departs from "+3 a week reads 63" (benefit.helpsScaleNotes; review of track SC).
  const scaleNotes = GOALS.flatMap((g) => helpsScaleNotes(s.b3[g]).map((n) => `${GOAL_WORDS[g]}: “${n}”`));
  L.push(scaleNotes.length ? `The searches' notes on the scale: ${scaleNotes.join("; ")}` : `No goal's B₃ departs from "+${gain} a week reads ${HELPS_AT_GAIN}": no search shows a note on the scale.`, "");
  const c = s.check;
  if (!c || !c.rows) {
    L.push(c ? `The scale check: title odds are unknown${c.titleUnknown ? ` (${c.titleUnknown})` : ""}, so its B can't be computed.` : "No scale check (no odds or no team).", "");
    return;
  }
  L.push(
    `The scale check (league-report's scaleCheck): your weekly score + 1, 3 and 6 projected points in the same weeks, the same seasons (± one standard error by batch means). B = 100 × (w_PO ΔPO + w_CH ΔCH), no market term; Helps you on that goal's B₃ (its +${gain} row), so +${gain} reads 63 by construction. Baseline: playoffs ${pctPlain(c.base.pPlayoffs)}, title ${pctPlain(c.base.pTitle)}.${matches(s.checkMatches, `Its +${gain} row`)}`,
    "",
  );
  L.push(`| Gain | ΔPO | ΔCH | ${GOALS.map((g) => `${GOAL_WORDS[g]}: B / Helps`).join(" | ")} | Checkpoint 3's B (0.35 / 0.65) |`, `|---|---|---|${GOALS.map(() => "---|").join("")}---|`);
  for (const row of c.rows) L.push(`| +${row.gain} pt/wk | ${pts(row.dPO)} ± ${fmt(100 * row.se.dPO, 2)} | ${pts(row.dCH)} ± ${fmt(100 * row.se.dCH, 2)} | ${GOALS.map((g) => `${fmt(row.B[g], 2)} ± ${fmt(row.se.B[g], 2)} / ${row.score[g] ?? "–"}`).join(" | ")} | ${CHECKPOINT3_SCALE[row.gain] ?? "–"} |`);
  L.push("");
}

function stagesTable(L: string[], main: Runtime, beams: Runtime): void {
  const keys = ["setup", "screening", "exact", "simScreen", "simFinal", "rank", "steps", "total"];
  const fin = config.simulation.finalSims;
  const scr = config.simulation.screeningSims;
  const label: Record<string, string> = {
    setup: "setup (pools)",
    screening: "screening",
    exact: "exact evaluation",
    simScreen: `screening simulation (seasons ${thousands(fin + 1)}–${thousands(fin + scr)})`,
    simFinal: `final simulation (seasons 1–${thousands(fin)})`,
    rank: "ranking",
    steps: "steps, Plan B and words",
    total: "search, total",
  };
  L.push(`| Stage | Cold | Warm (median of ${main.runs.length}) | Beams alone (median of ${beams.runs.length}) |`, "|---|---|---|---|");
  L.push(`| context (League model and baseline) | ${ms(main.cold.context.total)} | ${ms(main.context.total)} | ${ms(beams.context.total)} |`);
  for (const k of keys) if (main.search[k] !== undefined) L.push(`| ${label[k] ?? k} | ${ms(main.cold.search[k])} | ${ms(main.search[k])} | ${ms(beams.search[k])} |`);
  L.push(`| **context + search** | **${ms(main.cold.total)}** | **${ms(main.total)}** | ${ms(beams.total)} |`, "");
}

function renderGap(L: string[], snapshot: LeagueSnapshot, r: Report, teamName: (id: string) => string): void {
  const g = r.gap;
  const c = r.result.counts;
  const bc = r.beams.result.counts;
  L.push("## 4. The search gap", "");
  L.push(
    `Planner change 1: every 1-for-2 and 2-for-1 from the give and get pools and every 2-for-2 from the first ${config.search.exhaustive.twoForTwoTop} of each, on top of the beams; ${config.search.finalists} finalists. **Screened**: ${thousands(c.screened)} (the beams alone: ${thousands(bc.screened)}); ${c.exact} exact, ${c.simFinal} finalists, ${r.result.trades.length} cards (the beams alone: ${bc.exact} exact, ${bc.simFinal} finalists, ${r.beams.result.trades.length} cards).`,
    "",
  );
  if (!g.trade) L.push(`**${GAP_TRADE.give.join(" + ")} → ${GAP_TRADE.get.join(" + ")}**: ${g.missing ?? "not available"}.`, "");
  else {
    const e = g.evaluation;
    const funnel = [
      g.screened ? `screened #${g.screened.rank} of ${thousands(g.screened.of)} ${teamName(g.trade.partnerId)} candidates by the objective (${fmt(g.screened.objective, 2)})` : "never screened",
      g.inWindow === null ? null : g.inWindow ? "inside the g window" : "outside the g window",
      g.kept ? `kept #${g.kept.rank} of ${g.kept.of} for that partner` : "not kept",
      g.exact ? "evaluated exactly" : g.shortlisted ? "shortlisted but illegal" : "not in the exact 200",
      g.finalist ? "a finalist" : "not a finalist",
      g.card ? `**card #${g.card}**` : "not a card",
    ].filter((x): x is string => x !== null);
    L.push(
      `**${names(snapshot, g.trade.give)} → ${names(snapshot, g.trade.get)}** (${teamName(g.trade.partnerId)}): ${funnel.join(" → ")}. ${e ? `Its numbers${g.card ? "" : " (the Analyzer)"}: ${threeNumbers(e)}, B ${fmt(e.b, 2)}; title ${titleMove(r.result.baseline.pTitle, e.dCH)}, playoffs ${playoffMove(r.result.baseline.pPlayoffs, e.dPO)}.` : ""} The beams alone ${g.beams ? "screen it too" : "never screen it"}.${g.bestSameFamily ? ` The best card with that partner giving ${GAP_TRADE.give[0]} otherwise: #${g.bestSameFamily.rank} ${names(snapshot, playerIds(g.bestSameFamily.trade.proposal.get))} (${threeNumbers(g.bestSameFamily.trade)}).` : ""}`,
      "",
    );
  }
  L.push(
    `Only the exhaustive candidates reach (the beams alone never screen them): ${g.onlyExhaustive.exact} of ${c.exact} exact trades, ${g.onlyExhaustive.finalists} of ${c.simFinal} finalists, ${g.onlyExhaustive.cards} of ${r.result.trades.length} cards.${g.reproduces ? ` The per-partner counts come from screening every partner again on the search's own context: they add up to the search's ${thousands(c.screened)} ${mark(g.reproduces.counts)}, and every trade it evaluated exactly is in the rebuilt shortlist or among its lean companions ${mark(g.reproduces.shortlist)}.` : ""}`,
    "",
  );
  if (g.perPartner.length) {
    L.push("| Partner | Screened | Beams alone | Exact | Finalists | Cards |", "|---|---|---|---|---|---|");
    for (const p of g.perPartner) L.push(`| ${teamName(p.partnerId)} | ${thousands(p.exhaustive)} | ${thousands(p.beams)} | ${p.exact} | ${p.finalists} | ${p.cards} |`);
    const sum = (f: (p: PartnerCounts) => number) => g.perPartner.reduce((s, p) => s + f(p), 0);
    L.push(`| **all** | **${thousands(sum((p) => p.exhaustive))}** | ${thousands(sum((p) => p.beams))} | ${sum((p) => p.exact)} | ${sum((p) => p.finalists)} | ${sum((p) => p.cards)} |`, "");
  }
  L.push(`**Runtime** (Node ${process.version}, each run with its own context; cold = the first search in the process, after the League model's own timed builds; the browser's worker is timed by \`npm run check:browser -- --live\`). ${r.runtime.sameEveryRun && r.beams.runtime.sameEveryRun ? "Every run returned the same trades with the same numbers ✅." : "❌ The runs did not all return the same trades."} The League model alone: ${ms(r.league.cold)} cold, ${ms(r.league.warm)} warm.`, "");
  stagesTable(L, r.runtime, r.beams.runtime);
}

function renderFilter(L: string[], r: Report): void {
  L.push("## 5. The minimum-chance filter", "");
  const rows = r.filter;
  if (!rows) {
    L.push("The search stopped before ranking, so there's nothing to filter.", "");
    return;
  }
  L.push(
    `Planner change 10: "Chance they accept: at least …" on the chance a trade goes through as the card prints it, before the variety caps; re-filtered from the one search's ${config.search.finalists} finalists (runRefilter), no new search. Qualifying = finalists that pass the guards and the minimum; "few" = fewer than ${config.ranking.minChanceFew} cards while a lower setting would show more (the page suggests one).`,
    "",
  );
  L.push("| Chance they accept | Cards | Qualifying | Under the minimum | Few | Re-filter time |", "|---|---|---|---|---|---|");
  for (const x of rows) L.push(`| ${minChanceText(x.minChance)}${x.same === null ? "" : ` (the search's own: ${x.same ? "the same list ✅" : "a different list ❌"})`} | ${x.cards} | ${x.qualifying} | ${x.byChance} | ${x.few ? "yes" : "no"} | ${ms(x.ms)} |`);
  L.push("");
}

function renderBlend(L: string[], snapshot: LeagueSnapshot, r: Report): void {
  const b = r.blend;
  L.push("## 6. The blend's most extreme factors", "");
  const fallback = b.rows.filter((x) => x.fallback).length;
  const injured = b.rows.filter((x) => x.injury !== null && x.injury !== "ACTIVE").length;
  const few = b.rows.filter((x) => x.games !== null && x.games <= FEW_GAMES).length;
  const clean = b.rows.filter((x) => x.reason.startsWith("No data flag")).length;
  L.push(
    `Planner change 4: f clamped to [${b.clamp[0]}, ${b.clamp[1]}]. ${b.count} players blended; f before the clamp ${b.range ? `from ${fmt(b.range.min, 3)} to ${fmt(b.range.max, 3)} (median ${fmt(b.range.median, 3)})` : "–"}; the clamp cut ${b.clamped.length}${b.clamped.length ? ` (${b.clamped.map((x) => `${nameOf(snapshot, x.id)}, ${x.clamped === "high" ? "upper" : "lower"} bound`).join("; ")})` : ""}. The ${b.rows.length} most extreme before the clamp (|ln f|), per game: our base rate (b) against the market's number for his value (the curve of our base rates over healthy players by value), and his points a game so far. The words come only from each player's record (blend.blendRecords) and those points: a data flag when the record shows one (a fallback base rate, an injury, at most ${FEW_GAMES} game played), else "No data flag" with the facts that rule them out; hype and role changes aren't facts the record holds, so they're never named. Of these ${b.rows.length}: ${fallback} with a fallback base rate, ${injured} injury-tagged, ${few} with at most ${FEW_GAMES} game played, ${clean} with no data flag.`,
    "",
  );
  L.push("| # | Player | f (→ after the clamp) | Ours / market, a game | So far, a game | What the record shows |", "|---|---|---|---|---|---|");
  b.rows.forEach((x, i) => {
    const p = snapshot.players[x.id];
    L.push(`| ${i + 1} | ${nameOf(snapshot, x.id)} (${x.pos ?? "–"}, ${p?.nflTeam ?? "FA"}) | ${fmt(x.fRaw, 3)}${x.clamped ? ` → ${fmt(x.f, 2)}` : ""} | ${fmt(x.ours, 2)} / ${fmt(x.market, 2)} | ${x.games ? `${fmt(x.actualPpg, 2)} (${x.games} game${x.games === 1 ? "" : "s"})` : "–"} | ${x.reason} |`);
  });
  L.push("");
}

function renderOdds(L: string[], snapshot: LeagueSnapshot, r: Report, teamName: (id: string) => string): void {
  const o = r.odds;
  L.push("## 7. Your odds on the one shared baseline", "");
  L.push(
    `Planner change 9 and answer 2: the League page's headline and every card's "before" are one baseline, every team after its free-agent pickups, in the weekly reset waiver order where the league resets weekly; "as rosters stand" is the second line. The trade search's baseline ${o.baselineEqual === null ? "– (no odds)" : o.baselineEqual ? "equals LeagueModel.odds exactly (every team, every week, the notes) ✅" : "does NOT equal LeagueModel.odds ❌"}.${o.resetMatchesStandings === null ? "" : ` The reset order ${r.pre4c ? "this report built (the 4c adapter's rule: win percentage, then points for)" : "the 4c adapter wrote"} ${o.resetMatchesStandings ? "is" : "is NOT"} today's standings by the league's rules reversed (the simulator's ranks) ${mark(o.resetMatchesStandings)}.`}`,
    "",
  );
  L.push("| Baseline | Waiver order (team numbers, first claim first) | Your place | Your pickups | Playoffs | Bye | Title | Expected wins |", "|---|---|---|---|---|---|---|---|");
  const pickupsText = (moves: readonly FaMove[]) => (moves.length ? moves.map((m) => `+${nameOf(snapshot, m.add)}${m.drop ? ` −${nameOf(snapshot, m.drop)}` : ""}`).join(", ") : "none");
  const row = (label: string, x: OrderOdds | null, missing: string | null) =>
    x ? `| ${label} | ${x.how}: ${x.order.join(" > ")} | ${x.place === null ? "–" : ordinal(x.place)} | ${pickupsText(x.pickups)} | ${pctPlain(x.mine?.pPlayoffs)} | ${pctPlain(x.mine?.pBye)} | ${pctPlain(x.mine?.pTitle)} | ${fmt(x.mine?.expWins, 2)} |` : `| ${label} | not available: ${missing ?? "–"} | – | – | – | – | – | – |`;
  L.push(row("**With pickups, weekly reset order (the headline)**", o.reset, o.resetMissing));
  L.push(`| As rosters stand (the second line) | – (no pickups) | – | – | ${pctPlain(o.stand?.pPlayoffs)} | ${pctPlain(o.stand?.pBye)} | ${pctPlain(o.stand?.pTitle)} | ${fmt(o.stand?.expWins, 2)} |`);
  L.push(row("With pickups, live order", o.live, o.liveMissing), "");
  if (o.weekly.length) {
    L.push("Your win chance by week:", "", "| Week | Opponent | With pickups (reset order) | As rosters stand | With pickups (live order) |", "|---|---|---|---|---|");
    for (const w of o.weekly) L.push(`| ${w.week}${w.week === r.model.inProgressWeek ? " (under way)" : ""} | ${w.opponentId ? teamName(w.opponentId) : "–"} | ${pctPlain(w.reset, 0)} | ${pctPlain(w.stand, 0)} | ${pctPlain(w.live, 0)} |`);
    L.push("");
  }
}

/** "43.1% → 47.2% (+4.1 pts)": a chance from the card to its lean version, unrounded to one decimal, and the change. */
function chanceMove(card: number, lean: number): string {
  return `${pctPlain(card)} → ${pctPlain(lean)} (${pts(lean - card)})`;
}

/**
 * The cards with a neutral throw-in against their lean versions (the file header, section 8; review of track R, R-1): the
 * chance they accept, B and the expected gain unrounded (the card's rounded numbers hid a lean version's 4-point edge),
 * the chance it goes through too when the veto rule cuts either, the card-style numbers second, and where the lean version
 * stands in the search. A summary line counts the lean versions that are likelier and those with the higher expected gain.
 */
function renderNeutral(L: string[], snapshot: LeagueSnapshot, cards: readonly NeutralCard[], rule: string, teamName: (id: string) => string): void {
  const withLean = cards.filter((n) => n.lean !== null);
  const likelier = withLean.filter((n) => (n.lean as TradeEvaluation).pAccept > n.trade.pAccept + EPS);
  const better = withLean.filter((n) => n.eg.lean !== null && n.eg.card !== null && n.eg.lean > n.eg.card + EPS);
  const unseen = withLean.filter((n) => n.leanStatus !== null && !n.leanStatus.exact);
  const list = (xs: readonly NeutralCard[]) => (xs.length ? ` (${xs.map((n) => `#${n.rank}`).join(", ")})` : "");
  const summary = withLean.length
    ? `the lean version is likelier to be accepted on ${likelier.length} of ${withLean.length}${list(likelier)} and has the higher expected gain (B × the chance it goes through, what Overall scales) on ${better.length}${list(better)}; the search never evaluated ${unseen.length} of these ${withLean.length} lean versions exactly.`
    : "none has a lean version (every player in it is left out, or a side would be empty).";
  L.push(`- **Neutral throw-ins** (${rule}): ${cards.length} card${cards.length === 1 ? "" : "s"}. Each card next to its lean version (the same trade without them, from the Analyzer on the cards' own seasons 1–${thousands(config.simulation.finalSims)}), unrounded: ${summary}`, "");
  L.push("| Card | Left out (value) | Chance they accept: card → lean | B: card → lean | Expected gain: card → lean | As printed: card · lean | The lean version in the search |", "|---|---|---|---|---|---|---|");
  const status = (s: NeutralCard["leanStatus"]) => (!s ? "–" : s.card ? `card #${s.card}` : s.finalist ? "a finalist the variety rules left out" : s.exact ? "evaluated exactly, not a finalist" : "never evaluated exactly");
  for (const n of cards) {
    const t = n.trade;
    const head = `#${n.rank} ${teamName(t.proposal.partnerId)}: ${names(snapshot, playerIds(t.proposal.give))} → ${names(snapshot, playerIds(t.proposal.get))}`;
    const removed = n.removed.map((x) => `${nameOf(snapshot, x.id)} (${thousands(Math.round(x.value))})`).join(", ");
    const lean = n.lean;
    if (!lean) {
      L.push(`| ${head} | ${removed} | ${n.leanIllegal ? `without them it can't be made: ${n.leanIllegal}` : "no lean version (a side would be empty)"} | – | – | ${threeNumbers(t)} | – |`);
      continue;
    }
    const vetoed = Math.abs(t.pComplete - t.pAccept) > EPS || Math.abs(lean.pComplete - lean.pAccept) > EPS;
    const chance = `${chanceMove(t.pAccept, lean.pAccept)}${vetoed ? `; goes through ${chanceMove(t.pComplete, lean.pComplete)}` : ""}`;
    const eg = n.eg.card !== null && n.eg.lean !== null ? `${fmt(n.eg.card, 3)} → ${fmt(n.eg.lean, 3)} (${signed(n.eg.lean - n.eg.card, 3)})` : "–";
    L.push(`| ${head} | ${removed} | ${chance} | ${fmt(t.b, 2)} → ${fmt(lean.b, 2)} | ${eg} | ${threeNumbers(t)} · ${threeNumbers(lean)} | ${status(n.leanStatus)} |`);
  }
  L.push("");
}

function renderOther(L: string[], snapshot: LeagueSnapshot, r: Report, teamName: (id: string) => string): void {
  L.push("## 8. Anything else worth a look", "");
  const anchors = [...r.anchors, ...r.premiumAnchors];
  const failed = anchors.filter((a) => !a.pass);
  L.push(
    `- **The acceptance anchors** (the planner's two tables through acceptance(), premium.perceivedPackage and benefit.tradePackage): ${anchors.length - failed.length} of ${anchors.length} within ±${ANCHOR_TOLERANCE} point ${mark(!failed.length)}${failed.length ? ` (off: ${failed.map((a) => `${a.name}: ${fmt(a.computed, 1)}% against ${fmt(a.planner, 1)}%`).join("; ")})` : ""}; the largest difference ${fmt(Math.max(...anchors.map((a) => Math.abs(a.diff))), 2)} points.`,
  );
  // Planner change 2 as market.neutralThrowIns builds it (review of track R, R-5: not every player worth at most W on that
  // side), with Phase 4c's matched pairs; the search evaluates each shortlisted trade's lean version too (its lean companions).
  const rule = `planner change 2 as built, market.neutralThrowIns: on the side giving more players, up to the difference in player counts, its lowest-valued players worth at most W = ${thousands(Math.round(tradeInternals(r.ctx).credit))}, then matched pairs of such players, one from each side, cheapest first, count in neither side's value, only in c; the search evaluates the lean version of every shortlisted trade that has one (search.leanCompanions)`;
  if (!r.neutral.length) L.push(`- **Neutral throw-ins** (${rule}): no card carries one.`);
  else renderNeutral(L, snapshot, r.neutral, rule, teamName);
  const k = r.kickoff;
  if (k) {
    const m = k.mine;
    const size = (x: number) => `${fmt(100 * x)} points`;
    L.push(
      `- **The headline at the week's first kickoff** (week ${k.week}, ${k.kickoff}; League models 1 ms either side): your playoffs ${pctPlain(m.before?.pPlayoffs)} → ${pctPlain(m.after?.pPlayoffs)}, title ${pctPlain(m.before?.pTitle)} → ${pctPlain(m.after?.pTitle)}; the largest move of any team ${size(k.headline.dPO)} of playoff odds${k.headline.teamId ? ` (${teamName(k.headline.teamId)})` : ""} and ${size(k.headline.dCH)} of title odds. As rosters stand the largest moves are ${size(k.stand.dPO)} and ${size(k.stand.dCH)}${k.stand.dPO === 0 && k.stand.dCH === 0 ? " ✅" : ""}.`,
    );
  }
  for (const w of r.pickupWeeks) {
    const moves = (xs: readonly FaMove[]) => (xs.length ? xs.map((m) => `+${nameOf(snapshot, m.add)}`).join(", ") : "none");
    L.push(
      `- **Week ${w.week} against ${teamName(w.opponentId)}**: your win chance ${pctPlain(w.asStands, 0)} as rosters stand, ${pctPlain(w.withPickups, 0)} with every team's pickups. Projected that week, as rosters stand → with pickups: you ${fmt(w.mine.stand)} → ${fmt(w.mine.pickups)} (your pickups: ${moves(w.myMoves)}), ${teamName(w.opponentId)} ${fmt(w.theirs.stand)} → ${fmt(w.theirs.pickups)} (its pickups: ${moves(w.theirMoves)}).`,
    );
  }
  L.push("", `This report took ${ms(r.timing.total)} (the searches ${ms(r.timing.searches)}, the beams alone ${ms(r.timing.beams)}, the "${GOAL_WORDS[r.goals.goal]}" search ${ms(r.timing.goals)}, the search gap's re-screening ${ms(r.timing.gap)}).`, "");
}

// ---------------------------------------------------------------------------------------------
// Loading (live through the app's caches, or the offline dump)

/** Live (--live): Parker's league through the app's public-link import (or his cookies) and its caches. */
async function loadLive(cookies: ReportArgs["cookies"], teamArg: string | undefined): Promise<{ snapshot: LeagueSnapshot; inputs: ModelInputs; now: Date; timing: Record<string, number> }> {
  const useCookies = cookies !== "off" && (cookies === "on" || env("USE_ENV_COOKIES") === "1");
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
  if (!myTeamId) console.log("Parker's team isn't known: pass --team <id> or --cookies.");
  t0 = clock();
  const inputs = await buildModelInputs({ snapshot: result.snapshot, http, resolver, now, espn });
  timing["model inputs (server: Sleeper, FantasyCalc, NFL schedule, scoring)"] = clock() - t0;
  return { snapshot: placeholders({ ...result.snapshot, myTeamId }), inputs, now, timing };
}

/**
 * The command line (the file header; scripts/lib/runMode.ts reportArgs): the saved dump (default the newest; null with
 * --live), --team, --cookies / --no-cookies (with --live) and --out. `env` and `dumps` for tests (default process.env and
 * data-local/ under `root`).
 */
export type TradeReportArgs = ReportArgs;

export function parseArgs(argv: readonly string[], root: string, opts: { env?: Env; dumps?: () => readonly DumpInfo[] } = {}): TradeReportArgs | { error: string } {
  return reportArgs(argv, root, opts);
}

/** The command line the report ran with, for its header (the dump always named, relative to the project root), so it can be run again on the same data. */
export function reportCommand(args: TradeReportArgs, root: string): string {
  return reportCommandText("trade:report", args, root);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), ROOT);
  if ("error" in args) {
    console.error(args.error);
    process.exitCode = 1;
    return;
  }
  console.log(reportSourceLine(args, ROOT));
  registerScrubber(await redactorFromMap("espn"));
  const clock = () => performance.now();
  const generatedAt = new Date();
  let loaded: { snapshot: LeagueSnapshot; inputs: ModelInputs; now: Date; timing: Record<string, number>; note: string };
  if (args.dump) {
    const d = loadDump(args.dump, args.team);
    loaded = { ...d, timing: {}, note: dumpNote(ROOT, args.dump, d) };
  } else {
    const l = await loadLive(args.cookies, args.team);
    loaded = { ...l, note: "Live: Parker's league through the app's public-link import and its caches (league data 10 minutes, projections 6 hours, values 24 hours)." };
  }
  const { snapshot, inputs, now, timing, note } = loaded;
  const report = buildTradeReport(snapshot, inputs, { now, clock, mode: args.dump ? "offline" : "live", dataNote: note, generatedAt, timing, command: reportCommand(args, ROOT) });
  // Public NFL player names are kept whole: a leaguemate's first or last name can be a word of one (league-report, review PRIV-1).
  const doc = scrubEverythingExcept(report.doc, Object.values(snapshot.players).map((p) => p.name));
  writeFileSync(args.out ?? path.join(ROOT, "reports", "trade-report.md"), doc);
  const top = report.result.trades[0];
  const c = cardCounts(report.result.trades, taggerOf(tradeInternals(report.ctx)));
  const anchors = [...report.anchors, ...report.premiumAnchors];
  console.log(
    scrubEverything(
      `trade report written (${args.dump ? "offline" : "live"}) in ${ms(report.timing.total)}: ${c.shown} cards (Plan B ${c.planB}, steps ${c.steps}, injury-tagged received ${c.injuredGet}, Plan B boxes with one ${c.planBInjuredGet}); search ${ms(report.runtime.search.total)} warm, ${thousands(report.result.counts.screened)} screened; top card Helps you ${top?.tradeScore ?? "–"}, Overall ${top?.overall ?? "–"}; ${GAP_TRADE.get.join(" + ")} card ${report.gap.card ?? "–"}; anchors ${anchors.filter((a) => a.pass).length}/${anchors.length}; baseline = LeagueModel.odds ${report.odds.baselineEqual ? "yes" : "NO"}${report.pre4c ? "; a dump from before the 4c adapter, put on the weekly reset order" : ""}`,
    ),
  );
}

// Run only as a script (npm run trade:report), never when a test or another script imports the logic above (an exact
// path: scripts/lib/runMode.ts isMainModule; a scratch run-trade-report.ts doesn't start it). The offline guard goes on
// first unless --live (A5).
if (isMainModule(import.meta.url)) {
  setNetworkMode(wantsLive(process.argv.slice(2)));
  loadEnv();
  installConsoleScrubber();
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    process.exit(1);
  });
}
