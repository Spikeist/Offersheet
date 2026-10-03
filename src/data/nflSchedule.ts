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
 * - Opponents (Phase 4: the League page's "Streaming picks this week" shows each pick's opponent): each
 *   team's game of the week, from its own listing (homeProTeamId / awayProTeamId), with the other team's
 *   code and whether it is the home team (ESPN's home team: a neutral-site game still names one). A TBD
 *   game's opponent is known, so it has one; a bye week has none. A game whose other team isn't one of
 *   ESPN's teams with an abbreviation is left out; two games in one week (never in the regular season)
 *   keep the earlier one, like kickoffs.
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

/** A game's date for ordering; a garbage date sorts last. */
const gameTime = (g: ProGame): number => (Math.abs(g.date) <= MAX_DATE_MS ? g.date : Number.POSITIVE_INFINITY);

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

/** A team's game in one NFL week: the other team's code, and whether this team is ESPN's home team. */
export interface NflOpponent {
  team: string;
  home: boolean;
}

export interface NflScheduleData {
  /** Team code → bye week. A team without one (unknown) is missing. */
  byeWeek: Record<string, number>;
  /** NFL week → team code → kickoff (epoch ms). A TBD game has no entry; a week with no known kickoff is missing. */
  kickoffs: Record<number, Record<string, number>>;
  /** The NFL regular season's last week: the largest week with a game, TBD games included. Missing when no team has a game. */
  lastWeek?: number;
  /**
   * NFL week → team code → its opponent that week (TBD games included). A team on bye (or whose game
   * can't be read) is missing from the week. Always set by reduceNflSchedule; optional for older copies.
   */
  opponents?: Record<number, Record<string, NflOpponent>>;
}

/**
 * Byes, kickoffs, opponents and the last week, keyed by team code (pure). `teamCode` translates an ESPN
 * abbreviation (WSH, LAR…) to PlayerInfo.nflTeam's convention. A team's bye is ESPN's byeWeek; when ESPN
 * leaves it out (or 0), it is the one week up to the schedule's last week in which the team has no game,
 * if there is exactly one. A team with two games in a week (never in the regular season) keeps the
 * earlier kickoff and the earlier game's opponent.
 */
export function reduceNflSchedule(response: NflScheduleResponse, teamCode: (espnAbbrev: string) => string): NflScheduleData {
  const teams = response.settings.proTeams.filter((t) => t.id !== FREE_AGENT_TEAM_ID);
  const played = new Map(teams.map((t) => [t, weeksWithGames(t)] as const));
  let lastWeek = 0;
  for (const weeks of played.values()) for (const w of weeks.keys()) lastWeek = Math.max(lastWeek, w);
  // ESPN team id → team code, for the other side of each game.
  const codeById = new Map<number, string>();
  for (const t of teams) {
    const abbrev = t.abbrev?.trim();
    if (abbrev) codeById.set(t.id, teamCode(abbrev));
  }

  const byeWeek: Record<string, number> = {};
  const kickoffs: Record<number, Record<string, number>> = {};
  const opponents: Record<number, Record<string, NflOpponent>> = {};
  for (const team of teams) {
    const abbrev = team.abbrev?.trim();
    if (!abbrev) continue;
    const code = teamCode(abbrev);
    const weeks = played.get(team) ?? new Map<number, ProGame[]>();
    for (const [week, games] of weeks) {
      // The week's game: the earliest by date (a garbage date sorts last), the first listed on a tie.
      const game = [...games].sort((a, b) => {
        const [x, y] = [gameTime(a), gameTime(b)];
        return x === y ? 0 : x < y ? -1 : 1;
      })[0];
      const home = game?.homeProTeamId === team.id;
      const other = game ? codeById.get(home ? game.awayProTeamId : game.homeProTeamId) : undefined;
      if (game && (home || game.awayProTeamId === team.id) && other !== undefined) (opponents[week] ??= {})[code] = { team: other, home };
      for (const g of games) {
        if (g.startTimeTBD || !(Math.abs(g.date) <= MAX_DATE_MS)) continue; // placeholder date: kickoff unknown
        const slot = (kickoffs[week] ??= {});
        const known = slot[code];
        if (known === undefined || g.date < known) slot[code] = g.date;
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
  return { byeWeek, kickoffs, ...(lastWeek >= 1 ? { lastWeek } : {}), opponents };
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

/**
 * What the engine gets (ModelInputs.nfl): every bye, ISO kickoffs and opponents for weeks ≥ fromWeek, and
 * the last week when known. Opponents come whenever the schedule has them (reduceNflSchedule always sets
 * them), an empty object when no week is left; a schedule without them (an older copy) passes none, so
 * the engine reads "unknown" (NflScheduleInputs.opponents).
 */
export function toNflScheduleInputs(schedule: NflScheduleData, fromWeek: number): NflScheduleInputs {
  const kickoffs: NflScheduleInputs["kickoffs"] = {};
  for (const [key, teams] of Object.entries(schedule.kickoffs)) {
    const week = Number(key);
    if (!(week >= fromWeek)) continue;
    const out: Record<string, string> = {};
    for (const [team, ms] of Object.entries(teams)) out[team] = new Date(ms).toISOString();
    kickoffs[week] = out;
  }
  let opponents: NflScheduleInputs["opponents"];
  if (schedule.opponents) {
    opponents = {};
    for (const [key, teams] of Object.entries(schedule.opponents)) {
      const week = Number(key);
      if (!(week >= fromWeek)) continue;
      const out: Record<string, NflOpponent> = {};
      for (const [team, o] of Object.entries(teams)) out[team] = { team: o.team, home: o.home };
      opponents[week] = out;
    }
  }
  const last = schedule.lastWeek;
  return { byeWeek: { ...schedule.byeWeek }, kickoffs, ...(typeof last === "number" && Number.isInteger(last) && last >= 1 ? { lastWeek: last } : {}), ...(opponents ? { opponents } : {}) };
}
