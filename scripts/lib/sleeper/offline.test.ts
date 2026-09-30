import { describe, expect, it } from "vitest";
import { OfflineCacheMiss, type HttpResult, type RequestOptions } from "../http";
import type { ProbeContext } from "../probe";
import { endpoints, fetchJson } from "./api";
import { pinnedLeagueProblem } from "./discover";
import type { SleeperLeague } from "./types";

/** Just enough of a ProbeContext for fetchJson: a request function and the league cache options. */
function fakeProbe(request: (url: string, opts: RequestOptions) => Promise<HttpResult>): ProbeContext {
  return { request, leagueCache: (key: string) => ({ key: `sleeper:public:${key}`, ttlMs: 600_000, namespace: "league-sleeper" }) } as unknown as ProbeContext;
}

const cachedBody = (text: string): HttpResult => ({ url: "u", finalUrl: "u", status: 200, ok: true, contentType: "application/json", isHtml: false, text, json: undefined, headers: {}, elapsedMs: 0, fromCache: true, cachedAt: 0, attempts: 0 });

describe("fetchJson offline", () => {
  it("passes offline through and reports a cache miss without throwing", async () => {
    const seen: RequestOptions[] = [];
    const p = fakeProbe(async (url, opts) => {
      seen.push(opts);
      throw new OfflineCacheMiss(opts.label ?? url);
    });
    const f = await fetchJson(p, endpoints.rosters("123"), "league", { offline: true });
    expect(seen[0]?.offline).toBe(true);
    expect(f).toMatchObject({ ok: false, data: null, status: 0, offlineMiss: true, template: "https://api.sleeper.app/v1/league/{leagueId}/rosters" });
    expect(f.error).toMatch(/^offline/);
  });

  it("serves a cached copy as usual, and other failures stay ordinary errors", async () => {
    const hit = await fetchJson(fakeProbe(async () => cachedBody('[{"roster_id":1}]')), endpoints.rosters("123"), "league", { offline: true });
    expect(hit).toMatchObject({ ok: true, data: [{ roster_id: 1 }], status: 200 });
    const net = await fetchJson(
      fakeProbe(async () => {
        throw new Error("socket hang up");
      }),
      endpoints.state(),
    );
    expect(net.offlineMiss).toBeUndefined();
    expect(net.error).toBe("socket hang up");
  });
});

describe("pinned fallback league", () => {
  const lg = (settings: Record<string, unknown>, extra: Partial<SleeperLeague> = {}) =>
    ({ league_id: "1", status: "in_season", total_rosters: 12, season: "2026", sport: "nfl", season_type: "regular", settings: { last_scored_leg: 3, start_week: 1, ...settings }, scoring_settings: {}, roster_positions: [], ...extra }) as SleeperLeague;

  it("is kept even when it stops qualifying, with the reason for the report", () => {
    expect(pinnedLeagueProblem(lg({}), 2026)).toBeNull();
    expect(pinnedLeagueProblem(lg({ type: 3 }), 2026)).toMatch(/no longer meets the fallback criteria/);
    expect(pinnedLeagueProblem(lg({}, { status: "complete" }), 2026)).toMatch(/no longer meets/);
  });
});
