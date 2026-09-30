/**
 * Fleaflicker position labels → the normalized model (CLAUDE.md §4).
 *
 * Fleaflicker uses its own IDP labels: EDR (edge rusher, eligible as EDR/DE or EDR/LB), IL (interior
 * line, IL/DT or DE/IL), CB and S; D/ST is the team defense; P is a punter (a model position since
 * the planner's reply to Checkpoint 0, answer 5). Dual-position players ("WR/CB") use the first part.
 */
import type { Pos } from "@/engine/model";

const POS_MAP: Readonly<Record<string, Pos>> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  K: "K",
  P: "P",
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
};

/** Map a Fleaflicker position label; null when the model has no position for it. */
export function mapPos(label: string | undefined): Pos | null {
  if (!label) return null;
  const direct = POS_MAP[label];
  if (direct) return direct;
  return POS_MAP[label.split("/")[0] ?? ""] ?? null;
}

/** Model positions that several Fleaflicker labels collapse into (a rule may name only some of them). */
export const MERGED_LABELS: ReadonlyArray<{ pos: Pos; labels: readonly string[] }> = [
  { pos: "DB", labels: ["CB", "S"] },
  { pos: "DL", labels: ["EDR", "IL"] },
];
