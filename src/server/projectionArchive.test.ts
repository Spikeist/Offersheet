/**
 * Pre-game projection archive (CLAUDE.md §2.3 "Pre-game snapshots"): the pure core on hand-built and
 * committed Sleeper rows, and the fs layer in a temporary folder. No network.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatRowSchema, type SleeperStatRow } from "@/adapters/sleeper/schemas";
import type { HttpResponse } from "@/adapters/types";
import { reduceNflSchedule, type NflScheduleResponse } from "@/data/nflSchedule";
import { FIXTURE } from "@/data/testSupport";
import type { Pos } from "@/engine/model";
import { readSanitizedFixture } from "@/test-utils/fixtures";
import {
  ARCHIVE_DROPPED_STAT,
  archivedGroups,
  archivedStats,
  archiveSkip,
  beforeKickoff,
  createProjectionArchiver,
  DATA_LOCAL_ENV,
  dataLocalRoot,
  defaultProjectionArchiver,
  firstKickoffOf,
  lastModifiedById,
  mergeSnapshot,
  PROJECTION_ARCHIVE_DIR,
  projectionArchiveEnabled,
  projectionSnapshotFile,
  projectionSnapshotSchema,
  readProjectionSnapshot,
  rowGroups,
  type ArchiveFetch,
  type ProjectionArchiveInput,
  type ProjectionSnapshot,
} from "./projectionArchive";

const SEASON = 2026;
const POS: Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
const ALL: Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];
/** Week 5's first kickoff (a Thursday night game) and times around it. */
const KICKOFF = Date.parse("2026-10-09T00:15:00.000Z");
const HOUR = 3_600_000;
const BEFORE = KICKOFF - 30 * HOUR;

type Row = { player_id: string; stats?: Record<string, unknown>; player?: Record<string, unknown>; last_modified?: number };
const parse = (rows: unknown[]) => rows.map((r) => StatRowSchema.parse(r) as SleeperStatRow);
const PROJ4 = "sleeper/projections/2026/4 (top 150 QB/RB/WR/TE + 6 per K/DEF/IDP)";

// Fictional players (made-up ids); a team defense is keyed by its team code.
const qb = (id: string, passYd: number, at = 1_000): Row => ({ player_id: id, stats: { gp: 1, pass_yd: passYd, pass_td: 1.6666, pts_ppr: 18.2, adp_dd_ppr: 12, pos_adp_dd_ppr: 4, rank_ppr: 7 }, player: { position: "QB", fantasy_positions: ["QB"] }, last_modified: at });
const rb = (id: string, rushYd: number, at = 1_000): Row => ({ player_id: id, stats: { gp: 1, rush_yd: rushYd, rec: 2.5 }, player: { position: "RB", fantasy_positions: ["RB"] }, last_modified: at });

function response(rawRows: unknown[], fetchedAt: number | undefined, extra: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, ok: true, isHtml: false, json: rawRows, text: "", fromCache: false, ...(fetchedAt !== undefined ? { fetchedAt } : {}), ...extra };
}

function input(rawRows: Row[], opts: { week?: number; positions?: Pos[]; fetchedAt?: number | undefined; currentWeek?: number; firstKickoff?: number | null } = {}): ProjectionArchiveInput {
  const fetchedAt = "fetchedAt" in opts ? opts.fetchedAt : BEFORE;
  return {
    season: SEASON,
    week: opts.week ?? 5,
    positions: opts.positions ?? POS,
    rows: parse(rawRows),
    res: response(rawRows, fetchedAt),
    currentWeek: opts.currentWeek ?? 4,
    firstKickoff: opts.firstKickoff === undefined ? KICKOFF : opts.firstKickoff,
  };
}

function fetchOf(groups: ArchiveFetch["groups"], extra: Partial<ArchiveFetch> = {}): ArchiveFetch {
  return { season: SEASON, week: 5, currentWeek: 4, firstKickoff: KICKOFF, fetchedAt: BEFORE, groups, ...extra };
}

const iso = (ms: number) => new Date(ms).toISOString();

// ---------------------------------------------------------------------------------------------

