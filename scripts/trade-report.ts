/**
 * Checkpoint 4b numbers for Parker's league (planner reply to Checkpoint 4, reports/planner-reply-4.md, "Checkpoint 4b must
 * include"; the lead's Phase 4b design, track R), computed through the real trade engine exactly as the Trade Finder's and
 * the Trade Analyzer's Web Worker runs it: buildTradeContext, runTradeSearch and analyzeTrade (src/engine/evaluate.ts,
 * search.ts), explainTrade (explain.ts), acceptance (acceptance.ts), the star premium (premium.ts) and buildLeagueModel
 * (league.ts).
 *
 *   npm run trade:report                           Parker's ESPN league through the public-link path and the app's caches
 *   npm run trade:report -- --team <id>            his team, when the import can't find it (no cookies)
 *   npm run trade:report -- --cookies              use the .env.local ESPN cookies (also with USE_ENV_COOKIES=1)
 *   npm run trade:report -- --offline [dir]        no network: a git-ignored placeholder dump (snapshot.json, inputs.json,
 *                                                  meta.json; default data-local/parker-league; league-report's loadDump),
 *                                                  the engine's `now` from meta.json
 *   ... --compare <file>                           the Checkpoint 4 model's results on the same dump (the lead's worktree
 *                                                  driver; CompareRun), for sections 2, 4 and 5
 *   ... --compare3 <file>                          the Checkpoint 3 model's odds on the same dump, for section 4
 *
 * The report (reports/trade-report.md), each section explaining its table in words:
 * 0. Header: the command line it ran with (reportCommand: the dump folder, --team and the compare files, so it can be run
 *    again), the data's timestamps (and the compare files'), the settings used (defaultTradeSettings: the app's
 *    defaults), the baseline odds, and every note and warning of the inputs, the evaluation context and the search.
 * 1. Your top 10 trades now: a summary table, then each card in full: give and get with injury tags (flags.tagged in the
 *    card's words, tradeView.injuryTagText) and "Harder to get", the three numbers, B and its parts, ΔPPW, ΔPO, ΔCH, ΔEW,
 *    ROS in and out, g_mkt both sides (and the pitch's own trade-value figure when it quotes one: FantasyCalc's raw values,
 *    pitchValueGain), the star premium, the partner's n and h, the forced moves (RosterChange: drops, adds, IR slots and the
 *    displacements an IR return brings), the app's card's own flags and injury note (tradeView.buildTradeCard), the steps
 *    or the Plan B with its three numbers, the card's reasons and the pitch (explainTrade with placeholder team names).
 *    "Among them" says when Garrett Wilson's count is the given-player cap's most, and the count without the cap.
 * 2. Before and after: (a) Checkpoint 4 as reported (CHECKPOINT4_REPORTED: the 10 rows of reports/trade-report.md §1 at
 *    commit b27e90f with the received players' statuses from that commit's league report, read back to check them:
 *    reportedTagsCheck), (b) the Checkpoint 4 model on this same dump (--compare), each of its top 10 with where it is now
 *    (shown, or the Trade Analyzer's numbers today), (c) now; for (b) and (c) the top 10 with the three numbers and injury
 *    tags, how many of the top 10 receive an injury-tagged player (status not ACTIVE), how many give Garrett Wilson (top
 *    10 and all shown, and in the cards' Plan B boxes), the median g_mkt(you) of the top 10 and of all shown, cards shown
 *    and hidden counts (listFacts); and (c) again without the given-player cap (§13: at most 3 of the top 20 give one player
 *    of mine, so with it Wilson's count can't pass 3: uncappedSearch, the same context searched with the cap patched off),
 *    with why the uncapped list still sells him (wilsonWhy: the cards' "Covers your risky week" reasons, his 2-for-1s).
 * 3. Blend sensitivity: the search at config.marketBlend.weight 0, 0.25 and 0.5 (BLEND_WEIGHTS; the weight set on the
 *    config object while that context is built and searched, then restored: withSwitches), each with the median g_mkt(you)
 *    of the top 10 and the top 25, Wilson given (cards and boxes), injury-tagged players received and cards shown, each
 *    also without the given-player cap. Then the blend at the default weight (blendFacts, LeaguePlayers.blend): players
 *    blended per position, the distribution of the factor f, injured against healthy players' f (the double-counted
 *    discount, a planner question), the 10 largest and smallest f with their numbers per game and in ROS points, Garrett
 *    Wilson's and Zay Flowers'.
 * 4. Your odds over time: Checkpoint 3 and Checkpoint 4 as reported, the Checkpoint 3 and 4 models on this dump (the
 *    compare files), and now, as rosters stand (the League model) and with pickups (the trade baseline, every team at
 *    V*), now's pickup effect on the same seasons (standOnSearchSeasons). Reading down the table, data against model, with
 *    Phase 4's change split into streaming and the rest; what changed in the data (dataChanges: Checkpoint 3's and 4's
 *    committed league reports read back with git show: records, roster moves and injury news per team, and points per week
 *    and my players' ROS under Checkpoint 4's rules on both data). Then the model decomposition (SETTINGS, settingRun):
 *    from Checkpoint 4's rules (no blend, each team's pickups on its own, no IR returners) each change alone, in sequence,
 *    and removed alone from now; and streaming's share (no team streams: settings.streamPositions [] and
 *    config.streaming.detectAdds Infinity); and the check that Checkpoint 4's rules reproduce its model (cp4Reproduction).
 * 5. Free-agent allocation (allocationReport): the basis and order, with CLAUDE.md §2.2's ⚠️ on ESPN's live order and the
 *    same search on the weekly reset order (resetOrderRun), each team's pickups one team each and each on its own, the free
 *    agents two or more teams pick up and how many went away, where Mark Andrews, Malik Washington and Jordan Love land,
 *    and for each of the top 10 trades whether my V* after the trade adds a free agent the partner claimed in the baseline
 *    (allowed when I'm ahead in the order, or right behind it and it lets him go: pickupReach) or a third team's (never),
 *    and whether the partner's takes one of mine.
 * 6. Cards (cardsReport): how many shown cards carry a Plan B (by kind) or offer-first steps, how many carry injury tags,
 *    the ranking's variety drops (the given-player cap's among them), the most-given players of mine in the top 20 (ties
 *    at the cut included) and my players in the Plan B boxes (the cap counts a box only when it adds a player); and the
 *    Plan B boxes the planner's literal rules would give (the search again with TradeSearchOptions.planB
 *    { minAcceptGain: null, givenPlayerCap: null }: the "likelier" rule and the cap off).
 * 7. IR players (irReport): every IR player (team, status, ESPN's return week, R, the displacement at R as the team
 *    stands and at V*(T)), the returners' effect on each team's PPW and on my odds, the shown trades with an IR player (in
 *    an IR slot, or on an active roster with a status the league's IR slot takes: irSlots.irEligibleStatuses), and the IR
 *    moves on the cards (RosterChange.toIR and .displaced).
 * 8. Consistency: no B from free-agent pickups (by construction, the tests, the measured bound: giveAwayCheck), every
 *    shown trade and every Plan B re-evaluated by analyzeTrade in a fresh context (bit for bit), and a no-op check
 *    through simulateTrade (both sides at their baselines: ΔPO = ΔCH = ΔEW = 0 exactly at both blocks of seasons).
 * 9. The acceptance anchors: the planner's two tables through the real functions (anchorRows, premiumAnchorRows), each row
 *    ✅ within ±0.5 points or ❌.
 * 10. Runtime: the League model and the search per stage (median of SEARCH_RUNS after SEARCH_WARMUPS warm-up, Node), cold
 *    (the first run in the process) and warm, the search again on the same context, with the counts; the longest stretch
 *    between progress yields with the stage it fell in (gapTracker), against CLAUDE.md §12's documented bound.
 *
 * Everything after the network is buildTradeReport (pure but for the clock it is given and the config patches it undoes),
 * which scripts/trade-report.test.ts runs on a synthetic league.
 *
 * Privacy (CLAUDE.md §0.5, §0.6): team, owner and league names are placeholders (league-report's placeholders())
 * before the engine runs; teams read "Team N" and Parker "Team 3 (you)"; the output is scrubbed with the .env.local
 * secrets and the ESPN redaction map, public NFL player names kept whole. Output: reports/trade-report.md and a
 * short console summary.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { importEspnLeagueForModel } from "@/adapters/espn";
import type { ImportDeps } from "@/adapters/types";
import { loadPlayerIdResolver } from "@/data";
import { acceptance, betaNeed, displayAcceptance, type AcceptanceLeague, type PartnerProfile, type TradeAcceptanceInput } from "@/engine/acceptance";
import { farReturnWeek } from "@/engine/availability";
import { protectValueWeight, tradePackage } from "@/engine/benefit";
import type { BlendPosition } from "@/engine/blend";
import { config } from "@/engine/config";
import {
  analyzeTrade,
  buildTradeContext,
  evaluateExact,
  explainContextOf,
  proposalKey,
  simulateTrade,
  throwIns,
  tradeInternals,
  tradeSides,
  type ExactTrade,
  type TeamState,
  type TradeContext,
  type TradeInternals,
} from "@/engine/evaluate";
import { explainTrade, injuryTags } from "@/engine/explain";
import type { MarketInputs, ModelInputs } from "@/engine/inputs";
import { irEligibleStatuses } from "@/engine/irSlots";
import { buildLeagueModel, claimedBy, type FaAllocationMode } from "@/engine/league";
import type { FaAllocation, FaMove, LeagueModel, PlayerBlend } from "@/engine/leagueModel";
import type { InjuryStatus, LeagueSnapshot, Pos } from "@/engine/model";
import type { FaStep } from "@/engine/optimizer";
import { eliteIds, perceivedPackage, teamPremiums } from "@/engine/premium";
import { runTradeSearch, type TradeSearchOptions } from "@/engine/search";
import { seasonOdds } from "@/engine/season";
import { PROTECT_VALUE_LEVELS, defaultTradeSettings, normalizeTradeSettings, type ProtectValue, type TradeSettings } from "@/engine/settings";
import { rosValue } from "@/engine/teamValue";
import type { InjuryTag, RosterChange, TradeAsset, TradeEvaluation, TradeSearchProgress, TradeSearchResult } from "@/engine/tradeModel";
import { INJURED_REASON, buildTradeCard, injuryTagText, knownTagsOf, seasonEndOf } from "@/lib/tradeView";
import { FileCache } from "@/server/cache";
import { createHttpClient } from "@/server/http";
import { buildModelInputs } from "@/server/modelInputs";
import {
  allocationBasisText,
  commandText,
  displayPath,
  duplicatePickups,
  dumpNote,
  flagValue,
  irReturnerRows,
  loadDump,
  offlineDirOf,
  ordinal,
  parseLeagueReport,
  placeholders,
  relativePath,
  resetWaiverOrder,
  statusShort,
  waiverOrderCaveat,
  type IrReturnerRow,
  type LeagueReportTables,
} from "./league-report";
import { ROOT, env, loadEnv } from "./lib/env";
import { redactorFromMap } from "./lib/minimize";
import { installConsoleScrubber, registerScrubber, scrubEverything, scrubEverythingExcept } from "./lib/redact";

// ---------------------------------------------------------------------------------------------
// Report choices (not model tunables: nothing the engine computes depends on them)

/** Timed runs after SEARCH_WARMUPS untimed ones (the lead's brief: the median of 3 runs after 1 warm-up). */
export const SEARCH_RUNS = 3;
export const SEARCH_WARMUPS = 1;
/** Trades shown in full and counted as "the top 10" (planner reply to Checkpoint 4: "Parker's top 10"). */
export const TOP_DETAIL = 10;
/** The wider window of section 3 ("the top 25", or every shown trade when fewer). */
export const TOP_WIDE = 25;
/** Section 3's market-blend weights (planner reply to Checkpoint 4: "marketBlend 0, 0.25 and 0.5"). */
export const BLEND_WEIGHTS: readonly number[] = [0, 0.25, 0.5];
/** Section 3: how many of the largest and the smallest blend factors are listed. */
export const BLEND_EXTREMES = 10;
/** The player the planner's question follows by name (public NFL name), and section 3's named players. */
export const WILSON = "Garrett Wilson";
export const BLEND_NAMED: readonly string[] = ["Garrett Wilson", "Zay Flowers"];
/** Section 5's named free agents (planner reply to Checkpoint 4: "where Mark Andrews lands"; the lead added the other two). */
export const ALLOCATION_NAMED: readonly string[] = ["Mark Andrews", "Malik Washington", "Jordan Love"];
/** Section 6: the players of mine given most often in the top 20, listed (everyone tied with the last one listed is listed too). */
export const MOST_GIVEN_SHOWN = 5;
/**
 * Section 10: CLAUDE.md §12's documented bound on the work between two progress yields ("typically under 40 ms of work
 * between yields on Parker's league in Node"). A report reference value, not a tunable: the report flags a longer stretch.
 */
export const YIELD_GAP_DOCUMENTED_MS = 40;
/** Section 4: how many of my players' rest-of-season moves under Checkpoint 4's rules are listed (the largest first). */
export const DATA_ROS_SHOWN = 5;

/** Checkpoint 3's reported odds for Parker (reports/checkpoint-3.md: his standings row; live data of 2026-09-30), as rosters stood. */
export const CHECKPOINT3_REPORTED = { code: "6a83beb", data: "live data of 2026-09-30", asRostersStand: { pPlayoffs: 0.786, pTitle: 0.197 } } as const;

/** One row of Checkpoint 4's reported top 10 (public NFL names; the partner a placeholder; g_mkt as fractions, rounded as printed). */
export interface ReportedRow {
  partnerId: string;
  give: readonly string[];
  get: readonly string[];
  /**
   * The players received whose status wasn't active on Checkpoint 4's data, by name (the St column of Checkpoint 4's league
   * report, b27e90f:reports/league-report.md, the same live data): Q = QUESTIONABLE, O = OUT.
   */
  tagged: Readonly<Record<string, InjuryStatus>>;
  helps: number;
  /** "Chance they accept" as shown (whole percent) and its label. */
  chance: number;
  label: string;
  overall: number;
  b: number;
  gMine: number;
  gPartner: number;
}

/**
 * Checkpoint 4 as reported (reports/trade-report.md and reports/checkpoint-4.md at commit b27e90f; live data of 2026-10-03
 * 09:28Z): its top 10 (§1) with the received players' injury statuses from its league report (ReportedRow.tagged), the shown
 * and hidden counts and the median g_mkt(you) of all shown (§3), the odds, and the lead's counts on that data: Garrett
 * Wilson is given in 9 of the top 10 and in 15 of the 22 shown. Report reference values, not tunables.
 */
export const CHECKPOINT4_REPORTED = {
  code: "b27e90f",
  data: "live data of 2026-10-03 09:28Z",
  asRostersStand: { pPlayoffs: 0.678, pTitle: 0.133 },
  withPickups: { pPlayoffs: 0.629, pTitle: 0.116 },
  shown: 22,
  hidden: { byBenefit: 17, byMarket: 3 },
  wilsonTop: 9,
  wilsonAll: 15,
  medianAll: -0.201,
  top: [
    { partnerId: "9", give: ["Brock Bowers"], get: ["Zay Flowers"], tagged: { "Zay Flowers": "QUESTIONABLE" }, helps: 65, chance: 55, label: "Likely", overall: 42, b: 6.26, gMine: -0.232, gPartner: 0.303 },
    { partnerId: "9", give: ["Garrett Wilson", "David Montgomery"], get: ["Zay Flowers"], tagged: { "Zay Flowers": "QUESTIONABLE" }, helps: 57, chance: 60, label: "Likely", overall: 40, b: 5.12, gMine: -0.251, gPartner: 0.336 },
    { partnerId: "9", give: ["Garrett Wilson", "David Montgomery"], get: ["Zay Flowers", "Jacory Croskey-Merritt"], tagged: { "Zay Flowers": "QUESTIONABLE" }, helps: 66, chance: 45, label: "Decent", overall: 39, b: 6.55, gMine: -0.219, gPartner: 0.28 },
    { partnerId: "10", give: ["Garrett Wilson"], get: ["Jalen Coker", "Jaylen Warren"], tagged: { "Jalen Coker": "QUESTIONABLE" }, helps: 56, chance: 50, label: "Decent", overall: 34, b: 4.95, gMine: -0.197, gPartner: 0.246 },
    { partnerId: "1", give: ["Garrett Wilson", "Kyle Monangai"], get: ["Davante Adams", "Isaiah Likely"], tagged: {}, helps: 43, chance: 70, label: "Likely", overall: 32, b: 3.37, gMine: -0.269, gPartner: 0.368 },
    { partnerId: "1", give: ["Garrett Wilson"], get: ["Davante Adams", "Isaiah Likely"], tagged: {}, helps: 42, chance: 70, label: "Likely", overall: 31, b: 3.23, gMine: -0.255, gPartner: 0.342 },
    { partnerId: "8", give: ["Garrett Wilson", "Bo Nix"], get: ["Christian Watson", "Dallas Goedert"], tagged: { "Dallas Goedert": "OUT" }, helps: 39, chance: 75, label: "Likely", overall: 31, b: 2.97, gMine: -0.274, gPartner: 0.377 },
    { partnerId: "8", give: ["Garrett Wilson"], get: ["Christian Watson", "Dallas Goedert"], tagged: { "Dallas Goedert": "OUT" }, helps: 37, chance: 75, label: "Likely", overall: 29, b: 2.78, gMine: -0.252, gPartner: 0.337 },
    { partnerId: "4", give: ["Garrett Wilson"], get: ["Chuba Hubbard", "Mike Evans"], tagged: { "Mike Evans": "QUESTIONABLE" }, helps: 60, chance: 35, label: "Decent", overall: 28, b: 5.53, gMine: -0.064, gPartner: 0.069 },
    { partnerId: "10", give: ["Garrett Wilson", "Kyle Monangai"], get: ["Jalen Coker", "Ladd McConkey"], tagged: { "Jalen Coker": "QUESTIONABLE", "Ladd McConkey": "QUESTIONABLE" }, helps: 26, chance: 90, label: "Likely", overall: 23, b: 1.81, gMine: -0.336, gPartner: 0.506 },
  ] as readonly ReportedRow[],
} as const;

/** Checkpoint 4's reported top 10 that receive an injury-tagged player (ReportedRow.tagged; 8 of 10). */
export const reportedInjuredTop = (rows: readonly ReportedRow[] = CHECKPOINT4_REPORTED.top): number => rows.filter((r) => r.get.some((name) => r.tagged[name] !== undefined)).length;

/**
 * Checkpoint 4's reported statuses (ReportedRow.tagged, and every other received player active) checked against its league
 * report's roster tables when given (the St column, statusShort): the players whose status differs, or null when every
 * received player was found with the same status; undefined when the league report isn't available.
 */
export function reportedTagsCheck(cp4: LeagueReportTables | null, rows: readonly ReportedRow[] = CHECKPOINT4_REPORTED.top): string[] | null | undefined {
  if (!cp4) return undefined;
  const statusOf = (name: string): string | undefined => {
    for (const roster of cp4.rosters.values()) {
      const p = roster.get(name);
      if (p) return p.status;
    }
    return undefined;
  };
  const off = new Set<string>();
  for (const r of rows) for (const name of r.get) if (statusOf(name) !== statusShort(r.tagged[name] ?? "ACTIVE")) off.add(name);
  return off.size ? [...off] : null;
}

/**
 * §11's required anchor tests (the planner's reply to Checkpoint 4, change 2's table): the planner's scenarios and P_accept,
 * with Checkpoint 4's value as `old` (β_need 0.6 everywhere, the cap at 95%). Features not named are 0 (even value, a = 0,
 * no history, no hole, a 1-for-1, no season context, hot and urg 0); n enters as ΔLineup_P = n × nScale; a redraft league
 * unless `dynasty`.
 */
export const ANCHORS: readonly { name: string; dynasty?: true; g?: number; n?: number; h?: 0 | 1; a?: number; c?: number; percent: number; old: number }[] = [
  { name: "Even value; n = 0.5; fills a hole; active (a = +1)", n: 0.5, h: 1, a: 1, percent: 67.9, old: 61.1 },
  { name: "Even value; nothing else", percent: 35.4, old: 35.4 },
  { name: "g = −0.10; n = 0.5; fills a hole", g: -0.1, n: 0.5, h: 1, percent: 37.8, old: 31.0 },
  { name: "g = −0.20; nothing else", g: -0.2, percent: 8.3, old: 8.3 },
  { name: "g = +0.15; n = −0.3", g: 0.15, n: -0.3, percent: 48.5, old: 53.0 },
  { name: "Even value; inactive (a = −2)", a: -2, percent: 21.4, old: 21.4 },
  { name: "3-for-1 (c = 2); even value", c: 2, percent: 25.0, old: 25.0 },
  { name: "g = +0.30; n = 0.5 (the 85% cap)", g: 0.3, n: 0.5, percent: 85.0, old: 81.8 },
  { name: "Dynasty: even value; n = 0.5; fills a hole; active", dynasty: true, n: 0.5, h: 1, a: 1, percent: 61.1, old: 61.1 },
];
/** The planner's reply to Checkpoint 4 (change 2): both tables within ±0.5 percentage points. */
export const ANCHOR_TOLERANCE = 0.5;

/**
 * The star premium's anchor tests (the planner's reply to Checkpoint 4, change 2's table: default coefficients, W = 752,
 * within ±0.5 points), as src/engine/acceptance.test.ts builds them: ten players worth 9,100–10,000 plus partner A's #1
 * "star" (9,000) and one of mine (9,000) are FantasyCalc's top 12; partner A rosters star, p2 … p7 (5,000 … 1,000),
 * partner B "best" (5,000, not top-12) and b2. A contender has 70% playoff odds, the others 40% (no season context); a = 0,
 * no history. `old`: Checkpoint 4's value.
 */
export const PREMIUM_ANCHORS: readonly { name: string; partner: "A" | "B"; contender: boolean; recv: readonly string[]; give: readonly string[]; n?: number; h?: 0 | 1; percent: number; old: number }[] = [
  { name: "1-for-1, equal raw value; partner's #1; top-12; contender; no lineup change", partner: "A", contender: true, recv: ["you9000"], give: ["star"], percent: 10.9, old: 10.9 },
  { name: "1-for-1, equal raw value; partner's #6; not top-12", partner: "A", contender: false, recv: ["you2000"], give: ["p6"], percent: 35.4, old: 35.4 },
  { name: "Partner gets 4,000 + 3,500 + 3,500 for their #1 top-12 player (9,000); contender; n = 0.6; fills a hole", partner: "A", contender: true, recv: ["r4000", "r3500a", "r3500b"], give: ["star"], n: 0.6, h: 1, percent: 32.8, old: 23.4 },
  { name: "The same trade, where the RBs help them twice as much (n = 1.2)", partner: "A", contender: true, recv: ["r4000", "r3500a", "r3500b"], give: ["star"], n: 1.2, h: 1, percent: 55.4, old: 32.8 },
  { name: "1-for-1, equal raw value; partner's #2; not top-12", partner: "A", contender: false, recv: ["you5000"], give: ["p2"], percent: 26.3, old: 26.3 },
  { name: "1-for-1; partner's #1, not top-12; contender; partner gets 30% more raw value", partner: "B", contender: true, recv: ["you6500"], give: ["best"], percent: 62.0, old: 62.0 },
];
/** The star premium's anchors: within ±0.5 points, with this waiver credit. */
export const PREMIUM_ANCHOR_TOLERANCE = 0.5;
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
/** A fraction as a signed percent: +0.445 → "+44.5%". */
export const pctSigned = (x: number | null | undefined, d = 1): string => (finite(x) ? `${signed(100 * x, d)}%` : "–");
/** A fraction as a plain percent: 0.445 → "44.5%". */
export const pctPlain = (x: number | null | undefined, d = 1): string => (finite(x) ? `${fmt(100 * x, d)}%` : "–");
/** A change in a probability, in percentage points: +0.081 → "+8.1 pts". */
export const pts = (x: number | null | undefined, d = 1): string => (finite(x) ? `${signed(100 * x, d)} pts` : "–");
/** A stretch between yields, one decimal (so a 39.6 ms one isn't printed "40 ms" next to the 40 ms bound). */
const gapMs = (x: number | null | undefined): string => (finite(x) ? `${x.toFixed(1)} ms` : "–");
const ms = (x: number | null | undefined): string => (!finite(x) ? "–" : x >= 1000 ? `${(x / 1000).toFixed(2)} s` : x < 10 ? `${x.toFixed(1)} ms` : `${Math.round(x)} ms`);
const thousands = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
/** A trade value: "9,912". */
const valueText = (v: number | null | undefined): string => (finite(v) ? thousands(Math.round(v)) : "–");
/** "✅" when a check holds, "❌" when it doesn't (CLAUDE.md §0.12: ✅ only when the data verifies it). */
const mark = (ok: boolean): string => (ok ? "✅" : "❌");

/** The median of the finite numbers (NaN without any). */
export function median(xs: readonly number[]): number {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = s.length;
  if (!n) return Number.NaN;
  return n % 2 ? (s[(n - 1) / 2] as number) : ((s[n / 2 - 1] as number) + (s[n / 2] as number)) / 2;
}

/** The p-quantile of sorted numbers, linear between order statistics (p 0: the minimum, 1: the maximum); NaN without any. */
export function quantile(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (!n) return Number.NaN;
  const at = Math.min(n - 1, Math.max(0, p * (n - 1)));
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  const a = sorted[lo] as number;
  return a + ((sorted[hi] as number) - a) * (at - lo);
}

