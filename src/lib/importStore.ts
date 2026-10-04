/**
 * An import as the browser keeps it (never credentials): the record (StoredImport, toStoredImport), its checks
 * (readImportData, readStoredImport) and the "my team" pick rule (pickAfterImport). Pure functions, testable
 * without a browser.
 *
 * Phase 4c (planner reply to Checkpoint 4b, change 11): saved leagues live in IndexedDB (src/lib/leagueStore.ts),
 * which keeps any number of imports with their "my team" picks until the user removes them, with the record, checks
 * and pick rule here. Before 4c a tab kept its one import and its picks in sessionStorage (IMPORT_STORAGE_KEY,
 * myTeamKey): the league store's migration reads them once per tab (readStoredImport, parseMyTeamKey,
 * parseMyTeamPick), and a removal deletes this tab's copies; nothing writes them anymore.
 *
 * The stored record carries its format version (IMPORT_FORMAT_VERSION). A record from another version
 * is never read, so the pages don't show a snapshot that lacks fields they now rely on. One saved by an
 * earlier version of Offer Sheet (readStoredImport: "outdated") makes them say so and ask for the league
 * again (OUTDATED_IMPORT_TITLE, OUTDATED_IMPORT_TEXT), instead of "No league imported yet", which would
 * read as if the import had been lost.
 */
import type { LeagueSnapshot, Platform } from "@/engine/model";
import type { ImportResponse } from "./api";

/** Before Phase 4c: this tab's import in sessionStorage (the league store's migration reads it). */
export const IMPORT_STORAGE_KEY = "offersheet:import:v1";
/**
 * The stored import's format. Bump it whenever the snapshot changes in a way the pages rely on:
 * - 1: Phases 1–2.
 * - 2: Phase 3 (lead decision D8). Matchups carry `decided` and `result` (and ESPN's multi-week
 *   `weeks`), and settings carry `seedingTiebreaker`. The season simulation reads them (which games
 *   the records already count, and their scores for head-to-head tiebreaks), so a version-1 snapshot,
 *   which has none of them, would give wrong odds and warnings about scores that are in.
 * - 3: Phase 4b. Teams carry `waiverRank` and `faabRemaining` (the order free agents are handed out in, §7) and
 *   settings carry `irEligible` (which statuses an IR slot takes). A version-2 snapshot has neither, so its free agents
 *   would be handed out by best gain under a note that the league's waiver order wasn't available.
 * - 4: Phase 4c (review of track ML). Team.waiverRank is the order the free-agent allocation uses: the weekly reset
 *   order in a league whose waiver order resets weekly, the platform's own order kept in Team.liveWaiverRank; settings
 *   carry `waiverOrderUsed` (planner reply to Checkpoint 4b, answer 2). A version-3 snapshot holds the platform's live
 *   order in waiverRank, so its free agents would go out in the order of the day it was imported, and the Import
 *   Report couldn't say which order was used. A Phase 4b tab's import therefore asks to be imported again (the league
 *   store's migration still moves its "my team" pick, settings and feedback in: src/lib/leagueStore.ts).
 */
export const IMPORT_FORMAT_VERSION = 4;

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
 * The record for an import, in this version's format: what the league store saves, and what
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
  return readImportData(data);
}

/** readStoredImport for a value already parsed (the league store's IndexedDB rows hold objects, not text). */
export function readImportData(data: unknown): StoredImportRead {
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

/** What every pre-4c "my team" key in sessionStorage starts with (myTeamKey). */
export const MY_TEAM_KEY_PREFIX = "offersheet:myteam:v1:";

/** The pre-4c sessionStorage key of the user's own pick of "my team" in one league and season. */
export function myTeamKey(snapshot: LeagueKey): string {
  return `${MY_TEAM_KEY_PREFIX}${snapshot.platform}:${snapshot.leagueId}:${snapshot.season}`;
}

const MY_TEAM_KEY = /^offersheet:myteam:v1:([a-z]+):(.+):(\d{4})$/;

/** The league and season a myTeamKey names (the league store's migration reads every pick in a tab); undefined for any other key. */
export function parseMyTeamKey(key: string): { platform: string; leagueId: string; season: number } | undefined {
  const m = MY_TEAM_KEY.exec(key);
  return m ? { platform: m[1] as string, leagueId: m[2] as string, season: Number(m[3]) } : undefined;
}

/** A stored pick. A bare team ID (how picks were first stored) counts as the user's own. */
export function parseMyTeamPick(raw: string | null | undefined): MyTeamPick | undefined {
  if (!raw) return undefined;
  if (!raw.startsWith("{")) return { teamId: raw, source: "you" };
  try {
    return checkMyTeamPick(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/** A pick already parsed (the league store's rows hold objects), checked: a team ID and where it came from. */
export function checkMyTeamPick(data: unknown): MyTeamPick | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Partial<MyTeamPick>;
  if (typeof d.teamId !== "string" || !d.teamId) return undefined;
  return { teamId: d.teamId, source: d.source === "link" ? "link" : "you" };
}

/** What an import does to the stored pick (pickAfterImport): leave it, set it, or clear it. */
export type PickChange = { kind: "keep" } | { kind: "set"; pick: MyTeamPick } | { kind: "clear" };

/**
 * The pick rule for a finished import (the league store's saveImport and model responses): a team from a pasted ESPN
 * team link (`teamHint`) becomes a pick to confirm ("link"), kept under the league's own pick so Refresh keeps it,
 * unless the platform itself knows the user's team (ESPN cookies, a Sleeper username) or the user already picked a team
 * that is still in the league; a link pick is dropped once the platform knows the team. A hint that isn't a team in the
 * league changes nothing.
 */
export function pickAfterImport(snapshot: Pick<LeagueSnapshot, "myTeamId" | "teams">, existing: MyTeamPick | undefined, teamHint?: string): PickChange {
  const isTeam = (id: string | undefined): id is string => id !== undefined && snapshot.teams.some((t) => t.id === id);
  if (snapshot.myTeamId) return existing?.source === "link" ? { kind: "clear" } : { kind: "keep" };
  if (isTeam(teamHint) && !(existing?.source === "you" && isTeam(existing.teamId))) return { kind: "set", pick: { teamId: teamHint, source: "link" } };
  return { kind: "keep" };
}
