import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSleeperLeague, LATER_PROJECTIONS_POLICY, NEAR_PROJECTIONS_POLICY, PROJECTIONS_POLICY, projectionsPolicy, sleeperUrls, startablePositions } from "@/adapters/sleeper/fetch";
import { normalizeProjectionStats } from "@/adapters/sleeper/scoringMap";
import { StatRowSchema, type SleeperStatRow } from "@/adapters/sleeper/schemas";
import { fakeHttp as sleeperFakeHttp, json, loadTestLeague } from "@/adapters/sleeper/test-helpers";
import type { HttpClient, HttpResponse } from "@/adapters/types";
import { config } from "@/engine/config";
import type { Pos, ScoringRule } from "@/engine/model";
import { rulePoints } from "@/engine/scoring";
import { HOUR, MemoryCache, MINUTE, PROJECTIONS_NEAR_WEEKS, TTL, type Cache, type CacheEntry } from "@/server/cache";
import { createHttpClient } from "@/server/http";
import { readSanitizedFixture } from "@/test-utils/fixtures";
import {
  loadSleeperSeasonProjections,
  loadSleeperStats,
  loadSleeperWeeklyProjections,
  playedStatLines,
  projectionLines,
  seasonPerGameLine,
  SLEEPER_MODEL_MAX_RETRIES,
  SLEEPER_MODEL_TIMEOUT_MS,
  SLEEPER_OUTAGE_HOLD_MS,
  sleeperCacheKey,
  sleeperGate,
  sleeperOutageHoldMs,
  sleeperRequestPositions,
  sleeperSeasonProjectionsUrl,
  sleeperStatsUrl,
  type SleeperGate,
  type SleeperProjectionWeek,
} from "./sleeperProjections";
import { fakeHttp } from "./testSupport";

const SEASON = 2026;
/** A superflex league's startable positions, as the Sleeper adapter asks for them. */
const POS: Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
const projUrl = (week: number) => sleeperUrls.projections(SEASON, week, POS);
const statsUrl = (week: number) => sleeperStatsUrl(SEASON, week, POS);
const seasonUrl = sleeperSeasonProjectionsUrl(SEASON, POS);

