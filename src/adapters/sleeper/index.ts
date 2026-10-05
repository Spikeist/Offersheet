/**
 * Sleeper adapter (CLAUDE.md §2.3): fetch (server-side, polite, cached) + normalize (pure) →
 * LeagueSnapshot. Browser code that only needs the pure parts should import from ./normalize and
 * ./scoringMap directly, and the browser's own read of a league from ./leagueData: ./fetch pulls in the server cache's
 * TTL table (node:crypto).
 * Part B (planner reply to Checkpoint 4c, B1: browser fetching; track BF): importSleeperUpload imports a league the
 * browser read itself (src/adapters/upload.ts): its responses replayed through the same league-data half
 * (./leagueData.ts), Sleeper's NFL state and the projections from the server's own copies, then normalized exactly as the
 * server's own read.
 */
import type { HttpClient, ImportDeps, ImportResult, SleeperImportRequest } from "@/adapters/types";
import { replayClient, type LeagueUpload } from "@/adapters/upload";
import { defaultSeason } from "@/lib/season";
import { browserFetchLimits } from "@/server/limits";
import { fetchSleeperLeague, fetchSleeperProjections, serverLeaguePolicies, withProjections, type SleeperFetchResult } from "./fetch";
import { fetchSleeperLeagueData, sleeperUrls } from "./leagueData";
import { normalizeSleeperLeague } from "./normalize";
import { StateSchema } from "./schemas";

/** The fetched responses, normalized (shared by both imports). */
function normalizeFetched(fetched: SleeperFetchResult, req: SleeperImportRequest, deps: ImportDeps): ImportResult {
  const result = normalizeSleeperLeague(fetched.raw, {
    now: deps.now,
    resolver: deps.resolver,
    ...(fetched.userId ? { userId: fetched.userId } : {}),
    ...(req.leagueId?.trim() ? { requestedSeason: req.season } : {}),
    fetchWarnings: [...fetched.warnings, ...(deps.resolver.warnings?.() ?? [])],
  });
  // The Import Report shows when Sleeper served the data (a cached copy is up to 10 minutes old).
  if (fetched.fetchedAt !== undefined) result.snapshot.fetchedAt = new Date(fetched.fetchedAt).toISOString();
  return result;
}

/**
 * Import a Sleeper league by username (my team detected) or league ID (the user picks their team,
 * unless an optional username finds it; a username Sleeper doesn't know is only a warning then).
 */
export async function importSleeperLeague(req: SleeperImportRequest, deps: ImportDeps): Promise<ImportResult> {
  return normalizeFetched(await fetchSleeperLeague(req, deps), req, deps);
}

/**
 * A client answering from an upload (src/adapters/upload.ts replayClient), except for Sleeper's NFL state, which the
 * server reads itself (cached like league data) whenever it can: the same for every league, so never the browser's word
 * for it; the browser's copy stands in only when the server's can't be had, and only when it names the season being
 * played by the calendar (review BF-R2: the state decides which season's projections the server fetches for the
 * import, and a browser's word must not pick another; else no state, and the import says Sleeper couldn't be reached).
 * The server's copy keeps no fetch time here: the snapshot's "fetched at" is the browser's read of the league.
 */
function stateFromServer(replay: HttpClient, server: HttpClient, now: Date): HttpClient {
  return {
    async get(url, opts) {
      if (url !== sleeperUrls.state()) return replay.get(url, opts);
      try {
        const res = await server.get(url, opts);
        if (res.ok && !res.isHtml && StateSchema.safeParse(res.json).success) {
          const { fetchedAt: _fetchedAt, ...rest } = res;
          void _fetchedAt;
          return rest;
        }
      } catch {
        // No copy to be had (the day's budget, the deadline): the browser's stands in.
      }
      const browsers = await replay.get(url, opts);
      const state = StateSchema.safeParse(browsers.json);
      if (state.success && Number(state.data.season) === defaultSeason(now)) return browsers;
      return { status: 0, ok: false, isHtml: false, json: undefined, text: "", fromCache: false };
    },
  };
}

/**
 * A league the browser read (see the header): the same result as importSleeperLeague by league ID (and the username the
 * user typed, which finds their team) for the same responses. Throws LeagueImportError as the server's own read would (a
 * part the upload lacks is "no response").
 */
export async function importSleeperUpload(upload: LeagueUpload, deps: ImportDeps): Promise<ImportResult> {
  const req: SleeperImportRequest = { season: upload.request.season, leagueId: upload.request.leagueId, ...(upload.request.username ? { username: upload.request.username } : {}) };
  // At most an upload's parts plus maxParts lookups (the replay's backstop, review BF-R1).
  const http = stateFromServer(replayClient(upload, deps.now.getTime(), browserFetchLimits.maxParts), deps.http, deps.now);
  const data = await fetchSleeperLeagueData(req, http, serverLeaguePolicies());
  const fetched = withProjections(data, await fetchSleeperProjections(data.state, data.league, deps.http));
  return normalizeFetched(fetched, req, deps);
}

export { fetchSleeperLeague, leagueChoicesOf, parseSleeperLeagueId, SleeperLeagueChoiceError, sleeperUrls, startablePositions, type SleeperFetchResult, type SleeperLeagueChoice } from "./fetch";
export { findMyRosterId, hasProjection, lineupFromRosterPositions, mapInjury, normalizeSleeperLeague, playoffLayout, sleeperPos, FREE_AGENTS_PER_POSITION, type SleeperNormalizeContext, type SleeperRawLeague } from "./normalize";
export { bracketBounds, mapSleeperScoring, normalizeProjectionStats, PROJECTION_ALIASES, type SleeperScoringMap } from "./scoringMap";
