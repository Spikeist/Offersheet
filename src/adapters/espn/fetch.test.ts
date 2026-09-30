/**
 * ESPN fetch + error mapping with a mocked HttpClient (no network). The private-league paths (401,
 * 403, an HTML login page) couldn't be seen live because Parker's league is public, so they are
 * tested with mocks, as the planner asked (reply to Checkpoint 0). The SWID test runs the real
 * HttpClient and MemoryCache over a fake fetch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeagueImportError, type HttpClient, type HttpRequestOptions, type HttpResponse } from "@/adapters/types";
import { MemoryCache, TTL, credentialScope } from "@/server/cache";
import { createHttpClient } from "@/server/http";
import { importEspnLeague } from ".";
import { PLAYER_CARD_BATCH, classifyEspnResponse, currentNflSeason, fetchEspnLeague, injuredRosteredIds, pseudonymizeSwids, requireEspnLeagueId, swidPseudonym, TRANSACTION_TYPES } from "./fetch";
import { LeagueSchema } from "./schema";
import { FA_POSITIONS, LABELS, NOW, PARKER, expectedTransactionTypes, fakeResolver, parkerCards, readEspn } from "./test-helpers";

const json = (status: number, body: unknown): HttpResponse => ({ status, ok: status >= 200 && status < 300, isHtml: false, json: body, text: JSON.stringify(body), fromCache: false });
const html = (status: number): HttpResponse => ({ status, ok: status >= 200 && status < 300, isHtml: true, json: undefined, text: "<!DOCTYPE html><html><body>Log in</body></html>", fromCache: false });

interface Call {
  url: string;
  opts: HttpRequestOptions;
}

/**
 * A scripted HttpClient: `route` answers each URL; every call is recorded. Like the real client it
 * applies opts.transformText to a body before parsing it (the SWID pseudonyms).
 */
function mockHttp(route: (url: string, opts: HttpRequestOptions) => HttpResponse): HttpClient & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async get(url, opts = {}) {
      calls.push({ url, opts });
      const res = route(url, opts);
      if (!opts.transformText || res.json === undefined) return res;
      const text = opts.transformText(res.text);
      return { ...res, text, json: JSON.parse(text) as unknown };
    },
  };
}

const FA_FILE: Record<number, string> = { 0: "QB", 2: "RB", 4: "WR", 6: "TE", 17: "K", 16: "D/ST" };
const filterOf = (opts: { headers?: Record<string, string> }) => JSON.parse(opts.headers?.["x-fantasy-filter"] ?? "{}") as { players?: { filterSlotIds?: { value: number[] }; filterIds?: { value: number[] } } };
/** Serves Parker's sanitized fixtures the way ESPN would answer each request. */
function parkerRoute(url: string, opts: { headers?: Record<string, string> }): HttpResponse {
  const u = new URL(url);
  const views = u.searchParams.getAll("view");
  if (views.includes("proTeamSchedules_wl")) return json(200, readEspn(LABELS.proSchedule));
  if (views.includes("mTransactions2")) return json(200, readEspn(LABELS.tx(Number(u.searchParams.get("scoringPeriodId")))));
  if (views.includes("kona_playercard")) {
    const ids = new Set(filterOf(opts).players?.filterIds?.value ?? []);
    return json(200, { players: parkerCards().players.filter((p) => ids.has(p.id)) });
  }
  if (views.includes("kona_player_info")) return json(200, readEspn(LABELS.fa(FA_FILE[filterOf(opts).players?.filterSlotIds?.value[0] as number] as string)));
  if (views.includes("mSettings")) return json(200, readEspn(LABELS.league));
  return json(404, { details: [{ type: "GENERAL_NOT_FOUND" }] });
}

const CREDS = { espnS2: "AEBfakeS2%2Bvalue%3D%3D", swid: PARKER.swid };

async function importError(route: (url: string, opts: HttpRequestOptions) => HttpResponse, credentials?: typeof CREDS, season = 2026): Promise<LeagueImportError> {
  try {
    await fetchEspnLeague({ leagueId: PARKER.leagueId, season, ...(credentials ? { credentials } : {}) }, mockHttp(route), NOW);
  } catch (e) {
    if (e instanceof LeagueImportError) return e;
    throw e;
  }
  throw new Error("expected a LeagueImportError");
}

