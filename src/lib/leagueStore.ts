/**
 * Saved leagues (CLAUDE.md §14; planner reply to Checkpoint 4b, change 11): every league the user imports stays in this
 * browser's IndexedDB until they remove it, ESPN and Sleeper now and every platform later, with what belongs to it: the
 * import (the snapshot and the request summary, never credentials), "my team", every setting, the stored model inputs
 * (reused while under 6 hours old, as before: modelStore.ts modelForSnapshot) and the feedback on its trade ideas. The
 * pages switch between saved leagues; a new tab opens on the last league used.
 *
 * Layers, each testable on its own (leagueStore.test.ts runs the IndexedDB adapter on fake-indexeddb):
 * 1. Pure functions: the rows' keys and checks (a stored value is never trusted: every row is checked on the way out,
 *    the import with importStore.ts readImportData, the model inputs with modelStore.ts checkStoredModel, settings with
 *    normalizeTradeSettings, feedback with feedbackStore.ts feedbackRecordsFrom), the switcher's order, which league a
 *    tab shows, the pre-4c storage the migration reads, and the selectors the hooks use.
 * 2. Backends (LeagueStoreBackend): IndexedDB, else this page's memory. Every call is one transaction over every store,
 *    so a read-modify-write is atomic, even between tabs (IndexedDB runs transactions that share a store one at a time).
 * 3. The client (LeagueStoreClient): loads the store, runs the migration, keeps the state the pages read (one immutable
 *    snapshot for useSyncExternalStore), writes, and follows other tabs' writes.
 * 4. The browser's client (leagueStore()) and useLeagueStoreState(); the pages' hooks are in
 *    src/components/league/useLeagueInputs.ts, src/components/settings/useLeagueSettings.ts and useFeedback.ts.
 *
 * The database "offersheet" (version 1) has one object store per kind of row:
 * - leagues (key `id`): SavedLeague, what the switcher lists: the league's name, platform and season, when its import was
 *   saved, when it was last opened. Small, so listing the leagues never reads every snapshot.
 * - imports (key `id`): the StoredImport (importStore.ts's record, its format version included).
 * - picks (key `id`): the user's "my team" pick (importStore.ts MyTeamPick).
 * - models (key `id`): the latest model inputs (modelStore.ts StoredModel), one per league.
 * - settings (key `leagueKey`): TradeSettings.
 * - feedback (key `leagueKey`): the feedback records of one league (feedbackStore.ts: the same list, 500 per league).
 * - meta (key `key`): "migration" (when the pre-4c localStorage was moved in) and "removed" (tombstones, below).
 * Keys: a league's `leagueKey` is settingsStore.ts's "<platform>:<8 hex>" (no season, so a renewed ESPN league keeps its
 * settings and feedback, as before); a saved league's `id` is that key plus its season ("espn:1a2b3c4d:2026", since a
 * renewed league is a new import with its own teams and picks). The raw league id is inside the import (re-importing
 * needs it) and never in a key.
 *
 * Which league a tab shows: its own choice (sessionStorage TAB_LEAGUE_KEY, so two tabs can show two leagues), else the
 * league used last (the latest lastUsedAt: switching to a league, or importing it as the tab's league, counts as using
 * it; ⚠️ one saved alongside without being shown, a Sleeper batch's others or a Refresh, keeps its last use, or none:
 * review of track ML), else none. Once a tab shows a league it keeps it, until the user switches or the league is
 * removed (here or in another tab: then the league used last). A tab that shows none adopts a league another tab
 * imports.
 *
 * Writes (and a migration that moved something in) go to IndexedDB in one transaction each and then tell the other tabs
 * (BroadcastChannel, else the storage event on a small localStorage key), which read the small stores again (and an
 * import or model inputs they hold that the message names). Settings, feedback, picks and the switch apply to the page
 * at once (the slider's drag must not wait for the disk), then to the stored copy (each change function runs on the
 * copy stored right now, so quick changes in a row, or in two tabs, never undo each other: keep change functions pure,
 * they can run twice). A refresh from another tab never overwrites a row this tab is writing, or wrote after the
 * refresh read it. A write the browser refuses puts the page back to what is stored and says why in plain English;
 * nothing throws.
 *
 * Without IndexedDB (site data blocked, it doesn't open within OPEN_TIMEOUT_MS, or anything unexpected while loading)
 * everything works in this page's memory, seeded from the pre-4c storage, and the storage status says the leagues last
 * only until the page closes. When another tab opens a newer version of the database (a later Offer Sheet) or the
 * browser closes it, the status says to reload the page, and writes fail with that message.
 *
 * Migration (pre-4c storage → this store; runs on the first load after the update, idempotent, safe in two tabs at once:
 * it runs in one transaction that checks the flag first):
 * - Once per browser: every league's settings (localStorage offersheet:settings:v1, leagues without a saved import
 *   included: they attach when that league is imported) and every feedback record (offersheet:feedback:v1, each to its
 *   league). A row the store already holds is never overwritten (feedback merges: one record per trade idea, the one
 *   pressed later). The flag waits for a readable localStorage.
 * - Once per tab (sessionStorage is per tab; marker TAB_MIGRATED_KEY): the tab's import in this format version
 *   (IMPORT_FORMAT_VERSION; one saved by an earlier version keeps today's "Offer Sheet was updated" message, with "Import
 *   again", when no league is saved: ⚠️ Phase 4c's format is 4, so a Phase 4b tab's import is one, review of track ML),
 *   its model inputs, and every "my team" pick the tab holds. The import replaces a saved copy only when it's newer
 *   (snapshot.fetchedAt). Every pick the tab holds fills its league when the store has none: for the tab's import,
 *   whichever copy is kept (the same league, so the same teams); ⚠️ a pasted-link pick only while the saved copy doesn't
 *   know the user's team (the rule of importStore.ts pickAfterImport); one for a league not saved waits for its import.
 *   The tab then shows its import's league.
 * - Tombstones (meta "removed": league id → when it was removed) keep a removed league from coming back from a tab that
 *   still holds a copy imported before the removal; importing the league again clears it.
 * - ⚠️ The old keys stay as they were (a dormant copy, never read again after the migration), so going back to an older
 *   build finds the data it had, and nothing is lost if the migration had a fault. Removing a league or deleting
 *   feedback also deletes their old copies (forgetLegacyLeague, forgetLegacyFeedback: localStorage's, and this tab's
 *   sessionStorage ones), so a deletion is a deletion; another tab's old sessionStorage copy goes when that tab closes
 *   (and its tombstone keeps it out meanwhile).
 *
 * Removing a league deletes its import, model inputs and pick, and its settings and feedback unless another saved
 * league (another season of it) shares its leagueKey.
 *
 * Privacy: everything stays in this browser until removed (IndexedDB holds the snapshots: team and owner names, the
 * league id). Nothing here is sent anywhere; credentials are never stored (the request summary has no place for them).
 */
import { useSyncExternalStore } from "react";
import type { LeagueSnapshot, Platform } from "@/engine/model";
import { defaultTradeSettings, normalizeTradeSettings, type TradeSettings } from "@/engine/settings";
import {
  FEEDBACK_DELETE_FAILED,
  FEEDBACK_SAVE_FAILED,
  FEEDBACK_STORAGE_KEY,
  applyFeedback,
  feedbackRecordsFrom,
  feedbackTouchedAt,
  mergeFeedbackRecords,
  parseFeedback,
  type FeedbackChange,
  type FeedbackEvaluation,
  type FeedbackRecord,
} from "./feedbackStore";
import {
  IMPORT_STORAGE_KEY,
  checkMyTeamPick,
  myTeamKey,
  parseMyTeamKey,
  parseMyTeamPick,
  pickAfterImport,
  readImportData,
  readStoredImport,
  toStoredImport,
  type ImportRequestSummary,
  type MyTeamPick,
  type MyTeamPickSource,
  type SaveResult,
  type StorageLike,
  type StoredImport,
} from "./importStore";
import type { ImportResponse, ModelResponse } from "./api";
import { MODEL_STORAGE_KEY, checkStoredModel, modelKey, parseStoredModel, snapshotOrder, storedModelForLeague, type StoredModel } from "./modelStore";
import { SETTINGS_SAVE_FAILED, SETTINGS_STORAGE_KEY, isLeagueKey, leagueKey, parseStoredSettings } from "./settingsStore";

// ---------------------------------------------------------------------------------------------
// Names, keys and messages

export const LEAGUE_DB_NAME = "offersheet";
export const LEAGUE_DB_VERSION = 1;
export const LEAGUE_STORES = ["leagues", "imports", "picks", "models", "settings", "feedback", "meta"] as const;
export type LeagueStoreName = (typeof LEAGUE_STORES)[number];
/** Each store's key path (the field every row is keyed by). */
const KEY_PATH: Record<LeagueStoreName, string> = { leagues: "id", imports: "id", picks: "id", models: "id", settings: "leagueKey", feedback: "leagueKey", meta: "key" };

/** sessionStorage: the league this tab shows (a saved league's id). */
export const TAB_LEAGUE_KEY = "offersheet:current-league:v1";
/** sessionStorage: this tab's pre-4c import and picks have been moved into the store ("1"). */
export const TAB_MIGRATED_KEY = "offersheet:migrated:v1";
/** The BroadcastChannel other tabs hear writes on. */
export const STORE_CHANNEL = "offersheet:league-store";
/** localStorage: the same messages through the storage event, in browsers without BroadcastChannel. */
export const STORE_PING_KEY = "offersheet:league-store-ping:v1";
/** How long IndexedDB may take to open before the leagues are kept in this page's memory instead. */
export const OPEN_TIMEOUT_MS = 10_000;

export const STORAGE_MEMORY_ONLY =
  "Your browser won't let Offer Sheet keep leagues on this device (site data is blocked for this site, or this window doesn't allow it), so your leagues, settings and feedback last only until you close or reload this page. Allow site data for Offer Sheet to keep them.";
export const STORAGE_UPDATED_ELSEWHERE = "Offer Sheet was updated in another tab. Reload this page to keep saving your leagues, settings and feedback.";
export const STORAGE_CLOSED = "Your browser closed Offer Sheet's storage (its site data may have been cleared). Reload this page to keep saving your leagues, settings and feedback.";
export const IMPORT_SAVE_FAILED =
  "Your browser wouldn't let Offer Sheet save this league (its storage is full or blocked for this site). Allow site data for Offer Sheet, or remove a league you no longer need, and try again.";
