/**
 * Sleeper fetch half (CLAUDE.md §2.3, §2.10): talks to api.sleeper.app through the injected polite,
 * cached HttpClient and hands the raw responses to normalizeSleeperLeague().
 *
 * - Username path: /user/{username} → user_id → /user/{id}/leagues/nfl/{season}. No such user →
 *   USER_NOT_FOUND; no league → NO_LEAGUE; several → SleeperLeagueChoiceError (code NO_LEAGUE) with
 *   the choices, unless chooseLeagueId picks one. With a league ID the username is optional (it only
 *   finds the user's team): a user Sleeper doesn't know becomes a warning, and the user picks a team.
 * - League data is public (anyone with the ID can read it), so it is cached by URL: served for 10
 *   minutes (1 minute after Refresh) and kept 10 minutes either way; projections per NFL week
 *   (projectionsPolicy: served 6 hours for the current week and the next 2, 24 for later weeks, and
 *   kept 24 hours either way, §2.10), never an empty list. The 15 MB players DB is never fetched
 *   here: player facts come from deps.resolver, and injury status and NFL team from the projection
 *   rows (fresher).
 * - Projections: this NFL week and the next two (FREE_AGENT_RANK_WEEKS, capped at week 18), so a
 *   free agent on bye or out this week still ranks by the weeks he's projected to play. Each body is reduced at fetch
 *   time to what the import reads (importProjectionsPolicy; src/data/reduce.ts IMPORT_PROJECTIONS_REDUCER) and marked
 *   league-independent (cache.public) for the shared cache (planner reply to Checkpoint 4c, Part B, B1). League data,
 *   Sleeper's NFL state, user lookups and their keys are as before.
 * - Every body is parsed with bigIntsAsStrings: Sleeper sends a few 19-digit IDs as bare numbers.
 * - 404 / 400 / a literal `null` body → *_NOT_FOUND; 5xx, 429 and network failures (after the
 *   client's retries) → SOURCE_DOWN; a body that isn't JSON → BAD_RESPONSE. Optional endpoints
 *   (matchups, transactions, picks, drafts, projections) degrade to warnings instead.
 */
import { LeagueImportError, type HttpClient, type HttpResponse, type ImportDeps, type ImportErrorCode, type SleeperImportRequest } from "@/adapters/types";
import { POSITIONS, type ImportWarning, type Pos } from "@/engine/model";
import { parseSleeperLeagueInput } from "@/lib/sleeperInput";
import { config } from "@/engine/config";
import { IMPORT_PROJECTIONS_REDUCER, reducedKey, type BodyReducer } from "@/data/reduce";
import { PROJECTIONS_NEAR_WEEKS, TTL, leagueTtl } from "@/server/cache";
import { LAST_NFL_WEEK, SLOT_ELIGIBLE, assertSupported, type SleeperRawLeague } from "./normalize";
import { LeagueListItemSchema, LeagueSchema, StateSchema, UserSchema, num, parseArrayOrThrow, parseOrThrow } from "./schemas";

export const SLEEPER_API = "https://api.sleeper.app/v1";
export const SLEEPER_PROJECTIONS = "https://api.sleeper.app/projections/nfl";

/**
 * Weeks of projections that rank free agents: this week and the next ones (a bye or a one-week
 * absence then doesn't hide a player). An adapter constant for now; see the checkpoint notes.
 */
export const FREE_AGENT_RANK_WEEKS = config.import.freeAgentRankWeeks;

export const sleeperUrls = {
  state: () => `${SLEEPER_API}/state/nfl`,
  user: (username: string) => `${SLEEPER_API}/user/${encodeURIComponent(username)}`,
  userLeagues: (userId: string, season: number) => `${SLEEPER_API}/user/${encodeURIComponent(userId)}/leagues/nfl/${season}`,
  league: (id: string) => `${SLEEPER_API}/league/${id}`,
  users: (id: string) => `${SLEEPER_API}/league/${id}/users`,
  rosters: (id: string) => `${SLEEPER_API}/league/${id}/rosters`,
  matchups: (id: string, week: number) => `${SLEEPER_API}/league/${id}/matchups/${week}`,
  transactions: (id: string, leg: number) => `${SLEEPER_API}/league/${id}/transactions/${leg}`,
  tradedPicks: (id: string) => `${SLEEPER_API}/league/${id}/traded_picks`,
  drafts: (id: string) => `${SLEEPER_API}/league/${id}/drafts`,
  /** Undocumented; repeated position[] combines positions (verified in Phase 0). */
  projections: (season: number, week: number, positions: readonly string[]) =>
    `${SLEEPER_PROJECTIONS}/${season}/${week}?season_type=regular&${positions.map((p) => `position[]=${encodeURIComponent(p)}`).join("&")}`,
};