describe("what is kept (only the fields we use)", () => {
  it("archivedStats: numeric stats in Sleeper's keys, minus fantasy points, ADP and ranks, rounded to 3 decimals", () => {
    expect(archivedStats({ pass_yd: 251.23456, pass_td: 1.6666, gp: 1, pts_ppr: 18.2, pts_half_ppr: 17, adp_dd_ppr: 12, pos_adp_dd_ppr: 4, rank_ppr: 7, rank: 3, note: "x", bad: Number.NaN, fum: -0.0001, pass_int: null })).toEqual({
      pass_yd: 251.235,
      pass_td: 1.667,
      gp: 1,
      fum: 0,
    });
    expect(Object.is(archivedStats({ fum: -0.0001 }).fum, 0)).toBe(true); // no -0
    expect(archivedStats(null)).toEqual({});
    expect(["pts_ppr", "pts_half_ppr", "pts_std", "pts_idp", "adp_2qb", "pos_adp_dd_ppr", "rank_std", "ranking"].every((k) => ARCHIVE_DROPPED_STAT.test(k))).toBe(true);
    // A team defense's points allowed is a stat (Sleeper's own keys), not a fantasy-point total.
    expect(["pass_yd", "rec", "pos_rank", "bonus_rec_te", "pts_allow", "pts_allow_0", "pts_allow_21_27", "pts_allow_35p", "yds_allow", "yds_allow_300_349"].some((k) => ARCHIVE_DROPPED_STAT.test(k))).toBe(false);
  });

  it("keeps a team defense's points allowed: pts_allow and its bracket flags stay, the fantasy-point totals go (review DATA-1)", () => {
    expect(archivedStats({ pts_allow: 22.75, pts_allow_21_27: 1, yds_allow: 358.3, yds_allow_350_399: 1, sack: 2.47, pts_ppr: 6.35, pts_half_ppr: 6.35, pts_std: 6.35, gp: 1 })).toEqual({
      pts_allow: 22.75,
      pts_allow_21_27: 1,
      yds_allow: 358.3,
      yds_allow_350_399: 1,
      sack: 2.47,
      gp: 1,
    });
    // The committed week-4 capture: every team defense keeps its projected points allowed.
    const raw = readSanitizedFixture<Row[]>("shared", PROJ4);
    const defRows = raw.filter((r) => r.player?.position === "DEF");
    expect(defRows).toHaveLength(6);
    const def = archivedGroups(parse(raw), POS).groups.DEF?.players ?? {};
    expect(Object.keys(def).sort()).toEqual(defRows.map((r) => r.player_id).sort());
    for (const row of defRows) {
      const kept = def[row.player_id]?.stats ?? {};
      expect(kept.pts_allow, row.player_id).toBe(row.stats?.pts_allow);
      expect(kept.yds_allow, row.player_id).toBe(row.stats?.yds_allow);
      expect(Object.keys(kept).filter((k) => k.startsWith("pts_allow_")), row.player_id).toHaveLength(1); // its bracket flag
      expect(Object.keys(kept).some((k) => /^pts_(ppr|half_ppr|std)$/.test(k)), row.player_id).toBe(false);
    }
  });

  it("rowGroups: the requested positions the player's fantasy positions (or position) name; a team code is DEF; one requested position takes every row", () => {
    const row = (player: Record<string, unknown> | undefined, id = "90001") => parse([{ player_id: id, stats: { rec: 1 }, ...(player ? { player } : {}) }])[0] as SleeperStatRow;
    expect(rowGroups(row({ position: "FB", fantasy_positions: ["RB"] }), POS)).toEqual(["RB"]);
    expect(rowGroups(row({ position: "CB", fantasy_positions: ["DB"] }), ALL)).toEqual(["DB"]);
    expect(rowGroups(row({ position: "DB", fantasy_positions: ["DB", "WR"] }), ALL)).toEqual(["WR", "DB"]); // request order
    expect(rowGroups(row({ position: "DB", fantasy_positions: ["DB", "WR"] }), POS)).toEqual(["WR"]);
    expect(rowGroups(row({ position: "LB" }), ALL)).toEqual(["LB"]);
    expect(rowGroups(row(undefined, "KC"), POS)).toEqual(["DEF"]);
    expect(rowGroups(row({ position: "LB", fantasy_positions: ["LB"] }), POS)).toEqual([]);
    expect(rowGroups(row(undefined), ["TE"])).toEqual(["TE"]);
  });

  it("lastModifiedById: the latest last_modified per player id, from the raw rows", () => {
    expect(lastModifiedById([{ player_id: "1", last_modified: 5 }, { player_id: 1, last_modified: 9 }, { player_id: "2" }, { player_id: "3", last_modified: "soon" }, null, "x"])).toEqual(new Map([["1", 9]]));
    expect(lastModifiedById({ rows: [] }).size).toBe(0);
  });

  it("archivedGroups on the committed week-4 capture: real projections only, grouped by requested position, IDP left out when not requested", () => {
    const raw = readSanitizedFixture<Row[]>("shared", PROJ4);
    const rows = parse(raw);
    const lm = lastModifiedById(raw);
    const league = archivedGroups(rows, POS, lm);
    const counts = (g: typeof league.groups) => Object.fromEntries(Object.entries(g).map(([p, x]) => [p, Object.keys(x.players).length]));
    expect(counts(league.groups)).toEqual({ QB: 32, RB: 36, WR: 60, TE: 23, K: 6, DEF: 6 });
    expect(league.unplaced).toBe(17); // DL, LB and DB rows: Sleeper wouldn't send them for this request
    const all = archivedGroups(rows, ALL, lm);
    expect(counts(all.groups)).toEqual({ QB: 32, RB: 36, WR: 60, TE: 23, K: 6, DEF: 6, DL: 11, LB: 10, DB: 6 });
    expect(all.unplaced).toBe(0);
    const gibbs = raw.find((r) => r.player_id === "9221") as Row;
    expect(all.groups.RB?.players["9221"]).toEqual({ pos: "RB", stats: archivedStats(gibbs.stats) });
    expect(Object.keys(all.groups.RB?.players["9221"]?.stats ?? {}).some((k) => /^(pts_(ppr|half_ppr|std)$|adp_|pos_adp_)/.test(k))).toBe(false);
    for (const [position, group] of Object.entries(all.groups)) {
      const stamps = Object.keys(group.players).map((id) => lm.get(id) as number);
      expect(group.lastModified, position).toBe(Math.max(...stamps));
    }
  });

  it("archivedGroups: stubs are dropped, the first real row per player wins, and a position without a real projection adds no group", () => {
    const rows = parse([
      { player_id: "90001", stats: { adp_dd_ppr: 40, gp: 1 }, player: { position: "QB", fantasy_positions: ["QB"] } }, // a stub
      qb("90002", 250, 7),
      qb("90002", 300, 8), // a second real row: ignored
      { player_id: "90003", stats: { pts_ppr: 0, adp_dd_ppr: 99 }, player: { position: "RB", fantasy_positions: ["RB"] } }, // a stub
    ]);
    const { groups, unplaced } = archivedGroups(rows, POS);
    expect(groups).toEqual({ QB: { lastModified: null, players: { "90002": { pos: "QB", stats: { gp: 1, pass_yd: 250, pass_td: 1.667 } } } } });
    expect(unplaced).toBe(0);
  });
});