export const LEAGUE_REMOVE_FAILED = "Your browser wouldn't let Offer Sheet remove this league (its storage is blocked for this site). Reload the page and try again.";
export const LEAGUE_NOT_SAVED = "That league isn't saved in this browser anymore. Import it again from the Connect page.";
export const PICK_SAVE_FAILED =
  "Your browser wouldn't let Offer Sheet save your team choice (its storage is full or blocked for this site), so it wasn't kept. Allow site data for Offer Sheet and try again.";
/** A write asked for outside a browser (never on a page: the server has no store). */
export const NO_BROWSER_STORE = "Offer Sheet keeps leagues in your browser, and this isn't one.";

const PLATFORMS = ["espn", "sleeper", "yahoo", "fleaflicker", "mfl", "fantrax", "manual"] as const satisfies readonly Platform[];
/** Fails to typecheck when a Platform is missing from PLATFORMS. */
const PLATFORMS_COMPLETE: Exclude<Platform, (typeof PLATFORMS)[number]> extends never ? true : never = true;
void PLATFORMS_COMPLETE;

function isPlatform(x: unknown): x is Platform {
  return (PLATFORMS as readonly unknown[]).includes(x);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

/** A time in ms; -Infinity when it can't be read (so it never counts as later). */
function timeOf(iso: unknown): number {
  const ms = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

const OK: SaveResult = { ok: true };

// ---------------------------------------------------------------------------------------------
// 1. Pure functions: rows, the switcher, which league a tab shows

type LeagueRef = Pick<LeagueSnapshot, "platform" | "leagueId" | "season">;

/** A saved league's id: its leagueKey (settingsStore.ts) and its season, "espn:1a2b3c4d:2026". */
export function savedLeagueId(league: LeagueRef): string {
  return `${leagueKey(league)}:${league.season}`;
}

/** The leagueKey part of a saved league's id; null for anything else. */
export function leagueKeyOfSavedId(id: string): string | null {
  const m = /^([a-z]+:[0-9a-f]{8}):\d{4}$/.exec(id);
  return m ? (m[1] as string) : null;
}

/** A saved league as the switcher lists it (the leagues store's row). */
export interface SavedLeague {
  /** savedLeagueId: "<leagueKey>:<season>". */
  id: string;
  /** Its settings and feedback key (settingsStore.ts leagueKey). */
  leagueKey: string;
  platform: Platform;
  season: number;
  /** The league's name as the platform gives it (may be empty). */
  name: string;
  /** When its import was last saved (imported, refreshed, or replaced by newer league data). */
  savedAt: string;
  /**
   * When a tab last came to show it: switched to, or imported as the tab's league ("" when never: saved alongside the
   * league shown, as a Sleeper batch's others are). A new tab opens on the latest.
   */
  lastUsedAt: string;
}

/** A leagues row, checked; undefined when it isn't one (its id must be its leagueKey and season). */
export function checkSavedLeague(x: unknown): SavedLeague | undefined {
  if (!isRecord(x)) return undefined;
  const { id, leagueKey: key, platform, season, name, savedAt, lastUsedAt } = x;
  if (!isPlatform(platform) || !isLeagueKey(key) || !key.startsWith(`${platform}:`)) return undefined;
  if (typeof season !== "number" || !Number.isInteger(season) || typeof id !== "string" || id !== `${key}:${season}`) return undefined;
  if (typeof name !== "string" || typeof savedAt !== "string" || typeof lastUsedAt !== "string") return undefined;
  return { id, leagueKey: key, platform, season, name, savedAt, lastUsedAt };
}

/** The switcher's row for an import. */
export function savedLeagueOf(stored: StoredImport, lastUsedAt: string): SavedLeague {
  const snap = stored.response.snapshot;
  // (A snapshot is only shape-checked lightly, so a name that isn't text is kept as none rather than hiding the league.)
  const name = typeof snap.name === "string" ? snap.name : "";
  return { id: savedLeagueId(snap), leagueKey: leagueKey(snap), platform: snap.platform, season: snap.season, name, savedAt: stored.savedAt, lastUsedAt };
}

/**
 * The switcher's order: by name (ignoring case), then the newest season first, then platform and id. A fixed order
 * (⚠️ ours), so a league keeps its place in the list as the user switches.
 */
export function sortSavedLeagues(leagues: readonly SavedLeague[]): SavedLeague[] {
  return [...leagues].sort(
    (a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || b.season - a.season || a.platform.localeCompare(b.platform) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** The league used last (the latest lastUsedAt; ties: the smaller id); null when none is saved. */
export function lastUsedLeague(leagues: readonly SavedLeague[]): string | null {
  let best: SavedLeague | null = null;
  for (const l of leagues) {
    const t = timeOf(l.lastUsedAt);
    const b = best ? timeOf(best.lastUsedAt) : Number.NEGATIVE_INFINITY;
    if (!best || t > b || (t === b && l.id < best.id)) best = l;
  }
  return best?.id ?? null;
}

/** The league a tab shows: its own choice while that league is saved, else the league used last, else none. */
export function chooseCurrentLeague(leagues: readonly SavedLeague[], tabChoice: string | null): string | null {
  if (tabChoice && leagues.some((l) => l.id === tabChoice)) return tabChoice;
  return lastUsedLeague(leagues);
}

/**
 * The request summary of an import record, also one saved by an earlier version (so "Import again" can name the league
 * without the user typing it): platform, season, and the league id (the snapshot's when the request has none, as after
 * a Sleeper username import) or the username; null when it can't be read. Never credentials (the summary has no place
 * for them).
 */
export function importRequestOf(data: unknown): ImportRequestSummary | null {
  if (!isRecord(data) || !isRecord(data.request)) return null;
  const req = data.request;
  const snap = isRecord(data.response) && isRecord(data.response.snapshot) ? data.response.snapshot : undefined;
  if (!isPlatform(req.platform) || typeof req.season !== "number" || !Number.isInteger(req.season)) return null;
  const leagueId = typeof req.leagueId === "string" && req.leagueId ? req.leagueId : typeof snap?.leagueId === "string" && snap.leagueId ? snap.leagueId : undefined;
  const username = typeof req.username === "string" && req.username ? req.username : undefined;
  if (!leagueId && !username) return null;
  return { platform: req.platform, season: req.season, ...(leagueId ? { leagueId } : {}), ...(username ? { username } : {}) };
}

/** An import as the store holds it: one the pages can read, or one they can't (saved by another version, or missing). */
export type LoadedImport = { kind: "ok"; stored: StoredImport } | { kind: "outdated"; request: ImportRequestSummary | null };

/** An imports row (or none) for a saved league: readable only in this format and for this very league. */
export function loadedImportOf(row: unknown, id: string): LoadedImport {
  const data = isRecord(row) ? row.stored : undefined;
  const read = readImportData(data);
  if (read.kind === "ok" && savedLeagueId(read.stored.response.snapshot) === id) return { kind: "ok", stored: read.stored };
  return { kind: "outdated", request: importRequestOf(data) };
}

function pickOfRow(row: unknown, id: string): MyTeamPick | undefined {
  return isRecord(row) && row.id === id ? checkMyTeamPick(row.pick) : undefined;
}

function modelOfRow(row: unknown, id: string): StoredModel | undefined {
  return isRecord(row) && row.id === id ? checkStoredModel(row.model) : undefined;
}

function settingsOfRow(row: unknown, key: string): TradeSettings | undefined {
  return isRecord(row) && row.leagueKey === key && isRecord(row.settings) ? normalizeTradeSettings(row.settings) : undefined;
}

/** A feedback row's records: checked, and only this league's. */
function feedbackOfRow(row: unknown, key: string): FeedbackRecord[] {
  return isRecord(row) && row.leagueKey === key ? feedbackRecordsFrom(row.records).filter((r) => r.leagueKey === key) : [];
}

// ---------------------------------------------------------------------------------------------
// The pre-4c storage the migration reads, and the old copies a deletion removes

/** What the pre-4c storage holds (readLegacyStorage). */
export interface LegacyStorage {
  /** This tab's import (sessionStorage offersheet:import:v1): one in this format, one from an earlier version, or none. */
  tabImport: ReturnType<typeof readStoredImport>;
  /** For an earlier version's import: its request summary, so the page can offer to import it again. */
  tabOutdatedRequest: ImportRequestSummary | null;
  /** The tab's model inputs (offersheet:model:v1) when they're for the tab's import's league. */
  tabModel: StoredModel | undefined;
  /** Every "my team" pick in this tab, by saved league id. */
  tabPicks: ReadonlyMap<string, MyTeamPick>;
  /** This tab's part already ran (TAB_MIGRATED_KEY). */
  tabDone: boolean;
  /** Every league's settings (localStorage offersheet:settings:v1), normalized, by leagueKey. */
  settings: Readonly<Record<string, TradeSettings>>;
  /** Every feedback record (localStorage offersheet:feedback:v1). */
  feedback: readonly FeedbackRecord[];
  /** localStorage could be read (when it can't, the browser-wide part waits for a load where it can). */
  localReadable: boolean;
}

/** A storage's keys, when it can list them (the browser's Storage can; a bare StorageLike can't). */
function storageKeys(storage: StorageLike | undefined): string[] {
  const s = storage as Partial<Pick<Storage, "length" | "key">> | undefined;
  if (!s || typeof s.length !== "number" || typeof s.key !== "function") return [];
  const keys: string[] = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k !== null) keys.push(k);
    }
  } catch {
    // blocked mid-way: what was listed
  }
  return keys;
}

function getItem(storage: StorageLike | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function setItem(storage: StorageLike | undefined, key: string, value: string | null): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // storage blocked: nothing to do
  }
}

/** The pre-4c storage: this tab's sessionStorage and the browser's localStorage (either may be missing or blocked). Never throws. */
export function readLegacyStorage(session: StorageLike | undefined, local: StorageLike | undefined): LegacyStorage {
  const tabRaw = getItem(session, IMPORT_STORAGE_KEY);
  const tabImport = readStoredImport(tabRaw);
  let tabOutdatedRequest: ImportRequestSummary | null = null;
  if (tabImport.kind === "outdated" && tabRaw) {
    try {
      tabOutdatedRequest = importRequestOf(JSON.parse(tabRaw));
    } catch {
      tabOutdatedRequest = null;
    }
  }
  const tabSnap = tabImport.kind === "ok" ? tabImport.stored.response.snapshot : undefined;
  const tabModel = tabSnap ? storedModelForLeague(parseStoredModel(getItem(session, MODEL_STORAGE_KEY)), tabSnap) : undefined;
  const tabPicks = new Map<string, MyTeamPick>();
  for (const key of storageKeys(session)) {
    const ref = parseMyTeamKey(key);
    if (!ref || !isPlatform(ref.platform)) continue;
    const pick = parseMyTeamPick(getItem(session, key));
    if (pick) tabPicks.set(savedLeagueId({ platform: ref.platform, leagueId: ref.leagueId, season: ref.season }), pick);
  }
  // The tab's own league's pick, read by its key even where the storage can't list its keys.
  if (tabSnap) {
    const pick = parseMyTeamPick(getItem(session, myTeamKey(tabSnap)));
    if (pick) tabPicks.set(savedLeagueId(tabSnap), pick);
  }
  let localReadable = local !== undefined;
  let settingsRaw: string | null = null;
  let feedbackRaw: string | null = null;
  try {
    settingsRaw = local?.getItem(SETTINGS_STORAGE_KEY) ?? null;
    feedbackRaw = local?.getItem(FEEDBACK_STORAGE_KEY) ?? null;
  } catch {
    localReadable = false;
  }
  return {
    tabImport,
    tabOutdatedRequest,
    tabModel,
    tabPicks,
    tabDone: getItem(session, TAB_MIGRATED_KEY) === "1",
    settings: parseStoredSettings(settingsRaw),
    feedback: parseFeedback(feedbackRaw),
    localReadable,
  };
}

/**
 * A removed league's old copies (⚠️ the dormant pre-4c copies, so a deletion is a deletion): this tab's import, model
 * inputs and pick when they're that league's, and, when `withSettingsAndFeedback` (no other saved league shares its
 * leagueKey), its localStorage settings entry and feedback records. Other entries stay as they were, byte for byte.
 * Never throws.
 */
export function forgetLegacyLeague(session: StorageLike | undefined, local: StorageLike | undefined, league: LeagueRef | null, opts: { leagueKey: string; withSettingsAndFeedback: boolean }): void {
  if (league) {
    const tab = readStoredImport(getItem(session, IMPORT_STORAGE_KEY));
    if (tab.kind === "ok" && savedLeagueId(tab.stored.response.snapshot) === savedLeagueId(league)) setItem(session, IMPORT_STORAGE_KEY, null);
    if (parseStoredModel(getItem(session, MODEL_STORAGE_KEY))?.key === modelKey(league)) setItem(session, MODEL_STORAGE_KEY, null);
    setItem(session, myTeamKey(league), null);
  }
  if (!opts.withSettingsAndFeedback) return;
  const raw = getItem(local, SETTINGS_STORAGE_KEY);
  if (raw) {
    try {
      const all: unknown = JSON.parse(raw);
      if (isRecord(all) && Object.prototype.hasOwnProperty.call(all, opts.leagueKey)) {
        delete all[opts.leagueKey];
        setItem(local, SETTINGS_STORAGE_KEY, Object.keys(all).length ? JSON.stringify(all) : null);
      }
    } catch {
      // not ours: leave it
    }
  }
  forgetLegacyFeedback(local, opts.leagueKey);
}

/** Deleted feedback's old copies: one league's records (`leagueKey`) or every record. Never throws. */
export function forgetLegacyFeedback(local: StorageLike | undefined, leagueKeyToForget?: string): void {
  if (leagueKeyToForget === undefined) {
    setItem(local, FEEDBACK_STORAGE_KEY, null);
    return;
  }
  const raw = getItem(local, FEEDBACK_STORAGE_KEY);
  if (!raw) return;
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return;
    const rest = list.filter((r) => !(isRecord(r) && r.leagueKey === leagueKeyToForget));
    if (rest.length !== list.length) setItem(local, FEEDBACK_STORAGE_KEY, rest.length ? JSON.stringify(rest) : null);
  } catch {
    // not ours: leave it
  }
}

