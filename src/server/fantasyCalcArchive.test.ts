/**
 * FantasyCalc value archive (planner reply to Checkpoint 4, change 7): the pure core on hand-built rows, the fs layer in
 * a temporary folder, and buildModelInputs' hook on fake HTTP clients. No network. Every player here is fictional.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FANTASYCALC_DYNASTY_MIN_PLAYERS, FANTASYCALC_REDRAFT_MIN_PLAYERS, fantasyCalcValuesUrl } from "@/data/fantasyCalcValues";
import { fakeHttp, type FakeRoute } from "@/data/testSupport";
import type { FantasyCalcFormat } from "@/engine/inputs";
import type { LeagueSettings, LeagueSnapshot, PlayerInfo, Pos } from "@/engine/model";
import {
  FANTASYCALC_ARCHIVE_DIR,
  archiveDay,
  archiveFantasyCalcLists,
  archivedFormat,
  archivedValues,
  createFantasyCalcArchiver,
  defaultFantasyCalcArchiver,
  fantasyCalcArchiveEnabled,
  fantasyCalcFormatKey,
  fantasyCalcListsIn,
  fantasyCalcSnapshotFile,
  fantasyCalcSnapshotLocation,
  fantasyCalcSnapshotOf,
  mergeFantasyCalcSnapshot,
  readFantasyCalcSnapshot,
  type ArchivableRow,
  type FantasyCalcArchiveInput,
  type FantasyCalcArchiveOutcome,
  type FantasyCalcArchiver,
  type FantasyCalcSnapshot,
} from "./fantasyCalcArchive";
import { buildModelInputs, marketFormats } from "./modelInputs";

const REDRAFT: FantasyCalcFormat = { isDynasty: false, numQbs: 1, numTeams: 10, ppr: 0.5, substitutions: ["12 teams → FantasyCalc's 10-team values"] };
const DYNASTY_TEP: FantasyCalcFormat = { isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1, tep: "te+", substitutions: [] };
/** Saturday 2026-10-03, 14:30 UTC, and times around it. */
const SAT = Date.parse("2026-10-03T14:30:00.000Z");
const HOUR = 3_600_000;

function row(id: string, value: number, extra: Partial<ArchivableRow> = {}): ArchivableRow {
  return { fantasyCalcId: id, sleeperId: `9${id}`, espnId: null, position: "WR", value, redraftValue: null, ...extra };
}

function list(rows: ArchivableRow[], extra: Partial<FantasyCalcArchiveInput> = {}): FantasyCalcArchiveInput {
  return { format: REDRAFT, players: rows, fetchedAt: SAT, ...extra };
}

// ---------------------------------------------------------------------------------------------

