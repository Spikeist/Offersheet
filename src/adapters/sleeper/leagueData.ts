/**
 * Sleeper's league-data half (CLAUDE.md §2.3; planner reply to Checkpoint 4c, Part B, B1: "Sleeper: fetch from the browser
 * (CORS verified) to spread the load across users"; track BF): the league's own responses, read the same way wherever
 * they're read. It runs on the server (./fetch.ts fetchSleeperLeague, through the polite, cached HttpClient), in the
 * browser (src/lib/leagueFetch.ts: the browser asks Sleeper itself and sends the responses up), and on the server again
 * over what the browser sent (src/adapters/upload.ts replays it), so all three ask for the same requests in the same order
 * and judge every answer alike. The projections that rank free agents, the same for every league, are the server's alone
 * (./fetch.ts).
 *
 * - Username path: /user/{username} → user_id → /user/{id}/leagues/nfl/{season}. No such user →
 *   USER_NOT_FOUND; no league → NO_LEAGUE; several → SleeperLeagueChoiceError (code NO_LEAGUE) with
 *   the choices, unless chooseLeagueId picks one. With a league ID the username is optional (it only
 *   finds the user's team): a user Sleeper doesn't know becomes a warning, and the user picks a team.
 * - League data is public (anyone with the ID can read it); on the server it's cached by URL (SleeperLeaguePolicies:
 *   served for 10 minutes, 1 minute after Refresh, and kept 10 minutes either way; the weeks that ended over a week ago 6
 *   hours).
 * - Every body is parsed with bigIntsAsStrings: Sleeper sends a few 19-digit IDs as bare numbers.
 * - 404 / 400 / a literal `null` body → *_NOT_FOUND; 5xx, 429 and network failures (after the
 *   client's retries) → SOURCE_DOWN; a body that isn't JSON → BAD_RESPONSE. Optional endpoints
 *   (matchups, transactions, picks, drafts, the winners bracket) degrade to warnings instead.
 *
 * Browser-safe: no node: imports and no server modules (./normalize.ts is read for its types only).
 */
import { LeagueImportError, type HttpClient, type HttpResponse, type ImportErrorCode, type SleeperImportRequest } from "@/adapters/types";
import type { BodyReducer } from "@/data/reduce";
import type { ImportWarning } from "@/engine/model";
import { parseSleeperLeagueInput } from "@/lib/sleeperInput";
import type { SleeperRawLeague } from "./normalize";
import { LeagueListItemSchema, LeagueSchema, StateSchema, UserSchema, num, parseArrayOrThrow, parseOrThrow, type SleeperLeague, type SleeperState } from "./schemas";

export const SLEEPER_API = "https://api.sleeper.app/v1";
export const SLEEPER_PROJECTIONS = "https://api.sleeper.app/projections/nfl";

/** Last week of the NFL regular season; fantasy playoffs can't run past it. */
export const LAST_NFL_WEEK = 18;

/**
 * A week setting of the league (start_week, playoff_week_start) as a whole number in 1…LAST_NFL_WEEK + 1 (review BF-R1:
 * a league the browser sends is the browser's word, and these numbers drive loops over the weeks; a real league's are
 * always in that range, so they read as before).
 */
export function leagueWeekSetting(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(LAST_NFL_WEEK + 1, Math.floor(value))) : 1;
}

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
  /** The playoff bracket (Checkpoint 7c): read for its 3rd-place game only (./normalize.ts thirdPlaceOf). */
  winnersBracket: (id: string) => `${SLEEPER_API}/league/${id}/winners_bracket`,
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
const GUILLOTINE_TYPE = 3;

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