// ---------------------------------------------------------------------------------------------
// The state the pages read, and the selectors

/** Where saved leagues live for this page. */
export type StorageStatus =
  | { kind: "indexeddb" }
  /** IndexedDB isn't available: this page's memory only (message: say so). */
  | { kind: "memory"; message: string }
  /** IndexedDB went away while the page was open (a newer version opened in another tab, or the browser closed it). */
  | { kind: "closed"; message: string };

export interface LeagueStoreState {
  /** "loading" until the store has been opened, migrated and read (the pages wait: never a flash of "no league"). */
  status: "loading" | "ready";
  storage: StorageStatus;
  /** The saved leagues, in the switcher's order (sortSavedLeagues). */
  leagues: readonly SavedLeague[];
  /** The league this tab shows; null when none is saved. */
  currentId: string | null;
  /** Imports read so far (the current league's, and any shown earlier in this page), by saved league id. */
  imports: ReadonlyMap<string, LoadedImport>;
  /** Model inputs read with them (null: none stored). */
  models: ReadonlyMap<string, StoredModel | null>;
  /** "My team" picks, by saved league id. */
  picks: ReadonlyMap<string, MyTeamPick>;
  /** Saved settings, by leagueKey (a league without a row uses the defaults). */
  settings: ReadonlyMap<string, TradeSettings>;
  /** Feedback records, by leagueKey. */
  feedback: ReadonlyMap<string, readonly FeedbackRecord[]>;
  /** This tab held an import saved by an earlier version of Offer Sheet before the update (its request when readable). */
  outdatedTabImport: { request: ImportRequestSummary | null } | null;
}

/** The state before anything is read (also the server's: there's no store there). */
export const LOADING_STATE: LeagueStoreState = Object.freeze({
  status: "loading",
  storage: { kind: "indexeddb" },
  leagues: [],
  currentId: null,
  imports: new Map(),
  models: new Map(),
  picks: new Map(),
  settings: new Map(),
  feedback: new Map(),
  outdatedTabImport: null,
}) as LeagueStoreState;

/** The league this tab shows, as the pages read it (undefined while the store, or that league's import, loads). */
export type CurrentLeagueRead =
  | { kind: "ok"; league: SavedLeague; stored: StoredImport; pick: MyTeamPick | undefined }
  /** Saved by an earlier version (league: the saved league; null: this tab's import from before the league store). */
  | { kind: "outdated"; league: SavedLeague | null; request: ImportRequestSummary | null }
  | { kind: "none" };

/** The parts of the state the current league's read depends on (currentLeaguePartsOf), so a hook can memoize on them. */
export interface CurrentLeagueParts {
  ready: boolean;
  league: SavedLeague | undefined;
  loaded: LoadedImport | undefined;
  pick: MyTeamPick | undefined;
  outdatedTabImport: LeagueStoreState["outdatedTabImport"];
}

export function currentLeaguePartsOf(state: LeagueStoreState): CurrentLeagueParts {
  const id = state.currentId;
  return {
    ready: state.status === "ready",
    league: id ? state.leagues.find((l) => l.id === id) : undefined,
    loaded: id ? state.imports.get(id) : undefined,
    pick: id ? state.picks.get(id) : undefined,
    outdatedTabImport: state.outdatedTabImport,
  };
}

export function currentLeagueFrom(parts: CurrentLeagueParts): CurrentLeagueRead | undefined {
  const { ready, league, loaded, pick, outdatedTabImport } = parts;
  if (!ready) return undefined;
  if (!league) return outdatedTabImport ? { kind: "outdated", league: null, request: outdatedTabImport.request } : { kind: "none" };
  if (!loaded) return undefined;
  if (loaded.kind === "ok") return { kind: "ok", league, stored: loaded.stored, pick };
  return { kind: "outdated", league, request: loaded.request };
}

export function currentLeagueRead(state: LeagueStoreState): CurrentLeagueRead | undefined {
  return currentLeagueFrom(currentLeaguePartsOf(state));
}

/** The switcher's list and this tab's league (undefined while loading). */
export interface SavedLeaguesRead {
  leagues: readonly SavedLeague[];
  currentId: string | null;
}

export function savedLeaguesRead(state: LeagueStoreState): SavedLeaguesRead | undefined {
  return state.status === "ready" ? { leagues: state.leagues, currentId: state.currentId } : undefined;
}

/** One league's settings as the pages use them (settingsStore.ts LeagueSettingsRead): its saved copy, else the defaults. */
export function savedSettingsRead(state: LeagueStoreState, key: string): { settings: TradeSettings; stored: boolean } | undefined {
  if (state.status !== "ready") return undefined;
  const own = state.settings.get(key);
  return own ? { settings: own, stored: true } : { settings: defaultTradeSettings(), stored: false };
}

/**
 * Feedback records: one league's (`key`), or every league's together (the Settings page's count and export), from the
 * least to the most recently pressed. Undefined while loading.
 */
export function savedFeedbackRead(state: LeagueStoreState, key?: string): FeedbackRecord[] | undefined {
  return state.status === "ready" ? feedbackRecordsOf(state.feedback, key) : undefined;
}

/** One league's records (`key`), or every league's together from the least to the most recently pressed. */
export function feedbackRecordsOf(feedback: LeagueStoreState["feedback"], key?: string): FeedbackRecord[] {
  if (key !== undefined) return [...(feedback.get(key) ?? [])];
  const all = [...feedback.values()].flat();
  const at = new Map(all.map((r) => [r, feedbackTouchedAt(r)]));
  return all.sort((a, b) => (at.get(a) ?? 0) - (at.get(b) ?? 0));
}

/** A saved league's stored model inputs: null when none, undefined while not read yet. */
export function savedModelRead(state: LeagueStoreState, id: string): StoredModel | null | undefined {
  return state.status === "ready" ? state.models.get(id) : undefined;
}

/**
 * A ready state built from plain parts, for tests of the pages (mock useLeagueStoreState with it): the leagues come from
 * the imports (lastUsedAt = their savedAt), the current one is `currentId` (default: the first import's), every import's
 * model inputs are `models[id]` or none.
 */
