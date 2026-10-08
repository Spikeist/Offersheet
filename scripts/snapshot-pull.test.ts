/**
 * `npm run snapshot:pull -- --live` (planner reply to Checkpoint 7a, §6.3; the daily levels since Checkpoint 7c, planner
 * reply to Checkpoint 7b, question 4): its arguments, the seasons it reads, the records it copies from the store (FakeRedis,
 * filled by the cron's own store) into the local archives' files (a temporary folder), the merge with files already there,
 * what it refuses to write, and its report. No network.
 */
import { mkdtemp, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FantasyCalcFormat } from "@/engine/inputs";
import type { Pos } from "@/engine/model";
import { fantasyCalcFormatKey, fantasyCalcSnapshotFile, packFantasyCalcSnapshot, readFantasyCalcSnapshot, type ArchivableRow } from "@/server/fantasyCalcArchive";
import { projectionSnapshotFile, readProjectionSnapshot, writeProjectionSnapshotFile, type ProjectionArchiveInput } from "@/server/projectionArchive";
import { packProjectionLevels, projectionLevelsFile, readProjectionLevels, type ProjectionLevels } from "@/server/projectionLevels";
import { snapshotLimits } from "@/server/limits";
import { FakeRedis } from "@/server/redis";
import { fantasyCalcIndexKey, fantasyCalcSnapshotKey, projectionLevelsKey, projectionSnapshotKey, sharedSnapshotStore } from "@/server/snapshots";
import { PULL_BATCH, PULL_DAY_BATCH, formatSnapshotPull, levelsRecordOf, pruneLocalLists, pullDays, pullSeason, pullSeasons, snapshotPullArgs, type PullRoots, type SeasonPull } from "./snapshot-pull";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const P = "os:production:";
const KICKOFF5 = Date.parse("2026-10-09T00:15:00.000Z");
const WEDNESDAY = Date.parse("2026-10-07T20:05:00.000Z");
const POS: Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];
const redraft10: FantasyCalcFormat = { isDynasty: false, numQbs: 1, numTeams: 10, ppr: 0.5, substitutions: [] };
const dynasty12: FantasyCalcFormat = { isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1, substitutions: [] };

/** A fetched week of fictional rows, one real projection per position. */
function week(n: number, fetchedAt: number, positions: Pos[] = POS): ProjectionArchiveInput {
  const raw = positions.map((pos, i) => ({ player_id: String(8_000 + n * 100 + i), stats: { gp: 1, rec: 3 + i }, player: { position: pos, fantasy_positions: [pos] }, last_modified: fetchedAt }));
  return {
    season: 2026,
    week: n,
    positions,
    rows: raw as ProjectionArchiveInput["rows"],
    res: { status: 200, ok: true, isHtml: false, json: raw, text: "", fromCache: false, fetchedAt },
    currentWeek: 5,
    firstKickoff: n === 5 ? KICKOFF5 : KICKOFF5 + 7 * 24 * HOUR,
  };
}

const players = (n: number): ArchivableRow[] => Array.from({ length: n }, (_, i) => ({ fantasyCalcId: String(i + 1), sleeperId: String(500 + i), espnId: null, position: "WR", value: 1_000 - i, redraftValue: null }));

/** A day's levels (src/server/projectionLevels.ts; fictional ids). */
const levels = (day = "2026-10-07"): ProjectionLevels => ({
  version: 1,
  season: 2026,
  day,
  seasonType: "regular",
  currentWeek: 5,
  fromWeek: 5,
  toWeek: 18,
  weeks: { "5": { fetchedAt: "2026-10-07T19:05:00.000Z", lastModified: null }, "6": { fetchedAt: "2026-10-07T19:05:00.000Z", lastModified: null } },
  players: { "8001": ["WR", 11.5, 12, 12.5, 0b110000], KC: ["DEF", 7, 7, 7, 0b110000] },
});

/** A season's pull with every count at 0 but those given. */
function pulled(season: number, over: { projections?: Partial<SeasonPull["projections"]>; fantasyCalc?: Partial<SeasonPull["fantasyCalc"]>; levels?: Partial<SeasonPull["levels"]> } = {}): SeasonPull {
  return {
    season,
    projections: { inStore: 0, written: [], current: 0, invalid: 0, otherVersion: 0, ...over.projections },
    fantasyCalc: { indexed: 0, written: 0, here: 0, gone: 0, invalid: 0, otherVersion: 0, ...over.fantasyCalc },
    levels: { inStore: 0, written: 0, here: 0, invalid: 0, otherVersion: 0, ...over.levels },
  };
}