/** Guillotine (type 3) and non-NFL leagues aren't supported (planner answer 9). */
export function assertSupported(league: Pick<SleeperLeague, "settings" | "sport">): void {
  if (league.sport && league.sport !== "nfl") throw new LeagueImportError("UNSUPPORTED_LEAGUE", "That Sleeper league isn't an NFL league.", { platform: "sleeper", path: "sport" });
  if (num(league.settings, "type") === GUILLOTINE_TYPE)
    throw new LeagueImportError("UNSUPPORTED_LEAGUE", "This is a guillotine league: the lowest-scoring team is eliminated every week. Offer Sheet doesn't support guillotine leagues yet.", { platform: "sleeper", path: "settings.type" });
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

/** How one response is cached on the server (§2.10); the browser's client and a replay ignore all but `league`. */
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

/** How the league-data half's responses are cached (CachePolicy): league data, the weeks that ended, user lookups. */
export interface SleeperLeaguePolicies {
  league: CachePolicy;
  closedWeek: CachePolicy;
  user: CachePolicy;
}

/**
 * The policies for a client without a cache (the browser's, a replay of what it sent): nothing is cached, and only which
 * responses are league data (their fetch time is the snapshot's) matters.
 */
export const UNCACHED_POLICIES: SleeperLeaguePolicies = {
  league: { ttlMs: 0, retainMs: 0, league: true },
  closedWeek: { ttlMs: 0, retainMs: 0, league: false },
  user: { ttlMs: 0, retainMs: 0, league: false },
};

export interface SleeperGetter {
  required(url: string, what: string, notFound: ImportErrorCode, notFoundMessage: string, policy?: CachePolicy): Promise<unknown>;
  /** undefined (plus a warning) when the response can't be used. */
  optional(url: string, what: string, code: string, policy?: CachePolicy): Promise<unknown>;
  /** When the oldest league-data response was fetched from Sleeper (epoch ms; cached copies keep their original time). */
  oldestFetch(): number | undefined;
}

/** Requests through `http` with `defaultPolicy` unless one is given; failures of optional ones become `warnings`. */
export function sleeperGetter(http: HttpClient, warnings: ImportWarning[], defaultPolicy: CachePolicy): SleeperGetter {
  let oldest: number | undefined;
  const get = async (url: string, p: CachePolicy) => {
    // A reduced body's key: the URL's own key plus "#" + the reducer's id (src/data/reduce.ts reducedKey's form).
    const key = p.reducer ? `sleeper:${url}#${p.reducer.id}` : `sleeper:${url}`;
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
      } catch (err) {
        // A client that throws an import error means "stop" (the replay's backstop, src/adapters/upload.ts; no other does).
        if (err instanceof LeagueImportError) throw err;
        fail("SOURCE_DOWN", "Sleeper couldn't be reached. Try again in a minute.", undefined, what);
      }
      return requireJson(res, what, notFound, notFoundMessage);
    },
    async optional(url, what, code, policy = defaultPolicy) {
      try {
        const res = await get(url, policy);
        if (res.ok && !res.isHtml && res.json !== undefined && res.json !== null) return res.json;
        warnings.push({ code, message: `Sleeper's ${what} couldn't be read (HTTP ${res.status || "no response"}); it is left out.`, platformPath: what });
      } catch (err) {
        if (err instanceof LeagueImportError) throw err; // as above: stop
        warnings.push({ code, message: `Sleeper's ${what} couldn't be read; it is left out.`, platformPath: what });
      }
      return undefined;
    },
  };
}

