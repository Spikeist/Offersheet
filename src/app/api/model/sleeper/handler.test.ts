import { describe, expect, it, vi } from "vitest";
import { LeagueImportError, type ImportResult, type SleeperImportRequest } from "@/adapters/types";
import type { ModelInputs } from "@/engine/inputs";
import { isModelResponse, type ModelResponse } from "@/lib/api";
import { createBuildSlots } from "@/server/buildSlots";
import { newRequestScope, runInRequestScope } from "@/server/deadline";
import { signImport, signatureProblem } from "@/server/importToken";
import type { BuildModelInputsArgs } from "@/server/modelInputs";
import { fakeDeps, fakeResult, gzipRequest, jsonRequest } from "../../_lib/testFakes";
import { createSleeperImportHandler } from "../../import/sleeper/handler";
import { createModelMemo } from "../memo";
import { createSleeperModelHandler } from "./handler";

const URL = "http://localhost:3000/api/model/sleeper";
const IMPORT_URL = "http://localhost:3000/api/import/sleeper";
const NOW = () => new Date("2026-09-29T23:00:00.000Z");
// Fictional league ID.
const LEAGUE = "123456789012345678";

function fakeModel(over: Partial<ModelInputs> = {}): ModelInputs {
  return {
    version: 1,
    season: 2026,
    currentWeek: 4,
    lastWeek: 17,
    builtAt: "2026-09-29T23:00:00.000Z",
    nfl: { byeWeek: { KC: 10 }, kickoffs: {} },
    players: { "4046": { sleeper: { 4: 18.2 }, actual: { 1: 20.5 }, sleeperSeasonPerGame: 17.4 } },
    espnProjections: false,
    market: null,
    sources: [{ source: "Sleeper projections", fetchedAt: "2026-09-29T22:00:00.000Z" }],
    warnings: [],
    notes: [],
    ...over,
  };
}

const sleeperResult = () => fakeResult({ platform: "sleeper", leagueId: LEAGUE });

function setup(opts: { importLeague?: (req: SleeperImportRequest) => Promise<ImportResult>; buildInputs?: (args: BuildModelInputsArgs) => Promise<ModelInputs> } = {}) {
  const calls: SleeperImportRequest[] = [];
  const built: BuildModelInputsArgs[] = [];
  const deps = fakeDeps();
  const handler = createSleeperModelHandler({
    importLeague: async (req, d) => {
      calls.push(req);
      if (d !== deps) throw new Error("the adapter must get the route's deps");
      return (opts.importLeague ?? (async () => sleeperResult()))(req);
    },
    buildInputs: async (args) => {
      built.push(args);
      return (opts.buildInputs ?? (async () => fakeModel()))(args);
    },
    getDeps: async () => deps,
    sign: () => undefined,
    now: NOW,
  });
  return { handler, calls, built, deps };
}

/** The import route's handler as these tests compare with it (unsigned, no browser uploads). */
function importHandlerWith(importLeague: (req: SleeperImportRequest) => Promise<ImportResult>) {
  return createSleeperImportHandler({
    importLeague,
    importUpload: async () => {
      throw new Error("no upload in these tests");
    },
    getDeps: async () => fakeDeps(),
    choicesOf: () => undefined,
    sign: () => undefined,
    now: NOW,
  });
}

async function errorOf(res: Response): Promise<{ code: string; message: string }> {
  return ((await res.json()) as { error: { code: string; message: string } }).error;
}

