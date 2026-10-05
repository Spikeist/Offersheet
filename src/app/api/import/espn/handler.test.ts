import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { LeagueImportError, type EspnImportRequest } from "@/adapters/types";
import { espnCredentialsFor, saveEspnCredentials } from "@/server/session";
import { fakeDeps, fakeResult, gzipRequest, jsonRequest } from "../../_lib/testFakes";
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
      return { result: await importLeague(req), espn: {} };
    },
    importUpload: async () => {
      throw new Error("no upload in these tests (upload.test.ts covers them)");
    },
    getDeps: async () => fakeDeps(),
    credentialsFor: (request, leagueId) => espnCredentialsFor(request, leagueId, env),
    sign: () => undefined,
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
    const dev = { NODE_ENV: "development", USE_ENV_COOKIES: "1", ESPN_LEAGUE_ID: "4242", ESPN_S2: CREDS.espnS2, ESPN_SWID: CREDS.swid };
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

describe("POST /api/import/espn with a league the browser read (Part B, track BF)", () => {
  const T = Date.UTC(2026, 8, 29, 23);
  const upload = (over: Record<string, unknown> = {}) => ({
    v: 1,
    platform: "espn",
    request: { leagueId: "4242", season: 2026 },
    sentAt: T,
    parts: [{ url: "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/4242?view=mSettings", status: 200, json: { members: [{ id: CREDS.swid }] }, at: T }],
    ...over,
  });
  const SIGNED = { issuedAt: T, token: "made-up-token" };

  function uploadSetup(env: Record<string, string> = ENV) {
    const uploads: unknown[] = [];
    const reads: EspnImportRequest[] = [];
    const handler = createEspnImportHandler({
      importLeague: async (req) => {
        reads.push(req);
        return { result: fakeResult({ name: "Read by the server" }), espn: {} };
      },
      importUpload: async (u) => {
        uploads.push(u);
        return { result: fakeResult(), espn: { "4046": { 4: 17.9 } } };
      },
      getDeps: async () => fakeDeps(),
      credentialsFor: (request, leagueId) => espnCredentialsFor(request, leagueId, env),
      sign: (platform, content) => (platform === "espn" && content.snapshot ? SIGNED : undefined),
      now: NOW,
    });
    return { handler, uploads, reads };
  }

  it("imports it by replaying the upload (its SWIDs pseudonymized first), says the browser read it, and signs the import with its model part", async () => {
    const { handler, uploads, reads } = uploadSetup();
    const res = await handler(gzipRequest(URL, upload()));
    expect(res.status).toBe(200);
    expect(reads).toHaveLength(0);
    expect(uploads).toHaveLength(1);
    expect(JSON.stringify(uploads[0])).not.toContain(CREDS.swid.slice(1, -1));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ snapshot: { name: "The Gloopdorf Invitational" }, usedEspnCookies: false, readBy: "browser", modelPart: { espn: { "4046": { 4: 17.9 } } }, signed: SIGNED });
  });

  it("reads the league itself while ESPN cookies are connected, whatever the browser sent", async () => {
    const saved = new Headers();
    await saveEspnCredentials(new Request(URL), saved, CREDS, ENV);
    const cookie = (saved.getSetCookie()[0] ?? "").split(";")[0] ?? "";
    const { handler, uploads, reads } = uploadSetup();
    const res = await handler(gzipRequest(URL, upload(), { cookie }));
    expect(uploads).toHaveLength(0);
    expect(reads).toEqual([{ leagueId: "4242", season: 2026, credentials: CREDS }]);
    expect(await res.json()).toMatchObject({ snapshot: { name: "Read by the server" }, usedEspnCookies: true, espnCookieSource: "session", readBy: "server" });
  });

  it("answers BAD_UPLOAD to a body it can't use (the browser then asks with JSON), and maps the replay's errors like any import's", async () => {
    const { handler, uploads } = uploadSetup();
    for (const bad of [upload({ v: 2 }), upload({ extra: true }), upload({ parts: [{ url: "https://evil.example/", status: 200, at: T }] }), "not json"]) {
      const res = await handler(gzipRequest(URL, bad));
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toEqual({ code: "BAD_UPLOAD", message: "Offer Sheet couldn't use the league data your browser read. Try again in a moment." });
    }
    expect(uploads).toHaveLength(0);
    expect((await errorOf(await handler(gzipRequest(URL, upload({ request: { leagueId: "4242", season: 2030 } }))))).message).toBe("Pick a season from 2018 to 2026.");
    const failing = createEspnImportHandler({
      importLeague: async () => ({ result: fakeResult(), espn: {} }),
      importUpload: async () => {
        throw new LeagueImportError("PRIVATE_LEAGUE", "private", { platform: "espn", status: 401 });
      },
      getDeps: async () => fakeDeps(),
      credentialsFor: (request, leagueId) => espnCredentialsFor(request, leagueId, ENV),
      sign: () => undefined,
      now: NOW,
    });
    const res = await failing(gzipRequest(URL, upload()));
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("PRIVATE_LEAGUE");
    const foreign = await handler(gzipRequest(URL, upload(), { origin: "https://evil.example" }));
    expect(foreign.status).toBe(403);
  });

  it("doesn't sign an import whose model build would cost more than any real league's: BAD_UPLOAD, and the browser asks the server (review BF-R1)", async () => {
    const rule = { kind: "stepped", stat: "pass_yd", every: 5, points: 0.2 } as const;
    const heavy = fakeResult({
      teams: [{ id: "1", roster: Array.from({ length: 1_000 }, (_, i) => String(i)), ir: [], taxi: [] }] as never,
      freeAgents: [],
      settings: { scoring: { perStat: {}, rules: Array.from({ length: 50 }, () => rule), unmapped: [] } } as never,
    });
    const signed: unknown[] = [];
    const handler = createEspnImportHandler({
      importLeague: async () => ({ result: fakeResult(), espn: {} }),
      importUpload: async () => ({ result: heavy, espn: {} }),
      getDeps: async () => fakeDeps(),
      credentialsFor: (request, leagueId) => espnCredentialsFor(request, leagueId, ENV),
      sign: (_platform, content) => (signed.push(content), SIGNED),
      now: NOW,
    });
    const res = await handler(gzipRequest(URL, upload()));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe("BAD_UPLOAD");
    expect(signed).toHaveLength(0);
  });
});