export function leagueStoreStateOf(parts: {
  imports?: readonly StoredImport[];
  currentId?: string | null;
  picks?: Readonly<Record<string, MyTeamPick>>;
  models?: Readonly<Record<string, StoredModel>>;
  settings?: Readonly<Record<string, TradeSettings>>;
  feedback?: readonly FeedbackRecord[];
  outdatedTabImport?: { request: ImportRequestSummary | null } | null;
  storage?: StorageStatus;
}): LeagueStoreState {
  const imports = parts.imports ?? [];
  const leagues = sortSavedLeagues(imports.map((s) => savedLeagueOf(s, s.savedAt)));
  const feedback = new Map<string, FeedbackRecord[]>();
  for (const r of parts.feedback ?? []) feedback.set(r.leagueKey, [...(feedback.get(r.leagueKey) ?? []), r]);
  const first = imports[0];
  return {
    status: "ready",
    storage: parts.storage ?? { kind: "indexeddb" },
    leagues,
    currentId: parts.currentId !== undefined ? parts.currentId : first ? savedLeagueId(first.response.snapshot) : null,
    imports: new Map(imports.map((s) => [savedLeagueId(s.response.snapshot), { kind: "ok", stored: s } as LoadedImport])),
    models: new Map(imports.map((s) => [savedLeagueId(s.response.snapshot), parts.models?.[savedLeagueId(s.response.snapshot)] ?? null])),
    picks: new Map(Object.entries(parts.picks ?? {})),
    settings: new Map(Object.entries(parts.settings ?? {}).map(([k, v]) => [k, normalizeTradeSettings(v)])),
    feedback,
    outdatedTabImport: parts.outdatedTabImport ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// 2. Backends

/** One transaction's operations (every store is in every transaction). Rows come back unchecked: check them. */
export interface StoreTx {
  get(store: LeagueStoreName, key: string): Promise<unknown>;
  getAll(store: LeagueStoreName): Promise<unknown[]>;
  put(store: LeagueStoreName, row: object): Promise<void>;
  delete(store: LeagueStoreName, key: string): Promise<void>;
  clear(store: LeagueStoreName): Promise<void>;
}

export interface LeagueStoreBackend {
  readonly kind: "indexeddb" | "memory";
  /**
   * Runs `fn` in one transaction over every store: all its writes or none (when it throws, or the browser refuses one).
   * Inside, await only the transaction's own operations (IndexedDB ends a transaction that waits on anything else).
   */
  run<T>(mode: "readonly" | "readwrite", fn: (tx: StoreTx) => Promise<T>): Promise<T>;
  close(): void;
}

/**
 * This page's memory, for a browser without IndexedDB (and for tests): the same rules, transactions one at a time, a
 * transaction's writes kept only when it finishes, rows copied in and out (structuredClone) as IndexedDB copies them.
 */
export function createMemoryBackend(): LeagueStoreBackend {
  let data = new Map<LeagueStoreName, Map<string, unknown>>(LEAGUE_STORES.map((s) => [s, new Map()]));
  let queue: Promise<unknown> = Promise.resolve();
  return {
    kind: "memory",
    run<T>(mode: "readonly" | "readwrite", fn: (tx: StoreTx) => Promise<T>): Promise<T> {
      const result = queue.then(async () => {
        const draft = new Map([...data].map(([s, rows]) => [s, new Map(rows)] as const));
        const table = (s: LeagueStoreName) => draft.get(s) as Map<string, unknown>;
        const writable = () => {
          if (mode !== "readwrite") throw new DOMException("The transaction is read-only.", "ReadOnlyError");
        };
        const tx: StoreTx = {
          get: async (s, key) => structuredClone(table(s).get(key)),
          getAll: async (s) => [...table(s).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, row]) => structuredClone(row)),
          put: async (s, row) => {
            writable();
            const key = (row as Record<string, unknown>)[KEY_PATH[s]];
            if (typeof key !== "string") throw new DOMException("The row has no key.", "DataError");
            table(s).set(key, structuredClone(row));
          },
          delete: async (s, key) => {
            writable();
            table(s).delete(key);
          },
          clear: async (s) => {
            writable();
            table(s).clear();
          },
        };
        const value = await fn(tx);
        if (mode === "readwrite") data = draft;
        return value;
      });
      queue = result.catch(() => undefined);
      return result;
    },
    close() {},
  };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new DOMException("The request failed.", "UnknownError"));
  });
}

function indexedDbBackend(db: IDBDatabase): LeagueStoreBackend {
  return {
    kind: "indexeddb",
    async run<T>(mode: "readonly" | "readwrite", fn: (tx: StoreTx) => Promise<T>): Promise<T> {
      const tx = db.transaction([...LEAGUE_STORES], mode);
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new DOMException("The transaction failed.", "UnknownError"));
        tx.onabort = () => reject(tx.error ?? new DOMException("The transaction was aborted.", "AbortError"));
      });
      done.catch(() => undefined); // awaited below; this keeps a failure while `fn` runs from going unhandled
      const store = (s: LeagueStoreName) => tx.objectStore(s);
      const ops: StoreTx = {
        get: (s, key) => request(store(s).get(key)),
        getAll: (s) => request(store(s).getAll()),
        put: (s, row) => request(store(s).put(row)).then(() => undefined),
        delete: (s, key) => request(store(s).delete(key)).then(() => undefined),
        clear: (s) => request(store(s).clear()).then(() => undefined),
      };
      let value: T;
      try {
        value = await fn(ops);
      } catch (error) {
        try {
          tx.abort();
        } catch {
          // already finished or aborted
        }
        throw error;
      }
      await done;
      return value;
    },
    close: () => db.close(),
  };
}

/**
 * Opens (creating or upgrading) the database. Rejects when the browser refuses, or when it doesn't open within
 * `timeoutMs` (a connection a late success brings is closed). `onClose` hears that this connection went away: another
 * tab opened a newer version (this one closes so that tab isn't blocked) or the browser closed it.
 *
 * ⚠️ A database of this name and version without our stores (something opened "offersheet" with no version before
 * Offer Sheet ever did: a script, the browser's tools) would never get them, since the upgrade that creates them only
 * runs for a new version. When it holds no store at all, nothing of ours can be in it, so it's deleted and made again;
 * one that holds other stores is left alone (this page then keeps leagues in memory).
 */
export async function openIndexedDbBackend(factory: IDBFactory, opts: { onClose?: (status: StorageStatus) => void; timeoutMs?: number } = {}): Promise<LeagueStoreBackend> {
  const timeoutMs = opts.timeoutMs ?? OPEN_TIMEOUT_MS;
  const ours = (db: IDBDatabase) => LEAGUE_STORES.every((name) => db.objectStoreNames.contains(name));
  let db = await openDatabase(factory, timeoutMs);
  if (!ours(db)) {
    const empty = db.objectStoreNames.length === 0;
    db.close();
    if (!empty) throw new DOMException("The database doesn't hold Offer Sheet's stores.", "NotFoundError");
    await deleteDatabase(factory, timeoutMs);
    db = await openDatabase(factory, timeoutMs);
    if (!ours(db)) {
      db.close();
      throw new DOMException("The database doesn't hold Offer Sheet's stores.", "NotFoundError");
    }
  }
  db.onversionchange = () => {
    db.close();
    opts.onClose?.({ kind: "closed", message: STORAGE_UPDATED_ELSEWHERE });
  };
  db.onclose = () => opts.onClose?.({ kind: "closed", message: STORAGE_CLOSED });
  return indexedDbBackend(db);
}

/** One open request for this version, creating the stores on an upgrade (see openIndexedDbBackend). */
function openDatabase(factory: IDBFactory, timeoutMs: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(LEAGUE_DB_NAME, LEAGUE_DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new DOMException("IndexedDB didn't open in time.", "TimeoutError"));
    }, timeoutMs);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of LEAGUE_STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: KEY_PATH[name] });
    };
    req.onsuccess = () => {
      const db = req.result;
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(db);
    };
    req.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(req.error ?? new DOMException("IndexedDB didn't open.", "UnknownError"));
    };
    // onblocked: another tab holds an older version open; its versionchange handler closes it, or the timeout gives up.
  });
}

