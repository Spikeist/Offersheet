import { describe, expect, it } from "vitest";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueSnapshot } from "@/engine/model";
import { TTL } from "@/server/cache";
import type { ModelResponse } from "./api";
import { IMPORT_FORMAT_VERSION, type StoredImport } from "./importStore";
import {
  MODEL_REUSE_MAX_AGE_MS,
  MODEL_STORAGE_KEY,
  checkStoredModel,
  modelForSnapshot,
  modelKey,
  modelRequest,
  parseStoredModel,
  snapshotOrder,
  storedModelForLeague,
  withImportedTeam,
  type StoredModel,
} from "./modelStore";

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

/** The record kept for a snapshot's inputs (the league store's, and the pre-4c tab's). */
const storedModel = (snapshot: { platform: "sleeper" | "espn"; leagueId: string; season: number; fetchedAt: string }, model: ModelInputs): StoredModel => ({
  version: 1,
  savedAt: SAVED_AT,
  key: modelKey(snapshot),
  snapshotFetchedAt: snapshot.fetchedAt,
  model,
});

describe("model store", () => {
  it("keys a league by platform, league and season", () => {
    expect(modelKey(snap)).toBe("sleeper:123456789012345678:2026");
    expect(MODEL_STORAGE_KEY).toBe("offersheet:model:v1");
  });

  it("reads the inputs kept as text for one snapshot (the pre-4c sessionStorage copy the league store's migration reads)", () => {
    const stored = parseStoredModel(JSON.stringify(storedModel(snap, inputs())));
    expect(stored).toEqual({ version: 1, savedAt: SAVED_AT, key: "sleeper:123456789012345678:2026", snapshotFetchedAt: snap.fetchedAt, model: inputs() });
  });

  it("is reused only for the same league and the same league data (snapshot.fetchedAt)", () => {
    const stored = storedModel(snap, inputs());
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
    const stored = storedModel(snap, inputs());
    const built = Date.parse(inputs().builtAt);
    expect(modelForSnapshot(stored, snap, { now: built + MODEL_REUSE_MAX_AGE_MS - 1 })).toEqual(inputs());
    expect(modelForSnapshot(stored, snap, { now: built + MODEL_REUSE_MAX_AGE_MS })).toBeUndefined();
    // A week later (the tab restored), the same stored copy isn't reused.
    expect(modelForSnapshot(stored, snap, { now: built + 7 * 24 * 60 * 60 * 1000 })).toBeUndefined();
    // A server clock a little ahead of the browser's still counts as fresh; the limit can be set.
    expect(modelForSnapshot(stored, snap, { now: built - 60_000 })).toEqual(inputs());
    expect(modelForSnapshot(stored, snap, { now: built + 60_000, maxAgeMs: 30_000 })).toBeUndefined();
    // No readable build time: treated as old.
    expect(modelForSnapshot(storedModel(snap, inputs({ builtAt: "sometime" })), snap, SOON)).toBeUndefined();
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

  describe("withImportedTeam (the League page's answer from POST /api/model/…, before the league store keeps it)", () => {
    const leagueSnap = (fetchedAt: string) =>
      ({ platform: "espn", leagueId: "4242", season: 2026, fetchedAt, name: "Fictional League", teams: [{ id: "1" }, { id: "2" }], settings: {}, myTeamId: null }) as unknown as LeagueSnapshot;
    const T0 = "2026-09-30T01:00:00.000Z";
    const storedImport = (fetchedAt: string): StoredImport => ({ version: IMPORT_FORMAT_VERSION, savedAt: T0, request: { platform: "espn", season: 2026, leagueId: "4242" }, response: { snapshot: leagueSnap(fetchedAt), notes: [] } });
    const reply = (fetchedAt: string): ModelResponse => ({ import: { snapshot: leagueSnap(fetchedAt), notes: ["fresh"] }, model: inputs({ builtAt: fetchedAt }) });

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
  });
});

describe("the pieces the league store shares (Phase 4c: src/lib/leagueStore.ts keeps each league's inputs in IndexedDB)", () => {
  it("checks stored inputs already parsed exactly as parseStoredModel checks their text", () => {
    const good = { version: 1, savedAt: SAVED_AT, key: modelKey(snap), snapshotFetchedAt: snap.fetchedAt, model: inputs() };
    for (const data of [good, { ...good, version: 2 }, { ...good, model: { ...good.model, players: [] } }, null, [], "inputs"]) {
      expect(checkStoredModel(data), JSON.stringify(data)).toEqual(parseStoredModel(JSON.stringify(data)));
    }
    expect(checkStoredModel(good)).toEqual(good);
    expect(checkStoredModel(undefined)).toBeUndefined();
  });

  it("orders a response's league data against the stored import's: older stores nothing, the same keeps the import, newer replaces it", () => {
    expect(snapshotOrder("2026-09-30T02:00:00.000Z", "2026-09-30T01:00:00.000Z")).toBe("older");
    expect(snapshotOrder("2026-09-30T02:00:00.000Z", "2026-09-30T02:00:00.000Z")).toBe("same");
    expect(snapshotOrder("2026-09-30T02:00:00.000Z", "2026-09-30T03:00:00.000Z")).toBe("newer");
    // A time that can't be read is never older: the response is the server's answer for this league just now.
    expect(snapshotOrder("2026-09-30T02:00:00.000Z", "soon")).toBe("newer");
    expect(snapshotOrder("whenever", "2026-09-30T01:00:00.000Z")).toBe("newer");
  });
});
