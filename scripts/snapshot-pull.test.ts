/**
 * `npm run snapshot:pull -- --live` (planner reply to Checkpoint 7a, §6.3): its arguments, the seasons it reads, the records
 * it copies from the store (FakeRedis, filled by the cron's own store) into the local archives' files (a temporary folder),
 * the merge with files already there, what it refuses to write, and its report. No network.
 */
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FantasyCalcFormat } from "@/engine/inputs";
import type { Pos } from "@/engine/model";
import { fantasyCalcFormatKey, fantasyCalcSnapshotFile, packFantasyCalcSnapshot, readFantasyCalcSnapshot, type ArchivableRow } from "@/server/fantasyCalcArchive";
import { projectionSnapshotFile, readProjectionSnapshot, writeProjectionSnapshotFile, type ProjectionArchiveInput } from "@/server/projectionArchive";
import { FakeRedis } from "@/server/redis";
import { fantasyCalcIndexKey, fantasyCalcSnapshotKey, projectionSnapshotKey, sharedSnapshotStore } from "@/server/snapshots";
import { PULL_BATCH, formatSnapshotPull, pullSeason, pullSeasons, snapshotPullArgs, type PullRoots } from "./snapshot-pull";

const HOUR = 3_600_000;
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

let dir: string;
let roots: PullRoots;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "offer-sheet-snapshot-pull-"));
  roots = { projections: path.join(dir, "data-local", "projection-snapshots"), fantasyCalc: path.join(dir, "data-local", "fantasycalc-snapshots") };
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
});

