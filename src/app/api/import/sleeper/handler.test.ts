import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { LeagueImportError, type SleeperImportRequest } from "@/adapters/types";
import { workLimits } from "@/server/limits";
import { fakeDeps, fakeResult, gzipRequest, jsonRequest } from "../../_lib/testFakes";
import { createSleeperImportHandler, type AdapterLeagueChoice } from "./handler";

const URL = "http://localhost:3000/api/import/sleeper";
const NOW = () => new Date("2026-09-29T23:00:00.000Z");

/** Stands in for the adapter's SleeperLeagueChoiceError (a NO_LEAGUE error carrying the choices). */
class ChoiceError extends LeagueImportError {
  constructor(readonly choices: AdapterLeagueChoice[]) {
    super("NO_LEAGUE", `That Sleeper user has ${choices.length} leagues this season; pick one.`, { platform: "sleeper" });
  }
}

// Fictional league names and IDs.
const CHOICES: AdapterLeagueChoice[] = [
  { leagueId: "333333333333333333", name: "Zeta Guillotine", teams: 18, status: "in_season", leagueType: "guillotine", bestBall: false, supported: false },
  { leagueId: "222222222222222222", name: "Beta Dynasty", teams: 12, status: "in_season", leagueType: "dynasty", bestBall: true, supported: true },
  { leagueId: "111111111111111111", name: "Alpha Redraft", teams: 10, status: "pre_draft", leagueType: "redraft", bestBall: false, supported: true },
];