describe("ESPN error mapping", () => {
  it("a wrong season (HTTP 404 JSON, details[].type GENERAL_NOT_FOUND, as seen live) → LEAGUE_NOT_FOUND", async () => {
    const body = readEspn(LABELS.wrongSeason);
    expect(JSON.stringify(body)).toContain("GENERAL_NOT_FOUND");
    const e = await importError(() => json(404, body), undefined, 2027);
    expect(e.code).toBe("LEAGUE_NOT_FOUND");
    expect(e.message).toMatch(/^League not found for that season\./);
    expect(e.detail).toEqual({ platform: "espn", status: 404 });
  });

  it("401 / 403 / an HTML login page without cookies → PRIVATE_LEAGUE; with cookies → BAD_CREDENTIALS", async () => {
    for (const res of [json(401, { messages: ["not authorized"] }), json(403, {}), html(200), html(401)]) {
      expect((await importError(() => res)).code).toBe("PRIVATE_LEAGUE");
      expect((await importError(() => res, CREDS)).code).toBe("BAD_CREDENTIALS");
    }
    const e = await importError(() => html(200));
    expect(e.message).toMatch(/Make League Viewable to Public/);
  });

  it("an outage answered with an HTML error page (503, 502, 429) is SOURCE_DOWN, with or without cookies — never 'private' or 'bad cookies'", async () => {
    for (const status of [503, 502, 500, 429])
      for (const creds of [undefined, CREDS]) {
        const e = await importError(() => html(status), creds);
        expect({ status, withCookies: !!creds, code: e.code }).toEqual({ status, withCookies: !!creds, code: "SOURCE_DOWN" });
        expect(e.message).toMatch(new RegExp(`HTTP ${status}`));
      }
  });

  it("a league not activated for the season → NOT_ACTIVATED (error text, or isActive false for the current season)", async () => {
    expect((await importError(() => json(401, { details: [{ type: "LEAGUE_NOT_ACTIVATED", message: "League is not activated" }] }))).code).toBe("NOT_ACTIVATED");
    const inactive = (url: string, opts: HttpRequestOptions) => {
      const res = parkerRoute(url, opts);
      if (new URL(url).searchParams.getAll("view").includes("mSettings")) {
        const league = res.json as { status: { isActive?: boolean } };
        league.status = { ...league.status, isActive: false };
        return json(200, league);
      }
      return res;
    };
    expect((await importError(inactive)).code).toBe("NOT_ACTIVATED");
    // A past season that's no longer active still imports.
    await expect(fetchEspnLeague({ leagueId: PARKER.leagueId, season: 2025 }, mockHttp(inactive), NOW)).resolves.toMatchObject({ season: 2025 });
  });

  it("5xx / 429 / network failure → SOURCE_DOWN; a non-JSON 200 → BAD_RESPONSE; bad input is rejected before any request", async () => {
    for (const status of [500, 503, 429, 0]) expect((await importError(() => json(status, undefined))).code).toBe("SOURCE_DOWN");
    expect((await importError(() => ({ status: 200, ok: true, isHtml: false, json: undefined, text: "garbage", fromCache: false }))).code).toBe("BAD_RESPONSE");
    const http = mockHttp(parkerRoute);
    await expect(fetchEspnLeague({ leagueId: "not a league", season: 2026 }, http, NOW)).rejects.toMatchObject({ code: "LEAGUE_NOT_FOUND" });
    await expect(fetchEspnLeague({ leagueId: "https://fantasy.espn.com/football/league?leagueId=123456", season: 2026 }, http, NOW)).rejects.toMatchObject({ code: "LEAGUE_NOT_FOUND" });
    await expect(fetchEspnLeague({ leagueId: "123", season: 26 }, http, NOW)).rejects.toMatchObject({ code: "LEAGUE_NOT_FOUND" });
    expect(http.calls).toHaveLength(0);
  });

  it("classifyEspnResponse passes usable JSON through", () => {
    expect(classifyEspnResponse(json(200, { id: 1 }), { withCookies: false, season: 2026 })).toBeUndefined();
  });
});

