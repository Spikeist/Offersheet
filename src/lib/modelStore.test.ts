import { describe, expect, it } from "vitest";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueSnapshot } from "@/engine/model";
import { TTL } from "@/server/cache";
import type { ModelResponse } from "./api";
import { IMPORT_FORMAT_VERSION, IMPORT_STORAGE_KEY, myTeamKey, parseMyTeamPick, parseStoredImport, saveImport, saveMyTeam, type StorageLike, type StoredImport } from "./importStore";
import { MODEL_REUSE_MAX_AGE_MS, MODEL_STORAGE_KEY, keepModelResponse, modelForSnapshot, modelKey, modelRequest, parseStoredModel, saveModel, storedModelForLeague, withImportedTeam } from "./modelStore";

class FakeStorage implements StorageLike {
  data = new Map<string, string>();
  log: string[] = [];
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.log.push(`set ${k}`);
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.log.push(`remove ${k}`);
    this.data.delete(k);
  }
}

/** Storage that is full: reads and removals work, writes throw. */
class FullStorage extends FakeStorage {
  setItem(): void {
    throw new Error("QuotaExceededError");
  }
}

class BlockedStorage implements StorageLike {
  getItem(): string | null {
    throw new Error("SecurityError");
  }
  setItem(): void {
    throw new Error("SecurityError");
  }
  removeItem(): void {
    throw new Error("SecurityError");
  }
}

function inputs(overrides: Partial<ModelInputs> = {}): ModelInputs {
  return {
    version: 1,
    season: 2026,
    currentWeek: 4,
    lastWeek: 17,
    builtAt: "2026-09-30T02:00:00.000Z",
    nfl: { byeWeek: { MIN: 6 }, kickoffs: {} },
    players: { "4034": { sleeper: { 4: 18.2, 5: null }, actual: { 1: 20.1 } } },
    espnProjections: false,
    market: null,
    sources: [{ source: "Sleeper projections", fetchedAt: "2026-09-30T01:00:00.000Z" }],
    warnings: [],
    notes: ["FantasyCalc format: 10 teams · half-PPR · 1 QB · redraft"],
    ...overrides,
  };
}

const snap = { platform: "sleeper", leagueId: "123456789012345678", season: 2026, fetchedAt: "2026-09-30T01:55:00.000Z" } as const;
const SAVED_AT = "2026-09-30T02:00:05.000Z";
/** Ten minutes after the default inputs were built. */
const SOON = { now: Date.parse("2026-09-30T02:10:00.000Z") };

