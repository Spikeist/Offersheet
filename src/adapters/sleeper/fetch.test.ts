import { describe, expect, it } from "vitest";
import { LeagueImportError, type HttpResponse } from "@/adapters/types";
import { TTL } from "@/server/cache";
import { FREE_AGENT_RANK_WEEKS, fetchSleeperLeague, freeAgentRankWeeks, leagueChoicesOf, parseSleeperLeagueId, PROJECTIONS_POLICY, requireJson, SleeperLeagueChoiceError, sleeperUrls, startablePositions } from "./fetch";
import { importSleeperLeague } from "./index";
import { fakeHttp, fakeResolver, json, loadTestLeague, type TestLeague } from "./test-helpers";

const NOW = new Date("2026-09-29T18:00:00Z");
const USERNAME = "zorblax_q";
const POSITIONS_REQUESTED = ["QB", "RB", "WR", "TE", "K", "DEF"];
/** The projection weeks the fetch half asks for in week 4: 4, 5 and 6. */
const PROJECTION_WEEKS = [4, 5, 6];
const projectionsUrl = (week: number) => sleeperUrls.projections(2026, week, POSITIONS_REQUESTED);

function routesFor(t: TestLeague): Map<string, HttpResponse | (() => HttpResponse)> {
  const id = String(t.league.league_id);
  const routes = new Map<string, HttpResponse | (() => HttpResponse)>([
    [sleeperUrls.state(), json(t.state)],
    [sleeperUrls.league(id), json(t.league)],
    [sleeperUrls.users(id), json(t.users)],
    [sleeperUrls.rosters(id), json(t.rosters)],
    [sleeperUrls.tradedPicks(id), json(t.tradedPicks)],
    [sleeperUrls.drafts(id), json(t.drafts)],
    [sleeperUrls.user(USERNAME), json({ user_id: t.meta.me.userId, username: USERNAME, display_name: "Zorblax Quintavious" })],
    [sleeperUrls.userLeagues(t.meta.me.userId, 2026), json([t.league])],
  ]);
  // Weeks 5 and 6 re-use week 4's rows (the fixture holds one projection week).
  for (const w of PROJECTION_WEEKS) routes.set(projectionsUrl(w), json(t.projections.map((r) => ({ ...r, week: w }))));
  for (let w = 1; w <= 14; w++) routes.set(sleeperUrls.matchups(id, w), json(t.matchups[w]));
  for (let leg = 1; leg <= 4; leg++) routes.set(sleeperUrls.transactions(id, leg), json(t.transactions[leg] ?? []));
  return routes;
}

async function expectRejects(p: Promise<unknown>, code: string): Promise<LeagueImportError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(LeagueImportError);
    expect((err as LeagueImportError).code).toBe(code);
    return err as LeagueImportError;
  }
  throw new Error(`expected ${code}`);
}

const html: HttpResponse = { status: 200, ok: true, isHtml: true, json: undefined, text: "<!doctype html><html></html>", fromCache: false };

/** The test league is at leg 3: matchups and transactions of weeks before leg 2 are closed (6 h). */
const closedWeek = (url: string) => /\/(matchups|transactions)\/1$/.test(url);

