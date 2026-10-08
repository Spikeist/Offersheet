/**
 * The user's trade settings (CLAUDE.md §12 "User settings", §14 item 6 "Settings"; planner reply to
 * Checkpoint 3, model change 1: "Positions I stream weekly"). Pure: no I/O. The browser keeps one copy per
 * league (src/lib/settingsStore.ts) and sends it with every engine request; the engine reads only these
 * fields, so a stored copy from an older version goes through normalizeTradeSettings first.
 *
 * - streamPositions: the positions the user streams every week (§7 streaming positions): default K and
 *   DEF (config.streaming.defaultPositions); only config.streaming.streamable positions (K, DEF, QB, TE).
 * - (playoffWeight: ω for playoff weeks in ROS, §7, the user's setting until the planner's reply to Checkpoint 7a, §6.1. The
 *   League model sets ω itself now, from my odds under my goal: league.ts step 5c, LeagueModel.playoffWeightAuto, which the
 *   Settings page shows read-only. A copy stored by an older version still carries it: normalizeTradeSettings drops it,
 *   like any other field it doesn't know, so it loads without error and changes nothing.)
 * - lambda: §10's Win now (0) ↔ Future (1) slider for dynasty and keeper leagues; null = the default by
 *   my P(playoffs) (config.benefit.lambda).
 * - maxPerSide: 2 by default, up to config.search.maxPerSideAllowed (3).
 * - untouchables (my players the search never offers), mustInclude (players every suggested trade must
 *   contain, mine or theirs), targetPositions (only get these positions; empty = any) and avoidPositions
 *   (never get these positions).
 * - includeKDefIdp: include P, K, DEF and IDP in the search (§9: excluded by default).
 * - includePicks: include draft picks (dynasty and keeper leagues; off by default: ⚠️ pick values are
 *   unverified on a live dynasty league).
 * - protectValue: "Protect my trade value" (planner addendum to Checkpoint 3, §3): how much B charges for giving up
 *   more trade value than I get, in lineup points since the planner's reply to Checkpoint 7a (§2 question 5): κ points a week
 *   per 100% of trade value in B = B_win + (B₃ / 3) × κ × clamp(g_mkt(me)) (redraft leagues; config.benefit.protectValue:
 *   low 1, medium 2 (the default), high 4; benefit.ts's header). Dynasty and keeper leagues have no market term in B
 *   (B_future carries the value change), so the Settings page offers it in redraft leagues only.
 * - goal: "What does your league reward?" ("What matters most" in Phase 4c: planner reply to Checkpoint 4b, change 8;
 *   reworded by the planner's reply to Checkpoint 7a, 5.2): B_win's weights on ΔPO and on the change in my share of the
 *   league's prizes, ΔE[S] (config.benefit.goals; src/engine/reward.ts): "title", "Only the champion", 0.15 / 0.85 with 1st
 *   place paying everything (the default); "prizes", "Several prizes", 0.15 / 0.85 with the league's own split (`prizes`
 *   below); "playoffs", "Making the playoffs", 0.70 / 0.30 with 1st place paying everything. Checkpoint 7c (planner reply to
 *   Checkpoint 7b, §6) replaced "Top finishers too" ("balanced", 0.35 / 0.65 on ΔPO and ΔCH) with "Several prizes": a copy
 *   stored with "balanced" reads as "prizes" with the prefilled split (config.benefit.prizesDefault; normalizeTradeSettings,
 *   the planner's "Migration"), while feedback recorded under it keeps its goal (LEGACY_GOALS). Since the planner's reply to
 *   Checkpoint 7a (§6.1) the League model reads it too: the automatic playoff-week weight weighs my odds by it (league.ts step
 *   5c), so it is one of the settings the League model is built with (src/lib/settingsStore.ts LEAGUE_MODEL_SETTINGS).
 * - prizes: "Several prizes"' amounts (planner reply to Checkpoint 7b, §6): 1st, 2nd and 3rd place, the weekly high score
 *   (paid each regular-season week) and the most points in the regular season, as the user typed them, dollars or percent,
 *   one unit for all (only the split matters: reward.ts prizeShares), null when the league doesn't pay it. Prefilled 60 / 30
 *   / 10 with the rest blank (config.benefit.prizesDefault). Kept whatever the goal, so switching away and back keeps them;
 *   read only under goal "prizes" (reward.ts rewardOf). The League model reads them with the goal (LEAGUE_MODEL_SETTINGS: the
 *   split moves ω).
 * - minChance: the Trade Finder's "Chance they accept: at least …" filter on P_complete (change 10): one of
 *   config.ranking.minChanceOptions (0 = Any), default config.ranking.minChanceDefault (10%).
 */