const playerIds = (xs: readonly TradeAsset[]): string[] => xs.flatMap((a) => (a.kind === "player" ? [a.id] : []));
const asPlayers = (ids: readonly string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));
const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** "Garrett Wilson (WR, NYJ)": a public NFL name with his position and NFL team (the id when he isn't in the data). */
function playerLabel(snapshot: LeagueSnapshot, id: string): string {
  const p = snapshot.players[id];
  return p ? `${p.name} (${p.pos}, ${p.nflTeam ?? "FA"})` : id;
}
/** "Garrett Wilson": the public name alone (compact tables). */
const nameOf = (snapshot: LeagueSnapshot, id: string): string => snapshot.players[id]?.name ?? id;
const names = (snapshot: LeagueSnapshot, ids: readonly string[]): string => (ids.length ? ids.map((id) => nameOf(snapshot, id)).join(" + ") : "nobody");

/** A player's id by his public name (the first one in the data with it), or null. */
export function idByName(snapshot: LeagueSnapshot, name: string): string | null {
  return Object.keys(snapshot.players).find((id) => snapshot.players[id]?.name === name) ?? null;
}

/**
 * Trade value in words from both sides' g_mkt (§9). The package values make both readings exact: my PV_give is the
 * partner's PV_recv, so "you give up X% more than you get" is X = g_mkt(partner), and "they give up X% more than
 * they get" is X = g_mkt(me).
 */
export function valueReading(gMine: number, gPartner: number): { you: string; them: string } {
  if (!finite(gMine) || !finite(gPartner)) return { you: "trade value unknown", them: "trade value unknown" };
  if (Math.abs(gMine) < 0.0005) return { you: "even trade value", them: "even trade value" };
  return gMine < 0
    ? { you: `you give up ${pctPlain(gPartner)} more trade value than you get`, them: `they get ${pctPlain(gPartner)} more than they give` }
    : { you: `you get ${pctPlain(gMine)} more trade value than you give`, them: `they give up ${pctPlain(gMine)} more than they get` };
}

/** The card's chance as shown: "70%" (P_accept rounded to config.acceptance.displayStep). */
export const shownChance = (p: number): string => `${Math.round(100 * displayAcceptance(p))}%`;

/** "Est. 80% (Likely)", and P_complete when the veto rule cuts it. */
function chanceText(t: Pick<TradeEvaluation, "pAccept" | "pComplete" | "acceptLabel"> & { detail: Pick<TradeEvaluation["detail"], "vetoRisk"> }): string {
  const shown = `Est. ${shownChance(t.pAccept)} (${t.acceptLabel})`;
  return t.detail.vetoRisk ? `${shown}; P_complete ${Math.round(100 * displayAcceptance(t.pComplete))}% (the league vote may veto: halved)` : shown;
}

/** The three numbers in one cell: "47 / 70% / 37" (Helps you / Chance they accept as shown / Overall). */
const threeNumbers = (helps: number | null, pAccept: number, overall: number | null): string => `${helps ?? "–"} / ${shownChance(pAccept)} / ${overall ?? "–"}`;

/** B's market term (redraft: B − B_win), or null. */
const marketTermOf = (t: TradeEvaluation | null): number | null => (t && t.lambda === null && finite(t.b) && finite(t.bWin) ? t.b - t.bWin : null);

/** The names explain.ts words reasons and pitches with: placeholders only ("Team 9"). */
function placeholderWords(I: TradeInternals, t: TradeEvaluation): { reasons: string[]; pitch: string } {
  const words = explainTrade(t, { ...explainContextOf(I), teamName: (id) => `Team ${id}` });
  return { reasons: words.reasons, pitch: words.pitch };
}

// ---------------------------------------------------------------------------------------------
// The compare files (--compare, --compare3)

const oddsSchema = z.object({ pPlayoffs: z.number(), pTitle: z.number().nullable() });
const tagSchema = z.object({ playerId: z.string(), side: z.enum(["give", "get"]), status: z.string(), returnWeek: z.number().optional() });
const compareTradeSchema = z.object({
  rank: z.number(),
  partnerId: z.string(),
  give: z.array(z.string()),
  get: z.array(z.string()),
  helps: z.number().nullable(),
  pAccept: z.number(),
  pComplete: z.number(),
  label: z.string(),
  overall: z.number().nullable(),
  b: z.number().nullable(),
  dPO: z.number().nullable().optional(),
  dCH: z.number().nullable().optional(),
  dPPW: z.number().nullable().optional(),
  gMine: z.number(),
  gPartner: z.number(),
  steps: z.string().nullable().optional(),
  tagged: z.array(tagSchema).optional(),
});
const compareSchema = z.object({
  label: z.string(),
  code: z.string(),
  dump: z.string(),
  now: z.string(),
  odds: z.object({ asRostersStand: oddsSchema, withPickups: oddsSchema.optional() }),
  pickups: z.array(z.object({ teamId: z.string(), moves: z.array(z.object({ add: z.string(), drop: z.string().nullable() })) })).optional(),
  duplicates: z.array(z.object({ playerId: z.string(), teamIds: z.array(z.string()) })).optional(),
  hidden: z.object({ byBenefit: z.number(), byMarket: z.number() }).optional(),
  counts: z.object({ screened: z.number(), exact: z.number(), simScreen: z.number(), simFinal: z.number() }).optional(),
  searchMs: z.number().optional(),
  timings: z.record(z.string(), z.number()).optional(),
  trades: z.array(compareTradeSchema).optional(),
});

/** Another model's results on the same dump (the lead's worktree driver, e.g. data-local/cp4-compare-dev.json): odds, pickups and its search. */
export type CompareRun = z.infer<typeof compareSchema>;
export type CompareTrade = z.infer<typeof compareTradeSchema>;

/** A compare file's contents, checked (`source` names it in the error, which lists every bad JSON path). */
export function parseCompare(json: unknown, source: string): CompareRun {
  const r = compareSchema.safeParse(json);
  if (!r.success) throw new Error(`${source} isn't a compare file: ${r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  return r.data;
}

/** A compare file from disk (parseCompare). */
export function readCompare(file: string): CompareRun {
  return parseCompare(JSON.parse(readFileSync(file, "utf8")) as unknown, path.basename(file));
}

// ---------------------------------------------------------------------------------------------
// A ranked list in common terms (section 2), whichever model made it

/** A trade of a ranked list (this run's TradeEvaluation, or a compare file's row). */
export interface ListedTrade {
  key: string;
  partnerId: string;
  give: string[];
  get: string[];
  helps: number | null;
  pAccept: number;
  pComplete: number;
  label: string;
  overall: number | null;
  b: number | null;
  gMine: number;
  gPartner: number;
  /** Every injury-tagged player on either side (TradeEvaluation.flags.tagged). */
  tagged: { playerId: string; side: "give" | "get"; status: string; returnWeek?: number }[];
  /** The players of mine its Plan B box gives (null: no box on this card); absent for a model without Plan B (a compare file's). */
  planBGive?: string[] | null;
}

/** This run's trade as a ListedTrade (its tags: flags.tagged, else from the snapshot as the cards read them). */
export function listedOf(t: TradeEvaluation, snapshot: LeagueSnapshot): ListedTrade {
  const tagged = t.flags.tagged ?? injuryTags(t.proposal, snapshot.players, { currentWeek: snapshot.currentWeek });
  return {
    key: t.key,
    partnerId: t.proposal.partnerId,
    give: playerIds(t.proposal.give),
    get: playerIds(t.proposal.get),
    helps: t.tradeScore,
    pAccept: t.pAccept,
    pComplete: t.pComplete,
    label: t.acceptLabel,
    overall: t.overall,
    b: t.b,
    gMine: t.gMine,
    gPartner: t.gPartner,
    tagged: tagged.map((g) => ({ ...g })),
    planBGive: t.planB ? playerIds(t.planB.proposal.give) : null,
  };
}

/** A compare file's row as a ListedTrade (its key as proposalKey makes it, so it matches this run's). */
export function listedOfCompare(c: CompareTrade): ListedTrade {
  return {
    key: proposalKey({ partnerId: c.partnerId, give: asPlayers(c.give), get: asPlayers(c.get) }),
    partnerId: c.partnerId,
    give: [...c.give],
    get: [...c.get],
    helps: c.helps,
    pAccept: c.pAccept,
    pComplete: c.pComplete,
    label: c.label,
    overall: c.overall,
    b: c.b,
    gMine: c.gMine,
    gPartner: c.gPartner,
    tagged: (c.tagged ?? []).map((g) => ({ ...g })),
  };
}

/** The planner's questions on a ranked list (section 2; section 3 per blend weight). */
export interface ListFacts {
  shown: number;
  /** The first `top` (TOP_DETAIL) trades: how many receive an injury-tagged player (status not ACTIVE: a tag on "get"), and how many give `wilsonId`. */
  topN: number;
  injuredTop: number;
  wilsonTop: number;
  /** The same over every shown trade. */
  injuredAll: number;
  wilsonAll: number;
  /**
   * The Plan B boxes on the shown cards that give `wilsonId` too (the page suggests selling him there as well), and of them
   * the ones on a card that doesn't give him (the box adds him); null for a list from a model without Plan B.
   */
  wilsonBoxes: { all: number; added: number } | null;
  /** Median g_mkt(you) of the top `top`, of the first `wide` (TOP_WIDE; every shown trade when fewer), and of all shown. */
  medianTop: number;
  medianWide: number;
  medianAll: number;
}

const receivesTagged = (t: ListedTrade): boolean => t.tagged.some((g) => g.side === "get");

export function listFacts(trades: readonly ListedTrade[], wilsonId: string | null, top = TOP_DETAIL, wide = TOP_WIDE): ListFacts {
  const head = trades.slice(0, top);
  const gives = (t: ListedTrade) => wilsonId !== null && t.give.includes(wilsonId);
  const boxGives = (t: ListedTrade) => wilsonId !== null && (t.planBGive ?? []).includes(wilsonId);
  const withPlanB = trades.some((t) => t.planBGive !== undefined);
  return {
    shown: trades.length,
    topN: head.length,
    injuredTop: head.filter(receivesTagged).length,
    wilsonTop: head.filter(gives).length,
    injuredAll: trades.filter(receivesTagged).length,
    wilsonAll: trades.filter(gives).length,
    wilsonBoxes: withPlanB ? { all: trades.filter(boxGives).length, added: trades.filter((t) => boxGives(t) && !gives(t)).length } : null,
    medianTop: median(head.map((t) => t.gMine)),
    medianWide: median(trades.slice(0, wide).map((t) => t.gMine)),
    medianAll: median(trades.map((t) => t.gMine)),
  };
}

/**
 * Why the model sells Garrett Wilson (section 2; review of track R): over the first `top` trades of a list (the uncapped
 * search's, where the given-player cap can't hide it), how many give him; how many carry the card's reason "Covers your
 * risky week N" (explain.ts, the cards' own words) and for which weeks; how many give him alone for two players, with the
 * ROS points they'd get and his own.
 */
export interface WilsonWhy {
  top: number;
  gives: number;
  /** Trades with a "Covers your risky week(s) …" reason, per week it names. */
  riskyCovered: { week: number; trades: number }[];
  /** Trades that give him alone for two players: how many, the ROS points received (min, max), and his ROS points. */
  aloneForTwo: { trades: number; rosIn: [number, number] | null; rosOut: number | null };
}

/** The weeks a card's "Covers your risky week 13: …" / "Covers your risky weeks 12 and 13: …" reason names (explain.ts riskyWeekLines). */
export function coveredRiskyWeeks(reasons: readonly string[]): number[] {
  for (const r of reasons) {
    const m = /^Covers your risky weeks? ([^:]+):/.exec(r);
    if (m) return [...(m[1] as string).matchAll(/\d+/g)].map((x) => Number(x[0]));
  }
  return [];
}

export function wilsonWhy(trades: readonly TradeEvaluation[], wilsonId: string | null, top = TOP_DETAIL): WilsonWhy {
  const head = trades.slice(0, top);
  const gives = head.filter((t) => wilsonId !== null && playerIds(t.proposal.give).includes(wilsonId));
  const weeks = new Map<number, number>();
  for (const t of gives) for (const w of coveredRiskyWeeks(t.reasons)) weeks.set(w, (weeks.get(w) ?? 0) + 1);
  const alone = gives.filter((t) => playerIds(t.proposal.give).length === 1 && playerIds(t.proposal.get).length === 2);
  const rosIn = alone.map((t) => t.ros.received).filter((x) => finite(x));
  return {
    top: head.length,
    gives: gives.length,
    riskyCovered: [...weeks].map(([week, n]) => ({ week, trades: n })).sort((a, b) => b.trades - a.trades || a.week - b.week),
    aloneForTwo: { trades: alone.length, rosIn: rosIn.length ? [Math.min(...rosIn), Math.max(...rosIn)] : null, rosOut: alone[0]?.ros.given ?? null },
  };
}

// ---------------------------------------------------------------------------------------------
// Settings switches (sections 3 and 4): the config patches and the engine options

/**
 * The four Phase 4b-era switches a run can turn off (section 4): the market blend (config.marketBlend.weight 0), one free
 * agent one team (faAllocation "independent": Checkpoint 4's rule), IR returners (irReturners false: Checkpoint 4's
 * rule) and streaming (no team streams: settings.streamPositions [] and config.streaming.detectAdds Infinity).
 */
export interface Switches {
  blend: boolean;
  oneTeam: boolean;
  irReturners: boolean;
  streaming: boolean;
}

export const NOW_SWITCHES: Switches = { blend: true, oneTeam: true, irReturners: true, streaming: true };
/** Checkpoint 4's rules: no blend, each team's pickups on its own, no IR returners (streaming was already in). */
export const CP4_SWITCHES: Switches = { blend: false, oneTeam: false, irReturners: false, streaming: true };

type MutableConfig = { marketBlend: { weight: number }; streaming: { detectAdds: number }; ranking: { perGivenPlayerInTop20: number } };

/**
 * Runs `fn` with config patched (the blend's weight, streaming's detection, the ranking's given-player cap) and restores
 * config afterwards, whatever happens: the trade context and the search read config, not a config argument, so this is
 * how a script searches another weight.
 */
export function withConfigPatch<T>(patch: { blendWeight?: number; detectAdds?: number; givenPlayerCap?: number }, fn: () => T): T {
  const c = config as unknown as MutableConfig;
  const saved = { weight: c.marketBlend.weight, detectAdds: c.streaming.detectAdds, cap: c.ranking.perGivenPlayerInTop20 };
  if (patch.blendWeight !== undefined) c.marketBlend.weight = patch.blendWeight;
  if (patch.detectAdds !== undefined) c.streaming.detectAdds = patch.detectAdds;
  if (patch.givenPlayerCap !== undefined) c.ranking.perGivenPlayerInTop20 = patch.givenPlayerCap;
  try {
    return fn();
  } finally {
    c.marketBlend.weight = saved.weight;
    c.streaming.detectAdds = saved.detectAdds;
    c.ranking.perGivenPlayerInTop20 = saved.cap;
  }
}

/** The engine options of a switch setting: the settings (no streamed positions without streaming), the allocation and IR returners. */
export function switchOptions(s: Switches, settings: TradeSettings): { settings: TradeSettings; faAllocation: FaAllocationMode; irReturners: boolean } {
  return { settings: s.streaming ? settings : { ...settings, streamPositions: [] }, faAllocation: s.oneTeam ? "oneTeam" : "independent", irReturners: s.irReturners };
}

/** Runs `fn` under a switch setting: the config patches (withConfigPatch) and the engine options (switchOptions). */
export function withSwitches<T>(s: Switches, settings: TradeSettings, fn: (opts: ReturnType<typeof switchOptions>) => T): T {
  return withConfigPatch({ ...(s.blend ? {} : { blendWeight: 0 }), ...(s.streaming ? {} : { detectAdds: Number.POSITIVE_INFINITY }) }, () => fn(switchOptions(s, settings)));
}

// ---------------------------------------------------------------------------------------------
// Runtime (section 10) and the search the report reads

export interface RuntimeRun {
  /** buildTradeContext's own stages (TradeContext.timings: league model, baseline lineups, simulation, profiles, total). */
  context: Record<string, number>;
  /** runTradeSearch's stages (TradeSearchResult.timings: setup … rank, steps, total). */
  search: Record<string, number>;
  /** Context build plus search, wall clock. */
  total: number;
  /** The longest stretch of work between two progress yields (from the search's start to its end). */
  maxGap: number;
  /** Where it ended: the progress the search yielded after it (gapStageText says it in words), or null when it ended with the search. */
  maxGapAt: GapAt | null;
  /** The trades' keys and numbers: the same in every run when the search is deterministic. */
  signature: string;
}

/**
 * Where a stretch of work between two progress yields ended: the yield after it (TradeSearchProgress). Search.ts yields
 * "rank" once before the ranking ({ done 0, total 1 }), then in each shown card's loop (inside its Plan B choice, with the
 * cards done so far, and after the card, with one more): `card` is the shown card the stretch worked on (the previous "rank"
 * yield's done + 1), null outside that loop.
 */
export interface GapAt {
  stage: TradeSearchProgress["stage"];
  done: number;
  total: number;
  card: number | null;
}

/** A stretch's stage in the words of section 10's table (the work before the yield that ended it). */
export function gapStageText(at: GapAt | null): string {
  if (!at) return "the search's last stretch, after its last progress report";
  if (at.stage === "rank") return at.card === null ? "the ranking" : `the shown trades' offer-first steps, Plan B and words (card ${at.card} of ${at.total})`;
  const label: Record<Exclude<TradeSearchProgress["stage"], "rank">, string> = { setup: "setup", screening: "screening", exact: "exact evaluation", simScreen: "the screening simulation", simFinal: "the final simulation" };
  return `${label[at.stage]} (${at.done} of ${at.total})`;
}

/** A progress callback that records the longest stretch between yields and where it ended (GapAt), for timedSearches. */
export function gapTracker(clock: () => number): { onProgress: (p: TradeSearchProgress) => void; finish: () => { maxGap: number; maxGapAt: GapAt | null } } {
  let mark = clock();
  let maxGap = 0;
  let maxGapAt: GapAt | null = null;
  let prevRankDone: number | null = null;
  return {
    onProgress: (p) => {
      const t = clock();
      const card = p.stage === "rank" && prevRankDone !== null ? prevRankDone + 1 : null;
      if (t - mark > maxGap) {
        maxGap = t - mark;
        maxGapAt = { stage: p.stage, done: p.done, total: p.total, card };
      }
      if (p.stage === "rank") prevRankDone = p.done;
      mark = t;
    },
    finish: () => {
      const t = clock();
      if (t - mark > maxGap) return { maxGap: t - mark, maxGapAt: null };
      return { maxGap, maxGapAt };
    },
  };
}

export interface Runtime {
  /** The first run in the process (cold: the JIT and every memo empty). */
  cold: RuntimeRun;
  /** The timed runs after the warm-ups, each with its own context, and their medians. */
  runs: RuntimeRun[];
  warmups: number;
  context: Record<string, number>;
  search: Record<string, number>;
  total: number;
  maxGap: number;
  /** The search run again on the last context (its memos warm: what a settings change costs), medians of `again.runs`. */
  again: { runs: number; search: Record<string, number> };
  /** Every run (warm-ups and the runs again included) returned the same trades with the same numbers. */
  sameEveryRun: boolean;
}

export const signatureOf = (r: TradeSearchResult): string => r.trades.map((t) => `${t.key}:${t.b}:${t.pComplete}:${t.gMine}:${t.planB?.key ?? ""}`).join("|");

function medians(rows: readonly Record<string, number>[]): Record<string, number> {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return Object.fromEntries(keys.map((k) => [k, median(rows.map((r) => r[k] ?? Number.NaN))]));
}

/**
 * The search with `settings`, `warmups` + `runs` times, each with its own context, then `again` more times on the last
 * context; the last timed run's context and result are the report's.
 */
export function timedSearches(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: { now: Date; clock: () => number; scenarios?: number; settings: TradeSettings; runs: number; warmups: number; again: number }): { ctx: TradeContext; result: TradeSearchResult; runtime: Runtime } {
  const { clock } = opts;
  const all: RuntimeRun[] = [];
  let last: { ctx: TradeContext; result: TradeSearchResult } | null = null;
  const warmups = Math.max(0, opts.warmups);
  const total = warmups + Math.max(1, opts.runs);
  for (let i = 0; i < total; i++) {
    const t0 = clock();
    const ctx = buildTradeContext(snapshot, inputs, { now: opts.now, clock, settings: opts.settings, ...(opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {}) });
    const gaps = gapTracker(clock);
    const result = runTradeSearch(ctx, { clock, settings: opts.settings }, gaps.onProgress);
    const { maxGap, maxGapAt } = gaps.finish();
    const end = clock();
    all.push({ context: { ...ctx.timings }, search: { ...result.timings }, total: end - t0, maxGap, maxGapAt, signature: signatureOf(result) });
    last = { ctx, result };
  }
  const done = last as { ctx: TradeContext; result: TradeSearchResult };
  const again = Array.from({ length: Math.max(0, opts.again) }, () => runTradeSearch(done.ctx, { clock, settings: opts.settings }));
  const timed = all.slice(warmups);
  const signatures = [...all.map((r) => r.signature), ...again.map(signatureOf)];
  return {
    ...done,
    runtime: {
      cold: all[0] as RuntimeRun,
      runs: timed,
      warmups,
      context: medians(timed.map((r) => r.context)),
      search: medians(timed.map((r) => r.search)),
      total: median(timed.map((r) => r.total)),
      maxGap: median(timed.map((r) => r.maxGap)),
      again: { runs: again.length, search: medians(again.map((r) => r.timings)) },
      sameEveryRun: signatures.every((s) => s === signatures[0]),
    },
  };
}

/** The League model's runtime (section 10): its stages (LeagueModel.timings), cold (the first build in the process) and the medians of the timed builds. */
export interface LeagueRuntime {
  cold: Record<string, number>;
  warm: Record<string, number>;
  runs: number;
  warmups: number;
  players: number;
  teams: number;
  scenarios: number;
  sims: number;
}

/** buildLeagueModel as the League page builds it (default settings, scenarios and seasons), `warmups` + `runs` times; the last build is the report's. */
export function leagueRuntime(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: { now: Date; clock: () => number; scenarios?: number; settings: TradeSettings; runs: number; warmups: number }): { model: LeagueModel; runtime: LeagueRuntime } {
  const builds: Record<string, number>[] = [];
  let model: LeagueModel | null = null;
  const warmups = Math.max(0, opts.warmups);
  for (let i = 0; i < warmups + Math.max(1, opts.runs); i++) {
    model = buildLeagueModel(snapshot, inputs, { now: opts.now, clock: opts.clock, settings: opts.settings, ...(opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {}) });
    builds.push({ ...model.timings });
  }
  const m = model as LeagueModel;
  return {
    model: m,
    runtime: { cold: builds[0] as Record<string, number>, warm: medians(builds.slice(warmups)), runs: builds.length - warmups, warmups, players: Object.keys(m.players).length, teams: m.teams.length, scenarios: m.scenarios, sims: m.odds?.sims ?? 0 },
  };
}

// ---------------------------------------------------------------------------------------------
// Section 3: blend sensitivity and the blend's facts

/** My odds: P(playoffs) and P(title) (null: unknown). */
export interface OddsPair {
  pPlayoffs: number;
  pTitle: number | null;
}

/** The app's model searched at one market-blend weight (section 3). */
export interface BlendRun {
  weight: number;
  ctx: TradeContext;
  result: TradeSearchResult;
  facts: ListFacts;
  /** My baseline odds with pickups (the trade baseline: every team at V*). */
  baseline: OddsPair | null;
  /**
   * The same context searched again without the given-player cap (§13: at most config.ranking.perGivenPlayerInTop20
   * trades in the top 20 giving one player of mine, which keeps Garrett Wilson in at most that many by construction):
   * what the list would look like without it.
   */
  uncapped: { result: TradeSearchResult; facts: ListFacts };
  /** This run's wall time, ms, the search without the cap included (the main run's own search is timed in section 10). */
  ms: number;
}

/** The search on `ctx` again without the given-player cap (BlendRun.uncapped). */
export function uncappedSearch(ctx: TradeContext, settings: TradeSettings): TradeSearchResult {
  return withConfigPatch({ givenPlayerCap: Number.POSITIVE_INFINITY }, () => runTradeSearch(ctx, { settings }));
}

const baselineOf = (result: TradeSearchResult): OddsPair | null => (finite(result.baseline.pPlayoffs) ? { pPlayoffs: result.baseline.pPlayoffs, pTitle: result.baseline.pTitle } : null);

/** The search at every weight of `weights` (BLEND_WEIGHTS): the main run at config's own weight, the others built and searched with the weight patched. */
export function blendSensitivity(snapshot: LeagueSnapshot, inputs: ModelInputs, main: { ctx: TradeContext; result: TradeSearchResult }, opts: { now: Date; clock: () => number; settings: TradeSettings; scenarios?: number; weights?: readonly number[]; wilsonId: string | null }): BlendRun[] {
  const own = config.marketBlend.weight;
  const weights = [...new Set([...(opts.weights ?? BLEND_WEIGHTS)])].sort((a, b) => a - b);
  return weights.map((weight): BlendRun => {
    const facts = (r: TradeSearchResult) => listFacts(r.trades.map((t) => listedOf(t, snapshot)), opts.wilsonId);
    const t0 = opts.clock();
    const { ctx, result, uncapped } = withConfigPatch({ blendWeight: weight }, () => {
      if (Math.abs(weight - own) <= EPS) return { ctx: main.ctx, result: main.result, uncapped: uncappedSearch(main.ctx, opts.settings) };
      const c = buildTradeContext(snapshot, inputs, { now: opts.now, settings: opts.settings, ...(opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {}) });
      return { ctx: c, result: runTradeSearch(c, { settings: opts.settings }), uncapped: uncappedSearch(c, opts.settings) };
    });
    return { weight, ctx, result, facts: facts(result), baseline: baselineOf(result), uncapped: { result: uncapped, facts: facts(uncapped) }, ms: opts.clock() - t0 };
  });
}

/** One player the blend reaches (section 3): per game (LeaguePlayers.blend's factor) and in ROS points (PlayerModel.blend). */
export interface BlendFactRow {
  id: string;
  pos: Pos | null;
  status: string;
  value: number;
  /** One of his position's curve points (healthy, a game left). */
  fit: boolean;
  /** Base rates, points per game: ours (before), the market curve's, and the one used; f = used ÷ ours. */
  ours: number;
  market: number;
  used: number;
  f: number;
  /** ROS points before and after (and the market's) when he has any (PlayerModel.blend), else null. */
  ros: PlayerBlend | null;
}

export interface BlendFacts {
  weight: number;
  positions: BlendPosition[];
  /** Players the blend reaches with a base rate above 0 (f is defined), and f's distribution over them. */
  count: number;
  quantiles: { min: number; p10: number; median: number; p90: number; max: number } | null;
  largest: BlendFactRow[];
  smallest: BlendFactRow[];
  named: { name: string; row: BlendFactRow | null }[];
  /**
   * f for the injury-tagged players (status not ACTIVE) against the healthy ones: how many, median, mean and how many below 1
   * (blend.ts rule 3's ⚠️: an injured player's market discount is partly counted twice, a planner question); and how many of
   * the players off the curve (not curve points) are tagged.
   */
  byHealth: { tagged: FactorGroup; healthy: FactorGroup; offCurve: number; offCurveTagged: number };
  /** The extremes' players who are tagged (largest, smallest). */
  extremesTagged: { largest: number; smallest: number };
}

/** A group of blend factors: how many, their median and mean, and how many are below 1. */
export interface FactorGroup {
  count: number;
  median: number;
  mean: number;
  below1: number;
}

const factorGroup = (fs: readonly number[]): FactorGroup => ({ count: fs.length, median: median(fs), mean: fs.length ? fs.reduce((s, x) => s + x, 0) / fs.length : Number.NaN, below1: fs.filter((x) => x < 1 - EPS).length });

/** The blend of the trade context's League build (section 3: LeaguePlayers.blend and PlayerModel.blend). */
export function blendFacts(I: TradeInternals, n = BLEND_EXTREMES, named: readonly string[] = BLEND_NAMED): BlendFacts {
  const blend = I.league.lp.blend;
  const snapshot = I.snapshot;
  const rows = [...blend.factors]
    .filter(([, f]) => f.ours > 0)
    .map(([id, f]): BlendFactRow => ({ id, pos: snapshot.players[id]?.pos ?? null, status: snapshot.players[id]?.injury ?? "–", value: f.value, fit: f.fit, ours: f.ours, market: f.market, used: f.used, f: f.f, ros: I.model.players[id]?.blend ?? null }));
  const byF = [...rows].sort((a, b) => a.f - b.f || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const fs = byF.map((r) => r.f);
  const rowOf = (name: string) => {
    const id = idByName(snapshot, name);
    return id === null ? null : (rows.find((r) => r.id === id) ?? null);
  };
  const tagged = (r: BlendFactRow) => r.status !== "ACTIVE" && r.status !== "–";
  const largest = [...byF].reverse().slice(0, n);
  const smallest = byF.slice(0, n);
  return {
    weight: blend.weight,
    positions: blend.positions,
    count: rows.length,
    quantiles: fs.length ? { min: quantile(fs, 0), p10: quantile(fs, 0.1), median: quantile(fs, 0.5), p90: quantile(fs, 0.9), max: quantile(fs, 1) } : null,
    largest,
    smallest,
    named: named.map((name) => ({ name, row: rowOf(name) })),
    byHealth: {
      tagged: factorGroup(rows.filter(tagged).map((r) => r.f)),
      healthy: factorGroup(rows.filter((r) => !tagged(r)).map((r) => r.f)),
      offCurve: rows.filter((r) => !r.fit).length,
      offCurveTagged: rows.filter((r) => !r.fit && tagged(r)).length,
    },
    extremesTagged: { largest: largest.filter(tagged).length, smallest: smallest.filter(tagged).length },
  };
}

// ---------------------------------------------------------------------------------------------
// Section 4: odds over time and the decomposition

/** One switch setting run (section 4): its League model (odds as rosters stand) and trade context (odds with pickups). */
export interface SettingRun {
  key: string;
  label: string;
  switches: Switches;
  model: LeagueModel;
  ctx: TradeContext;
  stand: OddsPair | null;
  pickups: OddsPair | null;
}

/** Section 4's settings, from Checkpoint 4's rules to now, and streaming's share at both ends. */
export const SETTINGS: readonly { key: string; label: string; switches: Switches }[] = [
  { key: "cp4", label: "Checkpoint 4's rules (no blend, each team's pickups on its own, no IR returners)", switches: CP4_SWITCHES },
  { key: "cp4+blend", label: "Checkpoint 4's rules + the market blend", switches: { ...CP4_SWITCHES, blend: true } },
  { key: "cp4+oneTeam", label: "Checkpoint 4's rules + one free agent, one team", switches: { ...CP4_SWITCHES, oneTeam: true } },
  { key: "cp4+ir", label: "Checkpoint 4's rules + IR returners", switches: { ...CP4_SWITCHES, irReturners: true } },
  { key: "cp4+blend+oneTeam", label: "the blend + one free agent, one team (now without IR returners)", switches: { ...CP4_SWITCHES, blend: true, oneTeam: true } },
  { key: "now", label: "now: the blend + one free agent, one team + IR returners", switches: NOW_SWITCHES },
  { key: "now-blend", label: "now without the blend", switches: { ...NOW_SWITCHES, blend: false } },
  { key: "now-oneTeam", label: "now with each team's pickups on its own", switches: { ...NOW_SWITCHES, oneTeam: false } },
  { key: "cp4-streaming", label: "Checkpoint 4's rules without streaming", switches: { ...CP4_SWITCHES, streaming: false } },
  { key: "now-streaming", label: "now without streaming", switches: { ...NOW_SWITCHES, streaming: false } },
];

/** Odds in words: "65.2% / 12.1%" (P(playoffs) / P(title)). */
export const oddsText = (o: { pPlayoffs: number; pTitle: number | null } | null | undefined): string => (o ? `${pctPlain(o.pPlayoffs)} / ${pctPlain(o.pTitle)}` : "–");
/** The change from `a` to `b` in percentage points: "+0.6 pts / +0.4 pts". */
export const deltaText = (a: OddsPair | null | undefined, b: OddsPair | null | undefined): string => (a && b ? `${pts(b.pPlayoffs - a.pPlayoffs)} / ${b.pTitle !== null && a.pTitle !== null ? pts(b.pTitle - a.pTitle) : "–"}` : "–");

const myOddsIn = (model: LeagueModel): OddsPair | null => {
  const o = model.odds?.teams.find((t) => t.teamId === model.myTeamId);
  return o ? { pPlayoffs: o.pPlayoffs, pTitle: o.pTitle } : null;
};

const pickupOddsIn = (ctx: TradeContext): OddsPair | null => {
  const b = tradeInternals(ctx).sim?.base.final;
  return b ? { pPlayoffs: b.pPlayoffs, pTitle: b.pTitle } : null;
};

/** A setting's League model (default seasons: odds as rosters stand) and trade context (its baseline: odds with pickups). */
export function settingRun(snapshot: LeagueSnapshot, inputs: ModelInputs, s: { key: string; label: string; switches: Switches }, opts: { now: Date; settings: TradeSettings; scenarios?: number }): SettingRun {
  return withSwitches(s.switches, opts.settings, (o) => {
    const sc = opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {};
    const model = buildLeagueModel(snapshot, inputs, { now: opts.now, settings: o.settings, faAllocation: o.faAllocation, irReturners: o.irReturners, ...sc });
    const ctx = buildTradeContext(snapshot, inputs, { now: opts.now, settings: o.settings, faAllocation: o.faAllocation, irReturners: o.irReturners, ...sc });
    return { ...s, model, ctx, stand: myOddsIn(model), pickups: pickupOddsIn(ctx) };
  });
}

/** Every setting of SETTINGS (the "now" one from the report's own League model and context). */
export function decomposition(snapshot: LeagueSnapshot, inputs: ModelInputs, now: { model: LeagueModel; ctx: TradeContext }, opts: { now: Date; settings: TradeSettings; scenarios?: number }): Map<string, SettingRun> {
  const out = new Map<string, SettingRun>();
  for (const s of SETTINGS) out.set(s.key, s.key === "now" ? { ...s, model: now.model, ctx: now.ctx, stand: myOddsIn(now.model), pickups: pickupOddsIn(now.ctx) } : settingRun(snapshot, inputs, s, opts));
  return out;
}

/**
 * My odds as rosters stand (the League model's teams, TeamModel.score) simulated on the trade baseline's own seasons (its
 * final block: seasons screeningSims + 1 … screeningSims + finalSims of the seed's matrix), so "with pickups" minus this is
 * a common-random-numbers difference. The League model itself reads seasons 1 … finalSims (review of track R: the two
 * columns of section 4 aren't the same seasons). Null without a simulation.
 */
export function standOnSearchSeasons(snapshot: LeagueSnapshot, model: LeagueModel, ctx: TradeContext): OddsPair | null {
  const sim = tradeInternals(ctx).sim;
  if (!sim) return null;
  const odds = seasonOdds(snapshot, model, { sims: config.simulation.finalSims, seed: config.simulation.seed, normals: sim.blocks.final });
  const mine = odds?.teams.find((t) => t.teamId === model.myTeamId);
  return mine ? { pPlayoffs: mine.pPlayoffs, pTitle: mine.pTitle } : null;
}

/**
 * Checkpoint 4's rules in today's code (the "cp4" setting) against the Checkpoint 4 model on the same data (the compare
 * file): whether they agree to the printed decimal (|Δ| < 0.0005 on every odds number the compare file has), and the
 * differences. Null without both.
 */
export function cp4Reproduction(c4: CompareRun | null, cp4Run: Pick<SettingRun, "stand" | "pickups"> | null): { same: boolean; stand: string; pickups: string } | null {
  if (!c4 || !cp4Run) return null;
  const near = (a: number | null | undefined, b: number | null | undefined) => (a === null || a === undefined || b === null || b === undefined ? a === b : Math.abs(a - b) < 0.0005);
  const standSame = near(cp4Run.stand?.pPlayoffs, c4.odds.asRostersStand.pPlayoffs) && near(cp4Run.stand?.pTitle, c4.odds.asRostersStand.pTitle);
  const pickupsSame = !c4.odds.withPickups || (near(cp4Run.pickups?.pPlayoffs, c4.odds.withPickups.pPlayoffs) && near(cp4Run.pickups?.pTitle, c4.odds.withPickups.pTitle));
  return { same: standSame && pickupsSame, stand: deltaText(c4.odds.asRostersStand, cp4Run.stand), pickups: deltaText(c4.odds.withPickups ?? null, cp4Run.pickups) };
}

/** One team's data changes since a checkpoint (section 4: its committed league report's tables against this data). */
export interface TeamDataChange {
  /** Public NFL names: on the team now and not then, and the other way round. */
  joined: string[];
  left: string[];
  /** Players on the team both times whose status changed (league-report's St codes: "" active, P, Q, D, O, IR, …). */
  status: { name: string; from: string; to: string }[];
  /** Its record then (the report's) and now ("2-1"). */
  record: { then: string | null; now: string };
}

/** What changed in the data since Checkpoints 3 and 4 (section 4; the planner's "explain the moves by cause"). */
export interface DataChanges {
  /** Per team id; null when that checkpoint's league report isn't available (git show failed). */
  cp3: Map<string, TeamDataChange> | null;
  cp4: Map<string, TeamDataChange> | null;
  /** Points per week (scenario lineups, rosters as they stand) under Checkpoint 4's rules: Checkpoint 4's report, and this data (the "cp4" setting's League model). */
  ppwCp4: Map<string, { then: number | null; now: number | null }>;
  /**
   * My players on my roster both times with the same status: rest-of-season points under Checkpoint 4's rules, its report
   * then and the "cp4" setting now (projection updates), the largest moves first (DATA_ROS_SHOWN).
   */
  myRos: { name: string; then: number; now: number }[];
}

/** A record as the league report prints it ("2-1", "2-1-1"). */
const recordText = (r: { w: number; l: number; t: number }): string => `${r.w}-${r.l}${r.t ? `-${r.t}` : ""}`;

/** Every team's record the same as in the report (null: no report). */
export const recordsSame = (changes: Map<string, TeamDataChange> | null): boolean | null => (changes ? [...changes.values()].every((c) => c.record.then === c.record.now) : null);

function teamChanges(snapshot: LeagueSnapshot, then: LeagueReportTables): Map<string, TeamDataChange> {
  const out = new Map<string, TeamDataChange>();
  for (const t of snapshot.teams) {
    const before = then.rosters.get(t.id) ?? new Map();
    const now = new Map([...t.roster, ...t.ir, ...t.taxi].map((id) => [snapshot.players[id]?.name ?? id, statusShort(snapshot.players[id]?.injury)] as const));
    out.set(t.id, {
      joined: [...now.keys()].filter((n) => !before.has(n)),
      left: [...before.keys()].filter((n) => !now.has(n)),
      status: [...now].flatMap(([name, to]) => {
        const from = before.get(name)?.status;
        return from !== undefined && from !== to ? [{ name, from, to }] : [];
      }),
      record: { then: then.teams.get(t.id)?.record ?? null, now: recordText(t.record) },
    });
  }
  return out;
}

export function dataChanges(snapshot: LeagueSnapshot, history: { cp3: LeagueReportTables | null; cp4: LeagueReportTables | null }, cp4Model: LeagueModel | null, shown = DATA_ROS_SHOWN): DataChanges {
  const cp3 = history.cp3 ? teamChanges(snapshot, history.cp3) : null;
  const cp4 = history.cp4 ? teamChanges(snapshot, history.cp4) : null;
  const ppwCp4 = new Map<string, { then: number | null; now: number | null }>();
  for (const t of snapshot.teams) {
    const m = cp4Model?.teams.find((x) => x.id === t.id);
    ppwCp4.set(t.id, { then: history.cp4?.teams.get(t.id)?.ppw ?? null, now: m ? (m.scen ?? m.ev).ppw : null });
  }
  const me = snapshot.teams.find((t) => t.id === snapshot.myTeamId);
  const mine = history.cp4 && me ? (history.cp4.rosters.get(me.id) ?? new Map()) : new Map();
  const myRos = (me ? [...me.roster, ...me.ir, ...me.taxi] : []).flatMap((id) => {
    const p = snapshot.players[id];
    const then = p ? mine.get(p.name) : undefined;
    const now = cp4Model?.players[id]?.ros.total;
    if (!p || !then || then.ros === null || then.status !== statusShort(p.injury) || !finite(now)) return [];
    return [{ name: p.name, then: then.ros, now }];
  });
  myRos.sort((a, b) => Math.abs(b.now - b.then) - Math.abs(a.now - a.then) || (a.name < b.name ? -1 : 1));
  return { cp3, cp4, ppwCp4, myRos: myRos.filter((r) => Math.abs(r.now - r.then) >= 0.05).slice(0, shown) };
}

// ---------------------------------------------------------------------------------------------
// Section 5: one free agent, one team

/** A team's pickups (TeamModel.faMoves). */
export interface TeamPickups {
  teamId: string;
  moves: FaMove[];
}

/** One top trade's free agents after it (section 5): what each side's legality and V*(after) add, and whose baseline claims they are. */
export interface AllocationTradeRow {
  rank: number;
  partnerId: string;
  illegal: string | null;
  /** Who went first in the allocation order (null under "independent" or when illegal), and whether a team sits between us. */
  first: "me" | "partner" | null;
  between: boolean;
  myAdds: string[];
  /** Of my adds: the partner's baseline claims (allowed when I'm first), a third team's (never). */
  fromPartner: string[];
  fromThird: string[];
  theirAdds: string[];
  /** Of the partner's adds: my baseline claims (allowed when it's first, or right behind me), a third team's (never). */
  takesMine: string[];
  theirFromThird: string[];
}

export interface AllocationReport {
  allocation: FaAllocation | null;
  oneTeam: TeamPickups[];
  independent: TeamPickups[];
  dups: { oneTeam: { playerId: string; teamIds: string[] }[]; independent: { playerId: string; teamIds: string[] }[]; cp4: { playerId: string; teamIds: string[] }[] | null };
  named: { name: string; playerId: string | null; oneTeam: string[]; independent: string[]; cp4: string[] | null }[];
  trades: AllocationTradeRow[];
}

/** Who picks up `playerId` in a set of pickups. */
const takers = (teams: readonly TeamPickups[], playerId: string | null): string[] => (playerId === null ? [] : teams.filter((t) => t.moves.some((m) => m.add === playerId)).map((t) => t.teamId));

/** The allocation report (section 5) from the main context (one team each) and a model of each team on its own (the same switches otherwise). */
export function allocationReport(I: TradeInternals, independent: LeagueModel, result: TradeSearchResult, compare: CompareRun | null, named: readonly string[] = ALLOCATION_NAMED, top = TOP_DETAIL): AllocationReport {
  const snapshot = I.snapshot;
  const oneTeam = I.model.teams.map((t) => ({ teamId: t.id, moves: t.faMoves }));
  const indep = independent.teams.map((t) => ({ teamId: t.id, moves: t.faMoves }));
  const cp4 = compare?.pickups ? compare.pickups.map((p) => ({ teamId: p.teamId, moves: p.moves.map((m) => ({ add: m.add, drop: m.drop, gainEv: Number.NaN, gainScen: null })) })) : null;
  const me = I.me;
  const trades: AllocationTradeRow[] = !me
    ? []
    : result.trades.slice(0, top).map((t, i): AllocationTradeRow => {
        const partner = I.byId.get(t.proposal.partnerId) as TeamState;
        const base: AllocationTradeRow = { rank: i + 1, partnerId: partner.id, illegal: null, first: null, between: false, myAdds: [], fromPartner: [], fromThird: [], theirAdds: [], takesMine: [], theirFromThird: [] };
        const sides = tradeSides(I, me, partner, playerIds(t.proposal.give), playerIds(t.proposal.get), `Team ${partner.id}`);
        if ("illegal" in sides) return { ...base, illegal: sides.illegal };
        const third = (id: string) => I.teams.some((u) => u !== me && u !== partner && u.claimed.includes(id));
        const myAdds = unique([...sides.mineLegal.change.adds, ...claimedBy(sides.mine)]);
        const theirAdds = unique([...sides.theirLegal.change.adds, ...claimedBy(sides.theirs)]);
        const between = me.claimRank === null || partner.claimRank === null || Math.abs(me.claimRank - partner.claimRank) > 1;
        return {
          ...base,
          first: I.league.allocation ? sides.first : null,
          between,
          myAdds,
          fromPartner: myAdds.filter((id) => partner.claimed.includes(id)),
          fromThird: myAdds.filter(third),
          theirAdds,
          takesMine: theirAdds.filter((id) => me.claimed.includes(id)),
          theirFromThird: theirAdds.filter(third),
        };
      });
  return {
    allocation: I.model.faAllocation ?? null,
    oneTeam,
    independent: indep,
    dups: { oneTeam: duplicatePickups(I.model.teams), independent: duplicatePickups(independent.teams), cp4: compare?.duplicates ? compare.duplicates.map((d) => ({ playerId: d.playerId, teamIds: [...d.teamIds] })) : null },
    named: named.map((name) => {
      const id = idByName(snapshot, name);
      return { name, playerId: id, oneTeam: takers(oneTeam, id), independent: takers(indep, id), cp4: cp4 ? takers(cp4, id) : null };
    }),
    trades,
  };
}

/**
 * How a top trade's own baseline pickup of the partner's came within my reach after it (section 5; evaluate.ts tradeSides):
 * I'm earlier in the order (I claim first), or the partner is right before me with no team between and doesn't claim him
 * again after the trade; anything else would be a pool bug (❌). The partner takes one of mine the same way round.
 */
export function pickupReach(first: "me" | "partner" | null, between: boolean, whose: "partner's" | "mine"): string {
  const takerFirst = whose === "partner's" ? first === "me" : first === "partner";
  if (takerFirst) return whose === "partner's" ? "you're earlier in the order, so you'd claim him first" : "they're earlier in the order, so they'd claim him first";
  if (!between && first !== null) return whose === "partner's" ? "you're right behind them in the order and they let him go after the trade" : "they're right behind you in the order and you let him go after the trade";
  return "❌ a team between you in the order would claim him first";
}

/** The search with the waiver order a weekly reset would give today (section 5; CLAUDE.md §2.2's ⚠️, a planner question at Checkpoint 4b). */
export interface ResetOrderRun {
  /** The weekly reset order (resetWaiverOrder) and the live one the report runs with (LeagueModel.faAllocation). */
  order: string[];
  live: string[];
  /** My pickups (V*(me)) and my odds with pickups (the trade baseline) under the reset order. */
  myPickups: FaMove[];
  odds: OddsPair | null;
  result: TradeSearchResult;
  facts: ListFacts;
  /** Of its first TOP_DETAIL trades, how many are among this report's first TOP_DETAIL. */
  overlap: number;
}

/**
 * The default search again with every team's waiver rank set to its place in the weekly reset order (reverse standings by
 * the League model's ranks, `model`), a fresh context: what the allocation and the trades would be on the morning of the
 * reset. Null when the allocation isn't a waiver order, or the reset order is unknown or already the live one.
 */
export function resetOrderRun(snapshot: LeagueSnapshot, inputs: ModelInputs, model: LeagueModel, main: { ctx: TradeContext; result: TradeSearchResult }, opts: { now: Date; settings: TradeSettings; scenarios?: number; wilsonId: string | null }): ResetOrderRun | null {
  const live = tradeInternals(main.ctx).model.faAllocation;
  const order = resetWaiverOrder(model);
  if (!live || live.basis !== "waiver" || !order || order.length !== snapshot.teams.length || order.every((id, i) => id === live.order[i])) return null;
  const rank = new Map(order.map((id, i) => [id, i + 1]));
  const reset: LeagueSnapshot = { ...snapshot, teams: snapshot.teams.map((t) => ({ ...t, waiverRank: rank.get(t.id) as number })) };
  const ctx = buildTradeContext(reset, inputs, { now: opts.now, settings: opts.settings, ...(opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {}) });
  const I = tradeInternals(ctx);
  const result = runTradeSearch(ctx, { settings: opts.settings });
  const mainTop = new Set(main.result.trades.slice(0, TOP_DETAIL).map((t) => t.key));
  return {
    order: [...(I.model.faAllocation?.order ?? order)],
    live: [...live.order],
    myPickups: [...(I.model.teams.find((t) => t.id === I.model.myTeamId)?.faMoves ?? [])],
    odds: baselineOf(result),
    result,
    facts: listFacts(result.trades.map((t) => listedOf(t, snapshot)), opts.wilsonId),
    overlap: result.trades.slice(0, TOP_DETAIL).filter((t) => mainTop.has(t.key)).length,
  };
}

// ---------------------------------------------------------------------------------------------
// Section 6: the cards

export interface CardsReport {
  shown: number;
  steps: number;
  planB: { boxes: number; samePlayers: number; otherTarget: number; distinct: number };
  /** Cards with an injury tag on either side, on what I'd get, on what I'd give. */
  tagged: { any: number; get: number; give: number };
  dropped: { partnerCap: number; core: number; filler: number; givenPlayer: number };
  /**
   * The window the partner and given-player caps read (config.ranking.partnerCapTop), and my players given most in it: the
   * first `shownMost` by count, and everyone tied with the last of them (review of track R: a cut at 5 among 7 players at the
   * cap of 3 dropped Garrett Wilson, the one the planner asked about).
   */
  window: number;
  mostGiven: { playerId: string; count: number }[];
  /**
   * My players the shown cards' Plan B boxes give (all shown cards), each with the cards and the boxes that give him and the
   * boxes on cards that don't (the box adds him): the given-player cap counts a box only when it adds a player, and only in
   * its window (search.ts), so a capped player can still be suggested in boxes. Players with a box only, most suggested first.
   */
  inBoxes: { playerId: string; cards: number; boxes: number; added: number }[];
}

export function cardsReport(result: TradeSearchResult, shownMost = MOST_GIVEN_SHOWN): CardsReport {
  const t = result.trades;
  const boxes = t.flatMap((x) => (x.planB ? [x.planB] : []));
  const tags = (x: TradeEvaluation) => x.flags.tagged ?? [];
  const window = Math.max(0, Math.floor(config.ranking.partnerCapTop));
  const count = new Map<string, number>();
  for (const x of t.slice(0, window)) for (const id of playerIds(x.proposal.give)) count.set(id, (count.get(id) ?? 0) + 1);
  const ranked = [...count].map(([playerId, n]) => ({ playerId, count: n })).sort((a, b) => b.count - a.count || (a.playerId < b.playerId ? -1 : 1));
  const cut = ranked[Math.max(0, Math.floor(shownMost)) - 1]?.count;
  const boxed = new Map<string, { cards: number; boxes: number; added: number }>();
  for (const x of t) {
    if (!x.planB) continue;
    const card = new Set(playerIds(x.proposal.give));
    for (const id of playerIds(x.planB.proposal.give)) {
      const e = boxed.get(id) ?? { cards: 0, boxes: 0, added: 0 };
      boxed.set(id, { ...e, boxes: e.boxes + 1, added: e.added + (card.has(id) ? 0 : 1) });
    }
  }
  for (const [id, e] of boxed) e.cards = t.filter((x) => playerIds(x.proposal.give).includes(id)).length;
  return {
    shown: t.length,
    steps: t.filter((x) => x.steps).length,
    planB: { boxes: boxes.length, samePlayers: boxes.filter((b) => b.kind === "samePlayers").length, otherTarget: boxes.filter((b) => b.kind === "otherTarget").length, distinct: new Set(boxes.map((b) => b.key)).size },
    tagged: { any: t.filter((x) => tags(x).length > 0).length, get: t.filter((x) => tags(x).some((g) => g.side === "get")).length, give: t.filter((x) => tags(x).some((g) => g.side === "give")).length },
    dropped: { partnerCap: 0, core: 0, filler: 0, givenPlayer: 0, ...(result.dropped ?? {}) },
    window,
    mostGiven: cut === undefined ? ranked : ranked.filter((m, i) => i < shownMost || m.count === cut),
    inBoxes: [...boxed].map(([playerId, e]) => ({ playerId, ...e })).sort((a, b) => b.cards + b.boxes - (a.cards + a.boxes) || b.boxes - a.boxes || (a.playerId < b.playerId ? -1 : 1)),
  };
}

/** The Plan B boxes the planner's literal rules give (section 6): the search again with the "likelier" rule and the box cap off. */
export interface LiteralPlanB {
  boxes: number;
  /** Boxes less likely to go through than their card (P_complete below the card's), and worse on both (Helps you and P_complete below the card's). */
  lessLikely: number;
  worseOnBoth: number;
  /** The player of mine the boxes add most often (beyond what their cards give), and in how many boxes. */
  topAdded: { playerId: string; count: number } | null;
}

export function literalPlanB(ctx: TradeContext, settings: TradeSettings, planB: TradeSearchOptions["planB"] = { minAcceptGain: null, givenPlayerCap: null }): LiteralPlanB {
  const r = runTradeSearch(ctx, { settings, planB });
  const withBox = r.trades.filter((t) => t.planB);
  const added = new Map<string, number>();
  for (const t of withBox) {
    const give = new Set(playerIds(t.proposal.give));
    for (const id of playerIds((t.planB as NonNullable<TradeEvaluation["planB"]>).proposal.give)) if (!give.has(id)) added.set(id, (added.get(id) ?? 0) + 1);
  }
  const top = [...added].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  return {
    boxes: withBox.length,
    lessLikely: withBox.filter((t) => (t.planB as NonNullable<TradeEvaluation["planB"]>).pComplete < t.pComplete - EPS).length,
    worseOnBoth: withBox.filter((t) => {
      const b = t.planB as NonNullable<TradeEvaluation["planB"]>;
      return b.pComplete < t.pComplete - EPS && b.tradeScore < (t.tradeScore ?? Number.NEGATIVE_INFINITY);
    }).length,
    topAdded: top ? { playerId: top[0], count: top[1] } : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Section 7: IR players

/** An IR player (league-report's IrReturnerRow) with the displacement at V*(T), the trade baseline's. */
export interface IrRow extends IrReturnerRow {
  vstarDrop: { playerId: string; week: number; self: boolean } | null;
}

export interface IrTradeRow {
  rank: number;
  partnerId: string;
  /**
   * The IR players in the trade, whose (mine: given; theirs: received), and where he is: in an IR slot (team.ir: tradable
   * since Phase 4b) or on an active roster with a status the league's IR slot takes (IrReport.eligible; always tradable).
   */
  ir: { playerId: string; side: "give" | "get"; slot: boolean }[];
  required: TradeEvaluation["required"];
}

export interface IrReport {
  /** The statuses this league's IR slot takes (irSlots.irEligibleStatuses: the platform's rule, else config's default). */
  eligible: InjuryStatus[];
  rows: IrRow[];
  /** Each team's points per week (scenario lineups when they ran) without and with the returners (as rosters stand). */
  ppw: { teamId: string; off: number; on: number }[];
  /** My odds as rosters stand without and with the returners. */
  odds: { off: OddsPair | null; on: OddsPair | null };
  trades: IrTradeRow[];
  /** Shown trades with an IR player: in the top 10; and those with a player in an IR slot (the kind Phase 4b made tradable). */
  inTop: number;
  inSlot: number;
  /** Shown cards whose forced moves put a received IR player in an open IR slot (RosterChange.toIR), and those with a displacement the trade brings, on my side and on the partner's (RosterChange.displaced). */
  toIR: number;
  displaced: { mine: number; theirs: number };
}

export function irReport(I: TradeInternals, off: LeagueModel, on: LeagueModel, result: TradeSearchResult, top = TOP_DETAIL): IrReport {
  const weeks = I.league.lp.weeks.weeks;
  const rows = irReturnerRows(I.league).map((r): IrRow => {
    const t = I.byId.get(r.teamId);
    const d = t?.base.displaced.find((x) => x.returner === r.playerId);
    const week = d ? weeks[d.from] : undefined;
    return { ...r, vstarDrop: d && week !== undefined ? { playerId: d.id, week, self: d.id === r.playerId } : null };
  });
  const ppwOf = (m: LeagueModel, id: string) => {
    const t = m.teams.find((x) => x.id === id);
    return t ? (t.scen ?? t.ev).ppw : Number.NaN;
  };
  const irIds = new Set(I.snapshot.teams.flatMap((t) => t.ir));
  // An IR player: in an IR slot, or with a status the league's IR slot takes (ESPN's: IR and OUT), whichever roster he's on.
  const eligible = irEligibleStatuses(I.snapshot.settings);
  const isIr = (id: string) => {
    const status = I.snapshot.players[id]?.injury;
    return irIds.has(id) || (status !== undefined && eligible.has(status));
  };
  const trades = result.trades.flatMap((t, i): IrTradeRow[] => {
    const side = (which: "give" | "get") => playerIds(which === "give" ? t.proposal.give : t.proposal.get).filter(isIr).map((playerId) => ({ playerId, side: which, slot: irIds.has(playerId) }));
    const ir = [...side("give"), ...side("get")];
    return ir.length ? [{ rank: i + 1, partnerId: t.proposal.partnerId, ir, required: t.required }] : [];
  });
  const has = (c: RosterChange, k: "toIR" | "displaced") => (c[k] ?? []).length > 0;
  return {
    eligible: [...eligible],
    rows,
    ppw: on.teams.map((t) => ({ teamId: t.id, off: ppwOf(off, t.id), on: ppwOf(on, t.id) })),
    odds: { off: myOddsIn(off), on: myOddsIn(on) },
    trades,
    inTop: trades.filter((t) => t.rank <= top).length,
    inSlot: trades.filter((t) => t.ir.some((p) => p.slot)).length,
    toIR: result.trades.filter((t) => has(t.required.me, "toIR") || has(t.required.partner, "toIR")).length,
    displaced: { mine: result.trades.filter((t) => has(t.required.me, "displaced")).length, theirs: result.trades.filter((t) => has(t.required.partner, "displaced")).length },
  };
}

// ---------------------------------------------------------------------------------------------
// Section 8: consistency

export interface ConsistencyRow {
  rank: number;
  key: string;
  partnerId: string;
  bSearch: number | null;
  bAnalyzer: number | null;
  /** The card's numbers that differ between the search and analyzeTrade (Object.is); empty = all equal. */
  differ: string[];
  illegal: string | null;
  /** analyzeTrade's time for this trade, ms (a fresh context: its memos fill as it goes). */
  ms: number;
  /** V*(after) of each side as the evaluation runs it (tradeSides: the allocation's pools), null when legality fails. */
  myAfter: readonly FaStep[] | null;
  theirAfter: readonly FaStep[] | null;
}

/** A Plan B box re-evaluated (its three numbers must be the Analyzer's: the final block of seasons). */
export interface PlanBCheckRow {
  rank: number;
  key: string;
  differ: string[];
}

export interface Consistency {
  rows: ConsistencyRow[];
  planB: PlanBCheckRow[];
  /** V* before any trade: my pickups, and each partner's. */
  myBefore: readonly FaStep[];
  before: Record<string, readonly FaStep[]>;
  /** The fresh context's build time, ms. */
  contextMs: number;
}

/** The card's numbers compared between the search's evaluation and the Analyzer's. */
export const COMPARED: readonly (keyof TradeEvaluation)[] = ["b", "tradeScore", "overall", "pAccept", "pComplete", "dPO", "dCH", "dEW", "dPPW", "dPPWPlayoffs", "gMine", "gPartner", "partnerDeltaLineup", "bWin"];
const PLAN_B_COMPARED = ["b", "tradeScore", "overall", "pAccept", "pComplete"] as const;

/** V*(after) of both sides as evaluateExact runs them (tradeSides), or nulls when legality fails. */
function vstarAfter(I: TradeInternals, me: TeamState, partner: TeamState, give: readonly string[], get: readonly string[]): { mine: readonly FaStep[] | null; theirs: readonly FaStep[] | null } {
  const sides = tradeSides(I, me, partner, give, get, `Team ${partner.id}`);
  return "illegal" in sides ? { mine: null, theirs: null } : { mine: sides.mine.moves, theirs: sides.theirs.moves };
}

/** Every shown trade and Plan B re-evaluated by analyzeTrade in a fresh context (the file header, section 8). */
export function consistencyCheck(snapshot: LeagueSnapshot, inputs: ModelInputs, trades: readonly TradeEvaluation[], opts: { now: Date; clock: () => number; scenarios?: number; settings: TradeSettings }): Consistency {
  const { clock } = opts;
  const t0 = clock();
  const fresh = buildTradeContext(snapshot, inputs, { now: opts.now, settings: opts.settings, ...(opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {}) });
  const contextMs = clock() - t0;
  const I = tradeInternals(fresh);
  const me = I.me as TeamState;
  const rows = trades.map((t, i): ConsistencyRow => {
    const a0 = clock();
    const a = analyzeTrade(fresh, t.proposal, { settings: opts.settings });
    const dt = clock() - a0;
    const e = a.evaluation;
    const differ = e ? COMPARED.filter((k) => !Object.is(t[k], e[k])).map(String) : ["(no evaluation)"];
    const partner = I.byId.get(t.proposal.partnerId) as TeamState;
    const after = vstarAfter(I, me, partner, playerIds(t.proposal.give), playerIds(t.proposal.get));
    return { rank: i + 1, key: t.key, partnerId: t.proposal.partnerId, bSearch: t.b, bAnalyzer: e?.b ?? null, differ, illegal: a.illegal, ms: dt, myAfter: after.mine, theirAfter: after.theirs };
  });
  const planB = trades.flatMap((t, i): PlanBCheckRow[] => {
    const box = t.planB;
    if (!box) return [];
    const e = analyzeTrade(fresh, box.proposal, { settings: opts.settings }).evaluation;
    const differ = e ? PLAN_B_COMPARED.filter((k) => !Object.is(box[k], e[k])).map(String) : ["(no evaluation)"];
    return [{ rank: i + 1, key: box.key, differ }];
  });
  const before: Record<string, readonly FaStep[]> = {};
  for (const t of I.teams) before[t.id] = t.vstar.moves;
  return { rows, planB, myBefore: me.vstar.moves, before, contextMs };
}

/** One player of mine given alone for nothing, my side only (the measured bound: section 8). */
export interface GiveAwayRow {
  playerId: string;
  value: number;
  /** His lineup cost (MV_lose, the exact mode's lineups: scenario lineups when they run). */
  cost: number | null;
  /** Shown trades that give him. */
  inShown: number;
  /** Null when no partner can take him (roster rules). */
  illegal: string | null;
  /** My lineup points after he leaves (legality's fill, then V*) minus before (Σ ω × LV over the counted weeks, the exact mode). */
  ros: number | null;
  /** Players on my roster after it that V*(me) doesn't have, and the ones V*(me) has that are gone (besides him). */
  ins: string[];
  outs: string[];
  /** B_win with only my row of the season simulation changed (the partner left as it was), the final block of seasons. */
  bWin: number | null;
  /** B, the same way, at each "Protect my trade value" level. */
  b: Record<ProtectValue, number | null>;
}

/**
 * Each of my throw-ins and each player of mine worth less than W (the search's candidates: active roster, with a model, at
 * positions the search uses), given alone for nothing: exact evaluation with the first partner whose roster rules take him,
 * then the simulation with the partner's row left at its baseline (ExactTrade.theirs = its baseline), so B_win is what his
 * departure does to my side alone. A positive ROS change is a free-agent swap V*(me) skipped (it gains under faMinGain) that
 * the trade realizes: the measured "no B from pickups" bound.
 */
export function giveAwayCheck(ctx: TradeContext, result: TradeSearchResult, settings: TradeSettings): GiveAwayRow[] {
  const I = tradeInternals(ctx);
  const me = I.me;
  if (!me || !I.sim) return [];
  const excluded = new Set<Pos>(settings.includeKDefIdp ? [] : config.market.tradeSearchExcluded);
  const thr = new Set(throwIns(I, settings));
  const costs = I.model.teams[me.index]?.players ?? {};
  const ids = me.roster.filter((id) => I.league.table.rows.has(id) && !excluded.has(I.league.posOf(id) as Pos) && (thr.has(id) || (I.values[id] ?? 0) < I.credit));
  const maxPerSide = Math.max(1, Math.floor(config.search.analyzerMaxPerSide));
  const mineOnly = (x: ExactTrade): ExactTrade => ({ ...x, theirs: x.partner.base });
  const baseRos = rosValue(me.base.lv, I.weights);
  const vstar = new Set(me.vstar.roster);
  return ids
    .map((id): GiveAwayRow => {
      const pv = costs[id];
      const row: GiveAwayRow = {
        playerId: id,
        value: I.values[id] ?? 0,
        cost: pv ? (pv.mvLoseScen ?? pv.mvLoseEv) : null,
        inShown: result.trades.filter((t) => playerIds(t.proposal.give).includes(id)).length,
        illegal: null,
        ros: null,
        ins: [],
        outs: [],
        bWin: null,
        b: { low: null, medium: null, high: null },
      };
      let x: ExactTrade | null = null;
      let last = "No team can take him.";
      for (const p of I.teams) {
        if (p === me) continue;
        const r = evaluateExact(I, { partnerId: p.id, give: asPlayers([id]), get: [] }, maxPerSide);
        if ("illegal" in r) {
          last = r.illegal;
          continue;
        }
        x = r;
        break;
      }
      if (!x) return { ...row, illegal: last };
      const after = new Set(x.mine.roster);
      const sims = Object.fromEntries(PROTECT_VALUE_LEVELS.map((v) => [v, simulateTrade(I, mineOnly(x as ExactTrade), "final", settings.lambda, v)])) as Record<ProtectValue, ReturnType<typeof simulateTrade>>;
      return {
        ...row,
        ros: rosValue(x.mine.lv, I.weights) - baseRos,
        ins: [...after].filter((p) => !vstar.has(p)),
        outs: [...vstar].filter((p) => p !== id && !after.has(p)),
        bWin: sims[settings.protectValue].bWin,
        b: { low: sims.low.b, medium: sims.medium.b, high: sims.high.b },
      };
    })
    .sort((a, b) => (b.ros ?? Number.NEGATIVE_INFINITY) - (a.ros ?? Number.NEGATIVE_INFINITY) || (a.playerId < b.playerId ? -1 : 1));
}

/** A no-op check row: a shown trade's exact evaluation with both sides put back at their baselines, simulated at both blocks. */
export interface NoOpRow {
  rank: number;
  partnerId: string;
  /** ΔPO, ΔCH and ΔEW at the screening block and at the final block (all must be exactly 0). */
  screen: { dPO: number | null; dCH: number | null; dEW: number | null };
  final: { dPO: number | null; dCH: number | null; dEW: number | null };
}

/**
 * The no-op check (§16: "a no-op trade has exactly zero delta under common random numbers"): for each shown trade, its
 * exact evaluation with my side and the partner's both replaced by their baselines (TeamState.base: V*(T), finally priced),
 * run through simulateTrade at both blocks of seasons. A trade that changes neither roster moves nothing: the baseline odds
 * go through the same code as every "after" run.
 */
export function noOpCheck(ctx: TradeContext, result: TradeSearchResult, settings: TradeSettings): NoOpRow[] {
  const I = tradeInternals(ctx);
  const me = I.me;
  if (!me || !I.sim) return [];
  const maxPerSide = Math.max(1, Math.floor(config.search.analyzerMaxPerSide));
  return result.trades.flatMap((t, i): NoOpRow[] => {
    const x = evaluateExact(I, t.proposal, maxPerSide);
    if ("illegal" in x) return [];
    const noop: ExactTrade = { ...x, mine: me.base, theirs: x.partner.base };
    const d = (stage: "screen" | "final") => {
      const c = simulateTrade(I, noop, stage, settings.lambda, settings.protectValue);
      return { dPO: c.dPO, dCH: c.dCH, dEW: c.dEW };
    };
    return [{ rank: i + 1, partnerId: t.proposal.partnerId, screen: d("screen"), final: d("final") }];
  });
}

// ---------------------------------------------------------------------------------------------
// Section 9: the anchors

export interface AnchorRow {
  name: string;
  planner: number;
  computed: number;
  diff: number;
  pass: boolean;
  /** Within ± this many points (0.5 for both tables since the planner's reply to Checkpoint 4). */
  tolerance: number;
  /** The estimate without the star premium (§11's anchors carry none), and the planner's Checkpoint 4 value. */
  withoutPremium: number;
  plannerOld: number;
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

/** §11's anchors through acceptance() itself (a league without trade review, redraft unless the scenario says dynasty; a partner with no history and 40% playoff odds: no season context). */
export function anchorRows(): AnchorRow[] {
  return ANCHORS.map((s) => {
    const r = acceptance(s.dynasty ? DYNASTY_ANCHOR_LEAGUE : ANCHOR_LEAGUE, anchorProfile(s.a ?? 0, NEUTRAL_PLAYOFFS), { gPartner: s.g ?? 0, deltaLineup: (s.n ?? 0) * config.acceptance.nScale, h: s.h ?? 0, assets: (s.c ?? 0) + 2, partnerReceives: [] });
    const computed = 100 * r.pAccept;
    const diff = computed - s.percent;
    return { name: s.name, planner: s.percent, computed, diff, pass: Math.abs(diff) <= ANCHOR_TOLERANCE, tolerance: ANCHOR_TOLERANCE, withoutPremium: computed, plannerOld: s.old };
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
    const profile = anchorProfile(0, pPlayoffs);
    const computed = 100 * acceptance(ANCHOR_LEAGUE, profile, input).pAccept;
    const withoutPremium = 100 * acceptance(ANCHOR_LEAGUE, profile, { ...input, gPerceived: undefined }).pAccept;
    const diff = computed - s.percent;
    return { name: s.name, planner: s.percent, computed, diff, pass: Math.abs(diff) <= PREMIUM_ANCHOR_TOLERANCE, tolerance: PREMIUM_ANCHOR_TOLERANCE, withoutPremium, plannerOld: s.old };
  });
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
  /** Timed runs and warm-ups (default SEARCH_RUNS, SEARCH_WARMUPS); searches again on the same context (default `runs`). */
  runs?: number;
  warmups?: number;
  again?: number;
  /** Section 3's weights (default BLEND_WEIGHTS). */
  blendWeights?: readonly number[];
  /** The Checkpoint 4 and Checkpoint 3 models' results on the same data (--compare, --compare3), with where each came from. */
  compare?: { run: CompareRun; file: string } | null;
  compare3?: { run: CompareRun; file: string } | null;
  /**
   * Checkpoint 3's and Checkpoint 4's committed league reports (the markdown of 6a83beb and b27e90f:reports/league-report.md;
   * main reads them with git show), for section 4's "what changed in the data"; null or absent when not available.
   */
  history?: { cp3: string | null; cp4: string | null } | null;
  /** The command line the header prints (commandText; default: the script with --offline when offline). */
  command?: string;
  /** Timings of the stages before the engine (live: the crosswalk, the import, the model inputs). */
  timing?: Record<string, number>;
}

export interface TradeReport {
  doc: string;
  ctx: TradeContext;
  result: TradeSearchResult;
  model: LeagueModel;
  runtime: Runtime;
  leagueRuntime: LeagueRuntime;
  wilsonId: string | null;
  facts: { now: ListFacts; cp4: ListFacts | null };
  /** Why the model sells Garrett Wilson, over the uncapped search's top 10 at the app's blend weight (section 2), or null. */
  wilsonWhy: WilsonWhy | null;
  blend: BlendRun[];
  blendFacts: BlendFacts;
  settings: Map<string, SettingRun>;
  /** My odds as rosters stand on the trade baseline's seasons (section 4: the pickup effect on common random numbers). */
  standOnSearch: OddsPair | null;
  /** What changed in the data since Checkpoints 3 and 4 (section 4). */
  dataChanges: DataChanges;
  allocation: AllocationReport;
  /** The search with the weekly reset waiver order (section 5), or null. */
  resetOrder: ResetOrderRun | null;
  cards: CardsReport;
  literalPlanB: LiteralPlanB;
  ir: IrReport;
  consistency: Consistency;
  giveAway: GiveAwayRow[];
  noOp: NoOpRow[];
  anchors: AnchorRow[];
  premiumAnchors: AnchorRow[];
  /** This report's own stages after the timed runs, ms (and "total": everything buildTradeReport did). */
  timing: Record<string, number>;
}

/** This report's stages, in order, with their labels (section 10). */
const REPORT_STAGES: readonly [string, string][] = [
  ["league", "the League model's timed builds (warm-up and runs)"],
  ["searches", "the timed searches (warm-up and runs, each with its own context; then again on the last context)"],
  ["blend", "section 3's searches: the other market-blend weights (each with its own context), and every weight's search again without the given-player cap"],
  ["settings", "the switch settings (a League model and a trade context each)"],
  ["sections", "Checkpoint 4's top 10 through the Analyzer, the data changes, the allocation, the cards, the IR players"],
  ["resetOrder", "section 5's search with the weekly reset waiver order (its own context)"],
  ["literalPlanB", "the search again with the planner's literal Plan B rules (the main context)"],
  ["consistency", "the consistency checks (a fresh context; the measured bound; the no-op)"],
  ["total", "the whole report, before writing it"],
];

/**
 * Everything after the network (the file header): the searches, the checks and the markdown, not yet scrubbed.
 * `snapshot` must already carry placeholders (league-report's placeholders()).
 */
export function buildTradeReport(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: TradeReportOptions): TradeReport {
  const settings = normalizeTradeSettings(defaultTradeSettings());
  const { now, clock } = opts;
  const sc = opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {};
  const runs = opts.runs ?? SEARCH_RUNS;
  const warmups = opts.warmups ?? SEARCH_WARMUPS;
  const timing: Record<string, number> = {};
  const start = clock();
  let last = start;
  const lap = (stage: string) => {
    const t = clock();
    timing[stage] = t - last;
    last = t;
  };
  const league = leagueRuntime(snapshot, inputs, { now, clock, settings, runs, warmups, ...sc });
  lap("league");
  const { ctx, result, runtime } = timedSearches(snapshot, inputs, { now, clock, settings, runs, warmups, again: opts.again ?? runs, ...sc });
  lap("searches");
  const I = tradeInternals(ctx);
  const wilsonId = idByName(snapshot, WILSON);
  const blend = blendSensitivity(snapshot, inputs, { ctx, result }, { now, clock, settings, wilsonId, ...(opts.blendWeights ? { weights: opts.blendWeights } : {}), ...sc });
  const facts = blendFacts(I);
  lap("blend");
  const decomp = decomposition(snapshot, inputs, { model: league.model, ctx }, { now, settings, ...sc });
  lap("settings");
  const compare = opts.compare?.run ?? null;
  const cp4Trades = compare?.trades ? compare.trades.map(listedOfCompare) : null;
  const nowList = result.trades.map((t) => listedOf(t, snapshot));
  const history = { cp3: opts.history?.cp3 ? parseLeagueReport(opts.history.cp3) : null, cp4: opts.history?.cp4 ? parseLeagueReport(opts.history.cp4) : null };
  const changes = dataChanges(snapshot, history, (decomp.get("cp4") as SettingRun).model);
  const standSearch = standOnSearchSeasons(snapshot, league.model, ctx);
  const allocation = allocationReport(I, (decomp.get("now-oneTeam") as SettingRun).model, result, compare);
  const cards = cardsReport(result);
  const ir = irReport(I, (decomp.get("cp4+blend+oneTeam") as SettingRun).model, league.model, result);
  const cp4Now = cp4Trades ? cp4Trades.slice(0, TOP_DETAIL).map((t) => nowOf(ctx, result, settings, t)) : [];
  const mainRun = mainBlendRun({ blend });
  const why = mainRun ? wilsonWhy(mainRun.uncapped.result.trades, wilsonId) : null;
  lap("sections");
  const reset = resetOrderRun(snapshot, inputs, league.model, { ctx, result }, { now, settings, wilsonId, ...sc });
  lap("resetOrder");
  const literal = literalPlanB(ctx, settings);
  lap("literalPlanB");
  const consistency = consistencyCheck(snapshot, inputs, result.trades, { now, clock, settings, ...sc });
  const giveAway = giveAwayCheck(ctx, result, settings);
  const noOp = noOpCheck(ctx, result, settings);
  lap("consistency");
  const anchors = anchorRows();
  const premiumAnchors = premiumAnchorRows();
  timing.total = clock() - start;
  const listFactsNow = listFacts(nowList, wilsonId);
  const listFactsCp4 = cp4Trades ? listFacts(cp4Trades, wilsonId) : null;
  const x: RenderInput = {
    snapshot,
    inputs,
    opts,
    settings,
    ctx,
    I,
    result,
    model: league.model,
    runtime,
    leagueRuntime: league.runtime,
    wilsonId,
    nowList,
    cp4Trades,
    cp4Now,
    facts: { now: listFactsNow, cp4: listFactsCp4 },
    wilsonWhy: why,
    blend,
    blendFacts: facts,
    settingsRuns: decomp,
    standOnSearch: standSearch,
    dataChanges: changes,
    history,
    allocation,
    resetOrder: reset,
    cards,
    literalPlanB: literal,
    ir,
    consistency,
    giveAway,
    noOp,
    anchors,
    premiumAnchors,
    timing,
  };
  const doc = render(x);
  return {
    doc,
    ctx,
    result,
    model: league.model,
    runtime,
    leagueRuntime: league.runtime,
    wilsonId,
    facts: x.facts,
    wilsonWhy: why,
    blend,
    blendFacts: facts,
    settings: decomp,
    standOnSearch: standSearch,
    dataChanges: changes,
    allocation,
    resetOrder: reset,
    cards,
    literalPlanB: literal,
    ir,
    consistency,
    giveAway,
    noOp,
    anchors,
    premiumAnchors,
    timing,
  };
}

/** Where a compare file's trade is now (section 2b): its place in this run's list, else the Analyzer's numbers today, or why it can't be made. */
export type NowFate = { kind: "shown"; place: number } | { kind: "analyzed"; helps: number | null; pAccept: number; overall: number | null; b: number | null; hiddenByMarket: boolean } | { kind: "illegal"; reason: string };

export function nowOf(ctx: TradeContext, result: TradeSearchResult, settings: TradeSettings, t: Pick<ListedTrade, "key" | "partnerId" | "give" | "get">): NowFate {
  const at = result.trades.findIndex((x) => x.key === t.key);
  if (at >= 0) return { kind: "shown", place: at + 1 };
  const a = analyzeTrade(ctx, { partnerId: t.partnerId, give: asPlayers(t.give), get: asPlayers(t.get) }, { settings });
  if (!a.evaluation) return { kind: "illegal", reason: a.illegal ?? "it can't be evaluated" };
  const e = a.evaluation;
  return { kind: "analyzed", helps: e.tradeScore, pAccept: e.pAccept, overall: e.overall, b: e.b, hiddenByMarket: e.flags.hiddenByMarket };
}

interface RenderInput {
  snapshot: LeagueSnapshot;
  inputs: ModelInputs;
  opts: TradeReportOptions;
  settings: TradeSettings;
  ctx: TradeContext;
  I: TradeInternals;
  result: TradeSearchResult;
  model: LeagueModel;
  runtime: Runtime;
  leagueRuntime: LeagueRuntime;
  wilsonId: string | null;
  nowList: ListedTrade[];
  cp4Trades: ListedTrade[] | null;
  cp4Now: NowFate[];
  facts: { now: ListFacts; cp4: ListFacts | null };
  wilsonWhy: WilsonWhy | null;
  blend: BlendRun[];
  blendFacts: BlendFacts;
  settingsRuns: Map<string, SettingRun>;
  standOnSearch: OddsPair | null;
  dataChanges: DataChanges;
  /** The committed league reports read back (null: not available). */
  history: { cp3: LeagueReportTables | null; cp4: LeagueReportTables | null };
  allocation: AllocationReport;
  resetOrder: ResetOrderRun | null;
  cards: CardsReport;
  literalPlanB: LiteralPlanB;
  ir: IrReport;
  consistency: Consistency;
  giveAway: GiveAwayRow[];
  noOp: NoOpRow[];
  anchors: AnchorRow[];
  premiumAnchors: AnchorRow[];
  timing: Record<string, number>;
}

function render(x: RenderInput): string {
  const L: string[] = [];
  const teamName = (id: string) => `Team ${id}${id === x.result.myTeamId ? " (you)" : ""}`;
  renderHeader(L, x);
  renderTop(L, x, teamName);
  renderBeforeAfter(L, x, teamName);
  renderBlend(L, x, teamName);
  renderOdds(L, x, teamName);
  renderAllocation(L, x, teamName);
  renderCards(L, x);
  renderIr(L, x, teamName);
  renderConsistency(L, x, teamName);
  renderAnchors(L, x.anchors, x.premiumAnchors);
  renderRuntime(L, x);
  return L.join("\n");
}

/** κ of the report's settings ("Protect my trade value"). */
const kappaOf = (x: RenderInput): number => protectValueWeight(x.settings.protectValue);
const LEVEL_WORDS: Readonly<Record<ProtectValue, string>> = { low: "Low", medium: "Medium", high: "High" };

/** A compare file's provenance in one line. */
const compareLine = (c: { run: CompareRun; file: string }, root: string): string => `${c.run.label} (code ${c.run.code}) on dump ${c.run.dump} at ${c.run.now}, from ${relativePath(root, c.file)}`;

function renderHeader(L: string[], x: RenderInput): void {
  const { snapshot, inputs, I, result, settings, opts } = x;
  const model = I.model;
  const generated = (opts.generatedAt ?? opts.now).toISOString().slice(0, 10);
  L.push("# Trade search: Parker's ESPN league (Checkpoint 4b)", "");
  L.push(
    `Generated by \`${opts.command ?? commandText("trade:report", [opts.mode === "offline" ? "--offline" : null])}\` on ${generated} through the real trade engine (buildTradeContext, runTradeSearch, analyzeTrade, explainTrade) and League model (buildLeagueModel), as the app's Web Workers run them. Team, owner and league names are placeholders (you are Team ${result.myTeamId ?? "–"}); NFL player names are public.`,
    "",
  );
  L.push(
    `**League 1** · ESPN · ${snapshot.season} · week ${snapshot.currentWeek} · ${snapshot.teams.length} teams · ${snapshot.settings.leagueType} · remaining weeks ${model.weeks[0] ?? "–"}–${model.weeks.at(-1) ?? "–"} (regular season ${model.regularWeeks.length}, playoffs ${model.playoffWeeks.length}) · ${I.S} availability scenarios · trade review: ${snapshot.settings.tradeReview} · numbers as of ${opts.now.toISOString()}`,
    "",
  );
  L.push("**Data**", "");
  L.push(`- ${opts.dataNote}`);
  for (const s of inputs.sources) L.push(`- ${s.source}: ${s.fetchedAt}${s.stale ? " (saved copy; the live fetch failed)" : ""}`);
  L.push(`- League snapshot fetched: ${snapshot.fetchedAt}`);
  for (const [label, c] of [
    ["Checkpoint 4 model's results (--compare)", opts.compare],
    ["Checkpoint 3 model's results (--compare3)", opts.compare3],
  ] as const) {
    if (!c) {
      L.push(`- ${label}: not given.`);
      continue;
    }
    const same = Date.parse(c.run.now) === opts.now.getTime();
    L.push(`- ${label}: ${compareLine(c, ROOT)}${same ? " (the same moment as this report's data)" : ` ⚠️ not this report's data (its moment differs from ${opts.now.toISOString()}): its numbers aren't comparable one for one`}.`);
  }
  for (const n of inputs.notes) L.push(`- Note: ${n}`);
  for (const w of inputs.warnings) L.push(`- Warning \`${w.code}\`: ${w.message}`);
  L.push("");
  const b = result.baseline;
  L.push(
    `**Settings used** (the app's defaults, defaultTradeSettings): max ${settings.maxPerSide} players a side; streamed positions ${settings.streamPositions.join(", ") || "none"}; playoff weeks count ${settings.playoffWeight}×; Win now ↔ Future ${settings.lambda === null ? "default (redraft: not used)" : settings.lambda}; Protect my trade value ${LEVEL_WORDS[settings.protectValue]} (κ ${kappaOf(x)}); untouchables ${settings.untouchables.length || "none"}; must-include ${settings.mustInclude.length || "none"}; target positions ${settings.targetPositions.join(", ") || "any"}; avoid ${settings.avoidPositions.join(", ") || "none"}; P/K/D/ST/IDP ${settings.includeKDefIdp ? "included" : "left out"}; draft picks ${settings.includePicks ? "on" : "off"}. The model's Phase 4b rules: market-blended projections (w ${config.marketBlend.weight}), one free agent per team (${model.faAllocation ? `claimed in ${allocationBasisText(model.faAllocation.basis)}` : "no allocation"}), IR returners, β_need ${betaNeed(snapshot.settings.leagueType)} and the P_accept cap ${pctPlain(config.acceptance.pAcceptClamp[1], 0)}, every player at max(v, W) in trade values. The waiver credit W (the best free agent's trade value, §9): ${valueText(I.credit)}.`,
    "",
  );
  L.push(`**Your baseline** (every team after its free-agent pickups, ${thousands(config.simulation.finalSims)} seasons): P(playoffs) ${pctPlain(b.pPlayoffs)}, P(title) ${pctPlain(b.pTitle)}, expected wins ${fmt(b.expWins, 2)}.`, "");
  const notes = [...new Set([...x.ctx.notes, ...result.notes])];
  const warnings = [...new Set([...x.ctx.warnings, ...result.warnings, ...model.warnings])];
  L.push("**Engine notes and warnings** (the League model's, the evaluation context's and the search's):", "");
  if (!notes.length && !warnings.length) L.push("- none");
  for (const n of notes) L.push(`- Note: ${n}`);
  for (const w of warnings) L.push(`- Warning: ${w}`);
  L.push("");
}

// ---------------------------------------------------------------------------------------------
// Section 1: the top 10

/** The season's end for "Out for the season" (tradeView.seasonEndOf: the NFL's last week when known). */
const seasonEnd = (x: RenderInput): number | undefined => seasonEndOf(x.snapshot.settings, x.inputs.nfl.lastWeek);

/** A player's status in words: "active", or the card's tag words without a week ("Questionable", "On IR"). */
function statusWords(status: string | null | undefined): string {
  if (!status) return "–";
  return status === "ACTIVE" ? "active" : injuryTagText({ status: status as InjuryTag["status"] });
}

/** An injury tag in the card's words: "Questionable", "Out — expected back week 8" (tradeView.injuryTagText). */
function tagWords(x: RenderInput, tag: Pick<InjuryTag, "status" | "returnWeek">): string {
  return injuryTagText(tag as Pick<InjuryTag, "status" | "returnWeek">, seasonEnd(x), x.snapshot.platform === "manual" ? undefined : "ESPN");
}

/** "Zay Flowers (WR, BAL) [Questionable] [Harder to get]": a side's players with their injury tags (and, received, the premium tag). */
function sideText(x: RenderInput, t: TradeEvaluation, side: "give" | "get"): string {
  const ids = playerIds(side === "give" ? t.proposal.give : t.proposal.get);
  const tags = new Map((t.flags.tagged ?? []).filter((g) => g.side === side).map((g) => [g.playerId, g]));
  const harder = new Set(side === "get" ? (t.detail.premium ?? []).filter((p) => p.harderToGet).map((p) => p.playerId) : []);
  if (!ids.length) return "nobody";
  return ids
    .map((id) => {
      const tag = tags.get(id);
      return `${playerLabel(x.snapshot, id)}${tag ? ` [${tagWords(x, tag)}]` : ""}${harder.has(id) ? " [Harder to get]" : ""}`;
    })
    .join(" + ");
}

/** A side's forced moves (RosterChange): drops, adds, IR slots and the displacements an IR return brings. */
export function changeText(snapshot: LeagueSnapshot, c: RosterChange): string {
  const parts = [
    ...c.drops.map((id) => `drop ${playerLabel(snapshot, id)}`),
    ...c.adds.map((id) => `add ${playerLabel(snapshot, id)}`),
    ...(c.toIR ?? []).map((id) => `${playerLabel(snapshot, id)} goes to an open IR slot`),
    ...(c.displaced ?? []).map((d) => (d.playerId === d.returner ? `release ${playerLabel(snapshot, d.playerId)} at his return (week ${d.week})` : `from week ${d.week} drop ${playerLabel(snapshot, d.playerId)} when ${nameOf(snapshot, d.returner)} comes back from IR`)),
  ];
  return parts.length ? parts.join(", ") : "none";
}

/** The app's own card for a trade (tradeView.buildTradeCard, as the Trade Finder builds it): its flags, injury note and reasons. */
function cardOf(x: RenderInput, t: TradeEvaluation): ReturnType<typeof buildTradeCard> {
  return buildTradeCard(t, { snapshot: x.snapshot, baseline: x.result.baseline, lastNflWeek: x.inputs.nfl.lastWeek, knownTags: knownTagsOf(x.result.trades) });
}

/**
 * What the pitch's "You'd get about X% more trade value than you give (FantasyCalc values)" reads (explain.ts
 * fantasyCalcGain): the partner's gain in FantasyCalc's own values, each player at his raw value (no floor at W, no
 * roster-spot credit), or null when a player has no positive value.
 */
export function pitchValueGain(t: Pick<TradeEvaluation, "proposal">, value: ((id: string) => number | null) | undefined): number | null {
  if (!value) return null;
  const sum = (assets: readonly TradeAsset[]): number | null => {
    let s = 0;
    for (const a of assets) {
      const v = a.kind === "player" ? value(a.id) : null;
      if (v === null || !finite(v) || !(v > 0)) return null;
      s += v;
    }
    return s;
  };
  const theyGet = sum(t.proposal.give);
  const theyGive = sum(t.proposal.get);
  return theyGet === null || theyGive === null || !(theyGive > 0) ? null : theyGet / theyGive - 1;
}

/** The star premium line of a card (TradeDetail.premium): each player they give with e, his rank there and top-12, and their g as they see it. */
function premiumText(snapshot: LeagueSnapshot, t: TradeEvaluation): string | null {
  const facts = (t.detail.premium ?? []).filter((f) => f.e > 0);
  if (!facts.length) return null;
  const [lo, hi] = config.acceptance.gClamp;
  const clamped = t.features.g <= lo + EPS || t.features.g >= hi - EPS ? ` (the model clamps g to ${pctSigned(lo, 0)}…${pctSigned(hi, 0)})` : "";
  const parts = facts.map((f) => `${nameOf(snapshot, f.playerId)} e ${fmt(f.e, 2)}${f.rank ? ` (their #${f.rank}${f.elite ? ", top-12" : ""})` : ""}${f.harderToGet ? ", Harder to get" : ""}`);
  return `${parts.join("; ")}: their g as they see it ${pctSigned(t.features.g)}${clamped}, at market ${pctSigned(t.gPartner)}`;
}

/** The card's "How to offer it" (TradeEvaluation.steps) or "If they say no, try:" (TradeEvaluation.planB). */
function nextStepText(snapshot: LeagueSnapshot, t: TradeEvaluation): string {
  const st = t.steps;
  if (st) {
    const o = st.offerFirst;
    return `How to offer it: offer first ${names(snapshot, playerIds(o.proposal.give))} for ${names(snapshot, playerIds(o.proposal.get))} · Est. ${shownChance(o.pAccept)} (P_complete ${pctPlain(o.pComplete)}); if they say no, add ${nameOf(snapshot, st.ifNo.add)} · Est. ${shownChance(st.ifNo.full.pAccept)} (P_complete ${pctPlain(st.ifNo.full.pComplete)}); the ranked trade is the ${st.ranked === "full" ? "full version" : "offer first"}`;
  }
  const p = t.planB;
  if (p) {
    const kind = p.kind === "samePlayers" ? "a different package for the same players of theirs" : "a different target";
    const veto = Math.abs(p.pComplete - p.pAccept) > EPS ? `, P_complete ${pctPlain(p.pComplete)}` : "";
    return `If they say no, try (${kind}): you give ${names(snapshot, playerIds(p.proposal.give))} for ${names(snapshot, playerIds(p.proposal.get))} · Helps you ${p.tradeScore} · Est. ${shownChance(p.pAccept)} (${p.acceptLabel}${veto}) · Overall ${p.overall} · B ${fmt(p.b, 2)}`;
  }
  return "no offer-first step and no Plan B (none qualifies)";
}

/** One trade's numbers as the summary table prints them. */
function summaryRow(x: RenderInput, t: TradeEvaluation, i: number, teamName: (id: string) => string): string {
  return `| ${i + 1} | ${teamName(t.proposal.partnerId)} | ${sideText(x, t, "give")} | ${sideText(x, t, "get")} | ${t.tradeScore ?? "–"} | ${chanceText(t)} | ${t.overall ?? "–"} | ${fmt(t.b, 2)} | ${signed(t.dPPW)} / ${signed(t.dPPWPlayoffs)} | ${pts(t.dPO)} | ${pts(t.dCH)} | ${signed(t.dEW, 2)} | ${fmt(t.ros.received)} / ${fmt(t.ros.given)} | ${pctSigned(t.gMine)} / ${pctSigned(t.gPartner)} | ${signed(t.features.n, 2)} (${signed(t.partnerDeltaLineup)}/wk) | ${t.features.h} |`;
}

const SUMMARY_HEAD = [
  "| # | Partner | You give | You get | Helps you | Chance they accept | Overall | B | ΔPPW reg / playoffs | ΔPO | ΔCH | ΔEW | ROS pts get / give | g_mkt you / them | Their n (ΔLineup) | h |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
];

/** A trade's card in full. */
function renderCard(L: string[], x: RenderInput, t: TradeEvaluation, heading: string, teamName: (id: string) => string): void {
  const s = x.snapshot;
  const partner = teamName(t.proposal.partnerId);
  const v = valueReading(t.gMine, t.gPartner);
  const words = placeholderWords(x.I, t);
  const kappa = kappaOf(x);
  const term = marketTermOf(t);
  L.push(`### ${heading}`, "");
  L.push(`**You give** ${sideText(x, t, "give")} · **you get** ${sideText(x, t, "get")} · partner ${partner}`, "");
  L.push(`- **Helps you ${t.tradeScore ?? "– (B ≤ 0)"}** · **Chance they accept ${chanceText(t)}** (model: P_accept ${pctPlain(t.pAccept)}${t.detail.vetoRisk ? `, P_complete ${pctPlain(t.pComplete)}` : ""}) · **Overall ${t.overall ?? "–"}**`);
  const bParts =
    t.lambda === null
      ? `B_win ${fmt(t.bWin, 2)} + market term ${signed(term, 2)}${term !== null && kappa > 0 ? ` = κ ${kappa} × ${pctSigned(term / kappa)}` : ""}`
      : `λ ${fmt(t.lambda, 2)}, B_win ${fmt(t.bWin, 2)}, B_future ${fmt(t.bFuture, 2)}${t.dynMissing ? " (long-term values missing)" : ""}`;
  L.push(`- B ${fmt(t.b, 2)} (${bParts}); ΔPO ${pts(t.dPO)}, ΔCH ${pts(t.dCH)}, ΔEW ${signed(t.dEW, 2)} wins (${thousands(t.sims)} seasons)`);
  L.push(`- ΔPPW ${signed(t.dPPW)} points a week in the regular season, ${signed(t.dPPWPlayoffs)} in the playoffs; ROS points: you get ${fmt(t.ros.received)}, give ${fmt(t.ros.given)}`);
  L.push(`- Trade value (FantasyCalc, each player at max(v, W), W ${valueText(x.I.credit)}, with the roster-spot credit): you give ${thousands(Math.round(t.value.given))}, get ${thousands(Math.round(t.value.received))}; g_mkt(you) ${pctSigned(t.gMine)}, g_mkt(${partner}) ${pctSigned(t.gPartner)}: ${v.you}`);
  if (/\(FantasyCalc values\)/.test(words.pitch)) {
    // The pitch names the offer-first version when the card has steps (explain.ts pitchSource).
    const offerFirst = t.steps?.offerFirst.proposal;
    const raw = pitchValueGain({ proposal: offerFirst ?? t.proposal }, explainContextOf(x.I).fantasyCalcValue);
    if (raw !== null && (offerFirst || Math.abs(raw - t.gPartner) >= 0.005))
      L.push(`- The pitch's trade-value figure is FantasyCalc's raw values${offerFirst ? " for the offer-first version it names" : ""} (no floor at W, no roster-spot credit): they get ${pctSigned(raw)}${offerFirst ? "" : `, where g_mkt(${partner}) reads ${pctSigned(t.gPartner)}`}`);
  }
  const premium = premiumText(s, t);
  if (premium) L.push(`- Star premium on what ${partner} gives: ${premium}`);
  const holes = t.detail.holes.length ? `holes ${t.detail.holes.join(", ")}${t.detail.holesFilled.length ? `, filled ${t.detail.holesFilled.join(", ")}` : ", none filled"}` : "no holes";
  L.push(`- ${partner}'s side: n ${signed(t.features.n, 2)} (their lineup ${signed(t.partnerDeltaLineup)} points a week, the next ${config.acceptance.nBlendNextWeeks} weeks and the rest of the season blended; × β_need ${betaNeed(s.settings.leagueType)}), h ${t.features.h} (${holes}), activity ${signed(t.features.a, 0)} (${t.detail.activity.rule}), hist ${t.features.hist === null ? "none" : signed(t.features.hist, 3)}, context ${signed(t.features.ctx, 2)}, hot ${signed(t.features.hot, 2)}, urgency ${signed(t.features.urg, 2)}; z ${signed(t.features.z, 2)}`);
  L.push(`- Required moves: you ${changeText(s, t.required.me)}; ${partner} ${changeText(s, t.required.partner)}`);
  const card = cardOf(x, t);
  L.push(`- Flags on the card: ${card.flags.length ? card.flags.map((f) => `"${f.text}"`).join(" · ") : "none"}`);
  if (card.injuryNote) L.push(`- Injury note on the card: "${card.injuryNote}"`);
  L.push(`- ${nextStepText(s, t)}`);
  if (t.detail.notes.length) L.push(`- Notes: ${t.detail.notes.join(" ")}`);
  // The card's reasons: the engine's, with its injured-player caveat left to the flag (tradeView.buildTradeCard).
  const reasons = t.flags.injured.length ? words.reasons.filter((r) => !INJURED_REASON.test(r)) : words.reasons;
  L.push("", "Reasons:", "");
  for (const r of reasons) L.push(`1. ${r}`);
  L.push("", "Pitch:", "", `> ${words.pitch || "(none)"}`, "");
}

function renderTop(L: string[], x: RenderInput, teamName: (id: string) => string): void {
  const trades = x.result.trades;
  const top = trades.slice(0, TOP_DETAIL);
  L.push(`## 1. Your top ${TOP_DETAIL} trades now`, "");
  if (!top.length) {
    L.push(`No trades: ${[...x.ctx.notes, ...x.result.notes].join(" ") || "nothing helps your team."}`, "");
    return;
  }
  const kappa = kappaOf(x);
  L.push(
    `The search's first ${top.length} of ${trades.length} trades in its default order, Overall (§13: EG = B × P_complete), with the default settings: the app's model with every Phase 4b change. **Helps you** = round(100 × (1 − e^(−B / ${config.benefit.bRef}))); **Chance they accept** = the model's estimate (§11: β_need ${betaNeed(x.snapshot.settings.leagueType)}, P_accept capped at ${pctPlain(config.acceptance.pAcceptClamp[1], 0)}), shown rounded to ${Math.round(100 * config.acceptance.displayStep)}% with its label; **Overall** = round(100 × (1 − e^(−B × P_complete / ${config.benefit.bRef}))). B = 100 × (${config.benefit.weights.playoffs} ΔPO + ${config.benefit.weights.title} ΔCH) + the market term κ × clamp(g_mkt(you), ±${config.benefit.marketSanityClamp[1]}), κ = ${kappa} ("Protect my trade value": ${LEVEL_WORDS[x.settings.protectValue]}). ΔPO, ΔCH: the change in your playoff and title odds in percentage points (${thousands(config.simulation.finalSims)} seasons on common random numbers); ΔEW: expected wins. ΔPPW: your average weekly starting points, regular season / playoffs. ROS pts: the players' own rest-of-season points (§6, market-blended), received / given. g_mkt (§9): what a side gets over what it gives, minus 1, in FantasyCalc values, each player at max(v, W) on both sides with the roster-spot credit; you / them. n = their weekly lineup change ÷ ${config.acceptance.nScale}, clamped to ±2; h = 1 when it gives them a starter at a hole. Both teams are measured after their free-agent pickups (V*), one free agent per team. Injury tags in brackets are the card's own words (flags.tagged: every player on either side whose status isn't active); "[Harder to get]" marks a player who is his team's #1 or #2 by trade value and a top-12 player. Each card's flags and injury note below are the app's card's own words (tradeView.buildTradeCard: what Parker sees), and its reasons are the card's: the engine's, with the injured-player caveat left to the flag. The pitch quotes trade value in FantasyCalc's raw numbers (explain.ts: no floor at W and no roster-spot credit), so it can read lower than g_mkt(them): on a 1-for-2 the side that gets fewer players has an open roster spot worth W in g_mkt but not in the pitch.`,
    "",
  );
  L.push(...SUMMARY_HEAD);
  top.forEach((t, i) => L.push(summaryRow(x, t, i, teamName)));
  L.push("");
  const f = x.facts.now;
  const cap = config.ranking.perGivenPlayerInTop20;
  const uncapped = mainBlendRun(x)?.uncapped.facts ?? null;
  const capped = f.wilsonTop >= cap ? ` (the given-player cap's most: at most ${cap} trades in the top ${config.ranking.partnerCapTop} give one player of yours${uncapped ? `; without the cap, ${uncapped.wilsonTop} of ${uncapped.topN}: section 2` : ""})` : "";
  L.push(
    `Among them: ${f.injuredTop} receive an injury-tagged player; ${f.wilsonTop} give ${WILSON}${capped}; ${top.filter((t) => t.steps).length} carry an offer-first step and ${top.filter((t) => t.planB).length} a Plan B ("If they say no, try:").`,
    "",
  );
  L.push("Each trade's card (reasons and pitch worded by explainTrade with placeholder team names, as the card shows them):", "");
  top.forEach((t, i) => renderCard(L, x, t, `${i + 1}. With ${teamName(t.proposal.partnerId)}`, teamName));
}

// ---------------------------------------------------------------------------------------------
// Section 2: before and after

/**
 * A tag's return week as the card would say it (explain.injuryTags' rule, so a compare file's tags read like today's
 * cards): OUT from next week on, IR, PUP and SUSPENDED after this week, Probable, Questionable and Doubtful only when far
 * enough out (availability.farReturnWeek; whether the other model's projection followed the date isn't in the file), NA
 * never; else no week.
 */
export function shownReturnWeek(status: string, R: number | undefined, currentWeek: number): number | undefined {
  if (R === undefined || !Number.isInteger(R)) return undefined;
  if (status === "OUT") return R >= currentWeek + 1 ? R : undefined;
  if (status === "IR" || status === "PUP" || status === "SUSPENDED") return R > currentWeek ? R : undefined;
  if (status === "PROBABLE" || status === "QUESTIONABLE" || status === "DOUBTFUL") return farReturnWeek(R, currentWeek) ? R : undefined;
  return undefined;
}

/** A listed trade's received tags, in words (the card's: shownReturnWeek). */
function receivedTagsText(x: RenderInput, t: ListedTrade): string {
  const got = t.tagged.filter((g) => g.side === "get");
  const words = (g: ListedTrade["tagged"][number]) => {
    const week = shownReturnWeek(g.status, g.returnWeek, x.snapshot.currentWeek);
    return tagWords(x, { status: g.status as InjuryTag["status"], ...(week !== undefined ? { returnWeek: week } : {}) });
  };
  return got.length ? got.map((g) => `${nameOf(x.snapshot, g.playerId)}: ${words(g)}`).join("; ") : "–";
}

const nowFateText = (f: NowFate | undefined): string => {
  if (!f) return "–";
  if (f.kind === "shown") return `shown at #${f.place}`;
  if (f.kind === "illegal") return `can't be made now: ${f.reason}`;
  if (!finite(f.b) || !(f.b > 0)) return `not shown: doesn't help you now (B ${fmt(f.b, 2)}); Est. ${shownChance(f.pAccept)}`;
  if (f.hiddenByMarket) return `not shown: hidden by the market guard; ${threeNumbers(f.helps, f.pAccept, f.overall)}`;
  return `not shown; the Analyzer now: ${threeNumbers(f.helps, f.pAccept, f.overall)}`;
};

function renderBeforeAfter(L: string[], x: RenderInput, teamName: (id: string) => string): void {
  const s = x.snapshot;
  const r4 = CHECKPOINT4_REPORTED;
  L.push("## 2. Before and after: your top 10", "");
  L.push(
    `The planner's ask: Parker's top 10 before (Checkpoint 4) and after, with the three numbers, injury flags, how many receive an injury-tagged player, and how many give ${WILSON}. Three lists: **(a)** Checkpoint 4 as reported (${r4.data}, commit ${r4.code}); **(b)** the Checkpoint 4 model run on this report's own data (a worktree of commit ${r4.code}, --compare), so the data is the same and only the model differs; **(c)** now. Three numbers: Helps you / Chance they accept (as shown) / Overall. "Injury-tagged" = any status other than active (Probable, Questionable, Doubtful, Out, IR, PUP, Suspended, NA) on a player you'd get.`,
    "",
  );
  // (a)
  const check = reportedTagsCheck(x.history.cp4);
  const injuredA = reportedInjuredTop();
  L.push(
    `**(a) Checkpoint 4 as reported** (reports/trade-report.md §1 at ${r4.code}; the received players' injury statuses from the St column of its league report on the same live data, ${r4.code}:reports/league-report.md${check === null ? ", read back here: every one matches ✅" : check === undefined ? "; that report isn't available here to read them back" : `, read back here: ⚠️ ${check.join(", ")} differ`}):`,
    "",
  );
  L.push("| # | Partner | You give | You get | Helps / Chance / Overall | B | g_mkt you / them | Injury-tagged players you'd get |", "|---|---|---|---|---|---|---|---|");
  r4.top.forEach((row, i) => {
    const tags = row.get.filter((name) => row.tagged[name] !== undefined).map((name) => `${name}: ${statusWords(row.tagged[name])}`);
    L.push(`| ${i + 1} | ${teamName(row.partnerId)} | ${row.give.join(" + ")} | ${row.get.join(" + ")} | ${row.helps} / ${row.chance}% (${row.label}) / ${row.overall} | ${fmt(row.b, 2)} | ${pctSigned(row.gMine)} / ${pctSigned(row.gPartner)} | ${tags.join("; ") || "–"} |`);
  });
  L.push("");
  // (b)
  const cp4 = x.cp4Trades;
  L.push(`**(b) The Checkpoint 4 model on this data**${x.opts.compare ? ` (${x.opts.compare.run.label}, code ${x.opts.compare.run.code})` : ""}:`, "");
  if (!cp4) L.push(x.opts.compare ? "The compare file has no trades." : "Not given (run with `--compare <file>`).", "");
  else {
    L.push("| # | Partner | You give | You get | Helps / Chance / Overall | B | g_mkt you / them | Injury-tagged players you'd get | Now |", "|---|---|---|---|---|---|---|---|---|");
    cp4.slice(0, TOP_DETAIL).forEach((t, i) => L.push(`| ${i + 1} | ${teamName(t.partnerId)} | ${names(s, t.give)} | ${names(s, t.get)} | ${threeNumbers(t.helps, t.pAccept, t.overall)} | ${fmt(t.b, 2)} | ${pctSigned(t.gMine)} / ${pctSigned(t.gPartner)} | ${receivedTagsText(x, t)} | ${nowFateText(x.cp4Now[i])} |`));
    L.push("", `"Now" is where the same trade stands in list (c), else what the Trade Analyzer gives it today (the current model, the same data).`, "");
  }
  // (c)
  L.push("**(c) Now:**", "");
  const cpRank = new Map((cp4 ?? []).map((t, i) => [t.key, i + 1]));
  L.push(`| # | Partner | You give | You get | Helps / Chance / Overall | B | g_mkt you / them | Injury-tagged players you'd get | In (b) |`, "|---|---|---|---|---|---|---|---|---|");
  x.nowList.slice(0, TOP_DETAIL).forEach((t, i) => L.push(`| ${i + 1} | ${teamName(t.partnerId)} | ${names(s, t.give)} | ${names(s, t.get)} | ${threeNumbers(t.helps, t.pAccept, t.overall)} | ${fmt(t.b, 2)} | ${pctSigned(t.gMine)} / ${pctSigned(t.gPartner)} | ${receivedTagsText(x, t)} | ${cp4 ? (cpRank.has(t.key) ? `#${cpRank.get(t.key)}` : "not shown") : "–"} |`));
  L.push("");
  // The facts.
  const fNow = x.facts.now;
  const fCp4 = x.facts.cp4;
  const hiddenCp4 = x.opts.compare?.run.hidden;
  const main = mainBlendRun(x);
  const fUn = main?.uncapped.facts ?? null;
  const hiddenUn = main?.uncapped.result.hidden;
  const col = (f: ListFacts | null, render: (f: ListFacts) => string) => (f ? render(f) : "–");
  const wilson = x.wilsonId ? WILSON : `${WILSON} (not in this data)`;
  L.push("| | (a) Checkpoint 4 as reported | (b) Checkpoint 4 model, this data | (c) Now | (c) Now without the given-player cap |", "|---|---|---|---|---|");
  L.push(`| Cards shown | ${r4.shown} | ${col(fCp4, (f) => String(f.shown))} | ${fNow.shown} | ${col(fUn, (f) => String(f.shown))} |`);
  L.push(`| Hidden by default: B ≤ 0 / the market guard | ${r4.hidden.byBenefit} / ${r4.hidden.byMarket} | ${hiddenCp4 ? `${hiddenCp4.byBenefit} / ${hiddenCp4.byMarket}` : "–"} | ${x.result.hidden.byBenefit} / ${x.result.hidden.byMarket} | ${hiddenUn ? `${hiddenUn.byBenefit} / ${hiddenUn.byMarket}` : "–"} |`);
  L.push(`| Top 10 that receive an injury-tagged player | ${injuredA} of 10${check === null ? " ✅" : ""} | ${col(fCp4, (f) => `${f.injuredTop} of ${f.topN}`)} | ${fNow.injuredTop} of ${fNow.topN} | ${col(fUn, (f) => `${f.injuredTop} of ${f.topN}`)} |`);
  L.push(`| All shown that receive one | – | ${col(fCp4, (f) => `${f.injuredAll} of ${f.shown}`)} | ${fNow.injuredAll} of ${fNow.shown} | ${col(fUn, (f) => `${f.injuredAll} of ${f.shown}`)} |`);
  L.push(`| ${wilson} given: top 10 / all shown | ${r4.wilsonTop} of 10 / ${r4.wilsonAll} of ${r4.shown} | ${col(fCp4, (f) => `${f.wilsonTop} of ${f.topN} / ${f.wilsonAll} of ${f.shown}`)} | ${fNow.wilsonTop} of ${fNow.topN} / ${fNow.wilsonAll} of ${fNow.shown} | ${col(fUn, (f) => `${f.wilsonTop} of ${f.topN} / ${f.wilsonAll} of ${f.shown}`)} |`);
  const boxes = (f: ListFacts | null) => (!f ? "–" : f.wilsonBoxes ? `${f.wilsonBoxes.all} (${f.wilsonBoxes.added})` : "– (no Plan B then)");
  const suggestions = (f: ListFacts | null) => (!f ? "–" : f.wilsonBoxes ? `${f.wilsonAll} + ${f.wilsonBoxes.all} = ${f.wilsonAll + f.wilsonBoxes.all}` : `${f.wilsonAll} (no Plan B then)`);
  L.push(`| Plan B boxes on the shown cards that give ${WILSON} (of them, on a card that doesn't give him) | – (no Plan B then) | ${boxes(fCp4)} | ${boxes(fNow)} | ${boxes(fUn)} |`);
  L.push(`| Suggestions on the page that sell ${WILSON}: cards + Plan B boxes | ${r4.wilsonAll} (no Plan B then) | ${suggestions(fCp4)} | ${suggestions(fNow)} | ${suggestions(fUn)} |`);
  L.push(`| Median g_mkt(you): top 10 / all shown | ${pctSigned(median(r4.top.map((r) => r.gMine)), 2)} (from the table's rounded values) / ${pctSigned(r4.medianAll)} | ${col(fCp4, (f) => `${pctSigned(f.medianTop)} / ${pctSigned(f.medianAll)}`)} | ${pctSigned(fNow.medianTop)} / ${pctSigned(fNow.medianAll)} | ${col(fUn, (f) => `${pctSigned(f.medianTop)} / ${pctSigned(f.medianAll)}`)} |`);
  L.push("");
  L.push(
    `The given-player cap (§13; planner answer 7: at most ${config.ranking.perGivenPlayerInTop20} trades in the top ${config.ranking.partnerCapTop} giving the same player of yours) holds every player of yours, ${WILSON} included, to at most ${config.ranking.perGivenPlayerInTop20} of the top ${config.ranking.partnerCapTop} by construction, so the last column searches the same context again without it (config.ranking.perGivenPlayerInTop20 set to infinity for that search, which lifts the Plan B boxes' cap too: planB.ts reads the same key): how often the model itself would still sell him. The cap counts a box only when it adds him to its card: a Plan B box that sells him is a suggestion too (section 6).`,
    "",
  );
  const why = x.wilsonWhy;
  if (fUn && fCp4 && why && why.gives > 0) {
    const wilsonPm = x.wilsonId ? x.I.model.players[x.wilsonId] : undefined;
    const bye = wilsonPm?.ros.bye.status === "upcoming" ? wilsonPm.ros.bye.week : null;
    const risky = x.I.riskyWeeks;
    const winOf = (w: number) => x.I.sim?.odds.weekly.find((wk) => wk.week === w)?.games.find((g) => g.teamId === x.I.me?.id)?.pWin ?? null;
    const covered = why.riskyCovered.map((r) => {
      const win = winOf(r.week);
      const notes = [r.week === bye ? `${WILSON}'s bye week` : null, risky.includes(r.week) ? `${risky.length === 1 ? "your only" : "a"} risky week before any trade${win !== null ? ` (${pctPlain(win, 0)} to win it)` : ""}` : null].filter((n): n is string => n !== null);
      return `${r.trades} of the ${why.gives} that give him "cover your risky week ${r.week}"${notes.length ? `, ${notes.join(" and ")}` : ""}`;
    });
    const alone = why.aloneForTwo;
    L.push(
      `**What the blend changed, and what it didn't** (without the cap, so the cap hides nothing: the last column against (b), the Checkpoint 4 model on the same data): the top 10's median g_mkt(you) went from ${pctSigned(fCp4.medianTop)} to ${pctSigned(fUn.medianTop)}, and the top 10 receiving an injury-tagged player from ${fCp4.injuredTop} to ${fUn.injuredTop}; ${WILSON} is given in ${fCp4.wilsonTop} of the top 10 then and ${fUn.wilsonTop} of ${fUn.topN} now${fUn.wilsonTop >= fCp4.wilsonTop ? ", so the blend didn't cut the Wilson sales" : ""}. ${covered.length ? `The cards' own reasons say why: ${covered.join("; ")}` : "No card that gives him names a risky week it covers"}; and ${alone.trades} of them trade him alone for two players${alone.rosIn && alone.rosOut !== null ? ` (${fmt(alone.rosIn[0], 0)}–${fmt(alone.rosIn[1], 0)} ROS points in against his ${fmt(alone.rosOut, 0)})` : ""}.`,
      "",
    );
  }
}

/** Section 3's run at the app's own blend weight (the main search), or null. */
function mainBlendRun(x: Pick<RenderInput, "blend">): BlendRun | null {
  return x.blend.find((b) => Math.abs(b.weight - config.marketBlend.weight) <= EPS) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Section 3: blend sensitivity

function blendRowText(snapshot: LeagueSnapshot, r: BlendFactRow): string {
  const ros = r.ros ? `${fmt(r.ros.ours, 0)} → ${fmt(r.ros.used, 0)} (market ${fmt(r.ros.market, 0)})` : "–";
  return `| ${playerLabel(snapshot, r.id)} | ${statusWords(r.status)} | ${valueText(r.value)}${r.fit ? "" : " (off the curve)"} | ${fmt(r.ours, 2)} / ${fmt(r.market, 2)} / ${fmt(r.used, 2)} | ${fmt(r.f, 3)} | ${ros} |`;
}

const BLEND_ROW_HEAD = ["| Player | Status | Value | Per game: ours / market / used | f | ROS points: ours → used (market) |", "|---|---|---|---|---|---|"];

function renderBlend(L: string[], x: RenderInput, teamName: (id: string) => string): void {
  const runs = x.blend;
  const own = config.marketBlend.weight;
  L.push("## 3. Blend sensitivity", "");
  L.push(
    `The planner's ask: the median g_mkt(you) of the top 10 and the top 25 at marketBlend 0, 0.25 and 0.5. Each column is the app's model searched with config.marketBlend.weight set to that weight while its context is built and searched (a fresh context each; config restored after), the default settings otherwise; ${fmt(own, 2)} is the app's weight (the main search). "Top 25" is every shown trade when fewer are shown. g_mkt(you) below 0 means you give more trade value than you get.`,
    "",
  );
  const head = runs.map((r) => `w ${fmt(r.weight, 2)}${Math.abs(r.weight - own) <= EPS ? " (the app's)" : ""}`);
  L.push(`| | ${head.join(" | ")} |`, `|---|${runs.map(() => "---").join("|")}|`);
  const row = (label: string, f: (r: BlendRun) => string) => L.push(`| ${label} | ${runs.map(f).join(" | ")} |`);
  row("Cards shown", (r) => String(r.facts.shown));
  row("Hidden: B ≤ 0 / the market guard", (r) => `${r.result.hidden.byBenefit} / ${r.result.hidden.byMarket}`);
  row("**Median g_mkt(you), top 10**", (r) => `**${pctSigned(r.facts.medianTop)}**`);
  row(`**Median g_mkt(you), top ${TOP_WIDE}**`, (r) => `**${pctSigned(r.facts.medianWide)}**${r.facts.shown < TOP_WIDE ? ` (all ${r.facts.shown})` : ""}`);
  row(`${WILSON} given: top 10 / all shown`, (r) => `${r.facts.wilsonTop} / ${r.facts.wilsonAll}`);
  row(`… and in the shown cards' Plan B boxes (of them, on a card that doesn't give him)`, (r) => (r.facts.wilsonBoxes ? `${r.facts.wilsonBoxes.all} (${r.facts.wilsonBoxes.added})` : "–"));
  row("Receive an injury-tagged player: top 10 / all shown", (r) => `${r.facts.injuredTop} / ${r.facts.injuredAll}`);
  row("The #1 trade (Helps / Chance / Overall)", (r) => {
    const t = r.result.trades[0];
    return t ? `${teamName(t.proposal.partnerId)}: ${names(x.snapshot, playerIds(t.proposal.give))} → ${names(x.snapshot, playerIds(t.proposal.get))} (${threeNumbers(t.tradeScore, t.pAccept, t.overall)})` : "–";
  });
  row("Your odds with pickups (playoffs / title)", (r) => (r.baseline ? `${pctPlain(r.baseline.pPlayoffs)} / ${pctPlain(r.baseline.pTitle)}` : "–"));
  row("*Without the given-player cap:* cards shown", (r) => String(r.uncapped.facts.shown));
  row("… median g_mkt(you), top 10 / top 25", (r) => `${pctSigned(r.uncapped.facts.medianTop)} / ${pctSigned(r.uncapped.facts.medianWide)}`);
  row(`… ${WILSON} given: top 10 / all shown`, (r) => `${r.uncapped.facts.wilsonTop} / ${r.uncapped.facts.wilsonAll}`);
  row("… receive an injury-tagged player: top 10 / all shown", (r) => `${r.uncapped.facts.injuredTop} / ${r.uncapped.facts.injuredAll}`);
  L.push("");
  L.push(`The given-player cap holds any one player of yours to at most ${config.ranking.perGivenPlayerInTop20} of the top ${config.ranking.partnerCapTop}, so the last four rows search each weight's context again without it (section 2 says how).`, "");
  const bf = x.blendFacts;
  L.push(`### The blend at w ${fmt(bf.weight, 2)}`, "");
  L.push(
    `blend.ts (§6 step 8): per game, b′ = (1 − w)·b + w·R_pos(v), with b a player's base rate (points per game when he plays) and R_pos the isotonic curve of base rates on FantasyCalc value over his position's healthy valued players (each read off the curve fitted without him, except at the ends of the value range); his weekly points and ROS scale by f = b′ / b. "Per game: ours / market / used" are b, R_pos(v) and b′; ROS points are his rest-of-season points before and after (and at the market's rate). "(off the curve)": not one of his position's curve points (an injury tag, or no game left on his NFL team's schedule), so the curve is read at his value but he doesn't shape it.`,
    "",
  );
  if (!bf.positions.length) L.push("Nothing is blended (no weight, or no list of this season's values).", "");
  else {
    L.push("| Position | Players with a real value | Curve points (healthy, a game left) | Blended |", "|---|---|---|---|");
    for (const p of bf.positions) L.push(`| ${p.pos} | ${p.players} | ${p.fit} | ${p.blended ? "yes" : `no (under ${config.marketBlend.minPlayers} curve points)`} |`);
    L.push("");
  }
  const q = bf.quantiles;
  L.push(q ? `f over the ${bf.count} players the blend reaches with a base rate above 0: min ${fmt(q.min, 3)}, 10th percentile ${fmt(q.p10, 3)}, median ${fmt(q.median, 3)}, 90th percentile ${fmt(q.p90, 3)}, max ${fmt(q.max, 3)}.` : "No player is blended.", "");
  const h = bf.byHealth;
  if (h.tagged.count && h.healthy.count) {
    const group = (g: FactorGroup) => `median f ${fmt(g.median, 3)}, mean ${fmt(g.mean, 3)}, ${g.below1} of ${g.count} (${pctPlain(g.below1 / g.count, 0)}) below 1`;
    L.push(
      `**Injured and healthy players' f** (blend.ts rule 3's ⚠️: an injured player's base rate is his full-strength rate, compared with what healthy players valued like him score, while his value is also discounted for the games he misses, so part of that discount is counted twice; a planner question): the ${h.tagged.count} injury-tagged players (any status but active): ${group(h.tagged)}; the ${h.healthy.count} healthy ones: ${group(h.healthy)}. ${h.offCurveTagged} of the ${h.offCurve} players off the curve are injury-tagged, and ${bf.extremesTagged.smallest} of the ${bf.smallest.length} smallest f below (${bf.extremesTagged.largest} of the ${bf.largest.length} largest).`,
      "",
    );
  }
  if (bf.largest.length) {
    L.push(`**The ${bf.largest.length} largest f** (the market thinks more of them than we do):`, "", ...BLEND_ROW_HEAD);
    for (const r of bf.largest) L.push(blendRowText(x.snapshot, r));
    L.push("", `**The ${bf.smallest.length} smallest f** (we think more of them than the market does):`, "", ...BLEND_ROW_HEAD);
    for (const r of bf.smallest) L.push(blendRowText(x.snapshot, r));
    L.push("");
  }
  L.push("**Named players:**", "", ...BLEND_ROW_HEAD);
  for (const n of bf.named) L.push(n.row ? blendRowText(x.snapshot, n.row) : `| ${n.name} | – | – | not blended (not in this data, no real value, or no base rate) | – | – |`);
  L.push("");
}

// ---------------------------------------------------------------------------------------------
// Section 4: odds over time

/** b − a minus d − c, per odds number: what's left of one change after another (section 4's "the rest of Phase 4"). */
function remainder(a: OddsPair | null | undefined, b: OddsPair | null | undefined, c: OddsPair | null | undefined, d: OddsPair | null | undefined): OddsPair | null {
  if (!a || !b || !c || !d) return null;
  const title = a.pTitle !== null && b.pTitle !== null && c.pTitle !== null && d.pTitle !== null ? b.pTitle - a.pTitle - (d.pTitle - c.pTitle) : null;
  return { pPlayoffs: b.pPlayoffs - a.pPlayoffs - (d.pPlayoffs - c.pPlayoffs), pTitle: title };
}
/** A change as an OddsPair from zero, printed like deltaText. */
const changeText2 = (d: OddsPair | null): string => deltaText({ pPlayoffs: 0, pTitle: d?.pTitle === null ? null : 0 }, d);

function renderOdds(L: string[], x: RenderInput, teamName: (id: string) => string): void {
  const r3 = CHECKPOINT3_REPORTED;
  const r4 = CHECKPOINT4_REPORTED;
  const c4 = x.opts.compare?.run ?? null;
  const c3 = x.opts.compare3?.run ?? null;
  const st = x.settingsRuns;
  const nowRun = st.get("now") as SettingRun;
  const odd = (key: string) => st.get(key) ?? null;
  const screen = config.simulation.screeningSims;
  const final = config.simulation.finalSims;
  L.push("## 4. Your odds over time", "");
  L.push(
    `Your playoff and title odds, P(playoffs) / P(title). **As rosters stand**: the League model's simulation (the League page's odds), every team as it is today, on seasons 1–${thousands(final)} of the seed's matrix. **With pickups**: the trade search's baseline, every team after its free-agent pickups (V*), on the search's final block, seasons ${thousands(screen + 1)}–${thousands(screen + final)} (the seasons every shown trade's numbers come from). ${thousands(final)} seasons each, the same seed.`,
    "",
  );
  const paired = x.standOnSearch;
  L.push("| When | Model | Data | As rosters stand | With pickups | The pickup baseline's effect |", "|---|---|---|---|---|---|");
  L.push(`| Checkpoint 3, as reported | ${r3.code} | ${r3.data} | ${oddsText(r3.asRostersStand)} | – | – |`);
  L.push(`| Checkpoint 4, as reported | ${r4.code} | ${r4.data} | ${oddsText(r4.asRostersStand)} | ${oddsText(r4.withPickups)} | ${deltaText(r4.asRostersStand, r4.withPickups)} (unpaired) |`);
  L.push(`| The Checkpoint 3 model | ${c3 ? c3.code : "–"} | ${c3 ? "this report's data" : "not given (--compare3)"} | ${c3 ? oddsText(c3.odds.asRostersStand) : "–"} | ${c3?.odds.withPickups ? oddsText(c3.odds.withPickups) : "–"} | ${c3?.odds.withPickups ? `${deltaText(c3.odds.asRostersStand, c3.odds.withPickups)} (unpaired)` : "–"} |`);
  L.push(`| The Checkpoint 4 model | ${c4 ? c4.code : "–"} | ${c4 ? "this report's data" : "not given (--compare)"} | ${c4 ? oddsText(c4.odds.asRostersStand) : "–"} | ${c4?.odds.withPickups ? oddsText(c4.odds.withPickups) : "–"} | ${c4?.odds.withPickups ? `${deltaText(c4.odds.asRostersStand, c4.odds.withPickups)} (unpaired)` : "–"} |`);
  L.push(`| **Now** | this code | this report's data | **${oddsText(nowRun.stand)}** | **${oddsText(nowRun.pickups)}** | ${paired ? `${deltaText(paired, nowRun.pickups)} (paired)` : `${deltaText(nowRun.stand, nowRun.pickups)} (unpaired)`} |`);
  L.push("");
  const p = nowRun.stand?.pPlayoffs;
  const noise = finite(p) ? Math.sqrt(2 * screen * p * (1 - p)) / final : Number.NaN;
  L.push(
    `The pickup baseline's effect is with pickups minus as rosters stand, in percentage points: what every team's free-agent pickups (yours and everyone else's) do to your odds. The trade search measures every trade against the odds with pickups. ${paired ? `**Now's is paired**: your odds as rosters stand priced on the search's own seasons (seasons ${thousands(screen + 1)}–${thousands(screen + final)}) are ${oddsText(paired)}, against ${oddsText(nowRun.stand)} on the League page's, so it is a common-random-numbers difference. ` : ""}The Checkpoint rows subtract the two columns as printed, from different seasons (1–${thousands(final)} against ${thousands(screen + 1)}–${thousands(screen + final)}): the ${thousands(screen)} seasons each has that the other doesn't add about ±${fmt(100 * noise)} pts (1 SD) of noise to that difference.`,
    "",
  );
  // Reading down the table: data against model (review of track R: name every cause, and only causes that can move these odds).
  const cpStream = odd("cp4-streaming");
  const cpRules = odd("cp4");
  const lines: string[] = [];
  if (c3) lines.push(`- Checkpoint 3 as reported → the Checkpoint 3 model on this data: the data alone, under Checkpoint 3's model: ${deltaText(r3.asRostersStand, c3.odds.asRostersStand)}.`);
  if (c3 && c4) {
    const streaming = cpStream && cpRules ? deltaText(cpStream.stand, cpRules.stand) : "–";
    const rest = cpStream && cpRules ? changeText2(remainder(c3.odds.asRostersStand, c4.odds.asRostersStand, cpStream.stand, cpRules.stand)) : "–";
    lines.push(`- The Checkpoint 3 model → the Checkpoint 4 model, the same data: Phase 4's model changes, ${deltaText(c3.odds.asRostersStand, c4.odds.asRostersStand)}: streaming ${streaming} (Checkpoint 4's rules without and with it, below), and the rest of Phase 4 (the Q/D/P base rate and its other changes) ${rest}, the remainder (each rounded on its own). The free-agent optimizer isn't one of them: free agents can't move the odds as rosters stand.`);
  }
  if (c4) lines.push(`- Checkpoint 4 as reported → the Checkpoint 4 model on this data: the data alone, under Checkpoint 4's model: ${deltaText(r4.asRostersStand, c4.odds.asRostersStand)} as rosters stand, ${deltaText(r4.withPickups, c4.odds.withPickups ?? null)} with pickups.`);
  if (c4) lines.push(`- The Checkpoint 4 model → now, the same data: Phase 4b's model changes, ${deltaText(c4.odds.asRostersStand, nowRun.stand)} as rosters stand, ${deltaText(c4.odds.withPickups ?? null, nowRun.pickups)} with pickups (the switches below).`);
  if (lines.length) L.push("**Reading down the table.** The reported rows ran on live data of their day, the model rows on this report's data, so moving down a column changes either the data or the model, never both:", "", ...lines, "");
  renderDataChanges(L, x, teamName);
  L.push("**What moved now's odds: the Phase 4b switches.** Each setting is today's code with some of Phase 4b's switches off: the market blend (config.marketBlend.weight 0), one free agent per team (each team's pickups on its own, Checkpoint 4's rule), IR returners (IR players never rejoin a lineup, Checkpoint 4's rule); and streaming (no team streams K, D/ST, QB or TE: your setting empty and config.streaming.detectAdds Infinity) to show its share.", "");
  L.push("| Setting | Blend | Free agents | IR returners | Streaming | As rosters stand | With pickups |", "|---|---|---|---|---|---|---|");
  for (const s of SETTINGS) {
    const r = st.get(s.key);
    if (!r) continue;
    const w = r.switches;
    L.push(`| ${r.label} | ${w.blend ? "on" : "off"} | ${w.oneTeam ? "one team each" : "each on its own"} | ${w.irReturners ? "on" : "off"} | ${w.streaming ? "on" : "off"} | ${oddsText(r.stand)} | ${oddsText(r.pickups)} |`);
  }
  L.push("");
  const both = (a: string, b: string) => {
    const ra = odd(a);
    const rb = odd(b);
    return `${deltaText(ra?.stand, rb?.stand)} | ${deltaText(ra?.pickups, rb?.pickups)}`;
  };
  L.push("Each change in percentage points, P(playoffs) / P(title):", "");
  L.push(
    "| Change | Alone, from Checkpoint 4's rules: as rosters stand | … with pickups | In sequence (blend, then free agents, then IR): as rosters stand | … with pickups | Removed alone from now: as rosters stand | … with pickups |",
    "|---|---|---|---|---|---|---|",
  );
  L.push(`| The market blend | ${both("cp4", "cp4+blend")} | ${both("cp4", "cp4+blend")} | ${both("now-blend", "now")} |`);
  L.push(`| One free agent, one team | ${both("cp4", "cp4+oneTeam")} | ${both("cp4+blend", "cp4+blend+oneTeam")} | ${both("now-oneTeam", "now")} |`);
  L.push(`| IR returners | ${both("cp4", "cp4+ir")} | ${both("cp4+blend+oneTeam", "now")} | ${both("cp4+blend+oneTeam", "now")} |`);
  L.push(`| Streaming (against no team streaming) | ${both("cp4-streaming", "cp4")} | – | – | ${both("now-streaming", "now")} |`);
  L.push(`| All three Phase 4b switches | ${both("cp4", "now")} | ${both("cp4", "now")} | – | – |`);
  L.push("");
  L.push("Free agents can't move the odds as rosters stand (no pickups there). The sequence's three steps add up to the whole change exactly; the changes alone needn't (they interact). Streaming is measured at both ends (Checkpoint 4's rules, and now): its share of the odds as they are, not a Phase 4b change.", "");
  const repro = cp4Reproduction(c4, cpRules);
  if (repro) L.push(reproductionText(repro), "");
}

/** Section 4's check that Checkpoint 4's rules in today's code are the Checkpoint 4 model (cp4Reproduction), in words. */
export function reproductionText(r: { same: boolean; stand: string; pickups: string }): string {
  return `Checkpoint 4's rules in today's code against the Checkpoint 4 model itself on the same data: ${r.stand} as rosters stand, ${r.pickups} with pickups: ${r.same ? "the switches reproduce the Checkpoint 4 model to the printed decimal ✅ (Phase 4b's other changes, the acceptance rebalance, the value floor and the cards, don't move the odds)" : "⚠️ not the same: some of Phase 4b's other changes move the odds too"}.`;
}

/** A team's data changes in words: "+A, −B; C Q → O" ("no change"). */
function teamChangeText(c: TeamDataChange | undefined): string {
  if (!c) return "–";
  const word = (s: string) => s || "active";
  const moves = [...c.joined.map((n) => `+${n}`), ...c.left.map((n) => `−${n}`)].join(", ");
  const status = c.status.map((s) => `${s.name} ${word(s.from)} → ${word(s.to)}`).join(", ");
  const record = c.record.then !== null && c.record.then !== c.record.now ? `record ${c.record.then} → ${c.record.now}` : "";
  return [moves, status, record].filter((s) => s.length > 0).join("; ") || "no change";
}

/** Section 4's "what changed in the data" (DataChanges): records, roster moves and injury news per team, and projection updates under Checkpoint 4's rules. */
function renderDataChanges(L: string[], x: RenderInput, teamName: (id: string) => string): void {
  const d = x.dataChanges;
  const r3 = CHECKPOINT3_REPORTED;
  const r4 = CHECKPOINT4_REPORTED;
  if (!d.cp3 && !d.cp4) {
    L.push(`**What changed in the data**: Checkpoint 3's and Checkpoint 4's league reports (${r3.code} and ${r4.code}:reports/league-report.md) aren't available here, so the report can't list the roster moves and injury news since then, nor check that no game was decided in between.`, "");
    return;
  }
  const same3 = recordsSame(d.cp3);
  const same4 = recordsSame(d.cp4);
  const which = [d.cp3 ? `Checkpoint 3's` : null, d.cp4 ? `Checkpoint 4's` : null].filter((s): s is string => s !== null);
  const recordLine = same3 !== false && same4 !== false ? `no fantasy game was decided in between: every team's record is the same as in ${which.join(" and ")} league report${which.length > 1 ? "s" : ""} ✅` : `⚠️ records changed (the table says which teams'): games were decided in between`;
  L.push(
    `**What changed in the data.** Roster moves, injury news and projection updates (each source's fetch time is in the header; ESPN's weekly projections come with the league data, and the base rates average them with Sleeper's): ${recordLine}, read back from the reports' own tables (${[d.cp3 ? `${r3.code}` : null, d.cp4 ? `${r4.code}` : null].filter(Boolean).join(" and ")}:reports/league-report.md). Per team, from those reports' roster tables (status: P/Q/D/O = probable/questionable/doubtful/out; IR; "active" = no tag):`,
    "",
  );
  const order = [...x.snapshot.teams].sort((a, b) => (a.id === x.snapshot.myTeamId ? -1 : b.id === x.snapshot.myTeamId ? 1 : Number(a.id) - Number(b.id) || (a.id < b.id ? -1 : 1)));
  L.push(`| Team | Since Checkpoint 3's data (${r3.data}) | Since Checkpoint 4's data (${r4.data}) | Points per week under Checkpoint 4's rules: its data → this data |`, "|---|---|---|---|");
  for (const t of order) {
    const ppw = d.ppwCp4.get(t.id);
    const ppwText = ppw && ppw.then !== null && ppw.now !== null ? `${fmt(ppw.then)} → ${fmt(ppw.now)} (${signed(ppw.now - ppw.then)})` : "–";
    L.push(`| ${teamName(t.id)} | ${d.cp3 ? teamChangeText(d.cp3.get(t.id)) : "– (report not available)"} | ${d.cp4 ? teamChangeText(d.cp4.get(t.id)) : "– (report not available)"} | ${ppwText} |`);
  }
  L.push("");
  const repro = cp4Reproduction(x.opts.compare?.run ?? null, x.settingsRuns.get("cp4") ?? null);
  const how = repro ? (repro.same ? "today's code with Checkpoint 4's rules, which reproduces the Checkpoint 4 model's odds on this data ✅ (below)" : "today's code with Checkpoint 4's rules (⚠️ which doesn't quite reproduce the Checkpoint 4 model's odds on this data, below)") : "today's code with Checkpoint 4's rules";
  L.push(
    `"Points per week under Checkpoint 4's rules" compares Checkpoint 4's league report (scenario lineups, rosters as they stand) with ${how}: one rule set on both data, so the change is the data's alone.${d.myRos.length ? ` Your players on your roster both times with no status change (so projection updates alone), the largest rest-of-season moves under those rules: ${d.myRos.map((r) => `${r.name} ${fmt(r.then)} → ${fmt(r.now)} (${signed(r.now - r.then)})`).join("; ")}.` : ""} Checkpoint 3's span isn't split this way here: the Checkpoint 3 model's per-team numbers on this data aren't in its compare file, and its points per week count week 4, which hadn't kicked off then (the lead attributes that span in the checkpoint).`,
    "",
  );
}

// ---------------------------------------------------------------------------------------------
// Section 5: one free agent, one team

function pickupsText(snapshot: LeagueSnapshot, moves: readonly FaMove[]): string {
  return moves.length ? moves.map((m) => `+${nameOf(snapshot, m.add)}${m.drop ? ` −${nameOf(snapshot, m.drop)}` : ""}`).join(", ") : "none";
}

const dupText = (snapshot: LeagueSnapshot, dups: readonly { playerId: string; teamIds: string[] }[]): string => (dups.length ? dups.map((d) => `${nameOf(snapshot, d.playerId)} (${d.teamIds.length} teams: ${d.teamIds.map((id) => `Team ${id}`).join(", ")})`).join("; ") : "none");

/** Extra pickups of the same free agent: Σ (teams − 1). */
const extraPickups = (dups: readonly { teamIds: string[] }[]): number => dups.reduce((n, d) => n + d.teamIds.length - 1, 0);

function renderAllocation(L: string[], x: RenderInput, teamName: (id: string) => string): void {
  const a = x.allocation;
  const s = x.snapshot;
  L.push("## 5. Free-agent allocation: one free agent, one team", "");
  L.push(
    `§7 (planner reply to Checkpoint 4, change 3): free agents are allocated once. Teams claim in order, each running its free-agent optimizer (at most ${config.freeAgentOptimizer.faMaxMoves} moves) against the pool minus every free agent an earlier team claimed. A trade re-optimizes only its two teams, against the pool minus every other team's claims; the earlier of the two in the order goes first.`,
    "",
  );
  L.push(a.allocation ? `**The order**, from ${allocationBasisText(a.allocation.basis)}: ${a.allocation.order.map((id) => teamName(id)).join(" > ")}.` : "**No allocation** in this model.", "");
  if (a.allocation?.basis === "waiver") {
    L.push(waiverOrderCaveat(a.allocation.order, resetWaiverOrder(x.model), x.result.myTeamId, teamName), "");
    const rr = x.resetOrder;
    if (rr) {
      const me = x.result.myTeamId;
      const place = (order: readonly string[]) => (me && order.includes(me) ? ordinal(order.indexOf(me) + 1) : "–");
      const top = (r: TradeSearchResult) => {
        const t = r.trades[0];
        return t ? `${teamName(t.proposal.partnerId)}: ${names(s, playerIds(t.proposal.give))} → ${names(s, playerIds(t.proposal.get))} (${threeNumbers(t.tradeScore, t.pAccept, t.overall)})` : "none";
      };
      const myMoves = x.I.model.teams.find((t) => t.id === me)?.faMoves ?? [];
      L.push(
        "**The same search on the weekly reset order** (every team's waiver rank set to its place in the reset order, a fresh context and the default search; what the pickups and the trades would be right after the reset):",
        "",
        `| Order | Your place | Your pickups | Your odds with pickups | Cards shown | The #1 trade | ${WILSON} given: top 10 / all shown |`,
        "|---|---|---|---|---|---|---|",
        `| The live order (this report) | ${place(rr.live)} | ${pickupsText(s, myMoves)} | ${oddsText(baselineOf(x.result))} | ${x.result.trades.length} | ${top(x.result)} | ${x.facts.now.wilsonTop} / ${x.facts.now.wilsonAll} |`,
        `| The weekly reset order | ${place(rr.order)} | ${pickupsText(s, rr.myPickups)} | ${oddsText(rr.odds)} | ${rr.result.trades.length} | ${top(rr.result)} | ${rr.facts.wilsonTop} / ${rr.facts.wilsonAll} |`,
        "",
        `${rr.overlap} of the reset order's top ${Math.min(TOP_DETAIL, rr.result.trades.length)} are in this report's top ${Math.min(TOP_DETAIL, x.result.trades.length)}; its top 3: ${rr.result.trades
          .slice(0, 3)
          .map((t, i) => `#${i + 1} ${teamName(t.proposal.partnerId)}: ${names(s, playerIds(t.proposal.give))} → ${names(s, playerIds(t.proposal.get))} (${threeNumbers(t.tradeScore, t.pAccept, t.overall)})`)
          .join("; ") || "none"}.`,
        "",
      );
    }
  }
  L.push("| Team | Pickups, one free agent per team (now) | Each team on its own (now's other rules) |", "|---|---|---|");
  for (const t of a.oneTeam) L.push(`| ${teamName(t.teamId)} | ${pickupsText(s, t.moves)} | ${pickupsText(s, a.independent.find((u) => u.teamId === t.teamId)?.moves ?? [])} |`);
  L.push("");
  const dI = a.dups.independent;
  const d1 = a.dups.oneTeam;
  const dc = a.dups.cp4;
  L.push(
    `**Free agents two or more teams pick up**: each team on its own: ${dI.length} (${extraPickups(dI)} extra pickups) — ${dupText(s, dI)}. One per team: **${d1.length}**${d1.length ? ` — ${dupText(s, d1)} ❌` : " ✅"}. ${dc ? `The Checkpoint 4 model on this data: ${dc.length} (${extraPickups(dc)} extra pickups) — ${dupText(s, dc)}.` : ""} So ${dc ? `all ${dc.length} of Checkpoint 4's duplicates` : `all ${dI.length} duplicates`} went away.`,
    "",
  );
  L.push("**Where the named free agents land:**", "", "| Free agent | One per team (now) | Each on its own (now's other rules) | The Checkpoint 4 model |", "|---|---|---|---|");
  const teamsText = (ids: readonly string[] | null) => (ids === null ? "–" : ids.length ? ids.map((id) => teamName(id)).join(", ") : "nobody");
  for (const n of a.named) L.push(`| ${n.playerId ? playerLabel(s, n.playerId) : `${n.name} (not in this data)`} | ${teamsText(n.oneTeam)} | ${teamsText(n.independent)} | ${teamsText(n.cp4)} |`);
  L.push("");
  L.push(
    `**The top ${a.trades.length} trades**: the free agents each side adds after the trade (legality's adds and its V*(after) run, tradeSides as the evaluation runs it), and whose baseline claims they were. A third team's claim is never in reach (✅ when none is taken). The partner's baseline pickup is in your reach when you're earlier in the order (you'd claim him first), or when you're right behind the partner, no team between, and the partner lets him go after the trade; yours is in the partner's reach the same way round (evaluate.ts tradeSides).`,
    "",
  );
  L.push("| # | Partner | First in the order | Your adds after the trade | Of them, the partner's baseline claims | A third team's | Partner's adds after | Of them, yours | A third team's |", "|---|---|---|---|---|---|---|---|---|");
  for (const r of a.trades) {
    if (r.illegal) {
      L.push(`| ${r.rank} | ${teamName(r.partnerId)} | – | illegal: ${r.illegal} | – | – | – | – | – |`);
      continue;
    }
    const list = (ids: readonly string[]) => (ids.length ? ids.map((id) => nameOf(s, id)).join(", ") : "none");
    const first = r.first === null ? "–" : r.first === "me" ? "you" : "they";
    L.push(`| ${r.rank} | ${teamName(r.partnerId)} | ${first}${r.between ? "" : " (no team between)"} | ${list(r.myAdds)} | ${list(r.fromPartner)} | ${r.fromThird.length ? `${list(r.fromThird)} ❌` : "none ✅"} | ${list(r.theirAdds)} | ${list(r.takesMine)} | ${r.theirFromThird.length ? `${list(r.theirFromThird)} ❌` : "none ✅"} |`);
  }
  const third = a.trades.filter((r) => r.fromThird.length || r.theirFromThird.length).length;
  const fromPartner = a.trades.filter((r) => r.fromPartner.length);
  const takesMine = a.trades.filter((r) => r.takesMine.length);
  const listNames = (ids: readonly string[]) => ids.map((id) => nameOf(s, id)).join(", ");
  const why = (rows: readonly AllocationTradeRow[], whose: "partner's" | "mine", ids: (r: AllocationTradeRow) => string[]) => rows.map((r) => `#${r.rank} ${listNames(ids(r))}: ${pickupReach(r.first, r.between, whose)}`).join("; ");
  L.push(
    "",
    `**Does any top trade still depend on a pickup another team would make first?** A third team's pickup: ${third} of ${a.trades.length} trades ${third ? "❌" : "✅"}. The partner's own baseline pickup, which you take after the trade: ${fromPartner.length} of ${a.trades.length}${fromPartner.length ? ` (${why(fromPartner, "partner's", (r) => r.fromPartner)})` : ""}. Yours, which the partner takes after the trade: ${takesMine.length} of ${a.trades.length}${takesMine.length ? ` (${why(takesMine, "mine", (r) => r.takesMine)})` : ""}.`,
    "",
  );
}

// ---------------------------------------------------------------------------------------------
// Section 6: the cards

/**
 * The most-given players in words, grouped by count, names in alphabetical order within a group: "3 each (the cap's most):
 * Bo Nix, …, Puka Nacua (7 players); then 2: Marvin Harrison Jr.; none over 3 ✅" (CardsReport.mostGiven, ties included).
 */
export function mostGivenText(snapshot: LeagueSnapshot, most: readonly { playerId: string; count: number }[], cap: number): string {
  if (!most.length) return "none";
  const counts = [...new Set(most.map((m) => m.count))].sort((a, b) => b - a);
  const groups = counts.map((n, i) => {
    const who = most
      .filter((m) => m.count === n)
      .map((m) => nameOf(snapshot, m.playerId))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const head = `${i === 0 ? "" : "then "}${n}${who.length > 1 ? " each" : ""}${n === cap ? " (the cap's most)" : ""}`;
    return `${head}: ${who.join(", ")}${who.length > 1 ? ` (${who.length} players)` : ""}`;
  });
  return `${groups.join("; ")}${most.some((m) => m.count > cap) ? " ❌ (over the cap)" : `; none over ${cap} ✅`}`;
}

function renderCards(L: string[], x: RenderInput): void {
  const c = x.cards;
  const lp = x.literalPlanB;
  const s = x.snapshot;
  const rk = config.ranking;
  L.push("## 6. Cards: Plan B, offer-first steps, injury tags, the given-player cap", "");
  L.push(
    `Planner reply to Checkpoint 4, change 6. Plan B ("If they say no, try:") shows on a card without an offer-first step: the best other exactly evaluated trade with the same partner that differs in at least one player, with B > 0, Helps you at least ${fmt(100 * config.search.planB.minHelpsShare, 0)}% of the card's and not hidden by the market guard (the planner's rules), and, ⚠️ ours, at least ${fmt(100 * config.search.steps.minAcceptGain, 0)} points likelier to go through than the card, never a trade the list shows as a card, and at most ${rk.perGivenPlayerInTop20} boxes in the top ${rk.partnerCapTop} adding the same player of yours.`,
    "",
  );
  L.push("| | Cards |", "|---|---|");
  L.push(`| Shown | ${c.shown} |`);
  L.push(`| With an offer-first step ("How to offer it") | ${c.steps} |`);
  L.push(`| With a Plan B | ${c.planB.boxes} (${c.planB.samePlayers} a different package for the same players of theirs, ${c.planB.otherTarget} a different target; ${c.planB.distinct} distinct trades) |`);
  L.push(`| With neither | ${c.shown - c.steps - c.planB.boxes} |`);
  L.push(`| With an injury tag (either side / on a player you'd get / on one you'd give) | ${c.tagged.any} / ${c.tagged.get} / ${c.tagged.give} |`);
  L.push("");
  L.push(
    `**Plan B under the planner's literal rules** (the same search with the "likelier" rule and the box cap off: TradeSearchOptions.planB): ${lp.boxes} boxes; ${lp.lessLikely} of them less likely to go through than their card, ${lp.worseOnBoth} worse on both Helps you and the chance it goes through${lp.topAdded ? `; the player of yours they add most: ${nameOf(s, lp.topAdded.playerId)}, in ${lp.topAdded.count}` : ""}.`,
    "",
  );
  L.push(
    `**The ranking's variety rules** (§13; rank.ts) left out ${c.dropped.partnerCap + c.dropped.core + c.dropped.filler + c.dropped.givenPlayer} finalists: ${c.dropped.givenPlayer} by the given-player cap (at most ${rk.perGivenPlayerInTop20} trades in the top ${rk.partnerCapTop} giving the same player of yours, planner answer 7), ${c.dropped.partnerCap} by the partner cap, ${c.dropped.core} by the core rule, ${c.dropped.filler} as filler variants.`,
    "",
  );
  L.push(`**Your players given most in the top ${c.window}** (the first ${MOST_GIVEN_SHOWN}, and everyone tied with the last of them): ${mostGivenText(s, c.mostGiven, rk.perGivenPlayerInTop20)}.`, "");
  if (c.inBoxes.length) {
    const wilson = x.wilsonId ? c.inBoxes.find((b) => b.playerId === x.wilsonId) : undefined;
    const each = c.inBoxes.map((b) => `${nameOf(s, b.playerId)} ${b.cards} card${b.cards === 1 ? "" : "s"} + ${b.boxes} box${b.boxes === 1 ? "" : "es"} (${b.added} adding him)`).join("; ");
    L.push(
      `**The cap and the Plan B boxes.** The given-player cap counts the cards, and a box only when it adds a player of yours to its card and only in the top ${rk.partnerCapTop} (search.ts), so a capped player can still be offered in boxes: the top ${rk.partnerCapTop} can show ${rk.perGivenPlayerInTop20} cards giving him, ${rk.perGivenPlayerInTop20} boxes adding him, and any number of boxes on cards that already give him.${wilson ? ` ${WILSON}: ${wilson.cards} cards and ${wilson.boxes} boxes (${wilson.added} adding him to a card that doesn't give him), so the page suggests selling him ${wilson.cards + wilson.boxes} times.` : ""} Your players in the shown cards' boxes (cards that give him + boxes that give him): ${each}.`,
      "",
    );
  }
  if (!x.result.trades.length) return;
  L.push("**Every card** (Helps you / Chance they accept / Overall; the injury tags on either side; the card's next step):", "");
  L.push("| # | Partner | You give → you get | Numbers | Injury tags | Offer-first step or Plan B |", "|---|---|---|---|---|---|");
  x.result.trades.forEach((t, i) => {
    const tags = (t.flags.tagged ?? []).map((g) => `${nameOf(s, g.playerId)} (${g.side === "get" ? "get" : "give"}): ${tagWords(x, g)}`).join("; ") || "–";
    const next = t.steps
      ? `steps: offer ${names(s, playerIds(t.steps.offerFirst.proposal.give))} first (Est. ${shownChance(t.steps.offerFirst.pAccept)}), then add ${nameOf(s, t.steps.ifNo.add)} (Est. ${shownChance(t.steps.ifNo.full.pAccept)})`
      : t.planB
        ? `Plan B (${t.planB.kind === "samePlayers" ? "same players of theirs" : "another target"}): ${names(s, playerIds(t.planB.proposal.give))} → ${names(s, playerIds(t.planB.proposal.get))} (${threeNumbers(t.planB.tradeScore, t.planB.pAccept, t.planB.overall)})`
        : "–";
    L.push(`| ${i + 1} | Team ${t.proposal.partnerId} | ${names(s, playerIds(t.proposal.give))} → ${names(s, playerIds(t.proposal.get))} | ${threeNumbers(t.tradeScore, t.pAccept, t.overall)} | ${tags} | ${next} |`);
  });
  L.push("");
}

// ---------------------------------------------------------------------------------------------
// Section 7: IR players

function dropWords(snapshot: LeagueSnapshot, d: { playerId: string; week: number; self: boolean } | null, returner: boolean): string {
  if (!returner) return "–";
  if (!d) return "nobody (room)";
  return d.self ? `releases him at week ${d.week}` : `${nameOf(snapshot, d.playerId)} from week ${d.week}`;
}

function renderIr(L: string[], x: RenderInput, teamName: (id: string) => string): void {
  const ir = x.ir;
  const s = x.snapshot;
  const last = x.inputs.nfl.lastWeek;
  L.push("## 7. IR players", "");
  L.push(
    `§6–§7, §12 (planner reply to Checkpoint 4, change 5). An IR player rejoins his team's lineups from his expected return week R (the first remaining week his chance of being back reaches ${fmt(100 * config.projections.returnWeekQuantile, 0)}%); when the active roster is full then, the lowest keep value player goes from R on. That displacement counts in final evaluations: the team as it stands (the League page and its odds) and its V*(T) (the trade baseline). IR players can be traded; a received one goes into an open IR slot when his status is one the slot takes.`,
    "",
  );
  if (!ir.rows.length) L.push("No team has a player on IR.", "");
  else {
    L.push("| Team | IR player | Status | ESPN return week | R | Rejoins | Drop at R, as the team stands | Drop at R, at V*(T) |", "|---|---|---|---|---|---|---|---|");
    for (const r of ir.rows) {
      const espn = r.espnWeek === null ? "–" : last !== undefined && r.espnWeek > last ? `${r.espnWeek} (out for the season)` : String(r.espnWeek);
      L.push(`| ${teamName(r.teamId)} | ${playerLabel(s, r.playerId)} | ${statusWords(r.status)} | ${espn} | ${r.R ?? "not back"} | ${r.returner ? "yes" : "no"} | ${dropWords(s, r.drop, r.returner)} | ${dropWords(s, r.vstarDrop, r.returner)} |`);
    }
    L.push("");
  }
  L.push("**The returners' effect on each team's points per week** (as rosters stand, scenario lineups; without returners is Checkpoint 4's rule, the other Phase 4b switches on):", "");
  L.push("| Team | Without returners | With them | Change |", "|---|---|---|---|");
  for (const p of ir.ppw) L.push(`| ${teamName(p.teamId)} | ${fmt(p.off, 2)} | ${fmt(p.on, 2)} | ${signed(p.on - p.off, 2)} |`);
  L.push("", `Your odds as rosters stand without returners ${oddsText(ir.odds.off)}, with them ${oddsText(ir.odds.on)}.`, "");
  L.push(
    `**Shown trades with an IR player** (in an IR slot, or on an active roster with a status this league's IR slot takes, irSlots.irEligibleStatuses: ${ir.eligible.join(" and ") || "none"}): ${ir.trades.length} of ${x.result.trades.length} (${ir.inTop} in the top ${TOP_DETAIL}); with a player in an IR slot, the kind Phase 4b made tradable: ${ir.inSlot}.`,
    "",
  );
  for (const t of ir.trades) {
    const who = t.ir.map((p) => `${playerLabel(s, p.playerId)} (${p.side === "give" ? "yours, given" : "theirs, received"}; ${p.slot ? "in an IR slot" : `on an active roster, status ${s.players[p.playerId]?.injury ?? "–"}`})`).join(", ");
    L.push(`- #${t.rank} with ${teamName(t.partnerId)}: ${who}; forced moves: you ${changeText(s, t.required.me)}; them ${changeText(s, t.required.partner)}.`);
  }
  if (ir.trades.length) L.push("");
  L.push(
    `**The forced moves IR players bring to the cards** (RosterChange): a received IR player put in an open IR slot on ${ir.toIR} of ${x.result.trades.length} cards; a drop from an IR player's return week that the trade brings (one the baseline at V*(T) doesn't already make) on ${ir.displaced.mine} cards on your side and ${ir.displaced.theirs} on the partner's.`,
    "",
  );
}

// ---------------------------------------------------------------------------------------------
// Section 8: consistency

function movesText(snapshot: LeagueSnapshot, moves: readonly FaStep[] | null): string {
  if (moves === null) return "(illegal)";
  if (!moves.length) return "none";
  return moves.map((m) => `add ${playerLabel(snapshot, m.add)}${m.drop ? ` for ${playerLabel(snapshot, m.drop)}` : " (open spot)"} ${signed(m.gainEv)}`).join("; ");
}

const addsOf = (moves: readonly FaStep[] | null): string[] => (moves ?? []).map((m) => m.add);

function renderConsistency(L: string[], x: RenderInput, teamName: (id: string) => string): void {
  const c = x.consistency;
  const s = x.snapshot;
  const fo = config.freeAgentOptimizer;
  L.push("## 8. Consistency: no B from free-agent pickups; a no-op moves nothing", "");
  L.push(
    `**By construction.** B compares your team before and after the trade, and both sides of that comparison are free-agent-optimized rosters (V*, §7): the baseline is every team at V*(T), one free agent per team, and every trade's "after" is legality's roster run through the same optimizer for you and for the partner (tradeSides: the earlier of the two in the order first, both against the pool minus every other team's claims), simulated on the same seasons. With availability scenarios V* picks its moves by their gain in the same scenario lineups B is measured in, so a pickup you could make anyway is made in both rosters and cancels in ΔPO and ΔCH. **The value floor** (planner reply to Checkpoint 4, change 4) closes the same gap in the market term: every package counts each player at no less than the waiver credit W, on both sides.`,
    "",
  );
  L.push(
    `**The tests.** \`src/engine/evaluate.test.ts\`, "the simulation behind B (M4)": "a no-op (my V* and the partner's unchanged) moves no odds: ΔPO = ΔCH = ΔEW = 0 exactly, at both counts" and "Checkpoint 4: a trade whose whole effect a free-agent pickup reproduces gets no B from it (ΔPO = ΔCH = 0 exactly)". \`src/engine/evaluate.consistency.test.ts\`, "Checkpoint 4 consistency in scenario lineups": "a depth pickup a trade reproduces gets no B: ΔPO = ΔCH = ΔEW = 0 exactly", with me first and with the partner first in the waiver order. \`src/engine/evaluate.addendum.test.ts\`, "the value floor at W on both sides": "a player V* drops anyway, worth less than W, given for nothing: B = 0 at Low, Medium and High". \`src/engine/evaluate.allocation.test.ts\`: the order of the two sides, and "a trade of bench players makes each side's baseline pickups again". \`src/engine/evaluate.returners.test.ts\`: "a no-op with displacements on both sides moves no odds".`,
    "",
  );
  // The no-op, measured.
  const z = x.noOp;
  const zero = (d: { dPO: number | null; dCH: number | null; dEW: number | null }) => d.dPO === 0 && (d.dCH === 0 || d.dCH === null) && d.dEW === 0;
  const allZero = z.every((r) => zero(r.screen) && zero(r.final));
  L.push(
    `**The no-op, measured.** Each shown trade's exact evaluation with your side and the partner's both put back at their baselines (V*(T), finally priced), through simulateTrade at the ${thousands(config.simulation.screeningSims)}-season block and the ${thousands(config.simulation.finalSims)}-season block: ΔPO, ΔCH and ΔEW are exactly 0 in **${z.filter((r) => zero(r.screen) && zero(r.final)).length} of ${z.length}** ${allZero ? "✅" : "❌"}.`,
    "",
  );
  // The measured bound.
  const g = x.giveAway;
  L.push(
    `**The measured bound.** V* only makes a move worth at least faMinGain (${fo.faMinGain} lineup points), so a smaller swap stays undone in the baseline; a trade that sends that player away can realize it. Measured for each of your throw-ins and each of your players worth less than W: him alone for nothing, evaluated exactly, only your side changed in the simulation (the ${thousands(config.simulation.finalSims)}-season block).`,
    "",
  );
  if (!g.length) L.push("No such player (or no odds).", "");
  else {
    const mineBefore = new Set(x.I.me?.roster ?? []);
    L.push(`| Player | Value (W ${valueText(x.I.credit)}) | Lineup cost | In shown trades | Your lineup points when he leaves | Your roster then, against your optimized one | B_win, your side | B: ${PROTECT_VALUE_LEVELS.map((v) => LEVEL_WORDS[v]).join(" / ")} |`, "|---|---|---|---|---|---|---|---|");
    for (const r of g) {
      if (r.illegal) {
        L.push(`| ${playerLabel(s, r.playerId)} | ${valueText(r.value)} | ${fmt(r.cost, 1)} | ${r.inShown} | – | ${r.illegal} | – | – |`);
        continue;
      }
      const moved = [...r.ins.map((id) => (mineBefore.has(id) ? `keeps ${nameOf(s, id)}` : `adds ${nameOf(s, id)}`)), ...r.outs.map((id) => `drops ${nameOf(s, id)}`)].join(", ") || "the same otherwise";
      L.push(`| ${playerLabel(s, r.playerId)} | ${valueText(r.value)}${r.value < x.I.credit ? " (< W)" : ""} | ${fmt(r.cost, 1)} | ${r.inShown} | ${signed(r.ros, 2)} | ${moved} | ${signed(r.bWin, 3)} | ${PROTECT_VALUE_LEVELS.map((v) => fmt(r.b[v], 3)).join(" / ")} |`);
    }
    const top = g.find((r) => finite(r.ros) && (r.ros as number) > EPS);
    L.push("", top ? `Largest: ${nameOf(s, top.playerId)}, ${signed(top.ros, 2)} lineup points when he leaves (B_win ${signed(top.bWin, 3)} from your side): ${(top.ros as number) < fo.faMinGain ? "under faMinGain, the bound ✅" : "⚠️ over faMinGain"}.` : "None of these players realizes a skipped swap when he leaves (every change ≤ 0): within the bound ✅.", "");
  }
  if (!c.rows.length) {
    L.push("No trades to re-evaluate.", "");
    return;
  }
  const same = c.rows.filter((r) => !r.differ.length).length;
  const sameB = c.planB.filter((r) => !r.differ.length).length;
  L.push(
    `**Empirically.** Each shown trade re-evaluated by analyzeTrade (the Trade Analyzer) in a fresh evaluation context (built in ${ms(c.contextMs)}; every memo empty), its numbers (${COMPARED.join(", ")}) compared with the search's bit for bit: **${same} of ${c.rows.length} match exactly** ${same === c.rows.length ? "✅" : "❌"}. Every Plan B box the same way (its ${PLAN_B_COMPARED.join(", ")}: the final block, the card's basis): **${sameB} of ${c.planB.length}** ${sameB === c.planB.length ? "✅" : "❌"}. Your pickups before any trade (V*(you)): ${movesText(s, c.myBefore)}.`,
    "",
  );
  L.push("| # | Partner | B, search | B, Analyzer | Same numbers | Your pickups after the trade | Pickups you'd make anyway (in both) | Their pickups after |", "|---|---|---|---|---|---|---|---|");
  const before = new Set(addsOf(c.myBefore));
  for (const r of c.rows) {
    const shared = addsOf(r.myAfter).filter((id) => before.has(id));
    L.push(`| ${r.rank} | ${teamName(r.partnerId)} | ${fmt(r.bSearch, 4)} | ${fmt(r.bAnalyzer, 4)} | ${r.differ.length ? `differ: ${r.differ.join(", ")}` : "yes"} | ${movesText(s, r.myAfter)} | ${shared.map((id) => nameOf(s, id)).join(", ") || "–"} | ${movesText(s, r.theirAfter)} |`);
  }
  L.push("");
}

// ---------------------------------------------------------------------------------------------
// Section 9: the anchors

function renderAnchors(L: string[], anchors: readonly AnchorRow[], premium: readonly AnchorRow[]): void {
  L.push("## 9. The acceptance anchor tests", "");
  L.push(
    `The planner's two tables (reply to Checkpoint 4, change 2), through the real functions. §11's ${anchors.length} scenarios through acceptance() (src/engine/acceptance.ts) with the default coefficients (β0 ${fmt(config.acceptance.beta.b0, 1)}, β_gain ${config.acceptance.beta.gain}, β_loss ${config.acceptance.beta.loss}, β_need ${betaNeed("redraft")} in redraft and keeper leagues and ${betaNeed("dynasty")} in dynasty leagues, β_hole ${config.acceptance.beta.hole}, β_cx ${config.acceptance.beta.complexity}, β_act ${config.acceptance.beta.activity}, β_hist ${config.acceptance.beta.history}; P_accept capped at ${pctPlain(config.acceptance.pAcceptClamp[1], 0)}): a redraft league (the last scenario a dynasty league) without trade review, a partner with no trade history and 40% playoff odds, features not named at 0, n entered as ΔLineup = n × ${config.acceptance.nScale}. Then the ${premium.length} star-premium scenarios (W = ${thousands(PREMIUM_ANCHOR_W)}): premium.eliteIds and teamPremiums give each player's e, premium.perceivedPackage the partner's g as it sees it (v′ = max(v, W) × (1 + e) on what it gives), benefit.tradePackage the market g, and acceptance() the estimate (a contender has 70% playoff odds). Each must be within ±${ANCHOR_TOLERANCE} point of the planner's value. src/engine/acceptance.test.ts runs both tables.`,
    "",
  );
  L.push("| # | Scenario | Planner (Checkpoint 4's) | Computed | Difference | Within ±0.5 | Without the star premium |", "|---|---|---|---|---|---|---|");
  const all = [...anchors, ...premium];
  all.forEach((a, i) => {
    const planner = Math.abs(a.plannerOld - a.planner) > 1e-9 ? `${fmt(a.planner)}% (${fmt(a.plannerOld)}%)` : `${fmt(a.planner)}%`;
    L.push(`| ${i + 1} | ${a.name} | ${planner} | ${fmt(a.computed, 2)}% | ${signed(a.diff, 2)} | ${mark(a.pass)} | ${fmt(a.withoutPremium, 2)}% |`);
  });
  const pass = all.filter((a) => a.pass).length;
  L.push(
    "",
    `${pass} of ${all.length} within ±${ANCHOR_TOLERANCE} (§11: ${anchors.filter((a) => a.pass).length} of ${anchors.length}; the star premium: ${premium.filter((a) => a.pass).length} of ${premium.length}).${pass === all.length ? " **Pass.** ✅" : " **FAIL.** ❌"}`,
    "",
  );
}

// ---------------------------------------------------------------------------------------------
// Section 10: runtime

const CONTEXT_STAGES: readonly [string, string][] = [
  ["league model", "League model steps 1–6 (projections and the blend, scenarios, values, streaming, the allocation and V*, IR returners, lineup costs, chips)"],
  ["baseline lineups", "baseline lineups (every team at V*, both lineup modes)"],
  ["simulation", "baseline simulation (one matrix; 1,000 and 5,000 seasons)"],
  ["profiles", "partner profiles, star premiums, hot players, urgency, risky weeks"],
  ["total", "context, total"],
];
const SEARCH_STAGES: readonly [string, string][] = [
  ["setup", "setup (pools)"],
  ["screening", "screening (every candidate, fast lineups; the dominance pruning)"],
  ["exact", "exact evaluation"],
  ["simScreen", "screening simulation (1,000 seasons each)"],
  ["simFinal", "final simulation (5,000 seasons)"],
  ["rank", "ranking and diversity"],
  ["steps", "the shown trades' offer-first steps, Plan B and words"],
  ["total", "search, total"],
];

function renderRuntime(L: string[], x: RenderInput): void {
  const r = x.runtime;
  const lr = x.leagueRuntime;
  const c = x.result.counts;
  L.push("## 10. Runtime", "");
  L.push(
    `Node ${process.version} on this machine, not the browser's Web Worker (the worker runs the same code in time slices). CLAUDE.md §12's target, 10 seconds or less, is for the worker: \`npm run check:browser\` times a full Trade Finder search there on the production build, and the checkpoint reports its numbers. **Cold** is the first run in this process (the JIT and every memo empty: a first page visit). **Warm** is the median of ${r.runs.length} timed run${r.runs.length === 1 ? "" : "s"} after ${r.warmups} warm-up${r.warmups === 1 ? "" : "s"}, each building its own League model or context. **Again** is the search run ${r.again.runs} more time${r.again.runs === 1 ? "" : "s"} on the last context, its memos warm (what a settings change costs in the Trade Finder). ${r.sameEveryRun ? "Every search, warm-ups and runs again included, returned the same trades with the same numbers (deterministic) ✅." : "**The runs did not all return the same trades.** ❌"}`,
    "",
  );
  L.push(`**The League model** (buildLeagueModel as the League page builds it: ${lr.teams} teams, ${lr.players} players, ${lr.scenarios} scenarios, ${thousands(lr.sims)} seasons):`, "");
  L.push("| Stage | Cold | Warm |", "|---|---|---|");
  for (const k of Object.keys(lr.warm)) L.push(`| ${k} | ${ms(lr.cold[k])} | ${ms(lr.warm[k])} |`);
  L.push("");
  L.push("**The trade search** (buildTradeContext, then runTradeSearch with the default settings):", "");
  L.push("| Stage | Cold | Warm | Again (same context) |", "|---|---|---|---|");
  for (const [k, label] of CONTEXT_STAGES) if (r.context[k] !== undefined) L.push(`| ${label} | ${ms(r.cold.context[k])} | ${ms(r.context[k])} | – |`);
  for (const [k, label] of SEARCH_STAGES) if (r.search[k] !== undefined) L.push(`| ${label} | ${ms(r.cold.search[k])} | ${ms(r.search[k])} | ${ms(r.again.search[k])} |`);
  L.push(`| **context + search, end to end** | **${ms(r.cold.total)}** | **${ms(r.total)}** | – |`, "");
  L.push(
    `Counts: ${thousands(c.screened)} candidates screened, ${c.exact} exactly evaluated, ${c.simScreen} simulated at ${thousands(config.simulation.screeningSims)} seasons, ${c.simFinal} at ${thousands(config.simulation.finalSims)} (the finalists; a Plan B that wasn't a finalist is simulated too, not counted here), ${x.result.trades.length} shown (${x.cards.steps} with steps, ${x.cards.planB.boxes} with a Plan B); hidden by default: ${x.result.hidden.byBenefit} for B ≤ 0, ${x.result.hidden.byMarket} by the market guard.`,
    "",
  );
  const over = r.maxGap > YIELD_GAP_DOCUMENTED_MS;
  // A stretch inside a per-trade stage is one unit of it (one exact evaluation, one simulation): its average says whether
  // the longest one is typical or a single slow one.
  const perUnit: Partial<Record<TradeSearchProgress["stage"], [number | undefined, number]>> = { exact: [r.search.exact, c.exact], simScreen: [r.search.simScreen, c.simScreen], simFinal: [r.search.simFinal, c.simFinal] };
  const stages = [...new Set(r.runs.map((run) => run.maxGapAt?.stage))];
  const unit = stages.length === 1 && stages[0] ? perUnit[stages[0]] : undefined;
  const average = unit && finite(unit[0]) && unit[1] > 0 ? (unit[0] as number) / unit[1] : null;
  L.push(
    `**The longest stretch of work between two progress yields** (the worker can stop or hand the thread back only between them): ${gapMs(r.maxGap)}, the warm median (${r.runs.map((run) => `${gapMs(run.maxGap)} in ${gapStageText(run.maxGapAt)}`).join("; ")}); cold ${gapMs(r.cold.maxGap)} in ${gapStageText(r.cold.maxGapAt)}.${average !== null ? ` One unit of that stage takes ${ms(average)} on average here (its warm median time ÷ its count), so the longest stretches are single slow ones: most likely garbage-collection pauses (⚠️ inferred: by the timed runs this process has built many contexts, now garbage).` : ""} ${over ? `⚠️ Above CLAUDE.md §12's "typically under ${YIELD_GAP_DOCUMENTED_MS} ms of work between yields" in Node (§12: a garbage-collection pause or a cold start can exceed it; a single run's longest stretch varies from run to run).` : `Within CLAUDE.md §12's "typically under ${YIELD_GAP_DOCUMENTED_MS} ms" ✅.`}`,
    "",
  );
  const times = x.consistency.rows.map((row) => row.ms);
  if (times.length) L.push(`The Trade Analyzer: analyzeTrade took ${ms(median(times))} per trade (median; max ${ms(Math.max(...times))}, its steps included) over the ${times.length} re-evaluations of section 8, in a fresh context once it was built (${ms(x.consistency.contextMs)}).`, "");
  const own = x.blend.filter((b) => Math.abs(b.weight - config.marketBlend.weight) <= EPS);
  const other = x.blend.filter((b) => Math.abs(b.weight - config.marketBlend.weight) > EPS);
  if (x.blend.length)
    L.push(
      `Section 3's runs: ${[...other.map((b) => `w ${fmt(b.weight, 2)} ${ms(b.ms)} (its own context, the search, and the search again without the given-player cap)`), ...own.map((b) => `w ${fmt(b.weight, 2)} ${ms(b.ms)} (the app's weight: only the search again without the cap, on the main context)`)].join("; ")}.`,
      "",
    );
  L.push("This report's own run (buildTradeReport, wall clock):", "", "| Stage | Time |", "|---|---|");
  for (const [k, label] of REPORT_STAGES) if (x.timing[k] !== undefined) L.push(`| ${label} | ${ms(x.timing[k])} |`);
  L.push("");
  if (x.opts.timing && Object.keys(x.opts.timing).length) {
    L.push("Before the engine (this run's data loading):", "", "| Stage | Time |", "|---|---|");
    for (const [k, val] of Object.entries(x.opts.timing)) L.push(`| ${k} | ${ms(val)} |`);
    L.push("");
  }
}

// ---------------------------------------------------------------------------------------------
// Loading (live through the app's caches, or the offline dump)

async function loadLive(argv: readonly string[], teamArg: string | undefined): Promise<{ snapshot: LeagueSnapshot; inputs: ModelInputs; now: Date; timing: Record<string, number> }> {
  const useCookies = !argv.includes("--no-cookies") && (argv.includes("--cookies") || env("USE_ENV_COOKIES") === "1");
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

/** The offline dump (git-ignored; league-report's loadDump): snapshot, inputs and the moment they're for. */
export function loadOffline(dir: string, teamArg: string | undefined): { snapshot: LeagueSnapshot; inputs: ModelInputs; now: Date; dumpedAt: string; waiverRanks: { readAt: string | null; teams: number } | null } {
  return loadDump(dir, teamArg);
}

/** The command line (the file header): the offline dump folder (null: live), the team, the compare files. */
export interface TradeReportArgs {
  offline: string | null;
  team: string | undefined;
  compare: string | null;
  compare3: string | null;
}

export function parseArgs(argv: readonly string[], root: string): TradeReportArgs {
  const file = (flag: string) => {
    const v = flagValue(argv, flag);
    return v === undefined ? null : path.resolve(root, v);
  };
  return { offline: offlineDirOf(argv, root), team: flagValue(argv, "--team"), compare: file("--compare"), compare3: file("--compare3") };
}

/** The command line the report ran with, for its header (paths relative to the project root: displayPath), so it can be run again on the same data. */
export function reportCommand(args: TradeReportArgs, root: string, argv: readonly string[] = []): string {
  const rel = (p: string | null) => (p === null ? null : displayPath(root, p));
  return commandText("trade:report", [
    args.offline ? "--offline" : null,
    rel(args.offline),
    args.team ? `--team ${args.team}` : null,
    args.compare ? `--compare ${rel(args.compare)}` : null,
    args.compare3 ? `--compare3 ${rel(args.compare3)}` : null,
    argv.includes("--cookies") ? "--cookies" : null,
    argv.includes("--no-cookies") ? "--no-cookies" : null,
  ]);
}

/**
 * A committed file's contents at a commit (`git show <commit>:<file>`, read-only: no working tree or index change), or null
 * when git or the commit isn't available. Section 4 reads Checkpoint 3's and Checkpoint 4's league reports with it.
 */
export function committedFile(root: string, commit: string, file: string): string | null {
  try {
    return execFileSync("git", ["show", `${commit}:${file}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv, ROOT);
  registerScrubber(await redactorFromMap("espn"));
  const clock = () => performance.now();
  const generatedAt = new Date();
  let loaded: { snapshot: LeagueSnapshot; inputs: ModelInputs; now: Date; timing: Record<string, number>; note: string };
  if (args.offline) {
    const o = loadOffline(args.offline, args.team);
    loaded = { ...o, timing: {}, note: dumpNote(ROOT, args.offline, o) };
  } else {
    const l = await loadLive(argv, args.team);
    loaded = { ...l, note: "Live: Parker's league through the app's public-link import and its caches (league data 10 minutes, projections 6 hours, values 24 hours)." };
  }
  const compare = args.compare ? { run: readCompare(args.compare), file: args.compare } : null;
  const compare3 = args.compare3 ? { run: readCompare(args.compare3), file: args.compare3 } : null;
  const history = { cp3: committedFile(ROOT, CHECKPOINT3_REPORTED.code, "reports/league-report.md"), cp4: committedFile(ROOT, CHECKPOINT4_REPORTED.code, "reports/league-report.md") };
  const { snapshot, inputs, now, timing, note } = loaded;
  const report = buildTradeReport(snapshot, inputs, { now, clock, mode: args.offline ? "offline" : "live", dataNote: note, generatedAt, timing, compare, compare3, history, command: reportCommand(args, ROOT, argv) });
  // Public NFL player names are kept whole: a leaguemate's first or last name can be a word of one (league-report, review PRIV-1).
  const doc = scrubEverythingExcept(report.doc, Object.values(snapshot.players).map((p) => p.name));
  writeFileSync(path.join(ROOT, "reports", "trade-report.md"), doc);
  const top = report.result.trades[0];
  const anchors = [...report.anchors, ...report.premiumAnchors];
  const f = report.facts.now;
  console.log(
    scrubEverything(
      `trade report written (${args.offline ? "offline" : "live"}) in ${ms(report.timing.total)}: ${report.result.trades.length} trades shown; search ${ms(report.runtime.search.total)} + context ${ms(report.runtime.context.total)} (warm median of ${report.runtime.runs.length}); top trade Helps you ${top?.tradeScore ?? "–"}, Overall ${top?.overall ?? "–"}; top 10: ${f.injuredTop} receive an injury-tagged player, ${f.wilsonTop} give ${WILSON}, median g_mkt(you) ${pctSigned(f.medianTop)}; Plan B ${report.cards.planB.boxes}, steps ${report.cards.steps}; anchors ${anchors.filter((a) => a.pass).length}/${anchors.length}; consistency ${report.consistency.rows.filter((r) => !r.differ.length).length}/${report.consistency.rows.length}`,
    ),
  );
}

// Run only as a script (npm run trade:report), never when a test imports the offline logic above.
const isMain = process.argv[1] !== undefined && /trade-report\.ts$/.test(process.argv[1]);
if (isMain) {
  loadEnv();
  installConsoleScrubber();
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    process.exit(1);
  });
}