describe("the merge rule (last pre-kickoff fetch per week and position)", () => {
  it("beforeKickoff / archiveSkip: strictly before the known first kickoff; unknown: only a week after the current one; no fetch time: skipped", () => {
    expect(beforeKickoff(KICKOFF - 1, 5, 4, KICKOFF)).toBe(true);
    expect(beforeKickoff(KICKOFF, 5, 4, KICKOFF)).toBe(false);
    expect(beforeKickoff(KICKOFF + HOUR, 5, 4, KICKOFF)).toBe(false);
    expect(beforeKickoff(KICKOFF + 99 * HOUR, 5, 4, null)).toBe(true); // unknown kickoff, next week: it can't have started
    expect(beforeKickoff(BEFORE, 4, 4, null)).toBe(false); // the current week: can't tell
    const head = { season: SEASON, week: 5, currentWeek: 4 };
    expect(archiveSkip({ ...head, firstKickoff: KICKOFF, fetchedAt: KICKOFF - 1 })).toBeUndefined();
    expect(archiveSkip({ ...head, firstKickoff: KICKOFF, fetchedAt: KICKOFF })).toBe("after kickoff");
    expect(archiveSkip({ ...head, week: 4, firstKickoff: null, fetchedAt: BEFORE })).toBe("kickoff unknown");
    expect(archiveSkip({ ...head, firstKickoff: KICKOFF, fetchedAt: undefined })).toBe("no fetch time");
  });

  it("a first fetch makes the record: version, season, week, first kickoff and one group per position, fetchedAt in ISO", () => {
    const { groups } = archivedGroups(parse([qb("90002", 250, 7), rb("90010", 80, 9)]), POS, lastModifiedById([qb("90002", 250, 7), rb("90010", 80, 9)]));
    const { record, replaced, skipped } = mergeSnapshot(null, fetchOf(groups));
    expect(skipped).toBeUndefined();
    expect(replaced).toEqual(["QB", "RB"]);
    expect(record).toEqual({
      version: 1,
      season: SEASON,
      week: 5,
      firstKickoff: iso(KICKOFF),
      groups: {
        QB: { fetchedAt: iso(BEFORE), lastModified: 7, players: { "90002": { pos: "QB", stats: { gp: 1, pass_yd: 250, pass_td: 1.667 } } } },
        RB: { fetchedAt: iso(BEFORE), lastModified: 9, players: { "90010": { pos: "RB", stats: { gp: 1, rush_yd: 80, rec: 2.5 } } } },
      },
    });
    expect(projectionSnapshotSchema.safeParse(record).success).toBe(true);
  });

  it("a later pre-kickoff fetch replaces only its own groups; an older or the same fetch changes nothing; after kickoff nothing changes", () => {
    const first = mergeSnapshot(null, fetchOf(archivedGroups(parse([qb("90002", 250), rb("90010", 80)]), POS).groups)).record;
    // A league that starts QBs only, 5 hours later.
    const qbOnly = archivedGroups(parse([qb("90002", 262)]), ["QB"]).groups;
    const later = mergeSnapshot(first, fetchOf(qbOnly, { fetchedAt: BEFORE + 5 * HOUR }));
    expect(later.replaced).toEqual(["QB"]);
    expect(later.record.groups.QB?.players["90002"]?.stats.pass_yd).toBe(262);
    expect(later.record.groups.QB?.fetchedAt).toBe(iso(BEFORE + 5 * HOUR));
    expect(later.record.groups.RB).toEqual(first.groups.RB);
    // The same cached copy read again, and an older one: nothing to write.
    for (const at of [BEFORE + 5 * HOUR, BEFORE + HOUR]) {
      const again = mergeSnapshot(later.record, fetchOf(archivedGroups(parse([qb("90002", 999)]), ["QB"]).groups, { fetchedAt: at }));
      expect(again.replaced).toEqual([]);
      expect(again.record).toEqual(later.record);
    }
    // After the kickoff (and at it), the last pre-kickoff snapshot stays.
    for (const at of [KICKOFF, KICKOFF + HOUR]) {
      const late = mergeSnapshot(later.record, fetchOf(archivedGroups(parse([qb("90002", 999)]), ["QB"]).groups, { fetchedAt: at }));
      expect(late).toMatchObject({ replaced: [], skipped: "after kickoff" });
      expect(late.record).toEqual(later.record);
    }
    // One millisecond before it still counts.
    expect(mergeSnapshot(later.record, fetchOf(qbOnly, { fetchedAt: KICKOFF - 1 })).replaced).toEqual(["QB"]);
  });

  it("an unknown first kickoff: a week after the current one is archived, the current week is skipped; a known kickoff is kept once learned", () => {
    const groups = archivedGroups(parse([qb("90002", 250)]), POS).groups;
    const next = mergeSnapshot(null, fetchOf(groups, { firstKickoff: null }));
    expect(next.replaced).toEqual(["QB"]);
    expect(next.record.firstKickoff).toBeNull();
    const current = mergeSnapshot(null, fetchOf(groups, { week: 4, firstKickoff: null }));
    expect(current).toMatchObject({ replaced: [], skipped: "kickoff unknown" });
    // Learned later: the kickoff is recorded, and it stays when a later fetch doesn't know it.
    const learned = mergeSnapshot(next.record, fetchOf(groups, { fetchedAt: BEFORE + HOUR })).record;
    expect(learned.firstKickoff).toBe(iso(KICKOFF));
    expect(mergeSnapshot(learned, fetchOf(groups, { fetchedAt: BEFORE + 2 * HOUR, firstKickoff: null })).record.firstKickoff).toBe(iso(KICKOFF));
  });

  it("no real projection is nothing to archive; a stored record of another week is ignored", () => {
    expect(mergeSnapshot(null, fetchOf({}))).toMatchObject({ replaced: [], skipped: "no projections" });
    const week6: ProjectionSnapshot = { version: 1, season: SEASON, week: 6, firstKickoff: null, groups: { RB: { fetchedAt: iso(BEFORE), lastModified: null, players: {} } } };
    const merged = mergeSnapshot(week6, fetchOf(archivedGroups(parse([qb("90002", 250)]), POS).groups));
    expect(Object.keys(merged.record.groups)).toEqual(["QB"]);
    expect(merged.record.week).toBe(5);
  });

  it("firstKickoffOf: the week's earliest known kickoff in the NFL schedule (the committed ESPN schedule: week 4 opens on Thursday night)", () => {
    const schedule = reduceNflSchedule(readSanitizedFixture<NflScheduleResponse>("shared", FIXTURE.espnProTeams), (a) => a);
    const week4 = firstKickoffOf(schedule, 4) as number;
    expect(week4).toBe(Math.min(...Object.values(schedule.kickoffs[4] ?? {})));
    expect(new Date(week4).getUTCDay()).toBe(5); // Thursday evening in the US is early Friday UTC
    expect(new Date(week4).toISOString().slice(0, 10)).toBe("2026-10-02");
    expect(firstKickoffOf(schedule, 19)).toBeNull();
    expect(firstKickoffOf(null, 4)).toBeNull();
    expect(firstKickoffOf({ kickoffs: { 5: { KC: 30, DAL: 20 } } }, 5)).toBe(20);
  });
});

