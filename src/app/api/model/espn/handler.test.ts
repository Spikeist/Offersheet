import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { EspnModelImport } from "@/adapters/espn";
import { LeagueImportError, type EspnImportRequest } from "@/adapters/types";
import type { ModelInputs } from "@/engine/inputs";
import { isModelResponse, type ModelResponse } from "@/lib/api";
import type { BuildModelInputsArgs } from "@/server/modelInputs";
import { espnCredentialsFor, saveEspnCredentials } from "@/server/session";
import { fakeDeps, fakeResult, jsonRequest } from "../../_lib/testFakes";
import { createEspnImportHandler } from "../../import/espn/handler";
import { createEspnModelHandler } from "./handler";

const URL = "http://localhost:3000/api/model/espn";
const IMPORT_URL = "http://localhost:3000/api/import/espn";
const NOW = () => new Date("2026-09-29T23:00:00.000Z");
// Fake credentials only.
const SECRET = "unit-test-secret-that-is-at-least-32-chars!!";
const ENV = { SESSION_SECRET: SECRET, NODE_ENV: "test" };
const CREDS = { espnS2: `AEBfakeTOKEN${"e".repeat(70)}%3D`, swid: "{00000000-0000-4000-8000-000000000000}" };
/** ESPN's league-scored projections from the same responses (fictional numbers). */
const ESPN = { "4046": { 3: 17.1, 4: 17.9 } };

function fakeModel(over: Partial<ModelInputs> = {}): ModelInputs {
  return {
    version: 1,
    season: 2026,
    currentWeek: 4,
    lastWeek: 17,
    builtAt: "2026-09-29T23:00:00.000Z",
    nfl: { byeWeek: { KC: 10 }, kickoffs: { 4: { KC: "2026-10-04T17:00:00.000Z" } } },
    players: { "4046": { sleeper: { 4: 18.2 }, actual: { 1: 20.5 }, espn: { 3: 17.1, 4: 17.9 } } },
    espnProjections: true,
    market: null,
    sources: [{ source: "Sleeper projections", fetchedAt: "2026-09-29T22:00:00.000Z" }],
    warnings: [],
    notes: [],
    ...over,
  };
}

interface Setup {
  importLeague?: (req: EspnImportRequest) => Promise<EspnModelImport>;
  buildInputs?: (args: BuildModelInputsArgs) => Promise<ModelInputs>;
  env?: Record<string, string>;
}

function setup(opts: Setup = {}) {
  const calls: EspnImportRequest[] = [];
  const built: BuildModelInputsArgs[] = [];
  const deps = fakeDeps();
  const env = opts.env ?? ENV;
  const handler = createEspnModelHandler({
    importLeague: async (req, d) => {
      calls.push(req);
      if (d !== deps) throw new Error("the adapter must get the route's deps");
      return (opts.importLeague ?? (async () => ({ result: fakeResult(), espn: ESPN })))(req);
    },
    buildInputs: async (args) => {
      built.push(args);
      return (opts.buildInputs ?? (async () => fakeModel()))(args);
    },
    getDeps: async () => deps,
    credentialsFor: (request, leagueId) => espnCredentialsFor(request, leagueId, env),
    now: NOW,
  });
  return { handler, calls, built, deps };
}

/** POST /api/import/espn's own answer for the same league, adapter result and session. */
async function importRouteAnswer(body: unknown, headers: Record<string, string> = {}, env: Record<string, string> = ENV): Promise<unknown> {
  const importHandler = createEspnImportHandler({ importLeague: async () => fakeResult(), getDeps: async () => fakeDeps(), credentialsFor: (r, id) => espnCredentialsFor(r, id, env), now: NOW });
  return (await importHandler(jsonRequest(IMPORT_URL, body, headers))).json();
}

async function sessionCookie(): Promise<string> {
  const saved = new Headers();
  await saveEspnCredentials(new Request(URL), saved, CREDS, ENV);
  return (saved.getSetCookie()[0] ?? "").split(";")[0] ?? "";
}

async function errorOf(res: Response): Promise<{ code: string; message: string }> {
  return ((await res.json()) as { error: { code: string; message: string } }).error;
}

