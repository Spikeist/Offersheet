/**
 * Sleeper adapter (CLAUDE.md §2.3): fetch (server-side, polite, cached) + normalize (pure) →
 * LeagueSnapshot. Browser code that only needs the pure parts should import from ./normalize and
 * ./scoringMap directly: ./fetch pulls in the server cache's TTL table (node:crypto).
 */
import type { ImportDeps, ImportResult, SleeperImportRequest } from "@/adapters/types";
import { fetchSleeperLeague } from "./fetch";
import { normalizeSleeperLeague } from "./normalize";

/**
 * Import a Sleeper league by username (my team detected) or league ID (the user picks their team,
 * unless an optional username finds it; a username Sleeper doesn't know is only a warning then).
 */
export async function importSleeperLeague(req: SleeperImportRequest, deps: ImportDeps): Promise<ImportResult> {
  const fetched = await fetchSleeperLeague(req, deps);
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

export { fetchSleeperLeague, leagueChoicesOf, parseSleeperLeagueId, SleeperLeagueChoiceError, sleeperUrls, startablePositions, type SleeperFetchResult, type SleeperLeagueChoice } from "./fetch";
export { findMyRosterId, hasProjection, lineupFromRosterPositions, mapInjury, normalizeSleeperLeague, playoffLayout, sleeperPos, FREE_AGENTS_PER_POSITION, type SleeperNormalizeContext, type SleeperRawLeague } from "./normalize";
export { bracketBounds, mapSleeperScoring, normalizeProjectionStats, PROJECTION_ALIASES, type SleeperScoringMap } from "./scoringMap";
