/**
 * Test-only brute force for the lineup solver (CLAUDE.md §7 and §16: "property-test the solver
 * against brute force on random rosters"). Exponential and deliberately naive, sharing no code with
 * lineup.ts: it enumerates every set of players that can fill distinct slot instances (one instance
 * per SlotDef count), keeps the sets within the starter maximums, and returns the best one by
 * (starter-minimum seats filled, total points): the objective lineup.ts documents.
 */
import type { LineupPlayer, StarterLimits } from "./lineup";
import type { Pos, SlotDef } from "./model";

export interface BruteForceLineup {
  total: number;
  /** Σ over positions with a starter limit of min(starters at that position, its minimum). */
  minSeats: number;
  /** Ids of one best lineup's starters. */
  starters: string[];
}

/** A limit read the documented way: at least ceil(min), at most floor(max), min clamped into [0, max]. */
export function readLimit(l: { min: number; max: number }): { lo: number; hi: number } {
  const hi = Number.isFinite(l.max) ? Math.max(0, Math.floor(l.max)) : Number.POSITIVE_INFINITY;
  const lo = Number.isFinite(l.min) ? Math.min(hi, Math.max(0, Math.ceil(l.min))) : 0;
  return { lo, hi };
}

/** Whether a player may fill a slot: his position or one of his eligible positions is among the slot's. */
export function fitsSlot(player: Pick<LineupPlayer, "pos" | "eligible">, slotEligible: readonly Pos[]): boolean {
  return slotEligible.includes(player.pos) || player.eligible.some((e) => slotEligible.includes(e));
}

export function bruteForceLineup(players: readonly LineupPlayer[], lineup: readonly SlotDef[], starterLimits?: StarterLimits | null): BruteForceLineup {
  const n = players.length;
  if (n > 20) throw new Error("the brute force handles at most 20 players");
  const size = 2 ** n;
  // reach[m] = 1 when the players in bitmask m can all start at once (a matching into slot instances).
  const reach = new Uint8Array(size);
  reach[0] = 1;
  for (const def of lineup) {
    const who = players.flatMap((p, k) => (fitsSlot(p, def.eligible) ? [k] : []));
    for (let c = 0; c < Math.floor(def.count); c++) {
      // Descending, so a set grown by this instance (always a larger mask) isn't grown by it twice.
      for (let m = size - 1; m >= 0; m--) {
        if (reach[m] === 0) continue;
        for (const k of who) if ((m & (1 << k)) === 0) reach[m | (1 << k)] = 1;
      }
    }
  }
  const limits = Object.entries(starterLimits ?? {}).flatMap(([pos, l]) => (l ? [{ pos, ...readLimit(l) }] : []));
  const points = players.map((p) => (Number.isNaN(p.points) ? 0 : p.points));
  let best = { minSeats: -1, total: Number.NEGATIVE_INFINITY, mask: 0 };
  for (let m = 0; m < size; m++) {
    if (reach[m] === 0) continue;
    let total = 0;
    const count = new Map<string, number>();
    for (let k = 0; k < n; k++) {
      if ((m & (1 << k)) === 0) continue;
      total += points[k] as number;
      const pos = (players[k] as LineupPlayer).pos;
      count.set(pos, (count.get(pos) ?? 0) + 1);
    }
    let legal = true;
    let minSeats = 0;
    for (const { pos, lo, hi } of limits) {
      const c = count.get(pos) ?? 0;
      if (c > hi) legal = false;
      minSeats += Math.min(c, lo);
    }
    if (!legal) continue;
    if (minSeats > best.minSeats || (minSeats === best.minSeats && total > best.total)) best = { minSeats, total, mask: m };
  }
  const starters = players.flatMap((p, k) => ((best.mask & (1 << k)) !== 0 ? [p.id] : []));
  return { total: best.total, minSeats: best.minSeats, starters };
}