let dir: string;
let roots: PullRoots;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "offer-sheet-snapshot-pull-"));
  roots = { projections: path.join(dir, "data-local", "projection-snapshots"), fantasyCalc: path.join(dir, "data-local", "fantasycalc-snapshots"), levels: path.join(dir, "data-local", "projection-levels") };
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("snapshotPullArgs and the seasons", () => {
  it("production by default (Vercel runs crons there only); --env preview; anything else in words", () => {
    expect(snapshotPullArgs(["--live"])).toEqual({ env: "production" });
    expect(snapshotPullArgs(["--live", "--env", "preview"])).toEqual({ env: "preview" });
    expect(snapshotPullArgs(["--env", "development"])).toEqual({ error: "--env takes production or preview." });
    expect(snapshotPullArgs(["--env"])).toEqual({ error: "--env takes production or preview." });
    expect(snapshotPullArgs(["--days", "3"])).toMatchObject({ error: expect.stringContaining('Unknown option "--days"') });
  });

  it("reads this season and the two before (the store keeps two seasons)", () => {
    expect(pullSeasons(WEDNESDAY)).toEqual([2024, 2025, 2026]);
    expect(pullSeasons(Date.parse("2027-01-10T12:00:00Z"))).toEqual([2024, 2025, 2026]);
    expect(pullSeasons(Date.parse("2027-03-10T12:00:00Z"))).toEqual([2025, 2026, 2027]);
  });

  it("each season's days whose index the store can still hold: the season's days of the last two seasons' worth, up to today", () => {
    const days2026 = pullDays(2026, WEDNESDAY);
    expect([days2026[0], days2026.at(-1), days2026.length]).toEqual(["2026-03-01", "2026-10-07", 221]);
    expect(pullDays(2025, WEDNESDAY)).toHaveLength(365);
    // 2024's season: only its days less than two seasons old (a day's index goes retainDays after it began).
    const days2024 = pullDays(2024, WEDNESDAY);
    expect([days2024[0], days2024.at(-1)]).toEqual(["2024-10-08", "2025-02-28"]);
    expect(Date.parse("2024-10-08T00:00:00Z") + snapshotLimits.retainDays * DAY).toBeGreaterThan(WEDNESDAY);
    expect(Date.parse("2024-10-07T00:00:00Z") + snapshotLimits.retainDays * DAY).toBeLessThanOrEqual(WEDNESDAY);
  });
});

