/**
 * NFL schedule and bye weeks (CLAUDE.md §2.9 "NFL schedule and bye weeks", §2.10: refreshed at most
 * every 7 days; §6 step 3: byes come only from the NFL schedule). Server-side.
 *
 * Source: ESPN's public GET /seasons/{season}?view=proTeamSchedules_wl (no cookies; Phase 0 NFL.espnByes:
 * 32 teams, 272 games, byeWeek on 32/32 teams, matching the gap in each team's own games). The URL and
 * the cache entry are the ESPN adapter's (key espn:proTeamSchedules:{season}, TTL.nflSchedule), so an
 * ESPN import and this loader share one copy, and Sleeper leagues get byes too.
 *
 * - getPublicSource: a body is checked (shape; at least 32 teams with games) before it is cached, and a
 *   fresh saved copy that fails the check (the adapter caches any JSON body) is fetched again, once.
 * - TTL (7 days) equals the public retention (7 days, §2.10), so there is no window in which a stale
 *   copy could stand in: when ESPN fails, the load throws a LeagueImportError and the caller degrades
 *   to a warning.
 * - Team codes follow PlayerInfo.nflTeam's convention (Sleeper's: WAS, LAR, JAX, LV): ESPN
 *   abbreviations go through the crosswalk, resolver.defenseId(abbrev) ?? abbrev, as the ESPN adapter
 *   does for nflTeam. So WSH becomes WAS and LAR stays LAR.
 * - A game ESPN marks startTimeTBD (24 games in weeks 16–18 on 2026-09-30, before the NFL sets their
 *   times) carries a placeholder date (08:01 UTC on the Sunday), so it gets no kickoff entry: its time
 *   is unknown, but the game still counts.
 * - lastWeek, the NFL regular season's last week, is the largest week any team has a game in, TBD games
 *   included (18 in 2026, whose week-18 games are all TBD). The view lists regular-season games only
 *   (Phase 0: weeks 1–18, 272 games). The engine reads it for ESPN's out-for-season marker (last week + 1).
 * - ESPN's pseudo-team "FA" (id 0, no games) is skipped.
 */
import { z } from "zod";
import { ESPN_READS_BASE } from "@/adapters/espn/fetch";
import { LeagueImportError, type HttpClient, type HttpResponse } from "@/adapters/types";
import type { NflScheduleInputs } from "@/engine/inputs";
import { TTL } from "@/server/cache";
import { checkedJson, getPublicSource, sourceError, tooFewRows, type PublicSourceResult } from "./source";
import type { PlayerIdResolver } from "./types";

/** Row floor (review HTTP-1): every NFL team has games once the schedule is out; fewer is a partial or unpublished schedule. */
export const NFL_SCHEDULE_MIN_TEAMS = 32;

/** The body is about 110 KB; one retry. */
export const NFL_SCHEDULE_TIMEOUT_MS = 30_000;

const WHAT = "NFL schedule (ESPN)";

export function nflScheduleUrl(season: number): string {
  return `${ESPN_READS_BASE}/seasons/${season}?view=proTeamSchedules_wl`;
}

/** The ESPN adapter's cache key for the same body (src/adapters/espn/fetch.ts step 5; nflSchedule.test.ts checks they match). */
export function nflScheduleCacheKey(season: number): string {
  return `espn:proTeamSchedules:${season}`;
}

const gameSchema = z.object({
  id: z.union([z.number(), z.string()]).nullish().catch(null),
  /** Kickoff, epoch ms UTC (a placeholder when startTimeTBD). */
  date: z.number(),
  homeProTeamId: z.number(),
  awayProTeamId: z.number(),
  startTimeTBD: z.boolean().nullish().catch(null),
});

const teamSchema = z.object({
  id: z.number(),
  abbrev: z.string().nullish(),
  byeWeek: z.number().nullish(),
  /** NFL week ("1"…"18") → that week's games; a team's bye week has no key. */
  proGamesByScoringPeriod: z.record(z.string(), z.array(gameSchema)).nullish(),
});

/** Our own schema for proTeamSchedules_wl (the adapter's drops startTimeTBD). Unknown fields are ignored. */
export const nflScheduleSchema = z.object({ settings: z.object({ proTeams: z.array(teamSchema) }) });
export type NflScheduleResponse = z.infer<typeof nflScheduleSchema>;
type ProTeam = z.infer<typeof teamSchema>;
type ProGame = z.infer<typeof gameSchema>;

/** ESPN's "FA" pseudo-team. */
const FREE_AGENT_TEAM_ID = 0;

/** The largest epoch ms a Date can hold: a kickoff beyond it is garbage, and toISOString() would throw on it. */
const MAX_DATE_MS = 8.64e15;

/** The weeks a team has games in (keys that aren't a week number ≥ 1 are ignored). */
function weeksWithGames(team: ProTeam): Map<number, ProGame[]> {
  const out = new Map<number, ProGame[]>();
  for (const [key, games] of Object.entries(team.proGamesByScoringPeriod ?? {})) {
    const week = Number(key);
    if (Number.isInteger(week) && week >= 1 && games.length) out.set(week, games);
  }
  return out;
}

/** Real NFL teams (not "FA") with at least one game. */
export function teamsWithGames(response: NflScheduleResponse): number {
  return response.settings.proTeams.filter((t) => t.id !== FREE_AGENT_TEAM_ID && weeksWithGames(t).size > 0).length;
}

