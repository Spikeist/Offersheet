/**
 * The league store (planner reply to Checkpoint 4b, change 11; src/lib/leagueStore.ts): the pure rules (keys, row checks,
 * the switcher's order, which league a tab shows, the pre-4c storage, the selectors), both backends against one
 * contract (IndexedDB on fake-indexeddb, and memory), and the client end to end: a fresh browser, the migration of the
 * pre-4c storage (once, in two tabs at once, never losing or duplicating anything, never bringing back a removed league),
 * saving, switching (per tab, the last league used for a new tab), removing, settings and feedback (at once on the
 * page, then stored, cross-tab), model responses, a browser that refuses writes, and a browser without IndexedDB. Each
 * test gets its own fake browser (a new IDBFactory); every league id, name and team id is made up.
 */
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueSnapshot } from "@/engine/model";
import { defaultTradeSettings, type TradeSettings } from "@/engine/settings";
import type { AcceptanceFeatures } from "@/engine/tradeModel";
import type { ModelResponse } from "./api";
import { FEEDBACK_SAVE_FAILED, FEEDBACK_STORAGE_KEY, applyFeedback, type FeedbackEvaluation, type FeedbackRecord } from "./feedbackStore";
import { IMPORT_FORMAT_VERSION, IMPORT_STORAGE_KEY, myTeamKey, type ImportRequestSummary, type StorageLike, type StoredImport } from "./importStore";
import {
  IMPORT_SAVE_FAILED,
  LEAGUE_NOT_SAVED,
  LOADING_STATE,
  STORAGE_MEMORY_ONLY,
  STORAGE_UPDATED_ELSEWHERE,
  TAB_LEAGUE_KEY,
  TAB_MIGRATED_KEY,
  LEAGUE_DB_NAME,
  LeagueStoreClient,
  checkSavedLeague,
  chooseCurrentLeague,
  createMemoryBackend,
  currentLeagueRead,
  feedbackRecordsOf,
  forgetLegacyFeedback,
  forgetLegacyLeague,
  importRequestOf,
  lastUsedLeague,
  leagueKeyOfSavedId,
  leagueStoreStateOf,
  loadedImportOf,
  migrationDue,
  openIndexedDbBackend,
  parseStoreMessage,
  readLegacyStorage,
  savedFeedbackRead,
  savedLeagueId,
  savedLeagueOf,
  savedLeaguesRead,
  savedSettingsRead,
  sortSavedLeagues,
  type CrossTabChannel,
  type LeagueStoreBackend,
  type LeagueStoreEnv,
  type LeagueStoreName,
  type SavedLeague,
  type StoreMessage,
} from "./leagueStore";
import { MODEL_STORAGE_KEY, modelKey, type StoredModel } from "./modelStore";
import { SETTINGS_SAVE_FAILED, SETTINGS_STORAGE_KEY, leagueKey } from "./settingsStore";

// ---------------------------------------------------------------------------------------------
// Fixtures

