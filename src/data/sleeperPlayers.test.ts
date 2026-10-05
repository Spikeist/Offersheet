import { describe, expect, it } from "vitest";
import { LeagueImportError } from "@/adapters/types";
import { STALE_PUBLIC_RETAIN_MS, TTL } from "@/server/cache";
import {
  fetchSleeperPlayers,
  reduceSleeperPlayers,
  SLEEPER_DEF_ROWS,
  SLEEPER_LIST_MIN_ROWS,
  SLEEPER_LIST_TIMEOUT_MS,
  SLEEPER_PLAYER_POSITIONS,
  SLEEPER_PLAYERS_REDUCER,
  sleeperPlayersCacheKey,
  sleeperPlayersSchema,
  sleeperPlayersUrl,
  toLite,
} from "./sleeperPlayers";
import { fakeHttp, fixtureSleeperResponse, sleeperDefList, sleeperListsWith, sleeperListWith, type FakeRoute } from "./testSupport";

/** Field types as the live endpoint sends them (Phase 1 check of the 2026-09-29 DB). Fictional people. */
const QB_LIST = {
  "90001": {
    player_id: "90001",
    full_name: "Zorblax Quintavious",
    first_name: "Zorblax",
    last_name: "Quintavious",
    position: "QB",
    fantasy_positions: ["QB"],
    team: "LAR",
    injury_status: "",
    status: "Active",
    age: 27,
    active: true,
    years_exp: 5,
    espn_id: 4400001,
    yahoo_id: 33001,
    sportradar_id: "0A1B2C3D-0000-4000-8000-00000000AAAA",
    gsis_id: " 00-0090001",
    rotowire_id: 17001,
    search_rank: 12,
  },
  "90002": {
    player_id: "90002",
    full_name: "Quillon Thrasp",
    first_name: "Quillon",
    last_name: "Thrasp",
    position: "TE",
    fantasy_positions: ["TE", "QB"],
    team: null,
    injury_status: "Questionable",
    status: "Active",
    age: null,
    active: true,
    years_exp: 0,
    espn_id: null,
    yahoo_id: null,
    sportradar_id: "",
    gsis_id: null,
  },
};

const DEF_LIST = {
  // Team-defense rows have no full_name, age, status or ids.
  DAL: { player_id: "DAL", first_name: "Dallas", last_name: "Cowboys", position: "DEF", fantasy_positions: ["DEF"], team: "DAL", injury_status: null, active: true },
};

describe("Sleeper players DB", () => {
  it("builds the filtered URL", () => {
    expect(sleeperPlayersUrl("QB")).toBe("https://api.sleeper.app/v1/players/nfl?position=QB&active=true");
    expect(SLEEPER_PLAYER_POSITIONS).toEqual(["QB", "RB", "WR", "TE", "K", "P", "DEF", "DL", "LB", "DB"]);
  });

  it("reduces rows to records: ids normalized, blanks to null, DEF names from first + last name", () => {
    const recs = reduceSleeperPlayers(sleeperPlayersSchema.parse({ ...QB_LIST, ...DEF_LIST }));
    const qb = recs.find((r) => r.id === "90001");
    expect(qb).toMatchObject({
      name: "Zorblax Quintavious",
      position: "QB",
      team: "LAR",
      injuryStatus: null,
      active: true,
      espnId: "4400001",
      yahooId: "33001",
      sportradarId: "0a1b2c3d-0000-4000-8000-00000000aaaa",
      gsisId: "00-0090001",
    });
    expect(recs.find((r) => r.id === "90002")).toMatchObject({ team: null, injuryStatus: "Questionable", age: null, sportradarId: null, fantasyPositions: ["TE", "QB"] });
    expect(recs.find((r) => r.id === "DAL")).toMatchObject({ name: "Dallas Cowboys", firstName: "Dallas", lastName: "Cowboys", position: "DEF", age: null, status: null });
  });

  it("toLite exposes only SleeperPlayerLite fields", () => {
    const [qb] = reduceSleeperPlayers(sleeperPlayersSchema.parse(QB_LIST));
    expect(Object.keys(toLite(qb!)).sort()).toEqual(["active", "age", "fantasyPositions", "id", "injuryStatus", "name", "position", "status", "team", "yearsExp"]);
  });

  it("tolerates a changed type in a non-critical field, but not a non-object row", () => {
    const parsed = sleeperPlayersSchema.safeParse({ "90003": { full_name: "Vexmund Orr", age: "twenty", fantasy_positions: "WR" } });
    expect(parsed.success).toBe(true);
    expect(reduceSleeperPlayers(parsed.success ? parsed.data : {})[0]).toMatchObject({ id: "90003", age: null, fantasyPositions: [] });
    const bad = sleeperPlayersSchema.safeParse({ "90004": "oops" });
    expect(bad.success).toBe(false);
  });

  it("parses the player objects embedded in the committed Sleeper fixtures (real field shapes)", () => {
    const parsed = sleeperPlayersSchema.safeParse(fixtureSleeperResponse());
    expect(parsed.success).toBe(true);
    const recs = reduceSleeperPlayers(parsed.success ? parsed.data : {});
    expect(recs.length).toBeGreaterThan(300);
    expect(recs.every((r) => r.name.length > 0 && r.fantasyPositions.length > 0)).toBe(true);
    expect(recs.filter((r) => r.position === "DEF").every((r) => r.firstName && r.lastName && r.team === r.id)).toBe(true);
  });
});

