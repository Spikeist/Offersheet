/**
 * The daily rest-of-season levels (planner reply to Checkpoint 7b, question 4; src/server/projectionLevels.ts): the pure
 * core (the mean of Sleeper's own three totals, the week mask, the week's stamp in either body form, what's left out), the
 * codec and the fs layer, and the proof that a level never reads a league's scoring, the market blend or FantasyCalc. Every
 * function those modules export is made to throw in this whole file (forbidden below), so each test here, the cron's levels
 * part end to end included, would fail if a level read one of them. No network: committed fixtures and made-up rows
 * (fictional ids).
 */
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFENSE_POSITIONS, sleeperUrls } from "@/adapters/sleeper/fetch";
import { parseArrayLenient, StatRowSchema, type SleeperStatRow } from "@/adapters/sleeper/schemas";
import type { HttpClient, HttpResponse } from "@/adapters/types";
import { loadFantasyCalcValues } from "@/data/fantasyCalcValues";
import { nflScheduleUrl, type NflScheduleResponse } from "@/data/nflSchedule";
import { MODEL_PROJECTIONS_REDUCER } from "@/data/reduce";
import { FIXTURE } from "@/data/testSupport";
import { marketBlend } from "@/engine/blend";
import { marketValues } from "@/engine/market";
import { expectedPoints } from "@/engine/scoring";
import { readSanitizedFixture } from "@/test-utils/fixtures";
import { DATA_LOCAL_ENV } from "./projectionArchive";
import {
  LEVEL_TOTALS,
  maskWeeks,
  packProjectionLevels,
  projectionLevelsFile,
  projectionLevelsOf,
  projectionLevelsRoot,
  readProjectionLevels,
  readStoredProjectionLevelsFile,
  saveProjectionLevelsFile,
  unpackProjectionLevels,
  writeProjectionLevelsFile,
  type ProjectionLevels,
  type ProjectionLevelsInput,
  type ProjectionLevelsWeekInput,
} from "./projectionLevels";
import { FakeRedis } from "./redis";
import { dayRetainMs, projectionLevelsKey, sharedSnapshotStore, snapshotLevels, type SnapshotStore } from "./snapshots";

const { forbidden } = vi.hoisted(() => ({
  /**
   * A module stand-in whose every function throws when called (classes and constants kept, so modules that only import
   * them still load): a level that reads league scoring, the blend, the market values or FantasyCalc fails the test.
   */
  forbidden: (what: string) => async (importOriginal: () => Promise<Record<string, unknown>>) => {
    const real = await importOriginal();
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(real)) {
      const isClass = typeof value === "function" && /^class[\s{]/.test(Function.prototype.toString.call(value));
      out[name] =
        typeof value === "function" && !isClass
          ? () => {
              throw new Error(`a level read ${what} (${name})`);
            }
          : value;
    }
    return out;
  },
}));

vi.mock("@/engine/scoring", forbidden("league scoring"));
vi.mock("@/engine/projections", forbidden("the model's projections"));
vi.mock("@/engine/blend", forbidden("the market blend"));
vi.mock("@/engine/market", forbidden("the market values"));
vi.mock("@/data/fantasyCalcValues", forbidden("FantasyCalc's values"));
vi.mock("@/server/fantasyCalcArchive", forbidden("FantasyCalc's lists"));

const HOUR = 3_600_000;
const P = "os:production:";
const PROD = { VERCEL_ENV: "production" };
/** The cron's hour on the Wednesday before week 5 (the committed schedule's week 5 opens 2026-10-09 00:15 UTC). */
const WEDNESDAY = Date.parse("2026-10-07T20:05:00.000Z");
const SCHEDULE = readSanitizedFixture<NflScheduleResponse>("shared", FIXTURE.espnProTeams);

type Totals = [std: number, half: number, ppr: number];

/** A Sleeper projection row (fictional id): its stats, with Sleeper's three totals when given. */
function row(id: string, pos: string, totals: Totals | null, stats: Record<string, number> = { gp: 1, rec: 4 }, fantasy: string[] = [pos], at = WEDNESDAY - HOUR): Record<string, unknown> {
  const pts = totals ? { pts_std: totals[0], pts_half_ppr: totals[1], pts_ppr: totals[2] } : {};
  return { player_id: id, stats: { ...stats, ...pts }, player: { position: pos, fantasy_positions: fantasy }, last_modified: at };
}