describe("pullSeason: the store's records into the local archives' files", () => {
  async function filled(): Promise<FakeRedis> {
    const redis = new FakeRedis(() => WEDNESDAY);
    const store = sharedSnapshotStore(redis, { env: { VERCEL_ENV: "production" } });
    expect(await store.saveWeek(week(5, WEDNESDAY - HOUR))).toMatchObject({ status: "saved" });
    expect(await store.saveWeek(week(6, WEDNESDAY - HOUR))).toMatchObject({ status: "saved" });
    expect(await store.saveList({ format: redraft10, players: players(3), fetchedAt: WEDNESDAY - 2 * HOUR })).toEqual({ status: "saved" });
    expect(await store.saveList({ format: dynasty12, players: players(4), fetchedAt: WEDNESDAY - 3 * HOUR })).toEqual({ status: "saved" });
    return redis;
  }

  it("writes each week and list as the local archive's own file, readable by its readers; running it again writes nothing", async () => {
    const redis = await filled();
    const first = await pullSeason(redis, P, 2026, roots);
    expect(first).toEqual({
      season: 2026,
      projections: { inStore: 2, written: [5, 6], current: 0, invalid: 0, otherVersion: 0 },
      fantasyCalc: { indexed: 2, written: 2, here: 0, gone: 0, invalid: 0, otherVersion: 0 },
    });
    const week5 = await readProjectionSnapshot(projectionSnapshotFile(roots.projections, 2026, 5));
    expect(Object.keys(week5?.groups ?? {})).toEqual(POS);
    expect(week5?.groups.QB?.fetchedAt).toBe(new Date(WEDNESDAY - HOUR).toISOString());
    const list = await readFantasyCalcSnapshot(fantasyCalcSnapshotFile(roots.fantasyCalc, { season: 2026, day: "2026-10-07", key: fantasyCalcFormatKey(redraft10) as string }));
    expect(Object.keys(list?.players ?? {})).toEqual(["1", "2", "3"]);

    const before = redis.stats.commands;
    const again = await pullSeason(redis, P, 2026, roots);
    expect(again.projections).toEqual({ inStore: 2, written: [], current: 2, invalid: 0, otherVersion: 0 });
    expect(again.fantasyCalc).toEqual({ indexed: 2, written: 0, here: 2, gone: 0, invalid: 0, otherVersion: 0 });
    // One MGET of the weeks and one SMEMBERS of the index; no list is asked for (both are on disk).
    expect(redis.stats.commands - before).toBe(2);
    expect(await pullSeason(redis, P, 2025, roots)).toMatchObject({ projections: { inStore: 0 }, fantasyCalc: { indexed: 0 } });
  });

  it("merges a week with the local file: each position's later pre-kickoff fetch wins", async () => {
    const redis = await filled();
    // This computer's own archive holds a later QB fetch (a League page build) and nothing else.
    const local = await import("@/server/projectionArchive");
    const built = local.projectionArchiveFetch(week(5, WEDNESDAY + HOUR, ["QB"]));
    if (!("fetch" in built)) throw new Error("not archived");
    await writeProjectionSnapshotFile(projectionSnapshotFile(roots.projections, 2026, 5), local.mergeSnapshot(null, built.fetch).record);
    const out = await pullSeason(redis, P, 2026, roots);
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
    await redis.sadd(fantasyCalcIndexKey(P, 2026), "2026-10-06/redraft-1qb-10team-ppr0.5", "2026-10-05/redraft-1qb-10team-ppr0.5", "junk", "2027-03-02/redraft-1qb-10team-ppr0.5");
    // The day's local copy of dynasty12 is there already: kept.
    const localFile = fantasyCalcSnapshotFile(roots.fantasyCalc, { season: 2026, day: "2026-10-07", key: fantasyCalcFormatKey(dynasty12) as string });
    await mkdir(path.dirname(localFile), { recursive: true });
    await writeFile(localFile, "the day's first copy");
    const out = await pullSeason(redis, P, 2026, roots);
    expect(out.projections).toEqual({ inStore: 4, written: [5, 6], current: 0, invalid: 2, otherVersion: 0 });
    // Indexed: today's two, the wrong one, the expired one (junk and another season's day are dropped).
    expect(out.fantasyCalc).toEqual({ indexed: 4, written: 1, here: 1, gone: 1, invalid: 1, otherVersion: 0 });
    await expect(readFantasyCalcSnapshot(fantasyCalcSnapshotFile(roots.fantasyCalc, wrongAt))).resolves.toBeNull();
  });

  it("asks for missing lists PULL_BATCH at a time", async () => {
    const redis = new FakeRedis(() => WEDNESDAY);
    const store = sharedSnapshotStore(redis, { env: { VERCEL_ENV: "production" } });
    const formats: FantasyCalcFormat[] = [];
    for (const numTeams of [8, 10, 12, 14]) for (const ppr of [0, 0.5, 1] as const) for (const numQbs of [1, 2] as const) for (const isDynasty of [false, true]) formats.push({ isDynasty, numQbs, numTeams, ppr, substitutions: [] });
    // 48 formats on two days each: 96 lists.
    for (const f of formats) for (const daysAgo of [0, 1]) await store.saveList({ format: f, players: players(2), fetchedAt: WEDNESDAY - 24 * HOUR * daysAgo });
    const mget = vi.spyOn(redis, "mget");
    const out = await pullSeason(redis, P, 2026, roots);
    expect(out.fantasyCalc).toMatchObject({ indexed: 96, written: 96 });
    expect(mget.mock.calls.slice(1).map((c) => c.length)).toEqual([PULL_BATCH, 96 - PULL_BATCH]);
  });
});

describe("the report", () => {
  it("counts, weeks and folders only", () => {
    const text = formatSnapshotPull(
      "production",
      [
        { season: 2025, projections: { inStore: 0, written: [], current: 0, invalid: 0, otherVersion: 0 }, fantasyCalc: { indexed: 0, written: 0, here: 0, gone: 0, invalid: 0, otherVersion: 0 } },
        { season: 2026, projections: { inStore: 2, written: [5], current: 1, invalid: 0, otherVersion: 0 }, fantasyCalc: { indexed: 3, written: 2, here: 1, gone: 0, invalid: 0, otherVersion: 0 } },
      ],
      roots,
      dir,
    );
    expect(text).toBe(
      [
        "Offer Sheet snapshot archive: production's store, seasons 2025, 2026.",
        "  2025: nothing in the store.",
        "  2026: projections: 2 weeks in the store, 1 written (week 5), 1 already up to date.",
        "  2026: FantasyCalc: 3 lists indexed, 2 written, 1 already here.",
        "Files: data-local/projection-snapshots/<season>/week-WW.json.gz and data-local/fantasycalc-snapshots/<season>/<day>/<format>.json.gz (git-ignored).",
      ].join("\n"),
    );
  });
});