/** A league the user can pick when a username has several for the season. */
export interface SleeperLeagueChoice {
  leagueId: string;
  name: string;
  season: number;
  teams: number | null;
  status: string | null;
  /** From settings.type (0/1/2/3, verified in Phase 0); null when missing or unknown. */
  leagueType: "redraft" | "keeper" | "dynasty" | "guillotine" | null;
  bestBall: boolean;
  /** False for leagues the MVP rejects (guillotine). */
  supported: boolean;
}

const LEAGUE_TYPES: Readonly<Record<number, SleeperLeagueChoice["leagueType"]>> = { 0: "redraft", 1: "keeper", 2: "dynasty", 3: "guillotine" };

/** NO_LEAGUE with the user's leagues to choose from (pass one back as chooseLeagueId). */
export class SleeperLeagueChoiceError extends LeagueImportError {
  constructor(readonly choices: SleeperLeagueChoice[]) {
    super("NO_LEAGUE", `That Sleeper user has ${choices.length} leagues this season; pick one.`, { platform: "sleeper" });
    this.name = "SleeperLeagueChoiceError";
  }
}

/** The choices on an import error, when it offers any. */
export function leagueChoicesOf(err: unknown): SleeperLeagueChoice[] | undefined {
  return err instanceof SleeperLeagueChoiceError ? err.choices : undefined;
}

/**
 * A league ID as typed, or pulled out of a pasted sleeper.com link; undefined when it can't be one.
 * The same parser the Connect page uses (src/lib/sleeperInput.ts), so client and server agree.
 */
export function parseSleeperLeagueId(input: string): string | undefined {
  const r = parseSleeperLeagueInput(input);
  return r.ok ? r.leagueId : undefined;
}

const SOURCE = { platform: "sleeper" as const };

function fail(code: ImportErrorCode, message: string, status?: number, path?: string): never {
  throw new LeagueImportError(code, message, { ...SOURCE, ...(status !== undefined ? { status } : {}), ...(path ? { path } : {}) });
}

/** JSON body of a required response, or the matching LeagueImportError. */
export function requireJson(res: HttpResponse, what: string, notFound: ImportErrorCode, notFoundMessage: string): unknown {
  if (res.status === 404 || res.status === 400) fail(notFound, notFoundMessage, res.status, what);
  if (res.status === 0) fail("SOURCE_DOWN", "Sleeper couldn't be reached. Try again in a minute.", 0, what);
  if (!res.ok) fail("SOURCE_DOWN", `Sleeper answered with an error (HTTP ${res.status}). Try again in a minute.`, res.status, what);
  if (res.isHtml) fail("SOURCE_DOWN", "Sleeper sent a web page instead of data. Try again in a minute.", res.status, what);
  if (res.json === undefined) fail("BAD_RESPONSE", `Sleeper's ${what} response wasn't JSON.`, res.status, what);
  if (res.json === null) fail(notFound, notFoundMessage, res.status, what);
  return res.json;
}

/** How one response is cached (§2.10). */
export interface CachePolicy {
  /** A cached copy younger than this is served. */
  ttlMs: number;
  /** How long the stored copy is kept (Refresh lowers ttlMs, never this). */
  retainMs: number;
  /** League data: its fetch time counts toward the Import Report's "fetched at". */
  league: boolean;
  /** Only bodies this accepts are cached. */
  cacheIf?: (res: HttpResponse) => boolean;
  /**
   * League-independent data (HttpRequestOptions cache.public: the projection weeks), never league data or a user lookup:
   * with the shared cache one server instance fetches it for all (Part B, src/server/http.ts).
   */
  public?: boolean;
  /**
   * A fetch-time reducer (src/data/reduce.ts): the body keeps only what the import reads, filed under the URL's key plus
   * the reducer's suffix (reducedKey). The import's projection weeks: IMPORT_PROJECTIONS_REDUCER.
   */
  reducer?: BodyReducer;
}

