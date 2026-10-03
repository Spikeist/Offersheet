/**
 * Checkpoint 4 numbers for Parker's league (CLAUDE.md §17 "Checkpoint 4 includes"; planner reply to Checkpoint 3,
 * "Checkpoint 4 must include" and model change 2's "Checkpoint 4 must report"; the planner's addendum to Checkpoint 3,
 * §5, reports/planner-reply-3b.md; the Phase 4 addendum's lead decisions N9–N12), computed through the real trade engine
 * exactly as the Trade Finder's and the Trade Analyzer's Web Worker runs it: buildTradeContext, runTradeSearch and
 * analyzeTrade (src/engine/evaluate.ts, search.ts), explainTrade (explain.ts), acceptance (acceptance.ts), the star
 * premium (premium.ts), leagueMarginals and buildLeagueModel (league.ts), and the League page's view (src/lib/leagueView.ts).
 *
 *   npm run trade:report                      Parker's ESPN league through the public-link path and the app's caches
 *   npm run trade:report -- --team <id>       his team, when the import can't find it (no cookies)
 *   npm run trade:report -- --cookies         use the .env.local ESPN cookies (also with USE_ENV_COOKIES=1)
 *   npm run trade:report -- --offline         no network: the git-ignored dump in data-local/parker-league/
 *                                             (snapshot.json, inputs.json, meta.json; team names already
 *                                             placeholders, his team "3", the engine's `now` from meta.json)
 *
 * The report (reports/trade-report.md), each section explaining its table in words:
 * 0. Header: the data's timestamps, the settings used (defaultTradeSettings: the app's defaults), the baseline
 *    odds, and every note and warning of the inputs, the evaluation context and the search.
 * 1. Parker's top 10 trades (the app's model at the default settings): a summary table ("Harder to get" players marked),
 *    then each trade's card: the three numbers (Helps you, Chance they accept with its label, P_complete when the veto
 *    rule cuts it, Overall), B and its parts (the market term κ × clamp(g): κ the "Protect my trade value" level's, g =
 *    g_mkt(you) with each player you give counted at least at the waiver credit W, lead decision N10), ΔPPW (regular
 *    season and playoffs), ΔPO, ΔCH, ΔEW, ROS points in and out, g_mkt for both sides with its plain reading, the star
 *    premium on what the partner gives (TradeDetail.premium) and their g as they see it, the partner's n (and ΔLineup per
 *    week) and h, the forced drops and adds, the risk flags, the "Offer first / if they say no" steps, the reasons and the
 *    pitch. Reasons and pitch are worded again by explainTrade with placeholder names (ExplainContext.teamName "Team N"),
 *    so they can never carry a real team name.
 * 2. Before and after the addendum (planner-reply-3b §5; N9): the top 10 of the before-addendum variant
 *    (TradeContextOptions.beforeAddendum, N5: no star premium, κ = config.benefit.marketSanityWeight on the raw g_mkt(you),
 *    no market-term floor (N10), the get pool without the "Harder to get" split, no dominance pruning (N11), no steps)
 *    side by side with the app's, from the same run; then every trade of either top 10 in both models (analyzeTrade in the
 *    other model's context when it isn't among that model's shown trades) and what moved it. B_win is the same in both
 *    (the same lineups, seeds and seasons), so a trade's B moves only with the market term and its chance only with the
 *    star premium. Where a model didn't show a trade, the report names the stage of that model's search that dropped it
 *    (dropStage: not screened, outside the value window, pruned by N11, past a partner's best keptPerPartner or the
 *    overall exactEvaluationMax, illegal, not a finalist, hidden, a diversity rule, or below the shown ones), from each
 *    model's search re-run stage by stage with the engine's own functions (searchTrace, checked to reproduce the search
 *    exactly); for a trade a search never exactly evaluated, also where it would have ended had it been (ifEvaluated:
 *    its exact evaluation and simulations added, the rest of that search unchanged). Offline, the before variant's search
 *    is also checked against the saved pre-addendum reference (data-local/before-addendum/top25.json, when it was saved
 *    for the same dump and moment: referenceCheck, place by place; only the match is printed).
 * 3. Realism check on the shown trades (at most config.search.resultsShown): the distribution of g_mkt(partner)
 *    (REALISM_BUCKETS), min / median / max of both sides, how many ask the partner to give up more than 15% in value
 *    (⚠️ our definition, as the lead set it: g_mkt(partner) < −0.15, the partner gets back less than 85% of what it
 *    gives), how many carry "Market check" (g_mkt(me) < config.benefit.marketCheckBelow), what the value term adds
 *    to the acceptance estimate and costs B on average, and a plain verdict on lopsidedness in either direction. Then
 *    g_mkt(you) before the addendum and at Low / Medium / High (κ 2 / 4 / 8: the report's context searched once per level),
 *    the κ question's top-10 table (Σ EG = Σ B × P_complete within a level only: B holds κ × g; and the κ-free
 *    Σ B_win × P_complete across levels), the break-even κ of today's #1 against the best even trade in the list
 *    (breakEvenKappa: ⚠️ two trades only), and N11's dominance pruning (pruningCheck: the app's search's screening
 *    from its trace, the shortlist without and with it).
 * 4. The Smith-Njigba example (planner-reply-3b: "Would someone really give up Smith-Njigba for three RBs?"): his star
 *    premium, every package of STAR_PACKAGE.size of Parker's STAR_PACKAGE.pos players for him in both models (the
 *    Analyzer), the package the old model rated most likely in detail, the planner's anchor (section 8), and value-even star
 *    trades on the real rosters: STAR_TRADES (⚠️ named by the lead) and every star trade the before model showed, each
 *    with its place in both models or the stage of that model's search that dropped it (section 2's dropStage).
 * 5. "Offer first / if they say no" (planner-reply-3b §4–§5; N4): how many shown cards carry a step, and why, measured
 *    (stepsDiagnosis): every shown trade's possible steps without the search's pre-screen (case 1: each throw-in in the
 *    trade held back, the rule's the lowest-value one; case 2: each throw-in added, the rule's the best qualifying one),
 *    each version evaluated as the search evaluates it (evaluate.tradeVersion: exact evaluation + the screening
 *    simulation), both chances, the throw-ins' values against W, the change in z by part, and how often the pre-screen
 *    keeps the rule's choice.
 * 6. "Harder to get" (planner-reply-3b §2; N2, N12): FantasyCalc's top 12, every team's premium players (e, rank, top-12,
 *    the tag) as the trade context has them, and the League page's partner rows (buildLeagueView on the League model the
 *    page builds: the default settings, with odds).
 * 7. Consistency check: why no suggested trade's B comes from free-agent pickups (V* judged in scenario lineups on both
 *    sides; N10's floor), the tests that pin it, the measured bound (giveAwayCheck: each throw-in and each player worth less
 *    than W given alone for nothing, the partner left as it was: the lineup points his departure realizes and the B it
 *    gets), then every shown trade re-evaluated with analyzeTrade in a fresh context (every memo empty): B and the card's
 *    numbers must equal the search's bit for bit; each trade's pickups after the trade on both sides; and for the first
 *    trade the V* moves before and after for both teams.
 * 8. The acceptance anchors: §11's 8 (acceptance()) and the addendum's 6 (premiumAnchorRows: premium.eliteIds,
 *    teamPremiums and perceivedPackage, benefit.tradePackage and acceptance(), W = 752), each next to the planner's value
 *    and with the estimate without the star premium.
 * 9. Runtime: buildTradeContext and runTradeSearch, the median of SEARCH_RUNS runs after SEARCH_WARMUPS warm-up
 *    (each run builds its own context), per stage (the offer-first steps and words included), with the counts per stage,
 *    the longest gap between two progress yields (what the worker's slices wait on), the Analyzer's time per trade in a
 *    fresh context, and this report's own stages. Node, not the browser worker.
 * 10. One Trade Analyzer example (a trade that looks great for Parker that the model gives a low acceptance chance),
 *    found systematically (analyzerExample): every 1-for-1 and 2-for-1 between Parker's players and each partner's
 *    ANALYZER_TOP_VALUES most valuable players (perception values; P, K, D/ST and IDP left out on both sides, as the
 *    search does by default), exactly evaluated (evaluate.evaluateExact: the Analyzer's evaluation before its
 *    simulation); those with P_accept < ANALYZER_MAX_ACCEPT simulated at screeningSims seasons; the
 *    ANALYZER_FINALISTS best by that B, inside the search's value window (config.search.screeningGWindow on
 *    g_mkt(partner)) and overall, through analyzeTrade itself; the highest Trade Score inside the window is the
 *    example (ties: B, then the key). ⚠️ The window is ours: without it the winners are plain lowballs (a star for
 *    spare parts, the value term at its clamp), which says nothing new; the report names the unrestricted winner in
 *    one line. Its card, then its acceptance terms (TradeDetail.terms, logit units) in words: what pulled it down,
 *    and what the estimate would be without each. The value term's words give the trade value at market and, under a
 *    star premium, as the partner sees it (valueTermWords), next to the g the term reads.
 * 11. The free-agent optimizer items of model change 2 (league-report's optimizerReport on the context's League
 *    model and leagueMarginals, the same rules as reports/league-report.md, what V* judges its moves by included:
 *    optimizerJudging): Bo Nix → Team 1 (MV_add, chip gap), Christian McCaffrey's chip gap, each next to its Checkpoint 3
 *    number (CHECKPOINT3_OPTIMIZER) and what this run's pickups say about the change, and how many moves teams make.
 *
 * Everything after the network is buildTradeReport (pure but for the clock it is given), which
 * scripts/trade-report.test.ts runs on a synthetic league.
 *
 * Privacy (CLAUDE.md §0.5, §0.6): team, owner and league names are placeholders (league-report's placeholders())
 * before the engine runs; teams read "Team N" and Parker "Team 3 (you)"; the output is scrubbed with the .env.local
 * secrets and the ESPN redaction map, public NFL player names kept whole. Output: reports/trade-report.md and a
 * short console summary.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { importEspnLeagueForModel } from "@/adapters/espn";
import type { ImportDeps } from "@/adapters/types";
import { loadPlayerIdResolver } from "@/data";
import { acceptance, displayAcceptance, logistic, pAcceptFromLogit, type AcceptanceLeague, type AcceptanceTerms, type PartnerProfile, type TradeAcceptanceInput } from "@/engine/acceptance";
import { protectValueWeight, tradePackage } from "@/engine/benefit";
import { config } from "@/engine/config";
import {
  addCandidates,
  analyzeTrade,
  assetValue,
  buildTradeContext,
  evaluateExact,
  explainContextOf,
  legalSide,
  perceivedG,
  proposalKey,
  screenTrade,
  simulateTrade,
  stepConfig,
  throwIns,
  tradeInternals,
  tradeVersion,
  type ExactTrade,
  type Screened,
  type TeamState,
  type TradeContext,
  type TradeInternals,
  type TradeVersion,
} from "@/engine/evaluate";
import { explainTrade } from "@/engine/explain";
import type { MarketInputs, ModelInputs } from "@/engine/inputs";
import { buildLeagueModel, leagueMarginals } from "@/engine/league";
import type { FaMove, PlayerPremium } from "@/engine/leagueModel";
import type { LeagueSnapshot, Pos } from "@/engine/model";
import type { FaStep } from "@/engine/optimizer";
import { eliteIds, perceivedPackage, teamPremiums } from "@/engine/premium";
import { rankTrades, sortTrades, type RankConfig } from "@/engine/rank";
import { belowWaiverCredit, buildPools, dominancePruned, finalistsOf, partnerCandidates, runTradeSearch, shortlistOf } from "@/engine/search";
import { PROTECT_VALUE_LEVELS, defaultTradeSettings, normalizeTradeSettings, type ProtectValue, type TradeSettings } from "@/engine/settings";
import { rosValue } from "@/engine/teamValue";
import type { TradeAsset, TradeEvaluation, TradeEvaluationCore, TradeProposal, TradeSearchResult } from "@/engine/tradeModel";
import { BEST_TARGET_NOTE, buildLeagueView, type PartnerCard } from "@/lib/leagueView";
import { FileCache } from "@/server/cache";
import { createHttpClient } from "@/server/http";
import { buildModelInputs } from "@/server/modelInputs";
import { optimizerJudging, optimizerJudgingText, optimizerReport, placeholders, type OptimizerExample, type OptimizerReport } from "./league-report";
import { ROOT, env, loadEnv } from "./lib/env";
import { redactorFromMap } from "./lib/minimize";
import { installConsoleScrubber, registerScrubber, scrubEverything, scrubEverythingExcept } from "./lib/redact";

// ---------------------------------------------------------------------------------------------
// Report choices (not model tunables: nothing the engine computes depends on them)

/** Timed search runs after SEARCH_WARMUPS untimed ones (the lead's brief: the median of 3 runs after 1 warm-up). */
export const SEARCH_RUNS = 3;
export const SEARCH_WARMUPS = 1;
/** Trades shown in full (Checkpoint 4: "Parker's top 10 trades"). */
export const TOP_DETAIL = 10;
/** The Analyzer example: each partner's most valuable players tried, the acceptance bar, and the candidates analyzeTrade re-runs. */
export const ANALYZER_TOP_VALUES = 3;
export const ANALYZER_MAX_ACCEPT = 0.2;
export const ANALYZER_FINALISTS = 10;
/** "Asks the partner to give up more than 15% in value" (the realism check): g_mkt(partner) below this. */
export const PARTNER_OVERPAYS_BELOW = -0.15;
/** The κ question's "below −25%" (the addendum review's measure): g_mkt(you) below this. */
export const DEEP_OVERPAY_BELOW = -0.25;
/** The realism check's g_mkt buckets: [lo, hi) as fractions, the first and last open-ended. */
export const REALISM_BUCKETS: readonly { lo: number; hi: number }[] = [
  { lo: Number.NEGATIVE_INFINITY, hi: -0.35 },
  { lo: -0.35, hi: -0.15 },
  { lo: -0.15, hi: -0.05 },
  { lo: -0.05, hi: 0.05 },
  { lo: 0.05, hi: 0.15 },
  { lo: 0.15, hi: 0.35 },
  { lo: 0.35, hi: Number.POSITIVE_INFINITY },
];
/** The Smith-Njigba example (planner-reply-3b, Parker's question): the star, and the package of Parker's players tried for him. */
export const STAR_NAME = "Jaxon Smith-Njigba";
export const STAR_PACKAGE: { readonly pos: Pos; readonly size: number } = { pos: "RB", size: 3 };
/** ⚠️ The lead's value-even real star trades (public NFL names; a name not on these rosters any more is reported, not guessed). */
export const STAR_TRADES: readonly { readonly give: readonly string[]; readonly get: readonly string[] }[] = [
  { give: ["Brock Bowers", "Garrett Wilson"], get: ["Jaxon Smith-Njigba", "Juwan Johnson"] },
  { give: ["Brock Bowers", "Breece Hall"], get: ["Derrick Henry", "Isaiah Likely"] },
];

/**
 * §11's required anchor tests: the planner's scenarios and P_accept. Features not named are 0 (even value, a = 0, no
 * history, no hole, a 1-for-1, no season context, hot and urg 0); n enters as ΔLineup_P = n × nScale.
 */
export const ANCHORS: readonly { name: string; g?: number; n?: number; h?: 0 | 1; a?: number; c?: number; percent: number }[] = [
  { name: "Even value; n = 0.5; fills a hole; active (a = +1)", n: 0.5, h: 1, a: 1, percent: 61.1 },
  { name: "Even value; nothing else", percent: 35.4 },
  { name: "g = −0.10; n = 0.5; fills a hole", g: -0.1, n: 0.5, h: 1, percent: 31.0 },
  { name: "g = −0.20; nothing else", g: -0.2, percent: 8.3 },
  { name: "g = +0.15; n = −0.3", g: 0.15, n: -0.3, percent: 53.0 },
  { name: "Even value; inactive (a = −2)", a: -2, percent: 21.4 },
  { name: "3-for-1 (c = 2); even value", c: 2, percent: 25.0 },
  { name: "g = +0.30; n = 0.5", g: 0.3, n: 0.5, percent: 81.8 },
];
/** §11: the anchors must hold within ±1 percentage point. */
export const ANCHOR_TOLERANCE = 1;

/**
 * The star premium's anchor tests (planner addendum to Checkpoint 3, §1: default coefficients, W = 752, within ±0.5 points),
 * as src/engine/acceptance.test.ts builds them: ten players worth 9,100–10,000 plus partner A's #1 "star" (9,000) and one
 * of mine (9,000) are FantasyCalc's top 12; partner A rosters star, p2 … p7 (5,000 … 1,000), partner B "best" (5,000, not
 * top-12) and b2. A contender has 70% playoff odds, the others 40% (no season context); a = 0, no history.
 */
export const PREMIUM_ANCHORS: readonly { name: string; partner: "A" | "B"; contender: boolean; recv: readonly string[]; give: readonly string[]; n?: number; h?: 0 | 1; percent: number; plannerBefore?: number }[] = [
  { name: "1-for-1, equal raw value; partner's #1; top-12; contender; no lineup change", partner: "A", contender: true, recv: ["you9000"], give: ["star"], percent: 10.9 },
  { name: "1-for-1, equal raw value; partner's #6; not top-12", partner: "A", contender: false, recv: ["you2000"], give: ["p6"], percent: 35.4, plannerBefore: 35.4 },
  { name: "Partner gets 4,000 + 3,500 + 3,500 for their #1 top-12 player (9,000); contender; n = 0.6; fills a hole", partner: "A", contender: true, recv: ["r4000", "r3500a", "r3500b"], give: ["star"], n: 0.6, h: 1, percent: 23.4, plannerBefore: 51.3 },
  { name: "The same trade, where the RBs help them twice as much (n = 1.2)", partner: "A", contender: true, recv: ["r4000", "r3500a", "r3500b"], give: ["star"], n: 1.2, h: 1, percent: 32.8 },
  { name: "1-for-1, equal raw value; partner's #2; not top-12", partner: "A", contender: false, recv: ["you5000"], give: ["p2"], percent: 26.3 },
  { name: "1-for-1; partner's #1, not top-12; contender; partner gets 30% more raw value", partner: "B", contender: true, recv: ["you6500"], give: ["best"], percent: 62.0 },
];
/** The addendum's anchors: within ±0.5 points, with this waiver credit. */
export const PREMIUM_ANCHOR_TOLERANCE = 0.5;
export const PREMIUM_ANCHOR_W = 752;

/**
 * Checkpoint 3's numbers for model change 2's examples (section 11), with the one-move baseline the optimizer replaced.
 * Bo Nix → Team 1's +83 lineup points with Team 1's one move re-picked and +45 with it pinned (CLAUDE.md §7) came from
 * track C's test fixture with synthetic inputs, not Parker's league (final review of Checkpoint 4); on Parker's league
 * Checkpoint 3 reported at most +14.9 anywhere (Team 10) against his lineup cost of 14.1, a gap of 0.8
 * (reports/checkpoint-3.md). Christian McCaffrey's chip gap 33.1 = maxOther 124.0 to Team 2 − his cost 90.9 (Checkpoint 3's
 * league report; "McCaffrey +33" in reports/checkpoint-3.md). Report reference values, not tunables.
 */
export const CHECKPOINT3_OPTIMIZER = {
  nix: { name: "Bo Nix", teamId: "1", repicked: 83, pinned: 45, realMax: 14.9, realMaxTeamId: "10", realCost: 14.1, realGap: 0.8 },
  mccaffrey: { name: "Christian McCaffrey", gap: 33.1, maxOther: 124.0, cost: 90.9, teamId: "2" },
} as const;

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
const ms = (x: number | null | undefined): string => (!finite(x) ? "–" : x >= 1000 ? `${(x / 1000).toFixed(2)} s` : x < 10 ? `${x.toFixed(1)} ms` : `${Math.round(x)} ms`);
const thousands = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
/** "a", "a and b", "a, b and c". */
const andList = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1) as string}`);
/** A trade value: "9,912". */
const valueText = (v: number | null | undefined): string => (finite(v) ? thousands(Math.round(v)) : "–");

function median(xs: readonly number[]): number {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = s.length;
  if (!n) return Number.NaN;
  return n % 2 ? (s[(n - 1) / 2] as number) : ((s[n / 2 - 1] as number) + (s[n / 2] as number)) / 2;
}

const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : Number.NaN);

const playerIds = (xs: readonly TradeAsset[]): string[] => xs.flatMap((a) => (a.kind === "player" ? [a.id] : []));
const asPlayers = (ids: readonly string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));

/** "Garrett Wilson (WR, NYJ)": a public NFL name with his position and NFL team. */
function playerLabel(snapshot: LeagueSnapshot, id: string): string {
  const p = snapshot.players[id];
  return p ? `${p.name} (${p.pos}, ${p.nflTeam ?? "FA"})` : id;
}
const players = (snapshot: LeagueSnapshot, ids: readonly string[]): string => (ids.length ? ids.map((id) => playerLabel(snapshot, id)).join(" + ") : "nobody");
/** "Garrett Wilson": the public name alone (compact tables). */
const nameOf = (snapshot: LeagueSnapshot, id: string): string => snapshot.players[id]?.name ?? id;
const names = (snapshot: LeagueSnapshot, ids: readonly string[]): string => (ids.length ? ids.map((id) => nameOf(snapshot, id)).join(" + ") : "nobody");
/** "Team 9: Garrett Wilson + Breece Hall → Zay Flowers": a trade in one line (compact tables). */
const tradeLine = (snapshot: LeagueSnapshot, p: TradeProposal, teamName: (id: string) => string): string => `${teamName(p.partnerId)}: ${names(snapshot, playerIds(p.give))} → ${names(snapshot, playerIds(p.get))}`;

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
const shownChance = (p: number): string => `${Math.round(100 * displayAcceptance(p))}%`;

/** "Est. 80% (Likely)", and P_complete when the veto rule cuts it. */
function chanceText(t: TradeEvaluation): string {
  const shown = `Est. ${shownChance(t.pAccept)} (${t.acceptLabel})`;
  return t.detail.vetoRisk ? `${shown}; P_complete ${Math.round(100 * displayAcceptance(t.pComplete))}% (the league vote may veto: halved)` : shown;
}

/** The card's three numbers in one cell: "47 / 70% / 37" (Helps you / Chance they accept as shown / Overall). */
const threeNumbers = (t: TradeEvaluation | null): string => (t ? `${t.tradeScore ?? "–"} / ${shownChance(t.pAccept)} / ${t.overall ?? "–"}` : "–");

/** B's market term (redraft: B − B_win), or null. */
const marketTermOf = (t: TradeEvaluation | null): number | null => (t && t.lambda === null && finite(t.b) && finite(t.bWin) ? t.b - t.bWin : null);

/** Expected gain EG = B × P_complete (§13; Overall before its 0–100 scale), or null. */
const egOf = (t: TradeEvaluation): number | null => (finite(t.b) ? t.b * t.pComplete : null);

/** The names explain.ts words reasons and pitches with: placeholders only ("Team 9"). */
function placeholderWords(I: TradeInternals, t: TradeEvaluation): { reasons: string[]; pitch: string } {
  const words = explainTrade(t, { ...explainContextOf(I), teamName: (id) => `Team ${id}` });
  return { reasons: words.reasons, pitch: words.pitch };
}

/** The players of `ids` tagged "Harder to get" for their owner `teamId` (the trade context's premiums: the same in both variants' contexts). */
function taggedFor(I: TradeInternals, teamId: string, ids: readonly string[]): string[] {
  const premiums = I.premiums.get(teamId);
  return ids.filter((id) => premiums?.[id]?.harderToGet === true);
}

/** Runs a generator to its end (the search's per-partner screening). */
function drain<T>(it: Generator<void, T, void>): T {
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

// ---------------------------------------------------------------------------------------------
// Runtime (section 9) and the search the report reads

export interface RuntimeRun {
  /** buildTradeContext's own stages (TradeContext.timings: league model, baseline lineups, simulation, profiles, total). */
  context: Record<string, number>;
  /** runTradeSearch's stages (TradeSearchResult.timings: setup … rank, steps, total). */
  search: Record<string, number>;
  /** Context build plus search, wall clock. */
  total: number;
  /** The longest stretch of work between two progress yields (from the search's start to its end). */
  maxGap: number;
  /** The trades' keys and numbers: the same in every run when the search is deterministic. */
  signature: string;
}

export interface Runtime {
  runs: RuntimeRun[];
  warmups: number;
  /** Medians over the timed runs. */
  context: Record<string, number>;
  search: Record<string, number>;
  total: number;
  maxGap: number;
  /** Every run (warm-ups included) returned the same trades with the same numbers. */
  sameEveryRun: boolean;
}

export const signatureOf = (r: TradeSearchResult): string => r.trades.map((t) => `${t.key}:${t.b}:${t.pComplete}:${t.gMine}`).join("|");

function medians(rows: readonly Record<string, number>[]): Record<string, number> {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return Object.fromEntries(keys.map((k) => [k, median(rows.map((r) => r[k] ?? Number.NaN))]));
}

/** The search with default settings, `warmups` + `runs` times, each with its own context; the last run's context and result are the report's. */
export function timedSearches(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: { now: Date; clock: () => number; scenarios?: number; settings: TradeSettings; runs: number; warmups: number }): { ctx: TradeContext; result: TradeSearchResult; runtime: Runtime } {
  const { clock } = opts;
  const timed: RuntimeRun[] = [];
  const signatures: string[] = [];
  let last: { ctx: TradeContext; result: TradeSearchResult } | null = null;
  const total = Math.max(0, opts.warmups) + Math.max(1, opts.runs);
  for (let i = 0; i < total; i++) {
    const t0 = clock();
    const ctx = buildTradeContext(snapshot, inputs, { now: opts.now, clock, settings: opts.settings, ...(opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {}) });
    let mark = clock();
    let maxGap = 0;
    const result = runTradeSearch(ctx, { clock, settings: opts.settings }, () => {
      const t = clock();
      maxGap = Math.max(maxGap, t - mark);
      mark = t;
    });
    const end = clock();
    maxGap = Math.max(maxGap, end - mark);
    const signature = signatureOf(result);
    signatures.push(signature);
    if (i >= Math.max(0, opts.warmups)) timed.push({ context: { ...ctx.timings }, search: { ...result.timings }, total: end - t0, maxGap, signature });
    last = { ctx, result };
  }
  const done = last as { ctx: TradeContext; result: TradeSearchResult };
  return {
    ...done,
    runtime: {
      runs: timed,
      warmups: Math.max(0, opts.warmups),
      context: medians(timed.map((r) => r.context)),
      search: medians(timed.map((r) => r.search)),
      total: median(timed.map((r) => r.total)),
      maxGap: median(timed.map((r) => r.maxGap)),
      sameEveryRun: signatures.every((s) => s === signatures[0]),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Before and after the addendum, and the "Protect my trade value" levels (sections 2 and 3)

/** One model's search on the same data: the before-addendum variant (N5), or the app's model at a "Protect my trade value" level. */
export interface VariantRun {
  variant: "before" | ProtectValue;
  /** The market term's weight: config.benefit.marketSanityWeight before the addendum, else the level's κ. */
  kappa: number;
  ctx: TradeContext;
  result: TradeSearchResult;
  /** The settings it searched with (the Analyzer reads the same). */
  settings: TradeSettings;
  /** Wall time of this search (and of its own context when it built one), ms; NaN for the timed main search. */
  ms: number;
}

export type Variants = { before: VariantRun } & Record<ProtectValue, VariantRun>;

/**
 * The before-addendum search (its own context: TradeContextOptions.beforeAddendum) and the app's model at every "Protect my
 * trade value" level: the main search at its level, the others searched on the main context (the context reads only the
 * League model's settings; κ is per call, so the numbers equal a context built at that level: search.test.ts pins it).
 */
export function variantSearches(snapshot: LeagueSnapshot, inputs: ModelInputs, main: { ctx: TradeContext; result: TradeSearchResult }, opts: { now: Date; clock: () => number; scenarios?: number; settings: TradeSettings }): Variants {
  const { clock, settings } = opts;
  const t0 = clock();
  const beforeCtx = buildTradeContext(snapshot, inputs, { now: opts.now, settings, beforeAddendum: true, ...(opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {}) });
  const before: VariantRun = { variant: "before", kappa: config.benefit.marketSanityWeight, ctx: beforeCtx, result: runTradeSearch(beforeCtx, { settings }), settings, ms: clock() - t0 };
  const level = (v: ProtectValue): VariantRun => {
    const at = { ...settings, protectValue: v };
    if (v === settings.protectValue) return { variant: v, kappa: protectValueWeight(v), ctx: main.ctx, result: main.result, settings: at, ms: Number.NaN };
    const t = clock();
    const result = runTradeSearch(main.ctx, { settings: at });
    return { variant: v, kappa: protectValueWeight(v), ctx: main.ctx, result, settings: at, ms: clock() - t };
  };
  const levels = Object.fromEntries(PROTECT_VALUE_LEVELS.map((v) => [v, level(v)])) as Record<ProtectValue, VariantRun>;
  return { before, ...levels };
}

/**
 * A saved search to compare the before-addendum variant with: data-local/before-addendum/top25.json, the default search on
 * Parker's offline dump saved before the addendum was built (git-ignored; keys and numbers only). The report prints only
 * whether they match.
 */
export interface SearchReference {
  now?: string;
  counts: TradeSearchResult["counts"];
  hidden: TradeSearchResult["hidden"];
  trades: ({ key: string; flags: TradeEvaluation["flags"] } & Pick<TradeEvaluation, (typeof REFERENCE_FIELDS)[number]>)[];
}

/** The numbers compared with the reference, besides the key, the place and the flags. */
const REFERENCE_FIELDS = ["b", "tradeScore", "pAccept", "pComplete", "overall", "dPO", "dCH", "dPPW", "gMine", "gPartner"] as const;

export interface ReferenceCheck {
  /** Where the reference came from (a path the report prints). */
  label: string;
  /** Trades in the reference, and how many this run reproduces exactly (same place, key, numbers and flags). */
  trades: number;
  same: number;
  /** The stage counts and the hidden counts are equal. */
  counts: boolean;
  hidden: boolean;
  /** The first difference in words, or null. */
  first: string | null;
}

const sameNumber = (a: number | null, b: number | null): boolean => a === b || (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b));

/** A search's trades, counts and hidden counts against a saved reference, place by place (the file header, section 2). */
export function referenceCheck(result: TradeSearchResult, ref: SearchReference, label: string): ReferenceCheck {
  let same = 0;
  let first: string | null = null;
  const n = Math.max(ref.trades.length, result.trades.length);
  for (let i = 0; i < n; i++) {
    const r = ref.trades[i];
    const t = result.trades[i];
    if (!r || !t) {
      first ??= `#${i + 1} ${r ? "is missing in this run" : "isn't in the reference"}`;
      continue;
    }
    const flags = (Object.keys(t.flags) as (keyof TradeEvaluation["flags"])[]).filter((k) => JSON.stringify(t.flags[k]) !== JSON.stringify(r.flags?.[k]));
    const diff = t.key !== r.key ? ["the trade"] : [...REFERENCE_FIELDS.filter((k) => !sameNumber(t[k], r[k])), ...flags];
    if (diff.length) first ??= `#${i + 1}: ${diff.join(", ")}`;
    else same++;
  }
  const c = result.counts;
  const h = result.hidden;
  return {
    label,
    trades: ref.trades.length,
    same,
    counts: c.screened === ref.counts.screened && c.exact === ref.counts.exact && c.simScreen === ref.counts.simScreen && c.simFinal === ref.counts.simFinal,
    hidden: h.byBenefit === ref.hidden.byBenefit && h.byMarket === ref.hidden.byMarket,
    first,
  };
}

