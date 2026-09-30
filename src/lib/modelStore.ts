/**
 * Keeps the League page's model inputs (CLAUDE.md §6 projections and §9 FantasyCalc values for the
 * imported league, already in the league's scoring) in sessionStorage for this tab, so going back
 * to the League page doesn't fetch them again. Never localStorage, never credentials. A stored copy
 * is reused only for the same league AND the same league data (snapshot.fetchedAt), so projections
 * never mix with other rosters, and only while it is younger than the projections' refresh interval
 * (MODEL_REUSE_MAX_AGE_MS): a tab reopened days later fetches again instead of showing an old week
 * as current. One league at a time. Pure functions over an injected storage, like importStore.ts.
 */
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueSnapshot } from "@/engine/model";
import type { EspnModelBody, ModelResponse, SleeperModelBody } from "./api";
import { recordImport, type SaveResult, type StorageLike, type StoredImport } from "./importStore";
import { normalizeSleeperUsername } from "./sleeperInput";

export const MODEL_STORAGE_KEY = "offersheet:model:v1";

/**
 * How long the League page reuses stored inputs, from when the server built them (ModelInputs.builtAt):
 * the projections' refresh interval, 6 hours (§2.10; the server's TTL.projections, which
 * modelStore.test.ts checks this matches; src/server/cache.ts itself can't load in the browser).
 */
export const MODEL_REUSE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export interface StoredModel {
  version: 1;
  savedAt: string;
  /** Which league: "<platform>:<leagueId>:<season>" (modelKey). */
  key: string;
  /** The snapshot's fetchedAt these inputs were built for. */
  snapshotFetchedAt: string;
  model: ModelInputs;
}

type LeagueKey = Pick<LeagueSnapshot, "platform" | "leagueId" | "season">;
type SnapshotKey = LeagueKey & Pick<LeagueSnapshot, "fetchedAt">;

export function modelKey(league: LeagueKey): string {
  return `${league.platform}:${league.leagueId}:${league.season}`;
}

/**
 * Saves model inputs for a snapshot, replacing whatever was stored. The old copy goes first, so a
 * full storage never keeps a stale copy in the way of the import itself.
 */
