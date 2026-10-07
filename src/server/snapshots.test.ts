/**
 * The daily snapshot cron's core (planner reply to Checkpoint 7a, §6.3; src/server/snapshots.ts): format keys, the formats
 * builds record, the shared store (FakeRedis: the lock, the merge rule's overwrite, the day's first list, the index, the
 * day's levels), the run (the pre-kickoff rule, the format cap, today's list from the cache before FantasyCalc, the levels'
 * weeks and their all or nothing, the time guard, idempotence, and that the levels change nothing the other parts do) and
 * the local archives (a temporary folder). The levels' own rules: src/server/projectionLevels.test.ts. No network: a
 * caching fake client and committed fixtures.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sleeperUrls } from "@/adapters/sleeper/fetch";
import type { HttpClient, HttpRequestOptions, HttpResponse } from "@/adapters/types";
import { fantasyCalcValuesUrl } from "@/data/fantasyCalcValues";
import { nflScheduleUrl, reduceNflSchedule, type NflScheduleResponse } from "@/data/nflSchedule";
import { FIXTURE } from "@/data/testSupport";
import type { FantasyCalcFormat } from "@/engine/inputs";
import { FANTASYCALC_TEAM_SIZES } from "@/engine/market";
import type { Pos } from "@/engine/model";
import { readSanitizedFixture } from "@/test-utils/fixtures";
import { newRequestScope, runInRequestScope } from "./deadline";
import { fantasyCalcFormatKey, fantasyCalcSnapshotFile, readFantasyCalcSnapshot, unpackFantasyCalcSnapshot } from "./fantasyCalcArchive";
import { snapshotLimits } from "./limits";
import { packProjectionSnapshot, projectionSnapshotFile, readProjectionSnapshot, unpackProjectionSnapshot, type ProjectionArchiveInput } from "./projectionArchive";
import { packProjectionLevels, projectionLevelsFile, readProjectionLevels, unpackProjectionLevels, type PlayerLevels, type ProjectionLevels } from "./projectionLevels";
import { FakeRedis } from "./redis";
import {
  dayExpired,
  dayRetainMs,
  daysFromTo,
  fantasyCalcIndexKey,
  fantasyCalcSnapshotKey,
  formatsInUseKey,
  formatsToSave,
  levelsFromWeek,
  localSnapshotStore,
  noteFormatsInUse,
  parseFormatKey,
  projectionLevelsKey,
  projectionSnapshotKey,
  resetFormatsInUseForTests,
  resetLocalSnapshotLockForTests,
  runSnapshots,
  seasonOfDay,
  sharedSnapshotStore,
  snapshotLevels,
  snapshotLockKey,
  snapshotStoreFor,
  snapshotWeeks,
  todaysList,
  turnDays,
  unnotedFormats,
  utcDay,
  type SnapshotRun,
} from "./snapshots";

const DAY = 24 * 3_600_000;
const HOUR = 3_600_000;
const PROD = { VERCEL_ENV: "production" };
const P = "os:production:";
const ALL: Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];
const SCHEDULE = readSanitizedFixture<NflScheduleResponse>("shared", FIXTURE.espnProTeams);
/** The committed schedule's first kickoffs: week 5 on Thursday night, 2026-10-09 00:15 UTC; week 6 a week later. */
const KICKOFF5 = Date.parse("2026-10-09T00:15:00.000Z");
const KICKOFF6 = Date.parse("2026-10-16T00:15:00.000Z");
/** The cron's hour on the Wednesday before week 5 (2026-10-07 20:05 UTC). */
const WEDNESDAY = Date.parse("2026-10-07T20:05:00.000Z");

const redraft10: FantasyCalcFormat = { isDynasty: false, numQbs: 1, numTeams: 10, ppr: 0.5, substitutions: [] };
const redraft12: FantasyCalcFormat = { isDynasty: false, numQbs: 1, numTeams: 12, ppr: 1, substitutions: [] };
const dynasty12: FantasyCalcFormat = { isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1, tep: "te+", substitutions: [] };
const keyOf = (f: FantasyCalcFormat) => fantasyCalcFormatKey(f) as string;

/** A FantasyCalc /values/current body of `n` fictional players (made-up ids). */
function fcBody(n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({
    player: { id: 70_000 + i, name: `Player ${i}`, position: i % 2 ? "WR" : "RB", sleeperId: String(80_000 + i), espnId: null },
    value: 9_000 - i * 10,
    redraftValue: null,
    overallRank: i + 1,
    positionRank: Math.floor(i / 2) + 1,
  }));
}
const bodyFor = (f: FantasyCalcFormat) => fcBody(f.isDynasty ? 320 : 160);

/** One week's Sleeper rows: a real projection per position (fictional ids), stamped `at`, plus a stub. */
function sleeperRows(week: number, at: number): unknown[] {
  const rows: unknown[] = ALL.map((pos, i) => ({
    player_id: pos === "DEF" ? "KC" : String(9_000 + week * 100 + i),
    stats: { gp: 1, pass_yd: pos === "QB" ? 250.5 : 0, rec: pos === "WR" ? 5.1 : 0, idp_tkl: ["DL", "LB", "DB"].includes(pos) ? 4 : 0, pts_allow: pos === "DEF" ? 21 : 0, pts_ppr: 12 },
    player: { position: pos, fantasy_positions: [pos] },
    last_modified: at,
  }));
  rows.push({ player_id: "9999", stats: { adp_dd_ppr: 300 }, player: { position: "WR", fantasy_positions: ["WR"] } });
  return rows;
}

/** The offense group the levels read (src/adapters/sleeper/fetch.ts OFFENSE_POSITIONS), and its weeks' URLs. */
const OFFENSE: Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
const levelsUrl = (week: number) => sleeperUrls.projections(2026, week, OFFENSE);
/** Weeks `from` through `to`, and the levels' requests for them, in order. */
const levelsWeeks = (from: number, to = 18) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const levelsUrls = (from: number, to = 18) => levelsWeeks(from, to).map(levelsUrl);
const LEVELS_URLS = new Set(levelsUrls(1));
const isLevelsUrl = (url: string) => LEVELS_URLS.has(url);

/**
 * One week of the offense list the levels read (fictional ids): a receiver whose three totals rise a point a week, a back on
 * bye in week 9 (a stub that week), a team defense, and a returner whose real row carries no totals (never counted).
 */
function offenseRows(week: number, at: number): unknown[] {
  const wr = { position: "WR", fantasy_positions: ["WR"] };
  const rb = { position: "RB", fantasy_positions: ["RB"] };
  return [
    { player_id: "7001", stats: { gp: 1, rec: 5, pts_std: week, pts_half_ppr: week + 0.5, pts_ppr: week + 1 }, player: wr, last_modified: at },
    week === 9 ? { player_id: "7002", stats: { adp_dd_ppr: 40 }, player: rb } : { player_id: "7002", stats: { gp: 1, rush_yd: 70, pts_std: 12, pts_half_ppr: 13, pts_ppr: 14 }, player: rb, last_modified: at },
    { player_id: "KC", stats: { gp: 1, pts_allow: 21, pts_std: 7, pts_half_ppr: 7, pts_ppr: 7 }, player: { position: "DEF", fantasy_positions: ["DEF"] }, last_modified: at },
    { player_id: "7003", stats: { gp: 1, kr_yd: 30 }, player: wr, last_modified: at },
  ];
}

/** The mask of weeks `from` through `to` (bit w − 1 each), less `except`. */
function weeksMask(from: number, to: number, except: number[] = []): number {
  let mask = 0;
  for (let w = from; w <= to; w++) if (!except.includes(w)) mask |= 1 << (w - 1);
  return mask;
}

/** The levels of the Wednesday before week 5: weeks 5–18, Sleeper's own totals averaged (the receiver's 5…18: 11.5). */
const LEVELS_WEDNESDAY: Record<string, PlayerLevels> = {
  "7001": ["WR", 11.5, 12, 12.5, weeksMask(5, 18)],
  "7002": ["RB", 12, 13, 14, weeksMask(5, 18, [9])],
  KC: ["DEF", 7, 7, 7, weeksMask(5, 18)],
};

/** A day's stored levels, unpacked. */
async function storedLevels(redis: FakeRedis, day: string): Promise<ProjectionLevels> {
  const found = await unpackProjectionLevels(Buffer.from((await redis.get(projectionLevelsKey(P, 2026, day))) as string, "base64"));
  if (!("levels" in found)) throw new Error("no levels stored");
  return found.levels;
}

interface Cached {
  json: unknown;
  fetchedAt: number;
}

/**
 * An HttpClient with the real client's cache rules where they matter here (src/server/http.ts): a copy younger than the
 * request's TTL is served from the cache; cacheOnly never asks (an older copy stands in with staleIfError, else status 0);
 * a live request for a route `down` says is down serves the older copy, marked stale. `live` records every request that
 * went out.
 */
