/**
 * Team strength, needs, surplus and best trade partners (CLAUDE.md §7 "Needs and surplus", the surplus
 * score of §12 step 2; config.lineups and config.needs, §15). Pure and deterministic: no I/O, no clock,
 * no randomness. These functions work on numbers the lineup layer (src/engine/teamValue.ts) computes;
 * src/engine/league.ts wires them together into the LeagueModel.
 *
 * - Slot instances: one per starting spot, the League page's heatmap columns. Slots that share a name
 *   share one numbering (QB1; RB1, RB2; FLEX1; …) and are listed together at the name's first place in
 *   the lineup. Keys are the platform's slot name plus the rank ("RB2", "D/ST1"). Labels are short: a
 *   slot with one spot drops the rank ("QB"), a team-defense slot reads "D/ST", and multi-position flex
 *   slots get their usual short names (FLEX, SF, W/R, W/T, IDP). Only spots lineup.ts can fill count:
 *   a slot with no spots or no known position is left out, as prepareSlots() drops it.
 * - Instance points: within each slot name, a lineup's starters sorted by points, the best in rank 1;
 *   an empty spot scores 0. lineup.ts seats the better of two swappable starters in the more
 *   restrictive slot, so the RB slots hold the top RBs and FLEX the best leftover.
 * - Strength: a team's average instance points over a window of weeks (league.ts: scenario lineups when
 *   computed, else expected-value lineups), compared across teams as z = (x − league median) /
 *   population SD (SD < 1e-9 → z 0).
 * - Needs (§7: slots with z ≤ needZThreshold, ranked): instances weak for the rest of the season
 *   (window "ros"), plus instances weak only over the next strengthWeeks (window "next": an injury or a
 *   cluster of byes); weakest first. The League page shows the first needsShown.
 * - Surplus (§7: high market value, low MV_lose; §12's surplus score): z(value) − z(MV_lose), both
 *   z-scores within the team's active roster (mean and population SD). A surplus player scores at least
 *   surplusMinScore, his lineup cost is low (z(MV_lose) below surplusMaxCostZ: below his roster's
 *   average) and he would start for at least one other team. The cost cut keeps stars out: market values
 *   are convex, so a star's z(value) alone can outrun his z(MV_lose), while §7's surplus is "bench depth
 *   that would start for other teams".
 * - Partners (§7 "best trade partners"; Phase 2 review decisions): each side is scored by its JOINT gain,
 *   what all of their helpful surplus players add to my lineup together (league.ts: one lineup solve per
 *   week, teamValue.addRowsGain), so two spare players competing for one slot count once; the card lists
 *   keep each player's own gain. Mutual fits (both sides help) score sqrt(what theirs adds to my lineup ×
 *   what mine adds to theirs), in points per week, and come first; then one-sided fits (only theirs helps
 *   me), scored by what theirs adds; fits where only mine helps them are dropped.
 */
import type { Need, SlotInstance, SlotStrength, SurplusPlayer, TradePartner } from "./leagueModel";
import type { PreparedSlots } from "./lineup";
import { POSITIONS, type SlotDef } from "./model";

/** z-scores and gains closer than this are ties / zero (float noise, not a tunable). */
const EPS = 1e-9;

const POS_SET: ReadonlySet<string> = new Set(POSITIONS);

/** Short heatmap names for multi-position slots (labels only; keys keep the platform's slot name). */
const FLEX_LABELS: Readonly<Record<string, string>> = {
  "RB/WR/TE": "FLEX",
  SUPER_FLEX: "SF",
  WRRB_FLEX: "W/R",
  REC_FLEX: "W/T",
  IDP_FLEX: "IDP",
};

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Starting spots of a SlotDef as lineup.ts counts them (prepareSlots): whole spots, 0 without a known position. */
function spots(def: SlotDef): number {
  const count = Number.isFinite(def.count) ? Math.max(0, Math.floor(def.count)) : 0;
  return count > 0 && def.eligible.some((p) => POS_SET.has(p)) ? count : 0;
}

function slotLabel(def: SlotDef): string {
  const eligible = def.eligible.filter((p) => POS_SET.has(p));
  if (eligible.length > 0 && eligible.every((p) => p === "DEF")) return "D/ST";
  return FLEX_LABELS[def.slot] ?? def.slot;
}