describe("pullSeason: the store's records into the local archives' files", () => {
  async function filled(): Promise<FakeRedis> {
    const redis = new FakeRedis(() => WEDNESDAY);
    const store = sharedSnapshotStore(redis, { env: { VERCEL_ENV: "production" }, clock: () => WEDNESDAY });
    expect(await store.saveWeek(week(5, WEDNESDAY - HOUR))).toMatchObject({ status: "saved" });
    expect(await store.saveWeek(week(6, WEDNESDAY - HOUR))).toMatchObject({ status: "saved" });
    expect(await store.saveList({ format: redraft10, players: players(3), fetchedAt: WEDNESDAY - 2 * HOUR })).toEqual({ status: "saved" });
    expect(await store.saveList({ format: dynasty12, players: players(4), fetchedAt: WEDNESDAY - 3 * HOUR })).toEqual({ status: "saved" });
    expect(await store.saveLevels(levels())).toEqual({ status: "saved" });
    return redis;
  }

  it("writes each week, list and day's levels as the local archive's own file, readable by its readers; running it again writes nothing", async () => {
    const redis = await filled();
    const first = await pullSeason(redis, P, 2026, roots, WEDNESDAY);
    expect(first).toEqual({
      season: 2026,
      projections: { inStore: 2, written: [5, 6], current: 0, invalid: 0, otherVersion: 0 },
      fantasyCalc: { indexed: 2, written: 2, here: 0, gone: 0, invalid: 0, otherVersion: 0 },
      levels: { inStore: 1, written: 1, here: 0, invalid: 0, otherVersion: 0 },
    });
    const week5 = await readProjectionSnapshot(projectionSnapshotFile(roots.projections, 2026, 5));
    expect(Object.keys(week5?.groups ?? {})).toEqual(POS);
    expect(week5?.groups.QB?.fetchedAt).toBe(new Date(WEDNESDAY - HOUR).toISOString());
    const list = await readFantasyCalcSnapshot(fantasyCalcSnapshotFile(roots.fantasyCalc, { season: 2026, day: "2026-10-07", key: fantasyCalcFormatKey(redraft10) as string }));
    expect(Object.keys(list?.players ?? {})).toEqual(["1", "2", "3"]);
    expect(await readProjectionLevels(projectionLevelsFile(roots.levels, 2026, "2026-10-07"))).toEqual(levels());

    const before = redis.stats.commands;
    const again = await pullSeason(redis, P, 2026, roots, WEDNESDAY);
    expect(again.projections).toEqual({ inStore: 2, written: [], current: 2, invalid: 0, otherVersion: 0 });
    expect(again.fantasyCalc).toEqual({ indexed: 2, written: 0, here: 2, gone: 0, invalid: 0, otherVersion: 0 });
    expect(again.levels).toEqual({ inStore: 0, written: 0, here: 1, invalid: 0, otherVersion: 0 });
    // One MGET of the weeks, one SMEMBERS of each day's index (PULL_DAY_BATCH at a time), no list (both are on disk), and
    // one MGET for each PULL_BATCH days whose levels aren't on disk (every day but 2026-10-07's).
    const days = pullDays(2026, WEDNESDAY).length;
    expect(redis.stats.commands - before).toBe(1 + days + Math.ceil((days - 1) / PULL_BATCH));
    expect(PULL_DAY_BATCH).toBeGreaterThan(1);
    expect(await pullSeason(redis, P, 2025, roots, WEDNESDAY)).toMatchObject({ projections: { inStore: 0 }, fantasyCalc: { indexed: 0 }, levels: { inStore: 0, written: 0 } });
  });

  it("merges a week with the local file: each position's later pre-kickoff fetch wins", async () => {
    const redis = await filled();
    // This computer's own archive holds a later QB fetch (a League page build) and nothing else.
    const local = await import("@/server/projectionArchive");
    const built = local.projectionArchiveFetch(week(5, WEDNESDAY + HOUR, ["QB"]));
    if (!("fetch" in built)) throw new Error("not archived");
    await writeProjectionSnapshotFile(projectionSnapshotFile(roots.projections, 2026, 5), local.mergeSnapshot(null, built.fetch).record);
    const out = await pullSeason(redis, P, 2026, roots, WEDNESDAY);
    expect(out.projections.written).toEqual([5, 6]);
    const merged = await readProjectionSnapshot(projectionSnapshotFile(roots.projections, 2026, 5));
    expect(merged?.groups.QB?.fetchedAt).toBe(new Date(WEDNESDAY + HOUR).toISOString());
    expect(merged?.groups.RB?.fetchedAt).toBe(new Date(WEDNESDAY - HOUR).toISOString());
  });

  it("never writes what isn't what its key says (counted), skips expired lists, and leaves a day's local list alone", async () => {
    const redis = await filled();
    await redis.set(projectionSnapshotKey(P, 2026, 7), "garbage");
    // Week 5's record stored under week 8's key: unreadable as week 8.
    await redis.set(projectionSnapshotKey(P, 2026, 8), (await redis.get(projectionSnapshotKey(P, 2026, 5))) as string);
    // A dynasty list under a redraft key, and an index entry whose list is gone.
    const wrongAt = { season: 2026, day: "2026-10-06", key: fantasyCalcFormatKey(redraft10) as string };
    const dynastyRecord = { version: 1 as const, format: { isDynasty: true, numQbs: 2 as const, numTeams: 12, ppr: 1 as const }, fetchedAt: "2026-10-06T10:00:00.000Z", players: { "1": { pos: "WR", value: 5 } } };
    await redis.set(fantasyCalcSnapshotKey(P, wrongAt), (await packFantasyCalcSnapshot(dynastyRecord)).toString("base64"));
    await redis.sadd(fantasyCalcIndexKey(P, { season: 2026, day: "2026-10-06" }), "redraft-1qb-10team-ppr0.5");
    await redis.sadd(fantasyCalcIndexKey(P, { season: 2026, day: "2026-10-05" }), "redraft-1qb-10team-ppr0.5", "junk");
    // A day after today isn't read.
    await redis.sadd(fantasyCalcIndexKey(P, { season: 2026, day: "2027-02-02" }), "redraft-1qb-10team-ppr0.5");
    // The day's local copy of dynasty12 is there already: kept.
    const localFile = fantasyCalcSnapshotFile(roots.fantasyCalc, { season: 2026, day: "2026-10-07", key: fantasyCalcFormatKey(dynasty12) as string });
    await mkdir(path.dirname(localFile), { recursive: true });
    await writeFile(localFile, "the day's first copy");
    // Levels: garbage, 2026-10-07's record under 2026-10-06's key, a record of another format version, and a day whose
    // local file is here already (not asked for); a day after today isn't read.
    await redis.set(projectionLevelsKey(P, 2026, "2026-10-01"), "garbage");
    await redis.set(projectionLevelsKey(P, 2026, "2026-10-06"), (await packProjectionLevels(levels())).toString("base64"));
    await redis.set(projectionLevelsKey(P, 2026, "2026-10-05"), gzipSync(JSON.stringify({ version: 2 })).toString("base64"));
    await redis.set(projectionLevelsKey(P, 2026, "2026-10-04"), (await packProjectionLevels(levels("2026-10-04"))).toString("base64"));
    await redis.set(projectionLevelsKey(P, 2026, "2027-02-02"), (await packProjectionLevels(levels("2027-02-02"))).toString("base64"));
    const localLevels = projectionLevelsFile(roots.levels, 2026, "2026-10-04");
    await mkdir(path.dirname(localLevels), { recursive: true });
    await writeFile(localLevels, "the day's first record");
    const out = await pullSeason(redis, P, 2026, roots, WEDNESDAY);
    expect(out.projections).toEqual({ inStore: 4, written: [5, 6], current: 0, invalid: 2, otherVersion: 0 });
    // Indexed: today's two, the wrong one, the expired one (junk and a day after today are dropped).
    expect(out.fantasyCalc).toEqual({ indexed: 4, written: 1, here: 1, gone: 1, invalid: 1, otherVersion: 0 });
    await expect(readFantasyCalcSnapshot(fantasyCalcSnapshotFile(roots.fantasyCalc, wrongAt))).resolves.toBeNull();
    expect(out.levels).toEqual({ inStore: 4, written: 1, here: 1, invalid: 2, otherVersion: 1 });
    expect((await readdir(path.join(roots.levels, "2026"))).sort()).toEqual(["2026-10-04.json.gz", "2026-10-07.json.gz"]);
  });

  it("levelsRecordOf: the record when it unpacks and is its key's season and day; else invalid, or another version", async () => {
    const text = (await packProjectionLevels(levels())).toString("base64");
    expect(await levelsRecordOf(text, 2026, "2026-10-07")).toEqual(levels());
    expect(await levelsRecordOf(text, 2025, "2026-10-07")).toBe("invalid");
    expect(await levelsRecordOf(text, 2026, "2026-10-08")).toBe("invalid");
    expect(await levelsRecordOf("garbage", 2026, "2026-10-07")).toBe("invalid");
    expect(await levelsRecordOf(gzipSync(JSON.stringify({ version: 2 })).toString("base64"), 2026, "2026-10-07")).toBe("otherVersion");
  });

  // 96 gzipped files into the temp folder: about 0.3 s alone, but twice over 5 s under the full parallel suite on Windows
  // (Checkpoint 7c's gates), so it gets the room the other file-heavy tests have.
  it("asks for missing lists, and missing days' levels, PULL_BATCH at a time", { timeout: 60_000 }, async () => {
    const redis = new FakeRedis(() => WEDNESDAY);
    const store = sharedSnapshotStore(redis, { env: { VERCEL_ENV: "production" }, clock: () => WEDNESDAY });
    const formats: FantasyCalcFormat[] = [];
    for (const numTeams of [8, 10, 12, 14]) for (const ppr of [0, 0.5, 1] as const) for (const numQbs of [1, 2] as const) for (const isDynasty of [false, true]) formats.push({ isDynasty, numQbs, numTeams, ppr, substitutions: [] });
    // 48 formats on two days each: 96 lists.
    for (const f of formats) for (const daysAgo of [0, 1]) await store.saveList({ format: f, players: players(2), fetchedAt: WEDNESDAY - 24 * HOUR * daysAgo });
    const mget = vi.spyOn(redis, "mget");
    const out = await pullSeason(redis, P, 2026, roots, WEDNESDAY);
    expect(out.fantasyCalc).toMatchObject({ indexed: 96, written: 96 });
    const batches = (kind: string) => mget.mock.calls.filter((c) => String(c[0]).includes(kind)).map((c) => c.length);
    expect(batches(":snap:fc:")).toEqual([PULL_BATCH, 96 - PULL_BATCH]);
    // Every day of the season the store can still hold, none of them on disk.
    const days = pullDays(2026, WEDNESDAY).length;
    expect(batches(":snap:lvl:")).toEqual([...Array<number>(Math.floor(days / PULL_BATCH)).fill(PULL_BATCH), days % PULL_BATCH]);
  });
});