/** A browser Storage: listable keys (length, key) like sessionStorage and localStorage. */
class MemoryStorage implements StorageLike {
  values = new Map<string, string>();
  get length(): number {
    return this.values.size;
  }
  key(i: number): string | null {
    return [...this.values.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.values.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.values.set(k, v);
  }
  removeItem(k: string): void {
    this.values.delete(k);
  }
}

class BlockedStorage implements StorageLike {
  getItem(): string | null {
    throw new DOMException("The operation is insecure.", "SecurityError");
  }
  setItem(): void {
    throw new DOMException("The operation is insecure.", "SecurityError");
  }
  removeItem(): void {
    throw new DOMException("The operation is insecure.", "SecurityError");
  }
}

function snap(over: { platform?: "espn" | "sleeper"; leagueId?: string; season?: number; name?: string; fetchedAt?: string; myTeamId?: string | null } = {}): LeagueSnapshot {
  return {
    platform: over.platform ?? "espn",
    leagueId: over.leagueId ?? "4242",
    season: over.season ?? 2026,
    name: over.name ?? "Fictional League",
    fetchedAt: over.fetchedAt ?? "2026-10-04T10:00:00.000Z",
    myTeamId: over.myTeamId ?? null,
    teams: [{ id: "1" }, { id: "2" }, { id: "3" }],
    settings: {},
    players: {},
    schedule: [],
    transactions: [],
    freeAgents: [],
    warnings: [],
  } as unknown as LeagueSnapshot;
}

/** The same league with some fields changed (a later fetch, another season, the platform knowing my team). */
const like = (s: LeagueSnapshot, over: Partial<LeagueSnapshot>) => ({ ...s, ...over }) as LeagueSnapshot;

function imported(s: LeagueSnapshot, savedAt = "2026-10-04T10:00:05.000Z", request: Partial<ImportRequestSummary> = {}): StoredImport {
  return { version: IMPORT_FORMAT_VERSION, savedAt, request: { platform: s.platform, season: s.season, leagueId: s.leagueId, ...request }, response: { snapshot: s, notes: [] } };
}

function inputs(builtAt: string): ModelInputs {
  return { version: 1, season: 2026, currentWeek: 5, lastWeek: 17, builtAt, nfl: { byeWeek: {}, kickoffs: {} }, players: {}, espnProjections: false, market: null, sources: [], warnings: [], notes: [] } as unknown as ModelInputs;
}

function storedModel(s: LeagueSnapshot, builtAt = "2026-10-04T10:01:00.000Z"): StoredModel {
  return { version: 1, savedAt: builtAt, key: modelKey(s), snapshotFetchedAt: s.fetchedAt, model: inputs(builtAt) };
}

const FEATURES: AcceptanceFeatures = { g: 0.05, n: 0.4, h: 0, c: 0, a: 1, hist: null, ctx: 0, hot: 0, urg: 0, z: 0.2 };

function evaluation(key: string): FeedbackEvaluation {
  return {
    key,
    proposal: { partnerId: "2", give: [{ kind: "player", id: "101" }], get: [{ kind: "player", id: "202" }] },
    features: FEATURES,
    b: 3,
    tradeScore: 39,
    pAccept: 0.4,
    pComplete: 0.4,
    overall: 18,
    dPO: 0.03,
    dCH: 0.02,
    dPPW: 1.5,
    gMine: 0.01,
    gPartner: 0.05,
  };
}

const record = (leagueKeyOf: string, tradeKey: string, at: string): FeedbackRecord =>
  applyFeedback([], { leagueKey: leagueKeyOf, evaluation: evaluation(tradeKey), change: { outcome: "sent" }, at })[0] as FeedbackRecord;

const A = snap({ leagueId: "4242", name: "Alpha League" });
const B = snap({ platform: "sleeper", leagueId: "123456789012345678", name: "Bravo League" });
const C = snap({ leagueId: "5151", name: "Charlie League" });
const idA = savedLeagueId(A);
const idB = savedLeagueId(B);
const idC = savedLeagueId(C);
const mine: TradeSettings = { ...defaultTradeSettings(), untouchables: ["4046"], maxPerSide: 3 };

/** Lets timers and fake-indexeddb's queued work run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Tabs of one browser: BroadcastChannel delivers to every other tab, a moment later. */
function hub(): () => CrossTabChannel {
  const listeners = new Set<(data: unknown) => void>();
  return () => {
    const own = new Set<(data: unknown) => void>();
    return {
      post(message: StoreMessage) {
        for (const l of listeners) if (!own.has(l)) setTimeout(() => l(structuredClone(message)), 0);
      },
      listen(onMessage) {
        listeners.add(onMessage);
        own.add(onMessage);
        return () => {
          listeners.delete(onMessage);
          own.delete(onMessage);
        };
      },
      close() {
        for (const l of own) listeners.delete(l);
      },
    };
  };
}

/** A fake browser: one IndexedDB, one localStorage, one BroadcastChannel; tabs (clients) each with their own sessionStorage. */
function browser(opts: { indexedDB?: IDBFactory | null; local?: StorageLike } = {}) {
  const factory = opts.indexedDB === null ? undefined : (opts.indexedDB ?? new IDBFactory());
  const local = opts.local ?? new MemoryStorage();
  const channel = hub();
  let clock = Date.parse("2026-10-04T12:00:00.000Z");
  const clients: LeagueStoreClient[] = [];
  const tab = (session: StorageLike = new MemoryStorage(), over: Partial<LeagueStoreEnv> = {}) => {
    const env: LeagueStoreEnv = {
      indexedDB: () => factory,
      session: () => session,
      local: () => local,
      channel,
      now: () => new Date((clock += 1000)).toISOString(),
      ...over,
    };
    const client = new LeagueStoreClient(env);
    clients.push(client);
    return { client, session };
  };
  return { factory, local, tab, clients };
}

const open: LeagueStoreClient[][] = [];
afterEach(() => {
  for (const list of open.splice(0)) for (const c of list) c.dispose();
});

function newBrowser(opts: Parameters<typeof browser>[0] = {}) {
  const b = browser(opts);
  open.push(b.clients);
  return b;
}

/** A pre-4c tab: its import, model inputs and pick in sessionStorage. */
function oldTab(stored: StoredImport, extra: { model?: StoredModel; pick?: string } = {}): MemoryStorage {
  const s = new MemoryStorage();
  s.setItem(IMPORT_STORAGE_KEY, JSON.stringify(stored));
  if (extra.model) s.setItem(MODEL_STORAGE_KEY, JSON.stringify(extra.model));
  if (extra.pick) s.setItem(myTeamKey(stored.response.snapshot), JSON.stringify({ teamId: extra.pick, source: "you" }));
  return s;
}

/** Reads one store's rows straight from a fake browser's IndexedDB. */
async function rowsOf(factory: IDBFactory, store: string): Promise<unknown[]> {
  const backend = await openIndexedDbBackend(factory);
  try {
    return await backend.run("readonly", (tx) => tx.getAll(store as LeagueStoreName));
  } finally {
    backend.close();
  }
}

/**
 * A backend whose writes, or reads' answers, wait until released: another tab's refresh can land mid-write. Tabs given
 * the same one share its storage (one browser).
 */
function gated() {
  const inner = createMemoryBackend();
  const control = { holdWrites: false, holdReads: false, releaseWrite: () => {}, releaseRead: () => {} };
  const backend: LeagueStoreBackend = {
    kind: "memory",
    run<T>(mode: "readonly" | "readwrite", fn: Parameters<LeagueStoreBackend["run"]>[1]): Promise<T> {
      const go = () => inner.run(mode, fn) as Promise<T>;
      if (mode === "readwrite" && control.holdWrites) return new Promise<T>((resolve, reject) => (control.releaseWrite = () => void go().then(resolve, reject)));
      if (mode === "readonly" && control.holdReads) return go().then((v) => new Promise<T>((resolve) => (control.releaseRead = () => resolve(v))));
      return go();
    },
    close: () => inner.close(),
  };
  return { backend, control };
}

// ---------------------------------------------------------------------------------------------
// 1. Pure

describe("keys and rows", () => {
  it("names a saved league by its leagueKey and season, never the raw league id", () => {
    expect(idA).toBe(`${leagueKey(A)}:2026`);
    expect(idA).toMatch(/^espn:[0-9a-f]{8}:2026$/);
    expect(idA).not.toContain(A.leagueId);
    expect(savedLeagueId({ ...A, season: 2025 })).not.toBe(idA);
    expect(leagueKeyOfSavedId(idA)).toBe(leagueKey(A));
    expect(leagueKeyOfSavedId("espn:4242:2026")).toBeNull();
    expect(leagueKeyOfSavedId(leagueKey(A))).toBeNull();
  });

  it("checks a leagues row: its id must be its leagueKey and season, every field the right kind", () => {
    const row = savedLeagueOf(imported(A), "2026-10-04T11:00:00.000Z");
    expect(row).toEqual({ id: idA, leagueKey: leagueKey(A), platform: "espn", season: 2026, name: "Alpha League", savedAt: "2026-10-04T10:00:05.000Z", lastUsedAt: "2026-10-04T11:00:00.000Z" });
    expect(checkSavedLeague(row)).toEqual(row);
    for (const bad of [null, [], { ...row, id: idB }, { ...row, platform: "nfl" }, { ...row, season: "2026" }, { ...row, name: 7 }, { ...row, leagueKey: "espn:4242" }, { ...row, platform: "sleeper" }]) {
      expect(checkSavedLeague(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("orders the switcher by name (ignoring case), then the newest season, platform and id", () => {
    const l = (name: string, season: number, platform: "espn" | "sleeper" = "espn", leagueId = "1") => savedLeagueOf(imported(snap({ name, season, platform, leagueId })), "2026-10-04T00:00:00.000Z");
    const list = [l("bravo", 2026), l("Alpha", 2025), l("alpha", 2026, "sleeper"), l("alpha", 2026, "espn", "2")];
    expect(sortSavedLeagues(list).map((x) => `${x.name}/${x.season}/${x.platform}`)).toEqual(["alpha/2026/espn", "alpha/2026/sleeper", "Alpha/2025/espn", "bravo/2026/espn"]);
  });

  it("opens a tab on its own choice while that league is saved, else on the league used last", () => {
    const leagues: SavedLeague[] = [savedLeagueOf(imported(A), "2026-10-02T00:00:00.000Z"), savedLeagueOf(imported(B), "2026-10-03T00:00:00.000Z"), savedLeagueOf(imported(C), "2026-10-01T00:00:00.000Z")];
    expect(lastUsedLeague(leagues)).toBe(idB);
    expect(chooseCurrentLeague(leagues, idC)).toBe(idC);
    expect(chooseCurrentLeague(leagues, "espn:00000000:2026")).toBe(idB);
    expect(chooseCurrentLeague(leagues, null)).toBe(idB);
    expect(chooseCurrentLeague([], idA)).toBeNull();
    // A time that can't be read never counts as later; ties go to the smaller id.
    const odd = [{ ...leagues[0], lastUsedAt: "whenever" } as SavedLeague, { ...leagues[2], lastUsedAt: "2026-10-01T00:00:00.000Z" } as SavedLeague];
    expect(lastUsedLeague(odd)).toBe(idC);
    const tie = [{ ...leagues[1], lastUsedAt: "2026-10-01T00:00:00.000Z" } as SavedLeague, leagues[2] as SavedLeague];
    expect(lastUsedLeague(tie)).toBe([idB, idC].sort()[0]);
  });

  it("reads an import record's request summary (to import it again), also from an earlier version, never anything else", () => {
    expect(importRequestOf(imported(A))).toEqual({ platform: "espn", season: 2026, leagueId: "4242" });
    // A Sleeper username import: the league id comes from the snapshot; the username stays.
    const byName = { ...imported(B, undefined, { leagueId: undefined, username: "zorblax_q" }), version: 1 };
    expect(importRequestOf(byName)).toEqual({ platform: "sleeper", season: 2026, leagueId: B.leagueId, username: "zorblax_q" });
    // Extra fields (anything a request might wrongly carry) are dropped.
    expect(importRequestOf({ ...imported(A), request: { platform: "espn", season: 2026, leagueId: "4242", espnS2: "secret" } })).toEqual({ platform: "espn", season: 2026, leagueId: "4242" });
    for (const bad of [null, "x", {}, { request: { platform: "nfl", season: 2026, leagueId: "1" } }, { request: { platform: "espn", season: "2026", leagueId: "1" } }, { request: { platform: "espn", season: 2026 } }]) {
      expect(importRequestOf(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("reads an imports row as readable only in this format and for its own league", () => {
    expect(loadedImportOf({ id: idA, stored: imported(A) }, idA)).toEqual({ kind: "ok", stored: imported(A) });
    expect(loadedImportOf({ id: idA, stored: { ...imported(A), version: 2 } }, idA)).toEqual({ kind: "outdated", request: { platform: "espn", season: 2026, leagueId: "4242" } });
    expect(loadedImportOf({ id: idB, stored: imported(A) }, idB).kind).toBe("outdated");
    expect(loadedImportOf(undefined, idA)).toEqual({ kind: "outdated", request: null });
  });

  it("reads only well-formed messages from other tabs", () => {
    expect(parseStoreMessage({ v: 1, ids: [idA, 7] })).toEqual({ v: 1, ids: [idA] });
    for (const bad of [null, {}, { v: 2, ids: [] }, { v: 1, ids: "x" }]) expect(parseStoreMessage(bad)).toBeNull();
  });
});

describe("the pre-4c storage", () => {
  it("reads the tab's import with its model inputs and every pick, and the browser's settings and feedback", () => {
    const session = oldTab(imported(A), { model: storedModel(A), pick: "2" });
    session.setItem(myTeamKey(C), JSON.stringify({ teamId: "3", source: "link" }));
    session.setItem("unrelated", "x");
    const local = new MemoryStorage();
    local.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ [leagueKey(A)]: mine, [leagueKey(C)]: defaultTradeSettings() }));
    local.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify([record(leagueKey(A), "t1", "2026-10-01T00:00:00.000Z")]));
    const legacy = readLegacyStorage(session, local);
    expect(legacy.tabImport).toEqual({ kind: "ok", stored: imported(A) });
    expect(legacy.tabModel).toEqual(storedModel(A));
    expect([...legacy.tabPicks]).toEqual(expect.arrayContaining([[idA, { teamId: "2", source: "you" }], [idC, { teamId: "3", source: "link" }]]));
    expect(legacy.tabPicks.size).toBe(2);
    expect(legacy.settings[leagueKey(A)]).toEqual(mine);
    expect(legacy.feedback).toHaveLength(1);
    expect(legacy).toMatchObject({ tabDone: false, localReadable: true, tabOutdatedRequest: null });
  });

  it("keeps model inputs only when they're for the tab's league, and the tab's own pick even where keys can't be listed", () => {
    const s = oldTab(imported(A), { model: storedModel(B), pick: "1" });
    const unlisted: StorageLike = { getItem: (k) => s.getItem(k), setItem: (k, v) => s.setItem(k, v), removeItem: (k) => s.removeItem(k) };
    const legacy = readLegacyStorage(unlisted, undefined);
    expect(legacy.tabModel).toBeUndefined();
    expect([...legacy.tabPicks]).toEqual([[idA, { teamId: "1", source: "you" }]]);
    expect(legacy.localReadable).toBe(false);
  });

  it("tells an earlier version's import apart (with its request), and reads a blocked storage as nothing", () => {
    const old = new MemoryStorage();
    old.setItem(IMPORT_STORAGE_KEY, JSON.stringify({ ...imported(A), version: 1 }));
    expect(readLegacyStorage(old, undefined)).toMatchObject({ tabImport: { kind: "outdated" }, tabOutdatedRequest: { platform: "espn", season: 2026, leagueId: "4242" } });
    const blocked = readLegacyStorage(new BlockedStorage(), new BlockedStorage());
    expect(blocked).toMatchObject({ tabImport: { kind: "none" }, tabModel: undefined, tabDone: false, settings: {}, feedback: [], localReadable: false });
    expect(blocked.tabPicks.size).toBe(0);
  });

  it("says when a migration is due: the browser-wide part once (with a readable localStorage), a tab's part while it holds something", () => {
    const empty = readLegacyStorage(new MemoryStorage(), new MemoryStorage());
    expect(migrationDue(null, empty)).toBe(true);
    expect(migrationDue("2026-10-04T00:00:00.000Z", empty)).toBe(false);
    expect(migrationDue(null, readLegacyStorage(new MemoryStorage(), undefined))).toBe(false);
    const tab = readLegacyStorage(oldTab(imported(A)), new MemoryStorage());
    expect(migrationDue("2026-10-04T00:00:00.000Z", tab)).toBe(true);
    const done = oldTab(imported(A));
    done.setItem(TAB_MIGRATED_KEY, "1");
    expect(migrationDue("2026-10-04T00:00:00.000Z", readLegacyStorage(done, new MemoryStorage()))).toBe(false);
  });

  it("forgets a removed league's old copies and nothing else, other entries byte for byte", () => {
    const session = oldTab(imported(A), { model: storedModel(A), pick: "2" });
    session.setItem(myTeamKey(C), "3");
    const local = new MemoryStorage();
    const settingsRaw = `{"${leagueKey(A)}":{"playoffWeight":1.5},"${leagueKey(C)}":{"untouchables":["9"],"futureField":1}}`;
    local.setItem(SETTINGS_STORAGE_KEY, settingsRaw);
    const keep = record(leagueKey(C), "t2", "2026-10-02T00:00:00.000Z");
    local.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify([record(leagueKey(A), "t1", "2026-10-01T00:00:00.000Z"), keep]));
    forgetLegacyLeague(session, local, A, { leagueKey: leagueKey(A), withSettingsAndFeedback: true });
    expect(session.getItem(IMPORT_STORAGE_KEY)).toBeNull();
    expect(session.getItem(MODEL_STORAGE_KEY)).toBeNull();
    expect(session.getItem(myTeamKey(A))).toBeNull();
    expect(session.getItem(myTeamKey(C))).toBe("3");
    expect(local.getItem(SETTINGS_STORAGE_KEY)).toBe(`{"${leagueKey(C)}":{"untouchables":["9"],"futureField":1}}`);
    expect(JSON.parse(local.getItem(FEEDBACK_STORAGE_KEY) ?? "[]")).toEqual([keep]);
    // Another season shares the settings and feedback: they stay. The tab's import of another league stays.
    const other = oldTab(imported(C));
    forgetLegacyLeague(other, local, A, { leagueKey: leagueKey(C), withSettingsAndFeedback: false });
    expect(other.getItem(IMPORT_STORAGE_KEY)).not.toBeNull();
    expect(local.getItem(SETTINGS_STORAGE_KEY)).not.toBeNull();
    forgetLegacyFeedback(local, leagueKey(C));
    expect(local.getItem(FEEDBACK_STORAGE_KEY)).toBeNull();
    local.setItem(FEEDBACK_STORAGE_KEY, "[]");
    forgetLegacyFeedback(local);
    expect(local.getItem(FEEDBACK_STORAGE_KEY)).toBeNull();
    expect(() => forgetLegacyLeague(new BlockedStorage(), new BlockedStorage(), A, { leagueKey: leagueKey(A), withSettingsAndFeedback: true })).not.toThrow();
  });
});

describe("the selectors the hooks use", () => {
  it("never reads a league while loading, then the league, none, or an earlier version's import", () => {
    expect(currentLeagueRead(LOADING_STATE)).toBeUndefined();
    expect(savedLeaguesRead(LOADING_STATE)).toBeUndefined();
    expect(savedSettingsRead(LOADING_STATE, leagueKey(A))).toBeUndefined();
    expect(savedFeedbackRead(LOADING_STATE)).toBeUndefined();
    const ready = leagueStoreStateOf({ imports: [imported(A), imported(B)], picks: { [idA]: { teamId: "2", source: "you" } }, settings: { [leagueKey(A)]: mine } });
    expect(currentLeagueRead(ready)).toMatchObject({ kind: "ok", league: { id: idA, name: "Alpha League" }, stored: imported(A), pick: { teamId: "2" } });
    expect(savedLeaguesRead(ready)?.leagues.map((l) => l.id)).toEqual([idA, idB]);
    expect(savedSettingsRead(ready, leagueKey(A))).toEqual({ settings: mine, stored: true });
    expect(savedSettingsRead(ready, leagueKey(B))).toEqual({ settings: defaultTradeSettings(), stored: false });
    expect(currentLeagueRead(leagueStoreStateOf({}))).toEqual({ kind: "none" });
    expect(currentLeagueRead(leagueStoreStateOf({ outdatedTabImport: { request: null } }))).toEqual({ kind: "outdated", league: null, request: null });
    // The current league's import not read yet: still loading.
    expect(currentLeagueRead({ ...ready, imports: new Map() })).toBeUndefined();
    expect(currentLeagueRead({ ...ready, imports: new Map([[idA, { kind: "outdated", request: null }]]) })).toMatchObject({ kind: "outdated", league: { id: idA } });
  });

  it("gives one league's feedback, or every league's from the least to the most recently pressed", () => {
    const r1 = record(leagueKey(A), "t1", "2026-10-03T00:00:00.000Z");
    const r2 = record(leagueKey(B), "t2", "2026-10-01T00:00:00.000Z");
    const r3 = record(leagueKey(A), "t3", "2026-10-02T00:00:00.000Z");
    const state = leagueStoreStateOf({ feedback: [r1, r2, r3] });
    expect(feedbackRecordsOf(state.feedback, leagueKey(A))).toEqual([r1, r3]);
    expect(feedbackRecordsOf(state.feedback).map((r) => r.tradeKey)).toEqual(["t2", "t3", "t1"]);
    expect(feedbackRecordsOf(state.feedback, "espn:00000000")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Backends

describe.each([
  ["IndexedDB (fake-indexeddb)", () => openIndexedDbBackend(new IDBFactory())],
  ["memory", async () => createMemoryBackend()],
] as const)("the %s backend", (_name, make) => {
  let backend: LeagueStoreBackend;
  afterEach(() => backend.close());

  it("round-trips rows, lists them in key order, deletes and clears them", async () => {
    backend = await make();
    await backend.run("readwrite", async (tx) => {
      await tx.put("settings", { leagueKey: "sleeper:00000002", settings: mine });
      await tx.put("settings", { leagueKey: "espn:00000001", settings: mine });
      await tx.put("meta", { key: "migration", value: "now" });
    });
    expect(await backend.run("readonly", (tx) => tx.get("settings", "espn:00000001"))).toEqual({ leagueKey: "espn:00000001", settings: mine });
    expect((await backend.run("readonly", (tx) => tx.getAll("settings"))).map((r) => (r as { leagueKey: string }).leagueKey)).toEqual(["espn:00000001", "sleeper:00000002"]);
    expect(await backend.run("readonly", (tx) => tx.get("settings", "nope"))).toBeUndefined();
    await backend.run("readwrite", async (tx) => {
      await tx.delete("settings", "espn:00000001");
      await tx.clear("meta");
    });
    expect(await backend.run("readonly", (tx) => tx.getAll("settings"))).toHaveLength(1);
    expect(await backend.run("readonly", (tx) => tx.getAll("meta"))).toEqual([]);
  });

  it("hands out copies: changing what a read returned changes nothing stored", async () => {
    backend = await make();
    const row = { leagueKey: "espn:00000001", settings: { ...mine, untouchables: ["1"] } };
    await backend.run("readwrite", (tx) => tx.put("settings", row));
    row.settings.untouchables.push("2");
    const read = (await backend.run("readonly", (tx) => tx.get("settings", "espn:00000001"))) as typeof row;
    read.settings.untouchables.push("3");
    expect(((await backend.run("readonly", (tx) => tx.get("settings", "espn:00000001"))) as typeof row).settings.untouchables).toEqual(["1"]);
  });

  it("keeps all of a transaction's writes or none, and refuses writes in a read-only one", async () => {
    backend = await make();
    await expect(
      backend.run("readwrite", async (tx) => {
        await tx.put("meta", { key: "a", value: 1 });
        throw new Error("changed my mind");
      }),
    ).rejects.toThrow("changed my mind");
    expect(await backend.run("readonly", (tx) => tx.getAll("meta"))).toEqual([]);
    await expect(backend.run("readonly", (tx) => tx.put("meta", { key: "a", value: 1 }))).rejects.toThrow();
    await expect(backend.run("readwrite", (tx) => tx.put("meta", { value: 1 }))).rejects.toThrow();
    expect(await backend.run("readonly", (tx) => tx.getAll("meta"))).toEqual([]);
  });

  it("runs read-modify-writes one at a time, so concurrent ones never lose an update", async () => {
    backend = await make();
    const bump = () =>
      backend.run("readwrite", async (tx) => {
        const row = (await tx.get("meta", "count")) as { value: number } | undefined;
        await tx.put("meta", { key: "count", value: (row?.value ?? 0) + 1 });
      });
    await Promise.all(Array.from({ length: 10 }, bump));
    expect(await backend.run("readonly", (tx) => tx.get("meta", "count"))).toEqual({ key: "count", value: 10 });
  });
});

// ---------------------------------------------------------------------------------------------
// 3. The client

describe("a fresh browser", () => {
  it("is loading (never 'no league') until the store is read, then has no league", async () => {
    const { tab, factory } = newBrowser();
    const { client } = tab();
    expect(client.getState()).toBe(LOADING_STATE);
    expect(currentLeagueRead(client.getState())).toBeUndefined();
    await client.start();
    expect(client.getState()).toMatchObject({ status: "ready", storage: { kind: "indexeddb" }, leagues: [], currentId: null });
    expect(currentLeagueRead(client.getState())).toEqual({ kind: "none" });
    // The browser-wide migration ran (nothing to move) and won't again.
    expect(await rowsOf(factory as IDBFactory, "meta")).toEqual([{ key: "migration", value: expect.any(String) }]);
  });

  it("subscribing starts the load, and every change tells the subscribers", async () => {
    const { tab } = newBrowser();
    const { client } = tab();
    let calls = 0;
    const stop = client.subscribe(() => calls++);
    await client.settled();
    expect(calls).toBeGreaterThan(0);
    stop();
    const before = calls;
    await client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: imported(A).savedAt });
    expect(calls).toBe(before);
  });
});

describe("the migration from the pre-4c storage (first load after the update)", () => {
  function preparedBrowser() {
    const b = newBrowser();
    const local = b.local;
    local.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ [leagueKey(A)]: mine, [leagueKey(C)]: { ...defaultTradeSettings(), includeKDefIdp: true } }));
    const feedback = [record(leagueKey(A), "t1", "2026-10-01T00:00:00.000Z"), record(leagueKey(C), "t2", "2026-10-02T00:00:00.000Z"), record(leagueKey(A), "t3", "2026-10-03T00:00:00.000Z")];
    local.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(feedback));
    return { ...b, feedback, settingsRaw: local.getItem(SETTINGS_STORAGE_KEY), feedbackRaw: local.getItem(FEEDBACK_STORAGE_KEY) };
  }

  it("moves the tab's import, its pick and model inputs, every league's settings and all feedback in; the tab shows its league", async () => {
    const b = preparedBrowser();
    const session = oldTab(imported(A), { model: storedModel(A), pick: "2" });
    session.setItem(myTeamKey(C), JSON.stringify({ teamId: "3", source: "you" })); // a pick for a league imported earlier in the tab
    const { client } = b.tab(session);
    await client.start();
    const s = client.getState();
    expect(s.leagues.map((l) => l.id)).toEqual([idA]);
    expect(currentLeagueRead(s)).toMatchObject({ kind: "ok", league: { id: idA, name: "Alpha League" }, stored: imported(A), pick: { teamId: "2", source: "you" } });
    expect(s.models.get(idA)).toEqual(storedModel(A));
    // Settings for both leagues, the one without an import too (it attaches when that league is imported).
    expect(s.settings.get(leagueKey(A))).toEqual(mine);
    expect(s.settings.get(leagueKey(C))).toMatchObject({ includeKDefIdp: true });
    // Feedback, each record to its league, in order.
    expect(feedbackRecordsOf(s.feedback, leagueKey(A)).map((r) => r.tradeKey)).toEqual(["t1", "t3"]);
    expect(feedbackRecordsOf(s.feedback, leagueKey(C))).toEqual([b.feedback[1]]);
    // The old keys are untouched (a dormant copy); the tab is marked and remembers its league.
    expect(b.local.getItem(SETTINGS_STORAGE_KEY)).toBe(b.settingsRaw);
    expect(b.local.getItem(FEEDBACK_STORAGE_KEY)).toBe(b.feedbackRaw);
    expect(session.getItem(IMPORT_STORAGE_KEY)).toBe(JSON.stringify(imported(A)));
    expect(session.getItem(TAB_MIGRATED_KEY)).toBe("1");
    expect(session.getItem(TAB_LEAGUE_KEY)).toBe(idA);
    // The other league's pick waits in the store for that league's import.
    expect(await rowsOf(b.factory as IDBFactory, "picks")).toEqual(expect.arrayContaining([{ id: idC, pick: { teamId: "3", source: "you" } }]));
  });

  it("runs once: a reload, or a new tab, changes nothing and never reads the old keys again", async () => {
    const b = preparedBrowser();
    const session = oldTab(imported(A), { pick: "2" });
    await b.tab(session).client.start();
    const before = await Promise.all(["leagues", "imports", "picks", "settings", "feedback"].map((s) => rowsOf(b.factory as IDBFactory, s)));
    // Something writes the old keys afterwards (an old tab): it isn't moved in.
    b.local.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ [leagueKey(A)]: defaultTradeSettings() }));
    await b.tab(session).client.start(); // the same tab, reloaded
    const fresh = b.tab(); // a new tab
    await fresh.client.start();
    const after = await Promise.all(["leagues", "imports", "picks", "settings", "feedback"].map((s) => rowsOf(b.factory as IDBFactory, s)));
    expect(after).toEqual(before);
    expect(fresh.client.getState().settings.get(leagueKey(A))).toEqual(mine);
    // A new tab opens on the league used last.
    expect(currentLeagueRead(fresh.client.getState())).toMatchObject({ kind: "ok", league: { id: idA } });
  });

  it("is safe in two tabs at once: both tabs' imports kept, settings and feedback moved once", async () => {
    const b = preparedBrowser();
    const one = b.tab(oldTab(imported(A), { pick: "1" }));
    const two = b.tab(oldTab(imported(B), { pick: "3" }));
    await Promise.all([one.client.start(), two.client.start()]);
    await Promise.all([one.client.settled(), two.client.settled()]);
    expect((await rowsOf(b.factory as IDBFactory, "leagues")).map((r) => (r as SavedLeague).id).sort()).toEqual([idA, idB].sort());
    const feedbackRows = (await rowsOf(b.factory as IDBFactory, "feedback")) as { leagueKey: string; records: FeedbackRecord[] }[];
    expect(feedbackRows.flatMap((r) => r.records).map((r) => r.tradeKey).sort()).toEqual(["t1", "t2", "t3"]);
    expect(await rowsOf(b.factory as IDBFactory, "settings")).toHaveLength(2);
    // Each tab shows its own league, and hears of the other's.
    await tick();
    await Promise.all([one.client.settled(), two.client.settled()]);
    expect(one.client.getState().currentId).toBe(idA);
    expect(two.client.getState().currentId).toBe(idB);
    for (const c of [one.client, two.client]) expect(c.getState().leagues.map((l) => l.id).sort()).toEqual([idA, idB].sort());
  });

  it("never replaces a newer saved copy of the league with the tab's older one, but the tab shows that league, its pick filling the league's", async () => {
    const b = newBrowser();
    const newer = imported(like(A, { fetchedAt: "2026-10-04T11:00:00.000Z" }), "2026-10-04T11:00:05.000Z");
    const first = b.tab();
    await first.client.saveImport({ request: newer.request, response: newer.response, savedAt: newer.savedAt });
    await first.client.saveImport({ request: imported(B).request, response: imported(B).response, savedAt: imported(B).savedAt });
    const old = b.tab(oldTab(imported(A), { pick: "3" }));
    await old.client.start();
    expect(currentLeagueRead(old.client.getState())).toMatchObject({ kind: "ok", stored: { response: { snapshot: { fetchedAt: "2026-10-04T11:00:00.000Z" } } } });
    // The user's pick is of the same league's team: it fills the newer copy, which had none (review of track ML).
    expect(old.client.getState().picks.get(idA)).toEqual({ teamId: "3", source: "you" });
    expect(await rowsOf(b.factory as IDBFactory, "picks")).toEqual([{ id: idA, pick: { teamId: "3", source: "you" } }]);
  });

  it("fills a league's pick from a duplicated tab (the same fetch) whichever tab moves in first, and never overrides a pick the store has", async () => {
    // Two pre-4c tabs of the same league (a duplicated tab), the user's pick only in the second: both orders keep it.
    for (const order of ["picker last", "picker first"] as const) {
      const b = newBrowser();
      const plain = b.tab(oldTab(imported(A)));
      const picker = b.tab(oldTab(imported(A), { pick: "3" }));
      const [one, two] = order === "picker last" ? [plain, picker] : [picker, plain];
      await one.client.start();
      await two.client.start();
      expect(await rowsOf(b.factory as IDBFactory, "picks"), order).toEqual([{ id: idA, pick: { teamId: "3", source: "you" } }]);
    }
    // The store's own pick stays.
    const c = newBrowser();
    const now = c.tab();
    await now.client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: imported(A).savedAt });
    await now.client.saveMyTeam(idA, "1");
    const old = c.tab(oldTab(imported(A), { pick: "3" }));
    await old.client.start();
    expect(old.client.getState().picks.get(idA)).toEqual({ teamId: "1", source: "you" });
    // A pasted-link pick (a guess to confirm) doesn't fill a copy that knows the user's team (importStore.ts pickAfterImport).
    const d = newBrowser();
    const known = imported(like(A, { fetchedAt: "2026-10-04T11:00:00.000Z", myTeamId: "2" }), "2026-10-04T11:00:05.000Z");
    await d.tab().client.saveImport({ request: known.request, response: known.response, savedAt: known.savedAt });
    const linked = oldTab(imported(A));
    linked.setItem(myTeamKey(A), JSON.stringify({ teamId: "3", source: "link" }));
    const tab = d.tab(linked);
    await tab.client.start();
    expect(tab.client.getState().picks.get(idA)).toBeUndefined();
  });

  it("brings a Phase 4b tab's pick to its league when that league was imported again elsewhere without one, never over the store's own", async () => {
    const v3 = (s: LeagueSnapshot) => ({ ...imported(s), version: 3 }) as unknown as StoredImport;
    // Imported again in a new tab (the public link: no team known), then the old tab is reloaded.
    const b = newBrowser();
    await b.tab().client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: "2026-10-04T12:30:00.000Z" });
    const old = b.tab(oldTab(v3(A), { pick: "2" }));
    await old.client.start();
    expect(currentLeagueRead(old.client.getState())).toMatchObject({ kind: "ok", league: { id: idA }, pick: { teamId: "2", source: "you" } });
    // The store's own pick stays.
    const c = newBrowser();
    const now = c.tab();
    await now.client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: "2026-10-04T12:30:00.000Z" });
    await now.client.saveMyTeam(idA, "1");
    const other = c.tab(oldTab(v3(A), { pick: "2" }));
    await other.client.start();
    expect(other.client.getState().picks.get(idA)).toEqual({ teamId: "1", source: "you" });
    // A pasted-link pick doesn't fill a saved copy that knows the user's team.
    const d = newBrowser();
    const known = imported(like(A, { myTeamId: "2" }));
    await d.tab().client.saveImport({ request: known.request, response: known.response, savedAt: "2026-10-04T12:30:00.000Z" });
    const linked = oldTab(v3(A));
    linked.setItem(myTeamKey(A), JSON.stringify({ teamId: "3", source: "link" }));
    const tab = d.tab(linked);
    await tab.client.start();
    expect(tab.client.getState().picks.get(idA)).toBeUndefined();
  });

  it("asks for a Phase 4b tab's import again (format 3: its waiver ranks are the live order of its day), keeping its pick for the re-import, its settings and feedback", async () => {
    const b = preparedBrowser();
    const session = oldTab({ ...imported(A), version: 3 } as unknown as StoredImport, { model: storedModel(A), pick: "2" });
    const { client } = b.tab(session);
    await client.start();
    expect(currentLeagueRead(client.getState())).toEqual({ kind: "outdated", league: null, request: { platform: "espn", season: 2026, leagueId: "4242" } });
    expect(client.getState().leagues).toEqual([]);
    expect(client.getState().models.size).toBe(0);
    expect(client.getState().settings.get(leagueKey(A))).toEqual(mine);
    expect(savedFeedbackRead(client.getState(), leagueKey(A))?.map((r) => r.tradeKey)).toEqual(["t1", "t3"]);
    // "Import again": the league comes back with the pick the user made in the old tab; its old model inputs aren't reused.
    expect(await client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: "2026-10-04T13:00:00.000Z" })).toEqual({ ok: true, id: idA });
    expect(currentLeagueRead(client.getState())).toMatchObject({ kind: "ok", league: { id: idA }, pick: { teamId: "2", source: "you" } });
    expect(client.getState().models.get(idA)).toBeNull();
    expect(await rowsOf(b.factory as IDBFactory, "models")).toEqual([]);
  });

  it("keeps the 'Offer Sheet was updated' message for an import from an earlier version, until a league is saved", async () => {
    const b = newBrowser();
    const session = new MemoryStorage();
    session.setItem(IMPORT_STORAGE_KEY, JSON.stringify({ ...imported(A), version: 2 }));
    const { client } = b.tab(session);
    await client.start();
    expect(currentLeagueRead(client.getState())).toEqual({ kind: "outdated", league: null, request: { platform: "espn", season: 2026, leagueId: "4242" } });
    await client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: imported(A).savedAt });
    expect(currentLeagueRead(client.getState())).toMatchObject({ kind: "ok", league: { id: idA } });
  });

  it("never brings back a league removed since, from a tab that still holds an older copy", async () => {
    const b = newBrowser();
    const stale = oldTab(imported(A), { pick: "2" }); // an old tab, not reloaded yet
    const now = b.tab();
    await now.client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: imported(A).savedAt });
    expect(await now.client.removeLeague(idA)).toEqual({ ok: true });
    const reloaded = b.tab(stale);
    await reloaded.client.start();
    expect(reloaded.client.getState().leagues).toEqual([]);
    expect(await rowsOf(b.factory as IDBFactory, "picks")).toEqual([]);
    // Importing it again clears the tombstone.
    await reloaded.client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: "2026-10-04T13:00:00.000Z" });
    expect((await rowsOf(b.factory as IDBFactory, "meta")).some((r) => (r as { key: string }).key === "removed")).toBe(false);
  });
});

