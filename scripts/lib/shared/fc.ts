/**
 * Pure analysis of FantasyCalc /values/current responses (CLAUDE.md §2.9, §9): field presence,
 * position counts, draft-pick rows, and format-vs-format comparisons (to prove which query
 * parameters change values).
 */
import type { FcEntry } from "../fantasycalc";
import { countBy, isBlankId, median, round } from "./util";

/** Fields CLAUDE.md §2.9 expects on each entry and on entry.player. */
export const FC_PLAYER_FIELDS = ["id", "name", "position", "sleeperId", "espnId", "mflId", "fleaflickerId", "ffpcId", "maybeTeam", "maybeAge"] as const;
export const FC_ENTRY_FIELDS = ["value", "redraftValue", "overallRank", "positionRank", "trend30Day", "maybeTier", "maybeTradeFrequency"] as const;
export const FC_ID_FIELDS = ["sleeperId", "espnId", "mflId", "fleaflickerId"] as const;
export const SKILL_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

export interface FieldPresence {
  field: string;
  /** Key exists on the object. */
  present: number;
  /** Key exists and the value is not null/blank. */
  nonNull: number;
  total: number;
}

function presence(objs: Array<Record<string, unknown>>, fields: readonly string[]): FieldPresence[] {
  return fields.map((field) => ({
    field,
    present: objs.filter((o) => field in o).length,
    nonNull: objs.filter((o) => !isBlankId(o[field])).length,
    total: objs.length,
  }));
}

export function fieldPresence(entries: FcEntry[]): { player: FieldPresence[]; entry: FieldPresence[]; extraEntryKeys: string[]; extraPlayerKeys: string[] } {
  const players = entries.map((e) => e.player as Record<string, unknown>);
  const rows = entries as unknown as Array<Record<string, unknown>>;
  const allEntryKeys = new Set(rows.flatMap((e) => Object.keys(e)));
  const allPlayerKeys = new Set(players.flatMap((p) => Object.keys(p)));
  return {
    player: presence(players, FC_PLAYER_FIELDS),
    entry: presence(rows, FC_ENTRY_FIELDS),
    extraEntryKeys: [...allEntryKeys].filter((k) => k !== "player" && !(FC_ENTRY_FIELDS as readonly string[]).includes(k)).sort(),
    extraPlayerKeys: [...allPlayerKeys].filter((k) => !(FC_PLAYER_FIELDS as readonly string[]).includes(k)).sort(),
  };
}

export function countsByPosition(entries: FcEntry[]): Record<string, number> {
  return countBy(entries, (e) => e.player.position);
}

export interface PickRow {
  name: string;
  season: number | null;
  round: number | null;
  /** "Early" | "Mid" | "Late" when the pick is split by draft slot, null for the generic pick. */
  tier: string | null;
  value: number;
  redraftValue: number | undefined;
  ids: Record<string, unknown>;
  /** The name matched the "YYYY Nth" / "YYYY Nth (Tier)" pattern. */
  parsed: boolean;
}

const PICK_NAME = /^(\d{4}) (\d+)(?:st|nd|rd|th)(?: \((Early|Mid|Late)\))?$/;

export function parsePickName(name: string): { season: number; round: number; tier: string | null } | null {
  const m = PICK_NAME.exec(name.trim());
  if (!m) return null;
  return { season: Number(m[1]), round: Number(m[2]), tier: m[3] ?? null };
}

export function pickRows(entries: FcEntry[]): PickRow[] {
  return entries
    .filter((e) => e.player.position === "PICK")
    .map((e) => {
      const parsed = parsePickName(e.player.name);
      const ids: Record<string, unknown> = {};
      for (const f of [...FC_ID_FIELDS, "ffpcId"] as const) ids[f] = e.player[f] ?? null;
      return { name: e.player.name, season: parsed?.season ?? null, round: parsed?.round ?? null, tier: parsed?.tier ?? null, value: e.value, redraftValue: e.redraftValue, ids, parsed: parsed !== null };
    });
}