/**
 * The heatmap columns (LeagueModel.slots): one instance per starting spot, in lineup order, slots of the
 * same name together. See the file header for keys and labels.
 */
export function slotInstances(lineup: readonly SlotDef[]): SlotInstance[] {
  const names: string[] = [];
  const total = new Map<string, number>();
  const first = new Map<string, SlotDef>();
  for (const def of lineup) {
    const n = spots(def);
    if (n === 0) continue;
    if (!total.has(def.slot)) {
      names.push(def.slot);
      first.set(def.slot, def);
    }
    total.set(def.slot, (total.get(def.slot) ?? 0) + n);
  }
  const out: SlotInstance[] = [];
  const keys = new Set<string>();
  for (const slot of names) {
    const count = total.get(slot) as number;
    const label = slotLabel(first.get(slot) as SlotDef);
    for (let rank = 1; rank <= count; rank++) {
      // A slot name ending in a digit could collide ("WR" rank 12 and "WR1" rank 2); no platform has one.
      let key = `${slot}${rank}`;
      if (keys.has(key)) key = `${slot}#${rank}`;
      keys.add(key);
      out.push({ key, label: count === 1 ? label : `${label}${rank}`, slot, rank });
    }
  }
  return out;
}

/** Where each slot group's starters go among the instances (teamValue.ts fills instance points with it). */
export interface InstanceIndex {
  /** Instances per lineup (the length of an instance-points vector). */
  readonly size: number;
  /** Per prepared slot group (PreparedSlots.groups): its slot name's index, −1 when it has no instances. */
  readonly groupName: Int32Array;
  /** Per slot name: the first instance's index and the number of instances. */
  readonly offset: Int32Array;
  readonly count: Int32Array;
  /** Scratch for instancePointsInto: starters placed per slot name (an index is not re-entrant). */
  readonly filled: Int32Array;
}

/** Maps a league's prepared slot groups (lineup.ts) to slotInstances() (instances of one slot name must be contiguous, as slotInstances lists them). */
export function instanceIndex(instances: readonly SlotInstance[], slots: PreparedSlots): InstanceIndex {
  const nameIndex = new Map<string, number>();
  const offset: number[] = [];
  const count: number[] = [];
  instances.forEach((inst, i) => {
    let j = nameIndex.get(inst.slot);
    if (j === undefined) {
      j = offset.length;
      nameIndex.set(inst.slot, j);
      offset.push(i);
      count.push(0);
    }
    count[j] = (count[j] as number) + 1;
  });
  return {
    size: instances.length,
    groupName: Int32Array.from(slots.groups, (g) => nameIndex.get(g.slot) ?? -1),
    offset: Int32Array.from(offset),
    count: Int32Array.from(count),
    filled: new Int32Array(offset.length),
  };
}

/**
 * One lineup's starter points by slot instance, written into `out` (length index.size): within each
 * slot name the starters sorted by points, best first; empty spots 0. `seat` is lineupTotal()'s seat
 * output for a roster of n players; a starter's points are points[k], or 0 when available[k] is 0.
 */
export function instancePointsInto(index: InstanceIndex, seat: Int32Array, points: ArrayLike<number>, available: Uint8Array | null, n: number, out: Float64Array): Float64Array {
  out.fill(0, 0, index.size);
  const filled = index.filled;
  filled.fill(0);
  for (let k = 0; k < n; k++) {
    const g = seat[k] as number;
    if (g < 0) continue;
    const name = index.groupName[g];
    if (name === undefined || name < 0) continue;
    const f = filled[name] as number;
    if (f >= (index.count[name] as number)) continue; // a slot name's groups hold exactly its instance count
    const raw = points[k] as number;
    const v = raw !== raw || (available !== null && available[k] === 0) ? 0 : raw;
    const lo = index.offset[name] as number;
    let at = lo + f;
    while (at > lo && (out[at - 1] as number) < v) {
      out[at] = out[at - 1] as number;
      at--;
    }
    out[at] = v;
    filled[name] = f + 1;
  }
  return out;
}