function deleteDatabase(factory: IDBFactory, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new DOMException("IndexedDB didn't delete the database in time.", "TimeoutError")), timeoutMs);
    try {
      const req = factory.deleteDatabase(LEAGUE_DB_NAME);
      req.onsuccess = () => {
        clearTimeout(timer);
        resolve();
      };
      req.onerror = () => {
        clearTimeout(timer);
        reject(req.error ?? new DOMException("IndexedDB didn't delete the database.", "UnknownError"));
      };
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

/** IndexedDB when it opens, else this page's memory (with the message the pages show). */
export async function openLeagueBackend(
  factory: IDBFactory | undefined,
  opts: { onClose?: (status: StorageStatus) => void; timeoutMs?: number } = {},
): Promise<{ backend: LeagueStoreBackend; storage: StorageStatus }> {
  if (factory) {
    try {
      return { backend: await openIndexedDbBackend(factory, opts), storage: { kind: "indexeddb" } };
    } catch {
      // blocked, refused or too slow: memory
    }
  }
  return { backend: createMemoryBackend(), storage: { kind: "memory", message: STORAGE_MEMORY_ONLY } };
}

// ---------------------------------------------------------------------------------------------
// Reading and migrating inside a transaction

/** The meta store: when the browser-wide migration ran, and the tombstones of removed leagues. */
interface StoreMeta {
  migratedAt: string | null;
  removed: Record<string, string>;
}

async function readMeta(tx: StoreTx): Promise<StoreMeta> {
  const migration = await tx.get("meta", "migration");
  const removed = await tx.get("meta", "removed");
  const tombs: Record<string, string> = {};
  if (isRecord(removed) && isRecord(removed.value)) for (const [id, at] of Object.entries(removed.value)) if (typeof at === "string") tombs[id] = at;
  return { migratedAt: isRecord(migration) && typeof migration.value === "string" ? migration.value : null, removed: tombs };
}

async function writeTombstones(tx: StoreTx, removed: Record<string, string>): Promise<void> {
  if (Object.keys(removed).length) await tx.put("meta", { key: "removed", value: removed });
  else await tx.delete("meta", "removed");
}

/** Clears a league's tombstone (it was imported again). */
async function clearTombstone(tx: StoreTx, id: string): Promise<void> {
  const meta = await readMeta(tx);
  if (!(id in meta.removed)) return;
  const rest = { ...meta.removed };
  delete rest[id];
  await writeTombstones(tx, rest);
}

/** The small stores, checked (everything but imports and model inputs). */
interface SmallRows {
  leagues: SavedLeague[];
  picks: Map<string, MyTeamPick>;
  settings: Map<string, TradeSettings>;
  feedback: Map<string, FeedbackRecord[]>;
  meta: StoreMeta;
}

async function readSmall(tx: StoreTx): Promise<SmallRows> {
  const leagues: SavedLeague[] = [];
  for (const row of await tx.getAll("leagues")) {
    const l = checkSavedLeague(row);
    if (l) leagues.push(l);
  }
  const picks = new Map<string, MyTeamPick>();
  for (const row of await tx.getAll("picks")) {
    const id = isRecord(row) && typeof row.id === "string" ? row.id : null;
    const pick = id ? pickOfRow(row, id) : undefined;
    if (id && pick) picks.set(id, pick);
  }
  const settings = new Map<string, TradeSettings>();
  for (const row of await tx.getAll("settings")) {
    const key = isRecord(row) && isLeagueKey(row.leagueKey) ? row.leagueKey : null;
    const s = key ? settingsOfRow(row, key) : undefined;
    if (key && s) settings.set(key, s);
  }
  const feedback = new Map<string, FeedbackRecord[]>();
  for (const row of await tx.getAll("feedback")) {
    const key = isRecord(row) && typeof row.leagueKey === "string" ? row.leagueKey : null;
    const records = key ? feedbackOfRow(row, key) : [];
    if (key && records.length) feedback.set(key, records);
  }
  return { leagues: sortSavedLeagues(leagues), picks, settings, feedback, meta: await readMeta(tx) };
}

interface LeagueRows {
  loaded: LoadedImport;
  model: StoredModel | null;
}

async function readLeagueRows(tx: StoreTx, id: string): Promise<LeagueRows> {
  return { loaded: loadedImportOf(await tx.get("imports", id), id), model: modelOfRow(await tx.get("models", id), id) ?? null };
}

/** Whether a migration is due: the browser-wide part (when localStorage can be read) or this tab's (when it holds something). */
export function migrationDue(migratedAt: string | null, legacy: LegacyStorage): boolean {
  if (!migratedAt && legacy.localReadable) return true;
  return !legacy.tabDone && (legacy.tabImport.kind === "ok" || legacy.tabPicks.size > 0);
}

/** A tombstone stands for a copy saved before the removal (or when either time can't be read). */
function removedAfter(removedAt: string | undefined, savedAt: string): boolean {
  return removedAt !== undefined && !(timeOf(savedAt) > timeOf(removedAt));
}

/**
 * Moves the pre-4c storage in (see the header). Runs inside one readwrite transaction, so two tabs never both run the
 * browser-wide part, and it never overwrites what the store holds. Returns the league this tab's import belongs to (the
 * tab shows it) and whether this tab's part ran.
 */
export async function migrateLegacy(tx: StoreTx, legacy: LegacyStorage, now: string): Promise<{ tabLeagueId: string | null; ranTab: boolean }> {
  const meta = await readMeta(tx);
  if (!meta.migratedAt && legacy.localReadable) {
    for (const [key, settings] of Object.entries(legacy.settings)) {
      if (!settingsOfRow(await tx.get("settings", key), key)) await tx.put("settings", { leagueKey: key, settings });
    }
    const byLeague = new Map<string, FeedbackRecord[]>();
    for (const r of legacy.feedback) byLeague.set(r.leagueKey, [...(byLeague.get(r.leagueKey) ?? []), r]);
    for (const [key, records] of byLeague) {
      await tx.put("feedback", { leagueKey: key, records: mergeFeedbackRecords(feedbackOfRow(await tx.get("feedback", key), key), records) });
    }
    await tx.put("meta", { key: "migration", value: now });
  }
  if (legacy.tabDone) return { tabLeagueId: null, ranTab: false };
  let tabLeagueId: string | null = null;
  if (legacy.tabImport.kind === "ok") {
    const stored = legacy.tabImport.stored;
    const snap = stored.response.snapshot;
    const id = savedLeagueId(snap);
    if (!removedAfter(meta.removed[id], stored.savedAt)) {
      tabLeagueId = id;
      const row = await tx.get("imports", id);
      const saved = row === undefined ? null : loadedImportOf(row, id);
      // A saved copy the tab's doesn't replace: the same fetch of the league, or a newer one (another tab moved it in).
      const kept = saved?.kind === "ok" && !(timeOf(snap.fetchedAt) > timeOf(saved.stored.response.snapshot.fetchedAt)) ? saved.stored : null;
      if (!kept) {
        const prev = checkSavedLeague(await tx.get("leagues", id));
        await tx.put("imports", { id, stored });
        await tx.put("leagues", savedLeagueOf(stored, prev?.lastUsedAt ?? stored.savedAt));
        const model = legacy.tabModel;
        if (model && model.snapshotFetchedAt === snap.fetchedAt) {
          const have = modelOfRow(await tx.get("models", id), id);
          if (!have || have.snapshotFetchedAt !== snap.fetchedAt || timeOf(model.model.builtAt) > timeOf(have.model.builtAt)) await tx.put("models", { id, model });
        }
      }
      // The tab's pick fills the league when the store has none, whichever copy is kept (the header). Review of track ML:
      // it came only with the tab's own copy, so a same-or-newer copy another tab had moved in, without a pick, cost the
      // user theirs.
      const pick = legacy.tabPicks.get(id);
      const keptSnap = kept ? kept.response.snapshot : snap;
      if (pick && !(pick.source === "link" && keptSnap.myTeamId) && !pickOfRow(await tx.get("picks", id), id)) await tx.put("picks", { id, pick });
    }
  }
  for (const [id, pick] of legacy.tabPicks) {
    // The tab's other picks (and an earlier version's import's): each fills its league when the store has none, by the
    // same rule; one for a league not saved waits for its import; a removed league stays removed. (⚠️ Review of track
    // ML: a saved league kept none, so a Phase 4b tab reloaded after its league was imported again elsewhere lost it.)
    if (id === tabLeagueId || id in meta.removed || pickOfRow(await tx.get("picks", id), id)) continue;
    const saved = loadedImportOf(await tx.get("imports", id), id);
    if (pick.source === "link" && saved.kind === "ok" && saved.stored.response.snapshot.myTeamId) continue;
    await tx.put("picks", { id, pick });
  }
  return { tabLeagueId, ranTab: true };
}

// ---------------------------------------------------------------------------------------------
// 3. The client

/** A message to the other tabs: something changed; `ids` names leagues whose import or model inputs changed. */
export interface StoreMessage {
  v: 1;
  ids: string[];
}

export function parseStoreMessage(x: unknown): StoreMessage | null {
  if (!isRecord(x) || x.v !== 1 || !Array.isArray(x.ids)) return null;
  return { v: 1, ids: x.ids.filter((id): id is string => typeof id === "string") };
}

/** How the tabs hear each other (BroadcastChannel in the browser; a fake hub in tests). */
export interface CrossTabChannel {
  post(message: StoreMessage): void;
  listen(onMessage: (data: unknown) => void): () => void;
  close(): void;
}

/** What the client needs from its surroundings (the browser's, or a test's). */
export interface LeagueStoreEnv {
  /** IndexedDB; undefined when the browser has none or blocks it. */
  indexedDB(): IDBFactory | undefined;
  /** This tab's sessionStorage and the browser's localStorage; undefined when blocked. */
  session(): StorageLike | undefined;
  local(): StorageLike | undefined;
  channel(): CrossTabChannel | undefined;
  /** The time now (ISO). */
  now(): string;
  openTimeoutMs?: number;
  /** Tests: a backend of their own instead of IndexedDB-else-memory. */
  openBackend?: (onClose: (status: StorageStatus) => void) => Promise<{ backend: LeagueStoreBackend; storage: StorageStatus }>;
}

export interface SaveImportArgs {
  request: ImportRequestSummary;
  response: ImportResponse;
  savedAt: string;
  /** A team from a pasted ESPN team link (a pick to confirm: importStore.ts pickAfterImport). */
  teamHint?: string | undefined;
  /**
   * Show it in this tab and count it as used (default true; a batch of Sleeper leagues can add the rest without). False
   * while the tab shows another league: it's saved alongside, keeping when it was last used (a new one: never).
   */
  makeCurrent?: boolean;
  /**
   * Only update a league that is still saved (a Refresh): one removed meanwhile, here or in another tab, stays removed,
   * and the answer is LEAGUE_NOT_SAVED (review of track ML: a Refresh in flight brought a removed league back).
   */
  ifSaved?: boolean;
}

export type SaveImportResult = { ok: true; id: string } | { ok: false; message: string };

type WriteOutcome<T> = { ok: true; value: T } | { ok: false; message: string | null };

interface WriteSpec<T> {
  /** The rows it touches ("settings:espn:1a2b3c4d"): a refresh never overwrites them while the write is in flight. */
  keys: readonly string[];
  /** Applied to the page at once (before the disk). */
  optimistic?: (state: LeagueStoreState) => LeagueStoreState;
  run: (tx: StoreTx) => Promise<T>;
  /** Applied once stored; `settled(key)`: no later write of that row is still in flight (whose result is fresher). */
  commit: (state: LeagueStoreState, value: T, settled: (key: string) => boolean) => LeagueStoreState;
  /** Leagues whose import or model inputs it changed (the other tabs read those again). */
  ids?: readonly string[];
}

function withMap<K, V>(map: ReadonlyMap<K, V>, key: K, value: V | undefined): Map<K, V> {
  const out = new Map(map);
  if (value === undefined) out.delete(key);
  else out.set(key, value);
  return out;
}

function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** A row's fresh copy, keeping the current object when nothing in it changed (so memos downstream hold). */
function keepSame<V>(current: V | undefined, fresh: V | undefined): V | undefined {
  return current !== undefined && fresh !== undefined && sameJson(current, fresh) ? current : fresh;
}

export class LeagueStoreClient {
  private state: LeagueStoreState = LOADING_STATE;
  private readonly listeners = new Set<() => void>();
  private started: Promise<void> | null = null;
  private backend: LeagueStoreBackend | null = null;
  private channel: CrossTabChannel | undefined;
  private stopListening: (() => void) | null = null;
  private tabChoice: string | null = null;
  /** Writes in flight per row key. */
  private readonly pending = new Map<string, number>();
  /** When each row was last written by this tab (a counter), so a refresh read before it doesn't undo it. */
  private readonly written = new Map<string, number>();
  private writes = 0;
  private refreshing: Promise<void> = Promise.resolve();
  /** Leagues whose import and model inputs are being read. */
  private readonly loadingLeagues = new Map<string, Promise<void>>();
  private disposed = false;

  constructor(private readonly env: LeagueStoreEnv) {}

  /** useSyncExternalStore's subscribe (starts loading the store on the first subscriber). */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    void this.start();
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** useSyncExternalStore's snapshot: the same object until something changes. */
  readonly getState = (): LeagueStoreState => this.state;

  /** Loads the store once (later calls wait for the same load). Never rejects. */
  start(): Promise<void> {
    this.started ??= this.load().catch(() => this.loadNothing());
    return this.started;
  }

  /** Something unexpected went wrong while loading: an empty store in this page's memory, and the status says so. */
  private loadNothing(): void {
    this.backend?.close();
    this.backend = createMemoryBackend();
    this.setState({ ...LOADING_STATE, status: "ready", storage: { kind: "memory", message: STORAGE_MEMORY_ONLY } });
  }

  private setState(next: LeagueStoreState): void {
    if (next === this.state || this.disposed) return;
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }

  private onClosed = (status: StorageStatus): void => {
    this.setState({ ...this.state, storage: status });
  };

  private async load(): Promise<void> {
    const legacy = readLegacyStorage(this.env.session(), this.env.local());
    const opened = this.env.openBackend
      ? await this.env.openBackend(this.onClosed)
      : await openLeagueBackend(this.env.indexedDB(), { onClose: this.onClosed, ...(this.env.openTimeoutMs !== undefined ? { timeoutMs: this.env.openTimeoutMs } : {}) });
    let { backend, storage } = opened;
    let first: Awaited<ReturnType<LeagueStoreClient["loadFrom"]>>;
    try {
      first = await this.loadFrom(backend, legacy);
    } catch {
      // IndexedDB opened but wouldn't read or write: this page's memory, seeded from the pre-4c storage.
      backend.close();
      backend = createMemoryBackend();
      storage = { kind: "memory", message: STORAGE_MEMORY_ONLY };
      first = await this.loadFrom(backend, legacy);
    }
    if (this.disposed) {
      backend.close();
      return;
    }
    this.backend = backend;
    const { small, currentId, rows, migrated } = first;
    this.setTabChoice(currentId);
    this.setState({
      status: "ready",
      storage: this.state.storage.kind === "closed" ? this.state.storage : storage,
      leagues: small.leagues,
      currentId,
      imports: rows && currentId ? new Map([[currentId, rows.loaded]]) : new Map(),
      models: rows && currentId ? new Map([[currentId, rows.model]]) : new Map(),
      picks: small.picks,
      settings: small.settings,
      feedback: small.feedback,
      outdatedTabImport: legacy.tabImport.kind === "outdated" ? { request: legacy.tabOutdatedRequest } : null,
    });
    this.channel = this.env.channel();
    this.stopListening = this.channel?.listen((data) => {
      const message = parseStoreMessage(data);
      if (message) this.refresh(message.ids);
    }) ?? null;
    // Tabs already open hear what the migration moved in (a league from this tab's old import, settings, feedback).
    if (migrated) this.channel?.post({ v: 1, ids: migrated });
  }

  private async loadFrom(
    backend: LeagueStoreBackend,
    legacy: LegacyStorage,
  ): Promise<{ small: SmallRows; currentId: string | null; rows: LeagueRows | null; migrated: string[] | null }> {
    let small = await backend.run("readonly", readSmall);
    let tabLeagueId: string | null = null;
    let migrated: string[] | null = null;
    if (migrationDue(small.meta.migratedAt, legacy)) {
      const result = await backend.run("readwrite", (tx) => migrateLegacy(tx, legacy, this.env.now()));
      tabLeagueId = result.tabLeagueId;
      migrated = tabLeagueId ? [tabLeagueId] : [];
      // In memory the migration runs again next load (nothing was kept), so the tab isn't marked.
      if (backend.kind === "indexeddb" && result.ranTab) setItem(this.env.session(), TAB_MIGRATED_KEY, "1");
      small = await backend.run("readonly", readSmall);
    }
    // The tab's own choice while it's saved, else the league its pre-4c import just moved in, else the league used last.
    const own = getItem(this.env.session(), TAB_LEAGUE_KEY) ?? this.tabChoice;
    const currentId = chooseCurrentLeague(small.leagues, own && small.leagues.some((l) => l.id === own) ? own : tabLeagueId);
    const rows = currentId ? await backend.run("readonly", (tx) => readLeagueRows(tx, currentId)) : null;
    return { small, currentId, rows, migrated };
  }

  /** This tab's league, kept for its reloads (sessionStorage; this page's memory when that's blocked). */
  private setTabChoice(id: string | null): void {
    this.tabChoice = id;
    setItem(this.env.session(), TAB_LEAGUE_KEY, id);
  }

  /** Reads a league's import and model inputs when this page hasn't yet (the current league's are read with the store). */
  private ensureLeague(id: string): void {
    const backend = this.backend;
    if (!backend || this.state.imports.has(id) || this.loadingLeagues.has(id)) return;
    const loading = backend.run("readonly", (tx) => readLeagueRows(tx, id)).then(
      (rows) => {
        this.loadingLeagues.delete(id);
        // A write since (an import, a model response) brought fresher rows: keep those.
        if (this.state.imports.has(id) || !this.state.leagues.some((l) => l.id === id)) return;
        this.setState({ ...this.state, imports: withMap(this.state.imports, id, rows.loaded), models: withMap(this.state.models, id, rows.model) });
      },
      () => {
        // The storage went away (its status says so): the page keeps waiting.
        this.loadingLeagues.delete(id);
      },
    );
    this.loadingLeagues.set(id, loading);
  }

  /** Resolves once the store is loaded and the reads it started (other tabs' changes, a league's import) have landed (tests). */
  async settled(): Promise<void> {
    await this.start();
    await this.refreshing;
    await Promise.all([...this.loadingLeagues.values()]);
  }

  private isPinned(key: string, since: number): boolean {
    return (this.pending.get(key) ?? 0) > 0 || (this.written.get(key) ?? -1) > since;
  }

  /** Another tab wrote: read the small stores again, and the imports and model inputs it names that this page holds. */
  private refresh(ids: readonly string[]): void {
    // One at a time, in order, so an older read never lands after a newer one.
    this.refreshing = this.refreshing
      .then(async () => {
        const backend = this.backend;
        if (!backend || this.disposed || this.state.status !== "ready") return;
        const since = this.writes;
        const rows = new Map<string, LeagueRows>();
        let small: SmallRows;
        try {
          small = await backend.run("readonly", async (tx) => {
            const read = await readSmall(tx);
            for (const id of ids) if (this.state.imports.has(id)) rows.set(id, await readLeagueRows(tx, id));
            return read;
          });
        } catch {
          return;
        }
        this.applyFresh(small, rows, since);
      })
      .catch(() => undefined);
  }

  /** `fn` at once when the store is ready (so a write's page update lands in the same event), else once it is. */
  private whenReady<T>(fn: () => Promise<T>): Promise<T> {
    return this.state.status === "ready" ? fn() : this.start().then(fn);
  }

  /** Fresh rows into the state, keeping this tab's writes that are in flight or newer than the read. */
  private applyFresh(small: SmallRows, rows: ReadonlyMap<string, LeagueRows>, since: number): void {
    const s = this.state;
    const pinned = (key: string) => this.isPinned(key, since);
    const merge = <V>(prefix: string, current: ReadonlyMap<string, V>, fresh: ReadonlyMap<string, V>): ReadonlyMap<string, V> => {
      const out = new Map<string, V>();
      for (const key of new Set([...current.keys(), ...fresh.keys()])) {
        const value = pinned(`${prefix}:${key}`) ? current.get(key) : keepSame(current.get(key), fresh.get(key));
        if (value !== undefined) out.set(key, value);
      }
      return out;
    };
    const currentLeagues = new Map(s.leagues.map((l) => [l.id, l]));
    const freshLeagues = new Map(small.leagues.map((l) => [l.id, l]));
    const leagues = sortSavedLeagues([...merge("leagues", currentLeagues, freshLeagues).values()]);
    const saved = new Set(leagues.map((l) => l.id));
    let imports = new Map([...s.imports].filter(([id]) => saved.has(id)));
    let models = new Map([...s.models].filter(([id]) => saved.has(id)));
    for (const [id, r] of rows) {
      if (!saved.has(id) || pinned(`imports:${id}`)) continue;
      imports = withMap(imports, id, r.loaded);
      models = withMap(models, id, r.model);
    }
    let currentId = s.currentId;
    if (!currentId || !saved.has(currentId)) currentId = chooseCurrentLeague(leagues, null);
    const next: LeagueStoreState = {
      ...s,
      leagues: sameJson(leagues, s.leagues) ? s.leagues : leagues,
      currentId,
      imports,
      models,
      picks: merge("picks", s.picks, small.picks),
      settings: merge("settings", s.settings, small.settings),
      feedback: merge("feedback", s.feedback, small.feedback),
    };
    this.setState(next);
    if (currentId !== s.currentId) {
      this.setTabChoice(currentId);
      if (currentId) this.ensureLeague(currentId);
    }
  }

  /** Runs a write (see WriteSpec); its optimistic part applies at once when the store is ready. */
  private write<T>(spec: WriteSpec<T>): Promise<WriteOutcome<T>> {
    return this.whenReady(() => this.writeNow(spec));
  }

  private async writeNow<T>(spec: WriteSpec<T>): Promise<WriteOutcome<T>> {
    const backend = this.backend;
    if (!backend || this.disposed) return { ok: false, message: null };
    const closedBefore = this.closedMessage();
    if (closedBefore) return { ok: false, message: closedBefore };
    for (const k of spec.keys) this.pending.set(k, (this.pending.get(k) ?? 0) + 1);
    if (spec.optimistic) this.setState(spec.optimistic(this.state));
    let value: T;
    try {
      value = await backend.run("readwrite", spec.run);
    } catch {
      this.release(spec.keys, false);
      await this.revert(spec.keys);
      return { ok: false, message: this.closedMessage() };
    }
    this.release(spec.keys, true);
    this.setState(spec.commit(this.state, value, (k) => !this.pending.get(k)));
    this.channel?.post({ v: 1, ids: [...(spec.ids ?? [])] });
    return { ok: true, value };
  }

  /** What writes say once the storage went away (reload the page); null while it's there. */
  private closedMessage(): string | null {
    const storage = this.state.storage;
    return storage.kind === "closed" ? storage.message : null;
  }

  private release(keys: readonly string[], written: boolean): void {
    if (written) this.writes++;
    for (const k of keys) {
      const n = (this.pending.get(k) ?? 1) - 1;
      if (n > 0) this.pending.set(k, n);
      else this.pending.delete(k);
      if (written) this.written.set(k, this.writes);
    }
  }

  /** After a refused write: the page goes back to what is stored for the rows it touched (unless another write is on them). */
  private async revert(keys: readonly string[]): Promise<void> {
    const backend = this.backend;
    if (!backend) return;
    let small: SmallRows;
    try {
      small = await backend.run("readonly", readSmall);
    } catch {
      return;
    }
    const s = this.state;
    const settledKeys = keys.filter((k) => !this.pending.get(k));
    const take = <V>(prefix: string, current: ReadonlyMap<string, V>, fresh: ReadonlyMap<string, V>): ReadonlyMap<string, V> => {
      let out: ReadonlyMap<string, V> = current;
      for (const k of settledKeys) if (k.startsWith(`${prefix}:`)) out = withMap(out, k.slice(prefix.length + 1), fresh.get(k.slice(prefix.length + 1)));
      return out;
    };
    const leagueKeys = new Set(settledKeys.filter((k) => k.startsWith("leagues:")).map((k) => k.slice("leagues:".length)));
    const leagues = leagueKeys.size
      ? sortSavedLeagues([...s.leagues.filter((l) => !leagueKeys.has(l.id)), ...small.leagues.filter((l) => leagueKeys.has(l.id))])
      : s.leagues;
    this.setState({ ...s, leagues, picks: take("picks", s.picks, small.picks), settings: take("settings", s.settings, small.settings), feedback: take("feedback", s.feedback, small.feedback) });
  }

  // ---- writes ----

  /**
   * Saves an import (the Connect page's, a Refresh's): the league is added or its import replaced, "my team" follows
   * importStore.ts pickAfterImport, a tombstone goes, and (makeCurrent, the default) the tab shows it and it counts as
   * used. Saved without the tab coming to show it (makeCurrent false while the tab shows another league), it keeps when
   * it was last used, a new one never (⚠️ review of track ML: every league of a Sleeper batch counted as used, so a new
   * tab opened on the batch's last one, never shown). With `ifSaved` (a Refresh) a league no longer saved is left removed.
   * Its stored model inputs stay (the reuse rule only reuses them for the same league data).
   */
  async saveImport(args: SaveImportArgs): Promise<SaveImportResult> {
    const stored = toStoredImport({ request: args.request, response: args.response, savedAt: args.savedAt });
    const snap = stored.response.snapshot;
    const id = savedLeagueId(snap);
    const makeCurrent = args.makeCurrent ?? true;
    const now = this.env.now();
    const out = await this.write({
      keys: [`leagues:${id}`, `imports:${id}`, `picks:${id}`],
      run: async (tx) => {
        const prev = checkSavedLeague(await tx.get("leagues", id));
        if (args.ifSaved && !prev) return null;
        const existing = pickOfRow(await tx.get("picks", id), id);
        const change = pickAfterImport(snap, existing, args.teamHint);
        // Used only when the tab comes to show it (the commit's rule below: asked to, or the tab shows none).
        const shown = makeCurrent || !this.state.currentId;
        const league = savedLeagueOf(stored, shown ? now : (prev?.lastUsedAt ?? ""));
        await tx.put("imports", { id, stored });
        await tx.put("leagues", league);
        if (change.kind === "set") await tx.put("picks", { id, pick: change.pick });
        else if (change.kind === "clear") await tx.delete("picks", id);
        await clearTombstone(tx, id);
        const model = modelOfRow(await tx.get("models", id), id) ?? null;
        return { league, pick: change.kind === "set" ? change.pick : change.kind === "clear" ? undefined : existing, model };
      },
      commit: (s, r, settled) =>
        r
          ? {
              ...s,
              leagues: sortSavedLeagues([...s.leagues.filter((l) => l.id !== id), r.league]),
              currentId: makeCurrent || !s.currentId ? id : s.currentId,
              imports: withMap(s.imports, id, { kind: "ok", stored }),
              models: s.models.has(id) ? s.models : withMap(s.models, id, r.model),
              picks: settled(`picks:${id}`) ? withMap(s.picks, id, r.pick) : s.picks,
            }
          : s,
      ids: [id],
    });
    if (!out.ok) return { ok: false, message: out.message ?? IMPORT_SAVE_FAILED };
    if (!out.value) return { ok: false, message: LEAGUE_NOT_SAVED };
    if (this.state.currentId === id) this.setTabChoice(id);
    return { ok: true, id };
  }

  /**
   * Shows a saved league in this tab (at once: the page switches in the same event) and counts it as used; a failure to
   * store "used" is ignored (the switch happened, and only which league a new tab opens on is lost). A league another
   * tab removed meanwhile (its message heard while this write pinned the row, so the list still held it) is read again
   * afterwards: it goes from the list and the tab moves on (LEAGUE_NOT_SAVED; ⚠️ review of track ML).
   */
  selectLeague(id: string): Promise<SaveResult> {
    return this.whenReady(async () => {
      if (!this.state.leagues.some((l) => l.id === id)) return { ok: false, message: LEAGUE_NOT_SAVED };
      this.setTabChoice(id);
      if (this.state.currentId !== id) this.setState({ ...this.state, currentId: id });
      this.ensureLeague(id);
      const now = this.env.now();
      const used = (l: SavedLeague) => (l.id === id ? { ...l, lastUsedAt: now } : l);
      const out = await this.write({
        keys: [`leagues:${id}`],
        optimistic: (s) => ({ ...s, leagues: s.leagues.map(used) }),
        run: async (tx) => {
          const row = checkSavedLeague(await tx.get("leagues", id));
          if (row) await tx.put("leagues", used(row));
          return row ? used(row) : null;
        },
        commit: (s, row, settled) => (row && settled(`leagues:${id}`) ? { ...s, leagues: s.leagues.map((l) => (l.id === id ? row : l)) } : s),
      });
      if (out.ok && !out.value) {
        this.refresh([]);
        return { ok: false, message: LEAGUE_NOT_SAVED };
      }
      return OK;
    });
  }

  /**
   * Removes a saved league: its import, model inputs and pick, and its settings and feedback unless another saved league
   * shares its leagueKey (another season), with a tombstone; and their old pre-4c copies. A tab that showed it moves to
   * the league used last.
   */
  async removeLeague(id: string): Promise<SaveResult> {
    const key = leagueKeyOfSavedId(id);
    if (!key) return { ok: false, message: LEAGUE_NOT_SAVED };
    const now = this.env.now();
    const out = await this.write({
      keys: [`leagues:${id}`, `imports:${id}`, `picks:${id}`, `settings:${key}`, `feedback:${key}`],
      run: async (tx) => {
        const raw = await tx.get("imports", id);
        const others = (await tx.getAll("leagues")).map(checkSavedLeague).filter((l): l is SavedLeague => !!l && l.id !== id);
        const shared = others.some((l) => l.leagueKey === key);
        for (const store of ["leagues", "imports", "models", "picks"] as const) await tx.delete(store, id);
        if (!shared) {
          await tx.delete("settings", key);
          await tx.delete("feedback", key);
        }
        const meta = await readMeta(tx);
        await writeTombstones(tx, { ...meta.removed, [id]: now });
        const data = isRecord(raw) ? raw.stored : undefined;
        const snap = isRecord(data) && isRecord(data.response) && isRecord(data.response.snapshot) ? data.response.snapshot : undefined;
        const ref: LeagueRef | null =
          snap && isPlatform(snap.platform) && typeof snap.leagueId === "string" && typeof snap.season === "number" ? { platform: snap.platform, leagueId: snap.leagueId, season: snap.season } : null;
        return { shared, ref };
      },
      commit: (s, r) => {
        const leagues = s.leagues.filter((l) => l.id !== id);
        return {
          ...s,
          leagues,
          currentId: s.currentId === id ? chooseCurrentLeague(leagues, null) : s.currentId,
          imports: withMap(s.imports, id, undefined),
          models: withMap(s.models, id, undefined),
          picks: withMap(s.picks, id, undefined),
          settings: r.shared ? s.settings : withMap(s.settings, key, undefined),
          feedback: r.shared ? s.feedback : withMap(s.feedback, key, undefined),
        };
      },
      ids: [id],
    });
    if (!out.ok) return { ok: false, message: out.message ?? LEAGUE_REMOVE_FAILED };
    forgetLegacyLeague(this.env.session(), this.env.local(), out.value.ref, { leagueKey: key, withSettingsAndFeedback: !out.value.shared });
    if (this.tabChoice !== this.state.currentId) {
      this.setTabChoice(this.state.currentId);
      if (this.state.currentId) this.ensureLeague(this.state.currentId);
    }
    return OK;
  }

  /** The user's "my team" pick for a saved league (null clears it). */
  async saveMyTeam(id: string, teamId: string | null, source: MyTeamPickSource = "you"): Promise<SaveResult> {
    const pick: MyTeamPick | undefined = teamId ? { teamId, source } : undefined;
    const out = await this.write({
      keys: [`picks:${id}`],
      optimistic: (s) => ({ ...s, picks: withMap(s.picks, id, pick) }),
      run: async (tx) => {
        if (!checkSavedLeague(await tx.get("leagues", id))) return false;
        if (pick) await tx.put("picks", { id, pick });
        else await tx.delete("picks", id);
        return true;
      },
      commit: (s, saved, settled) => (settled(`picks:${id}`) ? { ...s, picks: withMap(s.picks, id, saved ? pick : undefined) } : s),
    });
    if (!out.ok) return { ok: false, message: out.message ?? PICK_SAVE_FAILED };
    return out.value ? OK : { ok: false, message: LEAGUE_NOT_SAVED };
  }

  /**
   * Changes a league's settings: `change` runs on the page's copy at once, then on the stored copy (keep it pure), and
   * the result is normalized (engine/settings.ts). Any leagueKey, saved league or not (settings outlive imports).
   */
  async updateSettings(key: string, change: (current: TradeSettings) => TradeSettings): Promise<SaveResult> {
    if (!isLeagueKey(key)) return { ok: false, message: SETTINGS_SAVE_FAILED };
    const out = await this.write({
      keys: [`settings:${key}`],
      optimistic: (s) => ({ ...s, settings: withMap(s.settings, key, normalizeTradeSettings(change(s.settings.get(key) ?? defaultTradeSettings()))) }),
      run: async (tx) => {
        const next = normalizeTradeSettings(change(settingsOfRow(await tx.get("settings", key), key) ?? defaultTradeSettings()));
        await tx.put("settings", { leagueKey: key, settings: next });
        return next;
      },
      commit: (s, next, settled) => (settled(`settings:${key}`) ? { ...s, settings: withMap(s.settings, key, next) } : s),
    });
    return out.ok ? OK : { ok: false, message: out.message ?? SETTINGS_SAVE_FAILED };
  }

  /** "Reset to defaults": the league's saved settings go, so later changes to the defaults reach it. */
  async resetSettings(key: string): Promise<SaveResult> {
    const out = await this.write({
      keys: [`settings:${key}`],
      optimistic: (s) => ({ ...s, settings: withMap(s.settings, key, undefined) }),
      run: (tx) => tx.delete("settings", key),
      commit: (s, _v, settled) => (settled(`settings:${key}`) ? { ...s, settings: withMap(s.settings, key, undefined) } : s),
    });
    return out.ok ? OK : { ok: false, message: out.message ?? SETTINGS_SAVE_FAILED };
  }

  /** One press of a card's outcome or Report button (feedbackStore.ts applyFeedback on that league's list). */
  async saveFeedback(args: { leagueKey: string; evaluation: FeedbackEvaluation; change: FeedbackChange; at: string }): Promise<SaveResult> {
    const key = args.leagueKey;
    const out = await this.write({
      keys: [`feedback:${key}`],
      optimistic: (s) => ({ ...s, feedback: withMap(s.feedback, key, nonEmpty(applyFeedback(s.feedback.get(key) ?? [], args))) }),
      run: async (tx) => {
        const next = applyFeedback(feedbackOfRow(await tx.get("feedback", key), key), args);
        if (next.length) await tx.put("feedback", { leagueKey: key, records: next });
        else await tx.delete("feedback", key);
        return next;
      },
      commit: (s, next, settled) => (settled(`feedback:${key}`) ? { ...s, feedback: withMap(s.feedback, key, nonEmpty(next)) } : s),
    });
    return out.ok ? OK : { ok: false, message: out.message ?? FEEDBACK_SAVE_FAILED };
  }

  /** Deletes one league's feedback (`key`) or every league's, and the old pre-4c copies. */
  async clearFeedback(key?: string): Promise<SaveResult> {
    const keys = key === undefined ? [...this.state.feedback.keys()].map((k) => `feedback:${k}`) : [`feedback:${key}`];
    const out = await this.write({
      keys,
      run: (tx) => (key === undefined ? tx.clear("feedback") : tx.delete("feedback", key)),
      commit: (s) => ({ ...s, feedback: key === undefined ? new Map() : withMap(s.feedback, key, undefined) }),
    });
    if (!out.ok) return { ok: false, message: out.message ?? FEEDBACK_DELETE_FAILED };
    forgetLegacyFeedback(this.env.local(), key);
    return OK;
  }

  /**
   * Keeps a model response (POST /api/model/…, after modelStore.ts withImportedTeam) for a saved league: modelStore.ts's
   * replace rule against the import stored right now (snapshotOrder): older league data stores nothing; newer
   * replaces the import (its request kept, "my team" by pickAfterImport) and stores the inputs; the same stores the inputs.
   */
  async keepModelResponse(id: string, args: { response: ModelResponse; savedAt: string }): Promise<{ importSaved: boolean; modelSaved: boolean }> {
    const snap = args.response.import.snapshot;
    const out = await this.write({
      keys: [`leagues:${id}`, `imports:${id}`, `picks:${id}`],
      run: async (tx) => {
        const current = loadedImportOf(await tx.get("imports", id), id);
        if (current.kind !== "ok" || savedLeagueId(snap) !== id) return null;
        const order = snapshotOrder(current.stored.response.snapshot.fetchedAt, snap.fetchedAt);
        if (order === "older") return null;
        let replaced: { stored: StoredImport; league: SavedLeague; pick: MyTeamPick | undefined } | null = null;
        if (order === "newer") {
          const stored = toStoredImport({ request: current.stored.request, response: args.response.import, savedAt: args.savedAt });
          const prev = checkSavedLeague(await tx.get("leagues", id));
          const existing = pickOfRow(await tx.get("picks", id), id);
          const change = pickAfterImport(snap, existing);
          const league = savedLeagueOf(stored, prev?.lastUsedAt ?? args.savedAt);
          await tx.put("imports", { id, stored });
          await tx.put("leagues", league);
          if (change.kind === "clear") await tx.delete("picks", id);
          replaced = { stored, league, pick: change.kind === "clear" ? undefined : existing };
        }
        const model: StoredModel = { version: 1, savedAt: args.savedAt, key: modelKey(snap), snapshotFetchedAt: snap.fetchedAt, model: args.response.model };
        await tx.put("models", { id, model });
        return { replaced, model };
      },
      commit: (s, r, settled) => {
        if (!r) return s;
        let next: LeagueStoreState = { ...s, models: withMap(s.models, id, r.model) };
        if (r.replaced) {
          const { stored, league, pick } = r.replaced;
          next = {
            ...next,
            leagues: sortSavedLeagues([...s.leagues.filter((l) => l.id !== id), league]),
            imports: withMap(s.imports, id, { kind: "ok", stored }),
            picks: settled(`picks:${id}`) ? withMap(s.picks, id, pick) : s.picks,
          };
        }
        return next;
      },
      ids: [id],
    });
    if (!out.ok || !out.value) return { importSaved: false, modelSaved: false };
    return { importSaved: out.value.replaced !== null, modelSaved: true };
  }

  /** Stops following other tabs and closes the storage (tests; a page never needs it). */
  dispose(): void {
    this.disposed = true;
    this.stopListening?.();
    this.channel?.close();
    this.backend?.close();
    this.listeners.clear();
  }
}

function nonEmpty<T>(list: readonly T[]): readonly T[] | undefined {
  return list.length ? list : undefined;
}

// ---------------------------------------------------------------------------------------------
// 4. The browser's client

function safe<T>(get: () => T): T | undefined {
  try {
    return get();
  } catch {
    return undefined;
  }
}

/** BroadcastChannel, else the storage event on STORE_PING_KEY, else none (other tabs then catch up when reloaded). */
function browserChannel(): CrossTabChannel | undefined {
  if (typeof BroadcastChannel === "function") {
    const channel = safe(() => new BroadcastChannel(STORE_CHANNEL));
    if (channel) {
      return {
        post: (m) => safe(() => channel.postMessage(m)),
        listen: (onMessage) => {
          const on = (e: MessageEvent) => onMessage(e.data);
          channel.addEventListener("message", on);
          return () => channel.removeEventListener("message", on);
        },
        close: () => channel.close(),
      };
    }
  }
  const local = safe(() => window.localStorage);
  if (!local) return undefined;
  let sent = 0;
  return {
    // A new value every time, so the other tabs' storage event fires even for the same message.
    post: (m) => safe(() => local.setItem(STORE_PING_KEY, JSON.stringify({ ...m, n: ++sent, at: Date.now() }))),
    listen: (onMessage) => {
      const on = (e: StorageEvent) => {
        if (e.key !== STORE_PING_KEY || !e.newValue) return;
        const data = safe(() => JSON.parse(e.newValue as string) as unknown);
        if (data !== undefined) onMessage(data);
      };
      window.addEventListener("storage", on);
      return () => window.removeEventListener("storage", on);
    },
    close: () => {},
  };
}

function browserEnv(): LeagueStoreEnv {
  return {
    indexedDB: () => safe(() => (typeof indexedDB === "undefined" ? undefined : indexedDB)) ?? undefined,
    session: () => safe(() => window.sessionStorage),
    local: () => safe(() => window.localStorage),
    channel: browserChannel,
    now: () => new Date().toISOString(),
  };
}

let browserClient: LeagueStoreClient | null = null;

/** The browser's client (one per page load); null on the server. */
export function leagueStore(): LeagueStoreClient | null {
  if (typeof window === "undefined") return null;
  browserClient ??= new LeagueStoreClient(browserEnv());
  return browserClient;
}

const noSubscribe = () => () => {};
const loadingState = () => LOADING_STATE;

/**
 * The store's state for the pages' hooks (useLeagueInputs.ts, useLeagueSettings.ts, useFeedback.ts): LOADING_STATE on
 * the server and while the page hydrates, then the store's, re-rendering on every change (this tab's or another's).
 * Tests of the pages mock this one function (with leagueStoreStateOf).
 */
export function useLeagueStoreState(): LeagueStoreState {
  const client = leagueStore();
  return useSyncExternalStore(client?.subscribe ?? noSubscribe, client?.getState ?? loadingState, loadingState);
}

const noBrowser = { ok: false as const, message: NO_BROWSER_STORE };

/** Saves an import in this browser (LeagueStoreClient.saveImport). */
export function saveLeagueImport(args: SaveImportArgs): Promise<SaveImportResult> {
  return leagueStore()?.saveImport(args) ?? Promise.resolve(noBrowser);
}

/** Shows a saved league in this tab (LeagueStoreClient.selectLeague). */
export function selectLeague(id: string): Promise<SaveResult> {
  return leagueStore()?.selectLeague(id) ?? Promise.resolve(noBrowser);
}

/** Removes a saved league and what belongs to it (LeagueStoreClient.removeLeague; the page confirms first). */
export function removeLeague(id: string): Promise<SaveResult> {
  return leagueStore()?.removeLeague(id) ?? Promise.resolve(noBrowser);
}

/** The user's "my team" pick for a saved league (LeagueStoreClient.saveMyTeam). */
export function saveMyTeamPick(id: string, teamId: string | null, source: MyTeamPickSource = "you"): Promise<SaveResult> {
  return leagueStore()?.saveMyTeam(id, teamId, source) ?? Promise.resolve(noBrowser);
}
