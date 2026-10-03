import { describe, expect, it } from "vitest";
import { ESPN_READS_BASE, fetchEspnLeague, LEAGUE_VIEWS, leagueUrl } from "@/adapters/espn/fetch";
import { LABELS, NOW as ESPN_NOW, PARKER, readEspn } from "@/adapters/espn/test-helpers";
import { MemoryCache, STALE_PUBLIC_RETAIN_MS, TTL, DAY } from "@/server/cache";
import { createHttpClient } from "@/server/http";
import { readSanitizedFixture } from "@/test-utils/fixtures";
import { resolverFromData } from "./crosswalk";
import { loadNflSchedule, NFL_SCHEDULE_MIN_TEAMS, NFL_SCHEDULE_TIMEOUT_MS, nflScheduleCacheKey, nflScheduleSchema, nflScheduleUrl, reduceNflSchedule, teamsWithGames, toNflScheduleInputs, type NflScheduleResponse } from "./nflSchedule";
import { SLEEPER_TEAM_CODES } from "./teamCodes";
import { FIXTURE, fakeHttp, fixtureDynastyRows } from "./testSupport";

const URL_2026 = nflScheduleUrl(2026);

/** The committed body (public, league-independent): a fresh deep copy each call, so tests can edit it. */
function body(): NflScheduleResponse & { settings: { proTeams: Array<Record<string, unknown>> } } {
  return structuredClone(readSanitizedFixture("shared", FIXTURE.espnProTeams));
}

/** The real crosswalk with DynastyProcess alone (Sleeper's 32 codes seeded): WSH → WAS, as in production. */
const resolver = resolverFromData({ sleeperPlayers: null, dynastyRows: fixtureDynastyRows(), fantasyCalcPlayers: null });
const teamCode = (abbrev: string) => resolver.defenseId(abbrev) ?? abbrev;

interface Game {
  date: number;
  startTimeTBD?: boolean;
}
type Team = { id: number; abbrev: string; byeWeek: number; proGamesByScoringPeriod?: Record<string, Game[]> };

