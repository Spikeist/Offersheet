/**
 * Model inputs (CLAUDE.md §4 "outside the snapshot", §6, §9): everything the projection model and
 * the market layer need beyond the LeagueSnapshot. The server builds them (src/server/modelInputs.ts:
 * fetching, league scoring through the pure scoring engine); the engine consumes them
 * (src/engine/league.ts, in the browser's Web Worker). Pure types only.
 *
 * Every number here is already in THIS league's scoring, so the browser never needs the raw stat
 * lines or the 15 MB player database.
 */
import type { ImportWarning } from "./model";

export interface ModelInputs {
  version: 1;
  season: number;
  /** The snapshot's NFL week when the inputs were built. */
  currentWeek: number;
  /** Weeks covered run 1..lastWeek: the last fantasy playoff week (the last regular-season week without playoffs). */
  lastWeek: number;
  /** ISO time the inputs were assembled. */
  builtAt: string;
  nfl: NflScheduleInputs;
  /** Canonical player id → inputs, for every rostered player (IR and taxi included) and every snapshot free agent. */
  players: Record<string, PlayerInputs>;
  /** ESPN leagues: whether ESPN's league-scored projections loaded (§6 averages them with Sleeper's when the two agree). */
  espnProjections: boolean;
  /** FantasyCalc values in the league's format, or null when FantasyCalc couldn't be reached. */
  market: MarketInputs | null;
  /** When each source was fetched (shown on the League page). */
  sources: InputSourceStamp[];
  /** Anything that degraded the inputs (a source down, a week missing), for the League page. */
  warnings: ImportWarning[];
  notes: string[];
}

export interface NflScheduleInputs {
  /** NFL team code (PlayerInfo.nflTeam's convention) → that team's bye week. A missing team = unknown. */
  byeWeek: Record<string, number>;
  /**
   * NFL week → team code → kickoff time (ISO) of that team's game, for weeks ≥ currentWeek. A team
   * missing from a week it isn't on bye in = kickoff unknown (its game still counts).
   */
  kickoffs: Record<number, Record<string, string>>;
  /**
   * The NFL regular season's last week: the largest week of ESPN's schedule, weeks whose games are all
   * time-TBD included (18 in 2026). A known return week after it means "not back this season" (§4:
   * ESPN's out-for-season marker is this + 1). Missing = unknown (no schedule).
   */
  lastWeek?: number;
  /**
   * NFL week → team code → that week's opponent (team code) and whether the team is at home, for weeks ≥
   * currentWeek (Phase 4: the League page's "Streaming picks this week" shows each pick's opponent). A team
   * missing from a week = on bye or unknown. Missing entirely = an older input (no opponents shown).
   */
  opponents?: Record<number, Record<string, { team: string; home: boolean }>>;
}

export interface PlayerInputs {
  /**
   * Sleeper's stat projection × this league's scoring (expected points, §5), by NFL week (1..lastWeek).
   * null = Sleeper sent only a stub for him that week (no scorable stats: bye, injured or teamless),
   * or a line worth exactly 0; §6 treats both as "not projected healthy". A missing week = not fetched.
   */
  sleeper: Record<number, number | null>;
  /** Sleeper's season projection × league scoring, per projected game (§6 fallback base rate). */
  sleeperSeasonPerGame?: number;
  /** ESPN leagues: ESPN's league-scored projection (appliedTotal, statSourceId 1, statSplitTypeId 1), by week; null = not projected. */
  espn?: Record<number, number | null>;
  /** League points in each completed week (before currentWeek) he played (gp > 0). Weeks he didn't play are absent. */
  actual: Record<number, number>;
}

/** FantasyCalc /values/current format (CLAUDE.md §2.9). */
export interface FantasyCalcFormat {
  isDynasty: boolean;
  numQbs: 1 | 2;
  /** The numTeams we request (FantasyCalc supports 8, 10, 12 and 14; others silently return 12-team values). */
  numTeams: number;
  ppr: 0 | 0.5 | 1;
  /** TE premium parameter, left out when the league has none. */
  tep?: "te+" | "te++";
  /** Where the request differs from the league, in words for the Import Report ("16 teams → 14-team values"). */
  substitutions: string[];
}

export interface MarketInputs {
  format: FantasyCalcFormat;
  /** ISO time FantasyCalc served the values. */
  fetchedAt: string;
  /** Canonical id → FantasyCalc value in this format (§9 v_i). Only players FantasyCalc values. */
  values: Record<string, number>;
  /** Keeper leagues: redraft values for perception (§9); `values` then holds dynasty values. */
  redraftValues?: Record<string, number>;
  /** Canonical ids of relevant players FantasyCalc knows (has a FantasyCalc player id), valued or not. */
  knownIds: string[];
  /** The top value in FantasyCalc's list for this format (valueFloor and waiverCreditMin are fractions of it). */
  topValue: number;
}

export interface InputSourceStamp {
  source: string;
  /** ISO time the data was fetched from its source (a cached copy keeps its original time). */
  fetchedAt: string;
  /** A live fetch failed and a saved older copy was used. */
  stale?: boolean;
}
