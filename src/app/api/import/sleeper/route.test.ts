/**
 * The real route module with the real Sleeper adapter module, except importSleeperLeague, which is
 * mocked (no network), and mocked deps. handler.test.ts covers the logic; this checks the wiring.
 */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ importSleeperLeague: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/adapters/sleeper", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), importSleeperLeague: mocks.importSleeperLeague }));
vi.mock("@/app/api/_lib/deps", async () => {
  const f = await import("../../_lib/testFakes");
  return { getImportDeps: async () => f.fakeDeps(), getHttp: () => f.fakeHttp({}) };
});

const URL = "http://localhost:3000/api/import/sleeper";

describe("app/api/import/sleeper/route.ts", () => {
  it("runs on Node and imports a league ID through the Sleeper adapter", async () => {
    const { fakeResult, jsonRequest } = await import("../../_lib/testFakes");
    mocks.importSleeperLeague.mockResolvedValue(fakeResult({ platform: "sleeper" }));
    const route = await import("./route");
    expect(route.runtime).toBe("nodejs");
    const res = await route.POST(jsonRequest(URL, { leagueId: "123456789012345678", season: 2026 }));
    expect(res.status).toBe(200);
    expect(mocks.importSleeperLeague).toHaveBeenCalledWith({ season: 2026, leagueId: "123456789012345678" }, expect.objectContaining({ resolver: expect.any(Object) }));
  });

  it("returns adapter errors as { error: { code, message } }", async () => {
    const { jsonRequest } = await import("../../_lib/testFakes");
    const { LeagueImportError } = await import("@/adapters/types");
    mocks.importSleeperLeague.mockRejectedValue(new LeagueImportError("LEAGUE_NOT_FOUND", "no such league", { platform: "sleeper", status: 404 }));
    const route = await import("./route");
    const res = await route.POST(jsonRequest(URL, { leagueId: "123456789012345678", season: 2026 }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "LEAGUE_NOT_FOUND", message: "League not found for that season." } });
  });

  it("turns the adapter's own league-choice error into a picker", async () => {
    const { jsonRequest } = await import("../../_lib/testFakes");
    const adapter = (await import("@/adapters/sleeper")) as unknown as { SleeperLeagueChoiceError: new (choices: unknown[]) => Error };
    mocks.importSleeperLeague.mockRejectedValue(
      new adapter.SleeperLeagueChoiceError([
        { leagueId: "222222222222222222", name: "Beta League", season: 2026, teams: 12, status: "in_season", supported: true },
        { leagueId: "111111111111111111", name: "Alpha League", season: 2026, teams: 10, status: "in_season", supported: true },
      ]),
    );
    const route = await import("./route");
    const res = await route.POST(jsonRequest(URL, { username: "zorblax_q", season: 2026 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      chooseLeague: {
        username: "zorblax_q",
        season: 2026,
        leagues: [
          { id: "111111111111111111", name: "Alpha League", teams: 10, status: "in_season", leagueType: null, bestBall: false, supported: true },
          { id: "222222222222222222", name: "Beta League", teams: 12, status: "in_season", leagueType: null, bestBall: false, supported: true },
        ],
      },
    });
  });
});
