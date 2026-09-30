/**
 * Fleaflicker positions, roster slots and injury codes → the normalized model (CLAUDE.md §4).
 *
 * Fleaflicker uses its own IDP labels: EDR (edge rusher, eligible as EDR/DE or EDR/LB), IL
 * (interior line, IL/DT or DE/IL), CB and S. It also has punters (P), which the model has no Pos for.
 */
import { enumOr, num, type FfInjury, type FfRosterPosition } from "./api";

export type Pos = "QB" | "RB" | "WR" | "TE" | "K" | "DEF" | "DL" | "LB" | "DB";
export type Injury = "ACTIVE" | "QUESTIONABLE" | "DOUBTFUL" | "OUT" | "IR" | "PUP" | "SUSPENDED" | "NA";

const POS_MAP: Record<string, Pos | null> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  K: "K",
  "D/ST": "DEF",
  DST: "DEF",
  DEF: "DEF",
  CB: "DB",
  S: "DB",
  DB: "DB",
  EDR: "DL",
  DE: "DL",
  IL: "DL",
  DT: "DL",
  DL: "DL",
  LB: "LB",
  P: null, // no punter position in the model
};

/** Map a Fleaflicker position ("WR/CB" dual-position players use the first part). */
export function mapPos(ff: string | undefined): Pos | null {
  if (!ff) return null;
  if (ff in POS_MAP) return POS_MAP[ff] ?? null;
  const first = ff.split("/")[0] ?? "";
  return POS_MAP[first] ?? null;
}

/**
 * Does a listed player fit a position filter? FetchPlayerListing can ignore
 * filter.position_eligibility (seen for D/ST in a league that can't roster D/ST), so check.
 */
export function positionMatches(player: { position?: string; positionEligibility?: string[] }, label: string): boolean {
  if (player.position === label) return true;
  if ((player.positionEligibility ?? []).includes(label)) return true;
  return (player.position ?? "").split("/").includes(label);
}

/** Map every eligibility label; returns mapped positions and the labels that have no Pos. */
export function mapEligibility(labels: readonly string[]): { eligible: Pos[]; unmapped: string[] } {
  const eligible = new Set<Pos>();
  const unmapped = new Set<string>();
  for (const l of labels) {
    const p = mapPos(l);
    if (p) eligible.add(p);
    else unmapped.add(l);
  }
  return { eligible: [...eligible], unmapped: [...unmapped] };
}

/**
 * Injury: `typeAbbreviaition` (sic, the API's spelling) is the most specific field; `severity` only
 * has HEALTHY / PROBABLE / QUESTIONABLE / OUT, so IR, PUP and suspensions all show as OUT there.
 */
export function mapInjury(inj: FfInjury | undefined): { status: Injury; known: boolean } {
  if (!inj) return { status: "ACTIVE", known: true };
  const code = (inj.typeAbbreviaition ?? "").toUpperCase();
  const byCode: Record<string, Injury> = {
    Q: "QUESTIONABLE",
    D: "DOUBTFUL",
    O: "OUT",
    OUT: "OUT",
    IR: "IR",
    IRD: "IR", // IR, designated for return
    PUP: "PUP",
    SUS: "SUSPENDED",
    SSPD: "SUSPENDED",
    EX: "NA", // reserve/exempt
    NFI: "NA",
    NA: "NA",
  };
  if (code in byCode) return { status: byCode[code] as Injury, known: true };
  const sev = enumOr(inj.severity, "InjurySeverity");
  if (sev === "QUESTIONABLE") return { status: "QUESTIONABLE", known: false };
  if (sev === "OUT") return { status: "OUT", known: false };
  return { status: "ACTIVE", known: false };
}

export interface SlotDef {
  slot: string;
  count: number;
  eligible: Pos[];
}

export interface LineupSummary {
  lineup: SlotDef[];
  benchSlots: number;
  irSlots: number;
  taxiSlots: number;
  /** Per-position max on the roster (Fleaflicker `max`), summed into model positions (lossy: CB+S → DB). */
  positionLimits: Partial<Record<Pos, number>>;
  /** The league's own per-label maxima (CB 4, S 4 …), before merging into model positions. */
  labelLimits: Record<string, number>;
  /** Model positions that several Fleaflicker labels were merged into (e.g. DB ← CB, S). */
  mergedLimits: Array<{ pos: Pos; labels: string[] }>;
  /** Per-position roster minimums (the model has no field for these). */
  positionMinimums: Record<string, number>;
  /** Starting slots whose eligibility includes labels with no Pos (e.g. "P" in K/P). */
  unmappedEligibility: Array<{ slot: string; labels: string[] }>;
  /** Positions allowed on the roster but with no starting slot (start omitted = 0). */
  rosterOnly: string[];
}

/**
 * rosterPositions → lineup. Groups: START = starting slot (count = `start`), BENCH (the proto3
 * default, so the BN entry has no `group`), INJURED = IR, TAXI = taxi squad.
 */
export function summarizeLineup(positions: readonly FfRosterPosition[]): LineupSummary {
  const out: LineupSummary = { lineup: [], benchSlots: 0, irSlots: 0, taxiSlots: 0, positionLimits: {}, labelLimits: {}, mergedLimits: [], positionMinimums: {}, unmappedEligibility: [], rosterOnly: [] };
  const labelsOf = new Map<Pos, string[]>();
  for (const rp of positions) {
    const group = enumOr(rp.group, "RosterPositionGroup");
    const label = rp.label ?? "?";
    const start = num(rp.start);
    if (group === "BENCH") {
      out.benchSlots += Math.max(num(rp.max), start);
      continue;
    }
    if (group === "INJURED") {
      out.irSlots += start;
      continue;
    }
    if (group === "TAXI") {
      out.taxiSlots += start;
      continue;
    }
    const { eligible, unmapped } = mapEligibility(rp.eligibility ?? [label]);
    if (start > 0) {
      out.lineup.push({ slot: label, count: start, eligible });
      if (unmapped.length) out.unmappedEligibility.push({ slot: label, labels: unmapped });
    } else {
      out.rosterOnly.push(label);
    }
    // Limits only make sense for single-position slots (QB, RB …), not for flex slots.
    if ((rp.eligibility ?? []).length === 1) {
      const p = mapPos(label);
      if (num(rp.max) > 0) out.labelLimits[label] = num(rp.max);
      if (p && num(rp.max) > 0) {
        out.positionLimits[p] = (out.positionLimits[p] ?? 0) + num(rp.max);
        labelsOf.set(p, [...(labelsOf.get(p) ?? []), label]);
      }
      if (num(rp.min) > 0) out.positionMinimums[label] = num(rp.min);
    }
  }
  out.mergedLimits = [...labelsOf.entries()].filter(([, labels]) => labels.length > 1).map(([pos, labels]) => ({ pos, labels }));
  return out;
}

/** Classify a flex slot by its eligibility (for the report). */
export function flexKind(slot: SlotDef): string | null {
  const e = new Set(slot.eligible);
  if (slot.eligible.length <= 1) return null;
  if (e.has("QB") && (e.has("RB") || e.has("WR") || e.has("TE"))) return "SUPER_FLEX";
  if (e.has("RB") && e.has("WR") && e.has("TE")) return "FLEX";
  if (e.has("RB") && e.has("WR")) return "WRRB_FLEX";
  if (e.has("WR") && e.has("TE")) return "REC_FLEX";
  if ([...e].every((p) => p === "DL" || p === "LB" || p === "DB")) return "IDP_FLEX";
  return "OTHER_FLEX";
}