/** IDs that are really draft-pick keys (e.g. "FP_2027_1"), which must never be matched as player IDs. */
export function isPickId(v: unknown): boolean {
  return typeof v === "string" && /^FP_/.test(v);
}

const PICK_KEY = /^FP_(\d{4})_(?:([a-z]+)_)?(\d+)$/i;

export interface PickKeyForms {
  /** Per ID field: how its values look on PICK rows ("FP_ key", "null", "other"). */
  byField: Record<string, Record<string, number>>;
  /**
   * Per pick: key number minus the round from the name, per key form: generic ("FP_2027_1") and
   * tiered ("FP_2027_early_0"). 0 means the key counts rounds from 1; −1 means it counts them from 0.
   */
  roundOffset: { generic: Record<string, number>; tiered: Record<string, number> };
  /** Picks whose FP_ keys are the same string in every ID field that has one. */
  sameKeyAcrossFields: number;
  /** Picks whose key names another season than the pick name. */
  seasonMismatches: number;
}

/** How FantasyCalc encodes pick keys in the player ID fields (checked, not assumed). */
export function pickKeyForms(picks: PickRow[]): PickKeyForms {
  const byField: Record<string, Record<string, number>> = {};
  const roundOffset = { generic: {} as Record<string, number>, tiered: {} as Record<string, number> };
  let sameKeyAcrossFields = 0;
  let seasonMismatches = 0;
  for (const p of picks) {
    for (const [field, v] of Object.entries(p.ids)) {
      const kind = v === null || v === undefined ? "null" : isPickId(v) ? "FP_ key" : "other";
      const f = (byField[field] ??= {});
      f[kind] = (f[kind] ?? 0) + 1;
    }
    const keys = [...new Set(Object.values(p.ids).filter((v): v is string => isPickId(v)))];
    if (keys.length === 1) sameKeyAcrossFields++;
    const m = keys[0] ? PICK_KEY.exec(keys[0]) : null;
    if (!m || p.round === null) continue;
    if (p.season !== null && Number(m[1]) !== p.season) seasonMismatches++;
    const bucket = m[2] ? roundOffset.tiered : roundOffset.generic;
    const off = String(Number(m[3]) - p.round);
    bucket[off] = (bucket[off] ?? 0) + 1;
  }
  return { byField, roundOffset, sameKeyAcrossFields, seasonMismatches };
}

/** Compare two sets of pick names (e.g. 1QB vs superflex dynasty). */
export function compareNameSets(a: string[], b: string[]): { same: boolean; onlyA: string[]; onlyB: string[] } {
  const sa = new Set(a);
  const sb = new Set(b);
  const onlyA = [...sa].filter((x) => !sb.has(x)).sort();
  const onlyB = [...sb].filter((x) => !sa.has(x)).sort();
  return { same: !onlyA.length && !onlyB.length, onlyA, onlyB };
}

export interface RedraftGap {
  /** Non-pick players in the dynasty list that the redraft list doesn't have. */
  missingFromRedraft: number;
  /** Of those, how many carry a non-zero redraftValue in the dynasty response. */
  missingWithRedraftValue: number;
  /** Players in both lists, and how many have dynasty.redraftValue equal to the redraft value. */
  inBoth: number;
  redraftValueMatches: number;
}

/** Could the dynasty response's redraftValue fill the players the redraft list leaves out? */
export function redraftGap(redraft: FcEntry[], dynasty: FcEntry[]): RedraftGap {
  const r = new Map(redraft.map((e) => [e.player.id, e]));
  let missingFromRedraft = 0;
  let missingWithRedraftValue = 0;
  let inBoth = 0;
  let redraftValueMatches = 0;
  for (const e of dynasty) {
    if (e.player.position === "PICK") continue;
    const re = r.get(e.player.id);
    if (!re) {
      missingFromRedraft++;
      if ((e.redraftValue ?? 0) > 0) missingWithRedraftValue++;
    } else {
      inBoth++;
      if (e.redraftValue === re.value) redraftValueMatches++;
    }
  }
  return { missingFromRedraft, missingWithRedraftValue, inBoth, redraftValueMatches };
}

