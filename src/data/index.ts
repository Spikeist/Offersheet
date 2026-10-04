/**
 * Shared data layer (CLAUDE.md §2.9, §3 src/data): the player ID crosswalk that gives every player
 * a canonical id (the Sleeper id when known, else `${platform}:${id}`) from the start.
 *
 *   loadPlayerIdResolver({ http, now })   server-side loader (Sleeper players DB, DynastyProcess, FantasyCalc)
 *   resolverFromData({ … })               pure builder used by the loader, tests and scripts
 */
export { DEGRADED_MEMO_MS, loadPlayerIdResolver, rebuildDelayMs, RESOLVER_MEMO_MS, resolverBuildInFlight } from "./load";
export {
  CROSSWALK_SOURCES,
  ID_SOURCE_PRIORITY,
  playerNameKey,
  resolverFromData,
  type CrosswalkConflict,
  type CrosswalkData,
  type CrosswalkSourceKey,
  type CrosswalkSourceStatus,
  type PlayerIdCrosswalk,
} from "./crosswalk";
export { DYNASTYPROCESS_COLUMNS, DYNASTYPROCESS_IDS_URL, DYNASTYPROCESS_MIN_ROWS, fetchDynastyProcessIds, parseDynastyProcessCsv, type DynastyProcessLoad, type DynastyRow } from "./dynastyProcess";
export { FANTASYCALC_MIN_ROWS, FANTASYCALC_PLAYERS_URL, fetchFantasyCalcPlayers, reduceFantasyCalcPlayers, type FantasyCalcPlayerIds, type FantasyCalcPlayersLoad } from "./fantasyCalcPlayers";
export {
  FANTASYCALC_DYNASTY_MIN_PLAYERS,
  FANTASYCALC_OUTAGE_HOLD_MS,
  FANTASYCALC_OUTAGE_MAX_HOLD_MS,
  FANTASYCALC_REDRAFT_MIN_PLAYERS,
  FANTASYCALC_VALUES_URL,
  fantasyCalcGate,
  fantasyCalcKnownIds,
  fantasyCalcMatcher,
  fantasyCalcOutageHoldMs,
  fantasyCalcOutcome,
  fantasyCalcValuesFor,
  fantasyCalcValuesUrl,
  loadFantasyCalcValues,
  marketInputsFrom,
  reduceFantasyCalcValues,
  type FantasyCalcGate,
  type FantasyCalcIdentity,
  type FantasyCalcOutcome,
  type FantasyCalcPickValue,
  type FantasyCalcRequest,
  type FantasyCalcValueRow,
  type FantasyCalcValuesLoad,
  type JoinPlayer,
  type MarketFormats,
} from "./fantasyCalcValues";
export { isRejectedId, normalizeId, type IdKind } from "./ids";
export { loadNflSchedule, NFL_SCHEDULE_MIN_TEAMS, nflScheduleCacheKey, nflScheduleUrl, reduceNflSchedule, toNflScheduleInputs, type NflSchedule, type NflScheduleData } from "./nflSchedule";
export {
  fetchSleeperPlayers,
  reduceSleeperPlayers,
  SLEEPER_DEF_ROWS,
  SLEEPER_LIST_MIN_ROWS,
  SLEEPER_PLAYER_POSITIONS,
  sleeperPlayersSchema,
  sleeperPlayersUrl,
  toLite,
  type SleeperPlayerRecord,
  type SleeperPlayersLoad,
} from "./sleeperPlayers";
export {
  loadSleeperSeasonProjections,
  loadSleeperStats,
  loadSleeperWeeklyProjections,
  playedStatLines,
  projectionLines,
  seasonPerGameLine,
  SLEEPER_DOWN,
  SLEEPER_MODEL_MAX_RETRIES,
  SLEEPER_MODEL_TIMEOUT_MS,
  SLEEPER_OUTAGE_HOLD_MS,
  SLEEPER_OUTAGE_MAX_HOLD_MS,
  sleeperGate,
  sleeperOutageHoldMs,
  sleeperRequestPositions,
  sleeperSeasonProjectionsUrl,
  sleeperStatsUrl,
  type SleeperGate,
  type SleeperLoadMeta,
  type SleeperProjectionLine,
  type SleeperRows,
  type SleeperSeasonProjectionsLoad,
  type SleeperStatsLoad,
  type SleeperWeeklyProjectionsLoad,
} from "./sleeperProjections";
export { buildTeamCodeIndex, cleanTeamCode, deriveTeamAliases, SLEEPER_TEAM_CODES, STATIC_TEAM_ALIASES, TEAM_ALIAS_MIN_SUPPORT, type DerivedTeamAlias, type TeamCodeIndex } from "./teamCodes";
export type { IdSource, PlayerIdResolver, SleeperPlayerLite } from "./types";