// ---------------------------------------------------------------------------------------------
// The fs layer

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "offer-sheet-archive-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const fileOf = (week: number) => projectionSnapshotFile(dir, SEASON, week);
const decompress = async (file: string) => JSON.parse(gunzipSync(await readFile(file)).toString("utf8")) as unknown;

describe("createProjectionArchiver (the fs layer)", () => {
  it("writes data-local/projection-snapshots/<season>/week-<WW>.json.gz: gzip JSON with the snapshot's shape", async () => {
    expect(PROJECTION_ARCHIVE_DIR.split(path.sep)).toEqual(["data-local", "projection-snapshots"]);
    expect(path.relative(dir, fileOf(5)).split(path.sep)).toEqual(["2026", "week-05.json.gz"]);
    const archiver = createProjectionArchiver({ root: dir });
    const raw = readSanitizedFixture<Row[]>("shared", PROJ4);
    const outcome = await archiver.archive(input(raw, { positions: ALL }));
    expect(outcome).toEqual({ status: "archived", file: fileOf(5), replaced: ALL });
    const json = await decompress(fileOf(5));
    expect(projectionSnapshotSchema.safeParse(json).success).toBe(true);
    const back = await readProjectionSnapshot(fileOf(5));
    expect(back).toEqual(json);
    expect(back?.firstKickoff).toBe(iso(KICKOFF));
    expect(Object.values(back?.groups ?? {}).every((g) => g.fetchedAt === iso(BEFORE))).toBe(true);
    // Compressed, and far smaller than the raw rows it came from.
    const size = (await stat(fileOf(5))).size;
    expect(size).toBeLessThan(JSON.stringify(raw).length / 5);
    expect(await readProjectionSnapshot(fileOf(6))).toBeNull();
  });

  it("merges on disk: a later fetch of some positions replaces only those; the same cached copy again costs no disk I/O", async () => {
    const archiver = createProjectionArchiver({ root: dir });
    await archiver.archive(input([qb("90002", 250), rb("90010", 80)]));
    const later = await archiver.archive(input([qb("90002", 262)], { positions: ["QB"], fetchedAt: BEFORE + HOUR }));
    expect(later).toEqual({ status: "archived", file: fileOf(5), replaced: ["QB"] });
    const back = await readProjectionSnapshot(fileOf(5));
    expect(back?.groups.QB?.players["90002"]?.stats.pass_yd).toBe(262);
    expect(back?.groups.RB?.players["90010"]?.stats.rush_yd).toBe(80);
    // The League page's next build reads the same cached copies: known to be on disk, so the file isn't even read
    // (a garbage file stays garbage).
    await writeFile(fileOf(5), "garbage");
    expect(await archiver.archive(input([qb("90002", 262), rb("90010", 80)], { fetchedAt: BEFORE }))).toEqual({ status: "unchanged", file: fileOf(5) });
    expect(await archiver.archive(input([qb("90002", 262)], { positions: ["QB"], fetchedAt: BEFORE + HOUR }))).toEqual({ status: "unchanged", file: fileOf(5) });
    expect(await readFile(fileOf(5), "utf8")).toBe("garbage");
  });

  it("a fresh process (no memory) reads the file and still ignores an older fetch", async () => {
    await createProjectionArchiver({ root: dir }).archive(input([qb("90002", 250)], { fetchedAt: BEFORE + HOUR }));
    const before = await readFile(fileOf(5));
    const other = createProjectionArchiver({ root: dir });
    expect(await other.archive(input([qb("90002", 999)], { fetchedAt: BEFORE }))).toEqual({ status: "unchanged", file: fileOf(5) });
    expect((await readFile(fileOf(5))).equals(before)).toBe(true);
  });

  it("skips without touching the disk: after kickoff, the current week with an unknown kickoff, no fetch time, no real projection", async () => {
    const archiver = createProjectionArchiver({ root: dir });
    expect(await archiver.archive(input([qb("90002", 250)], { fetchedAt: KICKOFF + HOUR }))).toEqual({ status: "skipped", reason: "after kickoff" });
    expect(await archiver.archive(input([qb("90002", 250)], { week: 4, firstKickoff: null }))).toEqual({ status: "skipped", reason: "kickoff unknown" });
    expect(await archiver.archive(input([qb("90002", 250)], { fetchedAt: undefined }))).toEqual({ status: "skipped", reason: "no fetch time" });
    expect(await archiver.archive(input([{ player_id: "90001", stats: { adp_dd_ppr: 3 } }]))).toEqual({ status: "skipped", reason: "no projections" });
    await expect(stat(path.join(dir, String(SEASON)))).rejects.toThrow();
  });

  it("works in the background: archive() returns at once, writes of one file run one at a time, and flush() waits for them all", async () => {
    const archiver = createProjectionArchiver({ root: dir });
    const a = archiver.archive(input([qb("90002", 250)], { positions: ["QB"] }));
    const b = archiver.archive(input([rb("90010", 80)], { positions: ["RB"], fetchedAt: BEFORE + 1 }));
    const c = archiver.archive(input([qb("90003", 200)], { week: 6, positions: ["QB"], firstKickoff: KICKOFF + 7 * 24 * HOUR }));
    await archiver.flush();
    expect((await Promise.all([a, b, c])).map((o) => o.status)).toEqual(["archived", "archived", "archived"]);
    const week5 = await readProjectionSnapshot(fileOf(5));
    expect(Object.keys(week5?.groups ?? {}).sort()).toEqual(["QB", "RB"]); // neither write lost the other's group
    expect(Object.keys((await readProjectionSnapshot(fileOf(6)))?.groups ?? {})).toEqual(["QB"]);
    await archiver.flush(); // nothing pending: resolves at once
  });

  it("replaces an unreadable snapshot, leaves one of another format version alone", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await createProjectionArchiver({ root: dir }).archive(input([qb("90002", 250)]));
    await writeFile(fileOf(5), gzipSync(Buffer.from("{not json")));
    expect(await createProjectionArchiver({ root: dir }).archive(input([qb("90002", 251)]))).toMatchObject({ status: "archived", replaced: ["QB"] });
    expect((await readProjectionSnapshot(fileOf(5)))?.groups.QB?.players["90002"]?.stats.pass_yd).toBe(251);
    expect(log).toHaveBeenCalledWith(JSON.stringify({ route: "server", event: "projection_archive_replaced" }));
    const v2 = gzipSync(Buffer.from(JSON.stringify({ version: 2, season: SEASON, week: 5 })));
    await writeFile(fileOf(5), v2);
    expect(await createProjectionArchiver({ root: dir }).archive(input([qb("90002", 252)], { fetchedAt: BEFORE + HOUR }))).toEqual({ status: "failed", error: "OtherVersion" });
    expect((await readFile(fileOf(5))).equals(v2)).toBe(true);
    await expect(readProjectionSnapshot(fileOf(5))).rejects.toThrow();
  });

  it("never throws: a failure is an outcome, logged by the error's name only (never a path)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const blocker = path.join(dir, "not-a-folder");
    await writeFile(blocker, "x"); // the archive's root is a file: nothing can be written under it
    const archiver = createProjectionArchiver({ root: blocker });
    const outcome = await archiver.archive(input([qb("90002", 250)]));
    expect(outcome.status).toBe("failed");
    expect(log).toHaveBeenCalledTimes(1);
    const logged = String(log.mock.calls[0]?.[0]);
    expect(logged).toMatch(/^\{"route":"server","event":"projection_archive_failed","errorName":"\w+"\}$/);
    expect(logged).not.toContain(dir);
    // A broken input (no rows array) is an outcome too.
    const broken = { ...input([qb("90002", 250)]), rows: null } as unknown as ProjectionArchiveInput;
    expect(await archiver.archive(broken)).toEqual({ status: "failed", error: "TypeError" });
  });
});