describe("saving imports and switching leagues", () => {
  it("saves an import as this tab's league and the league used last; a new tab opens on it", async () => {
    const b = newBrowser();
    const { client, session } = b.tab();
    expect(await client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: imported(A).savedAt })).toEqual({ ok: true, id: idA });
    expect(await client.saveImport({ request: imported(B).request, response: imported(B).response, savedAt: imported(B).savedAt })).toEqual({ ok: true, id: idB });
    expect(client.getState().currentId).toBe(idB);
    expect(session.getItem(TAB_LEAGUE_KEY)).toBe(idB);
    expect(client.getState().leagues.map((l) => l.name)).toEqual(["Alpha League", "Bravo League"]);
    const other = b.tab();
    await other.client.start();
    expect(currentLeagueRead(other.client.getState())).toMatchObject({ kind: "ok", league: { id: idB } });
    // Never credentials: the stored request is the summary alone.
    expect(JSON.stringify(await rowsOf(b.factory as IDBFactory, "imports"))).not.toMatch(/espn_s2|espnS2|swid/i);
  });

  it("keeps a pasted team link as a pick to confirm, keeps the user's pick through a Refresh, and drops a link pick once the platform knows the team", async () => {
    const b = newBrowser();
    const { client } = b.tab();
    await client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: imported(A).savedAt, teamHint: "3" });
    expect(client.getState().picks.get(idA)).toEqual({ teamId: "3", source: "link" });
    expect(await client.saveMyTeam(idA, "2")).toEqual({ ok: true });
    await client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: "2026-10-04T12:30:00.000Z", teamHint: "3" });
    expect(client.getState().picks.get(idA)).toEqual({ teamId: "2", source: "you" });
    await client.saveMyTeam(idA, "1", "link");
    const known = like(A, { myTeamId: "3" });
    await client.saveImport({ request: imported(known).request, response: imported(known).response, savedAt: "2026-10-04T13:00:00.000Z" });
    expect(client.getState().picks.get(idA)).toBeUndefined();
    expect(await client.saveMyTeam(idC, "1")).toEqual({ ok: false, message: LEAGUE_NOT_SAVED });
  });

  it("adds a league without switching to it (a batch of Sleeper leagues), unless the tab shows none yet", async () => {
    const b = newBrowser();
    const { client } = b.tab();
    await client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: imported(A).savedAt, makeCurrent: false });
    expect(client.getState().currentId).toBe(idA);
    await client.saveImport({ request: imported(B).request, response: imported(B).response, savedAt: imported(B).savedAt, makeCurrent: false });
    expect(client.getState().currentId).toBe(idA);
    expect(client.getState().leagues).toHaveLength(2);
  });

  it("counts a league as used only when the tab comes to show it: after a batch, a new tab opens on the league shown (review of track ML)", async () => {
    const b = newBrowser();
    const { client } = b.tab();
    await client.start();
    // SleeperConnect's batch: the first league shown, the next two saved alongside it.
    await client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: imported(A).savedAt });
    await client.saveImport({ request: imported(B).request, response: imported(B).response, savedAt: imported(B).savedAt, makeCurrent: false });
    await client.saveImport({ request: imported(C).request, response: imported(C).response, savedAt: imported(C).savedAt, makeCurrent: false });
    expect(client.getState().currentId).toBe(idA);
    expect(Object.fromEntries(client.getState().leagues.map((l) => [l.id, l.lastUsedAt === ""]))).toEqual({ [idA]: false, [idB]: true, [idC]: true });
    expect(lastUsedLeague(client.getState().leagues)).toBe(idA);
    const fresh = b.tab();
    await fresh.client.start();
    expect(fresh.client.getState().currentId).toBe(idA);
    // Saved alongside again (a Refresh while another league shows), a league keeps the use it had.
    await client.selectLeague(idB);
    const usedB = client.getState().leagues.find((l) => l.id === idB)?.lastUsedAt;
    await client.selectLeague(idA);
    await client.saveImport({ request: imported(B).request, response: imported(B).response, savedAt: "2026-10-04T13:00:00.000Z", makeCurrent: false });
    expect(client.getState().leagues.find((l) => l.id === idB)?.lastUsedAt).toBe(usedB);
    expect(lastUsedLeague(client.getState().leagues)).toBe(idA);
  });

  it("never brings back a league removed while a Refresh was under way (ifSaved), and updates one still saved", async () => {
    const b = newBrowser();
    const { client } = b.tab();
    await client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: imported(A).savedAt });
    await client.saveImport({ request: imported(B).request, response: imported(B).response, savedAt: imported(B).savedAt });
    // A Refresh of A, answered after A was removed (here, or in another tab).
    const later = imported(like(A, { fetchedAt: "2026-10-04T11:00:00.000Z" }), "2026-10-04T11:00:05.000Z");
    expect(await client.removeLeague(idA)).toEqual({ ok: true });
    expect(await client.saveImport({ request: later.request, response: later.response, savedAt: later.savedAt, makeCurrent: false, ifSaved: true })).toEqual({ ok: false, message: LEAGUE_NOT_SAVED });
    expect(client.getState().leagues.map((l) => l.id)).toEqual([idB]);
    expect(client.getState().currentId).toBe(idB);
    expect((await rowsOf(b.factory as IDBFactory, "leagues")).map((r) => (r as SavedLeague).id)).toEqual([idB]);
    expect(JSON.stringify(await rowsOf(b.factory as IDBFactory, "imports"))).not.toContain(idA);
    // Its tombstone stays (an old tab's copy still can't bring it back).
    expect(await rowsOf(b.factory as IDBFactory, "meta")).toEqual(expect.arrayContaining([{ key: "removed", value: { [idA]: expect.any(String) } }]));
    // The only league left: still not brought back, and the tab keeps showing what it shows.
    expect(await client.removeLeague(idB)).toEqual({ ok: true });
    expect(await client.saveImport({ request: imported(B).request, response: imported(B).response, savedAt: "2026-10-04T13:00:00.000Z", makeCurrent: false, ifSaved: true })).toEqual({ ok: false, message: LEAGUE_NOT_SAVED });
    expect(client.getState()).toMatchObject({ leagues: [], currentId: null });
    // A league still saved is updated as usual.
    await client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: imported(A).savedAt });
    expect(await client.saveImport({ request: later.request, response: later.response, savedAt: later.savedAt, makeCurrent: false, ifSaved: true })).toEqual({ ok: true, id: idA });
    expect(currentLeagueRead(client.getState())).toMatchObject({ kind: "ok", stored: { response: { snapshot: { fetchedAt: "2026-10-04T11:00:00.000Z" } } } });
  });

  it("switches at once (in the same event), reads that league's import, and counts it as used", async () => {
    const b = newBrowser();
    const first = b.tab();
    await first.client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: imported(A).savedAt });
    await first.client.saveImport({ request: imported(B).request, response: imported(B).response, savedAt: imported(B).savedAt });
    const { client, session } = b.tab();
    await client.start();
    expect(client.getState().currentId).toBe(idB);
    const switching = client.selectLeague(idA);
    expect(client.getState().currentId).toBe(idA); // before the promise resolves
    expect(session.getItem(TAB_LEAGUE_KEY)).toBe(idA);
    expect(currentLeagueRead(client.getState())).toBeUndefined(); // its import is being read
    expect(await switching).toEqual({ ok: true });
    await client.settled();
    expect(currentLeagueRead(client.getState())).toMatchObject({ kind: "ok", league: { id: idA }, stored: imported(A) });
    expect(lastUsedLeague(client.getState().leagues)).toBe(idA);
    expect(await client.selectLeague(idC)).toEqual({ ok: false, message: LEAGUE_NOT_SAVED });
    // A reload of this tab stays on its league.
    const reloaded = b.tab(session);
    await reloaded.client.start();
    expect(reloaded.client.getState().currentId).toBe(idA);
  });

  it("keeps each tab on its own league when another tab switches, and lets a tab with none adopt a league imported elsewhere", async () => {
    const b = newBrowser();
    const one = b.tab();
    await one.client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: imported(A).savedAt });
    await one.client.saveImport({ request: imported(B).request, response: imported(B).response, savedAt: imported(B).savedAt });
    const two = b.tab();
    await two.client.start();
    expect(two.client.getState().currentId).toBe(idB);
    await one.client.selectLeague(idA);
    await tick();
    await two.client.settled();
    expect(two.client.getState().currentId).toBe(idB);
    expect(lastUsedLeague(two.client.getState().leagues)).toBe(idA);
    // A tab in another (empty) browser profile... here: a fresh tab of this browser before any league, then one is imported.
    const c = newBrowser();
    const empty = c.tab();
    const importer = c.tab();
    await Promise.all([empty.client.start(), importer.client.start()]);
    await importer.client.saveImport({ request: imported(C).request, response: imported(C).response, savedAt: imported(C).savedAt });
    await tick();
    await empty.client.settled();
    expect(currentLeagueRead(empty.client.getState())).toMatchObject({ kind: "ok", league: { id: idC } });
  });

  it("drops a league another tab removed while this tab was switching to it, and moves on (review of track ML)", async () => {
    const { backend, control } = gated();
    const shared = { openBackend: async () => ({ backend, storage: { kind: "indexeddb" as const } }), channel: hub() };
    const b = newBrowser();
    const one = b.tab(new MemoryStorage(), shared);
    const two = b.tab(new MemoryStorage(), shared);
    await one.client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: imported(A).savedAt });
    await one.client.saveImport({ request: imported(B).request, response: imported(B).response, savedAt: imported(B).savedAt });
    await two.client.start();
    expect(await two.client.removeLeague(idA)).toEqual({ ok: true });
    // Tab one switches to it before it hears of the removal; the removal's message lands while the switch is being stored.
    control.holdWrites = true;
    const switching = one.client.selectLeague(idA);
    expect(one.client.getState().currentId).toBe(idA);
    await tick();
    await one.client.settled();
    expect(one.client.getState().leagues.map((l) => l.id)).toContain(idA); // kept while the write pins its row
    control.holdWrites = false;
    control.releaseWrite();
    expect(await switching).toEqual({ ok: false, message: LEAGUE_NOT_SAVED });
    await one.client.settled();
    expect(one.client.getState().leagues.map((l) => l.id)).toEqual([idB]);
    expect(currentLeagueRead(one.client.getState())).toMatchObject({ kind: "ok", league: { id: idB } });
  });
});

