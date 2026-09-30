/**
 * Hands the import from the Connect page to the Import Report through sessionStorage (never
 * localStorage, never credentials): it lasts only for this browser tab's session. Pure functions
 * over an injected storage, so they're testable without a browser.
 */
import type { LeagueSnapshot, Platform } from "@/engine/model";
import type { ImportResponse } from "./api";

export const IMPORT_STORAGE_KEY = "offersheet:import:v1";
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
  version: 1;
  savedAt: string;
  request: ImportRequestSummary;
  response: ImportResponse;
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

/** Light shape check: a stored value from an older version or another app is ignored. */
export function parseStoredImport(raw: string | null | undefined): StoredImport | undefined {
  if (!raw) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!data || typeof data !== "object") return undefined;
  const d = data as Partial<StoredImport>;
  const snap = d.response?.snapshot as Partial<LeagueSnapshot> | undefined;
  if (d.version !== 1 || !d.request || !snap || typeof snap.platform !== "string" || !Array.isArray(snap.teams) || !snap.settings) return undefined;
  if (!Array.isArray(d.response?.notes)) return undefined;
  return d as StoredImport;
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
  const saved = saveImport(storage, { version: 1, savedAt: args.savedAt, request: args.request, response: args.response });
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