/** A stub row: no projection (a bye, an injury), only an ADP and zero totals. */
const stub = (id: string, pos: string) => ({ player_id: id, stats: { adp_dd_ppr: 120, pts_std: 0, pts_half_ppr: 0, pts_ppr: 0 }, player: { position: pos, fantasy_positions: [pos] } });

/** One week as the loader hands it over: the rows the schema reads, and the response they came in. */
function week(n: number, raw: unknown[], fetchedAt: number | undefined = WEDNESDAY - 2 * HOUR): ProjectionLevelsWeekInput {
  return { week: n, rows: parseArrayLenient(StatRowSchema, raw).rows as SleeperStatRow[], res: { fetchedAt, json: raw } };
}

function input(weeks: ProjectionLevelsWeekInput[], over: Partial<ProjectionLevelsInput> = {}): ProjectionLevelsInput {
  return { season: 2026, day: "2026-10-07", seasonType: "regular", currentWeek: 5, fromWeek: 5, toWeek: 18, weeks, ...over };
}

function levelsOf(weeks: ProjectionLevelsWeekInput[], over: Partial<ProjectionLevelsInput> = {}): ProjectionLevels {
  const record = projectionLevelsOf(input(weeks, over));
  if (!record) throw new Error("no levels");
  return record;
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "offer-sheet-levels-test-"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("a level is the mean of Sleeper's own totals over the weeks a player is projected (projectionLevelsOf)", () => {
  it("per format, over the weeks his first real row carries all three totals; the mask names those weeks; each week's fetch time and latest last_modified", () => {
    const record = levelsOf([
      week(5, [row("7001", "WR", [10, 12, 14]), row("7001", "WR", [99, 99, 99]), row("KC", "DEF", [8, 8, 8], { gp: 1, pts_allow: 20 })], WEDNESDAY - 3 * HOUR),
      week(6, [row("7001", "WR", [20, 21, 22], undefined, undefined, WEDNESDAY - 30 * 60_000), row("KC", "DEF", [6, 6, 6], { gp: 1, pts_allow: 24 })]),
      // His bye: a stub row, never counted (even with zero totals on it); the defense is projected.
      week(7, [stub("7001", "WR"), row("KC", "DEF", [7, 7, 7], { gp: 1, pts_allow: 22 })]),
    ]);
    expect(record).toEqual({
      version: 1,
      season: 2026,
      day: "2026-10-07",
      seasonType: "regular",
      currentWeek: 5,
      fromWeek: 5,
      toWeek: 18,
      weeks: {
        "5": { fetchedAt: new Date(WEDNESDAY - 3 * HOUR).toISOString(), lastModified: WEDNESDAY - HOUR },
        "6": { fetchedAt: new Date(WEDNESDAY - 2 * HOUR).toISOString(), lastModified: WEDNESDAY - 30 * 60_000 },
        "7": { fetchedAt: new Date(WEDNESDAY - 2 * HOUR).toISOString(), lastModified: WEDNESDAY - HOUR },
      },
      players: {
        // The first real row of week 5 wins (10/12/14, not 99): means 15, 16.5, 18 over weeks 5 and 6.
        "7001": ["WR", 15, 16.5, 18, 0b110000],
        KC: ["DEF", 7, 7, 7, 0b1110000],
      },
    });
    expect(maskWeeks(record.players["7001"]?.[4] ?? 0)).toEqual([5, 6]);
    expect(maskWeeks(record.players.KC?.[4] ?? 0)).toEqual([5, 6, 7]);
    expect(LEVEL_TOTALS).toEqual(["pts_std", "pts_half_ppr", "pts_ppr"]);
  });

  it("a week's stamp is the latest last_modified of its real offense projections, so Sleeper's own body and the model form give the same record", () => {
    // Week 5: a receiver; a back ruled out after the last real update (his only row a stub, stamped later); a tight end whose
    // stub beside his real row is stamped later (his latest counts: the reducer carries it to his real row).
    const five = [
      row("9001", "WR", [8, 10.5, 13], undefined, undefined, 1_000),
      { ...stub("9002", "RB"), last_modified: 2_000 },
      row("9003", "TE", [5, 6, 7], undefined, undefined, 1_500),
      { ...stub("9003", "TE"), last_modified: 1_800 },
    ];
    // Week 6: a real projection outside the offense group (an IDP player), stamped later, doesn't count either.
    const six = [row("9001", "WR", [9, 11.5, 14], undefined, undefined, 1_000), row("9004", "LB", [9, 9, 9], { gp: 1, idp_tkl: 6 }, undefined, 3_000)];
    const modelForm = (raw: unknown[]) => JSON.parse(MODEL_PROJECTIONS_REDUCER.reduce(JSON.stringify(raw))) as unknown[];
    expect(modelForm(five)).toHaveLength(2); // the stubs dropped (src/data/reduce.ts)
    const fromSleeper = levelsOf([week(5, five), week(6, six)]);
    expect(fromSleeper.weeks).toEqual({
      "5": { fetchedAt: new Date(WEDNESDAY - 2 * HOUR).toISOString(), lastModified: 1_800 },
      "6": { fetchedAt: new Date(WEDNESDAY - 2 * HOUR).toISOString(), lastModified: 1_000 },
    });
    expect(levelsOf([week(5, modelForm(five)), week(6, modelForm(six))])).toEqual(fromSleeper);
  });

  it("on Sleeper's committed weeks the model form keeps everything a level reads: the same record as Sleeper's own body", () => {
    const PROJ = (w: number) => `sleeper/projections/2026/${w} (top 150 QB/RB/WR/TE + 6 per K/DEF/IDP)`;
    const bodies = [5, 10, 15, 17, 18].map((w) => ({ w, raw: readSanitizedFixture<unknown[]>("shared", PROJ(w)) }));
    const fromSleeper = levelsOf(bodies.map(({ w, raw }) => week(w, raw)));
    const fromModel = levelsOf(bodies.map(({ w, raw }) => week(w, JSON.parse(MODEL_PROJECTIONS_REDUCER.reduce(JSON.stringify(raw))) as unknown[])));
    expect(fromModel).toEqual(fromSleeper);
    expect(Object.keys(fromSleeper.players).length).toBeGreaterThan(100);
    expect(Object.values(fromSleeper.weeks).every((w) => w.lastModified !== null)).toBe(true);
  });

  it("the offense only, fullbacks with the backs; a returner's row (no totals) and an IDP player are left out; a player with no counted week is absent", () => {
    const record = levelsOf([
      week(5, [
        row("7003", "FB", [3, 3.5, 4], undefined, ["RB"]),
        row("7004", "LB", [9, 9, 9], { gp: 1, idp_tkl: 6 }),
        row("7005", "WR", null, { gp: 1, kr_yd: 40 }),
        row("7006", "QB", [18, 18, 18], { gp: 1, pass_yd: 250 }),
        // A two-way player Sleeper lists at DB with a receiver's eligibility comes with the offense (the archive's rule).
        row("7007", "DB", [5, 6, 7], undefined, ["WR", "DB"]),
      ]),
    ]);
    expect(Object.keys(record.players)).toEqual(["7003", "7006", "7007"]);
    expect(record.players["7003"]).toEqual(["FB", 3, 3.5, 4, 0b10000]);
    expect(record.players["7007"]?.[0]).toBe("DB");
  });

  it("Sleeper's totals as served: nothing scores a stat (totals that don't match the stats are kept as they are; the other stats change nothing)", () => {
    const odd = levelsOf([week(5, [row("7001", "WR", [10, 99, 7], { gp: 1, rec: 5, rec_yd: 60, rec_td: 1 })])]);
    expect(odd.players["7001"]).toEqual(["WR", 10, 99, 7, 0b10000]);
    const otherStats = levelsOf([week(5, [row("7001", "WR", [10, 99, 7], { gp: 1, rec: 11, rec_yd: 140, rec_td: 3, rush_yd: 20 })])]);
    expect(otherStats.players).toEqual(odd.players);
    const otherTotal = levelsOf([week(5, [row("7001", "WR", [10, 99, 8], { gp: 1, rec: 5, rec_yd: 60, rec_td: 1 })])]);
    expect(otherTotal.players["7001"]?.[3]).toBe(8);
  });

  it("rounded to 2 decimals, never -0; only weeks fromWeek–toWeek count, a week given twice counts once", () => {
    const record = levelsOf(
      [
        week(4, [row("7001", "WR", [100, 100, 100])]),
        week(5, [row("7001", "WR", [0.1, 0.1, -0.004]), row("7002", "RB", [-0.004, 0, 0])]),
        week(6, [row("7001", "WR", [0.2, 0.2, 0])]),
        week(6, [row("7001", "WR", [50, 50, 50])]),
        week(7, [row("7001", "WR", [0.2, 0.25, 0])]),
      ],
      { fromWeek: 5 },
    );
    expect(Object.keys(record.weeks)).toEqual(["5", "6", "7"]);
    // (0.1 + 0.2 + 0.2) / 3 = 0.1666… → 0.17; (0.1 + 0.2 + 0.25) / 3 = 0.18333… → 0.18; (-0.004 + 0 + 0) / 3 → -0 → 0.
    expect(record.players["7001"]).toEqual(["WR", 0.17, 0.18, 0, 0b1110000]);
    expect(Object.is(record.players["7001"]?.[3], 0)).toBe(true);
    expect(Object.is(record.players["7002"]?.[1], 0)).toBe(true);
  });

  it("nothing counted, nothing to save: only stubs, only returners, or every week outside the span", () => {
    expect(projectionLevelsOf(input([week(5, [stub("7001", "WR"), row("7005", "WR", null, { gp: 1, kr_yd: 40 })])]))).toBeNull();
    expect(projectionLevelsOf(input([week(4, [row("7001", "WR", [1, 1, 1])])]))).toBeNull();
    expect(projectionLevelsOf(input([]))).toBeNull();
    // A response without a fetch time or a last_modified says so with null.
    const record = levelsOf([{ ...week(5, [{ player_id: "7001", stats: { gp: 1, rec: 3, pts_std: 1, pts_half_ppr: 2, pts_ppr: 3 }, player: { position: "WR" } }]), res: { json: [] } }]);
    expect(record.weeks["5"]).toEqual({ fetchedAt: null, lastModified: null });
  });

  it("the same weeks always give the same bytes, whatever order the weeks and players came in", async () => {
    const a = week(5, [row("9001", "WR", [1, 2, 3]), row("KC", "DEF", [4, 4, 4]), row("10002", "RB", [5, 6, 7]), row("BUF", "DEF", [3, 3, 3])]);
    const b = week(6, [row("10002", "RB", [7, 8, 9]), row("9001", "WR", [3, 4, 5])]);
    const one = levelsOf([a, b]);
    const two = levelsOf([{ ...b, rows: [...b.rows].reverse() }, { ...a, rows: [...a.rows].reverse() }]);
    expect((await packProjectionLevels(two)).equals(await packProjectionLevels(one))).toBe(true);
    expect(Object.keys(one.players)).toEqual(["9001", "10002", "BUF", "KC"]);
  });
});

describe("the codec and the fs layer", () => {
  const record = (): ProjectionLevels => levelsOf([week(5, [row("7001", "WR", [10, 12, 14])]), week(6, [row("7001", "WR", [20, 21, 22])])]);

  it("packProjectionLevels is a file's exact bytes; unpackProjectionLevels reads them back, says unreadable or another version, and never throws", async () => {
    const r = record();
    const packed = await packProjectionLevels(r);
    expect(await unpackProjectionLevels(packed)).toEqual({ levels: r });
    const file = projectionLevelsFile(dir, 2026, "2026-10-07");
    await writeProjectionLevelsFile(file, r);
    expect((await readFile(file)).equals(packed)).toBe(true);
    const json = (x: unknown) => gzipSync(Buffer.from(JSON.stringify(x)));
    expect(await unpackProjectionLevels(Buffer.from("not gzip"))).toEqual({ unreadable: true });
    expect(await unpackProjectionLevels(json({ version: 2 }))).toEqual({ otherVersion: true });
    // The schema refuses what isn't a day's record: a mask of no week, a short tuple, a day that isn't one, week 19.
    for (const bad of [
      { ...r, players: { "7001": ["WR", 1, 2, 3, 0] } },
      { ...r, players: { "7001": ["WR", 1, 2, 3] } },
      { ...r, day: "2026-10-07T20:05" },
      { ...r, toWeek: 19 },
      { ...r, weeks: { five: { fetchedAt: null, lastModified: null } } },
    ]) {
      expect(await unpackProjectionLevels(json(bad))).toEqual({ unreadable: true });
    }
  });

  it("the folder (the stable copy's data-local/ when set) and the file of a day; the reader and writer snapshot:pull uses", async () => {
    expect(DATA_LOCAL_ENV).toBe("OFFERSHEET_DATA_LOCAL");
    expect(projectionLevelsRoot({ OFFERSHEET_DATA_LOCAL: path.join(dir, "main") })).toBe(path.join(dir, "main", "projection-levels"));
    expect(projectionLevelsRoot({})).toBe(path.join(process.cwd(), "data-local", "projection-levels"));
    const file = projectionLevelsFile(dir, 2026, "2026-10-07");
    expect(file).toBe(path.join(dir, "2026", "2026-10-07.json.gz"));
    expect(await readStoredProjectionLevelsFile(file)).toEqual({ levels: null });
    expect(await readProjectionLevels(file)).toBeNull();
    await writeProjectionLevelsFile(file, record());
    expect(await readStoredProjectionLevelsFile(file)).toEqual({ levels: record() });
    expect(await readProjectionLevels(file)).toEqual(record());
    await writeFile(file, "garbage");
    expect(await readStoredProjectionLevelsFile(file)).toEqual({ unreadable: true });
    await expect(readProjectionLevels(file)).rejects.toThrow();
  });

  it("saveProjectionLevelsFile keeps a day's first record; replaces an unreadable file or another day's; leaves another version alone; never rejects (the error's name only)", async () => {
    const first = record();
    const file = projectionLevelsFile(dir, 2026, "2026-10-07");
    expect(await saveProjectionLevelsFile(dir, first)).toEqual({ status: "saved" });
    const later = levelsOf([week(5, [row("7001", "WR", [1, 1, 1])])]);
    expect(await saveProjectionLevelsFile(dir, later)).toEqual({ status: "unchanged" });
    expect(await readProjectionLevels(file)).toEqual(first);
    await writeFile(file, "garbage");
    expect(await saveProjectionLevelsFile(dir, later)).toEqual({ status: "saved" });
    expect(await readProjectionLevels(file)).toEqual(later);
    await writeProjectionLevelsFile(file, { ...later, day: "2026-10-06" });
    expect(await saveProjectionLevelsFile(dir, first)).toEqual({ status: "saved" });
    await writeFile(file, gzipSync(Buffer.from(JSON.stringify({ version: 2 }))));
    expect(await saveProjectionLevelsFile(dir, first)).toEqual({ status: "failed", error: "OtherVersion" });
    expect(await readStoredProjectionLevelsFile(file)).toEqual({ otherVersion: true });
    // A root that is a file: the save fails by the error's name, logged without the path.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const notAFolder = path.join(dir, "a-file");
    await writeFile(notAFolder, "x");
    const failed = await saveProjectionLevelsFile(notAFolder, first);
    expect(failed.status).toBe("failed");
    const lines = errors.mock.calls.map((c) => String(c[0])).join("\n");
    expect(lines).toContain('"event":"projection_levels_failed"');
    expect(lines).not.toContain(dir);
  });
});

describe("never a league's scoring, the market blend or FantasyCalc (planner reply to Checkpoint 7b, question 4)", () => {
  it("in this file every function of league scoring, the model's projections, the blend, the market values and FantasyCalc's loader throws", async () => {
    expect(() => expectedPoints({}, "WR", { perStat: {}, rules: [], unmapped: [] })).toThrow("a level read league scoring (expectedPoints)");
    expect(() => marketBlend([], null)).toThrow("a level read the market blend (marketBlend)");
    expect(() => marketValues([], {}, null)).toThrow("a level read the market values (marketValues)");
    expect(() => loadFantasyCalcValues({} as HttpClient, { isDynasty: false, numQbs: 1, numTeams: 10, ppr: 1, substitutions: [] })).toThrow("a level read FantasyCalc's values");
  });

  it("the module imports none of them, and its code names none of them", () => {
    const source = readFileSync(new URL("./projectionLevels.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(5);
    const never = ["@/engine/scoring", "@/engine/projections", "@/engine/blend", "@/engine/market", "@/engine/league", "@/engine/inputs", "@/data/fantasyCalcValues", "@/data/load", "@/server/fantasyCalcArchive", "@/server/modelInputs"];
    expect(imports.filter((i) => never.includes(i as string))).toEqual([]);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/scoring|blend|market|fantasycalc|expectedPoints/i);
  });

  it("the cron's levels part end to end: Sleeper's lists in, one key out; no FantasyCalc request, no other key, no other store method", async () => {
    const OFFENSE = OFFENSE_POSITIONS;
    const routes: Record<string, unknown> = {
      [sleeperUrls.state()]: { week: 5, season: "2026", season_type: "regular" },
      [nflScheduleUrl(2026)]: SCHEDULE,
    };
    for (let w = 5; w <= 18; w++) routes[sleeperUrls.projections(2026, w, OFFENSE)] = [row("7001", "WR", [w, w + 0.5, w + 1], { gp: 1, rec: w }), w === 9 ? stub("7002", "RB") : row("7002", "RB", [12, 13, 14]), row("KC", "DEF", [7, 7, 7])];
    const asked: string[] = [];
    const http: HttpClient = {
      async get(url: string): Promise<HttpResponse> {
        asked.push(url);
        if (!(url in routes)) return { status: 404, ok: false, isHtml: false, json: undefined, text: "", fromCache: false };
        return { status: 200, ok: true, isHtml: false, json: routes[url], text: "", fromCache: false, fetchedAt: WEDNESDAY - HOUR };
      },
    };
    const redis = new FakeRedis(() => WEDNESDAY);
    const touched: string[] = [];
    const recording = new Proxy(redis, {
      get(target, prop, receiver) {
        const value: unknown = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          touched.push(`${String(prop)} ${String(args[0])}`);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const shared = sharedSnapshotStore(recording, { env: PROD, clock: () => WEDNESDAY });
    const refuse = (what: string) => () => {
      throw new Error(`the levels part ${what}`);
    };
    const onlyLevels: SnapshotStore = {
      kind: "shared",
      lock: refuse("took the lock"),
      formatsUsed: refuse("read the formats in use"),
      savedDays: refuse("read the FantasyCalc index"),
      saveWeek: refuse("saved a pre-game week"),
      saveList: refuse("saved a FantasyCalc list"),
      saveLevels: (r) => shared.saveLevels(r),
    };
    const part = await snapshotLevels(http, onlyLevels, new Date(WEDNESDAY));
    expect(part).toMatchObject({ day: "2026-10-07", status: "saved", fromWeek: 5, toWeek: 18, players: 3, warnings: [] });
    expect(touched).toEqual([`set ${projectionLevelsKey(P, 2026, "2026-10-07")}`]);
    expect(redis.ttlMs(projectionLevelsKey(P, 2026, "2026-10-07"))).toBe(dayRetainMs("2026-10-07", WEDNESDAY));
    expect(asked).toEqual([sleeperUrls.state(), nflScheduleUrl(2026), ...Array.from({ length: 14 }, (_, i) => sleeperUrls.projections(2026, 5 + i, OFFENSE))]);
    expect(asked.filter((u) => /fantasycalc/i.test(u))).toEqual([]);
    const stored = await unpackProjectionLevels(Buffer.from((await redis.get(projectionLevelsKey(P, 2026, "2026-10-07"))) as string, "base64"));
    if (!("levels" in stored)) throw new Error("not a record");
    // Sleeper's own totals, averaged: weeks 5–18 for the receiver (5…18: 11.5), every week but his bye (9) for the back.
    expect(stored.levels.players).toEqual({
      "7001": ["WR", 11.5, 12, 12.5, 0b111111111111110000],
      "7002": ["RB", 12, 13, 14, 0b111111111011110000],
      KC: ["DEF", 7, 7, 7, 0b111111111111110000],
    });
    expect(Object.keys(stored.levels.weeks)).toEqual(Array.from({ length: 14 }, (_, i) => String(5 + i)));
  });
});
