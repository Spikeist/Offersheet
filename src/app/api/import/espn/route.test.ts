/**
 * The real route module, wired to a mocked adapter and mocked deps (no network). handler.test.ts
 * covers the logic; this checks the wiring.
 */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ importEspnLeague: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/adapters/espn", () => ({ importEspnLeague: mocks.importEspnLeague }));
vi.mock("@/app/api/_lib/deps", async () => {
  const f = await import("../../_lib/testFakes");
  return { getImportDeps: async () => f.fakeDeps(), getHttp: () => f.fakeHttp({}) };
});

describe("app/api/import/espn/route.ts", () => {
  it("runs on Node and imports through the ESPN adapter", async () => {
    const { fakeResult, jsonRequest } = await import("../../_lib/testFakes");
    mocks.importEspnLeague.mockResolvedValue(fakeResult());
    const route = await import("./route");
    expect(route.runtime).toBe("nodejs");
    const res = await route.POST(jsonRequest("http://localhost:3000/api/import/espn", { leagueId: "4242", season: 2026 }));
    expect(res.status).toBe(200);
    expect(mocks.importEspnLeague).toHaveBeenCalledTimes(1);
    const [req, deps] = mocks.importEspnLeague.mock.calls[0] ?? [];
    expect(req).toMatchObject({ leagueId: "4242", season: 2026 });
    expect(deps).toHaveProperty("resolver");
    expect(await res.json()).toMatchObject({ snapshot: { name: "The Gloopdorf Invitational" }, usedEspnCookies: false });
  });
});
