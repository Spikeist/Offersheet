/**
 * The page's reads of a league (track BF; ./leagueFetch.ts): the browser path first where it applies (a gzip upload to the
 * import route), the server path when the browser can't read or the route can't use the upload, a platform's final
 * answers shown as the server would word them, a Sleeper username's leagues chosen in the browser; and the League page's
 * numbers: a fresh signed import sent back, a stale one read again first, a league read with cookies left to the server.
 * The platforms answer from the committed fixtures (src/adapters/test-platform.ts); our routes from a scripted fetch.
 * No network.
 */
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PARKER } from "@/adapters/espn/test-helpers";
import { loadTestLeague } from "@/adapters/sleeper/test-helpers";
import { AT, SLEEPER_USERNAME, espnAnswer, platform, sleeperAnswer, type Answer } from "@/adapters/test-platform";
import type { LeagueUpload } from "@/adapters/upload";
import { browserFetchLimits, uploadLimits } from "@/server/limits";
import { leagueFixture } from "@/components/league/testFixtures";
import type { ImportResponse, ModelResponse, SignedModelBody } from "./api";
import { createBrowserHttpClient } from "./browserHttp";
import { IMPORT_FORMAT_VERSION, type StoredImport } from "./importStore";
import { MODEL_UNREADABLE, canGzip, importLeague, loadModelInputs, postGzipJson, type LeagueFetchDeps } from "./leagueFetch";
import { untilNoAnswer } from "./leagueRead";

interface RouteCall {
  url: string;
  init: RequestInit;
  /** The body: JSON as sent, or the gzip body unpacked and parsed. */
  body: unknown;
  gzip: boolean;
}