describe("fetchSleeperLeague by league ID", () => {
  it("collects every response the normalizer needs, politely cached", async () => {
    const t = loadTestLeague();
    const http = fakeHttp(routesFor(t));
    const out = await fetchSleeperLeague({ season: 2026, leagueId: String(t.league.league_id) }, { http });
    expect(out.userId).toBeUndefined();
    expect(out.warnings).toEqual([]);
    expect(Object.keys(out.raw.matchups).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]); // regular season only
    expect(Object.keys(out.raw.transactions).map(Number)).toEqual([1, 2, 3, 4]); // legs 1..current week
    expect(out.raw.projectionWeek).toBe(4);
    expect(Object.keys(out.raw.projections ?? {}).map(Number)).toEqual(PROJECTION_WEEKS); // this week and the next two
    expect(out.raw.projections?.[4]).toEqual(t.projections);
    const byUrl = new Map(http.calls.map((c) => [c.url, c.opts]));
    expect(http.calls).toHaveLength(new Set(http.calls.map((c) => c.url)).size); // nothing fetched twice
    for (const [url, opts] of byUrl) {
      expect(opts?.bigIntsAsStrings).toBe(true);
      expect(opts?.cache?.key).toBe(`sleeper:${url}`);
      const projections = url.includes("/projections/");
      const want = projections ? TTL.projections : closedWeek(url) ? TTL.closedTransactions : TTL.league;
      expect(opts?.cache?.ttlMs).toBe(want);
      expect(opts?.cache?.retainMs).toBe(projections ? TTL.projectionsLater : want); // every week's projections are kept 24 hours (projectionsPolicy)
      expect(opts?.cacheIf !== undefined).toBe(projections); // an empty projections list isn't cached
    }
    expect([...byUrl.keys()].filter(closedWeek)).toHaveLength(2); // leg 3 now: week 1's matchups and transactions are closed
    expect([...byUrl.keys()].some((u) => u.includes("/players/nfl"))).toBe(false); // players come from the resolver
  });

  it("Refresh lowers the league-data TTL to a minute, but keeps it 10 minutes and leaves projections alone", async () => {
    const t = loadTestLeague();
    const http = fakeHttp(routesFor(t));
    await fetchSleeperLeague({ season: 2026, leagueId: String(t.league.league_id), refresh: true }, { http });
    for (const c of http.calls) {
      const projections = c.url.includes("/projections/");
      // Closed weeks keep their 6 hours: Refresh only re-reads the live part of the league.
      expect(c.opts?.cache?.ttlMs).toBe(projections ? TTL.projections : closedWeek(c.url) ? TTL.closedTransactions : TTL.leagueRefresh);
      // Refresh can't shorten how long a copy is kept (the privacy page's "about 10 minutes").
      expect(c.opts?.cache?.retainMs).toBe(projections ? TTL.projectionsLater : closedWeek(c.url) ? TTL.closedTransactions : TTL.league);
    }
  });

  it("accepts a pasted sleeper.com league link", async () => {
    const t = loadTestLeague();
    const out = await fetchSleeperLeague({ season: 2026, leagueId: ` https://sleeper.com/leagues/${t.league.league_id}/team ` }, { http: fakeHttp(routesFor(t)) });
    expect(out.raw.league).toEqual(t.league);
  });

  it("imports end to end: the user picks their team on the league-ID path", async () => {
    const t = loadTestLeague();
    const { snapshot, notes } = await importSleeperLeague({ season: 2026, leagueId: String(t.league.league_id) }, { http: fakeHttp(routesFor(t)), resolver: fakeResolver(t.players), now: NOW });
    expect(snapshot.teams).toHaveLength(12);
    expect(snapshot.myTeamId).toBeNull();
    expect(snapshot.schedule).toHaveLength(84);
    expect(snapshot.freeAgents.length).toBeGreaterThan(0);
    expect(snapshot.leagueWeek).toBe(3);
    expect(snapshot.warnings).toEqual([]);
    expect(notes.some((n) => n.includes("projections for weeks 4–6"))).toBe(true);
  });

  it("with a league ID, a username Sleeper doesn't know is a warning, not a failed import (SLP-5)", async () => {
    const t = loadTestLeague();
    const id = String(t.league.league_id);
    const routes = routesFor(t);
    routes.set(sleeperUrls.user("typo_name"), json(null)); // Sleeper: 200 with a literal null
    const { snapshot } = await importSleeperLeague({ season: 2026, leagueId: id, username: "typo_name" }, { http: fakeHttp(routes), resolver: fakeResolver(t.players), now: NOW });
    expect(snapshot.myTeamId).toBeNull();
    expect(snapshot.warnings).toEqual([{ code: "USER_NOT_FOUND", message: 'There\'s no Sleeper user named "typo_name", so we couldn\'t tell which team is yours. Pick your team.', platformPath: "user" }]);

    const down = routesFor(t);
    down.set(sleeperUrls.user(USERNAME), json(null, 503));
    const r2 = await importSleeperLeague({ season: 2026, leagueId: id, username: USERNAME }, { http: fakeHttp(down), resolver: fakeResolver(t.players), now: NOW });
    expect(r2.snapshot.myTeamId).toBeNull();
    expect(r2.snapshot.warnings).toEqual([expect.objectContaining({ code: "USER_LOOKUP_FAILED", message: expect.stringContaining("HTTP 503") })]);

    // A username that exists still finds the team.
    const ok = await importSleeperLeague({ season: 2026, leagueId: id, username: USERNAME }, { http: fakeHttp(routesFor(t)), resolver: fakeResolver(t.players), now: NOW });
    expect(ok.snapshot.myTeamId).toBe(String(t.meta.me.rosterId));
  });

  it("stops at the league for a guillotine league, before fetching its rosters", async () => {
    const t = loadTestLeague();
    t.league.settings.type = 3;
    const http = fakeHttp(routesFor(t));
    const e = await expectRejects(fetchSleeperLeague({ season: 2026, leagueId: String(t.league.league_id) }, { http }), "UNSUPPORTED_LEAGUE");
    expect(e.detail.path).toBe("settings.type");
    expect(http.calls.map((c) => c.url)).toEqual([sleeperUrls.state(), sleeperUrls.league(String(t.league.league_id))]);
  });

  it("turns an optional endpoint's failure into a warning", async () => {
    const t = loadTestLeague();
    const id = String(t.league.league_id);
    const routes = routesFor(t);
    routes.set(sleeperUrls.matchups(id, 5), json(null, 500));
    for (const w of PROJECTION_WEEKS) routes.set(projectionsUrl(w), html);
    const { snapshot } = await importSleeperLeague({ season: 2026, leagueId: id }, { http: fakeHttp(routes), resolver: fakeResolver(t.players), now: NOW });
    expect(snapshot.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["MATCHUPS_MISSING", "PROJECTIONS_UNREADABLE", "PROJECTIONS_MISSING"]));
    expect(snapshot.schedule.some((m) => m.week === 5)).toBe(false);
    expect(snapshot.schedule).toHaveLength(78);
    expect(snapshot.freeAgents).toEqual([]);
  });

  it("still lists free agents from the next weeks when this week's projections can't be read", async () => {
    const t = loadTestLeague();
    const id = String(t.league.league_id);
    const routes = routesFor(t);
    routes.set(projectionsUrl(4), json(null, 500));
    const { snapshot, notes } = await importSleeperLeague({ season: 2026, leagueId: id }, { http: fakeHttp(routes), resolver: fakeResolver(t.players), now: NOW });
    expect(snapshot.warnings).toEqual([expect.objectContaining({ code: "PROJECTIONS_UNREADABLE", platformPath: "projections/4" })]);
    expect(snapshot.freeAgents.length).toBeGreaterThan(0);
    expect(notes.some((n) => n.includes("projections for weeks 5–6"))).toBe(true);
  });

  it("maps HTTP failures of required responses to error codes", async () => {
    const t = loadTestLeague();
    const id = String(t.league.league_id);
    const withLeague = (res: HttpResponse) => {
      const routes = routesFor(t);
      routes.set(sleeperUrls.league(id), res);
      return fetchSleeperLeague({ season: 2026, leagueId: id }, { http: fakeHttp(routes) });
    };
    await expectRejects(withLeague(json(null)), "LEAGUE_NOT_FOUND"); // Sleeper: 200 with a literal null
    await expectRejects(withLeague(json({ message: "nope" }, 404)), "LEAGUE_NOT_FOUND");
    await expectRejects(withLeague(json(null, 500)), "SOURCE_DOWN");
    await expectRejects(withLeague(json(null, 429)), "SOURCE_DOWN");
    await expectRejects(withLeague({ status: 0, ok: false, isHtml: false, json: undefined, text: "", fromCache: false }), "SOURCE_DOWN");
    await expectRejects(withLeague(html), "SOURCE_DOWN");
    await expectRejects(withLeague({ status: 200, ok: true, isHtml: false, json: undefined, text: "oops", fromCache: false }), "BAD_RESPONSE");
    const bad = await expectRejects(withLeague(json({ league_id: id, season: "2026", settings: {}, scoring_settings: {} })), "BAD_RESPONSE");
    expect(bad.detail.path).toBe("league.roster_positions");
  });

  it("maps a client that throws to SOURCE_DOWN", async () => {
    const t = loadTestLeague();
    const routes = routesFor(t);
    routes.set(sleeperUrls.state(), () => {
      throw new Error("socket hang up");
    });
    await expectRejects(fetchSleeperLeague({ season: 2026, leagueId: String(t.league.league_id) }, { http: fakeHttp(routes) }), "SOURCE_DOWN");
  });

  it("rejects a malformed league ID without any request", async () => {
    const http = fakeHttp(new Map());
    await expectRejects(fetchSleeperLeague({ season: 2026, leagueId: "my league" }, { http }), "LEAGUE_NOT_FOUND");
    expect(http.calls).toEqual([]);
    await expectRejects(fetchSleeperLeague({ season: 2026 }, { http }), "NO_LEAGUE");
  });
});