function cachingHttp(routes: Record<string, unknown>, clock: () => number, opts: { down?: (url: string) => boolean } = {}) {
  const cache = new Map<string, Cached>();
  const live: string[] = [];
  const answer = (c: Cached, extra: Partial<HttpResponse> = {}): HttpResponse => ({ status: 200, ok: true, isHtml: false, json: c.json, text: JSON.stringify(c.json), fromCache: true, fetchedAt: c.fetchedAt, ...extra });
  const none = (status: number): HttpResponse => ({ status, ok: false, isHtml: false, json: undefined, text: "", fromCache: false });
  const http: HttpClient = {
    async get(url: string, o: HttpRequestOptions = {}): Promise<HttpResponse> {
      const c = o.cache;
      const hit = c ? cache.get(c.key) : undefined;
      if (hit && c && clock() - hit.fetchedAt < c.ttlMs) return answer(hit);
      if (o.cacheOnly) return hit && c?.staleIfError ? answer(hit, { stale: true }) : none(0);
      live.push(url);
      if (opts.down?.(url)) return hit && c?.staleIfError ? answer(hit, { stale: true, liveFailure: { status: 503, isHtml: false } }) : none(503);
      if (!(url in routes)) return none(404);
      const entry = { json: routes[url], fetchedAt: clock() };
      if (c) cache.set(c.key, entry);
      return answer(entry, { fromCache: false });
    },
  };
  /** Puts a copy in the cache as a request of `key` would have stored it at `fetchedAt`. */
  const seed = (key: string, json: unknown, fetchedAt: number) => cache.set(key, { json, fetchedAt });
  return { http, live, seed };
}

const fcKey = (f: FantasyCalcFormat) => `fantasycalc:${fantasyCalcValuesUrl(f)}`;

/**
 * Every route a run reads: Sleeper's state at `week`, the schedule, weeks 5–7's projections (all nine positions), the
 * formats' lists, and weeks 5–18 of the offense list the levels read.
 */
function routes(opts: { week?: number; seasonType?: string; formats?: FantasyCalcFormat[]; at?: number } = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    [sleeperUrls.state()]: { week: opts.week ?? 5, season: "2026", season_type: opts.seasonType ?? "regular" },
    [nflScheduleUrl(2026)]: SCHEDULE,
  };
  for (const w of [5, 6, 7]) out[sleeperUrls.projections(2026, w, ALL)] = sleeperRows(w, opts.at ?? WEDNESDAY - HOUR);
  for (const f of opts.formats ?? []) out[fantasyCalcValuesUrl(f)] = bodyFor(f);
  for (let w = 5; w <= 18; w++) out[levelsUrl(w)] = offenseRows(w, opts.at ?? WEDNESDAY - HOUR);
  return out;
}

/** The formats builds recorded, as noteFormatsInUse writes them. */
async function recordFormats(redis: FakeRedis, day: string, formats: FantasyCalcFormat[]): Promise<void> {
  await redis.saddExpire(formatsInUseKey(P, day), formats.map(keyOf), 3 * DAY);
}

const done = (run: SnapshotRun) => {
  if (run.status !== "done") throw new Error(`run ${run.status}`);
  return run;
};

