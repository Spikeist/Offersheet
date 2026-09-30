/**
 * Test doubles for the import route handlers (no network). Fictional data only.
 */
import type { HttpClient, HttpRequestOptions, HttpResponse, ImportDeps, ImportResult } from "@/adapters/types";
import type { PlayerIdResolver } from "@/data/types";
import type { LeagueSnapshot } from "@/engine/model";

export const fakeResolver: PlayerIdResolver = {
  canonical: () => undefined,
  sleeperPlayer: () => undefined,
  defenseId: () => undefined,
  sources: () => [{ name: "Sleeper players", fetchedAt: "2026-09-29T22:00:00.000Z" }],
};

/** A fake HttpClient answering from a URL → response table; records every URL it was asked for. */
export function fakeHttp(routes: Record<string, { status?: number; json?: unknown; html?: boolean }>): HttpClient & { calls: string[]; options: HttpRequestOptions[] } {
  const calls: string[] = [];
  const options: HttpRequestOptions[] = [];
  return {
    calls,
    options,
    async get(url: string, opts: HttpRequestOptions = {}): Promise<HttpResponse> {
      calls.push(url);
      options.push(opts);
      const r = routes[url];
      if (!r) return { status: 404, ok: false, isHtml: false, json: undefined, text: "", fromCache: false };
      const status = r.status ?? 200;
      return { status, ok: status >= 200 && status < 300, isHtml: r.html ?? false, json: r.json, text: JSON.stringify(r.json ?? null), fromCache: false };
    },
  };
}

export function fakeDeps(http: HttpClient = fakeHttp({})): ImportDeps {
  return { http, resolver: fakeResolver, now: new Date("2026-09-29T23:00:00.000Z") };
}

export function fakeResult(overrides: Partial<LeagueSnapshot> = {}): ImportResult {
  const snapshot = {
    platform: "espn",
    leagueId: "4242",
    season: 2026,
    name: "The Gloopdorf Invitational",
    fetchedAt: "2026-09-29T23:00:00.000Z",
    currentWeek: 4,
    teams: [{ id: "1", name: "Moonbeam Mudcats", ownerName: "Zorblax Quintavious" }],
    myTeamId: null,
    players: {},
    schedule: [],
    transactions: [],
    freeAgents: [],
    warnings: [],
    ...overrides,
  } as unknown as LeagueSnapshot;
  return { snapshot, notes: [] };
}

export function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", host: "localhost:3000", ...headers }, body: JSON.stringify(body) });
}
