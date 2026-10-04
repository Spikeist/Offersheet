import { describe, expect, it } from "vitest";
import type { LeagueSnapshot } from "@/engine/model";
import {
  IMPORT_FORMAT_VERSION,
  IMPORT_STORAGE_KEY,
  MY_TEAM_KEY_PREFIX,
  OUTDATED_IMPORT_TEXT,
  OUTDATED_IMPORT_TITLE,
  checkMyTeamPick,
  myTeamKey,
  parseMyTeamKey,
  parseMyTeamPick,
  parseStoredImport,
  pickAfterImport,
  readImportData,
  readStoredImport,
  toStoredImport,
  type StoredImport,
} from "./importStore";

const snap = {
  platform: "sleeper",
  leagueId: "123456789012345678",
  season: 2026,
  name: "Fictional League",
  teams: [{ id: "1" }, { id: "2" }],
  settings: {},
  myTeamId: null,
} as unknown as LeagueSnapshot;

const stored: StoredImport = {
  version: IMPORT_FORMAT_VERSION,
  savedAt: "2026-09-29T23:00:00.000Z",
  request: { platform: "sleeper", season: 2026, username: "zorblax_q" },
  response: { snapshot: snap, notes: [] },
};

const espnSnap = { ...snap, platform: "espn", leagueId: "4242", teams: [{ id: "3" }, { id: "7" }] } as unknown as LeagueSnapshot;

describe("import store", () => {
  it("reads an import kept as text (the pre-4c sessionStorage copy the league store's migration reads)", () => {
    expect(IMPORT_STORAGE_KEY).toBe("offersheet:import:v1");
    expect(parseStoredImport(JSON.stringify(stored))).toEqual(stored);
  });

  it("ignores values that aren't ours", () => {
    expect(parseStoredImport(null)).toBeUndefined();
    expect(parseStoredImport("not json")).toBeUndefined();
    expect(parseStoredImport(JSON.stringify({ version: IMPORT_FORMAT_VERSION }))).toBeUndefined();
    expect(parseStoredImport(JSON.stringify({ ...stored, response: { snapshot: { platform: "espn" }, notes: [] } }))).toBeUndefined();
    expect(parseStoredImport(JSON.stringify({ ...stored, response: { snapshot: snap } }))).toBeUndefined();
  });

  it("saves this version's format: 4 since Phase 4c, whose waiver ranks are the order the allocation uses (3 since Phase 4b's waiver ranks and IR eligibility, 2 since Phase 3's matchup results)", () => {
    expect(IMPORT_FORMAT_VERSION).toBe(4);
    const { version, ...rest } = stored;
    expect(version).toBe(IMPORT_FORMAT_VERSION);
    expect(toStoredImport(rest)).toEqual(stored);
    // A Phase 4b record (its waiverRank is the live order of the day it was imported) is one to import again.
    expect(readStoredImport(JSON.stringify({ ...stored, version: 3 }))).toEqual({ kind: "outdated" });
  });

  it("ignores an import saved in another format, e.g. before Phase 3 (matchups without decided or result), so the pages ask for a new import", () => {
    // A version-1 record: otherwise the right shape, with a finished week that doesn't say it's decided.
    const old = { ...stored, version: 1, response: { ...stored.response, snapshot: { ...snap, schedule: [{ week: 1, teamA: "1", teamB: "2", isPlayoff: false }] } } };
    expect(parseStoredImport(JSON.stringify(old))).toBeUndefined();
    expect(parseStoredImport(JSON.stringify({ ...old, version: IMPORT_FORMAT_VERSION }))).toBeDefined(); // only the version stops it
    // Any other version too (a newer tab's), or the right number as a string.
    expect(parseStoredImport(JSON.stringify({ ...stored, version: IMPORT_FORMAT_VERSION + 1 }))).toBeUndefined();
    expect(parseStoredImport(JSON.stringify({ ...stored, version: String(IMPORT_FORMAT_VERSION) }))).toBeUndefined();
    expect(parseStoredImport(JSON.stringify({ ...stored, version: undefined }))).toBeUndefined();
  });

  it("tells an import saved by an earlier version apart from none at all, so the pages can say Offer Sheet was updated", () => {
    // A version-1 record, as Phases 1–2 saved it (matchups without decided or result).
    const v1 = { ...stored, version: 1, response: { ...stored.response, snapshot: { ...snap, schedule: [{ week: 1, teamA: "1", teamB: "2", isPlayoff: false }] } } };
    expect(readStoredImport(JSON.stringify(v1))).toEqual({ kind: "outdated" });
    expect(readStoredImport(JSON.stringify({ ...v1, response: { snapshot: v1.response.snapshot } }))).toEqual({ kind: "outdated" }); // notes aren't needed to know it's ours
    expect(readStoredImport(JSON.stringify(stored))).toEqual({ kind: "ok", stored });
    // Nothing, or nothing that is an import: no league imported.
    for (const raw of [null, undefined, "", "not json", "42", JSON.stringify({ version: 1 }), JSON.stringify({ ...v1, request: undefined }), JSON.stringify({ ...v1, response: { snapshot: { platform: "espn" }, notes: [] } })])
      expect(readStoredImport(raw), String(raw)).toEqual({ kind: "none" });
    // Only an earlier version is outdated: a newer tab's record, or a version that isn't a whole number from 1 up, isn't ours to judge.
    for (const version of [IMPORT_FORMAT_VERSION + 1, 0, -1, 1.5, "1", null]) expect(readStoredImport(JSON.stringify({ ...stored, version })), String(version)).toEqual({ kind: "none" });
    // parseStoredImport reads only this version's records.
    expect(parseStoredImport(JSON.stringify(v1))).toBeUndefined();
    expect(parseStoredImport(JSON.stringify(stored))).toEqual(stored);
    expect(OUTDATED_IMPORT_TITLE).toBe("Offer Sheet was updated");
    expect(OUTDATED_IMPORT_TEXT).toBe("Import your league again to see the new numbers.");
  });

  it("keys a pre-4c team pick by league and season, and reads where it came from", () => {
    expect(myTeamKey(snap)).not.toBe(myTeamKey({ ...snap, season: 2025 }));
    expect(myTeamKey(snap)).not.toBe(myTeamKey({ ...snap, leagueId: "1" }));
    expect(parseMyTeamPick(JSON.stringify({ teamId: "2", source: "you" }))).toEqual({ teamId: "2", source: "you" });
    expect(parseMyTeamPick(JSON.stringify({ teamId: "1", source: "link" }))).toEqual({ teamId: "1", source: "link" });
  });

  it("reads picks stored as a bare team ID as the user's own, and ignores junk", () => {
    expect(parseMyTeamPick("2")).toEqual({ teamId: "2", source: "you" });
    expect(parseMyTeamPick('{"teamId":"3","source":"link"}')).toEqual({ teamId: "3", source: "link" });
    expect(parseMyTeamPick('{"teamId":"3","source":"nonsense"}')).toEqual({ teamId: "3", source: "you" });
    expect(parseMyTeamPick('{"source":"link"}')).toBeUndefined();
    expect(parseMyTeamPick("{broken")).toBeUndefined();
    expect(parseMyTeamPick(null)).toBeUndefined();
  });

  it("never keeps credentials: the request summary has no place for them", () => {
    expect(JSON.stringify(toStoredImport({ request: stored.request, response: stored.response, savedAt: stored.savedAt }))).not.toMatch(/espn_s2|espnS2|swid/i);
  });
});

