/**
 * Fetch-time reducers (planner reply to Checkpoint 4c, Part B, B1; src/data/reduce.ts): every consumer of a body reads
 * exactly the same from its reduced form as from the raw body. Proven here on the committed samples (public NFL data)
 * plus fictional rows the samples lack (stubs, a player listed twice, odd types; made-up ids 99xxxx and names), and by
 * `npm run measure:cache` on every full-size body in .cache/app. No network.
 */
import { describe, expect, it } from "vitest";
import { fetchSleeperLeague, PROJECTIONS_POLICY, sleeperUrls, startablePositions } from "@/adapters/sleeper/fetch";
import { normalizeSleeperLeague } from "@/adapters/sleeper/normalize";
import { StatRowSchema } from "@/adapters/sleeper/schemas";
import { fakeHttp as sleeperFakeHttp, fakeResolver, json, loadTestLeague, projectionRowOf, rawOf } from "@/adapters/sleeper/test-helpers";
import type { HttpResponse } from "@/adapters/types";
import type { Pos } from "@/engine/model";
import { MemoryCache } from "@/server/cache";
import { createHttpClient, quoteBigInts } from "@/server/http";
import { archivedGroups, lastModifiedById } from "@/server/projectionArchive";
import { readSanitizedFixture } from "@/test-utils/fixtures";
import { DYNASTYPROCESS_CACHE_KEY, DYNASTYPROCESS_COLUMNS, DYNASTYPROCESS_IDS_URL, DYNASTYPROCESS_REDUCER, fetchDynastyProcessIds, parseDynastyProcessCsv } from "./dynastyProcess";
import {
  IMPORT_PLAYER_FIELDS,
  IMPORT_PROJECTIONS_REDUCER,
  jsonReducer,
  jsonSafeNumbers,
  MODEL_PLAYER_FIELDS,
  MODEL_PROJECTIONS_REDUCER,
  numericEntries,
  pickKeys,
  reducedKey,
  REDUCER_ID,
  reducerId,
  SEASON_PROJECTIONS_REDUCER,
  STATS_REDUCER,
  type BodyReducer,
} from "./reduce";
import { fetchSleeperPlayers, reduceSleeperPlayers, SLEEPER_PLAYER_FIELDS, SLEEPER_PLAYER_POSITIONS, SLEEPER_PLAYERS_REDUCER, sleeperPlayersCacheKey, sleeperPlayersSchema, sleeperPlayersUrl } from "./sleeperPlayers";
import { loadSleeperSeasonProjections, loadSleeperStats, loadSleeperWeeklyProjections, sleeperGate, sleeperListCacheKey, sleeperSeasonProjectionsUrl, sleeperStatsUrl } from "./sleeperProjections";
import { fakeHttp, fixtureDynastyCsv, fixtureSleeperResponse, padDynastyCsv, sleeperListsWith, type FakeRoute } from "./testSupport";

const SEASON = 2026;
const NOW = new Date("2026-09-30T12:00:00.000Z");
const POS: Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
const STAT_REDUCERS: BodyReducer[] = [MODEL_PROJECTIONS_REDUCER, IMPORT_PROJECTIONS_REDUCER, SEASON_PROJECTIONS_REDUCER, STATS_REDUCER];

type Row = Record<string, unknown>;
const rowsOf = (label: string) => structuredClone(readSanitizedFixture<Row[]>("shared", label));
const PROJ = (week: number) => `sleeper/projections/2026/${week} (top 150 QB/RB/WR/TE + 6 per K/DEF/IDP)`;
const STATS = (week: number) => `sleeper/stats/2026/${week} (top 150 QB/RB/WR/TE + 6 per K/DEF/IDP)`;
const SEASON_QB = "sleeper/projections/2026?position=QB (season, top 40)";

/** What the HTTP client hands a consumer for a Sleeper list (bigIntsAsStrings, as every Sleeper request here asks). */
const asRead = (text: string): unknown => JSON.parse(quoteBigInts(text));