export interface NflScheduleData {
  /** Team code → bye week. A team without one (unknown) is missing. */
  byeWeek: Record<string, number>;
  /** NFL week → team code → kickoff (epoch ms). A TBD game has no entry; a week with no known kickoff is missing. */
  kickoffs: Record<number, Record<string, number>>;
  /** The NFL regular season's last week: the largest week with a game, TBD games included. Missing when no team has a game. */
  lastWeek?: number;
}

/**
 * Byes, kickoffs and the last week, keyed by team code (pure). `teamCode` translates an ESPN
 * abbreviation (WSH, LAR…) to PlayerInfo.nflTeam's convention. A team's bye is ESPN's byeWeek; when ESPN
 * leaves it out (or 0), it is the one week up to the schedule's last week in which the team has no game,
 * if there is exactly one. A team with two games in a week (never in the regular season) keeps the
 * earlier kickoff.
 */
export function reduceNflSchedule(response: NflScheduleResponse, teamCode: (espnAbbrev: string) => string): NflScheduleData {
  const teams = response.settings.proTeams.filter((t) => t.id !== FREE_AGENT_TEAM_ID);
  const played = new Map(teams.map((t) => [t, weeksWithGames(t)] as const));
  let lastWeek = 0;
  for (const weeks of played.values()) for (const w of weeks.keys()) lastWeek = Math.max(lastWeek, w);

  const byeWeek: Record<string, number> = {};
  const kickoffs: Record<number, Record<string, number>> = {};
  for (const team of teams) {
    const abbrev = team.abbrev?.trim();
    if (!abbrev) continue;
    const code = teamCode(abbrev);
    const weeks = played.get(team) ?? new Map<number, ProGame[]>();
    for (const [week, games] of weeks) {
      for (const game of games) {
        if (game.startTimeTBD || !(Math.abs(game.date) <= MAX_DATE_MS)) continue; // placeholder date: kickoff unknown
        const slot = (kickoffs[week] ??= {});
        const known = slot[code];
        if (known === undefined || game.date < known) slot[code] = game.date;
      }
    }
    const bye = team.byeWeek;
    if (typeof bye === "number" && Number.isInteger(bye) && bye >= 1) byeWeek[code] = bye;
    else if (weeks.size) {
      const gaps: number[] = [];
      for (let w = 1; w <= lastWeek; w++) if (!weeks.has(w)) gaps.push(w);
      if (gaps.length === 1) byeWeek[code] = gaps[0] as number;
    }
  }
  return { byeWeek, kickoffs, ...(lastWeek >= 1 ? { lastWeek } : {}) };
}

function checkNflSchedule(res: HttpResponse): NflScheduleResponse {
  const parsed = nflScheduleSchema.safeParse(checkedJson(res, WHAT, "espn"));
  if (!parsed.success) throw sourceError(WHAT, parsed.error, "espn");
  const teams = teamsWithGames(parsed.data);
  if (teams < NFL_SCHEDULE_MIN_TEAMS) throw tooFewRows(WHAT, teams, `at least ${NFL_SCHEDULE_MIN_TEAMS} teams with games`, "espn");
  return parsed.data;
}

export interface NflSchedule extends NflScheduleData {
  season: number;
  /** When ESPN served this copy (epoch ms; a cached copy keeps its original time), when the client reports it. */
  fetchedAt?: number;
  fromCache: boolean;
  /** A saved copy stood in for a failed refresh (it can't today: TTL = retention; see the header). */
  stale: boolean;
}

/**
 * The season's NFL schedule, keyed by team code. Throws LeagueImportError (SOURCE_DOWN when ESPN
 * fails, BAD_RESPONSE for a changed shape or an unpublished schedule); callers degrade to a warning.
 */
export async function loadNflSchedule(http: HttpClient, season: number, resolver: Pick<PlayerIdResolver, "defenseId">): Promise<NflSchedule> {
  let got: PublicSourceResult<NflScheduleResponse>;
  try {
    got = await getPublicSource(http, nflScheduleUrl(season), { key: nflScheduleCacheKey(season), ttlMs: TTL.nflSchedule, timeoutMs: NFL_SCHEDULE_TIMEOUT_MS, maxRetries: 1 }, checkNflSchedule);
  } catch (err) {
    // The real client never throws; any other client's error text could hold a URL, so it isn't echoed.
    if (err instanceof LeagueImportError) throw err;
    throw new LeagueImportError("SOURCE_DOWN", `${WHAT}: couldn't be reached`, { platform: "espn" });
  }
  if ("error" in got) throw got.error;
  const { res } = got;
  const data = reduceNflSchedule(got.value, (abbrev) => resolver.defenseId(abbrev) ?? abbrev);
  return { season, ...data, fromCache: res.fromCache, stale: res.stale === true, ...(res.fetchedAt !== undefined ? { fetchedAt: res.fetchedAt } : {}) };
}

/** What the engine gets (ModelInputs.nfl): every bye, ISO kickoffs for weeks ≥ fromWeek, and the last week when known. */
export function toNflScheduleInputs(schedule: NflScheduleData, fromWeek: number): NflScheduleInputs {
  const kickoffs: NflScheduleInputs["kickoffs"] = {};
  for (const [key, teams] of Object.entries(schedule.kickoffs)) {
    const week = Number(key);
    if (!(week >= fromWeek)) continue;
    const out: Record<string, string> = {};
    for (const [team, ms] of Object.entries(teams)) out[team] = new Date(ms).toISOString();
    kickoffs[week] = out;
  }
  const last = schedule.lastWeek;
  return { byeWeek: { ...schedule.byeWeek }, kickoffs, ...(typeof last === "number" && Number.isInteger(last) && last >= 1 ? { lastWeek: last } : {}) };
}
