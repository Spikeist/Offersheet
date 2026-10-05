/**
 * Labels of the committed fixtures in fixtures/sanitized/shared/ (filename = sha256(label) + ext).
 * One place for them, so the end-of-run prune knows exactly which fixtures the current week plan
 * and format list produce, and removes the ones that no longer belong (a dropped format, a week the
 * probe has moved past).
 */
import type { WeekPlan } from "./weeks";

const TOP_SLEEPER = "(top 150 QB/RB/WR/TE + 6 per K/DEF/IDP)";

export const fixtureLabels = {
  fcValues: (query: string) => `fantasycalc/values?${query}`,
  /**
   * The Phase 0 sample of /players (first 100 rows): no longer fetched (FantasyCalc's conditions of 2026-10-05 allow only
   * /values/current; section-fc.ts), but expected, so the end-of-run prune keeps it: src/data's tests read it.
   */
  fcPlayers: "fantasycalc/players (first 100)",
  dpSubset: "dynastyprocess/db_playerids (rows for active Sleeper QB/RB/WR/TE/K)",
  nflGames: (season: number) => `nflverse/games ${season} REG`,
  espnProTeams: (season: number) => `espn/seasons/${season}?view=proTeamSchedules_wl`,
  nflByes: (season: number) => `nfl/byes ${season} (derived)`,
  sleeperProjWeek: (season: number, week: number) => `sleeper/projections/${season}/${week} ${TOP_SLEEPER}`,
  sleeperProjSeason: (season: number) => `sleeper/projections/${season}?position=QB (season, top 40)`,
  sleeperStatsWeek: (season: number, week: number) => `sleeper/stats/${season}/${week} ${TOP_SLEEPER}`,
  espnPool: (week: number) => `espn/leaguedefaults/3?scoringPeriodId=${week}&view=kona_player_info (top 100, trimmed stats)`,
};

/** Every fixture label a full run with this plan and these FantasyCalc queries writes. */
export function expectedLabels(plan: WeekPlan, fcQueries: string[]): Set<string> {
  const L = fixtureLabels;
  return new Set([
    ...fcQueries.map(L.fcValues),
    L.fcPlayers,
    L.dpSubset,
    L.nflGames(plan.season),
    L.espnProTeams(plan.season),
    L.nflByes(plan.season),
    ...[plan.currentWeek, ...plan.futureWeeks].map((w) => L.sleeperProjWeek(plan.season, w)),
    L.sleeperProjSeason(plan.season),
    ...plan.statsWeeks.map((w) => L.sleeperStatsWeek(plan.season, w)),
    L.espnPool(plan.currentWeek),
  ]);
}
