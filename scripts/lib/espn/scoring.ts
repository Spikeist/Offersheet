/**
 * Preview of the Phase 1 scoring oracle (CLAUDE.md §5) done directly in ESPN stat ids: points =
 * Σ rate(statId, player) × stats[statId], where pointsOverrides[key] REPLACES the base points for
 * that player. ESPN reports its own league-scored number as appliedTotal (and per-stat points as
 * appliedStats), so we can compare line by line.
 *
 * Which key? CLAUDE.md §2.2 assumed a lineupSlotId. Live data (probe 2026-09-29) says the key is the
 * player's defaultPositionId: in the public test league a TE's rushing yards scored through key 4
 * (TE's position id) while TE's slot id 6 isn't a key at all. The probe scores both readings, and
 * also "add" vs "replace" (see OverrideMode); the counts are in K.overrideKeys.
 */
import type { ScoringItem } from "./schema";

export const ORACLE_TOLERANCE = 0.05;

export interface Recomputed {
  total: number;
  /** statId → points we computed. */
  perStat: Record<number, number>;
}

/**
 * How an override combines with the base points. "replace" is what ESPN does (probe check
 * K.overrideKeys: every discriminating player-week matched it); "add" is kept only so the probe can
 * show that the alternative reading fails.
 */
export type OverrideMode = "replace" | "add";

export function rateFor(item: Pick<ScoringItem, "points" | "pointsOverrides">, overrideKey: number | undefined, mode: OverrideMode = "replace"): number {
  const o = item.pointsOverrides;
  if (o && overrideKey !== undefined) {
    const v = o[String(overrideKey)];
    if (v !== undefined) return mode === "replace" ? v : item.points + v;
  }
  return item.points;
}

/** `overrideKey`: the pointsOverrides key that applies to this player (see the file comment). */
export function recompute(stats: Record<string, number>, items: ReadonlyArray<Pick<ScoringItem, "statId" | "points" | "pointsOverrides">>, overrideKey: number | undefined, mode: OverrideMode = "replace"): Recomputed {
  let total = 0;
  const perStat: Record<number, number> = {};
  for (const item of items) {
    const value = stats[String(item.statId)];
    if (value === undefined || value === 0) continue;
    const pts = rateFor(item, overrideKey, mode) * value;
    if (pts === 0) continue;
    perStat[item.statId] = (perStat[item.statId] ?? 0) + pts;
    total += pts;
  }
  return { total, perStat };
}

export interface StatDiff {
  statId: number;
  ours: number;
  espn: number;
}

/** Per-stat differences between our recomputation and ESPN's appliedStats (|diff| > 0.005). */
export function diffPerStat(ours: Record<number, number>, espn: Record<string, number> | undefined): StatDiff[] {
  const ids = new Set<number>([...Object.keys(ours).map(Number), ...Object.keys(espn ?? {}).map(Number)]);
  const out: StatDiff[] = [];
  for (const id of [...ids].sort((a, b) => a - b)) {
    const a = ours[id] ?? 0;
    const b = espn?.[String(id)] ?? 0;
    if (Math.abs(a - b) > 0.005) out.push({ statId: id, ours: round2(a), espn: round2(b) });
  }
  return out;
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