/** Covered players valued below / at-or-below a floor (e.g. §9 valueFloor = 1% of the top value). */
export function belowFloor(entries: FcEntry[], floor: number): { below: number; atOrBelow: number; min: FcEntry | undefined } {
  const min = entries.reduce<FcEntry | undefined>((m, e) => (!m || e.value < m.value ? e : m), undefined);
  return { below: entries.filter((e) => e.value < floor).length, atOrBelow: entries.filter((e) => e.value <= floor).length, min };
}

export interface FormatComparison {
  /** Players in both responses whose value is identical. */
  same: number;
  changed: number;
  onlyInBase: number;
  onlyInOther: number;
  /** Median value ratio other/base per position, over players present in both (changed or not). */
  medianRatioByPos: Record<string, number | null>;
  /** Positions with at least one changed value. */
  changedPositions: string[];
}

export function compareFormats(base: FcEntry[], other: FcEntry[]): FormatComparison {
  const b = new Map(base.map((e) => [e.player.id, e]));
  const o = new Map(other.map((e) => [e.player.id, e]));
  let same = 0;
  let changed = 0;
  const ratios: Record<string, number[]> = {};
  const changedPos = new Set<string>();
  for (const [id, e] of o) {
    const be = b.get(id);
    if (!be) continue;
    if (be.value === e.value) same++;
    else {
      changed++;
      changedPos.add(e.player.position);
    }
    if (be.value > 0) (ratios[e.player.position] ??= []).push(e.value / be.value);
  }
  const medianRatioByPos: Record<string, number | null> = {};
  for (const [pos, r] of Object.entries(ratios)) {
    const m = median(r);
    medianRatioByPos[pos] = m === null ? null : round(m, 3);
  }
  return {
    same,
    changed,
    onlyInBase: [...b.keys()].filter((id) => !o.has(id)).length,
    onlyInOther: [...o.keys()].filter((id) => !b.has(id)).length,
    medianRatioByPos,
    changedPositions: [...changedPos].sort(),
  };
}

export function topEntry(entries: FcEntry[]): FcEntry | undefined {
  return entries.reduce<FcEntry | undefined>((best, e) => (!best || e.value > best.value ? e : best), undefined);
}

/** value vs redraftValue (and combinedValue = value + redraftValue when present). */
export function valueRelations(entries: FcEntry[]): { valueEqualsRedraft: number; combinedIsSum: number; withCombined: number; total: number } {
  let valueEqualsRedraft = 0;
  let combinedIsSum = 0;
  let withCombined = 0;
  for (const e of entries) {
    if (e.value === e.redraftValue) valueEqualsRedraft++;
    const combined = e.combinedValue;
    if (typeof combined === "number") {
      withCombined++;
      if (Math.abs(combined - (e.value + (e.redraftValue ?? 0))) < 1e-9) combinedIsSum++;
    }
  }
  return { valueEqualsRedraft, combinedIsSum, withCombined, total: entries.length };
}

/** How many QB/RB/WR/TE entries carry each platform ID (pick keys excluded). */
export function idCoverage(entries: FcEntry[]): { players: number; byField: Record<string, number> } {
  const skill = entries.filter((e) => (SKILL_POSITIONS as readonly string[]).includes(e.player.position));
  const byField: Record<string, number> = {};
  for (const f of [...FC_ID_FIELDS, "ffpcId"] as const) byField[f] = skill.filter((e) => !isBlankId(e.player[f]) && !isPickId(e.player[f])).length;
  return { players: skill.length, byField };
}

/** Union of non-pick players across several responses, keyed by FantasyCalc id. */
export function unionPlayers(...lists: FcEntry[][]): Map<number, FcEntry["player"]> {
  const out = new Map<number, FcEntry["player"]>();
  for (const list of lists) for (const e of list) if (e.player.position !== "PICK" && !out.has(e.player.id)) out.set(e.player.id, e.player);
  return out;
}
