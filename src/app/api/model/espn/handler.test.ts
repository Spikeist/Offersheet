import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { EspnModelImport } from "@/adapters/espn";
import { LeagueImportError, type EspnImportRequest } from "@/adapters/types";
import type { ModelInputs } from "@/engine/inputs";
import { isModelResponse, type ModelResponse } from "@/lib/api";
import type { BuildModelInputsArgs } from "@/server/modelInputs";
import { importDigest, signImport, signatureProblem } from "@/server/importToken";
import { browserFetchLimits, workLimits } from "@/server/limits";
import { espnCredentialsFor, saveEspnCredentials } from "@/server/session";
import { fakeDeps, fakeResult, gzipRequest, jsonRequest } from "../../_lib/testFakes";
import { createEspnImportHandler } from "../../import/espn/handler";
import { createModelMemo, modelMemoKey } from "../memo";
import { createEspnModelHandler, type EspnModelHandlerDeps } from "./handler";

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
    sign: () => undefined,
    now: NOW,
  });
  return { handler, calls, built, deps };
}

/** The import route's handler as these tests compare with it (unsigned, no browser uploads). */
function importHandlerWith(importLeague: (req: EspnImportRequest) => Promise<EspnModelImport>, env: Record<string, string> = ENV) {
  return createEspnImportHandler({
    importLeague,
    importUpload: async () => {
      throw new Error("no upload in these tests");
    },
    getDeps: async () => fakeDeps(),
    credentialsFor: (r, id) => espnCredentialsFor(r, id, env),
    sign: () => undefined,
    now: NOW,
  });
}