// ---------------------------------------------------------------------------------------------
// Where a trade left a model's search (sections 2 and 4)

/**
 * One model's search re-run stage by stage with the engine's own functions, in search.ts's order (searchTrace): the
 * pools, the screening (beams), the value window, N11's dominance pruning (the addendum's model only), each partner's
 * best keptPerPartner, the overall exactEvaluationMax, exact evaluation, the screening simulation, the finalists, the
 * final simulation and rankTrades. It keeps every stage's membership, so the report can say where a trade the search
 * didn't show left it (dropStage), and checks it reproduces the search (`matches`).
 */
export interface SearchTrace {
  I: TradeInternals;
  settings: TradeSettings;
  /** The search stopped before screening (a context note, or the pools emptied by the settings). */
  stopped: boolean;
  /** My give pool G (pools order) and each partner's get pool H. */
  give: string[];
  get: Map<string, Set<string>>;
  /** The screening per partner (pools order): every legal screen; and all of them by key. */
  perPartner: Screened[][];
  screened: Map<string, Screened>;
  /** Screens made (the search's counts.screened). */
  screens: number;
  /** In-window trades the dominance pruning drops (N11): key → my player worth less than W the leaner trade leaves out. */
  pruned: Map<string, string | null>;
  /** Each in-window trade's place in its partner's list by the screening objective: after the pruning (the search's), and without it. */
  partnerPlace: Map<string, Place>;
  partnerPlaceUnpruned: Map<string, Place>;
  /** The partners' kept trades' places over all partners (the overall cut), and the trades sent to exact evaluation, in order. */
  overallPlace: Map<string, Place>;
  shortlist: string[];
  /** Exact evaluation: the legal trades, and the illegal ones with why. */
  exact: Map<string, ExactTrade>;
  illegal: Map<string, string>;
  /** The screening simulation's numbers (every exact trade), the finalists, and the final simulation's numbers. */
  screen: Map<string, TradeEvaluationCore>;
  finalists: Set<string>;
  finals: Map<string, TradeEvaluationCore>;
  /** rankTrades on the finals: the shown trades' keys, in order. */
  shown: string[];
  /** The re-run reproduces the search: the same counts, hidden counts and shown trades in the same order. */
  matches: boolean;
}

/** A place in a list: 1 = first, of `of`. */
export interface Place {
  rank: number;
  of: number;
}

/** The screening's order (search.ts byObjective): the objective, highest first (ties within float noise), then the key. */
const byObjective = (a: Screened, b: Screened): number => (Math.abs(b.objective - a.objective) > EPS ? b.objective - a.objective : a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** Inside §12's value window on g_mkt(partner) (search.ts shortlistOf's test). */
function inValueWindow(s: Pick<Screened, "gPartner">): boolean {
  const [gLo, gHi] = config.search.screeningGWindow;
  return Number.isFinite(s.gPartner) && s.gPartner >= gLo - EPS && s.gPartner <= gHi + EPS;
}

/** A core without words, as search.ts hands it to rankTrades (the words never change the order). */
const bare = (core: TradeEvaluationCore): TradeEvaluation => ({ ...core, reasons: [], pitch: "" });

/** §13's ranking numbers (rank.ts's defaults), with `resultsShown` changed when asked. */
function rankConfig(resultsShown: number = config.search.resultsShown): RankConfig {
  return { perPartnerInTop20: config.ranking.perPartnerInTop20, partnerCapTop: config.ranking.partnerCapTop, perCore: config.ranking.perCore, fillerCutoffFraction: config.ranking.fillerCutoffFraction, resultsShown, marketHideBelow: config.benefit.marketHideBelow };
}

/** The ranking that picks the finalists (search.ts finalistsOf): §13's caps relaxed by one, config.search.finalists places. */
function finalistConfig(): RankConfig {
  return { ...rankConfig(Math.max(0, Math.floor(config.search.finalists))), perPartnerInTop20: config.ranking.perPartnerInTop20 + 1, perCore: config.ranking.perCore + 1 };
}

/** A trade's core as rank.ts reads it (the highest-value player on each side; ties: the smaller id), for the words only. */
function coreOf(proposal: TradeProposal, value: (asset: TradeAsset) => number): { give: string | null; get: string | null } {
  const best = (xs: readonly TradeAsset[]) => {
    let id: string | null = null;
    let v = Number.NEGATIVE_INFINITY;
    for (const a of xs) {
      if (a.kind !== "player") continue;
      const x = value(a);
      const w = Number.isFinite(x) ? x : Number.NEGATIVE_INFINITY;
      if (id === null || w > v || (w === v && a.id < id)) {
        id = a.id;
        v = w;
      }
    }
    return id;
  };
  return { give: best(proposal.give), get: best(proposal.get) };
}

/** Expected gain at a stage's numbers (B × P_complete; −∞ without B), as finalistsOf ranks the others. */
const egCore = (c: TradeEvaluationCore): number => (finite(c.b) ? c.b * c.pComplete : Number.NEGATIVE_INFINITY);

