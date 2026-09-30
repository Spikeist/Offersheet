/**
 * ESPN football ID tables, parsed from cwendt94/espn-api (MIT License, Copyright (c) 2018 Christian
 * Wendt): espn_api/football/constant.py. Phase 1 ports the parsed tables to src/adapters/espn with
 * the same credit. The source commit we used is recorded in the probe report.
 *
 * Tables:
 * - POSITION_MAP: lineup SLOT ids (0 QB, 2 RB, 20 BE, 21 IR, 23 FLEX, …) plus the reverse names.
 *   Note: player.defaultPositionId is a DIFFERENT code space that espn-api doesn't map (player.py
 *   derives the position from eligibleSlots instead); see positionFromEligibleSlots(). The probe
 *   derives the defaultPositionId table empirically (1 QB, 2 RB, 3 WR, 4 TE, 5 K, 7 P, 9 DT, 10 DE,
 *   11 LB, 12 CB, 13 S, 14 HC, 15 TQB, 16 D/ST on 2026-09-29); scoring pointsOverrides use it.
 * - PRO_TEAM_MAP: proTeamId → NFL abbreviation.
 * - PLAYER_STATS_MAP: statId → stat name (player stat breakdowns).
 * - SETTINGS_SCORING_FORMAT_MAP: statId → {abbr, label} (what scoring settings mean).
 * - ACTIVITY_MAP: recent-activity messageTypeId → action.
 * - TRANSACTION_TYPES: mTransactions2 type filter values.
 */
import { isDict, isSet, parsePyAssignments, type PyValue } from "./pyliteral";

export const ESPN_API_REPO = "cwendt94/espn-api";
export const ESPN_API_CONSTANT_PATH = "espn_api/football/constant.py";

export interface ScoringFormat {
  abbr: string;
  label: string;
}

export interface EspnConstants {
  /** Lineup slot id → label ("QB", "RB/WR", "BE", "IR", "RB/WR/TE", …). */
  slotNames: Record<number, string>;
  /** Label → lineup slot id (espn-api's reverse entries, e.g. "FLEX" → 23). */
  slotIdsByName: Record<string, number>;
  proTeams: Record<number, string>;
  playerStats: Record<number, string>;
  scoringFormat: Record<number, ScoringFormat>;
  activity: Record<number, string>;
  transactionTypes: string[];
  /** Assignment names that failed to parse (should be empty). */
  parseErrors: Record<string, string>;
}

function intKeyed<T>(v: PyValue | undefined, map: (x: PyValue) => T | undefined): Record<number, T> {
  const out: Record<number, T> = {};
  if (!isDict(v)) return out;
  for (const [k, x] of v.entries) {
    if (typeof k !== "number" || !Number.isInteger(k)) continue;
    const m = map(x);
    if (m !== undefined) out[k] = m;
  }
  return out;
}

function strKeyedInt(v: PyValue | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isDict(v)) return out;
  for (const [k, x] of v.entries) if (typeof k === "string" && typeof x === "number") out[k] = x;
  return out;
}

const asString = (x: PyValue): string | undefined => (typeof x === "string" ? x : undefined);

export function parseEspnConstants(source: string): EspnConstants {
  const { values, errors } = parsePyAssignments(source);
  const required = ["POSITION_MAP", "PRO_TEAM_MAP", "PLAYER_STATS_MAP", "SETTINGS_SCORING_FORMAT_MAP"];
  for (const name of required) if (!(name in values)) errors[name] ??= "missing";
  return {
    slotNames: intKeyed(values.POSITION_MAP, asString),
    slotIdsByName: strKeyedInt(values.POSITION_MAP),
    proTeams: intKeyed(values.PRO_TEAM_MAP, asString),
    playerStats: intKeyed(values.PLAYER_STATS_MAP, asString),
    scoringFormat: intKeyed(values.SETTINGS_SCORING_FORMAT_MAP, (x) => {
      if (!isDict(x)) return undefined;
      const get = (key: string) => x.entries.find(([k]) => k === key)?.[1];
      const abbr = get("abbr");
      const label = get("label");
      return typeof abbr === "string" && typeof label === "string" ? { abbr, label } : undefined;
    }),
    activity: intKeyed(values.ACTIVITY_MAP, asString),
    transactionTypes: isSet(values.TRANSACTION_TYPES) ? values.TRANSACTION_TYPES.values.filter((x): x is string => typeof x === "string").sort() : [],
    parseErrors: errors,
  };
}

/**
 * A player's main position, exactly as espn-api's football/player.py derives it: the first
 * eligible slot that isn't 25 ("Rookie") and isn't a combo slot ("RB/WR"), unless the player's
 * name contains "/" (team defenses are named "Bills D/ST").
 */
export function positionFromEligibleSlots(eligibleSlots: readonly number[], slotNames: Record<number, string>, fullName = ""): string | undefined {
  for (const slot of eligibleSlots) {
    const label = slotNames[slot];
    if (label === undefined) continue;
    if ((slot !== 25 && !label.includes("/")) || fullName.includes("/")) return label;
  }
  return undefined;
}

/**
 * The lineup slot id that stands for a position (QB → 0, TE → 6, D/ST → 16, K → 17). CLAUDE.md §2.2
 * assumed pointsOverrides are keyed by this; live data says they're keyed by defaultPositionId.
 */
export function slotIdForPosition(position: string, c: Pick<EspnConstants, "slotIdsByName" | "slotNames">): number | undefined {
  const direct = c.slotIdsByName[position];
  if (direct !== undefined) return direct;
  const hit = Object.entries(c.slotNames).find(([, label]) => label === position);
  return hit ? Number(hit[0]) : undefined;
}