describe("removing a league", () => {
  it("deletes its import, model inputs, pick, settings and feedback (and their old copies); the tab moves to the league used last", async () => {
    const b = newBrowser();
    const session = oldTab(imported(A), { model: storedModel(A), pick: "2" });
    b.local.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ [leagueKey(A)]: mine }));
    b.local.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify([record(leagueKey(A), "t1", "2026-10-01T00:00:00.000Z")]));
    const { client } = b.tab(session);
    await client.start();
    await client.saveImport({ request: imported(B).request, response: imported(B).response, savedAt: imported(B).savedAt });
    await client.selectLeague(idA);
    const watcher = b.tab();
    await watcher.client.start();
    expect(watcher.client.getState().currentId).toBe(idA);
    expect(await client.removeLeague(idA)).toEqual({ ok: true });
    const s = client.getState();
    expect(s.leagues.map((l) => l.id)).toEqual([idB]);
    expect(s.currentId).toBe(idB);
    expect(s.imports.has(idA) || s.models.has(idA) || s.picks.has(idA) || s.settings.has(leagueKey(A)) || s.feedback.has(leagueKey(A))).toBe(false);
    for (const store of ["imports", "models", "picks", "settings", "feedback"]) {
      expect(JSON.stringify(await rowsOf(b.factory as IDBFactory, store)), store).not.toContain(idA);
      expect(JSON.stringify(await rowsOf(b.factory as IDBFactory, store)), store).not.toContain(leagueKey(A));
    }
    // The dormant old copies go too.
    expect(session.getItem(IMPORT_STORAGE_KEY)).toBeNull();
    expect(session.getItem(MODEL_STORAGE_KEY)).toBeNull();
    expect(b.local.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
    expect(b.local.getItem(FEEDBACK_STORAGE_KEY)).toBeNull();
    // Another tab that showed it moves on.
    await tick();
    await watcher.client.settled();
    expect(currentLeagueRead(watcher.client.getState())).toMatchObject({ kind: "ok", league: { id: idB } });
  });

  it("keeps the settings and feedback another season of the league shares", async () => {
    const b = newBrowser();
    const { client } = b.tab();
    const lastYear = like(A, { season: 2025 });
    for (const s of [A, lastYear]) await client.saveImport({ request: imported(s).request, response: imported(s).response, savedAt: imported(s).savedAt });
    await client.updateSettings(leagueKey(A), () => mine);
    await client.saveFeedback({ leagueKey: leagueKey(A), evaluation: evaluation("t1"), change: { outcome: "sent" }, at: "2026-10-04T12:00:00.000Z" });
    await client.removeLeague(savedLeagueId(lastYear));
    expect(client.getState().settings.get(leagueKey(A))).toEqual(mine);
    expect(client.getState().feedback.get(leagueKey(A))).toHaveLength(1);
    await client.removeLeague(idA);
    expect(client.getState()).toMatchObject({ leagues: [], currentId: null });
    expect(client.getState().settings.size + client.getState().feedback.size).toBe(0);
  });
});