/** A model build's time (holds and cache ages are measured from it), and times after it. */
const NOW = new Date("2026-09-30T12:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
const gate = (http: HttpClient, now: Date = NOW) => sleeperGate(http, now);

type Row = { player_id: string; stats?: Record<string, unknown>; player?: Record<string, unknown> };
const rowsOf = (label: string) => readSanitizedFixture<Row[]>("shared", label);
const PROJ = (week: number) => `sleeper/projections/2026/${week} (top 150 QB/RB/WR/TE + 6 per K/DEF/IDP)`;
const STATS = (week: number) => `sleeper/stats/2026/${week} (top 150 QB/RB/WR/TE + 6 per K/DEF/IDP)`;
const SEASON_QB = "sleeper/projections/2026?position=QB (season, top 40)";
const parse = (rows: unknown[]) => rows.map((r) => StatRowSchema.parse(r) as SleeperStatRow);

// Fictional players (made-up ids and names); team defenses are keyed by their team code.
const stub = (id: string): Row => ({ player_id: id, stats: { adp_dd_ppr: 1000, pos_adp_dd_ppr: 300 }, player: { position: "WR", team: "NYJ" } });
const te = (id: string, rec: number): Row => ({ player_id: id, stats: { gp: 1, rec, rec_yd: rec * 10, rec_fd: 2, adp_dd_ppr: 120 }, player: { position: "TE", team: "DAL" } });

/** A model build's three Sleeper loads through one gate, in buildModelInputs' order. */
async function sleeperBuild(g: SleeperGate, weeks: number[], statsWeeks: number[], positions: Pos[] = POS) {
  const weekly = await loadSleeperWeeklyProjections(g, SEASON, weeks, positions);
  const season = await loadSleeperSeasonProjections(g, SEASON, positions);
  const stats = await loadSleeperStats(g, SEASON, statsWeeks, positions);
  return { weekly, season, stats, warnings: [...weekly.warnings, ...season.warnings, ...stats.warnings] };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("request shape (CLAUDE.md §2.3 undocumented endpoints)", () => {
  it("asks for the league's startable positions minus P, in the Sleeper adapter's order, whatever order they come in", () => {
    expect(sleeperRequestPositions(["DEF", "P", "TE", "QB", "K", "WR", "RB", "TE"])).toEqual(POS);
    expect(sleeperRequestPositions(["LB", "DB", "DL", "P"])).toEqual(["DL", "LB", "DB"]);
    expect(sleeperStatsUrl(SEASON, 3, ["QB", "DEF"])).toBe("https://api.sleeper.app/stats/nfl/2026/3?season_type=regular&position[]=QB&position[]=DEF");
    expect(sleeperSeasonProjectionsUrl(SEASON, ["QB", "RB"])).toBe("https://api.sleeper.app/projections/nfl/2026?season_type=regular&position[]=QB&position[]=RB");
    expect(projUrl(5)).toBe("https://api.sleeper.app/projections/nfl/2026/5?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF");
  });

  it("uses the Sleeper import's cache entries (same URL, key and policy: served 6 hours, kept 24), with a shorter timeout and one retry (§2.10, review PERF-1)", async () => {
    const t = loadTestLeague();
    const id = String(t.league.league_id);
    const positions = startablePositions(t.league.roster_positions);
    const routes = new Map<string, HttpResponse>([
      [sleeperUrls.state(), json(t.state)],
      [sleeperUrls.league(id), json(t.league)],
      [sleeperUrls.users(id), json(t.users)],
      [sleeperUrls.rosters(id), json(t.rosters)],
    ]);
    for (const w of [4, 5, 6]) routes.set(sleeperUrls.projections(SEASON, w, positions), json(t.projections.map((r) => ({ ...r, week: w }))));
    const adapter = sleeperFakeHttp(routes);
    await fetchSleeperLeague({ season: SEASON, leagueId: id }, { http: adapter });
    const adapterOpts = new Map(adapter.calls.filter((c) => c.url.includes("/projections/")).map((c) => [c.url, c.opts]));
    expect([...adapterOpts.keys()]).toHaveLength(3);

    const mine = sleeperFakeHttp(routes);
    // The model asks from 3 weeks back; the league's lineup positions arrive in any order, P included.
    const load = await loadSleeperWeeklyProjections(gate(mine), SEASON, [1, 2, 3, 4, 5, 6], ["P", ...[...positions].reverse()]);
    for (const w of [4, 5, 6]) {
      const call = mine.calls.find((c) => c.url === sleeperUrls.projections(SEASON, w, positions));
      const theirs = adapterOpts.get(call?.url ?? "");
      expect(call?.opts?.cache).toEqual(theirs?.cache);
      expect(call?.opts?.cache).toEqual({ key: sleeperCacheKey(call?.url ?? ""), ttlMs: TTL.projections, retainMs: TTL.projectionsLater });
      expect(call?.opts?.cacheIf).toBe(theirs?.cacheIf); // an empty list is never cached
      expect(call?.opts?.bigIntsAsStrings).toBe(theirs?.bigIntsAsStrings);
      // The client's defaults are a 30 s timeout and 3 retries.
      expect(call?.opts).toMatchObject({ timeoutMs: SLEEPER_MODEL_TIMEOUT_MS, maxRetries: SLEEPER_MODEL_MAX_RETRIES });
      expect(load.weeks.get(w)?.size).toBeGreaterThan(0);
    }
    expect([SLEEPER_MODEL_TIMEOUT_MS, SLEEPER_MODEL_MAX_RETRIES]).toEqual([20_000, 1]);
    expect([...load.weeks.keys()]).toEqual([4, 5, 6]); // weeks 1–3 aren't routed here: 404, an answer → left out with a warning, and the rest still asked
    expect(load.warnings.map((w) => [w.code, w.platformPath])).toEqual([1, 2, 3].map((w) => ["PROJECTIONS_WEEK_UNAVAILABLE", `projections/${w}`]));
  });
});

describe("per-week cache policy (CLAUDE.md §2.10: the current NFL week and the next 2: 6 hours; later weeks: 24 hours)", () => {
  it("projectionsPolicy: past weeks, the current week and the next PROJECTIONS_NEAR_WEEKS are served 6 hours, later weeks 24; every week's copy is kept 24 hours; same empty-list rule", () => {
    expect(PROJECTIONS_NEAR_WEEKS).toBe(2);
    expect([TTL.projections, TTL.projectionsLater]).toEqual([6 * HOUR, 24 * HOUR]);
    for (const week of [1, 3, 4, 5, 6]) expect(projectionsPolicy(week, 4), `week ${week}`).toBe(NEAR_PROJECTIONS_POLICY);
    for (const week of [7, 10, 18]) expect(projectionsPolicy(week, 4), `week ${week}`).toBe(LATER_PROJECTIONS_POLICY);
    const cacheIf = PROJECTIONS_POLICY.cacheIf;
    expect(NEAR_PROJECTIONS_POLICY).toEqual({ ttlMs: TTL.projections, retainMs: TTL.projectionsLater, league: false, cacheIf });
    expect(LATER_PROJECTIONS_POLICY).toEqual({ ttlMs: TTL.projectionsLater, retainMs: TTL.projectionsLater, league: false, cacheIf });
    // One retention per URL, whichever build (at whichever current week) stores or reads a week: the Sleeper gate relies on it.
    for (let current = 1; current <= 18; current++) for (let week = 1; week <= 18; week++) expect(projectionsPolicy(week, current).retainMs).toBe(TTL.projectionsLater);
    // Season projections and stats: served and kept 6 hours.
    expect(PROJECTIONS_POLICY).toMatchObject({ ttlMs: TTL.projections, retainMs: TTL.projections });
  });

  it("the model's loader caches each week under its own policy (one entry per week), while season projections and stats keep 6 hours", async () => {
    const rows = rowsOf(PROJ(4));
    const routes = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [projUrl(i + 1), { json: rows }]));
    const { http, calls } = fakeHttp({ ...routes, [seasonUrl]: { json: rowsOf(SEASON_QB) }, [statsUrl(3)]: { json: rowsOf(STATS(3)) } });
    const g = gate(http);
    await loadSleeperWeeklyProjections(g, SEASON, Array.from({ length: 17 }, (_, i) => i + 1), POS, { currentWeek: 4 });
    await loadSleeperSeasonProjections(g, SEASON, POS);
    await loadSleeperStats(g, SEASON, [3], POS);
    const ttlOf = (url: string) => calls.find((c) => c.url === url)?.opts?.cache;
    for (let w = 1; w <= 17; w++) {
      const ttl = w <= 6 ? TTL.projections : TTL.projectionsLater;
      expect(ttlOf(projUrl(w)), `week ${w}`).toEqual({ key: sleeperCacheKey(projUrl(w)), ttlMs: ttl, retainMs: TTL.projectionsLater });
      expect(calls.find((c) => c.url === projUrl(w))?.opts?.cacheIf).toBe(PROJECTIONS_POLICY.cacheIf);
    }
    expect(ttlOf(seasonUrl)).toEqual({ key: sleeperCacheKey(seasonUrl), ttlMs: TTL.projections, retainMs: TTL.projections });
    expect(ttlOf(statsUrl(3))).toEqual({ key: sleeperCacheKey(statsUrl(3)), ttlMs: TTL.projections, retainMs: TTL.projections });
    // Without a current week, every week is served 6 hours (the TTL before Checkpoint 2).
    const bare = fakeHttp({ [projUrl(12)]: { json: rows } });
    await loadSleeperWeeklyProjections(gate(bare.http), SEASON, [12], POS);
    expect(bare.calls[0]?.opts?.cache?.ttlMs).toBe(TTL.projections);
  });

  it("through the real client: a near week is fetched again after 6 hours, a later week is served from the cache for 24", async () => {
    vi.useFakeTimers({ now: NOW });
    const f = sleeperFetch((url) => ({ status: 200, body: sleeperBody(url) }));
    const http = createHttpClient({ fetchImpl: f.impl, cache: new MemoryCache() });
    const load = (t: number) => settle(loadSleeperWeeklyProjections(sleeperGate(http, at(t)), SEASON, [5, 10], POS, { currentWeek: 4 }));
    await load(0);
    expect(f.attempts.map((a) => a.url)).toEqual([projUrl(5), projUrl(10)]);
    vi.setSystemTime(at(7 * HOUR));
    const later = await load(7 * HOUR);
    expect(f.attempts.slice(2).map((a) => a.url)).toEqual([projUrl(5)]);
    expect(later.weeks.get(10)?.size).toBe(180);
    vi.setSystemTime(at(25 * HOUR));
    await load(25 * HOUR);
    expect(f.attempts.slice(3).map((a) => a.url)).toEqual([projUrl(5), projUrl(10)]);
  });
});

