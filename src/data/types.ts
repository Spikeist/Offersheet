/**
 * Contracts of the shared data layer (CLAUDE.md §2.9, §3 src/data). Implemented in src/data/, consumed
 * by the adapters through ImportDeps.resolver so every player gets a canonical id from the start:
 * the Sleeper id when known, else `${platform}:${id}`.
 */
import type { ImportWarning } from "@/engine/model";

/** Public facts about a player from the Sleeper players DB (never the whole 15 MB DB in the browser). */
export interface SleeperPlayerLite {
  id: string;
  name: string;
  /** Sleeper's primary position (QB, RB, WR, TE, K, P, DEF, DL, LB, DB, OL…). */
  position: string | null;
  fantasyPositions: string[];
  /** NFL team code in Sleeper's convention (e.g. "LAR", "WAS"), null when a free agent. */
  team: string | null;
  /** Sleeper injury_status: Questionable, Doubtful, Out, IR, PUP, Sus, NA, DNR, COV, or null. */
  injuryStatus: string | null;
  status: string | null;
  age: number | null;
  /** false: not an active NFL player (known only when every Sleeper player list loaded fully and fresh); null: unknown. */
  active: boolean | null;
  yearsExp: number | null;
}

export type IdSource = "espn" | "mfl" | "fleaflicker" | "yahoo" | "fantrax" | "sportradar" | "gsis";

export interface PlayerIdResolver {
  /** Canonical Sleeper id for a platform player id; undefined when no source maps it. */
  canonical(source: IdSource, platformId: string): string | undefined;
  /**
   * Public player facts for a Sleeper id, when known. A player missing from Sleeper's active lists
   * comes from DynastyProcess: `active: false` (retired or unsigned) only when every Sleeper player
   * list loaded fully and fresh, else `active: null` (unknown).
   */
  sleeperPlayer(sleeperId: string): SleeperPlayerLite | undefined;
  /** Sleeper DEF id (its team code, e.g. "DAL") for an NFL team abbreviation in any source's convention. */
  defenseId(teamCode: string): string | undefined;
  /** Where the maps came from and when (Import Report timestamps). */
  sources(): { name: string; fetchedAt: string | null }[];
  /**
   * Last-resort match for a player no ID source maps: the Sleeper id of the ONLY active player with
   * this exact name, position and NFL team. Adapters warn about every player matched this way.
   */
  matchByName?(query: { name: string; position: string; team: string | null }): string | undefined;
  /** Import Report warnings about the ID sources themselves (one unavailable or partly loaded). */
  warnings?(): ImportWarning[];
  /** When sources disagreed on this platform id's Sleeper id: the options and the one chosen (adapters warn for their league's players). */
  conflict?(source: IdSource, platformId: string): { chosen: string; options: ReadonlyArray<{ sleeperId: string }> } | undefined;
}
