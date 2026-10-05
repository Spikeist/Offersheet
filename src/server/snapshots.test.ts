/**
 * The daily snapshot cron's core (planner reply to Checkpoint 7a, §6.3; src/server/snapshots.ts): format keys, the formats
 * builds record, the shared store (FakeRedis: the lock, the merge rule's overwrite, the day's first list, the index), the
 * run (the pre-kickoff rule, the format cap, today's list from the cache before FantasyCalc, idempotence) and the local
 * archives (a temporary folder). No network: a caching fake client and committed fixtures.
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
import { FakeRedis } from "./redis";
import {
  fantasyCalcIndexKey,
  fantasyCalcSnapshotKey,
  formatsInUseKey,
  formatsToSave,
  localSnapshotStore,
  noteFormatsInUse,
  parseFormatKey,
  parseIndexEntry,
  projectionSnapshotKey,
  resetFormatsInUseForTests,
  resetLocalSnapshotLockForTests,
  runSnapshots,
  seasonOfDay,
  sharedSnapshotStore,
  snapshotLockKey,
  snapshotStoreFor,
  snapshotWeeks,
  todaysList,
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

/** Every route a run reads: Sleeper's state at `week`, the schedule, weeks 5–7's projections, and the formats' lists. */
function routes(opts: { week?: number; seasonType?: string; formats?: FantasyCalcFormat[]; at?: number } = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    [sleeperUrls.state()]: { week: opts.week ?? 5, season: "2026", season_type: opts.seasonType ?? "regular" },
    [nflScheduleUrl(2026)]: SCHEDULE,
  };
  for (const w of [5, 6, 7]) out[sleeperUrls.projections(2026, w, ALL)] = sleeperRows(w, opts.at ?? WEDNESDAY - HOUR);
  for (const f of opts.formats ?? []) out[fantasyCalcValuesUrl(f)] = bodyFor(f);
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
    expect(fantasyCalcIndexKey(P, 2026)).toBe("os:production:snap:fc-index:2026");
    expect(parseIndexEntry("2026-10-05/redraft-1qb-10team-ppr0.5")).toEqual({ day: "2026-10-05", key: "redraft-1qb-10team-ppr0.5" });
    for (const bad of ["2026-10-05", "x/redraft-1qb-10team-ppr0.5", "2026-10-05/redraft-1qb-16team-ppr1", "2026-10-05/../../x"]) expect(parseIndexEntry(bad)).toBeNull();
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
    const store = sharedSnapshotStore(redis, { env: PROD });
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
    const store = sharedSnapshotStore(redis, { env: PROD });
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
    const store = sharedSnapshotStore(redis, { env: PROD });
    const key = projectionSnapshotKey(P, 2026, 5);
    await redis.set(key, "not base64 gzip");
    expect(await store.saveWeek(input(WEDNESDAY - HOUR))).toMatchObject({ status: "saved" });
    const { gzipSync } = await import("node:zlib");
    await redis.set(key, gzipSync(JSON.stringify({ version: 2 })).toString("base64"));
    expect(await store.saveWeek(input(WEDNESDAY - HOUR))).toEqual({ status: "failed", error: "OtherVersion" });
  });

  it("a list: the day's first copy kept two seasons, indexed for snapshot:pull; a second copy of the day changes nothing", async () => {
    const redis = new FakeRedis(() => WEDNESDAY);
    const store = sharedSnapshotStore(redis, { env: PROD });
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
    expect(redis.ttlMs(fantasyCalcSnapshotKey(P, where))).toBe(snapshotLimits.retainDays * DAY);
    expect(await redis.smembers(fantasyCalcIndexKey(P, 2026))).toEqual(["2026-10-07/redraft-1qb-10team-ppr0.5"]);
    expect(redis.ttlMs(fantasyCalcIndexKey(P, 2026))).toBe(snapshotLimits.retainDays * DAY);
    const saved = await unpackFantasyCalcSnapshot(Buffer.from((await redis.get(fantasyCalcSnapshotKey(P, where))) as string, "base64"));
    expect("snapshot" in saved && Object.keys(saved.snapshot.players)).toHaveLength(160);
    expect("snapshot" in saved && saved.snapshot.format).toEqual({ isDynasty: false, numQbs: 1, numTeams: 10, ppr: 0.5 });
    expect(await store.saveList({ ...list, fetchedAt: WEDNESDAY })).toEqual({ status: "unchanged" });
    expect(await store.savedDays("2026-10-07")).toEqual(new Map([[keyOf(redraft10), "2026-10-07"]]));
    // Another day's index entries count only up to the day asked about (and a junk entry never).
    await redis.saddExpire(fantasyCalcIndexKey(P, 2026), [`2026-10-01/${keyOf(redraft10)}`, `2026-10-02/${keyOf(redraft12)}`, "2026-10-03/junk", "not-an-entry"], DAY);
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
    expect(await store.saveList({ ...list, fetchedAt: undefined })).toEqual({ status: "skipped", reason: "no fetch time" });
  });

  it("a store command that fails or hangs: that save fails, by the error's name, and the run's store sends nothing more (one log line)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const redis = new FakeRedis(() => WEDNESDAY);
    const hanging = Object.assign(Object.create(redis) as FakeRedis, { get: () => new Promise<string | null>(() => {}) });
    const store = sharedSnapshotStore(hanging, { env: PROD, timeoutMs: 20 });
    expect(await store.saveWeek(input(WEDNESDAY - HOUR))).toEqual({ status: "failed", error: "TimeoutError" });
    const sent = redis.stats.commands;
    expect(await store.saveWeek(input(WEDNESDAY - HOUR, { week: 6 }))).toEqual({ status: "failed", error: "TimeoutError" });
    expect(await store.saveList({ format: redraft10, players: [{ fantasyCalcId: "1", sleeperId: "2", espnId: null, position: "WR", value: 10, redraftValue: null }], fetchedAt: WEDNESDAY })).toEqual({ status: "failed", error: "TimeoutError" });
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
  it("the Wednesday before week 5: weeks 5 and 6 saved, the formats used yesterday or today saved from today's lists; a second run changes nothing and asks only Sleeper's state again", async () => {
    let now = WEDNESDAY;
    const redis = new FakeRedis(() => now);
    const store = sharedSnapshotStore(redis, { env: PROD });
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
    // One request a week of projections (all nine positions in one), none for redraft10 (today's copy was cached).
    expect(fake.live).toEqual([
      sleeperUrls.state(),
      nflScheduleUrl(2026),
      sleeperUrls.projections(2026, 5, ALL),
      sleeperUrls.projections(2026, 6, ALL),
      fantasyCalcValuesUrl(redraft12),
      fantasyCalcValuesUrl(dynasty12),
    ]);
    expect(redis.keys().filter((k) => k.includes(":snap:")).sort()).toEqual([
      "os:production:snap:fc-index:2026",
      "os:production:snap:fc:2026:2026-10-07:dynasty-2qb-12team-ppr1-teplus",
      "os:production:snap:fc:2026:2026-10-07:redraft-1qb-10team-ppr0.5",
      "os:production:snap:fc:2026:2026-10-07:redraft-1qb-12team-ppr1",
      "os:production:snap:proj:2026:5",
      "os:production:snap:proj:2026:6",
    ]);
    expect(await redis.get(snapshotLockKey(P))).toBeNull(); // let go

    // A duplicate delivery an hour later: the cached copies again (unchanged), every format saved already; only Sleeper's
    // NFL state is asked again (cached 10 minutes, as for the imports).
    now += HOUR;
    const live = fake.live.length;
    const again = done(await runSnapshots({ http: fake.http, store, now: new Date(now) }));
    expect(again.projections.weeks.map((w) => w.status)).toEqual(["unchanged", "unchanged"]);
    expect(again.fantasyCalc).toMatchObject({ inUse: 3, savedBefore: 3, lists: [], overCap: 0 });
    expect(fake.live.slice(live)).toEqual([sleeperUrls.state()]);
  });

  it("the Friday after week 5's kickoff: week 5 is left alone, week 6 saved; past week 18 or out of season, no week", async () => {
    const now = Date.parse("2026-10-09T20:10:00Z");
    const redis = new FakeRedis(() => now);
    const fake = cachingHttp(routes({ at: now - HOUR }), () => now);
    const run = done(await runSnapshots({ http: fake.http, store: sharedSnapshotStore(redis, { env: PROD }), now: new Date(now) }));
    expect(run.projections.weeks.map((w) => [w.week, w.status, w.reason])).toEqual([
      [5, "not fetched", "kicked off"],
      [6, "saved", undefined],
    ]);
    expect(fake.live).not.toContain(sleeperUrls.projections(2026, 5, ALL));
    expect(await redis.get(projectionSnapshotKey(P, 2026, 5))).toBeNull();

    const post = cachingHttp(routes({ seasonType: "post" }), () => now);
    const off = done(await runSnapshots({ http: post.http, store: sharedSnapshotStore(new FakeRedis(() => now), { env: PROD }), now: new Date(now) }));
    expect(off.projections).toEqual({ skipped: "not in season", season: 2026, seasonType: "post", weeks: [], warnings: [] });
    expect(post.live).toEqual([sleeperUrls.state()]);

    const noState = cachingHttp({}, () => now);
    const none = done(await runSnapshots({ http: noState.http, store: sharedSnapshotStore(new FakeRedis(() => now), { env: PROD }), now: new Date(now) }));
    expect(none.projections).toEqual({ skipped: "sleeper state unavailable", weeks: [], warnings: [] });
  });

  it("the schedule unavailable: only next week counts as ahead (the current week's start can't be told)", async () => {
    const now = WEDNESDAY;
    const all = routes();
    delete all[nflScheduleUrl(2026)];
    const fake = cachingHttp(all, () => now);
    const run = done(await runSnapshots({ http: fake.http, store: sharedSnapshotStore(new FakeRedis(() => now), { env: PROD }), now: new Date(now) }));
    expect(run.projections.warnings).toEqual(["NFL_SCHEDULE_UNAVAILABLE"]);
    expect(run.projections.weeks.map((w) => [w.week, w.status, w.reason])).toEqual([
      [5, "not fetched", "kickoff unknown"],
      [6, "saved", undefined],
    ]);
  });

  it("Sleeper down: the weeks aren't fetched (its warning code), and the FantasyCalc part still runs", async () => {
    const now = WEDNESDAY;
    const redis = new FakeRedis(() => now);
    await recordFormats(redis, "2026-10-07", [redraft10]);
    const fake = cachingHttp(routes({ formats: [redraft10] }), () => now, { down: (u) => u.includes("/projections/") });
    const run = done(await runSnapshots({ http: fake.http, store: sharedSnapshotStore(redis, { env: PROD }), now: new Date(now) }));
    expect(run.projections.weeks.map((w) => [w.week, w.status, w.reason])).toEqual([
      [5, "not fetched", "projections unavailable"],
      [6, "not fetched", "projections unavailable"],
    ]);
    expect(run.projections.warnings).toEqual(["SLEEPER_DOWN"]);
    expect(run.fantasyCalc.lists).toEqual([{ format: keyOf(redraft10), status: "saved" }]);
  });

  it("at most snapshotLimits.fantasyCalcFormatsPerDay formats a day, those saved by an earlier run counted: a duplicate run looks at none; past the cap the formats take turns", async () => {
    const now = WEDNESDAY;
    let clock = now;
    const redis = new FakeRedis(() => clock);
    const store = sharedSnapshotStore(redis, { env: PROD });
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
    const store = sharedSnapshotStore(redis, { env: PROD });
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
    const run = done(await runInRequestScope(scope, () => runSnapshots({ http: fake.http, store: sharedSnapshotStore(redis, { env: PROD }), now: new Date(now) })));
    expect(run.fantasyCalc).toMatchObject({ inUse: 2, lists: [], outOfTime: 2 });
    expect(fake.live.filter((u) => u.includes("fantasycalc"))).toEqual([]);
  });

  it("another run holds the lock: nothing is read or written", async () => {
    const now = WEDNESDAY;
    const redis = new FakeRedis(() => now);
    await redis.set(snapshotLockKey(P), "someone else", { px: snapshotLimits.lockMs });
    const fake = cachingHttp(routes(), () => now);
    expect(await runSnapshots({ http: fake.http, store: sharedSnapshotStore(redis, { env: PROD }), now: new Date(now) })).toEqual({ status: "locked", store: "shared" });
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

  it("writes data-local's own files: the weeks, and today's list of each format the local archive holds for yesterday or today", async () => {
    const now = WEDNESDAY;
    const roots = { projectionRoot: path.join(dir, "projection-snapshots"), fantasyCalcRoot: path.join(dir, "fantasycalc-snapshots") };
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

    // Again: nothing changes (the same copies, today's list filed).
    const again = done(await runSnapshots({ http: fake.http, store, now: new Date(now) }));
    expect(again.projections.weeks.map((w) => w.status)).toEqual(["unchanged", "unchanged"]);
    expect(again.fantasyCalc).toMatchObject({ savedBefore: 1, lists: [] });
  });

  it("the local lock is this process's: a second run while one runs answers locked", async () => {
    const store = localSnapshotStore({ projectionRoot: path.join(dir, "p"), fantasyCalcRoot: path.join(dir, "f") });
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