describe("the onWeek hook (the pre-game projection archive's input, CLAUDE.md §2.3)", () => {
  it("gets every week read with a real projection, right after it is read: its season, week, the request's positions, the rows and the response", async () => {
    const rows = rowsOf(PROJ(4));
    const { http } = fakeHttp({
      [projUrl(4)]: { json: rows, fetchedAt: 1_000, fromCache: true },
      [projUrl(5)]: { json: [stub("90001")] }, // only stubs: no week
      [projUrl(7)]: { json: rowsOf(PROJ(5)), fetchedAt: 2_000 },
    });
    const seen: SleeperProjectionWeek[] = [];
    const load = await loadSleeperWeeklyProjections(gate(http), SEASON, [4, 5, 6, 7], ["P", ...[...POS].reverse()], { currentWeek: 4, onWeek: (w) => void seen.push(w) });
    expect(seen.map((w) => [w.season, w.week, w.positions, w.res.fetchedAt])).toEqual([
      [SEASON, 4, POS, 1_000],
      [SEASON, 7, POS, 2_000],
    ]);
    expect(seen[0]?.rows).toHaveLength(rows.length); // every row that fit, stubs included
    expect(seen[0]?.res.json).toBe(rows);
    expect([...load.weeks.keys()]).toEqual([4, 7]);
  });

  it("isn't called while Sleeper is down, and a hook that throws doesn't fail the load", async () => {
    const down = fakeHttp({ [projUrl(4)]: { status: 503, json: null } });
    const calledWhileDown: number[] = [];
    await loadSleeperWeeklyProjections(gate(down.http), SEASON, [4, 5], POS, { onWeek: (w) => void calledWhileDown.push(w.week) });
    expect(calledWhileDown).toEqual([]);
    const { http } = fakeHttp({ [projUrl(4)]: { json: rowsOf(PROJ(4)) }, [projUrl(5)]: { json: rowsOf(PROJ(5)) } });
    const asked: number[] = [];
    const load = await loadSleeperWeeklyProjections(gate(http), SEASON, [4, 5], POS, {
      onWeek: (w) => {
        asked.push(w.week);
        throw new Error("archive bug");
      },
    });
    expect(asked).toEqual([4, 5]);
    expect([...load.weeks.keys()]).toEqual([4, 5]);
    expect(load.warnings).toEqual([]);
  });
});