/** POST /api/import/espn's own answer for the same league, adapter result and session. */
async function importRouteAnswer(body: unknown, headers: Record<string, string> = {}, env: Record<string, string> = ENV): Promise<unknown> {
  const importHandler = importHandlerWith(async () => ({ result: fakeResult(), espn: ESPN }), env);
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
    // Logged once for the import (scrubbed before it's signed, as the import route does) and once for the model inputs.
    expect(errors).toHaveBeenCalledTimes(2);
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
    const viaImport = importHandlerWith(fail);
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
    // The log takes allowlisted fields only (src/server/log.ts): the step, the platform and the error's name.
    expect(logged).toContain(JSON.stringify({ route: "server", event: "unexpected_model_inputs", platform: "espn", errorName: "TypeError" }));
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

describe("POST /api/model/espn with the import the browser saved, signed (Part B, track BF)", () => {
  const SIGN_ENV = { SESSION_SECRET: "model route tests: a made-up secret, never a real one" };
  const issued = NOW().getTime() - 60_000;
  const snapshot = fakeResult().snapshot;

  function signedSetup(over: Partial<EspnModelHandlerDeps> = {}) {
    const reads: EspnImportRequest[] = [];
    const built: BuildModelInputsArgs[] = [];
    const deps = fakeDeps();
    const handler = createEspnModelHandler({
      importLeague: async (req) => {
        reads.push(req);
        return { result: fakeResult({ name: "Read again" }), espn: ESPN };
      },
      buildInputs: async (args) => {
        built.push(args);
        return fakeModel();
      },
      getDeps: async () => deps,
      credentialsFor: (request, leagueId) => espnCredentialsFor(request, leagueId, ENV),
      sign: (platform, content) => signImport(platform, content, NOW().getTime(), SIGN_ENV),
      verify: (platform, digest, signature) => signatureProblem(platform, digest, signature, NOW().getTime(), SIGN_ENV),
      memo: createModelMemo(),
      now: NOW,
      ...over,
    });
    return { handler, reads, built, deps };
  }

  /** The body the League page sends: the saved import (as JSON would carry it) with the server's signature. */
  function body(over: { snapshot?: unknown; modelPart?: unknown; leagueId?: string } = {}) {
    const imported = { snapshot: over.snapshot ?? snapshot, modelPart: over.modelPart ?? { espn: ESPN } };
    const signed = signImport("espn", { snapshot, modelPart: { espn: ESPN } }, issued, SIGN_ENV);
    return JSON.parse(JSON.stringify({ v: 1, leagueId: over.leagueId ?? "4242", season: 2026, import: imported, signed })) as unknown;
  }

  it("builds the numbers from it without reading the league again, and doesn't send the import back", async () => {
    const { handler, reads, built, deps } = signedSetup();
    const res = await handler(gzipRequest(URL, body()));
    expect(res.status).toBe(200);
    expect(reads).toHaveLength(0);
    expect(await res.json()).toEqual({ model: fakeModel(), signedImport: true });
    expect(built).toHaveLength(1);
    expect(built[0]?.snapshot).toEqual(snapshot);
    expect(built[0]?.espn).toEqual(ESPN);
    expect(built[0]?.http).toBe(deps.http);
  });

  it("reads the league itself when the signature doesn't check out, for the body's league, and answers the new import, signed", async () => {
    const { handler, reads } = signedSetup();
    for (const b of [body({ snapshot: { ...snapshot, name: "Changed in the browser" } }), body({ modelPart: { espn: {} } }), body({ leagueId: "5151" })]) {
      const res = await handler(gzipRequest(URL, b));
      expect(res.status).toBe(200);
      const answer = (await res.json()) as ModelResponse;
      expect(isModelResponse(answer)).toBe(true);
      expect(answer.import).toMatchObject({ snapshot: { name: "Read again" }, readBy: "server", modelPart: { espn: ESPN }, signed: { issuedAt: NOW().getTime() } });
    }
    expect(reads.map((r) => r.leagueId)).toEqual(["4242", "4242", "5151"]);
    // A body it can't read at all: BAD_UPLOAD (the browser then sends the JSON body).
    const bad = await handler(gzipRequest(URL, { v: 1, leagueId: "4242", season: 2026 }));
    expect(bad.status).toBe(400);
    expect((await errorOf(bad)).code).toBe("BAD_UPLOAD");
    expect(reads).toHaveLength(3);
  });

  it("answers the same signed import again from this instance's memory, without a build, while its token is good (final review SEC-1)", async () => {
    let now = NOW().getTime();
    const memo = createModelMemo();
    const { handler, built, reads } = signedSetup({ memo, now: () => new Date(now), verify: (platform, digest, signature) => signatureProblem(platform, digest, signature, now, SIGN_ENV) });
    const first = await (await handler(gzipRequest(URL, body()))).text();
    const second = await (await handler(gzipRequest(URL, body()))).text();
    expect(second).toBe(first);
    expect(JSON.parse(first)).toEqual({ model: fakeModel(), signedImport: true });
    expect(built).toHaveLength(1);
    const key = modelMemoKey("espn", importDigest({ snapshot: JSON.parse(JSON.stringify(snapshot)) as unknown, modelPart: { espn: ESPN } }));
    expect(memo.get(key, now)).toBe(first);
    // Another import (another league here: its own signature) is built for itself.
    const otherSnapshot = { ...snapshot, leagueId: "5151" };
    const otherSigned = signImport("espn", { snapshot: otherSnapshot, modelPart: { espn: ESPN } }, issued, SIGN_ENV);
    const other = JSON.parse(JSON.stringify({ v: 1, leagueId: "5151", season: 2026, import: { snapshot: otherSnapshot, modelPart: { espn: ESPN } }, signed: otherSigned })) as unknown;
    expect((await handler(gzipRequest(URL, other))).status).toBe(200);
    expect(built).toHaveLength(2);
    // At the token's last moment the answer is gone (built again); past it the token is too (the league is read again).
    now = issued + browserFetchLimits.tokenMaxAgeMs;
    expect(memo.get(key, now)).toBeUndefined();
    expect((await handler(gzipRequest(URL, body()))).status).toBe(200);
    expect(built).toHaveLength(3);
    now += 1;
    const late = (await (await handler(gzipRequest(URL, body()))).json()) as ModelResponse;
    expect(late.import).toMatchObject({ readBy: "server" });
    expect(reads).toHaveLength(1);
  });

  it("charges a build bigger than the request paid for first, and a signature that doesn't check out the re-read's units first: refused, BUSY and nothing done (final review SEC-1, F1)", async () => {
    const charged: number[] = [];
    let verdict: "ok" | "client" | "day" = "ok";
    const chargeWork = async (units: number) => {
      charged.push(units);
      return verdict;
    };
    // Parker's league is far below the work a request pays for: no extra charge.
    const plain = signedSetup({ chargeWork });
    expect((await plain.handler(gzipRequest(URL, body()))).status).toBe(200);
    expect(charged).toEqual([]);
    // A league of 3,000 players with 10 scoring rules (30,000 units of work): (30,000 − 15,000) / 5,000 = 3 more units.
    const ids = Array.from({ length: 3_000 }, (_, i) => String(10_000 + i));
    const bigSnapshot = { ...snapshot, teams: [{ id: "1", name: "x", ownerName: "y", roster: ids, ir: [], taxi: [] }], freeAgents: [], settings: { scoring: { rules: Array.from({ length: 10 }, () => ({ kind: "range", stat: "rush_yd", min: 100, max: 199, points: 1 })) } } };
    const bigSigned = signImport("espn", { snapshot: bigSnapshot, modelPart: { espn: ESPN } }, issued, SIGN_ENV);
    const bigBody = JSON.parse(JSON.stringify({ v: 1, leagueId: "4242", season: 2026, import: { snapshot: bigSnapshot, modelPart: { espn: ESPN } }, signed: bigSigned })) as unknown;
    const big = signedSetup({ chargeWork });
    expect((await big.handler(gzipRequest(URL, bigBody))).status).toBe(200);
    expect(charged).toEqual([3]);
    verdict = "client";
    const refused = signedSetup({ chargeWork });
    const res = await refused.handler(gzipRequest(URL, bigBody));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await errorOf(res)).toMatchObject({ code: "BUSY", message: expect.stringContaining("Your connection has used today's share of requests to Offer Sheet.") });
    expect(refused.built).toHaveLength(0);
    // A signature that doesn't check out: the league read costs a server read's units past the build the request paid for.
    charged.length = 0;
    verdict = "day";
    const reread = signedSetup({ chargeWork });
    const busy = await reread.handler(gzipRequest(URL, body({ snapshot: { ...snapshot, name: "Changed in the browser" } })));
    expect(busy.status).toBe(503);
    expect((await errorOf(busy)).message).toMatch(/^Offer Sheet has used its share of free server time for now\. Try again /);
    expect(charged).toEqual([workLimits.units.modelServer - workLimits.units.modelSigned]);
    expect(reread.reads).toHaveLength(0);
    expect(reread.built).toHaveLength(0);
  });

  it("a build from a signed import gets getModelDeps (no crosswalk: final review F3); a league read again, the import's getDeps", async () => {
    const light = { ...fakeDeps(), resolver: { defenseId: () => "WAS" } };
    const { handler, built, deps } = signedSetup({ getModelDeps: async () => light });
    await handler(gzipRequest(URL, body()));
    expect(built[0]?.resolver).toBe(light.resolver);
    await handler(gzipRequest(URL, body({ snapshot: { ...snapshot, name: "Changed in the browser" } })));
    expect(built[1]?.resolver).toBe(deps.resolver);
  });
});
