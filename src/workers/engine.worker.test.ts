/**
 * The engine worker's message protocol (CLAUDE.md §3), tested through its handler: no real Worker
 * (Vitest runs in Node, where the module registers no listener). The League model builder is a fake.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/engine/league", () => ({
  buildLeagueModel: () => {
    throw new Error("the tests pass their own builder");
  },
}));

import type { ModelInputs } from "@/engine/inputs";
import type { LeagueModel } from "@/engine/leagueModel";
import type { LeagueSnapshot } from "@/engine/model";
import { ENGINE_ERROR_MESSAGE, handleEngineRequest, type EngineHandlerDeps, type LeagueRequest } from "./engine.worker";

const snapshot = { platform: "espn", leagueId: "4242", season: 2026, myTeamId: null, teams: [] } as unknown as LeagueSnapshot;
const model = { version: 1 } as unknown as ModelInputs;
const request: LeagueRequest = { type: "league", id: 7, snapshot, model, myTeamId: "3", nowIso: "2026-09-30T02:00:00.000Z" };
const RESULT = { weeks: [4, 5] } as unknown as LeagueModel;

type Build = NonNullable<EngineHandlerDeps["build"]>;

describe("handleEngineRequest (§3: the engine runs in a Web Worker)", () => {
  it("builds the League model with the user's team and the request's time, and echoes the id", () => {
    const calls: Parameters<Build>[] = [];
    const build = ((...args: Parameters<Build>) => {
      calls.push(args);
      return RESULT;
    }) as Build;
    const clock = () => 12.5;
    expect(handleEngineRequest(request, { build, clock })).toEqual({ type: "league", id: 7, result: RESULT });
    const [snap, inputs, opts] = calls[0] ?? [];
    expect(snap).toEqual({ ...snapshot, myTeamId: "3" });
    expect(snapshot.myTeamId).toBeNull(); // the caller's snapshot isn't changed
    expect(inputs).toBe(model);
    expect(opts?.now.toISOString()).toBe("2026-09-30T02:00:00.000Z");
    expect(opts?.clock).toBe(clock);
  });

  it("passes no clock when none is given", () => {
    let seen: Parameters<Build>[2] | undefined;
    const build = ((_s: unknown, _m: unknown, opts: Parameters<Build>[2]) => {
      seen = opts;
      return RESULT;
    }) as unknown as Build;
    handleEngineRequest({ ...request, myTeamId: null }, { build });
    expect(seen && "clock" in seen).toBe(false);
  });

  it("turns an engine failure into an error reply with the same id", () => {
    const build = (() => {
      throw new RangeError("week 99 out of range");
    }) as Build;
    expect(handleEngineRequest(request, { build })).toEqual({ type: "error", id: 7, message: ENGINE_ERROR_MESSAGE, detail: "RangeError: week 99 out of range" });
  });

  it("answers anything that isn't a request with an error, never a throw", () => {
    const build = (() => RESULT) as Build;
    expect(handleEngineRequest(undefined, { build })).toMatchObject({ type: "error", id: -1 });
    expect(handleEngineRequest("league", { build })).toMatchObject({ type: "error", id: -1 });
    expect(handleEngineRequest({ ...request, type: "trades" }, { build })).toMatchObject({ type: "error", id: 7 });
    expect(handleEngineRequest({ ...request, snapshot: null }, { build })).toMatchObject({ type: "error", id: 7 });
    expect(handleEngineRequest({ ...request, myTeamId: 3 }, { build })).toMatchObject({ type: "error", id: 7 });
    expect(handleEngineRequest({ ...request, nowIso: "yesterday" }, { build })).toMatchObject({ type: "error", id: 7, message: ENGINE_ERROR_MESSAGE });
  });
});