describe("POST /api/model/espn (CLAUDE.md §6, §9: the League page's model inputs)", () => {
  it("answers the import exactly as POST /api/import/espn does, plus the model inputs built for that snapshot", async () => {
    const { handler, calls, built, deps } = setup();
    const res = await handler(jsonRequest(URL, { leagueId: " 4242 ", season: 2026 }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(calls).toEqual([{ leagueId: "4242", season: 2026 }]);
    const body = (await res.json()) as ModelResponse;
    expect(isModelResponse(body)).toBe(true);
    expect(body.import).toEqual(await importRouteAnswer({ leagueId: "4242", season: 2026 }));
    expect(body.import).toMatchObject({ snapshot: { name: "The Gloopdorf Invitational" }, usedEspnCookies: false, dataSources: [{ name: "Sleeper players" }] });
    expect(body.model).toEqual(fakeModel());
    // The inputs are built for the snapshot just imported, with the same client, resolver and clock, and ESPN's projections.
    expect(built).toHaveLength(1);
    expect(built[0]?.snapshot).toEqual(fakeResult().snapshot);
    expect(built[0]?.http).toBe(deps.http);
    expect(built[0]?.resolver).toBe(deps.resolver);
    expect(built[0]?.now).toBe(deps.now);
    expect(built[0]?.espn).toEqual(ESPN);
  });

  it("passes Refresh through to the adapter; a team in the body is ignored (the League page never sends one)", async () => {
    const { handler, calls } = setup();
    await handler(jsonRequest(URL, { leagueId: "4242", season: 2026, refresh: true, myTeamId: "3" }));
    await handler(jsonRequest(URL, { leagueId: "4242", season: "2026", refresh: false }));
    expect(calls).toEqual([
      { leagueId: "4242", season: 2026, refresh: true },
      { leagueId: "4242", season: 2026 },
    ]);
    expect((await handler(jsonRequest(URL, { leagueId: "4242", season: 2026, refresh: "yes" }))).status).toBe(400);
  });

  it("returns the model's warnings in the answer: a source that failed is never an error response", async () => {
    const warnings = [{ code: "FANTASYCALC_UNAVAILABLE", message: "FantasyCalc's values couldn't be loaded (FantasyCalc redraft values: HTTP 503), so players have no market values yet." }];
    const { handler } = setup({ buildInputs: async () => fakeModel({ warnings, market: null }) });
    const res = await handler(jsonRequest(URL, { leagueId: "4242", season: 2026 }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as ModelResponse).model.warnings).toEqual(warnings);
  });

  it("sends the session's ESPN cookies to the adapter and never returns them, like the import", async () => {
    const cookie = await sessionCookie();
    const { handler, calls } = setup();
    const res = await handler(jsonRequest(URL, { leagueId: "4242", season: 2026 }, { cookie }));
    expect(res.status).toBe(200);
    expect(calls[0]?.credentials).toEqual(CREDS);
    const text = await res.text();
    const body = JSON.parse(text) as ModelResponse;
    expect(body.import).toMatchObject({ usedEspnCookies: true, espnCookieSource: "session" });
    expect(body.import).toEqual(await importRouteAnswer({ leagueId: "4242", season: 2026 }, { cookie }));
    expect(text).not.toContain(CREDS.espnS2);
    expect(text).not.toContain(CREDS.swid.slice(1, -1));
  });

  it("says when the cookies came from .env.local (development only), never the values; other leagues get none", async () => {
    const dev = { NODE_ENV: "development", USE_ENV_COOKIES: "1", ESPN_LEAGUE_ID: "4242", ESPN_S2: CREDS.espnS2, ESPN_SWID: CREDS.swid };
    const { handler, calls } = setup({ env: dev });
    const text = await (await handler(jsonRequest(URL, { leagueId: "4242", season: 2026 }))).text();
    expect(calls[0]?.credentials).toEqual(CREDS);
    expect((JSON.parse(text) as ModelResponse).import).toMatchObject({ usedEspnCookies: true, espnCookieSource: "dev-env" });
    expect(text).not.toContain(CREDS.espnS2);
    expect(text).not.toContain(CREDS.swid.slice(1, -1));
    const other = (await (await handler(jsonRequest(URL, { leagueId: "4243", season: 2026 }))).json()) as ModelResponse;
    expect(calls[1]?.credentials).toBeUndefined();
    expect(other.import).toMatchObject({ usedEspnCookies: false });
    expect(other.import).not.toHaveProperty("espnCookieSource");
  });

  it("removes the user's own SWID anywhere in the answer, the model included, in any form or case", async () => {
    const bare = CREDS.swid.slice(1, -1).toUpperCase();
    const cookie = await sessionCookie();
    const { handler } = setup({
      importLeague: async () => ({ result: fakeResult({ name: `League of ${bare}` }), espn: ESPN }),
      buildInputs: async () => fakeModel({ notes: [`owner %7B${bare.toLowerCase()}%7D`] }),
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const text = await (await handler(jsonRequest(URL, { leagueId: "4242", season: 2026 }, { cookie }))).text();
    expect(text.toLowerCase()).not.toContain(bare.toLowerCase());
    expect(text).toContain("League of {SWID}");
    expect(text).toContain("owner {SWID}");
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("replaces SWID-shaped values that slip into the model inputs, without cookies too", async () => {
    const { handler } = setup({ buildInputs: async () => fakeModel({ warnings: [{ code: "X", message: "member {00000000-0000-4000-8000-000000000042}" }] }) });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const text = await (await handler(jsonRequest(URL, { leagueId: "4242", season: 2026 }))).text();
    expect(text).not.toContain("00000000-0000-4000-8000-000000000042");
    expect(text).toContain("member {SWID}");
    expect(String(errors.mock.calls[0]?.[0])).not.toContain("000000000042");
  });

  it.each([
    ["LEAGUE_NOT_FOUND", 404, "League not found for that season."],
    ["PRIVATE_LEAGUE", 403, "This ESPN league is private, so ESPN only shares it with a login."],
    ["BAD_CREDENTIALS", 401, "ESPN didn't accept your cookies."],
    ["NOT_ACTIVATED", 409, "hasn't been activated"],
    ["SOURCE_DOWN", 502, "ESPN isn't responding right now."],
  ] as const)("maps the import's %s to HTTP %i as the import route does, and builds no inputs", async (code, status, message) => {
    const fail = async (): Promise<never> => {
      throw new LeagueImportError(code, `internal detail for ${code}`, { platform: "espn", status: 500 });
    };
    const { handler, built } = setup({ importLeague: fail });
    const res = await handler(jsonRequest(URL, { leagueId: "4242", season: 2026 }));
    expect(res.status).toBe(status);
    const err = await errorOf(res);
    expect(err.code).toBe(code);
    expect(err.message).toContain(message);
    expect(err.message).not.toContain("internal detail");
    expect(built).toHaveLength(0);
    const viaImport = createEspnImportHandler({ importLeague: fail, getDeps: async () => fakeDeps(), credentialsFor: (r, id) => espnCredentialsFor(r, id, ENV), now: NOW });
    expect(err).toEqual(await errorOf(await viaImport(jsonRequest(IMPORT_URL, { leagueId: "4242", season: 2026 }))));
  });

  it("forwards the adapter's own words for unsupported leagues and bad responses, redacted", async () => {
    const bad = setup({
      importLeague: async () => {
        throw new LeagueImportError("BAD_RESPONSE", "Missing required field at teams[0].owners[0] ({00000000-0000-4000-8000-000000000000})", { path: "teams[0].owners[0]" });
      },
    });
    const err = await errorOf(await bad.handler(jsonRequest(URL, { leagueId: "4242", season: 2026 })));
    expect(err.code).toBe("BAD_RESPONSE");
    expect(err.message).toContain("teams[0].owners[0]");
    expect(err.message).not.toContain("00000000-0000-4000-8000-000000000000");
  });

  it("hides an unexpected failure (the import's or the model builder's) behind a generic message", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const cookie = await sessionCookie();
    const boom = async (): Promise<never> => {
      throw new TypeError(`boom with ${CREDS.espnS2}`);
    };
    for (const opts of [{ importLeague: boom }, { buildInputs: boom }]) {
      const res = await setup(opts).handler(jsonRequest(URL, { leagueId: "4242", season: 2026 }, { cookie }));
      expect(res.status).toBe(500);
      expect(await errorOf(res)).toEqual({ code: "INTERNAL", message: "Something went wrong on our side. Please try again." });
    }
    const logged = errors.mock.calls.flat().join(" ");
    expect(logged).not.toContain(CREDS.espnS2);
    expect(logged).toContain("ESPN model inputs failed unexpectedly (TypeError)");
  });

  it("a builder that throws an import error is still our bug, not ESPN's: INTERNAL, not an import error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { handler } = setup({
      buildInputs: async () => {
        throw new LeagueImportError("SOURCE_DOWN", "FantasyCalc redraft values: HTTP 503");
      },
    });
    const res = await handler(jsonRequest(URL, { leagueId: "4242", season: 2026 }));
    expect(res.status).toBe(500);
    expect((await errorOf(res)).code).toBe("INTERNAL");
  });

  it("validates the request before calling ESPN", async () => {
    const { handler, calls } = setup();
    const badId = await handler(jsonRequest(URL, { leagueId: "https://fantasy.espn.com/football/league?leagueId=1", season: 2026 }));
    expect(badId.status).toBe(400);
    expect((await errorOf(badId)).message).toMatch(/league ID/);
    expect((await errorOf(await handler(jsonRequest(URL, { leagueId: "4242", season: 1999 })))).message).toBe("Pick a season from 2018 to 2026.");
    expect((await errorOf(await handler(jsonRequest(URL, { leagueId: "4242", season: 2027 })))).message).toBe("Pick a season from 2018 to 2026.");
    expect((await handler(jsonRequest(URL, { leagueId: "4242" }))).status).toBe(400);
    expect((await handler(jsonRequest(URL, { season: 2026 }))).status).toBe(400);
    const foreign = await handler(jsonRequest(URL, { leagueId: "4242", season: 2026 }, { origin: "https://evil.example" }));
    expect(foreign.status).toBe(403);
    expect((await errorOf(foreign)).code).toBe("BAD_ORIGIN");
    const asText = new Request(URL, { method: "POST", headers: { "content-type": "text/plain", host: "localhost:3000" }, body: JSON.stringify({ leagueId: "4242", season: 2026 }) });
    expect((await handler(asText)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