describe("model store (sessionStorage offersheet:model:v1)", () => {
  it("keys a league by platform, league and season", () => {
    expect(modelKey(snap)).toBe("sleeper:123456789012345678:2026");
    expect(MODEL_STORAGE_KEY).toBe("offersheet:model:v1");
  });

  it("round-trips the inputs for one snapshot", () => {
    const s = new FakeStorage();
    expect(saveModel(s, { snapshot: snap, model: inputs(), savedAt: SAVED_AT })).toEqual({ ok: true });
    const stored = parseStoredModel(s.getItem(MODEL_STORAGE_KEY));
    expect(stored).toEqual({ version: 1, savedAt: SAVED_AT, key: "sleeper:123456789012345678:2026", snapshotFetchedAt: snap.fetchedAt, model: inputs() });
  });

  it("is reused only for the same league and the same league data (snapshot.fetchedAt)", () => {
    const s = new FakeStorage();
    saveModel(s, { snapshot: snap, model: inputs(), savedAt: SAVED_AT });
    const stored = parseStoredModel(s.getItem(MODEL_STORAGE_KEY));
    expect(modelForSnapshot(stored, snap, SOON)).toEqual(inputs());
    expect(modelForSnapshot(stored, { ...snap, fetchedAt: "2026-09-30T02:30:00.000Z" }, SOON)).toBeUndefined();
    expect(modelForSnapshot(stored, { ...snap, leagueId: "999999999999999999" }, SOON)).toBeUndefined();
    expect(modelForSnapshot(stored, { ...snap, season: 2025 }, SOON)).toBeUndefined();
    expect(modelForSnapshot(stored, { ...snap, platform: "espn" }, SOON)).toBeUndefined();
    expect(modelForSnapshot(undefined, snap, SOON)).toBeUndefined();
    // Same league, older league data: still this league's (the Import Report shows its notes).
    expect(storedModelForLeague(stored, { ...snap })?.key).toBe(modelKey(snap));
    expect(storedModelForLeague(stored, { ...snap, leagueId: "1" })).toBeUndefined();
  });

  it("is reused only while younger than the projections' refresh interval (6 hours, the server's TTL.projections), so a tab reopened days later fetches again", () => {
    expect(MODEL_REUSE_MAX_AGE_MS).toBe(TTL.projections);
    expect(MODEL_REUSE_MAX_AGE_MS).toBe(6 * 60 * 60 * 1000);
    const s = new FakeStorage();
    saveModel(s, { snapshot: snap, model: inputs(), savedAt: SAVED_AT });
    const stored = parseStoredModel(s.getItem(MODEL_STORAGE_KEY));
    const built = Date.parse(inputs().builtAt);
    expect(modelForSnapshot(stored, snap, { now: built + MODEL_REUSE_MAX_AGE_MS - 1 })).toEqual(inputs());
    expect(modelForSnapshot(stored, snap, { now: built + MODEL_REUSE_MAX_AGE_MS })).toBeUndefined();
    // A week later (the tab restored), the same stored copy isn't reused.
    expect(modelForSnapshot(stored, snap, { now: built + 7 * 24 * 60 * 60 * 1000 })).toBeUndefined();
    // A server clock a little ahead of the browser's still counts as fresh; the limit can be set.
    expect(modelForSnapshot(stored, snap, { now: built - 60_000 })).toEqual(inputs());
    expect(modelForSnapshot(stored, snap, { now: built + 60_000, maxAgeMs: 30_000 })).toBeUndefined();
    // No readable build time: treated as old.
    saveModel(s, { snapshot: snap, model: inputs({ builtAt: "sometime" }), savedAt: SAVED_AT });
    expect(modelForSnapshot(parseStoredModel(s.getItem(MODEL_STORAGE_KEY)), snap, SOON)).toBeUndefined();
  });

  it("keeps one league at a time, removing the old copy before writing", () => {
    const s = new FakeStorage();
    saveModel(s, { snapshot: snap, model: inputs(), savedAt: SAVED_AT });
    saveModel(s, { snapshot: { ...snap, leagueId: "222" }, model: inputs({ currentWeek: 5 }), savedAt: SAVED_AT });
    expect(s.log).toEqual([`remove ${MODEL_STORAGE_KEY}`, `set ${MODEL_STORAGE_KEY}`, `remove ${MODEL_STORAGE_KEY}`, `set ${MODEL_STORAGE_KEY}`]);
    expect(parseStoredModel(s.getItem(MODEL_STORAGE_KEY))?.key).toBe("sleeper:222:2026");
  });

  it("says so when the browser won't store it, and never leaves a stale copy behind", () => {
    const full = new FullStorage();
    full.data.set(MODEL_STORAGE_KEY, "old copy");
    const res = saveModel(full, { snapshot: snap, model: inputs(), savedAt: SAVED_AT });
    expect(res.ok).toBe(false);
    expect(res.ok ? "" : res.message).toMatch(/wouldn't let us keep the projections/);
    expect(full.data.has(MODEL_STORAGE_KEY)).toBe(false);
    expect(saveModel(new BlockedStorage(), { snapshot: snap, model: inputs(), savedAt: SAVED_AT }).ok).toBe(false);
  });

  it("ignores anything that isn't a stored model (light shape check)", () => {
    const good = JSON.parse(JSON.stringify({ version: 1, savedAt: SAVED_AT, key: "k", snapshotFetchedAt: "t", model: inputs() }));
    expect(parseStoredModel(JSON.stringify(good))).toBeDefined();
    for (const bad of [
      null,
      undefined,
      "",
      "not json",
      "[]",
      JSON.stringify({ ...good, version: 2 }),
      JSON.stringify({ ...good, key: 7 }),
      JSON.stringify({ ...good, snapshotFetchedAt: undefined }),
      JSON.stringify({ ...good, model: { ...good.model, version: 2 } }),
      JSON.stringify({ ...good, model: { ...good.model, players: [] } }),
      JSON.stringify({ ...good, model: { ...good.model, nfl: null } }),
      JSON.stringify({ ...good, model: { ...good.model, sources: {} } }),
      JSON.stringify({ ...good, model: { ...good.model, builtAt: 1 } }),
      JSON.stringify({ ...good, model: "inputs" }),
    ]) {
      expect(parseStoredModel(bad as string | null | undefined)).toBeUndefined();
    }
  });
  describe("modelRequest (the League page's POST /api/model/…)", () => {
    /** A stored import of `league`, made with the request summary the Connect page saved. */
    const importOf = (league: { platform: string; leagueId: string; season: number }, request: Partial<StoredImport["request"]> = {}) =>
      ({ request: { platform: league.platform, season: league.season, leagueId: league.leagueId, ...request }, response: { snapshot: league, notes: [] } }) as unknown as StoredImport;

    it("asks for the imported league, with refresh only from the Refresh button", () => {
      expect(modelRequest(importOf(snap))).toEqual({ url: "/api/model/sleeper", body: { season: 2026, leagueId: "123456789012345678" } });
      expect(modelRequest(importOf({ platform: "espn", leagueId: "4242", season: 2026 }), true)).toEqual({ url: "/api/model/espn", body: { leagueId: "4242", season: 2026, refresh: true } });
      expect(modelRequest(importOf({ platform: "yahoo", leagueId: "1", season: 2026 }))).toBeNull();
    });

    it("sends the Sleeper username the league was imported with, so the re-import finds the user's team", () => {
      expect(modelRequest(importOf(snap, { username: "zorblax_q" }))).toEqual({ url: "/api/model/sleeper", body: { season: 2026, leagueId: "123456789012345678", username: "zorblax_q" } });
      expect(modelRequest(importOf(snap, { username: "zorblax_q" }), true)?.body).toEqual({ season: 2026, leagueId: "123456789012345678", username: "zorblax_q", refresh: true });
      // The snapshot's league wins over the request summary's (a username import lists no league ID until it's picked).
      expect(modelRequest(importOf(snap, { leagueId: undefined, username: "@zorblax_q " }))?.body).toEqual({ season: 2026, leagueId: "123456789012345678", username: "zorblax_q" });
      // Something that isn't a username is left out rather than failing the page; ESPN never sends one.
      expect(modelRequest(importOf(snap, { username: "not a username" }))?.body).toEqual({ season: 2026, leagueId: "123456789012345678" });
      expect(modelRequest(importOf(snap, { username: "" }))?.body).toEqual({ season: 2026, leagueId: "123456789012345678" });
      expect(modelRequest(importOf({ platform: "espn", leagueId: "4242", season: 2026 }, { username: "zorblax_q" }))?.body).toEqual({ leagueId: "4242", season: 2026 });
    });
  });

  describe("keepModelResponse (the League page's answer from POST /api/model/…)", () => {
    const leagueSnap = (fetchedAt: string) =>
      ({ platform: "espn", leagueId: "4242", season: 2026, fetchedAt, name: "Fictional League", teams: [{ id: "1" }, { id: "2" }], settings: {}, myTeamId: null }) as unknown as LeagueSnapshot;
    const T0 = "2026-09-30T01:00:00.000Z";
    const storedImport = (fetchedAt: string): StoredImport => ({ version: IMPORT_FORMAT_VERSION, savedAt: T0, request: { platform: "espn", season: 2026, leagueId: "4242" }, response: { snapshot: leagueSnap(fetchedAt), notes: [] } });
    const reply = (fetchedAt: string): ModelResponse => ({ import: { snapshot: leagueSnap(fetchedAt), notes: ["fresh"] }, model: inputs({ builtAt: fetchedAt }) });

    it("stores the inputs for the same league data, leaving the import alone", () => {
      const s = new FakeStorage();
      saveImport(s, storedImport(T0));
      const before = s.getItem(IMPORT_STORAGE_KEY);
      expect(keepModelResponse(s, { stored: storedImport(T0), response: reply(T0), savedAt: SAVED_AT })).toEqual({ importSaved: false, modelSaved: true });
      expect(s.getItem(IMPORT_STORAGE_KEY)).toBe(before);
      expect(modelForSnapshot(parseStoredModel(s.getItem(MODEL_STORAGE_KEY)), leagueSnap(T0), SOON)?.builtAt).toBe(T0);
    });

    it("replaces the import with newer league data, keeping the user's team pick, and stores the inputs with it", () => {
      const s = new FakeStorage();
      saveImport(s, storedImport(T0));
      saveMyTeam(s, leagueSnap(T0), "2", "you");
      const T1 = "2026-09-30T02:00:00.000Z";
      expect(keepModelResponse(s, { stored: storedImport(T0), response: reply(T1), savedAt: SAVED_AT })).toEqual({ importSaved: true, modelSaved: true });
      expect(parseStoredImport(s.getItem(IMPORT_STORAGE_KEY))?.response).toMatchObject({ snapshot: { fetchedAt: T1 }, notes: ["fresh"] });
      expect(parseMyTeamPick(s.getItem(myTeamKey(leagueSnap(T1))))).toEqual({ teamId: "2", source: "you" });
      expect(modelForSnapshot(parseStoredModel(s.getItem(MODEL_STORAGE_KEY)), leagueSnap(T1), SOON)).toBeDefined();
    });

    it("keeps the team the platform found at import when the model route couldn't find it (no Sleeper username)", () => {
      const withMine = (fetchedAt: string, myTeamId: string | null): StoredImport => {
        const s = storedImport(fetchedAt);
        return { ...s, response: { ...s.response, snapshot: { ...s.response.snapshot, myTeamId } } };
      };
      const T1 = "2026-09-30T02:00:00.000Z";
      expect(withImportedTeam(reply(T1), withMine(T0, "2")).import.snapshot.myTeamId).toBe("2");
      // The route's own answer wins; a team that left the league isn't carried over; nothing to carry is a no-op.
      const found = reply(T1);
      found.import.snapshot = { ...found.import.snapshot, myTeamId: "1" };
      expect(withImportedTeam(found, withMine(T0, "2")).import.snapshot.myTeamId).toBe("1");
      expect(withImportedTeam(reply(T1), withMine(T0, "9")).import.snapshot.myTeamId).toBeNull();
      const plain = reply(T1);
      expect(withImportedTeam(plain, withMine(T0, null))).toBe(plain);
    });

    it("drops the re-import's 'couldn't tell which team is yours' warnings once it carries the team over, and keeps every other warning", () => {
      const T1 = "2026-09-30T02:00:00.000Z";
      const lookup = [
        { code: "USER_NOT_FOUND", message: "There's no Sleeper user named \"zorblax_q\", so we couldn't tell which team is yours. Pick your team.", platformPath: "user" },
        { code: "USER_LOOKUP_FAILED", message: "Sleeper didn't answer the lookup of user \"zorblax_q\" (HTTP 503), so we couldn't tell which team is yours. Pick your team.", platformPath: "user" },
      ];
      const other = { code: "PLAYOFF_TEAMS_MISSING", message: "The league doesn't say how many teams make the playoffs.", platformPath: "settings.playoff_teams" };
      const withWarnings = (fetchedAt: string, myTeamId: string | null, warnings: LeagueSnapshot["warnings"]): ModelResponse => {
        const r = reply(fetchedAt);
        return { ...r, import: { ...r.import, snapshot: { ...r.import.snapshot, myTeamId, warnings } } };
      };
      const mine = storedImport(T0);
      const known: StoredImport = { ...mine, response: { ...mine.response, snapshot: { ...mine.response.snapshot, myTeamId: "2" } } };
      const carried = withImportedTeam(withWarnings(T1, null, [...lookup, other]), known).import.snapshot;
      expect(carried.myTeamId).toBe("2");
      expect(carried.warnings).toEqual([other]);
      // Nothing carried over: every warning stays (the route found the team itself, or there's none to carry).
      expect(withImportedTeam(withWarnings(T1, "1", [...lookup, other]), known).import.snapshot.warnings).toHaveLength(3);
      expect(withImportedTeam(withWarnings(T1, null, [...lookup, other]), storedImport(T0)).import.snapshot.warnings).toHaveLength(3);
      // A reply without a warnings list (light shape check) still carries the team.
      expect(withImportedTeam(reply(T1), known).import.snapshot).toMatchObject({ myTeamId: "2", warnings: [] });
    });

    it("stores nothing for older league data, or when the import can't be stored", () => {
      const s = new FakeStorage();
      saveImport(s, storedImport("2026-09-30T02:00:00.000Z"));
      expect(keepModelResponse(s, { stored: storedImport("2026-09-30T02:00:00.000Z"), response: reply(T0), savedAt: SAVED_AT })).toEqual({ importSaved: false, modelSaved: false });
      expect(s.getItem(MODEL_STORAGE_KEY)).toBeNull();
      expect(keepModelResponse(new FullStorage(), { stored: storedImport(T0), response: reply("2026-09-30T02:00:00.000Z"), savedAt: SAVED_AT })).toEqual({ importSaved: false, modelSaved: false });
    });
  });
});
