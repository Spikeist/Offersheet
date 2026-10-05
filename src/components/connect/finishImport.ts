"use client";
/**
 * Saves a successful import as one of this browser's leagues (src/lib/leagueStore.ts, IndexedDB; planner reply to
 * Checkpoint 4b, change 11): a new league, or an update of one already saved, which becomes the league this tab shows
 * (unless `makeCurrent` is false: a batch of Sleeper leagues shows only its first). `ifSaved` (the Import Report's
 * Refresh) only updates a league still saved, so one removed while the request was under way stays removed. Never
 * credentials: the request summary has no place for them. A team hint from a pasted ESPN team link is kept as a pick
 * for the user to confirm (importStore.ts pickAfterImport), never sent to the server as "my team".
 *
 * importAgain imports a league once more from its request summary (the "Import again" of a league saved by an earlier
 * version of Offer Sheet: NoImportCard), the way the Connect page does: ESPN by league id and season (the session's
 * ESPN cookies, if any, go along, as on the Connect page), Sleeper by league id, with the username it was imported with
 * so the user's team is found again. Part B (track BF): read by this browser where it can (src/lib/leagueFetch.ts
 * importLeague; a private ESPN league is then asked of the server too, which holds the session's cookies, if any).
 */
import { isApiError, isChooseLeague, type EspnImportBody, type ImportResponse, type SleeperImportBody } from "@/lib/api";
import type { ImportRequestSummary } from "@/lib/importStore";
import { importLeague } from "@/lib/leagueFetch";
import { saveLeagueImport, type SaveImportResult } from "@/lib/leagueStore";
import { normalizeSleeperUsername } from "@/lib/sleeperInput";

export function finishImport(request: ImportRequestSummary, response: ImportResponse, teamHint?: string, opts: { makeCurrent?: boolean; ifSaved?: boolean } = {}): Promise<SaveImportResult> {
  return saveLeagueImport({
    request,
    response,
    savedAt: new Date().toISOString(),
    ...(teamHint ? { teamHint } : {}),
    ...(opts.makeCurrent === false ? { makeCurrent: false } : {}),
    ...(opts.ifSaved ? { ifSaved: true } : {}),
  });
}

/** When a league can't be imported again from here (no league id, or a platform without an import yet): the Connect page can. */
export const IMPORT_AGAIN_UNAVAILABLE = "Import it again from the Connect page.";

/** The import request for a league's request summary (pure); null when it can't be made from here. */
export function importAgainRequest(request: ImportRequestSummary): { url: string; body: EspnImportBody | SleeperImportBody } | null {
  if (!request.leagueId) return null;
  if (request.platform === "espn") return { url: "/api/import/espn", body: { leagueId: request.leagueId, season: request.season } };
  if (request.platform === "sleeper") {
    const username = request.username === undefined ? undefined : normalizeSleeperUsername(request.username);
    return { url: "/api/import/sleeper", body: { season: request.season, leagueId: request.leagueId, ...(username ? { username } : {}) } };
  }
  return null;
}

/** Imports a league again from its request summary and saves it (it becomes the league this tab shows). */
export async function importAgain(request: ImportRequestSummary): Promise<SaveImportResult> {
  const req = importAgainRequest(request);
  if (!req || (request.platform !== "espn" && request.platform !== "sleeper")) return { ok: false, message: IMPORT_AGAIN_UNAVAILABLE };
  const res = await importLeague({ platform: request.platform, body: req.body });
  if (isApiError(res)) return { ok: false, message: res.error.message };
  if (isChooseLeague(res) || !("snapshot" in res)) return { ok: false, message: IMPORT_AGAIN_UNAVAILABLE };
  return finishImport(request, res satisfies ImportResponse);
}
