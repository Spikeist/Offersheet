/**
 * Normalized data model (CLAUDE.md §4). Adapters produce a LeagueSnapshot; the engine and the UI
 * consume it. Pure types only — no runtime code, no I/O.
 */

export type Platform = "espn" | "sleeper" | "yahoo" | "fleaflicker" | "mfl" | "fantrax" | "manual";
export type Pos = "QB" | "RB" | "WR" | "TE" | "K" | "P" | "DEF" | "DL" | "LB" | "DB";
export const POSITIONS: readonly Pos[] = ["QB", "RB", "WR", "TE", "K", "P", "DEF", "DL", "LB", "DB"];

export interface LeagueSnapshot {
  platform: Platform;
  leagueId: string;
  season: number;
  name: string;
  /** ISO timestamp. */
  fetchedAt: string;
  /** NFL week. */
  currentWeek: number;
  settings: LeagueSettings;
  teams: Team[];
  myTeamId: string | null;
  /** key = canonical id: Sleeper id when known, else `${platform}:${id}`. */
  players: Record<string, PlayerInfo>;
  /** All fantasy matchups, past and future. */
  schedule: Matchup[];
  /** This season. */
  transactions: Transaction[];
  /** Canonical ids: top 50 per position by projection (derive as player DB minus rostered when needed). */
  freeAgents: string[];
  /** Where the platform supports traded picks. */
  draftPicks?: DraftPick[];
  /** Anything we couldn't map, with platform field paths. */
  warnings: ImportWarning[];
}

export interface LeagueSettings {
  numTeams: number;
  leagueType: "redraft" | "keeper" | "dynasty";
  /** Starting slots only. */
  lineup: SlotDef[];
  benchSlots: number;
  irSlots: number;
  taxiSlots: number;
  /** Active roster, excluding IR/taxi. */
  maxRosterSize: number;
  /** Max per position on the active roster (IR exempt). */
  positionLimits?: Partial<Record<Pos, number>>;
  /** Per-position starter min–max (MFL); the lineup solver honors it. */
  starterLimits?: Partial<Record<Pos, { min: number; max: number }>>;
  /** Enforced roster minimums (trade legality). */
  rosterMinimums?: Partial<Record<Pos, number>>;
  /** The platform sets lineups automatically (Import Report note). */
  bestBall?: boolean;
  scoring: Scoring;
  /** NFL weeks in the fantasy regular season. */
  regularSeasonWeeks: number[];
  /** NFL weeks of fantasy playoffs, in order. */
  playoffWeeks: number[];
  playoffTeams: number;
  playoffByes?: number;
  /** Weeks per round when rounds last more than one week. */
  playoffRoundWeeks?: number[];
  /** Extra W/L vs the league median each week. */
  medianGame: boolean;
  /** No head-to-head. */
  pointsOnly: boolean;
  divisions?: { id: string; teamIds: string[] }[];
  /** When the platform reports it (§8). */
  playoffSeeding?: { reseed: boolean; divisionWinnersFirst: boolean };
  tradeDeadline: { week?: number; date?: string } | null;
  tradeReview: "none" | "commissioner" | "league_vote";
  faabBudget?: number;
}

/** e.g. { slot: 'FLEX', count: 1, eligible: ['RB','WR','TE'] } */
export interface SlotDef {
  slot: string;
  count: number;
  eligible: Pos[];
}

export interface Scoring {
  /** Per-unit: canonical (Sleeper) stat key → points per unit. */
  perStat: Record<string, number>;
  /** Per-position REPLACEMENT rate for a key (e.g. ESPN pointsOverrides: TE rec = 1.5). */
  byPosition?: Partial<Record<Pos, Record<string, number>>>;
  /** Everything that isn't a plain per-unit rate (§5). */
  rules: ScoringRule[];
  /** Shown in the Import Report. */
  unmapped: { platformKey: string; label: string; points: number }[];
}

/** One canonical key, or a composite stat such as pass_yd + rush_yd. */
export type StatExpr = string | { sum: string[] };

export type ScoringRule = { positions?: Pos[] } & (
  /** stat ≥ min → points, e.g. 100+ rush yds. */
  | { kind: "threshold"; stat: StatExpr; min: number; points: number }
  /** bucket min ≤ stat ≤ max → points, e.g. D/ST points allowed 14–17 (either bound may be open). */
  | { kind: "range"; stat: StatExpr; min?: number; max?: number; points: number }
  /** points for every N units, counted within [min, max]: floor((min(stat, max) − min) / every). */
  | { kind: "stepped"; stat: StatExpr; every: number; points: number; min?: number; max?: number }
  /** per-unit rate on a composite stat, or only when the stat is within [min, max]. */
  | { kind: "perUnit"; stat: StatExpr; points: number; min?: number; max?: number }
  /** constant per game played. */
  | { kind: "perGame"; points: number }
);

export interface Team {
  id: string;
  name: string;
  ownerName: string;
  roster: string[];
  ir: string[];
  taxi: string[];
  record: { w: number; l: number; t: number };
  pointsFor: number;
  pointsAgainst: number;
  divisionId?: string;
}

export type InjuryStatus = "ACTIVE" | "QUESTIONABLE" | "DOUBTFUL" | "OUT" | "IR" | "PUP" | "SUSPENDED" | "NA";

export interface PlayerInfo {
  id: string;
  name: string;
  pos: Pos;
  eligible: Pos[];
  nflTeam: string | null;
  injury: InjuryStatus;
  injuryReturnWeek?: number;
  age?: number;
  ids: Partial<Record<Platform | "fantasycalc" | "gsis" | "sportradar", string>>;
}

export interface Matchup {
  week: number;
  teamA: string;
  teamB: string | null;
  isPlayoff: boolean;
}

export interface Transaction {
  id: string;
  type: "trade" | "add" | "drop" | "waiver";
  week: number;
  timestamp: string;
  teams: string[];
  moves: { playerId: string; from: string | null; to: string | null }[];
  picks?: DraftPick[];
}

export interface DraftPick {
  season: number;
  round: number;
  originalTeamId: string;
  ownerTeamId: string;
}

export interface ImportWarning {
  code: string;
  message: string;
  platformPath?: string;
}

/** A stat line in canonical (Sleeper) keys: actual stats for a game, or projected means. */
export type StatLine = Record<string, number>;

// Outside the snapshot:
export type WeeklyProjection = Record<string /* playerId */, Record<number /* week */, number /* points */>>;
export type MarketValues = Record<string /* playerId */, { value: number; source: "fantasycalc" | "estimate" | "floor" }>;
