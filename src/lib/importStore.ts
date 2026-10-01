/**
 * Hands the import from the Connect page to the Import Report through sessionStorage (never
 * localStorage, never credentials): it lasts only for this browser tab's session. Pure functions
 * over an injected storage, so they're testable without a browser.
 *
 * The stored record carries its format version (IMPORT_FORMAT_VERSION). A record from another version
 * is never read, so the pages don't show a snapshot that lacks fields they now rely on. One saved by an
 * earlier version of Offer Sheet (readStoredImport: "outdated") makes them say so and ask for the league
 * again (OUTDATED_IMPORT_TITLE, OUTDATED_IMPORT_TEXT), instead of "No league imported yet", which would
 * read as if the import had been lost. The storage key stays the same across versions, so the new
 * import replaces the old record in place (sessionStorage is small).
 */
import type { LeagueSnapshot, Platform } from "@/engine/model";
import type { ImportResponse } from "./api";

export const IMPORT_STORAGE_KEY = "offersheet:import:v1";
/**
 * The stored import's format. Bump it whenever the snapshot changes in a way the pages rely on:
 * - 1: Phases 1–2.
 * - 2: Phase 3 (lead decision D8). Matchups carry `decided` and `result` (and ESPN's multi-week
 *   `weeks`), and settings carry `seedingTiebreaker`. The season simulation reads them (which games
 *   the records already count, and their scores for head-to-head tiebreaks), so a version-1 snapshot,
 *   which has none of them, would give wrong odds and warnings about scores that are in.
 */
export const IMPORT_FORMAT_VERSION = 2;
/** Dispatched on window after this tab changes a stored value (the "storage" event only fires in other tabs). */
export const STORAGE_CHANGED_EVENT = "offersheet:storage-changed";

/** What the user asked for, to show and to re-import. Never holds credentials. */
export interface ImportRequestSummary {
  platform: Platform;
  season: number;
  leagueId?: string;
  username?: string;
}

export interface StoredImport {
  version: typeof IMPORT_FORMAT_VERSION;
  savedAt: string;
  request: ImportRequestSummary;
  response: ImportResponse;
}

/**
 * The record for an import, in this version's format: what recordImport saves, and what
 * scripts/import-report.ts --response-out writes for UI checks.
 */
export function toStoredImport(args: { request: ImportRequestSummary; response: ImportResponse; savedAt: string }): StoredImport {
  return { version: IMPORT_FORMAT_VERSION, savedAt: args.savedAt, request: args.request, response: args.response };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SaveResult = { ok: true } | { ok: false; message: string };

export function saveImport(storage: StorageLike, stored: StoredImport): SaveResult {
  try {
    storage.setItem(IMPORT_STORAGE_KEY, JSON.stringify(stored));
    return { ok: true };
  } catch {
    return { ok: false, message: "Your browser wouldn't let us keep this league for the session (storage is full or blocked). Try closing other Offer Sheet tabs, or allow site data." };
  }
}

/** The pages' heading and text when this tab holds an import saved by an earlier version (readStoredImport: "outdated"). */
export const OUTDATED_IMPORT_TITLE = "Offer Sheet was updated";
export const OUTDATED_IMPORT_TEXT = "Import your league again to see the new numbers.";

/**
 * What this tab's stored import is: one the pages can read ("ok"), one saved by an earlier version of
 * Offer Sheet ("outdated": an older IMPORT_FORMAT_VERSION with an import's shape, e.g. one saved before
 * Phase 3, whose matchups lack `decided`), or nothing the pages can use ("none": no value, a value from
 * another app, or a newer version's record, which this page can't know how to read).
 */
export type StoredImportRead = { kind: "ok"; stored: StoredImport } | { kind: "outdated" } | { kind: "none" };

export function readStoredImport(raw: string | null | undefined): StoredImportRead {
  if (!raw) return { kind: "none" };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { kind: "none" };
  }
  if (!data || typeof data !== "object") return { kind: "none" };
  const d = data as Partial<StoredImport>;
  const snap = d.response?.snapshot as Partial<LeagueSnapshot> | undefined;
  // An import's shape (every version so far): the request, and a snapshot with its platform, teams and settings.
  if (!d.request || !snap || typeof snap.platform !== "string" || !Array.isArray(snap.teams) || !snap.settings) return { kind: "none" };
  const version: unknown = d.version;
  if (typeof version === "number" && Number.isInteger(version) && version >= 1 && version < IMPORT_FORMAT_VERSION) return { kind: "outdated" };
  if (version !== IMPORT_FORMAT_VERSION || !Array.isArray(d.response?.notes)) return { kind: "none" };
  return { kind: "ok", stored: d as StoredImport };
}

