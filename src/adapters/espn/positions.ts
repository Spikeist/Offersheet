/**
 * ESPN positions, lineup slots and injury statuses → the normalized model (CLAUDE.md §2.2, §4).
 * Pure; every ID comes from the generated tables in ./constants (never hand-typed): slots and
 * positions are looked up by their espn-api / empirical LABEL.
 *
 * Decisions (planner reply to Checkpoint 0, answers 5 and 12):
 * - TQB ("team QB") maps to QB, with an Import Report warning. HC (head coach) is unmapped.
 * - ESPN's DT/DE share Pos DL and CB/S share Pos DB (Pos has no finer IDP positions).
 * - DAY_TO_DAY → QUESTIONABLE; INJURY_RESERVE → IR; SUSPENSION → SUSPENDED; no status (team
 *   D/ST) → ACTIVE. PROBABLE → QUESTIONABLE follows the Phase 0 proposal (not seen live). A status
 *   we don't know → ACTIVE with an Import Report warning (like the Sleeper adapter).
 */
import type { InjuryStatus, Pos } from "@/engine/model";
import { ESPN_DEFAULT_POSITIONS, ESPN_LINEUP_SLOTS, ESPN_LINEUP_SLOT_IDS } from "./constants";

/** ESPN position / single-position slot label → Pos; null = deliberately unmapped (HC). */
const NAME_TO_POS: Readonly<Record<string, Pos | null>> = {
  QB: "QB",
  TQB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  K: "K",
  P: "P",
  DT: "DL",
  DE: "DL",
  DL: "DL",
  LB: "LB",
  CB: "DB",
  S: "DB",
  DB: "DB",
  "D/ST": "DEF",
  HC: null,
};

/** Multi-position slots whose label isn't a "/" list (verified on players_wl: constants.test.ts). */
const MULTI_SLOTS: Readonly<Record<string, Pos[]>> = {
  OP: ["QB", "RB", "WR", "TE"],
  DP: ["DL", "LB", "DB"],
};

/** Slot labels that are not starting slots. "Rookie" is an eligibility flag, "" is unused. */
const NON_STARTING = new Set(["BE", "IR", "", "Rookie"]);

function idByLabel(table: Readonly<Record<number, string>>, label: string): number {
  const hit = Object.entries(table).find(([, v]) => v === label);
  if (!hit) throw new Error(`ESPN table has no entry labelled ${label}`);
  return Number(hit[0]);
}

/** Lineup slot ids the adapter needs by meaning (looked up by label in espn-api's POSITION_MAP). */
export const SLOT = {
  QB: idByLabel(ESPN_LINEUP_SLOTS, "QB"),
  TQB: idByLabel(ESPN_LINEUP_SLOTS, "TQB"),
  OP: idByLabel(ESPN_LINEUP_SLOTS, "OP"),
  BENCH: idByLabel(ESPN_LINEUP_SLOTS, "BE"),
  IR: idByLabel(ESPN_LINEUP_SLOTS, "IR"),
  HC: idByLabel(ESPN_LINEUP_SLOTS, "HC"),
} as const;

/** defaultPositionIds the adapter needs by meaning (looked up in the empirical table). */
export const POSITION_ID = {
  QB: idByLabel(ESPN_DEFAULT_POSITIONS, "QB"),
  TQB: idByLabel(ESPN_DEFAULT_POSITIONS, "TQB"),
  HC: idByLabel(ESPN_DEFAULT_POSITIONS, "HC"),
  DST: idByLabel(ESPN_DEFAULT_POSITIONS, "D/ST"),
} as const;

export interface EspnPosition {
  /** ESPN's name for the position (QB, TQB, D/ST, HC …), undefined for an unknown id. */
  name: string | undefined;
  /** Normalized position; null when unmapped (HC) or unknown. */
  pos: Pos | null;
}

export function positionOf(defaultPositionId: number): EspnPosition {
  const name = ESPN_DEFAULT_POSITIONS[defaultPositionId];
  return { name, pos: name === undefined ? null : (NAME_TO_POS[name] ?? null) };
}

/** Every defaultPositionId that maps to a Pos (the key space of pointsOverrides and positionLimits). */
export function positionIdsFor(pos: Pos): number[] {
  return Object.keys(ESPN_DEFAULT_POSITIONS)
    .map(Number)
    .filter((id) => positionOf(id).pos === pos);
}

export interface EspnSlot {
  id: number;
  /** ESPN's label ("RB/WR/TE", "D/ST"…), undefined for an id espn-api doesn't know. */
  label: string | undefined;
  /** Name used in SlotDef.slot: espn-api's reverse name where it differs (23 → "FLEX"), else the label. */
  name: string;
  starting: boolean;
  /** Positions that can fill it; null when it can't be modeled (HC, or an unknown slot). */
  eligible: Pos[] | null;
}

export function slotInfo(id: number): EspnSlot {
  const label = ESPN_LINEUP_SLOTS[id];
  if (label === undefined) return { id, label, name: `slot ${id}`, starting: true, eligible: null };
  const reverse = Object.entries(ESPN_LINEUP_SLOT_IDS).find(([name, sid]) => sid === id && name !== label)?.[0];
  const name = reverse ?? label;
  if (NON_STARTING.has(label)) return { id, label, name, starting: false, eligible: [] };
  const multi = MULTI_SLOTS[label];
  if (multi) return { id, label, name, starting: true, eligible: [...multi] };
  const single = label in NAME_TO_POS ? NAME_TO_POS[label] : undefined;
  if (single !== undefined) return { id, label, name, starting: true, eligible: single ? [single] : null };
  if (label.includes("/")) {
    const parts = label.split("/").map((p) => NAME_TO_POS[p]);
    if (parts.every((p): p is Pos => !!p)) return { id, label, name, starting: true, eligible: [...new Set(parts)] };
  }
  // e.g. "ER": a slot espn-api names but whose meaning we don't know.
  return { id, label, name, starting: true, eligible: null };
}

/** A player's eligible positions from ESPN eligibleSlots (single-position slots only), own position first. */
export function eligiblePositions(pos: Pos, eligibleSlots: readonly number[]): Pos[] {
  const out: Pos[] = [pos];
  for (const id of eligibleSlots) {
    const s = slotInfo(id);
    if (!s.starting || !s.eligible || s.eligible.length !== 1 || !s.label || MULTI_SLOTS[s.label]) continue;
    const p = s.eligible[0] as Pos;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

const INJURY: Readonly<Record<string, InjuryStatus>> = {
  ACTIVE: "ACTIVE",
  NORMAL: "ACTIVE",
  QUESTIONABLE: "QUESTIONABLE",
  DOUBTFUL: "DOUBTFUL",
  OUT: "OUT",
  INJURY_RESERVE: "IR",
  SUSPENSION: "SUSPENDED",
  DAY_TO_DAY: "QUESTIONABLE",
  PROBABLE: "QUESTIONABLE",
};

/**
 * ESPN player.injuryStatus → §4 injury. `known` is false for a status we have no mapping for: that
 * player is treated as healthy (ACTIVE) and the adapter warns, as the Sleeper adapter does. "NA"
 * means "not an active NFL player" in the model (availability 0 every week), which an unknown ESPN
 * status doesn't tell us.
 */
export function mapInjury(status: string | undefined | null): { injury: InjuryStatus; known: boolean } {
  if (status === undefined || status === null || status === "") return { injury: "ACTIVE", known: true };
  const hit = INJURY[status];
  return hit ? { injury: hit, known: true } : { injury: "ACTIVE", known: false };
}