/** League data: served 10 minutes (1 minute after Refresh), and kept 10 minutes either way. */
function leaguePolicy(refresh?: boolean): CachePolicy {
  return { ttlMs: leagueTtl(refresh), retainMs: TTL.league, league: true };
}

/**
 * Transactions and matchups of league weeks that ended over a week ago: final (stat corrections are
 * done), so they're kept 6 hours and Refresh doesn't shorten that. They don't count toward the
 * Import Report's "fetched at", which describes the live part of the league.
 */
export const CLOSED_WEEK_POLICY: CachePolicy = { ttlMs: TTL.closedTransactions, retainMs: TTL.closedTransactions, league: false };

/** User lookups: cached like league data, but not league data themselves. */
const userPolicy = (refresh?: boolean): CachePolicy => ({ ...leaguePolicy(refresh), league: false });

/**
 * Public projections and stats: served and kept 6 hours (§2.10); an empty list (not posted yet) isn't
 * cached. Season projections and stats always use this; weekly projections use projectionsPolicy.
 */
export const PROJECTIONS_POLICY: CachePolicy = {
  ttlMs: TTL.projections,
  retainMs: TTL.projections,
  league: false,
  cacheIf: (res) => Array.isArray(res.json) && res.json.length > 0,
};

/**
 * How long every copy of a week's projections is kept, whichever policy stored it: the longest TTL a
 * request for it uses. Whether a week is near or later depends on the current week of the build that
 * asks, and builds can disagree (an ESPN league's scoring period and Sleeper's NFL week around the
 * weekly rollover), so one URL is asked for under both policies, and a cache hit or a single-flight
 * join serves a copy another request stored. One retention per URL keeps "how long the cache holds
 * this copy" a fact about the copy, which the Sleeper gate relies on during an outage
 * (src/data/sleeperProjections.ts). Like Refresh for league data, a week's nearness shortens how old a
 * copy may be served, not how long it's kept (public data: within the privacy page's "up to a week").
 */
const WEEKLY_PROJECTIONS_RETAIN_MS = TTL.projectionsLater;

/** Weekly projections of past weeks, the current NFL week and the next PROJECTIONS_NEAR_WEEKS: served 6 hours, kept 24 (§2.10). */
export const NEAR_PROJECTIONS_POLICY: CachePolicy = { ...PROJECTIONS_POLICY, retainMs: WEEKLY_PROJECTIONS_RETAIN_MS };

/** Weekly projections of later NFL weeks: served and kept 24 hours, same rule for empty lists (§2.10, Checkpoint 2). */
export const LATER_PROJECTIONS_POLICY: CachePolicy = { ...PROJECTIONS_POLICY, ttlMs: TTL.projectionsLater, retainMs: WEEKLY_PROJECTIONS_RETAIN_MS };

/**
 * How one NFL week's weekly projections are cached (§2.10; each week is its own cache entry, one URL per
 * week): the current NFL week, the next PROJECTIONS_NEAR_WEEKS and past weeks refresh every 6 hours
 * (NEAR_PROJECTIONS_POLICY), later weeks every 24 hours (LATER_PROJECTIONS_POLICY). Every copy is kept
 * 24 hours either way (WEEKLY_PROJECTIONS_RETAIN_MS).
 */
export function projectionsPolicy(week: number, currentWeek: number): CachePolicy {
  return week <= currentWeek + PROJECTIONS_NEAR_WEEKS ? NEAR_PROJECTIONS_POLICY : LATER_PROJECTIONS_POLICY;
}