beforeEach(() => {
  resetFormatsInUseForTests();
  resetLocalSnapshotLockForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("keys, days and format keys", () => {
  it("keys sit under the deployment's prefix and name only public facts: a season, a week, a day, a format", () => {
    expect(snapshotLockKey(P)).toBe("os:production:snap:lock");
    expect(formatsInUseKey(P, "2026-10-05")).toBe("os:production:fc-formats:2026-10-05");
    expect(projectionSnapshotKey(P, 2026, 5)).toBe("os:production:snap:proj:2026:5");
    expect(fantasyCalcSnapshotKey(P, { season: 2026, day: "2026-10-05", key: "redraft-1qb-10team-ppr0.5" })).toBe("os:production:snap:fc:2026:2026-10-05:redraft-1qb-10team-ppr0.5");
    // One index set a day (review of Phase 7b: one a season kept every day's entries as long as its newest).
    expect(fantasyCalcIndexKey(P, { season: 2026, day: "2026-10-05" })).toBe("os:production:snap:fc-index:2026:2026-10-05");
    // One record of levels a day (planner reply to Checkpoint 7b, question 4).
    expect(projectionLevelsKey(P, 2026, "2026-10-07")).toBe("os:production:snap:lvl:2026:2026-10-07");
  });

  it("days: a span of UTC days, the turn order's window (this season only), and how long a day's records are kept", () => {
    expect(daysFromTo("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(daysFromTo("2026-10-06", "2026-10-05")).toEqual([]);
    expect(daysFromTo("junk", "2026-10-05")).toEqual([]);
    const window = turnDays("2026-10-07");
    expect(window).toHaveLength(snapshotLimits.turnLookbackDays);
    expect([window[0], window.at(-1)]).toEqual(["2026-10-07", "2026-09-24"]);
    // Early March: the window stops at the season's first day (February's days are last season's).
    expect(turnDays("2026-03-03")).toEqual(["2026-03-03", "2026-03-02", "2026-03-01"]);
    expect(turnDays("not a day")).toEqual([]);
    const start = Date.parse("2026-10-05T00:00:00.000Z");
    expect(dayRetainMs("2026-10-05", start)).toBe(snapshotLimits.retainDays * DAY);
    expect(dayRetainMs("2026-10-05", start + 23 * HOUR)).toBe(snapshotLimits.retainDays * DAY - 23 * HOUR);
    expect(dayRetainMs("2026-10-05", start + snapshotLimits.retainDays * DAY + DAY)).toBe(1);
    expect(dayRetainMs("junk", start)).toBe(1);
    expect(dayExpired("2026-10-05", start + snapshotLimits.retainDays * DAY)).toBe(true);
    expect(dayExpired("2026-10-05", start + snapshotLimits.retainDays * DAY - 1)).toBe(false);
    expect(dayExpired("junk", start)).toBe(false);
  });

  it("UTC days and their NFL season (January and February belong to last year's season)", () => {
    expect(utcDay(Date.parse("2026-10-05T23:59:59Z"))).toBe("2026-10-05");
    expect(seasonOfDay("2026-10-05")).toBe(2026);
    expect(seasonOfDay("2027-01-10")).toBe(2026);
    expect(seasonOfDay("2027-03-01")).toBe(2027);
  });

  it("parseFormatKey: every format a league can ask for round-trips (144); anything else is refused", () => {
    let n = 0;
    for (const isDynasty of [false, true])
      for (const numQbs of [1, 2] as const)
        for (const numTeams of FANTASYCALC_TEAM_SIZES)
          for (const ppr of [0, 0.5, 1] as const)
            for (const tep of [undefined, "te+", "te++"] as const) {
              const f: FantasyCalcFormat = { isDynasty, numQbs, numTeams, ppr, ...(tep ? { tep } : {}), substitutions: [] };
              const key = keyOf(f);
              expect(parseFormatKey(key)).toEqual(f);
              n++;
            }
    expect(n).toBe(144);
    for (const bad of ["redraft-1qb-16team-ppr1", "redraft-1qb-10team-ppr0.75", "redraft-3qb-10team-ppr1", "redraft-1qb-10team-ppr1-teplus-x", "keeper-1qb-10team-ppr1", "redraft-1qb-010team-ppr1", "", "../x"]) {
      expect(parseFormatKey(bad)).toBeNull();
    }
  });

  it("formatsToSave: the formats take turns (never saved this season first, then the longest unsaved), redraft before dynasty, then used both days, today's, yesterday's, then the key; junk dropped", () => {
    const [a, b, c, d] = ["dynasty-1qb-12team-ppr1", "redraft-1qb-10team-ppr0.5", "redraft-1qb-12team-ppr1", "redraft-2qb-14team-ppr1"];
    // Nothing saved yet: the redraft lists first (both days, today's, yesterday's), the dynasty one after them.
    expect(formatsToSave([c, b, "junk", a], [d, c, a])).toEqual([c, b, d, a]);
    // Saved before: never saved first, then the oldest newest copy, whatever the use or the key.
    const saved = new Map([
      [c, "2026-10-06"],
      [b, "2026-10-04"],
      [a, "2026-10-05"],
    ]);
    expect(formatsToSave([c, b, a], [d, c, a], saved)).toEqual([d, b, a, c]);
    // On equal days the redraft list goes first, then the use.
    expect(formatsToSave([a, b], [a], new Map([[a, "2026-10-05"], [b, "2026-10-05"]]))).toEqual([b, a]);
    expect(formatsToSave([], [])).toEqual([]);
  });

  it("formatsToSave: a dozen dynasty formats a visitor's builds record can't keep a real redraft format out of the archive (the review's crowd-out case)", () => {
    const real = "redraft-1qb-10team-ppr0.5";
    const junk = [8, 10, 12, 14].flatMap((t) => ["0", "0.5", "1"].map((p) => `dynasty-2qb-${t}team-ppr${p}`));
    const cap = snapshotLimits.fantasyCalcFormatsPerDay;
    const newest = new Map<string, string>();
    for (const day of ["2026-10-06", "2026-10-07", "2026-10-08"]) {
      const saved = formatsToSave([real, ...junk], [real, ...junk], newest).slice(0, cap);
      expect(saved, day).toContain(real);
      for (const k of saved) newest.set(k, day);
    }
    // And the dynasty formats take turns among themselves: every one saved within two days.
    const first = formatsToSave([real, ...junk], [], new Map()).slice(0, cap);
    const after = new Map(first.map((k) => [k, "2026-10-06"]));
    const second = formatsToSave([real, ...junk], [], after).slice(0, cap);
    expect(new Set([...first, ...second])).toEqual(new Set([real, ...junk]));
  });

  it("snapshotWeeks: the current week and the next, each while its first kickoff is ahead; unknown kickoffs only after the current week; never past week 18", () => {
    const schedule = reduceNflSchedule(SCHEDULE, (a) => a);
    expect(snapshotWeeks(5, schedule, WEDNESDAY)).toEqual([
      { week: 5, firstKickoff: KICKOFF5, ahead: true },
      { week: 6, firstKickoff: KICKOFF6, ahead: true },
    ]);
    expect(snapshotWeeks(5, schedule, KICKOFF5).map((w) => w.ahead)).toEqual([false, true]); // the kickoff itself is too late
    expect(snapshotWeeks(5, null, WEDNESDAY).map((w) => [w.week, w.ahead])).toEqual([
      [5, false],
      [6, true],
    ]);
    // Week 18's games are all TBD in the committed schedule: next week while week 17 is on, unknown once it's current.
    expect(snapshotWeeks(17, schedule, Date.parse("2027-01-02T12:00:00Z")).map((w) => [w.week, w.ahead])).toEqual([
      [17, false],
      [18, true],
    ]);
    expect(snapshotWeeks(18, schedule, Date.parse("2027-01-06T12:00:00Z"))).toEqual([{ week: 18, firstKickoff: null, ahead: false }]);
  });

  it("levelsFromWeek: the first week from the current one whose first kickoff is still ahead (the archive's rule); none left: null", () => {
    const schedule = reduceNflSchedule(SCHEDULE, (a) => a);
    expect(levelsFromWeek(5, schedule, WEDNESDAY)).toBe(5);
    expect(levelsFromWeek(5, schedule, KICKOFF5)).toBe(6); // the kickoff itself is too late
    expect(levelsFromWeek(5, schedule, Date.parse("2026-10-12T20:05:00Z"))).toBe(6); // the Monday after: still week 6
    // A state that lags behind the games (still week 5 after week 6's first kickoff): the next week not yet started.
    expect(levelsFromWeek(5, schedule, KICKOFF6 + HOUR)).toBe(7);
    // Unknown kickoffs: only a week after the current one counts.
    expect(levelsFromWeek(5, null, WEDNESDAY)).toBe(6);
    expect(levelsFromWeek(17, schedule, Date.parse("2027-01-02T12:00:00Z"))).toBe(18);
    expect(levelsFromWeek(18, schedule, Date.parse("2027-01-06T12:00:00Z"))).toBeNull();
    // The preseason (the week about to be played is week 1).
    expect(levelsFromWeek(1, schedule, Date.parse("2026-08-20T20:05:00Z"))).toBe(1);
  });
});

describe("the formats builds read (noteFormatsInUse)", () => {
  it("one SADD and PEXPIRE transaction for what this process hasn't recorded that day, kept 3 days; the same formats again cost nothing", async () => {
    let now = WEDNESDAY;
    const redis = new FakeRedis(() => now);
    await noteFormatsInUse(redis, [keyOf(redraft10), keyOf(dynasty12), "junk", keyOf(redraft10)], "2026-10-07", { env: PROD });
    expect(redis.stats.commands).toBe(2);
    expect((await redis.smembers(formatsInUseKey(P, "2026-10-07"))).sort()).toEqual([keyOf(dynasty12), keyOf(redraft10)]);
    expect(redis.ttlMs(formatsInUseKey(P, "2026-10-07"))).toBe(snapshotLimits.formatsInUseRetainDays * DAY);
    const before = redis.stats.commands;
    await noteFormatsInUse(redis, [keyOf(redraft10)], "2026-10-07", { env: PROD });
    expect(redis.stats.commands).toBe(before);
    expect(unnotedFormats([keyOf(redraft10), keyOf(redraft12)], "2026-10-07")).toEqual([keyOf(redraft12)]);
    // A new day writes again; the keys hold the day and nothing else, the members format keys only.
    now += DAY;
    await noteFormatsInUse(redis, [keyOf(redraft10)], "2026-10-08", { env: PROD });
    expect(redis.keys().sort()).toEqual([formatsInUseKey(P, "2026-10-07"), formatsInUseKey(P, "2026-10-08")]);
    now += 2 * DAY + 1; // 3 days after the first day's write
    expect(redis.keys()).toEqual([formatsInUseKey(P, "2026-10-08")]);
  });

  it("a failed write is logged by the error's name only and tried again by a later build", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis();
    const failing = Object.assign(Object.create(redis) as FakeRedis, {
      saddExpire: () => Promise.reject(Object.assign(new Error("https://user:secret@db.upstash.invalid refused"), { name: "UpstashError" })),
    });
    await noteFormatsInUse(failing, [keyOf(redraft10)], "2026-10-07", { env: PROD });
    expect(errors.mock.calls.map((c) => String(c[0])).join("\n")).toContain('"errorName":"UpstashError"');
    expect(errors.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("secret");
    await noteFormatsInUse(redis, [keyOf(redraft10)], "2026-10-07", { env: PROD });
    expect(await redis.smembers(formatsInUseKey(P, "2026-10-07"))).toEqual([keyOf(redraft10)]);
  });
});

describe("the shared store (sharedSnapshotStore)", () => {
  function input(fetchedAt: number, opts: { week?: number; currentWeek?: number; firstKickoff?: number | null; positions?: Pos[] } = {}): ProjectionArchiveInput {
    const week = opts.week ?? 5;
    const raw = sleeperRows(week, fetchedAt);
    return {
      season: 2026,
      week,
      positions: opts.positions ?? ALL,
      rows: raw as ProjectionArchiveInput["rows"],
      res: { status: 200, ok: true, isHtml: false, json: raw, text: "", fromCache: false, fetchedAt },
      currentWeek: opts.currentWeek ?? 5,
      firstKickoff: opts.firstKickoff === undefined ? KICKOFF5 : opts.firstKickoff,
    };
  }

  it("the lock: one holder at a time, released only by its holder, gone after snapshotLimits.lockMs if never released", async () => {
    let now = WEDNESDAY;
    const redis = new FakeRedis(() => now);
    const store = sharedSnapshotStore(redis, { env: PROD, clock: () => now });
    const first = await store.lock();
    expect(first).not.toBeNull();
    expect(redis.ttlMs(snapshotLockKey(P))).toBe(snapshotLimits.lockMs);
    expect(await store.lock()).toBeNull();
    await first?.release();
    const second = await store.lock();
    expect(second).not.toBeNull();
    now += snapshotLimits.lockMs; // never released: it expires
    const third = await store.lock();
    expect(third).not.toBeNull();
    await second?.release(); // a stale holder can't release the new holder's lock
    expect(await store.lock()).toBeNull();
    await third?.release();
    expect(redis.keys()).toEqual([]);
  });

  it("a week: saved as the base64 of the local file's bytes, kept two seasons; the same fetch again changes nothing; a later pre-kickoff fetch overwrites; after kickoff nothing", async () => {
    let now = WEDNESDAY;
    const redis = new FakeRedis(() => now);
    const store = sharedSnapshotStore(redis, { env: PROD, clock: () => now });
    const key = projectionSnapshotKey(P, 2026, 5);
    expect(await store.saveWeek(input(WEDNESDAY - HOUR))).toEqual({ status: "saved", replaced: ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"] });
    expect(redis.ttlMs(key)).toBe(snapshotLimits.retainDays * DAY);
    const stored = await unpackProjectionSnapshot(Buffer.from((await redis.get(key)) as string, "base64"));
    if (!("snapshot" in stored)) throw new Error("not a snapshot");
    expect(stored.snapshot).toMatchObject({ version: 1, season: 2026, week: 5, firstKickoff: new Date(KICKOFF5).toISOString() });
    expect(stored.snapshot.groups.QB?.fetchedAt).toBe(new Date(WEDNESDAY - HOUR).toISOString());
    expect(stored.snapshot.groups.QB?.players["9500"]?.stats).not.toHaveProperty("pts_ppr");
    expect(Object.keys(stored.snapshot.groups.WR?.players ?? {})).toEqual(["9502"]); // the stub row isn't kept
    // The stored text is exactly the file's bytes in base64 (snapshot:pull writes them back as a file).
    expect(await redis.get(key)).toBe((await packProjectionSnapshot(stored.snapshot)).toString("base64"));

    expect(await store.saveWeek(input(WEDNESDAY - HOUR))).toEqual({ status: "unchanged" });
    expect(await store.saveWeek(input(WEDNESDAY - 5 * HOUR))).toEqual({ status: "unchanged" }); // an older copy
    now = KICKOFF5 - HOUR;
    expect(await store.saveWeek(input(KICKOFF5 - 2 * HOUR, { positions: ["QB"] }))).toEqual({ status: "saved", replaced: ["QB"] });
    const later = await unpackProjectionSnapshot(Buffer.from((await redis.get(key)) as string, "base64"));
    expect("snapshot" in later && later.snapshot.groups.QB?.fetchedAt).toBe(new Date(KICKOFF5 - 2 * HOUR).toISOString());
    expect("snapshot" in later && later.snapshot.groups.RB?.fetchedAt).toBe(new Date(WEDNESDAY - HOUR).toISOString());
    expect(await store.saveWeek(input(KICKOFF5 + HOUR))).toEqual({ status: "skipped", reason: "after kickoff" });
    expect(await store.saveWeek(input(WEDNESDAY, { firstKickoff: null }))).toEqual({ status: "skipped", reason: "kickoff unknown" });
  });

  it("a week: an unreadable stored record is replaced (logged), one of another format version left alone", async () => {
    const redis = new FakeRedis(() => WEDNESDAY);
    const store = sharedSnapshotStore(redis, { env: PROD, clock: () => WEDNESDAY });
    const key = projectionSnapshotKey(P, 2026, 5);
    await redis.set(key, "not base64 gzip");
    expect(await store.saveWeek(input(WEDNESDAY - HOUR))).toMatchObject({ status: "saved" });
    const { gzipSync } = await import("node:zlib");
    await redis.set(key, gzipSync(JSON.stringify({ version: 2 })).toString("base64"));
    expect(await store.saveWeek(input(WEDNESDAY - HOUR))).toEqual({ status: "failed", error: "OtherVersion" });
  });

  it("a list: the day's first copy kept two seasons from its day, indexed in its day's set for snapshot:pull; a second copy of the day changes nothing", async () => {
    const redis = new FakeRedis(() => WEDNESDAY);
    const store = sharedSnapshotStore(redis, { env: PROD, clock: () => WEDNESDAY });
    const players = (bodyFor(redraft10) as Array<{ player: { id: number; sleeperId: string; position: string }; value: number }>).map((r) => ({
      fantasyCalcId: String(r.player.id),
      sleeperId: r.player.sleeperId,
      espnId: null,
      position: r.player.position,
      value: r.value,
      redraftValue: null,
    }));
    const list = { format: redraft10, players, fetchedAt: WEDNESDAY - 2 * HOUR };
    expect(await store.saveList(list)).toEqual({ status: "saved" });
    const where = { season: 2026, day: "2026-10-07", key: keyOf(redraft10) };
    // The list and its day's index set both go two seasons after 2026-10-07 began (20:05 UTC is 20 h 5 min into the day).
    const keep = snapshotLimits.retainDays * DAY - (20 * HOUR + 5 * 60_000);
    expect(dayRetainMs("2026-10-07", WEDNESDAY)).toBe(keep);
    expect(redis.ttlMs(fantasyCalcSnapshotKey(P, where))).toBe(keep);
    expect(await redis.smembers(fantasyCalcIndexKey(P, where))).toEqual(["redraft-1qb-10team-ppr0.5"]);
    expect(redis.ttlMs(fantasyCalcIndexKey(P, where))).toBe(keep);
    const saved = await unpackFantasyCalcSnapshot(Buffer.from((await redis.get(fantasyCalcSnapshotKey(P, where))) as string, "base64"));
    expect("snapshot" in saved && Object.keys(saved.snapshot.players)).toHaveLength(160);
    expect("snapshot" in saved && saved.snapshot.format).toEqual({ isDynasty: false, numQbs: 1, numTeams: 10, ppr: 0.5 });
    expect(await store.saveList({ ...list, fetchedAt: WEDNESDAY })).toEqual({ status: "unchanged" });
    expect(await store.savedDays("2026-10-07")).toEqual(new Map([[keyOf(redraft10), "2026-10-07"]]));
    // Other days' sets count only up to the day asked about, and a key that isn't a format never.
    const day = (d: string) => fantasyCalcIndexKey(P, { season: 2026, day: d });
    await redis.saddExpire(day("2026-10-01"), [keyOf(redraft10)], DAY);
    await redis.saddExpire(day("2026-10-02"), [keyOf(redraft12)], DAY);
    await redis.saddExpire(day("2026-10-03"), ["junk", "2026-10-03/redraft-1qb-10team-ppr0.5"], DAY);
    expect(await store.savedDays("2026-10-06")).toEqual(
      new Map([
        [keyOf(redraft10), "2026-10-01"],
        [keyOf(redraft12), "2026-10-02"],
      ]),
    );
    expect(await store.savedDays("2026-10-07")).toEqual(
      new Map([
        [keyOf(redraft10), "2026-10-07"],
        [keyOf(redraft12), "2026-10-02"],
      ]),
    );
    // The turn order looks back snapshotLimits.turnLookbackDays days (one SMEMBERS a day): a list saved before that counts
    // as never saved, which puts its format first, as its age would.
    expect(snapshotLimits.turnLookbackDays).toBe(14);
    await redis.saddExpire(day("2026-09-20"), [keyOf(dynasty12)], DAY);
    expect((await store.savedDays("2026-10-03")).get(keyOf(dynasty12))).toBe("2026-09-20");
    expect((await store.savedDays("2026-10-04")).has(keyOf(dynasty12))).toBe(false);
    const sent = redis.stats.commands;
    await store.savedDays("2026-10-07");
    expect(redis.stats.commands - sent).toBe(snapshotLimits.turnLookbackDays);
    expect(await store.saveList({ ...list, fetchedAt: undefined })).toEqual({ status: "skipped", reason: "no fetch time" });
  });

  it("which formats were in use on a day is kept two seasons from that day, never longer: a later save leaves an earlier day's index alone (review of Phase 7b)", async () => {
    let now = WEDNESDAY;
    const redis = new FakeRedis(() => now);
    const store = sharedSnapshotStore(redis, { env: PROD, clock: () => now });
    const rare: FantasyCalcFormat = { isDynasty: true, numQbs: 2, numTeams: 14, ppr: 1, tep: "te++", substitutions: [] };
    const players = [{ fantasyCalcId: "1", sleeperId: "2", espnId: null, position: "WR", value: 10, redraftValue: null }];
    // A League page build on 2026-10-07 reads a rare format; the cron saves its list that day.
    await recordFormats(redis, "2026-10-07", [rare]);
    expect(await store.saveList({ format: rare, players, fetchedAt: WEDNESDAY - HOUR })).toEqual({ status: "saved" });
    const first = { season: 2026, day: "2026-10-07", key: keyOf(rare) };
    // Four days later the builds' own record is gone; the archive's list and its day's index remain.
    now = WEDNESDAY + 4 * DAY;
    expect(await redis.smembers(formatsInUseKey(P, "2026-10-07"))).toEqual([]);
    expect(await redis.smembers(fantasyCalcIndexKey(P, first))).toEqual([keyOf(rare)]);
    // A save late in the same season (2027-02-27) writes its own day's set and doesn't extend 2026-10-07's.
    now = Date.parse("2027-02-27T20:05:00.000Z");
    expect(await store.saveList({ format: rare, players, fetchedAt: now - HOUR })).toEqual({ status: "saved" });
    expect(redis.ttlMs(fantasyCalcIndexKey(P, first))).toBe(Date.parse("2026-10-07T00:00:00.000Z") + snapshotLimits.retainDays * DAY - now);
    // Two seasons after 2026-10-07 began, everything of that day is gone; the later day's records live on.
    const ends = Date.parse("2026-10-07T00:00:00.000Z") + snapshotLimits.retainDays * DAY;
    expect(new Date(ends).toISOString()).toBe("2028-10-06T00:00:00.000Z");
    now = ends - 1;
    expect(await redis.smembers(fantasyCalcIndexKey(P, first))).toEqual([keyOf(rare)]);
    now = ends;
    expect(await redis.smembers(fantasyCalcIndexKey(P, first))).toEqual([]);
    expect(await redis.get(fantasyCalcSnapshotKey(P, first))).toBeNull();
    expect(await redis.smembers(fantasyCalcIndexKey(P, { season: 2026, day: "2027-02-27" }))).toEqual([keyOf(rare)]);
    expect(dayExpired("2026-10-07", ends)).toBe(true);
    expect(dayExpired("2026-10-07", ends - 1)).toBe(false);
    expect(dayExpired("2027-02-27", ends)).toBe(false);
  });

  it("a day's levels: the base64 of the local file's bytes, the day's first record kept (SET NX), two seasons from its day; a giant isn't stored", async () => {
    let now = WEDNESDAY;
    const redis = new FakeRedis(() => now);
    const store = sharedSnapshotStore(redis, { env: PROD, clock: () => now });
    const key = projectionLevelsKey(P, 2026, "2026-10-07");
    const record: ProjectionLevels = {
      version: 1,
      season: 2026,
      day: "2026-10-07",
      seasonType: "regular",
      currentWeek: 5,
      fromWeek: 5,
      toWeek: 18,
      weeks: { "5": { fetchedAt: new Date(WEDNESDAY - HOUR).toISOString(), lastModified: WEDNESDAY - 2 * HOUR } },
      players: { "7001": ["WR", 5, 5.5, 6, weeksMask(5, 5)] },
    };
    expect(await store.saveLevels(record)).toEqual({ status: "saved" });
    expect(await redis.get(key)).toBe((await packProjectionLevels(record)).toString("base64"));
    expect(redis.ttlMs(key)).toBe(dayRetainMs("2026-10-07", WEDNESDAY));
    // A later run that day: the first record stays.
    now += HOUR;
    expect(await store.saveLevels({ ...record, players: { "7001": ["WR", 9, 9, 9, weeksMask(5, 5)] } })).toEqual({ status: "unchanged" });
    expect((await storedLevels(redis, "2026-10-07")).players).toEqual(record.players);
    // Two seasons after the day began it's gone.
    now = Date.parse("2026-10-07T00:00:00.000Z") + snapshotLimits.retainDays * DAY;
    expect(await redis.get(key)).toBeNull();
    // Past snapshotLimits.maxValueChars nothing is written.
    const limits = snapshotLimits as { maxValueChars: number };
    const cap = limits.maxValueChars;
    limits.maxValueChars = 10;
    try {
      expect(await store.saveLevels({ ...record, day: "2026-10-08" })).toEqual({ status: "failed", error: "TooLarge" });
    } finally {
      limits.maxValueChars = cap;
    }
    expect(await redis.get(projectionLevelsKey(P, 2026, "2026-10-08"))).toBeNull();
  });

  it("a store command that fails or hangs: that save fails, by the error's name, and the run's store sends nothing more (one log line)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis(() => WEDNESDAY);
    const hanging = Object.assign(Object.create(redis) as FakeRedis, { get: () => new Promise<string | null>(() => {}) });
    const store = sharedSnapshotStore(hanging, { env: PROD, timeoutMs: 20, clock: () => WEDNESDAY });
    expect(await store.saveWeek(input(WEDNESDAY - HOUR))).toEqual({ status: "failed", error: "TimeoutError" });
    const sent = redis.stats.commands;
    expect(await store.saveWeek(input(WEDNESDAY - HOUR, { week: 6 }))).toEqual({ status: "failed", error: "TimeoutError" });
    expect(await store.saveList({ format: redraft10, players: [{ fantasyCalcId: "1", sleeperId: "2", espnId: null, position: "WR", value: 10, redraftValue: null }], fetchedAt: WEDNESDAY })).toEqual({ status: "failed", error: "TimeoutError" });
    const levels: ProjectionLevels = { version: 1, season: 2026, day: "2026-10-07", seasonType: "regular", currentWeek: 5, fromWeek: 5, toWeek: 18, weeks: {}, players: { "7001": ["WR", 1, 1, 1, 16] } };
    expect(await store.saveLevels(levels)).toEqual({ status: "failed", error: "TimeoutError" });
    await expect(store.formatsUsed("2026-10-07")).rejects.toMatchObject({ name: "TimeoutError" });
    expect(redis.stats.commands).toBe(sent);
    const lines = errors.mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => l.includes('"event":"snapshot_store_failed"'))).toHaveLength(1);
    expect(lines.filter((l) => l.includes('"event":"snapshot_save_failed"'))).toHaveLength(0);
  });
});

describe("todaysList: today's copy from the cache before FantasyCalc", () => {
  it("a copy FantasyCalc served today: no request, even past the 3-hour TTL", async () => {
    const now = WEDNESDAY;
    const fake = cachingHttp(routes({ formats: [redraft10] }), () => now);
    fake.seed(fcKey(redraft10), bodyFor(redraft10), Date.parse("2026-10-07T01:00:00Z"));
    const got = await todaysList(fake.http, redraft10, new Date(now));
    expect("load" in got && got.load.fetchedAt).toBe(Date.parse("2026-10-07T01:00:00Z"));
    expect(fake.live).toEqual([]);
  });

  it("only yesterday's copy: one request (the TTL passed); none: one request; FantasyCalc down: yesterday's copy isn't today's list", async () => {
    const now = WEDNESDAY;
    const fake = cachingHttp(routes({ formats: [redraft10, redraft12] }), () => now);
    fake.seed(fcKey(redraft10), bodyFor(redraft10), Date.parse("2026-10-06T22:00:00Z"));
    const got = await todaysList(fake.http, redraft10, new Date(now));
    expect("load" in got && got.load.fetchedAt).toBe(now);
    expect(await todaysList(fake.http, redraft12, new Date(now))).toMatchObject({ load: { fetchedAt: now } });
    expect(fake.live).toEqual([fantasyCalcValuesUrl(redraft10), fantasyCalcValuesUrl(redraft12)]);

    const down = cachingHttp(routes({ formats: [redraft10] }), () => now, { down: (u) => u.includes("fantasycalc") });
    down.seed(fcKey(redraft10), bodyFor(redraft10), Date.parse("2026-10-06T22:00:00Z"));
    expect(await todaysList(down.http, redraft10, new Date(now))).toEqual({ skip: "not today's list" });
    expect(await todaysList(down.http, redraft12, new Date(now))).toEqual({ skip: "unavailable" });
  });
});

describe("runSnapshots on the shared store", () => {
  it("the Wednesday before week 5: weeks 5 and 6 saved, the formats used yesterday or today saved from today's lists, then the day's levels over weeks 5–18; a second run changes nothing and asks only Sleeper's state again", async () => {
    let now = WEDNESDAY;
    const redis = new FakeRedis(() => now);
    const store = sharedSnapshotStore(redis, { env: PROD, clock: () => now });
    await recordFormats(redis, "2026-10-07", [redraft10, dynasty12]);
    await recordFormats(redis, "2026-10-06", [redraft10, redraft12]);
    const fake = cachingHttp(routes({ formats: [redraft10, redraft12, dynasty12] }), () => now);
    // A build read redraft10 this morning: the cron reuses that copy.
    fake.seed(fcKey(redraft10), bodyFor(redraft10), Date.parse("2026-10-07T09:00:00Z"));

    const run = done(await runSnapshots({ http: fake.http, store, now: new Date(now) }));
    expect(run.store).toBe("shared");
    expect(run.projections).toMatchObject({ season: 2026, seasonType: "regular", currentWeek: 5, warnings: [] });
    expect(run.projections.weeks.map((w) => [w.week, w.status, w.firstKickoff])).toEqual([
      [5, "saved", new Date(KICKOFF5).toISOString()],
      [6, "saved", new Date(KICKOFF6).toISOString()],
    ]);
    expect(run.fantasyCalc).toEqual({
      day: "2026-10-07",
      inUse: 3,
      savedBefore: 0,
      // None saved before: the redraft lists first (used both days, then yesterday's), then the dynasty one.
      lists: [
        { format: keyOf(redraft10), status: "saved" },
        { format: keyOf(redraft12), status: "saved" },
        { format: keyOf(dynasty12), status: "saved" },
      ],
      overCap: 0,
    });
    // One request a week of projections (all nine positions in one), none for redraft10 (today's copy was cached); then,
    // last, the levels' weeks 5–18 of the offense list (Sleeper's state and the schedule were read once, for both).
    expect(fake.live).toEqual([
      sleeperUrls.state(),
      nflScheduleUrl(2026),
      sleeperUrls.projections(2026, 5, ALL),
      sleeperUrls.projections(2026, 6, ALL),
      fantasyCalcValuesUrl(redraft12),
      fantasyCalcValuesUrl(dynasty12),
      ...levelsUrls(5),
    ]);
    expect(run.levels).toEqual({ day: "2026-10-07", status: "saved", season: 2026, seasonType: "regular", currentWeek: 5, fromWeek: 5, toWeek: 18, read: levelsWeeks(5), players: 3, warnings: [] });
    const levels = await storedLevels(redis, "2026-10-07");
    expect(levels).toMatchObject({ version: 1, season: 2026, day: "2026-10-07", seasonType: "regular", currentWeek: 5, fromWeek: 5, toWeek: 18 });
    expect(levels.players).toEqual(LEVELS_WEDNESDAY);
    expect(levels.weeks["5"]).toEqual({ fetchedAt: new Date(WEDNESDAY).toISOString(), lastModified: WEDNESDAY - HOUR });
    expect(Object.keys(levels.weeks)).toEqual(levelsWeeks(5).map(String));
    expect(redis.keys().filter((k) => k.includes(":snap:")).sort()).toEqual([
      "os:production:snap:fc-index:2026:2026-10-07",
      "os:production:snap:fc:2026:2026-10-07:dynasty-2qb-12team-ppr1-teplus",
      "os:production:snap:fc:2026:2026-10-07:redraft-1qb-10team-ppr0.5",
      "os:production:snap:fc:2026:2026-10-07:redraft-1qb-12team-ppr1",
      "os:production:snap:lvl:2026:2026-10-07",
      "os:production:snap:proj:2026:5",
      "os:production:snap:proj:2026:6",
    ]);
    expect(await redis.get(snapshotLockKey(P))).toBeNull(); // let go

    // A duplicate delivery an hour later: the cached copies again (unchanged), every format saved already, the day's levels
    // kept as first saved; only Sleeper's NFL state is asked again (cached 10 minutes, as for the imports), once for the run.
    now += HOUR;
    const live = fake.live.length;
    const again = done(await runSnapshots({ http: fake.http, store, now: new Date(now) }));
    expect(again.projections.weeks.map((w) => w.status)).toEqual(["unchanged", "unchanged"]);
    expect(again.fantasyCalc).toMatchObject({ inUse: 3, savedBefore: 3, lists: [], overCap: 0 });
    expect(again.levels).toMatchObject({ status: "unchanged", read: levelsWeeks(5), players: 3 });
    expect(fake.live.slice(live)).toEqual([sleeperUrls.state()]);
  });

  it("the Friday after week 5's kickoff: week 5 is left alone, week 6 saved, the levels from week 6; past week 18 or out of season, no week", async () => {
    const now = Date.parse("2026-10-09T20:10:00Z");
    const redis = new FakeRedis(() => now);
    const fake = cachingHttp(routes({ at: now - HOUR }), () => now);
    const run = done(await runSnapshots({ http: fake.http, store: sharedSnapshotStore(redis, { env: PROD, clock: () => now }), now: new Date(now) }));
    expect(run.projections.weeks.map((w) => [w.week, w.status, w.reason])).toEqual([
      [5, "not fetched", "kicked off"],
      [6, "saved", undefined],
    ]);
    expect(fake.live).not.toContain(sleeperUrls.projections(2026, 5, ALL));
    expect(await redis.get(projectionSnapshotKey(P, 2026, 5))).toBeNull();
    // Week 5's games are under way: its list isn't asked for, and the levels count weeks 6–18 (the receiver's 6…18: 12).
    expect(run.levels).toMatchObject({ day: "2026-10-09", status: "saved", fromWeek: 6, toWeek: 18, read: levelsWeeks(6), players: 3 });
    expect(fake.live.filter(isLevelsUrl)).toEqual(levelsUrls(6));
    expect((await storedLevels(redis, "2026-10-09")).players["7001"]).toEqual(["WR", 12, 12.5, 13, weeksMask(6, 18)]);

    const post = cachingHttp(routes({ seasonType: "post" }), () => now);
    const off = done(await runSnapshots({ http: post.http, store: sharedSnapshotStore(new FakeRedis(() => now), { env: PROD, clock: () => now }), now: new Date(now) }));
    expect(off.projections).toEqual({ skipped: "not in season", season: 2026, seasonType: "post", weeks: [], warnings: [] });
    expect(off.levels).toEqual({ day: "2026-10-09", status: "skipped", reason: "not in season", season: 2026, seasonType: "post", read: [], players: 0, warnings: [] });
    // Sleeper's state asked once for the run: the levels read the calendar the projections read.
    expect(post.live).toEqual([sleeperUrls.state()]);

    const noState = cachingHttp({}, () => now);
    const none = done(await runSnapshots({ http: noState.http, store: sharedSnapshotStore(new FakeRedis(() => now), { env: PROD, clock: () => now }), now: new Date(now) }));
    expect(none.projections).toEqual({ skipped: "sleeper state unavailable", weeks: [], warnings: [] });
    expect(none.levels).toEqual({ day: "2026-10-09", status: "skipped", reason: "sleeper state unavailable", read: [], players: 0, warnings: [] });
    expect(noState.live).toEqual([sleeperUrls.state()]);
  });

  it("the schedule unavailable: only next week counts as ahead (the current week's start can't be told)", async () => {
    const now = WEDNESDAY;
    const all = routes();
    delete all[nflScheduleUrl(2026)];
    const fake = cachingHttp(all, () => now);
    const run = done(await runSnapshots({ http: fake.http, store: sharedSnapshotStore(new FakeRedis(() => now), { env: PROD, clock: () => now }), now: new Date(now) }));
    expect(run.projections.warnings).toEqual(["NFL_SCHEDULE_UNAVAILABLE"]);
    expect(run.projections.weeks.map((w) => [w.week, w.status, w.reason])).toEqual([
      [5, "not fetched", "kickoff unknown"],
      [6, "saved", undefined],
    ]);
    expect(run.levels).toMatchObject({ status: "saved", fromWeek: 6, read: levelsWeeks(6), warnings: ["NFL_SCHEDULE_UNAVAILABLE"] });
    // The schedule asked once for the run.
    expect(fake.live.filter((u) => u === nflScheduleUrl(2026))).toHaveLength(1);
  });

  it("Sleeper down: the weeks aren't fetched (its warning code), the FantasyCalc part still runs, and the levels save nothing and ask Sleeper nothing more", async () => {
    const now = WEDNESDAY;
    const redis = new FakeRedis(() => now);
    await recordFormats(redis, "2026-10-07", [redraft10]);
    const fake = cachingHttp(routes({ formats: [redraft10] }), () => now, { down: (u) => u.includes("/projections/") });
    const run = done(await runSnapshots({ http: fake.http, store: sharedSnapshotStore(redis, { env: PROD, clock: () => now }), now: new Date(now) }));
    expect(run.projections.weeks.map((w) => [w.week, w.status, w.reason])).toEqual([
      [5, "not fetched", "projections unavailable"],
      [6, "not fetched", "projections unavailable"],
    ]);
    expect(run.projections.warnings).toEqual(["SLEEPER_DOWN"]);
    expect(run.fantasyCalc.lists).toEqual([{ format: keyOf(redraft10), status: "saved" }]);
    // The server instance's outage memory (src/data/sleeperProjections.ts) holds the levels' gate off Sleeper too.
    expect(run.levels).toMatchObject({ status: "skipped", reason: "incomplete", read: [], unread: levelsWeeks(5), players: 0, warnings: ["SLEEPER_DOWN"] });
    expect(fake.live.filter(isLevelsUrl)).toEqual([]);
    expect(await redis.get(projectionLevelsKey(P, 2026, "2026-10-07"))).toBeNull();
  });

  it("the levels are all or nothing: a week Sleeper answers with an error status saves nothing that day, the weeks after it aren't asked for, and the next delivery tries again", async () => {
    let now = WEDNESDAY;
    const redis = new FakeRedis(() => now);
    const store = sharedSnapshotStore(redis, { env: PROD, clock: () => now });
    const all = routes();
    const week9 = all[levelsUrl(9)];
    delete all[levelsUrl(9)];
    const fake = cachingHttp(all, () => now);
    const run = done(await runSnapshots({ http: fake.http, store, now: new Date(now) }));
    expect(run.levels).toEqual({
      day: "2026-10-07",
      status: "skipped",
      reason: "incomplete",
      season: 2026,
      seasonType: "regular",
      currentWeek: 5,
      fromWeek: 5,
      toWeek: 18,
      read: [5, 6, 7, 8],
      unread: levelsWeeks(9),
      players: 0,
      warnings: ["PROJECTIONS_WEEK_UNAVAILABLE"],
    });
    expect(fake.live.filter(isLevelsUrl)).toEqual(levelsUrls(5, 9));
    expect(await redis.get(projectionLevelsKey(P, 2026, "2026-10-07"))).toBeNull();
    // Sleeper serves week 9 again: the next delivery saves the day, weeks 5–8 from the cache.
    all[levelsUrl(9)] = week9;
    now += 10 * 60_000;
    const again = done(await runSnapshots({ http: fake.http, store, now: new Date(now) }));
    expect(again.levels).toMatchObject({ status: "saved", read: levelsWeeks(5), players: 3 });
    expect(fake.live.filter(isLevelsUrl)).toEqual([...levelsUrls(5, 9), ...levelsUrls(9)]);
    expect((await storedLevels(redis, "2026-10-07")).players).toEqual(LEVELS_WEDNESDAY);
  });

  it("the levels: a week Sleeper answers with no projection in it is left out of the record; rows the schema can't read are a week that can't be read", async () => {
    const now = WEDNESDAY;
    const all = routes();
    all[levelsUrl(17)] = [{ player_id: "7001", stats: { adp_dd_ppr: 20 }, player: { position: "WR", fantasy_positions: ["WR"] } }];
    all[levelsUrl(18)] = [];
    const redis = new FakeRedis(() => now);
    const run = done(await runSnapshots({ http: cachingHttp(all, () => now).http, store: sharedSnapshotStore(redis, { env: PROD, clock: () => now }), now: new Date(now) }));
    expect(run.levels).toMatchObject({ status: "saved", read: levelsWeeks(5, 16), empty: [17, 18], players: 3, warnings: ["PROJECTIONS_WEEK_UNAVAILABLE"] });
    const levels = await storedLevels(redis, "2026-10-07");
    expect(Object.keys(levels.weeks)).toEqual(levelsWeeks(5, 16).map(String));
    expect(levels.players["7001"]).toEqual(["WR", 10.5, 11, 11.5, weeksMask(5, 16)]);

    const broken = routes();
    broken[levelsUrl(10)] = [{ stats: { pts_std: 5 } }, "not a row"];
    const fake = cachingHttp(broken, () => now);
    const unread = done(await runSnapshots({ http: fake.http, store: sharedSnapshotStore(new FakeRedis(() => now), { env: PROD, clock: () => now }), now: new Date(now) }));
    expect(unread.levels).toMatchObject({ status: "skipped", reason: "incomplete", read: levelsWeeks(5, 9), unread: levelsWeeks(10), warnings: ["PROJECTION_ROWS_UNREADABLE", "PROJECTIONS_WEEK_UNAVAILABLE"] });
    expect(fake.live.filter(isLevelsUrl)).toEqual(levelsUrls(5, 10));
  });

  it("the levels: a row the schema can't read beside real projections is skipped as a model build skips it (its warning), and the week counts: the day is saved", async () => {
    const now = WEDNESDAY;
    const all = routes();
    const ten = offenseRows(10, WEDNESDAY - HOUR);
    ten.splice(1, 0, { stats: { pts_std: 5 } }); // no player id
    all[levelsUrl(10)] = ten;
    const redis = new FakeRedis(() => now);
    const fake = cachingHttp(all, () => now);
    const run = done(await runSnapshots({ http: fake.http, store: sharedSnapshotStore(redis, { env: PROD, clock: () => now }), now: new Date(now) }));
    expect(run.levels).toEqual({
      day: "2026-10-07",
      status: "saved",
      season: 2026,
      seasonType: "regular",
      currentWeek: 5,
      fromWeek: 5,
      toWeek: 18,
      read: levelsWeeks(5),
      players: 3,
      warnings: ["PROJECTION_ROWS_UNREADABLE"],
    });
    expect(fake.live.filter(isLevelsUrl)).toEqual(levelsUrls(5));
    const levels = await storedLevels(redis, "2026-10-07");
    // Week 10's players are counted: the same levels as when every row could be read.
    expect(levels.players).toEqual(LEVELS_WEDNESDAY);
    expect(levels.weeks["10"]).toEqual({ fetchedAt: new Date(now).toISOString(), lastModified: WEDNESDAY - HOUR });
  });

  it("the levels change nothing the other parts do: the same answers, records and requests with the levels saved as with them out of time", async () => {
    const runOnce = async (deadlineMs: number | null) => {
      const redis = new FakeRedis(() => WEDNESDAY);
      await recordFormats(redis, "2026-10-07", [redraft10, dynasty12]);
      await recordFormats(redis, "2026-10-06", [redraft12]);
      const fake = cachingHttp(routes({ formats: [redraft10, redraft12, dynasty12] }), () => WEDNESDAY);
      fake.seed(fcKey(redraft10), bodyFor(redraft10), Date.parse("2026-10-07T09:00:00Z"));
      const go = () => runSnapshots({ http: fake.http, store: sharedSnapshotStore(redis, { env: PROD, clock: () => WEDNESDAY }), now: new Date(WEDNESDAY) });
      const run = done(deadlineMs === null ? await go() : await runInRequestScope(newRequestScope("cron", Date.now(), deadlineMs), go));
      const records = new Map<string, unknown>();
      for (const key of redis.keys().sort()) records.set(key, key.includes(":snap:fc-index:") || key.includes(":fc-formats:") ? (await redis.smembers(key)).sort() : await redis.get(key));
      return { run, records, live: fake.live };
    };
    const withLevels = await runOnce(null);
    // Time enough for every FantasyCalc format (snapshotLimits.listMinTimeLeftMs) but not for the levels.
    const without = await runOnce((snapshotLimits.listMinTimeLeftMs + snapshotLimits.levelsMinTimeLeftMs) / 2);
    expect(withLevels.run.levels?.status).toBe("saved");
    expect(without.run.levels).toEqual({ day: "2026-10-07", status: "skipped", reason: "out of time", read: [], players: 0, warnings: [] });
    expect(withLevels.run.projections).toEqual(without.run.projections);
    expect(withLevels.run.fantasyCalc).toEqual(without.run.fantasyCalc);
    const levelsKey = projectionLevelsKey(P, 2026, "2026-10-07");
    expect([...withLevels.records.keys()].filter((k) => k !== levelsKey)).toEqual([...without.records.keys()]);
    for (const [key, value] of without.records) expect(withLevels.records.get(key), key).toEqual(value);
    expect(withLevels.live.filter((u) => !isLevelsUrl(u))).toEqual(without.live);
    expect(without.live.filter(isLevelsUrl)).toEqual([]);
  });

  it("the levels on their own (snapshotLevels): a day of another NFL season than Sleeper's, no week ahead, or no projection at all saves nothing", async () => {
    const noNetwork: HttpClient = { get: () => Promise.reject(new Error("no request expected")) };
    const store = sharedSnapshotStore(new FakeRedis(() => WEDNESDAY), { env: PROD, clock: () => WEDNESDAY });
    // A preseason Sleeper already calls next season's, before March: next season's placeholders aren't filed.
    const february = new Date("2027-02-20T20:05:00.000Z");
    expect(await snapshotLevels(noNetwork, store, february, async () => ({ season: 2027, seasonType: "pre", currentWeek: 1, schedule: null, warnings: [] }))).toEqual({
      day: "2027-02-20",
      status: "skipped",
      reason: "not in season",
      season: 2027,
      seasonType: "pre",
      currentWeek: 1,
      read: [],
      players: 0,
      warnings: [],
    });
    // Week 18 under way, its kickoff unknown: no week left.
    expect(await snapshotLevels(noNetwork, store, new Date("2027-01-06T20:05:00.000Z"), async () => ({ season: 2026, seasonType: "regular", currentWeek: 18, schedule: null, warnings: ["NFL_SCHEDULE_UNAVAILABLE"] }))).toMatchObject({
      status: "skipped",
      reason: "no week ahead",
      warnings: ["NFL_SCHEDULE_UNAVAILABLE"],
    });
    // Every week answered without a projection: nothing to save.
    const empty = cachingHttp(Object.fromEntries(levelsWeeks(5).map((w) => [levelsUrl(w), []])), () => WEDNESDAY);
    const schedule = reduceNflSchedule(SCHEDULE, (a) => a);
    expect(await snapshotLevels(empty.http, store, new Date(WEDNESDAY), async () => ({ season: 2026, seasonType: "regular", currentWeek: 5, schedule, warnings: [] }))).toMatchObject({
      status: "skipped",
      reason: "no projections",
      read: [],
      empty: levelsWeeks(5),
    });
  });

  it("at most snapshotLimits.fantasyCalcFormatsPerDay formats a day, those saved by an earlier run counted: a duplicate run looks at none; past the cap the formats take turns", async () => {
    const now = WEDNESDAY;
    let clock = now;
    const redis = new FakeRedis(() => clock);
    const store = sharedSnapshotStore(redis, { env: PROD, clock: () => clock });
    const formats: FantasyCalcFormat[] = [];
    for (const numTeams of FANTASYCALC_TEAM_SIZES) for (const ppr of [0, 0.5, 1] as const) for (const numQbs of [1, 2] as const) if (formats.length < 14) formats.push({ isDynasty: false, numQbs, numTeams, ppr, substitutions: [] });
    await recordFormats(redis, "2026-10-07", formats);
    const fake = cachingHttp(routes({ formats }), () => clock);
    const cap = snapshotLimits.fantasyCalcFormatsPerDay;
    expect(cap).toBe(12);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = done(await runSnapshots({ http: fake.http, store, now: new Date(now) }));
    expect(run.fantasyCalc.inUse).toBe(14);
    expect(run.fantasyCalc.lists).toHaveLength(cap);
    expect(run.fantasyCalc.lists.every((l) => l.status === "saved")).toBe(true);
    expect(run.fantasyCalc.overCap).toBe(2);
    // The ones left out are named in the answer, and the log says the cap was reached (no keys in the log).
    const keys = formats.map(keyOf);
    const savedToday = run.fantasyCalc.lists.map((l) => l.format);
    expect(run.fantasyCalc.overCapFormats).toEqual(keys.filter((k) => !savedToday.includes(k)).sort());
    expect(errors.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"event":"snapshot_over_cap"'))).toEqual(['{"route":"server","event":"snapshot_over_cap","platform":"fantasycalc"}']);
    expect(fake.live.filter((u) => u.includes("fantasycalc"))).toHaveLength(cap);
    clock = now + 10 * 60_000;
    const again = done(await runSnapshots({ http: fake.http, store, now: new Date(clock) }));
    expect(again.fantasyCalc).toMatchObject({ savedBefore: cap, lists: [], overCap: 2 });
    expect(fake.live.filter((u) => u.includes("fantasycalc"))).toHaveLength(cap);

    // The next day, the same formats in use: the two left out go first, so every format is saved within two days.
    clock = now + DAY;
    await recordFormats(redis, "2026-10-08", formats);
    const next = done(await runSnapshots({ http: fake.http, store, now: new Date(clock) }));
    const savedNext = next.fantasyCalc.lists.map((l) => l.format);
    expect(savedNext.slice(0, 2)).toEqual(run.fantasyCalc.overCapFormats);
    expect(new Set([...savedToday, ...savedNext])).toEqual(new Set(keys));
    expect(next.fantasyCalc.overCap).toBe(2);
  });

  it("FantasyCalc down: a saved copy from another day isn't saved as today's list, and the next run tries again", async () => {
    let now = WEDNESDAY;
    const redis = new FakeRedis(() => now);
    const store = sharedSnapshotStore(redis, { env: PROD, clock: () => now });
    await recordFormats(redis, "2026-10-07", [redraft10]);
    let down = true;
    const fake = cachingHttp(routes({ formats: [redraft10] }), () => now, { down: (u) => down && u.includes("fantasycalc") });
    fake.seed(fcKey(redraft10), bodyFor(redraft10), Date.parse("2026-10-06T18:00:00Z"));
    const run = done(await runSnapshots({ http: fake.http, store, now: new Date(now) }));
    expect(run.fantasyCalc.lists).toEqual([{ format: keyOf(redraft10), status: "skipped", reason: "not today's list" }]);
    expect(redis.keys().filter((k) => k.includes(":snap:fc"))).toEqual([]);
    down = false;
    now += 20 * 60_000; // past the outage memory's first hold
    const later = done(await runSnapshots({ http: fake.http, store, now: new Date(now) }));
    expect(later.fantasyCalc.lists).toEqual([{ format: keyOf(redraft10), status: "saved" }]);
  });

  it("inside the route, no FantasyCalc format is started with less than snapshotLimits.listMinTimeLeftMs of the deadline left (the next run's)", async () => {
    const now = WEDNESDAY;
    const redis = new FakeRedis(() => now);
    await recordFormats(redis, "2026-10-07", [redraft10, redraft12]);
    const fake = cachingHttp(routes({ formats: [redraft10, redraft12] }), () => now);
    const scope = newRequestScope("cron", Date.now(), snapshotLimits.listMinTimeLeftMs - 1_000);
    const run = done(await runInRequestScope(scope, () => runSnapshots({ http: fake.http, store: sharedSnapshotStore(redis, { env: PROD, clock: () => now }), now: new Date(now) })));
    expect(run.fantasyCalc).toMatchObject({ inUse: 2, lists: [], outOfTime: 2 });
    expect(fake.live.filter((u) => u.includes("fantasycalc"))).toEqual([]);
    // Nor are the levels started with less than snapshotLimits.levelsMinTimeLeftMs left: nothing asked, nothing saved.
    expect(snapshotLimits.levelsMinTimeLeftMs).toBe(45_000);
    expect(run.levels).toEqual({ day: "2026-10-07", status: "skipped", reason: "out of time", read: [], players: 0, warnings: [] });
    expect(fake.live.filter(isLevelsUrl)).toEqual([]);
  });

  it("another run holds the lock: nothing is read or written", async () => {
    const now = WEDNESDAY;
    const redis = new FakeRedis(() => now);
    await redis.set(snapshotLockKey(P), "someone else", { px: snapshotLimits.lockMs });
    const fake = cachingHttp(routes(), () => now);
    expect(await runSnapshots({ http: fake.http, store: sharedSnapshotStore(redis, { env: PROD, clock: () => now }), now: new Date(now) })).toEqual({ status: "locked", store: "shared" });
    expect(fake.live).toEqual([]);
    expect(redis.keys()).toEqual([snapshotLockKey(P)]);
  });
});

describe("the local archives (localSnapshotStore: `next dev` with CRON_SECRET)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "offer-sheet-snapshots-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes data-local's own files: the weeks, today's list of each format the local archive holds for yesterday or today, and the day's levels", async () => {
    const now = WEDNESDAY;
    const roots = { projectionRoot: path.join(dir, "projection-snapshots"), fantasyCalcRoot: path.join(dir, "fantasycalc-snapshots"), levelsRoot: path.join(dir, "projection-levels") };
    const fake = cachingHttp(routes({ formats: [redraft10, redraft12] }), () => now);
    // Yesterday a local build filed redraft10's list (its day's first copy); today's folder is empty.
    const yesterday = localSnapshotStore(roots);
    const players = [{ fantasyCalcId: "1", sleeperId: "2", espnId: null, position: "WR", value: 10, redraftValue: null }];
    expect(await yesterday.saveList({ format: redraft10, players, fetchedAt: Date.parse("2026-10-06T15:00:00Z") })).toEqual({ status: "saved" });

    const store = localSnapshotStore({ ...roots, clock: () => now });
    expect(await store.formatsUsed("2026-10-06")).toEqual([keyOf(redraft10)]);
    // The turn order's record: each format's newest day folder, up to the day asked about.
    expect(await store.savedDays("2026-10-07")).toEqual(new Map([[keyOf(redraft10), "2026-10-06"]]));
    expect(await store.savedDays("2026-10-05")).toEqual(new Map());
    const run = done(await runSnapshots({ http: fake.http, store, now: new Date(now) }));
    expect(run.store).toBe("local");
    expect(run.projections.weeks.map((w) => [w.week, w.status])).toEqual([
      [5, "saved"],
      [6, "saved"],
    ]);
    expect(run.fantasyCalc).toMatchObject({ inUse: 1, savedBefore: 0, lists: [{ format: keyOf(redraft10), status: "saved" }] });
    const week5 = await readProjectionSnapshot(projectionSnapshotFile(roots.projectionRoot, 2026, 5));
    expect(Object.keys(week5?.groups ?? {})).toEqual(["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"]);
    const list = await readFantasyCalcSnapshot(fantasyCalcSnapshotFile(roots.fantasyCalcRoot, { season: 2026, day: "2026-10-07", key: keyOf(redraft10) }));
    expect(Object.keys(list?.players ?? {})).toHaveLength(160);
    expect(await readdir(path.join(roots.fantasyCalcRoot, "2026"))).toEqual(["2026-10-06", "2026-10-07"]);
    expect(await store.savedDays("2026-10-07")).toEqual(new Map([[keyOf(redraft10), "2026-10-07"]]));
    expect(run.levels).toMatchObject({ status: "saved", read: levelsWeeks(5), players: 3 });
    expect(await readdir(path.join(roots.levelsRoot, "2026"))).toEqual(["2026-10-07.json.gz"]);
    expect((await readProjectionLevels(projectionLevelsFile(roots.levelsRoot, 2026, "2026-10-07")))?.players).toEqual(LEVELS_WEDNESDAY);

    // Again: nothing changes (the same copies, today's list filed, the day's levels kept as first written).
    const again = done(await runSnapshots({ http: fake.http, store, now: new Date(now) }));
    expect(again.projections.weeks.map((w) => w.status)).toEqual(["unchanged", "unchanged"]);
    expect(again.fantasyCalc).toMatchObject({ savedBefore: 1, lists: [] });
    expect(again.levels).toMatchObject({ status: "unchanged" });
  });

  it("the local lock is this process's: a second run while one runs answers locked", async () => {
    const store = localSnapshotStore({ projectionRoot: path.join(dir, "p"), fantasyCalcRoot: path.join(dir, "f"), levelsRoot: path.join(dir, "l") });
    const held = await store.lock();
    expect(held).not.toBeNull();
    expect(await runSnapshots({ http: cachingHttp({}, Date.now).http, store, now: new Date() })).toEqual({ status: "locked", store: "local" });
    await held?.release();
    expect(await store.lock()).not.toBeNull();
  });
});

describe("snapshotStoreFor", () => {
  it("on Vercel the shared store, or why not (by name); elsewhere the local archives where they're on", () => {
    const secret = "s".repeat(40);
    const shared = snapshotStoreFor({ VERCEL: "1", VERCEL_ENV: "production", SESSION_SECRET: secret, KV_REST_API_URL: "https://made-up.upstash.invalid", KV_REST_API_TOKEN: "made-up" });
    expect("store" in shared && shared.store.kind).toBe("shared");
    expect(snapshotStoreFor({ VERCEL: "1", VERCEL_ENV: "production", SESSION_SECRET: secret })).toEqual({ reason: "store_variables_missing" });
    expect(snapshotStoreFor({ VERCEL: "1", VERCEL_ENV: "production" })).toEqual({ reason: "session_secret_missing" });
    expect(snapshotStoreFor({ VERCEL: "1", SESSION_SECRET: secret, KV_REST_API_URL: "rediss://default:pw@db.upstash.invalid:6379", KV_REST_API_TOKEN: "t" })).toEqual({ reason: "store_address_invalid" });
    const local = snapshotStoreFor({ NODE_ENV: "development" });
    expect("store" in local && local.store.kind).toBe("local");
    expect(snapshotStoreFor({ NODE_ENV: "production" })).toEqual({ reason: "archive_off" });
    expect(snapshotStoreFor({ NODE_ENV: "test" })).toEqual({ reason: "archive_off" });
  });
});