describe("the pieces the league store shares (Phase 4c: src/lib/leagueStore.ts keeps imports and picks in IndexedDB)", () => {
  it("reads an import already parsed exactly as readStoredImport reads its text", () => {
    const v1 = { ...stored, version: 1 };
    for (const data of [stored, v1, { ...stored, version: IMPORT_FORMAT_VERSION + 1 }, null, 42, [], { version: 1 }]) {
      expect(readImportData(data), JSON.stringify(data)).toEqual(readStoredImport(JSON.stringify(data)));
    }
    expect(readImportData(stored)).toEqual({ kind: "ok", stored });
    expect(readImportData(v1)).toEqual({ kind: "outdated" });
    expect(readImportData(undefined)).toEqual({ kind: "none" });
  });

  it("checks a pick already parsed, and names the league and season of every pick key (a league id may hold anything but the season)", () => {
    expect(checkMyTeamPick({ teamId: "3", source: "link" })).toEqual({ teamId: "3", source: "link" });
    expect(checkMyTeamPick({ teamId: "3", source: "?" })).toEqual({ teamId: "3", source: "you" });
    for (const bad of [null, "3", { teamId: "" }, { teamId: 3 }, []]) expect(checkMyTeamPick(bad), JSON.stringify(bad)).toBeUndefined();
    expect(myTeamKey(snap).startsWith(MY_TEAM_KEY_PREFIX)).toBe(true);
    expect(parseMyTeamKey(myTeamKey(snap))).toEqual({ platform: "sleeper", leagueId: "123456789012345678", season: 2026 });
    expect(parseMyTeamKey(myTeamKey(espnSnap))).toEqual({ platform: "espn", leagueId: "4242", season: 2026 });
    expect(parseMyTeamKey(`${MY_TEAM_KEY_PREFIX}espn:a:b:2025`)).toEqual({ platform: "espn", leagueId: "a:b", season: 2025 });
    for (const bad of [IMPORT_STORAGE_KEY, `${MY_TEAM_KEY_PREFIX}espn:4242`, `${MY_TEAM_KEY_PREFIX}espn:4242:26`, "offersheet:myteam:v2:espn:1:2026"]) expect(parseMyTeamKey(bad), bad).toBeUndefined();
  });

  it("states the import's pick rule as a change: set a link pick, keep the user's, clear a link pick the platform overrides", () => {
    const known = { ...espnSnap, myTeamId: "3" } as LeagueSnapshot;
    expect(pickAfterImport(espnSnap, undefined, "7")).toEqual({ kind: "set", pick: { teamId: "7", source: "link" } });
    expect(pickAfterImport(espnSnap, { teamId: "7", source: "link" }, "3")).toEqual({ kind: "set", pick: { teamId: "3", source: "link" } });
    expect(pickAfterImport(espnSnap, { teamId: "3", source: "you" }, "7")).toEqual({ kind: "keep" });
    // The user's pick of a team no longer in the league gives way to the link.
    expect(pickAfterImport(espnSnap, { teamId: "99", source: "you" }, "7")).toEqual({ kind: "set", pick: { teamId: "7", source: "link" } });
    expect(pickAfterImport(espnSnap, undefined, "42")).toEqual({ kind: "keep" });
    expect(pickAfterImport(espnSnap, undefined)).toEqual({ kind: "keep" });
    // Refresh brings no hint: a link pick stays.
    expect(pickAfterImport(espnSnap, { teamId: "7", source: "link" })).toEqual({ kind: "keep" });
    expect(pickAfterImport(known, { teamId: "7", source: "link" }, "7")).toEqual({ kind: "clear" });
    expect(pickAfterImport(known, { teamId: "7", source: "you" })).toEqual({ kind: "keep" });
  });
});