describe("fetchSleeperPlayers", () => {
  const lists = () => sleeperListsWith({ QB: QB_LIST, TE: { "90002": QB_LIST["90002"] }, DEF: DEF_LIST });
  const routes = (over: Record<string, FakeRoute> = {}): Record<string, FakeRoute> => ({ ...Object.fromEntries(Object.entries(lists()).map(([p, json]) => [sleeperPlayersUrl(p), { json }])), ...over });
  const allIds = () => new Set(Object.values(lists()).flatMap((l) => Object.keys(l)));

  it("requests each position once, in order, checked, cached 24 h and kept 7 days as a saved copy, and dedupes players", async () => {
    const { http, calls } = fakeHttp(routes());
    const load = await fetchSleeperPlayers(http);
    expect(calls.map((c) => c.url)).toEqual(SLEEPER_PLAYER_POSITIONS.map(sleeperPlayersUrl));
    calls.forEach((c, i) => {
      // Reduced at fetch time under a key of its own (src/data/reduce.ts), league-independent (public: the shared cache's lock).
      const position = SLEEPER_PLAYER_POSITIONS[i] as string;
      expect(c.opts?.cache).toEqual({ key: sleeperPlayersCacheKey(position), ttlMs: TTL.sleeperPlayers, retainMs: STALE_PUBLIC_RETAIN_MS, staleIfError: true, public: true });
      expect(sleeperPlayersCacheKey(position)).toBe(`sleeper:${c.url}#${SLEEPER_PLAYERS_REDUCER.id}`);
      expect(c.opts?.transformText).toBe(SLEEPER_PLAYERS_REDUCER.reduce);
      expect(c.opts).toMatchObject({ maxRetries: 1, timeoutMs: SLEEPER_LIST_TIMEOUT_MS });
      expect(typeof c.opts?.cacheIf).toBe("function");
    });
    expect(new Set(load.players.map((p) => p.id))).toEqual(allIds());
    expect(load.players.filter((p) => p.id === "90002")).toHaveLength(1); // listed under QB and TE
    expect(load.failed).toEqual([]);
    expect(load.complete).toEqual([...SLEEPER_PLAYER_POSITIONS]);
    expect(load.staleLists).toEqual([]);
    expect(load.fromCache).toBe(false);
  });

  it("cacheIf accepts only a list that meets its row floor (DEF: exactly 32 teams)", async () => {
    const { http, calls } = fakeHttp(routes());
    await fetchSleeperPlayers(http);
    const cacheIf = (position: string) => calls.find((c) => c.url === sleeperPlayersUrl(position))?.opts?.cacheIf;
    const res = (json: unknown) => ({ status: 200, ok: true, isHtml: false, json, text: JSON.stringify(json), fromCache: false });
    expect(cacheIf("WR")?.(res(sleeperListWith("WR")))).toBe(true);
    expect(cacheIf("WR")?.(res(sleeperListWith("WR", {}, SLEEPER_LIST_MIN_ROWS - 1)))).toBe(false);
    expect(cacheIf("WR")?.(res({}))).toBe(false);
    expect(cacheIf("WR")?.(res([1, 2]))).toBe(false);
    expect(cacheIf("DEF")?.(res(sleeperDefList()))).toBe(true);
    const only31 = Object.fromEntries(Object.entries(sleeperDefList()).filter(([code]) => code !== "DAL"));
    expect(cacheIf("DEF")?.(res(only31))).toBe(false);
    expect(SLEEPER_DEF_ROWS).toBe(32);
  });

  it("treats a list below its floor as failed, not as a list of players (an empty 200 {} included)", async () => {
    const { http, calls } = fakeHttp(routes({ [sleeperPlayersUrl("WR")]: { json: {} }, [sleeperPlayersUrl("K")]: { json: sleeperListWith("K", {}, 5) } }));
    const load = await fetchSleeperPlayers(http);
    expect(load.failed).toEqual([
      { position: "WR", reason: "Sleeper players (WR): 0 rows, expected at least 20" },
      { position: "K", reason: "Sleeper players (K): 5 rows, expected at least 20" },
    ]);
    expect(load.complete).toEqual(SLEEPER_PLAYER_POSITIONS.filter((p) => p !== "WR" && p !== "K"));
    expect(calls).toHaveLength(SLEEPER_PLAYER_POSITIONS.length); // a bad body isn't an outage: the other lists are still requested
  });

  it("keeps the lists that loaded when one position fails, and stops asking once Sleeper is down (circuit breaker)", async () => {
    const { http, calls } = fakeHttp(routes({ [sleeperPlayersUrl("K")]: { status: 503 } }));
    const load = await fetchSleeperPlayers(http);
    const after = SLEEPER_PLAYER_POSITIONS.slice(SLEEPER_PLAYER_POSITIONS.indexOf("K") + 1);
    expect(calls.map((c) => c.url)).toEqual(["QB", "RB", "WR", "TE", "K"].map(sleeperPlayersUrl));
    expect(load.failed[0]).toEqual({ position: "K", reason: "Sleeper players (K): HTTP 503" });
    expect(load.failed.slice(1)).toEqual(after.map((position) => ({ position, reason: "not requested because Sleeper didn't answer (Sleeper players (K): HTTP 503)" })));
    expect(load.complete).toEqual(["QB", "RB", "WR", "TE"]);
    expect(load.players.some((p) => p.id === "90001")).toBe(true);
  });

  it.each([
    ["a network error", { status: 0 }],
    ["429", { status: 429 }],
    ["a 5xx", { status: 502 }],
    ["an HTML page", { text: "<html>down</html>", isHtml: true }],
  ] as const)("opens the breaker on %s", async (_label, route) => {
    const { http, calls } = fakeHttp(routes({ [sleeperPlayersUrl("RB")]: route }));
    const load = await fetchSleeperPlayers(http);
    expect(calls).toHaveLength(2);
    expect(load.complete).toEqual(["QB"]);
    expect(load.failed).toHaveLength(SLEEPER_PLAYER_POSITIONS.length - 1);
  });

  it("doesn't open the breaker on a 404 (that list's problem, not an outage)", async () => {
    const { http, calls } = fakeHttp(routes({ [sleeperPlayersUrl("P")]: { status: 404 } }));
    const load = await fetchSleeperPlayers(http);
    expect(calls).toHaveLength(SLEEPER_PLAYER_POSITIONS.length);
    expect(load.failed).toEqual([{ position: "P", reason: "Sleeper players (P): HTTP 404" }]);
  });

  it("uses a saved copy when Sleeper fails, then reads the other lists' saved copies without retries (not counted as complete)", async () => {
    const copyAt = Date.UTC(2026, 8, 27, 14, 0);
    const { http, calls } = fakeHttp(routes({ [sleeperPlayersUrl("RB")]: { json: lists().RB, stale: true, fetchedAt: copyAt } }));
    const load = await fetchSleeperPlayers(http);
    expect(calls).toHaveLength(SLEEPER_PLAYER_POSITIONS.length);
    const [qb, rb, ...rest] = calls;
    expect(qb?.opts).toMatchObject({ cache: { ttlMs: TTL.sleeperPlayers }, maxRetries: 1 });
    expect(rb?.opts).toMatchObject({ cache: { ttlMs: TTL.sleeperPlayers }, maxRetries: 1 });
    // After the failure: any saved copy up to 7 days old counts, and a list with no copy gets one try.
    for (const c of rest) expect(c.opts).toMatchObject({ cache: { ttlMs: STALE_PUBLIC_RETAIN_MS, retainMs: STALE_PUBLIC_RETAIN_MS, staleIfError: true }, maxRetries: 0 });
    // The fake client answers those live (fromCache false), so they count as fresh and complete.
    expect(load.complete).toEqual(SLEEPER_PLAYER_POSITIONS.filter((p) => p !== "RB"));
    expect(load.staleLists).toEqual([{ position: "RB", fetchedAt: copyAt }]);
    expect(new Set(load.players.map((p) => p.id))).toEqual(allIds());
  });

  it("counts every list read from a saved copy after a failure as stale", async () => {
    const saved = Object.fromEntries(Object.entries(routes()).map(([u, v]) => [u, { ...v, fromCache: true, fetchedAt: 1 }]));
    const { http } = fakeHttp({ ...saved, [sleeperPlayersUrl("QB")]: { json: QB_LIST_FULL(), stale: true, fetchedAt: 1 } });
    const load = await fetchSleeperPlayers(http);
    expect(load.complete).toEqual([]);
    expect(load.staleLists.map((s) => s.position)).toEqual([...SLEEPER_PLAYER_POSITIONS]);
    expect(load.failed).toEqual([]);
  });

  it("stops at a saved copy that is itself unusable, and when a list without a copy then fails", async () => {
    const badCopy = fakeHttp(routes({ [sleeperPlayersUrl("QB")]: { json: {}, stale: true } }));
    await expect(fetchSleeperPlayers(badCopy.http)).rejects.toMatchObject({ code: "BAD_RESPONSE" });
    expect(badCopy.calls).toHaveLength(1);
    const thenDown = fakeHttp(routes({ [sleeperPlayersUrl("QB")]: { json: QB_LIST_FULL(), stale: true }, [sleeperPlayersUrl("RB")]: { status: 503 } }));
    const load = await fetchSleeperPlayers(thenDown.http);
    expect(thenDown.calls).toHaveLength(2);
    expect(load.staleLists.map((s) => s.position)).toEqual(["QB"]);
    expect(load.failed.map((f) => f.position)).toEqual(SLEEPER_PLAYER_POSITIONS.filter((p) => p !== "QB"));
  });

  it("throws when every position fails; HTML and non-record bodies are errors", async () => {
    await expect(fetchSleeperPlayers(fakeHttp({}).http)).rejects.toMatchObject({ code: "SOURCE_DOWN", detail: { platform: "sleeper", status: 404 } });
    const html = fakeHttp({ [sleeperPlayersUrl("QB")]: { text: "<html></html>", isHtml: true } });
    await expect(fetchSleeperPlayers(html.http, ["QB"])).rejects.toMatchObject({ code: "SOURCE_DOWN" });
    const arr = fakeHttp({ [sleeperPlayersUrl("QB")]: { json: [1, 2] } });
    const err = await fetchSleeperPlayers(arr.http, ["QB"]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LeagueImportError);
    expect(err).toMatchObject({ code: "BAD_RESPONSE", detail: { path: "(root)" } });
    const notJson = fakeHttp({ [sleeperPlayersUrl("QB")]: { text: "garbage" } });
    await expect(fetchSleeperPlayers(notJson.http, ["QB"])).rejects.toMatchObject({ code: "BAD_RESPONSE" });
    // Every list "successful" but empty is not a players DB.
    const empty = fakeHttp(Object.fromEntries(SLEEPER_PLAYER_POSITIONS.map((p) => [sleeperPlayersUrl(p), { json: {} }])));
    await expect(fetchSleeperPlayers(empty.http)).rejects.toMatchObject({ code: "BAD_RESPONSE", detail: { path: "(root)" } });
  });

  it("reports fromCache only when every list came from the cache", async () => {
    const r = Object.fromEntries(Object.entries(routes()).map(([u, v]) => [u, { ...v, fromCache: true }]));
    const load = await fetchSleeperPlayers(fakeHttp(r).http);
    expect(load.fromCache).toBe(true);
    expect(load.complete).toEqual([...SLEEPER_PLAYER_POSITIONS]); // fresh cache hits are complete lists
  });
});

/** QB_LIST padded to the row floor. */
function QB_LIST_FULL() {
  return sleeperListWith("QB", QB_LIST);
}
