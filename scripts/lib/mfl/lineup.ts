/**
 * MFL starting lineups → SlotDef[] (CLAUDE.md §4). MFL doesn't list slots: TYPE=league gives a total
 * (starters.count) and a min–max range per position ("QB" "1-2", "RB" "0-4", "DT+DE" "1-3"), plus
 * starters.idp_starters for the IDP share. Flex spots are implicit: count − Σ mins.
 *
 * Conversion: mins become fixed slots; the flex spots F = count − Σ mins go to positions whose range
 * allows more. A range "binds" when its extra room e = max − min is smaller than F; the others are
 * "free" (they can take all of F). When the binding ranges' rooms add up to at most F, the lineup is
 * exact as SlotDefs: one slot group per binding range b, ({b} ∪ free) × e_b, plus free × (F − Σ e_b).
 * Each binding range then starts at most e_b extras, the free positions fill the rest, and every legal
 * lineup fits (property-tested against brute force). When the binding rooms add up to more than F
 * (this league: QB 1-2, RB 0-4, WR 0-5, TE 1-3 with 6 flex spots), no SlotDef set expresses the caps,
 * so the result keeps per-position starter caps and is flagged inexact.
 */
import { asArray, at, num, text } from "./json";
import { IDP_POS, splitPositions, toPos, type Pos } from "./positions";

export interface SlotDef {
  slot: string;
  count: number;
  eligible: Pos[];
}

export interface StarterRange {
  name: string;
  pos: Pos[];
  min: number;
  max: number;
}

export interface PoolSummary {
  pool: "offense" | "idp" | "all";
  count: number;
  mins: number;
  flex: number;
  binding: string[];
}

export interface LineupConversion {
  lineup: SlotDef[];
  /** Max starters per position (MFL range maxima). Needed by the solver when `exact` is false. */
  starterCaps: Partial<Record<Pos, number>>;
  exact: boolean;
  pools: PoolSummary[];
  ranges: StarterRange[];
  unsupported: string[];
  notes: string[];
}

