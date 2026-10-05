import { describe, expect, it } from "vitest";
import { callApi, chooseLeagueResponse, isApiError, isChooseLeague, isSignedModelResponse } from "./api";
import { commissionerMessage, ESPN_PUBLIC_SETTING_PATH } from "./commissioner";

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