/**
 * How the import's projection weeks are fetched (planner reply to Checkpoint 4c, Part B, B1; src/data/reduce.ts): the
 * week's projectionsPolicy, league-independent (public), each body reduced to what the import reads
 * (IMPORT_PROJECTIONS_REDUCER: every row's player object and real rows' stats) under a cache entry of its own. ⚠️ The
 * model build's loader reads the same URLs reduced its own way (MODEL_PROJECTIONS_REDUCER), so the two no longer share a
 * copy: an import and a model build in the same 6 hours ask Sleeper for these weeks once each, and the injury tags and
 * teams the import reads here can come from a fetch up to about 6 hours apart from the model's projections of the same
 * weeks (review CA-10; src/data/sleeperProjections.ts header).
 */
export function importProjectionsPolicy(week: number, currentWeek: number): CachePolicy {
  return { ...projectionsPolicy(week, currentWeek), public: true, reducer: IMPORT_PROJECTIONS_REDUCER };
}

interface Getter {
  required(url: string, what: string, notFound: ImportErrorCode, notFoundMessage: string, policy?: CachePolicy): Promise<unknown>;
  /** undefined (plus a warning) when the response can't be used. */
  optional(url: string, what: string, code: string, policy?: CachePolicy): Promise<unknown>;
  /** When the oldest league-data response was fetched from Sleeper (epoch ms; cached copies keep their original time). */
  oldestFetch(): number | undefined;
}

function getter(http: HttpClient, warnings: ImportWarning[], defaultPolicy: CachePolicy): Getter {
  let oldest: number | undefined;
  const get = async (url: string, p: CachePolicy) => {
    const key = p.reducer ? reducedKey(`sleeper:${url}`, p.reducer) : `sleeper:${url}`;
    const res = await http.get(url, {
      cache: { key, ttlMs: p.ttlMs, retainMs: p.retainMs, ...(p.public ? { public: true } : {}) },
      bigIntsAsStrings: true,
      ...(p.cacheIf ? { cacheIf: p.cacheIf } : {}),
      ...(p.reducer ? { transformText: p.reducer.reduce } : {}),
    });
    if (p.league && res.fetchedAt !== undefined) oldest = Math.min(oldest ?? res.fetchedAt, res.fetchedAt);
    return res;
  };
  return {
    oldestFetch: () => oldest,
    async required(url, what, notFound, notFoundMessage, policy = defaultPolicy) {
      let res: HttpResponse;
      try {
        res = await get(url, policy);
      } catch {
        fail("SOURCE_DOWN", "Sleeper couldn't be reached. Try again in a minute.", undefined, what);
      }
      return requireJson(res, what, notFound, notFoundMessage);
    },
    async optional(url, what, code, policy = defaultPolicy) {
      try {
        const res = await get(url, policy);
        if (res.ok && !res.isHtml && res.json !== undefined && res.json !== null) return res.json;
        warnings.push({ code, message: `Sleeper's ${what} couldn't be read (HTTP ${res.status || "no response"}); it is left out.`, platformPath: what });
      } catch {
        warnings.push({ code, message: `Sleeper's ${what} couldn't be read; it is left out.`, platformPath: what });
      }
      return undefined;
    },
  };
}

export interface SleeperFetchResult {
  raw: SleeperRawLeague;
  /** The user's Sleeper user_id when they came in with a username. */
  userId?: string;
  warnings: ImportWarning[];
  /** When the oldest league-data response was fetched from Sleeper (epoch ms). */
  fetchedAt?: number;
}

/** Positions to request projections for: every position the league can start, in canonical order. */
export function startablePositions(rosterPositions: readonly string[]): Pos[] {
  const set = new Set<Pos>(rosterPositions.flatMap((s) => [...(SLOT_ELIGIBLE[s] ?? [])]));
  return POSITIONS.filter((p) => set.has(p));
}

/** The NFL weeks whose projections rank free agents: `week` and the next ones, capped at week 18. */
export function freeAgentRankWeeks(week: number): number[] {
  const out: number[] = [];
  for (let w = week; w < week + FREE_AGENT_RANK_WEEKS && w <= LAST_NFL_WEEK; w++) out.push(w);
  return out;
}