/** A trade's place among cores by expected gain (ties: the key), as finalistsOf fills its last places. */
function egPlace(cores: readonly TradeEvaluationCore[], key: string): Place {
  const sorted = [...cores].sort((a, b) => (Math.abs(egCore(b) - egCore(a)) > EPS ? egCore(b) - egCore(a) : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { rank: sorted.findIndex((c) => c.key === key) + 1, of: sorted.length };
}

/** The search's stages re-run on its context (SearchTrace); `result` is the search to check it against. */
export function searchTrace(ctx: TradeContext, settings: TradeSettings, result: TradeSearchResult): SearchTrace {
  const I = tradeInternals(ctx);
  const s = normalizeTradeSettings(settings);
  const trace: SearchTrace = { I, settings: s, stopped: true, give: [], get: new Map(), perPartner: [], screened: new Map(), screens: 0, pruned: new Map(), partnerPlace: new Map(), partnerPlaceUnpruned: new Map(), overallPlace: new Map(), shortlist: [], exact: new Map(), illegal: new Map(), screen: new Map(), finalists: new Set(), finals: new Map(), shown: [], matches: false };
  const pools = I.blocked || !I.me ? null : buildPools(I, s, null);
  if (!pools || pools.stop) return { ...trace, matches: result.trades.length === 0 && result.counts.screened === 0 };
  trace.stopped = false;
  trace.give = [...pools.give];
  for (const [id, h] of pools.get) trace.get.set(id, new Set(h.pool));

  // Screening: the beams per partner.
  const tally = { screened: 0 };
  trace.perPartner = pools.partners.map((p) => {
    const H = pools.get.get(p.id) ?? { pool: [], forced: [] };
    return drain(partnerCandidates(I, p, { give: pools.give, forcedGive: pools.forcedGive, get: H.pool, forcedGet: H.forced }, s.maxPerSide, tally));
  });
  trace.screens = tally.screened;
  for (const list of trace.perPartner) for (const x of list) trace.screened.set(x.key, x);

  // The value window, the pruning (N11, only in the addendum's model) and each partner's best keptPerPartner.
  const cheap = I.beforeAddendum ? null : belowWaiverCredit(I);
  const keptPerPartner = Math.max(0, Math.floor(config.search.keptPerPartner));
  const kept: Screened[] = [];
  for (const list of trace.perPartner) {
    const inWindow = list.filter(inValueWindow);
    const survivors = cheap ? dominancePruned(inWindow, cheap) : inWindow;
    const alive = new Set(survivors.map((x) => x.key));
    const byKeyOf = new Map(inWindow.map((x) => [x.key, x]));
    for (const x of inWindow) {
      if (alive.has(x.key)) continue;
      // The player the leaner trade leaves out (dominancePruned's test, for the words only).
      const player = x.give.find((id) => (cheap as (id: string) => boolean)(id) && (byKeyOf.get(proposalKey({ partnerId: x.partnerId, give: asPlayers(x.give.filter((g) => g !== id)), get: asPlayers(x.get) }))?.objective ?? Number.NEGATIVE_INFINITY) >= x.objective - EPS);
      trace.pruned.set(x.key, player ?? null);
    }
    const sorted = [...survivors].sort(byObjective);
    sorted.forEach((x, i) => trace.partnerPlace.set(x.key, { rank: i + 1, of: sorted.length }));
    const all = [...inWindow].sort(byObjective);
    all.forEach((x, i) => trace.partnerPlaceUnpruned.set(x.key, { rank: i + 1, of: all.length }));
    kept.push(...sorted.slice(0, keptPerPartner));
  }
  const overall = kept.sort(byObjective);
  overall.forEach((x, i) => trace.overallPlace.set(x.key, { rank: i + 1, of: overall.length }));
  // The shortlist is the engine's own (shortlistOf); the places above must agree with it (checked in `matches`).
  trace.shortlist = shortlistOf(trace.perPartner, cheap).map((x) => x.key);
  const sameShortlist = trace.shortlist.join("\n") === overall.slice(0, Math.max(0, Math.floor(config.search.exactEvaluationMax))).map((x) => x.key).join("\n");

  // Exact evaluation, the screening simulation, the finalists, the final simulation, the ranking.
  for (const key of trace.shortlist) {
    const x = trace.screened.get(key) as Screened;
    const r = evaluateExact(I, { partnerId: x.partnerId, give: asPlayers(x.give), get: asPlayers(x.get) }, s.maxPerSide);
    if ("illegal" in r) trace.illegal.set(key, r.illegal);
    else trace.exact.set(key, r);
  }
  for (const [key, x] of trace.exact) trace.screen.set(key, simulateTrade(I, x, "screen", s.lambda, s.protectValue));
  const value = assetValue(I);
  const fin = finalistsOf([...trace.screen.values()], value);
  trace.finalists = fin.keys;
  for (const key of trace.shortlist) if (fin.keys.has(key)) trace.finals.set(key, simulateTrade(I, trace.exact.get(key) as ExactTrade, "final", s.lambda, s.protectValue));
  const ranked = rankTrades([...trace.finals.values()].map(bare), value);
  trace.shown = ranked.trades.map((t) => t.key);
  const c = result.counts;
  trace.matches =
    sameShortlist &&
    trace.screens === c.screened &&
    trace.exact.size === c.exact &&
    trace.screen.size === c.simScreen &&
    trace.finals.size === c.simFinal &&
    trace.shown.join("\n") === result.trades.map((t) => t.key).join("\n") &&
    ranked.hidden.byBenefit + fin.hidden.byBenefit === result.hidden.byBenefit &&
    ranked.hidden.byMarket + fin.hidden.byMarket === result.hidden.byMarket;
  return trace;
}

/** A diversity rule of §13's ranking (rank.ts): a filler variant, the per-core cap, or the per-partner cap in the top 20. */
export type DiversityRule = "filler" | "core" | "partnerCap";

/** Where a trade ended in a ranking (rankFate): shown, hidden by default, dropped by a diversity rule, or below the shown ones. */
export type RankFate =
  | { kind: "shown"; place: number }
  | { kind: "hidden"; why: "benefit" | "market" }
  /** `core`: the core it shares with the trades kept above it (the core rule only). */
  | { kind: "diversity"; rule: DiversityRule; core: { give: string | null; get: string | null } | null }
  /** Past the last shown trade: never reached; `place` is where it would come with room for every trade (null: a diversity rule would drop it even then). */
  | { kind: "lowerOverall"; place: number | null };

/** Where a trade left one model's search (dropStage; the stages of search.ts in order), or where it was shown. */
export type DropStage =
  | RankFate
  /** Never screened: the search stopped, a side has more than maxPerSide players, a player isn't in the pools, screening's roster rules reject it, or the beams never built it. */
  | { kind: "notScreened"; why: "stopped" | "size" | "pools" | "rules" | "beams"; missingGive: string[]; missingGet: string[] }
  | { kind: "window"; g: number }
  /** N11: the same trade without `player` (mine, worth less than W) screened at least as well. */
  | { kind: "pruned"; player: string | null }
  /** Past its partner's best keptPerPartner (`unpruned`: its place without N11's pruning, in the addendum's model). */
  | { kind: "partnerCut"; place: Place; unpruned: Place | null }
  | { kind: "overallCut"; place: Place }
  | { kind: "illegal"; reason: string }
  /**
   * Exactly evaluated, not a finalist: hidden at the screening simulation's numbers, else left out of the finalists'
   * ranking (search.ts finalistsOf: §13's caps relaxed by one) by `rule`, or below its places (`rule` null). `place`: its
   * expected gain's place among the exact trades at the screening simulation.
   */
  | { kind: "notFinalist"; hidden: "benefit" | "market" | null; rule: DiversityRule | null; place: Place };

/** The stages before exact evaluation: such a trade's numbers come from the Trade Analyzer only. */
export const PRE_EXACT: ReadonlySet<DropStage["kind"]> = new Set(["notScreened", "window", "pruned", "partnerCut", "overallCut"]);

/**
 * Where a trade ended in rankTrades on `evaluated` with `cfg` (§13; default the shown ranking's; RankFate). For a trade
 * not kept and not hidden, the rule that dropped it comes from rankTrades itself, on the trades kept above it and it
 * alone: the kept trades are judged exactly as in the full ranking (a dropped trade never changes what is kept), so it
 * meets the same kept set.
 */
export function rankFate(evaluated: readonly TradeEvaluationCore[], key: string, value: (asset: TradeAsset) => number, cfg: RankConfig = rankConfig()): RankFate {
  const evals = evaluated.map(bare);
  const ranked = rankTrades(evals, value, cfg);
  const at = ranked.trades.findIndex((t) => t.key === key);
  if (at >= 0) return { kind: "shown", place: at + 1 };
  const t = evals.find((e) => e.key === key);
  if (!t || !(finite(t.b) && t.b > 0)) return { kind: "hidden", why: "benefit" };
  if (t.gMine < cfg.marketHideBelow) return { kind: "hidden", why: "market" };
  const order = sortTrades(
    evals.filter((e) => e.illegal === null && finite(e.b) && e.b > 0 && !(e.gMine < cfg.marketHideBelow)),
    "overall",
  );
  const kept = new Set(ranked.trades.map((k) => k.key));
  const pos = order.findIndex((e) => e.key === key);
  const last = ranked.trades.at(-1);
  const lastPos = last ? order.findIndex((e) => e.key === last.key) : -1;
  if (ranked.trades.length >= Math.floor(cfg.resultsShown) && pos > lastPos) {
    const more = rankTrades(evals, value, { ...cfg, resultsShown: evals.length });
    const k = more.trades.findIndex((e) => e.key === key);
    return { kind: "lowerOverall", place: k >= 0 ? k + 1 : null };
  }
  const above = order.slice(0, Math.max(0, pos)).filter((e) => kept.has(e.key));
  const r = rankTrades([...above, t], value, cfg);
  const rule: DiversityRule = r.dropped.filler > 0 ? "filler" : r.dropped.core > 0 ? "core" : "partnerCap";
  return { kind: "diversity", rule, core: rule === "core" ? coreOf(t.proposal, value) : null };
}

/** Why an exact trade isn't among the finalists (search.ts finalistsOf), as DropStage's notFinalist. */
function notFinalist(cores: readonly TradeEvaluationCore[], key: string, value: (asset: TradeAsset) => number): DropStage {
  const c = cores.find((x) => x.key === key) as TradeEvaluationCore;
  const hidden = !(finite(c.b) && c.b > 0) ? "benefit" : c.flags.hiddenByMarket ? "market" : null;
  const pre = hidden ? null : rankFate(cores, key, value, finalistConfig());
  return { kind: "notFinalist", hidden, rule: pre?.kind === "diversity" ? pre.rule : null, place: egPlace(cores, key) };
}

/** Where a trade left the traced model's search (DropStage), stage by stage. */
export function dropStage(tr: SearchTrace, proposal: TradeProposal): DropStage {
  const key = proposalKey(proposal);
  const shownAt = tr.shown.indexOf(key);
  if (shownAt >= 0) return { kind: "shown", place: shownAt + 1 };
  const give = playerIds(proposal.give);
  const get = playerIds(proposal.get);
  const sc = tr.screened.get(key);
  if (!sc) {
    const none = { missingGive: [] as string[], missingGet: [] as string[] };
    if (tr.stopped) return { kind: "notScreened", why: "stopped", ...none };
    if (give.length > tr.settings.maxPerSide || get.length > tr.settings.maxPerSide) return { kind: "notScreened", why: "size", ...none };
    const pool = tr.get.get(proposal.partnerId);
    const missingGive = give.filter((id) => !tr.give.includes(id));
    const missingGet = get.filter((id) => !pool?.has(id));
    if (missingGive.length || missingGet.length) return { kind: "notScreened", why: "pools", missingGive, missingGet };
    const partner = tr.I.byId.get(proposal.partnerId);
    if (!partner || !screenTrade(tr.I, partner, give, get)) return { kind: "notScreened", why: "rules", ...none };
    return { kind: "notScreened", why: "beams", ...none };
  }
  if (!inValueWindow(sc)) return { kind: "window", g: sc.gPartner };
  if (tr.pruned.has(key)) return { kind: "pruned", player: tr.pruned.get(key) ?? null };
  const place = tr.partnerPlace.get(key) as Place;
  if (place.rank > Math.floor(config.search.keptPerPartner)) return { kind: "partnerCut", place, unpruned: tr.I.beforeAddendum ? null : (tr.partnerPlaceUnpruned.get(key) ?? null) };
  if (!tr.shortlist.includes(key)) return { kind: "overallCut", place: tr.overallPlace.get(key) as Place };
  const illegal = tr.illegal.get(key);
  if (illegal !== undefined) return { kind: "illegal", reason: illegal };
  if (!tr.finalists.has(key)) return notFinalist([...tr.screen.values()], key, assetValue(tr.I));
  return rankFate([...tr.finals.values()], key, assetValue(tr.I));
}

/**
 * The counterfactual for a trade the traced search never exactly evaluated: where it would have ended had the search
 * exactly evaluated it too, with the rest of the search unchanged (its screening simulation, then the finalists picked
 * again with it among them, the final simulation of those, and the ranking). Exact: the same functions on the same
 * seasons, so its numbers are the Trade Analyzer's.
 */
export function ifEvaluated(tr: SearchTrace, proposal: TradeProposal): DropStage {
  const { I, settings: s } = tr;
  const x = evaluateExact(I, proposal, s.maxPerSide);
  if ("illegal" in x) return { kind: "illegal", reason: x.illegal };
  const key = x.evaluation.key;
  const cores = [...[...tr.screen.values()].filter((c) => c.key !== key), simulateTrade(I, x, "screen", s.lambda, s.protectValue)];
  const value = assetValue(I);
  const fin = finalistsOf(cores, value);
  if (!fin.keys.has(key)) return notFinalist(cores, key, value);
  const finals = [...fin.keys].map((k) => (k === key ? simulateTrade(I, x, "final", s.lambda, s.protectValue) : (tr.finals.get(k) ?? simulateTrade(I, tr.exact.get(k) as ExactTrade, "final", s.lambda, s.protectValue))));
  return rankFate(finals, key, value);
}

/** A trade in one model: its place among that model's shown trades (1 = first; null: not shown) and its evaluation there. */
export interface ModelSide {
  rank: number | null;
  /** The search's evaluation when shown, else analyzeTrade's in that model's context (null when it can't be evaluated there). */
  t: TradeEvaluation | null;
  /** Where it left that model's search (dropStage on its trace), or where it was shown. */
  stage: DropStage;
  /** A trade that model's search never exactly evaluated: where it would have ended had it been (ifEvaluated); else null. */
  ifEvaluated: DropStage | null;
}

export interface CompareRow {
  key: string;
  proposal: TradeProposal;
  before: ModelSide;
  after: ModelSide;
}

/**
 * Every trade in either model's top `top`, the after list's first, with its numbers in both models and, where a model
 * didn't show it, the stage of that model's search that dropped it (the file header, section 2).
 */
export function compareTop(before: VariantRun, after: VariantRun, traces: { before: SearchTrace; after: SearchTrace }, top = TOP_DETAIL): CompareRow[] {
  const index = (r: TradeSearchResult) => new Map(r.trades.map((t, i) => [t.key, { rank: i + 1, t }]));
  const inBefore = index(before.result);
  const inAfter = index(after.result);
  const side = (run: VariantRun, tr: SearchTrace, m: Map<string, { rank: number; t: TradeEvaluation }>, p: TradeProposal, key: string): ModelSide => {
    const hit = m.get(key);
    if (hit) return { rank: hit.rank, t: hit.t, stage: { kind: "shown", place: hit.rank }, ifEvaluated: null };
    const stage = dropStage(tr, p);
    return { rank: null, t: analyzeTrade(run.ctx, p, { settings: run.settings }).evaluation, stage, ifEvaluated: PRE_EXACT.has(stage.kind) ? ifEvaluated(tr, p) : null };
  };
  const rows: CompareRow[] = [];
  const seen = new Set<string>();
  for (const t of [...after.result.trades.slice(0, top), ...before.result.trades.slice(0, top)]) {
    if (seen.has(t.key)) continue;
    seen.add(t.key);
    rows.push({ key: t.key, proposal: t.proposal, before: side(before, traces.before, inBefore, t.proposal, t.key), after: side(after, traces.after, inAfter, t.proposal, t.key) });
  }
  return rows;
}

/** g_mkt(you) of a search's shown trades (planner-reply-3b §5; the κ question). */
export interface GMineStats {
  trades: number;
  /** Trades per REALISM_BUCKETS bucket. */
  buckets: number[];
  min: number;
  median: number;
  max: number;
  /** flags.marketCheck (g_mkt(you) < config.benefit.marketCheckBelow). */
  marketCheck: number;
  /** g_mkt(you) < DEEP_OVERPAY_BELOW. */
  deep: number;
  /** The same for the first `top` trades. */
  top: { trades: number; median: number; marketCheck: number; deep: number };
  hidden: { byBenefit: number; byMarket: number };
  /** Σ B × P_complete over the shown trades (Overall's expected gain before its 0–100 scale). B holds κ × g, so it isn't comparable across κ levels. */
  eg: number;
  /** Σ (B − the market term) × P_complete: the κ-free part (B_win in redraft leagues; dynasty and keeper B has no market term), comparable across levels. */
  egKappaFree: number;
}

export function gMineStats(result: TradeSearchResult, top = TOP_DETAIL): GMineStats {
  const trades = result.trades;
  const gm = trades.map((t) => t.gMine);
  const buckets = new Array<number>(REALISM_BUCKETS.length).fill(0);
  for (const g of gm) {
    const k = bucketOf(g);
    if (k >= 0) buckets[k] = (buckets[k] ?? 0) + 1;
  }
  const head = trades.slice(0, top);
  return {
    trades: trades.length,
    buckets,
    min: gm.length ? Math.min(...gm) : Number.NaN,
    median: median(gm),
    max: gm.length ? Math.max(...gm) : Number.NaN,
    marketCheck: trades.filter((t) => t.flags.marketCheck).length,
    deep: gm.filter((g) => g < DEEP_OVERPAY_BELOW).length,
    top: { trades: head.length, median: median(head.map((t) => t.gMine)), marketCheck: head.filter((t) => t.flags.marketCheck).length, deep: head.filter((t) => t.gMine < DEEP_OVERPAY_BELOW).length },
    hidden: { ...result.hidden },
    eg: trades.reduce((s, t) => s + (egOf(t) ?? 0), 0),
    egKappaFree: trades.reduce((s, t) => s + (finite(t.b) ? (t.b - (marketTermOf(t) ?? 0)) * t.pComplete : 0), 0),
  };
}

/** Today's #1 against the best even trade in the list: the κ at which their EG = B × P_complete are equal (the κ question). */
export interface BreakEven {
  first: TradeEvaluation;
  even: TradeEvaluation;
  /** The even trade's place in the list (1 = first). */
  evenRank: number;
  /** κ where the two EG are equal (B_win and the chance they accept don't move with κ); null when the lines never cross at κ ≥ 0. */
  kappa: number | null;
}

/**
 * ⚠️ A two-trade reading for the planner's κ question: today's #1 (when its trade value isn't even) against the best trade
 * by EG whose g_mkt(you) is within config.explain.valueEven of even. Each trade's market term is κ × m with m = (B −
 * B_win) / κ (the clamped g its term reads), so EG(κ′) = (B_win + κ′ m) × P_complete; the crossing is κ* = (B_win2 P2 −
 * B_win1 P1) / (m1 P1 − m2 P2). Redraft leagues only (dynasty and keeper B has no market term); null otherwise.
 */
export function breakEvenKappa(trades: readonly TradeEvaluation[], kappa: number): BreakEven | null {
  const first = trades[0];
  const term = (t: TradeEvaluation) => marketTermOf(t);
  if (!first || term(first) === null || !(kappa > 0) || Math.abs(first.gMine) < config.explain.valueEven) return null;
  let best: { t: TradeEvaluation; rank: number } | null = null;
  trades.forEach((t, i) => {
    if (i === 0 || term(t) === null || Math.abs(t.gMine) >= config.explain.valueEven) return;
    if (!best || (egOf(t) ?? Number.NEGATIVE_INFINITY) > (egOf(best.t) ?? Number.NEGATIVE_INFINITY)) best = { t, rank: i + 1 };
  });
  const even = best as { t: TradeEvaluation; rank: number } | null;
  if (!even) return null;
  const m1 = (term(first) as number) / kappa;
  const m2 = (term(even.t) as number) / kappa;
  const p1 = first.pComplete;
  const p2 = even.t.pComplete;
  const num = (even.t.bWin as number) * p2 - (first.bWin as number) * p1;
  const den = m1 * p1 - m2 * p2;
  const k = den !== 0 ? num / den : Number.NaN;
  return { first, even: even.t, evenRank: even.rank, kappa: Number.isFinite(k) && k >= 0 ? k : null };
}

/** N11's dominance pruning measured (the file header, section 3): the screening run again, the shortlist without and with it. */
export interface PruningCheck {
  /** Screens (equals the search's counts.screened), and the screened trades inside the value window (§12). */
  screened: number;
  inWindow: number;
  /** In-window trades the pruning drops. */
  dropped: number;
  /** The trades for exact evaluation without and with the pruning, and how many of them give a player of yours worth less than W. */
  exact: { without: number; with: number };
  cheap: { without: number; with: number };
  /** The keys of the trades sent to exact evaluation with the pruning (the search's own shortlist). */
  shortlist: string[];
  /** Your give pool G, and its players worth less than W. */
  give: string[];
  belowW: string[];
  W: number;
}

/** The search's screening (the app's model's trace: pools and beams run again), then the shortlist without and with the pruning; null when the search stops. */
export function pruningCheck(tr: SearchTrace): PruningCheck | null {
  if (tr.stopped) return null;
  const I = tr.I;
  const cheap = belowWaiverCredit(I);
  // The value window as shortlistOf applies it.
  const windowed = tr.perPartner.map((list) => list.filter(inValueWindow));
  const inWindow = windowed.reduce((n, l) => n + l.length, 0);
  const kept = windowed.reduce((n, l) => n + dominancePruned(l, cheap).length, 0);
  const without = shortlistOf(tr.perPartner, null);
  const withIt = shortlistOf(tr.perPartner, cheap);
  const givesCheap = (s: Screened) => s.give.some(cheap);
  return {
    screened: tr.screens,
    inWindow,
    dropped: inWindow - kept,
    exact: { without: without.length, with: withIt.length },
    cheap: { without: without.filter(givesCheap).length, with: withIt.filter(givesCheap).length },
    shortlist: withIt.map((s) => s.key),
    give: [...tr.give],
    belowW: tr.give.filter(cheap),
    W: I.credit,
  };
}

// ---------------------------------------------------------------------------------------------
// Realism (section 3)

export interface Realism {
  trades: number;
  /** Trades per REALISM_BUCKETS bucket, by g_mkt(partner) and by g_mkt(me). */
  partnerBuckets: number[];
  mineBuckets: number[];
  partner: { min: number; median: number; max: number };
  mine: { min: number; median: number; max: number };
  /** g_mkt(partner) < PARTNER_OVERPAYS_BELOW. */
  partnerOverpays: number;
  /** flags.marketCheck: g_mkt(me) < config.benefit.marketCheckBelow. */
  marketCheck: number;
  /** Means over the trades: the value term (logits), P_accept and P_accept without the value term (the same trade at even value), B and the market term inside B (redraft). */
  valueTerm: number;
  pAccept: number;
  pAcceptEven: number;
  b: number;
  marketTerm: number | null;
}

const bucketOf = (g: number): number => REALISM_BUCKETS.findIndex((b) => g >= b.lo && g < b.hi);

export function realismCheck(trades: readonly TradeEvaluation[]): Realism {
  const count = (gs: number[]) => {
    const out = new Array<number>(REALISM_BUCKETS.length).fill(0);
    for (const g of gs) {
      const k = bucketOf(g);
      if (k >= 0) out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };
  const spread = (gs: number[]) => ({ min: gs.length ? Math.min(...gs) : Number.NaN, median: median(gs), max: gs.length ? Math.max(...gs) : Number.NaN });
  const gp = trades.map((t) => t.gPartner);
  const gm = trades.map((t) => t.gMine);
  const redraft = trades.filter((t) => t.lambda === null && finite(t.b) && finite(t.bWin));
  return {
    trades: trades.length,
    partnerBuckets: count(gp),
    mineBuckets: count(gm),
    partner: spread(gp),
    mine: spread(gm),
    partnerOverpays: gp.filter((g) => g < PARTNER_OVERPAYS_BELOW).length,
    marketCheck: trades.filter((t) => t.flags.marketCheck).length,
    valueTerm: mean(trades.map((t) => t.detail.terms.value)),
    pAccept: mean(trades.map((t) => t.pAccept)),
    pAcceptEven: mean(trades.map((t) => pAcceptFromLogit(t.features.z - t.detail.terms.value))),
    b: mean(trades.flatMap((t) => (finite(t.b) ? [t.b] : []))),
    marketTerm: redraft.length ? mean(redraft.map((t) => (t.b as number) - (t.bWin as number))) : null,
  };
}

/**
 * The verdict in plain sentences: does the search favor offers lopsided against the partner (most ask it to give up
 * more than 15%: the planner's question), or the other way (Market checks: the user gives up more than 15%)? "Leans"
 * from a quarter of the trades on (⚠️ our wording threshold, a report choice).
 */
export function realismVerdict(r: Realism): string {
  const n = r.trades;
  if (!n) return "No trades to check.";
  const over = r.partnerOverpays;
  const mc = r.marketCheck;
  const share = (k: number) => `${Math.round((100 * k) / n)}%`;
  if (over * 2 > n) return `**Most suggestions (${over} of ${n}) ask partners to give up more than 15% in value: the search favors offers lopsided against the partner.**`;
  const first = `**The search does not favor offers lopsided against the partner: ${over} of ${n} ask the partner to give up more than 15% in value.**`;
  if (mc * 2 > n) return `${first} **It leans the other way: ${mc} of ${n} (${share(mc)}) carry a Market check, so most suggestions ask you to give up more than 15% in value; the median trade gives the partner ${pctSigned(r.partner.median)}.**`;
  if (mc * 4 >= n) return `${first} **It leans the other way: ${mc} of ${n} (${share(mc)}) carry a Market check (you give up more than 15% in value), and the median trade gives the partner ${pctSigned(r.partner.median)} in value.**`;
  return `${first} Nor does it lean the other way: ${mc} of ${n} carry a Market check.`;
}

// ---------------------------------------------------------------------------------------------
// The Smith-Njigba example (section 4)

/** One trade evaluated in both models (the Analyzer: analyzeTrade in each model's context). */
export interface StarRow {
  partnerId: string | null;
  give: string[];
  get: string[];
  /** Named players not on the rosters the trade needs (STAR_TRADES whose players moved): then nothing is evaluated. */
  missing: string[];
  before: TradeEvaluation | null;
  after: TradeEvaluation | null;
  illegal: string | null;
}

export interface StarExample {
  /** The star (STAR_NAME) on another team's active roster, his owner, his trade value and his star premium there; nulls when he isn't. */
  playerId: string | null;
  teamId: string | null;
  value: number | null;
  premium: PlayerPremium | null;
  /** My players at STAR_PACKAGE.pos tried (active roster, with a model), and every STAR_PACKAGE.size package of them for him. */
  mine: string[];
  packages: StarRow[];
  /** The package the old (before-addendum) model rated most likely: P_accept, then z, then the key; null without a legal one. */
  pick: StarRow | null;
  /** STAR_TRADES on these rosters. */
  named: StarRow[];
  /** The before model's shown trades that get a player tagged "Harder to get" for his team, with their places in both lists. */
  shownStars: { row: StarRow; beforeRank: number; afterRank: number | null; tagged: string[] }[];
}

function bothModels(before: VariantRun, after: VariantRun, proposal: TradeProposal): Pick<StarRow, "before" | "after" | "illegal"> {
  const b = analyzeTrade(before.ctx, proposal, { settings: before.settings });
  const a = analyzeTrade(after.ctx, proposal, { settings: after.settings });
  return { before: b.evaluation, after: a.evaluation, illegal: b.illegal ?? a.illegal };
}

function combinations<T>(xs: readonly T[], k: number): T[][] {
  if (k <= 0) return [[]];
  const out: T[][] = [];
  xs.forEach((x, i) => {
    for (const rest of combinations(xs.slice(i + 1), k - 1)) out.push([x, ...rest]);
  });
  return out;
}

/** The Smith-Njigba example (the file header, section 4). */
export function starExample(snapshot: LeagueSnapshot, before: VariantRun, after: VariantRun): StarExample {
  const I = tradeInternals(after.ctx);
  const me = I.me;
  const empty: StarExample = { playerId: null, teamId: null, value: null, premium: null, mine: [], packages: [], pick: null, named: [], shownStars: [] };
  if (!me) return empty;
  const others = I.teams.filter((t) => t !== me);
  const ownerOf = (id: string) => others.find((t) => t.roster.includes(id)) ?? null;
  const byName = (name: string, roster: readonly string[]) => roster.find((id) => snapshot.players[id]?.name === name) ?? null;

  // Value-even star trades: STAR_TRADES by name, then every before-model shown trade that gets a tagged player.
  const named: StarRow[] = STAR_TRADES.map((ex) => {
    const give = ex.give.map((n) => byName(n, me.roster));
    const owner = others.find((t) => ex.get.every((n) => byName(n, t.roster) !== null)) ?? null;
    const get = ex.get.map((n) => (owner ? byName(n, owner.roster) : null));
    const missing = [...ex.give.filter((_, i) => give[i] === null), ...ex.get.filter((_, i) => get[i] === null)];
    const row: StarRow = { partnerId: owner?.id ?? null, give: give.filter((x): x is string => x !== null), get: get.filter((x): x is string => x !== null), missing, before: null, after: null, illegal: null };
    if (missing.length || !owner) return row;
    return { ...row, ...bothModels(before, after, { partnerId: owner.id, give: asPlayers(row.give), get: asPlayers(row.get) }) };
  });
  const afterRank = new Map(after.result.trades.map((t, i) => [t.key, { rank: i + 1, t }]));
  const shownStars = before.result.trades.flatMap((t, i) => {
    const tagged = taggedFor(I, t.proposal.partnerId, playerIds(t.proposal.get));
    if (!tagged.length) return [];
    const hit = afterRank.get(t.key);
    const a = hit ? { after: hit.t, illegal: null } : (() => {
      const r = analyzeTrade(after.ctx, t.proposal, { settings: after.settings });
      return { after: r.evaluation, illegal: r.illegal };
    })();
    const row: StarRow = { partnerId: t.proposal.partnerId, give: playerIds(t.proposal.give), get: playerIds(t.proposal.get), missing: [], before: t, after: a.after, illegal: a.illegal };
    return [{ row, beforeRank: i + 1, afterRank: hit?.rank ?? null, tagged }];
  });

  const star = Object.keys(snapshot.players).find((id) => snapshot.players[id]?.name === STAR_NAME && ownerOf(id) !== null) ?? null;
  const owner = star ? ownerOf(star) : null;
  if (!star || !owner) return { ...empty, named, shownStars };
  const mine = me.roster.filter((id) => I.league.table.rows.has(id) && I.league.posOf(id) === STAR_PACKAGE.pos);
  const packages = combinations(mine, STAR_PACKAGE.size).map((give): StarRow => ({ partnerId: owner.id, give, get: [star], missing: [], ...bothModels(before, after, { partnerId: owner.id, give: asPlayers(give), get: asPlayers([star]) }) }));
  const legal = packages.filter((p) => p.before && p.after);
  const key = (p: StarRow) => proposalKey({ partnerId: owner.id, give: asPlayers(p.give), get: asPlayers(p.get) });
  const pick =
    [...legal].sort((a, b) => {
      const x = a.before as TradeEvaluation;
      const y = b.before as TradeEvaluation;
      return y.pAccept - x.pAccept || y.features.z - x.features.z || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
    })[0] ?? null;
  return { playerId: star, teamId: owner.id, value: I.values[star] ?? null, premium: I.premiums.get(owner.id)?.[star] ?? null, mine, packages, pick, named, shownStars };
}

// ---------------------------------------------------------------------------------------------
// "Offer first / if they say no" (section 5)

/** One version's numbers as the steps compare them (the screening block of seasons, as the search's steps). */
export interface StepVersionNumbers {
  pComplete: number;
  pAccept: number;
  b: number | null;
  /** The partner's raw g_mkt and its g as it sees it (AcceptanceFeatures.g, with the star premium; clamped). */
  gPartner: number;
  g: number;
  z: number;
  terms: AcceptanceTerms;
}

/** One possible step: the version offered first and the one with the throw-in (TradeVersion numbers), and what moved between them. */
export interface StepCandidate {
  throwIn: string;
  value: number;
  offer: StepVersionNumbers;
  full: StepVersionNumbers;
  /** P_complete(full) − P_complete(offer first). */
  gain: number;
  /** The change in z (full − offer first) by part: the value term, the extra player (complexity), their lineup (need, hole, context), the rest (activity, history, hot, urgency). */
  dz: { value: number; extra: number; lineup: number; rest: number; total: number };
  /** Case 2: the version with him helps (B > 0) and keeps B at least minBShare × the offer's (the rule's B filter); case 1: true. */
  bOk: boolean;
  /** Why the rule wouldn't show it, in words (empty: it would). */
  fails: string[];
}

export type StepCase = "holdBack" | "add" | "noRoom" | "noThrowIn" | "noHelp" | "illegal";

export interface StepRow {
  rank: number;
  trade: TradeEvaluation;
  stepCase: StepCase;
  candidates: StepCandidate[];
  /** The step the rule would choose without the pre-screen (case 1: the lowest-value throw-in in the trade; case 2: the best of those passing the B filter), or null. */
  rule: StepCandidate | null;
  /** Case 2 with more candidates than the pre-screen keeps: whether it keeps the rule's throw-in (null otherwise). */
  preScreenKeeps: boolean | null;
  /** The search showed steps on this card (TradeEvaluation.steps). */
  shown: boolean;
}

export interface StepsDiagnosis {
  W: number;
  /** My throw-ins (evaluate.throwIns: cheapest first), their perception values and lineup costs (exact mode). */
  throwIns: { id: string; value: number; cost: number | null }[];
  rows: StepRow[];
  /** Shown cards with steps; every candidate version; those reaching minAcceptGain; the largest gain. */
  withSteps: number;
  candidates: number;
  reaching: number;
  best: { row: StepRow; c: StepCandidate } | null;
  /** Candidates whose throw-in raises their g as they see it. */
  raiseG: number;
  /** Means over every candidate of the change in z by part, and of the gain. */
  meanDz: StepCandidate["dz"];
  meanGain: number;
  /** Case-2 trades with more candidates than the pre-screen keeps (and a rule choice), and how many keep it. */
  preScreen: { trades: number; kept: number };
}

const stepNumbers = (v: TradeVersion): StepVersionNumbers => ({ pComplete: v.screen.pComplete, pAccept: v.screen.pAccept, b: v.screen.b, gPartner: v.screen.gPartner, g: v.screen.features.g, z: v.screen.features.z, terms: v.screen.detail.terms });
const versionHelps = (v: TradeVersion): boolean => finite(v.screen.b) && v.screen.b > 0;

/** Every shown trade's possible steps, measured (the file header, section 5). */
export function stepsDiagnosis(ctx: TradeContext, result: TradeSearchResult, settings: TradeSettings): StepsDiagnosis {
  const I = tradeInternals(ctx);
  const cfg = stepConfig();
  const me = I.me;
  const thr = me ? throwIns(I, settings, cfg) : [];
  const costs = me ? (I.model.teams[me.index]?.players ?? {}) : {};
  const versions = new Map<string, TradeVersion>();
  const opts = { settings, maxPerSide: settings.maxPerSide, versions };
  const percent = (x: number) => `${fmt(100 * x, 0)}%`;
  const candidate = (id: string, offer: TradeVersion, full: TradeVersion, bFails: string[]): StepCandidate => {
    const t1 = full.screen.detail.terms;
    const t0 = offer.screen.detail.terms;
    const d = (k: keyof AcceptanceTerms) => t1[k] - t0[k];
    const gain = full.screen.pComplete - offer.screen.pComplete;
    const fails = [...bFails];
    if (!versionHelps(offer)) fails.push("the offer first doesn't help you");
    if (!(gain >= cfg.minAcceptGain - EPS)) fails.push(`the chance moves ${pts(gain)} (a step needs +${fmt(100 * cfg.minAcceptGain, 0)})`);
    if (!(offer.screen.pComplete >= cfg.minOfferFirst - EPS)) fails.push(`the offer first is under ${percent(cfg.minOfferFirst)} likely`);
    return {
      throwIn: id,
      value: I.values[id] ?? 0,
      offer: stepNumbers(offer),
      full: stepNumbers(full),
      gain,
      dz: { value: d("value"), extra: d("complexity"), lineup: d("need") + d("hole") + d("context"), rest: d("base") + d("activity") + d("history") + d("hot") + d("urgency"), total: full.screen.features.z - offer.screen.features.z },
      bOk: bFails.length === 0,
      fails,
    };
  };
  const rows = result.trades.map((t, i): StepRow => {
    const give = playerIds(t.proposal.give);
    const get = playerIds(t.proposal.get);
    const base: Omit<StepRow, "stepCase"> = { rank: i + 1, trade: t, candidates: [], rule: null, preScreenKeeps: null, shown: t.steps !== undefined };
    const ranked = tradeVersion(I, t.proposal, opts);
    if (!ranked) return { ...base, stepCase: "illegal" };
    const version = (ids: readonly string[]) => tradeVersion(I, { partnerId: t.proposal.partnerId, give: asPlayers(ids), get: asPlayers(get) }, opts);
    const inTrade = thr.filter((id) => give.includes(id));
    if (inTrade.length && give.length >= 2) {
      // Case 1: offer first without a throw-in in the trade (the rule: the lowest-value one), add him back if they say no.
      const candidates = inTrade.flatMap((id) => {
        const lean = version(give.filter((x) => x !== id));
        return lean ? [candidate(id, lean, ranked, [])] : [];
      });
      return { ...base, stepCase: "holdBack", candidates, rule: candidates.find((c) => c.throwIn === inTrade[0]) ?? null };
    }
    const toAdd = thr.filter((id) => !give.includes(id));
    if (!toAdd.length) return { ...base, stepCase: "noThrowIn" };
    if (give.length + 1 > settings.maxPerSide) return { ...base, stepCase: "noRoom" };
    if (!versionHelps(ranked)) return { ...base, stepCase: "noHelp" };
    // Case 2: offer the ranked trade first; if they say no, add a throw-in (every one evaluated: no pre-screen).
    const bOffer = ranked.screen.b as number;
    const candidates = toAdd.flatMap((id) => {
      const v = version([...give, id]);
      if (!v) return [];
      const bFails = !versionHelps(v) ? ["the version with him doesn't help you"] : (v.screen.b as number) < cfg.minBShare * bOffer - EPS ? [`B falls under ${fmt(100 * cfg.minBShare, 0)}% of the offer's`] : [];
      return [candidate(id, ranked, v, bFails)];
    });
    let rule: StepCandidate | null = null;
    for (const c of candidates) {
      if (!c.bOk) continue;
      const p = c.full.pComplete;
      const b = c.full.b as number;
      if (!rule || p > rule.full.pComplete + EPS || (Math.abs(p - rule.full.pComplete) <= EPS && (b > (rule.full.b as number) + EPS || (Math.abs(b - (rule.full.b as number)) <= EPS && c.throwIn < rule.throwIn)))) rule = c;
    }
    const pre = toAdd.length > cfg.preScreen ? addCandidates(I, t.proposal, thr, cfg) : null;
    return { ...base, stepCase: "add", candidates, rule, preScreenKeeps: pre && rule ? pre.includes(rule.throwIn) : null };
  });
  const all = rows.flatMap((r) => r.candidates.map((c) => ({ row: r, c })));
  let best: { row: StepRow; c: StepCandidate } | null = null;
  for (const x of all) if (!best || x.c.gain > best.c.gain + EPS) best = x;
  const avg = (f: (c: StepCandidate) => number) => mean(all.map((x) => f(x.c)));
  const pre = rows.filter((r) => r.preScreenKeeps !== null);
  return {
    W: I.credit,
    throwIns: thr.map((id) => {
      const pv = costs[id];
      return { id, value: I.values[id] ?? 0, cost: pv ? (pv.mvLoseScen ?? pv.mvLoseEv) : null };
    }),
    rows,
    withSteps: result.trades.filter((t) => t.steps !== undefined).length,
    candidates: all.length,
    reaching: all.filter((x) => x.c.gain >= cfg.minAcceptGain - EPS).length,
    best,
    raiseG: all.filter((x) => x.c.full.g > x.c.offer.g + EPS).length,
    meanDz: { value: avg((c) => c.dz.value), extra: avg((c) => c.dz.extra), lineup: avg((c) => c.dz.lineup), rest: avg((c) => c.dz.rest), total: avg((c) => c.dz.total) },
    meanGain: avg((c) => c.gain),
    preScreen: { trades: pre.length, kept: pre.filter((r) => r.preScreenKeeps === true).length },
  };
}

// ---------------------------------------------------------------------------------------------
// "Harder to get" (section 6)

export interface PremiumPlayerRow {
  id: string;
  value: number;
  e: number;
  rank: number;
  elite: boolean;
  harderToGet: boolean;
}

export interface HarderToGetReport {
  /** FantasyCalc's top eliteTop in the league's format (premium.eliteIds): value, owner (null: not on a roster) and rank there. */
  elite: { id: string; value: number; teamId: string | null; rank: number | null }[];
  /** Every team's players with e > 0 (the trade context's premiums), best rank first. */
  teams: { teamId: string; players: PremiumPlayerRow[] }[];
  /** The League page's partner cards (buildLeagueView), or why there are none. */
  cards: PartnerCard[];
  empty: string | null;
}

/** The tags and the League page's partner rows (the file header, section 6). */
export function harderToGetReport(snapshot: LeagueSnapshot, inputs: ModelInputs, I: TradeInternals, opts: { now: Date; settings: TradeSettings; scenarios?: number }): HarderToGetReport {
  const market = inputs.market ?? null;
  const owners = new Map<string, string>();
  for (const t of snapshot.teams) for (const id of [...t.roster, ...t.ir, ...t.taxi]) owners.set(id, t.id);
  const fcValue = (id: string) => (market ? (market.redraftValues && snapshot.settings.leagueType === "keeper" ? market.redraftValues[id] : market.values[id]) : undefined) ?? I.values[id] ?? 0;
  const elite = [...eliteIds(market)]
    .map((id) => {
      const teamId = owners.get(id) ?? null;
      return { id, value: fcValue(id), teamId, rank: teamId ? (I.premiums.get(teamId)?.[id]?.rank ?? null) : null };
    })
    .sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1));
  const teams = snapshot.teams.map((t) => ({
    teamId: t.id,
    players: Object.entries(I.premiums.get(t.id) ?? {})
      .filter(([, p]) => p.e > 0)
      .map(([id, p]) => ({ id, value: I.values[id] ?? 0, e: p.e, rank: p.rank, elite: p.elite, harderToGet: p.harderToGet }))
      .sort((a, b) => a.rank - b.rank),
  }));
  const model = buildLeagueModel(snapshot, inputs, { now: opts.now, settings: opts.settings, ...(opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {}) });
  const view = buildLeagueView({ snapshot, model, inputs, myTeamSource: "you", timeZone: "UTC", now: opts.now.toISOString() });
  return { elite, teams, cards: view.partners.cards, empty: view.partners.empty };
}

// ---------------------------------------------------------------------------------------------
// Consistency (section 7)

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
  /** V* after the trade: my pickups and the partner's (null when legality fails). */
  myAfter: readonly FaStep[] | null;
  theirAfter: readonly FaStep[] | null;
}