export function saveModel(storage: StorageLike, args: { snapshot: SnapshotKey; model: ModelInputs; savedAt: string }): SaveResult {
  const stored: StoredModel = { version: 1, savedAt: args.savedAt, key: modelKey(args.snapshot), snapshotFetchedAt: args.snapshot.fetchedAt, model: args.model };
  try {
    storage.removeItem(MODEL_STORAGE_KEY);
    storage.setItem(MODEL_STORAGE_KEY, JSON.stringify(stored));
    return { ok: true };
  } catch {
    return { ok: false, message: "Your browser wouldn't let us keep the projections for this session (storage is full or blocked), so they'll load again next time." };
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

/** Light shape check: a stored value from an older version or another app is ignored. */
export function parseStoredModel(raw: string | null | undefined): StoredModel | undefined {
  if (!raw) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(data) || data.version !== 1 || typeof data.key !== "string" || typeof data.snapshotFetchedAt !== "string" || typeof data.savedAt !== "string") return undefined;
  const m = data.model;
  if (!isRecord(m) || m.version !== 1 || typeof m.currentWeek !== "number" || typeof m.lastWeek !== "number" || typeof m.builtAt !== "string") return undefined;
  if (!isRecord(m.players) || !isRecord(m.nfl) || !Array.isArray(m.sources) || !Array.isArray(m.warnings) || !Array.isArray(m.notes)) return undefined;
  return data as unknown as StoredModel;
}

/** The stored copy when it belongs to this league (whatever league data it was built for). */
export function storedModelForLeague(stored: StoredModel | undefined, league: LeagueKey): StoredModel | undefined {
  return stored && stored.key === modelKey(league) ? stored : undefined;
}

/**
 * The League page's request for the stored import's model inputs (POST /api/model/{espn,sleeper};
 * the server re-imports the league from its 10-minute cache so the inputs always match a snapshot).
 * A Sleeper league imported with a username sends it too, as the Import Report's Refresh does, so
 * the re-import finds the user's team (withImportedTeam still covers a lookup that fails this time).
 * `refresh` is the Refresh button (§2.10: the server fetches again when its copy is over a minute
 * old). Null for platforms without a model route yet.
 */
export function modelRequest(stored: Pick<StoredImport, "request" | "response">, refresh = false): { url: string; body: EspnModelBody | SleeperModelBody } | null {
  const league = stored.response.snapshot;
  const again = refresh ? { refresh: true } : {};
  if (league.platform === "espn") return { url: "/api/model/espn", body: { leagueId: league.leagueId, season: league.season, ...again } };
  if (league.platform === "sleeper") {
    // Checked as the server will (it was when imported): a stored value that isn't a username is left out rather than failing the page.
    const username = stored.request.username === undefined ? undefined : normalizeSleeperUsername(stored.request.username);
    return { url: "/api/model/sleeper", body: { season: league.season, leagueId: league.leagueId, ...(username ? { username } : {}), ...again } };
  }
  return null;
}

/**
 * The stored inputs when they were built for exactly this snapshot (same league, same fetchedAt) and
 * are still fresh: built less than `maxAgeMs` (default MODEL_REUSE_MAX_AGE_MS) before `now` (epoch
 * ms). Inputs without a readable build time count as old.
 */
export function modelForSnapshot(stored: StoredModel | undefined, snapshot: SnapshotKey, opts: { now: number; maxAgeMs?: number }): ModelInputs | undefined {
  const mine = storedModelForLeague(stored, snapshot);
  if (!mine || mine.snapshotFetchedAt !== snapshot.fetchedAt) return undefined;
  const builtAt = Date.parse(mine.model.builtAt);
  const maxAgeMs = opts.maxAgeMs ?? MODEL_REUSE_MAX_AGE_MS;
  return Number.isFinite(builtAt) && opts.now - builtAt < maxAgeMs ? mine.model : undefined;
}

/** The Sleeper adapter's warnings that only say a username lookup failed, so it couldn't tell which team is the user's ("Pick your team"). */
const TEAM_LOOKUP_WARNINGS: ReadonlySet<string> = new Set(["USER_NOT_FOUND", "USER_LOOKUP_FAILED"]);

/**
 * The model response with the team the platform found at import carried over, when the response
 * found none: the model route's re-import can miss it (a Sleeper username lookup that fails this
 * time is only a warning there), and a newer snapshot must not lose it. Only a team that is still in
 * the league is carried over, and then the lookup's "Pick your team" warnings are dropped: the team
 * is known after all.
 */
export function withImportedTeam(response: ModelResponse, stored: StoredImport): ModelResponse {
  const snap = response.import.snapshot;
  const known = stored.response.snapshot.myTeamId;
  if (snap.myTeamId || !known || !snap.teams.some((t) => t.id === known)) return response;
  // (A reply is only shape-checked lightly, so a missing list is tolerated.)
  const warnings = (snap.warnings ?? []).filter((w) => !TEAM_LOOKUP_WARNINGS.has(w.code));
  return { ...response, import: { ...response.import, snapshot: { ...snap, myTeamId: known, warnings } } };
}

/**
 * Keeps a model response (POST /api/model/…) for the stored import it was asked for. A newer league
 * snapshot than the stored one replaces the stored import (recordImport keeps the user's team
 * pick); then the inputs are stored for the response's snapshot. A snapshot older than the stored
 * one (it shouldn't happen) is stored nowhere, so the two never mismatch. The caller sends one
 * change notification afterwards, so a page never sees the new import without its inputs.
 */
export function keepModelResponse(storage: StorageLike, args: { stored: StoredImport; response: ModelResponse; savedAt: string }): { importSaved: boolean; modelSaved: boolean } {
  const snap = args.response.import.snapshot;
  const current = args.stored.response.snapshot.fetchedAt;
  if (snap.fetchedAt !== current && Date.parse(snap.fetchedAt) < Date.parse(current)) return { importSaved: false, modelSaved: false };
  let importSaved = false;
  if (snap.fetchedAt !== current) {
    importSaved = recordImport(storage, { request: args.stored.request, response: args.response.import, savedAt: args.savedAt }).ok;
    if (!importSaved) return { importSaved, modelSaved: false };
  }
  const modelSaved = saveModel(storage, { snapshot: snap, model: args.response.model, savedAt: args.savedAt }).ok;
  return { importSaved, modelSaved };
}