/** Our routes, scripted: `answer` per call (its URL and body), each call recorded. */
function routes(answer: (url: string, body: unknown, gzip: boolean) => { status?: number; body: unknown }) {
  const calls: RouteCall[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const gzip = (init.headers as Record<string, string> | undefined)?.["Content-Type"] === "application/gzip";
    const body = gzip ? (JSON.parse(gunzipSync(init.body as Uint8Array).toString("utf8")) as unknown) : init.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown);
    calls.push({ url, init, body, gzip });
    const a = answer(url, body, gzip);
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

/** An import of Parker's league as the routes answer it (a made-up league's snapshot under his placeholder id). */
const SNAPSHOT = { ...leagueFixture().snapshot, platform: "espn" as const, leagueId: PARKER.leagueId, season: 2026 };
const imported = (over: Partial<ImportResponse> = {}): ImportResponse => ({ snapshot: SNAPSHOT, notes: [], ...over });

const deps = (fetchImpl: typeof fetch, http = platform(espnAnswer()), over: Partial<LeagueFetchDeps> = {}): LeagueFetchDeps => ({ fetchImpl, platformHttp: http, clock: () => AT, browserReads: true, ...over });

describe("importLeague: ESPN", () => {
  it("reads a public league in the browser and posts it, gzipped, to the import route; the route's import is the answer", async () => {
    const answer = imported({ readBy: "browser" });
    const r = routes(() => ({ body: answer }));
    const http = platform(espnAnswer());
    const got = await importLeague({ platform: "espn", body: { leagueId: PARKER.leagueId, season: 2026 }, espnCookies: "none", deps: deps(r.fetchImpl, http) });
    expect(got).toEqual(answer);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toMatchObject({ url: "/api/import/espn", gzip: true });
    expect(r.calls[0]?.init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store" });
    const upload = r.calls[0]?.body as LeagueUpload;
    expect(upload).toMatchObject({ v: 1, platform: "espn", request: { leagueId: PARKER.leagueId, season: 2026 }, sentAt: AT });
    expect(upload.parts.length).toBe(http.calls.length);
    expect(http.calls.some((u) => u.includes("proTeamSchedules"))).toBe(false);
  });

  it("asks the server instead when the browser can't read ESPN (a CORS refusal, an outage), or the route can't use the upload", async () => {
    for (const fail of [{ status: 0 }, { status: 503, html: true }, { status: 200, body: { not: "a league" } }] as Answer[]) {
      const r = routes(() => ({ body: imported() }));
      const http = platform(espnAnswer((url) => (url.includes("mSettings") ? fail : null)));
      await importLeague({ platform: "espn", body: { leagueId: PARKER.leagueId, season: 2026 }, deps: deps(r.fetchImpl, http) });
      expect(r.calls.map((c) => [c.url, c.gzip, c.body])).toEqual([["/api/import/espn", false, { leagueId: PARKER.leagueId, season: 2026 }]]);
    }
    for (const code of ["BAD_UPLOAD", "INVALID_REQUEST", "INTERNAL"]) {
      const r = routes((_url, _body, gzip) => (gzip ? { status: 400, body: { error: { code, message: "no" } } } : { body: imported() }));
      expect(await importLeague({ platform: "espn", body: { leagueId: PARKER.leagueId, season: 2026 }, deps: deps(r.fetchImpl) })).toEqual(imported());
      expect(r.calls.map((c) => c.gzip)).toEqual([true, false]);
    }
    // An upload over the route's cap isn't sent at all.
    const r = routes(() => ({ body: imported() }));
    await importLeague({ platform: "espn", body: { leagueId: PARKER.leagueId, season: 2026 }, deps: deps(r.fetchImpl, undefined, { gzip: async () => new Uint8Array(uploadLimits.compressedBytes + 1) }) });
    expect(r.calls.map((c) => c.gzip)).toEqual([false]);
  });

  it("asks the server when part of the league got no answer in the browser, even a part the adapter could do without (review BF-R3)", async () => {
    // The preflighted views (free agents, transactions, cards) blocked or dropped; the league view itself answered.
    const r = routes(() => ({ body: imported() }));
    const http = platform(espnAnswer((url) => (url.includes("kona_") || url.includes("mTransactions2") ? { status: 0 } : null)));
    expect(await importLeague({ platform: "espn", body: { leagueId: PARKER.leagueId, season: 2026 }, espnCookies: "none", deps: deps(r.fetchImpl, http) })).toEqual(imported());
    expect(r.calls.map((c) => [c.url, c.gzip, c.body])).toEqual([["/api/import/espn", false, { leagueId: PARKER.leagueId, season: 2026 }]]);
    // ESPN's own answer to such a request (a 503) is an answer: the upload goes, and the server words the gap as it would.
    const answered = routes(() => ({ body: imported() }));
    const failing = platform(espnAnswer((url) => (url.includes("mTransactions2") && url.includes("scoringPeriodId=2") ? { status: 503 } : null)));
    await importLeague({ platform: "espn", body: { leagueId: PARKER.leagueId, season: 2026 }, espnCookies: "none", deps: deps(answered.fetchImpl, failing) });
    expect(answered.calls.map((c) => c.gzip)).toEqual([true]);
  });

  it("stops asking ESPN at the first request that got no answer, so the server is asked at once (review E2E-2)", async () => {
    // ESPN refuses the preflighted views (a CORS refusal looks like no answer); the league view itself answers.
    const blocked = (url: string) => url.includes("kona_") || url.includes("mTransactions2");
    const r = routes(() => ({ body: imported() }));
    const http = platform(espnAnswer((url) => (blocked(url) ? { status: 0 } : null)));
    expect(await importLeague({ platform: "espn", body: { leagueId: PARKER.leagueId, season: 2026 }, espnCookies: "none", deps: deps(r.fetchImpl, http) })).toEqual(imported());
    // The league view, then the first transactions period, and nothing after it: the read falls back as before, at once.
    expect(http.calls).toHaveLength(2);
    expect(http.calls.filter(blocked)).toHaveLength(1);
    expect(r.calls.map((c) => [c.url, c.gzip])).toEqual([["/api/import/espn", false]]);
  });

  it("with the browser's own client: one request's retries, not every request's, before the server is asked (review E2E-2)", async () => {
    const espn = espnAnswer();
    const clock = { now: AT };
    const sleeps: number[] = [];
    const asked: string[] = [];
    // A CORS refusal of every request carrying ESPN's filter header (the preflight fails); the plain league view passes.
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      asked.push(url);
      if (headers["x-fantasy-filter"] !== undefined) throw new TypeError("Failed to fetch");
      const a = espn(url, headers);
      return new Response(JSON.stringify(a ? a.body : { details: [{ type: "GENERAL_NOT_FOUND" }] }), { status: a ? (a.status ?? 200) : 404, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const http = createBrowserHttpClient({
      fetchImpl,
      clock: () => clock.now,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock.now += ms;
      },
      random: () => 0,
    });
    const r = routes(() => ({ body: imported() }));
    expect(await importLeague({ platform: "espn", body: { leagueId: PARKER.leagueId, season: 2026 }, espnCookies: "none", deps: deps(r.fetchImpl, undefined, { platformHttp: http }) })).toEqual(imported());
    // The league view once, the first filtered view with its retries, then nothing more.
    expect(asked).toHaveLength(1 + 1 + browserFetchLimits.retries);
    expect(new Set(asked.slice(1)).size).toBe(1);
    const backoff = Array.from({ length: browserFetchLimits.retries }, (_, n) => browserFetchLimits.backoffMs * 2 ** n);
    expect(sleeps.filter((s) => s >= browserFetchLimits.backoffMs)).toEqual(backoff);
    expect(r.calls.map((c) => [c.url, c.gzip])).toEqual([["/api/import/espn", false]]);
  });

  it("shows a private league's answer as the server words it when no cookies are connected; asks the server when they may be", async () => {
    const http = () => platform(espnAnswer((url) => (url.includes("mSettings") ? { status: 401, body: { messages: ["not authorized"] } } : null)));
    const none = routes(() => ({ body: imported() }));
    const got = await importLeague({ platform: "espn", body: { leagueId: PARKER.leagueId, season: 2026 }, espnCookies: "none", deps: deps(none.fetchImpl, http()) });
    expect(got).toEqual({ error: { code: "PRIVATE_LEAGUE", message: "This ESPN league is private, so ESPN only shares it with a login. (ESPN answers the same way if the league hasn't been renewed for 2026 yet.)" } });
    expect(none.calls).toHaveLength(0);
    const unknown = routes(() => ({ body: imported() }));
    await importLeague({ platform: "espn", body: { leagueId: PARKER.leagueId, season: 2026 }, espnCookies: "unknown", deps: deps(unknown.fetchImpl, http()) });
    expect(unknown.calls.map((c) => c.gzip)).toEqual([false]);
  });

  it("leaves the league to the server while ESPN cookies are connected, and everything to it with browser reading off", async () => {
    for (const [cookies, browserReads] of [["connected", true], ["none", false]] as const) {
      const r = routes(() => ({ body: imported() }));
      const http = platform(espnAnswer());
      await importLeague({ platform: "espn", body: { leagueId: PARKER.leagueId, season: 2026, refresh: true }, espnCookies: cookies, deps: deps(r.fetchImpl, http, { browserReads }) });
      expect(http.calls).toHaveLength(0);
      expect(r.calls.map((c) => [c.gzip, c.body])).toEqual([[false, { leagueId: PARKER.leagueId, season: 2026, refresh: true }]]);
    }
  });

  it("stops when the page that asked is gone", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("left", "AbortError"));
    const r = routes(() => ({ body: imported() }));
    await expect(importLeague({ platform: "espn", body: { leagueId: PARKER.leagueId, season: 2026 }, signal: controller.signal, deps: deps(r.fetchImpl) })).rejects.toMatchObject({ name: "AbortError" });
    expect(r.calls).toHaveLength(0);
  });
});

describe("importLeague: Sleeper", () => {
  it("offers a username's leagues itself, without asking our server, and posts the one picked (by its ID) with the username", async () => {
    const t = loadTestLeague();
    const other = { ...t.league, league_id: "999999999999999999", name: "Another League" };
    const r = routes(() => ({ body: imported() }));
    const choose = await importLeague({ platform: "sleeper", body: { season: 2026, username: SLEEPER_USERNAME }, deps: deps(r.fetchImpl, platform(sleeperAnswer(t, { leagues: [t.league, other] }))) });
    expect(choose).toMatchObject({ chooseLeague: { username: SLEEPER_USERNAME, season: 2026 } });
    expect(r.calls).toHaveLength(0);
    const http = platform(sleeperAnswer(t, { leagues: [t.league, other] }));
    await importLeague({ platform: "sleeper", body: { season: 2026, username: SLEEPER_USERNAME, chooseLeagueId: String(t.league.league_id) }, deps: deps(r.fetchImpl, http) });
    const upload = r.calls[0]?.body as LeagueUpload;
    expect(upload.request).toEqual({ leagueId: String(t.league.league_id), season: 2026, username: SLEEPER_USERNAME });
    // Picked by its ID: the username's list isn't asked again, and never sent.
    expect(http.calls.some((u) => u.includes("/leagues/nfl/"))).toBe(false);
    expect(JSON.stringify(upload)).not.toContain("Another League");
  });

  it("asks the server when a week's matchups got no answer in the browser (review BF-R3: the league would arrive without its schedule)", async () => {
    const t = loadTestLeague();
    const r = routes(() => ({ body: imported() }));
    const http = platform(sleeperAnswer(t, { fail: (url) => (url.includes("/matchups/") ? { status: 0 } : null) }));
    await importLeague({ platform: "sleeper", body: { season: 2026, leagueId: String(t.league.league_id) }, deps: deps(r.fetchImpl, http) });
    expect(r.calls.map((c) => [c.url, c.gzip, c.body])).toEqual([["/api/import/sleeper", false, { season: 2026, leagueId: String(t.league.league_id) }]]);
    // Review E2E-2: the matchups, transactions, picks and drafts are asked all at once, yet nothing goes out after the
    // first request that got no answer (they wait their turn, as in the browser's own client).
    const first = http.calls.findIndex((u) => u.includes("/matchups/"));
    expect(first).toBeGreaterThan(0);
    expect(http.calls.slice(first + 1)).toEqual([]);
  });

  it("shows Sleeper's own final answers (no such user) as the server words them", async () => {
    const t = loadTestLeague();
    const r = routes(() => ({ body: imported() }));
    const got = await importLeague({ platform: "sleeper", body: { season: 2026, username: "nobody_here" }, deps: deps(r.fetchImpl, platform(sleeperAnswer(t))) });
    expect(got).toMatchObject({ error: { code: "USER_NOT_FOUND" } });
    expect(r.calls).toHaveLength(0);
  });
});

describe("untilNoAnswer (review E2E-2)", () => {
  /** A client answering each URL by `status` (200 by default), recording the order asked and how many were in flight at once. */
  function scriptedClient(status: (url: string) => number | Error) {
    const asked: string[] = [];
    let inFlight = 0;
    let most = 0;
    const client = {
      async get(url: string) {
        asked.push(url);
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight--;
        const s = status(url);
        if (s instanceof Error) throw s;
        return { status: s, ok: s >= 200 && s < 300, isHtml: false, json: s === 0 ? undefined : { url }, text: "", fromCache: false };
      },
    };
    return { client, asked, most: () => most };
  }

  it("asks one request at a time, in the order asked, and answers every request after a no-answer itself", async () => {
    const s = scriptedClient((url) => (url === "b" ? 0 : 200));
    const http = untilNoAnswer(s.client);
    const got = await Promise.all(["a", "b", "c", "d"].map((u) => http.get(u)));
    expect(got.map((r) => r.status)).toEqual([200, 0, 0, 0]);
    expect(s.asked).toEqual(["a", "b"]);
    expect(s.most()).toBe(1);
    expect(got[3]).toEqual({ status: 0, ok: false, isHtml: false, json: undefined, text: "", fromCache: false });
  });

  it("lets a platform's own answer (a 404, a 503) through without stopping, and a rejection (the page left) reaches only its caller", async () => {
    const left = new DOMException("left", "AbortError");
    const s = scriptedClient((url) => (url === "gone" ? left : url === "missing" ? 404 : url === "down" ? 503 : 200));
    const http = untilNoAnswer(s.client);
    expect((await http.get("missing")).status).toBe(404);
    expect((await http.get("down")).status).toBe(503);
    await expect(http.get("gone")).rejects.toBe(left);
    expect((await http.get("after")).status).toBe(200);
    // A cache-only request answered "no answer" (the browser's client asks no one for it) stops nothing.
    const c = scriptedClient((url) => (url === "cached" ? 0 : 200));
    const h = untilNoAnswer(c.client);
    expect((await h.get("cached", { cacheOnly: true })).status).toBe(0);
    expect((await h.get("next")).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------
// The League page's numbers

describe("a browser that can't gzip (review E2E-1)", () => {
  const f = leagueFixture();
  const model = f.inputs;
  const at = (minutesAgo: number) => new Date(AT - minutesAgo * 60_000).toISOString();
  const stored = (minutesAgo: number): StoredImport => ({
    version: IMPORT_FORMAT_VERSION,
    savedAt: at(minutesAgo),
    request: { platform: "espn", season: 2026, leagueId: PARKER.leagueId },
    response: { ...imported({ signed: { issuedAt: AT - minutesAgo * 60_000, token: "made-up" }, modelPart: {} }), snapshot: { ...SNAPSHOT, fetchedAt: at(minutesAgo) } },
  });

  /** Runs `body` as a browser without CompressionStream would (Safari before 16.4, Firefox before 113). */
  async function withoutCompressionStream(body: () => Promise<void>): Promise<void> {
    const saved = globalThis.CompressionStream;
    Reflect.deleteProperty(globalThis, "CompressionStream");
    try {
      expect(canGzip()).toBe(false);
      await body();
    } finally {
      globalThis.CompressionStream = saved;
    }
  }

  it("gets the League page's numbers with today's JSON request, a fresh signed import and a stale one alike (they threw before)", async () => {
    await withoutCompressionStream(async () => {
      for (const minutesAgo of [2, browserFetchLimits.reimportAfterMs / 60_000 + 5]) {
        const answer: ModelResponse = { import: stored(minutesAgo).response, model };
        const r = routes(() => ({ body: answer }));
        const http = platform(espnAnswer());
        const out = await loadModelInputs(stored(minutesAgo), { deps: { fetchImpl: r.fetchImpl, platformHttp: http, clock: () => AT, browserReads: true } });
        expect(out).toEqual({ ok: true, response: answer });
        expect(r.calls.map((c) => [c.url, c.gzip, c.body])).toEqual([["/api/model/espn", false, { leagueId: PARKER.leagueId, season: 2026 }]]);
        expect(http.calls).toHaveLength(0);
      }
      // Its imports take the server's path (JSON), as designed.
      const r = routes(() => ({ body: imported() }));
      await importLeague({ platform: "espn", body: { leagueId: PARKER.leagueId, season: 2026 }, espnCookies: "none", deps: { fetchImpl: r.fetchImpl, platformHttp: platform(espnAnswer()), clock: () => AT, browserReads: true } });
      expect(r.calls.map((c) => [c.url, c.gzip])).toEqual([["/api/import/espn", false]]);
    });
  });

  it("a gzip that fails sends nothing (not-sent): the import and the League page ask with today's JSON request instead", async () => {
    const failing = async (): Promise<Uint8Array<ArrayBuffer>> => {
      throw new TypeError("CompressionStream is not defined");
    };
    const posted = routes(() => ({ body: imported() }));
    expect(await postGzipJson("/api/import/espn", { any: "thing" }, { fetchImpl: posted.fetchImpl, gzip: failing })).toBe("not-sent");
    expect(posted.calls).toHaveLength(0);
    // The import: read in the browser, then the server's path when the upload can't be packed.
    const r = routes(() => ({ body: imported() }));
    expect(await importLeague({ platform: "espn", body: { leagueId: PARKER.leagueId, season: 2026 }, espnCookies: "none", deps: deps(r.fetchImpl, platform(espnAnswer()), { gzip: failing }) })).toEqual(imported());
    expect(r.calls.map((c) => [c.url, c.gzip])).toEqual([["/api/import/espn", false]]);
    // The League page: a fresh signed import that can't be packed goes as today's request.
    const answer: ModelResponse = { import: stored(2).response, model };
    const m = routes(() => ({ body: answer }));
    expect(await loadModelInputs(stored(2), { deps: deps(m.fetchImpl, platform(espnAnswer()), { gzip: failing }) })).toEqual({ ok: true, response: answer });
    expect(m.calls.map((c) => [c.url, c.gzip])).toEqual([["/api/model/espn", false]]);
  });
});

describe("loadModelInputs", () => {
  const f = leagueFixture();
  const model = f.inputs;
  const minutesAgo = (m: number) => new Date(AT - m * 60_000).toISOString();
  const storedWith = (over: Partial<ImportResponse>, fetchedAt: string): StoredImport => ({
    version: IMPORT_FORMAT_VERSION,
    savedAt: fetchedAt,
    request: { platform: "espn", season: 2026, leagueId: PARKER.leagueId },
    response: { ...imported(), ...over, snapshot: { ...imported().snapshot, fetchedAt } },
  });
  const SIGNED = { issuedAt: AT - 60_000, token: "made-up" };

  it("sends a fresh, signed import back (gzip) and keeps it: the route builds the numbers without reading the league", async () => {
    const stored = storedWith({ signed: SIGNED, modelPart: { espn: { "4046": { 4: 17.9 } } } }, minutesAgo(2));
    const r = routes(() => ({ body: { model, signedImport: true } }));
    const http = platform(espnAnswer());
    const out = await loadModelInputs(stored, { deps: deps(r.fetchImpl, http) });
    expect(out).toEqual({ ok: true, response: { import: stored.response, model } });
    expect(http.calls).toHaveLength(0);
    expect(r.calls).toHaveLength(1);
    const body = r.calls[0]?.body as SignedModelBody;
    expect(r.calls[0]).toMatchObject({ url: "/api/model/espn", gzip: true });
    expect(body).toEqual(JSON.parse(JSON.stringify({ v: 1, leagueId: PARKER.leagueId, season: 2026, import: { snapshot: stored.response.snapshot, modelPart: stored.response.modelPart }, signed: SIGNED })));
  });

  it("reads a stale league again first (the browser path), then sends the new signed import; Refresh does the same", async () => {
    for (const [fetchedAt, refresh] of [[minutesAgo(browserFetchLimits.reimportAfterMs / 60_000 + 1), false], [minutesAgo(2), true]] as const) {
      const stored = storedWith({ signed: SIGNED }, fetchedAt);
      const fresh = imported({ signed: { issuedAt: AT, token: "new" }, modelPart: {}, readBy: "browser" });
      const r = routes((url) => (url === "/api/import/espn" ? { body: fresh } : { body: { model, signedImport: true } }));
      const out = await loadModelInputs(stored, { refresh, deps: deps(r.fetchImpl) });
      expect(out).toEqual({ ok: true, response: { import: fresh, model } });
      expect(r.calls.map((c) => [c.url, c.gzip])).toEqual([
        ["/api/import/espn", true],
        ["/api/model/espn", true],
      ]);
      expect((r.calls[1]?.body as SignedModelBody).signed).toEqual({ issuedAt: AT, token: "new" });
    }
  });

  it("leaves it to the server (today's request) for an unsigned fresh import, a league read with cookies, or when the route can't use the signed one", async () => {
    const answer: ModelResponse = { import: imported({ signed: SIGNED }), model };
    for (const stored of [storedWith({}, minutesAgo(2)), storedWith({ usedEspnCookies: true, signed: SIGNED }, minutesAgo(30))]) {
      const r = routes(() => ({ body: answer }));
      expect(await loadModelInputs(stored, { deps: deps(r.fetchImpl) })).toEqual({ ok: true, response: answer });
      expect(r.calls.map((c) => [c.url, c.gzip, c.body])).toEqual([["/api/model/espn", false, { leagueId: PARKER.leagueId, season: 2026 }]]);
    }
    const r = routes((_url, _body, gzip) => (gzip ? { status: 400, body: { error: { code: "BAD_UPLOAD", message: "no" } } } : { body: answer }));
    expect(await loadModelInputs(storedWith({ signed: SIGNED }, minutesAgo(2)), { deps: deps(r.fetchImpl) })).toEqual({ ok: true, response: answer });
    expect(r.calls.map((c) => c.gzip)).toEqual([true, false]);
    // Another league's answer is never taken for this one.
    const wrong = routes(() => ({ body: { import: imported({ snapshot: { ...imported().snapshot, leagueId: "5151" } }), model } }));
    expect(await loadModelInputs(storedWith({}, minutesAgo(2)), { deps: deps(wrong.fetchImpl) })).toEqual({ ok: false, message: MODEL_UNREADABLE });
  });
});
