import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OfflineCacheMiss, type HttpResult, type RequestOptions } from "../http";
import { OFFLINE_MISS, SleeperCrawlClient } from "./client";
import type { Current2026, League2026, Prev2025 } from "./crawl";
import { LOCAL_FILES, compareSamples, preferLocal, readCrawlMeta, readLocalSample, sampleSize, type Sample } from "./offline";

const league = (id: string, picks = false): League2026 => ({
  leagueId: id,
  previousLeagueId: null,
  previousLink: "null",
  draftId: null,
  hop: 1,
  settings: { type: 0 },
  rosterPositions: [],
  scoringNonzero: [],
  metadataKeys: [],
  nameKeywords: [],
  hasBracketIds: false,
  ...(picks ? { picks: { picks: 10, keepers: 0, rookies: 2, withYearsExp: 10, maxKeepersPerRoster: 0 } } : {}),
});
const season = (id: string, found = true): Prev2025 => ({ fromLeagueId: `f${id}`, leagueId: id, depth: 1, previousLeagueId: null, previousLink: "null", hasBracketOverrides: false, httpStatus: found ? 200 : 404, found, settings: {}, rosterPositions: [], standings: [], matchups: {}, transactions: {}, nameKeywords: [] });
const rosters = (id: string): Current2026 => ({ leagueId: id, reasons: ["control"], settings: {}, standings: [] });
const sample = (leagues: League2026[], prev: Prev2025[] = [], current: Current2026[] = []): Sample => ({ leagues, prev, current });

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("offline sample choice", () => {
  it("measures coverage in priority order", () => {
    expect(sampleSize(sample([league("1", true), league("2")], [season("9"), season("8", false)], [rosters("1")]))).toEqual([2, 1, 1, 1]);
    expect(compareSamples(sample([league("1")]), sample([league("1"), league("2")]))).toBe(-1);
    expect(compareSamples(sample([league("1")], [season("9")]), sample([league("2")]))).toBe(1);
    expect(compareSamples(sample([league("1")]), sample([league("2")]))).toBe(0);
  });

  it("keeps the local records unless the replay found more", () => {
    const full = sample([league("1", true), league("2")], [season("9")], [rosters("1")]);
    const gap = sample([league("1"), league("2")], [], []);
    expect(preferLocal(gap, full)).toBe(true); // the cache lost part of the crawl
    expect(preferLocal(full, full)).toBe(true); // ties: the records the last run analyzed
    expect(preferLocal(full, gap)).toBe(false); // the records were cut short: the replay restores them
    expect(preferLocal(full, null)).toBe(false);
    expect(preferLocal(sample([]), sample([]))).toBe(false); // nothing on either side
  });

  it("reads the local records and crawl meta, tolerating missing or bad files", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "codes-offline-"));
    temps.push(dir);
    expect(await readLocalSample(dir)).toBeNull();
    expect(await readCrawlMeta(dir)).toEqual({});
    writeFileSync(path.join(dir, LOCAL_FILES.leagues), JSON.stringify([league("1"), { leagueId: 5 }, null]));
    writeFileSync(path.join(dir, LOCAL_FILES.prev), "not json");
    writeFileSync(path.join(dir, LOCAL_FILES.meta), JSON.stringify({ crawledAt: "2026-09-29T22:00:00.000Z", state: { week: 4, season: "2026" }, stats: "nope" }));
    const local = await readLocalSample(dir);
    expect(local?.leagues.map((l) => l.leagueId)).toEqual(["1"]);
    expect(local?.prev).toEqual([]);
    expect(local?.current).toEqual([]);
    expect(await readCrawlMeta(dir)).toEqual({ crawledAt: "2026-09-29T22:00:00.000Z", state: { week: 4, season: "2026" }, stats: undefined });
  });
});

describe("crawl client offline mode", () => {
  const cached = (text: string): HttpResult => ({ url: "u", finalUrl: "u", status: 200, ok: true, contentType: "application/json", isHtml: false, text, json: JSON.parse(text) as unknown, headers: {}, elapsedMs: 0, fromCache: true, cachedAt: 0, attempts: 0 });

  it("serves cached calls, turns misses into empty answers and never sends anything", async () => {
    const seen: RequestOptions[] = [];
    const fake = async (url: string, opts: RequestOptions = {}): Promise<HttpResult> => {
      seen.push(opts);
      if (url.endsWith("/state/nfl")) return cached('{"week":4}');
      throw new OfflineCacheMiss(opts.label ?? url);
    };
    const sunk: string[] = [];
    const client = new SleeperCrawlClient(10, async (p) => void sunk.push(p), { offline: true, request: fake as never });
    const hit = await client.get<{ week: number }>("/state/nfl", "state/nfl", 1000);
    const miss = await client.get("/league/123/users", "league/{leagueId}/users", 1000);
    expect(hit).toMatchObject({ status: 200, data: { week: 4 }, fromCache: true });
    expect(miss).toEqual({ status: 0, data: undefined, missing: false, fromCache: false, offlineMiss: true });
    expect(seen.every((o) => o.offline === true)).toBe(true);
    expect(client.calls).toBe(2); // the budget counts misses too, so a replay walks the same sample
    expect([client.live, client.cached, client.offlineMisses]).toEqual([0, 1, 1]);
    expect(client.statusCounts).toEqual({ "200": 1, [OFFLINE_MISS]: 1 });
    expect(sunk).toEqual(["/state/nfl"]);
  });

  it("goes live only when not offline", async () => {
    const seen: RequestOptions[] = [];
    const fake = async (_url: string, opts: RequestOptions = {}): Promise<HttpResult> => {
      seen.push(opts);
      return { ...cached("[]"), fromCache: false };
    };
    const client = new SleeperCrawlClient(10, undefined, { request: fake as never });
    await client.get("/user/1/leagues/nfl/2026", "user/{userId}/leagues/nfl/{season}", 1000);
    expect(seen[0]?.offline).toBe(false);
    expect([client.live, client.offlineMisses]).toEqual([1, 0]);
  });
});