export interface Consistency {
  rows: ConsistencyRow[];
  /** V* before any trade: my pickups, and each partner's. */
  myBefore: readonly FaStep[];
  before: Record<string, readonly FaStep[]>;
  /** The fresh context's build time, ms. */
  contextMs: number;
}

/** The card's numbers compared between the search's evaluation and the Analyzer's. */
const COMPARED: readonly (keyof TradeEvaluation)[] = ["b", "tradeScore", "overall", "pAccept", "pComplete", "dPO", "dCH", "dEW", "dPPW", "dPPWPlayoffs", "gMine", "gPartner", "partnerDeltaLineup", "bWin"];

/** V*(after) of one side: legality in exact mode, then the free-agent optimizer from scratch (what evaluateExact runs). */
function vstarAfter(I: TradeInternals, team: TeamState, given: readonly string[], received: readonly string[], who: string): readonly FaStep[] | null {
  const legal = legalSide(I, team, team.roster, given, received, "exact", who);
  return "illegal" in legal ? null : I.league.optimizer.optimize(legal.roster, team.stream).moves;
}

/** Every shown trade re-evaluated by analyzeTrade in a fresh context (the file header). */
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
    const give = playerIds(t.proposal.give);
    const get = playerIds(t.proposal.get);
    return {
      rank: i + 1,
      key: t.key,
      partnerId: t.proposal.partnerId,
      bSearch: t.b,
      bAnalyzer: e?.b ?? null,
      differ,
      illegal: a.illegal,
      ms: dt,
      myAfter: vstarAfter(I, me, give, get, "You"),
      theirAfter: vstarAfter(I, partner, get, give, `Team ${partner.id}`),
    };
  });
  const before: Record<string, readonly FaStep[]> = {};
  for (const t of I.teams) before[t.id] = t.vstar.moves;
  return { rows, myBefore: me.vstar.moves, before, contextMs };
}

/** One player of mine given alone for nothing, my side only (the measured bound: the file header, section 7). */
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
  /** B, the same way, at each "Protect my trade value" level, and in the before-addendum model. */
  b: Record<ProtectValue, number | null>;
  bBefore: number | null;
}

/**
 * Each of my throw-ins and each player of mine worth less than W (the search's candidates: active roster, with a model, at
 * positions the search uses), given alone for nothing: exact evaluation with the first partner whose roster rules take him,
 * then the simulation with the partner's row left at its baseline (ExactTrade.theirs = its baseline), so B_win is what his
 * departure does to my side alone. A positive ROS change is a free-agent swap V*(me) skipped (it gains under faMinGain) that
 * the trade realizes: the measured "no B from pickups" bound.
 */
export function giveAwayCheck(ctx: TradeContext, beforeCtx: TradeContext, result: TradeSearchResult, settings: TradeSettings): GiveAwayRow[] {
  const I = tradeInternals(ctx);
  const Ib = tradeInternals(beforeCtx);
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
        bBefore: null,
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
      const xb = evaluateExact(Ib, x.evaluation.proposal, maxPerSide);
      const bBefore = "illegal" in xb ? null : simulateTrade(Ib, mineOnly(xb), "final", settings.lambda).b;
      return {
        ...row,
        ros: rosValue(x.mine.lv, I.weights) - baseRos,
        ins: [...after].filter((p) => !vstar.has(p)),
        outs: [...vstar].filter((p) => p !== id && !after.has(p)),
        bWin: sims[settings.protectValue].bWin,
        b: { low: sims.low.b, medium: sims.medium.b, high: sims.high.b },
        bBefore,
      };
    })
    .sort((a, b) => (b.ros ?? Number.NEGATIVE_INFINITY) - (a.ros ?? Number.NEGATIVE_INFINITY) || (a.playerId < b.playerId ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------
// The anchors (section 8)

export interface AnchorRow {
  name: string;
  planner: number;
  computed: number;
  diff: number;
  pass: boolean;
  /** Within ± this many points (§11's 1; the addendum's 0.5). */
  tolerance: number;
  /** The estimate without the star premium (the before-addendum model; §11's anchors carry none), and the planner's "before" when the table gives one. */
  withoutPremium: number;
  plannerBefore: number | null;
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
/** Playoff odds of a partner with no season context, and of a contender (above config.acceptance.context.contenderAbove). */
const NEUTRAL_PLAYOFFS = 0.4;
const CONTENDER_PLAYOFFS = 0.7;

/** §11's anchors through acceptance() itself (a redraft league without trade review, a partner with no history and 40% playoff odds: no season context). */
export function anchorRows(): AnchorRow[] {
  return ANCHORS.map((s) => {
    const r = acceptance(ANCHOR_LEAGUE, anchorProfile(s.a ?? 0, NEUTRAL_PLAYOFFS), { gPartner: s.g ?? 0, deltaLineup: (s.n ?? 0) * config.acceptance.nScale, h: s.h ?? 0, assets: (s.c ?? 0) + 2, partnerReceives: [] });
    const computed = 100 * r.pAccept;
    const diff = computed - s.percent;
    return { name: s.name, planner: s.percent, computed, diff, pass: Math.abs(diff) <= ANCHOR_TOLERANCE, tolerance: ANCHOR_TOLERANCE, withoutPremium: computed, plannerBefore: null };
  });
}

/** The addendum's anchors (PREMIUM_ANCHORS) through the real functions, as src/engine/acceptance.test.ts builds them. */
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
    return { name: s.name, planner: s.percent, computed, diff, pass: Math.abs(diff) <= PREMIUM_ANCHOR_TOLERANCE, tolerance: PREMIUM_ANCHOR_TOLERANCE, withoutPremium, plannerBefore: s.plannerBefore ?? null };
  });
}

// ---------------------------------------------------------------------------------------------
// The Analyzer example (section 10)

export interface AnalyzerExample {
  /** Candidates tried, illegal ones, legal ones under the acceptance bar, those with B > 0 at screening (and of those, inside the search's value window), and those analyzeTrade ran. */
  candidates: number;
  illegal: number;
  lowAccept: number;
  positive: number;
  inWindow: number;
  analyzed: number;
  /**
   * The pick (analyzeTrade's evaluation): the highest Trade Score among trades whose g_mkt(partner) is inside the
   * search's screening window (config.search.screeningGWindow: an offer the search itself could make, not a plain
   * lowball); null when none qualifies.
   */
  pick: TradeEvaluation | null;
  /** The same rule without the window (the most lopsided offers win it), for the report's one-line comparison. */
  extreme: TradeEvaluation | null;
}

/** analyzeTrade's better example: the higher Trade Score, then the higher B, then the smaller key. */
function betterExample(e: TradeEvaluation, than: TradeEvaluation | null): boolean {
  if (!than) return true;
  const a = e.tradeScore ?? 0;
  const b = than.tradeScore ?? 0;
  if (a !== b) return a > b;
  const eb = e.b as number;
  const tb = than.b as number;
  return eb !== tb ? eb > tb : e.key < than.key;
}

