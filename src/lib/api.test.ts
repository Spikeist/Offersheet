import { describe, expect, it } from "vitest";
import type { LeagueSnapshot } from "@/engine/model";
import { callApi, chooseLeagueResponse, isApiError, isChooseLeague, isSignedModelResponse, readApiResponse } from "./api";
import { commissionerMessage, ESPN_PUBLIC_SETTING_PATH } from "./commissioner";
import { resetSentence } from "./errors";
import { IMPORT_FORMAT_VERSION, type StoredImport } from "./importStore";
import { SERVER_RETRY_CODES, importLeague, loadModelInputs, postGzipJson } from "./leagueFetch";

function fakeFetch(respond: () => Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return respond();
  };
  return { impl, calls };
}

describe("callApi", () => {
  it("posts JSON same-origin without caching, and returns the data", async () => {
    const f = fakeFetch(async () => Response.json({ connected: true, available: true }));
    const res = await callApi<{ connected: boolean }>("/api/session/espn", { method: "POST", body: { a: 1 } }, f.impl);
    expect(res).toEqual({ connected: true, available: true });
    expect(f.calls[0]?.init).toMatchObject({ method: "POST", body: '{"a":1}', credentials: "same-origin", cache: "no-store" });
    expect((f.calls[0]?.init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("passes API errors through and turns everything else into a plain error", async () => {
    const apiError = { error: { code: "LEAGUE_NOT_FOUND", message: "League not found for that season." } };
    expect(await callApi("/x", { method: "GET" }, fakeFetch(async () => Response.json(apiError, { status: 404 })).impl)).toEqual(apiError);

    const offline = await callApi("/x", { method: "GET" }, fakeFetch(async () => Promise.reject(new TypeError("Failed to fetch"))).impl);
    expect(isApiError(offline) && offline.error.message).toMatch(/couldn't reach Offer Sheet/);

    const html = await callApi("/x", { method: "GET" }, fakeFetch(async () => new Response("<html>502</html>", { status: 502 })).impl);
    expect(isApiError(html) && html.error.code).toBe("INTERNAL");

    const oddJson = await callApi("/x", { method: "GET" }, fakeFetch(async () => Response.json({ nope: true }, { status: 500 })).impl);
    expect(isApiError(oddJson) && oddJson.error.code).toBe("INTERNAL");
  });

  it("recognizes response shapes", () => {
    expect(isApiError({ error: { code: "X", message: "y" } })).toBe(true);
    expect(isApiError({ error: "x" })).toBe(false);
    expect(isChooseLeague({ chooseLeague: { username: "u", season: 2026, leagues: [] } })).toBe(true);
    expect(isChooseLeague({ snapshot: {} })).toBe(false);
    // The model routes' answer to a signed import (Part B, track BF): the inputs alone.
    expect(isSignedModelResponse({ model: { version: 1 }, signedImport: true })).toBe(true);
    expect(isSignedModelResponse({ model: { version: 2 }, signedImport: true })).toBe(false);
    expect(isSignedModelResponse({ import: {}, model: { version: 1 } })).toBe(false);
  });

  it("words a reply that isn't ours by its status (track RL's request): a firewall's 429 with its wait, a body too large, a timeout", async () => {
    const page = (status: number, headers: Record<string, string> = {}) => fakeFetch(async () => new Response("<html>nope</html>", { status, headers })).impl;
    expect(await callApi("/x", { method: "GET" }, page(429, { "retry-after": "120" }))).toEqual({ error: { code: "RATE_LIMITED", message: "You're going a bit fast. Try again in about 2 minutes." } });
    expect(await callApi("/x", { method: "POST", body: {} }, page(413))).toEqual({ error: { code: "INVALID_REQUEST", message: "That request is too large for Offer Sheet." } });
    expect(await callApi("/x", { method: "GET" }, page(504))).toMatchObject({ error: { code: "SOURCE_SLOW" } });
    // A 200 that isn't JSON is still ours to call unexpected.
    expect(await callApi("/x", { method: "GET" }, page(200))).toMatchObject({ error: { code: "INTERNAL" } });
  });
});

describe("a daily limit's answer says when it resets, in the visitor's own time (planner reply to Checkpoint 7a, §2 question 7)", () => {
  const RESET = "2026-10-06T00:00:00.000Z";
  const capacity = { error: { code: "BUSY", message: "The beta is at capacity today. It resets at 12:00 AM UTC.", resetAt: RESET } };
  const busy = (body: unknown = capacity) => async () => new Response(JSON.stringify(body), { status: 503, headers: { "content-type": "application/json", "retry-after": "10800" } });
  /** What this machine's browser would say (the tests run in the machine's own zone). */
  const local = (): string => resetSentence(Date.parse(RESET), { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, now: Date.now() });

  it("readApiResponse words it in the given zone, and keeps resetAt", async () => {
    const now = Date.UTC(2026, 9, 5, 21, 0, 0);
    const read = await readApiResponse(await busy()(), { timeZone: "America/Chicago", now });
    expect(read).toEqual({ error: { code: "BUSY", message: "The beta is at capacity today. It resets at 7:00 PM.", resetAt: RESET } });
    const share = { error: { code: "BUSY", message: "Your connection has used today's share of requests to ESPN. It resets at 12:00 AM UTC.", resetAt: RESET } };
    expect(await readApiResponse(await busy(share)(), { timeZone: "America/Los_Angeles", now })).toEqual({ error: { ...share.error, message: "Your connection has used today's share of requests to ESPN. It resets at 5:00 PM." } });
    // Any other answer is passed through as it came.
    const other = { error: { code: "LEAGUE_NOT_FOUND", message: "League not found for that season." } };
    expect(await readApiResponse(Response.json(other, { status: 404 }), { timeZone: "America/Chicago", now })).toEqual(other);
  });

  it("every page that shows the message gets it in place, never a broken page: Connect and the Import Report's Refresh (importLeague), the League page (loadModelInputs), an upload's answer (postGzipJson)", async () => {
    const expected = `The beta is at capacity today. ${local()}`;
    // Connect, and the Import Report's Refresh: the import's answer, an error the page shows like any other.
    const imported = await importLeague({ platform: "sleeper", body: { season: 2026, leagueId: "990001" }, deps: { fetchImpl: busy() as unknown as typeof fetch, browserReads: false } });
    expect(imported).toEqual({ error: { code: "BUSY", message: expected, resetAt: RESET } });
    // The League page: the model build's answer, in its error card (with Try again).
    const stored: StoredImport = {
      version: IMPORT_FORMAT_VERSION,
      savedAt: new Date().toISOString(),
      request: { platform: "sleeper", season: 2026, leagueId: "990001" },
      response: { snapshot: { platform: "sleeper", leagueId: "990001", season: 2026, fetchedAt: new Date().toISOString() } as unknown as LeagueSnapshot, notes: [] },
    };
    expect(await loadModelInputs(stored, { deps: { fetchImpl: busy() as unknown as typeof fetch, browserReads: false } })).toEqual({ ok: false, message: expected });
    // The browser path's upload: BUSY isn't one of the answers that send the page to the server path instead.
    const upload = await postGzipJson<unknown>("/api/import/sleeper", { v: 1 }, { fetchImpl: busy() as unknown as typeof fetch, gzip: async () => new Uint8Array(10) });
    expect(upload).toEqual({ error: { code: "BUSY", message: expected, resetAt: RESET } });
    expect(SERVER_RETRY_CODES.has("BUSY")).toBe(false);
  });
});

describe("chooseLeagueResponse (the league picker, from the server's lookup or the browser's)", () => {
  it("puts the supported leagues first, then by name, in the picker's shape", () => {
    const choices = [
      { leagueId: "3", name: "Zeta", teams: 18, status: "in_season", leagueType: "guillotine" as const, bestBall: false, supported: false },
      { leagueId: "2", name: "Beta", teams: 12, status: "in_season", supported: true },
      { leagueId: "1", name: "Alpha", teams: null, status: null, leagueType: "redraft" as const, bestBall: true, supported: true },
    ];
    expect(chooseLeagueResponse("zorblax_q", 2026, choices)).toEqual({
      chooseLeague: {
        username: "zorblax_q",
        season: 2026,
        leagues: [
          { id: "1", name: "Alpha", teams: null, status: null, leagueType: "redraft", bestBall: true, supported: true },
          { id: "2", name: "Beta", teams: 12, status: "in_season", leagueType: null, bestBall: false, supported: true },
          { id: "3", name: "Zeta", teams: 18, status: "in_season", leagueType: "guillotine", bestBall: false, supported: false },
        ],
      },
    });
  });
});

describe("commissionerMessage", () => {
  it("names the exact ESPN setting and says it doesn't let anyone join", () => {
    const m = commissionerMessage();
    expect(m).toContain("Make League Viewable to Public");
    expect(m).toContain("League → Settings → Basic Settings");
    expect(m).toMatch(/Nobody can join/);
    expect(ESPN_PUBLIC_SETTING_PATH).toContain("Basic Settings");
  });
});
