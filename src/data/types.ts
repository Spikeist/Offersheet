/**
 * Contracts of the shared data layer (CLAUDE.md §2.9, §3 src/data). Implemented in src/data/, consumed
 * by the adapters through ImportDeps.resolver so every player gets a canonical id from the start:
 * the Sleeper id when known, else `${platform}:${id}`.
 */

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
  active: boolean;
  yearsExp: number | null;
}

export type IdSource = "espn" | "mfl" | "fleaflicker" | "yahoo" | "fantrax" | "sportradar" | "gsis";

export interface PlayerIdResolver {
  /** Canonical Sleeper id for a platform player id; undefined when no source maps it. */
  canonical(source: IdSource, platformId: string): string | undefined;
  /** Public player facts for a Sleeper id, when known. */
  sleeperPlayer(sleeperId: string): SleeperPlayerLite | undefined;
  /** Sleeper DEF id (its team code, e.g. "DAL") for an NFL team abbreviation in any source's convention. */
  defenseId(teamCode: string): string | undefined;
  /** Where the maps came from and when (Import Report timestamps). */
  sources(): { name: string; fetchedAt: string | null }[];
}
