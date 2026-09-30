import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { LeagueImportError, type EspnImportRequest } from "@/adapters/types";
import { espnCredentialsFor, saveEspnCredentials } from "@/server/session";
import { fakeDeps, fakeResult, jsonRequest } from "../../_lib/testFakes";
import { createEspnImportHandler } from "./handler";

const URL = "http://localhost:3000/api/import/espn";
const NOW = () => new Date("2026-09-29T23:00:00.000Z");
// Fake credentials only.
const SECRET = "unit-test-secret-that-is-at-least-32-chars!!";
const ENV = { SESSION_SECRET: SECRET, NODE_ENV: "test" };
const CREDS = { espnS2: `AEBfakeTOKEN${"e".repeat(70)}%3D`, swid: "{00000000-0000-4000-8000-000000000000}" };

function setup(importLeague: (req: EspnImportRequest) => Promise<ReturnType<typeof fakeResult>> = async () => fakeResult(), env: Record<string, string> = ENV) {
  const calls: EspnImportRequest[] = [];
  const handler = createEspnImportHandler({
    importLeague: async (req) => {
      calls.push(req);
      return importLeague(req);
    },
    getDeps: async () => fakeDeps(),
    credentialsFor: (request, leagueId) => espnCredentialsFor(request, leagueId, env),
    now: NOW,
  });
  return { handler, calls };
}

async function errorOf(res: Response): Promise<{ code: string; message: string }> {
  return ((await res.json()) as { error: { code: string; message: string } }).error;
}