/** The league to import and the user's id, from a league ID (and an optional username) or a username's leagues. */
async function resolveLeagueId(req: SleeperImportRequest, g: SleeperGetter, warnings: ImportWarning[], policies: SleeperLeaguePolicies): Promise<{ leagueId: string; userId?: string }> {
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
  const userOf = async () => parseOrThrow(UserSchema, await g.required(userUrl, "user", "USER_NOT_FOUND", `There's no Sleeper user named "${username}".`, policies.user), "user");

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
  const list = parseArrayOrThrow(LeagueListItemSchema, await g.required(sleeperUrls.userLeagues(user.user_id, req.season), "leagues", "NO_LEAGUE", `No Sleeper leagues for that user in ${req.season}.`, policies.user), "leagues");
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

/** The league's own responses (SleeperRawLeague without the projections, which are the server's: ./fetch.ts). */
export interface SleeperLeagueData {
  leagueId: string;
  /** The user's Sleeper user_id when they came in with a username. */
  userId?: string;
  raw: Omit<SleeperRawLeague, "projections" | "projectionWeek">;
  warnings: ImportWarning[];
  /** When the oldest league-data response was fetched from Sleeper (epoch ms). */
  fetchedAt?: number;
  /** Sleeper's NFL state and the league, parsed (the server's half reads them to pick the projection weeks). */
  state: SleeperState;
  league: SleeperLeague;
}

/**
 * The league's own responses (see the header). Throws LeagueImportError for anything the user must fix (and
 * SleeperLeagueChoiceError when a username has several leagues and none was picked).
 */
export async function fetchSleeperLeagueData(req: SleeperImportRequest, http: HttpClient, policies: SleeperLeaguePolicies): Promise<SleeperLeagueData> {
  const warnings: ImportWarning[] = [];
  const g = sleeperGetter(http, warnings, policies.league);

  const { leagueId, userId } = await resolveLeagueId(req, g, warnings, policies);
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
  const startWeek = leagueWeekSetting(num(s, "start_week") || 1);
  const playoffStart = leagueWeekSetting(num(s, "playoff_week_start") || 15);
  const season = Number(league.season);
  const stateSeason = Number(state.season);
  const seasonOver = season < stateSeason || (season === stateSeason && (state.season_type === "post" || state.season_type === "off"));
  const lastLeg = seasonOver ? LAST_NFL_WEEK : Math.min(LAST_NFL_WEEK, Math.max(1, state.week, num(s, "leg") ?? 0));

  const weeks: number[] = [];
  for (let w = startWeek; w < playoffStart && w <= LAST_NFL_WEEK; w++) weeks.push(w);
  const legs: number[] = [];
  for (let l = 1; l <= lastLeg; l++) legs.push(l);
  // League weeks before the previous one are closed (the season's last leg + 1 once it's over).
  const currentLeg = seasonOver ? LAST_NFL_WEEK + 1 : Math.max(1, num(s, "leg") || state.week);
  const policyFor = (week: number) => (week < currentLeg - 1 ? policies.closedWeek : undefined);

  // The winners bracket last (Checkpoint 7c; planner reply to Checkpoint 7b, §6): optional like the picks, so a bracket that
  // can't be read, or an upload from a browser bundle older than it (the replay answers "no response"), leaves 3rd place
  // unknown, never a failed import.
  const [matchupList, txList, tradedPicks, drafts, winnersBracket] = await Promise.all([
    Promise.all(weeks.map((w) => g.optional(sleeperUrls.matchups(id, w), `matchups/${w}`, "MATCHUPS_MISSING", policyFor(w)))),
    Promise.all(legs.map((l) => g.optional(sleeperUrls.transactions(id, l), `transactions/${l}`, "TRANSACTIONS_MISSING", policyFor(l)))),
    g.optional(sleeperUrls.tradedPicks(id), "traded_picks", "TRADED_PICKS_MISSING"),
    g.optional(sleeperUrls.drafts(id), "drafts", "DRAFTS_MISSING"),
    g.optional(sleeperUrls.winnersBracket(id), "winners_bracket", "WINNERS_BRACKET_MISSING"),
  ]);

  const matchups: Record<number, unknown> = {};
  weeks.forEach((w, i) => {
    if (matchupList[i] !== undefined) matchups[w] = matchupList[i];
  });
  const transactions: Record<number, unknown> = {};
  legs.forEach((l, i) => {
    if (txList[i] !== undefined) transactions[l] = txList[i];
  });

  return {
    leagueId,
    ...(userId ? { userId } : {}),
    raw: { state: stateJson, league: leagueJson, users, rosters, matchups, transactions, tradedPicks, drafts, winnersBracket },
    warnings,
    ...(g.oldestFetch() !== undefined ? { fetchedAt: g.oldestFetch() } : {}),
    state,
    league,
  };
}