/** The average of per-week instance points over weeks [from, to) (zeros for an empty window). */
export function windowAverage(perWeek: readonly ArrayLike<number>[], from: number, to: number, size: number): Float64Array {
  const out = new Float64Array(size);
  const lo = Math.max(0, from);
  const hi = Math.min(perWeek.length, to);
  if (hi <= lo) return out;
  for (let w = lo; w < hi; w++) {
    const row = perWeek[w] as ArrayLike<number>;
    for (let i = 0; i < size; i++) out[i] = (out[i] as number) + ((row[i] as number) || 0);
  }
  for (let i = 0; i < size; i++) out[i] = (out[i] as number) / (hi - lo);
  return out;
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  const mid = n >> 1;
  return n % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Population SD (around the mean). */
function populationSd(xs: readonly number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  let mean = 0;
  for (const x of xs) mean += x;
  mean /= n;
  let ss = 0;
  for (const x of xs) ss += (x - mean) * (x - mean);
  return Math.sqrt(ss / n);
}

/** Strength z-scores across teams (§7): (x − median) / population SD; all 0 when the SD is below 1e-9. */
export function zScores(xs: readonly number[]): number[] {
  const sd = populationSd(xs);
  if (!(sd >= EPS)) return xs.map(() => 0);
  const m = median(xs);
  return xs.map((x) => (x - m) / sd);
}

/** Standard z-scores within one roster (§12's surplus score): (x − mean) / population SD; all 0 when the SD is below 1e-9. */
export function standardize(xs: readonly number[]): number[] {
  const sd = populationSd(xs);
  if (!(sd >= EPS)) return xs.map(() => 0);
  let mean = 0;
  for (const x of xs) mean += x;
  mean /= xs.length;
  return xs.map((x) => (x - mean) / sd);
}

/**
 * Slot strength for every team (§7): `next[t]` and `ros[t]` are team t's average instance points over
 * the next strengthWeeks and over the rest of the season (aligned with `instances`); z-scores are taken
 * across teams, instance by instance.
 */
export function strengthTable(instances: readonly SlotInstance[], next: readonly ArrayLike<number>[], ros: readonly ArrayLike<number>[]): Record<string, SlotStrength>[] {
  const teams = next.length;
  const out: Record<string, SlotStrength>[] = Array.from({ length: teams }, () => ({}));
  instances.forEach((inst, i) => {
    const xn = next.map((v) => (v[i] as number) || 0);
    const xr = ros.map((v) => (v[i] as number) || 0);
    const zn = zScores(xn);
    const zr = zScores(xr);
    for (let t = 0; t < teams; t++) {
      (out[t] as Record<string, SlotStrength>)[inst.key] = { next: xn[t] as number, ros: xr[t] as number, zNext: zn[t] as number, zRos: zr[t] as number };
    }
  });
  return out;
}

/**
 * Needs (§7): instances with zRos ≤ threshold (window "ros"), plus instances with zNext ≤ threshold whose
 * zRos is above it (window "next"), weakest first (ties keep lineup order). Need.slot is the instance key.
 */
export function findNeeds(strength: Readonly<Record<string, SlotStrength>>, instances: readonly SlotInstance[], threshold: number): Need[] {
  const out: Need[] = [];
  for (const inst of instances) {
    const s = strength[inst.key];
    if (!s) continue;
    if (s.zRos <= threshold) out.push({ slot: inst.key, z: s.zRos, window: "ros" });
    else if (s.zNext <= threshold) out.push({ slot: inst.key, z: s.zNext, window: "next" });
  }
  return out.sort((a, b) => a.z - b.z); // stable: ties keep lineup order
}

/**
 * §12's surplus score for each player of one active roster: z(value) − z(MV_lose), both standardized
 * within the roster. A valuable player his team would barely miss scores high.
 */
export function surplusScores(values: readonly number[], mvLose: readonly number[]): number[] {
  const zv = standardize(values);
  const zl = standardize(mvLose);
  return zv.map((z, i) => z - (zl[i] as number));
}

export interface SurplusCandidate {
  playerId: string;
  /** surplusScores(): z(value) − z(MV_lose) within the roster. */
  score: number;
  /** z(MV_lose) within the roster (standardize over the roster's lineup costs): his lineup cost against the roster's average. */
  costZ: number;
  startsFor: number;
}

/**
 * Every surplus player of a team (§7: high market value, low MV_lose, bench depth that would start for
 * other teams): surplus score ≥ surplusMinScore, costZ below surplusMaxCostZ (a z within 1e-9 of the cut
 * counts as at it, so float noise around the average doesn't qualify) and he would start for at least one
 * other team; best score first (ties: smaller id). The team table shows the first surplusShown. A roster
 * whose lineup costs are all equal (costZ 0 everywhere) has no player below its average, so no surplus.
 */
export function qualifyingSurplus(rows: readonly SurplusCandidate[], cfg: { readonly surplusMinScore: number; readonly surplusMaxCostZ: number }): SurplusPlayer[] {
  return rows
    .filter((r) => r.score >= cfg.surplusMinScore && r.costZ < cfg.surplusMaxCostZ - EPS && r.startsFor >= 1)
    .map((r) => ({ playerId: r.playerId, score: r.score, startsFor: r.startsFor }))
    .sort((a, b) => b.score - a.score || byId(a.playerId, b.playerId));
}

/** A surplus player and what he alone adds to the other lineup, in points per week. */
export interface PartnerPlayer {
  playerId: string;
  ppw: number;
}

/** The players who add more than 0 points per week to the other lineup (1e-9: float noise), most first (ties: smaller id). */
export function helpfulPlayers(xs: readonly PartnerPlayer[]): PartnerPlayer[] {
  return xs
    .filter((x) => x.ppw > EPS)
    .map((x) => ({ playerId: x.playerId, ppw: x.ppw }))
    .sort((a, b) => b.ppw - a.ppw || byId(a.playerId, b.playerId));
}

export interface PartnerCandidate {
  teamId: string;
  /** Their surplus players and what each alone adds to my lineup per week (all remaining weeks). */
  theyCanGive: PartnerPlayer[];
  /** My surplus players and what each alone adds to their lineup per week. */
  youCanGive: PartnerPlayer[];
  /**
   * What helpfulPlayers(theyCanGive) add to my lineup TOGETHER per week (the joint gain: one lineup per
   * week, so players competing for one slot count once), and what helpfulPlayers(youCanGive) add to theirs.
   */
  get: number;
  give: number;
}

/**
 * Best trade partners (§7): each side lists its helpful players (helpfulPlayers) and is scored by its joint
 * gain (get, give). Mutual fits (both sides help) score sqrt(get × give) and come first. Then one-sided fits
 * where only their surplus helps me score get: a team with no spare players of its own still learns who
 * could fill its needs (a trade would likely cost it a starter). Fits where only my surplus helps them are
 * dropped. Best first within each group (ties: smaller team id); the first partnersShown overall.
 */
export function rankPartners(candidates: readonly PartnerCandidate[], cfg: { readonly partnersShown: number }): TradePartner[] {
  const mutual: TradePartner[] = [];
  const oneSided: TradePartner[] = [];
  for (const c of candidates) {
    const theyCanGive = helpfulPlayers(c.theyCanGive);
    const youCanGive = helpfulPlayers(c.youCanGive);
    const get = theyCanGive.length > 0 && Number.isFinite(c.get) ? c.get : 0;
    const give = youCanGive.length > 0 && Number.isFinite(c.give) ? c.give : 0;
    if (get > EPS && give > EPS) mutual.push({ teamId: c.teamId, mutual: true, score: Math.sqrt(get * give), theyCanGive, youCanGive });
    // One-sided: my surplus adds nothing to their lineup together (under starter limits that can happen even
    // when one of my players alone would help), so none of mine is listed.
    else if (get > EPS) oneSided.push({ teamId: c.teamId, mutual: false, score: get, theyCanGive, youCanGive: [] });
  }
  const best = (a: TradePartner, b: TradePartner) => b.score - a.score || byId(a.teamId, b.teamId);
  return [...mutual.sort(best), ...oneSided.sort(best)].slice(0, Math.max(0, Math.floor(cfg.partnersShown)));
}