describe("settings and feedback", () => {
  it("applies a settings change to the page at once, then stores it normalized; reset goes back to the defaults", async () => {
    const b = newBrowser();
    const { client } = b.tab();
    await client.start();
    const key = leagueKey(A);
    const saving = client.updateSettings(key, (s) => ({ ...s, lambda: 0.4, maxPerSide: 9 }));
    expect(savedSettingsRead(client.getState(), key)?.settings.lambda).toBe(0.4); // before the disk
    expect(await saving).toEqual({ ok: true });
    expect(savedSettingsRead(client.getState(), key)).toEqual({ settings: { ...defaultTradeSettings(), lambda: 0.4 }, stored: true });
    expect(await rowsOf(b.factory as IDBFactory, "settings")).toEqual([{ leagueKey: key, settings: { ...defaultTradeSettings(), lambda: 0.4 } }]);
    expect(await client.resetSettings(key)).toEqual({ ok: true });
    expect(savedSettingsRead(client.getState(), key)).toEqual({ settings: defaultTradeSettings(), stored: false });
    expect(await client.updateSettings("espn:4242", () => mine)).toEqual({ ok: false, message: SETTINGS_SAVE_FAILED });
  });

  it("never lets quick changes in a row, or in two tabs at once, undo each other", async () => {
    const b = newBrowser();
    const one = b.tab();
    const two = b.tab();
    await Promise.all([one.client.start(), two.client.start()]);
    const key = leagueKey(A);
    const add = (id: string) => (s: TradeSettings) => ({ ...s, untouchables: [...s.untouchables, id] });
    await Promise.all([one.client.updateSettings(key, add("1")), one.client.updateSettings(key, add("2")), two.client.updateSettings(key, add("3"))]);
    await tick();
    await Promise.all([one.client.settled(), two.client.settled()]);
    for (const c of [one.client, two.client]) expect([...(c.getState().settings.get(key)?.untouchables ?? [])].sort()).toEqual(["1", "2", "3"]);
  });

  it("saves feedback presses per league, with the sent version's model inputs, and deletes one league's or all", async () => {
    const b = newBrowser();
    const { client } = b.tab();
    await client.start();
    const inputs = { features: FEATURES, gPartner: 0.03, b: 3.2, goal: "title" as const };
    await client.saveFeedback({ leagueKey: leagueKey(A), evaluation: evaluation("t1"), change: { outcome: "sent", sent: { version: "full", key: "t1", pAccept: 0.4, pComplete: 0.4, inputs } }, at: "2026-10-04T12:00:00.000Z" });
    await client.saveFeedback({ leagueKey: leagueKey(B), evaluation: evaluation("t2"), change: { report: { reason: "never-accept" } }, at: "2026-10-04T12:01:00.000Z" });
    expect(savedFeedbackRead(client.getState(), leagueKey(A))?.[0]).toMatchObject({ outcome: { kind: "sent" }, version: "full", versionInputs: inputs });
    expect(savedFeedbackRead(client.getState())?.map((r) => r.tradeKey)).toEqual(["t1", "t2"]);
    b.local.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify([record(leagueKey(B), "old", "2026-09-30T00:00:00.000Z")]));
    expect(await client.clearFeedback(leagueKey(B))).toEqual({ ok: true });
    expect(savedFeedbackRead(client.getState())?.map((r) => r.tradeKey)).toEqual(["t1"]);
    expect(b.local.getItem(FEEDBACK_STORAGE_KEY)).toBeNull();
    expect(await client.clearFeedback()).toEqual({ ok: true });
    expect(savedFeedbackRead(client.getState())).toEqual([]);
    expect(await rowsOf(b.factory as IDBFactory, "feedback")).toEqual([]);
  });

  it("keeps this tab's change while it's being stored, when another tab's refresh lands first", async () => {
    const { backend, control } = gated();
    const channel = hub();
    const otherTab = channel();
    const b = newBrowser();
    const { client } = b.tab(new MemoryStorage(), { openBackend: async () => ({ backend, storage: { kind: "indexeddb" } }), channel });
    await client.start();
    const key = leagueKey(A);
    control.holdWrites = true;
    const saving = client.updateSettings(key, (s) => ({ ...s, untouchables: ["1"] }));
    otherTab.post({ v: 1, ids: [] });
    await tick();
    await client.settled();
    expect(client.getState().settings.get(key)?.untouchables).toEqual(["1"]);
    control.releaseWrite();
    expect(await saving).toEqual({ ok: true });
    expect(client.getState().settings.get(key)?.untouchables).toEqual(["1"]);
  });

  it("never lets a refresh read before this tab's write undo it when it lands after", async () => {
    const { backend, control } = gated();
    const channel = hub();
    const otherTab = channel();
    const b = newBrowser();
    const { client } = b.tab(new MemoryStorage(), { openBackend: async () => ({ backend, storage: { kind: "indexeddb" } }), channel });
    await client.start();
    const key = leagueKey(A);
    control.holdReads = true;
    otherTab.post({ v: 1, ids: [] });
    await tick(); // the refresh has read (no settings yet); its answer waits
    control.holdReads = false;
    expect(await client.updateSettings(key, () => mine)).toEqual({ ok: true });
    control.releaseRead();
    await client.settled();
    expect(client.getState().settings.get(key)).toEqual(mine);
  });

  it("reaches the other tabs", async () => {
    const b = newBrowser();
    const one = b.tab();
    const two = b.tab();
    await Promise.all([one.client.start(), two.client.start()]);
    await one.client.updateSettings(leagueKey(A), () => mine);
    await one.client.saveFeedback({ leagueKey: leagueKey(A), evaluation: evaluation("t1"), change: { outcome: "accepted" }, at: "2026-10-04T12:00:00.000Z" });
    await tick();
    await two.client.settled();
    expect(two.client.getState().settings.get(leagueKey(A))).toEqual(mine);
    expect(savedFeedbackRead(two.client.getState(), leagueKey(A))?.[0]?.outcome?.kind).toBe("accepted");
  });
});

