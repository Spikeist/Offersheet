/**
 * MFL position codes → the normalized model (CLAUDE.md §4). Seen 2026-09-29 in TYPE=players DETAILS=1:
 * QB RB WR TE PK PN DT DE LB CB S Def ST Off Coach XX and team positions TMQB…TMPN.
 * PN (punter) maps to P (planner reply to Checkpoint 0, answer 5); Coach is a head coach (HC), which
 * the model treats as unmapped with a warning, like team units (Off, ST, TM*) and XX.
 */
import type { Pos } from "@/engine/model";

export const MFL_POS: Readonly<Record<string, Pos>> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  PK: "K",
  PN: "P",
  Def: "DEF",
  DT: "DL",
  DE: "DL",
  LB: "LB",
  CB: "DB",
  S: "DB",
};

/** MFL positions whose scoring keys are the individual defensive (idp_*) keys; QB RB WR TE PK PN use the offensive keys and Def the team keys. */
export const MFL_IDP_POSITIONS: ReadonlySet<string> = new Set(["DT", "DE", "LB", "CB", "S"]);

/**
 * When two MFL positions share one model position (DT/DE → DL, CB/S → DB) but score differently,
 * the model can hold only one set of rates: the first listed here wins (with a warning).
 */
export const MERGE_PREFERENCE: Readonly<Partial<Record<Pos, readonly string[]>>> = { DL: ["DE", "DT"], DB: ["CB", "S"] };

export function toPos(mflPos: string | undefined): Pos | undefined {
  return mflPos ? MFL_POS[mflPos] : undefined;
}

/** Why an MFL position has no model position (for Import Report warnings). */
export function unsupportedReason(mflPos: string): string {
  if (mflPos === "Coach") return "head coach (HC) is not a model position";
  if (mflPos === "Off" || mflPos === "ST" || /^TM/.test(mflPos)) return "team units are not model positions";
  return "not a model position";
}

/**
 * A starter/roster-limit entry name can combine positions ("DT+DE", "CB+S"); a scoring rule group
 * uses "|" ("QB|RB|WR|TE"). Returns the MFL positions it covers.
 */
export function splitPositions(name: string): string[] {
  return name
    .split(/[+|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