function setup(importLeague: (req: SleeperImportRequest) => Promise<ReturnType<typeof fakeResult>> = async () => fakeResult({ platform: "sleeper" })) {
  const calls: SleeperImportRequest[] = [];
  const handler = createSleeperImportHandler({
    importLeague: async (req) => {
      calls.push(req);
      return importLeague(req);
    },
    importUpload: async () => {
      throw new Error("no upload in these tests (upload.test.ts covers them)");
    },
    getDeps: async () => fakeDeps(),
    choicesOf: (err) => (err instanceof ChoiceError ? err.choices : undefined),
    sign: () => undefined,
    now: NOW,
  });
  return { handler, calls };
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("POST /api/import/sleeper", () => {
  it("imports by username, so the adapter can find the user's team", async () => {
    const { handler, calls } = setup();
    const res = await handler(jsonRequest(URL, { season: 2026, username: " @zorblax_q " }));
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ season: 2026, username: "zorblax_q" }]);
    expect(await json(res)).toMatchObject({ notes: [], dataSources: [{ name: "Sleeper players" }] });
  });

  it("passes the Import Report's Refresh through to the adapter", async () => {
    const { handler, calls } = setup();
    await handler(jsonRequest(URL, { season: 2026, username: "zorblax_q", leagueId: "111111111111111111", refresh: true }));
    expect(calls).toEqual([{ season: 2026, username: "zorblax_q", leagueId: "111111111111111111", refresh: true }]);
  });

  it("turns the adapter's league choices into a picker, supported leagues first", async () => {
    const { handler } = setup(async () => {
      throw new ChoiceError(CHOICES);
    });
    const res = await handler(jsonRequest(URL, { season: 2026, username: "zorblax_q" }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      chooseLeague: {
        username: "zorblax_q",
        season: 2026,
        leagues: [
          { id: "111111111111111111", name: "Alpha Redraft", teams: 10, status: "pre_draft", leagueType: "redraft", bestBall: false, supported: true },
          { id: "222222222222222222", name: "Beta Dynasty", teams: 12, status: "in_season", leagueType: "dynasty", bestBall: true, supported: true },
          { id: "333333333333333333", name: "Zeta Guillotine", teams: 18, status: "in_season", leagueType: "guillotine", bestBall: false, supported: false },
        ],
      },
    });
  });

  it("passes the picked league back to the adapter", async () => {
    const { handler, calls } = setup();
    const res = await handler(jsonRequest(URL, { season: 2026, username: "zorblax_q", chooseLeagueId: "222222222222222222" }));
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ season: 2026, username: "zorblax_q", chooseLeagueId: "222222222222222222" }]);
  });

  it("imports by league ID or pasted link, with an optional username for my-team detection", async () => {
    const { handler, calls } = setup();
    expect((await handler(jsonRequest(URL, { season: "2026", leagueId: "123456789012345678", username: "" }))).status).toBe(200);
    expect((await handler(jsonRequest(URL, { season: 2026, leagueId: "https://sleeper.com/leagues/123456789012345678/team" }))).status).toBe(200);
    expect((await handler(jsonRequest(URL, { season: 2026, leagueId: "123456789012345678", username: "zorblax_q" }))).status).toBe(200);
    expect(calls).toEqual([
      { season: 2026, leagueId: "123456789012345678" },
      { season: 2026, leagueId: "123456789012345678" },
      { season: 2026, leagueId: "123456789012345678", username: "zorblax_q" },
    ]);
  });

  it.each([
    ["USER_NOT_FOUND", 404, "We couldn't find that Sleeper username."],
    ["NO_LEAGUE", 404, "We didn't find any Sleeper leagues for that username in 2026."],
    ["SOURCE_DOWN", 502, "Sleeper isn't responding right now."],
    ["LEAGUE_NOT_FOUND", 404, "League not found for that season."],
  ] as const)("maps %s to HTTP %i", async (code, status, message) => {
    const { handler } = setup(async () => {
      throw new LeagueImportError(code, "adapter detail", { platform: "sleeper" });
    });
    const res = await handler(jsonRequest(URL, { season: 2026, username: "zorblax_q" }));
    expect(res.status).toBe(status);
    const err = (await json(res)).error as { code: string; message: string };
    expect(err.code).toBe(code);
    expect(err.message).toContain(message);
  });

  it("passes the adapter's friendly message for unsupported leagues", async () => {
    const { handler } = setup(async () => {
      throw new LeagueImportError("UNSUPPORTED_LEAGUE", "Guillotine leagues aren't supported yet.", { platform: "sleeper" });
    });
    const res = await handler(jsonRequest(URL, { season: 2026, leagueId: "123456789012345678" }));
    expect(res.status).toBe(422);
    expect(await json(res)).toEqual({ error: { code: "UNSUPPORTED_LEAGUE", message: "Guillotine leagues aren't supported yet." } });
  });

  it("validates the request before calling Sleeper", async () => {
    const { handler, calls } = setup();
    const neither = await handler(jsonRequest(URL, { season: 2026 }));
    expect(neither.status).toBe(400);
    expect(((await json(neither)).error as { message: string }).message).toBe("Enter your Sleeper username or a league ID.");
    const badId = await handler(jsonRequest(URL, { season: 2026, leagueId: "abc" }));
    expect(((await json(badId)).error as { message: string }).message).toMatch(/long number/);
    const badName = await handler(jsonRequest(URL, { season: 2026, username: "two words" }));
    expect(((await json(badName)).error as { message: string }).message).toBe("That doesn't look like a Sleeper username.");
    const badSeason = await handler(jsonRequest(URL, { season: 2030, leagueId: "123456789012345678" }));
    expect(((await json(badSeason)).error as { message: string }).message).toBe("Pick a season from 2018 to 2026.");
    const foreign = await handler(jsonRequest(URL, { season: 2026, username: "zorblax_q" }, { origin: "https://evil.example" }));
    expect(foreign.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});

describe("POST /api/import/sleeper with a league the browser read (Part B, track BF)", () => {
  const upload = (over: Record<string, unknown> = {}) => ({
    v: 1,
    platform: "sleeper",
    request: { leagueId: "111111111111111111", season: 2026, username: "zorblax_q" },
    sentAt: 1_000,
    parts: [{ url: "https://api.sleeper.app/v1/league/111111111111111111", status: 200, json: { league_id: "111111111111111111" }, at: 900 }],
    ...over,
  });

  it("imports it by replaying the upload, says the browser read it, signs it (no model part for Sleeper), and never offers a picker", async () => {
    const uploads: unknown[] = [];
    const handler = createSleeperImportHandler({
      importLeague: async () => {
        throw new Error("the browser read this league");
      },
      importUpload: async (u) => {
        uploads.push(u);
        return fakeResult({ platform: "sleeper" });
      },
      getDeps: async () => fakeDeps(),
      choicesOf: () => undefined,
      sign: (platform, content) => (platform === "sleeper" && JSON.stringify(content.modelPart) === "{}" ? { issuedAt: 1, token: "made-up" } : undefined),
      now: NOW,
    });
    const res = await handler(gzipRequest(URL, upload()));
    expect(res.status).toBe(200);
    expect(uploads).toEqual([upload()]);
    expect(await json(res)).toMatchObject({ readBy: "browser", modelPart: {}, signed: { issuedAt: 1, token: "made-up" }, dataSources: [{ name: "Sleeper players" }] });
    for (const bad of [upload({ platform: "espn" }), upload({ request: { leagueId: "111111111111111111", season: 2026, username: "two words" } }), upload({ parts: "x" })]) {
      const r = await handler(gzipRequest(URL, bad));
      expect(r.status).toBe(400);
      expect(((await json(r)).error as { code: string }).code).toBe("BAD_UPLOAD");
    }
  });

  it("a replay that fails as a Sleeper outage would is the upload's (BAD_UPLOAD, nothing logged), and a body's unpacked size is paid for first (B4 security review)", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const charged: number[] = [];
    const handlerWith = (importUpload: () => Promise<ReturnType<typeof fakeResult>>, verdict: "ok" | "group" = "ok") =>
      createSleeperImportHandler({
        importLeague: async () => fakeResult({ platform: "sleeper" }),
        importUpload,
        getDeps: async () => fakeDeps(),
        choicesOf: () => undefined,
        chargeWork: async (units) => (charged.push(units), verdict),
        now: NOW,
      });
    const down = handlerWith(async () => {
      throw new LeagueImportError("SOURCE_DOWN", "Sleeper isn't responding right now.", { platform: "sleeper" });
    });
    const res = await down(gzipRequest(URL, upload()));
    expect(res.status).toBe(400);
    expect(((await json(res)).error as { code: string }).code).toBe("BAD_UPLOAD");
    expect(logged).not.toHaveBeenCalled();
    // A league the user typed wrong is still the platform's own answer.
    const missing = handlerWith(async () => {
      throw new LeagueImportError("LEAGUE_NOT_FOUND", "No Sleeper league with that ID.", { platform: "sleeper" });
    });
    expect((await missing(gzipRequest(URL, upload()))).status).toBe(404);
    // 1.2 million zeros in a field nothing reads: a few KB gzipped, 1.2 MB unpacked, so its unpacked size costs more.
    const text = JSON.stringify(upload({ parts: [{ url: "https://api.sleeper.app/v1/league/111111111111111111", status: 200, json: { league_id: "111111111111111111", pad: "0".repeat(1_200_000) }, at: 900 }] }));
    const packed = gzipSync(Buffer.from(text));
    const post = () => new Request(URL, { method: "POST", headers: { "content-type": "application/gzip", "content-length": String(packed.length), host: "localhost:3000" }, body: packed });
    const imports: unknown[] = [];
    const refused = await handlerWith(async () => (imports.push(1), fakeResult({ platform: "sleeper" })), "group")(post());
    expect(refused.status).toBe(503);
    expect(((await json(refused)).error as { code: string }).code).toBe("BUSY");
    expect(imports).toHaveLength(0);
    expect(charged).toEqual([Math.ceil(Buffer.byteLength(text) / workLimits.unpackedUnitBytes) - Math.ceil(packed.length / workLimits.unitBytes)]);
  });

  it("answers the JSON path's imports as read by the server", async () => {
    const { handler } = setup();
    expect(await json(await handler(jsonRequest(URL, { season: 2026, leagueId: "111111111111111111" })))).toMatchObject({ readBy: "server", modelPart: {} });
  });

  it("doesn't sign an import whose model build would cost more than any real league's: BAD_UPLOAD (review BF-R1)", async () => {
    const rule = { kind: "range", stat: "rush_yd", min: 100, max: 199, points: 1 } as const;
    const heavy = fakeResult({
      platform: "sleeper",
      teams: Array.from({ length: 30 }, (_, t) => ({ id: String(t), roster: Array.from({ length: 60 }, (_, i) => `${t}-${i}`), ir: [], taxi: [] })) as never,
      freeAgents: [],
      settings: { scoring: { perStat: {}, rules: Array.from({ length: 100 }, () => rule), unmapped: [] } } as never,
    });
    const signed: unknown[] = [];
    const handler = createSleeperImportHandler({
      importLeague: async () => fakeResult({ platform: "sleeper" }),
      importUpload: async () => heavy,
      getDeps: async () => fakeDeps(),
      choicesOf: () => undefined,
      sign: (_platform, content) => (signed.push(content), { issuedAt: 1, token: "made-up" }),
      now: NOW,
    });
    const res = await handler(gzipRequest(URL, upload()));
    expect(res.status).toBe(400);
    expect(((await json(res)).error as { code: string }).code).toBe("BAD_UPLOAD");
    expect(signed).toHaveLength(0);
  });
});
