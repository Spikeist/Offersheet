import { describe, expect, it } from "vitest";
import type { LeagueSnapshot } from "@/engine/model";
import { IMPORT_STORAGE_KEY, myTeamKey, parseMyTeamPick, parseStoredImport, recordImport, saveImport, saveMyTeam, type StorageLike, type StoredImport } from "./importStore";

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
  version: 1,
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
    expect(parseStoredImport(JSON.stringify({ version: 2 }))).toBeUndefined();
    expect(parseStoredImport(JSON.stringify({ ...stored, response: { snapshot: { platform: "espn" }, notes: [] } }))).toBeUndefined();
    expect(parseStoredImport(JSON.stringify({ ...stored, response: { snapshot: snap } }))).toBeUndefined();
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