describe("fetchSleeperLeague by username", () => {
  it("finds the user's only league and their team", async () => {
    const t = loadTestLeague();
    const http = fakeHttp(routesFor(t));
    const { snapshot } = await importSleeperLeague({ season: 2026, username: USERNAME }, { http, resolver: fakeResolver(t.players), now: NOW });
    expect(snapshot.myTeamId).toBe(String(t.meta.me.rosterId));
    expect(http.calls[0]?.url).toBe(`https://api.sleeper.app/v1/user/${USERNAME}`);
    expect(http.calls[1]?.url).toBe(`https://api.sleeper.app/v1/user/${t.meta.me.userId}/leagues/nfl/2026`);
  });

  it("offers the choices when the user has several leagues, and honours chooseLeagueId", async () => {
    const t = loadTestLeague();
    const routes = routesFor(t);
    const guillotine = { ...t.league, league_id: "1000000000000000077", name: "League 77", total_rosters: 18, settings: { ...t.league.settings, type: 3 } };
    routes.set(sleeperUrls.userLeagues(t.meta.me.userId, 2026), json([t.league, guillotine]));
    const e = await expectRejects(fetchSleeperLeague({ season: 2026, username: USERNAME }, { http: fakeHttp(routes) }), "NO_LEAGUE");
    expect(e).toBeInstanceOf(SleeperLeagueChoiceError);
    const kind = (["redraft", "keeper", "dynasty"] as const)[t.league.settings.type as number];
    expect(leagueChoicesOf(e)).toEqual([
      { leagueId: t.league.league_id, name: t.league.name, season: 2026, teams: 12, status: "in_season", leagueType: kind, bestBall: t.league.settings.best_ball === 1, supported: true },
      { leagueId: "1000000000000000077", name: "League 77", season: 2026, teams: 18, status: "in_season", leagueType: "guillotine", bestBall: t.league.settings.best_ball === 1, supported: false },
    ]);
    expect(leagueChoicesOf(new Error("x"))).toBeUndefined();
    const out = await fetchSleeperLeague({ season: 2026, username: USERNAME, chooseLeagueId: String(t.league.league_id) }, { http: fakeHttp(routes) });
    expect(out.userId).toBe(t.meta.me.userId);
    expect((out.raw.league as { league_id: string }).league_id).toBe(t.league.league_id);
  });

  it("maps a missing user and a user without leagues (no league ID: the username is required)", async () => {
    const t = loadTestLeague();
    const routes = routesFor(t);
    routes.set(sleeperUrls.user(USERNAME), json(null));
    await expectRejects(fetchSleeperLeague({ season: 2026, username: USERNAME }, { http: fakeHttp(routes) }), "USER_NOT_FOUND");
    const routes2 = routesFor(t);
    routes2.set(sleeperUrls.userLeagues(t.meta.me.userId, 2026), json([]));
    await expectRejects(fetchSleeperLeague({ season: 2026, username: USERNAME }, { http: fakeHttp(routes2) }), "NO_LEAGUE");
  });

  it("encodes the username in the URL", () => {
    expect(sleeperUrls.user("a b/c?")).toBe("https://api.sleeper.app/v1/user/a%20b%2Fc%3F");
  });
});