describe("model responses (the League page's POST /api/model/…)", () => {
  const T1 = "2026-10-04T11:00:00.000Z";
  const reply = (fetchedAt: string, over: Partial<LeagueSnapshot> = {}): ModelResponse => ({
    import: { snapshot: like(A, { fetchedAt, ...over }), notes: ["fresh"] },
    model: inputs(fetchedAt),
  });

  it("stores the inputs for the same league data, and replaces the import with newer data keeping its request and pick", async () => {
    const b = newBrowser();
    const { client } = b.tab();
    const stored = imported(A);
    await client.saveImport({ request: stored.request, response: stored.response, savedAt: stored.savedAt });
    await client.saveMyTeam(idA, "2");
    expect(await client.keepModelResponse(idA, { response: reply(A.fetchedAt), savedAt: "2026-10-04T12:00:00.000Z" })).toEqual({ importSaved: false, modelSaved: true });
    expect(client.getState().models.get(idA)?.snapshotFetchedAt).toBe(A.fetchedAt);
    expect(await client.keepModelResponse(idA, { response: reply(T1), savedAt: "2026-10-04T12:05:00.000Z" })).toEqual({ importSaved: true, modelSaved: true });
    const read = currentLeagueRead(client.getState());
    expect(read).toMatchObject({ kind: "ok", stored: { request: stored.request, response: { snapshot: { fetchedAt: T1 }, notes: ["fresh"] } }, pick: { teamId: "2" } });
    expect(client.getState().models.get(idA)?.snapshotFetchedAt).toBe(T1);
  });

  it("keeps the import too when the same league data comes back signed and the saved one isn't (Part B, track BF)", async () => {
    const b = newBrowser();
    const { client } = b.tab();
    const stored = imported(A);
    await client.saveImport({ request: stored.request, response: stored.response, savedAt: stored.savedAt });
    const signedReply = (): ModelResponse => ({ ...reply(A.fetchedAt), import: { ...reply(A.fetchedAt).import, signed: { issuedAt: 1, token: "made-up" } } });
    expect(await client.keepModelResponse(idA, { response: signedReply(), savedAt: "2026-10-04T12:00:00.000Z" })).toEqual({ importSaved: true, modelSaved: true });
    expect(currentLeagueRead(client.getState())).toMatchObject({ kind: "ok", stored: { request: stored.request, response: { signed: { issuedAt: 1, token: "made-up" } } } });
    // Once signed, the same data's answers store only the inputs again.
    expect(await client.keepModelResponse(idA, { response: signedReply(), savedAt: "2026-10-04T12:01:00.000Z" })).toEqual({ importSaved: false, modelSaved: true });
  });

  it("stores nothing for older league data, another league's, or a league no longer saved", async () => {
    const b = newBrowser();
    const { client } = b.tab();
    const newer = imported(like(A, { fetchedAt: T1 }));
    await client.saveImport({ request: newer.request, response: newer.response, savedAt: newer.savedAt });
    expect(await client.keepModelResponse(idA, { response: reply(A.fetchedAt), savedAt: "2026-10-04T12:00:00.000Z" })).toEqual({ importSaved: false, modelSaved: false });
    expect(await client.keepModelResponse(idA, { response: reply(T1, { leagueId: "999" }), savedAt: "2026-10-04T12:00:00.000Z" })).toEqual({ importSaved: false, modelSaved: false });
    await client.removeLeague(idA);
    expect(await client.keepModelResponse(idA, { response: reply(T1), savedAt: "2026-10-04T12:00:00.000Z" })).toEqual({ importSaved: false, modelSaved: false });
    expect(await rowsOf(b.factory as IDBFactory, "models")).toEqual([]);
  });

  it("keepImport: a newer import without its numbers (the model route BUSY after the League page read the league again) replaces the import by the same rule, the stored numbers left alone (review of Phase 7b)", async () => {
    const b = newBrowser();
    const { client } = b.tab();
    const stored = imported(A);
    await client.saveImport({ request: stored.request, response: stored.response, savedAt: stored.savedAt });
    await client.saveMyTeam(idA, "2");
    expect(await client.keepModelResponse(idA, { response: reply(A.fetchedAt), savedAt: "2026-10-04T12:00:00.000Z" })).toEqual({ importSaved: false, modelSaved: true });
    const fresh = { ...reply(T1).import, signed: { issuedAt: 2, token: "made-up" } };
    expect(await client.keepImport(idA, { response: fresh, savedAt: "2026-10-04T12:05:00.000Z" })).toEqual({ importSaved: true });
    expect(currentLeagueRead(client.getState())).toMatchObject({
      kind: "ok",
      stored: { request: stored.request, savedAt: "2026-10-04T12:05:00.000Z", response: { snapshot: { fetchedAt: T1 }, signed: { issuedAt: 2, token: "made-up" } } },
      pick: { teamId: "2" },
    });
    // The numbers stored for the older data stay as they were (the page doesn't reuse them for the newer import).
    expect(client.getState().models.get(idA)?.snapshotFetchedAt).toBe(A.fetchedAt);
    // Stored on disk, for the next page too.
    const rows = (await rowsOf(b.factory as IDBFactory, "imports")) as Array<{ id: string; stored: { response: { snapshot: { fetchedAt: string } } } }>;
    expect(rows.map((r) => [r.id, r.stored.response.snapshot.fetchedAt])).toEqual([[idA, T1]]);
    // The same data again, older data, another league's, or a league no longer saved: nothing.
    expect(await client.keepImport(idA, { response: fresh, savedAt: "2026-10-04T12:06:00.000Z" })).toEqual({ importSaved: false });
    expect(await client.keepImport(idA, { response: reply(A.fetchedAt).import, savedAt: "2026-10-04T12:06:00.000Z" })).toEqual({ importSaved: false });
    expect(await client.keepImport(idA, { response: reply("2026-10-04T11:30:00.000Z", { leagueId: "999" }).import, savedAt: "2026-10-04T12:06:00.000Z" })).toEqual({ importSaved: false });
    await client.removeLeague(idA);
    expect(await client.keepImport(idA, { response: reply("2026-10-04T11:30:00.000Z").import, savedAt: "2026-10-04T12:06:00.000Z" })).toEqual({ importSaved: false });
  });
});

