import { describe, expect, it } from "vitest";
import { callApi, isApiError, isChooseLeague } from "./api";
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