describe("weekly projections (CLAUDE.md §6 step 1–2)", () => {
  it("keeps real projections only (ADP-only stubs dropped), the first real row per player, in league-scoring keys", () => {
    const rows = parse([
      stub("90001"),
      { player_id: "90002", stats: { adp_dd_ppr: 50 }, player: { position: "TE", team: "DAL" } }, // a stub first…
      te("90002", 4), // …then his real row
      te("90003", 3),
      te("90003", 9), // a second real row: ignored
      { player_id: "KC", stats: { gp: 1, st_td: 0.1, def_kr_td: 0.05, pts_allow: 21, def_int: 0.8 }, player: { position: "DEF", team: "KC" } },
      { player_id: "BUF", stats: { gp: 1, st_td: 0.2, sack: 2.4 } }, // no player object: a team code is a defense
      { player_id: "90004", stats: { gp: 1, fga: 2, fgm: 1.7, fgm_50p: 0.3, xpm: 2.5 }, player: { position: "K", team: "DAL" } },
      { player_id: "90005", stats: { gp: 1, rec: 1, rush_yd: 12 }, player: { position: "FB", team: "SF" } },
      { player_id: "90006", stats: { gp: 1, adp_dd_ppr: 12, pts_ppr: 0 } }, // gp and ADP are not a projection
    ]);
    const lines = projectionLines(rows);
    expect([...lines.keys()]).toEqual(["90002", "90003", "KC", "BUF", "90004", "90005"]);
    expect(lines.get("90002")?.stats).toMatchObject({ rec: 4, bonus_rec_te: 4, bonus_fd_te: 2 }); // /stats fills the TE bonuses; /projections doesn't
    expect(lines.get("90003")?.stats.rec).toBe(3);
    expect(lines.get("KC")).toEqual({ sleeperPosition: "DEF", stats: { gp: 1, def_st_td: 0.1, pts_allow: 21, def_int: 0.8 } }); // st_td → def_st_td; def_kr_td would double count
    expect(lines.get("BUF")?.sleeperPosition).toBe("DEF");
    expect(lines.get("BUF")?.stats).toEqual({ gp: 1, def_st_td: 0.2, sack: 2.4 });
    expect(lines.get("90004")?.stats).toMatchObject({ fgmiss: expect.closeTo(0.3, 9) as unknown as number, fgm_50_59: 0.3 });
    expect(lines.get("90005")?.stats.bonus_rec_rb).toBeUndefined(); // Sleeper gives fullbacks no RB bonus
    expect(lines.get("90005")?.sleeperPosition).toBe("FB");
  });

  it("matches normalizeProjectionStats on every real row of the committed week-4 capture and the adapter's test league", () => {
    const rows = parse(rowsOf(PROJ(4)));
    const lines = projectionLines(rows);
    expect(lines.size).toBe(180);
    for (const row of rows) expect(lines.get(row.player_id)).toEqual({ stats: normalizeProjectionStats(row.stats, row.player?.position), sleeperPosition: row.player?.position });
    // The adapter's minimized test league: 38 rows, 3 of them ADP-only stubs.
    expect(projectionLines(parse(loadTestLeague().projections)).size).toBe(35);
  });

  it("loads weeks one at a time, in order; a week Sleeper answers without projections (404, not a list, only stubs, empty) is a warning and is missing, and the rest is still asked for", async () => {
    let inFlight = 0;
    let most = 0;
    const calls: string[] = [];
    const routes: Record<string, () => HttpResponse> = {
      [projUrl(4)]: () => json(rowsOf(PROJ(4))),
      [projUrl(5)]: () => json({ error: "not found" }, 404),
      [projUrl(10)]: () => json([stub("90001")]), // only stubs: not posted yet
      [projUrl(15)]: () => json(rowsOf(PROJ(15))),
      [projUrl(17)]: () => json({ rows: [] }), // an object, not a list
    };
    const http: HttpClient = {
      async get(url) {
        calls.push(url);
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return routes[url]?.() ?? json([], 200);
      },
    };
    const load = await loadSleeperWeeklyProjections(gate(http), SEASON, [15, 4, 5, 10, 4, 17, 18, 0, 19, 4.5], POS);
    expect(calls).toEqual([4, 5, 10, 15, 17, 18].map(projUrl)); // deduped, in order, 1–18 only
    expect(most).toBe(1);
    expect([...load.weeks.keys()]).toEqual([4, 15]);
    expect(load.weeks.has(5)).toBe(false);
    expect(load.warnings).toEqual([
      { code: "PROJECTIONS_WEEK_UNAVAILABLE", message: "Sleeper's projections for week 5 couldn't be read (HTTP 404), so that week is left out.", platformPath: "projections/5" },
      { code: "PROJECTIONS_WEEK_UNAVAILABLE", message: "Sleeper's projections for week 10 couldn't be read (no projections in it), so that week is left out.", platformPath: "projections/10" },
      { code: "PROJECTIONS_WEEK_UNAVAILABLE", message: "Sleeper's projections for week 17 couldn't be read (not a list), so that week is left out.", platformPath: "projections/17" },
      { code: "PROJECTIONS_WEEK_UNAVAILABLE", message: "Sleeper's projections for week 18 couldn't be read (no projections in it), so that week is left out.", platformPath: "projections/18" },
    ]);
  });

  it("skips rows that don't fit with a warning, survives a client that throws, and asks nothing without positions", async () => {
    const good = rowsOf(PROJ(4));
    const { http } = fakeHttp({ [projUrl(4)]: { json: [...good.slice(0, 3), { stats: { rec: 1 } }, ...good.slice(3)] } });
    const load = await loadSleeperWeeklyProjections(gate(http), SEASON, [4], POS);
    expect(load.weeks.get(4)?.size).toBe(180);
    expect(load.warnings).toEqual([{ code: "PROJECTION_ROWS_UNREADABLE", message: "Week 4 projections: 1 row(s) didn't have the expected shape and were skipped.", platformPath: "projections/4[3].player_id" }]);
    // A client that throws is no response: Sleeper isn't answering, so week 5 isn't asked either.
    const thrown: string[] = [];
    const thrower: HttpClient = { get: async (url) => (thrown.push(url), Promise.reject(new Error("socket hang up"))) };
    const down = await loadSleeperWeeklyProjections(gate(thrower), SEASON, [4, 5], POS);
    expect(down.weeks.size).toBe(0);
    expect(thrown).toEqual([projUrl(4)]);
    expect(down.warnings[0]).toEqual({ code: "SLEEPER_DOWN", message: "Sleeper's projections for week 4 are left out: Sleeper stopped answering (no response).", platformPath: "projections/4" });
    expect(JSON.stringify(down.warnings)).not.toContain("socket hang up");
    const none = fakeHttp({});
    expect((await loadSleeperWeeklyProjections(gate(none.http), SEASON, [4], ["P"])).weeks.size).toBe(0);
    expect(none.calls).toEqual([]);
  });

  it("reports when the oldest week used was fetched, and whether a saved copy stood in", async () => {
    const rows = rowsOf(PROJ(4));
    const { http } = fakeHttp({
      [projUrl(4)]: { json: rows, fromCache: true, fetchedAt: 3_000 },
      [projUrl(5)]: { json: rows, fetchedAt: 2_000, stale: true },
      [projUrl(6)]: { status: 500, json: null, fetchedAt: 1_000 }, // not used: doesn't count
    });
    const load = await loadSleeperWeeklyProjections(gate(http), SEASON, [4, 5, 6], POS);
    expect(load).toMatchObject({ fromCache: true, stale: true, fetchedAt: 2_000 });
    const live = await loadSleeperWeeklyProjections(gate(fakeHttp({ [projUrl(4)]: { json: rows } }).http), SEASON, [4], POS);
    expect(live).toMatchObject({ fromCache: false, stale: false });
    expect(live.fetchedAt).toBeUndefined();
  });

  it("through the real client: a week is served from the 6-hour cache, and an empty list is never cached", async () => {
    const cache = new MemoryCache();
    const requests: string[] = [];
    const fetchImpl = (async (url: string) => {
      requests.push(url);
      const body = url.includes("/2026/4?") ? rowsOf(PROJ(4)) : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const http = createHttpClient({ fetchImpl, cache });
    await loadSleeperWeeklyProjections(gate(http), SEASON, [4, 5], POS);
    const again = await loadSleeperWeeklyProjections(gate(http), SEASON, [4, 5], POS);
    expect(requests).toEqual([projUrl(4), projUrl(5), projUrl(5)]);
    expect(again.weeks.get(4)?.size).toBe(180);
    expect(again.fromCache).toBe(true);
    expect(cache.keys()).toEqual([sleeperCacheKey(projUrl(4))]);
    expect(PROJECTIONS_POLICY.ttlMs).toBe(TTL.projections);
  });
});

describe("season projections (CLAUDE.md §6 step 1 fallback)", () => {
  it("divides every stat by config.projections.seasonGames BEFORE scoring, so a yardage bonus doesn't fire every game", async () => {
    const rows = rowsOf(SEASON_QB);
    const { http, calls } = fakeHttp({ [seasonUrl]: { json: rows } });
    const load = await loadSleeperSeasonProjections(gate(http), SEASON, ["P", ...POS]);
    expect(calls.map((c) => c.url)).toEqual([seasonUrl]);
    expect(calls[0]?.opts?.cache).toEqual({ key: sleeperCacheKey(seasonUrl), ttlMs: TTL.projections, retainMs: TTL.projections });
    expect(calls[0]?.opts).toMatchObject({ timeoutMs: SLEEPER_MODEL_TIMEOUT_MS, maxRetries: SLEEPER_MODEL_MAX_RETRIES });
    expect(load.perGame.size).toBe(40);
    const games = config.projections.seasonGames;
    expect(games).toBe(17);
    const allen = rows.find((r) => r.player_id === "4984") as Row;
    const season = allen.stats as Record<string, number>;
    const line = load.perGame.get("4984") ?? {};
    expect(line.pass_yd).toBeCloseTo((season.pass_yd as number) / games, 9);
    expect(line.rush_td).toBeCloseTo((season.rush_td as number) / games, 9);
    expect(line.bonus_fd_qb).toBeCloseTo(((season.pass_fd as number) + (season.rush_fd as number)) / games, 9); // normalizeProjectionStats fills it
    expect(line.gp).toBe(1); // one game (Sleeper writes 18 on every season row)
    expect(Object.keys(line).filter((k) => /adp_/.test(k))).toEqual([]);
    // A 300-yard bonus: the season total clears it, one game's mean doesn't.
    const bonus: ScoringRule = { kind: "threshold", stat: "pass_yd", min: 300, points: 3 };
    expect(rulePoints(bonus, season)).toBe(3);
    expect(rulePoints(bonus, line)).toBe(0);
  });

  it("per-game lines follow normalizeProjectionStats exactly (then ÷ games)", () => {
    const stats = { pass_yd: 3400, rush_td: 4, rec: 0, fga: 34, fgm: 29, adp_ppr: 12.5, gp: 18 };
    expect(seasonPerGameLine(stats, "QB", 17)).toEqual({ pass_yd: 200, rush_td: 4 / 17, bonus_rush_td_qb: 4 / 17, fga: 2, fgm: 29 / 17, fgmiss: 5 / 17, rec: 0, gp: 1 });
  });

  it("a season list Sleeper answers without projections is a warning and an empty map; Sleeper down is SLEEPER_DOWN", async () => {
    const missing = await loadSleeperSeasonProjections(gate(fakeHttp({}).http), SEASON, POS);
    expect(missing.perGame.size).toBe(0);
    expect(missing.warnings).toEqual([
      { code: "SEASON_PROJECTIONS_UNAVAILABLE", message: "Sleeper's season projections couldn't be read (HTTP 404), so players without a weekly projection have no fallback rate.", platformPath: "projections/season" },
    ]);
    const empty = await loadSleeperSeasonProjections(gate(fakeHttp({ [seasonUrl]: { json: [stub("90001")] } }).http), SEASON, POS);
    expect(empty.perGame.size).toBe(0);
    expect(empty.warnings.map((w) => w.code)).toEqual(["SEASON_PROJECTIONS_UNAVAILABLE"]);
    const down = await loadSleeperSeasonProjections(gate(fakeHttp({ [seasonUrl]: { status: 502, json: null } }).http), SEASON, POS);
    expect(down.perGame.size).toBe(0);
    expect(down.warnings).toEqual([{ code: "SLEEPER_DOWN", message: "Sleeper's season projections are left out: Sleeper stopped answering (HTTP 502).", platformPath: "projections/season" }]);
  });
});

describe("actual stats (CLAUDE.md §6 step 1: actual_ppg and games played)", () => {
  it("keeps the raw lines of players who played (gp > 0), the first per player", async () => {
    const rows = rowsOf(STATS(1));
    const { http, calls } = fakeHttp({ [statsUrl(1)]: { json: rows }, [statsUrl(2)]: { json: rowsOf(STATS(2)) } });
    const load = await loadSleeperStats(gate(http), SEASON, [2, 1], POS);
    expect(calls.map((c) => c.url)).toEqual([statsUrl(1), statsUrl(2)]);
    for (const c of calls) {
      expect(c.opts?.cache).toEqual({ key: sleeperCacheKey(c.url), ttlMs: TTL.projections, retainMs: TTL.projections });
      expect(c.opts?.cacheIf).toBe(PROJECTIONS_POLICY.cacheIf);
      expect(c.opts).toMatchObject({ timeoutMs: SLEEPER_MODEL_TIMEOUT_MS, maxRetries: SLEEPER_MODEL_MAX_RETRIES });
    }
    const week1 = load.weeks.get(1);
    expect(week1?.size).toBe(rows.filter((r) => ((r.stats?.gp as number | undefined) ?? 0) > 0).length);
    expect(week1?.size).toBe(175);
    const played = rows.find((r) => (r.stats?.gp as number) > 0) as Row;
    expect(week1?.get(played.player_id)).toEqual(played.stats);
    expect(load.weeks.get(2)?.size).toBe(176);
    expect(load.warnings).toEqual([]);
  });

  it("drops lines without a game and non-numbers; the first played row wins", () => {
    const lines = playedStatLines(
      parse([
        { player_id: "90001", stats: { gms_active: 1, pos_rank_ppr: 999 } }, // active, didn't play
        { player_id: "90002", stats: { gp: 0, rec: 2 } },
        { player_id: "90003", stats: { gp: 1, rec: 5, rec_yd: 61, note: "x" } },
        { player_id: "90003", stats: { gp: 1, rec: 9 } },
        { player_id: "90004", stats: null },
      ]),
    );
    expect([...lines.entries()]).toEqual([["90003", { gp: 1, rec: 5, rec_yd: 61 }]]);
  });

  it("a failed week, or one without a single game, is a warning and is missing", async () => {
    const { http } = fakeHttp({ [statsUrl(1)]: { status: 404, json: null }, [statsUrl(2)]: { json: [{ player_id: "90001", stats: { gms_active: 1 } }] }, [statsUrl(3)]: { json: rowsOf(STATS(3)) } });
    const load = await loadSleeperStats(gate(http), SEASON, [1, 2, 3], ["P", ...POS]);
    expect([...load.weeks.keys()]).toEqual([3]);
    expect(load.warnings).toEqual([
      { code: "STATS_WEEK_UNAVAILABLE", message: "Sleeper's stats for week 1 couldn't be read (HTTP 404), so that week's points are left out.", platformPath: "stats/1" },
      { code: "STATS_WEEK_UNAVAILABLE", message: "Sleeper's stats for week 2 couldn't be read (no player with a game in it), so that week's points are left out.", platformPath: "stats/2" },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// The gate (review DATA-1, PERF-1): fail fast, stay polite

/** A fetch for the real client: `answer(url)` gives the status and body; records each attempt and its (fake) time. */
function sleeperFetch(answer: (url: string) => { status: number; body?: unknown } | "network error") {
  const attempts: { url: string; at: number }[] = [];
  const impl = (async (url: string | URL) => {
    attempts.push({ url: String(url), at: Date.now() });
    const a = answer(String(url));
    if (a === "network error") throw new TypeError("fetch failed");
    return new Response(a.body === undefined ? "" : JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { impl, attempts };
}

/** Runs the fake clock until the promise settles (the client's backoff and pacing sleeps). */
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  void p.then(
    () => (done = true),
    () => (done = true),
  );
  for (let i = 0; i < 1_000 && !done; i++) await vi.advanceTimersByTimeAsync(100);
  return p;
}

/** Bodies of a working Sleeper: week 4's rows for every week, the season list, week 1's stats for every week. */
function sleeperBody(url: string): unknown {
  if (url.includes("/stats/")) return rowsOf(STATS(1));
  if (url.includes(`/${SEASON}?`)) return rowsOf(SEASON_QB);
  return rowsOf(PROJ(4));
}

/** The server cache, with a switch that makes it lose everything (e.g. its folder was cleared). */
class WipeableCache implements Cache {
  readonly store = new MemoryCache();
  wiped = false;
  get<T>(key: string, maxAgeMs: number, now?: number): Promise<CacheEntry<T> | undefined> {
    return this.wiped ? Promise.resolve(undefined) : this.store.get<T>(key, maxAgeMs, now);
  }
  set<T>(key: string, value: T, retainMs: number, now?: number): Promise<void> {
    return this.store.set(key, value, retainMs, now);
  }
}

describe("the Sleeper gate: a build stops at the first request Sleeper doesn't answer (review DATA-1, PERF-1)", () => {
  it.each([
    ["HTTP 503", json(null, 503)],
    ["HTTP 429", json(null, 429)],
    ["no response", json(undefined, 0)],
    ["a web page instead of data", { ...json(null), isHtml: true, json: undefined, text: "<!doctype html><html></html>" }],
  ])("%s: nothing more is asked in the build, and everything left out is a SLEEPER_DOWN warning", async (why, down) => {
    const calls: string[] = [];
    const http: HttpClient = {
      async get(url) {
        calls.push(url);
        return url === projUrl(4) ? json(rowsOf(PROJ(4))) : down;
      },
    };
    const out = await sleeperBuild(gate(http), [4, 5, 6, 7], [1, 2]);
    expect(calls).toEqual([projUrl(4), projUrl(5)]); // week 5 fails: weeks 6–7, the season list and the stats aren't asked
    expect([...out.weekly.weeks.keys()]).toEqual([4]);
    expect(out.season.perGame.size).toBe(0);
    expect(out.stats.weeks.size).toBe(0);
    const left = (path: string, what: string) => ({ code: "SLEEPER_DOWN", message: `Sleeper's ${what} are left out: Sleeper stopped answering (${why}).`, platformPath: path });
    expect(out.warnings).toEqual([
      left("projections/5", "projections for week 5"),
      left("projections/6", "projections for week 6"),
      left("projections/7", "projections for week 7"),
      left("projections/season", "season projections"),
      left("stats/1", "stats for week 1"),
      left("stats/2", "stats for week 2"),
    ]);
  });

  it("through the real client, an outage costs a whole build 2 attempts and about a second (it cost 84 attempts and minutes)", async () => {
    for (const answer of [{ status: 503 }, "network error"] as const) {
      vi.useFakeTimers({ now: NOW });
      const f = sleeperFetch(() => answer);
      const http = createHttpClient({ fetchImpl: f.impl, cache: new MemoryCache() });
      const t0 = Date.now();
      // Week 4 of the season: 17 projection weeks, the season list and 3 stats weeks.
      const out = await settle(sleeperBuild(gate(http), Array.from({ length: 17 }, (_, i) => i + 1), [1, 2, 3]));
      expect(f.attempts.map((a) => a.url)).toEqual([projUrl(1), projUrl(1)]); // one retry, then nothing more
      expect(Date.now() - t0).toBeLessThan(2_000); // the retry's backoff (1–1.3 s) and pacing
      expect(out.warnings).toHaveLength(17 + 1 + 3);
      expect(new Set(out.warnings.map((w) => w.code))).toEqual(new Set(["SLEEPER_DOWN"]));
      expect(out.warnings[0]?.message).toContain(answer === "network error" ? "(no response)" : "(HTTP 503)");
      vi.useRealTimers();
    }
  });

  it("remembers an outage per client for 5 minutes, doubling while it lasts (up to 15), and one answer ends it", async () => {
    let up = false;
    const calls: string[] = [];
    const http: HttpClient = {
      async get(url) {
        calls.push(url);
        return up ? json(rowsOf(PROJ(4))) : json(null, 503);
      },
    };
    const build = async (t: number) => {
      const before = calls.length;
      const load = await loadSleeperWeeklyProjections(sleeperGate(http, at(t)), SEASON, [4, 5], POS);
      return { asked: calls.length - before, load };
    };
    expect((await build(0)).asked).toBe(1); // the first outage: held 5 minutes
    const held = await build(SLEEPER_OUTAGE_HOLD_MS - 1);
    expect(held.asked).toBe(0);
    expect(held.load.warnings.map((w) => w.message)).toEqual([4, 5].map((w) => `Sleeper's projections for week ${w} are left out: Sleeper stopped answering (HTTP 503).`));
    expect((await build(5 * MINUTE)).asked).toBe(1); // still down: held 10 minutes
    expect((await build(15 * MINUTE - 1)).asked).toBe(0);
    expect((await build(15 * MINUTE)).asked).toBe(1); // held 15, the most
    expect((await build(30 * MINUTE - 1)).asked).toBe(0);
    expect((await build(30 * MINUTE)).asked).toBe(1); // held 15 again
    expect((await build(45 * MINUTE - 1)).asked).toBe(0);
    up = true;
    const back = await build(45 * MINUTE);
    expect(back.asked).toBe(2);
    expect(back.load.warnings).toEqual([]);
    up = false;
    expect((await build(46 * MINUTE)).asked).toBe(1); // a new outage starts over at 5 minutes
    expect((await build(51 * MINUTE)).asked).toBe(1);
    // Per client: another client (another process) knows nothing of it.
    expect(sleeperGate(fakeHttp({}).http, at(51 * MINUTE)).down()).toBeUndefined();
    expect([0, 1, 2, 3, 4, 5].map(sleeperOutageHoldMs)).toEqual([0, 5, 10, 15, 15, 15].map((m) => m * MINUTE));
  });

  it("a 404 or an empty list is an answer, not an outage: the rest is asked for, and so is the next build", async () => {
    const { http, calls } = fakeHttp({ [projUrl(5)]: { json: [] } }); // week 4: 404
    const first = await sleeperBuild(gate(http), [4, 5], [1]);
    expect(calls.map((c) => c.url)).toEqual([projUrl(4), projUrl(5), seasonUrl, statsUrl(1)]);
    expect(first.warnings.map((w) => w.code)).toEqual(["PROJECTIONS_WEEK_UNAVAILABLE", "PROJECTIONS_WEEK_UNAVAILABLE", "SEASON_PROJECTIONS_UNAVAILABLE", "STATS_WEEK_UNAVAILABLE"]);
    await sleeperBuild(gate(http), [4], []);
    expect(calls).toHaveLength(6);
  });

  it("while Sleeper isn't asked, lists the server cache holds are still read, without a request (through the real client)", async () => {
    vi.useFakeTimers({ now: NOW });
    let down = false;
    const f = sleeperFetch((url) => (down ? { status: 503 } : { status: 200, body: sleeperBody(url) }));
    const http = createHttpClient({ fetchImpl: f.impl, cache: new MemoryCache() });
    // Build 1: all live, and cached for 6 hours.
    const first = await settle(sleeperBuild(sleeperGate(http, NOW), [4, 5, 6], [1, 2]));
    expect(first.warnings).toEqual([]);
    expect(f.attempts).toHaveLength(6);
    // Sleeper goes down; a build for another league (other positions, other URLs) finds out: 2 attempts.
    down = true;
    vi.setSystemTime(at(MINUTE));
    const other = await settle(loadSleeperWeeklyProjections(sleeperGate(http, at(MINUTE)), SEASON, [4, 5], ["QB"]));
    expect(other.warnings.map((w) => w.code)).toEqual(["SLEEPER_DOWN", "SLEEPER_DOWN"]);
    expect(f.attempts).toHaveLength(8);
    // Build 3, the first league during the hold: its lists come from the cache; a week it never read isn't asked.
    vi.setSystemTime(at(2 * MINUTE));
    const again = await settle(sleeperBuild(sleeperGate(http, at(2 * MINUTE)), [4, 5, 6, 7], [1, 2]));
    expect(f.attempts).toHaveLength(8);
    expect([...again.weekly.weeks.keys()]).toEqual([4, 5, 6]);
    expect(again.weekly.fromCache).toBe(true);
    expect(again.season.perGame.size).toBe(40);
    expect([...again.stats.weeks.keys()]).toEqual([1, 2]);
    expect(again.warnings).toEqual([{ code: "SLEEPER_DOWN", message: "Sleeper's projections for week 7 are left out: Sleeper stopped answering (HTTP 503).", platformPath: "projections/7" }]);
    // Past the cache's 6 hours (and the hold), Sleeper is asked again: one URL, 2 attempts, then nothing.
    vi.setSystemTime(at(TTL.projections + 3 * MINUTE));
    const late = await settle(sleeperBuild(sleeperGate(http, at(TTL.projections + 3 * MINUTE)), [4, 5, 6], [1, 2]));
    expect(f.attempts).toHaveLength(10);
    expect(late.warnings.map((w) => w.platformPath)).toEqual(["projections/4", "projections/5", "projections/6", "projections/season", "stats/1", "stats/2"]);
  });

  it("during an outage each list is read within its own TTL: a later week's copy for 24 hours, a near week's for 6, and a week that became near for 6", async () => {
    vi.useFakeTimers({ now: NOW });
    let down = false;
    const f = sleeperFetch((url) => (down ? { status: 503 } : { status: 200, body: sleeperBody(url) }));
    const http = createHttpClient({ fetchImpl: f.impl, cache: new MemoryCache() });
    // Week 5 is near (6 hours), weeks 9 and 10 later (24 hours), at current week 4.
    await settle(loadSleeperWeeklyProjections(sleeperGate(http, NOW), SEASON, [5, 9, 10], POS, { currentWeek: 4 }));
    expect(f.attempts).toHaveLength(3);
    down = true;
    // 7 hours later another league's build finds Sleeper down (2 attempts, then the hold).
    vi.setSystemTime(at(7 * HOUR));
    await settle(loadSleeperWeeklyProjections(sleeperGate(http, at(7 * HOUR)), SEASON, [4], ["QB"], { currentWeek: 4 }));
    expect(f.attempts).toHaveLength(5);
    // During the hold: week 5's copy is past its 6 hours (not asked), weeks 9 and 10 are still served; a new
    // current week 7 makes week 9 near, so its 7-hour-old copy isn't served any more.
    const t = 7 * HOUR + MINUTE;
    vi.setSystemTime(at(t));
    const held = await settle(loadSleeperWeeklyProjections(sleeperGate(http, at(t)), SEASON, [5, 9, 10], POS, { currentWeek: 4 }));
    expect(f.attempts).toHaveLength(5);
    expect([...held.weeks.keys()]).toEqual([9, 10]);
    expect(held.warnings.map((w) => [w.code, w.platformPath])).toEqual([["SLEEPER_DOWN", "projections/5"]]);
    const moved = await settle(loadSleeperWeeklyProjections(sleeperGate(http, at(t)), SEASON, [9, 10], POS, { currentWeek: 7 }));
    expect(f.attempts).toHaveLength(5);
    expect([...moved.weeks.keys()]).toEqual([10]);
  });

  it("builds at different current weeks share a client: the gate remembers how long the cache keeps each copy, not the TTL it was read under", async () => {
    // Around the weekly rollover an ESPN league (its scoring period) and a Sleeper league (Sleeper's NFL week)
    // can build at current weeks 4 and 5 with the same positions: week 7 is a later week (24 hours) for one and
    // a near week (6 hours) for the other. Either build may store the copy the other one reads.
    for (const [first, second] of [[5, 4], [4, 5]] as const) {
      vi.useFakeTimers({ now: NOW });
      let down = false;
      const f = sleeperFetch((url) => (down ? { status: 503 } : { status: 200, body: sleeperBody(url) }));
      const http = createHttpClient({ fetchImpl: f.impl, cache: new MemoryCache() });
      const load = (t: number, weeks: number[], currentWeek: number) => {
        vi.setSystemTime(at(t));
        return settle(loadSleeperWeeklyProjections(sleeperGate(http, at(t)), SEASON, weeks, POS, { currentWeek }));
      };
      const order = `current week ${first}, then ${second}`;
      await load(0, [7, 8], first);
      expect(f.attempts, order).toHaveLength(2);
      const read = await load(HOUR, [7, 8], second); // the other build, an hour later: both from the cache
      expect(read.fromCache, order).toBe(true);
      expect(f.attempts, order).toHaveLength(2);
      // Seven hours after the first build Sleeper is down; a build at current week 4 finds out on week 5 (2 attempts).
      down = true;
      const held = await load(7 * HOUR, [5, 7, 8], 4);
      // Weeks 7 and 8 are later weeks at current week 4: the cache still serves both, and nothing more is asked of Sleeper.
      expect(f.attempts.slice(2).map((a) => a.url), order).toEqual([projUrl(5), projUrl(5)]);
      expect([...held.weeks.keys()], order).toEqual([7, 8]);
      expect(held.warnings.map((w) => [w.code, w.platformPath]), order).toEqual([["SLEEPER_DOWN", "projections/5"]]);
      // At current week 5 week 7 is near: its 7-hour-old copy isn't served, and isn't asked for either; week 8 still is.
      const near = await load(7 * HOUR + MINUTE, [7, 8], 5);
      expect(f.attempts, order).toHaveLength(4);
      expect([...near.weeks.keys()], order).toEqual([8]);
      expect(near.warnings.map((w) => [w.code, w.platformPath]), order).toEqual([["SLEEPER_DOWN", "projections/7"]]);
      vi.useRealTimers();
    }
  });

  it("a build that joins another build's download of a week (single-flight) remembers the copy's retention, whatever TTL it asked with", async () => {
    vi.useFakeTimers({ now: NOW });
    let down = false;
    const f = sleeperFetch((url) => (down ? { status: 503 } : { status: 200, body: sleeperBody(url) }));
    const http = createHttpClient({ fetchImpl: f.impl, cache: new MemoryCache() });
    // Two builds at once: at current week 5 week 7 is near (that build starts the download), at current week 4 it
    // is later (that build joins it, and the copy is stored under the first build's policy).
    const [near, later] = await settle(
      Promise.all([
        loadSleeperWeeklyProjections(sleeperGate(http, NOW), SEASON, [7], POS, { currentWeek: 5 }),
        loadSleeperWeeklyProjections(sleeperGate(http, NOW), SEASON, [7], POS, { currentWeek: 4 }),
      ]),
    );
    expect(f.attempts.map((a) => a.url)).toEqual([projUrl(7)]); // one download for both
    expect([near.weeks.size, later.weeks.size, near.fromCache, later.fromCache]).toEqual([1, 1, false, false]);
    // Seven hours later Sleeper is down: a build at current week 4 still reads week 7 from the cache (kept 24 hours).
    down = true;
    vi.setSystemTime(at(7 * HOUR));
    const held = await settle(loadSleeperWeeklyProjections(sleeperGate(http, at(7 * HOUR)), SEASON, [5, 7], POS, { currentWeek: 4 }));
    expect(f.attempts.slice(1).map((a) => a.url)).toEqual([projUrl(5), projUrl(5)]);
    expect([...held.weeks.keys()]).toEqual([7]);
    expect(held.warnings.map((w) => [w.code, w.platformPath])).toEqual([["SLEEPER_DOWN", "projections/5"]]);
  });

  it("a list the cache no longer holds costs one attempt without a retry, and then nothing more is read", async () => {
    vi.useFakeTimers({ now: NOW });
    let down = false;
    const f = sleeperFetch((url) => (down ? { status: 503 } : { status: 200, body: sleeperBody(url) }));
    const cache = new WipeableCache();
    const http = createHttpClient({ fetchImpl: f.impl, cache });
    await settle(loadSleeperWeeklyProjections(sleeperGate(http, NOW), SEASON, [4, 5, 6], POS));
    expect(f.attempts).toHaveLength(3);
    down = true;
    cache.wiped = true;
    await settle(loadSleeperWeeklyProjections(sleeperGate(http, at(MINUTE)), SEASON, [4], ["QB"])); // finds Sleeper down: 2 attempts
    expect(f.attempts).toHaveLength(5);
    const lost = await settle(loadSleeperWeeklyProjections(sleeperGate(http, at(2 * MINUTE)), SEASON, [4, 5, 6], POS));
    expect(f.attempts.slice(5).map((a) => a.url)).toEqual([projUrl(4)]); // week 4 wasn't in the cache: one attempt, no retry
    expect(lost.weeks.size).toBe(0);
    expect(lost.warnings.map((w) => w.code)).toEqual(["SLEEPER_DOWN", "SLEEPER_DOWN", "SLEEPER_DOWN"]);
  });

  it("builds running alongside share it: one that finds Sleeper down stops the other at its next request, and one outage doubles the hold once", async () => {
    const pending: Array<(res: HttpResponse) => void> = [];
    const calls: string[] = [];
    const http: HttpClient = {
      get(url) {
        calls.push(url);
        return new Promise((resolve) => pending.push(resolve));
      },
    };
    const a = sleeperGate(http, NOW);
    const b = sleeperGate(http, NOW);
    const bFirst = b.rows(projUrl(4)); // both in flight
    const aFirst = a.rows(statsUrl(1));
    pending[1]?.(json(null, 503));
    expect(await aFirst).toEqual({ why: "HTTP 503", down: true });
    expect(b.down()).toBe("HTTP 503"); // b learns it from what the client remembers
    pending[0]?.(json(null, 502));
    expect(await bFirst).toEqual({ why: "HTTP 502", down: true });
    expect(await b.rows(projUrl(5))).toEqual({ why: "HTTP 502", down: true });
    expect(calls).toEqual([projUrl(4), statsUrl(1)]);
    // One outage: held 5 minutes, not 10.
    expect(sleeperGate(http, at(SLEEPER_OUTAGE_HOLD_MS - 1)).down()).toBe("HTTP 503");
    expect(sleeperGate(http, at(SLEEPER_OUTAGE_HOLD_MS)).down()).toBeUndefined();
  });
});