describe("where a list goes (format key, day, season)", () => {
  it("names the file after the request's parameters, with only characters every file system takes", () => {
    expect(fantasyCalcFormatKey(REDRAFT)).toBe("redraft-1qb-10team-ppr0.5");
    expect(fantasyCalcFormatKey(DYNASTY_TEP)).toBe("dynasty-2qb-12team-ppr1-teplus");
    expect(fantasyCalcFormatKey({ ...DYNASTY_TEP, tep: "te++" })).toBe("dynasty-2qb-12team-ppr1-teplusplus");
    expect(fantasyCalcFormatKey({ isDynasty: false, numQbs: 1, numTeams: 12, ppr: 0 })).toBe("redraft-1qb-12team-ppr0");
    for (const f of [REDRAFT, DYNASTY_TEP, { ...DYNASTY_TEP, tep: "te++" as const }]) expect(fantasyCalcFormatKey(f)).toMatch(/^[a-z0-9.-]+$/);
  });

  it("names no file for parameters FantasyCalc doesn't take, so nothing else can reach a path", () => {
    const bad = (over: Record<string, unknown>) => fantasyCalcFormatKey({ ...REDRAFT, ...over } as unknown as FantasyCalcFormat);
    expect(bad({ numQbs: 3 })).toBeNull();
    expect(bad({ numTeams: 10.5 })).toBeNull();
    expect(bad({ numTeams: 0 })).toBeNull();
    expect(bad({ ppr: 0.25 })).toBeNull();
    expect(bad({ tep: "te+++" })).toBeNull();
    expect(bad({ tep: "../x" })).toBeNull();
    expect(bad({ isDynasty: "true" })).toBeNull();
    // Names every plain object answers to (Object.prototype's) are no tep either: no function source in a file name.
    for (const tep of ["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"]) expect(bad({ tep })).toBeNull();
    // No TE premium, as the request leaves it out.
    expect(bad({ tep: undefined })).toBe("redraft-1qb-10team-ppr0.5");
    expect(bad({ tep: "" })).toBe("redraft-1qb-10team-ppr0.5");
  });

  it("files by the UTC day of fetchedAt, whatever the local time zone", () => {
    expect(archiveDay(Date.parse("2026-10-03T23:59:59.999Z"))).toBe("2026-10-03");
    expect(archiveDay(Date.parse("2026-10-04T00:00:00.000Z"))).toBe("2026-10-04");
    expect(archiveDay(undefined)).toBeNull();
    expect(archiveDay(Number.NaN)).toBeNull();
    expect(archiveDay(8.64e15 + 1)).toBeNull();
  });

  it("files under the NFL season the day falls in (January and February belong to last season)", () => {
    const at = (iso: string) => fantasyCalcSnapshotLocation({ format: REDRAFT, fetchedAt: Date.parse(iso) });
    expect(at("2026-10-03T14:30:00Z")).toEqual({ location: { season: 2026, day: "2026-10-03", key: "redraft-1qb-10team-ppr0.5" } });
    expect(at("2027-01-15T12:00:00Z")).toEqual({ location: { season: 2026, day: "2027-01-15", key: "redraft-1qb-10team-ppr0.5" } });
    expect(at("2027-03-01T12:00:00Z")).toEqual({ location: { season: 2027, day: "2027-03-01", key: "redraft-1qb-10team-ppr0.5" } });
    expect(fantasyCalcSnapshotLocation({ format: REDRAFT })).toEqual({ skipped: "no fetch time" });
    expect(fantasyCalcSnapshotLocation({ format: { ...REDRAFT, ppr: 2 as 1 }, fetchedAt: SAT })).toEqual({ skipped: "unknown format" });
    expect(fantasyCalcSnapshotFile("root", { season: 2026, day: "2026-10-03", key: "redraft-1qb-10team-ppr0.5" })).toBe(path.join("root", "2026", "2026-10-03", "redraft-1qb-10team-ppr0.5.json.gz"));
  });

  it("lives in git-ignored data-local/", () => {
    expect(FANTASYCALC_ARCHIVE_DIR).toBe(path.join("data-local", "fantasycalc-snapshots"));
  });
});