/**
 * Light shape check: a stored value from another format version (IMPORT_FORMAT_VERSION; e.g. one saved
 * before Phase 3, whose matchups lack `decided`) or from another app is ignored (readStoredImport says
 * which).
 */
export function parseStoredImport(raw: string | null | undefined): StoredImport | undefined {
  const read = readStoredImport(raw);
  return read.kind === "ok" ? read.stored : undefined;
}

// ---------------------------------------------------------------------------------------------
// "Your team"

/**
 * Where a stored "my team" came from: the user picked it on the Import Report ("you"), or it was
 * taken from the teamId in a pasted ESPN team link ("link"), which the user should confirm: ESPN
 * uses the same kind of link for every team's page.
 */
export type MyTeamPickSource = "you" | "link";

export interface MyTeamPick {
  teamId: string;
  source: MyTeamPickSource;
}

type LeagueKey = Pick<LeagueSnapshot, "platform" | "leagueId" | "season">;

/** Key for the user's own pick of "my team" in one league and season. */
export function myTeamKey(snapshot: LeagueKey): string {
  return `offersheet:myteam:v1:${snapshot.platform}:${snapshot.leagueId}:${snapshot.season}`;
}

/** A stored pick. A bare team ID (how picks were first stored) counts as the user's own. */
export function parseMyTeamPick(raw: string | null | undefined): MyTeamPick | undefined {
  if (!raw) return undefined;
  if (!raw.startsWith("{")) return { teamId: raw, source: "you" };
  try {
    const d = JSON.parse(raw) as Partial<MyTeamPick>;
    if (typeof d.teamId !== "string" || !d.teamId) return undefined;
    return { teamId: d.teamId, source: d.source === "link" ? "link" : "you" };
  } catch {
    return undefined;
  }
}

export function saveMyTeam(storage: StorageLike, snapshot: LeagueKey, teamId: string | null, source: MyTeamPickSource = "you"): void {
  try {
    if (teamId) storage.setItem(myTeamKey(snapshot), JSON.stringify({ teamId, source } satisfies MyTeamPick));
    else storage.removeItem(myTeamKey(snapshot));
  } catch {
    // storage blocked: the pick lasts until the page reloads
  }
}

function loadMyTeamPick(storage: StorageLike, snapshot: LeagueKey): MyTeamPick | undefined {
  try {
    return parseMyTeamPick(storage.getItem(myTeamKey(snapshot)));
  } catch {
    return undefined;
  }
}

/**
 * Saves a finished import for the Import Report. A team from a pasted ESPN team link is kept as a
 * pick to confirm ("link"), under the per-league key so Refresh keeps it, unless the platform itself
 * knows the user's team (ESPN cookies, a Sleeper username) or the user already picked one. A link
 * pick is dropped once the platform knows the team.
 */
export function recordImport(storage: StorageLike, args: { request: ImportRequestSummary; response: ImportResponse; savedAt: string; teamHint?: string }): SaveResult {
  const saved = saveImport(storage, toStoredImport(args));
  if (!saved.ok) return saved;
  const snap = args.response.snapshot;
  const isTeam = (id: string | undefined) => id !== undefined && snap.teams.some((t) => t.id === id);
  const existing = loadMyTeamPick(storage, snap);
  if (snap.myTeamId) {
    if (existing?.source === "link") saveMyTeam(storage, snap, null);
  } else if (isTeam(args.teamHint) && !(existing?.source === "you" && isTeam(existing.teamId))) {
    saveMyTeam(storage, snap, args.teamHint ?? null, "link");
  }
  return saved;
}