import { config } from "./config";
import { POSITIONS, type Pos } from "./model";

/** "Protect my trade value" levels (config.benefit.protectValue gives each one's κ, points a week per 100% of trade value). */
export const PROTECT_VALUE_LEVELS = ["low", "medium", "high"] as const;
export type ProtectValue = (typeof PROTECT_VALUE_LEVELS)[number];

/**
 * "What does your league reward?" (config.benefit.goals gives each one's weights on ΔPO and ΔE[S]; reward.ts): "Only the
 * champion", "Several prizes" and "Making the playoffs", in the Settings page's order (Checkpoint 7c; planner reply to
 * Checkpoint 7b, §6).
 */
export const GOALS = ["title", "prizes", "playoffs"] as const;
export type Goal = (typeof GOALS)[number];

/**
 * Goals an older version stored or sent, read only (Checkpoint 7c): "balanced", "Top finishers too" (0.35 on ΔPO, 0.65 on
 * ΔCH from Phase 4c to Checkpoint 7b). normalizeTradeSettings reads a stored one as "prizes" with the prefilled split; a
 * feedback record or copy made under it keeps it (src/lib/feedbackEvent.ts FEEDBACK_GOALS), since its numbers were weighed
 * that way.
 */
export const LEGACY_GOALS = ["balanced"] as const;
export type LegacyGoal = (typeof LEGACY_GOALS)[number];

/** The prizes "Several prizes" reads (TradeSettings.prizes; reward.ts PrizeShares, PrizeOdds), in the Settings page's order. */
export const PRIZE_KEYS = ["first", "second", "third", "weeklyHigh", "pointsLeader"] as const;
export type PrizeKey = (typeof PRIZE_KEYS)[number];

/**
 * "Several prizes"' amounts as typed (TradeSettings.prizes): dollars or percent, one unit for all, null = not paid;
 * weeklyHigh is the prize for one regular-season week's high score (reward.ts counts it once per prize period).
 */
export type PrizeAmounts = Readonly<Record<PrizeKey, number | null>>;

/** The largest prize amount a stored copy keeps (a sanity bound on what's typed, not a model number); above it: not paid. */
export const PRIZE_MAX = 1e9;

export interface TradeSettings {
  version: 1;
  streamPositions: Pos[];
  lambda: number | null;
  maxPerSide: number;
  untouchables: string[];
  mustInclude: string[];
  targetPositions: Pos[];
  avoidPositions: Pos[];
  includeKDefIdp: boolean;
  includePicks: boolean;
  protectValue: ProtectValue;
  /** "What does your league reward?": B_win's weights, and whose prizes ΔE[S] counts (Phase 4c; Checkpoint 7c). */
  goal: Goal;
  /** "Several prizes"' amounts (Checkpoint 7c), keys in PRIZE_KEYS order; read only under goal "prizes". */
  prizes: PrizeAmounts;
  /** The Trade Finder's minimum chance they accept (P_complete), 0 = Any (Phase 4c). */
  minChance: number;
}

/** The settings a new league starts with. */
export function defaultTradeSettings(): TradeSettings {
  return {
    version: 1,
    streamPositions: [...config.streaming.defaultPositions],
    lambda: null,
    maxPerSide: config.search.maxPerSide,
    untouchables: [],
    mustInclude: [],
    targetPositions: [],
    avoidPositions: [],
    includeKDefIdp: false,
    includePicks: false,
    protectValue: config.benefit.protectValueDefault,
    goal: config.benefit.goalDefault,
    prizes: prizesFrom(config.benefit.prizesDefault),
    minChance: config.ranking.minChanceDefault,
  };
}

