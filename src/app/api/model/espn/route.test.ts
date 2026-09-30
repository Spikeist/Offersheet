/**
 * The real route module, wired to a mocked ESPN adapter and mocked deps (no network). handler.test.ts
 * covers the logic; this checks the wiring, once with the real model-inputs builder (every source
 * down on the fake client: warnings, not an error).
 */
import { describe, expect, it, vi } from "vitest";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueSettings, LeagueSnapshot, PlayerInfo } from "@/engine/model";
import type { ModelResponse } from "@/lib/api";

const mocks = vi.hoisted(() => ({ importEspnLeagueForModel: vi.fn(), buildModelInputs: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/adapters/espn", () => ({ importEspnLeagueForModel: mocks.importEspnLeagueForModel }));
vi.mock("@/server/modelInputs", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), buildModelInputs: mocks.buildModelInputs }));
vi.mock("@/app/api/_lib/deps", async () => {
  const f = await import("../../_lib/testFakes");
  return { getImportDeps: async () => f.fakeDeps(), getHttp: () => f.fakeHttp({}) };
});

const URL = "http://localhost:3000/api/model/espn";
const ESPN = { "4046": { 3: 17.1, 4: 17.9 } };

/** Just enough league for the real builder (fictional). */
const SETTINGS = {
  numTeams: 10,
  leagueType: "redraft",
  lineup: [{ slot: "QB", count: 1, eligible: ["QB"] }],
  benchSlots: 6,
  irSlots: 1,
  taxiSlots: 0,
  maxRosterSize: 7,
  scoring: { perStat: { pass_yd: 0.04, pass_td: 4, rec: 0.5 }, rules: [], unmapped: [] },
  regularSeasonWeeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  playoffWeeks: [15, 16, 17],
  playoffTeams: 4,
  medianGame: false,
  pointsOnly: false,
  tradeDeadline: null,
  tradeReview: "none",
} satisfies LeagueSettings;

const PLAYER: PlayerInfo = { id: "4046", name: "Quill Arbuckle", pos: "QB", eligible: ["QB"], nflTeam: "KC", injury: "ACTIVE", ids: { espn: "3000001" } };

describe("app/api/model/espn/route.ts", () => {
  it("runs on Node, imports through the ESPN adapter's model import and builds the inputs for its snapshot", async () => {
    const { fakeResult, jsonRequest } = await import("../../_lib/testFakes");
    const model = { version: 1, season: 2026, currentWeek: 4, lastWeek: 17, builtAt: "2026-09-29T23:00:00.000Z", nfl: { byeWeek: {}, kickoffs: {} }, players: {}, espnProjections: true, market: null, sources: [], warnings: [], notes: [] } satisfies ModelInputs;
    mocks.importEspnLeagueForModel.mockResolvedValue({ result: fakeResult(), espn: ESPN });
    mocks.buildModelInputs.mockResolvedValue(model);
    const route = await import("./route");
    expect(route.runtime).toBe("nodejs");
    const res = await route.POST(jsonRequest(URL, { leagueId: "4242", season: 2026 }));
    expect(res.status).toBe(200);
    expect(mocks.importEspnLeagueForModel).toHaveBeenCalledTimes(1);
    const [req, deps] = mocks.importEspnLeagueForModel.mock.calls[0] ?? [];
    expect(req).toEqual({ leagueId: "4242", season: 2026 });
    expect(deps).toHaveProperty("resolver");
    const [args] = mocks.buildModelInputs.mock.calls[0] ?? [];
    expect(args).toMatchObject({ snapshot: { name: "The Gloopdorf Invitational" }, espn: ESPN });
    expect(args.http).toBe(deps.http);
    expect(args.resolver).toBe(deps.resolver);
    expect(await res.json()).toEqual({ import: expect.objectContaining({ snapshot: expect.objectContaining({ name: "The Gloopdorf Invitational" }), usedEspnCookies: false }), model });
  });

  it("with the real builder, every model source down is a warning in a 200 answer, never an error", async () => {
    const { fakeResult, jsonRequest } = await import("../../_lib/testFakes");
    const real = await vi.importActual<typeof import("@/server/modelInputs")>("@/server/modelInputs");
    mocks.buildModelInputs.mockImplementation(real.buildModelInputs);
    const team = { id: "1", name: "Moonbeam Mudcats", ownerName: "Zorblax Quintavious", roster: ["4046"], ir: [], taxi: [], record: { w: 2, l: 1, t: 0 }, pointsFor: 300, pointsAgainst: 280 };
    mocks.importEspnLeagueForModel.mockResolvedValue({ result: fakeResult({ settings: SETTINGS, teams: [team], players: { "4046": PLAYER } } as Partial<LeagueSnapshot>), espn: ESPN });
    const route = await import("./route");
    const res = await route.POST(jsonRequest(URL, { leagueId: "4242", season: 2026 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ModelResponse;
    expect(body.model.warnings.map((w) => w.code)).toEqual(["NFL_SCHEDULE_UNAVAILABLE", "PROJECTIONS_WEEK_UNAVAILABLE", "SEASON_PROJECTIONS_UNAVAILABLE", "STATS_WEEK_UNAVAILABLE", "FANTASYCALC_UNAVAILABLE"]);
    expect(body.model).toMatchObject({ version: 1, currentWeek: 4, lastWeek: 17, market: null, espnProjections: true, players: { "4046": { sleeper: {}, actual: {}, espn: { 3: 17.1, 4: 17.9 } } } });
  });

  it("returns adapter errors as { error: { code, message } } and builds no inputs", async () => {
    const { jsonRequest } = await import("../../_lib/testFakes");
    const { LeagueImportError } = await import("@/adapters/types");
    mocks.importEspnLeagueForModel.mockRejectedValue(new LeagueImportError("LEAGUE_NOT_FOUND", "no such league", { platform: "espn", status: 404 }));
    const route = await import("./route");
    const res = await route.POST(jsonRequest(URL, { leagueId: "4242", season: 2026 }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "LEAGUE_NOT_FOUND", message: "League not found for that season." } });
    expect(mocks.buildModelInputs).not.toHaveBeenCalled();
  });
});
