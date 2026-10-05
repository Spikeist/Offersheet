/**
 * ESPN adapter (CLAUDE.md §2.2; Phase 1): fetch (server-side, through the injected HttpClient) +
 * normalize (pure) → LeagueSnapshot. ESPN's API is unofficial: it can change or break at any time,
 * so everything ESPN-specific stays behind this module and fails loudly with a clear message.
 * Phase 2: importEspnLeagueForModel adds ESPN's league-scored weekly projections (§6 step 1, "ESPN
 * leagues"; projections.ts), read from the same responses.
 * Part B (planner reply to Checkpoint 4c, B1: browser fetching; track BF): importEspnUpload imports a public league the
 * browser read itself (src/adapters/upload.ts): its responses replayed through the same league-data half
 * (./leagueData.ts), ESPN's NFL schedule from the server's own copy, then normalized exactly as the server's own read.
 */
import type { EspnImportRequest, ImportDeps, ImportResult } from "@/adapters/types";
import { replayClient, type LeagueUpload } from "@/adapters/upload";
import { browserFetchLimits } from "@/server/limits";
import { fetchEspnLeague, fetchEspnSchedule, type EspnFetchResult } from "./fetch";
import { fetchEspnLeagueData, filterHeaderOf, type EspnGet } from "./leagueData";
import { normalizeEspnLeague, type EspnRawBundle } from "./normalize";
import { espnProjectionsFrom, type EspnProjections } from "./projections";

/** What the projection model needs from an ESPN import (the /api/model/espn route). */
export interface EspnModelImport {
  /** Exactly what importEspnLeague returns. */
  result: ImportResult;
  /** ESPN's league-scored weekly projections by canonical id and NFL week (ModelInputs players[].espn). */
  espn: EspnProjections;
}

/** The fetched responses, normalized (shared by every import); also hands back the raw responses. */
function normalizeFetched(fetched: EspnFetchResult, deps: ImportDeps, myTeamId: string | undefined): { raw: EspnRawBundle; result: ImportResult } {
  const { snapshot, notes } = normalizeEspnLeague(fetched.raw, {
    leagueId: fetched.leagueId,
    resolver: deps.resolver,
    now: deps.now,
    // The bodies carry SWID pseudonyms (./swid.ts), so "my team" is matched on the cookie SWID's pseudonym.
    ...(fetched.ownerKey ? { swid: fetched.ownerKey } : {}),
    // A team the user picked; the app no longer sends a team taken from a pasted link (review ESPN-3).
    ...(myTeamId !== undefined ? { myTeamId } : {}),
    warnings: [...fetched.warnings, ...(deps.resolver.warnings?.() ?? [])],
  });
  // The Import Report shows when ESPN served the data (a cached copy is up to 10 minutes old).
  if (fetched.fetchedAt !== undefined) snapshot.fetchedAt = new Date(fetched.fetchedAt).toISOString();
  return { raw: fetched.raw, result: { snapshot, notes } };
}

/** Fetch + normalize, shared by both server imports; also hands back the raw responses. */
async function fetchAndNormalize(req: EspnImportRequest, deps: ImportDeps): Promise<{ raw: EspnRawBundle; result: ImportResult }> {
  return normalizeFetched(await fetchEspnLeague(req, deps.http, deps.now), deps, req.myTeamId);
}

export async function importEspnLeague(req: EspnImportRequest, deps: ImportDeps): Promise<ImportResult> {
  return (await fetchAndNormalize(req, deps)).result;
}

/**
 * importEspnLeague plus ESPN's league-scored weekly projections, read from the responses the import
 * already fetched (no extra ESPN request). Import errors are the same; the extraction itself skips
 * anything it can't read instead of failing.
 */
export async function importEspnLeagueForModel(req: EspnImportRequest, deps: ImportDeps): Promise<EspnModelImport> {
  const { raw, result } = await fetchAndNormalize(req, deps);
  return { result, espn: espnProjectionsFrom(raw, result.snapshot) };
}

/**
 * A public league the browser read (see the header): the same result as importEspnLeagueForModel for the same responses.
 * Read without cookies (the browser path never sends any), so the user picks their team. Throws LeagueImportError as
 * the server's own read would (a part the upload lacks is "no response").
 */
export async function importEspnUpload(upload: LeagueUpload, deps: ImportDeps): Promise<EspnModelImport> {
  // At most an upload's parts plus maxParts lookups (the replay's backstop, review BF-R1).
  const replay = replayClient(upload, deps.now.getTime(), browserFetchLimits.maxParts);
  const get: EspnGet = (url, request) => {
    const headers = filterHeaderOf(request);
    return replay.get(url, headers ? { headers } : {});
  };
  const data = await fetchEspnLeagueData({ leagueId: upload.request.leagueId, season: upload.request.season }, get, { now: deps.now, withCookies: false });
  const schedule = await fetchEspnSchedule(data.season, deps.http);
  const fetched: EspnFetchResult = {
    leagueId: data.leagueId,
    season: data.season,
    raw: { ...data.raw, ...(schedule.proTeamSchedules !== undefined ? { proTeamSchedules: schedule.proTeamSchedules } : {}) },
    warnings: [...data.warnings, ...schedule.warnings],
    withCredentials: false,
    ...(data.fetchedAt !== undefined ? { fetchedAt: data.fetchedAt } : {}),
  };
  const { raw, result } = normalizeFetched(fetched, deps, undefined);
  return { result, espn: espnProjectionsFrom(raw, result.snapshot) };
}

export { normalizeEspnLeague, normalizeSwid, FREE_AGENTS_PER_POSITION, type EspnNormalizeContext, type EspnNormalized, type EspnRawBundle } from "./normalize";
export { classifyEspnResponse, fetchEspnLeague, pseudonymizeSwids, requireEspnLeagueId, swidPseudonym, type EspnFetchResult } from "./fetch";
export { buildEspnScoring, toCanonicalStats, ESPN_READINGS, type EspnReading, type EspnScoringItem, type ScoringContext } from "./scoringMap";
export { positionOf, slotInfo, mapInjury } from "./positions";
export { espnProjectionsFrom, type EspnProjections } from "./projections";
