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

/** The ID sources behind the crosswalk (src/data/crosswalk.ts): the Sleeper players DB, DynastyProcess and FantasyCalc. */
export type CrosswalkSourceKey = "sleeper" | "dynastyProcess" | "fantasyCalc";

/**
 * One platform id that the ID sources map to two or more Sleeper ids, and how the crosswalk chose
 * (CLAUDE.md §2.9 "Player ID crosswalk rules"). Read-only: the resolver is shared between imports.
 */
export interface CrosswalkConflict {
  readonly source: IdSource;
  /** The platform id in its normalized form (normalizeId). */
  readonly platformId: string;
  /**
   * Distinct Sleeper ids offered, in priority order: the sources offering each, and whether it is an
   * active player in Sleeper's fantasy-position lists.
   */
  readonly options: ReadonlyArray<{ readonly sleeperId: string; readonly from: readonly CrosswalkSourceKey[]; readonly active: boolean }>;
  /** The Sleeper id used. */
  readonly chosen: string;
  /**
   * - "source order": the highest-priority source's id.
   * - "active player": that source listed the platform id twice; its first option isn't an active
   *   player and a later one is.
   * - "same player": an override (Checkpoint 1 answer 2). The top source links a Sleeper id that
   *   isn't an active fantasy player, and a lower source links an active player whose Sleeper record
   *   matches the top source's row on name and position, plus NFL team or GSIS id (`sameBy`).
   *   Adapters log each one on their league's players as an Import Report note.
   */
  readonly resolvedBy: "active player" | "same player" | "source order";
  /** For "same player": what matched besides name and position. */
  readonly sameBy?: ReadonlyArray<"team" | "gsis">;
  /** One source offered two Sleeper ids (a duplicate inside that source). */
  readonly withinSource: boolean;
}

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
   * Last-resort match for a player no ID source maps (Checkpoint 1 answer 1): the Sleeper id of the
   * ONLY active player with this exact name (compared on letters only, so case, accents, spaces,
   * punctuation and Jr/Sr/II–V don't count), position and NFL team, else undefined. A player with no NFL team (null, "", "FA"…) never
   * matches, nor does an unknown team code. Adapters flag every player they keep matched this way in
   * the Import Report (not one that then collides with another player's Sleeper id).
   */
  matchByName?(query: { name: string; position: string; team: string | null }): string | undefined;
  /** Import Report warnings about the ID sources themselves (one unavailable or partly loaded). */
  warnings?(): ImportWarning[];
  /**
   * When sources disagreed on this platform id's Sleeper id: every option with its sources, the one
   * chosen and why. Adapters note each "same player" override on their league's players and warn
   * about the other resolutions.
   */
  conflict?(source: IdSource, platformId: string): CrosswalkConflict | undefined;
}
