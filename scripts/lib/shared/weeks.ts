/**
 * Which NFL weeks the shared probe looks at (CLAUDE.md §2.3 /state/nfl). Pure: the caller passes the
 * Sleeper state, the NFL schedule and today's date, so re-running the probe next week checks next
 * week's data instead of silently re-reading week 4.
 */
import type { NflGame } from "./nfl";

/** The parts of https://api.sleeper.app/v1/state/nfl the probe uses. */
export interface NflState {
  season: number;
  /** The NFL week whose games are next ("week" in /state/nfl). */
  week: number;
  /** "pre" | "regular" | "post" | "off" */
  seasonType: string;
  displayWeek?: number;
}

export interface WeekPlan {
  season: number;
  seasonType: string;
  /** The week treated as current: projections for it are "this week's" (§6 proj_now). */
  currentWeek: number;
  lastRegularWeek: number;
  /** Regular-season weeks already played: 1..currentWeek−1. */
  completedWeeks: number[];
  /** The most recent completed weeks whose actual stats the probe fetches (§5 oracle uses the last 2). */
  statsWeeks: number[];
  /** Sampled weeks after the current one, always ending with the last two regular-season weeks. */
  futureWeeks: number[];
  /** Where season/week came from, for evidence. */
  source: string;
}

/** Parse /state/nfl; null when the body doesn't carry a usable season and week. */
export function parseNflState(json: unknown): NflState | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const season = Number(o.season);
  const week = Number(o.week);
  if (!Number.isInteger(season) || season < 2000 || !Number.isInteger(week) || week < 0) return null;
  const displayWeek = Number(o.display_week);
  return { season, week, seasonType: typeof o.season_type === "string" ? o.season_type : "unknown", displayWeek: Number.isInteger(displayWeek) ? displayWeek : undefined };
}

/** NFL season a date belongs to when no API says so: the season that started the previous September. */
export function seasonFromDate(isoDate: string): number {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  return month >= 3 ? year : year - 1;
}

/**
 * The current week according to the schedule: the first regular-season week with a game on or after
 * `today` (YYYY-MM-DD, compared with nflverse's local gameday). Null when every game is in the past.
 */
export function scheduleWeek(games: NflGame[], today: string): number | null {
  let best: number | null = null;
  for (const g of games) if (g.gameday && g.gameday >= today && (best === null || g.week < best)) best = g.week;
  return best;
}

/** Weeks after `current` to sample: next week, +6, +11 and the last two regular-season weeks. */
export function sampleFutureWeeks(current: number, lastRegularWeek: number): number[] {
  const picks = [current + 1, current + 6, current + 11, lastRegularWeek - 1, lastRegularWeek];
  return [...new Set(picks)].filter((w) => w > current && w <= lastRegularWeek).sort((a, b) => a - b);
}

export function planWeeks(state: NflState, lastRegularWeek: number, source: string, maxStatsWeeks = 3): WeekPlan {
  let current: number;
  if (state.seasonType === "regular") current = Math.min(Math.max(state.week, 1), lastRegularWeek);
  else if (state.seasonType === "pre") current = 1;
  else current = lastRegularWeek; // post / off season: nothing left to project; the last week stands in
  const completed = state.seasonType === "pre" ? [] : Array.from({ length: current - 1 }, (_, i) => i + 1);
  return {
    season: state.season,
    seasonType: state.seasonType,
    currentWeek: current,
    lastRegularWeek,
    completedWeeks: completed,
    statsWeeks: completed.slice(-maxStatsWeeks),
    futureWeeks: sampleFutureWeeks(current, lastRegularWeek),
    source,
  };
}