describe("POST /api/import/espn", () => {
  it("imports a public league without cookies and adds the Import Report extras", async () => {
    const { handler, calls } = setup();
    const res = await handler(jsonRequest(URL, { leagueId: " 4242 ", season: 2026, myTeamId: "3" }));
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ leagueId: "4242", season: 2026, myTeamId: "3" }]);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ snapshot: { name: "The Gloopdorf Invitational" }, notes: [], usedEspnCookies: false, dataSources: [{ name: "Sleeper players" }] });
    expect(body).not.toHaveProperty("espnCookieSource");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("passes the Import Report's Refresh through to the adapter", async () => {
    const { handler, calls } = setup();
    await handler(jsonRequest(URL, { leagueId: "4242", season: 2026, refresh: true }));
    await handler(jsonRequest(URL, { leagueId: "4242", season: 2026, refresh: false }));
    expect(calls).toEqual([{ leagueId: "4242", season: 2026, refresh: true }, { leagueId: "4242", season: 2026 }]);
    const bad = await handler(jsonRequest(URL, { leagueId: "4242", season: 2026, refresh: "yes" }));
    expect(bad.status).toBe(400);
  });

  it("sends the session's ESPN cookies to the adapter and never returns them", async () => {
    const saved = new Headers();
    await saveEspnCredentials(new Request(URL), saved, CREDS, ENV);
    const cookie = (saved.getSetCookie()[0] ?? "").split(";")[0] ?? "";
    const { handler, calls } = setup();
    const res = await handler(jsonRequest(URL, { leagueId: "4242", season: 2026 }, { cookie }));
    expect(res.status).toBe(200);
    expect(calls[0]?.credentials).toEqual(CREDS);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ usedEspnCookies: true, espnCookieSource: "session" });
    expect(text).not.toContain(CREDS.espnS2);
    expect(text).not.toContain(CREDS.swid.slice(1, -1));
  });

  it("says when the cookies came from .env.local (development only), never the values", async () => {
    const dev = { NODE_ENV: "development", ESPN_LEAGUE_ID: "4242", ESPN_S2: CREDS.espnS2, ESPN_SWID: CREDS.swid };
    const { handler, calls } = setup(undefined, dev);
    const res = await handler(jsonRequest(URL, { leagueId: "4242", season: 2026 }));
    expect(calls[0]?.credentials).toEqual(CREDS);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ usedEspnCookies: true, espnCookieSource: "dev-env" });
    expect(text).not.toContain(CREDS.espnS2);
    expect(text).not.toContain(CREDS.swid.slice(1, -1));
    // Any other league gets no cookies.
    const other = (await (await handler(jsonRequest(URL, { leagueId: "4243", season: 2026 }))).json()) as Record<string, unknown>;
    expect(other).toMatchObject({ usedEspnCookies: false });
    expect(other).not.toHaveProperty("espnCookieSource");
  });

  it("removes the user's own SWID from the response in any form, bare included", async () => {
    const bare = CREDS.swid.slice(1, -1).toUpperCase();
    const saved = new Headers();
    await saveEspnCredentials(new Request(URL), saved, CREDS, ENV);
    const cookie = (saved.getSetCookie()[0] ?? "").split(";")[0] ?? "";
    const { handler } = setup(async () => fakeResult({ name: `League of ${bare}` }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const text = await (await handler(jsonRequest(URL, { leagueId: "4242", season: 2026 }, { cookie }))).text();
    expect(text.toLowerCase()).not.toContain(bare.toLowerCase());
    expect(text).toContain("League of {SWID}");
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("replaces SWID-shaped values that slip into the adapter's output", async () => {
    const { handler } = setup(async () => fakeResult({ name: "League of {00000000-0000-4000-8000-000000000042}" }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handler(jsonRequest(URL, { leagueId: "4242", season: 2026 }));
    const text = await res.text();
    expect(text).not.toContain("00000000-0000-4000-8000-000000000042");
    expect(text).toContain("League of {SWID}");
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).not.toContain("000000000042");
  });

  it.each([
    ["LEAGUE_NOT_FOUND", 404, "League not found for that season."],
    ["PRIVATE_LEAGUE", 403, "This ESPN league is private, so ESPN only shares it with a login."],
    ["BAD_CREDENTIALS", 401, "ESPN didn't accept your cookies."],
    ["NOT_ACTIVATED", 409, "hasn't been activated"],
    ["SOURCE_DOWN", 502, "ESPN isn't responding right now."],
  ] as const)("maps %s to HTTP %i with a plain message", async (code, status, message) => {
    const { handler } = setup(async () => {
      throw new LeagueImportError(code, `internal detail for ${code}`, { platform: "espn", status: 500 });
    });
    const res = await handler(jsonRequest(URL, { leagueId: "4242", season: 2026 }));
    expect(res.status).toBe(status);
    const err = await errorOf(res);
    expect(err.code).toBe(code);
    expect(err.message).toContain(message);
    expect(err.message).not.toContain("internal detail");
  });

  it("forwards the adapter's own words for unsupported leagues and bad responses, redacted", async () => {
    const unsupported = setup(async () => {
      throw new LeagueImportError("UNSUPPORTED_LEAGUE", "This kind of league isn't supported yet.");
    });
    expect(await errorOf(await unsupported.handler(jsonRequest(URL, { leagueId: "4242", season: 2026 })))).toEqual({ code: "UNSUPPORTED_LEAGUE", message: "This kind of league isn't supported yet." });

    const bad = setup(async () => {
      throw new LeagueImportError("BAD_RESPONSE", "Missing required field at teams[0].owners[0] ({00000000-0000-4000-8000-000000000000})", { path: "teams[0].owners[0]" });
    });
    const err = await errorOf(await bad.handler(jsonRequest(URL, { leagueId: "4242", season: 2026 })));
    expect(err.code).toBe("BAD_RESPONSE");
    expect(err.message).toContain("teams[0].owners[0]");
    expect(err.message).not.toContain("00000000-0000-4000-8000-000000000000");
  });

  it("hides unexpected errors behind a generic message", async () => {
    const { handler } = setup(async () => {
      throw new TypeError(`boom with ${CREDS.espnS2}`);
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handler(jsonRequest(URL, { leagueId: "4242", season: 2026 }));
    expect(res.status).toBe(500);
    expect(await errorOf(res)).toEqual({ code: "INTERNAL", message: "Something went wrong on our side. Please try again." });
    expect(errors.mock.calls.flat().join(" ")).not.toContain(CREDS.espnS2);
  });

  it("validates the request before calling ESPN", async () => {
    const { handler, calls } = setup();
    const badId = await handler(jsonRequest(URL, { leagueId: "https://fantasy.espn.com/football/league?leagueId=1", season: 2026 }));
    expect(badId.status).toBe(400);
    expect((await errorOf(badId)).message).toMatch(/league ID/);
    const badSeason = await handler(jsonRequest(URL, { leagueId: "4242", season: 1999 }));
    expect((await errorOf(badSeason)).message).toBe("Pick a season from 2018 to 2026.");
    // The message names exactly the range that's accepted: next season isn't, until January.
    const nextSeason = await handler(jsonRequest(URL, { leagueId: "4242", season: 2027 }));
    expect((await errorOf(nextSeason)).message).toBe("Pick a season from 2018 to 2026.");
    const noSeason = await handler(jsonRequest(URL, { leagueId: "4242" }));
    expect(noSeason.status).toBe(400);
    const foreign = await handler(jsonRequest(URL, { leagueId: "4242", season: 2026 }, { origin: "https://evil.example" }));
    expect(foreign.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});