const ORDER: Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];
const sortPos = (ps: Iterable<Pos>) => [...new Set(ps)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

export function parseLimit(limit: string | undefined): { min: number; max: number } | undefined {
  const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(limit ?? "");
  if (!m) return undefined;
  const min = Number(m[1]);
  const max = m[2] === undefined ? min : Number(m[2]);
  return max >= min ? { min, max } : undefined;
}

export function flexName(eligible: Pos[]): string {
  const key = sortPos(eligible).join(",");
  const named: Record<string, string> = {
    "RB,WR,TE": "FLEX",
    "QB,RB,WR,TE": "SUPER_FLEX",
    "RB,WR": "WRRB_FLEX",
    "WR,TE": "REC_FLEX",
    "DL,LB,DB": "IDP_FLEX",
  };
  if (named[key]) return named[key];
  return eligible.length === 1 ? (eligible[0] as string) : `FLEX(${sortPos(eligible).join("/")})`;
}

function convertPool(pool: PoolSummary["pool"], count: number, ranges: StarterRange[], out: LineupConversion): void {
  const mins = ranges.reduce((s, r) => s + r.min, 0);
  const flex = count - mins;
  const summary: PoolSummary = { pool, count, mins, flex, binding: [] };
  out.pools.push(summary);
  for (const r of ranges) if (r.min > 0) out.lineup.push({ slot: flexName(r.pos), count: r.min, eligible: sortPos(r.pos) });
  if (flex < 0) {
    out.exact = false;
    out.notes.push(`${pool}: position minimums (${mins}) exceed the starter count (${count})`);
    return;
  }
  if (flex === 0) return;
  const open = ranges.filter((r) => r.max > r.min);
  const eligible = sortPos(open.flatMap((r) => r.pos));
  const room = open.reduce((s, r) => s + (r.max - r.min), 0);
  if (room < flex) {
    out.exact = false;
    out.notes.push(`${pool}: ranges allow only ${room} extra starters for ${flex} flex spots`);
  }
  if (!eligible.length) return;
  const binding = open.filter((r) => r.max - r.min < flex);
  const free = sortPos(open.filter((r) => r.max - r.min >= flex).flatMap((r) => r.pos));
  const bindingRoom = binding.reduce((s, r) => s + (r.max - r.min), 0);
  summary.binding = binding.map((r) => `${r.name} ≤ ${r.max - r.min} extra`);
  if (binding.length === 0) {
    out.lineup.push({ slot: flexName(eligible), count: flex, eligible });
  } else if (bindingRoom <= flex && room >= flex) {
    for (const b of binding) {
      const el = sortPos([...b.pos, ...free]);
      out.lineup.push({ slot: flexName(el), count: b.max - b.min, eligible: el });
    }
    if (flex - bindingRoom > 0 && free.length) out.lineup.push({ slot: flexName(free), count: flex - bindingRoom, eligible: free });
  } else {
    out.exact = false;
    out.lineup.push({ slot: flexName(eligible), count: flex, eligible });
    out.notes.push(`${pool}: ${binding.length} position range(s) cap the ${flex} flex spots (${summary.binding.join(", ")}) and their caps add up to ${bindingRoom} > ${flex}, which no SlotDef set can express; SlotDefs alone over-allow them, so the solver needs starterCaps`);
  }
}

/** Convert league.starters from TYPE=league (JSON=1). */
export function convertStarters(starters: unknown): LineupConversion {
  const out: LineupConversion = { lineup: [], starterCaps: {}, exact: true, pools: [], ranges: [], unsupported: [], notes: [] };
  const count = num(at(starters, "count")) ?? 0;
  const idpCount = num(at(starters, "idp_starters"));
  for (const e of asArray(at(starters, "position") as unknown[])) {
    const name = text(at(e, "name")) ?? "";
    const lim = parseLimit(text(at(e, "limit")));
    const pos = splitPositions(name).map(toPos);
    if (!lim || pos.some((p) => p === undefined)) {
      out.unsupported.push(`${name} ${text(at(e, "limit")) ?? "?"}`);
      continue;
    }
    const r: StarterRange = { name, pos: sortPos(pos as Pos[]), min: lim.min, max: lim.max };
    out.ranges.push(r);
    for (const p of r.pos) out.starterCaps[p] = (out.starterCaps[p] ?? 0) + lim.max;
  }
  if (out.unsupported.length) {
    out.exact = false;
    out.notes.push(`unsupported starter positions: ${out.unsupported.join(", ")}`);
  }
  // Two MFL ranges on one model position (e.g. separate "DT" and "DE" ranges, both DL) can't be told
  // apart by SlotDefs or by per-position caps.
  const owner = new Map<Pos, string>();
  for (const r of out.ranges)
    for (const p of r.pos) {
      const prev = owner.get(p);
      if (prev && prev !== r.name) {
        out.exact = false;
        out.notes.push(`${prev} and ${r.name} both map to ${p}; the model can't keep their separate ranges`);
      }
      owner.set(p, r.name);
    }
  const isIdp = (r: StarterRange) => r.pos.every((p) => IDP_POS.has(p));
  if (idpCount !== undefined && idpCount > 0) {
    convertPool("offense", count - idpCount, out.ranges.filter((r) => !isIdp(r)), out);
    convertPool("idp", idpCount, out.ranges.filter(isIdp), out);
    out.notes.push(`starters.idp_starters=${idpCount} read as the IDP share of starters.count=${count} (inferred; not documented)`);
  } else {
    convertPool("all", count, out.ranges, out);
  }
  return out;
}

/** TYPE=league rosterLimits → max per position (and the minimums, which the model has no field for). */
export function convertRosterLimits(rosterLimits: unknown): { max: Partial<Record<Pos, number>>; min: Partial<Record<Pos, number>>; unsupported: string[] } {
  const max: Partial<Record<Pos, number>> = {};
  const min: Partial<Record<Pos, number>> = {};
  const unsupported: string[] = [];
  for (const e of asArray(at(rosterLimits, "position") as unknown[])) {
    const name = text(at(e, "name")) ?? "";
    const lim = parseLimit(text(at(e, "limit")));
    const pos = splitPositions(name).map(toPos);
    if (!lim || pos.some((p) => p === undefined) || new Set(pos).size !== 1) {
      unsupported.push(`${name} ${text(at(e, "limit")) ?? "?"}`);
      continue;
    }
    const p = pos[0] as Pos;
    max[p] = lim.max;
    min[p] = lim.min;
  }
  return { max, min, unsupported };
}
