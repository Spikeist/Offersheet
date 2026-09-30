/**
 * The real route module with the real Sleeper adapter module, except importSleeperLeague, which is
 * mocked (no network), mocked deps and a mocked model-inputs builder. handler.test.ts covers the
 * logic; this checks the wiring.
 */
import { describe, expect, it, vi } from "vitest";
import type { ModelInputs } from "@/engine/inputs";

const mocks = vi.hoisted(() => ({ importSleeperLeague: vi.fn(), buildModelInputs: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/adapters/sleeper", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), importSleeperLeague: mocks.importSleeperLeague }));
vi.mock("@/server/modelInputs", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), buildModelInputs: mocks.buildModelInputs }));
vi.mock("@/app/api/_lib/deps", async () => {
  const f = await import("../../_lib/testFakes");
  return { getImportDeps: async () => f.fakeDeps(), getHttp: () => f.fakeHttp({}) };
});

const URL = "http://localhost:3000/api/model/sleeper";
const LEAGUE = "123456789012345678";

describe("app/api/model/sleeper/route.ts", () => {
  it("runs on Node, imports the league ID through the Sleeper adapter and builds the inputs for its snapshot", async () => {
    const { fakeResult, jsonRequest } = await import("../../_lib/testFakes");
    const model = { version: 1, season: 2026, currentWeek: 4, lastWeek: 17, builtAt: "2026-09-29T23:00:00.000Z", nfl: { byeWeek: {}, kickoffs: {} }, players: {}, espnProjections: false, market: null, sources: [], warnings: [], notes: [] } satisfies ModelInputs;
    mocks.importSleeperLeague.mockResolvedValue(fakeResult({ platform: "sleeper", leagueId: LEAGUE }));
    mocks.buildModelInputs.mockResolvedValue(model);
    const route = await import("./route");
    expect(route.runtime).toBe("nodejs");
    const res = await route.POST(jsonRequest(URL, { leagueId: LEAGUE, season: 2026 }));
    expect(res.status).toBe(200);
    expect(mocks.importSleeperLeague).toHaveBeenCalledWith({ season: 2026, leagueId: LEAGUE }, expect.objectContaining({ resolver: expect.any(Object) }));
    const [, deps] = mocks.importSleeperLeague.mock.calls[0] ?? [];
    const [args] = mocks.buildModelInputs.mock.calls[0] ?? [];
    expect(args).toMatchObject({ snapshot: { platform: "sleeper", leagueId: LEAGUE } });
    expect(args).not.toHaveProperty("espn");
    expect(args.http).toBe(deps.http);
    expect(await res.json()).toEqual({ import: expect.objectContaining({ snapshot: expect.objectContaining({ leagueId: LEAGUE }), dataSources: [{ name: "Sleeper players", fetchedAt: "2026-09-29T22:00:00.000Z" }] }), model });
  });

  it("returns adapter errors as { error: { code, message } } and builds no inputs", async () => {
    const { jsonRequest } = await import("../../_lib/testFakes");
    const { LeagueImportError } = await import("@/adapters/types");
    mocks.importSleeperLeague.mockRejectedValue(new LeagueImportError("LEAGUE_NOT_FOUND", "no such league", { platform: "sleeper", status: 404 }));
    const route = await import("./route");
    const res = await route.POST(jsonRequest(URL, { leagueId: LEAGUE, season: 2026 }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "LEAGUE_NOT_FOUND", message: "League not found for that season." } });
    expect(mocks.buildModelInputs).not.toHaveBeenCalled();
  });
});
