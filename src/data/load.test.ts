import { afterEach, describe, expect, it, vi } from "vitest";
import type { HttpClient, HttpRequestOptions, HttpResponse } from "@/adapters/types";
import { DAY, HOUR, MemoryCache, MINUTE, STALE_PUBLIC_RETAIN_MS, TTL } from "@/server/cache";
import { newRequestScope, runInRequestScope } from "@/server/deadline";
import { createHttpClient } from "@/server/http";
import { DYNASTYPROCESS_IDS_URL } from "./dynastyProcess";
import { FANTASYCALC_PLAYERS_URL } from "./fantasyCalcPlayers";
import { DEGRADED_MEMO_MS, loadPlayerIdResolver, rebuildDelayMs, RESOLVER_MEMO_MS, resolverBuildInFlight } from "./load";
import { SLEEPER_PLAYER_POSITIONS, sleeperPlayersUrl } from "./sleeperPlayers";
import { utcStamp } from "./source";
import { fakeHttp, fantasyCalcWith, padDynastyCsv, sleeperListsWith, type FakeRoute } from "./testSupport";

const NOW = new Date("2026-09-29T21:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);

// Fictional players; every body is padded with filler rows to meet the loaders' row floors.
const SLEEPER = sleeperListsWith({
  QB: { "90001": { full_name: "Zorblax Quintavious", position: "QB", fantasy_positions: ["QB"], team: "LAR", active: true, espn_id: 4400001 } },
  DEF: { DAL: { first_name: "Dallas", last_name: "Cowboys" } },
});
const DP_CSV = padDynastyCsv(
  "sleeper_id,espn_id,yahoo_id,mfl_id,fleaflicker_id,sportradar_id,gsis_id,name,position,team\n" +
    "90002,4400002,NA,17002,NA,NA,NA,Quillon Thrasp,WR,JAC\n" +
    // Not in Sleeper's active lists: retired or unsigned.
    "90004,4400004,NA,17004,NA,NA,NA,Orvald Tensk,CB,DAL\n",
);
const FC = fantasyCalcWith([{ id: 7, name: "Vexmund Orr", position: "TE", sleeperId: "90003", espnId: "4400003", mflId: "UNK", fleaflickerId: null, maybeTeam: "KC" }]);
const SOURCE_REQUESTS = SLEEPER_PLAYER_POSITIONS.length + 2;

function routes(over: Record<string, FakeRoute | ((attempt: number) => FakeRoute)> = {}): Record<string, FakeRoute | ((attempt: number) => FakeRoute)> {
  return {
    ...Object.fromEntries(SLEEPER_PLAYER_POSITIONS.map((p) => [sleeperPlayersUrl(p), { json: SLEEPER[p] }])),
    [DYNASTYPROCESS_IDS_URL]: { text: DP_CSV },
    [FANTASYCALC_PLAYERS_URL]: { json: FC },
    ...over,
  };
}

/** Routes whose sources can be taken down and brought back while a test runs. */
function switchable() {
  const down = new Set<string>();
  const base = routes();
  const live = Object.fromEntries(Object.entries(base).map(([url, route]) => [url, (attempt: number) => (down.has(url) ? { status: 503 } : typeof route === "function" ? route(attempt) : route)]));
  return { down, ...fakeHttp(live) };
}

/** Holds every request until released, to catch anyone waiting on a rebuild. */
function gated(inner: HttpClient) {
  let closed = false;
  let waiting: Array<() => void> = [];
  let started = 0;
  const http: HttpClient = {
    async get(url: string, opts?: HttpRequestOptions): Promise<HttpResponse> {
      started++;
      if (closed) await new Promise<void>((resolve) => waiting.push(resolve));
      return inner.get(url, opts);
    },
  };
  return {
    http,
    started: () => started,
    close: () => void (closed = true),
    open: () => {
      closed = false;
      const w = waiting;
      waiting = [];
      w.forEach((resolve) => resolve());
    },
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe("loadPlayerIdResolver", () => {
  it("a request that joins another request's first build waits no longer than its own deadline (Checkpoint 7a, review RL-1)", async () => {
    const g = gated(fakeHttp(routes()).http);
    g.close();
    const first = loadPlayerIdResolver({ http: g.http, now: NOW }); // starts the build, outside any request: no deadline
    await flush();
    const scope = newRequestScope("import", Date.now(), 30); // a request with 30 ms left
    const t0 = Date.now();
    await expect(runInRequestScope(scope, () => loadPlayerIdResolver({ http: g.http, now: NOW }))).rejects.toMatchObject({ code: "SOURCE_DOWN", message: "the player ID lists are still loading" });
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect([...scope.cut.slow]).toEqual(["other"]);
    g.open();
    const r = await first; // the build itself carries on and serves everyone after
    expect(await loadPlayerIdResolver({ http: g.http, now: NOW })).toBe(r);
  });

  it("loads all three sources and maps ids from each", async () => {
    const { http, calls } = fakeHttp(routes());
    const r = await loadPlayerIdResolver({ http, now: NOW });
    expect(calls).toHaveLength(SOURCE_REQUESTS);
    expect(r.canonical("espn", "4400001")).toBe("90001"); // Sleeper DB
    expect(r.canonical("espn", "4400002")).toBe("90002"); // DynastyProcess
    expect(r.canonical("espn", "4400003")).toBe("90003"); // FantasyCalc
    expect(r.canonical("mfl", "17002")).toBe("90002");
    expect(r.defenseId("Cowboys")).toBe("DAL");
    expect(r.sleeperPlayer("90001")?.name).toBe("Zorblax Quintavious");
    expect(r.sources()).toEqual([
      { name: "Sleeper players", fetchedAt: NOW.toISOString() },
      { name: "DynastyProcess player IDs", fetchedAt: NOW.toISOString() },
      { name: "FantasyCalc players", fetchedAt: NOW.toISOString() },
    ]);
    expect(r.warnings()).toEqual([]);
    // Every Sleeper list loaded fully, so a player missing from them isn't active (and has no team).
    expect(r.sleeperPlayer("90004")).toMatchObject({ name: "Orvald Tensk", position: "CB", active: false, team: null });
  });

  it("reports cached sources with an unknown fetch time", async () => {
    const cached = Object.fromEntries(Object.entries(routes()).map(([u, v]) => [u, { ...(v as FakeRoute), fromCache: true }]));
    const r = await loadPlayerIdResolver({ http: fakeHttp(cached).http, now: NOW });
    expect(r.status().map((s) => [s.fromCache, s.fetchedAt])).toEqual([
      [true, null],
      [true, null],
      [true, null],
    ]);
  });

  it("serves a build for RESOLVER_MEMO_MS, then keeps serving it while the next one builds in the background", async () => {
    const { http, calls } = fakeHttp(routes());
    const first = await loadPlayerIdResolver({ http, now: NOW });
    expect(await loadPlayerIdResolver({ http, now: at(RESOLVER_MEMO_MS - 1) })).toBe(first);
    expect(calls).toHaveLength(SOURCE_REQUESTS);
    expect(resolverBuildInFlight(http)).toBeUndefined();
    // Due: the caller still gets the current build at once; the rebuild runs behind it.
    expect(await loadPlayerIdResolver({ http, now: at(RESOLVER_MEMO_MS) })).toBe(first);
    const rebuild = resolverBuildInFlight(http);
    expect(rebuild).toBeDefined();
    const second = await rebuild;
    expect(second).not.toBe(first);
    expect(calls).toHaveLength(2 * SOURCE_REQUESTS);
    expect(await loadPlayerIdResolver({ http, now: at(RESOLVER_MEMO_MS + 1) })).toBe(second);
    expect(calls).toHaveLength(2 * SOURCE_REQUESTS);
    // Concurrent first callers share one build.
    const other = fakeHttp(routes());
    const [a, b] = await Promise.all([loadPlayerIdResolver({ http: other.http, now: NOW }), loadPlayerIdResolver({ http: other.http, now: NOW })]);
    expect(a).toBe(b);
    expect(other.calls).toHaveLength(SOURCE_REQUESTS);
  });

  it("never makes an import wait for a rebuild when there is a crosswalk to serve (review DATA-2)", async () => {
    const g = gated(fakeHttp(routes()).http);
    const first = await loadPlayerIdResolver({ http: g.http, now: NOW });
    g.close(); // every source now hangs
    let answered: unknown;
    void loadPlayerIdResolver({ http: g.http, now: at(RESOLVER_MEMO_MS) }).then((r) => (answered = r));
    await flush();
    expect(answered).toBe(first);
    const startedBefore = g.started();
    expect(startedBefore).toBeGreaterThan(SOURCE_REQUESTS); // the rebuild is waiting on its requests
    // More imports meanwhile: answered at once, and no second rebuild.
    expect(await loadPlayerIdResolver({ http: g.http, now: at(RESOLVER_MEMO_MS + MINUTE) })).toBe(first);
    expect(g.started()).toBe(startedBefore);
    g.open();
    const second = await resolverBuildInFlight(g.http);
    expect(second).toBeDefined();
    expect(await loadPlayerIdResolver({ http: g.http, now: at(RESOLVER_MEMO_MS + 2 * MINUTE) })).toBe(second);
  });

  it("serves a degraded first build, retries after DEGRADED_MEMO_MS, and lets a healthy build take over", async () => {
    const s = switchable();
    s.down.add(FANTASYCALC_PLAYERS_URL);
    const r = await loadPlayerIdResolver({ http: s.http, now: NOW });
    expect(r.canonical("espn", "4400002")).toBe("90002");
    expect(r.canonical("espn", "4400003")).toBeUndefined();
    expect(r.status()[2]).toMatchObject({ available: false, note: "FantasyCalc players: HTTP 503" });
    expect(r.warnings()).toEqual([expect.objectContaining({ code: "ID_SOURCE_UNAVAILABLE" })]);
    const n = s.calls.length;
    expect(await loadPlayerIdResolver({ http: s.http, now: at(DEGRADED_MEMO_MS - 1) })).toBe(r);
    expect(s.calls).toHaveLength(n);
    s.down.clear();
    expect(await loadPlayerIdResolver({ http: s.http, now: at(DEGRADED_MEMO_MS) })).toBe(r);
    const healthy = await resolverBuildInFlight(s.http);
    expect(healthy).not.toBe(r);
    expect(healthy?.canonical("espn", "4400003")).toBe("90003");
    expect(await loadPlayerIdResolver({ http: s.http, now: at(DEGRADED_MEMO_MS + 1) })).toBe(healthy);
    expect(DEGRADED_MEMO_MS).toBeLessThan(RESOLVER_MEMO_MS);
  });

  it("keeps a healthy crosswalk over a degraded rebuild, and backs off 10 → 20 → 40 → 60 minutes while the outage lasts (review DATA-5)", async () => {
    const s = switchable();
    const healthy = await loadPlayerIdResolver({ http: s.http, now: NOW });
    s.down.add(FANTASYCALC_PLAYERS_URL);
    const fcRequests = () => s.calls.filter((c) => c.url === FANTASYCALC_PLAYERS_URL).length;
    let t = RESOLVER_MEMO_MS;
    const rebuildsAt: number[] = [];
    for (const wait of [0, 10 * MINUTE, 20 * MINUTE, 40 * MINUTE, HOUR, HOUR]) {
      t += wait;
      // Just before it's due, nothing is requested.
      if (wait) {
        const before = fcRequests();
        expect(await loadPlayerIdResolver({ http: s.http, now: at(t - 1) })).toBe(healthy);
        expect(fcRequests()).toBe(before);
      }
      expect(await loadPlayerIdResolver({ http: s.http, now: at(t) })).toBe(healthy);
      await resolverBuildInFlight(s.http);
      rebuildsAt.push(t);
      expect(await loadPlayerIdResolver({ http: s.http, now: at(t) })).toBe(healthy); // the degraded rebuild didn't take over
    }
    expect(fcRequests()).toBe(1 + rebuildsAt.length);
    expect([1, 2, 3, 4, 5, 9].map(rebuildDelayMs)).toEqual([10 * MINUTE, 20 * MINUTE, 40 * MINUTE, HOUR, HOUR, HOUR]);
    expect(rebuildDelayMs(0)).toBe(RESOLVER_MEMO_MS);
    // Back up: the next rebuild is healthy and takes over.
    s.down.clear();
    t += HOUR;
    await loadPlayerIdResolver({ http: s.http, now: at(t) });
    const next = await resolverBuildInFlight(s.http);
    expect(next).not.toBe(healthy);
    expect(await loadPlayerIdResolver({ http: s.http, now: at(t) })).toBe(next);
  });

  it("keeps serving the current crosswalk when a background rebuild fails outright, and backs off", async () => {
    const s = switchable();
    const current = await loadPlayerIdResolver({ http: s.http, now: NOW });
    for (const url of Object.keys(routes())) s.down.add(url);
    expect(await loadPlayerIdResolver({ http: s.http, now: at(RESOLVER_MEMO_MS) })).toBe(current);
    await expect(resolverBuildInFlight(s.http)).resolves.toBe(current);
    const n = s.calls.length;
    expect(await loadPlayerIdResolver({ http: s.http, now: at(RESOLVER_MEMO_MS + DEGRADED_MEMO_MS - 1) })).toBe(current);
    expect(s.calls).toHaveLength(n);
    await loadPlayerIdResolver({ http: s.http, now: at(RESOLVER_MEMO_MS + DEGRADED_MEMO_MS) });
    await resolverBuildInFlight(s.http);
    expect(s.calls.length).toBeGreaterThan(n);
  });

  it("notes Sleeper lists that failed, and stops asking Sleeper at the first 5xx", async () => {
    const { http, calls } = fakeHttp(routes({ [sleeperPlayersUrl("P")]: { status: 500 } }));
    const r = await loadPlayerIdResolver({ http, now: NOW });
    expect(calls.filter((c) => c.url.startsWith("https://api.sleeper.app/"))).toHaveLength(SLEEPER_PLAYER_POSITIONS.indexOf("P") + 1);
    expect(r.status()[0]).toMatchObject({ available: true, note: "the P, DEF, DL, LB, DB lists could not be loaded (Sleeper players (P): HTTP 500)" });
    expect(r.warnings().map((w) => w.code)).toEqual(["ID_SOURCE_PARTIAL"]);
    // With lists missing, a player absent from them may be active: his status is unknown, not "retired".
    expect(r.sleeperPlayer("90004")).toMatchObject({ name: "Orvald Tensk", active: null, team: "DAL" });
  });

  it("treats an empty 200 list as a failed list, not as 'everyone at that position retired' (review DATA-1)", async () => {
    const { http } = fakeHttp(routes({ [sleeperPlayersUrl("WR")]: { json: {} } }));
    const r = await loadPlayerIdResolver({ http, now: NOW });
    expect(r.status()[0]?.note).toBe("the WR list could not be loaded (Sleeper players (WR): 0 rows, expected at least 20)");
    expect(r.warnings().map((w) => w.code)).toEqual(["ID_SOURCE_PARTIAL"]);
    expect(r.sleeperPlayer("90002")).toMatchObject({ name: "Quillon Thrasp", active: null }); // a DynastyProcess WR, status unknown
  });

  it("notes saved copies that stood in, with when they were fetched", async () => {
    const copyAt = Date.UTC(2026, 8, 27, 14, 5);
    const staleAll = Object.fromEntries(Object.entries(routes()).map(([u, v]) => [u, { ...(v as FakeRoute), stale: true, fetchedAt: copyAt }]));
    const r = await loadPlayerIdResolver({ http: fakeHttp(staleAll).http, now: NOW });
    expect(r.status().map((s) => s.note)).toEqual([
      `couldn't be refreshed, so our saved copies of all 10 lists from ${utcStamp(copyAt)} are used`,
      `couldn't be refreshed, so our saved copy from ${utcStamp(copyAt)} is used`,
      `couldn't be refreshed, so our saved copy from ${utcStamp(copyAt)} is used`,
    ]);
    expect(utcStamp(copyAt)).toBe("2026-09-27 14:05 UTC");
    expect(r.status().every((s) => s.available && s.fromCache && s.fetchedAt === new Date(copyAt).toISOString())).toBe(true);
    expect(r.warnings().map((w) => w.code)).toEqual(["ID_SOURCE_PARTIAL", "ID_SOURCE_PARTIAL", "ID_SOURCE_PARTIAL"]);
    // Saved lists may miss players added since, so absence doesn't mean "not active".
    expect(r.sleeperPlayer("90004")?.active).toBeNull();
  });

  it("throws SOURCE_DOWN when every source fails, and doesn't remember the failure", async () => {
    const { http, calls } = fakeHttp({});
    await expect(loadPlayerIdResolver({ http, now: NOW })).rejects.toMatchObject({ code: "SOURCE_DOWN" });
    const n = calls.length;
    await expect(loadPlayerIdResolver({ http, now: NOW })).rejects.toMatchObject({ code: "SOURCE_DOWN" });
    expect(calls).toHaveLength(2 * n);
  });

  it("works through the real HttpClient: live once, then from its cache", async () => {
    vi.useFakeTimers({ now: NOW });
    const hits: string[] = [];
    const bodies = routes() as Record<string, FakeRoute>;
    const fetchImpl = (async (url: string | URL) => {
      hits.push(String(url));
      const r = bodies[String(url)];
      const body = r?.text ?? JSON.stringify(r?.json ?? null);
      return new Response(body, { status: r ? 200 : 404, headers: { "content-type": r?.text ? "text/plain" : "application/json" } });
    }) as typeof fetch;
    const http = createHttpClient({ fetchImpl, cache: new MemoryCache() });
    const live = await settle(loadPlayerIdResolver({ http, now: NOW }));
    expect(live.status().every((s) => s.available && !s.fromCache)).toBe(true);
    expect(hits).toHaveLength(SOURCE_REQUESTS);
    vi.setSystemTime(at(RESOLVER_MEMO_MS));
    await loadPlayerIdResolver({ http, now: at(RESOLVER_MEMO_MS) });
    const cached = await settle(resolverBuildInFlight(http) ?? Promise.resolve(undefined));
    expect(hits).toHaveLength(SOURCE_REQUESTS); // nothing refetched within the 24 h TTLs
    // Cached copies keep the time they were really fetched (not the time of this build).
    const liveTimes = live.status().map((s) => s.fetchedAt);
    expect(liveTimes).toEqual([NOW.toISOString(), NOW.toISOString(), NOW.toISOString()]);
    expect(cached?.status().every((s) => s.fromCache && !s.note)).toBe(true);
    expect(cached?.status().map((s) => s.fetchedAt)).toEqual(liveTimes);
    expect(cached?.canonical("espn", "4400003")).toBe("90003");
    expect(TTL.sleeperPlayers).toBe(TTL.idMap);
  });
});

/** Runs the fake clock until the promise settles (the client's backoff and pacing sleeps). */
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  void p.then(
    () => (done = true),
    () => (done = true),
  );
  for (let i = 0; i < 1_000 && !done; i++) await vi.advanceTimersByTimeAsync(500);
  return p;
}

describe("loadPlayerIdResolver through the real HttpClient during an outage (fake clock)", () => {
  /** A fetch that serves the canned bodies, or 503 for hosts marked down, and counts requests per host. */
  function outageFetch() {
    const bodies = routes() as Record<string, FakeRoute>;
    const down = new Set<string>();
    const perHost = new Map<string, number>();
    const fetchImpl = (async (url: string | URL) => {
      const u = new URL(String(url));
      perHost.set(u.host, (perHost.get(u.host) ?? 0) + 1);
      if (down.has(u.host)) return new Response("unavailable", { status: 503, headers: { "content-type": "text/plain" } });
      const r = bodies[String(url)];
      return new Response(r?.text ?? JSON.stringify(r?.json ?? null), { status: r ? 200 : 404, headers: { "content-type": r?.text ? "text/plain" : "application/json" } });
    }) as typeof fetch;
    return { fetchImpl, down, perHost };
  }

  it("asks a failing Sleeper twice, not 40 times, and after a restart builds from saved copies with a note (review DATA-2)", async () => {
    vi.useFakeTimers({ now: NOW });
    const cache = new MemoryCache();
    const f = outageFetch();
    const warm = await settle(loadPlayerIdResolver({ http: createHttpClient({ fetchImpl: f.fetchImpl, cache }), now: NOW }));
    expect(warm.warnings()).toEqual([]);
    const fetchedAt = warm.status()[0]?.fetchedAt;

    // A day and an hour later the 24 h copies are due, and Sleeper is down.
    vi.setSystemTime(at(DAY + HOUR));
    f.down.add("api.sleeper.app");
    f.perHost.clear();
    const restarted = createHttpClient({ fetchImpl: f.fetchImpl, cache }); // a new server process: nothing in memory
    const r = await settle(loadPlayerIdResolver({ http: restarted, now: at(DAY + HOUR) }));
    expect(f.perHost.get("api.sleeper.app")).toBe(2); // the QB list and its one retry; the other lists came from saved copies
    expect(f.perHost.get("raw.githubusercontent.com")).toBe(1);
    expect(f.perHost.get("api.fantasycalc.com")).toBe(1);
    expect(r.status()[0]).toMatchObject({ available: true, fromCache: true, fetchedAt, note: `couldn't be refreshed, so our saved copies of all 10 lists from ${utcStamp(Date.parse(fetchedAt ?? ""))} are used` });
    expect(r.canonical("espn", "4400001")).toBe("90001"); // Sleeper's own ESPN id still maps
    expect(r.sleeperPlayer("90001")).toMatchObject({ name: "Zorblax Quintavious", active: true });
    expect(r.sleeperPlayer("90004")?.active).toBeNull();
    expect(STALE_PUBLIC_RETAIN_MS).toBeGreaterThan(DAY + HOUR);
  });

  it("with nothing saved, stops asking Sleeper after the first list and still builds from the other sources", async () => {
    vi.useFakeTimers({ now: NOW });
    const f = outageFetch();
    f.down.add("api.sleeper.app");
    const r = await settle(loadPlayerIdResolver({ http: createHttpClient({ fetchImpl: f.fetchImpl, cache: new MemoryCache() }), now: NOW }));
    expect(f.perHost.get("api.sleeper.app")).toBe(2);
    expect(r.status()[0]).toMatchObject({ available: false, note: "Sleeper players (QB): HTTP 503" });
    expect(r.canonical("espn", "4400002")).toBe("90002");
    expect(r.defenseId("KC")).toBe("KC"); // FantasyCalc's team codes stand in for Sleeper's
  });

  it("never caches a rejected body: an empty FantasyCalc list is asked again on the next rebuild (review HTTP-1)", async () => {
    vi.useFakeTimers({ now: NOW });
    const cache = new MemoryCache();
    let fcAnswer: unknown = [];
    let fcRequests = 0;
    const base = outageFetch();
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      if (String(url) !== FANTASYCALC_PLAYERS_URL) return base.fetchImpl(url, init);
      fcRequests++;
      return new Response(JSON.stringify(fcAnswer), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const http = createHttpClient({ fetchImpl, cache });
    const first = await settle(loadPlayerIdResolver({ http, now: NOW }));
    expect(first.status()[2]).toMatchObject({ available: false, note: "FantasyCalc players: 0 rows, expected at least 1,000" });
    expect(fcRequests).toBe(1); // a bad 200 isn't retried within the request
    expect(cache.keys().some((k) => k.startsWith("fantasycalc:"))).toBe(false);
    fcAnswer = FC;
    vi.setSystemTime(at(DEGRADED_MEMO_MS));
    await loadPlayerIdResolver({ http, now: at(DEGRADED_MEMO_MS) });
    const fixed = await settle(resolverBuildInFlight(http) ?? Promise.resolve(undefined));
    expect(fcRequests).toBe(2);
    expect(fixed?.canonical("espn", "4400003")).toBe("90003");
    expect(cache.keys().some((k) => k.startsWith("fantasycalc:"))).toBe(true);
  });
});