describe("a browser that refuses or lacks storage", () => {
  /** A backend whose writes fail while `failing` is on (a full disk, or storage blocked mid-session). */
  function refusing() {
    const inner = createMemoryBackend();
    const control = { failing: false };
    const backend: LeagueStoreBackend = {
      kind: "memory",
      run<T>(mode: "readonly" | "readwrite", fn: Parameters<LeagueStoreBackend["run"]>[1]): Promise<T> {
        if (mode === "readwrite" && control.failing) return Promise.reject(new DOMException("The quota has been exceeded.", "QuotaExceededError"));
        return inner.run(mode, fn) as Promise<T>;
      },
      close: () => inner.close(),
    };
    return { control, backend };
  }

  it("says in plain words that a write wasn't kept, and puts the page back to what is stored", async () => {
    const { control, backend } = refusing();
    const b = newBrowser();
    const { client } = b.tab(new MemoryStorage(), { openBackend: async () => ({ backend, storage: { kind: "indexeddb" } }) });
    await client.updateSettings(leagueKey(A), () => mine);
    control.failing = true;
    const saving = client.updateSettings(leagueKey(A), (s) => ({ ...s, lambda: 0.75 }));
    expect(client.getState().settings.get(leagueKey(A))?.lambda).toBe(0.75);
    expect(await saving).toEqual({ ok: false, message: SETTINGS_SAVE_FAILED });
    expect(client.getState().settings.get(leagueKey(A))).toEqual(mine);
    expect(await client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: imported(A).savedAt })).toEqual({ ok: false, message: IMPORT_SAVE_FAILED });
    expect(client.getState().leagues).toEqual([]);
    expect(await client.saveFeedback({ leagueKey: leagueKey(A), evaluation: evaluation("t1"), change: { outcome: "sent" }, at: "2026-10-04T12:00:00.000Z" })).toEqual({
      ok: false,
      message: FEEDBACK_SAVE_FAILED,
    });
    expect(client.getState().feedback.size).toBe(0);
  });

  it("works in this page's memory without IndexedDB, seeded from the pre-4c storage, and says so", async () => {
    const local = new MemoryStorage();
    local.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ [leagueKey(A)]: mine }));
    const b = newBrowser({ indexedDB: null, local });
    const session = oldTab(imported(A), { pick: "2" });
    const { client } = b.tab(session);
    await client.start();
    expect(client.getState().storage).toEqual({ kind: "memory", message: STORAGE_MEMORY_ONLY });
    expect(currentLeagueRead(client.getState())).toMatchObject({ kind: "ok", league: { id: idA }, pick: { teamId: "2" } });
    expect(client.getState().settings.get(leagueKey(A))).toEqual(mine);
    // Not marked: nothing was kept, so the next load moves it in again.
    expect(session.getItem(TAB_MIGRATED_KEY)).toBeNull();
    expect(await client.saveImport({ request: imported(B).request, response: imported(B).response, savedAt: imported(B).savedAt })).toEqual({ ok: true, id: idB });
  });

  it("falls back to memory when IndexedDB refuses to open, or doesn't open in time", async () => {
    const throwing = { open: () => { throw new DOMException("The operation is insecure.", "SecurityError"); } } as unknown as IDBFactory;
    const silent = { open: () => ({}) } as unknown as IDBFactory;
    for (const factory of [throwing, silent]) {
      const b = newBrowser({ indexedDB: factory });
      const { client } = b.tab(new MemoryStorage(), { openTimeoutMs: 20 });
      await client.start();
      expect(client.getState().storage.kind).toBe("memory");
    }
  });

  it("never fails to load: anything unexpected leaves an empty store in this page's memory that still works", async () => {
    const b = newBrowser();
    const { client } = b.tab(new MemoryStorage(), {
      openBackend: async () => {
        throw new Error("unexpected");
      },
    });
    await expect(client.start()).resolves.toBeUndefined();
    expect(client.getState()).toMatchObject({ status: "ready", storage: { kind: "memory", message: STORAGE_MEMORY_ONLY }, leagues: [] });
    expect(await client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: imported(A).savedAt })).toEqual({ ok: true, id: idA });
  });

  it("makes the database again when something created it empty first (opened with no version), and leaves one holding other stores alone", async () => {
    const make = (factory: IDBFactory, store?: string) =>
      new Promise<void>((resolve, reject) => {
        const req = factory.open(LEAGUE_DB_NAME);
        req.onupgradeneeded = () => {
          if (store) req.result.createObjectStore(store);
        };
        req.onsuccess = () => {
          req.result.close();
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
    const empty = new IDBFactory();
    await make(empty);
    const b = newBrowser({ indexedDB: empty });
    const { client } = b.tab();
    await client.start();
    expect(client.getState().storage).toEqual({ kind: "indexeddb" });
    expect(await client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: imported(A).savedAt })).toEqual({ ok: true, id: idA });
    expect(await rowsOf(empty, "leagues")).toHaveLength(1);
    const foreign = new IDBFactory();
    await make(foreign, "somethingElse");
    const c = newBrowser({ indexedDB: foreign });
    const other = c.tab();
    await other.client.start();
    expect(other.client.getState().storage.kind).toBe("memory");
  });

  it("works with blocked sessionStorage and localStorage (the tab's league kept in memory)", async () => {
    const b = newBrowser({ local: new BlockedStorage() });
    const { client } = b.tab(new BlockedStorage());
    await client.start();
    expect(await client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: imported(A).savedAt })).toEqual({ ok: true, id: idA });
    expect(currentLeagueRead(client.getState())).toMatchObject({ kind: "ok", league: { id: idA } });
  });

  it("says to reload when another tab opens a newer version of the database, and then refuses writes with that message", async () => {
    const b = newBrowser();
    const { client } = b.tab();
    await client.saveImport({ request: imported(A).request, response: imported(A).response, savedAt: imported(A).savedAt });
    const upgrade = (b.factory as IDBFactory).open(LEAGUE_DB_NAME, 99);
    await new Promise<void>((resolve, reject) => {
      upgrade.onsuccess = () => {
        upgrade.result.close();
        resolve();
      };
      upgrade.onerror = () => reject(upgrade.error);
    });
    expect(client.getState().storage).toEqual({ kind: "closed", message: STORAGE_UPDATED_ELSEWHERE });
    expect(await client.updateSettings(leagueKey(A), () => mine)).toEqual({ ok: false, message: STORAGE_UPDATED_ELSEWHERE });
    // What the page already has stays on screen.
    expect(currentLeagueRead(client.getState())).toMatchObject({ kind: "ok", league: { id: idA } });
  });
});