/** The systematic search for the Analyzer example (the file header, section 10). */
export function analyzerExample(ctx: TradeContext, opts: { settings: TradeSettings; topValues?: number; maxAccept?: number; finalists?: number }): AnalyzerExample {
  const I = tradeInternals(ctx);
  const empty: AnalyzerExample = { candidates: 0, illegal: 0, lowAccept: 0, positive: 0, inWindow: 0, analyzed: 0, pick: null, extreme: null };
  const me = I.me;
  if (!me || !I.sim) return empty;
  const topValues = opts.topValues ?? ANALYZER_TOP_VALUES;
  const maxAccept = opts.maxAccept ?? ANALYZER_MAX_ACCEPT;
  const keep = Math.max(1, opts.finalists ?? ANALYZER_FINALISTS);
  const [gLo, gHi] = config.search.screeningGWindow;
  const inWindow = (g: number) => g >= gLo && g <= gHi;
  const excluded = new Set<Pos>(config.market.tradeSearchExcluded);
  const tradable = (id: string) => I.league.table.rows.has(id) && !excluded.has(I.league.posOf(id) as Pos);
  const mine = me.roster.filter(tradable);
  const gives: string[][] = [...mine.map((id) => [id]), ...mine.flatMap((a, i) => mine.slice(i + 1).map((b) => [a, b]))];
  const maxPerSide = Math.max(1, Math.floor(config.search.analyzerMaxPerSide));
  const low: { proposal: TradeProposal; b: number; key: string; g: number }[] = [];
  let candidates = 0;
  let illegal = 0;
  let lowAccept = 0;
  for (const partner of I.teams) {
    if (partner === me) continue;
    const top = partner.roster
      .filter(tradable)
      .sort((a, b) => (I.values[b] ?? 0) - (I.values[a] ?? 0) || (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, topValues);
    for (const target of top) {
      for (const give of gives) {
        candidates++;
        const proposal: TradeProposal = { partnerId: partner.id, give: give.map((id) => ({ kind: "player", id })), get: [{ kind: "player", id: target }] };
        const x = evaluateExact(I, proposal, maxPerSide);
        if ("illegal" in x) {
          illegal++;
          continue;
        }
        if (!(x.evaluation.pAccept < maxAccept)) continue;
        lowAccept++;
        const b = simulateTrade(I, x, "screen", opts.settings.lambda, opts.settings.protectValue).b;
        if (finite(b) && b > 0) low.push({ proposal, b, key: proposalKey(proposal), g: x.evaluation.gPartner });
      }
    }
  }
  low.sort((a, b) => b.b - a.b || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const windowed = low.filter((c) => inWindow(c.g));
  const finalists = new Map([...windowed.slice(0, keep), ...low.slice(0, keep)].map((c) => [c.key, c]));
  let pick: TradeEvaluation | null = null;
  let extreme: TradeEvaluation | null = null;
  for (const f of finalists.values()) {
    const e = analyzeTrade(ctx, f.proposal, { settings: opts.settings }).evaluation;
    if (!e || !(e.pAccept < maxAccept) || !finite(e.b) || !(e.b > 0)) continue;
    if (betterExample(e, extreme)) extreme = e;
    if (inWindow(e.gPartner) && betterExample(e, pick)) pick = e;
  }
  return { candidates, illegal, lowAccept, positive: low.length, inWindow: windowed.length, analyzed: finalists.size, pick, extreme };
}

/** One acceptance term in words (section 10). */
export interface TermRow {
  term: keyof AcceptanceTerms;
  logit: number;
  words: string;
}

/** One side of a trade's value: who comes out ahead and by how much ("give": they give up `pct` more than they get). */
interface ValueSide {
  dir: "get" | "give" | "even";
  pct: number;
}

/** The partner's side from its own g (what it gets over what it gives, minus 1): it gives up −g / (1 + g) more than it gets when g < 0. */
export function partnerSide(g: number): ValueSide {
  if (!finite(g) || Math.abs(g) < 0.0005) return { dir: "even", pct: 0 };
  return g > 0 ? { dir: "get", pct: g } : { dir: "give", pct: -g / (1 + g) };
}

const sidePhrase = (v: ValueSide): string => (v.dir === "get" ? `they get ${pctPlain(v.pct)} more than they give` : v.dir === "give" ? `they give up ${pctPlain(v.pct)} more than they get` : "even trade value");

/**
 * The value term in words (sections 4 and 10): the trade value at market (g_mkt: valueReading's numbers) and, when what
 * they give carries a star premium (§1 of the addendum), as they see it (their perceived g: `perceived`, unclamped, when
 * the caller has it, else the clamped g the term reads). The g printed, the gain or loss wording and β are the term's own
 * (AcceptanceFeatures.g: the perceived g, clamped).
 */
export function valueTermWords(t: TradeEvaluation, snapshot: LeagueSnapshot, perceived: number | null = null): string {
  const g = t.features.g;
  const b = config.acceptance.beta;
  const premium = (t.detail.premium ?? []).filter((p) => p.e > 0);
  // Market: valueReading's exact readings (my g_mkt is their give over their get, minus 1).
  const market: ValueSide = !finite(t.gMine) || Math.abs(t.gMine) < 0.0005 ? { dir: "even", pct: 0 } : t.gMine < 0 ? { dir: "get", pct: t.gPartner } : { dir: "give", pct: t.gMine };
  const seen = premium.length ? (perceived !== null && finite(perceived) ? perceived : g) : t.gPartner;
  const clamp = finite(seen) && Math.abs(seen - g) > 1e-9 ? `, which the model clamps to ${signed(g, 3)}` : "";
  const term = g < 0 ? ` × β_loss ${b.loss}: losses weigh more than gains` : g > 0 ? ` × β_gain ${b.gain}` : ": no value term";
  const their = `(their g ${signed(seen, 3)}${clamp}${term})`;
  if (!premium.length) return `${sidePhrase(market)} ${their}`;
  const on = `the star premium on ${premium.map((p) => `${nameOf(snapshot, p.playerId)} at e ${fmt(p.e, 2)}`).join(" and ")}`;
  const p = partnerSide(seen);
  if (p.dir === market.dir && p.dir !== "even") return `${sidePhrase(market)} at market, ${pctPlain(p.pct)} more as they see it with ${on} ${their}`;
  if (p.dir === "even") return `${sidePhrase(market)} at market, even as they see it with ${on} ${their}`;
  return `${sidePhrase(market)} at market, but as they see it with ${on} ${sidePhrase(p)} ${their}`;
}

/**
 * The trade's acceptance terms (TradeDetail.terms, logit units), each in plain words, in the model's order. `I`: the
 * context the trade was evaluated in, for the partner's perceived g unclamped (valueTermWords); without it the words read
 * the clamped g.
 */
export function termRows(t: TradeEvaluation, snapshot: LeagueSnapshot, I?: TradeInternals): TermRow[] {
  const d = t.detail;
  const f = t.features;
  const b = config.acceptance.beta;
  const ctx = config.acceptance.context;
  const act = config.acceptance.activity;
  const name = (ids: readonly string[]) => ids.map((id) => snapshot.players[id]?.name ?? id).join(", ");
  // The star premium (§1 of the addendum): the g the model read is the partner's perceived g (features.g, clamped), not g_mkt.
  const perceived = I ? (perceivedG(I, t.proposal.partnerId, playerIds(t.proposal.give), playerIds(t.proposal.get), t.gPartner) ?? null) : null;
  const words: Record<keyof AcceptanceTerms, string> = {
    base: `the starting point (β0 ${fmt(b.b0, 1)}): an even 1-for-1 with nothing else is ${pctPlain(logistic(b.b0))}`,
    value: valueTermWords(t, snapshot, perceived),
    need: `their starting lineup changes by ${signed(t.partnerDeltaLineup)} points a week (n = ${signed(f.n, 2)}, × β_need ${b.need})`,
    hole: f.h === 1 ? `it gives them a starter at a hole (${d.holesFilled.join(", ")})` : d.holes.length ? `they have a hole (${d.holes.join(", ")}) but this doesn't fill it` : "they have no hole for it to fill",
    complexity: f.c > 0 ? `${f.c} player${f.c === 1 ? "" : "s"} beyond a 1-for-1 (× −β_cx ${b.complexity})` : "a 1-for-1: no complexity cost",
    activity:
      d.activity.rule === "active"
        ? `an active trader: ${d.activity.trades} trade${d.activity.trades === 1 ? "" : "s"} this season`
        : d.activity.rule === "inactive"
          ? `no moves in the last ${act.inactiveWeeks} weeks (a = −2)`
          : d.activity.rule === "quiet"
            ? `no moves in the last ${act.quietWeeks} weeks (a = −1)`
            : `ordinary activity (${d.activity.transactions} move${d.activity.transactions === 1 ? "" : "s"} this season, ${d.activity.trades} trade${d.activity.trades === 1 ? "" : "s"})`,
    history: f.hist === null ? "no completed trade of theirs to judge" : `their trades this season averaged ${pctSigned(d.history.average)} in value for them (hist ${signed(f.hist, 3)})`,
    context: d.context.checkedOut
      ? `they've checked out (under ${pctPlain(ctx.checkedOutBelow, 0)} to make the playoffs)`
      : d.context.contender
        ? `a contender (over ${pctPlain(ctx.contenderAbove, 0)} to make the playoffs): their lineup change counts ${ctx.contenderNeedFactor}×`
        : d.context.agingPlayers > 0
          ? `a rebuilding team getting ${d.context.agingPlayers} older RB/WR`
          : "no season context",
    hot: d.hotReceived.length ? `a hot player coming to them: ${name(d.hotReceived)}` : d.hotGiven.length ? `a hot player leaving them: ${name(d.hotGiven)}` : "nobody hot either way",
    urgency: f.urg > 0 ? "the trade deadline is near" : "the deadline isn't near",
  };
  return (Object.keys(words) as (keyof AcceptanceTerms)[]).map((term) => ({ term, logit: d.terms[term], words: words[term] }));
}

// ---------------------------------------------------------------------------------------------
// The report

export interface TradeReportOptions {
  now: Date;
  clock: () => number;
  /** "offline" (the data-local dump) or "live" (through the app's caches); and a line saying where the data came from. */
  mode: "offline" | "live";
  dataNote: string;
  /** When the report is written (the header's date). Default: `now`. */
  generatedAt?: Date;
  /** Availability scenarios (default config.lineups.scenarios). */
  scenarios?: number;
  /** Timed runs and warm-ups (default SEARCH_RUNS, SEARCH_WARMUPS). */
  runs?: number;
  warmups?: number;
  /** Timings of the stages before the engine (live: the crosswalk, the import, the model inputs). */
  timing?: Record<string, number>;
  /** The saved pre-addendum search for the same data and moment (offline: data-local/before-addendum/top25.json), and its label. */
  beforeReference?: { label: string; data: SearchReference };
}

export interface TradeReport {
  doc: string;
  ctx: TradeContext;
  result: TradeSearchResult;
  runtime: Runtime;
  variants: Variants;
  /** Both models' searches re-run stage by stage (where a trade left each; N11's pruning measured on the after one). */
  traces: { before: SearchTrace; after: SearchTrace };
  /** The before variant against the saved reference (null without one). */
  reference: ReferenceCheck | null;
  compare: CompareRow[];
  realism: Realism;
  pruning: PruningCheck | null;
  star: StarExample;
  steps: StepsDiagnosis;
  tags: HarderToGetReport;
  consistency: Consistency;
  giveAway: GiveAwayRow[];
  anchors: AnchorRow[];
  premiumAnchors: AnchorRow[];
  example: AnalyzerExample;
  optimizer: OptimizerReport;
  /** This report's own stages after the timed searches, ms (and "total": everything buildTradeReport did). */
  timing: Record<string, number>;
}

/** This report's stages, in order, with their labels (section 9). */
const REPORT_STAGES: readonly [string, string][] = [
  ["searches", `the timed searches (warm-up and runs, each with its own context)`],
  ["variants", "the before-addendum search (its own context) and the Low and High searches (the main context)"],
  ["traces", "both models' searches re-run stage by stage (where each trade left them; N11's pruning measured)"],
  ["compare", "before vs after: the top-10 trades the other model didn't show, through the Analyzer, and where each would have ranked"],
  ["star", "the Smith-Njigba example and the star trades (the Analyzer, both models)"],
  ["steps", "the offer-first diagnosis (every possible step, exactly evaluated)"],
  ["tags", "\"Harder to get\" and the League page (a League model with odds, and its view)"],
  ["consistency", "the consistency check (a fresh context, every shown trade through the Analyzer)"],
  ["giveAway", "the measured bound (each throw-in given for nothing, both models)"],
  ["example", "the Trade Analyzer example (every candidate exactly evaluated)"],
  ["optimizer", "the free-agent optimizer section (leagueMarginals)"],
  ["total", "the whole report, before writing it"],
];

/**
 * Everything after the network (the file header): the searches, the checks and the markdown, not yet scrubbed.
 * `snapshot` must already carry placeholders (league-report's placeholders()).
 */
export function buildTradeReport(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: TradeReportOptions): TradeReport {
  const settings = normalizeTradeSettings(defaultTradeSettings());
  const { now, clock } = opts;
  const scenarios = opts.scenarios;
  const sc = scenarios !== undefined ? { scenarios } : {};
  const timing: Record<string, number> = {};
  const start = clock();
  let last = start;
  const lap = (stage: string) => {
    const t = clock();
    timing[stage] = t - last;
    last = t;
  };
  const { ctx, result, runtime } = timedSearches(snapshot, inputs, { now, clock, settings, runs: opts.runs ?? SEARCH_RUNS, warmups: opts.warmups ?? SEARCH_WARMUPS, ...sc });
  lap("searches");
  const I = tradeInternals(ctx);
  const variants = variantSearches(snapshot, inputs, { ctx, result }, { now, clock, settings, ...sc });
  const after = variants[settings.protectValue];
  lap("variants");
  const traces = { before: searchTrace(variants.before.ctx, variants.before.settings, variants.before.result), after: searchTrace(after.ctx, after.settings, after.result) };
  const pruning = pruningCheck(traces.after);
  lap("traces");
  const reference = opts.beforeReference ? referenceCheck(variants.before.result, opts.beforeReference.data, opts.beforeReference.label) : null;
  const compare = compareTop(variants.before, after, traces);
  lap("compare");
  const realism = realismCheck(result.trades);
  const star = starExample(snapshot, variants.before, after);
  lap("star");
  const steps = stepsDiagnosis(ctx, result, settings);
  lap("steps");
  const tags = harderToGetReport(snapshot, inputs, I, { now, settings, ...sc });
  lap("tags");
  const consistency = consistencyCheck(snapshot, inputs, result.trades, { now, clock, settings, ...sc });
  lap("consistency");
  const giveAway = giveAwayCheck(ctx, variants.before.ctx, result, settings);
  lap("giveAway");
  const example = analyzerExample(ctx, { settings });
  lap("example");
  const optimizer = optimizerReport(snapshot, I.model, leagueMarginals(snapshot, inputs, { now, settings, ...sc }));
  lap("optimizer");
  const anchors = anchorRows();
  const premiumAnchors = premiumAnchorRows();
  timing.total = clock() - start;
  const doc = render({ snapshot, inputs, opts, settings, ctx, I, result, runtime, variants, traces, reference, compare, realism, pruning, star, steps, tags, consistency, giveAway, anchors, premiumAnchors, example, optimizer, timing });
  return { doc, ctx, result, runtime, variants, traces, reference, compare, realism, pruning, star, steps, tags, consistency, giveAway, anchors, premiumAnchors, example, optimizer, timing };
}

interface RenderInput {
  snapshot: LeagueSnapshot;
  inputs: ModelInputs;
  opts: TradeReportOptions;
  settings: TradeSettings;
  ctx: TradeContext;
  I: TradeInternals;
  result: TradeSearchResult;
  runtime: Runtime;
  variants: Variants;
  traces: { before: SearchTrace; after: SearchTrace };
  reference: ReferenceCheck | null;
  compare: CompareRow[];
  realism: Realism;
  pruning: PruningCheck | null;
  star: StarExample;
  steps: StepsDiagnosis;
  tags: HarderToGetReport;
  consistency: Consistency;
  giveAway: GiveAwayRow[];
  anchors: AnchorRow[];
  premiumAnchors: AnchorRow[];
  example: AnalyzerExample;
  optimizer: OptimizerReport;
  timing: Record<string, number>;
}

function render(x: RenderInput): string {
  const L: string[] = [];
  const teamName = (id: string) => `Team ${id}${id === x.result.myTeamId ? " (you)" : ""}`;
  renderHeader(L, x);
  renderTop(L, x, teamName);
  renderBeforeAfter(L, x, teamName);
  renderRealism(L, x, teamName);
  renderStar(L, x, teamName);
  renderSteps(L, x, teamName);
  renderTags(L, x, teamName);
  renderConsistency(L, x, teamName);
  renderAnchors(L, x.anchors, x.premiumAnchors);
  renderRuntime(L, x);
  renderAnalyzer(L, x, teamName);
  renderOptimizer(L, x, teamName);
  return L.join("\n");
}

/** κ of the report's settings ("Protect my trade value"). */
const kappaOf = (x: RenderInput): number => protectValueWeight(x.settings.protectValue);
const LEVEL_WORDS: Readonly<Record<ProtectValue, string>> = { low: "Low", medium: "Medium", high: "High" };

function renderHeader(L: string[], x: RenderInput): void {
  const { snapshot, inputs, I, result, settings, opts } = x;
  const model = I.model;
  const generated = (opts.generatedAt ?? opts.now).toISOString().slice(0, 10);
  L.push("# Trade search: Parker's ESPN league", "");
  L.push(
    `Generated by \`npm run trade:report${opts.mode === "offline" ? " -- --offline" : ""}\` on ${generated} through the real trade engine (buildTradeContext, runTradeSearch, analyzeTrade, explainTrade), as the Trade Finder's Web Worker runs it. Team, owner and league names are placeholders (you are Team ${result.myTeamId ?? "–"}); NFL player names are public.`,
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
  for (const n of inputs.notes) L.push(`- Note: ${n}`);
  for (const w of inputs.warnings) L.push(`- Warning \`${w.code}\`: ${w.message}`);
  L.push("");
  const b = result.baseline;
  L.push(
    `**Settings used** (the app's defaults, defaultTradeSettings): max ${settings.maxPerSide} players a side; streamed positions ${settings.streamPositions.join(", ") || "none"}; playoff weeks count ${settings.playoffWeight}×; Win now ↔ Future ${settings.lambda === null ? "default (redraft: not used)" : settings.lambda}; Protect my trade value ${LEVEL_WORDS[settings.protectValue]} (κ ${kappaOf(x)}); untouchables ${settings.untouchables.length || "none"}; must-include ${settings.mustInclude.length || "none"}; target positions ${settings.targetPositions.join(", ") || "any"}; avoid ${settings.avoidPositions.join(", ") || "none"}; P/K/D/ST/IDP ${settings.includeKDefIdp ? "included" : "left out"}; draft picks ${settings.includePicks ? "on" : "off"}. Search sizes from config.search: give and get pools ${config.search.givePool} / ${config.search.getPool} (plus up to ${config.search.getPoolTagged} "Harder to get" players a partner), beams ${config.search.beamSecond} / ${config.search.beamThird}, ${config.search.keptPerPartner} kept per partner, ${config.search.exactEvaluationMax} exactly evaluated, ${config.search.finalists} finalists at ${thousands(config.simulation.finalSims)} seasons, ${config.search.resultsShown} shown. The waiver credit W (the best free agent's trade value, §9): ${valueText(I.credit)}.`,
    "",
  );
  L.push(`**Your baseline** (every team after its free-agent pickups, ${thousands(config.simulation.finalSims)} seasons): P(playoffs) ${pctPlain(b.pPlayoffs)}, P(title) ${pctPlain(b.pTitle)}, expected wins ${fmt(b.expWins, 2)}.`, "");
  const notes = [...new Set([...x.ctx.notes, ...result.notes])];
  const warnings = [...new Set([...x.ctx.warnings, ...result.warnings])];
  L.push("**Engine notes and warnings** (the evaluation context's and the search's):", "");
  if (!notes.length && !warnings.length) L.push("- none");
  for (const n of notes) L.push(`- Note: ${n}`);
  for (const w of warnings) L.push(`- Warning: ${w}`);
  L.push("");
}

/** "Zay Flowers (WR, BAL) [Harder to get]": the players I get, with the tag from the trade's premium facts. */
function getText(snapshot: LeagueSnapshot, t: TradeEvaluation): string {
  const tagged = new Set((t.detail.premium ?? []).filter((p) => p.harderToGet).map((p) => p.playerId));
  const ids = playerIds(t.proposal.get);
  return ids.length ? ids.map((id) => `${playerLabel(snapshot, id)}${tagged.has(id) ? " [Harder to get]" : ""}`).join(" + ") : "nobody";
}

/** One trade's numbers as the summary table prints them. */
function summaryRow(x: RenderInput, t: TradeEvaluation, i: number, teamName: (id: string) => string): string {
  const s = x.snapshot;
  return `| ${i + 1} | ${teamName(t.proposal.partnerId)} | ${players(s, playerIds(t.proposal.give))} | ${getText(s, t)} | ${t.tradeScore ?? "–"} | ${chanceText(t)} | ${t.overall ?? "–"} | ${fmt(t.b, 2)} | ${signed(t.dPPW)} / ${signed(t.dPPWPlayoffs)} | ${pts(t.dPO)} | ${pts(t.dCH)} | ${signed(t.dEW, 2)} | ${fmt(t.ros.received)} / ${fmt(t.ros.given)} | ${pctSigned(t.gMine)} / ${pctSigned(t.gPartner)} | ${signed(t.features.n, 2)} (${signed(t.partnerDeltaLineup)}/wk) | ${t.features.h} |`;
}

const SUMMARY_HEAD = [
  "| # | Partner | You give | You get | Helps you | Chance they accept | Overall | B | ΔPPW reg / playoffs | ΔPO | ΔCH | ΔEW | ROS pts get / give | g_mkt you / them | Their n (ΔLineup) | h |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
];

function changeText(snapshot: LeagueSnapshot, c: { drops: string[]; adds: string[] }): string {
  const parts = [...c.drops.map((id) => `drop ${playerLabel(snapshot, id)}`), ...c.adds.map((id) => `add ${playerLabel(snapshot, id)}`)];
  return parts.length ? parts.join(", ") : "none";
}

function flagsText(snapshot: LeagueSnapshot, t: TradeEvaluation): string {
  const flags: string[] = [];
  if (t.flags.marketCheck) flags.push(`Market check (you'd get back ${pctPlain(1 + t.gMine, 0)} of the value you give)`);
  if (t.flags.injured.length) flags.push(`depends on an injured player: ${t.flags.injured.map((id) => `${playerLabel(snapshot, id)} ${snapshot.players[id]?.injury ?? ""}`.trim()).join(", ")}`);
  if (t.detail.vetoRisk) flags.push("veto risk (the league votes on trades and they get much less value)");
  return flags.length ? flags.join("; ") : "none";
}

/** The star premium line of a card (TradeDetail.premium): each player they give with e, his rank there and top-12, and their g as they see it. */
function premiumText(snapshot: LeagueSnapshot, t: TradeEvaluation): string | null {
  const facts = t.detail.premium;
  if (!facts) return null;
  const [lo, hi] = config.acceptance.gClamp;
  const clamped = t.features.g <= lo + EPS || t.features.g >= hi - EPS ? ` (the model clamps g to ${pctSigned(lo, 0)}…${pctSigned(hi, 0)})` : "";
  const parts = facts.map((f) => `${nameOf(snapshot, f.playerId)} e ${fmt(f.e, 2)}${f.rank ? ` (their #${f.rank}${f.elite ? ", top-12" : ""})` : ""}${f.harderToGet ? ", Harder to get" : ""}`);
  return `${parts.join("; ") || "none"}: their g as they see it ${pctSigned(t.features.g)}${clamped}, at market ${pctSigned(t.gPartner)}`;
}

/** The card's "How to offer it" (TradeEvaluation.steps). */
function stepsText(snapshot: LeagueSnapshot, t: TradeEvaluation): string {
  const st = t.steps;
  if (!st) return "no step (section 5 says why)";
  const o = st.offerFirst;
  return `offer first: you give ${names(snapshot, playerIds(o.proposal.give))} for ${names(snapshot, playerIds(o.proposal.get))} · Est. ${shownChance(o.pAccept)} (P_complete ${pctPlain(o.pComplete)}); if they say no, add ${nameOf(snapshot, st.ifNo.add)} · Est. ${shownChance(st.ifNo.full.pAccept)} (P_complete ${pctPlain(st.ifNo.full.pComplete)}); the ranked trade is the ${st.ranked === "full" ? "full version" : "offer first"}`;
}

/** A trade's card in full (top 10 and the Analyzer example). */
function renderCard(L: string[], x: RenderInput, t: TradeEvaluation, heading: string, teamName: (id: string) => string): void {
  const s = x.snapshot;
  const partner = teamName(t.proposal.partnerId);
  const v = valueReading(t.gMine, t.gPartner);
  const words = placeholderWords(x.I, t);
  const kappa = kappaOf(x);
  const term = marketTermOf(t);
  L.push(`### ${heading}`, "");
  L.push(`**You give** ${players(s, playerIds(t.proposal.give))} · **you get** ${getText(s, t)} · partner ${partner}`, "");
  L.push(`- **Helps you ${t.tradeScore ?? "– (B ≤ 0)"}** · **Chance they accept ${chanceText(t)}** (model: P_accept ${pctPlain(t.pAccept)}${t.detail.vetoRisk ? `, P_complete ${pctPlain(t.pComplete)}` : ""}) · **Overall ${t.overall ?? "–"}**`);
  const bParts =
    t.lambda === null
      ? `B_win ${fmt(t.bWin, 2)} + market term ${signed(term, 2)}${term !== null && kappa > 0 ? ` = κ ${kappa} × ${pctSigned(term / kappa)}` : ""}`
      : `λ ${fmt(t.lambda, 2)}, B_win ${fmt(t.bWin, 2)}, B_future ${fmt(t.bFuture, 2)}${t.dynMissing ? " (long-term values missing)" : ""}`;
  L.push(`- B ${fmt(t.b, 2)} (${bParts}); ΔPO ${pts(t.dPO)}, ΔCH ${pts(t.dCH)}, ΔEW ${signed(t.dEW, 2)} wins (${thousands(t.sims)} seasons)`);
  L.push(`- ΔPPW ${signed(t.dPPW)} points a week in the regular season, ${signed(t.dPPWPlayoffs)} in the playoffs; ROS points: you get ${fmt(t.ros.received)}, give ${fmt(t.ros.given)}`);
  L.push(`- Trade value (FantasyCalc, the waiver credit included): you give ${thousands(Math.round(t.value.given))}, get ${thousands(Math.round(t.value.received))}; g_mkt(you) ${pctSigned(t.gMine)}, g_mkt(${partner}) ${pctSigned(t.gPartner)}: ${v.you}`);
  const premium = premiumText(s, t);
  if (premium) L.push(`- Star premium on what ${partner} gives (§1 of the addendum): ${premium}`);
  const holes = t.detail.holes.length ? `holes ${t.detail.holes.join(", ")}${t.detail.holesFilled.length ? `, filled ${t.detail.holesFilled.join(", ")}` : ", none filled"}` : "no holes";
  L.push(`- ${partner}'s side: n ${signed(t.features.n, 2)} (their lineup ${signed(t.partnerDeltaLineup)} points a week, the next ${config.acceptance.nBlendNextWeeks} weeks and the rest of the season blended), h ${t.features.h} (${holes}), activity ${signed(t.features.a, 0)} (${t.detail.activity.rule}), hist ${t.features.hist === null ? "none" : signed(t.features.hist, 3)}, context ${signed(t.features.ctx, 2)}, hot ${signed(t.features.hot, 2)}, urgency ${signed(t.features.urg, 2)}; z ${signed(t.features.z, 2)}`);
  L.push(`- Required moves: you ${changeText(s, t.required.me)}; ${partner} ${changeText(s, t.required.partner)}`);
  L.push(`- Risk flags: ${flagsText(s, t)}`);
  if (t.detail.premium) L.push(`- How to offer it: ${stepsText(s, t)}`);
  if (t.detail.notes.length) L.push(`- Notes: ${t.detail.notes.join(" ")}`);
  L.push("", "Reasons:", "");
  for (const r of words.reasons) L.push(`1. ${r}`);
  L.push("", "Pitch:", "", `> ${words.pitch || "(none)"}`, "");
}

function renderTop(L: string[], x: RenderInput, teamName: (id: string) => string): void {
  const trades = x.result.trades;
  const top = trades.slice(0, TOP_DETAIL);
  L.push(`## 1. Your top ${TOP_DETAIL} trades`, "");
  if (!top.length) {
    L.push(`No trades: ${[...x.ctx.notes, ...x.result.notes].join(" ") || "nothing helps your team."}`, "");
    return;
  }
  const kappa = kappaOf(x);
  L.push(
    `The search's first ${top.length} trades in its default order, Overall (§13: EG = B × P_complete), with the default settings: the app's model, the planner's addendum included. **Helps you** = round(100 × (1 − e^(−B / ${config.benefit.bRef}))); **Chance they accept** = the model's estimate (§11), shown rounded to ${Math.round(100 * config.acceptance.displayStep)}% with its label; **Overall** = round(100 × (1 − e^(−B × P_complete / ${config.benefit.bRef}))). B = 100 × (${config.benefit.weights.playoffs} ΔPO + ${config.benefit.weights.title} ΔCH) + the market term κ × clamp(g, ±${config.benefit.marketSanityClamp[1]}): κ = ${kappa} ("Protect my trade value": ${LEVEL_WORDS[x.settings.protectValue]}), and g is g_mkt(you) with each player you give counted at no less than the waiver credit W (${valueText(x.I.credit)}; lead decision N10: a player worth less than the best free agent is replaceable, and your free-agent-optimized roster already replaces him). ΔPO, ΔCH: the change in your playoff and title odds in percentage points (${thousands(config.simulation.finalSims)} seasons on common random numbers); ΔEW: expected wins. ΔPPW: your average weekly starting points, regular season / playoffs. ROS pts: the players' own rest-of-season points (§6), received / given. g_mkt (§9): what a side gets over what it gives, minus 1, in FantasyCalc values with the waiver credit (the market's reading, never floored or premium-weighted); you / them. n = their weekly lineup change ÷ ${config.acceptance.nScale}, clamped to ±2 (ΔLineup in points a week); h = 1 when it gives them a starter at a hole. Both teams are measured after their free-agent pickups (V*) before and after. "[Harder to get]" marks a player who is his team's #1 or #2 by trade value and a top-12 player (section 6).`,
    "",
  );
  L.push(...SUMMARY_HEAD);
  top.forEach((t, i) => L.push(summaryRow(x, t, i, teamName)));
  L.push("");
  const tagged = top.flatMap((t) => (t.detail.premium ?? []).filter((p) => p.harderToGet).map((p) => nameOf(x.snapshot, p.playerId)));
  const premiumOn = top.flatMap((t) => (t.detail.premium ?? []).filter((p) => p.e > 0).map((p) => `${nameOf(x.snapshot, p.playerId)} (e ${fmt(p.e, 2)})`));
  L.push(`"Harder to get" players among them: ${tagged.length ? [...new Set(tagged)].join(", ") : "none"}. A star premium on what the partner gives: ${premiumOn.length ? [...new Set(premiumOn)].join(", ") : "none"}. Cards with an "If they say no" step: ${top.filter((t) => t.steps).length} of ${top.length} (section 5).`, "");
  L.push("Each trade's card (reasons and pitch worded by explainTrade with placeholder team names):", "");
  top.forEach((t, i) => renderCard(L, x, t, `${i + 1}. With ${teamName(t.proposal.partnerId)}`, teamName));
}

/** A stage in a few words, for a table cell: "cut in screening" (DropStage). */
export function stageTag(st: DropStage): string {
  switch (st.kind) {
    case "shown":
      return `#${st.place}`;
    case "notScreened":
      return "not screened";
    case "window":
      return "outside the value window";
    case "pruned":
      return "pruned in screening";
    case "partnerCut":
    case "overallCut":
      return "cut in screening";
    case "illegal":
      return "illegal";
    case "notFinalist":
      return "not a finalist";
    case "hidden":
      return "hidden";
    case "diversity":
      return "a diversity rule";
    case "lowerOverall":
      return `below the ${config.search.resultsShown} shown`;
  }
}

/** §13's diversity rules by name. */
const RULE_WORDS: Readonly<Record<DiversityRule, string>> = { filler: "the filler rule", core: "the core rule", partnerCap: "the partner cap" };

/** Why a trade is hidden by default (§10's guards), in words. */
const hiddenWhy = (why: "benefit" | "market"): string => (why === "benefit" ? "B ≤ 0: it doesn't help you" : `the market guard: g_mkt(you) under ${pctSigned(config.benefit.marketHideBelow, 0)}`);

/** A stage in a sentence (section 2's list): where the trade left the search, and why. `partner` names the partner, `maxPerSide` is the search's. */
export function stageWords(st: DropStage, snapshot: LeagueSnapshot, partner: string, maxPerSide: number): string {
  const sc = config.search;
  const rk = config.ranking;
  const are = (ids: readonly string[]) => `${names(snapshot, ids)} ${ids.length === 1 ? "isn't" : "aren't"}`;
  switch (st.kind) {
    case "shown":
      return `shown at #${st.place}`;
    case "notScreened":
      if (st.why === "stopped") return "never screened: the search stopped before screening";
      if (st.why === "size") return `never screened: more than ${maxPerSide} players a side`;
      if (st.why === "rules") return "never screened: screening's roster rules reject it";
      if (st.why === "beams") return "never screened: its players are in the pools, but the beams never built it";
      return `never screened: ${[st.missingGive.length ? `${are(st.missingGive)} in your give pool` : null, st.missingGet.length ? `${are(st.missingGet)} in ${partner}'s get pool` : null].filter((p): p is string => p !== null).join(", and ")}`;
    case "window": {
      const [lo, hi] = sc.screeningGWindow;
      return `screened, but outside the value window: g_mkt(${partner}) ${pctSigned(st.g)}, the window ${pctSigned(lo, 0)} to ${pctSigned(hi, 0)}`;
    }
    case "pruned":
      return `screened, then pruned as dominated (N11): the same trade without ${st.player ? nameOf(snapshot, st.player) : "your player worth less than W"} screened at least as well`;
    case "partnerCut":
      return `screened and inside the value window, but #${st.place.rank} of ${st.place.of} in ${partner}'s list by the screening objective, and only each partner's best ${sc.keptPerPartner} go on to exact evaluation${st.unpruned && st.unpruned.rank !== st.place.rank ? ` (#${st.unpruned.rank} of ${st.unpruned.of} without N11's pruning)` : ""}`;
    case "overallCut":
      return `in ${partner}'s best ${sc.keptPerPartner} by the screening objective, but #${st.place.rank} of ${st.place.of} over all partners, and only the best ${sc.exactEvaluationMax} go on to exact evaluation`;
    case "illegal":
      return `exact evaluation's roster rules reject it (${st.reason})`;
    case "notFinalist":
      if (st.hidden) return `exactly evaluated, then hidden at the screening simulation's numbers (${hiddenWhy(st.hidden)}), so not a finalist`;
      if (st.rule)
        return `exactly evaluated, but not a finalist: the ${sc.finalists} finalists are the first of §13's ranking at ${thousands(config.simulation.screeningSims)} seasons with its caps relaxed by one (${rk.perCore + 1} trades a core, ${rk.perPartnerInTop20 + 1} a partner in the top ${rk.partnerCapTop}), and ${RULE_WORDS[st.rule]} left it out there (its expected gain ranks #${st.place.rank} of ${st.place.of})`;
      return `exactly evaluated, but not among the ${sc.finalists} finalists: its expected gain at ${thousands(config.simulation.screeningSims)} seasons ranks #${st.place.rank} of ${st.place.of}`;
    case "hidden":
      return `a finalist, hidden by default at ${thousands(config.simulation.finalSims)} seasons (${hiddenWhy(st.why)})`;
    case "diversity":
      if (st.rule === "filler") return `a finalist, dropped by §13's filler rule: a smaller trade with ${partner} ranks above it, and the extra player moves B by less than ${fmt(100 * rk.fillerCutoffFraction, 0)}% of that trade's`;
      if (st.rule === "core") return `a finalist, dropped by §13's core rule: ${rk.perCore} trades above it share its core${st.core?.give && st.core.get ? `, ${nameOf(snapshot, st.core.give)} for ${nameOf(snapshot, st.core.get)}` : ""} (the most valuable player on each side)`;
      return `a finalist, dropped by §13's partner cap: ${partner} already has ${rk.perPartnerInTop20} trades in the top ${rk.partnerCapTop}`;
    case "lowerOverall":
      return `a finalist ranked below the ${sc.resultsShown} shown by Overall${st.place !== null ? ` (with room for every finalist it would be #${st.place})` : ""}`;
  }
}

/** The counterfactual (ifEvaluated) in words, after "had it been exactly evaluated too, ". */
export function ifWords(st: DropStage): string {
  switch (st.kind) {
    case "shown":
      return `it would have been shown at #${st.place}`;
    case "hidden":
      return `it would have been hidden (${hiddenWhy(st.why)})`;
    case "diversity":
      return `${RULE_WORDS[st.rule]} would have dropped it`;
    case "lowerOverall":
      return `it would have ranked below the ${config.search.resultsShown} shown${st.place !== null ? ` (#${st.place})` : ""}`;
    case "notFinalist":
      return `it wouldn't have been a finalist${st.hidden ? ` (${hiddenWhy(st.hidden)})` : st.rule ? ` (${RULE_WORDS[st.rule]} of the finalists' ranking)` : ` (#${st.place.rank} of ${st.place.of} by expected gain)`}`;
    case "illegal":
      return `it would be illegal (${st.reason})`;
    default:
      return stageTag(st);
  }
}

/**
 * Section 2's bullet on the trades of `rows` that the `side` model's search never exactly evaluated (a stage before exact
 * evaluation: PRE_EXACT), or null when there are none: where each left that search, that its numbers there are the Trade
 * Analyzer's, where it would have ended had that search exactly evaluated it (ModelSide.ifEvaluated), and, for the before
 * search's misses, whether N11's pruning is what made the room in the after search (`after`: its trace's places in each
 * partner's list with and without the pruning; within keptPerPartner only with it).
 */
export function neverEvaluatedText(rows: readonly CompareRow[], side: "before" | "after", group: string, ctx: { snapshot: LeagueSnapshot; teamName: (id: string) => string; after: Pick<SearchTrace, "partnerPlace" | "partnerPlaceUnpruned"> }): string | null {
  const { snapshot: s, teamName } = ctx;
  const never = rows.filter((r) => r[side].rank === null && PRE_EXACT.has(r[side].stage.kind));
  if (!never.length) return null;
  const keep = Math.floor(config.search.keptPerPartner);
  const one = never.length === 1;
  const stageAt = (r: CompareRow) => {
    const st = r[side].stage;
    return st.kind === "partnerCut" ? `#${st.place.rank} of ${st.place.of} in ${teamName(r.proposal.partnerId)}'s screening list` : stageTag(st);
  };
  let roomText = "";
  if (side === "before") {
    const places = never.map((r) => ({ a: ctx.after.partnerPlace.get(r.key), u: ctx.after.partnerPlaceUnpruned.get(r.key) }));
    const room = places.flatMap((p) => (p.a && p.u && p.a.rank <= keep && p.u.rank > keep ? [{ a: p.a, u: p.u }] : []));
    const anyway = places.filter((p) => p.a && p.u && p.a.rank <= keep && p.u.rank <= keep).length;
    if (room.length) {
      const all = room.length === never.length;
      roomText = ` ${all ? (one ? "N11's pruning made the room" : "For all of them, N11's pruning made the room") : `For ${room.length} of them, N11's pruning made the room`} in the after search: there ${room.length === 1 ? "it is" : "they are"} within ${room.length === 1 ? "its" : "their"} partner's best ${keep} only once the pruning drops dominated variants (${room.map((p) => `#${p.a.rank} of ${p.a.of} with it, #${p.u.rank} of ${p.u.of} without`).join("; ")}).`;
    } else if (anyway === never.length) {
      roomText = ` N11's pruning isn't what let ${one ? "it" : "them"} in: the after search's own screening ranks ${one ? "it" : "them"} within a partner's best ${keep} even without it.`;
    }
  }
  const places = never.flatMap((r) => {
    const f = r[side].ifEvaluated;
    return f?.kind === "shown" ? [f.place] : [];
  });
  const fate =
    places.length === never.length
      ? `${one ? "it" : "they"} would have been shown at ${andList(places.map((p) => `#${p}`))}${one ? "" : " respectively"}`
      : never.map((r) => `${tradeLine(s, r.proposal, teamName)}: ${r[side].ifEvaluated ? ifWords(r[side].ifEvaluated as DropStage) : "–"}`).join("; ");
  return `- **${never.length} of the ${rows.length} ${group} ${one ? "was" : "were"} never exactly evaluated by the ${side} search**: ${never.map((r) => `${tradeLine(s, r.proposal, teamName)} (${stageAt(r)})`).join("; ")}. ${one ? "Its" : "Their"} ${side} numbers above come from the Trade Analyzer, not from the ${side} search's ranking.${roomText} Had the ${side} search exactly evaluated ${one ? "it" : "them"} too, ${fate}.`;
}

/** "#3 · 55 / 80% / 46" or "not shown (cut in screening) · 44 / 70% / 34" (a model's side of a trade). */
const sideText = (m: ModelSide): string => `${m.rank === null ? `not shown (${stageTag(m.stage)})` : `#${m.rank}`} · ${threeNumbers(m.t)}`;

function renderBeforeAfter(L: string[], x: RenderInput, teamName: (id: string) => string): void {
  const s = x.snapshot;
  const before = x.variants.before;
  const after = x.variants[x.settings.protectValue];
  const bTop = before.result.trades.slice(0, TOP_DETAIL);
  const aTop = after.result.trades.slice(0, TOP_DETAIL);
  L.push("## 2. Before and after the planner's addendum: your top 10", "");
  L.push(
    `The same run searched twice: **before** is the engine's before/after variant (TradeContextOptions.beforeAddendum, lead decision N5), the model as it stood before the planner's addendum to Checkpoint 3: no star premium, B's market term at weight ${config.benefit.marketSanityWeight} on the raw g_mkt(you) (no waiver-credit floor, N10), the get pool without the "Harder to get" split, no dominance pruning in screening (N11) and no "Offer first" steps. **After** is the app's model at the default settings (star premium, "Protect my trade value" ${LEVEL_WORDS[x.settings.protectValue]}: κ ${kappaOf(x)}, N10, N11, the tagged get pool, steps). Same data, lineups, seeds and seasons, so a trade's B_win is identical in both: its B moves only with the market term, and its chance they accept only with the star premium. Each cell: Helps you / Chance they accept (as the card shows it) / Overall.`,
    "",
  );
  const ref = x.reference;
  L.push(
    ref
      ? `**Checked in this run:** the before variant's search against the pre-addendum reference (${ref.label}: the default search on this data, saved before the addendum was built): **${ref.same} of ${ref.trades} trades identical** (place, trade and every number), the stage counts ${ref.counts ? "equal" : "**different**"}, the hidden counts ${ref.hidden ? "equal" : "**different**"}${ref.first ? `; first difference: ${ref.first}` : ""}.`
      : `Not re-checked here against the pre-addendum reference (${x.opts.mode === "live" ? "live data: the reference is for the offline dump" : "no reference saved for this data"}); the engine track's check on the offline dump reproduced it exactly.`,
    "",
  );
  L.push(`| # | Before: trade | Before: Helps / Chance / Overall | After: trade | After: Helps / Chance / Overall | Harder to get (after) |`, "|---|---|---|---|---|---|");
  for (let i = 0; i < Math.max(bTop.length, aTop.length); i++) {
    const b = bTop[i];
    const a = aTop[i];
    const tags = a ? (a.detail.premium ?? []).filter((p) => p.harderToGet).map((p) => nameOf(s, p.playerId)) : [];
    L.push(`| ${i + 1} | ${b ? tradeLine(s, b.proposal, teamName) : "–"} | ${threeNumbers(b ?? null)} | ${a ? tradeLine(s, a.proposal, teamName) : "–"} | ${threeNumbers(a ?? null)} | ${tags.join(", ") || "–"} |`);
  }
  L.push("");
  L.push(
    `**What changed, trade by trade**: every trade in either top ${TOP_DETAIL}, with its place and numbers in both models. "Not shown": outside that model's ${config.search.resultsShown} shown trades, with the stage of that model's search that dropped it (the list under the table says more): not screened, outside the value window, pruned in screening (N11), cut in screening (past a partner's best ${config.search.keptPerPartner} or the best ${config.search.exactEvaluationMax} overall: never exactly evaluated), not a finalist, hidden, a diversity rule (§13), or below the ${config.search.resultsShown} shown. Such a trade is evaluated in that model by the Trade Analyzer (analyzeTrade, ${thousands(config.simulation.finalSims)} seasons): the numbers that model gives it, whether or not its search got that far. Market term = B − B_win (before: ${config.benefit.marketSanityWeight} × clamp(g_mkt(you)); after: κ ${kappaOf(x)} × clamp(g) with N10's floor). "Star premium": e on each player they'd give who carries one.`,
    "",
  );
  L.push("| Trade | Before: place · Helps / Chance / Overall | After: place · Helps / Chance / Overall | B_win | Market term, before → after | P_accept, before → after | Star premium (after) | Gives a player worth less than W |", "|---|---|---|---|---|---|---|---|");
  const W = x.I.credit;
  for (const r of x.compare) {
    const b = r.before.t;
    const a = r.after.t;
    const premium = (a?.detail.premium ?? []).filter((p) => p.e > 0).map((p) => `${nameOf(s, p.playerId)} e ${fmt(p.e, 2)}${p.harderToGet ? " [Harder to get]" : ""}`);
    const cheap = playerIds(r.proposal.give).filter((id) => (x.I.values[id] ?? 0) < W);
    const bWin = b && a && finite(b.bWin) && finite(a.bWin) && Math.abs(b.bWin - a.bWin) > 1e-9 ? `${fmt(b.bWin, 2)} → ${fmt(a.bWin, 2)}` : fmt(a?.bWin ?? b?.bWin, 2);
    L.push(`| ${tradeLine(s, r.proposal, teamName)} | ${sideText(r.before)} | ${sideText(r.after)} | ${bWin} | ${signed(marketTermOf(b), 2)} → ${signed(marketTermOf(a), 2)} | ${pctPlain(b?.pAccept)} → ${pctPlain(a?.pAccept)} | ${premium.join("; ") || "–"} | ${cheap.map((id) => `${nameOf(s, id)} (${valueText(x.I.values[id] ?? 0)})`).join(", ") || "–"} |`);
  }
  L.push("");
  // Where each trade marked "not shown" left that model's search (the traces).
  const tb = x.traces.before;
  const ta = x.traces.after;
  const notShown = x.compare.flatMap((r) => [
    ...(r.before.rank === null ? [{ r, label: "Before", m: r.before, tr: tb }] : []),
    ...(r.after.rank === null ? [{ r, label: "After", m: r.after, tr: ta }] : []),
  ]);
  if (notShown.length) {
    const yes = (ok: boolean) => (ok ? "yes" : "**no**");
    L.push(
      `**Why the trades marked "not shown" weren't shown.** Each model's search re-run stage by stage with the engine's own functions, in search.ts's order: the pools, the screening beams, the value window, N11's pruning (after only), each partner's best ${config.search.keptPerPartner} by the screening objective, the best ${config.search.exactEvaluationMax} overall, exact evaluation, the ${thousands(config.simulation.screeningSims)}-season screening simulation, the ${config.search.finalists} finalists, the ${thousands(config.simulation.finalSims)}-season final simulation and §13's ranking. The re-runs reproduce the searches exactly (counts, hidden counts and the shown trades in order): before ${yes(tb.matches)}, after ${yes(ta.matches)}${tb.matches && ta.matches ? "" : " (**so the stages below may be off**)"}. For a trade the search never exactly evaluated, the line also says where it would have ended had it been (its own exact evaluation and simulations added to that search, the rest unchanged).`,
      "",
    );
    for (const n of notShown) {
      const partner = teamName(n.r.proposal.partnerId);
      const cf = n.m.ifEvaluated ? ` Had it been exactly evaluated too, ${ifWords(n.m.ifEvaluated)}.` : "";
      L.push(`- ${n.label}: ${tradeLine(s, n.r.proposal, teamName)}: ${stageWords(n.m.stage, s, partner, n.tr.settings.maxPerSide)}.${cf}`);
    }
    L.push("");
  }
  const keys = (ts: readonly TradeEvaluation[]) => new Set(ts.map((t) => t.key));
  const aKeys = keys(aTop);
  const bKeys = keys(bTop);
  const stayed = bTop.filter((t) => aKeys.has(t.key));
  const samePlace = bTop.filter((t, i) => aTop[i]?.key === t.key).length;
  const both = x.compare.filter((r) => r.before.t && r.after.t);
  const dB = both.map((r) => ((r.after.t as TradeEvaluation).b ?? Number.NaN) - ((r.before.t as TradeEvaluation).b ?? Number.NaN));
  const dP = both.map((r) => (r.after.t as TradeEvaluation).pAccept - (r.before.t as TradeEvaluation).pAccept);
  const where = (r: CompareRow) => `${tradeLine(s, r.proposal, teamName)} (${sideText(r.before)} → ${sideText(r.after)})`;
  const left = x.compare.filter((r) => bKeys.has(r.key) && !aKeys.has(r.key));
  const came = x.compare.filter((r) => aKeys.has(r.key) && !bKeys.has(r.key));
  const aTags = after.result.trades.filter((t) => (t.detail.premium ?? []).some((p) => p.harderToGet));
  const bStars = before.result.trades.filter((t) => taggedFor(x.I, t.proposal.partnerId, playerIds(t.proposal.get)).length > 0);
  L.push(`- **${stayed.length} of the before top ${bTop.length} are still in the after top ${aTop.length}** (${samePlace} in the same place).`);
  // Trades one search never exactly evaluated: their numbers in that model are the Analyzer's, not that search's ranking.
  const missed = (rows: readonly CompareRow[], side: "before" | "after", group: string): void => {
    const text = neverEvaluatedText(rows, side, group, { snapshot: s, teamName, after: ta });
    if (text) L.push(text);
  };
  if (left.length) L.push(`- Left the top ${TOP_DETAIL}: ${left.map(where).join("; ")}.`);
  missed(left, "after", `that left the top ${TOP_DETAIL}`);
  if (came.length) L.push(`- New in the top ${TOP_DETAIL}: ${came.map(where).join("; ")}.`);
  missed(came, "before", `new in the top ${TOP_DETAIL}`);
  if (both.length) L.push(`- Over these ${both.length} trades, B moved by ${signed(mean(dB), 2)} on average (min ${signed(Math.min(...dB), 2)}, max ${signed(Math.max(...dB), 2)}: the market term alone) and P_accept by ${pts(mean(dP))} (min ${pts(Math.min(...dP))}, max ${pts(Math.max(...dP))}: the star premium alone; 0 where they give no #1, #2 or top-12 player).`);
  L.push(`- "Harder to get" players in the after top ${aTop.length}: ${aTop.flatMap((t) => (t.detail.premium ?? []).filter((p) => p.harderToGet).map((p) => nameOf(s, p.playerId))).join(", ") || "none"}; among all ${after.result.trades.length} trades shown after: ${aTags.length}; trades the before model showed that get one: ${bStars.length} (section 4).`);
  // Your throw-ins (section 5) and players worth less than W, in the shown trades of each model.
  const cheapOrThrow = [...new Set([...x.steps.throwIns.map((t) => t.id), ...[...before.result.trades, ...after.result.trades].flatMap((t) => playerIds(t.proposal.give)).filter((id) => (x.I.values[id] ?? 0) < W)])];
  const count = (ts: readonly TradeEvaluation[], id: string) => ts.filter((t) => playerIds(t.proposal.give).includes(id)).length;
  const counted = cheapOrThrow.map((id) => ({ id, b: count(before.result.trades, id), a: count(after.result.trades, id) })).filter((c) => c.a + c.b > 0);
  if (counted.length) L.push(`- Your throw-ins in the shown trades, before → after: ${counted.map((c) => `${nameOf(s, c.id)} (${valueText(x.I.values[c.id] ?? 0)}${(x.I.values[c.id] ?? 0) < W ? ", worth less than W" : ""}) ${c.b} → ${c.a}`).join("; ")} (section 7 measures what giving each one away realizes).`);
  L.push(`- Trades shown: ${before.result.trades.length} before, ${after.result.trades.length} after; hidden for B ≤ 0: ${before.result.hidden.byBenefit} before, ${after.result.hidden.byBenefit} after; cards with an "If they say no" step after: ${after.result.trades.filter((t) => t.steps).length} (section 5).`, "");
}

function bucketLabel(k: number): string {
  const b = REALISM_BUCKETS[k];
  if (!b) return "–";
  if (!Number.isFinite(b.lo)) return `below ${pctSigned(b.hi, 0)}`;
  if (!Number.isFinite(b.hi)) return `${pctSigned(b.lo, 0)} or more`;
  return `${pctSigned(b.lo, 0)} to ${pctSigned(b.hi, 0)}`;
}

function renderRealism(L: string[], x: RenderInput, teamName: (id: string) => string): void {
  const r = x.realism;
  const trades = x.result.trades;
  L.push(`## 3. Realism check: the ${r.trades} trades shown`, "");
  if (!r.trades) {
    L.push("No trades to check.", "");
    renderKappa(L, x, teamName);
    return;
  }
  L.push(
    `Planner's question: do most suggestions ask partners to give up more than 15% in value? **Definition used (⚠️ ours, as the lead set it): a trade asks the partner to give up more than 15% in value when g_mkt(partner) < ${fmt(PARTNER_OVERPAYS_BELOW, 2)}**, i.e. the partner gets back less than 85% of the value it gives (FantasyCalc values with the waiver credit, §9). The other direction is §10's Market check: g_mkt(you) < ${fmt(config.benefit.marketCheckBelow, 2)}, you get back less than 85% of what you give; trades below ${fmt(config.benefit.marketHideBelow, 2)} are hidden (${x.result.hidden.byMarket} hidden this way, ${x.result.hidden.byBenefit} hidden for B ≤ 0). The search only keeps trades with g_mkt(partner) in [${config.search.screeningGWindow.map((g) => fmt(g, 2)).join(", ")}] (§12).`,
    "",
  );
  L.push("| g_mkt bucket | Trades by g_mkt(partner) | Trades by g_mkt(you) |", "|---|---|---|");
  REALISM_BUCKETS.forEach((_, k) => L.push(`| ${bucketLabel(k)} | ${r.partnerBuckets[k] ?? 0} | ${r.mineBuckets[k] ?? 0} |`));
  L.push("");
  L.push(`g_mkt(partner): min ${pctSigned(r.partner.min)}, median ${pctSigned(r.partner.median)}, max ${pctSigned(r.partner.max)}. g_mkt(you): min ${pctSigned(r.mine.min)}, median ${pctSigned(r.mine.median)}, max ${pctSigned(r.mine.max)}.`, "");
  L.push(`- Ask the partner to give up more than 15% (g_mkt(partner) < ${fmt(PARTNER_OVERPAYS_BELOW, 2)}): **${r.partnerOverpays} of ${r.trades}**.`);
  const top = trades.slice(0, TOP_DETAIL);
  L.push(`- Carry a Market check (g_mkt(you) < ${fmt(config.benefit.marketCheckBelow, 2)}): **${r.marketCheck} of ${r.trades}**; among the top ${top.length}: **${top.filter((t) => t.flags.marketCheck).length}**, and the top ${top.length}'s median g_mkt(partner) is ${pctSigned(median(top.map((t) => t.gPartner)))}.`, "");
  L.push(realismVerdict(r), "");
  L.push(
    `Why, in the model's own numbers (means over these ${r.trades} trades): the value term adds ${signed(r.valueTerm, 2)} logits to the acceptance estimate (β_gain ${config.acceptance.beta.gain} × g⁺, β_loss ${config.acceptance.beta.loss} × g⁻, on their g as they see it: the star premium included), so P_accept averages ${pctPlain(r.pAccept)} against ${pctPlain(r.pAcceptEven)} for the same trades at even value; ${r.marketTerm === null ? "B has no market term in this league type" : `B's market term (§10 with the addendum: κ ${kappaOf(x)} × clamp(g, ±${config.benefit.marketSanityClamp[1]}), g = g_mkt(you) with each player you give counted at least at W) averages ${signed(r.marketTerm, 2)} B points against an average B of ${fmt(r.b, 2)}`}. Overall ranks by B × P_complete, so giving value away raises the acceptance side more than it lowers B (⚠️ our reading of the numbers; the κ question below measures how far κ moves it).`,
    "",
  );
  L.push("Every trade shown (Overall order):", "");
  L.push("| # | Partner | You give | You get | g_mkt(them) | g_mkt(you) | Market check | B | P_accept |", "|---|---|---|---|---|---|---|---|---|");
  trades.forEach((t, i) => L.push(`| ${i + 1} | ${teamName(t.proposal.partnerId)} | ${players(x.snapshot, playerIds(t.proposal.give))} | ${getText(x.snapshot, t)} | ${pctSigned(t.gPartner)} | ${pctSigned(t.gMine)} | ${t.flags.marketCheck ? "yes" : "–"} | ${fmt(t.b, 2)} | ${pctPlain(t.pAccept)} |`));
  L.push("");
  renderKappa(L, x, teamName);
}

/** The variants in column order: before the addendum, then the levels. */
function variantColumns(x: RenderInput): { label: string; run: VariantRun }[] {
  return [
    { label: `Before the addendum (κ ${x.variants.before.kappa}, no star premium)`, run: x.variants.before },
    ...PROTECT_VALUE_LEVELS.map((v) => ({ label: `${LEVEL_WORDS[v]} (κ ${x.variants[v].kappa}${v === x.settings.protectValue ? ", the default" : ""})`, run: x.variants[v] })),
  ];
}

function renderKappa(L: string[], x: RenderInput, teamName: (id: string) => string): void {
  const cols = variantColumns(x);
  const stats = cols.map((c) => gMineStats(c.run.result));
  L.push("### g_mkt(you) before and after the addendum, and at each \"Protect my trade value\" level", "");
  L.push(
    `Planner-reply-3b §5: the distribution of g_mkt(you) over the shown trades, before and after. The levels are the app's model searched again on the same evaluation context with "Protect my trade value" at Low, Medium and High (κ ${PROTECT_VALUE_LEVELS.map((v) => x.variants[v].kappa).join(" / ")}: the context reads only the League model's settings, so each equals a context built at that level). Market check: g_mkt(you) < ${pctSigned(config.benefit.marketCheckBelow, 0)}; "below ${pctSigned(DEEP_OVERPAY_BELOW, 0)}": you give up a third more than you get or worse.`,
    "",
  );
  L.push(`| g_mkt(you) | ${cols.map((c) => c.label).join(" | ")} |`, `|---|${cols.map(() => "---").join("|")}|`);
  REALISM_BUCKETS.forEach((_, k) => L.push(`| ${bucketLabel(k)} | ${stats.map((st) => st.buckets[k] ?? 0).join(" | ")} |`));
  L.push(`| **trades shown** | ${stats.map((st) => st.trades).join(" | ")} |`);
  L.push(`| median | ${stats.map((st) => pctSigned(st.median)).join(" | ")} |`);
  L.push(`| min / max | ${stats.map((st) => `${pctSigned(st.min)} / ${pctSigned(st.max)}`).join(" | ")} |`);
  L.push(`| Market checks | ${stats.map((st) => st.marketCheck).join(" | ")} |`);
  L.push(`| below ${pctSigned(DEEP_OVERPAY_BELOW, 0)} | ${stats.map((st) => st.deep).join(" | ")} |`);
  L.push(`| hidden: B ≤ 0 / market guard | ${stats.map((st) => `${st.hidden.byBenefit} / ${st.hidden.byMarket}`).join(" | ")} |`);
  L.push("");
  L.push(
    `**The κ question: your top ${TOP_DETAIL} at each level.** Σ EG is B × P_complete summed over all the shown trades, the expected gain Overall ranks by. B holds the market term κ × g, so **Σ EG isn't comparable across levels**: for the very same trades it moves with κ (down where you give value away, g < 0, up where you gain it), so a lower Σ EG at a higher κ doesn't mean worse trades. Σ B_win × P_complete leaves the market term out (κ-free: the trades' effect on your odds, weighted by the chance they go through), so it is comparable across the columns.`,
    "",
  );
  L.push(`| Setting | #1 trade (Helps / Chance / Overall) | Top-${TOP_DETAIL} median g_mkt(you) | Top-${TOP_DETAIL} Market checks | Top-${TOP_DETAIL} below ${pctSigned(DEEP_OVERPAY_BELOW, 0)} | Σ EG (within a level only) | Σ B_win × P_complete (κ-free) |`, "|---|---|---|---|---|---|---|");
  cols.forEach((c, i) => {
    const st = stats[i] as GMineStats;
    const first = c.run.result.trades[0];
    L.push(`| ${c.label} | ${first ? `${tradeLine(x.snapshot, first.proposal, teamName)} (${threeNumbers(first)})` : "–"} | ${pctSigned(st.top.median)} | ${st.top.marketCheck} of ${st.top.trades} | ${st.top.deep} of ${st.top.trades} | ${fmt(st.eg, 2)} | ${fmt(st.egKappaFree, 2)} |`);
  });
  L.push("");
  const main = x.variants[x.settings.protectValue];
  const be = breakEvenKappa(main.result.trades, main.kappa);
  if (be) {
    const p = (t: TradeEvaluation) => `B_win ${fmt(t.bWin, 2)}, market g ${pctSigned(((t.b as number) - (t.bWin as number)) / main.kappa)} after its floor, P_complete ${pctPlain(t.pComplete)}`;
    L.push(
      `**Break-even κ** (⚠️ a two-trade reading): today's #1 (${tradeLine(x.snapshot, be.first.proposal, teamName)}: ${p(be.first)}) against the best even trade in the list (#${be.evenRank}, ${tradeLine(x.snapshot, be.even.proposal, teamName)}: ${p(be.even)}). B_win and the chance they accept don't move with κ, so their EG = (B_win + κ × g) × P_complete cross ${be.kappa === null ? "at no κ ≥ 0" : `at **κ ≈ ${fmt(be.kappa, 2)}**: from there the even trade out-ranks today's #1`} (the rest of the list moves too, and the diversity rules apply).`,
      "",
    );
  } else L.push(`**Break-even κ**: none to compute (today's #1 is already within ${pctSigned(config.explain.valueEven, 0)} of even, there is no even trade among the shown ones, or the league has no market term).`, "");
  const pr = x.pruning;
  L.push("**N11, the dominance pruning in screening** (lead decision N11, ⚠️ ours): a screened trade that gives a player of yours worth less than W is dropped when the same trade without him (same partner and players of theirs, your side keeping at least one player) was screened and kept with an objective at least as high. Measured by running the screening again on this context:", "");
  if (!pr) L.push("- not measured (the search stops before screening).", "");
  else
    L.push(
      `- Your give pool: ${pr.give.length} players, ${pr.belowW.length} of them worth less than W (${valueText(pr.W)}): ${pr.belowW.map((id) => `${nameOf(x.snapshot, id)} (${valueText(x.I.values[id] ?? 0)})`).join(", ") || "none"}.`,
      `- Screens: ${thousands(pr.screened)} (the search's own count: ${thousands(x.result.counts.screened)}); inside the value window: ${thousands(pr.inWindow)}; dropped by the pruning: **${thousands(pr.dropped)}**.`,
      `- Of the ${pr.exact.with} trades sent to exact evaluation, **${pr.cheap.with} give a player worth less than W, against ${pr.cheap.without} of ${pr.exact.without} without the pruning**.`,
      "",
    );
}

function renderStar(L: string[], x: RenderInput, teamName: (id: string) => string): void {
  const st = x.star;
  const s = x.snapshot;
  const sp = config.acceptance.starPremium;
  L.push("## 4. The Smith-Njigba example: a star for three RBs", "");
  L.push(
    `Parker's question to the planner: "Would someone really give up Smith-Njigba for three RBs?" The planner's anchor (section 8): a partner gets 4,000 + 3,500 + 3,500 for its #1 top-12 player (9,000), a contender, n 0.6, filling a hole: **51.3% before the addendum, 23.4% after** (computed: ${pctPlain((x.premiumAnchors[2]?.withoutPremium ?? Number.NaN) / 100, 2)} → ${pctPlain((x.premiumAnchors[2]?.computed ?? Number.NaN) / 100, 2)}). Below, the same question on the real rosters, every trade through the Trade Analyzer in both models (before: no star premium; after: the app's).`,
    "",
  );
  if (!st.playerId || !st.teamId) {
    L.push(`${STAR_NAME} isn't on another team's active roster in this league, so there is no package to try.`, "");
  } else {
    const pr = st.premium;
    L.push(
      `**${playerLabel(s, st.playerId)}** is ${teamName(st.teamId)}'s #${pr?.rank ?? "–"} by trade value (${valueText(st.value)})${pr?.elite ? ` and among FantasyCalc's top ${sp.eliteTop}` : ""}: e ${fmt(pr?.e ?? 0, 2)} (${pr ? [pr.rank <= sp.rank.length ? `#${pr.rank} ${fmt(sp.rank[pr.rank - 1] ?? 0, 2)}` : null, pr.elite ? `top-${sp.eliteTop} ${fmt(sp.elite, 2)}` : null].filter(Boolean).join(" + ") : "–"})${pr?.harderToGet ? ', tagged "Harder to get"' : ""}. Your ${STAR_PACKAGE.pos}s: ${st.mine.map((id) => `${nameOf(s, id)} (${valueText(x.I.values[id] ?? 0)})`).join(", ") || "none"}: ${st.packages.length} package${st.packages.length === 1 ? "" : "s"} of ${STAR_PACKAGE.size}.`,
      "",
    );
    if (st.packages.length) {
      L.push(`| Package for ${nameOf(s, st.playerId)} | Their g (market) | n (ΔLineup/wk) | Their holes | Before: P_accept / P_complete / z | After: P_accept / P_complete / z | Helps you (after) |`, "|---|---|---|---|---|---|---|");
      for (const p of st.packages) {
        const b = p.before;
        const a = p.after;
        if (!a || !b) {
          L.push(`| ${names(s, p.give)} | – | – | – | ${p.illegal ?? "–"} | – | – |`);
          continue;
        }
        L.push(`| ${names(s, p.give)}${p === st.pick ? " (the old model's most likely)" : ""} | ${pctSigned(a.gPartner)} | ${signed(a.features.n, 2)} (${signed(a.partnerDeltaLineup)}) | ${a.detail.holes.join(", ") || "none"} | ${pctPlain(b.pAccept)} / ${pctPlain(b.pComplete)} / ${signed(b.features.z, 2)} | ${pctPlain(a.pAccept)} / ${pctPlain(a.pComplete)} / ${signed(a.features.z, 2)} | ${a.tradeScore ?? "– (B ≤ 0)"} |`);
      }
      L.push("");
      const legal = st.packages.filter((p) => p.before && p.after);
      if (legal.length) {
        const range = (f: (p: StarRow) => number, show: (v: number) => string) => {
          const v = legal.map(f);
          return `${show(Math.min(...v))} to ${show(Math.max(...v))}`;
        };
        const [lo] = config.acceptance.pAcceptClamp;
        const [gLo] = config.acceptance.gClamp;
        const floorB = legal.filter((p) => ((p.before as TradeEvaluation).pAccept as number) <= lo + EPS).length;
        const floorA = legal.filter((p) => ((p.after as TradeEvaluation).pAccept as number) <= lo + EPS).length;
        const holes = [...new Set(legal.flatMap((p) => (p.after as TradeEvaluation).detail.holes))];
        const filled = legal.filter((p) => (p.after as TradeEvaluation).features.h === 1).length;
        const clamped = legal.filter((p) => (p.after as TradeEvaluation).gPartner <= gLo + EPS).length;
        const vetoed = legal.filter((p) => (p.after as TradeEvaluation).detail.vetoRisk).length;
        L.push(
          `**Range over the ${legal.length} packages**: their g at market ${range((p) => (p.after as TradeEvaluation).gPartner, (v) => pctSigned(v))} (${clamped} past the model's ${pctSigned(gLo, 0)} clamp, where the star premium can't lower it further); n ${range((p) => (p.after as TradeEvaluation).features.n, (v) => signed(v, 2))} (the RBs ${legal.every((p) => (p.after as TradeEvaluation).partnerDeltaLineup < 0) ? "lower their lineup in every package" : "help their lineup in some packages"}); ${holes.length ? `their holes: ${holes.join(", ")}, filled in ${filled} of ${legal.length}` : `${teamName(st.teamId)} has no hole for them to fill`}; P_accept before ${range((p) => (p.before as TradeEvaluation).pAccept, (v) => pctPlain(v))} (${floorB} at the ${pctPlain(lo, 0)} floor), after ${range((p) => (p.after as TradeEvaluation).pAccept, (v) => pctPlain(v))} (${floorA} at the floor)${vetoed ? `; the veto rule halves P_complete in ${vetoed} of them (the league votes on trades)` : ""}. ${floorA === legal.length && floorB === legal.length ? `**A long shot in both models: every package sits at the ${pctPlain(lo, 0)} floor before and after**, so the star premium can't lower the number; it shows in z and in the card's reason. The planner's 51% → 23% comes from the anchor's own values (an even package that fills a hole), not from ${teamName(st.teamId)}'s roster.` : "The star premium lowers the chance of every package the floor doesn't hold."}`,
          "",
        );
      }
      const pick = st.pick;
      if (pick?.before && pick.after) {
        const b = pick.before;
        const a = pick.after;
        L.push(`**The package the old model rated most likely**: you give ${names(s, pick.give)} for ${nameOf(s, st.playerId)} (old P_accept ${pctPlain(b.pAccept)}, z ${signed(b.features.z, 2)}; new ${pctPlain(a.pAccept)}, z ${signed(a.features.z, 2)}). Its acceptance terms, logit units:`, "");
        L.push("| Term | Before | After | In words (after) |", "|---|---|---|---|");
        const rows = termRows(a, s, x.I);
        for (const r of rows) L.push(`| ${r.term} | ${signed(b.detail.terms[r.term], 2)} | ${signed(r.logit, 2)} | ${r.words} |`);
        L.push(`| **z** | **${signed(b.features.z, 2)}** | **${signed(a.features.z, 2)}** | P_accept ${pctPlain(b.pAccept)} → ${pctPlain(a.pAccept)}${a.detail.vetoRisk ? `; the league votes on trades and their g at market is under ${pctSigned(config.acceptance.veto.gBelow, 0)}, so P_complete is halved: ${pctPlain(a.pComplete)}` : ""} |`, "");
        const words = placeholderWords(x.I, a);
        L.push(`Its reasons after the addendum (the Analyzer's card): ${words.reasons.map((w) => `“${w}”`).join(" ")}`, "");
      }
    }
  }
  L.push(`**Star trades on these rosters**: the lead's value-even examples (⚠️ chosen by name), then every trade the before model showed that gets a "Harder to get" player. Each cell: Helps you / Chance they accept / Overall; the trade's place among the shown trades when it is one, else the stage of that model's search that dropped it (section 2's stages).`, "");
  L.push("| Trade | Their g: market → as they see it | Star premium | Before: place · Helps / Chance / Overall | After: place · Helps / Chance / Overall | P_accept, before → after |", "|---|---|---|---|---|---|");
  const afterRank = new Map(x.variants[x.settings.protectValue].result.trades.map((t, i) => [t.key, i + 1]));
  const beforeRank = new Map(x.variants.before.result.trades.map((t, i) => [t.key, i + 1]));
  const place = (m: Map<string, number>, t: TradeEvaluation, tr: SearchTrace) => {
    const k = m.get(t.key);
    return k === undefined ? `not shown (${stageTag(dropStage(tr, t.proposal))})` : `#${k}`;
  };
  const row = (r: StarRow, label: string) => {
    if (r.missing.length) {
      L.push(`| ${label} | – | – | not on these rosters now: ${r.missing.join(", ")} | – | – |`);
      return;
    }
    const a = r.after;
    const b = r.before;
    if (!a || !b) {
      L.push(`| ${label} | – | – | ${r.illegal ?? "can't be evaluated"} | – | – |`);
      return;
    }
    const premium = (a.detail.premium ?? []).filter((p) => p.e > 0).map((p) => `${nameOf(s, p.playerId)} e ${fmt(p.e, 2)}${p.harderToGet ? " [Harder to get]" : ""}`);
    L.push(`| ${label} | ${pctSigned(a.gPartner)} → ${pctSigned(a.features.g)} | ${premium.join("; ") || "–"} | ${place(beforeRank, b, x.traces.before)} · ${threeNumbers(b)} | ${place(afterRank, a, x.traces.after)} · ${threeNumbers(a)} | ${pctPlain(b.pAccept)} → ${pctPlain(a.pAccept)} |`);
  };
  const lineOf = (r: StarRow, give: readonly string[], get: readonly string[]) => (r.partnerId ? `${teamName(r.partnerId)}: ` : "") + `${r.give.length === give.length ? names(s, r.give) : give.join(" + ")} → ${r.get.length === get.length ? names(s, r.get) : get.join(" + ")}`;
  st.named.forEach((r, i) => {
    const ex = STAR_TRADES[i] as (typeof STAR_TRADES)[number];
    row(r, lineOf(r, ex.give, ex.get));
  });
  const namedKeys = new Set(st.named.flatMap((r) => (r.before ? [r.before.key] : [])));
  for (const ss of st.shownStars) if (!namedKeys.has(ss.row.before?.key ?? "")) row(ss.row, `${tradeLine(s, { partnerId: ss.row.partnerId as string, give: asPlayers(ss.row.give), get: asPlayers(ss.row.get) }, teamName)} (shown before)`);
  if (!st.named.length && !st.shownStars.length) L.push("| none | – | – | – | – | – |");
  L.push("");
  const evenRows = [...st.named, ...st.shownStars.map((x2) => x2.row)].filter((r) => r.before && r.after);
  if (evenRows.length) {
    const ratio = evenRows.map((r) => (r.after as TradeEvaluation).pAccept / (r.before as TradeEvaluation).pAccept);
    const first = x.premiumAnchors[0];
    const anchorRatio = first ? first.computed / first.withoutPremium : Number.NaN;
    const [floor] = config.acceptance.pAcceptClamp;
    const floored = evenRows.filter((r) => (r.before as TradeEvaluation).pAccept <= floor + EPS && (r.after as TradeEvaluation).pAccept <= floor + EPS).length;
    L.push(`On these star trades the chance they accept falls to ${pctPlain(Math.min(...ratio), 0)}–${pctPlain(Math.max(...ratio), 0)} of what it was before the addendum${floored ? ` (${floored} at the ${pctPlain(floor, 0)} floor in both models)` : ""}; the planner's own 1-for-1 anchor for a #1 top-12 player goes ${fmt(first?.withoutPremium, 1)}% → ${fmt(first?.computed, 1)}%, to ${pctPlain(anchorRatio, 0)}.`, "");
  }
}

/** "value −0.62 / extra −0.25 / lineup +0.05 / rest 0.00" (a step's change in z by part). */
const dzText = (d: StepCandidate["dz"]): string => `value ${signed(d.value, 2)} / extra player ${signed(d.extra, 2)} / their lineup ${signed(d.lineup, 2)} / rest ${signed(d.rest, 2)}`;

/** A step case in words (the search's per-side maximum: the report's settings). */
function stepCaseWords(c: StepCase, maxPerSide: number): string {
  switch (c) {
    case "holdBack":
      return "1: hold a throw-in back";
    case "add":
      return "2: add a throw-in";
    case "noRoom":
      return `none: you already give ${maxPerSide}, the most a side`;
    case "noThrowIn":
      return "none: every throw-in is in the trade";
    case "noHelp":
      return "none: the trade doesn't help you on the screening seasons";
    case "illegal":
      return "none: the trade isn't legal as a version";
  }
}

function renderSteps(L: string[], x: RenderInput, teamName: (id: string) => string): void {
  const d = x.steps;
  const s = x.snapshot;
  const cfg = stepConfig();
  const W = d.W;
  L.push('## 5. "Offer first / if they say no": how many cards show a step, and why', "");
  L.push(`**Cards with an "If they say no" step: ${d.withSteps} of ${x.result.trades.length}.**`, "");
  L.push(
    `The rule (§4 of the addendum; lead decision N4): a throw-in is a player of yours whose loss costs you at most ${cfg.throwInMaxCost} lineup points against your free-agent-optimized roster, in scenario lineups (so an injury and bye backup isn't free). Case 1: a trade that gives a throw-in (and keeps a player on your side without him) is offered first without the lowest-value one, and he's added back if they say no. Case 2: otherwise the ranked trade is offered first, and the throw-in added if they say no is the one with the highest chance it goes through while B stays at least ${fmt(100 * cfg.minBShare, 0)}% of the offer's. A step is shown only when it raises the chance it goes through (P_complete) by at least ${fmt(100 * cfg.minAcceptGain, 0)} points, the offer first is at least ${fmt(100 * cfg.minOfferFirst, 0)}% likely, and the offer first helps you. Both versions are compared on the ${thousands(config.simulation.screeningSims)}-season screening block, as the search does.`,
    "",
  );
  L.push(`Your throw-ins, against the waiver credit W = ${valueText(W)} (§9 charges the side that receives more players W for each roster spot it must open):`, "");
  L.push("| Throw-in | Trade value | Value − W | Lineup cost (exact mode) | In shown trades |", "|---|---|---|---|---|");
  const signedValue = (v: number) => `${v > 0.5 ? "+" : v < -0.5 ? MINUS : ""}${valueText(Math.abs(v))}`;
  for (const t of d.throwIns) L.push(`| ${playerLabel(s, t.id)} | ${valueText(t.value)} | ${signedValue(t.value - W)} | ${fmt(t.cost, 1)} | ${x.result.trades.filter((tr) => playerIds(tr.proposal.give).includes(t.id)).length} |`);
  if (!d.throwIns.length) L.push("| none | – | – | – | – |");
  L.push("");
  L.push(`Measured: every shown trade's possible steps, each version exactly evaluated with the screening simulation (evaluate.tradeVersion, as the search's steps are), **without the search's pre-screen** (case 1: each throw-in in the trade held back; case 2: each throw-in added). The row shows the step the rule would choose (case 2: the best of those keeping B; else the one with the largest gain), its chance it goes through for the offer first → with the throw-in, and the change in z (logit units) by part.`, "");
  L.push("| # | Trade | Case | Step | P_complete: offer first → if they say no | Gain | Change in z | Shown? Why not |", "|---|---|---|---|---|---|---|---|");
  for (const r of d.rows) {
    const shownC = r.rule ?? [...r.candidates].sort((a, b) => b.gain - a.gain)[0] ?? null;
    const step = shownC ? `${r.stepCase === "holdBack" ? "hold back" : "add"} ${nameOf(s, shownC.throwIn)} (${valueText(shownC.value)})` : "–";
    const why = r.shown ? "**shown**" : shownC ? (shownC.fails.length ? shownC.fails.join("; ") : r.preScreenKeeps === false ? "the pre-screen missed it" : "–") : "no candidate";
    L.push(`| ${r.rank} | ${tradeLine(s, r.trade.proposal, teamName)} | ${stepCaseWords(r.stepCase, x.settings.maxPerSide)} | ${step} | ${shownC ? `${pctPlain(shownC.offer.pComplete)} → ${pctPlain(shownC.full.pComplete)}` : "–"} | ${shownC ? pts(shownC.gain) : "–"} | ${shownC ? dzText(shownC.dz) : "–"} | ${why} |`);
  }
  L.push("");
  if (!d.candidates) {
    L.push("No candidate step to measure.", "");
    return;
  }
  const best = d.best;
  const cheap = d.throwIns.filter((t) => t.value < W);
  L.push(`**${d.withSteps ? "What decides it" : "Why none qualifies"}**, over all ${d.candidates} candidate versions:`, "");
  if (best) L.push(`- The largest gain any throw-in brings is **${pts(best.c.gain)}** (#${best.row.rank}, ${best.row.stepCase === "holdBack" ? "holding back" : "adding"} ${nameOf(s, best.c.throwIn)}: ${pctPlain(best.c.offer.pComplete)} → ${pctPlain(best.c.full.pComplete)}); ${d.reaching} of ${d.candidates} reach the +${fmt(100 * cfg.minAcceptGain, 0)} a step needs. On average a throw-in moves the chance by ${pts(d.meanGain)}.`);
  L.push(
    `- The value term: §9's waiver credit makes the side that receives more players open a roster spot worth W, so a throw-in raises the partner's g only when he's worth more than W × (1 + g) (more than W when you give fewer players than you get). ${cheap.length} of your ${d.throwIns.length} throw-ins are worth less than W (${cheap.map((t) => nameOf(s, t.id)).join(", ") || "none"}); their g as they see it rises in only ${d.raiseG} of the ${d.candidates} versions, and near the g clamp (${pctSigned(config.acceptance.gClamp[1], 0)}) more value adds nothing. On average the value term moves z by ${signed(d.meanDz.value, 2)}.`,
  );
  L.push(`- The extra player: §11's complexity term costs ${signed(-config.acceptance.beta.complexity, 2)} in z for each player beyond a 1-for-1 (on average ${signed(d.meanDz.extra, 2)} here), their lineup moves it by ${signed(d.meanDz.lineup, 2)}, the rest by ${signed(d.meanDz.rest, 2)}: ${signed(d.meanDz.total, 2)} in all on average.`);
  if (d.preScreen.trades) L.push(`- Case 2's pre-screen (the best ${cfg.preScreen} candidates by the screening's quick estimate get exact evaluation, ⚠️ for speed) kept the rule's exact choice in **${d.preScreen.kept} of ${d.preScreen.trades}** trades.`);
  L.push("");
}

function renderTags(L: string[], x: RenderInput, teamName: (id: string) => string): void {
  const tg = x.tags;
  const s = x.snapshot;
  const sp = config.acceptance.starPremium;
  L.push('## 6. "Harder to get": who carries the tag, and the League page\'s partner rows', "");
  L.push(
    `The star premium (§1 of the addendum; lead decision N1): a manager values his own best players a bit above market. For each player, e = e_rank + e_elite: e_rank by his rank by trade value on his own roster (#1 ${fmt(sp.rank[0] ?? 0, 2)}, #2 ${fmt(sp.rank[1] ?? 0, 2)}, others 0; ties: more ROS points), e_elite ${fmt(sp.elite, 2)} when he's among FantasyCalc's top ${sp.eliteTop} in the league's format. "Harder to get" (§2): e ≥ ${fmt(sp.harderToGetMin, 2)}, a top-${sp.eliteTop} player who is also his team's #1 or #2. The trade context's numbers (each team's baseline odds; the dynasty halving for a rebuilding team doesn't apply in ${s.settings.leagueType === "dynasty" ? "this league's non-rebuilding teams" : "a redraft league"}). The League page shows the tag on other teams' players only.`,
    "",
  );
  L.push(`**FantasyCalc's top ${sp.eliteTop}** in this league's format:`, "");
  L.push("| # | Player | Value | Rostered by | His rank there | Tag |", "|---|---|---|---|---|---|");
  tg.elite.forEach((e, i) => {
    const p = e.teamId ? x.I.premiums.get(e.teamId)?.[e.id] : undefined;
    L.push(`| ${i + 1} | ${playerLabel(s, e.id)} | ${valueText(e.value)} | ${e.teamId ? teamName(e.teamId) : "free agent"} | ${e.rank === null ? "–" : `#${e.rank}`} | ${p?.harderToGet ? "Harder to get" : "–"} |`);
  });
  if (!tg.elite.length) L.push("| – | no FantasyCalc values | – | – | – | – |");
  L.push("");
  const tagged = tg.teams.flatMap((t) => t.players.filter((p) => p.harderToGet).map((p) => ({ teamId: t.teamId, p })));
  L.push(`**Every team's premium players** (e > 0, best rank first; ${tagged.length} tagged "Harder to get" in all, ${tagged.filter((t) => t.teamId !== x.result.myTeamId).length} on other teams):`, "");
  L.push("| Team | Players (rank by value · top-12 · e) |", "|---|---|");
  for (const t of tg.teams) {
    const list = t.players.map((p) => `${p.harderToGet ? "**" : ""}${nameOf(s, p.id)}${p.harderToGet ? "**" : ""} #${p.rank}${p.elite ? " · top-12" : ""} · e ${fmt(p.e, 2)} (${valueText(p.value)})${p.harderToGet ? " · Harder to get" : ""}`);
    L.push(`| ${t.teamId === x.result.myTeamId ? `Team ${t.teamId} (you: the tag never shows on your own players)` : teamName(t.teamId)} | ${list.join("; ") || "–"} |`);
  }
  L.push("");
  L.push(
    `**The League page's partner rows** (buildLeagueView on the League model the page builds: default settings, ${thousands(config.simulation.finalSims)} seasons). "Best target" is the best of their trade chips without the tag who adds at least ${config.needs.bestTargetMin} projected point${config.needs.bestTargetMin === 1 ? "" : "s"} a week to your lineup as printed (N12); a tagged single best follows as "Bigger upgrade, harder to get", or leads alone as "Best target, harder to get" when no untagged one clears that floor. The page's own note under the cards:`,
    "",
    `> ${BEST_TARGET_NOTE}`,
    "",
  );
  if (!tg.cards.length) L.push(`No partner cards: ${tg.empty ?? "none fit."}`, "");
  for (const c of tg.cards) {
    const theirs = [...c.theyCanGive.players.map((p) => `${p.text}${p.tag ? " [Harder to get]" : ""}`), ...(c.theyCanGive.more ? [c.theyCanGive.more.text] : [])];
    const mine = [...c.youCanGive.players.map((p) => p.text), ...(c.youCanGive.more ? [c.youCanGive.more.text] : [])];
    L.push(`- **${c.name}** (${c.fitText}): ${c.targets.map((t) => `${t.label}: ${t.text}`).join(" · ") || "no lead line"}${theirs.length ? ` · ${c.theyCanGive.label} ${theirs.join(", ")}` : ""} · ${c.youCanGive.label} ${mine.join(", ") || "nobody"}`);
  }
  L.push("");
}

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
  L.push("## 7. Consistency check: no B from free-agent pickups", "");
  L.push(
    `**By construction.** B compares your team before and after the trade, and both sides of that comparison are free-agent-optimized rosters (V*, §7): the baseline is every team at V*(T) (evaluate.ts buildTradeContext: each team's weekly scores from its V*(T) lineups, one common-random-numbers matrix), and every trade's "after" is legality's roster run through the same optimizer from scratch, for you and for the partner (evaluateExact: \`optimizer.optimize(post-legality roster)\`), simulated on the same seasons. With availability scenarios, V* picks its moves by their gain in the same scenario lineups B is measured in, on both sides, so a pickup you could make anyway (a depth pickup included) is made in both rosters, moves both odds alike and cancels in ΔPO and ΔCH; a trade gets credit only for what the pickups can't do. (An open roster spot the trade creates is worth what the best free agent adds there, as §7 says.) **N10** (⚠️ ours, reported to the planner) closes the same gap in the market term: B's market term counts each player you give at no less than the waiver credit W, because a player worth less than the best free agent is replaceable and V*(you) already replaces him, so dumping him isn't a value gain either (the card's values and g_mkt stay the market's).`,
    "",
  );
  L.push(
    `**The tests.** (1) \`src/engine/evaluate.test.ts\`, "the simulation behind B (M4)" › "Checkpoint 4: a trade whose whole effect a free-agent pickup reproduces gets no B from it (ΔPO = ΔCH = 0 exactly)": my weak WR2 and a free-agent WR that V*(me) picks up (dropping my bench WR); a partner's bench WR identical to that free agent in every way but his id. Trading my bench WR for him does exactly what the pickup does; it asserts V*(me) makes that one pickup, that after the trade V* picks up nobody, that my weekly score means are equal before and after, and that ΔPO, ΔCH, ΔEW and B_win are exactly 0 at 5,000 seasons. Next to it, "a no-op (my V* and the partner's unchanged) moves no odds" asserts ΔPO = ΔCH = ΔEW = 0 exactly at both simulation counts. (2) In scenario lineups: \`src/engine/evaluate.consistency.test.ts\`, "Checkpoint 4 consistency in scenario lineups" › "a depth pickup a trade reproduces gets no B: ΔPO = ΔCH = ΔEW = 0 exactly": a free-agent TE who never starts in the average-case lineup but plays when an RB is hurt; V*(me) picks him up by his scenario gain (under ${fo.faMinGain} in expected-value lineups, over it in scenario ones), and trading the player that pickup drops for a partner's identical TE gives B_win 0 exactly at 5,000 seasons. (3) N10: \`src/engine/evaluate.addendum.test.ts\`, "B's market term with my given players at max(v, W) (N10)" › "a player V* drops anyway, worth less than W, given for nothing: B = 0 at Low, Medium and High" (before the addendum the same trade scored B > 0 from the open spot's credit).`,
    "",
  );
  // The measured bound.
  const g = x.giveAway;
  L.push(
    `**The measured bound.** V* only makes a move worth at least faMinGain (${fo.faMinGain} lineup points), so a smaller swap stays undone in the baseline; a trade that sends that player away can realize it (legality fills the open spot with the best free agent, and V* re-runs), and B_win counts it. So "no B from pickups" holds up to about faMinGain per player given (⚠️ a known approximation, reported to the planner). Measured below for each of your throw-ins and each of your players worth less than W: him alone for nothing, evaluated exactly, with only your side changed in the simulation (the partner's row left at its baseline), on the ${thousands(config.simulation.finalSims)}-season block. Lineup points: Σ ω × LV over the remaining weeks (playoff weeks × ${x.settings.playoffWeight}), the exact mode's lineups.`,
    "",
  );
  if (!g.length) L.push("No such player (or no odds).", "");
  else {
    // Against V*(you): a free agent added, one of your players V*(you) would drop kept instead, or one it keeps dropped.
    const mineBefore = new Set(x.I.me?.roster ?? []);
    const adds = (r: GiveAwayRow) => r.ins.filter((id) => !mineBefore.has(id));
    L.push(`| Player | Value (W ${valueText(x.I.credit)}) | Lineup cost | In shown trades | Your lineup points when he leaves | Your roster then, against your optimized one | B_win, your side | B: before / ${PROTECT_VALUE_LEVELS.map((v) => LEVEL_WORDS[v]).join(" / ")} |`, "|---|---|---|---|---|---|---|---|");
    for (const r of g) {
      if (r.illegal) {
        L.push(`| ${playerLabel(s, r.playerId)} | ${valueText(r.value)} | ${fmt(r.cost, 1)} | ${r.inShown} | – | ${r.illegal} | – | – |`);
        continue;
      }
      const moved = [...r.ins.map((id) => (mineBefore.has(id) ? `keeps ${nameOf(s, id)}` : `adds ${nameOf(s, id)}`)), ...r.outs.map((id) => `drops ${nameOf(s, id)}`)].join(", ") || "the same otherwise";
      L.push(`| ${playerLabel(s, r.playerId)} | ${valueText(r.value)}${r.value < x.I.credit ? " (< W)" : ""} | ${fmt(r.cost, 1)} | ${r.inShown} | ${signed(r.ros, 2)} | ${moved} | ${signed(r.bWin, 3)} | ${fmt(r.bBefore, 3)} / ${PROTECT_VALUE_LEVELS.map((v) => fmt(r.b[v], 3)).join(" / ")} |`);
    }
    L.push("");
    const pos = g.filter((r) => finite(r.ros) && (r.ros as number) > EPS);
    const top = pos[0];
    const cheapRows = g.filter((r) => !r.illegal && r.value < x.I.credit);
    const zeroTerm = cheapRows.filter((r) => PROTECT_VALUE_LEVELS.every((v) => finite(r.b[v]) && finite(r.bWin) && Math.abs((r.b[v] as number) - (r.bWin as number)) <= 1e-9));
    L.push(
      `"Keeps" is one of your players your optimized roster would drop, kept instead; "adds" a free agent; "drops" one your optimized roster keeps (the optimizer's greedy path can end elsewhere once a player leaves).`,
      "",
      top
        ? `**Largest: ${nameOf(s, top.playerId)} → ${adds(top).map((id) => nameOf(s, id)).join(", ") || "the refill"}, ${signed(top.ros, 2)} lineup points** (B_win ${signed(top.bWin, 3)} from your side), in ${top.inShown} shown trade${top.inShown === 1 ? "" : "s"}: well under faMinGain (${fo.faMinGain}), the bound. ${pos.length} of ${g.length} player${g.length === 1 ? "" : "s"} realize${pos.length === 1 ? "s" : ""} such a swap when ${pos.length === 1 ? "he leaves" : "they leave"}.`
        : `None of these players realizes a skipped swap when he leaves (every change ≤ 0): within the bound.`,
      "",
      `For the ${cheapRows.length} worth less than W, the market term adds ${zeroTerm.length === cheapRows.length ? "exactly 0 at every level (B = B_win)" : `0 at every level for ${zeroTerm.length}`}: N10's floor. Before the addendum the open spot's credit counted twice, and the market term alone gave each one B for nothing: ${cheapRows.map((r) => `${nameOf(s, r.playerId)} ${signed(finite(r.bBefore) && finite(r.bWin) ? r.bBefore - r.bWin : null, 2)}`).join(", ") || "–"}.`,
      "",
    );
  }
  if (!c.rows.length) {
    L.push("No trades to re-evaluate.", "");
    return;
  }
  const same = c.rows.filter((r) => !r.differ.length).length;
  L.push(
    `**Empirically.** Each trade shown, re-evaluated by analyzeTrade (the Trade Analyzer) in a fresh evaluation context (built in ${ms(c.contextMs)}; every memo empty): B and the card's other numbers (${COMPARED.join(", ")}) compared with the search's bit for bit (Object.is). **${same} of ${c.rows.length} match exactly.** Your pickups before any trade (V*(you)): ${movesText(s, c.myBefore)}.`,
    "",
  );
  L.push("| # | Partner | B, search | B, Analyzer | Same numbers | Your pickups after the trade | Pickups you'd make anyway (in both) | Their pickups after |", "|---|---|---|---|---|---|---|---|");
  const before = new Set(addsOf(c.myBefore));
  for (const r of c.rows) {
    const shared = addsOf(r.myAfter).filter((id) => before.has(id));
    L.push(`| ${r.rank} | ${teamName(r.partnerId)} | ${fmt(r.bSearch, 4)} | ${fmt(r.bAnalyzer, 4)} | ${r.differ.length ? `differ: ${r.differ.join(", ")}` : "yes"} | ${movesText(s, r.myAfter)} | ${shared.map((id) => s.players[id]?.name ?? id).join(", ") || "–"} | ${movesText(s, r.theirAfter)} |`);
  }
  L.push("");
  const first = x.result.trades[0];
  const row = c.rows[0];
  if (first && row) {
    const pid = first.proposal.partnerId;
    const theirBefore = c.before[pid] ?? [];
    const myShared = addsOf(row.myAfter).filter((id) => before.has(id));
    const theirShared = addsOf(row.theirAfter).filter((id) => addsOf(theirBefore).includes(id));
    L.push(`**Trade 1 in detail** (you give ${players(s, playerIds(first.proposal.give))}, get ${players(s, playerIds(first.proposal.get))}): the free-agent moves V* makes on each roster.`, "");
    L.push("| Team | Before the trade (baseline) | After the trade |", "|---|---|---|");
    L.push(`| ${teamName(x.result.myTeamId ?? "")} | ${movesText(s, c.myBefore)} | ${movesText(s, row.myAfter)} |`);
    L.push(`| ${teamName(pid)} | ${movesText(s, theirBefore)} | ${movesText(s, row.theirAfter)} |`);
    L.push("");
    L.push(
      `Pickups made both before and after (they cancel in B): you ${myShared.map((id) => s.players[id]?.name ?? id).join(", ") || "none"}; ${teamName(pid)} ${theirShared.map((id) => s.players[id]?.name ?? id).join(", ") || "none"}. Gains are each move's expected-value lineup points (playoff weeks × ${x.settings.playoffWeight}); with availability scenarios V* picks its moves by their scenario gain, so a depth pickup can show a small expected-value gain.`,
      "",
    );
  }
}

function renderAnchors(L: string[], anchors: readonly AnchorRow[], premium: readonly AnchorRow[]): void {
  L.push("## 8. The acceptance anchor tests (§11, and the addendum's star premium)", "");
  L.push(
    `The planner's 8 §11 scenarios through acceptance() itself (src/engine/acceptance.ts) with the default coefficients (β0 ${fmt(config.acceptance.beta.b0, 1)}, β_gain ${config.acceptance.beta.gain}, β_loss ${config.acceptance.beta.loss}, β_need ${config.acceptance.beta.need}, β_hole ${config.acceptance.beta.hole}, β_cx ${config.acceptance.beta.complexity}, β_act ${config.acceptance.beta.activity}, β_hist ${config.acceptance.beta.history}): a redraft league without trade review, a partner with no trade history and 40% playoff odds (no season context), features not named at 0, n entered as ΔLineup = n × ${config.acceptance.nScale}; they must be within ±${ANCHOR_TOLERANCE} point. Then the addendum's 6 star-premium scenarios (planner-reply-3b §1, W = ${thousands(PREMIUM_ANCHOR_W)}), within ±${PREMIUM_ANCHOR_TOLERANCE}, through the real functions: premium.eliteIds and teamPremiums give each player's e from a FantasyCalc list and the partner's roster, premium.perceivedPackage the partner's g as it sees it (v′ = v × (1 + e) on what it gives, W unchanged), benefit.tradePackage the market g, and acceptance() the estimate (a contender has 70% playoff odds). The last column is the same scenario without the star premium (the model before the addendum). src/engine/acceptance.test.ts runs both tables.`,
    "",
  );
  L.push("| # | Scenario | Planner | Computed | Difference | Tolerance | Pass | Without the star premium |", "|---|---|---|---|---|---|---|---|");
  const all = [...anchors, ...premium];
  all.forEach((a, i) => {
    const planner = a.plannerBefore !== null && Math.abs(a.plannerBefore - a.planner) > 1e-9 ? `${fmt(a.planner)}% (${fmt(a.plannerBefore)}% before)` : `${fmt(a.planner)}%`;
    L.push(`| ${i + 1} | ${a.name} | ${planner} | ${fmt(a.computed, 2)}% | ${signed(a.diff, 2)} | ±${a.tolerance} | ${a.pass ? "yes" : "**NO**"} | ${fmt(a.withoutPremium, 2)}% |`);
  });
  const pass = all.filter((a) => a.pass).length;
  const pA = anchors.filter((a) => a.pass).length;
  const pP = premium.filter((a) => a.pass).length;
  const beforeOk = premium.filter((a) => a.plannerBefore !== null).every((a) => Math.abs(a.withoutPremium - (a.plannerBefore as number)) <= PREMIUM_ANCHOR_TOLERANCE);
  L.push(
    "",
    `${pass} of ${all.length} within their tolerance (§11: ${pA} of ${anchors.length} within ±${ANCHOR_TOLERANCE}; the addendum: ${pP} of ${premium.length} within ±${PREMIUM_ANCHOR_TOLERANCE}, and its "before" values ${beforeOk ? "within ±" + PREMIUM_ANCHOR_TOLERANCE + " too" : "**off**"}).${pass === all.length ? " **Pass.**" : " **FAIL.**"}`,
    "",
  );
}

const CONTEXT_STAGES: readonly [string, string][] = [
  ["league model", "League model steps 1–6 (projections, scenarios, values, streaming, V* for every team, lineup costs, chips)"],
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
  ["steps", "the shown trades' \"Offer first\" steps and words"],
  ["total", "search, total"],
];

function renderRuntime(L: string[], x: RenderInput): void {
  const r = x.runtime;
  const c = x.result.counts;
  L.push("## 9. Runtime", "");
  L.push(
    `Node ${process.version} on this machine, not the browser's Web Worker (the worker runs the same generator in time slices). Each number is the median of ${r.runs.length} timed run${r.runs.length === 1 ? "" : "s"} after ${r.warmups} warm-up; every run builds its own evaluation context, then searches with the default settings. ${r.sameEveryRun ? "Every run, warm-up included, returned the same trades with the same numbers (deterministic)." : "**The runs did not all return the same trades.**"} Browser timings aren't measured here: they come from the production worker check (the real engine.worker.ts bundled by esbuild in production mode, minified, run in headless Chrome on the same league), reported with Checkpoint 4.`,
    "",
  );
  L.push("| Stage | Median |", "|---|---|");
  for (const [k, label] of CONTEXT_STAGES) if (r.context[k] !== undefined) L.push(`| ${label} | ${ms(r.context[k])} |`);
  for (const [k, label] of SEARCH_STAGES) if (r.search[k] !== undefined) L.push(`| ${label} | ${ms(r.search[k])} |`);
  L.push(`| **context + search, end to end** | **${ms(r.total)}** |`, "");
  const pr = x.pruning;
  L.push(
    `Counts: ${thousands(c.screened)} candidates screened${pr ? ` (${thousands(pr.inWindow)} inside the value window, ${thousands(pr.dropped)} of them dropped by the dominance pruning)` : ""}, ${c.exact} exactly evaluated, ${c.simScreen} simulated at ${thousands(config.simulation.screeningSims)} seasons, ${c.simFinal} at ${thousands(config.simulation.finalSims)} (the finalists), ${x.result.trades.length} shown, ${x.result.trades.filter((t) => t.steps).length} with steps; hidden by default: ${x.result.hidden.byBenefit} for B ≤ 0, ${x.result.hidden.byMarket} by the market guard. Longest stretch of work between two progress yields: ${ms(r.maxGap)} (median over the runs; the design keeps it under about 50 ms so the worker stays responsive).`,
    "",
  );
  const times = x.consistency.rows.map((row) => row.ms);
  if (times.length) L.push(`The Trade Analyzer: analyzeTrade took ${ms(median(times))} per trade (median; max ${ms(Math.max(...times))}, its steps included) over the ${times.length} re-evaluations of section 7, in a fresh context once it was built (${ms(x.consistency.contextMs)}).`, "");
  const v = x.variants;
  L.push(`Other searches in this run: the before-addendum search ${ms(v.before.ms)} (its own context included); ${PROTECT_VALUE_LEVELS.filter((l) => l !== x.settings.protectValue).map((l) => `${LEVEL_WORDS[l]} ${ms(v[l].ms)}`).join(", ")} (on the main context, its memos warm).`, "");
  L.push("This report's own run (buildTradeReport, wall clock):", "", "| Stage | Time |", "|---|---|");
  for (const [k, label] of REPORT_STAGES) if (x.timing[k] !== undefined) L.push(`| ${label} | ${ms(x.timing[k])} |`);
  L.push("");
  if (x.opts.timing && Object.keys(x.opts.timing).length) {
    L.push("Before the engine (this run's data loading):", "", "| Stage | Time |", "|---|---|");
    for (const [k, val] of Object.entries(x.opts.timing)) L.push(`| ${k} | ${ms(val)} |`);
    L.push("");
  }
}

function renderAnalyzer(L: string[], x: RenderInput, teamName: (id: string) => string): void {
  const e = x.example;
  const [gLo, gHi] = config.search.screeningGWindow;
  L.push("## 10. A Trade Analyzer example: great for you, unlikely to be accepted", "");
  L.push(
    `Found systematically: every 1-for-1 and 2-for-1 between your players and each partner's ${ANALYZER_TOP_VALUES} most valuable players (FantasyCalc values; P, K, D/ST and IDP left out on both sides, as the search does by default): ${thousands(e.candidates)} trades, ${thousands(e.illegal)} illegal (roster rules), each exactly evaluated as the Analyzer does (scenario lineups, both teams' free-agent pickups). ${thousands(e.lowAccept)} have P_accept under ${pctPlain(ANALYZER_MAX_ACCEPT, 0)}, and ${thousands(e.positive)} of those help you (B > 0 at ${thousands(config.simulation.screeningSims)} seasons). Without a limit on trade value the winners are plain lowballs (the partner gives a star for spare parts), so ⚠️ the example is chosen among the ${thousands(e.inWindow)} whose g_mkt(partner) is inside the search's own value window [${fmt(gLo, 2)}, ${fmt(gHi, 2)}] (§12: an offer the search itself could make). The ${ANALYZER_FINALISTS} best by B, inside the window and overall (${e.analyzed} trades), went through analyzeTrade itself (${thousands(config.simulation.finalSims)} seasons); the example is the highest Helps you inside the window.`,
    "",
  );
  const ex = e.extreme;
  if (ex) {
    L.push(
      `For comparison, the highest Helps you without the window: you give ${players(x.snapshot, playerIds(ex.proposal.give))} to ${teamName(ex.proposal.partnerId)} for ${players(x.snapshot, playerIds(ex.proposal.get))}: Helps you ${ex.tradeScore ?? "–"}, P_accept ${pctPlain(ex.pAccept)}, g_mkt(them) ${pctSigned(ex.gPartner)}; its value term alone is ${signed(ex.detail.terms.value, 2)} logits: ${valueTermWords(ex, x.snapshot, perceivedG(x.I, ex.proposal.partnerId, playerIds(ex.proposal.give), playerIds(ex.proposal.get), ex.gPartner) ?? null)}.`,
      "",
    );
  }
  const t = e.pick;
  if (!t) {
    L.push("No trade inside the window qualifies (none helps you with an acceptance chance under the bar).", "");
    return;
  }
  renderCard(L, x, t, `The example: with ${teamName(t.proposal.partnerId)}`, teamName);
  const rows = termRows(t, x.snapshot, x.I);
  const [pLo, pHi] = config.acceptance.pAcceptClamp;
  L.push(`**Why the acceptance estimate is low** (§11: z is the sum of these terms, in logit units; P_accept = σ(z) clamped to ${pctPlain(pLo, 0)}–${pctPlain(pHi, 0)}):`, "");
  L.push("| Term | Logit units | In words |", "|---|---|---|");
  for (const r of rows) L.push(`| ${r.term} | ${signed(r.logit, 2)} | ${r.words} |`);
  L.push(`| **z** | **${signed(t.features.z, 2)}** | P_accept = σ(z) = ${pctPlain(t.pAccept)} |`, "");
  const down = rows.filter((r) => r.term !== "base" && r.logit < -1e-9).sort((a, b) => a.logit - b.logit);
  const up = rows.filter((r) => r.logit > 1e-9).sort((a, b) => b.logit - a.logit);
  const without = (term: keyof AcceptanceTerms) => pAcceptFromLogit(t.features.z - t.detail.terms[term]);
  const what = down.map((r) => `**${r.term} ${signed(r.logit, 2)}**: ${r.words} (without it: ${pctPlain(without(r.term))})`);
  L.push(
    `Starting from ${pctPlain(logistic(config.acceptance.beta.b0))} for an even 1-for-1 with nothing else (β0 ${fmt(config.acceptance.beta.b0, 1)}), what pulled the estimate down, most first:`,
    "",
    ...(what.length ? what.map((w) => `- ${w}`) : ["- nothing beyond the starting point"]),
    "",
    `What helped: ${up.filter((r) => r.term !== "base").map((r) => `${r.term} ${signed(r.logit, 2)} (${r.words})`).join("; ") || "nothing"}.`,
    "",
  );
}

function renderOptimizer(L: string[], x: RenderInput, teamName: (id: string) => string): void {
  const o = x.optimizer;
  const s = x.snapshot;
  const fo = config.freeAgentOptimizer;
  const model = x.I.model;
  const judging = optimizerJudging(s, model);
  L.push("## 11. The free-agent optimizer (model change 2)", "");
  L.push(
    `The same rules and numbers as reports/league-report.md's optimizer section (league-report's optimizerReport on this run's League model and leagueMarginals), from the data above. Every team is measured after the pickups that help it: the best add/drop while it gains at least ${fo.faMinGain} lineup points, at most ${fo.faMaxMoves} moves, never a K or D/ST nor a position the team streams, never a player its lineup needs. Lineup points: ROS, playoff weeks × ${model.playoffWeight}. Moves are judged ${optimizerJudgingText(judging, model.scenarios)}.${judging === "ev" ? "" : " The re-runs behind the lineup costs and MV_add below judge their moves by the expected-value gain."}`,
    "",
  );
  const total = o.moves.reduce((n, m) => n + m.moves.length, 0);
  const dist = o.distribution.map((n, k) => `${k} ${k === 1 ? "move" : "moves"}: ${n} ${n === 1 ? "team" : "teams"}`).join(" · ");
  L.push(`**How many moves teams make:** ${dist}; ${total} in all, ${fmt(total / Math.max(1, o.moves.length))} a team (median ${fmt(median(o.moves.map((m) => m.moves.length)), 1)}).`, "");
  L.push(`| Team | Moves | Pickups (gain: scenario lineups / expected value; ${judging === "scenario" ? "the scenario gain decides" : "the expected-value gain decides"}) |`, "|---|---|---|");
  for (const m of o.moves) L.push(`| ${teamName(m.teamId)} | ${m.moves.length} | ${m.moves.length ? m.moves.map((mv) => `add ${playerLabel(s, mv.add)}${mv.drop ? `, drop ${playerLabel(s, mv.drop)}` : " (open spot)"} ${mv.gainScen !== null ? `${signed(mv.gainScen)} / ` : ""}${signed(mv.gainEv)}`).join("; ") : "none helps"} |`);
  L.push("");
  for (const ex of o.examples) {
    if (!ex.playerId) {
      L.push(`- **${ex.name}**: not in this league's player list.`);
      continue;
    }
    const label = playerLabel(s, ex.playerId);
    if (!ex.teamId || !ex.cost) {
      L.push(`- **${label}**: not on an active roster with a projection.`);
      continue;
    }
    const value = (v: { ev: number; scen: number | null }) => v.scen ?? v.ev;
    const cost = value(ex.cost);
    const best = [...ex.adds].sort((a, b) => value(b) - value(a) || (a.teamId < b.teamId ? -1 : 1))[0];
    const parts = [`on ${teamName(ex.teamId)}, lineup cost (MV_lose) ${fmt(cost)}${ex.cost.scen !== null ? ` (EV ${fmt(ex.cost.ev)})` : ""}`];
    if (ex.focusTeamId) {
      const focus = ex.adds.find((a) => a.teamId === ex.focusTeamId);
      parts.push(
        focus
          ? `MV_add to ${teamName(ex.focusTeamId)} ${signed(value(focus))}${focus.scen !== null ? ` (EV ${signed(focus.ev)})` : ""}${focus.drop ? `, making room by dropping ${playerLabel(s, focus.drop)}` : ", into an open spot"}`
          : `${teamName(ex.focusTeamId)} can't take him (${ex.focusBlocked?.reason ?? "unknown"})`,
      );
    }
    if (best) parts.push(`the most to ${teamName(best.teamId)}: ${signed(value(best))}`);
    const gap = best ? Math.max(0, value(best)) - cost : Number.NaN;
    parts.push(ex.chip ? `**a trade chip: gap ${fmt(ex.chip.gap)}** (maxOther ${fmt(ex.chip.maxOther)} to ${teamName(ex.chip.bestTeamId)} − cost ${fmt(ex.chip.cost)}; ${fmt(ex.chip.costPerWeek)} pts/wk${ex.chip.starter ? ", starter" : ""})` : `**not a trade chip: gap ${fmt(gap)}** (a chip needs ${config.needs.chipMinGap})`);
    const focusAdd = ex.focusTeamId ? ex.adds.find((a) => a.teamId === ex.focusTeamId) : undefined;
    const then = checkpoint3Text(x, ex, teamName, {
      focus: focusAdd ? value(focusAdd) : null,
      gap: ex.chip ? ex.chip.gap : gap,
      maxOther: ex.chip ? ex.chip.maxOther : best ? Math.max(0, value(best)) : null,
      cost: ex.chip ? ex.chip.cost : cost,
      bestTeamId: ex.chip ? ex.chip.bestTeamId : (best?.teamId ?? null),
    });
    L.push(`- **${label}**: ${parts.join("; ")}.${then ? ` ${then}` : ""}`);
  }
  L.push("");
}

/**
 * An example of section 11 against Checkpoint 3's numbers (CHECKPOINT3_OPTIMIZER: the one-move baseline the optimizer
 * replaced), with what this run's pickups say about the change: the focus team's (Bo Nix → Team 1) or his best team's
 * (McCaffrey) own pickups at his position, which V* now counts before him. Null for another example.
 */
function checkpoint3Text(x: RenderInput, ex: OptimizerExample, teamName: (id: string) => string, now: { focus: number | null; gap: number; maxOther: number | null; cost: number; bestTeamId: string | null }): string | null {
  const s = x.snapshot;
  const pos = ex.playerId ? s.players[ex.playerId]?.pos : undefined;
  const pickupsAt = (teamId: string | null) => (teamId === null || pos === undefined ? [] : (x.optimizer.moves.find((m) => m.teamId === teamId)?.moves ?? []).filter((m) => s.players[m.add]?.pos === pos));
  const listed = (ms: readonly FaMove[]) => andList(ms.map((m) => `${playerLabel(s, m.add)} (${signed(m.gainScen ?? m.gainEv)})`));
  const nix = CHECKPOINT3_OPTIMIZER.nix;
  if (ex.name === nix.name && ex.focusTeamId === nix.teamId) {
    const own = pickupsAt(nix.teamId);
    const why = own.length ? `, because ${teamName(nix.teamId)}'s own pickups include ${listed(own)}: V* makes ${own.length === 1 ? "that pickup" : "those pickups"} first, so ${ex.name} adds only what he adds over ${own.length === 1 ? "it" : "them"}` : `; ${teamName(nix.teamId)} makes no ${pos ?? ""} pickup of its own`;
    const most = now.maxOther !== null && now.bestTeamId !== null ? `; at most ${signed(now.maxOther)} anywhere (${teamName(now.bestTeamId)}), a gap of ${fmt(now.gap)}` : "";
    // Checkpoint 3's real-data team is named only when this league has it (a synthetic test league may not).
    const where = s.teams.some((t) => t.id === nix.realMaxTeamId) ? ` (${teamName(nix.realMaxTeamId)})` : "";
    return `At Checkpoint 3 the +${nix.repicked} (${teamName(nix.teamId)}'s one move re-picked) and +${nix.pinned} (pinned) came from a test fixture with synthetic inputs, not this league; on this league's data he added at most +${fmt(nix.realMax)} anywhere${where} against his lineup cost of ${fmt(nix.realCost)}, a gap of ${fmt(nix.realGap)}. Now ${now.focus === null ? "nothing (it can't take him)" : signed(now.focus)} to ${teamName(nix.teamId)}${why}${most}.`;
  }
  const mc = CHECKPOINT3_OPTIMIZER.mccaffrey;
  if (ex.name === mc.name) {
    const own = now.bestTeamId === mc.teamId ? pickupsAt(mc.teamId) : [];
    const moved = now.maxOther !== null && now.bestTeamId === mc.teamId ? `: what he'd add to ${teamName(mc.teamId)} ${now.maxOther < mc.maxOther ? "fell" : "rose"} by ${fmt(Math.abs(now.maxOther - mc.maxOther))}${own.length ? ` (${teamName(mc.teamId)}'s own pickups include ${listed(own)})` : ""} and his cost ${now.cost < mc.cost ? "fell" : "rose"} by ${fmt(Math.abs(now.cost - mc.cost))}` : "";
    return `At Checkpoint 3 (the one-move baseline) his chip gap was ${fmt(mc.gap)} (maxOther ${fmt(mc.maxOther)} to ${teamName(mc.teamId)} − cost ${fmt(mc.cost)}); now ${fmt(now.gap)}${now.maxOther !== null && now.bestTeamId !== null ? ` (maxOther ${fmt(now.maxOther)} to ${teamName(now.bestTeamId)} − cost ${fmt(now.cost)})` : ""}${moved}.`;
  }
  return null;
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

/** The offline dump (git-ignored data-local/parker-league/): snapshot, inputs and the moment they're for. */
export function loadOffline(dir: string, teamArg: string | undefined): { snapshot: LeagueSnapshot; inputs: ModelInputs; now: Date; dumpedAt: string } {
  const read = <T>(file: string): T => JSON.parse(readFileSync(path.join(dir, file), "utf8")) as T;
  const raw = read<LeagueSnapshot>("snapshot.json");
  const inputs = read<ModelInputs>("inputs.json");
  const meta = read<{ now: string }>("meta.json");
  const now = new Date(meta.now);
  if (Number.isNaN(now.getTime())) throw new Error("data-local/parker-league/meta.json has no valid `now`.");
  // placeholders() again: the dump already has them, but the report never trusts a file to.
  return { snapshot: placeholders({ ...raw, myTeamId: teamArg ?? raw.myTeamId }), inputs, now, dumpedAt: meta.now };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const teamFlag = argv.indexOf("--team");
  const teamArg = teamFlag >= 0 ? argv[teamFlag + 1] : undefined;
  const offline = argv.includes("--offline");
  registerScrubber(await redactorFromMap("espn"));
  const clock = () => performance.now();
  const generatedAt = new Date();
  let loaded: { snapshot: LeagueSnapshot; inputs: ModelInputs; now: Date; timing: Record<string, number>; note: string; reference?: { label: string; data: SearchReference } };
  if (offline) {
    const dir = path.join(ROOT, "data-local", "parker-league");
    const o = loadOffline(dir, teamArg);
    loaded = { ...o, timing: {}, note: `Offline: the git-ignored dump in data-local/parker-league/ (made by the app's own import and model-inputs builder at ${o.dumpedAt}); the engine's "now" is that moment.` };
    // The pre-addendum reference, when it was saved for this very dump and moment (git-ignored; only its match is printed).
    const refFile = path.join(ROOT, "data-local", "before-addendum", "top25.json");
    if (existsSync(refFile)) {
      const data = JSON.parse(readFileSync(refFile, "utf8")) as SearchReference;
      if (data.now === o.dumpedAt) loaded.reference = { label: "data-local/before-addendum/top25.json", data };
    }
  } else {
    const l = await loadLive(argv, teamArg);
    loaded = { ...l, note: "Live: Parker's league through the app's public-link import and its caches (league data 10 minutes, projections 6 hours, values 24 hours)." };
  }
  const { snapshot, inputs, now, timing, note, reference } = loaded;
  const report = buildTradeReport(snapshot, inputs, { now, clock, mode: offline ? "offline" : "live", dataNote: note, generatedAt, timing, ...(reference ? { beforeReference: reference } : {}) });
  // Public NFL player names are kept whole: a leaguemate's first or last name can be a word of one (league-report, review PRIV-1).
  const doc = scrubEverythingExcept(report.doc, Object.values(snapshot.players).map((p) => p.name));
  writeFileSync(path.join(ROOT, "reports", "trade-report.md"), doc);
  const top = report.result.trades[0];
  const beforeTop = report.variants.before.result.trades[0];
  const anchors = [...report.anchors, ...report.premiumAnchors];
  console.log(
    scrubEverything(
      `trade report written (${offline ? "offline" : "live"}) in ${ms(report.timing.total)}: ${report.result.trades.length} trades shown; search ${ms(report.runtime.search.total)} + context ${ms(report.runtime.context.total)} (median of ${report.runtime.runs.length}); top trade Helps you ${top?.tradeScore ?? "–"}, Overall ${top?.overall ?? "–"} (before the addendum: ${beforeTop?.tradeScore ?? "–"}, ${beforeTop?.overall ?? "–"}${report.reference ? `; reference ${report.reference.same}/${report.reference.trades}${report.reference.counts && report.reference.hidden ? "" : ", counts differ"}` : ""}); steps ${report.steps.withSteps}; anchors ${anchors.filter((a) => a.pass).length}/${anchors.length}; consistency ${report.consistency.rows.filter((r) => !r.differ.length).length}/${report.consistency.rows.length}; Analyzer example ${report.example.pick ? `Helps you ${report.example.pick.tradeScore}, P_accept ${pctPlain(report.example.pick.pAccept)}` : "none"}`,
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