/** `x` as a prize amount: a finite number from 0 to PRIZE_MAX (−0 read as 0), else null (not paid). */
function prizeAmount(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= PRIZE_MAX ? x + 0 : null;
}

/** A prizes object with every key in PRIZE_KEYS order (settingsFingerprint's JSON needs one order), each amount checked. */
function prizesFrom(x: Readonly<Partial<Record<PrizeKey, unknown>>>): PrizeAmounts {
  const out = {} as Record<PrizeKey, number | null>;
  for (const k of PRIZE_KEYS) out[k] = prizeAmount(x[k]);
  return out;
}

const POS_SET: ReadonlySet<string> = new Set(POSITIONS);

function positions(x: unknown, allowed: ReadonlySet<string> = POS_SET): Pos[] {
  if (!Array.isArray(x)) return [];
  const out: Pos[] = [];
  for (const p of x) if (typeof p === "string" && allowed.has(p) && !out.includes(p as Pos)) out.push(p as Pos);
  return out;
}

function ids(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  const out: string[] = [];
  for (const id of x) if (typeof id === "string" && id.length > 0 && id.length <= 64 && !out.includes(id)) out.push(id);
  return out;
}

/**
 * A stored or posted settings object, made safe to use: every field is checked and anything missing or
 * out of range falls back to its default (never throws). Positions are deduplicated and limited to known
 * ones (streamPositions to config.streaming.streamable). Fields it doesn't know (an older version's playoffWeight
 * among them) are dropped. Checkpoint 7c (planner reply to Checkpoint 7b, §6, "Migration"): a stored goal "balanced" ("Top
 * finishers too") reads as "prizes" with the prefilled split (config.benefit.prizesDefault), whatever prizes it holds;
 * every reader of a stored copy goes through here, so the IndexedDB row may keep "balanced" until the next change saves it
 * normalized (it reads, and fingerprints, the same meanwhile). Prizes: not an object → the prefilled split; else each
 * amount a finite number from 0 to PRIZE_MAX, anything else null (not paid).
 */
export function normalizeTradeSettings(raw: unknown): TradeSettings {
  const d = defaultTradeSettings();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const stream = Array.isArray(r.streamPositions) ? positions(r.streamPositions, new Set(config.streaming.streamable)) : d.streamPositions;
  const lambda = typeof r.lambda === "number" && Number.isFinite(r.lambda) && r.lambda >= 0 && r.lambda <= 1 ? r.lambda : null;
  const mps = typeof r.maxPerSide === "number" && Number.isInteger(r.maxPerSide) && r.maxPerSide >= 1 && r.maxPerSide <= config.search.maxPerSideAllowed ? r.maxPerSide : d.maxPerSide;
  // "Top finishers too", stored before Checkpoint 7c: "Several prizes" with the prefilled split (the planner's "Migration").
  const legacy = (LEGACY_GOALS as readonly unknown[]).includes(r.goal);
  const prizes = legacy || !r.prizes || typeof r.prizes !== "object" || Array.isArray(r.prizes) ? d.prizes : prizesFrom(r.prizes as Partial<Record<PrizeKey, unknown>>);
  return {
    version: 1,
    streamPositions: stream,
    lambda,
    maxPerSide: mps,
    untouchables: ids(r.untouchables),
    mustInclude: ids(r.mustInclude),
    targetPositions: positions(r.targetPositions),
    avoidPositions: positions(r.avoidPositions),
    includeKDefIdp: typeof r.includeKDefIdp === "boolean" ? r.includeKDefIdp : d.includeKDefIdp,
    includePicks: typeof r.includePicks === "boolean" ? r.includePicks : d.includePicks,
    protectValue: typeof r.protectValue === "string" && (PROTECT_VALUE_LEVELS as readonly string[]).includes(r.protectValue) ? (r.protectValue as ProtectValue) : d.protectValue,
    goal: legacy ? "prizes" : typeof r.goal === "string" && (GOALS as readonly string[]).includes(r.goal) ? (r.goal as Goal) : d.goal,
    prizes,
    minChance: typeof r.minChance === "number" && config.ranking.minChanceOptions.includes(r.minChance) ? r.minChance : d.minChance,
  };
}