describe("reduceNflSchedule (CLAUDE.md §2.9 NFL schedule and bye weeks, §6 step 3)", () => {
  const parsed = nflScheduleSchema.parse(body());
  const data = reduceNflSchedule(parsed, teamCode);

  it("keys every bye by Sleeper team code (WAS, not WSH; LAR), matching the Phase 0 byes derived with nflverse", () => {
    expect(Object.keys(data.byeWeek).sort()).toEqual([...SLEEPER_TEAM_CODES].sort());
    expect(data.byeWeek.WAS).toBe(7);
    expect(data.byeWeek.LAR).toBe(11);
    expect(data.byeWeek.WSH).toBeUndefined();
    const derived = readSanitizedFixture<{ byes: Record<string, number> }>("shared", "nfl/byes 2026 (derived)").byes; // nflverse codes (LA, WAS)
    expect(Object.keys(derived)).toHaveLength(32);
    for (const [code, week] of Object.entries(derived)) expect({ code, week: data.byeWeek[teamCode(code)] }).toEqual({ code, week });
    const onBye = (w: number) => Object.keys(data.byeWeek).filter((t) => data.byeWeek[t] === w).sort();
    expect(onBye(5)).toEqual(["CAR", "KC"]);
    expect(onBye(11)).toEqual(["ATL", "CLE", "GB", "LAR", "NE", "SEA"]);
  });

  it("keeps each team's kickoff per week, and none for a TBD game (placeholder date) or a bye", () => {
    const teams = (body().settings.proTeams as unknown as Team[]).filter((t) => t.id !== 0);
    let known = 0;
    let tbd = 0;
    for (const t of teams) {
      const code = teamCode(t.abbrev);
      for (const [w, games] of Object.entries(t.proGamesByScoringPeriod ?? {})) {
        const game = games[0] as Game;
        if (game.startTimeTBD) {
          tbd++;
          expect(data.kickoffs[Number(w)]?.[code]).toBeUndefined();
        } else {
          known++;
          expect(data.kickoffs[Number(w)]?.[code]).toBe(game.date);
        }
      }
      expect(data.kickoffs[t.byeWeek]?.[code]).toBeUndefined();
    }
    expect({ known, tbd }).toEqual({ known: 2 * 248, tbd: 2 * 24 }); // 272 games, 24 of them TBD (Phase 2 reader)
    expect(Object.values(data.kickoffs).reduce((n, week) => n + Object.keys(week).length, 0)).toBe(known);
    expect(data.kickoffs[18]).toBeUndefined(); // every week-18 game is TBD
    expect(data.kickoffs[1]?.ATL).toBe(Date.parse("2026-09-13T17:00:00Z"));
    expect(data.kickoffs[4]?.WAS).toBeDefined(); // Sleeper codes here too
    expect(data.kickoffs[4]?.WSH).toBeUndefined();
  });

  it("finds a bye in the games when ESPN leaves byeWeek out, and skips the FA pseudo-team and teams without an abbreviation", () => {
    const b = body();
    const teams = b.settings.proTeams as unknown as Array<Partial<Team>>;
    const ind = teams.find((t) => t.abbrev === "IND") as Partial<Team>;
    delete ind.byeWeek;
    const kc = teams.find((t) => t.abbrev === "KC") as Partial<Team>;
    kc.byeWeek = 0;
    delete kc.proGamesByScoringPeriod?.["9"]; // two weeks without a game: no single bye to name
    const lv = teams.find((t) => t.abbrev === "LV") as Partial<Team>;
    delete lv.abbrev;
    const out = reduceNflSchedule(nflScheduleSchema.parse(b), teamCode);
    expect(out.byeWeek.IND).toBe(13);
    expect(out.byeWeek.KC).toBeUndefined();
    expect(out.byeWeek.LV).toBeUndefined();
    expect(Object.values(out.kickoffs).some((w) => "LV" in w)).toBe(false);
    expect(Object.keys(out.byeWeek)).not.toContain("FA");
    expect(teamsWithGames(nflScheduleSchema.parse(b))).toBe(32); // FA (id 0) has no games and doesn't count
  });

  it("gives a game with an impossible date no kickoff (toNflScheduleInputs can't throw on it)", () => {
    const b = body();
    const atl = (b.settings.proTeams as unknown as Team[]).find((t) => t.abbrev === "ATL") as Team;
    (atl.proGamesByScoringPeriod?.["5"] as Game[])[0] = { ...(atl.proGamesByScoringPeriod?.["5"] as Game[])[0], date: 1e20 } as Game;
    const out = reduceNflSchedule(nflScheduleSchema.parse(b), teamCode);
    expect(out.kickoffs[5]?.ATL).toBeUndefined();
    expect(out.kickoffs[4]?.ATL).toBeDefined();
    expect(() => toNflScheduleInputs(out, 1)).not.toThrow();
  });

  it("toNflScheduleInputs: every bye, ISO kickoffs from the given week on, and the NFL's last week", () => {
    const inputs = toNflScheduleInputs(data, 4);
    expect(inputs.byeWeek).toEqual(data.byeWeek);
    expect(Object.keys(inputs.kickoffs).map(Number)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(inputs.kickoffs[4]?.WAS).toBe(new Date(data.kickoffs[4]?.WAS as number).toISOString());
    expect(inputs.kickoffs[4]?.CLE).toMatch(/^2026-10-\d\dT\d\d:\d\d:00\.000Z$/);
    expect(Object.keys(inputs.kickoffs[5] ?? {})).toHaveLength(30); // 15 games: CAR and KC on bye
    expect(inputs.lastWeek).toBe(18);
    expect(toNflScheduleInputs(data, 19)).toEqual({ byeWeek: data.byeWeek, kickoffs: {}, lastWeek: 18, opponents: {} });
    expect(toNflScheduleInputs({ byeWeek: {}, kickoffs: {} }, 4)).toEqual({ byeWeek: {}, kickoffs: {} }); // unknown stays unknown
  });

  it("gives every team its opponent each week it plays (home or away), in Sleeper codes, TBD games included; none on a bye (Phase 4: streaming picks)", () => {
    expect(data.opponents?.[1]?.ATL).toEqual({ team: "PIT", home: false });
    expect(data.opponents?.[1]?.PIT).toEqual({ team: "ATL", home: true });
    expect(data.opponents?.[1]?.WAS).toEqual({ team: "PHI", home: false }); // ESPN's WSH is Sleeper's WAS, on both sides
    expect(data.opponents?.[1]?.PHI).toEqual({ team: "WAS", home: true });
    expect(data.opponents?.[1]?.WSH).toBeUndefined();
    expect(data.opponents?.[4]?.KC).toEqual({ team: "LV", home: false });
    // Week 18: every game's time is TBD (no kickoffs), but the opponents are known.
    expect(data.kickoffs[18]).toBeUndefined();
    expect(data.opponents?.[18]?.KC).toEqual({ team: "LV", home: true });
    let games = 0;
    for (let w = 1; w <= 18; w++) {
      const week = data.opponents?.[w] ?? {};
      for (const [team, o] of Object.entries(week)) {
        // Symmetric: my opponent plays me, and exactly one of us is at home.
        expect(week[o.team]).toEqual({ team, home: !o.home });
        expect(data.byeWeek[team]).not.toBe(w);
        if (o.home) games++;
      }
      // A team on bye this week has no opponent; everyone else has one.
      const onBye = Object.keys(data.byeWeek).filter((t) => data.byeWeek[t] === w);
      expect(Object.keys(week).sort()).toEqual([...SLEEPER_TEAM_CODES].filter((t) => !onBye.includes(t)).sort());
    }
    expect(games).toBe(272);
  });

  it("keeps the earlier game's opponent when a team has two in a week, and leaves out a game against a team ESPN doesn't list", () => {
    const b = body();
    const teams = b.settings.proTeams as unknown as Array<Team & { id: number }>;
    const atl = teams.find((t) => t.abbrev === "ATL") as Team & { id: number };
    const nyg = teams.find((t) => t.abbrev === "NYG") as Team & { id: number };
    const week4 = (atl.proGamesByScoringPeriod?.["4"] as Array<Game & { homeProTeamId: number; awayProTeamId: number }>)[0] as Game & { homeProTeamId: number; awayProTeamId: number };
    // An earlier game against the Giants in the same week (an imagined reschedule), and a later one against an unknown team id.
    (atl.proGamesByScoringPeriod as Record<string, unknown[]>)["4"] = [
      { ...week4, date: week4.date + 3_600_000, homeProTeamId: 999, awayProTeamId: atl.id },
      { ...week4, date: week4.date - 3_600_000, homeProTeamId: nyg.id, awayProTeamId: atl.id },
    ];
    const kc = teams.find((t) => t.abbrev === "KC") as Team & { id: number };
    (kc.proGamesByScoringPeriod as Record<string, unknown[]>)["5"] = [{ date: Date.parse("2026-10-11T17:00:00Z"), homeProTeamId: kc.id, awayProTeamId: 999 }];
    const out = reduceNflSchedule(nflScheduleSchema.parse(b), teamCode);
    expect(out.opponents?.[4]?.ATL).toEqual({ team: "NYG", home: false });
    expect(out.kickoffs[4]?.ATL).toBe(week4.date - 3_600_000);
    expect(out.opponents?.[5]?.KC).toBeUndefined(); // KC's bye week, with a game against no team ESPN lists
    expect(out.kickoffs[5]?.KC).toBeDefined(); // its kickoff still stands, as before
  });

  it("toNflScheduleInputs passes the opponents from the given week on, and none for a schedule without them", () => {
    const inputs = toNflScheduleInputs(data, 4);
    expect(Object.keys(inputs.opponents ?? {}).map(Number)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(inputs.opponents?.[4]?.KC).toEqual({ team: "LV", home: false });
    expect(inputs.opponents?.[18]?.KC).toEqual({ team: "LV", home: true }); // TBD: no kickoff, still an opponent
    expect(inputs.opponents).not.toBe(data.opponents);
    expect(toNflScheduleInputs({ byeWeek: {}, kickoffs: {}, opponents: { 3: { KC: { team: "LV", home: true } } } }, 4)).toEqual({ byeWeek: {}, kickoffs: {}, opponents: {} });
    expect(toNflScheduleInputs({ byeWeek: {}, kickoffs: {} }, 4)).not.toHaveProperty("opponents");
    // About 15 KB of JSON for weeks 4–18 (32 teams a week less byes): the model inputs grow a little.
    expect(JSON.stringify(inputs.opponents).length).toBeLessThan(16_000);
  });

  it("the NFL's last week is the largest week with a game, time-TBD games included (every week-18 game is TBD in 2026)", () => {
    expect(data.lastWeek).toBe(18);
    expect(data.kickoffs[18]).toBeUndefined();
    // Another season's shape: the last week's games still TBD, one team's late games not yet listed.
    const b = body();
    const teams = b.settings.proTeams as unknown as Team[];
    for (const t of teams) delete t.proGamesByScoringPeriod?.["18"];
    expect(reduceNflSchedule(nflScheduleSchema.parse(b), teamCode).lastWeek).toBe(17);
    const dal = teams.find((t) => t.abbrev === "DAL") as Team;
    dal.proGamesByScoringPeriod = { ...dal.proGamesByScoringPeriod, "18": [{ date: 0, startTimeTBD: true, homeProTeamId: 6, awayProTeamId: 28 } as Game] };
    expect(reduceNflSchedule(nflScheduleSchema.parse(b), teamCode).lastWeek).toBe(18);
    // No games at all: unknown, not 0.
    const empty = reduceNflSchedule({ settings: { proTeams: [{ id: 1, abbrev: "ATL", byeWeek: 5, proGamesByScoringPeriod: {} }] } }, teamCode);
    expect(empty).not.toHaveProperty("lastWeek");
  });
});

describe("loadNflSchedule (CLAUDE.md §2.10: 7 days)", () => {
  it("asks ESPN once, cached 7 days under the ESPN adapter's key, and keys byes in Sleeper codes", async () => {
    const { http, calls } = fakeHttp({ [URL_2026]: { json: body(), fetchedAt: 1_790_000_000_000 } });
    const s = await loadNflSchedule(http, 2026, resolver);
    expect(URL_2026).toBe("https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026?view=proTeamSchedules_wl");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.opts?.cache).toEqual({ key: "espn:proTeamSchedules:2026", ttlMs: TTL.nflSchedule, retainMs: STALE_PUBLIC_RETAIN_MS, staleIfError: true });
    expect(calls[0]?.opts).toMatchObject({ maxRetries: 1, timeoutMs: NFL_SCHEDULE_TIMEOUT_MS });
    expect(calls[0]?.opts?.cookie).toBeUndefined();
    expect(s).toMatchObject({ season: 2026, fromCache: false, stale: false, fetchedAt: 1_790_000_000_000, lastWeek: 18 });
    expect(s.byeWeek.WAS).toBe(7);
    expect(Object.keys(s.byeWeek)).toHaveLength(32);
  });

  it("shares one copy with ESPN imports: the ESPN adapter asks for the same URL under the same key and TTL", async () => {
    const league = leagueUrl(PARKER.season, PARKER.leagueId, LEAGUE_VIEWS.map((v) => ["view", v]));
    const { http, calls } = fakeHttp({ [league]: { json: readEspn(LABELS.league) }, [URL_2026]: { json: body() } });
    await fetchEspnLeague({ leagueId: PARKER.leagueId, season: PARKER.season }, http, ESPN_NOW);
    const adapter = calls.find((c) => c.url.includes("proTeamSchedules"));
    expect(adapter?.url).toBe(nflScheduleUrl(PARKER.season));
    expect(adapter?.url.startsWith(ESPN_READS_BASE)).toBe(true);
    expect(adapter?.opts?.cache).toMatchObject({ key: nflScheduleCacheKey(PARKER.season), ttlMs: TTL.nflSchedule });
  });

  it("throws for ESPN failures and bad bodies (the caller degrades to a warning), naming the JSON path", async () => {
    const load = (route: Parameters<typeof fakeHttp>[0][string]) => loadNflSchedule(fakeHttp({ [URL_2026]: route }).http, 2026, resolver);
    await expect(load({ status: 503, json: {} })).rejects.toMatchObject({ code: "SOURCE_DOWN", message: "NFL schedule (ESPN): HTTP 503" });
    await expect(load({ status: 200, isHtml: true, text: "<!doctype html><html></html>" })).rejects.toMatchObject({ code: "SOURCE_DOWN" });
    await expect(load({ status: 200, text: "oops" })).rejects.toMatchObject({ code: "BAD_RESPONSE", detail: { path: "(root)" } });
    const b = body();
    const game = ((b.settings.proTeams as unknown as Team[]).find((t) => t.id === 1)?.proGamesByScoringPeriod?.["1"] as Array<Partial<Game>>)[0] as Partial<Game>;
    delete game.date;
    const index = (b.settings.proTeams as unknown as Team[]).findIndex((t) => t.id === 1);
    await expect(load({ json: b })).rejects.toMatchObject({ code: "BAD_RESPONSE", detail: { path: `settings.proTeams[${index}].proGamesByScoringPeriod["1"][0].date`, platform: "espn" } });
    const thrower = { get: async () => Promise.reject(new Error("socket hang up at https://example.invalid/secret")) };
    const err = await loadNflSchedule(thrower, 2026, resolver).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "SOURCE_DOWN", message: "NFL schedule (ESPN): couldn't be reached" });
  });

  it("rejects (and never caches) a schedule with fewer than 32 teams with games, e.g. one not published yet", async () => {
    const partial = body();
    const team = (partial.settings.proTeams as unknown as Team[]).find((t) => t.abbrev === "DAL") as Team;
    team.proGamesByScoringPeriod = {};
    const { http, calls } = fakeHttp({ [URL_2026]: { json: partial } });
    await expect(loadNflSchedule(http, 2026, resolver)).rejects.toMatchObject({ code: "BAD_RESPONSE", message: "NFL schedule (ESPN): 31 rows, expected at least 32 teams with games" });
    const cacheIf = calls[0]?.opts?.cacheIf;
    const res = (json: unknown) => ({ status: 200, ok: true, isHtml: false, json, text: JSON.stringify(json), fromCache: false });
    expect(cacheIf?.(res(partial))).toBe(false);
    expect(cacheIf?.(res({ settings: { proTeams: [] } }))).toBe(false);
    expect(cacheIf?.(res(body()))).toBe(true);
    expect(NFL_SCHEDULE_MIN_TEAMS).toBe(32);
  });

  it("fetches a fresh saved copy that fails the check once more (the ESPN adapter caches any JSON body), and replaces it", async () => {
    const cache = new MemoryCache();
    const key = nflScheduleCacheKey(2026);
    await cache.set(key, { status: 200, contentType: "application/json", text: JSON.stringify({ settings: { proTeams: [] } }) }, TTL.nflSchedule);
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(body()), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const s = await loadNflSchedule(createHttpClient({ fetchImpl, cache }), 2026, resolver);
    expect(urls).toEqual([URL_2026]);
    expect(s).toMatchObject({ fromCache: false, stale: false });
    expect(Object.keys(s.byeWeek)).toHaveLength(32);
    const stored = await cache.get<{ text: string }>(key, TTL.nflSchedule);
    expect(teamsWithGames(nflScheduleSchema.parse(JSON.parse(stored?.value.text ?? "{}")))).toBe(32);
  });

  it("has no stale window: a copy is served for 7 days and deleted after 7 (§2.10's public retention), so ESPN failing then is an error", async () => {
    expect(TTL.nflSchedule).toBe(STALE_PUBLIC_RETAIN_MS);
    const key = nflScheduleCacheKey(2026);
    const saved = { status: 200, contentType: "application/json", text: JSON.stringify(body()) };
    const htmlPage = (async () => new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    // 3 days old: fresh, served without a request.
    const recent = new MemoryCache();
    await recent.set(key, saved, STALE_PUBLIC_RETAIN_MS, Date.now() - 3 * DAY);
    let requests = 0;
    const counting = (async (...args: Parameters<typeof fetch>) => {
      requests++;
      return htmlPage(...args);
    }) as typeof fetch;
    await expect(loadNflSchedule(createHttpClient({ fetchImpl: counting, cache: recent }), 2026, resolver)).resolves.toMatchObject({ fromCache: true, stale: false });
    expect(requests).toBe(0);
    // 8 days old: already deleted, so an ESPN failure has nothing to fall back on.
    const old = new MemoryCache();
    await old.set(key, saved, STALE_PUBLIC_RETAIN_MS, Date.now() - 8 * DAY);
    await expect(loadNflSchedule(createHttpClient({ fetchImpl: htmlPage, cache: old }), 2026, resolver)).rejects.toMatchObject({ code: "SOURCE_DOWN" });
  });
});