describe("helpers", () => {
  it("parses league IDs and sleeper.com links (the Connect page's parser)", () => {
    expect(parseSleeperLeagueId("1234567890123456789")).toBe("1234567890123456789");
    expect(parseSleeperLeagueId("https://sleeper.com/leagues/1234567890123456789/matchup")).toBe("1234567890123456789");
    expect(parseSleeperLeagueId("sleeper.app/leagues/1234567890123456789")).toBe("1234567890123456789");
    expect(parseSleeperLeagueId("12ab")).toBeUndefined();
    expect(parseSleeperLeagueId("")).toBeUndefined();
  });

  it("requests projections for the positions the league can start, in canonical order", () => {
    expect(startablePositions(["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "K", "DEF", "BN"])).toEqual(["QB", "RB", "WR", "TE", "K", "DEF"]);
    expect(startablePositions(["QB", "IDP_FLEX", "REC_FLEX", "BN"])).toEqual(["QB", "WR", "TE", "DL", "LB", "DB"]);
  });

  it("ranks free agents over this week and the next two, capped at NFL week 18", () => {
    expect(FREE_AGENT_RANK_WEEKS).toBe(3);
    expect(freeAgentRankWeeks(4)).toEqual([4, 5, 6]);
    expect(freeAgentRankWeeks(17)).toEqual([17, 18]);
    expect(freeAgentRankWeeks(18)).toEqual([18]);
  });

  it("caches a projections list only when it has rows", () => {
    expect(PROJECTIONS_POLICY.cacheIf?.(json([]))).toBe(false);
    expect(PROJECTIONS_POLICY.cacheIf?.(json([{ player_id: "1", stats: {} }]))).toBe(true);
    expect(PROJECTIONS_POLICY.cacheIf?.(json(null))).toBe(false);
  });

  it("requireJson: 400/404/null → not found, others → SOURCE_DOWN / BAD_RESPONSE", () => {
    expect(requireJson(json({ a: 1 }), "x", "LEAGUE_NOT_FOUND", "nf")).toEqual({ a: 1 });
    expect(() => requireJson(json(null, 400), "x", "USER_NOT_FOUND", "nf")).toThrow(expect.objectContaining({ code: "USER_NOT_FOUND" }));
    expect(() => requireJson(json(null, 403), "x", "LEAGUE_NOT_FOUND", "nf")).toThrow(expect.objectContaining({ code: "SOURCE_DOWN" }));
  });
});