describe("what is kept (only the fields a backtest needs; no league data)", () => {
  it("keeps the ids for the join, the position and the values, and drops names, teams and other platforms' ids", () => {
    const full = { ...row("1001", 6123, { espnId: "4040", redraftValue: 5900 }), name: "Fictional Player", team: "KC", mflId: "15000", fleaflickerId: "777" } as ArchivableRow;
    expect(archivedValues([full])).toEqual({ "1001": { sleeperId: "91001", espnId: "4040", pos: "WR", value: 6123, redraftValue: 5900 } });
  });

  it("leaves out missing ids and values, keeps FantasyCalc's ranks when a loader carries them, and the first row per id wins", () => {
    const out = archivedValues([
      row("1", 900, { sleeperId: null, espnId: "  " }),
      row("2", 800, { overallRank: 14, positionRank: 6 }),
      row("1", 1, { position: "QB" }),
      row("3", Number.NaN),
      row("", 700),
      row("4", 600, { redraftValue: Number.POSITIVE_INFINITY, overallRank: null }),
    ]);
    expect(out).toEqual({ "1": { pos: "WR", value: 900 }, "2": { sleeperId: "92", pos: "WR", value: 800, overallRank: 14, positionRank: 6 }, "4": { sleeperId: "94", pos: "WR", value: 600 } });
  });

  it("a day's copy holds the request's parameters (never the league's substitution notes) and when FantasyCalc served it", () => {
    const got = fantasyCalcSnapshotOf(list([row("1", 900)]));
    expect(got).toEqual({
      location: { season: 2026, day: "2026-10-03", key: "redraft-1qb-10team-ppr0.5" },
      record: { version: 1, format: { isDynasty: false, numQbs: 1, numTeams: 10, ppr: 0.5 }, fetchedAt: "2026-10-03T14:30:00.000Z", players: { "1": { sleeperId: "91", pos: "WR", value: 900 } } },
    });
    expect(archivedFormat(DYNASTY_TEP)).toEqual({ isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1, tep: "te+" });
    expect(fantasyCalcSnapshotOf(list([row("1", Number.NaN)]))).toEqual({ skipped: "no players" });
    expect(fantasyCalcSnapshotOf(list([row("1", 900)], { fetchedAt: undefined }))).toEqual({ skipped: "no fetch time" });
  });

  it("the merge rule keeps the first stored copy of a day", () => {
    const first = (fantasyCalcSnapshotOf(list([row("1", 900)])) as { record: FantasyCalcSnapshot }).record;
    const later = (fantasyCalcSnapshotOf(list([row("1", 950)], { fetchedAt: SAT + 5 * HOUR })) as { record: FantasyCalcSnapshot }).record;
    expect(mergeFantasyCalcSnapshot(first, later)).toEqual({ record: first, write: false });
    expect(mergeFantasyCalcSnapshot(null, later)).toEqual({ record: later, write: true });
  });

  it("finds every loaded list in a build's loads (its own, a keeper league's redraft list, any added later), never /players", () => {
    const values = list([row("1", 900)]);
    const redraft = list([row("1", 800)], { format: { ...REDRAFT, isDynasty: false } });
    const added = list([row("1", 700)], { format: DYNASTY_TEP });
    const players = [{ fantasyCalcId: "1", name: "Fictional", position: "WR", sleeperId: "91" }];
    expect(fantasyCalcListsIn({ values, redraft, players })).toEqual([values, redraft]);
    expect(fantasyCalcListsIn({ values, players: null, later: added })).toEqual([values, added]);
    expect(fantasyCalcListsIn({ values, redraft: undefined, odd: { format: null, players: [] }, odder: { format: REDRAFT } })).toEqual([values]);
    expect(fantasyCalcListsIn(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the fs layer (a temporary folder)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "offer-sheet-fc-archive-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes a day's copy once, atomically, and reads it back", async () => {
    const archiver = createFantasyCalcArchiver({ root: dir });
    const first = await archiver.archive(list([row("1", 900), row("2", 800, { espnId: "3131" })]));
    const file = path.join(dir, "2026", "2026-10-03", "redraft-1qb-10team-ppr0.5.json.gz");
    expect(first).toEqual({ status: "archived", file });
    expect(await readFantasyCalcSnapshot(file)).toEqual({
      version: 1,
      format: { isDynasty: false, numQbs: 1, numTeams: 10, ppr: 0.5 },
      fetchedAt: "2026-10-03T14:30:00.000Z",
      players: { "1": { sleeperId: "91", pos: "WR", value: 900 }, "2": { sleeperId: "92", espnId: "3131", pos: "WR", value: 800 } },
    });
    // The League page builds again: the same cached list, and a later fetch the same day, change nothing.
    expect(await archiver.archive(list([row("1", 900)]))).toEqual({ status: "unchanged", file });
    expect(await archiver.archive(list([row("1", 999)], { fetchedAt: SAT + 6 * HOUR }))).toEqual({ status: "unchanged", file });
    // Another process (no memory of it) finds it on disk and keeps it.
    expect(await createFantasyCalcArchiver({ root: dir }).archive(list([row("1", 999)], { fetchedAt: SAT + 7 * HOUR }))).toEqual({ status: "unchanged", file });
    expect((await readFantasyCalcSnapshot(file))?.players["1"]?.value).toBe(900);
    // The next day's list is a file of its own; so is another format.
    const next = await archiver.archive(list([row("1", 910)], { fetchedAt: SAT + 24 * HOUR }));
    expect(next).toEqual({ status: "archived", file: path.join(dir, "2026", "2026-10-04", "redraft-1qb-10team-ppr0.5.json.gz") });
    const dynasty = await archiver.archive(list([row("1", 4000)], { format: DYNASTY_TEP }));
    expect(dynasty).toEqual({ status: "archived", file: path.join(dir, "2026", "2026-10-03", "dynasty-2qb-12team-ppr1-teplus.json.gz") });
    await archiver.flush();
    expect(await readFantasyCalcSnapshot(path.join(dir, "2026", "2026-10-04", "missing.json.gz"))).toBeNull();
  });

  it("files one copy when the same list arrives twice at once (one write at a time per file)", async () => {
    const archiver = createFantasyCalcArchiver({ root: dir });
    const both = await Promise.all([archiver.archive(list([row("1", 900)])), archiver.archive(list([row("1", 901)], { fetchedAt: SAT + HOUR }))]);
    expect(both.map((o) => o.status)).toEqual(["archived", "unchanged"]);
    const files = both.map((o) => ("file" in o ? o.file : ""));
    expect((await readFantasyCalcSnapshot(files[0] as string))?.players["1"]?.value).toBe(900);
  });

  it("skips what it can't file, without touching the disk", async () => {
    const archiver = createFantasyCalcArchiver({ root: path.join(dir, "never") });
    expect(await archiver.archive(list([row("1", 900)], { fetchedAt: undefined }))).toEqual({ status: "skipped", reason: "no fetch time" });
    expect(await archiver.archive(list([row("1", 900)], { format: { ...REDRAFT, numTeams: 10.5 } }))).toEqual({ status: "skipped", reason: "unknown format" });
    expect(await archiver.archive(list([]))).toEqual({ status: "skipped", reason: "no players" });
    await expect(stat(path.join(dir, "never"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("replaces an unreadable file, leaves one of another version alone, and logs no path", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const day = path.join(dir, "2026", "2026-10-03");
    const archiver = createFantasyCalcArchiver({ root: dir });
    await archiver.archive(list([row("1", 900)]));
    const file = path.join(day, "redraft-1qb-10team-ppr0.5.json.gz");
    await writeFile(file, "not gzip");
    expect(await createFantasyCalcArchiver({ root: dir }).archive(list([row("1", 905)]))).toEqual({ status: "archived", file });
    expect((await readFantasyCalcSnapshot(file))?.players["1"]?.value).toBe(905);

    const v2 = gzipSync(Buffer.from(JSON.stringify({ version: 2, anything: true })));
    await writeFile(file, v2);
    expect(await createFantasyCalcArchiver({ root: dir }).archive(list([row("1", 910)]))).toEqual({ status: "failed", error: "OtherVersion" });
    expect(await readFile(file)).toEqual(v2);
    expect(errors.mock.calls.map((c) => String(c[0]))).toEqual([JSON.stringify({ route: "server", event: "fantasycalc_archive_replaced" })]);
    for (const [message] of errors.mock.calls) expect(String(message)).not.toContain(dir);
  });

  it("never throws into the caller: a failed write says only the error's name", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const blocked = path.join(dir, "a-file");
    await writeFile(blocked, "x");
    const outcome = await createFantasyCalcArchiver({ root: blocked }).archive(list([row("1", 900)]));
    expect(outcome.status).toBe("failed");
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toMatch(/^\{"route":"server","event":"fantasycalc_archive_failed","errorName":"\w+"\}$/);
    expect(String(errors.mock.calls[0]?.[0])).not.toContain(dir);
  });

  it("archiveFantasyCalcLists hands every list over without waiting, and swallows an archiver's failures", async () => {
    const seen: FantasyCalcArchiveInput[] = [];
    const never: FantasyCalcArchiver = { archive: (l) => (seen.push(l), new Promise<FantasyCalcArchiveOutcome>(() => {})), flush: async () => {} };
    const values = list([row("1", 900)]);
    const redraft = list([row("1", 800)]);
    archiveFantasyCalcLists(never, { values, redraft, players: null });
    expect(seen).toEqual([values, redraft]);
    const throwing: FantasyCalcArchiver = {
      archive: () => {
        throw new TypeError("boom");
      },
      flush: async () => {},
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => archiveFantasyCalcLists(throwing, { values })).not.toThrow();
    expect(String(errors.mock.calls[0]?.[0])).toBe(JSON.stringify({ route: "server", event: "fantasycalc_archive_failed", errorName: "TypeError" }));
    const rejecting: FantasyCalcArchiver = { archive: () => Promise.reject(new Error("x")), flush: async () => {} };
    expect(() => archiveFantasyCalcLists(rejecting, { values })).not.toThrow();
    expect(() => archiveFantasyCalcLists(null, { values })).not.toThrow();
    expect(() => archiveFantasyCalcLists(never, null)).not.toThrow();
  });
});

describe("only with a local disk", () => {
  it("is off in production, on Vercel and under Vitest, on under npm run dev and tsx scripts", () => {
    expect(fantasyCalcArchiveEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(fantasyCalcArchiveEnabled({ NODE_ENV: "development", VERCEL: "1" })).toBe(false);
    expect(fantasyCalcArchiveEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(fantasyCalcArchiveEnabled({ VITEST: "true" })).toBe(false);
    expect(fantasyCalcArchiveEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(fantasyCalcArchiveEnabled({})).toBe(true);
    expect(defaultFantasyCalcArchiver()).toBeNull();
  });

  it("the stable copy (OFFERSHEET_DATA_LOCAL, a production build): on, and its lists go to that folder (never on Vercel or under tests)", async () => {
    expect(fantasyCalcArchiveEnabled({ NODE_ENV: "production", OFFERSHEET_DATA_LOCAL: "D:/main/data-local" })).toBe(true);
    expect(fantasyCalcArchiveEnabled({ NODE_ENV: "production", OFFERSHEET_DATA_LOCAL: "D:/main/data-local", VERCEL: "1" })).toBe(false);
    expect(fantasyCalcArchiveEnabled({ NODE_ENV: "production", OFFERSHEET_DATA_LOCAL: "D:/main/data-local", VITEST: "true" })).toBe(false);
    expect(fantasyCalcArchiveEnabled({ NODE_ENV: "production", OFFERSHEET_DATA_LOCAL: " " })).toBe(false);
    const main = await mkdtemp(path.join(os.tmpdir(), "offer-sheet-fc-main-"));
    try {
      vi.stubEnv("OFFERSHEET_DATA_LOCAL", path.join(main, "data-local"));
      const outcome = await createFantasyCalcArchiver().archive(list([row("1", 900)]));
      expect(outcome).toEqual({ status: "archived", file: path.join(main, "data-local", "fantasycalc-snapshots", "2026", "2026-10-03", "redraft-1qb-10team-ppr0.5.json.gz") });
    } finally {
      vi.unstubAllEnvs();
      await rm(main, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The hook in buildModelInputs. Only FantasyCalc's values answer; every other source is a 404 (a warning).

const weeks = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const SETTINGS: LeagueSettings = {
  numTeams: 10,
  leagueType: "redraft",
  lineup: [
    { slot: "QB", count: 1, eligible: ["QB"] },
    { slot: "RB", count: 2, eligible: ["RB"] },
    { slot: "WR", count: 2, eligible: ["WR"] },
    { slot: "TE", count: 1, eligible: ["TE"] },
  ],
  benchSlots: 6,
  irSlots: 1,
  taxiSlots: 0,
  maxRosterSize: 12,
  scoring: { perStat: { rec: 1, rec_yd: 0.1, rush_yd: 0.1, pass_yd: 0.04 }, rules: [], unmapped: [] },
  regularSeasonWeeks: weeks(1, 14),
  playoffWeeks: [15, 16, 17],
  playoffTeams: 4,
  medianGame: false,
  pointsOnly: false,
  tradeDeadline: null,
  tradeReview: "none",
};

function info(id: string, pos: Pos): PlayerInfo {
  return { id, name: `Fictional ${id}`, pos, eligible: [pos], nflTeam: "KC", injury: "ACTIVE", ids: {} };
}

/** A league in week `currentWeek` (18: its season is over, so FantasyCalc is the only source asked for). */
function league(leagueType: LeagueSettings["leagueType"], currentWeek = 18): LeagueSnapshot {
  return {
    platform: "sleeper",
    leagueId: "000000000000000001",
    season: 2026,
    name: "Test League",
    fetchedAt: "2026-12-30T11:00:00.000Z",
    currentWeek,
    settings: { ...SETTINGS, leagueType },
    teams: [{ id: "1", name: "Team 1", ownerName: "Owner 1", roster: ["9001", "9002"], ir: [], taxi: [], record: { w: 9, l: 5, t: 0 }, pointsFor: 1500, pointsAgainst: 1400 }],
    myTeamId: "1",
    players: { "9001": info("9001", "WR"), "9002": info("9002", "RB") },
    schedule: [],
    transactions: [],
    freeAgents: [],
    warnings: [],
  };
}

/** A /values/current body of `n` fictional players (enough to pass the loader's row floor). */
function valuesBody(n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({
    player: { id: 5000 + i, name: `Fictional ${i}`, position: i % 2 ? "RB" : "WR", sleeperId: String(9001 + i), espnId: null, mflId: null, fleaflickerId: null, maybeTeam: "KC" },
    value: 9000 - i,
    redraftValue: 8000 - i,
  }));
}

const FETCHED = Date.parse("2026-12-30T08:00:00.000Z");

/** Every FantasyCalc list a league may ask for (marketFormats), by URL, answered; and each URL's format key. */
function routesFor(s: LeagueSnapshot): { routes: Record<string, FakeRoute>; keyByUrl: Map<string, string | null> } {
  const routes: Record<string, FakeRoute> = {};
  const keyByUrl = new Map<string, string | null>();
  for (const f of Object.values(marketFormats(s.settings)) as FantasyCalcFormat[]) {
    const url = fantasyCalcValuesUrl(f);
    routes[url] = { json: valuesBody(f.isDynasty ? FANTASYCALC_DYNASTY_MIN_PLAYERS : FANTASYCALC_REDRAFT_MIN_PLAYERS), fetchedAt: FETCHED };
    keyByUrl.set(url, fantasyCalcFormatKey(f));
  }
  return { routes, keyByUrl };
}

function recording(): { archiver: FantasyCalcArchiver; lists: FantasyCalcArchiveInput[] } {
  const lists: FantasyCalcArchiveInput[] = [];
  // Its promises never settle: the build must not wait on them.
  return { archiver: { archive: (l) => (lists.push(l), new Promise<FantasyCalcArchiveOutcome>(() => {})), flush: async () => {} }, lists };
}

const keyOf = (f: FantasyCalcArchiveInput["format"]) => fantasyCalcFormatKey(f);
const resolver = { defenseId: (code: string) => code };
const NOW = new Date("2026-12-30T12:00:00.000Z");

describe("buildModelInputs hands every FantasyCalc list it read to the archive (and doesn't wait)", () => {
  it.each([
    ["redraft", 18, 1],
    ["keeper", 18, 2],
    ["dynasty", 18, 1],
    // Mid-season, a dynasty league also reads the redraft list in its format (the market blend's): archived too.
    ["dynasty", 5, 2],
  ] as const)("a %s league in week %i: each list it read, once (%i)", async (leagueType, week, count) => {
    const s = league(leagueType, week);
    const { routes, keyByUrl } = routesFor(s);
    const fake = fakeHttp(routes);
    const { archiver, lists } = recording();
    const out = await buildModelInputs({ snapshot: s, http: fake.http, resolver, now: NOW, fantasyCalcArchive: archiver });
    expect(out.market).not.toBeNull();
    const read = fake.calls.map((c) => c.url).filter((u) => keyByUrl.has(u));
    expect(lists.map((l) => keyOf(l.format)).sort()).toEqual(read.map((u) => keyByUrl.get(u)).sort());
    expect(lists).toHaveLength(count);
    expect(lists.every((l) => l.fetchedAt === FETCHED && l.players.length >= FANTASYCALC_REDRAFT_MIN_PLAYERS)).toBe(true);
  });

  it("archives nothing when FantasyCalc's values didn't load, or when told not to", async () => {
    const s = league("redraft");
    const down = recording();
    const { routes } = routesFor(s);
    for (const url of Object.keys(routes)) routes[url] = { status: 503, json: null };
    const out = await buildModelInputs({ snapshot: s, http: fakeHttp(routes).http, resolver, now: NOW, fantasyCalcArchive: down.archiver });
    expect(out.market).toBeNull();
    expect(down.lists).toEqual([]);
    const fake = fakeHttp(routesFor(s).routes);
    await expect(buildModelInputs({ snapshot: s, http: fake.http, resolver, now: NOW, fantasyCalcArchive: null })).resolves.toMatchObject({ market: { format: { isDynasty: false } } });
  });
});
