/**
 * The user's trade settings (CLAUDE.md §12 "User settings", §14 item 6 "Settings"; planner reply to
 * Checkpoint 3, model change 1: "Positions I stream weekly"). Pure: no I/O. The browser keeps one copy per
 * league (src/lib/settingsStore.ts) and sends it with every engine request; the engine reads only these
 * fields, so a stored copy from an older version goes through normalizeTradeSettings first.
 *
 * - streamPositions: the positions the user streams every week (§7 streaming positions): default K and
 *   DEF (config.streaming.defaultPositions); only config.streaming.streamable positions (K, DEF, QB, TE).
 * - playoffWeight: ω for playoff weeks in ROS (§7), default config.lineups.playoffWeight.
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
 *   more trade value than I get, κ in B = B_win + κ × clamp(g_mkt(me)) (redraft leagues; config.benefit.protectValue:
 *   low 2, medium 4 (the default), high 8). Dynasty and keeper leagues have no market term in B (B_future carries the
 *   value change), so the Settings page offers it in redraft leagues only.
 */
import { config } from "./config";
import { POSITIONS, type Pos } from "./model";

/** "Protect my trade value" levels (config.benefit.protectValue gives each one's κ). */
export const PROTECT_VALUE_LEVELS = ["low", "medium", "high"] as const;
export type ProtectValue = (typeof PROTECT_VALUE_LEVELS)[number];

export interface TradeSettings {
  version: 1;
  streamPositions: Pos[];
  playoffWeight: number;
  lambda: number | null;
  maxPerSide: number;
  untouchables: string[];
  mustInclude: string[];
  targetPositions: Pos[];
  avoidPositions: Pos[];
  includeKDefIdp: boolean;
  includePicks: boolean;
  protectValue: ProtectValue;
}

/** The settings a new league starts with. */
export function defaultTradeSettings(): TradeSettings {
  return {
    version: 1,
    streamPositions: [...config.streaming.defaultPositions],
    playoffWeight: config.lineups.playoffWeight,
    lambda: null,
    maxPerSide: config.search.maxPerSide,
    untouchables: [],
    mustInclude: [],
    targetPositions: [],
    avoidPositions: [],
    includeKDefIdp: false,
    includePicks: false,
    protectValue: config.benefit.protectValueDefault,
  };
}

/** Playoff weights the setting accepts (a display range for the slider; outside it the default is used). */
export const PLAYOFF_WEIGHT_RANGE: readonly [number, number] = [1, 2];

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
 * ones (streamPositions to config.streaming.streamable).
 */
export function normalizeTradeSettings(raw: unknown): TradeSettings {
  const d = defaultTradeSettings();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const stream = Array.isArray(r.streamPositions) ? positions(r.streamPositions, new Set(config.streaming.streamable)) : d.streamPositions;
  const pw = typeof r.playoffWeight === "number" && Number.isFinite(r.playoffWeight) && r.playoffWeight >= PLAYOFF_WEIGHT_RANGE[0] && r.playoffWeight <= PLAYOFF_WEIGHT_RANGE[1] ? r.playoffWeight : d.playoffWeight;
  const lambda = typeof r.lambda === "number" && Number.isFinite(r.lambda) && r.lambda >= 0 && r.lambda <= 1 ? r.lambda : null;
  const mps = typeof r.maxPerSide === "number" && Number.isInteger(r.maxPerSide) && r.maxPerSide >= 1 && r.maxPerSide <= config.search.maxPerSideAllowed ? r.maxPerSide : d.maxPerSide;
  return {
    version: 1,
    streamPositions: stream,
    playoffWeight: pw,
    lambda,
    maxPerSide: mps,
    untouchables: ids(r.untouchables),
    mustInclude: ids(r.mustInclude),
    targetPositions: positions(r.targetPositions),
    avoidPositions: positions(r.avoidPositions),
    includeKDefIdp: typeof r.includeKDefIdp === "boolean" ? r.includeKDefIdp : d.includeKDefIdp,
    includePicks: typeof r.includePicks === "boolean" ? r.includePicks : d.includePicks,
    protectValue: typeof r.protectValue === "string" && (PROTECT_VALUE_LEVELS as readonly string[]).includes(r.protectValue) ? (r.protectValue as ProtectValue) : d.protectValue,
  };
}
