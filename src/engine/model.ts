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
  /** The platform's own league week when it can lag the NFL week (Sleeper settings.leg: trades complete through leg D). */
  leagueWeek?: number;
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
  /**
   * Injury statuses an IR slot accepts, when the platform reports its rule (Sleeper's reserve_allow_* settings);
   * absent = unknown (config.lineups.irEligibleDefault: IR and PUP). Phase 4b (planner reply to Checkpoint 4, change 5).
   */
  irEligible?: InjuryStatus[];
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
  /**
   * The first tiebreaker after win percentage when seeding the standings (§8; planner, Checkpoint 2:
   * use the league's own when the platform reports it). Absent = unknown: the platform doesn't report
   * it (ESPN, when playoffSeedingRule is missing or its UNKNOWN placeholder; Sleeper always gets points
   * for, its documented default) or reports one we don't model, and "seedingTiebreaker" is in
   * unknownSettings; the simulator then breaks ties by points for.
   */
  seedingTiebreaker?: SeedingTiebreaker;
  tradeDeadline: { week?: number; date?: string } | null;
  tradeReview: "none" | "commissioner" | "league_vote";
  faabBudget?: number;
  /** Settings the platform doesn't expose or we couldn't read: the Import Report shows them as unknown (§14). */
  unknownSettings?: UnknownSetting[];
}

export type UnknownSetting = "tradeDeadline" | "tradeReview" | "playoffs" | "playoffSeeding" | "seedingTiebreaker";

/**
 * How ties in win percentage are broken when seeding (§8): total points for, head-to-head record
 * between the tied teams, or record within the division.
 */
export type SeedingTiebreaker = "pointsFor" | "headToHead" | "divisionRecord";

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
  /**
   * The team's place in the waiver order (1 = first claim), when the platform reports it (ESPN teams[].waiverRank,
   * Sleeper rosters[].settings.waiver_position). Phase 4b: free agents go to one team each, in this order (§7).
   */
  waiverRank?: number;
  /** FAAB leagues: the team's remaining budget (the budget minus what it has spent), when the platform reports it. */
  faabRemaining?: number;
}

/** NA = not an active NFL player right now (Sleeper's NA; retired or unsigned): availability config.projections.injury.notActive. */
export type InjuryStatus = "ACTIVE" | "PROBABLE" | "QUESTIONABLE" | "DOUBTFUL" | "OUT" | "IR" | "PUP" | "SUSPENDED" | "NA";

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
  /** The NFL week the matchup starts in (its first week when it spans several). */
  week: number;
  teamA: string;
  /** null = a bye. */
  teamB: string | null;
  isPlayoff: boolean;
  /** NFL weeks the matchup spans when more than one (ESPN multi-week matchup periods), ascending; absent = [week]. */
  weeks?: number[];
  /**
   * True once the platform reports the matchup decided (ESPN: any winner but UNDECIDED; Sleeper: a week
   * it has scored, byes included). A decided game is already in the teams' records (Team.record,
   * pointsFor, pointsAgainst), so the season simulation must not play it again: the games still to
   * play are the ones without `decided`, never "the ones without a result". Absent = not decided yet
   * (still to play, or under way).
   */
  decided?: boolean;
  /**
   * The platform's final result, set only on a decided matchup whose score we could read. winnerId null
   * = a tie (or a bye: teamB null). A decided matchup without one (the adapter warns) still counts as
   * played; only its outcome is unknown, so head-to-head records leave it out.
   */
  result?: MatchupResult;
}

/**
 * A decided matchup's final score as the platform reports it: pointsA for teamA, pointsB for teamB
 * (null for a bye), summed over all its weeks. winnerId is the platform's own verdict, so a tie its
 * rules break (ESPN's matchup tie rule) still has a winner.
 */
export interface MatchupResult {
  pointsA: number;
  pointsB: number | null;
  winnerId: string | null;
}

export interface Transaction {
  id: string;
  type: "trade" | "add" | "drop" | "waiver";
  week: number;
  timestamp: string;
  teams: string[];
  /** pos: the player's position when the platform tells us (Phase 4: streaming detection counts adds by position). */
  moves: { playerId: string; from: string | null; to: string | null; pos?: Pos }[];
  picks?: DraftPick[];
  /** ESPN: a completed trade whose players came back hidden, rebuilt from the receiving rosters' acquisitions (Phase 4). */
  refilled?: true;
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
