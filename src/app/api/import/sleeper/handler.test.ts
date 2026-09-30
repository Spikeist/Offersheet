import { describe, expect, it } from "vitest";
import { LeagueImportError, type SleeperImportRequest } from "@/adapters/types";
import { fakeDeps, fakeResult, jsonRequest } from "../../_lib/testFakes";
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
    getDeps: async () => fakeDeps(),
    choicesOf: (err) => (err instanceof ChoiceError ? err.choices : undefined),
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