describe("POST /api/model/sleeper (CLAUDE.md §6, §9: the League page's model inputs)", () => {
  it("answers the import exactly as POST /api/import/sleeper does for the league ID, plus the model inputs built for that snapshot", async () => {
    const { handler, calls, built, deps } = setup();
    const res = await handler(jsonRequest(URL, { season: 2026, leagueId: LEAGUE }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(calls).toEqual([{ season: 2026, leagueId: LEAGUE }]);
    const body = (await res.json()) as ModelResponse;
    expect(isModelResponse(body)).toBe(true);
    const importHandler = importHandlerWith(async () => sleeperResult());
    expect(body.import).toEqual(await (await importHandler(jsonRequest(IMPORT_URL, { season: 2026, leagueId: LEAGUE }))).json());
    expect(body.model).toEqual(fakeModel());
    expect(built).toHaveLength(1);
    expect(built[0]?.snapshot).toEqual(sleeperResult().snapshot);
    expect(built[0]?.http).toBe(deps.http);
    expect(built[0]?.resolver).toBe(deps.resolver);
    expect(built[0]?.now).toBe(deps.now);
    expect(built[0]).not.toHaveProperty("espn");
  });

  it("passes the username the league was imported with and Refresh through, and reads a pasted league link", async () => {
    const { handler, calls } = setup();
    await handler(jsonRequest(URL, { season: 2026, leagueId: LEAGUE, refresh: true, username: "zorblax_q" }));
    await handler(jsonRequest(URL, { season: "2026", leagueId: `https://sleeper.com/leagues/${LEAGUE}/team`, refresh: false }));
    await handler(jsonRequest(URL, { season: 2026, leagueId: LEAGUE, username: "  @zorblax_q " }));
    await handler(jsonRequest(URL, { season: 2026, leagueId: LEAGUE, username: "   " }));
    expect(calls).toEqual([
      { season: 2026, leagueId: LEAGUE, username: "zorblax_q", refresh: true },
      { season: 2026, leagueId: LEAGUE },
      { season: 2026, leagueId: LEAGUE, username: "zorblax_q" },
      { season: 2026, leagueId: LEAGUE },
    ]);
  });

  it("asks the adapter for the same league and user as POST /api/import/sleeper does, so the re-import finds the user's team", async () => {
    const { handler, calls } = setup();
    const importCalls: SleeperImportRequest[] = [];
    const importHandler = importHandlerWith(async (req) => {
      importCalls.push(req);
      return sleeperResult();
    });
    for (const body of [{ season: 2026, leagueId: LEAGUE, username: "zorblax_q" }, { season: 2026, leagueId: LEAGUE, username: "zorblax_q", refresh: true }, { season: 2026, leagueId: LEAGUE }]) {
      await handler(jsonRequest(URL, body));
      await importHandler(jsonRequest(IMPORT_URL, body));
    }
    expect(calls).toEqual(importCalls);
  });

  it("returns the model's warnings in the answer: a source that failed is never an error response", async () => {
    const warnings = [{ code: "NFL_SCHEDULE_UNAVAILABLE", message: "The NFL schedule couldn't be loaded (NFL schedule (ESPN): HTTP 503), so bye weeks are unknown and every remaining week counts as a game." }];
    const { handler } = setup({ buildInputs: async () => fakeModel({ warnings }) });
    const res = await handler(jsonRequest(URL, { season: 2026, leagueId: LEAGUE }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as ModelResponse).model.warnings).toEqual(warnings);
  });

  it.each([
    ["LEAGUE_NOT_FOUND", 404, "League not found for that season."],
    ["SOURCE_DOWN", 502, "Sleeper isn't responding right now."],
    ["BAD_RESPONSE", 502, "Sleeper sent data in a shape we didn't expect"],
  ] as const)("maps the import's %s to HTTP %i as the import route does, and builds no inputs", async (code, status, message) => {
    const fail = async (): Promise<never> => {
      throw new LeagueImportError(code, "Sleeper sent an unexpected league body.", { platform: "sleeper" });
    };
    const { handler, built } = setup({ importLeague: fail });
    const res = await handler(jsonRequest(URL, { season: 2026, leagueId: LEAGUE }));
    expect(res.status).toBe(status);
    const err = await errorOf(res);
    expect(err.code).toBe(code);
    expect(err.message).toContain(message);
    expect(built).toHaveLength(0);
    const viaImport = importHandlerWith(fail);
    expect(err).toEqual(await errorOf(await viaImport(jsonRequest(IMPORT_URL, { season: 2026, leagueId: LEAGUE }))));
  });

  it("passes the adapter's friendly message for unsupported leagues", async () => {
    const { handler } = setup({
      importLeague: async () => {
        throw new LeagueImportError("UNSUPPORTED_LEAGUE", "Guillotine leagues aren't supported yet.", { platform: "sleeper" });
      },
    });
    const res = await handler(jsonRequest(URL, { season: 2026, leagueId: LEAGUE }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { code: "UNSUPPORTED_LEAGUE", message: "Guillotine leagues aren't supported yet." } });
  });

  it("hides an unexpected failure of the model builder behind a generic message, even an import error it shouldn't throw", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const failures = [new RangeError("secret-ish detail"), new LeagueImportError("SOURCE_DOWN", "FantasyCalc redraft values: HTTP 503")];
    for (const failure of failures) {
      const { handler } = setup({
        buildInputs: async () => {
          throw failure;
        },
      });
      const res = await handler(jsonRequest(URL, { season: 2026, leagueId: LEAGUE }));
      expect(res.status).toBe(500);
      expect(await errorOf(res)).toEqual({ code: "INTERNAL", message: "Something went wrong on our side. Please try again." });
    }
    const logged = errors.mock.calls.flat().join(" ");
    expect(logged).not.toContain("secret-ish detail");
    // The log takes allowlisted fields only (src/server/log.ts): the step, the platform and the error's name.
    expect(logged).toContain(JSON.stringify({ route: "server", event: "unexpected_model_inputs", platform: "sleeper", errorName: "RangeError" }));
  });

  it("validates the request before calling Sleeper: the league ID is required here", async () => {
    const { handler, calls } = setup();
    for (const body of [{ season: 2026 }, { season: 2026, leagueId: "  " }, { season: 2026, leagueId: null }, { season: 2026, username: "zorblax_q" }]) {
      const res = await handler(jsonRequest(URL, body));
      expect(res.status).toBe(400);
      expect((await errorOf(res)).message).toBe("Enter your Sleeper league ID or paste the league link.");
    }
    expect((await errorOf(await handler(jsonRequest(URL, { season: 2026, leagueId: "abc" })))).message).toMatch(/long number/);
    expect((await errorOf(await handler(jsonRequest(URL, { season: 2030, leagueId: LEAGUE })))).message).toBe("Pick a season from 2018 to 2026.");
    // A username is checked as on the import route; the message never echoes it.
    const badName = await handler(jsonRequest(URL, { season: 2026, leagueId: LEAGUE, username: "zorblax q" }));
    expect(badName.status).toBe(400);
    expect(await errorOf(badName)).toEqual({ code: "INVALID_REQUEST", message: "That doesn't look like a Sleeper username." });
    expect((await errorOf(await handler(jsonRequest(URL, { season: 2026, leagueId: LEAGUE, username: 42 })))).message).toBe('The "username" field isn\'t valid.');
    expect((await handler(jsonRequest(URL, { leagueId: LEAGUE }))).status).toBe(400);
    const foreign = await handler(jsonRequest(URL, { season: 2026, leagueId: LEAGUE }, { origin: "https://evil.example" }));
    expect(foreign.status).toBe(403);
    expect((await errorOf(foreign)).code).toBe("BAD_ORIGIN");
    expect(calls).toHaveLength(0);
  });
});

describe("POST /api/model/sleeper: the instance's build slots (Checkpoint 7b load test, risk 3)", () => {
  it("a build takes one of the instance's slots for its build only; none free in time: BUSY in words, nothing built, the league read once", async () => {
    const slots = createBuildSlots(1, 30_000);
    const calls: SleeperImportRequest[] = [];
    let builds = 0;
    const handler = createSleeperModelHandler({
      importLeague: async (req) => {
        calls.push(req);
        return sleeperResult();
      },
      buildInputs: async () => {
        builds++;
        return fakeModel();
      },
      getDeps: async () => fakeDeps(),
      sign: () => undefined,
      slots,
      now: NOW,
    });
    const held = await slots.acquire(); // another build holds the one slot
    // A request 70 s into its 90 s: under 30 s left, so its build doesn't wait.
    const busy = await runInRequestScope(newRequestScope("model", Date.now() - 70_000), () => handler(jsonRequest(URL, { season: 2026, leagueId: LEAGUE })));
    expect(busy.status).toBe(503);
    expect(busy.headers.get("retry-after")).toBe("60");
    expect(await errorOf(busy)).toEqual({ code: "BUSY", message: "Offer Sheet is busy right now. Try again in a minute." });
    expect(calls).toHaveLength(1); // the league was read (no slot needed for that), then its build found none
    expect(builds).toBe(0);
    // A request with time to spare waits for the slot, and builds once it's free.
    const waiting = runInRequestScope(newRequestScope("model", Date.now()), () => handler(jsonRequest(URL, { season: 2026, leagueId: LEAGUE })));
    await vi.waitFor(() => expect(slots.waiting()).toBe(1));
    held?.();
    expect((await waiting).status).toBe(200);
    expect(builds).toBe(1);
    expect([slots.running(), slots.waiting()]).toEqual([0, 0]);
  });
});

describe("POST /api/model/sleeper with the import the browser saved, signed (Part B, track BF)", () => {
  const SIGN_ENV = { SESSION_SECRET: "model route tests: a made-up secret, never a real one" };

  it("builds the numbers from a signed import without reading the league; another league's, or a changed one, is read again with the body's username", async () => {
    const reads: SleeperImportRequest[] = [];
    const built: BuildModelInputsArgs[] = [];
    const handler = createSleeperModelHandler({
      importLeague: async (req) => {
        reads.push(req);
        return sleeperResult();
      },
      buildInputs: async (args) => {
        built.push(args);
        return fakeModel();
      },
      getDeps: async () => fakeDeps(),
      sign: (platform, content) => signImport(platform, content, NOW().getTime(), SIGN_ENV),
      verify: (platform, digest, signature) => signatureProblem(platform, digest, signature, NOW().getTime(), SIGN_ENV),
      memo: createModelMemo(),
      now: NOW,
    });
    const snapshot = sleeperResult().snapshot;
    const signed = signImport("sleeper", { snapshot, modelPart: {} }, NOW().getTime(), SIGN_ENV);
    const body = (over: Record<string, unknown> = {}) => JSON.parse(JSON.stringify({ v: 1, leagueId: LEAGUE, season: 2026, username: "zorblax_q", import: { snapshot, modelPart: {} }, signed, ...over })) as unknown;
    const res = await handler(gzipRequest(URL, body()));
    expect(await res.json()).toEqual({ model: fakeModel(), signedImport: true });
    expect(reads).toHaveLength(0);
    expect(built[0]?.snapshot).toEqual(snapshot);
    const again = (await (await handler(gzipRequest(URL, body({ import: { snapshot: { ...snapshot, name: "Changed" }, modelPart: {} } })))).json()) as ModelResponse;
    expect(isModelResponse(again)).toBe(true);
    expect(again.import).toMatchObject({ readBy: "server", modelPart: {}, signed: { issuedAt: NOW().getTime() } });
    expect(reads).toEqual([{ season: 2026, leagueId: LEAGUE, username: "zorblax_q" }]);
    // The same signed import again: this instance's memory answers, without a build (final review SEC-1).
    const builds = built.length;
    expect(await (await handler(gzipRequest(URL, body()))).json()).toEqual({ model: fakeModel(), signedImport: true });
    expect(built).toHaveLength(builds);
  });
});
