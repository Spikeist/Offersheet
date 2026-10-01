import { describe, expect, it } from "vitest";
import type { LeagueSnapshot } from "@/engine/model";
import {
  IMPORT_FORMAT_VERSION,
  IMPORT_STORAGE_KEY,
  OUTDATED_IMPORT_TEXT,
  OUTDATED_IMPORT_TITLE,
  myTeamKey,
  parseMyTeamPick,
  parseStoredImport,
  readStoredImport,
  recordImport,
  saveImport,
  saveMyTeam,
  toStoredImport,
  type StorageLike,
  type StoredImport,
} from "./importStore";

class FakeStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

class BlockedStorage implements StorageLike {
  getItem(): string | null {
    throw new Error("SecurityError");
  }
  setItem(): void {
    throw new Error("QuotaExceededError");
  }
  removeItem(): void {
    throw new Error("SecurityError");
  }
}

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
const espnRequest = { platform: "espn", season: 2026, leagueId: "4242" } as const;
const SAVED_AT = "2026-09-29T23:00:00.000Z";

function pickIn(s: FakeStorage, snapshot: LeagueSnapshot) {
  return parseMyTeamPick(s.getItem(myTeamKey(snapshot)));
}

describe("import store", () => {
  it("round-trips an import through sessionStorage", () => {
    const s = new FakeStorage();
    expect(saveImport(s, stored)).toEqual({ ok: true });
    expect(parseStoredImport(s.getItem(IMPORT_STORAGE_KEY))).toEqual(stored);
  });

  it("ignores values that aren't ours", () => {
    expect(parseStoredImport(null)).toBeUndefined();
    expect(parseStoredImport("not json")).toBeUndefined();
    expect(parseStoredImport(JSON.stringify({ version: IMPORT_FORMAT_VERSION }))).toBeUndefined();
    expect(parseStoredImport(JSON.stringify({ ...stored, response: { snapshot: { platform: "espn" }, notes: [] } }))).toBeUndefined();
    expect(parseStoredImport(JSON.stringify({ ...stored, response: { snapshot: snap } }))).toBeUndefined();
  });

  it("saves this version's format: 2 since Phase 3, whose snapshots carry matchup results (lead decision D8)", () => {
    expect(IMPORT_FORMAT_VERSION).toBe(2);
    const { version, ...rest } = stored;
    expect(version).toBe(IMPORT_FORMAT_VERSION);
    expect(toStoredImport(rest)).toEqual(stored);
    const s = new FakeStorage();
    recordImport(s, { request: stored.request, response: stored.response, savedAt: SAVED_AT });
    expect(JSON.parse(s.getItem(IMPORT_STORAGE_KEY) ?? "{}")).toMatchObject({ version: IMPORT_FORMAT_VERSION });
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

  it("replaces an old-format record in place when the league is imported again (same key: sessionStorage never holds both)", () => {
    const s = new FakeStorage();
    s.setItem(IMPORT_STORAGE_KEY, JSON.stringify({ ...stored, version: 1, savedAt: "2026-09-20T12:00:00.000Z" }));
    expect(parseStoredImport(s.getItem(IMPORT_STORAGE_KEY))).toBeUndefined();
    expect(recordImport(s, { request: stored.request, response: stored.response, savedAt: SAVED_AT })).toEqual({ ok: true });
    expect(parseStoredImport(s.getItem(IMPORT_STORAGE_KEY))).toEqual(stored);
    expect([...s.data.keys()]).toEqual([IMPORT_STORAGE_KEY]);
  });

  it("reports a full or blocked storage instead of throwing", () => {
    const blocked = new BlockedStorage();
    expect(saveImport(blocked, stored).ok).toBe(false);
    expect(recordImport(blocked, { request: stored.request, response: stored.response, savedAt: SAVED_AT }).ok).toBe(false);
    expect(() => saveMyTeam(blocked, snap, "1")).not.toThrow();
  });

  it("keeps the user's team pick per league and season, with where it came from", () => {
    const s = new FakeStorage();
    saveMyTeam(s, snap, "2");
    expect(pickIn(s, snap)).toEqual({ teamId: "2", source: "you" });
    expect(s.getItem(myTeamKey({ ...snap, season: 2025 }))).toBeNull();
    saveMyTeam(s, snap, "1", "link");
    expect(pickIn(s, snap)).toEqual({ teamId: "1", source: "link" });
    saveMyTeam(s, snap, null);
    expect(s.getItem(myTeamKey(snap))).toBeNull();
  });

  it("reads picks stored as a bare team ID as the user's own, and ignores junk", () => {
    expect(parseMyTeamPick("2")).toEqual({ teamId: "2", source: "you" });
    expect(parseMyTeamPick('{"teamId":"3","source":"link"}')).toEqual({ teamId: "3", source: "link" });
    expect(parseMyTeamPick('{"teamId":"3","source":"nonsense"}')).toEqual({ teamId: "3", source: "you" });
    expect(parseMyTeamPick('{"source":"link"}')).toBeUndefined();
    expect(parseMyTeamPick("{broken")).toBeUndefined();
    expect(parseMyTeamPick(null)).toBeUndefined();
  });

  it("never stores credentials: the request summary has no place for them", () => {
    const s = new FakeStorage();
    saveImport(s, stored);
    const raw = s.getItem(IMPORT_STORAGE_KEY) ?? "";
    expect(raw).not.toMatch(/espn_s2|espnS2|swid/i);
  });
});

describe("recordImport: a team from a pasted ESPN team link", () => {
  it("is kept as a pick to confirm, under the per-league key (so Refresh keeps it)", () => {
    const s = new FakeStorage();
    expect(recordImport(s, { request: espnRequest, response: { snapshot: espnSnap, notes: [] }, savedAt: SAVED_AT, teamHint: "7" })).toEqual({ ok: true });
    expect(pickIn(s, espnSnap)).toEqual({ teamId: "7", source: "link" });
    // Refresh saves the new snapshot without a hint: the pick stays.
    recordImport(s, { request: espnRequest, response: { snapshot: espnSnap, notes: [] }, savedAt: SAVED_AT });
    expect(pickIn(s, espnSnap)).toEqual({ teamId: "7", source: "link" });
  });

  it("is ignored when it isn't a team in this league", () => {
    const s = new FakeStorage();
    recordImport(s, { request: espnRequest, response: { snapshot: espnSnap, notes: [] }, savedAt: SAVED_AT, teamHint: "42" });
    expect(pickIn(s, espnSnap)).toBeUndefined();
  });

  it("never replaces a team the user picked", () => {
    const s = new FakeStorage();
    saveMyTeam(s, espnSnap, "3");
    recordImport(s, { request: espnRequest, response: { snapshot: espnSnap, notes: [] }, savedAt: SAVED_AT, teamHint: "7" });
    expect(pickIn(s, espnSnap)).toEqual({ teamId: "3", source: "you" });
  });

  it("gives way when the platform knows the user's team (ESPN cookies)", () => {
    const s = new FakeStorage();
    saveMyTeam(s, espnSnap, "7", "link");
    const known = { ...espnSnap, myTeamId: "3" } as LeagueSnapshot;
    recordImport(s, { request: espnRequest, response: { snapshot: known, notes: [] }, savedAt: SAVED_AT, teamHint: "7" });
    expect(pickIn(s, known)).toBeUndefined();
  });
});