describe("the report", () => {
  it("counts, weeks and folders only", () => {
    const text = formatSnapshotPull(
      "production",
      [
        pulled(2024, { levels: { here: 3 } }),
        pulled(2025),
        pulled(2026, { projections: { inStore: 2, written: [5], current: 1 }, fantasyCalc: { indexed: 3, written: 2, here: 1 }, levels: { inStore: 3, written: 2, here: 1, invalid: 1 } }),
      ],
      roots,
      dir,
    );
    expect(text).toBe(
      [
        "Offer Sheet snapshot archive: production's store, seasons 2024, 2025, 2026.",
        "  2024: projections: 0 weeks in the store, none new.",
        "  2024: FantasyCalc: 0 lists indexed, 0 written.",
        "  2024: daily levels: none new, 3 already here.",
        "  2025: nothing in the store.",
        "  2026: projections: 2 weeks in the store, 1 written (week 5), 1 already up to date.",
        "  2026: FantasyCalc: 3 lists indexed, 2 written, 1 already here.",
        "  2026: daily levels: 2 days written, 1 already here, 1 unreadable, skipped.",
        "Files: data-local/projection-snapshots/<season>/week-WW.json.gz, data-local/fantasycalc-snapshots/<season>/<day>/<format>.json.gz and data-local/projection-levels/<season>/<day>.json.gz (git-ignored).",
      ].join("\n"),
    );
    // With local lists pruned, a last line says how many.
    const pruned = formatSnapshotPull("production", [], roots, dir, { days: 2, lists: 3 });
    expect(pruned.split("\n").at(-1)).toBe(`Deleted 3 local FantasyCalc lists of 2 days more than ${snapshotLimits.retainDays} days ago, as the store deletes them.`);
  });
});