/**
 * Rows a full week holds and the committed top-150 samples don't (fictional players): stubs (ADP only, zeros, an
 * injured player's row with his player object and fields nothing reads), stubs without a player object, a player listed
 * three times whose latest last_modified is on his stub, a numeric id, and a team defense without a player object.
 */
function withExtraRows(rows: Row[], week: number): Row[] {
  return [
    ...rows,
    {
      player_id: "990001",
      week,
      stats: { adp_dd_ppr: 999, pos_adp_dd_ppr: 300, gp: 1, pts_ppr: 0, rec_td: 0 },
      player: { position: "WR", fantasy_positions: ["WR"], team: "NYJ", first_name: "Zorblax", last_name: "Quintavious", injury_status: "IR", years_exp: 3, news_updated: 1, metadata: { channel_id: "x" } },
      last_modified: 1_790_000_000_000,
      company: "rotowire",
      team: "NYJ",
    },
    { player_id: "990002", week, stats: { adp_dd_ppr: 500 }, player: { position: "RB", team: null, injury_status: null } },
    { player_id: "990003", week, stats: {} },
    { player_id: "990004", week, stats: null, player: null },
    { player_id: "990005", week, stats: { adp_dd_ppr: 7 }, player: { position: "TE", fantasy_positions: ["TE"] }, last_modified: 1_799_999_999_999 },
    { player_id: "990005", week, stats: { rec: 2.5, rec_yd: 22, gp: 1, note: "x" }, player: { position: "TE", fantasy_positions: ["TE"], team: "DAL" }, last_modified: 1_790_000_000_001 },
    { player_id: "990005", week, stats: { rec: 9, gp: 1 }, player: { position: "TE" } },
    { player_id: 990006, week, stats: { pass_yd: 12, pass_td: 0.1 } },
    { player_id: "DAL", week, stats: { def_int: 0.8, pts_allow: 21, st_td: 0.05 }, player: null },
  ];
}

/** One model build's read of a week: the loader's result and what the pre-game archive would file from it. */
async function modelRun(week: number, text: string, positions: Pos[] = POS) {
  const url = sleeperUrls.projections(SEASON, week, positions);
  const archived: unknown[] = [];
  const { http } = fakeHttp({ [url]: { json: asRead(text) } });
  const load = await loadSleeperWeeklyProjections(sleeperGate(http, NOW), SEASON, [week], positions, {
    currentWeek: 4,
    onWeek: (w) => archived.push(archivedGroups(w.rows, w.positions, lastModifiedById(w.res.json))),
  });
  return { load, archived };
}

