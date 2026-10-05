/**
 * The real route module, wired to a mocked adapter and mocked deps (no network). handler.test.ts
 * covers the logic; this checks the wiring.
 */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ importEspnLeagueForModel: vi.fn(), importEspnUpload: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/adapters/espn", () => ({ importEspnLeagueForModel: mocks.importEspnLeagueForModel, importEspnUpload: mocks.importEspnUpload }));
vi.mock("@/app/api/_lib/deps", async () => {
  const f = await import("../../_lib/testFakes");
  return { getImportDeps: async () => f.fakeDeps(), getHttp: () => f.fakeHttp({}) };
});

describe("app/api/import/espn/route.ts", () => {
  it("runs on Node and imports through the ESPN adapter, with ESPN's projections as the import's model part", async () => {
    const { fakeResult, jsonRequest } = await import("../../_lib/testFakes");
    const espn = { "4046": { 4: 17.9 } };
    mocks.importEspnLeagueForModel.mockResolvedValue({ result: fakeResult(), espn });
    const route = await import("./route");
    expect(route.runtime).toBe("nodejs");
    const res = await route.POST(jsonRequest("http://localhost:3000/api/import/espn", { leagueId: "4242", season: 2026 }));
    expect(res.status).toBe(200);
    expect(mocks.importEspnLeagueForModel).toHaveBeenCalledTimes(1);
    expect(mocks.importEspnUpload).not.toHaveBeenCalled();
    const [req, deps] = mocks.importEspnLeagueForModel.mock.calls[0] ?? [];
    expect(req).toMatchObject({ leagueId: "4242", season: 2026 });
    expect(deps).toHaveProperty("resolver");
    expect(await res.json()).toMatchObject({ snapshot: { name: "The Gloopdorf Invitational" }, usedEspnCookies: false, readBy: "server", modelPart: { espn } });
  });
});