describe("pruneLocalLists: the local copies kept no longer than the store keeps them (review of Phase 7b)", () => {
  it("deletes the day folders of lists more than two seasons old, and nothing else", async () => {
    const at = (season: number, day: string, key = "redraft-1qb-10team-ppr0.5") => fantasyCalcSnapshotFile(roots.fantasyCalc, { season, day, key });
    const files = [at(2024, "2024-10-07"), at(2024, "2024-10-07", "dynasty-2qb-12team-ppr1"), at(2024, "2024-10-08"), at(2026, "2026-10-07")];
    for (const f of files) {
      await mkdir(path.dirname(f), { recursive: true });
      await writeFile(f, "a list");
    }
    // Not a day folder, and a file beside the season folders: left alone.
    await mkdir(path.join(roots.fantasyCalc, "2024", "notes"), { recursive: true });
    await writeFile(path.join(roots.fantasyCalc, "README.txt"), "kept");
    expect(await pruneLocalLists(roots.fantasyCalc, WEDNESDAY)).toEqual({ days: 1, lists: 2 });
    expect((await readdir(path.join(roots.fantasyCalc, "2024"))).sort()).toEqual(["2024-10-08", "notes"]);
    expect(await readdir(path.join(roots.fantasyCalc, "2026"))).toEqual(["2026-10-07"]);
    expect((await readdir(roots.fantasyCalc)).sort()).toEqual(["2024", "2026", "README.txt"]);
    // Again: nothing more to delete; no archive at all: nothing to do.
    expect(await pruneLocalLists(roots.fantasyCalc, WEDNESDAY)).toEqual({ days: 0, lists: 0 });
    expect(await pruneLocalLists(path.join(dir, "nowhere"), WEDNESDAY)).toEqual({ days: 0, lists: 0 });
  });
});