describe("MODEL_PROJECTIONS_REDUCER (the model's weekly projections and the pre-game archive)", () => {
  it("gives the loader and the archive exactly what the raw body gives them, on every committed week plus stubs and duplicates", async () => {
    for (const week of [4, 5, 10, 15, 17, 18]) {
      const raw = JSON.stringify(withExtraRows(rowsOf(PROJ(week)), week));
      const reduced = MODEL_PROJECTIONS_REDUCER.reduce(raw);
      expect(reduced.length, `week ${week}`).toBeLessThan(raw.length / 2);
      const [a, b] = [await modelRun(week, raw), await modelRun(week, reduced)];
      expect(b, `week ${week}`).toEqual(a);
      expect(a.archived, `week ${week}`).toHaveLength(1);
      expect(a.load.weeks.get(week)?.size).toBeGreaterThan(150);
    }
  });

  it("keeps real rows only, with the fields its consumers read, and a player's latest last_modified from any of his rows", () => {
    const reduced = asRead(MODEL_PROJECTIONS_REDUCER.reduce(JSON.stringify(withExtraRows([], 4)))) as Row[];
    expect(reduced).toEqual([
      { player_id: "990005", stats: { rec: 2.5, rec_yd: 22, gp: 1 }, player: { position: "TE", fantasy_positions: ["TE"] }, last_modified: 1_799_999_999_999 },
      { player_id: "990005", stats: { rec: 9, gp: 1 }, player: { position: "TE" }, last_modified: 1_799_999_999_999 },
      { player_id: 990006, stats: { pass_yd: 12, pass_td: 0.1 } },
      { player_id: "DAL", stats: { def_int: 0.8, pts_allow: 21, st_td: 0.05 }, player: null },
    ]);
  });

  it("a week with stubs only keeps one stand-in row: still a non-empty list (cached as before) that reads 'no projections in it'", async () => {
    const raw = JSON.stringify(withExtraRows([], 9).filter((r) => r.player_id !== "990005" && r.player_id !== 990006 && r.player_id !== "DAL"));
    const reduced = MODEL_PROJECTIONS_REDUCER.reduce(raw);
    expect(asRead(reduced)).toEqual([{ player_id: "990001" }]);
    const cacheable = (text: string) => PROJECTIONS_POLICY.cacheIf?.({ ...json(asRead(text)) } as HttpResponse);
    expect(cacheable(reduced)).toBe(true);
    expect(cacheable(raw)).toBe(true);
    const [a, b] = [await modelRun(9, raw), await modelRun(9, reduced)];
    expect(b).toEqual(a);
    expect(a.load.warnings.map((w) => w.code)).toEqual(["PROJECTIONS_WEEK_UNAVAILABLE"]);
  });

  it("through the real client: the cache holds the reduced text under the reduced key, and the loader reads the same", async () => {
    const raw = JSON.stringify(withExtraRows(rowsOf(PROJ(4)), 4));
    const url = sleeperUrls.projections(SEASON, 4, POS);
    const cache = new MemoryCache();
    const fetchImpl = (async () => new Response(raw, { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const live = await loadSleeperWeeklyProjections(sleeperGate(createHttpClient({ fetchImpl, cache }), NOW), SEASON, [4], POS, { currentWeek: 4 });
    expect(cache.keys()).toEqual([sleeperListCacheKey(url, MODEL_PROJECTIONS_REDUCER)]);
    expect((cache.values()[0] as { text: string }).text).toBe(MODEL_PROJECTIONS_REDUCER.reduce(raw));
    expect(live.weeks).toEqual((await modelRun(4, raw)).load.weeks);
  });
});

describe("IMPORT_PROJECTIONS_REDUCER (the Sleeper import's projection weeks)", () => {
  /** The test league's three projection weeks: the committed rows, real rows for free agents, and stub rows carrying rostered players' fresher facts. */
  function importWeeks() {
    const t = loadTestLeague();
    const rostered = t.rosters.flatMap((r: { players?: string[] | null }) => r.players ?? []);
    const facts = new Map(t.players.map((p) => [p.id, p]));
    const injured = rostered.filter((id: string) => facts.has(id)).slice(0, 6);
    const freeAgents = t.players.filter((p) => !rostered.includes(p.id) && p.team).slice(0, 8);
    const weeks: Record<number, Row[]> = {};
    for (const week of [4, 5, 6]) {
      const rows: Row[] = week === 4 ? structuredClone(t.projections) : [];
      // Rostered players hurt this week: Sleeper sends them as stubs, with their player object (team and injury status).
      for (const id of injured) {
        const p = facts.get(id);
        if (!p) continue;
        const row = projectionRowOf({ ...p, team: "NYJ", injuryStatus: week === 4 ? "IR" : "Questionable" }, { adp_dd_ppr: 120 }, week);
        rows.push(week === 5 ? { ...row, stats: { rec: 3, rec_yd: 31, gp: 1 } } : row);
      }
      for (const [i, p] of freeAgents.entries()) rows.push(projectionRowOf(p, { rec: 1 + i + week, rec_yd: 10 * (i + week), rush_yd: 4, gp: 1 }, week));
      rows.push(...withExtraRows([], week));
      weeks[week] = rows;
    }
    return { t, weeks };
  }

  it("gives normalizeSleeperLeague exactly what the raw weeks give it: player facts from stub rows, free agents from real rows", () => {
    const { t, weeks } = importWeeks();
    const run = (reduce: boolean) =>
      normalizeSleeperLeague(
        { ...rawOf(t), projections: Object.fromEntries(Object.entries(weeks).map(([w, rows]) => [w, asRead(reduce ? IMPORT_PROJECTIONS_REDUCER.reduce(JSON.stringify(rows)) : JSON.stringify(rows))])) },
        { now: NOW, resolver: fakeResolver(t.players) },
      );
    const [raw, reduced] = [run(false), run(true)];
    expect(reduced).toEqual(raw);
    // The stubs mattered: an injured rostered player's team and status came from his stub row.
    expect(Object.values(raw.snapshot.players).filter((p) => p.nflTeam === "NYJ" && p.injury === "IR").length).toBeGreaterThan(0);
    expect(raw.snapshot.freeAgents.length).toBeGreaterThan(0);
  });

  it("keeps every row with a player object (its schema fields), real rows' stats, and drops stubs without one (none, or null)", () => {
    const reduced = asRead(IMPORT_PROJECTIONS_REDUCER.reduce(JSON.stringify(withExtraRows([], 4)))) as Row[];
    expect(reduced).toEqual([
      { player_id: "990001", player: { position: "WR", fantasy_positions: ["WR"], team: "NYJ", first_name: "Zorblax", last_name: "Quintavious", injury_status: "IR", years_exp: 3 } },
      { player_id: "990002", player: { position: "RB", team: null, injury_status: null } },
      { player_id: "990005", player: { position: "TE", fantasy_positions: ["TE"] } },
      { player_id: "990005", stats: { rec: 2.5, rec_yd: 22, gp: 1 }, player: { position: "TE", fantasy_positions: ["TE"], team: "DAL" } },
      { player_id: "990005", stats: { rec: 9, gp: 1 }, player: { position: "TE" } },
      { player_id: 990006, stats: { pass_yd: 12, pass_td: 0.1 } },
      { player_id: "DAL", stats: { def_int: 0.8, pts_allow: 21, st_td: 0.05 }, player: null },
    ]);
  });

  it("end to end through the real client: the adapter fetches, reduces and caches each week, and the import comes out the same", async () => {
    const { t, weeks } = importWeeks();
    const id = String(t.league.league_id);
    const positions = startablePositions(t.league.roster_positions);
    const bodies = new Map<string, unknown>([
      [sleeperUrls.state(), t.state],
      [sleeperUrls.league(id), t.league],
      [sleeperUrls.users(id), t.users],
      [sleeperUrls.rosters(id), t.rosters],
      [sleeperUrls.tradedPicks(id), t.tradedPicks],
      [sleeperUrls.drafts(id), t.drafts],
    ]);
    for (let w = 1; w <= 14; w++) bodies.set(sleeperUrls.matchups(id, w), t.matchups[w]);
    for (let leg = 1; leg <= 4; leg++) bodies.set(sleeperUrls.transactions(id, leg), t.transactions[leg] ?? []);
    for (const [w, rows] of Object.entries(weeks)) bodies.set(sleeperUrls.projections(SEASON, Number(w), positions), rows);
    const cache = new MemoryCache();
    const fetchImpl = (async (url: string | URL) => {
      const body = bodies.get(String(url));
      return new Response(body === undefined ? "null" : JSON.stringify(body), { status: body === undefined ? 404 : 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const viaClient = await fetchSleeperLeague({ season: SEASON, leagueId: id }, { http: createHttpClient({ fetchImpl, cache, maxRetries: 0 }) });
    const routes = new Map<string, HttpResponse>([...bodies].map(([url, body]) => [url, json(body)]));
    const viaRaw = await fetchSleeperLeague({ season: SEASON, leagueId: id }, { http: sleeperFakeHttp(routes) });
    const normalize = (r: typeof viaRaw) => normalizeSleeperLeague(r.raw, { now: NOW, resolver: fakeResolver(t.players), fetchWarnings: r.warnings });
    expect(normalize(viaClient)).toEqual(normalize(viaRaw));
    for (const w of [4, 5, 6]) expect(cache.keys()).toContain(reducedKey(`sleeper:${sleeperUrls.projections(SEASON, w, positions)}`, IMPORT_PROJECTIONS_REDUCER));
  });
});

describe("SEASON_PROJECTIONS_REDUCER and STATS_REDUCER", () => {
  it("the season loader reads the same per-game lines (gp and ADP keys, stubs and unread fields dropped)", async () => {
    const url = sleeperSeasonProjectionsUrl(SEASON, POS);
    const raw = JSON.stringify(withExtraRows(rowsOf(SEASON_QB), 0));
    const reduced = SEASON_PROJECTIONS_REDUCER.reduce(raw);
    expect(reduced.length).toBeLessThan(raw.length / 3);
    const run = async (text: string) => loadSleeperSeasonProjections(sleeperGate(fakeHttp({ [url]: { json: asRead(text) } }).http, NOW), SEASON, POS);
    const [a, b] = [await run(raw), await run(reduced)];
    expect(b).toEqual(a);
    expect(a.perGame.size).toBeGreaterThan(40);
    expect(JSON.stringify(asRead(reduced))).not.toMatch(/adp_|"gp"/);
  });

  it("the stats loader reads the same lines (rows without a game dropped; a later played row of the same player still counts)", async () => {
    for (const week of [1, 2, 3]) {
      const url = sleeperStatsUrl(SEASON, week, POS);
      const rows: Row[] = [
        { player_id: "990021", stats: { gp: 0, rec: 9 } },
        ...rowsOf(STATS(week)),
        { player_id: "990020", stats: { gms_active: 1, pos_rank_ppr: 999 } },
        { player_id: "990021", stats: { gp: 1, rec: 2, note: "x" } },
        { player_id: "990021", stats: { gp: 1, rec: 7 } },
        { player_id: 990022, stats: null },
      ];
      const raw = JSON.stringify(rows);
      const reduced = STATS_REDUCER.reduce(raw);
      const run = async (text: string) => loadSleeperStats(sleeperGate(fakeHttp({ [url]: { json: asRead(text) } }).http, NOW), SEASON, [week], POS);
      const [a, b] = [await run(raw), await run(reduced)];
      expect(b, `week ${week}`).toEqual(a);
      expect(a.weeks.get(week)?.get("990021")).toEqual({ gp: 1, rec: 2 });
    }
    // A week with no game: one stand-in row (cached as before), read as "no player with a game in it".
    const none = JSON.stringify([{ player_id: "990020", stats: { gms_active: 1 } }, { player_id: "990023", stats: { gp: 0 } }]);
    expect(asRead(STATS_REDUCER.reduce(none))).toEqual([{ player_id: "990020" }]);
  });
});

describe("what every stat-row reducer leaves alone", () => {
  it("a body the consumers would warn about stays as it is: a row that doesn't fit, an empty list, not a list, not JSON", () => {
    const rows = rowsOf(PROJ(4));
    const bad = JSON.stringify([...rows.slice(0, 3), { player_id: { nested: true }, stats: {} }, ...rows.slice(3, 6)]);
    for (const r of STAT_REDUCERS) {
      expect(r.reduce(bad), r.id).toBe(bad);
      for (const text of ["[]", "{}", "null", "", "<!doctype html><html></html>", '{"error":"rate limited"}', "[1,2,3", "not json", '[{"stats":{}}]']) expect(r.reduce(text), `${r.id}: ${text}`).toBe(text);
    }
  });

  it("a kept number that wouldn't read back the same keeps the raw body (an exponent of 16+ digits, -0, one past a double's range); a 19-digit id, read as a string, reduces as usual", async () => {
    const expo = '[{"player_id":"990010","stats":{"pass_yd":1e16,"gp":1},"player":{"position":"QB"}}]';
    const negZero = '[{"player_id":"990010","stats":{"pass_yd":10,"rush_yd":-0,"gp":1},"player":{"position":"QB"}}]';
    // JSON.parse reads 1e999 as Infinity and JSON.stringify writes it as null (review CA-6): a row whose only stat it is
    // counts as a projection in the raw body and wouldn't in a reduced one.
    const overflow = '[{"player_id":"990011","stats":{"pass_yd":1e999,"gp":1},"player":{"position":"QB"}},{"player_id":"990010","stats":{"pass_yd":250,"gp":1},"player":{"position":"QB"}}]';
    for (const r of STAT_REDUCERS) {
      expect(r.reduce(expo), r.id).toBe(expo);
      expect(r.reduce(negZero), r.id).toBe(negZero);
      expect(r.reduce(overflow), r.id).toBe(overflow);
    }
    expect((await modelRun(4, MODEL_PROJECTIONS_REDUCER.reduce(overflow))).load.weeks.get(4)?.has("990011")).toBe(true);
    expect(await modelRun(4, MODEL_PROJECTIONS_REDUCER.reduce(overflow))).toEqual(await modelRun(4, overflow));
    expect(SLEEPER_PLAYERS_REDUCER.reduce('{"4046":{"full_name":"A","age":1e999}}')).toBe('{"4046":{"full_name":"A","age":1e999}}');
    const bigId = '[{"player_id":1234567890123456789,"stats":{"pass_yd":10,"gp":1},"player":{"position":"QB"},"company":"x"}]';
    const reduced = MODEL_PROJECTIONS_REDUCER.reduce(bigId);
    expect(reduced).toBe('[{"player_id":"1234567890123456789","stats":{"pass_yd":10,"gp":1},"player":{"position":"QB"}}]');
    expect(await modelRun(4, reduced)).toEqual(await modelRun(4, bigId));
  });

  it("the player fields kept are exactly the schemas' (the import's list is pinned to StatRowSchema; the players lists' follows rowSchema by itself)", () => {
    const player = StatRowSchema.shape.player.unwrap().unwrap();
    expect([...IMPORT_PLAYER_FIELDS].sort()).toEqual(Object.keys(player.shape).sort());
    for (const f of MODEL_PLAYER_FIELDS) expect(IMPORT_PLAYER_FIELDS).toContain(f);
    expect([...SLEEPER_PLAYER_FIELDS].sort()).toEqual(Object.keys(sleeperPlayersSchema.valueType.shape).sort());
  });

  it("each id carries a fingerprint of the lists naming what it keeps, so changing a list (a schema gaining a field) changes the cache key by itself (review CA-7)", () => {
    // Derived, never hand-written: each id is reducerId of its own lists.
    expect(SLEEPER_PLAYERS_REDUCER.id).toBe(reducerId("sleeper-players", 1, [Object.keys(sleeperPlayersSchema.valueType.shape)]));
    expect(IMPORT_PROJECTIONS_REDUCER.id).toBe(reducerId("sleeper-proj-import", 1, [IMPORT_PLAYER_FIELDS]));
    expect(MODEL_PROJECTIONS_REDUCER.id).toBe(reducerId("sleeper-proj-model", 1, [MODEL_PLAYER_FIELDS]));
    expect(DYNASTYPROCESS_REDUCER.id).toBe(reducerId("dynastyprocess", 1, [DYNASTYPROCESS_COLUMNS]));
    // A field more, a field less, another order or another version: another id, and so another cache key.
    const fields = [...SLEEPER_PLAYER_FIELDS];
    const ids = new Set([
      reducerId("sleeper-players", 1, [fields]),
      reducerId("sleeper-players", 1, [[...fields, "news_updated"]]),
      reducerId("sleeper-players", 1, [fields.slice(1)]),
      reducerId("sleeper-players", 1, [[...fields].reverse()]),
      reducerId("sleeper-players", 2, [fields]),
      reducerId("sleeper-players", 1, [fields, []]),
    ]);
    expect(ids.size).toBe(6);
    for (const id of ids) expect(id).toMatch(REDUCER_ID);
    expect(reducerId("x", 1, [["a"]])).toBe(reducerId("x", 1, [["a"]])); // stable
    expect(reducedKey(sleeperPlayersCacheKey("QB").split("#")[0] as string, SLEEPER_PLAYERS_REDUCER)).toBe(sleeperPlayersCacheKey("QB"));
  });
});

describe("SLEEPER_PLAYERS_REDUCER (the players lists the crosswalk reads)", () => {
  /** The committed players' objects, plus a player with fields nothing reads and odd types the schema catches (fictional). */
  function list(): Record<string, Record<string, unknown>> {
    return {
      ...fixtureSleeperResponse(),
      "990030": { full_name: 7, age: "27", espn_id: 4_046_000, yahoo_id: null, sportradar_id: "AB0CD1EF-2345-6789-ABCD-EF0123456789", gsis_id: " 00-0012345", metadata: { a: 1 }, search_rank: 5, news_updated: 1 },
      "990031": { first_name: "Zorblax", last_name: "Quintavious", fantasy_positions: [1, 2], active: "yes", team: "WSH", status: "Active", college: "Nowhere" },
      KC: { first_name: "Kansas City", last_name: "Chiefs", position: "DEF", fantasy_positions: ["DEF"], team: "KC", active: true },
    };
  }

  it("the check and reduceSleeperPlayers read the same from the reduced list (types the schema catches included)", () => {
    const raw = JSON.stringify(list());
    const reduced = SLEEPER_PLAYERS_REDUCER.reduce(raw);
    expect(reduced.length).toBeLessThan(raw.length);
    expect(sleeperPlayersSchema.parse(JSON.parse(reduced))).toEqual(sleeperPlayersSchema.parse(JSON.parse(raw)));
    expect(reduceSleeperPlayers(sleeperPlayersSchema.parse(JSON.parse(reduced)))).toEqual(reduceSleeperPlayers(sleeperPlayersSchema.parse(JSON.parse(raw))));
    expect(Object.keys(JSON.parse(reduced))).toEqual(Object.keys(JSON.parse(raw)));
  });

  it("fetchSleeperPlayers loads the same from reduced lists, and a list the schema doesn't take stays as it is", async () => {
    const lists = sleeperListsWith({ WR: list() });
    const run = async (reduce: boolean) => {
      const routes: Record<string, FakeRoute> = {};
      for (const p of SLEEPER_PLAYER_POSITIONS) {
        const raw = JSON.stringify(lists[p]);
        routes[sleeperPlayersUrl(p)] = { json: JSON.parse(reduce ? SLEEPER_PLAYERS_REDUCER.reduce(raw) : raw) };
      }
      return fetchSleeperPlayers(fakeHttp(routes).http);
    };
    expect(await run(true)).toEqual(await run(false));
    for (const text of ['{"4046":null}', "[]", '{"4046":[1]}', "null", "<html></html>"]) expect(SLEEPER_PLAYERS_REDUCER.reduce(text)).toBe(text);
    expect(sleeperPlayersCacheKey("QB")).toBe(`sleeper:${sleeperPlayersUrl("QB")}#${SLEEPER_PLAYERS_REDUCER.id}`);
  });
});

describe("DYNASTYPROCESS_REDUCER (the ID map's CSV)", () => {
  const HEADER = "mfl_id,sportradar_id,gsis_id,sleeper_id,espn_id,yahoo_id,fleaflicker_id,name,position,team,birthdate,extra";

  it("parseDynastyProcessCsv reads the same rows from the reduced CSV: the committed subset, and quoting, CRLF, a BOM, short and long rows, blank lines", () => {
    const csv = fixtureDynastyCsv();
    const reduced = DYNASTYPROCESS_REDUCER.reduce(csv);
    expect(reduced.length).toBeLessThan(csv.length / 2);
    expect(parseDynastyProcessCsv(reduced)).toEqual(parseDynastyProcessCsv(csv));
    expect(reduced.slice(0, reduced.indexOf("\n"))).toBe(DYNASTYPROCESS_COLUMNS.join(","));
    const tricky = [
      `﻿${HEADER}`,
      '1,NA,NA,4046,123,NA,NA,"Doe, John",QB,KCC,1990-01-01,x',
      '2,NA,NA,4047,NA,NA,NA,"Quote ""Q"" Man",RB,NA,NA,y',
      '3,NA,NA,4048,NA,NA,NA,"Line\nBreak",WR,DAL',
      "",
      "4,NA,NA,4049,NA,NA,NA, Spaced ,TE,NYJ,NA,z,extra2",
      "5,NA,NA, 4050 ,NA,NA,NA,,PK,,NA,",
    ].join("\r\n");
    expect(parseDynastyProcessCsv(DYNASTYPROCESS_REDUCER.reduce(tricky))).toEqual(parseDynastyProcessCsv(tricky));
    expect(parseDynastyProcessCsv(tricky)).toHaveLength(5);
  });

  it("a CSV it can't read, or without the needed columns, stays as it is (the check's error, word for word)", () => {
    for (const text of ["", "404: Not Found", "<!DOCTYPE html><html></html>", 'sleeper_id,name\n1,"unterminated', "mfl_id,name\n1,A\n", `${HEADER.replace("espn_id,", "")}\n1,NA\n`]) {
      expect(DYNASTYPROCESS_REDUCER.reduce(text)).toBe(text);
    }
  });

  it("through the real client: cached reduced under its own key, and the loader reads the same rows", async () => {
    const csv = padDynastyCsv(fixtureDynastyCsv());
    const cache = new MemoryCache();
    const fetchImpl = (async () => new Response(csv, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } })) as unknown as typeof fetch;
    const viaClient = await fetchDynastyProcessIds(createHttpClient({ fetchImpl, cache }));
    expect(cache.keys()).toEqual([DYNASTYPROCESS_CACHE_KEY]);
    expect(DYNASTYPROCESS_CACHE_KEY).toBe(`dynastyprocess:${DYNASTYPROCESS_IDS_URL}#${DYNASTYPROCESS_REDUCER.id}`);
    const viaRaw = await fetchDynastyProcessIds(fakeHttp({ [DYNASTYPROCESS_IDS_URL]: { text: csv } }).http);
    expect(viaClient.rows).toEqual(viaRaw.rows);
  });
});

describe("the machinery", () => {
  it("reducedKey files a reduced body under its own key; every reducer's id names its version and fingerprint, and ids are unique", () => {
    const all = [...STAT_REDUCERS, SLEEPER_PLAYERS_REDUCER, DYNASTYPROCESS_REDUCER];
    for (const r of all) expect(r.id).toMatch(REDUCER_ID);
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    expect(reducedKey("sleeper:https://x", MODEL_PROJECTIONS_REDUCER)).toBe(`sleeper:https://x#${MODEL_PROJECTIONS_REDUCER.id}`);
    expect(MODEL_PROJECTIONS_REDUCER.id).toMatch(/^sleeper-proj-model-r1-[0-9a-f]{8}$/);
  });

  it("jsonSafeNumbers: integers of 16+ digits, -0 and non-finite numbers don't read back the same; everything else does", () => {
    expect(jsonSafeNumbers({ a: [1, 2.5, -3, 999_999_999_999_999, 1_790_000_000_000.5, 1e15 + 0.5, "1e16", 1.5e-300], b: null, c: true })).toBe(true);
    // Conservative: an integer-valued double this big may be written as an exponent (no quoting either way), still refused.
    expect(jsonSafeNumbers(1e21)).toBe(false);
    expect(jsonSafeNumbers({ a: [1e15] })).toBe(false);
    expect(jsonSafeNumbers([{ x: -0 }])).toBe(false);
    expect(jsonSafeNumbers(-1e16)).toBe(false);
    for (const x of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN, JSON.parse("1e999") as number]) expect(jsonSafeNumbers({ s: [x] }), String(x)).toBe(false);
  });

  it("jsonReducer: a reducer that throws or returns undefined leaves the text as it is; pickKeys and numericEntries keep what's there", () => {
    const throws = jsonReducer("t-r1", () => {
      throw new Error("bug");
    });
    expect(throws.reduce('{"a":1}')).toBe('{"a":1}');
    expect(jsonReducer("u-r1", () => undefined).reduce("[1]")).toBe("[1]");
    expect(jsonReducer("v-r1", (j) => j).reduce(' [1, 2] ')).toBe("[1,2]");
    expect(pickKeys({ a: 1, b: null, c: undefined }, ["b", "a", "d"])).toEqual({ b: null, a: 1 });
    expect(Object.keys(pickKeys({ a: 1, b: null }, ["b", "a"]))).toEqual(["b", "a"]);
    expect(numericEntries({ a: 1, b: "2", c: null, adp_x: 3 }, (k) => k.startsWith("adp_"))).toEqual({ a: 1 });
    expect(numericEntries(null)).toEqual({});
  });
});