async function resolveLeagueId(req: SleeperImportRequest, g: Getter, warnings: ImportWarning[]): Promise<{ leagueId: string; userId?: string }> {
  let leagueId: string | undefined;
  if (req.leagueId !== undefined && req.leagueId.trim()) {
    leagueId = parseSleeperLeagueId(req.leagueId);
    if (!leagueId) fail("LEAGUE_NOT_FOUND", "That doesn't look like a Sleeper league ID. It's the long number in your league's web address.", undefined, "leagueId");
  }
  const username = req.username?.trim();
  if (!username) {
    if (!leagueId) fail("NO_LEAGUE", "Enter your Sleeper username or a league ID.", undefined, "username");
    return { leagueId };
  }
  const userUrl = sleeperUrls.user(username);
  const userOf = async () => parseOrThrow(UserSchema, await g.required(userUrl, "user", "USER_NOT_FOUND", `There's no Sleeper user named "${username}".`, userPolicy(req.refresh)), "user");

  if (leagueId) {
    // The username only finds the user's team here; a failed lookup mustn't stop the import (SLP-5).
    try {
      return { leagueId, userId: (await userOf()).user_id };
    } catch (err) {
      if (!(err instanceof LeagueImportError)) throw err;
      const why = err.detail.status ? `HTTP ${err.detail.status}` : err.code === "BAD_RESPONSE" ? "an unexpected response" : "no response";
      warnings.push(
        err.code === "USER_NOT_FOUND"
          ? { code: "USER_NOT_FOUND", message: `There's no Sleeper user named "${username}", so we couldn't tell which team is yours. Pick your team.`, platformPath: "user" }
          : { code: "USER_LOOKUP_FAILED", message: `Sleeper didn't answer the lookup of user "${username}" (${why}), so we couldn't tell which team is yours. Pick your team.`, platformPath: "user" },
      );
      return { leagueId };
    }
  }

  const user = await userOf();
  const list = parseArrayOrThrow(LeagueListItemSchema, await g.required(sleeperUrls.userLeagues(user.user_id, req.season), "leagues", "NO_LEAGUE", `No Sleeper leagues for that user in ${req.season}.`, userPolicy(req.refresh)), "leagues");
  if (!list.length) fail("NO_LEAGUE", `That Sleeper user has no leagues in ${req.season}.`, undefined, "leagues");
  const wanted = req.chooseLeagueId ? parseSleeperLeagueId(req.chooseLeagueId) : undefined;
  const chosen = wanted ? list.find((l) => l.league_id === wanted) : list.length === 1 ? list[0] : undefined;
  if (chosen) {
    const id = parseSleeperLeagueId(chosen.league_id);
    if (!id) fail("BAD_RESPONSE", "Sleeper listed a league with an unexpected ID.", undefined, "leagues[].league_id");
    return { leagueId: id, userId: user.user_id };
  }
  throw new SleeperLeagueChoiceError(
    list.map((l) => ({
      leagueId: l.league_id,
      name: l.name?.trim() || "Sleeper league",
      season: Number(l.season),
      teams: l.total_rosters ?? null,
      status: l.status ?? null,
      leagueType: LEAGUE_TYPES[l.settings?.type ?? -1] ?? null,
      bestBall: l.settings?.best_ball === 1,
      supported: l.settings?.type !== 3,
    })),
  );
}