describe("fetchEspnLeague requests", () => {
  it("asks for the combined league views, transactions for periods 1…current (never 0), free agents per position, injured players' cards and the NFL schedule", async () => {
    const http = mockHttp(parkerRoute);
    const r = await fetchEspnLeague({ leagueId: PARKER.leagueId, season: 2026 }, http, NOW);
    const urls = http.calls.map((c) => c.url);
    expect(urls[0]).toBe(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/${PARKER.leagueId}?view=mSettings&view=mTeam&view=mRoster&view=mMatchup&view=mStatus`);
    const tx = http.calls.filter((c) => c.url.includes("mTransactions2"));
    expect(tx.map((c) => new URL(c.url).searchParams.get("scoringPeriodId"))).toEqual(["1", "2", "3", "4"]);
    for (const c of tx) expect(JSON.parse(c.opts.headers?.["x-fantasy-filter"] ?? "")).toEqual({ transactions: { filterType: { value: TRANSACTION_TYPES } } });
    const fa = http.calls.filter((c) => c.url.includes("kona_player_info"));
    expect(fa).toHaveLength(FA_POSITIONS.length);
    for (const c of fa) {
      expect(new URL(c.url).searchParams.get("scoringPeriodId")).toBe("4");
      const filter = JSON.parse(c.opts.headers?.["x-fantasy-filter"] ?? "") as { players: { limit: number; filterStatus: { value: string[] } } };
      expect(filter.players.limit).toBe(500);
      expect(filter.players.filterStatus.value).toEqual(["FREEAGENT", "WAIVERS"]);
    }
    // Player cards: one request for the injured rostered players, with espn-api's get_player_card filter.
    type Json = { teams: Array<{ roster: { entries: Array<{ playerPoolEntry: { player: { id: number; injuryStatus?: string } } }> } }> };
    const injured = readEspn<Json>(LABELS.league)
      .teams.flatMap((t) => t.roster.entries.map((e) => e.playerPoolEntry.player))
      .filter((p) => p.injuryStatus && p.injuryStatus !== "ACTIVE");
    expect(injured.length).toBeGreaterThan(0);
    expect(injured.length).toBeLessThanOrEqual(PLAYER_CARD_BATCH);
    const cards = http.calls.filter((c) => c.url.includes("kona_playercard"));
    expect(cards.map((c) => c.url)).toEqual([`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/${PARKER.leagueId}?view=kona_playercard`]);
    const cardFilter = JSON.parse(cards[0]?.opts.headers?.["x-fantasy-filter"] ?? "") as { players: { filterIds: { value: number[] }; filterStatsForTopScoringPeriodIds: unknown } };
    expect(new Set(cardFilter.players.filterIds.value)).toEqual(new Set(injured.map((p) => p.id)));
    expect(cardFilter.players.filterStatsForTopScoringPeriodIds).toEqual({ value: 17, additionalValue: ["002026", "102026"] });
    // Most serious first: injured reserve before questionable.
    const statusOf = new Map(injured.map((p) => [p.id, p.injuryStatus]));
    expect(statusOf.get(cardFilter.players.filterIds.value[0] as number)).toBe("INJURY_RESERVE");
    expect(urls.at(-1)).toBe("https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026?view=proTeamSchedules_wl");
    expect(r).toMatchObject({ leagueId: PARKER.leagueId, season: 2026, withCredentials: false, warnings: [] });
    expect(r.ownerKey).toBeUndefined();
    expect(r.raw.transactions).toHaveLength(4);
    expect(r.raw.freeAgents).toHaveLength(6);
    expect((r.raw.playerCards?.[0] as { players: unknown[] }).players).toHaveLength(injured.length);
  });

  it("asks for at most two batches of cards, most serious injuries first, and says when some are left out", async () => {
    type Entry = { playerPoolEntry: { player: { id: number; defaultPositionId: number; injuryStatus?: string } } };
    const entry = (id: number, injuryStatus?: string): Entry => ({ playerPoolEntry: { player: { id, defaultPositionId: 2, ...(injuryStatus ? { injuryStatus } : {}) } } });
    const league = { teams: [{ roster: { entries: [entry(5, "QUESTIONABLE"), entry(4, "OUT"), entry(3), entry(2, "INJURY_RESERVE"), entry(1, "DOUBTFUL"), entry(6, "SUSPENSION"), entry(7, "PATERNITY")] } }] };
    expect(injuredRosteredIds(league as never)).toEqual([2, 6, 4, 1, 5]);
    // Every rostered player hurt (over 80): two batches of 40, and a warning about the rest.
    const allOut = (url: string, opts: HttpRequestOptions) => {
      const res = parkerRoute(url, opts);
      if (!new URL(url).searchParams.getAll("view").includes("mSettings")) return res;
      const L = res.json as { teams: Array<{ roster: { entries: Entry[] } }> };
      for (const t of L.teams) for (const e of t.roster.entries) e.playerPoolEntry.player.injuryStatus = "OUT";
      return json(200, L);
    };
    const http = mockHttp(allOut);
    const r = await fetchEspnLeague({ leagueId: PARKER.leagueId, season: 2026 }, http, NOW);
    const cards = http.calls.filter((c) => c.url.includes("kona_playercard"));
    expect(cards).toHaveLength(2);
    for (const c of cards) expect(filterOf(c.opts).players?.filterIds?.value).toHaveLength(PLAYER_CARD_BATCH);
    expect(r.warnings.map((w) => w.code)).toEqual(["ESPN_PLAYER_CARDS_PARTIAL"]);
  });

  it("sends cookies only through the cookie option, caches private data under a credential hash, and pseudonymizes SWIDs in every league body", async () => {
    const http = mockHttp(parkerRoute);
    const r = await fetchEspnLeague({ leagueId: PARKER.leagueId, season: 2026, credentials: { espnS2: `espn_s2=${CREDS.espnS2}`, swid: "00000000-0000-4000-8000-000000000001" } }, http, NOW);
    const scope = credentialScope(CREDS.espnS2, PARKER.swid);
    for (const c of http.calls) {
      expect(c.url).not.toContain(CREDS.espnS2);
      expect(c.url).not.toContain("00000000-0000-4000-8000");
      expect(JSON.stringify(c.opts.headers ?? {})).not.toContain(CREDS.espnS2);
      expect(c.opts.cache?.key).not.toContain(CREDS.espnS2);
      expect(c.opts.cache?.key).not.toContain("00000000-0000-4000-8000");
      if (c.url.includes("/leagues/")) {
        expect(c.opts.cookie).toBe(`espn_s2=${CREDS.espnS2}; SWID=${PARKER.swid}`);
        expect(c.opts.cache?.key.startsWith(`espn:${scope}:`)).toBe(true);
        expect(c.opts.transformText).toBeTypeOf("function");
      } else {
        expect(c.opts.cookie).toBeUndefined();
        expect(c.opts.transformText).toBeUndefined();
      }
    }
    // The raw league body the normalizer gets carries pseudonyms, and my team is found by the cookie SWID's.
    expect(JSON.stringify(r.raw.league)).not.toMatch(/\{[0-9A-F]{8}-[0-9A-F]{4}-/i);
    expect(r.ownerKey).toBe(swidPseudonym(PARKER.swid));
    const pub = mockHttp(parkerRoute);
    await fetchEspnLeague({ leagueId: PARKER.leagueId, season: 2026 }, pub, NOW);
    for (const c of pub.calls) expect(c.opts.cookie).toBeUndefined();
    expect(pub.calls[0]?.opts.cache).toEqual({ key: `espn:public:2026:${PARKER.leagueId}:league`, ttlMs: TTL.league, retainMs: TTL.league });
  });

  it("keeps closed weeks' transactions for hours; Refresh lowers only the current league data to a minute, never retention or the NFL schedule", async () => {
    for (const refresh of [false, true]) {
      const http = mockHttp(parkerRoute);
      await fetchEspnLeague({ leagueId: PARKER.leagueId, season: 2026, refresh }, http, NOW);
      for (const c of http.calls) {
        const sp = c.url.includes("mTransactions2") ? Number(new URL(c.url).searchParams.get("scoringPeriodId")) : undefined;
        const closed = sp !== undefined && sp < 4 - 1; // periods 1–2 at week 4
        const expected = !c.url.includes("/leagues/") ? { ttlMs: TTL.nflSchedule } : closed ? { ttlMs: TTL.closedTransactions, retainMs: TTL.closedTransactions } : { ttlMs: refresh ? TTL.leagueRefresh : TTL.league, retainMs: TTL.league };
        expect({ url: c.url, ...c.opts.cache, key: undefined }).toEqual({ url: c.url, ...expected, key: undefined });
      }
    }
  });

  it("keeps going with warnings when transactions, free agents, player cards or the schedule fail", async () => {
    const http = mockHttp((url, opts) => (url.includes("mTransactions2") || url.includes("proTeamSchedules") ? json(503, {}) : url.includes("kona_player") ? html(200) : parkerRoute(url, opts)));
    const r = await fetchEspnLeague({ leagueId: PARKER.leagueId, season: 2026 }, http, NOW);
    expect(r.warnings.map((w) => w.code)).toEqual(["ESPN_TRANSACTIONS_UNAVAILABLE", "ESPN_FREE_AGENTS_UNAVAILABLE", "ESPN_PLAYER_CARDS_UNAVAILABLE", "ESPN_SCHEDULE_UNAVAILABLE"]);
    expect(r.raw.transactions).toEqual([]);
    expect(r.raw.playerCards).toEqual([]);
  });
});

describe("importEspnLeague", () => {
  it("fetches and normalizes a league into a LeagueSnapshot, finding my team from the cookie SWID", async () => {
    const { snapshot, notes } = await importEspnLeague({ leagueId: PARKER.leagueId, season: 2026, credentials: CREDS }, { http: mockHttp(parkerRoute), resolver: fakeResolver(), now: NOW });
    expect(snapshot).toMatchObject({ platform: "espn", leagueId: PARKER.leagueId, season: 2026, currentWeek: 4, myTeamId: PARKER.myTeamId });
    expect(snapshot.teams).toHaveLength(10);
    expect(snapshot.teams.find((t) => t.id === "3")?.ownerName).toBe("Owner 3");
    expect(snapshot.transactions).toHaveLength(Object.values(expectedTransactionTypes()).reduce((a, b) => a + b, 0));
    expect(snapshot.freeAgents.length).toBeGreaterThan(100);
    expect(snapshot.settings.tradeDeadline).toEqual({ date: "2026-12-02T17:00:00.000Z", week: 13 });
    expect(Object.values(snapshot.players).filter((p) => p.injuryReturnWeek !== undefined).length).toBeGreaterThan(15);
    expect(notes.length).toBeGreaterThan(0);
  });

  it("uses the team the user picked when there are no cookies", async () => {
    const { snapshot } = await importEspnLeague({ leagueId: PARKER.leagueId, season: 2026, myTeamId: "8" }, { http: mockHttp(parkerRoute), resolver: fakeResolver(), now: NOW });
    expect(snapshot.myTeamId).toBe("8");
  });
});

/** Advance fake timers (the client's per-host pacing) until the promise settles, letting real I/O callbacks run in between. */
async function drive<T>(p: Promise<T>): Promise<T> {
  let settled = false;
  void p.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let i = 0; i < 500 && !settled; i++) {
    await vi.advanceTimersByTimeAsync(1_000);
    await new Promise((r) => setImmediate(r));
  }
  return p;
}

describe("SWIDs never reach the server cache (review PRIV-1)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("an import through the real HttpClient and MemoryCache caches only pseudonyms, and my team and owner names still work", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const mine = PARKER.swid.slice(1, -1).toLowerCase(); // "00000000-0000-4000-8000-000000000001"
    type League = { members: Array<{ id: string }> };
    const memberGuids = readEspn<League>(LABELS.league).members.map((m) => m.id.slice(1, -1));
    expect(memberGuids.length).toBe(10);
    // ESPN writes SWIDs braced; add a bare and a %7B-encoded copy (lower case) to the league body too.
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const url = String(input);
      const res = parkerRoute(url, { headers: { "x-fantasy-filter": headers["x-fantasy-filter"] ?? "{}" } });
      const body = new URL(url).searchParams.getAll("view").includes("mSettings") ? { ...(res.json as object), fanLink: `https://fan.api.espn.com/apis/v2/fans/%7b${mine}%7d`, memberRef: mine } : res.json;
      return new Response(JSON.stringify(body), { status: res.status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const cache = new MemoryCache();
    const http = createHttpClient({ cache, fetchImpl, maxRetries: 0 });
    const { snapshot } = await drive(importEspnLeague({ leagueId: PARKER.leagueId, season: 2026, credentials: { espnS2: CREDS.espnS2, swid: mine } }, { http, resolver: fakeResolver(), now: NOW }));

    expect(snapshot.myTeamId).toBe(PARKER.myTeamId);
    expect(snapshot.teams.map((t) => t.ownerName)).toEqual(snapshot.teams.map((t) => `Owner ${t.id}`));
    expect(cache.keys().length).toBeGreaterThan(10);
    const cached = JSON.stringify(cache.values()).toLowerCase();
    for (const guid of [mine, ...memberGuids.map((g) => g.toLowerCase())]) {
      expect(cached).not.toContain(guid);
      expect(cached).not.toContain(`%7b${guid}`);
    }
    expect(cached).toContain(swidPseudonym(PARKER.swid).slice(1, -1).toLowerCase());
    expect(JSON.stringify(snapshot)).not.toMatch(/pseudo:|\{[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
});

describe("SWID pseudonyms", () => {
  const guid = "8f3c2a1b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

  it("are one-way, stable across case and form, and not SWID-shaped", () => {
    const p = swidPseudonym(`{${guid}}`);
    expect(p).toMatch(/^\{pseudo:[0-9a-f]{24}\}$/);
    expect(swidPseudonym(guid.toUpperCase())).toBe(p);
    expect(p).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it("replace braced, %7B-encoded and bare copies of a SWID, but leave other bare GUIDs (transaction ids) alone", () => {
    const tx = "326523f7-11ca-4b45-909c-52979e97640a";
    const text = JSON.stringify({ id: `{${guid.toUpperCase()}}`, owners: [`{${guid}}`], link: `x/%7B${guid}%7D`, bare: guid, txId: tx });
    const out = pseudonymizeSwids(text);
    const p = swidPseudonym(guid);
    expect(JSON.parse(out)).toEqual({ id: p, owners: [p], link: `x/${p}`, bare: p.slice(1, -1), txId: tx });
    // The cookie holder's SWID is replaced even where it only appears bare.
    expect(JSON.parse(pseudonymizeSwids(JSON.stringify({ bare: guid, txId: tx }), [`{${guid}}`]))).toEqual({ bare: p.slice(1, -1), txId: tx });
  });
});

describe("league input and season helpers", () => {
  it("takes a bare league ID only (links are parsed on the Connect page by src/lib/espnLink.ts)", () => {
    expect(requireEspnLeagueId(" 123456 ")).toBe("123456");
    expect(requireEspnLeagueId("https://fantasy.espn.com/football/team?leagueId=123456&teamId=4&seasonId=2026")).toBeNull();
    expect(requireEspnLeagueId("league 12")).toBeNull();
    expect(requireEspnLeagueId("12a")).toBeNull();
    expect(requireEspnLeagueId("1234567890123")).toBeNull();
  });

  it("knows which NFL season is in progress", () => {
    expect(currentNflSeason(new Date("2026-09-29T00:00:00Z"))).toBe(2026);
    expect(currentNflSeason(new Date("2027-01-20T00:00:00Z"))).toBe(2026);
    expect(currentNflSeason(new Date("2027-04-01T00:00:00Z"))).toBe(2027);
  });
});

describe("schema", () => {
  it("parses Parker's league with ESPN's per-team trade counters", () => {
    const L = LeagueSchema.parse(readEspn(LABELS.league));
    expect(L.teams.every((t) => typeof t.transactionCounter?.trades === "number")).toBe(true);
  });
});
