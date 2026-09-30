/**
 * ESPN adapter (CLAUDE.md §2.2; Phase 1): fetch (server-side, through the injected HttpClient) +
 * normalize (pure) → LeagueSnapshot. ESPN's API is unofficial: it can change or break at any time,
 * so everything ESPN-specific stays behind this module and fails loudly with a clear message.
 */
import type { EspnImportRequest, ImportDeps, ImportResult } from "@/adapters/types";
import { fetchEspnLeague } from "./fetch";
import { normalizeEspnLeague } from "./normalize";

export async function importEspnLeague(req: EspnImportRequest, deps: ImportDeps): Promise<ImportResult> {
  const fetched = await fetchEspnLeague(req, deps.http, deps.now);
  const { snapshot, notes } = normalizeEspnLeague(fetched.raw, {
    leagueId: fetched.leagueId,
    resolver: deps.resolver,
    now: deps.now,
    // The bodies carry SWID pseudonyms (fetch.ts), so "my team" is matched on the cookie SWID's pseudonym.
    ...(fetched.ownerKey ? { swid: fetched.ownerKey } : {}),
    // A team the user picked; the app no longer sends a team taken from a pasted link (review ESPN-3).
    ...(req.myTeamId !== undefined ? { myTeamId: req.myTeamId } : {}),
    warnings: [...fetched.warnings, ...(deps.resolver.warnings?.() ?? [])],
  });
  // The Import Report shows when ESPN served the data (a cached copy is up to 10 minutes old).
  if (fetched.fetchedAt !== undefined) snapshot.fetchedAt = new Date(fetched.fetchedAt).toISOString();
  return { snapshot, notes };
}

export { normalizeEspnLeague, normalizeSwid, FREE_AGENTS_PER_POSITION, type EspnNormalizeContext, type EspnNormalized, type EspnRawBundle } from "./normalize";
export { classifyEspnResponse, fetchEspnLeague, pseudonymizeSwids, requireEspnLeagueId, swidPseudonym, type EspnFetchResult } from "./fetch";
export { buildEspnScoring, toCanonicalStats, ESPN_READINGS, type EspnReading, type EspnScoringItem, type ScoringContext } from "./scoringMap";
export { positionOf, slotInfo, mapInjury } from "./positions";