/** Fetch every response the normalizer needs. Throws LeagueImportError for anything the user must fix. */
export async function fetchSleeperLeague(req: SleeperImportRequest, deps: Pick<ImportDeps, "http">): Promise<SleeperFetchResult> {
  const warnings: ImportWarning[] = [];
  const g = getter(deps.http, warnings, leaguePolicy(req.refresh));

  const { leagueId, userId } = await resolveLeagueId(req, g, warnings);
  // ⚠️ Sleeper's NFL state is the same for everyone, but it isn't marked league-independent (cache.public): it's tiny and
  // required, and over the day's budget a required request should answer BUSY like the league's own (src/server/http.ts).
  const stateJson = await g.required(sleeperUrls.state(), "state", "SOURCE_DOWN", "Sleeper's season calendar couldn't be read.");
  const state = parseOrThrow(StateSchema, stateJson, "state");

  const leagueJson = await g.required(sleeperUrls.league(leagueId), "league", "LEAGUE_NOT_FOUND", "League not found. Check the league ID.");
  const league = parseOrThrow(LeagueSchema, leagueJson, "league");
  assertSupported(league); // before 20+ more requests
  const id = leagueId; // validated digits; never a path built from response text

  const [users, rosters] = await Promise.all([
    g.required(sleeperUrls.users(id), "users", "LEAGUE_NOT_FOUND", "League not found. Check the league ID."),
    g.required(sleeperUrls.rosters(id), "rosters", "LEAGUE_NOT_FOUND", "League not found. Check the league ID."),
  ]);

  const s = league.settings;
  const startWeek = num(s, "start_week") || 1;
  const playoffStart = num(s, "playoff_week_start") || 15;
  const season = Number(league.season);
  const stateSeason = Number(state.season);
  const inSeason = season === stateSeason && state.season_type === "regular";
  const seasonOver = season < stateSeason || (season === stateSeason && (state.season_type === "post" || state.season_type === "off"));
  const lastLeg = seasonOver ? LAST_NFL_WEEK : Math.min(LAST_NFL_WEEK, Math.max(1, state.week, num(s, "leg") ?? 0));

  const weeks: number[] = [];
  for (let w = startWeek; w < playoffStart && w <= LAST_NFL_WEEK; w++) weeks.push(w);
  const legs: number[] = [];
  for (let l = 1; l <= lastLeg; l++) legs.push(l);
  // League weeks before the previous one are closed (the season's last leg + 1 once it's over).
  const currentLeg = seasonOver ? LAST_NFL_WEEK + 1 : Math.max(1, num(s, "leg") || state.week);
  const policyFor = (week: number) => (week < currentLeg - 1 ? CLOSED_WEEK_POLICY : undefined);

  const positions = startablePositions(league.roster_positions);
  const projectionWeek = inSeason ? Math.max(1, Math.min(LAST_NFL_WEEK, state.week)) : undefined;
  const projectionWeeks = projectionWeek !== undefined && positions.length ? freeAgentRankWeeks(projectionWeek) : [];

  const [matchupList, txList, tradedPicks, drafts, projectionList] = await Promise.all([
    Promise.all(weeks.map((w) => g.optional(sleeperUrls.matchups(id, w), `matchups/${w}`, "MATCHUPS_MISSING", policyFor(w)))),
    Promise.all(legs.map((l) => g.optional(sleeperUrls.transactions(id, l), `transactions/${l}`, "TRANSACTIONS_MISSING", policyFor(l)))),
    g.optional(sleeperUrls.tradedPicks(id), "traded_picks", "TRADED_PICKS_MISSING"),
    g.optional(sleeperUrls.drafts(id), "drafts", "DRAFTS_MISSING"),
    Promise.all(projectionWeeks.map((w) => g.optional(sleeperUrls.projections(season, w, positions), `projections/${w}`, "PROJECTIONS_UNREADABLE", importProjectionsPolicy(w, projectionWeek ?? w)))),
  ]);

  const matchups: Record<number, unknown> = {};
  weeks.forEach((w, i) => {
    if (matchupList[i] !== undefined) matchups[w] = matchupList[i];
  });
  const transactions: Record<number, unknown> = {};
  legs.forEach((l, i) => {
    if (txList[i] !== undefined) transactions[l] = txList[i];
  });
  const projections: Record<number, unknown> = {};
  projectionWeeks.forEach((w, i) => {
    if (projectionList[i] !== undefined) projections[w] = projectionList[i];
  });

  return {
    raw: {
      state: stateJson,
      league: leagueJson,
      users,
      rosters,
      matchups,
      transactions,
      tradedPicks,
      drafts,
      ...(Object.keys(projections).length ? { projections } : {}),
      ...(projectionWeek !== undefined ? { projectionWeek } : {}),
    },
    ...(userId ? { userId } : {}),
    warnings,
    ...(g.oldestFetch() !== undefined ? { fetchedAt: g.oldestFetch() } : {}),
  };
}
