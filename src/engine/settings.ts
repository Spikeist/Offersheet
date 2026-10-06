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
 * - goal: "What matters most" (planner reply to Checkpoint 4b, change 8): B's weights on ΔPO and ΔCH
 *   (config.benefit.goals: "title" 0.15 / 0.85, the default; "balanced" 0.35 / 0.65; "playoffs" 0.70 / 0.30). Since the
 *   planner's reply to Checkpoint 7a (§6.1) the League model reads it too: the automatic playoff-week weight weighs my odds
 *   by it (league.ts step 5c), so it is one of the settings the League model is built with (src/lib/settingsStore.ts
 *   LEAGUE_MODEL_SETTINGS).
 * - minChance: the Trade Finder's "Chance they accept: at least …" filter on P_complete (change 10): one of
 *   config.ranking.minChanceOptions (0 = Any), default config.ranking.minChanceDefault (10%).
 */
import { config } from "./config";
import { POSITIONS, type Pos } from "./model";

/** "Protect my trade value" levels (config.benefit.protectValue gives each one's κ, points a week per 100% of trade value). */
export const PROTECT_VALUE_LEVELS = ["low", "medium", "high"] as const;
export type ProtectValue = (typeof PROTECT_VALUE_LEVELS)[number];

/** "What matters most" (config.benefit.goals gives each one's weights on ΔPO and ΔCH). */
export const GOALS = ["title", "balanced", "playoffs"] as const;
export type Goal = (typeof GOALS)[number];

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
  /** "What matters most": B's weights (Phase 4c). */
  goal: Goal;
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
    minChance: config.ranking.minChanceDefault,
  };
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
 * among them) are dropped.
 */
export function normalizeTradeSettings(raw: unknown): TradeSettings {
  const d = defaultTradeSettings();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const stream = Array.isArray(r.streamPositions) ? positions(r.streamPositions, new Set(config.streaming.streamable)) : d.streamPositions;
  const lambda = typeof r.lambda === "number" && Number.isFinite(r.lambda) && r.lambda >= 0 && r.lambda <= 1 ? r.lambda : null;
  const mps = typeof r.maxPerSide === "number" && Number.isInteger(r.maxPerSide) && r.maxPerSide >= 1 && r.maxPerSide <= config.search.maxPerSideAllowed ? r.maxPerSide : d.maxPerSide;
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
    goal: typeof r.goal === "string" && (GOALS as readonly string[]).includes(r.goal) ? (r.goal as Goal) : d.goal,
    minChance: typeof r.minChance === "number" && config.ranking.minChanceOptions.includes(r.minChance) ? r.minChance : d.minChance,
  };
}