describe("where the archive is enabled (only where there is a local disk)", () => {
  it("off in production, on Vercel and under Vitest; on in development and tsx scripts", () => {
    expect(projectionArchiveEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(projectionArchiveEnabled({})).toBe(true); // a tsx script
    expect(projectionArchiveEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(projectionArchiveEnabled({ NODE_ENV: "development", VERCEL: "1" })).toBe(false);
    expect(projectionArchiveEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(projectionArchiveEnabled({ VITEST: "true" })).toBe(false);
    expect(projectionArchiveEnabled()).toBe(false); // this run
    expect(defaultProjectionArchiver()).toBeNull();
  });

  it("the stable copy (OFFERSHEET_DATA_LOCAL, a production build): on, and the snapshots go to that folder (never on Vercel or under tests)", async () => {
    expect(DATA_LOCAL_ENV).toBe("OFFERSHEET_DATA_LOCAL");
    expect(projectionArchiveEnabled({ NODE_ENV: "production", OFFERSHEET_DATA_LOCAL: "D:/main/data-local" })).toBe(true);
    expect(projectionArchiveEnabled({ NODE_ENV: "production", OFFERSHEET_DATA_LOCAL: "D:/main/data-local", VERCEL: "1" })).toBe(false);
    expect(projectionArchiveEnabled({ NODE_ENV: "test", OFFERSHEET_DATA_LOCAL: "D:/main/data-local" })).toBe(false);
    expect(projectionArchiveEnabled({ VITEST: "true", OFFERSHEET_DATA_LOCAL: "D:/main/data-local" })).toBe(false);
    expect(projectionArchiveEnabled({ NODE_ENV: "production", OFFERSHEET_DATA_LOCAL: "" })).toBe(false);
    expect(dataLocalRoot({ OFFERSHEET_DATA_LOCAL: path.join(dir, "x") })).toBe(path.join(dir, "x"));
    expect(dataLocalRoot({})).toBeNull();
    vi.stubEnv(DATA_LOCAL_ENV, path.join(dir, "main-data-local"));
    try {
      const outcome = await createProjectionArchiver().archive(input([qb("90002", 250)]));
      expect(outcome).toEqual({ status: "archived", file: projectionSnapshotFile(path.join(dir, "main-data-local", "projection-snapshots"), SEASON, 5), replaced: ["QB"] });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
